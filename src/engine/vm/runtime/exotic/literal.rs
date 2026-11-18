//! What object literals and class definitions are made with.

use bun_engine_bytecode::DefineFlags;
use bun_engine_text::Identifier;

use crate::{
    Attributes, Cx, Gc, GetterSetter, JsFinalObject, JsFunction, JsObject, JsResult,
    PropertyDescriptor, Shape, Value,
};

impl Shape {
    /// For `new_object`.
    pub fn for_new_object(cx: &Cx, capacity: usize) -> Gc<Shape> {
        let capacity = JsFinalObject::optimal_inline_capacity(capacity);
        if capacity == JsFinalObject::DEFAULT_INLINE_CAPACITY {
            return cx.object_shape();
        }
        Shape::for_empty_object(cx, cx.global(), cx.object_prototype(), capacity)
    }

    /// For `new_object_literal`. Panics unless the names are distinct, no indices, and few enough for a shape that is
    /// no dictionary.
    pub fn for_object_literal(cx: &Cx, names: &[Identifier], capacity: usize) -> Gc<Shape> {
        assert!(names.len() <= Shape::MAX_TRANSITIONS_BY_PUT_BY_ID);
        let empty = Self::for_new_object(cx, capacity.max(names.len()));
        names.iter().fold(empty, |shape, name| {
            shape
                .add_property_transition(cx, name.name(), Attributes::NONE)
                .0
        })
    }
}

fn attributes_for(flags: DefineFlags) -> Attributes {
    if flags.contains(DefineFlags::ENUMERABLE) {
        Attributes::NONE
    } else {
        Attributes::DONT_ENUM
    }
}

impl JsObject {
    /// `define_method`
    pub fn define_method(
        &self,
        cx: &mut Cx,
        key: Value,
        function: Gc<JsFunction>,
        flags: DefineFlags,
    ) -> JsResult<()> {
        let key = key.to_property_key(cx)?;
        if flags.contains(DefineFlags::SET_NAME) {
            function.set_function_name(cx, key.value())?;
        }
        let (name, attributes) = (key.name(), attributes_for(flags));
        if name.as_index().is_none() && self.can_put_direct_fast(name) {
            self.put_direct(cx, name, function.into(), attributes);
            return Ok(());
        }
        let descriptor = PropertyDescriptor::data(function.into(), attributes);
        self.define_property_or_throw(cx, name, &descriptor)
    }

    /// `define_accessor`
    pub fn define_accessor(
        &self,
        cx: &mut Cx,
        key: Value,
        getter: Value,
        setter: Value,
        flags: DefineFlags,
    ) -> JsResult<()> {
        let key = key.to_property_key(cx)?;
        if flags.contains(DefineFlags::SET_NAME) {
            for function in [getter, setter] {
                if let Some(function) = function.downcast::<JsFunction>() {
                    function.set_function_name(cx, key.value())?;
                }
            }
        }
        let name = key.name();
        if name.as_index().is_none()
            && self.can_put_direct_fast(name)
            && self.shape().get(name).is_none()
        {
            let accessor = GetterSetter::create(cx, getter.as_object(), setter.as_object());
            self.put_direct_accessor(cx, name, accessor, attributes_for(flags));
            return Ok(());
        }
        let mut descriptor = PropertyDescriptor::default();
        descriptor.set_configurable(true);
        descriptor.set_enumerable(flags.contains(DefineFlags::ENUMERABLE));
        if flags.contains(DefineFlags::HAS_GETTER) {
            descriptor.set_getter(getter);
        }
        if flags.contains(DefineFlags::HAS_SETTER) {
            descriptor.set_setter(setter);
        }
        self.define_property_or_throw(cx, name, &descriptor)
    }
}
