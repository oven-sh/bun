use bun_quic::Direction::Unidirectional;
use bun_quic::Layer::Transport;
use bun_quic::transport_code::PROTOCOL_VIOLATION;

use crate::harness::raw::Kind::{Handshake, Initial};
use crate::harness::raw::{RTT, Raw};

/// RFC 9000 §13.2.1.
#[test]
fn every_second_packet_is_acknowledged_at_once() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        for ack in ["", "1[ack 0-2]", "", "1[ack 0-4]", ""] {
            raw.send("ping");
            assert_eq!(raw.packets(), ack);
        }
        assert_eq!(raw.wait(), 5);
        assert_eq!(raw.packets(), "1[ack 0-5 +625]");
        raw.advance(1000);
        assert_eq!(raw.packets(), "");
    }
}

#[test]
fn fewer_packets_are_acknowledged_at_once_the_more_there_are() {
    let mut raw = Raw::client().connected();
    for (packets, tolerance) in [
        (24, 2),
        (26, 2),
        (82, 3),
        (200, 9),
        (99, 10),
        (30, 10),
        (10, 3),
        (10, 2),
    ] {
        let mut acks = 0;
        for _ in 0..packets {
            raw.send("ping");
            acks += raw.take().len();
        }
        assert_eq!(acks, packets / tolerance, "{packets}");
        raw.advance(RTT + 1);
        raw.forget();
    }
}

#[test]
fn every_second_packet_is_acknowledged_for_a_while_after_data_was_lost() {
    for (offset, expected) in [(0, 0), (1, 128 * RTT / (RTT + 1) + 1)] {
        let mut raw = Raw::client().connected();
        let mut count_acks = |first: &str| {
            raw.send(first);
            raw.advance(RTT + 1);
            raw.forget();
            (0..40)
                .map(|_| (raw.send("ping"), raw.take().len()).1)
                .sum::<usize>()
        };
        count_acks("ping");
        count_acks("ping");
        let first = format!("stream 2 {offset} a");
        let frames = std::iter::once(first.as_str()).chain(std::iter::repeat("ping, ack"));
        let rounds = frames.take_while(|it| count_acks(it) >= 20).count();
        assert_eq!(rounds as u64, expected);
    }
}

#[test]
fn delay_is_a_quarter_of_a_round_trip_within_bounds() {
    for (rtt, delay) in [
        (1, 1000),
        (4, 1000),
        (8, 2000),
        (84, 21_000),
        (88, 21_875),
        (140, 21_875),
    ] {
        let mut raw = Raw::client();
        raw.start(&[]);
        raw.advance(rtt);
        raw.send_all(&[(Initial, "ack"), (Handshake, "ack, flight")]);
        raw.forget();
        raw.send("ping");
        assert_eq!(raw.wait(), delay / 1000);
        assert_eq!(raw.packets(), format!("1[ack 0 +{}]", delay / 8));
    }
}

#[test]
fn delay_without_a_round_trip_time() {
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.send_in(Handshake, "flight");
    raw.forget();
    raw.send("ping");
    assert_eq!(raw.wait(), 21);
    assert_eq!(raw.packets(), "1[ack 0 +2734]");
}

#[test]
fn packets_out_of_order_are_acknowledged_at_once() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        for (number, frames, ack) in [
            (2, "ping", "1[ack 2 0]"),
            (1, "ping", "1[ack 0-2]"),
            (5, "padding 1", ""),
            (6, "ping", "1[ack 5-6 0-2]"),
            (7, "padding 1", ""),
            (8, "ping", ""),
            (4, "padding 1", ""),
            (100, "ping", "1[ack 100 4-8 0-2]"),
            (20_000, "ping", "1[ack 20000 100 4-8 0-2]"),
        ] {
            raw.send_as(number, frames);
            assert_eq!(raw.packets(), ack, "{number}");
        }
    }
}

