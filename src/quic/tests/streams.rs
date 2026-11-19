use bun_quic::Direction::{Bidirectional, Unidirectional};
use bun_quic::Layer::Transport;
use bun_quic::StreamId;
use bun_quic::transport_code::*;

use crate::harness::crypto::Random;
use crate::harness::priority;
use crate::harness::raw::Kind::Initial;
use crate::harness::raw::{RTT, Raw};
use crate::harness::wire::{MAX, filler, groups};

fn context(number: usize) -> bun_quic::Context {
    std::ptr::without_provenance_mut(number)
}

#[test]
fn opens_as_many_as_the_peer_allows() {
    for raw in Raw::both() {
        let mut raw = raw.with("max_streams_bidi=2 max_streams_uni=1").connected();
        let first = !raw.side as u64;
        let available = |raw: &mut Raw| {
            [Bidirectional, Unidirectional].map(|it| raw.connection().available_streams(it))
        };
        assert_eq!(available(&mut raw), [2, 1]);
        let ids = [Bidirectional, Unidirectional, Bidirectional].map(|it| raw.peer.open(it));
        assert_eq!(ids, [first, first + 2, first + 4]);
        assert_eq!(available(&mut raw), [0, 0]);
        assert_eq!(raw.connection().open(Bidirectional, context(0)), None);
        raw.send("max_streams_bidi 2, max_streams_uni 0");
        assert_eq!(raw.events(), "");
        raw.send("max_streams_bidi 3, max_streams_bidi 5, max_streams_uni 2");
        let events = "available Bidirectional, available Unidirectional";
        assert_eq!(raw.events(), events);
        assert_eq!(available(&mut raw), [3, 1]);
        assert_eq!(raw.peer.open(Unidirectional), first + 6);
    }
}

#[test]
fn opens_none_before_the_handshake_is_complete_or_while_closing() {
    let mut raw = Raw::server();
    raw.start(&[]);
    raw.send_in(Initial, "ack, hello");
    assert_eq!(raw.connection().open(Bidirectional, context(0)), None);
    let mut raw = Raw::server().connected();
    let now = raw.now;
    raw.connection().close(now);
    assert_eq!(raw.connection().open(Bidirectional, context(0)), None);
}

#[test]
fn life_of_a_bidirectional_stream() {
    let mut raw = Raw::client().connected();
    let has_unacked_data = |raw: &mut Raw| {
        let info = raw.connection().stream_info(StreamId(0));
        info.map(|it| it.has_unacked_data)
    };
    assert_eq!(has_unacked_data(&mut raw), None);
    raw.send("stream 0 0 -");
    assert_eq!(raw.events(), "0 opened");
    raw.send("fin 0 0 question");
    assert_eq!(raw.events(), "0 fin question");
    assert_eq!(has_unacked_data(&mut raw), Some(false));
    raw.peer.send(0, b"ans", false);
    assert_eq!(raw.frames(), "stream 0 0 ans");
    assert_eq!(has_unacked_data(&mut raw), Some(true));
    raw.send("ack");
    assert_eq!(has_unacked_data(&mut raw), Some(false));
    raw.peer.send(0, b"wer", false);
    assert_eq!(raw.frames(), "stream 0 3 wer");
    raw.send("ack");
    raw.connection().finish(StreamId(0));
    raw.connection().finish(StreamId(0));
    assert_eq!(raw.connection().write(StreamId(0), b"more"), None);
    assert_eq!(raw.frames(), "fin 0 6 -");
    assert_eq!(raw.events(), "0 closed");
    assert_eq!(has_unacked_data(&mut raw), Some(true));
    raw.send("ack");
    assert_eq!(has_unacked_data(&mut raw), None);
    raw.send("fin 0 0 question, reset_stream 0 1 8, stop_sending 0 1");
    raw.send("max_stream_data 0 1, stream_data_blocked 0 1");
    assert_eq!((raw.frames(), raw.events()), Default::default());
}

