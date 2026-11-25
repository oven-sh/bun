//! Getting a question to a server and the reply back.

use core::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use core::time::Duration;
use std::collections::{BTreeMap, VecDeque};

use bun_collections::{DynamicBitSet, index_sort};
use bun_core::UnwrapOrOom;
use hashbrown::hash_map::Entry;
use hashbrown::{HashTable, hash_table};

use crate::client::{Client, Outcome, Purpose, Step};
use crate::message::{self, Message, Question, Received, RecordType};
use crate::servers::{Server, ServerId, ServerSet, Substitute};
use crate::system::{Events, Socket, SocketError, SocketId, System, Transport};
use crate::{Error, HashMap, HashSet};

pub(crate) const MIN_TIMEOUT: Duration = Duration::from_millis(250);
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(2);
/// Of the first round, unless another limit was asked for.
const MAX_TIMEOUT: Duration = Duration::from_secs(5);
/// Of the last try, likewise.
const MAX_LAST_TIMEOUT: Duration = Duration::from_secs(30);
const TIMEOUT_PER_LATENCY: u32 = 5;
/// The end of a timeout can wait for it.
const CHECK_INTERVAL: Duration = Duration::from_secs(1);
/// After which a datagram is sent again for one more that waits for the reply. It doubles.
const REPEAT_DELAY: Duration = Duration::from_millis(10);
/// In a row and for each server, whatever the number of tries.
const MAX_FAILURES_BEFORE_TIMEOUT: usize = 64;
/// Through the servers, once one has made an excuse. `RES_DFLRETRY`
const ROUNDS_AFTER_EXCUSE: usize = 2;
/// One new query in this many is also sent to a server that failed.
const PROBE_ODDS: u16 = 10;
/// Replies that have not come after one do not all come at once.
const PAUSE: Duration = Duration::from_millis(2);
/// Room that is added after each such time while queries are held back, whether or not replies come.
const GROWTH: usize = 8;
/// dnsmasq and CoreDNS refuse what is over their limit of queries at a time, which is higher.
const CROWD: usize = 64;
/// For how long a server that refused without one is taken at its word, from the last refusal on.
const REFUSAL_MEMORY: Duration = Duration::from_secs(60);
/// In a row. Fewer may be about the names.
const MANY_REFUSALS: usize = 6;
/// For how long only replies make room then.
const LONG_PAUSE: Duration = Duration::from_millis(100);
/// After which a query is sent whether or not there is room for the reply.
const MAX_HOLD: Duration = Duration::from_secs(2);
/// From there on, a socket that is retired takes more tries.
const MANY_SOCKETS: usize = 256;
/// Half of the ids.
const MAX_TRIES_PER_SOCKET: usize = 1 << 15;
/// Messages that answer nothing, after which the event loop gets its turn. Replies can be behind a full buffer of copies.
const MAX_STRAYS_PER_READ: usize = 4096;
/// Datagrams that are not accounted for, after which a socket counts as broken.
const SPARE_STRAYS: usize = 32;
const MAX_FRAME_LEN: usize = 2 + u16::MAX as usize;
/// A stream that is so far behind takes no more.
const LONG_OUTPUT_LEN: usize = 256 * MAX_TRIES_PER_SOCKET;

type MessageId = u16;

/// Where a [`Try`] is, if it still is.
type Place = (SocketId, MessageId);

/// A question that has no reply yet. Between calls, it has one [`Try`] that is not late, or is held back.
pub(crate) struct Query<R> {
    question: Question,
    waiting: Vec<Purpose<R>>,
    transport: Transport,
    last_try: Option<Place>,
    /// At most one for each stream.
    late_tries: Vec<Place>,
    /// What a try that is held back would have had. The replies to those before it tend to be the fast ones.
    least_timeout: Duration,
    failed_tries: usize,
    failures_since_timeout: usize,
    /// Since then. A socket that fails counts once for all its tries, unlike a timeout.
    avoided: ServerSet,
    /// Those that replied with [`Message::excuse`].
    excused: ServerSet,
    /// How often it went on after one.
    excuses: usize,
    last_error: Error,
}

