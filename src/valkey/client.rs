//! The client without its socket, timers and script: every method returns what is left to do.

use std::collections::VecDeque;

use bun_collections::OffsetByteList;
use bun_core::strings;

use crate::command::{self, ACKS, Ack, Reply};
use crate::listeners::{Listeners, Name, Ticket, Undo};
use crate::valkey_protocol::{Push, RESPValue, RedisError, ReplyScanner, ScanResult, ValkeyReader};

const FIRST_DELAY_MS: u32 = 50;
const MAX_DELAY_MS: u32 = 2000;

#[derive(Clone)]
pub struct Config {
    pub username: Box<[u8]>,
    pub password: Box<[u8]>,
    pub database: u32,
    pub idle_timeout_ms: u32,
    pub connection_timeout_ms: u32,
    pub max_retries: u32,
    pub enable_auto_reconnect: bool,
    pub enable_offline_queue: bool,
    pub enable_auto_pipelining: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            username: Box::default(),
            password: Box::default(),
            database: 0,
            idle_timeout_ms: 0,
            connection_timeout_ms: 10000,
            max_retries: 20,
            enable_auto_reconnect: true,
            enable_offline_queue: true,
            enable_auto_pipelining: true,
        }
    }
}

enum State {
    /// Never dialed, or only by a [`Client::preconnect`] that failed.
    Idle,
    /// The socket is connecting, or in its TLS handshake.
    Dialing,
    /// HELLO is written, and SELECT behind it if there is a database.
    Hello,
    /// HELLO was accepted with this; the reply to SELECT is due. Boxed to keep the state's tag a plain byte.
    Select(Box<RESPValue>),
    Ready,
    /// The socket is closing, or the dial gave none: [`Client::lost`] is due.
    Ending(End),
    /// A dial is due, from the retry timer or from `connect()`.
    Backoff,
    /// Until [`Client::connect`].
    Closed,
}

#[derive(Copy, Clone)]
enum End {
    /// The retry policy decides.
    Policy,
    /// By [`Client::close`]; as [`End::Final`], until [`Client::connect`] takes it back.
    Requested,
    /// No retry; what is queued until then is rejected.
    Final,
    /// No retry; everything is rejected already, and new commands are refused.
    Failed,
}

#[derive(Copy, Clone)]
enum Expect {
    Reply(Reply),
    /// Once confirmed, the next handshake selects this database.
    Database(u32),
}

enum InFlight<P> {
    Plain(Expect, P),
    /// Its first acknowledgement answers it: a count would shift every later reply once a peer sent fewer.
    Ack(Box<Request<P>>),
    /// So many SUBSCRIBEs that no script waits for, one for each channel: a refusal costs only its own.
    Restore(usize),
}

const _: () = assert!(size_of::<InFlight<usize>>() == 2 * size_of::<usize>());

struct Request<P> {
    promise: P,
    kind: Ack,
    names: Vec<Name>,
    /// From [`Client::subscribe`].
    ticket: Option<Ticket>,
}

impl<P> InFlight<P> {
    fn into_promise(self) -> Option<P> {
        match self {
            InFlight::Plain(_, promise) => Some(promise),
            InFlight::Ack(request) => Some(request.promise),
            InFlight::Restore(_) => None,
        }
    }
}

/// The acknowledgements that the request answered last may still draw.
enum Tail {
    None,
    Named(Ack, VecDeque<Name>),
    /// It had no arguments: each carries a count one below the last.
    CountingDown(Ack, i64),
}

impl Tail {
    fn after(kind: Ack, names: Vec<Name>, ack: &[RESPValue]) -> Tail {
        let mut names = VecDeque::from(names);
        match (names.pop_front(), ack) {
            (Some(_), _) => Tail::Named(kind, names),
            (None, [RESPValue::BulkString(Some(_)), RESPValue::Integer(count)]) => {
                Tail::CountingDown(kind, *count)
            }
            (None, _) => Tail::None,
        }
    }

