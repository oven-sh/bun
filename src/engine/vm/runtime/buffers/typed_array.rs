use core::marker::PhantomData;
use core::ops::Deref;

use bun_engine_macros::{cell, object_ops};
use bun_engine_number::canonical_numeric_index;
use bun_engine_text::{PropertyName, names, symbols};

use super::element::{Element, ElementType, NumberElement};
use super::slice::BufferSlice;
use super::view::ViewMode;
use crate::heap::Never;
use crate::{
    Attributes, CellKind, CellType, Class, ClassOps, Cx, DeletePropertySlot, DontEnumMode, Extends,
    Gc, GcFree, GlobalObject, JsArrayBufferView, JsCell, JsObject, JsResult, NoGc,
    PropertyDescriptor, PropertyNameList, PropertySlot, PutPropertySlot, RealmSlot,
    RealmWatchpoint, Shape, TypeFlags, Value, Visitor, Vm, errors, with_element_type,
};

/// The TypedArray exotic object of ECMA-262.
#[cell(name = "TypedArray", cell_type = Int8Array..=BigUint64Array, ops,
    flags = TypeFlags::INTERCEPTS_INDEXED_ACCESS)]
pub struct JsTypedArray {
    base: JsArrayBufferView,
}

enum Key {
    Index(usize),
    /// A canonical numeric string that is the index of no element.
    OtherNumber,
    Ordinary,
}

impl Key {
    #[inline(always)]
    fn of(name: PropertyName<'_>) -> Key {
        if let Some(index) = name.as_index() {
            return Key::Index(index as usize);
        }
        if name.is_symbol() {
            return Key::Ordinary;
        }
        match canonical_numeric_index(name.text()).map(JsTypedArray::index_for_number) {
            None => Key::Ordinary,
            Some(usize::MAX) => Key::OtherNumber,
            Some(index) => Key::Index(index),
        }
    }
}

#[object_ops]
impl JsTypedArray {
    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        match Key::of(name) {
            Key::Index(index) => Ok(self.get_element_slot(cx, index, slot)),
            Key::OtherNumber => Ok(false),
            Key::Ordinary => self.get_own_non_index_property_slot(cx, name, slot),
        }
    }

    fn get_own_property_slot_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        Ok(self.get_element_slot(cx, index as usize, slot))
    }

    fn put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        let index = match Key::of(name) {
            Key::Index(index) => index,
            Key::OtherNumber => usize::MAX,
            Key::Ordinary => return self.ordinary_put(cx, name, value, slot),
        };
        if slot.is_receiver(self) {
            self.set_element(cx, index, value)?;
            return Ok(true);
        }
        if !self.is_valid_index(index) {
            return Ok(true);
        }
        self.ordinary_set_slow(cx, name, value, slot.this_value(), slot.is_strict())
    }

    fn put_by_index(&self, cx: &mut Cx, index: u32, value: Value, _: bool) -> JsResult<bool> {
        self.set_element(cx, index as usize, value)?;
        Ok(true)
    }

    fn delete_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut DeletePropertySlot,
    ) -> JsResult<bool> {
        match Key::of(name) {
            Key::Index(index) => Ok(!self.is_valid_index(index)),
            Key::OtherNumber => Ok(true),
            Key::Ordinary => self.ordinary_delete_property(cx, name, slot),
        }
    }

    fn delete_property_by_index(&self, _: &mut Cx, index: u32) -> JsResult<bool> {
        Ok(!self.is_valid_index(index as usize))
    }

    fn define_own_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        let index = match Key::of(name) {
            Key::Index(index) => index,
            Key::OtherNumber => {
                let message =
                    "Attempting to store canonical numeric string property on a typed array";
                return cx.reject(should_throw, message);
            }
            Key::Ordinary => {
                return self.define_own_non_index_property(cx, name, descriptor, should_throw);
            }
        };
        if self.is_detached() {
            return cx.reject(should_throw, errors::BUFFER_DETACHED_OR_OUT_OF_BOUNDS);
        }
        let refused = if !self.is_valid_index(index) {
            "out-of-bounds"
        } else if descriptor.is_accessor() {
            "accessor"
        } else if descriptor.has_configurable() && !descriptor.configurable() {
            "non-configurable"
        } else if descriptor.has_enumerable() && !descriptor.enumerable() {
            "non-enumerable"
        } else if descriptor.has_writable() && !descriptor.writable() {
            "non-writable"
        } else {
            if let Some(value) = descriptor.value() {
                self.set_element(cx, index, value)?;
            }
            return Ok(true);
        };
        if !should_throw {
            return Ok(false);
        }
        Err(cx.throw_type_error(format_args!(
            "Attempting to store {refused} property on a typed array at index: {index}"
        )))
    }

    fn own_property_names(
        &self,
        cx: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        list.add_indices_below(cx, self.length())?;
        self.own_non_index_property_names(cx, list, mode)
    }

    fn prevent_extensions(&self, cx: &mut Cx) -> JsResult<bool> {
        let can_get_more_elements = ViewMode::AUTO_LENGTH | ViewMode::RESIZABLE;
        if self.mode().intersects(can_get_more_elements) {
            return Ok(false);
        }
        self.ordinary_prevent_extensions(cx);
        Ok(true)
    }
}

