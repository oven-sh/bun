use bun_engine_macros::FieldOffsets;
use bun_engine_text::{PropertyName, names};

use crate::{
    Attributes, CellType, Cx, Gc, GetterSetter, JsFinalObject, JsFunction, JsObject, JsResult,
    PropertySlot, RealmWatchpoint, Shape, ShapeFlags, Value, Vm, errors,
};

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    #[repr(transparent)]
    struct Present: u32 {
        const WRITABLE = 1 << 0;
        const ENUMERABLE = 1 << 1;
        const CONFIGURABLE = 1 << 2;
    }
}

/// The Property Descriptor of ECMA-262. An absent attribute reads as false.
#[derive(Clone, Copy, FieldOffsets)]
#[repr(C)]
pub struct PropertyDescriptor {
    value: Option<Value>,
    getter: Option<Value>,
    setter: Option<Value>,
    attributes: Attributes,
    present: Present,
}

const FIELDS: [PropertyName<'static>; 6] = [
    names::value,
    names::enumerable,
    names::configurable,
    names::writable,
    names::get,
    names::set,
];

impl Default for PropertyDescriptor {
    fn default() -> PropertyDescriptor {
        PropertyDescriptor {
            value: None,
            getter: None,
            setter: None,
            attributes: Attributes::CONSTANT,
            present: Present::empty(),
        }
    }
}

impl PropertyDescriptor {
    #[inline]
    pub fn data(value: Value, attributes: Attributes) -> PropertyDescriptor {
        PropertyDescriptor {
            value: Some(value),
            getter: None,
            setter: None,
            attributes: attributes - Attributes::ANY_ACCESSOR,
            present: Present::all(),
        }
    }

    pub fn accessor(
        getter: Option<Gc<JsObject>>,
        setter: Option<Gc<JsObject>>,
        attributes: Attributes,
    ) -> PropertyDescriptor {
        let or_undefined = |function: Option<Gc<JsObject>>| function.map_or_default(Value::from);
        PropertyDescriptor {
            value: None,
            getter: Some(or_undefined(getter)),
            setter: Some(or_undefined(setter)),
            attributes: (attributes - Attributes::READ_ONLY - Attributes::CUSTOM)
                | Attributes::ACCESSOR,
            present: Present::ENUMERABLE | Present::CONFIGURABLE,
        }
    }

    pub fn value_only(value: Value) -> PropertyDescriptor {
        PropertyDescriptor {
            value: Some(value),
            ..PropertyDescriptor::default()
        }
    }

    /// Of what a slot or an entry of sparse elements has.
    pub fn stored(value: Value, attributes: Attributes) -> PropertyDescriptor {
        match value.downcast::<GetterSetter>() {
            Some(accessor) => Self::accessor(accessor.getter(), accessor.setter(), attributes),
            None => Self::data(value, attributes),
        }
    }

    pub fn from_slot(
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &PropertySlot,
    ) -> JsResult<PropertyDescriptor> {
        let attributes = slot.attributes();
        if let Some(accessor) = slot.getter_setter() {
            return Ok(Self::accessor(
                accessor.getter(),
                accessor.setter(),
                attributes,
            ));
        }
        if attributes.contains(Attributes::CUSTOM_ACCESSOR)
            && let Some(base) = slot.base()
        {
            let cx = cx.in_realm_of(&base);
            let getter = slot.custom_getter().map(|getter| {
                JsFunction::for_custom_getter(cx, name, getter, slot.required_class()).upcast()
            });
            let setter = slot
                .custom_setter()
                .map(|setter| JsFunction::for_custom_setter(cx, name, setter).upcast());
            return Ok(Self::accessor(getter, setter, attributes));
        }
        Ok(Self::data(slot.value(cx, name)?, attributes))
    }

    /// Whether `from_value` can take the fields straight from the object, so that no script runs.
    #[inline]
    pub fn is_plain_description(cx: &Cx, object: &JsObject) -> bool {
        let shape = object.shape();
        object.cell_type() == CellType::FinalObject
            && !shape.has(ShapeFlags::HAS_ANY_ACCESSOR)
            && (shape.prototype().is_null()
                || (shape.prototype() == cx.object_prototype().into()
                    && cx.holds(RealmWatchpoint::PropertyDescriptorFields)))
    }

