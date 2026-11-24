use bun_quic::Direction::{Bidirectional, Unidirectional};
use bun_quic::Layer::Transport;
use bun_quic::transport_code::APPLICATION_ERROR;
use bun_quic::{Duration, KeepAlive, Side, StreamId};

use crate::harness::messages::GET;
use crate::harness::raw::Kind::{Handshake, Initial, Short};
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

    /// Returns how many there were.
    fn answer_pings_for(&mut self, millis: u64) -> usize {
        let is_ping = |_: &u64| {
            self.advance(10);
            let is_ping = self.frames().ends_with("ping");
            self.keep_sending("ack", usize::from(is_ping), 0);
            is_ping
        };
        (0..millis / 10).filter(is_ping).count()
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
fn giving_up_early_leaves_time_for_an_answer_to_the_first_packet_that_is_sent() {
    for (first, second, rest) in [
        (10_000, 10_000, 10_000),
        (10_000, 19_900, 100),
        (29_900, 20, 80),
        (29_990, 20, 47),
    ] {
        let mut raw = (Raw::client().config(|it| it.gives_up_early = true)).connected();
        raw.send("ack");
        raw.advance(first);
        raw.request_packets("a");
        raw.advance(second);
        raw.request_packets("b");
        assert_eq!(raw.wait_for_the_end(), rest);
        assert_eq!(raw.events(), "3 closed, 7 closed, closed: IdleTimeout");
    }
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
fn giving_up_early_is_not_for_the_handshake() {
    let mut raw = Raw::server()
        .config(|it| (it.handshake_timeout, it.gives_up_early) = (Duration::ZERO, true));
    (raw.peer).connect(raw.now, raw.addresses.peer, raw.random, &[]);
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

const CHALLENGE: &str = "path_challenge 12345678";

impl Raw {
    fn keep_sending(&mut self, frames: &str, times: usize, period: u64) {
        for _ in 0..times {
            self.advance(period);
            self.send(frames);
        }
        self.forget();
    }

    fn quiet(self) -> Self {
        let raw = self.config(|it| {
            (it.keep_alive, it.progress_timeout) = (KeepAlive::Never, Duration::ZERO);
            it.parameters.max_datagram_frame_size = 100;
        });
        raw.connected()
    }

    fn kept_sending(mut self) -> Self {
        self.keep_sending("ack, stream 3 0 a", 20, 1);
        self
    }

    /// Has the peer send a request, which is acknowledged.
    fn be_asked(&mut self) -> u64 {
        let id = self.peer.open(Bidirectional);
        self.peer.send(id, b"a", true);
        self.keep_sending("ack", 1, RTT);
        id
    }

    /// Or until the end. Returns how many milliseconds that took.
    fn wait_for_ping(&mut self) -> u64 {
        let start = self.now;
        while self.peer.closed.is_none() && self.frames() != "ping" {
            self.forget();
            self.wait();
        }
        (self.now - start).as_millis()
    }
}

/// RFC 9000 §9.3.
#[test]
fn client_speaks_up_when_a_server_that_kept_sending_falls_silent() {
    for (raw, frames, runs, wait) in [
        (Raw::server(), "stream 3 0 a", &[(19, 1)][..], 1000),
        (Raw::server(), "stream 3 0 a", &[(2, 600)], 1000),
        (Raw::server(), "stream 3 0 a", &[(3, 600)], 1200),
        (Raw::server(), "stream 3 0 a", &[(20, 1)], 135),
        (Raw::server(), "stream 3 0 a", &[(1, 5000), (19, 1)], 135),
        (Raw::server(), "stream 3 0 a", &[(25, 500)], 1000),
        (Raw::server(), "stream 3 0 a", &[(9, 800), (11, 1)], 786),
        (Raw::server(), "stream 3 0 a", &[(9, 1600), (1, 1)], 3000),
        (Raw::server(), "stream 3 0 a", &[(9, 4000), (19, 1)], 2347),
        (Raw::server(), "stream 3 0 a", &[(9, 4000), (20, 1)], 1000),
        (Raw::server(), "stream 3 0 a", &[(2, 900), (1, 500)], 1000),
        (Raw::server(), "stream 3 0 a", &[(2, 900), (1, 501)], 1687),
        (
            Raw::server(),
            "stream 3 0 a",
            &[(2, 900), (19, 1), (1, 900)],
            1800,
        ),
        (
            Raw::server(),
            "stream 3 0 a",
            &[(2, 900), (20, 1), (1, 900)],
            1000,
        ),
        (Raw::server(), "stream 3 0 a", &[(25, 2999)], 5998),
        (Raw::server(), "stream 3 0 a", &[(25, 9000)], 6000),
        (Raw::server(), "fin 3 0 a", &[(20, 1)], 30_000),
        (Raw::server(), "datagram a", &[(20, 1)], 135),
        (Raw::server(), "datagram a", &[(1, 1)], 1000),
        (Raw::server(), "datagram a, fin 3 0 a", &[(20, 1)], 30_000),
        (Raw::server(), "ping", &[(20, 1)], 30_000),
        (Raw::client(), "stream 2 0 a", &[(20, 1)], 30_000),
    ] {
        let mut raw = raw.quiet();
        for &(times, period) in runs {
            raw.keep_sending(&format!("ack, {frames}"), times, period);
        }
        assert_eq!(raw.wait_for_ping(), wait);
    }
}

#[test]
fn client_goes_on_speaking_up_until_the_idle_timeout() {
    let mut raw = Raw::server().quiet().kept_sending();
    for pause in [135, 135, 270, 540, 1080, 2160, 3750, 3750] {
        assert_eq!(raw.wait_for_ping(), pause);
    }
    assert_eq!(raw.wait_for_the_end(), 30_000 - 32 * 135 - 2 * 3750);
}

#[test]
fn client_goes_on_speaking_up_without_an_idle_timeout() {
    let raw = Raw::server().config(|it| it.parameters.max_idle_timeout_millis = 0);
    let mut raw = raw.quiet().kept_sending();
    let pauses = (0..12).map(|_| raw.wait_for_ping());
    assert_eq!(pauses.last(), Some(60_000));
}

#[test]
fn client_that_has_spoken_up_is_content_with_an_acknowledgment_for_a_while() {
    for (answers, waits) in [
        (&["ack"][..], [1000, 135]),
        (&["first ack"], [1000, 135]),
        (&["ack, ping"], [1000, 135]),
        (&["ping", "ping"], [540 - 200, 1080]),
        (&["ack, stream 3 0 a"], [1000, 135]),
        (&["stream 3 0 a", "ack"], [1000, 135]),
        (&[CHALLENGE], [135, 135]),
        (&["ack", CHALLENGE], [135, 135]),
        (&[CHALLENGE, "first ack"], [135, 135]),
        (&[CHALLENGE, "stream 3 0 a"], [135, 135]),
        (&[CHALLENGE, "ack, stream 3 0 a"], [1000, 135]),
        (&[CHALLENGE, "ack"], [1000, 135]),
    ] {
        let mut raw = Raw::server().quiet().kept_sending();
        let before = raw.connection().stats();
        raw.wait_for_ping();
        let first_ack = raw.ack(Short);
        (0..2).for_each(|_| _ = raw.wait_for_ping());
        raw.advance(200);
        for &answer in answers {
            let is_late = answer == "first ack";
            raw.send(if is_late { &first_ack } else { answer });
        }
        let after = raw.connection().stats();
        assert_eq!(after.smoothed_rtt, before.smoothed_rtt);
        assert_eq!(after.congestion_window, before.congestion_window);
        assert_eq!([(); 2].map(|()| raw.wait_for_ping()), waits);
    }
}

#[test]
fn client_that_is_late_goes_by_what_it_has_read() {
    for (pings, frames, packets, wait) in [
        (0, "stream 3 0 a", "", 1000),
        (1, "stream 3 0 a", "", 1000),
        (1, "ack", "", 1000),
        (1, CHALLENGE, "1[path_response, ack]", 135),
    ] {
        let mut raw = Raw::server().quiet().kept_sending();
        (0..pings).for_each(|_| _ = raw.wait_for_ping());
        raw.now = raw.now + Duration::from_millis(500);
        raw.send(frames);
        assert_eq!(raw.outline(), packets);
        assert_eq!(raw.wait_for_ping(), wait);
    }
}

#[test]
fn time_without_a_stream_is_not_a_pause() {
    for end in ["fin 3 1 a", "reset_stream 3 0 1"] {
        let mut raw = Raw::server().quiet().kept_sending();
        raw.send(end);
        raw.keep_sending("ack", 1, RTT);
        raw.keep_sending("stream 7 0 a", 1, 8000);
        assert_eq!(raw.wait_for_ping(), 123);
    }
}

#[test]
fn client_waits_for_the_start_of_an_answer_in_silence() {
    for is_read_late in [false, true] {
        let mut raw = Raw::server().quiet();
        for _ in 0..30 {
            let id = raw.be_asked();
            raw.advance(300);
            assert_eq!(raw.frames(), "");
            raw.peer.polls = !is_read_late;
            raw.send(&format!("fin {id} 0 a"));
            raw.peer.polls = true;
            raw.process();
        }
    }
}

#[test]
fn client_gets_more_patient_with_each_answer() {
    use KeepAlive::{Every, Never, WhileStreamsAreOpen};
    let period = Duration::from_secs(3);
    for (mode, idle, waits) in [
        (WhileStreamsAreOpen, 30_000, [1000, 2000, 4000, 15_000]),
        (Every(period), 9019, [1000, 3000, 3000, 3000]),
        (Never, 30_000, [1000, 2000, 4000, 30_000]),
        (Never, 9020, [1000, 2000, 9020, 0]),
        (Never, 9019, [1000, 9019, 0, 0]),
        (Never, 4000, [1000, 4000, 0, 0]),
        (Never, 3999, [3999, 0, 0, 0]),
    ] {
        for is_request in [false, true] {
            let raw = Raw::server().config(|it| {
                (it.keep_alive, it.progress_timeout) = (mode, Duration::ZERO);
                it.parameters.max_idle_timeout_millis = idle;
            });
            let mut raw = raw.connected();
            match is_request {
                true => _ = raw.be_asked(),
                false => raw.send("ack, stream 3 0 a"),
            }
            for wait in waits {
                assert_eq!(raw.wait_for_ping(), wait);
                raw.keep_sending("ack", usize::from(raw.peer.closed.is_none()), RTT);
            }
        }
    }
}

#[test]
fn client_speaks_up_if_a_request_is_not_answered() {
    type Step = fn(&mut Raw);
    let give_up: Step = |raw| {
        let id = raw.be_asked();
        (0..6).for_each(|_| _ = raw.wait_for_ping());
        raw.connection().stop(StreamId(id), 0);
    };
    let ask_in_vain: Step = |raw| {
        raw.be_asked();
        raw.wait_for_ping();
        raw.keep_sending("ack", 1, RTT);
    };
    let upload: Step = |raw| {
        for _ in 0..100 {
            raw.request_packets("a");
            raw.keep_sending("ack", 1, 100);
        }
    };
    let fall_silent: Step = |raw| raw.keep_sending("stream 3 0 a", 20, 1);
    let finish: Step = |raw| {
        raw.keep_sending("stream 3 0 a", 20, 1);
        raw.send("fin 3 1 a");
    };
    let tick: Step = |raw| {
        raw.keep_sending("ack, stream 3 0 a", 3, 5000);
        raw.advance(5000);
    };
    let nothing: Step = |_| {};
    for (before, after, wait) in [
        ((|raw| raw.advance(29_000)) as Step, nothing, 1000),
        (give_up, nothing, 1000),
        (upload, nothing, 1000),
        (|raw| _ = raw.be_asked(), nothing, 1000),
        (fall_silent, nothing, 123),
        (fall_silent, |raw| raw.send("ack, ping"), 123),
        (finish, nothing, 1000),
        (tick, nothing, 6000),
        (tick, |raw| raw.send("stream 0 0 a"), 6000),
        (ask_in_vain, nothing, 1000),
        (
            nothing,
            |raw| {
                raw.request_packets("a");
                raw.keep_sending("ack", 1, RTT);
            },
            1000 - RTT,
        ),
    ] {
        let mut raw = Raw::server().quiet();
        before(&mut raw);
        raw.be_asked();
        after(&mut raw);
        assert_eq!(raw.wait_for_ping(), wait);
    }
}

#[test]
fn client_learns_how_long_answers_take() {
    for (delay, pings) in [
        (900, [0, 0, 0, 0]),
        (5000, [2, 2, 0, 0]),
        (25_000, [3, 3, 1, 1]),
    ] {
        let mut raw = Raw::server().quiet();
        for pings in pings {
            let id = raw.be_asked();
            assert_eq!(raw.answer_pings_for(delay), pings);
            raw.send(&format!("fin {id} 0 a"));
        }
    }
}

#[test]
fn one_slow_answer_is_not_the_pace() {
    let mut raw = Raw::server().quiet();
    let (first, second) = (raw.be_asked(), raw.be_asked());
    raw.send(&format!("fin {first} 0 a"));
    raw.answer_pings_for(5000);
    raw.send(&format!("stream {second} 0 a"));
    assert_eq!(raw.wait_for_ping(), 1000);
}

#[test]
fn pace_of_messages_that_take_two_packets() {
    let mut raw = Raw::server().quiet();
    for pings in [2, 2, 0, 0, 0] {
        raw.keep_sending("stream 3 0 a", 2, 1);
        assert_eq!(raw.answer_pings_for(5000), pings);
    }
}

#[test]
fn client_does_not_start_over_with_each_piece_of_a_request() {
    for (period, pings, wait) in [(1500, [1, 0, 0, 0], 2000), (5000, [2, 1, 0, 0], 6000)] {
        for (is_answered, wait) in [(false, wait), (true, 1000)] {
            let mut raw = Raw::server().quiet();
            let id = raw.peer.open(Bidirectional);
            for pings in pings {
                raw.peer.send(id, b"a", false);
                raw.keep_sending("ack", 1, RTT);
                assert_eq!(raw.answer_pings_for(period), pings);
            }
            if is_answered {
                raw.keep_sending("stream 0 0 a", 41, 1);
                raw.answer_pings_for(9000);
            }
            raw.peer.send(id, b"a", !is_answered);
            raw.keep_sending("ack", 1, RTT);
            assert_eq!(raw.wait_for_ping(), wait);
        }
    }

    let mut raw = Raw::server().quiet();
    for _ in 0..2 {
        let id = raw.peer.open(Bidirectional);
        raw.peer.send(id, b"a", false);
        raw.keep_sending("ack", 1, RTT);
        assert_eq!(raw.answer_pings_for(9000), 3);
    }

    let mut raw = Raw::server().quiet();
    raw.keep_sending("ack, stream 3 0 a", 4, 5000);
    let id = raw.peer.open(Bidirectional);
    for lag in [1, 2] {
        raw.peer.send(id, b"a", false);
        raw.advance(RTT);
        raw.waits = false;
        raw.send("ack");
        raw.now = raw.now + Duration::from_millis(lag);
        raw.forget();
    }
    assert_eq!(raw.wait_for_ping(), 5999);
}

#[test]
fn time_that_a_request_takes_is_not_a_pause() {
    let mut raw = Raw::server().quiet();
    for _ in 0..2 {
        let id = raw.peer.open(Bidirectional);
        raw.peer.send(id, b"a", false);
        raw.keep_sending("ack", 1, RTT);
        raw.peer.send(id, b"a", false);
        for at in 0..30 {
            raw.advance(RTT);
            let ack = raw.ack(Short);
            raw.peer.send(id, b"a", at == 29);
            raw.process();
            raw.send(&ack);
        }
        raw.keep_sending(&format!("ack, fin {id} 0 a"), 1, RTT);
    }
    raw.be_asked();
    assert_eq!(raw.wait_for_ping(), 1000);
}

#[test]
fn request_that_is_acknowledged_in_steps() {
    let mut raw = Raw::server().quiet();
    let id = raw.peer.open(Bidirectional);
    raw.peer.send(id, b"a", false);
    raw.advance(RTT);
    let ack = raw.ack(Short);
    raw.peer.send(id, b"a", true);
    raw.process();
    raw.send(&ack);
    raw.keep_sending("ack", 1, RTT);
    assert_eq!(raw.wait_for_ping(), 1000);
}

#[test]
fn pace_of_requests_that_are_answered_at_once() {
    for answer in [&["ack, stream 0 0 a"][..], &["ack", "stream 0 0 a"]] {
        let mut raw = Raw::server().quiet();
        let id = raw.peer.open(Bidirectional);
        for pings in [2, 2, 0, 0, 0] {
            raw.peer.send(id, b"a", false);
            (answer.iter()).for_each(|it| raw.keep_sending(it, 1, RTT));
            assert_eq!(raw.answer_pings_for(5000), pings);
        }
    }
}

#[test]
fn client_does_not_speak_up_if_nothing_is_left_to_arrive() {
    let steps: [fn(&mut Raw); 4] = [
        |raw| {
            let id = raw.be_asked();
            raw.connection().set_paused(StreamId(id), true);
            raw.send("fin 0 0 a");
        },
        |raw| {
            let id = raw.peer.open(Bidirectional);
            raw.peer.send(id, b"a", false);
            raw.keep_sending("ack, fin 0 0 a", 1, RTT);
        },
        |raw| {
            raw.peer.open(Unidirectional);
            raw.send("fin 3 0 a");
        },
        |raw| {
            raw.send("datagram a");
            let id = raw.be_asked();
            raw.send(&format!("reset_stream {id} 0 0"));
        },
    ];
    for step in steps {
        let mut raw = Raw::server().quiet();
        step(&mut raw);
        assert_eq!(raw.wait_for_ping(), 30_000);
    }

    let mut raw = Raw::server().quiet();
    steps[1](&mut raw);
    raw.send(CHALLENGE);
    raw.advance(100);
    raw.forget();
    assert_eq!((raw.wait(), raw.outline()), (23, "1[ack, ping]".into()));
}

#[test]
fn only_a_stream_that_can_be_answered_asks_for_something() {
    for (direction, finishes, wait) in [
        (Bidirectional, false, 1000),
        (Unidirectional, false, 30_000),
        (Unidirectional, true, 30_000),
    ] {
        let mut raw = Raw::server().quiet();
        let id = raw.peer.open(direction);
        raw.peer.send(id, b"a", finishes);
        raw.process();
        raw.request_packets("b");
        raw.keep_sending("ack", 1, RTT);
        assert_eq!(raw.wait_for_ping(), wait);
    }
}

#[test]
fn request_that_is_acknowledged_late_starts_over_with_the_usual_patience() {
    let mut raw = Raw::server().quiet();
    raw.be_asked();
    raw.wait_for_ping();
    raw.keep_sending("ack", 1, RTT);
    raw.advance(1999);
    let id = raw.peer.open(Bidirectional);
    raw.peer.send(id, b"a", true);
    raw.forget();
    raw.now = raw.now + Duration::from_millis(RTT);
    raw.peer.endpoint.handle_timeouts(raw.now, || raw.now);
    raw.send("ack");
    raw.wait_for_ping();
    raw.keep_sending("ack", 1, RTT);
    assert_eq!(raw.wait_for_ping(), 1000);
}

#[test]
fn what_http3_says_about_the_connection_is_no_delivery() {
    let mut raw = Raw::http3(Side::Server).connected_with("");
    raw.request(GET);
    raw.keep_sending("ack", 1, RTT);
    raw.advance(400);
    raw.write_encoder("#3fe11f");
    assert_eq!(raw.wait_for_ping(), 600);
}

#[test]
fn client_speaks_up_without_probing_the_mtu() {
    let mut raw = Raw::server().with("max_udp_payload_size=").quiet();
    raw.keep_sending("stream 3 0 a", 24, 1);
    raw.received[2].remove(&10);
    raw.keep_sending("ack", 1, RTT);
    raw.wait();
    assert_eq!(raw.outline(), "1[ack, ping]");
}

#[test]
fn client_does_not_wait_for_an_acknowledgment_for_ever() {
    let mut raw = Raw::server().quiet();
    raw.send(CHALLENGE);
    raw.advance(1000);
    raw.keep_sending("stream 3 0 a", 20, 1);
    assert_eq!(raw.wait_for_ping(), 135);
}

#[test]
fn server_does_not_wait_for_its_response_to_be_acknowledged() {
    let mut raw = Raw::client().quiet();
    raw.send("ack");
    raw.advance(1000);
    raw.send(CHALLENGE);
    raw.advance(RTT);
    assert_eq!(raw.sleeps_for(), 30_000 - RTT);
}

#[test]
fn acknowledgments_do_not_break_the_silence() {
    let mut raw = Raw::server().connected();
    raw.send("ack, stream 3 0 a");
    raw.keep_sending("ack", 2, RTT);
    assert_eq!(raw.wait_for_ping(), 1000 - 2 * RTT);
}

#[test]
fn client_speaks_up_later_if_something_is_in_flight() {
    let mut raw = Raw::server().quiet().kept_sending();
    raw.advance(130);
    raw.request_packets("a");
    raw.advance(RTT);
    assert_eq!(raw.packets(), "");
    raw.send("ack");
    assert_eq!(raw.wait_for_ping(), 135 + 135 - 130 - RTT);
}

#[test]
fn client_stops_speaking_up_to_a_server_that_only_challenges() {
    let mut raw = Raw::server().quiet().kept_sending();
    let start = raw.now;
    while raw.wait_for_ping() < 30_000 {
        raw.send(&format!("ack, {CHALLENGE}"));
    }
    assert_eq!((raw.now - start).as_millis(), 59_981);
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
    for delay in [0, 9000] {
        let mut raw = Raw::server();
        raw.start(&[]);
        raw.advance(5000);
        raw.shake_hands();
        raw.advance(delay);
        raw.send_in(Handshake, "ack");
        assert_eq!(raw.wait_for_the_end(), 10_000);
        assert_eq!(raw.events(), "closed: HandshakeTimeout");
    }
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
        (|it| it.send("fin 2 0 -"), 5000),
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
fn peer_that_takes_what_has_been_written_bit_by_bit() {
    let mut raw = Raw::client().config(|it| it.progress_timeout = Duration::from_secs(5));
    raw = raw.connected();
    for ack in raw.request_three_parts() {
        raw.advance(4000);
        raw.send(&ack);
    }
    assert_eq!(raw.wait_for_the_end(), 5000);
}

#[test]
fn what_arrives_behind_a_gap_or_fills_it_is_progress() {
    let mut raw = Raw::client().config(|it| it.progress_timeout = Duration::from_secs(5));
    raw = raw.connected();
    let [.., last] = raw.request_three_parts();
    for ack in [&last, "ack"] {
        raw.advance(4000);
        raw.send(ack);
    }
    assert_eq!(raw.wait_for_the_end(), 5000);
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
        (raw.connection()).allow_silence(Duration::from_secs(allowed));
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
        raw.connection().allow_silence(Duration::ZERO);
        raw.advance(RTT);
        if raw.frames().ends_with("ping") {
            pings.push((raw.now - start).as_millis() / 1000);
            raw.send("ack");
        }
    }
    assert_eq!(pings, [15, 30]);
}

#[test]
fn peer_that_is_gone_gains_no_more_than_the_time_for_an_answer() {
    for (after, end) in [(0, 30_000..30_001), (29_999, 30_001..30_200)] {
        let mut raw = Raw::client().connected();
        let start = raw.now;
        raw.send("stream 0 0 a");
        raw.advance(after);
        raw.connection().allow_silence(Duration::ZERO);
        while raw.peer.closed.is_none() {
            raw.forget();
            raw.wait();
        }
        assert!(end.contains(&(raw.now - start).as_millis()));
    }
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
        (raw.connection()).allow_silence(Duration::from_secs(allowed));
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
        raw.connection().allow_silence(Duration::ZERO);
        raw.peer.send(0, b"a", true);
        raw.advance(RTT);
        raw.send("ack");
        raw.send(last);
        raw.advance(20_000);
        assert_eq!(raw.frames(), "fin 0 0 a");
    }
}

#[test]
fn silence_cannot_be_allowed_after_the_end() {
    let mut raw = Raw::client().connected();
    raw.peer.polls = false;
    raw.send("stream 0 0 a, close 0 0 -");
    let now = raw.now;
    raw.connection().allow_silence(Duration::ZERO);
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
    let [early, late] = [449, 450].map(|it| raw.now + Duration::from_millis(it));
    raw.advance(10);
    raw.request_packets("b");
    raw.send("ping");
    assert!(!raw.connection().is_stale(early));
    assert!(raw.connection().is_stale(late));
    raw.send("ack");
    assert!(!raw.connection().is_stale(late));

    let mut raw = Raw::server().quiet().kept_sending();
    for is_stale in [false, false, false, true] {
        raw.wait_for_ping();
        let now = raw.now;
        assert_eq!(raw.connection().is_stale(now), is_stale);
    }
    raw.send("ping");
    let now = raw.now;
    assert!(!raw.connection().is_stale(now));
}

#[test]
fn tells_when_the_peer_answers_again() {
    let mut raw = Raw::server().connected();
    raw.request_packets("a");
    raw.advance(450);
    raw.forget();
    raw.connection().ask_for_answer();
    raw.process();
    assert_eq!(raw.frames(), "ping");
    raw.send("ping");
    assert_eq!(raw.events(), "");
    raw.send("ack");
    assert_eq!(raw.events(), "available Bidirectional");
    raw.send("ping");
    assert_eq!(raw.events(), "");

    for (idle, after) in [(1600, 1590), (100, 440)] {
        let raw = Raw::server().config(|it| {
            (it.parameters.max_idle_timeout_millis, it.gives_up_early) = (idle, true);
        });
        let mut raw = raw.connected();
        raw.send("ack");
        raw.advance(after);
        raw.forget();
        let last = *raw.received[2].last().unwrap();
        raw.connection().ask_for_answer();
        assert_eq!(raw.take()[0].number, last + 2);
        raw.advance(10);
        let now = raw.now;
        assert!(raw.connection().is_stale(now));
        assert_eq!(raw.events(), "");
        raw.send("ack");
        assert_eq!(raw.events(), "available Bidirectional");
    }
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