impl GlobalObject {
    #[inline(always)]
    pub fn typed_array_shape(&self, vm: &Vm, of: ElementType, is_resizable: bool) -> Gc<Shape> {
        self.view_shape(vm, of.cell_type(), is_resizable)
    }

    #[inline]
    pub fn constructor_of_typed_array(&self, vm: &Vm, of: ElementType) -> Gc<JsObject> {
        let slot = RealmSlot::int8_array_constructor.offset_by(of as usize);
        // SAFETY: a run of objects, one for each type.
        unsafe { self.slot(vm, slot).cast_unchecked() }
    }

    pub fn prototype_of_typed_array(&self, vm: &Vm, of: ElementType) -> Gc<JsObject> {
        self.typed_array_shape(vm, of, false).prototype().cast()
    }

    /// The type whose constructor in this realm is `constructor`.
    pub fn element_type_constructed_by(&self, constructor: Value) -> Option<ElementType> {
        ElementType::ALL.into_iter().find(|&it| {
            let slot = RealmSlot::int8_array_constructor.offset_by(it as usize);
            self.slot_if_initialized(slot).map(Value::from) == Some(constructor)
        })
    }
}

impl JsTypedArray {
    #[inline(always)]
    pub fn element_type(&self) -> ElementType {
        // SAFETY: the types of the class are those that have one.
        unsafe { ElementType::of_cell_type(self.cell_type()).unwrap_unchecked() }
    }

    /// # Safety
    /// `T` is the type of the elements.
    #[inline(always)]
    pub unsafe fn typed_unchecked<T: Element>(&self) -> &TypedArray<T> {
        debug_assert!(self.element_type() == T::TYPE);
        // SAFETY: the caller's.
        unsafe { &*core::ptr::from_ref(self).cast() }
    }

    /// Panics unless `T` is the type of the elements.
    #[inline(always)]
    pub fn typed<T: Element>(&self) -> &TypedArray<T> {
        assert!(self.element_type() == T::TYPE);
        // SAFETY: checked.
        unsafe { self.typed_unchecked() }
    }

    /// # Safety
    /// `T` has the size of the elements, and the index is below the known length.
    #[inline(always)]
    pub unsafe fn get_unchecked<T: Element>(&self, index: usize) -> T {
        // SAFETY: the caller's.
        unsafe { BufferSlice::new(self.vector(), self.known_length()).get_unchecked(index) }
    }

    /// # Safety
    /// As above, and nothing borrows the elements.
    #[inline(always)]
    pub unsafe fn set_unchecked<T: Element>(&self, index: usize, value: T) {
        // SAFETY: the caller's.
        unsafe { BufferSlice::new(self.vector(), self.known_length()).set_unchecked(index, value) }
    }

