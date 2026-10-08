//! The file, its `#!` line, directives, and lists of statements.

use super::semicolon::OptionalSemicolon;
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::prelude::*;
use crate::write;

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

/// The statements of a file, a block or a function body, each on its own line. The empty lines
/// between them are kept, but only one at a time. Empty statements are left out.
#[derive(Copy, Clone)]
pub(crate) struct FormatStatements<'a>(pub(crate) List<'a, Stmt<'a>>);

impl<'a> Format<'a> for FormatStatements<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let all = self.0.iter().filter(|it| !matches!(it.kind(), StmtKind::Empty));
        let mut statements = all.clone().peekable();

        // After the directives there is an empty line if there is one in the source.
        if let Some(last_directive) = all.take_while(|it| it.directive().is_some()).last() {
            // A comment behind the last directive is in the way of counting the line breaks.
            let end = last_directive.span().end;
            let check_pos = f.comments().end_of_line_comments_after(end).last().map_or(end, |c| c.span.end);
            let need_extra_empty_line = f.source_text().lines_after(check_pos) > 1;

            let mut join = f.join_nodes_with_hardline();
            while let Some(directive) = statements.next_if(|it| it.directive().is_some()) {
                join.entry(directive.span(), &directive);
            }
            match need_extra_empty_line {
                true => write!(f, empty_line()),
                false => write!(f, hard_line_break()),
            }
        }

        let mut join = f.join_nodes_with_hardline();
        for statement in statements {
            join.entry(statement.span(), &statement);
        }
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