    fn take(&mut self, kind: Ack, ack: &[RESPValue]) -> bool {
        match (self, ack) {
            (Tail::Named(owed, names), [RESPValue::BulkString(Some(name)), ..])
                if *owed == kind =>
            {
                let at = names.iter().position(|it| it == name);
                at.map(|at| names.drain(..=at)).is_some()
            }
            (
                Tail::CountingDown(owed, last),
                [RESPValue::BulkString(Some(_)), RESPValue::Integer(count)],
            ) if *owed == kind && count.checked_add(1) == Some(*last) => {
                *last = *count;
                true
            }
            _ => false,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    /// Never had a listener or a subscription.
    Fresh,
    Plain,
    Subscriber,
}

struct Queued<P> {
    bytes: Box<[u8]>,
    can_pipeline: bool,
    request: InFlight<P>,
}

/// `P` stands for whoever waits for a command; the client only hands it back.
pub struct Client<P> {
    config: Config,
    state: State,
    retries: u32,
    /// The dials that follow replace a lost connection, and script did not ask for them.
    was_ready: bool,
    /// For the next handshake. What script selected holds only while the client reconnects by itself.
    database: u32,
    /// The handshake can have fewer rights than the session in which script selected.
    script_authenticates: bool,
    /// Script sent a command, connected or closed. Until then nobody would hear why the client gave up.
    is_used: bool,
    mode: Mode,
    listeners: Listeners,
    tail: Tail,
    output: OffsetByteList,
    input: OffsetByteList,
    /// Resumes over `input`.
    scanner: ReplyScanner,
    in_flight: VecDeque<InFlight<P>>,
    queue: VecDeque<Queued<P>>,
}

/// Where the replies of one read come from.
pub enum Input<'a> {
    Borrowed(&'a [u8]),
    Buffered,
}

pub enum Event<P> {
    Ignored,
    /// With the reply to HELLO, once the handshake is complete.
    Connected(RESPValue),
    Resolved {
        promise: P,
        value: RESPValue,
        as_buffer: bool,
    },
    Rejected {
        promise: P,
        message: Box<[u8]>,
        undo: Vec<Undo>,
    },
    Message(Vec<RESPValue>),
    /// Has no listeners, but is a microtask checkpoint like a message.
    PatternMessage,
    Subscribed(Acked<P>),
    Unsubscribed(Acked<P>),
    /// For [`Client::fail`].
    Broken {
        message: Box<[u8]>,
        error: RedisError,
    },
    /// The server cannot take the handshake now: for [`Client::abandon_handshake`], else as [`Event::Broken`].
    Busy {
        message: Box<[u8]>,
        error: RedisError,
    },
}

/// Whom an acknowledgement answers.
pub enum Acked<P> {
    Nobody,
    Channel(P),
    /// Pattern and shard requests resolve with the push itself.
    Raw(P, RESPValue),
}

/// Permission to call [`Client::lost`] once. The next dial cannot start before it is used.
#[must_use]
pub struct Attempt(());

#[must_use]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Sent {
    /// In [`Client::output`].
    Buffered,
    /// For [`Client::batch`], once the microtasks have run.
    Batched,
    Queued,
}

#[must_use]
pub enum Close {
    Nothing,
    /// Its close event leads to [`Client::lost`].
    Socket,
    /// There is no socket, only a retry to disarm.
    Retry(Attempt),
}

#[must_use]
pub enum Lost<P> {
    ForGood {
        reason: Reason,
        pending: Vec<P>,
        undo: Vec<Undo>,
    },
    Retry {
        delay_ms: u32,
        in_flight: Vec<P>,
        undo: Vec<Undo>,
    },
}

/// Why no retry follows.
#[derive(Debug)]
pub enum Reason {
    Requested,
    /// The attempt failed for good, or retries are off.
    Final,
    RetriesUsedUp,
}

fn broken<P>(message: &[u8], error: RedisError) -> Event<P> {
    Event::Broken {
        message: message.into(),
        error,
    }
}

/// An error reply to the handshake. One that passes is not `error`: script can try again.
fn refused<P>(message: &[u8], error: RedisError) -> Event<P> {
    const PASSING: [&[u8]; 5] = [
        b"LOADING ",
        b"BUSY ",
        b"MASTERDOWN ",
        b"TRYAGAIN ",
        b"ERR max number of clients",
    ];
    if PASSING.iter().any(|prefix| message.starts_with(prefix)) {
        Event::Busy {
            message: message.into(),
            error: RedisError::ConnectionClosed,
        }
    } else {
        broken(message, error)
    }
}

impl<P> Client<P> {
    pub fn new(config: Config) -> Self {
        Self {
            database: config.database,
            config,
            state: State::Idle,
            retries: 0,
            was_ready: false,
            script_authenticates: false,
            is_used: false,
            mode: Mode::Fresh,
            listeners: Listeners::default(),
            tail: Tail::None,
            output: OffsetByteList::default(),
            input: OffsetByteList::default(),
            scanner: ReplyScanner::default(),
            in_flight: VecDeque::new(),
            queue: VecDeque::new(),
        }
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    pub fn is_connected(&self) -> bool {
        matches!(self.state, State::Ready)
    }

    pub fn is_dialing(&self) -> bool {
        matches!(self.state, State::Dialing)
    }

    pub fn is_used(&self) -> bool {
        self.is_used
    }

    pub fn is_ending(&self) -> bool {
        matches!(self.state, State::Ending(_))
    }

    /// An event is still to come.
    pub fn is_active(&self) -> bool {
        !matches!(self.state, State::Idle | State::Closed)
    }

    fn has_failed(&self) -> bool {
        matches!(self.state, State::Ending(End::Failed) | State::Closed)
    }

    pub fn is_subscriber(&self) -> bool {
        self.mode == Mode::Subscriber
    }

    pub fn may_unsubscribe(&self) -> bool {
        self.mode != Mode::Fresh
    }

    fn leave_subscriber_mode_without_listeners(&mut self) {
        if self.is_subscriber() && self.listeners.is_empty() {
            self.mode = Mode::Plain;
        }
    }

    /// Script dropped the listeners of `channel` but for those at the indices that `keep` names.
    pub fn retain_listeners(&mut self, channel: &[u8], keep: impl FnMut(usize) -> bool) {
        self.listeners.retain(channel, keep);
        self.dropped_listeners();
    }

    pub fn clear_listeners(&mut self) {
        self.listeners.clear();
        self.dropped_listeners();
    }

    /// No acknowledgement follows an UNSUBSCRIBE that cannot be sent.
    fn dropped_listeners(&mut self) {
        if self.rejection().is_some() {
            self.leave_subscriber_mode_without_listeners();
        }
    }

    pub fn has_pending_commands(&self) -> bool {
        !self.in_flight.is_empty() || !self.queue.is_empty() || self.buffered_amount() > 0
    }

    pub fn buffered_amount(&self) -> usize {
        self.output.len() + self.input.len()
    }

    pub fn memory_cost(&self) -> usize {
        self.output.byte_list.capacity()
            + self.input.byte_list.capacity()
            + self.in_flight.len() * size_of::<InFlight<P>>()
            + self.queue.len() * size_of::<Queued<P>>()
            + self.queue.iter().map(|it| it.bytes.len()).sum::<usize>()
    }

    /// What bounds the current state; 0 for nothing.
    pub fn timeout_ms(&self) -> u32 {
        if self.is_connected() {
            self.config.idle_timeout_ms
        } else if self.has_failed() {
            0
        } else {
            self.config.connection_timeout_ms
        }
    }

    /// An explicit `connect()`, ahead of [`Self::first_dial`] and [`Self::redial`].
    pub fn connect(&mut self) {
        self.was_ready = self.is_connected();
        match self.state {
            State::Backoff | State::Closed => {
                self.retries = 0;
                self.state = State::Backoff;
            }
            // The close of a dial without a TLS context is still due, and no retry can build one.
            State::Ending(End::Failed) => self.state = State::Ending(End::Final),
            State::Ending(End::Requested) => self.state = State::Ending(End::Policy),
            State::Idle
            | State::Dialing
            | State::Hello
            | State::Select(_)
            | State::Ready
            | State::Ending(End::Policy | End::Final) => {}
        }
    }

    pub fn close(&mut self) -> Close {
        self.is_used = true;
        self.was_ready = false;
        self.database = self.config.database;
        let close = match self.state {
            State::Idle | State::Closed | State::Ending(End::Final | End::Failed) => {
                return Close::Nothing;
            }
            State::Ending(End::Policy | End::Requested) => Close::Nothing,
            State::Dialing | State::Hello | State::Select(_) | State::Ready => Close::Socket,
            State::Backoff => Close::Retry(Attempt(())),
        };
        self.state = State::Ending(End::Requested);
        close
    }

    pub fn first_dial(&mut self) -> Option<Attempt> {
        self.is_used = true;
        self.preconnect()
    }

    /// A dial that script did not ask for. If it fails for good, the first command dials again.
    pub fn preconnect(&mut self) -> Option<Attempt> {
        matches!(self.state, State::Idle).then(|| self.dial())
    }

    pub fn redial(&mut self) -> Option<Attempt> {
        matches!(self.state, State::Backoff).then(|| self.dial())
    }

    fn dial(&mut self) -> Attempt {
        self.state = State::Dialing;
        Attempt(())
    }

    /// The dial gave no socket.
    pub fn dial_failed(&mut self) {
        if let State::Dialing = self.state {
            self.state = State::Ending(End::Policy);
        }
    }

    /// The transport is up. A TLS renegotiation says so again.
    pub fn start(&mut self) {
        let State::Dialing = self.state else { return };
        self.state = State::Hello;
        let Config {
            username, password, ..
        } = &self.config;
        let user: &[u8] = if username.is_empty() {
            b"default"
        } else {
            username
        };
        let hello: [&[u8]; 4] = [b"3", b"AUTH", user, password];
        let anonymous = username.is_empty() && password.is_empty();
        let out = &mut self.output.byte_list;
        command::encode(b"HELLO", &hello[..if anonymous { 1 } else { 4 }], out);
        if self.database > 0 {
            self.write_select();
        }
    }

    fn write_select(&mut self) {
        let mut digits = bun_core::fmt::ItoaBuf::new();
        let database = bun_core::fmt::itoa(&mut digits, self.database);
        command::encode(b"SELECT", &[database], &mut self.output.byte_list);
    }

    /// Gives up the attempt, if there is one, without a retry: the caller rejects these and closes the socket.
    #[must_use]
    pub fn fail(&mut self) -> Option<Vec<P>> {
        match self.state {
            State::Idle | State::Backoff | State::Ending(End::Failed) | State::Closed => None,
            State::Dialing
            | State::Hello
            | State::Select(_)
            | State::Ready
            | State::Ending(End::Policy | End::Requested | End::Final) => {
                self.state = State::Ending(End::Failed);
                Some(self.take_pending())
            }
        }
    }

    /// For a reason that passes. Whether that costs only this attempt: the caller closes the socket, else it fails.
    #[must_use]
    pub fn abandon_handshake(&mut self) -> bool {
        let retries = self.was_ready
            && matches!(self.state, State::Dialing | State::Hello | State::Select(_));
        if retries {
            self.state = State::Ending(End::Policy);
        }
        retries
    }

    /// The TLS session broke. `Some` if that counts as a lost connection and not as a failed handshake.
    #[must_use]
    pub fn session_broke(&mut self) -> Option<Vec<P>> {
        let said_hello = matches!(self.state, State::Select(_) | State::Ready);
        (said_hello && self.config.enable_auto_reconnect).then(|| self.take_in_flight())
    }

    /// The socket closed, or there never was one.
    pub fn lost(&mut self, Attempt(()): Attempt, owner_is_gone: bool) -> Lost<P> {
        self.output.clear_and_free();
        self.input.clear_and_free();
        self.scanner.reset();
        self.tail = Tail::None;

        let is_final = matches!(self.state, State::Ending(End::Final | End::Failed));
        let reason = if let State::Ending(End::Requested) = self.state {
            Reason::Requested
        } else if is_final || owner_is_gone || !self.config.enable_auto_reconnect {
            Reason::Final
        } else {
            self.retries += 1;
            if self.retries <= self.config.max_retries {
                self.state = State::Backoff;
                return Lost::Retry {
                    delay_ms: (FIRST_DELAY_MS << (self.retries.min(10) - 1)).min(MAX_DELAY_MS),
                    in_flight: self.take_in_flight(),
                    undo: self.undo_unanswered(),
                };
            }
            Reason::RetriesUsedUp
        };
        self.database = self.config.database;
        if self.is_used {
            self.state = State::Closed;
        } else {
            self.state = State::Idle;
            self.retries = 0;
            self.was_ready = false;
        }
        Lost::ForGood {
            reason,
            pending: self.take_pending(),
            undo: self.undo_unanswered(),
        }
    }

    /// With nothing in flight. Covers what [`Self::fail`] and [`Self::session_broke`] took as well.
    fn undo_unanswered(&mut self) -> Vec<Undo> {
        let queued = self.queue.iter().find_map(|it| match &it.request {
            InFlight::Ack(request) => request.ticket,
            InFlight::Plain(..) | InFlight::Restore(_) => None,
        });
        let undo = self.listeners.abandon(queued);
        self.leave_subscriber_mode_without_listeners();
        undo
    }

    fn take_in_flight(&mut self) -> Vec<P> {
        let in_flight = core::mem::take(&mut self.in_flight);
        // Script was leaving the database that it selected before.
        if (in_flight.iter()).any(
            |it| matches!(it, InFlight::Plain(Expect::Database(to), _) if *to != self.database),
        ) {
            self.database = self.config.database;
        }
        (in_flight.into_iter().filter_map(InFlight::into_promise)).collect()
    }

    fn take_pending(&mut self) -> Vec<P> {
        let mut pending = self.take_in_flight();
        let queue = core::mem::take(&mut self.queue);
        pending.extend(queue.into_iter().filter_map(|it| it.request.into_promise()));
        pending
    }

    /// Why a command cannot be sent or queued now.
    pub fn rejection(&self) -> Option<&'static str> {
        if self.has_failed() {
            Some("Connection has failed")
        } else if !self.is_connected() && !self.config.enable_offline_queue {
            Some("Connection is closed and offline queue is disabled")
        } else {
            None
        }
    }

