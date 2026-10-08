//! The file, its `#!` line, directives, and lists of statements.

use super::semicolon::OptionalSemicolon;
use super::statements::{
    CommentPlacement, comment_placements, expression_statement_needs_semicolon, follows_type_cast_comment,
};
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::prelude::*;
use crate::{format_args, write};
use smallvec::SmallVec;

pub(crate) fn write_program<'a>(file: &'a File<'a>, f: &mut Formatter<'a>) {
    let source = file.text();
    if source.starts_with(b"\xEF\xBB\xBF") {
        write!(f, text(&source[..3]));
    }
    write_hashbang(f);
    write!(f, FormatStatements(file.body()));
    let rest = f.comments().unprinted_comments();
    write!(f, [FormatTrailingComments::Comments(rest), hard_line_break()]);
}

/// `#!/usr/bin/env bun`
fn write_hashbang(f: &mut Formatter<'_>) {
    let source = f.source_text().as_bytes();
    let start = if source.starts_with(b"\xEF\xBB\xBF") { 3 } else { 0 };
    let Some(rest) = source.get(start..).filter(|rest| rest.starts_with(b"#!")) else {
        return;
    };
    let len = bun_core::strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len());
    write!(f, text(rest[..len].trim_ascii_end()));
    match f.source_text().lines_after((start + len) as u32) > 1 {
        true => write!(f, empty_line()),
        false => write!(f, hard_line_break()),
    }
}

/// `\n`, `\r\n`, `\r`, U+2028 or U+2029 at the start of `text`: what is after it.
fn strip_line_terminator(text: &[u8]) -> Option<&[u8]> {
    match text {
        [b'\r', b'\n', rest @ ..] | [b'\n' | b'\r', rest @ ..] | [0xE2, 0x80, 0xA8 | 0xA9, rest @ ..] => Some(rest),
        _ => None,
    }
}

fn trim_blanks_start(text: &[u8]) -> &[u8] {
    let count = text.iter().take_while(|b| matches!(b, b' ' | b'\t')).count();
    &text[count..]
}

/// Prettier's `isNextLineEmpty`: whether the line after the one that `position` is on is empty.
/// Commas, semicolons and comments after `position` are passed over.
pub(crate) fn is_next_line_empty(source: SourceText<'_>, position: u32) -> bool {
    let mut rest = source.as_bytes().get(position as usize..).unwrap_or_default();
    loop {
        let count = rest.iter().take_while(|b| matches!(b, b',' | b';' | b' ' | b'\t')).count();
        rest = &rest[count..];
        let Some(comment) = rest.strip_prefix(b"/*") else {
            break;
        };
        let Some(end) = bun_core::strings::index_of(comment, b"*/") else {
            break;
        };
        rest = &comment[end + 2..];
    }
    if rest.starts_with(b"//") {
        let end = bun_core::strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len());
        rest = &rest[end..];
    }
    let rest = strip_line_terminator(rest).unwrap_or(rest);
    strip_line_terminator(trim_blanks_start(rest)).is_some()
}

/// Whether Prettier's `locEnd` of `statement` is before the `;` at its end.
fn ends_before_semicolon(statement: Stmt<'_>) -> bool {
    let mut statement = statement;
    loop {
        statement = match statement.kind() {
            StmtKind::If { yes, no, .. } => no.unwrap_or(yes),
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::While { body, .. }
            | StmtKind::With { body, .. }
            | StmtKind::Labeled { body, .. } => body,
            StmtKind::Expr(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::Return(_)
            | StmtKind::Throw(_)
            | StmtKind::DoWhile { .. }
            | StmtKind::Break(_)
            | StmtKind::Continue(_)
            | StmtKind::Debugger
            | StmtKind::Var(_) => return true,
            _ => return false,
        };
    }
}

/// Whether there is an empty line after `statement`.
fn is_next_line_empty_after<'a>(statement: Stmt<'a>, f: &Formatter<'a>) -> bool {
    let (source, span) = (f.source_text(), statement.span());
    if is_next_line_empty(source, span.end) {
        return true;
    }
    // `a // comment\n\n;`
    matches!(source.slice_range(span.start, span.end), [.., b'\n' | b'\r' | b' ' | b'\t' | b'/' | 0xA8 | 0xA9, b';'])
        && ends_before_semicolon(statement)
        && is_next_line_empty(source, f.comments().without_semicolon(span).end)
}

