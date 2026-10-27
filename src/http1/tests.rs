//! The cases of picohttpparser's `test.c` that apply, where Bun differs from it, and every byte value at every
//! alignment of the 16-byte blocks that `response::index_of` reads (see `PADDINGS` for what Miri runs of that).
#![allow(clippy::indexing_slicing, clippy::unwrap_used, clippy::panic)]

use crate::ParseError::{Incomplete, Malformed};
use crate::{
    ChunkedDecoder, ChunkedStatus, Decoded, Header, ParseError, ResponseHead, parse_response,
};

type Parsed<'a> = Result<(ResponseHead<'a>, Vec<(&'a [u8], &'a [u8])>), ParseError>;

fn parse_with_slots(buf: &[u8], slots: usize) -> Parsed<'_> {
    let mut headers = vec![Header::default(); slots];
    let head = parse_response(buf, &mut headers)?;
    headers.truncate(head.header_count);
    Ok((head, headers.iter().map(|h| (h.name, h.value)).collect()))
}

fn parse(buf: &[u8]) -> Parsed<'_> {
    parse_with_slots(buf, 4)
}

/// The whole of `buf` is a head with these parts.
#[track_caller]
fn assert_head(
    buf: &[u8],
    minor_version: u8,
    status_code: u16,
    reason: &[u8],
    expected: &[(&[u8], &[u8])],
) {
    let (head, headers) = parse(buf).unwrap();
    assert_eq!(
        head,
        ResponseHead {
            minor_version,
            status_code,
            reason,
            header_count: expected.len(),
            len: buf.len()
        }
    );
    assert_eq!(headers, expected);
}

#[track_caller]
fn assert_error(buf: &[u8], error: ParseError) {
    assert_eq!(
        parse(buf).unwrap_err(),
        error,
        "{:?}",
        buf.escape_ascii().to_string()
    );
}

#[test]
fn heads() {
    assert_head(b"HTTP/1.0 200 OK\r\n\r\n", 0, 200, b"OK", &[]);
    assert_head(
        b"HTTP/1.1 200 OK\r\nHost: example.com\r\nCookie: \r\n\r\n",
        1,
        200,
        b"OK",
        &[(b"Host", b"example.com"), (b"Cookie", b"")],
    );
    assert_head(
        b"HTTP/1.0 500 Internal Server Error\r\n\r\n",
        0,
        500,
        b"Internal Server Error",
        &[],
    );
    assert_head(b"HTTP/1.1 200\r\n\r\n", 1, 200, b"", &[]);
    assert_head(b"HTTP/1.1 200 \r\n\r\n", 1, 200, b"", &[]);
    assert_head(b"HTTP/1.1   200   OK\r\n\r\n", 1, 200, b"OK", &[]);
    assert_head(b"HTTP/1.1 200 OK \t\r\n\r\n", 1, 200, b"OK \t", &[]);
    assert_head(
        b"HTTP/1.9 000 \xe3\x81\xb2\r\n\r\n",
        9,
        0,
        b"\xe3\x81\xb2",
        &[],
    );
    assert_head(b"HTTP/1.1 999 OK\r\n\r\n", 1, 999, b"OK", &[]);
    assert_head(
        b"HTTP/1.1 200 OK\r\nbar: \t b\t \t\r\n\r\n",
        1,
        200,
        b"OK",
        &[(b"bar", b"b")],
    );
    assert_head(
        b"HTTP/1.1 200 OK\r\nbar:b\r\n\r\n",
        1,
        200,
        b"OK",
        &[(b"bar", b"b")],
    );
    assert_head(
        b"HTTP/1.1 200 OK\r\nbar:a \t b\r\n\r\n",
        1,
        200,
        b"OK",
        &[(b"bar", b"a \t b")],
    );
    assert_head(
        b"HTTP/1.1 200 OK\r\nh: c\xa2y\r\n\r\n",
        1,
        200,
        b"OK",
        &[(b"h", b"c\xa2y")],
    );
    assert_head(
        b"HTTP/1.1 200 OK\r\n|~: 1\r\n\r\n",
        1,
        200,
        b"OK",
        &[(b"|~", b"1")],
    );
    assert_head(
        b"HTTP/1.1 200 OK\r\na::b\r\n\r\n",
        1,
        200,
        b"OK",
        &[(b"a", b":b")],
    );
}

