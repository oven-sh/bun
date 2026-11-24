use std::fmt::Write;

use bun_http1::request::{
    Connection, Field, Outcome, Request, RequestError, RequestOptions, RequestParser,
    parse_trailers, read,
};

use super::{is_content, is_token, paddings, show, ways_to_read};

/// What a handler does to its connection.
#[derive(Clone, Copy, PartialEq)]
enum Then {
    GoOn,
    Drop,
    Close,
    Tunnel,
}

#[derive(Clone, Copy)]
struct Setup {
    is_node: bool,
    default_max_head_len: usize,
    max_header_size: u64,
    max_headers_count: u32,
    requires_host: bool,
    has_lenient_values: bool,
    has_lenient_transfer_encoding: bool,
    takes_trailers: bool,
    after_request: Then,
    after_data: Then,
    after_body: Then,
}

const SERVE: Setup = Setup {
    is_node: false,
    default_max_head_len: 16 * 1024,
    max_header_size: 0,
    max_headers_count: 0,
    requires_host: false,
    has_lenient_values: false,
    has_lenient_transfer_encoding: false,
    takes_trailers: true,
    after_request: Then::GoOn,
    after_data: Then::GoOn,
    after_body: Then::GoOn,
};
const NODE: Setup = Setup {
    is_node: true,
    max_header_size: 16 * 1024,
    ..SERVE
};
const INSECURE: Setup = Setup {
    has_lenient_values: true,
    has_lenient_transfer_encoding: true,
    ..NODE
};

struct Server {
    setup: Setup,
    parser: Option<RequestParser>,
    log: String,
}

fn show_fields<'a>(fields: impl Iterator<Item = Field<'a>>) -> String {
    let fields: Vec<_> = fields
        .map(|field| format!("{}={}", show(field.name), show(field.value)))
        .collect();
    format!("[{}]", fields.join(" "))
}

impl Server {
    fn log_data(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        match self.log.pop().unwrap() {
            '}' => {}
            last => self.log.extend([last, ' ', '{']),
        }
        write!(self.log, "{}}}", show(data)).unwrap();
    }

    fn then(mut self: &mut Self, then: Then) -> Option<&mut Self> {
        match then {
            Then::GoOn => {}
            Then::Drop => self.parser = None,
            Then::Close => self.parser().is_closing = true,
            Then::Tunnel => self.parser().is_tunnel = true,
        }
        self.parser.is_some().then_some(self)
    }
}

impl Connection for &mut Server {
    fn parser(&mut self) -> &mut RequestParser {
        self.parser.as_mut().unwrap()
    }

    fn on_request(mut self, request: &Request<'_>) -> Option<Self> {
        assert!(!self.parser().has_partial_head());
        let (method, target) = (show(request.method()), show(request.target()));
        let minor = u8::from(!request.is_http_1_0());
        let fields = show_fields(request.fields());
        write!(self.log, "({method} {target} 1.{minor} {fields}").unwrap();
        for (is_set, name) in [
            (self.parser().is_closing, " close"),
            (request.ends_connection(), " last"),
            (request.has_transfer_encoding(), " coded"),
            (self.parser().is_tunnel, " tunnel"),
        ] {
            if is_set {
                self.log.push_str(name);
            }
        }
        let then = self.setup.after_request;
        let mut this = self.then(then)?;
        if this.setup.is_node && this.parser().is_tunnel {
            this.log_data(request.after_head());
        }
        Some(this)
    }

    fn on_body(mut self, data: &[u8], is_last: bool) -> Option<Self> {
        self.log_data(data);
        if !is_last {
            let then = self.setup.after_data;
            return self.then(then);
        }
        if self.setup.takes_trailers {
            let trailers = self.parser().take_trailers();
            let trailers = parse_trailers(&trailers, self.setup.has_lenient_values);
            if !trailers.is_empty() {
                write!(self.log, " {}", show_fields(trailers.into_iter())).unwrap();
            }
        }
        self.log.push(')');
        let then = self.setup.after_body;
        self.then(then)
    }
}

impl Setup {
    fn options(self) -> RequestOptions {
        RequestOptions {
            max_header_size: self.max_header_size,
            max_headers_count: self.max_headers_count,
            requires_host: self.requires_host,
            has_strict_methods: self.is_node,
            has_lenient_values: self.has_lenient_values,
            has_lenient_transfer_encoding: self.has_lenient_transfer_encoding,
        }
    }

    fn server(self) -> Server {
        Server {
            setup: self,
            parser: Some(RequestParser::new(self.default_max_head_len)),
            log: String::new(),
        }
    }

    fn read(self, connection: impl Connection, bytes: &[u8]) -> Outcome {
        match self.is_node {
            true => read::<true>(connection, bytes, &self.options()),
            false => read::<false>(connection, bytes, &self.options()),
        }
    }

    /// `(GET / 1.1 [a=b] close {body} [trailer=c])`, then `!error`, `+rest` or what the parser waits for.
    fn feed(self, reads: &[&[u8]]) -> String {
        let mut server = self.server();
        for (i, read) in reads.iter().enumerate() {
            match self.read(&mut server, read) {
                Outcome::Consumed => {}
                Outcome::Failed(error) => return format!("{}!{error:?}", server.log),
                Outcome::Stopped { consumed } => {
                    let rest = [&read[consumed..], &reads[i + 1..].concat()].concat();
                    return format!("{}+{}", server.log, show(&rest));
                }
            }
        }
        let parser = server.parser.unwrap();
        for (is_set, name) in [
            (parser.has_partial_head(), "..head"),
            (parser.has_incomplete_body(), "..body"),
            (parser.is_body_until_eof, "..eof"),
        ] {
            if is_set {
                server.log.push_str(name);
            }
        }
        server.log
    }

