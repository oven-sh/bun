use bun_quic::Direction::{Bidirectional, Unidirectional};
use bun_quic::Side::{self, Client, Server};
use bun_quic::StreamId;
use bun_quic::http3_code::*;

use crate::harness::messages::{GET, OK, encodings};
use crate::harness::raw::{Kind, Raw};
use crate::harness::wire::{filler, http3, show_hex};

const BOTH: &[Side] = &[Client, Server];
const FIRST: StreamId = StreamId(0);

#[test]
fn interim_responses_can_go_on() {
    let mut raw = Raw::http3(Server).exchange();
    for _ in 0..300 {
        raw.write_http3(0, "headers :status=102", false);
        assert_eq!(raw.events(), "0 Interim :status=102");
    }
    let frames = "headers :status=102, ".repeat(100) + "headers :status=200, data a";
    raw.write_http3(0, &frames, true);
    let events = "0 Interim :status=102, ".repeat(100) + "0 Head :status=200, 0 fin a, 0 closed";
    assert_eq!(raw.events(), events);
}

#[test]
fn field_sections_can_arrive_side_by_side() {
    let raw = Raw::http3(Server).http3_config(|it| {
        (it.kept_fields.size, it.tolerated_fields.size) = (20_000, 20_000);
    });
    let mut raw = raw.with("max_streams_bidi=300").connected_with("");
    let head = http3(&format!("headers :status=200 a={}", "~".repeat(19_000)));
    let (most, rest) = head.split_at(head.len() - 1);
    let ids = Vec::from_iter((0..300).map(|_| raw.request(GET)));
    for part in [most, rest] {
        ids.iter().for_each(|&id| raw.write(id, part, false));
    }
    let heads = raw.peer.log.iter().filter(|it| it.ends_with("a=~19000"));
    assert_eq!(heads.count(), 300);
}

#[test]
fn as_many_heads_can_arrive_side_by_side_as_requests_are_allowed() {
    let raw = Raw::http3(Client).config(|it| it.parameters.initial_max_streams_bidi = 300);
    let raw = raw.http3_config(|it| {
        (it.kept_fields.size, it.tolerated_fields.size) = (10_000, 10_000);
    });
    let mut raw = raw.connected_with("");
    let head = http3(&format!("headers {GET} a={}", "~".repeat(9000)));
    let (most, rest) = head.split_at(head.len() - 1);
    for part in [most, rest] {
        (0..300).for_each(|at| raw.write(4 * at, part, false));
    }
    let heads = raw.peer.log.iter().filter(|it| it.ends_with("a=~9000"));
    assert_eq!(heads.count(), 300);
}

#[test]
fn messages_that_have_many_gaps() {
    let (body, value) = ("a".repeat(300), "b".repeat(300));
    let stream = http3(&format!(
        "headers :status=103 a={value}, headers :status=200, data {body}, headers a={value}"
    ));
    let name = |at| {
        if at + 1 == stream.len() {
            "fin"
        } else {
            "stream"
        }
    };
    for polls in [true, false] {
        let mut raw = Raw::http3(Server).exchange();
        raw.peer.polls = polls;
        for first in [1, 2, 0] {
            for at in (first..stream.len()).step_by(3).rev() {
                let byte = show_hex(&stream[at..=at]);
                raw.send(&format!("{} 0 {at} {byte}", name(at)));
            }
        }
        raw.peer.polls = true;
        raw.process();
        assert_eq!(raw.peer.streams[&0].received, body.as_bytes());
        assert!(raw.peer.has_logged("0 fin -"));
    }
}

#[test]
fn responses_that_have_no_context_can_be_stopped() {
    let mut raw = Raw::http3(Server).connected_with("");
    let [kept, _] = [raw.request(GET), raw.request(GET)];
    (raw.connection()).set_stream_context(StreamId(kept), std::ptr::dangling_mut());
    raw.forget();
    raw.connection().stop_streams_without_context(7);
    assert_eq!(raw.frames(), "");
    raw.connection().stop_streams_without_context(7);
    assert!(raw.frames().starts_with("stop_sending 4 0x7, stream 6 "));
}

