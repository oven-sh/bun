//! draft-iyengar-quic-delayed-ack-02.

use bun_quic::Algorithm::{Bbr, Cubic};
use bun_quic::Direction::Unidirectional;
use bun_quic::Duration;
use bun_quic::Layer::Transport;
use bun_quic::transport_code::PROTOCOL_VIOLATION;

use crate::harness::paths::NEW;
use crate::harness::raw::Kind::{Handshake, Initial};
use crate::harness::raw::{APART, RTT, Raw};
use crate::harness::wire::groups;

#[test]
fn frequency_can_be_changed() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        for (number, frames, ack) in [
            (1, "ack_frequency 0 3 10000 0", ""),
            (2, "ping", ""),
            (3, "ping", "1[ack 0-3]"),
            (4, "ack_frequency 2 1 10000 0", "1[ack 0-4]"),
            (5, "ping", "1[ack 0-5]"),
            (6, "ack_frequency 1 9 10000 0", "1[ack 0-6]"),
            (7, "ack_frequency 2 9 10000 0", "1[ack 0-7]"),
            (8, "ack_frequency 3 9 10000 0", ""),
            (11, "ping", "1[ack 11 0-8]"),
            (10, "ping", "1[ack 10-11 0-8]"),
            (12, "ack_frequency 4 9 10000 1", ""),
            (9, "ping", ""),
            (14, "ping", "1[ack 14 0-12]"),
        ] {
            raw.send_as(number, frames);
            assert_eq!(raw.packets(), ack, "{number}");
        }
    }
}

#[test]
fn delay_can_be_changed() {
    for (millis, delay) in [(16, 14), (32, 28), (1000, 35), (16_383, 35)] {
        let mut raw = Raw::client();
        raw.start(&[]);
        raw.advance(140);
        raw.send_all(&[(Initial, "ack"), (Handshake, "ack, flight")]);
        raw.forget();
        raw.send(&format!("ack_frequency 0 2 {} 0", millis * 1000));
        assert_eq!(raw.wait(), delay);
    }
}

#[test]
fn invalid_frequency() {
    for (adapts, frame) in [
        (true, "ack_frequency 0 0 10000 0"),
        (true, "ack_frequency 0 2 9999 0"),
        (true, "ack_frequency 0 2 16384000 0"),
        (false, "ack_frequency 0 2 10000 0"),
    ] {
        for raw in Raw::both() {
            let mut raw = (raw.config(|it| it.adapts_ack_frequency = adapts)).connected();
            let advertised = raw.peer_parameter("min_ack_delay");
            assert_eq!(advertised.as_deref(), adapts.then_some("10000"));
            raw.send(frame);
            assert_eq!(raw.error(), Some((Transport, PROTOCOL_VIOLATION)));
        }
    }
}

/// Has the peer send so many packets in each round trip, and acknowledges them one by one. Returns the frames in reply.
fn acknowledge(raw: &mut Raw, packets: usize, round_trips: usize, rtt: u64) -> String {
    let mut frames = Vec::new();
    for _ in 0..round_trips {
        let start = raw.now;
        raw.request_many_packets(packets);
        raw.now = start + Duration::from_millis(rtt);
        let last = *raw.received[2].last().unwrap();
        for number in last + 1 - packets as u64..=last {
            raw.now = raw.now + APART;
            raw.send(&format!("ack 0-{number}"));
            frames.push(raw.frames());
        }
    }
    frames.retain(|it| !it.is_empty());
    frames.join(", ")
}

#[test]
fn asks_a_peer_that_can_be_asked() {
    for (adapts, congestion, parameters, delay) in [
        (true, Bbr, "min_ack_delay=10000", Some(25_000)),
        (true, Bbr, "min_ack_delay=0 max_ack_delay=7", Some(7000)),
        (true, Bbr, "min_ack_delay=10001", None),
        (true, Bbr, "", None),
        (true, Cubic, "min_ack_delay=10000", None),
        (false, Bbr, "min_ack_delay=10000", None),
    ] {
        for raw in Raw::both() {
            let raw =
                raw.config(|it| (it.adapts_ack_frequency, it.congestion) = (adapts, congestion));
            let mut raw = raw.with(parameters).connected();
            let frame = delay.map(|it| format!("ack_frequency 0 2 {it} 1"));
            assert_eq!(acknowledge(&mut raw, 1, 9, RTT), frame.unwrap_or_default());
        }
    }
}

#[test]
fn aims_at_few_acknowledgments_in_a_round_trip() {
    let mut raw = Raw::client().with("min_ack_delay=1000").connected();
    for (packets, round_trips, tolerances) in [
        (8, 22, "2 29 56 84 113 142 150"),
        (1, 30, "148 146 144 142 140 137 134 131 128"),
    ] {
        let frames = acknowledge(&mut raw, packets, round_trips, RTT);
        let frames = groups(&frames);
        let values: Vec<_> = frames.iter().map(|it| it[2]).collect();
        assert_eq!(values.join(" "), tolerances);
    }
}

#[test]
fn starts_from_what_the_peer_does() {
    for (sent, tolerance) in [(20, 2), (100, 50 - 25), (299, 149 - 25), (300, 75 - 25)] {
        let mut raw = Raw::client().with("min_ack_delay=1000").connected();
        raw.now = raw.now + APART * (300 - sent);
        let id = raw.peer.open(Unidirectional);
        while raw.received[2].last() < Some(&(sent - 1)) {
            raw.now = raw.now + APART;
            raw.peer.send(id, b"a", false);
            raw.forget();
        }
        raw.now = raw.now + Duration::from_millis(RTT);
        raw.send("ack");
        assert_eq!(raw.frames(), format!("ack_frequency 0 {tolerance} 25000 1"));
    }
}

#[test]
fn what_is_lost_is_asked_again_under_a_new_number() {
    let mut raw = Raw::client().with("min_ack_delay=1000").connected();
    assert_eq!(
        acknowledge(&mut raw, 1, 1, RTT),
        "ack_frequency 0 2 25000 1"
    );
    raw.wait();
    assert_eq!(raw.frames(), "ack_frequency 1 2 25000 1, ping");
}

#[test]
fn starts_over_on_another_network() {
    for (address, frames) in [("192.0.2.1:2000", ""), (NEW, "ack_frequency 3 2 25000 1")] {
        let mut raw = Raw::client().with("min_ack_delay=1000").connected();
        let asked = acknowledge(&mut raw, 8, 8, RTT);
        assert!(asked.ends_with("ack_frequency 2 56 25000 1"));
        raw.move_to(address);
        raw.send_expanded("ack, ping");
        raw.forget();
        raw.send("respond");
        assert_eq!(raw.frames(), frames);
    }
}
