use bun_engine_text::{Identifier, PropertyName, names};

use crate::{
    CellType, Cx, Gc, InternalMethod, JsObject, JsResult, PropertySlot, PutPropertySlot, Value,
    errors,
};

impl Value {
    /// The prototype of what ToObject would make of a primitive.
    pub fn synthesize_prototype(self, cx: &Cx) -> JsResult<Gc<JsObject>> {
        Ok(match self.as_cell().map(|cell| cell.cell_type()) {
            Some(CellType::String) => cx.string_prototype(),
            Some(CellType::Symbol) => cx.symbol_prototype(),
            Some(CellType::BigInt) => cx.bigint_prototype(),
            Some(_) => unreachable!(),
            None if self.is_number() => cx.number_prototype(),
            None if self.is_boolean() => cx.boolean_prototype(),
            None => return Err(errors::throw_not_an_object(cx, self)),
        })
    }

    #[inline(always)]
    pub fn get_property_slot(
        self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if let Some(object) = self.as_object() {
            return object.get_property_slot(cx, name, slot);
        }
        if let Some(string) = self.as_string()
            && string.get_string_property_slot(cx, name, slot)?
        {
            return Ok(true);
        }
        self.synthesize_prototype(cx)?
            .get_property_slot(cx, name, slot)
    }

    /// GetV
    #[inline]
    pub fn get(self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Value> {
        let mut slot = PropertySlot::new(self, InternalMethod::Get);
        if self.get_property_slot(cx, name, &mut slot)? {
            slot.value(cx, name)
        } else {
            Ok(Value::UNDEFINED)
        }
    }

    pub fn get_index(self, cx: &mut Cx, index: u32) -> JsResult<Value> {
        if let Some(object) = self.as_object() {
            return object.get_index(cx, index.into());
        }
        if let Some(string) = self.as_string()
            && index < string.len()
        {
            return string.string_at(cx, index).map(Into::into);
        }
        let mut slot = PropertySlot::new(self, InternalMethod::Get);
        let prototype = self.synthesize_prototype(cx)?;
        if prototype.get_property_slot_by_index(cx, index, &mut slot)? {
            slot.value_at_index(cx, index)
        } else {
            Ok(Value::UNDEFINED)
        }
    }

    /// `self[key]`
    #[inline]
    pub fn get_by_value(self, cx: &mut Cx, key: Value) -> JsResult<Value> {
        if let Some(index) = key.as_array_index() {
            return self.get_index(cx, index);
        }
        if self.is_undefined_or_null() {
            return Err(errors::throw_not_an_object(cx, self));
        }
        let key = key.to_property_key(cx)?;
        self.get(cx, key.name())
    }

    /// GetMethod. `message` is that of the error if the value cannot be called.
    pub fn get_method(
        self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        message: &'static str,
    ) -> JsResult<Option<Value>> {
        let method = self.get(cx, name)?;
        if method.is_undefined_or_null() {
            return Ok(None);
        }
        if !method.is_callable() {
            return Err(cx.throw_type_error(message));
        }
        Ok(Some(method))
    }

    #[inline(always)]
    pub fn put(
        self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        match self.as_object() {
            Some(object) => object.put(cx, name, value, slot),
            None => self.put_to_primitive(cx, name, value, slot),
        }
    }

    #[inline(never)]
    fn put_to_primitive(
        self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        if let Some(string) = self.as_string()
            && (name == names::length || name.as_index().is_some_and(|it| it < string.len()))
        {
            return cx.reject(slot.is_strict(), errors::READ_ONLY_PROPERTY_WRITE);
        }
        self.synthesize_prototype(cx)?.put(cx, name, value, slot)
    }

    pub fn put_index(
        self,
        cx: &mut Cx,
        index: u32,
        value: Value,
        is_strict: bool,
    ) -> JsResult<bool> {
        if let Some(object) = self.as_object() {
            return object.set_index(cx, index.into(), value, is_strict);
        }
        let mut slot = PutPropertySlot::new(self, is_strict);
        self.put_to_primitive(cx, Identifier::from_index(index).name(), value, &mut slot)
    }

    /// `self[key] = value`
    #[inline]
    pub fn put_by_value(
        self,
        cx: &mut Cx,
        key: Value,
        value: Value,
        is_strict: bool,
    ) -> JsResult<bool> {
        if let Some(index) = key.as_array_index() {
            return self.put_index(cx, index, value, is_strict);
        }
        if self.is_undefined_or_null() {
            return Err(errors::throw_not_an_object(cx, self));
        }
        let key = key.to_property_key(cx)?;
        let mut slot = PutPropertySlot::new(self, is_strict);
        self.put(cx, key.name(), value, &mut slot)
    }

    /// An object or null.
    pub fn get_prototype_of(self, cx: &mut Cx) -> JsResult<Value> {
        match self.as_object() {
            Some(object) => object.get_prototype_of(cx),
            None => self.synthesize_prototype(cx).map(Into::into),
        }
    }
}
