//! Changes to the source text.

use crate::ast::File;
use crate::context::IntoText;
use crate::span::{Span, Spanned};
use crate::tokens::{Token, TokenKind};
use crate::utils::ast_utils::is_on_one_line;
use crate::utils::directives::match_directives_pattern;
use bun_core::strings;

/// Replaces `span` with `text`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Fix {
    pub span: Span,
    pub text: Vec<u8>,
}

/// The safety level of a change that `--fix` doesn't apply: oxlint's `FixKind`. ESLint only has the first kind.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum SuggestionKind {
    /// It may change what the program does. `--fix-suggestions` applies it.
    #[default]
    Suggestion,
    /// It may break the program. `--fix-dangerously` applies it.
    DangerousFix,
    /// Only both flags together apply it.
    DangerousSuggestion,
}

/// The surroundings of `span` in `text`, for deciding what else to remove along with it.
pub struct Removal<'t> {
    text: &'t [u8],
    span: Span,
    /// `span` with the spaces and tabs on both sides of it.
    pub with_spaces: Span,
    /// True if nothing comes before it on its first line.
    pub starts_line: bool,
    /// The length of the line break after it. `None` if something else follows on its last line, 0 at the end of the text.
    pub line_break: Option<u32>,
}

/// True if the line has only spaces, tabs and the `\r` of a `\r\n`.
fn is_blank_line(line: &[u8]) -> bool {
    line.iter().all(|byte| matches!(byte, b' ' | b'\t' | b'\r'))
}

impl<'t> Removal<'t> {
    pub fn of(text: &'t [u8], span: Span) -> Removal<'t> {
        let is_space_or_tab = |byte: &&u8| matches!(byte, b' ' | b'\t');
        let before = text.get(..span.start as usize).unwrap_or_default();
        let after = text.get(span.end as usize..).unwrap_or_default();
        let start = before.len() - before.iter().rev().take_while(is_space_or_tab).count();
        let spaces_after = after.iter().take_while(is_space_or_tab).count();
        Removal {
            text,
            span,
            with_spaces: Span::new(start as u32, span.end + spaces_after as u32),
            starts_line: matches!(before.get(..start), Some([] | [.., b'\n' | b'\r'])),
            line_break: match after.get(spaces_after..) {
                Some([b'\r', b'\n', ..]) => Some(2),
                Some([b'\n' | b'\r', ..]) => Some(1),
                Some([]) | None => Some(0),
                Some(_) => None,
            },
        }
    }

    /// Returns the whole lines that `span` is on, including the last line break, if nothing else is on them. Removing
    /// that doesn't leave an empty line behind, which `bun fmt --check` would complain about. An adjacent empty line is
    /// included if it would end up first or last in a block or in the file, or next to another empty line.
    pub fn whole_lines(&self) -> Option<Span> {
        let line_break = self.line_break.filter(|_| self.starts_line)?;
        let lines = Span::new(self.with_spaces.start, self.with_spaces.end + line_break);
        let (before, after) = (
            self.text.get(..lines.start as usize)?,
            self.text.get(lines.end as usize..)?,
        );
        // The previous line with its start offset, and the next line with its length.
        let previous = before.strip_suffix(b"\n").map(|rest| {
            let start = strings::last_index_of_char(rest, b'\n').map_or(0, |at| at + 1);
            (rest.get(start..).unwrap_or_default(), start as u32)
        });
        let next_len = strings::index_of_char_usize(after, b'\n').map_or(after.len(), |at| at + 1);
        let next = after.get(..next_len).unwrap_or_default().trim_ascii();
        let opens = |line: &[u8]| line.trim_ascii_end().ends_with(b"{");
        if next.is_empty() && !after.is_empty() {
            let is_left_over = previous.is_none_or(|(line, _)| is_blank_line(line) || opens(line));
            return Some(Span::new(
                lines.start,
                lines.end + if is_left_over { next_len as u32 } else { 0 },
            ));
        }
        match previous {
            Some((line, start))
                if is_blank_line(line) && (after.is_empty() || next.starts_with(b"}")) =>
            {
                Some(Span::new(start, lines.end))
            }
            _ => Some(lines),
        }
    }

    /// Returns the span to remove so that removing `span` doesn't leave an empty line, trailing whitespace or a doubled
    /// space behind.
    pub fn without_leftovers(&self) -> Span {
        if let Some(lines) = self.whole_lines() {
            return lines;
        }
        if self.line_break.is_some() {
            return self.with_spaces;
        }
        // Remove the spaces after it too, unless they're all that separates two words.
        let before = self
            .text
            .get(..self.span.start as usize)
            .and_then(<[u8]>::last);
        match before.is_some_and(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | 0x80..)
        }) {
            true => self.span,
            false => Span::new(self.span.start, self.with_spaces.end),
        }
    }
}

