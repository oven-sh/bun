//! For sites that see too many shapes or names to remember them. An entry that is pushed out of its place in the
//! primary table gets a second chance in the secondary one.

use core::cell::Cell;
use core::mem::offset_of;

use bun_engine_text::{PropertyName, names};

use super::{CachedName, is_looked_up_in_shape};
use crate::heap::Allocator;
use crate::ic::{AccessCase, AccessKind, slot_at};
use crate::{
    Attributes, CellType, Cx, Gc, GetterSetter, GlobalProxy, InternalMethod, JsObject, JsResult,
    PropertyOffset, PropertySlot, ProxyObject, PutContext, PutKind, PutPropertySlot, Shape,
    ShapeFlags, ShapeId, Storage, TypeFlags, Value, Vm,
};

#[inline(always)]
pub fn primary_hash(shape: ShapeId, name: PropertyName<'_>) -> u32 {
    let [low, high] = PRIMARY_SHAPE_SHIFTS.map(|shift| shape.bits() >> shift);
    (low ^ high).wrapping_add(name.hash())
}

pub const PRIMARY_SHAPE_SHIFTS: [u32; 2] = [4, 15];
pub const ENTRY_SHIFT: u32 = 5;
/// Shapes that are next to each other get entries of their own.
pub const SHAPE_SHIFT: u32 = size_of::<Shape>().ilog2() - ENTRY_SHIFT;

/// Added to the id of the shape, shifted right by `SHAPE_SHIFT`, it tells where the entry is in the primary table, in
/// bytes.
#[inline(always)]
pub fn name_hash(name: PropertyName<'_>) -> u32 {
    name.hash() << ENTRY_SHIFT
}

#[inline(always)]
fn primary_index(shape: ShapeId, name_hash: u32) -> u32 {
    (shape.bits() >> SHAPE_SHIFT).wrapping_add(name_hash) >> ENTRY_SHIFT
}

#[inline(always)]
pub fn secondary_hash(shape: ShapeId, name_address: usize) -> u32 {
    let sum = shape.bits().wrapping_add(name_address as u32);
    (sum ^ sum >> 9) >> 3
}

macro_rules! entries {
    ($($entry:ident in $primary:ident, $secondary:ident { $($field:ident)* })*) => {$(
        impl $entry {
            pub const PRIMARY_COUNT: usize = 2048;
            pub const SECONDARY_COUNT: usize = 512;
            pub const OFFSET_OF_NAME: usize = offset_of!(Self, name);
            pub const OFFSET_OF_SHAPE: usize = offset_of!(Self, shape);
            pub const OFFSET_OF_EPOCH: usize = offset_of!(Self, epoch);
            pub const OFFSET_OF_BYTE_OFFSET: usize = offset_of!(Self, byte_offset);
            /// In the offset: there is more to do than to access the slot.
            pub const IS_SPECIAL: i32 = 1;

            #[inline(always)]
            pub(super) fn clear(&self) {
                // SAFETY: what that goes by changes only while it is clear.
                unsafe { self.name.clear(self.counts_name()) };
            }

            #[inline(always)]
            fn matches(&self, vm: &Vm, shape: ShapeId, name: usize) -> bool {
                self.shape.get() == shape
                    && self.epoch.get() == vm.prototype_chain_epoch()
                    && self.name.address() == name
            }

            #[inline(always)]
            pub fn find<'a>(vm: &'a Vm, shape: ShapeId, name: PropertyName<'_>) -> Option<&'a Self> {
                Self::find_hashed(vm, shape, name.address(), name_hash(name))
            }

            /// By the address of the name and its `name_hash`.
            #[inline(always)]
            pub fn find_hashed(vm: &Vm, shape: ShapeId, name: usize, hash: u32) -> Option<&Self> {
                let tables = vm.lookup_tables();
                let entry = tables.$primary.at(primary_index(shape, hash));
                if entry.matches(vm, shape, name) {
                    return Some(entry);
                }
                let entry = tables.$secondary.at(secondary_hash(shape, name));
                entry.matches(vm, shape, name).then_some(entry)
            }

            /// `fill` sets the rest.
            #[inline(always)]
            fn insert(vm: &Vm, shape: ShapeId, name: PropertyName<'_>, fill: impl FnOnce(&Self)) {
                let tables = vm.services.caches.tables_to_fill();
                let entry = tables.$primary.at(primary_index(shape, name_hash(name)));
                if entry.epoch.get() == vm.prototype_chain_epoch() {
                    let hash = secondary_hash(entry.shape.get(), entry.name.address());
                    let second = tables.$secondary.at(hash);
                    second.clear();
                    second.name.take_from(&entry.name);
                    second.shape.set(entry.shape.get());
                    second.epoch.set(entry.epoch.get());
                    second.byte_offset.set(entry.byte_offset.get());
                    $(second.$field.set(entry.$field.get());)*
                }
                entry.clear();
                entry.shape.set(shape);
                entry.epoch.set(vm.prototype_chain_epoch());
                fill(entry);
                entry.name.set(name, entry.counts_name());
            }

            #[inline(always)]
            fn is_special(&self) -> bool {
                self.byte_offset.get() & Self::IS_SPECIAL != 0
            }

            /// As for `ic::slot_at`.
            #[inline(always)]
            fn slot_offset(&self) -> i32 {
                self.byte_offset.get() & !Self::IS_SPECIAL
            }
        }

        const _: () = assert!(size_of::<$entry>() == 1 << ENTRY_SHIFT);
    )*};
}

