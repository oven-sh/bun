use bun_quic::Direction::Unidirectional;
use bun_quic::{Algorithm, PreferredAddress};

use crate::harness::paths::{NEW, OLD, PREFERRED, new_id};
use crate::harness::raw::{Packet, RTT, Raw};
use crate::harness::wire::{filler, hex};

const SERVER: &str = "198.51.100.1:443";

#[test]
fn answers_a_challenge_once() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        raw.send_expanded("path_challenge 12345678");
        let packets = raw.take();
        assert_eq!(packets[0].frames, ["path_response 12345678"]);
        assert_eq!((packets.len(), packets[0].datagram.len()), (1, 1200));
        raw.send("path_response 12345678");
        raw.advance(1000);
        assert_eq!((raw.frames(), raw.events()), Default::default());
    }
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
            let expected = match is_same_network {
                true => "1[ack 0-2, stream 3 6 after]",
                false => "1[ack 0-2, stream 3 0 before, stream 3 6 after]",
            };
            assert_eq!(raw.packets(), expected);
            let rtt = raw.connection().stats().smoothed_rtt;
            assert_eq!(rtt.is_zero(), !is_same_network);
        }
    }
}

#[test]
fn starts_over_with_the_size_on_another_network() {
    for (address, len) in [
        ("192.0.2.1:2000", 1472),
        (NEW, 1252),
        ("[2001:db8::1]:1", 1232),
    ] {
        let mut raw = Raw::client().connected();
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
    for (local, server, preferred, len) in [
        (OLD, SERVER, "198.51.100.2:444", 1252),
        (
            "[2001:db8::9]:1",
            "[2001:db8::1]:443",
            "[2001:db8::2]:444",
            1232,
        ),
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
        raw.peer.open(Unidirectional);
        raw.peer.send(2, &filler(0, 2000), false);
        assert_eq!(raw.sizes()[0], len);

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
        let raw = Raw::server().config(|it| it.uses_preferred_address = is_wanted);
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
