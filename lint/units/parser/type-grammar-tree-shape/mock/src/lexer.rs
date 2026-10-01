#![allow(dead_code)]
use bun_ast::{Loc, Log, Range, Source};
use std::fmt;

include!("tokens.rs.inc");

impl T {
    pub fn is_reserved_word(self) -> bool {
        (self as u8) >= (T::TBreak as u8) && (self as u8) <= (T::TWith as u8)
    }
    pub fn is_assign(self) -> bool {
        (self as u8) >= (T::TAmpersandAmpersandEquals as u8) && (self as u8) <= (T::TSlashEquals as u8)
    }
}

fn keyword(s: &[u8]) -> Option<T> {
    Some(match s {
        b"break" => T::TBreak, b"case" => T::TCase, b"catch" => T::TCatch, b"class" => T::TClass, b"const" => T::TConst,
        b"continue" => T::TContinue, b"debugger" => T::TDebugger, b"default" => T::TDefault, b"delete" => T::TDelete,
        b"do" => T::TDo, b"else" => T::TElse, b"enum" => T::TEnum, b"export" => T::TExport, b"extends" => T::TExtends,
        b"false" => T::TFalse, b"finally" => T::TFinally, b"for" => T::TFor, b"function" => T::TFunction, b"if" => T::TIf,
        b"import" => T::TImport, b"in" => T::TIn, b"instanceof" => T::TInstanceof, b"new" => T::TNew, b"null" => T::TNull,
        b"return" => T::TReturn, b"super" => T::TSuper, b"switch" => T::TSwitch, b"this" => T::TThis, b"throw" => T::TThrow,
        b"true" => T::TTrue, b"try" => T::TTry, b"typeof" => T::TTypeof, b"var" => T::TVar, b"void" => T::TVoid,
        b"while" => T::TWhile, b"with" => T::TWith,
        _ => return None,
    })
}

fn token_to_string(t: T) -> &'static str {
    match t {
        T::TEndOfFile => "end of file", T::TStringLiteral => "string", T::TNumericLiteral => "number", T::TBigIntegerLiteral => "bigint",
        T::TIdentifier => "identifier", T::TOpenParen => "\"(\"", T::TCloseParen => "\")\"", T::TOpenBracket => "\"[\"",
        T::TCloseBracket => "\"]\"", T::TOpenBrace => "\"{\"", T::TCloseBrace => "\"}\"", T::TColon => "\":\"", T::TComma => "\",\"",
        T::TQuestion => "\"?\"", T::TEqualsGreaterThan => "\"=>\"", T::TGreaterThan => "\">\"", T::TLessThan => "\"<\"",
        T::TSemicolon => "\";\"", T::TExtends => "\"extends\"", T::TIn => "\"in\"", T::TEquals => "\"=\"", T::TDot => "\".\"",
        _ => "",
    }
}

pub fn is_type_script_accessibility_modifier(s: &[u8]) -> bool {
    matches!(s, b"public" | b"private" | b"override" | b"readonly" | b"protected")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error { UTF8Fail, OutOfMemory, SyntaxError, UnexpectedSyntax, ParserError, Backtrack }

#[derive(Clone, Copy)]
pub struct LexerSnapshot<'a> {
    pub(crate) current: usize,
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) token: T,
    pub(crate) has_newline_before: bool,
    pub(crate) is_log_disabled: bool,
    pub(crate) identifier: &'a [u8],
    pub(crate) prev_error_loc: Loc,
    pub(crate) all_comments_len: usize,
    pub(crate) comments_to_preserve_before_len: usize,
}

pub struct Lexer<'a> {
    pub(crate) log: *mut Log,
    pub(crate) source: &'a Source,
    pub(crate) contents: &'a [u8],
    pub current: usize,
    pub(crate) start: usize,
    pub end: usize,
    pub token: T,
    pub(crate) has_newline_before: bool,
    pub(crate) is_log_disabled: bool,
    pub(crate) identifier: &'a [u8],
    pub(crate) prev_error_loc: Loc,
    pub(crate) tokens_scanned: usize,
    pub(crate) all_comments: Vec<u8>,
    pub(crate) comments_to_preserve_before: Vec<u8>,
}

