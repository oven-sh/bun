//! `levn.parse("Object", text)`: the lenient notation that ESLint tries on an `/* eslint .. */` comment before it tries
//! JSON.

use crate::json::NestingLimit;
use crate::options::Json;

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

/// `[^\s<special>](?:\s*[^\s<special>]+)*`. The colon in `bun:test/no-focused-tests` is part of the word: levn can't
/// parse that text anyway, and no rule is named `bun`.
fn word_end(text: &[u8]) -> usize {
    let (mut at, mut end) = (0, 0);
    let colon_of_name = if text.starts_with(b"bun:test/") {
        3
    } else {
        usize::MAX
    };
    while at < text.len() && (!is_special(text[at]) || at == colon_of_name) {
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

/// The tree that `parse-string.js` builds from the tokens.
enum Node {
    Value(Vec<u8>),
    List(Vec<Node>),
    Fields(Vec<(Vec<u8>, Node)>),
}

struct Tokens<'t> {
    tokens: Vec<&'t [u8]>,
    at: usize,
    room: NestingLimit,
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

    fn list(&mut self, close: &[u8], until: &[&[u8]]) -> Option<Node> {
        self.at += 1;
        let mut items = Vec::new();
        while self.peek().is_some_and(|token| token != close) {
            items.push(self.element(until)?);
            self.maybe_consume(b",");
        }
        self.consume(close)?;
        Some(Node::List(items))
    }

    fn fields(&mut self, has_delimiters: bool) -> Option<Node> {
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
            let value = self.element(until)?;
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

    fn element(&mut self, until: &[&[u8]]) -> Option<Node> {
        if !self.room.has_more() {
            return None;
        }
        match self.peek() {
            Some(b"[") => self.list(b"]", &[b",", b"]"]),
            Some(b"(") => self.list(b")", &[b",", b")"]),
            Some(b"{") => self.fields(true),
            _ => Some(Node::Value(self.value(until))),
        }
    }
}

/// The `String` cast: strips the quotes and resolves the escapes.
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

/// The `*` cast. `None` where levn throws, and for a regular expression, which JSON can't represent. A date stays a
/// string.
fn cast(node: &Node, room: NestingLimit) -> Option<Json> {
    if !room.has_more() {
        return None;
    }
    Some(match node {
        Node::List(items) => Json::Array(
            items
                .iter()
                .map(|it| cast(it, room))
                .collect::<Option<_>>()?,
        ),
        Node::Fields(fields) => Json::Object(cast_fields(fields, room)?),
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
            _ => match bun_core::fmt::js_string_to_number(text) {
                number if number.is_nan() => Json::String(unquote(text)),
                number => Json::Number(number),
            },
        },
    })
}

fn cast_fields(fields: &[(Vec<u8>, Node)], room: NestingLimit) -> Option<Vec<(Vec<u8>, Json)>> {
    let mut out = Vec::with_capacity(fields.len());
    for (key, value) in fields {
        let (key, value) = (unquote(key), cast(value, room)?);
        // levn assigns each key to an object, and assigning `__proto__` doesn't create a property.
        if key != b"__proto__" {
            out.push((key, value));
        }
    }
    Json::object(out).into_object()
}

fn parse_fields(text: &[u8]) -> Option<(Vec<(Vec<u8>, Node)>, NestingLimit)> {
    let mut tokens = Tokens {
        tokens: tokenize(text),
        at: 0,
        room: NestingLimit::new(),
    };
    let has_delimiters = tokens.peek() == Some(b"{");
    let Node::Fields(fields) = tokens.fields(has_delimiters)? else {
        return None;
    };
    // If tokens are left over, levn reads the text as a tuple, which isn't an object.
    (tokens.at == tokens.tokens.len()).then_some((fields, tokens.room))
}

/// Port of `levn.parse("Object", text)`, which ESLint also uses for `--parser-options` on the
/// command line. Returns `None` where levn throws.
pub fn parse_object(text: &[u8]) -> Option<Vec<(Vec<u8>, Json)>> {
    let (fields, room) = parse_fields(text)?;
    cast_fields(&fields, room)
}

/// Runs [`parse_object`] for `--rule`. levn reads `no-console:` as `no-console: 0`, which turns the
/// rule off. This returns `None` for that, and for text without any rule.
pub fn parse_rules(text: &[u8]) -> Option<Vec<(Vec<u8>, Json)>> {
    let (fields, room) = parse_fields(text)?;
    let is_missing = |it: &Node| matches!(it, Node::Value(text) if text.is_empty());
    let lacks_severity = |it: &(Vec<u8>, Node)| match &it.1 {
        Node::List(items) => items.first().is_some_and(is_missing),
        setting => is_missing(setting),
    };
    (!fields.is_empty() && !fields.iter().any(lacks_severity))
        .then(|| cast_fields(&fields, room))
        .flatten()
}
