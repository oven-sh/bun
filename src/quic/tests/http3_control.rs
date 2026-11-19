use bun_quic::Direction::{Bidirectional, Unidirectional};
use bun_quic::Side::{self, Client, Server};
use bun_quic::http3_code::*;
use bun_quic::{Layer, StreamId, transport_code};

use crate::harness::messages::{GET, OK};
use crate::harness::raw::Raw;
use crate::harness::wire::{bytes, http3, show_hex};

const BOTH: &[Side] = &[Client, Server];

#[test]
fn error_codes() {
    let codes = [
        NO_ERROR,
        GENERAL_PROTOCOL_ERROR,
        INTERNAL_ERROR,
        STREAM_CREATION_ERROR,
        CLOSED_CRITICAL_STREAM,
        FRAME_UNEXPECTED,
        FRAME_ERROR,
        EXCESSIVE_LOAD,
        ID_ERROR,
        SETTINGS_ERROR,
        MISSING_SETTINGS,
        REQUEST_REJECTED,
        REQUEST_CANCELLED,
        REQUEST_INCOMPLETE,
        MESSAGE_ERROR,
    ];
    assert!(codes.into_iter().eq(0x100..0x10f));
}

#[test]
fn opens_the_control_and_qpack_streams() {
    for &side in BOTH {
        let mut raw = Raw::http3(side).connected();
        let types = [2, 6, 10].map(|id| raw.streams[&(id | !side as u64)][0]);
        assert_eq!(types, [0, 3, 2]);
        assert_eq!(raw.read_control(), "settings 0x1=4096 0x7=100");

        let raw = Raw::http3(side).http3_config(|it| {
            it.advertises_max_field_section_size = true;
            (it.connect_protocol, it.datagrams) = (true, true);
            it.origins = b"abc".to_vec();
        });
        let origin = [", origin abc", ""][side as usize];
        assert_eq!(
            raw.connected().read_control(),
            format!("settings 0x6=1000 0x1=4096 0x7=100 0x8=1 0x33=1{origin}")
        );
    }
}

#[test]
fn needs_room_for_them_and_for_a_message() {
    let invalid = Some((Layer::Transport, transport_code::TRANSPORT_PARAMETER_ERROR));
    for (sides, parameter, error) in [
        (BOTH, "max_streams_uni=3", None),
        (BOTH, "max_data=4096", None),
        (BOTH, "max_data=4095", invalid),
        (&[Client], "max_stream_data_bidi_local=4096", None),
        (&[Client], "max_stream_data_bidi_local=4095", invalid),
        (&[Client], "max_stream_data_bidi_remote=0", None),
        (&[Server], "max_stream_data_bidi_remote=4096", None),
        (&[Server], "max_stream_data_bidi_remote=4095", invalid),
        (&[Server], "max_stream_data_bidi_local=0", None),
    ] {
        for &side in sides {
            let mut raw = Raw::http3(side).with(parameter);
            raw.start(&[]);
            if raw.error().is_none() {
                raw.shake_hands();
            }
            assert_eq!(raw.error(), error, "{parameter}");
        }
    }
    for (side, count) in [(Client, 0), (Client, 1), (Client, 2), (Server, 2)] {
        let mut raw = Raw::http3(side).with(&format!("max_streams_uni={count}"));
        raw.start(&[]);
        raw.shake_hands();
        assert_eq!(raw.http3_error(), Some(GENERAL_PROTOCOL_ERROR));
    }
}

