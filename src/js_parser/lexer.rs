//! JavaScript/JSON lexer.
//!
//! Port of `src/js_parser/lexer.zig`.

use core::fmt;

use bun_core::{Environment, FeatureFlags, Output};
use bun_logger as logger;
use bun_logger::{Loc, Log, Range, Source};
use bun_str::strings;
use bun_str::strings::CodepointIterator;
use bun_js_parser::ast as js_ast;
use bun_js_parser::lexer::identifier as js_identifier;
use bun_js_parser::lexer_tables as tables;
// TODO(b0): Indentation arrives from move-in (was bun_js_printer::Options::Indentation → js_parser)
use crate::Indentation;
// TODO(port): arena threading — js_parser is an AST crate; many `allocator.*` calls below
// should use `&'bump bumpalo::Bump`. For Phase A we keep a `&dyn Allocator`-ish slot and
// route owned buffers through `Vec`/`Box`.
use bun_alloc::Arena;

pub type CodePoint = i32;
type JavascriptString<'s> = &'s [u16];

pub use tables::{
    Keywords, PropertyModifierKeyword, StrictModeReservedWords, T,
    TypeScriptAccessibilityModifier, TypescriptStmtKeyword, tokenToString,
};

#[cold]
fn notimpl() -> ! {
    Output::panic("not implemented yet!", format_args!(""));
}

pub static EMPTY_JAVASCRIPT_STRING: [u16; 1] = [0];

#[derive(Default, Clone, Copy)]
pub struct JSXPragma {
    pub _jsx: js_ast::Span,
    pub _jsx_frag: js_ast::Span,
    pub _jsx_runtime: js_ast::Span,
    pub _jsx_import_source: js_ast::Span,
}

impl JSXPragma {
    pub fn jsx(&self) -> Option<js_ast::Span> {
        if self._jsx.text.len() > 0 { Some(self._jsx) } else { None }
    }
    pub fn jsx_frag(&self) -> Option<js_ast::Span> {
        if self._jsx_frag.text.len() > 0 { Some(self._jsx_frag) } else { None }
    }
    pub fn jsx_runtime(&self) -> Option<js_ast::Span> {
        if self._jsx_runtime.text.len() > 0 { Some(self._jsx_runtime) } else { None }
    }
    pub fn jsx_import_source(&self) -> Option<js_ast::Span> {
        if self._jsx_import_source.text.len() > 0 { Some(self._jsx_import_source) } else { None }
    }
}

#[derive(Clone, Copy, core::marker::ConstParamTy, PartialEq, Eq)]
pub struct JSONOptions {
    /// Enable JSON-specific warnings/errors
    pub is_json: bool,

    /// tsconfig.json supports comments & trailing commas
    pub allow_comments: bool,
    pub allow_trailing_commas: bool,

    /// Loading JSON-in-JSON may start like \\""\\"
    /// This is technically invalid, since we parse from the first value of the string
    pub ignore_leading_escape_sequences: bool,
    pub ignore_trailing_escape_sequences: bool,

    pub json_warn_duplicate_keys: bool,

    /// mark as originally for a macro to enable inlining
    pub was_originally_macro: bool,

    pub guess_indentation: bool,
}

