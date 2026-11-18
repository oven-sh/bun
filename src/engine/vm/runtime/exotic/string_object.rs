use bun_engine_macros::{cell, object_ops};
use bun_engine_text::{PropertyName, names};

use crate::{
    Cx, DeletePropertySlot, DontEnumMode, Gc, InternalMethod, JsResult, JsString, JsWrapperObject,
    JsWrapperObjectInit, PropertyDescriptor, PropertyNameList, PropertySlot, PutPropertySlot,
    Shape, TypeFlags, Value, Vm, errors, validate_property_descriptor,
};

#[cell(name = "String", cell_type = StringObject..=DerivedStringObject, ops,
    export = "engine_class_StringObject", flags = TypeFlags::INTERCEPTS_INDEXED_ACCESS)]
pub struct StringObject {
    base: JsWrapperObject,
}

impl StringObject {
    pub fn init(vm: &Vm, shape: Gc<Shape>, string: Gc<JsString>) -> StringObjectInit {
        let base: JsWrapperObjectInit = JsWrapperObject::init(vm, shape, string.into());
        StringObjectInit { base }
    }

    pub fn create(vm: &Vm, shape: Gc<Shape>, string: Gc<JsString>) -> Gc<StringObject> {
        vm.allocate::<StringObject>(Self::init(vm, shape, string))
    }

    pub fn string(&self) -> Gc<JsString> {
        self.internal_value().cast()
    }

    fn is_string_property(&self, name: PropertyName<'_>) -> bool {
        name == names::length || name.as_index().is_some_and(|it| it < self.string().len())
    }
}

#[object_ops]
impl StringObject {
    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        Ok(self.string().get_string_property_slot(cx, name, slot)?
            || self.ordinary_get_own_property_slot(cx, name, slot)?)
    }

    fn get_own_property_slot_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        Ok(self.string().get_string_index_slot(cx, index, slot)?
            || self.ordinary_get_own_property_slot_by_index(cx, index, slot)?)
    }

    fn put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        if self.is_string_property(name) {
            return cx.reject(slot.is_strict(), errors::READ_ONLY_PROPERTY_WRITE);
        }
        self.ordinary_put(cx, name, value, slot)
    }

    fn put_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        value: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        if index < self.string().len() {
            return cx.reject(should_throw, errors::READ_ONLY_PROPERTY_WRITE);
        }
        self.ordinary_put_by_index(cx, index, value, should_throw)
    }

    fn delete_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut DeletePropertySlot,
    ) -> JsResult<bool> {
        Ok(!self.is_string_property(name) && self.ordinary_delete_property(cx, name, slot)?)
    }

    fn delete_property_by_index(&self, cx: &mut Cx, index: u32) -> JsResult<bool> {
        Ok(index >= self.string().len() && self.ordinary_delete_property_by_index(cx, index)?)
    }

    fn define_own_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        if !self.is_string_property(name) {
            return self.ordinary_define_own_property(cx, name, descriptor, should_throw);
        }
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::GetOwnProperty);
        self.string()
            .get_string_property_slot(cx, name, &mut slot)?;
        let current = PropertyDescriptor::from_slot(cx, name, &slot)?;
        validate_property_descriptor(cx, false, descriptor, Some(&current), should_throw)
    }

    fn own_property_names(
        &self,
        cx: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        list.add_indices_below(cx, self.string().len() as usize)?;
        self.own_indexed_property_names(list, mode);
        if mode == DontEnumMode::Include {
            list.add(names::length);
        }
        self.own_non_index_property_names(cx, list, mode)
    }
}
