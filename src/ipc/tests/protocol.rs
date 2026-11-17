use bun_ipc::{
    Event, Frame, FrameError, Inbox, Kind, Mode, Outbox, Payload, Phase, Reply,
    WriteReason::{self, Queued, Writable},
    Wrote, advanced_frame,
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

type Read = Result<Option<(Kind, Vec<u8>)>, FrameError>;

fn next(inbox: &mut Inbox, max: usize) -> Read {
    inbox.next(max, |frame| (frame.kind, frame.body.to_vec()))
}

fn first(mode: Mode, bytes: &[u8], max: usize) -> Read {
    let mut inbox = Inbox::new(mode);
    inbox.buffer().extend_from_slice(bytes);
    next(&mut inbox, max)
}

fn encode(mode: Mode, kind: Kind, body: &[u8]) -> Vec<u8> {
    mode.encode(kind, body).unwrap()
}

#[test]
fn bytes_on_the_wire() {
    use {Kind::*, Mode::*};
    assert_eq!(Advanced.version_packet(), Some(&[1, 2, 0, 0, 0][..]));
    assert_eq!(Json.version_packet(), None);
    assert_eq!(encode(Advanced, Data, b"ab"), b"\x02\x02\0\0\0ab");
    assert_eq!(encode(Advanced, Internal, b"ab"), b"\x03\x02\0\0\0ab");
    assert_eq!(encode(Advanced, DataWithBuffers, b""), b"\x04\0\0\0\0");
    assert_eq!(encode(Json, Data, b"1"), b"1\n");
    assert_eq!(encode(Json, Internal, b"1"), b"\x021\n");
    let too_long_for_the_header = vec![0; u32::MAX as usize + 1];
    assert_eq!(Advanced.encode(Data, &too_long_for_the_header), None);
    for mode in MODES {
        for reply in [Reply::Ack, Reply::Nack] {
            let packet = mode.reply_packet(reply);
            let (kind, body) = first(mode, packet, NO_LIMIT).unwrap().unwrap();
            assert_eq!((kind, encode(mode, kind, &body)), (Data, packet.to_vec()));
        }
    }
}

#[test]
fn any_split_gives_the_same_frames() {
    for mode in MODES {
        let mut frames = vec![
            (Kind::Data, b"\"a\"".to_vec()),
            (Kind::Internal, b"{}".to_vec()),
            (Kind::Data, vec![b'7'; 40]),
        ];
        let mut stream = mode.version_packet().unwrap_or_default().to_vec();
        stream.extend(frames.iter().flat_map(|(kind, it)| encode(mode, *kind, it)));
        if mode == Mode::Advanced {
            frames.insert(0, (Kind::Version, Vec::new()));
        }
        let mut ways: Vec<Vec<&[u8]>> = vec![stream.chunks(1).collect()];
        ways.extend((0..=stream.len()).map(|at| vec![&stream[..at], &stream[at..]]));
        for reads in ways {
            // A nested read appends while the outer one has taken only its first frame.
            for per_read in [1, usize::MAX] {
                let (mut inbox, mut got) = (Inbox::new(mode), Vec::new());
                for read in &reads {
                    inbox.buffer().extend_from_slice(read);
                    let frames = core::iter::from_fn(|| next(&mut inbox, NO_LIMIT).unwrap());
                    got.extend(frames.take(per_read));
                }
                got.extend(core::iter::from_fn(|| next(&mut inbox, NO_LIMIT).unwrap()));
                assert_eq!(got, frames);
                assert!(inbox.is_empty());
            }
        }
    }
}

#[test]
fn advanced_rejects_from_the_header() {
    for tag in (0..=u8::MAX).filter(|tag| !(1..=4).contains(tag)) {
        assert_eq!(advanced_frame(&[tag, 0, 0, 0], 9), Ok(None));
        let invalid = advanced_frame(&[tag, 0, 0, 0, 0], 9).err();
        assert_eq!(invalid, Some(FrameError::Invalid));
    }
    assert_eq!(advanced_frame(&[2, 9, 0, 0, 0], 9), Ok(None));
    assert_eq!(
        advanced_frame(&[2, 10, 0, 0, 0], 9),
        Err(FrameError::Invalid)
    );
    assert_eq!(
        advanced_frame(&[2, 255, 255, 255, 255, 0], usize::MAX),
        Ok(None)
    );
    let version = Frame {
        kind: Kind::Version,
        body: &[],
        len: 5,
    };
    assert_eq!(
        advanced_frame(&[1, 255, 255, 255, 255, 7], 0),
        Ok(Some(version))
    );
}

#[test]
fn json_lines() {
    assert_eq!(first(Mode::Json, b"\n", 9), Err(FrameError::Invalid));
    assert_eq!(first(Mode::Json, b"\x02\n", 9), Err(FrameError::Invalid));
    assert_eq!(first(Mode::Json, b"\x02", 9), Ok(None));
    let twice = Ok(Some((Kind::Internal, vec![2])));
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
    *inbox.buffer() = encode(mode, Kind::Data, &vec![b'1'; body_len]);
    inbox.buffer().extend_from_slice(unread);
    assert_eq!(
        inbox.next(NO_LIMIT, |frame| frame.body.len()),
        Ok(Some(body_len))
    );
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
    let pushed = out.push(bytes, handle, |callbacks| {
        callbacks.extend(callback);
        Ok::<_, ()>(())
    });
    assert_eq!(pushed, Ok(()));
}

/// One write, of which the transport takes at most `room` bytes: `"<bytes offered> with <handle>, <result>"`.
fn write(out: &mut Out, reason: WriteReason, room: usize) -> Option<String> {
    let (bytes, handle) = out.begin_write(reason)?;
    let handle = handle.map_or(String::new(), |handle| format!(" with {handle}"));
    let (text, len) = (bytes.escape_ascii().to_string(), bytes.len());
    Some(match out.end_write(Some(len.min(room))) {
        Wrote::Continue(it) if it.is_empty() => format!("{text}{handle}"),
        Wrote::Continue(callbacks) => format!("{text}{handle}, calls {callbacks:?}"),
        Wrote::Blocked => format!("{text}{handle}, blocked"),
        Wrote::Failed => unreachable!(),
    })
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
    assert!(out.is_backed_up() && out.unacked() == Some(&"h"));
    let offer = out.take_unacked().unwrap();
    assert_eq!((offer.handle, offer.callbacks), ("h", vec![4]));
    assert_eq!(flush(&mut out), ["d, calls [5]"]);
    assert!(out.is_idle());
}

#[test]
fn a_message_is_not_queued_without_its_callback() {
    let mut out = Out::default();
    assert_eq!(out.push(b"a".into(), None, |_| Err(1)), Err(1));
    assert!(out.is_idle());
    push(&mut out, b"b".into(), None, Some(2));
    assert_eq!(out.push(b"c".into(), None, |_| Err(3)), Err(3));
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
    out.push_reply(b"1");
    out.push_reply(b"2");
    push(&mut out, b"e".into(), None, None);
    assert_eq!(
        flush(&mut out),
        ["bc, calls [1, 2]", "2", "1", "de, calls [3]"]
    );

    push(&mut out, b"a".into(), None, Some(1));
    assert!(out.begin_write(Queued).is_some());
    assert!(out.begin_write(Writable).is_none());
    push(&mut out, b"b".into(), None, Some(2));
    push(&mut out, b"c".into(), None, Some(3));
    out.push_reply(b"1");
    assert!(matches!(out.end_write(Some(1)), Wrote::Continue(it) if it[..] == [1]));
    assert_eq!(flush(&mut out), ["1", "bc, calls [2, 3]"]);
}

#[test]
fn a_handle_goes_with_the_first_byte_three_times() {
    let mut out = Out::default();
    assert!(!out.resend(|_, _| unreachable!()));
    push(&mut out, b"HH".into(), Some("h"), Some(1));
    push(&mut out, b"a".into(), None, Some(2));
    assert_eq!(write(&mut out, Queued, 0).unwrap(), "HH with h, blocked");
    assert_eq!(write(&mut out, Queued, 1).unwrap(), "HH with h, blocked");
    assert_eq!(flush(&mut out), ["H"]);
    out.push_reply(b"12");
    assert_eq!(write(&mut out, Queued, 1).unwrap(), "12, blocked");
    assert!(out.resend(|handle, bytes| (*handle, bytes[1]) = ("g", b'G')));
    assert_eq!(out.unacked(), None);
    assert_eq!(flush(&mut out), ["2", "HG with g"]);
    assert!(out.resend(|_, _| {}));
    assert_eq!(flush(&mut out), ["HG with g"]);
    assert!(!out.resend(|_, _| unreachable!()));
    assert_eq!(out.unacked(), Some(&"g"));
    out.take_unacked();
    push(&mut out, b"I".into(), Some("i"), None);
    assert_eq!(flush(&mut out), ["a, calls [2]", "I with i"]);
    assert!(out.resend(|_, _| {}));
}

#[test]
fn a_write_is_capped_and_goes_on() {
    let mut out = Out::default();
    push(&mut out, vec![0; i32::MAX as usize + 1], None, Some(1));
    let capped = out.begin_write(Queued).unwrap().0.len();
    assert_eq!(capped, i32::MAX as usize);
    assert!(matches!(out.end_write(Some(capped)), Wrote::Continue(it) if it.is_empty()));
    assert_eq!(flush(&mut out), ["\\x00, calls [1]"]);
}

#[test]
fn a_write_that_reports_too_much_failed() {
    let mut out = Out::default();
    push(&mut out, b"abc".into(), Some("h"), None);
    assert_eq!(write(&mut out, Queued, 1).unwrap(), "abc with h, blocked");
    assert!(out.begin_write(Writable).is_some());
    assert!(matches!(out.end_write(Some(3)), Wrote::Failed));
}

#[test]
fn what_is_left_at_the_close() {
    let mut out = Out::default();
    push(&mut out, b"a".into(), None, Some(1));
    assert!(out.begin_write(Queued).is_some());
    assert!(matches!(out.end_write(None), Wrote::Failed));
    push(&mut out, b"H".into(), Some("h"), Some(2));
    assert!(out.begin_write(Queued).is_some());
    out.push_reply(b"1");
    let unsent: Vec<_> = out.take_unsent().collect();
    assert!(matches!(
        &unsent[..],
        [Payload::Plain(a), Payload::Reply, Payload::Handle(h)] if a[..] == [1] && h.handle == "h"
    ));
    out.push_reply(b"2");
    assert_eq!(flush(&mut out), ["2"]);
}

#[test]
fn every_phase_and_event() {
    use {Event::*, Phase::*};
    let disconnect = Disconnect { awaits_ack: false };
    let disconnect_before_ack = Disconnect { awaits_ack: true };
    let transitions = [
        (Open, disconnect, Closing),
        (Open, disconnect_before_ack, Draining),
        (Open, PeerExited, ClosingAfterRead),
        (Open, ReadFailed, Closing),
        (Open, CloseBlocked, ClosingAfterWrite),
        (Open, TransportClosed, Closed),
        (Draining, disconnect, Closing),
        (Draining, Idle, Closing),
        (Draining, PeerExited, ClosingAfterRead),
        (Draining, ReadFailed, Closing),
        (Draining, CloseBlocked, ClosingAfterWrite),
        (Draining, TransportClosed, Closed),
        (Closing, CloseBlocked, ClosingAfterWrite),
        (Closing, TransportClosed, Closed),
        (ClosingAfterRead, CloseBlocked, ClosingAfterWrite),
        (ClosingAfterRead, TransportClosed, Closed),
        (ClosingAfterWrite, TransportClosed, Closed),
    ];
    // A pair that is not listed changes nothing.
    for phase in transitions
        .map(|it| it.0)
        .into_iter()
        .chain([Closed, Reported])
    {
        for event in transitions.map(|it| it.1) {
            let listed = transitions.iter().find(|it| (it.0, it.1) == (phase, event));
            let expected = listed.map(|it| it.2);
            assert_eq!(phase.after(event), expected, "{phase:?} on {event:?}");
        }
    }
}
