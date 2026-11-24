use bun_quic::Direction::{Bidirectional, Unidirectional};
use bun_quic::Side::Client;
use bun_quic::{Algorithm, Duration, KeepAlive, Layer, StreamId};

use crate::harness::messages::{GET, OK};
use crate::harness::paths::{NEW, new_id};
use crate::harness::raw::Kind::{Handshake, Initial, Short};
use crate::harness::raw::{APART, RTT, Raw};
use crate::harness::wire::filler;

const INITIAL_WINDOW: u64 = 32 * 1460;

impl Raw {
    /// With a given round trip time, of which a server has three samples.
    fn connected_over(mut self, rtt: u64) -> Self {
        self.start(&[]);
        self.advance(rtt);
        self.send_all(&[(Initial, "ack"), (Handshake, "ack, flight")]);
        self.advance(rtt);
        self.send("ack");
        self.forget();
        self
    }
}

/// RFC 9002 §6.1.1.
#[test]
fn packet_threshold() {
    let mut raw = Raw::client().connected();
    raw.request_packets("abcde");
    raw.advance(RTT);
    for (ack, frames) in [
        ("ack 3", ""),
        ("ack 3-4", "stream 3 0 a"),
        ("ack 3-4", ""),
        ("ack 3-5", "stream 3 1 b"),
        ("ack 6-7", ""),
    ] {
        raw.send(ack);
        assert_eq!(raw.frames(), frames);
    }
    let stats = raw.connection().stats();
    assert_eq!((stats.packets_lost, stats.packets_retransmitted), (2, 2));

    let mut raw = Raw::client().connected();
    raw.request_packets("abcdef");
    raw.advance(RTT);
    raw.send("ack 6 2");
    assert_eq!(raw.frames(), "stream 3 0 a, stream 3 2 c");
}

#[test]
fn packet_threshold_leaves_out_numbers_that_were_skipped() {
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.peer.crypto.planned.borrow_mut().push(vec![0, 0, 0, 2]);
    raw.shake_hands();
    raw.confirm();
    raw.request_packets("abcd");
    assert!(raw.received[2].iter().eq(&[0, 1, 2, 4, 5]));
    raw.advance(RTT);
    for (ack, frames) in [("ack 4", ""), ("ack 4-5", "stream 3 0 a")] {
        raw.send(ack);
        assert_eq!(raw.frames(), frames);
    }
}

/// RFC 9002 §6.1.2.
#[test]
fn time_threshold() {
    for (rtt, acked_after, lost_after) in [
        (20, 20, 22_500),
        (20, 36, 40_500),
        (40, 8, 40_500),
        (0, 0, 1000),
    ] {
        let mut raw = Raw::client().connected_over(rtt);
        let start = raw.now;
        raw.request_packets("ab");
        raw.advance(acked_after);
        raw.send("ack 2");
        raw.wait();
        assert_eq!(raw.now - start, Duration::from_micros(lost_after));
        assert_eq!(raw.frames(), "stream 3 0 a");
    }
}

#[test]
fn time_threshold_while_nothing_can_be_sent() {
    let mut raw = Raw::client().connected();
    raw.advance(1000);
    let lost_at = raw.now + Duration::from_micros(22_500);
    raw.request_packets("ab");
    raw.advance(RTT);
    raw.waits = false;
    raw.send("ack 2");
    raw.peer.poll(raw.now);
    assert_eq!(raw.peer.endpoint.timeout(), Some(lost_at));
}

#[test]
fn time_threshold_without_a_round_trip_time() {
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.send_in(Handshake, "flight");
    raw.request_packets("a");
    raw.send("ping");
    raw.send("ping");
    raw.forget();
    raw.send("ack 2");
    raw.send("ack 1-2");
    assert_eq!(raw.wait(), 56);
    assert_eq!(
        raw.outline(),
        "1[handshake_done, new_token, crypto, new_connection_id]"
    );
}

#[test]
fn packets_are_lost_one_after_the_other() {
    let mut raw = Raw::client().connected();
    raw.request_packets("a");
    raw.advance(1);
    raw.request_packets("bc");
    raw.advance(RTT);
    raw.send("ack 3");
    for (after, frames) in [(1, "stream 3 0 a"), (1, "stream 7 0 b")] {
        assert_eq!((raw.wait(), raw.frames()), (after, frames.into()));
    }
}

#[test]
fn reordering_raises_the_packet_threshold() {
    let mut raw = Raw::client().connected();
    raw.request_packets("abcdef");
    raw.advance(RTT);
    raw.send("ack 3-6");
    assert_eq!(raw.frames(), "stream 3 0 ab");
    raw.send("ack 2-7");
    raw.request_packets("ghijklm");
    raw.advance(RTT);
    for (ack, frames) in [("ack 9-12 2-7", ""), ("ack 9-13 2-7", "stream 7 0 g")] {
        raw.send(ack);
        assert_eq!(raw.frames(), frames);
    }
}

