//! Changes to the source text.

use crate::ast::File;
use crate::context::IntoText;
use crate::span::{Span, Spanned};
use crate::tokens::Token;
use crate::utils::directives::match_directives_pattern;
use bun_core::strings;

/// Replaces `span` by `text`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Fix {
    pub span: Span,
    pub text: Vec<u8>,
}

/// How much a change that `--fix` does not make can be trusted: oxlint's `FixKind`. ESLint knows the first only.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum SuggestionKind {
    /// It may change what the program does: `--fix-suggestions` makes it.
    #[default]
    Suggestion,
    /// It may break the program: `--fix-dangerously` makes it.
    DangerousFix,
    /// Both flags together make it.
    DangerousSuggestion,
}

/// What's left of a line once `span` is removed from `text`.
pub struct Around<'t> {
    text: &'t [u8],
    span: Span,
    /// `span` with the spaces and tabs on both sides of it.
    pub with_blanks: Span,
    /// Nothing comes before it on its first line.
    pub starts_line: bool,
    /// The length of the line break after it. `None` if something else follows on its last line, 0 at the end of the text.
    pub line_break: Option<u32>,
}

/// Only spaces and tabs, and the `\r` of a `\r\n`.
fn is_blank_line(line: &[u8]) -> bool {
    line.iter().all(|byte| matches!(byte, b' ' | b'\t' | b'\r'))
}

impl<'t> Around<'t> {
    pub fn of(text: &'t [u8], span: Span) -> Around<'t> {
        let is_blank = |byte: &&u8| matches!(byte, b' ' | b'\t');
        let before = text.get(..span.start as usize).unwrap_or_default();
        let after = text.get(span.end as usize..).unwrap_or_default();
        let start = before.len() - before.iter().rev().take_while(is_blank).count();
        let blank_after = after.iter().take_while(is_blank).count();
        Around {
            text,
            span,
            with_blanks: Span::new(start as u32, span.end + blank_after as u32),
            starts_line: matches!(before.get(..start), Some([] | [.., b'\n' | b'\r'])),
            line_break: match after.get(blank_after..) {
                Some([b'\r', b'\n', ..]) => Some(2),
                Some([b'\n' | b'\r', ..]) => Some(1),
                Some([]) | None => Some(0),
                Some(_) => None,
            },
        }
    }

    /// The whole lines that `span` is on, with the last line break, if nothing else is on them. Removing that leaves no empty
    /// line behind, which `bun fmt --check` would complain about. An empty line next to them goes too if it would end up
    /// first or last in a block or in the file, or next to another empty line.
    pub fn whole_lines(&self) -> Option<Span> {
        let line_break = self.line_break.filter(|_| self.starts_line)?;
        let lines = Span::new(self.with_blanks.start, self.with_blanks.end + line_break);
        let (before, after) = (
            self.text.get(..lines.start as usize)?,
            self.text.get(lines.end as usize..)?,
        );
        // The line before, where it starts, and the line after, where it ends.
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

    /// What to remove so that `span` leaves no empty line, no space at the end of a line and no doubled space behind.
    pub fn without_leftovers(&self) -> Span {
        if let Some(lines) = self.whole_lines() {
            return lines;
        }
        if self.line_break.is_some() {
            return self.with_blanks;
        }
        // The spaces after it go, unless they are all that keeps two words apart.
        let before = self
            .text
            .get(..self.span.start as usize)
            .and_then(<[u8]>::last);
        match before.is_some_and(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | 0x80..)
        }) {
            true => self.span,
            false => Span::new(self.span.start, self.with_blanks.end),
        }
    }
}

/// The longest string that JavaScript has, in V8: `" ".repeat(n)` throws beyond it.
pub const MAX_STRING_LENGTH: u64 = (1 << 29) - 24;

/// Whether `content` has an `@name` that says something about a file, as a word of its own: not `@bun/types`.
fn has_tag_about_the_file(content: &[u8]) -> bool {
    const TAGS: [&[u8]; 12] = [
        b"ts-nocheck",
        b"ts-check",
        b"bun",
        b"license",
        b"preserve",
        b"copyright",
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
        if (TAGS.contains(&name) || name.starts_with(b"jsx"))
            && before.is_none_or(|byte| ends_a_word(byte) || matches!(byte, b'/'))
            && content.get(from).is_none_or(ends_a_word)
        {
            return true;
        }
    }
    false
}