#[test]
fn life_of_a_unidirectional_stream() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        let (ours, theirs) = (raw.unidirectional(0), raw.peer.open(Unidirectional));
        raw.peer.send(theirs, b"to", true);
        assert_eq!(raw.frames(), format!("fin {theirs} 0 to"));
        assert_eq!(raw.events(), format!("{theirs} closed"));
        raw.send(&format!("ack, stream {ours} 0 fro"));
        assert_eq!(raw.connection().write(StreamId(ours), b"no"), None);
        raw.connection().want_write(StreamId(ours));
        raw.send(&format!("fin {ours} 3 -"));
        let events = format!("{ours} opened, {ours} data fro, {ours} fin -, {ours} closed");
        assert_eq!(raw.events(), events);
        assert_eq!(raw.frames(), "max_streams_uni 4");
    }
}

#[test]
fn streams_can_be_used_in_any_order() {
    let mut raw = Raw::client().connected();
    raw.send("stream 16 0 e");
    raw.send("max_stream_data 4 1, stream_data_blocked 12 1, stream 0 0 a, stream 8 0 c");
    raw.send("stream 4 0 b, stream 396 0 z");
    assert_eq!(
        raw.events(),
        "16 opened, 16 data e, 4 opened, 12 opened, 0 opened, 8 opened, 0 data a, 8 data c, \
         396 opened, 4 data b, 396 data z"
    );
}

#[test]
fn delivers_in_order() {
    let mut raw = Raw::client().connected();
    for (frames, events) in [
        ("stream 0 4 ef", "0 opened"),
        ("stream 0 8 ij, stream 0 8 i, stream 0 9 -", ""),
        ("stream 0 0 ab", "0 data ab"),
        ("stream 0 0 a, stream 0 0 ab, stream 0 2 -", ""),
        ("stream 0 1 bcd", "0 data cdef"),
        ("fin 0 12 -", ""),
        ("stream 0 7 hijk", ""),
        ("stream 0 5 fg", "0 data ghijk"),
        ("stream 0 0 abcdefghijkl", "0 fin l"),
        ("fin 0 10 kl", ""),
    ] {
        raw.send(frames);
        assert_eq!(raw.events(), events, "{frames}");
    }
}

#[test]
fn reassembles_pieces_of_all_sizes() {
    let random = Random::new(1);
    let mut raw = Raw::client().connected();
    for id in (0..400).step_by(4) {
        let (len, max_piece) = (1 + random.below(20_000), 1 + random.below(5000));
        while !raw.peer.streams.entry(id).or_default().is_read_to_end {
            let start = random.below(len + 1);
            let end = len.min(start + 200 + random.below(max_piece));
            let start = start.saturating_sub(200);
            let name = if end == len { "fin" } else { "stream" };
            raw.send(&format!("{name} {id} {start} *{}", end - start));
        }
        assert!(raw.peer.streams[&id].received == filler(0, len as usize));
    }
}

#[test]
fn frames_for_streams_that_cannot_have_them() {
    for (name, rest, is_about_receiving) in [
        ("stream", "0 a", true),
        ("reset_stream", "0 0", true),
        ("stop_sending", "0", false),
        ("max_stream_data", "1", false),
    ] {
        for is_server in [0, 1] {
            let (ours, theirs) = (is_server, 1 - is_server);
            let wrong_way = if is_about_receiving { theirs } else { ours };
            for (id, code) in [
                (2 | wrong_way, STREAM_STATE_ERROR),
                (4 | theirs, STREAM_STATE_ERROR),
                (6 | theirs, STREAM_STATE_ERROR),
                (400 | ours, STREAM_LIMIT_ERROR),
                ((MAX - 3) | ours, STREAM_LIMIT_ERROR),
            ] {
                let mut raw = [Raw::client, Raw::server][is_server as usize]().connected();
                raw.peer.open(Bidirectional);
                raw.peer.open(Unidirectional);
                raw.send(&format!("{name} {id} {rest}"));
                assert_eq!(raw.error(), Some((Transport, code)), "{name} {id}");
            }
        }
    }
    for (frame, code) in [
        ("stream 14 0 a", STREAM_LIMIT_ERROR),
        ("reset_stream 14 0 0", STREAM_LIMIT_ERROR),
        ("stream_data_blocked 3 0", STREAM_STATE_ERROR),
    ] {
        let mut raw = Raw::client().connected();
        raw.send(frame);
        assert_eq!(raw.error(), Some((Transport, code)));
    }
}

