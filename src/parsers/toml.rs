//! TOML v1.1.0 token-based scanner/parser.
//!
//! Architecture (mirrors `json5.rs`): a scanner reads source bytes and
//! produces typed tokens; the parser only consumes tokens and never touches
//! source bytes — `Parser` has no access to the byte cursor, so the boundary
//! is enforced by the compiler, not convention.
//!
//! TOML's lexical grammar is positional (`3.14` is a float in value position
//! but two key segments in key position; `1979-05-27` is a date or a bare
//! key), so the parser selects a scan mode per grammar production, and each
//! mode returns a narrow token type that can only represent what is legal at
//! that position. Trivia is positional too (`ws` vs `ws-comment-newline` in
//! the ABNF), so each scan mode skips exactly the trivia its position allows.
//!
//! JS value mapping:
//! - integers parse as `f64` but are validated as 64-bit integers first;
//!   values outside `Number.MAX_SAFE_INTEGER` are errors (TOML requires
//!   lossless handling or an error)
//! - date/time values (all four kinds) become strings of their source text
//! - strings are UTF-8; non-ASCII content is re-encoded to UTF-16 EStrings
//!   so both the JS conversion and the printer paths agree

use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVec;
use bun_alloc::ArenaVecExt as _;
use bun_ast::{self, E, Expr, Loc, Log, Source};
use bun_collections::HashMap;
use bun_core::{self, StackCheck};

/// Tracks how a table or array came to exist, which decides whether later
/// syntax may extend it. See "Table" and "Array of Tables" in the spec.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    /// `[a]` — explicitly defined by a table header.
    Header,
    /// Created on the way to a deeper header (`[a.b]` creates `a`).
    HeaderImplicit,
    /// Created by a dotted key (`a.b = 1` creates `a`); records the block so
    /// only dotted keys from the same block may extend it.
    Dotted,
    /// An element of an array of tables.
    ArrayElem,
    /// `{ ... }` — closed to all later extension.
    Inline,
    /// `[[a]]` — appendable only by another `[[a]]`.
    AotArray,
    /// `a = [ ... ]` — a value; never extendable.
    StaticArray,
}

#[derive(Copy, Clone)]
struct Meta {
    kind: Kind,
    block: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum PErr {
    /// Already logged.
    Syntax,
    Oom,
    StackOverflow,
}

impl From<bun_alloc::AllocError> for PErr {
    fn from(_: bun_alloc::AllocError) -> Self {
        PErr::Oom
    }
}

type PResult<T> = Result<T, PErr>;

/// A decoded key segment: the key text (borrowed from the source or built in
/// the bump arena when escapes were involved) plus its source position.
#[derive(Copy, Clone)]
struct KeySeg<'a> {
    text: &'a [u8],
    pos: usize,
}

// ── tokens ──────────────────────────────────────────────────────────────────
//
// Each scan mode returns its own narrow token type: a token that is illegal
// at a grammar position cannot be produced there.

/// What begins a top-level expression.
enum LineStart<'a> {
    Eof,
    /// `[` (`aot` for `[[`) at `pos`.
    TableOpen {
        aot: bool,
        pos: usize,
    },
    Key(KeySeg<'a>),
}

/// What follows a key segment in a `key = value` path.
enum KeyvalSep {
    Dot,
    Equals,
}

/// What follows a key segment inside a `[...]` / `[[...]]` header.
enum HeaderSep {
    Dot,
    Close,
}

/// What begins an entry inside an inline table.
enum InlineKey<'a> {
    Key(KeySeg<'a>),
    Close,
    Eof { pos: usize },
}

/// What separates or ends list elements (arrays and inline tables).
enum ListSep {
    Comma,
    Close,
}

/// A value token: the payload is fully decoded by the scanner.
#[derive(Copy, Clone)]
struct ValueToken<'a> {
    pos: usize,
    data: ValueData<'a>,
}

#[derive(Copy, Clone)]
enum ValueData<'a> {
    String {
        text: &'a [u8],
        is_ascii: bool,
    },
    Number(f64),
    /// All four TOML date/time kinds, as their source text (always ASCII).
    DateTime(&'a [u8]),
    Boolean(bool),
    ArrayOpen,
    InlineOpen,
}

/// What occupies an array element position.
enum ArrayItem<'a> {
    Value(ValueToken<'a>),
    Close,
    Eof { pos: usize },
}

pub struct TOML;

impl TOML {
    pub fn parse<'a>(
        source: &'a Source,
        log: &mut Log,
        bump: &'a Bump,
        redact_logs: bool,
    ) -> crate::Result<Expr> {
        let mut parser = Parser {
            scanner: Scanner {
                src: source.contents.as_ref(),
                pos: 0,
                bump,
                source,
                log,
                redact: redact_logs,
            },
            bump,
            stack_check: StackCheck::init(),
            meta: HashMap::default(),
            block: 0,
        };
        match parser.parse_root() {
            Ok(root) => Ok(root),
            Err(PErr::Syntax) => Err(crate::Error::SyntaxError),
            Err(PErr::Oom) => Err(crate::Error::Alloc(bun_alloc::AllocError)),
            Err(PErr::StackOverflow) => Err(crate::Error::StackOverflow),
        }
    }
}

const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;

const BARE_CR: &[u8] = b"Bare carriage return is not allowed; use \\r\\n or \\n";
const UNDERSCORE_IN_NUMBER: &[u8] = b"Underscores in numbers must be surrounded by digits";

fn is_bare_key_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'-' || c == b'_'
}

fn loc_of(pos: usize) -> Loc {
    Loc {
        start: i32::try_from(pos).expect("source length is bounded by i32::MAX"),
    }
}

// ── scanner ─────────────────────────────────────────────────────────────────

/// Owns the byte cursor. The only component that reads source bytes; every
/// public method scans one token (or one fixed construct) for one grammar
/// position and skips exactly the leading trivia that position allows.
struct Scanner<'a, 'log> {
    src: &'a [u8],
    pos: usize,
    bump: &'a Bump,
    source: &'a Source,
    log: &'log mut Log,
    redact: bool,
}

impl<'a, 'log> Scanner<'a, 'log> {
    // ── error helpers ──────────────────────────────────────────────────────

    fn err(&mut self, pos: usize, msg: &'static [u8]) -> PErr {
        self.err_fmt(pos, format_args!("{}", bstr::BStr::new(msg)))
    }

    fn err_fmt(&mut self, pos: usize, args: core::fmt::Arguments<'_>) -> PErr {
        self.log.add_error_fmt_opts(
            args,
            bun_ast::AddErrorOptions {
                source: Some(self.source),
                loc: loc_of(pos),
                len: 0,
                redact_sensitive_information: self.redact,
            },
        );
        PErr::Syntax
    }

    /// `{before} '{key}'{after}`; the key text is omitted when redacting.
    fn err_keyed(
        &mut self,
        pos: usize,
        before: &'static str,
        key: &[u8],
        after: &'static str,
    ) -> PErr {
        if self.redact {
            self.err_fmt(pos, format_args!("{}{}", before, after))
        } else {
            self.err_fmt(
                pos,
                format_args!("{} '{}'{}", before, bstr::BStr::new(key), after),
            )
        }
    }

