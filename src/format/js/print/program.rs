//! The file, its `#!` line, directives, and lists of statements.

use super::semicolon::OptionalSemicolon;
use super::statements::{expression_statement_needs_semicolon, follows_type_cast_comment};
use crate::ir::element::TextWidth;
use crate::js::ast_nodes::node_as_ast_nodes;
use crate::js::sort_imports::ImportRun;
use crate::js::trivia::comment_before_semicolon_keeps_its_line;
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::prelude::*;
use crate::write;

pub(crate) fn write_program<'a>(file: &'a File<'a>, f: &mut Formatter<'a>) {
    let source = file.text();
    if source.starts_with(b"\xEF\xBB\xBF") {
        // Prettier strips the BOM before formatting, so it has no width.
        f.write_text(&source[..3], Some(TextWidth::single(0)));
    }
    write_hashbang(false, f);
    // The program only owns comments if there's no statement to attach them to.
    let program = node_as_ast_nodes(Node::File(file));
    write!(
        f,
        [
            leading_comments(program),
            FormatStatements(file.body()),
            dangling_comments(program)
        ]
    );
    // In a file with only directives and comments, oxfmt's empty line after the last directive is printed after the
    // comments.
    let ends_with_empty_line = (file.body().last()).is_some_and(|last| {
        is_directive_before_empty_line(last, f)
            && (source.get(last.span().end as usize..))
                .is_some_and(|tail| !tail.trim_ascii().is_empty())
    });
    match ends_with_empty_line {
        true => write!(f, empty_line()),
        false => write!(f, hard_line_break()),
    }
}

/// `#!/usr/bin/env bun`. `is_last` means nothing is printed after it, not even a line break.
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
    // U+2028 and U+2029 also end the line.
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

/// True if Prettier's `locEnd` of `statement` is before its final `;`.
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

/// True if there's an empty line after `statement`.
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
        && is_next_line_empty(source, f.file().without_semicolon(span).end)
}

/// `type A = 1⏎⏎;(b)`: the `;` belongs to the type alias. oxfmt keeps the empty line anyway.
fn empty_line_before_semicolon_is_after_any_statement(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `printStatementSequence`: the statements of a file, block or function body, each on its own line. Keeps
/// an empty line after a statement and drops empty statements.
#[derive(Copy, Clone)]
pub(crate) struct FormatStatements<'a>(pub(crate) List<'a, Stmt<'a>>);

impl<'a> Format<'a> for FormatStatements<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let mut previous: Option<Stmt<'a>> = None;
        let mut imports = ImportRun::new(f);
        for statement in self.0.iter().filter(|it| it.tag() != StmtTag::Empty) {
            if let Some(previous_statement) = previous.replace(statement) {
                imports.before_separator(statement, true, f);
                let is_next_line_empty =
                    match own_line_comment_before_semicolon(previous_statement, f) {
                        Some(comment) => f.lines_before(comment.span()) > 1,
                        None => {
                            !follows_semicolon_and_spaces(statement, f)
                                && is_next_line_empty_after(previous_statement, f)
                        }
                    };
                match is_next_line_empty {
                    true => write!(f, empty_line()),
                    false => write!(f, hard_line_break()),
                }
            }
            imports.before_statement(statement, f);
            write_semicolon_before_type_cast_comment(statement, f);
            write!(f, statement);
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

/// `a ⏎ /* comment */; ⏎⏎ b`: see [`comment_before_semicolon_keeps_its_line`]. The comment is printed on its own line
/// after `a;`, so an empty line between the two is kept only if there's one before the comment. A comment on `a`'s line
/// can come first: `a // comment ⏎ // comment ⏎; ⏎⏎ b`
fn own_line_comment_before_semicolon<'a>(
    statement: Stmt<'a>,
    f: &Formatter<'a>,
) -> Option<Comment<'a>> {
    if f.is_quiet() || !comment_before_semicolon_keeps_its_line(f) {
        return None;
    }
    let semicolon = statement.span().end.checked_sub(1)?;
    if f.source_text().byte_at(semicolon) != Some(b';') {
        return None;
    }
    (f.comments().comments_directly_before(semicolon).iter())
        .find(|comment| comment.has_newline_before())
}

/// `a()⏎⏎; [b].c()`: oxfmt looks for an empty line before a statement, and skips over a `;` only if it's right before
/// the statement.
fn follows_semicolon_and_spaces<'a>(statement: Stmt<'a>, f: &Formatter<'a>) -> bool {
    f.options().flavor.is_oxfmt()
        && !f.comments().has_comment_before(statement.span().start)
        && (f.file().text().get(..statement.span().start as usize)).is_some_and(|before| {
            let code = before.trim_ascii_end();
            code.len() < before.len()
                && code.ends_with(b";")
                && bun_core::strings::index_of_any(&before[code.len()..], b"\r\n").is_none()
        })
}

/// `function a() { "use strict";⏎⏎}`: oxfmt keeps the empty line after the last directive no matter what follows, even
/// nothing.
fn is_directive_before_empty_line<'a>(last: Stmt<'a>, f: &Formatter<'a>) -> bool {
    f.options().flavor.is_oxfmt() && last.directive().is_some() && is_next_line_empty_after(last, f)
}

/// Prettier's `shouldExpressionStatementPrintOwnComments`: without semicolons, a statement's leading `;` goes before a
/// type cast comment, which has to stay next to its `(`.
#[inline]
fn write_semicolon_before_type_cast_comment<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    if !f.is_quiet() && f.options().semicolons.is_as_needed() {
        write_semicolon_before_type_cast_comment_of(statement, f);
    }
}

#[cold]
fn write_semicolon_before_type_cast_comment_of<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let StmtKind::Expr(expression) = statement.kind() else {
        return;
    };
    let node = statement.as_ast_nodes();
    if let Some((_, rest)) = f.comments().of_node(node).leading.split_last()
        && follows_type_cast_comment(statement.span().start, f)
        && (!f.comments().is_ignored(node)
            || semicolon_goes_before_ignored_statement_cast_comment(f))
        && expression_statement_needs_semicolon(statement, expression, f)
    {
        write!(f, [FormatLeadingComments::Comments(rest), ";"]);
    }
}

/// `// prettier-ignore ⏎ /** @type {T} */ (a).b()` without semicolons: Prettier prints the `;` right before the copied
/// text, between the comment and its `(`. oxfmt keeps the two together: `;/** @type {T} */ (a).b()`
pub(crate) fn semicolon_goes_before_ignored_statement_cast_comment(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `"use strict";`
#[inline(never)]
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