    /// For a client with no [`Self::rejection`].
    pub fn send<A: AsRef<[u8]>>(
        &mut self,
        name: &[u8],
        args: &[A],
        reply: Reply,
        promise: P,
    ) -> Sent {
        let expect = match ACKS.get_ascii_case_insensitive(name) {
            Some(&kind) => return self.send_for_ack(name, args, kind, None, promise),
            None if matches!(
                (name.len(), name.first().map(u8::to_ascii_lowercase)),
                (4, Some(b'a')) | (5, Some(b'h' | b'r')) | (6, Some(b's'))
            ) =>
            {
                (self.database_after(name, args)).map_or(Expect::Reply(reply), Expect::Database)
            }
            None => Expect::Reply(reply),
        };
        self.enqueue(name, args, InFlight::Plain(expect, promise))
    }

    /// As [`Self::send`], once script has stored a listener for each of `names`.
    pub fn subscribe(&mut self, names: &[Name], promise: P) -> Sent {
        if self.mode == Mode::Fresh {
            self.mode = Mode::Plain;
        }
        let ticket = Some(self.listeners.add(names));
        self.send_for_ack(b"SUBSCRIBE", names, Ack::Subscribe, ticket, promise)
    }

    #[cold]
    fn send_for_ack<A: AsRef<[u8]>>(
        &mut self,
        name: &[u8],
        args: &[A],
        kind: Ack,
        ticket: Option<Ticket>,
        promise: P,
    ) -> Sent {
        let request = Request {
            promise,
            kind,
            names: args.iter().map(|it| it.as_ref().into()).collect(),
            ticket,
        };
        self.enqueue(name, args, InFlight::Ack(Box::new(request)))
    }

