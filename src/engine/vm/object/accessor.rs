use bun_engine_macros::cell;

use crate::{
    Class, CustomGetter, CustomSetter, Cx, Gc, GlobalObject, JsCell, JsObject, JsResult, TypeFlags,
    Value, Vm, errors,
};

/// What the slot of an accessor property has.
#[cell(cell_type = GetterSetter, export = "engine_class_GetterSetter", flags = TypeFlags::SHAPE_IS_IMMORTAL)]
pub struct GetterSetter {
    base: JsCell,
    getter: Option<Gc<JsObject>>,
    setter: Option<Gc<JsObject>>,
}

#[inline(always)]
pub(crate) fn as_seen_by_scripts(receiver: Value) -> Value {
    (receiver.downcast::<GlobalObject>()).map_or(receiver, |global| global.global_this().into())
}

impl GetterSetter {
    pub const OFFSET_OF_GETTER: usize = core::mem::offset_of!(GetterSetter, getter);
    pub const OFFSET_OF_SETTER: usize = core::mem::offset_of!(GetterSetter, setter);

    pub fn create(
        vm: &Vm,
        getter: Option<Gc<JsObject>>,
        setter: Option<Gc<JsObject>>,
    ) -> Gc<GetterSetter> {
        vm.allocate::<GetterSetter>(GetterSetterInit {
            base: vm.shapes.getter_setter(),
            getter,
            setter,
        })
    }

    #[inline(always)]
    pub fn getter(&self) -> Option<Gc<JsObject>> {
        self.getter
    }

    #[inline(always)]
    pub fn setter(&self) -> Option<Gc<JsObject>> {
        self.setter
    }

    pub fn call_getter(&self, cx: &mut Cx, this: Value) -> JsResult<Value> {
        match self.getter {
            Some(getter) => cx.call(getter.into(), as_seen_by_scripts(this), &[]),
            None => Ok(Value::UNDEFINED),
        }
    }

    pub fn call_setter(
        &self,
        cx: &mut Cx,
        this: Value,
        value: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        match self.setter {
            Some(setter) => {
                cx.call(setter.into(), as_seen_by_scripts(this), &[value])?;
                Ok(true)
            }
            None => cx.reject(should_throw, errors::READ_ONLY_PROPERTY_WRITE),
        }
    }
}

/// What the slot of a property has whose value native code provides.
#[cell(cell_type = CustomGetterSetter, export = "engine_class_CustomGetterSetter", flags = TypeFlags::SHAPE_IS_IMMORTAL)]
pub struct CustomGetterSetter {
    base: JsCell,
    getter: Option<CustomGetter>,
    setter: Option<CustomSetter>,
    required_class: Option<&'static Class>,
}

impl CustomGetterSetter {
    pub const OFFSET_OF_GETTER: usize = core::mem::offset_of!(CustomGetterSetter, getter);
    pub const OFFSET_OF_SETTER: usize = core::mem::offset_of!(CustomGetterSetter, setter);
    pub const OFFSET_OF_REQUIRED_CLASS: usize =
        core::mem::offset_of!(CustomGetterSetter, required_class);

    pub fn create(
        vm: &Vm,
        getter: Option<CustomGetter>,
        setter: Option<CustomSetter>,
        required_class: Option<&'static Class>,
    ) -> Gc<CustomGetterSetter> {
        vm.allocate::<CustomGetterSetter>(CustomGetterSetterInit {
            base: vm.shapes.custom_getter_setter(),
            getter,
            setter,
            required_class,
        })
    }

    pub fn getter(&self) -> Option<CustomGetter> {
        self.getter
    }

    pub fn setter(&self) -> Option<CustomSetter> {
        self.setter
    }

    pub fn required_class(&self) -> Option<&'static Class> {
        self.required_class
    }
}
