use bun_http_types::websocket::ProtocolError::{self, *};
use bun_http_types::websocket::{
    Event, Header, Input, MAX_CONTROL_FRAME_SIZE, Opcode, Payload, Reader, ReaderOptions,
    close_payload,
};

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}

/// Stands in for highway_strings.cpp.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_fill_with_skip_mask(
    mask: &[u8; 4],
    _mask_len: usize,
    output: *mut u8,
    input: *const u8,
    len: usize,
    _skip_mask: bool,
) {
    for i in 0..len {
        // SAFETY: both are `len` long, and are the same bytes or don't overlap.
        unsafe { *output.add(i) = *input.add(i) ^ mask[i % 4] };
    }
}

const CLIENT: ReaderOptions = ReaderOptions {
    masked: false,
    deflate: true,
    max_payload: usize::MAX,
};
const SERVER: ReaderOptions = ReaderOptions {
    masked: true,
    ..CLIENT
};
const KEY: [u8; 4] = [0x37, 0xfa, 0x21, 0x3d];

const FIN: u8 = 0x80;
const RSV1: u8 = 0x40;
const RSV2: u8 = 0x20;
const RSV3: u8 = 0x10;
const CONTINUE: u8 = 0x0;
const TEXT: u8 = 0x1;
const BINARY: u8 = 0x2;
const CLOSE: u8 = 0x8;
const PING: u8 = 0x9;
const PONG: u8 = 0xa;
const MASK: u8 = 0x80;

/// `first` is the first byte. The length takes its shortest form.
fn frame(options: ReaderOptions, first: u8, payload: &[u8]) -> Vec<u8> {
    let header = Header {
        opcode: Opcode::Continue,
        fin: false,
        compressed: false,
        len: payload.len(),
        key: options.masked.then_some(KEY),
    };
    let mut frame = vec![0; header.frame_size()];
    header.encode(&mut frame, payload);
    frame[0] = first;
    frame
}

fn frames(options: ReaderOptions, frames: &[(u8, &str)]) -> Vec<u8> {
    frames
        .iter()
        .flat_map(|(first, payload)| frame(options, *first, payload.as_bytes()))
        .collect()
}

#[derive(Copy, Clone, Debug, PartialEq)]
enum Kind {
    Text,
    Binary,
    Compressed(Opcode),
    Ping,
    Pong,
    Close(u16),
    Error(ProtocolError),
}
use Kind::*;

#[derive(Debug, PartialEq)]
struct Seen(Kind, String);

impl PartialEq<(Kind, &str)> for Seen {
    fn eq(&self, (kind, payload): &(Kind, &str)) -> bool {
        self.0 == *kind && self.1 == *payload
    }
}

const NOTHING: [Seen; 0] = [];

fn seen(event: &Result<Event<'_>, ProtocolError>) -> Seen {
    let (kind, payload): (_, &[u8]) = match event {
        Ok(Event::Message(message, payload)) if message.compressed => {
            (Compressed(message.opcode), payload)
        }
        Ok(Event::Message(message, payload)) if message.opcode == Opcode::Text => (Text, payload),
        Ok(Event::Message(_, payload)) => (Binary, payload),
        Ok(Event::Ping(payload)) => (Ping, payload),
        Ok(Event::Pong(payload)) => (Pong, payload),
        Ok(Event::Close(code, reason)) => (Close(*code), reason),
        Err(error) => (Error(*error), b""),
    };
    Seen(kind, payload.escape_ascii().to_string())
}

fn recycle(reader: &mut Reader, event: Result<Event<'_>, ProtocolError>) {
    if let Ok(Event::Message(_, payload)) = event {
        reader.recycle(payload);
    }
}

fn read(reader: &mut Reader, bytes: &[u8]) -> Vec<Seen> {
    drain(reader, Input::new(bytes))
}

fn drain(reader: &mut Reader, mut input: Input<'_>) -> Vec<Seen> {
    let mut events = Vec::new();
    while let Some(event) = reader.next(&mut input) {
        events.push(seen(&event));
        recycle(reader, event);
    }
    events
}

