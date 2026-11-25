//! A machine on which nothing happens unless a test says so.

use core::cell::{RefCell, RefMut};
use core::net::{IpAddr, SocketAddr};
use core::time::Duration;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::rc::Rc;

use bun_core::ZStr;
use bun_dns_client::{
    Address, Answer, Answers, Client, Events, Family, FileStamp, Name, Options, Record, RecordType,
    Records, Reply, Route, Socket, SocketError, SocketId, System, Transport, Variable,
};

use crate::wire;

pub(crate) const HOSTS: &str = "/etc/hosts";
pub(crate) const NSSWITCH: &str = "/etc/nsswitch.conf";
pub(crate) const RESOLV_CONF: &str = "/etc/resolv.conf";

pub(crate) struct Opened {
    id: SocketId,
    pub(crate) transport: Transport,
    pub(crate) server: SocketAddr,
    pub(crate) local: Option<IpAddr>,
    pub(crate) is_open: bool,
    pub(crate) watches: Vec<bool>,
    pub(crate) receive_calls: usize,
    /// What a stream took, less the whole frames.
    stream: Vec<u8>,
    inbox: VecDeque<Result<(Vec<u8>, SocketAddr), SocketError>>,
}

/// A message that got to a server.
#[derive(Clone)]
pub(crate) struct Sent {
    /// Index in [`World::opened`].
    pub(crate) socket: usize,
    pub(crate) bytes: Vec<u8>,
}

impl Sent {
    pub(crate) fn id(&self) -> u16 {
        u16::from_be_bytes([self.bytes[0], self.bytes[1]])
    }

    /// As in `example.com A`
    pub(crate) fn question(&self) -> String {
        let (mut rest, mut labels) = (&self.bytes[12..], Vec::new());
        while let [len @ 1..=255, after @ ..] = rest {
            let (label, after) = after.split_at(usize::from(*len));
            labels.push(show(label));
            rest = after;
        }
        let kind = RecordType::from_repr(u16::from_be_bytes([rest[1], rest[2]])).unwrap();
        format!("{} {kind:?}", labels.join("."))
    }
}

#[derive(Default)]
pub(crate) struct World {
    pub(crate) now: Duration,
    pub(crate) wall_clock: i64,
    /// Once they are used up, the numbers are odd and take long to repeat.
    pub(crate) randoms: VecDeque<u16>,
    last_random: u16,
    pub(crate) files: BTreeMap<Vec<u8>, (Option<Vec<u8>>, FileStamp)>,
    pub(crate) has_no_stamps: bool,
    pub(crate) hosts_reads: usize,
    pub(crate) resolv_conf_reads: usize,
    pub(crate) hostname: Option<&'static str>,
    /// An address that is not listed is unreachable.
    pub(crate) routes: BTreeMap<IpAddr, Route>,
    pub(crate) route_calls: usize,
    /// `connect` fails for these.
    pub(crate) unreachable: Vec<SocketAddr>,
    pub(crate) socket_limit: Option<usize>,
    pub(crate) connect_calls: usize,
    pub(crate) streams_take_time: bool,
    /// What the next calls of `send` return. `Ok` has the most that a stream takes.
    pub(crate) send_results: VecDeque<Result<usize, SocketError>>,
    pub(crate) send_calls: usize,
    pub(crate) opened: Vec<Opened>,
    closed: usize,
    free_ids: BTreeSet<SocketId>,
    sent: Vec<Sent>,
}

impl World {
    pub(crate) fn write(&mut self, path: &str, text: impl AsRef<[u8]>) {
        let stamp = FileStamp {
            modified: self.wall_clock,
            size: text.as_ref().len() as u64,
            inode: 1,
            device: 1,
        };
        let file = (Some(text.as_ref().to_vec()), stamp);
        self.files.insert(path.into(), file);
    }
}

pub(crate) struct Machine {
    world: Rc<RefCell<World>>,
    variables: Vec<(Variable, &'static str)>,
}

pub(crate) struct Handle {
    world: Rc<RefCell<World>>,
    index: usize,
    is_connecting: bool,
}

impl Socket for Handle {
    fn id(&self) -> SocketId {
        self.world.borrow().opened[self.index].id
    }

