use bun_alloc::AllocError;
use bun_engine_macros::{cell, object_ops};
use bun_engine_text::{PropertyName, names, symbols};

use super::elements::{MIN_SPARSE_INDEX, is_dense_enough};
use crate::{
    Attributes, CellKind, CellType, Cx, DeletePropertySlot, DontEnumMode, Gc, GlobalObject,
    IndexingMode, JsCell, JsObject, JsObjectInit, JsResult, PropertyDescriptor, PropertyNameList,
    PropertySlot, PutPropertySlot, Shape, ShapeFlags, ShapeSpec, Storage, TransitionKind,
    TypeFlags, Value, Vm, errors,
};

#[cell(name = "Array", cell_type = Array..=DerivedArray, ops, export = "engine_class_Array")]
pub struct JsArray {
    base: JsObject,
}

fn to_array_length(cx: &mut Cx, value: Value) -> JsResult<u32> {
    let length = value.to_uint32(cx)?;
    if value.to_number(cx)? != f64::from(length) {
        return Err(cx.throw_range_error(errors::INVALID_ARRAY_LENGTH));
    }
    Ok(length)
}

#[object_ops]
impl JsArray {
    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if name == names::length {
            let mut attributes = Attributes::DONT_DELETE | Attributes::DONT_ENUM;
            attributes.set(Attributes::READ_ONLY, !self.is_length_writable());
            slot.set_value(self, attributes, self.length().into());
            return Ok(true);
        }
        self.ordinary_get_own_property_slot(cx, name, slot)
    }

    fn put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        if name != names::length {
            return self.ordinary_put(cx, name, value, slot);
        }
        if !self.is_length_writable() {
            return cx.reject(slot.is_strict(), "Array length is not writable");
        }
        if !slot.is_receiver(self) {
            return JsObject::define_property_on_receiver(cx, name, value, slot);
        }
        let length = to_array_length(cx, value)?;
        if length == self.length() {
            return Ok(true);
        }
        self.set_length(cx, length, slot.is_strict())
    }

    fn delete_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut DeletePropertySlot,
    ) -> JsResult<bool> {
        if name == names::length {
            return Ok(false);
        }
        self.ordinary_delete_property(cx, name, slot)
    }

    fn own_special_property_names(
        &self,
        _: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        if mode == DontEnumMode::Include {
            list.add(names::length);
        }
        Ok(())
    }

    fn define_own_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        if name != names::length {
            return self.ordinary_define_own_property(cx, name, descriptor, should_throw);
        }
        let mut descriptor = *descriptor;
        let mut length = self.length();
        if let Some(value) = descriptor.value() {
            length = to_array_length(cx, value)?;
            descriptor.set_value(length.into());
        }
        let mut attributes = Attributes::DONT_DELETE | Attributes::DONT_ENUM;
        attributes.set(Attributes::READ_ONLY, !self.is_length_writable());
        let current = PropertyDescriptor::data(self.length().into(), attributes);
        if let Some(message) = descriptor.conflict_with(cx, &current)? {
            return cx.reject(should_throw, message);
        }
        let result = if descriptor.value().is_some() && length != self.length() {
            self.set_length(cx, length, should_throw)
        } else {
            Ok(true)
        };
        if descriptor.has_writable() && !descriptor.writable() && self.is_length_writable() {
            self.non_property_transition(cx, TransitionKind::MakeLengthReadOnly);
        }
        result
    }
}

impl JsCell {
    /// Unless it is of a class that extends `JsArray`, which may have other internal methods.
    #[inline(always)]
    pub fn as_exact_array(&self) -> Option<Gc<JsArray>> {
        // SAFETY: the type means that class.
        (self.cell_type() == CellType::Array).then(|| unsafe { Gc::from(self).cast_unchecked() })
    }
}

impl Value {
    #[inline(always)]
    pub fn as_exact_array(self) -> Option<Gc<JsArray>> {
        self.as_cell()?.as_exact_array()
    }
}

impl JsArray {
    /// For a type that extends this one.
    pub fn init(base: JsObjectInit) -> JsArrayInit {
        JsArrayInit { base }
    }

