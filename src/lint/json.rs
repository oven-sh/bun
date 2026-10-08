//! Reads JSON, with comments and trailing commas allowed.

use crate::options::Json;

/// `None` if `text` is not JSON.
pub fn parse(text: &[u8]) -> Option<Json> {
    let mut parser = Parser { text, at: 0 };
    let value = parser.value(0)?;
    parser.skip_trivia();
    (parser.at == text.len()).then_some(value)
}

struct Parser<'t> {
    text: &'t [u8],
    at: usize,
}

impl Parser<'_> {
    fn skip_trivia(&mut self) {
        if self.at == 0 && self.text.starts_with(b"\xEF\xBB\xBF") {
            self.at = 3;
        }
        loop {
            match self.text.get(self.at) {
                Some(b' ' | b'\t' | b'\n' | b'\r') => self.at += 1,
                Some(b'/') if self.text.get(self.at + 1) == Some(&b'/') => {
                    let rest = &self.text[self.at..];
                    self.at += bun_core::strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len());
                }
                Some(b'/') if self.text.get(self.at + 1) == Some(&b'*') => {
                    let rest = &self.text[self.at + 2..];
                    self.at += 2 + bun_core::strings::index_of(rest, b"*/").map_or(rest.len(), |i| i + 2);
                }
                _ => return,
            }
        }
    }

    fn eat(&mut self, byte: u8) -> bool {
        self.skip_trivia();
        let found = self.text.get(self.at) == Some(&byte);
        self.at += usize::from(found);
        found
    }

    fn word(&mut self, word: &[u8], value: Json) -> Option<Json> {
        self.text[self.at..].starts_with(word).then(|| {
            self.at += word.len();
            value
        })
    }

    fn value(&mut self, depth: usize) -> Option<Json> {
        if depth > 512 {
            return None;
        }
        self.skip_trivia();
        match *self.text.get(self.at)? {
            b'n' => self.word(b"null", Json::Null),
            b't' => self.word(b"true", Json::Bool(true)),
            b'f' => self.word(b"false", Json::Bool(false)),
            b'"' => self.string().map(Json::String),
            b'[' => {
                self.at += 1;
                let mut items = Vec::new();
                while !self.eat(b']') {
                    items.push(self.value(depth + 1)?);
                    if !self.eat(b',') && self.text.get(self.at) != Some(&b']') {
                        return None;
                    }
                }
                Some(Json::Array(items))
            }
            b'{' => {
                self.at += 1;
                let mut entries = Vec::new();
                while !self.eat(b'}') {
                    let key = self.string()?;
                    if !self.eat(b':') {
                        return None;
                    }
                    entries.push((key, self.value(depth + 1)?));
                    if !self.eat(b',') && self.text.get(self.at) != Some(&b'}') {
                        return None;
                    }
                }
                Some(Json::Object(entries))
            }
            b'-' | b'0'..=b'9' => {
                let start = self.at;
                while matches!(self.text.get(self.at), Some(b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')) {
                    self.at += 1;
                }
                let written = std::str::from_utf8(&self.text[start..self.at]).ok()?;
                written.parse().ok().map(Json::Number)
            }
            _ => None,
        }
    }

    fn hex4(&mut self) -> Option<u32> {
        let digits = std::str::from_utf8(self.text.get(self.at..self.at + 4)?).ok()?;
        self.at += 4;
        u32::from_str_radix(digits, 16).ok()
    }

    fn string(&mut self) -> Option<Vec<u8>> {
        self.skip_trivia();
        if self.text.get(self.at) != Some(&b'"') {
            return None;
        }
        self.at += 1;
        let mut out = Vec::new();
        loop {
            let rest = &self.text[self.at..];
            let plain = bun_core::strings::index_of_any(rest, b"\"\\")?;
            out.extend_from_slice(&rest[..plain]);
            self.at += plain + 1;
            if rest[plain] == b'"' {
                return Some(out);
            }
            let escape = *self.text.get(self.at)?;
            self.at += 1;
            match escape {
                b'"' | b'\\' | b'/' => out.push(escape),
                b'b' => out.push(0x08),
                b'f' => out.push(0x0C),
                b'n' => out.push(b'\n'),
                b'r' => out.push(b'\r'),
                b't' => out.push(b'\t'),
                b'u' => {
                    let mut unit = self.hex4()?;
                    if (0xD800..0xDC00).contains(&unit) && self.text[self.at..].starts_with(b"\\u") {
                        let before = self.at;
                        self.at += 2;
                        let low = self.hex4()?;
                        match (0xDC00..0xE000).contains(&low) {
                            true => unit = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00),
                            false => self.at = before,
                        }
                    }
                    let c = char::from_u32(unit).unwrap_or(char::REPLACEMENT_CHARACTER);
                    out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
                }
                _ => return None,
            }
        }
    }
}
