use bun_valkey::client::{
    Acked, Attempt, Awaited, Client, Close, Config, Event, Lost, Reason, Sent,
};
use bun_valkey::command::Reply;
use bun_valkey::valkey_protocol::RESPValue;

/// Stands in for wtf-bindings.cpp; no test sends a double.
#[unsafe(no_mangle)]
extern "C" fn WTF__parseDouble(_: *const u8, _: usize, _: *mut usize) -> f64 {
    unreachable!()
}

/// Stands in for highway_strings.cpp.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memmem(
    text: *const u8,
    len: usize,
    part: *const u8,
    part_len: usize,
) -> *const u8 {
    use core::slice::from_raw_parts;
    // SAFETY: the caller passes two slices.
    let (text, part) = unsafe { (from_raw_parts(text, len), from_raw_parts(part, part_len)) };
    (text.windows(part_len).find(|window| *window == part))
        .map_or(core::ptr::null(), <[u8]>::as_ptr)
}

#[unsafe(no_mangle)]
extern "C" fn highway_index_of_char(_: *const u8, _: usize, _: u8) -> usize {
    unreachable!()
}

const HELLO: &str = "%1\r\n+proto\r\n:3\r\n";

fn show(value: &RESPValue) -> String {
    match value {
        RESPValue::SimpleString(it) | RESPValue::BulkString(Some(it)) => {
            it.escape_ascii().to_string()
        }
        RESPValue::Integer(it) => it.to_string(),
        RESPValue::Boolean(it) => it.to_string(),
        RESPValue::Map(it) => format!("map of {}", it.len()),
        RESPValue::Push(it) => format!(">{} {}", it.kind.escape_ascii(), show(&it.data[0])),
        _ => "?".into(),
    }
}

fn push(kind: &str, name: &str) -> String {
    format!(
        ">3\r\n${}\r\n{kind}\r\n${}\r\n{name}\r\n:1\r\n",
        kind.len(),
        name.len()
    )
}

/// Does what the runtime does with each result, and writes it down.
struct Driver {
    client: Client<u32>,
    attempt: Option<Attempt>,
    sent: u32,
    /// How much the socket still takes.
    window: usize,
    batch_is_due: bool,
    has_listeners: bool,
    log: Vec<String>,
}

impl Driver {
    fn new(config: Config) -> Self {
        Driver {
            client: Client::new(config),
            attempt: None,
            sent: 0,
            window: usize::MAX,
            batch_is_due: false,
            has_listeners: false,
            log: Vec::new(),
        }
    }

    fn connected(config: Config) -> Self {
        let mut this = Self::new(config);
        this.handshake();
        this
    }

    fn dial(&mut self) {
        let attempt = self
            .client
            .claim_and_dial()
            .or_else(|| self.client.redial());
        self.attempt = Some(attempt.unwrap());
    }

    fn handshake(&mut self) {
        self.dial();
        self.start();
        self.read(HELLO);
        assert!(self.client.is_connected());
        self.log.clear();
    }

    fn take(&mut self) -> Vec<String> {
        core::mem::take(&mut self.log)
    }

    fn flush(&mut self) {
        let len = self.client.output().len().min(self.window);
        if len > 0 {
            let words = str::from_utf8(&self.client.output()[..len])
                .unwrap()
                .split_ascii_whitespace()
                .filter(|line| !matches!(line.as_bytes(), [b'*' | b'$', ..]));
            self.log
                .push(format!("write {}", words.collect::<Vec<_>>().join(" ")));
            self.window -= len;
            self.client.wrote(len);
        }
    }

    fn start(&mut self) {
        self.client.start();
        self.flush();
    }

    fn advance(&mut self) {
        self.batch_is_due |= self.client.advance();
        self.flush();
    }

    fn checkpoint(&mut self) {
        if self.batch_is_due {
            self.batch_is_due = self.client.batch();
            self.flush();
        }
    }

    fn send_as(&mut self, command: &str, reply: Reply) {
        self.sent += 1;
        if let Some(reason) = self.client.rejection() {
            self.log.push(format!("refuse #{}: {reason}", self.sent));
            return;
        }
        let words: Vec<&str> = command.split_ascii_whitespace().collect();
        let name = words[0].as_bytes();
        match self.client.send(name, &words[1..], reply, self.sent) {
            Sent::Buffered => self.flush(),
            Sent::Batched => self.batch_is_due = true,
            Sent::Queued => {}
        }
    }

    fn send(&mut self, command: &str) {
        self.send_as(command, Reply::Value);
    }

    fn read(&mut self, data: &str) {
        let mut input = self.client.feed(data.as_bytes());
        while let Some(event) = self.client.next_event(&mut input) {
            let acked = |what: &str, acked: Acked<u32>| match acked {
                Acked::Nobody => what.to_string(),
                Acked::Channel(id) => format!("{what} #{id}"),
                Acked::Raw(id, push) => format!("{what} #{id} {}", show(&push)),
            };
            let line = match event {
                Event::Ignored => "ignored".into(),
                Event::Connected(hello) => format!("connected {}", show(&hello)),
                Event::Resolved {
                    promise,
                    value,
                    reply,
                } => {
                    let kind = match reply {
                        Reply::Value | Reply::Bool => "",
                        Reply::Binary => " as binary",
                        Reply::Page => " as page",
                        Reply::Buffer => " as buffer",
                    };
                    format!("resolve #{promise} {}{kind}", show(&value))
                }
                Event::Executed { promise, results } => {
                    let results = results
                        .iter()
                        .map(|it| format!("{}{:?}", show(&it.0), it.1));
                    let results = results.collect::<Vec<_>>().join(" ");
                    format!("resolve #{promise} as {results}")
                }
                Event::Rejected { promise, message } => {
                    format!("reject #{promise} {}", message.escape_ascii())
                }
                Event::Message(data) => format!("message {}", show(&data[0])),
                Event::PatternMessage => "pattern message".into(),
                Event::Subscribed(it) => acked("subscribed", it),
                Event::Unsubscribed(it) => {
                    if !self.has_listeners {
                        self.client.leave_subscriber_mode();
                    }
                    acked("unsubscribed", it)
                }
                Event::Broken { message, error } => {
                    self.log
                        .push(format!("broken {error:?} {}", message.escape_ascii()));
                    self.fail();
                    return self.lost();
                }
                Event::Busy(message) => {
                    self.log
                        .push(format!("busy ConnectionClosed {}", message.escape_ascii()));
                    if !self.client.abandon_handshake() {
                        self.fail();
                    }
                    return self.lost();
                }
            };
            self.log.push(line);
            self.checkpoint();
            self.advance();
        }
        self.checkpoint();
    }