    fn err_char(&mut self, pos: usize, what: &'static str) -> PErr {
        match self.src.get(pos).copied() {
            None => self.err_fmt(pos, format_args!("{} end of file", what)),
            Some(_) if self.redact => self.err_fmt(pos, format_args!("{} (redacted)", what)),
            Some(c) if c.is_ascii_graphic() => {
                self.err_fmt(pos, format_args!("{} '{}'", what, c as char))
            }
            Some(c) => self.err_fmt(pos, format_args!("{} (0x{:02X})", what, c)),
        }
    }

    /// A bare word in value position is almost always an unquoted string,
    /// which the old parser silently accepted; name the fix directly.
    fn err_unquoted_string(&mut self, pos: usize) -> PErr {
        let mut end = pos;
        while end < self.src.len() && is_bare_key_char(self.peek_at(end)) && end - pos < 64 {
            end += 1;
        }
        if self.redact || end == pos {
            return self.err(pos, b"Strings must be quoted");
        }
        self.err_fmt(
            pos,
            format_args!(
                "Strings must be quoted: \"{}\"",
                bstr::BStr::new(&self.src[pos..end])
            ),
        )
    }

    // ── byte cursor ────────────────────────────────────────────────────────

    #[inline]
    fn peek(&self) -> u8 {
        self.peek_at(self.pos)
    }

    #[inline]
    fn peek_at(&self, pos: usize) -> u8 {
        if pos < self.src.len() {
            self.src[pos]
        } else {
            0
        }
    }

    #[inline]
    fn at_eof(&self) -> bool {
        self.pos >= self.src.len()
    }

    /// Skips spaces and tabs (`ws` in the ABNF).
    fn skip_ws(&mut self) {
        while matches!(self.peek(), b' ' | b'\t') {
            self.pos += 1;
        }
    }

    /// Consumes a newline (LF or CRLF). Returns an error for a bare CR.
    fn expect_newline(&mut self) -> PResult<()> {
        match self.peek() {
            b'\n' => {
                self.pos += 1;
                Ok(())
            }
            b'\r' => {
                if self.peek_at(self.pos + 1) == b'\n' {
                    self.pos += 2;
                    Ok(())
                } else {
                    Err(self.err(self.pos, BARE_CR))
                }
            }
            _ => Err(self.err_char(self.pos, "Expected a newline but found")),
        }
    }

    /// Scans a `# comment` up to (not including) the line terminator,
    /// rejecting control characters.
    fn skip_comment(&mut self) -> PResult<()> {
        debug_assert_eq!(self.peek(), b'#');
        self.pos += 1;
        loop {
            match self.peek() {
                0 if self.at_eof() => return Ok(()),
                b'\n' => return Ok(()),
                b'\r' => {
                    if self.peek_at(self.pos + 1) == b'\n' {
                        return Ok(());
                    }
                    return Err(self.err(self.pos, BARE_CR));
                }
                b'\t' => self.pos += 1,
                c if c < 0x20 || c == 0x7F => {
                    return Err(
                        self.err_char(self.pos, "Control character is not allowed in a comment:")
                    );
                }
                _ => self.pos += 1,
            }
        }
    }

    /// Skips whitespace, comments, and newlines (`ws-comment-newline`).
    fn skip_ws_comment_newline(&mut self) -> PResult<()> {
        loop {
            match self.peek() {
                b' ' | b'\t' => self.pos += 1,
                b'\n' | b'\r' => self.expect_newline()?,
                b'#' => self.skip_comment()?,
                _ => return Ok(()),
            }
        }
    }

    // ── document setup ─────────────────────────────────────────────────────

    /// Whole-document validation and BOM handling, before any scanning.
    /// Returns the position of the first content byte.
    fn init_document(&mut self) -> PResult<usize> {
        // A TOML document must be valid UTF-8 as a whole.
        let validation = bun_simdutf_sys::simdutf::validate::with_errors::utf8(self.src);
        if !validation.is_successful() {
            return Err(self.err(validation.count, b"Invalid UTF-8 byte sequence"));
        }
        // Skip a leading byte-order mark.
        if self.src.starts_with(b"\xEF\xBB\xBF") {
            self.pos = 3;
        }
        Ok(self.pos)
    }

    // ── scan modes ─────────────────────────────────────────────────────────
    //
    // expression = ws-comment-newline ( keyval / table ) — what may begin a
    // top-level expression.

