use crate::{
    Answer, Audience, Body, Due, Event, Frame, FrameError, Inbox, Kind, Link, Mode, Outbox, Packet,
    Reply, Unacked,
    WriteReason::{self, Queued, Writable},
    Wrote, encode_advanced, encode_json,
};
use core::cell::Cell;

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}

thread_local! {
    static SCANNED: Cell<usize> = const { Cell::new(0) };
}

/// Stands in for highway_strings.cpp, which test/js/bun/util/highway-strings.test.ts covers.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(text: *const u8, len: usize, needle: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { core::slice::from_raw_parts(text, len) };
    let index = text.iter().take_while(|&&byte| byte != needle).count();
    SCANNED.set(SCANNED.get() + index);
    index
}

const MODES: [Mode; 2] = [Mode::Advanced, Mode::Json];
const NO_LIMIT: usize = i32::MAX as usize;
const MB: usize = 1024 * 1024;

type Read = Result<Option<Frame<Vec<u8>>>, FrameError>;

fn owned(frame: Frame<Body<'_>>) -> Frame<Vec<u8>> {
    match frame {
        Frame::Version => Frame::Version,
        Frame::Message(kind, Body::Clone(body) | Body::Json(body)) => {
            Frame::Message(kind, body.to_vec())
        }
    }
}

fn next(inbox: &mut Inbox, max: usize) -> Read {
    inbox.next(max, owned)
}

fn first(mode: Mode, bytes: &[u8], max: usize) -> Read {
    let mut inbox = Inbox::new(mode);
    match inbox.receive(bytes, max, owned)? {
        Some(frame) => Ok(Some(frame)),
        None => next(&mut inbox, max),
    }
}

fn encode(mode: Mode, audience: Audience, body: &[u8]) -> Vec<u8> {
    match (mode, audience) {
        (Mode::Json, _) => encode_json(audience, body),
        (Mode::Advanced, Audience::User) => encode_advanced(Kind::Data, body).unwrap(),
        (Mode::Advanced, Audience::Cluster) => encode_advanced(Kind::Internal, body).unwrap(),
    }
    .0
}

#[test]
fn bytes_on_the_wire() {
    use {Audience::*, Mode::*};
    assert_eq!(Advanced.version_packet(), Some(Packet(vec![1, 2, 0, 0, 0])));
    assert_eq!(Json.version_packet(), None);
    assert_eq!(encode(Advanced, User, b"ab"), b"\x02\x02\0\0\0ab");
    assert_eq!(encode(Advanced, Cluster, b"ab"), b"\x03\x02\0\0\0ab");
    let with_buffers = encode_advanced(Kind::DataWithBuffers, b"");
    assert_eq!(with_buffers.unwrap().0, b"\x04\0\0\0\0");
    assert_eq!(encode(Json, User, b"1"), b"1\n");
    assert_eq!(encode(Json, Cluster, b"1"), b"\x021\n");
    let too_long_for_the_header = vec![0; u32::MAX as usize + 1];
    assert_eq!(encode_advanced(Kind::Data, &too_long_for_the_header), None);
    for mode in MODES {
        for reply in [Reply::Ack, Reply::Nack] {
            let packet = mode.reply_packet(reply).bytes();
            let Ok(Some(Frame::Message(Kind::Data, body))) = first(mode, packet, NO_LIMIT) else {
                panic!("{mode:?} {reply:?}");
            };
            assert_eq!(encode(mode, User, &body), packet);
        }
    }
}

