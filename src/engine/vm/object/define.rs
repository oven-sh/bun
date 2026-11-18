use bun_engine_text::PropertyName;

use super::get::{as_array_index, identifier_for_integer};
use crate::{
    Attributes, CellType, CustomGetterSetter, Cx, JsObject, JsResult, PropertyDescriptor,
    PutDirectIndexMode, PutPropertySlot, ShapeFlags, Value, errors,
};

/// IsCompatiblePropertyDescriptor
pub fn validate_property_descriptor(
    cx: &mut Cx,
    is_extensible: bool,
    descriptor: &PropertyDescriptor,
    current: Option<&PropertyDescriptor>,
    should_throw: bool,
) -> JsResult<bool> {
    let conflict = match current {
        Some(current) => descriptor.conflict_with(cx, current)?,
        None => (!is_extensible).then_some(errors::NON_EXTENSIBLE_DEFINE),
    };
    match conflict {
        Some(message) => cx.reject(should_throw, message),
        None => Ok(true),
    }
}

impl JsObject {
    pub fn ordinary_define_own_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        match name.as_index() {
            Some(index) => self.define_own_indexed_property(cx, index, descriptor, should_throw),
            None => self.define_own_non_index_property(cx, name, descriptor, should_throw),
        }
    }

    pub fn define_own_non_index_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        let shape = self.shape();
        if self.cell_type() == CellType::FinalObject
            && shape.is_extensible()
            && ((shape.existing_add_transition(name, descriptor.attributes_for_new())).is_some()
                || shape.get(name).is_none())
        {
            let (value, attributes) = descriptor.apply_to(cx, None);
            self.put_direct_stored(cx, name, value, attributes);
            return Ok(true);
        }
        let current = self.get_own_property_descriptor(cx, name)?;
        let current = current.as_ref();
        let is_extensible = self.is_extensible(cx)?;
        if !validate_property_descriptor(cx, is_extensible, descriptor, current, should_throw)? {
            return Ok(false);
        }
        if let Some(current) = current {
            if descriptor.changes_nothing(cx, current)? {
                return Ok(true);
            }
            if let Some(value) = descriptor.value()
                && descriptor.attributes_overriding(current) == current.attributes()
                && let Some(setter) = self.setter_of_custom_value(name)
            {
                let cx = cx.in_realm_of(self);
                let result = setter(cx, self.as_value(), value, name);
                cx.check_exception()?;
                return Ok(result);
            }
        }
        let (value, attributes) = descriptor.apply_to(cx, current);
        self.put_direct_stored(cx, name, value, attributes);
        Ok(true)
    }

    fn setter_of_custom_value(&self, name: PropertyName<'_>) -> Option<crate::CustomSetter> {
        if !self.shape().has(ShapeFlags::HAS_ANY_ACCESSOR) {
            return None;
        }
        let (value, attributes) = self.get_direct_with_attributes(name)?;
        if !attributes.contains(Attributes::CUSTOM_VALUE) || !attributes.is_writable() {
            return None;
        }
        value.downcast::<CustomGetterSetter>()?.setter()
    }

    /// DefinePropertyOrThrow
    pub fn define_property_or_throw(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        descriptor: &PropertyDescriptor,
    ) -> JsResult<()> {
        self.define_own_property(cx, name, descriptor, true)
            .map(|_| ())
    }

    /// Whether defining a data property with all attributes given comes down to `put_direct`.
    #[inline]
    pub fn can_put_direct_fast(&self, name: PropertyName<'_>) -> bool {
        let shape = self.shape();
        if !shape.is_extensible()
            || shape.has_non_reified_static_properties()
            || !(self.cell_type() == CellType::FinalObject || self.defines_ordinarily(name))
        {
            return false;
        }
        !shape.has(ShapeFlags::HAS_NON_CONFIGURABLE | ShapeFlags::HAS_ANY_ACCESSOR)
            || shape.get(name).is_none_or(|(_, attributes)| {
                !attributes.intersects(Attributes::DONT_DELETE | Attributes::CUSTOM_VALUE)
            })
    }

    fn defines_ordinarily(&self, name: PropertyName<'_>) -> bool {
        self.class().has_ordinary_define_own_property() || self.shape().is_ordinary_name(name)
    }

    /// CreateDataProperty
    #[inline]
    pub fn create_data_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        let mut slot = PutPropertySlot::new(self.as_value(), should_throw);
        self.create_data_property_with_slot(cx, name, value, &mut slot)
    }

    #[inline(always)]
    pub fn create_data_property_with_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        if let Some(index) = name.as_index() {
            return self.create_data_index(cx, index.into(), value, slot.is_strict());
        }
        if self.can_put_direct_fast(name) {
            self.put_direct_with_slot(cx, name, value, Attributes::NONE, slot);
            return Ok(true);
        }
        slot.disable_caching();
        let descriptor = PropertyDescriptor::data(value, Attributes::NONE);
        self.define_own_property(cx, name, &descriptor, slot.is_strict())
    }

    /// CreateDataProperty(O, ToString(index), V)
    #[inline(always)]
    pub fn create_data_index(
        &self,
        cx: &mut Cx,
        index: u64,
        value: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        let Some(index) = as_array_index(index) else {
            let name = identifier_for_integer(index);
            return self.create_data_property(cx, name.name(), value, should_throw);
        };
        let mode = if should_throw {
            PutDirectIndexMode::ShouldThrow
        } else {
            PutDirectIndexMode::ShouldNotThrow
        };
        self.put_direct_index_with(cx, index, value, Attributes::NONE, mode)
    }
}