    fn fail(&mut self) {
        let pending = self.client.fail();
        self.log.push(format!("fail {pending:?}"));
    }

    fn lose(&mut self, owner_is_gone: bool) -> Lost<u32> {
        let attempt = self.attempt.take().unwrap();
        self.client.lost(attempt, owner_is_gone)
    }

    fn lost(&mut self) {
        self.batch_is_due = false;
        let line = match self.lose(false) {
            Lost::ForGood { reason, pending } => format!("closed {pending:?} {reason:?}"),
            Lost::Retry {
                delay_ms,
                in_flight,
            } => format!("retry in {delay_ms} {in_flight:?}"),
        };
        self.log.push(line);
    }
}

fn database(database: u32) -> Config {
    Config {
        database,
        idle_timeout_ms: 7,
        ..Config::default()
    }
}

mod lifecycle {
    use super::*;

    #[derive(Copy, Clone, Debug, PartialEq)]
    enum State {
        Idle,
        Dialing,
        Hello,
        Select,
        Ready,
        EndingPolicy,
        EndingRequested,
        EndingFinal,
        EndingFailed,
        Backoff,
        Closed,
    }
    use State::*;

    const STATES: [State; 11] = [
        Idle,
        Dialing,
        Hello,
        Select,
        Ready,
        EndingPolicy,
        EndingRequested,
        EndingFinal,
        EndingFailed,
        Backoff,
        Closed,
    ];

    /// With two commands waiting wherever they can.
    fn reach(state: State) -> Driver {
        let mut it = Driver::new(database(1));
        if state != Idle {
            it.dial();
            it.send("WATCH a");
            it.send("WATCH b");
        }
        match state {
            Idle | Dialing => {}
            Hello => it.start(),
            Select => {
                it.start();
                it.read(HELLO);
            }
            Ready => {
                it.start();
                it.read(HELLO);
                it.read("+OK\r\n");
            }
            EndingPolicy => it.client.dial_failed(),
            EndingRequested => drop(it.client.close()),
            EndingFinal => {
                it.fail();
                it.client.connect();
                it.send("WATCH c");
                it.send("WATCH d");
            }
            EndingFailed => it.fail(),
            Backoff => it.lost(),
            Closed => {
                it.fail();
                it.lost();
            }
        }
        it.log.clear();
        it
    }

    /// The core keeps its state private, so this tells them apart through what they do.
    fn state_of(mut it: Driver) -> State {
        it.log.clear();
        if it.client.claim_and_dial().is_some() {
            Idle
        } else if it.client.redial().is_some() {
            Backoff
        } else if it.client.is_connected() {
            Ready
        } else if it.client.awaited() == Awaited::No {
            Closed
        } else if it.client.is_ending() && it.client.rejection().is_some() {
            EndingFailed
        } else if it.client.is_ending() {
            match it.lose(false) {
                Lost::ForGood {
                    reason: Reason::Requested,
                    ..
                } => EndingRequested,
                Lost::ForGood { .. } => EndingFinal,
                Lost::Retry { .. } => EndingPolicy,
            }
        } else {
            it.start();
            if !it.log.is_empty() {
                return Dialing;
            }
            it.read("+OK\r\n");
            if it.client.is_connected() {
                Select
            } else {
                Hello
            }
        }
    }

    /// Fires `event` in every state. A row is `(before, what happened, after)`; a state with no row ignores it.
    #[track_caller]
    fn check(event: impl Fn(&mut Driver), rows: &[(State, &str, State)]) {
        let actual = STATES.map(|before| {
            let mut it = reach(before);
            event(&mut it);
            (before, it.take().join(", "), state_of(it))
        });
        let actual: Vec<_> = (actual.iter())
            .map(|(before, did, after)| (*before, did.as_str(), *after))
            .filter(|(before, did, after)| before != after || !did.is_empty())
            .collect();
        assert_eq!(actual, rows);
    }

    #[test]
    fn states_are_told_apart() {
        assert_eq!(STATES.map(|state| state_of(reach(state))), STATES);
    }

    #[test]
    fn dial() {
        check(
            |it| it.attempt = it.client.claim_and_dial().or(it.attempt.take()),
            &[(Idle, "", Dialing)],
        );
        check(
            |it| it.attempt = it.client.redial().or(it.attempt.take()),
            &[(Backoff, "", Dialing)],
        );
    }

    #[test]
    fn connect() {
        check(
            |it| it.client.connect(),
            &[
                (EndingRequested, "", EndingPolicy),
                (EndingFailed, "", EndingFinal),
                (Closed, "", Backoff),
            ],
        );
    }

    #[test]
    fn close() {
        let close = |it: &mut Driver| match it.client.close() {
            Close::Nothing => {}
            Close::Socket => it.log.push("close the socket".into()),
            Close::Retry(attempt) => {
                it.attempt = Some(attempt);
                it.log.push("disarm the retry".into());
            }
        };
        check(
            close,
            &[
                (Dialing, "close the socket", EndingRequested),
                (Hello, "close the socket", EndingRequested),
                (Select, "close the socket", EndingRequested),
                (Ready, "close the socket", EndingRequested),
                (EndingPolicy, "", EndingRequested),
                (Backoff, "disarm the retry", EndingRequested),
            ],
        );
    }

    #[test]
    fn fail() {
        check(
            Driver::fail,
            &[
                (Idle, "fail None", Idle),
                (Dialing, "fail Some([1, 2])", EndingFailed),
                (Hello, "fail Some([1, 2])", EndingFailed),
                (Select, "fail Some([1, 2])", EndingFailed),
                (Ready, "fail Some([1, 2])", EndingFailed),
                (EndingPolicy, "fail Some([1, 2])", EndingFailed),
                (EndingRequested, "fail Some([1, 2])", EndingFailed),
                (EndingFinal, "fail Some([3, 4])", EndingFailed),
                (EndingFailed, "fail None", EndingFailed),
                (Backoff, "fail None", Backoff),
                (Closed, "fail None", Closed),
            ],
        );
    }