    pub(crate) fn create_shape(
        vm: &Vm,
        global: Gc<GlobalObject>,
        prototype: Value,
        mode: IndexingMode,
    ) -> Gc<Shape> {
        let spec = ShapeSpec::of::<JsArray>().with_indexing_mode(mode);
        Shape::create(vm, Some(global), prototype, spec)
    }

    #[inline(always)]
    pub fn length(&self) -> u32 {
        self.public_length()
    }

    #[inline(always)]
    pub fn is_length_writable(&self) -> bool {
        !self.indexing_mode().is_slow_put() || !self.shape().has(ShapeFlags::LENGTH_IS_READ_ONLY)
    }

    pub fn set_length(&self, cx: &mut Cx, length: u32, should_throw: bool) -> JsResult<bool> {
        let old = self.length();
        if !self.is_length_writable() {
            return cx.reject(should_throw, errors::READ_ONLY_PROPERTY_WRITE);
        }
        if length == old {
            return Ok(true);
        }
        let kind = self.element_kind();
        if !kind.is_dense() {
            return self.set_sparse_length(cx, length, should_throw);
        }
        if length > old {
            if !self.stays_dense_with_length(length) {
                return self.set_sparse_length(cx, length, should_throw);
            }
            cx.or_out_of_memory(self.ensure_public_length(cx, length))?;
            return Ok(true);
        }
        let mut kept = length;
        if self.shape().has(ShapeFlags::ELEMENTS_ARE_SEALED) {
            let last = (length..old).rfind(|&index| self.try_get_dense(index).is_some());
            kept = last.map_or(length, |last| last + 1);
        }
        cx.or_out_of_memory(self.truncate(cx, kept))?;
        if kept != length {
            return cx.reject(should_throw, errors::UNABLE_TO_DELETE_PROPERTY);
        }
        Ok(true)
    }

    #[inline]
    fn stays_dense_with_length(&self, length: u32) -> bool {
        length <= self.vector_length()
            || length <= Storage::MAX_VECTOR_LENGTH
                && (length < MIN_SPARSE_INDEX
                    || is_dense_enough(length, self.count_dense_elements()))
    }

    /// If that leaves the shape as it is. Panics unless `has_plain_writable_elements` holds.
    pub fn try_set_dense_length(&self, vm: &Vm, length: u32) -> bool {
        assert!(self.has_plain_writable_elements());
        if length < self.length() {
            return self.truncate(vm, length).is_ok();
        }
        self.stays_dense_with_length(length) && self.ensure_public_length(vm, length).is_ok()
    }

    /// The elements are dense, and `length` is at most the current one.
    fn truncate(&self, vm: &Vm, length: u32) -> Result<(), AllocError> {
        const WORTH_RECLAIMING: u32 = 64;
        if length == self.length() {
            return Ok(());
        }
        if self.indexing_mode().is_copy_on_write() {
            return self.copy_shared_elements(vm, length);
        }
        let (kind, capacity) = (self.element_kind(), self.shape().out_of_line_capacity());
        // SAFETY: all ranges are inside the vectors.
        unsafe {
            let old = self.storage();
            if old.public_length() - length > length.max(WORTH_RECLAIMING) {
                let vector_length = Storage::optimal_vector_length(capacity, length);
                if let Ok(new) = Storage::try_allocate(vm, 0, capacity, Some(vector_length)) {
                    let count = capacity + 1 + length as usize;
                    old.copy_words_to(new, -1 - capacity as isize, count);
                    new.set_lengths(length, vector_length);
                    new.clear_elements(kind, length, vector_length);
                    self.set_storage(new);
                    return Ok(());
                }
            }
            old.clear_elements(kind, length, old.public_length());
            old.set_public_length(length);
        }
        Ok(())
    }

