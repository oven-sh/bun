// A reader for the JSON of the tree dumps: objects, arrays, strings and integers. Nothing else occurs in a dump.
pub struct Json<'t> {
    bytes: &'t [u8],
    at: usize,
    pub failed: bool,
}

impl<'t> Json<'t> {
    pub fn new(bytes: &'t [u8]) -> Self {
        Self {
            bytes,
            at: 0,
            failed: false,
        }
    }
    fn skip_space(&mut self) {
        while let Some(b' ' | b'\n' | b'\r' | b'\t') = self.bytes.get(self.at) {
            self.at += 1;
        }
    }
    pub fn peek(&mut self) -> u8 {
        self.skip_space();
        self.bytes.get(self.at).copied().unwrap_or(0)
    }
    // Consumes `byte` when it is next.
    pub fn eat(&mut self, byte: u8) -> bool {
        if self.peek() == byte {
            self.at += 1;
            return true;
        }
        false
    }
    pub fn expect(&mut self, byte: u8) {
        if !self.eat(byte) {
            self.failed = true;
        }
    }
    // Steps through the elements of an array or the members of an object: true while there is one more.
    pub fn more(&mut self, first: &mut bool, close: u8) -> bool {
        if self.failed || self.eat(close) {
            return false;
        }
        if *first {
            *first = false;
        } else {
            self.expect(b',');
        }
        !self.failed
    }
    pub fn integer(&mut self) -> i64 {
        self.skip_space();
        let negative = self.bytes.get(self.at) == Some(&b'-');
        if negative {
            self.at += 1;
        }
        let start = self.at;
        let mut value: i64 = 0;
        while let Some(digit @ b'0'..=b'9') = self.bytes.get(self.at) {
            value = value.wrapping_mul(10).wrapping_add(i64::from(digit - b'0'));
            self.at += 1;
        }
        if self.at == start {
            self.failed = true;
        }
        // A dump has no fractions; a literal `true` or `false` is read by `boolean`.
        if negative { -value } else { value }
    }
    pub fn boolean(&mut self) -> bool {
        self.skip_space();
        let rest = self.bytes.get(self.at..).unwrap_or(&[]);
        if rest.starts_with(b"true") {
            self.at += 4;
            return true;
        }
        if rest.starts_with(b"false") {
            self.at += 5;
            return false;
        }
        if rest.starts_with(b"null") {
            self.at += 4;
            return false;
        }
        self.failed = true;
        false
    }
    fn hex4(&mut self) -> u32 {
        let mut value = 0u32;
        for _ in 0..4 {
            let digit = match self.bytes.get(self.at) {
                Some(b @ b'0'..=b'9') => u32::from(b - b'0'),
                Some(b @ b'a'..=b'f') => u32::from(b - b'a') + 10,
                Some(b @ b'A'..=b'F') => u32::from(b - b'A') + 10,
                _ => {
                    self.failed = true;
                    0
                }
            };
            value = value * 16 + digit;
            self.at += 1;
        }
        value
    }
    // Appends the string to `out` as WTF-8: a lone surrogate keeps its three bytes.
    pub fn string_into(&mut self, out: &mut Vec<u8>) {
        self.expect(b'"');
        loop {
            let start = self.at;
            while let Some(b) = self.bytes.get(self.at) {
                if *b == b'"' || *b == b'\\' {
                    break;
                }
                self.at += 1;
            }
            out.extend_from_slice(self.bytes.get(start..self.at).unwrap_or(&[]));
            match self.bytes.get(self.at) {
                Some(b'"') => {
                    self.at += 1;
                    return;
                }
                Some(b'\\') => {
                    self.at += 1;
                    let escape = self.bytes.get(self.at).copied().unwrap_or(0);
                    self.at += 1;
                    match escape {
                        b'n' => out.push(b'\n'),
                        b't' => out.push(b'\t'),
                        b'r' => out.push(b'\r'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'u' => {
                            let mut code = self.hex4();
                            if (0xD800..0xDC00).contains(&code)
                                && self.bytes.get(self.at..self.at + 2) == Some(b"\\u")
                            {
                                let save = self.at;
                                self.at += 2;
                                let low = self.hex4();
                                if (0xDC00..0xE000).contains(&low) {
                                    code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                                } else {
                                    self.at = save;
                                }
                            }
                            push_code_point(out, code);
                        }
                        other => out.push(other),
                    }
                }
                _ => {
                    self.failed = true;
                    return;
                }
            }
        }
    }
    pub fn string(&mut self) -> Vec<u8> {
        let mut out = Vec::new();
        self.string_into(&mut out);
        out
    }
    pub fn skip_value(&mut self) {
        match self.peek() {
            b'"' => {
                let mut sink = Vec::new();
                self.string_into(&mut sink);
            }
            open @ (b'[' | b'{') => {
                self.at += 1;
                let close = if open == b'[' { b']' } else { b'}' };
                let mut first = true;
                while self.more(&mut first, close) {
                    if open == b'{' {
                        self.skip_value();
                        self.expect(b':');
                    }
                    self.skip_value();
                }
            }
            b't' | b'f' | b'n' => {
                self.boolean();
            }
            _ => {
                self.integer();
            }
        }
    }
    pub fn integers(&mut self, out: &mut Vec<i32>) {
        self.expect(b'[');
        let mut first = true;
        while self.more(&mut first, b']') {
            out.push(self.integer() as i32);
        }
    }
}

fn push_code_point(out: &mut Vec<u8>, code: u32) {
    match code {
        0..=0x7F => out.push(code as u8),
        0x80..=0x7FF => {
            out.extend_from_slice(&[0xC0 | (code >> 6) as u8, 0x80 | (code & 0x3F) as u8])
        }
        0x800..=0xFFFF => out.extend_from_slice(&[
            0xE0 | (code >> 12) as u8,
            0x80 | ((code >> 6) & 0x3F) as u8,
            0x80 | (code & 0x3F) as u8,
        ]),
        _ => out.extend_from_slice(&[
            0xF0 | (code >> 18) as u8,
            0x80 | ((code >> 12) & 0x3F) as u8,
            0x80 | ((code >> 6) & 0x3F) as u8,
            0x80 | (code & 0x3F) as u8,
        ]),
    }
}
