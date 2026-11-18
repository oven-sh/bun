//! What the entries of the metadata of a code block look like. All zeros is the initial state of each.

mod access;
mod predictions;

use core::cell::Cell;
use core::ops::Deref;

use super::profile::{ArithmeticProfile, ArrayProfile, ValueProfile};
use crate::heap::{Allocator, Survivors};
use crate::ic::{AccessCases, CallProfile, LoadCache, StoreCache};
use crate::{ArrayAllocationProfile, CodeBlock, Environment, Gc, JsCell, ShapeId, Visitor, Vm};

pub use access::Entries;
pub(super) use access::{SideTables, reconcile_weak_references, visit, visit_transitions};

/// # Safety
/// All zeros is a value, and the size is that of the kinds of entries that it is used for.
pub unsafe trait Entry {
    fn visit(&self, _: &mut Visitor) {}

    /// Marks the targets of transitions from shapes that are marked.
    fn visit_transitions(&self, _: &mut Visitor) {}

    fn reconcile(&self, _: &CodeBlock, _: &Survivors) {}

    /// Frees what it owns.
    fn release(&self) {}
}

/// The address of a cell that is not kept alive, or a number below `SPECIAL_LIMIT`.
#[repr(transparent)]
pub struct WeakCell(Cell<usize>);

impl WeakCell {
    pub const NONE: usize = 0;
    /// More than one has been seen.
    pub const MANY: usize = 1;
    pub(crate) const SPECIAL_LIMIT: usize = 512;

    #[inline(always)]
    pub fn bits(&self) -> usize {
        self.0.get()
    }

    pub fn get(&self) -> Option<Gc<JsCell>> {
        // SAFETY: cleared when a collection finds the cell dead.
        (self.bits() >= Self::SPECIAL_LIMIT).then(|| unsafe { Gc::from_address(self.bits()) })
    }

    pub fn set(&self, owner: &CodeBlock, cell: &JsCell) {
        self.0.set(cell.address());
        owner.write_barrier_for_cell();
    }

    /// While the owner is being reconciled, before `clear_if_dead`.
    pub(crate) fn set_unbarriered(&self, cell: &JsCell) {
        self.0.set(cell.address());
    }

    pub fn set_special(&self, value: usize) {
        assert!(value < Self::SPECIAL_LIMIT);
        self.0.set(value);
    }

    #[inline(always)]
    pub fn record(&self, owner: &CodeBlock, cell: &JsCell) {
        match self.bits() {
            Self::NONE => self.set(owner, cell),
            seen if seen != cell.address() => self.0.set(Self::MANY),
            _ => {}
        }
    }

    /// Whether it died.
    pub fn clear_if_dead(&self, survivors: &Survivors) -> bool {
        let is_dead = self.get().is_some_and(|cell| !survivors.contains(cell));
        if is_dead {
            self.0.set(Self::NONE);
        }
        is_dead
    }
}

#[repr(C, align(8))]
pub struct Flags(pub Cell<u32>);

impl Flags {
    #[inline(always)]
    pub fn record(&self, seen: u32) {
        self.0.set(self.0.get() | seen);
    }
}

#[repr(transparent)]
pub struct Counter(pub Cell<u64>);

#[repr(C)]
pub struct CasesAndValue {
    pub value: ValueProfile,
    pub cases: AccessCases,
}

#[repr(C)]
pub struct GetById {
    pub value: ValueProfile,
    pub cache: LoadCache,
}

#[repr(C)]
pub struct GetLength {
    pub value: ValueProfile,
    pub cache: LoadCache,
    pub array: ArrayProfile,
}

#[repr(C)]
pub struct GetByVal {
    pub value: ValueProfile,
    pub access: ArrayAccess,
}

impl Deref for GetByVal {
    type Target = ArrayAccess;

    #[inline(always)]
    fn deref(&self) -> &ArrayAccess {
        &self.access
    }
}

#[repr(C)]
pub struct ArrayAccess {
    pub array: ArrayProfile,
    pub cases: AccessCases,
}

/// What an object with the first shape gets for the prototype of the second.
#[repr(C, align(8))]
pub struct SetPrototype {
    pub from: Cell<ShapeId>,
    pub to: Cell<ShapeId>,
}

/// The inline case is for the name in `name`.
#[repr(C)]
pub struct GetPrivateName {
    pub value: ValueProfile,
    pub cache: LoadCache,
    pub name: WeakCell,
}

#[repr(C)]
pub struct PutPrivateName {
    pub cache: StoreCache,
    pub name: WeakCell,
}

/// Without a shape `pointer` is the address of a `GlobalBinding`, with one it is that of the global object. Without
/// either the offset can tell the `Vm::prototype_chain_epoch` in which the name was found to be no binding. Without a
/// pointer, the shape is that of the global object, tagged with what the slot has.
#[repr(C)]
pub struct GlobalAccess {
    pub shape: Cell<ShapeId>,
    pub byte_offset: Cell<i32>,
    pub pointer: Cell<usize>,
}