#[test]
fn final_sizes() {
    for (frames, is_valid) in [
        ("fin 0 0 abc, fin 0 3 -, fin 0 1 bc", true),
        ("fin 0 0 abc, reset_stream 0 0 3", true),
        ("stream 0 0 abc, reset_stream 0 0 3", true),
        ("reset_stream 0 0 3, reset_stream 0 0 3", true),
        ("fin 0 0 abc, stream 0 3 d", false),
        ("fin 0 0 abc, fin 0 4 -", false),
        ("fin 0 0 abc, fin 0 2 -", false),
        ("fin 0 0 abc, reset_stream 0 0 4", false),
        ("fin 0 0 abc, reset_stream 0 0 2", false),
        ("stream 0 0 abc, reset_stream 0 0 2", false),
        ("reset_stream 0 0 3, stream 0 3 d", false),
    ] {
        let mut raw = Raw::client().connected();
        raw.send(frames);
        let error = (!is_valid).then_some((Transport, FINAL_SIZE_ERROR));
        assert_eq!(raw.error(), error, "{frames}");
    }
}

#[test]
fn allows_more_streams_as_they_are_closed() {
    let mut raw = Raw::client().connected();
    raw.peer.echoes = true;
    for id in (0..11 * 4).step_by(4) {
        raw.send(&format!("fin {id} 0 a"));
    }
    raw.forget();
    raw.send("fin 44 0 a");
    assert_eq!(raw.frames(), "max_streams_bidi 112, fin 44 0 a");
    raw.send("ack");
    assert_eq!(raw.frames(), "");
    raw.send("stream 444 0 -");
    assert_eq!(raw.error(), None);
    raw.send("stream 448 0 -");
    assert_eq!(raw.error(), Some((Transport, STREAM_LIMIT_ERROR)));

    let raw = Raw::client().config(|it| it.parameters.initial_max_streams_bidi = 2);
    let mut raw = raw.connected();
    raw.peer.echoes = true;
    for (frames, expected) in [
        ("fin 0 0 a", "max_streams_bidi 3, fin 0 0 a"),
        ("fin 4 0 a", "max_streams_bidi 4, fin 4 0 a"),
        ("fin 8 0 a", "fin 8 0 a"),
        ("ack", "max_streams_bidi 5"),
    ] {
        raw.send(frames);
        assert_eq!(raw.frames(), expected);
    }

    let most = 1 << 60;
    let raw = Raw::client().config(|it| it.parameters.initial_max_streams_uni = most);
    let mut raw = raw.connected();
    raw.send(&format!("fin 2 0 -, fin {} 0 -", MAX - 1));
    assert_eq!(raw.frames(), "");
}

#[test]
fn resets() {
    let mut raw = Raw::server().connected();
    let id = StreamId(raw.peer.open(Bidirectional));
    raw.peer.send(0, b"sent", false);
    raw.forget();
    raw.peer.send(0, b"unsent", false);
    raw.connection().reset(id, 7);
    raw.connection().reset(id, 8);
    raw.connection().finish(id);
    assert_eq!(raw.connection().write(id, b"more"), None);
    assert_eq!(raw.frames(), "reset_stream 0 0x7 4");
    raw.wait();
    assert_eq!(raw.frames(), "reset_stream 0 0x7 4, ping");
    assert!(raw.connection().stream_info(id).unwrap().has_unacked_data);
    raw.send("ack, stream 0 0 still");
    assert!(!raw.connection().stream_info(id).unwrap().has_unacked_data);
    raw.send("fin 0 5 -");
    assert_eq!(raw.events(), "0 data still, 0 fin -, 0 closed");
    assert!(raw.connection().stream_info(id).is_none());
}

