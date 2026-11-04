use bun_sema::bind::{Bound, CodeUnit, Decl, Parent, PatParent, SymbolId};
use bun_sema::hir::{self, ExprKind, Flags, FnBody, FnId, FnKind, StmtKind, VarKind};

/// `const f = (..) => ..` or `const f = function (..) { .. }` in a function: the function, which is all that the name ever means once it is filled.
/// Whoever asks has seen that nothing else stores to the name and that no text that is evaluated finds it.
pub(in crate::lower) fn find_function_that_initializes(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    symbol: SymbolId,
) -> Option<FnId> {
    let Some(Decl::Var(name)) = bound.initializing_declaration(symbol) else {
        return None;
    };
    let PatParent::Var(declaration) = bound.pat_parent[name.idx()] else {
        return None;
    };
    // `var` is seen outside the block whose names the function captures.
    let (VarKind::Const | VarKind::Let) = bound.variable_kind(hir, declaration) else {
        return None;
    };
    let CodeUnit::Function(_) = bound.code_unit(bound.symbol_scope(symbol)) else {
        return None;
    };
    // Each turn of a loop has its own copies of the names in the head, and the function keeps those of the first.
    if let Parent::Stmt(parent) = bound.parent_of_stmt(bound.var_stmt[declaration.idx()])
        && matches!(
            hir[parent].kind,
            StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. }
        )
    {
        return None;
    }
    let initializer = hir.skip_type_assertions(hir[declaration].init.some()?);
    let ExprKind::Fn(function) = hir[initializer].kind else {
        return None;
    };
    let written = hir[function];
    // A function expression that has a name of its own takes its function object with it.
    let has_no_name_of_its_own = match written.kind {
        FnKind::Arrow => true,
        FnKind::Expr => written.name.is_none(),
        _ => false,
    };
    if !has_no_name_of_its_own || !written.is_strict || matches!(written.body, FnBody::None) {
        return None;
    }
    if written.flags.contains(Flags::ASYNC) || written.flags.contains(Flags::GENERATOR) {
        return None;
    }
    Some(function)
}
