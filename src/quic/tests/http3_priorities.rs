use bun_quic::Direction::{Bidirectional, Unidirectional};
use bun_quic::Side::{self, Client, Server};
use bun_quic::StreamId;
use bun_quic::http3_code::*;

use crate::harness::messages::{GET, OK};
use crate::harness::priority;
use crate::harness::raw::{RTT, Raw};
use crate::harness::wire::{groups, http3, show_hex};

fn connected(side: Side) -> Raw {
    let raw = Raw::http3(side).config(|it| (it.has_priorities, it.sends_in_order) = (true, true));
    raw.connected_with("")
}

fn urgency(raw: &mut Raw, id: u64) -> u8 {
    raw.connection().priority(StreamId(id)).unwrap().urgency
}

#[test]
fn values() {
    for (value, urgency, is_incremental) in [
        ("-", 3, false),
        ("u=0", 0, false),
        ("u=7", 7, false),
        ("i", 3, true),
        ("i=?1", 3, true),
        ("i,i=?0", 3, false),
        ("u=1,%20i", 1, true),
        ("i%09,%09u=5", 5, true),
        ("u=1,u=2", 2, false),
        ("u=1;a=b,i;c", 1, true),
        ("u=8,u=/,i=1", 3, false),
        ("u=-1,u=10,u,u=a,u=?1,i=?2,i=a", 3, false),
        ("uu=1,ii,v=1,j", 3, false),
        ("a=\"b,u=1,c\",i", 3, true),
        ("a=\"\\\",u=1,\\\\\",u=2", 2, false),
        ("a;b=\",i,\",u=2", 2, false),
        ("\",i,\"", 3, false),
    ] {
        let mut raw = connected(Client);
        raw.write_http3(0, &format!("headers {GET} priority={value}"), false);
        raw.write_http3(4, &format!("headers {GET} priority=u=6,i"), false);
        raw.write_control(&format!("priority_update 4 {value}"));
        for id in [0, 4].map(StreamId) {
            let expected = priority(urgency, is_incremental);
            assert_eq!(raw.connection().priority(id), Some(expected), "{value}");
        }
    }
    let mut raw = connected(Client);
    let request = format!("headers {GET} priority=u=1 priority=i, headers priority=u=2");
    raw.write_http3(0, &request, false);
    let combined = raw.connection().priority(StreamId(0));
    assert_eq!(combined, Some(priority(1, true)));
}

#[test]
fn updates_override_the_field() {
    let request = format!("headers {GET} priority=u=1");
    let mut raw = connected(Client);
    raw.write_control("priority_update 8 u=4, priority_update 0 u=5, priority_update 8 u=6");
    raw.write_http3(8, &request, false);
    raw.write_control("priority_update 4 u=7, priority_update 396 u=0");
    raw.write(12, &[], false);
    for byte in http3("priority_update 12 u=2") {
        raw.write_control(&show_hex(&[byte]));
    }
    raw.write(16, &[], false);
    raw.connection()
        .set_priority(StreamId(16), priority(0, false));
    for id in [0, 4, 12, 16, 20] {
        raw.write_http3(id, &request, false);
    }
    let urgencies = [0, 4, 8, 12, 16, 20].map(|id| urgency(&mut raw, id));
    assert_eq!(urgencies, [5, 7, 6, 2, 0, 1]);
    assert_eq!(raw.read_control(), "settings 0x1=4096 0x7=100");

    raw.peer.send_headers(0, OK);
    raw.connection().finish(StreamId(0));
    raw.write(0, &[], true);
    raw.send("ack");
    raw.write_control("priority_update 0 u=1");
    assert_eq!(raw.connection().priority(StreamId(0)), None);
    assert_eq!(raw.error(), None);
}

#[test]
fn invalid_updates() {
    for (side, frame, code) in [
        (Client, "priority_update 1 u=1", ID_ERROR),
        (Client, "priority_update 2 u=1", ID_ERROR),
        (Client, "priority_update 3 u=1", ID_ERROR),
        (Client, "priority_update 400 u=1", ID_ERROR),
        (Client, "priority_update_push 0 u=1", ID_ERROR),
        (Server, "priority_update 0 u=1", FRAME_UNEXPECTED),
        (Server, "priority_update_push 0 u=1", FRAME_UNEXPECTED),
    ] {
        let mut raw = connected(side);
        raw.write_control(frame);
        assert_eq!(raw.http3_error(), Some(code), "{frame}");
    }
    for frame in ["priority_update 0 u=1", "priority_update_push 0 u=1"] {
        let mut raw = connected(Client);
        raw.write_http3(0, frame, false);
        assert_eq!(raw.http3_error(), Some(FRAME_UNEXPECTED), "{frame}");
    }
}

#[test]
fn can_be_ignored() {
    let mut raw = Raw::http3(Client).connected_with("");
    let request = format!("priority_update 0 u=1, headers {GET} priority=u=1");
    raw.write_http3(0, &request, false);
    raw.write_control("priority_update 0 u=1");
    assert_eq!(urgency(&mut raw, 0), 3);
}

