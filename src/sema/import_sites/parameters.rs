use crate::atom::Atom;
use crate::bind::{
    Binding, BindingStability, Bound, Decl, FnOwner, FunctionFlags, Parent, PatParent, SymbolId,
};
use crate::fold::Decisions;
use crate::hir::{
    ExportSpecId, ExprId, ExprKind, File, Flags, FnId, FnKind, ImportEqualsId, NodeData, PatKind,
};
use smallvec::SmallVec;

pub fn is_exported(hir: &File<'_>, bound: &Bound<'_>, symbol: SymbolId) -> bool {
    let binding = Binding::Symbol(symbol);
    let mut declarations = bound.symbol(symbol).decls.iter();
    let mut specifiers = (0..hir.export_specs.len() as u32).map(ExportSpecId);
    let mut entity_names = (0..hir.import_equals.len() as u32).map(ImportEqualsId);
    declarations.any(|&it| bound.modifier_flags(hir, it).contains(Flags::EXPORT))
        || specifiers.any(|it| bound.exported_binding(it) == binding)
        || entity_names.any(|it| bound.entity_root_binding(it) == binding)
}

fn find_only_name_of(hir: &File<'_>, bound: &Bound<'_>, function: FnId) -> Option<SymbolId> {
    let name = match (hir[function].kind, bound.fns[function.idx()].owner) {
        (FnKind::Decl, _) => bound.declared_symbol(Decl::Fn(function)),
        (FnKind::Expr | FnKind::Arrow, FnOwner::Expr(expression))
            if !bound.finds_itself(hir, function) =>
        {
            let Parent::VarInit(declaration) = bound.parent_of_expr(expression) else {
                return None;
            };
            let pattern = hir[declaration].pat;
            match (hir[pattern].kind, bound.initialized_binding(pattern)) {
                (PatKind::Ident(_), Binding::Symbol(name))
                    if bound.dynamic_lookup_scope(NodeData::Pat(pattern)).is_none() =>
                {
                    name
                }
                _ => return None,
            }
        }
        _ => return None,
    };
    let mut hoisted = bound.runtime.annex_b_functions().iter();
    // `arguments.callee` and evaluated text hand the function on without its name.
    let other_ways = FunctionFlags::USES_ARGUMENTS | FunctionFlags::HAS_DIRECT_EVAL;
    let is_only_name = name.is_some()
        && !bound.function_flags(function).intersects(other_ways)
        && bound.is_stable_binding(name)
        && !bound.is_visible_to_eval(name)
        && !hoisted.any(|it| it.function == function)
        && !is_exported(hir, bound, name);
    is_only_name.then_some(name)
}

// `function load(name) { return require(name); }`, where every mention of `load` calls it: what the calls pass for `name`.
pub fn find_values_of_parameter(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    mention: ExprId,
) -> Option<SmallVec<[ExprId; 4]>> {
    find_values_passed_for(hir, bound, decisions, mention, &|name| {
        let all = (0..hir.exprs.len() as u32).map(ExprId);
        all.filter(|&e| matches!(hir[e].kind, ExprKind::Ident(it) if it == name))
            .collect()
    })
}

/// `find_written` answers with the places where a name is written.
pub(super) fn find_values_passed_for(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    mention: ExprId,
    find_written: &dyn Fn(Atom) -> Vec<ExprId>,
) -> Option<SmallVec<[ExprId; 4]>> {
    let Binding::Symbol(parameter) = bound.binding(mention) else {
        return None;
    };
    let &[Decl::Param(pattern)] = bound.symbol(parameter).decls else {
        return None;
    };
    let PatParent::Param(id) = bound.pat_parent[pattern.idx()] else {
        return None;
    };
    let function = bound.param_fn[id.idx()];
    let index = hir[function].params.iter().position(|it| it == id)?;
    let is_settled = matches!(
        bound.binding_stability(parameter),
        BindingStability::Stable | BindingStability::NotInitializedOnce
    ) && bound.stores_to(parameter).is_empty()
        && !bound.is_visible_to_eval(parameter)
        && bound
            .dynamic_lookup_scope(NodeData::Expr(mention))
            .is_none()
        && !hir[id].flags.contains(Flags::REST);
    let name = find_only_name_of(hir, bound, function).filter(|_| is_settled)?;
    let text = bound.symbol(name).name;
    let mut values: SmallVec<[ExprId; 4]> = SmallVec::new();
    if hir[id].default.is_some() {
        values.push(hir[id].default);
    }
    for callee in find_written(text) {
        let is_mention = bound.is_evaluated_ident(callee)
            && !decisions.is_dead_expr(callee)
            && bound.binding(callee) == Binding::Symbol(name);
        if !is_mention {
            continue;
        }
        let Parent::Expr(above) = bound.parent_of_expr(callee) else {
            return None;
        };
        let ExprKind::Call(call) = hir[above].kind else {
            return None;
        };
        let mut passed = hir.ids(hir[call].args).take(index + 1);
        let is_spread = |it: ExprId| matches!(hir[it].kind, ExprKind::Spread(_));
        if hir[call].callee != callee || passed.clone().any(is_spread) {
            return None;
        }
        values.extend(passed.nth(index));
    }
    Some(values)
}