#[test]
fn resets_unless_it_is_too_late() {
    type Reset = fn(&mut bun_quic::Connection, StreamId, u64);
    let (always, unfinished): (Reset, Reset) = (
        bun_quic::Connection::reset,
        bun_quic::Connection::reset_unfinished,
    );
    for (reset, finishes, is_acked, expected) in [
        (always, false, true, "reset_stream 0 0x3fffffffffffffff 1"),
        (always, true, false, "reset_stream 0 0x3fffffffffffffff 1"),
        (always, true, true, ""),
        (
            unfinished,
            false,
            false,
            "reset_stream 0 0x3fffffffffffffff 1",
        ),
        (unfinished, true, false, ""),
    ] {
        let mut raw = Raw::server().connected();
        raw.peer.open(Bidirectional);
        raw.peer.send(0, b"a", finishes);
        raw.forget();
        if is_acked {
            raw.send("ack");
        }
        reset(raw.connection(), StreamId(0), u64::MAX);
        assert_eq!(raw.frames(), expected);
    }
}

#[test]
fn is_reset_by_the_peer() {
    let mut raw = Raw::client().connected();
    raw.send("stream 0 0 a");
    raw.send("stream 0 1 b, stream 0 5 f, reset_stream 0 7 9, reset_stream 0 8 9");
    assert_eq!(raw.events(), "0 opened, 0 data a, 0 reset 0x7");
    raw.peer.send(0, b"still", true);
    assert_eq!(raw.frames(), "fin 0 0 still");
    assert_eq!(raw.events(), "0 closed");
    raw.send("reset_stream 2 7 0");
    assert_eq!(raw.events(), "2 opened, 2 reset 0x7, 2 closed");
    assert_eq!(raw.frames(), "max_streams_uni 4");
}

#[test]
fn stops_reading() {
    for end in ["reset_stream 2 7 3", "fin 2 2 c"] {
        let mut raw = Raw::client().connected();
        raw.send("stream 2 0 a");
        raw.connection().stop(StreamId(2), u64::MAX);
        raw.connection().stop(StreamId(2), 8);
        let frames = "max_streams_uni 4, stop_sending 2 0x3fffffffffffffff";
        assert_eq!(raw.frames(), frames);
        assert_eq!(raw.events(), "2 opened, 2 data a, 2 closed");
        raw.connection().stop(StreamId(2), 9);
        raw.wait();
        assert_eq!(raw.frames(), format!("{frames}, ping"));
        raw.send("stream 2 1 b");
        assert_eq!(raw.frames(), "");
        raw.send(end);
        assert_eq!((raw.frames(), raw.events()), Default::default());
        assert!(raw.connection().priority(StreamId(2)).is_none());
    }
}

#[test]
fn does_not_ask_a_peer_to_stop_that_has() {
    let mut raw = Raw::client().connected();
    raw.send("fin 0 1 b");
    raw.connection().stop(StreamId(0), 7);
    raw.send("stream 0 0 a");
    assert_eq!(raw.frames(), "");

    raw.waits = false;
    raw.send("stream 4 0 a");
    raw.connection().stop(StreamId(4), 7);
    raw.send("reset_stream 4 7 1");
    assert_eq!(raw.frames(), "");
    assert_eq!(raw.events(), "0 opened, 4 opened");
}

#[test]
fn does_not_ask_either_if_the_end_comes_first() {
    let mut raw = Raw::client().connected();
    raw.send("stream 2 0 a");
    raw.connection().stop(StreamId(2), 7);
    while raw.peer.poll(raw.now) {}
    raw.send("fin 2 1 b");
    assert_eq!(raw.frames(), "max_streams_uni 4");
    assert!(raw.connection().priority(StreamId(2)).is_none());
}

#[test]
fn is_stopped_by_the_peer() {
    let mut raw = Raw::server().connected();
    raw.peer.open(Unidirectional);
    raw.peer.send(2, b"abc", false);
    raw.forget();
    raw.send("stop_sending 2 7, stop_sending 2 8");
    assert_eq!(raw.frames(), "reset_stream 2 0x7 3");
    assert_eq!(raw.events(), "2 stopped 0x7, 2 closed");
}

