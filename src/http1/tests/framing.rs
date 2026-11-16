use bun_http1::{ChunkedDecoder, Error, HeadOptions, ResponseParser};

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}

/// Stands in for highway_byte_set.cpp, which test/js/bun/util/highway-strings.test.ts covers.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_byte_set_prefix_length(
    text: *const u8,
    len: usize,
    [rows, columns]: &[[u8; 16]; 2],
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { core::slice::from_raw_parts(text, len) };
    text.iter()
        .take_while(|&&byte| rows[usize::from(byte >> 4)] & columns[usize::from(byte & 15)] != 0)
        .count()
}

/// One read, every pair of reads, and one read per byte.
fn ways_to_read(bytes: &[u8]) -> Vec<Vec<&[u8]>> {
    let mut ways = vec![vec![bytes], bytes.chunks(1).collect()];
    for at in 0..=bytes.len() {
        let (first, second) = bytes.split_at(at);
        ways.push(vec![first, second]);
    }
    ways
}

fn show(bytes: &[u8]) -> String {
    bytes.escape_ascii().to_string()
}

/// Too short for the kernel, and long enough.
fn paddings() -> impl Iterator<Item = Vec<u8>> {
    (0..=34).map(|len| vec![b'a'; len])
}

fn is_token(byte: u8) -> bool {
    byte.is_ascii_graphic() && b"\"(),/:;<=>?@[\\]{}".iter().all(|&other| other != byte)
}

fn is_content(byte: u8) -> bool {
    byte == b'\t' || !byte.is_ascii_control()
}

mod head {
    use super::*;

    const NO_LIMITS: HeadOptions = HeadOptions {
        max_len: u32::MAX,
        max_headers: usize::MAX,
        max_interim_len: usize::MAX,
        spare_capacity: 8,
    };

    /// `1.1 200 "OK" [a=b] +rest`
    type Outcome = bun_http1::Result<Option<String>>;

    fn feed(reads: &[&[u8]], limits: HeadOptions) -> Outcome {
        let mut parser = ResponseParser::default();
        for (i, read) in reads.iter().enumerate() {
            let fed = parser.feed(read, limits);
            assert!(parser.received_len() <= limits.max_len as usize);
            let Some((response, rest)) = fed? else {
                continue;
            };
            let received = reads[..=i].concat();
            assert!(received.ends_with(&[&response.headers.buf, rest].concat()));
            assert!(response.headers.buf.starts_with(b"HTTP/1."));
            let spare = response.headers.buf.capacity() - response.headers.buf.len();
            assert!(spare >= limits.spare_capacity);
            assert_eq!(parser.memory_cost(), 0);
            let headers: Vec<_> = response
                .headers
                .iter()
                .map(|header| format!("{}={}", show(header.name()), show(header.value())))
                .collect();
            return Ok(Some(format!(
                "1.{} {} \"{}\" [{}] +{}",
                response.minor_version,
                response.status_code,
                show(response.status_text()),
                headers.join(" "),
                show(&[rest, &reads[i + 1..].concat()].concat()),
            )));
        }
        Ok(None)
    }

    #[track_caller]
    fn parse_within(bytes: &[u8], limits: HeadOptions) -> Outcome {
        let outcome = feed(&[bytes], limits);
        for reads in ways_to_read(bytes) {
            let lens: Vec<_> = reads.iter().map(|read| read.len()).collect();
            assert_eq!(feed(&reads, limits), outcome, "{} {lens:?}", show(bytes));
        }
        outcome
    }

    #[track_caller]
    fn parse(bytes: &[u8]) -> Outcome {
        parse_within(bytes, NO_LIMITS)
    }