    #[test]
    fn lost() {
        let lost = |it: &mut Driver| {
            if it.attempt.is_some() {
                it.lost();
            }
        };
        check(
            lost,
            &[
                (Dialing, "retry in 50 []", Backoff),
                (Hello, "retry in 50 []", Backoff),
                (Select, "retry in 50 []", Backoff),
                (Ready, "retry in 50 [1]", Backoff),
                (EndingPolicy, "retry in 50 []", Backoff),
                (EndingRequested, "closed [1, 2] Requested", Closed),
                (EndingFinal, "closed [3, 4] Final", Closed),
                (EndingFailed, "closed [] Final", Closed),
            ],
        );
    }

    #[test]
    fn only_a_dial_says_hello() {
        check(Driver::start, &[(Dialing, "write HELLO 3 SELECT 1", Hello)]);
    }

    #[test]
    fn a_command_waits_behind_the_queue_or_is_refused() {
        let send = |it: &mut Driver| {
            it.send("GET k");
            it.batch_is_due = true;
            it.advance();
            it.checkpoint();
        };
        check(
            send,
            &[
                (
                    EndingFailed,
                    "refuse #3: Connection has failed",
                    EndingFailed,
                ),
                (Closed, "refuse #3: Connection has failed", Closed),
            ],
        );
    }

    #[test]
    fn a_broken_session_is_a_lost_connection_after_hello() {
        let broke = |it: &mut Driver| {
            if let Some(in_flight) = it.client.session_broke() {
                it.log.push(format!("reject {in_flight:?}"));
            }
        };
        check(
            broke,
            &[(Select, "reject []", Select), (Ready, "reject [1]", Ready)],
        );

        let mut it = Driver::connected(Config {
            enable_auto_reconnect: false,
            ..Config::default()
        });
        assert_eq!(it.client.session_broke(), None);
    }

    #[test]
    fn timeouts() {
        assert_eq!(
            STATES.map(|state| (state, reach(state).client.timeout_ms())),
            [
                (Idle, 10000),
                (Dialing, 10000),
                (Hello, 10000),
                (Select, 10000),
                (Ready, 7),
                (EndingPolicy, 10000),
                (EndingRequested, 10000),
                (EndingFinal, 10000),
                (EndingFailed, 0),
                (Backoff, 10000),
                (Closed, 0),
            ]
        );
    }

    #[test]
    fn backoff_doubles_until_the_retries_are_used_up() {
        let mut it = Driver::new(Config {
            max_retries: 8,
            ..Config::default()
        });
        for _ in 0..9 {
            it.dial();
            it.lost();
        }
        let mut expected = [50, 100, 200, 400, 800, 1600, 2000, 2000]
            .map(|ms| format!("retry in {ms} []"))
            .to_vec();
        expected.push("closed [] RetriesUsedUp".into());
        assert_eq!(it.take(), expected);

        it.client.connect();
        it.dial();
        it.lost();
        assert_eq!(it.take(), ["retry in 50 []"]);
    }

    #[test]
    fn retries_start_over_when_the_handshake_is_complete() {
        let mut it = Driver::new(database(1));
        for (replies, expected) in [
            ("", "retry in 50 []"),
            ("+OK\r\n", "retry in 100 []"),
            ("+OK\r\n+OK\r\n", "retry in 50 []"),
        ] {
            it.dial();
            it.start();
            it.read(replies);
            it.log.clear();
            it.lost();
            assert_eq!(it.take(), [expected], "{replies:?}");
        }
    }

    #[test]
    fn only_a_reconnect_abandons_a_handshake() {
        let abandon = |it: &mut Driver| assert!(!it.client.abandon_handshake());
        check(abandon, &[]);

        for (state, expected) in [
            (Dialing, EndingPolicy),
            (Hello, EndingPolicy),
            (Select, EndingPolicy),
            (Ready, Ready),
        ] {
            let mut it = reach(Ready);
            it.lost();
            it.dial();
            if state != Dialing {
                it.start();
            }
            if let Select | Ready = state {
                it.read(HELLO);
            }
            if let Ready = state {
                it.read("+OK\r\n");
            }
            let abandoned = it.client.abandon_handshake();
            assert_eq!(abandoned, expected == EndingPolicy, "{state:?}");
            assert_eq!(state_of(it), expected, "{state:?}");
        }

        let mut it = reach(Ready);
        drop(it.client.close());
        it.client.connect();
        it.lost();
        it.dial();
        assert!(!it.client.abandon_handshake(), "close(), connect()");

        let mut it = reach(Ready);
        it.lost();
        it.dial();
        it.start();
        it.client.connect();
        assert!(
            !it.client.abandon_handshake(),
            "connect() during a reconnect"
        );

        let mut it = Driver::new(Config {
            max_retries: 0,
            ..Config::default()
        });
        it.attempt = it.client.preconnect();
        it.start();
        it.read(HELLO);
        it.lost();
        it.dial();
        assert!(!it.client.abandon_handshake(), "a forgotten preconnect");

        let mut it = reach(Ready);
        it.lost();
        it.client.connect();
        it.dial();
        assert!(!it.client.abandon_handshake(), "connect() dialed");
    }

    #[test]
    fn a_preconnect_that_is_lost_unclaimed_is_forgotten() {
        type Touch = fn(&mut Driver);
        let touches: [(&str, Touch, State); 5] = [
            ("nothing", |_| {}, Idle),
            ("claim", |it| it.client.claim(), Backoff),
            ("command", |it| drop(it.client.claim_and_dial()), Backoff),
            ("connect", |it| it.client.connect(), Backoff),
            ("close", |it| drop(it.client.close()), Closed),
        ];
        let phases: [(&str, Touch); 4] = [
            ("dialing", |_| {}),
            ("no socket", |it| it.client.dial_failed()),
            ("hello", Driver::start),
            ("ready", |it| {
                it.start();
                it.read("+OK\r\n")
            }),
        ];
        for (phase, reach) in phases {
            for (touch, apply, expected) in touches {
                let mut it = Driver::new(Config::default());
                it.attempt = it.client.preconnect();
                reach(&mut it);
                apply(&mut it);
                it.lost();
                assert_eq!(state_of(it), expected, "{phase}, {touch}");
            }
        }
    }