#[test]
fn packet_threshold_goes_by_the_oldest_of_the_late_packets() {
    let mut raw = Raw::client().connected();
    raw.request_packets("abcdef");
    raw.advance(RTT);
    raw.send("ack 3-6");
    raw.send("ack 1-7");
    raw.request_packets("ghijklm");
    raw.advance(RTT);
    for (ack, frames) in [("ack 9-13", ""), ("ack 9-14", "stream 7 0 g")] {
        raw.send(ack);
        assert_eq!(raw.frames(), frames);
    }
}

#[test]
fn packets_out_of_order_count_for_the_window() {
    for (algorithm, missing) in [(Algorithm::Cubic, 1), (Algorithm::Bbr, 20)] {
        let mut raw = (Raw::client().config(|it| it.congestion = algorithm)).connected();
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &filler(0, 200_000), false);
        raw.advance(RTT);
        let last = raw.take().pop().unwrap().number;
        raw.waits = false;
        let acks = [
            format!("ack {last} 0-{}", last - missing - 1),
            format!("ack 0-{last}"),
        ];
        let [before, after] = acks.map(|it| {
            raw.send(&it);
            raw.connection().stats().congestion_window
        });
        assert!(before < after, "{before} {after}");
    }
}

#[test]
fn small_writes_in_quick_succession_are_gathered() {
    for algorithm in [Algorithm::Bbr, Algorithm::Cubic] {
        let mut raw = (Raw::client().config(|it| it.congestion = algorithm)).connected();
        let id = raw.peer.open(Unidirectional);
        for (micros, range) in [(0, 11..25), (100, 11..40), (251, 40..41)] {
            let before = raw.received[2].len();
            for _ in 0..40 {
                raw.now = raw.now + Duration::from_micros(micros);
                raw.peer.send(id, &[0; 100], false);
                raw.process();
            }
            raw.advance(RTT);
            let packets = raw.received[2].len() - before;
            assert!(range.contains(&packets), "{micros} {packets}");
            raw.send("ack");
        }
        assert_eq!(raw.streams[&id].len(), 12_000);
    }
}

/// Puts many small packets in flight, and acknowledges an older one after `rtt`.
fn crowd(raw: &mut Raw, id: u64, rtt: u64) {
    raw.peer.send(id, b"a", false);
    raw.process();
    let ack = raw.ack(Short);
    raw.now = raw.now + Duration::from_millis(rtt) - APART * 20;
    for _ in 0..20 {
        raw.now = raw.now + APART;
        raw.peer.send(id, b"a", false);
        raw.process();
    }
    raw.send(&ack);
    raw.now = raw.now + APART;
    raw.forget();
}

#[test]
fn small_writes_are_gathered_if_many_seem_to_be_in_a_queue() {
    for algorithm in [Algorithm::Bbr, Algorithm::Cubic] {
        for (rtt, packets) in [(RTT, 20), (3 * RTT, 13)] {
            let mut raw = (Raw::client().config(|it| it.congestion = algorithm)).connected();
            let id = raw.peer.open(Unidirectional);
            crowd(&mut raw, id, rtt);
            for _ in 0..20 {
                raw.peer.send(id, b"a", false);
                raw.advance(1);
            }
            raw.advance(2);
            assert_eq!((raw.take().len(), raw.streams[&id].len()), (packets, 41));
        }
    }
}

#[test]
fn only_a_little_new_data_waits_for_more() {
    let events: [(fn(&mut Raw), &str); 20] = [
        (|_| {}, ""),
        (|raw| raw.send("ping"), ""),
        (|raw| raw.send_as(99, "ping"), "stream 7 0 b"),
        (|raw| raw.peer.send(7, &[0; 582], false), ""),
        (|raw| raw.peer.send(7, &[0; 583], false), "stream 7 0 ~584"),
        (
            |raw| raw.peer.send(7, &[0; 1499], false),
            "stream 7 0 ~1171, stream 7 1171 ~329",
        ),
        (|raw| raw.send("ack 5-6"), "stream 3 1 a, stream 7 0 b"),
        (|raw| raw.peer.send(7, &[], true), ""),
        (|raw| assert!(raw.connection().is_gathering()), ""),
        (|raw| raw.connection().stop_gathering(), "stream 7 0 b"),
        (
            |raw| {
                let now = raw.now;
                raw.connection().abort(now, Layer::Application, 1, &[]);
            },
            "stream 7 0 b, application_close 0x1",
        ),
        (|raw| raw.send("handshake_done"), "close 0xa"),
        (
            |raw| {
                raw.advance(20);
                assert!(!raw.connection().is_gathering());
            },
            "stream 7 0 b",
        ),
        (
            |raw| {
                let now = raw.now;
                raw.connection().close(now);
            },
            "stream 7 0 b",
        ),
        (|raw| raw.connection().send_datagram(0, vec![0; 566]), ""),
        (
            |raw| raw.connection().send_datagram(0, vec![0; 567]),
            "datagram ~567, stream 7 0 b",
        ),
        (
            |raw| raw.send("stop_sending 3 0"),
            "reset_stream 3 0x0 21, stream 7 0 b",
        ),
        (
            |raw| raw.send("fin 2 0 -"),
            "max_streams_uni 4, stream 7 0 b",
        ),
        (
            |raw| raw.send("retire_connection_id 1"),
            "new_connection_id 2 0, stream 7 0 b",
        ),
        (
            |raw| raw.send(&new_id(1, 1)),
            "retire_connection_id 0, stream 7 0 b",
        ),
    ];
    for (event, frames) in events {
        let mut raw = (Raw::client().with("max_datagram_frame_size=1000")).connected();
        let [busy, id] = [(); 2].map(|()| raw.peer.open(Unidirectional));
        crowd(&mut raw, busy, 3 * RTT);
        raw.peer.send(id, b"b", false);
        raw.process();
        event(&mut raw);
        raw.process();
        assert_eq!(raw.frames(), frames);
    }
}