    fn scan_line_start(&mut self) -> PResult<LineStart<'a>> {
        self.skip_ws_comment_newline()?;
        if self.at_eof() {
            return Ok(LineStart::Eof);
        }
        if self.peek() == b'[' {
            let pos = self.pos;
            self.pos += 1;
            // `array-table-open = %x5B.5B`: the second bracket is adjacent.
            let aot = self.peek() == b'[';
            if aot {
                self.pos += 1;
            }
            return Ok(LineStart::TableOpen { aot, pos });
        }
        Ok(LineStart::Key(self.scan_key_segment()?))
    }

    /// One key segment (bare, basic-quoted, or literal-quoted).
    fn scan_key_segment(&mut self) -> PResult<KeySeg<'a>> {
        let pos = self.pos;
        match self.peek() {
            b'"' => {
                let (text, _) = self.scan_basic_string(false)?;
                Ok(KeySeg { text, pos })
            }
            b'\'' => {
                let (text, _) = self.scan_literal_string(false)?;
                Ok(KeySeg { text, pos })
            }
            c if is_bare_key_char(c) => {
                let start = self.pos;
                while is_bare_key_char(self.peek()) {
                    self.pos += 1;
                }
                Ok(KeySeg {
                    text: &self.src[start..self.pos],
                    pos,
                })
            }
            _ => Err(self.err_char(pos, "Expected a key but found")),
        }
    }

    /// The segment after a dot or a table-open bracket (`dot-sep = ws "." ws`
    /// and `std-table-open = "[" ws`: spaces/tabs only, then a key).
    fn scan_key_after_sep(&mut self) -> PResult<KeySeg<'a>> {
        self.skip_ws();
        self.scan_key_segment()
    }

    /// After a key segment in a `key = value` path: `ws` then `.` or `=`.
    fn scan_keyval_sep(&mut self) -> PResult<KeyvalSep> {
        self.skip_ws();
        match self.peek() {
            b'.' => {
                self.pos += 1;
                Ok(KeyvalSep::Dot)
            }
            b'=' => {
                self.pos += 1;
                Ok(KeyvalSep::Equals)
            }
            _ => Err(self.err_char(self.pos, "Expected '=' after a key but found")),
        }
    }

    /// After a key segment in a header: `ws` then `.` or the closing
    /// bracket(s). `]]` must be adjacent (`array-table-close = %x5D.5D`).
    fn scan_header_sep(&mut self, aot: bool) -> PResult<HeaderSep> {
        self.skip_ws();
        match self.peek() {
            b'.' => {
                self.pos += 1;
                Ok(HeaderSep::Dot)
            }
            b']' => {
                self.pos += 1;
                if aot {
                    if self.peek() != b']' {
                        return Err(self.err_char(
                            self.pos,
                            "Expected ']]' to close an array-of-tables header but found",
                        ));
                    }
                    self.pos += 1;
                }
                Ok(HeaderSep::Close)
            }
            _ => Err(if aot {
                self.err_char(
                    self.pos,
                    "Expected ']]' to close an array-of-tables header but found",
                )
            } else {
                self.err_char(self.pos, "Expected ']' to close a table header but found")
            }),
        }
    }

    /// What begins an inline-table entry: `ws-comment-newline` then a key or
    /// the closing brace (TOML 1.1 allows multi-line inline tables).
    fn scan_inline_key(&mut self) -> PResult<InlineKey<'a>> {
        self.skip_ws_comment_newline()?;
        if self.peek() == b'}' {
            self.pos += 1;
            return Ok(InlineKey::Close);
        }
        if self.at_eof() {
            return Ok(InlineKey::Eof { pos: self.pos });
        }
        Ok(InlineKey::Key(self.scan_key_segment()?))
    }

    /// The value after `=`: `keyval-sep = ws %x3D ws` — spaces/tabs only,
    /// never a newline or comment, then exactly one value.
    fn scan_value_required(&mut self) -> PResult<ValueToken<'a>> {
        self.skip_ws();
        match self.peek() {
            b'\n' | b'\r' => {
                return Err(self.err(
                    self.pos,
                    b"Missing value after '='; values must be on the same line",
                ));
            }
            0 if self.at_eof() => {
                return Err(self.err(self.pos, b"Missing value after '='"));
            }
            _ => {}
        }
        self.scan_value_token()
    }

    /// An array element position: `ws-comment-newline` then a value, the
    /// closing bracket (empty array or trailing comma), or EOF.
    fn scan_array_item(&mut self) -> PResult<ArrayItem<'a>> {
        self.skip_ws_comment_newline()?;
        if self.peek() == b']' {
            self.pos += 1;
            return Ok(ArrayItem::Close);
        }
        if self.at_eof() {
            return Ok(ArrayItem::Eof { pos: self.pos });
        }
        Ok(ArrayItem::Value(self.scan_value_token()?))
    }

    /// After a list element: `ws-comment-newline` then `,` or the closer.
    fn scan_list_sep(&mut self, close: u8, what: &'static str) -> PResult<ListSep> {
        self.skip_ws_comment_newline()?;
        let c = self.peek();
        if c == b',' {
            self.pos += 1;
            return Ok(ListSep::Comma);
        }
        if c == close {
            self.pos += 1;
            return Ok(ListSep::Close);
        }
        Err(self.err_char(self.pos, what))
    }

    /// After an expression: optional whitespace, optional comment, then a
    /// newline or EOF.
    fn scan_line_end(&mut self, after: &'static [u8]) -> PResult<()> {
        self.skip_ws();
        if self.peek() == b'#' {
            self.skip_comment()?;
        }
        if self.at_eof() {
            return Ok(());
        }
        match self.peek() {
            b'\n' | b'\r' => self.expect_newline(),
            _ => Err(self.err_fmt(
                self.pos,
                format_args!(
                    "Expected a newline or end of file after {}",
                    bstr::BStr::new(after)
                ),
            )),
        }
    }

    // ── value scanning ─────────────────────────────────────────────────────

    /// One value token at the cursor (leading trivia already handled by the
    /// mode wrappers). Scalars are fully decoded here.
    fn scan_value_token(&mut self) -> PResult<ValueToken<'a>> {
        let pos = self.pos;
        let data = match self.peek() {
            b'"' => {
                let (text, is_ascii) = if self.src[self.pos..].starts_with(b"\"\"\"") {
                    self.scan_basic_string(true)?
                } else {
                    self.scan_basic_string(false)?
                };
                ValueData::String { text, is_ascii }
            }
            b'\'' => {
                let (text, is_ascii) = if self.src[self.pos..].starts_with(b"'''") {
                    self.scan_literal_string(true)?
                } else {
                    self.scan_literal_string(false)?
                };
                ValueData::String { text, is_ascii }
            }
            b't' => {
                self.expect_keyword(b"true")?;
                ValueData::Boolean(true)
            }
            b'f' => {
                self.expect_keyword(b"false")?;
                ValueData::Boolean(false)
            }
            b'[' => {
                self.pos += 1;
                ValueData::ArrayOpen
            }
            b'{' => {
                self.pos += 1;
                ValueData::InlineOpen
            }
            b'i' | b'n' | b'+' | b'-' | b'0'..=b'9' => self.scan_number_or_datetime()?,
            c if c.is_ascii_alphabetic() => return Err(self.err_unquoted_string(pos)),
            _ => return Err(self.err_char(pos, "Expected a value but found")),
        };
        Ok(ValueToken { pos, data })
    }

    fn expect_keyword(&mut self, word: &'static [u8]) -> PResult<()> {
        let pos = self.pos;
        if self.src[self.pos..].starts_with(word) {
            let after = self.peek_at(self.pos + word.len());
            // A keyword must be followed by a value terminator, not more
            // bare characters: `truex` and `tru` are both errors.
            if !is_bare_key_char(after) {
                self.pos += word.len();
                return Ok(());
            }
        }
        Err(self.err_unquoted_string(pos))
    }

    // ── numbers and date/times ─────────────────────────────────────────────

    fn scan_number_or_datetime(&mut self) -> PResult<ValueData<'a>> {
        // Date/times start with an unsigned digit run: `DDDD-` or `DD:`.
        if self.peek().is_ascii_digit() {
            let d1 = self.digit_run_len(self.pos);
            if d1 == 4 && self.peek_at(self.pos + 4) == b'-' {
                let text = self.scan_datetime_from_date()?;
                self.expect_value_terminator()?;
                return Ok(ValueData::DateTime(text));
            }
            if d1 == 2 && self.peek_at(self.pos + 2) == b':' {
                let start = self.pos;
                self.scan_time_digits()?;
                self.expect_value_terminator()?;
                return Ok(ValueData::DateTime(&self.src[start..self.pos]));
            }
        }

        self.scan_number()
    }

    fn digit_run_len(&self, start: usize) -> usize {
        let mut i = start;
        while self.peek_at(i).is_ascii_digit() {
            i += 1;
        }
        i - start
    }

    /// Exactly `n` ASCII digits starting at `pos`; returns their value.
    fn read_digits(&mut self, n: usize, what: &'static [u8]) -> PResult<u32> {
        let mut value: u32 = 0;
        for _ in 0..n {
            let c = self.peek();
            if !c.is_ascii_digit() {
                return Err(self.err(self.pos, what));
            }
            value = value * 10 + u32::from(c - b'0');
            self.pos += 1;
        }
        Ok(value)
    }

    /// `YYYY-MM-DD` and everything that may follow it (time, offset).
    /// Returns the full source text of the literal.
    fn scan_datetime_from_date(&mut self) -> PResult<&'a [u8]> {
        let start = self.pos;

        let year = self.read_digits(4, b"Invalid date: expected a 4-digit year")?;
        if self.peek() != b'-' {
            return Err(self.err(self.pos, b"Invalid date: expected '-' after the year"));
        }
        self.pos += 1;
        let month = self.read_digits(2, b"Invalid date: expected a 2-digit month")?;
        if self.peek() != b'-' {
            return Err(self.err(self.pos, b"Invalid date: expected '-' after the month"));
        }
        self.pos += 1;
        let day_pos = self.pos;
        let day = self.read_digits(2, b"Invalid date: expected a 2-digit day")?;

        if month < 1 || month > 12 {
            return Err(self.err(start, b"Invalid date: month must be between 01 and 12"));
        }
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        let max_day: u32 = match month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            _ => {
                if leap {
                    29
                } else {
                    28
                }
            }
        };
        if day < 1 || day > max_day {
            return Err(self.err(day_pos, b"Invalid date: day is out of range for the month"));
        }

        // Optional time part: 'T'/'t', or a space when a time clearly follows.
        let has_time = match self.peek() {
            b'T' | b't' => {
                self.pos += 1;
                true
            }
            b' ' if self.peek_at(self.pos + 1).is_ascii_digit()
                && self.peek_at(self.pos + 2).is_ascii_digit()
                && self.peek_at(self.pos + 3) == b':' =>
            {
                self.pos += 1;
                true
            }
            _ => false,
        };

        if has_time {
            self.scan_time_digits()?;
            // Optional offset.
            match self.peek() {
                b'Z' | b'z' => {
                    self.pos += 1;
                }
                b'+' | b'-' => {
                    self.pos += 1;
                    let hour =
                        self.read_digits(2, b"Invalid date-time offset: expected 2-digit hours")?;
                    if self.peek() != b':' {
                        return Err(self.err(
                            self.pos,
                            b"Invalid date-time offset: expected ':' between hours and minutes",
                        ));
                    }
                    self.pos += 1;
                    let minute =
                        self.read_digits(2, b"Invalid date-time offset: expected 2-digit minutes")?;
                    if hour > 23 {
                        return Err(self.err(
                            start,
                            b"Invalid date-time offset: hours must be between 00 and 23",
                        ));
                    }
                    if minute > 59 {
                        return Err(self.err(
                            start,
                            b"Invalid date-time offset: minutes must be between 00 and 59",
                        ));
                    }
                }
                _ => {}
            }
        }

        Ok(&self.src[start..self.pos])
    }

    /// `HH:MM[:SS[.frac]]` — seconds are optional in TOML 1.1.
    fn scan_time_digits(&mut self) -> PResult<()> {
        let start = self.pos;
        let hour = self.read_digits(2, b"Invalid time: expected 2-digit hours")?;
        if self.peek() != b':' {
            return Err(self.err(self.pos, b"Invalid time: expected ':' after hours"));
        }
        self.pos += 1;
        let minute = self.read_digits(2, b"Invalid time: expected 2-digit minutes")?;
        if hour > 23 {
            return Err(self.err(start, b"Invalid time: hours must be between 00 and 23"));
        }
        if minute > 59 {
            return Err(self.err(start, b"Invalid time: minutes must be between 00 and 59"));
        }
        // Seconds are optional in TOML 1.1.
        if self.peek() == b':' {
            self.pos += 1;
            let sec_pos = self.pos;
            let second = self.read_digits(2, b"Invalid time: expected 2-digit seconds")?;
            // 60 covers leap seconds, per RFC 3339.
            if second > 60 {
                return Err(self.err(sec_pos, b"Invalid time: seconds must be between 00 and 60"));
            }
            if self.peek() == b'.' {
                self.pos += 1;
                if !self.peek().is_ascii_digit() {
                    return Err(self.err(
                        self.pos,
                        b"Invalid time: expected at least one digit of fractional seconds",
                    ));
                }
                while self.peek().is_ascii_digit() {
                    self.pos += 1;
                }
            }
        }
        Ok(())
    }

    /// Validates an `_` between digits (per `is_digit`) and consumes it.
    fn check_underscore(&mut self, is_digit: impl Fn(u8) -> bool) -> PResult<()> {
        if !is_digit(self.peek_at(self.pos.wrapping_sub(1)))
            || !is_digit(self.peek_at(self.pos + 1))
        {
            return Err(self.err(self.pos, UNDERSCORE_IN_NUMBER));
        }
        self.pos += 1;
        Ok(())
    }

    /// Scans `digit (digit | _)*` with underscore placement validation.
    fn scan_decimal_digits(&mut self) -> PResult<()> {
        loop {
            let c = self.peek();
            if c.is_ascii_digit() {
                self.pos += 1;
            } else if c == b'_' {
                self.check_underscore(|c| c.is_ascii_digit())?;
            } else {
                return Ok(());
            }
        }
    }

    fn scan_number(&mut self) -> PResult<ValueData<'a>> {
        let start = self.pos;

        let negative = match self.peek() {
            b'-' => {
                self.pos += 1;
                true
            }
            b'+' => {
                self.pos += 1;
                false
            }
            _ => false,
        };

        // inf / nan, optionally signed. A longer bare word that merely starts
        // with them (`infinity`, `nanoseconds`) is an unquoted string.
        if self.src[self.pos..].starts_with(b"inf") && !is_bare_key_char(self.peek_at(self.pos + 3))
        {
            self.pos += 3;
            self.expect_value_terminator()?;
            let value = if negative {
                f64::NEG_INFINITY
            } else {
                f64::INFINITY
            };
            return Ok(ValueData::Number(value));
        }
        if self.src[self.pos..].starts_with(b"nan") && !is_bare_key_char(self.peek_at(self.pos + 3))
        {
            self.pos += 3;
            self.expect_value_terminator()?;
            // The sign of NaN is not observable in TOML.
            return Ok(ValueData::Number(f64::NAN));
        }

        // Radix-prefixed integers (unsigned only).
        if self.peek() == b'0' && matches!(self.peek_at(self.pos + 1), b'x' | b'o' | b'b') {
            if negative || self.src[start] == b'+' {
                return Err(self.err(
                    start,
                    b"A sign is not allowed on hexadecimal, octal, or binary integers",
                ));
            }
            return self.scan_radix_integer();
        }

        if !self.peek().is_ascii_digit() {
            // An unsigned bare word (`linker = isolated`) is an unquoted
            // string; anything after a sign is a malformed number.
            if start == self.pos && self.peek().is_ascii_alphabetic() {
                return Err(self.err_unquoted_string(start));
            }
            return Err(self.err_char(self.pos, "Expected a number but found"));
        }

        // Integer part, accumulated as an unsigned magnitude so i64::MIN
        // (magnitude 2^63) is still distinguishable from a 64-bit overflow.
        let int_start = self.pos;
        let mut magnitude: u64 = 0;
        let mut int_overflow = false;
        let mut digits = 0usize;
        loop {
            let c = self.peek();
            if c.is_ascii_digit() {
                digits += 1;
                magnitude = match magnitude
                    .checked_mul(10)
                    .and_then(|v| v.checked_add(u64::from(c - b'0')))
                {
                    Some(v) => v,
                    None => {
                        int_overflow = true;
                        0
                    }
                };
                self.pos += 1;
            } else if c == b'_' {
                self.check_underscore(|c| c.is_ascii_digit())?;
            } else {
                break;
            }
        }
        if digits > 1 && self.src[int_start] == b'0' {
            return Err(self.err(int_start, b"Leading zeros are not allowed in numbers"));
        }

        let mut is_float = false;

        // Fractional part.
        if self.peek() == b'.' {
            is_float = true;
            self.pos += 1;
            if !self.peek().is_ascii_digit() {
                return Err(self.err(
                    self.pos,
                    b"A decimal point must be followed by at least one digit",
                ));
            }
            self.scan_decimal_digits()?;
        }

        // Exponent part.
        if matches!(self.peek(), b'e' | b'E') {
            is_float = true;
            self.pos += 1;
            if matches!(self.peek(), b'+' | b'-') {
                self.pos += 1;
            }
            if !self.peek().is_ascii_digit() {
                return Err(self.err(self.pos, b"An exponent must contain at least one digit"));
            }
            self.scan_decimal_digits()?;
        }

        self.expect_value_terminator()?;

        if is_float {
            // Strip underscores and parse the whole literal as f64.
            let raw = &self.src[start..self.pos];
            let value = if bun_core::strings::contains(raw, b"_") {
                let mut cleaned: ArenaVec<'a, u8> =
                    ArenaVec::with_capacity_in(raw.len(), self.bump);
                for &c in raw {
                    if c != b'_' {
                        cleaned.push(c);
                    }
                }
                bun_core::fmt::parse_double(cleaned.as_slice())
            } else {
                bun_core::fmt::parse_double(raw)
            };
            let value = match value {
                Ok(v) => v,
                Err(_) => return Err(self.err(start, b"Invalid number")),
            };
            return Ok(ValueData::Number(value));
        }

        let signed_limit = if negative {
            1u64 << 63 // |i64::MIN|
        } else {
            i64::MAX as u64
        };
        if int_overflow || magnitude > signed_limit {
            return Err(self.err(start, b"Integer is outside the 64-bit signed range"));
        }
        if magnitude > MAX_SAFE_INTEGER as u64 {
            return Err(self.err(
                start,
                b"Integer cannot be losslessly represented as a JavaScript number; it must be within +/-(2^53 - 1)",
            ));
        }
        // magnitude <= 2^53 - 1, so the casts are exact.
        let signed = if negative {
            -(magnitude as i64)
        } else {
            magnitude as i64
        };
        Ok(ValueData::Number(signed as f64))
    }

    fn scan_radix_integer(&mut self) -> PResult<ValueData<'a>> {
        let start = self.pos;
        debug_assert_eq!(self.peek(), b'0');
        let radix_char = self.peek_at(self.pos + 1);
        let radix: u64 = match radix_char {
            b'x' => 16,
            b'o' => 8,
            _ => 2,
        };
        self.pos += 2;

        let is_digit = |c: u8| -> bool {
            match radix {
                16 => c.is_ascii_hexdigit(),
                8 => (b'0'..=b'7').contains(&c),
                _ => c == b'0' || c == b'1',
            }
        };

        if !is_digit(self.peek()) {
            return Err(self.err(
                self.pos,
                b"Expected at least one digit after the radix prefix",
            ));
        }

        let mut value: u64 = 0;
        let mut overflow = false;
        loop {
            let c = self.peek();
            if is_digit(c) {
                let digit = u64::from(
                    bun_core::fmt::hex_digit_value_u32(u32::from(c)).expect("checked by is_digit"),
                );
                value = match value.checked_mul(radix).and_then(|v| v.checked_add(digit)) {
                    Some(v) => v,
                    None => {
                        overflow = true;
                        0
                    }
                };
                self.pos += 1;
            } else if c == b'_' {
                self.check_underscore(is_digit)?;
            } else if c.is_ascii_alphanumeric() {
                return Err(self.err_char(self.pos, "Invalid digit in number:"));
            } else {
                break;
            }
        }

        self.expect_value_terminator()?;

        if overflow || value > i64::MAX as u64 {
            return Err(self.err(start, b"Integer is outside the 64-bit signed range"));
        }
        if value as i64 > MAX_SAFE_INTEGER {
            return Err(self.err(
                start,
                b"Integer cannot be losslessly represented as a JavaScript number; it must be within +/-(2^53 - 1)",
            ));
        }
        Ok(ValueData::Number(value as f64))
    }

    /// A number or keyword value must be followed by something that can
    /// legitimately come after a value.
    fn expect_value_terminator(&mut self) -> PResult<()> {
        match self.peek() {
            0 if self.at_eof() => Ok(()),
            b' ' | b'\t' | b'\n' | b'\r' | b',' | b']' | b'}' | b'#' => Ok(()),
            _ => Err(self.err_char(self.pos, "Unexpected character after a value:")),
        }
    }

    // ── strings ────────────────────────────────────────────────────────────

    /// Counts the quote run at the cursor. Runs of 3-5 close a multi-line
    /// string (the final 3 are the delimiter, up to 2 belong to the content);
    /// longer runs are an error.
    fn quote_run_close(&mut self, quote: u8) -> PResult<(usize, bool)> {
        let mut run = 0usize;
        while self.peek_at(self.pos + run) == quote {
            run += 1;
        }
        if run > 5 {
            return Err(self.err(
                self.pos,
                b"Too many quotes at the end of a multi-line string",
            ));
        }
        Ok((run, run >= 3))
    }

    /// Copies the borrowed prefix `src[start..end]` into a buffer the first
    /// time decoding has to diverge from the source bytes.
    fn materialize<'b>(
        bump: &'a Bump,
        src: &'a [u8],
        start: usize,
        end: usize,
        buf: &'b mut Option<ArenaVec<'a, u8>>,
    ) -> &'b mut ArenaVec<'a, u8> {
        if buf.is_none() {
            let mut b: ArenaVec<'a, u8> = ArenaVec::with_capacity_in(end - start + 16, bump);
            b.extend_from_slice(&src[start..end]);
            *buf = Some(b);
        }
        buf.as_mut().expect("just set")
    }

    /// Returns (decoded bytes, is_ascii). The content borrows the source
    /// until an escape, CRLF normalization, or quote-run handling forces a
    /// copy — most strings have neither.
    fn scan_basic_string(&mut self, multiline: bool) -> PResult<(&'a [u8], bool)> {
        let open_pos = self.pos;
        self.pos += if multiline { 3 } else { 1 };

        if multiline {
            // A newline immediately after the opening delimiter is trimmed.
            match self.peek() {
                b'\n' => self.pos += 1,
                b'\r' if self.peek_at(self.pos + 1) == b'\n' => self.pos += 2,
                _ => {}
            }
        }

        let start = self.pos;
        let mut buf: Option<ArenaVec<'a, u8>> = None;
        let mut is_ascii = true;
        loop {
            if self.at_eof() {
                return Err(self.err(open_pos, b"Unterminated string"));
            }
            let c = self.peek();
            match c {
                b'"' => {
                    if !multiline {
                        let text = match buf {
                            Some(b) => b.into_bump_slice(),
                            None => &self.src[start..self.pos],
                        };
                        self.pos += 1;
                        return Ok((text, is_ascii));
                    }
                    let (run, closes) = self.quote_run_close(b'"')?;
                    if closes {
                        let extra = run - 3;
                        let text = match buf.take() {
                            Some(mut b) => {
                                for _ in 0..extra {
                                    b.push(b'"');
                                }
                                b.into_bump_slice()
                            }
                            None => &self.src[start..self.pos + extra],
                        };
                        self.pos += run;
                        return Ok((text, is_ascii));
                    }
                    if let Some(b) = &mut buf {
                        for _ in 0..run {
                            b.push(b'"');
                        }
                    }
                    self.pos += run;
                }
                b'\\' => {
                    // Line-ending backslash (multi-line only): trim all
                    // whitespace up to the next non-whitespace character.
                    if multiline {
                        let mut i = self.pos + 1;
                        while matches!(self.peek_at(i), b' ' | b'\t') {
                            i += 1;
                        }
                        let at_line_end = match self.peek_at(i) {
                            b'\n' => true,
                            b'\r' if self.peek_at(i + 1) == b'\n' => true,
                            _ => false,
                        };
                        if at_line_end {
                            Self::materialize(self.bump, self.src, start, self.pos, &mut buf);
                            self.pos = i;
                            loop {
                                match self.peek() {
                                    b' ' | b'\t' | b'\n' => self.pos += 1,
                                    b'\r' if self.peek_at(self.pos + 1) == b'\n' => self.pos += 2,
                                    _ => break,
                                }
                            }
                            continue;
                        }
                    }
                    let b = Self::materialize(self.bump, self.src, start, self.pos, &mut buf);
                    self.scan_escape(b, &mut is_ascii)?;
                }
                b'\n' => {
                    if !multiline {
                        return Err(self.err(
                            open_pos,
                            b"Unterminated string; newlines must be escaped in basic strings",
                        ));
                    }
                    if let Some(b) = &mut buf {
                        b.push(b'\n');
                    }
                    self.pos += 1;
                }
                b'\r' => {
                    if self.peek_at(self.pos + 1) != b'\n' {
                        return Err(self.err(self.pos, BARE_CR));
                    }
                    if !multiline {
                        // A CRLF in a single-line string is the same mistake
                        // as a bare LF, so it gets the same diagnostic.
                        return Err(self.err(
                            open_pos,
                            b"Unterminated string; newlines must be escaped in basic strings",
                        ));
                    }
                    // CRLF normalizes to LF in multi-line strings.
                    Self::materialize(self.bump, self.src, start, self.pos, &mut buf).push(b'\n');
                    self.pos += 2;
                }
                b'\t' => {
                    if let Some(b) = &mut buf {
                        b.push(b'\t');
                    }
                    self.pos += 1;
                }
                c if c < 0x20 || c == 0x7F => {
                    return Err(
                        self.err_char(self.pos, "Control character must be escaped in a string:")
                    );
                }
                c => {
                    if c >= 0x80 {
                        is_ascii = false;
                    }
                    if let Some(b) = &mut buf {
                        b.push(c);
                    }
                    self.pos += 1;
                }
            }
        }
    }

    fn scan_escape(&mut self, buf: &mut ArenaVec<'a, u8>, is_ascii: &mut bool) -> PResult<()> {
        debug_assert_eq!(self.peek(), b'\\');
        let escape_pos = self.pos;
        self.pos += 1;
        let c = self.peek();
        self.pos += 1;
        match c {
            b'b' => buf.push(0x08),
            b't' => buf.push(b'\t'),
            b'n' => buf.push(b'\n'),
            b'f' => buf.push(0x0C),
            b'r' => buf.push(b'\r'),
            b'"' => buf.push(b'"'),
            b'\\' => buf.push(b'\\'),
            // TOML 1.1
            b'e' => buf.push(0x1B),
            b'x' => {
                let cp = self.read_hex_codepoint("hex escape", 2, escape_pos)?;
                self.append_scalar(buf, cp, escape_pos, is_ascii)?;
            }
            b'u' => {
                let cp = self.read_hex_codepoint("Unicode escape", 4, escape_pos)?;
                self.append_scalar(buf, cp, escape_pos, is_ascii)?;
            }
            b'U' => {
                let cp = self.read_hex_codepoint("Unicode escape", 8, escape_pos)?;
                self.append_scalar(buf, cp, escape_pos, is_ascii)?;
            }
            0 if self.at_eof() => {
                return Err(self.err(escape_pos, b"Unterminated escape sequence"));
            }
            _ => {
                self.pos -= 1;
                return Err(self.err_char(self.pos, "Invalid escape sequence:"));
            }
        }
        Ok(())
    }

    fn read_hex_codepoint(
        &mut self,
        what: &'static str,
        digits: usize,
        escape_pos: usize,
    ) -> PResult<u32> {
        let mut value: u32 = 0;
        for _ in 0..digits {
            let Some(d) = bun_core::fmt::hex_digit_value_u32(u32::from(self.peek())) else {
                return Err(self.err_fmt(
                    escape_pos,
                    format_args!(
                        "A {} must be followed by exactly {} hex digits",
                        what, digits
                    ),
                ));
            };
            value = value * 16 + u32::from(d);
            self.pos += 1;
        }
        Ok(value)
    }

    fn append_scalar(
        &mut self,
        buf: &mut ArenaVec<'a, u8>,
        cp: u32,
        escape_pos: usize,
        is_ascii: &mut bool,
    ) -> PResult<()> {
        let Some(ch) = char::from_u32(cp) else {
            return Err(self.err(
                escape_pos,
                b"Escaped code point must be a Unicode scalar value",
            ));
        };
        if cp >= 0x80 {
            *is_ascii = false;
        }
        let mut utf8 = [0u8; 4];
        for &b in ch.encode_utf8(&mut utf8).as_bytes() {
            buf.push(b);
        }
        Ok(())
    }

    /// Returns (decoded bytes, is_ascii). Literal strings have no escapes, so
    /// the content borrows the source unless CRLF normalization forces a copy.
    fn scan_literal_string(&mut self, multiline: bool) -> PResult<(&'a [u8], bool)> {
        let open_pos = self.pos;
        self.pos += if multiline { 3 } else { 1 };

        if multiline {
            // A newline immediately after the opening delimiter is trimmed.
            match self.peek() {
                b'\n' => self.pos += 1,
                b'\r' if self.peek_at(self.pos + 1) == b'\n' => self.pos += 2,
                _ => {}
            }
        }

        let start = self.pos;
        let mut buf: Option<ArenaVec<'a, u8>> = None;
        let mut is_ascii = true;
        loop {
            if self.at_eof() {
                return Err(self.err(open_pos, b"Unterminated string"));
            }
            let c = self.peek();
            match c {
                b'\'' => {
                    if !multiline {
                        let text = match buf {
                            Some(b) => b.into_bump_slice(),
                            None => &self.src[start..self.pos],
                        };
                        self.pos += 1;
                        return Ok((text, is_ascii));
                    }
                    let (run, closes) = self.quote_run_close(b'\'')?;
                    if closes {
                        let extra = run - 3;
                        let text = match buf.take() {
                            Some(mut b) => {
                                for _ in 0..extra {
                                    b.push(b'\'');
                                }
                                b.into_bump_slice()
                            }
                            None => &self.src[start..self.pos + extra],
                        };
                        self.pos += run;
                        return Ok((text, is_ascii));
                    }
                    if let Some(b) = &mut buf {
                        for _ in 0..run {
                            b.push(b'\'');
                        }
                    }
                    self.pos += run;
                }
                b'\n' => {
                    if !multiline {
                        return Err(self.err(
                            open_pos,
                            b"Unterminated string; literal strings cannot contain newlines",
                        ));
                    }
                    if let Some(b) = &mut buf {
                        b.push(b'\n');
                    }
                    self.pos += 1;
                }
                b'\r' => {
                    if self.peek_at(self.pos + 1) != b'\n' {
                        return Err(self.err(self.pos, BARE_CR));
                    }
                    if !multiline {
                        // A CRLF in a single-line string is the same mistake
                        // as a bare LF, so it gets the same diagnostic.
                        return Err(self.err(
                            open_pos,
                            b"Unterminated string; literal strings cannot contain newlines",
                        ));
                    }
                    // CRLF normalizes to LF: switch to a copy if borrowing.
                    Self::materialize(self.bump, self.src, start, self.pos, &mut buf).push(b'\n');
                    self.pos += 2;
                }
                b'\t' => {
                    if let Some(b) = &mut buf {
                        b.push(b'\t');
                    }
                    self.pos += 1;
                }
                c if c < 0x20 || c == 0x7F => {
                    return Err(self.err_char(
                        self.pos,
                        "Control character is not allowed in a literal string:",
                    ));
                }
                c => {
                    if c >= 0x80 {
                        is_ascii = false;
                    }
                    if let Some(b) = &mut buf {
                        b.push(c);
                    }
                    self.pos += 1;
                }
            }
        }
    }
}