    #[test]
    fn connect_after_close_is_retried() {
        let mut it = reach(Closed);
        it.client.connect();
        it.attempt = it.client.redial();
        it.lost();
        assert_eq!(state_of(it), Backoff);
    }

    #[test]
    fn a_preconnect_that_is_refused_is_forgotten() {
        for replies in ["-NO\r\n", "+OK\r\n-NO\r\n"] {
            let mut it = Driver::new(database(1));
            it.attempt = it.client.preconnect();
            it.start();
            it.read(replies);
            assert_eq!(state_of(it), Idle, "{replies:?}");
        }
    }

    #[test]
    fn retries_count_on_within_an_attempt() {
        let phases: [fn(&mut Driver); 3] = [|_| {}, Driver::start, |it| it.client.dial_failed()];
        let touches: [fn(&mut Driver); 4] = [
            |_| {},
            |it| it.client.claim(),
            |it| it.client.connect(),
            |it| {
                drop(it.client.close());
                it.client.connect()
            },
        ];
        for (phase, reach) in phases.into_iter().enumerate() {
            for (touch, apply) in touches.into_iter().enumerate() {
                let mut it = Driver::connected(Config::default());
                it.lost();
                it.dial();
                reach(&mut it);
                apply(&mut it);
                it.lost();
                assert_eq!(
                    it.take().last().unwrap(),
                    "retry in 100 []",
                    "{phase}, {touch}"
                );
            }
        }
    }

    #[test]
    fn connect_starts_the_retries_over_between_attempts() {
        let mut it = Driver::connected(Config::default());
        it.lost();
        it.client.connect();
        it.dial();
        it.lost();
        assert_eq!(it.take(), ["retry in 50 []", "retry in 50 []"]);
    }

    #[test]
    fn a_preconnect_that_failed_is_final_once_claimed() {
        let touches: [fn(&mut Driver); 3] = [
            |it| it.client.claim(),
            |it| it.client.connect(),
            |it| drop(it.client.close()),
        ];
        for (touch, apply) in touches.into_iter().enumerate() {
            let mut it = Driver::new(Config::default());
            it.attempt = it.client.preconnect();
            it.fail();
            assert!(it.client.awaited() == Awaited::No && it.client.is_ending());
            assert!(it.client.rejection().is_some());
            apply(&mut it);
            it.lost();
            assert_eq!(state_of(it), Closed, "{touch}");
        }
    }

    #[test]
    fn a_reconnect_is_awaited_until_it_is_turned_away() {
        use Awaited::{ByWorkOrBytes, ByWorkOrHandlers, Yes};
        let abandon = |it: &mut Driver| assert!(it.client.abandon_handshake());
        let steps: [(fn(&mut Driver), Awaited); 10] = [
            (Driver::lost, Yes),
            (Driver::dial, Yes),
            (Driver::lost, Yes),
            (Driver::dial, Yes),
            (abandon, ByWorkOrHandlers),
            (Driver::lost, ByWorkOrHandlers),
            (Driver::dial, ByWorkOrHandlers),
            (Driver::lost, ByWorkOrHandlers),
            (Driver::handshake, ByWorkOrBytes),
            (Driver::lost, Yes),
        ];
        for (last, (_, awaited)) in steps.iter().enumerate() {
            let mut it = Driver::connected(Config::default());
            steps[..=last].iter().for_each(|(step, _)| step(&mut it));
            assert_eq!(it.client.awaited(), *awaited, "{last}");
            it.client.connect();
            assert!(it.client.is_connected() || it.client.awaited() == Yes);
        }
    }

    #[test]
    fn no_retry() {
        let mut it = Driver::connected(Config::default());
        assert!(matches!(it.lose(true), Lost::ForGood { .. }));
        let mut it = Driver::connected(Config {
            enable_auto_reconnect: false,
            ..Config::default()
        });
        assert!(matches!(it.lose(false), Lost::ForGood { .. }));
    }

    #[test]
    fn no_offline_queue() {
        let mut it = Driver::new(Config {
            enable_offline_queue: false,
            ..database(1)
        });
        it.dial();
        it.start();
        it.send("GET k");
        it.read(HELLO);
        it.send("GET k");
        it.read("+OK\r\n");
        it.send("WATCH k");
        assert_eq!(
            it.take(),
            [
                "write HELLO 3 SELECT 1",
                "refuse #1: Connection is closed and offline queue is disabled",
                "ignored",
                "refuse #2: Connection is closed and offline queue is disabled",
                "connected map of 1",
                "write WATCH k",
            ]
        );
    }

    #[test]
    fn a_batch_waits_for_select() {
        let mut it = Driver::new(database(1));
        it.dial();
        it.start();
        it.read(HELLO);
        it.send("GET k");
        it.batch_is_due = true;
        it.checkpoint();
        it.read("+OK\r\n");
        assert_eq!(
            it.take(),
            [
                "write HELLO 3 SELECT 1",
                "ignored",
                "connected map of 1",
                "write GET k"
            ]
        );
    }
}

mod handshake {
    use super::*;

    #[test]
    fn credentials() {
        for (username, password, count, expected) in [
            ("", "", b"*2", "write HELLO 3"),
            ("", "p", b"*5", "write HELLO 3 AUTH default p"),
            ("u", "p", b"*5", "write HELLO 3 AUTH u p"),
            ("u", "", b"*5", "write HELLO 3 AUTH u"),
        ] {
            let mut it = Driver::new(Config {
                username: username.as_bytes().into(),
                password: password.as_bytes().into(),
                ..Config::default()
            });
            it.dial();
            it.client.start();
            assert!(it.client.output().starts_with(count));
            it.flush();
            assert_eq!(it.take(), [expected]);
        }
    }

