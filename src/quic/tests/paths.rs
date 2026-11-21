use bun_quic::Direction::Unidirectional;
use bun_quic::Layer::Transport;
use bun_quic::transport_code::CONNECTION_ID_LIMIT_ERROR;
use bun_quic::{Algorithm, PreferredAddress};

use crate::harness::paths::{NEW, OLD, PREFERRED, new_id, new_ids};
use crate::harness::raw::{Packet, RTT, Raw};
use crate::harness::wire::{filler, hex};

const SERVER: &str = "198.51.100.1:443";

#[test]
fn answers_a_challenge_once() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        raw.send_expanded("path_challenge 12345678");
        let packets = raw.take();
        assert_eq!(packets[0].frames, ["path_response 12345678", "ack 0-1"]);
        assert_eq!((packets.len(), packets[0].datagram.len()), (1, 1200));
        raw.send("path_response 12345678");
        raw.advance(1000);
        assert_eq!((raw.frames(), raw.events()), Default::default());
    }
}

#[test]
fn answers_the_last_two_challenges() {
    let mut raw = Raw::server().connected();
    raw.send("path_challenge 11111111, path_challenge 22222222, path_challenge 33333333");
    let frames = "path_response 22222222, path_response 33333333";
    assert_eq!(raw.frames(), frames);
}

#[test]
fn follows_a_client_that_probes_first() {
    let mut raw = Raw::client().connected_with_spare_id();
    raw.use_id(1);
    raw.move_to(NEW);
    raw.send_expanded("path_challenge 12345678");
    let packets = raw.take();
    let frames = ["path_response 12345678", "path_challenge"];
    assert_eq!(packets[0].frames, frames);
    assert_eq!(packets[0].addresses, raw.addresses);
    assert_eq!(packets[0].destination, b"raw-id-1");
    assert_eq!((packets.len(), packets[0].datagram.len()), (1, 1200));
    raw.send_expanded("respond");
    assert_eq!(raw.packets(), format!("{OLD} 1[ack 0-3]"));
    assert_eq!(raw.events(), "");

    raw.send("ping");
    assert_eq!(raw.events(), format!("path {OLD} to {NEW}"));
    assert_eq!(raw.packets(), "1[ack 0-4, retire_connection_id 0]");
    assert_eq!(raw.connection().addresses().peer.to_string(), NEW);
}

#[test]
fn validates_both_paths_when_a_client_moves() {
    for (address, is_same_network) in [("192.0.2.1:2000", true), (NEW, false)] {
        for congestion in [Algorithm::Bbr, Algorithm::Cubic] {
            let raw = Raw::client().config(|it| it.congestion = congestion);
            let mut raw = raw.connected();
            raw.peer.open(Unidirectional);
            raw.peer.send(3, b"before", false);
            raw.forget();
            raw.move_to(address);
            raw.send_expanded("ping");
            raw.peer.send(3, b"after", false);
            let expected = format!("{OLD} 1[path_challenge]; 1[path_challenge, ack 0-1]");
            assert_eq!(raw.packets(), expected);
            raw.send("respond");
            assert_eq!(raw.events(), format!("path {OLD} to {address}"));
            let expected = "1[ack 0-2, stream 3 0 before, stream 3 6 after]";
            assert_eq!(raw.packets(), expected);
            let rtt = raw.connection().stats().smoothed_rtt;
            assert_eq!(rtt.is_zero(), !is_same_network);
            raw.move_to(OLD);
            raw.send_expanded("ping");
            let expected = format!("{address} 1[path_challenge]; 1[path_challenge, ack 0-3]");
            assert_eq!(raw.packets(), expected);
        }
    }
}

