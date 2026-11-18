use core::cell::Cell;
use core::mem::offset_of;
use core::ptr::NonNull;

use bun_engine_text::StringImpl;

use super::{PrototypeLookup, is_live, slot_at};
use crate::heap::{Allocator, Survivors};
use crate::{
    CellType, CustomGetterSetter, Gc, GetterSetter, JsObject, PropertyOffset, ShapeId, Value, Vm,
};

macro_rules! access_kinds {
    ($($(#[$doc:meta])* $name:ident,)*) => {
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        #[repr(u8)]
        pub enum AccessKind {
            $($(#[$doc])* $name,)*
        }

        impl AccessKind {
            pub const ALL: [AccessKind; [$(stringify!($name),)*].len()] = [$(AccessKind::$name,)*];
        }
    };
}

access_kinds! {
    /// What follows the cases: the slow path, which may add one.
    End,
    /// The cache of the `Vm`.
    Megamorphic,
    /// The slow path, which has given up on caching.
    Generic,

    // The answer is the same for as long as the lookup is valid, if there is one.

    /// The constant of the lookup.
    LoadConstant,
    /// `__proto__`, which is the prototype of the shape.
    LoadPrototype,
    HasOwn,
    HasInherited,
    HasNot,
    DeleteMissing,
    /// The prototype that is looked for takes the place of the key.
    Instanceof,

    LoadOwn,
    /// The slot of the holder of the lookup.
    LoadInherited,
    ArrayLength,
    StringLength,
    /// Of `MappedArguments`, unless it has become an ordinary property.
    ArgumentsLength,
    /// What the getter of the library returns, while the lookup is valid. The length of the buffer is fixed. `operand`
    /// is the logarithm of the size of an element.
    TypedArrayLength,
    TypedArrayByteLength,
    TypedArrayByteOffset,
    DataViewByteLength,
    /// The same, where it is not.
    ResizableTypedArrayLength,
    ResizableTypedArrayByteLength,
    ResizableTypedArrayByteOffset,
    /// Of a `Map` or a `Set`.
    CollectionSize,
    /// `operand` has the bit of the flag.
    RegExpFlag,
    /// What the receiver has `operand` bytes from its start. If that is empty, as `CallCustomAccessorGetter`.
    LoadKeptResult,
    /// `pointer` is the address of the slot. No other namespace has the shape.
    LoadModuleBinding,
    Replace,
    Transition,
    TransitionAndGrow,
    SetArrayLength,
    Delete,
    /// Unless `Vm::deletes_unconfigurable_properties`.
    DeleteNonConfigurable,
    /// `inner_kind` tells what is done with the target, which has `new_shape`.
    ThroughGlobalProxy,
    /// Only as such: `pointer` is the address of the `GlobalBinding`.
    LoadGlobalBinding,
    StoreGlobalBinding,

    // These call out.

    CallOwnGetter,
    /// `pointer` is the function, if that stays the same and has an executable.
    CallInheritedGetter,
    /// `pointer` is the function. It gets the receiver.
    CallCustomAccessorGetter,
    /// It gets the holder of the lookup, or the object itself if there is no lookup.
    CallCustomValueGetter,
    /// That of the `CustomGetterSetter` in the slot of the object, which is not the same for all that have the shape.
    CallCustomGetterInSlot,
    CallOwnSetter,
    CallInheritedSetter,
    CallCustomAccessorSetter,
    CallCustomValueSetter,
    CallCustomSetterInSlot,
    /// For any key. Unless that is private, compiled code calls `private_proxy_get`, and so on. `pointer` is the string
    /// or symbol for a key that is fixed.
    ProxyGet,
    /// `operand` tells whether the code is strict.
    ProxySet,
    ProxyHas,
    /// Only for compiled code, which has a `caches::LoadEntry` for the case.
    CallMegamorphicAccessor,
}

impl AccessKind {
    pub const FIRST_THAT_CALLS: AccessKind = AccessKind::CallOwnGetter;

    pub const fn is_last(self) -> bool {
        self as u8 <= AccessKind::Generic as u8
    }

    pub const fn has_answer(self) -> bool {
        !self.is_last() && self as u8 <= AccessKind::Instanceof as u8
    }

    pub(super) fn is_plain(self) -> bool {
        use AccessKind::*;
        matches!(
            self,
            LoadConstant | LoadOwn | LoadInherited | Replace | Transition | TransitionAndGrow
        )
    }

    pub(super) fn is_for_any_key(self) -> bool {
        matches!(
            self,
            AccessKind::ProxyGet | AccessKind::ProxySet | AccessKind::ProxyHas
        )
    }
}

/// Whether the name is a part of the instruction.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Key {
    Fixed,
    Variable,
}

/// One way in which an access has gone. One that is in a list can change or go whenever the list can.
#[derive(Clone)]
#[repr(C)]
pub struct AccessCase {
    /// Of the slot of `LoadOwn`, `Replace` and `Transition`. Zero for the other kinds, which have theirs in `pointer`.
    plain_offset: Cell<i32>,
    /// The new shape, or the `Vm::lookup_epoch` in which the answer was last found to hold. That is odd.
    shape_or_epoch: Cell<u32>,
    shape: Cell<ShapeId>,
    kind: Cell<AccessKind>,
    /// How often it was the one that applied when the site took samples.
    pub(super) votes: Cell<u8>,
    operand: Cell<u16>,
    /// Kept alive. Zero if there is none.
    lookup: Cell<usize>,
    /// The bits of the answer, the epoch of a `Transition`, or what the kind says.
    pointer: Cell<usize>,
    /// The address of the name for `Key::Variable`, of which the list holds a count.
    pub(super) key: Cell<usize>,
}

impl AccessCase {
    pub const OFFSET_OF_PLAIN_OFFSET: usize = offset_of!(AccessCase, plain_offset);
    pub const OFFSET_OF_SHAPE_OR_EPOCH: usize = offset_of!(AccessCase, shape_or_epoch);
    pub const OFFSET_OF_KIND: usize = offset_of!(AccessCase, kind);
    pub const OFFSET_OF_OPERAND: usize = offset_of!(AccessCase, operand);
    pub const OFFSET_OF_LOOKUP: usize = offset_of!(AccessCase, lookup);
    pub const OFFSET_OF_POINTER: usize = offset_of!(AccessCase, pointer);
    pub const OFFSET_OF_KEY: usize = offset_of!(AccessCase, key);

    /// In the operand of a call of native code: it gets the object, in the realm of the code block.
    pub(super) const IS_PLAIN_CALL: u16 = 1;
    /// In that of `CallCustomGetterInSlot`: it gets the object, whatever the receiver is.
    pub const IS_CUSTOM_VALUE: u16 = 2;

    #[inline(always)]
    pub(super) fn new(kind: AccessKind, shape: ShapeId) -> AccessCase {
        AccessCase {
            plain_offset: Cell::new(0),
            shape_or_epoch: Cell::new(0),
            shape: Cell::new(shape),
            kind: Cell::new(kind),
            votes: Cell::new(0),
            operand: Cell::new(0),
            lookup: Cell::new(0),
            pointer: Cell::new(0),
            key: Cell::new(0),
        }
    }

    /// Panics if the kind reads the slot of the holder, and there is none.
    #[inline(always)]
    pub(super) fn with_lookup(self, lookup: Gc<PrototypeLookup>) -> AccessCase {
        use AccessKind::{CallInheritedGetter, CallInheritedSetter, LoadInherited};
        let kind = self.kind();
        assert!(
            lookup.has_slot()
                || !matches!(
                    kind,
                    LoadInherited | CallInheritedGetter | CallInheritedSetter
                )
        );
        self.lookup.set(lookup.address());
        self
    }

    #[inline(always)]
    pub(super) fn with_byte_offset(self, byte_offset: i32) -> AccessCase {
        match self.kind() {
            AccessKind::LoadOwn | AccessKind::Replace | AccessKind::Transition => {
                self.plain_offset.set(byte_offset);
            }
            _ => self.pointer.set(byte_offset as usize),
        }
        self
    }

    /// Panics unless it is valid.
    #[inline(always)]
    pub(super) fn with_offset(self, offset: PropertyOffset) -> AccessCase {
        assert!(offset.is_valid());
        self.with_byte_offset(offset.byte_offset() as i32)
    }

    #[inline(always)]
    pub(super) fn with_new_shape(self, shape: ShapeId) -> AccessCase {
        self.shape_or_epoch.set(shape.bits());
        self
    }

    #[inline(always)]
    pub(super) fn with_pointer(self, pointer: usize) -> AccessCase {
        self.pointer.set(pointer);
        self
    }

    #[inline(always)]
    pub(super) fn with_answer(self, answer: impl Into<Value>) -> AccessCase {
        debug_assert!(self.kind().has_answer());
        self.with_pointer(answer.into().to_bits() as usize)
    }

    #[inline(always)]
    pub(super) fn with_prototype(self, prototype: &JsObject) -> AccessCase {
        debug_assert!(self.kind() == AccessKind::Instanceof);
        self.key.set(prototype.address());
        self
    }

    #[inline(always)]
    pub(super) fn with_operand(self, operand: u16) -> AccessCase {
        self.operand.set(operand);
        self
    }

    /// For `TransitionAndGrow`. Without an allocator for the new storage only the slow path does it.
    #[inline(always)]
    pub(super) fn with_growth(self, capacity: u16, allocator: Option<&Allocator>) -> AccessCase {
        let address = allocator.map_or(0, |it| core::ptr::from_ref(it).expose_provenance());
        self.with_operand(capacity).with_pointer(address)
    }

    /// Of a case for the target.
    #[inline(always)]
    pub(super) fn through_global_proxy(self, proxy: ShapeId) -> AccessCase {
        use AccessKind::{CallCustomGetterInSlot, CallCustomSetterInSlot};
        debug_assert!(!matches!(
            self.kind(),
            CallCustomGetterInSlot | CallCustomSetterInSlot
        ));
        let case = AccessCase::new(AccessKind::ThroughGlobalProxy, proxy);
        case.lookup.set(self.lookup.get());
        (case
            .with_new_shape(self.shape())
            .with_operand(self.kind() as u16))
        .with_pointer(match self.plain_offset() {
            0 => self.pointer(),
            offset => offset as usize,
        })
    }

    /// What `ThroughGlobalProxy` stands for.
    #[inline(always)]
    pub(super) fn for_target(&self) -> AccessCase {
        let case = AccessCase::new(self.inner_kind(), self.new_shape());
        case.lookup.set(self.lookup.get());
        match case.kind() {
            AccessKind::LoadOwn | AccessKind::Replace => {
                case.plain_offset.set(self.pointer() as i32)
            }
            _ => case.pointer.set(self.pointer()),
        }
        case
    }

    #[inline(always)]
    pub fn kind(&self) -> AccessKind {
        self.kind.get()
    }

    /// Of `ThroughGlobalProxy`.
    #[inline(always)]
    pub fn inner_kind(&self) -> AccessKind {
        debug_assert!(self.kind() == AccessKind::ThroughGlobalProxy);
        AccessKind::ALL[usize::from(self.operand())]
    }

    #[inline(always)]
    pub fn shape(&self) -> ShapeId {
        self.shape.get()
    }

    #[inline(always)]
    pub fn new_shape(&self) -> ShapeId {
        if self.kind().has_answer() {
            ShapeId::NONE
        } else {
            ShapeId::from_bits(self.shape_or_epoch.get())
        }
    }

    #[inline(always)]
    pub fn plain_offset(&self) -> i32 {
        self.plain_offset.get()
    }

    /// Of a kind that has a slot in the object.
    #[inline(always)]
    pub fn byte_offset(&self) -> i32 {
        if self.plain_offset() != 0 {
            self.plain_offset()
        } else if self.kind() == AccessKind::TransitionAndGrow {
            let first_new = PropertyOffset::FIRST_OUT_OF_LINE + i32::from(self.operand());
            PropertyOffset::new(first_new).byte_offset() as i32
        } else {
            self.pointer() as i32
        }
    }

    #[inline(always)]
    pub fn pointer(&self) -> usize {
        self.pointer.get()
    }

    #[inline(always)]
    pub fn operand(&self) -> u16 {
        self.operand.get()
    }

    #[inline(always)]
    pub fn lookup(&self) -> Option<Gc<PrototypeLookup>> {
        let address = self.lookup.get();
        // SAFETY: visited with the code block.
        (address != 0).then(|| unsafe { Gc::from_address(address) })
    }

    #[inline(always)]
    pub(super) fn kept_alive(&self) -> u64 {
        if self.kind().is_for_any_key() {
            self.pointer() as u64
        } else {
            self.lookup.get() as u64
        }
    }

    #[inline(always)]
    pub fn is_valid(&self) -> bool {
        self.lookup().is_none_or(|lookup| lookup.is_valid())
    }

    /// The bits of the answer, if that is known to hold without a look at the lookup.
    #[inline(always)]
    pub fn current_answer(&self, vm: &Vm) -> Option<u64> {
        (self.shape_or_epoch.get() == vm.lookup_epoch()).then(|| self.pointer() as u64)
    }

    /// If the kind has one and it holds.
    #[inline(always)]
    pub fn answer(&self) -> Option<Value> {
        // SAFETY: no cell, the prototype of the shape, or the constant of a lookup that is valid.
        (self.kind().has_answer() && self.is_valid())
            .then(|| unsafe { Value::from_bits(self.pointer() as u64) })
    }

    /// The same, for a slow path, which sees to it that the fast one is taken next time.
    #[inline(always)]
    pub(super) fn renewed_answer(&self, vm: &Vm) -> Option<Value> {
        let answer = self.answer()?;
        self.shape_or_epoch.set(vm.lookup_epoch_to_record());
        Some(answer)
    }

    /// Whether a `Transition` is known to hold without a look at the lookup.
    #[inline(always)]
    pub fn is_current_transition(&self, vm: &Vm) -> bool {
        self.pointer() as u32 == vm.lookup_epoch()
    }

    /// It is valid.
    #[inline(always)]
    pub(super) fn renew(&self, vm: &Vm) {
        if self.kind().has_answer() {
            self.shape_or_epoch.set(vm.lookup_epoch_to_record());
        } else if self.kind() == AccessKind::Transition {
            self.pointer.set(vm.lookup_epoch_to_record() as usize);
        }
    }

    /// Field by field, because it has just been put together that way.
    ///
    /// # Safety
    /// As for `ptr::write`.
    #[inline(always)]
    pub(super) unsafe fn write_to(&self, target: *mut AccessCase) {
        macro_rules! copy {
            ($($field:ident)*) => {
                let AccessCase { $($field,)* } = self;
                // SAFETY: the caller's.
                $(unsafe { (&raw mut (*target).$field).write_volatile($field.clone()) };)*
            };
        }
        copy!(plain_offset shape_or_epoch shape kind votes operand lookup pointer key);
    }

    /// The two are for the same shape and key.
    pub(super) fn does_the_same_as(&self, other: &AccessCase) -> bool {
        let parts = |it: &AccessCase| (it.kind(), it.new_shape(), it.operand(), it.lookup.get());
        parts(self) == parts(other)
            && self.plain_offset() == other.plain_offset()
            && (self.pointer() == other.pointer() || self.kind() == AccessKind::Transition)
    }

    pub(super) fn is_plain_call(&self) -> bool {
        self.operand() & Self::IS_PLAIN_CALL != 0
    }

    /// If the case calls a getter or a setter, and holds.
    ///
    /// # Safety
    /// The object has the shape.
    #[inline(always)]
    pub(super) unsafe fn accessor(&self, object: &JsObject) -> Option<Gc<GetterSetter>> {
        use AccessKind::{CallInheritedGetter, CallInheritedSetter, CallOwnGetter, CallOwnSetter};
        let stored = match self.kind() {
            CallOwnGetter | CallOwnSetter => {
                // SAFETY: the caller's.
                unsafe { slot_at(object, self.pointer() as i32) }.get()
            }
            CallInheritedGetter | CallInheritedSetter => self.lookup()?.stored_value(),
            _ => None,
        };
        stored?.downcast()
    }

    /// The one that it calls, if that has an executable.
    ///
    /// # Safety
    /// As above.
    #[inline(always)]
    pub unsafe fn function_to_call(&self, object: &JsObject) -> Option<Gc<JsObject>> {
        // SAFETY: the caller's.
        let accessor = unsafe { self.accessor(object) }?;
        let function = match self.kind() {
            AccessKind::CallOwnGetter | AccessKind::CallInheritedGetter => accessor.getter(),
            _ => accessor.setter(),
        };
        function.filter(|it| CellType::FUNCTIONS.contains(it.cell_type()))
    }

    /// If it can be called for any receiver.
    ///
    /// # Safety
    /// The kind is one of those two, and the object has the shape.
    #[inline(always)]
    pub(super) unsafe fn custom_in_slot(
        &self,
        object: &JsObject,
    ) -> Option<Gc<CustomGetterSetter>> {
        // SAFETY: the caller's.
        let stored = unsafe { slot_at(object, self.byte_offset()) }.get()?;
        (stored.downcast::<CustomGetterSetter>()).filter(|it| it.required_class().is_none())
    }

    pub(super) fn forget_key_for_proxy(&self) {
        debug_assert!(self.kind().is_for_any_key());
        self.pointer.set(0);
    }

    /// What `Instanceof` looks for.
    pub fn prototype(&self) -> Option<Gc<JsObject>> {
        // SAFETY: the case goes when it dies.
        (self.kind() == AccessKind::Instanceof).then(|| unsafe { Gc::from_address(self.key.get()) })
    }

    pub(super) fn name(&self) -> Option<NonNull<StringImpl>> {
        NonNull::new(core::ptr::with_exposed_provenance_mut(self.key.get()))
            .filter(|_| self.kind() != AccessKind::Instanceof)
    }

    pub(super) fn is_live(&self, survivors: &Survivors) -> bool {
        is_live(self.shape(), survivors)
            && is_live(self.new_shape(), survivors)
            && (self.lookup()).is_none_or(|it| it.stays_valid(survivors))
            && self.prototype().is_none_or(|it| survivors.contains(it))
    }
}
