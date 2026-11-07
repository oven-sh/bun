//! A resolver's state: its configuration, servers, connections, and the queries in flight.

mod connection;
mod exchange;
mod query_cache;
mod server;

use core::cmp::Reverse;
use core::net::{Ipv4Addr, Ipv6Addr};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

use connection::{Connection, ConnectionId};
use query_cache::QueryCache;
pub use server::ServerConfig;
use server::{Server, ServerId};

use crate::addr_info::AddrInfo;
use crate::hosts::HostsFile;
use crate::io::{Io, Time, Transport};
use crate::lookup::{AddrInfoLookup, Host, HostLookup, NameInfo};
use crate::message::{Message, rcode};
use crate::reply::{RecordType, Reply};
use crate::system_config::{self, Source};
use crate::{Error, Result};

/// Counts the queries of a channel. Unlike the 16 bits on the wire, never used twice.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Serial(u64);

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct LookupId(u64);

const DEFAULT_TIMEOUT_MS: u64 = 2000;
/// c-ares's. `node:dns` asks for Node's 4 unless it is told otherwise.
const DEFAULT_TRIES: usize = 3;
/// One query in this many is copied to a server that failed, to see whether it is back.
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

/// Whatever number the caller knows a request by.
pub type Token = u64;

/// The end of one request.
#[derive(Debug)]
pub struct Completion {
    /// What the request was made with.
    pub token: Token,
    pub result: Result<Answer>,
}

/// Who is told of a query's end.
#[derive(Clone, Copy)]
pub(crate) enum Owner {
    Caller {
        record_type: RecordType,
        token: Token,
    },
    AddrInfo {
        lookup: LookupId,
    },
    Host {
        lookup: LookupId,
    },
    /// A copy of another query, sent to a server that failed. Nobody waits for it: its outcome
    /// only updates the server's failure count.
    Probe {
        server: ServerId,
    },
}

struct Query {
    message: Message,
    cache_key: Vec<u8>,
    owner: Owner,
    transport: Transport,
    no_retries: bool,
    try_count: usize,
    /// Why the last try that gave a reason failed.
    last_error: Option<Error>,
    sent_at: Time,
    /// With `send_order`, its place in `Channel::deadlines`.
    deadline: Option<Time>,
    sent_on: Option<(ConnectionId, ServerId)>,
    /// Its place in `Connection::queries`.
    send_order: u64,
}

/// Nothing here calls the caller. A request that ends, even before the method that made it
/// returns, waits in a queue for [`Channel::next_completion`].
pub struct Channel {
    pub(crate) io: Box<dyn Io>,

    timeout_ms: u64,
    tries: usize,
    pub(crate) ndots: usize,
    rotate: bool,
    use_tcp: bool,
    pub(crate) search_domains: Vec<Vec<u8>>,
    pub(crate) sources: Vec<Source>,
    local_v4: Option<Ipv4Addr>,
    local_v6: Option<Ipv6Addr>,

    shut_down: bool,
    /// Best first: [`Server::sort_key`].
    servers: Vec<Server>,
    last_server_id: u64,
    /// How often a server was given a place in `servers`.
    placements: u64,
    connections: BTreeMap<ConnectionId, Connection>,
    last_connection_id: u64,
    last_send_order: u64,
    queries: BTreeMap<Serial, Query>,
    last_serial: u64,
    serial_of_id: BTreeMap<u16, Serial>,
    /// Of those due at one time, the one sent last comes first, as in c-ares's skip list.
    deadlines: BTreeSet<(Time, Reverse<u64>, Serial)>,
    cache: QueryCache,
    read_buffer: Vec<u8>,

    pub(crate) hosts: Option<HostsFile>,
    pub(crate) addr_info_lookups: BTreeMap<LookupId, AddrInfoLookup>,
    pub(crate) host_lookups: BTreeMap<LookupId, HostLookup>,
    last_lookup_id: u64,

    completed: VecDeque<Completion>,
}