/// V8's maximum string length. `" ".repeat(n)` throws beyond it.
pub const MAX_STRING_LENGTH: u64 = (1 << 29) - 24;

/// True if `content` has a file-level `@tag` such as `@ts-nocheck` or `@license`. The tag must be a whole word, so
/// `@bun/types` doesn't match.
fn has_file_level_tag(content: &[u8]) -> bool {
    const TAGS: [&[u8]; 17] = [
        b"ts-nocheck",
        b"ts-check",
        b"bun",
        b"license",
        b"preserve",
        b"copyright",
        b"file",
        b"fileoverview",
        b"overview",
        b"module",
        b"packageDocumentation",
        b"flow",
        b"noflow",
        b"format",
        b"prettier",
        b"noformat",
        b"noprettier",
    ];
    let ends_a_word = |byte: &u8| byte.is_ascii_whitespace() || matches!(byte, b'*');
    let mut from = 0;
    while let Some(at) = strings::index_of_char_usize(content.get(from..).unwrap_or_default(), b'@')
    {
        let (at, start) = (from + at, from + at + 1);
        let rest = content.get(start..).unwrap_or_default();
        let is_part = |byte: &&u8| byte.is_ascii_alphanumeric() || matches!(byte, b'-');
        let len = rest.iter().take_while(is_part).count();
        let name = rest.get(..len).unwrap_or_default();
        from = start + len;
        let before = at.checked_sub(1).and_then(|it| content.get(it));
        // `@jsxImportSource`, `@jest-environment`, `@vitest-environment`
        let is_pragma = [&b"jsx"[..], b"jest-", b"vitest-"]
            .iter()
            .any(|it| name.starts_with(it));
        if (TAGS.contains(&name) || is_pragma)
            && before.is_none_or(|byte| ends_a_word(byte) || matches!(byte, b'/'))
            && content.get(from).is_none_or(ends_a_word)
        {
            return true;
        }
    }
    false
}

/// True if `content`, a comment's text, begins a license header.
fn starts_license(content: &[u8]) -> bool {
    let is_star = |byte: &&u8| matches!(byte, b'*') || byte.is_ascii_whitespace();
    let stars = content.iter().take_while(is_star).count();
    let text = content.get(stars..).unwrap_or_default();
    strings::starts_with_case_insensitive_ascii(text, b"copyright")
        || strings::contains(content, b"SPDX-License-Identifier")
}

/// Directives that ignore the whole file. Each one has a next-line directive as a prefix: `biome-ignore-all` starts
/// with `biome-ignore`.
const FILE_IGNORE_DIRECTIVES: [&[u8]; 4] = [
    b"biome-ignore-all",
    b"deno-lint-ignore-file",
    b"deno-fmt-ignore-file",
    b"dprint-ignore-file",
];

/// True if a comment applies to the whole file, judging by its text. That covers the `#!` line, pragmas that only work
/// above all code (`// @ts-nocheck`, `/// <reference path="a" />`, `/** @jsx h */`), linter directives that apply from
/// their position on (`/* eslint-disable */`), licenses, and file docs (`/** @module */`). `bun fmt` keeps these
/// comments above the imports it sorts. `text` is the whole comment and `content` is the part between its delimiters.
pub fn is_file_level_comment(text: &[u8], content: &[u8]) -> bool {
    let content = strings::trim_js_whitespace(content);
    let starts_with_word = |word: &[u8]| {
        (content.strip_prefix(word))
            .is_some_and(|rest| rest.first().is_none_or(u8::is_ascii_whitespace))
    };
    let is_triple_slash_directive =
        (text.strip_prefix(b"///")).is_some_and(|rest| rest.trim_ascii_start().starts_with(b"<"));
    text.starts_with(b"#!")
        || is_triple_slash_directive
        // The bundler preserves `//!` and `/*!` comments.
        || text.get(2) == Some(&b'!')
        || match_directives_pattern(content)
            .is_some_and(|it| it.starts_with("eslint") && !it.ends_with("line"))
        || [&b"oxlint-disable"[..], b"oxlint-enable"].into_iter().any(starts_with_word)
        || FILE_IGNORE_DIRECTIVES.into_iter().any(starts_with_word)
        || starts_license(content)
        || has_file_level_tag(content)
}

