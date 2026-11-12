use super::answers::FunctionRef;
use super::class_shape::is_prototype_object;
use super::class_stores::find_prototype_object_held_by;
use super::class_stores::{ThisOwner, bound_symbol, find_stable_initializer, find_stored_function};
use super::prototype_links::{LinkEnd, NamedValue, PrototypeOperation, list_in};
use super::queries::Queries;
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, BindingKind, Bound, Decl, FnOwner, Parent, PatParent, SymbolId,
};
use crate::hir::{
    self, BinOp, ExportSpecId, ExprId, ExprKind, ExprTag, Flags, FnId, FnKind, MemberKey, PatKind,
    PropKey, PropKind, TypeNodeKind, VarKind,
};
use crate::program::FileId;
use crate::util::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

fn is_member_of_receiver_or_prototype_object(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    place: ExprId,
) -> bool {
    let Some((object, _)) = hir.member_key(place) else {
        return false;
    };
    let object = hir.skip_type_assertions(object);
    matches!(hir[object].kind, ExprKind::This) || is_prototype_object(hir, bound, object)
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Standing {
    AsConstructor,
    AsSomethingElse,
    AsArgument { call: ExprId, argument: ExprId },
}

impl From<bool> for Standing {
    fn from(stands_as_constructor: bool) -> Standing {
        match stands_as_constructor {
            true => Standing::AsConstructor,
            false => Standing::AsSomethingElse,
        }
    }
}

fn is_laid_as_prototype_object(hir: &hir::File<'_>, bound: &Bound<'_>, literal: ExprId) -> bool {
    let Parent::Expr(parent) = bound.parent_of_expr(literal) else {
        return false;
    };
    let Some(parent) = parent.some() else {
        return false;
    };
    matches!(
        hir[parent].kind,
        ExprKind::Assign { op: None, target, value } if value == literal && is_prototype_object(hir, bound, target)
    )
}

fn find_standing(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    mut value: ExprId,
    declares_this: bool,
) -> Standing {
    loop {
        let parent = match bound.parent_of_expr(value) {
            Parent::Expr(parent) => parent,
            Parent::None => return Standing::AsSomethingElse,
            Parent::Prop(property) => {
                return Standing::from(
                    !declares_this
                        && !matches!(
                            hir.runtime_property_key(property),
                            PropKey::Name(name) if name == known::get || name == known::set
                        )
                        && !is_laid_as_prototype_object(
                            hir,
                            bound,
                            bound.prop_owner[property.idx()],
                        ),
                );
            }
            _ => return Standing::AsConstructor,
        };
        let Some(parent) = parent.some() else {
            return Standing::AsSomethingElse;
        };
        if hir.type_assertion_operand(parent) == Some(value) {
            value = parent;
            continue;
        }
        return Standing::from(match hir[parent].kind {
            ExprKind::New(site) => hir[site].callee == value,
            ExprKind::Call(site) if hir[site].callee != value => {
                return Standing::AsArgument {
                    call: parent,
                    argument: value,
                };
            }
            ExprKind::Call(_) | ExprKind::TaggedTemplate(_) => false,
            ExprKind::Binary {
                op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
                ..
            } => false,
            ExprKind::Dot { .. } | ExprKind::Index { .. } => matches!(
                hir.member_key(parent),
                Some((object, MemberKey::Name(name))) if object == value && name == known::prototype
            ),
            ExprKind::Assign {
                op: None,
                target,
                value: stored,
            } if stored == value => {
                let becomes_member = declares_this && hir.member_key(target).is_some();
                !becomes_member && !is_member_of_receiver_or_prototype_object(hir, bound, target)
            }
            _ => true,
        });
    }
}

#[inline]
fn is_seen_to_be_constructor(hir: &hir::File<'_>, bound: &Bound<'_>, mut value: ExprId) -> bool {
    loop {
        let Parent::Expr(parent) = bound.parent_of_expr(value) else {
            return false;
        };
        let Some(parent) = parent.some() else {
            return false;
        };
        if hir.type_assertion_operand(parent) == Some(value) {
            value = parent;
            continue;
        }
        return match hir[parent].kind {
            ExprKind::New(site) => hir[site].callee == value,
            ExprKind::Binary {
                op: BinOp::Instanceof,
                right,
                ..
            } => right == value,
            ExprKind::Dot { .. } | ExprKind::Index { .. } => matches!(
                hir.member_key(parent),
                Some((object, MemberKey::Name(name))) if object == value && name == known::prototype
            ),
            _ => false,
        };
    }
}

fn is_handed_on(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    mut value: ExprId,
    calls_function_with_receiver: impl Fn(ExprId) -> bool,
) -> bool {
    let mut is_one_of_several = false;
    loop {
        let parent = match bound.parent_of_expr(value) {
            Parent::Expr(parent) => parent,
            Parent::VarInit(_) => return is_one_of_several,
            _ => return false,
        };
        let Some(parent) = parent.some() else {
            return false;
        };
        if hir.type_assertion_operand(parent) == Some(value) {
            value = parent;
            continue;
        }
        match hir[parent].kind {
            ExprKind::Call(site) | ExprKind::New(site) => {
                let callee = hir[site].callee;
                let passes_receiver = matches!(
                    hir.member_key(callee),
                    Some((_, MemberKey::Name(name)))
                        if name == known::call || name == known::apply || name == known::bind
                );
                let is_global = |name: ExprId| {
                    matches!(hir[name].kind, ExprKind::Ident(_))
                        && bound.binding(name) == Binding::Free
                };
                let belongs_to_host = match hir.member_key(callee) {
                    Some((object, _)) => is_global(object),
                    None => is_global(callee),
                };
                return callee != value
                    && !passes_receiver
                    && !belongs_to_host
                    && !calls_function_with_receiver(callee);
            }
            ExprKind::Cond { test, .. } if test != value => {
                is_one_of_several = true;
                value = parent;
            }
            _ => return false,
        }
    }
}

fn is_stored_into_member(hir: &hir::File<'_>, bound: &Bound<'_>, value: ExprId) -> bool {
    let Parent::Expr(parent) = bound.parent_of_expr(value) else {
        return false;
    };
    let Some(parent) = parent.some() else {
        return false;
    };
    matches!(
        hir[parent].kind,
        ExprKind::Assign { op: None, target, value: stored } if stored == value && hir.member_key(target).is_some()
    )
}

fn declares_this(hir: &hir::File<'_>, function: FnId) -> bool {
    let written = hir[function].this_ty(hir);
    written.is_some() && !matches!(hir[written].kind, TypeNodeKind::Keyword(_))
}

fn find_constant_holding(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    function: FnId,
) -> Option<(SymbolId, bool)> {
    let FnOwner::Expr(expression) = bound.fns[function.idx()].owner else {
        return None;
    };
    let Parent::VarInit(variable) = bound.parent_of_expr(expression) else {
        return None;
    };
    let variable = &hir[variable];
    if variable.kind != VarKind::Const || !matches!(hir[variable.pat].kind, PatKind::Ident(_)) {
        return None;
    }
    Some((
        bound.declared_symbol(Decl::Var(variable.pat)),
        variable.flags.contains(Flags::EXPORT),
    ))
}

#[derive(Copy, Clone)]
enum InitializerHolder {
    Object,
    Constructor(FnId),
    Above(Atom),
}

/// The names that lead from a variable to a property: `ns.math.Vector`, outermost last.
#[derive(Clone, PartialEq, Eq, Hash)]
struct PropertyPath {
    root: SymbolId,
    names: SmallVec<[Atom; 4]>,
}

/// A variable that is only a name for such a path (`const math = ns.math`) is followed to the variable behind it.
fn find_property_path(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    mut expression: ExprId,
) -> Option<PropertyPath> {
    let mut names = SmallVec::new();
    let mut followed: SmallVec<[SymbolId; 4]> = SmallVec::new();
    loop {
        expression = hir.skip_type_assertions(expression);
        if let Some((object, MemberKey::Name(name))) = hir.member_key(expression) {
            if name == known::prototype || name == known::__proto__ {
                return None;
            }
            names.push(name);
            expression = object;
            continue;
        }
        let root = bound_symbol(hir, bound, expression)?;
        if !followed.contains(&root)
            && let Some(initializer) = find_stable_initializer(hir, bound, expression)
            && hir
                .member_key(hir.skip_type_assertions(initializer))
                .is_some()
        {
            followed.push(root);
            expression = initializer;
            continue;
        }
        if !followed.contains(&root)
            && let Some(argument) = find_argument_in_place(hir, bound, root)
        {
            followed.push(root);
            expression = argument;
            continue;
        }
        return Some(PropertyPath { root, names });
    }
}

/// What a parameter of a function that is called where it is written holds.
fn find_argument_in_place(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    root: SymbolId,
) -> Option<ExprId> {
    if bound.binding_kind(root) != BindingKind::Parameter || !bound.is_stable_binding(root) {
        return None;
    }
    let &[Decl::Param(pattern)] = bound.symbol(root).decls else {
        return None;
    };
    let PatParent::Param(parameter) = bound.pat_parent[pattern.idx()] else {
        return None;
    };
    let function = bound.param_fn[parameter.idx()];
    if function == FnId::NONE
        || !matches!(hir[pattern].kind, PatKind::Ident(_))
        || hir[parameter].default.is_some()
        || hir[parameter].flags.contains(Flags::REST)
        || !bound.is_called_only_where_written(hir, function)
    {
        return None;
    }
    let call = bound.get_immediately_invoked_function_expression(hir, function)?;
    let index = hir[function].params.position_of(parameter.idx())?;
    let mut arguments = hir.ids(hir[call].args);
    let is_spread = |argument: ExprId| matches!(hir[argument].kind, ExprKind::Spread(_));
    if arguments.clone().take(index + 1).any(is_spread) {
        return None;
    }
    let argument = hir.skip_type_assertions(arguments.nth(index)?);
    matches!(hir[argument].kind, ExprKind::Ident(_))
        .then_some(argument)
        .or_else(|| hir.member_key(argument).map(|_| argument))
}

/// A function that a file stores under a path of names.
#[derive(Copy, Clone)]
pub(super) struct FunctionAtPath<'s> {
    root: SymbolId,
    names: &'s [Atom],
    function: FnId,
}

