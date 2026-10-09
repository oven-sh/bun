//! `levn.parse("Object", text)`: the liberal notation that ESLint reads an `/* eslint .. */`
//! comment in before it tries JSON.

use crate::options::Json;

const MAX_DEPTH: usize = 128;

fn is_special(byte: u8) -> bool {
    matches!(byte, b'[' | b']' | b'(' | b')' | b'}' | b'{' | b':' | b',')
}

/// The end of `"(?:\\"|[^"])*"` for the quote that `text` starts with. An escaped quote closes it
/// if nothing else does.
fn quoted_end(text: &[u8]) -> Option<usize> {
    let quote = *text.first()?;
    let (mut at, mut last_escaped) = (1, None);
    while let Some(&byte) = text.get(at) {
        if byte == b'\\' && text.get(at + 1) == Some(&quote) {
            last_escaped = Some(at + 2);
            at += 2;
        } else if byte == quote {
            return Some(at + 1);
        } else {
            at += 1;
        }
    }
    last_escaped
}

/// The end of `#.*#`.
fn date_end(text: &[u8]) -> Option<usize> {
    let mut end = 1;
    while end < text.len()
        && !matches!(
            text[end..],
            [b'\n' | b'\r', ..] | [0xE2, 0x80, 0xA8 | 0xA9, ..]
        )
    {
        end += 1;
    }
    bun_core::strings::last_index_of_char(&text[1..end], b'#').map(|i| i + 2)
}

/// `[^\s<special>](?:\s*[^\s<special>]+)*`
fn word_end(text: &[u8]) -> usize {
    let (mut at, mut end) = (0, 0);
    while at < text.len() && !is_special(text[at]) {
        match bun_core::strings::js_whitespace_len(&text[at..]) {
            0 => {
                at += bun_core::lexer::char_and_size(&text[at..], 0).1.max(1);
                end = at;
            }
            n => at += n,
        }
    }
    end
}

fn tokenize(text: &[u8]) -> Vec<&[u8]> {
    let (mut tokens, mut at) = (Vec::new(), 0);
    while at < text.len() {
        let rest = &text[at..];
        let space = bun_core::strings::js_whitespace_len(rest);
        if space > 0 {
            at += space;
            continue;
        }
        let end = match rest[0] {
            b'"' | b'\'' => quoted_end(rest),
            b'/' => quoted_end(rest).map(|end| {
                end + rest[end..]
                    .iter()
                    .take_while(|b| b.is_ascii_alphabetic())
                    .count()
            }),
            b'#' => date_end(rest),
            byte if is_special(byte) => Some(1),
            _ => None,
        };
        let end = end.unwrap_or_else(|| word_end(rest));
        tokens.push(&rest[..end]);
        at += end;
    }
    tokens
}

/// What `parse-string.js` makes of the tokens.
enum Node {
    Value(Vec<u8>),
    List(Vec<Node>),
    Fields(Vec<(Vec<u8>, Node)>),
}

struct Tokens<'t> {
    tokens: Vec<&'t [u8]>,
    at: usize,
}

impl<'t> Tokens<'t> {
    fn peek(&self) -> Option<&'t [u8]> {
        self.tokens.get(self.at).copied()
    }

    fn maybe_consume(&mut self, op: &[u8]) -> bool {
        let found = self.peek() == Some(op);
        self.at += usize::from(found);
        found
    }

    fn consume(&mut self, op: &[u8]) -> Option<()> {
        self.maybe_consume(op).then_some(())
    }

    fn list(&mut self, close: &[u8], until: &[&[u8]], depth: usize) -> Option<Node> {
        self.at += 1;
        let mut items = Vec::new();
        while self.peek().is_some_and(|token| token != close) {
            items.push(self.element(until, depth)?);
            self.maybe_consume(b",");
        }
        self.consume(close)?;
        Some(Node::List(items))
    }

    fn fields(&mut self, has_delimiters: bool, depth: usize) -> Option<Node> {
        if has_delimiters {
            self.consume(b"{")?;
        }
        let until: &[&[u8]] = if has_delimiters {
            &[b",", b"}"]
        } else {
            &[b","]
        };
        let mut fields: Vec<(Vec<u8>, Node)> = Vec::new();
        while self
            .peek()
            .is_some_and(|token| !has_delimiters || token != b"}")
        {
            let key = self.value(&[b":"]);
            self.consume(b":")?;
            let value = self.element(until, depth)?;
            match fields.iter_mut().find(|it| it.0 == key) {
                Some(field) => field.1 = value,
                None => fields.push((key, value)),
            }
            self.maybe_consume(b",");
        }
        if has_delimiters {
            self.consume(b"}")?;
        }
        Some(Node::Fields(fields))
    }

    fn value(&mut self, until: &[&[u8]]) -> Vec<u8> {
        let mut out = Vec::new();
        while let Some(token) = self.peek()
            && !until.contains(&token)
        {
            out.extend_from_slice(token);
            self.at += 1;
        }
        out
    }

    fn element(&mut self, until: &[&[u8]], depth: usize) -> Option<Node> {
        if depth > MAX_DEPTH {
            return None;
        }
        match self.peek() {
            Some(b"[") => self.list(b"]", &[b",", b"]"], depth + 1),
            Some(b"(") => self.list(b")", &[b",", b")"], depth + 1),
            Some(b"{") => self.fields(true, depth + 1),
            _ => Some(Node::Value(self.value(until))),
        }
    }
}

