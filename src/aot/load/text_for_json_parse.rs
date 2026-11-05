pub(crate) fn is_taken_by_json_parse(text: &[u8]) -> bool {
    let mut reader = Reader { text, at: 0 };
    let mut open = Vec::new();
    loop {
        reader.skip_blanks();
        let is_read = match reader.take() {
            Some(b'{') if reader.skip_blanks_and_take(b'}') => true,
            Some(b'{') => {
                open.push(b'}');
                match reader.read_key() {
                    true => continue,
                    false => false,
                }
            }
            Some(b'[') if reader.skip_blanks_and_take(b']') => true,
            Some(b'[') => {
                open.push(b']');
                continue;
            }
            Some(b'"') => reader.read_rest_of_string(),
            Some(b'-') => match reader.take() {
                Some(first @ b'0'..=b'9') => reader.read_rest_of_number(first),
                _ => false,
            },
            Some(first @ b'0'..=b'9') => reader.read_rest_of_number(first),
            Some(b't') => reader.take_all(b"rue"),
            Some(b'f') => reader.take_all(b"alse"),
            Some(b'n') => reader.take_all(b"ull"),
            _ => false,
        };
        if !is_read {
            return false;
        }
        loop {
            reader.skip_blanks();
            let Some(&end) = open.last() else {
                return reader.at == text.len();
            };
            match reader.take() {
                Some(byte) if byte == end => {
                    open.pop();
                }
                Some(b',') if end == b']' => break,
                Some(b',') if reader.read_key() => break,
                _ => return false,
            }
        }
    }
}

struct Reader<'a> {
    text: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn peek(&self) -> Option<u8> {
        self.text.get(self.at).copied()
    }

    fn take(&mut self) -> Option<u8> {
        let byte = self.peek()?;
        self.at += 1;
        Some(byte)
    }

    fn take_if(&mut self, is_wanted: impl Fn(u8) -> bool) -> bool {
        let is_there = self.peek().is_some_and(is_wanted);
        self.at += usize::from(is_there);
        is_there
    }

    fn take_all(&mut self, bytes: &[u8]) -> bool {
        let is_there = self.text[self.at..].starts_with(bytes);
        self.at += if is_there { bytes.len() } else { 0 };
        is_there
    }

    fn take_digits(&mut self) -> bool {
        let start = self.at;
        while self.take_if(|byte| byte.is_ascii_digit()) {}
        self.at > start
    }

    fn skip_blanks(&mut self) {
        while self.take_if(|byte| matches!(byte, b' ' | b'\t' | b'\n' | b'\r')) {}
    }

    fn skip_blanks_and_take(&mut self, byte: u8) -> bool {
        self.skip_blanks();
        self.take_if(|it| it == byte)
    }

    fn read_key(&mut self) -> bool {
        self.skip_blanks_and_take(b'"')
            && self.read_rest_of_string()
            && self.skip_blanks_and_take(b':')
    }

    fn read_rest_of_string(&mut self) -> bool {
        loop {
            match self.take() {
                Some(b'"') => return true,
                Some(b'\\') => match self.take() {
                    Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => {}
                    Some(b'u') => {
                        for _ in 0..4 {
                            if !self.take_if(|byte| byte.is_ascii_hexdigit()) {
                                return false;
                            }
                        }
                    }
                    _ => return false,
                },
                Some(0x20..) => {}
                _ => return false,
            }
        }
    }

    fn read_rest_of_number(&mut self, first: u8) -> bool {
        if first != b'0' {
            self.take_digits();
        }
        if self.take_if(|byte| byte == b'.') && !self.take_digits() {
            return false;
        }
        if self.take_if(|byte| matches!(byte, b'e' | b'E')) {
            self.take_if(|byte| matches!(byte, b'+' | b'-'));
            return self.take_digits();
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::is_taken_by_json_parse;

    #[test]
    fn takes_what_json_parse_takes() {
        let deep = [vec![b'['; 100_000], vec![b']'; 100_000]].concat();
        let taken: &[&[u8]] = &[
            b"{}",
            b"[]",
            b" \t\r\n{ \"a\" : [ 1 , true , false , null , { \"b\" : \"c\" } ] } \t\r\n",
            b"42",
            b"-0",
            b"\"text\"",
            b"null",
            b"[0.5, -0.5e-1, 0E+1, 1e400, 123456789012345678901234567890]",
            br#"["\"\\\/\b\f\n\r\tA\ud800"]"#,
            "[\"\u{e9}\u{2028}\u{7f}\", \"it's\", \"// /* */\"]".as_bytes(),
            br#"{"a": 1, "a": 2, "__proto__": 3, "": 4}"#,
            &deep,
        ];
        for text in taken {
            let head = String::from_utf8_lossy(&text[..text.len().min(60)]);
            assert!(is_taken_by_json_parse(text), "{head}");
        }
    }

    #[test]
    fn refuses_what_json_parse_refuses() {
        let refused: &[&[u8]] = &[
            b"",
            b" \n",
            b"{\"n\": 0x10}",
            b"{\"n\": 0o7}",
            b"{\"n\": 010}",
            b"{\"n\": 1_000}",
            b"{\"n\": .5}",
            b"{\"n\": 5.}",
            b"{\"n\": +1}",
            b"{\"n\": 1e}",
            b"{\"n\": -}",
            b"{\"n\": NaN}",
            b"{\"a\": 1} {\"b\": 2}",
            b"{\"a\": 1} x",
            b"{\"a\": 1};",
            b"1 2",
            b"{'a': 1}",
            b"{\"a\": 'b'}",
            b"{a: 1}",
            b"{ // a comment\n\"a\": 1 }",
            b"{ /* a comment */ \"a\": 1 }",
            b"{\"a\": 1,}",
            b"[1,]",
            b"[,1]",
            b"[1,,2]",
            b"{\"a\" 1}",
            b"[1 2]",
            b"{\"a\":}",
            b"[\"a\": 1]",
            b"{\"a\": \"b",
            b"[1, 2",
            b"{\"a\": 1",
            b"]",
            b"[1}",
            br#"["\v"]"#,
            br#"["\x41"]"#,
            br#"["\'"]"#,
            br#"["\u12"]"#,
            b"[\"a\tb\"]",
            b"[\"a\nb\"]",
            b"[\"a\x00b\"]",
            b"\x0c{\"a\": 1}",
            b"\x0b{\"a\": 1}",
            "\u{a0}{\"a\": 1}".as_bytes(),
            "{\"a\":\u{2028}1}".as_bytes(),
            "\u{feff}{\"a\": 1}".as_bytes(),
            b"[True]",
            b"[nul]",
            b"[truex]",
            b"({\"a\": 1})",
        ];
        for text in refused {
            let shown = String::from_utf8_lossy(text);
            assert!(!is_taken_by_json_parse(text), "{shown}");
        }
    }
}
