//! Getting a question to a server and the reply back.

use core::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use core::time::Duration;
use std::collections::BTreeMap;

use bun_collections::index_sort;
use hashbrown::hash_map::Entry;
use hashbrown::{HashTable, hash_table};

use crate::client::{Client, Outcome, Purpose, Step};
use crate::message::{self, Message, Question, Received};
use crate::servers::{Server, ServerId};
use crate::system::{Events, Socket, SocketError, SocketId, System, Transport};
use crate::{Error, HashMap};

pub(crate) const MIN_TIMEOUT: Duration = Duration::from_millis(250);
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_ESTIMATED_TIMEOUT: Duration = Duration::from_secs(5);
const TIMEOUT_PER_LATENCY: u64 = 5;
/// The end of an estimated timeout can wait for it.
const CHECK_INTERVAL: Duration = Duration::from_secs(1);
/// One new query in this many is also sent to a server that failed.
const PROBE_ODDS: u16 = 10;
/// The replies fit in the receive buffer.
const TRIES_PER_UDP_SOCKET: usize = 64;
/// For how long one takes new tries.
const UDP_SOCKET_LIFETIME: Duration = Duration::from_secs(1);
/// From there on, a socket takes more tries than it has room for.
const MANY_SOCKETS: usize = 256;
/// From there on, it does so at any age.
const TOO_MANY_SOCKETS: usize = 2 * MANY_SOCKETS;
/// Half of the ids.
const MAX_TRIES_PER_SOCKET: usize = 1 << 15;
/// Messages that answer nothing, after which the event loop gets its turn.
const MAX_STRAYS_PER_READ: usize = 64;
const MAX_FRAME_LEN: usize = 2 + u16::MAX as usize;
/// A stream that is so far behind takes no more than it has room for.
const LONG_OUTPUT_LEN: usize = 256 * MAX_TRIES_PER_SOCKET;

type MessageId = u16;

/// A question that has no reply yet. Between calls, it has one [`Try`].
pub(crate) struct Query<R> {
    question: Question,
    waiting: Vec<Purpose<R>>,
    transport: Transport,
    failed_tries: usize,
    last_error: Error,
}

pub(crate) type Queries<R> = HashTable<Query<R>>;

fn find<'a, R>(queries: &'a mut Queries<R>, question: &Question) -> Option<&'a mut Query<R>> {
    queries.find_mut(question.hash, |query| query.question.is(question))
}

/// A message that was sent.
struct Try {
    /// That of a probe belongs to no [`Query`].
    question: Question,
    sent: Duration,
    deadline: Deadline,
}

/// Orders tries by age.
type TryNumber = u64;

type Deadline = (Duration, TryNumber);

struct Connection<T> {
    socket: T,
    transport: Transport,
    server: ServerId,
    peer: SocketAddr,
    is_connecting: bool,
    /// `None` until it is watched.
    watches_writable: Option<bool>,
    tries: HashMap<MessageId, Try>,
    /// How many more it should take.
    room: usize,
    /// What it gets when it is renewed.
    next_room: usize,
    /// Or renewed.
    opened: Duration,
    /// What a stream has yet to take.
    output: Vec<u8>,
    /// The datagrams of the tries that the system had no room for.
    unsent: BTreeMap<TryNumber, Vec<u8>>,
    /// Since the last flush.
    was_written: bool,
    /// The start of a frame.
    input: Vec<u8>,
}

struct Failed;

/// `None` if there is no room.
fn send(socket: &mut impl Socket, data: &[u8]) -> Result<Option<usize>, Failed> {
    match socket.send(data) {
        Err(SocketError::Failed) => Err(Failed),
        sent => Ok(sent.ok()),
    }
}