// ── parser ──────────────────────────────────────────────────────────────────

/// Consumes tokens from the scanner and builds the `Expr` tree. Has no
/// access to source bytes; every decision is made on a typed token.
struct Parser<'a, 'log> {
    scanner: Scanner<'a, 'log>,
    bump: &'a Bump,
    stack_check: StackCheck,
    /// Keyed by `E::Object::as_ptr()` / `E::Array::as_ptr()` addresses.
    meta: HashMap<usize, Meta>,
    /// Current definition block: bumped per table header and per inline table.
    block: u32,
}

impl<'a, 'log> Parser<'a, 'log> {
    /// Every table/array reachable during parsing was created by this parser
    /// and registered in `meta` at construction.
    fn meta_of(&self, ptr: usize) -> Meta {
        *self
            .meta
            .get(&ptr)
            .expect("table/array was registered at creation")
    }

    // ── document structure ─────────────────────────────────────────────────

    fn parse_root(&mut self) -> PResult<Expr> {
        let start = self.scanner.init_document()?;

        let root = Expr::init(E::Object::default(), loc_of(start));
        let root_ptr = root
            .data
            .e_object()
            .expect("infallible: just constructed")
            .as_ptr();

        let mut current: *mut E::Object = root_ptr;
        loop {
            match self.scanner.scan_line_start()? {
                LineStart::Eof => return Ok(root),
                LineStart::TableOpen { aot, pos } => {
                    current = self.parse_table_header(root_ptr, aot, pos)?;
                    self.scanner.scan_line_end(b"a table header")?;
                }
                LineStart::Key(first) => {
                    self.parse_keyval(current, first)?;
                    self.scanner.scan_line_end(b"a key/value pair")?;
                }
            }
        }
    }

