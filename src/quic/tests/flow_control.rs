use bun_quic::Direction::{Bidirectional, Unidirectional};
use bun_quic::Layer::Transport;
use bun_quic::Side::Server;
use bun_quic::StreamId;
use bun_quic::transport_code::FLOW_CONTROL_ERROR;

use crate::harness::messages::GET;
use crate::harness::raw::{RTT, Raw};
use crate::harness::wire::{MAX, filler};

/// `streams` is for the bidirectional streams of the peer that is tested, for ours, and for unidirectional ones.
fn with_windows(raw: Raw, connection: u64, streams: [u64; 3]) -> Raw {
    let raw = raw.config(|it| {
        it.parameters.initial_max_data = connection;
        it.parameters.initial_max_stream_data_bidi_local = streams[0];
        it.parameters.initial_max_stream_data_bidi_remote = streams[1];
        it.parameters.initial_max_stream_data_uni = streams[2];
    });
    raw.connected()
}

#[test]
fn takes_as_much_as_it_has_allowed() {
    for side in [0, 1] {
        for (id, limit) in [(1 - side, 10), (side, 20), (2 | side, 30)] {
            for (end, error) in [(limit, None), (limit + 1, Some(FLOW_CONTROL_ERROR))] {
                for frame in [
                    format!("stream {id} {end} -"),
                    format!("fin {id} {end} -"),
                    format!("reset_stream {id} 0 {end}"),
                ] {
                    let raw = [Raw::client, Raw::server][side]();
                    let mut raw = with_windows(raw, 1000, [10, 20, 30]);
                    raw.peer.open(Bidirectional);
                    raw.send(&frame);
                    assert_eq!(raw.error(), error.map(|it| (Transport, it)));
                }
            }
        }
    }
    for (frames, is_allowed) in [
        (
            "stream 0 60 -, stream 0 60 -, stream 4 40 -, stream 8 0 -",
            true,
        ),
        ("stream 0 60 -, stream 4 40 a", false),
        ("stream 0 60 -, reset_stream 2 0 41", false),
    ] {
        let mut raw = with_windows(Raw::client(), 100, [100; 3]);
        raw.send(frames);
        let error = (!is_allowed).then_some((Transport, FLOW_CONTROL_ERROR));
        assert_eq!(raw.error(), error);
    }
}

#[test]
fn gives_credit_for_what_has_been_read() {
    let mut raw = with_windows(Raw::client(), 1000, [0, 100, 0]);
    for (frames, expected) in [
        ("stream 0 0 *10", ""),
        ("stream 0 20 *80", ""),
        ("stream 0 10 *10", "max_stream_data 0 200"),
        ("stream 0 0 *100", ""),
        ("stream 0 100 *100", "max_stream_data 0 300"),
        ("fin 0 200 *100", ""),
        ("fin 4 0 *100, fin 8 0 *100, fin 12 0 *100", "max_data 1600"),
    ] {
        raw.send(frames);
        assert_eq!(raw.frames(), expected);
    }
}

#[test]
fn gives_credit_for_what_is_discarded() {
    let mut raw = with_windows(Raw::client(), 100, [0, 100, 0]);
    raw.send("stream 0 10 *10, reset_stream 0 0 60");
    assert_eq!(raw.frames(), "max_data 160");
    raw.send("stream 4 10 *60");
    raw.connection().stop(StreamId(4), 0);
    assert_eq!(raw.frames(), "max_data 230, stop_sending 4 0x0");
    raw.send("ack, stream 8 0 -");
    raw.connection().stop(StreamId(8), 0);
    raw.forget();
    raw.send("stream 8 0 *90");
    assert_eq!(raw.frames(), "max_data 320");
}

#[test]
fn gives_no_credit_while_paused() {
    let mut raw = with_windows(Raw::client(), 100, [0, 100, 0]);
    raw.send("stream 0 0 -");
    raw.connection().set_paused(StreamId(0), true);
    raw.send("stream 0 0 *100");
    assert_eq!(raw.frames(), "");
    raw.connection().set_paused(StreamId(0), false);
    assert_eq!(raw.frames(), "max_data 200, max_stream_data 0 200");
}

