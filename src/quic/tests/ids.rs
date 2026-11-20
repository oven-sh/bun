use std::collections::BTreeSet;

use bun_quic::Layer::Transport;
use bun_quic::transport_code::*;

use crate::harness::paths::{new_id, new_ids};
use crate::harness::raw::Kind::{Handshake, Initial, Short};
use crate::harness::raw::{RTT, Raw};

#[test]
fn issues_no_more_than_the_peer_takes() {
    for (limit, issued) in [(2, 1), (3, 2), (1000, 2)] {
        for raw in Raw::both() {
            let raw = raw.with(&format!("active_connection_id_limit={limit}"));
            let mut raw = raw.connected();
            assert_eq!(raw.ids.len(), issued);
            for (id, token) in raw.ids.clone().into_values() {
                assert!(id != raw.destination && token.len() == 16);
                raw.destination = id;
                raw.send("ping, ping");
            }
            let stats = raw.connection().stats();
            assert_eq!(stats.pings_received, 2 * issued as u64);
        }
    }
}

#[test]
fn replaces_what_is_retired() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        let first = std::mem::replace(&mut raw.destination, raw.ids[&1].0.clone());
        raw.send("retire_connection_id 0");
        assert_eq!(raw.frames(), "new_connection_id 2 0");
        let issued = raw.ids[&2].clone();
        raw.wait();
        assert_eq!(raw.frames(), "new_connection_id 2 0, ping");
        assert!(raw.ids[&2] == issued);
        raw.send("retire_connection_id 0, retire_connection_id 2");
        assert_eq!(raw.frames(), "new_connection_id 3 0");
        raw.wait();
        assert_eq!(raw.frames(), "ping, ping");
        raw.destination = first;
        raw.send("ping");
        assert_eq!(raw.events(), "stray");
    }
}

#[test]
fn switches_when_asked_to_retire() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        for (frames, retired, in_use) in [
            (new_ids(1..4), &[][..], "raw-id-0"),
            (new_id(3, 0), &[], "raw-id-0"),
            (new_id(4, 1), &["0"], "raw-id-1"),
            (new_id(5, 0), &[], "raw-id-1"),
            (new_id(7, 4), &["1", "2", "3"], "raw-id-4"),
            (new_id(9, 9), &["4", "5", "7"], "raw-id-9"),
            (new_id(8, 0), &["8"], "raw-id-9"),
        ] {
            raw.send(&format!("ack, {frames}"));
            raw.advance(RTT);
            let packets = raw.take();
            assert!(packets.iter().all(|it| it.destination == in_use.as_bytes()));
            let sent = packets.iter().flat_map(|it| &it.frames);
            let sent = sent.filter_map(|it| it.strip_prefix("retire_connection_id "));
            assert!(sent.collect::<BTreeSet<_>>().iter().eq(retired), "{frames}");
        }
        raw.wait();
        assert_eq!(raw.frames(), "retire_connection_id 8, ping");
    }
}

#[test]
fn uses_ids_of_any_length() {
    for id in ["a", "twenty-bytes-long-id"] {
        let mut raw = Raw::client().connected();
        raw.send(&format!("new_connection_id 1 1 {id} *16"));
        assert_eq!(raw.take()[0].destination, id.as_bytes());
    }
}

#[test]
fn errors() {
    let [limit, violation] = [CONNECTION_ID_LIMIT_ERROR, PROTOCOL_VIOLATION].map(Some);
    let after_first = |frame| format!("{}, new_connection_id {frame}", new_id(1, 0));
    for (frames, code) in [
        (new_ids(1..8), None),
        (new_ids(1..9), limit),
        (format!("{}, {}", new_ids(1..8), new_id(8, 1)), None),
        (after_first("1 0 raw-id-2 token00000000001"), violation),
        (after_first("2 0 raw-id-1 token00000000002"), violation),
        (after_first("2 0 raw-id-2 token00000000001"), violation),
        (after_first("2 0 raw-id-0 token00000000002"), violation),
        (after_first("0 0 raw-id-2 token00000000002"), violation),
        ("retire_connection_id 2".into(), violation),
        ("retire_connection_id 0".into(), violation),
    ] {
        for raw in Raw::both() {
            let mut raw = raw.connected();
            raw.send(&frames);
            assert_eq!(raw.error(), code.map(|it| (Transport, it)), "{frames}");
        }
    }
    for mut raw in Raw::both() {
        raw.source.clear();
        let mut raw = raw.connected();
        raw.send(&new_id(1, 0));
        assert_eq!(raw.error(), Some((Transport, PROTOCOL_VIOLATION)));
    }
}

#[test]
fn frames_wait_for_a_packet_that_has_room() {
    let mut raw = Raw::client();
    raw.peer.tls.tickets = 30;
    raw.start(&[]);
    raw.forget();
    raw.send_all(&[
        (Initial, "ack"),
        (Handshake, "ack, flight"),
        (Short, &new_id(1, 1)),
    ]);
    assert_eq!(
        raw.packets(),
        "1[ack 0, handshake_done, new_token, crypto 0 ~1106]; \
         1[crypto 1106 ~214, new_connection_id 1 0, retire_connection_id 0]"
    );

    for gaps in 0..30 {
        let mut raw = Raw::client();
        raw.peer.tls.tickets = 24;
        raw.start(&[]);
        raw.forget();
        raw.waits = false;
        raw.send_all(&[(Initial, "ack"), (Handshake, "ack, flight")]);
        (0..gaps).for_each(|it| raw.send_as(2 * it, "ping"));
        assert!(raw.sizes().iter().all(|&it| it <= 1200));
    }
}

#[test]
fn a_retirement_that_was_sent_twice_is_settled_once() {
    let mut raw = Raw::client().connected();
    raw.send(&new_id(1, 1));
    let first = raw.take()[0].number;
    raw.wait();
    assert_eq!(raw.frames(), "retire_connection_id 0, ping");
    raw.send(&format!("ack {first}"));
    raw.wait();
    assert_eq!(raw.frames(), "ping, ping");
}