impl FunctionAtPath<'_> {
    /// For lookups alone: the numbers of names differ from run to run.
    fn cmp_path(&self, root: SymbolId, names: &[Atom]) -> core::cmp::Ordering {
        let numbers = self.names.iter().map(|it| it.0);
        let order_of_roots = self.root.0.cmp(&root.0);
        order_of_roots.then_with(|| numbers.cmp(names.iter().map(|it| it.0)))
    }
}

/// The one function that is stored under the path that the expression names.
pub(super) fn find_function_at_path(
    functions: &[FunctionAtPath<'_>],
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    named: ExprId,
) -> Option<FnId> {
    if functions.is_empty() {
        return None;
    }
    let path = find_property_path(hir, bound, hir.skip_type_assertions(named))?;
    let first = functions.partition_point(|it| it.cmp_path(path.root, &path.names).is_lt());
    let mut under_path = functions[first..]
        .iter()
        .take_while(|it| it.cmp_path(path.root, &path.names).is_eq());
    match (under_path.next(), under_path.next()) {
        (Some(only), None) if !path.names.is_empty() => Some(only.function),
        _ => None,
    }
}

/// `F` of `F.prototype = ..` and `F.prototype.name = ..`.
fn find_stored_prototype_owner(hir: &hir::File<'_>, target: ExprId) -> Option<ExprId> {
    let (object, MemberKey::Name(name)) = hir.member_key(target)? else {
        return None;
    };
    let object = hir.skip_type_assertions(object);
    if name == known::prototype {
        return Some(object);
    }
    let (constructor, MemberKey::Name(name)) = hir.member_key(object)? else {
        return None;
    };
    (name == known::prototype).then(|| hir.skip_type_assertions(constructor))
}

fn find_function_in_literal(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    path: &PropertyPath,
) -> Option<FnId> {
    let BindingInitializer::Expression(mut value) = bound.binding_initializer(hir, path.root)
    else {
        return None;
    };
    for &name in path.names.iter().rev() {
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(value)].kind else {
            return None;
        };
        let property = properties.iter().find(|&property| {
            matches!(hir[property].kind, PropKind::Init | PropKind::Shorthand)
                && matches!(hir.runtime_property_key(property), PropKey::Name(it) if it == name)
        })?;
        value = hir[property].value;
    }
    find_stored_function(hir, bound, value)
}