    /// ToPropertyDescriptor
    pub fn from_value(cx: &mut Cx, value: Value) -> JsResult<PropertyDescriptor> {
        let Some(object) = value.as_object() else {
            return Err(cx.throw_type_error("Property description must be an object."));
        };
        if !Self::is_plain_description(cx, &object) {
            return Self::from_fields(cx, |cx, name| object.get_if_has_property(cx, name));
        }
        if object.shape().slot_count() > FIELDS.len() {
            return Self::from_fields(cx, |_, name| Ok(object.get_direct(name)));
        }
        #[inline(always)]
        fn position(name: PropertyName<'_>) -> Option<usize> {
            FIELDS.iter().position(|&it| it == name)
        }
        let (mut fields, no_gc) = ([None; FIELDS.len()], cx.no_gc());
        for entry in object.shape().entries(&no_gc) {
            if let Some((name, offset)) = entry.name_and_offset()
                && let Some(position) = position(name)
            {
                // SAFETY: from the shape.
                fields[position] = Some(unsafe { object.get_direct_unchecked(offset) });
            }
        }
        Self::from_fields(
            cx,
            #[inline(always)]
            |_, name| Ok(position(name).and_then(|it| fields[it])),
        )
    }

    #[inline(always)]
    fn from_fields(
        cx: &mut Cx,
        field: impl Fn(&mut Cx, PropertyName<'static>) -> JsResult<Option<Value>>,
    ) -> JsResult<PropertyDescriptor> {
        let mut descriptor = PropertyDescriptor::default();
        if let Some(value) = field(cx, names::enumerable)? {
            descriptor.set_enumerable(value.to_boolean(cx));
        }
        if let Some(value) = field(cx, names::configurable)? {
            descriptor.set_configurable(value.to_boolean(cx));
        }
        descriptor.value = field(cx, names::value)?;
        if let Some(value) = field(cx, names::writable)? {
            descriptor.set_writable(value.to_boolean(cx));
        }
        if let Some(getter) = field(cx, names::get)? {
            if !getter.is_undefined() && !getter.is_callable() {
                return Err(cx.throw_type_error("Getter must be a function."));
            }
            descriptor.set_getter(getter);
        }
        if let Some(setter) = field(cx, names::set)? {
            if !setter.is_undefined() && !setter.is_callable() {
                return Err(cx.throw_type_error("Setter must be a function."));
            }
            descriptor.set_setter(setter);
        }
        if descriptor.is_accessor() {
            if descriptor.value.is_some() {
                return Err(cx.throw_type_error(
                    "Invalid property.  'value' present on property with getter or setter.",
                ));
            }
            if descriptor.has_writable() {
                return Err(cx.throw_type_error(
                    "Invalid property.  'writable' present on property with getter or setter.",
                ));
            }
        }
        Ok(descriptor)
    }

    pub fn create_shapes(cx: &Cx) {
        let shape = |first, second| {
            let names = [first, second, names::enumerable, names::configurable];
            Shape::for_object_literal(cx, &names.map(PropertyName::to_identifier), 0)
        };
        let global = cx.global();
        global.init_data_descriptor_shape(shape(names::value, names::writable));
        global.init_accessor_descriptor_shape(shape(names::get, names::set));
    }

    /// FromPropertyDescriptor
    #[inline(always)]
    pub fn to_object(&self, cx: &Cx) -> Gc<JsObject> {
        let Some(value) = self.value.filter(|_| self.present.is_all()) else {
            return self.any_to_object(cx);
        };
        let [a, b, c] = [self.writable(), self.enumerable(), self.configurable()].map(Value::from);
        let shape = cx.data_descriptor_shape();
        JsFinalObject::create_with_values(cx, shape, &[value, a, b, c]).upcast()
    }

    #[inline(never)]
    fn any_to_object(&self, cx: &Cx) -> Gc<JsObject> {
        let has_both = self
            .present
            .contains(Present::ENUMERABLE | Present::CONFIGURABLE);
        let tail = [self.enumerable().into(), self.configurable().into()];
        if let (true, Some(getter), Some(setter)) = (has_both, self.getter, self.setter) {
            let values = [getter, setter, tail[0], tail[1]];
            let shape = cx.accessor_descriptor_shape();
            return JsFinalObject::create_with_values(cx, shape, &values).upcast();
        }
        let object = cx.new_object();
        let writable = self.has_writable().then(|| self.writable().into());
        for (name, value) in [
            (names::value, self.value),
            (names::writable, writable),
            (names::get, self.getter),
            (names::set, self.setter),
            (names::enumerable, self.has_enumerable().then_some(tail[0])),
            (
                names::configurable,
                self.has_configurable().then_some(tail[1]),
            ),
        ] {
            if let Some(value) = value {
                object.put_direct(cx, name, value, Attributes::NONE);
            }
        }
        object
    }

    /// CompletePropertyDescriptor
    pub fn complete(&mut self) {
        if self.is_accessor() {
            self.getter.get_or_insert_default();
            self.setter.get_or_insert_default();
        } else {
            self.value.get_or_insert_default();
            self.present |= Present::WRITABLE;
        }
        self.present |= Present::ENUMERABLE | Present::CONFIGURABLE;
    }

    #[inline]
    pub fn value(&self) -> Option<Value> {
        self.value
    }

    pub fn getter(&self) -> Option<Value> {
        self.getter
    }

    pub fn setter(&self) -> Option<Value> {
        self.setter
    }

    pub fn getter_object(&self) -> Option<Gc<JsObject>> {
        self.getter?.as_object()
    }

    pub fn setter_object(&self) -> Option<Gc<JsObject>> {
        self.setter?.as_object()
    }

    #[inline]
    pub fn attributes(&self) -> Attributes {
        self.attributes
    }

    #[inline]
    pub fn writable(&self) -> bool {
        self.attributes.is_writable() && !self.is_accessor()
    }

    #[inline]
    pub fn enumerable(&self) -> bool {
        self.attributes.is_enumerable()
    }

    #[inline]
    pub fn configurable(&self) -> bool {
        self.attributes.is_configurable()
    }

    #[inline]
    pub fn has_writable(&self) -> bool {
        self.present.contains(Present::WRITABLE)
    }

    #[inline]
    pub fn has_enumerable(&self) -> bool {
        self.present.contains(Present::ENUMERABLE)
    }

    #[inline]
    pub fn has_configurable(&self) -> bool {
        self.present.contains(Present::CONFIGURABLE)
    }

    #[inline]
    pub fn is_data(&self) -> bool {
        self.value.is_some() || self.has_writable()
    }

    #[inline]
    pub fn is_accessor(&self) -> bool {
        self.getter.is_some() || self.setter.is_some()
    }

    #[inline]
    pub fn is_generic(&self) -> bool {
        !self.is_data() && !self.is_accessor()
    }

    pub fn is_empty(&self) -> bool {
        self.is_generic() && self.present.is_empty()
    }

    pub fn set_value(&mut self, value: Value) {
        self.value = Some(value);
    }

    #[inline]
    pub fn set_writable(&mut self, writable: bool) {
        self.attributes.set(Attributes::READ_ONLY, !writable);
        self.present |= Present::WRITABLE;
    }

    #[inline]
    pub fn set_enumerable(&mut self, enumerable: bool) {
        self.attributes.set(Attributes::DONT_ENUM, !enumerable);
        self.present |= Present::ENUMERABLE;
    }

    #[inline]
    pub fn set_configurable(&mut self, configurable: bool) {
        self.attributes.set(Attributes::DONT_DELETE, !configurable);
        self.present |= Present::CONFIGURABLE;
    }

    #[inline]
    pub fn set_getter(&mut self, getter: Value) {
        self.getter = Some(getter);
        self.attributes = (self.attributes | Attributes::ACCESSOR) - Attributes::READ_ONLY;
    }

    #[inline]
    pub fn set_setter(&mut self, setter: Value) {
        self.setter = Some(setter);
        self.attributes = (self.attributes | Attributes::ACCESSOR) - Attributes::READ_ONLY;
    }

    /// The checks of ValidateAndApplyPropertyDescriptor against an existing property: the message if it is refused.
    pub(crate) fn conflict_with(
        &self,
        cx: &mut Cx,
        current: &PropertyDescriptor,
    ) -> JsResult<Option<&'static str>> {
        if current.configurable() {
            return Ok(None);
        }
        if self.configurable() {
            return Ok(Some(errors::UNCONFIGURABLE_CHANGE_CONFIGURABILITY));
        }
        if self.has_enumerable() && self.enumerable() != current.enumerable() {
            return Ok(Some(errors::UNCONFIGURABLE_CHANGE_ENUMERABILITY));
        }
        if self.is_generic() {
            return Ok(None);
        }
        if self.is_data() != current.is_data() {
            return Ok(Some(errors::UNCONFIGURABLE_CHANGE_ACCESS_MECHANISM));
        }
        if self.is_accessor() {
            if self.setter.is_some() && self.setter != current.setter {
                return Ok(Some(errors::UNCONFIGURABLE_CHANGE_SETTER));
            }
            if self.getter.is_some() && self.getter != current.getter {
                return Ok(Some(errors::UNCONFIGURABLE_CHANGE_GETTER));
            }
        } else if !current.writable() {
            if self.writable() {
                return Ok(Some(errors::UNCONFIGURABLE_CHANGE_WRITABILITY));
            }
            if let Some(value) = self.value
                && !value.same_value(cx, current.value.unwrap_or_default())?
            {
                return Ok(Some(errors::READ_ONLY_PROPERTY_CHANGE));
            }
        }
        Ok(None)
    }

