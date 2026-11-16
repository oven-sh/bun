//! The client without its socket, timers and script: every method returns what is left to do.

use std::collections::VecDeque;

use bun_collections::OffsetByteList;

use crate::command::{self, ACKS, Ack, Reply};
use crate::valkey_protocol::{Push, RESPValue, RedisError, ReplyScanner, ScanResult, ValkeyReader};

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
    /// Never dialed.
    Idle,
    /// The socket is connecting, or in its TLS handshake.
    Dialing,
    /// HELLO is written, and SELECT behind it if there is a database.
    Hello,
    /// HELLO was accepted with this reply; the reply to SELECT is due.
    Select(Box<RESPValue>),
    /// With the acknowledgements still due for the request answered last.
    Ready(Option<Acks>),
    /// The socket is closing, or the dial gave none: [`Client::lost`] is due.
    Ending(End),
    /// Between two dials.
    Backoff,
    /// Until [`Client::connect`].
    Closed,
}

#[derive(Copy, Clone)]
enum End {
    /// The retry policy decides.
    Policy,
    /// No retry; what is queued until then is rejected.
    Final,
    /// No retry; everything is rejected already, and new commands are refused.
    Failed,
}

/// A subscription request draws one acknowledgement per argument; the first answers it.
#[derive(Copy, Clone)]
struct Acks {
    kind: Ack,
    following: u32,
}

#[derive(Copy, Clone)]
enum Expect {
    Reply(Reply),
    Acks(Acks),
}