#[test]
fn every_split_of_a_message() {
    for (side, interim) in [
        (Client, &[][..]),
        (Server, &[":status=100", ":status=103 a=b"]),
    ] {
        let head = format!("{} content-length=6", Raw::http3(side).head());
        let interim = |name| interim.iter().map(move |it| format!("{name} {it}, "));
        let frames: String = interim("headers").collect();
        let stream = http3(&format!(
            "0x21 a, {frames} headers {head}, data ab, data, 0x40000000 a, origin,
            #4000c0000000000000026364, data ef, headers a=b, 0x4000 a"
        ));
        let events: String = interim("0 Interim").collect();
        let events = format!("{events}0 Head {head}, 0 data, 0 Trailers a=b, 0 fin -");

        let name = |end| if end == stream.len() { "fin" } else { "stream" };
        let frame = |at, end| format!("{} 0 {at} {}", name(end), show_hex(&stream[at..end]));
        let bytes = (0..stream.len()).map(|at| frame(at, at + 1));
        let halves = (1..stream.len()).map(|at| vec![frame(0, at), frame(at, stream.len())]);
        let end = format!("fin 0 {} -", stream.len());
        let apart = vec![format!("stream 0 0 {}", show_hex(&stream)), end];
        for mut packets in halves.chain([bytes.collect(), apart]) {
            for polls in [true, true, false, false] {
                let mut raw = Raw::http3(side).exchange();
                raw.peer.polls = polls;
                packets.iter().for_each(|it| raw.send(it));
                raw.peer.polls = true;
                raw.process();
                let log = &mut raw.peer.log;
                log.retain(|it| it != "0 closed");
                (log.iter_mut().filter(|it| it.starts_with("0 data")))
                    .for_each(|it| it.truncate(6));
                log.dedup();
                assert_eq!(raw.events(), events, "{packets:?}");
                assert_eq!(raw.peer.streams[&0].received, b"abcdef");
                assert_eq!(raw.read_decoder(), "");
                packets.reverse();
            }
        }
    }
}

#[test]
fn well_formed_requests() {
    let check = |start: &str, sent, seen: &str| {
        let seen = if seen.is_empty() { sent } else { seen };
        for frame in encodings(&format!("{start} {sent}")) {
            let mut raw = Raw::http3(Client).exchange();
            raw.write_http3(0, &frame, true);
            assert_eq!(raw.events(), format!("0 Head {start} {seen}, 0 fin -"));
        }
    };
    for (sent, seen) in [
        (":method=PUT :path=/a?b=c :authority=a", ""),
        (":path=* :authority=a :method=OPTIONS", ""),
        (":method=OPTIONS :path=/ a=b host=a", ""),
    ] {
        check(":scheme=ftp", sent, seen);
    }
    for (sent, seen) in [
        (":path=/%80%ff host=a", ":path=#2f80ff host=a"),
        (":path=/ :authority=%20a%09", ":path=/ :authority=a"),
    ] {
        check(":method=GET :scheme=https", sent, seen);
    }
    for (sent, seen) in [
        ("host=a", ""),
        ("host=%09a", "host=a"),
        ("te=trailers", ""),
        ("te=%20Trailers", "te=Trailers"),
        ("cookie=a cookie=b cookie=a", ""),
        ("content-length=0", ""),
        ("content-length=%2000", "content-length=00"),
        ("priority=u=1 accept=a", ""),
        ("a=- b=%20%09 c=d", "a=- b=- c=d"),
        ("a=%09b%09%20c%20%09 d=e", "a=#62092063 d=e"),
        ("a=%7e%80%ff", "a=#7e80ff"),
        ("a!#$&*+-.09^_`z|~=b", ""),
        ("%25=a '=b", "#25=a \\'=b"),
    ] {
        check(GET, sent, seen);
    }
}