#[test]
fn gives_credit_for_what_has_been_consumed() {
    let raw = Raw::client().config(|it| it.awaits_consumption = true);
    let mut raw = with_windows(raw, 100, [0, 100, 100]);
    raw.send("stream 0 0 *100");
    raw.connection().consume(StreamId(0), 10);
    assert_eq!(raw.frames(), "");
    raw.connection().consume(StreamId(0), 60);
    assert_eq!(raw.frames(), "max_data 170, max_stream_data 0 170");
    raw.send("fin 0 100 *70");
    assert_eq!(raw.frames(), "");
    raw.connection().consume(StreamId(0), 1000);
    assert_eq!(raw.frames(), "max_data 270");

    for (id, limit) in [(4, 370), (8, 470), (12, 570)] {
        raw.send(&format!("ack, stream {id} 0 *100"));
        assert_eq!(raw.frames(), "");
        match id {
            4 => raw.connection().stop(StreamId(id), 0),
            8 => raw.send("reset_stream 8 0 100"),
            _ => {
                raw.send("fin 12 100 -");
                raw.connection().finish(StreamId(id));
            }
        }
        assert!(raw.frames().starts_with(&format!("max_data {limit}")));
    }
}

#[test]
fn gives_credit_again_if_it_is_lost() {
    let mut raw = with_windows(Raw::client(), 100, [0, 100, 0]);
    raw.send("stream 0 0 *100");
    assert_eq!(raw.lose(), "max_data 200, max_stream_data 0 200");
    raw.forget();
    raw.wait();
    assert_eq!(raw.lose(), "max_data 200, max_stream_data 0 200, ping");
    raw.send("fin 0 100 -");
    raw.advance(25);
    raw.forget();
    raw.wait();
    assert_eq!(raw.frames(), "max_data 200, ping");
}

#[test]
fn gives_no_more_credit_than_can_be_encoded() {
    let mut raw = with_windows(Raw::client(), MAX - 10, [0, MAX, 0]);
    raw.send(&format!("reset_stream 0 0 {}", MAX - 10));
    assert_eq!(raw.frames(), format!("max_data {MAX}"));
    raw.send("reset_stream 4 0 10");
    assert_eq!(raw.frames(), "");
}

#[test]
fn sends_as_much_as_a_stream_allows() {
    let limits = "max_stream_data_bidi_local=1 max_stream_data_bidi_remote=2 max_stream_data_uni=3";
    for raw in Raw::both() {
        let mut raw = raw.config(|it| it.parameters.initial_max_stream_data_bidi_remote = 1);
        raw = raw.with(limits).connected();
        let ours = raw.side as u64;
        raw.send(&format!("stream {ours} 0 -"));
        let theirs = [Bidirectional, Unidirectional].map(|it| raw.peer.open(it));
        for (id, limit) in [(ours, 1), (theirs[0], 2), (theirs[1], 3)] {
            let written = raw.connection().write(StreamId(id), b"abcd");
            assert_eq!(written, Some(limit));
            let data = &"abcd"[..limit];
            let expected = format!("stream_data_blocked {id} {limit}, stream {id} 0 {data}");
            assert_eq!(raw.frames(), expected);
        }
    }
}

#[test]
fn goes_on_when_a_stream_allows_more() {
    let mut raw = Raw::server().with("max_stream_data_uni=2").connected();
    raw.peer.open(Unidirectional);
    raw.peer.send(2, b"abcdef", true);
    assert_eq!(raw.frames(), "stream_data_blocked 2 2, stream 2 0 ab");
    assert_eq!(raw.connection().write(StreamId(2), b"c"), Some(0));
    raw.send("ack, max_stream_data 2 2, max_stream_data 2 1, max_data 20000000");
    assert_eq!((raw.frames(), raw.events()), Default::default());
    raw.send("max_stream_data 2 4");
    assert_eq!(raw.frames(), "stream_data_blocked 2 4, stream 2 2 cd");
    raw.send("max_stream_data 2 6");
    assert_eq!(raw.frames(), "fin 2 4 ef");
    assert_eq!(raw.events(), "2 writable, 2 writable, 2 closed");
}

