//! The client without its socket, timers and script: every method returns what is left to do.

use std::collections::VecDeque;
use std::num::NonZeroU32;

use bun_collections::OffsetByteList;
use bun_core::strings;

use crate::command::{self, ACKS, Ack, Reply};
use crate::valkey_protocol::{Push, RESPValue, RedisError, ReplyScanner, ScanResult, ValkeyReader};
use State::{Backoff, Closed, Ending, Idle, Opening, Queuing, Ready, Spare};

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

/// With a tag of its own: one in a niche costs every command its decoding.
#[repr(u8)]
enum State {
    /// Never dialed, or only by a [`Client::preconnect`] that failed.
    Idle,
    Opening(Step, By),
    /// Connected, but script has not touched the client.
    Spare,
    Ready,
    /// As [`Ready`], inside MULTI. Holds what is queued from the first SELECT or request for bytes on: EXEC's last results answer it.
    Queuing(Vec<Expect>),
    /// The socket is closing, or the dial gave none: [`Client::lost`] is due.
    Ending(End),
    /// A dial is due, from the retry timer or from `connect()`.
    Backoff(Goal),
    /// Until [`Client::connect`].
    Closed,
}

enum Step {
    /// The socket is connecting, or in its TLS handshake.
    Dial,
    /// HELLO is written, and SELECT behind it if there is a database.
    Hello,
    /// HELLO was accepted with this; the reply to SELECT is due. Boxed to keep the state small.
    Select(Box<RESPValue>),
}

/// Since the server last took a connection.
type Retries = u32;

#[derive(Copy, Clone)]
enum By {
    /// Script has not touched the client: one attempt, and back to `Idle`.
    Flag,
    Script(Goal),
}

impl By {
    fn claimed(self) -> Goal {
        match self {
            By::Flag => Goal::FIRST,
            By::Script(goal) => goal,
        }
    }
}

#[derive(Copy, Clone)]
enum Goal {
    Connect(Retries),
    /// Replaces a connection that script had.
    Reconnect(NonZeroU32),
    /// A reconnect that a busy or silent server has turned away, which can go on for minutes.
    Outlast(NonZeroU32),
}

impl Goal {
    const FIRST: Self = Goal::Connect(0);

    fn retries(self) -> Retries {
        match self {
            Goal::Connect(retries) => retries,
            Goal::Reconnect(retries) | Goal::Outlast(retries) => retries.get(),
        }
    }
}

#[derive(Copy, Clone)]
enum End {
    /// The retry policy decides.
    Policy(By),
    /// By [`Client::close`]; as [`End::Final`], until [`Client::connect`] takes it back.
    Requested(Retries),
    /// No retry; what is queued until then is rejected.
    Final,
    /// No retry; everything is rejected already, and new commands are refused.
    Failed,
    /// As [`End::Failed`], but script has not touched the client.
    FailedUnclaimed,
}

#[derive(Copy, Clone)]
enum Expect {
    Reply(Reply),
    /// Whichever acknowledgement comes next: a count would shift every later reply once a peer sent fewer.
    Ack,
    /// Confirms the database to come back to.
    Database(u32),
    Multi,
    /// For the results of the commands that did not ask for bytes themselves.
    Exec(Reply),
}

impl Expect {
    fn reply(self) -> Reply {
        match self {
            Expect::Reply(reply) | Expect::Exec(reply) => reply,
            Expect::Ack | Expect::Database(_) | Expect::Multi => Reply::Value,
        }
    }

    fn matters_at_exec(self) -> bool {
        matches!(self, Expect::Database(_)) || self.reply().keeps_bytes()
    }

