use bun_quic::Direction::{Bidirectional, Unidirectional};
use bun_quic::Layer::Transport;
use bun_quic::transport_code::APPLICATION_ERROR;
use bun_quic::{Duration, KeepAlive, StreamId};

use crate::harness::raw::Kind::{Handshake, Initial};
use crate::harness::raw::{RTT, Raw};

impl Raw {
    /// Returns how many milliseconds that took.
    fn wait_for_the_end(&mut self) -> u64 {
        let start = self.now;
        while self.peer.closed.is_none() {
            self.forget();
            self.wait();
        }
        (self.now - start).as_millis()
    }
}

/// RFC 9000 §10.1.
#[test]
fn idle_timeout_is_the_shorter_one() {
    for (new, local, remote, timeout) in [
        (Raw::client as fn() -> Raw, 5000, "", 5000),
        (Raw::client, 5000, "0", 5000),
        (Raw::client, 5000, "7000", 5000),
        (Raw::server, 5000, "7000", 5000),
        (Raw::server, 7000, "5000", 5000),
        (Raw::server, 0, "5000", 5000),
        (Raw::server, 449, "", 450),
        (Raw::server, 451, "", 451),
    ] {
        let raw = new().config(|it| it.parameters.max_idle_timeout_millis = local);
        let mut raw = (raw.with(&format!("max_idle_timeout={remote}"))).connected();
        raw.send("padding 3");
        assert_eq!(raw.wait(), timeout);
        assert_eq!(raw.events(), "closed: IdleTimeout");
        assert_eq!(raw.packets(), "");
        raw.send("ping");
        assert_eq!(raw.events(), "stray");
    }
}

#[test]
fn idle_timeout_is_at_least_three_probe_timeouts() {
    let raw = Raw::server().config(|it| it.parameters.max_idle_timeout_millis = 1000);
    let mut raw = raw.with("max_ack_delay=500").connected();
    raw.send("padding 3");
    assert_eq!(raw.wait(), 1627);

    let mut raw = Raw::client().config(|it| it.parameters.max_idle_timeout_millis = 1000);
    raw.start(&[]);
    raw.send_in(Handshake, "flight");
    assert_eq!(raw.wait_for_the_end(), 3000);
    assert_eq!(raw.events(), "closed: IdleTimeout");
}

#[test]
fn no_idle_timeout() {
    let raw = Raw::server().config(|it| it.parameters.max_idle_timeout_millis = 0);
    let mut raw = raw.connected();
    raw.peer.open(Bidirectional);
    raw.advance(1000);
    assert_eq!(raw.peer.endpoint.timeout(), None);
}

#[test]
fn idle_timer_restarts_with_every_packet_that_is_received() {
    for raw in Raw::both() {
        let mut raw = raw.config(|it| it.progress_timeout = Duration::ZERO);
        raw = raw.connected();
        for frames in ["ping", "ack", "padding 3", "max_data 1"] {
            raw.advance(29_000);
            raw.send(frames);
        }
        assert_eq!(raw.wait_for_the_end(), 30_000);
    }
}

#[test]
fn idle_timer_restarts_with_the_first_packet_that_is_sent() {
    let mut raw = Raw::client().connected();
    raw.advance(10_000);
    raw.request_packets("a");
    raw.advance(10_000);
    raw.request_packets("b");
    assert_eq!(raw.wait_for_the_end(), 20_000);
    assert_eq!(raw.events(), "3 closed, 7 closed, closed: IdleTimeout");
}

#[test]
fn idle_timer_runs_before_the_first_packet_is_sent() {
    let mut raw = Raw::server().config(|it| it.handshake_timeout = Duration::ZERO);
    (raw.peer).connect(raw.now, raw.addresses.peer, raw.random, &[]);
    let timeout = raw.peer.endpoint.timeout().unwrap();
    assert_eq!(timeout - raw.now, Duration::from_secs(30));
    raw.now = raw.now + Duration::from_secs(1);
    assert_eq!(raw.wait_for_the_end(), 30_000);
}

#[test]
fn acknowledgments_that_are_sent_do_not_restart_the_idle_timer() {
    let mut raw = Raw::client().connected();
    raw.send("ping");
    assert_eq!(raw.wait_for_the_end(), 30_000);
}

