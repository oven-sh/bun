//! The file, its `#!` line, directives, and lists of statements.

use super::semicolon::OptionalSemicolon;
use super::statements::{
    CommentPlacement, comment_placements, expression_statement_needs_semicolon,
    follows_type_cast_comment,
};
use crate::ir::element::TextWidth;
use crate::js::format::FormatStatementBeforeAnother;
use crate::js::sort_imports::ImportRun;
use crate::js::trivia::comment_before_semicolon_keeps_its_line;
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::prelude::*;
use crate::{format_args, write};
use smallvec::SmallVec;

pub(crate) fn write_program<'a>(file: &'a File<'a>, f: &mut Formatter<'a>) {
    let source = file.text();
    if source.starts_with(b"\xEF\xBB\xBF") {
        // Prettier takes it off before it formats: it has no width.
        f.write_text(&source[..3], Some(TextWidth::single(0)));
    }
    write_hashbang(false, f);
    // Nothing that a comment could belong to: they are all Prettier's dangling comments of the
    // program, which have no empty lines between them.
    if !file.body().is_empty()
        && file
            .body()
            .iter()
            .all(|it| matches!(it.kind(), StmtKind::Empty))
    {
        let comments = f.comments().unprinted_comments();
        let indent = DanglingIndentMode::None;
        return write!(
            f,
            [
                FormatDanglingComments::Comments { comments, indent },
                hard_line_break()
            ]
        );
    }
    write!(f, FormatStatements(file.body()));
    let mut rest = f.comments().unprinted_comments();
    // The empty lines before the first thing in a file go.
    let is_blank = |before: &[u8]| {
        (before.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(before))
            .trim_ascii()
            .is_empty()
    };
    if let Some((first, others)) = rest.split_first()
        && source
            .get(..first.span.start as usize)
            .is_some_and(is_blank)
    {
        let (comments, indent) = (std::slice::from_ref(first), DanglingIndentMode::None);
        write!(f, FormatDanglingComments::Comments { comments, indent });
        rest = others;
    }
    // Behind the comments, if that is all there is in the file.
    let ends_with_empty_line = (file.body().last()).is_some_and(|last| {
        is_directive_before_empty_line(last, f)
            && (source.get(last.span().end as usize..))
                .is_some_and(|behind| !behind.trim_ascii().is_empty())
    });
    write!(f, FormatTrailingComments::Comments(rest));
    match ends_with_empty_line {
        true => write!(f, empty_line()),
        false => write!(f, hard_line_break()),
    }
}

/// `#!/usr/bin/env bun`. `is_last`: nothing is written behind it, not even a line break.
pub(crate) fn write_hashbang(is_last: bool, f: &mut Formatter<'_>) {
    let source = f.source_text().as_bytes();
    let start = if source.starts_with(b"\xEF\xBB\xBF") {
        3
    } else {
        0
    };
    let Some(rest) = source.get(start..).filter(|rest| rest.starts_with(b"#!")) else {
        return;
    };
    let len = bun_core::strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len());
    // U+2028 and U+2029 end the line too.
    let len = [&b"\xE2\x80\xA8"[..], b"\xE2\x80\xA9"]
        .iter()
        .filter_map(|separator| bun_core::strings::index_of(&rest[..len], separator))
        .min()
        .unwrap_or(len);
    write!(f, text(rest[..len].trim_ascii_end()));
    if is_last {
        return;
    }
    match f.source_text().lines_after((start + len) as u32) > 1 {
        true => write!(f, empty_line()),
        false => write!(f, hard_line_break()),
    }
}

/// Prettier's `isNextLineEmpty`
#[inline]
pub(crate) fn is_next_line_empty(source: SourceText<'_>, position: u32) -> bool {
    crate::text::is_next_line_empty(source.as_bytes(), position as usize)
}

/// Whether Prettier's `locEnd` of `statement` is before the `;` at its end.
pub(crate) fn ends_before_semicolon(statement: Stmt<'_>) -> bool {
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
    matches!(
        source.text_for(&span),
        [.., b'\n' | b'\r' | b' ' | b'\t' | b'/' | 0xA8 | 0xA9, b';']
    ) && (ends_before_semicolon(statement)
        // An `ExportNamedDeclaration` around a declaration.
        || statement.is_exported()
        || empty_line_before_semicolon_is_after_any_statement(f))
        && is_next_line_empty(source, f.comments().without_semicolon(span).end)
}