    fn is_connecting(&self) -> bool {
        self.is_connecting
    }

    fn send(&mut self, data: &[u8]) -> Result<usize, SocketError> {
        let (world, socket) = (&mut *self.world.borrow_mut(), self.index);
        world.send_calls += 1;
        let room = world.send_results.pop_front().unwrap_or(Ok(usize::MAX))?;
        let opened = &mut world.opened[socket];
        if opened.transport == Transport::Udp {
            let bytes = data.to_vec();
            world.sent.push(Sent { socket, bytes });
            return Ok(data.len());
        }
        let len = data.len().min(room);
        opened.stream.extend_from_slice(&data[..len]);
        while let [high, low, rest @ ..] = &opened.stream[..]
            && let Some(bytes) = rest.get(..usize::from(u16::from_be_bytes([*high, *low])))
        {
            let bytes = bytes.to_vec();
            opened.stream.drain(..2 + bytes.len());
            world.sent.push(Sent { socket, bytes });
        }
        Ok(len)
    }

    fn receive(&mut self, buffer: &mut Vec<u8>) -> Result<Option<SocketAddr>, SocketError> {
        let opened = &mut self.world.borrow_mut().opened[self.index];
        opened.receive_calls += 1;
        let next = opened.inbox.pop_front();
        let (mut bytes, sender) = next.unwrap_or(Err(SocketError::WouldBlock))?;
        let room = buffer.capacity() - buffer.len();
        if bytes.len() > room {
            assert_eq!(opened.transport, Transport::Tcp);
            opened.inbox.push_front(Ok((bytes.split_off(room), sender)));
        }
        buffer.extend_from_slice(&bytes);
        Ok((opened.transport == Transport::Udp).then_some(sender))
    }

    fn watch(&mut self, writable: bool) {
        let opened = &mut self.world.borrow_mut().opened[self.index];
        opened.watches.push(writable);
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        let world = &mut *self.world.borrow_mut();
        world.opened[self.index].is_open = false;
        world.closed += 1;
        world.free_ids.insert(world.opened[self.index].id);
    }
}

impl System for Machine {
    type Socket = Handle;

    fn now(&self) -> Duration {
        self.world.borrow().now
    }

    fn wall_clock(&self) -> i64 {
        self.world.borrow().wall_clock
    }

    fn random(&mut self) -> u16 {
        let world = &mut *self.world.borrow_mut();
        world.randoms.pop_front().unwrap_or_else(|| {
            world.last_random = world.last_random.wrapping_add(10) | 1;
            world.last_random
        })
    }

    fn connect(
        &mut self,
        transport: Transport,
        server: SocketAddr,
        local: Option<IpAddr>,
    ) -> Option<Handle> {
        let world = &mut *self.world.borrow_mut();
        world.connect_calls += 1;
        let open = world.opened.len() - world.closed;
        if world.unreachable.contains(&server) || world.socket_limit == Some(open) {
            return None;
        }
        let id = world.free_ids.pop_first().unwrap_or(3 + world.opened.len());
        world.opened.push(Opened {
            id,
            transport,
            server,
            local,
            is_open: true,
            watches: Vec::new(),
            receive_calls: 0,
            stream: Vec::new(),
            inbox: VecDeque::new(),
        });
        Some(Handle {
            world: Rc::clone(&self.world),
            index: world.opened.len() - 1,
            is_connecting: world.streams_take_time && transport == Transport::Tcp,
        })
    }

    fn route(&mut self, destination: IpAddr) -> Route {
        let world = &mut *self.world.borrow_mut();
        world.route_calls += 1;
        *world
            .routes
            .get(&destination)
            .unwrap_or(&Route::Unreachable)
    }

    fn read_file(&self, path: &[u8]) -> Option<Vec<u8>> {
        let world = &mut *self.world.borrow_mut();
        world.hosts_reads += usize::from(path == HOSTS.as_bytes());
        world.resolv_conf_reads += usize::from(path == RESOLV_CONF.as_bytes());
        world.files.get(path)?.0.clone()
    }