    /// However it is read.
    #[track_caller]
    fn parse(self, bytes: &[u8]) -> String {
        let log = self.feed(&[bytes]);
        for mut reads in ways_to_read(bytes) {
            reads.retain(|read| !read.is_empty());
            let lens: Vec<_> = reads.iter().map(|read| read.len()).collect();
            assert_eq!(self.feed(&reads), log, "{} {lens:?}", show(bytes));
        }
        log
    }

    /// `)`, `!error` or what the parser waits for.
    #[track_caller]
    fn end(self, bytes: &[u8]) -> String {
        let end = |reads: &[&[u8]]| {
            let log = self.feed(reads);
            let before_word = log.trim_end_matches(char::is_alphanumeric);
            let before = before_word.strip_suffix("..");
            let before = before.or_else(|| before_word.strip_suffix(['!', ')']));
            log[before.unwrap().len()..].to_owned()
        };
        let expected = end(&[bytes]);
        for mut reads in ways_to_read(bytes) {
            reads.retain(|read| !read.is_empty());
            assert_eq!(end(&reads), expected, "{}", show(bytes));
        }
        expected
    }

    fn with_request(self, head: &[u8], check: impl FnOnce(&Request<'_>)) {
        struct Once<F>(RequestParser, F);
        impl<F: FnOnce(&Request<'_>)> Connection for Once<F> {
            fn parser(&mut self) -> &mut RequestParser {
                &mut self.0
            }
            fn on_request(self, request: &Request<'_>) -> Option<Self> {
                (self.1)(request);
                None
            }
            fn on_body(self, _: &[u8], _: bool) -> Option<Self> {
                unreachable!()
            }
        }
        let outcome = self.read(Once(RequestParser::new(1024), check), head);
        assert!(matches!(outcome, Outcome::Stopped { .. }), "{outcome:?}");
    }
}

/// `Bun.serve()` and `node:http` agree.
#[track_caller]
fn check_both(cases: &[(&[u8], &str)]) {
    for (bytes, expected) in cases {
        assert_eq!(SERVE.parse(bytes), *expected, "{}", show(bytes));
        assert_eq!(NODE.parse(bytes), *expected, "node {}", show(bytes));
    }
}

#[track_caller]
fn check_each(cases: &[(&[u8], &str, &str)]) {
    for (bytes, serve, node) in cases {
        assert_eq!(SERVE.parse(bytes), *serve, "{}", show(bytes));
        assert_eq!(NODE.parse(bytes), *node, "node {}", show(bytes));
    }
}

fn post(fields: &str, body: &[u8]) -> Vec<u8> {
    [b"POST / HTTP/1.1\r\n", fields.as_bytes(), b"\r\n", body].concat()
}

fn chunked(body: &[u8]) -> Vec<u8> {
    post("Transfer-Encoding: chunked\r\n", body)
}

const CHUNKED: &str = "(POST / 1.1 [Transfer-Encoding=chunked] coded";

#[test]
fn request_line() {
    check_both(&[
        (b"GET / HTTP/1.1\r\n\r\n", "(GET / 1.1 [])"),
        (b"GET / HTTP/1.0\r\n\r\n", "(GET / 1.0 [] close)"),
        (b"M-SEARCH /?a HTTP/1.1\r\n\r\n", "(M-SEARCH /?a 1.1 [])"),
        (b"GET http://a HTTP/1.1\r\n\r\n", "(GET http://a 1.1 [])"),
        (
            b"GET HTTPS://a/ HTTP/1.1\r\n\r\n",
            "(GET HTTPS://a/ 1.1 [])",
        ),
        (b"CONNECT / HTTP/1.1\r\n\r\n", "(CONNECT / 1.1 [])"),
        (
            b"CONNECT a:80 HTTP/1.1\r\n\r\n",
            "(CONNECT a:80 1.1 [] tunnel..body",
        ),
        (
            b"CONNECT  HTTP/1.1\r\n\r\n",
            "(CONNECT  1.1 [] tunnel..body",
        ),
        (b"G", "..head"),
        (b"GET ", "..head"),
        (b"GET abcdefgh", "..head"),
        (b"GET https://", "..head"),
        (b"GET / HTTP/1.", "..head"),
        (b"GET / HTTP/1.0\r\n", "..head"),
        (b"GET / HTTP/1.1\r\n", "..head"),
        (b"GET / HTTP/1.1\r\n\r", "..head"),
        (b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r", "..head"),
        (b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "!Http2Preface"),
        (b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\nx", "!Http2Preface"),
        (b"PRI * HTTP/1.1\r\n\r\n", "!InvalidRequest"),
        (b" / HTTP/1.1\r\n\r\n", "!InvalidMethod"),
        (b"G3T / HTTP/1.1\r\n\r\n", "!InvalidMethod"),
        (b"GET\r\n", "!InvalidMethod"),
        (b"GET! / HTTP/1.1\r\n\r\n", "!InvalidMethod"),
        (b"GE\x80T / HTTP/1.1\r\n\r\n", "!InvalidMethod"),
        (b"GET\xff / HTTP/1.1\r\n\r\n", "!InvalidMethod"),
        (b"GET\t/ HTTP/1.1\r\n\r\n", "!InvalidVersion"),
        (b"GET\n", "!InvalidVersion"),
        (b"GET  / HTTP/1.1\r\n\r\n", "!InvalidRequest"),
        (b"GET a HTTP/1.1\r\n\r\n", "!InvalidRequest"),
        (b"GET abcdefghi", "!InvalidRequest"),
        (b"GET ftp://a/ HTTP/1.1\r\n\r\n", "!InvalidRequest"),
        (b"GET http:/a HTTP/1.1\r\n\r\n", "!InvalidRequest"),
        (b"GET httq://a HTTP/1.1\r\n\r\n", "!InvalidRequest"),
        (b"OPTIONS * HTTP/1.1\r\n\r\n", "!InvalidRequest"),
        (b"GET /\r\n\r\n", "!InvalidVersion"),
        (b"GET /\n\n", "!InvalidVersion"),
        (b"GET /  HTTP/1.1\r\n\r\n", "!InvalidVersion"),
        (b"GET / http/1.1\r\n\r\n", "!InvalidVersion"),
        (b"GET / HTTP/1.2\r\n\r\n", "!InvalidVersion"),
        (b"GET / HTTP/2.0\r\n\r\n", "!InvalidVersion"),
        (b"GET / HTTP/1.1\n\n", "!InvalidVersion"),
        (b"GET / HTTP/1.1 \r\n\r\n", "!InvalidVersion"),
    ]);
    check_each(&[
        (
            b"get / HTTP/1.1\r\n\r\n",
            "!UnknownMethod",
            "!InvalidMethod",
        ),
        (
            b"GeT / HTTP/1.1\r\n\r\n",
            "!UnknownMethod",
            "!InvalidMethod",
        ),
        (
            b"BREW / HTTP/1.1\r\n\r\n",
            "!UnknownMethod",
            "!InvalidMethod",
        ),
        (
            b"PRI / HTTP/1.1\r\n\r\n",
            "!UnknownMethod",
            "!InvalidMethod",
        ),
        (
            b"GET /a\tb HTTP/1.1\r\n\r\n",
            "!InvalidVersion",
            "!InvalidTarget",
        ),
        (
            b"connect a:80 HTTP/1.1\r\n\r\n",
            "!InvalidRequest",
            "!InvalidMethod",
        ),
        (
            b"\r\n\n\rGET / HTTP/1.1\r\n\r\n\r\n",
            "!InvalidMethod",
            "(GET / 1.1 [])",
        ),
        (
            b"GET / HTTP/1.1\r\n\r\n\nGET / HTTP/1.1\r\n\r\n",
            "(GET / 1.1 [])!InvalidMethod",
            "(GET / 1.1 [])(GET / 1.1 [])",
        ),
    ]);
}

#[test]
fn every_byte() {
    for (padding, byte) in paddings().flat_map(|p| (0..=255).map(move |byte| (p.clone(), byte))) {
        let with = |before: &[u8], after: &[u8]| [before, &padding, &[byte], after].concat();
        let is_ok = |setup: Setup, bytes: &[u8]| setup.feed(&[bytes]).ends_with(')');

        let method = with(b"a", b"a / HTTP/1.1\r\n\r\n");
        let is_method = byte.is_ascii_alphabetic() || byte == b'-';
        assert_eq!(
            SERVE.feed(&[&method]) == "!UnknownMethod",
            is_method,
            "{byte}"
        );

        let target = with(b"GET /", b"a HTTP/1.1\r\n\r\n");
        assert_eq!(is_ok(SERVE, &target), byte > b' ', "{byte}");
        let expected = match byte {
            b'!'..=b'~' => None,
            b' ' | b'\r' | b'\n' => Some("!InvalidVersion"),
            _ => Some("!InvalidTarget"),
        };
        let log = NODE.feed(&[&target]);
        assert_eq!(log.starts_with('!').then_some(&*log), expected);

        let name = with(b"GET / HTTP/1.1\r\na", b"a: a\r\n\r\n");
        let trailer_name = chunked(&with(b"0\r\na", b"a: a\r\n\r\n"));
        for (setup, bytes) in [(SERVE, &name), (INSECURE, &name), (NODE, &trailer_name)] {
            assert_eq!(is_ok(setup, bytes), is_token(byte) || byte == b':');
        }

        let value = with(b"GET / HTTP/1.1\r\na: a", b"a\r\n\r\n");
        let trailer_value = chunked(&with(b"0\r\na: a", b"a\r\n\r\n"));
        assert_eq!(is_ok(SERVE, &value), is_content(byte) || byte == 0x7f);
        for bytes in [&value, &trailer_value] {
            assert_eq!(is_ok(NODE, bytes), is_content(byte), "{byte}");
            let is_relaxed = !matches!(byte, 0 | b'\r' | b'\n');
            assert_eq!(is_ok(INSECURE, bytes), is_relaxed, "{byte}");
        }

        let extension = chunked(&with(b"1;", b"a\r\nx\r\n0\r\n\r\n"));
        for setup in [SERVE, NODE, INSECURE] {
            assert_eq!(is_ok(setup, &extension), byte > b' ', "{byte}");
        }
    }
}

#[test]
fn fields() {
    check_both(&[
        (b"GET / HTTP/1.1\r\na:b\r\n\r\n", "(GET / 1.1 [a=b])"),
        (
            b"GET / HTTP/1.1\r\nA:\r\nb: \r\n\r\n",
            "(GET / 1.1 [A= b=])",
        ),
        (
            b"GET / HTTP/1.1\r\na: \t b \tc\t \r\n\r\n",
            r"(GET / 1.1 [a=b \tc])",
        ),
        (
            b"GET / HTTP/1.1\r\na: \xa0b\xa0\r\n\r\n",
            r"(GET / 1.1 [a=\xa0b\xa0])",
        ),
        (b"GET / HTTP/1.1\r\na", "..head"),
        (b"GET / HTTP/1.1\r\nab", "..head"),
        (b"GET / HTTP/1.1\r\na:", "..head"),
        (b"GET / HTTP/1.1\r\na: b\r", "..head"),
        (b"GET / HTTP/1.1\r\na: b\r\n", "..head"),
        (b"GET / HTTP/1.1\r\na: b\r\n\r", "..head"),
        (b"GET / HTTP/1.1\r\n ", "..head"),
        (b"GET / HTTP/1.1\r\n a: b\r\n\r\n", "!InvalidField"),
        (b"GET / HTTP/1.1\r\n: b\r\n\r\n", "!InvalidField"),
        (b"GET / HTTP/1.1\r\na : b\r\n\r\n", "!InvalidField"),
        (b"GET / HTTP/1.1\r\na\r\n\r\n", "!InvalidField"),
        (b"GET / HTTP/1.1\r\na: b\n\r\n", "!InvalidField"),
        (b"GET / HTTP/1.1\r\na: b\r\n ", "!InvalidField"),
        (b"GET / HTTP/1.1\r\na: b\r\n c\r\n\r\n", "!InvalidField"),
        (b"GET / HTTP/1.1\r\na: b\r\n\n", "!InvalidField"),
        (b"GET / HTTP/1.1\r\n\rx", "!InvalidField"),
        (b"GET / HTTP/1.1\r\na: b\r\n\rx", "!InvalidRequest"),
        (b"GET / HTTP/1.1\r\na: b\rc", "!LfExpected"),
    ]);
}

#[test]
fn lookups() {
    let head = b"GET / HTTP/1.1\r\nHost: a\r\nx: b\r\nHOST: c\r\nEmpty:\r\nab: d\r\n\r\nrest";
    SERVE.with_request(head, |request| {
        assert_eq!(request.after_head(), b"rest");
        assert_eq!(request.field(b"host"), Some(&b"a"[..]));
        assert_eq!(request.field(b"x"), Some(&b"b"[..]));
        assert_eq!(request.field(b"ab"), Some(&b"d"[..]));
        assert_eq!(request.field(b"empty"), Some(&b""[..]));
        for name in [&b"y"[..], b"hosst", b"ba", b"cookie", b""] {
            assert_eq!(request.field(name), None);
        }
        assert_eq!(request.field_at(4).unwrap().name, b"ab");
        assert!(request.field_at(5).is_none());

        request.clear_field(b"host");
        request.clear_field(b"cookie");
        let fields = show_fields(request.fields());
        assert_eq!(fields, "[Host= x=b HOST=c Empty= ab=d]");
    });

    for (method, lowercase) in [
        ("GET", "get"),
        ("M-SEARCH", "m-search"),
        ("MKADDRESSBOOK", "mkaddressbook"),
    ] {
        let head = format!("{method} / HTTP/1.1\r\n\r\n");
        SERVE.with_request(head.as_bytes(), |request| {
            assert_eq!(request.lowercase_method(), lowercase.as_bytes());
        });
    }

    for (target, path) in [
        ("/", "/"),
        ("/a/b", "/a/b"),
        ("/a?b/c?d", "/a"),
        ("/?", "/"),
        ("/a#b", "/a#b"),
        ("/http://a/b", "/http://a/b"),
        ("http://a", "/"),
        ("http://a/", "/"),
        ("HTTP://a/b/c?d", "/b/c"),
        ("https://a?b/c", "/"),
        ("httpS:///a", "/a"),
    ] {
        for padding in paddings() {
            let longer = format!("a{}", show(&padding));
            let head = format!("GET {} HTTP/1.1\r\n\r\n", target.replace('a', &longer));
            SERVE.with_request(head.as_bytes(), |request| {
                assert_eq!(show(request.path()), path.replace('a', &longer));
            });
        }
    }
}

#[test]
fn elements_of_any_length() {
    for padding in paddings() {
        let long = format!("a{}", show(&padding));
        for (end, is_element) in [(",", true), ("", false)] {
            let fields = format!("Connection: {long}{end}close\r\n");
            NODE.with_request(&post(&fields, b""), |request| {
                let has_close = request.has_in_connection_or_proxy_connection(b"close");
                assert_eq!(has_close, is_element, "{fields}");
            });
            let fields = format!("Transfer-Encoding: {long}{end}chunked\r\n");
            let expected = if is_element {
                ")"
            } else {
                "!InvalidTransferEncoding"
            };
            assert_eq!(NODE.end(&post(&fields, b"0\r\n\r\n")), expected, "{fields}");
        }
    }
}

#[test]
fn host() {
    let [serve, node] = [SERVE, NODE].map(|setup| Setup {
        requires_host: true,
        ..setup
    });
    for (bytes, expected) in [
        (&b"GET / HTTP/1.1\r\nhost: a\r\n\r\n"[..], ")"),
        (b"GET / HTTP/1.1\r\nHost:\r\n\r\n", ")"),
        (b"GET / HTTP/1.0\r\n\r\n", ")"),
        (b"GET / HTTP/1.1\r\n\r\n", "!MissingHost"),
        (b"GET / HTTP/1.1\r\nUpgrade:\r\n\r\n", "!MissingHost"),
        (b"CONNECT a HTTP/1.1\r\n\r\n", "!MissingHost"),
        (b"CONNECT / HTTP/1.1\r\n\r\n", "!MissingHost"),
    ] {
        assert_eq!(serve.end(bytes), expected, "{}", show(bytes));
        assert_eq!(node.end(bytes), expected, "{}", show(bytes));
    }
}

#[test]
fn last_request() {
    for (fields, for_serve, for_node) in [
        ("Connection: close", true, true),
        ("connection: CLOSE", true, true),
        ("Connection: a, close\t, b", true, true),
        ("Connection: ,close,", true, true),
        ("Connection: a\r\nConnection: close", true, true),
        ("Proxy-Connection: close", false, true),
        (
            "Proxy-Connection: a\r\nProxy-Connection: close",
            false,
            true,
        ),
        ("Connection: closed", false, false),
        ("Connection: close a", false, false),
        ("Connection:", false, false),
        ("Connections: close", false, false),
    ] {
        let bytes = format!("GET / HTTP/1.1\r\n{fields}\r\n\r\nGET /a HTTP/1.1\r\n\r\n");
        let is_next_served = SERVE.parse(bytes.as_bytes()).ends_with("(GET /a 1.1 [])");
        assert_eq!(is_next_served, !for_serve, "{fields}");
        let expected = if for_node { "!ClosedConnection" } else { ")" };
        assert_eq!(NODE.end(bytes.as_bytes()), expected, "{fields}");
    }
    for (value, expected) in [
        ("close,\x01", "!ClosedConnection"),
        ("close\x01", ")"),
        ("\x01,close", ")"),
        ("\x7f,close", ")"),
    ] {
        let bytes = format!("GET / HTTP/1.1\r\nConnection: {value}\r\n\r\nGET / HTTP/1.1\r\n\r\n");
        assert_eq!(INSECURE.end(bytes.as_bytes()), expected, "{value}");
    }
    check_each(&[(
        b"GET / HTTP/1.0\r\nConnection: keep-alive\r\n\r\n\r\n?",
        "(GET / 1.0 [Connection=keep-alive] close)",
        "(GET / 1.0 [Connection=keep-alive] close)!ClosedConnection",
    )]);

    let closes = Setup {
        after_request: Then::Close,
        ..SERVE
    };
    let bytes = [post("Content-Length: 1\r\n", b"a"), post("", b"")].concat();
    assert_eq!(closes.parse(&bytes), "(POST / 1.1 [Content-Length=1] {a})");

    let mut server = SERVE.server();
    assert_eq!(SERVE.read(&mut server, b"GET / HT"), Outcome::Consumed);
    server.then(Then::Close);
    let outcome = SERVE.read(&mut server, b"TP/1.1\r\n\r\n");
    assert_eq!((outcome, &*server.log), (Outcome::Consumed, ""));
    assert!(!server.parser.unwrap().has_partial_head());
}

#[test]
fn content_length() {
    check_both(&[
        (
            &post("Content-Length: 3\r\n", b"abcGET / HTTP/1.1\r\n\r\n"),
            "(POST / 1.1 [Content-Length=3] {abc})(GET / 1.1 [])",
        ),
        (
            &post("Content-Length: 0\r\n", b"GET / HTTP/1.1\r\n\r\n"),
            "(POST / 1.1 [Content-Length=0])(GET / 1.1 [])",
        ),
        (
            &post("content-length: 10\r\n", b"012345678"),
            "(POST / 1.1 [content-length=10] {012345678}..body",
        ),
        (
            &post("Content-Length: 1\r\ncontent-length: 1\r\n", b"a"),
            "(POST / 1.1 [Content-Length=1 content-length=1] {a})",
        ),
    ]);
    for (value, expected) in [
        ("000000000000000001", "..body"),
        ("576460752303423487", "..body"),
        ("576460752303423488", "!InvalidContentLength"),
        ("0000000000000000001", "!InvalidContentLength"),
        ("", "!InvalidContentLength"),
        ("+1", "!InvalidContentLength"),
        ("-1", "!InvalidContentLength"),
        ("1 1", "!InvalidContentLength"),
        ("1,1", "!InvalidContentLength"),
        ("a", "!InvalidContentLength"),
        ("1\r\nContent-Length: 2", "!InvalidContentLength"),
        ("1\r\nContent-Length: 01", "!InvalidContentLength"),
        ("1\r\nContent-Length:", "!InvalidContentLength"),
    ] {
        let bytes = post(&format!("Content-Length: {value}\r\n"), b"");
        for setup in [SERVE, NODE, INSECURE] {
            assert_eq!(setup.end(&bytes), expected, "{value}");
        }
    }

    // `closeIdleConnections()` leaves it alone.
    let mut server = NODE.server();
    NODE.read(&mut server, &post("Content-Length: a\r\n", b""));
    assert!(server.parser.unwrap().has_incomplete_body());
}

#[test]
fn transfer_encoding() {
    const REJECTED: &str = "!InvalidTransferEncoding";
    const AFTER_DISPATCH: &str = " coded!InvalidTransferEncoding";
    const CHUNKS: &str = " coded {a})";
    const UNTIL_EOF: &str = r" coded {1\r\na\r\n0\r\n\r\n}..eof";
    const NO_BODY: &str = ")!InvalidMethod";
    const ONE_BYTE: &str = " {1})!InvalidMethod";
    const TE: &str = "\r\nTransfer-Encoding:";
    const CL: &str = "\r\nContent-Length: 1";
    const UPGRADE: &str = "\r\nUpgrade: a\r\nConnection: upgrade";
    const LAST: &str = " last)!ClosedConnection";

    for (fields, serve, node, insecure) in [
        (&[TE, "chunked"][..], CHUNKS, CHUNKS, CHUNKS),
        (&[TE, "CHUNKED"], CHUNKS, CHUNKS, CHUNKS),
        (&[TE, ", chunked"], CHUNKS, CHUNKS, CHUNKS),
        (&[TE, TE, "chunked"], CHUNKS, CHUNKS, CHUNKS),
        (&[TE, "chunked,"], CHUNKS, CHUNKS, UNTIL_EOF),
        (&[TE, "gzip,\tchunked"], REJECTED, CHUNKS, CHUNKS),
        (&[TE, "gzip", TE, "chunked"], REJECTED, CHUNKS, CHUNKS),
        (&[TE, "chunked, chunked"], REJECTED, REJECTED, CHUNKS),
        (&[TE, "chunked", TE, "chunked"], REJECTED, REJECTED, CHUNKS),
        (&[TE, "chunked", TE], REJECTED, REJECTED, CHUNKS),
        (&[TE, "chunked, gzip"], REJECTED, REJECTED, UNTIL_EOF),
        (&[TE, "chunked, a, b"], REJECTED, REJECTED, UNTIL_EOF),
        (&[TE, "chunked, a", TE], REJECTED, REJECTED, UNTIL_EOF),
        (&[TE, "gzip"], REJECTED, AFTER_DISPATCH, UNTIL_EOF),
        (&[TE, "chunkedchunked"], REJECTED, AFTER_DISPATCH, UNTIL_EOF),
        (&[TE, ","], REJECTED, AFTER_DISPATCH, UNTIL_EOF),
        (&[TE], REJECTED, NO_BODY, NO_BODY),
        (&[TE, CL], REJECTED, ONE_BYTE, ONE_BYTE),
        (&[CL, TE], REJECTED, REJECTED, ONE_BYTE),
        (&[CL, TE, "chunked"], REJECTED, REJECTED, REJECTED),
        (&[TE, "chunked", CL], REJECTED, REJECTED, REJECTED),
        (&[TE, "chunked", UPGRADE], CHUNKS, CHUNKS, CHUNKS),
        (&[TE, "gzip", UPGRADE], REJECTED, LAST, LAST),
        (&[TE, "gzip\r\nUpgrade:", UPGRADE], REJECTED, LAST, LAST),
        (
            &[TE, "gzip\r\nUpgrade: a\r\nProxy-Connection: upgrade"],
            REJECTED,
            LAST,
            LAST,
        ),
        (
            &[TE, "gzip\r\nUpgrade:\r\nConnection: upgrade"],
            REJECTED,
            AFTER_DISPATCH,
            UNTIL_EOF,
        ),
        (
            &[TE, "gzip\r\nUpgrade: a"],
            REJECTED,
            AFTER_DISPATCH,
            UNTIL_EOF,
        ),
    ] {
        let fields = fields.concat();
        let bytes = format!("POST / HTTP/1.1{fields}\r\n\r\n1\r\na\r\n0\r\n\r\n");
        for (setup, expected) in [(SERVE, serve), (NODE, node), (INSECURE, insecure)] {
            let log = setup.parse(bytes.as_bytes());
            let log = log.trim_start_matches(|char| char != ']' && char != '!');
            assert_eq!(log.trim_start_matches(']'), expected, "{fields}");
        }
    }

    check_each(&[
        (
            b"POST / HTTP/1.0\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
            REJECTED,
            "(POST / 1.0 [Transfer-Encoding=chunked] close coded)",
        ),
        (
            b"CONNECT a HTTP/1.1\r\nTransfer-Encoding: gzip\r\n\r\nb",
            REJECTED,
            "(CONNECT a 1.1 [Transfer-Encoding=gzip] tunnel {b}..body",
        ),
    ]);
}

#[test]
fn chunks() {
    for (body, expected) in [
        (&b"0\r\n\r\n"[..], ")"),
        (b"000\r\n\r\n", ")"),
        (b"0;a=b\r\n\r\n", ")"),
        (b"1\r\na\r\n02;\r\nbc\r\n0\r\n\r\n", " {abc})"),
        (b"2\r\n\r\n\r\n0\r\n\r\n", r" {\r\n})"),
        (
            b"a\r\n0123456789\r\nA\r\n0123456789\r\n0\r\n\r\n",
            " {01234567890123456789})",
        ),
        (
            b"10\r\n0123456789abcdef\r\n0\r\n\r\nGET / HTTP/1.1\r\n\r\n",
            " {0123456789abcdef})(GET / 1.1 [])",
        ),
        (b"", "..body"),
        (b"1", "..body"),
        (b"1;a", "..body"),
        (b"1\r", "..body"),
        (b"2\r\na", " {a}..body"),
        (b"1\r\na\r", " {a}..body"),
        (b"000000000000000000001\r\na", " {a}..body"),
        (b"3ffffffffffffff\r\na", " {a}..body"),
        (b"400000000000000", "!InvalidChunkedEncoding"),
        (b"\r\n", "!InvalidChunkedEncoding"),
        (b";a\r\n", "!InvalidChunkedEncoding"),
        (b"g", "!InvalidChunkedEncoding"),
        (b"-1", "!InvalidChunkedEncoding"),
        (b" 1", "!InvalidChunkedEncoding"),
        (b"1 ", "!InvalidChunkedEncoding"),
        (b"1\n", "!InvalidChunkedEncoding"),
        (b"1\rx", "!InvalidChunkedEncoding"),
        (b"1\r\r", "!InvalidChunkedEncoding"),
        (b"1\r\na\r\n\r\n", " {a}!InvalidChunkedEncoding"),
    ] {
        check_both(&[(&chunked(body), &[CHUNKED, expected].concat())]);
    }
    for body in [&b"1\r\nab"[..], b"1\r\na\n", b"1\r\na\rb", b"1\r\na\r\r"] {
        for setup in [SERVE, NODE, INSECURE] {
            assert_eq!(setup.end(&chunked(body)), "!ChunkTerminatorExpected");
        }
    }
    let log = NODE.feed(&[&chunked(b"1\r\nabcd")]);
    assert_eq!(log, [CHUNKED, "!ChunkTerminatorExpected"].concat());

    let extension = |len: usize| [b";".as_slice(), &vec![b'a'; len - 1]].concat();
    let (full, over) = (extension(16 * 1024), extension(16 * 1024 + 1));
    for (body, expected) in [
        (
            &[b"1", &*full, b"\r\na\r\n0", &*full, b"\r\n\r\n"][..],
            " {a})",
        ),
        (&[b"1", &*over], "!ChunkExtensionsTooLarge"),
        (&[b"1", &*over, b"\r\na\r\n"], "!ChunkExtensionsTooLarge"),
        (&[b"0", &*over, b"\r\n\r\n"], "!ChunkExtensionsTooLarge"),
    ] {
        let bytes = chunked(&body.concat());
        for setup in [SERVE, NODE] {
            for len in [1, 1000, bytes.len()] {
                let log = setup.feed(&bytes.chunks(len).collect::<Vec<_>>());
                assert_eq!(log, [CHUNKED, expected].concat());
            }
        }
    }
}

#[test]
fn trailers() {
    const NONE_ALLOWED: &str = ")!InvalidChunkedEncoding";
    for (body, serve, node, insecure) in [
        (&b"0\r\n"[..], ")..body", "..body", "..body"),
        (b"0\r\n\r", ")..body", "..body", "..body"),
        (b"0\r\na: b\r\n", NONE_ALLOWED, "..body", "..body"),
        (
            b"0\r\na: b\r\nC:\t d \r\n\r\nGET / HTTP/1.1\r\n\r\n",
            NONE_ALLOWED,
            " [a=b C=d])(GET / 1.1 [])",
            " [a=b C=d])(GET / 1.1 [])",
        ),
        (
            b"0\r\nContent-Length: 1\r\n\r\n",
            NONE_ALLOWED,
            "!ContentLengthInTrailers",
            " [Content-Length=1])",
        ),
        (
            b"0\r\na: b\r\nTransfer-Encoding: a\r\n\r\n",
            NONE_ALLOWED,
            "!InvalidTransferEncoding",
            " [a=b Transfer-Encoding=a])",
        ),
        (
            b"0\r\na: b\r\n: c\r\n\r\n",
            NONE_ALLOWED,
            "!InvalidField",
            "!InvalidField",
        ),
        (
            b"0\r\na: b\rc\r\n\r\n",
            NONE_ALLOWED,
            "!InvalidField",
            "!InvalidField",
        ),
        (
            b"0\r\n\rx\r\n\r\n",
            NONE_ALLOWED,
            "!InvalidField",
            "!InvalidField",
        ),
        (
            b"0\r\n\n",
            NONE_ALLOWED,
            "!InvalidChunkedEncoding",
            "!InvalidChunkedEncoding",
        ),
        (
            b"0\r\na: b\n",
            NONE_ALLOWED,
            "!InvalidChunkedEncoding",
            "!InvalidChunkedEncoding",
        ),
    ] {
        for (setup, expected) in [(SERVE, serve), (NODE, node), (INSECURE, insecure)] {
            let log = setup.parse(&chunked(body));
            assert_eq!(log, [CHUNKED, expected].concat(), "{}", show(body));
        }
    }

    let leaves_them = Setup {
        takes_trailers: false,
        ..NODE
    };
    let mut server = leaves_them.server();
    leaves_them.read(&mut server, &chunked(b"0\r\na: b\r\n\r\n"));
    leaves_them.read(&mut server, &chunked(b"0\r\nc: d\r\n\r\n"));
    assert_eq!(server.parser.unwrap().take_trailers(), b"c: d\r\n\r\n");

    let section = |count| [b"a: b\r\n".repeat(count), b"\r\n".to_vec()].concat();
    assert_eq!(parse_trailers(&section(198), false).len(), 198);
    assert_eq!(parse_trailers(&section(200), false).len(), 199);
    assert!(parse_trailers(b"a: b\r\n", false).is_empty());
    assert!(parse_trailers(b"", false).is_empty());
}

#[test]
fn limits() {
    const TOO_LARGE: &str = "!HeadTooLarge";
    let get = |fields: &[u8]| [b"GET / HTTP/1.1\r\n", fields, b"\r\n"].concat();

    for (max_headers_count, max) in [(0, 198), (2000, 198), (198, 198), (2, 2)] {
        for setup in [SERVE, NODE] {
            let setup = Setup {
                max_headers_count,
                ..setup
            };
            assert_eq!(setup.end(&get(&b"a:\r\n".repeat(max))), ")");
            assert_eq!(setup.end(&get(&b"a:\r\n".repeat(max + 1))), TOO_LARGE);
        }
    }
    let two = Setup {
        max_headers_count: 2,
        ..NODE
    };
    assert_eq!(two.end(&chunked(b"0\r\na:\r\na:\r\n\r\n")), ")");
    let three = chunked(b"0\r\na:\r\na:\r\na:\r\n\r\n");
    assert_eq!(two.end(&three), "!TrailersTooLarge");

    // The target, the names and the values from their first byte that is not blank.
    let bytes = b"GET /ab HTTP/1.1\r\ncd:   e \r\nf: g\r\n\r\n";
    for setup in [SERVE, NODE] {
        let within = |max_header_size| Setup {
            max_header_size,
            default_max_head_len: 1,
            ..setup
        };
        assert_eq!(within(10).end(bytes), ")");
        for max in 1..10 {
            assert_eq!(within(max).end(bytes), TOO_LARGE);
        }
        assert_eq!(within(3).end(b"GET /ab HTTP/1.1\r\n"), "..head");
        assert_eq!(within(3).end(b"GET /ab HTTP/1.0\r\n"), "..head");
        assert_eq!(within(3).end(b"GET /abc"), TOO_LARGE);
        let log = within(3).feed(&[b"GET /abcdefghijklmnop\x01"]);
        let expected = if setup.is_node {
            "!InvalidTarget"
        } else {
            TOO_LARGE
        };
        assert_eq!(log, expected);
        assert_eq!(within(3).end(b"GET / HTTP/1.1\r\nab"), TOO_LARGE);
        assert_eq!(within(3).end(b"GET / HTTP/1.1\r\na:b"), TOO_LARGE);

        let of_len = |len: usize| get(&[b"a:", &*vec![b' '; len - 22], b"\r\n"].concat());
        assert_eq!(within(10).end(&of_len(874)), ")");
        assert_eq!(within(10).end(&of_len(875)), TOO_LARGE);
        assert_eq!(within(u64::MAX).end(&of_len(875)), ")");

        let by_default = Setup {
            max_header_size: 0,
            default_max_head_len: 100,
            ..setup
        };
        assert_eq!(by_default.end(&of_len(100)), ")");
        assert_eq!(by_default.end(&of_len(101)), TOO_LARGE);
        assert_eq!(by_default.end(&of_len(101)[..99]), "..head");
        assert_eq!(by_default.end(&of_len(101)[..100]), TOO_LARGE);
        assert_eq!(by_default.end(&[of_len(100), of_len(100)].concat()), ")");

        if setup.is_node {
            let of_len =
                |len: usize| chunked(&[b"0\r\na:", &*vec![b' '; len - 6], b"\r\n\r\n"].concat());
            assert_eq!(by_default.end(&of_len(100)), ")");
            assert_eq!(by_default.end(&of_len(101)), "!TrailersTooLarge");
        }
    }
}

#[test]
fn tunnels() {
    let bytes = b"CONNECT a HTTP/1.1\r\nContent-Length: 1\r\n\r\n\r\nGET / HTTP/1.1\r\n\r\n";
    let expected = r"(CONNECT a 1.1 [Content-Length=1] tunnel {\r\nGET / HTTP/1.1\r\n\r\n}..body";
    assert_eq!(NODE.parse(bytes), expected);

    // `Bun.serve()` drops what it parsed the head from.
    let log = SERVE.feed(&[b"CONNECT a HTTP/1.1\r\n\r\nab", b"cd"]);
    assert_eq!(log, "(CONNECT a 1.1 [] tunnel {cd}..body");
    let small = Setup {
        default_max_head_len: 23,
        ..SERVE
    };
    let log = small.feed(&[b"CONNECT a HTTP/1.1\r\n", b"\r\nab", b"cd"]);
    assert_eq!(log, "(CONNECT a 1.1 [] tunnel {bcd}..body");

    let upgrade = b"GET / HTTP/1.1\r\nConnection: close\r\n\r\n\r\nab";
    let at_once = Setup {
        after_request: Then::Tunnel,
        ..NODE
    };
    let expected = r"(GET / 1.1 [Connection=close] close {\r\nab}..body";
    assert_eq!(at_once.parse(upgrade), expected);

    let after_body = Setup {
        after_body: Then::Tunnel,
        ..NODE
    };
    let expected = r"(GET / 1.1 [Connection=close] close) {\r\nab}";
    assert_eq!(after_body.parse(upgrade), expected);
    let log = after_body.parse(&chunked(b"1\r\na\r\n0\r\n\r\n\r\nb"));
    assert_eq!(log, [CHUNKED, r" {a}) {\r\nb}"].concat());

    let dropped = Setup {
        after_data: Then::Drop,
        ..after_body
    };
    let expected = r"(GET / 1.1 [Connection=close] close) {\r\nab}+";
    assert_eq!(dropped.feed(&[upgrade]), expected);
}

#[test]
fn stopped() {
    for setup in [SERVE, NODE] {
        let after_request = Setup {
            after_request: Then::Drop,
            ..setup
        };
        let log = after_request.parse(b"GET / HTTP/1.1\r\n\r\nab");
        assert_eq!(log, "(GET / 1.1 []+ab");
        let log = after_request.parse(&post("Content-Length: 0\r\n", b"ab"));
        assert_eq!(log, "(POST / 1.1 [Content-Length=0]+ab");
        // What the read has of a body is not for the next protocol.
        let log = after_request.feed(&[&post("Content-Length: 1\r\n", b"ab")]);
        assert_eq!(log, "(POST / 1.1 [Content-Length=1]+");
        let log = after_request.feed(&[&chunked(b"0\r\n\r\nab")]);
        assert_eq!(log, [CHUNKED, "+"].concat());

        let after_data = Setup {
            after_data: Then::Drop,
            ..setup
        };
        let log = after_data.feed(&[&chunked(b"1\r\na\r\n0\r\n\r\n")]);
        assert_eq!(log, [CHUNKED, " {a}+"].concat());

        let after_body = Setup {
            after_body: Then::Drop,
            ..setup
        };
        let log = after_body.parse(&post("Content-Length: 1\r\n", b"ab"));
        assert_eq!(log, "(POST / 1.1 [Content-Length=1] {a})+b");
        let log = after_body.parse(&chunked(b"0\r\n\r\nab"));
        let rest = if setup.is_node { ")+ab" } else { r")+\r\nab" };
        assert_eq!(log, [CHUNKED, rest].concat());
    }

    let until_eof = Setup {
        after_data: Then::Drop,
        ..INSECURE
    };
    let log = until_eof.feed(&[&post("Transfer-Encoding: a\r\n", b"ab")]);
    assert_eq!(log, "(POST / 1.1 [Transfer-Encoding=a] coded {ab}+");
}

#[test]
fn responses() {
    for (error, status) in [
        (RequestError::InvalidRequest, "400 Bad Request"),
        (
            RequestError::ChunkExtensionsTooLarge,
            "413 Payload Too Large",
        ),
        (
            RequestError::HeadTooLarge,
            "431 Request Header Fields Too Large",
        ),
        (
            RequestError::InvalidVersion,
            "505 HTTP Version Not Supported",
        ),
    ] {
        let expected = format!("HTTP/1.1 {status}\r\nConnection: close\r\n\r\n");
        assert_eq!(error.response(), expected.as_bytes());
    }
}
