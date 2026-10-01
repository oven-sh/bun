// A JSON reader for the dumps that the test importer loads. An array of numbers is kept as integers.
#[derive(Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(Vec<u8>),
    Numbers(Vec<i64>),
    Array(Vec<Json>),
    Object(Vec<(Vec<u8>, Json)>),
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct JsonError {
    pub offset: usize,
    pub message: &'static str,
}

const MAX_DEPTH: u32 = 64;

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Json {
    pub fn parse(bytes: &[u8]) -> Result<Json, JsonError> {
        let mut reader = Reader { bytes, at: 0 };
        let value = reader.value(0)?;
        reader.skip_space();
        if reader.at != bytes.len() {
            return Err(reader.error("text after the value"));
        }
        Ok(value)
    }
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(members) => members
                .iter()
                .find(|member| member.0 == key.as_bytes())
                .map(|member| &member.1),
            _ => None,
        }
    }
    pub fn numbers(&self) -> &[i64] {
        match self {
            Json::Numbers(values) => values,
            _ => &[],
        }
    }
    pub fn items(&self) -> &[Json] {
        match self {
            Json::Array(values) => values,
            _ => &[],
        }
    }
    pub fn bytes(&self) -> &[u8] {
        match self {
            Json::String(value) => value,
            _ => &[],
        }
    }
    pub fn number(&self) -> f64 {
        match self {
            Json::Number(value) => *value,
            _ => 0.0,
        }
    }
    pub fn is_true(&self) -> bool {
        matches!(self, Json::Bool(true))
    }
}