/// `Number(text)`
pub(crate) fn to_number(text: &[u8]) -> f64 {
    let text = bun_core::strings::trim_js_whitespace(text);
    if text.is_empty() {
        return 0.0;
    }
    if let [
        b'0',
        radix @ (b'x' | b'X' | b'o' | b'O' | b'b' | b'B'),
        digits @ ..,
    ] = text
    {
        let radix = match radix.to_ascii_lowercase() {
            b'x' => 16,
            b'o' => 8,
            _ => 2,
        };
        let mut value = 0.0;
        for &digit in digits {
            let Some(digit) = (digit as char).to_digit(radix) else {
                return f64::NAN;
            };
            value = value * f64::from(radix) + f64::from(digit);
        }
        return if digits.is_empty() { f64::NAN } else { value };
    }
    let unsigned = match text {
        [b'+' | b'-', rest @ ..] => rest,
        _ => text,
    };
    if unsigned == b"Infinity" {
        return if text[0] == b'-' {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    let digits = |text: &[u8]| text.iter().take_while(|b| b.is_ascii_digit()).count();
    let whole = digits(unsigned);
    let mut at = whole;
    let mut fraction = 0;
    if unsigned.get(at) == Some(&b'.') {
        fraction = digits(&unsigned[at + 1..]);
        at += 1 + fraction;
    }
    if whole + fraction == 0 {
        return f64::NAN;
    }
    if matches!(unsigned.get(at), Some(b'e' | b'E')) {
        at += 1;
        at += usize::from(matches!(unsigned.get(at), Some(b'+' | b'-')));
        let exponent = digits(&unsigned[at..]);
        if exponent == 0 {
            return f64::NAN;
        }
        at += exponent;
    }
    if at != unsigned.len() {
        return f64::NAN;
    }
    std::str::from_utf8(text)
        .ok()
        .and_then(|it| it.parse().ok())
        .unwrap_or(f64::NAN)
}

/// The `String` cast: without its quotes, and with its escapes replaced.
fn unquote(text: &[u8]) -> Vec<u8> {
    let (quote, inner) = match text {
        [b'\'', inner @ .., b'\''] => (b'\'', inner),
        [b'"', inner @ .., b'"'] => (b'"', inner),
        _ => return text.to_vec(),
    };
    let mut out = Vec::with_capacity(inner.len());
    let mut at = 0;
    while at < inner.len() {
        let rest = &inner[at..];
        let [b'\\', escaped, ..] = *rest else {
            out.push(rest[0]);
            at += 1;
            continue;
        };
        at += 2;
        match escaped {
            b'u' => {
                let unit = rest
                    .get(2..6)
                    .and_then(|hex| u32::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok());
                match unit.filter(|_| rest[2..6].iter().all(u8::is_ascii_hexdigit)) {
                    Some(unit) => {
                        let c = char::from_u32(unit).unwrap_or(char::REPLACEMENT_CHARACTER);
                        out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
                        at += 4;
                    }
                    None => out.extend_from_slice(b"\\u"),
                }
            }
            b'b' => out.push(0x08),
            b'f' => out.push(0x0C),
            b'n' => out.push(b'\n'),
            b'r' => out.push(b'\r'),
            b't' => out.push(b'\t'),
            _ if escaped == quote => out.push(quote),
            _ => out.push(escaped),
        }
    }
    out
}

/// The `*` cast. `None` where levn throws, and for a regular expression, which JSON cannot
/// express. A date stays a string.
fn cast(node: Node) -> Option<Json> {
    Some(match node {
        Node::List(items) => Json::Array(items.into_iter().map(cast).collect::<Option<_>>()?),
        Node::Fields(fields) => Json::Object(cast_fields(fields)?),
        Node::Value(text) => match &text[..] {
            b"undefined" | b"null" => Json::Null,
            b"NaN" => Json::Number(f64::NAN),
            b"true" => Json::Bool(true),
            b"false" => Json::Bool(false),
            [b'/', .., b'/'] => return None,
            [b'/', rest @ ..]
                if bun_core::strings::last_index_of_char(rest, b'/').is_some_and(|slash| {
                    rest[slash + 1..]
                        .iter()
                        .all(|b| matches!(b, b'g' | b'i' | b'm' | b'y'))
                }) =>
            {
                return None;
            }
            _ => match to_number(&text) {
                number if number.is_nan() => Json::String(unquote(&text)),
                number => Json::Number(number),
            },
        },
    })
}

fn cast_fields(fields: Vec<(Vec<u8>, Node)>) -> Option<Vec<(Vec<u8>, Json)>> {
    let mut out: Vec<(Vec<u8>, Json)> = Vec::with_capacity(fields.len());
    for (key, value) in fields {
        let (key, value) = (unquote(&key), cast(value)?);
        match out.iter_mut().find(|it| it.0 == key) {
            Some(entry) => entry.1 = value,
            None => out.push((key, value)),
        }
    }
    Some(out)
}

/// `levn.parse("Object", text)`, which also reads `--rule` and `--parser-options` on the command line of
/// ESLint. `None` where levn throws.
pub fn parse_object(text: &[u8]) -> Option<Vec<(Vec<u8>, Json)>> {
    let mut tokens = Tokens {
        tokens: tokenize(text),
        at: 0,
    };
    let has_delimiters = tokens.peek() == Some(b"{");
    let Node::Fields(fields) = tokens.fields(has_delimiters, 0)? else {
        return None;
    };
    // levn reads what has tokens left over as a tuple, which is no object.
    (tokens.at == tokens.tokens.len())
        .then(|| cast_fields(fields))
        .flatten()
}