entries! {
    LoadEntry in loads, secondary_loads { kind accessor_kind is_present is_enumerable holder }
    StoreEntry in stores, secondary_stores { capacity new_shape allocator }
}

#[repr(C, align(32))]
pub struct LoadEntry {
    name: CachedName,
    shape: Cell<ShapeId>,
    /// `CallMegamorphicAccessor`, or `End` if there is nothing for compiled code to call.
    kind: Cell<AccessKind>,
    /// The bits of `Attributes::ANY_ACCESSOR`.
    accessor_kind: Cell<u8>,
    is_present: Cell<bool>,
    is_enumerable: Cell<bool>,
    /// Zero for the object itself. Otherwise the prototype if it is special, and what the offset counts from if not. For
    /// a property that is absent, that has undefined there.
    holder: Cell<usize>,
    epoch: Cell<u32>,
    /// Special for an accessor, and otherwise zero if that has no slot. Also for a slot that can move unnoticed.
    byte_offset: Cell<i32>,
}

const _: () = assert!(offset_of!(LoadEntry, kind) == AccessCase::OFFSET_OF_KIND);
const _: () = assert!(AccessKind::End as u8 == 0);

static HOLDER_OF_UNDEFINED: [u64; 2] = [0, Value::UNDEFINED.to_bits()];

impl LoadEntry {
    pub const OFFSET_OF_HOLDER: usize = offset_of!(Self, holder);
    pub const OFFSET_OF_ACCESSOR_KIND: usize = offset_of!(Self, accessor_kind);
    pub const OFFSET_OF_IS_PRESENT: usize = offset_of!(Self, is_present);

    #[inline(always)]
    fn counts_name(&self) -> bool {
        !self.is_present() || self.slot_offset() == 0
    }

    /// It is special, and has just been found for the shape of `first`.
    #[inline(always)]
    fn holder(&self, first: Gc<JsObject>) -> Gc<JsObject> {
        debug_assert!(self.is_special());
        match self.holder.get() {
            0 => first,
            // SAFETY: on the chain of `first`.
            holder => unsafe { Gc::from_address(holder) },
        }
    }

    /// Unless it is special.
    ///
    /// # Safety
    /// The entry has just been found for the shape of the object.
    #[inline(always)]
    pub unsafe fn plain_value(&self, object: &JsObject) -> Option<Value> {
        if self.is_special() {
            return None;
        }
        let byte_offset = self.byte_offset.get();
        // SAFETY: the caller's. What the holder stands for is there until a collection ends.
        unsafe {
            match self.holder.get() {
                0 => slot_at(object, byte_offset).get(),
                base => Value::from_bits_or_empty(*core::ptr::with_exposed_provenance(
                    base.wrapping_add_signed(byte_offset as isize),
                )),
            }
        }
    }

    #[inline(always)]
    pub fn is_own(&self) -> bool {
        self.holder.get() == 0
    }

    #[inline(always)]
    pub fn is_present(&self) -> bool {
        self.is_present.get()
    }

