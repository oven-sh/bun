use crate::atom::Atom;
use crate::bind::{
    Binding, BindingStability, Bound, Decl, FnOwner, FunctionFlags, Parent, PatParent, SymbolId,
};
use crate::fold::Decisions;
use crate::hir::{
    ExprId, ExprKind, File, Flags, FnId, FnKind, IdList, NodeData, PatId, PatKind, PropKey,
    StmtKind,
};
use crate::util::FxHashMap;
use smallvec::SmallVec;

pub fn is_exported(hir: &File<'_>, bound: &Bound<'_>, symbol: SymbolId) -> bool {
    let mut declarations = bound.symbol(symbol).decls.iter();
    declarations.any(|&it| bound.modifier_flags(hir, it).contains(Flags::EXPORT))
        || bound.is_named_by_export(symbol)
}

type FindWritten<'a> = &'a dyn Fn(Atom) -> Vec<ExprId>;

type Places = SmallVec<[u32; 1]>;

#[derive(Default)]
pub struct ExportedNames {
    of_functions: FxHashMap<FnId, Places>,
    of_patterns: FxHashMap<PatId, Places>,
    of_local_names: FxHashMap<SymbolId, Places>,
}

impl ExportedNames {
    pub fn new(hir: &File<'_>, bound: &Bound<'_>) -> ExportedNames {
        let mut names = ExportedNames::default();
        let exports = bound.table(bound.symbol(bound.file_symbol).exports);
        for (place, &(_, symbol)) in (0..).zip(exports) {
            for &declaration in bound.symbol(symbol).decls {
                names.note(hir, bound, declaration, place);
            }
        }
        names
    }

    fn note(&mut self, hir: &File<'_>, bound: &Bound<'_>, declaration: Decl, place: u32) {
        let value = match declaration {
            Decl::Fn(declared) => {
                return self.of_functions.entry(declared).or_default().push(place);
            }
            Decl::Var(pattern) => return self.of_patterns.entry(pattern).or_default().push(place),
            Decl::ExportSpec(specifier) => {
                if !hir[hir[specifier].export].has_module_specifier
                    && let Binding::Symbol(local) = bound.exported_binding(specifier)
                {
                    self.of_local_names.entry(local).or_default().push(place);
                }
                return;
            }
            Decl::ExportExpr(statement) => match hir[statement].kind {
                StmtKind::ExportDefault(value) => value,
                _ => return,
            },
            Decl::ExportsProperty(assignment) => match hir[assignment].kind {
                ExprKind::Assign {
                    op: None, value, ..
                } => value,
                _ => return,
            },
            _ => return,
        };
        let value = hir.skip_type_assertions(value);
        match (hir[value].kind, bound.binding(value)) {
            (ExprKind::Fn(written), _) => self.of_functions.entry(written).or_default().push(place),
            (ExprKind::Ident(_), Binding::Symbol(local)) => {
                self.of_local_names.entry(local).or_default().push(place);
            }
            _ => {}
        }
    }
}

pub fn find_names_exported_for(
    hir: &File<'_>,
    bound: &Bound<'_>,
    exported: &ExportedNames,
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
    let found = [
        exported.of_functions.get(&function),
        initialized.and_then(|it| exported.of_patterns.get(&it)),
        local.and_then(|it| exported.of_local_names.get(&it)),
    ];
    let mut places: SmallVec<[u32; 2]> = found.into_iter().flatten().flatten().copied().collect();
    places.sort_unstable();
    places.dedup();
    let exports = bound.table(bound.symbol(bound.file_symbol).exports);
    let names = places.into_iter().map(|place| exports[place as usize].0);
    names.collect()
}

pub fn find_parameter_named(
    hir: &File<'_>,
    bound: &Bound<'_>,
    mention: ExprId,
) -> Option<(FnId, usize)> {
    let (function, place, path) = find_parameter_key_path(hir, bound, mention)?;
    path.is_empty().then_some((function, place))
}

/// Resolves `mention` to a parameter, or to a variable that object patterns in the parameter list bind. Returns the function, the parameter's index and the key path.
pub(super) fn find_parameter_key_path(
    hir: &File<'_>,
    bound: &Bound<'_>,
    mention: ExprId,
) -> Option<(FnId, usize, SmallVec<[Atom; 2]>)> {
    let Binding::Symbol(parameter) = bound.binding(mention) else {
        return None;
    };
    let found = find_parameter_place(hir, bound, mention)?;
    let is_settled = matches!(
        bound.binding_stability(parameter),
        BindingStability::Stable | BindingStability::NotInitializedOnce
    ) && bound.stores_to(parameter).is_empty();
    is_settled.then_some(found)
}