struct InFlight<P> {
    expect: Expect,
    promise: P,
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
    is_subscriber: bool,
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
    /// The handshake is over, with the reply to HELLO.
    Connected(RESPValue),
    Resolved {
        promise: P,
        value: RESPValue,
        as_buffer: bool,
    },
    Rejected {
        promise: P,
        message: Box<[u8]>,
    },
    Message(Vec<RESPValue>),
    PatternMessage,
    Subscribed(Acked<P>),
    Unsubscribed(Acked<P>),
    /// For [`Client::fail`].
    Broken {
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
    /// There is no socket: disarm the retry and call [`Client::lost`].
    Retry,
}

#[must_use]
pub enum Lost<P> {
    ForGood {
        reason: &'static str,
        pending: Vec<P>,
    },
    Retry {
        delay_ms: u32,
        in_flight: Vec<P>,
    },
}

fn broken<P>(message: &[u8], error: RedisError) -> Event<P> {
    Event::Broken {
        message: message.into(),
        error,
    }
}

impl<P> Client<P> {
    pub fn new(config: Config) -> Self {
        Self {
            config,
            state: State::Idle,
            retries: 0,
            is_subscriber: false,
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

    pub fn never_dialed(&self) -> bool {
        matches!(self.state, State::Idle)
    }

    pub fn is_connected(&self) -> bool {
        matches!(self.state, State::Ready(_))
    }

    pub fn is_ending(&self) -> bool {
        matches!(self.state, State::Ending(_))
    }

    pub fn awaits_retry(&self) -> bool {
        matches!(self.state, State::Backoff)
    }

    /// An event is still to come.
    pub fn is_active(&self) -> bool {
        !matches!(self.state, State::Idle | State::Closed)
    }

    fn has_failed(&self) -> bool {
        matches!(self.state, State::Ending(End::Failed) | State::Closed)
    }

    pub fn is_subscriber(&self) -> bool {
        self.is_subscriber
    }

    pub fn leave_subscriber_mode(&mut self) {
        self.is_subscriber = false;
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

    /// An explicit `connect()`; the caller dials if [`Self::never_dialed`] or [`Self::awaits_retry`].
    pub fn connect(&mut self) {
        match self.state {
            State::Backoff | State::Closed => {
                self.retries = 0;
                self.state = State::Backoff;
            }
            State::Ending(End::Failed) => self.state = State::Ending(End::Final),
            State::Ending(End::Final) => self.state = State::Ending(End::Policy),
            State::Idle
            | State::Dialing
            | State::Hello
            | State::Select(_)
            | State::Ready(_)
            | State::Ending(End::Policy) => {}
        }
    }

    pub fn close(&mut self) -> Close {
        let close = match self.state {
            State::Idle | State::Closed | State::Ending(End::Failed) => return Close::Nothing,
            State::Ending(End::Policy | End::Final) => Close::Nothing,
            State::Dialing | State::Hello | State::Select(_) | State::Ready(_) => Close::Socket,
            State::Backoff => Close::Retry,
        };
        self.state = State::Ending(End::Final);
        close
    }

    pub fn dial(&mut self) {
        debug_assert!(self.never_dialed() || self.awaits_retry());
        self.state = State::Dialing;
    }

    /// The dial gave no socket; the caller owes a [`Self::lost`].
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
            username,
            password,
            database,
            ..
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
        if *database > 0 {
            let mut digits = bun_core::fmt::ItoaBuf::new();
            let database = bun_core::fmt::itoa(&mut digits, *database);
            command::encode(b"SELECT", &[database], out);
        }
    }

    /// Gives up without a retry. `None` if it already has; else the caller rejects these and closes the socket.
    pub fn fail(&mut self) -> Option<Vec<P>> {
        self.state = match self.state {
            State::Ending(End::Failed) | State::Closed => return None,
            State::Idle | State::Backoff => State::Closed,
            State::Dialing
            | State::Hello
            | State::Select(_)
            | State::Ready(_)
            | State::Ending(End::Policy | End::Final) => State::Ending(End::Failed),
        };
        Some(self.take_pending())
    }

    /// The TLS session broke. `Some` if that counts as a lost connection and not as a failed handshake.
    pub fn session_broke(&mut self) -> Option<Vec<P>> {
        let greeted = matches!(self.state, State::Select(_) | State::Ready(_));
        (greeted && self.config.enable_auto_reconnect).then(|| self.take_in_flight())
    }

    /// The socket closed, or there never was one.
    pub fn lost(&mut self, owner_is_gone: bool) -> Lost<P> {
        self.output.clear_and_free();
        self.input.clear_and_free();
        self.scanner.reset();

        let is_final = matches!(self.state, State::Ending(End::Final | End::Failed));
        let reason = if is_final || owner_is_gone || !self.config.enable_auto_reconnect {
            "Connection closed"
        } else {
            self.retries += 1;
            if self.retries <= self.config.max_retries {
                self.state = State::Backoff;
                return Lost::Retry {
                    delay_ms: (50 << (self.retries.min(10) - 1)).min(2000),
                    in_flight: self.take_in_flight(),
                };
            }
            "Max reconnection attempts reached"
        };
        self.state = State::Closed;
        Lost::ForGood {
            reason,
            pending: self.take_pending(),
        }
    }

    fn take_in_flight(&mut self) -> Vec<P> {
        let in_flight = core::mem::take(&mut self.in_flight);
        in_flight.into_iter().map(|it| it.promise).collect()
    }

    fn take_pending(&mut self) -> Vec<P> {
        let mut pending = self.take_in_flight();
        let queue = core::mem::take(&mut self.queue);
        pending.extend(queue.into_iter().map(|it| it.request.promise));
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
            Some(&kind) => Expect::Acks(Acks {
                kind,
                following: args.len().saturating_sub(1) as u32,
            }),
            None => Expect::Reply(reply),
        };
        let request = InFlight { expect, promise };
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
        match &mut self.state {
            State::Ready(_) => self.on_reply(value),
            State::Hello => self.on_hello(value),
            State::Select(hello) => {
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
            RESPValue::Error(message) => Event::Broken {
                message,
                error: AuthenticationFailed,
            },
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
            RESPValue::SimpleString(_) | RESPValue::Map(_) if self.config.database > 0 => {
                self.state = State::Select(Box::new(value));
                Event::Ignored
            }
            RESPValue::SimpleString(_) | RESPValue::Map(_) => self.connected(value),
            _ => broken(
                b"Authentication failed with unexpected response",
                AuthenticationFailed,
            ),
        }
    }

    fn on_select(&mut self, value: RESPValue, hello: RESPValue) -> Event<P> {
        match value {
            RESPValue::SimpleString(text) if *text == *b"OK" => self.connected(hello),
            RESPValue::Error(message) => Event::Broken {
                message,
                error: RedisError::InvalidCommand,
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

    fn connected(&mut self, hello: RESPValue) -> Event<P> {
        self.state = State::Ready(None);
        self.retries = 0;
        Event::Connected(hello)
    }

    fn on_reply(&mut self, value: RESPValue) -> Event<P> {
        let value = match value {
            RESPValue::Push(push) => return self.on_push(push),
            // The request it answers stays in flight: `fail` rejects it first.
            RESPValue::Error(message) if self.is_subscriber => {
                return Event::Broken {
                    message,
                    error: RedisError::ServerError,
                };
            }
            value => value,
        };
        let Some(InFlight { expect, promise }) = self.in_flight.pop_front() else {
            return Event::Ignored;
        };
        match (value, expect) {
            (RESPValue::Error(message), _) => Event::Rejected { promise, message },
            (RESPValue::Integer(int), Expect::Reply(Reply::Bool)) => Event::Resolved {
                promise,
                value: RESPValue::Boolean(int > 0),
                as_buffer: false,
            },
            (value, expect) => Event::Resolved {
                promise,
                value,
                as_buffer: matches!(expect, Expect::Reply(Reply::Buffer)),
            },
        }
    }

    fn on_push(&mut self, push: Push) -> Event<P> {
        let kind = match &*push.kind {
            b"message" if self.is_subscriber => return Event::Message(push.data),
            b"pmessage" | b"smessage" if self.is_subscriber => return Event::PatternMessage,
            kind => ACKS.get(kind),
        };
        let Some(&kind) = kind else {
            return Event::Ignored;
        };
        let acked = match self.take_acknowledged(kind) {
            None if !self.is_subscriber => return Event::Ignored,
            None => Acked::Nobody,
            Some(promise) if matches!(kind, Ack::Subscribe | Ack::Unsubscribe) => {
                Acked::Channel(promise)
            }
            Some(promise) => Acked::Raw(promise, RESPValue::Push(push)),
        };
        match kind {
            Ack::Subscribe | Ack::PSubscribe | Ack::SSubscribe => {
                self.is_subscriber = true;
                Event::Subscribed(acked)
            }
            Ack::Unsubscribe | Ack::PUnsubscribe | Ack::SUnsubscribe => Event::Unsubscribed(acked),
        }
    }

    fn take_acknowledged(&mut self, kind: Ack) -> Option<P> {
        if let State::Ready(Some(owed)) = &mut self.state
            && owed.kind == kind
            && owed.following > 0
        {
            owed.following -= 1;
            return None;
        }
        match self.in_flight.front()?.expect {
            Expect::Acks(acks) if acks.kind == kind => self.state = State::Ready(Some(acks)),
            Expect::Acks(_) | Expect::Reply(_) => return None,
        }
        self.in_flight.pop_front().map(|it| it.promise)
    }
}