    fn record(vm: &Vm, first: &JsObject, name: PropertyName<'_>, slot: &PropertySlot) {
        debug_assert!(slot.base().is_none_or(|it| {
            let offset = it.shape().get(name).map(|it| it.0);
            offset.unwrap_or(PropertyOffset::INVALID) == slot.cached_offset()
        }));
        Self::insert(vm, first.shape_id(), name, |it| Self::fill(it, first, slot));
    }

    #[inline(always)]
    fn fill(entry: &LoadEntry, first: &JsObject, slot: &PropertySlot) {
        entry.kind.set(AccessKind::End);
        entry.is_present.set(!slot.is_unset());
        (entry.is_enumerable).set(slot.is_enumerable());
        let Some(holder) = slot.base() else {
            (entry.holder).set(HOLDER_OF_UNDEFINED.as_ptr().expose_provenance());
            entry.byte_offset.set(size_of::<u64>() as i32);
            return;
        };
        let (is_own, offset) = (holder.is_same(first), slot.cached_offset());
        entry.holder.set(if is_own { 0 } else { holder.address() });
        if slot.is_value() {
            entry.byte_offset.set(offset.byte_offset() as i32);
            if is_own || offset.is_inline() {
                return;
            }
            // See `nuke_shape_and_set_storage`.
            if !holder.indexing_mode().has_elements() {
                return entry.holder.set(holder.storage().address());
            }
        }
        let kind = slot.attributes() & Attributes::ANY_ACCESSOR;
        let this = if kind == Attributes::CUSTOM_VALUE {
            &holder
        } else {
            first
        };
        // A getter gets the proxy of a global object.
        let can_be_called = !slot.is_value()
            && offset.is_valid()
            && first.cell_type() != CellType::GlobalObject
            && (slot.required_class()).is_none_or(|class| this.inherits(class));
        entry.accessor_kind.set(kind.bits() as u8);
        if can_be_called {
            entry.kind.set(AccessKind::CallMegamorphicAccessor);
        }
        let byte_offset = if offset.is_valid() {
            offset.byte_offset() as i32
        } else {
            0
        };
        entry.byte_offset.set(byte_offset | Self::IS_SPECIAL);
    }
}

/// `get_non_index_property_slot`, which leaves an entry if it can.
fn look_up_and_record(
    cx: &mut Cx,
    first: Gc<JsObject>,
    name: PropertyName<'_>,
    slot: &mut PropertySlot,
) -> JsResult<bool> {
    let epoch = cx.full_prototype_chain_epoch();
    let (mut object, mut is_cacheable, mut first_shape) = (first, true, ShapeId::NONE);
    let found = loop {
        let is_ordinary = is_looked_up_in_shape(&object, name);
        if object.overrides_get_prototype()
            || (!is_ordinary && CellType::TYPED_ARRAYS.contains(object.cell_type()))
        {
            return object.get_non_index_property_slot(cx, name, slot);
        }
        let found = if is_ordinary {
            object.get_own_non_index_property_slot(cx, name, slot)?
        } else {
            object.get_own_property_slot(cx, name, slot)?
        };
        let shape = object.shape();
        // Whatever happens to a prototype starts a new epoch.
        let is_watched = shape.may_be_prototype();
        is_cacheable &= shape.class_allows_property_caching()
            && (is_watched || !shape.is_uncacheable_dictionary());
        if object == first {
            first_shape = shape.id();
        }
        if found {
            is_cacheable &= is_ordinary
                || (slot.base() == Some(object)
                    && shape.get(name) == Some((slot.cached_offset(), slot.attributes())));
            break true;
        }
        is_cacheable &= is_ordinary && passes_on_for_good(&shape);
        match shape.prototype_object() {
            Some(prototype) => object = prototype,
            None => break false,
        }
    };
    if is_cacheable
        && slot.is_cacheable()
        && (slot.cached_offset().is_valid() || !first.shape().is_dictionary())
        && (epoch, first_shape) == (cx.full_prototype_chain_epoch(), first.shape_id())
    {
        LoadEntry::record(cx, &first, name, slot);
    }
    Ok(found)
}