/// The events of `bytes`, which are the same in one read, in every pair of reads and in one read per byte.
fn events(options: ReaderOptions, bytes: &[u8]) -> Vec<Seen> {
    let feed = |reads: &[&[u8]]| -> Vec<Seen> {
        let mut reader = Reader::new(options);
        reads.iter().flat_map(|r| read(&mut reader, r)).collect()
    };
    let whole = feed(&[bytes]);
    assert_eq!(feed(&bytes.chunks(1).collect::<Vec<_>>()), whole);
    for at in (0..=bytes.len()).step_by(if cfg!(miri) { 29 } else { 1 }) {
        let (first, second) = bytes.split_at(at);
        assert_eq!(feed(&[first, second]), whole, "split at {at}");
    }
    whole
}

#[test]
fn encodes_the_examples_of_the_rfc() {
    assert_eq!(frame(CLIENT, FIN | TEXT, b"Hello"), b"\x81\x05Hello");
    assert_eq!(
        frame(SERVER, FIN | TEXT, b"Hello"),
        b"\x81\x85\x37\xfa\x21\x3d\x7f\x9f\x4d\x51\x58"
    );
    for (len, encoded_len) in [
        (0, &[0][..]),
        (125, &[125]),
        (126, &[126, 0, 126]),
        (0xffff, &[126, 0xff, 0xff]),
        (0x10000, &[127, 0, 0, 0, 0, 0, 1, 0, 0]),
    ] {
        let payload = vec![7; len];
        let after_the_first_byte = &frame(CLIENT, BINARY, &payload)[1..];
        assert_eq!(after_the_first_byte, [encoded_len, &payload].concat());
    }
    let longest_ping = frame(SERVER, FIN | PING, &[0; 125]);
    assert_eq!(longest_ping.len(), MAX_CONTROL_FRAME_SIZE);
}

#[test]
fn encodes_the_first_byte_and_masks_what_a_closure_writes() {
    let text = Header {
        opcode: Opcode::Text,
        fin: true,
        compressed: false,
        len: 5,
        key: Some(KEY),
    };
    let with = |opcode| Header { opcode, ..text };
    let unfinished = Header { fin: false, ..text };
    let compressed = Header {
        compressed: true,
        ..text
    };
    for (header, first) in [
        (text, FIN | TEXT),
        (unfinished, TEXT),
        (compressed, FIN | RSV1 | TEXT),
        (with(Opcode::Continue), FIN | CONTINUE),
        (with(Opcode::Binary), FIN | BINARY),
        (with(Opcode::Pong), FIN | PONG),
    ] {
        let mut encoded = vec![0; header.frame_size()];
        header.encode_with(&mut encoded, |payload| payload.copy_from_slice(b"Hello"));
        assert_eq!(encoded, frame(SERVER, first, b"Hello"));
    }
}

#[test]
fn close_payloads() {
    assert_eq!(*close_payload(1005, b"dropped"), *b"");
    assert_eq!(*close_payload(1000, b"bye"), *b"\x03\xe8bye");
    assert_eq!(close_payload(1000, &[b'a'; 123]).len(), 125);
    assert_eq!(*close_payload(1000, &[b'a'; 124]), *b"\x03\xe8");
}

/// One stream. Each frame is next to the event it completes.
#[test]
fn messages_and_control_frames() {
    let (long, longest_ping) = (&*"l".repeat(200), &*"p".repeat(125));
    let deflated = Compressed(Opcode::Text);
    let stream = [
        ((FIN | TEXT, "text"), Some((Text, "text"))),
        ((FIN | BINARY, ""), Some((Binary, ""))),
        ((FIN | RSV1 | TEXT, ""), Some((deflated, ""))),
        ((FIN | BINARY, long), Some((Binary, long))),
        ((RSV1 | TEXT, "com"), None),
        ((FIN | PING, ""), Some((Ping, ""))),
        ((CONTINUE, ""), None),
        ((FIN | PING, longest_ping), Some((Ping, longest_ping))),
        ((CONTINUE, "press"), None),
        ((FIN | PONG, "pong"), Some((Pong, "pong"))),
        ((FIN | CONTINUE, "ed"), Some((deflated, "compressed"))),
        ((BINARY, ""), None),
        ((FIN | CONTINUE, ""), Some((Binary, ""))),
        ((TEXT, "empty end"), None),
        ((FIN | CONTINUE, ""), Some((Text, "empty end"))),
        ((TEXT, "cut off by"), None),
        ((FIN | CLOSE, "\x0f\x00bye"), Some((Close(0x0f00), "bye"))),
        ((FIN | TEXT, "ignored"), None),
    ];
    let expected: Vec<_> = stream.iter().filter_map(|(_, event)| *event).collect();
    for options in [CLIENT, SERVER] {
        let bytes = frames(options, &stream.map(|(frame, _)| frame));
        assert_eq!(events(options, &bytes), expected);
    }
}