#[test]
fn settings_of_the_peer() {
    for &side in BOTH {
        let mut raw = Raw::http3(side).connected();
        assert_eq!(raw.connection().peer_accepts_http3_datagrams(), None);
        for (settings, accepts) in [
            ("", false),
            ("0x33=0", false),
            ("0x33=1", true),
            ("1=0 6=100 7=0 8=1 0x33=1", true),
            ("9=2 0x21=2 0x21=3 0x40=1 0x73=1 8=0", false),
            ("0x21=0 0x33=1", true),
        ] {
            let mut raw = Raw::http3(side).connected_with(settings);
            let accepted = raw.connection().peer_accepts_http3_datagrams();
            assert_eq!(accepted, Some(accepts), "{settings}");
        }
    }
    let mut raw = Raw::client().connected();
    assert_eq!(raw.connection().peer_accepts_http3_datagrams(), None);
    assert_eq!(raw.connection().peer_go_away(), None);
}

#[test]
fn errors_at_the_start_of_the_control_stream() {
    for (frame, code) in [
        ("goaway 0", MISSING_SETTINGS),
        ("data a", MISSING_SETTINGS),
        ("max_push_id 1", MISSING_SETTINGS),
        ("0x21", MISSING_SETTINGS),
        ("settings 0=1", SETTINGS_ERROR),
        ("settings 2=1", SETTINGS_ERROR),
        ("settings 3=1", SETTINGS_ERROR),
        ("settings 4=1", SETTINGS_ERROR),
        ("settings 5=1", SETTINGS_ERROR),
        ("settings 8=2", SETTINGS_ERROR),
        ("settings 0x33=2", SETTINGS_ERROR),
        ("settings 1=0 1=0", SETTINGS_ERROR),
        ("settings 6=1 7=0 6=1", SETTINGS_ERROR),
        ("settings 7=0 7=0", SETTINGS_ERROR),
        ("settings 8=0 8=0", SETTINGS_ERROR),
        ("settings 0x33=0 0x33=1", SETTINGS_ERROR),
        ("settings #01", FRAME_ERROR),
        ("settings #0140, goaway 0", FRAME_ERROR),
        ("settings #40, goaway 0", FRAME_ERROR),
    ] {
        for &side in BOTH {
            let mut raw = Raw::http3(side).connected();
            raw.write_control(&format!("#00, {frame}"));
            assert_eq!(raw.http3_error(), Some(code), "{frame}");
        }
    }
}

#[test]
fn errors_on_the_control_stream() {
    for (sides, frames, code) in [
        (BOTH, "settings", FRAME_UNEXPECTED),
        (BOTH, "data", FRAME_UNEXPECTED),
        (BOTH, "headers a=b", FRAME_UNEXPECTED),
        (BOTH, "push_promise 0", FRAME_UNEXPECTED),
        (BOTH, "0x02", FRAME_UNEXPECTED),
        (BOTH, "0x06", FRAME_UNEXPECTED),
        (BOTH, "0x08", FRAME_UNEXPECTED),
        (BOTH, "0x09", FRAME_UNEXPECTED),
        (BOTH, "goaway", FRAME_ERROR),
        (BOTH, "goaway 0 0", FRAME_ERROR),
        (BOTH, "goaway #40, goaway 0", FRAME_ERROR),
        (BOTH, "#0709", FRAME_ERROR),
        (BOTH, "cancel_push 0", ID_ERROR),
        (BOTH, "cancel_push 0 0", FRAME_ERROR),
        (BOTH, "#0309", FRAME_ERROR),
        (&[Client], "max_push_id 5, cancel_push 5", ID_ERROR),
        (&[Client], "max_push_id 5, max_push_id 4", ID_ERROR),
        (&[Client], "max_push_id 5 5", FRAME_ERROR),
        (&[Client], "#0d09", FRAME_ERROR),
        (&[Server], "max_push_id 5", FRAME_UNEXPECTED),
        (&[Server], "goaway 1", ID_ERROR),
        (&[Server], "goaway 2", ID_ERROR),
        (&[Server], "goaway 3", ID_ERROR),
        (&[Server], "goaway 4, goaway 8", ID_ERROR),
    ] {
        for &side in sides {
            let mut raw = Raw::http3(side).connected_with("");
            raw.write_control(frames);
            assert_eq!(raw.http3_error(), Some(code), "{frames}");
        }
    }
}

