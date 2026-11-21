use bun_quic::Direction::{Bidirectional, Unidirectional};
use bun_quic::Layer::Transport;
use bun_quic::transport_code::*;
use bun_quic::{Batch, Duration, StreamId};

use crate::harness::crypto::Random;
use crate::harness::network::Network;
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

    let mut raw = Raw::client().connected();
    raw.peer.echoes = true;
    for (frames, expected) in [
        ("fin 0 0 a", "fin 0 0 a"),
        ("ack, stream 392 0 -", ""),
        ("stream 396 0 -", "max_streams_bidi 101"),
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
fn resets_until_that_is_acknowledged() {
    let mut raw = Raw::server().connected();
    raw.peer.open(Bidirectional);
    raw.peer.send(0, b"a", false);
    raw.lose();
    raw.peer.send(0, b"b", true);
    raw.forget();
    raw.connection().reset(StreamId(0), 7);
    let first = raw.take()[0].number;
    raw.send(&format!("ack {}", first - 1));
    raw.now = raw.now + Duration::from_secs(1);
    assert_eq!(raw.frames(), "reset_stream 0 0x7 2, ping");
    raw.now = raw.now + Duration::from_secs(1);
    raw.peer.endpoint.handle_timeouts(raw.now);
    raw.send(&format!("ack {first}"));
    assert_eq!(raw.frames(), "ping, ping");
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

#[test]
fn is_writable_again_when_something_has_been_sent() {
    let mut raw = Raw::server().with("max_stream_data_uni=9").connected();
    raw.peer.polls = false;
    let id = StreamId(raw.peer.open(Unidirectional));
    for events in ["2 writable", ""] {
        raw.connection().write(id, b"a");
        raw.connection().want_write(id);
        while raw.peer.poll(raw.now) {}
        assert_eq!(raw.peer.events(), events);
    }
    let others = [(); 2].map(|()| StreamId(raw.peer.open(Unidirectional)));
    for id in others.into_iter().rev() {
        raw.connection().want_write(id);
    }
    while raw.peer.poll(raw.now) {}
    assert_eq!(raw.peer.events(), "10 writable, 6 writable");
    raw.peer.polls = true;
    (raw.peer.endpoint).poll_transmit(raw.now, &mut Batch::default(), 9, |_| {});
    assert_eq!(raw.events(), "2 writable");
    raw.send("max_stream_data 2 10");
    assert_eq!(raw.events(), "");
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
fn streams_take_turns_until_all_is_written() {
    let alternating = [(2, 0), (6, 0), (2, 1), (6, 1), (2, 2), (6, 2)];
    let ending = [(2, 0), (6, 0), (2, 2), (6, 1)];
    for (finishes, priority, expected) in [
        (false, priority(3, false), &alternating[..]),
        (true, priority(3, true), &alternating),
        (true, priority(3, false), &ending),
        (true, priority(2, false), &ending),
    ] {
        let mut raw = Raw::server().connected();
        for _ in 0..2 {
            let id = raw.peer.open(Unidirectional);
            raw.connection().set_priority(StreamId(id), priority);
            raw.peer.send(id, &filler(0, 40_000), finishes);
        }
        assert_eq!(turns(&mut raw), expected);
    }
}

#[test]
fn what_little_is_left_does_not_wait() {
    for (streams, expected) in [
        (
            [(18_000, true), (20_000, false), (20_000, false)],
            [(2, 0), (6, 0), (10, 0), (6, 1), (10, 1)],
        ),
        (
            [(40_000, true), (18_000, true), (20_000, false)],
            [(2, 0), (6, 0), (2, 2), (6, 1), (10, 0)],
        ),
    ] {
        let mut raw = Raw::server().connected();
        for (len, finishes) in streams {
            let id = raw.peer.open(Unidirectional);
            raw.peer.send(id, &filler(0, len), finishes);
        }
        assert_eq!(turns(&mut raw), expected);
    }
}

#[test]
fn streams_do_not_write_out_of_turn() {
    let raw = Raw::server().config(|it| it.sends_in_order = true);
    let mut raw = raw.connected();
    let ids = [(); 3].map(|()| StreamId(raw.peer.open(Unidirectional)));
    let data = filler(0, 20_000);
    raw.connection().want_write(ids[0]);
    assert_eq!(raw.connection().write(ids[0], &data[..9000]), Some(9000));
    assert_eq!(raw.connection().write(ids[1], &data), Some(8192));
    (raw.connection()).set_priority(ids[2], priority(2, false));
    assert_eq!(raw.connection().write(ids[2], &data), Some(20_000));
    assert!(raw.peer.poll(raw.now));
    assert_eq!(raw.peer.log.pop().unwrap(), "2 writable");
    assert_eq!(raw.connection().write(ids[0], &data), Some(20_000));
    raw.connection().want_write(ids[0]);
    assert_eq!(raw.connection().write(ids[1], &data), Some(0));
    (raw.connection()).set_priority(ids[2], priority(4, false));
    assert_eq!(raw.connection().write(ids[2], &data), Some(0));
}

#[test]
fn streams_that_arrive_late_keep_their_place() {
    let raw = Raw::client().config(|it| it.sends_in_order = true);
    let mut raw = raw.connected();
    for id in [0, 12, 16, 8, 4] {
        raw.write(id, b"a", true);
        raw.peer.send(id, &filler(0, 40_000), true);
    }
    assert_eq!(ids(turns(&mut raw)), [0, 4, 8, 12, 16]);
}

#[test]
fn streams_keep_their_place_however_many_arrive_late() {
    let raw = Raw::client().config(|it| it.sends_in_order = true);
    let mut raw = raw.connected();
    for id in [0, 4 * 90, 4, 4 * 89] {
        raw.write(id, b"a", true);
        raw.peer.send(id, &filler(0, 40_000), true);
    }
    assert_eq!(ids(turns(&mut raw)), [0, 4, 4 * 89, 4 * 90]);
}

#[test]
fn urgent_streams_go_first() {
    let mut raw = Raw::client()
        .config(|it| it.sends_in_order = true)
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

#[test]
fn older_streams_go_first_whatever_their_ids() {
    for order in [[7, 0], [0, 7]] {
        let raw = Raw::client().config(|it| it.sends_in_order = true);
        let mut raw = raw.connected();
        raw.request_packets("a");
        for id in order {
            match id {
                0 => raw.send("stream 0 0 -"),
                _ => _ = raw.peer.open(Unidirectional),
            }
            raw.peer.send(id, &filler(0, 40_000), true);
        }
        assert_eq!(ids(turns(&mut raw)), order);
    }
}

/// With a stream that has sent `len` bytes, and has more.
fn sending(sends_in_order: bool, len: usize) -> Raw {
    let raw = Raw::client().config(|it| it.sends_in_order = sends_in_order);
    let mut raw = (raw.with("max_data=90000000 max_stream_data_uni=9000000")).connected();
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
    for (sends_in_order, len, expected) in [
        (false, 60_000, &[3, 7, 11, 3][..]),
        (false, 140_000, &[7, 11, 3]),
        (true, 140_000, &[3, 7, 11]),
        (true, 1_100_000, &[7, 11, 3]),
    ] {
        let mut raw = sending(sends_in_order, len);
        for _ in 0..2 {
            let id = raw.peer.open(Unidirectional);
            raw.peer.send(id, &filler(0, 8_000), true);
        }
        raw.advance(RTT);
        raw.send("ack");
        assert_eq!(ids(turns(&mut raw)), expected, "{sends_in_order} {len}");
    }
}

#[test]
fn a_response_that_is_long_by_a_little_is_not_passed() {
    let raw = Raw::client().config(|it| it.sends_in_order = true);
    let mut raw = (raw.with("max_stream_data_uni=9000000")).connected();
    let [long, short] = [(); 2].map(|()| raw.peer.open(Unidirectional));
    raw.peer.send(long, &filler(0, 1_000_000), false);
    turns(&mut raw);
    raw.peer.send(long, &filler(0, 50_000), true);
    raw.peer.send(short, &filler(0, 40_000), true);
    assert_eq!(ids(turns(&mut raw)), [long, short]);
}

#[test]
fn a_long_response_does_not_share_the_path_with_an_older_one() {
    let raw = Raw::client().config(|it| it.sends_in_order = true);
    let mut raw = (raw.with("max_data=90000000 max_stream_data_uni=9000000")).connected();
    for len in [300_000, 1_100_000] {
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &filler(0, len), true);
    }
    assert_eq!(ids(turns(&mut raw)), [3, 7]);
}

#[test]
fn a_long_incremental_stream_keeps_its_turns_if_streams_are_sent_in_order() {
    let raw = Raw::client().config(|it| it.sends_in_order = true);
    let mut raw = (raw.with("max_data=90000000 max_stream_data_uni=9000000")).connected();
    let streams = [false, true, true].map(|is_incremental| {
        let id = raw.peer.open(Unidirectional);
        (raw.connection()).set_priority(StreamId(id), priority(3, is_incremental));
        id
    });
    raw.peer.send(streams[1], &filler(0, 900_000), true);
    raw.advance(RTT);
    raw.forget();
    raw.peer.send(streams[2], &filler(0, 8_000), true);
    raw.peer.send(streams[0], &filler(0, 1_500_000), true);
    raw.send("ack");
    let mut expected = vec![3, 7, 11];
    expected.extend([7, 3].repeat(39));
    assert_eq!(ids(turns(&mut raw)), expected);
}

#[test]
fn long_streams_are_not_passed_for_ever() {
    for (sends_in_order, expected) in [(false, 7), (true, 3)] {
        let mut raw = sending(sends_in_order, 1_100_000);
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
fn long_streams_let_an_older_one_finish() {
    let mut raw = sending(false, 100_000);
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, &filler(0, 1_000_000), true);
    raw.advance(RTT);
    raw.send("ack");
    assert_eq!(turns(&mut raw).last(), Some(&(7, 0)));
}

#[test]
fn short_streams_pass_many_long_ones() {
    for (len, expected) in [(20_000, 15), (50_000, 21)] {
        let mut raw = sending(false, 100_000);
        for len in [300_000; 12].into_iter().chain([len]) {
            let id = raw.peer.open(Unidirectional);
            raw.peer.send(id, &filler(0, len), true);
        }
        raw.advance(RTT);
        raw.send("ack");
        let last = ids(turns(&mut raw)).iter().rposition(|&it| it == 55);
        assert_eq!(last, Some(expected));
    }
}

/// Returns the percentage of the path that the long streams get, and for how many milliseconds a short one takes at most.
fn busy_path(idle: usize, chatty: usize, long: usize, short: (usize, usize)) -> (u64, u64) {
    let mut network = Network::new(1);
    network.config(|it| {
        it.parameters.initial_max_streams_uni = 900;
        it.parameters.initial_max_stream_data_uni = 900_000;
        it.parameters.initial_max_data = 9_000_000;
    });
    (network.bytes_per_second, network.latency) = (5_000_000, Duration::from_millis(1));
    network.connect();
    let mut open = |count| -> Vec<_> {
        let client = &mut network.client;
        (0..count).map(|_| client.open(Unidirectional)).collect()
    };
    let (_, chatty, long) = (open(idle), open(chatty), open(long));
    for &id in &long {
        network.client.send(id, &vec![0; 2_000_000], true);
    }
    let (mut waiting, mut slowest) = (Vec::new(), 0);
    for now in 0..800_u64 {
        waiting.retain(|&(id, since)| {
            slowest = slowest.max(now - since);
            (network.server.streams.get(&id)).is_none_or(|it| !it.is_read_to_end)
        });
        while waiting.len() < short.0 {
            let id = network.client.open(Unidirectional);
            network.client.send(id, &vec![0; short.1], true);
            waiting.push((id, now));
        }
        (chatty.iter()).for_each(|&id| network.client.send(id, b"a", false));
        network.run_for(Duration::from_millis(1));
    }
    let received = |id| network.server.streams[id].received.len() as u64;
    (long.iter().map(received).sum::<u64>() / 40_000, slowest)
}

#[test]
fn long_streams_get_their_share_of_a_busy_path() {
    for (idle, chatty, long, short, share, max_millis) in [
        (0, 0, 1, (10, 64_000), 9..=13, 220),
        (90, 0, 1, (10, 64_000), 9..=13, 220),
        (0, 0, 1, (40, 30_000), 5..=9, 380),
        (0, 0, 1, (60, 4_000), 3..=9, 80),
        (0, 0, 12, (4, 50_000), 38..=50, 110),
        (0, 20, 12, (4, 50_000), 38..=50, 110),
    ] {
        let (got, millis) = busy_path(idle, chatty, long, short);
        assert!(
            share.contains(&got) && millis <= max_millis,
            "{got} {millis}"
        );
    }
}

#[test]
fn the_end_of_a_long_stream_does_not_wait() {
    let mut raw = Raw::server().connected();
    let ids = [(); 20].map(|()| raw.peer.open(Unidirectional));
    raw.peer.send(ids[0], &filler(0, 200_000), false);
    turns(&mut raw);
    for &id in &ids[1..] {
        raw.peer.send(id, &filler(0, 8_000), false);
    }
    raw.connection().finish(StreamId(ids[0]));
    raw.process();
    assert_eq!(turns(&mut raw)[0], (ids[0], 12));
}

#[test]
fn only_shorter_streams_write_ahead_of_one_that_waits() {
    let mut raw = Raw::server().connected();
    raw.peer.polls = false;
    let ids = [(); 4].map(|()| StreamId(raw.peer.open(Unidirectional)));
    let data = filler(0, 300_000);
    assert!(raw.connection().write(ids[0], &data) < Some(150_000));
    let written = [(1, 65_536), (2, 65_537)].map(|(at, len)| {
        let id = ids[at];
        raw.connection().write(id, &data[..len])
    });
    assert_eq!(written, [Some(65_536), Some(8192)]);
    raw.process();
    for _ in 0..2 {
        raw.advance(RTT);
        raw.send("ack");
    }
    let written = [58_000, 58_000].map(|len| raw.connection().write(ids[3], &data[..len]));
    assert_eq!(written, [Some(2048), Some(0)]);
    assert_eq!(
        raw.connection().write(ids[3], &data[..55_000]),
        Some(55_000)
    );
}

#[test]
fn nothing_passes_what_is_long_overdue() {
    let mut raw = Raw::server().connected();
    raw.peer.polls = false;
    let data = filler(0, 900_000);
    let id = StreamId(raw.peer.open(Unidirectional));
    raw.connection().write(id, &data);
    let written = (0..9).map(|_| {
        turns(&mut raw);
        let id = StreamId(raw.peer.open(Unidirectional));
        raw.connection().write(id, &data[..60_000]).unwrap()
    });
    let expected = [[60_000; 7].as_slice(), &[2048; 2]].concat();
    assert_eq!(written.collect::<Vec<_>>(), expected);
}

#[test]
fn what_is_long_overdue_is_asked_for_even_if_much_is_unsent() {
    let mut raw = Raw::server().with("max_streams_uni=99").connected();
    raw.peer.polls = false;
    let data = filler(0, 900_000);
    let ids = [(); 2].map(|()| StreamId(raw.peer.open(Unidirectional)));
    raw.connection().write(ids[0], &data);
    turns(&mut raw);
    raw.connection().write(ids[1], &data[..70_000]);
    raw.connection().write(ids[1], &data);
    for _ in 0..90 {
        let id = StreamId(raw.peer.open(Unidirectional));
        raw.connection().write(id, &data[..8000]);
    }
    raw.peer.log.clear();
    while raw.peer.poll(raw.now) {}
    assert_eq!(raw.peer.events(), "2 writable");
    raw.connection().want_write(ids[0]);
    assert!(!raw.peer.poll(raw.now));
    assert_eq!(raw.connection().write(ids[0], &data), Some(8192));
}

#[test]
fn what_is_overdue_is_asked_for_once() {
    let mut raw = Raw::server().connected();
    raw.peer.polls = false;
    let data = filler(0, 900_000);
    let ids = [(); 9].map(|()| StreamId(raw.peer.open(Unidirectional)));
    raw.connection().write(ids[0], &data);
    for &id in &ids[1..] {
        turns(&mut raw);
        raw.connection().write(id, &data[..60_000]);
    }
    turns(&mut raw);
    (raw.connection()).set_priority(ids[0], priority(7, false));
    raw.peer.log.clear();
    assert!(raw.peer.poll(raw.now));
    raw.connection().want_write(ids[0]);
    while raw.peer.poll(raw.now) {}
    assert_eq!(raw.peer.events(), "2 writable, 34 writable");
}

#[test]
fn a_short_piece_after_long_ones_may_be_the_last() {
    let mut raw = Raw::server().connected();
    let ids = [(); 2].map(|()| StreamId(raw.peer.open(Unidirectional)));
    let data = filler(0, 900_000);
    let pieces = [
        (0, 65_536, 65_536),
        (0, 65_536, 65_536),
        (1, 900_000, 8192),
        (0, 8192, 8192),
        (0, 8192, 0),
    ];
    for (at, len, taken) in pieces {
        assert_eq!(raw.connection().write(ids[at], &data[..len]), Some(taken));
    }
}

#[test]
fn what_is_overdue_does_not_take_all_the_room() {
    let raw = Raw::server().with("max_data=90000000 max_stream_data_uni=9000000");
    let mut raw = raw.connected();
    let ids = [(); 2].map(|()| raw.peer.open(Unidirectional));
    raw.peer.send(ids[0], &filler(0, 900_000), false);
    turns(&mut raw);
    raw.peer.polls = false;
    let data = filler(0, 5_000_000);
    for id in ids {
        raw.connection().write(StreamId(id), &data);
    }
    for (id, range) in [(2, 300_000..2_000_000), (6, 69_632..69_633)] {
        turns(&mut raw);
        raw.peer.log.clear();
        assert!(raw.peer.poll(raw.now));
        assert_eq!(raw.peer.events(), format!("{id} writable"));
        let written = raw.connection().write(StreamId(id), &data[..3_000_000]);
        assert!(range.contains(&written.unwrap()), "{written:?}");
        let written = raw.connection().write(StreamId(id), &data[..2_000_000]);
        assert_eq!(written, Some(0));
    }
}

#[test]
fn share_that_is_overdue_is_the_same_in_small_pieces() {
    let raw = Raw::server().with("max_data=90000000 max_stream_data_uni=9000000");
    let mut raw = raw.connected();
    let ids = [(); 3].map(|()| raw.peer.open(Unidirectional));
    raw.peer.send(ids[0], &filler(0, 900_000), false);
    turns(&mut raw);
    raw.peer.polls = false;
    let [filling, long, pieces] = ids.map(StreamId);
    let data = filler(0, 5_000_000);
    let write_pieces = |raw: &mut Raw, max| {
        let mut is_taken = || raw.connection().write(pieces, &data[..4096]) == Some(4096);
        (0..max).take_while(|_| is_taken()).count()
    };
    write_pieces(&mut raw, 40);
    raw.connection().write(filling, &data);
    raw.connection().finish(filling);
    raw.connection().write(long, &data[..940_000]);
    write_pieces(&mut raw, 1);
    turns(&mut raw);
    raw.peer.poll(raw.now);
    raw.connection().write(long, &data[8192..940_000]);
    turns(&mut raw);
    raw.peer.poll(raw.now);
    assert_eq!(write_pieces(&mut raw, 99), 17);
}

#[test]
fn stream_that_has_more_than_it_seemed_gets_in_line() {
    for (len, taken) in [(65_536, 65_536), (65_537, 4096)] {
        let mut raw = Raw::server().connected();
        raw.peer.polls = false;
        let ids = [(); 3].map(|()| StreamId(raw.peer.open(Unidirectional)));
        let data = filler(0, 900_000);
        raw.connection().write(ids[0], &data[..100_000]);
        raw.connection().write(ids[0], &data[..100_000]);
        raw.connection().write(ids[1], &data[..100_000]);
        raw.connection().want_write(ids[2]);
        turns(&mut raw);
        raw.peer.log.clear();
        assert!(raw.peer.poll(raw.now));
        assert_eq!(raw.peer.events(), "10 writable");
        assert_eq!(raw.connection().write(ids[2], &data[..len]), Some(taken));
    }
}

#[test]
fn stream_that_has_offered_nothing_yet_has_no_share_to_keep_to() {
    let mut raw = Raw::server().connected();
    raw.peer.polls = false;
    let ids = [(); 3].map(|()| StreamId(raw.peer.open(Unidirectional)));
    let data = filler(0, 900_000);
    raw.connection().want_write(ids[0]);
    raw.connection().write(ids[1], &data[..8000]);
    raw.connection().write(ids[2], &data);
    turns(&mut raw);
    raw.peer.poll(raw.now);
    let written = raw.connection().write(ids[0], &data[..60_000]);
    assert_eq!(written, Some(60_000));
}

#[test]
fn what_is_overdue_takes_the_room_that_no_other_stream_wants() {
    let mut raw = Raw::server().connected();
    raw.peer.polls = false;
    let ids = [(); 4].map(|()| StreamId(raw.peer.open(Unidirectional)));
    let data = filler(0, 900_000);
    raw.connection().write(ids[0], &data);
    for &id in &ids[1..] {
        turns(&mut raw);
        raw.connection().write(id, &data[..60_000]);
    }
    turns(&mut raw);
    raw.peer.poll(raw.now);
    assert!(raw.connection().write(ids[0], &data[..700_000]) > Some(99_999));
}

#[test]
fn stream_that_has_waited_for_long_may_write_a_few_bytes() {
    for (is_sent, lens, expected) in [
        (false, [900_000, 900_000], [0, 0]),
        (true, [900_000, 898_976], [1024, 0]),
        (true, [1024, 100], [1024, 100]),
    ] {
        let mut raw = Raw::server().connected();
        raw.peer.polls = false;
        let ids = [(); 2].map(|()| StreamId(raw.peer.open(Unidirectional)));
        let data = filler(0, 900_000);
        raw.connection().write(ids[0], &data);
        if is_sent {
            turns(&mut raw);
        }
        for _ in 0..3 {
            raw.advance(1000);
            raw.send("ping");
        }
        raw.connection().want_write(ids[1]);
        raw.peer.log.clear();
        raw.peer.poll(raw.now);
        assert_eq!(raw.peer.has_logged("2 writable"), is_sent);
        let written = lens.map(|len| raw.connection().write(ids[0], &data[..len]));
        assert_eq!(written, expected.map(Some));
    }
}

#[test]
fn stream_that_misses_its_turn_writes_a_little() {
    let mut raw = Raw::server().connected();
    raw.peer.polls = false;
    let ids = [(); 3].map(|()| StreamId(raw.peer.open(Unidirectional)));
    let data = filler(0, 900_000);
    for id in ids {
        raw.connection().write(id, &data);
    }
    turns(&mut raw);
    raw.peer.log.clear();
    for _ in 0..2 {
        raw.peer.poll(raw.now);
    }
    assert_eq!(raw.peer.events(), "2 writable, 6 writable");
    assert_eq!(raw.connection().write(ids[0], &data), Some(2048));
}

#[test]
fn what_is_unsent_counts_towards_what_is_written_out_of_turn() {
    for (unsent, len, taken) in [(500, 8192, 7692), (500, 8193, 1548), (3000, 8193, 0)] {
        let mut raw = Raw::server().connected();
        let ids = [(); 2].map(|()| StreamId(raw.peer.open(Unidirectional)));
        raw.connection().want_write(ids[0]);
        raw.connection().write(ids[1], &filler(0, unsent));
        assert_eq!(raw.connection().write(ids[1], &filler(0, len)), Some(taken));
    }
}

#[test]
fn a_few_bytes_need_no_room_and_go_first() {
    let mut raw = Raw::server().with("max_streams_uni=99").connected();
    raw.peer.polls = false;
    let streams = [(); 14].map(|()| StreamId(raw.peer.open(Unidirectional)));
    let data = filler(0, 900_000);
    for &id in &streams[..13] {
        raw.connection().write(id, &data);
    }
    raw.process();
    for _ in 0..3 {
        raw.advance(1000);
        raw.send("ping");
    }
    raw.peer.log.clear();
    for &id in &streams[1..10] {
        assert!(raw.peer.poll(raw.now));
        assert_eq!(raw.connection().write(id, &data), Some(1024));
    }
    assert!(!raw.peer.poll(raw.now));
    raw.connection().write(streams[13], &data[..9]);
    raw.forget();
    raw.send("ack");
    let expected = [6, 10, 14, 18, 22, 26, 30, 34, 38, 2, 54, 2];
    assert_eq!(ids(turns(&mut raw)), expected);
}

#[test]
fn a_few_bytes_do_not_cost_a_stream_its_turn() {
    let mut raw = Raw::server().connected();
    raw.peer.polls = false;
    let ids = [(); 2].map(|()| StreamId(raw.peer.open(Unidirectional)));
    let data = filler(0, 900_000);
    raw.connection().write(ids[0], &data[..150_000]);
    turns(&mut raw);
    for _ in 0..3 {
        raw.advance(1000);
        raw.send("ping");
    }
    raw.connection().write(ids[1], &data);
    raw.peer.log.clear();
    for len in [30_000, 28_976] {
        raw.peer.poll(raw.now);
        raw.connection().write(ids[0], &data[..len]);
    }
    assert_eq!(raw.peer.events(), "2 writable, 2 writable");
}

#[test]
fn stream_that_leaves_the_line_passes_nothing_on() {
    let raw = Raw::server().with("max_data=90000000 max_stream_data_uni=9000000");
    let mut raw = raw.connected();
    let ids = [(); 3].map(|()| raw.peer.open(Unidirectional));
    raw.peer.send(ids[0], &filler(0, 900_000), false);
    turns(&mut raw);
    raw.peer.polls = false;
    let (ids, data) = (ids.map(StreamId), filler(0, 5_000_000));
    for id in ids {
        raw.connection().write(id, &data);
    }
    turns(&mut raw);
    raw.peer.poll(raw.now);
    raw.connection().write(ids[0], &data[..3_000_000]);
    raw.connection().finish(ids[0]);
    turns(&mut raw);
    for &id in &ids[1..] {
        raw.peer.poll(raw.now);
        let written = raw.connection().write(id, &data[..3_000_000]);
        assert_eq!(written, Some(69_632));
    }
    raw.peer.poll(raw.now);
    let written = raw.connection().write(ids[2], &data[..2_000_000]);
    assert_eq!(written, Some(0));
}

/// Returns how many KiB the long streams get in the second period.
fn progress(count: usize, short: usize, window: u64, seconds: [u64; 2]) -> Vec<usize> {
    let mut network = Network::new(1);
    network.config(|it| {
        it.parameters.initial_max_streams_uni = 99;
        it.parameters.initial_max_stream_data_uni = 9_000_000;
        it.parameters.initial_max_data = window;
    });
    (network.bytes_per_second, network.latency) = (100_000, Duration::from_millis(10));
    network.connect();
    for len in [200_000]
        .repeat(count)
        .into_iter()
        .chain([8000].repeat(short))
    {
        let id = network.client.open(Unidirectional);
        network.client.send(id, &vec![0; len], true);
    }
    let [before, after] = seconds.map(|it| {
        network.run_for(Duration::from_secs(it));
        let streams = network.server.streams.values().take(count);
        Vec::from_iter(streams.map(|it| it.received.len() >> 10))
    });
    Vec::from_iter(after.iter().zip(before).map(|it| it.0 - it.1))
}

#[test]
fn streams_are_not_silent_for_long() {
    for (count, short, window, seconds, expected) in [
        (20, 0, 90_000_000, [10, 10], 5..6),
        (90, 0, 90_000_000, [10, 10], 2..5),
        (20, 0, 20_000, [10, 10], 4..6),
        (20, 75, 90_000_000, [2, 3], 2..3),
    ] {
        let progress = progress(count, short, window, seconds);
        let is_expected = progress[12..].iter().all(|it| expected.contains(it));
        assert!(is_expected, "{progress:?}");
    }
}

/// The peer reads 3,000 bytes of every stream in a step, and returns credit in quarters of its windows. Returns after how
/// many steps it has read everything.
fn steps_to_read(count: usize, len: usize, window: usize, stream_window: usize) -> usize {
    let parameters = format!("max_data={window} max_stream_data_uni={stream_window}");
    let mut raw = Raw::server().with(&parameters).connected();
    let mut streams = Vec::from_iter((0..count).map(|_| {
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &filler(0, len), true);
        (id, 0, stream_window)
    }));
    let mut limit = window;
    let is_done = |_: &usize| {
        raw.forget();
        raw.advance(RTT / 2);
        let mut frames = String::from("ack");
        for (id, read, limit) in &mut streams {
            *read = (*read + 3000).min(raw.streams.get(id).map_or(0, Vec::len));
            if *limit - *read < stream_window / 4 * 3 {
                *limit = *read + stream_window;
                frames += &format!(", max_stream_data {id} {limit}");
            }
        }
        let read = streams.iter().map(|it| it.1).sum::<usize>();
        if limit - read < window / 4 * 3 {
            limit = read + window;
            frames += &format!(", max_data {limit}");
        }
        raw.send(&frames);
        read == count * len
    };
    (1..2000).find(is_done).unwrap()
}

#[test]
fn streams_that_are_read_slowly_share_the_window() {
    for (count, len, window, stream_window, expected) in [
        (8, 600_000, 768_000, 512_000, 200..260),
        (4, 900_000, 768_000, 512_000, 300..320),
        (3, 1_500_000, 1_000_000, 1_000_000, 500..520),
        (4, 1_500_000, 1_500_000, 1_000_000, 500..520),
    ] {
        let steps = steps_to_read(count, len, window, stream_window);
        assert!(expected.contains(&steps), "{count} x {len}: {steps}");
    }
}

#[test]
fn streams_that_only_write_when_asked_are_long_all_the_same() {
    for (seconds, pauses) in [(0, false), (3, false), (3, true)] {
        let mut raw = Raw::server().connected();
        let ids = [(); 2].map(|()| raw.peer.open(Unidirectional));
        for _ in 0..10 {
            raw.peer.polls = false;
            raw.connection().want_write(StreamId(ids[0]));
            while raw.peer.poll(raw.now) {}
            raw.peer.send(ids[0], &filler(0, 20_000), false);
            turns(&mut raw);
        }
        raw.connection().want_write(StreamId(ids[0]));
        for _ in 0..seconds {
            raw.advance(1000);
            raw.send("ping");
        }
        while raw.peer.poll(raw.now) {}
        if pauses {
            raw.send("ping");
        }
        raw.forget();
        for id in ids {
            raw.peer.send(id, &filler(0, 8_000), false);
        }
        raw.process();
        let mut expected = [(ids[1], 0), (ids[0], 12)];
        expected.rotate_left(usize::from(pauses));
        assert_eq!(turns(&mut raw), expected);
    }
}

#[test]
fn long_streams_that_come_in_pieces_are_passed_as_well() {
    for (before, pauses, expected) in [
        (100_000, false, "2 writable"),
        (140_000, false, "6 writable"),
        (140_000, true, "2 writable"),
    ] {
        let mut raw = Raw::server().connected();
        let ids = [(); 3].map(|()| raw.peer.open(Unidirectional));
        raw.peer.send(ids[2], &filler(0, 300_000), false);
        turns(&mut raw);
        raw.peer.send(ids[0], &filler(0, before), false);
        if pauses {
            turns(&mut raw);
        }
        raw.peer.log.clear();
        for (id, len) in [(ids[2], 900_000), (ids[0], 70_000), (ids[1], 90_000)] {
            raw.peer.send(id, &filler(0, len), false);
        }
        raw.process();
        turns(&mut raw);
        assert_eq!(raw.peer.log[0], expected);
    }
}

#[test]
fn streams_that_pause_are_not_long() {
    for (sends_in_order, expected) in [(false, [(2, 12), (6, 0)]), (true, [(6, 0), (2, 12)])] {
        let raw = Raw::server().config(|it| it.sends_in_order = sends_in_order);
        let mut raw = raw.connected();
        let ids = [(); 2].map(|()| raw.peer.open(Unidirectional));
        for id in ids {
            (raw.connection()).set_priority(StreamId(id), priority(3, true));
        }
        raw.peer.send(ids[0], &filler(0, 200_000), false);
        turns(&mut raw);
        for id in ids {
            raw.peer.send(id, &filler(0, 8_000), false);
        }
        raw.process();
        assert_eq!(turns(&mut raw), expected);
    }
}

#[test]
fn shorter_ends_go_first() {
    for (len, last) in [(60_000, 2), (80_000, 6)] {
        let mut raw = Raw::server().connected();
        let older = raw.peer.open(Unidirectional);
        raw.peer.send(older, &filler(0, 200_000), true);
        raw.process();
        raw.advance(RTT);
        raw.send("ack");
        let younger = raw.peer.open(Unidirectional);
        raw.peer.send(younger, &filler(0, len), true);
        raw.advance(RTT);
        raw.send("ack");
        assert_eq!(ids(turns(&mut raw)).last(), Some(&last));
    }
}

/// Returns how many KiB have been sent in all by the end of each stream.
fn ends(piece_len: Option<usize>, lens: &[usize]) -> Vec<usize> {
    let mut network = Network::new(1);
    network.config(|it| {
        it.parameters.initial_max_streams_uni = 99;
        it.parameters.initial_max_stream_data_uni = 9_000_000;
        it.parameters.initial_max_data = 90_000_000;
    });
    (network.bytes_per_second, network.latency) = (5_000_000, Duration::from_millis(2));
    network.connect();
    network.client.piece_len = piece_len;
    for &len in lens {
        let id = network.client.open(Unidirectional);
        network.client.send(id, &vec![0; len], true);
    }
    let mut ends = vec![0; lens.len()];
    while ends.iter().min() == Some(&0) {
        network.run_for(Duration::from_millis(1));
        let streams = || network.server.streams.values();
        for (end, _) in (ends.iter_mut().zip(streams())).filter(|it| it.1.is_read_to_end) {
            if *end == 0 {
                *end = streams().map(|it| it.received.len() >> 10).sum();
            }
        }
    }
    ends
}

#[test]
fn streams_end_one_after_the_other() {
    for (piece_len, lens, mean) in [
        (None, &[100_000; 8][..], 480..490),
        (None, &[200_000; 8], 895..905),
        (None, &[600_000; 4], 1605..1620),
        (None, &[1_500_000; 2], 2435..2445),
        (
            None,
            &[400_000, 200_000, 150_000, 120_000, 50_000],
            495..505,
        ),
        (Some(65_536), &[200_000; 8], 1215..1225),
        (Some(65_536), &[600_000; 4], 1785..1795),
        (Some(65_536), &[2_500_000; 2], 4645..4655),
        (Some(65_536), &[1_000_000, 100_000, 200_000], 715..725),
        (Some(4096), &[300_000; 4], 950..960),
    ] {
        let ends = ends(piece_len, lens);
        let sum: usize = ends.iter().sum();
        assert!(mean.contains(&(sum / lens.len())), "{ends:?}");
    }
}

#[test]
fn ends_pass_long_streams() {
    let mut raw = sending(false, 600_000);
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, &filler(0, 300_000), true);
    raw.advance(RTT);
    raw.send("ack");
    let expected = [(7, 0), (3, 90), (7, 9), (3, 91), (7, 17), (3, 92)];
    assert_eq!(turns(&mut raw)[2..], expected);
}

#[test]
fn the_first_long_response_shares_the_path_with_the_short_ones() {
    let mut raw = sending(true, 1_100_000);
    let quarter = (4_400_000 - raw.streams[&3].len()) / 4;
    for len in [1, 3, 1, 1, 1, 1, 1].map(|it| it * quarter) {
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &filler(0, len), true);
    }
    let mut finished = Vec::new();
    while finished.len() < 8 {
        raw.advance(RTT / 8);
        raw.send("ack");
        let frames = raw.frames();
        let ends = groups(&frames).into_iter().filter(|it| it[0] == "fin");
        finished.extend(ends.map(|it| it[1].to_owned()));
    }
    let long = finished.iter().position(|it| it == "3").unwrap();
    assert!((3..6).contains(&long), "{finished:?}");
    finished.remove(long);
    assert_eq!(finished, ["7", "15", "19", "23", "27", "31", "11"]);
}

/// With stream 3, which is long, and 7. Both wait for credit.
fn long_and(other: Option<bun_quic::http3::Priority>, window: usize, sends: bool) -> Raw {
    let raw = Raw::client().config(|it| it.sends_in_order = true);
    let mut raw = raw.with(&format!("max_data={window}")).connected();
    let ids = [(); 2].map(|()| raw.peer.open(Unidirectional));
    raw.peer.send(ids[0], &filler(0, 1_100_000), true);
    if let Some(it) = other {
        (raw.connection()).set_priority(StreamId(ids[0]), priority(it.urgency, false));
        raw.connection().set_priority(StreamId(ids[1]), it);
        raw.peer.send(ids[1], &filler(0, 100_000), true);
    }
    if sends {
        raw.advance(RTT);
    }
    raw.waits = false;
    raw
}

#[test]
fn a_long_response_leaves_half_of_the_credit_to_those_it_overtakes() {
    let other = Some(priority(2, true));
    for (other, limit, events, sent) in [
        (None, 64_000, "3 writable", [64_000, 0]),
        (other, 64_000, "3 writable, 7 writable", [48_000, 16_000]),
        (other, 34_000, "3 writable", [34_000, 0]),
    ] {
        let mut raw = long_and(other, 32_000, true);
        raw.send(&format!("ack, max_data {limit}"));
        raw.advance(RTT);
        assert_eq!(raw.events(), events);
        let len = |id| raw.streams.get(&id).map_or(0, Vec::len);
        assert_eq!([3, 7].map(len), sent);
    }

    let mut raw = long_and(other, 32_000, true);
    raw.send("ack, max_data 64000");
    raw.peer.poll(raw.now);
    let written = [7, 3].map(|id| raw.connection().write(StreamId(id), b"a"));
    assert_eq!(written, [Some(1), Some(0)]);
}

#[test]
fn a_long_response_is_asked_first_if_it_has_to_alternate() {
    for (unsent, first) in [("", "7 writable"), ("a", "3 writable")] {
        let mut raw = long_and(Some(priority(3, true)), 60_000, true);
        raw.send("max_data 120000");
        let other = StreamId(raw.peer.open(Unidirectional));
        raw.connection().write(other, unsent.as_bytes());
        raw.peer.poll(raw.now);
        assert_eq!(raw.peer.events(), first);
    }
}

#[test]
fn a_long_response_is_not_passed_by_what_is_less_urgent() {
    for (urgency, first) in [(3, "11 writable"), (4, "3 writable")] {
        let mut raw = long_and(Some(priority(3, false)), 50_000, false);
        raw.send("max_data 200000");
        raw.peer.poll(raw.now);
        assert_eq!(raw.peer.events(), "7 writable");
        raw.send("ack");
        let short = StreamId(raw.peer.open(Unidirectional));
        (raw.connection()).set_priority(short, priority(urgency, false));
        raw.connection().want_write(short);
        raw.peer.poll(raw.now);
        assert_eq!(raw.peer.events(), first);
    }
}

/// The peer returns credit in halves of its windows, for what it has read of all streams or of the first one that it has
/// not read to the end. Returns how much the others have sent when the first one is at two thirds.
fn sent_ahead(reads_in_order: bool, window: usize, stream_window: usize) -> usize {
    const LENS: [usize; 3] = [3_000_000, 1_000_000, 1_000_000];
    let raw = Raw::client().config(|it| it.sends_in_order = true);
    let parameters = format!("max_data={window} max_stream_data_uni={stream_window}");
    let mut raw = raw.with(&parameters).connected();
    let ids = [(); 3].map(|()| raw.peer.open(Unidirectional));
    for (id, len) in ids.into_iter().zip(LENS) {
        raw.peer.send(id, &filler(0, len), true);
    }
    let (mut limit, mut stream_limits, mut ahead) = (window, [stream_window; 3], None);
    for _ in 0..1000 {
        raw.forget();
        raw.advance(RTT / 4);
        let lens = ids.map(|id| raw.streams.get(&id).map_or(0, Vec::len));
        let done = lens.iter().zip(&LENS).take_while(|it| it.0 == it.1).count();
        if lens[0] > LENS[0] * 2 / 3 {
            ahead.get_or_insert(lens[1] + lens[2]);
        }
        let open = if reads_in_order { done + 1 } else { 3 };
        let (mut frames, read) = (String::from("ack"), lens.iter().take(open).sum::<usize>());
        if lens == LENS {
            return ahead.unwrap();
        }
        for ((id, len), limit) in ids.iter().zip(lens).zip(&mut stream_limits).take(open) {
            if *limit - len < stream_window / 2 {
                *limit = len + stream_window;
                frames += &format!(", max_stream_data {id} {limit}");
            }
        }
        if limit - read < window / 2 {
            limit = read + window;
            frames += &format!(", max_data {limit}");
        }
        raw.send(&frames);
    }
    panic!("stuck");
}

#[test]
fn little_goes_ahead_of_the_oldest_stream_unless_the_peer_reads_it() {
    for (window, stream_window, parts) in [
        (300_000, 9_000_000, 3),
        (400_000, 260_000, 15),
        (1_000_000, 9_000_000, 3),
        (1_500_000, 1_000_000, 3),
    ] {
        assert!(sent_ahead(true, window, stream_window) <= window / 32 * parts);
        assert!(sent_ahead(false, window, stream_window) > window / 6);
    }
}

#[test]
fn a_stream_that_the_peer_does_not_read_makes_way() {
    let raw = Raw::client().config(|it| it.sends_in_order = true);
    let mut raw = (raw.with("max_data=160000 max_stream_data_uni=80000")).connected();
    let ids = [(); 2].map(|()| raw.peer.open(Unidirectional));
    for id in ids {
        raw.peer.send(id, &filler(0, 100_000), true);
    }
    for _ in 0..5 {
        raw.advance(RTT);
        raw.forget();
        raw.send("ack");
    }
    assert_eq!(ids.map(|id| raw.streams[&id].len()), [80_000; 2]);
}

#[test]
fn short_and_incremental_streams_get_past_one_that_the_peer_does_not_read() {
    for (len, is_incremental) in [(20_000, false), (100_000, true)] {
        let raw = Raw::client().config(|it| it.sends_in_order = true);
        let raw = raw.with("max_data=320000 max_stream_data_uni=9000000 max_streams_uni=99");
        let mut raw = raw.connected();
        let [read, unread] = [(); 2].map(|()| raw.peer.open(Unidirectional));
        for id in [read, unread] {
            raw.peer.send(id, &filler(0, 9_000_000), true);
        }
        let mut last = None;
        for round in 0..30 {
            raw.advance(RTT);
            raw.forget();
            let sent = raw.streams.values().map(Vec::len).sum::<usize>();
            let limit = sent - raw.streams.get(&unread).map_or(0, Vec::len) + 320_000;
            raw.send(&format!("ack, max_data {limit}"));
            if round % 2 == 0 && raw.streams[&read].len() > 1_100_000 {
                assert!(last.is_none_or(|id| raw.streams[&id].len() == len));
                let id = *last.insert(raw.peer.open(Unidirectional));
                (raw.connection()).set_priority(StreamId(id), priority(3, is_incremental));
                raw.peer.send(id, &filler(0, len), true);
            }
        }
        assert!(last > Some(unread + 20));
        assert!(raw.streams[&read].len() < 9_000_000);
        assert!(raw.streams[&unread].len() <= 80_000);
    }
}

#[test]
fn credit_that_overtakes_an_acknowledgment_is_not_a_larger_window() {
    for (limit, expected) in [(90_000, 2_500..=2_500), (32_000, 14_000..=32_000)] {
        let raw = Raw::client().config(|it| it.sends_in_order = true);
        let raw = raw.with(&format!("max_data=32000 max_stream_data_uni={limit}"));
        let mut raw = raw.connected();
        let ids = [(); 2].map(|()| raw.peer.open(Unidirectional));
        raw.peer.send(ids[0], &filler(0, 32_000), false);
        raw.advance(RTT);
        let numbers = raw.take().iter().map(|it| it.number).collect::<Vec<_>>();
        let (first, last) = (numbers[0], numbers[numbers.len() - 1]);
        raw.send(&format!("ack {}-{last}, max_data 64000", first + 1));
        raw.connection().want_write(StreamId(ids[0]));
        raw.connection().await_data(StreamId(ids[0]), true);
        raw.forget();
        raw.peer.send(ids[1], &filler(0, 50_000), true);
        raw.advance(RTT);
        raw.forget();
        assert!(expected.contains(&raw.streams[&ids[1]].len()));
    }
}

#[test]
fn a_stream_keeps_its_place_while_data_is_awaited() {
    let raw = Raw::client().config(|it| it.sends_in_order = true);
    let mut raw = raw.with("max_data=160000").connected();
    let ids = [(); 2].map(|()| raw.peer.open(Unidirectional));
    raw.connection().want_write(StreamId(ids[0]));
    raw.connection().await_data(StreamId(ids[0]), true);
    raw.forget();
    raw.peer.send(ids[1], &filler(0, 50_000), true);
    for (is_awaited, expected) in [(true, 12_500), (false, 50_000)] {
        raw.connection().await_data(StreamId(ids[0]), is_awaited);
        assert_ne!(raw.frames(), "");
        raw.advance(RTT);
        raw.forget();
        raw.send("ack");
        raw.advance(RTT);
        raw.forget();
        assert_eq!(raw.streams[&ids[1]].len(), expected);
    }
}

/// A 64th of the window.
const PART: usize = 500;
const LONG: usize = 200;

/// With stream 3, for which data is awaited.
fn awaiting(parameters: &str) -> Raw {
    let raw = Raw::client().config(|it| it.sends_in_order = true);
    let mut raw = raw.with("max_data=32000").with(parameters).connected();
    raw.open_and_await();
    raw
}

impl Raw {
    fn open_and_await(&mut self) {
        let id = StreamId(self.peer.open(Unidirectional));
        self.connection().want_write(id);
        self.connection().await_data(id, true);
        self.forget();
    }

    fn parts(&mut self, id: u64) -> usize {
        self.advance(RTT);
        self.take();
        self.streams.get(&id).map_or(0, Vec::len) / PART
    }

    /// Returns how much of it gets through.
    fn start_stream(&mut self, parts: usize) -> usize {
        let id = self.peer.open(Unidirectional);
        self.peer.send(id, &filler(0, parts * PART), true);
        self.parts(id)
    }

    /// Of stream 3, and so many bytes of others.
    fn read_more(&mut self, others: usize) {
        self.peer.send(3, b"a", false);
        self.process();
        let limit = 64 * PART + self.streams[&3].len() + others;
        self.send(&format!("ack, max_data {limit}"));
    }
}

#[test]
fn long_streams_leave_some_of_what_can_go_ahead_to_short_ones() {
    for polls in [false, true] {
        let mut raw = awaiting("");
        raw.peer.polls = polls;
        let sent = [LONG, LONG, LONG, 1, 2, LONG].map(|it| raw.start_stream(it));
        assert_eq!(sent, [5, 1, 0, 1, 1, 0]);
        raw.peer.polls = true;
        assert_eq!(raw.events(), "19 closed");
    }
}

#[test]
fn more_can_go_ahead_while_the_oldest_stream_is_blocked() {
    let mut raw = awaiting("max_stream_data_uni=8000");
    raw.peer.send(3, &filler(0, LONG * PART), true);
    raw.forget();
    let sent = [LONG, LONG, LONG, 3, 3].map(|it| raw.start_stream(it));
    assert_eq!(sent, [16, 12, 0, 2, 0]);
    assert_eq!(raw.parts(15), 0);
}

#[test]
fn more_can_go_ahead_if_the_peer_reads_it() {
    for (max_read, expected, unasked) in [
        (0, [5, 5, 5, 5], PART),
        (2 * PART, [5, 6, 6, 6], PART),
        (2 * PART + 1, [5, 10, 10, 10], PART),
        (usize::MAX, [5, 13, 29, 45], 8192),
    ] {
        let mut raw = awaiting("");
        raw.start_stream(LONG);
        for expected in expected {
            assert_eq!(raw.parts(7), expected, "{max_read}");
            raw.waits = false;
            raw.read_more(max_read.min(raw.streams[&7].len()));
        }
        let id = StreamId(raw.peer.open(Unidirectional));
        let written = raw.connection().write(id, &filler(0, LONG * PART));
        assert_eq!(written, Some(unasked));
    }
}

#[test]
fn what_short_streams_send_ahead_stays_below_half_of_the_window() {
    let mut raw = awaiting("");
    assert_eq!([LONG, 60].map(|it| raw.start_stream(it)), [5, 3]);
    for expected in [7, 11, 15, 19, 23, 25, 25] {
        raw.read_more(0);
        assert_eq!(raw.parts(11), expected);
    }
    let id = raw.peer.open(Unidirectional);
    (raw.connection()).set_priority(StreamId(id), priority(3, true));
    raw.peer.send(id, b"a", true);
    raw.connection().want_write(StreamId(3));
    raw.read_more(0);
    assert_eq!((raw.parts(7), raw.parts(11)), (5, 25));
}

#[test]
fn who_can_pass_is_asked_at_once() {
    let mut raw = awaiting("");
    raw.start_stream(LONG);
    let ids = [(); 3].map(|()| StreamId(raw.peer.open(Unidirectional)));
    raw.connection().want_write(ids[0]);
    raw.connection().want_write(ids[1]);
    assert_eq!(raw.events(), "11 writable, 15 writable");
    raw.connection().want_write(ids[1]);
    assert_eq!(raw.events(), "");
    let data = filler(0, 9 * PART);
    assert_eq!(raw.connection().write(StreamId(3), &data), Some(9 * PART));
    raw.peer.send(11, &data[..3 * PART], true);
    raw.forget();
    for events in ["3 writable", ""] {
        raw.connection().want_write(StreamId(3));
        assert_eq!(raw.events(), events);
    }
    (raw.connection()).set_priority(ids[2], priority(3, true));
    raw.connection().want_write(ids[2]);
    assert_eq!(raw.events(), "19 writable");
}

#[test]
fn nothing_is_held_back_from_who_passes_a_long_response() {
    let mut raw = awaiting("");
    raw.start_stream(11 * LONG);
    let id = StreamId(raw.peer.open(Unidirectional));
    raw.connection().set_priority(id, priority(3, true));
    for (id, events) in [(StreamId(3), "3 writable"), (id, "11 writable")] {
        raw.connection().want_write(id);
        raw.peer.poll(raw.now);
        assert_eq!(raw.peer.events(), events);
    }
    let written = raw.connection().write(id, &filler(0, LONG * PART));
    assert_eq!(written, Some((64 - 5) * PART));
}

#[test]
fn a_stream_loses_its_place_with_its_urgency_or_its_end() {
    type Action = fn(&mut bun_quic::Connection, StreamId);
    let actions: [Action; 2] = [
        |it, id| it.set_priority(id, priority(4, false)),
        |it, id| it.finish(id),
    ];
    for action in actions {
        let mut raw = awaiting("");
        raw.start_stream(LONG);
        action(raw.connection(), StreamId(3));
        raw.send("ping");
        assert_eq!(raw.parts(7), 64);
    }
}

#[test]
fn a_stream_keeps_its_place_while_it_has_more_than_a_little_to_send() {
    for (parts, events) in [(4, "7 writable"), (5, "")] {
        let mut raw = awaiting("");
        raw.start_stream(LONG);
        raw.peer.send(3, &filler(0, parts * PART), false);
        raw.connection().await_data(StreamId(3), false);
        raw.peer.events();
        raw.peer.poll(raw.now);
        assert_eq!(raw.peer.events(), events);
    }
}

#[test]
fn what_is_reset_does_not_count_as_window() {
    let mut raw = awaiting("");
    for frames in ["ack", "ping"] {
        raw.peer.send(3, &filler(0, 16 * PART), false);
        raw.advance(RTT);
        raw.send(frames);
    }
    raw.connection().reset(StreamId(3), 0);
    raw.process();
    raw.send(&format!("ack, max_data {}", (32 + 128) * PART));
    raw.open_and_await();
    assert_eq!(raw.start_stream(LONG), 10);
}

#[test]
fn streams_take_turns_unless_one_is_more_urgent() {
    let mut raw = Raw::server().connected();
    for urgency in [3, 3, 2] {
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &filler(0, 20_000), false);
        (raw.connection()).set_priority(StreamId(id), priority(urgency, false));
    }
    assert_eq!(turns(&mut raw), [(10, 0), (2, 0), (6, 0), (2, 1), (6, 1)]);
}

