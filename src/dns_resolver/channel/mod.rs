//! A resolver's state: its configuration, servers, connections, and the queries in flight.

mod conn;
mod process;
mod qcache;
mod server;

use core::cmp::Reverse;
use core::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

use conn::{Conn, ConnId};
use qcache::QueryCache;
pub use server::ServerConfig;
use server::{Server, ServerId};

use crate::addrinfo::{AddrInfo, Family};
use crate::hosts::HostsFile;
use crate::io::{Io, Time};
use crate::lookup::{AddrInfoLookup, Host, HostLookup, NameInfo};
use crate::record::{Record, rcode};
use crate::reply::{Kind, Reply};
use crate::sysconfig::{self, Source};
use crate::{Error, Result};

/// Counts the queries of a channel. Unlike the 16 bits on the wire, never used twice.
pub(crate) type Serial = u64;
pub(crate) type LookupId = u64;
pub(crate) type Status = Result<()>;

const DEFAULT_TIMEOUT_MS: u64 = 2000;
const DEFAULT_TRIES: usize = 3;
/// How long a server that failed is left alone before a query may be copied to it to see whether it is back.
const SERVER_RETRY_DELAY_MS: u64 = 5000;
/// One query in this many is so copied.
const SERVER_RETRY_CHANCE: u16 = 10;

/// `None` leaves it to the system's configuration, then to the default.
#[derive(Clone, Copy, Default, Debug)]
pub struct Options {
    pub timeout_ms: Option<u32>,
    pub tries: Option<u32>,
}

#[derive(Debug)]
pub enum Answer {
    Reply(Reply),
    AddrInfo(AddrInfo),
    Host(Host),
    NameInfo(NameInfo),
}

/// The end of one request.
#[derive(Debug)]
pub struct Completion<T> {
    /// What the request was made with.
    pub token: T,
    pub result: Result<Answer>,
}

/// Who is told of a query's end.
pub(crate) enum Owner<T> {
    Caller {
        kind: Kind,
        token: T,
    },
    AddrInfo {
        lookup: LookupId,
        family: Family,
    },
    Host {
        lookup: LookupId,
    },
    /// A copy of another query, sent to a server that failed. What becomes of it is that server's record.
    Probe {
        server: ServerId,
    },
}

pub(crate) struct Query<T> {
    qid: u16,
    record: Record,
    cache_key: Vec<u8>,
    owner: Owner<T>,
    using_tcp: bool,
    pub(crate) no_retries: bool,
    try_count: usize,
    /// Why the last try failed.
    error_status: Status,
    sent_at: Time,
    /// With `send_order`, its place in `Channel::timeouts`.
    timeout: Option<Time>,
    sent_on: Option<(ConnId, ServerId)>,
    /// Its place in `Conn::queries`.
    send_order: u64,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct SendFlags {
    no_cache: bool,
    no_retry: bool,
}

/// `T` is whatever the caller wants back in the [`Completion`] of a request.
///
/// Nothing here calls the caller. A request that ends, even before the method that made it returns, waits in a queue for [`Channel::next_completion`].
pub struct Channel<I: Io, T> {
    pub(crate) io: I,

    timeout_ms: u64,
    tries: usize,
    pub(crate) ndots: usize,
    rotate: bool,
    use_tcp: bool,
    pub(crate) domains: Vec<Vec<u8>>,
    pub(crate) sources: Vec<Source>,
    local_v4: Option<Ipv4Addr>,
    local_v6: Option<Ipv6Addr>,

    shut_down: bool,
    /// Best first: [`Server::sort_key`].
    servers: Vec<Server>,
    next_server_id: u64,
    conns: BTreeMap<ConnId, Conn<I::Socket>>,
    next_conn_id: u64,
    sends: u64,
    pub(crate) queries: BTreeMap<Serial, Query<T>>,
    next_serial: Serial,
    serial_of_qid: BTreeMap<u16, Serial>,
    /// Of those due at one time, the one sent last comes first, as in c-ares's skip list.
    timeouts: BTreeSet<(Time, Reverse<u64>, Serial)>,
    cache: QueryCache,
    read_buffer: Vec<u8>,