#[test]
fn small_writes_to_a_busy_stream_are_gathered_after_a_loss() {
    let cases: [(_, &[_], _); 6] = [
        ("ack 5-6", &[(3, "b", false)], ""),
        ("ack 5-6", &[(3, "bb", false)], "stream 3 31 bb"),
        ("ack 5-6", &[(3, "b", true)], "fin 3 31 b"),
        ("ack 5-6", &[(7, "b", false)], "stream 7 0 b"),
        (
            "ack 5-6",
            &[(3, "b", false), (7, "c", false)],
            "stream 3 31 b, stream 7 0 c",
        ),
        ("ping", &[(3, "b", false)], "stream 3 31 b"),
    ];
    for (ack, writes, frames) in cases {
        let mut raw = Raw::client().connected();
        let [busy, _] = [(); 2].map(|()| raw.peer.open(Unidirectional));
        crowd(&mut raw, busy, RTT);
        raw.peer.send(busy, &[0; 10], false);
        raw.process();
        raw.send(ack);
        raw.forget();
        for &(id, data, fin) in writes {
            raw.peer.send(id, data.as_bytes(), fin);
        }
        raw.process();
        assert_eq!(raw.frames(), frames);
    }
}

#[test]
fn what_waits_for_more_is_joined_by_what_is_written_on_request() {
    for steps in [
        [
            (1, "7 writable", 0),
            (1, "7 writable", 0),
            (2000, "7 writable", 2),
        ],
        [(1, "7 writable", 0), (0, "7 writable", 0), (0, "", 0)],
    ] {
        let mut raw = Raw::client().connected();
        let [busy, id] = [(); 2].map(|()| raw.peer.open(Unidirectional));
        crowd(&mut raw, busy, 3 * RTT);
        for (len, events, packets) in steps {
            let stream = raw.peer.streams.entry(id).or_default();
            stream.unsent.extend(vec![0; len]);
            raw.connection().want_write(StreamId(id));
            assert_eq!((raw.take().len(), &*raw.events()), (packets, events));
        }
    }
}

#[test]
fn acknowledgments_of_sections_wait_for_more_too() {
    for (pings, delay) in [(0, RTT), (1, 0)] {
        let mut raw = Raw::http3(Client).connected_with("");
        raw.write_encoder("#3fe11f, #41610162");
        raw.write_http3(0, &format!("headers {GET}"), true);
        assert!(raw.peer.send_headers(0, OK));
        crowd(&mut raw, 0, 3 * RTT);
        raw.send("fin 4 0 #01090200d1d7500161c180");
        raw.peer.send(0, b"b", false);
        assert!(raw.take().is_empty());
        (0..pings).for_each(|_| raw.send_as(99, "ping"));
        raw.advance(delay);
        assert!(raw.frames().starts_with("stream 7 2 #84, stream 0 "));
    }
}

#[test]
fn datagrams_that_are_gone_do_not_count() {
    let mut raw = (Raw::client().with("max_datagram_frame_size=1000")).connected();
    raw.connection().send_datagram(0, vec![0; 600]);
    raw.connection().send_datagram(1, vec![0; 600]);
    assert_eq!(raw.connection().drop_oldest_datagram(), Some(0));
    let id = raw.peer.open(Unidirectional);
    crowd(&mut raw, id, 3 * RTT);
    raw.peer.send(id, b"b", false);
    raw.process();
    assert!(raw.connection().is_gathering());
}

#[test]
fn datagrams_are_not_gathered_after_a_loss() {
    let mut raw = (Raw::client().with("max_datagram_frame_size=100")).connected();
    let id = raw.peer.open(Unidirectional);
    crowd(&mut raw, id, RTT);
    raw.send("ack 5-6");
    raw.forget();
    raw.connection().send_datagram(0, vec![b'c']);
    raw.process();
    assert_eq!(raw.frames(), "datagram c");
}

#[test]
fn control_streams_do_not_wait_for_more() {
    let mut raw = Raw::http3(Client).connected_with("");
    raw.write_http3(0, &format!("headers {GET}"), true);
    assert!(raw.peer.send_headers(0, OK));
    crowd(&mut raw, 0, 3 * RTT);
    raw.peer.send(0, b"b", false);
    raw.process();
    assert!(raw.take().is_empty());
    raw.connection().go_away();
    raw.process();
    assert_eq!(raw.take().len(), 1);
}