#[test]
fn a_line_may_end_in_lf_alone() {
    assert_head(
        b"HTTP/1.1 200 OK\na: b\nc: d\r\n\n",
        1,
        200,
        b"OK",
        &[(b"a", b"b"), (b"c", b"d")],
    );
    assert_error(b"HTTP/1.1 200 OK\r\ra: b\r\n\r\n", Malformed);
    assert_error(b"HTTP/1.1 200 OK\r\na: b\r\r\n\r\n", Malformed);
    assert_error(b"HTTP/1.1 200 OK\r\na: b\r\n\rX", Malformed);
}

#[test]
fn the_head_ends_at_its_empty_line() {
    let (head, _) = parse(b"HTTP/1.1 200 OK\r\na: b\r\n\r\nc: d\r\n\r\n").unwrap();
    assert_eq!((head.len, head.header_count), (25, 1));
}

#[test]
fn incomplete() {
    for buf in [
        &b""[..],
        b"H",
        b"HTTP/1.",
        b"HTTP/1.1",
        b"HTTP/1.1 ",
        b"HTTP/1.1    ",
        b"HTTP/1.1 2",
        b"HTTP/1.1 200",
        b"HTTP/1.1 200 ",
        b"HTTP/1.1 200 O",
        b"HTTP/1.1 200 OK\r",
        b"HTTP/1.1 200 OK\r\n",
        b"HTTP/1.1 200 OK\n",
        b"HTTP/1.1 200 OK\r\nA",
        b"HTTP/1.1 200 OK\r\nA:",
        b"HTTP/1.1 200 OK\r\nA: \t",
        b"HTTP/1.1 200 OK\r\nA: 1\r",
        b"HTTP/1.1 200 OK\r\nA: 1\r\n",
        b"HTTP/1.0 200 OK\r\n\r",
        // Nothing is looked at before there are nine bytes, nor the status before the byte after it.
        b"GET / HT",
        b"HTTP/1.1 xyz",
        // What follows the status is looked at once its line has ended.
        b"HTTP/1.1 200X",
    ] {
        assert_error(buf, Incomplete);
    }
}

#[test]
fn every_prefix_of_a_head_is_incomplete() {
    let head = b"HTTP/1.1 404 Not Found\r\nContent-Type: text/html; charset=utf-8\r\nx: \t\r\nSet-Cookie: a=b\n\r\n";
    for len in 0..head.len() {
        assert_error(&head[..len], Incomplete);
    }
    assert!(parse(head).is_ok());
}

#[test]
fn malformed_status_line() {
    for buf in [
        &b"HTTP/1. 200 OK\r\n\r\n"[..],
        b"HTTP/1.2z 200 OK\r\n\r\n",
        b"HTTP/1.1  OK\r\n\r\n",
        b"HTTP/1.1 200X\r\n\r\n",
        b"HTTP/1.1 200X \r\n\r\n",
        b"HTTP/1.1 200X OK\r\n\r\n",
        b"HTTP/1.1 2000 OK\r\n\r\n",
        b"HTTP/1.1 20 OK\r\n\r\n",
        b"HTTP/1.1 200\tOK\r\n\r\n",
        b"HTTP/1.1\t200 OK\r\n\r\n",
        b"HTTP/1.1\r\n\r\n",
        b"HTTP/2.0 200 OK\r\n\r\n",
        b"http/1.1 200 OK\r\n\r\n",
        b" HTTP/1.1 200 OK\r\n\r\n",
        b"\r\nHTTP/1.1 200 OK\r\n\r\n",
        b"GET / HTTP/1.1\r\n\r\n",
        b"HTTP/1.1 200 O\0K\r\n\r\n",
        b"HTTP/1.1 200 O\x7fK\r\n\r\n",
        b"HTTP/1.1 200 O\rK\r\n\r\n",
    ] {
        assert_error(buf, Malformed);
    }
}