/// RFC 9000 §3.5.
#[test]
fn is_stopped_after_the_end() {
    for (ack, frames) in [("ack 3-4", ""), ("ack 4-5", "reset_stream 2 0x7 4")] {
        let mut raw = Raw::server().connected();
        raw.request_packets("abc");
        raw.peer.send(2, b"d", true);
        raw.forget();
        raw.advance(RTT);
        raw.send(&format!("{ack}, stop_sending 2 7"));
        assert_eq!(raw.frames(), frames);
    }
}

#[test]
fn gives_up_on_both_halves() {
    let mut raw = Raw::client().connected();
    raw.send("stream 0 0 a");
    raw.connection().stop(StreamId(0), 7);
    raw.connection().reset(StreamId(0), 8);
    assert_eq!(raw.frames(), "reset_stream 0 0x8 0, stop_sending 0 0x7");
    assert_eq!(raw.events(), "0 opened, 0 data a, 0 closed");
    raw.send("ack, reset_stream 0 7 1");
    assert!(raw.connection().stream_info(StreamId(0)).is_none());
}

#[test]
fn ignores_calls_for_streams_that_are_not_there() {
    let mut raw = Raw::client().connected();
    let (connection, id) = (raw.connection(), StreamId(0));
    assert_eq!(connection.write(id, b"a"), None);
    connection.want_write(id);
    connection.finish(id);
    connection.reset(id, 0);
    connection.reset_unfinished(id, 0);
    connection.stop(id, 0);
    connection.consume(id, 1);
    connection.set_paused(id, true);
    connection.set_stream_context(id, context(1));
    connection.set_priority(id, priority(0, false));
    assert_eq!(connection.priority(id), None);
    assert_eq!((raw.frames(), raw.events()), Default::default());
}

#[test]
fn events_have_the_context() {
    let mut raw = Raw::server().connected();
    raw.connection().context = context(1);
    raw.connection().open(Bidirectional, context(2));
    raw.peer.polls = false;
    raw.send("stream 0 0 a, stream 3 0 b, reset_stream 3 7 1, stream 7 0 -, stream 11 0 -");
    raw.peer.poll(raw.now);
    raw.connection().set_stream_context(StreamId(3), context(3));
    raw.peer.polls = true;
    assert_eq!(
        raw.events(),
        "3 opened, 3 reset 0x7 @3, 7 opened, 11 opened, 0 data a @2, 3 closed @3"
    );
    raw.connection().want_write(StreamId(0));
    assert_eq!(raw.events(), "0 writable @2");

    raw.peer.polls = false;
    raw.send("close 0 0 -");
    raw.peer.poll(raw.now);
    raw.connection()
        .set_stream_context(StreamId(11), context(4));
    raw.peer.polls = true;
    assert_eq!(
        raw.events(),
        "0 closed @2, 7 closed, 11 closed @4, closed by close 0x0 - @1"
    );
}

#[test]
fn pauses() {
    let mut raw = Raw::client().connected();
    raw.send("stream 0 0 a");
    raw.connection().set_paused(StreamId(0), true);
    raw.send("stream 0 1 b");
    raw.send("stream 0 2 c");
    assert_eq!(raw.events(), "0 opened, 0 data a");
    raw.connection().set_paused(StreamId(0), false);
    assert_eq!(raw.events(), "0 data bc");

    raw.waits = false;
    raw.send("fin 0 3 d, stream 4 0 a");
    raw.connection().set_paused(StreamId(0), true);
    assert_eq!(raw.events(), "4 opened, 4 data a");
    raw.send("close 0 0 -");
    let events = "0 fin d, 0 closed, 4 closed, closed by close 0x0 -";
    assert_eq!(raw.events(), events);
}