/// `[[Get]]`, if that comes down to reading a slot. It allocates no cell and changes no object. The name is no index.
pub fn get_quietly(vm: &Vm, first: &JsObject, name: PropertyName<'_>) -> Option<Value> {
    if let Some(entry) = LoadEntry::find(vm, first.shape_id(), name) {
        // SAFETY: just found.
        return unsafe { entry.plain_value(first) };
    }
    let mut slot = PropertySlot::new(first.as_value(), InternalMethod::Inquiry);
    let mut is_cacheable = true;
    for object in first.chain_direct() {
        if !is_looked_up_in_shape(&object, name) || object.overrides_get_prototype() {
            return None;
        }
        let shape = object.shape();
        is_cacheable &= shape.property_accesses_are_cacheable();
        if let Some((offset, attributes)) = shape.get(name) {
            object.fill_slot(offset, attributes, &mut slot);
            break;
        }
        if shape.has_non_reified_static_properties() && shape.find_static_property(name).is_some() {
            return None;
        }
        is_cacheable &= passes_on_for_good(&shape);
    }
    if is_cacheable && slot.is_cacheable() {
        LoadEntry::record(vm, first, name, &slot);
    }
    if slot.is_unset() {
        Some(Value::UNDEFINED)
    } else {
        slot.plain_value()
    }
}

/// What is added to a prototype starts a new epoch.
#[inline(always)]
fn passes_on_for_good(shape: &Shape) -> bool {
    (shape.may_be_prototype() || !shape.is_dictionary())
        && !(shape.type_flags()).contains(TypeFlags::GET_OWN_PROPERTY_SLOT_IS_IMPURE_FOR_ABSENCE)
}

#[inline(always)]
fn find_plain_value<'a>(
    vm: &'a Vm,
    object: &JsObject,
    name: PropertyName<'_>,
) -> Option<(&'a LoadEntry, Value)> {
    let entry = LoadEntry::find(vm, object.shape_id(), name)?;
    // SAFETY: just found.
    Some((entry, unsafe { entry.plain_value(object) }?))
}

/// GetV
#[inline]
pub fn get_megamorphic(cx: &mut Cx, base: Value, name: PropertyName<'_>) -> JsResult<Value> {
    get_megamorphic_with_receiver(cx, base, name, base)
}

#[inline(always)]
pub(crate) fn get_megamorphic_with_receiver(
    cx: &mut Cx,
    base: Value,
    name: PropertyName<'_>,
    receiver: Value,
) -> JsResult<Value> {
    let Some(object) = base.as_object() else {
        return get_from_primitive(cx, base, name, receiver);
    };
    let Some(entry) = LoadEntry::find(cx, object.shape_id(), name) else {
        return get_and_record(cx, object, name, receiver);
    };
    if !entry.is_special() {
        // SAFETY: just found.
        return Ok(unsafe { entry.plain_value(&object) }.unwrap_or_default());
    }
    let (holder, place) = (
        entry.holder(object),
        (entry.slot_offset(), entry.accessor_kind.get()),
    );
    get_special(cx, holder, place, name, receiver)
}

#[inline(never)]
fn get_from_primitive(
    cx: &mut Cx,
    base: Value,
    name: PropertyName<'_>,
    receiver: Value,
) -> JsResult<Value> {
    if name.as_index().is_some() || (name == names::length && base.is_string()) {
        let mut slot = PropertySlot::new(receiver, InternalMethod::Get);
        base.get_property_slot(cx, name, &mut slot)?;
        return slot.value(cx, name);
    }
    let prototype = base.synthesize_prototype(cx)?;
    get_megamorphic_with_receiver(cx, prototype.into(), name, receiver)
}

/// One that is used as a table, whose shape does not tell which names it lacks.
#[inline(always)]
fn is_plain_dictionary(object: &JsObject, shape: &Shape) -> bool {
    shape.is_dictionary()
        && object.cell_type() == CellType::FinalObject
        && !shape.has(ShapeFlags::MAY_BE_PROTOTYPE | ShapeFlags::HAS_ANY_ACCESSOR)
        && !object.inline_flags().intersects(
            TypeFlags::OVERRIDES_GET_OWN_PROPERTY_SLOT
                | TypeFlags::OVERRIDES_GET_PROTOTYPE
                | TypeFlags::HAS_STATIC_PROPERTY_TABLE,
        )
}