/// As `find_parameter_key_path()`, also for a parameter that is assigned.
pub(super) fn find_parameter_place(
    hir: &File<'_>,
    bound: &Bound<'_>,
    mention: ExprId,
) -> Option<(FnId, usize, SmallVec<[Atom; 2]>)> {
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
    let place = hir[function].params.iter().position(|it| it == id)?;
    let is_plain = !bound.is_visible_to_eval(parameter)
        && bound
            .dynamic_lookup_scope(NodeData::Expr(mention))
            .is_none()
        && !hir[id].flags.contains(Flags::REST);
    is_plain.then_some((function, place, path))
}

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

pub(super) fn find_name_of(
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

pub(super) fn find_only_name_of(
    hir: &File<'_>,
    bound: &Bound<'_>,
    function: FnId,
    find_written: FindWritten<'_>,
    may_be_exported: bool,
) -> Option<SymbolId> {
    let name = find_name_of(hir, bound, function, find_written)?;
    let mut hoisted = bound.runtime.annex_b_functions().iter();
    let other_ways = FunctionFlags::USES_ARGUMENTS | FunctionFlags::HAS_DIRECT_EVAL;
    let is_only_name = name.is_some()
        && !bound.function_flags(function).intersects(other_ways)
        && bound.is_stable_binding(name)
        && !bound.is_visible_to_eval(name)
        && !hoisted.any(|it| it.function == function)
        && (may_be_exported || !is_exported(hir, bound, name));
    is_only_name.then_some(name)
}

pub(super) fn find_arguments_where_written(
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

pub fn find_values_passed_for(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    mention: ExprId,
    find_written: FindWritten<'_>,
) -> Option<SmallVec<[ExprId; 4]>> {
    let place = find_parameter_key_path(hir, bound, mention)?;
    let (values, path, _) =
        find_values_passed_for_pattern(hir, bound, decisions, place, find_written, false)?;
    path.is_empty().then_some(values)
}

type ValuesPassed = (SmallVec<[ExprId; 4]>, SmallVec<[Atom; 2]>, bool);

type ParameterPlace = (FnId, usize, SmallVec<[Atom; 2]>);

/// What the call with `arguments` passes for a parameter, with the parameter's default.
pub(super) fn find_values_passed_by_call(
    hir: &File<'_>,
    (function, index, path): ParameterPlace,
    arguments: IdList<ExprId>,
) -> Option<ValuesPassed> {
    let default = hir[hir[function].params.iter().nth(index)?].default;
    let mut passed = hir.ids(arguments).take(index + 1);
    let is_spread = |it: ExprId| matches!(hir[it].kind, ExprKind::Spread(_));
    if passed.clone().any(is_spread) {
        return None;
    }
    let value = passed.nth(index);
    let is_left_out = value.is_none() && default.is_none();
    let values = default.some().into_iter().chain(value).collect();
    Some((values, path, is_left_out))
}

pub(super) fn find_values_passed_for_pattern(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    (function, index, path): ParameterPlace,
    find_written: FindWritten<'_>,
    may_be_exported: bool,
) -> Option<ValuesPassed> {
    let Some(name) = find_only_name_of(hir, bound, function, find_written, may_be_exported) else {
        let arguments = find_arguments_where_written(hir, bound, function, find_written)?;
        return find_values_passed_by_call(hir, (function, index, path), arguments);
    };
    let place = (function, index);
    let (values, is_left_out) =
        find_values_passed_under_name(hir, bound, decisions, place, name, find_written)?;
    Some((values, path, is_left_out))
}

/// What the calls of `name` pass for one parameter of its function, with the parameter's default, and whether a call leaves it out.
pub(super) fn find_values_passed_under_name(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    (function, index): (FnId, usize),
    name: SymbolId,
    find_written: FindWritten<'_>,
) -> Option<(SmallVec<[ExprId; 4]>, bool)> {
    let id = hir[function].params.iter().nth(index)?;
    let is_spread = |it: ExprId| matches!(hir[it].kind, ExprKind::Spread(_));
    let has_default = hir[id].default.is_some();
    let mut is_left_out = false;
    let mut values: SmallVec<[ExprId; 4]> = SmallVec::new();
    if hir[id].default.is_some() {
        values.push(hir[id].default);
    }
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
        let value = passed.nth(index);
        is_left_out |= value.is_none() && !has_default;
        values.extend(value);
    }
    Some((values, is_left_out))
}