    fn set_sparse_length(&self, cx: &mut Cx, length: u32, should_throw: bool) -> JsResult<bool> {
        let sparse = cx.or_out_of_memory(self.convert_to_sparse(cx))?;
        let (old, mut kept) = (self.length(), length);
        let indices = sparse.try_sorted_indices(length..old, DontEnumMode::Include);
        for index in cx.or_out_of_memory(indices)?.into_iter().rev() {
            if sparse
                .get(index)
                .is_some_and(|it| !it.attributes.is_configurable())
            {
                kept = index + 1;
                break;
            }
            sparse.remove(index);
        }
        // SAFETY: not dense.
        unsafe { self.storage().set_public_length(kept) };
        if kept != length {
            return cx.reject(should_throw, errors::UNABLE_TO_DELETE_PROPERTY);
        }
        if length < old {
            self.convert_to_dense_if_worthwhile(cx, &sparse);
        }
        Ok(true)
    }

    /// `Array.prototype.push` with one argument.
    #[inline(always)]
    pub fn push(&self, cx: &mut Cx, value: Value) -> JsResult<()> {
        if self.try_set_dense(cx, self.length(), value) {
            return Ok(());
        }
        self.push_slow(cx, value)
    }

    #[inline(never)]
    fn push_slow(&self, cx: &mut Cx, value: Value) -> JsResult<()> {
        let length = self.length();
        if self.has_unrestricted_elements() {
            return cx.or_out_of_memory(self.store_element(cx, length, value));
        }
        self.put_by_index(cx, length, value, true)?;
        if length == u32::MAX {
            return Err(cx.throw_range_error(errors::LENGTH_EXCEEDS_MAXIMUM));
        }
        self.set_length(cx, length + 1, true).map(|_| ())
    }

    /// CreateDataPropertyOrThrow at the end, for an array that the engine is filling.
    #[inline(always)]
    pub fn append(&self, cx: &mut Cx, value: Value) -> JsResult<()> {
        self.create_data_index(cx, self.length().into(), value, true)
            .map(|_| ())
    }

    /// Defines them at the end. Panics unless the elements are dense and the array can grow.
    #[inline]
    pub fn append_values(&self, vm: &Vm, values: &[Value]) -> Result<(), AllocError> {
        assert!(
            !self
                .shape()
                .has(ShapeFlags::DID_PREVENT_EXTENSIONS | ShapeFlags::LENGTH_IS_READ_ONLY)
        );
        self.store_elements(vm, self.length(), values)
    }

    /// `Array.prototype.pop`
    #[inline]
    pub fn pop(&self, cx: &mut Cx) -> JsResult<Value> {
        if self.has_plain_writable_elements() {
            let Some(last) = self.length().checked_sub(1) else {
                return Ok(Value::UNDEFINED);
            };
            if let Some(value) = self.try_get_dense(last) {
                // SAFETY: there is an element at that index.
                unsafe {
                    let storage = self.storage();
                    storage.clear_elements(self.element_kind(), last, last + 1);
                    storage.set_public_length(last);
                }
                return Ok(value);
            }
        }
        let Some(last) = self.length().checked_sub(1) else {
            self.set_length(cx, 0, true)?;
            return Ok(Value::UNDEFINED);
        };
        let value = self.get_index(cx, last.into())?;
        self.delete_index_or_throw(cx, last.into())?;
        self.set_length(cx, last, true)?;
        Ok(value)
    }

    /// Whether iterating over it comes down to getting its length and its elements.
    #[inline]
    pub fn is_iteration_pristine(&self) -> bool {
        let shape = self.shape();
        shape.global().is_some_and(|global| {
            global.array_iterator_protocol_is_pristine()
                && self.inherits_from_array_prototype(&global, symbols::iterator)
        })
    }

    /// `global` is its realm.
    #[inline(always)]
    pub fn inherits_from_array_prototype(
        &self,
        global: &GlobalObject,
        name: PropertyName<'_>,
    ) -> bool {
        let shape = self.shape();
        global.is_original_array_shape(&shape)
            || (self.cell_type() == CellType::Array
                && shape.prototype() == global.array_prototype().into()
                && shape.get(name).is_none())
    }
}

const _: () = assert!(JsArray::FLAGS.contains(TypeFlags::OVERRIDES_PUT));
