use std::borrow::Cow;
use std::cell::RefCell;
use std::mem::MaybeUninit;

use bun_websocket::frame::{Flags, Opcode, write_unmasked_head};
use bun_websocket::handshake::{has_broken_compression, negotiate_compression};
use bun_websocket::reader::{ControlFrameRoom, Failure, Reader, control_frames_len, parse_close};
use bun_websocket::topics::{Message, Receiver, Topics};

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}

/// Stands in for simdutf.
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_utf8(text: *const u8, len: usize) -> bool {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { core::slice::from_raw_parts(text, len) };
    text.utf8_chunks().all(|chunk| chunk.invalid().is_empty())
}

mod reader {
    use super::*;

    const FIN: u8 = 0x80;
    const RSV1: u8 = 0x40;
    const MASK: [u8; 4] = [0x12, 0x34, 0x56, 0x78];

    fn head(first: u8, len: u64) -> Vec<u8> {
        let mut head = vec![first];
        match len {
            ..126 => head.push(0x80 | len as u8),
            126..65536 => head.extend([0xfe, (len >> 8) as u8, len as u8]),
            65536.. => head.extend([0xff].into_iter().chain(len.to_be_bytes())),
        }
        head.extend(MASK);
        head
    }

    fn frame(first: u8, payload: &[u8]) -> Vec<u8> {
        let mut frame = head(first, payload.len() as u64);
        frame.extend(payload.iter().zip(MASK.iter().cycle()).map(|(a, b)| a ^ b));
        frame
    }

    fn bytes(len: usize) -> Vec<u8> {
        (0..len).map(|index| (index % 251) as u8).collect()
    }

    const ROOM: ControlFrameRoom = [MaybeUninit::uninit(); _];

    type Read = (Vec<(Opcode, bool, Vec<u8>)>, Option<Failure>);