    /// What a key that is this number comes to, unless it is an array index. No element has the highest index.
    #[inline]
    pub fn index_for_number(number: f64) -> usize {
        if number > 0.0 && number < u64::MAX as f64 && number.fract() == 0.0 {
            number as usize
        } else {
            usize::MAX
        }
    }

    /// ValidateTypedArray. Returns the length.
    #[inline(always)]
    pub fn validate(&self, cx: &Cx) -> JsResult<usize> {
        self.checked_length()
            .ok_or_else(|| JsArrayBufferView::throw_out_of_bounds(cx))
    }

    /// The same, for any value.
    #[inline]
    pub fn validate_value(cx: &Cx, value: Value) -> JsResult<(Gc<JsTypedArray>, usize)> {
        match value.downcast::<JsTypedArray>() {
            Some(array) => Ok((array, array.validate(cx)?)),
            None => Err(cx.throw_type_error("Argument needs to be a typed array.")),
        }
    }

    /// TypedArrayGetElement. `None` for undefined.
    #[inline(never)]
    pub fn get_element(&self, vm: &Vm, index: usize) -> Option<Value> {
        with_element_type!(self.element_type(), T => {
            self.typed::<T>().get(index).map(|element| element.to_value(vm))
        })
    }

    /// `None` if the index is out of bounds or the element is a BigInt.
    #[inline(always)]
    pub fn try_get_number(&self, index: usize) -> Option<Value> {
        with_element_type!(self.element_type(),
            T => self.typed::<T>().get(index).map(T::to_number_value),
            bigint => None
        )
    }

    /// `None` if the element is a BigInt.
    ///
    /// # Safety
    /// The index is below the known length.
    #[inline(always)]
    pub unsafe fn number_at_unchecked(&self, index: usize) -> Option<Value> {
        with_element_type!(self.element_type(),
            // SAFETY: the caller's.
            T => Some(unsafe { self.get_unchecked::<T>(index) }.to_number_value()),
            bigint => None
        )
    }

    /// TypedArraySetElement
    #[inline(never)]
    pub fn set_element(&self, cx: &mut Cx, index: usize, value: Value) -> JsResult<()> {
        with_element_type!(self.element_type(), T => self.typed::<T>().set_value(cx, index, value))
    }

    /// False, having done nothing, unless a number goes to an element that exists and takes one.
    #[inline(always)]
    pub fn try_set_number(&self, cx: &mut Cx, index: usize, value: Value) -> bool {
        with_element_type!(self.element_type(),
            T => T::from_numeric(value).is_some_and(|it| self.typed::<T>().set(cx, index, it)),
            bigint => false
        )
    }

    #[inline(always)]
    fn get_element_slot(&self, vm: &Vm, index: usize, slot: &mut PropertySlot) -> bool {
        let value = self.get_element(vm, index);
        value
            .map(|value| slot.set_value(self, Attributes::NONE, value))
            .is_some()
    }

    /// The realm that made it, if it inherits `name` from the prototype that the realm has for its type.
    #[inline]
    fn realm_if_inheriting(&self, vm: &Vm, name: PropertyName<'_>) -> Option<Gc<GlobalObject>> {
        let shape = self.shape();
        let global = shape.global()?;
        let original = global.view_shape(vm, self.cell_type(), self.is_resizable_or_growable());
        (shape == original
            || (shape.prototype() == original.prototype() && shape.get(name).is_none()))
        .then_some(global)
    }

    /// Whether iterating over it comes down to reading its elements.
    #[inline]
    pub fn is_iteration_pristine(&self, vm: &Vm) -> bool {
        let which = RealmWatchpoint::iterator_protocol_of(self.element_type());
        self.realm_if_inheriting(vm, symbols::iterator)
            .is_some_and(|global| global.holds(vm, which))
    }

