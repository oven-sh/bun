use super::resolver::{ExprState, Resolver};
use crate::builtins::intrinsics::{find_intrinsic, find_native_call_kind, find_symbol_key};
use crate::builtins::table::{self, Intrinsic, IntrinsicPosition};
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Parent};
use bun_sema::hir::{ExprId, ExprKind};

impl Resolver<'_, '_> {
    fn is_callee_of(&self, expr: ExprId, parent: ExprId) -> bool {
        let hir = self.input.hir;
        matches!(hir[parent].kind, ExprKind::Call(call) if hir[call].callee == expr)
    }

    pub(super) fn find_runtime_free_name(&self, expr: ExprId, name: Atom) -> Option<Intrinsic> {
        let input = self.input;
        let parent = input.bound.parent_of_expr(expr);
        let position = match matches!(parent, Parent::Expr(call) if self.is_callee_of(expr, call)) {
            true => IntrinsicPosition::Call,
            false => IntrinsicPosition::Value,
        };
        find_intrinsic(input.names, name, position)
            .or_else(|| input.names.get(name).and_then(table::prefixed_global))
    }

    pub(super) fn find_runtime_member(&self, name: Atom) -> Option<Intrinsic> {
        let names = self.input.names;
        find_symbol_key(names, name)
            .map(Intrinsic::SymbolKey)
            .or_else(|| find_intrinsic(names, name, IntrinsicPosition::Member))
    }

    pub(super) fn compute_native_call_state(&self, expr: ExprId) -> ExprState {
        let input = self.input;
        let ExprKind::Call(call) = input.hir[expr].kind else {
            return ExprState::Unresolved;
        };
        let call = &input.hir[call];
        let ExprKind::Ident(name) = input.hir[call.callee].kind else {
            return ExprState::Unresolved;
        };
        if input.bound.binding(call.callee) != Binding::Free {
            return ExprState::Unresolved;
        }
        let Some(kind) = find_native_call_kind(input.names, name) else {
            return ExprState::Unresolved;
        };
        let literal_name = |argument: Option<ExprId>| {
            let ExprKind::String(text) = input.hir[argument?].kind else {
                return None;
            };
            input.names.get(text)
        };
        let mut arguments = input.hir.ids(call.args);
        let file = literal_name(arguments.next());
        let symbol = literal_name(arguments.next());
        let binding = file
            .zip(symbol)
            .and_then(|(file, symbol)| table::native_binding(kind, file, symbol));
        match binding {
            Some(intrinsic) => ExprState::Intrinsic(intrinsic),
            None => {
                debug_assert!(false, "a native call that Bun's build does not list");
                ExprState::Unresolved
            }
        }
    }
}