    fn read_parts<'a>(parts: impl Iterator<Item = &'a [u8]>, max_len: u32) -> Read {
        let mut reader = Reader::new(true);
        let mut messages = Vec::new();
        for part in parts {
            let mut input = &mut part.to_vec()[..];
            while !input.is_empty() {
                match reader.read_frame(&mut input, max_len, &mut { ROOM }) {
                    Ok(Some(message)) => {
                        let payload = message.payload.to_vec();
                        messages.push((message.opcode, message.is_compressed, payload));
                        if let Cow::Owned(buffer) = message.payload {
                            reader.reuse(buffer);
                        }
                    }
                    Ok(None) => {}
                    Err(failure) => return (messages, Some(failure)),
                }
            }
        }
        (messages, None)
    }

    /// The same in one read, in every pair of reads, and in one read per byte.
    fn read(frames: &[Vec<u8>], max_len: u32) -> Read {
        let bytes = frames.concat();
        let result = read_parts([&bytes[..]].into_iter(), max_len);
        assert_eq!(read_parts(bytes.chunks(1), max_len), result);
        for at in 0..=bytes.len() {
            let (first, second) = bytes.split_at(at);
            assert_eq!(read_parts([first, second].into_iter(), max_len), result);
        }
        result
    }

    fn failure(frames: &[Vec<u8>], max_len: u32) -> Option<Failure> {
        read(frames, max_len).1
    }

    #[test]
    fn unmasks_every_length() {
        for len in 0..=150 {
            let payload = bytes(len);
            let expected = vec![(Opcode::Binary, false, payload.clone()); 2];
            let frame = frame(FIN | 2, &payload);
            assert_eq!(read(&[frame.clone(), frame], u32::MAX), (expected, None));
        }
    }

    #[test]
    fn reads_long_lengths() {
        for len in [65535, 65536] {
            let payload = bytes(len);
            let frame = frame(FIN | 2, &payload);
            for part_len in [7, 13, 4099, frame.len()] {
                let expected = vec![(Opcode::Binary, false, payload.clone())];
                assert_eq!(read_parts(frame.chunks(part_len), 65536), (expected, None));
            }
        }
    }

    #[test]
    fn accepts_a_longer_form_than_needed() {
        let medium = b"\x82\xfe\0\x01\0\0\0\0a".to_vec();
        let long = b"\x82\xff\0\0\0\0\0\0\0\x01\0\0\0\0a".to_vec();
        let expected = vec![(Opcode::Binary, false, b"a".to_vec()); 2];
        assert_eq!(read(&[medium, long], 1), (expected, None));
    }

    #[test]
    fn joins_fragments_around_control_frames() {
        let frames = [
            frame(RSV1 | 1, b"one"),
            frame(FIN | 9, b"ping"),
            frame(0, b""),
            frame(FIN | 10, &bytes(125)),
            frame(FIN, b"two"),
            frame(2, b""),
            frame(FIN, b"three"),
            frame(FIN | RSV1 | 2, b"four"),
            frame(FIN | 8, b""),
        ];
        let expected = vec![
            (Opcode::Ping, false, b"ping".to_vec()),
            (Opcode::Pong, false, bytes(125)),
            (Opcode::Text, true, b"onetwo".to_vec()),
            (Opcode::Binary, false, b"three".to_vec()),
            (Opcode::Binary, true, b"four".to_vec()),
            (Opcode::Close, false, vec![]),
        ];
        assert_eq!(read(&frames, 6), (expected, None));
    }

    #[test]
    fn refuses_frames_in_order() {
        use Failure::*;
        for (first, len, expected) in [
            (FIN | RSV1 | 0x30, 0, Rsv1),
            (FIN | RSV1 | 0x39, 0, Rsv1),
            (FIN | RSV1 | 3, 0, Rsv1),
            (FIN | 0x13, 0, Rsv2Or3),
            (FIN | 0x21, 0, Rsv2Or3),
            (3, 0, Opcode(super::Opcode::Res3)),
            (7, 0, Opcode(super::Opcode::Res7)),
            (11, 126, Opcode(super::Opcode::ResB)),
            (9, 126, FragmentedControlFrame),
            (FIN | 8, 126, ControlFrameTooBig(126)),
            (FIN | 9, 65536, ControlFrameTooBig(127)),
            (FIN, 11, Continuation),
            (FIN | 1, 11, MessageTooBig),
            (FIN | 1, 1 << 32, MessageTooBig),
            (FIN | 1, (1 << 53) - 1, MessageTooBig),
            (FIN | 1, 1 << 53, UnsupportedLength),
            (FIN | 1, u64::MAX, UnsupportedLength),
        ] {
            assert_eq!(failure(&[head(first, len)], 10), Some(expected));
        }
        assert_eq!(failure(&[vec![0xf3, 0]], 10), Some(Unmasked));
        assert_eq!(failure(&[vec![0xf3, 0x80, 0, 0, 0]], 10), None);
        assert_eq!(failure(&[vec![0xf3, 0xfe, 0, 0, 0, 0]], 10), Some(Rsv1));
        assert_eq!(failure(&[head(FIN | 1, u32::MAX.into())], u32::MAX), None);
        assert_eq!(
            failure(&[frame(1, b""), head(2, 11)], 10),
            Some(Interleaved(super::Opcode::Binary))
        );
        assert_eq!(
            failure(&[frame(1, &bytes(6)), frame(FIN, &bytes(5))], 10),
            Some(MessageTooBig)
        );
        let mut input = &mut head(FIN | RSV1 | 1, 0)[..];
        let failure = Reader::new(false)
            .read_frame(&mut input, 10, &mut { ROOM })
            .err();
        assert_eq!(failure, Some(Rsv1));
    }

    #[test]
    fn copies_only_what_took_several_reads() {
        let (mut reader, mut room) = (Reader::new(false), ROOM);
        let mut frame = frame(FIN | 2, &bytes(100));
        let (mut head, mut payload) = frame.split_at_mut(6);
        let message = reader.read_frame(&mut head, 100, &mut room).unwrap();
        assert!(message.is_none());
        let message = reader.read_frame(&mut payload, 100, &mut room).unwrap();
        assert!(matches!(message.unwrap().payload, Cow::Borrowed(_)));
    }

    #[test]
    fn reuses_the_allocation() {
        let (mut reader, mut room) = (Reader::new(false), ROOM);
        let mut capacities = Vec::new();
        for len in [100, 50] {
            let mut frame = frame(FIN | 2, &bytes(len));
            let (mut first, mut second) = frame.split_at_mut(10);
            let message = reader.read_frame(&mut first, 100, &mut room).unwrap();
            assert!(message.is_none());
            let message = reader.read_frame(&mut second, 100, &mut room).unwrap();
            if let Cow::Owned(buffer) = message.unwrap().payload {
                capacities.push(buffer.capacity());
                reader.reuse(buffer);
            }
        }
        assert_eq!(capacities, [100, 100]);
    }

    #[test]
    fn allows_no_compression_while_a_compressed_message_arrives() {
        assert!(!Reader::new(false).allows_compression());
        let mut reader = Reader::new(true);
        let mut allowed = vec![reader.allows_compression()];
        for mut frame in [frame(RSV1 | 1, b"a"), frame(FIN | 9, b""), frame(FIN, b"")] {
            let _ = reader.read_frame(&mut &mut frame[..], 10, &mut { ROOM });
            allowed.push(reader.allows_compression());
        }
        assert_eq!(allowed, [true, false, false, true]);
    }

    #[test]
    fn finds_the_end_of_control_frames() {
        let control_frames = [frame(FIN | 9, b""), frame(FIN | 10, &bytes(125))].concat();
        for rest in [&b""[..], &frame(FIN | 1, b""), &frame(FIN | 9, b"a")[..6]] {
            let input = [&control_frames, rest].concat();
            assert_eq!(control_frames_len(&input), control_frames.len());
        }
    }

    #[test]
    fn parses_close_frames() {
        assert_eq!(parse_close(b"", false), Ok((1005, &b""[..])));
        assert_eq!(parse_close(b"\x03", false), Err(Failure::ClosePayload));
        assert_eq!(parse_close(b"\x03\xe8\xff", true), Err(Failure::Text));
        assert_eq!(
            parse_close(b"\x03\xe8\xff", false),
            Ok((1000, &b"\xff"[..]))
        );
        assert_eq!(
            parse_close(b"\x03\xed", false),
            Err(Failure::CloseCode(1005))
        );
    }
}

