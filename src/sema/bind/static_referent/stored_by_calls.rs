use super::walk::{
    find_argument_at, find_only_returned_value, find_place_of_plain_parameter, reads_exports_object,
};
use crate::atom::Atom;
use crate::bind::{Binding, BindingInitializer, BindingKind, Bound, FnOwner, Parent, SymbolId};
use crate::hir::*;
use smallvec::SmallVec;
use std::rc::Rc;

#[derive(Clone, Default)]
struct Calls(Option<Rc<EnteredCall>>);

struct EnteredCall {
    function: FnId,
    call: CallId,
    around_call: Calls,
    around_function: Calls,
}

#[derive(Clone)]
struct Closure {
    function: FnId,
    around: Calls,
}

type Values = SmallVec<[(ExprId, Calls); 2]>;

struct Search<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    open: Vec<(ExprId, Option<CallId>)>,
}

pub(super) fn find_value_stored_in_exports_by_call<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    name: Atom,
) -> Option<ExprId> {
    let mut search = Search {
        hir,
        bound,
        open: Vec::new(),
    };
    let mut stored = None;
    for node in (0..hir.exprs.len() as u32).map(ExprId) {
        let ExprKind::Call(call) = hir[node].kind else {
            continue;
        };
        let mut arguments = hir.ids(hir[call].args);
        let (Some(key), Some(value)) = (arguments.next(), arguments.next()) else {
            continue;
        };
        if !matches!(hir[hir.skip_type_assertions(key)].kind, ExprKind::String(text) if text == name)
            || matches!(hir[value].kind, ExprKind::Spread(_))
        {
            continue;
        }
        let callees = search.find_closures(hir[call].callee, &Calls::default());
        if !(callees.iter()).any(|callee| search.stores_second_under_first_in_exports(callee)) {
            continue;
        }
        if stored.replace(value).is_some() {
            return None;
        }
    }
    stored
}

impl Search<'_, '_> {
    fn symbol_named_by(&self, expr: ExprId) -> Option<SymbolId> {
        let expr = self.hir.skip_type_assertions(expr);
        match (self.hir[expr].kind, self.bound.binding(expr)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => Some(symbol),
            _ => None,
        }
    }

    fn symbol_of_parameter(&self, function: FnId, index: usize) -> Option<SymbolId> {
        let parameter = self.hir[function].params.iter().nth(index)?;
        let symbol = self.bound.pat_symbol[self.hir[parameter].pat.idx()];
        let place = find_place_of_plain_parameter(self.hir, self.bound, symbol)?;
        (place == (function, index) && self.bound.is_stable_binding(symbol)).then_some(symbol)
    }

    fn find_arguments_of_function_handed_to_called_function(
        &self,
        function: FnId,
        index: usize,
    ) -> Values {
        let (hir, bound) = (self.hir, self.bound);
        let mut found = Values::new();
        let FnOwner::Expr(written) = bound.fns[function.idx()].owner else {
            return found;
        };
        let Parent::Expr(around) = bound.parent_of_expr(written) else {
            return found;
        };
        let Some(ExprKind::Call(outer)) = hir.exprs.get(around.idx()).map(|node| node.kind) else {
            return found;
        };
        let ExprKind::Fn(called) = hir[hir.skip_type_assertions(hir[outer].callee)].kind else {
            return found;
        };
        let Some(position) = hir.ids(hir[outer].args).position(|it| it == written) else {
            return found;
        };
        if find_argument_at(hir, outer, position) != Some(written) {
            return found;
        }
        let Some(holder) = self.symbol_of_parameter(called, position) else {
            return found;
        };
        for node in (0..hir.exprs.len() as u32).map(ExprId) {
            if let ExprKind::Call(call) = hir[node].kind
                && self.symbol_named_by(hir[call].callee) == Some(holder)
                && let Some(argument) = find_argument_at(hir, call, index)
            {
                found.push((argument, Calls::default()));
            }
        }
        found
    }

    fn find_values_of_parameter(&self, symbol: SymbolId, around: &Calls) -> Values {
        let (hir, bound) = (self.hir, self.bound);
        let Some((function, index)) = find_place_of_plain_parameter(hir, bound, symbol) else {
            return Values::new();
        };
        if !bound.is_stable_binding(symbol) {
            return Values::new();
        }
        let mut at = around.0.as_deref();
        while let Some(entered) = at {
            if entered.function == function {
                let argument = find_argument_at(hir, entered.call, index);
                return (argument.into_iter())
                    .map(|it| (it, entered.around_call.clone()))
                    .collect();
            }
            at = entered.around_function.0.as_deref();
        }
        if let Some(call) = bound.get_immediately_invoked_function_expression(hir, function) {
            let argument = find_argument_at(hir, call, index);
            return (argument.into_iter())
                .map(|it| (it, around.clone()))
                .collect();
        }
        self.find_arguments_of_function_handed_to_called_function(function, index)
    }

    fn enter(&mut self, expr: ExprId, around: &Calls) -> bool {
        let entry = (expr, around.0.as_deref().map(|entered| entered.call));
        let is_new = !self.open.contains(&entry);
        if is_new {
            self.open.push(entry);
        }
        is_new
    }