    /// Whether SpeciesConstructor finds the constructor of the current realm for the type, and nothing sees it look.
    #[inline]
    pub fn is_species_pristine(&self, cx: &Cx) -> bool {
        let which = RealmWatchpoint::species_of(self.element_type());
        self.realm_if_inheriting(cx, names::constructor)
            .is_some_and(|global| global == cx.global() && global.holds(cx, which))
    }
}

/// A typed array whose elements are `T`s.
#[repr(C)]
pub struct TypedArray<T> {
    base: JsTypedArray,
    element: PhantomData<T>,
}

pub type JsUint8Array = TypedArray<u8>;

impl<T> !GcFree for TypedArray<T> {}

impl<T> Deref for TypedArray<T> {
    type Target = JsTypedArray;

    #[inline(always)]
    fn deref(&self) -> &JsTypedArray {
        &self.base
    }
}

// SAFETY: starts with a `JsTypedArray`.
unsafe impl<T, Ancestor> Extends<Ancestor> for TypedArray<T> where JsTypedArray: Extends<Ancestor> {}

// SAFETY: adds nothing, and the type of a cell says what its elements are.
unsafe impl<T: Element> CellKind for TypedArray<T> {
    type Base = JsTypedArray;
    type Init = Never;

    const CLASS: &'static Class = super::classes::class_of_typed_array(T::TYPE);
    const CELL_TYPE: CellType = T::TYPE.cell_type();
    const FLAGS: TypeFlags = JsTypedArray::FLAGS;
    const HOLDS_CLASS: bool = false;
    const OPS: ClassOps = JsTypedArray::OPS;

    #[inline(always)]
    fn is(cell: &JsCell) -> bool {
        cell.cell_type() == Self::CELL_TYPE
    }

    fn shape_of(init: &Self::Init) -> Gc<Shape> {
        match *init {}
    }

    unsafe fn initialize(_: *mut Self, init: Self::Init) {
        match init {}
    }

    fn trace_fields(&self, visitor: &mut Visitor) {
        self.base.trace_fields(visitor);
    }
}

impl<T: Element> TypedArray<T> {
    /// # Safety
    /// As for `bytes_unchecked`.
    #[inline(always)]
    unsafe fn known_elements(&self) -> BufferSlice<'_, T> {
        // SAFETY: the caller's.
        unsafe { BufferSlice::new(self.vector(), self.known_length()) }
    }

    #[inline(always)]
    pub fn get(&self, index: usize) -> Option<T> {
        // SAFETY: only read, at once.
        let get = || unsafe { self.known_elements() }.get(index);
        get().or_else(|| self.is_valid_index(index).then(get).flatten())
    }

    /// False, having done nothing, if the index is out of bounds.
    #[inline(always)]
    pub fn set(&self, _: &mut Cx, index: usize, value: T) -> bool {
        // SAFETY: a borrow would need the `Cx`.
        let set = || unsafe { self.known_elements() }.try_set(index, value);
        set() || (self.is_valid_index(index) && set())
    }

    /// TypedArraySetElement
    #[inline(always)]
    pub fn set_value(&self, cx: &mut Cx, index: usize, value: Value) -> JsResult<()> {
        let value = T::from_value(cx, value)?;
        self.set(cx, index, value);
        Ok(())
    }

    /// Empty if it is out of bounds.
    #[inline(always)]
    pub fn elements<'a>(&'a self, _: &'a NoGc<'_>) -> BufferSlice<'a, T> {
        // SAFETY: what could take them away needs the `Cx` that the token borrows.
        unsafe { self.elements_unchecked() }
    }

    /// # Safety
    /// As for `bytes_unchecked`.
    #[inline(always)]
    pub unsafe fn elements_unchecked(&self) -> BufferSlice<'_, T> {
        if self.is_detached() {
            return BufferSlice::empty();
        }
        // SAFETY: the caller's.
        unsafe { BufferSlice::new(self.vector(), self.length()) }
    }
}