#[test]
fn starts_over_with_the_size_on_another_network() {
    for (address, len) in [
        ("192.0.2.1:2000", 1472),
        (NEW, 1200),
        ("[2001:db8::1]:1", 1200),
    ] {
        let mut raw = Raw::client().with("max_udp_payload_size=").connected();
        raw.peer.open(Unidirectional);
        raw.peer.send(3, &filler(0, 200_000), false);
        while raw.streams.get(&3).is_none_or(|it| it.len() < 200_000) {
            raw.advance(RTT);
            raw.send("ack");
        }
        raw.move_to(address);
        raw.send_expanded("ack, ping");
        raw.forget();
        raw.peer.send(3, &filler(200_000, 2000), false);
        raw.send("respond");
        let packets = raw.take();
        let has_data = |it: &&Packet| it.frames.len() > 1;
        assert_eq!(packets.iter().find(has_data).unwrap().datagram.len(), len);
    }
}

#[test]
fn stays_with_a_client_that_comes_back() {
    let mut raw = Raw::client().connected();
    raw.peer.open(Unidirectional);
    raw.move_to(NEW);
    raw.send_expanded("ping");
    raw.peer.send(3, b"held", false);
    raw.forget();
    raw.move_to(OLD);
    raw.send("respond 1, ping");
    assert_eq!(raw.packets(), "1[ack 0-2, stream 3 0 held]");
    assert_eq!(raw.events(), "");
}

#[test]
fn only_the_largest_packet_number_moves_a_connection() {
    let mut raw = Raw::client().connected();
    raw.send_as(2, "ping");
    raw.forget();
    raw.move_to(NEW);
    raw.send_as(1, "ping, padding 1200");
    assert_eq!(raw.packets(), format!("{OLD} 1[ack 0-2]"));
}

#[test]
fn needs_a_new_id_if_the_client_uses_one() {
    let mut raw = Raw::client().connected();
    raw.use_id(1);
    raw.move_to(NEW);
    raw.send_expanded("ping, path_challenge 12345678");
    raw.send_expanded("ping");
    assert_eq!(raw.packets(), format!("{OLD} 1[ack 0-2]"));

    let mut raw = Raw::client();
    raw.source.clear();
    let mut raw = raw.connected();
    raw.use_id(1);
    raw.move_to(NEW);
    raw.send_expanded("ping");
    raw.send("respond");
    assert_eq!(raw.events(), format!("path {OLD} to {NEW}"));
}

#[test]
fn gives_up_a_path_whose_id_is_retired() {
    let mut raw = Raw::client().connected_with_spare_id();
    raw.use_id(1);
    raw.move_to(NEW);
    raw.send_expanded("path_challenge 12345678");
    raw.move_to(OLD);
    raw.forget();
    raw.send(&new_id(2, 2));
    raw.advance(1000);
    let frames = "retire_connection_id 0, retire_connection_id 1";
    assert!(raw.frames().starts_with(frames));
    assert_eq!(raw.challenges.len(), 1);
}

#[test]
fn reports_where_a_connection_has_ended_up() {
    let mut raw = Raw::client().connected();
    raw.peer.polls = false;
    for address in [NEW, "192.0.2.3:3000"] {
        raw.move_to(address);
        raw.send_expanded("stream 0 0 -");
        raw.send("respond");
    }
    raw.peer.polls = true;
    let events = format!("0 opened, path {OLD} to 192.0.2.3:3000");
    assert_eq!(raw.events(), events);
}

#[test]
fn moves_to_the_preferred_address() {
    for (local, server, preferred) in [
        (OLD, SERVER, "198.51.100.2:444"),
        ("[2001:db8::9]:1", "[2001:db8::1]:443", "[2001:db8::2]:444"),
    ] {
        let raw = Raw::server().config(|it| it.uses_preferred_address = true);
        let mut raw = raw.with(PREFERRED);
        raw.peer.address = local.parse().unwrap();
        raw.addresses.local = raw.peer.address;
        raw.move_to(server);
        raw.start(&[]);
        raw.shake_hands();
        assert!(raw.challenges.is_empty());
        raw.forget();
        raw.confirm();
        let packets = raw.take();
        assert_eq!(packets[0].frames, ["path_challenge"]);
        assert_eq!(packets[0].addresses.peer.to_string(), preferred);
        assert_eq!(packets[0].destination, b"raw-id-1");
        assert_eq!(packets[0].datagram.len(), 1200);

        raw.move_to(preferred);
        raw.send_expanded("respond, path_challenge 12345678");
        let events = format!("confirmed, preferred path {server} to {preferred}");
        assert_eq!(raw.events(), events);
        let frames = "path_response 12345678, retire_connection_id 0";
        assert_eq!(raw.frames(), frames);

        raw.move_to(server);
        raw.send("stream 3 0 late");
        assert_eq!(raw.events(), "3 opened, 3 data late");
        raw.forget();
        raw.send_expanded("path_challenge 12345678");
        assert!(raw.packets().starts_with("1[path_response 12345678]"));
    }
}

