//! `interchange::json_lexer` — JSON-only subset of `js_lexer`.
//!
//! `bun_parsers::json` previously imported
//! `bun_js_parser::js_lexer::Lexer` (T4), creating a GENUINE same-tier cycle
//! (`bun_js_parser` → `bun_interchange` → `bun_js_parser`). Per the cycle-break
//! plan, the ~10 lexer entry-points JSON actually exercises are inlined here
//! against the *is_json = true* compile-time branch only — i.e. every
//! `if (comptime is_json) …` arm in `src/js_parser/lexer.zig` is taken, every
//! JS-only arm (operators, JSX, regexp, template literals, pragmas, hashbang,
//! private identifiers, bigint) is dropped or hard-errors via
//! `add_unsupported_syntax_error`. The full `T` token enum is collapsed to the
//! tokens the JSON parser matches on.
//!
//! Source: `src/js_parser/lexer.zig` — `JSONOptions`, `NewLexer_` with
//! `is_json = true`, `next`, `parseStringLiteral`, `parseNumericLiteralOrDot`,
//! `expect`/`expected`/`unexpected`, `range`/`loc`/`raw`, `init`/`initJSON`,
//! `toEString`/`toUTF8EString`, `step`/`nextCodepoint`.
//!
//! `bun_js_parser::js_lexer` remains the canonical lexer; this module is a
//! sliced re-port and is NOT re-exported outside `bun_interchange`.

#![allow(dead_code)]

use bun_alloc::Arena as Bump;

use bun_ast as js_ast;
use bun_ast::{Indentation, LexerLog};
use bun_core::fmt::hex_digit_value_u32;
use bun_core::strings;
use bun_core::strings::CodePoint;

// ──────────────────────────────────────────────────────────────────────────
// JSONOptions
// ──────────────────────────────────────────────────────────────────────────

/// Zig: `pub const JSONOptions = struct { ... }` (lexer.zig:37).
#[derive(Clone, Copy)]
pub struct JSONOptions {
    /// Enable JSON-specific warnings/errors.
    pub is_json: bool,
    /// tsconfig.json supports comments & trailing commas.
    pub allow_comments: bool,
    pub allow_trailing_commas: bool,
    /// Loading JSON-in-JSON may start like `\"\"` — technically invalid; we
    /// parse from the first value of the string.
    pub ignore_leading_escape_sequences: bool,
    pub ignore_trailing_escape_sequences: bool,
    pub json_warn_duplicate_keys: bool,
    /// Mark as originally for a macro to enable inlining.
    pub was_originally_macro: bool,
    pub guess_indentation: bool,
}

impl JSONOptions {
    pub const DEFAULT: JSONOptions = JSONOptions {
        is_json: false,
        allow_comments: false,
        allow_trailing_commas: false,
        ignore_leading_escape_sequences: false,
        ignore_trailing_escape_sequences: false,
        // NOTE: Zig default is `true` (lexer.zig:50).
        json_warn_duplicate_keys: true,
        was_originally_macro: false,
        guess_indentation: false,
    };
}

impl Default for JSONOptions {
    fn default() -> Self {
        Self::DEFAULT
    }
}

// ──────────────────────────────────────────────────────────────────────────
// T — token kind (JSON subset)
// ──────────────────────────────────────────────────────────────────────────

/// Zig: `js_lexer_tables.T`. This enum carries ONLY the variants the JSON
/// parser inspects; every JS-only token collapses into `TSyntaxError` here.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum T {
    TEndOfFile,
    TSyntaxError,

    TOpenBrace,
    TCloseBrace,
    TOpenBracket,
    TCloseBracket,
    TComma,
    TColon,
    TMinus,

    TTrue,
    TFalse,
    TNull,

    TStringLiteral,
    TNumericLiteral,
    TIdentifier,
}