#[test]
fn any_split_gives_the_same_frames() {
    for mode in MODES {
        let mut stream = mode.version_packet().map_or(vec![], |it| it.0);
        stream.extend(encode(mode, Audience::User, b"\"a\""));
        stream.extend(encode(mode, Audience::Cluster, b"{}"));
        stream.extend(encode(mode, Audience::User, &[b'7'; 40]));
        let mut frames = vec![
            Frame::Message(Kind::Data, b"\"a\"".to_vec()),
            Frame::Message(Kind::Internal, b"{}".to_vec()),
            Frame::Message(Kind::Data, vec![b'7'; 40]),
        ];
        if mode == Mode::Advanced {
            frames.insert(0, Frame::Version);
        }
        let mut ways: Vec<Vec<&[u8]>> = vec![stream.chunks(1).collect()];
        ways.extend((0..=stream.len()).map(|at| vec![&stream[..at], &stream[at..]]));
        for reads in ways {
            // A nested read appends while the outer one has taken only its first frame.
            for more_per_read in [0, usize::MAX] {
                for into_the_buffer in [false, true] {
                    let (mut inbox, mut got) = (Inbox::new(mode), Vec::new());
                    for &(mut read) in &reads {
                        if into_the_buffer {
                            inbox.buffer().extend_from_slice(core::mem::take(&mut read));
                        }
                        got.extend(inbox.receive(read, NO_LIMIT, owned).unwrap());
                        let frames = core::iter::from_fn(|| next(&mut inbox, NO_LIMIT).unwrap());
                        got.extend(frames.take(more_per_read));
                    }
                    got.extend(core::iter::from_fn(|| next(&mut inbox, NO_LIMIT).unwrap()));
                    assert_eq!(got, frames);
                    assert!(inbox.buffer().is_empty());
                }
            }
        }
    }
}

#[test]
fn only_the_first_advanced_frame_is_not_copied() {
    let frame = encode(Mode::Advanced, Audience::User, b"ab");
    let mut inbox = Inbox::new(Mode::Advanced);
    assert_eq!(inbox.receive(&frame, NO_LIMIT, |_| ()), Ok(Some(())));
    assert_eq!(inbox.buffer().capacity(), 0);
    assert_eq!(
        inbox.receive(&frame.repeat(3), NO_LIMIT, |_| ()),
        Ok(Some(()))
    );
    assert_eq!(*inbox.buffer(), frame.repeat(2));
}

#[test]
fn only_a_split_advanced_frame_grows_the_buffer_for_good() {
    let frame = encode(Mode::Advanced, Audience::User, &[b'1'; 1000]);
    let mut inbox = Inbox::new(Mode::Advanced);
    let mut capacity_after = |read: &[u8]| {
        inbox.receive(read, NO_LIMIT, |_| ()).unwrap();
        while next(&mut inbox, NO_LIMIT).unwrap().is_some() {}
        inbox.buffer().capacity()
    };
    assert_eq!(capacity_after(&frame.repeat(100)), 0);
    capacity_after(&frame[..1]);
    let kept = capacity_after(&frame[1..]);
    assert!(kept >= frame.len());
    assert_eq!(capacity_after(&frame.repeat(100)), kept);

    inbox.receive(&frame.repeat(100), NO_LIMIT, |_| ()).unwrap();
    inbox.receive(&frame, NO_LIMIT, |_| ()).unwrap();
    while next(&mut inbox, NO_LIMIT).unwrap().is_some() {}
    assert_eq!(inbox.buffer().capacity(), kept, "nested read");
}

#[test]
fn advanced_rejects_from_the_header() {
    let first = |bytes: &[u8], max| first(Mode::Advanced, bytes, max);
    for tag in (0..=u8::MAX).filter(|tag| !(1..=4).contains(tag)) {
        assert_eq!(first(&[tag, 0, 0, 0], 9), Ok(None));
        assert_eq!(first(&[tag, 0, 0, 0, 0], 9), Err(FrameError::Invalid));
    }
    assert_eq!(first(&[2, 9, 0, 0, 0], 9), Ok(None));
    assert_eq!(first(&[2, 10, 0, 0, 0], 9), Err(FrameError::Invalid));
    assert_eq!(first(&[2, 255, 255, 255, 255, 0], usize::MAX), Ok(None));
    let version = first(&[1, 255, 255, 255, 255, 7], 0);
    assert_eq!(version, Ok(Some(Frame::Version)));
}