    #[test]
    fn replies() {
        for (db, replies, expected) in [
            (0, "+OK\r\n", "connected OK"),
            (0, HELLO, "connected map of 1"),
            (0, "|0\r\n+OK\r\n", "connected OK"),
            (1, "+OK\r\n|0\r\n+OK\r\n", "connected OK"),
            (0, "%1\r\n$5\r\nproto\r\n:2\r\n", "connected map of 1"),
            (
                0,
                "%1\r\n+proto\r\n:2\r\n",
                "broken UnsupportedProtocol Server does not support RESP3",
            ),
            (0, "-NO\r\n", "broken AuthenticationFailed NO"),
            (0, "-LOADING x\r\n", "busy ConnectionClosed LOADING x"),
            (0, "-BUSY x\r\n", "busy ConnectionClosed BUSY x"),
            (0, "-BUSYKEY x\r\n", "broken AuthenticationFailed BUSYKEY x"),
            (0, "-MASTERDOWN x\r\n", "busy ConnectionClosed MASTERDOWN x"),
            (0, "-TRYAGAIN x\r\n", "busy ConnectionClosed TRYAGAIN x"),
            (1, "+OK\r\n-BUSY x\r\n", "busy ConnectionClosed BUSY x"),
            (
                0,
                "-ERR max number of clients reached\r\n",
                "busy ConnectionClosed ERR max number of clients reached",
            ),
            (
                0,
                "-ERR unknown command `HELLO`, with args beginning with: `3`, `AUTH`, `u`, `p`, \r\n",
                "broken AuthenticationFailed ERR unknown command `HELLO`",
            ),
            (
                0,
                "+NO\r\n",
                "broken AuthenticationFailed Authentication failed (unexpected response)",
            ),
            (
                0,
                ":1\r\n",
                "broken AuthenticationFailed Authentication failed with unexpected response",
            ),
            (1, "%0\r\n+OK\r\n", "connected map of 0"),
            (1, "+OK\r\n-NO\r\n", "broken InvalidCommand NO"),
            (
                1,
                "+OK\r\n+NO\r\n",
                "broken InvalidResponse SELECT command failed with non-OK response",
            ),
            (
                1,
                "+OK\r\n:1\r\n",
                "broken InvalidResponse Received non-SELECT response while in the SELECT state.",
            ),
        ] {
            let mut it = Driver::new(database(db));
            it.dial();
            it.start();
            it.read(replies);
            assert_eq!(it.log[1 + db as usize], expected);
        }
    }

    #[test]
    fn a_refusal_that_passes_costs_a_reconnect_one_attempt() {
        const RETRY: &str = "retry in 100 []";
        const GIVE_UP: &str = "closed [] Final";
        for (replies, expected) in [
            ("-LOADING Redis is loading\r\n", RETRY),
            ("-BUSY Redis is busy\r\n", RETRY),
            ("-MASTERDOWN Link is down\r\n", RETRY),
            ("-TRYAGAIN Later\r\n", RETRY),
            ("-ERR max number of clients reached\r\n", RETRY),
            ("+OK\r\n-BUSY Redis is busy\r\n", RETRY),
            ("-WRONGPASS invalid\r\n", GIVE_UP),
            ("-NOAUTH required\r\n", GIVE_UP),
            ("-NOPROTO unsupported\r\n", GIVE_UP),
            ("-BUSYKEY exists\r\n", GIVE_UP),
            (":1\r\n", GIVE_UP),
            ("+OK\r\n-NOPERM no\r\n", GIVE_UP),
            ("+OK\r\n-ERR DB index is out of range\r\n", GIVE_UP),
        ] {
            let mut it = Driver::new(database(1));
            it.dial();
            it.start();
            it.read("+OK\r\n+OK\r\n");
            it.lost();
            it.dial();
            it.start();
            it.read(replies);
            assert_eq!(it.log.last().unwrap(), expected, "{replies:?}");

            let mut first = Driver::new(database(1));
            first.dial();
            first.start();
            first.read(replies);
            assert_eq!(first.log.last().unwrap(), GIVE_UP, "{replies:?}");
        }
    }
}

mod selected_database {
    use super::*;

    /// With database 1 in the config. Each command stands ahead of the lines of its reply.
    fn after(exchange: &str) -> Driver {
        let mut it = Driver::new(database(1));
        it.dial();
        it.start();
        it.read("+OK\r\n+OK\r\n");
        let is_reply = |word: &&str| word.starts_with(['+', '-', '*', '>', '_']);
        let words = exchange.split_ascii_whitespace();
        let mut words = words.map(|it| it.trim_end_matches(',')).peekable();
        while words.peek().is_some() {
            let command = core::iter::from_fn(|| words.next_if(|it| !is_reply(it)));
            let command = command.collect::<Vec<_>>().join(" ");
            it.client.claim();
            it.client.connect();
            it.send(&command);
            it.checkpoint();
            while let Some(line) = words.next_if(is_reply) {
                it.read(&format!("{line}\r\n"));
            }
        }
        it.log.clear();
        it
    }

    fn next_handshake(it: &mut Driver) -> String {
        it.lost();
        it.client.connect();
        it.dial();
        it.start();
        it.take().pop().unwrap()
    }

    #[track_caller]
    fn check(rows: &[(&str, &str)]) {
        for (exchange, select) in rows {
            let expected = format!("write HELLO 3 {select}");
            let actual = next_handshake(&mut after(exchange));
            assert_eq!(actual, expected.trim_end(), "{exchange}");
        }
    }

    #[test]
    fn is_the_last_that_the_server_confirmed() {
        check(&[
            ("SELECT 5 +OK", "SELECT 5"),
            ("select 5 +OK", "SELECT 5"),
            ("SELECT 0 +OK", ""),
            ("SELECT 5 -ERR", "SELECT 1"),
            ("SELECT 5 +other", "SELECT 1"),
            ("SELECT x +OK", "SELECT 1"),
            ("ECHO 5 +OK", "SELECT 1"),
            ("SELECT 5 +OK, SELECT 6 +OK", "SELECT 6"),
            ("SELECT 5 +OK, SELECT 6 -ERR", "SELECT 5"),
            ("SELECT 5 +OK, SELECT 6", "SELECT 5"),
            ("SELECT 5 +OK, RESET +RESET", "SELECT 1"),
            ("SELECT 5 +OK, RESET -ERR", "SELECT 5"),
        ]);
    }