#[test]
fn goes_on_when_the_connection_allows_more() {
    let mut raw = Raw::server().with("max_data=3").connected();
    for id in [2, 6] {
        raw.peer.open(Unidirectional);
        raw.peer.send(id, b"ab", true);
    }
    assert_eq!(raw.frames(), "data_blocked 3, fin 2 0 ab, stream 6 0 a");
    raw.send("ack, max_data 3, max_data 2, max_stream_data 6 2000000");
    assert_eq!(raw.frames(), "");
    assert_eq!(raw.events(), "2 closed");
    raw.send("max_data 4");
    assert_eq!(raw.frames(), "fin 6 1 b");
    assert_eq!(raw.events(), "6 writable, 6 closed");
}

#[test]
fn says_that_it_is_blocked_when_there_is_more_to_write() {
    let mut raw = Raw::server().with("max_stream_data_uni=0").connected();
    raw.peer.open(Unidirectional);
    assert_eq!(raw.connection().write(StreamId(2), b""), Some(0));
    assert_eq!(raw.frames(), "");
    raw.connection().want_write(StreamId(2));
    assert_eq!(raw.frames(), "stream_data_blocked 2 0");
    assert_eq!(raw.events(), "");
}

#[test]
fn says_it_again_while_it_holds() {
    for (limit, blocked, raise) in [
        ("max_data=0", "data_blocked 0", "max_data 1"),
        (
            "max_stream_data_uni=0",
            "stream_data_blocked 2 0",
            "max_stream_data 2 1",
        ),
    ] {
        let mut raw = Raw::server().with(limit).connected();
        raw.peer.open(Unidirectional);
        raw.peer.send(2, b"a", false);
        assert_eq!(raw.lose(), blocked);
        raw.wait();
        assert_eq!(raw.frames(), format!("{blocked}, ping"));
        for _ in 0..2 {
            raw.send("ack");
            assert_eq!(raw.wait(), 8000);
            assert_eq!(raw.frames(), blocked);
        }
        raw.send(raise);
        raw.forget();
        raw.wait();
        assert_eq!(raw.frames(), "stream 2 0 a, ping");
        raw.send("ack");
        raw.advance(9000);
        assert_eq!(raw.frames(), "");
    }
}

#[test]
fn a_stream_that_has_ended_is_not_blocked() {
    for (ends, expected) in [("finish", "fin 2 0 -"), ("reset", "reset_stream 2 0x0 0")] {
        let mut raw = Raw::server().with("max_stream_data_uni=0").connected();
        let id = StreamId(raw.peer.open(Bidirectional) + raw.peer.open(Unidirectional));
        raw.connection().write(id, b"a");
        raw.forget();
        raw.send("ack");
        match ends {
            "finish" => raw.connection().finish(id),
            _ => raw.connection().reset(id, 0),
        }
        assert_eq!(raw.frames(), expected);
        raw.advance(9000);
        let packets = raw.take();
        let mut frames = packets.iter().flat_map(|it| &it.frames);
        assert!(frames.all(|it| it == expected || it == "ping"));
    }
}

#[test]
fn takes_little_more_than_it_can_send() {
    let mut raw = Raw::server().connected();
    let ids = [(); 2].map(|()| StreamId(raw.peer.open(Unidirectional)));
    let data = filler(0, 500_000);
    let window = raw.connection().stats().congestion_window as usize;
    let written = raw.connection().write(ids[0], &data);
    assert_eq!(written, Some(window + 65536));
    assert_eq!(raw.connection().write(ids[0], &data), Some(0));
    assert_eq!(raw.connection().write(ids[1], &data), Some(4096));
    assert_eq!(raw.connection().write(ids[1], &data), Some(0));
    assert_eq!(raw.events(), "");
    raw.advance(RTT);
    raw.send("ack");
    raw.advance(RTT);
    assert_eq!(raw.events(), "2 writable, 6 writable");
}

#[test]
fn credit_for_a_stream_that_is_gone() {
    let mut raw = Raw::http3(Server).with("max_data=4096").connected_with("");
    let id = raw.request(&format!("{GET} a=*9000"));
    assert!(raw.frames().ends_with("data_blocked 4096"));
    raw.connection().reset(StreamId(id), 1);
    raw.connection().stop(StreamId(id), 1);
    raw.forget();
    raw.send("ack, reset_stream 0 1 0");
    raw.send("max_data 8192");
    assert_eq!(raw.read_decoder(), "cancel 0");
}