/// With more, it would only push other entries out.
#[inline(always)]
fn has_few_enough_properties(shape: &Shape) -> bool {
    shape.out_of_line_size() <= LoadEntry::PRIMARY_COUNT / 2
}

#[inline(never)]
fn get_and_record(
    cx: &mut Cx,
    object: Gc<JsObject>,
    name: PropertyName<'_>,
    receiver: Value,
) -> JsResult<Value> {
    if let Some(proxy) = object.downcast::<ProxyObject>() {
        return proxy.get_through(cx, name, receiver);
    }
    if name.as_index().is_some() {
        return object.get_with_receiver(cx, name, receiver);
    }
    let shape = object.shape();
    if is_plain_dictionary(&object, &shape) {
        match (shape.get(name), shape.prototype_object()) {
            (None, None) => return Ok(Value::UNDEFINED),
            (None, Some(prototype)) => {
                return get_megamorphic_with_receiver(cx, prototype.into(), name, receiver);
            }
            (Some((offset, _)), _)
                if shape.is_uncacheable_dictionary() || !has_few_enough_properties(&shape) =>
            {
                // SAFETY: from the shape.
                return Ok(unsafe { object.get_direct_unchecked(offset) });
            }
            _ => {}
        }
    } else if let Some(proxy) = object.downcast::<GlobalProxy>() {
        return get_megamorphic_with_receiver(cx, proxy.target().into(), name, receiver);
    }
    let mut slot = PropertySlot::new(receiver, InternalMethod::Get);
    look_up_and_record(cx, object, name, &mut slot)?;
    slot.value(cx, name)
}

/// By what an entry says.
#[inline(never)]
fn get_special(
    cx: &mut Cx,
    holder: Gc<JsObject>,
    (byte_offset, accessor_kind): (i32, u8),
    name: PropertyName<'_>,
    receiver: Value,
) -> JsResult<Value> {
    let mut slot = PropertySlot::new(receiver, InternalMethod::Get);
    if byte_offset == 0 {
        // It can have got one since, in the same shape.
        holder.get_own_non_index_property_slot(cx, name, &mut slot)?;
        return slot.value(cx, name);
    }
    // SAFETY: the holder has it.
    let stored = (unsafe { slot_at(&holder, byte_offset) }.get()).unwrap_or_default();
    if let Some(accessor) = stored.downcast::<GetterSetter>() {
        return accessor.call_getter(cx, receiver);
    }
    let kind = Attributes::from_bits_retain(accessor_kind.into());
    holder.fill_accessor_slot(stored, kind, &mut slot);
    slot.value(cx, name)
}

/// `None` if there is no such property. No proxy is on the chain, and the name is no index.
#[inline]
pub(crate) fn get_megamorphic_if_present(
    cx: &mut Cx,
    object: Gc<JsObject>,
    name: PropertyName<'_>,
    receiver: Value,
) -> JsResult<Option<Value>> {
    match LoadEntry::find(cx, object.shape_id(), name).map(LoadEntry::is_present) {
        Some(false) => Ok(None),
        Some(true) => get_megamorphic_with_receiver(cx, object.into(), name, receiver).map(Some),
        None => {
            let mut slot = PropertySlot::new(receiver, InternalMethod::Get);
            if !look_up_and_record(cx, object, name, &mut slot)? {
                return Ok(None);
            }
            slot.value(cx, name).map(Some)
        }
    }
}

/// The value of an own property, or undefined.
pub(crate) fn get_own_megamorphic(
    cx: &mut Cx,
    object: Gc<JsObject>,
    name: PropertyName<'_>,
) -> JsResult<Value> {
    if let Some((entry, value)) = find_plain_value(cx, &object, name) {
        return Ok(if entry.is_own() {
            value
        } else {
            Value::UNDEFINED
        });
    }
    let mut slot = PropertySlot::new(object.into(), InternalMethod::GetOwnProperty);
    if !object.get_own_property_slot(cx, name, &mut slot)? {
        return Ok(Value::UNDEFINED);
    }
    if slot.is_cacheable()
        && slot.is_value()
        && slot.base() == Some(object)
        && is_looked_up_in_shape(&object, name)
        && object.shape().property_accesses_are_cacheable()
    {
        LoadEntry::record(cx, &object, name, &slot);
    }
    slot.value(cx, name)
}