    fn stamp(&self, path: &ZStr) -> Option<FileStamp> {
        let world = self.world.borrow();
        let (_, stamp) = world.files.get(path.as_bytes())?;
        (!world.has_no_stamps).then_some(*stamp)
    }

    fn variable(&self, variable: Variable) -> Option<&[u8]> {
        let (_, value) = self.variables.iter().find(|(it, _)| *it == variable)?;
        Some(value.as_bytes())
    }

    fn hostname(&self) -> Option<Vec<u8>> {
        self.world.borrow().hostname.map(Into::into)
    }

    fn interface_index(&self, name: &[u8]) -> Option<u32> {
        (name == b"eth0").then_some(7)
    }

    fn service_name(&self, port: u16) -> Option<Box<[u8]>> {
        (port == 80).then(|| b"http"[..].into())
    }
}

pub(crate) fn show(bytes: &[u8]) -> String {
    bytes.escape_ascii().to_string()
}

fn show_name(name: Name<'_>) -> String {
    let mut text = b"left over".to_vec();
    name.write_to(&mut text);
    text.into_iter().map(char::from).collect()
}

fn show_record(record: Record<'_>) -> String {
    match record {
        Record::Address(Address { ip, ttl }) => format!("{ip}/{ttl}"),
        Record::Name(name) => show_name(name),
        Record::Mx {
            preference,
            exchange,
        } => format!("{preference} {}", show_name(exchange)),
        Record::Txt(strings) => format!("{:?}", strings.map(show).collect::<Vec<_>>()),
        Record::Srv {
            priority,
            weight,
            port,
            target,
        } => format!("{priority} {weight} {port} {}", show_name(target)),
        Record::Naptr {
            order,
            preference,
            flags,
            services,
            regexp,
            replacement,
        } => {
            let [flags, services, regexp] = [flags, services, regexp].map(show);
            let replacement = show_name(replacement);
            format!("{order} {preference} {flags} {services} {regexp} {replacement}")
        }
        Record::Soa {
            mname,
            rname,
            serial,
            refresh,
            retry,
            expire,
            minimum,
        } => {
            let [mname, rname] = [mname, rname].map(show_name);
            format!("{mname} {rname} {serial} {refresh} {retry} {expire} {minimum}")
        }
        Record::Caa { flags, tag, value } => format!("{flags} {} {}", show(tag), show(value)),
    }
}

fn show_records(records: &Records) -> Vec<String> {
    use RecordType::*;
    if records.asked() != ANY {
        return records.of(records.asked()).map(show_record).collect();
    }
    let kinds = [A, AAAA, CNAME, MX, NS, TXT, SRV, PTR, NAPTR, SOA, CAA];
    let of = |kind| records.of(kind).map(move |it| (kind, show_record(it)));
    let all = kinds.into_iter().flat_map(of);
    all.map(|(kind, it)| format!("{kind:?} {it}")).collect()
}

fn show_answer(answer: &Answer) -> String {
    let items = match answer {
        Err(error) => return format!("{error:?}"),
        Ok(Reply::Records(records)) => show_records(records),
        Ok(Reply::Addresses(all)) => {
            let all = all.iter();
            all.map(|it| format!("{}/{}", it.ip, it.ttl)).collect()
        }
        Ok(Reply::Names(names)) => names.iter().map(|name| show(name)).collect(),
        Ok(Reply::NameInfo { host, service }) => {
            vec![
                show(host),
                service.as_deref().map_or_else(|| "-".into(), show),
            ]
        }
    };
    items.join(", ")
}

#[derive(Default)]
pub(crate) struct Setup {
    pub(crate) world: World,
    pub(crate) variables: Vec<(Variable, &'static str)>,
    pub(crate) timeout_ms: Option<u64>,
    pub(crate) max_timeout_ms: Option<u64>,
    pub(crate) tries: Option<u32>,
}

impl Setup {
    pub(crate) fn file(mut self, path: &str, text: impl AsRef<[u8]>) -> Self {
        self.world.write(path, text);
        self
    }

    pub(crate) fn tries(mut self, tries: u32) -> Self {
        self.tries = Some(tries);
        self
    }

    pub(crate) fn timeout(mut self, ms: u64) -> Self {
        self.timeout_ms = Some(ms);
        self
    }

