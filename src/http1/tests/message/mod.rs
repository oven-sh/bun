use std::fmt::Write;

use bun_http1::message::{
    Eof, Event, Lenient, MessageKind, MessageParser, ParseError, is_http1_method, method_names,
};

use super::{is_content, is_token, paddings, show, ways_to_read};

const STRICT: Lenient = Lenient::empty();
const LONE_CR: Lenient = Lenient::OPTIONAL_LF_AFTER_CR;
const LONE_LF: Lenient = Lenient::OPTIONAL_CR_BEFORE_LF;
const HEADERS: Lenient = Lenient::HEADERS;
const RELAXED: Lenient = Lenient::HEADER_VALUE_RELAXED;
const ALL: Lenient = Lenient::all().difference(RELAXED);

#[derive(Clone, Copy)]
struct Setup {
    kind: MessageKind,
    lenient: Lenient,
    max_section_len: u64,
    max_fields: Option<u64>,
    after_head: fn(&mut MessageParser),
}

const REQUEST: Setup = Setup {
    kind: MessageKind::Request,
    lenient: STRICT,
    max_section_len: 16 * 1024,
    max_fields: None,
    after_head: MessageParser::clear_fields,
};
const RESPONSE: Setup = Setup {
    kind: MessageKind::Response,
    ..REQUEST
};

fn show_fields(parser: &MessageParser, read: &[u8]) -> String {
    let fields: Vec<_> = parser
        .fields(read)
        .map(|(name, value)| format!("{}={}", show(name), show(value)))
        .collect();
    format!("[{}]", fields.join(" "))
}

fn log_body(log: &mut String, body: &[u8]) {
    assert!(!body.is_empty());
    match log.pop().unwrap() {
        '}' => {}
        last => log.extend([last, ' ', '{']),
    }
    write!(log, "{}}}", show(body)).unwrap();
}

#[track_caller]
fn advance_to(parser: &mut MessageParser, read: &[u8], event: Event) {
    let is_reached = (0..8).any(|_| parser.advance(read) == event);
    assert!(is_reached, "{}", show(read));
}

/// Of the error that `log` ends in.
fn without_position(log: &str) -> Option<&str> {
    let log = log.trim_end_matches(|char: char| char.is_ascii_digit());
    log.strip_suffix(" @")
}

impl Setup {
    fn with(self, lenient: Lenient) -> Self {
        Self { lenient, ..self }
    }

    fn parser(self) -> MessageParser {
        MessageParser::new(self.kind, self.lenient, self.max_section_len)
    }

    /// `(GET / 1.1 [a=b] close upgrade {body} [trailer=c]) +rest`, then an error or what the end of the connection would do.
    fn feed(self, reads: &[&[u8]]) -> String {
        let mut parser = self.parser();
        let mut log = String::new();
        for (i, read) in reads.iter().enumerate() {
            let mut is_upgrade = false;
            let consumed = loop {
                match parser.advance(read) {
                    Event::MessageBegin => log.push('('),
                    Event::FieldLimitNeeded => {
                        assert_eq!(parser.kind(), MessageKind::Request);
                        if let Some(max_fields) = self.max_fields {
                            parser.set_max_fields(max_fields);
                        }
                    }
                    Event::FieldsFull => write!(log, "<{}> ", show_fields(&parser, read)).unwrap(),
                    Event::HeadComplete => {
                        let text = show(parser.start_line_text(read));
                        match parser.kind() {
                            MessageKind::Request => {
                                let method = method_names().nth(parser.method().into());
                                write!(log, "{} {text}", show(method.unwrap()))
                            }
                            MessageKind::Response => {
                                write!(log, "{} \"{text}\"", parser.status_code())
                            }
                        }
                        .unwrap();
                        let (major, minor) = parser.version();
                        write!(log, " {major}.{minor} {}", show_fields(&parser, read)).unwrap();
                        if !parser.should_keep_alive() {
                            log.push_str(" close");
                        }
                        if parser.is_upgrade() {
                            log.push_str(" upgrade");
                        }
                        (self.after_head)(&mut parser);
                    }
                    Event::Body(range) => log_body(&mut log, &read[range]),
                    Event::DoneInBody(start) => {
                        log_body(&mut log, &read[start..]);
                        break read.len();
                    }
                    Event::MessageComplete => {
                        if parser.fields(read).len() > 0 {
                            write!(log, " {}", show_fields(&parser, read)).unwrap();
                        }
                        log.push(')');
                        is_upgrade = parser.is_upgrade() || parser.status_code() == 101;
                    }
                    Event::Done(consumed) => break consumed,
                    Event::Failed(error, consumed) => {
                        assert_eq!(parser.error(), Some(error));
                        assert_eq!(parser.finish(), Eof::Ignored);
                        let at = reads[..i].concat().len() + consumed;
                        return format!("{log} {}: {} @{at}", error.code(), error.reason());
                    }
                }
            };
            if is_upgrade {
                assert_eq!(parser.finish(), Eof::Ignored);
                let rest = [&read[consumed..], &reads[i + 1..].concat()].concat();
                return format!("{log} +{}", show(&rest));
            }
            assert_eq!(consumed, read.len());
        }
        match parser.finish() {
            Eof::Ignored => log,
            Eof::CompletesMessage => log + " until eof",
            Eof::CutsMessageShort => log + " ..",
        }
    }

    #[track_caller]
    fn parse(self, bytes: &[u8]) -> String {
        let log = self.feed(&[bytes]);
        for reads in ways_to_read(bytes) {
            let lens: Vec<_> = reads.iter().map(|read| read.len()).collect();
            assert_eq!(self.feed(&reads), log, "{} {lens:?}", show(bytes));
        }
        log
    }

    #[track_caller]
    fn check(self, bytes: &[u8], expected: &str) {
        assert_eq!(self.parse(bytes), expected, "{}", show(bytes));
    }

    /// The error is reported between `consumed` and `rest`.
    #[track_caller]
    fn check_error(self, consumed: &[u8], rest: &[u8], error: &str) {
        let bytes = [consumed, rest].concat();
        let log = self.parse(&bytes);
        let expected = format!(" {error} @{}", consumed.len());
        assert!(log.ends_with(&expected), "{}: {log}", show(&bytes));
    }

    /// For what is too long to be read in every way, or fails where a read ends.
    #[track_caller]
    fn check_end(self, bytes: &[u8], expected: &str) {
        for len in [1, 7, 1000, bytes.len()] {
            let log = self.feed(&bytes.chunks(len).collect::<Vec<_>>());
            let log = without_position(&log).unwrap_or(&log);
            assert!(log.ends_with(expected), "{len}: {log}");
        }
    }

    /// Puts each byte between `before` and `after`, at each distance from `before`.
    #[track_caller]
    fn check_each_byte(self, before: &[u8], after: &[u8], is_allowed: impl Fn(u8) -> bool) {
        for byte in 0..=u8::MAX {
            for padding in paddings() {
                let bytes = [before, &padding, &[byte], after].concat();
                let log = self.feed(&[&bytes]);
                assert_eq!(log.ends_with(')'), is_allowed(byte), "{}", show(&bytes));
            }
        }
    }
}

mod start_line {
    use super::*;

    const WHITESPACE: &str = "HPE_INVALID_URL: Invalid characters in url";
    const START: &str = "HPE_INVALID_URL: Unexpected start char in url";
    const SCHEME: &str = "HPE_INVALID_URL: Unexpected char in url schema";
    const AUTHORITY: &str = "HPE_INVALID_URL: Unexpected char in url server";
    const PROTOCOL: &str = "HPE_INVALID_CONSTANT: Expected HTTP/, RTSP/ or ICE/";
    const METHOD: &str = "HPE_INVALID_METHOD: Invalid method encountered";
    const NO_SPACE: &str = "HPE_INVALID_METHOD: Expected space after method";
    const STATUS_CODE: &str = "HPE_INVALID_STATUS: Invalid status code";
    const STATUS: &str = "HPE_INVALID_STATUS: Invalid response status";

    #[test]
    fn methods() {
        const RTSP_ONLY: &str = "DESCRIBE ANNOUNCE SETUP PLAY PAUSE TEARDOWN GET_PARAMETER SET_PARAMETER REDIRECT RECORD FLUSH";
        let names: Vec<_> = method_names().map(show).collect();
        assert_eq!(
            names.join(" "),
            format!(
                "DELETE GET HEAD POST PUT CONNECT OPTIONS TRACE COPY LOCK MKCOL MOVE PROPFIND \
                 PROPPATCH SEARCH UNLOCK BIND REBIND UNBIND ACL REPORT MKACTIVITY CHECKOUT MERGE \
                 M-SEARCH NOTIFY SUBSCRIBE UNSUBSCRIBE PATCH PURGE MKCALENDAR LINK UNLINK SOURCE \
                 PRI {RTSP_ONLY} QUERY"
            )
        );
        for (method, name) in (0..).zip(names.iter().map(String::as_str)) {
            let is_rtsp_only = RTSP_ONLY.split_ascii_whitespace().any(|it| it == name);
            assert_eq!(is_http1_method(method), !is_rtsp_only && name != "PRI");

            let is_rtsp = is_rtsp_only || matches!(name, "GET" | "POST" | "OPTIONS");
            for (protocol, is_allowed, reason) in [
                ("HTTP", !is_rtsp_only, "Invalid method for HTTP/x.x request"),
                ("RTSP", is_rtsp, "Invalid method for RTSP/x.x request"),
                (
                    "ICE",
                    name == "SOURCE",
                    "Expected SOURCE method for ICE/x.x request",
                ),
            ] {
                let line = format!("{name} / {protocol}");
                let expected = match name {
                    _ if !is_allowed => format!("( HPE_INVALID_CONSTANT: {reason} @{}", line.len()),
                    "PRI" => "( ..".into(),
                    "CONNECT" => "(CONNECT / 1.1 [] upgrade) +".into(),
                    _ => format!("({name} / 1.1 [])"),
                };
                REQUEST.check(format!("{line}/1.1\r\n\r\n").as_bytes(), &expected);
            }

            let name = name.as_bytes();
            for len in 0..name.len() {
                let is_method = &name[..len] == b"GET";
                let error = if is_method { NO_SPACE } else { METHOD };
                REQUEST.check_error(&name[..len], &[name[len] ^ 0x20], error);
                if !is_method {
                    REQUEST.check_error(&name[..len], b" ", error);
                }
            }
            for next in (0..=u8::MAX).filter(|next| !matches!(next, b' ' | b'_')) {
                REQUEST.check_error(name, &[next], NO_SPACE);
            }
        }
    }

