use bun_sema::bind::{Binding, Bound, CodeUnit, Decl, SymbolId};
use bun_sema::hir::{self, Chain, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, NodeData};

use super::find_function_that_initializes;

pub(in crate::lower) struct CalledByName {
    pub(in crate::lower) function: FnId,
    /// The name, where an expression fills it with the function: only a call that runs behind that enters the function.
    pub(in crate::lower) initialized: Option<SymbolId>,
}

/// A function declares the name as a function, and the name never means anything else: the function. Nobody has its function object but by reading the name.
pub(in crate::lower) fn find_declaration_made_at_first_read(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    symbol: SymbolId,
) -> Option<FnId> {
    let Some(Decl::Fn(function)) = bound.initializing_declaration(symbol) else {
        return None;
    };
    let CodeUnit::Function(_) = bound.code_unit(bound.symbol_scope(symbol)) else {
        return None;
    };
    let is_only_a_name = !bound.is_visible_to_eval(symbol)
        && bound.symbol(symbol).parent.is_none()
        && bound.is_stable_binding(symbol);
    let declared = hir[function];
    if !is_only_a_name || declared.kind != FnKind::Decl || matches!(declared.body, FnBody::None) {
        return None;
    }
    let annex_b_functions = bound.runtime.annex_b_functions();
    let is_stored_where_it_stands = annex_b_functions
        .binary_search_by_key(&function, |entry| entry.function)
        .is_ok();
    (!is_stored_where_it_stands).then_some(function)
}

/// `f(..)`, where a function declares `f` as a function and the name never means anything else.
/// The call enters the function itself. Whoever calls hands over what the function captures (`compute_captures` makes it a supplier), and nobody reads the binding:
/// a function that is only called so has no closure, and its name no place in the scope.
pub(in crate::lower) fn find_declaration_called_by_name(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    expression: ExprId,
) -> Option<CalledByName> {
    // `new f(..)` and a tagged template read the name.
    let ExprKind::Call(call) = hir[expression].kind else {
        return None;
    };
    let call = hir[call];
    if call.chain != Chain::No {
        return None;
    }
    let callee = hir.skip_type_assertions(call.callee);
    let ExprKind::Ident(_) = hir[callee].kind else {
        return None;
    };
    let Binding::Symbol(symbol) = bound.binding(callee) else {
        return None;
    };
    let is_found_by_name = bound.is_visible_to_eval(symbol)
        || bound.dynamic_lookup_scope(NodeData::Expr(callee)).is_some();
    // What a namespace exports is a property of its object.
    let is_member = bound.symbol(symbol).parent.is_some();
    if is_found_by_name || is_member || !bound.is_stable_binding(symbol) {
        return None;
    }
    let Some(Decl::Fn(function)) = bound.initializing_declaration(symbol) else {
        let mut written = hir.ids(call.args);
        if written.any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return None;
        }
        let function = find_function_that_initializes(hir, bound, symbol)?;
        return Some(CalledByName {
            function,
            initialized: Some(symbol),
        });
    };
    // What a file declares is a variable of its module, and the function captures nothing.
    let CodeUnit::Function(_) = bound.code_unit(bound.symbol_scope(symbol)) else {
        return None;
    };
    let declared = hir[function];
    // A sloppy function takes the global object for a `this` that nobody hands over.
    if declared.kind != FnKind::Decl || !declared.is_strict || matches!(declared.body, FnBody::None)
    {
        return None;
    }
    if declared.flags.contains(Flags::ASYNC) || declared.flags.contains(Flags::GENERATOR) {
        return None;
    }
    let annex_b_functions = bound.runtime.annex_b_functions();
    let is_stored_where_it_stands = annex_b_functions
        .binary_search_by_key(&function, |entry| entry.function)
        .is_ok();
    let mut arguments = hir.ids(call.args);
    let has_spread = arguments.any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_)));
    if is_stored_where_it_stands || has_spread {
        return None;
    }
    Some(CalledByName {
        function,
        initialized: None,
    })
}
