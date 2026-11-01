//! What an expression may stand for, as far as its file spells it: what a constant holds, the elements of the list that a loop walks,
//! what the calls pass for a parameter. Some of the values, not all of them: whoever asks wants to know what a test may mean, not to prove anything.

use super::resolver::Resolver;
use crate::builtins::table::{self, BuiltinId, MemberLookup};
use bun_core::StackCheck;
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Decl, FnOwner, Parent, PatParent, SymbolId};
use bun_sema::hir::{
    BinOp, CallId, ExprId, ExprKind, FnId, FnKind, MemberKey, PatId, PatKind, PropKey, PropKind,
    StmtKind,
};
use bun_sema::util::{FxHashMap, FxHashSet};
use std::rc::Rc;

/// What the variables and the parameters of a file stand for. Each is walked once: a large file writes to members at hundreds of thousands of places, each of them asks
/// what the object is, and the ways back from there run through the same names.
#[derive(Default)]
pub(super) struct SpelledValues {
    /// Of the names that are walked to the end.
    known: FxHashMap<SymbolId, Rc<[ExprId]>>,
    /// The names that are being walked, and those that came round to one of them and wait for its end, with what they found themselves. In the order in which their walks began.
    waiting: Vec<(SymbolId, Vec<ExprId>)>,
    /// Where each of them stands in `waiting`.
    places: FxHashMap<SymbolId, usize>,
}

/// The walk from one expression, or from one name.
pub(super) struct Walk {
    seen: FxHashSet<ExprId>,
    /// The first of `SpelledValues::waiting` that it came round to.
    comes_round_to: usize,
}

struct Handed<T>(T);

// SAFETY: whoever hands it over waits until the other thread has ended: one of the two runs at a time.
unsafe impl<T> Send for Handed<T> {}

impl<T> Handed<T> {
    fn take(self) -> T {
        self.0
    }
}

/// The way from name to name is as long as the program makes it: ten thousand functions that each hand a parameter to the next. Where the stack of this thread
/// runs low, the walk goes on on the stack of another thread, and this one waits for it.
pub(super) fn on_a_stack_with_room<Found>(walk: impl FnOnce() -> Found) -> Found {
    StackCheck::configure_thread();
    if StackCheck::init().is_safe_to_recurse() {
        return walk();
    }
    let walk = Handed(walk);
    let thread = std::thread::Builder::new().stack_size(16 << 20);
    let found = std::thread::scope(|scope| {
        (thread.spawn_scoped(scope, move || Handed(walk.take()())))
            .expect("a thread for the rest of the walk")
            .join()
    });
    found
        .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
        .take()
}

fn without_repeats(values: Vec<ExprId>) -> Vec<ExprId> {
    let mut seen = FxHashSet::default();
    values
        .into_iter()
        .filter(|&value| seen.insert(value))
        .collect()
}

impl Resolver<'_, '_> {
    pub(super) fn find_values_spelled_for(&self, expr: ExprId) -> Vec<ExprId> {
        let mut values = Vec::new();
        let mut walk = Walk {
            seen: FxHashSet::default(),
            comes_round_to: usize::MAX,
        };
        self.push_values_spelled_for(expr, &mut walk, &mut values);
        without_repeats(values)
    }