    pub(crate) hosts: Option<HostsFile>,
    pub(crate) addr_info_lookups: BTreeMap<LookupId, AddrInfoLookup<T>>,
    pub(crate) host_lookups: BTreeMap<LookupId, HostLookup<T>>,
    pub(crate) next_lookup_id: LookupId,

    completed: VecDeque<Completion<T>>,
}

impl<I: Io, T> Channel<I, T> {
    pub fn new(mut io: I, options: Options) -> Self {
        let system = sysconfig::read(&mut io).unwrap_or_default();
        let or_system = |option: Option<u32>, system: Option<u32>| option.or(system);
        let mut channel = Channel {
            timeout_ms: or_system(options.timeout_ms, system.timeout_ms)
                .map_or(DEFAULT_TIMEOUT_MS, u64::from),
            tries: or_system(options.tries, system.tries).map_or(DEFAULT_TRIES, |it| it as usize),
            ndots: system.ndots,
            rotate: system.rotate,
            use_tcp: system.use_tcp,
            domains: system.domains,
            sources: system
                .sources
                .unwrap_or_else(|| vec![Source::Files, Source::Dns]),
            local_v4: None,
            local_v6: None,
            shut_down: false,
            servers: Vec::new(),
            next_server_id: 0,
            conns: BTreeMap::new(),
            next_conn_id: 0,
            sends: 0,
            queries: BTreeMap::new(),
            next_serial: 0,
            serial_of_qid: BTreeMap::new(),
            timeouts: BTreeSet::new(),
            cache: QueryCache::default(),
            read_buffer: Vec::new(),
            hosts: None,
            addr_info_lookups: BTreeMap::new(),
            host_lookups: BTreeMap::new(),
            next_lookup_id: 0,
            completed: VecDeque::new(),
            io,
        };
        if channel.domains.is_empty() {
            channel
                .domains
                .extend(sysconfig::domain_of_hostname(&mut channel.io));
        }
        let loopback = [ServerConfig {
            address: Ipv4Addr::LOCALHOST.into(),
            udp_port: 0,
            tcp_port: 0,
            scope_id: 0,
        }];
        channel.set_servers(
            Time::ZERO,
            match system.servers.as_slice() {
                [] => &loopback,
                servers => servers,
            },
        );
        channel
    }

    pub fn io(&mut self) -> &mut I {
        &mut self.io
    }

    /// Requests that have ended, in the order they did.
    pub fn next_completion(&mut self) -> Option<Completion<T>> {
        self.completed.pop_front()
    }

    /// Ends a request that is found wanting before it gets here, in its turn.
    pub fn fail(&mut self, token: T, error: Error) {
        self.complete(token, Err(error));
    }

    pub(crate) fn complete(&mut self, token: T, result: Result<Answer>) {
        self.completed.push_back(Completion { token, result });
    }

    /// When [`Channel::process`] is next to be called even if no socket is ready.
    pub fn next_timeout(&self) -> Option<Time> {
        self.timeouts.first().map(|(time, ..)| *time)
    }

    /// Queries waiting for a server, those a lookup makes among them.
    pub fn active_queries(&self) -> usize {
        self.queries.len()
    }

    /// An unspecified address undoes it.
    pub fn set_local_v4(&mut self, address: Ipv4Addr) {
        self.local_v4 = Some(address).filter(|it| !it.is_unspecified());
    }

    /// An unspecified address undoes it.
    pub fn set_local_v6(&mut self, address: Ipv6Addr) {
        self.local_v6 = Some(address).filter(|it| !it.is_unspecified());
    }

    fn server(&self, id: ServerId) -> Option<&Server> {
        self.servers.iter().find(|server| server.id == id)
    }

    fn server_mut(&mut self, id: ServerId) -> Option<&mut Server> {
        self.servers.iter_mut().find(|server| server.id == id)
    }

    fn sort_servers(&mut self) {
        self.servers.sort_by_key(Server::sort_key);
    }