#[test]
fn json_lines() {
    assert_eq!(first(Mode::Json, b"\n", 9), Err(FrameError::Invalid));
    assert_eq!(first(Mode::Json, b"\x02\n", 9), Err(FrameError::Invalid));
    assert_eq!(first(Mode::Json, b"\x02", 9), Ok(None));
    let twice = Ok(Some(Frame::Message(Kind::Internal, vec![2])));
    assert_eq!(first(Mode::Json, b"\x02\x02\n", 9), twice);
    // Three bytes for each code unit, and the tag.
    assert_eq!(first(Mode::Json, b"1234567", 2), Ok(None));
    assert!(matches!(first(Mode::Json, b"1234567\n", 2), Ok(Some(_))));
    assert_eq!(
        first(Mode::Json, b"12345678", 2),
        Err(FrameError::LineTooLong)
    );
    assert_eq!(
        first(Mode::Json, b"12345678\n", 2),
        Err(FrameError::LineTooLong)
    );
}

#[test]
fn json_scans_each_byte_once() {
    let mut inbox = Inbox::new(Mode::Json);
    for _ in 0..100 {
        inbox.buffer().extend_from_slice(&[b'1'; 1000]);
        assert_eq!(next(&mut inbox, NO_LIMIT), Ok(None));
    }
    assert_eq!(SCANNED.get(), 100 * 1000);
}

fn inbox_after_reading(mode: Mode, body_len: usize, unread: &[u8]) -> Inbox {
    let mut inbox = Inbox::new(mode);
    *inbox.buffer() = encode(mode, Audience::User, &vec![b'1'; body_len]);
    inbox.buffer().extend_from_slice(unread);
    assert_eq!(inbox.receive(&[], NO_LIMIT, |_| ()), Ok(None));
    assert_eq!(inbox.next(NO_LIMIT, |_| ()), Ok(Some(())));
    assert_eq!(next(&mut inbox, NO_LIMIT), Ok(None));
    inbox
}

#[test]
fn only_a_json_buffer_of_16_mb_is_freed() {
    let is_freed = |mode, len| inbox_after_reading(mode, len, b"").buffer().capacity() == 0;
    assert!(is_freed(Mode::Json, 16 * MB));
    assert!(!is_freed(Mode::Json, MB));
    assert!(!is_freed(Mode::Advanced, 16 * MB));
}

#[test]
fn json_moves_the_unread_bytes_only_after_16_mb() {
    let is_moved = |mode, len| inbox_after_reading(mode, len, b"1").buffer() == b"1";
    assert!(is_moved(Mode::Json, 16 * MB));
    assert!(!is_moved(Mode::Json, MB));
    assert!(is_moved(Mode::Advanced, MB));
}

type Out = Outbox<&'static str, Vec<u8>>;

fn push(out: &mut Out, bytes: Vec<u8>, handle: Option<&'static str>, callback: Option<u8>) {
    let pushed = out.push(Packet(bytes), handle, |callbacks| {
        callbacks.extend(callback);
        Ok::<_, ()>(())
    });
    assert_eq!(pushed, Ok(()));
}

fn reply(out: &mut Out, reply: Reply) {
    out.push_reply(Mode::Json.reply_packet(reply));
}

const ACK: &str = r#"{\"cmd\":\"NODE_HANDLE_ACK\"}\n"#;
const NACK: &str = r#"{\"cmd\":\"NODE_HANDLE_NACK\"}\n"#;

/// One write, of which the transport takes at most `room` bytes: `"<bytes offered> with <handle>, <result>"`.
fn write(out: &mut Out, reason: WriteReason, room: usize) -> Option<String> {
    let (mut text, mut handle) = (String::new(), String::new());
    let wrote = out.write(reason, |write| {
        let (bytes, sent) = (write.bytes(), write.handle());
        text = bytes.escape_ascii().to_string();
        handle = sent.map_or(String::new(), |it| format!(" with {it}"));
        Some(bytes.len().min(room))
    })?;
    Some(match wrote {
        Wrote::Continue => format!("{text}{handle}"),
        Wrote::Sent(callbacks) => format!("{text}{handle}, calls {callbacks:?}"),
        Wrote::Blocked => format!("{text}{handle}, blocked"),
        Wrote::Failed => unreachable!(),
    })
}

