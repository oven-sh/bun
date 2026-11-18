use bun_engine_text::{StringRef, names, symbols};

use crate::function::name_for_instances;
use crate::{
    CellType, Cx, Gc, InternalMethod, JsFinalObject, JsFunction, JsObject, JsResult, PropertySlot,
    ProxyObject, TypeFlags, Value, errors, function_realm,
};

/// IsArray
#[inline]
pub fn is_array(cx: &Cx, value: Value) -> JsResult<bool> {
    is_array_for(cx, value, "Array.isArray")
}

/// `caller` is what the error blames.
#[inline(always)]
pub(crate) fn is_array_for(cx: &Cx, value: Value, caller: &str) -> JsResult<bool> {
    let Some(mut object) = value.as_object() else {
        return Ok(false);
    };
    while let Some(proxy) = object.downcast::<ProxyObject>() {
        if proxy.is_revoked() {
            return Err(cx.throw_type_error(format_args!(
                "{caller} cannot be called on a Proxy that has been revoked"
            )));
        }
        object = proxy.target();
    }
    Ok(CellType::ARRAYS.contains(object.cell_type()))
}

/// The steps of CreateListFromArrayLike.
pub fn for_each_in_array_like(
    cx: &mut Cx,
    object: &JsObject,
    mut visit: impl FnMut(&mut Cx, Value) -> JsResult<()>,
) -> JsResult<()> {
    for index in 0..object.length_of_array_like(cx)? {
        let value = object.get_index(cx, index)?;
        visit(cx, value)?;
        cx.check_traps()?;
    }
    Ok(())
}

/// SpeciesConstructor. `None` stands for the default.
pub fn species_constructor(cx: &mut Cx, object: &JsObject) -> JsResult<Option<Gc<JsObject>>> {
    let constructor = object.get(cx, names::constructor)?;
    if constructor.is_undefined() {
        return Ok(None);
    }
    let Some(constructor) = constructor.as_object() else {
        return Err(cx.throw_type_error("|this|.constructor is not an Object or undefined"));
    };
    let species = constructor.get(cx, symbols::species)?;
    if species.is_undefined_or_null() {
        return Ok(None);
    }
    if !species.is_constructor() {
        let message = "|this|.constructor[Symbol.species] is not a constructor";
        return Err(cx.throw_type_error(message));
    }
    Ok(species.as_object())
}

impl JsObject {
    /// What a constructor that has this for `new.target` starts with.
    #[inline]
    pub fn create_this(&self, cx: &mut Cx, capacity: u32) -> JsResult<Gc<JsObject>> {
        if let Some(function) = self.downcast::<JsFunction>()
            && function.can_use_allocation_profile()
        {
            let shape = function.shape_for_construction(cx, capacity as usize);
            return Ok(JsFinalObject::create(cx, shape).upcast());
        }
        let prototype = match self.get(cx, names::prototype)?.as_object() {
            Some(prototype) => prototype,
            None => function_realm(cx, self.into())?.object_prototype(),
        };
        Ok(cx.new_object_with_prototype(Some(prototype)))
    }

    /// InstanceofOperator
    pub fn has_instance(&self, cx: &mut Cx, value: Value) -> JsResult<bool> {
        let method = self.get(cx, symbols::hasInstance)?;
        self.has_instance_with(cx, value, method)
    }

    pub fn has_instance_with(&self, cx: &mut Cx, value: Value, method: Value) -> JsResult<bool> {
        if !method.is_undefined_or_null() && method != cx.function_prototype_has_instance().into() {
            if !method.is_callable() {
                return Err(errors::throw_has_instance_not_a_function(
                    cx,
                    self.as_value(),
                ));
            }
            return Ok(cx.call(method, self.as_value(), &[value])?.to_boolean(cx));
        }
        if !self.shape().type_flags().intersects(
            TypeFlags::IMPLEMENTS_DEFAULT_HAS_INSTANCE | TypeFlags::IMPLEMENTS_HAS_INSTANCE,
        ) {
            return Err(errors::throw_instanceof_not_a_function(cx, self.as_value()));
        }
        self.ordinary_has_instance(cx, value)
    }

    /// OrdinaryHasInstance
    pub fn ordinary_has_instance(&self, cx: &mut Cx, value: Value) -> JsResult<bool> {
        let flags = self.shape().type_flags();
        if flags.contains(TypeFlags::IMPLEMENTS_DEFAULT_HAS_INSTANCE) {
            if !value.is_object() {
                return Ok(false);
            }
            let prototype = self.get(cx, names::prototype)?;
            return Self::default_has_instance(cx, value, prototype);
        }
        if flags.contains(TypeFlags::IMPLEMENTS_HAS_INSTANCE) {
            cx.check_stack()?;
            return self.custom_has_instance(cx, value);
        }
        Ok(false)
    }

    /// Whether `prototype` is on the prototype chain of `value`.
    pub fn default_has_instance(cx: &mut Cx, value: Value, prototype: Value) -> JsResult<bool> {
        let Some(mut object) = value.as_object() else {
            return Ok(false);
        };
        if !prototype.is_object() {
            let message = "instanceof called on an object with an invalid prototype property.";
            return Err(cx.throw_type_error(message));
        }
        loop {
            let next = object.get_prototype_of(cx)?;
            if next == prototype {
                return Ok(true);
            }
            match next.as_object() {
                Some(next) => object = next,
                None => return Ok(false),
            }
        }
    }

    /// What messages call the class of the object. Runs no script.
    pub fn calculated_class_name(&self, cx: &mut Cx) -> StringRef {
        let cx = cx.in_realm_of(self);
        let name_of = |constructor: Option<Value>| name_for_instances(&*constructor?.as_object()?);
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::Inquiry);
        let own = self.ordinary_get_own_property_slot(cx, names::constructor, &mut slot);
        if let Err(thrown) = own {
            cx.discard_unless_termination(thrown);
        }
        let mut name = name_of(slot.plain_value());
        if name.is_none()
            && !self.overrides_get_prototype()
            && let Some(prototype) = self.prototype_object_direct()
        {
            name = name_of(prototype.get_pure(cx, names::constructor));
        }
        if let Some(name) = name.filter(|name| name.text() != names::Object.text()) {
            return name;
        }
        match self
            .get_pure(cx, symbols::toStringTag)
            .and_then(Value::as_string)
        {
            Some(tag) => tag.to_string_without_collecting(),
            None => StringRef::from_literal(self.class().name()),
        }
    }
}