    /// The rest of `[a.b]` / `[[a.b]]` after the opening bracket(s).
    /// Returns the table that becomes current.
    fn parse_table_header(
        &mut self,
        root: *mut E::Object,
        aot: bool,
        header_pos: usize,
    ) -> PResult<*mut E::Object> {
        let mut path: ArenaVec<'a, KeySeg<'a>> = ArenaVec::with_capacity_in(0, self.bump);
        path.push(self.scanner.scan_key_after_sep()?);
        loop {
            match self.scanner.scan_header_sep(aot)? {
                HeaderSep::Dot => path.push(self.scanner.scan_key_after_sep()?),
                HeaderSep::Close => break,
            }
        }

        self.block += 1;
        self.navigate_header(root, &path, aot, header_pos)
    }

    fn navigate_header(
        &mut self,
        root: *mut E::Object,
        path: &[KeySeg<'a>],
        is_aot: bool,
        header_pos: usize,
    ) -> PResult<*mut E::Object> {
        let mut cur: *mut E::Object = root;
        for (i, seg) in path.iter().enumerate() {
            let last = i + 1 == path.len();
            // SAFETY: `cur` always points at an E::Object inside the AST store,
            // created earlier in this parse; the store lives in `self.bump`.
            let cur_obj: &mut E::Object = unsafe { &mut *cur };
            let existing = cur_obj.as_property(seg.text).map(|q| q.expr);
            match existing {
                None => {
                    if last && is_aot {
                        let array = self.new_array(seg.pos, Kind::AotArray);
                        let elem = self.append_aot_elem(array.1, seg.pos)?;
                        self.insert_key(cur, *seg, array.0)?;
                        cur = elem;
                    } else {
                        let kind = if last {
                            Kind::Header
                        } else {
                            Kind::HeaderImplicit
                        };
                        let (expr, ptr) = self.new_table(seg.pos, kind);
                        self.insert_key(cur, *seg, expr)?;
                        cur = ptr;
                    }
                }
                Some(found) => {
                    if let Some(obj) = found.data.e_object() {
                        let ptr = obj.as_ptr();
                        let meta = self.meta_of(ptr as usize);
                        if last {
                            if is_aot {
                                return Err(self.scanner.err_keyed(
                                    header_pos,
                                    "Cannot redefine table",
                                    seg.text,
                                    " as an array of tables",
                                ));
                            }
                            match meta.kind {
                                Kind::HeaderImplicit => {
                                    self.meta.insert(
                                        ptr as usize,
                                        Meta {
                                            kind: Kind::Header,
                                            block: self.block,
                                        },
                                    );
                                    cur = ptr;
                                }
                                Kind::Inline => {
                                    return Err(self.scanner.err_keyed(
                                        header_pos,
                                        "Cannot redefine inline table",
                                        seg.text,
                                        "",
                                    ));
                                }
                                _ => {
                                    return Err(self.scanner.err_keyed(
                                        header_pos,
                                        "Cannot redefine table",
                                        seg.text,
                                        "",
                                    ));
                                }
                            }
                        } else {
                            if meta.kind == Kind::Inline {
                                return Err(self.scanner.err_keyed(
                                    header_pos,
                                    "Cannot extend inline table",
                                    seg.text,
                                    "",
                                ));
                            }
                            cur = ptr;
                        }
                    } else if let Some(arr) = found.data.e_array() {
                        let ptr = arr.as_ptr();
                        let meta = self.meta_of(ptr as usize);
                        if meta.kind != Kind::AotArray {
                            return Err(self.scanner.err_keyed(
                                header_pos,
                                "Cannot extend array",
                                seg.text,
                                "",
                            ));
                        }
                        if last {
                            if !is_aot {
                                return Err(self.scanner.err_keyed(
                                    header_pos,
                                    "Cannot redefine array of tables",
                                    seg.text,
                                    " as a table",
                                ));
                            }
                            cur = self.append_aot_elem(ptr, seg.pos)?;
                        } else {
                            // Descend into the most recent element.
                            // SAFETY: AoT arrays only ever contain E::Object
                            // elements appended by `append_aot_elem`.
                            let items = unsafe { (*ptr).items.as_slice() };
                            let last_elem = items.last().expect("AoT arrays are never empty");
                            cur = last_elem
                                .data
                                .e_object()
                                .expect("AoT elements are tables")
                                .as_ptr();
                        }
                    } else {
                        return Err(self.scanner.err_keyed(
                            header_pos,
                            "Cannot redefine key",
                            seg.text,
                            if last && is_aot {
                                " as an array of tables"
                            } else {
                                " as a table"
                            },
                        ));
                    }
                }
            }
        }
        Ok(cur)
    }

    /// The rest of `key = value` (including dotted keys) after the first key
    /// segment, inserted into `table`.
    fn parse_keyval(&mut self, table: *mut E::Object, first: KeySeg<'a>) -> PResult<()> {
        let mut path: ArenaVec<'a, KeySeg<'a>> = ArenaVec::with_capacity_in(0, self.bump);
        path.push(first);
        loop {
            match self.scanner.scan_keyval_sep()? {
                KeyvalSep::Dot => path.push(self.scanner.scan_key_after_sep()?),
                KeyvalSep::Equals => break,
            }
        }
        let token = self.scanner.scan_value_required()?;
        let value = self.parse_value(token)?;
        self.assign_path(table, &path, value)
    }

    /// Walks the dotted path from `table`, creating dotted tables as needed,
    /// and inserts `value` at the final segment.
    fn assign_path(
        &mut self,
        table: *mut E::Object,
        path: &[KeySeg<'a>],
        value: Expr,
    ) -> PResult<()> {
        let mut cur = table;
        for seg in &path[..path.len() - 1] {
            // SAFETY: `cur` points at a live E::Object in the AST store.
            let cur_obj: &mut E::Object = unsafe { &mut *cur };
            match cur_obj.as_property(seg.text).map(|q| q.expr) {
                None => {
                    let (expr, ptr) = self.new_table(seg.pos, Kind::Dotted);
                    self.insert_key(cur, *seg, expr)?;
                    cur = ptr;
                }
                Some(found) => {
                    let Some(obj) = found.data.e_object() else {
                        return Err(self.scanner.err_keyed(
                            seg.pos,
                            "Cannot redefine key",
                            seg.text,
                            "",
                        ));
                    };
                    let ptr = obj.as_ptr();
                    let meta = self.meta_of(ptr as usize);
                    let extendable = meta.kind == Kind::Dotted && meta.block == self.block;
                    if !extendable {
                        return Err(self.scanner.err_keyed(
                            seg.pos,
                            "Cannot extend table",
                            seg.text,
                            " with a dotted key",
                        ));
                    }
                    cur = ptr;
                }
            }
        }
        let last = path[path.len() - 1];
        self.insert_key(cur, last, value)
    }

    // ── values ─────────────────────────────────────────────────────────────

    fn parse_value(&mut self, token: ValueToken<'a>) -> PResult<Expr> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(PErr::StackOverflow);
        }
        let loc = loc_of(token.pos);
        match token.data {
            ValueData::String { text, is_ascii } => Ok(self.string_expr(text, is_ascii, loc)),
            ValueData::Number(n) => Ok(Expr::init(E::Number::new(n), loc)),
            ValueData::DateTime(text) => Ok(Expr::init(E::String::init(text), loc)),
            ValueData::Boolean(b) => Ok(Expr::init(E::Boolean { value: b }, loc)),
            ValueData::ArrayOpen => self.parse_array(token.pos),
            ValueData::InlineOpen => self.parse_inline_table(token.pos),
        }
    }

    fn string_expr(&self, text: &'a [u8], is_ascii: bool, loc: Loc) -> Expr {
        if is_ascii {
            Expr::init(E::String::init(text), loc)
        } else {
            Expr::init(E::String::init_re_encode_utf8(text, self.bump), loc)
        }
    }

    /// The rest of `[ ... ]` after the opening bracket.
    fn parse_array(&mut self, pos: usize) -> PResult<Expr> {
        let (array, ptr) = self.new_array(pos, Kind::StaticArray);

        loop {
            match self.scanner.scan_array_item()? {
                ArrayItem::Close => return Ok(array),
                ArrayItem::Eof { pos } => {
                    return Err(self.scanner.err(pos, b"Unterminated array; expected ']'"));
                }
                ArrayItem::Value(token) => {
                    let value = self.parse_value(token)?;
                    // SAFETY: `ptr` points at the E::Array constructed above.
                    unsafe { (*ptr).push(self.bump, value)? };
                }
            }
            match self
                .scanner
                .scan_list_sep(b']', "Expected ',' or ']' in an array but found")?
            {
                ListSep::Comma => {}
                ListSep::Close => return Ok(array),
            }
        }
    }

    /// The rest of `{ ... }` after the opening brace.
    fn parse_inline_table(&mut self, pos: usize) -> PResult<Expr> {
        // An inline table is its own definition block so dotted keys inside it
        // cannot extend outer tables and vice versa.
        let outer_block = self.block;
        self.block += 1;

        let (table, ptr) = self.new_table(pos, Kind::Dotted);

        loop {
            match self.scanner.scan_inline_key()? {
                InlineKey::Close => break,
                InlineKey::Eof { pos } => {
                    return Err(self
                        .scanner
                        .err(pos, b"Unterminated inline table; expected '}'"));
                }
                InlineKey::Key(first) => {
                    self.parse_keyval(ptr, first)?;
                }
            }
            match self
                .scanner
                .scan_list_sep(b'}', "Expected ',' or '}' in an inline table but found")?
            {
                ListSep::Comma => {
                    // A trailing comma before '}' is allowed; a second comma
                    // is not, which `scan_inline_key` will reject.
                }
                ListSep::Close => break,
            }
        }

        // Inline tables are closed: nothing may extend them later.
        self.meta.insert(
            ptr as usize,
            Meta {
                kind: Kind::Inline,
                block: self.block,
            },
        );
        self.block = outer_block;
        Ok(table)
    }

    // ── table bookkeeping ──────────────────────────────────────────────────

    fn new_table(&mut self, pos: usize, kind: Kind) -> (Expr, *mut E::Object) {
        let expr = Expr::init(E::Object::default(), loc_of(pos));
        let ptr = expr
            .data
            .e_object()
            .expect("infallible: just constructed")
            .as_ptr();
        self.meta.insert(
            ptr as usize,
            Meta {
                kind,
                block: self.block,
            },
        );
        (expr, ptr)
    }

    fn new_array(&mut self, pos: usize, kind: Kind) -> (Expr, *mut E::Array) {
        let expr = Expr::init(E::Array::default(), loc_of(pos));
        let ptr = expr
            .data
            .e_array()
            .expect("infallible: just constructed")
            .as_ptr();
        self.meta.insert(
            ptr as usize,
            Meta {
                kind,
                block: self.block,
            },
        );
        (expr, ptr)
    }

    fn append_aot_elem(&mut self, array: *mut E::Array, pos: usize) -> PResult<*mut E::Object> {
        let (elem, ptr) = self.new_table(pos, Kind::ArrayElem);
        // SAFETY: `array` points at a live E::Array in the AST store.
        unsafe { (*array).push(self.bump, elem)? };
        Ok(ptr)
    }

    fn insert_key(&mut self, obj: *mut E::Object, seg: KeySeg<'a>, value: Expr) -> PResult<()> {
        // SAFETY: `obj` points at a live E::Object in the AST store.
        let obj: &mut E::Object = unsafe { &mut *obj };
        // The duplicate check must use the UTF-8 key bytes: `as_property`
        // compares correctly against both 8-bit and UTF-16 stored keys.
        if obj.as_property(seg.text).is_some() {
            return Err(self
                .scanner
                .err_keyed(seg.pos, "Cannot redefine key", seg.text, ""));
        }
        let key_loc = loc_of(seg.pos);
        let key_expr = if seg.text.is_ascii() {
            Expr::init(E::String::init(seg.text), key_loc)
        } else {
            Expr::init(E::String::init_re_encode_utf8(seg.text, self.bump), key_loc)
        };
        obj.append_property(key_expr, value);
        Ok(())
    }
}