#[test]
fn is_writable_once_for_each_request() {
    let mut raw = Raw::server().connected();
    let ids = [(); 3].map(|()| StreamId(raw.peer.open(Unidirectional)));
    for id in [ids, ids].concat() {
        raw.connection().want_write(id);
    }
    raw.connection().finish(ids[1]);
    assert_eq!(raw.events(), "2 writable, 10 writable, 6 closed");
    raw.peer.polls = false;
    for id in [ids[0], ids[2]] {
        raw.connection().want_write(id);
        raw.connection().reset(id, 0);
    }
    raw.process();
    raw.peer.polls = true;
    assert_eq!(raw.events(), "2 closed, 10 closed");
}

/// The streams in the order in which they get to send, and how many times 16 KiB they have sent before.
fn turns(raw: &mut Raw) -> Vec<(u64, u64)> {
    let mut turns = Vec::new();
    while let frames = raw.frames()
        && !frames.is_empty()
    {
        for frame in groups(&frames).iter().filter(|it| it[0] != "ping") {
            let [id, offset] = [1, 2].map(|at| frame[at].parse::<u64>().unwrap());
            if turns.last().is_none_or(|&(last, _)| last != id) {
                turns.push((id, offset >> 14));
            }
        }
        raw.advance(RTT);
        raw.send("ack");
    }
    turns
}

#[test]
fn streams_take_turns() {
    let mut raw = Raw::server().connected();
    for _ in 0..2 {
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &filler(0, 40_000), true);
    }
    let expected = [(2, 0), (6, 0), (2, 1), (6, 1), (2, 2), (6, 2)];
    assert_eq!(turns(&mut raw), expected);
}

#[test]
fn urgent_streams_go_first() {
    let mut raw = Raw::client()
        .config(|it| it.has_priorities = true)
        .connected();
    let priorities = [
        priority(4, false),
        priority(3, true),
        priority(3, true),
        priority(3, false),
        priority(3, false),
    ];
    for it in priorities {
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &filler(0, 20_000), true);
        raw.connection().set_priority(StreamId(id), it);
        assert_eq!(raw.connection().priority(StreamId(id)), Some(it));
    }
    let expected = [(15, 0), (19, 0), (7, 0), (11, 0), (7, 1), (11, 1), (3, 0)];
    assert_eq!(turns(&mut raw), expected);
}

/// With a stream that has sent `len` bytes, and has more.
fn sending(has_priorities: bool, len: usize) -> Raw {
    let raw = Raw::client().config(|it| it.has_priorities = has_priorities);
    let mut raw = raw.with("max_stream_data_uni=9000000").connected();
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, &filler(0, 4 * len), true);
    while raw.streams.get(&id).is_none_or(|it| it.len() < len) {
        raw.forget();
        raw.advance(RTT);
        raw.send("ack");
    }
    raw.forget();
    raw
}

fn ids(turns: Vec<(u64, u64)>) -> Vec<u64> {
    turns.into_iter().map(|it| it.0).collect()
}

#[test]
fn short_streams_pass_long_ones() {
    for (has_priorities, len, expected) in [
        (false, 140_000, [7, 11, 3]),
        (true, 140_000, [3, 7, 11]),
        (true, 1_100_000, [7, 11, 3]),
    ] {
        let mut raw = sending(has_priorities, len);
        for _ in 0..2 {
            let id = raw.peer.open(Unidirectional);
            raw.peer.send(id, &filler(0, 8_000), true);
        }
        raw.advance(RTT);
        raw.send("ack");
        assert_eq!(ids(turns(&mut raw)), expected, "{has_priorities} {len}");
    }
}

#[test]
fn long_streams_are_not_passed_for_ever() {
    for (has_priorities, expected) in [(false, 7), (true, 3)] {
        let mut raw = sending(has_priorities, 1_100_000);
        for _ in 0..20 {
            let id = raw.peer.open(Unidirectional);
            raw.peer.send(id, &filler(0, 8_000), true);
        }
        raw.advance(RTT);
        raw.send("ack");
        let passed_by = ids(turns(&mut raw)).iter().position(|&it| it == 3);
        assert_eq!(passed_by, Some(expected));
    }
}

