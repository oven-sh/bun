//! What oxlint and oxfmt refuse. Their parser, OXC's, and the pass that builds its scopes report what ECMAScript calls early
//! errors, and much of what TypeScript's checker reports as an error of the grammar. TypeScript's parser, which has parsed the
//! file here, leaves all of that to the checker.
//!
//! The oracle: real files, ended after a token or with a token taken out, through both tools.
//!
//! All of this runs on every file, and nearly no file has such an error. So nothing here walks the expressions of a file in
//! which no cheap sign says that there is something to find, or asks for them by kind.

use super::{SyntaxError, espree};
use crate::ast::{Class, Expr, File, Func, Handle, Node, Param, StmtTag};
use crate::tokens::token_len;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{ClassOwner, Parent};
use bun_sema::hir::{
    DiagnosticKind, ExprKind, Flags, FnKind, Modifier, ModifierKind, ParamId, PatKind, StmtId,
    StmtKind, VarKind,
};
use smallvec::SmallVec;

fn is_keyword(modifier: &Modifier, flag: Flags) -> bool {
    modifier.kind == ModifierKind::Keyword(flag)
}

/// The first of the errors that TypeScript's parser logs for the checker to report and that OXC has too. It has few of them.
fn error_of_grammar<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    let of_grammar = file.hir.diagnostics.iter().filter(|it| {
        it.kind == DiagnosticKind::Grammar
            // "JSDoc types can only be used inside documentation comments."
            && it.code == 8020
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

/// The statement in whose head the list of declarations `statement` is: a `for`, a `for-in` or a `for-of`.
fn loop_with_head<'a>(file: &'a File<'a>, statement: StmtId) -> Option<StmtKind> {
    let Some(&Parent::Stmt(parent)) = file.bound.stmt_parent.get(statement.idx()) else {
        return None;
    };
    let kind = file.hir.stmts.get(parent.idx())?.kind;
    let head = match kind {
        StmtKind::For { init, .. } => init,
        StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => left,
        _ => return None,
    };
    (head == statement).then_some(kind)
}

/// `const` and nothing behind it. `for (const a, b of c)`.
fn declaration_list<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    let empty = file.stmts_of_kind(StmtTag::Var).filter_map(|it| {
        let raw = it.try_raw()?;
        let is_empty = matches!(raw.kind, StmtKind::Var(list) if list.is_empty())
            && loop_with_head(file, it.id()).is_none();
        is_empty.then(|| SyntaxError {
            at: raw.start,
            message: b"A variable declaration list must have at least one variable declarator."
                .to_vec(),
        })
    });
    let loops = [(StmtTag::ForIn, "in"), (StmtTag::ForOf, "of")];
    let in_heads = loops.into_iter().flat_map(|(tag, word)| {
        file.stmts_of_kind(tag).filter_map(move |it| {
            let (StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }) = it.try_raw()?.kind
            else {
                return None;
            };
            let left = file.hir.stmts.get(left.idx())?;
            matches!(left.kind, StmtKind::Var(list) if list.len() != 1).then(|| SyntaxError {
                at: left.start,
                message: format!(
                    "Only a single variable declaration is allowed in a 'for...{word}' statement."
                )
                .into_bytes(),
            })
        })
    });
    empty.chain(in_heads).min_by_key(|it| it.at)
}

/// `class {}` as a statement, if it is not `export default class {}`.
fn class_without_name<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    let (hir, bound) = (&file.hir, &file.bound);
    let without_name = hir.classes.iter().enumerate().filter(|&(i, it)| {
        let modifiers = hir.modifiers.get(it.modifiers.range()).unwrap_or_default();
        it.name.is_none()
            && bound
                .class_scope
                .get(i)
                .is_some_and(|scope| scope.is_some())
            && matches!(bound.class_owner.get(i), Some(ClassOwner::Stmt(_)))
            && !(modifiers.iter().any(|it| is_keyword(it, Flags::EXPORT))
                && modifiers.iter().any(|it| is_keyword(it, Flags::DEFAULT)))
    });
    let at = without_name
        .map(|(i, _)| Class::from_raw(file, i as u32).span().start)
        .min()?;
    Some(SyntaxError {
        at,
        message: b"A class declaration without the 'default' modifier must have a name.".to_vec(),
    })
}