/// `type A = 1⏎⏎;(b)`: the `;` is that of the type alias. oxfmt keeps the empty line all the same.
fn empty_line_before_semicolon_is_after_any_statement(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `printStatementSequence`: the statements of a file, a block or a function body, each
/// on its own line. An empty line after a statement is kept. Empty statements are left out.
#[derive(Copy, Clone)]
pub(crate) struct FormatStatements<'a>(pub(crate) List<'a, Stmt<'a>>);

impl<'a> Format<'a> for FormatStatements<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let mut previous: Option<Stmt<'a>> = None;
        let mut imports = ImportRun::new(f);
        let last_index = self.0.len().saturating_sub(1);
        for (index, statement) in self
            .0
            .iter()
            .enumerate()
            .filter(|(_, it)| it.tag() != StmtTag::Empty)
        {
            let write_statement = |f: &mut Formatter<'a>| match index == last_index {
                true => write!(f, statement),
                false => write!(f, FormatStatementBeforeAnother(statement)),
            };
            let Some(previous_statement) = previous.replace(statement) else {
                imports.before_statement(statement, f);
                write_semicolon_before_type_cast_comment(statement, f);
                write_statement(f);
                continue;
            };
            // Nearly always, what is left between two statements starts its line.
            let comments = match f.is_quiet() {
                true => &[][..],
                false => f.comments().comments_before(statement.span().start),
            };
            let starts_line = |comment: &Comment| {
                comment.preceded_by_newline()
                    || is_behind_empty_statements_that_start_line(previous_statement, comment, f)
            };
            let placements = match comments.iter().all(starts_line) {
                true => SmallVec::new(),
                false => write_more_trailing_comments(previous_statement, comments, statement, f),
            };
            imports.before_separator(statement, placements.is_empty(), f);
            // `a ⏎ /* comment */; ⏎ b`
            let is_next_line_empty = match comments.first() {
                Some(first)
                    if first.preceded_by_newline()
                        && first.span.start < previous_statement.span().end
                        && comment_before_semicolon_keeps_its_line(f) =>
                {
                    f.lines_before(first.span) > 1
                }
                None if is_behind_semicolon_and_blanks(statement, f) => false,
                _ => is_next_line_empty_after(previous_statement, f),
            };
            match is_next_line_empty {
                true => write!(f, empty_line()),
                false => write!(f, hard_line_break()),
            }
            imports.before_statement(statement, f);
            for (comment, _) in comments
                .iter()
                .zip(&placements)
                .filter(|(_, placement)| placement.leads())
            {
                write!(
                    f,
                    FormatLeadingComments::Comments(std::slice::from_ref(comment))
                );
            }
            write_semicolon_before_type_cast_comment(statement, f);
            write_statement(f);
        }

        // `a; // comment\n;`: the comments around an empty statement at the end trail `a`.
        if previous.is_some()
            && !f.is_quiet()
            && let Some(last) = self.0.last().filter(|last| last.tag() == StmtTag::Empty)
        {
            let end = last.ast_parent().span().end;
            write!(
                f,
                FormatTrailingComments::Comments(f.comments().comments_before(end))
            );
        }
        // `return // a⏎/* b */;`: what `return` has left for the next statement, and there is none.
        if let Some(last) = previous
            && !f.is_quiet()
            && f.options().flavor.is_oxfmt()
        {
            let comments = f.comments().comments_before(last.span().end);
            write!(f, FormatTrailingComments::Comments(comments));
        }
        imports.finish(f);
        if let Some(last) = previous
            && is_directive_before_empty_line(last, f)
            && matches!(last.parent(), Node::Func(_))
        {
            write!(f, empty_line());
        }
    }
}

/// `a()⏎⏎; [b].c()`: oxfmt looks for an empty line before a statement, and over a `;` only if that is right before it.
fn is_behind_semicolon_and_blanks<'a>(statement: Stmt<'a>, f: &Formatter<'a>) -> bool {
    f.options().flavor.is_oxfmt()
        && (f.file().text().get(..statement.span().start as usize)).is_some_and(|before| {
            let code = before.trim_ascii_end();
            code.len() < before.len()
                && code.ends_with(b";")
                && bun_core::strings::index_of_any(&before[code.len()..], b"\r\n").is_none()
        })
}