    #[test]
    fn inside_multi_is_confirmed_by_its_result_in_exec() {
        const OPEN: &str = "SELECT 5 +OK, MULTI +OK, SET k v +QUEUED, SELECT 6 +QUEUED";
        let rows = [
            ("EXEC *2 +OK +OK", "SELECT 6"),
            ("EXEC *2 -ERR +OK", "SELECT 6"),
            ("EXEC NX k *2 +OK +OK", "SELECT 6"),
            ("EXEC *2 +OK -ERR", "SELECT 5"),
            ("EXEC *2 +OK -ERR, EXEC *1 +OK", "SELECT 5"),
            ("EXEC", "SELECT 5"),
            ("EXEC _", "SELECT 5"),
            ("DISCARD +OK", "SELECT 5"),
            ("RESET +RESET", "SELECT 1"),
            ("SET k v +QUEUED", "SELECT 5"),
            ("SET k v +QUEUED, EXEC *3 +OK +OK -ERR", "SELECT 6"),
            ("SET k v +QUEUED, EXEC *3 +OK -ERR +OK", "SELECT 5"),
            ("SELECT 7 +QUEUED, EXEC *3 +OK +OK +OK", "SELECT 7"),
            ("SELECT 7 +QUEUED, EXEC *3 +OK +OK -ERR", "SELECT 6"),
            ("WATCH k -ERR, EXEC *2 -ERR +OK", "SELECT 6"),
            (
                "SET k v >1 +invalidate +QUEUED, EXEC *3 -ERR +OK -ERR",
                "SELECT 6",
            ),
            ("EXEC *2 +OK +other", "SELECT 5"),
            (
                "EXEC -EXECABORT, SELECT 7 +QUEUED, EXEC *2 +OK +OK",
                "SELECT 5",
            ),
            ("EXEC _, SELECT 7 +QUEUED, EXEC *2 +OK +OK", "SELECT 5"),
            ("EVAL x 0 *1 +OK", "SELECT 5"),
            (
                "EXEC NX k -CROSSSLOT, SELECT 7 +QUEUED, EXEC *2 +OK -ERR",
                "SELECT 5",
            ),
            ("+QUEUED, exec *2 -ERR +OK", "SELECT 6"),
            (
                "DISCARD +OK, MULTI +OK, SET k v +QUEUED, EXEC *2 +OK +OK",
                "SELECT 5",
            ),
        ]
        .map(|(rest, select)| (format!("{OPEN}, {rest}"), select));
        check(&rows.each_ref().map(|(all, select)| (all.as_str(), *select)));
    }

    #[test]
    fn inside_multi_the_client_is_as_ready_as_outside() {
        let events: [(&str, fn(&mut Driver) -> String); 6] = [
            ("is_connected", |it| it.client.is_connected().to_string()),
            ("awaited", |it| format!("{:?}", it.client.awaited())),
            ("rejection", |it| format!("{:?}", it.client.rejection())),
            ("fail", |it| format!("{:?}", it.client.fail())),
            ("close", |it| {
                matches!(it.client.close(), Close::Socket).to_string()
            }),
            ("a reply", |it| {
                it.read("+QUEUED\r\n");
                it.take().join(", ")
            }),
        ];
        for (name, event) in events {
            let [tracked, plain] = ["SELECT 6", "ECHO 6"].map(|command| {
                let mut it = after(&format!("MULTI +OK, {command} +QUEUED, PING"));
                let result = event(&mut it);
                it.lost();
                (result, it.take())
            });
            assert_eq!(tracked, plain, "{name}");
        }
    }

    #[test]
    fn outlasts_every_end() {
        let ends: [(&str, fn(&mut Driver)); 4] = [
            ("a drop", |_| {}),
            ("a failure", Driver::fail),
            ("close()", |it| drop(it.client.close())),
            ("the last retry", |it| {
                for _ in 0..Config::default().max_retries {
                    it.lost();
                    it.dial();
                }
            }),
        ];
        for (name, end) in ends {
            let mut it = after("SELECT 5 +OK");
            end(&mut it);
            assert_eq!(next_handshake(&mut it), "write HELLO 3 SELECT 5", "{name}");
        }
    }

    #[test]
    fn is_given_up_when_the_server_refuses_it_for_good() {
        for (config, reply, expected, later) in [
            (0, "-NOPERM x", "connected OK", ""),
            (0, "-NOAUTH x", "connected OK", ""),
            (1, "-NOPERM x", "write SELECT 1", " SELECT 1"),
            (1, "-NOAUTH x\r\n+OK", "connected OK", " SELECT 1"),
            (1, "-NOPERM x\r\n-NOPERM x", "closed [] Final", " SELECT 1"),
            (0, "-BUSY x", "retry in 100 []", " SELECT 5"),
            (0, "-ERR range", "closed [] Final", ""),
            (1, "-ERR range", "closed [] Final", " SELECT 1"),
        ] {
            let mut it = Driver::new(database(config));
            it.dial();
            it.start();
            it.read(&"+OK\r\n".repeat(1 + config as usize));
            it.send("SELECT 5");
            it.read("+OK\r\n");
            it.lost();
            it.dial();
            it.start();
            it.read(&format!("+OK\r\n{reply}\r\n"));
            it.log.retain(|line| line != "ignored");
            assert_eq!(it.take().pop().unwrap(), expected, "{config} {reply}");

            if it.attempt.is_some() {
                it.lost();
            }
            it.client.connect();
            it.dial();
            it.start();
            let expected = format!("write HELLO 3{later}");
            assert_eq!(it.take().pop().unwrap(), expected, "{config} {reply}");
        }
    }
}

mod pipeline {
    use super::*;

    #[test]
    fn encoding() {
        let mut it = Driver::connected(Config::default());
        let long = [b'x'; 10];
        let args: [&[u8]; 2] = [b"", &long];
        assert!(it.client.send(b"INFO", &args, Reply::Value, 1) == Sent::Buffered);
        assert_eq!(
            it.client.output(),
            b"*3\r\n$4\r\nINFO\r\n$0\r\n\r\n$10\r\nxxxxxxxxxx\r\n"
        );
    }