#[test]
fn stays_if_the_preferred_address_is_of_no_use() {
    let without_ipv4 = format!("{}000000000000{}", &PREFERRED[..19], &PREFERRED[31..]);
    for (is_wanted, server, parameter) in [
        (false, SERVER, PREFERRED),
        (true, SERVER, &without_ipv4),
        (true, "198.51.100.2:444", PREFERRED),
    ] {
        let raw = Raw::server().config(|it| it.uses_preferred_address |= is_wanted);
        let mut raw = raw.with(parameter);
        raw.move_to(server);
        let mut raw = raw.connected();
        assert!(raw.challenges.is_empty());
        raw.send(&new_id(2, 1));
        assert_eq!(raw.take()[0].destination, b"raw-id-1");
    }

    let raw = Raw::server().config(|it| it.uses_preferred_address = true);
    let mut raw = raw.with(PREFERRED).connected();
    raw.advance(7700);
    assert_eq!(raw.challenges.len(), 5);
    raw.forget();
    raw.wait();
    assert_eq!(raw.packets(), "1[retire_connection_id 1]");
}

#[test]
fn can_be_reached_at_its_preferred_address() {
    let (ipv4, ipv6) = (
        "198.51.100.2:444".parse().ok(),
        "[2001:db8::2]:444".parse().ok(),
    );
    for (first, answer) in [
        (
            "path_challenge 12345678",
            "1[path_response 12345678, path_challenge]",
        ),
        ("ping", "1[path_challenge, ack 0-2]"),
    ] {
        let raw = Raw::client().config(|it| {
            it.parameters.preferred_address = Some(PreferredAddress::new(ipv4, ipv6));
        });
        let mut raw = raw.connected_with_spare_id();
        let parameter = raw.peer_parameter("preferred_address").unwrap();
        raw.destination = hex(&parameter[51..67]);
        raw.addresses.local = ipv4.unwrap().into();
        raw.send_expanded(first);
        assert_eq!(raw.packets(), answer);
        raw.send("respond, ping");
        assert_eq!(raw.events(), format!("path {OLD} to {OLD}"));
        assert_eq!(raw.packets(), "1[ack 0-3, retire_connection_id 0]");
    }
}

#[test]
fn a_client_only_listens_to_its_server() {
    for address in ["198.51.100.1:444", "198.51.100.2:443"] {
        let mut raw = Raw::server().connected();
        raw.move_to(address);
        raw.send_expanded("stream 3 0 a, path_challenge 12345678");
        raw.advance(1000);
        assert_eq!((raw.packets(), raw.events()), Default::default());
    }
}

#[test]
fn a_client_does_without_the_zone_of_its_server() {
    let mut raw = Raw::server();
    raw.peer.address = "[fe80::2]:1".parse().unwrap();
    raw.addresses.local = raw.peer.address;
    raw.move_to("[fe80::1]:443");
    raw.start(&[]);
    raw.move_to("[fe80::1%7]:443");
    raw.shake_hands();
    assert_eq!(raw.events(), "ready");
    assert_eq!(
        raw.connection().addresses().peer.to_string(),
        "[fe80::1]:443"
    );
}

#[test]
fn search_for_the_datagram_size_goes_on_after_a_rebinding() {
    let mut raw = Raw::client().with("max_udp_payload_size=").connected();
    raw.request_packets(&"a".repeat(10));
    raw.advance(RTT);
    raw.send("ack 0-5");
    raw.addresses.peer.set_port(2000);
    raw.send_expanded("ping");
    raw.send("respond");
    let mut sizes = Vec::new();
    for _ in 0..50 {
        raw.advance(RTT);
        raw.send("ack, ping");
        sizes.extend(raw.sizes());
    }
    assert!(sizes.contains(&1472), "{sizes:?}");
}

