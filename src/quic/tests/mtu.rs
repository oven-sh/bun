use bun_quic::Direction::Unidirectional;
use bun_quic::{Algorithm, Duration};

use crate::harness::raw::{RTT, Raw};
use crate::harness::wire::filler;

fn client() -> Raw {
    Raw::client().with("max_udp_payload_size=")
}

impl Raw {
    /// Up to where the next packet of a server is number 10, which is the first that can be a probe.
    fn warmed_up(mut self) -> Self {
        self = self.connected();
        self.request_packets(&"a".repeat(8));
        self.advance(RTT);
        self.send("ack");
        let id = self.peer.open(Unidirectional);
        self.peer.send(id, b"b", false);
        assert_eq!(self.frames(), "stream 7 0 b");
        self
    }

    /// For a while, over a link that drops what is longer than `mtu`. Returns the sizes of the probes.
    fn probes(&mut self, mtu: usize) -> Vec<usize> {
        let (mut sizes, end) = (Vec::new(), self.now + Duration::from_secs(5));
        while self.now < end {
            self.advance(RTT);
            for packet in self.take() {
                if packet.datagram.len() > 1200 {
                    sizes.push(packet.datagram.len());
                }
                if packet.datagram.len() > mtu {
                    self.received[2].remove(&packet.number);
                }
            }
            self.send("ack, ping");
        }
        sizes
    }

    /// The size of a full packet.
    fn mtu(&mut self) -> usize {
        self.forget();
        let id = self.peer.open(Unidirectional);
        self.peer.send(id, &filler(0, 3000), false);
        self.sizes()[0]
    }
}

/// RFC 9000 §14.3.
#[test]
fn sizes_depend_on_the_address_and_the_limit_of_the_peer() {
    for (address, limit, probes, last) in [
        ("192.0.2.1:1", "65527", &[1472][..], 1472),
        ("192.0.2.1:1", "", &[1472], 1472),
        ("[::ffff:192.0.2.1]:1", "65527", &[1472], 1472),
        ("[2001:db8::1]:1", "65527", &[1452], 1452),
        ("192.0.2.1:1", "1400", &[1400], 1400),
        ("192.0.2.1:1", "1213", &[1213], 1213),
        ("192.0.2.1:1", "1212", &[], 1200),
    ] {
        let new = || {
            let mut raw = client().with(&format!("max_udp_payload_size={limit}"));
            raw.addresses.peer = address.parse().unwrap();
            raw
        };
        assert_eq!(new().connected().mtu(), 1200);
        let mut raw = new().warmed_up();
        assert_eq!(raw.probes(1500), probes);
        assert_eq!(raw.mtu(), last);
    }
}

#[test]
fn searches_below_what_did_not_get_through() {
    for (mtu, probes, last) in [
        (1471, "3x1472 1336 1404 1438 1455 1463", 1463),
        (1400, "3x1472 1336 3x1404 1370 1387 1395", 1395),
        (1200, "3x1472 3x1336 3x1268 3x1234 3x1217 3x1208", 1200),
    ] {
        let mut raw = client().warmed_up();
        let sizes = raw.probes(mtu);
        let runs = sizes.chunk_by(|a, b| a == b).map(|run| match run.len() {
            1 => format!("{}", run[0]),
            count => format!("{count}x{}", run[0]),
        });
        assert_eq!(runs.collect::<Vec<_>>().join(" "), probes);
        assert_eq!(raw.mtu(), last);
    }
}

/// RFC 9000 §14.4.
#[test]
fn loss_of_a_probe_is_not_congestion() {
    let mut raw = client().config(|it| it.congestion = Algorithm::Cubic);
    raw = raw.warmed_up();
    let before = raw.connection().stats().congestion_window;
    raw.probes(1252);
    let stats = raw.connection().stats();
    assert_eq!((stats.packets_lost, stats.congestion_window), (0, before));
}

#[test]
fn probe_that_gets_through_at_last() {
    let mut raw = client().warmed_up();
    for _ in 0..2 {
        raw.send("ack");
        raw.process();
        assert_eq!(raw.inbox[0].datagram.len(), 1472);
        assert_eq!(raw.lose(), "ping");
        raw.wait();
        assert_eq!(raw.frames(), "ping, ping");
    }
    assert_eq!(raw.probes(1472), [1472]);
    assert_eq!(raw.mtu(), 1472);
}

#[test]
fn no_probe_while_nothing_is_acknowledged() {
    let mut raw = client().connected();
    raw.request_packets(&"a".repeat(8));
    raw.wait();
    assert!(raw.sizes().iter().all(|&it| it < 100));
    raw.advance(RTT);
    raw.send("ack");
    assert_eq!(raw.sizes(), [1472]);
}