#[test]
fn well_formed_responses() {
    for (method, head, rest, events) in [
        ("GET", OK, "", "0 fin -"),
        ("GET", ":status=599 content-length=1", "data a", "0 fin a"),
        ("GET", ":status=204", "data", "0 fin -"),
        ("GET", ":status=304 content-length=9", "", "0 fin -"),
        ("HEAD", ":status=200 content-length=9", "", "0 fin -"),
        ("GET", ":status=204", "data a", "0 fin -"),
        ("GET", ":status=304", "data a, data b", "0 fin -"),
        ("HEAD", ":status=200 content-length=1", "data a", "0 fin -"),
        ("CONNECT", OK, "data a", "0 fin a"),
        ("CONNECT", ":status=407", "headers a=b", "0 Trailers a=b"),
    ] {
        for frame in encodings(head) {
            let mut raw = Raw::http3(Server).connected_with("");
            raw.request(&format!(":method={method} :authority=a"));
            raw.write_http3(0, &format!("{frame}, {rest}"), true);
            assert!(
                raw.events()
                    .starts_with(&format!("0 Head {head}, {events},"))
            );
        }
    }
}

#[test]
fn content_that_a_response_cannot_have_is_not_awaited() {
    for (rest, events, frames) in [
        ("data", "", ""),
        (
            "data a",
            ", 0 fin -, 0 closed",
            "stop_sending 0 0x10c, stream 6 1 @",
        ),
    ] {
        let mut raw = Raw::http3(Server).connected_with("");
        raw.request(":method=HEAD :authority=a");
        raw.forget();
        let [frame, _] = encodings(OK);
        raw.write_http3(0, &format!("{frame}, {rest}"), false);
        assert_eq!(raw.events(), format!("0 Head {OK}{events}"));
        assert_eq!(raw.frames(), frames);
    }
}

#[test]
fn tunnels() {
    for head in [
        ":method=CONNECT :authority=a:1",
        ":method=CONNECT :protocol=websocket :scheme=https :authority=a :path=/",
    ] {
        for frame in encodings(head) {
            let raw = Raw::http3(Client).http3_config(|it| it.connect_protocol = true);
            let mut raw = raw.exchange();
            raw.peer.echoes = true;
            raw.write_http3(0, &format!("{frame}, data a, 0x21"), false);
            assert_eq!(raw.events(), format!("0 Head {head}, 0 data a"));
            raw.write_http3(0, "data b", true);
            assert_eq!(raw.read_http3(0), format!("headers {OK}, data a, data b"));
            assert_eq!(raw.events(), "0 fin b, 0 closed");
        }
    }
}

#[test]
fn frames_that_do_not_start_a_message() {
    for (sides, frame, code) in [
        (BOTH, "data a", FRAME_UNEXPECTED),
        (BOTH, "data", FRAME_UNEXPECTED),
        (BOTH, "cancel_push 0", FRAME_UNEXPECTED),
        (BOTH, "settings", FRAME_UNEXPECTED),
        (BOTH, "goaway 0", FRAME_UNEXPECTED),
        (BOTH, "max_push_id 0", FRAME_UNEXPECTED),
        (BOTH, "0x02", FRAME_UNEXPECTED),
        (BOTH, "0x06", FRAME_UNEXPECTED),
        (BOTH, "0x08", FRAME_UNEXPECTED),
        (BOTH, "0x09", FRAME_UNEXPECTED),
        (&[Client], "push_promise 0", FRAME_UNEXPECTED),
        (&[Server], "push_promise 0", ID_ERROR),
        (BOTH, "#0100", 0x200),
        (BOTH, "#01030000", FRAME_ERROR),
    ] {
        for &side in sides {
            let mut raw = Raw::http3(side).exchange();
            raw.write_http3(0, frame, true);
            assert_eq!(raw.http3_error(), Some(code), "{frame}");
        }
    }
}

#[test]
fn a_turn_to_write_is_good_for_a_frame() {
    let mut raw = Raw::http3(Server).connected_with("");
    raw.peer.polls = false;
    let ids = [(); 2].map(|()| raw.peer.open(Bidirectional));
    for id in ids {
        raw.peer.send_headers(id, "a=b");
        raw.connection().want_write(StreamId(id));
    }
    let content = filler(0, 200_000);
    raw.connection().write(FIRST, &content[..4091]);
    raw.forget();
    raw.send("ack");
    raw.peer.log.clear();
    raw.peer.poll(raw.now);
    assert_eq!(raw.peer.events(), "0 writable");
    assert!(raw.connection().write(FIRST, &content) > Some(0));
}