    fn push_values_of_name(
        &self,
        name: SymbolId,
        declaration: Decl,
        walk: &mut Walk,
        values: &mut Vec<ExprId>,
    ) {
        let place = {
            let mut spelled = self.spelled_values.borrow_mut();
            if let Some(known) = spelled.known.get(&name) {
                return values.extend_from_slice(known);
            }
            // `function a(x) { b(x); }`, `function b(y) { a(y); }`: what is passed for one is passed for the other. Whichever walk began first ends last, and has it all.
            if let Some(&place) = spelled.places.get(&name) {
                walk.comes_round_to = walk.comes_round_to.min(place);
                return;
            }
            let place = spelled.waiting.len();
            spelled.places.insert(name, place);
            spelled.waiting.push((name, Vec::new()));
            place
        };
        let mut found = Vec::new();
        let mut from_name = Walk {
            seen: FxHashSet::default(),
            comes_round_to: place,
        };
        on_a_stack_with_room(|| match declaration {
            Decl::Var(pattern) => self.push_values_of_variable(pattern, &mut from_name, &mut found),
            Decl::Param(pattern) => {
                self.push_values_of_parameter(pattern, &mut from_name, &mut found);
            }
            _ => {}
        });
        let mut spelled = self.spelled_values.borrow_mut();
        if from_name.comes_round_to < place {
            walk.comes_round_to = walk.comes_round_to.min(from_name.comes_round_to);
            values.extend_from_slice(&found);
            spelled.waiting[place].1 = found;
            return;
        }
        let all: Rc<[ExprId]> = without_repeats(found).into();
        let waited = spelled.waiting.split_off(place);
        let is_among_all: FxHashSet<ExprId> = match waited.len() {
            1 => FxHashSet::default(),
            _ => all.iter().copied().collect(),
        };
        for (waiting, own) in waited {
            spelled.places.remove(&waiting);
            // What went on from it into a property or an element did not come to the end as it was.
            let own: Vec<ExprId> = (own.into_iter())
                .filter(|value| !is_among_all.contains(value))
                .collect();
            let known = match own.is_empty() {
                true => Rc::clone(&all),
                false => {
                    without_repeats(own.into_iter().chain(all.iter().copied()).collect()).into()
                }
            };
            spelled.known.insert(waiting, known);
        }
        values.extend_from_slice(&all);
    }

    fn push_values_spelled_for(&self, expr: ExprId, walk: &mut Walk, values: &mut Vec<ExprId>) {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let expr = hir.skip_type_assertions(expr);
        // A parameter of a function that is called at thousands of places leads to as many expressions.
        if !walk.seen.insert(expr) {
            return;
        }
        let before = values.len();
        match hir[expr].kind {
            // `flag ? "at" : "map"`
            ExprKind::Cond { branches, .. } => {
                let branches = hir.branches(branches);
                self.push_values_spelled_for(branches.yes, walk, values);
                self.push_values_spelled_for(branches.no, walk, values);
            }
            // `name ?? "at"`
            ExprKind::Binary {
                op: BinOp::Nullish | BinOp::Or | BinOp::And,
                left,
                right,
            } => {
                self.push_values_spelled_for(left, walk, values);
                self.push_values_spelled_for(right, walk, values);
            }
            _ => {}
        }
        // `row.name` for `{ name: "at" }`
        if let Some((object, MemberKey::Name(name))) = hir.member_key(expr) {
            let mut wholes = Vec::new();
            self.push_values_spelled_for(object, walk, &mut wholes);
            for whole in wholes {
                if let Some(part) = self.find_property_of_literal(whole, name) {
                    self.push_values_spelled_for(part, walk, values);
                }
            }
        }
        if let (ExprKind::Ident(_), Binding::Symbol(symbol)) = (hir[expr].kind, bound.binding(expr))
            && let &[declaration] = bound.symbol(symbol).decls
        {
            self.push_values_of_name(symbol, declaration, walk, values);
        }
        // Nothing is known of it but itself.
        if values.len() == before {
            values.push(expr);
        }
    }

