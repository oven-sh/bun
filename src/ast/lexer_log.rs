//! Shared lexer→Log error-reporting cluster.
//!
//! js_parser, json, and toml lexers each carried a near-identical 50-line block
//! of `{syntax_error, add_error, add_range_error, add_default_error,
//! add_syntax_error}` that gate on `is_log_disabled`, dedup against
//! `prev_error_loc`, push into `Log`, then record the loc. This trait
//! collapses all three.
//!
//! It also hosts the shared string escape-sequence decoder
//! ([`decode_escape_sequences`] / [`EscapeLexer`]) that the js/json and toml
//! lexers previously each carried a ~330-line copy of.
//!
//! The trait carries a `'s` lifetime so `source()` can hand back the lexer's
//! stored `&'s Source` *without* borrowing `self` — that is what lets the
//! provided bodies call `self.log_mut()` afterwards without a split-borrow
//! conflict.

use core::fmt;

use crate::{AddErrorOptions, Loc, Log, Range, Source, usize2loc};

pub trait LexerLog<'s> {
    /// Per-lexer error variant returned from the `*_error` family
    /// (`Error::SyntaxError` for js/toml, `bun_core::err!("SyntaxError")` for
    /// the JSON-subset lexer).
    type Err;

    // ── required state accessors ────────────────────────────────────────
    fn log_mut(&mut self) -> &mut Log;
    /// NB: returns the lexer-stored `&'s Source`, *not* a `&self`-tied borrow.
    fn source(&self) -> &'s Source;
    fn prev_error_loc_mut(&mut self) -> &mut Loc;
    fn start(&self) -> usize;
    fn syntax_err() -> Self::Err;

    /// js/json gate every push on this; toml has no flag (default `false`).
    #[inline]
    fn is_log_disabled(&self) -> bool {
        false
    }
    /// toml threads `should_redact_logs` into every message; js/json don't.
    #[inline]
    fn should_redact(&self) -> bool {
        false
    }

    // ── provided cluster ────────────────────────────────────────────────

    #[cold]
    fn add_error(&mut self, loc: usize, args: fmt::Arguments<'_>) {
        if self.is_log_disabled() {
            return;
        }
        let l = usize2loc(loc);
        if l.eql(*self.prev_error_loc_mut()) {
            return;
        }
        let source = self.source();
        let redact = self.should_redact();
        self.log_mut().add_error_fmt_opts(
            args,
            AddErrorOptions {
                source: Some(source),
                loc: l,
                redact_sensitive_information: redact,
                ..Default::default()
            },
        );
        *self.prev_error_loc_mut() = l;
    }

    #[cold]
    fn add_range_error(&mut self, r: Range, args: fmt::Arguments<'_>) -> Result<(), Self::Err> {
        if self.is_log_disabled() {
            return Ok(());
        }
        if r.loc.eql(*self.prev_error_loc_mut()) {
            return Ok(());
        }
        let source = self.source();
        let redact = self.should_redact();
        self.log_mut().add_error_fmt_opts(
            args,
            AddErrorOptions {
                source: Some(source),
                loc: r.loc,
                len: r.len,
                redact_sensitive_information: redact,
                ..Default::default()
            },
        );
        *self.prev_error_loc_mut() = r.loc;
        Ok(())
    }

    #[cold]
    fn syntax_error(&mut self) -> Result<(), Self::Err> {
        // Only add this if there is not already an error — a more descriptive
        // one may already have been emitted.
        if !self.log_mut().has_errors() {
            self.add_error(self.start(), format_args!("Syntax Error"));
        }
        Err(Self::syntax_err())
    }

    #[cold]
    fn add_default_error(&mut self, msg: &[u8]) -> Result<(), Self::Err> {
        self.add_error(self.start(), format_args!("{}", bstr::BStr::new(msg)));
        Err(Self::syntax_err())
    }

    #[cold]
    fn add_syntax_error(&mut self, loc: usize, args: fmt::Arguments<'_>) -> Result<(), Self::Err> {
        self.add_error(loc, args);
        Err(Self::syntax_err())
    }
}