impl<T: Socket> Connection<T> {
    fn open(
        system: &mut impl System<Socket = T>,
        transport: Transport,
        server: &Server,
        local: Option<IpAddr>,
        now: Duration,
    ) -> Option<Self> {
        let mut peer = server.address;
        match peer.ip() {
            ip if !ip.is_unspecified() => {}
            IpAddr::V4(_) => peer.set_ip(Ipv4Addr::LOCALHOST.into()),
            IpAddr::V6(_) => peer.set_ip(Ipv6Addr::LOCALHOST.into()),
        }
        let socket = system.connect(transport, peer, local)?;
        Some(Self {
            is_connecting: socket.is_connecting(),
            socket,
            transport,
            server: server.id,
            peer,
            watches_writable: None,
            tries: HashMap::default(),
            room: match transport {
                Transport::Udp => TRIES_PER_UDP_SOCKET,
                Transport::Tcp => MAX_TRIES_PER_SOCKET,
            },
            next_room: TRIES_PER_UDP_SOCKET,
            opened: now,
            output: Vec::new(),
            unsent: BTreeMap::new(),
            was_written: false,
            input: Vec::new(),
        })
    }

    fn is_old(&self, now: Duration) -> bool {
        self.transport == Transport::Udp && now.saturating_sub(self.opened) >= UDP_SOCKET_LIFETIME
    }

    fn can_take_more(&self) -> bool {
        self.tries.len() < MAX_TRIES_PER_SOCKET && self.output.len() < LONG_OUTPUT_LEN
    }

    /// In place of a new one, which there is not. Finding that out can take long.
    fn renew(&mut self, now: Duration) {
        if self.transport == Transport::Udp {
            self.room = self.next_room.min(MAX_TRIES_PER_SOCKET - self.tries.len());
            self.next_room = self.next_room.saturating_mul(2);
            self.opened = now;
        }
    }

    fn write(
        &mut self,
        question: &Question,
        id: MessageId,
        number: TryNumber,
    ) -> Result<(), Failed> {
        let has_to_wait = self.is_connecting || !self.output.is_empty();
        question.write_query(id, self.transport, &mut self.output);
        match self.transport {
            Transport::Udp => {
                self.was_written = true;
                if send(&mut self.socket, &self.output)?.is_none() {
                    self.unsent.insert(number, self.output.clone());
                }
                self.output.clear();
            }
            Transport::Tcp if has_to_wait => {}
            Transport::Tcp => return self.flush(),
        }
        self.watch();
        Ok(())
    }

    fn flush(&mut self) -> Result<(), Failed> {
        self.is_connecting = false;
        if !self.output.is_empty() {
            let sent = send(&mut self.socket, &self.output)?.unwrap_or(0);
            self.output.drain(..sent.min(self.output.len()));
        }
        // What was reported may be out of date.
        let mut can_wait = core::mem::take(&mut self.was_written);
        while let Some(datagram) = self.unsent.first_entry() {
            match send(&mut self.socket, datagram.get())? {
                Some(_) => can_wait = true,
                None if can_wait => break,
                // It has waited in vain, and is as good as lost on the way.
                None => {}
            }
            datagram.remove();
        }
        self.watch();
        Ok(())
    }

    fn watch(&mut self) {
        let writable = !self.output.is_empty() || !self.unsent.is_empty();
        if self.watches_writable.replace(writable) != Some(writable) {
            self.socket.watch(writable);
        }
    }
}

pub(crate) struct Connections<T> {
    open: HashMap<SocketId, Connection<T>>,
    deadlines: BTreeMap<Deadline, (SocketId, MessageId)>,
    /// Those that may have been left without a try during this call.
    idle: Vec<SocketId>,
    last_try: TryNumber,
}

impl<T> Default for Connections<T> {
    fn default() -> Self {
        Self {
            open: HashMap::default(),
            deadlines: BTreeMap::new(),
            idle: Vec::new(),
            last_try: 0,
        }
    }
}

impl<T> Connections<T> {
    /// Returns what was asked, oldest first.
    fn close(&mut self, connections: impl IntoIterator<Item = Connection<T>>) -> Vec<Try> {
        let tries = connections.into_iter().map(|it| it.tries.into_values());
        let mut tries: Vec<Try> = tries.flatten().collect();
        for it in &tries {
            self.deadlines.remove(&it.deadline);
        }
        index_sort::sort_slice_unstable_by_key(&mut tries, |it| it.deadline.1);
        tries
    }
}

