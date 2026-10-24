use bun_sema::atom::Atom;
use bun_sema::bind::{BindingKind, Bound, Decl, ScopeId, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{self, ExprKind, FnId, FnKind, PatKind, StmtId, StmtKind};
use bun_sema::program::FileId;

use super::lexical_owners::compute_lexical_owners;
use super::walk::{ScopeWalk, walk_file};
use super::{ScopeAnalysis, ScopeInput, analyze_scopes};
use crate::builtins::{ImportTargets, ResolveInput, SourceDialect, resolve_file};
use crate::compile::testing::with_lowering_inputs;
use crate::ir::FunctionKey;
use crate::lower::captures::max_captures;

pub(in crate::lower) fn with_scope_input<R>(
    files: &[(&str, &str)],
    test: impl FnOnce(&ScopeInput<'_, '_>) -> R,
) -> R {
    with_lowering_inputs(files, |loaded, inputs, file| {
        let compiled = loaded.compiled(file);
        let file_inputs = inputs.files[file.idx()];
        test(&ScopeInput {
            file,
            hir: loaded.hir(file),
            bound: loaded.bound(file),
            compiled: compiled.expect("the entry point is compiled"),
            modules: inputs.modules,
            builtins: file_inputs.expect("the entry point is lowered").builtins,
            max_captures: max_captures(),
        })
    })
}

pub(in crate::lower) fn with_runtime_dialect_input<R>(
    files: &[(&str, &str)],
    test: impl FnOnce(&ScopeInput<'_, '_>) -> R,
) -> R {
    with_lowering_inputs(files, |loaded, inputs, file| {
        let (hir, bound) = (loaded.hir(file), loaded.bound(file));
        let compiled = loaded.compiled(file).expect("the entry point is compiled");
        let builtins = resolve_file(&ResolveInput {
            hir,
            bound,
            decisions: &compiled.analysis.decisions,
            module_format: compiled.analysis.module_format,
            targets: &ImportTargets::new(&[]),
            names: inputs.builtin_names,
            platform: inputs.options.platform,
            dialect: SourceDialect::Runtime,
        });
        test(&ScopeInput {
            file,
            hir,
            bound,
            compiled,
            modules: inputs.modules,
            builtins: &builtins,
            max_captures: max_captures(),
        })
    })
}

pub(in crate::lower) fn with_scope_analysis<R>(
    files: &[(&str, &str)],
    test: impl FnOnce(&hir::File<'_>, &Bound<'_>, &ScopeAnalysis) -> R,
) -> R {
    with_scope_input(files, |input| {
        test(input.hir, input.bound, &analyze_scopes(input))
    })
}

pub(super) fn walk_scopes(input: &ScopeInput<'_, '_>) -> ScopeWalk {
    let lexical_owners = compute_lexical_owners(input.hir, input.bound);
    walk_file(input, &lexical_owners)
}

pub(in crate::lower) fn symbol_named(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    text: &str,
) -> SymbolId {
    let name = find_atom(hir, text);
    let symbols = (0..bound.symbols.len() as u32).map(SymbolId);
    let named = symbols.filter(|&symbol| {
        bound.symbol(symbol).name == name && is_value_binding(bound.binding_kind(symbol))
    });
    let named: Vec<SymbolId> = named.collect();
    assert_eq!(named.len(), 1, "{text} names one binding");
    named[0]
}

pub(in crate::lower) fn function_named(hir: &hir::File<'_>, text: &str) -> FnId {
    let name = find_atom(hir, text);
    let functions = (0..hir.fns.len() as u32).map(FnId);
    let named: Vec<FnId> = functions
        .filter(|&function| hir[function].name == name)
        .collect();
    assert_eq!(named.len(), 1, "{text} names one function");
    named[0]
}

pub(in crate::lower) fn functions_of_kind(hir: &hir::File<'_>, kind: FnKind) -> Vec<FnId> {
    let functions = (0..hir.fns.len() as u32).map(FnId);
    let mut functions: Vec<FnId> = functions
        .filter(|&function| hir[function].kind == kind)
        .collect();
    functions.sort_by_key(|&function| hir[function].start);
    functions
}

pub(in crate::lower) fn only_function(hir: &hir::File<'_>, kind: FnKind) -> FnId {
    let functions = functions_of_kind(hir, kind);
    assert_eq!(functions.len(), 1);
    functions[0]
}

pub(in crate::lower) fn first_statement(
    hir: &hir::File<'_>,
    is_wanted: impl Fn(&StmtKind) -> bool,
) -> StmtId {
    let mut statements = hir.stmts.iter();
    let found = statements.position(|statement| is_wanted(&statement.kind));
    StmtId(found.expect("the source has the statement") as u32)
}

pub(in crate::lower) fn file_scope(hir: &hir::File<'_>, bound: &Bound<'_>) -> ScopeId {
    bound.scope_of_declaration(hir, Decl::File)
}

pub(in crate::lower) fn top_scope(bound: &Bound<'_>, function: FnId) -> ScopeId {
    bound.fns[function.idx()].scope
}

pub(in crate::lower) fn source_key(file: FileId, function: FnId) -> FunctionKey {
    FunctionKey::Source(FunctionRef { file, function })
}

fn is_value_binding(kind: BindingKind) -> bool {
    match kind {
        BindingKind::NoBinding | BindingKind::ClassInnerName => false,
        _ => true,
    }
}

fn find_atom(hir: &hir::File<'_>, text: &str) -> Atom {
    let is_name_part = |byte: &u8| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'$';
    let ends_at = |end: u32| {
        let before = hir.text[..end as usize].strip_suffix(text.as_bytes());
        before.is_some_and(|before| !before.last().is_some_and(is_name_part))
    };
    let starts_at = |start: u32| {
        let rest = hir.text.get(start as usize..);
        let after = rest.and_then(|rest| rest.strip_prefix(text.as_bytes()));
        after.is_some_and(|after| !after.first().is_some_and(is_name_part))
    };
    let patterns = hir.pats.iter().filter_map(|pattern| match pattern.kind {
        PatKind::Ident(atom) if ends_at(pattern.end) => Some(atom),
        PatKind::Ident(_) | PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => None,
    });
    let identifiers = hir.exprs.iter().filter_map(|expression| {
        let ExprKind::Ident(atom) = expression.kind else {
            return None;
        };
        ends_at(expression.end).then_some(atom)
    });
    let functions = hir
        .fns
        .iter()
        .map(|function| (function.name, function.name_pos));
    let classes = hir.classes.iter().map(|class| (class.name, class.name_pos));
    let declarations = functions.chain(classes).filter_map(|(atom, start)| {
        let is_named = atom.is_some() && starts_at(start);
        is_named.then_some(atom)
    });
    let atom = patterns.chain(identifiers).chain(declarations).next();
    atom.expect("the source declares or mentions the name")
}