    #[inline(always)]
    fn enqueue<A: AsRef<[u8]>>(&mut self, name: &[u8], args: &[A], request: InFlight<P>) -> Sent {
        let can_pipeline = command::can_pipeline(name);
        let batches = can_pipeline && self.config.enable_auto_pipelining;
        let connected = self.is_connected();

        let goes_now = !batches && connected && self.queue.is_empty() && self.in_flight.is_empty();

        let mut bytes = Vec::new();
        let out = if goes_now {
            &mut self.output.byte_list
        } else {
            &mut bytes
        };
        command::encode(name, args, out);
        if goes_now {
            self.in_flight.push_back(request);
            return Sent::Buffered;
        }
        self.queue.push_back(Queued {
            bytes: bytes.into_boxed_slice(),
            can_pipeline,
            request,
        });
        if batches && connected {
            Sent::Batched
        } else {
            Sent::Queued
        }
    }

    /// RESET forgets the choice, as it does the rest of the session.
    #[inline(never)]
    fn database_after<A: AsRef<[u8]>>(&mut self, name: &[u8], args: &[A]) -> Option<u32> {
        let is_auth = |it: &[u8]| it.eq_ignore_ascii_case(b"AUTH");
        self.script_authenticates |= is_auth(name)
            || (name.eq_ignore_ascii_case(b"HELLO") && args.iter().any(|it| is_auth(it.as_ref())));
        match args {
            [database] if name.eq_ignore_ascii_case(b"SELECT") => Some(
                bun_core::fmt::parse_int(database.as_ref(), 10).unwrap_or(self.config.database),
            ),
            [] if name.eq_ignore_ascii_case(b"RESET") => Some(self.config.database),
            _ => None,
        }
    }

