use bun_engine_bytecode::Visibility;
use bun_engine_text::{PropertyName, StringRef, Text};

use super::static_table::StaticValue;
use crate::{
    Attributes, Class, CustomGetterSetter, Cx, DontEnumMode, GetterSetter, Intrinsic, JsFunction,
    JsObject, JsResult, LazyClass, LazyField, NativeFunction, PropertyNameList, PropertyOffset,
    PropertySlot, ShapeFlags, StaticProperty, StaticTable, Value, call::native_not_a_constructor,
};

/// What SetFunctionName makes of a key and a prefix.
pub fn function_name(prefix: &str, name: PropertyName<'_>) -> StringRef {
    if prefix.is_empty() && !name.is_symbol() {
        return StringRef::retain(name.string());
    }
    let (open, close) = match name.symbol_flags() {
        Some(flags) if !flags.is_private() && flags.has_description() => ("[", "]"),
        _ => ("", ""),
    };
    let parts = [
        Text::from_ascii(prefix),
        Text::from_ascii(open),
        name.text(),
        Text::from_ascii(close),
    ];
    StringRef::try_concat(&parts).unwrap_or_default()
}

impl JsObject {
    #[inline(never)]
    pub(super) fn get_own_static_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        let shape = self.shape();
        if shape.has(ShapeFlags::STATIC_PROPERTIES_REIFIED) {
            return Ok(false);
        }
        let Some((table, entry)) = shape.find_static_property(name) else {
            return Ok(false);
        };
        let attributes = entry.attributes();
        match entry.value() {
            StaticValue::Custom { getter, setter } => {
                slot.set_custom(self, attributes.for_shape(), getter, setter);
                slot.set_required_class(required_class(table.class_for_this(), entry));
                slot.allow_caching(PropertyOffset::INVALID);
            }
            _ => {
                self.reify_static_property(cx, table, entry, name)?;
                let Some((offset, attributes)) = self.shape().get(name) else {
                    return Ok(false);
                };
                self.fill_slot(offset, attributes, slot);
            }
        }
        Ok(true)
    }

    /// Gives a slot to one that is only in a static table, if no other object has the shape.
    pub(crate) fn reify_custom_accessor(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
    ) -> JsResult<()> {
        let shape = self.shape();
        if shape.has(ShapeFlags::IS_CLAIMED)
            && shape.has_non_reified_static_properties()
            && shape.get(name).is_none()
            && let Some((table, entry)) = shape.find_static_property(name)
            && matches!(entry.value(), StaticValue::Custom { .. })
        {
            return self.reify_static_property(cx, table, entry, name);
        }
        Ok(())
    }

    pub(super) fn reify_static_property(
        &self,
        cx: &mut Cx,
        table: &StaticTable,
        entry: &StaticProperty,
        name: PropertyName<'_>,
    ) -> JsResult<()> {
        self.reify_entry(cx, table.class_for_this(), entry, name)
    }

    /// Defines the property that `entry` describes.
    pub fn reify_entry(
        &self,
        cx: &mut Cx,
        class_for_this: Option<&'static Class>,
        entry: &StaticProperty,
        name: PropertyName<'_>,
    ) -> JsResult<()> {
        let cx = cx.in_realm_of(self);
        let attributes = entry.attributes().for_shape();
        let native = |cx: &Cx, prefix, function: NativeFunction, length, intrinsic| {
            let name = function_name(prefix, name);
            JsFunction::native_with_intrinsic(cx, length, &name, function, intrinsic).upcast()
        };
        let mut outcome = Ok(());
        let value = match entry.value() {
            StaticValue::Function {
                function,
                length,
                intrinsic,
                is_constructor,
            } => {
                let constructor = if is_constructor {
                    function
                } else {
                    native_not_a_constructor
                };
                let name = function_name("", name);
                let visibility = Visibility::Public;
                JsFunction::native_with(
                    cx,
                    length,
                    &name,
                    function,
                    constructor,
                    intrinsic,
                    visibility,
                )
                .into()
            }
            StaticValue::Accessor {
                getter,
                setter,
                intrinsic,
            } => {
                let getter = getter.map(|getter| native(cx, "get ", getter, 0, intrinsic));
                let setter = setter.map(|setter| native(cx, "set ", setter, 1, Intrinsic::None));
                GetterSetter::create(cx, getter, setter).into()
            }
            StaticValue::Builtin(generator) => {
                // SAFETY: each is what the author of the table put there for this class.
                JsFunction::builtin(cx, unsafe { generator(cx) }).into()
            }
            StaticValue::BuiltinGetter(generator) => {
                // SAFETY: as above.
                let getter = JsFunction::builtin(cx, unsafe { generator(cx) });
                GetterSetter::create(cx, Some(getter.upcast()), None).into()
            }
            StaticValue::EngineBuiltin(id) => {
                JsFunction::builtin(cx, cx.builtin_executable(id)).into()
            }
            StaticValue::Constant(value) => value,
            StaticValue::Name(name) => Value::from_name(cx, name),
            // SAFETY: as above.
            StaticValue::LazyCell(offset) => unsafe { LazyField::at(self, offset) }
                .get(cx, self)
                .map_or_default(Into::into),
            // SAFETY: as above.
            StaticValue::LazyClass(offset) => unsafe { LazyClass::at(self, offset) }
                .constructor(cx, self)
                .map_or_default(Into::into),
            StaticValue::RealmSlot(slot) => cx.global().slot(cx, slot).into(),
            StaticValue::Callback(callback) => {
                let _defer = cx.defer_termination();
                // SAFETY: as above.
                #[cfg(not(windows))]
                let result = unsafe { callback(cx, self) };
                #[cfg(windows)]
                let result = unsafe { *callback(&mut None, cx, self) };
                let Some(value) = result else {
                    return cx.check_exception();
                };
                outcome = cx.check_exception();
                value
            }
            StaticValue::Made(make) => make(cx, self),
            StaticValue::Custom { getter, setter } => {
                let class = required_class(class_for_this, entry);
                CustomGetterSetter::create(cx, getter, setter, class).into()
            }
        };
        let shape = self.shape();
        if shape.has(ShapeFlags::IS_CLAIMED)
            && shape.has_non_reified_static_properties()
            && shape.get(name).is_none()
            && shape
                .find_static_property(name)
                .is_some_and(|(_, own)| core::ptr::eq(own, entry))
        {
            // SAFETY: the only instance, and it has had the property all along.
            unsafe { self.add_property_in_place(cx, name, value, attributes) };
        } else {
            self.put_direct_stored(cx, name, value, attributes);
        }
        outcome
    }

    /// Whether the property is still the function that the static table describes. It is in the shape afterwards.
    pub fn reify_if_pristine(&self, cx: &Cx, name: PropertyName<'_>) -> bool {
        let shape = self.shape();
        let Some((table, entry)) = shape.find_static_property(name) else {
            return false;
        };
        let original = entry.value();
        if matches!(
            original,
            StaticValue::Callback(_) | StaticValue::LazyCell(_) | StaticValue::LazyClass(_)
        ) {
            return false;
        }
        let Some(mut value) = self.get_direct(name) else {
            // SAFETY: the other kinds of entries run no script.
            let cx = unsafe { Cx::from_global(cx.global()) };
            return shape.has_non_reified_static_properties()
                && self.reify_static_property(cx, table, entry, name).is_ok();
        };
        if let Some(accessor) = value.downcast::<GetterSetter>() {
            value = accessor.getter().map_or_default(Into::into);
        }
        let function = value.downcast::<JsFunction>();
        let function = function.filter(|it| Some(it.function_realm()) == self.realm());
        match original {
            StaticValue::Function {
                function: native, ..
            }
            | StaticValue::Accessor {
                getter: Some(native),
                ..
            } => function
                .and_then(|it| it.native_executable())
                .is_some_and(|it| core::ptr::fn_addr_eq(it.function(), native)),
            StaticValue::EngineBuiltin(id) => function
                .and_then(|it| it.script_executable())
                .is_some_and(|it| it.is_for_builtin(cx, id)),
            StaticValue::RealmSlot(slot) => self
                .realm()
                .is_some_and(|global| value == global.slot(cx, slot).into()),
            _ => false,
        }
    }

    pub fn reify_all_static_properties(&self, cx: &mut Cx) -> JsResult<()> {
        if !self.shape().has_non_reified_static_properties() {
            return Ok(());
        }
        if !self.shape().has(ShapeFlags::IS_CLAIMED) {
            self.convert_to_dictionary(cx);
        }
        let tables = || self.class().ancestry().filter_map(Class::static_table);
        for table in tables() {
            for entry in table.iter() {
                let (shape, name) = (self.shape(), entry.name());
                // What makes a value may get here too, and then delete a property.
                if !shape.has_non_reified_static_properties() {
                    return Ok(());
                }
                if shape.get(name.name()).is_none() {
                    self.reify_static_property(cx, table, entry, name.name())?;
                }
            }
        }
        let shape = self.shape();
        if shape.has_non_reified_static_properties() {
            let entries = tables().flat_map(StaticTable::entries_and_positions);
            shape.did_reify_static_properties(entries.map(StaticProperty::name));
        }
        Ok(())
    }

    pub(super) fn static_property_names(
        &self,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
        wants_symbols: bool,
    ) {
        let shape = self.shape();
        let looks_at_all = mode == DontEnumMode::Include
            || (shape.properties().iter()).any(|(_, _, attributes)| attributes.is_enumerable());
        for table in shape.class().ancestry().filter_map(Class::static_table) {
            let entries = table.entries_and_positions();
            for entry in entries.filter(|it| looks_at_all || it.attributes().is_enumerable()) {
                let name = entry.name();
                if name.name().is_symbol() == wants_symbols
                    && match shape.get(name.name()) {
                        Some((_, attributes)) => mode.includes(attributes),
                        None => !entry.is_position() && mode.includes(entry.attributes()),
                    }
                {
                    list.add(name.name());
                }
            }
        }
    }
}

fn required_class(class: Option<&'static Class>, entry: &StaticProperty) -> Option<&'static Class> {
    class.filter(|_| entry.attributes().contains(Attributes::DOM_ATTRIBUTE))
}
