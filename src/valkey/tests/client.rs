use std::collections::BTreeMap;

use bun_valkey::client::{Acked, Attempt, Client, Close, Config, Event, Lost, Reason, Sent};
use bun_valkey::command::Reply;
use bun_valkey::listeners::{Name, Undo};
use bun_valkey::valkey_protocol::RESPValue;

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}

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
    /// By channel, each as the number of the `subscribe()` that stored it.
    listeners: BTreeMap<Name, Vec<u32>>,
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
            listeners: BTreeMap::new(),
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

    fn undo(&mut self, undo: Vec<Undo>) {
        for Undo { channel, listeners } in undo {
            self.listeners.get_mut(&channel).unwrap().drain(listeners);
        }
        self.listeners.retain(|_, it| !it.is_empty());
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
                    as_buffer,
                } => {
                    let buffer = if as_buffer { " as buffer" } else { "" };
                    format!("resolve #{promise} {}{buffer}", show(&value))
                }
                Event::Rejected {
                    promise,
                    message,
                    undo,
                } => {
                    self.undo(undo);
                    format!("reject #{promise} {}", message.escape_ascii())
                }
                Event::Message(data) => format!("message {}", show(&data[0])),
                Event::PatternMessage => "pattern message".into(),
                Event::Subscribed(it) => acked("subscribed", it),
                Event::Unsubscribed(it) => acked("unsubscribed", it),
                Event::Broken { message, error } => {
                    self.log
                        .push(format!("broken {error:?} {}", message.escape_ascii()));
                    self.fail();
                    return self.lost();
                }
                Event::NotRestored { channel, message } => {
                    let (channel, message) = (channel.escape_ascii(), message.escape_ascii());
                    format!("not restored {channel} {message}")
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
        let (line, undo) = match self.lose(false) {
            Lost::ForGood {
                reason,
                pending,
                undo,
            } => (format!("closed {pending:?} {reason:?}"), undo),
            Lost::Retry {
                delay_ms,
                in_flight,
                undo,
            } => (format!("retry in {delay_ms} {in_flight:?}"), undo),
        };
        self.undo(undo);
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
        } else if !it.client.is_active() {
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
        } else if it.client.is_dialing() {
            Dialing
        } else {
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
            assert!(it.client.is_preconnect() && it.client.rejection().is_some());
            apply(&mut it);
            it.lost();
            assert_eq!(state_of(it), Closed, "{touch}");
        }
    }

    #[test]
    fn the_selected_database_outlasts_failed_attempts() {
        let touches: [fn(&mut Driver); 3] =
            [|_| {}, |it| it.client.claim(), |it| it.client.connect()];
        for (touch, apply) in touches.into_iter().enumerate() {
            let mut it = Driver::connected(Config::default());
            it.send("SELECT 1");
            it.read("+OK\r\n");
            it.lost();
            it.dial();
            apply(&mut it);
            it.lost();
            it.dial();
            it.start();
            assert_eq!(
                it.take().last().unwrap(),
                "write HELLO 3 SELECT 1",
                "{touch}"
            );
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
            (
                0,
                "-ERR unknown command HELLO with args beginning with: AUTH\r\n",
                "broken AuthenticationFailed ERR unknown command HELLO",
            ),
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

    #[test]
    fn a_confirmed_select_is_repeated() {
        for (exchange, expected) in [
            (&[("SELECT 5", "+OK")][..], "write HELLO 3 SELECT 5"),
            (&[("select 5", "+OK")], "write HELLO 3 SELECT 5"),
            (&[("SELECT 0", "+OK")], "write HELLO 3"),
            (&[("SELECT 5", "-ERR")], "write HELLO 3 SELECT 1"),
            (&[("ECHO 5", "+OK")], "write HELLO 3 SELECT 1"),
            (
                &[("SELECT 5", "+OK"), ("SELECT 5", "+QUEUED")],
                "write HELLO 3 SELECT 5",
            ),
            (
                &[("SELECT 5", "+OK"), ("SELECT 5", "")],
                "write HELLO 3 SELECT 5",
            ),
            (
                &[("SELECT 5", "+OK"), ("SELECT 6", "+QUEUED")],
                "write HELLO 3 SELECT 1",
            ),
            (
                &[("SELECT 5", "+OK"), ("SELECT 6", "")],
                "write HELLO 3 SELECT 1",
            ),
            (
                &[("SELECT 5", "+OK"), ("SELECT x", "+OK")],
                "write HELLO 3 SELECT 1",
            ),
            (
                &[("SELECT 5", "+OK"), ("SELECT 6", "-ERR")],
                "write HELLO 3 SELECT 5",
            ),
            (
                &[("SELECT 6", "+QUEUED"), ("SELECT 5", "+OK")],
                "write HELLO 3 SELECT 5",
            ),
            (
                &[("SELECT 5", "+OK"), ("RESET", "+RESET")],
                "write HELLO 3 SELECT 1",
            ),
        ] {
            let mut it = Driver::new(database(1));
            it.dial();
            it.start();
            it.read("+OK\r\n+OK\r\n");
            for (command, reply) in exchange {
                it.send(command);
                it.checkpoint();
                if !reply.is_empty() {
                    it.read(&format!("{reply}\r\n"));
                }
            }
            it.lost();
            it.dial();
            it.start();
            assert_eq!(it.log.last().unwrap(), expected, "{exchange:?}");
        }
    }

    #[test]
    fn a_repeat_that_the_handshake_has_no_right_to_falls_back() {
        for (url, reply, expected) in [
            (0, "-NOPERM x", "connected OK"),
            (1, "-NOPERM x", "write SELECT 1"),
            (1, "-NOPERM x\r\n+OK", "connected OK"),
            (1, "-NOPERM x\r\n-NOPERM x", "closed [] Final"),
            (0, "-BUSY x", "retry in 100 []"),
            (0, "-ERR DB index is out of range", "closed [] Final"),
        ] {
            let mut it = Driver::new(database(url));
            it.dial();
            it.start();
            it.read(if url == 0 {
                "+OK\r\n"
            } else {
                "+OK\r\n+OK\r\n"
            });
            it.send("SELECT 5");
            it.read("+OK\r\n");
            it.lost();
            it.dial();
            it.start();
            it.read(&format!("+OK\r\n{reply}\r\n"));
            it.log.retain(|line| line != "ignored");
            assert_eq!(it.log.last().unwrap(), expected, "{url} {reply}");
        }
    }

    #[test]
    fn a_client_that_ends_forgets_the_selected_database() {
        let by_failure = |it: &mut Driver| it.fail();
        let by_close = |it: &mut Driver| drop(it.client.close());
        let by_drop = |_: &mut Driver| {};
        for (name, max_retries, end, expected) in [
            (
                "a failure",
                1,
                by_failure as fn(&mut Driver),
                "write HELLO 3",
            ),
            ("close()", 1, by_close, "write HELLO 3"),
            ("a drop, no retry left", 0, by_drop, "write HELLO 3"),
            ("a drop, a retry left", 1, by_drop, "write HELLO 3 SELECT 5"),
        ] {
            let mut it = Driver::connected(Config {
                max_retries,
                ..Config::default()
            });
            it.send("SELECT 5");
            it.read("+OK\r\n");
            end(&mut it);
            it.lost();
            it.client.connect();
            it.dial();
            it.start();
            assert_eq!(it.log.last().unwrap(), expected, "{name}");
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
    fn reply_kinds() {
        let mut it = Driver::connected(Config::default());
        for reply in [Reply::Bool, Reply::Bool, Reply::Bool, Reply::Buffer] {
            it.send_as("X", reply);
        }
        it.send("X");
        it.checkpoint();
        it.log.clear();
        it.read(":2\r\n:-1\r\n+a\r\n+b\r\n-ERR\r\n+extra\r\n");
        assert_eq!(
            it.take(),
            [
                "resolve #1 true",
                "resolve #2 false",
                "resolve #3 a",
                "resolve #4 b as buffer",
                "reject #5 ERR",
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
            assert!(!it.client.has_pending_commands());
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
                "ignored",
                "unsubscribed #2",
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
                "ignored",
                "pattern message",
            ]
        );
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
        let mut it = Driver::connected(Config::default());
        it.read(&push("spsubscribe", "k"));
        it.send("X");
        it.checkpoint();
        it.read(&push("spsubscribe", "k"));
        assert_eq!(
            it.take(),
            ["ignored", "write X", "resolve #1 >spsubscribe k"]
        );

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

    #[derive(Copy, Clone)]
    enum Step {
        Send(&'static str),
        Subscribe(&'static str),
        Unsubscribe(&'static str),
        /// `unsubscribe(channel, listener)`, for a channel that keeps another.
        Remove(&'static str, u32),
        /// Kind, name (`_` for null) and count.
        Ack(&'static str, &'static str, u32),
        Read(&'static str),
        Fail,
        SessionBroke,
        Close,
        Connect,
        Lost,
        /// Up to the reply to HELLO.
        Redial,
    }
    use Step::*;

    fn run(config: Config, steps: &[Step]) -> Driver {
        let mut it = Driver::connected(config);
        let names = |text: &str| -> Vec<Name> {
            let names = text.split_ascii_whitespace();
            names.map(|it| it.as_bytes().into()).collect()
        };
        for step in steps {
            match *step {
                Send(command) => it.send(command),
                Subscribe(channels) => {
                    it.sent += 1;
                    for name in names(channels) {
                        it.listeners.entry(name).or_default().push(it.sent);
                    }
                    let _ = it.client.subscribe(&names(channels), it.sent);
                }
                Unsubscribe("") => {
                    it.listeners.clear();
                    it.client.clear_listeners();
                    it.send("UNSUBSCRIBE");
                }
                Unsubscribe(channels) => {
                    for name in names(channels) {
                        it.listeners.remove(&name);
                        it.client.retain_listeners(&name, |_| false);
                    }
                    it.send(&format!("UNSUBSCRIBE {channels}"));
                }
                Remove(channel, listener) => {
                    let listeners = it.listeners.get_mut(channel.as_bytes()).unwrap();
                    let keep = |index| listeners[index] != listener;
                    it.client.retain_listeners(channel.as_bytes(), keep);
                    listeners.retain(|it| *it != listener);
                }
                Ack(kind, name, count) => {
                    let name = match name {
                        "_" => name.into(),
                        _ => format!("${}\r\n{name}", name.len()),
                    };
                    let len = kind.len();
                    it.read(&format!(">3\r\n${len}\r\n{kind}\r\n{name}\r\n:{count}\r\n"));
                }
                Read(data) => it.read(&format!("{data}\r\n")),
                Fail => it.fail(),
                SessionBroke => drop(it.client.session_broke()),
                Close => drop(it.client.close()),
                Connect => it.client.connect(),
                Lost => it.lost(),
                Redial => {
                    it.dial();
                    it.start();
                    it.read(HELLO);
                }
            }
            it.advance();
            it.checkpoint();
        }
        it
    }

    #[test]
    fn surplus_acknowledgements() {
        let rows: &[(&str, &[Step], &[&str])] = &[
            (
                "a name twice",
                &[
                    Send("SUBSCRIBE a a"),
                    Send("SUBSCRIBE a"),
                    Ack("subscribe", "a", 1),
                    Ack("subscribe", "a", 1),
                    Ack("subscribe", "a", 1),
                ],
                &["subscribed #1", "ignored", "subscribed #2"],
            ),
            (
                "one left out in the middle",
                &[
                    Send("SUBSCRIBE a b c"),
                    Send("SUBSCRIBE b"),
                    Ack("subscribe", "a", 1),
                    Ack("subscribe", "c", 2),
                    Ack("subscribe", "b", 3),
                ],
                &["subscribed #1", "ignored", "subscribed #2"],
            ),
            (
                "another kind under an owed name",
                &[
                    Send("SUBSCRIBE a b"),
                    Send("UNSUBSCRIBE b"),
                    Ack("subscribe", "a", 1),
                    Ack("unsubscribe", "b", 1),
                ],
                &["subscribed #1", "unsubscribed #2"],
            ),
            (
                "a message in between",
                &[
                    Send("SUBSCRIBE a b"),
                    Send("SUBSCRIBE c"),
                    Ack("subscribe", "a", 1),
                    Ack("message", "a", 0),
                    Ack("subscribe", "b", 2),
                    Ack("subscribe", "c", 3),
                ],
                &["subscribed #1", "message a", "ignored", "subscribed #2"],
            ),
            (
                "none is owed after a reply",
                &[
                    Send("SUBSCRIBE a b"),
                    Send("PING"),
                    Send("SUBSCRIBE b"),
                    Ack("subscribe", "a", 1),
                    Read("+PONG"),
                    Ack("subscribe", "b", 2),
                ],
                &["subscribed #1", "resolve #2 PONG", "subscribed #3"],
            ),
            (
                "none is owed on the next connection",
                &[
                    Send("SUBSCRIBE a b"),
                    Ack("subscribe", "a", 1),
                    Lost,
                    Redial,
                    Send("SUBSCRIBE b"),
                    Ack("subscribe", "b", 1),
                ],
                &[
                    "subscribed #1",
                    "retry in 50 []",
                    "connected map of 1",
                    "subscribed #2",
                ],
            ),
            (
                "no arguments, then a subscribe",
                &[
                    Send("UNSUBSCRIBE"),
                    Send("SUBSCRIBE c"),
                    Ack("unsubscribe", "a", 1),
                    Ack("unsubscribe", "b", 0),
                    Ack("subscribe", "c", 1),
                ],
                &["unsubscribed #1", "ignored", "subscribed #2"],
            ),
            (
                "no arguments with a pattern held, then a name",
                &[
                    Send("UNSUBSCRIBE"),
                    Send("UNSUBSCRIBE x"),
                    Ack("unsubscribe", "a", 3),
                    Ack("unsubscribe", "b", 2),
                    Ack("unsubscribe", "c", 1),
                    Ack("unsubscribe", "x", 1),
                ],
                &["unsubscribed #1", "ignored", "ignored", "unsubscribed #2"],
            ),
            (
                "no arguments three times",
                &[
                    Send("UNSUBSCRIBE"),
                    Send("UNSUBSCRIBE"),
                    Send("UNSUBSCRIBE"),
                    Ack("unsubscribe", "a", 0),
                    Ack("unsubscribe", "_", 0),
                    Ack("unsubscribe", "_", 0),
                ],
                &["unsubscribed #1", "unsubscribed #2", "unsubscribed #3"],
            ),
            (
                "no arguments twice, and a peer that counts 0 for no name",
                &[
                    Send("UNSUBSCRIBE"),
                    Send("UNSUBSCRIBE"),
                    Ack("unsubscribe", "a", 1),
                    Ack("unsubscribe", "_", 0),
                ],
                &["unsubscribed #1", "unsubscribed #2"],
            ),
            (
                "pipelined",
                &[
                    Send("PUNSUBSCRIBE a b"),
                    Send("PUNSUBSCRIBE c"),
                    Ack("punsubscribe", "a", 0),
                    Ack("punsubscribe", "b", 0),
                    Ack("punsubscribe", "c", 0),
                ],
                &[
                    "unsubscribed #1 >punsubscribe a",
                    "ignored",
                    "unsubscribed #2 >punsubscribe c",
                ],
            ),
        ];
        for (name, steps, expected) in rows {
            let mut log = run(Config::default(), steps).take();
            log.retain(|line| !line.starts_with("write"));
            assert_eq!(log, *expected, "{name}");
        }
    }

    const A: Step = Ack("subscribe", "a", 1);

    #[test]
    fn listeners_left() {
        let rows: &[(&str, &[Step], &str)] = &[
            ("acknowledged", &[Subscribe("a b"), A, Lost], "a[1] b[1]"),
            (
                "queued by MULTI",
                &[Subscribe("a"), Read("+QUEUED"), Lost],
                "a[1]",
            ),
            ("refused", &[Subscribe("a b"), Read("-NO")], ""),
            (
                "refused, a name twice",
                &[Subscribe("a a"), Read("-NO")],
                "",
            ),
            (
                "refused ahead of another",
                &[Subscribe("a b"), Subscribe("a"), Read("-NO")],
                "a[2]",
            ),
            (
                "refused in subscriber mode, which fails the one behind it too",
                &[
                    Subscribe("a"),
                    A,
                    Subscribe("a b"),
                    Subscribe("a"),
                    Read("-NO"),
                ],
                "a[1]",
            ),
            (
                "refused after an older listener went",
                &[
                    Subscribe("a"),
                    Read("+QUEUED"),
                    Subscribe("a"),
                    Subscribe("a"),
                    Remove("a", 1),
                    Read("-NO"),
                ],
                "a[3]",
            ),
            (
                "refused after its own listener went",
                &[
                    Subscribe("a"),
                    Unsubscribe("a"),
                    Subscribe("a"),
                    Read("-NO"),
                ],
                "a[3]",
            ),
            (
                "a raw request is refused",
                &[Subscribe("a"), A, Send("SUBSCRIBE a"), Read("-NO")],
                "a[1]",
            ),
            (
                "dropped, one still queued",
                &[Subscribe("a"), Subscribe("a b"), Lost],
                "a[2] b[2]",
            ),
            (
                "dropped twice",
                &[
                    Subscribe("a"),
                    Subscribe("a"),
                    Subscribe("a"),
                    Lost,
                    Redial,
                    Lost,
                ],
                "a[3]",
            ),
            (
                "closed",
                &[
                    Subscribe("a"),
                    A,
                    Subscribe("a"),
                    Subscribe("a b"),
                    Close,
                    Lost,
                ],
                "a[1]",
            ),
            ("failed", &[Subscribe("a"), Subscribe("b"), Fail, Lost], ""),
            (
                "failed, and another queued ahead of the close",
                &[Subscribe("a"), Fail, Connect, Subscribe("a"), Lost],
                "",
            ),
            (
                "the session broke",
                &[Subscribe("a"), SessionBroke, Lost],
                "",
            ),
            (
                "answered in RESP2",
                &[
                    Subscribe("a"),
                    Read("*3\r\n$9\r\nsubscribe\r\n$1\r\na\r\n:1"),
                ],
                "",
            ),
        ];
        for (name, steps, expected) in rows {
            let it = run(Config::default(), steps);
            let left = (it.listeners.iter()).map(|(k, v)| format!("{}{v:?}", k.escape_ascii()));
            assert_eq!(left.collect::<Vec<_>>().join(" "), *expected, "{name}");
        }
    }

    #[test]
    fn modes() {
        #[derive(Debug, PartialEq)]
        enum Mode {
            Fresh,
            Plain,
            Subscriber,
        }
        use Mode::*;
        const P: Step = Ack("psubscribe", "p", 1);
        const UN_A: Step = Ack("unsubscribe", "a", 0);
        let rows: &[(&str, &[Step], Mode)] = &[
            ("nothing yet", &[], Fresh),
            (
                "a raw request is refused",
                &[Send("SUBSCRIBE a"), Read("-NO")],
                Fresh,
            ),
            ("not acknowledged yet", &[Subscribe("a")], Plain),
            ("acknowledged", &[Subscribe("a"), A], Subscriber),
            (
                "dropped with a listener",
                &[Subscribe("a"), A, Lost],
                Subscriber,
            ),
            (
                "dropped with a pattern",
                &[Send("PSUBSCRIBE p"), P, Lost],
                Plain,
            ),
            (
                "queued by MULTI, and restored",
                &[Subscribe("a"), Read("+QUEUED"), Lost, Redial, A],
                Subscriber,
            ),
            (
                "unsubscribing",
                &[Subscribe("a"), A, Unsubscribe("a")],
                Subscriber,
            ),
            (
                "unsubscribed",
                &[Subscribe("a"), A, Unsubscribe("a"), UN_A],
                Plain,
            ),
            (
                "a listener is left",
                &[Subscribe("a b"), A, Unsubscribe("a"), UN_A],
                Subscriber,
            ),
            (
                "unsubscribe is refused",
                &[Subscribe("a"), A, Unsubscribe(""), Read("-NO")],
                Plain,
            ),
            (
                "unsubscribe is dropped",
                &[Subscribe("a"), A, Unsubscribe(""), Lost],
                Plain,
            ),
            (
                "unsubscribe cannot be sent",
                &[Subscribe("a"), A, Close, Lost, Unsubscribe("a")],
                Plain,
            ),
            (
                "the successor is refused",
                &[
                    Subscribe("a"),
                    A,
                    Unsubscribe("a"),
                    Subscribe("b"),
                    UN_A,
                    Read("-NO"),
                ],
                Plain,
            ),
        ];
        for (name, steps, expected) in rows {
            let client = run(Config::default(), steps).client;
            let mode = match (client.may_unsubscribe(), client.is_subscriber()) {
                (false, _) => Fresh,
                (true, false) => Plain,
                (true, true) => Subscriber,
            };
            assert_eq!(mode, *expected, "{name}");
        }
    }

    #[test]
    fn an_array_answers() {
        const BROKEN: &str =
            "broken UnsupportedProtocol Subscriptions need RESP3, but this connection uses RESP2";
        for (command, first_item, expected) in [
            ("SUBSCRIBE a", "subscribe", BROKEN),
            ("PSUBSCRIBE a", "psubscribe", BROKEN),
            ("SSUBSCRIBE a", "ssubscribe", BROKEN),
            ("SUBSCRIBE a", "other", "resolve #1 ?"),
            ("UNSUBSCRIBE a", "unsubscribe", "resolve #1 ?"),
            ("UNSUBSCRIBE a", "subscribe", "resolve #1 ?"),
            ("LRANGE k 0 0", "subscribe", "resolve #1 ?"),
        ] {
            let mut it = run(Config::default(), &[Send(command)]);
            it.read(&format!("*1\r\n${}\r\n{first_item}\r\n", first_item.len()));
            assert_eq!(it.log[1], expected, "{command}, {first_item}");
        }
    }

    #[test]
    fn restore() {
        const B: Step = Ack("subscribe", "b", 2);
        const PONG: Step = Read("+PONG");
        const CONNECTED: &str = "connected map of 1";
        const WRITE: &str = "write SUBSCRIBE a SUBSCRIBE b";
        const PINGED: &[&str] = &[CONNECTED, WRITE, "write PING", "resolve #2 PONG"];
        let rows: &[(&str, &[Step], &[&str])] = &[
            ("acknowledged", &[Redial, Send("PING"), A, B, PONG], PINGED),
            (
                "plain replies",
                &[Redial, Send("PING"), Read("+OK"), Read("+OK"), PONG],
                PINGED,
            ),
            (
                "all are refused",
                &[Redial, Send("PING"), Read("-BUSY"), Read("-NOAUTH"), PONG],
                &[
                    CONNECTED,
                    WRITE,
                    "write PING",
                    "not restored a BUSY",
                    "not restored b NOAUTH",
                    "resolve #2 PONG",
                ],
            ),
            (
                "pushes in between",
                &[
                    Redial,
                    Send("PING"),
                    A,
                    Ack("message", "a", 0),
                    Ack("invalidate", "k", 0),
                    B,
                    PONG,
                ],
                &[
                    CONNECTED,
                    WRITE,
                    "write PING",
                    "message a",
                    "resolve #2 PONG",
                ],
            ),
            (
                "one is refused, and tried again on the next connection",
                &[Redial, A, Read("-NOPERM no"), Lost, Redial],
                &[
                    CONNECTED,
                    WRITE,
                    "not restored b NOPERM no",
                    "retry in 50 []",
                    CONNECTED,
                    WRITE,
                ],
            ),
            (
                "a stray acknowledgement does not answer what is behind it",
                &[
                    Redial,
                    Send("PUNSUBSCRIBE p"),
                    Ack("unsubscribe", "z", 0),
                    A,
                    B,
                    Ack("punsubscribe", "p", 2),
                ],
                &[
                    CONNECTED,
                    WRITE,
                    "write PUNSUBSCRIBE p",
                    "unsubscribed",
                    "unsubscribed #2 >punsubscribe p",
                ],
            ),
            (
                "an error behind it",
                &[Redial, Send("PING"), A, B, Read("-NO")],
                &[
                    CONNECTED,
                    WRITE,
                    "write PING",
                    "broken ServerError NO",
                    "fail Some([2])",
                    "closed [] Final",
                ],
            ),
            (
                "dropped",
                &[Redial, Send("PING"), A, Lost],
                &[CONNECTED, WRITE, "write PING", "retry in 100 [2]"],
            ),
            (
                "dropped after it is answered",
                &[Redial, A, B, Lost],
                &[CONNECTED, WRITE, "retry in 50 []"],
            ),
            (
                "an unsubscribe is queued",
                &[Unsubscribe("a"), Redial, B],
                &[CONNECTED, "write SUBSCRIBE b", "write UNSUBSCRIBE a"],
            ),
            (
                "a subscribe is queued",
                &[Subscribe("a c"), Redial, A, B, A],
                &[CONNECTED, WRITE, "write SUBSCRIBE a c", "subscribed #2"],
            ),
            (
                "only a queued listener is left",
                &[Subscribe("a"), Remove("a", 1), Redial, B],
                &[CONNECTED, "write SUBSCRIBE b", "write SUBSCRIBE a"],
            ),
            (
                "no listener is left",
                &[Unsubscribe(""), Redial],
                &[CONNECTED, "write UNSUBSCRIBE"],
            ),
        ];
        for (name, steps, expected) in rows {
            let steps = [&[Subscribe("a b"), A, B, Lost], *steps].concat();
            let mut log = run(Config::default(), &steps).take();
            log.retain(|line| line != "ignored" && line != "write HELLO 3");
            assert_eq!(log[3..], **expected, "{name}");
        }
    }

    #[test]
    fn the_restore_follows_the_remembered_database() {
        let steps = [
            Subscribe("a"),
            A,
            Send("SELECT 1"),
            Read("+OK"),
            Lost,
            Redial,
            Read("+OK"),
        ];
        let log = run(Config::default(), &steps).take();
        assert_eq!(
            log[log.len() - 4..],
            [
                "write HELLO 3 SELECT 1",
                "ignored",
                "connected map of 1",
                "write SUBSCRIBE a",
            ]
        );
    }

    #[test]
    fn a_session_that_breaks_in_the_restore_forgets_the_database_it_was_leaving() {
        let steps = [
            Subscribe("a"),
            A,
            Send("SELECT 1"),
            Read("+OK"),
            Lost,
            Redial,
            Read("+OK"),
            Send("RESET"),
            SessionBroke,
            Lost,
            Redial,
        ];
        let log = run(Config::default(), &steps).take();
        assert_eq!(log[log.len() - 3], "write HELLO 3");
    }

    #[test]
    fn the_restore_keeps_the_retries_and_the_database() {
        let reach = [
            Subscribe("a b"),
            A,
            Send("SELECT 1"),
            Read("+OK"),
            Lost,
            Redial,
            Read("+OK"),
        ];
        let select = "write HELLO 3 SELECT 1";
        let rows: [(&[Step], [&str; 2]); 4] = [
            (&[], ["retry in 100 []", select]),
            (&[A], ["retry in 100 []", select]),
            (&[A, A], ["retry in 50 []", select]),
            (&[Close, Connect], ["retry in 100 []", "write HELLO 3"]),
        ];
        for (row, (steps, expected)) in rows.into_iter().enumerate() {
            let mut it = run(Config::default(), &[&reach, steps, &[Lost]].concat());
            it.dial();
            it.start();
            assert_eq!(it.log[it.log.len() - 2..], expected, "{row}");
            assert_eq!(it.client.abandon_handshake(), row != 3, "{row}");
        }
    }
}