    /// Moves the head of the queue to [`Self::output`] if it travels alone. Whether [`Self::batch`] is due.
    #[must_use]
    pub fn advance(&mut self) -> bool {
        if !self.output.is_empty() || !self.is_connected() {
            return false;
        }
        if self.in_flight.is_empty()
            && let Some(alone) = self.queue.pop_front_if(|it| !it.can_pipeline)
        {
            self.put_in_flight(alone);
        }
        self.queue.front().is_some_and(|it| it.can_pipeline)
    }

    /// Moves what may share a write to [`Self::output`]. Whether to come back.
    #[must_use]
    pub fn batch(&mut self) -> bool {
        if !self.is_connected() {
            return false;
        }
        let batch = self.queue.iter().take_while(|it| it.can_pipeline);
        let len = batch.map(|it| it.bytes.len()).sum();
        self.output.byte_list.reserve(len);
        while let Some(next) = self.queue.pop_front_if(|it| it.can_pipeline) {
            self.put_in_flight(next);
        }
        !self.queue.is_empty()
    }

    fn put_in_flight(&mut self, queued: Queued<P>) {
        self.output.byte_list.extend_from_slice(&queued.bytes);
        self.in_flight.push_back(queued.request);
    }

    /// What the socket has yet to take.
    pub fn output(&self) -> &[u8] {
        self.output.remaining()
    }