/// Whether `comment` is about the file, going by its text: the `#!` line, a pragma, which counts only before all code
/// (`// @ts-nocheck`, `/// <reference path="a" />`, `/** @jsx h */`), a directive for a linter, which counts from where it stands
/// (`/* eslint-disable */`), or a license. `bun fmt` keeps the same comments above the imports that it sorts.
fn is_about_the_file(comment: &Token) -> bool {
    let (text, content) = (comment.text(), strings::trim_js_whitespace(comment.value()));
    let starts_with_word = |word: &[u8]| {
        (content.strip_prefix(word))
            .is_some_and(|rest| rest.first().is_none_or(u8::is_ascii_whitespace))
    };
    let is_star = |byte: &&u8| matches!(byte, b'*') || byte.is_ascii_whitespace();
    let stars = content.iter().take_while(is_star).count();
    let is_triple_slash_directive =
        (text.strip_prefix(b"///")).is_some_and(|rest| rest.trim_ascii_start().starts_with(b"<"));
    text.starts_with(b"#!")
        || is_triple_slash_directive
        // What the bundler keeps: `//!`, `/*!`
        || text.get(2) == Some(&b'!')
        || match_directives_pattern(content)
            .is_some_and(|it| it.starts_with("eslint") && !it.ends_with("line"))
        || [&b"oxlint-disable"[..], b"oxlint-enable", b"biome-ignore-all"]
            .into_iter()
            .any(starts_with_word)
        || strings::starts_with_case_insensitive_ascii(
            content.get(stars..).unwrap_or_default(),
            b"copyright",
        )
        || strings::contains(content, b"SPDX-License-Identifier")
        || has_tag_about_the_file(content)
}

/// Makes [`Fix`]es, as ESLint's `fixer`. Each method takes a node, a token, a comment or a
/// [`Span`].
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

    /// `byte`, `count` times: the only way to a text whose length a number in the options decides. `None`: it would be longer than
    /// [`MAX_STRING_LENGTH`]. See [`Cx::repeat_count`](crate::context::Cx::repeat_count).
    pub fn repeat(self, byte: u8, count: u64) -> Option<Vec<u8>> {
        (count <= MAX_STRING_LENGTH).then(|| vec![byte; count as usize])
    }

    /// Whether every comment in the text that `fix` replaces is in the new text too. A fix that loses a comment isn't offered.
    pub fn keeps_comments(self, fix: &Fix) -> bool {
        let mut comments = self.file.comments_in(fix.span);
        comments.all(|it| strings::contains(&fix.text, it.text()))
    }

    /// Puts `statement`, which is a whole line without its line break, before the other statements of the file. It goes after what
    /// has to stay first: the `#!` line, the comments about the file like `// @ts-nocheck`, and directives like `"use strict"`.
    pub fn insert_first_statement(self, statement: &[u8]) -> Fix {
        let directives = (self.file.body().iter()).take_while(|it| it.directive().is_some());
        let code = (self.file.body().first()).map_or(u32::MAX, |it| it.span().start);
        let comments = || self.file.comments().take_while(|it| it.end() <= code);
        let after = (directives.last().map(|it| it.span().end))
            .or_else(|| comments().filter(is_about_the_file).last().map(Token::end));
        match after {
            Some(after) => self.insert_after(Span::empty(after), [&b"\n"[..], statement].concat()),
            None => self.insert_before(Span::empty(0), [statement, b"\n"].concat()),
        }
    }

    /// Whether a comment directly before `at` is about the line after it: `// @ts-expect-error`, `// eslint-disable-next-line`, ..
    /// A fix that moves `at` away from it, or puts something between the two, makes it be about other code.
    pub fn has_directive_before(self, at: impl Spanned) -> bool {
        const DIRECTIVES: [&[u8]; 6] = [
            b"@ts-expect-error",
            b"@ts-ignore",
            b"eslint-disable-next-line",
            b"oxlint-disable-next-line",
            b"biome-ignore",
            b"prettier-ignore",
        ];
        self.file.comments_before(at).any(|it| {
            let content = it.text().get(2..).unwrap_or_default().trim_ascii_start();
            DIRECTIVES.iter().any(|it| content.starts_with(it))
        })
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

/// What the function given to [`Report::fix`](crate::context::Report::fix) returns.
pub trait IntoFix {
    /// ESLint's `mergeFixes`: one fix that does what all of them do. `None` if there are none, or
    /// if two overlap.
    fn into_fix(self, file: &File) -> Option<Fix>;

    /// The one that was made first.
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

/// ESLint's `SourceCodeFixer.applyFixes`: applies those of `fixes` that do not overlap an earlier
/// one, and returns the new text. `None` if nothing is applied.
pub fn apply_fixes(text: &[u8], fixes: &mut Vec<&Fix>) -> Option<Vec<u8>> {
    crate::utils::sort::sort_by_key(fixes, |fix| (fix.span.start, fix.span.end));
    let mut out = Vec::with_capacity(text.len());
    // ESLint starts at -1, so that an insertion at 0 does not conflict with nothing.
    let mut last: i64 = -1;
    let mut at = 0usize;
    let mut applied = false;
    for fix in fixes.iter() {
        let (start, end) = (fix.span.start as usize, fix.span.end as usize);
        if last >= start as i64 || start > end {
            continue;
        }
        // A range can go beyond the text, as for `String.prototype.slice`.
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
