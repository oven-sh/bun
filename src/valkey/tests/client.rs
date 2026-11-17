use bun_valkey::client::{Acked, Client, Close, Config, Event, Lost, Sent};
use bun_valkey::command::Reply;
use bun_valkey::valkey_protocol::RESPValue;

/// Stands in for wtf-bindings.cpp; no test sends a double.
#[unsafe(no_mangle)]
extern "C" fn WTF__parseDouble(_: *const u8, _: usize, _: *mut usize) -> f64 {
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

    fn handshake(&mut self) {
        self.client.dial();
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
                    as_buffer,
                } => {
                    let buffer = if as_buffer { " as buffer" } else { "" };
                    format!("resolve #{promise} {}{buffer}", show(&value))
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

    fn lost(&mut self) {
        self.batch_is_due = false;
        let line = match self.client.lost(false) {
            Lost::ForGood { reason, pending } => format!("closed {pending:?} {reason}"),
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

    const STATES: [&str; 10] = [
        "idle",
        "dialing",
        "hello",
        "select",
        "ready",
        "ending policy",
        "ending final",
        "ending failed",
        "backoff",
        "closed",
    ];

    /// With a command queued wherever one can be.
    fn reach(state: &str) -> Driver {
        let mut it = Driver::new(database(1));
        if state != "idle" {
            it.client.dial();
            it.send("WATCH a");
            it.send("WATCH b");
        }
        match state {
            "idle" | "dialing" => {}
            "hello" | "select" | "ready" => {
                it.start();
                if state != "hello" {
                    it.read(HELLO);
                }
                if state == "ready" {
                    it.read("+OK\r\n");
                }
            }
            "ending policy" => it.client.dial_failed(),
            "ending final" => drop(it.client.close()),
            "ending failed" => it.fail(),
            "backoff" => it.lost(),
            "closed" => {
                it.fail();
                it.lost();
            }
            _ => unreachable!(),
        }
        it.log.clear();
        it
    }

    /// Tells the states apart through what they do.
    fn name(mut it: Driver) -> &'static str {
        let client = &it.client;
        if client.never_dialed() {
            "idle"
        } else if client.is_connected() {
            it.log.clear();
            it.read(":1\r\n");
            match it.log[0].as_bytes()[0] {
                b'b' => "select",
                _ => "ready",
            }
        } else if client.awaits_retry() {
            "backoff"
        } else if !client.is_active() {
            "closed"
        } else if client.is_ending() && client.rejection().is_some() {
            "ending failed"
        } else if client.is_ending() {
            match it.client.lost(false) {
                Lost::ForGood { .. } => "ending final",
                Lost::Retry { .. } => "ending policy",
            }
        } else {
            it.log.clear();
            it.start();
            if it.log.is_empty() {
                "hello"
            } else {
                "dialing"
            }
        }
    }

    fn row(event: impl Fn(&mut Driver)) -> [String; 10] {
        STATES.map(|state| {
            let mut it = reach(state);
            event(&mut it);
            let did = it.take().join(", ");
            let next = name(it);
            format!("{did} -> {}", if next == state { "=" } else { next })
        })
    }

    #[test]
    fn states_are_told_apart() {
        assert_eq!(STATES.map(|state| name(reach(state))), STATES);
    }

    #[test]
    fn connect() {
        assert_eq!(
            row(|it| it.client.connect()),
            [
                " -> =",
                " -> =",
                " -> =",
                " -> =",
                " -> =",
                " -> =",
                " -> ending policy",
                " -> ending final",
                " -> =",
                " -> backoff",
            ]
        );
    }

    #[test]
    fn close() {
        let close = |it: &mut Driver| {
            let close = match it.client.close() {
                Close::Nothing => "nothing",
                Close::Socket => "socket",
                Close::Retry => "retry",
            };
            it.log.push(close.into());
        };
        assert_eq!(
            row(close),
            [
                "nothing -> =",
                "socket -> ending final",
                "socket -> ending final",
                "socket -> ending final",
                "socket -> ending final",
                "nothing -> ending final",
                "nothing -> =",
                "nothing -> =",
                "retry -> ending final",
                "nothing -> =",
            ]
        );
    }

    #[test]
    fn fail() {
        assert_eq!(
            row(Driver::fail),
            [
                "fail None -> =",
                "fail Some([1, 2]) -> ending failed",
                "fail Some([1, 2]) -> ending failed",
                "fail Some([1, 2]) -> ending failed",
                "fail Some([1, 2]) -> ending failed",
                "fail Some([1, 2]) -> ending failed",
                "fail Some([1, 2]) -> ending failed",
                "fail None -> =",
                "fail None -> =",
                "fail None -> =",
            ]
        );
    }

    #[test]
    fn lost() {
        let lost = |it: &mut Driver| {
            if it.client.is_active() && !it.client.awaits_retry() {
                it.lost();
            }
        };
        assert_eq!(
            row(lost),
            [
                " -> =",
                "retry in 50 [] -> backoff",
                "retry in 50 [] -> backoff",
                "retry in 50 [] -> backoff",
                "retry in 50 [1] -> backoff",
                "retry in 50 [] -> backoff",
                "closed [1, 2] Connection closed -> closed",
                "closed [] Connection closed -> closed",
                " -> =",
                " -> =",
            ]
        );
    }

    #[test]
    fn only_a_dial_says_hello() {
        let mut expected = [" -> ="; 10];
        expected[1] = "write HELLO 3 SELECT 1 -> hello";
        assert_eq!(row(Driver::start), expected);
    }

    #[test]
    fn only_a_ready_client_writes_commands() {
        let send = |it: &mut Driver| {
            it.send("GET k");
            it.batch_is_due = true;
            it.advance();
            it.checkpoint();
        };
        let mut expected = [" -> ="; 10];
        expected[7] = "refuse #3: Connection has failed -> =";
        expected[9] = "refuse #3: Connection has failed -> =";
        assert_eq!(row(send), expected);
    }

    #[test]
    fn a_broken_session_is_a_lost_connection_after_hello() {
        let broke = STATES.map(|state| reach(state).client.session_broke());
        let mut expected = [const { None }; 10];
        expected[3] = Some(vec![]);
        expected[4] = Some(vec![1]);
        assert_eq!(broke, expected);

        let mut it = Driver::connected(Config {
            enable_auto_reconnect: false,
            ..Config::default()
        });
        assert_eq!(it.client.session_broke(), None);
    }

    #[test]
    fn timeouts() {
        assert_eq!(
            STATES.map(|state| reach(state).client.timeout_ms()),
            [10000, 10000, 10000, 7, 7, 10000, 10000, 0, 10000, 0]
        );
    }

    #[test]
    fn backoff_doubles_until_the_retries_are_used_up() {
        let mut it = Driver::new(Config {
            max_retries: 8,
            ..Config::default()
        });
        for _ in 0..9 {
            it.client.dial();
            it.lost();
        }
        let mut expected = [50, 100, 200, 400, 800, 1600, 2000, 2000]
            .map(|ms| format!("retry in {ms} []"))
            .to_vec();
        expected.push("closed [] Max reconnection attempts reached".into());
        assert_eq!(it.take(), expected);

        it.client.connect();
        it.client.dial();
        it.lost();
        assert_eq!(it.take(), ["retry in 50 []"]);
    }

    #[test]
    fn retries_start_over_when_hello_is_accepted() {
        let mut it = Driver::new(database(1));
        for replies in ["", "", HELLO] {
            it.client.dial();
            it.start();
            it.read(replies);
            it.log.clear();
            it.lost();
        }
        assert_eq!(it.take(), ["retry in 50 []"]);
    }

    #[test]
    fn no_retry() {
        let mut it = Driver::connected(Config::default());
        assert!(matches!(it.client.lost(true), Lost::ForGood { .. }));
        let mut it = Driver::connected(Config {
            enable_auto_reconnect: false,
            ..Config::default()
        });
        assert!(matches!(it.client.lost(false), Lost::ForGood { .. }));
    }

    #[test]
    fn no_offline_queue() {
        let mut it = Driver::new(Config {
            enable_offline_queue: false,
            ..database(1)
        });
        it.client.dial();
        it.start();
        it.send("GET k");
        it.read(HELLO);
        it.send("WATCH k");
        it.read("+OK\r\n");
        assert_eq!(
            it.take(),
            [
                "write HELLO 3 SELECT 1",
                "refuse #1: Connection is closed and offline queue is disabled",
                "connected map of 1",
                "ignored",
                "write WATCH k",
            ]
        );
    }

    #[test]
    fn a_batch_does_not_wait_for_select() {
        let mut it = Driver::new(database(1));
        it.client.dial();
        it.start();
        it.read(HELLO);
        it.send("GET k");
        it.checkpoint();
        assert_eq!(it.log.last().unwrap(), "write GET k");
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
            it.client.dial();
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
            (1, "+OK\r\n|0\r\n+OK\r\n", "ignored"),
            (0, "%1\r\n$5\r\nproto\r\n:2\r\n", "connected map of 1"),
            (
                0,
                "%1\r\n+proto\r\n:2\r\n",
                "broken UnsupportedProtocol Server does not support RESP3",
            ),
            (0, "-NO\r\n", "broken AuthenticationFailed NO"),
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
            (1, "%0\r\n+OK\r\n", "ignored"),
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
            it.client.dial();
            it.start();
            it.read(replies);
            assert_eq!(it.log[1 + db as usize], expected);
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
        it.client.dial();
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
                "closed [] Connection closed",
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
