use bun_quic::Direction::Unidirectional;
use bun_quic::Layer::Transport;
use bun_quic::transport_code::PROTOCOL_VIOLATION;
use bun_quic::{Algorithm, Duration};

use crate::harness::paths::new_id;
use crate::harness::raw::Kind::{Handshake, Short};
use crate::harness::raw::{RTT, Raw};

#[test]
fn numbers_of_every_length() {
    for len in 1..=4 {
        for raw in Raw::both() {
            let mut raw = raw.connected();
            raw.number_len = len;
            raw.send("ping");
            raw.send("ping");
            assert_eq!(raw.packets(), "1[ack 0-2]");
        }
    }
}

/// RFC 9000 §A.3.
#[test]
fn truncated_numbers_are_taken_for_the_closest() {
    for (largest, len, number, ack) in [
        (0xa82f_30ea, 2, 0xa82f_9b32, "ack 2821692210 2821665002 0"),
        (255, 1, 256, "ack 255-256 0"),
        (200, 1, 329, "ack 329 200 0"),
        (300, 1, 174, "ack 300 174 0"),
        (300, 1, 255, "ack 300 255 0"),
        (65_600, 2, 65_500, "ack 65600 65500 0"),
        (10, 1, 200, "ack 200 10 0"),
    ] {
        let mut raw = Raw::client().connected();
        raw.send_as(largest, "ping");
        raw.forget();
        raw.number_len = len;
        raw.send_as(number, "ping");
        raw.connection().acknowledge();
        assert_eq!(raw.packets(), format!("1[{ack}]"));
    }
    for number in [173, 430] {
        let mut raw = Raw::client().connected();
        raw.send_as(300, "ping");
        raw.number_len = 1;
        raw.send_as(number, "ping");
        assert_eq!(raw.connection().stats().pings_received, 1);
    }
}

#[test]
fn duplicates_are_dropped() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        let [first, second] = [(); 2].map(|()| raw.packet(Short, "ping"));
        for packet in [&first, &first, &second, &first, &second] {
            raw.deliver(packet);
        }
        assert_eq!(raw.packets(), "1[ack 0-2]");
        assert_eq!(raw.connection().stats().pings_received, 2);
    }
}

/// RFC 9000 §17.3.1.
#[test]
fn reserved_bits_count_in_a_duplicate_too() {
    let mut raw = Raw::client().connected();
    raw.flipped = 0x08;
    raw.send_as(0, "ping");
    assert_eq!(raw.error(), Some((Transport, PROTOCOL_VIOLATION)));
}

#[test]
fn packets_that_are_not_authentic_are_dropped() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        let packet = raw.packet(Short, "ping, padding 10");
        for at in (0..packet.len()).filter(|at| !(1..9).contains(at)) {
            let mut changed = packet.clone();
            changed[at] ^= 0x04;
            raw.deliver(&changed);
            raw.deliver(&packet[..at.max(9)]);
        }
        raw.flipped = 0x40;
        raw.send("ping");
        raw.advance(100);
        assert_eq!((raw.packets(), raw.events()), Default::default());
        raw.deliver(&packet);
        assert_eq!(raw.connection().stats().pings_received, 1);
    }
}

/// RFC 9000 §12.2.
#[test]
fn what_follows_a_packet_has_to_be_for_the_same_connection() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        let first = raw.packet(Handshake, "ping");
        let ours = raw.packet(Short, "ping");
        raw.destination[0] ^= 1;
        let other = raw.packet(Short, "ping");
        for (rest, pings) in [(&other[..], 0), (&ours[..8], 0), (&ours, 1)] {
            raw.deliver(&[&first, rest].concat());
            assert_eq!(raw.connection().stats().pings_received, pings);
        }
    }
}

/// RFC 9000 §10.3.
#[test]
fn packets_are_long_enough_to_be_answered_with_a_reset() {
    for (id, len) in [(&b""[..], 30), (b"raw-id-0", 32), (&[7; 20], 44)] {
        let mut raw = Raw::client();
        raw.source = id.to_vec();
        let mut raw = raw.connected();
        raw.send("ping");
        raw.send("ping");
        assert_eq!(raw.sizes(), [len]);
    }
}

/// RFC 9000 §17.4.
#[test]
fn spin_bit_does_not_spin() {
    for (random, expected) in [(0xdf, 0), (0x20, 1)] {
        for raw in Raw::both() {
            raw.peer.crypto.planned.borrow_mut().push(vec![random; 13]);
            let mut raw = raw.connected();
            for (number, spin) in [(2, 1), (3, 0), (1, 1), (4, 1)] {
                raw.flipped = spin << 5;
                raw.send_as(number, "ping");
                raw.connection().acknowledge();
                assert_eq!(raw.take()[0].first >> 5 & 1, expected);
            }
        }
    }
}

#[test]
fn spin_bit_is_drawn_for_each_id() {
    for (random, expected) in [(0xef, 0), (0x10, 1)] {
        let raw = Raw::client();
        raw.peer.crypto.planned.borrow_mut().push(vec![random; 13]);
        let mut raw = raw.connected();
        raw.send(&format!("{}, ping", new_id(1, 1)));
        raw.connection().acknowledge();
        assert_eq!(raw.take()[0].first >> 5 & 1, expected);
    }
}

#[test]
fn statistics() {
    for raw in Raw::both() {
        let mut raw = (raw.config(|it| it.congestion = Algorithm::Cubic)).connected();
        let before = raw.connection().stats();
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &[1; 2000], true);
        let sizes = raw.sizes();
        raw.advance(RTT);
        let ack = raw.packet(Short, "ack");
        raw.deliver(&ack);
        let after = raw.connection().stats();
        assert_eq!(sizes[0], 1200);
        assert_eq!(after.packets_sent - before.packets_sent, 2);
        assert_eq!(after.bytes_sent - before.bytes_sent, 1200 + sizes[1] as u64);
        assert_eq!(after.packets_received - before.packets_received, 1);
        assert_eq!(
            after.bytes_received - before.bytes_received,
            ack.len() as u64
        );
        assert_eq!(before.packets_received, 4);
        assert_eq!((after.packets_lost, after.packets_retransmitted), (0, 0));
        assert_eq!(after.min_rtt, Duration::from_millis(RTT));
        assert_eq!(after.smoothed_rtt, Duration::from_millis(RTT));
        assert_eq!(after.rtt_variation, Duration::from_micros(4218));
        assert_eq!(after.congestion_window, 32 * 1460);
    }
    let mut raw = Raw::client().with_ticket();
    raw.resume();
    assert_eq!(raw.connection().stats().bytes_received, 1200);
}