#[test]
fn malformed_header() {
    for header in [
        &b"foo : ab"[..],
        b":a",
        b" :a",
        b" a: b",
        b"\ta: b",
        b"a\0b: c",
        b"ab: c\0d",
        b"a\x1bb: c",
        b"ab: c\x1b",
        b"ab: c\x7f",
        b"/: 1",
        b"{: 1",
        b"a\xa0: 1",
        b"a b: 1",
        b"a",
        b"a\r: 1",
    ] {
        assert_error(
            &[b"HTTP/1.1 200 OK\r\n", header, b"\r\n\r\n"].concat(),
            Malformed,
        );
    }
}

#[test]
fn a_folded_line_is_malformed_once_the_head_is_whole() {
    for head in [
        &b"HTTP/1.0 200 OK\r\nfoo: \r\nfoo: b\r\n  \tc\r\n\r\n"[..],
        b"HTTP/1.0 200 OK\r\nfoo: b\r\n\tc\r\nbar: d\r\n\r\n",
        b"HTTP/1.0 200 OK\r\nfoo: b\r\n \r\n\r\n",
    ] {
        for len in 0..head.len() {
            assert_error(&head[..len], Incomplete);
        }
        assert_error(head, Malformed);
    }
    assert_error(b"HTTP/1.0 200 OK\r\nfoo: b\r\n c\0", Malformed);
    // There is nothing for the first line to continue, so it is a name that starts with a blank.
    assert_error(b"HTTP/1.0 200 OK\r\n c", Malformed);
    assert_error(b"HTTP/1.0 200 OK\r\n\tc", Malformed);
}

/// Too short for `response::index_of` to read a block.
#[test]
fn fewer_than_sixteen_bytes() {
    assert_head(b"HTTP/1.1 200\n\n", 1, 200, b"", &[]);
    assert_head(b"HTTP/1.1 200\r\n\n", 1, 200, b"", &[]);
    assert_head(b"HTTP/1.1 200\n\r\n", 1, 200, b"", &[]);
    assert_head(b"HTTP/1.1 200 \n\n", 1, 200, b"", &[]);
    assert_error(b"HTTP/1.1 200\n\r", Incomplete);
    assert_error(b"HTTP/1.1 200\na:", Incomplete);
    assert_error(b"HTTP/1.1 200 \0", Malformed);
    assert_error(b"HTTP/1.1 200\n:", Malformed);
}

#[test]
fn more_headers_than_slots() {
    let head = b"HTTP/1.1 200 OK\r\na: 1\r\nb: 2\r\n\r\n";
    assert!(parse_with_slots(head, 3).is_ok());
    assert!(parse_with_slots(head, 2).is_ok());
    assert_eq!(parse_with_slots(head, 1).unwrap_err(), Malformed);
    assert_eq!(parse_with_slots(head, 0).unwrap_err(), Malformed);
    assert!(parse_with_slots(b"HTTP/1.1 200 OK\r\n\r\n", 0).is_ok());

    // The first byte of the line that has no slot is enough.
    assert_eq!(
        parse_with_slots(b"HTTP/1.1 200 OK\r\na: 1\r\n", 1).unwrap_err(),
        Incomplete
    );
    assert_eq!(
        parse_with_slots(b"HTTP/1.1 200 OK\r\na: 1\r\n\r", 1).unwrap_err(),
        Incomplete
    );
    assert_eq!(
        parse_with_slots(b"HTTP/1.1 200 OK\r\na: 1\r\nb", 1).unwrap_err(),
        Malformed
    );
    // A folded line needs one as well.
    assert_eq!(
        parse_with_slots(b"HTTP/1.1 200 OK\r\na: 1\r\n ", 1).unwrap_err(),
        Malformed
    );
    assert_eq!(
        parse_with_slots(b"HTTP/1.1 200 OK\r\na: 1\r\n ", 2).unwrap_err(),
        Incomplete
    );
}