impl GlobalAccess {
    /// In place of the offset.
    pub(crate) const NO_EPOCH: i32 = 1;
    pub const CUSTOM_VALUE_TAG: u32 = 4;
    pub const CUSTOM_ACCESSOR_TAG: u32 = 8;

    pub fn has_run(&self) -> bool {
        self.byte_offset.get() != 0 || self.pointer.get() != 0
    }

    #[inline(always)]
    pub(crate) fn untagged_shape(&self) -> ShapeId {
        let tags = Self::CUSTOM_VALUE_TAG | Self::CUSTOM_ACCESSOR_TAG;
        const { assert!(ShapeId::LAST_BITS & (Self::CUSTOM_VALUE_TAG | Self::CUSTOM_ACCESSOR_TAG) == 0) };
        ShapeId::from_bits(self.shape.get().bits() & !tags)
    }
}

#[repr(C)]
pub struct GetGlobal {
    pub value: ValueProfile,
    pub access: GlobalAccess,
}

#[repr(C)]
pub struct GetImport {
    pub value: ValueProfile,
    /// The address of the slot, in an environment that the module keeps alive.
    pub slot: Cell<usize>,
    /// If the address `VARIES`: one more than the index of the slot that has been read last.
    pub environment: Cell<usize>,
}

impl GetImport {
    /// The environment that has the value, and the index of its slot.
    pub fn target(&self, _: &Vm) -> Option<(Gc<Environment>, u32)> {
        let environment = self.environment.get();
        let offset = self.slot.get().wrapping_sub(environment);
        let index = (offset.wrapping_sub(Environment::OFFSET_OF_SLOTS) / size_of::<u64>()) as u32;
        // SAFETY: cleared when it dies.
        (self.slot.get() > Self::VARIES).then(|| (unsafe { Gc::from_address(environment) }, index))
    }

    pub fn varies(&self) -> bool {
        self.slot.get() == Self::VARIES
    }

    pub fn note_variation(&self, index: Option<u32>) {
        self.slot.set(Self::VARIES);
        (self.environment).set(index.map_or(0, |it| it as usize + 1));
    }

    /// Of the slot in the other environment, if the address varies.
    pub fn likely_index(&self) -> Option<u32> {
        let index = self.environment.get().checked_sub(1)?;
        self.varies().then_some(index as u32)
    }

    /// In place of an address: the code runs in several instances of the module.
    pub const VARIES: usize = 1;
}

#[repr(C)]
pub struct ResolveDynamic {
    /// While `Vm::eval_variables_epoch` is this, `depth` tells the holder.
    pub epoch: Cell<u32>,
    /// How many parents up it is, or one of the constants.
    pub depth: Cell<u32>,
    /// `depth` also holds if the one object for variables of `eval` code on the way has this shape, or if there is none
    /// and it is not the holder.
    pub shape: Cell<ShapeId>,
    pub variables_depth: Cell<u16>,
    pub variables_slot: Cell<u16>,
}

impl ResolveDynamic {
    pub const GLOBAL: u32 = u32::MAX;
    pub const VARIABLES: u32 = u32::MAX - 1;
    /// In place of a slot: there is a `with` scope on the way, and `depth` is where a search ends at the latest.
    pub const PASSES_WITH: u16 = u16::MAX;
}

#[repr(C)]
pub struct Call {
    pub value: ValueProfile,
    pub profile: CallProfile,
}

#[repr(C)]
pub struct SuperConstruct {
    pub call: Call,
    pub new_target: WeakCell,
}

#[repr(C)]
pub struct ToThis {
    pub value: ValueProfile,
}

#[repr(C)]
pub struct NewObject {
    pub shape: Cell<ShapeId>,
    pub inline_capacity: Cell<u32>,
    /// Null if the object needs more than a cell.
    pub allocator: Cell<*const Allocator>,
}

/// What its owner makes of it.
#[repr(transparent)]
pub struct Word(pub Cell<u64>);

/// The address of the count to increment. Set before the code runs.
#[repr(transparent)]
pub struct Cover(Cell<*const Cell<u64>>);

impl Cover {
    /// # Safety
    /// `count` outlives the entry.
    pub(super) unsafe fn link(&self, count: &Cell<u64>) {
        self.0.set(count);
    }

    #[inline(always)]
    pub fn count(&self) -> &Cell<u64> {
        // SAFETY: an entry is only seen once its code block is linked.
        unsafe { &*self.0.get() }
    }
}

#[repr(C)]
pub struct NewArrayWithSpecies {
    pub value: ValueProfile,
    pub allocation: ArrayAllocationProfile,
    pub array: ArrayProfile,
}

#[repr(C)]
pub struct ForIn {
    pub modes: Flags,
    pub access: ArrayAccess,
}

impl Deref for ForIn {
    type Target = ArrayAccess;

    #[inline(always)]
    fn deref(&self) -> &ArrayAccess {
        &self.access
    }
}

#[repr(C)]
pub struct ForInGet {
    pub value: ValueProfile,
    pub for_in: ForIn,
}

