use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_alloc::ArenaVecExt as _;
use bun_ast as js_ast;
use bun_ast::LexerLog;
use bun_core::strings;
use bun_core::strings::CodePoint;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[allow(non_camel_case_types)]
pub enum T {
    t_end_of_file,

    t_open_paren,
    t_close_paren,
    t_open_bracket,
    t_open_bracket_double,

    t_close_bracket,
    t_close_bracket_double,

    t_open_brace,
    t_close_brace,

    t_numeric_literal,

    t_comma,

    t_string_literal,
    t_dot,

    t_equal,

    t_true,
    t_false,

    t_colon,

    t_identifier,

    t_plus,
    t_minus,

    t_empty_array,
}

bun_core::comptime_string_map! {
    static KEYWORDS: T = {
        b"true" => T::t_true,
        b"false" => T::t_false,
    };
}

pub struct Lexer<'a> {
    // Borrowed (`&'a Source`) rather than owned so
    // `identifier`/`string_literal_slice` can borrow `&'a [u8]` from
    // `source.contents` without a self-referential struct.
    // `bun_ast::Source.contents` is `Cow<'static,[u8]>` so an owned copy
    // would tie those slices to `&self` instead of `'a`.
    pub source: &'a bun_ast::Source,
    pub log: &'a mut bun_ast::Log,
    pub start: usize,
    pub end: usize,
    pub current: usize,

    pub bump: &'a Arena,

    pub code_point: CodePoint,
    pub identifier: &'a [u8],
    pub number: f64,
    pub prev_error_loc: bun_ast::Loc,
    pub string_literal_slice: &'a [u8],
    pub string_literal_is_ascii: bool,
    pub line_number: u32,
    pub token: T,
    pub allow_double_bracket: bool,

    pub has_newline_before: bool,

    pub should_redact_logs: bool,
}

#[derive(thiserror::Error, Debug, Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Error {
    #[error("UTF8Fail")]
    UTF8Fail,
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("SyntaxError")]
    SyntaxError,
    #[error("UnexpectedSyntax")]
    UnexpectedSyntax,
    #[error("JSONStringsMustUseDoubleQuotes")]
    JSONStringsMustUseDoubleQuotes,
    #[error("ParserError")]
    ParserError,
}

bun_core::oom_from_alloc!(Error);

bun_core::named_error_set!(Error);

impl<'a> LexerLog<'a> for Lexer<'a> {
    type Err = Error;
    #[inline]
    fn log_mut(&mut self) -> &mut bun_ast::Log {
        &mut *self.log
    }
    #[inline]
    fn source(&self) -> &'a bun_ast::Source {
        self.source
    }
    #[inline]
    fn prev_error_loc_mut(&mut self) -> &mut bun_ast::Loc {
        &mut self.prev_error_loc
    }
    #[inline]
    fn start(&self) -> usize {
        self.start
    }
    #[inline]
    fn should_redact(&self) -> bool {
        self.should_redact_logs
    }
    #[inline]
    fn syntax_err() -> Error {
        Error::SyntaxError
    }
}

impl<'a> bun_ast::lexer_log::EscapeLexer<'a> for Lexer<'a> {
    type Buf = bun_alloc::ArenaVec<'a, u8>;
    const LEGACY_ERROR_SPANS: bool = true;
    #[inline]
    fn end_mut(&mut self) -> &mut usize {
        &mut self.end
    }
    #[inline]
    fn push_codepoint(buf: &mut Self::Buf, c: u32) {
        if c <= 127 {
            buf.push(c as u8);
        } else {
            let mut part: [u8; 4] = [0; 4];
            let len = strings::encode_wtf8_rune(&mut part, c);
            buf.extend_from_slice(&part[0..len]);
        }
    }
}

impl<'a> crate::number_scan::DecimalLexer<'a> for Lexer<'a> {
    #[inline]
    fn code_point(&self) -> CodePoint {
        self.code_point
    }
    #[inline]
    fn end(&self) -> usize {
        self.end
    }
    #[inline]
    fn end_mut(&mut self) -> &mut usize {
        &mut self.end
    }
    #[inline]
    fn step(&mut self) {
        Lexer::step(self)
    }
}