impl<S: System, R> Client<S, R> {
    /// When to call [`process_timeouts`](Self::process_timeouts), counted from the last call. A timer that is set can stay as it is.
    pub fn next_check(&self) -> Option<Duration> {
        let (&(first, _), _) = self.connections.deadlines.first_key_value()?;
        let on_time = |timeout: Duration| timeout.min(first.saturating_sub(self.now));
        let check = self.config.timeout.map_or(CHECK_INTERVAL, on_time);
        Some(check.min(CHECK_INTERVAL).min(self.max_timeout))
    }

    pub(crate) fn join_or_send(&mut self, question: Question, purpose: Purpose<R>) {
        // One that has failed waits longer and gives up sooner.
        let matches =
            |query: &Query<R>| query.failed_tries == 0 && query.question.matches(question.bytes());
        let hash = |query: &Query<R>| query.question.hash;
        match self.queries.entry(question.hash, matches, hash) {
            hash_table::Entry::Occupied(mut entry) => return entry.get_mut().waiting.push(purpose),
            hash_table::Entry::Vacant(entry) => entry.insert(Query {
                question: question.clone(),
                waiting: vec![purpose],
                transport: self.config.transport,
                failed_tries: 0,
                last_error: Error::ETIMEOUT,
            }),
        };
        if self.servers.any_failed() && self.system.random().is_multiple_of(PROBE_ODDS) {
            self.probe(&question);
        }
        self.send(question, None);
    }

    fn probe(&mut self, question: &Question) {
        let server = self.servers.next_to_probe(self.now);
        let probe = server.map(|server| Step::Send(question.detached(), Some(server)));
        self.steps.extend(probe);
    }

    /// To the best server, unless there is one to probe.
    pub(crate) fn send(&mut self, question: Question, probed: Option<ServerId>) {
        let (transport, failed_tries) = match (find(&mut self.queries, &question), probed) {
            (Some(query), _) => (query.transport, query.failed_tries),
            (None, Some(_)) => (self.config.transport, 0),
            (None, None) => return,
        };
        let rounds = failed_tries / self.servers.len().max(1);
        let server = match probed {
            Some(server) => self.servers.get(server),
            None if self.config.rotate => self.servers.one_of_the_best(self.system.random()),
            None => self.servers.best(),
        };
        let Some(server) = server else {
            let end = Step::End(question, Err(Error::ENOSERVER));
            return self.steps.push_back(end);
        };

        let open = &mut self.connections.open;
        let [has_many, has_too_many] = [MANY_SOCKETS, TOO_MANY_SOCKETS].map(|it| open.len() >= it);
        let last = match server.socket(transport).map(|socket| open.entry(socket)) {
            Some(Entry::Occupied(last)) => Some(last),
            _ => None,
        };
        let last =
            last.filter(|it| (it.get().server, it.get().transport) == (server.id, transport));
        let should_take_more = |it: &Connection<_>| {
            (it.room > 0 || (has_many && it.can_take_more()))
                && (has_too_many || !it.is_old(self.now))
        };
        let mut entry = match last {
            Some(last) if should_take_more(last.get()) => last,
            last => {
                let local = match server.address {
                    SocketAddr::V4(_) => self.local_v4.map(IpAddr::V4),
                    SocketAddr::V6(_) => self.local_v6.map(IpAddr::V6),
                };
                let new = Connection::open(&mut self.system, transport, server, local, self.now);
                match (new, last) {
                    (Some(new), _) => open.entry(new.socket.id()).insert(new),
                    (None, Some(mut last)) if last.get().can_take_more() => {
                        last.get_mut().renew(self.now);
                        last
                    }
                    (None, _) => {
                        let server = server.id;
                        self.servers.failed(server, self.now);
                        return self.retry_later(question, Error::ECONNREFUSED);
                    }
                }
            }
        };
        let (socket, connection) = (*entry.key(), entry.get_mut());

        let id = loop {
            let id = self.system.random();
            if !connection.tries.contains_key(&id) {
                break id;
            }
        };
        self.connections.last_try += 1;
        let number = self.connections.last_try;
        if connection.write(&question, id, number).is_err() {
            let connection = entry.remove();
            self.fail(connection);
            return self.retry_later(question, Error::ECONNREFUSED);
        }
        connection.room = connection.room.saturating_sub(1);
        *server.socket(transport) = Some(socket);

        let timeout = match (self.config.timeout, probed) {
            (Some(timeout), None) => timeout,
            (timeout, _) => (server.latency.average_ms(self.now))
                .map(|ms| Duration::from_millis(ms.saturating_mul(TIMEOUT_PER_LATENCY)))
                .or(timeout)
                .unwrap_or(DEFAULT_TIMEOUT)
                .clamp(MIN_TIMEOUT, MAX_ESTIMATED_TIMEOUT),
        };
        let timeout = back_off(timeout, self.max_timeout, rounds, &mut self.system);
        let deadline = (self.now.saturating_add(timeout), number);
        self.connections.deadlines.insert(deadline, (socket, id));
        let new = Try {
            question,
            sent: self.now,
            deadline,
        };
        connection.tries.insert(id, new);
    }