#[test]
fn timeouts_can_be_announced() {
    type Step = fn(&mut Raw);
    let cases: [(fn() -> Raw, Step, &str, &str); 6] = [
        (Raw::client, Raw::shake_hands, "1[close 0x0]", "Idle"),
        (
            Raw::server,
            Raw::shake_hands,
            "H[close 0x0] 1[close 0x0]",
            "Handshake",
        ),
        (
            Raw::client,
            |it| it.send_in(Handshake, "ack"),
            "H[close 0x0] 1[close 0x0]",
            "Handshake",
        ),
        (
            Raw::server,
            |it| it.send_in(Initial, "ack, hello"),
            "H[close 0x0]",
            "Handshake",
        ),
        (Raw::client, |_| {}, "", "Handshake"),
        (Raw::server, |_| {}, "", "Handshake"),
    ];
    for (new, step, packets, timeout) in cases {
        let mut raw = new().config(|it| it.closes_silently = false);
        raw.start(&[]);
        step(&mut raw);
        raw.wait_for_the_end();
        assert_eq!(raw.packets(), packets);
        assert_eq!(raw.events(), format!("closed: {timeout}Timeout"));
        assert_eq!(raw.peer.endpoint.timeout(), None);
    }
}

#[test]
fn what_has_arrived_is_delivered_after_a_timeout() {
    let mut raw = Raw::client().connected();
    raw.send("stream 0 0 a");
    raw.connection().set_paused(StreamId(0), true);
    raw.send("stream 0 1 b");
    raw.wait_for_the_end();
    assert_eq!(raw.events(), "0 data b, 0 closed, closed: IdleTimeout");
}

#[test]
fn handshake_timeout() {
    for (handshake, idle, timeout) in [
        (10_000, 30_000, 10_000),
        (10_000, 0, 10_000),
        (10_000, 5000, 5000),
        (10_000, 1000, 3000),
        (0, 30_000, 30_000),
    ] {
        for raw in Raw::both() {
            let mut raw = raw.config(|it| {
                it.handshake_timeout = Duration::from_millis(handshake);
                it.parameters.max_idle_timeout_millis = idle;
            });
            raw.start(&[]);
            assert_eq!(raw.wait_for_the_end(), timeout);
            assert_eq!(raw.events(), "closed: HandshakeTimeout");
        }
    }
}

#[test]
fn client_that_has_answered_gets_more_time_for_the_handshake() {
    for (handshake, idle, timeout) in [
        (10_000, 30_000, 30_000),
        (10_000, 0, 10_000),
        (0, 30_000, 31_000),
    ] {
        let mut raw = Raw::client().config(|it| {
            it.handshake_timeout = Duration::from_millis(handshake);
            it.parameters.max_idle_timeout_millis = idle;
        });
        raw.set("max_idle_timeout=40000");
        raw.start(&[]);
        raw.advance(1000);
        raw.send_in(Handshake, "ack");
        assert_eq!(1000 + raw.wait_for_the_end(), timeout);
        assert_eq!(raw.events(), "closed: HandshakeTimeout");
    }
}

/// RFC 9000 §10.1.2.
#[test]
fn keep_alive() {
    let every = |millis| KeepAlive::Every(Duration::from_millis(millis));
    for (mode, idle, has_stream, period) in [
        (KeepAlive::WhileStreamsAreOpen, 30_000, true, Some(15_000)),
        (KeepAlive::WhileStreamsAreOpen, 2000, true, Some(1000)),
        (KeepAlive::WhileStreamsAreOpen, 1999, true, None),
        (KeepAlive::WhileStreamsAreOpen, 30_000, false, None),
        (every(700), 30_000, false, Some(700)),
        (every(0), 30_000, true, None),
        (KeepAlive::Never, 30_000, true, None),
    ] {
        for raw in Raw::both() {
            let raw = raw.config(|it| {
                (it.keep_alive, it.progress_timeout) = (mode, Duration::ZERO);
                it.parameters.max_idle_timeout_millis = idle;
            });
            let mut raw = raw.connected();
            if has_stream {
                let id = raw.peer.open(Unidirectional);
                raw.peer.send(id, b"a", false);
            }
            raw.forget();
            raw.send("ack");
            let Some(period) = period else {
                assert_eq!(raw.wait(), idle);
                assert_eq!(raw.packets(), "");
                continue;
            };
            raw.wait();
            for _ in 0..3 {
                assert_eq!(raw.packets(), "1[ping]");
                raw.advance(RTT);
                raw.send("ack");
                assert_eq!(raw.wait(), period);
            }
        }
    }
}

#[test]
fn keep_alive_is_due_sooner_after_data() {
    for (mode, pause) in [
        (KeepAlive::WhileStreamsAreOpen, 1000),
        (KeepAlive::Every(Duration::from_secs(3)), 3000),
    ] {
        let mut raw = Raw::server().config(|it| it.keep_alive = mode).connected();
        raw.send("stream 3 0 a");
        raw.advance(pause - 1);
        assert_eq!(raw.frames(), "");
        raw.advance(1);
        assert_eq!(raw.frames(), "ping");
    }
}

