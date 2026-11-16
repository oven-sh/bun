use bun_http_types::websocket::{
    Event, Header, Input, MAX_CONTROL_FRAME_SIZE, Opcode, Payload, ProtocolError, Reader,
    ReaderOptions, close_payload,
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

fn frames(options: ReaderOptions, frames: &[(u8, &[u8])]) -> Vec<u8> {
    frames
        .iter()
        .flat_map(|(first, payload)| frame(options, *first, payload))
        .collect()
}

fn show(event: &Result<Event<'_>, ProtocolError>) -> String {
    match event {
        Ok(Event::Message(message, payload)) => format!(
            "{:?}{} {}",
            message.opcode,
            if message.compressed { "+deflate" } else { "" },
            payload.escape_ascii()
        ),
        Ok(Event::Ping(payload)) => format!("Ping {}", payload.escape_ascii()),
        Ok(Event::Pong(payload)) => format!("Pong {}", payload.escape_ascii()),
        Ok(Event::Close(code, reason)) => format!("Close {code} {}", reason.escape_ascii()),
        Err(error) => format!("{error:?}"),
    }
}

fn recycle(reader: &mut Reader, event: Result<Event<'_>, ProtocolError>) {
    if let Ok(Event::Message(_, payload)) = event {
        reader.recycle(payload);
    }
}

fn read(reader: &mut Reader, bytes: &[u8]) -> Vec<String> {
    let mut input = Input::new(bytes);
    let mut events = Vec::new();
    while let Some(event) = reader.next(&mut input) {
        events.push(show(&event));
        recycle(reader, event);
    }
    events
}

/// The events of `bytes`, which are the same in one read, in every pair of reads and in one read per byte.
fn events(options: ReaderOptions, bytes: &[u8]) -> Vec<String> {
    let feed = |reads: &[&[u8]]| -> Vec<String> {
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
    assert_eq!(frame(CLIENT, 0x81, b"Hello"), b"\x81\x05Hello");
    assert_eq!(
        frame(SERVER, 0x81, b"Hello"),
        b"\x81\x85\x37\xfa\x21\x3d\x7f\x9f\x4d\x51\x58"
    );
    for (len, head) in [
        (0, &b"\x00"[..]),
        (125, b"\x7d"),
        (126, b"\x7e\x00\x7e"),
        (0xffff, b"\x7e\xff\xff"),
        (0x10000, b"\x7f\x00\x00\x00\x00\x00\x01\x00\x00"),
    ] {
        let payload = vec![7; len];
        assert_eq!(frame(CLIENT, 0, &payload)[1..], [head, &payload].concat());
    }
    assert_eq!(frame(SERVER, 0x89, &[0; 125]).len(), MAX_CONTROL_FRAME_SIZE);
}

#[test]
fn encodes_the_first_byte_and_masks_what_a_closure_writes() {
    for (opcode, fin, compressed, first) in [
        (Opcode::Text, true, false, 0x81),
        (Opcode::Binary, true, true, 0xc2),
        (Opcode::Continue, false, false, 0x00),
        (Opcode::Pong, true, false, 0x8a),
    ] {
        let header = Header {
            opcode,
            fin,
            compressed,
            len: 5,
            key: Some(KEY),
        };
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

#[test]
fn messages_and_control_frames() {
    let (long, longest_ping) = ([b'l'; 200], [b'p'; 125]);
    for options in [CLIENT, SERVER] {
        let bytes = frames(
            options,
            &[
                (0x81, b"text"),
                (0x82, b""),
                (0xc1, b""),
                (0x82, &long),
                (0x41, b"com"),
                (0x89, b""),
                (0x00, b""),
                (0x89, &longest_ping),
                (0x00, b"press"),
                (0x8a, b"pong"),
                (0x80, b"ed"),
                (0x02, b""),
                (0x80, b""),
                (0x01, b"empty end"),
                (0x80, b""),
                (0x01, b"cut off by"),
                (0x88, b"\x03\xe8bye"),
                (0x81, b"ignored"),
            ],
        );
        assert_eq!(
            events(options, &bytes),
            [
                "Text text",
                "Binary ",
                "Text+deflate ",
                &format!("Binary {}", long.escape_ascii()),
                "Ping ",
                &format!("Ping {}", longest_ping.escape_ascii()),
                "Pong pong",
                "Text+deflate compressed",
                "Binary ",
                "Text empty end",
                "Close 1000 bye",
            ]
        );
    }
}

#[test]
fn a_length_may_take_a_longer_form_than_it_needs() {
    let bytes = b"\x81\x7e\x00\x00\x81\x7e\x00\x01a\x81\x7f\x00\x00\x00\x00\x00\x00\x00\x01b";
    assert_eq!(events(CLIENT, bytes), ["Text ", "Text a", "Text b"]);
}

#[test]
fn close_codes() {
    assert_eq!(events(CLIENT, b"\x88\x00"), ["Close 1005 "]);
    for code in [1000, 1003, 1007, 1014, 3000, 4999_u16] {
        let bytes = frame(SERVER, 0x88, &code.to_be_bytes());
        assert_eq!(events(SERVER, &bytes), [format!("Close {code} ")]);
    }
    for code in [0, 999, 1004, 1005, 1006, 1015, 2999, 5000, u16::MAX] {
        let bytes = frame(SERVER, 0x88, &code.to_be_bytes());
        assert_eq!(
            events(SERVER, &bytes),
            [format!("InvalidCloseCode({code})")]
        );
    }
}

/// Each case ends at the byte that shows the error, and also breaks the rules that are checked after it.
#[test]
fn errors_come_as_early_as_possible_and_in_order() {
    let plain = ReaderOptions {
        deflate: false,
        ..CLIENT
    };
    let small = |options| ReaderOptions {
        max_payload: 4,
        ..options
    };
    for (options, bytes, error) in [
        (CLIENT, &b"\x73\xff"[..], "UnexpectedRsv2Or3"),
        (CLIENT, b"\x91\x00", "UnexpectedRsv2Or3"),
        (CLIENT, b"\x43\xff", "UnexpectedMask"),
        (SERVER, b"\x43\x7f", "ExpectedMask"),
        (CLIENT, b"\x43\x7f", "ReservedOpcode(3)"),
        (CLIENT, b"\x4f\x7f", "ReservedOpcode(15)"),
        (small(plain), b"\xc0\x05", "UnexpectedOpcode(0)"),
        (small(plain), b"\x01\x00\xc1\x05", "UnexpectedOpcode(1)"),
        (small(plain), b"\x01\x00\xc2\x05", "UnexpectedOpcode(2)"),
        (CLIENT, b"\x49\x7f", "ControlFrameIsFragmented"),
        (CLIENT, b"\xc9\x7f", "UnexpectedRsv1"),
        (small(CLIENT), b"\x41\x00\xc0\x05", "UnexpectedRsv1"),
        (small(plain), b"\xc1\x05", "UnexpectedRsv1"),
        (SERVER, b"\x89\xfe", "InvalidControlLength(126)"),
        (SERVER, b"\x8a\xff", "InvalidControlLength(127)"),
        (SERVER, b"\x88\x81", "InvalidControlLength(1)"),
        (small(SERVER), b"\x82\x85", "MessageTooBig"),
        (small(SERVER), b"\x82\xfe\x00\x05", "MessageTooBig"),
        (small(CLIENT), b"\x02\x03abc\x80\x02", "MessageTooBig"),
        (
            small(SERVER),
            b"\x82\xff\x00\x1f\xff\xff\xff\xff\xff\xff",
            "MessageTooBig",
        ),
        (
            small(SERVER),
            b"\x82\xff\x00\x20\x00\x00\x00\x00\x00\x00",
            "UnsupportedPayloadLength",
        ),
    ] {
        assert_eq!(events(options, bytes), [error]);
        assert_eq!(events(options, &bytes[..bytes.len() - 1]), [""; 0]);
        let followed = [bytes, &frame(options, 0x81, b"a")].concat();
        assert_eq!(events(options, &followed), [error]);
    }
    let at_the_limit = b"\x02\x02ab\x89\x05hello\x80\x02cd";
    assert_eq!(
        events(small(CLIENT), at_the_limit),
        ["Ping hello", "Binary abcd"]
    );
}

#[test]
fn a_huge_length_allocates_nothing() {
    let mut reader = Reader::new(CLIENT);
    let bytes = b"\x82\x7f\x00\x1f\xff\xff\xff\xff\xff\xff";
    assert_eq!(read(&mut reader, bytes), [""; 0]);
    assert_eq!((reader.capacity(), reader.is_stopped()), (0, false));
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
    assert!(is_borrowed(CLIENT, &[b"\x81\x02ab"]));
    assert!(is_borrowed(CLIENT, &[b"\x81", b"\x02", b"ab"]));
    assert!(is_borrowed(CLIENT, &[b"\x01\x00\x80\x02ab"]));
    assert!(!is_borrowed(CLIENT, &[b"\x81\x02a", b"b"]));
    assert!(!is_borrowed(CLIENT, &[b"\x01\x01a\x80\x01b"]));
    assert!(!is_borrowed(SERVER, &[&frame(SERVER, 0x81, b"ab")]));
}

#[test]
fn the_buffer_is_kept_until_the_reader_stops() {
    let mut reader = Reader::new(SERVER);
    reader.reserve(64);
    let bytes = frame(SERVER, 0x81, b"ab");
    assert_eq!(read(&mut reader, &bytes), ["Text ab"]);
    assert_eq!(reader.capacity(), 64);

    let mut input = Input::new(&bytes);
    let event = reader.next(&mut input).unwrap();
    reader.stop();
    assert_eq!(show(&event), "Text ab");
    recycle(&mut reader, event);
    assert_eq!(reader.capacity(), 0);
    assert_eq!(read(&mut reader, &bytes), [""; 0]);

    let mut reader = Reader::new(SERVER);
    reader.reserve(64);
    reader.stop();
    assert_eq!(reader.capacity(), 0);
}

/// The next read comes while the event that ended the last one is still being handled.
#[test]
fn a_read_inside_an_event() {
    for options in [CLIENT, SERVER] {
        let rest = frames(
            options,
            &[
                (0x42, b"sec"),
                (0x89, b"ab\x89\x64xy"),
                (0x80, b"ond"),
                (0x81, &[b'l'; 130]),
            ],
        );
        for (first, shown) in [
            (frames(options, &[(0x81, b"first")]), "Text first"),
            (
                frames(options, &[(0x01, b"fir"), (0x80, b"st")]),
                "Text first",
            ),
            (frames(options, &[(0x89, b"first")]), "Ping first"),
        ] {
            let expected = events(options, &rest);
            let step = if cfg!(miri) { 23 } else { 1 };
            for cut in [0, 1, 3, first.len() - 1] {
                for nested in (0..=rest.len()).step_by(step) {
                    let mut reader = Reader::new(options);
                    assert_eq!(read(&mut reader, &first[..cut]), [""; 0]);
                    let mut input = Input::new(&first[cut..]);
                    let event = reader.next(&mut input).unwrap();
                    let mut seen = read(&mut reader, &rest[..nested]);
                    assert_eq!(show(&event), shown);
                    recycle(&mut reader, event);
                    seen.extend(read(&mut reader, &rest[nested..]));
                    assert_eq!(seen, expected, "{cut} {nested}");
                }
            }
        }
    }
}