/// `a;⏎;// comment⏎b;`, as bundlers write it: with the empty statement gone the comment starts its line, and for oxfmt it
/// leads `b`. For Prettier it trails `a`.
fn is_behind_empty_statements_that_start_line<'a>(
    previous: Stmt<'a>,
    comment: &Comment,
    f: &Formatter<'a>,
) -> bool {
    f.options().flavor.is_oxfmt()
        && previous.span().end <= comment.span.start
        && (f
            .source_text()
            .text_for(&previous.span().between(comment.span))
            .iter()
            .rev())
        .find(|byte| !matches!(byte, b' ' | b'\t' | b';'))
        .is_some_and(|byte| matches!(byte, b'\n' | b'\r'))
}

/// `function a() { "use strict";⏎⏎}`: oxfmt keeps the empty line after the last directive, whatever follows, be it
/// nothing.
fn is_directive_before_empty_line<'a>(last: Stmt<'a>, f: &Formatter<'a>) -> bool {
    f.options().flavor.is_oxfmt() && last.directive().is_some() && is_next_line_empty_after(last, f)
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
    let mut is_after_line_comment =
        (f.comments().printed_comments().last()).is_some_and(|comment| {
            // It trails `previous`, and is not in it: `{ // comment⏎};`
            let rest = Span::new(comment.end(), previous.span().end.max(comment.end()));
            comment.is_line()
                && comment.span.start >= previous.span().start
                && matches!(f.source_text().text_for(&rest).trim_ascii(), b"" | b";")
        });
    let mut has_line_suffix = is_after_line_comment;
    for (comment, _) in comments
        .iter()
        .zip(&placements)
        .filter(|(_, placement)| !placement.leads())
    {
        f.comments_mut().increment_printed_count();
        if is_after_line_comment {
            write!(f, line_suffix(&format_args!(hard_line_break(), comment)));
        } else if comment.is_line() || has_line_suffix {
            write!(
                f,
                [
                    line_suffix(&format_args!(space(), comment)),
                    expand_parent()
                ]
            );
        } else {
            write!(f, [space(), comment]);
        }
        has_line_suffix |= comment.is_line() || is_after_line_comment;
        is_after_line_comment = comment.is_line();
    }

    let trailing_count = placements
        .iter()
        .take_while(|placement| !placement.leads())
        .count();
    match placements
        .iter()
        .skip(trailing_count)
        .all(|placement| placement.leads())
    {
        true => SmallVec::new(),
        false => placements,
    }
}

/// Prettier's `shouldExpressionStatementPrintOwnComments`: without semicolons, the `;` that a
/// statement has to start with goes before a type cast comment, which has to stay next to its `(`.
#[inline]
fn write_semicolon_before_type_cast_comment<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    if !f.is_quiet()
        && f.comments().has_type_cast_comments()
        && f.options().semicolons.is_as_needed()
    {
        write_semicolon_before_type_cast_comment_of(statement, f);
    }
}

#[cold]
fn write_semicolon_before_type_cast_comment_of<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let StmtKind::Expr(expression) = statement.kind() else {
        return;
    };
    let start = statement.span().start;
    if let [rest @ .., _] = f.comments().comments_before(start)
        && follows_type_cast_comment(start, f)
        && (!f.comments().is_suppressed(start)
            || semicolon_is_before_cast_comment_of_ignored_statement(f))
        && expression_statement_needs_semicolon(statement, expression, f)
    {
        write!(f, [FormatLeadingComments::Comments(rest), ";"]);
    }
}

/// Prettier writes the `;` of a statement that is not formatted right before its text. oxfmt keeps the
/// comment next to its `(`.
fn semicolon_is_before_cast_comment_of_ignored_statement(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `"use strict";`
pub(crate) fn write_directive<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let StmtKind::Expr(expression) = statement.kind() else {
        return;
    };
    write!(
        f,
        [
            FormatLiteralStringToken::new(
                expression.text(),
                false,
                StringLiteralParentKind::Directive
            ),
            OptionalSemicolon
        ]
    );
}
