//! What oxlint says about a configuration file that is no JSON. It takes out the comments with `json-strip-comments` and has
//! `serde_json` read the rest: the words and the places are theirs.

use bun_core::strings;

/// What `json_strip_comments::strip` leaves: a blank for each byte of a comment, but for the line break that ends one, and for a
/// comma before a `}` or a `]`. `None`: a `/` starts no comment.
fn without_comments(text: &[u8]) -> Option<Vec<u8>> {
    enum State {
        Top,
        String,
        Escape,
        Slash,
        Block,
        /// After a `*` in one.
        BlockEnd,
        Line,
    }
    let mut out = text.to_vec();
    let mut state = State::Top;
    // The comma after which there were only blanks and comments.
    let mut comma = None;
    for (at, &byte) in text.iter().enumerate() {
        let is_in_comment = !matches!(state, State::Top | State::String | State::Escape);
        state = match (state, byte) {
            (State::Top, b' ' | b'\t' | b'\n' | b'\r') => State::Top,
            (State::Top, b'/') => State::Slash,
            (State::Top, b'#') => State::Line,
            (State::Top, _) => {
                let before = comma.take();
                match (before, byte) {
                    (Some(comma), b'}' | b']') => out[comma] = b' ',
                    (None, b',') => comma = Some(at),
                    _ => {}
                }
                match byte {
                    b'"' => State::String,
                    _ => State::Top,
                }
            }
            (State::String, b'"') => State::Top,
            (State::String, b'\\') => State::Escape,
            (State::String | State::Escape, _) => State::String,
            (State::Slash, b'*') => State::Block,
            (State::Slash, b'/') => State::Line,
            (State::Slash, _) => return None,
            (State::Block | State::BlockEnd, b'*') => State::BlockEnd,
            (State::BlockEnd, b'/') => State::Top,
            (State::Block | State::BlockEnd, _) => State::Block,
            (State::Line, b'\n') => {
                state = State::Top;
                continue;
            }
            (State::Line, _) => State::Line,
        };
        if is_in_comment || matches!(state, State::Slash | State::Line) {
            out[at] = b' ';
        }
    }
    Some(out)
}

/// What is wrong, and how much of the text was read.
type Failure = (&'static str, usize);

const EOF_IN_VALUE: &str = "EOF while parsing a value";
const EOF_IN_OBJECT: &str = "EOF while parsing an object";
const EOF_IN_STRING: &str = "EOF while parsing a string";
const INVALID_NUMBER: &str = "invalid number";
const NO_KEY: &str = "key must be a string";
const LONE_SURROGATE: &str = "lone leading surrogate in hex escape";

/// `serde_json::Deserializer`, as far as it refuses.
struct Reader<'t> {
    text: &'t [u8],
    at: usize,
    remaining_depth: u8,
}