#[test]
fn control_frames_without_consequences() {
    for (sides, frames) in [
        (BOTH, "0x21, 0x0a abc, 0x3ffffffffffffffe *2000"),
        (BOTH, "priority_update 1 u=1, priority_update_push 1 u=1"),
        (&[Client], "max_push_id 0, max_push_id 5, max_push_id 5"),
        (&[Client], "max_push_id #c000000000000001"),
        (&[Client], "goaway 7, goaway 0"),
        (&[Client], "origin abc"),
    ] {
        for &side in sides {
            let mut raw = Raw::http3(side).connected_with("");
            raw.write_control(frames);
            assert_eq!((raw.events(), raw.frames()), Default::default(), "{frames}");
            assert_eq!(raw.connection().peer_go_away(), None);
            raw.write_control("cancel_push 0");
            assert_eq!(raw.http3_error(), Some(ID_ERROR), "{frames}");
        }
    }
}

#[test]
fn every_split_of_the_control_stream() {
    let frames = "#4000, settings 0x33=1 0x21=70000, 0x40000000 abc, origin abc, origin, \
                  goaway #8000000c, goaway 4";
    let stream = http3(frames);
    let frame = |at: usize, end| format!("stream 3 {at} {}", show_hex(&stream[at..end]));
    let bytes = (0..stream.len()).map(|at| frame(at, at + 1));
    let halves = (1..stream.len()).map(|at| vec![frame(0, at), frame(at, stream.len())]);
    for mut packets in halves.chain([bytes.collect()]) {
        for _ in 0..2 {
            let mut raw = Raw::http3(Server).connected();
            packets.iter().for_each(|it| raw.send(it));
            assert_eq!(raw.events(), "origin abc, origin -, go away");
            assert_eq!(raw.connection().peer_go_away(), Some(StreamId(4)));
            assert_eq!(raw.connection().peer_accepts_http3_datagrams(), Some(true));
            packets.reverse();
        }
    }
}

#[test]
fn types_of_streams() {
    for (sides, start, code) in [
        (BOTH, "#00", STREAM_CREATION_ERROR),
        (BOTH, "#02", STREAM_CREATION_ERROR),
        (BOTH, "#4003", STREAM_CREATION_ERROR),
        (&[Client], "#01", STREAM_CREATION_ERROR),
        (&[Server], "#01", ID_ERROR),
    ] {
        for &side in sides {
            let raw = Raw::http3(side).config(|it| it.parameters.initial_max_streams_uni = 4);
            let mut raw = raw.connected_with("");
            raw.write(raw.unidirectional(3), &bytes(start), false);
            assert_eq!(raw.http3_error(), Some(code), "{start}");
        }
    }
    for frame in ["stream 1 0 a", "max_stream_data 1 1"] {
        let mut raw = Raw::http3(Server).connected_with("");
        raw.send(frame);
        assert_eq!(raw.http3_error(), Some(STREAM_CREATION_ERROR));
    }
}

#[test]
fn streams_of_unknown_type_are_not_read() {
    const STOP: &str = "stop_sending 14 0x103";
    const MORE: &str = "max_streams_uni ";
    for steps in [
        &[
            ("stream 14 0 #21", STOP),
            ("stream 14 1 a", ""),
            ("fin 14 2 a", MORE),
        ][..],
        &[("stream 14 0 #04", STOP), ("reset_stream 14 0 9", MORE)],
        &[("stream 14 0 #40", ""), ("fin 14 1 #54", MORE)],
        &[
            ("stream 14 1 #00", ""),
            ("stream 14 0 #41", STOP),
            ("fin 14 2 -", MORE),
        ],
        &[("fin 14 0 #ffffffffffffffff", MORE)],
        &[("fin 14 0 -", MORE)],
        &[("fin 14 0 #40", MORE)],
        &[("stream 14 0 #40", ""), ("reset_stream 14 0 1", MORE)],
        &[("reset_stream 14 0 0", MORE)],
    ] {
        let raw = Raw::http3(Client).config(|it| it.parameters.initial_max_streams_uni = 4);
        let mut raw = raw.connected_with("");
        for (frame, answer) in steps {
            raw.send(frame);
            let frames = raw.frames();
            let is_more = *answer == MORE && frames.starts_with(MORE);
            assert!(is_more || frames == *answer, "{frame}: {frames}");
        }
        assert_eq!(raw.events(), "");
    }
}

