use bun_ipc::{
    Event, Frame, FrameError, Inbox, Kind, Mode, Outbox, Payload, Phase, Reply, Wrote,
    advanced_frame,
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

#[test]
fn bytes_on_the_wire() {
    use {Kind::*, Mode::*};
    assert_eq!(Advanced.version_packet(), Some(&[1, 2, 0, 0, 0][..]));
    assert_eq!(Json.version_packet(), None);
    assert_eq!(Advanced.encode(Data, b"ab"), b"\x02\x02\0\0\0ab");
    assert_eq!(Advanced.encode(Internal, b"ab"), b"\x03\x02\0\0\0ab");
    assert_eq!(Advanced.encode(DataWithBuffers, b""), b"\x04\0\0\0\0");
    assert_eq!(Json.encode(Data, b"1"), b"1\n");
    assert_eq!(Json.encode(Internal, b"1"), b"\x021\n");
    for mode in MODES {
        for reply in [Reply::Ack, Reply::Nack] {
            let packet = mode.reply_packet(reply);
            let (kind, body) = first(mode, packet, NO_LIMIT).unwrap().unwrap();
            assert_eq!((kind, mode.encode(kind, &body)), (Data, packet.to_vec()));
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
        stream.extend(frames.iter().flat_map(|(kind, it)| mode.encode(*kind, it)));
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

#[test]
fn memory_of_the_inbox() {
    for (mode, len, is_freed) in [
        (Mode::Json, MB, false),
        (Mode::Json, 16 * MB, true),
        (Mode::Advanced, 16 * MB, false),
    ] {
        let mut inbox = Inbox::new(mode);
        *inbox.buffer() = mode.encode(Kind::Data, &vec![b'1'; len]);
        assert_eq!(
            inbox.next(NO_LIMIT, |frame| frame.body.len()),
            Ok(Some(len))
        );
        assert_eq!(inbox.buffer().capacity() == 0, is_freed);
    }
    for (mode, len, kept) in [
        (Mode::Json, MB, MB + 2),
        (Mode::Json, 16 * MB, 1),
        (Mode::Advanced, MB, 1),
    ] {
        let mut inbox = Inbox::new(mode);
        *inbox.buffer() = mode.encode(Kind::Data, &vec![b'1'; len]);
        inbox.buffer().push(2);
        while inbox.next(NO_LIMIT, |_| ()).unwrap().is_some() {}
        assert_eq!(inbox.buffer().len(), kept);
    }
}

type Out = Outbox<&'static str, u8>;

/// `"bytes+handle -> result"` of a write of which the transport takes at most `room` bytes.
fn write(out: &mut Out, is_writable: bool, room: usize) -> String {
    let Some((bytes, handle)) = out.begin_write(is_writable) else {
        return "-".into();
    };
    let handle = handle.map_or(String::new(), |handle| format!("+{handle}"));
    let (text, len) = (bytes.escape_ascii().to_string(), bytes.len());
    match out.end_write(len.min(room) as i32) {
        Wrote::Continue(callbacks) => format!("{text}{handle} -> {callbacks:?}"),
        Wrote::Blocked => format!("{text}{handle} -> blocked"),
        Wrote::Failed => unreachable!(),
    }
}

fn flush(out: &mut Out) -> Vec<String> {
    core::iter::from_fn(|| Some(write(out, true, usize::MAX)).filter(|it| it != "-")).collect()
}

#[test]
fn plain_messages_are_written_together() {
    let mut out = Out::default();
    out.push(b"a".into(), None, Some(1));
    out.push(b"b".into(), None, None);
    out.push(b"c".into(), None, Some(3));
    out.push(b"H".into(), Some("h"), Some(4));
    out.push(b"d".into(), None, Some(5));
    assert!(!out.is_backed_up());
    assert_eq!(flush(&mut out), ["abc -> [1, 3]", "H+h -> []"]);
    assert!(out.is_backed_up() && out.unacked() == Some(&"h"));
    let offer = out.take_unacked().unwrap();
    assert_eq!((offer.handle, offer.callback), ("h", Some(4)));
    assert_eq!(flush(&mut out), ["d -> [5]"]);
    assert!(out.is_idle());
}

#[test]
fn nothing_joins_or_passes_what_the_transport_has() {
    let mut out = Out::default();
    out.push(b"ab".into(), None, Some(1));
    assert_eq!(write(&mut out, false, 0), "ab -> blocked");
    out.push(b"c".into(), None, Some(2));
    assert_eq!(write(&mut out, false, 1), "abc -> blocked");
    assert_eq!(write(&mut out, false, 9), "-");
    out.push(b"d".into(), None, Some(3));
    out.push_reply(b"1");
    out.push_reply(b"2");
    out.push(b"e".into(), None, None);
    assert_eq!(
        flush(&mut out),
        ["bc -> [1, 2]", "2 -> []", "1 -> []", "de -> [3]"]
    );

    out.push(b"a".into(), None, Some(1));
    assert!(out.begin_write(false).is_some());
    assert!(out.begin_write(true).is_none());
    out.push(b"b".into(), None, Some(2));
    out.push(b"c".into(), None, Some(3));
    out.push_reply(b"1");
    assert!(matches!(out.end_write(1), Wrote::Continue(it) if it[..] == [1]));
    assert_eq!(flush(&mut out), ["1 -> []", "bc -> [2, 3]"]);
}

#[test]
fn a_handle_goes_with_the_first_byte_three_times() {
    let mut out = Out::default();
    assert!(!out.resend(|_, _| unreachable!()));
    out.push(b"HH".into(), Some("h"), Some(1));
    out.push(b"a".into(), None, Some(2));
    assert_eq!(write(&mut out, false, 0), "HH+h -> blocked");
    assert_eq!(write(&mut out, false, 1), "HH+h -> blocked");
    assert_eq!(flush(&mut out), ["H -> []"]);
    out.push_reply(b"12");
    assert_eq!(write(&mut out, false, 1), "12 -> blocked");
    assert!(out.resend(|handle, bytes| (*handle, bytes[1]) = ("g", b'G')));
    assert_eq!(out.unacked(), None);
    assert_eq!(flush(&mut out), ["2 -> []", "HG+g -> []"]);
    assert!(out.resend(|_, _| {}));
    assert_eq!(flush(&mut out), ["HG+g -> []"]);
    assert!(!out.resend(|_, _| unreachable!()));
    assert_eq!(out.unacked(), Some(&"g"));
    out.take_unacked();
    out.push(b"I".into(), Some("i"), None);
    assert_eq!(flush(&mut out), ["a -> [2]", "I+i -> []"]);
    assert!(out.resend(|_, _| {}));
}

#[test]
fn a_write_is_capped_and_goes_on() {
    let mut out = Out::default();
    out.push(vec![0; i32::MAX as usize + 1], None, Some(1));
    assert_eq!(out.begin_write(false).unwrap().0.len(), i32::MAX as usize);
    assert!(matches!(out.end_write(i32::MAX), Wrote::Continue(it) if it.is_empty()));
    assert_eq!(flush(&mut out), ["\\x00 -> [1]"]);
}

#[test]
fn what_is_left_at_the_close() {
    let mut out = Out::default();
    out.push(b"a".into(), None, Some(1));
    assert!(out.begin_write(false).is_some());
    assert!(matches!(out.end_write(-1), Wrote::Failed));
    out.push(b"H".into(), Some("h"), Some(2));
    assert!(out.begin_write(false).is_some());
    out.push_reply(b"1");
    let unsent: Vec<_> = out.take_unsent().collect();
    assert!(matches!(
        &unsent[..],
        [Payload::Plain(a), Payload::Reply, Payload::Handle(h)] if a[..] == [1] && h.handle == "h"
    ));
    out.push_reply(b"2");
    assert_eq!(flush(&mut out), ["2 -> []"]);
}

#[test]
fn every_phase_and_event() {
    use {Event::*, Phase::*};
    let events = [
        Disconnect { awaits_ack: false },
        Disconnect { awaits_ack: true },
        Idle,
        PeerExited,
        ReadFailed,
        CloseBlocked,
        TransportClosed,
    ];
    let (read, write) = (ClosingAfterRead, ClosingAfterWrite);
    for (phase, row) in [
        (
            Open,
            [Closing, Draining, Open, read, Closing, write, Closed],
        ),
        (
            Draining,
            [Draining, Draining, Closing, read, Closing, write, Closed],
        ),
        (
            Closing,
            [Closing, Closing, Closing, Closing, Closing, write, Closed],
        ),
        (read, [read, read, read, read, read, write, Closed]),
        (write, [write, write, write, write, write, write, Closed]),
        (Closed, [Closed; 7]),
        (Reported, [Reported; 7]),
    ] {
        assert_eq!(events.map(|event| phase.after(event).unwrap_or(phase)), row);
        // One task for each time the phase is entered.
        let is_entered_again = events.iter().any(|&it| phase.after(it) == Some(phase));
        assert!(!(phase.needs_task() && is_entered_again));
    }
}
