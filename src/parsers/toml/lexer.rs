use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_alloc::ArenaVecExt as _;
use bun_ast as js_ast;
use bun_ast::LexerLog;
use bun_core::fmt::hex_digit_value_u32;
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

        // TOML date-times (`1979-05-27T07:32:00Z`) and local times (`07:32:00`)
        // also begin with a digit; detect them before the numeric scan consumes
        // the leading digits and leaves `-` / `:` behind as stray tokens.
        // The AST has no date-time node, so the value surfaces as a string.
        if ('0' as CodePoint..='9' as CodePoint).contains(&first) {
            if let Some(len) = scan_date_time(&self.source.contents[self.start..]) {
                self.token = T::t_string_literal;
                self.string_literal_is_ascii = true;
                self.string_literal_slice = &self.source.contents[self.start..self.start + len];
                // Re-sync the cursor to the byte just past the date-time.
                self.current = self.start + len;
                self.step();
                return Ok(());
            }
        }

        // A `.` immediately followed by a complete date-time is the dotted-key
        // separator of e.g. `a.2001-02-08 = 1` (toml-test valid/key/like-date),
        // not the start of a fraction.
        if first == '.' as CodePoint
            && scan_date_time(&self.source.contents[self.start + 1..]).is_some()
        {
            self.step();
            self.token = T::t_dot;
            return Ok(());
        }

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
            let radix = base as u64;
            let mut int_value: u64 = 0;
            let mut int_overflow = false;
            let mut is_first = true;
            let mut is_invalid_legacy_octal_literal = false;
            self.number = 0.0;
            if !is_legacy_octal_literal {
                self.step();
            }

            'integer_literal: loop {
                let mut digit: Option<u64> = None;
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
                        digit = Some((c - '0' as CodePoint) as u64);
                    }

                    c if ('2' as CodePoint..='7' as CodePoint).contains(&c) => {
                        if base == 2.0 {
                            self.syntax_error()?;
                        }
                        digit = Some((c - '0' as CodePoint) as u64);
                    }
                    c if c == '8' as CodePoint || c == '9' as CodePoint => {
                        if is_legacy_octal_literal {
                            is_invalid_legacy_octal_literal = true;
                        } else if base < 10.0 {
                            self.syntax_error()?;
                        }
                        digit = Some((c - '0' as CodePoint) as u64);
                    }
                    c if ('A' as CodePoint..='F' as CodePoint).contains(&c) => {
                        if base != 16.0 {
                            self.syntax_error()?;
                        }
                        digit = Some((c + 10 - 'A' as CodePoint) as u64);
                    }

                    c if ('a' as CodePoint..='f' as CodePoint).contains(&c) => {
                        if base != 16.0 {
                            self.syntax_error()?;
                        }
                        digit = Some((c + 10 - 'a' as CodePoint) as u64);
                    }
                    _ => {
                        // The first digit must exist;
                        if is_first {
                            self.syntax_error()?;
                        }

                        break 'integer_literal;
                    }
                }

                if let Some(digit) = digit {
                    match int_value
                        .checked_mul(radix)
                        .and_then(|v| v.checked_add(digit))
                    {
                        Some(v) => int_value = v,
                        None => int_overflow = true,
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
            } else {
                // Prefixed literals cannot carry a sign, so the bound is i64::MAX.
                self.number = self.check_exact_integer(int_value, int_overflow, i64::MAX as u64)?;
            }
        } else {
            // Floating-point literal;
            let is_invalid_legacy_octal_literal = first == '0' as CodePoint
                && (self.code_point == '8' as CodePoint || self.code_point == '9' as CodePoint);

            // Initial digits;
            loop {
                if self.code_point < '0' as CodePoint || self.code_point > '9' as CodePoint {
                    if self.code_point != '_' as CodePoint {
                        break;
                    }

                    // Cannot have multiple underscores in a row;
                    if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                        self.syntax_error()?;
                    }

                    // The specification forbids underscores in this case;
                    if is_invalid_legacy_octal_literal {
                        self.syntax_error()?;
                    }

                    last_underscore_end = self.end;
                    underscore_count += 1;
                }
                self.step();
            }

            // Fractional digits;
            if first != '.' as CodePoint && self.code_point == '.' as CodePoint {
                // An underscore must not come last;
                if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                    self.end -= 1;
                    self.syntax_error()?;
                }

                has_dot_or_exponent = true;
                self.step();
                if self.code_point == '_' as CodePoint {
                    self.syntax_error()?;
                }
                loop {
                    if self.code_point < '0' as CodePoint || self.code_point > '9' as CodePoint {
                        if self.code_point != '_' as CodePoint {
                            break;
                        }

                        // Cannot have multiple underscores in a row;
                        if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                            self.syntax_error()?;
                        }

                        last_underscore_end = self.end;
                        underscore_count += 1;
                    }
                    self.step();
                }
            }

            // Exponent;
            if self.code_point == 'e' as CodePoint || self.code_point == 'E' as CodePoint {
                // An underscore must not come last;
                if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                    self.end -= 1;
                    self.syntax_error()?;
                }

                has_dot_or_exponent = true;
                self.step();
                if self.code_point == '+' as CodePoint || self.code_point == '-' as CodePoint {
                    self.step();
                }
                if self.code_point < '0' as CodePoint || self.code_point > '9' as CodePoint {
                    self.syntax_error()?;
                }
                loop {
                    if self.code_point < '0' as CodePoint || self.code_point > '9' as CodePoint {
                        if self.code_point != '_' as CodePoint {
                            break;
                        }

                        // Cannot have multiple underscores in a row;
                        if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                            self.syntax_error()?;
                        }

                        last_underscore_end = self.end;
                        underscore_count += 1;
                    }
                    self.step();
                }
            }

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

            if !has_dot_or_exponent {
                // Decimal integer. `text` is all `0-9` here: the initial-digits
                // loop only accepts digits and `_`, and `_` is filtered above.
                if text.len() < 16 {
                    // Fewer than 16 decimal digits is < 10^15 < 2^53: always
                    // exactly representable (very fast path);
                    let mut number: u64 = 0;
                    for &c in text {
                        number = number * 10 + u64::from(c - b'0');
                    }
                    self.number = number as f64;
                } else {
                    let mut int_value: u64 = 0;
                    let mut int_overflow = false;
                    for &c in text {
                        match int_value
                            .checked_mul(10)
                            .and_then(|v| v.checked_add(u64::from(c - b'0')))
                        {
                            Some(v) => int_value = v,
                            None => {
                                int_overflow = true;
                                break;
                            }
                        }
                    }
                    // The sign is a separate token, so the magnitude of
                    // i64::MIN (2^63) must lex; `parse_value` applies the minus.
                    self.number = self.check_exact_integer(int_value, int_overflow, 1u64 << 63)?;
                }
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

    /// TOML integers are 64-bit and must round-trip exactly through the
    /// IEEE-754 double that backs a JavaScript number: "If an integer cannot
    /// be represented losslessly, an error must be thrown" (TOML 1.0
    /// §Integer). Silently rounding `9223372036854775807` to
    /// `9223372036854776000` corrupts the document.
    fn check_exact_integer(
        &mut self,
        value: u64,
        overflowed: bool,
        max: u64,
    ) -> Result<f64, Error> {
        let raw = bstr::BStr::new(self.raw());
        if overflowed || value > max {
            self.add_syntax_error(
                self.start,
                format_args!(
                    "Integer \"{}\" is outside the 64-bit range allowed by TOML",
                    raw
                ),
            )?;
        }
        let as_float = value as f64;
        if as_float as u64 != value {
            self.add_syntax_error(
                self.start,
                format_args!(
                    "Integer \"{}\" cannot be represented exactly as a JavaScript number; quote it to load it as a string",
                    raw
                ),
            )?;
        }
        Ok(as_float)
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
                        // A newline immediately following the opening ''' is trimmed.
                        let content_start =
                            multiline_content_start(&self.source.contents, start + 2);
                        loop {
                            match self.code_point {
                                -1 => {
                                    self.add_default_error(b"Unterminated string literal")?;
                                }
                                c if c == '\'' as CodePoint => {
                                    let mut end = self.end;
                                    self.step();
                                    if self.code_point != '\'' as CodePoint {
                                        continue;
                                    }
                                    self.step();
                                    if self.code_point != '\'' as CodePoint {
                                        continue;
                                    }
                                    self.step();
                                    // Up to two extra quotes next to the closing
                                    // delimiter belong to the content (`''''x''''`).
                                    let mut extra: usize = 0;
                                    while extra < 2 && self.code_point == '\'' as CodePoint {
                                        end += 1;
                                        extra += 1;
                                        self.step();
                                    }
                                    self.token = T::t_string_literal;
                                    self.string_literal_slice =
                                        &self.source.contents[content_start..end];
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
                        // A newline immediately following the opening """ is trimmed.
                        let content_start =
                            multiline_content_start(&self.source.contents, start + 2);
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
                                    let mut end = self.end;
                                    self.step();
                                    if self.code_point != '"' as CodePoint {
                                        continue;
                                    }
                                    self.step();
                                    if self.code_point != '"' as CodePoint {
                                        continue;
                                    }
                                    self.step();
                                    // Up to two extra quotes next to the closing
                                    // delimiter belong to the content (`""""x""""`).
                                    let mut extra: usize = 0;
                                    while extra < 2 && self.code_point == '"' as CodePoint {
                                        end += 1;
                                        extra += 1;
                                        self.step();
                                    }

                                    self.token = T::t_string_literal;
                                    if needs_slow_pass {
                                        slice_lo = content_start;
                                        slice_hi = end;
                                        break;
                                    }
                                    self.string_literal_slice =
                                        &self.source.contents[content_start..end];
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
        let iterator = strings::CodepointIterator::init(text);
        let mut iter = strings::Cursor::default();
        while iterator.next(&mut iter) {
            let width = iter.width;
            match iter.c {
                c if c == '\r' as CodePoint => {
                    // Convert '\r\n' into '\n'. After `next()` returns for `\r`,
                    // `iter.i` is the start byte of the `\r` itself — the `\n`
                    // we're looking for is at `iter.i + 1`. Reading `text[iter.i]`
                    // would always be `\r`, so the check never fired and a literal
                    // CRLF in a slow-path multiline basic string decoded to two LFs.
                    // Match the JS lexer (js_parser/lexer.rs:660-661).
                    let next_i: usize = iter.i as usize + 1;
                    if next_i < text.len() && text[next_i] == b'\n' {
                        iter.i += 1;
                    }

                    // Convert '\r' into '\n'
                    buf.push(b'\n');
                    continue;
                }

                c if c == '\\' as CodePoint => {
                    if !iterator.next(&mut iter) {
                        return Ok(());
                    }

                    let c2 = iter.c;

                    let width2 = iter.width;
                    match c2 {
                        // TOML §String: \b \t \n \f \r \" \\ \uXXXX \UXXXXXXXX
                        c if c == 'b' as CodePoint => {
                            buf.push(8);
                            continue;
                        }
                        c if c == 'f' as CodePoint => {
                            // Form feed: U+000C
                            buf.push(12);
                            continue;
                        }
                        c if c == 'n' as CodePoint => {
                            buf.push(10);
                            continue;
                        }
                        c if c == 't' as CodePoint => {
                            // Horizontal tab: U+0009
                            buf.push(9);
                            continue;
                        }
                        c if c == 'r' as CodePoint => {
                            buf.push(13);
                            continue;
                        }
                        c if c == '"' as CodePoint || c == '\\' as CodePoint => {
                            iter.c = c2;
                        }
                        // 2-digit hexadecimal (not TOML 1.0; kept for compatibility)
                        c if c == 'x' as CodePoint => {
                            if ALLOW_MULTILINE {
                                self.end =
                                    (start + iter.i as usize).saturating_sub(width2 as usize);
                                self.syntax_error()?;
                            }

                            let mut value: CodePoint = 0;
                            let mut c3: CodePoint;
                            let mut width3: u8;

                            if !iterator.next(&mut iter) {
                                return self.syntax_error();
                            }
                            c3 = iter.c;
                            width3 = iter.width;
                            match hex_digit_value_u32(c3 as u32) {
                                Some(d) => value = (value * 16) | d as CodePoint,
                                None => {
                                    self.end =
                                        (start + iter.i as usize).saturating_sub(width3 as usize);
                                    return self.syntax_error();
                                }
                            }

                            if !iterator.next(&mut iter) {
                                return self.syntax_error();
                            }
                            c3 = iter.c;
                            width3 = iter.width;
                            match hex_digit_value_u32(c3 as u32) {
                                Some(d) => value = (value * 16) | d as CodePoint,
                                None => {
                                    self.end =
                                        (start + iter.i as usize).saturating_sub(width3 as usize);
                                    return self.syntax_error();
                                }
                            }

                            iter.c = value;
                        }
                        // Unicode escapes: `\uXXXX` (4 hex digits) and
                        // `\UXXXXXXXX` (8 hex digits).
                        c if c == 'u' as CodePoint || c == 'U' as CodePoint => {
                            // We're going to make this an i64 so we don't risk integer overflows
                            // when people do weird things
                            let mut value: i64 = 0;

                            if !iterator.next(&mut iter) {
                                return self.syntax_error();
                            }
                            let mut c3 = iter.c;
                            let mut width3 = iter.width;

                            // `\u{…}` variable-length (not TOML; kept for compatibility)
                            if c2 == 'u' as CodePoint && c3 == '{' as CodePoint {
                                let hex_start = (iter.i as usize)
                                    .saturating_sub(width as usize)
                                    .saturating_sub(width2 as usize)
                                    .saturating_sub(width3 as usize);
                                let mut is_first = true;
                                let mut is_out_of_range = false;
                                'variable_length: loop {
                                    if !iterator.next(&mut iter) {
                                        break 'variable_length;
                                    }
                                    c3 = iter.c;

                                    if c3 == '}' as CodePoint {
                                        if is_first {
                                            self.end = (start + iter.i as usize)
                                                .saturating_sub(width3 as usize);
                                            return self.syntax_error();
                                        }
                                        break 'variable_length;
                                    }
                                    match hex_digit_value_u32(c3 as u32) {
                                        Some(d) => value = (value * 16) | d as i64,
                                        None => {
                                            self.end = (start + iter.i as usize)
                                                .saturating_sub(width3 as usize);
                                            return self.syntax_error();
                                        }
                                    }

                                    // '\U0010FFFF
                                    // copied from golang utf8.MaxRune
                                    if value > 1114111 {
                                        is_out_of_range = true;
                                    }
                                    is_first = false;
                                }

                                if is_out_of_range {
                                    self.add_range_error(
                                        bun_ast::Range {
                                            loc: bun_ast::Loc {
                                                start: i32::try_from(start + hex_start)
                                                    .expect("int cast"),
                                            },
                                            len: i32::try_from(
                                                (iter.i as usize).saturating_sub(hex_start),
                                            )
                                            .unwrap(),
                                        },
                                        format_args!("Unicode escape sequence is out of range"),
                                    )?;
                                    return Ok(());
                                }
                            } else {
                                // Fixed-length
                                let n_digits: usize = if c2 == 'U' as CodePoint { 8 } else { 4 };
                                let mut j: usize = 0;
                                while j < n_digits {
                                    match hex_digit_value_u32(c3 as u32) {
                                        Some(d) => value = (value * 16) | d as i64,
                                        None => {
                                            self.end = (start + iter.i as usize)
                                                .saturating_sub(width3 as usize);
                                            return self.syntax_error();
                                        }
                                    }

                                    if j < n_digits - 1 {
                                        if !iterator.next(&mut iter) {
                                            return self.syntax_error();
                                        }
                                        c3 = iter.c;

                                        width3 = iter.width;
                                    }
                                    j += 1;
                                }

                                // TOML §String: the escape must name a Unicode
                                // scalar value. Surrogates and anything past
                                // U+10FFFF are errors, not replacement output.
                                if value > 0x0010_FFFF || (0xD800..=0xDFFF).contains(&value) {
                                    self.end =
                                        (start + iter.i as usize).saturating_sub(width3 as usize);
                                    self.add_syntax_error(
                                        self.end,
                                        format_args!(
                                            "Unicode escape sequence is not a Unicode scalar value"
                                        ),
                                    )?;
                                }
                            }

                            iter.c = value as CodePoint; // @truncate
                        }
                        c if c == '\r' as CodePoint => {
                            if !ALLOW_MULTILINE {
                                self.end =
                                    (start + iter.i as usize).saturating_sub(width2 as usize);
                                self.add_default_error(b"Unexpected end of line")?;
                            }

                            // Line-ending backslash. Match the JS lexer
                            // (js_parser/lexer.rs:660-661, 937-939): guard on
                            // the index we actually read (`iter.i + 1`), not `iter.i`. Without
                            // this, a multiline basic string ending in `\<CR>` right before `"""`
                            // reads `text[len]` and panics even in release (slice bounds checks
                            // always run).
                            let next_i: usize = iter.i as usize + 1;
                            if next_i < text.len() && text[next_i] == b'\n' {
                                // Make sure Windows CRLF counts as a single newline
                                iter.i += 1;
                            }
                            skip_line_continuation_whitespace(text, &iterator, &mut iter);
                            continue;
                        }
                        c if c == '\n' as CodePoint || c == 0x2028 || c == 0x2029 => {
                            // Line-ending backslash.
                            if !ALLOW_MULTILINE {
                                self.end =
                                    (start + iter.i as usize).saturating_sub(width2 as usize);
                                self.add_default_error(b"Unexpected end of line")?;
                            }
                            skip_line_continuation_whitespace(text, &iterator, &mut iter);
                            continue;
                        }
                        // TOML §String: "when the last non-whitespace character on
                        // a line is an unescaped \, it will be trimmed along with
                        // all whitespace (including newlines) up to the next
                        // non-whitespace character" — `\` followed only by
                        // spaces/tabs until the end of the line is also a
                        // line-ending backslash (ABNF `mlb-escaped-nl`).
                        c if ALLOW_MULTILINE
                            && (c == ' ' as CodePoint || c == '\t' as CodePoint) =>
                        {
                            let mut probe = iter;
                            let reaches_newline = loop {
                                if !iterator.next(&mut probe) {
                                    break false;
                                }
                                match probe.c {
                                    c if c == ' ' as CodePoint || c == '\t' as CodePoint => {}
                                    c if c == '\n' as CodePoint => break true,
                                    c if c == '\r' as CodePoint => {
                                        // Only as the CR of a CRLF.
                                        let ni = probe.i as usize + 1;
                                        break ni < text.len() && text[ni] == b'\n';
                                    }
                                    _ => break false,
                                }
                            };
                            if !reaches_newline {
                                self.end =
                                    (start + iter.i as usize).saturating_sub(width2 as usize);
                                self.add_default_error(b"Invalid escape sequence")?;
                            }
                            // `probe` sits on the newline (or the CR of a CRLF).
                            iter = probe;
                            if iter.c == '\r' as CodePoint {
                                iter.i += 1;
                            }
                            skip_line_continuation_whitespace(text, &iterator, &mut iter);
                            continue;
                        }
                        _ => {
                            // TOML §String: "All other escape sequences [...]
                            // are reserved; if they are used, TOML should
                            // produce an error." Silently emitting the literal
                            // character turned `"\U000003B4"` into `U000003B4`.
                            self.end = (start + iter.i as usize).saturating_sub(width2 as usize);
                            self.add_syntax_error(
                                self.end,
                                format_args!(
                                    "Invalid escape sequence \"\\{}\" in TOML string",
                                    char::from_u32(c2 as u32)
                                        .unwrap_or(char::REPLACEMENT_CHARACTER)
                                ),
                            )?;
                        }
                    }
                }
                _ => {}
            }

            match iter.c {
                -1 => return self.add_default_error(b"Unexpected end of file"),
                0..=127 => {
                    buf.push(u8::try_from(iter.c).expect("int cast"));
                }
                _ => {
                    let mut part: [u8; 4] = [0; 4];
                    let len = strings::encode_wtf8_rune(&mut part, iter.c as u32);
                    buf.extend_from_slice(&part[0..len]);
                }
            }
        }
        Ok(())
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

/// A newline immediately following a multi-line string's opening delimiter
/// (`"""` / `'''`) is trimmed (TOML §String). `after_delim` is the byte index
/// just past the opening delimiter; returns the index the content starts at.
#[inline]
fn multiline_content_start(contents: &[u8], after_delim: usize) -> usize {
    match contents.get(after_delim).copied() {
        Some(b'\n') => after_delim + 1,
        Some(b'\r') if contents.get(after_delim + 1) == Some(&b'\n') => after_delim + 2,
        _ => after_delim,
    }
}

/// After a line-ending backslash has consumed its newline, consume the run of
/// spaces, tabs, and newlines that follows. TOML §String: the backslash "will
/// be trimmed along with all whitespace (including newlines) up to the next
/// non-whitespace character or closing delimiter".
fn skip_line_continuation_whitespace(
    text: &[u8],
    iterator: &strings::CodepointIterator<'_>,
    iter: &mut strings::Cursor,
) {
    loop {
        let mut probe = *iter;
        if !iterator.next(&mut probe) {
            return;
        }
        match probe.c {
            c if c == ' ' as CodePoint || c == '\t' as CodePoint || c == '\n' as CodePoint => {}
            c if c == '\r' as CodePoint => {
                let next_i = probe.i as usize + 1;
                if next_i < text.len() && text[next_i] == b'\n' {
                    probe.i += 1;
                } else {
                    // A bare CR is not a TOML newline; leave it for the caller.
                    return;
                }
            }
            _ => return,
        }
        *iter = probe;
    }
}

#[inline]
fn two_digits(a: u8, b: u8) -> u32 {
    u32::from(a - b'0') * 10 + u32::from(b - b'0')
}

/// `full-date = 4DIGIT "-" 2DIGIT "-" 2DIGIT` with month `01-12` and day
/// `01-31` (RFC 3339 via TOML §Offset Date-Time). Calendar validity (leap
/// years, days per month) is intentionally not checked.
fn is_full_date(b: &[u8]) -> bool {
    if b.len() < 10
        || !b[0..4].iter().all(u8::is_ascii_digit)
        || b[4] != b'-'
        || !b[5].is_ascii_digit()
        || !b[6].is_ascii_digit()
        || b[7] != b'-'
        || !b[8].is_ascii_digit()
        || !b[9].is_ascii_digit()
    {
        return false;
    }
    (1..=12).contains(&two_digits(b[5], b[6])) && (1..=31).contains(&two_digits(b[8], b[9]))
}

/// `partial-time = 2DIGIT ":" 2DIGIT ":" 2DIGIT ["." 1*DIGIT]`, with hour
/// `00-23`, minute `00-59`, and second `00-60` (leap second). Returns the
/// byte length of the match.
fn scan_partial_time(b: &[u8]) -> Option<usize> {
    if b.len() < 8
        || !b[0].is_ascii_digit()
        || !b[1].is_ascii_digit()
        || b[2] != b':'
        || !b[3].is_ascii_digit()
        || !b[4].is_ascii_digit()
        || b[5] != b':'
        || !b[6].is_ascii_digit()
        || !b[7].is_ascii_digit()
    {
        return None;
    }
    if two_digits(b[0], b[1]) > 23 || two_digits(b[3], b[4]) > 59 || two_digits(b[6], b[7]) > 60 {
        return None;
    }
    let mut i: usize = 8;
    if b.get(i) == Some(&b'.') {
        i += 1;
        let frac_start = i;
        while b.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
        // At least one fractional digit is required after the `.`.
        if i == frac_start {
            return None;
        }
    }
    Some(i)
}

/// Byte length of the TOML 1.0 date-time value that starts at `bytes[0]`, or
/// `None` if there isn't one. Matches all four RFC 3339 shapes: offset
/// date-time, local date-time, local date (`1979-05-27`), and local time
/// (`07:32:00`). The match must end at a token boundary so inputs like
/// `2020-01-01x` or `1997-09-0909:09:09` fall through to the number path
/// (which then rejects them).
fn scan_date_time(bytes: &[u8]) -> Option<usize> {
    let len = if is_full_date(bytes) {
        let mut i: usize = 10;
        // `time-delim = "T" / "t" / %x20`. A space only counts as the
        // delimiter when a time actually follows it.
        let has_time = match bytes.get(i).copied() {
            Some(b'T' | b't') => {
                i += 1;
                true
            }
            Some(b' ')
                if bytes.len() >= i + 4
                    && bytes[i + 1].is_ascii_digit()
                    && bytes[i + 2].is_ascii_digit()
                    && bytes[i + 3] == b':' =>
            {
                i += 1;
                true
            }
            _ => false,
        };
        if has_time {
            i += scan_partial_time(&bytes[i..])?;
            // `time-offset = "Z" / ("+" / "-") 2DIGIT ":" 2DIGIT`, optional
            // (its absence makes this a local date-time).
            match bytes.get(i).copied() {
                Some(b'Z' | b'z') => i += 1,
                Some(b'+' | b'-') => {
                    let off = bytes.get(i + 1..i + 6)?;
                    if !(off[0].is_ascii_digit()
                        && off[1].is_ascii_digit()
                        && off[2] == b':'
                        && off[3].is_ascii_digit()
                        && off[4].is_ascii_digit())
                        || two_digits(off[0], off[1]) > 23
                        || two_digits(off[3], off[4]) > 59
                    {
                        return None;
                    }
                    i += 6;
                }
                _ => {}
            }
        }
        i
    } else {
        scan_partial_time(bytes)?
    };
    // Require a token boundary so that anything that could extend a number,
    // bare key, or malformed date (`2020-01-01x`, `1997-09-0909:09:09`) never
    // half-matches. A `.` is a valid boundary: a fractional second is consumed
    // by `scan_partial_time`, so a trailing `.` can only be the dotted-key
    // separator of e.g. `2001-02-11.a = 1` (toml-test valid/key/like-date).
    match bytes.get(len).copied() {
        Some(c) if c.is_ascii_alphanumeric() || matches!(c, b'-' | b':' | b'+' | b'_') => None,
        _ => Some(len),
    }
}