fn is_file_level_token(comment: &Token) -> bool {
    is_file_level_comment(comment.text(), comment.value())
}

/// True if `comment` is a directive for the next line, statement or expression. The reader can be a compiler, a linter,
/// a formatter, a coverage tool or a bundler.
fn is_next_line_directive(comment: &Token) -> bool {
    const DIRECTIVES: [&[u8]; 22] = [
        b"@ts-expect-error",
        b"@ts-ignore",
        // `$FlowFixMe`, `$FlowIgnore`, `$FlowExpectedError`, `$FlowIssue`
        b"$Flow",
        b"eslint-disable-next-line",
        b"oxlint-disable-next-line",
        b"tslint:disable-next-line",
        b"biome-ignore",
        b"deno-lint-ignore",
        b"deno-fmt-ignore",
        b"dprint-ignore",
        b"prettier-ignore",
        b"oxfmt-ignore",
        b"istanbul ignore next",
        b"istanbul ignore if",
        b"istanbul ignore else",
        b"c8 ignore next",
        b"v8 ignore next",
        b"v8 ignore if",
        b"v8 ignore else",
        b"node:coverage ignore next",
        // `#__PURE__`, `@__NO_SIDE_EFFECTS__`
        b"#__",
        b"@__",
    ];
    // TypeScript also reads `/// @ts-ignore` and `/** @ts-ignore */`.
    let is_before_content = |byte: &&u8| matches!(byte, b'/' | b'*') || byte.is_ascii_whitespace();
    let text = comment.text();
    let start = text.iter().take_while(is_before_content).count();
    let content = text.get(start..).unwrap_or_default();
    // TypeScript matches by prefix, so `@ts-ignore-next-line` works too.
    let is_at_start = |word: &&[u8]| content.starts_with(word);
    DIRECTIVES.iter().any(is_at_start) && !FILE_IGNORE_DIRECTIVES.iter().any(is_at_start)
}

/// True if tools attach `comment` to the code after it. It's either a next-line directive or a doc comment like
/// `/** @type {A} */`.
fn is_attached_to_next_code(comment: &Token) -> bool {
    comment.text().starts_with(b"/**") || is_next_line_directive(comment)
}

/// Creates [`Fix`]es, like ESLint's `fixer`. Each method takes a node, a token, a comment or a [`Span`].
#[derive(Copy, Clone)]
pub struct Fixer<'a> {
    file: &'a File<'a>,
}