#[test]
fn a_length_may_take_a_longer_form_than_it_needs() {
    for (len, payload) in [
        (&[126, 0, 0][..], ""),
        (&[126, 0, 1], "a"),
        (&[127, 0, 0, 0, 0, 0, 0, 0, 1], "b"),
    ] {
        let bytes = [&[FIN | TEXT], len, payload.as_bytes()].concat();
        assert_eq!(events(CLIENT, &bytes), [(Text, payload)]);
    }
}

#[test]
fn close_codes() {
    assert_eq!(events(CLIENT, &[FIN | CLOSE, 0]), [(Close(1005), "")]);
    let close = |code: u16| events(SERVER, &frame(SERVER, FIN | CLOSE, &code.to_be_bytes()));
    for code in [1000, 1003, 1007, 1014, 3000, 4999] {
        assert_eq!(close(code), [(Close(code), "")]);
    }
    for code in [0, 999, 1004, 1005, 1006, 1015, 2999, 5000, u16::MAX] {
        assert_eq!(close(code), [(Error(InvalidCloseCode(code)), "")]);
    }
}

/// Each case ends at the byte that shows the error, and also breaks the rules that are checked after it.
#[test]
#[rustfmt::skip]
fn errors_come_as_early_as_possible_and_in_order() {
    let no_deflate = ReaderOptions { deflate: false, ..CLIENT };
    let max_4 = |options| ReaderOptions { max_payload: 4, ..options };
    for (options, bytes, error) in [
        (CLIENT,            &[RSV1 | RSV2 | RSV3 | 3, MASK | 127][..],                          UnexpectedRsv2Or3),
        (CLIENT,            &[FIN | RSV2 | TEXT, 0],                                            UnexpectedRsv2Or3),
        (CLIENT,            &[FIN | RSV3 | TEXT, 0],                                            UnexpectedRsv2Or3),
        (CLIENT,            &[RSV1 | 3, MASK | 127],                                            UnexpectedMask),
        (SERVER,            &[RSV1 | 3, 127],                                                   ExpectedMask),
        (CLIENT,            &[RSV1 | 3, 127],                                                   ReservedOpcode(3)),
        (CLIENT,            &[RSV1 | 15, 127],                                                  ReservedOpcode(15)),
        (max_4(no_deflate), &[FIN | RSV1 | CONTINUE, 5],                                        UnexpectedOpcode(CONTINUE)),
        (max_4(no_deflate), &[TEXT, 0, FIN | RSV1 | TEXT, 5],                                   UnexpectedOpcode(TEXT)),
        (max_4(no_deflate), &[TEXT, 0, FIN | RSV1 | BINARY, 5],                                 UnexpectedOpcode(BINARY)),
        (CLIENT,            &[RSV1 | PING, 127],                                                ControlFrameIsFragmented),
        (CLIENT,            &[FIN | RSV1 | PING, 127],                                          UnexpectedRsv1),
        (max_4(CLIENT),     &[RSV1 | TEXT, 0, FIN | RSV1 | CONTINUE, 5],                        UnexpectedRsv1),
        (max_4(no_deflate), &[FIN | RSV1 | TEXT, 5],                                            UnexpectedRsv1),
        (SERVER,            &[FIN | PING, MASK | 126],                                          InvalidControlLength(126)),
        (SERVER,            &[FIN | PONG, MASK | 127],                                          InvalidControlLength(127)),
        (SERVER,            &[FIN | CLOSE, MASK | 1],                                           InvalidControlLength(1)),
        (max_4(SERVER),     &[FIN | BINARY, MASK | 5],                                          MessageTooBig),
        (max_4(SERVER),     &[FIN | BINARY, MASK | 126, 0, 5],                                  MessageTooBig),
        (max_4(CLIENT),     &[BINARY, 3, 0, 0, 0, FIN | CONTINUE, 2],                           MessageTooBig),
        (max_4(SERVER),     &[FIN | BINARY, MASK | 127, 0, 0x1f, 255, 255, 255, 255, 255, 255], MessageTooBig),
        (max_4(SERVER),     &[FIN | BINARY, MASK | 127, 0, 0x20, 0, 0, 0, 0, 0, 0],             UnsupportedPayloadLength),
    ] {
        assert_eq!(events(options, bytes), [(Error(error), "")]);
        assert_eq!(events(options, &bytes[..bytes.len() - 1]), NOTHING);
        let followed = [bytes, &frame(options, FIN | TEXT, b"a")].concat();
        assert_eq!(events(options, &followed), [(Error(error), "")]);
    }
    let at_the_limit = frames(CLIENT, &[(BINARY, "ab"), (FIN | PING, "hello"), (FIN | CONTINUE, "cd")]);
    assert_eq!(events(max_4(CLIENT), &at_the_limit), [(Ping, "hello"), (Binary, "abcd")]);
}