impl JSONOptions {
    pub const DEFAULT: Self = Self {
        is_json: false,
        allow_comments: false,
        allow_trailing_commas: false,
        ignore_leading_escape_sequences: false,
        ignore_trailing_escape_sequences: false,
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

/// Zig's `NewLexer(comptime json_options)` and `NewLexer_(comptime ...bools)` return a struct
/// type. In Rust we model this as a generic over the eight comptime bools.
///
/// `Lexer` (below) is the default instantiation (`NewLexer(.{})`).
pub type NewLexer<'a, const J: JSONOptions> = LexerType<
    'a,
    { J.is_json },
    { J.allow_comments },
    { J.allow_trailing_commas },
    { J.ignore_leading_escape_sequences },
    { J.ignore_trailing_escape_sequences },
    { J.json_warn_duplicate_keys },
    { J.was_originally_macro },
    { J.guess_indentation },
>;
// TODO(port): `NewLexer` above uses struct-const-generic field projection in const generics,
// which is unstable (`adt_const_params` + `generic_const_exprs`). Phase B may need to inline
// the eight bools at each instantiation site instead.

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
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
    // TODO(port): Zig `error.Backtrack` is returned from `expected()` but not declared in
    // the local error set; modeled here as an extra variant.
    #[error("Backtrack")]
    Backtrack,
}
impl From<Error> for bun_core::Error {
    fn from(e: Error) -> Self {
        bun_core::Error::from_static_str(<&'static str>::from(e))
        // TODO(port): exact interning API
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum StringLiteralRawFormat {
    #[default]
    Ascii,
    Utf16,
    NeedsDecode,
}

#[derive(Clone, Copy, Default)]
pub struct IndentInfo {
    pub guess: Indentation,
    pub first_newline: bool,
}

/// `packed struct(u8) { suffix_len: u2, needs_decode: bool, _padding: u5 = 0 }`
#[repr(transparent)]
#[derive(Clone, Copy, Default)]
pub struct InnerStringLiteral(pub u8);
impl InnerStringLiteral {
    #[inline]
    pub fn new(suffix_len: u8, needs_decode: bool) -> Self {
        Self((suffix_len & 0b11) | ((needs_decode as u8) << 2))
    }
    #[inline]
    pub fn suffix_len(self) -> u8 {
        self.0 & 0b11
    }
    #[inline]
    pub fn needs_decode(self) -> bool {
        (self.0 >> 2) & 1 != 0
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum IdentifierKind {
    Normal,
    Private,
}

#[derive(Clone, Copy)]
pub struct ScanResult<'a> {
    pub token: T,
    pub contents: &'a [u8],
}

// PORT NOTE: Zig's `FakeArrayList16` (fixed-slice writer with the `append` surface of an
// ArrayList) is dead — every `decodeEscapeSequences` callsite in lexer.zig passes
// `std.array_list.Managed(u16)`. Dropped instead of porting; `decode_escape_sequences` is
// monomorphized to `Vec<u16>`.

/// The lexer struct produced by `NewLexer_`.
///
/// `'a` is the lifetime of the borrowed `Log` and the source contents (arena/source-owned
/// slices like `identifier` and `string_literal_raw_content` borrow from the source or from
/// the parser arena).
pub struct LexerType<
    'a,
    const IS_JSON: bool,
    const ALLOW_COMMENTS: bool,
    const ALLOW_TRAILING_COMMAS: bool,
    const IGNORE_LEADING_ESCAPE_SEQUENCES: bool,
    const IGNORE_TRAILING_ESCAPE_SEQUENCES: bool,
    const JSON_WARN_DUPLICATE_KEYS: bool,
    const WAS_ORIGINALLY_MACRO: bool,
    const GUESS_INDENTATION: bool,
> {
    // err: ?LexerType.Error,
    pub log: &'a mut Log,
    pub source: Source,
    pub current: usize,
    pub start: usize,
    pub end: usize,
    pub did_panic: bool,
    pub approximate_newline_count: usize,
    pub previous_backslash_quote_in_jsx: Range,
    pub token: T,
    pub has_newline_before: bool,
    pub has_pure_comment_before: bool,
    pub has_no_side_effect_comment_before: bool,
    pub preserve_all_comments_before: bool,
    pub is_legacy_octal_literal: bool,
    pub is_log_disabled: bool,
    pub comments_to_preserve_before: Vec<js_ast::G::Comment>,
    pub code_point: CodePoint,
    pub identifier: &'a [u8],
    pub jsx_pragma: JSXPragma,
    pub source_mapping_url: Option<js_ast::Span>,
    pub number: f64,
    pub rescan_close_brace_as_template_token: bool,
    pub prev_error_loc: Loc,
    pub prev_token_was_await_keyword: bool,
    pub await_keyword_loc: Loc,
    pub fn_or_arrow_start_loc: Loc,
    pub regex_flags_start: Option<u16>,
    pub allocator: &'a Arena,
    pub string_literal_raw_content: &'a [u8],
    pub string_literal_start: usize,
    pub string_literal_raw_format: StringLiteralRawFormat,
    pub temp_buffer_u16: Vec<u16>,

    /// Only used for JSON stringification when bundling
    /// This is a zero-bit type unless we're parsing JSON.
    // TODO(port): Zig uses `if (is_json) bool else void` for zero-cost when !is_json.
    // PERF(port): always-bool here wastes 1 byte in non-JSON instantiations — profile in Phase B.
    pub is_ascii_only: bool,
    pub track_comments: bool,
    pub all_comments: Vec<Range>,

    // TODO(port): Zig field type is `if (guess_indentation) struct{..} else void`.
    // PERF(port): always-present here — profile in Phase B.
    pub indent_info: IndentInfo,
}

// Convenience: associated constants mirroring Zig's `const json = json_options;` etc.
macro_rules! lexer_impl_header {
    () => {
        impl<
            'a,
            const IS_JSON: bool,
            const ALLOW_COMMENTS: bool,
            const ALLOW_TRAILING_COMMAS: bool,
            const IGNORE_LEADING_ESCAPE_SEQUENCES: bool,
            const IGNORE_TRAILING_ESCAPE_SEQUENCES: bool,
            const JSON_WARN_DUPLICATE_KEYS: bool,
            const WAS_ORIGINALLY_MACRO: bool,
            const GUESS_INDENTATION: bool,
        >
            LexerType<
                'a,
                IS_JSON,
                ALLOW_COMMENTS,
                ALLOW_TRAILING_COMMAS,
                IGNORE_LEADING_ESCAPE_SEQUENCES,
                IGNORE_TRAILING_ESCAPE_SEQUENCES,
                JSON_WARN_DUPLICATE_KEYS,
                WAS_ORIGINALLY_MACRO,
                GUESS_INDENTATION,
            >
    };
}

lexer_impl_header!() {
    const JSON: JSONOptions = JSONOptions {
        is_json: IS_JSON,
        allow_comments: ALLOW_COMMENTS,
        allow_trailing_commas: ALLOW_TRAILING_COMMAS,
        ignore_leading_escape_sequences: IGNORE_LEADING_ESCAPE_SEQUENCES,
        ignore_trailing_escape_sequences: IGNORE_TRAILING_ESCAPE_SEQUENCES,
        json_warn_duplicate_keys: JSON_WARN_DUPLICATE_KEYS,
        was_originally_macro: WAS_ORIGINALLY_MACRO,
        guess_indentation: GUESS_INDENTATION,
    };

    #[inline]
    pub fn loc(&self) -> Loc {
        logger::usize2_loc(self.start)
    }

    #[cold]
    pub fn syntax_error(&mut self) -> Result<(), Error> {
        // Only add this if there is not already an error.
        // It is possible that there is a more descriptive error already emitted.
        if !self.log.has_errors() {
            self.add_error(self.start, format_args!("Syntax Error"), true);
        }
        Err(Error::SyntaxError)
    }

    #[cold]
    pub fn add_default_error(&mut self, msg: &[u8]) -> Result<(), Error> {
        self.add_error(self.start, format_args!("{}", bstr::BStr::new(msg)), true);
        Err(Error::SyntaxError)
    }

    #[cold]
    pub fn add_syntax_error(&mut self, loc: usize, args: fmt::Arguments<'_>) -> Result<(), Error> {
        self.add_error(loc, args, false);
        Err(Error::SyntaxError)
    }

    #[cold]
    pub fn add_error(&mut self, loc: usize, args: fmt::Arguments<'_>, _panic: bool) {
        if self.is_log_disabled {
            return;
        }
        let __loc = logger::usize2_loc(loc);
        if __loc.eql(self.prev_error_loc) {
            return;
        }

        self.log
            .add_error_fmt(&self.source, __loc, args)
            .expect("unreachable");
        self.prev_error_loc = __loc;
    }

    #[cold]
    pub fn add_range_error(
        &mut self,
        r: Range,
        args: fmt::Arguments<'_>,
        _panic: bool,
    ) -> Result<(), Error> {
        if self.is_log_disabled {
            return Ok(());
        }
        if self.prev_error_loc.eql(r.loc) {
            return Ok(());
        }

        // TODO(port): allocator routing — Zig uses `std.fmt.allocPrint(self.allocator, ..)`.
        let mut error_message = Vec::<u8>::new();
        use std::io::Write as _;
        write!(&mut error_message, "{}", args).expect("unreachable");
        self.log.add_range_error(&self.source, r, error_message)?;
        self.prev_error_loc = r.loc;

        // if (panic) {
        //     return Error.ParserError;
        // }
        Ok(())
    }

    #[cold]
    pub fn add_range_error_with_notes(
        &mut self,
        r: Range,
        args: fmt::Arguments<'_>,
        notes: &[logger::Data],
    ) -> Result<(), Error> {
        if self.is_log_disabled {
            return Ok(());
        }
        if self.prev_error_loc.eql(r.loc) {
            return Ok(());
        }

        let mut error_message = Vec::<u8>::new();
        use std::io::Write as _;
        write!(&mut error_message, "{}", args).expect("unreachable");
        // TODO(port): Zig dupes `notes` with `self.log.msgs.allocator`.
        let notes_owned: Vec<logger::Data> = notes.to_vec();
        self.log
            .add_range_error_with_notes(&self.source, r, error_message, notes_owned)?;
        self.prev_error_loc = r.loc;

        // if (panic) {
        //     return Error.ParserError;
        // }
        Ok(())
    }

    pub fn restore(&mut self, original: &Self) {
        // PORT NOTE: reshaped for borrowck — Zig does `this.* = original.*` then patches
        // back the three growable buffers. In Rust we copy each scalar field individually
        // and truncate the buffers, since `Self` is not `Copy` and `log: &mut Log` cannot
        // be aliased.
        // TODO(port): keep this list in sync with the struct fields.
        self.current = original.current;
        self.start = original.start;
        self.end = original.end;
        self.did_panic = original.did_panic;
        self.approximate_newline_count = original.approximate_newline_count;
        self.previous_backslash_quote_in_jsx = original.previous_backslash_quote_in_jsx;
        self.token = original.token;
        self.has_newline_before = original.has_newline_before;
        self.has_pure_comment_before = original.has_pure_comment_before;
        self.has_no_side_effect_comment_before = original.has_no_side_effect_comment_before;
        self.preserve_all_comments_before = original.preserve_all_comments_before;
        self.is_legacy_octal_literal = original.is_legacy_octal_literal;
        self.is_log_disabled = original.is_log_disabled;
        self.code_point = original.code_point;
        self.identifier = original.identifier;
        self.jsx_pragma = original.jsx_pragma;
        self.source_mapping_url = original.source_mapping_url;
        self.number = original.number;
        self.rescan_close_brace_as_template_token =
            original.rescan_close_brace_as_template_token;
        self.prev_error_loc = original.prev_error_loc;
        self.prev_token_was_await_keyword = original.prev_token_was_await_keyword;
        self.await_keyword_loc = original.await_keyword_loc;
        self.fn_or_arrow_start_loc = original.fn_or_arrow_start_loc;
        self.regex_flags_start = original.regex_flags_start;
        self.string_literal_raw_content = original.string_literal_raw_content;
        self.string_literal_start = original.string_literal_start;
        self.string_literal_raw_format = original.string_literal_raw_format;
        self.is_ascii_only = original.is_ascii_only;
        self.track_comments = original.track_comments;
        self.indent_info = original.indent_info;

        debug_assert!(self.all_comments.len() >= original.all_comments.len());
        debug_assert!(
            self.comments_to_preserve_before.len()
                >= original.comments_to_preserve_before.len()
        );
        debug_assert!(self.temp_buffer_u16.is_empty() && original.temp_buffer_u16.is_empty());

        self.all_comments.truncate(original.all_comments.len());
        self.comments_to_preserve_before
            .truncate(original.comments_to_preserve_before.len());
    }

    /// Look ahead at the next n codepoints without advancing the iterator.
    /// If fewer than n codepoints are available, then return the remainder of the string.
    fn peek(&mut self, n: usize) -> &'a [u8] {
        let original_i = self.current;

        let mut end_ix = original_i;
        for _ in 0..n {
            let next_codepoint = self.next_codepoint_slice();
            if next_codepoint.is_empty() {
                break;
            }
            end_ix += next_codepoint.len();
            // Advance current to mimic the Zig loop (defer restores below).
            self.current = end_ix;
        }

        self.current = original_i;
        // SAFETY: indices come from source.contents bounds.
        &self.source.contents[original_i..end_ix]
        // TODO(port): lifetime — borrows source.contents stored by value in self; Phase B may
        // need to return a borrow tied to `&self` instead of `'a`.
    }

    #[inline]
    pub fn is_identifier_or_keyword(&self) -> bool {
        (self.token as u32) >= (T::t_identifier as u32)
    }

    // deinit → Drop (see impl Drop below)

    fn decode_escape_sequences(
        &mut self,
        start: usize,
        text: &[u8],
        buf: &mut Vec<u16>,
    ) -> Result<(), Error> {
        // PORT NOTE: monomorphized — Zig is generic over `comptime BufType: type` but every
        // caller passes `std.array_list.Managed(u16)`; `FakeArrayList16` was dead in the source.
        if IS_JSON {
            self.is_ascii_only = false;
        }

        let iterator = CodepointIterator { bytes: text, i: 0 };
        let mut iter = strings::CodepointIterator::Cursor::default();
        while iterator.next(&mut iter) {
            let width = iter.width;
            match iter.c {
                ('\r' as i32) => {
                    // From the specification:
                    //
                    // 11.8.6.1 Static Semantics: TV and TRV
                    //
                    // TV excludes the code units of LineContinuation while TRV includes
                    // them. <CR><LF> and <CR> LineTerminatorSequences are normalized to
                    // <LF> for both TV and TRV. An explicit EscapeSequence is needed to
                    // include a <CR> or <CR><LF> sequence.

                    // Convert '\r\n' into '\n'
                    let next_i: usize = iter.i as usize + 1;
                    iter.i += (next_i < text.len() && text[next_i] == b'\n') as u32;

                    // Convert '\r' into '\n'
                    buf.push(u16::from(b'\n'));
                    continue;
                }

                ('\\' as i32) => {
                    if !iterator.next(&mut iter) {
                        return Ok(());
                    }

                    let c2 = iter.c;
                    let width2 = iter.width;
                    match c2 {
                        // https://mathiasbynens.be/notes/javascript-escapes#single
                        ('b' as i32) => {
                            buf.push(0x08);
                            continue;
                        }
                        ('f' as i32) => {
                            buf.push(0x0C);
                            continue;
                        }
                        ('n' as i32) => {
                            buf.push(0x0A);
                            continue;
                        }
                        ('v' as i32) => {
                            // Vertical tab is invalid JSON
                            // We're going to allow it.
                            // if (comptime is_json) {
                            //     lexer.end = start + iter.i - width2;
                            //     try lexer.syntaxError();
                            // }
                            buf.push(0x0B);
                            continue;
                        }
                        ('t' as i32) => {
                            buf.push(0x09);
                            continue;
                        }
                        ('r' as i32) => {
                            buf.push(0x0D);
                            continue;
                        }

                        // legacy octal literals
                        c if (b'0' as i32..=b'7' as i32).contains(&c) => {
                            let octal_start =
                                (iter.i as usize + width2 as usize) - 2;
                            if IS_JSON {
                                self.end = start + iter.i as usize - width2 as usize;
                                self.syntax_error()?;
                            }

                            // 1-3 digit octal
                            let mut is_bad = false;
                            let mut value: i64 = (c2 - b'0' as i32) as i64;
                            let mut prev = iter;

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
                                c if (b'0' as i32..=b'7' as i32).contains(&c) => {
                                    value = value * 8 + (c3 - b'0' as i32) as i64;
                                    prev = iter;
                                    if !iterator.next(&mut iter) {
                                        return self.syntax_error();
                                    }

                                    let c4 = iter.c;
                                    match c4 {
                                        c if (b'0' as i32..=b'7' as i32).contains(&c) => {
                                            let temp =
                                                value * 8 + (c4 - b'0' as i32) as i64;
                                            if temp < 256 {
                                                value = temp;
                                            } else {
                                                iter = prev;
                                            }
                                        }
                                        c if c == b'8' as i32 || c == b'9' as i32 => {
                                            is_bad = true;
                                        }
                                        _ => {
                                            iter = prev;
                                        }
                                    }
                                }
                                c if c == b'8' as i32 || c == b'9' as i32 => {
                                    is_bad = true;
                                }
                                _ => {
                                    iter = prev;
                                }
                            }

                            iter.c = i32::try_from(value).unwrap();
                            if is_bad {
                                self.add_range_error(
                                    Range {
                                        loc: Loc {
                                            start: i32::try_from(octal_start).unwrap(),
                                        },
                                        len: i32::try_from(
                                            iter.i as usize - octal_start,
                                        )
                                        .unwrap(),
                                    },
                                    format_args!("Invalid legacy octal literal"),
                                    false,
                                )
                                .expect("unreachable");
                            }
                        }
                        c if c == b'8' as i32 || c == b'9' as i32 => {
                            iter.c = c2;
                        }
                        // 2-digit hexadecimal
                        ('x' as i32) => {
                            let mut value: CodePoint = 0;
                            let mut c3: CodePoint;
                            let mut width3: u8;

                            if !iterator.next(&mut iter) {
                                return self.syntax_error();
                            }
                            c3 = iter.c;
                            width3 = iter.width;
                            match c3 {
                                c if (b'0' as i32..=b'9' as i32).contains(&c) => {
                                    value = value * 16 | (c3 - b'0' as i32);
                                }
                                c if (b'a' as i32..=b'f' as i32).contains(&c) => {
                                    value = value * 16 | (c3 + 10 - b'a' as i32);
                                }
                                c if (b'A' as i32..=b'F' as i32).contains(&c) => {
                                    value = value * 16 | (c3 + 10 - b'A' as i32);
                                }
                                _ => {
                                    self.end =
                                        start + iter.i as usize - width3 as usize;
                                    return self.syntax_error();
                                }
                            }

                            if !iterator.next(&mut iter) {
                                return self.syntax_error();
                            }
                            c3 = iter.c;
                            width3 = iter.width;
                            match c3 {
                                c if (b'0' as i32..=b'9' as i32).contains(&c) => {
                                    value = value * 16 | (c3 - b'0' as i32);
                                }
                                c if (b'a' as i32..=b'f' as i32).contains(&c) => {
                                    value = value * 16 | (c3 + 10 - b'a' as i32);
                                }
                                c if (b'A' as i32..=b'F' as i32).contains(&c) => {
                                    value = value * 16 | (c3 + 10 - b'A' as i32);
                                }
                                _ => {
                                    self.end =
                                        start + iter.i as usize - width3 as usize;
                                    return self.syntax_error();
                                }
                            }

                            iter.c = value;
                        }
                        ('u' as i32) => {
                            // We're going to make this an i64 so we don't risk integer overflows
                            // when people do weird things
                            let mut value: i64 = 0;

                            if !iterator.next(&mut iter) {
                                return self.syntax_error();
                            }
                            let mut c3 = iter.c;
                            let mut width3 = iter.width;

                            // variable-length
                            if c3 == b'{' as i32 {
                                if IS_JSON {
                                    self.end =
                                        start + iter.i as usize - width2 as usize;
                                    self.syntax_error()?;
                                }

                                let hex_start = (iter.i as usize + start)
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

                                    match c3 {
                                        c if (b'0' as i32..=b'9' as i32).contains(&c) => {
                                            value =
                                                value * 16 | (c3 - b'0' as i32) as i64;
                                        }
                                        c if (b'a' as i32..=b'f' as i32).contains(&c) => {
                                            value = value * 16
                                                | (c3 + 10 - b'a' as i32) as i64;
                                        }
                                        c if (b'A' as i32..=b'F' as i32).contains(&c) => {
                                            value = value * 16
                                                | (c3 + 10 - b'A' as i32) as i64;
                                        }
                                        c if c == b'}' as i32 => {
                                            if is_first {
                                                self.end = (start + iter.i as usize)
                                                    .saturating_sub(width3 as usize);
                                                return self.syntax_error();
                                            }
                                            break 'variable_length;
                                        }
                                        _ => {
                                            self.end = (start + iter.i as usize)
                                                .saturating_sub(width3 as usize);
                                            return self.syntax_error();
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
                                    self.add_range_error(
                                        Range {
                                            loc: Loc {
                                                start: i32::try_from(start + hex_start)
                                                    .unwrap(),
                                            },
                                            len: i32::try_from(
                                                (iter.i as usize + start) - hex_start,
                                            )
                                            .unwrap(),
                                        },
                                        format_args!(
                                            "Unicode escape sequence is out of range"
                                        ),
                                        true,
                                    )?;

                                    return Ok(());
                                }

                                // fixed-length
                            } else {
                                // Fixed-length
                                // comptime var j: usize = 0;
                                let mut j: usize = 0;
                                while j < 4 {
                                    match c3 {
                                        c if (b'0' as i32..=b'9' as i32).contains(&c) => {
                                            value =
                                                value * 16 | (c3 - b'0' as i32) as i64;
                                        }
                                        c if (b'a' as i32..=b'f' as i32).contains(&c) => {
                                            value = value * 16
                                                | (c3 + 10 - b'a' as i32) as i64;
                                        }
                                        c if (b'A' as i32..=b'F' as i32).contains(&c) => {
                                            value = value * 16
                                                | (c3 + 10 - b'A' as i32) as i64;
                                        }
                                        _ => {
                                            self.end = start + iter.i as usize
                                                - width3 as usize;
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
                                let _ = width3;
                            }

                            iter.c = value as CodePoint; // @truncate
                        }
                        ('\r' as i32) => {
                            if IS_JSON {
                                self.end =
                                    start + iter.i as usize - width2 as usize;
                                self.syntax_error()?;
                            }

                            // Make sure Windows CRLF counts as a single newline
                            let next_i: usize = iter.i as usize + 1;
                            iter.i +=
                                (next_i < text.len() && text[next_i] == b'\n') as u32;

                            // Ignore line continuations. A line continuation is not an escaped newline.
                            continue;
                        }
                        c if c == b'\n' as i32 || c == 0x2028 || c == 0x2029 => {
                            if IS_JSON {
                                self.end =
                                    start + iter.i as usize - width2 as usize;
                                self.syntax_error()?;
                            }

                            // Ignore line continuations. A line continuation is not an escaped newline.
                            continue;
                        }
                        _ => {
                            if IS_JSON {
                                match c2 {
                                    c if c == b'"' as i32
                                        || c == b'\\' as i32
                                        || c == b'/' as i32 => {}
                                    _ => {
                                        self.end = start + iter.i as usize
                                            - width2 as usize;
                                        self.syntax_error()?;
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
                -1 => return self.add_default_error(b"Unexpected end of file"),
                0..=0xFFFF => {
                    buf.push(u16::try_from(iter.c).unwrap());
                }
                _ => {
                    iter.c -= 0x10000;
                    buf.reserve(2);
                    // PERF(port): was assume_capacity
                    buf.push(
                        u16::try_from(0xD800 + ((iter.c >> 10) & 0x3FF)).unwrap(),
                    );
                    buf.push(u16::try_from(0xDC00 + (iter.c & 0x3FF)).unwrap());
                }
            }
        }
        Ok(())
    }

    fn parse_string_literal_inner<const QUOTE: i32>(
        &mut self,
    ) -> Result<InnerStringLiteral, Error> {
        let mut suffix_len: u8 = if QUOTE == 0 { 0 } else { 1 };
        let mut needs_decode = false;
        'string_literal: loop {
            match self.code_point {
                ('\\' as i32) => {
                    needs_decode = true;
                    self.step();

                    // Handle Windows CRLF
                    if self.code_point == b'\r' as i32 && !IS_JSON {
                        self.step();
                        if self.code_point == b'\n' as i32 {
                            self.step();
                        }
                        continue 'string_literal;
                    }

                    if IS_JSON && IGNORE_TRAILING_ESCAPE_SEQUENCES {
                        if self.code_point == QUOTE
                            && self.current >= self.source.contents.len()
                        {
                            self.step();
                            break;
                        }
                    }

                    match self.code_point {
                        // 0 cannot be in this list because it may be a legacy octal literal
                        c if c == b'`' as i32
                            || c == b'\'' as i32
                            || c == b'"' as i32
                            || c == b'\\' as i32 =>
                        {
                            self.step();
                            continue 'string_literal;
                        }
                        _ => {}
                    }
                }
                // This indicates the end of the file
                -1 => {
                    if QUOTE != 0 {
                        self.add_default_error(b"Unterminated string literal")?;
                    }
                    break 'string_literal;
                }

                ('\r' as i32) => {
                    if QUOTE != b'`' as i32 {
                        self.add_default_error(b"Unterminated string literal")?;
                    }

                    // Template literals require newline normalization
                    needs_decode = true;
                }

                ('\n' as i32) => {
                    // Implicitly-quoted strings end when they reach a newline OR end of file
                    // This only applies to .env
                    match QUOTE {
                        0 => {
                            break 'string_literal;
                        }
                        c if c == b'`' as i32 => {}
                        _ => {
                            self.add_default_error(b"Unterminated string literal")?;
                        }
                    }
                }

                ('$' as i32) => {
                    if QUOTE == b'`' as i32 {
                        self.step();
                        if self.code_point == b'{' as i32 {
                            suffix_len = 2;
                            self.step();
                            self.token = if self.rescan_close_brace_as_template_token {
                                T::t_template_middle
                            } else {
                                T::t_template_head
                            };
                            break 'string_literal;
                        }
                        continue 'string_literal;
                    }
                }
                // exit condition
                c if c == QUOTE => {
                    self.step();
                    break;
                }

                _ => {
                    // Non-ASCII strings need the slow path
                    if self.code_point >= 0x80 {
                        needs_decode = true;
                    } else if IS_JSON && self.code_point < 0x20 {
                        self.syntax_error()?;
                    } else if (QUOTE == b'"' as i32 || QUOTE == b'\'' as i32)
                        && Environment::IS_NATIVE
                    {
                        let remainder = &self.source.contents[self.current..];
                        if remainder.len() >= 4096 {
                            match index_of_interesting_character_in_string_literal(
                                remainder,
                                QUOTE as u8,
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

        Ok(InnerStringLiteral::new(suffix_len, needs_decode))
    }

    pub fn parse_string_literal<const QUOTE: i32>(&mut self) -> Result<(), Error> {
        if QUOTE != b'`' as i32 {
            self.token = T::t_string_literal;
        } else if self.rescan_close_brace_as_template_token {
            self.token = T::t_template_tail;
        } else {
            self.token = T::t_no_substitution_template_literal;
        }
        // quote is 0 when parsing JSON from .env
        // .env values may not always be quoted.
        self.step();

        let string_literal_details = self.parse_string_literal_inner::<QUOTE>()?;

        // Reset string literal
        let base = if QUOTE == 0 { self.start } else { self.start + 1 };
        let suffix_len = string_literal_details.suffix_len() as usize;
        let end_pos = if self.end >= suffix_len {
            self.end - suffix_len
        } else {
            self.end
        };
        let slice_end = self.source.contents.len().min(base.max(end_pos));
        self.string_literal_raw_content = &self.source.contents[base..slice_end];
        // TODO(port): lifetime — borrows self.source.contents
        self.string_literal_raw_format = if string_literal_details.needs_decode() {
            StringLiteralRawFormat::NeedsDecode
        } else {
            StringLiteralRawFormat::Ascii
        };
        self.string_literal_start = self.start;
        if IS_JSON {
            self.is_ascii_only =
                self.is_ascii_only && !string_literal_details.needs_decode();
        }

        if !FeatureFlags::ALLOW_JSON_SINGLE_QUOTES {
            if QUOTE == b'\'' as i32 && IS_JSON {
                self.add_range_error(
                    self.range(),
                    format_args!("JSON strings must use double quotes"),
                    true,
                )?;
            }
        }
        Ok(())
    }

    #[inline]
    fn next_codepoint_slice(&self) -> &[u8] {
        if self.current >= self.source.contents.len() {
            return b"";
        }
        let cp_len = strings::wtf8_byte_sequence_length_with_invalid(
            self.source.contents[self.current],
        );
        if !(cp_len as usize + self.current > self.source.contents.len()) {
            &self.source.contents[self.current..cp_len as usize + self.current]
        } else {
            b""
        }
    }

    fn remaining(&self) -> &[u8] {
        &self.source.contents[self.current..]
    }

    #[inline]
    fn next_codepoint(&mut self) -> CodePoint {
        if self.current >= self.source.contents.len() {
            self.end = self.source.contents.len();
            return -1;
        }
        let cp_len = strings::wtf8_byte_sequence_length_with_invalid(
            self.source.contents[self.current],
        );
        let slice: &[u8] = if !(cp_len as usize + self.current > self.source.contents.len()) {
            &self.source.contents[self.current..cp_len as usize + self.current]
        } else {
            b""
        };

        let code_point = match slice.len() {
            0 => -1,
            1 => slice[0] as CodePoint,
            _ => strings::decode_wtf8_rune_t_multibyte(
                // SAFETY: we read at most cp_len (≤4) bytes; Zig indexes ptr[0..4].
                // TODO(port): the Zig code reads `slice.ptr[0..4]` which may read past
                // `slice.len`. Phase B: ensure `decode_wtf8_rune_t_multibyte` only reads
                // `len` bytes from the pointer.
                slice.as_ptr(),
                u8::try_from(slice.len()).unwrap() as u8,
                strings::UNICODE_REPLACEMENT,
            ),
        };

        self.end = self.current;

        self.current += if code_point != strings::UNICODE_REPLACEMENT {
            cp_len as usize
        } else {
            1
        };

        code_point
    }

    pub fn step(&mut self) {
        self.code_point = self.next_codepoint();

        // Track the approximate number of newlines in the file so we can preallocate
        // the line offset table in the printer for source maps. The line offset table
        // is the #1 highest allocation in the heap profile, so this is worth doing.
        // This count is approximate because it handles "\n" and "\r\n" (the common
        // cases) but not "\r" or " " or " ". Getting this wrong is harmless
        // because it's only a preallocation. The array will just grow if it's too small.
        self.approximate_newline_count += (self.code_point == b'\n' as i32) as usize;
    }

    #[inline]
    pub fn expect(&mut self, token: T) -> Result<(), Error> {
        // PERF(port): Zig param is `comptime token: T` — profile in Phase B
        if self.token != token {
            self.expected(token)?;
        }
        self.next()
    }

    #[inline]
    pub fn expect_or_insert_semicolon(&mut self) -> Result<(), Error> {
        if self.token == T::t_semicolon
            || (!self.has_newline_before
                && self.token != T::t_close_brace
                && self.token != T::t_end_of_file)
        {
            self.expect(T::t_semicolon)?;
        }
        Ok(())
    }

    pub fn add_unsupported_syntax_error(&mut self, msg: &[u8]) -> Result<(), Error> {
        self.add_error(
            self.end,
            format_args!("Unsupported syntax: {}", bstr::BStr::new(msg)),
            true,
        );
        Err(Error::SyntaxError)
    }

    // This is an edge case that doesn't really exist in the wild, so it doesn't
    // need to be as fast as possible.
    pub fn scan_identifier_with_escapes(
        &mut self,
        kind: IdentifierKind,
    ) -> Result<ScanResult<'a>, bun_core::Error> {
        // TODO(port): narrow error set
        let mut result = ScanResult {
            token: T::t_end_of_file,
            contents: b"".as_slice(),
        };
        // First pass: scan over the identifier to see how long it is
        loop {
            // Scan a unicode escape sequence. There is at least one because that's
            // what caused us to get on this slow path in the first place.
            if self.code_point == b'\\' as i32 {
                self.step();

                if self.code_point != b'u' as i32 {
                    self.add_syntax_error(
                        self.loc().to_usize(),
                        format_args!(
                            "{}",
                            InvalidEscapeSequenceFormatter {
                                code_point: self.code_point
                            }
                        ),
                    )?;
                }
                self.step();
                if self.code_point == b'{' as i32 {
                    // Variable-length
                    self.step();
                    while self.code_point != b'}' as i32 {
                        match self.code_point {
                            c if (b'0' as i32..=b'9' as i32).contains(&c)
                                || (b'a' as i32..=b'f' as i32).contains(&c)
                                || (b'A' as i32..=b'F' as i32).contains(&c) =>
                            {
                                self.step();
                            }
                            _ => self.syntax_error()?,
                        }
                    }

                    self.step();
                } else {
                    // Fixed-length
                    // comptime var j: usize = 0;
                    for _ in 0..4 {
                        match self.code_point {
                            c if (b'0' as i32..=b'9' as i32).contains(&c)
                                || (b'a' as i32..=b'f' as i32).contains(&c)
                                || (b'A' as i32..=b'F' as i32).contains(&c) =>
                            {
                                self.step();
                            }
                            _ => self.syntax_error()?,
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

        // Second pass: re-use our existing escape sequence parser
        let original_text = self.raw();

        debug_assert!(self.temp_buffer_u16.is_empty());
        // PORT NOTE: reshaped for borrowck — we move temp_buffer_u16 out, use it, then
        // clear and put it back (mirrors `defer clearRetainingCapacity()`).
        let mut tmp = core::mem::take(&mut self.temp_buffer_u16);
        tmp.reserve(original_text.len());
        let decode_res =
            self.decode_escape_sequences(self.start, original_text, &mut tmp);
        if let Err(e) = decode_res {
            tmp.clear();
            self.temp_buffer_u16 = tmp;
            return Err(e.into());
        }
        result.contents = self.utf16_to_string(&tmp)?;
        tmp.clear();
        self.temp_buffer_u16 = tmp;

        let identifier = if kind != IdentifierKind::Private {
            result.contents
        } else {
            &result.contents[1..]
        };

        if !is_identifier(identifier) {
            self.add_range_error(
                Range {
                    loc: logger::usize2_loc(self.start),
                    len: i32::try_from(self.end - self.start).unwrap(),
                },
                format_args!(
                    "Invalid identifier: \"{}\"",
                    bstr::BStr::new(result.contents)
                ),
                true,
            )?;
        }

        // result.contents = result.contents; (no-op)

        // Escaped keywords are not allowed to work as actual keywords, but they are
        // allowed wherever we allow identifiers or keywords. For example:
        //
        //   // This is an error (equivalent to "var var;")
        //   var var;
        //
        //   // This is an error (equivalent to "var foo;" except for this rule)
        //   var foo;
        //
        //   // This is an fine (equivalent to "foo.var;")
        //   foo.var;
        //
        result.token = if Keywords::has(result.contents) {
            T::t_escaped_keyword
        } else {
            T::t_identifier
        };

        Ok(result)
    }

    pub fn expect_contextual_keyword(&mut self, keyword: &'static [u8]) -> Result<(), Error> {
        if !self.is_contextual_keyword(keyword) {
            if cfg!(debug_assertions) {
                self.add_error(
                    self.start,
                    format_args!(
                        "Expected \"{}\" but found \"{}\" (token: {})",
                        bstr::BStr::new(keyword),
                        bstr::BStr::new(self.raw()),
                        <&'static str>::from(self.token),
                    ),
                    true,
                );
            } else {
                self.add_error(
                    self.start,
                    format_args!(
                        "Expected \"{}\" but found \"{}\"",
                        bstr::BStr::new(keyword),
                        bstr::BStr::new(self.raw()),
                    ),
                    true,
                );
            }
            return Err(Error::UnexpectedSyntax);
        }
        self.next()
    }

    pub fn maybe_expand_equals(&mut self) -> Result<(), Error> {
        match self.code_point {
            c if c == b'>' as i32 => {
                // "=" + ">" = "=>"
                self.token = T::t_equals_greater_than;
                self.step();
            }
            c if c == b'=' as i32 => {
                // "=" + "=" = "=="
                self.token = T::t_equals_equals;
                self.step();

                if self.code_point == b'=' as i32 {
                    // "=" + "==" = "==="
                    self.token = T::t_equals_equals_equals;
                    self.step();
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub fn expect_less_than<const IS_INSIDE_JSX_ELEMENT: bool>(
        &mut self,
    ) -> Result<(), Error> {
        match self.token {
            T::t_less_than => {
                if IS_INSIDE_JSX_ELEMENT {
                    self.next_inside_jsx_element()?;
                } else {
                    self.next()?;
                }
            }
            T::t_less_than_equals => {
                self.token = T::t_equals;
                self.start += 1;
                self.maybe_expand_equals()?;
            }
            T::t_less_than_less_than => {
                self.token = T::t_less_than;
                self.start += 1;
            }
            T::t_less_than_less_than_equals => {
                self.token = T::t_less_than_equals;
                self.start += 1;
            }
            _ => {
                self.expected(T::t_less_than)?;
            }
        }
        Ok(())
    }

    pub fn expect_greater_than<const IS_INSIDE_JSX_ELEMENT: bool>(
        &mut self,
    ) -> Result<(), Error> {
        match self.token {
            T::t_greater_than => {
                if IS_INSIDE_JSX_ELEMENT {
                    self.next_inside_jsx_element()?;
                } else {
                    self.next()?;
                }
            }

            T::t_greater_than_equals => {
                self.token = T::t_equals;
                self.start += 1;
                self.maybe_expand_equals()?;
            }

            T::t_greater_than_greater_than_equals => {
                self.token = T::t_greater_than_equals;
                self.start += 1;
            }

            T::t_greater_than_greater_than_greater_than_equals => {
                self.token = T::t_greater_than_greater_than_equals;
                self.start += 1;
            }

            T::t_greater_than_greater_than => {
                self.token = T::t_greater_than;
                self.start += 1;
            }

            T::t_greater_than_greater_than_greater_than => {
                self.token = T::t_greater_than_greater_than;
                self.start += 1;
            }

            _ => {
                self.expected(T::t_greater_than)?;
            }
        }
        Ok(())
    }

    pub fn next(&mut self) -> Result<(), Error> {
        self.has_newline_before = self.end == 0;
        self.has_pure_comment_before = false;
        self.has_no_side_effect_comment_before = false;
        self.prev_token_was_await_keyword = false;

        loop {
            self.start = self.end;
            self.token = T::t_end_of_file;

            match self.code_point {
                -1 => {
                    self.token = T::t_end_of_file;
                }

                c if c == b'#' as i32 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Private identifiers are not allowed in JSON",
                        );
                    }
                    if self.start == 0
                        && self.source.contents.len() > 1
                        && self.source.contents[1] == b'!'
                    {
                        // "#!/usr/bin/env node"
                        self.token = T::t_hashbang;
                        'hashbang: loop {
                            self.step();
                            match self.code_point {
                                c if c == b'\r' as i32
                                    || c == b'\n' as i32
                                    || c == 0x2028
                                    || c == 0x2029 =>
                                {
                                    break 'hashbang;
                                }
                                -1 => {
                                    break 'hashbang;
                                }
                                _ => {}
                            }
                        }
                        self.identifier = self.raw();
                    } else {
                        // "#foo"
                        self.step();
                        if self.code_point == b'\\' as i32 {
                            self.identifier = self
                                .scan_identifier_with_escapes(IdentifierKind::Private)
                                .map_err(|_| Error::SyntaxError)? // TODO(port): error coercion
                                .contents;
                        } else {
                            if !is_identifier_start(self.code_point) {
                                self.syntax_error()?;
                            }

                            self.step();
                            while is_identifier_continue(self.code_point) {
                                self.step();
                            }
                            if self.code_point == b'\\' as i32 {
                                self.identifier = self
                                    .scan_identifier_with_escapes(IdentifierKind::Private)
                                    .map_err(|_| Error::SyntaxError)?
                                    .contents;
                            } else {
                                self.identifier = self.raw();
                            }
                        }
                        self.token = T::t_private_identifier;
                        break;
                    }
                }
                c if c == b'\r' as i32
                    || c == b'\n' as i32
                    || c == 0x2028
                    || c == 0x2029 =>
                {
                    self.has_newline_before = true;

                    if GUESS_INDENTATION {
                        if self.indent_info.first_newline
                            && self.code_point == b'\n' as i32
                        {
                            while self.code_point == b'\n' as i32
                                || self.code_point == b'\r' as i32
                            {
                                self.step();
                            }

                            if self.code_point != b' ' as i32
                                && self.code_point != b'\t' as i32
                            {
                                // try to get the next one. this handles cases where the file starts
                                // with a newline
                                continue;
                            }

                            self.indent_info.first_newline = false;

                            let indent_character = self.code_point;
                            let mut count: usize = 0;
                            while self.code_point == indent_character {
                                self.step();
                                count += 1;
                            }

                            self.indent_info.guess.character =
                                if indent_character == b' ' as i32 {
                                    Indentation::Character::Space
                                } else {
                                    Indentation::Character::Tab
                                };
                            // TODO(port): exact field name on `Indentation`
                            self.indent_info.guess.scalar = count;
                            continue;
                        }
                    }

                    self.step();
                    continue;
                }
                c if c == b'\t' as i32 || c == b' ' as i32 => {
                    self.step();
                    continue;
                }
                c if c == b'(' as i32 => {
                    self.step();
                    self.token = T::t_open_paren;
                }
                c if c == b')' as i32 => {
                    self.step();
                    self.token = T::t_close_paren;
                }
                c if c == b'[' as i32 => {
                    self.step();
                    self.token = T::t_open_bracket;
                }
                c if c == b']' as i32 => {
                    self.step();
                    self.token = T::t_close_bracket;
                }
                c if c == b'{' as i32 => {
                    self.step();
                    self.token = T::t_open_brace;
                }
                c if c == b'}' as i32 => {
                    self.step();
                    self.token = T::t_close_brace;
                }
                c if c == b',' as i32 => {
                    self.step();
                    self.token = T::t_comma;
                }
                c if c == b':' as i32 => {
                    self.step();
                    self.token = T::t_colon;
                }
                c if c == b';' as i32 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Semicolons are not allowed in JSON",
                        );
                    }
                    self.step();
                    self.token = T::t_semicolon;
                }
                c if c == b'@' as i32 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Decorators are not allowed in JSON",
                        );
                    }
                    self.step();
                    self.token = T::t_at;
                }
                c if c == b'~' as i32 => {
                    if IS_JSON {
                        return self
                            .add_unsupported_syntax_error(b"~ is not allowed in JSON");
                    }
                    self.step();
                    self.token = T::t_tilde;
                }
                c if c == b'?' as i32 => {
                    // '?' or '?.' or '??' or '??='
                    self.step();
                    match self.code_point {
                        c if c == b'?' as i32 => {
                            self.step();
                            match self.code_point {
                                c if c == b'=' as i32 => {
                                    self.step();
                                    self.token = T::t_question_question_equals;
                                }
                                _ => {
                                    self.token = T::t_question_question;
                                }
                            }
                        }

                        c if c == b'.' as i32 => {
                            self.token = T::t_question;
                            let current = self.current;
                            let contents = &self.source.contents;

                            // Lookahead to disambiguate with 'a?.1:b'
                            if current < contents.len() {
                                let c = contents[current];
                                if c < b'0' || c > b'9' {
                                    self.step();
                                    self.token = T::t_question_dot;
                                }
                            }
                        }
                        _ => {
                            self.token = T::t_question;
                        }
                    }
                }
                c if c == b'%' as i32 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '%' or '%='
                    self.step();
                    match self.code_point {
                        c if c == b'=' as i32 => {
                            self.step();
                            self.token = T::t_percent_equals;
                        }
                        _ => {
                            self.token = T::t_percent;
                        }
                    }
                }

                c if c == b'&' as i32 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '&' or '&=' or '&&' or '&&='
                    self.step();
                    match self.code_point {
                        c if c == b'=' as i32 => {
                            self.step();
                            self.token = T::t_ampersand_equals;
                        }
                        c if c == b'&' as i32 => {
                            self.step();
                            match self.code_point {
                                c if c == b'=' as i32 => {
                                    self.step();
                                    self.token = T::t_ampersand_ampersand_equals;
                                }
                                _ => {
                                    self.token = T::t_ampersand_ampersand;
                                }
                            }
                        }
                        _ => {
                            self.token = T::t_ampersand;
                        }
                    }
                }

                c if c == b'|' as i32 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '|' or '|=' or '||' or '||='
                    self.step();
                    match self.code_point {
                        c if c == b'=' as i32 => {
                            self.step();
                            self.token = T::t_bar_equals;
                        }
                        c if c == b'|' as i32 => {
                            self.step();
                            match self.code_point {
                                c if c == b'=' as i32 => {
                                    self.step();
                                    self.token = T::t_bar_bar_equals;
                                }
                                _ => {
                                    self.token = T::t_bar_bar;
                                }
                            }
                        }
                        _ => {
                            self.token = T::t_bar;
                        }
                    }
                }

                c if c == b'^' as i32 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '^' or '^='
                    self.step();
                    match self.code_point {
                        c if c == b'=' as i32 => {
                            self.step();
                            self.token = T::t_caret_equals;
                        }
                        _ => {
                            self.token = T::t_caret;
                        }
                    }
                }

                c if c == b'+' as i32 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '+' or '+=' or '++'
                    self.step();
                    match self.code_point {
                        c if c == b'=' as i32 => {
                            self.step();
                            self.token = T::t_plus_equals;
                        }
                        c if c == b'+' as i32 => {
                            self.step();
                            self.token = T::t_plus_plus;
                        }
                        _ => {
                            self.token = T::t_plus;
                        }
                    }
                }

                c if c == b'-' as i32 => {
                    // '+' or '+=' or '++'
                    self.step();
                    match self.code_point {
                        c if c == b'=' as i32 => {
                            if IS_JSON {
                                return self.add_unsupported_syntax_error(
                                    b"Operators are not allowed in JSON",
                                );
                            }
                            self.step();
                            self.token = T::t_minus_equals;
                        }
                        c if c == b'-' as i32 => {
                            if IS_JSON {
                                return self.add_unsupported_syntax_error(
                                    b"Operators are not allowed in JSON",
                                );
                            }
                            self.step();

                            if self.code_point == b'>' as i32 && self.has_newline_before {
                                self.step();
                                self.log
                                    .add_range_warning(
                                        &self.source,
                                        self.range(),
                                        b"Treating \"-->\" as the start of a legacy HTML single-line comment",
                                    )
                                    .expect("unreachable");

                                'single_line_html_close_comment: loop {
                                    match self.code_point {
                                        c if c == b'\r' as i32
                                            || c == b'\n' as i32
                                            || c == 0x2028
                                            || c == 0x2029 =>
                                        {
                                            break 'single_line_html_close_comment;
                                        }
                                        -1 => {
                                            break 'single_line_html_close_comment;
                                        }
                                        _ => {}
                                    }
                                    self.step();
                                }
                                continue;
                            }

                            self.token = T::t_minus_minus;
                        }
                        _ => {
                            self.token = T::t_minus;
                        }
                    }
                }

                c if c == b'*' as i32 => {
                    // '*' or '*=' or '**' or '**='
                    self.step();
                    match self.code_point {
                        c if c == b'=' as i32 => {
                            self.step();
                            self.token = T::t_asterisk_equals;
                        }
                        c if c == b'*' as i32 => {
                            self.step();
                            match self.code_point {
                                c if c == b'=' as i32 => {
                                    self.step();
                                    self.token = T::t_asterisk_asterisk_equals;
                                }
                                _ => {
                                    self.token = T::t_asterisk_asterisk;
                                }
                            }
                        }
                        _ => {
                            self.token = T::t_asterisk;
                        }
                    }
                }
                c if c == b'/' as i32 => {
                    // '/' or '/=' or '//' or '/* ... */'
                    self.step();

                    match self.code_point {
                        c if c == b'=' as i32 => {
                            self.step();
                            self.token = T::t_slash_equals;
                        }
                        c if c == b'/' as i32 => {
                            self.scan_single_line_comment();
                            if IS_JSON {
                                if !ALLOW_COMMENTS {
                                    self.add_range_error(
                                        self.range(),
                                        format_args!("JSON does not support comments"),
                                        true,
                                    )?;
                                    return Ok(());
                                }
                            }
                            self.scan_comment_text(false);
                            continue;
                        }
                        c if c == b'*' as i32 => {
                            self.step();

                            'multi_line_comment: loop {
                                match self.code_point {
                                    c if c == b'*' as i32 => {
                                        self.step();
                                        if self.code_point == b'/' as i32 {
                                            self.step();
                                            break 'multi_line_comment;
                                        }
                                    }
                                    c if c == b'\r' as i32
                                        || c == b'\n' as i32
                                        || c == 0x2028
                                        || c == 0x2029 =>
                                    {
                                        self.step();
                                        self.has_newline_before = true;
                                    }
                                    -1 => {
                                        self.start = self.end;
                                        self.add_syntax_error(
                                            self.start,
                                            format_args!(
                                                "Expected \"*/\" to terminate multi-line comment"
                                            ),
                                        )?;
                                    }
                                    _ => {
                                        if Environment::ENABLE_SIMD {
                                            if self.code_point < 128 {
                                                let remainder =
                                                    &self.source.contents[self.current..];
                                                if remainder.len() >= 512 {
                                                    match skip_to_interesting_character_in_multiline_comment(remainder) {
                                                        Some(off) => {
                                                            self.current += off as usize;
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

                                        self.step();
                                    }
                                }
                            }
                            if IS_JSON {
                                if !ALLOW_COMMENTS {
                                    self.add_range_error(
                                        self.range(),
                                        format_args!("JSON does not support comments"),
                                        true,
                                    )?;
                                    return Ok(());
                                }
                            }
                            self.scan_comment_text(true);
                            continue;
                        }
                        _ => {
                            self.token = T::t_slash;
                        }
                    }
                }

                c if c == b'=' as i32 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '=' or '=>' or '==' or '==='
                    self.step();
                    match self.code_point {
                        c if c == b'>' as i32 => {
                            self.step();
                            self.token = T::t_equals_greater_than;
                        }
                        c if c == b'=' as i32 => {
                            self.step();
                            match self.code_point {
                                c if c == b'=' as i32 => {
                                    self.step();
                                    self.token = T::t_equals_equals_equals;
                                }
                                _ => {
                                    self.token = T::t_equals_equals;
                                }
                            }
                        }
                        _ => {
                            self.token = T::t_equals;
                        }
                    }
                }

                c if c == b'<' as i32 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '<' or '<<' or '<=' or '<<=' or '<!--'
                    self.step();
                    match self.code_point {
                        c if c == b'=' as i32 => {
                            self.step();
                            self.token = T::t_less_than_equals;
                        }
                        c if c == b'<' as i32 => {
                            self.step();
                            match self.code_point {
                                c if c == b'=' as i32 => {
                                    self.step();
                                    self.token = T::t_less_than_less_than_equals;
                                }
                                _ => {
                                    self.token = T::t_less_than_less_than;
                                }
                            }
                        }
                        // Handle legacy HTML-style comments
                        c if c == b'!' as i32 => {
                            if self.peek("--".len()) == b"--" {
                                self.add_unsupported_syntax_error(
                                    b"Legacy HTML comments not implemented yet!",
                                )?;
                                return Ok(());
                            }

                            self.token = T::t_less_than;
                        }
                        _ => {
                            self.token = T::t_less_than;
                        }
                    }
                }

                c if c == b'>' as i32 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '>' or '>>' or '>>>' or '>=' or '>>=' or '>>>='
                    self.step();

                    match self.code_point {
                        c if c == b'=' as i32 => {
                            self.step();
                            self.token = T::t_greater_than_equals;
                        }
                        c if c == b'>' as i32 => {
                            self.step();
                            match self.code_point {
                                c if c == b'=' as i32 => {
                                    self.step();
                                    self.token = T::t_greater_than_greater_than_equals;
                                }
                                c if c == b'>' as i32 => {
                                    self.step();
                                    match self.code_point {
                                        c if c == b'=' as i32 => {
                                            self.step();
                                            self.token = T::t_greater_than_greater_than_greater_than_equals;
                                        }
                                        _ => {
                                            self.token = T::t_greater_than_greater_than_greater_than;
                                        }
                                    }
                                }
                                _ => {
                                    self.token = T::t_greater_than_greater_than;
                                }
                            }
                        }
                        _ => {
                            self.token = T::t_greater_than;
                        }
                    }
                }

                c if c == b'!' as i32 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '!' or '!=' or '!=='
                    self.step();
                    match self.code_point {
                        c if c == b'=' as i32 => {
                            self.step();
                            match self.code_point {
                                c if c == b'=' as i32 => {
                                    self.step();
                                    self.token = T::t_exclamation_equals_equals;
                                }
                                _ => {
                                    self.token = T::t_exclamation_equals;
                                }
                            }
                        }
                        _ => {
                            self.token = T::t_exclamation;
                        }
                    }
                }

                c if c == b'\'' as i32 => {
                    self.parse_string_literal::<{ b'\'' as i32 }>()?;
                }
                c if c == b'"' as i32 => {
                    self.parse_string_literal::<{ b'"' as i32 }>()?;
                }
                c if c == b'`' as i32 => {
                    self.parse_string_literal::<{ b'`' as i32 }>()?;
                }

                c if c == b'_' as i32
                    || c == b'$' as i32
                    || (b'a' as i32..=b'z' as i32).contains(&c)
                    || (b'A' as i32..=b'Z' as i32).contains(&c) =>
                {
                    let advance = latin1_identifier_continue_length(
                        &self.source.contents[self.current..],
                    );

                    self.end = self.current + advance;
                    self.current = self.end;

                    self.step();

                    if self.code_point >= 0x80 {
                        // @branchHint(.unlikely)
                        while is_identifier_continue(self.code_point) {
                            self.step();
                        }
                    }

                    if self.code_point != b'\\' as i32 {
                        // @branchHint(.likely)
                        // this code is so hot that if you save lexer.raw() into a temporary variable
                        // it shows up in profiling
                        self.identifier = self.raw();
                        self.token =
                            Keywords::get(self.identifier).unwrap_or(T::t_identifier);
                    } else {
                        // @branchHint(.unlikely)
                        let scan_result = self
                            .scan_identifier_with_escapes(IdentifierKind::Normal)
                            .map_err(|_| Error::SyntaxError)?; // TODO(port): error coercion
                        self.identifier = scan_result.contents;
                        self.token = scan_result.token;
                    }
                }

                c if c == b'\\' as i32 => {
                    if IS_JSON && IGNORE_LEADING_ESCAPE_SEQUENCES {
                        if self.start == 0
                            || self.current == self.source.contents.len() - 1
                        {
                            self.step();
                            continue;
                        }
                    }

                    let scan_result = self
                        .scan_identifier_with_escapes(IdentifierKind::Normal)
                        .map_err(|_| Error::SyntaxError)?;
                    self.identifier = scan_result.contents;
                    self.token = scan_result.token;
                }

                c if c == b'.' as i32 || (b'0' as i32..=b'9' as i32).contains(&c) => {
                    self.parse_numeric_literal_or_dot()?;
                }

                _ => {
                    // Check for unusual whitespace characters
                    if is_whitespace(self.code_point) {
                        self.step();
                        continue;
                    }

                    if is_identifier_start(self.code_point) {
                        self.step();
                        while is_identifier_continue(self.code_point) {
                            self.step();
                        }
                        if self.code_point == b'\\' as i32 {
                            let scan_result = self
                                .scan_identifier_with_escapes(IdentifierKind::Normal)
                                .map_err(|_| Error::SyntaxError)?;
                            self.identifier = scan_result.contents;
                            self.token = scan_result.token;
                        } else {
                            self.token = T::t_identifier;
                            self.identifier = self.raw();
                        }
                        break;
                    }

                    self.end = self.current;
                    self.token = T::t_syntax_error;
                }
            }

            return Ok(());
        }
        Ok(())
    }

    pub fn expected(&mut self, token: T) -> Result<(), Error> {
        if self.is_log_disabled {
            return Err(Error::Backtrack);
        } else if !tokenToString::get(token).is_empty() {
            self.expected_string(tokenToString::get(token))
        } else {
            self.unexpected()
        }
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

        self.did_panic = true;
        self.add_range_error(
            self.range(),
            format_args!("Unexpected {}", bstr::BStr::new(found)),
            true,
        )
    }

    pub fn raw(&self) -> &'a [u8] {
        // TODO(port): lifetime — borrows self.source.contents (owned by value).
        // SAFETY: source.contents outlives 'a (it's cloned from the borrowed Source).
        unsafe {
            core::slice::from_raw_parts(
                self.source.contents.as_ptr().add(self.start),
                self.end - self.start,
            )
        }
    }

    pub fn is_contextual_keyword(&self, keyword: &'static [u8]) -> bool {
        self.token == T::t_identifier && self.raw() == keyword
    }

    pub fn expected_string(&mut self, text: &[u8]) -> Result<(), Error> {
        if self.prev_token_was_await_keyword {
            let mut notes: [logger::Data; 1] = [logger::Data::default()];
            if !self.fn_or_arrow_start_loc.is_empty() {
                notes[0] = logger::range_data(
                    &self.source,
                    range_of_identifier(&self.source, self.fn_or_arrow_start_loc),
                    b"Consider adding the \"async\" keyword here",
                );
            }

            let notes_ptr: &[logger::Data] =
                &notes[0..(!self.fn_or_arrow_start_loc.is_empty()) as usize];

            self.add_range_error_with_notes(
                self.range(),
                format_args!(
                    "\"await\" can only be used inside an \"async\" function"
                ),
                notes_ptr,
            )?;
            return Ok(());
        }
        if self.source.contents.len() != self.start {
            self.add_range_error(
                self.range(),
                format_args!(
                    "Expected {} but found \"{}\"",
                    bstr::BStr::new(text),
                    bstr::BStr::new(self.raw())
                ),
                true,
            )
        } else {
            self.add_range_error(
                self.range(),
                format_args!(
                    "Expected {} but found end of file",
                    bstr::BStr::new(text)
                ),
                true,
            )
        }
    }

    fn scan_comment_text(&mut self, for_pragma: bool) {
        let text = &self.source.contents[self.start..self.end];
        let has_legal_annotation = text.len() > 2 && text[2] == b'!';
        let is_multiline_comment = text.len() > 1 && text[1] == b'*';

        if self.track_comments {
            // Save the original comment text so we can subtract comments from the
            // character frequency analysis used by symbol minification
            self.all_comments.push(self.range());
        }

        // Omit the trailing "*/" from the checks below
        let end_comment_text = if is_multiline_comment {
            text.len() - 2
        } else {
            text.len()
        };

        if has_legal_annotation || self.preserve_all_comments_before {
            if is_multiline_comment {
                // text = lexer.removeMultilineCommentIndent(lexer.source.contents[0..lexer.start], text);
            }

            self.comments_to_preserve_before.push(js_ast::G::Comment {
                text,
                loc: self.loc(),
            });
            // TODO(port): lifetime — `text` borrows source.contents
        }

        // tsconfig.json doesn't care about annotations
        if IS_JSON {
            return;
        }

        if !for_pragma {
            return;
        }

        let mut rest = &text[0..end_comment_text];

        while let Some(i) = strings::index_of_any(rest, b"@#") {
            let c = rest[i];
            rest = &rest[(i + 1).min(rest.len())..];
            match c {
                b'@' | b'#' => {
                    let chunk = rest;
                    let offset = self.scan_pragma(
                        self.start + i + (text.len() - rest.len()),
                        chunk,
                        false,
                    );

                    rest = &rest[
                        // The min is necessary because the file could end
                        // with a pragma and hasPrefixWithWordBoundary
                        // returns true when that "word boundary" is EOF
                        offset.min(rest.len())..];
                }
                _ => {}
            }
        }
    }

    /// This scans a "// comment" in a single pass over the input.
    fn scan_single_line_comment(&mut self) {
        loop {
            // Find index of newline (ASCII/Unicode), non-ASCII, '#', or '@'.
            if let Some(relative_index) =
                bun_highway::index_of_newline_or_non_ascii_or_hash_or_at(self.remaining())
            {
                let absolute_index = self.current + relative_index;
                self.current = absolute_index; // Move TO the interesting char

                self.step(); // Consume the interesting char, sets code_point, advances current

                match self.code_point {
                    c if c == b'\r' as i32
                        || c == b'\n' as i32
                        || c == 0x2028
                        || c == 0x2029 =>
                    {
                        // Is it a line terminator?
                        // Found the end of the comment line.
                        return; // Stop scanning. Lexer state is ready for the next token.
                    }
                    -1 => {
                        return;
                    } // EOF? Stop.

                    c if c == b'#' as i32 || c == b'@' as i32 => {
                        if !IS_JSON {
                            let pragma_trigger_pos = self.end; // Position OF #/@
                            // Use remaining() which starts *after* the consumed #/@
                            let chunk = self.remaining();

                            let offset =
                                self.scan_pragma(pragma_trigger_pos, chunk, true);

                            if offset > 0 {
                                // Pragma found (e.g., __PURE__).
                                // Advance current past the pragma's argument text.
                                // 'current' is already after the #/@ trigger.
                                self.current += offset;
                                // Do NOT consume the character immediately after the pragma.
                                // Let the main loop find the actual line terminator.

                                // Continue the outer loop from the position AFTER the pragma arg.
                                continue;
                            }
                            // If offset == 0, it wasn't a valid pragma start.
                        }
                        // Not a pragma or is_json. Treat #/@ as a normal comment character.
                        // The character was consumed by step(). Let the outer loop continue.
                        continue;
                    }
                    _ => {
                        // Non-ASCII (but not LS/PS), etc. Treat as normal comment char.
                        // The character was consumed by step(). Let the outer loop continue.
                        continue;
                    }
                }
            } else {
                // Highway found nothing until EOF
                // Consume the rest of the line.
                self.end = self.source.contents.len();
                self.current = self.source.contents.len();
                self.code_point = -1; // Set EOF state
                return;
            }
        }
        // unreachable
    }

    /// Scans the string for a pragma.
    /// offset is used when there's an issue with the JSX pragma later on.
    /// Returns the byte length to advance by if found, otherwise 0.
    fn scan_pragma(
        &mut self,
        offset_for_errors: usize,
        chunk: &[u8],
        allow_newline: bool,
    ) -> usize {
        if !self.has_pure_comment_before {
            if strings::has_prefix_with_word_boundary(chunk, b"__PURE__") {
                self.has_pure_comment_before = true;
                return "__PURE__".len();
            }
        }

        if strings::has_prefix_with_word_boundary(chunk, b"jsx") {
            if let Some(span) = PragmaArg::scan(
                PragmaArg::SkipSpaceFirst,
                self.start + offset_for_errors,
                b"jsx",
                chunk,
                allow_newline,
            ) {
                self.jsx_pragma._jsx = span;
                return "jsx".len()
                    + if span.range.len > 0 {
                        usize::try_from(span.range.len).unwrap()
                    } else {
                        0
                    };
            }
        } else if strings::has_prefix_with_word_boundary(chunk, b"jsxFrag") {
            if let Some(span) = PragmaArg::scan(
                PragmaArg::SkipSpaceFirst,
                self.start + offset_for_errors,
                b"jsxFrag",
                chunk,
                allow_newline,
            ) {
                self.jsx_pragma._jsx_frag = span;
                return "jsxFrag".len()
                    + if span.range.len > 0 {
                        usize::try_from(span.range.len).unwrap()
                    } else {
                        0
                    };
            }
        } else if strings::has_prefix_with_word_boundary(chunk, b"jsxRuntime") {
            if let Some(span) = PragmaArg::scan(
                PragmaArg::SkipSpaceFirst,
                self.start + offset_for_errors,
                b"jsxRuntime",
                chunk,
                allow_newline,
            ) {
                self.jsx_pragma._jsx_runtime = span;
                return "jsxRuntime".len()
                    + if span.range.len > 0 {
                        usize::try_from(span.range.len).unwrap()
                    } else {
                        0
                    };
            }
        } else if strings::has_prefix_with_word_boundary(chunk, b"jsxImportSource") {
            if let Some(span) = PragmaArg::scan(
                PragmaArg::SkipSpaceFirst,
                self.start + offset_for_errors,
                b"jsxImportSource",
                chunk,
                allow_newline,
            ) {
                self.jsx_pragma._jsx_import_source = span;
                return "jsxImportSource".len()
                    + if span.range.len > 0 {
                        usize::try_from(span.range.len).unwrap()
                    } else {
                        0
                    };
            }
        } else if chunk.len() >= " sourceMappingURL=".len() + 1
            && chunk.starts_with(b" sourceMappingURL=")
        {
            // Check includes space for prefix
            return PragmaArg::scan_source_mapping_url_value(
                self.start,
                offset_for_errors,
                chunk,
                &mut self.source_mapping_url,
            );
        }

        0
    }

    // TODO: implement this
    pub fn remove_multiline_comment_indent(&mut self, _: &[u8], text: &'a [u8]) -> &'a [u8] {
        text
    }

    pub fn range(&self) -> Range {
        Range {
            loc: logger::usize2_loc(self.start),
            // TODO(port): std.math.lossyCast — saturate on overflow
            len: (self.end - self.start) as i32,
        }
    }

    pub fn init_json(
        log: &'a mut Log,
        source: &Source,
        allocator: &'a Arena,
    ) -> Result<Self, Error> {
        let mut lex = Self::init_without_reading(log, source, allocator);
        lex.step();
        lex.next()?;
        Ok(lex)
    }

    pub fn init_without_reading(
        log: &'a mut Log,
        source: &Source,
        allocator: &'a Arena,
    ) -> Self {
        Self {
            log,
            source: source.clone(),
            current: 0,
            start: 0,
            end: 0,
            did_panic: false,
            approximate_newline_count: 0,
            previous_backslash_quote_in_jsx: Range::NONE,
            token: T::t_end_of_file,
            has_newline_before: false,
            has_pure_comment_before: false,
            has_no_side_effect_comment_before: false,
            preserve_all_comments_before: false,
            is_legacy_octal_literal: false,
            is_log_disabled: false,
            comments_to_preserve_before: Vec::new(),
            code_point: -1,
            identifier: b"",
            jsx_pragma: JSXPragma::default(),
            source_mapping_url: None,
            number: 0.0,
            rescan_close_brace_as_template_token: false,
            prev_error_loc: Loc::EMPTY,
            prev_token_was_await_keyword: false,
            await_keyword_loc: Loc::EMPTY,
            fn_or_arrow_start_loc: Loc::EMPTY,
            regex_flags_start: None,
            allocator,
            string_literal_raw_content: b"",
            string_literal_start: 0,
            string_literal_raw_format: StringLiteralRawFormat::Ascii,
            temp_buffer_u16: Vec::new(),
            is_ascii_only: if IS_JSON { true } else { false },
            track_comments: false,
            all_comments: Vec::new(),
            indent_info: IndentInfo {
                guess: Indentation::default(),
                first_newline: true,
            },
        }
    }

    pub fn init(
        log: &'a mut Log,
        source: &Source,
        allocator: &'a Arena,
    ) -> Result<Self, Error> {
        let mut lex = Self::init_without_reading(log, source, allocator);
        lex.step();
        lex.next()?;
        Ok(lex)
    }

    pub fn to_e_string(&mut self) -> Result<js_ast::E::String, Error> {
        match self.string_literal_raw_format {
            StringLiteralRawFormat::Ascii => {
                // string_literal_raw_content contains ascii without escapes
                Ok(js_ast::E::String::init(self.string_literal_raw_content))
            }
            StringLiteralRawFormat::Utf16 => {
                // string_literal_raw_content is already parsed, duplicated, and utf-16
                // SAFETY: content was created via sliceAsBytes from a [u16] dupe.
                let utf16: &[u16] = unsafe {
                    core::slice::from_raw_parts(
                        self.string_literal_raw_content.as_ptr() as *const u16,
                        self.string_literal_raw_content.len() / 2,
                    )
                };
                Ok(js_ast::E::String::init_utf16(utf16))
                // TODO(port): exact constructor name on js_ast::E::String for utf16
            }
            StringLiteralRawFormat::NeedsDecode => {
                // string_literal_raw_content contains escapes (ie '\n') that need to be converted to their values (ie 0x0A).
                // escape parsing may cause a syntax error.
                debug_assert!(self.temp_buffer_u16.is_empty());
                let mut tmp = core::mem::take(&mut self.temp_buffer_u16);
                tmp.reserve(self.string_literal_raw_content.len());
                let res = self.decode_escape_sequences(
                    self.string_literal_start,
                    self.string_literal_raw_content,
                    &mut tmp,
                );
                if let Err(e) = res {
                    tmp.clear();
                    self.temp_buffer_u16 = tmp;
                    return Err(e);
                }
                let first_non_ascii = strings::first_non_ascii16(&tmp);
                // prefer to store an ascii e.string rather than a utf-16 one. ascii takes less memory, and `+` folding is not yet supported on utf-16.
                let out = if first_non_ascii.is_some() {
                    let dup = self.allocator.alloc_slice_copy(&tmp);
                    js_ast::E::String::init_utf16(dup)
                } else {
                    let result =
                        self.allocator.alloc_slice_fill_default::<u8>(tmp.len());
                    strings::copy_u16_into_u8(result, &tmp);
                    js_ast::E::String::init(result)
                };
                tmp.clear();
                self.temp_buffer_u16 = tmp;
                Ok(out)
            }
        }
    }

    pub fn to_utf8_e_string(&mut self) -> Result<js_ast::E::String, Error> {
        let mut res = self.to_e_string()?;
        res.to_utf8(self.allocator)?;
        // TODO(port): allocator routing for E.String.toUTF8
        Ok(res)
    }

    #[inline]
    fn assert_not_json(&self) {
        if IS_JSON {
            // TODO(port): Zig uses @compileError; Rust const generics can't compile-error
            // here without nightly. Phase B may gate JSX methods to non-JSON instantiations.
            unreachable!("JSON should not reach this point");
        }
    }

    pub fn scan_reg_exp(&mut self) -> Result<(), Error> {
        self.assert_not_json();
        self.regex_flags_start = None;
        loop {
            match self.code_point {
                c if c == b'/' as i32 => {
                    self.step();

                    let mut has_set_flags_start = false;
                    const FLAG_CHARACTERS: &[u8] = b"dgimsuvy";
                    const MIN_FLAG: u8 = b'd'; // comptime std.mem.min
                    const MAX_FLAG: u8 = b'y'; // comptime std.mem.max
                    let mut flags = bun_collections::IntegerBitSet::<
                        { (MAX_FLAG - MIN_FLAG) as usize + 1 },
                    >::empty();
                    let _ = FLAG_CHARACTERS;
                    while is_identifier_continue(self.code_point) {
                        match self.code_point {
                            c if c == b'd' as i32
                                || c == b'g' as i32
                                || c == b'i' as i32
                                || c == b'm' as i32
                                || c == b's' as i32
                                || c == b'u' as i32
                                || c == b'y' as i32
                                || c == b'v' as i32 =>
                            {
                                if !has_set_flags_start {
                                    self.regex_flags_start =
                                        Some((self.end - self.start) as u16);
                                    has_set_flags_start = true;
                                }
                                let flag = usize::from(
                                    MAX_FLAG - u8::try_from(self.code_point).unwrap(),
                                );
                                if flags.is_set(flag) {
                                    self.add_error(
                                        self.current,
                                        format_args!(
                                            "Duplicate flag \"{}\" in regular expression",
                                            // TODO(port): {u} formatter — codepoint as char
                                            char::from_u32(self.code_point as u32)
                                                .unwrap_or('\u{FFFD}')
                                        ),
                                        false,
                                    );
                                }
                                flags.set(flag);

                                self.step();
                            }
                            _ => {
                                self.add_error(
                                    self.current,
                                    format_args!(
                                        "Invalid flag \"{}\" in regular expression",
                                        char::from_u32(self.code_point as u32)
                                            .unwrap_or('\u{FFFD}')
                                    ),
                                    false,
                                );

                                self.step();
                            }
                        }
                    }
                    return Ok(());
                }
                c if c == b'[' as i32 => {
                    self.step();
                    while self.code_point != b']' as i32 {
                        self.scan_reg_exp_validate_and_step()?;
                    }
                    self.step();
                }
                _ => {
                    self.scan_reg_exp_validate_and_step()?;
                }
            }
        }
    }

    pub fn utf16_to_string(
        &self,
        js: JavascriptString<'_>,
    ) -> Result<&'a [u8], bun_core::Error> {
        // TODO(port): allocator routing — Zig: strings.toUTF8AllocWithType(lexer.allocator, js)
        strings::to_utf8_alloc_with_type(self.allocator, js)
    }

    pub fn next_inside_jsx_element(&mut self) -> Result<(), Error> {
        self.assert_not_json();

        self.has_newline_before = false;

        loop {
            self.start = self.end;
            self.token = T::t_end_of_file;

            match self.code_point {
                -1 => {
                    self.token = T::t_end_of_file;
                }
                c if c == b'\r' as i32
                    || c == b'\n' as i32
                    || c == 0x2028
                    || c == 0x2029 =>
                {
                    self.step();
                    self.has_newline_before = true;
                    continue;
                }
                c if c == b'\t' as i32 || c == b' ' as i32 => {
                    self.step();
                    continue;
                }
                c if c == b'.' as i32 => {
                    self.step();
                    self.token = T::t_dot;
                }
                c if c == b'=' as i32 => {
                    self.step();
                    self.token = T::t_equals;
                }
                c if c == b'{' as i32 => {
                    self.step();
                    self.token = T::t_open_brace;
                }
                c if c == b'}' as i32 => {
                    self.step();
                    self.token = T::t_close_brace;
                }
                c if c == b'<' as i32 => {
                    self.step();
                    self.token = T::t_less_than;
                }
                c if c == b'>' as i32 => {
                    self.step();
                    self.token = T::t_greater_than;
                }
                c if c == b'/' as i32 => {
                    // '/' or '//' or '/* ... */'
                    self.step();
                    match self.code_point {
                        c if c == b'/' as i32 => {
                            'single_line_comment: loop {
                                self.step();
                                match self.code_point {
                                    c if c == b'\r' as i32
                                        || c == b'\n' as i32
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
                        c if c == b'*' as i32 => {
                            self.step();
                            'multi_line_comment: loop {
                                match self.code_point {
                                    c if c == b'*' as i32 => {
                                        self.step();
                                        if self.code_point == b'/' as i32 {
                                            self.step();
                                            break 'multi_line_comment;
                                        }
                                    }
                                    c if c == b'\r' as i32
                                        || c == b'\n' as i32
                                        || c == 0x2028
                                        || c == 0x2029 =>
                                    {
                                        self.step();
                                        self.has_newline_before = true;
                                    }
                                    -1 => {
                                        self.start = self.end;
                                        self.add_syntax_error(
                                            self.start,
                                            format_args!(
                                                "Expected \"*/\" to terminate multi-line comment"
                                            ),
                                        )?;
                                    }
                                    _ => {
                                        self.step();
                                    }
                                }
                            }
                            continue;
                        }
                        _ => {
                            self.token = T::t_slash;
                        }
                    }
                }
                c if c == b'\'' as i32 => {
                    self.step();
                    self.parse_jsx_string_literal::<{ b'\'' }>()?;
                }
                c if c == b'"' as i32 => {
                    self.step();
                    self.parse_jsx_string_literal::<{ b'"' }>()?;
                }
                _ => {
                    if is_whitespace(self.code_point) {
                        self.step();
                        continue;
                    }

                    if is_identifier_start(self.code_point) {
                        self.step();
                        while is_identifier_continue(self.code_point)
                            || self.code_point == b'-' as i32
                        {
                            self.step();
                        }

                        // Parse JSX namespaces. These are not supported by React or TypeScript
                        // but someone using JSX syntax in more obscure ways may find a use for
                        // them. A namespaced name is just always turned into a string so you
                        // can't use this feature to reference JavaScript identifiers.
                        if self.code_point == b':' as i32 {
                            self.step();

                            if is_identifier_start(self.code_point) {
                                while is_identifier_continue(self.code_point)
                                    || self.code_point == b'-' as i32
                                {
                                    self.step();
                                }
                            } else {
                                self.add_syntax_error(
                                    self.range().end_i(),
                                    format_args!(
                                        "Expected identifier after \"{}\" in namespaced JSX name",
                                        bstr::BStr::new(self.raw())
                                    ),
                                )?;
                            }
                        }

                        self.identifier = self.raw();
                        self.token = T::t_identifier;
                        break;
                    }

                    self.end = self.current;
                    self.token = T::t_syntax_error;
                }
            }

            return Ok(());
        }
        Ok(())
    }

    pub fn parse_jsx_string_literal<const QUOTE: u8>(&mut self) -> Result<(), Error> {
        self.assert_not_json();

        let mut backslash = Range::NONE;
        let mut needs_decode = false;

        'string_literal: loop {
            match self.code_point {
                -1 => {
                    self.syntax_error()?;
                }
                c if c == b'&' as i32 => {
                    needs_decode = true;
                    self.step();
                }

                c if c == b'\\' as i32 => {
                    backslash = Range {
                        loc: Loc {
                            start: i32::try_from(self.end).unwrap(),
                        },
                        len: 1,
                    };
                    self.step();

                    // JSX string literals do not support escaping
                    // They're "pre" escaped
                    match self.code_point {
                        c if c == b'u' as i32
                            || c == 0x0C
                            || c == 0
                            || c == b'\t' as i32
                            || c == 0x0B // std.ascii.control_code.vt
                            || c == 0x08 =>
                        {
                            needs_decode = true;
                        }
                        _ => {}
                    }

                    continue;
                }
                c if c == QUOTE as i32 => {
                    if backslash.len > 0 {
                        backslash.len += 1;
                        self.previous_backslash_quote_in_jsx = backslash;
                    }
                    self.step();
                    break 'string_literal;
                }

                _ => {
                    // Non-ASCII strings need the slow path
                    if self.code_point >= 0x80 {
                        needs_decode = true;
                    } else if IS_JSON && self.code_point < 0x20 {
                        self.syntax_error()?;
                    }
                    self.step();
                }
            }
            backslash = Range::NONE;
        }

        self.token = T::t_string_literal;

        let raw_content_slice =
            &self.source.contents[self.start + 1..self.end - 1];
        if needs_decode {
            debug_assert!(self.temp_buffer_u16.is_empty());
            let mut tmp = core::mem::take(&mut self.temp_buffer_u16);
            tmp.reserve(raw_content_slice.len());
            let res = self
                .fix_whitespace_and_decode_jsx_entities(raw_content_slice, &mut tmp);
            if let Err(e) = res {
                tmp.clear();
                self.temp_buffer_u16 = tmp;
                return Err(e);
            }

            let dup = self.allocator.alloc_slice_copy(&tmp);
            // SAFETY: reinterpret &[u16] as &[u8]
            self.string_literal_raw_content = unsafe {
                core::slice::from_raw_parts(
                    dup.as_ptr() as *const u8,
                    dup.len() * 2,
                )
            };
            self.string_literal_raw_format = StringLiteralRawFormat::Utf16;
            tmp.clear();
            self.temp_buffer_u16 = tmp;
        } else {
            self.string_literal_raw_content = raw_content_slice;
            // TODO(port): lifetime — borrows source.contents
            self.string_literal_raw_format = StringLiteralRawFormat::Ascii;
        }
        Ok(())
    }

    pub fn expect_jsx_element_child(&mut self, token: T) -> Result<(), Error> {
        self.assert_not_json();

        if self.token != token {
            self.expected(token)?;
        }

        self.next_jsx_element_child()
    }

    pub fn next_jsx_element_child(&mut self) -> Result<(), Error> {
        self.assert_not_json();

        self.has_newline_before = false;
        let original_start = self.end;

        loop {
            self.start = self.end;
            self.token = T::t_end_of_file;

            match self.code_point {
                -1 => {
                    self.token = T::t_end_of_file;
                }
                c if c == b'{' as i32 => {
                    self.step();
                    self.token = T::t_open_brace;
                }
                c if c == b'<' as i32 => {
                    self.step();
                    self.token = T::t_less_than;
                }
                _ => {
                    let mut needs_fixing = false;

                    'string_literal: loop {
                        match self.code_point {
                            -1 => {
                                self.syntax_error()?;
                            }
                            c if c == b'&' as i32
                                || c == b'\r' as i32
                                || c == b'\n' as i32
                                || c == 0x2028
                                || c == 0x2029 =>
                            {
                                needs_fixing = true;
                                self.step();
                            }
                            c if c == b'{' as i32 || c == b'<' as i32 => {
                                break 'string_literal;
                            }
                            _ => {
                                // Non-ASCII strings need the slow path
                                needs_fixing = needs_fixing || self.code_point >= 0x80;
                                self.step();
                            }
                        }
                    }

                    self.token = T::t_string_literal;
                    let raw_content_slice =
                        &self.source.contents[original_start..self.end];

                    if needs_fixing {
                        debug_assert!(self.temp_buffer_u16.is_empty());
                        let mut tmp = core::mem::take(&mut self.temp_buffer_u16);
                        tmp.reserve(raw_content_slice.len());
                        let res = self.fix_whitespace_and_decode_jsx_entities(
                            raw_content_slice,
                            &mut tmp,
                        );
                        if let Err(e) = res {
                            tmp.clear();
                            self.temp_buffer_u16 = tmp;
                            return Err(e);
                        }
                        let dup = self.allocator.alloc_slice_copy(&tmp);
                        // SAFETY: reinterpret arena-owned &[u16] as &[u8]; alignment 1, len*2 bytes
                        self.string_literal_raw_content = unsafe {
                            core::slice::from_raw_parts(
                                dup.as_ptr() as *const u8,
                                dup.len() * 2,
                            )
                        };
                        self.string_literal_raw_format = StringLiteralRawFormat::Utf16;

                        let was_empty = tmp.is_empty();
                        tmp.clear();
                        self.temp_buffer_u16 = tmp;

                        if was_empty {
                            self.has_newline_before = true;
                            continue;
                        }
                    } else {
                        self.string_literal_raw_content = raw_content_slice;
                        // TODO(port): lifetime — borrows source.contents
                        self.string_literal_raw_format = StringLiteralRawFormat::Ascii;
                    }
                }
            }

            break;
        }
        Ok(())
    }

    pub fn fix_whitespace_and_decode_jsx_entities(
        &mut self,
        text: &[u8],
        decoded: &mut Vec<u16>,
    ) -> Result<(), Error> {
        self.assert_not_json();

        let mut after_last_non_whitespace: Option<u32> = None;

        // Trim whitespace off the end of the first line
        let mut first_non_whitespace: Option<u32> = Some(0);

        let iterator = CodepointIterator::init(text);
        let mut cursor = strings::CodepointIterator::Cursor::default();

        while iterator.next(&mut cursor) {
            match cursor.c {
                c if c == b'\r' as i32
                    || c == b'\n' as i32
                    || c == 0x2028
                    || c == 0x2029 =>
                {
                    if first_non_whitespace.is_some()
                        && after_last_non_whitespace.is_some()
                    {
                        // Newline
                        if !decoded.is_empty() {
                            decoded.push(b' ' as u16);
                        }

                        // Trim whitespace off the start and end of lines in the middle
                        self.decode_jsx_entities(
                            &text[first_non_whitespace.unwrap() as usize
                                ..after_last_non_whitespace.unwrap() as usize],
                            decoded,
                        )?;
                    }

                    // Reset for the next line
                    first_non_whitespace = None;
                }
                c if c == b'\t' as i32 || c == b' ' as i32 => {}
                _ => {
                    // Check for unusual whitespace characters
                    if !is_whitespace(cursor.c) {
                        after_last_non_whitespace =
                            Some(cursor.i + cursor.width as u32);
                        if first_non_whitespace.is_none() {
                            first_non_whitespace = Some(cursor.i);
                        }
                    }
                }
            }
        }

        if let Some(start) = first_non_whitespace {
            if !decoded.is_empty() {
                decoded.push(b' ' as u16);
            }

            self.decode_jsx_entities(&text[start as usize..text.len()], decoded)?;
        }
        Ok(())
    }

    fn maybe_decode_jsx_entity(
        &mut self,
        text: &[u8],
        cursor: &mut strings::CodepointIterator::Cursor,
    ) {
        self.assert_not_json();

        if let Some(length) = strings::index_of_char(
            &text[cursor.width as usize + cursor.i as usize..],
            b';',
        ) {
            let end = cursor.width as usize + cursor.i as usize;
            let entity = &text[end..end + length];
            if entity[0] == b'#' {
                let mut number = &entity[1..entity.len()];
                let mut base: u8 = 10;
                if number.len() > 1 && number[0] == b'x' {
                    number = &number[1..number.len()];
                    base = 16;
                }

                // PORT NOTE: std.fmt.parseInt(i32, ..) — bytes-based parser; source bytes are
                // not guaranteed UTF-8 so we never round-trip through &str (PORTING.md §Strings).
                cursor.c = match bun_str::strings::parse_int::<i32>(number, u32::from(base)) {
                    Ok(v) => v,
                    Err(e) => 'brk: {
                        use bun_str::strings::ParseIntError;
                        match e {
                            ParseIntError::InvalidCharacter => {
                                self.add_error(
                                    self.start,
                                    format_args!(
                                        "Invalid JSX entity escape: {}",
                                        bstr::BStr::new(entity)
                                    ),
                                    false,
                                );
                            }
                            ParseIntError::Overflow => {
                                self.add_error(
                                    self.start,
                                    format_args!(
                                        "JSX entity escape is too big: {}",
                                        bstr::BStr::new(entity)
                                    ),
                                    false,
                                );
                            }
                            _ => {}
                        }
                        break 'brk strings::UNICODE_REPLACEMENT;
                    }
                };

                cursor.i += u32::try_from(length).unwrap() + 1;
                cursor.width = 1;
            } else if let Some(ent) = tables::jsxEntity::get(entity) {
                cursor.c = ent;
                cursor.i += u32::try_from(length).unwrap() + 1;
            }
        }
    }

    pub fn decode_jsx_entities(
        &mut self,
        text: &[u8],
        out: &mut Vec<u16>,
    ) -> Result<(), Error> {
        self.assert_not_json();

        let iterator = CodepointIterator::init(text);
        let mut cursor = strings::CodepointIterator::Cursor::default();

        while iterator.next(&mut cursor) {
            if cursor.c == b'&' as i32 {
                self.maybe_decode_jsx_entity(text, &mut cursor);
            }

            if cursor.c <= 0xFFFF {
                out.push(u16::try_from(cursor.c).unwrap());
            } else {
                cursor.c -= 0x10000;
                out.reserve(2);
                // PERF(port): was assume_capacity (raw ptr write + len bump in Zig)
                out.push(
                    ((0xD800i32 + ((cursor.c >> 10) & 0x3FF)) as u32) as u16,
                );
                out.push(((0xDC00i32 + (cursor.c & 0x3FF)) as u32) as u16);
            }
        }
        Ok(())
    }

    pub fn expect_inside_jsx_element(&mut self, token: T) -> Result<(), Error> {
        self.assert_not_json();

        if self.token != token {
            self.expected(token)?;
            return Err(Error::SyntaxError);
        }

        self.next_inside_jsx_element()
    }

    pub fn expect_inside_jsx_element_with_name(
        &mut self,
        token: T,
        name: &[u8],
    ) -> Result<(), Error> {
        self.assert_not_json();

        if self.token != token {
            self.expected_string(name)?;
            return Err(Error::SyntaxError);
        }

        self.next_inside_jsx_element()
    }

    fn scan_reg_exp_validate_and_step(&mut self) -> Result<(), Error> {
        self.assert_not_json();

        if self.code_point == b'\\' as i32 {
            self.step();
        }

        match self.code_point {
            c if c == b'\r' as i32
                || c == b'\n' as i32
                || c == 0x2028
                || c == 0x2029 =>
            {
                // Newlines aren't allowed in regular expressions
                self.syntax_error()?;
            }
            -1 => {
                // EOF
                self.syntax_error()?;
            }
            _ => {
                self.step();
            }
        }
        Ok(())
    }

    pub fn rescan_close_brace_as_template_token(&mut self) -> Result<(), Error> {
        self.assert_not_json();

        if self.token != T::t_close_brace {
            self.expected(T::t_close_brace)?;
        }

        self.rescan_close_brace_as_template_token = true;
        self.code_point = b'`' as i32;
        self.current = self.end;
        self.end -= 1;
        self.next()?;
        self.rescan_close_brace_as_template_token = false;
        Ok(())
    }

    pub fn raw_template_contents(&mut self) -> &'a [u8] {
        self.assert_not_json();

        let mut text: &[u8] = b"";

        match self.token {
            T::t_no_substitution_template_literal | T::t_template_tail => {
                text = &self.source.contents[self.start + 1..self.end - 1];
            }
            T::t_template_middle | T::t_template_head => {
                text = &self.source.contents[self.start + 1..self.end - 2];
            }
            _ => {}
        }

        if strings::index_of_char(text, b'\r').is_none() {
            // TODO(port): lifetime — borrows source.contents
            // SAFETY: see raw()
            return unsafe {
                core::slice::from_raw_parts(text.as_ptr(), text.len())
            };
        }

        // From the specification:
        //
        // 11.8.6.1 Static Semantics: TV and TRV
        //
        // TV excludes the code units of LineContinuation while TRV includes
        // them. <CR><LF> and <CR> LineTerminatorSequences are normalized to
        // <LF> for both TV and TRV. An explicit EscapeSequence is needed to
        // include a <CR> or <CR><LF> sequence.
        // TODO(port): MutableString — using arena-backed Vec<u8> here.
        let mut bytes: Vec<u8> = text.to_vec();
        let mut end: usize = 0;
        let mut i: usize = 0;
        let mut c: u8;
        while i < bytes.len() {
            c = bytes[i];
            i += 1;

            if c == b'\r' {
                // Convert '\r\n' into '\n'
                if i < bytes.len() && bytes[i] == b'\n' {
                    i += 1;
                }

                // Convert '\r' into '\n'
                c = b'\n';
            }

            bytes[end] = c;
            end += 1;
        }

        bytes.truncate(end);
        self.allocator.alloc_slice_copy(&bytes)
        // PERF(port): Zig used MutableString.toOwnedSliceLength — extra copy here.
    }

    fn parse_numeric_literal_or_dot(&mut self) -> Result<(), Error> {
        // Number or dot;
        let first = self.code_point;
        self.step();

        // Dot without a digit after it;
        if first == b'.' as i32
            && (self.code_point < b'0' as i32 || self.code_point > b'9' as i32)
        {
            // "..."
            if (self.code_point == b'.' as i32
                && self.current < self.source.contents.len())
                && self.source.contents[self.current] == b'.'
            {
                self.step();
                self.step();
                self.token = T::t_dot_dot_dot;
                return Ok(());
            }

            // "."
            self.token = T::t_dot;
            return Ok(());
        }

        let mut underscore_count: usize = 0;
        let mut last_underscore_end: usize = 0;
        let mut has_dot_or_exponent = first == b'.' as i32;
        let mut base: f32 = 0.0;
        self.is_legacy_octal_literal = false;

        // Assume this is a number, but potentially change to a bigint later;
        self.token = T::t_numeric_literal;

        // Check for binary, octal, or hexadecimal literal;
        if first == b'0' as i32 {
            match self.code_point {
                c if c == b'b' as i32 || c == b'B' as i32 => {
                    base = 2.0;
                }
                c if c == b'o' as i32 || c == b'O' as i32 => {
                    base = 8.0;
                }
                c if c == b'x' as i32 || c == b'X' as i32 => {
                    base = 16.0;
                }
                c if (b'0' as i32..=b'7' as i32).contains(&c) || c == b'_' as i32 => {
                    base = 8.0;
                    self.is_legacy_octal_literal = true;
                }
                _ => {}
            }
        }

        if base != 0.0 {
            // Integer literal;
            let mut is_first = true;
            let mut is_invalid_legacy_octal_literal = false;
            self.number = 0.0;
            if !self.is_legacy_octal_literal {
                self.step();
            }

            'integer_literal: loop {
                match self.code_point {
                    c if c == b'_' as i32 => {
                        // Cannot have multiple underscores in a row;
                        if last_underscore_end > 0 && self.end == last_underscore_end + 1
                        {
                            self.syntax_error()?;
                        }

                        // The first digit must exist;
                        if is_first || self.is_legacy_octal_literal {
                            self.syntax_error()?;
                        }

                        last_underscore_end = self.end;
                        underscore_count += 1;
                    }

                    c if c == b'0' as i32 || c == b'1' as i32 => {
                        self.number = self.number * base as f64
                            + float64(self.code_point - b'0' as i32);
                    }

                    c if (b'2' as i32..=b'7' as i32).contains(&c) => {
                        if base == 2.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base as f64
                            + float64(self.code_point - b'0' as i32);
                    }
                    c if c == b'8' as i32 || c == b'9' as i32 => {
                        if self.is_legacy_octal_literal {
                            is_invalid_legacy_octal_literal = true;
                        } else if base < 10.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base as f64
                            + float64(self.code_point - b'0' as i32);
                    }
                    c if (b'A' as i32..=b'F' as i32).contains(&c) => {
                        if base != 16.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base as f64
                            + float64(self.code_point + 10 - b'A' as i32);
                    }
                    c if (b'a' as i32..=b'f' as i32).contains(&c) => {
                        if base != 16.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base as f64
                            + float64(self.code_point + 10 - b'a' as i32);
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
                self.code_point == b'n' as i32 && !has_dot_or_exponent;

            // Slow path: do we need to re-scan the input as text?
            if is_big_integer_literal || is_invalid_legacy_octal_literal {
                let text = self.raw();

                // Can't use a leading zero for bigint literals;
                if is_big_integer_literal && self.is_legacy_octal_literal {
                    self.syntax_error()?;
                }

                // Filter out underscores;
                if underscore_count > 0 {
                    let bytes = self
                        .allocator
                        .alloc_slice_fill_default::<u8>(text.len() - underscore_count);
                    let mut i: usize = 0;
                    for &char in text {
                        if char != b'_' {
                            bytes[i] = char;
                            i += 1;
                        }
                    }
                    // Note: Zig discards `bytes` here too (bug-compatible).
                }

                // Store bigints as text to avoid precision loss;
                if is_big_integer_literal {
                    self.identifier = text;
                } else if is_invalid_legacy_octal_literal {
                    // TODO(port): std.fmt.parseFloat — bytes-based; using bun_core::parse_double
                    match bun_core::parse_double(text) {
                        Ok(num) => {
                            self.number = num;
                        }
                        Err(_) => {
                            self.add_syntax_error(
                                self.start,
                                format_args!(
                                    "Invalid number {}",
                                    bstr::BStr::new(text)
                                ),
                            )?;
                        }
                    }
                }
            }
        } else {
            // Floating-point literal;
            let is_invalid_legacy_octal_literal = first == b'0' as i32
                && (self.code_point == b'8' as i32 || self.code_point == b'9' as i32);

            // Initial digits;
            loop {
                if self.code_point < b'0' as i32 || self.code_point > b'9' as i32 {
                    if self.code_point != b'_' as i32 {
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
            if first != b'.' as i32 && self.code_point == b'.' as i32 {
                // An underscore must not come last;
                if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                    self.end -= 1;
                    self.syntax_error()?;
                }

                has_dot_or_exponent = true;
                self.step();
                if self.code_point == b'_' as i32 {
                    self.syntax_error()?;
                }
                loop {
                    if self.code_point < b'0' as i32 || self.code_point > b'9' as i32 {
                        if self.code_point != b'_' as i32 {
                            break;
                        }

                        // Cannot have multiple underscores in a row;
                        if last_underscore_end > 0
                            && self.end == last_underscore_end + 1
                        {
                            self.syntax_error()?;
                        }

                        last_underscore_end = self.end;
                        underscore_count += 1;
                    }
                    self.step();
                }
            }

            // Exponent;
            if self.code_point == b'e' as i32 || self.code_point == b'E' as i32 {
                // An underscore must not come last;
                if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                    self.end -= 1;
                    self.syntax_error()?;
                }

                has_dot_or_exponent = true;
                self.step();
                if self.code_point == b'+' as i32 || self.code_point == b'-' as i32 {
                    self.step();
                }
                if self.code_point < b'0' as i32 || self.code_point > b'9' as i32 {
                    self.syntax_error()?;
                }
                loop {
                    if self.code_point < b'0' as i32 || self.code_point > b'9' as i32 {
                        if self.code_point != b'_' as i32 {
                            break;
                        }

                        // Cannot have multiple underscores in a row;
                        if last_underscore_end > 0
                            && self.end == last_underscore_end + 1
                        {
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
                // TODO(port): allocator routing — Zig uses lexer.allocator.alloc
                let bytes = self
                    .allocator
                    .alloc_slice_fill_default::<u8>(text.len() - underscore_count);
                for &char in text {
                    if char != b'_' {
                        bytes[i] = char;
                        i += 1;
                    }
                }
                text = bytes;
                // Note: Zig's else-branch ("Out of Memory Wah Wah Wah") is unreachable
                // with infallible bump alloc.
            }

            if self.code_point == b'n' as i32 && !has_dot_or_exponent {
                // The only bigint literal that can start with 0 is "0n"
                if text.len() > 1 && first == b'0' as i32 {
                    self.syntax_error()?;
                }

                // Store bigints as text to avoid precision loss;
                self.identifier = text;
            } else if !has_dot_or_exponent && self.end - self.start < 10 {
                // Parse a 32-bit integer (very fast path);
                let mut number: u32 = 0;
                for &c in text {
                    number = number * 10 + u32::from(c - b'0');
                }
                self.number = number as f64;
            } else {
                // Parse a double-precision floating-point number
                match bun_core::parse_double(text) {
                    Ok(num) => {
                        self.number = num;
                    }
                    Err(_) => {
                        self.add_syntax_error(
                            self.start,
                            format_args!("Invalid number"),
                        )?;
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
        if self.code_point == b'n' as i32 && !has_dot_or_exponent {
            self.token = T::t_big_integer_literal;
            self.step();
        }

        // Identifiers can't occur immediately after numbers;
        if is_identifier_start(self.code_point) {
            self.syntax_error()?;
        }
        Ok(())
    }
} // end impl LexerType

// `deinit` → `Drop`: only frees the three growable buffers, which `Vec` drops automatically.
// No explicit `impl Drop` needed.

/// `pub const Lexer = NewLexer(.{});`
pub type Lexer<'a> =
    LexerType<'a, false, false, false, false, false, true, false, false>;

#[inline]
pub fn is_identifier_start(codepoint: i32) -> bool {
    js_identifier::is_identifier_start(codepoint)
}
#[inline]
pub fn is_identifier_continue(codepoint: i32) -> bool {
    js_identifier::is_identifier_part(codepoint)
}

pub fn is_whitespace(codepoint: CodePoint) -> bool {
    matches!(
        codepoint,
        0x000B // line tabulation
            | 0x0009 // character tabulation
            | 0x000C // form feed
            | 0x0020 // space
            | 0x00A0 // no-break space
            // Unicode "Space_Separator" code points
            | 0x1680 // ogham space mark
            | 0x2000 // en quad
            | 0x2001 // em quad
            | 0x2002 // en space
            | 0x2003 // em space
            | 0x2004 // three-per-em space
            | 0x2005 // four-per-em space
            | 0x2006 // six-per-em space
            | 0x2007 // figure space
            | 0x2008 // punctuation space
            | 0x2009 // thin space
            | 0x200A // hair space
            | 0x202F // narrow no-break space
            | 0x205F // medium mathematical space
            | 0x3000 // ideographic space
            | 0xFEFF // zero width non-breaking space
    )
}

pub fn is_identifier(text: &[u8]) -> bool {
    if text.is_empty() {
        return false;
    }

    let iter = CodepointIterator { bytes: text, i: 0 };
    let mut cursor = strings::CodepointIterator::Cursor::default();
    if !iter.next(&mut cursor) {
        return false;
    }

    if !is_identifier_start(cursor.c) {
        return false;
    }

    while iter.next(&mut cursor) {
        if !is_identifier_continue(cursor.c) {
            return false;
        }
    }

    true
}

pub fn is_identifier_utf16(text: &[u16]) -> bool {
    let n = text.len();
    if n == 0 {
        return false;
    }

    let mut i: usize = 0;
    while i < n {
        let is_start = i == 0;
        let mut codepoint = text[i] as CodePoint;
        i += 1;

        if (0xD800..=0xDBFF).contains(&codepoint) && i < n {
            let surrogate = text[i] as CodePoint;
            if (0xDC00..=0xDFFF).contains(&surrogate) {
                codepoint = (codepoint << 10) + surrogate
                    + (0x10000 - (0xD800 << 10) - 0xDC00);
                i += 1;
            }
        }
        if is_start {
            if !is_identifier_start(codepoint) {
                return false;
            }
        } else {
            if !is_identifier_continue(codepoint) {
                return false;
            }
        }
    }

    true
}

pub fn range_of_identifier(source: &Source, loc: Loc) -> Range {
    let contents = &source.contents;
    if loc.start == -1 || usize::try_from(loc.start).unwrap() >= contents.len() {
        return Range::NONE;
    }

    let iter = CodepointIterator::init(&contents[loc.to_usize()..]);
    let mut cursor = strings::CodepointIterator::Cursor::default();

    let mut r = Range { loc, len: 0 };
    if iter.bytes.is_empty() {
        return r;
    }
    let text = iter.bytes;
    let end = u32::try_from(text.len()).unwrap();

    if !iter.next(&mut cursor) {
        return r;
    }

    // Handle private names
    if cursor.c == b'#' as i32 {
        if !iter.next(&mut cursor) {
            r.len = 1;
            return r;
        }
    }

    if is_identifier_start(cursor.c) || cursor.c == b'\\' as i32 {
        while iter.next(&mut cursor) {
            if cursor.c == b'\\' as i32 {
                // Search for the end of the identifier

                // Skip over bracketed unicode escapes such as "\u{10000}"
                if cursor.i + 2 < end
                    && text[cursor.i as usize + 1] == b'u'
                    && text[cursor.i as usize + 2] == b'{'
                {
                    cursor.i += 2;
                    while cursor.i < end {
                        if text[cursor.i as usize] == b'}' {
                            cursor.i += 1;
                            break;
                        }
                        cursor.i += 1;
                    }
                }
            } else if !is_identifier_continue(cursor.c) {
                r.len = i32::try_from(cursor.i).unwrap();
                return r;
            }
        }

        r.len = i32::try_from(cursor.i).unwrap();
    }

    // const offset = @intCast(usize, loc.start);
    // var i: usize = 0;
    // for (text) |c| {
    //     if (isIdentifierStart(@as(CodePoint, c))) {
    //         for (source.contents[offset + i ..]) |c_| {
    //             if (!isIdentifierContinue(c_)) {
    //                 r.len = std.math.lossyCast(i32, i);
    //                 return r;
    //             }
    //             i += 1;
    //         }
    //     }
    //
    //     i += 1;
    // }

    r
}

#[inline]
fn float64(num: i32) -> f64 {
    num as f64
}

pub fn is_latin1_identifier<B: AsRef<[u8]>>(name: B) -> bool {
    // TODO(port): Zig is generic over `Buffer` (could be []const u8 or []const u16);
    // this port handles the byte case. Phase B may add a u16 overload if needed.
    let name = name.as_ref();
    if name.is_empty() {
        return false;
    }

    match name[0] {
        b'a'..=b'z' | b'A'..=b'Z' | b'$' | b'_' => {}
        _ => return false,
    }

    if name.len() > 1 {
        for &c in &name[1..] {
            match c {
                b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'$' | b'_' => {}
                _ => return false,
            }
        }
    }

    true
}

fn latin1_identifier_continue_length(name: &[u8]) -> usize {
    // We don't use SIMD for this because the input will be very short.
    latin1_identifier_continue_length_scalar(name)
}

pub fn latin1_identifier_continue_length_scalar(name: &[u8]) -> usize {
    for (i, &c) in name.iter().enumerate() {
        match c {
            b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'$' | b'_' => {}
            _ => return i,
        }
    }

    name.len()
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PragmaArg {
    NoSpaceFirst,
    SkipSpaceFirst,
}

impl PragmaArg {
    pub fn is_newline(c: CodePoint) -> bool {
        c == b'\r' as i32 || c == b'\n' as i32 || c == 0x2028 || c == 0x2029
    }

    // These can be extremely long, so we use SIMD.
    /// "//# sourceMappingURL=data:/adspaoksdpkz"
    ///                       ^^^^^^^^^^^^^^^^^^
    pub fn scan_source_mapping_url_value(
        start: usize,
        offset_for_errors: usize,
        chunk: &[u8],
        result: &mut Option<js_ast::Span>,
    ) -> usize {
        const PREFIX: u32 = " sourceMappingURL=".len() as u32;
        let url_and_rest_of_code = &chunk[PREFIX as usize..]; // Slice containing only the potential argument

        let url_len: usize = 'brk: {
            if let Some(delimiter_pos_in_arg) =
                strings::index_of_space_or_newline_or_non_ascii(url_and_rest_of_code, 0)
            {
                // SIMD found the delimiter at index 'delimiter_pos_in_arg' relative to url start.
                // The argument's length is exactly this index.
                break 'brk delimiter_pos_in_arg;
            } else {
                // SIMD found no delimiter in the entire url.
                // The argument is the whole chunk.
                break 'brk url_and_rest_of_code.len();
            }
        };

        // Now we have the correct argument length (url_len) and the argument text.
        let url = &url_and_rest_of_code[0..url_len];

        // Calculate absolute start location of the argument
        let absolute_arg_start = start + offset_for_errors + PREFIX as usize;

        *result = Some(js_ast::Span {
            range: Range {
                len: i32::try_from(url_len).unwrap(), // Correct length
                loc: Loc {
                    start: i32::try_from(absolute_arg_start).unwrap(),
                }, // Correct start
            },
            text: url,
            // TODO(port): lifetime — js_ast::Span.text borrows source/chunk
        });

        // Return total length consumed from the start of the chunk
        PREFIX as usize + url_len // Correct total length
    }

    pub fn scan(
        kind: PragmaArg,
        offset_: usize,
        pragma: &[u8],
        text_: &[u8],
        allow_newline: bool,
    ) -> Option<js_ast::Span> {
        let mut text = &text_[pragma.len()..];
        let mut iter = CodepointIterator::init(text);

        let mut cursor = strings::CodepointIterator::Cursor::default();
        if !iter.next(&mut cursor) {
            return None;
        }

        let mut start: u32 = 0;

        // One or more whitespace characters
        if kind == PragmaArg::SkipSpaceFirst {
            if !is_whitespace(cursor.c) {
                return None;
            }

            while is_whitespace(cursor.c) {
                if !iter.next(&mut cursor) {
                    break;
                }
            }
            start = cursor.i;
            text = &text[cursor.i as usize..];
            cursor = strings::CodepointIterator::Cursor::default();
            iter = CodepointIterator::init(text);
            let _ = iter.next(&mut cursor);
        }

        let mut i: usize = 0;
        while !is_whitespace(cursor.c)
            && (!allow_newline || !Self::is_newline(cursor.c))
        {
            i += cursor.width as usize;
            if i >= text.len() {
                break;
            }

            if !iter.next(&mut cursor) {
                break;
            }
        }

        Some(js_ast::Span {
            range: Range {
                len: i32::try_from(i).unwrap(),
                loc: Loc {
                    start: i32::try_from(
                        start
                            + u32::try_from(offset_).unwrap()
                            + u32::try_from(pragma.len()).unwrap(),
                    )
                    .unwrap(),
                },
            },
            text: &text[0..i],
            // TODO(port): lifetime — js_ast::Span.text borrows input chunk
        })
    }
}

fn skip_to_interesting_character_in_multiline_comment(text_: &[u8]) -> Option<u32> {
    // PERF(port): Zig uses portable @Vector SIMD here. Rust port uses scalar; Phase B
    // should swap to bun_highway or core::simd. Logic preserved (returns offset of first
    // '*' / '\r' / '\n' / non-ASCII byte, truncated to chunks of `ascii_vector_size`).
    // TODO(port): SIMD reimplementation
    let vsize = strings::ASCII_VECTOR_SIZE;
    let text_end_len = text_.len() & !(vsize - 1);
    debug_assert!(text_end_len % vsize == 0);
    debug_assert!(text_end_len <= text_.len());

    let mut off: usize = 0;
    while off < text_end_len {
        let chunk = &text_[off..off + vsize];
        for (j, &b) in chunk.iter().enumerate() {
            if b > 127 || b == b'*' || b == b'\r' || b == b'\n' {
                debug_assert!(j < vsize);
                return Some((off + j) as u32);
            }
        }
        off += vsize;
    }

    Some(off as u32)
}

fn index_of_interesting_character_in_string_literal(
    text_: &[u8],
    quote: u8,
) -> Option<usize> {
    bun_highway::index_of_interesting_character_in_string_literal(text_, quote)
}

struct InvalidEscapeSequenceFormatter {
    code_point: i32,
}

impl fmt::Display for InvalidEscapeSequenceFormatter {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.code_point {
            c if c == b'"' as i32 => {
                writer.write_str("Unexpected escaped double quote '\"'")
            }
            c if c == b'\'' as i32 => {
                writer.write_str("Unexpected escaped single quote \"'\"")
            }
            c if c == b'`' as i32 => writer.write_str("Unexpected escaped backtick '`'"),
            c if c == b'\\' as i32 => {
                writer.write_str("Unexpected escaped backslash '\\'")
            }
            _ => writer.write_str("Unexpected escape sequence"),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/lexer.zig (3401 lines)
//   confidence: medium
//   todos:      34
//   notes:      8-way const-generic LexerType; 'a lifetime for log+source borrows is approximate (raw()/identifier alias source.contents); restore() reshaped field-by-field; SIMD multiline-comment scanner is scalar fallback; arena allocator routing needs Phase B audit; FakeArrayList16 dropped (dead in Zig source).
// ──────────────────────────────────────────────────────────────────────────