    /// Best first, which is the order they were given in until one fails.
    pub fn servers(&self) -> Vec<ServerConfig> {
        let config = |server: &Server| ServerConfig {
            address: server.address,
            udp_port: server.udp_port,
            tcp_port: server.tcp_port,
            scope_id: server.scope_id,
        };
        self.servers.iter().map(config).collect()
    }

    /// A server that stays keeps its record and connections. The queries of one that goes move to the others.
    pub fn set_servers(&mut self, now: Time, list: &[ServerConfig]) {
        let mut changed = false;
        let mut index = 0;
        for (position, config) in list.iter().enumerate() {
            let same = |other: &ServerConfig| {
                other.address == config.address && other.ports() == config.ports()
            };
            if list.iter().take(position).any(same) {
                continue;
            }
            match self.servers.iter_mut().find(|server| server.is(config)) {
                Some(server) => {
                    if config.scope_id != 0 {
                        server.scope_id = config.scope_id;
                    }
                    server.index = index;
                }
                None => {
                    self.next_server_id += 1;
                    let id = ServerId(self.next_server_id);
                    self.servers.push(Server::new(id, index, config));
                    changed = true;
                }
            }
            index += 1;
        }
        self.sort_servers();

        let is_stale = |server: &Server| !list.iter().any(|config| server.is(config));
        while let Some(position) = self.servers.iter().position(is_stale) {
            let server = self.servers.remove(position);
            for id in server.connections {
                self.close_connection(now, id, Ok(()));
            }
            changed = true;
        }
        if changed {
            self.cache.flush();
        }
    }

    fn count_server_failure(&mut self, now: Time, id: ServerId) {
        if let Some(server) = self.server_mut(id) {
            server.count_failure(now, SERVER_RETRY_DELAY_MS);
            self.sort_servers();
        }
    }

    fn server_is_good(&mut self, id: ServerId) {
        if let Some(server) = self.server_mut(id)
            && server.consecutive_failures > 0
        {
            server.consecutive_failures = 0;
            server.next_retry_time = Time::ZERO;
            self.sort_servers();
        }
    }

    fn random_u16(&mut self) -> u16 {
        let mut bytes = [0; 2];
        self.io.random(&mut bytes);
        u16::from_ne_bytes(bytes)
    }

    /// `dns.resolve*()`: asks the servers for `name` as it is, without the search list or the hosts file.
    pub fn query(&mut self, now: Time, kind: Kind, name: &[u8], token: T) {
        self.send_question(now, name, kind.rr_type(), Owner::Caller { kind, token });
    }

    /// The serial is of a query now waiting for a server. Otherwise `owner` has been told how it ended.
    pub(crate) fn send_question(
        &mut self,
        now: Time,
        name: &[u8],
        qtype: u16,
        owner: Owner<T>,
    ) -> Option<Serial> {
        // RFC 7686.
        if crate::lookup::is_onion_domain(name) {
            self.finish(now, owner, Err(Error::ENOTFOUND), None);
            return None;
        }
        let request = Record::query(name, qtype);
        self.send(now, None, SendFlags::default(), &request, owner)
    }

