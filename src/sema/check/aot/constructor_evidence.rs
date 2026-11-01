use super::answers::FunctionRef;
use super::class_shape::is_prototype_object;
use super::class_stores::ThisOwner;
use super::prototype_links::{NamedValue, PrototypeOperation, list_in};
use super::queries::Queries;
use crate::atom::known;
use crate::bind::{Binding, Bound, Decl, FnOwner, Parent, SymbolId};
use crate::hir::{
    self, BinOp, ExportSpecId, ExprId, ExprKind, ExprTag, Flags, FnId, FnKind, MemberKey, PatKind,
    PropKey, TypeNodeKind, VarKind,
};
use crate::program::FileId;
use crate::util::FxHashSet;

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

fn stands_where_a_constructor_stands(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    mut value: ExprId,
    declares_this: bool,
) -> bool {
    loop {
        let parent = match bound.parent_of_expr(value) {
            Parent::Expr(parent) => parent,
            Parent::None => return false,
            Parent::Prop(property) => {
                return !declares_this
                    && !matches!(
                        hir.runtime_property_key(property),
                        PropKey::Name(name) if name == known::get || name == known::set
                    );
            }
            _ => return true,
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
        };
    }
}

// `fill(this, options)`   `const made = parent ? create() : this`
// Somebody else may fill the object. `other.call(this)` and `Reflect.apply(other, this, list)` hand on a receiver, which every method has.
// `Object.defineProperty(this, "name", { .. })`, `Error.captureStackTrace(this)`: a member of a global, or a global, stores nothing under a name.
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

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    fn compute_declarations_used_like_constructors(&mut self, file: FileId) -> &'s [SymbolId] {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let functions = (0..hir.fns.len() as u32).map(FnId);
        let mut unused = FxHashSet::default();
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
                    && unused.contains(&symbol)
                    && !bound.is_in_type_query(reference)
                    && stands_where_a_constructor_stands(
                        hir,
                        bound,
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
            // A function that says what it is called on is called on that.
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

    /// Whether the function gives its `this` to other code that may store the fields of what `new` makes.
    pub(super) fn hands_this_on(&mut self, function: FunctionRef) -> bool {
        let of_file = self.prototype_links(function.file);
        let functions = *of_file
            .functions_handing_this_on
            .get_or_init(|| self.compute_functions_handing_this_on(function.file));
        functions.binary_search(&function.function).is_ok()
    }

    /// A member of an object is taken for a method. What has a name of its own, or is what a function returns, may be anything.
    pub(super) fn is_held_by_name_or_returned(&self, function: FunctionRef) -> bool {
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

    /// `kind.update = function () { if (this.options.strict) this.allowed = true; }`: what `new` makes has no `options` yet, so the
    /// function is called on an object that somebody else has filled. A function that hands `this` on may have had it filled.
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
                stands_where_a_constructor_stands(
                    hir,
                    bound,
                    expression,
                    declares_this(hir, function),
                ) && !(is_stored_into_member(hir, bound, expression)
                    && self.reads_member_nobody_has_stored(FunctionRef { file, function }))
            }
            FnOwner::Stmt(_) => unreachable!("a declared function has a name"),
            FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => true,
        }
    }
}
