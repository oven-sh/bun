use bun_quic::Version;

use crate::harness::keys::{DRAFT_29, V1, V2};
use crate::harness::raw::Kind::{Handshake, Initial};
use crate::harness::raw::Raw;

#[test]
fn numbers_and_protocols() {
    for (version, number, alpn) in [
        (Version::Draft29, DRAFT_29, &b"\x05h3-29"[..]),
        (Version::V1, V1, b"\x02h3"),
        (Version::V2, V2, b"\x02h3"),
    ] {
        assert_eq!((version.number(), version.http3_alpn()), (number, alpn));
        assert_eq!(Version::from_number(number), Some(version));
    }
    assert_eq!([0, 2, 0x0a0a_0a0a].map(Version::from_number), [None; 3]);
}

/// RFC 9000 §6.1 and RFC 8999 §6.
#[test]
fn a_server_lists_its_versions() {
    for (version, lens) in [
        (0x1a2a_3a4a, [8, 8]),
        (DRAFT_29, [8, 20]),
        (2, [0, 0]),
        (2, [20, 1]),
    ] {
        for random in [0, 0xff] {
            let mut raw = Raw::client();
            let ids = [vec![1; lens[0]], vec![2; lens[1]]];
            let mut datagram = [&[0x80][..], &u32::to_be_bytes(version)].concat();
            datagram.extend(
                ids.iter()
                    .flat_map(|id| [&[id.len() as u8], &id[..]].concat()),
            );
            datagram.resize(1200, 0);
            raw.peer.crypto.planned.borrow_mut().push(vec![random]);
            raw.deliver(&datagram);
            let packet = raw.take().remove(0);
            assert_eq!(packet.frames, ["versions #000000016b3343cf"]);
            assert_eq!(packet.first, random | 0xc0);
            assert_eq!([packet.source, packet.destination], ids);
            assert_eq!(raw.peer.endpoint.connection_count(), 0);
        }
    }
}

/// RFC 9000 §6.2.
#[test]
fn a_client_gives_up_unless_its_version_is_listed() {
    for (versions, events) in [
        ("1a2a3a4a", "closed: NoCommonVersion"),
        ("1a2a3a4a ff00001d", "closed: NoCommonVersion"),
        ("00000001", ""),
        ("1a2a3a4a 00000001", ""),
    ] {
        let mut raw = Raw::server();
        raw.start(&[]);
        raw.forget();
        raw.deliver(&raw.version_negotiation(versions));
        assert_eq!((raw.events(), raw.packets()), (events.into(), "".into()));
    }
    let mut raw = Raw::server();
    raw.start(&[]);
    raw.send_in(Initial, "ack");
    raw.deliver(&raw.version_negotiation("1a2a3a4a"));
    raw.shake_hands();
    assert_eq!(raw.events(), "ready");
}

#[test]
fn every_version_from_the_start() {
    for (versions, number, information) in [
        (&[Version::V1], V1, Some("#0000000100000001")),
        (&[Version::V2], V2, Some("#6b3343cf6b3343cf")),
        (&[Version::Draft29], DRAFT_29, None),
    ] {
        for raw in Raw::both() {
            let mut raw = raw.config(|it| it.versions = versions);
            raw.version = number;
            raw.start(&[]);
            raw.shake_hands();
            assert!(raw.peer.has_logged("ready"));
            let advertised = raw.peer_parameter("version_information");
            assert_eq!(advertised.as_deref(), information);
            assert!(raw.versions_of_packets().iter().all(|&it| it == number));
        }
    }
    let mut raw = Raw::server().config(|it| it.versions = &[]);
    raw.start(&[]);
    assert_eq!(raw.versions_of_packets(), [V1]);
}