#[test]
fn critical_streams_stay_open() {
    for &side in BOTH {
        for index in 0..3 {
            let (ours, theirs) = (index << 2 | 2 | side as u64, index << 2 | 2 | !side as u64);
            let len = [3, 1, 1][index as usize];
            for frame in [
                format!("fin {ours} {len} -"),
                format!("reset_stream {ours} 0x100 {len}"),
                format!("stop_sending {theirs} 0x100"),
            ] {
                let mut raw = Raw::http3(side).connected_with("");
                raw.send(&frame);
                assert_eq!(raw.http3_error(), Some(CLOSED_CRITICAL_STREAM), "{frame}");
            }
        }
    }
}

#[test]
fn they_are_out_of_the_reach_of_the_application() {
    let mut raw = Raw::http3(Client).connected_with("");
    for id in [2, 3].map(StreamId) {
        assert_eq!(raw.connection().write(id, b"a"), None);
        assert!(!raw.peer.send_headers(id.0, OK));
        raw.connection().finish(id);
        raw.connection().reset(id, 1);
        raw.connection().stop(id, 1);
    }
    assert_eq!((raw.events(), raw.frames()), Default::default());
}

#[test]
fn control_frames_are_consumed() {
    let mut raw = Raw::http3(Client).connected_with("");
    raw.write_control("0x21 *8000");
    assert!(raw.frames().starts_with("max_stream_data 2 "));
}

#[test]
fn a_client_gives_up_on_requests_that_are_not_going_to_be_processed() {
    let mut raw = Raw::http3(Server).connected_with("");
    let ids = [(); 5].map(|()| raw.request(GET));
    assert_eq!(ids, [0, 4, 8, 12, 16]);
    raw.send("reset_stream 4 0x10b 0");
    raw.write_http3(12, "#01", false);
    raw.forget();
    raw.write_control("goaway 0x3ffffffffffffffc");
    assert_eq!(raw.events(), "go away");
    assert_eq!(raw.connection().available_streams(Bidirectional), 0);
    assert_eq!(raw.connection().available_streams(Unidirectional), 97);
    raw.write_control("goaway 20, goaway 20, goaway 4");
    assert_eq!(
        raw.events(),
        "8 reset 0x10b, 16 reset 0x10b, 8 closed, 16 closed"
    );
    let len = raw.streams[&8].len();
    let resets = |id| format!("reset_stream {id} 0x10c {len}, stop_sending {id} 0x10c");
    let frames = format!("{}, {}, stream 6 ", resets(8), resets(16));
    assert!(raw.frames().starts_with(&frames));
    assert_eq!(raw.read_decoder(), "cancel 4, cancel 8, cancel 16");
    raw.write_http3(0, &format!("headers {OK}"), true);
    assert_eq!(raw.events(), format!("0 Head {OK}, 0 fin -, 0 closed"));
}