    #[cold]
    fn select(database: &[u8], reply: Reply) -> Self {
        bun_core::fmt::parse_unsigned(database, 10).map_or(Expect::Reply(reply), Expect::Database)
    }
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
    /// For the next handshake: the config's, until the server confirms another.
    database: u32,
    state: State,
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
    /// With the reply to HELLO, once the handshake is complete.
    Connected(RESPValue),
    Resolved {
        promise: P,
        value: RESPValue,
        reply: Reply,
    },
    /// Each result is converted, or refused, on its own.
    Executed {
        promise: P,
        results: Vec<(RESPValue, Reply)>,
    },
    Rejected {
        promise: P,
        message: Box<[u8]>,
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
    Busy(Box<[u8]>),
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

/// Whether the process has to stay for the client's next event.
#[derive(Debug, PartialEq, Eq)]
pub enum Awaited {
    No,
    /// Work: commands and subscriptions.
    ByWorkOrBytes,
    ByWorkOrHandlers,
    Yes,
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
    ForGood { reason: Reason, pending: Vec<P> },
    Retry { delay_ms: u32, in_flight: Vec<P> },
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
        Event::Busy(message.into())
    } else {
        broken(message, error)
    }
}

impl<P> Client<P> {
    pub fn new(config: Config) -> Self {
        Self {
            database: config.database,
            config,
            state: Idle,
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

    pub fn is_dialing(&self) -> bool {
        matches!(self.state, Opening(Step::Dial, _))
    }

    pub fn is_connected(&self) -> bool {
        match self.state {
            Ready | Queuing(_) | Spare => true,
            Idle | Opening(..) | Ending(_) | Backoff(_) | Closed => false,
        }
    }

    pub fn is_ending(&self) -> bool {
        matches!(self.state, Ending(_))
    }

    pub fn awaited(&self) -> Awaited {
        match self.state {
            Idle | Spare | Closed => Awaited::No,
            Opening(_, By::Flag) | Ending(End::Policy(By::Flag) | End::FailedUnclaimed) => {
                Awaited::No
            }
            Ready | Queuing(_) => Awaited::ByWorkOrBytes,
            Opening(_, By::Script(goal))
            | Ending(End::Policy(By::Script(goal)))
            | Backoff(goal) => match goal {
                Goal::Connect(_) | Goal::Reconnect(_) => Awaited::Yes,
                Goal::Outlast(_) => Awaited::ByWorkOrHandlers,
            },
            Ending(End::Requested(_) | End::Final | End::Failed) => Awaited::Yes,
        }
    }

    fn has_failed(&self) -> bool {
        match self.state {
            Ending(End::Failed | End::FailedUnclaimed) | Closed => true,
            Ending(End::Policy(_) | End::Requested(_) | End::Final) => false,
            Idle | Opening(..) | Ready | Queuing(_) | Spare | Backoff(_) => false,
        }
    }

    pub fn is_subscriber(&self) -> bool {
        self.is_subscriber
    }

    pub fn leave_subscriber_mode(&mut self) {
        self.is_subscriber = false;
    }

    pub fn has_commands(&self) -> bool {
        !self.in_flight.is_empty() || !self.queue.is_empty()
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

    /// An explicit `connect()`, ahead of [`Self::claim_and_dial`] and [`Self::redial`].
    pub fn connect(&mut self) {
        match self.state {
            Backoff(_) | Closed => self.state = Backoff(Goal::FIRST),
            // The close of a dial without a TLS context is still due, and no retry can build one.
            Ending(End::Failed | End::FailedUnclaimed) => self.state = Ending(End::Final),
            Ending(End::Requested(retries)) => {
                self.state = Ending(End::Policy(By::Script(Goal::Connect(retries))));
            }
            Opening(_, ref mut by) | Ending(End::Policy(ref mut by)) => {
                *by = By::Script(Goal::Connect(by.claimed().retries()));
            }
            Spare => self.claim(),
            Idle | Ready | Queuing(_) | Ending(End::Final) => {}
        }
    }

    pub fn close(&mut self) -> Close {
        let (end, close) = match self.state {
            Idle | Ending(End::Requested(_) | End::Final | End::Failed) | Closed => {
                return Close::Nothing;
            }
            Ending(End::FailedUnclaimed) => (End::Failed, Close::Nothing),
            Ending(End::Policy(by)) => (End::Requested(by.claimed().retries()), Close::Nothing),
            Opening(_, by) => (End::Requested(by.claimed().retries()), Close::Socket),
            Ready | Queuing(_) | Spare => (End::Requested(0), Close::Socket),
            Backoff(goal) => (End::Requested(goal.retries()), Close::Retry(Attempt(()))),
        };
        self.state = Ending(end);
        close
    }

    /// Script touched the client.
    pub fn claim(&mut self) {
        match self.state {
            Opening(_, ref mut by) | Ending(End::Policy(ref mut by)) => {
                *by = By::Script(by.claimed());
            }
            Spare => self.state = Ready,
            Ending(End::FailedUnclaimed) => self.state = Ending(End::Failed),
            Ending(End::Requested(_) | End::Final | End::Failed) => {}
            Idle | Ready | Queuing(_) | Backoff(_) | Closed => {}
        }
    }

    /// Ahead of every command.
    #[must_use]
    pub fn claim_and_dial(&mut self) -> Option<Attempt> {
        self.claim();
        self.leave_idle(By::Script(Goal::FIRST))
    }

    /// A dial that script did not ask for. If it is lost unclaimed, the first command dials again.
    #[must_use]
    pub fn preconnect(&mut self) -> Option<Attempt> {
        self.leave_idle(By::Flag)
    }

    fn leave_idle(&mut self, by: By) -> Option<Attempt> {
        matches!(self.state, Idle).then(|| self.dial(by))
    }

    #[must_use]
    pub fn redial(&mut self) -> Option<Attempt> {
        let Backoff(goal) = self.state else {
            return None;
        };
        Some(self.dial(By::Script(goal)))
    }

    fn dial(&mut self, by: By) -> Attempt {
        self.state = Opening(Step::Dial, by);
        Attempt(())
    }

    /// The dial gave no socket.
    pub fn dial_failed(&mut self) {
        if let Opening(Step::Dial, by) = self.state {
            self.state = Ending(End::Policy(by));
        }
    }

    /// The transport is up. A TLS renegotiation says so again.
    pub fn start(&mut self) {
        let Opening(Step::Dial, by) = self.state else {
            return;
        };
        self.state = Opening(Step::Hello, by);
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
        self.write_select();
    }

    fn write_select(&mut self) {
        if self.database > 0 {
            let mut digits = bun_core::fmt::ItoaBuf::new();
            let database = bun_core::fmt::itoa(&mut digits, self.database);
            command::encode(b"SELECT", &[database], &mut self.output.byte_list);
        }
    }

    /// Gives up the attempt, if there is one, without a retry: the caller rejects these and closes the socket.
    #[must_use]
    pub fn fail(&mut self) -> Option<Vec<P>> {
        self.state = Ending(match self.state {
            Idle | Backoff(_) | Ending(End::Failed | End::FailedUnclaimed) | Closed => return None,
            Opening(_, By::Flag) | Spare | Ending(End::Policy(By::Flag)) => End::FailedUnclaimed,
            Ending(End::Policy(By::Script(_)) | End::Requested(_) | End::Final) => End::Failed,
            Opening(_, By::Script(_)) | Ready | Queuing(_) => End::Failed,
        });
        Some(self.take_pending())
    }

    /// For a reason that passes. Whether that costs only this attempt: the caller closes the socket, else it fails.
    #[must_use]
    pub fn abandon_handshake(&mut self) -> bool {
        let Opening(_, By::Script(Goal::Reconnect(n) | Goal::Outlast(n))) = self.state else {
            return false;
        };
        self.state = Ending(End::Policy(By::Script(Goal::Outlast(n))));
        true
    }

    /// The TLS session broke. `Some` if that counts as a lost connection and not as a failed handshake.
    #[must_use]
    pub fn session_broke(&mut self) -> Option<Vec<P>> {
        let said_hello = self.is_connected() || matches!(self.state, Opening(Step::Select(_), _));
        (said_hello && self.config.enable_auto_reconnect).then(|| self.take_in_flight())
    }

    /// The socket closed, or there never was one.
    pub fn lost(&mut self, Attempt(()): Attempt, owner_is_gone: bool) -> Lost<P> {
        self.output.clear_and_free();
        self.input.clear_and_free();
        self.scanner.reset();

        let next = match self.state {
            Opening(_, By::Script(goal))
            | Ending(End::Policy(By::Script(goal)))
            | Backoff(goal) => Ok(match goal {
                Goal::Connect(n) => Goal::Connect(n.saturating_add(1)),
                Goal::Reconnect(n) => Goal::Reconnect(n.saturating_add(1)),
                Goal::Outlast(n) => Goal::Outlast(n.saturating_add(1)),
            }),
            Ready | Queuing(_) => Ok(Goal::Reconnect(NonZeroU32::MIN)),
            Opening(_, By::Flag) | Spare | Ending(End::Policy(By::Flag) | End::FailedUnclaimed) => {
                Err((Idle, Reason::Final))
            }
            Ending(End::Requested(_)) => Err((Closed, Reason::Requested)),
            Idle | Ending(End::Final | End::Failed) | Closed => Err((Closed, Reason::Final)),
        };
        let (state, reason) = match next {
            Err(over) => over,
            Ok(_) if owner_is_gone || !self.config.enable_auto_reconnect => (Closed, Reason::Final),
            Ok(goal) if goal.retries() > self.config.max_retries => (Closed, Reason::RetriesUsedUp),
            Ok(goal) => {
                self.state = Backoff(goal);
                return Lost::Retry {
                    delay_ms: (FIRST_DELAY_MS << (goal.retries().min(10) - 1)).min(MAX_DELAY_MS),
                    in_flight: self.take_in_flight(),
                };
            }
        };
        self.state = state;
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
        let is = |command: &[u8]| name.eq_ignore_ascii_case(command);
        let expect = match (ACKS.get_ascii_case_insensitive(name), args) {
            (Some(_), _) => Expect::Ack,
            (None, _) if is(b"EXEC") => Expect::Exec(reply),
            (None, []) if is(b"MULTI") => Expect::Multi,
            (None, []) if is(b"RESET") => Expect::Database(self.config.database),
            (None, [database]) if is(b"SELECT") => Expect::select(database.as_ref(), reply),
            (None, _) => Expect::Reply(reply),
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
    #[must_use]
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
        // Spares every reply the move below.
        if let Ready = self.state {
            return self.on_reply(value);
        }
        let event;
        (self.state, event) = match core::mem::replace(&mut self.state, Closed) {
            Opening(Step::Hello, by) => self.on_hello(value, by),
            Opening(Step::Select(hello), by) => self.on_select(value, hello, by),
            Queuing(queued) => {
                self.state = self.ahead_of_reply_in_multi(&value, queued);
                return self.on_reply(value);
            }
            state @ (Ready | Spare) => {
                self.state = state;
                return self.on_reply(value);
            }
            state @ (Idle | Opening(Step::Dial, _) | Ending(_) | Backoff(_) | Closed) => {
                (state, Event::Ignored)
            }
        };
        event
    }

    fn on_hello(&self, value: RESPValue, by: By) -> (State, Event<P>) {
        use RedisError::{AuthenticationFailed, UnsupportedProtocol};
        let refusal = match value {
            RESPValue::Error(message) => {
                // Redis 5 has no HELLO. It echoes the arguments, and the password is one.
                let echo = strings::split_once(&message, b", with args beginning with");
                let message = echo.map_or(&*message, |(message, _)| message);
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
            RESPValue::SimpleString(_) | RESPValue::Map(_) => return self.greeted(value, by),
            _ => broken(
                b"Authentication failed with unexpected response",
                AuthenticationFailed,
            ),
        };
        (Opening(Step::Hello, by), refusal)
    }

    fn greeted(&self, hello: RESPValue, by: By) -> (State, Event<P>) {
        if self.database > 0 {
            (Opening(Step::Select(Box::new(hello)), by), Event::Ignored)
        } else {
            (Self::connected(by), Event::Connected(hello))
        }
    }

    fn on_select(&mut self, value: RESPValue, hello: Box<RESPValue>, by: By) -> (State, Event<P>) {
        let refusal = match value {
            RESPValue::SimpleString(text) if *text == *b"OK" => {
                return (Self::connected(by), Event::Connected(*hello));
            }
            // Script selected after an AUTH of its own, and needs `onconnect` to send it again.
            RESPValue::Error(message)
                if self.database != self.config.database
                    && (message.starts_with(b"NOPERM ") || message.starts_with(b"NOAUTH ")) =>
            {
                self.database = self.config.database;
                self.write_select();
                return self.greeted(*hello, by);
            }
            RESPValue::Error(message) => refused(&message, RedisError::InvalidCommand),
            RESPValue::SimpleString(_) => broken(
                b"SELECT command failed with non-OK response",
                RedisError::InvalidResponse,
            ),
            _ => broken(
                b"Received non-SELECT response while in the SELECT state.",
                RedisError::InvalidResponse,
            ),
        };
        // Else no `connect()` would ever succeed again.
        if let Event::Broken { .. } = refusal {
            self.database = self.config.database;
        }
        (Opening(Step::Select(hello), by), refusal)
    }

    fn connected(by: By) -> State {
        match by {
            By::Flag => Spare,
            By::Script(_) => Ready,
        }
    }

    fn ahead_of_reply_in_multi(&self, value: &RESPValue, mut queued: Vec<Expect>) -> State {
        match (value, self.in_flight.front().map(|it| it.expect)) {
            (RESPValue::Push(_), _) | (_, None) => Queuing(queued),
            // For `answer_tracked`.
            (RESPValue::Array(_), Some(Expect::Exec(_))) => Queuing(queued),
            (_, Some(Expect::Exec(_))) => Ready,
            (RESPValue::Error(_), _) => Queuing(queued),
            (RESPValue::SimpleString(text), Some(expect)) if **text == *b"QUEUED" => {
                if !queued.is_empty() || expect.matters_at_exec() {
                    queued.push(expect);
                }
                Queuing(queued)
            }
            // To DISCARD or RESET.
            _ => Ready,
        }
    }

    fn on_reply(&mut self, value: RESPValue) -> Event<P> {
        match value {
            RESPValue::Push(push) => self.on_push(push),
            // The request it answers stays in flight: `fail` rejects it first.
            RESPValue::Error(message) if self.is_subscriber => Event::Broken {
                message,
                error: RedisError::ServerError,
            },
            value => self.answer(value),
        }
    }

    fn answer(&mut self, value: RESPValue) -> Event<P> {
        let Some(InFlight { expect, promise }) = self.in_flight.pop_front() else {
            return Event::Ignored;
        };
        match value {
            RESPValue::Error(message) => Event::Rejected { promise, message },
            RESPValue::Integer(int) if matches!(expect, Expect::Reply(Reply::Bool)) => {
                Event::Resolved {
                    promise,
                    value: RESPValue::Boolean(int > 0),
                    reply: Reply::Bool,
                }
            }
            value => match expect {
                Expect::Reply(reply) => Event::Resolved {
                    promise,
                    value,
                    reply,
                },
                expect => self.answer_tracked(value, expect, promise),
            },
        }
    }

    #[cold]
    fn answer_tracked(&mut self, mut value: RESPValue, expect: Expect, promise: P) -> Event<P> {
        match (&mut value, expect, &mut self.state) {
            (RESPValue::SimpleString(status), Expect::Database(database), _)
                if matches!(&**status, b"OK" | b"RESET") =>
            {
                self.database = database;
            }
            (_, Expect::Multi, Ready) => self.state = Queuing(Vec::new()),
            (RESPValue::Array(results), Expect::Exec(others), Queuing(queued)) => {
                let queued = core::mem::take(queued);
                self.state = Ready;
                if !queued.is_empty() || others.keeps_bytes() {
                    let results = self.executed(results, others, queued);
                    return Event::Executed { promise, results };
                }
            }
            _ => {}
        }
        Event::Resolved {
            promise,
            value,
            reply: expect.reply(),
        }
    }

    fn executed(
        &mut self,
        results: &mut Vec<RESPValue>,
        others: Reply,
        queued: Vec<Expect>,
    ) -> Vec<(RESPValue, Reply)> {
        let mut results: Vec<_> = results.drain(..).map(|it| (it, others)).collect();
        let mut last = None;
        for ((result, reply), expect) in results.iter_mut().rev().zip(queued.into_iter().rev()) {
            match (result, expect) {
                (RESPValue::SimpleString(text), Expect::Database(it)) if **text == *b"OK" => {
                    last = last.or(Some(it));
                }
                (_, Expect::Reply(own)) if own.keeps_bytes() => *reply = own,
                _ => {}
            }
        }
        self.database = last.unwrap_or(self.database);
        results
    }

    fn on_push(&mut self, push: Push) -> Event<P> {
        let kind = match &*push.kind {
            b"message" if self.is_subscriber => return Event::Message(push.data),
            b"pmessage" | b"smessage" if self.is_subscriber => return Event::PatternMessage,
            kind => ACKS.get(kind),
        };
        let Some(&kind) = kind else {
            return self.on_unknown_push(push);
        };
        let request = self
            .in_flight
            .pop_front_if(|it| matches!(it.expect, Expect::Ack));
        let acked = match request.map(|it| it.promise) {
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

    fn on_unknown_push(&mut self, push: Push) -> Event<P> {
        // A second prefix (`spsubscribe`) counts as a reply.
        if !matches!(&*push.kind, [b'p' | b's', rest @ ..] if ACKS.get(rest).is_some()) {
            return Event::Ignored;
        }
        match self.in_flight.front().map(|it| it.expect) {
            None
            | Some(Expect::Reply(_) | Expect::Database(_) | Expect::Multi | Expect::Exec(_))
                if !self.is_subscriber =>
            {
                self.answer(RESPValue::Push(push))
            }
            _ => broken(
                b"Unexpected push message kind without promise",
                RedisError::InvalidResponseType,
            ),
        }
    }
}