#[test]
fn packet_threshold_has_no_limit() {
    let mut raw = Raw::client().connected();
    for _ in 0..8 {
        raw.request_many_packets(20);
        raw.now = raw.now + Duration::from_secs(1);
        raw.send("ack");
    }
    for (len, frames) in [(400, "stream 35 0 a"), (300, "")] {
        let late = raw.received[2].last().unwrap() + 1;
        raw.request_many_packets(len);
        raw.now = raw.now + Duration::from_secs(1);
        assert!(raw.received[2].contains(&(late + len as u64 - 1)));
        raw.received[2].remove(&late);
        raw.send("ack");
        assert_eq!(raw.frames(), frames);
        raw.received[2].insert(late);
        raw.send("ack");
    }
}

#[test]
fn thresholds_start_over_if_packets_are_only_lost() {
    for (losses, is_overtaken, data, is_lost) in [
        (15, false, "abcd", [false, false]),
        (16, false, "abcd", [true, false]),
        (16, false, "ab", [false, true]),
        (16, true, "abcd", [false, false]),
    ] {
        let mut raw = Raw::client().with("max_streams_uni=99").connected();
        let mut miss_first = |data: &str, arrives: bool| {
            let first = raw.received[2].last().unwrap() + 1;
            raw.request_packets(data);
            raw.advance(RTT);
            raw.received[2].remove(&first);
            raw.send("ack");
            let at_once = raw.frames();
            raw.advance(RTT);
            let later = raw.frames();
            if arrives {
                raw.received[2].insert(first);
            }
            raw.send("ack");
            raw.forget();
            [!at_once.is_empty(), !later.is_empty()]
        };
        assert_eq!(miss_first("abcde", true), [true, false]);
        for number in 0..losses {
            assert_eq!(miss_first("abcdefg", false), [true, false]);
            if is_overtaken && number == 8 {
                assert_eq!(miss_first("ab", true), [false, false]);
            }
        }
        assert_eq!(miss_first(data, true), is_lost, "{losses} {is_overtaken}");
    }
}

/// RFC 9000 §13.3.
#[test]
fn what_is_lost_is_sent_again() {
    type Cause = fn(&mut Raw);
    let cases: [(&str, Cause); 14] = [
        ("stream 1 0 a", |it| it.peer.send(1, b"a", false)),
        ("fin 1 0 a", |it| it.peer.send(1, b"a", true)),
        ("fin 1 0 -", |it| it.peer.send(1, b"", true)),
        ("reset_stream 1 0x7 0", |it| {
            it.connection().reset(StreamId(1), 7);
        }),
        ("stop_sending 1 0x7", |it| {
            it.connection().stop(StreamId(1), 7);
        }),
        ("max_stream_data 0 200", |it| it.send("stream 0 0 *100")),
        ("max_data 2000", |it| it.send("stream 2 0 *1000")),
        ("max_streams_uni 2", |it| it.send("fin 2 0 -")),
        ("max_streams_bidi 2", |it| {
            it.send("stream 0 0 -");
            it.peer.send(0, b"", true);
            it.forget();
            it.send("ack, fin 0 0 -");
        }),
        ("stream_data_blocked 1 3, stream 1 0 abc", |it| {
            it.peer.send(1, b"abcd", false);
        }),
        ("data_blocked 5, stream 7 0 abcde", |it| {
            let id = it.peer.open(Unidirectional);
            it.peer.send(id, b"abcdef", false);
        }),
        ("new_connection_id 2 0", |it| {
            it.send("retire_connection_id 1");
        }),
        ("retire_connection_id 0", |it| {
            it.send("new_connection_id 1 1 raw-id-1 *16");
        }),
        ("reset_stream 1 0x9 0", |it| it.send("stop_sending 1 9")),
    ];
    for (frames, cause) in cases {
        for is_probed in [true, false] {
            let raw = Raw::client().config(|it| {
                it.parameters.initial_max_data = 1000;
                it.parameters.initial_max_stream_data_bidi_remote = 100;
                it.parameters.initial_max_streams_bidi = 1;
                it.parameters.initial_max_streams_uni = 1;
            });
            let parameters = "max_data=5 max_stream_data_bidi_remote=3 max_datagram_frame_size=9";
            let mut raw = raw.with(parameters).connected();
            raw.peer.open(Bidirectional);
            raw.peer.open(Unidirectional);
            cause(&mut raw);
            assert_eq!(raw.lose(), frames);
            if !is_probed {
                raw.connection().send_datagram(0, Vec::new());
                raw.advance(RTT);
                raw.send("ack");
            }
            raw.forget();
            raw.wait();
            let then = if is_probed { ", ping" } else { "" };
            assert_eq!(raw.frames(), format!("{frames}{then}"));
            raw.advance(RTT);
            raw.send("ack");
            raw.advance(1000);
            assert_eq!(raw.frames(), "");
        }
    }
}