#[test]
fn the_first_long_response_shares_the_path_with_the_short_ones() {
    let mut raw = sending(true, 1_100_000);
    let before = raw.streams[&3].len();
    for _ in 0..3 {
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &filler(0, 1_500_000), true);
    }
    let mut finished = Vec::new();
    while finished.len() < 4 {
        raw.advance(RTT / 8);
        raw.send("ack");
        let frames = raw.frames();
        let sent = raw.streams.values().map(Vec::len).sum::<usize>() - before;
        let ends = groups(&frames).into_iter().filter(|it| it[0] == "fin");
        finished.extend(ends.map(|it| (it[1].to_owned(), sent)));
    }
    assert!(finished.iter().map(|it| &it.0).eq(["3", "7", "11", "15"]));
    let rest = 4_400_000 - before;
    assert!((rest * 9 / 5..rest * 11 / 5).contains(&finished[0].1));
}

#[test]
fn streams_of_a_client_take_turns_unless_one_is_more_urgent() {
    let raw = Raw::server().config(|it| it.has_priorities = true);
    let mut raw = raw.connected();
    for urgency in [3, 3, 2] {
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &filler(0, 20_000), true);
        (raw.connection()).set_priority(StreamId(id), priority(urgency, false));
    }
    assert_eq!(turns(&mut raw), [(10, 0), (2, 0), (6, 0), (2, 1), (6, 1)]);
}

#[test]
fn new_priority_leaves_the_other_streams_their_turns() {
    let mut raw = Raw::server().connected();
    let ids = [(); 3].map(|()| raw.peer.open(Unidirectional));
    for id in ids.into_iter().rev() {
        raw.peer.send(id, b"a", false);
        raw.connection().want_write(StreamId(id));
    }
    (raw.connection()).set_priority(StreamId(10), priority(4, false));
    raw.peer.polls = false;
    assert_eq!(raw.frames(), "stream 6 0 a, stream 2 0 a, stream 10 0 a");
    raw.peer.polls = true;
    assert_eq!(raw.events(), "6 writable, 2 writable, 10 writable");
}

#[test]
fn fills_packets_to_the_last_byte() {
    for len in 1090..1180 {
        let mut raw = Raw::server().connected();
        for (id, len) in [(2, len), (6, 70), (10, 0)] {
            raw.peer.open(Unidirectional);
            raw.peer.send(id, &filler(0, len), true);
        }
        let ends = raw.take().into_iter().flat_map(|it| it.frames);
        assert_eq!(ends.filter(|it| it.starts_with("fin ")).count(), 3);
        assert!(raw.streams[&2] == filler(0, len) && raw.streams[&6] == filler(0, 70));
    }
}

#[test]
fn sends_again_what_is_lost() {
    let mut raw = Raw::server().connected();
    raw.peer.open(Bidirectional);
    for (data, finishes) in [("a", false), ("b", false), ("c", false), ("", true)] {
        raw.peer.send(0, data.as_bytes(), finishes);
        raw.process();
    }
    let first = raw.take()[0].number;
    raw.advance(RTT);
    raw.send(&format!("ack {}", first + 1));
    raw.wait();
    assert_eq!(raw.frames(), "stream 0 0 a");
    raw.wait();
    assert_eq!(raw.frames(), "fin 0 2 c, ping");
}

#[test]
fn what_was_sent_twice_can_outlast_its_stream() {
    type Action = fn(&mut Raw);
    let cases: [(Action, &str, &str); 3] = [
        (|it| it.peer.send(2, b"a", true), "", "fin 2 0 a"),
        (
            |it| it.connection().reset(StreamId(2), 0),
            "",
            "reset_stream 2 0x0 0",
        ),
        (
            |it| it.connection().stop(StreamId(3), 0),
            "max_streams_uni 4, ",
            "stop_sending 3 0x0",
        ),
    ];
    for (action, before, frame) in cases {
        for acks_both in [false, true] {
            let mut raw = Raw::server().connected();
            raw.peer.open(Unidirectional);
            raw.send("stream 3 0 -");
            raw.advance(RTT);
            raw.forget();
            action(&mut raw);
            let first = raw.take()[0].number;
            raw.forget();
            raw.wait();
            assert_eq!(raw.frames(), format!("{before}{frame}, ping"));
            raw.send(&format!("ack {first}, fin 3 0 -"));
            if acks_both {
                raw.send("ack");
            }
            raw.advance(1000);
            assert!(
                !raw.take()
                    .iter()
                    .any(|it| it.frames.contains(&frame.into()))
            );
        }
    }
}