impl<'a> Fixer<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        Fixer { file }
    }

    #[inline]
    pub fn file(self) -> &'a File<'a> {
        self.file
    }

    /// Returns `byte` repeated `count` times, or `None` if that would be longer than [`MAX_STRING_LENGTH`]. Rules must
    /// use this for any text whose length comes from a number in the options. See
    /// [`Cx::repeat_count`](crate::context::Cx::repeat_count).
    pub fn repeat(self, byte: u8, count: u64) -> Option<Vec<u8>> {
        (count <= MAX_STRING_LENGTH).then(|| vec![byte; count as usize])
    }

    /// True if every comment in the span that `fix` replaces also appears in the new text. Rules don't offer a fix that
    /// drops a comment.
    pub fn keeps_comments(self, fix: &Fix) -> bool {
        let mut comments = self.file.comments_in(fix.span);
        comments.all(|it| strings::contains(&fix.text, it.text()))
    }

    /// Returns the end of the trailing comments on the same line as `at`, which is the end of a statement. Returns `at`
    /// if code follows them on that line, or if one of them applies to the code after it.
    pub fn end_with_trailing_comments(self, at: u32) -> u32 {
        let mut end = at;
        for comment in self.file.comments_after(Span::empty(at)) {
            if !is_on_one_line(self.file, Span::empty(end).between(comment.span())) {
                break;
            }
            if is_attached_to_next_code(&comment) {
                return at;
            }
            end = comment.end();
        }
        match Removal::of(self.file.text(), Span::new(at, end)).line_break {
            Some(_) => end,
            None => at,
        }
    }

    /// Returns the end of the part that must stay at the top of the file. That part is the `#!` line, directives like
    /// `"use strict"` with their trailing comments, file-level comments like `// @ts-nocheck` or a license, and
    /// comments separated from the first statement by an empty line (TypeScript calls these detached). Every comment
    /// above one of these is included. Comments directly above the first statement belong to that statement and aren't
    /// included. Returns `None` if the file has none of these.
    fn end_of_file_header(self) -> Option<u32> {
        let file = self.file;
        let directives = (file.body().iter()).take_while(|it| it.directive().is_some());
        let mut end = (directives.last()).map(|it| self.end_with_trailing_comments(it.span().end));
        let start_of_text = if file.has_bom() { 3 } else { 0 };
        // A license written as `//` lines continues through the last consecutive `//` line.
        let mut end_of_license = None;
        let mut comments = file
            .comments_after(Span::empty(end.unwrap_or(start_of_text)))
            .peekable();
        while let Some(comment) = comments.next() {
            if is_next_line_directive(&comment) {
                // `// eslint-disable-next-line` above `/// <reference path="a" />` applies to that comment's line.
                // Other directives, like `// @ts-ignore` and `// prettier-ignore`, apply to the next line of code.
                let applies_to_any_line = [&b"disable-next-line"[..], b"deno-lint-ignore"]
                    .iter()
                    .any(|it| strings::contains(comment.text(), it));
                match comments.peek() {
                    Some(next) if applies_to_any_line && is_file_level_token(next) => continue,
                    _ => break,
                }
            }
            let continues_license = end_of_license
                .is_some_and(|end| file.line_of(end) + 1 == file.line_of(comment.start()));
            let is_in_license = comment.kind() == TokenKind::Line
                && (continues_license || starts_license(comment.value().trim_ascii()));
            end_of_license = is_in_license.then(|| comment.end());
            let next = self.skip_white_space(comment.end());
            let is_detached = file.line_of(next) > file.line_of(comment.end()) + 1;
            if is_in_license || is_detached || is_file_level_token(&comment) {
                end = Some(comment.end());
            }
        }
        end
    }

    /// Returns the offset for a new first statement. It's after the part that must stay at the top, and before the
    /// first statement and the comments attached to it.
    pub fn start_of_first_statement(self) -> u32 {
        self.skip_white_space(self.end_of_file_header().unwrap_or(0))
    }

    fn skip_white_space(self, at: u32) -> u32 {
        let rest = self.file.text().get(at as usize..).unwrap_or_default();
        at + (rest.len() - strings::trim_js_whitespace_start(rest).len()) as u32
    }

    /// Inserts `statement` [before the file's other statements](Self::start_of_first_statement). `statement` is a whole
    /// line without its line break.
    pub fn insert_first_statement(self, statement: &[u8]) -> Fix {
        let text = self.file.text();
        let first_line = strings::index_of_char_usize(text, b'\n').and_then(|at| text.get(..at));
        let line_break: &[u8] = match first_line {
            Some([.., b'\r']) => b"\r\n",
            _ => b"\n",
        };
        let Some(after) = self.end_of_file_header() else {
            let start_of_text = Span::empty(if self.file.has_bom() { 3 } else { 0 });
            return self.insert_before(start_of_text, [statement, line_break].concat());
        };
        let whitespace = Span::new(after, self.skip_white_space(after));
        match strings::last_index_of_char(self.file.slice(whitespace), b'\n') {
            // Both arms produce the same text here. This one makes the same edit as oxlint, and the help message quotes
            // the edit.
            Some(0) | None => {
                self.insert_after(Span::empty(after), [line_break, statement].concat())
            }
            Some(at) => {
                let line = Span::empty(after + at as u32 + 1);
                self.insert_before(line, [statement, line_break].concat())
            }
        }
    }

    /// True if a comment directly before `at` is a next-line directive like `// @ts-expect-error` or
    /// `// eslint-disable-next-line`. A fix that moves `at` away from it, or inserts something in between, makes the
    /// directive apply to other code.
    pub fn has_directive_before(self, at: impl Spanned) -> bool {
        let mut comments = self.file.comments_before(at);
        comments.any(|it| is_next_line_directive(&it))
    }

    /// True if [`Fixer::has_directive_before`] is true, or a `/** .. */` doc comment precedes `at`. Skips the file's
    /// header, like a license or `/** @fileoverview */`, because it isn't attached to `at`.
    pub fn has_directive_or_doc_before(self, at: impl Spanned) -> bool {
        let end_of_file_header = self.end_of_file_header().unwrap_or(0);
        let mut comments = self.file.comments_before(at);
        comments.any(|it| it.end() > end_of_file_header && is_attached_to_next_code(&it))
    }

    /// `replaceText`, `replaceTextRange`
    pub fn replace<'t>(self, at: impl Spanned, text: impl IntoText<'t>) -> Fix {
        Fix {
            span: at.span(),
            text: text.into_text().into_owned(),
        }
    }

    /// `remove`, `removeRange`
    pub fn remove(self, at: impl Spanned) -> Fix {
        Fix {
            span: at.span(),
            text: Vec::new(),
        }
    }

    /// `insertTextBefore`, `insertTextBeforeRange`
    pub fn insert_before<'t>(self, at: impl Spanned, text: impl IntoText<'t>) -> Fix {
        Fix {
            span: Span::empty(at.span().start),
            text: text.into_text().into_owned(),
        }
    }

    /// `insertTextAfter`, `insertTextAfterRange`
    pub fn insert_after<'t>(self, at: impl Spanned, text: impl IntoText<'t>) -> Fix {
        Fix {
            span: Span::empty(at.span().end),
            text: text.into_text().into_owned(),
        }
    }
}

