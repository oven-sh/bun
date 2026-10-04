//! JavaScript/JSON lexer.

use core::fmt;

use bun_alloc::Arena;
use bun_ast as js_ast;
use bun_ast::lexer_tables as tables;
use bun_ast::{LexerLog, Loc, Log, Range, Source, TypeScriptKind};
use bun_core::Environment;
use bun_core::fmt::hex_digit_value_u32;
pub(crate) use bun_core::lexer::{
    char_and_size, end_of_run, is_white_space_single_line, is_whitespace, last_char,
    peek_unicode_escape, starts_with_line_break,
};
use bun_core::strings;
use bun_core::strings::CodepointIterator;
use identifier as js_identifier;

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

#[derive(Default, Clone, Copy)]
pub struct JSXPragma {
    pub(crate) _jsx: js_ast::Span,
    pub(crate) _jsx_frag: js_ast::Span,
    pub(crate) _jsx_runtime: js_ast::Span,
    pub(crate) _jsx_import_source: js_ast::Span,
}

impl JSXPragma {
    // `Span.text` is a `StoreStr`; `.len()` via Deref<[u8]>.
    pub(crate) fn jsx(&self) -> Option<js_ast::Span> {
        if self._jsx.text.len() > 0 {
            Some(self._jsx)
        } else {
            None
        }
    }
    pub(crate) fn jsx_frag(&self) -> Option<js_ast::Span> {
        if self._jsx_frag.text.len() > 0 {
            Some(self._jsx_frag)
        } else {
            None
        }
    }
    pub(crate) fn jsx_runtime(&self) -> Option<js_ast::Span> {
        if self._jsx_runtime.text.len() > 0 {
            Some(self._jsx_runtime)
        } else {
            None
        }
    }
    pub(crate) fn jsx_import_source(&self) -> Option<js_ast::Span> {
        if self._jsx_import_source.text.len() > 0 {
            Some(self._jsx_import_source)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Error {
    UTF8Fail,
    OutOfMemory,
    SyntaxError,
    UnexpectedSyntax,
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

/// `packed struct(u8) { suffix_len: u2, needs_decode: bool, _padding: u5 = 0 }`
#[repr(transparent)]
#[derive(Clone, Copy, Default)]
pub struct InnerStringLiteral(pub(crate) u8);
impl InnerStringLiteral {
    #[inline]
    pub(crate) fn new(suffix_len: u8, needs_decode: bool) -> Self {
        Self((suffix_len & 0b11) | ((needs_decode as u8) << 2))
    }
    #[inline]
    pub(crate) fn suffix_len(self) -> u8 {
        self.0 & 0b11
    }
    #[inline]
    pub(crate) fn needs_decode(self) -> bool {
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
    pub(crate) token: T,
    pub(crate) contents: &'a [u8],
}

/// POD snapshot of all backtrack-relevant lexer state.
///
/// Backtracking can't snapshot the lexer with a full struct copy because
/// `Lexer` owns heap-backed buffers and a `Log` pointer. Instead, callers do:
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
    pub(crate) current: usize,
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) token_full_start: usize,
    pub(crate) approximate_newline_count: usize,
    pub(crate) previous_backslash_quote_in_jsx: Range,
    pub(crate) token: T,
    pub(crate) has_newline_before: bool,
    pub(crate) has_pure_comment_before: bool,
    pub(crate) has_react_hooks_suppression_before: bool,
    pub(crate) has_react_hooks_block_suppression: bool,
    pub(crate) preserve_all_comments_before: bool,
    pub(crate) is_legacy_octal_literal: bool,
    pub(crate) is_log_disabled: bool,
    pub(crate) code_point: CodePoint,
    pub(crate) identifier: &'a [u8],
    pub(crate) jsx_pragma: JSXPragma,
    pub(crate) source_mapping_url: Option<js_ast::Span>,
    pub(crate) number: f64,
    pub(crate) rescan_close_brace_as_template_token: bool,
    pub(crate) prev_error_loc: Loc,
    pub(crate) prev_token_was_await_keyword: bool,
    pub(crate) fn_or_arrow_start_loc: Loc,
    pub(crate) regex_flags_start: Option<u16>,
    pub(crate) string_literal_raw_content: &'a [u8],
    pub(crate) string_literal_start: usize,
    pub(crate) string_literal_raw_format: StringLiteralRawFormat,
    pub(crate) track_comments: bool,
    pub(crate) track_react_suppressions: bool,
    pub(crate) list_contexts: u32,
    pub(crate) await_name_seen: bool,
    // Vec buffer lengths — restore() truncates back to these.
    pub(crate) all_comments_len: usize,
    pub(crate) comment_directives_len: usize,
    pub(crate) comments_to_preserve_before_len: usize,
}

/// `'a` is the lifetime of the source contents (arena/source-owned slices like
/// `identifier` and `string_literal_raw_content` borrow from the source or from
/// the parser arena). The `Log` is *not* tied to `'a`; see the `log` field doc.
pub struct Lexer<'a> {
    /// Raw pointer to the caller-owned `Log`. The parser holds a second
    /// aliasing pointer to the same `Log`; Rust cannot store two `&mut Log`
    /// to the same allocation (Stacked-Borrows UB), so both the lexer and the
    /// parser keep `NonNull<Log>` and reborrow at use sites via `log()`. The
    /// `init*` constructors take a plain `&mut Log` (not tied to `'a`); the
    /// caller must keep the pointee alive for the lexer's lifetime — see
    /// `init_without_reading`.
    pub(crate) log: core::ptr::NonNull<Log>,
    pub(crate) source: &'a Source,
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
    pub(crate) contents: &'a [u8],
    pub current: usize,
    pub(crate) start: usize,
    pub end: usize,
    pub(crate) approximate_newline_count: usize,
    pub(crate) previous_backslash_quote_in_jsx: Range,
    pub token: T,
    pub(crate) has_newline_before: bool,
    pub(crate) has_pure_comment_before: bool,
    /// Set (and never cleared by `next()`) once an `eslint-disable[-next-line]`
    /// comment naming `react-hooks/rules-of-hooks` or `react-hooks/exhaustive-deps`
    /// has been scanned. The parser reads this at function-body close to set
    /// `flags::Function::HasReactHooksSuppression` / `E::Arrow::has_react_hooks_suppression`.
    pub(crate) has_react_hooks_suppression_before: bool,
    /// Sticky variant of the above: set when the suppression comment is a bare
    /// `eslint-disable` (no `-next-line` suffix). Never cleared by the
    /// parser, so it applies to every subsequent function in the file.
    pub(crate) has_react_hooks_block_suppression: bool,
    pub(crate) preserve_all_comments_before: bool,
    pub(crate) is_legacy_octal_literal: bool,
    pub(crate) is_log_disabled: bool,
    /// Set for the type checker only: a syntax error is logged and parsing continues from the same
    /// token, as in TypeScript's parser, so that there is an AST to check no matter how many errors
    /// the file has.
    pub(crate) tolerant: bool,
    /// Number of consecutive error recoveries at the same position.
    pub(crate) stuck: u32,
    /// Tolerant mode: the number of errors that were not logged because the log was disabled.
    /// TypeScript keeps the errors of a speculative parse that succeeds (`mark`, `rewind`), so a
    /// speculative parse during which this count changed must be repeated with the log enabled.
    pub(crate) swallowed: u32,
    /// Without `EscapeSequenceScanningFlagsReportInvalidEscapeErrors`: an escape sequence that is
    /// an error elsewhere is not reported, and decodes to its own source text.
    is_under_tag: bool,
    /// `statementHasAwaitIdentifier`: `await` was used as an identifier in the top-level statement
    /// being parsed. Tolerant mode only.
    pub(crate) await_name_seen: bool,
    /// `parsingContexts`: one bit per `parse::lists::ListKind` that is currently being parsed. Only maintained in tolerant mode. It lives
    /// in the lexer, and in its snapshot, because backtracking out of a list only restores the lexer.
    pub(crate) list_contexts: u32,
    /// Tolerant mode: start of the most recent unterminated string or template
    /// (`TokenFlagsUnterminated`).
    pub(crate) unterminated_at: usize,
    pub(crate) comments_to_preserve_before: Vec<js_ast::G::Comment>,
    pub(crate) code_point: CodePoint,
    pub(crate) identifier: &'a [u8],
    pub(crate) jsx_pragma: JSXPragma,
    pub(crate) source_mapping_url: Option<js_ast::Span>,
    pub(crate) number: f64,
    pub(crate) rescan_close_brace_as_template_token: bool,
    pub(crate) prev_error_loc: Loc,
    pub(crate) prev_token_was_await_keyword: bool,
    pub(crate) fn_or_arrow_start_loc: Loc,
    pub(crate) regex_flags_start: Option<u16>,
    pub(crate) arena: &'a Arena,
    pub(crate) string_literal_raw_content: &'a [u8],
    pub(crate) string_literal_start: usize,
    pub(crate) string_literal_raw_format: StringLiteralRawFormat,
    pub(crate) temp_buffer_u16: Vec<u16>,
    pub(crate) track_comments: bool,
    pub(crate) track_react_suppressions: bool,
    /// `@name`, an intrinsic in the source of one of JavaScriptCore's builtins, is a name like any other.
    pub(crate) jsc_builtin_syntax: bool,
    pub(crate) all_comments: Vec<Range>,
    /// Parallel to `all_comments`, in tolerant mode: the `sema::comments::flags` of each comment.
    pub(crate) comment_flags: Vec<u8>,
    /// `fullStartPos`: the end of the previous token.
    pub(crate) token_full_start: usize,
    /// `Scanner.commentDirectives`. Tolerant mode only: see `sema::comments`.
    pub(crate) comment_directives: Vec<bun_sema::hir::CommentDirective>,
    /// `lastLineStart` of the most recently scanned `/* */` comment.
    pub(crate) last_line_start: usize,
    /// `skipJSDocLeadingAsterisks`: a type in a JSDoc comment is being scanned, where the first `*` of a line is trivia. Set for the
    /// type checker only.
    pub(crate) skips_jsdoc_asterisks: bool,
    /// End of the `*` most recently skipped as trivia.
    jsdoc_asterisk_end: usize,
}

impl<'a> LexerLog<'a> for Lexer<'a> {
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

impl<'a> Lexer<'a> {
    /// Reborrow the shared `Log`. The `&self` receiver lets call sites pass
    /// other `self.*` fields as arguments without a borrow-checker conflict;
    /// callers must not hold two results of `log()` (or a result alongside the
    /// parser's `P::log()`) live at once.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn log(&self) -> &mut Log {
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
    pub(crate) fn add_range_error_with_notes(
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

        Ok(())
    }

    /// Capture a `Copy` snapshot of all backtrack-relevant state. See
    /// `LexerSnapshot` doc.
    pub(crate) fn snapshot(&self) -> LexerSnapshot<'a> {
        LexerSnapshot {
            current: self.current,
            start: self.start,
            end: self.end,
            token_full_start: self.token_full_start,
            approximate_newline_count: self.approximate_newline_count,
            previous_backslash_quote_in_jsx: self.previous_backslash_quote_in_jsx,
            token: self.token,
            has_newline_before: self.has_newline_before,
            has_pure_comment_before: self.has_pure_comment_before,
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
            fn_or_arrow_start_loc: self.fn_or_arrow_start_loc,
            regex_flags_start: self.regex_flags_start,
            string_literal_raw_content: self.string_literal_raw_content,
            string_literal_start: self.string_literal_start,
            string_literal_raw_format: self.string_literal_raw_format,
            track_comments: self.track_comments,
            track_react_suppressions: self.track_react_suppressions,
            list_contexts: self.list_contexts,
            await_name_seen: self.await_name_seen,
            all_comments_len: self.all_comments.len(),
            comment_directives_len: self.comment_directives.len(),
            comments_to_preserve_before_len: self.comments_to_preserve_before.len(),
        }
    }

    /// Rewind to a prior `snapshot()`: copy each scalar field and
    /// truncate the Vecs to their snapshotted lengths. `log`/`source`/`arena`
    /// are left untouched.
    pub(crate) fn restore(&mut self, original: &LexerSnapshot<'a>) {
        // Keep this field list in sync with `snapshot()` and the Lexer struct fields.
        self.current = original.current;
        self.start = original.start;
        self.end = original.end;
        self.token_full_start = original.token_full_start;
        self.approximate_newline_count = original.approximate_newline_count;
        self.previous_backslash_quote_in_jsx = original.previous_backslash_quote_in_jsx;
        self.token = original.token;
        self.has_newline_before = original.has_newline_before;
        self.has_pure_comment_before = original.has_pure_comment_before;
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
        self.rescan_close_brace_as_template_token = original.rescan_close_brace_as_template_token;
        self.prev_error_loc = original.prev_error_loc;
        self.prev_token_was_await_keyword = original.prev_token_was_await_keyword;
        self.fn_or_arrow_start_loc = original.fn_or_arrow_start_loc;
        self.regex_flags_start = original.regex_flags_start;
        self.string_literal_raw_content = original.string_literal_raw_content;
        self.string_literal_start = original.string_literal_start;
        self.string_literal_raw_format = original.string_literal_raw_format;
        self.track_comments = original.track_comments;
        self.track_react_suppressions = original.track_react_suppressions;
        self.list_contexts = original.list_contexts;
        self.await_name_seen = original.await_name_seen;

        debug_assert!(self.all_comments.len() >= original.all_comments_len);
        debug_assert!(
            self.comments_to_preserve_before.len() >= original.comments_to_preserve_before_len
        );
        debug_assert!(self.temp_buffer_u16.is_empty());

        self.all_comments.truncate(original.all_comments_len);
        self.comment_flags.truncate(original.all_comments_len);
        self.comment_directives
            .truncate(original.comment_directives_len);
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
    pub(crate) fn is_identifier_or_keyword(&self) -> bool {
        (self.token as u32) >= (T::TIdentifier as u32)
    }

    // deinit → Drop (see impl Drop below)

    fn decode_escape_sequences(
        &mut self,
        start: usize,
        text: &[u8],
        buf: &mut Vec<u16>,
    ) -> Result<(), Error> {
        let iterator = CodepointIterator::init(text);
        let mut iter = strings::Cursor::default();
        'text: while iterator.next(&mut iter) {
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
                            if self.tolerant {
                                iter.i =
                                    self.octal_escape(start, text, iter.i as usize, buf) as u32;
                                continue;
                            }

                            let octal_start = (iter.i as usize + width2 as usize).saturating_sub(2);

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
                                // `octal_start` is text-relative like `iter.i`;
                                // map back to absolute source position the same
                                // way every sibling error path does (e.g.
                                // `start + hex_start` in the `\u{}` branch).
                                self.add_range_error(
                                    Range {
                                        loc: Loc {
                                            start: i32::try_from(start + octal_start)
                                                .expect("int cast"),
                                        },
                                        len: i32::try_from(iter.i as usize - octal_start).unwrap(),
                                    },
                                    format_args!("Invalid legacy octal literal"),
                                )
                                .expect("unreachable");
                            }
                        }
                        0x38 | 0x39 => {
                            if self.tolerant {
                                // `scanEscapeSequence`: reported, and it decodes to the digit. In a
                                // tagged template it decodes to its own source text.
                                let escape = [b'\\', c2 as u8];
                                self.escape_error_about(
                                    start,
                                    iter.i as usize - 1,
                                    2,
                                    1488,
                                    Some(&escape),
                                );
                                if self.is_under_tag {
                                    buf.push(u16::from(b'\\'));
                                }
                            }
                            iter.c = c2;
                        }
                        // 2-digit hexadecimal
                        0x78 => {
                            let mut value: CodePoint = 0;
                            let mut c3: CodePoint;
                            let mut width3: u8;

                            if !iterator.next(&mut iter) {
                                if self.tolerant {
                                    self.bad_escape(start, text, text.len(), buf);
                                    return Ok(());
                                }
                                return self.syntax_error();
                            }
                            c3 = iter.c;
                            width3 = iter.width;
                            match hex_digit_value_u32(c3 as u32) {
                                Some(d) => value = (value * 16) | d as CodePoint,
                                None => {
                                    if self.tolerant {
                                        self.bad_escape(start, text, iter.i as usize, buf);
                                        iter.width = 0;
                                        continue 'text;
                                    }
                                    self.end =
                                        (start + iter.i as usize).saturating_sub(width3 as usize);
                                    return self.syntax_error();
                                }
                            }

                            if !iterator.next(&mut iter) {
                                if self.tolerant {
                                    self.bad_escape(start, text, text.len(), buf);
                                    return Ok(());
                                }
                                return self.syntax_error();
                            }
                            c3 = iter.c;
                            width3 = iter.width;
                            match hex_digit_value_u32(c3 as u32) {
                                Some(d) => value = (value * 16) | d as CodePoint,
                                None => {
                                    if self.tolerant {
                                        self.bad_escape(start, text, iter.i as usize, buf);
                                        iter.width = 0;
                                        continue 'text;
                                    }
                                    self.end =
                                        (start + iter.i as usize).saturating_sub(width3 as usize);
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
                                if self.tolerant {
                                    self.bad_escape(start, text, text.len(), buf);
                                    return Ok(());
                                }
                                return self.syntax_error();
                            }
                            let mut c3 = iter.c;
                            let mut width3 = iter.width;

                            // variable-length
                            if c3 == 0x7B {
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
                                        if self.tolerant {
                                            self.bad_extended_escape(
                                                start,
                                                text,
                                                text.len(),
                                                is_out_of_range,
                                                buf,
                                            );
                                            return Ok(());
                                        }
                                        return self.syntax_error();
                                    }
                                    c3 = iter.c;

                                    if c3 == 0x7D {
                                        if is_first {
                                            if self.tolerant {
                                                self.bad_extended_escape(
                                                    start,
                                                    text,
                                                    iter.i as usize,
                                                    false,
                                                    buf,
                                                );
                                                iter.width = 0;
                                                continue 'text;
                                            }
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
                                            if self.tolerant {
                                                self.bad_extended_escape(
                                                    start,
                                                    text,
                                                    iter.i as usize,
                                                    is_out_of_range,
                                                    buf,
                                                );
                                                iter.width = 0;
                                                continue 'text;
                                            }
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
                                    if self.tolerant {
                                        self.bad_extended_escape(
                                            start,
                                            text,
                                            iter.i as usize,
                                            true,
                                            buf,
                                        );
                                        continue 'text;
                                    }
                                    self.add_range_error(
                                        Range {
                                            loc: Loc {
                                                start: i32::try_from(start + hex_start).unwrap(),
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
                                            if self.tolerant {
                                                self.bad_escape(start, text, iter.i as usize, buf);
                                                iter.width = 0;
                                                continue 'text;
                                            }
                                            self.end = (start + iter.i as usize)
                                                .saturating_sub(width3 as usize);
                                            return self.syntax_error();
                                        }
                                    }

                                    if j < 3 {
                                        if !iterator.next(&mut iter) {
                                            if self.tolerant {
                                                self.bad_escape(start, text, text.len(), buf);
                                                return Ok(());
                                            }
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
                        0x0D => {
                            // Make sure Windows CRLF counts as a single newline
                            let next_i: usize = iter.i as usize + 1;
                            iter.i += (next_i < text.len() && text[next_i] == b'\n') as u32;

                            // Ignore line continuations. A line continuation is not an escaped newline.
                            continue;
                        }
                        0x0A | 0x2028 | 0x2029 => {
                            // Ignore line continuations. A line continuation is not an escaped newline.
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
                    if self.code_point == 0x0D {
                        self.step_with(contents);
                        if self.code_point == 0x0A {
                            self.step_with(contents);
                        }
                        continue 'string_literal;
                    }

                    match self.code_point {
                        // 0 cannot be in this list because it may be a legacy octal literal
                        0x60 | 0x27 | 0x22 | 0x5C => {
                            self.step_with(contents);
                            continue 'string_literal;
                        }
                        _ => {}
                    }
                }
                // This indicates the end of the file
                -1 => {
                    if QUOTE != 0 {
                        if !self.tolerate_unterminated(QUOTE) {
                            self.add_default_error(b"Unterminated string literal")?;
                        }
                        suffix_len = 0;
                    }
                    break 'string_literal;
                }

                0x0D => {
                    if QUOTE != 0x60 {
                        if !self.tolerate_unterminated(QUOTE) {
                            self.add_default_error(b"Unterminated string literal")?;
                        }
                        suffix_len = 0;
                        break 'string_literal;
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
                            if !self.tolerate_unterminated(QUOTE) {
                                self.add_default_error(b"Unterminated string literal")?;
                            }
                            suffix_len = 0;
                            break 'string_literal;
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
                    } else if (QUOTE == 0x22 || QUOTE == 0x27) && Environment::IS_NATIVE {
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
    pub(crate) fn parse_string_literal<const QUOTE: i32>(&mut self) -> Result<(), Error> {
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
        let base = if QUOTE == 0 {
            self.start
        } else {
            self.start + 1
        };
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
            let at = self.prev_error_loc;
            self.expected(token)?;
            if self.tolerant {
                return self.put_up_with(at);
            }
        }
        self.next()
    }

    /// `parseExpectedMatchingBrackets`: `expect` for the bracket that closes the one at `open`.
    #[inline]
    pub(crate) fn expect_closing(&mut self, token: T, open: Loc) -> Result<(), Error> {
        if self.token != token && self.tolerant {
            let at = self.prev_error_loc;
            self.expected_closing(token, open)?;
            return self.put_up_with(at);
        }
        self.expect(token)
    }

    /// `expected` for the bracket that closes the one at `open`. If the error is reported, and not
    /// dropped for being at the position of the previous error, the position of the opening bracket
    /// is attached to it, unless the opening bracket was missing too. Tolerant mode only.
    #[cold]
    #[inline(never)]
    pub(crate) fn expected_closing(&mut self, token: T, open: Loc) -> Result<(), Error> {
        let said_before = self.log().msgs.len();
        self.expected(token)?;
        let opening = match token {
            T::TCloseParen => b'(',
            T::TCloseBracket => b'[',
            _ => b'{',
        };
        if self.log().msgs.len() > said_before
            && self.contents.get(open.to_usize()) == Some(&opening)
        {
            self.note_opening_bracket(said_before, opening, open);
        }
        Ok(())
    }

    /// `parseImportAttributes`, `parseImportType`: `expect` for the "}" of the construct that opens
    /// at `open`. If it is missing, the position of `open` is attached to the parser's most recent
    /// error, whatever that error is, provided it is about an expected token.
    pub(crate) fn expect_close_brace_of_attributes(&mut self, open: Loc) -> Result<(), Error> {
        if self.token == T::TCloseBrace || !self.tolerant {
            return self.expect(T::TCloseBrace);
        }
        let at = self.prev_error_loc;
        self.expected(T::TCloseBrace)?;
        // Skips the messages that `ts_grammar_error` and `ts_checker_error` log: those are checker
        // errors.
        let last = self.log().msgs.iter().rposition(|msg| {
            msg.kind == bun_ast::Kind::Err
                && !matches!(
                    msg.metadata,
                    bun_ast::Metadata::TypeScript {
                        kind: TypeScriptKind::Grammar | TypeScriptKind::Checker,
                        ..
                    }
                )
        });
        if let Some(last) = last
            && matches!(
                crate::sema::early_error(&self.log().msgs[last], b""),
                Some((1005, _))
            )
        {
            self.note_opening_bracket(last, b'{', open);
        }
        self.put_up_with(at)
    }

    /// `parseExpectedMatchingBrackets`: attaches the position of the `opening` bracket to log message `index` as related info.
    fn note_opening_bracket(&mut self, index: usize, opening: u8, open: Loc) {
        let text: &'static [u8] = match opening {
            b'(' => b"(\0)",
            b'[' => b"[\0]",
            _ => b"{\0}",
        };
        self.add_related_info(index, Range { loc: open, len: 0 }, text);
    }

    /// `AddRelatedInfo` for log message `index`, with the range `r`. `text`: the arguments, in the format of `ts_error_about`. Which
    /// message it is follows from the error: see `sema::diagnostic`.
    #[cold]
    #[inline(never)]
    pub(crate) fn add_related_info(&mut self, index: usize, r: Range, text: &'static [u8]) {
        let note = bun_ast::range_data(Some(self.source), r, text);
        let msg = &mut self.log().msgs[index];
        let mut notes = core::mem::take(&mut msg.notes).into_vec();
        notes.push(note);
        msg.notes = notes.into_boxed_slice();
    }

    /// Logs an error by its TypeScript error code. Only in tolerant mode: only the type checker
    /// reads it.
    /// Like any other error it is dropped if the previous error was at the same position, which is
    /// TypeScript's own rule.
    pub(crate) fn ts_error(&mut self, r: Range, code: u32) {
        self.log_ts_error(TypeScriptKind::Parse, r, code, None);
    }

    /// `ts_error` for an error whose message takes the argument `what` (`{0}`; a NUL precedes
    /// `{1}`).
    pub(crate) fn ts_error_about(&mut self, r: Range, code: u32, what: &[u8]) {
        self.log_ts_error(TypeScriptKind::Parse, r, code, Some(what));
    }

    /// The text of the message is `what`.
    #[cold]
    #[inline(never)]
    pub(crate) fn log_ts_error(
        &mut self,
        kind: TypeScriptKind,
        r: Range,
        code: u32,
        what: Option<&[u8]>,
    ) {
        debug_assert!(self.tolerant);
        if self.is_log_disabled {
            self.swallowed += 1;
            return;
        }
        // One empty argument is not no argument: `JSX element '' has no corresponding closing tag`.
        let what = if what == Some(b"") {
            Some(&b"\0"[..])
        } else {
            what
        };
        let what = bstr::BStr::new(what.unwrap_or_default());
        let logged_before = self.log().msgs.len();
        if kind == TypeScriptKind::Parse {
            let _ = self.add_range_error(r, format_args!("{what}"));
        } else {
            let text = format_args!("{what}");
            self.log().add_range_error_fmt(Some(self.source), r, text);
        }
        // Dropped if the previous error was at the same position.
        if let Some(msg) = self.log().msgs.get_mut(logged_before) {
            msg.metadata = bun_ast::Metadata::TypeScript { code, kind };
        }
    }

    /// The range from `start` to the end of the previous token.
    #[inline]
    pub(crate) fn range_from(&self, start: Loc) -> Range {
        Range {
            loc: start,
            len: self.token_full_start as i32 - start.start,
        }
    }

    /// `'{0}' expected.`, of `token`.
    pub(crate) fn ts_expected(&mut self, r: Range, token: &str) {
        self.ts_error_about(r, 1005, token.as_bytes());
    }

    /// The same, for an error that TypeScript's checker reports (`ts_grammar_error`).
    pub(crate) fn ts_grammar_expected(&mut self, r: Range, token: &str) {
        self.ts_grammar_error_about(r, 1005, token.as_bytes());
    }

    /// Logs an error that TypeScript's checker reports through `grammarErrorOnNode`, not its parser. It is only reported if
    /// the file has no syntax errors, and the rule of one error per position (`parseErrorAtRange`) does not apply to it.
    pub(crate) fn ts_grammar_error(&mut self, r: Range, code: u32) {
        self.log_ts_error(TypeScriptKind::Grammar, r, code, None);
    }

    /// The same, for an error whose message takes the argument `what`.
    pub(crate) fn ts_grammar_error_about(&mut self, r: Range, code: u32, what: &[u8]) {
        self.log_ts_error(TypeScriptKind::Grammar, r, code, Some(what));
    }

    /// `NodeFlagsJavaScriptFile`. The type checker has JavaScript parsed as TypeScript with JSX. Always false outside tolerant mode.
    #[inline]
    pub(crate) fn is_javascript_file(&self) -> bool {
        self.tolerant && self.has_javascript_extension()
    }

    #[cold]
    #[inline(never)]
    fn has_javascript_extension(&self) -> bool {
        bun_sema::resolve::is_javascript(self.source.path.text)
    }

    /// `TokenFullStart`, `nodePos()`: the end of the previous token, before the leading trivia
    /// (whitespace and comments) of the current token.
    #[inline]
    pub(crate) fn full_start(&self) -> Loc {
        bun_ast::usize2loc(self.token_full_start)
    }

    /// Whether a comment starts at or after `from` and before `to`.
    pub(crate) fn has_comment_between(&self, from: Loc, to: Loc) -> bool {
        let first = self
            .all_comments
            .partition_point(|comment| comment.loc.start < from.start);
        self.all_comments
            .get(first)
            .is_some_and(|comment| comment.loc.start < to.start)
    }

    /// Whether scanning may continue after an error that TypeScript's scanner only reports: logs
    /// `code` at `at`.
    /// Not during a speculative parse, which must fail.
    #[cold]
    #[inline(never)]
    fn tolerate(&mut self, at: usize, len: usize, code: u32) -> bool {
        if !self.tolerant || self.is_log_disabled {
            return false;
        }
        self.ts_error(
            Range {
                loc: bun_ast::usize2loc(at),
                len: len as i32,
            },
            code,
        );
        true
    }

    /// A string that reaches the end of its line or of the source text, or a template that reaches
    /// the end of the source text (`scanString`, `scanTemplateAndSetTokenValue`): the error is
    /// reported there and the literal ends there, before the line break.
    /// `false`: the error is not tolerated.
    #[cold]
    #[inline(never)]
    fn tolerate_unterminated(&mut self, quote: i32) -> bool {
        if !self.tolerant || self.is_log_disabled {
            return false;
        }
        let at = self.end;
        let text: &'a [u8] = &self.contents[(self.start + 1).min(at)..at];
        self.unterminated_at = usize::MAX;
        if quote != 0x60 {
            // TypeScript decodes the escape sequences of a string before it reaches this point:
            // their errors are reported first, and suppress the error reported here if it is at the
            // same position.
            let mut scratch = core::mem::take(&mut self.temp_buffer_u16);
            let _ = self.decode_escape_sequences(self.start + 1, text, &mut scratch);
            scratch.clear();
            self.temp_buffer_u16 = scratch;
        }
        self.unterminated_at = self.start;
        // `scanEscapeSequence`: a backslash followed by nothing, also in a tagged template.
        let ends_in_backslash = text.iter().rev().take_while(|&&c| c == b'\\').count() % 2 == 1;
        let code = if ends_in_backslash {
            1126
        } else if quote == 0x60 {
            1160
        } else {
            1002
        };
        self.tolerate(at, 0, code)
    }

    /// Logs an error of `scanEscapeSequence` at offset `at` in a text that starts at `start`.
    #[cold]
    #[inline(never)]
    fn escape_error(&mut self, start: usize, at: usize, len: usize, code: u32) {
        self.escape_error_about(start, at, len, code, None);
    }

    /// The same, for an error whose message takes the argument `what`.
    #[cold]
    #[inline(never)]
    fn escape_error_about(
        &mut self,
        start: usize,
        at: usize,
        len: usize,
        code: u32,
        what: Option<&[u8]>,
    ) {
        if self.is_under_tag {
            return;
        }
        let is_unterminated = start.checked_sub(1) == Some(self.unterminated_at);
        // TypeScript decodes the escape sequences of a string while scanning it: those of an
        // unterminated string were processed then, and are not reported again when its value is
        // requested.
        if is_unterminated && matches!(self.contents[self.unterminated_at], b'"' | b'\'') {
            return;
        }
        let range = Range {
            loc: bun_ast::usize2loc(start + at),
            len: len as i32,
        };
        self.log_ts_error(TypeScriptKind::Parse, range, code, what);
        // It decodes those of a template in a second scan (`reScanTemplateToken`), which reaches
        // the end of the source text again and reports the same error for it, so that is the
        // position of the last error.
        if is_unterminated && !self.is_log_disabled {
            self.prev_error_loc = bun_ast::usize2loc(self.contents.len());
        }
    }

    /// `scanEscapeSequence` on `\0` to `\7`; `digit` is the index of the first digit in `text`.
    /// `\0` not followed by a digit is NUL. Anything else consumes up to three octal digits, two if
    /// it starts with `4` to `7`, is reported, and decodes to the character with that code. Returns
    /// the index of the last digit in `text`.
    #[cold]
    #[inline(never)]
    fn octal_escape(
        &mut self,
        start: usize,
        text: &[u8],
        digit: usize,
        buf: &mut Vec<u16>,
    ) -> usize {
        let is_octal = |i: usize| matches!(text.get(i), Some(b'0'..=b'7'));
        let mut end = digit + 1;
        if text[digit] == b'0' && !text.get(end).is_some_and(u8::is_ascii_digit) {
            buf.push(0);
            return digit;
        }
        if text[digit] <= b'3' && is_octal(end) {
            end += 1;
        }
        if is_octal(end) {
            end += 1;
        }
        if self.is_under_tag {
            buf.extend(text[digit - 1..end].iter().map(|&b| u16::from(b)));
            return end - 1;
        }
        let code = text[digit..end]
            .iter()
            .fold(0u16, |code, &b| code * 8 + u16::from(b - b'0'));
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let escape = [
            b'\\',
            b'x',
            HEX[usize::from(code >> 4) & 15],
            HEX[usize::from(code) & 15],
        ];
        self.escape_error_about(start, digit - 1, end + 1 - digit, 1487, Some(&escape));
        buf.push(code);
        end - 1
    }

    /// `scanEscapeSequence` on `\x` or `\uXXXX` with too few digits: 1125 where the scan stopped,
    /// which is index `stop` in `text`, and the escape decodes to its own source text.
    #[cold]
    #[inline(never)]
    fn bad_escape(&mut self, start: usize, text: &[u8], stop: usize, buf: &mut Vec<u16>) {
        self.escape_error(start, stop, 0, 1125);
        let backslash = last_backslash(&text[..stop]);
        buf.extend(text[backslash..stop].iter().map(|&b| u16::from(b)));
    }

    /// `scanUnicodeEscape` on a malformed `\u{` escape, which decodes to its own source text.
    /// `stop`: the index in `text` where its digits end.
    #[cold]
    #[inline(never)]
    fn bad_extended_escape(
        &mut self,
        start: usize,
        text: &[u8],
        stop: usize,
        is_out_of_range: bool,
        buf: &mut Vec<u16>,
    ) {
        let backslash = last_backslash(&text[..stop]);
        let digits = backslash + 3;
        let mut end = stop;
        if stop == digits {
            self.escape_error(start, stop, 0, 1125);
        } else {
            if is_out_of_range {
                self.escape_error(start, digits, stop - digits, 1198);
            }
            if start + stop >= self.contents.len() {
                self.escape_error(start, stop, 0, 1126);
            } else if text.get(stop) == Some(&b'}') {
                end += 1;
            } else {
                self.escape_error(start, stop, 0, 1199);
            }
        }
        buf.extend(text[backslash..end].iter().map(|&b| u16::from(b)));
    }

    /// The identifier contains an escape sequence and the parser expects the keyword it spells:
    /// `nextToken` reports 1260, and the token is that keyword.
    #[cold]
    #[inline(never)]
    pub(crate) fn unescape_keyword(&mut self) {
        debug_assert!(self.tolerant && self.token == T::TEscapedKeyword);
        let r = self.range();
        self.ts_error(r, 1260);
        self.token = tables::keyword(self.identifier).unwrap_or(T::TIdentifier);
    }

    /// A JSX name that contains `\u` escapes. TypeScript scans and decodes them
    /// (`ScanJsxIdentifier`, `scanIdentifierParts`) and then reports an error
    /// (`parseIdentifierNameErrorOnUnicodeEscapeSequence`). The name starts at `self.start`; the
    /// lexer is at a backslash. `false`: the backslash does not start an escape that is valid here,
    /// and nothing was consumed.
    #[cold]
    #[inline(never)]
    fn jsx_identifier_with_escapes(&mut self) -> bool {
        if self.is_log_disabled {
            return false;
        }
        let mut name: Vec<u8> = self.contents[self.start..self.end].to_vec();
        let mut has_escape = false;
        loop {
            if self.code_point == 0x5C {
                let Some((c, len)) = peek_unicode_escape(self.contents, self.end) else {
                    break;
                };
                let fits = if name.is_empty() {
                    is_identifier_start(c)
                } else {
                    is_identifier_continue(c)
                };
                let Some(c) = char::from_u32(c as u32).filter(|_| fits) else {
                    break;
                };
                name.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
                self.current = self.end + len;
                self.step();
                has_escape = true;
            } else if is_identifier_continue(self.code_point)
                || (self.code_point == 0x2D && !name.is_empty())
            {
                name.extend_from_slice(&self.contents[self.end..self.current]);
                self.step();
            } else {
                break;
            }
        }
        if !has_escape {
            return false;
        }
        self.ts_error(
            Range {
                loc: bun_ast::usize2loc(self.start),
                len: (self.end - self.start) as i32,
            },
            17021,
        );
        self.identifier = self.arena.alloc_slice_copy(&name);
        self.token = T::TIdentifier;
        true
    }

    /// `ScanJsxTokenEx`: whether the `<` the lexer is at, in JSX text that starts at `text_start`,
    /// starts a conflict marker. The marker is reported and skipped to the end of its line
    /// (`scanConflictMarkerTrivia`), and the token, which starts where the text starts, terminates
    /// the JSX children.
    #[cold]
    #[inline(never)]
    fn jsx_text_meets_conflict_marker(&mut self, text_start: usize) -> bool {
        let (text, pos) = (self.contents, self.end);
        if self.is_log_disabled || !is_conflict_marker(text, pos) {
            return false;
        }
        self.report_closers_in_jsx_text(text_start);
        self.ts_error(
            Range {
                loc: bun_ast::usize2loc(pos),
                len: 7,
            },
            1185,
        );
        let mut end = pos;
        while end < text.len() && !starts_with_line_break(&text[end..]) {
            end += 1;
        }
        self.current = end;
        self.step();
        self.start = text_start;
        self.token = T::TSyntaxError;
        true
    }

    /// Call after reporting an error without consuming the token. `before`: the position of the previous error. Fails after too many
    /// errors in a row at one position, which stops a loop that makes no progress. The limit is above any nesting depth the stack
    /// allows, because every open bracket reports one error at the end of the file while the parser unwinds.
    #[cold]
    #[inline(never)]
    pub(crate) fn put_up_with(&mut self, before: Loc) -> Result<(), Error> {
        if before.eql(self.loc()) {
            self.stuck += 1;
            if self.stuck > 1 << 20 {
                return Err(Error::SyntaxError);
            }
        } else {
            self.stuck = 0;
        }
        Ok(())
    }

    #[inline]
    pub(crate) fn expect_or_insert_semicolon(&mut self) -> Result<(), Error> {
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
    pub(crate) fn add_unsupported_syntax_error(&mut self, msg: &[u8]) -> Result<(), Error> {
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
    pub(crate) fn scan_identifier_with_escapes(
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
                if self.tolerant {
                    // `Scan`, `scanIdentifierParts`: an escape is part of the identifier only if it
                    // is well formed and by itself decodes to an identifier character.
                    let is_first =
                        self.end == self.start + usize::from(kind == IdentifierKind::Private);
                    let fits =
                        peek_unicode_escape(self.contents, self.end).is_some_and(|(c, _)| {
                            if is_first {
                                is_identifier_start(c)
                            } else {
                                is_identifier_continue(c)
                            }
                        });
                    if !fits && !is_first {
                        // The name ends here. The backslash is the next token.
                        break;
                    }
                    if !fits && kind == IdentifierKind::Private {
                        // "#" by itself is a private name. The backslash is the next token.
                        self.ts_error(
                            Range {
                                loc: self.loc(),
                                len: 1,
                            },
                            1127,
                        );
                        result.token = T::TPrivateIdentifier;
                        result.contents = self.raw();
                        return Ok(result);
                    }
                    if !fits {
                        // `scanInvalidCharacter`
                        self.step();
                        self.ts_error(self.range(), 1127);
                        result.token = T::TSyntaxError;
                        return Ok(result);
                    }
                }
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
                            0x30..=0x39 | 0x61..=0x66 | 0x41..=0x46 => {
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
                            0x30..=0x39 | 0x61..=0x66 | 0x41..=0x46 => {
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
        let decode_res = self.decode_escape_sequences(self.start, original_text, &mut tmp);
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
        // The name ended at a backslash that does not start an escape, before any escape was
        // scanned.
        if self.tolerant && !bun_core::strings::contains_char(original_text, b'\\') {
            result.token = tables::keyword(result.contents).unwrap_or(T::TIdentifier);
        }

        Ok(result)
    }

    pub(crate) fn expect_contextual_keyword(
        &mut self,
        keyword: &'static [u8],
    ) -> Result<(), Error> {
        if !self.is_contextual_keyword(keyword) {
            if self.tolerant && !self.is_log_disabled {
                // `parseExpected`
                let before = self.prev_error_loc;
                let r = self.range();
                self.ts_expected(r, std::str::from_utf8(keyword).unwrap_or_default());
                return self.put_up_with(before);
            }
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

    pub(crate) fn maybe_expand_equals(&mut self) -> Result<(), Error> {
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

    /// The first character of the current token has been consumed. `rest` is the remainder of the
    /// token.
    #[inline]
    fn split_token(&mut self, rest: T) {
        self.token = rest;
        self.start += 1;
        self.token_full_start = self.start;
    }

    pub(crate) fn expect_less_than<const IS_INSIDE_JSX_ELEMENT: bool>(
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
                self.split_token(T::TEquals);
                self.maybe_expand_equals()?;
            }
            T::TLessThanLessThan => {
                self.split_token(T::TLessThan);
            }
            T::TLessThanLessThanEquals => {
                self.split_token(T::TLessThanEquals);
            }
            _ => {
                self.expected(T::TLessThan)?;
            }
        }
        Ok(())
    }

    pub(crate) fn expect_greater_than<const IS_INSIDE_JSX_ELEMENT: bool>(
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
                self.split_token(T::TEquals);
                self.maybe_expand_equals()?;
            }

            T::TGreaterThanGreaterThanEquals => {
                self.split_token(T::TGreaterThanEquals);
            }

            T::TGreaterThanGreaterThanGreaterThanEquals => {
                self.split_token(T::TGreaterThanGreaterThanEquals);
            }

            T::TGreaterThanGreaterThan => {
                self.split_token(T::TGreaterThan);
            }

            T::TGreaterThanGreaterThanGreaterThan => {
                self.split_token(T::TGreaterThanGreaterThan);
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
        self.token_full_start = self.end;
        self.has_newline_before = self.end == 0;
        self.has_pure_comment_before = false;
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
                    if self.start == 0 && contents.len() > 1 && contents[1] == b'!' {
                        // "#!/usr/bin/env node"
                        self.token = T::THashbang;
                        'hashbang: loop {
                            self.step_with(contents);
                            match self.code_point {
                                0x0D | 0x0A | 0x2028 | 0x2029 => {
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
                                // The '#' case of `Scan`. Only the "#" is consumed.
                                if self.code_point == 0x21 && self.tolerate(self.start, 2, 18026) {
                                    self.token = T::TSyntaxError;
                                    return Ok(());
                                }
                                if self.tolerate(self.start, 1, 1127) {
                                    self.identifier = self.raw();
                                    self.token = T::TPrivateIdentifier;
                                    return Ok(());
                                }
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
                0x0D | 0x0A | 0x2028 | 0x2029 => {
                    self.has_newline_before = true;

                    self.step_with(contents);
                    continue;
                }
                0x09 | 0x20 => {
                    // Consumes the remaining white space at once: an indented line has many of these
                    // characters.
                    while matches!(contents.get(self.current), Some(b' ' | b'\t')) {
                        self.current += 1;
                    }
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
                    self.step_with(contents);
                    self.token = T::TSemicolon;
                }
                0x40 => {
                    self.step_with(contents);
                    if self.jsc_builtin_syntax && is_identifier_start(self.code_point) {
                        while is_identifier_continue(self.code_point) {
                            self.step_with(contents);
                        }
                        self.identifier = self.raw();
                        self.token = T::TIdentifier;
                    } else {
                        self.token = T::TAt;
                    }
                }
                0x7E => {
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
                            } else if self.tolerant {
                                // TypeScript's `Scan`: at the end of the source text no digit
                                // follows.
                                self.step_with(contents);
                                self.token = T::TQuestionDot;
                            }
                        }
                        _ => {
                            self.token = T::TQuestion;
                        }
                    }
                }
                0x25 => {
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
                                    if self.code_point == 0x7C
                                        && self.tolerant
                                        && self.skip_conflict_marker()
                                    {
                                        continue;
                                    }
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
                            self.step_with(contents);
                            self.token = T::TMinusEquals;
                        }
                        0x2D => {
                            self.step_with(contents);

                            // TypeScript's `Scan` does not recognize HTML comments.
                            if self.code_point == 0x3E && self.has_newline_before && !self.tolerant
                            {
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
                            if self.skips_jsdoc_asterisks && self.skip_jsdoc_asterisk() {
                                continue;
                            }
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
                            self.scan_comment_text(false);
                            continue;
                        }
                        0x2A => {
                            // The `/* ... */` scan loop + its SIMD skip is pulled
                            // out of line so it doesn't bloat the hot ASCII
                            // identifier / whitespace / punctuator arms of
                            // `next()` (`scan_single_line_comment` is outlined the
                            // same way).
                            self.scan_multi_line_comment_body()?;
                            self.scan_comment_text(true);
                            continue;
                        }
                        _ => {
                            self.token = T::TSlash;
                        }
                    }
                }

                0x3D => {
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
                                    if self.code_point == 0x3D
                                        && self.tolerant
                                        && self.skip_conflict_marker()
                                    {
                                        continue;
                                    }
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
                                    if self.code_point == 0x3C
                                        && self.tolerant
                                        && self.skip_conflict_marker()
                                    {
                                        continue;
                                    }
                                    self.token = T::TLessThanLessThan;
                                }
                            }
                        }
                        // Handle legacy HTML-style comments
                        0x21 => {
                            // TypeScript's `Scan` does not recognize HTML comments.
                            if self.peek("--".len()) == b"--" && !self.tolerant {
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
                                            self.token =
                                                T::TGreaterThanGreaterThanGreaterThanEquals;
                                        }
                                        _ => {
                                            if self.code_point == 0x3E
                                                && self.tolerant
                                                && self.skip_conflict_marker()
                                            {
                                                continue;
                                            }
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

                0x5F | 0x24 | 0x61..=0x7A | 0x41..=0x5A => {
                    let advance = latin1_identifier_continue_length(&contents[self.current..]);

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
                        self.token = tables::keyword(self.identifier).unwrap_or(T::TIdentifier);
                    } else {
                        let scan_result =
                            self.scan_identifier_with_escapes(IdentifierKind::Normal)?;
                        self.identifier = scan_result.contents;
                        self.token = scan_result.token;
                    }
                }

                0x5C => {
                    let scan_result = self.scan_identifier_with_escapes(IdentifierKind::Normal)?;
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
                            let scan_result =
                                self.scan_identifier_with_escapes(IdentifierKind::Normal)?;
                            self.identifier = scan_result.contents;
                            self.token = scan_result.token;
                        } else {
                            self.token = T::TIdentifier;
                            self.identifier = self.raw();
                        }
                        break;
                    }

                    if self.tolerant && self.rest_is_no_text() {
                        return Ok(());
                    }

                    // TypeScript's `IsWhiteSpaceSingleLine` accepts two more code points than
                    // ECMAScript's WhiteSpace.
                    if self.tolerant && matches!(self.code_point, 0x85 | 0x200B) {
                        self.step_with(contents);
                        continue;
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
                    if self.tolerant {
                        // `scanInvalidCharacter`
                        self.ts_error(self.range(), 1127);
                    }
                }
            }

            return Ok(());
        }
        Ok(())
    }

    /// `Scan`: whether the token being scanned starts with U+FFFD or with invalid UTF-8
    /// (`utf8.RuneError`). The file is then treated as binary, which is reported at the start of
    /// the file, and the rest of the file is one token (`KindNonTextFileMarkerTrivia`).
    #[cold]
    #[inline(never)]
    fn rest_is_no_text(&mut self) -> bool {
        // A byte that cannot start a character is decoded as the code point equal to its value.
        let starts_no_character = matches!(
            self.contents.get(self.start),
            Some(0x80..=0xBF | 0xF8..=0xFF)
        );
        if self.code_point != 0xFFFD && !starts_no_character {
            return false;
        }
        self.ts_error(
            Range {
                loc: bun_ast::usize2loc(0),
                len: 0,
            },
            1490,
        );
        self.move_to(self.contents.len());
        self.token = T::TSyntaxError;
        true
    }

    /// `scanConflictMarkerTrivia`, if a conflict marker starts at the start of the token being
    /// scanned (`isConflictMarkerTrivia`).
    /// Otherwise returns false and scans nothing.
    #[cold]
    #[inline(never)]
    fn skip_conflict_marker(&mut self) -> bool {
        let (text, pos) = (self.contents, self.start);
        if !is_conflict_marker(text, pos) {
            return false;
        }
        self.ts_error(
            Range {
                loc: bun_ast::usize2loc(pos),
                len: 7,
            },
            1185,
        );
        let ch = text[pos];
        let mut end = pos;
        if matches!(ch, b'<' | b'>') {
            while end < text.len() && !starts_with_line_break(&text[end..]) {
                end += 1;
            }
        } else {
            // "|||||||" and "=======": everything up to the next "=======" or ">>>>>>>".
            while end < text.len()
                && !(matches!(text[end], b'=' | b'>')
                    && text[end] != ch
                    && is_conflict_marker(text, end))
            {
                end += 1;
            }
        }
        self.move_to(end);
        true
    }

    /// `Scan`, the `*` case with `skipJSDocLeadingAsterisks`: the first `*` after a line break is
    /// trivia, once in the leading trivia of each token
    /// (`TokenFlagsPrecedingJSDocLeadingAsterisks`). Called after the `*` has been scanned.
    #[cold]
    #[inline(never)]
    fn skip_jsdoc_asterisk(&mut self) -> bool {
        if !self.has_newline_before {
            return false;
        }
        // Only whitespace since the previously skipped `*`, which was in the leading trivia of the
        // same token.
        if self.jsdoc_asterisk_end != 0
            && self
                .contents
                .get(self.jsdoc_asterisk_end..self.start)
                .is_some_and(|between| trailing_whitespace_len(between) == between.len())
        {
            return false;
        }
        self.jsdoc_asterisk_end = self.end;
        true
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn expected(&mut self, token: T) -> Result<(), Error> {
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
    pub(crate) fn unexpected(&mut self) -> Result<(), Error> {
        let found: &[u8] = 'finder: {
            self.start = self.start.min(self.end);

            if self.start == self.contents.len() {
                break 'finder b"end of file";
            } else {
                break 'finder self.raw();
            }
        };

        if self.tolerant && self.is_log_disabled {
            self.swallowed += 1;
        }
        self.add_range_error(
            self.range(),
            format_args!("Unexpected {}", bstr::BStr::new(found)),
        )
    }

    #[inline(always)]
    pub(crate) fn raw(&self) -> &'a [u8] {
        // `self.contents: &'a [u8]` — slice carries `'a` directly.
        &self.contents[self.start..self.end]
    }

    pub(crate) fn is_contextual_keyword(&self, keyword: &'static [u8]) -> bool {
        self.token == T::TIdentifier && self.raw() == keyword
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn expected_string(&mut self, text: &[u8]) -> Result<(), Error> {
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
                format_args!("\"await\" can only be used inside an \"async\" function"),
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
                format_args!("Expected {} but found end of file", bstr::BStr::new(text)),
            )
        }
    }

    fn scan_comment_text(&mut self, for_pragma: bool) {
        let text = &self.contents[self.start..self.end];
        let has_legal_annotation = text.len() > 2 && text[2] == b'!';
        let is_multiline_comment = text.len() > 1 && text[1] == b'*';

        if self.track_comments || self.tolerant {
            // Save the original comment text so we can subtract comments from the
            // character frequency analysis used by symbol minification
            self.all_comments.push(self.range());
            if self.tolerant {
                self.push_comment_flags();
                self.process_comment_directive(is_multiline_comment);
            }
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
                let at_word_boundary = |s: &[u8]| s.first().is_none_or(|b| b.is_ascii_whitespace());
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

        // The type checker reads the pragmas it recognizes from `all_comments`
        // (`process_pragmas_into_fields`).
        if !for_pragma || self.tolerant {
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
                        CommentKind::MultiLine,
                        PureAnnotation::Allow,
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
        self.last_line_start = self.start;

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
                    self.last_line_start = self.end;
                }
                -1 => {
                    // TypeScript's `Scan`: the missing `*/` is reported at the end of the source
                    // text, which is where the comment ends.
                    if self.tolerate(self.end, 0, 1010) {
                        return Ok(());
                    }
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
        // Only the first `#` / `@` of a `//` comment can start a `__PURE__` annotation.
        let mut first_marker = true;
        loop {
            // Find index of newline (ASCII/Unicode), non-ASCII, '#', or '@'.
            if let Some(relative_index) =
                bun_highway::index_of_newline_or_non_ascii_or_hash_or_at(&contents[self.current..])
            {
                let absolute_index = self.current + relative_index;
                self.current = absolute_index; // Move TO the interesting char

                self.step_with(contents); // Consume the interesting char, sets code_point, advances current

                match self.code_point {
                    0x0D | 0x0A | 0x2028 | 0x2029 => {
                        // Is it a line terminator?
                        // Found the end of the comment line.
                        return; // Stop scanning. Lexer state is ready for the next token.
                    }
                    -1 => {
                        return;
                    } // EOF? Stop.

                    0x23 | 0x40 => {
                        let pragma_trigger_pos = self.end;
                        let pure = if first_marker
                            && strings::is_all_whitespace(
                                &contents[self.start + 2..pragma_trigger_pos],
                            ) {
                            PureAnnotation::Allow
                        } else {
                            PureAnnotation::Ignore
                        };
                        first_marker = false;
                        let chunk = js_ast::StoreStr::new(self.remaining());
                        self.current += self.scan_pragma(
                            pragma_trigger_pos,
                            chunk.slice(),
                            CommentKind::SingleLine,
                            pure,
                        );
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
        comment: CommentKind,
        pure: PureAnnotation,
    ) -> usize {
        // A `//` comment ends at the line break, so a pragma argument stops there.
        let allow_newline = comment == CommentKind::SingleLine;
        if pure == PureAnnotation::Allow && !self.has_pure_comment_before {
            if strings::has_prefix_with_word_boundary(chunk, b"__PURE__") {
                self.has_pure_comment_before = true;
                return "__PURE__".len();
            }
        }

        if strings::has_prefix_with_word_boundary(chunk, b"jsx") {
            if let Some(span) =
                PragmaArg::scan(self.start + offset_for_errors, b"jsx", chunk, allow_newline)
            {
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

    pub(crate) fn range(&self) -> Range {
        Range {
            loc: bun_ast::usize2loc(self.start),
            // Saturate on overflow.
            len: i32::try_from(self.end - self.start).unwrap_or(i32::MAX),
        }
    }

    /// `log` is *not* tied to `'a`: the lexer stores it as `NonNull<Log>` (see
    /// the `log` field doc) and the caller must keep the pointee alive for the
    /// lexer's lifetime. The looser bound lets `'a` (which `Ast<'a>` borrows
    /// through `arena`) outlive a stack-local scratch log.
    pub fn init_without_reading(log: &mut Log, source: &'a Source, arena: &'a Arena) -> Self {
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
            has_react_hooks_suppression_before: false,
            has_react_hooks_block_suppression: false,
            preserve_all_comments_before: false,
            is_legacy_octal_literal: false,
            is_log_disabled: false,
            tolerant: false,
            stuck: 0,
            swallowed: 0,
            is_under_tag: false,
            await_name_seen: false,
            list_contexts: 0,
            unterminated_at: usize::MAX,
            comments_to_preserve_before: Vec::new(),
            code_point: -1,
            identifier: b"",
            jsx_pragma: JSXPragma::default(),
            source_mapping_url: None,
            number: 0.0,
            rescan_close_brace_as_template_token: false,
            prev_error_loc: Loc::EMPTY,
            prev_token_was_await_keyword: false,
            fn_or_arrow_start_loc: Loc::EMPTY,
            regex_flags_start: None,
            arena,
            string_literal_raw_content: b"",
            string_literal_start: 0,
            string_literal_raw_format: StringLiteralRawFormat::Ascii,
            temp_buffer_u16: Vec::new(),
            track_comments: false,
            track_react_suppressions: false,
            jsc_builtin_syntax: false,
            all_comments: Vec::new(),
            comment_flags: Vec::new(),
            token_full_start: 0,
            comment_directives: Vec::new(),
            last_line_start: 0,
            skips_jsdoc_asterisks: false,
            jsdoc_asterisk_end: 0,
        }
    }

    pub(crate) fn to_e_string(&mut self) -> Result<js_ast::E::String, Error> {
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
                let utf16: &[u16] =
                    bytemuck::cast_slice::<u8, u16>(self.string_literal_raw_content);
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
                    let result = self.arena.alloc_slice_fill_default::<u8>(tmp.len());
                    strings::copy_utf16_into_utf8(result, &tmp);
                    js_ast::E::String::init(result)
                };
                tmp.clear();
                self.temp_buffer_u16 = tmp;
                Ok(out)
            }
        }
    }

    pub(crate) fn to_utf8_e_string(&mut self) -> Result<js_ast::E::String, Error> {
        let mut res = self.to_e_string()?;
        if self.tolerant && !res.is_utf8() {
            let text = utf16_to_wtf8(res.slice16());
            return Ok(js_ast::E::String::init(self.arena.alloc_slice_copy(&text)));
        }
        res.to_utf8(self.arena)?;
        Ok(res)
    }

    /// `Scanner.TokenValue`
    #[cold]
    #[inline(never)]
    pub(crate) fn token_value(&mut self) -> Result<Vec<u8>, Error> {
        Ok(match self.token {
            T::TStringLiteral => self.to_utf8_e_string()?.data.slice().to_vec(),
            T::TNumericLiteral => bun_sema::atom::number_to_string(self.number),
            T::TBigIntegerLiteral => [self.identifier, b"n"].concat(),
            T::TPrivateIdentifier => self.identifier.to_vec(),
            _ if self.is_identifier_or_keyword() => self.identifier.to_vec(),
            _ => self.raw().to_vec(),
        })
    }

    pub(crate) fn scan_reg_exp(&mut self) -> Result<(), Error> {
        let result = self.scan_reg_exp_strictly();
        if result.is_err() && self.tolerant && !self.is_log_disabled {
            self.end_unterminated_reg_exp();
            return Ok(());
        }
        result
    }

    fn scan_reg_exp_strictly(&mut self) -> Result<(), Error> {
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
                            0x64 | 0x67 | 0x69 | 0x6D | 0x73 | 0x75 | 0x79 | 0x76 => {
                                if !has_set_flags_start {
                                    self.regex_flags_start = Some((self.end - self.start) as u16);
                                    has_set_flags_start = true;
                                }
                                let flag = usize::from(
                                    MAX_FLAG - u8::try_from(self.code_point).expect("int cast"),
                                );
                                // `ReScanSlashToken`: the parser does not check the flags. The checker does.
                                if flags.is_set(flag) && !self.tolerant {
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
                            _ if self.tolerant => {
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

    /// `ReScanSlashToken` for a literal that is unterminated on its line (1161). It ends before the
    /// first unmatched closing bracket. Trailing whitespace and semicolons are not part of it.
    #[cold]
    #[inline(never)]
    fn end_unterminated_reg_exp(&mut self) {
        let text: &'a [u8] = self.contents;
        let body = self.start + 1;
        let end_of_body = bun_core::strings::index_of_any(&text[body..], b"\n\r")
            .map_or(text.len(), |len| body + len);
        let mut end = body;
        let (mut in_escape, mut in_quantifier) = (false, false);
        let (mut class_depth, mut group_depth) = (0u32, 0u32);
        while end < end_of_body {
            match text[end] {
                _ if in_escape => in_escape = false,
                b'\\' => in_escape = true,
                b'[' => class_depth += 1,
                b']' if class_depth != 0 => class_depth -= 1,
                _ if class_depth != 0 => {}
                b'{' => in_quantifier = true,
                b'}' if in_quantifier => in_quantifier = false,
                _ if in_quantifier => {}
                b'(' => group_depth += 1,
                b')' if group_depth != 0 => group_depth -= 1,
                b')' | b']' | b'}' => break,
                _ => {}
            }
            end += 1;
        }
        loop {
            end -= trailing_whitespace_len(&text[body..end]);
            if end == body || text[end - 1] != b';' {
                break;
            }
            end -= 1;
        }
        self.ts_error(
            Range {
                loc: bun_ast::usize2loc(self.start),
                len: (end - self.start) as i32,
            },
            1161,
        );
        self.regex_flags_start = None;
        self.move_to(end);
    }

    pub(crate) fn utf16_to_string(&self, js: JavascriptString<'_>) -> &'a [u8] {
        // Transcode into a temporary Vec and dupe into the arena.
        let owned = strings::to_utf8_alloc_with_type(js);
        self.arena.alloc_slice_copy(&owned)
    }

    pub(crate) fn next_inside_jsx_element(&mut self) -> Result<(), Error> {
        self.token_full_start = self.end;
        self.has_newline_before = false;

        loop {
            self.start = self.end;
            self.token = T::TEndOfFile;

            match self.code_point {
                -1 => {
                    self.token = T::TEndOfFile;
                }
                0x0D | 0x0A | 0x2028 | 0x2029 => {
                    self.step();
                    self.has_newline_before = true;
                    continue;
                }
                0x09 | 0x20 => {
                    self.step();
                    continue;
                }
                0x2E => {
                    // `...` is one token.
                    if self.tolerant {
                        return self.next_ordinary_token_inside_jsx_element();
                    }
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
                                    0x0D | 0x0A | 0x2028 | 0x2029 => {
                                        break 'single_line_comment;
                                    }
                                    -1 => {
                                        break 'single_line_comment;
                                    }
                                    _ => {}
                                }
                            }
                            if self.tolerant {
                                self.all_comments.push(self.range());
                                self.push_comment_flags();
                                self.process_comment_directive(false);
                            }
                            continue;
                        }
                        0x2A => {
                            self.step();
                            self.last_line_start = self.start;
                            'multi_line_comment: loop {
                                match self.code_point {
                                    0x2A => {
                                        self.step();
                                        if self.code_point == 0x2F {
                                            self.step();
                                            break 'multi_line_comment;
                                        }
                                    }
                                    0x0D | 0x0A | 0x2028 | 0x2029 => {
                                        self.step();
                                        self.has_newline_before = true;
                                        self.last_line_start = self.end;
                                    }
                                    -1 => {
                                        // As in `scan_multi_line_comment_body`.
                                        if self.tolerate(self.end, 0, 1010) {
                                            break 'multi_line_comment;
                                        }
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
                            if self.tolerant {
                                self.all_comments.push(self.range());
                                self.push_comment_flags();
                                self.process_comment_directive(true);
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
                        while is_identifier_continue(self.code_point) || self.code_point == 0x2D {
                            self.step();
                        }

                        // `ScanJsxIdentifier`: the name continues with an escape.
                        if self.code_point == 0x5C
                            && self.tolerant
                            && self.jsx_identifier_with_escapes()
                        {
                            break;
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
                            } else if self.tolerant {
                                // `parseJsxTagName`: the colon is a separate token. See
                                // `JSXTag::parse_namespaced_name`.
                                self.move_to(self.end - 1);
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

                    if self.tolerant {
                        // Inside a tag TypeScript scans with `Scan`, whose `IsWhiteSpaceSingleLine`
                        // accepts two more code points than ECMAScript's WhiteSpace.
                        if matches!(self.code_point, 0x85 | 0x200B) {
                            self.step();
                            continue;
                        }
                        // `Scan`: a name may start with an escape.
                        if self.code_point == 0x5C && self.jsx_identifier_with_escapes() {
                            break;
                        }
                        return self.next_ordinary_token_inside_jsx_element();
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

    /// Inside a tag TypeScript scans with `Scan`, so a character that `next_inside_jsx_element` has no token for starts an
    /// ordinary token. Call before stepping over that character.
    #[cold]
    #[inline(never)]
    fn next_ordinary_token_inside_jsx_element(&mut self) -> Result<(), Error> {
        debug_assert!(self.tolerant);
        let (has_newline_before, full_start) = (self.has_newline_before, self.token_full_start);
        self.next()?;
        self.has_newline_before |= has_newline_before;
        self.token_full_start = full_start;
        Ok(())
    }

    /// `KindLessThanSlashToken`: in a JSX file `Scan` scans `</` as one token, unless the `/`
    /// starts a comment.
    pub(crate) fn is_less_than_slash(&self) -> bool {
        self.token == T::TLessThan
            && self.code_point == 0x2F
            && self.contents.get(self.current) != Some(&b'*')
    }

    pub(crate) fn parse_jsx_string_literal<const QUOTE: u8>(&mut self) -> Result<(), Error> {
        let mut backslash = Range::NONE;
        let mut needs_decode = false;
        let mut is_closed = true;

        'string_literal: loop {
            match self.code_point {
                -1 => {
                    // `scanString`: the error is reported at the end of the source text, and the
                    // string ends there.
                    if self.tolerate(self.end, 0, 1002) {
                        is_closed = false;
                        break 'string_literal;
                    }
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
                    }
                    self.step();
                }
            }
            backslash = Range::NONE;
        }

        self.token = T::TStringLiteral;

        let raw_content_slice = &self.contents[self.start + 1..self.end - usize::from(is_closed)];
        if needs_decode {
            debug_assert!(self.temp_buffer_u16.is_empty());
            let mut tmp = core::mem::take(&mut self.temp_buffer_u16);
            tmp.reserve(raw_content_slice.len());
            let res = self.fix_whitespace_and_decode_jsx_entities(raw_content_slice, &mut tmp);
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

    pub(crate) fn expect_jsx_element_child(&mut self, token: T) -> Result<(), Error> {
        if self.token != token {
            let before = self.prev_error_loc;
            self.expected(token)?;
            if self.tolerant {
                // `parseExpectedWithoutAdvancing`, then the next iteration of `parseJsxChildren`.
                self.put_up_with(before)?;
                return self.rescan_as_jsx_element_child();
            }
        }

        self.next_jsx_element_child()
    }

    pub(crate) fn next_jsx_element_child(&mut self) -> Result<(), Error> {
        self.token_full_start = self.end;
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
                                // `ScanJsxTokenEx`: the JSX text ends at the end of the file.
                                if self.tolerant {
                                    break 'string_literal;
                                }
                                self.syntax_error()?;
                            }
                            0x26 | 0x0D | 0x0A | 0x2028 | 0x2029 => {
                                needs_fixing = true;
                                self.step();
                            }
                            0x7B | 0x3C => {
                                if self.tolerant
                                    && self.code_point == 0x3C
                                    && self.jsx_text_meets_conflict_marker(original_start)
                                {
                                    return Ok(());
                                }
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
                    if self.tolerant {
                        self.report_closers_in_jsx_text(original_start);
                    }
                    let raw_content_slice = &self.contents[original_start..self.end];

                    if needs_fixing {
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

    /// `ScanJsxTokenEx`: every `>` (1382) and `}` (1381) in the JSX text from `text_start` to `self.end` is an error. It stays text.
    #[cold]
    #[inline(never)]
    fn report_closers_in_jsx_text(&mut self, text_start: usize) {
        let text: &'a [u8] = &self.contents[text_start..self.end];
        for (i, &c) in text.iter().enumerate() {
            let code = match c {
                b'>' => 1382,
                b'}' => 1381,
                _ => continue,
            };
            self.ts_error(
                Range {
                    loc: bun_ast::usize2loc(text_start + i),
                    len: 1,
                },
                code,
            );
        }
    }

    /// `ReScanJsxToken`: rescans the current token as a child of a JSX element. TypeScript starts
    /// at the whitespace before the token, which only adds whitespace to the text.
    #[cold]
    #[inline(never)]
    pub(crate) fn rescan_as_jsx_element_child(&mut self) -> Result<(), Error> {
        debug_assert!(self.tolerant);
        let full_start = self.token_full_start;
        self.move_to(self.start);
        self.next_jsx_element_child()?;
        self.token_full_start = full_start;
        Ok(())
    }

    pub(crate) fn fix_whitespace_and_decode_jsx_entities(
        &mut self,
        text: &[u8],
        decoded: &mut Vec<u16>,
    ) -> Result<(), Error> {
        let mut after_last_non_whitespace: Option<u32> = None;

        // Trim whitespace off the end of the first line
        let mut first_non_whitespace: Option<u32> = Some(0);

        let iterator = CodepointIterator::init(text);
        let mut cursor = strings::Cursor::default();

        while iterator.next(&mut cursor) {
            match cursor.c {
                0x0D | 0x0A | 0x2028 | 0x2029 => {
                    if let (Some(start), Some(end)) =
                        (first_non_whitespace, after_last_non_whitespace)
                    {
                        // Newline
                        if !decoded.is_empty() {
                            decoded.push(b' ' as u16);
                        }

                        // Trim whitespace off the start and end of lines in the middle
                        self.decode_jsx_entities(&text[start as usize..end as usize], decoded)?;
                    }

                    // Reset for the next line
                    first_non_whitespace = None;
                }
                0x09 | 0x20 => {}
                _ => {
                    // Check for unusual whitespace characters
                    if !is_whitespace(cursor.c) {
                        after_last_non_whitespace = Some(cursor.i + cursor.width as u32);
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

    fn maybe_decode_jsx_entity(&mut self, text: &[u8], cursor: &mut strings::Cursor) {
        if let Some(length) =
            strings::index_of_char(&text[cursor.width as usize + cursor.i as usize..], b';')
        {
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
                    // TypeScript's scanner does not process entities (`scanString`,
                    // `ScanJsxTokenEx`).
                    _ if self.tolerant => strings::UNICODE_REPLACEMENT as CodePoint,
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

    pub(crate) fn decode_jsx_entities(
        &mut self,
        text: &[u8],
        out: &mut Vec<u16>,
    ) -> Result<(), Error> {
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

    pub(crate) fn expect_inside_jsx_element(&mut self, token: T) -> Result<(), Error> {
        if self.token != token {
            let before = self.prev_error_loc;
            self.expected(token)?;
            if self.tolerant {
                // `parseExpected`
                return self.put_up_with(before);
            }
            return Err(Error::SyntaxError);
        }

        self.next_inside_jsx_element()
    }

    pub(crate) fn expect_inside_jsx_element_with_name(
        &mut self,
        token: T,
        name: &[u8],
    ) -> Result<(), Error> {
        if self.token != token {
            if self.tolerant && !self.is_log_disabled {
                // `parseIdentifierName`
                let before = self.prev_error_loc;
                let r = self.range();
                self.ts_error(r, 1003);
                return self.put_up_with(before);
            }
            self.expected_string(name)?;
            return Err(Error::SyntaxError);
        }

        self.next_inside_jsx_element()
    }

    fn scan_reg_exp_validate_and_step(&mut self) -> Result<(), Error> {
        if self.code_point == 0x5C {
            self.step();
        }

        match self.code_point {
            // `ReScanSlashToken` reads bytes: only "\n" and "\r" end the line.
            0x2028 | 0x2029 if self.tolerant => {
                self.step();
            }
            0x0D | 0x0A | 0x2028 | 0x2029 => {
                // `scan_reg_exp` recovers and reports.
                if self.tolerant && !self.is_log_disabled {
                    return Err(Error::SyntaxError);
                }
                // Newlines aren't allowed in regular expressions
                self.syntax_error()?;
            }
            -1 => {
                if self.tolerant && !self.is_log_disabled {
                    return Err(Error::SyntaxError);
                }
                // EOF
                self.syntax_error()?;
            }
            _ => {
                self.step();
            }
        }
        Ok(())
    }

    pub(crate) fn rescan_close_brace_as_template_token(&mut self) -> Result<(), Error> {
        if self.token != T::TCloseBrace {
            self.expected(T::TCloseBrace)?;
        }

        self.rescan_close_brace_as_template_token = true;
        self.code_point = 0x60;
        self.current = self.end;
        self.end -= 1;
        let full_start = self.token_full_start;
        self.next()?;
        self.token_full_start = full_start;
        self.rescan_close_brace_as_template_token = false;
        Ok(())
    }

    /// `scanTemplateAndSetTokenValue` in a tagged template: the cooked value of the raw text `raw`.
    pub(crate) fn cooked_template_contents(&mut self, raw: &[u8]) -> Vec<u8> {
        self.is_under_tag = true;
        let mut units = Vec::new();
        let _ = self.decode_escape_sequences(0, raw, &mut units);
        self.is_under_tag = false;
        utf16_to_wtf8(&units)
    }

    pub(crate) fn raw_template_contents(&mut self) -> &'a [u8] {
        let mut text: &[u8] = b"";

        if self.tolerant {
            // `getTemplateLiteralRawText`: an unterminated template has no closing delimiter to
            // exclude.
            // `parse_string_literal` has already sliced the correct text in both cases.
            text = self.string_literal_raw_content;
        } else {
            match self.token {
                T::TNoSubstitutionTemplateLiteral | T::TTemplateTail => {
                    text = &self.contents[self.start + 1..self.end - 1];
                }
                T::TTemplateMiddle | T::TTemplateHead => {
                    text = &self.contents[self.start + 1..self.end - 2];
                }
                _ => {}
            }
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
        if first == 0x2E && (self.code_point < 0x30 || self.code_point > 0x39) {
            // "..."
            if (self.code_point == 0x2E && self.current < contents.len())
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
                    // TypeScript reports these (1121, 6188).
                    if self.tolerant {
                        return self.recover_invalid_number();
                    }
                    base = 8.0;
                    self.is_legacy_octal_literal = true;
                }
                // "08", "09": TypeScript reports these (1489).
                0x38 | 0x39 if self.tolerant => return self.recover_invalid_number(),
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
                        if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                            return self.recover_invalid_number();
                        }

                        // The first digit must exist;
                        if is_first || self.is_legacy_octal_literal {
                            return self.recover_invalid_number();
                        }

                        last_underscore_end = self.end;
                        underscore_count += 1;
                    }

                    0x30 | 0x31 => {
                        self.number = self.number * base as f64 + float64(self.code_point - 0x30);
                    }

                    0x32..=0x37 => {
                        if base == 2.0 {
                            return self.recover_invalid_number();
                        }
                        self.number = self.number * base as f64 + float64(self.code_point - 0x30);
                    }
                    0x38 | 0x39 => {
                        if self.is_legacy_octal_literal {
                            is_invalid_legacy_octal_literal = true;
                        } else if base < 10.0 {
                            return self.recover_invalid_number();
                        }
                        self.number = self.number * base as f64 + float64(self.code_point - 0x30);
                    }
                    0x41..=0x46 => {
                        if base != 16.0 {
                            return self.recover_invalid_number();
                        }
                        self.number =
                            self.number * base as f64 + float64(self.code_point + 10 - 0x41);
                    }
                    0x61..=0x66 => {
                        if base != 16.0 {
                            return self.recover_invalid_number();
                        }
                        self.number =
                            self.number * base as f64 + float64(self.code_point + 10 - 0x61);
                    }
                    _ => {
                        // The first digit must exist;
                        if is_first {
                            return self.recover_invalid_number();
                        }

                        break 'integer_literal;
                    }
                }

                self.step_with(contents);
                is_first = false;
            }

            let is_big_integer_literal = self.code_point == 0x6E && !has_dot_or_exponent;

            // Slow path: do we need to re-scan the input as text?
            if is_big_integer_literal || is_invalid_legacy_octal_literal {
                let mut text = self.raw();

                // Can't use a leading zero for bigint literals;
                if is_big_integer_literal && self.is_legacy_octal_literal {
                    return self.recover_invalid_number();
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
                    text = bytes;
                }

                // Store bigints as text to avoid precision loss;
                if is_big_integer_literal {
                    self.identifier = text;
                    if self.tolerant {
                        self.normalize_big_int();
                    }
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
            let is_invalid_legacy_octal_literal =
                first == 0x30 && (self.code_point == 0x38 || self.code_point == 0x39);

            // Initial digits;
            loop {
                if self.code_point < 0x30 || self.code_point > 0x39 {
                    if self.code_point != 0x5F {
                        break;
                    }

                    // Cannot have multiple underscores in a row;
                    if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                        return self.recover_invalid_number();
                    }

                    // The specification forbids underscores in this case;
                    if is_invalid_legacy_octal_literal {
                        return self.recover_invalid_number();
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
                    return self.recover_invalid_number();
                }

                has_dot_or_exponent = true;
                self.step_with(contents);
                if self.code_point == 0x5F {
                    return self.recover_invalid_number();
                }
                loop {
                    if self.code_point < 0x30 || self.code_point > 0x39 {
                        if self.code_point != 0x5F {
                            break;
                        }

                        // Cannot have multiple underscores in a row;
                        if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                            return self.recover_invalid_number();
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
                    return self.recover_invalid_number();
                }

                has_dot_or_exponent = true;
                self.step_with(contents);
                if self.code_point == 0x2B || self.code_point == 0x2D {
                    self.step_with(contents);
                }
                if self.code_point < 0x30 || self.code_point > 0x39 {
                    return self.recover_invalid_number();
                }
                loop {
                    if self.code_point < 0x30 || self.code_point > 0x39 {
                        if self.code_point != 0x5F {
                            break;
                        }

                        // Cannot have multiple underscores in a row;
                        if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
                            return self.recover_invalid_number();
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
                    return self.recover_invalid_number();
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
                        self.add_syntax_error(self.start, format_args!("Invalid number"))?;
                    }
                }
            }
        }

        // An underscore must not come last;
        if last_underscore_end > 0 && self.end == last_underscore_end + 1 {
            self.end -= 1;
            return self.recover_invalid_number();
        }

        // Handle bigint literals after the underscore-at-end check above;
        if self.code_point == 0x6E && !has_dot_or_exponent {
            self.token = T::TBigIntegerLiteral;
            self.step_with(contents);
        }

        // Identifiers can't occur immediately after numbers;
        if is_identifier_start(self.code_point) {
            return self.recover_invalid_number();
        }
        Ok(())
    }

    /// Called where `parse_numeric_literal_or_dot` finds a malformed number. Ordinary builds report
    /// a syntax error. Tolerant mode rescans the token the way TypeScript's scanner does, which
    /// reports the error and always produces a token.
    #[cold]
    #[inline(never)]
    fn recover_invalid_number(&mut self) -> Result<(), Error> {
        if !self.tolerant {
            return self.syntax_error();
        }
        self.scan_number_tolerant();
        Ok(())
    }

    /// `ParsePseudoBigInt`: the type checker identifies a bigint literal by its base 10 digits,
    /// without leading zeros. `identifier` has neither separators nor the `n`.
    #[cold]
    #[inline(never)]
    fn normalize_big_int(&mut self) {
        let text = self.identifier;
        let radix: u32 = match text.get(1) {
            Some(b'x' | b'X') => 16,
            Some(b'b' | b'B') => 2,
            Some(b'o' | b'O') => 8,
            _ => {
                let zeros = text.iter().take_while(|&&digit| digit == b'0').count();
                self.identifier = &text[zeros.min(text.len().saturating_sub(1))..];
                return;
            }
        };
        // Base 1e9, least significant first.
        let mut limbs: Vec<u32> = vec![0];
        for &digit in &text[2..] {
            let mut carry = u64::from(char::from(digit).to_digit(radix).unwrap_or(0));
            for limb in limbs.iter_mut() {
                let value = u64::from(*limb) * u64::from(radix) + carry;
                *limb = (value % 1_000_000_000) as u32;
                carry = value / 1_000_000_000;
            }
            if carry > 0 {
                limbs.push(carry as u32);
            }
        }
        let mut decimal = limbs[limbs.len() - 1].to_string();
        for limb in limbs[..limbs.len() - 1].iter().rev() {
            decimal.push_str(&format!("{limb:09}"));
        }
        self.identifier = self.arena.alloc_slice_copy(decimal.as_bytes());
    }

    /// Makes the character at `pos` the current one.
    #[inline]
    fn move_to(&mut self, pos: usize) {
        self.current = pos;
        self.step();
    }

    /// `scanNumberFragment`, `scanHexDigits`, `scanBinaryOrOctalDigits`: appends the digits of base
    /// `radix` that start at `pos` to `digits` and returns their end. A `_` is only valid between
    /// two digits.
    #[cold]
    fn scan_digits_with_separators(
        &mut self,
        radix: u32,
        mut pos: usize,
        digits: &mut Vec<u8>,
    ) -> usize {
        let (mut allow_separator, mut is_previous_separator) = (false, false);
        while let Some(&ch) = self.contents.get(pos) {
            if char::from(ch).is_digit(radix) {
                digits.push(ch);
                allow_separator = true;
                is_previous_separator = false;
            } else if ch != b'_' {
                break;
            } else if allow_separator {
                allow_separator = false;
                is_previous_separator = true;
            } else {
                // Multiple consecutive numeric separators are not permitted. / Numeric separators are not allowed here.
                let code = if is_previous_separator { 6189 } else { 6188 };
                self.ts_error(
                    Range {
                        loc: bun_ast::usize2loc(pos),
                        len: 1,
                    },
                    code,
                );
            }
            pos += 1;
        }
        if is_previous_separator {
            self.ts_error(
                Range {
                    loc: bun_ast::usize2loc(pos - 1),
                    len: 1,
                },
                6188,
            );
        }
        pos
    }

    /// A port of `scanNumber`, and of the `0x`, `0b` and `0o` cases of `Scan`, in TypeScript 7.0.2's scanner.go. Scans the token that
    /// starts at `self.start`.
    #[cold]
    #[inline(never)]
    fn scan_number_tolerant(&mut self) {
        let text: &'a [u8] = self.contents;
        let start = self.start;
        let at = |pos: usize| text.get(pos).copied().unwrap_or(0);
        let range = |from: usize, to: usize| Range {
            loc: bun_ast::usize2loc(from),
            len: (to - from) as i32,
        };
        let mut digits: Vec<u8> = Vec::new();
        self.is_legacy_octal_literal = false;
        self.token = T::TNumericLiteral;

        let radix: u32 = match (at(start), at(start + 1)) {
            (b'0', b'x' | b'X') => 16,
            (b'0', b'b' | b'B') => 2,
            (b'0', b'o' | b'O') => 8,
            _ => 10,
        };
        if radix != 10 {
            let mut pos = self.scan_digits_with_separators(radix, start + 2, &mut digits);
            if digits.is_empty() {
                // Hexadecimal digit expected. / Binary digit expected. / Octal digit expected.
                let code = match radix {
                    16 => 1125,
                    2 => 1177,
                    _ => 1178,
                };
                self.ts_error(range(pos, pos), code);
                digits.push(b'0');
            }
            // `scanBigIntSuffix`. Whatever follows is the next token.
            if at(pos) == b'n' {
                digits.splice(0..0, text[start..start + 2].iter().copied());
                self.identifier = self.arena.alloc_slice_copy(&digits);
                self.normalize_big_int();
                self.token = T::TBigIntegerLiteral;
                pos += 1;
            } else {
                self.number = digits.iter().fold(0.0, |number, &digit| {
                    number * f64::from(radix)
                        + f64::from(char::from(digit).to_digit(radix).unwrap_or(0))
                });
            }
            return self.move_to(pos);
        }

        let mut pos = start;
        let mut has_leading_zero = false;
        if at(start) == b'0' && at(start + 1) == b'_' {
            self.ts_error(range(start + 1, start + 2), 6188);
            pos = self.scan_digits_with_separators(10, start, &mut digits);
        } else if at(start) == b'0' && at(start + 1).is_ascii_digit() {
            // `scanDigits`
            pos += 1;
            while at(pos).is_ascii_digit() {
                pos += 1;
            }
            let rest = &text[start + 1..pos];
            if rest.iter().all(|&digit| digit <= b'7') {
                self.number = rest
                    .iter()
                    .fold(0.0, |number, &digit| number * 8.0 + f64::from(digit - b'0'));
                // After a `-` token the error starts one byte earlier, whatever that byte is. A run
                // of `-` of odd length ends with that token.
                let before = text[..start].trim_ascii_end();
                let is_after_minus =
                    before.iter().rev().take_while(|&&ch| ch == b'-').count() % 2 == 1;
                // Octal literals are not allowed.
                let significant = rest.iter().position(|&digit| digit != b'0');
                let mut suggestion: Vec<u8> = if is_after_minus {
                    b"-0o".to_vec()
                } else {
                    b"0o".to_vec()
                };
                suggestion.extend_from_slice(significant.map_or(b"0", |first| &rest[first..]));
                self.ts_error_about(
                    range(start - usize::from(is_after_minus), pos),
                    1121,
                    &suggestion,
                );
                return self.move_to(pos);
            }
            has_leading_zero = true;
            digits.extend_from_slice(rest);
        } else {
            pos = self.scan_digits_with_separators(10, start, &mut digits);
        }
        let fixed_part_end = pos;
        if at(pos) == b'.' {
            digits.push(b'.');
            pos = self.scan_digits_with_separators(10, pos + 1, &mut digits);
        }
        let mut is_scientific = false;
        if matches!(at(pos), b'e' | b'E') {
            is_scientific = true;
            let mantissa_len = digits.len();
            digits.push(b'e');
            pos += 1;
            if matches!(at(pos), b'+' | b'-') {
                digits.push(at(pos));
                pos += 1;
            }
            let preamble_len = digits.len();
            pos = self.scan_digits_with_separators(10, pos, &mut digits);
            if digits.len() == preamble_len {
                // Digit expected.
                self.ts_error(range(pos, pos), 1124);
                digits.truncate(mantissa_len);
            }
        }
        self.number = bun_core::wtf::parse_double(&digits).unwrap_or(0.0);
        if has_leading_zero {
            // Decimals with leading zeros are not allowed. Neither a bigint suffix nor the
            // following characters are checked.
            self.ts_error(range(start, pos), 1489);
            return self.move_to(pos);
        }
        if fixed_part_end == pos && at(pos) == b'n' {
            // `scanBigIntSuffix`
            self.identifier = self.arena.alloc_slice_copy(&digits);
            self.normalize_big_int();
            self.token = T::TBigIntegerLiteral;
            pos += 1;
        }
        self.move_to(pos);
        if !is_identifier_start(self.code_point) {
            return;
        }
        // `scanIdentifierParts`
        let identifier_start = pos;
        while is_identifier_continue(self.code_point) {
            self.step();
        }
        let identifier_end = self.end;
        if self.token != T::TBigIntegerLiteral && &text[identifier_start..identifier_end] == b"n" {
            // The `n` stays part of the token.
            if is_scientific {
                // A bigint literal cannot use exponential notation.
                return self.ts_error(range(start, identifier_end), 1352);
            }
            if fixed_part_end < identifier_start {
                // A bigint literal must be an integer.
                return self.ts_error(range(start, identifier_end), 1353);
            }
        }
        // An identifier or keyword cannot immediately follow a numeric literal. It is the next token.
        self.ts_error(range(identifier_start, identifier_end), 1351);
        self.move_to(identifier_start);
    }
}

#[inline]
pub fn is_identifier_start(codepoint: i32) -> bool {
    js_identifier::is_identifier_start(codepoint)
}
#[inline]
pub fn is_identifier_continue(codepoint: i32) -> bool {
    js_identifier::is_identifier_part(codepoint)
}

/// `EncodeJSStringRune`: UTF-8, with a lone surrogate encoded as the three-byte sequence its code
/// point would have if UTF-8 allowed it. The type checker distinguishes such strings.
#[cold]
pub(crate) fn utf16_to_wtf8(units: &[u16]) -> Vec<u8> {
    let mut text = Vec::with_capacity(units.len());
    for unit in char::decode_utf16(units.iter().copied()) {
        match unit {
            Ok(ch) => text.extend_from_slice(ch.encode_utf8(&mut [0; 4]).as_bytes()),
            Err(lone) => {
                let unit = lone.unpaired_surrogate();
                text.extend_from_slice(&[
                    0xED,
                    0x80 | (unit >> 6 & 0x3F) as u8,
                    0x80 | (unit & 0x3F) as u8,
                ]);
            }
        }
    }
    text
}

/// Start of the escape sequence that the end of `text` truncates.
fn last_backslash(text: &[u8]) -> usize {
    bun_core::strings::last_index_of_char(text, b'\\').unwrap_or(0)
}

/// Number of trailing bytes of `text` that are whitespace or line breaks (`IsWhiteSpaceLike`).
#[cold]
fn trailing_whitespace_len(text: &[u8]) -> usize {
    let mut end = text.len();
    while end > 0 {
        let (c, start) = last_char(&text[..end]);
        if !is_white_space_single_line(c) && !starts_with_line_break(&text[start..end]) {
            break;
        }
        end = start;
    }
    text.len() - end
}

/// `isConflictMarkerTrivia`: the character at `pos` repeated seven times, followed by a space
/// unless it is `=`, at the start of a line. TypeScript also treats the position two characters
/// after a line break as the start of a line.
fn is_conflict_marker(text: &[u8], pos: usize) -> bool {
    let ends_with_line_break = |text: &[u8]| {
        matches!(text.last(), Some(b'\n' | b'\r'))
            || text.ends_with(b"\xE2\x80\xA8")
            || text.ends_with(b"\xE2\x80\xA9")
    };
    let ch = text[pos];
    (pos == 0
        || matches!(text[pos - 1], b'\n' | b'\r')
        || pos >= 2 && ends_with_line_break(&text[..pos - 2]))
        && pos + 7 < text.len()
        && text[pos..pos + 7].iter().all(|&c| c == ch)
        && (ch == b'=' || text[pos + 7] == b' ')
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
pub(crate) fn latin1_identifier_continue_length_scalar(name: &[u8]) -> usize {
    for (i, &c) in name.iter().enumerate() {
        match c {
            b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'$' | b'_' => {}
            _ => return i,
        }
    }

    name.len()
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CommentKind {
    SingleLine,
    MultiLine,
}

/// Whether a `__PURE__` match at this position marks the next call.
#[derive(Clone, Copy, PartialEq, Eq)]
enum PureAnnotation {
    Allow,
    Ignore,
}

pub struct PragmaArg;

impl PragmaArg {
    pub(crate) fn is_newline(c: CodePoint) -> bool {
        c == 0x0D || c == 0x0A || c == 0x2028 || c == 0x2029
    }

    // These can be extremely long, so we use SIMD.
    /// "//# sourceMappingURL=data:/adspaoksdpkz"
    ///                       ^^^^^^^^^^^^^^^^^^
    pub(crate) fn scan_source_mapping_url_value(
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

    pub(crate) fn scan(
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

        // One or more whitespace characters
        if !is_whitespace(cursor.c) {
            return None;
        }

        while is_whitespace(cursor.c) {
            if !iter.next(&mut cursor) {
                break;
            }
        }
        let start: u32 = cursor.i;
        text = &text[cursor.i as usize..];
        cursor = strings::Cursor::default();
        iter = CodepointIterator::init(text);
        let _ = iter.next(&mut cursor);

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
