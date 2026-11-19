use bun_quic::Direction::Unidirectional;
use bun_quic::Layer::Transport;
use bun_quic::transport_code::PROTOCOL_VIOLATION;

use crate::harness::raw::Kind::{Handshake, Initial};
use crate::harness::raw::Raw;

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
fn delay_is_a_quarter_of_a_round_trip_within_bounds() {
    for (rtt, delay) in [(1, 1), (4, 1), (8, 2), (96, 24), (100, 25), (140, 25)] {
        let mut raw = Raw::client();
        raw.start(&[]);
        raw.advance(rtt);
        raw.send_all(&[(Initial, "ack"), (Handshake, "ack, flight")]);
        raw.forget();
        raw.send("ping");
        assert_eq!(raw.wait(), delay);
        assert_eq!(raw.packets(), format!("1[ack 0 +{}]", delay * 1000 / 8));
    }
}

#[test]
fn delay_without_a_round_trip_time() {
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.send_in(Handshake, "flight");
    raw.forget();
    raw.send("ping");
    assert_eq!(raw.wait(), 25);
    assert_eq!(raw.packets(), "1[ack 0 +3125]");
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