    pub fn wrote(&mut self, len: usize) {
        self.output.consume(len);
    }

    /// Copies `data` only if it continues a partial reply.
    pub fn feed<'a>(&mut self, data: &'a [u8]) -> Input<'a> {
        if self.input.is_empty() {
            return Input::Borrowed(data);
        }
        self.input.byte_list.extend_from_slice(data);
        Input::Buffered
    }

    /// `None` once `input` holds no complete reply.
    pub fn next_event(&mut self, input: &mut Input<'_>) -> Option<Event<P>> {
        let value = match input {
            Input::Borrowed([]) => return None,
            Input::Borrowed(data) => {
                let mut reader = ValkeyReader::init(data);
                match reader.read_value() {
                    Ok(value) => {
                        *data = &data[reader.pos()..];
                        value
                    }
                    Err(RedisError::InvalidResponse) => {
                        self.scanner.reset();
                        self.input.byte_list.extend_from_slice(data);
                        *data = &[];
                        return None;
                    }
                    Err(error) => {
                        *data = &[];
                        return Some(broken(b"Failed to read data (stack path)", error));
                    }
                }
            }
            Input::Buffered => match self.read_buffered() {
                Ok(value) => value?,
                Err(error) => {
                    *input = Input::Borrowed(&[]);
                    return Some(broken(b"Failed to read data (buffer path)", error));
                }
            },
        };
        Some(self.route(value))
    }

    fn read_buffered(&mut self) -> Result<Option<RESPValue>, RedisError> {
        let buffered = self.input.remaining();
        if buffered.is_empty() || matches!(self.scanner.scan(buffered)?, ScanResult::NeedMoreData) {
            return Ok(None);
        }
        let mut reader = ValkeyReader::init(buffered);
        let value = reader.read_value()?;
        let len = reader.pos();
        self.input.consume(len);
        self.scanner.reset();
        Ok(Some(value))
    }

    fn route(&mut self, value: RESPValue) -> Event<P> {
        match self.state {
            State::Ready => self.on_reply(value),
            State::Hello => self.on_hello(value),
            State::Select(ref mut hello) => {
                let hello = core::mem::replace(&mut **hello, RESPValue::Null);
                self.on_select(value, hello)
            }
            State::Idle | State::Dialing | State::Ending(_) | State::Backoff | State::Closed => {
                Event::Ignored
            }
        }
    }

    fn on_hello(&mut self, value: RESPValue) -> Event<P> {
        use RedisError::{AuthenticationFailed, UnsupportedProtocol};
        match value {
            RESPValue::Error(message) => {
                // Redis 5 has no HELLO. It echoes the arguments, and the password is one.
                let echo = strings::split_once(&message, b" with args beginning with");
                let message = echo.map_or(&*message, |(it, _)| it.strip_suffix(b",").unwrap_or(it));
                refused(message, AuthenticationFailed)
            }
            RESPValue::SimpleString(ref text) if **text != *b"OK" => broken(
                b"Authentication failed (unexpected response)",
                AuthenticationFailed,
            ),
            RESPValue::Map(ref map)
                if map.iter().any(|entry| {
                    matches!(
                        (&entry.key, &entry.value),
                        (RESPValue::SimpleString(key), RESPValue::Integer(version))
                            if **key == *b"proto" && *version != 3
                    )
                }) =>
            {
                broken(b"Server does not support RESP3", UnsupportedProtocol)
            }
            RESPValue::SimpleString(_) | RESPValue::Map(_) if self.database > 0 => {
                self.state = State::Select(Box::new(value));
                Event::Ignored
            }
            RESPValue::SimpleString(_) | RESPValue::Map(_) => self.selected(value),
            _ => broken(
                b"Authentication failed with unexpected response",
                AuthenticationFailed,
            ),
        }
    }

    fn on_select(&mut self, value: RESPValue, hello: RESPValue) -> Event<P> {
        match value {
            RESPValue::SimpleString(text) if *text == *b"OK" => self.selected(hello),
            RESPValue::Error(message) => match refused(&message, RedisError::InvalidCommand) {
                // `onconnect` has to run for it to select again.
                Event::Broken { .. }
                    if self.script_authenticates && self.database != self.config.database =>
                {
                    self.database = self.config.database;
                    if self.database == 0 {
                        return self.selected(hello);
                    }
                    self.write_select();
                    self.state = State::Select(Box::new(hello));
                    Event::Ignored
                }
                refusal => refusal,
            },
            RESPValue::SimpleString(_) => broken(
                b"SELECT command failed with non-OK response",
                RedisError::InvalidResponse,
            ),
            _ => broken(
                b"Received non-SELECT response while in the SELECT state.",
                RedisError::InvalidResponse,
            ),
        }
    }

    /// The session is on its database.
    fn selected(&mut self, hello: RESPValue) -> Event<P> {
        let out = &mut self.output.byte_list;
        let mut unanswered = 0;
        for channel in self.listeners.confirmed_channels() {
            // `encode` alone grows it by no more than one command.
            out.reserve(channel.len() + 64);
            command::encode(b"SUBSCRIBE", &[channel], out);
            unanswered += 1;
        }
        if unanswered > 0 {
            // A peer that drops the connection on these uses up the retries.
            self.in_flight.push_back(InFlight::Restore(unanswered));
        } else {
            self.retries = 0;
        }
        self.state = State::Ready;
        self.was_ready = true;
        Event::Connected(hello)
    }

    fn on_reply(&mut self, value: RESPValue) -> Event<P> {
        match value {
            RESPValue::Push(push) => self.on_push(push),
            // The request it answers stays in flight: `fail` rejects it first.
            RESPValue::Error(message) if self.is_subscriber() && !self.is_restoring() => {
                Event::Broken {
                    message,
                    error: RedisError::ServerError,
                }
            }
            value => self.answer(value),
        }
    }

    fn is_restoring(&self) -> bool {
        matches!(self.in_flight.front(), Some(InFlight::Restore(_)))
    }

    #[cold]
    fn end_tail(&mut self) {
        self.tail = Tail::None;
    }

    #[inline(always)]
    fn answer(&mut self, value: RESPValue) -> Event<P> {
        if !matches!(self.tail, Tail::None) {
            self.end_tail();
        }
        let (expect, promise) = match self.in_flight.pop_front() {
            Some(InFlight::Plain(expect, promise)) => (expect, promise),
            Some(InFlight::Ack(request)) => return self.answer_without_ack(request, value),
            Some(InFlight::Restore(unanswered)) => {
                if unanswered > 1 {
                    self.in_flight.push_front(InFlight::Restore(unanswered - 1));
                } else {
                    self.retries = 0;
                }
                return Event::Ignored;
            }
            None => return Event::Ignored,
        };
        match (value, expect) {
            (RESPValue::Error(message), _) => Event::Rejected {
                promise,
                message,
                undo: Vec::new(),
            },
            (RESPValue::Integer(int), Expect::Reply(Reply::Bool)) => Event::Resolved {
                promise,
                value: RESPValue::Boolean(int > 0),
                as_buffer: false,
            },
            (RESPValue::SimpleString(text), Expect::Database(database)) => {
                // QUEUED: whether EXEC runs it is not tracked.
                self.database = match &*text {
                    b"OK" | b"RESET" => database,
                    _ if database == self.database => database,
                    _ => self.config.database,
                };
                Event::Resolved {
                    promise,
                    value: RESPValue::SimpleString(text),
                    as_buffer: false,
                }
            }
            (value, expect) => Event::Resolved {
                promise,
                value,
                as_buffer: matches!(expect, Expect::Reply(Reply::Buffer)),
            },
        }
    }

    #[cold]
    fn answer_without_ack(&mut self, request: Box<Request<P>>, value: RESPValue) -> Event<P> {
        if let RESPValue::Array(items) = &value
            && let [RESPValue::BulkString(Some(kind)), ..] = &**items
            && ACKS.get(kind).is_some_and(|it| it.subscribes())
            && request.kind.subscribes()
        {
            // `fail` rejects it first.
            self.in_flight.push_front(InFlight::Ack(request));
            return broken(
                b"Subscriptions need RESP3, but this connection uses RESP2",
                RedisError::UnsupportedProtocol,
            );
        }
        let Request {
            promise,
            names,
            ticket,
            ..
        } = *request;
        if let RESPValue::Error(message) = value {
            let undo = ticket.map_or_else(Vec::new, |it| self.listeners.refuse(it, names));
            return Event::Rejected {
                promise,
                message,
                undo,
            };
        }
        if let Some(ticket) = ticket {
            self.listeners.confirm(ticket);
        }
        Event::Resolved {
            promise,
            value,
            as_buffer: false,
        }
    }

    fn on_push(&mut self, push: Push) -> Event<P> {
        let kind = match &*push.kind {
            b"message" if self.is_subscriber() => return Event::Message(push.data),
            b"pmessage" | b"smessage" if self.is_subscriber() => return Event::PatternMessage,
            kind => ACKS.get(kind),
        };
        let Some(&kind) = kind else {
            return self.on_unknown_push(push);
        };
        if kind == Ack::Subscribe && self.is_restoring() {
            self.mode = Mode::Subscriber;
            return self.answer(RESPValue::Null);
        }
        if self.tail.take(kind, &push.data) {
            return Event::Ignored;
        }
        self.tail = Tail::None;
        // EXEC can leave one over, and a cluster unsubscribes unasked.
        let request = self.in_flight.pop_front_if(
            |it| matches!(it, InFlight::Ack(it) if it.kind.subscribes() == kind.subscribes()),
        );
        let promise = match request {
            Some(InFlight::Ack(request)) => {
                if let Some(ticket) = request.ticket {
                    self.listeners.confirm(ticket);
                }
                self.tail = Tail::after(request.kind, request.names, &push.data);
                Some(request.promise)
            }
            other => other.and_then(InFlight::into_promise),
        };
        let acked = match promise {
            None if !self.is_subscriber() => return Event::Ignored,
            None => Acked::Nobody,
            Some(promise) if matches!(kind, Ack::Subscribe | Ack::Unsubscribe) => {
                Acked::Channel(promise)
            }
            Some(promise) => Acked::Raw(promise, RESPValue::Push(push)),
        };
        if kind.subscribes() {
            self.mode = Mode::Subscriber;
            Event::Subscribed(acked)
        } else {
            self.leave_subscriber_mode_without_listeners();
            Event::Unsubscribed(acked)
        }
    }

    #[cold]
    fn on_unknown_push(&mut self, push: Push) -> Event<P> {
        // A second prefix (`spsubscribe`) counts as a reply.
        if !matches!(&*push.kind, [b'p' | b's', rest @ ..] if ACKS.get(rest).is_some()) {
            return Event::Ignored;
        }
        match self.in_flight.front() {
            None | Some(InFlight::Plain(..)) if !self.is_subscriber() => {
                self.answer(RESPValue::Push(push))
            }
            _ => broken(
                b"Unexpected push message kind without promise",
                RedisError::InvalidResponseType,
            ),
        }
    }
}