/// Prettier's `printStatementSequence`: the statements of a file, a block or a function body, each
/// on its own line. An empty line after a statement is kept. Empty statements are left out.
#[derive(Copy, Clone)]
pub(crate) struct FormatStatements<'a>(pub(crate) List<'a, Stmt<'a>>);

impl<'a> Format<'a> for FormatStatements<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let mut previous: Option<Stmt<'a>> = None;
        for statement in self.0.iter().filter(|it| !matches!(it.kind(), StmtKind::Empty)) {
            let Some(previous_statement) = previous.replace(statement) else {
                write_semicolon_before_type_cast_comment(statement, f);
                write!(f, statement);
                continue;
            };
            // Nearly always, what is left between two statements starts its line.
            let comments = f.comments().comments_before(statement.span().start);
            let placements = match comments.iter().all(|comment| comment.preceded_by_newline()) {
                true => SmallVec::new(),
                false => write_more_trailing_comments(previous_statement, comments, statement, f),
            };
            match is_next_line_empty_after(previous_statement, f) {
                true => write!(f, empty_line()),
                false => write!(f, hard_line_break()),
            }
            for (comment, _) in comments.iter().zip(&placements).filter(|(_, placement)| placement.leads()) {
                write!(f, FormatLeadingComments::Comments(std::slice::from_ref(comment)));
            }
            write_semicolon_before_type_cast_comment(statement, f);
            write!(f, statement);
        }
    }
}

/// Of `comments`, which are what is left between `previous` and `next`, writes those that trail
/// `previous`: there is a `;` of `previous`, or an empty statement, between them and what is around
/// them.
///
///     a
///     // leads b
///     ; // trails a
///     ; // trails a
///     b;
///
/// Returns where the comments are, if those that lead `next` have to be written by the caller
/// because one of them is before one that trails.
#[cold]
fn write_more_trailing_comments<'a>(
    previous: Stmt<'a>,
    comments: &'a [Comment],
    next: Stmt<'a>,
    f: &mut Formatter<'a>,
) -> SmallVec<[CommentPlacement; 8]> {
    let placements = comment_placements(comments, next.span().start, f);
    // Prettier's `printTrailingComment`
    let mut is_after_line_comment = (f.comments().printed_comments().last())
        .is_some_and(|comment| comment.is_line() && comment.span.start >= previous.span().start);
    let mut has_line_suffix = is_after_line_comment;
    for (comment, _) in comments.iter().zip(&placements).filter(|(_, placement)| !placement.leads()) {
        f.comments_mut().increment_printed_count();
        if is_after_line_comment {
            write!(f, line_suffix(&format_args!(hard_line_break(), comment)));
        } else if comment.is_line() || has_line_suffix {
            write!(f, [line_suffix(&format_args!(space(), comment)), expand_parent()]);
        } else {
            write!(f, [space(), comment]);
        }
        has_line_suffix |= comment.is_line() || is_after_line_comment;
        is_after_line_comment = comment.is_line();
    }

    let trailing_count = placements.iter().take_while(|placement| !placement.leads()).count();
    match placements.iter().skip(trailing_count).all(|placement| placement.leads()) {
        true => SmallVec::new(),
        false => placements,
    }
}

/// Prettier's `shouldExpressionStatementPrintOwnComments`: without semicolons, the `;` that a
/// statement has to start with goes before a type cast comment, which has to stay next to its `(`.
fn write_semicolon_before_type_cast_comment<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    if f.is_quiet() || !f.comments().has_type_cast_comments() || !f.options().semicolons.is_as_needed() {
        return;
    }
    let StmtKind::Expr(expression) = statement.kind() else {
        return;
    };
    let start = statement.span().start;
    if let [rest @ .., _] = f.comments().comments_before(start)
        && follows_type_cast_comment(start, f)
        && expression_statement_needs_semicolon(statement, expression, f)
    {
        write!(f, [FormatLeadingComments::Comments(rest), ";"]);
    }
}

/// `"use strict";`
pub(crate) fn write_directive<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let StmtKind::Expr(expression) = statement.kind() else {
        return;
    };
    write!(
        f,
        [
            FormatLiteralStringToken::new(expression.text(), false, StringLiteralParentKind::Directive),
            OptionalSemicolon
        ]
    );
}