impl Channel {
    pub fn new(mut io: Box<dyn Io>, options: Options) -> Self {
        // As c-ares: a configuration that cannot be read is no reason not to resolve.
        let system = system_config::read(&mut *io).unwrap_or_default();
        let timeout_ms = options.timeout_ms.or(system.timeout_ms);
        let tries = options.tries.or(system.tries);
        let mut channel = Channel {
            timeout_ms: timeout_ms.map_or(DEFAULT_TIMEOUT_MS, u64::from),
            tries: tries.map_or(DEFAULT_TRIES, |it| it as usize),
            ndots: system.ndots,
            rotate: system.rotate,
            use_tcp: system.use_tcp,
            search_domains: system.search_domains,
            sources: system.sources,
            local_v4: None,
            local_v6: None,
            shut_down: false,
            servers: Vec::new(),
            last_server_id: 0,
            placements: 0,
            connections: BTreeMap::new(),
            last_connection_id: 0,
            last_send_order: 0,
            queries: BTreeMap::new(),
            last_serial: 0,
            serial_of_id: BTreeMap::new(),
            deadlines: BTreeSet::new(),
            cache: QueryCache::default(),
            read_buffer: Vec::new(),
            hosts: None,
            addr_info_lookups: BTreeMap::new(),
            host_lookups: BTreeMap::new(),
            last_lookup_id: 0,
            completed: VecDeque::new(),
            io,
        };
        if channel.search_domains.is_empty() {
            channel
                .search_domains
                .extend(system_config::domain_of_hostname(&mut *channel.io));
        }
        let loopback = [ServerConfig::at(Ipv4Addr::LOCALHOST.into())];
        channel.set_servers(
            Time::ZERO,
            match system.servers.as_slice() {
                [] => &loopback,
                servers => servers,
            },
        );
        channel
    }

    /// Requests that have ended, in the order they did.
    pub fn next_completion(&mut self) -> Option<Completion> {
        self.completed.pop_front()
    }

    /// Fails a request the caller rejected itself, through the same queue so that completions keep
    /// their order.
    pub fn fail(&mut self, token: Token, error: Error) {
        self.complete(token, Err(error));
    }

    pub(crate) fn complete(&mut self, token: Token, result: Result<Answer>) {
        self.completed.push_back(Completion { token, result });
    }

    pub(crate) fn new_lookup_id(&mut self) -> LookupId {
        self.last_lookup_id += 1;
        LookupId(self.last_lookup_id)
    }