#[test]
fn a_server_goes_away_after_the_last_response() {
    let mut raw = Raw::http3(Client).connected_with("");
    raw.read_control();
    raw.write_http3(4, &format!("headers {GET}"), true);
    raw.connection().go_away();
    raw.connection().go_away();
    assert_eq!(raw.read_control(), "goaway 8");
    raw.forget();
    raw.write_http3(8, &format!("headers {GET}"), false);
    assert_eq!(raw.events(), "");
    let frames = "reset_stream 8 0x10b 0, stop_sending 8 0x10b";
    assert_eq!(raw.frames(), frames);
    raw.send("reset_stream 8 0x10c 99, ack");
    assert!(raw.peer.send_headers(4, OK));
    raw.connection().finish(StreamId(4));
    assert_eq!(raw.frames(), "fin 4 0 #01030000d9");
    raw.send("ack");
    assert_eq!(raw.frames(), "");
    raw.write_http3(0, &format!("headers {GET}"), true);
    assert_eq!(raw.frames(), "reset_stream 0 0x10b 0");
    raw.send("ack");
    assert_eq!(raw.frames(), "application_close 0x100");
    assert_eq!(raw.events(), "4 closed, closed: Local");
}

#[test]
fn a_server_that_goes_away_rejects_requests_that_it_has_not_seen() {
    let mut raw = Raw::http3(Client).connected_with("");
    raw.write_http3(0, &format!("headers {GET}"), false);
    raw.write_http3(4, "#01", false);
    raw.write_http3(8, "#01", false);
    raw.send("reset_stream 8 0x10c 1");
    raw.forget();
    raw.connection().go_away();
    assert_eq!(raw.events(), "4 reset 0x10b, 4 closed");
    let frames = "reset_stream 4 0x10b 0, stop_sending 4 0x10b, ";
    assert!(raw.frames().starts_with(frames));
    assert_eq!(raw.read_decoder(), "cancel 8, cancel 4");
}

#[test]
fn a_server_that_goes_away_allows_no_more_requests() {
    let raw = Raw::http3(Client).config(|it| it.parameters.initial_max_streams_bidi = 2);
    let mut raw = raw.connected_with("");
    raw.write_http3(0, &format!("headers {GET}"), true);
    raw.write_http3(4, &format!("headers {GET}"), true);
    raw.forget();
    raw.peer.polls = false;
    raw.connection().reset(StreamId(0), 1);
    while raw.peer.poll(raw.now) {}
    raw.connection().go_away();
    assert!(raw.frames().starts_with("max_streams_bidi 2, "));
}

/// RFC 9114 §4.1.1.
#[test]
fn request_that_is_rejected_is_cancelled() {
    for (stop, reset) in [(0x10b, 0x10c), (0x100, 0x100)] {
        let mut raw = Raw::http3(Server).connected_with("");
        let id = raw.peer.open(Bidirectional);
        raw.send(&format!("stop_sending {id} {stop}"));
        assert_eq!(raw.events(), format!("0 stopped {stop:#x}"));
        assert_eq!(raw.frames(), format!("reset_stream 0 {reset:#x} 0"));
    }
    let mut raw = Raw::server().connected();
    raw.peer.open(Bidirectional);
    raw.send("stop_sending 0 0x10b");
    assert_eq!(raw.frames(), "reset_stream 0 0x10b 0");
}

#[test]
fn a_client_that_goes_away_keeps_the_connection() {
    let mut raw = Raw::http3(Server).connected_with("");
    raw.read_control();
    raw.connection().go_away();
    assert_eq!(raw.read_control(), "goaway 0");
    raw.send("ack");
    raw.advance(1000);
    assert_eq!(raw.events(), "");
}

#[test]
fn nothing_goes_away_without_http3_or_after_the_end() {
    let mut raw = Raw::client().connected();
    raw.connection().go_away();
    raw.send("stream 0 0 a");
    assert_eq!(raw.events(), "0 opened, 0 data a");
    assert!(!raw.peer.send_headers(0, OK));

    let mut raw = Raw::http3(Client).connected_with("");
    let now = raw.now;
    raw.connection().close(now);
    raw.connection().go_away();
    assert_eq!(raw.frames(), "application_close 0x100");

    let mut raw = Raw::http3(Client).exchange();
    raw.peer.polls = false;
    raw.send("application_close 0x100 -");
    assert!(!raw.peer.send_headers(0, OK));
}