#[test]
fn no_probe_before_the_handshake_is_confirmed() {
    let mut raw = Raw::server().with("max_udp_payload_size=");
    raw.start(&[]);
    raw.shake_hands();
    raw.request_packets(&"a".repeat(10));
    assert_eq!(raw.sizes(), []);
    raw.send("ack, handshake_done");
    assert_eq!(raw.sizes()[0], 1472);
}

#[test]
fn probe_keeps_the_pace() {
    let mut raw = client().connected();
    raw.request_packets(&"a".repeat(8));
    raw.advance(RTT);
    raw.send("ack");
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, &filler(0, 100_000), false);
    assert!(raw.take().last().unwrap().number >= 10);
    raw.send("ping");
    raw.send("ping");
    assert_eq!(raw.packets(), "1[ack 0-3]");
    raw.wait();
    assert_eq!(raw.sizes()[0], 1472);
}

#[test]
fn falls_back_after_two_timeouts() {
    let mut raw = client().warmed_up();
    raw.probes(1472);
    assert_eq!(raw.mtu(), 1472);
    for size in [1472, 1200, 1200] {
        raw.wait();
        assert_eq!(raw.sizes()[0], size);
    }
    raw.advance(RTT);
    raw.send("ack");
    assert_eq!(raw.sizes(), [1472]);
    assert_eq!(raw.mtu(), 1200);
}

/// A large or a small packet is lost, or delivered if the letter is a capital, and so is a probe.
#[test]
fn falls_back_when_only_small_packets_get_through() {
    for (max, rounds, last) in [
        (1472, "ll", 1472),
        (1472, "lll", 1200),
        (1472, "llLll", 1472),
        (1472, "llLlll", 1200),
        (1472, "llSl", 1200),
        (1472, "lls", 1472),
        (1472, "lllPll", 1472),
        (1472, "lllPlll", 1200),
        (1252, "ll", 1252),
        (1252, "lll", 1200),
    ] {
        let parameters = format!("max_datagram_frame_size=65535 max_udp_payload_size={max}");
        let mut raw = client().with(&parameters).warmed_up();
        raw.probes(max);
        for round in rounds.bytes() {
            if round == b'P' {
                assert_eq!(raw.probes(max), [max]);
                continue;
            }
            raw.advance(RTT / 2);
            raw.forget();
            let len = 1200 + usize::from(round.eq_ignore_ascii_case(&b'l'));
            (raw.connection()).send_datagram(0, filler(0, len - (1 + 8 + 2) - 3 - 16));
            raw.process();
            assert_eq!(raw.inbox[0].datagram.len(), len);
            if round.is_ascii_lowercase() {
                raw.lose();
            }
            raw.request_packets("abc");
            raw.advance(RTT);
            raw.send("ack");
        }
        raw.lose();
        raw.request_packets("d");
        raw.send("ack");
        assert_eq!(raw.sizes(), []);
        assert_eq!(raw.mtu(), last, "{rounds}");
    }
}

#[test]
fn loss_of_what_was_sent_with_a_packet_that_got_through_raises_no_suspicion() {
    let mut raw = client().warmed_up();
    raw.probes(1472);
    raw.advance(RTT);
    raw.forget();
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, &filler(0, 10_000), false);
    let first = raw.take()[0].number;
    raw.advance(RTT);
    for last in 3..6 {
        raw.send(&format!("ack {}-{}", first + 3, first + last));
    }
    assert_eq!(raw.connection().stats().packets_lost, 3);
    raw.advance(RTT / 2);
    assert_eq!(raw.outline(), "1[stream]; 1[stream]; 1[stream]");
}

/// RFC 9002 §7.6.2 and RFC 9000 §14.4.
#[test]
fn persistent_congestion() {
    for (is_probed, timeouts, pause, window) in [
        (true, 0, 300, 2 * 1472),
        (true, 2, 100, 2 * 1460),
        (false, 2, 100, 32 * 1460 * 4 / 5),
    ] {
        let raw = client().config(|it| it.congestion = Algorithm::Cubic);
        let mut raw = raw.warmed_up();
        match is_probed {
            true => drop(raw.probes(1472)),
            false => raw.send("ack"),
        }
        raw.advance(RTT / 2);
        if is_probed {
            raw.request_packets("a");
        }
        for _ in 0..timeouts {
            raw.forget();
            raw.wait();
        }
        raw.now = raw.now + Duration::from_millis(pause);
        raw.request_packets("bcde");
        raw.advance(RTT);
        let last = *raw.received[2].last().unwrap();
        raw.send(&format!("ack {last}"));
        assert_eq!(raw.connection().stats().congestion_window, window);
    }
}

#[test]
fn search_starts_over_after_a_fall_back() {
    let mut raw = client().warmed_up();
    raw.probes(1400);
    assert_eq!(raw.mtu(), 1395);
    for _ in 0..2 {
        raw.wait();
        raw.forget();
    }
    raw.send("ack");
    assert_eq!(raw.probes(1400)[..4], [1472, 1472, 1472, 1336]);
}