impl T {
    /// Zig: `tokenToString.get(token)`. Only the JSON subset has names; the
    /// rest fall through to `unexpected()`.
    fn to_str(self) -> &'static str {
        match self {
            T::TEndOfFile => "end of file",
            T::TOpenBrace => "\"{\"",
            T::TCloseBrace => "\"}\"",
            T::TOpenBracket => "\"[\"",
            T::TCloseBracket => "\"]\"",
            T::TComma => "\",\"",
            T::TColon => "\":\"",
            T::TMinus => "\"-\"",
            T::TTrue => "\"true\"",
            T::TFalse => "\"false\"",
            T::TNull => "\"null\"",
            T::TStringLiteral => "string",
            T::TNumericLiteral => "number",
            T::TIdentifier => "identifier",
            T::TSyntaxError => "",
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Lexer
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum StringLiteralFormat {
    Ascii,
    Utf16,
    NeedsDecode,
}

/// Tracks indentation guessing state (only meaningful when
/// `JSONOptions::guess_indentation`).
#[derive(Clone, Copy)]
pub struct IndentInfo {
    pub guess: Indentation,
    pub first_newline: bool,
}

impl Default for IndentInfo {
    fn default() -> Self {
        Self {
            guess: Indentation::default(),
            first_newline: true,
        }
    }
}

/// JSON-only lexer. Field layout mirrors the Zig `LexerType` for the fields
/// the JSON parser reads directly (`token`, `number`, `has_newline_before`,
/// `source`, `end`, `is_ascii_only`, `identifier`, `indent_info`).
///
/// PORT NOTE — borrowck/Stacked Borrows: Zig stored `log: *logger.Log` on
/// both the lexer *and* the parser (json.zig:103,119). The Rust port keeps a
/// single `*mut Log` here as the sole provenance chain; the parser does **not**
/// hold its own `&mut Log` (that would alias this pointer and any parser-side
/// `&mut` deref would invalidate the lexer's SharedReadWrite tag — UB the next
/// time the lexer reports an error). Parser-side log writes go through
/// `log_mut()`. Matches the toml lexer's shape.
pub struct Lexer<'a, 'bump> {
    // PORT NOTE: raw ptr — see struct doc.
    log: *mut bun_ast::Log,
    pub source: &'a bun_ast::Source,
    bump: &'bump Bump,

    pub current: usize,
    pub start: usize,
    pub end: usize,
    approximate_newline_count: usize,

    pub token: T,
    pub has_newline_before: bool,
    did_panic: bool,
    is_log_disabled: bool,

    pub code_point: CodePoint,
    pub identifier: &'a [u8],
    pub number: f64,
    prev_error_loc: bun_ast::Loc,

    string_literal_raw_content: &'a [u8],
    string_literal_start: usize,
    string_literal_raw_format: StringLiteralFormat,

    /// Only used for JSON stringification when bundling.
    pub is_ascii_only: bool,

    /// Runtime copy of the comptime `JSONOptions`. The cold-path flags
    /// (`allow_comments`, `guess_indentation`, `ignore_leading_escape_sequences`)
    /// stay runtime; the hot per-byte string loop is monomorphised over
    /// `const QUOTE: u8` and reads `is_json` as compile-time `true` (this
    /// module is the is_json slice — see file header), so nothing in
    /// `parse_string_literal_inner` loads through this field.
    opts: JSONOptions,
    pub indent_info: IndentInfo,
}

type LexResult<T = ()> = Result<T, bun_core::Error>;

impl<'a, 'bump> LexerLog<'a> for Lexer<'a, 'bump> {
    type Err = bun_core::Error;
    #[inline]
    fn log_mut(&mut self) -> &mut bun_ast::Log {
        unsafe { &mut *self.log }
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
    fn is_log_disabled(&self) -> bool {
        self.is_log_disabled
    }
    #[inline]
    fn syntax_err() -> bun_core::Error {
        bun_core::err!("SyntaxError")
    }
}

impl<'a, 'bump> Lexer<'a, 'bump>
where
    // `identifier` may point into `source.contents` (`'a`) *or* a bump-alloc'd
    // decode buffer (`'bump`); the slow-path escape-decoder writes the latter.
    'bump: 'a,
{
    // ── construction ─────────────────────────────────────────────────────

    fn init_without_reading(
        log: &mut bun_ast::Log,
        source: &'a bun_ast::Source,
        bump: &'bump Bump,
        opts: JSONOptions,
    ) -> Self {
        Self {
            log: std::ptr::from_mut::<bun_ast::Log>(log),
            source,
            bump,
            current: 0,
            start: 0,
            end: 0,
            approximate_newline_count: 0,
            token: T::TEndOfFile,
            has_newline_before: false,
            did_panic: false,
            is_log_disabled: false,
            code_point: -1,
            identifier: b"",
            number: 0.0,
            prev_error_loc: bun_ast::Loc::EMPTY,
            string_literal_raw_content: b"",
            string_literal_start: 0,
            string_literal_raw_format: StringLiteralFormat::Ascii,
            is_ascii_only: true,
            opts,
            indent_info: IndentInfo::default(),
        }
    }

    /// Zig: `init` — `NewLexer(opts).init`. The parser's 8 const-generic bools
    /// are flattened back into a runtime `JSONOptions` here; the JSON token
    /// loop is small enough that the comptime specialisation buys nothing at
    /// this layer (the full JS lexer is where it mattered).
    pub fn init(
        log: &mut bun_ast::Log,
        source: &'a bun_ast::Source,
        bump: &'bump Bump,
        opts: JSONOptions,
    ) -> LexResult<Self> {
        let mut lex = Self::init_without_reading(log, source, bump, opts);
        lex.step();
        lex.next()?;
        Ok(lex)
    }

    /// Zig: `initJSON` — identical body to `init` for the JSON lexer; kept as a
    /// separate entry point because `json.rs` calls it by name in the
    /// `MAYBE_AUTO_QUOTE` retry path.
    pub fn init_json(
        log: &mut bun_ast::Log,
        source: &'a bun_ast::Source,
        bump: &'bump Bump,
        opts: JSONOptions,
    ) -> LexResult<Self> {
        let mut lex = Self::init_without_reading(log, source, bump, opts);
        lex.step();
        lex.next()?;
        Ok(lex)
    }

    // ── positioning ──────────────────────────────────────────────────────

    #[inline]
    pub fn loc(&self) -> bun_ast::Loc {
        bun_ast::usize2loc(self.start)
    }

    #[inline]
    pub fn range(&self) -> bun_ast::Range {
        bun_ast::Range {
            loc: bun_ast::usize2loc(self.start),
            len: (self.end - self.start) as i32,
        }
    }

    #[inline]
    pub fn raw(&self) -> &'a [u8] {
        &self.source.contents[self.start..self.end]
    }

    // ── error reporting ──────────────────────────────────────────────────

    /// Single provenance chain to the `Log` — the parser routes its own log
    /// writes through here too (see struct doc).
    #[inline]
    pub fn log_mut(&self) -> &mut bun_ast::Log {
        // SAFETY: see struct doc — `log` is the only handle to the `Log` for
        // the lifetime of the parse; no `&mut Log` is held elsewhere, so this
        // deref never overlaps another live borrow.
        unsafe { &mut *self.log }
    }

    /// Raw pointer escape hatch for the `MAYBE_AUTO_QUOTE` retry path in
    /// `json.rs`, which must rebuild a fresh `Lexer` over the same `Log`
    /// without introducing a second `&mut` provenance chain.
    #[inline]
    pub(crate) fn log_ptr(&self) -> *mut bun_ast::Log {
        self.log
    }

    #[cold]
    fn add_unsupported_syntax_error(&mut self, msg: &str) -> LexResult {
        self.add_error(self.end, format_args!("Unsupported syntax: {}", msg));
        Err(bun_core::err!("SyntaxError"))
    }

    // ── stepping ─────────────────────────────────────────────────────────

    #[inline(always)]
    fn next_codepoint(&mut self) -> CodePoint {
        strings::lexer_step::next_codepoint(&self.source.contents, &mut self.current, &mut self.end)
    }

    #[inline]
    fn step(&mut self) {
        self.code_point = self.next_codepoint();
        // Track approximate newlines for sourcemap line-offset preallocation.
        self.approximate_newline_count += (self.code_point == '\n' as CodePoint) as usize;
    }

    // ── expect / unexpected ──────────────────────────────────────────────

    #[inline]
    pub fn expect(&mut self, token: T) -> LexResult {
        if self.token != token {
            self.expected(token)?;
        }
        self.next()
    }

    #[cold]
    fn expected(&mut self, token: T) -> LexResult {
        let name = token.to_str();
        if !name.is_empty() {
            self.expected_string(name)
        } else {
            self.unexpected()
        }
    }

    #[cold]
    fn expected_string(&mut self, text: &str) -> LexResult {
        // PORT NOTE: the `prev_token_was_await_keyword` branch is JS-only and
        // dropped here.
        let r = self.range();
        if self.source.contents.len() != self.start {
            let raw = self.raw();
            self.add_range_error(
                r,
                format_args!("Expected {} but found \"{}\"", text, bstr::BStr::new(raw)),
            )?;
        } else {
            self.add_range_error(r, format_args!("Expected {} but found end of file", text))?;
        }
        // Spec lexer.zig:1798-1863 — `expectedString` only logs via
        // `addRangeError` and returns void; it does NOT raise. `expect()` then
        // falls through to `next()` for error recovery.
        Ok(())
    }

    #[cold]
    pub fn unexpected(&mut self) -> LexResult {
        self.start = self.start.min(self.end);
        let r = self.range();
        if self.start == self.source.contents.len() {
            self.did_panic = true;
            self.add_range_error(r, format_args!("Unexpected end of file"))?;
        } else {
            let raw = self.raw();
            self.did_panic = true;
            self.add_range_error(r, format_args!("Unexpected {}", bstr::BStr::new(raw)))?;
        }
        // Spec lexer.zig:1798-1812 — `unexpected` only logs and returns void;
        // callers (e.g. `parse_expr` else arm) follow with an explicit
        // `error.ParserError` if they need to abort.
        Ok(())
    }

    // ── string literal ───────────────────────────────────────────────────

    /// Runtime-quote dispatcher kept for the `MAYBE_AUTO_QUOTE` retry path in
    /// `json.rs` (which calls with `0`). Forwards to the const-generic body so
    /// the per-byte loop always sees a compile-time `QUOTE`.
    #[inline]
    pub fn parse_string_literal(&mut self, quote: CodePoint) -> LexResult {
        match quote {
            0 => self.parse_string_literal_inner::<0>(),
            q if q == '"' as CodePoint => self.parse_string_literal_inner::<b'"'>(),
            q if q == '\'' as CodePoint => self.parse_string_literal_inner::<b'\''>(),
            // Only the three above are ever passed (lexer.zig:630 takes
            // `comptime quote`); anything else is a port bug.
            _ => unreachable!("parse_string_literal: invalid quote {}", quote),
        }
    }

    /// Zig: `parseStringLiteral(comptime quote)` with `is_json = true`,
    /// template-literal (`\``) and `$`-substitution arms removed. `QUOTE == 0`
    /// is the implicit (.env auto-quote) string.
    ///
    /// PERF: `QUOTE` is a const generic mirroring Zig's `comptime quote:
    /// CodePoint` so the per-byte `match` folds to a guard-free jump table and
    /// the `QUOTE == 0` / SIMD-gate checks const-propagate away. `is_json` is
    /// hard-wired `true` (this module *is* the is_json slice — see file header)
    /// so the `< 0x20` control-char check is branchless on the option load.
    fn parse_string_literal_inner<const QUOTE: u8>(&mut self) -> LexResult {
        self.token = T::TStringLiteral;
        // quote is 0 when parsing JSON from .env — values may be unquoted.
        self.step();

        let mut needs_decode = false;
        let suffix_len: usize = if QUOTE == 0 { 0 } else { 1 };
        // Hoisted out of the (rare) `\\` arm so the loop body never reloads
        // through `&self.opts`.
        let ignore_trailing_esc = self.opts.ignore_trailing_escape_sequences;

        loop {
            // Literal arms only (no `if` guards) so LLVM can lower this to a
            // dense switch; the quote check lives in the fall-through body as a
            // single cmp-against-immediate.
            match self.code_point {
                0x5C /* \\ */ => {
                    needs_decode = true;
                    self.step();

                    if ignore_trailing_esc
                        && self.code_point == QUOTE as CodePoint
                        && self.current >= self.source.contents.len()
                    {
                        self.step();
                        break;
                    }

                    match self.code_point {
                        // 0 cannot be in this list because it may be a legacy octal literal.
                        0x60 /* ` */ | 0x27 /* ' */ | 0x22 /* " */ | 0x5C /* \\ */ => {
                            self.step();
                            continue;
                        }
                        _ => {}
                    }
                }
                -1 => {
                    if QUOTE != 0 {
                        self.add_default_error(b"Unterminated string literal")?;
                    }
                    break;
                }
                0x0D /* \r */ => {
                    self.add_default_error(b"Unterminated string literal")?;
                }
                0x0A /* \n */ => {
                    // Implicitly-quoted strings end at newline OR EOF (.env only).
                    if QUOTE == 0 {
                        break;
                    }
                    self.add_default_error(b"Unterminated string literal")?;
                }
                cp => {
                    if cp == QUOTE as CodePoint {
                        self.step();
                        break;
                    }
                    // Non-ASCII strings need the slow path.
                    if cp >= 0x80 {
                        needs_decode = true;
                    } else if cp < 0x20 {
                        // `comptime is_json` is always true in this module.
                        self.syntax_error()?;
                    } else if (QUOTE == b'"' || QUOTE == b'\'') && bun_core::env::IS_NATIVE {
                        // Spec lexer.zig:730-740 — SIMD skip-ahead over plain
                        // ASCII string content. Critical for inline-sourcemap
                        // JSON where `sourcesContent` can be hundreds of KB.
                        let remainder = &self.source.contents[self.current..];
                        if remainder.len() >= 4096 {
                            match bun_highway::index_of_interesting_character_in_string_literal(
                                remainder,
                                QUOTE,
                            ) {
                                Some(off) => {
                                    self.current += off;
                                    self.end = self.current.saturating_sub(1);
                                    self.step();
                                    continue;
                                }
                                None => {
                                    self.step();
                                    continue;
                                }
                            }
                        }
                    }
                }
            }
            self.step();
        }

        // Reset string literal.
        let base = if QUOTE == 0 {
            self.start
        } else {
            self.start + 1
        };
        let end_pos = self.end.saturating_sub(suffix_len);
        let slice_end = self.source.contents.len().min(base.max(end_pos));
        self.string_literal_raw_content = &self.source.contents[base..slice_end];
        self.string_literal_raw_format = if needs_decode {
            StringLiteralFormat::NeedsDecode
        } else {
            StringLiteralFormat::Ascii
        };
        self.string_literal_start = self.start;
        self.is_ascii_only = self.is_ascii_only && !needs_decode;

        // Spec lexer.zig:775-779 gates the "JSON strings must use double quotes"
        // error on `if (comptime !FeatureFlags.allow_json_single_quotes)`, and
        // feature_flags.zig:24 sets `allow_json_single_quotes = true`, so the
        // spec NEVER emits this error.

        Ok(())
    }

    /// Zig: `toEString`.
    pub fn to_e_string(&mut self) -> LexResult<js_ast::E::String> {
        match self.string_literal_raw_format {
            StringLiteralFormat::Ascii => {
                Ok(js_ast::E::String::init(self.string_literal_raw_content))
            }
            StringLiteralFormat::Utf16 => {
                // SAFETY: when Utf16, the raw-content slice was produced from a
                // `[]const u16` reinterpreted as bytes; len is the u16 count.
                // (JSON path never sets Utf16 — only the JSX rescan does.)
                let s16 = unsafe {
                    core::slice::from_raw_parts(
                        self.string_literal_raw_content.as_ptr().cast::<u16>(),
                        self.string_literal_raw_content.len(),
                    )
                };
                Ok(js_ast::E::String::init_utf16(s16))
            }
            StringLiteralFormat::NeedsDecode => {
                // Escape parsing may surface a syntax error.
                let mut buf: Vec<u16> = Vec::with_capacity(self.string_literal_raw_content.len());
                self.decode_escape_sequences(
                    self.string_literal_start,
                    self.string_literal_raw_content,
                    &mut buf,
                )?;
                if strings::first_non_ascii16(&buf).is_some() {
                    let out = self.bump.alloc_slice_copy(&buf);
                    Ok(js_ast::E::String::init_utf16(out))
                } else {
                    let out = self.bump.alloc_slice_fill_with(buf.len(), |i| buf[i] as u8);
                    Ok(js_ast::E::String::init(out))
                }
            }
        }
    }

    /// Zig: `toUTF8EString`.
    pub fn to_utf8_e_string(&mut self) -> LexResult<js_ast::E::String> {
        let mut res = self.to_e_string()?;
        if res.is_utf16 {
            let utf8 = strings::to_utf8_alloc(res.slice16());
            let out = self.bump.alloc_slice_copy(&utf8);
            res = js_ast::E::String::init(out);
        }
        Ok(res)
    }

    /// Zig: `decodeEscapeSequences`. Ported for the `is_json = true` arm only —
    /// legacy-octal, template `\r\n` normalization and tagged-template raw
    /// preservation are JS-only and dropped.
    // TODO(port): JSON spec only permits `\" \\ \/ \b \f \n \r \t \uXXXX`; the
    // Zig path additionally accepts `\0` `\v` `\x` `\u{…}` etc. and then errors
    // post-hoc via `is_json` checks. Mirror that once the surrogate-pair
    // handling in `bun_str` is wired.
    fn decode_escape_sequences(
        &mut self,
        _start: usize,
        text: &[u8],
        buf: &mut Vec<u16>,
    ) -> LexResult {
        self.is_ascii_only = false;

        let iterator = strings::CodepointIterator::init(text);
        let mut iter = strings::Cursor::default();
        while iterator.next(&mut iter) {
            let c = iter.c;
            match c {
                cp if cp == '\\' as CodePoint => {
                    // Spec lexer.zig:321 — `_ = iterator.next(&iter) or return;`
                    // (silent Ok return on a trailing backslash).
                    if !iterator.next(&mut iter) {
                        return Ok(());
                    }
                    let c2 = iter.c;
                    match c2 {
                        cp if cp == 'b' as CodePoint => buf.push(0x08),
                        cp if cp == 'f' as CodePoint => buf.push(0x0c),
                        cp if cp == 'n' as CodePoint => buf.push(0x0a),
                        cp if cp == 'r' as CodePoint => buf.push(0x0d),
                        cp if cp == 't' as CodePoint => buf.push(0x09),
                        cp if cp == 'v' as CodePoint => {
                            // Vertical tab is invalid JSON. Spec lexer.zig:340-349
                            // has the is_json check COMMENTED OUT with note
                            // "We're going to allow it" — unconditionally push.
                            buf.push(0x0b);
                        }
                        // Spec lexer.zig:426-428 — `'8','9'` pass through as the
                        // digit char (no is_json gate).
                        cp if cp == '8' as CodePoint || cp == '9' as CodePoint => {
                            push_codepoint(buf, c2);
                        }
                        // Spec lexer.zig:430-474 — `\xNN` 2-digit hex (no is_json gate).
                        cp if cp == 'x' as CodePoint => {
                            let mut value: CodePoint = 0;
                            for _ in 0..2 {
                                if !iterator.next(&mut iter) {
                                    return self.syntax_error();
                                }
                                let c3 = iter.c;
                                value = match hex_digit_value_u32(c3 as u32) {
                                    Some(d) => value * 16 | d as CodePoint,
                                    None => return self.syntax_error(),
                                };
                            }
                            push_codepoint(buf, value);
                        }
                        // Spec lexer.zig:596-607 — only `"` `\` `/` are whitelisted
                        // for the is_json `else` arm; `\'` falls through to syntaxError.
                        cp if cp == '"' as CodePoint
                            || cp == '\\' as CodePoint
                            || cp == '/' as CodePoint =>
                        {
                            buf.push(c2 as u16);
                        }
                        cp if cp == 'u' as CodePoint => {
                            let mut value: u32 = 0;
                            for _ in 0..4 {
                                if !iterator.next(&mut iter) {
                                    return self.syntax_error();
                                }
                                let h = iter.c;
                                let digit = match hex_digit_value_u32(h as u32) {
                                    Some(d) => d as u32,
                                    None => return self.syntax_error(),
                                };
                                value = value * 16 + digit;
                            }
                            buf.push(value as u16);
                        }
                        _ => {
                            // `comptime is_json` is always true in this module
                            // (see file header) — the Zig pass-through arm is
                            // unreachable here.
                            return self.syntax_error();
                        }
                    }
                }
                _ => push_codepoint(buf, c),
            }
        }
        Ok(())
    }

    // ── numeric literal ──────────────────────────────────────────────────

    /// Zig: `parseNumericLiteralOrDot`. Spec lexer.zig:2736-2998 has NO is_json
    /// gate on the radix-prefix integer-literal path (`0x…/0b…/0o…`/legacy
    /// octal) or underscore separators, so they are accepted here too. Only the
    /// bigint `'n'` token is JS-only and left to the trailing
    /// `is_identifier_start` syntax error.
    fn parse_numeric_literal_or_dot(&mut self) -> LexResult {
        let first = self.code_point;
        self.step();

        // Dot without a digit after it — JSON has no `.` token; treat as syntax.
        if first == '.' as CodePoint
            && (self.code_point < '0' as CodePoint || self.code_point > '9' as CodePoint)
        {
            return self.syntax_error();
        }

        let mut underscore_count: usize = 0;
        let mut last_underscore_end: usize = 0;
        let mut has_dot_or_exponent = first == '.' as CodePoint;
        let mut base: f64 = 0.0;
        let mut is_legacy_octal_literal = false;

        // Assume this is a number, but potentially change to a bigint later;
        self.token = T::TNumericLiteral;

        // Check for binary, octal, or hexadecimal literal;
        if first == '0' as CodePoint {
            match self.code_point {
                cp if cp == 'b' as CodePoint || cp == 'B' as CodePoint => base = 2.0,
                cp if cp == 'o' as CodePoint || cp == 'O' as CodePoint => base = 8.0,
                cp if cp == 'x' as CodePoint || cp == 'X' as CodePoint => base = 16.0,
                cp if (cp >= '0' as CodePoint && cp <= '7' as CodePoint)
                    || cp == '_' as CodePoint =>
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

            loop {
                match self.code_point {
                    cp if cp == '_' as CodePoint => {
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
                    cp if cp == '0' as CodePoint || cp == '1' as CodePoint => {
                        self.number = self.number * base + (cp - '0' as CodePoint) as f64;
                    }
                    cp if cp >= '2' as CodePoint && cp <= '7' as CodePoint => {
                        if base == 2.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base + (cp - '0' as CodePoint) as f64;
                    }
                    cp if cp == '8' as CodePoint || cp == '9' as CodePoint => {
                        if is_legacy_octal_literal {
                            is_invalid_legacy_octal_literal = true;
                        } else if base < 10.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base + (cp - '0' as CodePoint) as f64;
                    }
                    cp if cp >= 'A' as CodePoint && cp <= 'F' as CodePoint => {
                        if base != 16.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base + (cp + 10 - 'A' as CodePoint) as f64;
                    }
                    cp if cp >= 'a' as CodePoint && cp <= 'f' as CodePoint => {
                        if base != 16.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base + (cp + 10 - 'a' as CodePoint) as f64;
                    }
                    _ => {
                        // The first digit must exist;
                        if is_first {
                            self.syntax_error()?;
                        }
                        break;
                    }
                }
                self.step();
                is_first = false;
            }

            let is_bigint_literal = self.code_point == 'n' as CodePoint && !has_dot_or_exponent;

            // Slow path: do we need to re-scan the input as text?
            if is_bigint_literal || is_invalid_legacy_octal_literal {
                let text = self.raw();

                // Can't use a leading zero for bigint literals;
                if is_bigint_literal && is_legacy_octal_literal {
                    self.syntax_error()?;
                }

                // Filter out underscores;
                // (Zig allocates a filtered buffer here but discards it; mirror
                // the no-op semantics — `text` is reused below as-is.)

                // Store bigints as text to avoid precision loss;
                if is_bigint_literal {
                    self.identifier = text;
                } else if is_invalid_legacy_octal_literal {
                    // SAFETY: scanned bytes are ASCII digits/underscores.
                    let s = unsafe { core::str::from_utf8_unchecked(text) };
                    match s.parse::<f64>() {
                        Ok(n) => self.number = n,
                        Err(_) => {
                            return self.add_syntax_error(
                                self.start,
                                format_args!("Invalid number {}", bstr::BStr::new(text)),
                            );
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
            let text = self.raw();

            // Filter out underscores;
            let filtered: &[u8];
            let mut bytes: Vec<u8>;
            if underscore_count > 0 {
                bytes = Vec::with_capacity(text.len() - underscore_count);
                for &c in text {
                    if c != b'_' {
                        bytes.push(c);
                    }
                }
                filtered = &bytes;
            } else {
                filtered = text;
            }

            if self.code_point == 'n' as CodePoint && !has_dot_or_exponent {
                // The only bigint literal that can start with 0 is "0n"
                if filtered.len() > 1 && first == '0' as CodePoint {
                    self.syntax_error()?;
                }
                // Store bigints as text to avoid precision loss;
                self.identifier = self.raw();
            } else if !has_dot_or_exponent && self.end - self.start < 10 {
                // Parse a 32-bit integer (very fast path);
                let mut number: u32 = 0;
                for &c in filtered {
                    number = number * 10 + (c - b'0') as u32;
                }
                self.number = number as f64;
            } else {
                // Parse a double-precision floating-point number.
                // SAFETY: scanned bytes are ASCII (digits/./e/+/-).
                let s = unsafe { core::str::from_utf8_unchecked(filtered) };
                match s.parse::<f64>() {
                    Ok(n) => self.number = n,
                    Err(_) => {
                        return self.add_syntax_error(self.start, format_args!("Invalid number"));
                    }
                }
            }
        }

        // An underscore must not come last;
        if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
            self.end -= 1;
            self.syntax_error()?;
        }

        // Handle bigint literals after the underscore-at-end check above;
        // PORT NOTE: bigint `'n'` falls through to the identifier-start check
        // below (T::TBigIntegerLiteral is JS-only and not in this token enum).

        // An identifier can't immediately follow a number.
        if is_identifier_start(self.code_point) {
            return self.syntax_error();
        }

        Ok(())
    }

    // ── identifier with escapes ──────────────────────────────────────────

    /// Zig: `scanIdentifierWithEscapes(.normal)` (lexer.zig:875). Minimal port
    /// for the JSON keyword set: scans `\uXXXX` / `\u{…}` escapes interleaved
    /// with identifier-continue codepoints, decodes via
    /// `decode_escape_sequences`, and maps the result to
    /// `t_true`/`t_false`/`t_null`/`t_identifier`.
    fn scan_identifier_with_escapes(&mut self) -> LexResult {
        // First pass: scan over the identifier to see how long it is.
        loop {
            if self.code_point == '\\' as CodePoint {
                self.step();
                if self.code_point != 'u' as CodePoint {
                    self.syntax_error()?;
                }
                self.step();
                if self.code_point == '{' as CodePoint {
                    // Variable-length
                    self.step();
                    while self.code_point != '}' as CodePoint {
                        if strings::is_hex_code_point(self.code_point) {
                            self.step();
                        } else {
                            self.syntax_error()?;
                        }
                    }
                    self.step();
                } else {
                    // Fixed-length (4 hex digits)
                    for _ in 0..4 {
                        if strings::is_hex_code_point(self.code_point) {
                            self.step();
                        } else {
                            self.syntax_error()?;
                        }
                    }
                }
                continue;
            }
            if !is_identifier_continue(self.code_point) {
                break;
            }
            self.step();
        }

        // Second pass: re-use our existing escape sequence parser.
        let original_text = self.raw();
        let mut buf: Vec<u16> = Vec::with_capacity(original_text.len());
        self.decode_escape_sequences(self.start, original_text, &mut buf)?;
        let utf8 = strings::to_utf8_alloc(&buf);
        let contents: &'a [u8] = self.bump.alloc_slice_copy(&utf8);

        // PORT NOTE: full Unicode `isIdentifier` validation omitted — JSON only
        // recognises `true`/`false`/`null`; anything else is `t_identifier`
        // and the parser will reject it.
        self.identifier = contents;
        self.token = match contents {
            b"true" => T::TTrue,
            b"false" => T::TFalse,
            b"null" => T::TNull,
            _ => T::TIdentifier,
        };
        Ok(())
    }

    // ── next ─────────────────────────────────────────────────────────────

    /// Zig: `next()` with every `if (comptime is_json)` branch taken. Operators
    /// and JS-only punctuation hard-error; comments are gated on
    /// `opts.allow_comments`.
    pub fn next(&mut self) -> LexResult {
        self.has_newline_before = self.end == 0;

        loop {
            self.start = self.end;
            self.token = T::TEndOfFile;

            match self.code_point {
                -1 => {
                    self.token = T::TEndOfFile;
                }

                cp if cp == '\r' as CodePoint
                    || cp == '\n' as CodePoint
                    || cp == 0x2028
                    || cp == 0x2029 =>
                {
                    self.has_newline_before = true;

                    if self.opts.guess_indentation
                        && self.indent_info.first_newline
                        && self.code_point == '\n' as CodePoint
                    {
                        while self.code_point == '\n' as CodePoint
                            || self.code_point == '\r' as CodePoint
                        {
                            self.step();
                        }
                        if self.code_point != ' ' as CodePoint
                            && self.code_point != '\t' as CodePoint
                        {
                            // Try the next line — handles files starting with a newline.
                            continue;
                        }
                        self.indent_info.first_newline = false;
                        let indent_character = self.code_point;
                        let mut count: usize = 0;
                        while self.code_point == indent_character {
                            self.step();
                            count += 1;
                        }
                        self.indent_info.guess.character = if indent_character == ' ' as CodePoint {
                            bun_ast::IndentationCharacter::Space
                        } else {
                            bun_ast::IndentationCharacter::Tab
                        };
                        self.indent_info.guess.scalar = count;
                        continue;
                    }

                    self.step();
                    continue;
                }

                cp if cp == '\t' as CodePoint || cp == ' ' as CodePoint => {
                    self.step();
                    continue;
                }

                cp if cp == '[' as CodePoint => {
                    self.step();
                    self.token = T::TOpenBracket;
                }
                cp if cp == ']' as CodePoint => {
                    self.step();
                    self.token = T::TCloseBracket;
                }
                cp if cp == '{' as CodePoint => {
                    self.step();
                    self.token = T::TOpenBrace;
                }
                cp if cp == '}' as CodePoint => {
                    self.step();
                    self.token = T::TCloseBrace;
                }
                cp if cp == ',' as CodePoint => {
                    self.step();
                    self.token = T::TComma;
                }
                cp if cp == ':' as CodePoint => {
                    self.step();
                    self.token = T::TColon;
                }

                cp if cp == '-' as CodePoint => {
                    self.step();
                    if self.code_point == '=' as CodePoint || self.code_point == '-' as CodePoint {
                        return self
                            .add_unsupported_syntax_error("Operators are not allowed in JSON");
                    }
                    self.token = T::TMinus;
                }

                cp if cp == '/' as CodePoint => {
                    // '//' or '/* ... */' (gated on allow_comments); bare '/' or
                    // '/=' are JS-only.
                    self.step();
                    match self.code_point {
                        cp2 if cp2 == '/' as CodePoint => {
                            // Single-line comment.
                            loop {
                                self.step();
                                match self.code_point {
                                    c if c == '\r' as CodePoint
                                        || c == '\n' as CodePoint
                                        || c == 0x2028
                                        || c == 0x2029
                                        || c == -1 =>
                                    {
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                            if !self.opts.allow_comments {
                                let r = self.range();
                                self.add_range_error(
                                    r,
                                    format_args!("JSON does not support comments"),
                                )?;
                                return Ok(());
                            }
                            // scanCommentText is a no-op when is_json — pragmas
                            // and legal-annotation handling are JS-only.
                            continue;
                        }
                        cp2 if cp2 == '*' as CodePoint => {
                            self.step();
                            loop {
                                match self.code_point {
                                    c if c == '*' as CodePoint => {
                                        self.step();
                                        if self.code_point == '/' as CodePoint {
                                            self.step();
                                            break;
                                        }
                                    }
                                    c if c == '\r' as CodePoint
                                        || c == '\n' as CodePoint
                                        || c == 0x2028
                                        || c == 0x2029 =>
                                    {
                                        self.step();
                                        self.has_newline_before = true;
                                    }
                                    -1 => {
                                        self.start = self.end;
                                        return self.add_syntax_error(
                                            self.start,
                                            format_args!(
                                                "Expected \"*/\" to terminate multi-line comment"
                                            ),
                                        );
                                    }
                                    _ => self.step(),
                                }
                            }
                            if !self.opts.allow_comments {
                                let r = self.range();
                                self.add_range_error(
                                    r,
                                    format_args!("JSON does not support comments"),
                                )?;
                                return Ok(());
                            }
                            continue;
                        }
                        _ => {
                            return self
                                .add_unsupported_syntax_error("Operators are not allowed in JSON");
                        }
                    }
                }

                cp if cp == '\'' as CodePoint => {
                    self.parse_string_literal_inner::<b'\''>()?;
                }
                cp if cp == '"' as CodePoint => {
                    self.parse_string_literal_inner::<b'"'>()?;
                }

                cp if cp == '\\' as CodePoint => {
                    if self.opts.ignore_leading_escape_sequences
                        && (self.start == 0
                            || self.current == self.source.contents.len().saturating_sub(1))
                    {
                        self.step();
                        continue;
                    }
                    // Spec lexer.zig:1739-1750 — no is_json gate; scan an
                    // identifier-with-escapes (e.g. `true` → t_true).
                    self.scan_identifier_with_escapes()?;
                }

                cp if cp == '.' as CodePoint
                    || (cp >= '0' as CodePoint && cp <= '9' as CodePoint) =>
                {
                    self.parse_numeric_literal_or_dot()?;
                }

                cp if cp == '_' as CodePoint
                    || cp == '$' as CodePoint
                    || (cp >= 'a' as CodePoint && cp <= 'z' as CodePoint)
                    || (cp >= 'A' as CodePoint && cp <= 'Z' as CodePoint) =>
                {
                    self.step();
                    while is_identifier_continue(self.code_point) {
                        self.step();
                    }
                    self.identifier = self.raw();
                    self.token = match self.identifier {
                        b"true" => T::TTrue,
                        b"false" => T::TFalse,
                        b"null" => T::TNull,
                        _ => T::TIdentifier,
                    };
                }

                // JS-only single-char tokens / operators.
                cp if cp == '#' as CodePoint => {
                    return self.add_unsupported_syntax_error(
                        "Private identifiers are not allowed in JSON",
                    );
                }
                cp if cp == ';' as CodePoint => {
                    return self.add_unsupported_syntax_error("Semicolons are not allowed in JSON");
                }
                cp if cp == '@' as CodePoint => {
                    return self.add_unsupported_syntax_error("Decorators are not allowed in JSON");
                }
                cp if cp == '~' as CodePoint => {
                    return self.add_unsupported_syntax_error("~ is not allowed in JSON");
                }
                cp if cp == '?' as CodePoint
                    || cp == '%' as CodePoint
                    || cp == '&' as CodePoint
                    || cp == '|' as CodePoint
                    || cp == '^' as CodePoint
                    || cp == '+' as CodePoint
                    || cp == '*' as CodePoint
                    || cp == '=' as CodePoint
                    || cp == '<' as CodePoint
                    || cp == '>' as CodePoint
                    || cp == '!' as CodePoint
                    || cp == '(' as CodePoint
                    || cp == ')' as CodePoint
                    || cp == '`' as CodePoint =>
                {
                    return self.add_unsupported_syntax_error("Operators are not allowed in JSON");
                }

                cp => {
                    // Unusual whitespace.
                    if is_whitespace(cp) {
                        self.step();
                        continue;
                    }
                    if is_identifier_start(cp) {
                        self.step();
                        while is_identifier_continue(self.code_point) {
                            self.step();
                        }
                        self.token = T::TIdentifier;
                        self.identifier = self.raw();
                        return Ok(());
                    }
                    self.end = self.current;
                    self.token = T::TSyntaxError;
                }
            }

            return Ok(());
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

#[inline]
fn push_codepoint(buf: &mut Vec<u16>, cp: CodePoint) {
    if cp < 0 {
        return;
    }
    strings::push_codepoint_utf16(buf, cp as u32);
}

#[inline]
fn is_whitespace(cp: CodePoint) -> bool {
    // 0x09/0x0A/0x0D/0x20 handled by earlier match arms; VT/FF/LS/PS/BOM + Zs here.
    matches!(cp, 0x000B | 0x000C | 0x2028 | 0x2029 | 0xFEFF)
        || strings::is_unicode_space_separator(cp as u32)
}

#[inline]
fn is_identifier_start(cp: CodePoint) -> bool {
    matches!(cp, 0x24 /* $ */ | 0x5F /* _ */)
        || (cp >= 'a' as CodePoint && cp <= 'z' as CodePoint)
        || (cp >= 'A' as CodePoint && cp <= 'Z' as CodePoint)
    // PORT NOTE: full Unicode ID_Start table omitted — JSON only ever
    // recognises `true`/`false`/`null` here, all ASCII.
}

#[inline]
fn is_identifier_continue(cp: CodePoint) -> bool {
    is_identifier_start(cp) || (cp >= '0' as CodePoint && cp <= '9' as CodePoint)
}

// ported from: src/js_parser/lexer.zig