#[test]
fn sends_messages() {
    for &side in BOTH {
        let mut raw = Raw::http3(side).connected_with("");
        for (id, len) in (0..).step_by(4).zip([0, 63, 64, 16_383, 16_384]) {
            match side {
                Client => raw.write_http3(id, &format!("headers {GET}"), true),
                Server => drop(raw.peer.open(Bidirectional)),
            }
            let (stream, content) = (StreamId(id), filler(0, len));
            assert_eq!(raw.connection().write(stream, &content), None);
            assert!(raw.peer.send_headers(id, &format!("a=b c=*{len}")));
            assert_eq!(raw.connection().write(stream, &content), Some(len));
            assert!(raw.peer.send_headers(id, "d=e"));
            raw.connection().finish(stream);
            assert!(!raw.peer.send_headers(id, "f=g"));
            while !raw.frames().is_empty() {
                raw.send("ack");
                raw.advance(1);
            }
            let frames = match len {
                0 => "headers a=b c=-, headers d=e".into(),
                _ => format!("headers a=b c=*{len}, data *{len}, headers d=e"),
            };
            assert_eq!(raw.read_http3(id), frames);
        }
        assert!(!raw.peer.send_headers(20, "a=b"));

        let id = raw.peer.open(Unidirectional);
        assert!(!raw.peer.send_headers(id, "a=b"));
        raw.peer.send(id, b"!a", true);
        assert_eq!(raw.frames(), format!("fin {id} 0 !a"));
    }
}

#[test]
fn frame_headers_count_for_flow_control() {
    let raw = Raw::http3(Client).with("max_stream_data_bidi_local=4096");
    let mut raw = raw.exchange();
    raw.peer.send_headers(0, OK);
    raw.forget();
    for (limit, events, len, frame) in [
        (4096, "", 4096 - 5 - 3, ", stream 0 5 "),
        (4097, "", 0, ""),
        (4098, "", 0, ""),
        (4099, "0 writable", 1, ", stream 0 4096 #000161"),
        (4099 + 65, "0 writable", 62, ", stream 0 4099 ~64"),
        (4163 + 67, "0 writable", 64, ", stream 0 4163 ~67"),
    ] {
        raw.send(&format!("max_stream_data 0 {limit}"));
        assert_eq!(raw.events(), events);
        assert_eq!(raw.connection().write(FIRST, &filler(0, 5000)), Some(len));
        let frames = format!("stream_data_blocked 0 {limit}{frame}");
        assert!(raw.frames().starts_with(&frames));
    }
    raw.peer.send_headers(0, "a=b");
    raw.connection().finish(FIRST);
    assert!((4231..4250).any(|limit| {
        raw.advance(1);
        raw.send(&format!("max_stream_data 0 {limit}"));
        raw.frames().starts_with("fin 0 ")
    }));
}

#[test]
fn the_body_can_follow_the_head_at_once() {
    let mut raw = Raw::http3(Client).exchange();
    for fields in [None, Some(OK)] {
        fields.inspect(|it| assert!(raw.peer.send_headers(0, it)));
        raw.connection().want_write(FIRST);
        raw.peer.poll(raw.now);
        assert_eq!(raw.peer.events(), "0 writable");
    }
}

#[test]
fn is_blocked_when_there_is_no_room_for_a_frame() {
    let write = |parameter: String| {
        let mut raw = Raw::http3(Client).with(&parameter).exchange();
        raw.peer.send_headers(0, OK);
        let len = raw.connection().write(FIRST, &filler(0, 200_000));
        (len.unwrap(), raw.frames())
    };
    let used = 5 + 5 + write(String::new()).0;
    for (name, used, frame) in [
        ("max_stream_data_bidi_local", used, "stream_data_blocked"),
        ("max_data", used + 11 + 1 + 1, "data_blocked"),
    ] {
        let is_blocked = |left| {
            write(format!("{name}={}", used + left))
                .1
                .starts_with(frame)
        };
        assert_eq!([2, 3].map(is_blocked), [true, false], "{name}");
    }
}