    /// When [`Channel::check_timeouts`] is next to be called.
    pub fn next_deadline(&self) -> Option<Time> {
        self.deadlines.first().map(|(time, ..)| *time)
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

    /// After a change to the `sort_key` of `changed`.
    fn sort_servers(&mut self, changed: ServerId) {
        self.placements += 1;
        let placed = self.placements;
        if let Some(server) = self.server_mut(changed) {
            server.placed = placed;
        }
        self.servers.sort_by_key(Server::sort_key);
    }

    /// Best first, which is the order they were given in until one fails.
    pub fn servers(&self) -> Vec<ServerConfig> {
        self.servers.iter().map(|server| server.config).collect()
    }

    /// A server that stays keeps its failure count, latencies and connections. The queries of one
    /// that goes move to the others.
    pub fn set_servers(&mut self, now: Time, list: &[ServerConfig]) {
        let mut changed = false;
        let mut seen: Vec<&ServerConfig> = Vec::with_capacity(list.len());
        for config in list {
            if seen.iter().any(|other| other.is_same_server(config)) {
                continue;
            }
            let index = seen.len();
            seen.push(config);
            let mut known = self.servers.iter_mut();
            match known.find(|server| server.config.is_same_server(config)) {
                Some(server) => {
                    if config.scope_id != 0 {
                        server.config.scope_id = config.scope_id;
                    }
                    if server.index != index {
                        server.index = index;
                        let id = server.id;
                        self.sort_servers(id);
                    }
                }
                None => {
                    self.last_server_id += 1;
                    let id = ServerId(self.last_server_id);
                    self.servers.push(Server::new(id, index, config));
                    self.sort_servers(id);
                    changed = true;
                }
            }
        }

        let is_stale = |server: &Server| !seen.iter().any(|it| server.config.is_same_server(it));
        while let Some(position) = self.servers.iter().position(is_stale) {
            let server = self.servers.remove(position);
            for id in server.connections {
                self.close_connection(now, id, None);
            }
            changed = true;
        }
        if changed {
            self.cache.flush();
        }
    }

    fn count_server_failure(&mut self, now: Time, id: ServerId) {
        if let Some(server) = self.server_mut(id) {
            server.count_failure(now);
            self.sort_servers(id);
        }
    }

    fn clear_server_failures(&mut self, id: ServerId) {
        if let Some(server) = self.server_mut(id)
            && server.consecutive_failures > 0
        {
            server.consecutive_failures = 0;
            server.next_retry_time = Time::ZERO;
            self.sort_servers(id);
        }
    }

    fn random_u16(&mut self) -> u16 {
        let mut bytes = [0; 2];
        self.io.random(&mut bytes);
        u16::from_ne_bytes(bytes)
    }

    /// `dns.resolve*()`: asks the servers for `name` as it is, without the search list or the
    /// hosts file.
    pub fn resolve(&mut self, now: Time, record_type: RecordType, name: &[u8], token: Token) {
        let owner = Owner::Caller { record_type, token };
        self.ask(now, name, record_type.rr_type(), owner);
    }

    /// The serial is of a query now waiting for a server. Otherwise `owner` has been told how it
    /// ended.
    pub(crate) fn ask(
        &mut self,
        now: Time,
        name: &[u8],
        qtype: u16,
        owner: Owner,
    ) -> Option<Serial> {
        // RFC 7686.
        if crate::lookup::is_onion_domain(name) {
            self.finish(now, owner, Err(Error::ENOTFOUND));
            return None;
        }
        self.start_query(now, &Message::query(name, qtype), owner)
    }

    /// As [`Channel::ask`].
    fn start_query(&mut self, now: Time, message: &Message, owner: Owner) -> Option<Serial> {
        if self.serial_of_id.len() > usize::from(u16::MAX) {
            self.finish(now, owner, Err(Error::ENOMEM));
            return None;
        }
        // Before anything else, as in c-ares, so that the same random bytes make the same choices.
        let id = loop {
            let id = self.random_u16();
            if !self.serial_of_id.contains_key(&id) {
                break id;
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
            self.finish(now, owner, Err(error));
            return None;
        }

        let probed = match owner {
            Owner::Probe { server } => Some(server),
            _ => None,
        };
        let cache_key = query_cache::key_of(message);
        if probed.is_none()
            && let Some(response) = self.cache.fetch(now, &cache_key)
        {
            self.finish(now, owner, Ok(response));
            return None;
        }

        let mut message = match message.rewritten(0) {
            Ok(message) => message,
            Err(error) => {
                let error = match error {
                    Error::EBADRESP => Error::EBADQUERY,
                    other => other,
                };
                self.finish(now, owner, Err(error));
                return None;
            }
        };
        message.id = id;

        self.last_serial += 1;
        let serial = Serial(self.last_serial);
        self.serial_of_id.insert(id, serial);
        self.queries.insert(
            serial,
            Query {
                message,
                cache_key,
                owner,
                transport: if self.use_tcp {
                    Transport::Tcp
                } else {
                    Transport::Udp
                },
                no_retries: probed.is_some(),
                try_count: 0,
                last_error: None,
                sent_at: now,
                deadline: None,
                sent_on: None,
                send_order: 0,
            },
        );
        self.send_query(now, probed, serial);
        self.queries.contains_key(&serial).then_some(serial)
    }

    /// The try under way is the query's last.
    pub(crate) fn stop_retrying(&mut self, serial: Serial) {
        if let Some(query) = self.queries.get_mut(&serial) {
            query.no_retries = true;
        }
    }

    /// Tells `owner` how its query ended.
    fn finish(&mut self, now: Time, owner: Owner, result: Result<Message>) {
        match owner {
            // `end_query` does this for a probe that was sent. This is for one that was not.
            Owner::Probe { server } => {
                if let Some(server) = self.server_mut(server) {
                    server.probe_pending = false;
                }
            }
            Owner::Caller { record_type, token } => {
                let reply = result.and_then(|response| {
                    // c-ares hands a response over as bytes. One it cannot write is an error,
                    // whatever its RCODE.
                    let bytes = response.write(0)?;
                    checked(response)?;
                    Reply::parse(record_type, &bytes)
                });
                self.complete(token, reply.map(Answer::Reply));
            }
            Owner::AddrInfo { lookup } => {
                self.addr_info_lookup_answered(now, lookup, result.and_then(checked));
            }
            Owner::Host { lookup } => {
                self.host_lookup_answered(now, lookup, result.and_then(checked));
            }
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
                self.close_connection(now, id, None);
            }
        }
    }

    fn end_all(&mut self, now: Time, error: Error) {
        // A query made by the end of one of these is not one of these.
        let last = Serial(self.last_serial);
        while let Some(entry) = self.queries.first_entry()
            && *entry.key() <= last
        {
            let serial = *entry.key();
            if let Some(query) = self.detach_query(serial) {
                self.finish(now, query.owner, Err(error));
            }
        }
    }
}

/// `response`, or the error it stands for.
fn checked(response: Message) -> Result<Message> {
    match response.rcode {
        rcode::NOERROR if response.answer.is_empty() => Err(Error::ENODATA),
        rcode::FORMERR => Err(Error::EFORMERR),
        rcode::SERVFAIL => Err(Error::ESERVFAIL),
        rcode::NXDOMAIN => Err(Error::ENOTFOUND),
        rcode::NOTIMP => Err(Error::ENOTIMP),
        rcode::REFUSED => Err(Error::EREFUSED),
        _ => Ok(response),
    }
}