/// RFC 9000 §13.3.
#[test]
fn what_is_out_of_date_is_not_sent_again() {
    type Step = fn(&mut Raw);
    let cases: [(Step, &str, &str); 7] = [
        (|it| it.advance(1000), "ping", "ping"),
        (|it| it.send("stream 0 0 *100"), "fin 0 100 -", "ping"),
        (
            |it| it.connection().stop(StreamId(1), 7),
            "reset_stream 1 7 0",
            "ping",
        ),
        (
            |it| it.peer.send(1, b"abcdef", false),
            "max_data 6",
            "stream 1 0 abcde",
        ),
        (
            |it| it.peer.send(3, b"abcd", false),
            "max_stream_data 3 4",
            "stream 3 0 abc",
        ),
        (
            |it| it.send("retire_connection_id 1"),
            "retire_connection_id 2",
            "new_connection_id 3 0",
        ),
        (
            |it| it.peer.send(1, b"a", false),
            "stop_sending 1 7",
            "reset_stream 1 0x7 1",
        ),
    ];
    for (cause, news, first) in cases {
        let raw = Raw::client().config(|it| {
            it.parameters.initial_max_stream_data_bidi_remote = 100;
            it.keep_alive = KeepAlive::Every(Duration::from_millis(1000));
        });
        let mut raw = raw.with("max_data=5 max_stream_data_uni=3").connected();
        raw.peer.open(Bidirectional);
        raw.peer.open(Unidirectional);
        raw.peer.polls = false;
        cause(&mut raw);
        while raw.peer.poll(raw.now) {}
        assert_ne!(raw.lose(), "");
        raw.send(news);
        raw.advance(10);
        raw.forget();
        raw.wait();
        let packets = raw.take().into_iter().map(|it| it.frames[1..].join(", "));
        assert_eq!(packets.collect::<Vec<_>>(), [first, "ping"], "{news}");
    }
}

/// RFC 9002 §6.2.
#[test]
fn probe_timeout_backs_off() {
    for (rtt, max_ack_delay, first, second) in [
        (20, 25, 55_000, 80_000),
        (20, 0, 40_000, 80_000),
        (20, 1000, 1_030_000, 80_000),
        (0, 0, 10_000, 20_000),
    ] {
        let raw = Raw::client().config(|it| {
            it.parameters.max_idle_timeout_millis = 0;
            it.progress_timeout = Duration::ZERO;
        });
        let mut raw = (raw.with(&format!("max_ack_delay={max_ack_delay}"))).connected_over(rtt);
        raw.request_packets("a");
        for count in 0..70 {
            let start = raw.now;
            raw.wait();
            let expected = match count {
                0 => first,
                _ => (second << (count - 1).min(20)).min(60_000_000),
            };
            assert_eq!(raw.now - start, Duration::from_micros(expected));
            assert_eq!(raw.frames(), "stream 3 0 a, ping");
        }
    }
}

#[test]
fn probe_timeout_backs_off_up_to_an_eighth_of_the_idle_timeout() {
    for (idle, expected) in [
        (4000, [55, 80, 160, 320, 500, 500]),
        (500, [55, 80, 80, 80, 80, 80]),
    ] {
        let raw = Raw::client().config(|it| it.parameters.max_idle_timeout_millis = idle);
        let mut raw = raw.connected();
        raw.request_packets("a");
        assert_eq!(expected.map(|_| (raw.wait(), raw.forget()).0), expected);
    }
}

#[test]
fn probe_timeout_backs_off_while_nothing_can_be_sent() {
    let mut raw = Raw::client().connected();
    raw.advance(1000);
    raw.request_packets("a");
    let mut now = raw.now + Duration::from_millis(100);
    for timeout in [135, 270].map(Duration::from_millis) {
        raw.peer.endpoint.handle_timeouts(now, || now);
        now = now + timeout;
        assert_eq!(raw.peer.endpoint.timeout(), Some(now));
    }
}

#[test]
fn acknowledgment_ends_the_backoff() {
    let mut raw = Raw::client().connected();
    raw.request_packets("a");
    for timeout in [55, 80] {
        assert_eq!(raw.wait(), timeout);
        raw.forget();
    }
    raw.advance(RTT);
    raw.send("ack");
    raw.request_packets("b");
    assert_eq!(raw.wait(), 55);
}

#[test]
fn acknowledgment_of_acknowledgments_does_not_end_the_backoff() {
    let mut raw = Raw::client().connected();
    raw.request_packets("a");
    assert_eq!(raw.wait(), 55);
    raw.send("ping");
    raw.send("ping");
    let last = raw.take().pop().unwrap();
    assert_eq!(last.frames, ["ack 0-2"]);
    raw.send(&format!("ack {}", last.number));
    let lost = raw.connection().stats().packets_lost;
    raw.request_packets("b");
    raw.advance(30);
    raw.forget();
    assert_eq!((lost, raw.wait()), (1, 22 + 80 - 30));
}

#[test]
fn peer_that_is_heard_again_is_probed_once_between_two_timeouts() {
    let mut raw = Raw::client().connected();
    raw.request_packets("a");
    for is_probed in [false, true, true] {
        raw.wait();
        raw.forget();
        raw.send("padding 3");
        let expected = if is_probed { "stream 3 0 a, ping" } else { "" };
        assert_eq!(raw.frames(), expected);
        raw.send("padding 3");
        assert_eq!(raw.frames(), "");
    }
}

#[test]
fn acknowledgment_without_news_does_not_postpone_the_probe() {
    let mut raw = Raw::client().connected();
    raw.request_packets("a");
    raw.advance(50);
    raw.send("ack 0");
    assert_eq!(raw.wait(), 5);
}