#[test]
fn a_server_does_not_expect_more_data() {
    let raw = Raw::client().config(|it| it.keep_alive = KeepAlive::WhileStreamsAreOpen);
    let mut raw = raw.connected();
    raw.send("stream 0 0 a");
    raw.advance(RTT);
    raw.forget();
    assert_eq!((RTT + raw.wait(), raw.frames()), (15_000, "ping".into()));
}

#[test]
fn a_client_waits_for_the_confirmation_as_long_as_for_the_handshake() {
    let mut raw = Raw::server();
    raw.start(&[]);
    raw.advance(5000);
    raw.shake_hands();
    raw.send_in(Handshake, "ack");
    assert_eq!(raw.wait_for_the_end(), 10_000);
    assert_eq!(raw.events(), "closed: HandshakeTimeout");
}

#[test]
fn keep_alive_counts_from_the_last_packet() {
    for delay in [10_000, 20_000] {
        let mut raw = Raw::server().connected();
        raw.advance(delay);
        raw.request_packets("a");
        raw.send("ack");
        assert_eq!((raw.wait(), raw.frames()), (15_000, "ping".into()));
    }
}

#[test]
fn application_that_neither_reads_nor_writes() {
    type Step = fn(&mut Raw);
    let cases: [(Step, u64); 7] = [
        (|_| {}, 5000 - 2 * RTT - 1000),
        (|it| it.send("stream 0 0 a"), 5000),
        (|it| it.send("fin 0 0 -"), 5000),
        (|it| it.request_packets("a"), 5000),
        (|it| it.send("datagram a"), 5000 - 2 * RTT - 1000),
        (|it| it.connection().note_progress(), 5000),
        (|it| it.connection().send_datagram(1, vec![0]), 5000),
    ];
    for (step, timeout) in cases {
        let raw = Raw::client().config(|it| {
            it.progress_timeout = Duration::from_secs(5);
            it.parameters.max_datagram_frame_size = 100;
        });
        let mut raw = raw.with("max_datagram_frame_size=100").connected();
        raw.advance(1000);
        step(&mut raw);
        assert_eq!(raw.wait_for_the_end(), timeout);
        assert_eq!(raw.error(), Some((Transport, APPLICATION_ERROR)));
    }
}

#[test]
fn progress_at_the_last_moment() {
    let mut raw = Raw::client().config(|it| it.progress_timeout = Duration::from_secs(5));
    raw = raw.connected();
    raw.request_packets("a");
    raw.send("ack");
    raw.advance(4999);
    raw.peer.send(3, b"b", false);
    raw.now = raw.now + Duration::from_millis(1);
    assert_eq!(raw.wait_for_the_end(), 5000);
}

#[test]
fn progress_timeout_that_is_set_later() {
    let mut raw = Raw::client().config(|it| it.progress_timeout = Duration::ZERO);
    raw = raw.connected();
    raw.advance(1000);
    let now = raw.now;
    (raw.connection()).set_progress_timeout(now, Duration::from_secs(5));
    raw.advance(1000);
    let now = raw.now;
    (raw.connection()).set_progress_timeout(now, Duration::from_secs(5));
    assert_eq!(raw.wait_for_the_end(), 4000);
    assert_eq!(raw.error(), Some((Transport, APPLICATION_ERROR)));
}

#[test]
fn application_that_may_be_silent() {
    const LIMIT: u64 = 300;
    for (progress, allowed, is_kept_alive, end) in [
        (60, 30, false, 30),
        (60, 31, true, 60),
        (60, 90, true, 90),
        (60, 0, true, LIMIT),
        (0, 90, true, LIMIT),
    ] {
        let raw = Raw::client().config(|it| it.progress_timeout = Duration::from_secs(progress));
        let mut raw = raw.connected();
        (raw.waits, raw.peer.polls) = (false, false);
        raw.send("stream 0 0 a");
        while raw.peer.poll(raw.now) {}
        let start = raw.now;
        (raw.connection()).allow_silence(start, Duration::from_secs(allowed));
        raw.peer.polls = true;
        raw.advance(RTT);
        raw.send("ack");
        let mut has_pinged = false;
        while raw.peer.closed.is_none() && raw.now < start + Duration::from_secs(LIMIT) {
            raw.forget();
            raw.wait();
            if raw.frames() == "ping" {
                has_pinged = true;
                raw.send("ack");
            }
        }
        let secs = (raw.now - start).as_millis() / 1000;
        assert_eq!((has_pinged, secs), (is_kept_alive, end), "{allowed}");
    }
}

