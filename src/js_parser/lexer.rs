//! JavaScript/JSON lexer.

use core::fmt;

use bun_ast as js_ast;
use bun_ast::lexer_tables as tables;
use bun_ast::{LexerLog, Loc, Log, Range, Source};
use bun_core::fmt::hex_digit_value_u32;
use bun_core::strings;
use bun_core::strings::CodepointIterator;
use bun_core::{Environment, feature_flags as FeatureFlags};
use identifier as js_identifier;
// MOVE-IN: Indentation now lives in this crate (was bun_js_printer::Options::Indentation).
use bun_alloc::Arena;
use bun_ast::{Indentation, IndentationCharacter};

// Unicode ID-Start/ID-Continue tables moved DOWN to `bun_core` (pure data;
// no upward deps) so `bun_core::lexer` / `MutableString` get full coverage
// without a `bun_js_parser` dep. Re-export to preserve the public path.
pub use bun_core::identifier;

pub type CodePoint = i32;
type JavascriptString<'s> = &'s [u16];

pub use tables::{
    KEYWORDS as Keywords, PropertyModifierKeyword,
    STRICT_MODE_RESERVED_WORDS as StrictModeReservedWords, T, TOKEN_TO_STRING as tokenToString,
    TypescriptStmtKeyword, is_strict_mode_reserved_word, is_type_script_accessibility_modifier,
    keyword,
};

#[inline]
#[allow(non_snake_case)]
fn tokenToString_get(token: T) -> &'static [u8] {
    tokenToString[token]
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
    // `Span.text` is a `StoreStr`; `.len()` via Deref<[u8]>.
    pub fn jsx(&self) -> Option<js_ast::Span> {
        if self._jsx.text.len() > 0 {
            Some(self._jsx)
        } else {
            None
        }
    }
    pub fn jsx_frag(&self) -> Option<js_ast::Span> {
        if self._jsx_frag.text.len() > 0 {
            Some(self._jsx_frag)
        } else {
            None
        }
    }
    pub fn jsx_runtime(&self) -> Option<js_ast::Span> {
        if self._jsx_runtime.text.len() > 0 {
            Some(self._jsx_runtime)
        } else {
            None
        }
    }
    pub fn jsx_import_source(&self) -> Option<js_ast::Span> {
        if self._jsx_import_source.text.len() > 0 {
            Some(self._jsx_import_source)
        } else {
            None
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
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

/// The lexer is generic over the eight const bools of the option set.
///
/// `Lexer` (below) is the default instantiation.
///
/// nightly-2025-12-10 rejects field projection (`J.is_json`) on a
/// `const J: JSONOptions` parameter inside a generic-const expression
/// ("overly complex generic constant"), even with `generic_const_exprs`.
/// The option set is therefore modeled as a *type* parameter
/// implementing [`JsonOptionsT`], whose associated consts *are* accepted in
/// const-argument position under `generic_const_exprs`. Callers define a ZST
/// per option set and `impl JsonOptionsT for It { const IS_JSON: bool = true; … }`.
pub trait JsonOptionsT {
    const IS_JSON: bool = false;
    const ALLOW_COMMENTS: bool = false;
    const ALLOW_TRAILING_COMMAS: bool = false;
    const IGNORE_LEADING_ESCAPE_SEQUENCES: bool = false;
    const IGNORE_TRAILING_ESCAPE_SEQUENCES: bool = false;
    const JSON_WARN_DUPLICATE_KEYS: bool = true;
    const WAS_ORIGINALLY_MACRO: bool = false;
    const GUESS_INDENTATION: bool = false;

    /// Reify as a value.
    const OPTIONS: JSONOptions = JSONOptions {
        is_json: Self::IS_JSON,
        allow_comments: Self::ALLOW_COMMENTS,
        allow_trailing_commas: Self::ALLOW_TRAILING_COMMAS,
        ignore_leading_escape_sequences: Self::IGNORE_LEADING_ESCAPE_SEQUENCES,
        ignore_trailing_escape_sequences: Self::IGNORE_TRAILING_ESCAPE_SEQUENCES,
        json_warn_duplicate_keys: Self::JSON_WARN_DUPLICATE_KEYS,
        was_originally_macro: Self::WAS_ORIGINALLY_MACRO,
        guess_indentation: Self::GUESS_INDENTATION,
    };
}

/// `JSONOptions{}` — the default (non-JSON, JS-mode) option set.
pub struct DefaultJsonOptions;
impl JsonOptionsT for DefaultJsonOptions {}

// The `J: JsonOptionsT` bound on a type alias triggers the `type_alias_bounds`
// lint (bounds on aliases aren't enforced at use sites), but the bound is
// load-bearing here: the const expressions below need it in scope to resolve
// `<J as JsonOptionsT>::*`. Silence the lint locally.
#[allow(type_alias_bounds)]
pub type NewLexer<'a, J: JsonOptionsT = DefaultJsonOptions> = LexerType<
    'a,
    { <J as JsonOptionsT>::IS_JSON },
    { <J as JsonOptionsT>::ALLOW_COMMENTS },
    { <J as JsonOptionsT>::ALLOW_TRAILING_COMMAS },
    { <J as JsonOptionsT>::IGNORE_LEADING_ESCAPE_SEQUENCES },
    { <J as JsonOptionsT>::IGNORE_TRAILING_ESCAPE_SEQUENCES },
    { <J as JsonOptionsT>::JSON_WARN_DUPLICATE_KEYS },
    { <J as JsonOptionsT>::WAS_ORIGINALLY_MACRO },
    { <J as JsonOptionsT>::GUESS_INDENTATION },
>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Error {
    UTF8Fail,
    OutOfMemory,
    SyntaxError,
    UnexpectedSyntax,
    JSONStringsMustUseDoubleQuotes,
    ParserError,
    Backtrack,
}
bun_core::impl_tag_error!(Error);
bun_core::oom_from_alloc!(Error);

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

/// POD snapshot of all backtrack-relevant lexer state.
///
/// Backtracking can't snapshot the lexer with a full struct copy because
/// `LexerType` owns heap-backed buffers and a `Log` pointer. Instead, callers do:
///
/// ```ignore
/// let snap = p.lexer.snapshot();
/// /* speculative parse */
/// p.lexer.restore(&snap);
/// ```
///
/// This struct is `Copy` and intentionally excludes `log`, `source`, `arena`
/// (shared/unique borrows that never change across a backtrack) and the three
/// growable `Vec` buffers (captured as lengths only — `restore()` truncates).
#[derive(Clone, Copy)]
pub struct LexerSnapshot<'a> {
    pub current: usize,
    pub start: usize,
    pub end: usize,
    pub approximate_newline_count: usize,
    pub previous_backslash_quote_in_jsx: Range,
    pub token: T,
    pub has_newline_before: bool,
    pub has_pure_comment_before: bool,
    pub has_no_side_effect_comment_before: bool,
    pub has_react_hooks_suppression_before: bool,
    pub has_react_hooks_block_suppression: bool,
    pub preserve_all_comments_before: bool,
    pub is_legacy_octal_literal: bool,
    pub is_log_disabled: bool,
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
    pub string_literal_raw_content: &'a [u8],
    pub string_literal_start: usize,
    pub string_literal_raw_format: StringLiteralRawFormat,
    pub is_ascii_only: bool,
    pub track_comments: bool,
    pub track_react_suppressions: bool,
    pub indent_info: IndentInfo,
    // Vec buffer lengths — restore() truncates back to these.
    pub all_comments_len: usize,
    pub comments_to_preserve_before_len: usize,
}

/// The lexer struct produced by `NewLexer_`.
///
/// `'a` is the lifetime of the source contents (arena/source-owned slices like
/// `identifier` and `string_literal_raw_content` borrow from the source or from
/// the parser arena). The `Log` is *not* tied to `'a`; see the `log` field doc.
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
    /// Raw pointer to the caller-owned `Log`. The parser holds a second
    /// aliasing pointer to the same `Log`; Rust cannot store two `&mut Log`
    /// to the same allocation (Stacked-Borrows UB), so both the lexer and the
    /// parser keep `NonNull<Log>` and reborrow at use sites via `log()`. The
    /// `init*` constructors take a plain `&mut Log` (not tied to `'a`); the
    /// caller must keep the pointee alive for the lexer's lifetime — see
    /// `init_without_reading`.
    pub log: core::ptr::NonNull<Log>,
    pub source: &'a Source,
    /// Cached `source.contents()` slice. With `source: &'a Source` plus
    /// `Source.contents: Cow<'static,[u8]>`, every inlined `step()` was a
    /// 3-load dependent chain (`self.source` → Cow tag/ptr → Cow len) that
    /// LLVM could not hoist (perf-annotate showed `mov 0x70(%rbx),%rax` at
    /// ~8% of `next()` cycles). Caching the deref'd `&'a [u8]` here collapses
    /// that to a single fat-ptr field load — but a *struct field* load LLVM
    /// still won't hoist out of the token loop (perf-annotate of `next()`
    /// showed `mov 0x80(%rbx),%rsi` at ~7.7% of its samples). The hot paths
    /// therefore copy this into a local `let contents: &[u8]` once per
    /// `next()` / `scan_single_line_comment()` / `parse_string_literal()`
    /// call and thread it by value into every hot sub-scanner
    /// (`step_with()`, `next_codepoint_with()`, `parse_string_literal_inner()`,
    /// `parse_numeric_literal_or_dot()`), so the ptr+len stays in a register
    /// for the whole token loop. `source` is kept for
    /// error-reporting paths that need `path` / `identifier_name`.
    pub contents: &'a [u8],
    pub current: usize,
    pub start: usize,
    pub end: usize,
    pub approximate_newline_count: usize,
    pub previous_backslash_quote_in_jsx: Range,
    pub token: T,
    pub has_newline_before: bool,
    pub has_pure_comment_before: bool,
    pub has_no_side_effect_comment_before: bool,
    /// Set (and never cleared by `next()`) once an `eslint-disable[-next-line]`
    /// comment naming `react-hooks/rules-of-hooks` or `react-hooks/exhaustive-deps`
    /// has been scanned. The parser reads this at function-body close to set
    /// `flags::Function::HasReactHooksSuppression` / `E::Arrow::has_react_hooks_suppression`.
    pub has_react_hooks_suppression_before: bool,
    /// Sticky variant of the above: set when the suppression comment is a bare
    /// `eslint-disable` (no `-next-line` suffix). Never cleared by the
    /// parser, so it applies to every subsequent function in the file.
    pub has_react_hooks_block_suppression: bool,
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
    pub arena: &'a Arena,
    pub string_literal_raw_content: &'a [u8],
    pub string_literal_start: usize,
    pub string_literal_raw_format: StringLiteralRawFormat,
    pub temp_buffer_u16: Vec<u16>,

    /// Only used for JSON stringification when bundling.
    pub is_ascii_only: bool,
    pub track_comments: bool,
    pub track_react_suppressions: bool,
    pub all_comments: Vec<Range>,

    /// Only meaningful when `GUESS_INDENTATION` is set.
    pub indent_info: IndentInfo,
}