#[test]
fn a_huge_length_allocates_nothing() {
    let mut reader = Reader::new(CLIENT);
    let bytes = [FIN | BINARY, 127, 0, 0x1f, 255, 255, 255, 255, 255, 255];
    assert_eq!(read(&mut reader, &bytes), NOTHING);
    assert_eq!(reader.capacity(), 0);
    assert!(!reader.is_stopped());
}

#[test]
fn a_message_that_is_whole_in_a_read_is_not_copied() {
    let is_borrowed = |options, reads: &[&[u8]]| {
        let mut reader = Reader::new(options);
        reads.iter().any(|read| {
            matches!(
                reader.next(&mut Input::new(read)),
                Some(Ok(Event::Message(_, Payload::Borrowed(_))))
            )
        })
    };
    let fragments = |first, last| frames(CLIENT, &[(TEXT, first), (FIN | CONTINUE, last)]);
    assert!(is_borrowed(CLIENT, &[&[FIN | TEXT, 2, 0, 0]]));
    assert!(is_borrowed(CLIENT, &[&[FIN | TEXT], &[2], &[0, 0]]));
    assert!(is_borrowed(CLIENT, &[&fragments("", "ab")]));
    assert!(!is_borrowed(CLIENT, &[&[FIN | TEXT, 2, 0], &[0]]));
    assert!(!is_borrowed(CLIENT, &[&fragments("a", "b")]));
    assert!(!is_borrowed(SERVER, &[&frame(SERVER, FIN | TEXT, b"ab")]));
}

#[test]
fn the_buffer_is_kept_until_the_reader_stops() {
    let mut reader = Reader::new(SERVER);
    reader.reserve(64);
    let bytes = frame(SERVER, FIN | TEXT, b"ab");
    assert_eq!(read(&mut reader, &bytes), [(Text, "ab")]);
    assert_eq!(reader.capacity(), 64);

    let mut input = Input::new(&bytes);
    let event = reader.next(&mut input).unwrap();
    reader.stop();
    assert_eq!(seen(&event), (Text, "ab"));
    recycle(&mut reader, event);
    assert_eq!(reader.capacity(), 0);
    assert_eq!(read(&mut reader, &bytes), NOTHING);

    let mut reader = Reader::new(SERVER);
    reader.reserve(64);
    reader.stop();
    assert_eq!(reader.capacity(), 0);
}

fn first_events(options: ReaderOptions) -> [(Vec<u8>, Kind); 3] {
    [
        (frames(options, &[(FIN | TEXT, "first")]), Text),
        (
            frames(options, &[(TEXT, "fir"), (FIN | CONTINUE, "st")]),
            Text,
        ),
        (frames(options, &[(FIN | PING, "first")]), Ping),
    ]
}