#[test]
fn a_message_that_is_not_started_is_cancelled() {
    let mut raw = Raw::http3(Client).exchange();
    raw.write_http3(0, &format!("headers {GET}"), true);
    raw.connection().finish(FIRST);
    assert_eq!(raw.frames(), "reset_stream 0 0x10c 0");

    let mut raw = Raw::http3(Server).connected_with("");
    raw.peer.open(Bidirectional);
    raw.connection().finish(FIRST);
    let frames = "reset_stream 0 0x10c 0, stop_sending 0 0x10c";
    assert!(raw.frames().starts_with(frames));
    assert_eq!(raw.read_decoder(), "cancel 0");
    assert_eq!(raw.events(), "0 closed");
}

#[test]
fn the_peer_gives_up() {
    let mut raw = Raw::http3(Server).exchange();
    raw.send("reset_stream 0 0x10b 0, reset_stream 0 0x10b 0");
    assert_eq!(raw.events(), "0 reset 0x10b, 0 closed");
    assert_eq!(raw.read_decoder(), "");
    raw.request(GET);
    assert_eq!(raw.read_decoder(), "cancel 0");

    let mut raw = Raw::http3(Client).exchange();
    raw.write_http3(0, &format!("headers {GET}, data a"), false);
    raw.send("reset_stream 0 0x10c 13, reset_stream 0 0x10c 13, stop_sending 0 0x10c");
    let events = "0 data a, 0 reset 0x10c, 0 stopped 0x10c, 0 closed";
    assert_eq!(raw.events(), format!("0 Head {GET}, {events}"));
    assert_eq!(raw.read_decoder(), "cancel 0");
    assert!(raw.frames().starts_with("reset_stream 0 0x10c 0, stream"));
}

#[test]
fn a_response_can_be_ahead_of_the_request() {
    let mut raw = Raw::http3(Client).exchange();
    raw.write_http3(0, &format!("headers {GET}, data a"), false);
    raw.peer.send_headers(0, OK);
    raw.connection().finish(FIRST);
    raw.connection().stop(FIRST, NO_ERROR);
    raw.connection().stop(FIRST, NO_ERROR);
    let frames = "stop_sending 0 0x100, stream 7 1 @, fin 0 0 #01030000d9";
    assert_eq!(raw.frames(), frames);
    raw.write_http3(0, "data b", false);
    assert_eq!(raw.events(), format!("0 Head {GET}, 0 data a, 0 closed"));

    let mut raw = Raw::http3(Server).connected_with("");
    raw.peer.open(Bidirectional);
    raw.peer.send_headers(0, GET);
    raw.forget();
    raw.write_http3(0, &format!("headers {OK}, data a"), true);
    raw.send("stop_sending 0 0x100");
    let events = format!("0 Head {OK}, 0 fin a, 0 stopped 0x100, 0 closed");
    assert_eq!(raw.events(), events);
    assert!(raw.frames().starts_with("reset_stream 0 0x100 "));
}

#[test]
fn fields_wait_while_a_stream_is_paused() {
    for &side in BOTH {
        let mut raw = Raw::http3(side).exchange();
        let head = raw.head();
        raw.connection().set_paused(FIRST, true);
        raw.write_http3(0, &format!("headers {head}, data a, headers a=b"), true);
        assert_eq!(raw.events(), "");
        raw.connection().set_paused(FIRST, false);
        for event in [
            &format!("0 Head {head}"),
            "0 data a",
            "0 Trailers a=b",
            "0 fin -",
        ] {
            raw.peer.poll(raw.now);
            raw.connection().set_paused(FIRST, true);
            assert!(raw.events().starts_with(event));
            raw.connection().set_paused(FIRST, false);
        }
    }
}