    /// Whether applying this to `current` leaves it as it is.
    pub(crate) fn changes_nothing(
        &self,
        cx: &mut Cx,
        current: &PropertyDescriptor,
    ) -> JsResult<bool> {
        if self.attributes_overriding(current) != current.attributes
            || (self.getter.is_some() && self.getter != current.getter)
            || (self.setter.is_some() && self.setter != current.setter)
            || (self.is_data() && !current.is_data())
        {
            return Ok(false);
        }
        match (self.value, current.value) {
            (Some(new), Some(old)) => new.same_value(cx, old),
            _ => Ok(true),
        }
    }

    #[inline]
    pub fn attributes_overriding(&self, current: &PropertyDescriptor) -> Attributes {
        let mut kept = current.attributes - Attributes::CUSTOM;
        if self.is_data() && current.is_accessor() {
            kept = (kept | Attributes::READ_ONLY) - Attributes::ACCESSOR;
        }
        let mut overridden = Attributes::NONE;
        overridden.set(Attributes::READ_ONLY, self.has_writable());
        overridden.set(Attributes::DONT_ENUM, self.has_enumerable());
        overridden.set(Attributes::DONT_DELETE, self.has_configurable());
        if self.is_accessor() {
            overridden |= Attributes::ACCESSOR | Attributes::READ_ONLY;
        }
        (self.attributes & overridden) | (kept - overridden)
    }

    /// Those of a property that is new.
    #[inline]
    pub(crate) fn attributes_for_new(&self) -> Attributes {
        self.attributes_overriding(&PropertyDescriptor::default())
    }

    /// What to store, and with which attributes, for the property to become `current` with this applied.
    #[inline]
    pub(crate) fn apply_to(
        &self,
        vm: &Vm,
        current: Option<&PropertyDescriptor>,
    ) -> (Value, Attributes) {
        let absent = PropertyDescriptor::default();
        let current = current.unwrap_or(&absent);
        let attributes = self.attributes_overriding(current);
        if attributes.contains(Attributes::ACCESSOR) {
            let getter = self.getter.or(current.getter).and_then(Value::as_object);
            let setter = self.setter.or(current.setter).and_then(Value::as_object);
            (GetterSetter::create(vm, getter, setter).into(), attributes)
        } else {
            (self.value.or(current.value).unwrap_or_default(), attributes)
        }
    }
}
