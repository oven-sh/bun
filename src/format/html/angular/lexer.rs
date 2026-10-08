//! The lexer for the expressions of Angular: `_Scanner` of `@angular/compiler`.

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Kind {
    /// One of `( ) [ ] { } , : ; .`
    Character(u8),
    Identifier,
    PrivateIdentifier,
    /// One of `KEYWORDS`.
    Keyword,
    String,
    /// The text of a template up to a `${`.
    TemplatePart,
    /// The text of a template up to its end.
    TemplateEnd,
    /// It is what it is written as.
    Operator,
    Number,
    RegExpBody,
    RegExpFlags,
    Error,
}

#[derive(Debug, Copy, Clone)]
pub(crate) struct Token {
    pub(crate) kind: Kind,
    pub(crate) start: u32,
    pub(crate) end: u32,
}

fn is_keyword(name: &[u8]) -> bool {
    matches!(
        name,
        b"var"
            | b"let"
            | b"as"
            | b"null"
            | b"undefined"
            | b"true"
            | b"false"
            | b"if"
            | b"else"
            | b"this"
            | b"typeof"
            | b"void"
            | b"in"
            | b"instanceof"
    )
}

fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'$')
}

fn is_identifier_part(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$')
}

/// What a `}` ends.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Brace {
    Expression,
    Interpolation,
}

struct Scanner<'i, 't> {
    input: &'i [u8],
    index: usize,
    tokens: &'t mut Vec<Token>,
    /// Where there is white space that is none to TypeScript.
    odd_blanks: &'t mut Vec<u32>,
    brace_stack: Vec<Brace>,
}

/// Appends the tokens of `input` to `tokens`, and to `odd_blanks` where there is a character between them that is white
/// space to Angular and not to TypeScript.
pub(crate) fn tokenize(input: &[u8], tokens: &mut Vec<Token>, odd_blanks: &mut Vec<u32>) {
    let mut scanner = Scanner {
        input,
        index: 0,
        tokens,
        odd_blanks,
        brace_stack: Vec::new(),
    };
    while let Some(token) = scanner.scan_token() {
        scanner.tokens.push(token);
    }
}

impl Scanner<'_, '_> {
    /// 0 at the end, as a NUL is.
    #[inline]
    fn peek(&self) -> u8 {
        self.input.get(self.index).copied().unwrap_or(0)
    }

    #[inline]
    fn advance(&mut self) {
        self.index += 1;
    }

    fn token(&self, kind: Kind, start: usize) -> Token {
        Token {
            kind,
            start: start as u32,
            end: self.index.min(self.input.len()) as u32,
        }
    }

    /// `start`: where what cannot be read starts.
    fn error(&self, start: usize) -> Token {
        self.token(Kind::Error, start)
    }

    fn scan_token(&mut self) -> Option<Token> {
        loop {
            match self.input.get(self.index..)? {
                [] => return None,
                [b'\t'..=b'\r' | b' ', ..] => self.index += 1,
                [0..=b' ', ..] => {
                    self.odd_blanks.push(self.index as u32);
                    self.index += 1;
                }
                // A no-break space.
                [0xC2, 0xA0, ..] => self.index += 2,
                _ => break,
            }
        }
        let (start, peek) = (self.index, self.peek());
        if is_identifier_start(peek) {
            return Some(self.scan_identifier());
        }
        if peek.is_ascii_digit() {
            return Some(self.scan_number(start));
        }
        Some(match peek {
            b'.' => {
                self.advance();
                if self.peek().is_ascii_digit() {
                    return Some(self.scan_number(start));
                }
                if self.peek() != b'.' {
                    return Some(self.token(Kind::Character(b'.'), start));
                }
                self.advance();
                if self.peek() != b'.' {
                    return Some(self.error(start));
                }
                self.advance();
                self.token(Kind::Operator, start)
            }
            b'(' | b')' | b'[' | b']' | b',' | b':' | b';' => {
                self.advance();
                self.token(Kind::Character(peek), start)
            }
            b'{' => {
                self.brace_stack.push(Brace::Expression);
                self.advance();
                self.token(Kind::Character(peek), start)
            }
            b'}' => {
                self.advance();
                let brace = self.token(Kind::Character(peek), start);
                if self.brace_stack.pop() != Some(Brace::Interpolation) {
                    return Some(brace);
                }
                self.tokens.push(brace);
                self.scan_template_literal_part(self.index)
            }
            b'\'' | b'"' => self.scan_string(),
            b'`' => {
                self.advance();
                self.scan_template_literal_part(start)
            }
            b'#' => {
                self.advance();
                if !is_identifier_start(self.peek()) {
                    return Some(self.error(start));
                }
                while is_identifier_part(self.peek()) {
                    self.advance();
                }
                self.token(Kind::PrivateIdentifier, start)
            }
            b'/' if self.is_start_of_regex() => self.scan_regex(start),
            b'+' | b'-' | b'/' | b'%' | b'<' | b'>' => self.scan_complex_operator(start, b'=', None),
            b'^' => {
                self.advance();
                self.token(Kind::Operator, start)
            }
            b'*' => {
                self.advance();
                if self.peek() == b'*' {
                    self.advance();
                }
                if self.peek() == b'=' {
                    self.advance();
                }
                self.token(Kind::Operator, start)
            }
            b'?' => {
                self.advance();
                match self.peek() {
                    b'?' => {
                        self.advance();
                        if self.peek() == b'=' {
                            self.advance();
                        }
                    }
                    b'.' => self.advance(),
                    _ => {}
                }
                self.token(Kind::Operator, start)
            }
            b'!' => self.scan_complex_operator(start, b'=', Some(b'=')),
            b'=' => {
                self.advance();
                match self.peek() {
                    b'>' => self.advance(),
                    b'=' => {
                        self.advance();
                        if self.peek() == b'=' {
                            self.advance();
                        }
                    }
                    _ => {}
                }
                self.token(Kind::Operator, start)
            }
            b'&' | b'|' => self.scan_complex_operator(start, peek, Some(b'=')),
            _ => {
                // All of a character that is not ASCII.
                self.advance();
                while matches!(self.peek(), 0x80..=0xBF) {
                    self.advance();
                }
                self.error(start)
            }
        })
    }