/// How many bytes to put before and after the byte that is looked at, so that it falls on every place of a block and
/// in the tail. Miri, which is what runs these tests in CI, takes 30 ms to parse a head: it gets the last place of a
/// block and the first of the next.
const PADDINGS: core::ops::Range<usize> = if cfg!(miri) { 15..17 } else { 1..35 };

#[test]
fn every_byte_in_a_header_name() {
    for byte in 0..=u8::MAX {
        let is_token = byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte);
        for before in PADDINGS {
            let name = [
                &vec![b'a'; before][..],
                &[byte],
                &vec![b'z'; PADDINGS.end][..],
            ]
            .concat();
            let head = [b"HTTP/1.1 200 OK\r\n", &name[..], b": v\r\n\r\n"].concat();
            match parse(&head) {
                Ok((_, headers)) if byte == b':' => assert_eq!(headers[0].0, &name[..before]),
                Ok((_, headers)) => {
                    assert!(is_token, "{byte:#x} at {before}");
                    assert_eq!(headers, [(&name[..], &b"v"[..])]);
                }
                Err(error) => {
                    assert!(!is_token && byte != b':', "{byte:#x} at {before}");
                    assert_eq!(error, Malformed);
                }
            }
        }
    }
}

#[test]
fn every_byte_in_a_header_value_and_a_reason() {
    for byte in 0..=u8::MAX {
        if matches!(byte, b'\r' | b'\n') {
            continue;
        }
        let is_allowed = byte == b'\t' || (byte >= b' ' && byte != 0x7f);
        for before in PADDINGS {
            let text = [
                &vec![b'a'; before][..],
                &[byte],
                &vec![b'z'; PADDINGS.end][..],
            ]
            .concat();
            let head = [b"HTTP/1.1 200 ", &text[..], b"\r\nn: ", &text[..], b"\n\n"].concat();
            match parse(&head) {
                Ok((parsed, headers)) => {
                    assert!(is_allowed, "{byte:#x} at {before}");
                    assert_eq!(parsed.reason, text);
                    assert_eq!(headers, [(&b"n"[..], &text[..])]);
                }
                Err(error) => {
                    assert!(!is_allowed, "{byte:#x} at {before}");
                    assert_eq!(error, Malformed);
                }
            }
        }
    }
}

/// Feeds `encoded` in pieces of `piece_len`. Returns the data, the last status, and what followed the data in the last
/// piece.
fn decode_in_pieces(encoded: &[u8], piece_len: usize) -> (Vec<u8>, ChunkedStatus, Vec<u8>) {
    let mut decoder = ChunkedDecoder::default();
    let mut data = Vec::new();
    let mut pieces = encoded.chunks(piece_len).peekable();
    while let Some(piece) = pieces.next() {
        let mut piece = piece.to_vec();
        let decoded = decoder.decode(&mut piece);
        data.extend_from_slice(&piece[..decoded.len]);
        let rest = match decoded.status {
            ChunkedStatus::Incomplete if pieces.peek().is_some() => continue,
            ChunkedStatus::Complete { trailing } => piece[decoded.len..][..trailing].to_vec(),
            _ => Vec::new(),
        };
        return (data, decoded.status, rest);
    }
    (data, ChunkedStatus::Incomplete, Vec::new())
}

#[track_caller]
fn assert_decodes(encoded: &[u8], data: &[u8], status: ChunkedStatus) {
    for piece_len in 1..=encoded.len() {
        let (decoded, last, _) = decode_in_pieces(encoded, piece_len);
        let last = match (last, status) {
            // How much of the last piece is left depends on where the pieces were cut.
            (ChunkedStatus::Complete { .. }, ChunkedStatus::Complete { .. })
                if piece_len < encoded.len() =>
            {
                status
            }
            _ => last,
        };
        assert_eq!(
            (decoded.escape_ascii().to_string(), last),
            (data.escape_ascii().to_string(), status),
            "{:?} in pieces of {piece_len}",
            encoded.escape_ascii().to_string()
        );
    }
}

