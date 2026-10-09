//! What oxlint and oxfmt refuse. Their parser, OXC's, and the pass that builds its scopes report what ECMAScript calls early
//! errors, and much of what TypeScript's checker reports as an error of the grammar. TypeScript's parser, which has parsed the
//! file here, leaves all of that to the checker.
//!
//! The oracle: real files, ended after a token or with a token taken out, through both tools.

use super::{SyntaxError, espree, typescript_estree};
use crate::ast::{Expr, File, Handle};
use crate::tokens::token_len;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::{ExprKind, Flags, FnKind, ModifierKind, PatKind, StmtKind, VarKind};

/// What typescript-estree throws and OXC refuses too, by how the message starts. OXC lets most of the rest pass.
const OF_TYPESCRIPT_ESTREE: [&str; 4] = [
    "A class declaration without the 'default' modifier must have a name.",
    "A variable declaration list must have at least one variable declarator.",
    "JSDoc types can only be used inside documentation comments.",
    "Only a single variable declaration is allowed in a 'for...",
];

/// A word that is reserved in strict code, where a name is read, declared or a label. For OXC a file is strict if it is a
/// module, and nothing is reserved in what is only declared. Code that is strict for another reason is not looked at.
fn reserved_word<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    if file.is_declaration_file() || !espree::has_module_syntax(file) {
        return None;
    }
    let hir = &file.hir;
    let is_reserved = |name: Atom| {
        name.is_keyword_identifier() && name != known::eval && name != known::arguments
    };
    let read = hir.exprs.iter().enumerate().filter_map(|(i, it)| {
        let is_name = matches!(it.kind, ExprKind::Ident(name) if is_reserved(name))
            && file.expr_in_tree(i).is_some()
            && !Expr::from_raw(file, i as u32).is_jsx_tag_name();
        is_name.then_some(it.pos)
    });
    let declared = hir.pats.iter().enumerate().filter_map(|(i, it)| {
        let is_name = matches!(it.kind, PatKind::Ident(name) if is_reserved(name))
            && file.pat_in_tree(i).is_some();
        is_name.then_some(it.pos)
    });
    let functions = (hir.fns.iter())
        .filter(|it| matches!(it.kind, FnKind::Decl | FnKind::Expr) && is_reserved(it.name))
        .map(|it| it.name_pos);
    let classes = (hir.classes.iter())
        .filter(|it| is_reserved(it.name))
        .map(|it| it.name_pos);
    let labels = hir.stmts.iter().filter_map(|it| {
        matches!(it.kind, StmtKind::Labeled { label, .. } if is_reserved(label)).then_some(it.start)
    });
    let is_declare =
        |it: &bun_sema::hir::Modifier| it.kind == ModifierKind::Keyword(Flags::AMBIENT);
    let is_only_declared = |at: u32| {
        hir.stmts.iter().any(|it| {
            it.start <= at
                && at < it.loc.end
                && (hir.modifiers.get(it.modifiers.range()))
                    .is_some_and(|modifiers| modifiers.iter().any(is_declare))
        })
    };
    let at = read
        .chain(declared)
        .chain(functions)
        .chain(classes)
        .chain(labels)
        .filter(|&at| !file.is_in_jsdoc(at) && !is_only_declared(at))
        .min()?;
    let word = file.text().get(at as usize..).unwrap_or_default();
    let word = word.get(..token_len(word)).unwrap_or_default();
    Some(SyntaxError {
        at,
        message: [b"The keyword '", word, b"' is reserved"].concat(),
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
    first_of(file, espree::first_error_of_oxc(file))
}

/// The same for a formatter.
pub(super) fn first_error_for_formatter<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    first_of(file, espree::first_error_of_oxc_for_formatter(file))
}

/// `early`: the first of the early errors.
fn first_of<'a>(file: &'a File<'a>, early: Option<SyntaxError>) -> Option<SyntaxError> {
    let early = [early, reserved_word(file)];
    if file.is_javascript() {
        return early.into_iter().flatten().min_by_key(|it| it.at);
    }
    let is_refused = |it: &SyntaxError| {
        (OF_TYPESCRIPT_ESTREE.iter()).any(|start| it.message.starts_with(start.as_bytes()))
    };
    let [early, reserved] = early;
    [
        declaration_without_initializer(file),
        typescript_estree::first_error(file, false).filter(is_refused),
        early,
        reserved,
    ]
    .into_iter()
    .flatten()
    .min_by_key(|it| it.at)
}