#[test]
fn probes_repeat_the_oldest_packets() {
    let mut raw = Raw::client().connected();
    (["a", "b", "c"].into_iter()).for_each(|it| raw.request_packets(it));
    raw.wait();
    assert_eq!(
        raw.packets(),
        "1[ack 0 +7500, stream 3 0 a, stream 7 0 b]; 1[ack 0 +7500, ping]"
    );
    raw.wait();
    assert_eq!(
        raw.packets(),
        "1[ack 0 +17500, stream 11 0 c, stream 3 0 a, stream 7 0 b]; 1[ack 0 +17500, ping]"
    );
    let stats = raw.connection().stats();
    assert_eq!((stats.packets_lost, stats.packets_retransmitted), (0, 4));
}

#[test]
fn probes_of_a_server_get_round_to_what_the_window_holds_back() {
    let of_server = ["stream 3 0 *1165", "stream 3 37376 *1150"];
    let of_client = ["stream 2 0 *1165", "stream 2 1165 *1163"];
    for (raw, expected) in Raw::both().into_iter().zip([of_server, of_client]) {
        let raw = raw.config(|it| it.congestion = Algorithm::Cubic);
        let mut raw = raw.connected();
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &filler(0, 44_000), true);
        raw.advance(RTT);
        let last = raw.take().last().unwrap().number;
        raw.send(&format!("ack {last}-{last}"));
        raw.advance(RTT);
        raw.forget();
        raw.wait();
        let packets = raw.take();
        let last_frames = packets.iter().filter_map(|it| it.frames.last());
        assert_eq!(last_frames.collect::<Vec<_>>(), expected);
    }
}

#[test]
fn what_a_probe_has_repeated_is_not_repeated_when_it_is_lost() {
    let mut raw = Raw::client().connected();
    raw.request_packets("a");
    raw.wait();
    raw.forget();
    raw.advance(RTT);
    raw.send("ack 2-3");
    raw.advance(1000);
    assert_eq!(raw.frames(), "");
    let stats = raw.connection().stats();
    assert_eq!((stats.packets_lost, stats.packets_retransmitted), (1, 1));
}

#[test]
fn several_packets_are_probed_sooner() {
    for (rtt, max_ack_delay, timeouts) in [
        (20, 25, [40_000, 80_000, 160_000]),
        (4, 25, [10_000, 20_000, 40_000]),
        (100, 0, [200_000, 400_000, 800_000]),
    ] {
        let raw = Raw::client().with(&format!("max_ack_delay={max_ack_delay}"));
        let mut raw = raw.connected_over(rtt);
        raw.request_packets("ab");
        for timeout in timeouts {
            let start = raw.now;
            raw.wait();
            raw.forget();
            assert_eq!(raw.now - start, Duration::from_micros(timeout));
        }
    }
}

#[test]
fn single_packet_is_probed_sooner_if_the_peer_keeps_being_quick() {
    for (delays, timeout) in [
        (&[625, 624, 624, 624][..], 52),
        (&[625, 624, 624, 624, 624], 40),
        (&[0, 0, 0, 0, 625], 50),
    ] {
        let mut raw = Raw::client().connected_over(20);
        for delay in delays {
            raw.request_packets("a");
            raw.advance(20);
            raw.send(&format!("{} +{delay}", raw.ack(Short)));
        }
        raw.request_packets("a");
        assert_eq!(raw.wait(), timeout);
    }
}

#[test]
fn single_packet_is_probed_sooner_however_long_the_peer_has_been_quick() {
    let mut raw = Raw::client().connected_over(20);
    let id = raw.peer.open(Unidirectional);
    for _ in 0..256 {
        raw.peer.send(id, b"a", false);
        raw.advance(20);
        raw.send("ack");
    }
    raw.request_packets("b");
    assert_eq!(raw.wait(), 40);
}

#[test]
fn single_packet_is_given_time_again_after_a_needless_probe() {
    for (is_lost, timeout) in [(true, 40), (false, 50)] {
        let mut raw = Raw::client().connected_over(20);
        for _ in 0..4 {
            raw.request_packets("a");
            raw.advance(20);
            raw.send("ack");
        }
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, b"b", false);
        match is_lost {
            true => _ = raw.lose(),
            false => raw.forget(),
        }
        assert_eq!(raw.wait(), 40);
        raw.advance(20);
        raw.send("ack");
        raw.request_packets("c");
        assert_eq!(raw.wait(), timeout);
    }
}

/// RFC 9002 §6.2.2 and §6.4.
#[test]
fn probe_timeout_without_a_round_trip_time() {
    for delay in [0, 200] {
        let mut raw = Raw::client();
        raw.start(&[]);
        raw.advance(delay);
        raw.send_in(Handshake, "flight");
        raw.request_packets("a");
        assert_eq!(raw.wait(), 175);
    }
}

#[test]
fn what_is_acknowledged_before_the_probe_is_sent_is_left_out() {
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.shake_hands();
    raw.request_packets("a");
    raw.now = raw.now + Duration::from_millis(100);
    raw.peer.endpoint.handle_timeouts(raw.now, || raw.now);
    raw.send("ack");
    assert_eq!(
        raw.outline(),
        "1[handshake_done, new_token, new_connection_id]"
    );
}