    fn push_elements_of(&self, list: ExprId, walk: &mut Walk, values: &mut Vec<ExprId>) {
        let (hir, bound) = (self.input.hir, self.input.bound);
        // `names.push("at", "map")`
        let name = hir.skip_type_assertions(list);
        if let (ExprKind::Ident(_), Binding::Symbol(symbol)) = (hir[name].kind, bound.binding(name))
        {
            let calls = self
                .calls_by_name
                .get_or_init(|| self.collect_calls_by_name());
            for &call in calls.get(&symbol).map_or(&[][..], Vec::as_slice) {
                let adds = matches!(hir.member_key(hir.skip_type_assertions(hir[call].callee)),
                Some((_, MemberKey::Name(method))) if (self.input.names.get(method)).is_some_and(|method| matches!(
                    table::member(BuiltinId::ArrayPrototype, method),
                    MemberLookup::Found(BuiltinId::ArrayPrototypePush | BuiltinId::ArrayPrototypeUnshift)
                )));
                for element in hir.ids(hir[call].args).filter(|_| adds) {
                    self.push_values_spelled_for(element, walk, values);
                }
            }
        }
        let mut lists = Vec::new();
        self.push_values_spelled_for(list, walk, &mut lists);
        for list in lists {
            match hir[list].kind {
                ExprKind::Array(elements) => {
                    for element in hir.ids(elements) {
                        match hir[element].kind {
                            // `[...names, "at"]`
                            ExprKind::Spread(inner) => self.push_elements_of(inner, walk, values),
                            _ => self.push_values_spelled_for(element, walk, values),
                        }
                    }
                }
                // `names.filter(isThere)`, `names.slice(1)`, `names.concat(others)`: elements of the lists that it is made of
                ExprKind::Call(call) => {
                    let callee = hir.skip_type_assertions(hir[call].callee);
                    let Some((receiver, MemberKey::Name(method))) = hir.member_key(callee) else {
                        continue;
                    };
                    let method = (self.input.names.get(method))
                        .map(|method| table::member(BuiltinId::ArrayPrototype, method));
                    match method {
                        Some(MemberLookup::Found(
                            BuiltinId::ArrayPrototypeFilter
                            | BuiltinId::ArrayPrototypeSlice
                            | BuiltinId::ArrayPrototypeSort
                            | BuiltinId::ArrayPrototypeReverse
                            | BuiltinId::ArrayPrototypeToSorted
                            | BuiltinId::ArrayPrototypeToReversed,
                        )) => self.push_elements_of(receiver, walk, values),
                        Some(MemberLookup::Found(BuiltinId::ArrayPrototypeConcat)) => {
                            self.push_elements_of(receiver, walk, values);
                            for other in hir.ids(hir[call].args) {
                                self.push_elements_of(other, walk, values);
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }

    pub(super) fn find_property_of_literal(&self, literal: ExprId, name: Atom) -> Option<ExprId> {
        let hir = self.input.hir;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return None;
        };
        (properties.iter().map(|it| hir[it]))
            .filter(|it| {
                matches!(
                    it.kind,
                    PropKind::Init | PropKind::Shorthand | PropKind::Method
                )
            })
            .find(|it| matches!(it.key, PropKey::Name(key) if key == name))
            .map(|it| it.value)
    }

    // `const name = "at"`, `for (const name of ["at", "map"])`
    fn push_values_of_variable(&self, pattern: PatId, walk: &mut Walk, values: &mut Vec<ExprId>) {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
            return self.push_values_of_part(pattern, walk, values);
        };
        if hir[declaration].init.is_some() {
            return self.push_values_spelled_for(hir[declaration].init, walk, values);
        }
        let statement = bound.var_stmt[declaration.idx()];
        if let Parent::Stmt(above) = bound.parent_of_stmt(statement)
            && let StmtKind::ForOf { left, expr, .. } = hir[above].kind
            && left == statement
        {
            self.push_elements_of(expr, walk, values);
        }
    }

    // `for (const [holder, name] of [[Math, "max"]])`, `pairs.forEach(([holder, name]) => { .. })`, `for (const { holder, name } of [{ holder: Math, name: "max" }])`
    fn push_values_of_part(&self, pattern: PatId, walk: &mut Walk, values: &mut Vec<ExprId>) {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let (whole, default) = match bound.pat_parent[pattern.idx()] {
            PatParent::Elem(whole, element) => (whole, hir[element].default),
            PatParent::Prop(whole, property) => (whole, hir[property].default),
            _ => return,
        };
        if default.is_some() {
            self.push_values_spelled_for(default, walk, values);
        }
        let mut wholes = Vec::new();
        match bound.pat_parent[whole.idx()] {
            PatParent::Var(_) => self.push_values_of_variable(whole, walk, &mut wholes),
            PatParent::Param(_) => self.push_values_of_parameter(whole, walk, &mut wholes),
            _ => return,
        }
        for value in wholes {
            let part = match (
                bound.pat_parent[pattern.idx()],
                hir[whole].kind,
                hir[value].kind,
            ) {
                (PatParent::Elem(_, element), PatKind::Array(elements), ExprKind::Array(cells))
                    if !hir[element].is_rest =>
                {
                    let index = elements.iter().position(|it| it == element);
                    let is_spread = |cell: ExprId| matches!(hir[cell].kind, ExprKind::Spread(_));
                    index
                        .filter(|&index| !hir.ids(cells).take(index + 1).any(is_spread))
                        .and_then(|index| hir.ids(cells).nth(index))
                }
                (PatParent::Prop(_, property), _, ExprKind::Object(_))
                    if !hir[property].is_rest =>
                {
                    let PropKey::Name(name) = hir[property].key else {
                        continue;
                    };
                    self.find_property_of_literal(value, name)
                }
                _ => None,
            };
            if let Some(part) = part {
                self.push_values_spelled_for(part, walk, values);
            }
        }
    }

    /// `stubs` for `name` in `for (const name in stubs)`, `for (const name of Object.keys(stubs))`, `for (const [name, value] of Object.entries(stubs))`,
    /// `Object.keys(stubs).forEach(name => { .. })` and `Object.entries(stubs).forEach(([name, value]) => { .. })`.
    pub(super) fn find_object_whose_keys_are_listed_for(&self, key: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let key = hir.skip_type_assertions(key);
        let (ExprKind::Ident(_), Binding::Symbol(symbol)) = (hir[key].kind, bound.binding(key))
        else {
            return None;
        };
        let &[Decl::Var(pattern) | Decl::Param(pattern)] = bound.symbol(symbol).decls else {
            return None;
        };
        let (whole, is_first_of_pair) = match bound.pat_parent[pattern.idx()] {
            PatParent::Elem(whole, element) => {
                let PatKind::Array(elements) = hir[whole].kind else {
                    return None;
                };
                let is_first = elements.iter().next() == Some(element) && !hir[element].is_rest;
                (whole, is_first.then_some(true)?)
            }
            _ => (pattern, false),
        };
        let list = match bound.pat_parent[whole.idx()] {
            PatParent::Var(declaration) if hir[declaration].init.is_none() => {
                let statement = bound.var_stmt[declaration.idx()];
                let Parent::Stmt(above) = bound.parent_of_stmt(statement) else {
                    return None;
                };
                match hir[above].kind {
                    StmtKind::ForIn { left, expr, .. } if left == statement => {
                        return (!is_first_of_pair).then_some(expr);
                    }
                    StmtKind::ForOf { left, expr, .. } if left == statement => expr,
                    _ => return None,
                }
            }
            PatParent::Param(parameter) => {
                let function = bound.param_fn[parameter.idx()];
                let is_first = hir[function].params.iter().next() == Some(parameter);
                let FnOwner::Expr(expression) = bound.fns[function.idx()].owner else {
                    return None;
                };
                let Parent::Expr(above) = bound.parent_of_expr(expression) else {
                    return None;
                };
                let ExprKind::Call(call) = hir[above].kind else {
                    return None;
                };
                let is_operand = hir.ids(hir[call].args).next() == Some(expression);
                let callee = hir.skip_type_assertions(hir[call].callee);
                let (list, MemberKey::Name(_)) = hir.member_key(callee)? else {
                    return None;
                };
                (is_first && is_operand).then_some(list)?
            }
            _ => return None,
        };
        let ExprKind::Call(call) = hir[hir.skip_type_assertions(list)].kind else {
            return None;
        };
        let lists_pairs = match self.value_of(hir[call].callee)?.path.id {
            BuiltinId::ObjectKeys
            | BuiltinId::ObjectGetOwnPropertyNames
            | BuiltinId::ReflectOwnKeys => false,
            BuiltinId::ObjectEntries => true,
            _ => return None,
        };
        (lists_pairs == is_first_of_pair)
            .then(|| hir.ids(hir[call].args).next())
            .flatten()
    }

    fn collect_calls_by_name(&self) -> FxHashMap<SymbolId, Vec<CallId>> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut calls: FxHashMap<SymbolId, Vec<CallId>> = FxHashMap::default();
        for expr in (0..hir.exprs.len() as u32).map(ExprId) {
            // `name(..)`, `new name(..)`, and `name.method(..)` under the same name: who asks looks at the callee.
            if let ExprKind::Call(call) | ExprKind::New(call) = hir[expr].kind
                && let callee = hir.skip_type_assertions(hir[call].callee)
                && let name = hir.member_key(callee).map_or(callee, |(object, _)| object)
                && let name = hir.skip_type_assertions(name)
                && matches!(hir[name].kind, ExprKind::Ident(_))
                && let Binding::Symbol(name) = bound.binding(name)
            {
                calls.entry(name).or_default().push(call);
            }
        }
        calls
    }

    fn find_name_of(&self, function: FnId) -> Option<SymbolId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let name = match (hir[function].kind, bound.fns[function.idx()].owner) {
            (FnKind::Decl, _) => bound.declared_symbol(Decl::Fn(function)),
            (FnKind::Expr | FnKind::Arrow, FnOwner::Expr(expression)) => {
                let Parent::VarInit(declaration) = bound.parent_of_expr(expression) else {
                    return None;
                };
                match hir[hir[declaration].pat].kind {
                    PatKind::Ident(_) => bound.declared_symbol(Decl::Var(hir[declaration].pat)),
                    _ => return None,
                }
            }
            _ => return None,
        };
        name.is_some().then_some(name)
    }

    fn push_values_of_parameter(&self, pattern: PatId, walk: &mut Walk, values: &mut Vec<ExprId>) {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let PatParent::Param(parameter) = bound.pat_parent[pattern.idx()] else {
            return self.push_values_of_part(pattern, walk, values);
        };
        // `(holder, name = "at") => { .. }`
        if hir[parameter].default.is_some() {
            self.push_values_spelled_for(hir[parameter].default, walk, values);
        }
        let function = bound.param_fn[parameter.idx()];
        let Some(index) = hir[function].params.iter().position(|it| it == parameter) else {
            return;
        };
        let operand_of = |call: CallId| hir.ids(hir[call].args).nth(index);
        // `function wrap(name) { .. }`, `wrap("at")`
        if let Some(name) = self.find_name_of(function) {
            let calls = self
                .calls_by_name
                .get_or_init(|| self.collect_calls_by_name());
            let calls = calls.get(&name).map_or(&[][..], Vec::as_slice);
            let is_called_by_name = |call: &&CallId| {
                let callee = hir.skip_type_assertions(hir[**call].callee);
                matches!(hir[callee].kind, ExprKind::Ident(_))
            };
            for operand in
                (calls.iter().filter(is_called_by_name)).filter_map(|&call| operand_of(call))
            {
                self.push_values_spelled_for(operand, walk, values);
            }
        }
        let FnOwner::Expr(expression) = bound.fns[function.idx()].owner else {
            return;
        };
        let Parent::Expr(above) = bound.parent_of_expr(expression) else {
            return;
        };
        let ExprKind::Call(call) = hir[above].kind else {
            return;
        };
        let callee = hir.skip_type_assertions(hir[call].callee);
        // `((name) => { .. })("at")`
        if callee == expression {
            if let Some(operand) = operand_of(call) {
                self.push_values_spelled_for(operand, walk, values);
            }
            return;
        }
        match hir[callee].kind {
            // `test.each(["at", "map"])("%s", name => { .. })`, `test.each([[Math, "max"]])("%s", (holder, name) => { .. })`
            ExprKind::Call(maker) => {
                let Some(rows) = hir.ids(hir[maker].args).next() else {
                    return;
                };
                let mut rows_spelled = Vec::new();
                self.push_elements_of(rows, walk, &mut rows_spelled);
                for row in rows_spelled {
                    match hir[row].kind {
                        ExprKind::Array(cells) => {
                            if let Some(cell) = hir.ids(cells).nth(index) {
                                self.push_values_spelled_for(cell, walk, values);
                            }
                        }
                        _ if index == 0 => values.push(row),
                        _ => {}
                    }
                }
            }
            // `["at", "map"].forEach(name => { .. })`
            _ if index == 0 => {
                if let Some((list, MemberKey::Name(_))) = hir.member_key(callee) {
                    self.push_elements_of(list, walk, values);
                }
            }
            _ => {}
        }
    }
}
