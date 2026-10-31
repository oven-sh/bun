//! What an expression may stand for, as far as its file spells it: what a constant holds, the elements of the list that a loop walks,
//! what the calls pass for a parameter. Some of the values, not all of them: whoever asks wants to know what a test may mean, not to prove anything.

use super::resolver::Resolver;
use crate::builtins::table::{self, BuiltinId, MemberLookup};
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Decl, FnOwner, Parent, PatParent, SymbolId};
use bun_sema::hir::{
    BinOp, CallId, ExprId, ExprKind, FnId, FnKind, MemberKey, PatId, PatKind, PropKey, PropKind,
    StmtKind,
};
use bun_sema::util::{FxHashMap, FxHashSet};

impl Resolver<'_, '_> {
    pub(super) fn find_values_spelled_for(&self, expr: ExprId) -> Vec<ExprId> {
        let (mut values, mut seen) = (Vec::new(), FxHashSet::default());
        self.push_values_spelled_for(expr, &mut seen, &mut values);
        values
    }

    fn push_values_spelled_for(
        &self,
        expr: ExprId,
        seen: &mut FxHashSet<ExprId>,
        values: &mut Vec<ExprId>,
    ) {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let expr = hir.skip_type_assertions(expr);
        // A parameter of a function that is called at thousands of places leads to as many expressions.
        if !seen.insert(expr) {
            return;
        }
        let before = values.len();
        match hir[expr].kind {
            // `flag ? "at" : "map"`
            ExprKind::Cond { branches, .. } => {
                let branches = hir.branches(branches);
                self.push_values_spelled_for(branches.yes, seen, values);
                self.push_values_spelled_for(branches.no, seen, values);
            }
            // `name ?? "at"`
            ExprKind::Binary {
                op: BinOp::Nullish | BinOp::Or | BinOp::And,
                left,
                right,
            } => {
                self.push_values_spelled_for(left, seen, values);
                self.push_values_spelled_for(right, seen, values);
            }
            _ => {}
        }
        // `row.name` for `{ name: "at" }`
        if let Some((object, MemberKey::Name(name))) = hir.member_key(expr) {
            let mut wholes = Vec::new();
            self.push_values_spelled_for(object, seen, &mut wholes);
            for whole in wholes {
                if let Some(part) = self.find_property_of_literal(whole, name) {
                    self.push_values_spelled_for(part, seen, values);
                }
            }
        }
        if let (ExprKind::Ident(_), Binding::Symbol(symbol)) = (hir[expr].kind, bound.binding(expr))
            && let &[declaration] = bound.symbol(symbol).decls
        {
            match declaration {
                Decl::Var(pattern) => self.push_values_of_variable(pattern, seen, values),
                Decl::Param(pattern) => self.push_values_of_parameter(pattern, seen, values),
                _ => {}
            }
        }
        // Nothing is known of it but itself.
        if values.len() == before {
            values.push(expr);
        }
    }

    fn push_elements_of(
        &self,
        list: ExprId,
        seen: &mut FxHashSet<ExprId>,
        values: &mut Vec<ExprId>,
    ) {
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
                    self.push_values_spelled_for(element, seen, values);
                }
            }
        }
        let mut lists = Vec::new();
        self.push_values_spelled_for(list, seen, &mut lists);
        for list in lists {
            match hir[list].kind {
                ExprKind::Array(elements) => {
                    for element in hir.ids(elements) {
                        match hir[element].kind {
                            // `[...names, "at"]`
                            ExprKind::Spread(inner) => self.push_elements_of(inner, seen, values),
                            _ => self.push_values_spelled_for(element, seen, values),
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
                        )) => self.push_elements_of(receiver, seen, values),
                        Some(MemberLookup::Found(BuiltinId::ArrayPrototypeConcat)) => {
                            self.push_elements_of(receiver, seen, values);
                            for other in hir.ids(hir[call].args) {
                                self.push_elements_of(other, seen, values);
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }

    fn find_property_of_literal(&self, literal: ExprId, name: Atom) -> Option<ExprId> {
        let hir = self.input.hir;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return None;
        };
        (properties.iter().map(|it| hir[it]))
            .filter(|it| matches!(it.kind, PropKind::Init | PropKind::Shorthand))
            .find(|it| matches!(it.key, PropKey::Name(key) if key == name))
            .map(|it| it.value)
    }

    // `const name = "at"`, `for (const name of ["at", "map"])`
    fn push_values_of_variable(
        &self,
        pattern: PatId,
        seen: &mut FxHashSet<ExprId>,
        values: &mut Vec<ExprId>,
    ) {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
            return self.push_values_of_part(pattern, seen, values);
        };
        if hir[declaration].init.is_some() {
            return self.push_values_spelled_for(hir[declaration].init, seen, values);
        }
        let statement = bound.var_stmt[declaration.idx()];
        if let Parent::Stmt(above) = bound.parent_of_stmt(statement)
            && let StmtKind::ForOf { left, expr, .. } = hir[above].kind
            && left == statement
        {
            self.push_elements_of(expr, seen, values);
        }
    }

    // `for (const [holder, name] of [[Math, "max"]])`, `pairs.forEach(([holder, name]) => { .. })`, `for (const { holder, name } of [{ holder: Math, name: "max" }])`
    fn push_values_of_part(
        &self,
        pattern: PatId,
        seen: &mut FxHashSet<ExprId>,
        values: &mut Vec<ExprId>,
    ) {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let whole = match bound.pat_parent[pattern.idx()] {
            PatParent::Elem(whole, _) | PatParent::Prop(whole, _) => whole,
            _ => return,
        };
        let mut wholes = Vec::new();
        match bound.pat_parent[whole.idx()] {
            PatParent::Var(_) => self.push_values_of_variable(whole, seen, &mut wholes),
            PatParent::Param(_) => self.push_values_of_parameter(whole, seen, &mut wholes),
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
                self.push_values_spelled_for(part, seen, values);
            }
        }
    }

    fn collect_calls_by_name(&self) -> FxHashMap<SymbolId, Vec<CallId>> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut calls: FxHashMap<SymbolId, Vec<CallId>> = FxHashMap::default();
        for expr in (0..hir.exprs.len() as u32).map(ExprId) {
            // `name(..)`, and `name.method(..)` under the same name: who asks looks at the callee.
            if let ExprKind::Call(call) = hir[expr].kind
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

    fn push_values_of_parameter(
        &self,
        pattern: PatId,
        seen: &mut FxHashSet<ExprId>,
        values: &mut Vec<ExprId>,
    ) {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let PatParent::Param(parameter) = bound.pat_parent[pattern.idx()] else {
            return self.push_values_of_part(pattern, seen, values);
        };
        // `(holder, name = "at") => { .. }`
        if hir[parameter].default.is_some() {
            self.push_values_spelled_for(hir[parameter].default, seen, values);
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
                self.push_values_spelled_for(operand, seen, values);
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
                self.push_values_spelled_for(operand, seen, values);
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
                self.push_elements_of(rows, seen, &mut rows_spelled);
                for row in rows_spelled {
                    match hir[row].kind {
                        ExprKind::Array(cells) => {
                            if let Some(cell) = hir.ids(cells).nth(index) {
                                self.push_values_spelled_for(cell, seen, values);
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
                    self.push_elements_of(list, seen, values);
                }
            }
            _ => {}
        }
    }
}