    #[test]
    fn a_command_that_travels_alone_waits_for_what_is_in_flight() {
        let mut it = Driver::connected(Config::default());
        for command in ["MULTI", "SET a 1", "SET b 2", "EXEC", "GET a"] {
            it.send(command);
        }
        it.checkpoint();
        it.read("+OK\r\n+QUEUED\r\n");
        it.read("+QUEUED\r\n");
        assert_eq!(
            it.take(),
            [
                "write MULTI",
                "write SET a 1 SET b 2",
                "resolve #1 OK",
                "resolve #2 QUEUED",
                "resolve #3 QUEUED",
                "write EXEC",
                "write GET a",
            ]
        );
    }

    #[test]
    fn without_auto_pipelining() {
        let mut it = Driver::connected(Config {
            enable_auto_pipelining: false,
            ..Config::default()
        });
        for command in ["GET a", "GET b", "GET c"] {
            it.send(command);
        }
        it.checkpoint();
        it.read("+A\r\n");
        assert_eq!(
            it.take(),
            ["write GET a", "resolve #1 A", "write GET b GET c"]
        );
    }

    #[test]
    fn backpressure() {
        let mut it = Driver::connected(Config::default());
        it.window = 4;
        it.send("MULTI");
        assert_eq!(it.client.buffered_amount(), 11);
        it.window = usize::MAX;
        it.log.clear();
        it.advance();
        assert_eq!(it.take(), ["write MULTI"]);
        assert_eq!(it.client.buffered_amount(), 0);
    }

    #[test]
    fn exec_keeps_the_bytes_that_a_command_asked_for() {
        use Reply::{Binary, Bool, Buffer, Page, Value};
        const THREE: &str = "*3\r\n:1\r\n:2\r\n:3\r\n";
        let mut it = Driver::connected(Config::default());
        let mut last = |steps: &[(&str, Reply, &str)]| {
            for &(command, reply, answer) in steps {
                it.send_as(command, reply);
                it.advance();
                it.checkpoint();
                it.read(answer);
            }
            let line = it.take().pop().unwrap();
            let id = line.trim_start_matches("resolve #");
            id.trim_start_matches(char::is_numeric).trim().to_string()
        };
        let multi = ("MULTI", Value, "+OK\r\n");
        let queued = |reply| ("X", reply, "+QUEUED\r\n");
        let [value, bool, binary, page, buffer] = [Value, Bool, Binary, Page, Buffer].map(queued);
        let [exec, exec_binary] = [Value, Binary].map(|reply| ("exec", reply, THREE));
        let refused = ("WATCH", Binary, "-ERR\r\n");

        assert_eq!(last(&[multi, value, bool, value, exec]), "?");
        assert_eq!(
            last(&[multi, bool, page, refused, buffer, exec]),
            "as 1Value 2Page 3Buffer"
        );
        assert_eq!(
            last(&[multi, value, page, bool, exec_binary]),
            "as 1Binary 2Page 3Binary"
        );
        assert_eq!(
            last(&[multi, value, value, value, exec_binary]),
            "as 1Binary 2Binary 3Binary"
        );
        let nested = ("MULTI", Value, "-ERR\r\n");
        let subscribe = ("SUBSCRIBE a", Binary, "+QUEUED\r\n");
        assert_eq!(
            last(&[multi, value, binary, nested, subscribe, exec]),
            "as 1Value 2Binary 3Value"
        );
        // A peer that counts differently.
        assert_eq!(last(&[multi, binary, exec]), "as 1Value 2Value 3Binary");
        assert_eq!(
            last(&[multi, page, binary, value, page, exec]),
            "as 1Binary 2Value 3Page"
        );
        // Nothing is left for the next one.
        let ends = [
            exec,
            ("EXEC", Value, "_\r\n"),
            ("EXEC", Value, "-MOVED\r\n"),
            ("DISCARD", Value, "+OK\r\n"),
            ("RESET", Value, "+RESET\r\n"),
        ];
        for end in ends {
            assert_eq!(last(&[multi, binary, end, binary, exec]), "?");
        }
        // Another array is not the reply to EXEC.
        assert_eq!(last(&[multi, binary, ("MGET", Value, THREE), exec]), "?");
        last(&[multi, binary]);
        it.lost();
        it.handshake();
        it.send("EXEC");
        it.read(THREE);
        assert!(it.take().pop().unwrap().ends_with('?'));
    }

    #[test]
    fn reply_kinds() {
        use Reply::{Binary, Bool, Buffer};
        let mut it = Driver::connected(Config::default());
        for reply in [Bool, Bool, Bool, Buffer, Binary] {
            it.send_as("X", reply);
        }
        it.send("X");
        it.checkpoint();
        it.log.clear();
        it.read(":2\r\n:-1\r\n+a\r\n+b\r\n+c\r\n-ERR\r\n+extra\r\n");
        assert_eq!(
            it.take(),
            [
                "resolve #1 true",
                "resolve #2 false",
                "resolve #3 a",
                "resolve #4 b as buffer",
                "resolve #5 c as binary",
                "reject #6 ERR",
                "ignored",
            ]
        );
    }

    #[test]
    fn attributes_are_skipped() {
        let mut it = Driver::connected(Config::default());
        it.send_as("X", Reply::Bool);
        it.send("X");
        it.send("X");
        it.checkpoint();
        it.log.clear();
        for reply in [":1\r\n", "-ERR\r\n", &push("invalidate", "k"), "+OK\r\n"] {
            it.read(&format!("|1\r\n+a\r\n*1\r\n+b\r\n{reply}"));
        }
        assert_eq!(
            it.take(),
            [
                "resolve #1 true",
                "reject #2 ERR",
                "ignored",
                "resolve #3 OK"
            ]
        );
    }

    #[test]
    fn replies_cut_anywhere() {
        let replies = format!(
            "$3\r\nabc\r\n{}*1\r\n:1\r\n+OK\r\n",
            push("invalidate", "k")
        );
        for at in 0..=replies.len() {
            let mut it = Driver::connected(Config::default());
            for _ in 0..3 {
                it.send("X");
            }
            it.checkpoint();
            it.log.clear();
            it.read(&replies[..at]);
            it.read(&replies[at..]);
            assert_eq!(
                it.take(),
                ["resolve #1 abc", "ignored", "resolve #2 ?", "resolve #3 OK"]
            );
            assert!(!it.client.has_commands() && it.client.buffered_amount() == 0);
        }
    }

