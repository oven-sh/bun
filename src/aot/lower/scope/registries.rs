use bun_sema::bind::{BindingKind, Bound, Decl, Parent, PatParent, SymbolId};
use bun_sema::check::aot::{BuiltinClassIndex, Queries};
use bun_sema::hir::{ExprKind, File, PatId, PatKind, StmtKind};

use crate::builtins::BuiltinClass;

fn starts_as_primitive_or_function(hir: &File<'_>, bound: &Bound<'_>, name: PatId) -> bool {
    let PatParent::Var(declaration) = bound.pat_parent[name.idx()] else {
        return false;
    };
    let written = &hir[declaration];
    if written.init.is_none()
        || written.ty.is_some()
        || !matches!(
            hir[written.init].kind,
            ExprKind::Number(_)
                | ExprKind::String(_)
                | ExprKind::BigInt(_)
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Fn(_)
        )
        || !matches!(hir[name].kind, PatKind::Ident(_))
    {
        return false;
    }
    let statement = bound.var_stmt[declaration.idx()];
    let Parent::Stmt(parent) = bound.parent_of_stmt(statement) else {
        return true;
    };
    !matches!(
        hir[parent].kind,
        StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == statement
    )
}

pub(in crate::lower) fn holds_registry(
    queries: &mut Queries<'_, '_, '_>,
    symbol: SymbolId,
) -> bool {
    match queries.bound().binding_kind(symbol) {
        BindingKind::Var
        | BindingKind::Let
        | BindingKind::Const
        | BindingKind::SimpleCatchParameter
        | BindingKind::Parameter => {}
        BindingKind::NoBinding
        | BindingKind::Import
        | BindingKind::TypeScriptContainer
        | BindingKind::Class
        | BindingKind::ClassInnerName
        | BindingKind::Function
        | BindingKind::FunctionName => return false,
    }
    let file = queries.file();
    let variable = queries.canonical_symbol(file, symbol);
    let declarations = queries.files().decls_of(variable);
    let mut values = declarations.iter();
    values.any(|&(declaring_file, declaration)| match declaration {
        Decl::Var(pattern) | Decl::Param(pattern) | Decl::Require(pattern)
            if declaring_file == file =>
        {
            if !queries.answers_only_what_is_known()
                && starts_as_primitive_or_function(queries.hir(), queries.bound(), pattern)
            {
                return false;
            }
            let registry = BuiltinClassIndex(BuiltinClass::FinalizationRegistry.to_wire());
            let answer = queries.is_binding_of_builtin(pattern, registry);
            answer.unwrap_or(true)
        }
        _ => false,
    })
}