/// A word that is reserved in strict code, where a name is read, declared or a label. For OXC a file is strict if it is a
/// module, and nothing is reserved in what is only declared. Code that is strict for another reason is not looked at.
fn reserved_word<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    let hir = &file.hir;
    // The parser notes each name that is such a word, `eval` or `arguments`. Few files have one.
    if hir.keyword_identifier_positions.is_empty()
        || file.is_declaration_file()
        || !espree::has_module_syntax(file)
    {
        return None;
    }
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
    let is_only_declared = |at: u32| {
        hir.stmts.iter().any(|it| {
            let modifiers = hir.modifiers.get(it.modifiers.range()).unwrap_or_default();
            it.start <= at
                && at < it.loc.end
                && modifiers.iter().any(|it| is_keyword(it, Flags::AMBIENT))
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
    let is_in_loop_head = |statement: StmtId| {
        matches!(
            loop_with_head(file, statement),
            Some(StmtKind::ForIn { .. } | StmtKind::ForOf { .. })
        )
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

/// A name that two parameters of a function or of a signature bind. Only a function that is a declaration or an expression can
/// have that, where the code is not strict, if each of its parameters is a name and nothing else. The error is at the first.
fn duplicate_parameter<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    let hir = &file.hir;
    // Nearly no file has such a list, or one with a pattern in it.
    if !file.may_bind_a_parameter_twice() {
        return None;
    }
    let mut first: Option<u32> = None;
    let mut names: SmallVec<[(Atom, u32); 8]> = SmallVec::new();
    for (i, raw) in hir.fns.iter().enumerate() {
        // One parameter binds a name twice only in a pattern, which is not looked for.
        if raw.params.len < 2 {
            continue;
        }
        let params = hir.params.get(raw.params.range()).unwrap_or_default();
        names.clear();
        let mut are_simple = true;
        for (param, id) in params.iter().zip(raw.params.iter()) {
            are_simple &= param.default.is_none() && !param.flags.contains(Flags::REST);
            match hir.pats.get(param.pat.idx()).map(|it| (it.kind, it.pos)) {
                Some((PatKind::Ident(name), pos)) => names.push((name, pos)),
                _ => {
                    are_simple = false;
                    let id: ParamId = id;
                    Param::new(file, id).pat().for_each_binding(&mut |it| {
                        if let Some(PatKind::Ident(name)) = it.try_raw().map(|it| it.kind) {
                            names.push((name, it.span().start));
                        }
                    });
                }
            }
        }
        // The first of the names that are there again: those of one name are side by side, in the order of the text.
        names.sort_unstable_by_key(|it| (it.0.0, it.1));
        let is_first = |i: usize| i == 0 || names[i - 1].0 != names[i].0;
        let twice = (0..names.len().saturating_sub(1))
            .filter(|&i| names[i].0 == names[i + 1].0 && is_first(i))
            .map(|i| names[i].1);
        let Some(at) = twice.min() else {
            continue;
        };
        let func = Func::from_raw(file, i as u32);
        let allows = are_simple
            && matches!(raw.kind, FnKind::Decl | FnKind::Expr)
            && !crate::utils::oxlint::is_strict_mode(Node::Func(func).scope(), file);
        if !allows && func.is_in_tree() && first.is_none_or(|it| at < it) {
            first = Some(at);
        }
    }
    let at = first?;
    let name = file.text().get(at as usize..)?;
    let name = name.get(..token_len(name))?;
    Some(SyntaxError {
        at,
        message: [b"Identifier `", name, b"` has already been declared"].concat(),
    })
}

/// The error for which oxlint refuses a file in which TypeScript's parser has found none.
pub(super) fn first_error<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    // acorn's checks have these for JavaScript.
    let of_typescript = match file.is_javascript() {
        true => [None, None, None, None],
        false => [
            declaration_without_initializer(file),
            declaration_list(file),
            class_without_name(file),
            error_of_grammar(file),
        ],
    };
    let early = [
        espree::first_error_of_oxc(file),
        reserved_word(file),
        duplicate_parameter(file),
    ];
    (of_typescript.into_iter().chain(early))
        .flatten()
        .min_by_key(|it| it.at)
}

/// The same for oxfmt, which runs OXC's parser and not the pass that builds the scopes: that pass has most of the errors.
/// The file is one that Prettier does not refuse, so typescript-estree has nothing to say about it.
pub(super) fn first_error_of_parser<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    match file.is_javascript() {
        true => espree::first_error_of_oxc_parser(file),
        false => declaration_without_initializer(file),
    }
}