    pub(crate) fn start(mut self) -> Test {
        self.world.now = Duration::from_secs(1_000_000);
        self.world.wall_clock += 10;
        let world = Rc::new(RefCell::new(self.world));
        let machine = Machine {
            world: Rc::clone(&world),
            variables: self.variables,
        };
        let options = Options {
            timeout: self.timeout_ms.map(Duration::from_millis),
            max_timeout: self.max_timeout_ms.map(Duration::from_millis),
            tries: self.tries.unwrap_or(4),
        };
        Test {
            client: Client::new(machine, options),
            world,
            requests: 0,
        }
    }
}

pub(crate) fn resolv_conf(text: impl AsRef<[u8]>) -> Setup {
    Setup::default().file(RESOLV_CONF, text)
}

pub(crate) fn one_server() -> Setup {
    resolv_conf("nameserver 10.0.0.1")
}

pub(crate) fn two_servers() -> Setup {
    resolv_conf("nameserver 10.0.0.1\nnameserver 10.0.0.2")
}

pub(crate) const NOTHING: [&str; 0] = [];

/// Requests are numbered from 1.
pub(crate) struct Test {
    pub(crate) client: Client<Machine, usize>,
    world: Rc<RefCell<World>>,
    requests: usize,
}

/// Each as in `2: 10.0.0.1/60`, without the number for the first request.
pub(crate) fn shown(answers: &Answers<usize>) -> Vec<String> {
    let show = |(request, answer): &(usize, Answer)| match request {
        1 => show_answer(answer),
        _ => format!("{request}: {}", show_answer(answer)),
    };
    answers.iter().map(show).collect()
}

impl Test {
    pub(crate) fn world(&self) -> RefMut<'_, World> {
        self.world.borrow_mut()
    }

    fn next_request(&mut self) -> usize {
        self.requests += 1;
        self.requests
    }

    pub(crate) fn resolve(&mut self, kind: RecordType, name: impl AsRef<[u8]>) -> Vec<String> {
        let request = self.next_request();
        shown(&self.client.resolve(kind, name.as_ref(), request))
    }

    pub(crate) fn lookup(&mut self, host: &str, family: Family) -> Vec<String> {
        let request = self.next_request();
        shown(&self.client.lookup(host.as_bytes(), family, request))
    }

    pub(crate) fn reverse(&mut self, ip: &str) -> Vec<String> {
        let request = self.next_request();
        shown(&self.client.reverse(ip.parse().unwrap(), request))
    }

    pub(crate) fn name_info(&mut self, ip: &str, port: u16) -> Vec<String> {
        let request = self.next_request();
        shown(&self.client.name_info(ip.parse().unwrap(), port, request))
    }

    pub(crate) fn set_servers(&mut self, servers: &[&str]) -> Vec<String> {
        let servers = servers.iter().map(|it| it.parse::<SocketAddr>().unwrap());
        let servers: Vec<_> = servers.map(|it| (it.ip(), it.port())).collect();
        shown(&self.client.set_servers(&servers))
    }

    pub(crate) fn servers(&self) -> Vec<String> {
        self.client.servers().map(|it| it.to_string()).collect()
    }

    /// What got to a server since the last call.
    pub(crate) fn sent(&self) -> Vec<Sent> {
        core::mem::take(&mut self.world().sent)
    }

    pub(crate) fn sent_one(&self) -> Sent {
        let [sent] = self.sent_exactly();
        sent
    }

    pub(crate) fn sent_exactly<const N: usize>(&self) -> [Sent; N] {
        let sent = self.sent().try_into();
        sent.unwrap_or_else(|sent: Vec<_>| panic!("{} were sent", sent.len()))
    }

    /// Asks for the addresses of `name`, and returns the query.
    pub(crate) fn ask(&mut self, name: &str) -> Sent {
        assert_eq!(self.resolve(RecordType::A, name), NOTHING);
        self.sent_one()
    }