/// The next read comes while the event that ended the last one is still being handled.
#[test]
fn a_read_inside_an_event() {
    for options in [CLIENT, SERVER] {
        let looks_like_a_header = [b'a', b'b', FIN | PING, 100, b'x', b'y'];
        let rest = [
            frame(options, RSV1 | BINARY, b"sec"),
            frame(options, FIN | PING, &looks_like_a_header),
            frame(options, FIN | CONTINUE, b"ond"),
            frame(options, FIN | TEXT, &[b'l'; 130]),
        ]
        .concat();
        let expected = events(options, &rest);
        for (first, kind) in first_events(options) {
            for cut in [0, 1, 3, first.len() - 1] {
                for nested in (0..=rest.len()).step_by(if cfg!(miri) { 23 } else { 1 }) {
                    let mut reader = Reader::new(options);
                    assert_eq!(read(&mut reader, &first[..cut]), NOTHING);
                    let mut input = Input::new(&first[cut..]);
                    let event = reader.next(&mut input).unwrap();
                    let mut later = read(&mut reader, &rest[..nested]);
                    assert_eq!(seen(&event), (kind, "first"));
                    recycle(&mut reader, event);
                    later.extend(drain(&mut reader, input));
                    later.extend(read(&mut reader, &rest[nested..]));
                    assert_eq!(later, expected, "{cut} {nested}");
                }
            }
        }
    }
}

/// The read inside the event ends in the middle of a frame, and the outer read has frames left.
#[test]
fn an_unfinished_frame_waits_for_the_rest_of_the_outer_read() {
    let long = &*"i".repeat(130);
    for options in [CLIENT, SERVER] {
        let left = frames(options, &[(FIN | PONG, "pong"), (FIN | TEXT, "second")]);
        for (first, _) in first_events(options) {
            let outer = [&*first, &left].concat();
            for (first_byte, third) in [
                (FIN | TEXT, (Text, "inner")),
                (FIN | RSV1 | BINARY, (Compressed(Opcode::Binary), long)),
                (FIN | PING, (Ping, "inner")),
            ] {
                let inner = frame(options, first_byte, third.1.as_bytes());
                for cut in (2..inner.len()).step_by(if cfg!(miri) { 7 } else { 1 }) {
                    let mut reader = Reader::new(options);
                    let mut input = Input::new(&outer);
                    let event = reader.next(&mut input).unwrap();
                    assert_eq!(read(&mut reader, &inner[..cut]), NOTHING);
                    recycle(&mut reader, event);

                    let event = reader.next(&mut input).unwrap();
                    assert_eq!(seen(&event), (Pong, "pong"));
                    let event = reader.next(&mut input).unwrap();
                    assert_eq!(seen(&event), (Text, "second"));
                    assert_eq!(read(&mut reader, &inner[cut..]), [third]);
                    recycle(&mut reader, event);
                    assert_eq!(drain(&mut reader, input), NOTHING);
                }
            }
        }
    }
}

#[test]
fn an_unfinished_fragment_waits_for_the_rest_of_the_outer_read() {
    for options in [CLIENT, SERVER] {
        let outer = frames(
            options,
            &[
                (TEXT, "a"),
                (FIN | PING, "1"),
                (CONTINUE, ""),
                (FIN | PING, "2"),
            ],
        );
        let (inner, last) = (
            frame(options, CONTINUE, b"bcd"),
            frame(options, FIN | CONTINUE, b"e"),
        );
        for cut in 2..inner.len() {
            let mut reader = Reader::new(options);
            let mut input = Input::new(&outer);
            assert_eq!(seen(&reader.next(&mut input).unwrap()), (Ping, "1"));
            assert_eq!(read(&mut reader, &inner[..cut]), NOTHING);
            assert_eq!(drain(&mut reader, input), [(Ping, "2")]);
            assert_eq!(read(&mut reader, &inner[cut..]), NOTHING);
            assert_eq!(read(&mut reader, &last), [(Text, "abcde")]);
        }
    }
}

/// The rest of the outer read ends the message that the held header continues.
#[test]
fn a_held_header_that_became_invalid_is_an_error() {
    let outer = frames(
        CLIENT,
        &[(TEXT, "a"), (FIN | PING, ""), (FIN | CONTINUE, "b")],
    );
    let mut reader = Reader::new(CLIENT);
    let mut input = Input::new(&outer);
    assert_eq!(seen(&reader.next(&mut input).unwrap()), (Ping, ""));
    assert_eq!(read(&mut reader, &[FIN | CONTINUE, 127, 0, 0]), NOTHING);
    assert_eq!(drain(&mut reader, input), [(Text, "ab")]);
    assert_eq!(
        read(&mut reader, &[0]),
        [(Error(UnexpectedOpcode(CONTINUE)), "")]
    );
}