    pub(crate) fn end(&mut self, question: &Question, outcome: &Outcome) {
        let is_it = |query: &Query<R>| query.question.is(question);
        let Ok(entry) = self.queries.find_entry(question.hash, is_it) else {
            return;
        };
        let (query, _) = entry.remove();
        if let Ok(message) = outcome {
            self.cache.insert(question, message, self.now);
        }
        for purpose in query.waiting {
            self.finish(purpose, outcome.clone());
        }
    }

    fn retry_later(&mut self, question: Question, error: Error) {
        self.steps.push_back(Step::Retry(question, Some(error)));
    }

    pub(crate) fn retry(&mut self, question: Question, error: Option<Error>) {
        let Some(query) = find(&mut self.queries, &question) else {
            return;
        };
        let error = error.unwrap_or(query.last_error);
        query.last_error = error;
        query.failed_tries += 1;
        let have_enough = query.waiting.extract_if(
            ..,
            |purpose| matches!(purpose, Purpose::Addresses(lookup, _) if lookup.has_ipv4()),
        );
        self.steps
            .extend(have_enough.map(|purpose| Step::Finish(purpose, Err(error))));
        if !query.waiting.is_empty() && query.failed_tries < self.servers.len() * self.tries {
            if self.servers.all_failed() {
                self.probe(&question);
            }
            self.send(question, None);
        } else {
            self.end(&question, &Err(error));
        }
    }

    fn fail(&mut self, connection: Connection<S::Socket>) {
        self.servers.failed(connection.server, self.now);
        for it in self.connections.close([connection]) {
            self.retry_later(it.question, Error::ECONNREFUSED);
        }
    }

    pub(crate) fn leave_removed_servers(&mut self) {
        let open = &mut self.connections.open;
        let left = open.extract_if(|_, connection| self.servers.get(connection.server).is_none());
        let left: Vec<_> = left.map(|(_, connection)| connection).collect();
        for it in self.connections.close(left) {
            self.steps.push_back(Step::Retry(it.question, None));
        }
    }

    pub(crate) fn fail_all(&mut self, error: Error) {
        let open = core::mem::take(&mut self.connections.open);
        for it in self.connections.close(open.into_values()) {
            self.steps.push_back(Step::End(it.question, Err(error)));
        }
    }

    pub(crate) fn close_idle(&mut self) {
        for socket in self.connections.idle.drain(..) {
            if let Entry::Occupied(entry) = self.connections.open.entry(socket)
                && entry.get().tries.is_empty()
            {
                entry.remove();
            }
        }
    }

    pub(crate) fn time_out(&mut self) {
        // Replies may be waiting for their turn in the event loop.
        let due = self.connections.deadlines.range(..=(self.now, u64::MAX));
        let mut sockets: Vec<SocketId> = due.map(|(_, &(socket, _))| socket).collect();
        if sockets.is_empty() {
            return;
        }
        index_sort::sort_slice_unstable(&mut sockets);
        sockets.dedup();
        for socket in sockets {
            let events = Events {
                readable: true,
                ..Events::default()
            };
            self.read_and_write(socket, events);
        }
        while let Some(first) = self.connections.deadlines.first_entry()
            && first.key().0 <= self.now
        {
            let ((_, number), (socket, id)) = first.remove_entry();
            let entry = self.connections.open.entry(socket);
            entry.and_modify(|connection| {
                connection.room = 0;
                connection.unsent.remove(&number);
                self.servers.failed(connection.server, self.now);
                let late = connection.tries.remove(&id);
                let retry = late.map(|it| Step::Retry(it.question, Some(Error::ETIMEOUT)));
                self.steps.extend(retry);
            });
        }
        // They make way for those of the retries.
        self.close_idle();
    }