impl<'a> Lexer<'a> {
    pub fn init(log: *mut Log, source: &'a Source) -> Self {
        Lexer {
            log, source, contents: &source.contents, current: 0, start: 0, end: 0, token: T::TEndOfFile,
            has_newline_before: false, is_log_disabled: false, identifier: b"", prev_error_loc: Loc::EMPTY, tokens_scanned: 0, all_comments: Vec::new(), comments_to_preserve_before: Vec::new(),
        }
    }
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn log(&self) -> &mut Log { unsafe { &mut *self.log } }
    pub fn loc(&self) -> Loc { bun_ast::usize2loc(self.start) }
    pub(crate) fn snapshot(&self) -> LexerSnapshot<'a> {
        LexerSnapshot {
            current: self.current, start: self.start, end: self.end, token: self.token, has_newline_before: self.has_newline_before,
            is_log_disabled: self.is_log_disabled, identifier: self.identifier, prev_error_loc: self.prev_error_loc,
            all_comments_len: 0, comments_to_preserve_before_len: 0,
        }
    }
    pub(crate) fn restore(&mut self, o: &LexerSnapshot<'a>) {
        self.current = o.current; self.start = o.start; self.end = o.end; self.token = o.token;
        self.has_newline_before = o.has_newline_before; self.is_log_disabled = o.is_log_disabled;
        self.identifier = o.identifier; self.prev_error_loc = o.prev_error_loc;
    }
    #[inline]
    pub(crate) fn is_identifier_or_keyword(&self) -> bool { (self.token as u32) >= (T::TIdentifier as u32) }
    pub(crate) fn raw(&self) -> &'a [u8] { &self.contents[self.start.min(self.end)..self.end] }
    pub(crate) fn range(&self) -> Range { Range { loc: bun_ast::usize2loc(self.start), len: (self.end.saturating_sub(self.start)) as i32 } }
    pub(crate) fn is_contextual_keyword(&self, keyword: &'static [u8]) -> bool { self.token == T::TIdentifier && self.raw() == keyword }

    fn add_range_error(&mut self, r: Range, args: fmt::Arguments<'_>) -> Result<(), Error> {
        if self.is_log_disabled { return Ok(()); }
        if r.loc.eql(self.prev_error_loc) { return Ok(()); }
        self.log().add_range_error_fmt(Some(self.source), r, args);
        self.prev_error_loc = r.loc;
        Ok(())
    }
    pub(crate) fn expected(&mut self, token: T) -> Result<(), Error> {
        if self.is_log_disabled {
            return Err(Error::Backtrack);
        } else if !token_to_string(token).is_empty() {
            let found = if self.contents.len() != self.start { String::from_utf8_lossy(self.raw()).into_owned() } else { "end of file".to_string() };
            self.add_range_error(self.range(), format_args!("Expected {} but found \"{}\"", token_to_string(token), found))
        } else {
            self.unexpected()
        }
    }
    pub(crate) fn unexpected(&mut self) -> Result<(), Error> {
        self.start = self.start.min(self.end);
        let found = if self.start == self.contents.len() { "end of file".to_string() } else { String::from_utf8_lossy(self.raw()).into_owned() };
        self.add_range_error(self.range(), format_args!("Unexpected {}", found))
    }
    #[inline]
    pub fn expect(&mut self, token: T) -> Result<(), Error> {
        if self.token != token { self.expected(token)?; }
        self.next()
    }
    pub(crate) fn expect_or_insert_semicolon(&mut self) -> Result<(), Error> {
        if self.token == T::TSemicolon || (!self.has_newline_before && self.token != T::TCloseBrace && self.token != T::TEndOfFile) {
            self.expect(T::TSemicolon)?;
        }
        Ok(())
    }
    pub(crate) fn expect_contextual_keyword(&mut self, keyword: &'static [u8]) -> Result<(), Error> {
        if !self.is_contextual_keyword(keyword) {
            let _ = self.add_range_error(self.range(), format_args!("Expected \"{}\"", String::from_utf8_lossy(keyword)));
            return Err(Error::UnexpectedSyntax);
        }
        self.next()
    }
    fn peek(&self, off: usize) -> u8 { self.contents.get(self.current + off).copied().unwrap_or(0) }
    fn maybe_expand_equals(&mut self) -> Result<(), Error> {
        match self.peek(0) {
            b'>' => { self.token = T::TEqualsGreaterThan; self.current += 1; self.end = self.current; }
            b'=' => {
                self.token = T::TEqualsEquals; self.current += 1;
                if self.peek(0) == b'=' { self.token = T::TEqualsEqualsEquals; self.current += 1; }
                self.end = self.current;
            }
            _ => {}
        }
        Ok(())
    }
    pub(crate) fn expect_less_than<const IS_INSIDE_JSX_ELEMENT: bool>(&mut self) -> Result<(), Error> {
        match self.token {
            T::TLessThan => self.next()?,
            T::TLessThanEquals => { self.token = T::TEquals; self.start += 1; self.maybe_expand_equals()?; }
            T::TLessThanLessThan => { self.token = T::TLessThan; self.start += 1; }
            T::TLessThanLessThanEquals => { self.token = T::TLessThanEquals; self.start += 1; }
            _ => self.expected(T::TLessThan)?,
        }
        Ok(())
    }
    pub(crate) fn expect_greater_than<const IS_INSIDE_JSX_ELEMENT: bool>(&mut self) -> Result<(), Error> {
        match self.token {
            T::TGreaterThan => self.next()?,
            T::TGreaterThanEquals => { self.token = T::TEquals; self.start += 1; self.maybe_expand_equals()?; }
            T::TGreaterThanGreaterThanEquals => { self.token = T::TGreaterThanEquals; self.start += 1; }
            T::TGreaterThanGreaterThanGreaterThanEquals => { self.token = T::TGreaterThanGreaterThanEquals; self.start += 1; }
            T::TGreaterThanGreaterThan => { self.token = T::TGreaterThan; self.start += 1; }
            T::TGreaterThanGreaterThanGreaterThan => { self.token = T::TGreaterThanGreaterThan; self.start += 1; }
            _ => self.expected(T::TGreaterThan)?,
        }
        Ok(())
    }
    pub(crate) fn expect_inside_jsx_element(&mut self, token: T) -> Result<(), Error> { self.expect(token) }
    pub(crate) fn rescan_close_brace_as_template_token(&mut self) -> Result<(), Error> {
        if self.token != T::TCloseBrace { self.expected(T::TCloseBrace)?; }
        // the "}" was just read: continue the template after it
        self.start = self.end.saturating_sub(1);
        self.current = self.end;
        self.scan_template(T::TTemplateMiddle, T::TTemplateTail)
    }
    fn scan_template(&mut self, on_substitution: T, on_end: T) -> Result<(), Error> {
        loop {
            match self.peek(0) {
                0 if self.current >= self.contents.len() => {
                    self.end = self.current;
                    self.token = T::TSyntaxError;
                    let _ = self.add_range_error(self.range(), format_args!("Unterminated template literal"));
                    return Err(Error::SyntaxError);
                }
                b'`' => { self.current += 1; self.token = on_end; break; }
                b'$' if self.peek(1) == b'{' => { self.current += 2; self.token = on_substitution; break; }
                b'\\' => { self.current += 2; }
                _ => { self.current += 1; }
            }
        }
        self.current = self.current.min(self.contents.len());
        self.end = self.current;
        Ok(())
    }
    fn is_ident_start(c: u8) -> bool { c == b'_' || c == b'$' || c.is_ascii_alphabetic() || c >= 0x80 }
    fn is_ident_part(c: u8) -> bool { Self::is_ident_start(c) || c.is_ascii_digit() }

    pub fn next(&mut self) -> Result<(), Error> {
        self.tokens_scanned += 1;
        self.has_newline_before = self.end == 0;
        loop {
            self.start = self.current;
            if self.current >= self.contents.len() {
                self.end = self.current;
                self.token = T::TEndOfFile;
                return Ok(());
            }
            let c = self.contents[self.current];
            self.current += 1;
            macro_rules! tok { ($t:expr) => {{ self.token = $t; break; }}; }
            macro_rules! eat { ($ch:expr) => {{ if self.peek(0) == $ch { self.current += 1; true } else { false } }}; }
            match c {
                b'\n' | b'\r' => { self.has_newline_before = true; continue; }
                b' ' | b'\t' => continue,
                b'/' => {
                    if self.peek(0) == b'/' {
                        while self.current < self.contents.len() && self.contents[self.current] != b'\n' { self.current += 1; }
                        continue;
                    }
                    if self.peek(0) == b'*' {
                        self.current += 1;
                        while self.current < self.contents.len() && !(self.contents[self.current] == b'*' && self.peek(1) == b'/') {
                            if self.contents[self.current] == b'\n' { self.has_newline_before = true; }
                            self.current += 1;
                        }
                        self.current = (self.current + 2).min(self.contents.len());
                        continue;
                    }
                    if eat!(b'=') { tok!(T::TSlashEquals) }
                    tok!(T::TSlash)
                }
                b'(' => tok!(T::TOpenParen), b')' => tok!(T::TCloseParen), b'[' => tok!(T::TOpenBracket), b']' => tok!(T::TCloseBracket),
                b'{' => tok!(T::TOpenBrace), b'}' => tok!(T::TCloseBrace), b',' => tok!(T::TComma), b';' => tok!(T::TSemicolon),
                b':' => tok!(T::TColon), b'@' => tok!(T::TAt), b'~' => tok!(T::TTilde),
                b'?' => {
                    if eat!(b'?') { if eat!(b'=') { tok!(T::TQuestionQuestionEquals) } tok!(T::TQuestionQuestion) }
                    if self.peek(0) == b'.' && !self.peek(1).is_ascii_digit() { self.current += 1; tok!(T::TQuestionDot) }
                    tok!(T::TQuestion)
                }
                b'%' => { if eat!(b'=') { tok!(T::TPercentEquals) } tok!(T::TPercent) }
                b'^' => { if eat!(b'=') { tok!(T::TCaretEquals) } tok!(T::TCaret) }
                b'&' => {
                    if eat!(b'&') { if eat!(b'=') { tok!(T::TAmpersandAmpersandEquals) } tok!(T::TAmpersandAmpersand) }
                    if eat!(b'=') { tok!(T::TAmpersandEquals) }
                    tok!(T::TAmpersand)
                }
                b'|' => {
                    if eat!(b'|') { if eat!(b'=') { tok!(T::TBarBarEquals) } tok!(T::TBarBar) }
                    if eat!(b'=') { tok!(T::TBarEquals) }
                    tok!(T::TBar)
                }
                b'+' => { if eat!(b'+') { tok!(T::TPlusPlus) } if eat!(b'=') { tok!(T::TPlusEquals) } tok!(T::TPlus) }
                b'-' => { if eat!(b'-') { tok!(T::TMinusMinus) } if eat!(b'=') { tok!(T::TMinusEquals) } tok!(T::TMinus) }
                b'*' => {
                    if eat!(b'*') { if eat!(b'=') { tok!(T::TAsteriskAsteriskEquals) } tok!(T::TAsteriskAsterisk) }
                    if eat!(b'=') { tok!(T::TAsteriskEquals) }
                    tok!(T::TAsterisk)
                }
                b'=' => {
                    if eat!(b'>') { tok!(T::TEqualsGreaterThan) }
                    if eat!(b'=') { if eat!(b'=') { tok!(T::TEqualsEqualsEquals) } tok!(T::TEqualsEquals) }
                    tok!(T::TEquals)
                }
                b'!' => { if eat!(b'=') { if eat!(b'=') { tok!(T::TExclamationEqualsEquals) } tok!(T::TExclamationEquals) } tok!(T::TExclamation) }
                b'<' => {
                    if eat!(b'<') { if eat!(b'=') { tok!(T::TLessThanLessThanEquals) } tok!(T::TLessThanLessThan) }
                    if eat!(b'=') { tok!(T::TLessThanEquals) }
                    tok!(T::TLessThan)
                }
                b'>' => {
                    if eat!(b'>') {
                        if eat!(b'>') { if eat!(b'=') { tok!(T::TGreaterThanGreaterThanGreaterThanEquals) } tok!(T::TGreaterThanGreaterThanGreaterThan) }
                        if eat!(b'=') { tok!(T::TGreaterThanGreaterThanEquals) }
                        tok!(T::TGreaterThanGreaterThan)
                    }
                    if eat!(b'=') { tok!(T::TGreaterThanEquals) }
                    tok!(T::TGreaterThan)
                }
                b'\'' | b'"' => {
                    while self.current < self.contents.len() && self.contents[self.current] != c {
                        if self.contents[self.current] == b'\\' { self.current += 1; }
                        self.current += 1;
                    }
                    self.current = (self.current + 1).min(self.contents.len());
                    tok!(T::TStringLiteral)
                }
                b'`' => { return self.scan_template(T::TTemplateHead, T::TNoSubstitutionTemplateLiteral); }
                b'#' => {
                    while self.current < self.contents.len() && Self::is_ident_part(self.contents[self.current]) { self.current += 1; }
                    self.end = self.current;
                    self.identifier = self.raw();
                    tok!(T::TPrivateIdentifier)
                }
                b'.' if !self.peek(0).is_ascii_digit() => {
                    if self.peek(0) == b'.' && self.peek(1) == b'.' { self.current += 2; tok!(T::TDotDotDot) }
                    tok!(T::TDot)
                }
                b'.' | b'0'..=b'9' => {
                    let mut is_bigint = false;
                    if c == b'0' && matches!(self.peek(0), b'x' | b'X' | b'b' | b'B' | b'o' | b'O') {
                        self.current += 1;
                        while self.peek(0).is_ascii_alphanumeric() || self.peek(0) == b'_' { self.current += 1; }
                        if self.contents[self.current - 1] == b'n' { is_bigint = true; }
                    } else {
                        while self.peek(0).is_ascii_digit() || self.peek(0) == b'_' { self.current += 1; }
                        if c != b'.' && self.peek(0) == b'.' {
                            self.current += 1;
                            while self.peek(0).is_ascii_digit() || self.peek(0) == b'_' { self.current += 1; }
                        }
                        if matches!(self.peek(0), b'e' | b'E') && (self.peek(1).is_ascii_digit() || (matches!(self.peek(1), b'+' | b'-') && self.contents.get(self.current + 2).is_some_and(|d| d.is_ascii_digit()))) {
                            self.current += 2;
                            while self.peek(0).is_ascii_digit() { self.current += 1; }
                        }
                        if self.peek(0) == b'n' { self.current += 1; is_bigint = true; }
                    }
                    if is_bigint { tok!(T::TBigIntegerLiteral) }
                    tok!(T::TNumericLiteral)
                }
                _ if Self::is_ident_start(c) || c == b'\\' => {
                    let mut escaped = c == b'\\';
                    while self.current < self.contents.len() && (Self::is_ident_part(self.contents[self.current]) || self.contents[self.current] == b'\\') {
                        if self.contents[self.current] == b'\\' { escaped = true; }
                        self.current += 1;
                    }
                    self.end = self.current;
                    self.identifier = self.raw();
                    if escaped { tok!(T::TIdentifier) }
                    tok!(keyword(self.identifier).unwrap_or(T::TIdentifier))
                }
                _ => tok!(T::TSyntaxError),
            }
        }
        self.end = self.current;
        Ok(())
    }
}