impl Reader<'_> {
    fn error(&self, message: &'static str) -> JsonError {
        JsonError {
            offset: self.at,
            message,
        }
    }
    fn peek(&self) -> u8 {
        self.bytes.get(self.at).copied().unwrap_or(0)
    }
    fn skip_space(&mut self) {
        while matches!(self.peek(), b' ' | b'\n' | b'\r' | b'\t') {
            self.at += 1;
        }
    }
    fn word(&mut self, word: &[u8], value: Json) -> Result<Json, JsonError> {
        if self.bytes.get(self.at..self.at + word.len()) != Some(word) {
            return Err(self.error("unknown word"));
        }
        self.at += word.len();
        Ok(value)
    }
    fn value(&mut self, depth: u32) -> Result<Json, JsonError> {
        if depth > MAX_DEPTH {
            return Err(self.error("nested too deep"));
        }
        self.skip_space();
        match self.peek() {
            b'{' => self.object(depth),
            b'[' => self.array(depth),
            b'"' => Ok(Json::String(self.string()?)),
            b't' => self.word(b"true", Json::Bool(true)),
            b'f' => self.word(b"false", Json::Bool(false)),
            b'n' => self.word(b"null", Json::Null),
            b'-' | b'0'..=b'9' => Ok(Json::Number(self.number()?.1)),
            _ => Err(self.error("a value was expected")),
        }
    }
    // The integer value when the number is one, and the number itself.
    fn number(&mut self) -> Result<(Option<i64>, f64), JsonError> {
        let start = self.at;
        let negative = self.peek() == b'-';
        if negative {
            self.at += 1;
        }
        let mut integer: Option<i64> = Some(0);
        let digits = self.at;
        while let b @ b'0'..=b'9' = self.peek() {
            integer = integer
                .and_then(|v| v.checked_mul(10))
                .and_then(|v| v.checked_add(i64::from(b - b'0')));
            self.at += 1;
        }
        if self.at == digits {
            return Err(self.error("a digit was expected"));
        }
        if !matches!(self.peek(), b'.' | b'e' | b'E') {
            if let Some(value) = integer {
                let value = if negative { -value } else { value };
                return Ok((Some(value), value as f64));
            }
        }
        while matches!(self.peek(), b'0'..=b'9' | b'.' | b'e' | b'E' | b'+' | b'-') {
            self.at += 1;
        }
        let text = self
            .bytes
            .get(start..self.at)
            .and_then(|slice| std::str::from_utf8(slice).ok())
            .unwrap_or("");
        match text.parse::<f64>() {
            Ok(value) => Ok((None, value)),
            Err(_) => Err(self.error("not a number")),
        }
    }
    fn hex4(&mut self) -> Result<u32, JsonError> {
        let mut value = 0u32;
        for _ in 0..4 {
            let digit = match self.peek() {
                b @ b'0'..=b'9' => u32::from(b - b'0'),
                b @ b'a'..=b'f' => u32::from(b - b'a') + 10,
                b @ b'A'..=b'F' => u32::from(b - b'A') + 10,
                _ => return Err(self.error("a hex digit was expected")),
            };
            value = value * 16 + digit;
            self.at += 1;
        }
        Ok(value)
    }
    fn string(&mut self) -> Result<Vec<u8>, JsonError> {
        self.at += 1;
        let mut out = Vec::new();
        loop {
            let start = self.at;
            while !matches!(self.peek(), b'"' | b'\\' | 0) {
                self.at += 1;
            }
            out.extend_from_slice(self.bytes.get(start..self.at).unwrap_or(&[]));
            if self.at >= self.bytes.len() {
                return Err(self.error("the string does not end"));
            }
            match self.peek() {
                b'"' => {
                    self.at += 1;
                    return Ok(out);
                }
                b'\\' => {
                    self.at += 1;
                    let escape = self.peek();
                    self.at += 1;
                    match escape {
                        b'"' | b'\\' | b'/' => out.push(escape),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'u' => {
                            let mut code = self.hex4()?;
                            if (0xD800..0xDC00).contains(&code)
                                && self.bytes.get(self.at..self.at + 2) == Some(b"\\u")
                            {
                                let save = self.at;
                                self.at += 2;
                                let low = self.hex4()?;
                                if (0xDC00..0xE000).contains(&low) {
                                    code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                                } else {
                                    self.at = save;
                                }
                            }
                            // A lone surrogate becomes U+FFFD.
                            let c = char::from_u32(code).unwrap_or('\u{FFFD}');
                            let mut buffer = [0u8; 4];
                            out.extend_from_slice(c.encode_utf8(&mut buffer).as_bytes());
                        }
                        _ => return Err(self.error("unknown escape")),
                    }
                }
                _ => {
                    // A NUL byte inside the string.
                    out.push(0);
                    self.at += 1;
                }
            }
        }
    }
    fn array(&mut self, depth: u32) -> Result<Json, JsonError> {
        self.at += 1;
        self.skip_space();
        if self.peek() == b']' {
            self.at += 1;
            return Ok(Json::Numbers(Vec::new()));
        }
        if matches!(self.peek(), b'-' | b'0'..=b'9') {
            let start = self.at;
            if let Some(numbers) = self.integers()? {
                return Ok(Json::Numbers(numbers));
            }
            self.at = start;
        }
        let mut items = Vec::new();
        loop {
            items.push(self.value(depth + 1)?);
            self.skip_space();
            match self.peek() {
                b',' => self.at += 1,
                b']' => {
                    self.at += 1;
                    return Ok(Json::Array(items));
                }
                _ => return Err(self.error("a comma or the end of the array was expected")),
            }
        }
    }
    // An array of integers. None when an element is something else.
    fn integers(&mut self) -> Result<Option<Vec<i64>>, JsonError> {
        let mut numbers = Vec::new();
        loop {
            self.skip_space();
            if !matches!(self.peek(), b'-' | b'0'..=b'9') {
                return Ok(None);
            }
            match self.number()?.0 {
                Some(value) => numbers.push(value),
                None => return Ok(None),
            }
            self.skip_space();
            match self.peek() {
                b',' => self.at += 1,
                b']' => {
                    self.at += 1;
                    return Ok(Some(numbers));
                }
                _ => return Err(self.error("a comma or the end of the array was expected")),
            }
        }
    }
    fn object(&mut self, depth: u32) -> Result<Json, JsonError> {
        self.at += 1;
        let mut members = Vec::new();
        self.skip_space();
        if self.peek() == b'}' {
            self.at += 1;
            return Ok(Json::Object(members));
        }
        loop {
            self.skip_space();
            if self.peek() != b'"' {
                return Err(self.error("a member name was expected"));
            }
            let name = self.string()?;
            self.skip_space();
            if self.peek() != b':' {
                return Err(self.error("a colon was expected"));
            }
            self.at += 1;
            members.push((name, self.value(depth + 1)?));
            self.skip_space();
            match self.peek() {
                b',' => self.at += 1,
                b'}' => {
                    self.at += 1;
                    return Ok(Json::Object(members));
                }
                _ => return Err(self.error("a comma or the end of the object was expected")),
            }
        }
    }
}