    fn send(
        &mut self,
        now: Time,
        server: Option<ServerId>,
        flags: SendFlags,
        request: &Record,
        owner: Owner<T>,
    ) -> Option<Serial> {
        if self.serial_of_qid.len() > usize::from(u16::MAX) {
            self.finish(now, owner, Err(Error::ENOMEM), None);
            return None;
        }
        // Before anything else, as in c-ares, so that the same random bytes make the same choices.
        let qid = loop {
            let qid = self.random_u16();
            if !self.serial_of_qid.contains_key(&qid) {
                break qid;
            }
        };
        let refusal = if self.shut_down {
            Some(Error::EDESTRUCTION)
        } else if self.servers.is_empty() {
            Some(Error::ENOSERVER)
        } else {
            None
        };
        if let Some(error) = refusal {
            self.finish(now, owner, Err(error), None);
            return None;
        }

        let cache_key = qcache::key_of(request);
        if !flags.no_cache
            && let Some(answer) = self.cache.fetch(now, &cache_key)
        {
            self.finish(now, owner, Ok(()), Some(answer));
            return None;
        }

        let mut record = match request.rewritten(0) {
            Ok(record) => record,
            Err(error) => {
                let error = match error {
                    Error::EBADRESP => Error::EBADQUERY,
                    other => other,
                };
                self.finish(now, owner, Err(error), None);
                return None;
            }
        };
        record.id = qid;

        self.next_serial += 1;
        let serial = self.next_serial;
        self.serial_of_qid.insert(qid, serial);
        self.queries.insert(
            serial,
            Query {
                qid,
                record,
                cache_key,
                owner,
                using_tcp: self.use_tcp,
                no_retries: flags.no_retry,
                try_count: 0,
                error_status: Ok(()),
                sent_at: now,
                timeout: None,
                sent_on: None,
                send_order: 0,
            },
        );
        self.send_query(now, server, serial).ok().map(|()| serial)
    }

    /// Tells `owner` how its query ended. `answer` is there if `status` is `Ok`, and with some errors.
    fn finish(&mut self, now: Time, owner: Owner<T>, status: Status, answer: Option<Record>) {
        let status = status.and_then(|()| match &answer {
            Some(answer) => status_of_answer(answer),
            None => Err(Error::EBADRESP),
        });
        match owner {
            // Also one that never got as far as a connection, which no server is told of.
            Owner::Probe { server } => {
                if let Some(server) = self.server_mut(server) {
                    server.probe_pending = false;
                }
            }
            Owner::Caller { kind, token } => {
                // c-ares hands an answer over as a message. One it cannot write is an error, whatever else is.
                let message = answer.map(|answer| answer.write(0)).transpose();
                let reply = message.and_then(|message| {
                    status?;
                    Reply::parse(kind, &message.unwrap_or_default())
                });
                self.complete(token, reply.map(Answer::Reply));
            }
            Owner::AddrInfo { lookup, family } => {
                self.addr_info_answered(now, lookup, family, status, answer.as_ref());
            }
            Owner::Host { lookup } => self.host_answered(now, lookup, status, answer.as_ref()),
        }
    }

    /// Ends every request with `ECANCELLED`.
    pub fn cancel(&mut self, now: Time) {
        self.end_all(now, Error::ECANCELLED);
        self.close_idle_connections(now);
    }

    /// Ends every request with `EDESTRUCTION`, as any later one will, and closes every socket.
    pub fn shut_down(&mut self, now: Time) {
        self.shut_down = true;
        self.end_all(now, Error::EDESTRUCTION);
        for server in core::mem::take(&mut self.servers) {
            for id in server.connections {
                self.close_connection(now, id, Ok(()));
            }
        }
    }

    fn end_all(&mut self, now: Time, error: Error) {
        // A query made by the end of one of these is not one of these.
        let last = self.next_serial;
        while let Some(entry) = self.queries.first_entry()
            && *entry.key() <= last
        {
            let serial = *entry.key();
            if let Some(query) = self.detach_query(serial) {
                self.finish(now, query.owner, Err(error), None);
            }
        }
    }
}

fn status_of_answer(answer: &Record) -> Status {
    match answer.rcode {
        rcode::NOERROR if answer.answer.is_empty() => Err(Error::ENODATA),
        rcode::FORMERR => Err(Error::EFORMERR),
        rcode::SERVFAIL => Err(Error::ESERVFAIL),
        rcode::NXDOMAIN => Err(Error::ENOTFOUND),
        rcode::NOTIMP => Err(Error::ENOTIMP),
        rcode::REFUSED => Err(Error::EREFUSED),
        _ => Ok(()),
    }
}

impl From<IpAddr> for ServerConfig {
    fn from(address: IpAddr) -> Self {
        ServerConfig {
            address,
            udp_port: 0,
            tcp_port: 0,
            scope_id: 0,
        }
    }
}