impl<'a> Lexer<'a> {
    #[inline]
    pub fn loc(&self) -> bun_ast::Loc {
        bun_ast::usize2loc(self.start)
    }

    #[inline(always)]
    fn next_codepoint(&mut self) -> CodePoint {
        strings::lexer_step::next_codepoint(&self.source.contents, &mut self.current, &mut self.end)
    }

    #[inline]
    fn step(&mut self) {
        self.code_point = self.next_codepoint();

        self.line_number += (self.code_point == '\n' as CodePoint) as u32;
    }

    fn parse_numeric_literal_or_dot(&mut self) -> Result<(), Error> {
        // Number or dot;
        let first = self.code_point;
        self.step();

        // Dot without a digit after it;
        if first == '.' as CodePoint
            && (self.code_point < '0' as CodePoint || self.code_point > '9' as CodePoint)
        {
            // "."
            self.token = T::t_dot;
            return Ok(());
        }

        let mut underscore_count: usize = 0;
        let mut last_underscore_end: usize = 0;
        let mut has_dot_or_exponent = first == '.' as CodePoint;
        let mut base: f32 = 0.0;

        let mut is_legacy_octal_literal = false;

        // Assume this is a number, but potentially change to a date/time later;
        self.token = T::t_numeric_literal;

        // Check for binary, octal, or hexadecimal literal;
        if first == '0' as CodePoint {
            match self.code_point {
                c if c == 'b' as CodePoint || c == 'B' as CodePoint => {
                    base = 2.0;
                }

                c if c == 'o' as CodePoint || c == 'O' as CodePoint => {
                    base = 8.0;
                }

                c if c == 'x' as CodePoint || c == 'X' as CodePoint => {
                    base = 16.0;
                }

                c if (('0' as CodePoint..='7' as CodePoint).contains(&c))
                    || c == '_' as CodePoint =>
                {
                    base = 8.0;
                    is_legacy_octal_literal = true;
                }
                _ => {}
            }
        }

        if base != 0.0 {
            // Integer literal;
            let mut is_first = true;
            let mut is_invalid_legacy_octal_literal = false;
            self.number = 0.0;
            if !is_legacy_octal_literal {
                self.step();
            }

            'integer_literal: loop {
                match self.code_point {
                    c if c == '_' as CodePoint => {
                        // Cannot have multiple underscores in a row;
                        if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                            self.syntax_error()?;
                        }

                        // The first digit must exist;
                        if is_first || is_legacy_octal_literal {
                            self.syntax_error()?;
                        }

                        last_underscore_end = self.end;
                        underscore_count += 1;
                    }

                    c if c == '0' as CodePoint || c == '1' as CodePoint => {
                        self.number =
                            self.number * base as f64 + float64(self.code_point - '0' as CodePoint);
                    }

                    c if ('2' as CodePoint..='7' as CodePoint).contains(&c) => {
                        if base == 2.0 {
                            self.syntax_error()?;
                        }
                        self.number =
                            self.number * base as f64 + float64(self.code_point - '0' as CodePoint);
                    }
                    c if c == '8' as CodePoint || c == '9' as CodePoint => {
                        if is_legacy_octal_literal {
                            is_invalid_legacy_octal_literal = true;
                        } else if base < 10.0 {
                            self.syntax_error()?;
                        }
                        self.number =
                            self.number * base as f64 + float64(self.code_point - '0' as CodePoint);
                    }
                    c if ('A' as CodePoint..='F' as CodePoint).contains(&c) => {
                        if base != 16.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base as f64
                            + float64(self.code_point + 10 - 'A' as CodePoint);
                    }

                    c if ('a' as CodePoint..='f' as CodePoint).contains(&c) => {
                        if base != 16.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base as f64
                            + float64(self.code_point + 10 - 'a' as CodePoint);
                    }
                    _ => {
                        // The first digit must exist;
                        if is_first {
                            self.syntax_error()?;
                        }

                        break 'integer_literal;
                    }
                }

                self.step();
                is_first = false;
            }