// Note: Rust macros must emit complete items; the macro now wraps the
// entire `impl { ... }` block instead of just the header.
macro_rules! lexer_impl_header {
    ($($body:tt)*) => {
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
        { $($body)* }
    };
}

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
> LexerLog<'a>
    for LexerType<
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
{
    type Err = Error;
    #[inline]
    fn log_mut(&mut self) -> &mut Log {
        // SAFETY: `self.log` is a non-null raw handle stored by the `init*`
        // constructors from a caller-supplied `&mut Log`; the caller must keep
        // the pointee alive and unaliased for the lexer's lifetime (see the
        // `log` field doc and `init_without_reading`). `&mut self` ensures no
        // overlapping reborrow exists for this call.
        unsafe { self.log.as_mut() }
    }
    #[inline]
    fn source(&self) -> &'a Source {
        self.source
    }
    #[inline]
    fn prev_error_loc_mut(&mut self) -> &mut Loc {
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
    fn syntax_err() -> Error {
        Error::SyntaxError
    }
}

lexer_impl_header! {
    /// Reborrow the shared `Log`. The `&self` receiver lets call sites pass
    /// other `self.*` fields as arguments without a borrow-checker conflict;
    /// callers must not hold two results of `log()` (or a result alongside the
    /// parser's `P::log()`) live at once.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn log(&self) -> &mut Log {
        // SAFETY: `self.log` is a non-null raw handle stored by the `init*`
        // constructors from a caller-supplied `&mut Log`; the caller must keep
        // the pointee alive and unaliased for the lexer's lifetime. Only one
        // `&mut Log` is materialized at a time — every call site is
        // `self.log().method(...)` with no overlap.
        unsafe { &mut *self.log.as_ptr() }
    }

    #[inline]
    pub fn loc(&self) -> Loc {
        bun_ast::usize2loc(self.start)
    }

    #[cold]
    pub fn add_range_error_with_notes(
        &mut self,
        r: Range,
        args: fmt::Arguments<'_>,
        notes: &[bun_ast::Data],
    ) -> Result<(), Error> {
        if self.is_log_disabled {
            return Ok(());
        }
        if self.prev_error_loc.eql(r.loc) {
            return Ok(());
        }

        // The Log API takes an owned `Box<[Data]>` here (error path only,
        // allocation cost is moot).
        let notes_owned: Box<[bun_ast::Data]> = notes.to_vec().into_boxed_slice();
        self.log()
            .add_range_error_fmt_with_notes(Some(self.source), r, notes_owned, args);
        self.prev_error_loc = r.loc;

        // if (panic) {
        //     return Error.ParserError;
        // }
        Ok(())
    }

    /// Capture a `Copy` snapshot of all backtrack-relevant state. See
    /// `LexerSnapshot` doc.
    pub fn snapshot(&self) -> LexerSnapshot<'a> {
        LexerSnapshot {
            current: self.current,
            start: self.start,
            end: self.end,
            approximate_newline_count: self.approximate_newline_count,
            previous_backslash_quote_in_jsx: self.previous_backslash_quote_in_jsx,
            token: self.token,
            has_newline_before: self.has_newline_before,
            has_pure_comment_before: self.has_pure_comment_before,
            has_no_side_effect_comment_before: self.has_no_side_effect_comment_before,
            has_react_hooks_suppression_before: self.has_react_hooks_suppression_before,
            has_react_hooks_block_suppression: self.has_react_hooks_block_suppression,
            preserve_all_comments_before: self.preserve_all_comments_before,
            is_legacy_octal_literal: self.is_legacy_octal_literal,
            is_log_disabled: self.is_log_disabled,
            code_point: self.code_point,
            identifier: self.identifier,
            jsx_pragma: self.jsx_pragma,
            source_mapping_url: self.source_mapping_url,
            number: self.number,
            rescan_close_brace_as_template_token: self.rescan_close_brace_as_template_token,
            prev_error_loc: self.prev_error_loc,
            prev_token_was_await_keyword: self.prev_token_was_await_keyword,
            await_keyword_loc: self.await_keyword_loc,
            fn_or_arrow_start_loc: self.fn_or_arrow_start_loc,
            regex_flags_start: self.regex_flags_start,
            string_literal_raw_content: self.string_literal_raw_content,
            string_literal_start: self.string_literal_start,
            string_literal_raw_format: self.string_literal_raw_format,
            is_ascii_only: self.is_ascii_only,
            track_comments: self.track_comments,
            track_react_suppressions: self.track_react_suppressions,
            indent_info: self.indent_info,
            all_comments_len: self.all_comments.len(),
            comments_to_preserve_before_len: self.comments_to_preserve_before.len(),
        }
    }

    /// Rewind to a prior `snapshot()`: copy each scalar field and
    /// truncate the Vecs to their snapshotted lengths. `log`/`source`/`arena`
    /// are left untouched.
    pub fn restore(&mut self, original: &LexerSnapshot<'a>) {
        // Keep this field list in sync with `snapshot()` and the Lexer struct fields.
        self.current = original.current;
        self.start = original.start;
        self.end = original.end;
        self.approximate_newline_count = original.approximate_newline_count;
        self.previous_backslash_quote_in_jsx = original.previous_backslash_quote_in_jsx;
        self.token = original.token;
        self.has_newline_before = original.has_newline_before;
        self.has_pure_comment_before = original.has_pure_comment_before;
        self.has_no_side_effect_comment_before = original.has_no_side_effect_comment_before;
        self.has_react_hooks_suppression_before = original.has_react_hooks_suppression_before;
        self.has_react_hooks_block_suppression = original.has_react_hooks_block_suppression;
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
        self.track_react_suppressions = original.track_react_suppressions;
        self.indent_info = original.indent_info;

        debug_assert!(self.all_comments.len() >= original.all_comments_len);
        debug_assert!(
            self.comments_to_preserve_before.len()
                >= original.comments_to_preserve_before_len
        );
        debug_assert!(self.temp_buffer_u16.is_empty());

        self.all_comments.truncate(original.all_comments_len);
        self.comments_to_preserve_before
            .truncate(original.comments_to_preserve_before_len);
    }

    /// Look ahead at the next n codepoints without advancing the iterator.
    /// If fewer than n codepoints are available, then return the remainder of the string.
    #[inline]
    fn peek(&self, n: usize) -> &'a [u8] {
        strings::peek_n_codepoints_wtf8(self.contents, self.current, n)
    }

    #[inline]
    pub fn is_identifier_or_keyword(&self) -> bool {
        (self.token as u32) >= (T::TIdentifier as u32)
    }

    // deinit → Drop (see impl Drop below)

    fn decode_escape_sequences(
        &mut self,
        start: usize,
        text: &[u8],
        buf: &mut Vec<u16>,
    ) -> Result<(), Error> {
        if IS_JSON {
            self.is_ascii_only = false;
        }

        let iterator = CodepointIterator::init(text);
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

                    // Convert '\r\n' into '\n'
                    let next_i: usize = iter.i as usize + 1;
                    iter.i += (next_i < text.len() && text[next_i] == b'\n') as u32;

                    // Convert '\r' into '\n'
                    buf.push(u16::from(b'\n'));
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
                            buf.push(0x08);
                            continue;
                        }
                        0x66 => {
                            buf.push(0x0C);
                            continue;
                        }
                        0x6E => {
                            buf.push(0x0A);
                            continue;
                        }
                        0x76 => {
                            // Vertical tab is invalid JSON
                            // We're going to allow it.
                            buf.push(0x0B);
                            continue;
                        }
                        0x74 => {
                            buf.push(0x09);
                            continue;
                        }
                        0x72 => {
                            buf.push(0x0D);
                            continue;
                        }

                        // legacy octal literals
                        0x30..=0x37 => {
                            let octal_start =
                                (iter.i as usize + width2 as usize).saturating_sub(2);
                            if IS_JSON {
                                self.end = (start + iter.i as usize)
                                    .saturating_sub(width2 as usize);
                                self.syntax_error()?;
                            }

                            // 1-3 digit octal
                            let mut is_bad = false;
                            let mut value: i64 = (c2 - 0x30) as i64;
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
                                0x30..=0x37 => {
                                    value = value * 8 + (c3 - 0x30) as i64;
                                    prev = iter;
                                    if !iterator.next(&mut iter) {
                                        return self.syntax_error();
                                    }

                                    let c4 = iter.c;
                                    match c4 {
                                        0x30..=0x37 => {
                                            let temp =
                                                value * 8 + (c4 - 0x30) as i64;
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
                                // `octal_start` is text-relative like `iter.i`;
                                // map back to absolute source position the same
                                // way every sibling error path does (e.g.
                                // `start + hex_start` in the `\u{}` branch).
                                self.add_range_error(
                                    Range {
                                        loc: Loc {
                                            start: i32::try_from(start + octal_start).expect("int cast"),
                                        },
                                        len: i32::try_from(
                                            iter.i as usize - octal_start,
                                        )
                                        .unwrap(),
                                    },
                                    format_args!("Invalid legacy octal literal"),
                                )
                                .expect("unreachable");
                            }
                        }
                        0x38 | 0x39 => {
                            iter.c = c2;
                        }
                        // 2-digit hexadecimal
                        0x78 => {
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
                                    self.end = (start + iter.i as usize)
                                        .saturating_sub(width3 as usize);
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
                                    self.end = (start + iter.i as usize)
                                        .saturating_sub(width3 as usize);
                                    return self.syntax_error();
                                }
                            }

                            iter.c = value;
                        }
                        0x75 => {
                            // We're going to make this an i64 so we don't risk integer overflows
                            // when people do weird things
                            let mut value: i64 = 0;

                            if !iterator.next(&mut iter) {
                                return self.syntax_error();
                            }
                            let mut c3 = iter.c;
                            let mut width3 = iter.width;

                            // variable-length
                            if c3 == 0x7B {
                                if IS_JSON {
                                    self.end = (start + iter.i as usize)
                                        .saturating_sub(width2 as usize);
                                    self.syntax_error()?;
                                }

                                // `iter.i` is the byte offset of `{` inside `text`;
                                // back up past `\` and `u` only. `width3` is the
                                // width of `{` itself, which `iter.i` already points
                                // at — subtracting it lands one character too early.
                                let hex_start = (iter.i as usize)
                                    .saturating_sub(width as usize)
                                    .saturating_sub(width2 as usize);
                                let mut is_first = true;
                                let mut is_out_of_range = false;
                                'variable_length: loop {
                                    if !iterator.next(&mut iter) {
                                        // Ran out of literal before the closing `}`.
                                        return self.syntax_error();
                                    }
                                    c3 = iter.c;

                                    if c3 == 0x7D {
                                        if is_first {
                                            self.end = (start + iter.i as usize)
                                                .saturating_sub(width3 as usize);
                                            return self.syntax_error();
                                        }
                                        break 'variable_length;
                                    }
                                    match hex_digit_value_u32(c3 as u32) {
                                        // Saturate: `is_out_of_range` is sticky, so any
                                        // digit count still reports the range error.
                                        Some(d) => value = value.saturating_mul(16) | d as i64,
                                        None => {
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
                                                (iter.i as usize).saturating_sub(hex_start),
                                            )
                                            .unwrap(),
                                        },
                                        format_args!(
                                            "Unicode escape sequence is out of range"
                                        ),
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
                                            self.end = (start + iter.i as usize)
                                                .saturating_sub(width3 as usize);
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
                        0x0D => {
                            if IS_JSON {
                                self.end = (start + iter.i as usize)
                                    .saturating_sub(width2 as usize);
                                self.syntax_error()?;
                            }

                            // Make sure Windows CRLF counts as a single newline
                            let next_i: usize = iter.i as usize + 1;
                            iter.i +=
                                (next_i < text.len() && text[next_i] == b'\n') as u32;

                            // Ignore line continuations. A line continuation is not an escaped newline.
                            continue;
                        }
                        0x0A | 0x2028 | 0x2029 => {
                            if IS_JSON {
                                self.end = (start + iter.i as usize)
                                    .saturating_sub(width2 as usize);
                                self.syntax_error()?;
                            }

                            // Ignore line continuations. A line continuation is not an escaped newline.
                            continue;
                        }
                        _ => {
                            if IS_JSON {
                                match c2 {
                                    0x22 | 0x5C | 0x2F => {}
                                    _ => {
                                        self.end = (start + iter.i as usize)
                                            .saturating_sub(width2 as usize);
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
                c => strings::push_codepoint_utf16(buf, c as u32),
            }
        }
        Ok(())
    }

    // PERF: heavy sub-scanner — the per-byte string body loop plus the
    // escape/`\r\n`/`</script` slow paths. Keep it *out* of `next()` so that
    // body stays small enough to partial-inline at the parser's call sites
    // (see the note on `next()`); `parse_string_literal::<QUOTE>` is the only
    // caller and stays `#[inline]`, so what folds into `next()` is just the
    // token-kind set + the call here.
    #[inline(never)]
    fn parse_string_literal_inner<const QUOTE: i32>(
        &mut self,
        contents: &[u8],
    ) -> Result<InnerStringLiteral, Error> {
        let mut suffix_len: u8 = if QUOTE == 0 { 0 } else { 1 };
        let mut needs_decode = false;
        'string_literal: loop {
            match self.code_point {
                0x5C => {
                    needs_decode = true;
                    self.step_with(contents);

                    // Handle Windows CRLF
                    if self.code_point == 0x0D && !IS_JSON {
                        self.step_with(contents);
                        if self.code_point == 0x0A {
                            self.step_with(contents);
                        }
                        continue 'string_literal;
                    }

                    if IS_JSON && IGNORE_TRAILING_ESCAPE_SEQUENCES {
                        if self.code_point == QUOTE
                            && self.current >= contents.len()
                        {
                            self.step_with(contents);
                            break;
                        }
                    }

                    match self.code_point {
                        // 0 cannot be in this list because it may be a legacy octal literal
                        0x60 | 0x27 | 0x22 | 0x5C =>
                        {
                            self.step_with(contents);
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

                0x0D => {
                    if QUOTE != 0x60 {
                        self.add_default_error(b"Unterminated string literal")?;
                    }

                    // Template literals require newline normalization
                    needs_decode = true;
                }

                0x0A => {
                    // Implicitly-quoted strings end when they reach a newline OR end of file
                    // This only applies to .env
                    match QUOTE {
                        0 => {
                            break 'string_literal;
                        }
                        0x60 => {}
                        _ => {
                            self.add_default_error(b"Unterminated string literal")?;
                        }
                    }
                }

                0x24 => {
                    if QUOTE == 0x60 {
                        self.step_with(contents);
                        if self.code_point == 0x7B {
                            suffix_len = 2;
                            self.step_with(contents);
                            self.token = if self.rescan_close_brace_as_template_token {
                                T::TTemplateMiddle
                            } else {
                                T::TTemplateHead
                            };
                            break 'string_literal;
                        }
                        continue 'string_literal;
                    }
                }
                // exit condition (const-generic param can't be a pattern; guard is fine —
                // the literal arms above still lower to a jump table)
                c if c == QUOTE => {
                    self.step_with(contents);
                    break;
                }

                _ => {
                    // Non-ASCII strings need the slow path
                    if self.code_point >= 0x80 {
                        needs_decode = true;
                    } else if IS_JSON && self.code_point < 0x20 {
                        self.syntax_error()?;
                    } else if (QUOTE == 0x22 || QUOTE == 0x27)
                        && Environment::IS_NATIVE
                    {
                        let remainder = &contents[self.current..];
                        if remainder.len() >= 4096 {
                            match index_of_interesting_character_in_string_literal(
                                remainder,
                                QUOTE as u8,
                            ) {
                                Some(off) => {
                                    self.current += off;
                                    self.end = self.current.saturating_sub(1);
                                    self.step_with(contents);
                                    continue;
                                }
                                None => {
                                    self.current += remainder.len();
                                    self.step_with(contents);
                                    continue;
                                }
                            }
                        }
                    }
                }
            }

            self.step_with(contents);
        }

        Ok(InnerStringLiteral::new(suffix_len, needs_decode))
    }

    // PERF: each `QUOTE` instantiation is single-caller from `next()`.
    #[inline]
    pub fn parse_string_literal<const QUOTE: i32>(&mut self) -> Result<(), Error> {
        if QUOTE != 0x60 {
            self.token = T::TStringLiteral;
        } else if self.rescan_close_brace_as_template_token {
            self.token = T::TTemplateTail;
        } else {
            self.token = T::TNoSubstitutionTemplateLiteral;
        }
        // quote is 0 when parsing JSON from .env
        // .env values may not always be quoted.
        // PERF: keep the source slice register-resident through the hot string
        // body loop — see `next_codepoint_with`.
        let contents: &'a [u8] = self.contents;
        self.step_with(contents);

        let string_literal_details = self.parse_string_literal_inner::<QUOTE>(contents)?;

        // Reset string literal
        let base = if QUOTE == 0 { self.start } else { self.start + 1 };
        let suffix_len = string_literal_details.suffix_len() as usize;
        let end_pos = if self.end >= suffix_len {
            self.end - suffix_len
        } else {
            self.end
        };
        let slice_end = contents.len().min(base.max(end_pos));
        self.string_literal_raw_content = &contents[base..slice_end];
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
            if QUOTE == 0x27 && IS_JSON {
                self.add_range_error(
                    self.range(),
                    format_args!("JSON strings must use double quotes"),
                )?;
            }
        }
        Ok(())
    }

    fn remaining(&self) -> &[u8] {
        &self.contents[self.current..]
    }

    /// Note: split into an `#[inline(always)]` ASCII/EOF fast path plus
    /// an outlined multibyte tail. `step()` is called from ~50 sites inside
    /// the giant `next()` switch and inlines into it; with the multibyte
    /// decode in the same body LLVM declined to inline `next_codepoint`
    /// (showing as a separate ~2.7% symbol). The fast path is now 4 insns
    /// (bounds cmp, load, cmp 0x80, store) so it folds into every `step()`
    /// site.
    ///
    /// PERF: takes `contents: &[u8]` by value (a `Copy` fat-ptr) instead of
    /// reloading `self.contents` from the struct. With `self.contents`, every
    /// inlined site re-emitted `mov 0x80(%rbx),%rsi` to fetch the slice ptr+len
    /// (perf-annotate of `next()` showed that single load at ~7.7% of `next()`
    /// samples) — LLVM couldn't prove the field load loop-invariant across the
    /// intervening `&mut self` writes. As a by-value SSA parameter it stays in
    /// a register for the whole token loop.
    /// Callers outside the hot loop use the thin `step()` wrapper
    /// below, which loads `self.contents` once.
    #[inline(always)]
    fn next_codepoint_with(&mut self, contents: &[u8]) -> CodePoint {
        let len = contents.len();
        if self.current >= len {
            self.end = len;
            return -1;
        }
        // SAFETY: `self.current < len` was checked immediately above.
        let first = unsafe { *contents.get_unchecked(self.current) };

        self.end = self.current;

        // ASCII fast path, lifted explicitly so the multibyte branch
        // is out of the per-byte hot loop entirely.
        if first < 0x80 {
            self.current += 1;
            return first as CodePoint;
        }

        strings::lexer_step::next_codepoint_multibyte(contents, &mut self.current, first)
    }

    /// PERF: `contents` threaded by value — see [`Self::next_codepoint_with`].
    #[inline]
    fn step_with(&mut self, contents: &[u8]) {
        self.code_point = self.next_codepoint_with(contents);

        // Track the approximate number of newlines in the file so we can preallocate
        // the line offset table in the printer for source maps. The line offset table
        // is the #1 highest allocation in the heap profile, so this is worth doing.
        // This count is approximate because it handles "\n" and "\r\n" (the common
        // cases) but not "\r" or " " or " ". Getting this wrong is harmless
        // because it's only a preallocation. The array will just grow if it's too small.
        self.approximate_newline_count += (self.code_point == 0x0A) as usize;
    }

    #[inline]
    pub fn step(&mut self) {
        let contents: &[u8] = self.contents;
        self.step_with(contents);
    }

    #[inline]
    pub fn expect(&mut self, token: T) -> Result<(), Error> {
        if self.token != token {
            self.expected(token)?;
        }
        self.next()
    }

    #[inline]
    pub fn expect_or_insert_semicolon(&mut self) -> Result<(), Error> {
        if self.token == T::TSemicolon
            || (!self.has_newline_before
                && self.token != T::TCloseBrace
                && self.token != T::TEndOfFile)
        {
            self.expect(T::TSemicolon)?;
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    pub fn add_unsupported_syntax_error(&mut self, msg: &[u8]) -> Result<(), Error> {
        self.add_error(
            self.end,
            format_args!("Unsupported syntax: {}", bstr::BStr::new(msg)),
        );
        Err(Error::SyntaxError)
    }

    // This is an edge case that doesn't really exist in the wild, so it doesn't
    // need to be as fast as possible — keep it fully out of line so it never
    // bloats `next()` (which dispatches here from the identifier arm).
    #[cold]
    #[inline(never)]
    pub fn scan_identifier_with_escapes(
        &mut self,
        kind: IdentifierKind,
    ) -> Result<ScanResult<'a>, Error> {
        let mut result = ScanResult {
            token: T::TEndOfFile,
            contents: b"".as_slice(),
        };
        // First pass: scan over the identifier to see how long it is
        loop {
            // Scan a unicode escape sequence. There is at least one because that's
            // what caused us to get on this slow path in the first place.
            if self.code_point == 0x5C {
                self.step();

                if self.code_point != 0x75 {
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
                if self.code_point == 0x7B {
                    // Variable-length
                    self.step();
                    while self.code_point != 0x7D {
                        match self.code_point {
                            0x30..=0x39 | 0x61..=0x66 | 0x41..=0x46 =>
                            {
                                self.step();
                            }
                            _ => self.syntax_error()?,
                        }
                    }

                    self.step();
                } else {
                    // Fixed-length
                    for _ in 0..4 {
                        match self.code_point {
                            0x30..=0x39 | 0x61..=0x66 | 0x41..=0x46 =>
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
        // Note: reshaped for borrowck — we move temp_buffer_u16 out, use it, then
        // clear and put it back (mirrors `defer clearRetainingCapacity()`).
        let mut tmp = core::mem::take(&mut self.temp_buffer_u16);
        tmp.reserve(original_text.len());
        let decode_res =
            self.decode_escape_sequences(self.start, original_text, &mut tmp);
        if let Err(e) = decode_res {
            tmp.clear();
            self.temp_buffer_u16 = tmp;
            return Err(e);
        }
        result.contents = self.utf16_to_string(&tmp);
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
                    loc: bun_ast::usize2loc(self.start),
                    len: i32::try_from(self.end - self.start).expect("int cast"),
                },
                format_args!(
                    "Invalid identifier: \"{}\"",
                    bstr::BStr::new(result.contents)
                ),
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
        result.token = if tables::keyword(result.contents).is_some() {
            T::TEscapedKeyword
        } else {
            T::TIdentifier
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
                );
            } else {
                self.add_error(
                    self.start,
                    format_args!(
                        "Expected \"{}\" but found \"{}\"",
                        bstr::BStr::new(keyword),
                        bstr::BStr::new(self.raw()),
                    ),
                );
            }
            return Err(Error::UnexpectedSyntax);
        }
        self.next()
    }

    pub fn maybe_expand_equals(&mut self) -> Result<(), Error> {
        match self.code_point {
            0x3E => {
                // "=" + ">" = "=>"
                self.token = T::TEqualsGreaterThan;
                self.step();
            }
            0x3D => {
                // "=" + "=" = "=="
                self.token = T::TEqualsEquals;
                self.step();

                if self.code_point == 0x3D {
                    // "=" + "==" = "==="
                    self.token = T::TEqualsEqualsEquals;
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
            T::TLessThan => {
                if IS_INSIDE_JSX_ELEMENT {
                    self.next_inside_jsx_element()?;
                } else {
                    self.next()?;
                }
            }
            T::TLessThanEquals => {
                self.token = T::TEquals;
                self.start += 1;
                self.maybe_expand_equals()?;
            }
            T::TLessThanLessThan => {
                self.token = T::TLessThan;
                self.start += 1;
            }
            T::TLessThanLessThanEquals => {
                self.token = T::TLessThanEquals;
                self.start += 1;
            }
            _ => {
                self.expected(T::TLessThan)?;
            }
        }
        Ok(())
    }

    pub fn expect_greater_than<const IS_INSIDE_JSX_ELEMENT: bool>(
        &mut self,
    ) -> Result<(), Error> {
        match self.token {
            T::TGreaterThan => {
                if IS_INSIDE_JSX_ELEMENT {
                    self.next_inside_jsx_element()?;
                } else {
                    self.next()?;
                }
            }

            T::TGreaterThanEquals => {
                self.token = T::TEquals;
                self.start += 1;
                self.maybe_expand_equals()?;
            }

            T::TGreaterThanGreaterThanEquals => {
                self.token = T::TGreaterThanEquals;
                self.start += 1;
            }

            T::TGreaterThanGreaterThanGreaterThanEquals => {
                self.token = T::TGreaterThanGreaterThanEquals;
                self.start += 1;
            }

            T::TGreaterThanGreaterThan => {
                self.token = T::TGreaterThan;
                self.start += 1;
            }

            T::TGreaterThanGreaterThanGreaterThan => {
                self.token = T::TGreaterThanGreaterThan;
                self.start += 1;
            }

            _ => {
                self.expected(T::TGreaterThan)?;
            }
        }
        Ok(())
    }

    /// PERF: `next()` is the dispatch boundary between the parser and the
    /// lexer's inner scanners; the parser calls it from hundreds of sites
    /// (directly and via `expect()`). We deliberately *don't* mark it
    /// `#[inline(never)]` — that turned every `lexer.next()` site into a real
    /// call + caller-saved-register spill; we want it partial-inlinable at
    /// leaf call sites (the EOF/`TSemicolon`/`TIdentifier`
    /// fast tails fold into the caller and the bulky switch stays out of line).
    /// To make that tractable for LLVM we instead anchor `#[inline(never)]` /
    /// `#[cold]` on the *heavy, rare* sub-scanners (`scan_identifier_with_escapes`,
    /// `parse_string_literal_inner`, `add_*error`) so this body stays small
    /// enough that the partial-inliner extracts a clean cold region instead of
    /// splitting the identifier scanner out as its own symbol (the failure mode
    /// observed in `build/create-next` profiles that originally motivated the
    /// `#[inline(never)]` here). The genuinely hot, tiny scanners
    /// (`latin1_identifier_continue_length`, `parse_numeric_literal_or_dot`,
    /// `parse_string_literal::<QUOTE>`) stay `#[inline]`/`#[inline(always)]` so
    /// they merge *into* this body.
    pub fn next(&mut self) -> Result<(), Error> {
        self.has_newline_before = self.end == 0;
        self.has_pure_comment_before = false;
        self.has_no_side_effect_comment_before = false;
        self.prev_token_was_await_keyword = false;

        // PERF: bind the source slice once so every inlined `step()` in the
        // token loop below reads a register-resident `Copy` fat-ptr instead of
        // reloading `self.contents` (`mov 0x80(%rbx),%rsi`) at ~50 sites. See
        // `next_codepoint_with`. `self.contents` is never reassigned during a
        // `next()` call, so `contents == self.contents` throughout.
        let contents: &[u8] = self.contents;

        loop {
            self.start = self.end;
            self.token = T::TEndOfFile;

            match self.code_point {
                -1 => {
                    self.token = T::TEndOfFile;
                }

                0x23 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Private identifiers are not allowed in JSON",
                        );
                    }
                    if self.start == 0
                        && contents.len() > 1
                        && contents[1] == b'!'
                    {
                        // "#!/usr/bin/env node"
                        self.token = T::THashbang;
                        'hashbang: loop {
                            self.step_with(contents);
                            match self.code_point {
                                0x0D | 0x0A | 0x2028 | 0x2029 =>
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
                        self.step_with(contents);
                        if self.code_point == 0x5C {
                            self.identifier = self
                                .scan_identifier_with_escapes(IdentifierKind::Private)?
                                .contents;
                        } else {
                            if !is_identifier_start(self.code_point) {
                                self.syntax_error()?;
                            }

                            self.step_with(contents);
                            while is_identifier_continue(self.code_point) {
                                self.step_with(contents);
                            }
                            if self.code_point == 0x5C {
                                self.identifier = self
                                    .scan_identifier_with_escapes(IdentifierKind::Private)?
                                    .contents;
                            } else {
                                self.identifier = self.raw();
                            }
                        }
                        self.token = T::TPrivateIdentifier;
                        break;
                    }
                }
                0x0D | 0x0A | 0x2028 | 0x2029 =>
                {
                    self.has_newline_before = true;

                    if GUESS_INDENTATION {
                        if self.indent_info.first_newline
                            && self.code_point == 0x0A
                        {
                            while self.code_point == 0x0A
                                || self.code_point == 0x0D
                            {
                                self.step_with(contents);
                            }

                            if self.code_point != 0x20
                                && self.code_point != 0x09
                            {
                                // try to get the next one. this handles cases where the file starts
                                // with a newline
                                continue;
                            }

                            self.indent_info.first_newline = false;

                            let indent_character = self.code_point;
                            let mut count: usize = 0;
                            while self.code_point == indent_character {
                                self.step_with(contents);
                                count += 1;
                            }

                            self.indent_info.guess.character =
                                if indent_character == 0x20 {
                                    IndentationCharacter::Space
                                } else {
                                    IndentationCharacter::Tab
                                };
                            self.indent_info.guess.scalar = count;
                            continue;
                        }
                    }

                    self.step_with(contents);
                    continue;
                }
                0x09 | 0x20 => {
                    self.step_with(contents);
                    continue;
                }
                0x28 => {
                    self.step_with(contents);
                    self.token = T::TOpenParen;
                }
                0x29 => {
                    self.step_with(contents);
                    self.token = T::TCloseParen;
                }
                0x5B => {
                    self.step_with(contents);
                    self.token = T::TOpenBracket;
                }
                0x5D => {
                    self.step_with(contents);
                    self.token = T::TCloseBracket;
                }
                0x7B => {
                    self.step_with(contents);
                    self.token = T::TOpenBrace;
                }
                0x7D => {
                    self.step_with(contents);
                    self.token = T::TCloseBrace;
                }
                0x2C => {
                    self.step_with(contents);
                    self.token = T::TComma;
                }
                0x3A => {
                    self.step_with(contents);
                    self.token = T::TColon;
                }
                0x3B => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Semicolons are not allowed in JSON",
                        );
                    }
                    self.step_with(contents);
                    self.token = T::TSemicolon;
                }
                0x40 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Decorators are not allowed in JSON",
                        );
                    }
                    self.step_with(contents);
                    self.token = T::TAt;
                }
                0x7E => {
                    if IS_JSON {
                        return self
                            .add_unsupported_syntax_error(b"~ is not allowed in JSON");
                    }
                    self.step_with(contents);
                    self.token = T::TTilde;
                }
                0x3F => {
                    // '?' or '?.' or '??' or '??='
                    self.step_with(contents);
                    match self.code_point {
                        0x3F => {
                            self.step_with(contents);
                            match self.code_point {
                                0x3D => {
                                    self.step_with(contents);
                                    self.token = T::TQuestionQuestionEquals;
                                }
                                _ => {
                                    self.token = T::TQuestionQuestion;
                                }
                            }
                        }

                        0x2E => {
                            self.token = T::TQuestion;
                            let current = self.current;

                            // Lookahead to disambiguate with 'a?.1:b'
                            if current < contents.len() {
                                let c = contents[current];
                                if c < b'0' || c > b'9' {
                                    self.step_with(contents);
                                    self.token = T::TQuestionDot;
                                }
                            }
                        }
                        _ => {
                            self.token = T::TQuestion;
                        }
                    }
                }
                0x25 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '%' or '%='
                    self.step_with(contents);
                    match self.code_point {
                        0x3D => {
                            self.step_with(contents);
                            self.token = T::TPercentEquals;
                        }
                        _ => {
                            self.token = T::TPercent;
                        }
                    }
                }

                0x26 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '&' or '&=' or '&&' or '&&='
                    self.step_with(contents);
                    match self.code_point {
                        0x3D => {
                            self.step_with(contents);
                            self.token = T::TAmpersandEquals;
                        }
                        0x26 => {
                            self.step_with(contents);
                            match self.code_point {
                                0x3D => {
                                    self.step_with(contents);
                                    self.token = T::TAmpersandAmpersandEquals;
                                }
                                _ => {
                                    self.token = T::TAmpersandAmpersand;
                                }
                            }
                        }
                        _ => {
                            self.token = T::TAmpersand;
                        }
                    }
                }

                0x7C => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '|' or '|=' or '||' or '||='
                    self.step_with(contents);
                    match self.code_point {
                        0x3D => {
                            self.step_with(contents);
                            self.token = T::TBarEquals;
                        }
                        0x7C => {
                            self.step_with(contents);
                            match self.code_point {
                                0x3D => {
                                    self.step_with(contents);
                                    self.token = T::TBarBarEquals;
                                }
                                _ => {
                                    self.token = T::TBarBar;
                                }
                            }
                        }
                        _ => {
                            self.token = T::TBar;
                        }
                    }
                }

                0x5E => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '^' or '^='
                    self.step_with(contents);
                    match self.code_point {
                        0x3D => {
                            self.step_with(contents);
                            self.token = T::TCaretEquals;
                        }
                        _ => {
                            self.token = T::TCaret;
                        }
                    }
                }

                0x2B => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '+' or '+=' or '++'
                    self.step_with(contents);
                    match self.code_point {
                        0x3D => {
                            self.step_with(contents);
                            self.token = T::TPlusEquals;
                        }
                        0x2B => {
                            self.step_with(contents);
                            self.token = T::TPlusPlus;
                        }
                        _ => {
                            self.token = T::TPlus;
                        }
                    }
                }

                0x2D => {
                    // '+' or '+=' or '++'
                    self.step_with(contents);
                    match self.code_point {
                        0x3D => {
                            if IS_JSON {
                                return self.add_unsupported_syntax_error(
                                    b"Operators are not allowed in JSON",
                                );
                            }
                            self.step_with(contents);
                            self.token = T::TMinusEquals;
                        }
                        0x2D => {
                            if IS_JSON {
                                return self.add_unsupported_syntax_error(
                                    b"Operators are not allowed in JSON",
                                );
                            }
                            self.step_with(contents);

                            if self.code_point == 0x3E && self.has_newline_before {
                                // Genuinely almost-never taken — kept out of `next()`'s
                                // body so it doesn't share I-cache with the hot arms.
                                self.scan_legacy_html_close_comment();
                                continue;
                            }

                            self.token = T::TMinusMinus;
                        }
                        _ => {
                            self.token = T::TMinus;
                        }
                    }
                }

                0x2A => {
                    // '*' or '*=' or '**' or '**='
                    self.step_with(contents);
                    match self.code_point {
                        0x3D => {
                            self.step_with(contents);
                            self.token = T::TAsteriskEquals;
                        }
                        0x2A => {
                            self.step_with(contents);
                            match self.code_point {
                                0x3D => {
                                    self.step_with(contents);
                                    self.token = T::TAsteriskAsteriskEquals;
                                }
                                _ => {
                                    self.token = T::TAsteriskAsterisk;
                                }
                            }
                        }
                        _ => {
                            self.token = T::TAsterisk;
                        }
                    }
                }
                0x2F => {
                    // '/' or '/=' or '//' or '/* ... */'
                    self.step_with(contents);

                    match self.code_point {
                        0x3D => {
                            self.step_with(contents);
                            self.token = T::TSlashEquals;
                        }
                        0x2F => {
                            self.scan_single_line_comment();
                            if IS_JSON {
                                if !ALLOW_COMMENTS {
                                    self.add_range_error(
                                        self.range(),
                                        format_args!("JSON does not support comments"),
                                    )?;
                                    return Ok(());
                                }
                            }
                            self.scan_comment_text(false);
                            continue;
                        }
                        0x2A => {
                            // The `/* ... */` scan loop + its SIMD skip is pulled
                            // out of line so it doesn't bloat the hot ASCII
                            // identifier / whitespace / punctuator arms of
                            // `next()` (`scan_single_line_comment` is outlined the
                            // same way). The JSON-comments error path stays here
                            // because it must `return` from `next()`.
                            self.scan_multi_line_comment_body()?;
                            if IS_JSON {
                                if !ALLOW_COMMENTS {
                                    self.add_range_error(
                                        self.range(),
                                        format_args!("JSON does not support comments"),
                                    )?;
                                    return Ok(());
                                }
                            }
                            self.scan_comment_text(true);
                            continue;
                        }
                        _ => {
                            self.token = T::TSlash;
                        }
                    }
                }

                0x3D => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '=' or '=>' or '==' or '==='
                    self.step_with(contents);
                    match self.code_point {
                        0x3E => {
                            self.step_with(contents);
                            self.token = T::TEqualsGreaterThan;
                        }
                        0x3D => {
                            self.step_with(contents);
                            match self.code_point {
                                0x3D => {
                                    self.step_with(contents);
                                    self.token = T::TEqualsEqualsEquals;
                                }
                                _ => {
                                    self.token = T::TEqualsEquals;
                                }
                            }
                        }
                        _ => {
                            self.token = T::TEquals;
                        }
                    }
                }

                0x3C => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '<' or '<<' or '<=' or '<<=' or '<!--'
                    self.step_with(contents);
                    match self.code_point {
                        0x3D => {
                            self.step_with(contents);
                            self.token = T::TLessThanEquals;
                        }
                        0x3C => {
                            self.step_with(contents);
                            match self.code_point {
                                0x3D => {
                                    self.step_with(contents);
                                    self.token = T::TLessThanLessThanEquals;
                                }
                                _ => {
                                    self.token = T::TLessThanLessThan;
                                }
                            }
                        }
                        // Handle legacy HTML-style comments
                        0x21 => {
                            if self.peek("--".len()) == b"--" {
                                self.add_unsupported_syntax_error(
                                    b"Legacy HTML comments not implemented yet!",
                                )?;
                                return Ok(());
                            }

                            self.token = T::TLessThan;
                        }
                        _ => {
                            self.token = T::TLessThan;
                        }
                    }
                }

                0x3E => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '>' or '>>' or '>>>' or '>=' or '>>=' or '>>>='
                    self.step_with(contents);

                    match self.code_point {
                        0x3D => {
                            self.step_with(contents);
                            self.token = T::TGreaterThanEquals;
                        }
                        0x3E => {
                            self.step_with(contents);
                            match self.code_point {
                                0x3D => {
                                    self.step_with(contents);
                                    self.token = T::TGreaterThanGreaterThanEquals;
                                }
                                0x3E => {
                                    self.step_with(contents);
                                    match self.code_point {
                                        0x3D => {
                                            self.step_with(contents);
                                            self.token = T::TGreaterThanGreaterThanGreaterThanEquals;
                                        }
                                        _ => {
                                            self.token = T::TGreaterThanGreaterThanGreaterThan;
                                        }
                                    }
                                }
                                _ => {
                                    self.token = T::TGreaterThanGreaterThan;
                                }
                            }
                        }
                        _ => {
                            self.token = T::TGreaterThan;
                        }
                    }
                }

                0x21 => {
                    if IS_JSON {
                        return self.add_unsupported_syntax_error(
                            b"Operators are not allowed in JSON",
                        );
                    }

                    // '!' or '!=' or '!=='
                    self.step_with(contents);
                    match self.code_point {
                        0x3D => {
                            self.step_with(contents);
                            match self.code_point {
                                0x3D => {
                                    self.step_with(contents);
                                    self.token = T::TExclamationEqualsEquals;
                                }
                                _ => {
                                    self.token = T::TExclamationEquals;
                                }
                            }
                        }
                        _ => {
                            self.token = T::TExclamation;
                        }
                    }
                }

                0x27 => {
                    self.parse_string_literal::<0x27>()?;
                }
                0x22 => {
                    self.parse_string_literal::<0x22>()?;
                }
                0x60 => {
                    self.parse_string_literal::<0x60>()?;
                }

                0x5F | 0x24 | 0x61..=0x7A | 0x41..=0x5A =>
                {
                    let advance = latin1_identifier_continue_length(
                        &contents[self.current..],
                    );

                    self.end = self.current + advance;
                    self.current = self.end;

                    self.step_with(contents);

                    if self.code_point >= 0x80 {
                        while is_identifier_continue(self.code_point) {
                            self.step_with(contents);
                        }
                    }

                    if self.code_point != 0x5C {
                        // this code is so hot that if you save lexer.raw() into a temporary variable
                        // it shows up in profiling
                        self.identifier = self.raw();
                        self.token =
                            tables::keyword(self.identifier).unwrap_or(T::TIdentifier);
                    } else {
                        let scan_result = self
                            .scan_identifier_with_escapes(IdentifierKind::Normal)?;
                        self.identifier = scan_result.contents;
                        self.token = scan_result.token;
                    }
                }

                0x5C => {
                    if IS_JSON && IGNORE_LEADING_ESCAPE_SEQUENCES {
                        if self.start == 0
                            || self.current == contents.len() - 1
                        {
                            self.step_with(contents);
                            continue;
                        }
                    }

                    let scan_result = self
                        .scan_identifier_with_escapes(IdentifierKind::Normal)?;
                    self.identifier = scan_result.contents;
                    self.token = scan_result.token;
                }

                0x2E | 0x30..=0x39 => {
                    self.parse_numeric_literal_or_dot(contents)?;
                }

                _ => {
                    // Check for unusual whitespace characters
                    if is_whitespace(self.code_point) {
                        self.step_with(contents);
                        continue;
                    }

                    if is_identifier_start(self.code_point) {
                        self.step_with(contents);
                        while is_identifier_continue(self.code_point) {
                            self.step_with(contents);
                        }
                        if self.code_point == 0x5C {
                            let scan_result = self
                                .scan_identifier_with_escapes(IdentifierKind::Normal)?;
                            self.identifier = scan_result.contents;
                            self.token = scan_result.token;
                        } else {
                            self.token = T::TIdentifier;
                            self.identifier = self.raw();
                        }
                        break;
                    }

                    self.end = self.current;
                    self.token = T::TSyntaxError;
                    // Mirror the `next_inside_jsx_element` fix (#30959): advance
                    // `code_point`/`current` past the bad byte so a subsequent
                    // recovery `next()` dispatches on the *following* byte rather
                    // than re-dispatching on the still-in-`code_point` bad byte.
                    // In the main lexer the byte that falls through to this arm
                    // is invalid in main-lexer context too, so re-dispatch
                    // currently stays in `TSyntaxError` and the duplicate-scope
                    // panic isn't reachable — but keeping the `current > end`
                    // invariant consistent across both dispatch tables means
                    // future recovery code doesn't have to reason about one arm
                    // that leaves the lexer with `current == end`. `end` was
                    // already advanced above, so the error range `[start, end)`
                    // is unchanged.
                    self.step_with(contents);
                }
            }

            return Ok(());
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    pub fn expected(&mut self, token: T) -> Result<(), Error> {
        if self.is_log_disabled {
            return Err(Error::Backtrack);
        } else if !tokenToString_get(token).is_empty() {
            self.expected_string(tokenToString_get(token))
        } else {
            self.unexpected()
        }
    }

    #[cold]
    #[inline(never)]
    pub fn unexpected(&mut self) -> Result<(), Error> {
        let found: &[u8] = 'finder: {
            self.start = self.start.min(self.end);

            if self.start == self.contents.len() {
                break 'finder b"end of file";
            } else {
                break 'finder self.raw();
            }
        };

        self.add_range_error(
            self.range(),
            format_args!("Unexpected {}", bstr::BStr::new(found)),
        )
    }

    #[inline(always)]
    pub fn raw(&self) -> &'a [u8] {
        // `self.contents: &'a [u8]` — slice carries `'a` directly.
        &self.contents[self.start..self.end]
    }

    pub fn is_contextual_keyword(&self, keyword: &'static [u8]) -> bool {
        self.token == T::TIdentifier && self.raw() == keyword
    }

    #[cold]
    #[inline(never)]
    pub fn expected_string(&mut self, text: &[u8]) -> Result<(), Error> {
        if self.prev_token_was_await_keyword {
            let mut notes: [bun_ast::Data; 1] = [bun_ast::Data::default()];
            if !self.fn_or_arrow_start_loc.is_empty() {
                notes[0] = bun_ast::range_data(
                    Some(self.source),
                    range_of_identifier(self.source, self.fn_or_arrow_start_loc),
                    b"Consider adding the \"async\" keyword here",
                );
            }

            let notes_ptr: &[bun_ast::Data] =
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
        if self.contents.len() != self.start {
            self.add_range_error(
                self.range(),
                format_args!(
                    "Expected {} but found \"{}\"",
                    bstr::BStr::new(text),
                    bstr::BStr::new(self.raw())
                ),
            )
        } else {
            self.add_range_error(
                self.range(),
                format_args!(
                    "Expected {} but found end of file",
                    bstr::BStr::new(text)
                ),
            )
        }
    }

    fn scan_comment_text(&mut self, for_pragma: bool) {
        let text = &self.contents[self.start..self.end];
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

        if self.track_react_suppressions
            && !(self.has_react_hooks_suppression_before && self.has_react_hooks_block_suppression)
        {
            let body = &text[..end_comment_text];
            if let Some(i) = strings::index_of(body, b"eslint-disable") {
                let after = &body[i + b"eslint-disable".len()..];
                // Only `eslint-disable[-next-line] <rule>` with a word boundary; not `-line`.
                let at_word_boundary =
                    |s: &[u8]| s.first().is_none_or(|b| b.is_ascii_whitespace());
                let matched = if strings::has_prefix_comptime(after, b"-next-line") {
                    let rest = &after[b"-next-line".len()..];
                    at_word_boundary(rest).then_some((false, rest))
                } else if at_word_boundary(after) {
                    Some((true, after))
                } else {
                    None
                };
                if let Some((is_block, rest)) = matched {
                    if strings::contains(rest, b"react-hooks/rules-of-hooks")
                        || strings::contains(rest, b"react-hooks/exhaustive-deps")
                    {
                        self.has_react_hooks_suppression_before = true;
                        if is_block {
                            self.has_react_hooks_block_suppression = true;
                        }
                    }
                }
            }
        }

        if has_legal_annotation || self.preserve_all_comments_before {
            if is_multiline_comment {
                // text = lexer.removeMultilineCommentIndent(lexer.source.contents[0..lexer.start], text);
            }

            self.comments_to_preserve_before.push(js_ast::G::Comment {
                text: text.into(),
                loc: self.loc(),
            });
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

    /// Scans the body of a `/* ... */` block comment, starting with
    /// `self.code_point` positioned on the `*` of the opening `/*`. On a
    /// successful close (`*/`) it returns with the iterator just past the `/`.
    ///
    /// PERF: pulled out of `next()` (which is the single largest non-JSC symbol)
    /// so the multi-line body + its SIMD skip don't share I-cache with the hot
    /// ASCII identifier / whitespace / punctuator arms. `#[inline(never)]`
    /// (not `#[cold]`) because block comments, while rare per-token, are common
    /// enough in real source that we don't want the branch pessimized.
    #[inline(never)]
    fn scan_multi_line_comment_body(&mut self) -> Result<(), Error> {
        // PERF: keep the source slice register-resident — see `next_codepoint_with`.
        let contents: &[u8] = self.contents;
        // Consume the `*` of the opening `/*`.
        self.step_with(contents);

        loop {
            match self.code_point {
                0x2A => {
                    self.step_with(contents);
                    if self.code_point == 0x2F {
                        self.step_with(contents);
                        return Ok(());
                    }
                }
                0x0D | 0x0A | 0x2028 | 0x2029 => {
                    self.step_with(contents);
                    self.has_newline_before = true;
                }
                -1 => {
                    self.start = self.end;
                    self.add_syntax_error(
                        self.start,
                        format_args!("Expected \"*/\" to terminate multi-line comment"),
                    )?;
                }
                _ => {
                    if self.code_point < 128 {
                        let remainder = &contents[self.current..];
                        if remainder.len() >= 512 {
                            self.current +=
                                skip_to_interesting_character_in_multiline_comment(remainder);
                            self.end = self.current.saturating_sub(1);
                            self.step_with(contents);
                            continue;
                        }
                    }

                    self.step_with(contents);
                }
            }
        }
    }

    /// Handles the legacy `-->` HTML single-line close comment: emits the
    /// warning and consumes the rest of the line. Entered with `self.code_point`
    /// on the `>` of `-->`.
    ///
    /// PERF: this is essentially never taken in real code — keep it fully out of
    /// `next()`'s body so it never costs the hot arms any I-cache.
    #[cold]
    #[inline(never)]
    fn scan_legacy_html_close_comment(&mut self) {
        // Consume the `>` of `-->`.
        self.step();
        self.log().add_range_warning(
            Some(self.source),
            self.range(),
            b"Treating \"-->\" as the start of a legacy HTML single-line comment",
        );

        loop {
            match self.code_point {
                0x0D | 0x0A | 0x2028 | 0x2029 | -1 => break,
                _ => {}
            }
            self.step();
        }
    }

    /// This scans a "// comment" in a single pass over the input.
    ///
    /// PERF: outlined for the same reason as `scan_multi_line_comment_body` —
    /// keep the SIMD newline scan, arena allocation, and pragma scanning out of
    /// `next()`'s hot ASCII arms. `#[inline(never)]` (not `#[cold]`) because
    /// `//` comments are common enough that we don't want the branch pessimized.
    #[inline(never)]
    fn scan_single_line_comment(&mut self) {
        // PERF: keep the source slice register-resident — see `next_codepoint_with`.
        let contents: &[u8] = self.contents;
        loop {
            // Find index of newline (ASCII/Unicode), non-ASCII, '#', or '@'.
            if let Some(relative_index) =
                bun_highway::index_of_newline_or_non_ascii_or_hash_or_at(&contents[self.current..])
            {
                let absolute_index = self.current + relative_index;
                self.current = absolute_index; // Move TO the interesting char

                self.step_with(contents); // Consume the interesting char, sets code_point, advances current

                match self.code_point {
                    0x0D | 0x0A | 0x2028 | 0x2029 =>
                    {
                        // Is it a line terminator?
                        // Found the end of the comment line.
                        return; // Stop scanning. Lexer state is ready for the next token.
                    }
                    -1 => {
                        return;
                    } // EOF? Stop.

                    0x23 | 0x40 => {
                        if !IS_JSON {
                            let pragma_trigger_pos = self.end; // Position OF #/@
                            // Use remaining() which starts *after* the consumed #/@
                            // Note: reshaped for borrowck — `remaining()` borrows
                            // `self.contents`; `scan_pragma` needs `&mut self`.
                            // Detach via `StoreStr` (arena-owned, lives for parse).
                            let chunk = js_ast::StoreStr::new(self.remaining());
                            let offset =
                                self.scan_pragma(pragma_trigger_pos, chunk.slice(), true);

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
                self.end = contents.len();
                self.current = contents.len();
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
                        usize::try_from(span.range.len).expect("int cast")
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
                        usize::try_from(span.range.len).expect("int cast")
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
                        usize::try_from(span.range.len).expect("int cast")
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
                        usize::try_from(span.range.len).expect("int cast")
                    } else {
                        0
                    };
            }
        } else if chunk.len() > " sourceMappingURL=".len()
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
            loc: bun_ast::usize2loc(self.start),
            // Saturate on overflow.
            len: i32::try_from(self.end - self.start).unwrap_or(i32::MAX),
        }
    }

    pub fn init_json(
        log: &mut Log,
        source: &'a Source,
        arena: &'a Arena,
    ) -> Result<Self, Error> {
        let mut lex = Self::init_without_reading(log, source, arena);
        lex.step();
        lex.next()?;
        Ok(lex)
    }

    /// `log` is *not* tied to `'a`: the lexer stores it as `NonNull<Log>` (see
    /// the `log` field doc) and the caller must keep the pointee alive for the
    /// lexer's lifetime. The looser bound lets `'a` (which `Ast<'a>` borrows
    /// through `arena`) outlive a stack-local scratch log.
    pub fn init_without_reading(
        log: &mut Log,
        source: &'a Source,
        arena: &'a Arena,
    ) -> Self {
        // Deref `Cow<'static,[u8]>` once; the resulting `&[u8]` borrows
        // `*source` (lifetime `'a`) regardless of Cow arm, so it is sound to
        // cache for the lexer's lifetime.
        let contents: &'a [u8] = source.contents();
        Self {
            log: core::ptr::NonNull::from(log),
            source,
            contents,
            current: 0,
            start: 0,
            end: 0,
            approximate_newline_count: 0,
            previous_backslash_quote_in_jsx: Range::NONE,
            token: T::TEndOfFile,
            has_newline_before: false,
            has_pure_comment_before: false,
            has_no_side_effect_comment_before: false,
            has_react_hooks_suppression_before: false,
            has_react_hooks_block_suppression: false,
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
            arena,
            string_literal_raw_content: b"",
            string_literal_start: 0,
            string_literal_raw_format: StringLiteralRawFormat::Ascii,
            temp_buffer_u16: Vec::new(),
            is_ascii_only: IS_JSON,
            track_comments: false,
            track_react_suppressions: false,
            all_comments: Vec::new(),
            indent_info: IndentInfo {
                guess: Indentation::default(),
                first_newline: true,
            },
        }
    }

    pub fn init(
        log: &mut Log,
        source: &'a Source,
        arena: &'a Arena,
    ) -> Result<Self, Error> {
        let mut lex = Self::init_without_reading(log, source, arena);
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
                // string_literal_raw_content is already parsed, duplicated, and utf-16.
                // It was created via `cast_slice::<u16, u8>` from an arena `[u16]` dupe,
                // so the pointer is u16-aligned and `cast_slice` back is sound (panics
                // if that invariant is ever broken — strictly safer than the raw cast).
                let utf16: &[u16] = bytemuck::cast_slice::<u8, u16>(self.string_literal_raw_content);
                Ok(js_ast::E::String::init_utf16(utf16))
            }
            StringLiteralRawFormat::NeedsDecode => {
                // string_literal_raw_content contains escapes (ie '\n') that need to be converted to their values (ie 0x0A).
                // escape parsing may cause a syntax error.
                debug_assert!(self.temp_buffer_u16.is_empty());
                let mut tmp = core::mem::take(&mut self.temp_buffer_u16);
                tmp.reserve(self.string_literal_raw_content.len());
                // `string_literal_raw_content` starts one byte after the opening
                // quote/backtick (see `base` in `parse_string_literal`); pass the
                // content-start offset so `start + iter.i` inside the decoder
                // lines up with absolute positions in the source.
                let res = self.decode_escape_sequences(
                    self.string_literal_start + 1,
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
                    let dup = self.arena.alloc_slice_copy(&tmp);
                    js_ast::E::String::init_utf16(dup)
                } else {
                    let result =
                        self.arena.alloc_slice_fill_default::<u8>(tmp.len());
                    strings::copy_utf16_into_utf8(result, &tmp);
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
        res.to_utf8(self.arena)?;
        Ok(res)
    }

    #[inline]
    fn assert_not_json(&self) {
        if IS_JSON {
            // Stable Rust can't fail the build on a const-generic branch,
            // so this is a runtime check on a dead path.
            unreachable!("JSON should not reach this point");
        }
    }

    pub fn scan_reg_exp(&mut self) -> Result<(), Error> {
        self.assert_not_json();
        self.regex_flags_start = None;
        loop {
            match self.code_point {
                0x2F => {
                    self.step();

                    let mut has_set_flags_start = false;
                    const FLAG_CHARACTERS: &[u8] = b"dgimsuvy";
                    const MIN_FLAG: u8 = b'd'; // min of FLAG_CHARACTERS
                    const MAX_FLAG: u8 = b'y'; // max of FLAG_CHARACTERS
                    let mut flags = bun_collections::IntegerBitSet::<
                        { (MAX_FLAG - MIN_FLAG) as usize + 1 },
                    >::init_empty();
                    let _ = FLAG_CHARACTERS;
                    while is_identifier_continue(self.code_point) {
                        match self.code_point {
                            0x64 | 0x67 | 0x69 | 0x6D | 0x73 | 0x75 | 0x79 | 0x76 =>
                            {
                                if !has_set_flags_start {
                                    self.regex_flags_start =
                                        Some((self.end - self.start) as u16);
                                    has_set_flags_start = true;
                                }
                                let flag = usize::from(
                                    MAX_FLAG - u8::try_from(self.code_point).expect("int cast"),
                                );
                                if flags.is_set(flag) {
                                    self.add_error(
                                        self.current,
                                        format_args!(
                                            "Duplicate flag \"{}\" in regular expression",
                                            char::from_u32(self.code_point as u32)
                                                .unwrap_or('\u{FFFD}')
                                        ),
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
                                );

                                self.step();
                            }
                        }
                    }
                    return Ok(());
                }
                0x5B => {
                    self.step();
                    while self.code_point != 0x5D {
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

    pub fn utf16_to_string(&self, js: JavascriptString<'_>) -> &'a [u8] {
        // Transcode into a temporary Vec and dupe into the arena.
        let owned = strings::to_utf8_alloc_with_type(js);
        self.arena.alloc_slice_copy(&owned)
    }

    pub fn next_inside_jsx_element(&mut self) -> Result<(), Error> {
        self.assert_not_json();

        self.has_newline_before = false;

        loop {
            self.start = self.end;
            self.token = T::TEndOfFile;

            match self.code_point {
                -1 => {
                    self.token = T::TEndOfFile;
                }
                0x0D | 0x0A | 0x2028 | 0x2029 =>
                {
                    self.step();
                    self.has_newline_before = true;
                    continue;
                }
                0x09 | 0x20 => {
                    self.step();
                    continue;
                }
                0x2E => {
                    self.step();
                    self.token = T::TDot;
                }
                0x3D => {
                    self.step();
                    self.token = T::TEquals;
                }
                0x7B => {
                    self.step();
                    self.token = T::TOpenBrace;
                }
                0x7D => {
                    self.step();
                    self.token = T::TCloseBrace;
                }
                0x3C => {
                    self.step();
                    self.token = T::TLessThan;
                }
                0x3E => {
                    self.step();
                    self.token = T::TGreaterThan;
                }
                0x2F => {
                    // '/' or '//' or '/* ... */'
                    self.step();
                    match self.code_point {
                        0x2F => {
                            'single_line_comment: loop {
                                self.step();
                                match self.code_point {
                                    0x0D | 0x0A | 0x2028 | 0x2029 =>
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
                        0x2A => {
                            self.step();
                            'multi_line_comment: loop {
                                match self.code_point {
                                    0x2A => {
                                        self.step();
                                        if self.code_point == 0x2F {
                                            self.step();
                                            break 'multi_line_comment;
                                        }
                                    }
                                    0x0D | 0x0A | 0x2028 | 0x2029 =>
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
                            self.token = T::TSlash;
                        }
                    }
                }
                0x27 => {
                    self.step();
                    self.parse_jsx_string_literal::<b'\''>()?;
                }
                0x22 => {
                    self.step();
                    self.parse_jsx_string_literal::<b'"'>()?;
                }
                _ => {
                    if is_whitespace(self.code_point) {
                        self.step();
                        continue;
                    }

                    if is_identifier_start(self.code_point) {
                        self.step();
                        while is_identifier_continue(self.code_point)
                            || self.code_point == 0x2D
                        {
                            self.step();
                        }

                        // Parse JSX namespaces. These are not supported by React or TypeScript
                        // but someone using JSX syntax in more obscure ways may find a use for
                        // them. A namespaced name is just always turned into a string so you
                        // can't use this feature to reference JavaScript identifiers.
                        if self.code_point == 0x3A {
                            self.step();

                            if is_identifier_start(self.code_point) {
                                while is_identifier_continue(self.code_point)
                                    || self.code_point == 0x2D
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
                        self.token = T::TIdentifier;
                        break;
                    }

                    self.end = self.current;
                    self.token = T::TSyntaxError;
                    // Advance `code_point`/`current` past the bad byte so that a
                    // subsequent recovery `next()` (e.g. via `expect(...)` inside
                    // `parse_jsx_prop_value_identifier`) dispatches on the *following*
                    // byte instead of re-dispatching on the still-in-`code_point` bad
                    // byte. Without this step the recovery `next()` synthesises a
                    // zero-length token at the offset of the next byte, and the byte
                    // after that then gets tokenised a second time at the same
                    // `start` — the parser pushes two `FunctionArgs` scopes at that
                    // offset in `parse_paren_expr` and trips the strict-monotonicity
                    // debug assertion in `push_scope_for_parse_pass` (see #30959).
                    // `end` was already advanced above, so the step below only moves
                    // `current`/`code_point` forward and leaves the error range
                    // `[start, end)` intact.
                    self.step();
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
                0x26 => {
                    needs_decode = true;
                    self.step();
                }

                0x5C => {
                    backslash = Range {
                        loc: Loc {
                            start: i32::try_from(self.end).expect("int cast"),
                        },
                        len: 1,
                    };
                    self.step();

                    // JSX string literals do not support escaping
                    // They're "pre" escaped
                    match self.code_point {
                        c if c == 0x75
                            || c == 0x0C
                            || c == 0
                            || c == 0x09
                            || c == 0x0B // vertical tab
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

        self.token = T::TStringLiteral;

        let raw_content_slice =
            &self.contents[self.start + 1..self.end - 1];
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

            let dup = self.arena.alloc_slice_copy(&tmp);
            // Reinterpret &[u16] as &[u8] — `u16: Pod`, so `cast_slice` is safe.
            self.string_literal_raw_content = bytemuck::cast_slice::<u16, u8>(dup);
            self.string_literal_raw_format = StringLiteralRawFormat::Utf16;
            tmp.clear();
            self.temp_buffer_u16 = tmp;
        } else {
            self.string_literal_raw_content = raw_content_slice;
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
            self.token = T::TEndOfFile;

            match self.code_point {
                -1 => {
                    self.token = T::TEndOfFile;
                }
                0x7B => {
                    self.step();
                    self.token = T::TOpenBrace;
                }
                0x3C => {
                    self.step();
                    self.token = T::TLessThan;
                }
                _ => {
                    let mut needs_fixing = false;

                    'string_literal: loop {
                        match self.code_point {
                            -1 => {
                                self.syntax_error()?;
                            }
                            0x26 | 0x0D | 0x0A | 0x2028 | 0x2029 =>
                            {
                                needs_fixing = true;
                                self.step();
                            }
                            0x7B | 0x3C => {
                                break 'string_literal;
                            }
                            _ => {
                                // Non-ASCII strings need the slow path
                                needs_fixing = needs_fixing || self.code_point >= 0x80;
                                self.step();
                            }
                        }
                    }

                    self.token = T::TStringLiteral;
                    let raw_content_slice =
                        &self.contents[original_start..self.end];

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
                        let dup = self.arena.alloc_slice_copy(&tmp);
                        // Reinterpret arena-owned &[u16] as &[u8] — `u16: Pod`.
                        self.string_literal_raw_content = bytemuck::cast_slice::<u16, u8>(dup);
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
        let mut cursor = strings::Cursor::default();

        while iterator.next(&mut cursor) {
            match cursor.c {
                0x0D | 0x0A | 0x2028 | 0x2029 =>
                {
                    if let (Some(start), Some(end)) =
                        (first_non_whitespace, after_last_non_whitespace)
                    {
                        // Newline
                        if !decoded.is_empty() {
                            decoded.push(b' ' as u16);
                        }

                        // Trim whitespace off the start and end of lines in the middle
                        self.decode_jsx_entities(
                            &text[start as usize..end as usize],
                            decoded,
                        )?;
                    }

                    // Reset for the next line
                    first_non_whitespace = None;
                }
                0x09 | 0x20 => {}
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
        cursor: &mut strings::Cursor,
    ) {
        self.assert_not_json();

        if let Some(length) = strings::index_of_char(
            &text[cursor.width as usize + cursor.i as usize..],
            b';',
        ) {
            let length = length as usize;
            let end = cursor.width as usize + cursor.i as usize;
            let entity = &text[end..end + length];
            if entity.is_empty() {
                return;
            }
            if entity[0] == b'#' {
                let mut number = &entity[1..entity.len()];
                let mut base: u8 = 10;
                if number.len() > 1 && number[0] == b'x' {
                    number = &number[1..number.len()];
                    base = 16;
                }

                // Note: bytes-based integer parse — source bytes are
                // not guaranteed UTF-8 so we never round-trip through &str (PORTING.md §Strings).
                // Also reject values outside the Unicode range (0..=0x10FFFF); otherwise
                // `push_codepoint_utf16` hits `debug_assert`s in `u16_lead`/`u16_trail`
                // (release builds would silently encode garbage surrogate pairs).
                cursor.c = match bun_core::parse_int::<i32>(number, base) {
                    Ok(v) if (0..=0x10FFFF).contains(&v) => v,
                    Ok(_) => {
                        self.add_error(
                            self.start,
                            format_args!(
                                "JSX entity escape is too big: {}",
                                bstr::BStr::new(entity)
                            ),
                        );
                        strings::UNICODE_REPLACEMENT as CodePoint
                    }
                    Err(err) => {
                        match err {
                            strings::ParseIntError::InvalidCharacter => {
                                self.add_error(
                                    self.start,
                                    format_args!(
                                        "Invalid JSX entity escape: {}",
                                        bstr::BStr::new(entity)
                                    ),
                                );
                            }
                            strings::ParseIntError::Overflow => {
                                self.add_error(
                                    self.start,
                                    format_args!(
                                        "JSX entity escape is too big: {}",
                                        bstr::BStr::new(entity)
                                    ),
                                );
                            }
                        }

                        strings::UNICODE_REPLACEMENT as CodePoint
                    }
                };

                cursor.i += u32::try_from(length).expect("int cast") + 1;
                cursor.width = 1;
            } else if let Some(ent) = tables::JSX_ENTITY.get(entity) {
                cursor.c = *ent;
                cursor.i += u32::try_from(length).expect("int cast") + 1;
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
        let mut cursor = strings::Cursor::default();

        while iterator.next(&mut cursor) {
            if cursor.c == 0x26 {
                self.maybe_decode_jsx_entity(text, &mut cursor);
            }

            strings::push_codepoint_utf16(out, cursor.c as u32);
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

        if self.code_point == 0x5C {
            self.step();
        }

        match self.code_point {
            0x0D | 0x0A | 0x2028 | 0x2029 =>
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

        if self.token != T::TCloseBrace {
            self.expected(T::TCloseBrace)?;
        }

        self.rescan_close_brace_as_template_token = true;
        self.code_point = 0x60;
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
            T::TNoSubstitutionTemplateLiteral | T::TTemplateTail => {
                text = &self.contents[self.start + 1..self.end - 1];
            }
            T::TTemplateMiddle | T::TTemplateHead => {
                text = &self.contents[self.start + 1..self.end - 2];
            }
            _ => {}
        }

        if strings::index_of_char(text, b'\r').is_none() {
            // `text` already borrows `self.source: &'a Source` → `&'a [u8]`.
            return text;
        }

        // From the specification:
        //
        // 11.8.6.1 Static Semantics: TV and TRV
        //
        // TV excludes the code units of LineContinuation while TRV includes
        // them. <CR><LF> and <CR> LineTerminatorSequences are normalized to
        // <LF> for both TV and TRV. An explicit EscapeSequence is needed to
        // include a <CR> or <CR><LF> sequence.
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
        self.arena.alloc_slice_copy(&bytes)
    }

    // PERF: single caller (`next()`'s `0x2E | 0x30..=0x39` arm) per
    // monomorphization. `#[inline]` makes the body available cross-CGU so
    // LLVM's single-caller heuristic merges it into `next()`;
    // the hot `T::TDot` early-return then sits inside `next()`'s jump table
    // with no call overhead.
    #[inline]
    fn parse_numeric_literal_or_dot(&mut self, contents: &[u8]) -> Result<(), Error> {
        // Number or dot;
        let first = self.code_point;
        self.step_with(contents);

        // Dot without a digit after it;
        if first == 0x2E
            && (self.code_point < 0x30 || self.code_point > 0x39)
        {
            // "..."
            if (self.code_point == 0x2E
                && self.current < contents.len())
                && contents[self.current] == b'.'
            {
                self.step_with(contents);
                self.step_with(contents);
                self.token = T::TDotDotDot;
                return Ok(());
            }

            // "."
            self.token = T::TDot;
            return Ok(());
        }

        let mut underscore_count: usize = 0;
        let mut last_underscore_end: usize = 0;
        let mut has_dot_or_exponent = first == 0x2E;
        let mut base: f32 = 0.0;
        self.is_legacy_octal_literal = false;

        // Assume this is a number, but potentially change to a bigint later;
        self.token = T::TNumericLiteral;

        // Check for binary, octal, or hexadecimal literal;
        if first == 0x30 {
            match self.code_point {
                0x62 | 0x42 => {
                    base = 2.0;
                }
                0x6F | 0x4F => {
                    base = 8.0;
                }
                0x78 | 0x58 => {
                    base = 16.0;
                }
                0x30..=0x37 | 0x5F => {
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
                self.step_with(contents);
            }

            'integer_literal: loop {
                match self.code_point {
                    0x5F => {
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

                    0x30 | 0x31 => {
                        self.number = self.number * base as f64
                            + float64(self.code_point - 0x30);
                    }

                    0x32..=0x37 => {
                        if base == 2.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base as f64
                            + float64(self.code_point - 0x30);
                    }
                    0x38 | 0x39 => {
                        if self.is_legacy_octal_literal {
                            is_invalid_legacy_octal_literal = true;
                        } else if base < 10.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base as f64
                            + float64(self.code_point - 0x30);
                    }
                    0x41..=0x46 => {
                        if base != 16.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base as f64
                            + float64(self.code_point + 10 - 0x41);
                    }
                    0x61..=0x66 => {
                        if base != 16.0 {
                            self.syntax_error()?;
                        }
                        self.number = self.number * base as f64
                            + float64(self.code_point + 10 - 0x61);
                    }
                    _ => {
                        // The first digit must exist;
                        if is_first {
                            self.syntax_error()?;
                        }

                        break 'integer_literal;
                    }
                }

                self.step_with(contents);
                is_first = false;
            }

            let is_big_integer_literal =
                self.code_point == 0x6E && !has_dot_or_exponent;

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
                        .arena
                        .alloc_slice_fill_default::<u8>(text.len() - underscore_count);
                    let mut i: usize = 0;
                    for &char in text {
                        if char != b'_' {
                            bytes[i] = char;
                            i += 1;
                        }
                    }
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
            let is_invalid_legacy_octal_literal = first == 0x30
                && (self.code_point == 0x38 || self.code_point == 0x39);

            // Initial digits;
            loop {
                if self.code_point < 0x30 || self.code_point > 0x39 {
                    if self.code_point != 0x5F {
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
                self.step_with(contents);
            }

            // Fractional digits;
            if first != 0x2E && self.code_point == 0x2E {
                // An underscore must not come last;
                if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                    self.end -= 1;
                    self.syntax_error()?;
                }

                has_dot_or_exponent = true;
                self.step_with(contents);
                if self.code_point == 0x5F {
                    self.syntax_error()?;
                }
                loop {
                    if self.code_point < 0x30 || self.code_point > 0x39 {
                        if self.code_point != 0x5F {
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
                    self.step_with(contents);
                }
            }

            // Exponent;
            if self.code_point == 0x65 || self.code_point == 0x45 {
                // An underscore must not come last;
                if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                    self.end -= 1;
                    self.syntax_error()?;
                }

                has_dot_or_exponent = true;
                self.step_with(contents);
                if self.code_point == 0x2B || self.code_point == 0x2D {
                    self.step_with(contents);
                }
                if self.code_point < 0x30 || self.code_point > 0x39 {
                    self.syntax_error()?;
                }
                loop {
                    if self.code_point < 0x30 || self.code_point > 0x39 {
                        if self.code_point != 0x5F {
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
                    self.step_with(contents);
                }
            }

            // Take a slice of the text to parse;
            let mut text: &[u8] = self.raw();

            // Filter out underscores;
            if underscore_count > 0 {
                let mut i: usize = 0;
                let bytes = self
                    .arena
                    .alloc_slice_fill_default::<u8>(text.len() - underscore_count);
                for &char in text {
                    if char != b'_' {
                        bytes[i] = char;
                        i += 1;
                    }
                }
                text = bytes;
            }

            if self.code_point == 0x6E && !has_dot_or_exponent {
                // The only bigint literal that can start with 0 is "0n"
                if text.len() > 1 && first == 0x30 {
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
                match bun_core::wtf::parse_double(text) {
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
        if self.code_point == 0x6E && !has_dot_or_exponent {
            self.token = T::TBigIntegerLiteral;
            self.step_with(contents);
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
pub type Lexer<'a> = NewLexer<'a, DefaultJsonOptions>;

#[inline]
pub fn is_identifier_start(codepoint: i32) -> bool {
    js_identifier::is_identifier_start(codepoint)
}
#[inline]
pub fn is_identifier_continue(codepoint: i32) -> bool {
    js_identifier::is_identifier_part(codepoint)
}

pub fn is_whitespace(codepoint: CodePoint) -> bool {
    // ECMAScript `WhiteSpace`: TAB VT FF SP ZWNBSP + Unicode Zs.
    matches!(codepoint, 0x0009 | 0x000B | 0x000C | 0x0020 | 0xFEFF)
        || strings::is_unicode_space_separator(codepoint as u32)
}

pub use bun_core::identifier::{is_identifier, is_identifier_utf16};

pub fn range_of_identifier(source: &Source, loc: Loc) -> Range {
    let contents = &source.contents;
    if loc.start == -1 || usize::try_from(loc.start).expect("int cast") >= contents.len() {
        return Range::NONE;
    }

    let iter = CodepointIterator::init(&contents[loc.to_usize()..]);
    let mut cursor = strings::Cursor::default();

    let mut r = Range { loc, len: 0 };
    if iter.bytes.is_empty() {
        return r;
    }
    let text = iter.bytes;
    let end = u32::try_from(text.len()).expect("int cast");

    if !iter.next(&mut cursor) {
        return r;
    }

    // Handle private names
    if cursor.c == 0x23 {
        if !iter.next(&mut cursor) {
            r.len = 1;
            return r;
        }
    }

    if is_identifier_start(cursor.c) || cursor.c == 0x5C {
        while iter.next(&mut cursor) {
            if cursor.c == 0x5C {
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
                r.len = i32::try_from(cursor.i).expect("int cast");
                return r;
            }
        }

        r.len = i32::try_from(cursor.i).expect("int cast");
    }

    r
}

#[inline]
fn float64(num: i32) -> f64 {
    num as f64
}

// PERF: force-inline — sole call site is the identifier arm of `next()`, the
// hottest token by frequency. It's tiny, so it belongs *inside* `next()`'s
// body (a call + ret per identifier would dominate it).
#[inline(always)]
fn latin1_identifier_continue_length(name: &[u8]) -> usize {
    // We don't use SIMD for this because the input will be very short.
    latin1_identifier_continue_length_scalar(name)
}

#[inline(always)]
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
        c == 0x0D || c == 0x0A || c == 0x2028 || c == 0x2029
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
                break 'brk delimiter_pos_in_arg as usize;
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
                len: i32::try_from(url_len).expect("int cast"), // Correct length
                loc: Loc {
                    start: i32::try_from(absolute_arg_start).expect("int cast"),
                }, // Correct start
            },
            text: js_ast::StoreStr::new(url),
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

        let mut cursor = strings::Cursor::default();
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
            cursor = strings::Cursor::default();
            iter = CodepointIterator::init(text);
            let _ = iter.next(&mut cursor);
        }

        let mut i: usize = 0;
        while !is_whitespace(cursor.c) && (!allow_newline || !Self::is_newline(cursor.c)) {
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
                len: i32::try_from(i).expect("int cast"),
                loc: Loc {
                    start: i32::try_from(
                        start
                            + u32::try_from(offset_).expect("int cast")
                            + u32::try_from(pragma.len()).expect("int cast"),
                    )
                    .unwrap(),
                },
            },
            text: js_ast::StoreStr::new(&text[0..i]),
        })
    }
}

/// Byte offset of the next character `scan_multi_line_comment_body` has to
/// inspect one code point at a time: the first `*` (potential `*/`
/// terminator), `\r` / `\n` (newline tracking for ASI), or non-ASCII byte
/// (U+2028/U+2029 and other multi-byte sequences). Returns `text_.len()` when
/// the rest of the input has no such byte — the comment is unterminated, so
/// the caller's next `step()` lands on EOF and reports the error.
fn skip_to_interesting_character_in_multiline_comment(text_: &[u8]) -> usize {
    bun_highway::index_of_interesting_character_in_multiline_comment(text_).unwrap_or(text_.len())
}

fn index_of_interesting_character_in_string_literal(text_: &[u8], quote: u8) -> Option<usize> {
    bun_highway::index_of_interesting_character_in_string_literal(text_, quote)
}

struct InvalidEscapeSequenceFormatter {
    code_point: i32,
}

impl fmt::Display for InvalidEscapeSequenceFormatter {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.code_point {
            0x22 => writer.write_str("Unexpected escaped double quote '\"'"),
            0x27 => writer.write_str("Unexpected escaped single quote \"'\""),
            0x60 => writer.write_str("Unexpected escaped backtick '`'"),
            0x5C => writer.write_str("Unexpected escaped backslash '\\'"),
            _ => writer.write_str("Unexpected escape sequence"),
        }
    }
}
