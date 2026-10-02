//! What comments say to the type checker: `// @ts-ignore` and `// @ts-expect-error`, `/// <reference .. />`, `// @ts-check` and
//! `// @ts-nocheck`, `/* @jsx h */` and its like.
//!
//! Nothing here looks for a comment. The lexer stands on each comment once. That is when it asks `process_comment_directive`, as
//! TypeScript's scanner does, and when it puts the comment in `Lexer::all_comments`. Those that were there when the parser stood on the
//! first token are what `getCommentPragmas` goes through.

use crate::lexer::{Lexer, starts_with_line_break};
use bun_sema::atom::Interner;
use bun_sema::hir::{
    CommentDirective, CommentDirectiveKind, File, FileKind, JsxPragmas, ReferenceKind,
    ResolutionMode,
};

/// `Lexer::comment_flags`
pub(crate) mod flags {
    /// `GetLeadingCommentRanges`: a line break between it and what comes before it, a token or a comment.
    pub(crate) const LINE_BREAK_BEFORE: u8 = 1 << 0;
    /// `isJSDocLikeText`
    pub(crate) const JSDOC_LIKE: u8 = 1 << 1;
    /// `KindSingleLineCommentTrivia`
    pub(crate) const SINGLE_LINE: u8 = 1 << 2;
}

impl Lexer<'_> {
    /// Of the comment that has just been scanned, from `start` to `end`, and put in `all_comments`.
    #[inline(never)]
    pub(crate) fn push_comment_flags(&mut self) {
        let text = self.contents;
        // A comment on the way to the same token, or the token before.
        let before = match self.all_comments.iter().rev().nth(1) {
            Some(comment) if comment.loc.to_usize() >= self.token_full_start => comment.end_i(),
            _ => self.token_full_start,
        };
        let mut said = 0;
        if (before..self.start).any(|at| starts_with_line_break(&text[at..])) {
            said |= flags::LINE_BREAK_BEFORE;
        }
        let comment = &text[self.start..self.end];
        if super::jsdoc::is_jsdoc_like(comment) {
            said |= flags::JSDOC_LIKE;
        }
        if comment.starts_with(b"//") {
            said |= flags::SINGLE_LINE;
        }
        self.comment_flags.push(said);
    }

    /// `processCommentDirective`, of the comment that has just been scanned, from `start` to `end`. `multiline`: it is a `/* */`
    /// comment, of which the last line counts (`last_line_start`).
    #[inline(never)]
    pub(crate) fn process_comment_directive(&mut self, multiline: bool) {
        let (text, end) = (self.contents, self.end);
        let skip = |mut pos: usize, wanted: &[u8]| {
            while pos < end && wanted.contains(&text[pos]) {
                pos += 1;
            }
            pos
        };
        let (start, pos) = if multiline {
            // "Skip whitespace", "Skip combinations of / and *"
            let start = self.last_line_start;
            (start, skip(skip(start, b" \t"), b"/*"))
        } else {
            // "Skip opening //", "Skip another / if present"
            (self.start, skip(self.start + 2, b"/"))
        };
        let pos = skip(pos, b" \t");
        // "Directive must start with '@'"
        if !(pos < end && text[pos] == b'@') {
            return;
        }
        let kind = if text[pos + 1..].starts_with(b"ts-expect-error") {
            CommentDirectiveKind::ExpectError
        } else if text[pos + 1..].starts_with(b"ts-ignore") {
            CommentDirectiveKind::Ignore
        } else {
            return;
        };
        self.comment_directives.push(CommentDirective {
            start: start as u32,
            end: end as u32,
            kind,
        });
    }
}

/// `getCommentPragmas` and `processPragmasIntoFields`. `leading`: how many of `Lexer::all_comments` there were when the parser stood on
/// the first token, the `#!` line aside.
pub(crate) fn process_pragmas_into_fields(
    lexer: &Lexer<'_>,
    leading: usize,
    atoms: &Interner,
    file: &mut File,
) {
    for range in lexer.all_comments.iter().take(leading) {
        let pos = range.loc.to_usize();
        let comment = &lexer.contents[pos..range.end_i()];
        match comment.get(..2) {
            Some(b"//") => single_line_pragma(comment, pos, atoms, file),
            // Only where there can be JSX does anything ask.
            Some(b"/*") if file.kind == FileKind::Tsx => {
                multi_line_pragmas(comment, atoms, &mut file.jsx_pragmas);
            }
            Some(b"/*") => {}
            // A conflict marker, which the list has as well: `GetLeadingCommentRanges` stops at it.
            _ => break,
        }
    }
}