    fn scan_complex_operator(&mut self, start: usize, two: u8, three: Option<u8>) -> Token {
        self.advance();
        if self.peek() == two {
            self.advance();
        }
        if three.is_some_and(|three| self.peek() == three) {
            self.advance();
        }
        self.token(Kind::Operator, start)
    }

    fn scan_identifier(&mut self) -> Token {
        let start = self.index;
        self.advance();
        while is_identifier_part(self.peek()) {
            self.advance();
        }
        let is_keyword = self.input.get(start..self.index).is_some_and(is_keyword);
        self.token(if is_keyword { Kind::Keyword } else { Kind::Identifier }, start)
    }

    /// `start`: where the number starts, which is at the character before if that is a `.`.
    fn scan_number(&mut self, start: usize) -> Token {
        let input = self.input;
        let is_digit_at = |index: usize| input.get(index).is_some_and(u8::is_ascii_digit);
        self.advance();
        loop {
            match self.peek() {
                b'0'..=b'9' | b'.' => {}
                b'_' => {
                    if !is_digit_at(self.index - 1) || !is_digit_at(self.index + 1) {
                        return self.error(start);
                    }
                }
                b'e' | b'E' => {
                    self.advance();
                    if matches!(self.peek(), b'-' | b'+') {
                        self.advance();
                    }
                    if !self.peek().is_ascii_digit() {
                        return self.error(start);
                    }
                }
                _ => break,
            }
            self.advance();
        }
        self.token(Kind::Number, start)
    }

    /// What follows a `\`. Returns whether it can.
    fn scan_string_backslash(&mut self) -> bool {
        self.advance();
        if self.peek() != b'u' {
            self.advance();
            return true;
        }
        let rest = self.input.get(self.index + 1..).unwrap_or_default();
        let hex = &rest[..rest.len().min(4)];
        if hex.is_empty() || !hex.iter().all(u8::is_ascii_hexdigit) {
            return false;
        }
        self.index += 5;
        true
    }

    fn scan_string(&mut self) -> Token {
        let (start, quote) = (self.index, self.peek());
        self.advance();
        while self.peek() != quote {
            match self.peek() {
                b'\\' => {
                    if !self.scan_string_backslash() {
                        return self.error(start);
                    }
                }
                0 => return self.error(start),
                _ => self.advance(),
            }
        }
        self.advance();
        self.token(Kind::String, start)
    }

    fn scan_template_literal_part(&mut self, start: usize) -> Token {
        while self.peek() != b'`' {
            match self.peek() {
                b'\\' => {
                    if !self.scan_string_backslash() {
                        return self.error(start);
                    }
                }
                b'$' => {
                    let dollar = self.index;
                    self.advance();
                    if self.peek() == b'{' {
                        self.brace_stack.push(Brace::Interpolation);
                        self.tokens.push(Token {
                            kind: Kind::TemplatePart,
                            start: start as u32,
                            end: dollar as u32,
                        });
                        self.advance();
                        return self.token(Kind::Operator, dollar);
                    }
                }
                0 => return self.error(start),
                _ => self.advance(),
            }
        }
        self.advance();
        self.token(Kind::TemplateEnd, start)
    }

    fn is_start_of_regex(&self) -> bool {
        let is_operator = |token: &Token, operator: &[u8]| {
            token.kind == Kind::Operator && self.input.get(token.start as usize..token.end as usize) == Some(operator)
        };
        match self.tokens.as_slice() {
            [] => true,
            [before @ .., previous] if is_operator(previous, b"!") => {
                // It negates what follows it. After one of these it asserts that what is before it is not null.
                !before.last().is_some_and(|it| matches!(it.kind, Kind::Identifier | Kind::Character(b')' | b']')))
            }
            [.., previous] => matches!(previous.kind, Kind::Operator | Kind::Character(b'(' | b'[' | b',' | b':')),
        }
    }

    fn scan_regex(&mut self, start: usize) -> Token {
        self.advance();
        let (mut is_in_escape, mut is_in_character_class) = (false, false);
        loop {
            match self.peek() {
                0 => return self.error(start),
                _ if is_in_escape => is_in_escape = false,
                b'\\' => is_in_escape = true,
                b'[' => is_in_character_class = true,
                b']' => is_in_character_class = false,
                b'/' if !is_in_character_class => break,
                _ => {}
            }
            self.advance();
        }
        self.advance();
        let body = self.token(Kind::RegExpBody, start);
        if !self.peek().is_ascii_alphabetic() {
            return body;
        }
        self.tokens.push(body);
        let flags_start = self.index;
        while self.peek().is_ascii_alphabetic() {
            self.advance();
        }
        self.token(Kind::RegExpFlags, flags_start)
    }
}