/// The return type of the function passed to [`Report::fix`](crate::context::Report::fix).
pub trait IntoFix {
    /// ESLint's `mergeFixes`: merges all the fixes into one. Returns `None` if there are none, or if two overlap.
    fn into_fix(self, file: &File) -> Option<Fix>;

    /// Returns the fix that was created first.
    fn first_fix(&self) -> Option<&Fix>;
}

impl IntoFix for Fix {
    #[inline]
    fn into_fix(self, _: &File) -> Option<Fix> {
        Some(self)
    }

    #[inline]
    fn first_fix(&self) -> Option<&Fix> {
        Some(self)
    }
}

impl<T: IntoFix> IntoFix for Option<T> {
    #[inline]
    fn into_fix(self, file: &File) -> Option<Fix> {
        self?.into_fix(file)
    }

    #[inline]
    fn first_fix(&self) -> Option<&Fix> {
        self.as_ref()?.first_fix()
    }
}

impl IntoFix for Vec<Fix> {
    fn first_fix(&self) -> Option<&Fix> {
        self[..].first()
    }
    fn into_fix(mut self, file: &File) -> Option<Fix> {
        if self.len() <= 1 {
            return self.pop();
        }
        crate::utils::sort::sort_by_key(&mut self, |fix| (fix.span.start, fix.span.end));
        let (start, end) = (self.first()?.span.start, self.last()?.span.end);
        let mut text = Vec::new();
        let mut at = start;
        for fix in &self {
            if fix.span.start < at {
                return None;
            }
            text.extend_from_slice(file.slice(Span::before(at, fix.span)));
            text.extend_from_slice(&fix.text);
            at = fix.span.end;
        }
        Some(Fix {
            span: Span::new(start, end.max(at)),
            text,
        })
    }
}

impl<const N: usize> IntoFix for [Fix; N] {
    fn first_fix(&self) -> Option<&Fix> {
        self[..].first()
    }
    fn into_fix(self, file: &File) -> Option<Fix> {
        Vec::from(self).into_fix(file)
    }
}

/// ESLint's `SourceCodeFixer.applyFixes`: applies the `fixes` that don't overlap an earlier one, and returns the new
/// text, or `None` if nothing was applied.
pub fn apply_fixes(text: &[u8], fixes: &mut Vec<&Fix>) -> Option<Vec<u8>> {
    crate::utils::sort::sort_by_key(fixes, |fix| (fix.span.start, fix.span.end));
    let mut out = Vec::with_capacity(text.len());
    // ESLint starts at -1, so that an insertion at 0 doesn't count as a conflict.
    let mut last: i64 = -1;
    let mut at = 0usize;
    let mut applied = false;
    for fix in fixes.iter() {
        let (start, end) = (fix.span.start as usize, fix.span.end as usize);
        if last >= start as i64 || start > end {
            continue;
        }
        // A range can extend past the end of the text, as with `String.prototype.slice`.
        let start = start.min(text.len());
        out.extend_from_slice(&text[at.min(start)..start]);
        out.extend_from_slice(&fix.text);
        at = end.min(text.len());
        last = end as i64;
        applied = true;
    }
    out.extend_from_slice(&text[at..]);
    applied.then_some(out)
}