const COMPLETE: ChunkedStatus = ChunkedStatus::Complete { trailing: 0 };

#[test]
fn chunked_bodies() {
    assert_decodes(b"b\r\nhello world\r\n0\r\n\r\n", b"hello world", COMPLETE);
    assert_decodes(
        b"6\r\nhello \r\n5\r\nworld\r\n0\r\n\r\n",
        b"hello world",
        COMPLETE,
    );
    assert_decodes(
        b"6;comment=hi\r\nhello \r\n5\r\nworld\r\n0\r\n\r\n",
        b"hello world",
        COMPLETE,
    );
    assert_decodes(
        b"6;\"\t \x00\xff\r\nhello \r\n5;\r\nworld\r\n0;a\r\n\r\n",
        b"hello world",
        COMPLETE,
    );
    assert_decodes(b"0\r\n\r\n", b"", COMPLETE);
    assert_decodes(b"000\r\n\r\n", b"", COMPLETE);
    assert_decodes(
        b"A\r\n0123456789\r\n0a\r\n0123456789\r\n0\r\n\r\n",
        b"01234567890123456789",
        COMPLETE,
    );
    assert_decodes(
        b"2\r\n\r\n\r\n3\r\n0\r\n\r\n0\r\n\r\n",
        b"\r\n0\r\n",
        COMPLETE,
    );
}

#[test]
fn chunked_body_cut_short() {
    assert_eq!(
        ChunkedDecoder::default().decode(&mut []),
        Decoded {
            len: 0,
            status: ChunkedStatus::Incomplete
        }
    );
    assert_decodes(b"b", b"", ChunkedStatus::Incomplete);
    assert_decodes(b"b\r\nhello", b"hello", ChunkedStatus::Incomplete);
    assert_decodes(
        b"b\r\nhello world",
        b"hello world",
        ChunkedStatus::Incomplete,
    );
    assert_decodes(
        b"b\r\nhello world\r\n0\r\n",
        b"hello world",
        ChunkedStatus::Incomplete,
    );
    assert_decodes(
        b"6\r\nhello \r\n5\r\nworld\r\n0\r\n",
        b"hello world",
        ChunkedStatus::Incomplete,
    );
    assert_decodes(
        b"6\r\nhello \r\n5\r\nworld\r\n0\r\na: b\r\n",
        b"hello world",
        ChunkedStatus::Incomplete,
    );
}

#[test]
fn trailer_section_is_dropped() {
    assert_decodes(
        b"6\r\nhello \r\n5\r\nworld\r\n0\r\na: b\r\nc: d\r\n\r\n",
        b"hello world",
        COMPLETE,
    );
    assert_decodes(b"b\r\nhello world\r\n0\r\n\n", b"hello world", COMPLETE);
    assert_decodes(
        b"6\r\nhello \r\n5\r\nworld\r\n0\r\na: b\nc: d\n\n",
        b"hello world",
        COMPLETE,
    );
    assert_decodes(b"1\r\na\r\n0\r\n\r\r\r\n", b"a", COMPLETE);
    assert_decodes(b"1\r\na\r\n0\r\n\ra\r\n\r\n", b"a", COMPLETE);
    assert_decodes(b"1\r\na\r\n0\r\n\x00\xff\r\n\r\n", b"a", COMPLETE);
}