fn answer(out: &mut Out, reply: Reply) -> String {
    match out.answer(reply, |_, _| {}, |handle| *handle) {
        Answer::Stray => "stray".into(),
        Answer::Resent => "resent".into(),
        Answer::Acked(it) => format!("acked {}, calls {:?}", it.handle, it.callbacks),
        Answer::GaveUp(handle) => format!("gave up {handle}"),
    }
}

fn flush(out: &mut Out) -> Vec<String> {
    core::iter::from_fn(|| write(out, Writable, usize::MAX)).collect()
}

#[test]
fn plain_messages_are_written_together() {
    let mut out = Out::default();
    push(&mut out, b"a".into(), None, Some(1));
    push(&mut out, b"b".into(), None, None);
    push(&mut out, b"c".into(), None, Some(3));
    push(&mut out, b"H".into(), Some("h"), Some(4));
    push(&mut out, b"d".into(), None, Some(5));
    assert!(!out.is_backed_up());
    assert_eq!(flush(&mut out), ["abc, calls [1, 3]", "H with h"]);
    assert!(out.is_backed_up() && out.unacked().is_some());
    assert_eq!(answer(&mut out, Reply::Ack), "acked h, calls [4]");
    assert_eq!(flush(&mut out), ["d, calls [5]"]);
    assert!(out.idle().is_some());
}

#[test]
fn a_message_is_not_queued_without_its_callback() {
    let mut out = Out::default();
    assert_eq!(out.push(Packet(b"a".into()), None, |_| Err(1)), Err(1));
    assert!(out.idle().is_some());
    push(&mut out, b"b".into(), None, Some(2));
    assert_eq!(out.push(Packet(b"c".into()), None, |_| Err(3)), Err(3));
    assert_eq!(flush(&mut out), ["b, calls [2]"]);
}

#[test]
fn nothing_joins_or_passes_what_the_transport_has() {
    let mut out = Out::default();
    push(&mut out, b"ab".into(), None, Some(1));
    assert_eq!(write(&mut out, Queued, 0).unwrap(), "ab, blocked");
    push(&mut out, b"c".into(), None, Some(2));
    assert_eq!(write(&mut out, Queued, 1).unwrap(), "abc, blocked");
    assert_eq!(write(&mut out, Queued, 9), None);
    push(&mut out, b"d".into(), None, Some(3));
    reply(&mut out, Reply::Ack);
    reply(&mut out, Reply::Nack);
    push(&mut out, b"e".into(), None, None);
    assert_eq!(
        flush(&mut out),
        ["bc, calls [1, 2]", NACK, ACK, "de, calls [3]"]
    );

    push(&mut out, b"a".into(), None, Some(1));
    let in_flight = out.begin_write(Queued).unwrap();
    assert!(out.begin_write(Writable).is_none() && out.idle().is_none());
    push(&mut out, b"b".into(), None, Some(2));
    push(&mut out, b"c".into(), None, Some(3));
    reply(&mut out, Reply::Ack);
    assert!(matches!(out.end_write(in_flight, Some(1)), Wrote::Sent(it) if it[..] == [1]));
    assert_eq!(flush(&mut out), [ACK, "bc, calls [2, 3]"]);
}

#[test]
fn a_handle_goes_with_the_first_byte_three_times() {
    let mut out = Out::default();
    assert_eq!(answer(&mut out, Reply::Ack), "stray");
    assert_eq!(answer(&mut out, Reply::Nack), "stray");
    push(&mut out, b"HH".into(), Some("h"), Some(1));
    push(&mut out, b"a".into(), None, Some(2));
    assert_eq!(write(&mut out, Queued, 0).unwrap(), "HH with h, blocked");
    assert_eq!(write(&mut out, Queued, 1).unwrap(), "HH with h, blocked");
    assert_eq!(answer(&mut out, Reply::Ack), "stray");
    assert_eq!(flush(&mut out), ["H"]);
    reply(&mut out, Reply::Ack);
    let all_but_the_newline = Mode::Json.reply_packet(Reply::Ack).bytes().len() - 1;
    assert!(write(&mut out, Queued, all_but_the_newline).is_some());
    let refresh = |handle: &mut _, bytes: &mut [u8]| (*handle, bytes[1]) = ("g", b'G');
    let resent = out.answer(Reply::Nack, refresh, |_| unreachable!());
    assert!(matches!(resent, Answer::Resent) && out.unacked().is_none());
    assert_eq!(flush(&mut out), ["\\n", "HG with g"]);
    assert_eq!(answer(&mut out, Reply::Nack), "resent");
    assert_eq!(flush(&mut out), ["HG with g"]);
    assert_eq!(answer(&mut out, Reply::Nack), "gave up g");
    assert_eq!(answer(&mut out, Reply::Nack), "gave up g");
    assert!(out.is_backed_up());
    assert_eq!(out.take_unacked().unwrap().callbacks, [1]);
    push(&mut out, b"I".into(), Some("i"), None);
    assert_eq!(flush(&mut out), ["a, calls [2]", "I with i"]);
    assert_eq!(answer(&mut out, Reply::Nack), "resent");
}