#[inline(never)]
fn look_up_and_record_private(
    vm: &Vm,
    object: Gc<JsObject>,
    name: PropertyName<'_>,
) -> Option<Value> {
    let (shape, mut slot) = (
        object.shape(),
        PropertySlot::new(object.into(), InternalMethod::Inquiry),
    );
    let found = shape.get(name);
    if let Some((offset, attributes)) = found {
        object.fill_slot(offset, attributes, &mut slot);
    }
    if !shape.is_uncacheable_dictionary() && (found.is_some() || !shape.is_dictionary()) {
        LoadEntry::record(vm, &object, name, &slot);
    }
    slot.plain_value()
}

/// `None` if the object has no such private element.
#[inline]
pub(crate) fn get_private_megamorphic(
    vm: &Vm,
    object: Gc<JsObject>,
    name: PropertyName<'_>,
) -> Option<Value> {
    match find_plain_value(vm, &object, name) {
        Some((entry, value)) => entry.is_own().then_some(value),
        None => look_up_and_record_private(vm, object, name),
    }
}

#[inline]
pub(crate) fn has_private_megamorphic(
    vm: &Vm,
    object: Gc<JsObject>,
    name: PropertyName<'_>,
) -> bool {
    get_private_megamorphic(vm, object, name).is_some()
}

/// HasProperty
#[inline]
pub fn has_megamorphic(cx: &mut Cx, base: Gc<JsObject>, name: PropertyName<'_>) -> JsResult<bool> {
    match LoadEntry::find(cx, base.shape_id(), name) {
        Some(entry) => Ok(entry.is_present.get()),
        None => has_slow(cx, base, name),
    }
}

#[inline(never)]
fn has_slow(cx: &mut Cx, base: Gc<JsObject>, name: PropertyName<'_>) -> JsResult<bool> {
    if name.as_index().is_some() {
        return base.has_property(cx, name);
    }
    let shape = base.shape();
    if is_plain_dictionary(&base, &shape) {
        if shape.get(name).is_none() {
            return (shape.prototype_object())
                .map_or(Ok(false), |it| has_megamorphic(cx, it, name));
        }
        if shape.is_uncacheable_dictionary() || !has_few_enough_properties(&shape) {
            return Ok(true);
        }
    }
    let mut slot = PropertySlot::new(base.into(), InternalMethod::HasProperty);
    look_up_and_record(cx, base, name, &mut slot)
}

/// `JsObject::has_enumerable_property`
#[inline]
pub(crate) fn has_enumerable_megamorphic(
    cx: &mut Cx,
    base: Gc<JsObject>,
    name: PropertyName<'_>,
) -> JsResult<bool> {
    if let Some(entry) = LoadEntry::find(cx, base.shape_id(), name) {
        return Ok(entry.is_enumerable.get());
    }
    if name.as_index().is_some() {
        return base.has_enumerable_property(cx, name);
    }
    let mut slot = PropertySlot::new(base.into(), InternalMethod::GetOwnProperty);
    Ok(look_up_and_record(cx, base, name, &mut slot)? && slot.is_enumerable())
}

/// Neither the object nor its prototypes have the property. False if the cache has nothing to say.
#[inline]
pub(crate) fn is_known_to_be_absent(vm: &Vm, object: &JsObject, name: PropertyName<'_>) -> bool {
    LoadEntry::find(vm, object.shape_id(), name).is_some_and(|entry| !entry.is_present.get())
}

#[repr(C, align(32))]
pub struct StoreEntry {
    name: CachedName,
    /// Tagged with `DEFINES` for CreateDataProperty and for adding a private element.
    shape: Cell<ShapeId>,
    /// If it is special: how many slots the storage has so far.
    capacity: Cell<u32>,
    /// The old one for a property that exists.
    new_shape: Cell<ShapeId>,
    /// If it is special: how far that of the new storage is from the `Vm`, or zero if it is left to the slow path.
    allocator: Cell<u32>,
    epoch: Cell<u32>,
    /// Special if the object needs more slots.
    byte_offset: Cell<i32>,
}

const _: () = assert!(StoreEntry::DEFINES & !ShapeId::LAST_BITS_MASK == 0);