#[test]
fn what_has_arrived_is_delivered_before_the_end() {
    let mut raw = Raw::http3(Server).exchange();
    raw.connection().set_paused(FIRST, true);
    raw.write_http3(0, &format!("headers {OK}, data a, headers a=b"), true);
    raw.send("application_close 0x100 -");
    let events = "0 data a, 0 Trailers a=b, 0 fin -, 0 closed, closed by application_close 0x100 -";
    assert_eq!(raw.events(), format!("0 Head {OK}, {events}"));
}

#[test]
fn only_content_awaits_consumption() {
    let raw = Raw::http3(Client).config(|it| {
        it.awaits_consumption = true;
        it.parameters.initial_max_stream_data_bidi_remote = 1000;
    });
    let mut raw = raw.exchange();
    raw.write_http3(0, &format!("headers {GET}, data *700"), false);
    raw.write_http3(0, "data *200", false);
    assert_eq!(raw.frames(), "");
    raw.connection().consume(FIRST, 900);
    assert!(raw.frames().starts_with("max_stream_data 0 "));
    raw.write_http3(0, "0x21 *900", false);
    assert!(raw.frames().starts_with("max_stream_data 0 "));
}

#[test]
fn closing_cancels_what_is_unfinished() {
    let mut raw = Raw::http3(Server).exchange();
    raw.peer.open(Bidirectional);
    raw.peer.send_headers(4, GET);
    raw.forget();
    let now = raw.now;
    raw.connection().close(now);
    let len = raw.streams[&4].len();
    let reset = format!("reset_stream 4 0x10c {len}");
    let frames = format!("stop_sending 0 0x100, {reset}, stop_sending 4 0x100, stream 6 1 @D");
    assert_eq!(raw.frames(), frames);
    raw.send("ack");
    assert_eq!(raw.frames(), "application_close 0x100");
    assert_eq!(raw.events(), "0 closed, 4 closed, closed: Local");
    assert_eq!(raw.read_decoder(), "cancel 0, cancel 4");

    let mut raw = Raw::http3(Client).connected_with("");
    raw.peer.echoes = true;
    raw.write_http3(0, &format!("headers {GET}"), true);
    raw.connection().close(now);
    raw.forget();
    raw.write_http3(4, &format!("headers {GET}"), true);
    assert_eq!(raw.frames(), "reset_stream 4 0x10b 0");
    raw.send("ack");
    assert_eq!(raw.events(), "closed: Local");
}

#[test]
fn early_requests() {
    let mut raw = Raw::http3(Client).connected();
    let ticket = raw.peer_ticket();
    for (changes, events) in [
        (false, format!("ready, 0 opened, 0 Head {GET}, 0 fin -")),
        (true, String::new()),
    ] {
        raw = raw.again().http3_config(|it| it.datagrams = changes);
        raw.ticket.clone_from(&ticket);
        raw.forget();
        raw.start(&[]);
        let request = show_hex(&http3(&format!("headers {GET}")));
        raw.send_in(
            Kind::Early,
            &format!("stream 2 0 #000400, fin 0 0 {request}"),
        );
        assert_eq!(raw.events(), events);
        let info = raw.connection().stream_info(FIRST);
        assert_eq!(info.is_some_and(|it| it.has_early_data), !changes);
        let settings = if changes {
            ""
        } else {
            "settings 0x1=4096 0x7=100 0x21=0"
        };
        assert_eq!(raw.read_control(), settings);
    }

    let mut raw = Raw::http3(Server)
        .config(|it| it.wants_tickets = true)
        .connected();
    raw.send("crypto 0 #040000030001aa");
    let ticket = raw.peer.tickets.pop().unwrap();
    let mut raw = raw.again();
    raw.accepts_early_data = true;
    raw.start(&ticket);
    raw.request(GET);
    assert_eq!(raw.read_control(), "settings 0x1=4096 0x7=100 0x21=0");
    assert_eq!(raw.read_http3(0), format!("headers {GET}"));
    raw.shake_hands();
    raw.confirm();
    assert_eq!(raw.read_control(), "");
    raw.forget();
    raw.write_http3(0, &format!("headers {OK}"), true);
    assert_eq!(raw.events(), format!("0 Head {OK}, 0 fin -, 0 closed"));
}