#[test]
fn a_resent_handle_passes_a_reply_that_has_not_started() {
    let mut out = Out::default();
    push(&mut out, b"H".into(), Some("h"), None);
    assert_eq!(flush(&mut out), ["H with h"]);
    assert!(!out.is_backed_up());
    reply(&mut out, Reply::Ack);
    assert!(write(&mut out, Queued, 0).is_some() && out.is_backed_up());
    assert_eq!(answer(&mut out, Reply::Nack), "resent");
    reply(&mut out, Reply::Nack);
    assert_eq!(flush(&mut out), [NACK, "H with h", ACK]);
}

#[test]
fn the_peer_answers_while_a_reply_is_in_flight() {
    for (answered, rest) in [(Reply::Ack, "a, calls [2]"), (Reply::Nack, "H with h")] {
        for left in [0, 1] {
            let mut out = Out::default();
            push(&mut out, b"H".into(), Some("h"), Some(1));
            assert_eq!(flush(&mut out), ["H with h"]);
            reply(&mut out, Reply::Ack);
            let in_flight = out.begin_write(Queued).unwrap();
            assert!(out.is_backed_up());
            push(&mut out, b"a".into(), None, Some(2));
            assert_ne!(answer(&mut out, answered), "stray");
            assert!(out.begin_write(Writable).is_none());
            let written = in_flight.bytes().len() - left;
            let wrote = out.end_write(in_flight, Some(written));
            assert_eq!(matches!(wrote, Wrote::Blocked), left == 1);
            assert_eq!(flush(&mut out), ["\\n", rest][1 - left..]);
        }
    }
}

#[test]
fn a_write_is_capped_and_goes_on() {
    let mut out = Out::default();
    push(&mut out, vec![0; i32::MAX as usize + 1], None, Some(1));
    let write = out.begin_write(Queued).unwrap();
    let capped = write.bytes().len();
    assert_eq!(capped, i32::MAX as usize);
    let wrote = out.end_write(write, Some(capped));
    assert!(matches!(wrote, Wrote::Continue));
    assert_eq!(flush(&mut out), ["\\x00, calls [1]"]);
}

#[test]
fn a_write_that_reports_too_much_failed() {
    let mut out = Out::default();
    push(&mut out, b"abc".into(), Some("h"), None);
    assert_eq!(write(&mut out, Queued, 1).unwrap(), "abc with h, blocked");
    let write = out.begin_write(Writable).unwrap();
    assert!(matches!(out.end_write(write, Some(3)), Wrote::Failed));
    assert_eq!(flush(&mut out), ["bc"]);
}

#[test]
fn what_is_left_at_the_close() {
    for written in [0, 1] {
        let mut out = Out::default();
        push(&mut out, b"HH".into(), Some("h"), Some(1));
        assert!(write(&mut out, Queued, written).is_some());
        let in_flight = out.begin_write(Writable).unwrap();
        push(&mut out, b"a".into(), None, Some(2));
        push(&mut out, b"G".into(), Some("g"), Some(3));
        reply(&mut out, Reply::Ack);
        out.cancel_write(in_flight);
        assert!(out.take_unacked().is_none());
        assert_eq!(out.take_unsent().collect::<Vec<_>>(), ["h", "g"]);
        assert!(out.idle().is_some());
    }
}