#[test]
fn malformed_chunks() {
    for (encoded, data) in [
        (&b"z\r\nabcdefg"[..], &b""[..]),
        (b"\r\n", b""),
        (b";\r\n", b""),
        (b"-1\r\n", b""),
        (b"0x1\r\n", b""),
        (b"1x\r\na\r\n0\r\n", b""),
        (b"6\nhello \r\n5\r\nworld\r\n0\r\n", b""),
        (b"6;a\nhello \r\n", b""),
        (b"6\rX\nhello \n5\r\nworld\r\n0\r\n", b""),
        (b"6\r\nhello \n5\r\nworld\r\n0\r\n", b"hello "),
        (b"6\r\nhello \r\r\n", b"hello "),
        (b"6\r\nhello !\r\n", b"hello "),
        (b"6\r\nhello \r\n5\r\nworld\n0\r\n", b"hello world"),
        (b"6\r\nhello \r\n5\r\nworld\r\n0\n", b"hello world"),
        (b"6\r\nhello \r\n\r\n", b"hello "),
    ] {
        assert_decodes(encoded, data, ChunkedStatus::Malformed);
    }
}

/// picohttpparser allows it, llhttp does not.
#[test]
fn no_whitespace_after_the_chunk_size() {
    assert_decodes(
        b"6 ; comment\r\nhello \r\n0\r\n\r\n",
        b"",
        ChunkedStatus::Malformed,
    );
    assert_decodes(b"6 \r\nhello \r\n0\r\n\r\n", b"", ChunkedStatus::Malformed);
    assert_decodes(b"6\t\r\nhello \r\n0\r\n\r\n", b"", ChunkedStatus::Malformed);
    assert_decodes(b"6; comment \r\nhello \r\n0\r\n\r\n", b"hello ", COMPLETE);
}

#[test]
fn chunk_size_has_as_many_digits_as_a_usize() {
    let digits = usize::BITS as usize / 4;
    let most = [b"6\r\nhello \r\n", &vec![b'f'; digits][..], b"\r\nabcdefg"].concat();
    assert_decodes(&most, b"hello abcdefg", ChunkedStatus::Incomplete);
    let too_many = [
        b"6\r\nhello \r\n",
        &vec![b'f'; digits + 1][..],
        b"\r\nabcdefg",
    ]
    .concat();
    assert_decodes(&too_many, b"hello ", ChunkedStatus::Malformed);
    // Zeros in front count.
    let zeros = [&vec![b'0'; digits - 1][..], b"1\r\na\r\n0\r\n\r\n"].concat();
    assert_decodes(&zeros, b"a", COMPLETE);
    let too_many_zeros = [&vec![b'0'; digits][..], b"1\r\na\r\n0\r\n\r\n"].concat();
    assert_decodes(&too_many_zeros, b"", ChunkedStatus::Malformed);
}

#[test]
fn bytes_after_the_body_follow_the_data() {
    let next = b"HTTP/1.1 200 OK\r\n\r\n";
    let encoded = [b"5\r\nabcde\r\n0\r\n\r\n", &next[..]].concat();
    let (data, status, rest) = decode_in_pieces(&encoded, encoded.len());
    assert_eq!(data, b"abcde");
    assert_eq!(
        status,
        ChunkedStatus::Complete {
            trailing: next.len()
        }
    );
    assert_eq!(rest, next);
}

#[test]
fn bytes_after_an_error_follow_the_data() {
    let mut buf = *b"2\r\nab\r\n1\r\ncX\nrest";
    let decoded = ChunkedDecoder::default().decode(&mut buf);
    assert_eq!((decoded.len, decoded.status), (3, ChunkedStatus::Malformed));
    assert_eq!(&buf[..decoded.len + 6], b"abcX\nrest");
}

#[test]
fn in_trailers_from_the_end_of_the_last_chunk() {
    let encoded = b"1;x\r\na\r\n0;x\r\na: b\r\n\r\n";
    let last_chunk_end = encoded.len() - b"a: b\r\n\r\n".len();
    let mut decoder = ChunkedDecoder::default();
    assert!(!decoder.is_in_trailers());
    for (i, &byte) in encoded.iter().enumerate() {
        decoder.decode(&mut [byte]);
        assert_eq!(
            decoder.is_in_trailers(),
            i + 1 >= last_chunk_end,
            "after byte {i}"
        );
    }
}