#[test]
fn an_id_goes_along_with_a_rebinding() {
    for (last_used, ack) in [(1, "ack 0-3"), (2, "ack 0-4")] {
        let limit = format!("active_connection_id_limit={}", last_used + 1);
        let mut raw = Raw::client().with(&limit).connected_with_spare_id();
        raw.move_to(NEW);
        for id in 1..=last_used {
            raw.use_id(id);
            raw.send_expanded("ping");
        }
        raw.forget();
        raw.move_to("192.0.2.2:2001");
        raw.send_expanded("ping");
        let packets = raw.take();
        assert_eq!(packets[0].frames, ["path_challenge", ack]);
        assert_eq!(packets[0].destination, b"raw-id-1");
    }

    let mut raw = Raw::client().connected_with_spare_id();
    let (old, new) = (raw.destination.clone(), raw.ids[&1].0.clone());
    for (id, port) in [(&new, 2001), (&old, 2002), (&old, 2003), (&new, 2004)] {
        raw.destination.clone_from(id);
        raw.move_to(&format!("192.0.2.2:{port}"));
        raw.send_expanded("path_challenge 12345678");
        assert_eq!(raw.frames(), "path_response 12345678, path_challenge");
    }
}

#[test]
fn an_id_that_two_paths_use_counts_once() {
    let mut raw = Raw::client().connected_with_spare_id();
    let first = raw.destination.clone();
    raw.use_id(1);
    raw.move_to(NEW);
    raw.send_expanded("path_challenge 12345678");
    raw.destination = first;
    raw.move_to("192.0.2.3:3000");
    raw.send_expanded("path_challenge 12345678");
    raw.send(&new_ids(2..8));
    assert_eq!(raw.error(), None);
    raw.send(&new_id(8, 0));
    assert_eq!(raw.error(), Some((Transport, CONNECTION_ID_LIMIT_ERROR)));
}

#[test]
fn every_path_has_its_own_timer() {
    let mut raw = Raw::client().connected();
    for address in [NEW, "192.0.2.3:3000"] {
        raw.move_to(address);
        raw.send_expanded("path_challenge 12345678");
        raw.advance(100);
    }
    raw.forget();
    let expected = format!("{NEW} 1[path_challenge]");
    assert_eq!((raw.wait(), raw.packets()), (50, expected));
    assert_eq!(
        (raw.wait(), raw.packets()),
        (100, "1[path_challenge]".into())
    );
}

#[test]
fn a_client_gives_up_a_path_that_the_server_only_probes() {
    let raw = Raw::server().config(|it| it.uses_preferred_address = true);
    let mut raw = raw.with(PREFERRED).connected();
    raw.move_to("198.51.100.2:444");
    raw.send(&format!("respond, {}", new_id(2, 0)));
    raw.send("ack");
    raw.use_id(1);
    raw.move_to(SERVER);
    raw.send_expanded("path_challenge 12345678");
    raw.advance(RTT);
    raw.forget();
    assert_eq!(raw.wait(), 8000 - RTT);
    assert_eq!(raw.frames(), "retire_connection_id 2");
}

#[test]
fn keeps_its_window_for_another_port_of_the_server() {
    let raw = Raw::server().config(|it| {
        (it.congestion, it.uses_preferred_address) = (Algorithm::Cubic, true);
    });
    let same_host = format!("{}1{}", &PREFERRED[..26], &PREFERRED[27..]);
    let mut raw = raw.with(&same_host).connected();
    raw.request_packets("a");
    let window = raw.connection().stats().congestion_window;
    raw.move_to("198.51.100.1:444");
    raw.send("respond, ack");
    assert_eq!(raw.connection().addresses().peer.port(), 444);
    assert_eq!(raw.connection().stats().congestion_window, window);
}