#[test]
fn writes_heads() {
    for (opcode, len, flags, expected) in [
        (Opcode::Text, 0, Flags::Final, &b"\x81\0"[..]),
        (Opcode::Continue, 125, Flags::None, b"\0\x7d"),
        (
            Opcode::Binary,
            126,
            Flags::FinalCompressed,
            b"\xc2\x7e\0\x7e",
        ),
        (Opcode::Binary, 65535, Flags::Final, b"\x82\x7e\xff\xff"),
        (
            Opcode::Text,
            65536,
            Flags::None,
            b"\x01\x7f\0\0\0\0\0\x01\0\0",
        ),
    ] {
        let mut out = [core::mem::MaybeUninit::uninit(); 12];
        let (head, rest) = write_unmasked_head(&mut out, opcode, len, flags);
        assert_eq!((head, rest.len()), (expected, 12 - expected.len()));
    }
}

#[test]
fn negotiates_compression() {
    const SHARED: &str = "; client_no_context_takeover; server_no_context_takeover";
    for (parameters, server, client, expected) in [
        ("", 0, 0, Some(SHARED)),
        ("", 15, 15, Some("")),
        (
            "",
            10,
            11,
            Some("; client_no_context_takeover; server_max_window_bits=10"),
        ),
        (
            " ;\tclient_max_window_bits",
            15,
            11,
            Some("; client_max_window_bits=11"),
        ),
        (
            "; client_max_window_bits=\"9\"; server_max_window_bits=8",
            15,
            15,
            Some("; client_max_window_bits=9; server_max_window_bits=8"),
        ),
        (
            "; server_max_window_bits=15",
            0,
            15,
            Some("; server_no_context_takeover; server_max_window_bits=15"),
        ),
        (SHARED, 15, 15, Some(SHARED)),
        ("; server_max_window_bits=14", 0, 0, None),
        (
            "; server_max_window_bits=14, x, permessage-deflate",
            0,
            0,
            Some(SHARED),
        ),
        ("; server_max_window_bits", 15, 15, None),
        ("; client_max_window_bits=7", 15, 15, None),
        ("; client_max_window_bits=16", 15, 15, None),
        ("; client_max_window_bits=09", 15, 15, None),
        (
            "; client_max_window_bits; client_max_window_bits",
            15,
            15,
            None,
        ),
        (
            "; server_max_window_bits=9; server_max_window_bits=9",
            15,
            15,
            None,
        ),
        ("; server_no_context_takeover=1", 15, 15, None),
        ("; client_no_context_takeover=1", 15, 15, None),
        (
            "; server_no_context_takeover; server_no_context_takeover",
            15,
            15,
            None,
        ),
        (
            "; client_no_context_takeover; client_no_context_takeover",
            15,
            15,
            None,
        ),
        ("; x", 15, 15, None),
        (";", 15, 15, None),
        ("x", 15, 15, None),
    ] {
        let offers = format!("permessage-deflate{parameters}");
        let response = negotiate_compression(offers.as_bytes(), server, client);
        let expected = expected.map(|rest| format!("permessage-deflate{rest}").into_bytes());
        assert_eq!(response.map(|(_, text)| text), expected, "{offers}");
    }
    let params = |offers: &[u8], server, client| {
        let (params, _) = negotiate_compression(offers, server, client).unwrap();
        [
            params.server_max_window_bits,
            params.client_max_window_bits,
            params.server_no_context_takeover,
            params.client_no_context_takeover,
        ]
    };
    assert_eq!(params(b"permessage-deflate", 0, 15), [15, 15, 1, 0]);
    assert_eq!(params(b"permessage-deflate", 9, 0), [9, 15, 0, 1]);
    assert_eq!(
        params(b"permessage-deflate; client_max_window_bits=8", 15, 12),
        [15, 8, 0, 0]
    );
}

