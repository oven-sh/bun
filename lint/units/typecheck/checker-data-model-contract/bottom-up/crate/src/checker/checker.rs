// What every ported function uses: the sinks for faults and stand-ins, the fallback values, the lists and the link accessors. Ported methods take `&mut self`. An upstream free function that reads records takes `c: &Checker` first.
pub use crate::checker::c02_checker_generated::Checker;

use crate::checker::arena::{ListItem, LiveItem};
use crate::checker::c01_data::{FlowType, Relation, RelationKind};
use crate::checker::c30_type_keys::CacheHashKey;
use crate::checker::flags_generated::{RelationComparisonResult, TypeFacts};
use crate::checker::types::{Ternary, ValueSymbolLinks};
use crate::tscore::golang::{List, LiveList, SliceBuf, Text};
use crate::tscore::ids::{
    DiagnosticId, NodeId, SignatureId, SymbolId, SymbolTableId, TypeAliasId, TypeId, TypeMapperId,
    TypePredicateId,
};
use crate::tscore::internal::FaultKind;
use crate::tscore::linkstore::Link;

// checker.go 901: a deferred diagnostic is run once, by produceDeferredDiagnostics.
pub type DeferredDiagnosticCallback<'a> = Box<dyn FnOnce(&mut Checker<'a>) + 'a>;

// The value that replaces the result of a function that upstream leaves through a panic, of a stand-in and of a cut recursion.
pub trait Fallback<'a>: Sized {
    fn fallback(c: &Checker<'a>) -> Self;
}

macro_rules! fallback_default {
    ($($ty:ty),* $(,)?) => {$(
        impl<'a> Fallback<'a> for $ty {
            fn fallback(_: &Checker<'a>) -> Self {
                <$ty>::default()
            }
        }
    )*};
}

// Nil, false, zero and the empty text.
fallback_default!(
    (),
    bool,
    isize,
    i32,
    u32,
    SymbolId,
    SymbolTableId,
    NodeId,
    TypeMapperId,
    TypeAliasId,
    DiagnosticId,
    CacheHashKey,
    RelationComparisonResult,
    TypePredicateId,
    TypeFacts,
);

impl<'a> Fallback<'a> for TypeId {
    fn fallback(c: &Checker<'a>) -> Self {
        c.error_type
    }
}
impl<'a> Fallback<'a> for SignatureId {
    fn fallback(c: &Checker<'a>) -> Self {
        c.unknown_signature
    }
}
impl<'a> Fallback<'a> for Ternary {
    fn fallback(_: &Checker<'a>) -> Self {
        Ternary::FALSE
    }
}
impl<'a> Fallback<'a> for FlowType {
    fn fallback(c: &Checker<'a>) -> Self {
        FlowType {
            t: c.error_type,
            incomplete: false,
        }
    }
}
impl<'a> Fallback<'a> for Text<'a> {
    fn fallback(_: &Checker<'a>) -> Self {
        b""
    }
}
impl<'a, T: Copy + Default> Fallback<'a> for List<'a, T> {
    fn fallback(_: &Checker<'a>) -> Self {
        Self::NIL
    }
}
impl<'a, T> Fallback<'a> for Option<T> {
    fn fallback(_: &Checker<'a>) -> Self {
        None
    }
}
impl<'a, A: Fallback<'a>, B: Fallback<'a>> Fallback<'a> for (A, B) {
    fn fallback(c: &Checker<'a>) -> Self {
        (A::fallback(c), B::fallback(c))
    }
}

