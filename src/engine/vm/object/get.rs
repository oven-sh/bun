use bun_engine_text::{Identifier, MAX_ARRAY_INDEX, PropertyName, names};

use crate::{
    Attributes, CellType, CustomGetterSetter, Cx, DontEnumMode, Gc, GetterSetter, InternalMethod,
    JsArrayBufferView, JsObject, JsResult, JsTypedArray, MappedArguments, PropertyDescriptor,
    PropertyNameList, PropertyNameMode, PropertyOffset, PropertySlot, TypeFlags, Value,
};

impl JsObject {
    #[inline(always)]
    pub fn ordinary_get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if let Some(index) = name.as_index() {
            return self.ordinary_get_own_property_slot_by_index(cx, index, slot);
        }
        self.get_own_non_index_property_slot(cx, name, slot)
    }

    /// From the shape and the static tables.
    #[inline(always)]
    pub fn get_own_non_index_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if let Some((offset, attributes)) = self.shape().get(name) {
            self.fill_slot(offset, attributes, slot);
            return Ok(true);
        }
        if !self
            .inline_flags()
            .contains(TypeFlags::HAS_STATIC_PROPERTY_TABLE)
        {
            return Ok(false);
        }
        self.get_own_static_property_slot(cx, name, slot)
    }

    #[inline(always)]
    pub(crate) fn fill_slot(
        &self,
        offset: PropertyOffset,
        attributes: Attributes,
        slot: &mut PropertySlot,
    ) {
        // SAFETY: the callers have the offset from the shape.
        let value = unsafe { self.get_direct_unchecked(offset) };
        if attributes.intersects(Attributes::ANY_ACCESSOR) {
            self.fill_accessor_slot(value, attributes, slot);
            if slot.is_value() {
                return;
            }
        } else {
            slot.set_value(self, attributes, value);
        }
        slot.allow_caching(offset);
    }

    #[inline(never)]
    pub(crate) fn fill_accessor_slot(
        &self,
        value: Value,
        attributes: Attributes,
        slot: &mut PropertySlot,
    ) {
        if let Some(accessor) = value.downcast::<GetterSetter>() {
            slot.set_getter(self, attributes, &accessor);
        } else if let Some(custom) = value.downcast::<CustomGetterSetter>() {
            slot.set_custom(self, attributes, custom.getter(), custom.setter());
            slot.set_required_class(custom.required_class());
        } else {
            slot.set_value(self, attributes - Attributes::ANY_ACCESSOR, value);
        }
    }

    /// Along the prototype chain.
    #[inline(always)]
    pub fn get_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if let Some(index) = name.as_index() {
            return self.get_property_slot_by_index(cx, index, slot);
        }
        self.get_non_index_property_slot(cx, name, slot)
    }

    #[inline(always)]
    pub fn get_non_index_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        let mut object = self.as_object();
        loop {
            // What overrides `[[GetPrototypeOf]]` alone hides its prototype, and inherits from it all the same.
            if (object.inline_flags()).contains(TypeFlags::OVERRIDES_GET_OWN_PROPERTY_SLOT) {
                return object.get_non_index_property_slot_slow(cx, name, slot);
            }
            let shape = object.shape();
            if object.get_own_non_index_property_slot(cx, name, slot)? {
                return Ok(true);
            }
            match shape.prototype_object() {
                Some(prototype) => object = prototype,
                None => return Ok(false),
            }
        }
    }

    #[inline(never)]
    fn get_non_index_property_slot_slow(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        let mut object = self.as_object();
        loop {
            if object.get_own_property_slot(cx, name, slot)? {
                return Ok(true);
            }
            if CellType::TYPED_ARRAYS.contains(object.cell_type())
                && !name.is_symbol()
                && bun_engine_number::canonical_numeric_index(name.text()).is_some()
            {
                return Ok(false);
            }
            match object.next_in_lookup(cx, slot)? {
                Some(prototype) => object = prototype,
                None => return Ok(false),
            }
        }
    }

    /// Where to look for what the object does not have.
    #[inline(always)]
    fn next_in_lookup(&self, cx: &mut Cx, slot: &PropertySlot) -> JsResult<Option<Gc<JsObject>>> {
        if slot.is_inquiry() {
            if slot.is_tainted_by_opaque_object() {
                return Ok(None);
            }
            return Ok(self.prototype_object_direct());
        }
        // The answer of a proxy covers its prototypes.
        if self.cell_type() == CellType::Proxy && slot.method() == InternalMethod::HasProperty {
            return Ok(None);
        }
        Ok(self.get_prototype_of(cx)?.as_object())
    }

    pub fn get_property_slot_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        let mut object = self.as_object();
        loop {
            if object.get_own_property_slot_by_index(cx, index, slot)? {
                return Ok(true);
            }
            if CellType::TYPED_ARRAYS.contains(object.cell_type()) {
                return Ok(false);
            }
            match object.next_in_lookup(cx, slot)? {
                Some(prototype) => object = prototype,
                None => return Ok(false),
            }
        }
    }

    #[inline]
    pub fn get(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Value> {
        self.get_with_receiver(cx, name, self.as_value())
    }

    /// `[[Get]]`
    #[inline(always)]
    pub fn get_with_receiver(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        receiver: Value,
    ) -> JsResult<Value> {
        let mut slot = PropertySlot::new(receiver, InternalMethod::Get);
        if self.get_property_slot(cx, name, &mut slot)? {
            slot.value(cx, name)
        } else {
            Ok(Value::UNDEFINED)
        }
    }

    #[inline(always)]
    pub fn get_index(&self, cx: &mut Cx, index: u64) -> JsResult<Value> {
        if let Ok(index) = u32::try_from(index)
            && let Some(value) = self.try_get_index_quickly(index)
        {
            return Ok(value);
        }
        self.get_index_slow(cx, index)
    }

    #[inline(never)]
    fn get_index_slow(&self, cx: &mut Cx, index: u64) -> JsResult<Value> {
        let Some(index) = as_array_index(index) else {
            return self.get(cx, identifier_for_integer(index).name());
        };
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::Get);
        if self.get_property_slot_by_index(cx, index, &mut slot)? {
            slot.value_at_index(cx, index)
        } else {
            Ok(Value::UNDEFINED)
        }
    }

    /// HasProperty, then Get.
    pub fn get_if_has_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
    ) -> JsResult<Option<Value>> {
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::HasProperty);
        if !self.get_property_slot(cx, name, &mut slot)? {
            return Ok(None);
        }
        if slot.is_tainted_by_opaque_object() {
            return self.get(cx, name).map(Some);
        }
        slot.value(cx, name).map(Some)
    }

    /// HasProperty, then Get.
    #[inline(always)]
    pub fn get_index_if_has_property(&self, cx: &mut Cx, index: u64) -> JsResult<Option<Value>> {
        if let Ok(index) = u32::try_from(index)
            && let Some(value) = self.try_get_index_quickly(index)
        {
            return Ok(Some(value));
        }
        self.get_index_if_has_property_slow(cx, index)
    }

    #[inline(never)]
    fn get_index_if_has_property_slow(&self, cx: &mut Cx, index: u64) -> JsResult<Option<Value>> {
        let Some(index) = as_array_index(index) else {
            return self.get_if_has_property(cx, identifier_for_integer(index).name());
        };
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::HasProperty);
        if !self.get_property_slot_by_index(cx, index, &mut slot)? {
            return Ok(None);
        }
        if slot.is_tainted_by_opaque_object() {
            return self.get_index(cx, index.into()).map(Some);
        }
        slot.value_at_index(cx, index).map(Some)
    }

    pub fn has_property(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<bool> {
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::HasProperty);
        self.get_property_slot(cx, name, &mut slot)
    }

    pub fn has_index(&self, cx: &mut Cx, index: u64) -> JsResult<bool> {
        let Some(index) = as_array_index(index) else {
            return self.has_property(cx, identifier_for_integer(index).name());
        };
        if self.try_get_dense(index).is_some() {
            return Ok(true);
        }
        if let Some(array) = self.downcast::<JsTypedArray>() {
            return Ok(array.is_valid_index(index as usize));
        }
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::HasProperty);
        self.get_property_slot_by_index(cx, index, &mut slot)
    }

    /// Whether the property that a lookup finds is enumerable.
    pub fn has_enumerable_property(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<bool> {
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::GetOwnProperty);
        Ok(self.get_property_slot(cx, name, &mut slot)? && slot.is_enumerable())
    }

    pub fn has_enumerable_index(&self, cx: &mut Cx, index: u32) -> JsResult<bool> {
        if self.try_get_index_quickly(index).is_some() {
            return Ok(true);
        }
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::GetOwnProperty);
        Ok(self.get_property_slot_by_index(cx, index, &mut slot)? && slot.is_enumerable())
    }

    pub fn has_own_property(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<bool> {
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::GetOwnProperty);
        self.get_own_property_slot(cx, name, &mut slot)
    }

    pub fn has_own_index(&self, cx: &mut Cx, index: u32) -> JsResult<bool> {
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::GetOwnProperty);
        self.get_own_property_slot_by_index(cx, index, &mut slot)
    }

    /// `[[GetOwnProperty]]`
    #[inline(always)]
    pub fn get_own_property_descriptor(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
    ) -> JsResult<Option<PropertyDescriptor>> {
        if self.cell_type() == CellType::FinalObject
            && let Some((value, attributes)) = self.get_direct_with_attributes(name)
            && !attributes.intersects(Attributes::ANY_ACCESSOR)
        {
            return Ok(Some(PropertyDescriptor::data(value, attributes)));
        }
        cx.check_traps()?;
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::GetOwnProperty);
        if !self.get_own_property_slot(cx, name, &mut slot)? {
            return Ok(None);
        }
        PropertyDescriptor::from_slot(cx, name, &slot).map(Some)
    }

    /// The value of a data property, if it can be found without running any script. Leaves no exception.
    pub fn get_pure(&self, cx: &mut Cx, name: PropertyName<'_>) -> Option<Value> {
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::Inquiry);
        match self.get_property_slot(cx, name, &mut slot) {
            Ok(_) => slot.plain_value(),
            Err(thrown) => {
                cx.discard_unless_termination(thrown);
                None
            }
        }
    }

    /// LengthOfArrayLike
    #[inline(always)]
    pub fn length_of_array_like(&self, cx: &mut Cx) -> JsResult<u64> {
        if let Some(array) = self.as_exact_array() {
            return Ok(array.length().into());
        }
        self.length_of_array_like_slow(cx)
    }

    #[inline(never)]
    fn length_of_array_like_slow(&self, cx: &mut Cx) -> JsResult<u64> {
        match self.try_length_of_array_like() {
            Some(length) => Ok(length.into()),
            None => self.get(cx, names::length)?.to_length(cx),
        }
    }

    #[inline(always)]
    pub fn try_get_index_quickly(&self, index: u32) -> Option<Value> {
        if let Some(value) = self.try_get_dense(index) {
            return Some(value);
        }
        if CellType::TYPED_ARRAYS.contains(self.cell_type()) {
            // SAFETY: the type means that class.
            let view = unsafe { self.as_object().cast_unchecked::<JsArrayBufferView>() };
            return view.try_get_number(index as usize);
        }
        self.downcast::<MappedArguments>()?.try_get(index)
    }

    pub fn ordinary_own_property_names(
        &self,
        cx: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        self.own_indexed_property_names(list, mode);
        self.own_non_index_property_names(cx, list, mode)
    }

    pub fn own_non_index_property_names(
        &self,
        cx: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        if self
            .shape()
            .type_flags()
            .contains(TypeFlags::OVERRIDES_OWN_SPECIAL_PROPERTY_NAMES)
        {
            self.own_special_property_names(cx, list, mode)?;
        }
        let shape = self.shape();
        if !shape.has_non_reified_static_properties() {
            shape.collect_property_names(list, mode);
            return Ok(());
        }
        for wants_symbols in [false, true] {
            self.static_property_names(list, mode, wants_symbols);
            for (name, _, attributes) in shape.properties().iter() {
                if name.is_symbol() == wants_symbols && mode.includes(attributes) {
                    list.add(name);
                }
            }
        }
        Ok(())
    }

    /// `[[OwnPropertyKeys]]`, filtered.
    pub fn own_keys(
        &self,
        cx: &mut Cx,
        kinds: PropertyNameMode,
        mode: DontEnumMode,
    ) -> JsResult<PropertyNameList> {
        let mut list = PropertyNameList::new(kinds);
        self.own_property_names(cx, &mut list, mode)?;
        Ok(list)
    }

    /// Of the object and its prototypes.
    pub fn property_names(
        &self,
        cx: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        let mut object = self.as_object();
        for _ in 0..=Self::MAX_PROTOTYPE_CHAIN_DEPTH {
            object.own_property_names(cx, list, mode)?;
            match object.get_prototype_of(cx)?.as_object() {
                Some(prototype) => object = prototype,
                None => return Ok(()),
            }
        }
        Err(cx.throw_stack_overflow())
    }
}

#[inline(always)]
pub(super) fn as_array_index(index: u64) -> Option<u32> {
    (index <= u64::from(MAX_ARRAY_INDEX)).then_some(index as u32)
}

#[cold]
pub(super) fn identifier_for_integer(index: u64) -> Identifier {
    Identifier::new(bun_engine_number::NumberText::from(index as f64).text())
}