/// RFC 9002 §5.
#[test]
fn round_trip_time() {
    for (exponent, after, ack, smoothed, variation, min) in [
        (3, 36, "ack 1", 22_000, 8218, 20),
        (3, 36, "ack 1 +1000", 21_000, 6218, 20),
        (0, 36, "ack 1 +8000", 21_000, 6218, 20),
        (10, 36, "ack 1 +8", 20_976, 6170, 20),
        (3, 12, "ack 1", 19_000, 6218, 12),
        (3, 36, "ack 0", 20_000, 5625, 20),
    ] {
        let raw = Raw::client().with(&format!("ack_delay_exponent={exponent}"));
        let mut raw = raw.connected();
        raw.request_packets("a");
        raw.advance(after);
        raw.send(ack);
        let stats = raw.connection().stats();
        assert_eq!(stats.smoothed_rtt, Duration::from_micros(smoothed), "{ack}");
        assert_eq!(stats.rtt_variation, Duration::from_micros(variation));
        assert_eq!(stats.min_rtt, Duration::from_millis(min));
    }
}

#[test]
fn delay_of_a_repeated_acknowledgment_counts_up_to_a_probe_timeout() {
    for (lost, delay, smoothed) in [
        ([0, 0, 1], 122_500, 22_812),
        ([0, 1, 0], 122_500, 22_812),
        ([1, 0, 0], 122_500, 139_375),
        ([0, 0, 1], 50_000, 92_500),
        ([0, 0, 1], 128_124, 22_812),
        ([0, 0, 1], 128_125, 139_375),
    ] {
        let mut raw = Raw::client().connected();
        raw.next[2] += lost[0];
        raw.send("padding 1");
        raw.request_packets("a");
        raw.advance(500);
        raw.next[2] += lost[1];
        raw.send("padding 1");
        raw.advance(500);
        raw.next[2] += lost[2];
        raw.send(&format!("ack 1 +{delay}"));
        assert_eq!(raw.connection().stats().smoothed_rtt.as_micros(), smoothed);
    }

    let mut raw = Raw::client().connected();
    raw.move_to(NEW);
    raw.send_expanded("ping");
    raw.send("respond");
    let number = raw.received[2].last().unwrap() + 1;
    raw.request_packets("a");
    raw.advance(1000);
    raw.next[2] += 1;
    raw.send(&format!("ack {number} +122500"));
    let stats = raw.connection().stats();
    assert_eq!(stats.smoothed_rtt.as_millis(), 175);
    assert_eq!(stats.min_rtt.as_millis(), 1000);
}

/// RFC 9002 §5.1.
#[test]
fn only_the_largest_packet_gives_a_sample() {
    for (acks, min) in [
        (["ack 1-2", "ack 1-3"], 20),
        (["ack 2", "ack 1-2"], 20),
        (["ack 1", "ack 1-3"], 12),
        (["ack 3", "ack 1-3"], 20),
    ] {
        let mut raw = Raw::client().connected();
        raw.request_packets("ab");
        raw.advance(10);
        raw.send("ping");
        raw.send("ping");
        raw.advance(10);
        raw.send(acks[0]);
        raw.advance(2);
        raw.send(acks[1]);
        let stats = raw.connection().stats();
        assert_eq!(stats.min_rtt, Duration::from_millis(min), "{acks:?}");
    }
}

/// RFC 9002 §7.6.
#[test]
fn persistent_congestion() {
    for (algorithm, timeouts, ack, window) in [
        (Algorithm::Cubic, 1, "ack 3", INITIAL_WINDOW * 4 / 5),
        (Algorithm::Cubic, 2, "ack 5", INITIAL_WINDOW * 4 / 5),
        (Algorithm::Cubic, 3, "ack 7", INITIAL_WINDOW * 4 / 5),
        (Algorithm::Cubic, 4, "ack 9", 2 * 1460),
        (Algorithm::Cubic, 4, "ack 9 5", INITIAL_WINDOW * 4 / 5),
        (Algorithm::Bbr, 4, "ack 9", 4 * 1460),
    ] {
        let mut raw = (Raw::client().config(|it| it.congestion = algorithm)).connected();
        raw.request_packets("a");
        for _ in 0..timeouts {
            raw.wait();
            raw.forget();
        }
        raw.advance(RTT);
        raw.send(ack);
        assert_eq!(raw.connection().stats().congestion_window, window, "{ack}");
    }
}

/// RFC 9002 §5.2 and §7.6.2.
#[test]
fn persistent_congestion_is_a_new_start() {
    for (timeouts, min) in [(3, 20), (4, 50)] {
        let mut raw = Raw::client().connected();
        raw.request_packets("a");
        for _ in 0..timeouts {
            raw.wait();
            raw.forget();
        }
        raw.advance(50);
        raw.send(&format!("ack {}", 1 + 2 * timeouts));
        assert_eq!(raw.connection().stats().min_rtt, Duration::from_millis(min));
    }
}

