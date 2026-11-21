use bun_quic::Layer::Transport;
use bun_quic::crypto::Cipher;
use bun_quic::transport_code::AEAD_LIMIT_REACHED;
use bun_quic::{Duration, Version};

use crate::harness::keys::{V1, V2};
use crate::harness::network::Network;
use crate::harness::raw::Kind::Short;
use crate::harness::raw::{RTT, Raw};

impl Raw {
    /// RFC 9001 §6.1. Until we know that the peer has followed.
    fn update_keys(&mut self) {
        self.generation += 1;
        self.send("ping");
        self.send("ping");
        self.process();
        assert_eq!(self.peer_generation, self.generation);
    }

    /// Sends a packet, and has it acknowledged.
    fn use_keys(&mut self) {
        let before = self.connection().stats().pings_received;
        self.send("ping");
        self.advance(RTT);
        assert_eq!(self.connection().stats().pings_received, before + 1);
        self.forget();
    }
}

/// RFC 9001 §6.2 and RFC 9369 §3.3.2.
#[test]
fn follows_the_peer() {
    for cipher in [
        Cipher::Aes128GcmSha256,
        Cipher::Aes256GcmSha384,
        Cipher::ChaCha20Poly1305Sha256,
    ] {
        for (version, versions) in [(V1, &[Version::V1]), (V2, &[Version::V2])] {
            for raw in Raw::both() {
                let mut raw = raw.config(|it| it.versions = versions);
                (raw.version, raw.peer.tls.cipher) = (version, cipher);
                raw = raw.connected();
                for generation in 1..5 {
                    raw.use_keys();
                    raw.update_keys();
                    let packet = raw.take().pop().unwrap();
                    assert_eq!(usize::from(packet.first >> 2 & 1), generation & 1);
                    raw.request_packets("a");
                    raw.advance(RTT);
                    raw.send("ack");
                }
                assert_eq!(raw.error(), None);
            }
        }
    }
}

/// RFC 9001 §6.5.
#[test]
fn old_keys_are_kept_for_three_probe_timeouts() {
    for (delay, is_accepted) in [(202, true), (203, false)] {
        for raw in Raw::both() {
            let mut raw = raw.connected();
            raw.advance(100);
            raw.use_keys();
            let late = raw.packet(Short, "ping");
            raw.update_keys();
            raw.advance(delay);
            raw.deliver(&late);
            assert_eq!(pings(&mut raw), 3 + u64::from(is_accepted));
            assert_eq!(raw.peer_generation, 1);
            raw.use_keys();
        }
    }
}

#[test]
fn packets_with_the_new_keys_out_of_order() {
    let mut raw = Raw::client().connected();
    raw.use_keys();
    let old = raw.packet(Short, "stream 0 0 a");
    raw.generation += 1;
    let [first, second] = ["stream 0 1 b", "stream 0 2 c"].map(|it| raw.packet(Short, it));
    for packet in [&second, &first, &old, &second, &old] {
        raw.deliver(packet);
    }
    assert_eq!(raw.events(), "0 opened, 0 data abc");
    assert_eq!(raw.peer_generation, 1);
}

/// RFC 9001 §6.3.
#[test]
fn packet_that_is_not_authentic_does_not_update_the_keys() {
    let mut raw = Raw::client().connected();
    raw.use_keys();
    raw.generation = 1;
    let mut packet = raw.packet(Short, "ping");
    *packet.last_mut().unwrap() ^= 1;
    raw.deliver(&packet);
    raw.generation = 0;
    raw.use_keys();
    assert_eq!(raw.peer_generation, 0);
    raw.update_keys();
}

#[test]
fn what_is_lost_is_sent_again_with_the_new_keys() {
    let mut raw = Raw::client().connected();
    raw.use_keys();
    raw.request_packets("a");
    raw.update_keys();
    raw.forget();
    raw.wait();
    let packet = raw.take().remove(0);
    assert_eq!(packet.first & 4, 4);
    assert_eq!(packet.frames, ["ack 0-3 +6875", "stream 3 0 a"]);
}

fn limited(raw: Raw, confidentiality: u64, integrity: u64) -> Raw {
    raw.peer.crypto.limits.set([confidentiality, integrity]);
    raw.connected()
}

/// Returns the number and the key phase of the packet that it gets.
fn elicit(raw: &mut Raw, frames: &str) -> (u64, u8) {
    raw.send(frames);
    raw.send("ping");
    let packet = raw.take().pop().unwrap();
    (packet.number, packet.first >> 2 & 1)
}

fn pings(raw: &mut Raw) -> u64 {
    raw.connection().stats().pings_received
}