fn unacked() -> Unacked {
    let mut out = Out::default();
    push(&mut out, b"H".into(), Some("h"), None);
    flush(&mut out);
    out.unacked().unwrap()
}

type Channel = Link<char, u8>;

fn describe(link: &mut Channel) -> &'static str {
    let (owner, due) = (link.owner(), link.due());
    let flags = (link.is_open(), link.closes_after_write(), link.is_over());
    match (owner, link.live().map(|it| *it.1), due, flags) {
        (Some('o'), Some(7), Due::Nothing, (true, false, false)) => "open",
        (Some('o'), Some(7), Due::Nothing, (false, false, false)) => "draining",
        (Some('o'), Some(7), Due::Close, (false, false, false)) => "closing",
        (Some('o'), Some(7), Due::ReadAndClose, (false, false, false)) => "after read",
        (Some('o'), Some(7), Due::Nothing, (false, true, false)) => "after write",
        (Some('o'), None, Due::Nothing, (false, false, false)) => "closed",
        (Some('o'), None, Due::Nothing, (false, false, true)) => "reported",
        (None, None, Due::Nothing, (false, false, true)) => "detached",
        other => panic!("{other:?}"),
    }
}

#[test]
fn every_state_and_step_of_a_link() {
    // Each returns whether the caller has something to do.
    let steps: [(&str, fn(&mut Channel) -> bool); 9] = [
        ("disconnect", |it| it.advance(Event::Disconnect).is_some()),
        ("early", |it| {
            it.advance(Event::DisconnectBeforeAck(unacked())).is_some()
        }),
        ("idle", |it| {
            let idle = Out::default().idle().unwrap();
            it.advance(Event::Idle(idle)).is_some()
        }),
        ("exit", |it| it.advance(Event::PeerExited).is_some()),
        ("read error", |it| it.advance(Event::ReadFailed).is_some()),
        ("blocked", |it| it.advance(Event::CloseBlocked).is_some()),
        ("close", |it| it.close().is_some()),
        ("report", |it| it.report().is_some()),
        ("detach", |it| it.detach().is_some()),
    ];
    let changes = [
        ("open", "disconnect", "closing", true),
        ("open", "early", "draining", false),
        ("open", "exit", "after read", true),
        ("open", "read error", "closing", true),
        ("open", "blocked", "after write", false),
        ("open", "close", "closed", true),
        ("open", "detach", "detached", true),
        ("draining", "disconnect", "closing", true),
        ("draining", "idle", "closing", true),
        ("draining", "exit", "after read", true),
        ("draining", "read error", "closing", true),
        ("draining", "blocked", "after write", false),
        ("draining", "close", "closed", true),
        ("draining", "detach", "detached", true),
        ("closing", "blocked", "after write", false),
        ("closing", "close", "closed", true),
        ("closing", "detach", "detached", true),
        ("after read", "blocked", "after write", false),
        ("after read", "close", "closed", true),
        ("after read", "detach", "detached", true),
        ("after write", "close", "closed", true),
        ("after write", "detach", "detached", true),
        ("closed", "report", "reported", true),
        ("closed", "detach", "detached", false),
        ("reported", "detach", "detached", false),
    ];
    assert_eq!(describe(&mut Link::detached()), "detached");
    let mut seen = 0;
    // Two steps reach every state.
    for (_, first) in steps {
        for (_, second) in steps {
            for (name, step) in steps {
                let mut link = Link::open('o', 7);
                first(&mut link);
                second(&mut link);
                let from = describe(&mut link);
                let listed = changes.iter().position(|it| (it.0, it.1) == (from, name));
                let expected = listed.map_or((from, false), |at| (changes[at].2, changes[at].3));
                let has_work = step(&mut link);
                assert_eq!((describe(&mut link), has_work), expected, "{from}, {name}");
                seen |= listed.map_or(0u32, |at| 1 << at);
            }
        }
    }
    assert_eq!(seen.count_ones() as usize, changes.len());
}