impl<'a> Checker<'a> {
    fn record(&self, kind: FaultKind, message: &'static str, detail: u32) {
        self.ast.fault(kind, message, detail, self.current_node.0);
    }
    // panic("message")
    pub fn fail<T: Fallback<'a>>(&self, message: &'static str) -> T {
        self.fail_detail(message, 0)
    }
    // panic("message" + x.String())
    pub fn fail_detail<T: Fallback<'a>>(&self, message: &'static str, detail: u32) -> T {
        self.record(FaultKind::Panic, message, detail);
        T::fallback(self)
    }
    // debug.Assert(value, "message")
    pub fn assert(&self, value: bool, message: &'static str) {
        if !value {
            self.record(FaultKind::Assert, message, 0);
        }
    }
    // A failed type assertion or a cast to a data type that the value does not have.
    pub fn bad_cast(&self, message: &'static str) {
        self.record(FaultKind::BadCast, message, 0);
    }
    // The whole body of a function that is not ported yet.
    pub fn stand_in<T: Fallback<'a>>(&self, name: &'static str) -> T {
        self.stand_ins.record(name);
        T::fallback(self)
    }
    // `m[k] = v` on a map that can be nil.
    pub fn map_set(&self, ok: bool) {
        if !ok {
            self.record(FaultKind::NilMapWrite, "assignment to entry in nil map", 0);
        }
    }
    // `x[i] = v` with an index that can be out of range.
    pub fn slice_set(&self, ok: bool) {
        if !ok {
            self.record(FaultKind::Panic, "index out of range", 0);
        }
    }
    // What a recursion hub returns when the thread has no stack left.
    pub fn stack_limit<T: Fallback<'a>>(&self) -> T {
        self.record(FaultKind::StackLimit, "stack limit reached", 0);
        T::fallback(self)
    }
    // A loop over checker state spent its budget: the caller leaves it as upstream's `break` does.
    pub fn loop_limit(&self, function: &'static str) {
        self.record(FaultKind::LoopLimit, function, 0);
    }
    // Everything that upstream would have died of: recorded faults plus reads and writes through nil in the stores.
    pub fn internal_fault_count(&self) -> u32 {
        let nil = self.types.nil_accesses()
            + self.signatures.nil_accesses()
            + self.index_infos.nil_accesses()
            + self.type_mappers.nil_accesses()
            + self.type_aliases.nil_accesses()
            + self.type_predicates.nil_accesses()
            + self.conditional_roots.nil_accesses()
            + self.composite_signatures.nil_accesses()
            + self.widening_contexts.nil_accesses()
            + self.inference_contexts.nil_accesses()
            + self.inference_infos.nil_accesses()
            + self.inference_states.nil_accesses()
            + self.relaters.nil_accesses()
            + self.flow_states.nil_accesses();
        self.ast.open().faults.count().saturating_add(nil)
    }

    // A `[]T` that leaves the function: frozen once, where upstream's slice first escapes. Nil stays nil.
    pub fn list<T: ListItem<'a>>(&self, buf: &SliceBuf<T>) -> List<'a, T> {
        if buf.is_nil() {
            return List::NIL;
        }
        List::from_slice(self.lists.alloc_slice_copy(&buf.items))
    }
    // `[]T{a, b}`
    pub fn list_of<T: ListItem<'a>>(&self, items: &[T]) -> List<'a, T> {
        List::from_slice(self.lists.alloc_slice_copy(items))
    }
    // slices.Clone: nil stays nil, the copy has its own identity.
    pub fn clone_list<T: ListItem<'a>>(&self, list: List<'_, T>) -> List<'a, T> {
        if list.is_nil() {
            return List::NIL;
        }
        List::from_slice(self.lists.alloc_slice_copy(list.as_slice()))
    }
    // A slice that upstream writes after it shared it.
    pub fn live_list<T: LiveItem<'a>>(&self, items: &[T]) -> LiveList<'a, T> {
        LiveList::from_cells(self.lists.alloc_cells(items))
    }
    pub fn text(&self, bytes: &[u8]) -> Text<'a> {
        self.lists.alloc_bytes(bytes)
    }

    // symbolArenaLinkStore.Get (links.go 33): the store is keyed by ast.GetSymbolId, so the access assigns the lazy id.
    pub fn value_symbol_links_get(&mut self, symbol: SymbolId) -> Link<ValueSymbolLinks> {
        let _ = self.ast.get_symbol_id(symbol);
        self.value_symbol_links.get(symbol)
    }
    // symbolArenaLinkStore.TryGet (links.go 45): assigns the lazy id too. The nil link when there are no links.
    pub fn value_symbol_links_try_get(&self, symbol: SymbolId) -> Link<ValueSymbolLinks> {
        let _ = self.ast.get_symbol_id(symbol);
        self.value_symbol_links.try_get(symbol)
    }
    // symbolArenaLinkStore.Has (links.go 41)
    pub fn value_symbol_links_has(&self, symbol: SymbolId) -> bool {
        !self.value_symbol_links_try_get(symbol).is_nil()
    }

    // `*Relation` behind the pointer comparison. None and a recorded fault for the nil relation.
    pub fn relation(&self, kind: RelationKind) -> Option<&Relation> {
        match kind {
            RelationKind::Nil => {
                self.record(FaultKind::NilRead, "nil Relation", 0);
                None
            }
            RelationKind::Subtype => Some(&self.subtype_relation),
            RelationKind::StrictSubtype => Some(&self.strict_subtype_relation),
            RelationKind::Assignable => Some(&self.assignable_relation),
            RelationKind::Comparable => Some(&self.comparable_relation),
            RelationKind::Identity => Some(&self.identity_relation),
        }
    }
    pub fn relation_mut(&mut self, kind: RelationKind) -> Option<&mut Relation> {
        match kind {
            RelationKind::Nil => {
                self.record(FaultKind::NilWrite, "nil Relation", 0);
                None
            }
            RelationKind::Subtype => Some(&mut self.subtype_relation),
            RelationKind::StrictSubtype => Some(&mut self.strict_subtype_relation),
            RelationKind::Assignable => Some(&mut self.assignable_relation),
            RelationKind::Comparable => Some(&mut self.comparable_relation),
            RelationKind::Identity => Some(&mut self.identity_relation),
        }
    }
}