impl StoreEntry {
    pub const OFFSET_OF_NEW_SHAPE: usize = offset_of!(Self, new_shape);
    pub const OFFSET_OF_CAPACITY: usize = offset_of!(Self, capacity);
    pub const OFFSET_OF_ALLOCATOR: usize = offset_of!(Self, allocator);
    pub const DEFINES: u32 = 4;

    #[inline(always)]
    fn counts_name(&self) -> bool {
        false
    }

    #[inline(always)]
    pub fn key_for_defining(shape: ShapeId) -> ShapeId {
        ShapeId::from_bits(shape.bits() ^ Self::DEFINES)
    }

    /// The new shape and the offset of the slot, if the object has room for it.
    #[inline(always)]
    pub fn plain_store(&self) -> Option<(ShapeId, i32)> {
        (!self.is_special()).then(|| (self.new_shape.get(), self.byte_offset.get()))
    }

    /// # Safety
    /// The entry has been found for the object.
    #[inline(always)]
    unsafe fn store(&self, vm: &Vm, object: &JsObject, value: Value) {
        let (new, byte_offset) = (self.new_shape.get(), self.slot_offset());
        // SAFETY: the caller's.
        unsafe {
            if self.is_special() {
                object.grow_and_add_cached_property(vm, new, byte_offset, value);
            } else if new == object.shape_id() {
                slot_at(object, byte_offset).set(object, Some(value));
            } else {
                object.add_cached_property(new, byte_offset, value);
            }
        }
    }

    fn record(
        vm: &Vm,
        key: ShapeId,
        name: PropertyName<'_>,
        (old, new): (Gc<Shape>, Gc<Shape>),
        offset: PropertyOffset,
    ) {
        if old == new {
            old.did_cache_property_replacement(vm, offset);
        }
        debug_assert!(new.get(name).is_some_and(|it| it.0 == offset));
        debug_assert!(old == new || !old.may_be_prototype());
        Self::insert(vm, key, name, |it| Self::fill(it, vm, (old, new), offset));
    }

    #[inline(always)]
    fn fill(
        entry: &StoreEntry,
        vm: &Vm,
        (old, new): (Gc<Shape>, Gc<Shape>),
        offset: PropertyOffset,
    ) {
        let (capacity, new_capacity) = (old.out_of_line_capacity(), new.out_of_line_capacity());
        entry.new_shape.set(new.id());
        entry
            .byte_offset
            .set(offset.byte_offset() as i32 | i32::from(capacity != new_capacity));
        if capacity != new_capacity {
            let allocator = (vm
                .heap
                .auxiliary
                .allocator_for(Storage::size(new_capacity, None)))
            .filter(|_| !old.instance_indexing_mode().has_elements());
            let distance =
                |it: &Allocator| core::ptr::from_ref(it).addr() - core::ptr::from_ref(vm).addr();
            entry.capacity.set(capacity as u32);
            entry.allocator.set(allocator.map_or(0, distance) as u32);
        }
    }
}

/// Set(O, P, V, Throw)
#[inline]
pub fn put_megamorphic(
    cx: &mut Cx,
    base: Gc<JsObject>,
    name: PropertyName<'_>,
    value: Value,
    is_strict: bool,
) -> JsResult<()> {
    put_megamorphic_in(cx, base, name, value, is_strict, PutContext::Unknown)
}

#[inline(always)]
pub(crate) fn put_megamorphic_in(
    cx: &mut Cx,
    base: Gc<JsObject>,
    name: PropertyName<'_>,
    value: Value,
    is_strict: bool,
    context: PutContext,
) -> JsResult<()> {
    let Some(entry) = StoreEntry::find(cx, base.shape_id(), name) else {
        return put_slow(cx, base, name, value, is_strict, context);
    };
    // SAFETY: just found.
    unsafe { entry.store(cx, &base, value) };
    Ok(())
}