/// RFC 9368 §2.3.
#[test]
fn a_server_moves_to_the_version_that_it_prefers() {
    use Version::{V1 as One, V2 as Two};
    for (versions, first, offered, chosen, available) in [
        (&[One, Two], V1, "000000016b3343cf", V2, "6b3343cf00000001"),
        (&[One, Two], V1, "6b3343cf00000001", V2, "6b3343cf00000001"),
        (&[One, Two], V1, "000000011a2a3a4a", V1, "6b3343cf00000001"),
        (&[One, Two], V2, "000000016b3343cf", V2, "6b3343cf00000001"),
        (&[Two, One], V2, "6b3343cf00000001", V1, "000000016b3343cf"),
        (&[Two, One], V1, "6b3343cf00000001", V1, "000000016b3343cf"),
    ] {
        let mut raw = Raw::client().config(|it| it.versions = versions);
        raw.set(&format!("version_information=#{first:08x}{offered}"));
        raw.version = first;
        raw.start(&[]);
        assert_eq!(raw.versions_of_packets(), [chosen; 2]);
        let advertised = raw.peer_parameter("version_information");
        assert_eq!(advertised, Some(format!("#{chosen:08x}{available}")));
        raw.send_in(Initial, "ping");
        assert_eq!(raw.versions_of_packets(), [chosen; 2]);
        raw.version = chosen;
        raw.send_in(Initial, "ping");
        assert_eq!(raw.packets(), "I[ack 0-2]");
        raw.shake_hands();
        assert_eq!(raw.events(), "ready, confirmed");
    }
}

#[test]
fn a_server_stays_with_the_version_that_it_has_answered_in() {
    let mut raw = Raw::client().with("version_information=#000000016b3343cf00000001");
    raw.send_in(Initial, "hello 0 100");
    assert_eq!(raw.versions_of_packets(), [V1]);
    raw.send_in(Initial, "hello 100");
    assert_eq!(raw.versions_of_packets(), [V1; 2]);
    let advertised = raw.peer_parameter("version_information");
    assert_eq!(advertised.unwrap(), "#000000016b3343cf00000001");
    raw.shake_hands();
    assert_eq!(raw.events(), "ready, confirmed");
}

#[test]
fn a_retry_packet_is_an_answer() {
    let mut raw = Raw::client().with("version_information=#000000016b3343cf00000001");
    let retry = loop {
        raw.send_in(Initial, "ping");
        if let Some(packet) = raw.take().pop() {
            break packet;
        }
    };
    (raw.token, raw.destination) = (retry.token, retry.source.clone());
    raw.retry_source = Some(retry.source);
    raw.advance(10_000);
    raw.send_in(Initial, "hello");
    assert_eq!(raw.versions_of_packets(), [V1; 2]);
}

#[test]
fn a_retry_packet_may_be_on_its_way() {
    for (delay, version) in [(150, V1), (9999, V1), (10_000, V2)] {
        let mut raw = Raw::client().with("version_information=#000000016b3343cf00000001");
        while raw.take().is_empty() {
            raw.send_in(Initial, "ping");
        }
        raw.advance(delay);
        raw.send_in(Initial, "hello");
        assert_eq!(raw.versions_of_packets(), [version; 2]);
    }
}

#[test]
fn not_to_a_client_with_a_token_from_an_earlier_connection() {
    let first = Raw::client().connected();
    let token = first.new_token.clone();
    let mut raw = (first.again()).with("version_information=#000000016b3343cf00000001");
    while raw.take().is_empty() {
        raw.send_in(Initial, "ping");
    }
    raw.token = token;
    raw.send_in(Initial, "hello");
    assert_eq!(raw.versions_of_packets(), [V2; 2]);
}

/// RFC 9369 §4.1.
#[test]
fn a_client_follows() {
    use Version::{V1 as One, V2 as Two};
    for (versions, first, chosen, is_acked) in [
        (&[One, Two], V1, V2, false),
        (&[One, Two], V1, V2, true),
        (&[Two, One], V2, V1, false),
    ] {
        let mut raw = Raw::server().config(|it| it.versions = versions);
        raw.set(&format!("version_information=#{chosen:08x}{chosen:08x}"));
        raw.start(&[]);
        assert_eq!(raw.versions_of_packets(), [first]);
        if is_acked {
            raw.send_in(Initial, "ack");
            raw.forget();
        }
        raw.version = chosen;
        raw.send_in(Initial, "ack, hello");
        assert_eq!(raw.versions_of_packets(), [chosen]);
        raw.send_in(Handshake, "flight");
        assert_eq!(raw.events(), "ready");
        assert_eq!(raw.versions_of_packets(), [chosen; 2]);
        raw.confirm();
        assert_eq!(raw.events(), "confirmed");
    }
}
