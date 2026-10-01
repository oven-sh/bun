//! Enough of JSON to read `tsconfig.json` (comments, trailing commas) and `package.json`.

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    /// In the order written: the order of `exports` conditions matters.
    Object(Vec<(String, Json)>),
}

impl Json {
    pub fn parse(text: &[u8]) -> Option<Json> {
        let mut p = Parser {
            text,
            at: 0,
            depth: 0,
        };
        if text.starts_with(b"\xEF\xBB\xBF") {
            p.at = 3;
        }
        let value = p.value()?;
        p.skip();
        if p.at == text.len() {
            Some(value)
        } else {
            None
        }
    }

    /// Whether there is nothing in `text` but space and comments.
    pub fn is_blank(text: &[u8]) -> bool {
        let mut p = Parser {
            text,
            at: 0,
            depth: 0,
        };
        if text.starts_with(b"\xEF\xBB\xBF") {
            p.at = 3;
        }
        p.skip();
        p.at == text.len()
    }

    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(entries) => entries.iter().find(|e| e.0 == key).map(|e| &e.1),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Array(a) => Some(a),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&[(String, Json)]> {
        match self {
            Json::Object(o) => Some(o),
            _ => None,
        }
    }
}

struct Parser<'a> {
    text: &'a [u8],
    at: usize,
    depth: u32,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.text.get(self.at).copied()
    }

    fn skip(&mut self) {
        loop {
            match self.peek() {
                Some(b' ' | b'\t' | b'\r' | b'\n') => self.at += 1,
                Some(b'/') if self.text.get(self.at + 1) == Some(&b'/') => {
                    while !matches!(self.peek(), None | Some(b'\n')) {
                        self.at += 1;
                    }
                }
                Some(b'/') if self.text.get(self.at + 1) == Some(&b'*') => {
                    self.at += 2;
                    while self.at < self.text.len() && !self.text[self.at..].starts_with(b"*/") {
                        self.at += 1;
                    }
                    self.at = (self.at + 2).min(self.text.len());
                }
                _ => return,
            }
        }
    }

    fn value(&mut self) -> Option<Json> {
        self.skip();
        self.depth += 1;
        if self.depth > 200 {
            return None;
        }
        let value = match self.peek()? {
            b'{' => {
                self.at += 1;
                let mut entries = Vec::new();
                loop {
                    self.skip();
                    match self.peek()? {
                        b'}' => {
                            self.at += 1;
                            break;
                        }
                        b',' => self.at += 1,
                        _ => {
                            let key = self.string()?;
                            self.skip();
                            if self.peek()? != b':' {
                                return None;
                            }
                            self.at += 1;
                            entries.push((key, self.value()?));
                        }
                    }
                }
                Json::Object(entries)
            }
            b'[' => {
                self.at += 1;
                let mut items = Vec::new();
                loop {
                    self.skip();
                    match self.peek()? {
                        b']' => {
                            self.at += 1;
                            break;
                        }
                        b',' => self.at += 1,
                        _ => items.push(self.value()?),
                    }
                }
                Json::Array(items)
            }
            b'"' => Json::String(self.string()?),
            b't' if self.text[self.at..].starts_with(b"true") => {
                self.at += 4;
                Json::Bool(true)
            }
            b'f' if self.text[self.at..].starts_with(b"false") => {
                self.at += 5;
                Json::Bool(false)
            }
            b'n' if self.text[self.at..].starts_with(b"null") => {
                self.at += 4;
                Json::Null
            }
            _ => {
                let start = self.at;
                while matches!(
                    self.peek(),
                    Some(b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')
                ) {
                    self.at += 1;
                }
                Json::Number(
                    std::str::from_utf8(&self.text[start..self.at])
                        .ok()?
                        .parse()
                        .ok()?,
                )
            }
        };
        self.depth -= 1;
        Some(value)
    }

    fn string(&mut self) -> Option<String> {
        if self.peek()? != b'"' {
            return None;
        }
        self.at += 1;
        let mut out = Vec::new();
        loop {
            let c = self.peek()?;
            self.at += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    let e = self.peek()?;
                    self.at += 1;
                    match e {
                        b'n' => out.push(b'\n'),
                        b't' => out.push(b'\t'),
                        b'r' => out.push(b'\r'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'u' => {
                            let hex =
                                std::str::from_utf8(self.text.get(self.at..self.at + 4)?).ok()?;
                            self.at += 4;
                            let c = char::from_u32(u32::from_str_radix(hex, 16).ok()?)
                                .unwrap_or('\u{FFFD}');
                            out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
                        }
                        other => out.push(other),
                    }
                }
                _ => out.push(c),
            }
        }
        Some(String::from_utf8_lossy(&out).into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_tsconfig() {
        let json =
            Json::parse(b"{ // c\n \"a\": [1, 2,], /* d */ \"b\": {\"c\": \"x\\ny\"}, }").unwrap();
        assert_eq!(json.get("a").unwrap().as_array().unwrap().len(), 2);
        assert_eq!(
            json.get("b").unwrap().get("c").unwrap().as_str(),
            Some("x\ny")
        );
    }
}