#[test]
fn what_is_about_to_be_sent_again_can_be_acknowledged() {
    for (acked, expected) in [(0..=1, ""), (1..=1, "fin 2 0 a")] {
        let mut raw = Raw::server().connected();
        raw.peer.open(Unidirectional);
        raw.peer.send(2, b"a", false);
        let first = raw.take()[0].number;
        raw.peer.send(2, b"", true);
        raw.forget();
        raw.now = raw.peer.endpoint.timeout().unwrap();
        raw.peer.endpoint.handle_timeouts(raw.now);
        raw.send(&format!(
            "ack {}-{}",
            first + acked.start(),
            first + acked.end()
        ));
        assert_eq!(raw.frames(), expected);
    }
}

#[test]
fn an_end_that_is_acknowledged_is_not_sent_again() {
    let mut raw = Raw::server().connected();
    raw.peer.open(Unidirectional);
    raw.peer.send(2, b"a", false);
    raw.forget();
    raw.peer.send(2, b"b", true);
    let second = raw.take()[0].number;
    raw.forget();
    raw.wait();
    assert_eq!(raw.frames(), "fin 2 0 ab, ping");
    raw.send(&format!("ack {second}"));
    raw.wait();
    assert_eq!(raw.frames(), "stream 2 0 a, ping");
}

#[test]
fn streams_that_are_gone_leave_the_queues() {
    for has_priorities in [false, true] {
        for limit in ["max_data=0", "max_stream_data_uni=0", ""] {
            let raw = Raw::server().config(|it| it.has_priorities = has_priorities);
            let mut raw = raw.with(limit).connected();
            for id in [2, 6] {
                raw.peer.open(Unidirectional);
                raw.peer.send(id, b"a", false);
            }
            raw.connection().reset(StreamId(2), 0);
            let first = raw.take()[0].number;
            raw.send(&format!("ack {first}"));
            raw.connection()
                .set_priority(StreamId(6), priority(0, false));
            assert_eq!(raw.events(), "2 closed");
            raw.send("max_data 1, max_stream_data 6 1");
            assert!(raw.streams.iter().eq([(&6, &b"a".to_vec())]));
        }
    }
}

#[test]
fn urgent_streams_are_writable_first() {
    let mut raw = Raw::server()
        .config(|it| it.has_priorities = true)
        .connected();
    for urgency in [3, 1, 2] {
        let id = StreamId(raw.peer.open(Unidirectional));
        raw.connection().set_priority(id, priority(urgency, false));
        raw.connection().want_write(id);
    }
    assert_eq!(raw.events(), "6 writable, 10 writable, 2 writable");
}

#[test]
fn frames_about_streams_wait_for_a_packet_that_has_room() {
    let mut raw = Raw::server().with("max_streams_uni=500").connected();
    for _ in 0..500 {
        let id = raw.peer.open(Unidirectional);
        raw.connection().reset(StreamId(id), 0);
    }
    let packets = raw.take();
    assert_eq!(packets.len(), 3);
    assert_eq!(packets.iter().flat_map(|it| &it.frames).count(), 500);
}

#[test]
fn streams_that_were_not_announced_are_not_closed() {
    let mut raw = Raw::client().connected();
    raw.waits = false;
    raw.send("reset_stream 2 7 0, stream 0 0 a");
    let now = raw.now;
    raw.connection().abort(now, Transport, NO_ERROR, b"");
    assert_eq!(raw.events(), "closed: Local");
}