#[test]
fn new_priority_leaves_the_other_streams_their_turns() {
    let raw = Raw::server().config(|it| it.sends_in_order = true);
    let mut raw = raw.connected();
    let ids = [(); 3].map(|()| raw.peer.open(Unidirectional));
    for id in ids.into_iter().rev() {
        (raw.connection()).set_priority(StreamId(id), priority(3, true));
        raw.peer.send(id, b"a", false);
        raw.connection().want_write(StreamId(id));
    }
    (raw.connection()).set_priority(StreamId(10), priority(4, true));
    raw.peer.polls = false;
    assert_eq!(raw.frames(), "stream 6 0 a, stream 2 0 a, stream 10 0 a");
    raw.peer.polls = true;
    assert_eq!(raw.events(), "6 writable, 2 writable, 10 writable");
}

#[test]
fn fills_packets_to_the_last_byte() {
    for len in 1090..1180 {
        let mut raw = Raw::server().connected();
        for (id, len) in [(2, len), (6, 70), (10, 1), (14, 0)] {
            raw.peer.open(Unidirectional);
            raw.peer.send(id, &filler(0, len), true);
        }
        let frames = raw.frames();
        let frames = groups(&frames);
        assert_eq!(frames.iter().filter(|it| it[0] == "fin").count(), 4);
        assert!(!frames.iter().any(|it| it[0] == "stream" && it[3] == "-"));
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
    for sends_in_order in [false, true] {
        for limit in ["max_data=0", "max_stream_data_uni=0", ""] {
            let raw = Raw::server().config(|it| it.sends_in_order = sends_in_order);
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
fn streams_that_are_gone_leave_no_room_unused() {
    let mut raw = Raw::server()
        .config(|it| it.sends_in_order = true)
        .connected();
    for (id, len) in [(2, 60_000), (6, 1), (10, 1)] {
        raw.peer.open(Unidirectional);
        raw.peer.send(id, &filler(0, len), true);
    }
    raw.connection().reset(StreamId(6), 0);
    raw.advance(RTT);
    raw.send("ack");
    raw.advance(RTT);
    let last = raw.take().pop().unwrap().frames;
    assert!(last[0].starts_with("fin 2 ") && last[1] == "fin 10 0 a");
}

#[test]
fn urgent_streams_are_writable_first() {
    let mut raw = Raw::server()
        .config(|it| it.sends_in_order = true)
        .connected();
    for urgency in [3, 1, 2] {
        let id = StreamId(raw.peer.open(Unidirectional));
        raw.connection().set_priority(id, priority(urgency, false));
        raw.connection().want_write(id);
    }
    assert_eq!(raw.events(), "6 writable, 10 writable, 2 writable");
}

#[test]
fn frames_about_a_stream_are_sent_once() {
    let mut raw = Raw::server().connected();
    let id = StreamId(raw.peer.open(Bidirectional));
    raw.connection().stop(id, 1);
    assert_eq!(raw.frames(), "stop_sending 0 0x1");
    raw.connection().reset(id, 2);
    assert_eq!(raw.frames(), "reset_stream 0 0x2 0");
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