    #[test]
    fn request_lines() {
        for (lenient, bytes, expected) in [
            (STRICT, &b""[..], ""),
            (STRICT, b"\r\n\n\r", ""),
            (STRICT, b"\r\n\n\rGET / HTTP/1.1\r\n\r\n", "(GET / 1.1 [])"),
            (STRICT, b"GET   /   HTTP/1.1\r\n\r\n", "(GET / 1.1 [])"),
            (STRICT, b"GET / HTTP/1.0\r\n\r\n", "(GET / 1.0 [] close)"),
            (STRICT, b"GET / HTTP/0.9\r\n\r\n", "(GET / 0.9 [] close)"),
            (STRICT, b"GET / HTTP/2.0\r\n\r\n", "(GET / 2.0 [] close)"),
            (STRICT, b"GET /\r\n\r\n", "(GET / 0.9 [] close)"),
            (
                STRICT,
                b"GET /?#\r\na: b\r\n\r\n",
                "(GET /?# 0.9 [a=b] close)",
            ),
            (STRICT, b"GET a://b\r\n\r\n", "(GET a://b 0.9 [] close)"),
            (
                STRICT,
                b"CONNECT \r\n\r\n",
                "(CONNECT  0.9 [] close upgrade) +",
            ),
            (STRICT, b"OPTIONS * HTTP/1.1\r\n\r\n", "(OPTIONS * 1.1 [])"),
            (STRICT, b"GET *{ HTTP/1.1\r\n\r\n", "(GET *{ 1.1 [])"),
            (
                STRICT,
                b"CONNECT @ HTTP/1.1\r\n\r\n",
                "(CONNECT @ 1.1 [] upgrade) +",
            ),
            (
                STRICT,
                b"GET /a?b?c#d?e#f HTTP/1.1\r\n\r\n",
                "(GET /a?b?c#d?e#f 1.1 [])",
            ),
            (
                STRICT,
                b"GET hTtp:// HTTP/1.1\r\n\r\n",
                "(GET hTtp:// 1.1 [])",
            ),
            (
                STRICT,
                b"GET a://b?c HTTP/1.1\r\n\r\n",
                "(GET a://b?c 1.1 [])",
            ),
            (
                STRICT,
                b"GET a://b@ HTTP/1.1\r\n\r\n",
                "(GET a://b@ 1.1 [])",
            ),
            (
                STRICT,
                b"GET a://b@/@@ HTTP/1.1\r\n\r\n",
                "(GET a://b@/@@ 1.1 [])",
            ),
            (
                STRICT,
                b"GET a://b:c@d@[::1]:80/e HTTP/1.1\r\n\r\n",
                "(GET a://b:c@d@[::1]:80/e 1.1 [])",
            ),
            (
                STRICT,
                b"CONNECT a_0.b:443 HTTP/1.1\r\n\r\nc",
                "(CONNECT a_0.b:443 1.1 [] upgrade) +c",
            ),
            (
                Lenient::VERSION,
                b"GET / HTTP/5.6\r\n\r\n",
                "(GET / 5.6 [])",
            ),
            (
                Lenient::VERSION,
                b"GET / HTTP/9.0\r\n\r\n",
                "(GET / 9.0 [] close)",
            ),
            (
                LONE_CR,
                b"GET / HTTP/1.1\ra: b\r\n\r\n",
                "(GET / 1.1 [a=b])",
            ),
            (
                LONE_LF,
                b"GET / HTTP/1.1\n\na: b\r\n\r\n",
                "(GET / 1.1 [a=b])",
            ),
            (LONE_LF, b"GET /\na: b\r\n\r\n", "(GET / 0.9 [a=b] close)"),
            (ALL, b"GET / HTTP/1.1\na: b\n\n", "(GET / 1.1 [a=b])"),
            (ALL, b"GET / HTTP/1.1\n\r\n", "(GET / 1.1 [])"),
        ] {
            REQUEST.with(lenient).check(bytes, expected);
        }
    }

    #[test]
    fn malformed_request_lines() {
        for (consumed, rest, error) in [
            (&b"GET \t"[..], &b""[..], WHITESPACE),
            (b"GET \x0c", b"", WHITESPACE),
            (b"GET \r", b"", WHITESPACE),
            (b"GET \n", b"", WHITESPACE),
            (b"GET a ", b"", WHITESPACE),
            (b"GET a\r", b"", WHITESPACE),
            (b"GET a: ", b"", WHITESPACE),
            (b"GET a:\n", b"", WHITESPACE),
            (b"GET a://\t", b"", WHITESPACE),
            (b"GET a://@\x0c", b"", WHITESPACE),
            (b"GET /\t", b"", WHITESPACE),
            (b"GET /?\x0c", b"", WHITESPACE),
            (b"GET /#\t", b"", WHITESPACE),
            (b"GET / \t", b"", WHITESPACE),
            (b"GET / \x0c", b"", WHITESPACE),
            (b"GET /\r\n\t", b"", WHITESPACE),
            (b"GET /\r\n\x0c", b"", WHITESPACE),
            (b"CONNECT \t", b"", WHITESPACE),
            (b"GET ", b"?", START),
            (b"GET ", b"1", START),
            (b"GET ", b"@", START),
            (b"GET ", b"[", START),
            (b"GET ", b"`", START),
            (b"GET ", b"{", START),
            (b"GET a", b"1", SCHEME),
            (b"GET a", b"/", SCHEME),
            (b"GET a:", b"b", SCHEME),
            (b"GET a:/", b"b", SCHEME),
            (b"GET a:/", b" ", SCHEME),
            (b"GET a://b", b"#", AUTHORITY),
            (b"GET a://b@", b"\\", AUTHORITY),
            (b"CONNECT ", b"\"", AUTHORITY),
            (b"GET a://b@@", b"", "HPE_INVALID_URL: Double @ in url"),
            (
                b"GET /a",
                b"\x7f",
                "HPE_INVALID_URL: Invalid char in url path",
            ),
            (
                b"GET a://b/",
                b"\x80",
                "HPE_INVALID_URL: Invalid char in url path",
            ),
            (
                b"GET /0123456789abcdef?",
                b"\0",
                "HPE_INVALID_URL: Invalid char in url query",
            ),
            (
                b"GET a://b?",
                b"\xff",
                "HPE_INVALID_URL: Invalid char in url query",
            ),
            (
                b"GET /#",
                b"\x0b",
                "HPE_INVALID_URL: Invalid char in url fragment start",
            ),
            (
                b"GET /?#?",
                b"\x1f",
                "HPE_INVALID_URL: Invalid char in url fragment start",
            ),
            (b"GET /\r", b"a", "HPE_INVALID_URL: Expected CRLF"),
            (b"GET /\r", b"\r", "HPE_INVALID_URL: Expected CRLF"),
            (b"GET /\n", b"a", "HPE_INVALID_URL: Expected CRLF"),
            (b"GET a://b\n", b"", "HPE_INVALID_URL: Expected CRLF"),
            (b"GET /  ", b"\t", PROTOCOL),
            (b"GET / ", b"\r", PROTOCOL),
            (b"GET /a ", b"b HTTP/1.1", PROTOCOL),
            (
                b"GET / HTTP/1.1",
                b" ",
                "HPE_INVALID_VERSION: Expected CRLF after version",
            ),
            (
                b"GET / HTTP/1.1",
                b"1",
                "HPE_INVALID_VERSION: Expected CRLF after version",
            ),
            (
                b"GET / HTTP/1.1\n",
                b"",
                "HPE_INVALID_VERSION: Expected CRLF after version",
            ),
            (
                b"GET / HTTP/1.1\r",
                b"a",
                "HPE_STRICT: Expected CRLF after version",
            ),
            (
                b"GET / HTTP/1.1\r",
                b"\r",
                "HPE_STRICT: Expected CRLF after version",
            ),
        ] {
            REQUEST.check_error(consumed, rest, error);
        }
    }

    #[test]
    fn http2_preface() {
        let (line, preface) = (b"PRI * HTTP/2.0", b"\r\n\r\nSM\r\n\r\n");
        REQUEST.check_error(
            &[&line[..], preface].concat(),
            b"\0\0",
            "HPE_PAUSED_H2_UPGRADE: Pause on PRI/Upgrade",
        );
        for len in 0..preface.len() {
            REQUEST.check_error(
                &[line, &preface[..len]].concat(),
                b"s",
                "HPE_INVALID_VERSION: Expected HTTP/2 Connection Preface",
            );
        }
    }

    #[test]
    fn url_bytes() {
        let after = b"z HTTP/1.1\r\n\r\n";
        for before in [&b"GET /"[..], b"GET /?", b"GET /#", b"GET a://b/"] {
            REQUEST.check_each_byte(before, after, |byte| byte.is_ascii_graphic());
        }
        REQUEST.check_each_byte(b"GET a://", after, |byte| {
            byte.is_ascii_graphic() && b"\"#<>\\^`{|}".iter().all(|&other| other != byte)
        });
        REQUEST.check_each_byte(b"GET a", b"z:// HTTP/1.1\r\n\r\n", |byte| {
            byte.is_ascii_alphabetic()
        });
        for byte in 0..=u8::MAX {
            let log = REQUEST.parse(&[&b"GET "[..], &[byte], b"z://"].concat());
            let is_allowed = byte.is_ascii_alphabetic() || matches!(byte, b' ' | b'*' | b'/');
            assert_eq!(log == "( ..", is_allowed, "{byte}");
        }
    }

    #[test]
    fn versions() {
        for (setup, before) in [(REQUEST, &b"GET / "[..]), (RESPONSE, b"")] {
            for (consumed, rest, error) in [
                (&b""[..], &b"http/"[..], PROTOCOL),
                (b"H", b"t", PROTOCOL),
                (b"HT", b"P", PROTOCOL),
                (b"HTT", b"/", PROTOCOL),
                (b"HTTP", b"S", PROTOCOL),
                (b"I", b"HTTP", PROTOCOL),
                (b"RT", b"P", PROTOCOL),
                (b"RTSP", b" ", PROTOCOL),
                (b"HTTP/", b"a", "HPE_INVALID_VERSION: Invalid major version"),
                (b"HTTP/", b":", "HPE_INVALID_VERSION: Invalid major version"),
                (b"HTTP/0", b"1.1", "HPE_INVALID_VERSION: Expected dot"),
                (b"HTTP/1", b" ", "HPE_INVALID_VERSION: Expected dot"),
                (
                    b"HTTP/1.",
                    b"/",
                    "HPE_INVALID_VERSION: Invalid minor version",
                ),
            ] {
                setup.check_error(&[before, consumed].concat(), rest, error);
            }
            for version in 0..100 {
                let line = format!("{}HTTP/{}.{}", show(before), version / 10, version % 10);
                let expected = match version {
                    9 | 10 | 11 | 20 => "( ..".into(),
                    _ => format!(
                        "( HPE_INVALID_VERSION: Invalid HTTP version @{}",
                        line.len()
                    ),
                };
                setup.check(line.as_bytes(), &expected);
                setup.with(Lenient::VERSION).check(line.as_bytes(), "( ..");
            }
        }
    }