#[test]
fn after_the_body_come_more_trailer_lines() {
    let mut decoder = ChunkedDecoder::default();
    assert_eq!(
        decoder.decode(&mut *b"1\r\na\r\n0\r\n\r\n".to_vec()).status,
        COMPLETE
    );
    for (piece, status) in [
        (&b"1\r\na\r\n"[..], ChunkedStatus::Incomplete),
        (b"", ChunkedStatus::Incomplete),
        (b"\r\nrest", ChunkedStatus::Complete { trailing: 4 }),
        (b"\n", COMPLETE),
    ] {
        let decoded = decoder.decode(&mut piece.to_vec());
        assert_eq!((decoded.len, decoded.status), (0, status));
        assert!(decoder.is_in_trailers());
    }
}

/// `fetch()` does not decode again after an error, but a listener of `ws` that runs the event loop can make the
/// `WebSocket` client do it.
#[test]
fn after_an_error_the_decoder_goes_on_from_where_it_stopped() {
    for (bad, then, data, status) in [
        (
            &b"1\n"[..],
            &b"x\r\nA\r\n0\r\n\r\n"[..],
            &b"A"[..],
            COMPLETE,
        ),
        (b"1;\n", b"x\r\nA\r\n0\r\n\r\n", b"A", COMPLETE),
        (b"1x", b"\r\nA\r\n0\r\n\r\n", b"A", COMPLETE),
        (
            b"1x",
            b"0\r\n0123456789abcdef\r\n",
            b"0123456789abcdef",
            ChunkedStatus::Incomplete,
        ),
        (b"1\rx", b"\nA\r\n0\r\n\r\n", b"A", COMPLETE),
        (b"1\r\nAx", b"\r\n0\r\n\r\n", b"", COMPLETE),
    ] {
        let mut decoder = ChunkedDecoder::default();
        assert_eq!(
            decoder.decode(&mut bad.to_vec()).status,
            ChunkedStatus::Malformed
        );
        let mut then = then.to_vec();
        let decoded = decoder.decode(&mut then);
        assert_eq!(
            (&then[..decoded.len], decoded.status),
            (data, status),
            "{:?}",
            bad.escape_ascii().to_string()
        );
    }
}

/// picohttpparser gives up once the framing is over 100 KB and three quarters of what it has read. That protects a
/// server, and a response made of very small chunks is legitimate.
#[test]
#[cfg_attr(miri, ignore = "slow")]
fn any_number_of_small_chunks() {
    let mut decoder = ChunkedDecoder::default();
    for _ in 0..1_000_000 {
        let mut chunk = *b"1;aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\nA\r\n";
        let decoded = decoder.decode(&mut chunk);
        assert_eq!(
            (decoded.len, decoded.status),
            (1, ChunkedStatus::Incomplete)
        );
    }
    assert_eq!(decoder.decode(&mut *b"0\r\n\r\n".to_vec()).status, COMPLETE);
}