/// `[[Set]]`, if that comes down to writing a slot, which may be new. Gives its address. Otherwise it does nothing. The
/// name is no index.
pub fn put_quietly(
    cx: &mut Cx,
    base: Gc<JsObject>,
    name: PropertyName<'_>,
    value: Value,
    context: PutContext,
) -> Option<usize> {
    // SAFETY: of the slot that has just been written.
    let address =
        |offset| core::ptr::from_ref(unsafe { slot_at(&base, offset) }).expose_provenance();
    if let Some(entry) = StoreEntry::find(cx, base.shape_id(), name) {
        let byte_offset = entry.slot_offset();
        // SAFETY: just found.
        unsafe { entry.store(cx, &base, value) };
        return Some(address(byte_offset));
    }
    let shape = base.shape();
    let is_quiet = base.cell_type() == CellType::FinalObject
        && (shape.is_extensible() || shape.get(name).is_some())
        && base.nothing_intercepts_put(name);
    if !is_quiet || put_slow(cx, base, name, value, false, context).is_err() {
        return None;
    }
    let (offset, _) = base.shape().get(name).expect("just stored");
    Some(address(offset.byte_offset() as i32))
}

fn is_cacheable_addition(old: &Shape, new: Gc<Shape>, name: PropertyName<'_>) -> bool {
    let attributes = match name.is_private_element() {
        true => new.transition_attributes(),
        false => Attributes::NONE,
    };
    !old.may_be_prototype()
        && !old.has_non_reified_static_properties()
        && old.instance_header() == new.instance_header()
        && old.existing_add_transition(name, attributes) == Some(new)
}

/// What `define` does, which is to define an own data property with default attributes or to throw.
#[inline]
pub(crate) fn define_megamorphic(
    cx: &mut Cx,
    base: Gc<JsObject>,
    name: PropertyName<'_>,
    value: Value,
    context: PutContext,
    define: impl FnOnce(&mut Cx, &mut PutPropertySlot) -> JsResult<()>,
) -> JsResult<()> {
    let old = base.shape();
    let key = StoreEntry::key_for_defining(old.id());
    if let Some(entry) = StoreEntry::find(cx, key, name) {
        // SAFETY: just found.
        unsafe { entry.store(cx, &base, value) };
        return Ok(());
    }
    let mut slot = PutPropertySlot::with_context(base.into(), true, context);
    define(cx, &mut slot)?;
    let new = base.shape();
    let is_cacheable = match slot.cacheable_kind() {
        PutKind::ExistingProperty => old == new,
        PutKind::NewProperty => is_cacheable_addition(&old, new, name),
        _ => false,
    };
    if is_cacheable && slot.base() == Some(base) && old.property_accesses_are_cacheable() {
        StoreEntry::record(cx, key, name, (old, new), slot.cached_offset());
    }
    Ok(())
}

/// False if there is more to it, as when the object has no such private field.
#[inline]
pub(crate) fn replace_private_megamorphic(
    vm: &Vm,
    object: Gc<JsObject>,
    name: PropertyName<'_>,
    value: Value,
) -> bool {
    let shape = object.shape();
    if let Some(entry) = StoreEntry::find(vm, shape.id(), name) {
        // SAFETY: just found.
        unsafe { entry.store(vm, &object, value) };
        return true;
    }
    if !shape.is_uncacheable_dictionary()
        && !object.indexing_mode().is_copy_on_write()
        && let Some((offset, _)) = shape.get(name)
    {
        StoreEntry::record(vm, shape.id(), name, (shape, shape), offset);
    }
    false
}

#[inline(never)]
fn put_slow(
    cx: &mut Cx,
    base: Gc<JsObject>,
    name: PropertyName<'_>,
    value: Value,
    is_strict: bool,
    context: PutContext,
) -> JsResult<()> {
    let mut slot = PutPropertySlot::with_context(base.into(), is_strict, context);
    let (old, epoch) = (base.shape(), cx.full_prototype_chain_epoch());
    base.put(cx, name, value, &mut slot)?;
    let new = base.shape();
    let is_cacheable = match slot.cacheable_kind() {
        PutKind::ExistingProperty => {
            old == new && old.stores_ordinarily(name) && has_few_enough_properties(&old)
        }
        PutKind::NewProperty => {
            old != new
                && is_cacheable_addition(&old, new, name)
                && (base.chain_direct()).all(|object| object.shape().stores_ordinarily(name))
        }
        _ => false,
    };
    if is_cacheable
        && slot.base() == Some(base)
        && old.property_accesses_are_cacheable()
        && epoch == cx.full_prototype_chain_epoch()
    {
        StoreEntry::record(cx, old.id(), name, (old, new), slot.cached_offset());
    }
    Ok(())
}