#[repr(C)]
pub struct IteratorNext {
    pub value: ValueProfile,
    pub modes: Flags,
    pub array: ArrayProfile,
}

macro_rules! entries {
    ($($type:ty { $($part:ident)* })*) => {$(
        // SAFETY: made of parts that are.
        unsafe impl Entry for $type {
            #[inline]
            #[allow(unused_variables)]
            fn visit(&self, visitor: &mut Visitor) {
                $(self.$part.visit(visitor);)*
            }

            #[inline]
            #[allow(unused_variables)]
            fn visit_transitions(&self, visitor: &mut Visitor) {
                $(self.$part.visit_transitions(visitor);)*
            }

            #[inline]
            #[allow(unused_variables)]
            fn reconcile(&self, owner: &CodeBlock, survivors: &Survivors) {
                $(self.$part.reconcile(owner, survivors);)*
            }

            #[inline]
            fn release(&self) {
                $(self.$part.release();)*
            }
        }
    )*};
}

entries! {
    ValueProfile {}
    ArithmeticProfile {}
    Flags {}
    Counter {}
    Word {}
    Cover {}
    CasesAndValue { cases }
    GetById { cache }
    GetLength { cache array }
    GetByVal { access }
    ArrayAccess { array cases }
    GetGlobal { access }
    Call { profile }
    SuperConstruct { call new_target }
    ToThis {}
    NewArrayWithSpecies { allocation array }
    ForIn { access }
    ForInGet { for_in }
    IteratorNext { array }
}

// SAFETY: integers.
unsafe impl Entry for WeakCell {
    fn reconcile(&self, _: &CodeBlock, survivors: &Survivors) {
        self.clear_if_dead(survivors);
    }
}

// SAFETY: integers.
unsafe impl Entry for ArrayProfile {
    fn reconcile(&self, _: &CodeBlock, _: &Survivors) {
        self.update();
    }
}

// SAFETY: integers.
unsafe impl Entry for GlobalAccess {
    fn reconcile(&self, _: &CodeBlock, survivors: &Survivors) {
        if !self.shape.get().is_none() && !survivors.contains_shape(self.untagged_shape()) {
            self.shape.set(ShapeId::NONE);
            self.pointer.set(0);
        }
        if self.shape.get().is_none() && self.byte_offset.get() != 0 {
            self.byte_offset.set(Self::NO_EPOCH);
        }
    }
}

// SAFETY: integers.
unsafe impl Entry for GetImport {
    fn reconcile(&self, _: &CodeBlock, survivors: &Survivors) {
        if self.slot.get() > Self::VARIES && !survivors.contains_address(self.environment.get()) {
            self.environment.set(0);
            self.slot.set(0);
        }
    }
}

// SAFETY: integers.
unsafe impl Entry for ResolveDynamic {
    fn reconcile(&self, _: &CodeBlock, survivors: &Survivors) {
        if !self.shape.get().is_none() && !survivors.contains_shape(self.shape.get()) {
            self.shape.set(ShapeId::NONE);
        }
    }
}

// SAFETY: made of parts that are.
unsafe impl Entry for GetPrivateName {
    fn visit(&self, visitor: &mut Visitor) {
        self.cache.visit(visitor);
    }

    fn reconcile(&self, owner: &CodeBlock, survivors: &Survivors) {
        if self.name.clear_if_dead(survivors) {
            self.cache.reset();
        }
        self.cache.reconcile_with_variable_key(owner, survivors);
    }

    fn release(&self) {
        self.cache.release();
    }
}

// SAFETY: as above.
unsafe impl Entry for PutPrivateName {
    fn visit(&self, visitor: &mut Visitor) {
        self.cache.visit(visitor);
    }

    fn visit_transitions(&self, visitor: &mut Visitor) {
        self.cache.visit_transitions(visitor);
    }

    fn reconcile(&self, owner: &CodeBlock, survivors: &Survivors) {
        if self.name.clear_if_dead(survivors) {
            self.cache.reset();
        }
        self.cache.reconcile_with_variable_key(owner, survivors);
    }

    fn release(&self) {
        self.cache.release();
    }
}

// SAFETY: integers and a pointer.
unsafe impl Entry for NewObject {
    fn visit(&self, visitor: &mut Visitor) {
        if !self.shape.get().is_none() {
            visitor.append_shape(self.shape.get());
        }
    }
}

// SAFETY: an integer.
unsafe impl Entry for ArrayAllocationProfile {
    fn reconcile(&self, _: &CodeBlock, _: &Survivors) {
        // SAFETY: a code block that has run since the last collection is reconciled.
        unsafe { self.update() };
    }
}

/// Kept alive.
#[repr(transparent)]
pub struct StrongCell(pub crate::Field<Option<Gc<JsCell>>>);

// SAFETY: zero is `None`.
unsafe impl Entry for StrongCell {
    fn visit(&self, visitor: &mut Visitor) {
        crate::Trace::trace(&self.0, visitor);
    }
}