/// What picohttpparser got wrong at one time or another, by the commit that fixed it. That commit's parent hangs on
/// each of these, reads past the end of it, overflows an `int` or gives another answer.
#[test]
fn bugs_fixed_in_picohttpparser_heads() {
    let head = |header: &[u8]| [b"HTTP/1.1 200 OK\r\n", header, b"\r\n\r\n"].concat();

    // 8edde15, and 3d506cc after 8efc8f1 had undone it: a name of no bytes, or one that starts with a blank.
    for header in [&b":a"[..], b" :a", b": 1", b"a: 1\r\n: 2"] {
        assert_error(&head(header), Malformed);
    }
    // 6ca637d: control characters.
    for header in [&b"a: b\0c"[..], b"a: b\x1bc", b"a: b\x7fc"] {
        assert_error(&head(header), Malformed);
    }
    assert_error(b"HTTP/1.1 200 O\0K\r\n\r\n", Malformed);
    // d2ee427: the search of a value never got past a byte over 0x7f.
    let value = b"\xe3\x81\xb2".repeat(20);
    assert_head(
        &head(&[b"User-Agent: ", &value[..]].concat()),
        1,
        200,
        b"OK",
        &[(b"User-Agent", &value)],
    );
    // 8efc8f1: a name is a token.
    for byte in *b"\"(),/;<=>?@[\\]{} \x7f" {
        assert_error(&head(&[b'a', byte, b'b', b':', b' ', b'1']), Malformed);
    }
    // 3aba9fe: the version and the status took any number of digits.
    for buf in [
        &b"HTTP/1.99999999999999999999 200 OK\r\n\r\n"[..],
        b"HTTP/1.1 99999999999999999999 OK\r\n\r\n",
        b"HTTP/1.10 200 OK\r\n\r\n",
        b"HTTP/1.1 2000 OK\r\n\r\n",
        b"HTTP/1.1 20 OK\r\n\r\n",
    ] {
        assert_error(buf, Malformed);
    }
    // 6bd82cb: the blanks after a value are not part of it.
    assert_head(&head(b"bar: \t b\t \t"), 1, 200, b"OK", &[(b"bar", b"b")]);
    // 14fc601, a6ab773: no reason and no space before it, and more spaces than one.
    assert_head(b"HTTP/1.1 200\r\n\r\n", 1, 200, b"", &[]);
    assert_head(b"HTTP/1.1   200   OK\r\n\r\n", 1, 200, b"OK", &[]);
    assert_head(b"HTTP/1.1 200     \r\n\r\n", 1, 200, b"", &[]);
    // b820122, a security fix: since a6ab773 those spaces were skipped without a look at where the buffer ends.
    for spaces in [1, 2, 7, 8, 15, 16, 17, 64, 4096] {
        assert_error(
            &[&b"HTTP/1.1"[..], &vec![b' '; spaces]].concat(),
            Incomplete,
        );
    }
}

/// As above. The names in capitals are the kinds of request smuggling in "Funky chunks" (w4ke.info, 2025), each of
/// which needs one of two parsers to be lenient in that way.
#[test]
fn bugs_fixed_in_picohttpparser_chunks() {
    let malformed = |encoded: &[u8], data: &[u8]| {
        assert_decodes(encoded, data, ChunkedStatus::Malformed);
    };

    // f5ae3f3: CRLF after the data.
    malformed(b"5\r\nhello0\r\n\r\n", b"hello");
    // d236094: what followed the digits was skipped, so that `5x` was 5 here and could be something else elsewhere.
    for byte in *b"xg_,=\0\x80-+." {
        malformed(
            &[&[b'5', byte][..], b"\r\nhello\r\n0\r\n\r\n"].concat(),
            b"",
        );
    }
    malformed(b"0x5\r\nhello\r\n0\r\n\r\n", b"");
    // a875a01, TERM.EXT and EXT.TERM: LF alone ended the size line, and CR alone was part of it.
    for size_line in [&b"5\n"[..], b"5;a\n", b"5;a\rb\r\n", b"5\r\r\n", b"5\rX\n"] {
        malformed(&[size_line, b"hello\r\n0\r\n\r\n"].concat(), b"");
    }
    malformed(b"2;\nxx\r\n4\r\nabcd\r\n0\r\n\r\n", b"");
    malformed(b"5\r\nhello\r\n0\n\r\n", b"hello");
    // a875a01, SPILL.TERM: LF alone ended the data, and so did any number of CR before it.
    malformed(b"5\r\nhello\n0\r\n\r\n", b"hello");
    malformed(b"5\r\nhello\r\r\n0\r\n\r\n", b"hello");

    // Never picohttpparser's: TERM.SPILL, and two bytes after the data that are not looked at.
    for after_data in [&b"XX"[..], b"XXX\r\n", b"\r", b"\n\r"] {
        malformed(
            &[b"5\r\nhello", after_data, b"0\r\n\r\n"].concat(),
            b"hello",
        );
    }
}