    fn find_closures(&mut self, expr: ExprId, around: &Calls) -> SmallVec<[Closure; 2]> {
        let expr = self.hir.skip_type_assertions(expr);
        if !self.enter(expr, around) {
            return SmallVec::new();
        }
        let found = self.look_for_closures(expr, around);
        self.open.pop();
        found
    }

    fn look_for_closures(&mut self, expr: ExprId, around: &Calls) -> SmallVec<[Closure; 2]> {
        let (hir, bound) = (self.hir, self.bound);
        let closure_of = |function: FnId| Closure {
            function,
            around: around.clone(),
        };
        let mut found = SmallVec::new();
        match hir[expr].kind {
            ExprKind::Fn(function) => found.push(closure_of(function)),
            ExprKind::Ident(_) => {
                let Some(symbol) = self.symbol_named_by(expr) else {
                    return found;
                };
                if bound.binding_kind(symbol) == BindingKind::Parameter {
                    for (value, around) in self.find_values_of_parameter(symbol, around) {
                        found.extend(self.find_closures(value, &around));
                    }
                    return found;
                }
                if !bound.is_stable_binding(symbol) {
                    return found;
                }
                match bound.binding_initializer(hir, symbol) {
                    BindingInitializer::Function(function) => found.push(closure_of(function)),
                    BindingInitializer::Expression(value) => {
                        found = self.find_closures(value, around);
                    }
                    _ => {}
                }
            }
            ExprKind::Call(call) => {
                for callee in self.find_closures(hir[call].callee, around) {
                    let Some(value) = find_only_returned_value(hir, bound, callee.function) else {
                        continue;
                    };
                    let inside = Calls(Some(Rc::new(EnteredCall {
                        function: callee.function,
                        call,
                        around_call: around.clone(),
                        around_function: callee.around,
                    })));
                    found.extend(self.find_closures(value, &inside));
                }
            }
            _ => {}
        }
        found
    }

    fn is_exports_object(&mut self, expr: ExprId, around: &Calls) -> bool {
        let expr = self.hir.skip_type_assertions(expr);
        if reads_exports_object(self.hir, self.bound, expr) {
            return true;
        }
        let Some(symbol) = self.symbol_named_by(expr) else {
            return false;
        };
        if self.bound.binding_kind(symbol) != BindingKind::Parameter || !self.enter(expr, around) {
            return false;
        }
        let values = self.find_values_of_parameter(symbol, around);
        let is_exports =
            (values.iter()).any(|(value, around)| self.is_exports_object(*value, around));
        self.open.pop();
        is_exports
    }

    fn stores_second_under_first_in_exports(&mut self, closure: &Closure) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let function = closure.function;
        let (Some(key), Some(value)) = (
            self.symbol_of_parameter(function, 0),
            self.symbol_of_parameter(function, 1),
        ) else {
            return false;
        };
        let Some(returned) = find_only_returned_value(hir, bound, function) else {
            return false;
        };
        if !self.enter(returned, &closure.around) {
            return false;
        }
        let stores = self.returned_store_reaches_exports(closure, returned, key, value);
        self.open.pop();
        stores
    }

    fn returned_store_reaches_exports(
        &mut self,
        closure: &Closure,
        returned: ExprId,
        key: SymbolId,
        value: SymbolId,
    ) -> bool {
        let hir = self.hir;
        let ExprKind::Assign {
            op: None,
            target,
            value: stored,
        } = hir[hir.skip_type_assertions(returned)].kind
        else {
            return false;
        };
        let Some((holder, MemberKey::Computed(under))) = hir.member_key(target) else {
            return false;
        };
        if self.symbol_named_by(under) != Some(key) {
            return false;
        }
        let stored = hir.skip_type_assertions(stored);
        let arms: SmallVec<[ExprId; 2]> = match hir[stored].kind {
            ExprKind::Cond { branches, .. } => {
                let branches = hir.branches(branches);
                SmallVec::from_slice(&[branches.yes, branches.no])
            }
            _ => SmallVec::from_slice(&[stored]),
        };
        let mut handed_on: SmallVec<[ExprId; 1]> = SmallVec::new();
        for arm in arms {
            let arm = hir.skip_type_assertions(arm);
            if self.symbol_named_by(arm) == Some(value) {
                continue;
            }
            let ExprKind::Call(next) = hir[arm].kind else {
                return false;
            };
            let passed: SmallVec<[Option<SymbolId>; 2]> = (hir.ids(hir[next].args))
                .map(|it| self.symbol_named_by(it))
                .collect();
            if passed[..] != [Some(key), Some(value)] {
                return false;
            }
            handed_on.push(hir[next].callee);
        }
        if self.is_exports_object(holder, &closure.around) {
            return true;
        }
        handed_on.into_iter().any(|callee| {
            let next = self.find_closures(callee, &closure.around);
            (next.iter()).any(|next| self.stores_second_under_first_in_exports(next))
        })
    }
}
