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

    /// The size of a full packet. A probe may come first.
    fn mtu(&mut self) -> usize {
        self.forget();
        let id = self.peer.open(Unidirectional);
        self.peer.send(id, &filler(0, 3000), false);
        self.sizes()[1]
    }

    /// In steps of 100 ms. Returns how long that took.
    fn wait_for_probe(&mut self) -> Option<u64> {
        (0..700u64).find_map(|step| {
            self.process();
            self.inbox.retain(|it| it.datagram.len() > 1200);
            if self.inbox.is_empty() {
                self.advance(100 * step.min(1));
                self.send_and_ask_for_ack("ack");
                return None;
            }
            Some(100 * step.saturating_sub(1))
        })
    }

    fn send_and_ask_for_ack(&mut self, frames: &str) {
        self.send(&format!("{frames}, ping"));
        self.send("ping");
    }
}

/// RFC 9000 §14.3.
#[test]
fn sizes_depend_on_the_address_and_the_limit_of_the_peer() {
    for (address, limit, probes, last) in [
        ("192.0.2.1:1", "65527", &[1472; 2][..], 1472),
        ("192.0.2.1:1", "", &[1472; 2], 1472),
        ("[::ffff:192.0.2.1]:1", "65527", &[1472; 2], 1472),
        ("[2001:db8::1]:1", "65527", &[1452; 2], 1452),
        ("192.0.2.1:1", "1400", &[1400; 2], 1400),
        ("192.0.2.1:1", "1213", &[1213; 2], 1213),
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
        (1471, "3x1472 2x1336 2x1404 2x1438 2x1455 2x1463", 1463),
        (1400, "3x1472 2x1336 3x1404 2x1370 2x1387 2x1395", 1395),
        (1200, "3x1472 3x1336 3x1268 3x1234 3x1217 3x1208", 1200),
    ] {
        let mut raw = client().warmed_up();
        let sizes = raw.probes(mtu);
        let runs = (sizes.chunk_by(|a, b| a == b)).map(|run| format!("{}x{}", run.len(), run[0]));
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
fn probes_that_are_lost_before_a_timeout() {
    let mut raw = client().warmed_up();
    for size in [1472, 1472, 1472, 1336] {
        raw.send_and_ask_for_ack("ack");
        raw.process();
        assert_eq!(raw.inbox[0].datagram.len(), size);
        assert_eq!(raw.lose(), "ping");
        raw.wait();
        assert_eq!(raw.frames(), "ping, ping");
    }
}

/// A probe is acknowledged, lost, lost like the packet before it (<), the second (=) or the third (>) after it, or lost
/// because the client moves to another port (capital M). The first (?) or the last (!) that was lost arrives after all,
/// there is none for so many seconds, the client moves, or nothing arrives for two timeouts.
#[test]
fn search_rests_if_only_some_probes_get_through() {
    for (steps, last) in [
        ("a", 1200),
        ("aa", 1472),
        ("al1aaaaa", 1200),
        ("al1aaaaaa", 1472),
        ("la1aaaaaa", 1472),
        ("lla1aaaaaa", 1472),
        ("al1al2aaaaaaa", 1200),
        ("al1al2aaaaaaaa", 1472),
        ("al1la2al4al8al16al32al64al64aaaaaaaa", 1472),
        ("al1lllaaaaa", 1200),
        ("al1lllaaaaaaa", 1336),
        ("al1lllaaaaaaaa", 1404),
        ("al1al2lllaaaaaaaaaaaaa", 1336),
        ("al1al2lllaaaaaaaaaaaaaa", 1404),
        ("al1al2aaaaaaaataa", 1472),
        ("al!a", 1472),
        ("la!a", 1472),
        ("l!aa", 1472),
        ("ll?aa", 1472),
        ("ll!a1aaaaa", 1200),
        ("al!l1aaaaa", 1200),
        ("l!l!l!aa", 1336),
        ("a=a", 1472),
        ("=aa", 1472),
        ("l=a1aaaaa", 1200),
        ("===aa", 1336),
        ("==a=====a", 1472),
        ("==a======1aaaaa", 1200),
        ("a<1aaaaa", 1200),
        ("a>1aaaaa", 1200),
        ("ama", 1200),
        ("llmlmaa", 1472),
        ("llMaa", 1472),
        ("almaaaaa", 1200),
        ("almaaaaaa", 1472),
        ("ata", 1200),
        ("lltltaa", 1472),
        ("altaaaaa", 1200),
        ("altaaaaaa", 1472),
        ("altaltaaaaaaa", 1200),
    ] {
        let raw = client().config(|it| it.progress_timeout = Duration::ZERO);
        let (mut raw, mut rest, mut lost) = (raw.warmed_up(), 0, Vec::new());
        for step in steps.bytes() {
            if step.is_ascii_digit() {
                rest = 10 * rest + u64::from(step - b'0');
                continue;
            }
            if step == b'<' {
                raw.request_packets("a");
                raw.received[2].pop_last();
            }
            if b"al<=>M".contains(&step) {
                let millis = 1000 * std::mem::take(&mut rest);
                assert_eq!(raw.wait_for_probe(), Some(millis), "{steps}");
            }
            if b"l<=>M".contains(&step) {
                lost.push(raw.inbox[0].number);
                raw.lose();
            }
            match step {
                b'?' | b'!' => {
                    let at = usize::from(step == b'!') * (lost.len() - 1);
                    raw.received[2].insert(lost[at]);
                    raw.send("ack");
                }
                b'm' | b'M' => {
                    let port = raw.addresses.peer.port();
                    raw.addresses.peer.set_port(port + 1);
                    raw.send_expanded("ping");
                    raw.send("respond");
                }
                b't' => {
                    raw.request_packets("a");
                    for _ in 0..2 {
                        raw.wait();
                        raw.forget();
                    }
                }
                _ => {
                    raw.request_packets("abcde");
                    if b"=>".contains(&step) {
                        let number = lost[lost.len() - 1] + 2 + u64::from(step == b'>');
                        raw.received[2].remove(&number);
                    }
                    raw.advance(RTT);
                    raw.send("ack");
                }
            }
        }
        assert_eq!(raw.mtu(), last, "{steps}");
    }
}

#[test]
fn probe_from_before_a_fall_back_does_not_count() {
    for is_lost in [false, true] {
        let mut raw = client().warmed_up();
        raw.send_and_ask_for_ack("ack 0-5");
        let old = raw.take().remove(0);
        for _ in 0..2 {
            raw.wait();
            raw.forget();
        }
        raw.send_and_ask_for_ack("ack 0-9");
        let new = raw.take().remove(0);
        assert_eq!([old.datagram.len(), new.datagram.len()], [1472; 2]);
        let (first, last) = (old.number + u64::from(is_lost), new.number - 1);
        raw.send_and_ask_for_ack(&format!("ack {first}-{last}"));
        assert_eq!(raw.outline(), "1[ack]");
        assert_eq!(raw.probes(1472), [1472]);
    }
}

#[test]
fn no_probe_while_nothing_is_acknowledged() {
    let mut raw = client().connected();
    raw.request_packets(&"a".repeat(8));
    raw.wait();
    assert!(raw.sizes().iter().all(|&it| it < 100));
    raw.advance(RTT);
    raw.send_and_ask_for_ack("ack");
    assert_eq!(raw.sizes()[0], 1472);
}

#[test]
fn no_probe_on_its_own_or_ahead_of_a_short_message() {
    let mut raw = client().warmed_up();
    raw.send("ack");
    assert_eq!(raw.sizes(), []);
    let id = raw.peer.open(Unidirectional);
    for (len, is_probing) in [(1050, false), (1051, true)] {
        raw.peer.send(id, &filler(0, len), false);
        assert_eq!(raw.sizes()[0] == 1472, is_probing);
    }
}

#[test]
fn probe_ahead_of_what_is_sent_again() {
    let mut raw = client().warmed_up();
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, b"c", false);
    raw.lose();
    raw.request_packets("def");
    raw.send("ack");
    assert_eq!(raw.frames(), "ping, stream 11 0 c");
}

#[test]
fn probe_ahead_of_datagram_frames() {
    let mut raw = client().with("max_datagram_frame_size=100").warmed_up();
    raw.send("ack");
    raw.connection().send_datagram(1, vec![0]);
    assert_eq!(raw.frames(), "ping, datagram #00");
}

#[test]
fn no_probe_before_the_handshake_is_confirmed() {
    let mut raw = Raw::server().with("max_udp_payload_size=");
    raw.start(&[]);
    raw.shake_hands();
    raw.request_packets(&"a".repeat(10));
    assert_eq!(raw.sizes(), []);
    raw.send_and_ask_for_ack("ack, handshake_done");
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
    raw.send_and_ask_for_ack("ack");
    assert_eq!(raw.sizes()[0], 1472);
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
                assert_eq!(raw.probes(max), [max; 2]);
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
            false => raw.send_and_ask_for_ack("ack"),
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

#[test]
fn lost_probe_does_not_make_a_connection_stale() {
    let mut raw = Raw::server().with("max_udp_payload_size=").connected();
    raw.request_packets(&"a".repeat(10));
    raw.advance(RTT);
    for _ in 0..3 {
        assert_eq!(raw.wait_for_probe(), Some(0));
        raw.lose();
        raw.wait();
        raw.advance(RTT);
        let [now, later] = [0, 5].map(|it| raw.now + Duration::from_secs(it));
        assert!(!raw.connection().is_stale(now));
        raw.send("ack");
        assert!(!raw.connection().is_stale(later));
    }
}