/// Surface [`decode_escape_sequences`] needs from a lexer. Monomorphizes per
/// lexer type, so codegen matches the previous per-lexer inline copies.
pub trait EscapeLexer<'s>: LexerLog<'s> {
    /// Decoded output sink: UTF-16 code units for the js lexer, WTF-8 bytes
    /// for the toml lexer.
    type Buf;

    /// JSON mode: reject legacy octal, `\u{...}`, line continuations, and any
    /// simple escape outside the JSON set.
    const IS_JSON: bool = false;

    /// toml only: keep error spans in their historical shape — the legacy
    /// octal `Range` start is text-relative (no `start +`) and the `\u{...}`
    /// span start also subtracts the width of `{`. The js lexer computes both
    /// absolutely (oven-sh/bun#31134).
    const LEGACY_ERROR_SPANS: bool = false;

    fn end_mut(&mut self) -> &mut usize;
    fn push_codepoint(buf: &mut Self::Buf, c: u32);
}

/// Decodes the backslash escape sequences of a string-literal body `text`
/// into `buf`. `start` is the absolute source offset of `text`'s first byte,
/// used to report error locations.
///
/// `ALLOW_LINE_CONTINUATIONS` permits `\<newline>` (always true for js;
/// toml multiline basic strings only). `REJECT_HEX_ESCAPE` errors on `\x`
/// (toml multiline basic strings only).
pub fn decode_escape_sequences<
    's,
    L: EscapeLexer<'s>,
    const ALLOW_LINE_CONTINUATIONS: bool,
    const REJECT_HEX_ESCAPE: bool,
