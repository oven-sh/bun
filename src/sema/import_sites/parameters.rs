use crate::atom::Atom;
use crate::bind::{
    Binding, BindingStability, Bound, Decl, FnOwner, FunctionFlags, Parent, PatParent, SymbolId,
};
use crate::fold::Decisions;
use crate::hir::{
    ExportSpecId, ExprId, ExprKind, File, Flags, FnId, FnKind, IdList, ImportEqualsId, NodeData,
    PatKind, PropKey, StmtKind,
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

type FindWritten<'a> = &'a dyn Fn(Atom) -> Vec<ExprId>;

pub(super) fn find_names_exported_for(
    hir: &File<'_>,
    bound: &Bound<'_>,
    function: FnId,
    find_written: FindWritten<'_>,
) -> SmallVec<[Atom; 2]> {
    let local = find_name_of(hir, bound, function, find_written).filter(|&name| {
        name.is_some() && bound.is_stable_binding(name) && !bound.is_visible_to_eval(name)
    });
    let initialized = match bound.fns[function.idx()].owner {
        FnOwner::Expr(expression) => match bound.parent_of_expr(expression) {
            Parent::VarInit(declaration) => Some(hir[declaration].pat),
            _ => None,
        },
        _ => None,
    };
    let is_function = |value: ExprId| {
        let value = hir.skip_type_assertions(value);
        match hir[value].kind {
            ExprKind::Fn(written) => written == function,
            ExprKind::Ident(_) => {
                local.is_some_and(|it| bound.binding(value) == Binding::Symbol(it))
            }
            _ => false,
        }
    };
    let exports_function = |declaration: Decl| match declaration {
        Decl::Fn(declared) => declared == function,
        Decl::Var(pattern) => Some(pattern) == initialized,
        Decl::ExportSpec(specifier) => {
            let statement = hir[hir[specifier].export];
            !statement.has_module_specifier
                && local.is_some_and(|it| bound.exported_binding(specifier) == Binding::Symbol(it))
        }
        Decl::ExportExpr(statement) => {
            matches!(hir[statement].kind, StmtKind::ExportDefault(value) if is_function(value))
        }
        Decl::ExportsProperty(assignment) => {
            matches!(hir[assignment].kind, ExprKind::Assign { op: None, value, .. } if is_function(value))
        }
        _ => false,
    };
    let exports = bound.table(bound.symbol(bound.file_symbol).exports);
    let exported = exports.iter().filter(|&&(_, symbol)| {
        let mut declarations = bound.symbol(symbol).decls.iter();
        declarations.any(|&declaration| exports_function(declaration))
    });
    exported.map(|&(export, _)| export).collect()
}

pub(super) fn find_parameter_named(
    hir: &File<'_>,
    bound: &Bound<'_>,
    mention: ExprId,
) -> Option<(FnId, usize)> {
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
    let place = hir[function].params.iter().position(|it| it == id)?;
    let is_settled = matches!(
        bound.binding_stability(parameter),
        BindingStability::Stable | BindingStability::NotInitializedOnce
    ) && bound.stores_to(parameter).is_empty()
        && !bound.is_visible_to_eval(parameter)
        && bound
            .dynamic_lookup_scope(NodeData::Expr(mention))
            .is_none()
        && !hir[id].flags.contains(Flags::REST);
    is_settled.then_some((function, place))
}

/// `BoundIn::finds_itself`, which walks the file.
fn finds_itself(
    hir: &File<'_>,
    bound: &Bound<'_>,
    function: FnId,
    find_written: FindWritten<'_>,
) -> bool {
    if hir[function].kind == FnKind::Arrow {
        return false;
    }
    let ways = FunctionFlags::USES_ARGUMENTS | FunctionFlags::HAS_DIRECT_EVAL;
    if bound.function_flags(function).intersects(ways) {
        return true;
    }
    if hir[function].name == Atom::NONE {
        return false;
    }
    let own_name = Binding::Symbol(bound.declared_symbol(Decl::Fn(function)));
    let mut written = find_written(hir[function].name).into_iter();
    written.any(|ident| bound.is_evaluated_ident(ident) && bound.binding(ident) == own_name)
}

fn find_name_of(
    hir: &File<'_>,
    bound: &Bound<'_>,
    function: FnId,
    find_written: FindWritten<'_>,
) -> Option<SymbolId> {
    match (hir[function].kind, bound.fns[function.idx()].owner) {
        (FnKind::Decl, _) => Some(bound.declared_symbol(Decl::Fn(function))),
        (FnKind::Expr | FnKind::Arrow, FnOwner::Expr(expression))
            if !finds_itself(hir, bound, function, find_written) =>
        {
            let Parent::VarInit(declaration) = bound.parent_of_expr(expression) else {
                return None;
            };
            let pattern = hir[declaration].pat;
            match (hir[pattern].kind, bound.initialized_binding(pattern)) {
                (PatKind::Ident(_), Binding::Symbol(name))
                    if bound.dynamic_lookup_scope(NodeData::Pat(pattern)).is_none() =>
                {
                    Some(name)
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn find_only_name_of(
    hir: &File<'_>,
    bound: &Bound<'_>,
    function: FnId,
    find_written: FindWritten<'_>,
) -> Option<SymbolId> {
    let name = find_name_of(hir, bound, function, find_written)?;
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

fn find_arguments_where_written(
    hir: &File<'_>,
    bound: &Bound<'_>,
    function: FnId,
    find_written: FindWritten<'_>,
) -> Option<IdList<ExprId>> {
    let (FnKind::Expr | FnKind::Arrow, FnOwner::Expr(expression)) =
        (hir[function].kind, bound.fns[function.idx()].owner)
    else {
        return None;
    };
    let Parent::Expr(above) = bound.parent_of_expr(expression) else {
        return None;
    };
    let ExprKind::Call(call) = hir[above].kind else {
        return None;
    };
    let is_only_call =
        hir[call].callee == expression && !finds_itself(hir, bound, function, find_written);
    is_only_call.then(|| hir[call].args)
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
pub fn find_values_passed_for(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    mention: ExprId,
    find_written: FindWritten<'_>,
) -> Option<SmallVec<[ExprId; 4]>> {
    let (values, path) =
        find_values_passed_for_pattern(hir, bound, decisions, mention, find_written)?;
    path.is_empty().then_some(values)
}

pub(super) fn find_values_passed_for_pattern(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    mention: ExprId,
    find_written: FindWritten<'_>,
) -> Option<(SmallVec<[ExprId; 4]>, SmallVec<[Atom; 2]>)> {
    let Binding::Symbol(parameter) = bound.binding(mention) else {
        return None;
    };
    let &[Decl::Param(mut pattern)] = bound.symbol(parameter).decls else {
        return None;
    };
    let mut path: SmallVec<[Atom; 2]> = SmallVec::new();
    let id = loop {
        match bound.pat_parent[pattern.idx()] {
            PatParent::Param(id) => break id,
            PatParent::Prop(parent, property) => {
                let PropKey::Name(key) = hir.runtime_binding_key(property) else {
                    return None;
                };
                if hir[property].is_rest || hir[property].default.is_some() {
                    return None;
                }
                path.push(key);
                pattern = parent;
            }
            PatParent::Elem(..) | PatParent::Var(_) | PatParent::None => return None,
        }
    };
    path.reverse();
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
    if !is_settled {
        return None;
    }
    let is_spread = |it: ExprId| matches!(hir[it].kind, ExprKind::Spread(_));
    let mut values: SmallVec<[ExprId; 4]> = SmallVec::new();
    if hir[id].default.is_some() {
        values.push(hir[id].default);
    }
    let Some(name) = find_only_name_of(hir, bound, function, find_written) else {
        let arguments = find_arguments_where_written(hir, bound, function, find_written)?;
        let mut passed = hir.ids(arguments).take(index + 1);
        if passed.clone().any(is_spread) {
            return None;
        }
        values.extend(passed.nth(index));
        return Some((values, path));
    };
    let text = bound.symbol(name).name;
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
        if hir[call].callee != callee || passed.clone().any(is_spread) {
            return None;
        }
        values.extend(passed.nth(index));
    }
    Some((values, path))
}