impl<R> Query<R> {
    /// Those for which a try that failed is as far as it goes.
    fn let_go(&mut self, error: Error) -> impl Iterator<Item = Step<R>> {
        let have_enough = self.waiting.extract_if(.., move |purpose| match purpose {
            Purpose::Addresses(lookup, RecordType::AAAA) => lookup.can_do_without_ipv6(error),
            _ => false,
        });
        have_enough.map(move |purpose| Step::Finish(purpose, Err(error)))
    }
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
    repeat_at: Duration,
    is_in_crowd: bool,
    deadline: Deadline,
    state: State,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    /// It goes into overtime if that ends after the deadline.
    OnTime { overtime_until: Duration },
    /// It has timed out, and no try is left.
    Overtime,
    /// It has timed out on a stream, which loses nothing. The reply still counts.
    Late,
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
    /// It follows one that failed, and has had no reply.
    is_second_chance: bool,
    /// `None` until it is watched.
    watches_writable: Option<bool>,
    tries: HashMap<MessageId, Try>,
    /// Those of the datagrams whose replies are yet to come, for nobody.
    forgotten: HashSet<MessageId>,
    /// It should take no more tries.
    is_retired: bool,
    /// A timeout of this try, or of an older one, does not tell against it.
    cleared_up_to: TryNumber,
    /// For how many more replies the receive buffer has it.
    room: usize,
    /// The last reply, the last time `room` was filled up, or the end of a long pause.
    quiet_since: Duration,
    strays_left: usize,
    refusals_in_a_row: usize,
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

const READABLE: Events = Events {
    readable: true,
    writable: false,
    failed: false,
};

/// `None` if there is no room.
fn send(socket: &mut impl Socket, data: &[u8]) -> Result<Option<usize>, Failed> {
    match socket.send(data) {
        Err(SocketError::Failed) => Err(Failed),
        sent => Ok(sent.ok()),
    }
}

impl<T: Socket> Connection<T> {
    fn open<S: System<Socket = T>>(
        system: &mut S,
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
            is_second_chance: server.last_error == Some(Error::ECONNREFUSED),
            socket,
            transport,
            server: server.id,
            peer,
            watches_writable: None,
            tries: HashMap::default(),
            forgotten: HashSet::default(),
            is_retired: false,
            cleared_up_to: 0,
            room: S::DATAGRAMS_HELD,
            quiet_since: now,
            strays_left: SPARE_STRAYS,
            refusals_in_a_row: 0,
            output: Vec::new(),
            unsent: BTreeMap::new(),
            was_written: false,
            input: Vec::new(),
        })
    }

    fn can_take_more(&self) -> bool {
        self.tries.len() + self.forgotten.len() < MAX_TRIES_PER_SOCKET
            && self.output.len() < LONG_OUTPUT_LEN
    }

    /// In place of a new one, which there is not. Finding that out can take long.
    fn renew(&mut self, last_try: TryNumber) {
        if self.transport == Transport::Udp {
            self.is_retired = false;
            self.cleared_up_to = last_try;
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
                self.room = self.room.saturating_sub(1);
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

/// Those of the last tries that ended. Replies can be late, and some networks repeat them.
#[derive(Default)]
struct RecentIds {
    newer: DynamicBitSet,
    older: DynamicBitSet,
    count: usize,
}

impl RecentIds {
    const GENERATION_LEN: usize = 1 << 13;

    fn insert(&mut self, id: MessageId) {
        if self.count.is_multiple_of(Self::GENERATION_LEN) {
            let empty = DynamicBitSet::init_empty(1 << MessageId::BITS).unwrap_or_oom();
            self.older = core::mem::replace(&mut self.newer, empty);
        }
        self.count += 1;
        self.newer.set(id.into());
    }

    fn contains(&self, id: MessageId) -> bool {
        let has_it = |ids: &DynamicBitSet| ids.is_set_allow_out_of_bound(id.into(), false);
        has_it(&self.newer) || has_it(&self.older)
    }
}

pub(crate) struct Connections<T> {
    open: HashMap<SocketId, Connection<T>>,
    deadlines: BTreeMap<Deadline, Place>,
    /// Those that may have been left without a try during this call.
    idle: Vec<SocketId>,
    last_try: TryNumber,
    recent_ids: RecentIds,
    /// The queries for which there was no room, and until when they wait for it.
    held_back: VecDeque<(Question, Duration)>,
    /// The last one that had none.
    full: SocketId,
    /// When the timer is to go through the deadlines. It runs more often while queries are held back.
    check_at: Duration,
}

impl<T> Default for Connections<T> {
    fn default() -> Self {
        Self {
            open: HashMap::default(),
            deadlines: BTreeMap::new(),
            idle: Vec::new(),
            last_try: 0,
            recent_ids: RecentIds::default(),
            held_back: VecDeque::new(),
            full: 0,
            check_at: Duration::ZERO,
        }
    }
}

impl<T> Connections<T> {
    /// Returns what has to be asked elsewhere, oldest first.
    fn close(&mut self, connections: impl IntoIterator<Item = Connection<T>>) -> Vec<Try> {
        let tries = connections.into_iter().map(|it| it.tries.into_values());
        let mut tries: Vec<Try> = tries
            .flatten()
            .filter(|it| it.state != State::Late)
            .collect();
        for it in &tries {
            self.deadlines.remove(&it.deadline);
        }
        index_sort::sort_slice_unstable_by_key(&mut tries, |it| it.deadline.1);
        tries
    }

    fn stream(&mut self, socket: Option<SocketId>, to: ServerId) -> Option<&mut Connection<T>> {
        let connection = self.open.get_mut(&socket?)?;
        ((connection.server, connection.transport) == (to, Transport::Tcp)).then_some(connection)
    }

    fn forget(&mut self, question: &Question, places: &[Place]) {
        for &(socket, id) in places {
            if let Some(connection) = self.open.get_mut(&socket)
                && let Entry::Occupied(entry) = connection.tries.entry(id)
                && entry.get().question.is(question)
            {
                let deadline = entry.remove().deadline;
                self.deadlines.remove(&deadline);
                connection.unsent.remove(&deadline.1);
                if connection.transport == Transport::Udp {
                    connection.forgotten.insert(id);
                }
                self.recent_ids.insert(id);
                self.idle.push(socket);
            }
        }
    }
}

impl<S: System, R> Client<S, R> {
    /// When to call [`process_timeouts`](Self::process_timeouts), by the clock of [`System::now`]. A timer can stay as it is unless it was set for later.
    pub fn next_check(&self) -> Option<Duration> {
        if !self.connections.held_back.is_empty() {
            return Some(self.now.saturating_add(PAUSE));
        }
        (!self.connections.deadlines.is_empty()).then_some(self.connections.check_at)
    }

    fn put_off_check(&mut self) {
        let limits = [self.config.timeout, self.max_timeout];
        let interval = limits.into_iter().flatten().fold(CHECK_INTERVAL, Ord::min);
        self.connections.check_at = self.now.saturating_add(interval);
    }

    pub(crate) fn time_out_if_due(&mut self) {
        if self.connections.check_at <= self.now {
            self.put_off_check();
            self.time_out();
        }
    }

    pub(crate) fn join_or_send(&mut self, question: Question, purpose: Purpose<R>) {
        let goes_on_after_excuse = matches!(purpose, Purpose::Addresses(..));
        // One that has failed waits longer and gives up sooner.
        let matches = |query: &Query<R>| {
            query.failed_tries <= query.excuses * usize::from(goes_on_after_excuse)
                && query.question.matches(question.bytes())
        };
        let hash = |query: &Query<R>| query.question.hash;
        match self.queries.entry(question.hash, matches, hash) {
            hash_table::Entry::Occupied(entry) => {
                let query = entry.into_mut();
                if let Purpose::Addresses(lookup, kind) = &purpose
                    && query.excuses > 0
                {
                    lookup.move_on(*kind, &query.question);
                }
                query.waiting.push(purpose);
                let last_try = query.last_try;
                return self.repeat(last_try);
            }
            hash_table::Entry::Vacant(entry) => entry.insert(Query {
                question: question.clone(),
                waiting: vec![purpose],
                transport: self.config.transport,
                last_try: None,
                late_tries: Vec::new(),
                least_timeout: Duration::ZERO,
                failed_tries: 0,
                failures_since_timeout: 0,
                avoided: ServerSet::default(),
                excused: ServerSet::default(),
                excuses: 0,
                last_error: Error::ETIMEOUT,
            }),
        };
        if self.servers.any_failed()
            && (self.system.random()).is_some_and(|it| it.is_multiple_of(PROBE_ODDS))
        {
            self.probe(&question, self.config.transport);
        }
        self.send(question, None);
    }

    /// If it was lost, all that come later would have to wait for the timeout.
    fn repeat(&mut self, place: Option<Place>) {
        if let Some((socket, id)) = place
            && let Entry::Occupied(mut entry) = self.connections.open.entry(socket)
            && let connection = entry.get_mut()
            && connection.transport == Transport::Udp
            && connection.room > 0
            && let Some(it) = connection.tries.get_mut(&id)
            && it.repeat_at <= self.now
        {
            it.repeat_at = self.now.saturating_add(self.now.saturating_sub(it.sent));
            let (question, number) = (it.question.clone(), it.deadline.1);
            if connection.write(&question, id, number).is_err() {
                let connection = entry.remove();
                self.fail(connection, None);
            }
        }
    }

    fn probe(&mut self, question: &Question, transport: Transport) {
        let server = self.servers.next_to_probe(self.now);
        let probe = server.map(|it| Step::Send(question.detached(), Some((it, transport))));
        self.steps.extend(probe);
    }

    pub(crate) fn send(&mut self, question: Question, probed: Option<(ServerId, Transport)>) {
        if let Err(question) = self.send_or_hold(question, probed, true)
            && probed.is_none()
        {
            let until = self.now.saturating_add(MAX_HOLD);
            self.connections.held_back.push_back((question, until));
        }
    }

    pub(crate) fn send_held_back(&mut self) {
        self.take_steps();
        while let Some((question, until)) = self.connections.held_back.pop_front() {
            if let Err(question) = self.send_or_hold(question, None, self.now < until) {
                return self.connections.held_back.push_front((question, until));
            }
            self.take_steps();
        }
    }

    /// Reading is what makes room.
    pub(crate) fn make_room(&mut self) {
        if !self.connections.held_back.is_empty() {
            self.read_and_write(self.connections.full, READABLE);
            let full = self.connections.open.get_mut(&self.connections.full);
            if let Some(it) = full.filter(|it| it.quiet_since <= self.now) {
                it.room = S::DATAGRAMS_HELD.min(it.room + GROWTH);
            }
        }
    }

    /// Gives `question` back if there is no room.
    fn send_or_hold(
        &mut self,
        question: Question,
        probed: Option<(ServerId, Transport)>,
        can_wait: bool,
    ) -> Result<(), Question> {
        if self.connections.deadlines.is_empty() {
            self.put_off_check();
        }
        let count = self.servers.len();
        let mut query = find(&mut self.queries, &question);
        let (server, transport) = match (&mut query, probed) {
            (Some(query), _) => {
                let random = self.config.rotate.then(|| self.system.random()).flatten();
                let substitute = match query.last_error {
                    Error::ETIMEOUT | Error::EBADRESP => Substitute::Equal,
                    Error::ECONNREFUSED => Substitute::Similar,
                    _ => Substitute::Any,
                };
                let server = self.servers.choose(random, &mut query.avoided, substitute);
                (server, query.transport)
            }
            (None, Some((server, transport))) => (self.servers.get(server), transport),
            (None, None) => return Ok(()),
        };
        let Some(server) = server else {
            let end = Step::End(question, Err(Error::ENOSERVER));
            self.steps.push_back(end);
            return Ok(());
        };

        let open = &mut self.connections.open;
        let has_many = open.len() >= MANY_SOCKETS;
        let last = match server.socket(transport).map(|socket| open.entry(socket)) {
            Some(Entry::Occupied(last)) => Some(last),
            _ => None,
        };
        let last =
            last.filter(|it| (it.get().server, it.get().transport) == (server.id, transport));
        let mut entry = match last {
            Some(last) if last.get().can_take_more() && (has_many || !last.get().is_retired) => {
                last
            }
            last => {
                let local = match server.address {
                    SocketAddr::V4(_) => self.local_v4.map(IpAddr::V4),
                    SocketAddr::V6(_) => self.local_v6.map(IpAddr::V6),
                };
                let new = Connection::open(&mut self.system, transport, server, local, self.now);
                match (new, last) {
                    (Some(new), _) => open.entry(new.socket.id()).insert(new),
                    (None, Some(mut last)) if last.get().can_take_more() => {
                        last.get_mut().renew(self.connections.last_try);
                        last
                    }
                    (None, _) => {
                        let server = server.id;
                        self.servers.failed(server, Error::ECONNREFUSED, self.now);
                        self.retry_later(question, None, Error::ECONNREFUSED);
                        return Ok(());
                    }
                }
            }
        };
        let (socket, connection) = (*entry.key(), entry.get_mut());
        let mut timeout = (server.latency.average(self.now))
            .map(|it| it.saturating_mul(TIMEOUT_PER_LATENCY))
            .or(self.config.timeout)
            .unwrap_or(DEFAULT_TIMEOUT)
            .max(MIN_TIMEOUT)
            .min(self.max_timeout.unwrap_or(MAX_TIMEOUT));
        if let Some(query) = &mut query {
            timeout = timeout.max(core::mem::take(&mut query.least_timeout));
        }
        if connection.room == 0 && can_wait {
            self.connections.full = socket;
            if let Some(query) = query {
                query.least_timeout = timeout;
            }
            return Err(question);
        }

        let is_ours = |&(at, id): &Place| {
            let it = connection.tries.get(&id).filter(|_| at == socket);
            it.is_some_and(|it| it.question.is(&question))
        };
        let late_tries = query.iter().flat_map(|it| &it.late_tries);
        let id = match late_tries.copied().find(is_ours) {
            Some((_, id)) => id,
            None => loop {
                let Some(id) = self.system.random() else {
                    self.connections.idle.push(socket);
                    let end = Step::End(question, Err(Error::ECONNREFUSED));
                    self.steps.push_back(end);
                    return Ok(());
                };
                if !connection.tries.contains_key(&id) && !connection.forgotten.contains(&id) {
                    break id;
                }
            },
        };
        self.connections.last_try += 1;
        let number = self.connections.last_try;
        if connection.write(&question, id, number).is_err() {
            let connection = entry.remove();
            self.fail(connection, Some(question));
            return Ok(());
        }
        *server.socket(transport) = Some(socket);

        let failed_tries = query.as_ref().map_or(0, |it| it.failed_tries);
        // The list may have been longer.
        let rounds = self.tries.min(failed_tries / count);
        let max = self.max_timeout;
        let timeout = back_off(timeout, max, rounds, &mut self.system);
        let mut overtime_until = self.now;
        if let Some(query) = query {
            query.last_try = Some((socket, id));
            // An estimate is no reason to give up sooner than was asked for.
            if failed_tries + 1 >= count * self.tries {
                let asked = self.config.timeout.unwrap_or_default();
                let asked = asked.min(max.unwrap_or(MAX_LAST_TIMEOUT));
                overtime_until = self.now.saturating_add(asked);
            }
        }
        let deadline = (self.now.saturating_add(timeout), number);
        self.connections.deadlines.insert(deadline, (socket, id));
        let new = Try {
            question,
            sent: self.now,
            repeat_at: self.now.saturating_add(REPEAT_DELAY),
            is_in_crowd: self.connections.deadlines.len() > CROWD,
            deadline,
            state: State::OnTime { overtime_until },
        };
        connection.tries.insert(id, new);
        Ok(())
    }

    pub(crate) fn end(&mut self, question: &Question, outcome: &Outcome) {
        let is_it = |query: &Query<R>| query.question.is(question);
        let Ok(entry) = self.queries.find_entry(question.hash, is_it) else {
            return;
        };
        let (mut query, _) = entry.remove();
        if !query.late_tries.is_empty() {
            query.late_tries.extend(query.last_try);
            self.connections.forget(question, &query.late_tries);
        }
        // Whoever asks for records is to get the excuse.
        if let Ok(message) = outcome
            && query.excuses == 0
        {
            self.cache.insert(question, message, self.now, &self.system);
        }
        for purpose in query.waiting {
            self.finish(purpose, outcome.clone());
        }
    }

    fn retry_later(&mut self, question: Question, avoided: Option<ServerId>, error: Error) {
        if let Some(server) = avoided.and_then(|server| self.servers.get(server))
            && let Some(query) = find(&mut self.queries, &question)
        {
            query.avoided.insert(server);
        }
        self.steps.push_back(Step::Retry(question, Some(error)));
    }

    pub(crate) fn retry(&mut self, question: Question, error: Option<Error>) {
        let Some(query) = find(&mut self.queries, &question) else {
            return;
        };
        let error = error.unwrap_or(query.last_error);
        query.last_error = error;
        query.failed_tries += 1;
        (query.failures_since_timeout, query.avoided) = match error {
            Error::ETIMEOUT => (0, query.excused),
            _ => (query.failures_since_timeout + 1, query.avoided),
        };
        self.steps.extend(query.let_go(error));
        if !query.waiting.is_empty()
            && query.failed_tries < self.servers.len() * self.tries
            && query.failures_since_timeout < self.servers.len() * MAX_FAILURES_BEFORE_TIMEOUT
        {
            if self.servers.all_failed() {
                let transport = query.transport;
                self.probe(&question, transport);
            }
            self.send(question, None);
        } else {
            self.doubts_config |= matches!(error, Error::ETIMEOUT | Error::ECONNREFUSED);
            self.end(&question, &Err(error));
        }
    }

    /// As `getaddrinfo` does. Whoever asked for records gets `excuse`, as in Node.js. Returns whether the query goes on.
    fn turn_to_another(
        &mut self,
        question: &Question,
        excuse: &Message,
        from: ServerId,
        state: State,
    ) -> bool {
        let (Some(error), Some(query), Some(server)) = (
            excuse.excuse(),
            find(&mut self.queries, question),
            self.servers.get(from),
        ) else {
            return false;
        };
        query.excused.insert(server);
        query.avoided.insert(server);
        if self.servers.iter().all(|it| query.excused.contains(it))
            || query.failed_tries + 1 >= self.servers.len() * ROUNDS_AFTER_EXCUSE
            || !(query.waiting.iter()).any(|it| matches!(it, Purpose::Addresses(..)))
        {
            return false;
        }
        query.excuses += 1;
        let others = query.waiting.extract_if(.., |it| match it {
            Purpose::Addresses(lookup, kind) => {
                lookup.move_on(*kind, question);
                false
            }
            _ => true,
        });
        (self.steps).extend(others.map(|it| Step::Finish(it, Ok(excuse.clone()))));
        // Another try is under way otherwise.
        if state != State::Late {
            (self.steps).push_back(Step::Retry(question.clone(), Some(error)));
        }
        true
    }

    pub(crate) fn let_go_of(&mut self, question: &Question) {
        let Some(query) = find(&mut self.queries, question) else {
            return;
        };
        let (error, last_try) = (query.last_error, query.last_try);
        self.steps.extend(query.let_go(error));
        if query.waiting.is_empty() {
            self.connections.forget(question, last_try.as_slice());
            self.end(question, &Err(error));
        }
    }

    /// `next` is what it was about to take.
    fn fail(&mut self, connection: Connection<S::Socket>, next: Option<Question>) {
        let has_substitute = self.go_back_from(&connection);
        if !has_substitute {
            (self.servers).failed(connection.server, Error::ECONNREFUSED, self.now);
        }
        let is_unproven = connection.transport == Transport::Tcp && connection.cleared_up_to == 0;
        let avoided = (connection.is_second_chance || is_unproven).then_some(connection.server);
        let tries = self.connections.close([connection]);
        for question in tries.into_iter().map(|it| it.question).chain(next) {
            if has_substitute {
                self.steps.push_back(Step::Send(question, None));
            } else {
                self.retry_later(question, avoided, Error::ECONNREFUSED);
            }
        }
    }

    /// To the stream that was retired for this one. The server may have had no second one to give.
    fn go_back_from(&mut self, failed: &Connection<S::Socket>) -> bool {
        if failed.transport == Transport::Udp || failed.cleared_up_to > 0 || failed.is_retired {
            return false;
        }
        let last_try = self.connections.last_try;
        self.servers.get(failed.server).is_some_and(|server| {
            let old = self.connections.stream(server.retired_tcp, server.id);
            old.filter(|it| it.can_take_more()).is_some_and(|old| {
                (old.is_retired, old.cleared_up_to) = (false, last_try);
                *server.socket(Transport::Tcp) = server.retired_tcp;
                true
            })
        })
    }

    /// It was retired, and has turned out to work. The one that took its place may have yet to.
    fn go_back_to(&mut self, old: &mut Connection<S::Socket>) {
        self.servers.change(old.server, |server| {
            let socket = *server.socket(Transport::Tcp);
            if let Some(new) = self.connections.stream(socket, server.id) {
                if new.cleared_up_to > 0 {
                    return;
                }
                (new.is_retired, server.retired_tcp) = (true, socket);
            }
            old.is_retired = false;
            *server.socket(Transport::Tcp) = Some(old.socket.id());
        });
    }

    pub(crate) fn leave_removed_servers(&mut self) {
        for query in &mut self.queries {
            (query.avoided, query.excused) = Default::default();
        }
        let open = &mut self.connections.open;
        let left = open.extract_if(|_, connection| self.servers.get(connection.server).is_none());
        let left: Vec<_> = left.map(|(_, connection)| connection).collect();
        for it in self.connections.close(left) {
            self.steps.push_back(Step::Retry(it.question, None));
        }
    }

    pub(crate) fn fail_all(&mut self, error: Error) {
        let open = core::mem::take(&mut self.connections.open);
        let tries = self.connections.close(open.into_values());
        let sent = tries.into_iter().map(|it| it.question);
        let all = sent.chain(self.connections.held_back.drain(..).map(|it| it.0));
        (self.steps).extend(all.map(|question| Step::End(question, Err(error))));
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
        let open = self.connections.open.iter();
        let streams = open.filter(|(_, it)| it.transport == Transport::Tcp);
        sockets.extend(streams.map(|(&socket, _)| socket));
        index_sort::sort_slice_unstable(&mut sockets);
        sockets.dedup();
        for socket in sockets {
            self.read_and_write(socket, READABLE);
        }
        while let Some(first) = self.connections.deadlines.first_entry()
            && first.key().0 <= self.now
        {
            let (socket, id) = first.remove();
            let mut connection = self.connections.open.remove(&socket);
            let it = connection.as_mut().and_then(|it| it.tries.remove(&id));
            let found = connection.zip(it);
            let kept = found.and_then(|(connection, it)| self.give_up_on(connection, id, it));
            self.connections.open.extend(kept.map(|it| (socket, it)));
            // It is still there if it went into overtime.
            self.repeat(Some((socket, id)));
        }
    }

    /// Returns `connection` unless it has to make way for that of the retries.
    fn give_up_on(
        &mut self,
        mut connection: Connection<S::Socket>,
        id: MessageId,
        mut it: Try,
    ) -> Option<Connection<S::Socket>> {
        let (place, number) = ((connection.socket.id(), id), it.deadline.1);
        let is_suspect = it.state != State::Overtime && number > connection.cleared_up_to;
        let loses_nothing = connection.transport == Transport::Tcp;
        if it.state != State::Overtime {
            (self.servers).failed(connection.server, Error::ETIMEOUT, self.now);
        }
        let mut query = find(&mut self.queries, &it.question);
        if let Some(query) = &mut query {
            self.steps.extend(query.let_go(Error::ETIMEOUT));
        }
        if let Some(query) = &mut query
            && let State::OnTime { overtime_until } = it.state
            && overtime_until > self.now
            && !query.waiting.is_empty()
        {
            query.failed_tries += 1;
            (it.state, it.deadline.0) = (State::Overtime, overtime_until);
            self.connections.deadlines.insert(it.deadline, place);
            connection.tries.insert(id, it);
        } else {
            let retry = Step::Retry(it.question.clone(), Some(Error::ETIMEOUT));
            self.steps.push_back(retry);
            connection.unsent.remove(&number);
            connection.strays_left += 1;
            self.connections.recent_ids.insert(id);
            if let Some(query) = query.filter(|_| loses_nothing) {
                query.late_tries.retain(|it| it.0 != place.0);
                query.late_tries.push(place);
                it.state = State::Late;
                connection.tries.insert(id, it);
            }
        }

        if !loses_nothing {
            connection.is_retired |= is_suspect;
        } else if is_suspect {
            // It stays open for the replies, and servers have few connections to give.
            self.servers.change(connection.server, |server| {
                let other = self.connections.stream(server.retired_tcp, server.id);
                let is_stale = self.now.saturating_sub(server.retired_tcp_at) >= MAX_TIMEOUT;
                if !other.is_some_and(|it| it.is_retired) || (is_stale && !connection.is_retired) {
                    server.retired_tcp_at = self.now;
                    (connection.is_retired, server.retired_tcp) = (true, Some(place.0));
                }
            });
        }
        (!connection.is_retired || !connection.tries.is_empty()).then_some(connection)
    }

    pub(crate) fn read_and_write(&mut self, socket: SocketId, events: Events) {
        let Some(mut connection) = self.connections.open.remove(&socket) else {
            return;
        };
        if (events.readable && self.read(&mut connection).is_err())
            || (events.writable && connection.flush().is_err())
            || events.failed
        {
            if connection.tries.values().any(|it| it.state != State::Late) {
                self.fail(connection, None);
            }
        } else {
            self.connections.idle.push(socket);
            self.connections.open.insert(socket, connection);
        }
    }

    fn read(&mut self, connection: &mut Connection<S::Socket>) -> Result<(), Failed> {
        let mut buffer = core::mem::take(&mut connection.input);
        let (mut strays, mut result) = (0, Ok(()));
        while strays < MAX_STRAYS_PER_READ
            && !connection.tries.is_empty()
            && !connection.is_connecting
        {
            buffer.reserve(MAX_FRAME_LEN);
            let sender = match connection.socket.receive(&mut buffer) {
                Ok(sender) => sender,
                Err(SocketError::WouldBlock) => {
                    if self.now.saturating_sub(connection.quiet_since) >= PAUSE {
                        (connection.room, connection.quiet_since) = (S::DATAGRAMS_HELD, self.now);
                    }
                    break;
                }
                // Linux reports it before the datagrams that have arrived.
                Err(SocketError::Failed)
                    if connection.transport == Transport::Udp && result.is_ok() =>
                {
                    result = Err(Failed);
                    continue;
                }
                Err(SocketError::Failed) => return Err(Failed),
            };
            if connection.transport == Transport::Udp {
                let (ip, port) = (connection.peer.ip(), connection.peer.port());
                let is_from_peer = sender.is_some_and(|it| (it.ip(), it.port()) == (ip, port));
                if !is_from_peer || !self.receive(connection, &buffer) {
                    let recent_ids = &self.connections.recent_ids;
                    let is_ours = |id| {
                        connection.forgotten.remove(&id)
                            || recent_ids.contains(id)
                            || connection.tries.contains_key(&id)
                    };
                    let cost = usize::from(!message::id_of(&buffer).is_some_and(is_ours));
                    connection.strays_left =
                        (connection.strays_left.checked_sub(cost)).ok_or(Failed)?;
                    strays += 1;
                }
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
        result
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
        let (id, it) = entry.remove_entry();
        let Try {
            question,
            sent,
            is_in_crowd,
            deadline,
            state,
            ..
        } = it;
        let took = self.now.saturating_sub(sent);
        if is_final {
            connection.cleared_up_to = self.connections.last_try;
            if connection.is_retired {
                self.go_back_to(connection);
            }
        } else {
            // Not worth the memory if each socket closes after one reply.
            if !connection.tries.is_empty() || self.connections.recent_ids.count > 0 {
                self.connections.recent_ids.insert(id);
            }
            connection.room = S::DATAGRAMS_HELD.min(connection.room + 1);
            connection.quiet_since = connection.quiet_since.max(self.now);
        }
        connection.is_second_chance &= matches!(received, Received::Malformed);
        connection.unsent.remove(&deadline.1);
        self.connections.deadlines.remove(&deadline);
        let is_refusal = matches!(&received, Received::Reply(it) if it.is_refusal());
        connection.refusals_in_a_row = (connection.refusals_in_a_row + 1) * usize::from(is_refusal);
        let may_be_overloaded = is_refusal && is_in_crowd && !is_final && {
            let server = self.servers.get(connection.server);
            server.is_some_and(|it| it.refuses_until <= self.now)
        };
        match received {
            Received::Reply(_) if may_be_overloaded => {
                if connection.refusals_in_a_row >= MANY_REFUSALS {
                    connection.room = 0;
                    connection.quiet_since = self.now.saturating_add(LONG_PAUSE);
                }
                self.retry_later(question, None, Error::EREFUSED);
            }
            Received::Reply(message) => {
                if is_refusal {
                    let until = self.now.saturating_add(REFUSAL_MEMORY);
                    (self.servers).change(connection.server, |it| it.refuses_until = until);
                }
                self.doubts_config = is_refusal;
                let took = message.excuse().is_none().then_some(took);
                self.servers.answered(connection.server, took, self.now);
                if self.turn_to_another(&question, &message, connection.server, state) {
                    return true;
                }
                if state != State::Late {
                    self.steps.push_back(Step::End(question, Ok(message)));
                    return true;
                }
                // What becomes of the last try no longer counts.
                let last_try = find(&mut self.queries, &question).and_then(|it| it.last_try);
                self.connections.forget(&question, last_try.as_slice());
                self.steps.push_front(Step::End(question, Ok(message)));
            }
            Received::Truncated => {
                if let Some(query) = find(&mut self.queries, &question) {
                    query.transport = Transport::Tcp;
                }
                self.steps.push_back(Step::Send(question, None));
            }
            Received::Malformed if state == State::Late => {}
            Received::Malformed => {
                (self.servers).failed(connection.server, Error::EBADRESP, self.now);
                self.retry_later(question, Some(connection.server), Error::EBADRESP);
            }
        }
        true
    }
}

/// `rounds` is how many times all servers have been tried.
fn back_off(
    timeout: Duration,
    max: Option<Duration>,
    rounds: usize,
    system: &mut impl System,
) -> Duration {
    if rounds == 0 {
        return timeout;
    }
    let doubled = (timeout.as_millis() as u64).saturating_mul(2u64.saturating_pow(rounds as u32));
    let doubled = Duration::from_millis(doubled).min(max.unwrap_or(Duration::MAX));
    let doubled = doubled.as_millis() as u64;
    let jitter = f32::from(system.random().unwrap_or(0)) / f32::from(u16::MAX) * 0.5;
    timeout.max(Duration::from_millis(
        doubled - (doubled as f32 * jitter) as u64,
    ))
}