    pub(crate) fn read_and_write(&mut self, socket: SocketId, events: Events) {
        let Some(mut connection) = self.connections.open.remove(&socket) else {
            return;
        };
        if (events.readable && self.read(&mut connection).is_err())
            || (events.writable && connection.flush().is_err())
            || (events.failed && !connection.tries.is_empty())
        {
            return self.fail(connection);
        }
        if !events.failed {
            self.connections.idle.push(socket);
            self.connections.open.insert(socket, connection);
        }
    }

    fn read(&mut self, connection: &mut Connection<S::Socket>) -> Result<(), Failed> {
        let mut buffer = core::mem::take(&mut connection.input);
        let mut strays = 0;
        while strays < MAX_STRAYS_PER_READ
            && !connection.tries.is_empty()
            && !connection.is_connecting
        {
            buffer.reserve(MAX_FRAME_LEN);
            let sender = match connection.socket.receive(&mut buffer) {
                Ok(sender) => sender,
                Err(SocketError::WouldBlock) => break,
                Err(SocketError::Failed) => return Err(Failed),
            };
            if connection.transport == Transport::Udp {
                let (ip, port) = (connection.peer.ip(), connection.peer.port());
                let is_from_peer = sender.is_some_and(|it| (it.ip(), it.port()) == (ip, port));
                strays += usize::from(!is_from_peer || !self.receive(connection, &buffer));
                buffer.clear();
                continue;
            }
            let is_drained = buffer.len() < buffer.capacity();
            let mut rest = &*buffer;
            while let Some(message) = message::take_frame(&mut rest) {
                strays += usize::from(!self.receive(connection, message));
            }
            buffer.drain(..buffer.len() - rest.len());
            if is_drained {
                break;
            }
        }
        if !buffer.is_empty() {
            connection.input = buffer;
        }
        Ok(())
    }

    /// Returns whether `bytes` were the reply to a try.
    fn receive(&mut self, connection: &mut Connection<S::Socket>, bytes: &[u8]) -> bool {
        let entry = message::id_of(bytes).map(|id| connection.tries.entry(id));
        let Some(Entry::Occupied(entry)) = entry else {
            return false;
        };
        let is_final = connection.transport == Transport::Tcp;
        let Some(received) = Message::receive(bytes, &entry.get().question, is_final) else {
            return false;
        };
        let Try {
            question,
            sent,
            deadline,
        } = entry.remove();
        connection.unsent.remove(&deadline.1);
        self.connections.deadlines.remove(&deadline);
        match received {
            Received::Reply(message) => {
                let took = message.is_resolved().then(|| self.now.saturating_sub(sent));
                self.servers.answered(connection.server, took, self.now);
                self.steps.push_back(Step::End(question, Ok(message)));
            }
            Received::Truncated => {
                if let Some(query) = find(&mut self.queries, &question) {
                    query.transport = Transport::Tcp;
                }
                self.steps.push_back(Step::Send(question, None));
            }
            Received::Malformed => {
                self.servers.failed(connection.server, self.now);
                self.retry_later(question, Error::EBADRESP);
            }
        }
        true
    }
}

/// `rounds` is how many times all servers have been tried.
fn back_off(timeout: Duration, max: Duration, rounds: usize, system: &mut impl System) -> Duration {
    let timeout = timeout.min(max);
    if rounds == 0 {
        return timeout;
    }
    let doubled = (timeout.as_millis() as u64).saturating_mul(2u64.saturating_pow(rounds as u32));
    let doubled = Duration::from_millis(doubled).min(max).as_millis() as u64;
    let jitter = f32::from(system.random()) / f32::from(u16::MAX) * 0.5;
    timeout.max(Duration::from_millis(
        doubled - (doubled as f32 * jitter) as u64,
    ))
}
