use core::fmt;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_alloc::ArenaVecExt as _;
use bun_ast as js_ast;
use bun_ast::LexerLog;
use bun_core::fmt::hex_digit_value_u32;
use bun_core::strings;
// In Zig it's `bun.CodePoint` (i32); lives at `bun_core::strings::CodePoint`.
use bun_core::strings::CodePoint;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[allow(non_camel_case_types)] // PORTING.md: "Match the Zig's structure" — Zig: `t_end_of_file`.
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

pub struct Lexer<'a> {
    // PORT NOTE: borrowed (`&'a Source`) rather than owned so
    // `identifier`/`string_literal_slice` can borrow `&'a [u8]` from
    // `source.contents` without a self-referential struct. The Zig original
    // copied `Source` by value because Zig has no borrow checker; the Rust
    // `bun_ast::Source.contents` is now `Cow<'static,[u8]>` so an owned copy
    // would tie those slices to `&self` instead of `'a`.
    pub source: &'a bun_ast::Source,
    pub log: &'a mut bun_ast::Log,
    pub start: usize,
    pub end: usize,
    pub current: usize,

    pub bump: &'a Arena,

    pub code_point: CodePoint,
    // TODO(port): lifetime — borrows from `source.contents` (and arena for decoded strings);
    // may be self-referential depending on how bun_ast::Source owns `contents` in Rust.
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

    /// Look ahead at the next n codepoints without advancing the iterator.
    /// If fewer than n codepoints are available, then return the remainder of the string.
    #[inline]
    fn peek(&self, n: usize) -> &[u8] {
        strings::peek_n_codepoints_wtf8(&self.source.contents, self.current, n)
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
                    // PORT NOTE: Zig discards `bytes` here (dead store); ported faithfully.
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
            let is_invalid_legacy_octal_literal = first == '0' as CodePoint
                && (self.code_point == '8' as CodePoint || self.code_point == '9' as CodePoint);

            // Initial digits;
            loop {
                if self.code_point < '0' as CodePoint || self.code_point > '9' as CodePoint {
                    match self.code_point {
                        // '-' => {
                        //     if (lexer.raw().len == 5) {
                        //         // Is this possibly a datetime literal that begins with a 4 digit year?
                        //         lexer.step();
                        //         while (!lexer.has_newline_before) {
                        //             switch (lexer.code_point) {
                        //                 ',' => {
                        //                     lexer.string_literal_slice = lexer.raw();
                        //                     lexer.token = T.t_string_literal;
                        //                     break;
                        //                 },
                        //             }
                        //         }
                        //     }
                        // },
                        c if c == '_' as CodePoint => {}
                        _ => break,
                    }
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
                // PORT NOTE: Zig handled OOM via if/else on allocator.alloc; arena alloc here is infallible.
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
                    number = number * 10 + u32::try_from(c - b'0').expect("int cast");
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

        // if it's a space, it might be a date timestamp
        if is_identifier_part(self.code_point) || self.code_point == ' ' as CodePoint {}

        Ok(())
    }

    #[inline]
    pub fn expect(&mut self, token: T) -> Result<(), Error> {
        // PERF(port): was comptime monomorphization (`comptime token: T`) — profile
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

                    // PORT NOTE: reshaped for borrowck — capture slice bounds as indices
                    // instead of laundering a `&'a [u8]` through a raw pointer. On the fast
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
                    self.token = match self.identifier.len() {
                        4 => {
                            if strings::eql_comptime_ignore_len(self.identifier, b"true") {
                                T::t_true
                            } else {
                                T::t_identifier
                            }
                        }
                        5 => {
                            if strings::eql_comptime_ignore_len(self.identifier, b"false") {
                                T::t_false
                            } else {
                                T::t_identifier
                            }
                        }
                        _ => T::t_identifier,
                    };
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
        // PORT NOTE: Zig copied `*buf_` into a local and `defer`-wrote it back.
        // In Rust we operate on `buf` directly via &mut.

        let iterator = strings::CodepointIterator::init(text);
        let mut iter = strings::Cursor::default();
        while iterator.next(&mut iter) {
            let width = iter.width;
            match iter.c {
                c if c == '\r' as CodePoint => {
                    // Convert '\r\n' into '\n'
                    if (iter.i as usize) < text.len() && text[iter.i as usize] == b'\n' {
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
                        // https://mathiasbynens.be/notes/javascript-escapes#single
                        c if c == 'b' as CodePoint => {
                            buf.push(8);
                            continue;
                        }
                        c if c == 'f' as CodePoint => {
                            buf.push(9);
                            continue;
                        }
                        c if c == 'n' as CodePoint => {
                            buf.push(10);
                            continue;
                        }
                        c if c == 'v' as CodePoint => {
                            // Vertical tab is invalid JSON
                            // We're going to allow it.
                            // if (comptime is_json) {
                            //     lexer.end = start + iter.i - width2;
                            //     try lexer.syntaxError();
                            // }
                            buf.push(11);
                            continue;
                        }
                        c if c == 't' as CodePoint => {
                            buf.push(12);
                            continue;
                        }
                        c if c == 'r' as CodePoint => {
                            buf.push(13);
                            continue;
                        }

                        // legacy octal literals
                        c if ('0' as CodePoint..='7' as CodePoint).contains(&c) => {
                            let octal_start = (iter.i as usize + width2 as usize) - 2;

                            // 1-3 digit octal
                            let mut is_bad = false;
                            let mut value: i64 = (c2 - '0' as CodePoint) as i64;
                            let mut restore = iter;

                            if !iterator.next(&mut iter) {
                                if value == 0 {
                                    buf.push(0);
                                    return Ok(());
                                }

                                self.syntax_error()?;
                                return Ok(());
                            }

                            let c3: CodePoint = iter.c;

                            match c3 {
                                c if ('0' as CodePoint..='7' as CodePoint).contains(&c) => {
                                    value = value * 8 + (c3 - '0' as CodePoint) as i64;
                                    restore = iter;
                                    if !iterator.next(&mut iter) {
                                        return self.syntax_error();
                                    }

                                    let c4 = iter.c;
                                    match c4 {
                                        c if ('0' as CodePoint..='7' as CodePoint).contains(&c) => {
                                            let temp = value * 8 + (c4 - '0' as CodePoint) as i64;
                                            if temp < 256 {
                                                value = temp;
                                            } else {
                                                iter = restore;
                                            }
                                        }
                                        c if c == '8' as CodePoint || c == '9' as CodePoint => {
                                            is_bad = true;
                                        }
                                        _ => {
                                            iter = restore;
                                        }
                                    }
                                }
                                c if c == '8' as CodePoint || c == '9' as CodePoint => {
                                    is_bad = true;
                                }
                                _ => {
                                    iter = restore;
                                }
                            }

                            iter.c = i32::try_from(value).expect("int cast");
                            if is_bad {
                                self.add_range_error(
                                    bun_ast::Range {
                                        loc: bun_ast::Loc {
                                            start: i32::try_from(octal_start).expect("int cast"),
                                        },
                                        len: i32::try_from(iter.i as usize - octal_start)
                                            .expect("int cast"),
                                    },
                                    format_args!("Invalid legacy octal literal"),
                                )
                                .expect("unreachable");
                            }
                        }
                        c if c == '8' as CodePoint || c == '9' as CodePoint => {
                            iter.c = c2;
                        }
                        // 2-digit hexadecimal
                        c if c == 'x' as CodePoint => {
                            if ALLOW_MULTILINE {
                                self.end = start + iter.i as usize - width2 as usize;
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
                                Some(d) => value = value * 16 | d as CodePoint,
                                None => {
                                    self.end = start + iter.i as usize - width3 as usize;
                                    return self.syntax_error();
                                }
                            }

                            if !iterator.next(&mut iter) {
                                return self.syntax_error();
                            }
                            c3 = iter.c;
                            width3 = iter.width;
                            match hex_digit_value_u32(c3 as u32) {
                                Some(d) => value = value * 16 | d as CodePoint,
                                None => {
                                    self.end = start + iter.i as usize - width3 as usize;
                                    return self.syntax_error();
                                }
                            }

                            iter.c = value;
                        }
                        c if c == 'u' as CodePoint => {
                            // We're going to make this an i64 so we don't risk integer overflows
                            // when people do weird things
                            let mut value: i64 = 0;

                            if !iterator.next(&mut iter) {
                                return self.syntax_error();
                            }
                            let mut c3 = iter.c;
                            let mut width3 = iter.width;

                            // variable-length
                            if c3 == '{' as CodePoint {
                                let hex_start = iter.i as usize
                                    - width as usize
                                    - width2 as usize
                                    - width3 as usize;
                                let mut is_first = true;
                                let mut is_out_of_range = false;
                                'variable_length: loop {
                                    if !iterator.next(&mut iter) {
                                        break 'variable_length;
                                    }
                                    c3 = iter.c;

                                    if c3 == '}' as CodePoint {
                                        if is_first {
                                            self.end =
                                                start + iter.i as usize - width3 as usize;
                                            return self.syntax_error();
                                        }
                                        break 'variable_length;
                                    }
                                    match hex_digit_value_u32(c3 as u32) {
                                        Some(d) => value = value * 16 | d as i64,
                                        None => {
                                            self.end = start + iter.i as usize - width3 as usize;
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
                                            len: i32::try_from(iter.i as usize - hex_start)
                                                .unwrap(),
                                        },
                                        format_args!("Unicode escape sequence is out of range"),
                                    )?;
                                    return Ok(());
                                }

                                // fixed-length
                            } else {
                                // Fixed-length
                                // comptime var j: usize = 0;
                                let mut j: usize = 0;
                                while j < 4 {
                                    match hex_digit_value_u32(c3 as u32) {
                                        Some(d) => value = value * 16 | d as i64,
                                        None => {
                                            self.end = start + iter.i as usize - width3 as usize;
                                            return self.syntax_error();
                                        }
                                    }

                                    if j < 3 {
                                        if !iterator.next(&mut iter) {
                                            return self.syntax_error();
                                        }
                                        c3 = iter.c;

                                        width3 = iter.width;
                                    }
                                    j += 1;
                                }
                            }

                            iter.c = value as CodePoint; // @truncate
                        }
                        c if c == '\r' as CodePoint => {
                            if !ALLOW_MULTILINE {
                                self.end = start + iter.i as usize - width2 as usize;
                                self.add_default_error(b"Unexpected end of line")?;
                            }

                            // Ignore line continuations. A line continuation is not an escaped newline.
                            if (iter.i as usize) < text.len() && text[iter.i as usize + 1] == b'\n'
                            {
                                // Make sure Windows CRLF counts as a single newline
                                iter.i += 1;
                            }
                            continue;
                        }
                        c if c == '\n' as CodePoint || c == 0x2028 || c == 0x2029 => {
                            // Ignore line continuations. A line continuation is not an escaped newline.
                            if !ALLOW_MULTILINE {
                                self.end = start + iter.i as usize - width2 as usize;
                                self.add_default_error(b"Unexpected end of line")?;
                            }
                            continue;
                        }
                        _ => {
                            iter.c = c2;
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

        // PORT NOTE: reshaped for borrowck — compute range before borrowing `found` from source.
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
            len: (self.end - self.start) as i32, // std.math.lossyCast
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

pub fn is_identifier_part(code_point: CodePoint) -> bool {
    matches!(code_point as u32 as u8 as char,
        '0'..='9'
        | 'a'..='z'
        | 'A'..='Z'
        | '$'
        | '_'
        | '-'
        | ':'
    ) && (0..=127).contains(&code_point)
    // PORT NOTE: Zig matched CodePoint directly against char ranges; Rust requires
    // bounding to ASCII before the byte cast above is sound.
}

pub fn is_latin1_identifier<B: Copy + Into<u32>>(name: &[B]) -> bool {
    if name.is_empty() {
        return false;
    }

    // Match on the full-width value — Zig switches on u8/u16 directly against char
    // ranges; truncating to u8 here would incorrectly accept e.g. U+0161 as 'a'.
    match name[0].into() {
        0x61..=0x7A | 0x41..=0x5A | 0x24 | 0x31..=0x39 | 0x5F | 0x2D => {}
        _ => return false,
    }

    if !name.is_empty() {
        for &c in &name[1..] {
            match c.into() {
                0x30..=0x39 | 0x61..=0x7A | 0x41..=0x5A | 0x24 | 0x5F | 0x2D => {}
                _ => return false,
            }
        }
    }

    true
}

#[inline]
fn float64(num: CodePoint) -> f64 {
    num as f64
}

// ported from: src/interchange/toml/lexer.zig