/// RFC 9001 §6.6.
#[test]
fn updates_its_keys_before_the_limit() {
    for (client, server) in [(2100, 1 << 23), (1 << 23, 2100), (2100, 2100)] {
        let mut network = Network::new(1);
        network.client.crypto.limits.set([client, 1 << 52]);
        network.server.crypto.limits.set([server, 1 << 52]);
        network.bytes_per_second = 12_500_000;
        network.jitter = Duration::from_millis(2);
        network.loss_per_mille = 5;
        network.connect();
        network.echo(4_000_000);
        for peer in [&mut network.client, &mut network.server] {
            assert!(peer.connection().stats().packets_sent > 2100);
        }
    }
}

/// RFC 9001 §6.6.
#[test]
fn updates_after_half_of_the_limit() {
    for raw in Raw::both() {
        let mut raw = limited(raw, 2100, 1 << 52);
        let (mut updates, mut phase) = (Vec::new(), 0);
        while updates.len() < 3 {
            let (number, now) = elicit(&mut raw, "ack, ping");
            if std::mem::replace(&mut phase, now) != now {
                updates.push(number);
            }
        }
        assert_eq!(updates, [1050, 2100, 3150]);
    }
}

/// RFC 9001 §6.1.
#[test]
fn next_update_waits_for_an_acknowledgment() {
    let mut raw = limited(Raw::client(), 4096, 1 << 52);
    let first = loop {
        if let (number, 1) = elicit(&mut raw, "ack, ping") {
            break number;
        }
    };
    let stale = format!("ack {}, ping", first - 1);
    while elicit(&mut raw, &stale).0 < first + 2100 {}
    assert_eq!(raw.peer_generation, 1);
    assert_eq!(elicit(&mut raw, &format!("ack {first}, ping")).1, 0);
    assert_eq!(raw.peer_generation, 2);
}

#[test]
fn next_update_waits_for_the_peer_to_follow() {
    let mut raw = limited(Raw::client(), 4096, 1 << 52);
    let first = loop {
        if let (number, 1) = elicit(&mut raw, "ack, ping") {
            break number;
        }
    };
    let mut number = first;
    while number < first + 2100 {
        for frames in ["ack, ping", "ping"] {
            raw.generation = 0;
            raw.send(frames);
        }
        number = raw.take().pop().unwrap().number;
    }
    // The old key is there for as long as it is needed.
    raw.advance(1000);
    raw.generation = 0;
    let before = pings(&mut raw);
    raw.send("ack, ping");
    assert_eq!((pings(&mut raw), raw.peer_generation), (before + 1, 1));
    raw.generation = 1;
    assert_eq!(elicit(&mut raw, "ping").1, 0);
}

#[test]
fn old_key_is_dropped_after_the_peer_has_followed() {
    for (delay, count) in [(100, 1), (300, 0)] {
        let mut raw = limited(Raw::client(), 2100, 1 << 52);
        raw.advance(1000);
        elicit(&mut raw, "ping");
        raw.send("ack");
        let late = raw.packet(Short, "ping");
        while raw.peer_generation == 0 {
            raw.send("ping");
            raw.forget();
        }
        raw.generation = 0;
        raw.send("padding 3");
        raw.advance(150);
        raw.generation = 1;
        raw.send("padding 3");
        raw.advance(delay);
        let before = pings(&mut raw);
        raw.deliver(&late);
        assert_eq!(pings(&mut raw), before + count);
    }
}

#[test]
fn key_that_cannot_be_updated_is_used_up() {
    let mut raw = limited(Raw::client(), 4096, 1 << 52);
    while elicit(&mut raw, "ack, ping").1 == 0 {}
    let first = *raw.received[2].last().unwrap();
    while raw.close.is_none() {
        elicit(&mut raw, "ping");
    }
    assert_eq!(raw.error(), Some((Transport, AEAD_LIMIT_REACHED)));
    assert_eq!(raw.received[2].last().unwrap() - first, 3072);
}

#[test]
fn too_many_packets_that_are_not_authentic() {
    for raw in Raw::both() {
        let mut raw = limited(raw, 1 << 23, 10);
        for count in 1..=10 {
            // All keys count.
            raw.generation += count % 2;
            raw.send("ping");
            raw.advance(RTT);
            raw.forget();
            assert_eq!(raw.error(), None);
            let mut packet = raw.packet(Short, "ping");
            *packet.last_mut().unwrap() ^= 1;
            raw.deliver(&packet);
        }
        assert_eq!(raw.error(), Some((Transport, AEAD_LIMIT_REACHED)));
    }
}
