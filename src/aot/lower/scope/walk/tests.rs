mod classes;
mod evals;
mod functions;
mod statements;

use bun_sema::bind::{Bound, FnOwner, ScopeId, SymbolId};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{self, ClassId, FnId, MemberId, StmtId};

use super::{ScopeWalk, WalkedFunctionId};
use crate::ir::{ClassSlot, FunctionKey};
use crate::lower::scope::analysis::find_by_key;
use crate::lower::scope::testing::{walk_scopes, with_scope_input};
use crate::lower::scope::{BindingRef, ScopeSlot};

fn with_walk<R>(
    files: &[(&str, &str)],
    test: impl FnOnce(&hir::File<'_>, &Bound<'_>, &ScopeWalk) -> R,
) -> R {
    with_scope_input(files, |input| {
        test(input.hir, input.bound, &walk_scopes(input))
    })
}

fn walked(walk: &ScopeWalk, function: FnId) -> WalkedFunctionId {
    walk.function_of_fn[function.idx()].expect("the function is live")
}

fn walked_function(walk: &ScopeWalk, key: FunctionKey) -> WalkedFunctionId {
    let mut functions = walk.functions.iter();
    let found = functions.position(|function| function.key == key);
    WalkedFunctionId(found.expect("the walk met the function") as u32)
}

fn class_ref(walk: &ScopeWalk, class: ClassId) -> ClassRef {
    let file = walk.functions[0].key.home_file();
    ClassRef { file, class }
}

fn creator_of(walk: &ScopeWalk, function: WalkedFunctionId) -> Option<WalkedFunctionId> {
    walk.functions[function.index()].creator
}

fn hoisted_to(walk: &ScopeWalk, function: FnId) -> Option<ScopeId> {
    walk.functions[walked(walk, function).index()].hoisted_to
}

fn created_at(walk: &ScopeWalk, function: WalkedFunctionId) -> u32 {
    walk.functions[function.index()].created_at
}

fn initialized_at(walk: &ScopeWalk, symbol: SymbolId) -> u32 {
    let initialization = walk.symbol_initializations[symbol.idx()];
    initialization
        .expect("the walk met the initialization")
        .time
}

fn slot_initialized_at(walk: &ScopeWalk, scope: ScopeId, slot: ClassSlot) -> u32 {
    let time = find_by_key(&walk.slot_initializations, (scope, ScopeSlot::Class(slot)));
    time.expect("the walk met the initialization of the slot")
}

fn has_use(walk: &ScopeWalk, function: WalkedFunctionId, binding: BindingRef) -> bool {
    walk.uses.binary_search(&(function, binding)).is_ok()
}

fn has_symbol_use(walk: &ScopeWalk, function: WalkedFunctionId, symbol: SymbolId) -> bool {
    has_use(walk, function, BindingRef::Symbol(symbol))
}

fn slots_used_by(walk: &ScopeWalk, function: WalkedFunctionId) -> Vec<(ScopeId, ScopeSlot)> {
    let uses = walk.uses.iter().filter(|entry| entry.0 == function);
    let slots = uses.filter_map(|entry| match entry.1 {
        BindingRef::Slot(scope, slot) => Some((scope, slot)),
        BindingRef::Symbol(_) => None,
    });
    slots.collect()
}

fn used_slots(walk: &ScopeWalk) -> Vec<ScopeSlot> {
    let slots = walk.uses.iter().filter_map(|entry| match entry.1 {
        BindingRef::Slot(_, slot) => Some(slot),
        BindingRef::Symbol(_) => None,
    });
    slots.collect()
}

fn is_commonjs_slot(slot: ScopeSlot) -> bool {
    matches!(slot, ScopeSlot::CommonJs(_))
}

fn stored_in_loop(walk: &ScopeWalk, statement: StmtId) -> &[BindingRef] {
    let mut loops = walk.loops.iter();
    let found = loops.find(|walked_loop| walked_loop.statement == statement);
    &found.expect("the walk met the loop").stored
}

fn member_of(bound: &Bound<'_>, function: FnId) -> MemberId {
    let FnOwner::Member(member) = bound.fns[function.idx()].owner else {
        panic!("the function is a class member");
    };
    member
}
