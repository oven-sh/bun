//! What oxlint and oxfmt refuse. Their parser, OXC's, and the pass that builds its scopes report what ECMAScript calls early
//! errors, and much of what TypeScript's checker reports as an error of the grammar. TypeScript's parser, which has parsed the
//! file here, leaves all of that to the checker.
//!
//! The oracle: real files, ended after a token or with a token taken out, through both tools.

use super::{SyntaxError, espree};
use crate::ast::File;
use bun_sema::hir::{DiagnosticKind, Flags, VarKind};

/// The first of the errors that TypeScript's parser logs for the checker to report and that OXC has too. It has few of them.
fn error_of_grammar<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    let of_grammar = file.hir.diagnostics.iter().filter(|it| {
        it.kind == DiagnosticKind::Grammar
            // "Variable declaration list cannot be empty."
            && it.code == 1123
            && !file.is_in_jsdoc(it.start)
    });
    let first = of_grammar.min_by_key(|it| it.start)?;
    let mut message = Vec::new();
    match bun_sema::messages::message(first.code) {
        Some((_, text)) => bun_sema::messages::format(&mut message, text, &first.args),
        None => message.extend_from_slice(b"Unexpected token"),
    }
    Some(SyntaxError {
        at: first.start,
        message,
    })
}

/// `const a`, `using a`, where nothing else gives it a value and it is not only declared.
fn declaration_without_initializer<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    if file.is_declaration_file() {
        return None;
    }
    let (hir, bound) = (&file.hir, &file.bound);
    let is_in_loop_head = |statement: bun_sema::hir::StmtId| {
        use bun_sema::bind::Parent;
        use bun_sema::hir::StmtKind;
        match bound.stmt_parent.get(statement.idx()) {
            Some(&Parent::Stmt(parent)) => matches!(
                hir.stmts.get(parent.idx()).map(|it| it.kind),
                Some(StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }) if left == statement
            ),
            _ => false,
        }
    };
    let lacking = hir.var_decls.iter().enumerate().find(|(i, it)| {
        it.init.is_none()
            && !matches!(it.kind, VarKind::Var | VarKind::Let)
            && !it.flags.contains(Flags::AMBIENT)
            && !file.is_in_jsdoc(it.loc.end)
            // Not the parameter of a `catch`.
            && (bound.var_stmt.get(*i)).is_some_and(|list| list.is_some() && !is_in_loop_head(*list))
    });
    lacking.map(|(_, it)| SyntaxError {
        at: it.loc.end,
        message: match it.kind {
            VarKind::Const => b"Missing initializer in const declaration".to_vec(),
            _ => b"Using declarations must have an initializer.".to_vec(),
        },
    })
}

/// The error for which OXC refuses a file in which TypeScript's parser has found none.
pub(super) fn first_error<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    let early = espree::first_error_of_oxc(file);
    if file.is_javascript() {
        return early;
    }
    [
        error_of_grammar(file),
        declaration_without_initializer(file),
        early,
    ]
    .into_iter()
    .flatten()
    .min_by_key(|it| it.at)
}