    /// Asks for the addresses of `count` names, and waits until all queries are out.
    pub(crate) fn ask_many(&mut self, domain: &str, count: usize) -> Vec<Sent> {
        for index in 0..count {
            let answers = self.resolve(RecordType::A, format!("{index}.{domain}"));
            assert_eq!(answers, NOTHING);
        }
        let mut sent = self.sent();
        while sent.len() < count {
            assert_eq!(self.wait(2), NOTHING);
            sent.extend(self.sent());
        }
        sent
    }

    /// Three answers, each after `ms`.
    pub(crate) fn warm_up(&mut self, ms: u64) {
        for _ in 0..3 {
            let query = self.ask("warm.test");
            self.world().now += Duration::from_millis(ms);
            assert_eq!(self.decline(&query, 0).len(), 1);
        }
    }

    pub(crate) fn server_of(&self, sent: &Sent) -> String {
        self.world().opened[sent.socket].server.to_string()
    }

    pub(crate) fn transport_of(&self, sent: &Sent) -> Transport {
        self.world().opened[sent.socket].transport
    }

    pub(crate) fn open_sockets(&self) -> usize {
        self.world().opened.iter().filter(|it| it.is_open).count()
    }

    pub(crate) fn process(&mut self, socket: usize, readable: bool, writable: bool) -> Vec<String> {
        let id = self.world().opened[socket].id;
        let events = Events {
            readable,
            writable,
            failed: false,
        };
        shown(&self.client.process(id, events))
    }

    pub(crate) fn process_error(&mut self, socket: usize) -> Vec<String> {
        let id = self.world().opened[socket].id;
        let events = Events {
            readable: true,
            writable: false,
            failed: true,
        };
        shown(&self.client.process(id, events))
    }

    pub(crate) fn arrive_from(&self, socket: usize, bytes: &[u8], sender: &str) {
        let inbox = &mut self.world().opened[socket].inbox;
        inbox.push_back(Ok((bytes.to_vec(), sender.parse().unwrap())));
    }

    pub(crate) fn arrive(&self, socket: usize, bytes: &[u8]) {
        let opened = &mut self.world().opened[socket];
        opened.inbox.push_back(Ok((bytes.to_vec(), opened.server)));
    }

    pub(crate) fn break_socket(&self, socket: usize) {
        let inbox = &mut self.world().opened[socket].inbox;
        inbox.push_back(Err(SocketError::Failed));
    }

    /// `message` comes in where `to` went out.
    pub(crate) fn deliver(&mut self, to: &Sent, message: &[u8]) -> Vec<String> {
        match self.transport_of(to) {
            Transport::Udp => self.arrive(to.socket, message),
            Transport::Tcp => self.arrive(to.socket, &wire::frame(message)),
        }
        self.process(to.socket, true, false)
    }

    pub(crate) fn answer(&mut self, to: &Sent, answers: &[Vec<u8>]) -> Vec<String> {
        self.deliver(to, &wire::reply(&to.bytes, 0, [answers, &[], &[]]))
    }

    /// With nothing but `flags`.
    pub(crate) fn decline(&mut self, to: &Sent, flags: u16) -> Vec<String> {
        self.deliver(to, &wire::reply(&to.bytes, flags, [&[], &[], &[]]))
    }

    pub(crate) fn wait(&mut self, ms: u64) -> Vec<String> {
        let mut answers = self.tick(ms);
        // Any event ends what has timed out.
        answers.extend(shown(
            &self.client.process(SocketId::MAX, Events::default()),
        ));
        answers
    }

    /// The timer fires.
    pub(crate) fn tick(&mut self, ms: u64) -> Vec<String> {
        self.world().now += Duration::from_millis(ms);
        shown(&self.client.process_timeouts())
    }

    pub(crate) fn ms_to_next_check(&self) -> u128 {
        (self.client.next_check().unwrap() - self.world().now).as_millis()
    }

    /// Returns how long it took for the next message or answer to come out.
    pub(crate) fn wait_for_timeout(&mut self) -> u64 {
        let happens = |_: &u64| !self.wait(1).is_empty() || !self.sent().is_empty();
        (1..).find(happens).unwrap()
    }

    pub(crate) fn is_idle(&self) -> bool {
        let is_idle = self.client.next_check().is_none();
        assert_eq!(is_idle, self.open_sockets() == 0);
        is_idle
    }
}