            let is_big_integer_literal =
                self.code_point == 'n' as CodePoint && !has_dot_or_exponent;

            // Slow path: do we need to re-scan the input as text?
            if is_big_integer_literal || is_invalid_legacy_octal_literal {
                let text = self.raw();

                // Can't use a leading zero for bigint literals;
                if is_big_integer_literal && is_legacy_octal_literal {
                    self.syntax_error()?;
                }

                // Filter out underscores;
                if underscore_count > 0 {
                    let bytes = self
                        .bump
                        .alloc_slice_fill_default::<u8>(text.len() - underscore_count);
                    let mut i: usize = 0;
                    for &char_ in text {
                        if char_ != b'_' {
                            bytes[i] = char_;
                            i += 1;
                        }
                    }
                    // `bytes` is intentionally discarded here.
                }

                // Store bigints as text to avoid precision loss;
                if is_big_integer_literal {
                    self.identifier = text;
                } else if is_invalid_legacy_octal_literal {
                    match bun_core::wtf::parse_double(text) {
                        Ok(num) => {
                            self.number = num;
                        }
                        Err(_) => {
                            self.add_syntax_error(
                                self.start,
                                format_args!("Invalid number {}", bstr::BStr::new(text)),
                            )?;
                        }
                    }
                }
            }
        } else {
            // Floating-point literal;
            let scan = crate::number_scan::scan_decimal_digits(self, first)?;
            underscore_count = scan.underscore_count;
            has_dot_or_exponent = scan.has_dot_or_exponent;

            // Take a slice of the text to parse;
            let mut text: &[u8] = self.raw();

            // Filter out underscores;
            if underscore_count > 0 {
                let mut i: usize = 0;
                let bytes = self
                    .bump
                    .alloc_slice_fill_default::<u8>(text.len() - underscore_count);
                for &char_ in text {
                    if char_ != b'_' {
                        bytes[i] = char_;
                        i += 1;
                    }
                }
                text = bytes;
            }

            if !has_dot_or_exponent && self.end - self.start < 10 {
                // Parse a 32-bit integer (very fast path);
                let mut number: u32 = 0;
                for &c in text {
                    number = number * 10 + u32::from(c - b'0');
                }
                self.number = number as f64;
            } else {
                // Parse a double-precision floating-point number;
                match bun_core::wtf::parse_double(text) {
                    Ok(num) => {
                        self.number = num;
                    }
                    Err(_) => {
                        self.add_syntax_error(self.start, format_args!("Invalid number"))?;
                    }
                }
            }
        }

        Ok(())
    }

    #[inline]
    pub fn expect(&mut self, token: T) -> Result<(), Error> {
        if self.token != token {
            self.expected(token)?;
        }

        self.next()
    }

    #[inline]
    pub fn expect_assignment(&mut self) -> Result<(), Error> {
        match self.token {
            T::t_equal | T::t_colon => {}
            _ => {
                self.expected(T::t_equal)?;
            }
        }

        self.next()
    }

    pub fn next(&mut self) -> Result<(), Error> {
        self.has_newline_before = self.end == 0;

        loop {
            self.start = self.end;
            self.token = T::t_end_of_file;

            match self.code_point {
                -1 => {
                    self.token = T::t_end_of_file;
                }

                c if c == '\r' as CodePoint
                    || c == '\n' as CodePoint
                    || c == 0x2028
                    || c == 0x2029 =>
                {
                    self.step();
                    self.has_newline_before = true;
                    continue;
                }

                c if c == '\t' as CodePoint || c == ' ' as CodePoint => {
                    self.step();
                    continue;
                }

                c if c == '[' as CodePoint => {
                    self.step();
                    self.token = T::t_open_bracket;
                    if self.code_point == '[' as CodePoint && self.allow_double_bracket {
                        self.step();
                        self.token = T::t_open_bracket_double;
                        return Ok(());
                    }

                    if self.code_point == ']' as CodePoint {
                        self.step();
                        self.token = T::t_empty_array;
                    }
                }
                c if c == ']' as CodePoint => {
                    self.step();
                    self.token = T::t_close_bracket;

                    if self.code_point == ']' as CodePoint && self.allow_double_bracket {
                        self.step();
                        self.token = T::t_close_bracket_double;
                    }
                }
                c if c == '+' as CodePoint => {
                    self.step();
                    self.token = T::t_plus;
                }
                c if c == '-' as CodePoint => {
                    self.step();
                    self.token = T::t_minus;
                }

                c if c == '{' as CodePoint => {
                    self.step();
                    self.token = T::t_open_brace;
                }
                c if c == '}' as CodePoint => {
                    self.step();
                    self.token = T::t_close_brace;
                }

                c if c == '=' as CodePoint => {
                    self.step();
                    self.token = T::t_equal;
                }
                c if c == ':' as CodePoint => {
                    self.step();
                    self.token = T::t_colon;
                }
                c if c == ',' as CodePoint => {
                    self.step();
                    self.token = T::t_comma;
                }
                c if c == ';' as CodePoint => {
                    if self.has_newline_before {
                        self.step();

                        'single_line_comment: loop {
                            self.step();
                            match self.code_point {
                                c if c == '\r' as CodePoint
                                    || c == '\n' as CodePoint
                                    || c == 0x2028
                                    || c == 0x2029 =>
                                {
                                    break 'single_line_comment;
                                }
                                -1 => {
                                    break 'single_line_comment;
                                }
                                _ => {}
                            }
                        }
                        continue;
                    }

                    self.add_default_error(b"Unexpected semicolon")?;
                }
                c if c == '#' as CodePoint => {
                    self.step();

                    'single_line_comment: loop {
                        self.step();
                        match self.code_point {
                            c if c == '\r' as CodePoint
                                || c == '\n' as CodePoint
                                || c == 0x2028
                                || c == 0x2029 =>
                            {
                                break 'single_line_comment;
                            }
                            -1 => {
                                break 'single_line_comment;
                            }
                            _ => {}
                        }
                    }
                    continue;
                }

                // unescaped string
                c if c == '\'' as CodePoint => {
                    self.step();
                    self.string_literal_is_ascii = true;
                    let start = self.end;
                    let mut is_multiline_string_literal = false;

                    if self.code_point == '\'' as CodePoint {
                        self.step();
                        // it's a multiline string literal
                        if self.code_point == '\'' as CodePoint {
                            self.step();
                            is_multiline_string_literal = true;
                        } else {
                            // it's an empty string
                            self.token = T::t_string_literal;
                            self.string_literal_slice = &self.source.contents[start..start];
                            return Ok(());
                        }
                    }

                    if is_multiline_string_literal {
                        loop {
                            match self.code_point {
                                -1 => {
                                    self.add_default_error(b"Unterminated string literal")?;
                                }
                                c if c == '\'' as CodePoint => {
                                    let end = self.end;
                                    self.step();
                                    if self.code_point != '\'' as CodePoint {
                                        continue;
                                    }
                                    self.step();
                                    if self.code_point != '\'' as CodePoint {
                                        continue;
                                    }
                                    self.step();
                                    self.token = T::t_string_literal;
                                    self.string_literal_slice =
                                        &self.source.contents[start + 2..end];
                                    return Ok(());
                                }
                                _ => {}
                            }
                            self.step();
                        }
                    } else {
                        loop {
                            match self.code_point {
                                c if c == '\r' as CodePoint
                                    || c == '\n' as CodePoint
                                    || c == 0x2028
                                    || c == 0x2029 =>
                                {
                                    self.add_default_error(
                                        b"Unterminated string literal (single-line)",
                                    )?;
                                }
                                -1 => {
                                    self.add_default_error(b"Unterminated string literal")?;
                                }
                                c if c == '\'' as CodePoint => {
                                    self.step();
                                    self.token = T::t_string_literal;
                                    self.string_literal_slice =
                                        &self.source.contents[start..self.end - 1];
                                    return Ok(());
                                }
                                _ => {}
                            }
                            self.step();
                        }
                    }
                }
                c if c == '"' as CodePoint => {
                    self.step();
                    let mut needs_slow_pass = false;
                    let start = self.end;
                    let mut is_multiline_string_literal = false;
                    self.string_literal_is_ascii = true;

                    if self.code_point == '"' as CodePoint {
                        self.step();
                        // it's a multiline basic string
                        if self.code_point == '"' as CodePoint {
                            self.step();
                            is_multiline_string_literal = true;
                        } else {
                            // it's an empty string
                            self.token = T::t_string_literal;
                            self.string_literal_slice = &self.source.contents[start..start];
                            return Ok(());
                        }
                    }

                    // Capture the slice bounds as indices instead of laundering
                    // a `&'a [u8]` through a raw pointer. On the fast
                    // path we reslice immediately before `return`; on the slow path we
                    // reslice after the loop and hand it straight to
                    // `decode_escape_sequences` without stashing in `self` first.
                    let slice_lo: usize;
                    let slice_hi: usize;
                    if is_multiline_string_literal {
                        loop {
                            match self.code_point {
                                -1 => {
                                    self.add_default_error(b"Unterminated basic string")?;
                                }
                                c if c == '\\' as CodePoint => {
                                    self.step();
                                    needs_slow_pass = true;
                                    if self.code_point == '"' as CodePoint {
                                        self.step();
                                        continue;
                                    }
                                }
                                c if c == '"' as CodePoint => {
                                    let end = self.end;
                                    self.step();
                                    if self.code_point != '"' as CodePoint {
                                        continue;
                                    }
                                    self.step();
                                    if self.code_point != '"' as CodePoint {
                                        continue;
                                    }
                                    self.step();

                                    self.token = T::t_string_literal;
                                    if needs_slow_pass {
                                        slice_lo = start + 2;
                                        slice_hi = end;
                                        break;
                                    }
                                    self.string_literal_slice =
                                        &self.source.contents[start + 2..end];
                                    return Ok(());
                                }
                                _ => {}
                            }
                            self.step();
                        }
                    } else {
                        loop {
                            match self.code_point {
                                c if c == '\r' as CodePoint
                                    || c == '\n' as CodePoint
                                    || c == 0x2028
                                    || c == 0x2029 =>
                                {
                                    self.add_default_error(
                                        b"Unterminated basic string (single-line)",
                                    )?;
                                }
                                -1 => {
                                    self.add_default_error(b"Unterminated basic string")?;
                                }
                                c if c == '\\' as CodePoint => {
                                    self.step();
                                    needs_slow_pass = true;
                                    if self.code_point == '"' as CodePoint {
                                        self.step();
                                        continue;
                                    }
                                }
                                c if c == '"' as CodePoint => {
                                    self.step();

                                    self.token = T::t_string_literal;
                                    if needs_slow_pass {
                                        slice_lo = start;
                                        slice_hi = self.end - 1;
                                        break;
                                    }
                                    self.string_literal_slice =
                                        &self.source.contents[start..self.end - 1];
                                    return Ok(());
                                }
                                _ => {}
                            }
                            self.step();
                        }
                    }

                    self.start = start;
                    if needs_slow_pass {
                        let text = &self.source.contents[slice_lo..slice_hi];
                        let mut array_list =
                            bun_alloc::ArenaVec::with_capacity_in(text.len(), self.bump);
                        if is_multiline_string_literal {
                            self.decode_escape_sequences::<true>(start, text, &mut array_list)?;
                        } else {
                            self.decode_escape_sequences::<false>(start, text, &mut array_list)?;
                        }
                        self.string_literal_slice = array_list.into_bump_slice();
                        self.string_literal_is_ascii = false;
                    }

                    self.token = T::t_string_literal;
                }

                c if c == '.' as CodePoint
                    || ('0' as CodePoint..='9' as CodePoint).contains(&c) =>
                {
                    self.parse_numeric_literal_or_dot()?;
                }

                c if c == '@' as CodePoint
                    || ('a' as CodePoint..='z' as CodePoint).contains(&c)
                    || ('A' as CodePoint..='Z' as CodePoint).contains(&c)
                    || c == '$' as CodePoint
                    || c == '_' as CodePoint =>
                {
                    self.step();
                    while is_identifier_part(self.code_point) {
                        self.step();
                    }
                    self.identifier = self.raw();
                    self.token = KEYWORDS
                        .get(self.identifier)
                        .copied()
                        .unwrap_or(T::t_identifier);
                }

                _ => self.unexpected()?,
            }
            return Ok(());
        }
    }

    pub fn decode_escape_sequences<const ALLOW_MULTILINE: bool>(
        &mut self,
        start: usize,
        text: &[u8],
        buf: &mut bun_alloc::ArenaVec<'a, u8>,
    ) -> Result<(), Error> {
        // Multiline basic strings permit line continuations but reject `\x`;
        // single-line basic strings are the inverse.
        bun_ast::lexer_log::decode_escape_sequences::<_, ALLOW_MULTILINE, ALLOW_MULTILINE>(
            self, start, text, buf,
        )
    }

    pub fn expected(&mut self, token: T) -> Result<(), Error> {
        self.expected_string(<&'static str>::from(token).as_bytes())
    }

    pub fn unexpected(&mut self) -> Result<(), Error> {
        let found: &[u8] = 'finder: {
            self.start = self.start.min(self.end);

            if self.start == self.source.contents.len() {
                break 'finder b"end of file";
            } else {
                break 'finder self.raw();
            }
        };

        // Compute the range before borrowing `found` from source.
        let range = self.range();
        self.add_range_error(range, format_args!("Unexpected {}", bstr::BStr::new(found)))
    }

    pub fn expected_string(&mut self, text: &[u8]) -> Result<(), Error> {
        let found: &[u8] = 'finder: {
            if self.source.contents.len() != self.start {
                break 'finder self.raw();
            } else {
                break 'finder b"end of file";
            }
        };

        let range = self.range();
        self.add_range_error(
            range,
            format_args!(
                "Expected {} but found {}",
                bstr::BStr::new(text),
                bstr::BStr::new(found)
            ),
        )
    }

    pub fn range(&self) -> bun_ast::Range {
        bun_ast::Range {
            loc: bun_ast::usize2loc(self.start),
            len: (self.end - self.start) as i32,
        }
    }

    pub fn init(
        log: &'a mut bun_ast::Log,
        source: &'a bun_ast::Source,
        bump: &'a Arena,
        redact_logs: bool,
    ) -> Result<Lexer<'a>, Error> {
        let mut lex = Lexer {
            source,
            log,
            start: 0,
            end: 0,
            current: 0,
            bump,
            code_point: -1,
            identifier: b"",
            number: 0.0,
            prev_error_loc: bun_ast::Loc::EMPTY,
            string_literal_slice: b"",
            string_literal_is_ascii: true,
            line_number: 0,
            token: T::t_end_of_file,
            allow_double_bracket: true,
            has_newline_before: false,
            should_redact_logs: redact_logs,
        };
        lex.step();
        lex.next()?;

        Ok(lex)
    }

    #[inline]
    pub fn to_string(&self, loc_: bun_ast::Loc) -> js_ast::Expr {
        if self.string_literal_is_ascii {
            return js_ast::Expr::init(js_ast::E::String::init(self.string_literal_slice), loc_);
        }

        js_ast::Expr::init(js_ast::E::String::init(self.string_literal_slice), loc_)
    }

    pub fn raw(&self) -> &'a [u8] {
        &self.source.contents[self.start..self.end]
    }
}

pub(crate) fn is_identifier_part(code_point: CodePoint) -> bool {
    matches!(code_point as u32 as u8 as char,
        '0'..='9'
        | 'a'..='z'
        | 'A'..='Z'
        | '$'
        | '_'
        | '-'
        | ':'
    ) && (0..=127).contains(&code_point)
    // The `(0..=127)` bound is required for the byte cast above to be sound.
}

#[inline]
fn float64(num: CodePoint) -> f64 {
    num as f64
}