>(
    lexer: &mut L,
    start: usize,
    text: &[u8],
    buf: &mut L::Buf,
) -> Result<(), L::Err> {
    use bun_core::fmt::hex_digit_value_u32;
    use bun_core::strings;
    use bun_core::strings::CodePoint;

    let iterator = strings::CodepointIterator::init(text);
    let mut iter = strings::Cursor::default();
    while iterator.next(&mut iter) {
        let width = iter.width;
        match iter.c {
            0x0D => {
                // From the specification:
                //
                // 11.8.6.1 Static Semantics: TV and TRV
                //
                // TV excludes the code units of LineContinuation while TRV includes
                // them. <CR><LF> and <CR> LineTerminatorSequences are normalized to
                // <LF> for both TV and TRV. An explicit EscapeSequence is needed to
                // include a <CR> or <CR><LF> sequence.

                // Convert '\r\n' into '\n'. After `next()` returns for `\r`,
                // `iter.i` is the start byte of the `\r` itself — the `\n` we're
                // looking for is at `iter.i + 1`.
                let next_i: usize = iter.i as usize + 1;
                iter.i += (next_i < text.len() && text[next_i] == b'\n') as u32;

                // Convert '\r' into '\n'
                L::push_codepoint(buf, u32::from(b'\n'));
                continue;
            }

            0x5C => {
                if !iterator.next(&mut iter) {
                    return Ok(());
                }

                let c2 = iter.c;
                let width2 = iter.width;
                match c2 {
                    // https://mathiasbynens.be/notes/javascript-escapes#single
                    0x62 => {
                        L::push_codepoint(buf, 0x08);
                        continue;
                    }
                    0x66 => {
                        L::push_codepoint(buf, 0x0C);
                        continue;
                    }
                    0x6E => {
                        L::push_codepoint(buf, 0x0A);
                        continue;
                    }
                    0x76 => {
                        // Vertical tab is invalid JSON
                        // We're going to allow it.
                        L::push_codepoint(buf, 0x0B);
                        continue;
                    }
                    0x74 => {
                        L::push_codepoint(buf, 0x09);
                        continue;
                    }
                    0x72 => {
                        L::push_codepoint(buf, 0x0D);
                        continue;
                    }

                    // legacy octal literals
                    0x30..=0x37 => {
                        let octal_start = (iter.i as usize + width2 as usize).saturating_sub(2);
                        if L::IS_JSON {
                            *lexer.end_mut() =
                                (start + iter.i as usize).saturating_sub(width2 as usize);
                            lexer.syntax_error()?;
                        }

                        // 1-3 digit octal
                        let mut is_bad = false;
                        let mut value: i64 = (c2 - 0x30) as i64;
                        let mut prev = iter;

                        if !iterator.next(&mut iter) {
                            if value == 0 {
                                L::push_codepoint(buf, 0);
                                return Ok(());
                            }
                            lexer.syntax_error()?;
                            return Ok(());
                        }

                        let c3: CodePoint = iter.c;

                        match c3 {
                            0x30..=0x37 => {
                                value = value * 8 + (c3 - 0x30) as i64;
                                prev = iter;
                                if !iterator.next(&mut iter) {
                                    return lexer.syntax_error();
                                }

                                let c4 = iter.c;
                                match c4 {
                                    0x30..=0x37 => {
                                        let temp = value * 8 + (c4 - 0x30) as i64;
                                        if temp < 256 {
                                            value = temp;
                                        } else {
                                            iter = prev;
                                        }
                                    }
                                    0x38 | 0x39 => {
                                        is_bad = true;
                                    }
                                    _ => {
                                        iter = prev;
                                    }
                                }
                            }
                            0x38 | 0x39 => {
                                is_bad = true;
                            }
                            _ => {
                                iter = prev;
                            }
                        }

                        iter.c = i32::try_from(value).expect("int cast");
                        if is_bad {
                            // `octal_start` is text-relative like `iter.i`; map back
                            // to an absolute source position the same way every
                            // sibling error path does (e.g. `start + hex_start` in
                            // the `\u{}` branch) — unless the lexer keeps its
                            // historical text-relative span.
                            let range_start = if L::LEGACY_ERROR_SPANS {
                                octal_start
                            } else {
                                start + octal_start
                            };
                            // `add_range_error` has no failing path; `?` keeps the
                            // signature free of a `Debug` bound on `L::Err`.
                            lexer.add_range_error(
                                Range {
                                    loc: Loc {
                                        start: i32::try_from(range_start).expect("int cast"),
                                    },
                                    len: i32::try_from(iter.i as usize - octal_start)
                                        .expect("int cast"),
                                },
                                format_args!("Invalid legacy octal literal"),
                            )?;
                        }
                    }
                    0x38 | 0x39 => {
                        iter.c = c2;
                    }
                    // 2-digit hexadecimal
                    0x78 => {
                        if REJECT_HEX_ESCAPE {
                            *lexer.end_mut() =
                                (start + iter.i as usize).saturating_sub(width2 as usize);
                            lexer.syntax_error()?;
                        }

                        let mut value: CodePoint = 0;
                        let mut c3: CodePoint;
                        let mut width3: u8;

                        if !iterator.next(&mut iter) {
                            return lexer.syntax_error();
                        }
                        c3 = iter.c;
                        width3 = iter.width;
                        match hex_digit_value_u32(c3 as u32) {
                            Some(d) => value = (value * 16) | d as CodePoint,
                            None => {
                                *lexer.end_mut() =
                                    (start + iter.i as usize).saturating_sub(width3 as usize);
                                return lexer.syntax_error();
                            }
                        }

                        if !iterator.next(&mut iter) {
                            return lexer.syntax_error();
                        }
                        c3 = iter.c;
                        width3 = iter.width;
                        match hex_digit_value_u32(c3 as u32) {
                            Some(d) => value = (value * 16) | d as CodePoint,
                            None => {
                                *lexer.end_mut() =
                                    (start + iter.i as usize).saturating_sub(width3 as usize);
                                return lexer.syntax_error();
                            }
                        }

                        iter.c = value;
                    }
                    0x75 => {
                        // We're going to make this an i64 so we don't risk integer overflows
                        // when people do weird things
                        let mut value: i64 = 0;

                        if !iterator.next(&mut iter) {
                            return lexer.syntax_error();
                        }
                        let mut c3 = iter.c;
                        let mut width3 = iter.width;

                        // variable-length
                        if c3 == 0x7B {
                            if L::IS_JSON {
                                *lexer.end_mut() =
                                    (start + iter.i as usize).saturating_sub(width2 as usize);
                                lexer.syntax_error()?;
                            }

                            // `iter.i` is the byte offset of `{` inside `text`;
                            // back up past `\` and `u` only. `width3` is the
                            // width of `{` itself, which `iter.i` already points
                            // at — subtracting it lands one character too early
                            // (kept for lexers with `LEGACY_ERROR_SPANS`).
                            let mut hex_start = (iter.i as usize)
                                .saturating_sub(width as usize)
                                .saturating_sub(width2 as usize);
                            if L::LEGACY_ERROR_SPANS {
                                hex_start = hex_start.saturating_sub(width3 as usize);
                            }
                            let mut is_first = true;
                            let mut is_out_of_range = false;
                            'variable_length: loop {
                                if !iterator.next(&mut iter) {
                                    break 'variable_length;
                                }
                                c3 = iter.c;

                                if c3 == 0x7D {
                                    if is_first {
                                        *lexer.end_mut() = (start + iter.i as usize)
                                            .saturating_sub(width3 as usize);
                                        return lexer.syntax_error();
                                    }
                                    break 'variable_length;
                                }
                                match hex_digit_value_u32(c3 as u32) {
                                    Some(d) => value = (value * 16) | d as i64,
                                    None => {
                                        *lexer.end_mut() = (start + iter.i as usize)
                                            .saturating_sub(width3 as usize);
                                        return lexer.syntax_error();
                                    }
                                }

                                // '\U0010FFFF
                                // copied from golang utf8.MaxRune
                                if value > 1_114_111 {
                                    is_out_of_range = true;
                                }
                                is_first = false;
                            }

                            if is_out_of_range {
                                lexer.add_range_error(
                                    Range {
                                        loc: Loc {
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

                            // fixed-length
                        } else {
                            // Fixed-length
                            let mut j: usize = 0;
                            while j < 4 {
                                match hex_digit_value_u32(c3 as u32) {
                                    Some(d) => value = (value * 16) | d as i64,
                                    None => {
                                        *lexer.end_mut() = (start + iter.i as usize)
                                            .saturating_sub(width3 as usize);
                                        return lexer.syntax_error();
                                    }
                                }

                                if j < 3 {
                                    if !iterator.next(&mut iter) {
                                        return lexer.syntax_error();
                                    }
                                    c3 = iter.c;
                                    width3 = iter.width;
                                }
                                j += 1;
                            }
                            let _ = width3;
                        }

                        iter.c = value as CodePoint; // @truncate
                    }
                    0x0D => {
                        if L::IS_JSON {
                            *lexer.end_mut() =
                                (start + iter.i as usize).saturating_sub(width2 as usize);
                            lexer.syntax_error()?;
                        } else if !ALLOW_LINE_CONTINUATIONS {
                            *lexer.end_mut() =
                                (start + iter.i as usize).saturating_sub(width2 as usize);
                            lexer.add_default_error(b"Unexpected end of line")?;
                        }

                        // Make sure Windows CRLF counts as a single newline.
                        // Guard on the index we actually read (`iter.i + 1`), not
                        // `iter.i` — a string ending in `\<CR>` would otherwise
                        // read `text[len]`.
                        let next_i: usize = iter.i as usize + 1;
                        iter.i += (next_i < text.len() && text[next_i] == b'\n') as u32;

                        // Ignore line continuations. A line continuation is not an escaped newline.
                        continue;
                    }
                    0x0A | 0x2028 | 0x2029 => {
                        if L::IS_JSON {
                            *lexer.end_mut() =
                                (start + iter.i as usize).saturating_sub(width2 as usize);
                            lexer.syntax_error()?;
                        } else if !ALLOW_LINE_CONTINUATIONS {
                            *lexer.end_mut() =
                                (start + iter.i as usize).saturating_sub(width2 as usize);
                            lexer.add_default_error(b"Unexpected end of line")?;
                        }

                        // Ignore line continuations. A line continuation is not an escaped newline.
                        continue;
                    }
                    _ => {
                        if L::IS_JSON {
                            match c2 {
                                0x22 | 0x5C | 0x2F => {}
                                _ => {
                                    *lexer.end_mut() =
                                        (start + iter.i as usize).saturating_sub(width2 as usize);
                                    lexer.syntax_error()?;
                                }
                            }
                        }
                        iter.c = c2;
                    }
                }
            }
            _ => {}
        }

        match iter.c {
            -1 => return lexer.add_default_error(b"Unexpected end of file"),
            c => L::push_codepoint(buf, c as u32),
        }
    }
    Ok(())
}