#[test]
fn tells_safari_15_0_to_15_3() {
    for (user_agent, expected) in [
        ("a Version/15.0 Safari/1", true),
        ("a Version/15.3 Mobile/1 Safari/1", true),
        ("a Version/15.003 Safari/1", true),
        ("a Version/15.4 Safari/1", false),
        ("a Version/15.10 Safari/1", false),
        ("a Version/15.1.1 Safari/1", false),
        ("a Version/15. Safari/1", false),
        ("a Version/15.1", false),
        ("a Safari/1 Version/15.1 b", false),
        ("a Version/16.0 Safari/1", false),
    ] {
        let actual = has_broken_compression(user_agent.as_bytes());
        assert_eq!(actual, expected, "{user_agent}");
    }
}

mod topics {
    use super::*;

    #[derive(Clone, Copy)]
    struct Log<'a>(&'a RefCell<Vec<String>>, char);

    impl Receiver for Log<'_> {
        fn receive<'a>(self, messages: impl Iterator<Item = &'a Message>) {
            let messages = messages.map(|message| message.payload.escape_ascii().to_string());
            let messages = messages.collect::<Vec<_>>().join(",");
            self.0.borrow_mut().push(format!("{}:{messages}", self.1));
        }
    }

    fn publish(topics: &mut Topics<Log<'_>>, name: &[u8], payload: &[u8]) {
        let topic = topics.find(name).unwrap();
        topics.publish(topic, None, payload, Opcode::Text, false);
    }

    #[test]
    fn a_topic_lasts_as_long_as_it_has_subscribers() {
        let log = RefCell::default();
        let mut topics = Topics::default();
        let [a, b] = ['a', 'b'].map(|name| topics.add_subscriber(Log(&log, name)));
        for (subscriber, name) in [(a, b"x"), (a, b"x"), (a, b"y"), (b, b"y")] {
            topics.subscribe(subscriber, name);
        }
        assert_eq!(topics.names(a).collect::<Vec<_>>(), [b"x", b"y"]);
        assert!(topics.is_subscribed(a, b"x") && !topics.is_subscribed(b, b"x"));
        assert!(!topics.unsubscribe(b, b"x") && !topics.unsubscribe(b, b"z"));
        assert!(topics.unsubscribe(a, b"x") && topics.find(b"x").is_none());
        topics.remove_subscriber(a);
        let y = topics.find(b"y").unwrap();
        assert!(topics.subscribers(y) == [b]);
        assert_eq!(topics.receiver(b).1, 'b');
        assert!(!topics.publish(y, Some(b), b"", Opcode::Text, false));
        assert!(topics.publish(y, None, b"", Opcode::Text, false));
        topics.remove_subscriber(b);
        assert!(topics.find(b"y").is_none());
        assert!(topics.add_subscriber(Log(&log, 'c')) == b);
    }

    #[test]
    fn subscriptions_end_in_any_order() {
        let log = RefCell::default();
        let pairs = || (0..5).flat_map(|who| (0..5u8).map(move |name| (who, [name])));
        for step in [1, 2, 3, 7, 11, 24] {
            let mut topics = Topics::default();
            let all = [(); 5].map(|()| topics.add_subscriber(Log(&log, 'a')));
            let mut left: Vec<_> = pairs().collect();
            for (who, name) in &left {
                topics.subscribe(all[*who], name);
            }
            let mut at = 0;
            while !left.is_empty() {
                at = (at + step) % left.len();
                let (who, name) = left.remove(at);
                assert!(topics.unsubscribe(all[who], &name));
                assert!(!topics.unsubscribe(all[who], &name));
                assert!(topics.names(all[who]).is_sorted());
                for pair in pairs() {
                    assert_eq!(
                        topics.is_subscribed(all[pair.0], &pair.1),
                        left.contains(&pair)
                    );
                }
            }
        }
    }

    #[test]
    fn queues_until_drained() {
        let log = RefCell::default();
        let mut topics = Topics::default();
        let [a, b, c, d] = ['a', 'b', 'c', 'd'].map(|name| topics.add_subscriber(Log(&log, name)));
        for subscriber in [a, b, c, d] {
            topics.subscribe(subscriber, b"x");
        }
        let topic = topics.find(b"x").unwrap();
        topics.publish(topic, Some(b), b"1", Opcode::Text, false);
        publish(&mut topics, b"x", b"2");
        assert!(log.borrow().is_empty());
        topics.drain(a);
        topics.drain(a);
        topics.remove_subscriber(c);
        topics.drain(b);
        publish(&mut topics, b"x", b"3");
        topics.drain_all();
        topics.drain_all();
        assert_eq!(log.take(), ["a:1,2", "b:2", "a:3", "b:3", "d:1,2,3"]);
    }

    #[test]
    fn drains_a_full_queue() {
        let log = RefCell::default();
        let mut topics = Topics::default();
        let a = topics.add_subscriber(Log(&log, 'a'));
        topics.subscribe(a, b"x");
        for _ in 0..32 {
            publish(&mut topics, b"x", b"");
        }
        assert!(log.borrow().is_empty());
        publish(&mut topics, b"x", b"last");
        topics.drain(a);
        assert_eq!(
            log.take(),
            [format!("a:{}", ",".repeat(31)), "a:last".into()]
        );
    }

    #[test]
    fn drains_all_before_an_index_wraps() {
        let log = RefCell::default();
        let mut topics = Topics::default();
        let [a, b] = ['a', 'b'].map(|name| topics.add_subscriber(Log(&log, name)));
        topics.subscribe(a, b"x");
        topics.subscribe(b, b"y");
        publish(&mut topics, b"x", b"first");
        for _ in 1..u16::MAX {
            publish(&mut topics, b"y", b"");
        }
        assert!(log.take().iter().all(|line| line.starts_with('b')));
        publish(&mut topics, b"y", b"last");
        assert_eq!(log.take().last().unwrap(), "a:first");
        topics.drain_all();
        assert_eq!(log.take(), ["b:last"]);
    }

    #[test]
    fn forgets_what_it_queued_for_those_who_left() {
        let log = RefCell::default();
        let mut topics = Topics::default();
        for _ in 0..u16::MAX {
            let a = topics.add_subscriber(Log(&log, 'a'));
            topics.subscribe(a, b"x");
            publish(&mut topics, b"x", b"private");
            topics.remove_subscriber(a);
        }
        let b = topics.add_subscriber(Log(&log, 'b'));
        topics.subscribe(b, b"y");
        publish(&mut topics, b"y", b"1");
        publish(&mut topics, b"y", b"2");
        topics.drain_all();
        assert_eq!(log.take(), ["b:1,2"]);
    }
}