    #[test]
    fn status_lines() {
        for (lenient, bytes, expected) in [
            (
                STRICT,
                &b"HTTP/1.1 204 OK\r\n\r\n"[..],
                r#"(204 "OK" 1.1 [])"#,
            ),
            (
                STRICT,
                b"\r\n\nHTTP/1.1 204 OK\r\n\r\n",
                r#"(204 "OK" 1.1 [])"#,
            ),
            (STRICT, b"RTSP/1.1 204 OK\r\n\r\n", r#"(204 "OK" 1.1 [])"#),
            (
                STRICT,
                b"ICE/1.0 204 OK\r\n\r\n",
                r#"(204 "OK" 1.0 [] close)"#,
            ),
            (STRICT, b"HTTP/1.1 204\r\n\r\n", r#"(204 "" 1.1 [])"#),
            (STRICT, b"HTTP/1.1 204 \r\n\r\n", r#"(204 "" 1.1 [])"#),
            (
                STRICT,
                b"HTTP/1.1 204  O\xe9 \r\n\r\n",
                r#"(204 " O\xe9 " 1.1 [])"#,
            ),
            (
                HEADERS,
                b"HTTP/1.1 000 \r\n\r\n",
                r#"(0 "" 1.1 [] close until eof"#,
            ),
            (
                HEADERS,
                b"HTTP/1.1 099 \r\n\r\n",
                r#"(99 "" 1.1 [] close until eof"#,
            ),
            (
                STRICT,
                b"HTTP/1.1 999 \r\n\r\n",
                r#"(999 "" 1.1 [] close until eof"#,
            ),
            (
                LONE_CR,
                b"HTTP/1.1 204\ra: b\r\n\r\n",
                r#"(204 "" 1.1 [a=b])"#,
            ),
            (LONE_CR, b"HTTP/1.1 204 OK\r\r\n", r#"(204 "OK" 1.1 [])"#),
            (LONE_LF, b"HTTP/1.1 204\n\n", r#"(204 "" 1.1 [])"#),
            (LONE_LF, b"HTTP/1.1 204 OK\n\n", r#"(204 "OK" 1.1 [])"#),
        ] {
            RESPONSE.with(lenient).check(bytes, expected);
        }
    }

    #[test]
    fn status_text_bytes() {
        for (lenient, is_kept) in [
            (STRICT, is_content as fn(_) -> _),
            (RELAXED, is_content),
            (HEADERS, |_| true),
        ] {
            for byte in (0..=u8::MAX).filter(|byte| !matches!(byte, b'\r' | b'\n')) {
                for padding in paddings() {
                    let text = [&padding[..], &[byte], b"z"].concat();
                    let bytes = [b"HTTP/1.1 204 ", &text[..], b"\r\n\r\n"].concat();
                    let kept = if is_kept(byte) { &text[..] } else { b"" };
                    let expected = format!("(204 \"{}\" 1.1 [])", show(kept));
                    assert_eq!(RESPONSE.with(lenient).feed(&[&bytes]), expected);
                }
            }
        }
        RESPONSE.check(
            b"HTTP/1.1 204 a\x1b\x1bb\r\nc: d\r\n\r\nHTTP/1.1 204 e\r\n\r\n",
            r#"(204 "" 1.1 [c=d])(204 "e" 1.1 [])"#,
        );
    }

    #[test]
    fn malformed_status_lines() {
        for (consumed, rest, error) in [
            (&b""[..], &b" HTTP"[..], PROTOCOL),
            (b"", b"\tHTTP", PROTOCOL),
            (
                b"HTTP/1.1",
                b"\t",
                "HPE_INVALID_VERSION: Expected space after version",
            ),
            (
                b"HTTP/1.0",
                b"1",
                "HPE_INVALID_VERSION: Expected space after version",
            ),
            (b"HTTP/1.1 ", b" 200", STATUS_CODE),
            (b"HTTP/1.1 ", b"+20", STATUS_CODE),
            (b"HTTP/1.1 ", b"099", STATUS_CODE),
            (b"HTTP/1.1 2", b" ", STATUS_CODE),
            (b"HTTP/1.1 20", b"a", STATUS_CODE),
            (b"HTTP/1.1 200", b"0", STATUS),
            (b"HTTP/1.1 200", b"\t", STATUS),
            (b"HTTP/1.1 200\n", b"", STATUS),
            (b"HTTP/1.1 200\r", b"a", "HPE_STRICT: Expected LF after CR"),
            (
                b"HTTP/1.1 200 OK\r",
                b"\r",
                "HPE_STRICT: Expected LF after CR",
            ),
            (
                b"HTTP/1.1 200 OK\n",
                b"",
                "HPE_CR_EXPECTED: Missing expected CR after response line",
            ),
        ] {
            RESPONSE.check_error(consumed, rest, error);
        }
    }
}

mod fields {
    use super::*;

    const LINE: &[u8] = b"PUT / HTTP/1.1\r\n";
    const NAME: &str = "HPE_INVALID_HEADER_TOKEN: Invalid header token";
    const NAME_SPACE: &str = "HPE_INVALID_HEADER_TOKEN: Invalid header field char";
    const VALUE: &str = "HPE_INVALID_HEADER_TOKEN: Invalid header value char";
    const FOLD: &str = "HPE_INVALID_HEADER_TOKEN: Unexpected whitespace after header value";
    const NO_CR: &str = "HPE_CR_EXPECTED: Missing expected CR after header value";
    const NO_LF: &str = "HPE_LF_EXPECTED: Missing expected LF after header value";
    const LENGTH: &str = "HPE_INVALID_CONTENT_LENGTH: Invalid character in Content-Length";
    const DUPLICATE: &str = "HPE_UNEXPECTED_CONTENT_LENGTH: Duplicate Content-Length";
    const AFTER_CHUNKED: &str =
        "HPE_INVALID_TRANSFER_ENCODING: Invalid `Transfer-Encoding` header value";
    const NOT_CHUNKED: &str =
        "HPE_INVALID_TRANSFER_ENCODING: Request has invalid `Transfer-Encoding`";
    const EMPTY_LENGTH: &str = "HPE_INVALID_CONTENT_LENGTH: Empty Content-Length";
    const EMPTY_CODINGS: &str = "HPE_INVALID_TRANSFER_ENCODING: Empty Transfer-Encoding";

    #[test]
    fn complete() {
        for (lenient, fields, expected) in [
            (
                STRICT,
                &b"a:b\r\nA:\r\na: \t \r\na::\r\n\r\n"[..],
                "a=b A= a= a=:",
            ),
            (STRICT, b"a: \t b \t c\t \t\r\n\r\n", r"a=b \t c"),
            (
                STRICT,
                b"!#$%&'*+-.^_`|~09AZaz: \x80\xff\r\n\r\n",
                r"!#$%&\'*+-.^_`|~09AZaz=\x80\xff",
            ),
            (
                STRICT,
                b"Content-Length-: a\r\nontent-Length: a\r\n\r\n",
                "Content-Length-=a ontent-Length=a",
            ),
            (
                STRICT,
                b"Content_Length: a\r\nContent-Lengti: a\r\n\r\n",
                "Content_Length=a Content-Lengti=a",
            ),
            (
                STRICT,
                b"Transfer_Encoding: a\r\nConnectio: close\r\n\r\n",
                "Transfer_Encoding=a Connectio=close",
            ),
            (
                STRICT,
                b"Connection:\r\nUpgrade:\r\n\r\n",
                "Connection= Upgrade=",
            ),
            (STRICT, b"Connectiom: close\r\n\r\n", "Connectiom=close"),
            (HEADERS, b"Upgrade: a\r\n close\r\n\r\n", "Upgrade=a close"),
            (RELAXED, b"a: \x01b\x7f\x7f\r\n\r\n", r"a=\x01b\x7f\x7f"),
            (HEADERS, b" a: b\r\n\r\n", "a=b"),
            (HEADERS, b"a: \0b\x7f\r\n\r\n", r"a=\x00b\x7f"),
            (HEADERS, b"a:\rb: c\r\n\r\n", "a= b=c"),
            (
                HEADERS,
                b"a: b\r\n\tc\r\n  d \r\ne: f\r\n\r\n",
                r"a=b\tc  d e=f",
            ),
            (HEADERS, b"a:\r\n b\r\nc: \r\n \r\n\t\r\n\r\n", "a=b c="),
            (STRICT, b"Upgrade: a,close\r\n\r\n", "Upgrade=a,close"),
            (HEADERS, b"Upgrade  : a\r\n\r\n", "Upgrade  =a"),
            (
                HEADERS,
                b"Content-Length  a: b\r\n\r\n",
                "Content-Length  a=b",
            ),
            (
                HEADERS,
                b"Content-Length :0\r\nUpgrade :\r\n\r\n",
                "Content-Length =0 Upgrade =",
            ),
            (
                HEADERS,
                b"Connection: upgrade\r\n a\r\n\r\n",
                "Connection=upgrade a",
            ),
            (LONE_LF, b"a: b\nc:\nd: \n\n", "a=b c= d="),
            (
                LONE_LF,
                b"Content-Length: 0\nConnection: keep-alive\n\n",
                "Content-Length=0 Connection=keep-alive",
            ),
            (ALL, b"a: \0\n b\n\n", r"a=\x00 b"),
        ] {
            let expected = format!("(PUT / 1.1 [{expected}])");
            REQUEST
                .with(lenient)
                .check(&[LINE, fields].concat(), &expected);
        }
        REQUEST
            .with(LONE_CR)
            .check(b"PUT / HTTP/1.1\r\n\rG", "(PUT / 1.1 [])( ..");
    }

    #[test]
    fn malformed() {
        for (lenient, consumed, rest, error) in [
            (
                STRICT,
                &b" "[..],
                &b"a"[..],
                "HPE_UNEXPECTED_SPACE: Unexpected space after start line",
            ),
            (
                RELAXED,
                b" ",
                b"a",
                "HPE_UNEXPECTED_SPACE: Unexpected space after start line",
            ),
            (STRICT, b"", b":", NAME),
            (STRICT, b"", b"\t", NAME),
            (STRICT, b"a", b" :", NAME),
            (STRICT, b"a", b"\t:", NAME),
            (STRICT, b"a", b"\r\n", NAME),
            (STRICT, b"Content", b"\rLength", NAME),
            (STRICT, b"Connection", b"\t:", NAME),
            (ALL, b" ", b" a", NAME),
            (ALL, b"a", b" :", NAME),
            (ALL, b"Upgrade ", b"\t:", NAME),
            (ALL, b"Upgrade  a", b" :", NAME),
            (STRICT, b"\n", b"", NAME_SPACE),
            (STRICT, b"a: b\r\n\n", b"", NAME_SPACE),
            (STRICT, b"Connection ", b":", NAME_SPACE),
            (STRICT, b"Proxy-Connection ", b":", NAME_SPACE),
            (STRICT, b"Content-Length ", b":", NAME_SPACE),
            (STRICT, b"Transfer-Encoding ", b":", NAME_SPACE),
            (RELAXED, b"Upgrade ", b":", NAME_SPACE),
            (STRICT, b"a:\n", b"", VALUE),
            (STRICT, b"a: \t\n", b"", VALUE),
            (STRICT, b"a:\r\n ", b"b", VALUE),
            (STRICT, b"a:\r\n\t", b"b", VALUE),
            (STRICT, b"a: ", b"\x0c", VALUE),
            (STRICT, b"a: b", b"\0", VALUE),
            (STRICT, b"Connection: ", b"\x7f", VALUE),
            (STRICT, b"Connection: clos", b"\x01", VALUE),
            (STRICT, b"Connection: close", b"\x0b", VALUE),
            (STRICT, b"Transfer-Encoding: chunked", b"\x0b", VALUE),
            (STRICT, b"Upgrade: ", b"\0", VALUE),
            (RELAXED, b"a:\n", b"", VALUE),
            (RELAXED, b"a: ", b"\0", VALUE),
            (RELAXED, b"a: \x01", b"\0", VALUE),
            (RELAXED, b"Connection: \x01", b"\0", VALUE),
            (STRICT, b"a: b\r\n", b" c", FOLD),
            (RELAXED, b"a: b\r\n", b"\tc", FOLD),
            (STRICT, b"a:\r", b"b", "HPE_STRICT: Expected LF after CR"),
            (LONE_CR, b"a:\r", b"b", "HPE_STRICT: Expected LF after CR"),
            (STRICT, b"a: b", b"\n", NO_CR),
            (RELAXED, b"a: \x01", b"\n", NO_CR),
            (HEADERS, b"a: b", b"\n", NO_CR),
            (HEADERS, b"a: \x01", b"\n", NO_CR),
            (STRICT, b"Content-Length: 1", b"\n", NO_CR),
            (STRICT, b"Connection: close", b"\n", NO_CR),
            (STRICT, b"Transfer-Encoding: chunked", b"\n", NO_CR),
            (STRICT, b"a: b\r", b"c", NO_LF),
            (STRICT, b"Connection: keep\r", b"alive\r\n", NO_LF),
            (RELAXED, b"a: \x0c\r", b"c", NO_LF),
            (ALL, b"a: b\r", b"\r", NO_LF),
            (STRICT, b"\r", b"a", "HPE_STRICT: Expected LF after headers"),
            (
                STRICT,
                b"a: b\r\n\r",
                b"\r",
                "HPE_STRICT: Expected LF after headers",
            ),
            (STRICT, b"Content-Length:\r\n", b"\r", EMPTY_LENGTH),
            (STRICT, b"Content-Length: \t\r\n", b"a", EMPTY_LENGTH),
            (ALL, b"Content-Length:\r\n \r\n", b"a", EMPTY_LENGTH),
            (STRICT, b"Content-Length: ", b"+1", LENGTH),
            (STRICT, b"Content-Length: ", b"-1", LENGTH),
            (STRICT, b"Content-Length: 0", b"x1", LENGTH),
            (STRICT, b"Content-Length: 1", b",1", LENGTH),
            (STRICT, b"Content-Length: 1 ", b"2", LENGTH),
            (STRICT, b"Content-Length: 1\t", b"2", LENGTH),
            (ALL, b"Content-Length: 1", b"\x0b", LENGTH),
            (
                STRICT,
                b"Content-Length: 18446744073709551616",
                b"",
                "HPE_INVALID_CONTENT_LENGTH: Content-Length overflow",
            ),
            (
                STRICT,
                b"Content-Length: 100000000000000000000",
                b"0",
                "HPE_INVALID_CONTENT_LENGTH: Content-Length overflow",
            ),
            (
                STRICT,
                b"Content-Length: 1\r\nContent-Length: ",
                b"1",
                DUPLICATE,
            ),
            (
                ALL,
                b"Content-Length: 0\r\ncontent-length:",
                b"0",
                DUPLICATE,
            ),
            (ALL, b"Content-Length: 1\r\n", b" 2", DUPLICATE),
            (
                STRICT,
                b"Transfer-Encoding: chunked\r\nContent-Length:",
                b" 1",
                "HPE_INVALID_CONTENT_LENGTH: Content-Length can't be present with Transfer-Encoding",
            ),
            (
                STRICT,
                b"Content-Length: 0\r\nTransfer-Encoding:",
                b"\r",
                "HPE_INVALID_TRANSFER_ENCODING: Transfer-Encoding can't be present with Content-Length",
            ),
            (
                HEADERS,
                b"Content-Length: 0\r\nTransfer-Encoding :",
                b"\r",
                "HPE_INVALID_TRANSFER_ENCODING: Transfer-Encoding can't be present with Content-Length",
            ),
            (
                STRICT,
                b"Transfer-Encoding: a\r\nContent-Length:",
                b" 1",
                "HPE_INVALID_CONTENT_LENGTH: Content-Length can't be present with Transfer-Encoding",
            ),
            (STRICT, b"Transfer-Encoding:\r\n", b"\r", EMPTY_CODINGS),
            (ALL, b"Transfer-Encoding: \t\n", b"a", EMPTY_CODINGS),
            (STRICT, b"Transfer-Encoding: chunked,", b" a", AFTER_CHUNKED),
            (STRICT, b"Transfer-Encoding: chunked ,", b"", AFTER_CHUNKED),
            (
                STRICT,
                b"Transfer-Encoding: a, chunked\t,",
                b"",
                AFTER_CHUNKED,
            ),
            (
                STRICT,
                b"Transfer-Encoding: chunked\r\nTransfer-Encoding: c",
                b"hunked",
                AFTER_CHUNKED,
            ),
        ] {
            REQUEST
                .with(lenient)
                .check_error(&[LINE, consumed].concat(), rest, error);
        }
    }

    #[test]
    fn bytes() {
        let name = b"PUT / HTTP/1.1\r\nz";
        REQUEST.check_each_byte(name, b"z: b\r\n\r\n", |byte| is_token(byte) || byte == b':');
        for name in ["a", "Connection", "Upgrade"] {
            let before = format!("PUT / HTTP/1.1\r\n{name}: z").into_bytes();
            for (lenient, is_allowed) in [
                (STRICT, is_content as fn(_) -> _),
                (RELAXED, |byte| !matches!(byte, 0 | b'\r' | b'\n')),
                (HEADERS, |byte| !matches!(byte, b'\r' | b'\n')),
            ] {
                let setup = REQUEST.with(lenient);
                setup.check_each_byte(&before, b"z\r\n\r\n", is_allowed);
            }
        }
    }

    #[test]
    fn list_bytes() {
        for byte in (0..=u8::MAX).filter(|byte| !matches!(byte, b'\r' | b'\n')) {
            for padding in paddings() {
                let before = b"Upgrade: a\r\nConnection: z";
                let bytes = [LINE, before, &padding, &[byte], b"z,upgrade\r\n\r\n"].concat();
                let log = REQUEST.with(HEADERS).feed(&[&bytes]);
                let expected = match is_content(byte) {
                    true => "] upgrade) +",
                    false => "])",
                };
                assert!(log.ends_with(expected), "{log}");
            }
        }
    }

    #[test]
    fn connection_options() {
        for (lenient, value, keeps_alive, closes, upgrades) in [
            (STRICT, &b"keep-alive"[..], true, false, false),
            (STRICT, b"CLOSE", false, true, false),
            (STRICT, b"Upgrade \t", false, false, true),
            (STRICT, b"Keep-Alive,upgrade", true, false, true),
            (STRICT, b"keep-alive\t, close", true, true, false),
            (STRICT, b", ,a,\t upgrade,,close,", false, true, true),
            (STRICT, b"closed, keep-aliv, upgrad", false, false, false),
            (STRICT, b"close a, a close, upgrade", false, false, true),
            (STRICT, b"keep,alive, clos, upgrade", false, false, true),
            (
                STRICT,
                b"cclose, keep_alive, \"close\"",
                false,
                false,
                false,
            ),
            (RELAXED, b"close\x01", false, false, false),
            (RELAXED, b"a\x01, upgrade", false, false, false),
            (RELAXED, b"upgrade, \x01", false, false, true),
            (HEADERS, b"\r\n close", false, true, false),
            (HEADERS, b"a,\r\n upgrade, ,keep-alive", true, false, true),
            (HEADERS, b"keep-alive, \r\n\tupgrade", true, false, true),
            (HEADERS, b"close\r\n , upgrade", false, true, false),
            (HEADERS, b"close a,\r\n upgrade", false, false, false),
            (HEADERS, b"clos a,\r\n upgrade", false, false, true),
            (LONE_LF, b"close\na: b", false, true, false),
            (LONE_LF, b"a\nb: c", false, false, false),
        ] {
            for name in ["Connection", "proxy-connection"] {
                for (version, is_persistent) in [
                    ("0.9", keeps_alive),
                    ("1.0", keeps_alive),
                    ("1.1", true),
                    ("2.0", keeps_alive),
                ] {
                    let before = format!("GET / HTTP/{version}\r\nUpgrade: a\r\n{name}: ");
                    let bytes = [before.as_bytes(), value, b"\r\n\r\n"].concat();
                    let log = REQUEST.with(lenient).parse(&bytes);
                    let close = if closes || !is_persistent {
                        " close"
                    } else {
                        ""
                    };
                    let upgrade = if upgrades { " upgrade) +" } else { ")" };
                    assert!(log.ends_with(&format!("]{close}{upgrade}")), "{log}");
                }
            }
        }
    }

    #[test]
    fn transfer_codings() {
        for (lenient, value, is_chunked) in [
            (STRICT, &b"chunked"[..], true),
            (STRICT, b"CHUNKED \t ", true),
            (STRICT, b"a,chunked", true),
            (STRICT, b"a, \tchunked", true),
            (STRICT, b",,chunked", true),
            (STRICT, b"chunked a, chunked", true),
            (STRICT, b"chunke, chunked", true),
            (STRICT, b"a\r\nTransfer-Encoding: chunked", true),
            (STRICT, b"a", false),
            (STRICT, b",", false),
            (STRICT, b"chunke", false),
            (STRICT, b"chunkedchunked", false),
            (STRICT, b"chunked;a", false),
            (STRICT, b"a chunked", false),
            (STRICT, b"\"chunked\"", false),
            (STRICT, b"close", false),
            (RELAXED, b"\x0bchunked", false),
            (RELAXED, b"chunked\x0b", false),
            (RELAXED, b"\x01, chunked", false),
            (LONE_LF, b"chunked\na: b", true),
            (HEADERS, b"\r\n chunked", true),
            (HEADERS, b"chunked\r\n a", false),
            (HEADERS, b"a,\r\n chunked", false),
        ] {
            let fields = [b"Transfer-Encoding: ", value, b"\r\n\r\n"].concat();
            let request = [LINE, &fields].concat();
            let with_body = |head: &[u8]| [head, b"1\r\na\r\n0\r\n\r\n"].concat();
            let until_eof = r"] close {1\r\na\r\n0\r\n\r\n} until eof";
            let refused = format!("] close {NOT_CHUNKED} @{}", request.len());
            for (setup, head, otherwise) in [
                (REQUEST.with(lenient), &request, &*refused),
                (
                    REQUEST.with(lenient | Lenient::TRANSFER_ENCODING),
                    &request,
                    until_eof,
                ),
                (
                    REQUEST.with(lenient | Lenient::CHUNKED_LENGTH),
                    &request,
                    until_eof,
                ),
                (
                    RESPONSE.with(lenient),
                    &[b"HTTP/1.1 200 \r\n", &fields[..]].concat(),
                    until_eof,
                ),
            ] {
                let log = setup.parse(&with_body(head));
                let expected = if is_chunked { "] {a})" } else { otherwise };
                assert!(log.ends_with(expected), "{log}");
            }
        }
    }

    #[test]
    fn folded_codings() {
        for value in ["a", "chunked", "chunked,"] {
            let bytes = format!("HTTP/1.1 304 \r\nTransfer-Encoding: {value}\r\n close\r\n\r\n");
            let expected = format!("(304 \"\" 1.1 [Transfer-Encoding={value} close])");
            RESPONSE.with(HEADERS).check(bytes.as_bytes(), &expected);
        }
    }

    #[test]
    fn codings_after_chunked() {
        for (setup, line) in [
            (REQUEST.with(Lenient::TRANSFER_ENCODING), LINE),
            (RESPONSE, b"HTTP/1.1 200 \r\n"),
        ] {
            for (value, expected) in [
                ("chunked, a", "close {0} until eof"),
                ("chunked,", "close {0} until eof"),
                ("chunked\r\nTransfer-Encoding: a", "close {0} until eof"),
                ("chunked, chunked", "] .."),
                ("chunked\r\nTransfer-Encoding: chunked", "] .."),
            ] {
                let rest = format!("Transfer-Encoding: {value}\r\n\r\n0");
                let log = setup.parse(&[line, rest.as_bytes()].concat());
                assert!(log.ends_with(expected), "{log}");
            }
        }
    }
}

mod bodies {
    use super::*;

    const AFTER_CLOSE: &str = "HPE_CLOSED_CONNECTION: Data after `Connection: close`";
    const UPGRADE: &[u8] = b"GET / HTTP/1.1\r\nConnection: upgrade\r\nUpgrade: a\r\n\r\n";

    #[test]
    fn requests() {
        for (lenient, bytes, expected) in [
            (
                STRICT,
                &b"PUT / HTTP/1.1\r\nconTENT-length: \t003 \t\r\n\r\nabc\r\nG"[..],
                "(PUT / 1.1 [conTENT-length=003] {abc})( ..",
            ),
            (
                STRICT,
                b"PUT / HTTP/1.1\r\nContent-Length: 0\r\n\r\nPUT /a HTTP/1.1\r\nContent-Length: 1\r\n\r\nb",
                "(PUT / 1.1 [Content-Length=0])(PUT /a 1.1 [Content-Length=1] {b})",
            ),
            (
                STRICT,
                b"PUT / HTTP/1.1\r\nContent-Length: 18446744073709551615\r\n\r\na",
                "(PUT / 1.1 [Content-Length=18446744073709551615] {a} ..",
            ),
            (
                STRICT,
                b"PUT / HTTP/1.0\r\nConnection: keep-alive\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
                "(PUT / 1.0 [Connection=keep-alive Transfer-Encoding=chunked] close)",
            ),
            (
                STRICT,
                b"PUT / HTTP/1.1\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n\r\n",
                "(PUT / 1.1 [Transfer-Encoding=chunked Connection=close] close)",
            ),
            (
                ALL,
                b"PUT / HTTP/1.1\r\nConnection: upgrade\r\nTransfer-Encoding: a\r\n b\r\n\r\n",
                "(PUT / 1.1 [Connection=upgrade Transfer-Encoding=a b] close until eof",
            ),
            (
                STRICT,
                b"PUT / HTTP/1.1\r\nUpgrade: a\r\nConnection: upgrade\r\nContent-Length: 1\r\n\r\nbc",
                "(PUT / 1.1 [Upgrade=a Connection=upgrade Content-Length=1] upgrade {b}) +c",
            ),
            (
                STRICT,
                b"PUT / HTTP/1.1\r\nUpgrade: a\r\nConnection: upgrade\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nb\r\n0\r\n\r\nc",
                "(PUT / 1.1 [Upgrade=a Connection=upgrade Transfer-Encoding=chunked] upgrade {b}) +c",
            ),
            (
                STRICT,
                b"CONNECT a HTTP/1.1\r\nContent-Length: 1\r\n\r\nb",
                "(CONNECT a 1.1 [Content-Length=1] upgrade) +b",
            ),
            (
                STRICT,
                b"GET / HTTP/1.1\r\nUpgrade:\r\nConnection: upgrade\r\n\r\n",
                "(GET / 1.1 [Upgrade= Connection=upgrade])",
            ),
            (
                Lenient::CHUNKED_LENGTH,
                b"PUT / HTTP/1.1\r\nContent-Length: 9\r\nTransfer-Encoding: chunked\r\n\r\n1\r\na\r\n0\r\n\r\n",
                "(PUT / 1.1 [Content-Length=9 Transfer-Encoding=chunked] {a})",
            ),
            (
                Lenient::CHUNKED_LENGTH,
                b"PUT / HTTP/1.1\r\nTransfer-Encoding: a\r\nContent-Length: 1\r\n\r\nbc",
                "(PUT / 1.1 [Transfer-Encoding=a Content-Length=1] close {bc} until eof",
            ),
            (
                LONE_CR,
                b"PUT / HTTP/1.1\r\nContent-Length: 1\r\n\ra",
                "(PUT / 1.1 [Content-Length=1] {a})",
            ),
        ] {
            REQUEST.with(lenient).check(bytes, expected);
        }
    }

    #[test]
    fn responses() {
        const CLOSED: &str = " close) HPE_CLOSED_CONNECTION: Data after `Connection: close` @";
        for status in 100..1000 {
            for (field, body, no_content) in [
                ("a: b", " close {H} until eof", ")( .."),
                ("Content-Length: 1", " {H})", CLOSED),
                ("Content-Length: 0", ")( ..", ")( .."),
                ("Transfer-Encoding: a", " close {H} until eof", CLOSED),
                (
                    "Transfer-Encoding: chunked",
                    " HPE_INVALID_CHUNK_SIZE: Invalid character in chunk size @",
                    CLOSED,
                ),
            ] {
                let expected = match status {
                    101 => " close) +H",
                    204 => no_content,
                    100..=199 | 304 => ")( ..",
                    _ => body,
                };
                let bytes = format!("HTTP/1.1 {status} \r\n{field}\r\n\r\nH");
                let log = RESPONSE.feed(&[bytes.as_bytes()]);
                let log = log.trim_end_matches(|char: char| char.is_ascii_digit());
                assert!(log.ends_with(&format!("]{expected}")), "{log}");
            }
        }
        for (status, expected) in [(101, " close upgrade) +a"), (200, " {a})")] {
            let bytes = format!(
                "HTTP/1.1 {status} \r\nConnection: upgrade\r\nUpgrade: a\r\nContent-Length: 1\r\n\r\na"
            );
            let log = RESPONSE.parse(bytes.as_bytes());
            assert!(log.ends_with(&format!("]{expected}")), "{log}");
        }
    }

    #[test]
    fn lengths_without_a_body() {
        RESPONSE.check(
            b"HTTP/1.1 304 \r\nContent-Length: 1\r\n\r\nHTTP/1.1 200 \r\nContent-Length: 1\r\n\r\na",
            r#"(304 "" 1.1 [Content-Length=1])(200 "" 1.1 [Content-Length=1] {a})"#,
        );
    }

    #[test]
    fn interim_responses() {
        RESPONSE.check(
            b"HTTP/1.1 100 \0\r\n\r\nHTTP/1.1 199 a\r\n\r\nHTTP/1.1 204 \r\n\r\n",
            r#"(100 "" 1.1 [])(199 "a" 1.1 [])(204 "" 1.1 [])"#,
        );
        for status_code in [100, 199] {
            let fields = "Connection: keep-alive\r\nTransfer-Encoding: chunked";
            let bytes = format!("HTTP/1.0 {status_code} \r\n{fields}\r\n\r\nH");
            RESPONSE.check_end(bytes.as_bytes(), "])( ..");
        }
        for head in ["HTTP/1.1 100 \r\nConnection: close", "HTTP/1.0 102 "] {
            let bytes = format!("{head}\r\n\r\nH");
            RESPONSE.check_error(bytes.as_bytes(), b"", AFTER_CLOSE);
        }
    }

    #[test]
    fn decided_by_the_caller() {
        for (name, value, close) in [
            ("a", "b", " close"),
            ("Content-Length", "1", ""),
            ("Transfer-Encoding", "chunked", ""),
            ("Transfer-Encoding", "a", " close"),
        ] {
            let bytes = format!("HTTP/1.1 200 \r\n{name}: {value}\r\n\r\nH");
            for (after_head, end) in [
                (MessageParser::skip_body as fn(&mut _), "( .."),
                (MessageParser::switch_protocol, " +H"),
            ] {
                let fields = format!("[{name}={value}]");
                Setup {
                    after_head,
                    ..RESPONSE
                }
                .check(
                    bytes.as_bytes(),
                    &format!("(200 \"\" 1.1 {fields}{close} {fields}){end}"),
                );
            }
        }
    }

    #[test]
    fn after_the_last_message() {
        for (setup, last, next) in [
            (REQUEST, &b"GET / HTTP/1.0\r\n\r\n"[..], &b"G"[..]),
            (
                REQUEST,
                b"GET / HTTP/1.1\r\nConnection: close\r\n\r\n",
                b"G",
            ),
            (
                RESPONSE,
                b"HTTP/1.0 200 \r\nContent-Length: 1\r\n\r\na",
                b"H",
            ),
            (
                Setup {
                    after_head: MessageParser::skip_body,
                    ..RESPONSE
                },
                b"HTTP/1.1 200 \r\nConnection: close\r\n\r\n",
                b"H",
            ),
            (
                RESPONSE,
                b"HTTP/1.1 304 \r\nContent-Length: 1\r\nConnection: close\r\n\r\n",
                b"H",
            ),
        ] {
            let log = setup.parse(last);
            setup.check(&[last, b"\r\n\n\r"].concat(), &log);
            setup.check_error(&[last, next].concat(), b"a", AFTER_CLOSE);
            setup.check_error(&[last, b"\r\n", next].concat(), b"", AFTER_CLOSE);
            let bytes = [last, next].concat();
            setup.with(Lenient::DATA_AFTER_CLOSE).check(&bytes, &log);
            setup.with(ALL).check(&bytes, &format!("{log}( .."));
            setup
                .with(ALL)
                .check(&[last, last].concat(), &log.repeat(2));
        }
    }

    #[test]
    fn without_a_next_message() {
        for (setup, line, rest) in [
            (REQUEST, "PUT / HTTP/1.0", "0\r\n\r\n"),
            (REQUEST, "PUT / HTTP/0.9", "0\r\n\r\n"),
            (RESPONSE, "HTTP/1.0 200 ", "0\r\n\r\n"),
            (RESPONSE, "HTTP/1.0 304 ", ""),
            (RESPONSE, "HTTP/1.1 204 ", ""),
        ] {
            let last = format!(
                "{line}\r\nConnection: keep-alive\r\nTransfer-Encoding: chunked\r\n\r\n{rest}a"
            );
            for lenient in [STRICT, Lenient::KEEP_ALIVE] {
                let setup = setup.with(lenient | Lenient::CHUNKED_LENGTH);
                setup.check_error(last.as_bytes(), b"", AFTER_CLOSE);
            }
            setup.with(ALL).check_end(last.as_bytes(), " close)");
        }
        RESPONSE.with(ALL).check_end(
            b"HTTP/1.0 099 \r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\na",
            " close)",
        );
        RESPONSE.with(Lenient::CHUNKED_LENGTH).check_end(
            b"HTTP/1.1 200 \r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nH",
            "])( ..",
        );
    }

    #[test]
    fn after_an_upgrade() {
        let mut parser = REQUEST.parser();
        advance_to(&mut parser, UPGRADE, Event::HeadComplete);
        parser.pause();
        advance_to(&mut parser, UPGRADE, Event::Done(UPGRADE.len()));
        assert_eq!(parser.error(), None);
        let next = b"GET / HTTP/1.1\r\n\r\n";
        assert_eq!(parser.advance(next), Event::MessageBegin);
        assert!(parser.is_upgrade());
        assert_eq!(parser.advance(next), Event::HeadComplete);
        assert!(!parser.is_upgrade());

        let mut parser = RESPONSE.parser();
        let read = b"HTTP/1.1 204 \r\n\r\n";
        advance_to(&mut parser, read, Event::HeadComplete);
        parser.switch_protocol();
        advance_to(&mut parser, read, Event::Done(read.len()));
        advance_to(&mut parser, b"HTTP/1.1 204 \0", Event::Done(14));
        assert!(parser.is_upgrade());

        for (setup, read) in [
            (REQUEST, &b"GET / HTTP/1.1\r\nConnection: close\r\n\r\n"[..]),
            (RESPONSE, b"HTTP/1.1 101 \r\n\r\n"),
        ] {
            let mut parser = setup.parser();
            advance_to(&mut parser, read, Event::HeadComplete);
            parser.switch_protocol();
            advance_to(&mut parser, read, Event::Done(read.len()));
            let failure = Event::Failed(ParseError::DataAfterClose, 1);
            assert_eq!(parser.advance(b"G"), failure);
        }
    }
}

mod chunks {
    use super::*;

    const HEAD: &[u8] = b"PUT / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n";
    const SIZE: &str = "HPE_INVALID_CHUNK_SIZE: Invalid character in chunk size";
    const NO_CR_AFTER_VALUE: &str =
        "HPE_CR_EXPECTED: Missing expected CR after chunk extension value";
    const EXTENSION_START: &str = "HPE_STRICT: Invalid character in chunk extensions";
    const NO_LF_AFTER_SIZE: &str = "HPE_STRICT: Expected LF after chunk size";
    const NO_LF_AFTER_DATA: &str = "HPE_STRICT: Expected LF after chunk data";

    #[test]
    fn complete() {
        for (lenient, chunks, expected) in [
            (STRICT, &b"0\r\n\r\n"[..], ")"),
            (STRICT, b"000\r\n\r\n", ")"),
            (STRICT, b"a\r\n0123456789\r\n0\r\n\r\n", " {0123456789})"),
            (STRICT, b"0A\r\n0123456789\r\n0\r\n\r\n", " {0123456789})"),
            (
                STRICT,
                b"10\r\n0123456789abcdef\r\n1\r\ng\r\n0\r\n\r\nG",
                " {0123456789abcdefg})( ..",
            ),
            (STRICT, b"5\r\n0\r\n\r\n\r\n0\r\n\r\n", r" {0\r\n\r\n})"),
            (STRICT, b"ffffffffffffffff\r\na", " {a} .."),
            (STRICT, b"0000000000000000001\r\na", " {a} .."),
            (STRICT, b"1;a\r\nb\r\n0;c;d=e;f=;;=g\r\n\r\n", " {b})"),
            (
                STRICT,
                b"1;a=\"\";b=c\"; \\\"\\\\\t\xff\\\xff\"\r\nd\r\n0\r\n\r\n",
                " {d})",
            ),
            (STRICT, b"0\r\na: b\r\nc:\r\n\r\n", " [a=b c=])"),
            (
                STRICT,
                b"0\r\nConnection: close\r\n\r\nG",
                " [Connection=close])( ..",
            ),
            (
                Lenient::SPACES_AFTER_CHUNK_SIZE,
                b"1 \t\r\na\r\n0 ;b\r\n\r\n",
                " {a})",
            ),
            (
                Lenient::OPTIONAL_CRLF_AFTER_CHUNK,
                b"1\r\na1\r\nb\r1\r\nc\r\n0\r\n\r\n",
                " {abc})",
            ),
            (LONE_CR, b"1\ra\r\n1;b\rc\r\n0\r\rG", " {ac})( .."),
            (
                LONE_LF,
                b"1\n\na\n1;b\nc\n1;d=e\nf\n1;g=\"h\"\ni\n1;\nj\n0\r\nk: l\n\n",
                " {acfij} [k=l])",
            ),
            (ALL, b"1\na\n0\nb: c\n\n", " {a} [b=c])"),
            (
                ALL,
                b"0\r\nContent-Length: 1\r\nTransfer-Encoding: a\r\n\r\nG",
                " [Content-Length=1 Transfer-Encoding=a])( ..",
            ),
        ] {
            let expected = format!("(PUT / 1.1 [Transfer-Encoding=chunked]{expected}");
            REQUEST
                .with(lenient)
                .check(&[HEAD, chunks].concat(), &expected);
        }
    }

    #[test]
    fn malformed() {
        for (lenient, consumed, rest, error) in [
            (STRICT, &b""[..], &b"\r\n"[..], SIZE),
            (STRICT, b"", b";", SIZE),
            (STRICT, b"", b"+1", SIZE),
            (STRICT, b"", b"g", SIZE),
            (STRICT, b"0", b"x1", SIZE),
            (STRICT, b"1", b"_", SIZE),
            (STRICT, b"1 ", b"\r", SIZE),
            (STRICT, b"1\t", b"\r", SIZE),
            (STRICT, b"1\r\na\r\n", b"\r\n", SIZE),
            (LONE_LF, b"1\r\na\n", b"\r\n", SIZE),
            (STRICT, b"1;a=\"b\";\r", b"\n", EXTENSION_START),
            (ALL, b"", b" 1", SIZE),
            (ALL, b"1 ", b"1", SIZE),
            (
                STRICT,
                b"10000000000000000",
                b"",
                "HPE_INVALID_CHUNK_SIZE: Chunk size overflow",
            ),
            (
                STRICT,
                b"1\n",
                b"",
                "HPE_CR_EXPECTED: Missing expected CR after chunk size",
            ),
            (STRICT, b"1\r", b"a", NO_LF_AFTER_SIZE),
            (STRICT, b"1;a\r", b"\r", NO_LF_AFTER_SIZE),
            (STRICT, b"1;a=b\r", b"c", NO_LF_AFTER_SIZE),
            (STRICT, b"1;a=\"b\"\r", b"c", NO_LF_AFTER_SIZE),
            (STRICT, b"1;\r", b"\n", EXTENSION_START),
            (STRICT, b"1;a; ", b"b", EXTENSION_START),
            (
                STRICT,
                b"1;\t",
                b"a",
                "HPE_STRICT: Invalid character in chunk extensions name",
            ),
            (
                STRICT,
                b"1;a ",
                b"=",
                "HPE_STRICT: Invalid character in chunk extensions name",
            ),
            (
                STRICT,
                b"1;a",
                b"\n",
                "HPE_CR_EXPECTED: Missing expected CR after chunk extension name",
            ),
            (
                STRICT,
                b"1;a= ",
                b"b",
                "HPE_STRICT: Invalid character in chunk extensions value",
            ),
            (
                STRICT,
                b"1;a=b=",
                b"c",
                "HPE_STRICT: Invalid character in chunk extensions value",
            ),
            (STRICT, b"1;a=b", b"\n", NO_CR_AFTER_VALUE),
            (STRICT, b"1;a=\"b\"", b"\n", NO_CR_AFTER_VALUE),
            (
                STRICT,
                b"1;a=\"b\r",
                b"\n",
                "HPE_STRICT: Invalid character in chunk extensions quoted value",
            ),
            (
                ALL,
                b"1;a=\"b\n",
                b"",
                "HPE_STRICT: Invalid character in chunk extensions quoted value",
            ),
            (
                ALL,
                b"1;a=\"\\\r",
                b"\n",
                "HPE_STRICT: Invalid quoted-pair in chunk extensions quoted value",
            ),
            (
                STRICT,
                b"1;a=\"b\"",
                b"c",
                "HPE_STRICT: Invalid character in chunk extensions quote value",
            ),
            (STRICT, b"1\r\na", b"b", NO_LF_AFTER_DATA),
            (STRICT, b"1\r\na\r", b"b", NO_LF_AFTER_DATA),
            (LONE_CR, b"1\r\na\r", b"1", NO_LF_AFTER_DATA),
            (
                STRICT,
                b"1\r\na\n",
                b"",
                "HPE_CR_EXPECTED: Missing expected CR after chunk data",
            ),
            (
                STRICT,
                b"0\r\n",
                b" ",
                "HPE_INVALID_HEADER_TOKEN: Invalid header token",
            ),
            (
                STRICT,
                b"0\r\n\n",
                b"",
                "HPE_INVALID_HEADER_TOKEN: Invalid header field char",
            ),
            (
                STRICT,
                b"0\r\n\r",
                b"G",
                "HPE_STRICT: Expected LF after headers",
            ),
            (
                STRICT,
                b"0\r\nContent-Length:",
                b"1",
                "HPE_INVALID_CONTENT_LENGTH: Content-Length can't be present with Transfer-Encoding",
            ),
            (
                STRICT,
                b"0\r\nTransfer-Encoding: a",
                b"",
                "HPE_INVALID_TRANSFER_ENCODING: Invalid `Transfer-Encoding` header value",
            ),
        ] {
            REQUEST
                .with(lenient)
                .check_error(&[HEAD, consumed].concat(), rest, error);
        }
    }

    #[test]
    fn extension_bytes() {
        for (before, after, is_allowed) in [
            (
                &b"0;"[..],
                &b"z\r\n\r\n"[..],
                (|byte| is_token(byte) || matches!(byte, b';' | b'=')) as fn(_) -> _,
            ),
            (b"0;a=", b"z\r\n\r\n", |byte| is_token(byte) || byte == b';'),
            (b"0;a=\"", b"z\"\r\n\r\n", |byte| {
                is_content(byte) && byte != b'"'
            }),
        ] {
            REQUEST.check_each_byte(&[HEAD, before].concat(), after, is_allowed);
        }
        for byte in 0..=u8::MAX {
            let bytes = [HEAD, b"0;a=\"\\", &[byte], b"\"\r\n\r\n"].concat();
            assert_eq!(REQUEST.parse(&bytes).ends_with(')'), is_content(byte));
            let bytes = [HEAD, &[byte], b"\r\n"].concat();
            assert_eq!(
                REQUEST.parse(&bytes).ends_with(".."),
                byte.is_ascii_hexdigit()
            );
        }
    }
}

#[test]
fn what_each_flag_allows() {
    const LINE: &str = "PUT / HTTP/1.1\r\n";
    const CHUNKED: &str = "PUT / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n";
    for (allowed_by, setup, before, rest) in [
        (HEADERS, REQUEST, LINE, " a"),
        (HEADERS, REQUEST, LINE, "Upgrade :"),
        (HEADERS, REQUEST, LINE, "a:\rb"),
        (HEADERS, REQUEST, LINE, "a:\r\n b"),
        (HEADERS, REQUEST, LINE, "a: b\r\n c"),
        (HEADERS, REQUEST, LINE, "a: \0"),
        (HEADERS, RESPONSE, "", "HTTP/1.1 0"),
        (HEADERS | RELAXED, REQUEST, LINE, "a: \x01"),
        (Lenient::CHUNKED_LENGTH, REQUEST, CHUNKED, "Content-Length:"),
        (
            Lenient::CHUNKED_LENGTH,
            REQUEST,
            LINE,
            "Content-Length: 0\r\nTransfer-Encoding:",
        ),
        (
            Lenient::CHUNKED_LENGTH | Lenient::TRANSFER_ENCODING,
            REQUEST,
            LINE,
            "Transfer-Encoding: a\r\n\r\n",
        ),
        (
            Lenient::TRANSFER_ENCODING,
            REQUEST,
            LINE,
            "Transfer-Encoding: chunked,",
        ),
        (
            Lenient::TRANSFER_ENCODING,
            REQUEST,
            CHUNKED,
            "Transfer-Encoding: a",
        ),
        (
            Lenient::KEEP_ALIVE | Lenient::DATA_AFTER_CLOSE,
            REQUEST,
            LINE,
            "Connection: close\r\n\r\nG",
        ),
        (Lenient::VERSION, REQUEST, "", "GET / HTTP/1.2"),
        (LONE_CR, REQUEST, "", "GET / HTTP/1.1\ra"),
        (LONE_CR, RESPONSE, "", "HTTP/1.1 200\ra"),
        (LONE_CR, REQUEST, LINE, "\rG"),
        (LONE_CR, REQUEST, CHUNKED, "\r\n1\ra"),
        (
            Lenient::OPTIONAL_CRLF_AFTER_CHUNK,
            REQUEST,
            CHUNKED,
            "\r\n1\r\na1",
        ),
        (
            Lenient::OPTIONAL_CRLF_AFTER_CHUNK,
            REQUEST,
            CHUNKED,
            "\r\n1\r\na\r1",
        ),
        (LONE_LF, REQUEST, "", "GET /\n"),
        (LONE_LF, REQUEST, "", "GET / HTTP/1.1\n"),
        (LONE_LF, RESPONSE, "", "HTTP/1.1 200\n"),
        (LONE_LF, RESPONSE, "", "HTTP/1.1 200 \n"),
        (LONE_LF, REQUEST, LINE, "\n"),
        (LONE_LF, REQUEST, LINE, "a:\n"),
        (LONE_LF, REQUEST, LINE, "a: b\n"),
        (LONE_LF, REQUEST, CHUNKED, "\r\n1\n"),
        (LONE_LF, REQUEST, CHUNKED, "\r\n1;a\n"),
        (LONE_LF, REQUEST, CHUNKED, "\r\n1;a=b\n"),
        (LONE_LF, REQUEST, CHUNKED, "\r\n1;a=\"b\"\n"),
        (LONE_LF, REQUEST, CHUNKED, "\r\n1\r\na\n"),
        (Lenient::SPACES_AFTER_CHUNK_SIZE, REQUEST, CHUNKED, "\r\n1 "),
    ] {
        let bytes = format!("{before}{rest}").into_bytes();
        let fails = |lenient| without_position(&setup.with(lenient).parse(&bytes)).is_some();
        for (bit, flag) in Lenient::all().iter().enumerate() {
            assert_eq!(flag.bits(), 1 << bit);
            assert_eq!(fails(flag), !allowed_by.contains(flag), "{rest:?} {bit}");
        }
        assert!(fails(Lenient::all() - allowed_by), "{rest:?}");
    }
}

mod limits {
    use super::*;

    const SECTION: &str = "HPE_HEADER_OVERFLOW: Header overflow";
    const EXTENSIONS: &str = "HPE_CHUNK_EXTENSIONS_OVERFLOW: Chunk extensions overflow";
    const CHUNKED: &str = "PUT / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n";

    #[test]
    fn section_len() {
        for (setup, bytes, len) in [
            (REQUEST, &b"GET /a HTTP/1.1\r\n\r\n"[..], 2),
            (REQUEST, b"GET a://b@c/d\r\n\r\n", 9),
            (REQUEST, b"GET / HTTP/1.1\r\nab: cd \r\nef:\r\n\r\n", 8),
            (REQUEST, b"GET / HTTP/1.1\r\nConnection: a, close \r\n\r\n", 20),
            (REQUEST, b"GET / HTTP/1.1\r\nContent-Length: 00 \r\n\r\n", 18),
            (REQUEST, b"GET / HTTP/1.1\r\n\r\nGET /a HTTP/1.1\r\n\r\nGET / HTTP/1.1\r\n\r\n", 2),
            (REQUEST.with(ALL), b"GET / HTTP/1.1\nUpgrade  : a\n b\n\n", 13),
            (RESPONSE, b"HTTP/1.1 204 ab\r\nc: d\r\n\r\n", 4),
            (RESPONSE, b"HTTP/1.1 204 \0\0\0\r\n\r\n", 3),
            (
                RESPONSE,
                b"HTTP/1.1 200 \r\nTransfer-Encoding: chunked\r\n\r\n0\r\nabcdefghijklmnopqrstuvwxyz: a\r\n\r\n",
                27,
            ),
        ] {
            for (max_section_len, expected) in [(len + 1, ")"), (u64::MAX, ")"), (len, SECTION), (1, SECTION)] {
                Setup {
                    max_section_len,
                    ..setup
                }
                .check_end(bytes, expected);
            }
        }
    }

    #[test]
    fn where_a_section_overflows() {
        for (setup, max_section_len, consumed, rest) in [
            (REQUEST, 2, &b"GET /a"[..], &b" "[..]),
            (REQUEST, 2, b"GET /a", b"\n"),
            (REQUEST, 2, b"GET /ab", b""),
            (REQUEST, 2, b"GET / HTTP/1.1\r\na:", b" "),
            (REQUEST, 2, b"GET / HTTP/1.1\r\nab", b""),
            (REQUEST, 2, b"GET / HTTP/1.1\r\nUpgrade ", b":"),
            (REQUEST, 3, b"GET / HTTP/1.1\r\na: b\r", b"\n"),
            (REQUEST, 3, b"GET / HTTP/1.1\r\na: b", b"\n"),
            (REQUEST, 3, b"GET / HTTP/1.1\r\na: b", b"\0"),
            (REQUEST, 16, b"GET / HTTP/1.1\r\nContent-Length: 1", b"a"),
            (
                REQUEST,
                25,
                b"GET / HTTP/1.1\r\nTransfer-Encoding: chunked,",
                b" ",
            ),
            (RESPONSE, 2, b"HTTP/1.1 200 OK\r", b"\n"),
            (RESPONSE, 2, b"HTTP/1.1 200 OK\n", b"\n"),
        ] {
            let log = Setup {
                max_section_len,
                ..setup
            }
            .feed(&[&[consumed, rest].concat()]);
            assert_eq!(log, format!("( {SECTION} @{}", consumed.len()));
        }
    }

    #[test]
    fn field_count() {
        let fields = |count| "a: b\r\n".repeat(count);
        let head = |count| format!("GET / HTTP/1.1\r\n{}\r\n", fields(count));
        let trailers = |count| format!("{CHUNKED}0\r\n{}\r\n", fields(count));
        for max_fields in [1, 30, 31, 32, 62, 63] {
            let setup = Setup {
                max_fields: Some(max_fields as u64),
                ..REQUEST
            };
            setup.check_end(head(max_fields).repeat(2).as_bytes(), ")");
            setup.check_end(head(max_fields + 1).as_bytes(), SECTION);
            setup.check_end(trailers(max_fields).as_bytes(), ")");
            setup.check_end(trailers(max_fields + 1).as_bytes(), SECTION);
        }
        let none = |setup| Setup {
            max_fields: Some(0),
            ..setup
        };
        assert_eq!(
            none(REQUEST).feed(&[head(1).as_bytes()]),
            format!("( {SECTION} @18")
        );
        none(REQUEST).check(head(0).as_bytes(), "(GET / 1.1 [])");
        none(RESPONSE).check(b"HTTP/1.1 204 \r\na: b\r\n\r\n", r#"(204 "" 1.1 [a=b])"#);

        let too_long = format!("GET / HTTP/1.1\r\n{}ab:", fields(31));
        let setup = Setup {
            max_section_len: 65,
            ..REQUEST
        };
        assert_eq!(
            setup.feed(&[too_long.as_bytes()]),
            format!("( {SECTION} @{}", too_long.len())
        );

        let counted_together = Setup {
            max_fields: Some(2),
            after_head: |_| {},
            ..REQUEST
        };
        counted_together.check_end(trailers(1).as_bytes(), " [Transfer-Encoding=chunked a=b])");
        counted_together.check_end(trailers(2).as_bytes(), SECTION);
    }

    #[test]
    fn many_fields() {
        for count in [31, 32, 62, 63] {
            let fields: Vec<_> = (0..count).map(|i| format!("a{i}={i}")).collect();
            let mut blocks: Vec<_> = fields.chunks(31).map(|block| block.join(" ")).collect();
            let last = blocks.pop().unwrap();
            let earlier: Vec<_> = blocks.iter().map(|it| format!("<[{it}]> ")).collect();
            let lines: Vec<_> = (0..count).map(|i| format!("a{i}:{i}\r\n")).collect();
            let (earlier, lines) = (earlier.concat(), lines.concat());
            REQUEST.check(
                format!("GET /b HTTP/1.1\r\n{lines}\r\n").as_bytes(),
                &format!("({earlier}GET /b 1.1 [{last}])"),
            );
            RESPONSE.check(
                format!("HTTP/1.1 204 b\r\n{lines}\r\n").as_bytes(),
                &format!("({earlier}204 \"b\" 1.1 [{last}])"),
            );
        }
    }

    #[test]
    fn extensions_len() {
        for (before, after, others) in [
            ("1;", "", 0),
            ("1;", "=b", 1),
            ("1;", ";b", 1),
            ("1;b=", "", 1),
            ("1;b=", ";c", 2),
            ("1;b=\"", "\"", 3),
            ("1;b=\"", "\\c\"", 5),
        ] {
            let chunk =
                |len: usize| format!("{before}{}{after}\r\na\r\n", "a".repeat(len - others));
            let longest = chunk(16 * 1024);
            REQUEST.check_end(
                format!("{CHUNKED}{longest}{longest}0\r\n\r\n").as_bytes(),
                " {aa})",
            );
            REQUEST.check_end(
                format!("{CHUNKED}{}", chunk(16 * 1024 + 1)).as_bytes(),
                EXTENSIONS,
            );
        }
        let long = "a".repeat(16 * 1024 + 1);
        for (consumed, rest) in [
            (format!("1;{long}"), ""),
            (format!("1;{long}"), "\n"),
            (format!("1;{long}="), "b"),
            (format!("1;{long}\r"), "\n"),
            (format!("1;=\"{long}\""), ";"),
            (format!("1;=\"{long}\0"), "b"),
            (format!("1;=\"{long}\\\0"), "b"),
        ] {
            let log = REQUEST.feed(&[format!("{CHUNKED}{consumed}{rest}").as_bytes()]);
            let at = CHUNKED.len() + consumed.len();
            assert!(log.ends_with(&format!(" {EXTENSIONS} @{at}")), "{log}");
        }
    }

    #[test]
    fn long_runs() {
        const MAX_LEN: usize = 8 * (100 + 16 * 1024) - 1;
        for (setup, before, delivered, run, expected) in [
            (REQUEST, "", 0, "\n", SECTION),
            (REQUEST, "GET", 0, " ", SECTION),
            (REQUEST, "GET /", 0, " ", SECTION),
            (REQUEST, "GET / HTTP/1.1\r\na:", 0, "\t", SECTION),
            (REQUEST, "GET / HTTP/1.1\r\n\r\n", 18, "\r", SECTION),
            (
                REQUEST,
                &format!("{CHUNKED}0\r\n\r\n"),
                CHUNKED.len() + 5,
                "\r",
                SECTION,
            ),
            (REQUEST, CHUNKED, CHUNKED.len(), "0", EXTENSIONS),
            (
                REQUEST,
                &format!("{CHUNKED}1\r\na\r\n"),
                CHUNKED.len() + 4,
                "0",
                EXTENSIONS,
            ),
            (
                REQUEST.with(ALL),
                &format!("{CHUNKED}1"),
                CHUNKED.len(),
                " ",
                EXTENSIONS,
            ),
            (RESPONSE, "", 0, "\r", SECTION),
            (RESPONSE, "HTTP/1.0 204 \r\n\r\n", 17, "\n", ")"),
        ] {
            let setup = Setup {
                max_section_len: 100,
                ..setup
            };
            let bytes = format!(
                "{before}{}",
                run.repeat(delivered + MAX_LEN + 1 - before.len())
            );
            let (last, longest) = bytes.as_bytes().split_last().unwrap();
            assert_eq!(setup.feed(&[longest]), setup.feed(&[&longest[..200]]));
            setup.check_end(&[longest, &[*last]].concat(), expected);
        }
        let size_line = format!("{CHUNKED}{}1\r\n", "0".repeat(MAX_LEN));
        Setup {
            max_section_len: 100,
            ..REQUEST
        }
        .check_end(size_line.as_bytes(), EXTENSIONS);
        for max_section_len in [1 << 61, u64::MAX] {
            let setup = Setup {
                max_section_len,
                ..REQUEST
            };
            setup.check_end(format!("GET{}", " ".repeat(MAX_LEN)).as_bytes(), "( ..");
        }
    }
}

mod control {
    use super::*;

    fn events(parser: &mut MessageParser, read: &[u8], count: usize) -> Vec<Event> {
        (0..count).map(|_| parser.advance(read)).collect()
    }

    #[test]
    fn eof_during_a_message() {
        let mut parser = REQUEST.parser();
        let read = b"PUT / HTTP/1.1\r\nContent-Length: 1\r\n\r\na";
        for event in [
            Event::MessageBegin,
            Event::FieldLimitNeeded,
            Event::HeadComplete,
            Event::Body((37..38).into()),
            Event::MessageComplete,
        ] {
            assert_eq!(parser.advance(read), event);
            assert_eq!(parser.finish(), Eof::CutsMessageShort);
        }
        assert_eq!(parser.advance(read), Event::Done(read.len()));
        assert_eq!(parser.finish(), Eof::Ignored);
    }

    #[test]
    fn eof_that_completes_a_message() {
        let mut parser = RESPONSE.parser();
        let read = b"HTTP/1.1 200 \r\n\r\n";
        assert_eq!(events(&mut parser, read, 3)[2], Event::Done(read.len()));
        assert_eq!(parser.finish(), Eof::CompletesMessage);
        assert_eq!(parser.finish(), Eof::Ignored);
        assert_eq!(
            parser.advance(b"a"),
            Event::Failed(ParseError::DataAfterClose, 1)
        );
    }

    #[test]
    fn field_limit_of_each_section() {
        let mut parser = REQUEST.parser();
        let read =
            b"PUT / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\na:\r\n\r\nGET /\r\na:";
        for event in [
            Event::MessageBegin,
            Event::FieldLimitNeeded,
            Event::HeadComplete,
            Event::FieldLimitNeeded,
            Event::MessageComplete,
            Event::MessageBegin,
            Event::FieldLimitNeeded,
        ] {
            assert_eq!(parser.advance(read), event);
            if event == Event::HeadComplete {
                parser.clear_fields();
            }
        }
    }

    #[test]
    fn texts_outlast_the_read() {
        let mut parser = REQUEST.with(ALL).parser();
        let read = b"PUT /a HTTP/1.1\r\nTransfer-Encoding: b\r\n\r\nc";
        assert_eq!(events(&mut parser, read, 4)[3], Event::DoneInBody(41));
        assert_eq!(parser.finish(), Eof::CompletesMessage);
        assert_eq!(parser.start_line_text(b""), b"/a");
        assert_eq!(show_fields(&parser, b""), "[Transfer-Encoding=b]");
        parser.clear_url();
        assert_eq!(parser.start_line_text(b""), b"");
        assert_eq!(show_fields(&parser, b""), "[Transfer-Encoding=b]");
        parser.clear_fields();
        assert_eq!(show_fields(&parser, b""), "[]");

        let mut parser = RESPONSE.parser();
        let read = b"HTTP/1.1 200 a\r\nb: c\r\n\r\nd";
        assert_eq!(events(&mut parser, read, 3)[2], Event::DoneInBody(24));
        assert_eq!(parser.start_line_text(b""), b"");
        assert_eq!(show_fields(&parser, b""), "[b=c]");
    }

    #[test]
    fn clear_url() {
        for (setup, read, expected) in [
            (REQUEST, &b"GET /a HTTP/1.1\r\n\r\n"[..], &b""[..]),
            (RESPONSE, b"HTTP/1.1 200 a\r\n\r\n", b"a"),
        ] {
            let mut parser = setup.parser();
            assert_eq!(events(&mut parser, read, 2)[1], Event::HeadComplete);
            parser.clear_url();
            assert_eq!(parser.start_line_text(read), expected);
        }
    }

    #[test]
    fn pause() {
        let mut parser = REQUEST.parser();
        parser.resume();
        assert_eq!(parser.advance(b"GET /a"), Event::MessageBegin);
        parser.pause();
        assert_eq!(parser.advance(b"GET /a"), Event::Done(6));
        assert_eq!(parser.error(), Some(ParseError::Paused));
        assert_eq!(parser.finish(), Eof::Ignored);
        parser.resume();
        assert_eq!(parser.error(), None);

        let read = b"b HTTP/1.1\r\n\r\nG";
        assert_eq!(parser.advance(read), Event::HeadComplete);
        assert_eq!(parser.abort(read, ParseError::PausedAfterHead), 14);
        parser.pause();
        assert_eq!(parser.error(), Some(ParseError::PausedAfterHead));
        parser.resume();
        assert_eq!(parser.finish(), Eof::CutsMessageShort);
        assert_eq!(parser.advance(b""), Event::MessageComplete);
        assert_eq!(parser.start_line_text(b""), b"/ab");
        assert_eq!(parser.advance(b""), Event::Done(0));

        assert_eq!(
            events(&mut parser, b"a", 2)[1],
            Event::Failed(ParseError::Method, 0)
        );
        parser.pause();
        parser.resume();
        assert_eq!(parser.error(), Some(ParseError::Method));
    }

    #[test]
    fn errors_of_the_caller() {
        for (error, expected) in [
            (ParseError::Callback, "HPE_JS_EXCEPTION: JS Exception"),
            (
                ParseError::HeadCompleteCallback,
                "HPE_CB_HEADERS_COMPLETE: User callback error",
            ),
            (
                ParseError::MessageBeginCallback,
                "HPE_CB_MESSAGE_BEGIN: `on_message_begin` callback error",
            ),
            (
                ParseError::MessageCompleteCallback,
                "HPE_CB_MESSAGE_COMPLETE: `on_message_complete` callback error",
            ),
            (ParseError::Paused, "HPE_PAUSED: Paused"),
            (
                ParseError::PausedAfterHead,
                "HPE_PAUSED: Paused by on_headers_complete",
            ),
            (
                ParseError::UnexpectedEof,
                "HPE_INVALID_EOF_STATE: Invalid EOF state",
            ),
        ] {
            assert_eq!(format!("{}: {}", error.code(), error.reason()), expected);
        }
    }
}