/// RFC 9002 §7.6.1.
#[test]
fn persistent_congestion_takes_three_probe_timeouts() {
    const PERIOD: u64 = 3 * (20_000 + 4 * 4218 + 25_000);
    for (span, window) in [(PERIOD, INITIAL_WINDOW * 4 / 5), (PERIOD + 1, 2 * 1460)] {
        let mut raw = (Raw::client().config(|it| it.congestion = Algorithm::Cubic)).connected();
        let start = raw.now;
        raw.request_packets("a");
        raw.advance(span / 1000);
        raw.now = start + Duration::from_micros(span);
        raw.request_packets("bcde");
        raw.advance(RTT);
        raw.send("ack 9");
        assert_eq!(raw.connection().stats().congestion_window, window);
    }
}

/// RFC 9002 §7.6.2.
#[test]
fn persistent_congestion_takes_a_round_trip_time() {
    let mut raw = Raw::client().config(|it| it.congestion = Algorithm::Cubic);
    raw.start(&[]);
    raw.send_in(Handshake, "flight");
    for _ in 0..3 {
        raw.forget();
        raw.wait();
    }
    raw.advance(RTT);
    raw.send("ack 6");
    let window = raw.connection().stats().congestion_window;
    assert_eq!(window, INITIAL_WINDOW * 4 / 5);
}

/// RFC 9002 §7, §7.5 and §7.7.
#[test]
fn window_and_pace() {
    let raw = Raw::client().config(|it| it.congestion = Algorithm::Cubic);
    let mut raw = raw.connected();
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, &filler(0, 200_000), false);
    assert_eq!(raw.sizes(), [1200; 14]);
    raw.advance(3);
    assert_eq!(raw.sizes(), [1200; 8]);
    raw.advance(7);
    let packets = raw.take();
    assert_eq!(14 + 8 + packets.len() as u64, INITIAL_WINDOW.div_ceil(1200));
    raw.send("ping");
    raw.send("ping");
    assert_eq!(raw.packets(), "1[ack 0-2]");
    raw.forget();
    raw.wait();
    let last = packets.last().unwrap().at;
    assert_eq!(raw.now - last, Duration::from_millis(40));
    assert_eq!(raw.frames(), "stream 3 0 *1165, stream 3 1165 *1163");
}

#[test]
fn acknowledgment_behind_the_end_of_the_handshake() {
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.shake_hands_with("flight, ack");
    assert_eq!(raw.events(), "ready, confirmed");
}

/// RFC 9000 §9.4.
#[test]
fn what_is_in_flight_is_sent_again_on_a_new_path() {
    let mut raw = Raw::client().connected();
    raw.request_packets("abcd");
    raw.advance(RTT);
    raw.send("ack 2");
    raw.move_to(NEW);
    raw.send_expanded("ping");
    raw.forget();
    raw.send("respond");
    assert_eq!(raw.frames(), "stream 3 0 a, stream 3 2 cd");
    assert!(raw.sleeps_for() > RTT);
    assert_eq!(raw.connection().stats().packets_lost, 0);
}

#[test]
fn nothing_is_in_flight_on_a_new_path() {
    let mut raw = Raw::client().with("max_datagram_frame_size=9").connected();
    raw.connection().send_datagram(1, Vec::new());
    raw.forget();
    raw.move_to(NEW);
    raw.send_expanded("ping");
    raw.forget();
    raw.send("respond");
    assert!(raw.peer.has_logged("datagram 1 lost"));
    raw.advance(1000);
    assert_eq!(raw.frames(), "");
}

#[test]
fn window_and_backoff_start_over_on_another_network() {
    let mut raw = Raw::client().connected();
    raw.request_packets("a");
    raw.advance(1000);
    raw.move_to(NEW);
    raw.send_expanded("ping");
    raw.send("respond");
    raw.forget();
    assert_eq!(raw.connection().stats().congestion_window, INITIAL_WINDOW);
    assert_eq!(raw.wait(), 175);
}

#[test]
fn packet_threshold_starts_over_on_another_network() {
    for (address, frames) in [("192.0.2.1:2000", ""), (NEW, "stream 7 0 g")] {
        let mut raw = Raw::client().connected();
        raw.request_packets("abcdef");
        raw.advance(RTT);
        raw.send("ack 3-6");
        raw.send("ack");
        raw.move_to(address);
        raw.send_expanded("ack, ping");
        raw.send("respond");
        raw.advance(RTT);
        raw.request_packets("ghij");
        raw.advance(RTT);
        raw.send(&format!("ack {}", raw.received[2].last().unwrap()));
        assert_eq!(raw.frames(), frames);
    }
}

#[test]
fn packets_that_are_late_on_the_old_path_do_not_raise_the_packet_threshold() {
    let mut raw = Raw::client().connected();
    raw.request_packets("abcdef");
    raw.advance(RTT);
    raw.send("ack 3-6");
    raw.move_to("192.0.2.1:2000");
    raw.send_expanded("ping");
    raw.send("respond");
    raw.advance(RTT);
    raw.send("ack");
    raw.request_packets("ghij");
    raw.advance(RTT);
    raw.send(&format!("ack {}", raw.received[2].last().unwrap()));
    assert_eq!(raw.frames(), "stream 7 0 g");
}