impl Reader<'_> {
    fn peek(&self) -> Option<u8> {
        self.text.get(self.at).copied()
    }

    fn next(&mut self) -> Option<u8> {
        let byte = self.peek()?;
        self.at += 1;
        Some(byte)
    }

    /// About what is next.
    fn peek_error<T>(&self, why: &'static str) -> Result<T, Failure> {
        Err((why, self.text.len().min(self.at + 1)))
    }

    /// About what was read last.
    fn error<T>(&self, why: &'static str) -> Result<T, Failure> {
        Err((why, self.at))
    }

    /// What is next after the white space.
    fn parse_whitespace(&mut self) -> Option<u8> {
        while matches!(self.peek(), Some(b' ' | b'\n' | b'\t' | b'\r')) {
            self.at += 1;
        }
        self.peek()
    }

    fn value(&mut self) -> Result<(), Failure> {
        let Some(first) = self.parse_whitespace() else {
            return self.peek_error(EOF_IN_VALUE);
        };
        match first {
            b'n' => self.ident(b"ull"),
            b't' => self.ident(b"rue"),
            b'f' => self.ident(b"alse"),
            b'-' => {
                self.at += 1;
                self.number()
            }
            b'0'..=b'9' => self.number(),
            b'"' => {
                self.at += 1;
                self.string()
            }
            b'[' | b'{' => {
                self.remaining_depth -= 1;
                if self.remaining_depth == 0 {
                    return self.peek_error("recursion limit exceeded");
                }
                self.at += 1;
                match first {
                    b'[' => self.list()?,
                    _ => self.map()?,
                }
                self.remaining_depth += 1;
                Ok(())
            }
            _ => self.peek_error("expected value"),
        }
    }

    /// After its first letter.
    fn ident(&mut self, rest: &[u8]) -> Result<(), Failure> {
        self.at += 1;
        for &expected in rest {
            match self.next() {
                None => return self.error(EOF_IN_VALUE),
                Some(byte) if byte != expected => return self.error("expected ident"),
                Some(_) => {}
            }
        }
        Ok(())
    }

    /// How many there are.
    fn digits(&mut self) -> usize {
        let start = self.at;
        while self.peek().is_some_and(|it| it.is_ascii_digit()) {
            self.at += 1;
        }
        self.at - start
    }

    /// After its sign.
    fn number(&mut self) -> Result<(), Failure> {
        let start = self.at;
        match self.next() {
            None => return self.error(EOF_IN_VALUE),
            Some(b'0') if self.peek().is_some_and(|it| it.is_ascii_digit()) => {
                return self.peek_error(INVALID_NUMBER);
            }
            Some(b'0') => {}
            Some(b'1'..=b'9') => _ = self.digits(),
            Some(_) => return self.error(INVALID_NUMBER),
        }
        if self.peek() == Some(b'.') {
            self.at += 1;
            if self.digits() == 0 {
                return self.peek_error(match self.peek() {
                    Some(_) => INVALID_NUMBER,
                    None => EOF_IN_VALUE,
                });
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.at += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.at += 1;
            }
            match self.next() {
                None => return self.error(EOF_IN_VALUE),
                Some(byte) if !byte.is_ascii_digit() => return self.error(INVALID_NUMBER),
                Some(_) => _ = self.digits(),
            }
        }
        let written = self.text.get(start..self.at).unwrap_or_default();
        let number = std::str::from_utf8(written)
            .ok()
            .and_then(|it| it.parse::<f64>().ok());
        match number {
            Some(it) if it.is_infinite() => self.error("number out of range"),
            _ => Ok(()),
        }
    }

    /// After the quote.
    fn string(&mut self) -> Result<(), Failure> {
        loop {
            match self.next() {
                None => return self.error(EOF_IN_STRING),
                Some(b'"') => return Ok(()),
                Some(b'\\') => self.escape()?,
                Some(0..=0x1F) => {
                    let why = "control character (\\u0000-\\u001F) found while parsing a string";
                    return self.error(why);
                }
                Some(_) => {}
            }
        }
    }

    /// After the backslash.
    fn escape(&mut self) -> Result<(), Failure> {
        match self.next() {
            None => self.error(EOF_IN_STRING),
            Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => Ok(()),
            Some(b'u') => match self.hex()? {
                0xDC00..=0xDFFF => self.error(LONE_SURROGATE),
                0xD800..=0xDBFF => {
                    for expected in *b"\\u" {
                        match self.next() {
                            None => return self.error(EOF_IN_STRING),
                            Some(byte) if byte != expected => {
                                return self.error("unexpected end of hex escape");
                            }
                            Some(_) => {}
                        }
                    }
                    match self.hex()? {
                        0xDC00..=0xDFFF => Ok(()),
                        _ => self.error(LONE_SURROGATE),
                    }
                }
                _ => Ok(()),
            },
            Some(_) => self.error("invalid escape"),
        }
    }

    /// The four digits after `\u`.
    fn hex(&mut self) -> Result<u16, Failure> {
        let Some(digits) = self.text.get(self.at..self.at + 4) else {
            self.at = self.text.len();
            return self.error(EOF_IN_STRING);
        };
        self.at += 4;
        let text = std::str::from_utf8(digits).ok();
        let text = text.filter(|_| digits.iter().all(u8::is_ascii_hexdigit));
        match text.and_then(|it| u16::from_str_radix(it, 16).ok()) {
            Some(unit) => Ok(unit),
            None => self.error("invalid escape"),
        }
    }

    /// After the `[`.
    fn list(&mut self) -> Result<(), Failure> {
        let mut is_first = true;
        loop {
            match self.parse_whitespace() {
                None => return self.peek_error("EOF while parsing a list"),
                Some(b']') => {
                    self.at += 1;
                    return Ok(());
                }
                Some(_) if is_first => {}
                Some(b',') => {
                    self.at += 1;
                    match self.parse_whitespace() {
                        None => return self.peek_error(EOF_IN_VALUE),
                        Some(b']') => return self.peek_error("trailing comma"),
                        Some(_) => {}
                    }
                }
                Some(_) => return self.peek_error("expected `,` or `]`"),
            }
            is_first = false;
            self.value()?;
        }
    }

    /// After the `{`.
    fn map(&mut self) -> Result<(), Failure> {
        let mut is_first = true;
        loop {
            match self.parse_whitespace() {
                None => return self.peek_error(EOF_IN_OBJECT),
                Some(b'}') => {
                    self.at += 1;
                    return Ok(());
                }
                Some(b'"') if is_first => {}
                Some(_) if is_first => return self.peek_error(NO_KEY),
                Some(b',') => {
                    self.at += 1;
                    match self.parse_whitespace() {
                        None => return self.peek_error(EOF_IN_VALUE),
                        Some(b'"') => {}
                        Some(b'}') => return self.peek_error("trailing comma"),
                        Some(_) => return self.peek_error(NO_KEY),
                    }
                }
                Some(_) => return self.peek_error("expected `,` or `}`"),
            }
            is_first = false;
            self.at += 1;
            self.string()?;
            match self.parse_whitespace() {
                None => return self.peek_error(EOF_IN_OBJECT),
                Some(b':') => self.at += 1,
                Some(_) => return self.peek_error("expected `:`"),
            }
            self.value()?;
        }
    }
}

/// The JSON in `text`, which the file at `path` has. `Err`: what oxlint refuses the file with, because there is none for it.
pub fn json_for_oxlint(path: &[u8], text: &[u8]) -> Result<Vec<u8>, Vec<u8>> {
    if std::str::from_utf8(text).is_err() {
        let why = br#" with error Custom { kind: InvalidData, error: "stream did not contain valid UTF-8" }"#;
        return Err([b"Failed to parse config ", path, why].concat());
    }
    let Some(text) = without_comments(text) else {
        let why: [&[u8]; 3] = [b"Failed to parse jsonc file ", path, b": Kind(InvalidData)"];
        return Err(why.concat());
    };
    let mut reader = Reader {
        text: &text,
        at: 0,
        remaining_depth: 128,
    };
    let read = reader
        .value()
        .and_then(|()| match reader.parse_whitespace() {
            Some(_) => reader.peek_error("trailing characters"),
            None => Ok(()),
        });
    let Err((why, end)) = read else {
        return Ok(text);
    };
    let before = text.get(..end).unwrap_or_default();
    let line_start = strings::last_index_of_char(before, b'\n').map_or(0, |it| it + 1);
    let line = 1 + strings::count_char(before, b'\n');
    let place = format!(" at line {line} column {}", end - line_start);
    let start: &[u8] = b"Failed to parse oxlint config ";
    Err([start, path, b".\n", why.as_bytes(), place.as_bytes()].concat())
}