#[test]
fn late_packets_are_acknowledged_however_many_gaps_follow() {
    let even = |from: u64, count| {
        let numbers = (0..count).map(|it| format!(" {}", from - 2 * it));
        numbers.collect::<String>()
    };
    for (late, next, below) in [
        (1891, None, 9),
        (1889, None, 8),
        (101, None, 8),
        (101, Some(901), 8),
    ] {
        let mut raw = Raw::client().connected();
        for number in 1..=1000 {
            raw.send_as(2 * number, "ping");
        }
        raw.forget();
        raw.waits = false;
        raw.send_as(late, "ping");
        next.inspect(|&it| raw.send_as(it, "ping"));
        let (top, above) = (even(2000, 32), even(late + 63 - 2 * below, 31 - below));
        let (range, below) = (format!("{}-{}", late - 1, late + 1), even(late - 3, below));
        assert_eq!(raw.packets(), format!("1[ack{top}{above} {range}{below}]"));
        raw.send_as(2002, "ping");
        assert!(
            raw.packets()
                .starts_with(&format!("1[ack{}", even(2002, 50)))
        );
    }
}

#[test]
fn packets_that_do_not_ask_for_it_are_not_acknowledged() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        for frames in ["padding 5", "ack 0", "ack 0, padding 1"] {
            raw.send(frames);
        }
        raw.connection().acknowledge();
        raw.advance(1000);
        assert_eq!(raw.packets(), "");
    }
}

#[test]
fn acknowledgments_go_with_data() {
    let mut raw = Raw::client().connected();
    raw.send("ping");
    raw.advance(2);
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, b"a", false);
    assert_eq!(raw.packets(), "1[ack 0-1 +250, stream 3 0 a]");
    raw.peer.send(id, b"b", false);
    raw.advance(10);
    assert_eq!(raw.packets(), "1[stream 3 1 b]");
}

/// RFC 9000 §13.2.4.
#[test]
fn what_is_known_to_be_acknowledged_is_left_out() {
    let mut raw = Raw::client().connected();
    for (number, frames, ack) in [
        (2, "ping", "1[ack 2 0]"),
        (4, "ping", "1[ack 4 2 0]"),
        (6, "ping", "1[ack 6 4 2 0]"),
        (8, "ping, ack 1", "1[ack 8 6 4]"),
        (10, "ping, ack 3", "1[ack 10 8]"),
        (12, "ping, ack 0", "1[ack 12 10 8]"),
    ] {
        raw.send_as(number, frames);
        assert_eq!(raw.packets(), ack);
    }
}

/// RFC 9000 §13.2.3.
#[test]
fn packets_that_are_missing_for_long_are_not_waited_for() {
    for (start, first, pause, ack) in [
        (0, "ping, ack", RTT, "1[ack 1-4 +2500]"),
        (0, "ping, ack", 20 * RTT, ""),
        (20 * RTT, "ping", RTT, "1[ack 1-4 +2500]"),
    ] {
        let mut raw = Raw::client().connected();
        raw.advance(start);
        for (number, frames) in [(2, first), (3, "ping, ack"), (4, "ping, ack")] {
            raw.send_as(number, frames);
            raw.advance(pause);
            raw.forget();
        }
        raw.send_as(1, "ping");
        assert_eq!(raw.packets(), ack);
    }
}

/// RFC 9000 §13.1.
#[test]
fn acknowledgment_of_a_packet_that_was_not_sent() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        let next = raw.received[2].last().unwrap() + 1;
        raw.send(&format!("ack {}", next - 1));
        assert_eq!(raw.error(), None);
        raw.send(&format!("ack {next}"));
        assert_eq!(raw.error(), Some((Transport, PROTOCOL_VIOLATION)));
    }
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.send_in(Handshake, "ack 1");
    assert_eq!(raw.error(), Some((Transport, PROTOCOL_VIOLATION)));
}

#[test]
fn only_the_first_range_tells_what_the_peer_knows() {
    let mut raw = Raw::client().connected();
    raw.send("ping");
    raw.send("ping");
    raw.request_packets("ab");
    raw.send("ack 3 0-1, ping");
    raw.send("ping");
    assert_eq!(raw.packets(), "1[ack 0-4]");
}