fn find_assigned_function(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    mut value: ExprId,
) -> Option<FnId> {
    loop {
        value = hir.skip_type_assertions(value);
        match hir[value].kind {
            ExprKind::Assign {
                op: None,
                value: inner,
                ..
            } => value = inner,
            _ => return find_stored_function(hir, bound, value),
        }
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn functions_at_paths(&self, file: FileId) -> &'s [FunctionAtPath<'s>] {
        let of_file = self.c.p.aot_functions_at_paths_of(file);
        *of_file.get_or_init(|| self.compute_functions_at_paths(file))
    }

    fn compute_functions_at_paths(&self, file: FileId) -> &'s [FunctionAtPath<'s>] {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let arena = self.c.arena;
        let mut functions: Vec<FunctionAtPath<'s>> = Vec::new();
        for &assign in self.c.shared_exprs_by_kind(file).of(ExprTag::Assign) {
            if let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[assign].kind
                && hir.member_key(target).is_some()
                && let Some(function) = find_assigned_function(hir, bound, value)
                && !self.c.is_dead_expression(file, assign)
                && let Some(path) = find_property_path(hir, bound, target)
            {
                functions.push(FunctionAtPath {
                    root: path.root,
                    names: list_in(arena, &path.names),
                    function,
                });
            }
        }
        functions.sort_unstable_by(|one, other| {
            let order = one.cmp_path(other.root, other.names);
            order.then_with(|| one.function.cmp(&other.function))
        });
        functions.dedup_by(|one, other| {
            one.cmp_path(other.root, other.names).is_eq() && one.function == other.function
        });
        list_in(arena, &functions)
    }

    fn compute_parameters_seen_to_be_constructors(&mut self, file: FileId) -> &'s [(FnId, u32)] {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let ends = self.end_finder(file);
        let expressions = self.c.exprs_by_kind(file);
        let mut seen = Vec::new();
        for &reference in expressions.of(ExprTag::Ident) {
            if is_seen_to_be_constructor(hir, bound, reference)
                && !bound.is_in_type_query(reference)
                && let Some(LinkEnd::Parameter { function, index }) = ends.find_parameter(reference)
            {
                seen.push((function, index));
            }
        }
        seen.sort_unstable();
        seen.dedup();
        list_in(self.c.arena, &seen)
    }

    fn parameters_seen_to_be_constructors(&mut self, file: FileId) -> &'s [(FnId, u32)] {
        let of_file = self.prototype_links(file);
        *of_file
            .parameters_seen_to_be_constructors
            .get_or_init(|| self.compute_parameters_seen_to_be_constructors(file))
    }

    fn compute_parameters_used_like_constructors(&mut self, file: FileId) -> &'s [(FnId, u32)] {
        let mut used = self.parameters_seen_to_be_constructors(file).to_vec();
        let ends = self.end_finder(file);
        let mut handed_on = Vec::new();
        for &(_, passing) in self.prototype_links(file).all_calls_passing_parameters() {
            let arguments = ends.arguments_in_front_of_spread(passing.call);
            for (position, argument) in arguments.enumerate() {
                if let Some(LinkEnd::Parameter { function, index }) =
                    ends.find_referenced_parameter(argument)
                {
                    handed_on.push(((function, index), passing.callee, position as u32));
                }
            }
        }
        handed_on.sort_unstable_by_key(|entry| (entry.0, entry.2));
        handed_on.dedup();
        let mut is_used: FxHashSet<(FnId, u32)> = used.iter().copied().collect();
        let mut handed_to: FxHashMap<(FnId, u32), Vec<(FnId, u32)>> = FxHashMap::default();
        for &(parameter, callee, position) in &handed_on {
            let receiving = (callee.function, position);
            if callee.file == file {
                handed_to.entry(receiving).or_default().push(parameter);
                continue;
            }
            let seen_there = self.parameters_seen_to_be_constructors(callee.file);
            if seen_there.binary_search(&receiving).is_ok() && is_used.insert(parameter) {
                used.push(parameter);
            }
        }
        let mut followed = 0;
        while let Some(&receiving) = used.get(followed) {
            followed += 1;
            for &parameter in handed_to.get(&receiving).map_or(&[][..], Vec::as_slice) {
                if is_used.insert(parameter) {
                    used.push(parameter);
                }
            }
        }
        used.sort_unstable();
        list_in(self.c.arena, &used)
    }

    fn stands_where_a_constructor_stands(
        &mut self,
        file: FileId,
        value: ExprId,
        declares_this: bool,
    ) -> bool {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        match find_standing(hir, bound, value, declares_this) {
            Standing::AsConstructor => true,
            Standing::AsSomethingElse => false,
            Standing::AsArgument { call, argument } => {
                let ends = self.end_finder(file);
                let Some(NamedValue::Function(callee)) = ends.find_callee(call) else {
                    return false;
                };
                let Some(position) = ends.find_position_of_argument(call, argument) else {
                    return false;
                };
                let of_file = self.prototype_links(callee.file);
                let used = *of_file
                    .parameters_used_like_constructors
                    .get_or_init(|| self.compute_parameters_used_like_constructors(callee.file));
                used.binary_search(&(callee.function, position)).is_ok()
            }
        }
    }

    fn compute_declarations_used_like_constructors(&mut self, file: FileId) -> &'s [SymbolId] {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let functions = (0..hir.fns.len() as u32).map(FnId);
        let mut unused = FxHashSet::default();
        let mut was_unused = vec![false; bound.symbols.len()];
        let mut declaring_this = FxHashSet::default();
        let mut used = Vec::new();
        for function in functions {
            let (symbol, is_exported) = match hir[function].kind {
                FnKind::Decl => {
                    let is_exported = hir[function]
                        .flags
                        .intersects(Flags::EXPORT | Flags::DEFAULT);
                    (bound.declared_symbol(Decl::Fn(function)), is_exported)
                }
                FnKind::Expr => match find_constant_holding(hir, bound, function) {
                    Some(constant) => constant,
                    None => continue,
                },
                _ => continue,
            };
            if declares_this(hir, function) {
                declaring_this.insert(symbol);
            }
            match is_exported {
                true => used.push(symbol),
                false => {
                    unused.insert(symbol);
                    if let Some(was_unused) = was_unused.get_mut(symbol.idx()) {
                        *was_unused = true;
                    }
                }
            }
        }
        for spec in (0..hir.export_specs.len() as u32).map(ExportSpecId) {
            if let Binding::Symbol(symbol) = bound.exported_binding(spec)
                && unused.remove(&symbol)
            {
                used.push(symbol);
            }
        }
        if !unused.is_empty() {
            let expressions = self.c.exprs_by_kind(file);
            for &reference in expressions.of(ExprTag::Ident) {
                if let Binding::Symbol(symbol) = bound.binding(reference)
                    && was_unused.get(symbol.idx()).is_none_or(|&it| it)
                    && unused.contains(&symbol)
                    && !bound.is_in_type_query(reference)
                    && self.stands_where_a_constructor_stands(
                        file,
                        reference,
                        declaring_this.contains(&symbol),
                    )
                {
                    unused.remove(&symbol);
                    used.push(symbol);
                }
            }
        }
        used.sort_unstable();
        used.dedup();
        list_in(self.c.arena, &used)
    }

    fn compute_functions_handing_this_on(&mut self, file: FileId) -> &'s [FnId] {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let expressions = self.c.exprs_by_kind(file);
        let named_values = self.inputs.named_values;
        let calls_function_with_receiver = |callee: ExprId| {
            matches!(
                named_values.find_named_value(file, callee),
                Some(NamedValue::PrototypeOperation(
                    PrototypeOperation::CallFunction { .. }
                ))
            )
        };
        let mut functions = Vec::new();
        for &this in expressions.of(ExprTag::This) {
            if !is_handed_on(hir, bound, this, calls_function_with_receiver)
                || self.c.is_dead_expression(file, this)
            {
                continue;
            }
            if let Some(Ok(function)) = self.c.this_container(file, this)
                && matches!(hir[function].kind, FnKind::Decl | FnKind::Expr)
                && !declares_this(hir, function)
            {
                functions.push(function);
            }
        }
        functions.sort_unstable();
        functions.dedup();
        list_in(self.c.arena, &functions)
    }

    pub(super) fn hands_this_on(&mut self, function: FunctionRef) -> bool {
        let of_file = self.prototype_links(function.file);
        let functions = *of_file
            .functions_handing_this_on
            .get_or_init(|| self.compute_functions_handing_this_on(function.file));
        functions.binary_search(&function.function).is_ok()
    }

    fn compute_declarations_named_by_new(&mut self, file: FileId) -> &'s [SymbolId] {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let expressions = self.c.exprs_by_kind(file);
        let mut named = Vec::new();
        for &construction in expressions.of(ExprTag::New) {
            let ExprKind::New(site) = hir[construction].kind else {
                continue;
            };
            let callee = hir.skip_type_assertions(hir[site].callee);
            if matches!(hir[callee].kind, ExprKind::Ident(_))
                && let Binding::Symbol(symbol) = bound.binding(callee)
            {
                named.push(symbol);
            }
        }
        named.sort_unstable();
        named.dedup();
        list_in(self.c.arena, &named)
    }

    /// Functions that `new ns.math.Vector(..)` names: one function of the file is stored under that path, by a literal or an assignment.
    fn compute_constructed_at_paths(&mut self, file: FileId) -> &'s [FnId] {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let expressions = self.c.exprs_by_kind(file);
        let mut held: FxHashMap<PropertyPath, SmallVec<[FnId; 1]>> = FxHashMap::default();
        for &construction in expressions.of(ExprTag::New) {
            let ExprKind::New(site) = hir[construction].kind else {
                continue;
            };
            let callee = hir.skip_type_assertions(hir[site].callee);
            if let Some(path) = find_property_path(hir, bound, callee)
                && !path.names.is_empty()
            {
                let function = find_function_in_literal(hir, bound, &path);
                held.entry(path)
                    .or_insert_with(|| function.into_iter().collect());
            }
        }
        for &assign in expressions.of(ExprTag::Assign) {
            if let ExprKind::Assign {
                op: None, target, ..
            } = hir[assign].kind
                && let Some(constructor) = find_stored_prototype_owner(hir, target)
                && let Some(path) = find_property_path(hir, bound, constructor)
                && !path.names.is_empty()
            {
                let function = find_function_in_literal(hir, bound, &path);
                held.entry(path)
                    .or_insert_with(|| function.into_iter().collect());
            }
        }
        if held.is_empty() {
            return &[];
        }
        for &assign in expressions.of(ExprTag::Assign) {
            let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[assign].kind
            else {
                continue;
            };
            if hir.member_key(target).is_some()
                && let Some(path) = find_property_path(hir, bound, target)
                && let Some(functions) = held.get_mut(&path)
                && let Some(function) = find_assigned_function(hir, bound, value)
                && !self.c.is_dead_expression(file, assign)
                && !functions.contains(&function)
            {
                functions.push(function);
            }
        }
        let mut constructed: Vec<FnId> = held
            .values()
            .filter(|functions| functions.len() == 1)
            .map(|functions| functions[0])
            .collect();
        constructed.sort_unstable();
        constructed.dedup();
        list_in(self.c.arena, &constructed)
    }

    fn is_constructed_at_path(&mut self, function: FunctionRef) -> bool {
        let of_file = self.prototype_links(function.file);
        let constructed = *of_file
            .functions_constructed_at_paths
            .get_or_init(|| self.compute_constructed_at_paths(function.file));
        constructed.binary_search(&function.function).is_ok()
    }

    /// Functions of the file that fill the object of a constructor at a path: `this.init(..)`, `this.init.apply(this, ..)`, `Constructor.init.apply(this, ..)`,
    /// `this.above.init.call(this)`, and what those call in the same ways.
    fn compute_initializers_at_paths(&mut self, file: FileId) -> &'s [(FnId, FnId)] {
        let of_file = self.prototype_links(file);
        let constructed = *of_file
            .functions_constructed_at_paths
            .get_or_init(|| self.compute_constructed_at_paths(file));
        if constructed.is_empty() {
            return &[];
        }
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let expressions = self.c.exprs_by_kind(file);
        let paths = self.functions_at_paths(file);
        let find_constructor = |named: ExprId| {
            let named = hir.skip_type_assertions(named);
            find_stored_function(hir, bound, named)
                .or_else(|| find_function_at_path(paths, hir, bound, named))
                .or_else(|| {
                    let path = find_property_path(hir, bound, named)?;
                    find_function_in_literal(hir, bound, &path)
                })
        };
        let find_prototype_owner = |named: ExprId| {
            let named = hir.skip_type_assertions(named);
            let object = find_prototype_object_held_by(hir, bound, named).unwrap_or(named);
            let (constructor, MemberKey::Name(prototype)) = hir.member_key(object)? else {
                return None;
            };
            (prototype == known::prototype).then(|| find_constructor(constructor))?
        };
        let mut calls: FxHashMap<FnId, SmallVec<[(InitializerHolder, Atom); 2]>> =
            FxHashMap::default();
        for &site in expressions.of(ExprTag::Call) {
            let ExprKind::Call(call) = hir[site].kind else {
                continue;
            };
            let callee = hir.skip_type_assertions(hir[call].callee);
            let Some((object, MemberKey::Name(name))) = hir.member_key(callee) else {
                continue;
            };
            let object = hir.skip_type_assertions(object);
            let (this, method) = if matches!(hir[object].kind, ExprKind::This) {
                (object, Some((InitializerHolder::Object, name)))
            } else if name == known::apply || name == known::call {
                let Some(this) = hir.ids(hir[call].args).next() else {
                    continue;
                };
                let this = hir.skip_type_assertions(this);
                if !matches!(hir[this].kind, ExprKind::This) {
                    continue;
                }
                let Some((holder, MemberKey::Name(method))) = hir.member_key(object) else {
                    continue;
                };
                let holder = hir.skip_type_assertions(holder);
                let holder = match hir[holder].kind {
                    ExprKind::This => Some(InitializerHolder::Object),
                    _ => match hir.member_key(holder) {
                        Some((this, MemberKey::Name(above)))
                            if matches!(
                                hir[hir.skip_type_assertions(this)].kind,
                                ExprKind::This
                            ) =>
                        {
                            Some(InitializerHolder::Above(above))
                        }
                        _ => find_constructor(holder).map(InitializerHolder::Constructor),
                    },
                };
                (this, holder.map(|holder| (holder, method)))
            } else {
                continue;
            };
            if let Some(method) = method
                && let Some(Ok(function)) = self.c.this_container(file, this)
            {
                calls.entry(function).or_default().push(method);
            }
        }
        if !constructed.iter().any(|it| calls.contains_key(it)) {
            return &[];
        }
        let mut methods: FxHashMap<(FnId, bool, Atom), SmallVec<[FnId; 1]>> = FxHashMap::default();
        let mut above: FxHashMap<(FnId, Atom), SmallVec<[FnId; 1]>> = FxHashMap::default();
        for &assign in expressions.of(ExprTag::Assign) {
            let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[assign].kind
            else {
                continue;
            };
            let Some((object, MemberKey::Name(name))) = hir.member_key(target) else {
                continue;
            };
            let on_prototype = find_prototype_owner(object);
            let Some(constructor) = on_prototype.or_else(|| find_constructor(object)) else {
                continue;
            };
            if self.c.is_dead_expression(file, assign) {
                continue;
            }
            // `ns.V.prototype = { init: function () { .. } }`
            let literal = hir.skip_type_assertions(value);
            if on_prototype.is_none()
                && name == known::prototype
                && let ExprKind::Object(properties) = hir[literal].kind
            {
                for property in properties.iter() {
                    if let PropKind::Init | PropKind::Shorthand | PropKind::Method =
                        hir[property].kind
                        && let PropKey::Name(member) = hir.runtime_property_key(property)
                        && let Some(method) = find_stored_function(hir, bound, hir[property].value)
                    {
                        let key = (constructor, false, member);
                        methods.entry(key).or_default().push(method);
                    }
                }
            } else if let Some(method) = find_assigned_function(hir, bound, value) {
                let key = (constructor, on_prototype.is_none(), name);
                methods.entry(key).or_default().push(method);
            } else if on_prototype.is_some()
                && let Some(owner) = find_prototype_owner(value)
            {
                above.entry((constructor, name)).or_default().push(owner);
            }
        }
        let mut initializers = Vec::new();
        for &constructor in constructed {
            let mut found: SmallVec<[FnId; 4]> = SmallVec::new();
            let mut next = 0;
            let mut container = constructor;
            loop {
                for &(holder, name) in calls.get(&container).into_iter().flatten() {
                    let key = match holder {
                        InitializerHolder::Object => Some((constructor, false, name)),
                        InitializerHolder::Constructor(named) => Some((named, true, name)),
                        InitializerHolder::Above(link) => {
                            match above.get(&(constructor, link)).map(SmallVec::as_slice) {
                                Some(&[owner]) => Some((owner, false, name)),
                                _ => None,
                            }
                        }
                    };
                    if let Some(key) = key
                        && let Some(&[method]) = methods.get(&key).map(SmallVec::as_slice)
                        && !found.contains(&method)
                    {
                        found.push(method);
                    }
                }
                let Some(&method) = found.get(next) else {
                    break;
                };
                container = method;
                next += 1;
            }
            initializers.extend(found.into_iter().map(|method| (constructor, method)));
        }
        initializers.sort_unstable();
        initializers.dedup();
        list_in(self.c.arena, &initializers)
    }

    /// It fills the objects of another function.
    fn is_initializer_at_path(&mut self, function: FunctionRef) -> bool {
        let of_file = self.prototype_links(function.file);
        let initializers = *of_file
            .initializers_at_paths
            .get_or_init(|| self.compute_initializers_at_paths(function.file));
        initializers.iter().any(|it| it.1 == function.function)
    }

    pub(super) fn initializers_at_path(&mut self, function: FunctionRef) -> Vec<FnId> {
        let of_file = self.prototype_links(function.file);
        let initializers = *of_file
            .initializers_at_paths
            .get_or_init(|| self.compute_initializers_at_paths(function.file));
        initializers
            .iter()
            .filter(|initializer| initializer.0 == function.function)
            .map(|initializer| initializer.1)
            .collect()
    }

    pub(super) fn is_named_by_new(&mut self, function: FunctionRef) -> bool {
        if self.is_constructed_at_path(function) {
            return true;
        }
        let FunctionRef { file, function } = function;
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let symbol = match bound.fns[function.idx()].owner {
            FnOwner::Expr(_) => {
                find_constant_holding(hir, bound, function).map(|(symbol, _)| symbol)
            }
            FnOwner::Stmt(_) => Some(bound.declared_symbol(Decl::Fn(function))),
            FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => None,
        };
        let Some(symbol) = symbol else {
            return false;
        };
        let of_file = self.prototype_links(file);
        let named = *of_file
            .declarations_named_by_new
            .get_or_init(|| self.compute_declarations_named_by_new(file));
        named.binary_search(&symbol).is_ok()
    }

    pub(super) fn is_held_by_name_or_returned(&mut self, function: FunctionRef) -> bool {
        if self.is_constructed_at_path(function) {
            return true;
        }
        let FunctionRef { file, function } = function;
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        match bound.fns[function.idx()].owner {
            FnOwner::Stmt(_) => true,
            FnOwner::Expr(expression) => {
                find_constant_holding(hir, bound, function).is_some()
                    || matches!(
                        bound.parent_of_expr(expression),
                        Parent::Stmt(_) | Parent::FnBody(_)
                    )
            }
            FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => false,
        }
    }

    fn compute_constructor_symbols(&mut self, file: FileId) -> &'s [SymbolId] {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let expressions = self.c.exprs_by_kind(file);
        let mut symbols = Vec::new();
        for &reference in expressions.of(ExprTag::Ident) {
            if is_seen_to_be_constructor(hir, bound, reference)
                && let Binding::Symbol(symbol) = bound.binding(reference)
                && !bound.is_in_type_query(reference)
            {
                symbols.push(symbol);
            }
        }
        symbols.sort_unstable();
        symbols.dedup();
        list_in(self.c.arena, &symbols)
    }

    fn compute_constructor_member_names(&mut self, file: FileId) -> &'s [crate::atom::Atom] {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let expressions = self.c.exprs_by_kind(file);
        let mut names = Vec::new();
        for tag in [ExprTag::Dot, ExprTag::Index] {
            for &member in expressions.of(tag) {
                if is_seen_to_be_constructor(hir, bound, member)
                    && let Some((_, MemberKey::Name(name))) = hir.member_key(member)
                    && !names.contains(&name)
                {
                    names.push(name);
                }
            }
        }
        list_in(self.c.arena, &names)
    }

    /// `Vector.fill = function () { this.x = 0 }` beside `Vector.prototype`, where the file constructs nothing by the name `fill`.
    fn is_static_method(&mut self, file: FileId, function: ExprId) -> bool {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let Parent::Expr(parent) = bound.parent_of_expr(function) else {
            return false;
        };
        let Some(parent) = parent.some() else {
            return false;
        };
        let ExprKind::Assign {
            op: None,
            target,
            value,
        } = hir[parent].kind
        else {
            return false;
        };
        let Some((object, MemberKey::Name(name))) = hir.member_key(target) else {
            return false;
        };
        let object = hir.skip_type_assertions(object);
        if value != function || !matches!(hir[object].kind, ExprKind::Ident(_)) {
            return false;
        }
        let Binding::Symbol(symbol) = bound.binding(object) else {
            return false;
        };
        let is_named_like_method = self
            .atom_bytes(name)
            .first()
            .is_some_and(u8::is_ascii_lowercase);
        if !is_named_like_method {
            return false;
        }
        let of_file = self.prototype_links(file);
        let constructors = *of_file
            .constructor_symbols
            .get_or_init(|| self.compute_constructor_symbols(file));
        if constructors.binary_search(&symbol).is_err() {
            return false;
        }
        let names = *of_file
            .constructor_member_names
            .get_or_init(|| self.compute_constructor_member_names(file));
        !names.contains(&name)
    }

    fn reads_member_nobody_has_stored(&mut self, function: FunctionRef) -> bool {
        if self.hands_this_on(function) {
            return false;
        }
        let FunctionRef { file, function } = function;
        let index = self.store_index(file);
        let stores = index.this_stores_of(ThisOwner::Function(function));
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let expressions = self.c.exprs_by_kind(file);
        expressions.of(ExprTag::This).iter().any(|&this| {
            if self.c.this_container(file, this) != Some(Ok(function)) {
                return false;
            }
            let Parent::Expr(member) = bound.parent_of_expr(this) else {
                return false;
            };
            let Some(member) = member.some() else {
                return false;
            };
            let Some((object, MemberKey::Name(name))) = hir.member_key(member) else {
                return false;
            };
            if object != this || stores.iter().any(|store| store.name == name) {
                return false;
            }
            !self.c.is_dead_expression(file, this)
        })
    }

    pub(super) fn is_used_like_constructor(&mut self, function: FunctionRef) -> bool {
        if self.is_constructed_at_path(function) {
            return true;
        }
        let FunctionRef { file, function } = function;
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let named = match bound.fns[function.idx()].owner {
            FnOwner::Expr(_) => {
                find_constant_holding(hir, bound, function).map(|(symbol, _)| symbol)
            }
            FnOwner::Stmt(_) => Some(bound.declared_symbol(Decl::Fn(function))),
            FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => None,
        };
        if let Some(symbol) = named {
            let of_file = self.prototype_links(file);
            let used = *of_file
                .declarations_used_like_constructors
                .get_or_init(|| self.compute_declarations_used_like_constructors(file));
            return used.binary_search(&symbol).is_ok();
        }
        match bound.fns[function.idx()].owner {
            FnOwner::Expr(expression) => {
                self.stands_where_a_constructor_stands(
                    file,
                    expression,
                    declares_this(hir, function),
                ) && !(is_stored_into_member(hir, bound, expression)
                    && (self.is_initializer_at_path(FunctionRef { file, function })
                        || self.is_static_method(file, expression)
                        || self.reads_member_nobody_has_stored(FunctionRef { file, function })))
            }
            FnOwner::Stmt(_) => unreachable!("a declared function has a name"),
            FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => true,
        }
    }
}