    #[test]
    fn complete() {
        for (bytes, expected) in [
            (&b"HTTP/1.0 200 OK\r\n\r\n"[..], r#"1.0 200 "OK" [] +"#),
            (b"HTTP/1.1 200 OK\r\n\r\nbody", r#"1.1 200 "OK" [] +body"#),
            (b"HTTP/1.1 200 OK\r\n\r\n\r\n", r#"1.1 200 "OK" [] +\r\n"#),
            (b"HTTP/1.9 200 OK\r\n\r\n", r#"1.9 200 "OK" [] +"#),
            (b"HTTP/1.1 101 Go\r\n\r\n", r#"1.1 101 "Go" [] +"#),
            (b"HTTP/1.1 999 No\r\n\r\n", r#"1.1 999 "No" [] +"#),
            (b"HTTP/1.1 204\r\n\r\n", r#"1.1 204 "" [] +"#),
            (b"HTTP/1.1 204 \r\n\r\n", r#"1.1 204 "" [] +"#),
            (b"HTTP/1.1   200   OK\r\n\r\n", r#"1.1 200 "OK" [] +"#),
            (b"HTTP/1.1 200 \tOK \t\r\n\r\n", r#"1.1 200 "\tOK \t" [] +"#),
            (b"HTTP/1.1 200 \xe9\r\n\r\n", r#"1.1 200 "\xe9" [] +"#),
            (
                b"HTTP/1.0 500 Internal Server Error\r\n\r\n",
                r#"1.0 500 "Internal Server Error" [] +"#,
            ),
            (
                b"HTTP/1.1 200 OK\r\nHost: example.com\r\nCookie: \r\n\r\n",
                r#"1.1 200 "OK" [Host=example.com Cookie=] +"#,
            ),
            (
                b"HTTP/1.1 200 OK\r\na:b\r\nA:\r\na: \t \r\na::\r\n\r\n",
                r#"1.1 200 "OK" [a=b A= a= a=:] +"#,
            ),
            (
                b"HTTP/1.1 200 OK\r\nbar: \t b \t c\t \t\r\n\r\n",
                r#"1.1 200 "OK" [bar=b \t c] +"#,
            ),
            (
                b"HTTP/1.1 200 OK\r\n!#$%&'*+-.^_`|~!#$%&'*+-.^_`|~09AZaz: \x80\xff\r\n\r\n",
                r#"1.1 200 "OK" [!#$%&\'*+-.^_`|~!#$%&\'*+-.^_`|~09AZaz=\x80\xff] +"#,
            ),
            (b"HTTP/1.1 204\n\n", r#"1.1 204 "" [] +"#),
            (b"HTTP/1.1 204\n\r\n", r#"1.1 204 "" [] +"#),
            (b"HTTP/1.1 204\r\n\n", r#"1.1 204 "" [] +"#),
            (
                b"HTTP/1.1 200 OK\na: b\nc:\nd: e\r\n\nf",
                r#"1.1 200 "OK" [a=b c= d=e] +f"#,
            ),
        ] {
            assert_eq!(parse(bytes), Ok(Some(expected.into())), "{}", show(bytes));
        }
    }

    #[test]
    fn incomplete() {
        let bytes = b"HTTP/1.1  200  All good\r\nContent-Type-Options:  a, b \r\nc:\nd: e\r\n\r\n";
        for len in 0..bytes.len() {
            assert_eq!(parse(&bytes[..len]), Ok(None), "{}", show(&bytes[..len]));
        }
    }

    /// Each is reported at its last byte.
    #[test]
    fn malformed() {
        for bytes in [
            &b"h"[..],
            b" ",
            b"\r",
            b"\n",
            b"HTTP ",
            b"HTTP/2",
            b"HTTP/0",
            b"HTTP/1 ",
            b"HTTP/1. 2",
            b"HTTP/1.a ",
            b"HTTP/1.10",
            b"HTTP/1.2z",
            b"HTTP/1.1\t",
            b"HTTP/1.1\r",
            b"HTTP/1.1  OK\r\n",
            b"HTTP/1.1 \t200",
            b"HTTP/1.1 +20 ",
            b"HTTP/1.1 2a0 ",
            b"HTTP/1.1 20a ",
            b"HTTP/1.1 20 O",
            b"HTTP/1.1 099 ",
            b"HTTP/1.1 000 ",
            b"HTTP/1.1 2000",
            b"HTTP/1.1 200X",
            b"HTTP/1.1 200\t",
            b"HTTP/1.1 200\0",
            b"HTTP/1.1 200\r\r",
            b"HTTP/1.1 200 OK\rX",
            b"HTTP/1.1 200 OK\r\n\r\r",
            b"HTTP/1.1 200 OK\r\n\rX",
            b"HTTP/1.1 200 OK\r\n:",
            b"HTTP/1.1 200 OK\r\n ",
            b"HTTP/1.1 200 OK\r\n\t",
            b"HTTP/1.1 200 OK\r\n\0",
            b"HTTP/1.1 200 OK\r\na ",
            b"HTTP/1.1 200 OK\r\na\t",
            b"HTTP/1.1 200 OK\r\na\r",
            b"HTTP/1.1 200 OK\r\na\n",
            b"HTTP/1.1 200 OK\r\na: b\rc",
            b"HTTP/1.1 200 OK\r\na: b\r ",
            b"HTTP/1.1 200 OK\r\na: b\r\r",
            b"HTTP/1.1 200 OK\r\na: b\r\n ",
            b"HTTP/1.1 200 OK\r\na: b\r\n\t",
            b"HTTP/1.1 200 OK\r\na: b\n ",
            b"HTTP/1.1 100 OK\r\n\r\nX",
            b"HTTP/1.1 100 OK\r\n\r\n\r",
            b"HTTP/1.1 100 OK\n\nX",
        ] {
            let before = &bytes[..bytes.len() - 1];
            assert_eq!(parse(before), Ok(None), "{}", show(before));
            for after in [&b""[..], b"\r\n\r\n", b"a: 0123456789abcdef\r\n\r\n"] {
                let bytes = [bytes, after].concat();
                assert_eq!(parse(&bytes), Err(Error::MalformedHead), "{}", show(&bytes));
            }
        }
    }

    #[test]
    fn malformed_stays_malformed() {
        for bytes in [&b"0\r\n\r\n"[..], b"HTTP/1.1 100 A\n\nHTTP/1.1 200 A\nb\0"] {
            for reads in ways_to_read(bytes) {
                let mut parser = ResponseParser::default();
                for read in reads {
                    let _ = parser.feed(read, NO_LIMITS);
                }
                let mut len = bytes
                    .strip_prefix(b"HTTP/1.1 100 A\n\n")
                    .unwrap_or(bytes)
                    .len();
                for read in [&b""[..], b"c", b"HTTP/1.1 204\r\n\r\n"] {
                    let error = parser.feed(read, NO_LIMITS).err();
                    len += read.len();
                    assert_eq!(error, Some(Error::MalformedHead));
                    assert_eq!(parser.received_len(), len);
                }
            }
        }
    }

    #[test]
    fn every_byte_before_the_status_text() {
        let original = *b"HTTP/1.1 200 OK\r\n\r\n";
        for at in 0..b"HTTP/1.1 200 ".len() {
            for byte in 0..=u8::MAX {
                let mut bytes = original;
                bytes[at] = byte;
                let is_allowed = match at {
                    7 | 10 | 11 => byte.is_ascii_digit(),
                    9 => byte.is_ascii_digit() && byte != b'0',
                    _ => byte == original[at],
                };
                assert_eq!(parse(&bytes).is_ok(), is_allowed, "{}", show(&bytes));
            }
        }
    }

    #[test]
    fn every_byte_in_every_part() {
        let parts: [(&[u8], &[u8], fn(u8) -> bool); 3] = [
            (b"HTTP/1.1 200 a", b"a\r\n\r\n", is_content),
            (b"HTTP/1.1 200 OK\r\n", b"(: b\r\n\r\n", is_token),
            (b"HTTP/1.1 200 OK\r\na: ", b"a\r\n\r\n", is_content),
        ];
        for (before, after, is_allowed) in parts {
            for padding in paddings() {
                for byte in 0..=u8::MAX {
                    let cut = [before, &padding, &[byte]].concat();
                    let ends_part = match byte {
                        b'\r' | b'\n' => continue,
                        b':' => !padding.is_empty(),
                        _ => false,
                    };
                    let is_allowed = is_allowed(byte) || ends_part;
                    let expected = is_allowed.then_some(None).ok_or(Error::MalformedHead);
                    assert_eq!(feed(&[&cut], NO_LIMITS), expected, "{}", show(&cut));

                    let after = after.strip_prefix(b"(").unwrap_or(after);
                    let whole = [&cut, after, &padding].concat();
                    let outcome = feed(&[&whole], NO_LIMITS);
                    assert_eq!(outcome.is_ok(), is_allowed, "{}", show(&whole));
                    assert_ne!(outcome, Ok(None), "{}", show(&whole));
                }
            }
        }
    }

    #[test]
    fn lengths_around_a_vector() {
        for name in paddings().skip(1) {
            for value in paddings() {
                let bytes = [b"HTTP/1.1 200 OK\r\n", &name[..], b":", &value, b"\n\n"].concat();
                let expected = format!(r#"1.1 200 "OK" [{}={}] +"#, show(&name), show(&value));
                assert_eq!(parse(&bytes), Ok(Some(expected)));
            }
        }
    }

    #[test]
    fn max_headers() {
        let limits = |max_headers| HeadOptions {
            max_headers,
            ..NO_LIMITS
        };
        let bytes = b"HTTP/1.1 200 OK\r\na: 1\r\nb: 2\r\n\r\n";
        assert!(parse_within(bytes, limits(2)).is_ok());
        assert_eq!(parse_within(bytes, limits(1)), Err(Error::MalformedHead));
        assert_eq!(parse_within(&bytes[..23], limits(1)), Ok(None));
        assert_eq!(
            parse_within(&bytes[..24], limits(1)),
            Err(Error::MalformedHead)
        );
        assert!(parse_within(b"HTTP/1.1 200 OK\r\n\r\n", limits(0)).is_ok());
    }

    #[test]
    fn max_len() {
        let head = b"HTTP/1.1  200 OK\r\nname: value\r\n\r\n";
        let bytes = [&head[..], b"body"].concat();
        for max_len in 0..bytes.len() + 2 {
            let limits = HeadOptions {
                max_len: max_len as u32,
                ..NO_LIMITS
            };
            if max_len < head.len() {
                assert_eq!(parse_within(&bytes, limits), Err(Error::HeadTooLong));
                assert_eq!(parse_within(&bytes[..max_len], limits), Ok(None));
            } else {
                assert_eq!(parse_within(&bytes, limits), parse(&bytes));
            }
        }
    }

    #[test]
    fn many_headers() {
        let mut bytes = b"HTTP/1.1 200 OK\r\n".to_vec();
        let mut expected = Vec::new();
        for i in 0..1000 {
            bytes.extend(format!("n{i}: v{i}\r\n").bytes());
            expected.push(format!("n{i}=v{i}"));
        }
        bytes.extend(b"\r\n");
        let expected = format!(r#"1.1 200 "OK" [{}] +"#, expected.join(" "));
        for len in [1, 100, bytes.len()] {
            let reads: Vec<_> = bytes.chunks(len).collect();
            assert_eq!(feed(&reads, NO_LIMITS), Ok(Some(expected.clone())));
        }
    }

    #[test]
    fn long_parts_in_short_reads() {
        let (spaces, text) = (vec![b' '; 200_000], vec![b'a'; 200_000]);
        let bytes = [
            b"HTTP/1.1 ",
            &spaces[..],
            b"200 ",
            &spaces,
            &text,
            b"\r\n",
            &text,
            b":",
            &spaces,
            &text,
            &spaces,
            b"\r\n\r\n",
        ]
        .concat();
        let text = show(&text);
        let expected = format!(r#"1.1 200 "{text}" [{text}={text}] +"#);
        let reads: Vec<_> = bytes.chunks(1).collect();
        assert_eq!(feed(&reads, NO_LIMITS), Ok(Some(expected)));
    }

    #[test]
    fn interim_responses() {
        for code in 100..=200 {
            let bytes = format!("HTTP/1.0 {code} A\r\na: 1\r\n\r\nHTTP/1.1 201\r\nb: 2\r\n\r\n");
            let expected = match code {
                101 | 200 => format!(r#"1.0 {code} "A" [a=1] +HTTP/1.1 201\r\nb: 2\r\n\r\n"#),
                _ => r#"1.1 201 "" [b=2] +"#.to_string(),
            };
            assert_eq!(parse(bytes.as_bytes()), Ok(Some(expected)));
        }
        assert_eq!(parse(b"HTTP/1.1 100 A\r\n\r\n"), Ok(None));
    }

    #[test]
    fn limits_with_interim_responses() {
        let interim = b"HTTP/1.1 103 A\r\na: 1\r\n\r\n";
        let last = b"HTTP/1.1 200 A\r\na: 1\r\n\r\n";
        let limits = HeadOptions {
            max_len: last.len() as u32,
            max_headers: 1,
            max_interim_len: 2 * interim.len(),
            ..NO_LIMITS
        };
        let twice = [&interim[..], interim, last].concat();
        assert_eq!(parse_within(&twice, limits), parse(last));
        let thrice = [&interim[..], interim, interim].concat();
        assert_eq!(parse_within(&thrice[..thrice.len() - 1], limits), Ok(None));
        assert_eq!(parse_within(&thrice, limits), Err(Error::HeadTooLong));

        let mut parser = ResponseParser::default();
        for read in [&thrice[..], b"", last] {
            assert_eq!(parser.feed(read, limits).err(), Some(Error::HeadTooLong));
        }
    }

    #[test]
    fn one_response_after_another() {
        let one = b"HTTP/1.1 100 A\r\n\r\nHTTP/1.1 200 B\r\nb: 2\r\n\r\n";
        let limits = HeadOptions {
            max_interim_len: b"HTTP/1.1 100 A\r\n\r\n".len(),
            ..NO_LIMITS
        };
        for reads in ways_to_read(&one.repeat(3)) {
            let mut parser = ResponseParser::default();
            let mut count = 0;
            for mut read in reads {
                while let Some((response, rest)) = parser.feed(read, limits).unwrap() {
                    assert_eq!(response.headers.buf, b"HTTP/1.1 200 B\r\nb: 2\r\n\r\n");
                    assert_eq!(response.headers.entries.len(), 1);
                    count += 1;
                    read = rest;
                }
            }
            assert_eq!(count, 3);
        }
    }

    #[test]
    fn memory_cost_counts_an_incomplete_head() {
        let mut parser = ResponseParser::default();
        let bytes = b"HTTP/1.1 200 OK\r\na: b\r\n";
        assert!(matches!(parser.feed(bytes, NO_LIMITS), Ok(None)));
        assert!(parser.memory_cost() > bytes.len());
    }

    #[test]
    fn response_without_a_status_line() {
        let mut headers = bun_http_types::ETag::Headers::default();
        headers.append(b"a", b"b");
        let response = bun_http1::Response::from_fields(200, headers);
        assert_eq!((response.minor_version, response.status_code), (1, 200));
        assert_eq!(response.status_text(), b"");
        assert_eq!(response.headers.entries.len(), 1);
    }
}

mod chunked {
    use super::*;

    #[derive(Debug, PartialEq, Eq)]
    enum End {
        InBody,
        InTrailers,
        Invalid,
        /// With this many bytes left.
        Before(usize),
    }

    fn feed(reads: &[&[u8]]) -> (String, End) {
        let mut decoder = ChunkedDecoder::default();
        let mut body = b">".to_vec();
        let mut left = None;
        let mut allocating_decoder = decoder;
        for read in reads {
            let (len_before, mut new_body) = (body.len(), Vec::new());
            let decoded = decoder.decode(read, &mut body);
            assert_eq!(allocating_decoder.decode(read, &mut new_body), decoded);
            assert_eq!(new_body, body[len_before..]);
            match decoded {
                Err(error) => {
                    assert_eq!(error, Error::MalformedChunk);
                    return (show(&body[1..]), End::Invalid);
                }
                Ok(None) => assert_eq!(left, None),
                Ok(Some(rest)) => {
                    assert!(read.ends_with(rest));
                    assert!(left.is_none() || rest == *read);
                    *left.get_or_insert(0) += rest.len();
                }
            }
        }
        let end = match left {
            Some(left) => End::Before(left),
            None if decoder.has_whole_body() => End::InTrailers,
            None => End::InBody,
        };
        assert_eq!(decoder.has_whole_body(), end != End::InBody);
        (show(&body[1..]), end)
    }

    #[track_caller]
    fn check(bytes: &[u8], body: &str, end: End) {
        let expected = (body.to_string(), end);
        for reads in ways_to_read(bytes) {
            let lens: Vec<_> = reads.iter().map(|read| read.len()).collect();
            assert_eq!(feed(&reads), expected, "{} {lens:?}", show(bytes));
        }
    }

    /// For what is too long to be read in every way.
    #[track_caller]
    fn check_long(bytes: &[u8], body: &str, end: End) {
        let expected = (body.to_string(), end);
        for len in [1, 1000, bytes.len()] {
            let reads: Vec<_> = bytes.chunks(len).collect();
            assert_eq!(feed(&reads), expected);
        }
    }

    #[test]
    fn complete() {
        for (bytes, body) in [
            (&b"0\r\n\r\n"[..], ""),
            (b"0000000000000000\r\n\r\n", ""),
            (b"b\r\nhello world\r\n0\r\n\r\n", "hello world"),
            (b"B\r\nhello world\r\n0\r\n\r\n", "hello world"),
            (
                b"000000000000000b\r\nhello world\r\n0\r\n\r\n",
                "hello world",
            ),
            (b"6\r\nhello \r\n5\r\nworld\r\n0\r\n\r\n", "hello world"),
            (b"10\r\n0123456789abcdef\r\n0\r\n\r\n", "0123456789abcdef"),
            (b"7\r\n0\r\n\r\n\0\xff\r\n0\r\n\r\n", r"0\r\n\r\n\x00\xff"),
            (b"1;\r\na\r\n0;\r\n\r\n", "a"),
            (b"1;a;b=c; d = e\t;;\xff\\\r\na\r\n0\r\n\r\n", "a"),
            (b"1;a=\"\"\r\na\r\n0\r\n\r\n", "a"),
            (
                b"1;a=\"b; \\\"\\\\\";c=\"\\d\"\r\na\r\n0;e=\"f\"\r\n\r\n",
                "a",
            ),
            (b"1\r\na\r\n0\r\na: b\r\nc:\r\nd:\t\xff \r\n\r\n", "a"),
            (
                b"0\r\nServer-Timing-Header: 0123456789abcdef0123456789\r\n\r\n",
                "",
            ),
        ] {
            check(bytes, body, End::Before(0));
            check(&[bytes, b"0\r\n\r\n"].concat(), body, End::Before(5));
        }
    }

    #[test]
    fn incomplete() {
        let bytes = b"02;a=\"b\\c\"\r\nxy\r\n0;d\r\n";
        for len in 0..bytes.len() {
            let body = &"xy"[..len.saturating_sub(12).min(2)];
            check(&bytes[..len], body, End::InBody);
        }
        let trailers = b"name: value\r\nb:\r\n\r\n";
        for len in 0..trailers.len() {
            check(&[bytes, &trailers[..len]].concat(), "xy", End::InTrailers);
        }
        check(b"ffffffffffffffff\r\nabc", "abc", End::InBody);
    }

    /// Each is reported at its last byte.
    #[test]
    fn invalid() {
        for bytes in [
            &b"z"[..],
            b"g",
            b"G",
            b"/",
            b":",
            b"@",
            b"`",
            b"+",
            b"-",
            b" ",
            b";",
            b"\r",
            b"\n",
            b"\xb1",
            b"0x",
            b"1 ",
            b"1\t",
            b"1\n",
            b"1\0",
            b"1\rX",
            b"1\r\r",
            b"0\n",
            b"fffffffffffffffff",
            b"00000000000000000",
            b"1;\n",
            b"1;a\n",
            b"1;a\rX",
            b"1;a=\"\r",
            b"1;a=\"\n",
            b"1;a=\"\\\r",
            b"1;a=\"\\\"\r",
            b"1;a=\"b\"\"\r",
        ] {
            check(&bytes[..bytes.len() - 1], "", End::InBody);
            check(bytes, "", End::Invalid);
            let bytes = [b"2\r\nab\r\n", bytes, b"\na\r\n0\r\n\r\n"].concat();
            check(&bytes, "ab", End::Invalid);
        }
        for bytes in [
            &b"1\r\nab"[..],
            b"1\r\na\n",
            b"1\r\na0",
            b"1\r\na\r\r",
            b"1\r\na\r0",
        ] {
            check(&bytes[..bytes.len() - 1], "a", End::InBody);
            check(bytes, "a", End::Invalid);
        }
    }

    #[test]
    fn every_byte_in_an_extension() {
        for (before, after) in [
            (&b"1;"[..], &b""[..]),
            (b"1;a=\"", b"b\""),
            (b"1;a=\"\\", b"\""),
        ] {
            for padding in paddings() {
                for byte in 0..=u8::MAX {
                    let (before, after) = match before.split_last() {
                        Some((b'\\', open)) => ([open, &padding, b"\\"].concat(), after),
                        _ if byte == b'"' => continue,
                        _ => ([before, &padding].concat(), after),
                    };
                    let bytes = [&before, &[byte][..], after, b"a\r\nx\r\n0\r\n\r\n"].concat();
                    let expected = if is_content(byte) {
                        ("x".to_string(), End::Before(0))
                    } else {
                        (String::new(), End::Invalid)
                    };
                    assert_eq!(feed(&[&bytes]), expected, "{}", show(&bytes));
                }
            }
        }
    }

    /// Each ends with the first byte that no trailer section can have there.
    #[test]
    fn end_of_the_trailer_section() {
        for trailers in [
            &b"\n"[..],
            b"\r\r",
            b"\rX",
            b" ",
            b"\t",
            b":",
            b"\0",
            b"a ",
            b"a/",
            b"a\r",
            b"a\n",
            b"a: b\n",
            b"a: b\0",
            b"a: b\x7f",
            b"a: b\rX",
            b"a: b\r\r",
            b"a: b\r\n\n",
            b"a: b\r\n ",
        ] {
            let bytes = [b"1\r\nx\r\n0\r\n", trailers].concat();
            check(&bytes[..bytes.len() - 1], "x", End::InTrailers);
            check(&bytes, "x", End::Before(1));
            check(&[&bytes[..], b"\n"].concat(), "x", End::Before(2));
            check(&[&bytes[..], b"\r\n\r\n"].concat(), "x", End::Before(5));
        }
    }

    #[test]
    fn every_byte_in_the_trailer_section() {
        let parts: [(&[u8], fn(u8) -> bool); 5] = [
            (b"", is_token),
            (b"\r", |byte| byte == b'\n'),
            (b"a", |byte| is_token(byte) || byte == b':'),
            (b"a:", is_content),
            (b"a:\r", |byte| byte == b'\n'),
        ];
        for (before, is_allowed) in parts {
            for byte in 0..=u8::MAX {
                let left = match (before, byte) {
                    (b"" | b"a:", b'\r') => 1,
                    _ if is_allowed(byte) => 2,
                    _ => 3,
                };
                let bytes = [b"0\r\n", before, &[byte], b"\n\0"].concat();
                check(&bytes, "", End::Before(left));
            }
        }
    }

    #[test]
    fn longest_size_line() {
        for (open, close) in [("", ""), ("\"", "\""), ("\"", "\\a\"")] {
            let body = |len: usize| {
                let fill = vec![b'a'; len - "01".len() - open.len() - close.len()];
                let line = [b"01;", open.as_bytes(), &fill, close.as_bytes(), b"\r\n"].concat();
                [&line[..], b"x\r\n", &line, b"y\r\n0\r\n\r\n"].concat()
            };
            check_long(&body(16 * 1024), "xy", End::Before(0));
            check_long(&body(16 * 1024 + 1), "", End::Invalid);
        }
    }

    #[test]
    fn longest_trailer_section() {
        let value = vec![b'a'; 32 * 1024 - 1];
        let line = [b"a:", &value[..], b"\r\n"].concat();
        let full = [b"1\r\nx\r\n0\r\n", &line[..], &line].concat();
        check_long(&[&full[..], b"\r\n"].concat(), "x", End::Before(0));
        check_long(&[&full[..], b"b:\r\n\r\n"].concat(), "x", End::Before(6));
        let unended = &full[..full.len() - 2];
        check_long(&[unended, b"a\r\n\r\n"].concat(), "x", End::Before(5));
    }

    #[test]
    fn room_for_one_read() {
        for (bytes, capacity) in [
            (b"0\r\n\r\n".to_vec(), 0),
            (b"1\r\na\r\n".repeat(100), 600),
            (b"11\r\n0123456789abcdefg\r\n".repeat(100), 2300),
            (b"fff\r\n0123456789abcdefg".to_vec(), 22),
            (b"2\r\nab".to_vec(), 2),
            (b"2\r\nab\r\n".to_vec(), 2),
            (b"2\r\nab\r\n0\r\n\r\n".to_vec(), 2),
            (b"f\r\n0123456789abcde\r\n0\r\n\r\n".to_vec(), 15),
            (b"11\r\n0123456789abcdefg\r\n0\r\n\r\n".to_vec(), 17),
            (b"11\r\n0123456789abcdefg\r\n2\r\nab".to_vec(), 28),
            (b"11\r\n0123456789abcdefg\r\n0\r\n\r\na".to_vec(), 29),
        ] {
            let mut body = Vec::new();
            assert!(ChunkedDecoder::default().decode(&bytes, &mut body).is_ok());
            assert_eq!(body.capacity(), capacity);
        }
    }

    #[test]
    fn an_allocation_is_reused() {
        let mut body = Vec::with_capacity(100);
        let bytes = b"2\r\nab\r\n0\r\n\r\n";
        assert!(ChunkedDecoder::default().decode(bytes, &mut body).is_ok());
        assert_eq!((&body[..], body.capacity()), (&b"ab"[..], 100));
    }

    #[test]
    fn many_chunks() {
        let (mut bytes, mut body) = (Vec::new(), String::new());
        for len in 1..600 {
            let data = char::from(b'a' + (len % 26) as u8).to_string().repeat(len);
            bytes.extend(format!("{len:x}\r\n{data}\r\n").bytes());
            body.push_str(&data);
        }
        bytes.extend(b"0\r\n\r\n");
        check_long(&bytes, &body, End::Before(0));
    }
}
