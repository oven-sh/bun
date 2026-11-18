//! Private fields, and the brands that stand for the private methods of a class. Both are properties in the shape,
//! whatever the kind of object, with a private symbol for a key.

use bun_engine_text::PropertyName;

use crate::errors::{
    throw_invalid_in_parameter, throw_not_an_object, throw_type_error_with_source,
};
use crate::{
    Attributes, CellType, Cx, Gc, JsObject, JsResult, PropertySlot, PutPropertySlot, Value,
};

const NO_SUCH_FIELD: &str = "Cannot access invalid private field";
const NO_SUCH_BRAND: &str = "Cannot access private method or acessor";

impl JsObject {
    #[inline]
    pub fn has_private_element(&self, name: PropertyName<'_>) -> bool {
        self.shape().get(name).is_some()
    }

    fn add_private_element(
        &self,
        cx: &Cx,
        name: PropertyName<'_>,
        value: Value,
        attributes: Attributes,
        slot: &mut PutPropertySlot,
        [already_there, not_allowed]: [&'static str; 2],
    ) -> JsResult<()> {
        if self.cell_type() == CellType::WasmGcObject {
            return Err(cx.throw_type_error(not_allowed));
        }
        if self.has_private_element(name) {
            return Err(throw_type_error_with_source(cx, already_there));
        }
        self.put_direct_with_slot(cx, name, value, attributes, slot);
        Ok(())
    }

    /// PrivateFieldAdd
    pub fn define_private_field(
        &self,
        cx: &Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<()> {
        let messages = [
            "Cannot redefine existing private field",
            "Cannot define private field on a WebAssembly GC object",
        ];
        self.add_private_element(cx, name, value, Attributes::NONE, slot, messages)
    }

    /// PrivateMethodOrAccessorAdd, for all that a class has. An embedder that lists private fields passes over it.
    pub fn set_private_brand(
        &self,
        cx: &Cx,
        brand: PropertyName<'_>,
        slot: &mut PutPropertySlot,
    ) -> JsResult<()> {
        let messages = [
            "Cannot install same private methods on object more than once",
            "Cannot add private method to a WebAssembly GC object",
        ];
        let (value, attributes) = (Self::PRIVATE_BRAND_VALUE, Attributes::DONT_ENUM);
        self.add_private_element(cx, brand, value, attributes, slot, messages)
    }

    /// What the slot of a brand has.
    pub const PRIVATE_BRAND_VALUE: Value = Value::TRUE;
}

impl Value {
    #[inline(always)]
    fn holder_of_private_element(self, cx: &Cx, message: &'static str) -> JsResult<Gc<JsObject>> {
        match self.as_object() {
            Some(object) => Ok(object),
            None if self.is_undefined_or_null() => Err(throw_not_an_object(cx, self)),
            None => Err(throw_type_error_with_source(cx, message)),
        }
    }

    #[inline(always)]
    fn find_private_element(
        self,
        cx: &Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
        message: &'static str,
    ) -> JsResult<Value> {
        let object = self.holder_of_private_element(cx, message)?;
        let Some((offset, attributes)) = object.shape().get(name) else {
            return Err(throw_type_error_with_source(cx, message));
        };
        object.fill_slot(offset, attributes, slot);
        Ok(slot.plain_value().unwrap_or_default())
    }

    /// PrivateGet
    pub fn get_private_field(
        self,
        cx: &Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<Value> {
        self.find_private_element(cx, name, slot, NO_SUCH_FIELD)
    }

    /// PrivateSet
    pub fn set_private_field(
        self,
        cx: &Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<()> {
        let object = self.holder_of_private_element(cx, NO_SUCH_FIELD)?;
        if !object.has_private_element(name) {
            return Err(throw_type_error_with_source(cx, NO_SUCH_FIELD));
        }
        object.put_direct_with_slot(cx, name, value, Attributes::NONE, slot);
        Ok(())
    }

    pub fn check_private_brand(
        self,
        cx: &Cx,
        brand: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<()> {
        self.find_private_element(cx, brand, slot, NO_SUCH_BRAND)
            .map(|_| ())
    }

    /// `#name in self`, given the name of the field or the brand.
    pub fn has_private_element(self, cx: &Cx, name: PropertyName<'_>) -> JsResult<bool> {
        match self.as_object() {
            Some(object) => Ok(object.has_private_element(name)),
            None => Err(throw_invalid_in_parameter(cx, self)),
        }
    }
}