#[test]
fn a_client_tells_the_server() {
    let mut raw = connected(Server);
    raw.read_control();
    let id = StreamId(raw.peer.open(Bidirectional));
    for (urgency, is_incremental, frame) in [
        (3, false, ""),
        (0, false, "priority_update 0 u=0"),
        (0, false, ""),
        (0, true, "priority_update 0 u=0,i"),
        (3, true, "priority_update 0 u=3,i"),
        (3, false, "priority_update 0 -"),
        (7, false, "priority_update 0 u=7"),
    ] {
        (raw.connection()).set_priority(id, priority(urgency, is_incremental));
        assert_eq!(raw.read_control(), frame);
    }
    raw.peer.send_headers(0, GET);
    raw.write_http3(0, &format!("headers {OK} priority=u=1"), false);
    assert_eq!(urgency(&mut raw, 0), 7);

    let id = StreamId(raw.peer.open(Unidirectional));
    raw.connection().set_priority(id, priority(0, false));
    assert_eq!(raw.read_control(), "");
}

#[test]
fn priority_of_a_request_applies_to_what_was_queued_before_its_head_was_complete() {
    let mut raw = connected(Client);
    let request = http3(&format!("headers {GET} priority=u=0"));
    raw.write_http3(0, &format!("headers {GET}"), true);
    raw.write(4, &request[..1], false);
    raw.forget();
    raw.waits = false;
    for id in [0, 4] {
        raw.peer.send_headers(id, ":status=103");
    }
    raw.write(4, &request[1..], true);
    let frames = raw.frames();
    assert!(groups(&frames).iter().map(|it| it[1]).eq(["4", "0"]));
}

#[test]
fn response_that_becomes_incremental_lines_up() {
    let mut raw = connected(Client);
    for (id, value) in [(0, "i"), (4, "-"), (8, "i"), (396, "-")] {
        raw.write_http3(id, &format!("headers {GET} priority={value}"), true);
    }
    raw.forget();
    for (first, second) in [(4, 0), (396, 8)] {
        raw.peer.send_headers(second, ":status=103");
        raw.peer.send_headers(first, ":status=103");
        (raw.connection()).set_priority(StreamId(first), priority(3, true));
        while raw.peer.poll(raw.now) {}
    }
    let frames = raw.frames();
    assert!(
        groups(&frames)
            .iter()
            .map(|it| it[1])
            .eq(["0", "4", "8", "396"])
    );
}

#[test]
fn responses_are_sent_by_urgency() {
    let mut raw = connected(Client);
    let values = ["u=7,i", "i", "-", "u=0", "-"];
    for (id, value) in (0..).step_by(4).zip(values) {
        raw.write_http3(id, &format!("headers {GET} priority={value}"), true);
        raw.peer.polls = false;
        raw.connection().want_write(StreamId(id));
    }
    raw.peer.polls = true;
    raw.process();
    raw.peer.log.retain(|it| it.ends_with("writable"));
    let events = "12 writable, 8 writable, 16 writable, 4 writable, 0 writable";
    assert_eq!(raw.events(), events);

    raw.forget();
    raw.waits = false;
    let mut order = |change: fn(&mut Raw)| {
        for id in [0, 4, 8, 12, 16] {
            raw.peer.send_headers(id, ":status=103");
        }
        change(&mut raw);
        let frames = raw.frames();
        let ids = groups(&frames).into_iter().map(|it| it[1]);
        ids.collect::<Vec<_>>().join(" ")
    };
    assert_eq!(order(|_| {}), "12 8 16 4 0");
    let update = |raw: &mut Raw| raw.write_control("priority_update 16 u=1");
    assert_eq!(order(update), "12 16 8 4 0");
    let set = |raw: &mut Raw| {
        raw.connection()
            .set_priority(StreamId(0), priority(0, false))
    };
    assert_eq!(order(set), "0 12 16 8 4");
    assert_eq!(order(|it| it.connection().go_away()), "3 0 12 16 8 4");
}

#[test]
fn a_response_that_is_blocked_keeps_its_place_while_some_is_on_its_way() {
    for (fields, body_len) in [("", 4096 - 5 - 3 - 2), ("a=*9000", 0)] {
        let raw = Raw::http3(Client).config(|it| it.sends_in_order = true);
        let raw = raw.with("max_data=32000 max_stream_data_bidi_local=4096");
        let mut raw = raw.connected_with("");
        for id in [0, 4] {
            raw.write_http3(id, &format!("headers {GET}"), true);
        }
        raw.send("max_stream_data 4 32000");
        raw.connection().want_write(StreamId(0));
        raw.process();
        raw.peer.send_headers(0, &format!("{OK} {fields}"));
        raw.peer.send(0, &vec![0; body_len], false);
        raw.connection().want_write(StreamId(0));
        raw.peer.send_headers(4, OK);
        raw.peer.send(4, &[0; 40_000], true);
        for expected in [8000..16_000, 20_000..32_000] {
            raw.advance(RTT);
            assert!(expected.contains(&raw.streams[&4].len()));
            raw.send("ack");
        }
    }
}