#[test]
fn allowing_silence_again_does_not_put_off_the_next_ping() {
    let mut raw = Raw::client().connected();
    raw.send("stream 0 0 a");
    let mut pings = Vec::new();
    let start = raw.now;
    while raw.now < start + Duration::from_secs(40) {
        let now = raw.now;
        raw.connection().allow_silence(now, Duration::ZERO);
        raw.advance(RTT);
        if raw.frames().ends_with("ping") {
            pings.push((raw.now - start).as_millis() / 1000);
            raw.send("ack");
        }
    }
    assert_eq!(pings, [0, 15, 30]);
}

#[test]
fn silence_is_allowed_from_now_on_and_until_no_stream_is_left() {
    for (frames, allowed, answer, end) in [
        ("fin 0 0 a", 90, "none", 91),
        ("fin 0 0 a", 90, "fin", 61),
        ("fin 0 0 a", 0, "fin", 61),
        ("fin 0 0 a", 0, "reset", 61),
        ("fin 0 0 a, fin 4 0 a", 90, "fin", 91),
    ] {
        let mut raw = Raw::client().connected();
        let start = raw.now;
        raw.send(frames);
        raw.advance(1000);
        let now = raw.now;
        (raw.connection()).allow_silence(now, Duration::from_secs(allowed));
        match answer {
            "fin" => raw.peer.send(0, b"a", true),
            "reset" => raw.connection().reset(StreamId(0), 0),
            _ => {}
        }
        raw.advance(RTT);
        while raw.peer.closed.is_none() && raw.now < start + Duration::from_secs(100) {
            raw.send("ack, ping");
            raw.advance(500);
        }
        let secs = (raw.now - start).as_millis() / 1000;
        assert_eq!(secs, end, "{frames} {allowed} {answer}");
    }
}

#[test]
fn silence_has_to_be_allowed_again_for_later_streams() {
    for (first, last) in [("fin 0 0 a", "stream 4 0 a"), ("stream 0 0 a", "fin 0 1 -")] {
        let mut raw = Raw::client().connected();
        raw.send(first);
        let now = raw.now;
        raw.connection().allow_silence(now, Duration::ZERO);
        raw.peer.send(0, b"a", true);
        raw.advance(RTT);
        raw.send("ack");
        raw.send(last);
        raw.advance(20_000);
        assert_eq!(raw.frames(), "ping, fin 0 0 a");
    }
}

#[test]
fn silence_cannot_be_allowed_after_the_end() {
    let mut raw = Raw::client().connected();
    raw.peer.polls = false;
    raw.send("stream 0 0 a, close 0 0 -");
    let now = raw.now;
    raw.connection().allow_silence(now, Duration::ZERO);
    (raw.connection()).set_progress_timeout(now, Duration::from_secs(50));
    raw.advance(40_000);
    assert_eq!(raw.peer.endpoint.timeout(), None);
}

#[test]
fn connection_that_the_peer_may_have_given_up() {
    for (idle, fresh_for) in [(32_000, 30_000), (1600, 1600 - 202), (300, 450 - 150)] {
        let raw = Raw::server().config(|it| it.parameters.max_idle_timeout_millis = idle);
        let mut raw = raw.connected();
        raw.send("padding 3");
        for (after, is_stale) in [(fresh_for - 1, false), (fresh_for, true)] {
            let now = raw.now + Duration::from_millis(after);
            assert_eq!(raw.connection().is_stale(now), is_stale, "{idle}");
        }
    }

    let mut raw = Raw::server().connected();
    raw.request_packets("a");
    for is_stale in [false, false, true] {
        raw.wait();
        raw.forget();
        let now = raw.now;
        assert_eq!(raw.connection().is_stale(now), is_stale);
    }
    raw.send("ack");
    let now = raw.now;
    assert!(!raw.connection().is_stale(now));
}

#[test]
fn is_not_silent_when_blocked_again_at_the_same_limit() {
    let mut raw = Raw::client().with("max_data=0").connected();
    raw.request_packets("a");
    raw.connection().reset(StreamId(3), 0);
    raw.process();
    raw.send("ack");
    raw.advance(9000);
    raw.forget();
    raw.request_packets("a");
    raw.advance(9000);
    assert!(raw.frames().starts_with("data_blocked 0, ping"));
}

#[test]
fn a_connection_that_is_back_is_not_stale() {
    let raw = Raw::server().with("max_datagram_frame_size=65535");
    let mut raw = raw.connected();
    raw.connection().send_datagram(1, vec![0; 10]);
    raw.process();
    for _ in 0..3 {
        raw.forget();
        raw.wait();
    }
    raw.forget();
    raw.send("ping");
    raw.send("ping");
    let last = raw.take().pop().unwrap().number;
    raw.send(&format!("ack {last}"));
    raw.advance(1000);
    assert_eq!(raw.frames(), "");
    let now = raw.now;
    assert!(!raw.connection().is_stale(now));
}