    #[test]
    fn garbage() {
        for (reads, path) in [(["\x01", ""], "stack"), (["*1\r\n", "\x01"], "buffer")] {
            let mut it = Driver::connected(Config::default());
            reads.iter().for_each(|data| it.read(data));
            assert_eq!(
                it.log[0],
                format!("broken InvalidResponseType Failed to read data ({path} path)")
            );
        }
    }

    #[test]
    fn a_lost_connection_keeps_the_queue_and_nothing_else() {
        let mut it = Driver::connected(Config::default());
        it.send("MULTI");
        it.send("WATCH a");
        it.read("+O");
        it.lost();
        assert_eq!(it.take(), ["write MULTI", "retry in 50 [1]"]);
        assert_eq!(it.client.buffered_amount(), 0);
        it.dial();
        it.start();
        it.read(HELLO);
        assert_eq!(it.log.last().unwrap(), "write WATCH a");
    }
}

mod subscriptions {
    use super::*;

    fn subscriber() -> Driver {
        let mut it = Driver::connected(Config::default());
        it.send("SUBSCRIBE a");
        it.read(&push("subscribe", "a"));
        it.log.clear();
        it
    }

    #[test]
    fn an_acknowledgement_answers_the_subscription_request_at_the_head() {
        let mut it = Driver::connected(Config::default());
        it.send("SUBSCRIBE a b");
        it.send("UNSUBSCRIBE a");
        it.send("PING");
        for channel in ["a", "b"] {
            it.read(&push("subscribe", channel));
        }
        it.read(&(push("unsubscribe", "a") + "+PONG\r\n"));
        assert_eq!(
            it.take(),
            [
                "write SUBSCRIBE a b",
                "subscribed #1",
                "write UNSUBSCRIBE a",
                "write PING",
                "subscribed #2",
                "unsubscribed",
                "resolve #3 PONG",
            ]
        );
    }

    #[test]
    fn fewer_acknowledgements_than_arguments_shift_nothing() {
        let mut it = Driver::connected(Config::default());
        for command in ["PUNSUBSCRIBE a a", "PUNSUBSCRIBE z", "SSUBSCRIBE x", "PING"] {
            it.send(command);
        }
        it.checkpoint();
        it.log.clear();
        it.read(&(push("punsubscribe", "a") + &push("punsubscribe", "z")));
        it.read(&(push("subscribe", "x") + "+PONG\r\n"));
        assert_eq!(
            it.take(),
            [
                "unsubscribed #1 >punsubscribe a",
                "unsubscribed #2 >punsubscribe z",
                "subscribed #3",
                "resolve #4 PONG",
            ]
        );
    }

    #[test]
    fn patterns_and_shards() {
        let mut it = Driver::connected(Config::default());
        for command in ["psubscribe a", "PUNSUBSCRIBE a", "SSUBSCRIBE x y"] {
            it.send(command);
        }
        it.checkpoint();
        it.log.clear();
        for (kind, name) in [
            ("psubscribe", "a"),
            ("pmessage", "a"),
            ("punsubscribe", "a"),
            ("ssubscribe", "x"),
            ("ssubscribe", "y"),
            ("smessage", "x"),
        ] {
            it.read(&push(kind, name));
        }
        assert_eq!(
            it.take(),
            [
                "subscribed #1 >psubscribe a",
                "pattern message",
                "unsubscribed #2 >punsubscribe a",
                "subscribed #3 >ssubscribe x",
                "subscribed",
                "pattern message",
            ]
        );
    }

    #[test]
    fn subscriber_mode_outlasts_the_connection() {
        let mut it = subscriber();
        it.lost();
        it.handshake();
        assert!(it.client.is_subscriber());
    }

    #[test]
    fn inside_a_transaction_a_plain_reply_answers() {
        let mut it = Driver::connected(Config::default());
        it.send("SUBSCRIBE a b");
        it.read("+QUEUED\r\n");
        assert_eq!(it.log.last().unwrap(), "resolve #1 QUEUED");
    }

    #[test]
    fn a_second_prefix_counts_as_a_reply() {
        for command in ["X", "SELECT 1", "MULTI", "EXEC"] {
            let mut it = Driver::connected(Config::default());
            it.read(&push("spsubscribe", "k"));
            it.send(command);
            it.checkpoint();
            it.read(&push("spsubscribe", "k"));
            let write = format!("write {command}");
            assert_eq!(it.take(), ["ignored", &write, "resolve #1 >spsubscribe k"]);
        }

        for (mut it, command, failed) in [
            (subscriber(), "X", "fail Some([2])"),
            (
                Driver::connected(Config::default()),
                "SUBSCRIBE k",
                "fail Some([1])",
            ),
        ] {
            it.send(command);
            it.checkpoint();
            it.read(&push("spsubscribe", "k"));
            assert_eq!(it.log[2], failed);
        }
    }

    #[test]
    fn an_error_fails_a_subscriber_and_the_request_that_drew_it() {
        let mut it = subscriber();
        it.send("A");
        it.send("B");
        it.checkpoint();
        it.read("-NO\r\n");
        assert_eq!(
            it.take(),
            [
                "write A B",
                "broken ServerError NO",
                "fail Some([2, 3])",
                "closed [] Final",
            ]
        );
    }

    #[test]
    fn pushes_that_answer_nothing() {
        for kind in ["invalidate", "SUBSCRIBE"] {
            for mut it in [subscriber(), Driver::connected(Config::default())] {
                it.send("PING");
                it.checkpoint();
                it.log.clear();
                it.read(&(push(kind, "k") + "+PONG\r\n"));
                let expected = format!("resolve #{} PONG", it.sent);
                assert_eq!(it.take(), ["ignored", &expected]);
            }
        }
        let mut it = Driver::connected(Config::default());
        for kind in ["message", "pmessage", "subscribe", "unsubscribe"] {
            it.read(&push(kind, "k"));
        }
        assert_eq!(it.take(), ["ignored"; 4]);
        assert!(!it.client.is_subscriber());
    }
}