/// `extractPragmas` of the `//` comment `text`, which is at `comment_pos`, and what `processPragmasIntoFields` makes of it.
fn single_line_pragma(text: &[u8], comment_pos: usize, atoms: &Interner, file: &mut File) {
    let mut pos = 2;
    let triple_slash = text.get(pos) == Some(&b'/');
    if triple_slash {
        pos += 1;
    }
    pos = skip_blanks(text, pos);
    if text.get(pos) == Some(&b'@') {
        // "_last_ of either nocheck or check in a file is the "winner""
        let name = extract_name(text, pos + 1);
        if name.eq_ignore_ascii_case(b"ts-check") {
            file.check_directive = Some(true);
        } else if name.eq_ignore_ascii_case(b"ts-nocheck") {
            file.check_directive = Some(false);
        }
        return;
    }
    if !triple_slash
        || text.get(pos) != Some(&b'<')
        || !extract_name(text, pos + 1).eq_ignore_ascii_case(b"reference")
    {
        return;
    }
    pos += "<reference".len();
    const NAMES: [&[u8]; 5] = [
        b"types",
        b"lib",
        b"path",
        b"resolution-mode",
        b"no-default-lib",
    ];
    // `PragmaArgument.TextRange`, in the comment. Of two that go by one name the last counts.
    let mut args: [Option<(usize, usize)>; 5] = [None; 5];
    loop {
        pos = skip_blanks(text, pos);
        let name = extract_name(text, pos);
        if name.is_empty() {
            break;
        }
        pos = skip_blanks(text, pos + name.len());
        if text.get(pos) != Some(&b'=') {
            break;
        }
        pos = skip_blanks(text, pos + 1);
        let Some(value) = extract_quoted_string(text, pos) else {
            break;
        };
        if let Some(n) = NAMES.iter().position(|it| name.eq_ignore_ascii_case(it)) {
            args[n] = Some((pos + 1, pos + 1 + value.len()));
        }
        pos += value.len() + 2;
    }
    let [types, lib, path, resolution_mode, no_default_lib] = args;
    if no_default_lib.is_some_and(|(from, to)| &text[from..to] == b"true") {
        return;
    }
    let (kind, (from, to)) = match (types, lib, path) {
        (Some(types), ..) => (ReferenceKind::Types, types),
        (None, Some(lib), _) => (ReferenceKind::Lib, lib),
        (None, None, Some(path)) => (ReferenceKind::Path, path),
        (None, None, None) => {
            file.early_errors.push((comment_pos as u32, 1084));
            return;
        }
    };
    // `parseResolutionMode`
    let mode = match resolution_mode.filter(|_| kind == ReferenceKind::Types) {
        Some((from, to)) => match &text[from..to] {
            b"import" => ResolutionMode::Import,
            b"require" => ResolutionMode::Require,
            _ => {
                file.early_errors.push(((comment_pos + from) as u32, 1453));
                ResolutionMode::None
            }
        },
        None => ResolutionMode::None,
    };
    let value = atoms.intern(&text[from..to]);
    file.references
        .push((kind, value, (comment_pos + from) as u32, mode));
}

/// `extractPragmas` of the `/* */` comment `text`. Of two that say the same thing the last counts (`GetPragmaFromSourceFile`).
fn multi_line_pragmas(text: &[u8], atoms: &Interner, pragmas: &mut JsxPragmas) {
    let text = text.strip_suffix(b"*/").unwrap_or(text);
    let mut pos = 2;
    // `skipTo`
    while let Some(found) = text
        .get(pos..)
        .and_then(|rest| bun_core::strings::index_of_char_usize(rest, b'@'))
    {
        pos += found;
        // "the '@' must be immediately followed by a non-whitespace pragma name, and the remainder of the line is consumed as that
        // pragma's arguments"
        let name_end = skip_non_blanks(text, pos + 1);
        if name_end == pos + 1 {
            pos += 1;
            continue;
        }
        let name = &text[pos + 1..name_end];
        let start = skip_blanks(text, name_end);
        let argument = &text[start..skip_non_blanks(text, start)];
        let is = |it: &[u8]| !argument.is_empty() && name.eq_ignore_ascii_case(it);
        if is(b"jsx") {
            pragmas.factory = atoms.intern(argument);
        } else if is(b"jsxFrag") {
            pragmas.fragment_factory = atoms.intern(argument);
        } else if is(b"jsxImportSource") {
            pragmas.import_source = atoms.intern(argument);
        } else if is(b"jsxRuntime") {
            // `GetJSXImplicitImportBase`
            pragmas.classic = match argument {
                b"classic" => Some(true),
                b"automatic" => Some(false),
                _ => None,
            };
        }
        pos = line_end_pos(text, pos);
    }
}

fn skip_blanks(text: &[u8], mut pos: usize) -> usize {
    while pos < text.len() && matches!(text[pos], b' ' | b'\t') {
        pos += 1;
    }
    pos
}

fn skip_non_blanks(text: &[u8], mut pos: usize) -> usize {
    while pos < text.len() && !matches!(text[pos], b' ' | b'\t' | b'\r' | b'\n') {
        pos += 1;
    }
    pos
}

fn line_end_pos(text: &[u8], pos: usize) -> usize {
    (pos..text.len())
        .find(|&at| {
            matches!(text[at], b'\n' | b'\r') || matches!(text[at..], [0xE2, 0x80, 0xA8 | 0xA9, ..])
        })
        .unwrap_or(text.len())
}

/// Not in lower case, as `extractName` has it: who compares it goes by neither case.
fn extract_name(text: &[u8], pos: usize) -> &[u8] {
    let rest = text.get(pos..).unwrap_or_default();
    let len = rest
        .iter()
        .take_while(|c| c.is_ascii_alphabetic() || **c == b'-')
        .count();
    &rest[..len]
}

fn extract_quoted_string(text: &[u8], pos: usize) -> Option<&[u8]> {
    let quote = *text.get(pos)?;
    if quote != b'\'' && quote != b'"' {
        return None;
    }
    let rest = &text[pos + 1..];
    Some(&rest[..rest.iter().position(|&c| c == quote)?])
}
