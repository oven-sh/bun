use bun_engine_macros::{cell, native_abi, object_ops};
use bun_engine_text::{PropertyName, StringBuilder, names};

use crate::caches::{get_megamorphic, is_known_to_be_absent};
use crate::object::as_seen_by_scripts;
use crate::{
    Attributes, CallData, CallFrame, CellType, Cx, DeletePropertySlot, DontEnumMode, FastHashSet,
    FieldArray, Gc, GetterSetter, GlobalObject, InternalMethod, JsBoundFunction, JsFunction,
    JsObject, JsObjectInit, JsResult, PropertyDescriptor, PropertyNameList, PropertyNameMode,
    PropertySlot, PutPropertySlot, Shape, ShapeFlags, ShapeSpec, StackVisitor, Thrown, TypeFlags,
    Value, Vm, for_each_in_array_like, validate_property_descriptor,
};

/// The shape says whether it can be called, and the per-cell bit whether it is a constructor.
#[cell(name = "ProxyObject", cell_type = Proxy, ops, export = "engine_class_ProxyObject",
    flags = TypeFlags::INTERCEPTS_INDEXED_ACCESS.union(TypeFlags::PROHIBITS_PROPERTY_CACHING))]
pub struct ProxyObject {
    base: JsObject,
    pub fields: FieldArray<Value, 2>,
}

const REVOKED: &str =
    "Proxy has already been revoked. No more operations are allowed to be performed on it";

/// Who carries out an internal method.
enum Route {
    Target,
    Handler(Trap),
}

#[derive(Clone, Copy)]
struct Trap {
    handler: Gc<JsObject>,
    function: Value,
}

impl Trap {
    #[inline(always)]
    fn call(self, cx: &mut Cx, arguments: &[Value]) -> JsResult<Value> {
        cx.call(self.function, self.handler.into(), arguments)
    }

    #[inline(always)]
    fn test(self, cx: &mut Cx, arguments: &[Value]) -> JsResult<bool> {
        Ok(self.call(cx, arguments)?.to_boolean(cx))
    }
}

#[cold]
fn throw_naming(cx: &Cx, before: &str, name: PropertyName<'_>, after: &str) -> Thrown {
    let mut message = StringBuilder::new();
    message.push_ascii(before);
    message.push_text(name.text());
    message.push_ascii(after);
    match message.finish() {
        Ok(message) => cx.throw_type_error(message),
        Err(_) => cx.throw_out_of_memory(),
    }
}

impl ProxyObject {
    pub const TARGET_FIELD: usize = 0;
    /// Null once it has been revoked.
    pub const HANDLER_FIELD: usize = 1;

    pub fn create_shapes(cx: &Cx) {
        let (global, spec) = (cx.global(), ShapeSpec::of::<ProxyObject>());
        let callable = spec.with_flags(
            TypeFlags::IMPLEMENTS_HAS_INSTANCE | TypeFlags::IMPLEMENTS_DEFAULT_HAS_INSTANCE,
        );
        global.init_proxy_shape(Shape::create(cx, Some(global), Value::NULL, spec));
        global.init_callable_proxy_shape(Shape::create(cx, Some(global), Value::NULL, callable));
    }

    /// ProxyCreate
    pub fn create(cx: &Cx, target: Value, handler: Value) -> JsResult<Gc<ProxyObject>> {
        let Some(object) = target.as_object() else {
            return Err(cx.throw_type_error("A Proxy's 'target' should be an Object"));
        };
        if !handler.is_object() {
            return Err(cx.throw_type_error("A Proxy's 'handler' should be an Object"));
        }
        let shape = if object.is_callable() {
            cx.callable_proxy_shape()
        } else {
            cx.proxy_shape()
        };
        let proxy = cx.allocate::<ProxyObject>(ProxyObjectInit {
            base: JsObjectInit::new(cx, shape),
            fields: [target, handler],
        });
        if object.cell_type() != CellType::FinalObject && object.is_constructor() {
            proxy.set_per_cell_bit(true);
        }
        Ok(proxy)
    }

    #[inline(always)]
    pub fn target(&self) -> Gc<JsObject> {
        self.fields().at(Self::TARGET_FIELD).cast()
    }

    #[inline(always)]
    pub fn handler(&self) -> Option<Gc<JsObject>> {
        self.fields().at(Self::HANDLER_FIELD).as_object()
    }

    #[inline(always)]
    pub fn is_revoked(&self) -> bool {
        self.fields().at(Self::HANDLER_FIELD).is_null()
    }

    pub fn revoke(&self) {
        self.fields().set(Self::HANDLER_FIELD, Value::NULL);
    }

    fn is_callable_proxy(&self) -> bool {
        (self.inline_flags()).contains(TypeFlags::IMPLEMENTS_DEFAULT_HAS_INSTANCE)
    }

    /// GetMethod(handler, name)
    #[inline]
    pub fn find_trap(
        cx: &mut Cx,
        handler: Gc<JsObject>,
        name: PropertyName<'_>,
    ) -> JsResult<Option<Value>> {
        let function = get_megamorphic(cx, handler.into(), name)?;
        if function.is_undefined_or_null() {
            return Ok(None);
        }
        if !function.is_callable() {
            let after = "' property of a Proxy's handler should be callable";
            return Err(throw_naming(cx, "'", name, after));
        }
        Ok(Some(function))
    }

    #[inline(always)]
    fn live_handler(&self, cx: &Cx) -> JsResult<Gc<JsObject>> {
        cx.check_stack()?;
        self.handler().ok_or_else(|| cx.throw_type_error(REVOKED))
    }

    #[inline(always)]
    fn route(&self, cx: &mut Cx, trap: PropertyName<'_>) -> JsResult<Route> {
        let handler = self.live_handler(cx)?;
        Ok(match Self::find_trap(cx, handler, trap)? {
            Some(function) => Route::Handler(Trap { handler, function }),
            None => Route::Target,
        })
    }

    /// No trap sees a private name. `key` is no private element.
    #[inline(always)]
    fn route_for_key(
        &self,
        cx: &mut Cx,
        trap: PropertyName<'_>,
        key: PropertyName<'_>,
    ) -> JsResult<Route> {
        if key.is_private() {
            return self.live_handler(cx).map(|_| Route::Target);
        }
        self.route(cx, trap)
    }

    fn is_known_to_lack(&self, vm: &Vm, traps: &[PropertyName<'_>]) -> bool {
        self.handler().is_some_and(|handler| {
            (traps.iter()).all(|&trap| is_known_to_be_absent(vm, &handler, trap))
        })
    }

    /// The target, if calling the proxy is sure to be the same as calling that.
    pub fn transparent_call_target(&self, vm: &Vm) -> Option<Gc<JsObject>> {
        (self.is_callable_proxy() && self.is_known_to_lack(vm, &[names::apply]))
            .then(|| self.target())
    }

    /// `[[GetOwnProperty]]` and `[[DefineOwnProperty]]` are sure to be those of the target until a script runs.
    pub(crate) fn forwards_definitions(&self, vm: &Vm) -> bool {
        let traps = [names::getOwnPropertyDescriptor, names::defineProperty];
        self.is_known_to_lack(vm, &traps)
    }

    pub(crate) fn forwards_own_keys(&self, vm: &Vm, mode: DontEnumMode) -> bool {
        match mode {
            DontEnumMode::Include => self.is_known_to_lack(vm, &[names::ownKeys]),
            DontEnumMode::Exclude => {
                self.is_known_to_lack(vm, &[names::ownKeys, names::getOwnPropertyDescriptor])
            }
        }
    }

    /// `[[Get]]`
    pub fn get_through(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        receiver: Value,
    ) -> JsResult<Value> {
        if name.is_private_element() {
            return Ok(Value::UNDEFINED);
        }
        let target = self.target();
        let Route::Handler(trap) = self.route_for_key(cx, names::get, name)? else {
            return target.get_with_receiver(cx, name, receiver);
        };
        let (key, receiver) = (Value::from_name(cx, name), as_seen_by_scripts(receiver));
        let result = trap.call(cx, &[target.into(), key, receiver])?;
        if target.shape().has(ShapeFlags::BINDS_GET_AND_SET_TRAPS) {
            Self::validate_get_result(cx, result, &target, name)?;
        }
        Ok(result)
    }

    pub fn validate_get_result(
        cx: &mut Cx,
        result: Value,
        target: &JsObject,
        name: PropertyName<'_>,
    ) -> JsResult<()> {
        let Some(own) = fixed_property(cx, target, name)? else {
            return Ok(());
        };
        if own.is_accessor() {
            if own.getter_object().is_none() && !result.is_undefined() {
                return Err(cx.throw_type_error("Proxy handler's 'get' result of a non-configurable accessor property without a getter should be undefined"));
            }
        } else if !own.writable() && !result.same_value(cx, own.value().unwrap_or_default())? {
            return Err(cx.throw_type_error("Proxy handler's 'get' result of a non-configurable and non-writable property should be the same value as the target's property"));
        }
        Ok(())
    }

    fn has_through(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        slot.set_value(self, Attributes::NONE, Value::UNDEFINED);
        if name.is_private_element() {
            return Ok(false);
        }
        let target = self.target();
        let Route::Handler(trap) = self.route_for_key(cx, names::has, name)? else {
            return target.get_property_slot(cx, name, slot);
        };
        let result = trap.test(cx, &[target.into(), Value::from_name(cx, name)])?;
        if !result && target.shape().has(ShapeFlags::BINDS_OTHER_TRAPS) {
            Self::validate_negative_has_result(cx, &target, name)?;
        }
        Ok(result)
    }

    pub fn validate_negative_has_result(
        cx: &mut Cx,
        target: &JsObject,
        name: PropertyName<'_>,
    ) -> JsResult<()> {
        let messages = [
            "Proxy 'has' must return 'true' for non-configurable properties",
            "Proxy 'has' must return 'true' for a non-extensible 'target' object with a configurable property",
        ];
        check_may_be_absent(cx, target, name, messages)
    }

    fn get_own_property_through(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if name.is_private_element() {
            return Ok(false);
        }
        let target = self.target();
        let route = self.route_for_key(cx, names::getOwnPropertyDescriptor, name)?;
        let Route::Handler(trap) = route else {
            return target.get_own_property_slot(cx, name, slot);
        };
        let result = trap.call(cx, &[target.into(), Value::from_name(cx, name)])?;
        if result.is_undefined() {
            if target.shape().has(ShapeFlags::BINDS_OTHER_TRAPS) {
                let messages = [
                    "When the result of 'getOwnPropertyDescriptor' is undefined the target must be configurable",
                    "When 'getOwnPropertyDescriptor' returns undefined, the 'target' of a Proxy should be extensible",
                ];
                check_may_be_absent(cx, &target, name, messages)?;
            }
            return Ok(false);
        }
        if !result.is_object() {
            return Err(cx.throw_type_error(
                "result of 'getOwnPropertyDescriptor' call should either be an Object or undefined",
            ));
        }
        let own = target.get_own_property_descriptor(cx, name)?;
        let is_extensible = target.is_extensible(cx)?;
        let mut result = PropertyDescriptor::from_value(cx, result)?;
        result.complete();
        if !validate_property_descriptor(cx, is_extensible, &result, own.as_ref(), false)? {
            return Err(cx.throw_type_error("Result from 'getOwnPropertyDescriptor' fails the IsCompatiblePropertyDescriptor test"));
        }
        if !result.configurable() {
            let Some(own) = own.filter(|own| !own.configurable()) else {
                return Err(cx.throw_type_error("Result from 'getOwnPropertyDescriptor' can't be non-configurable when the 'target' doesn't have it as an own property or if it is a configurable own property on 'target'"));
            };
            if result.has_writable() && !result.writable() && own.writable() {
                return Err(cx.throw_type_error("Result from 'getOwnPropertyDescriptor' can't be non-configurable and non-writable when the target's property is writable"));
            }
        }
        if result.is_accessor() {
            let accessor = GetterSetter::create(cx, result.getter_object(), result.setter_object());
            slot.set_getter(self, result.attributes(), &accessor);
        } else {
            let value = result.value().unwrap_or_default();
            slot.set_value(self, result.attributes(), value);
        }
        Ok(true)
    }

    pub fn validate_positive_set_result(
        cx: &mut Cx,
        target: &JsObject,
        name: PropertyName<'_>,
        value: Value,
    ) -> JsResult<()> {
        let Some(own) = fixed_property(cx, target, name)? else {
            return Ok(());
        };
        if own.is_accessor() {
            if own.setter_object().is_none() {
                return Err(cx.throw_type_error("Proxy handler's 'set' method on a non-configurable accessor property without a setter should return false"));
            }
        } else if !own.writable() && !value.same_value(cx, own.value().unwrap_or_default())? {
            return Err(cx.throw_type_error("Proxy handler's 'set' on a non-configurable and non-writable property on 'target' should either return false or be the same value already on the 'target'"));
        }
        Ok(())
    }

    pub fn throw_falsy_set_result(cx: &Cx, name: PropertyName<'_>) -> Thrown {
        let before = "Proxy object's 'set' trap returned falsy value for property '";
        throw_naming(cx, before, name, "'")
    }

    pub(crate) fn put_index_with_receiver(
        &self,
        cx: &mut Cx,
        receiver: Value,
        index: u32,
        value: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        let key = Value::from(index).to_property_key(cx)?;
        let mut slot = PutPropertySlot::new(receiver, should_throw);
        self.op_put(cx, key.name(), value, &mut slot)
    }

    fn own_keys_through(&self, cx: &mut Cx, list: &mut PropertyNameList) -> JsResult<()> {
        let target = self.target();
        let Route::Handler(trap) = self.route(cx, names::ownKeys)? else {
            return target.own_property_names(cx, list, DontEnumMode::Include);
        };
        let Some(result) = trap.call(cx, &[target.into()])?.as_object() else {
            let message = "Proxy handler's 'ownKeys' method must return an object";
            return Err(cx.throw_type_error(message));
        };
        let mut keys = PropertyNameList::new(PropertyNameMode::StringsAndSymbols);
        let mut count = 0;
        for_each_in_array_like(cx, &result, |cx, key| {
            if !key.is_string() && !key.is_symbol() {
                return Err(cx.throw_type_error("Proxy handler's 'ownKeys' method must return an array-like object containing only Strings and Symbols"));
            }
            keys.add(key.to_property_key(cx)?.name());
            count += 1;
            if keys.has_overflowed() {
                return Err(cx.throw_out_of_memory());
            }
            Ok(())
        })?;
        if keys.len() != count {
            return Err(cx.throw_type_error(
                "Proxy handler's 'ownKeys' trap result must not contain any duplicate names",
            ));
        }
        if target.shape().has(ShapeFlags::BINDS_OTHER_TRAPS) {
            validate_own_keys(cx, &target, &keys.iter().map(|key| key.name()).collect())?;
        }
        list.append(keys);
        if list.includes_private_names() {
            add_private_names_behind_proxies(cx, target, list)?;
        }
        Ok(())
    }
}

/// The own property, if it is not configurable.
fn fixed_property(
    cx: &mut Cx,
    target: &JsObject,
    name: PropertyName<'_>,
) -> JsResult<Option<PropertyDescriptor>> {
    let own = target.get_own_property_descriptor(cx, name)?;
    Ok(own.filter(|own| !own.configurable()))
}

fn check_may_be_absent(
    cx: &mut Cx,
    target: &JsObject,
    name: PropertyName<'_>,
    [not_configurable, not_extensible]: [&'static str; 2],
) -> JsResult<()> {
    match target.get_own_property_descriptor(cx, name)? {
        Some(own) if !own.configurable() => Err(cx.throw_type_error(not_configurable)),
        Some(_) if !target.is_extensible(cx)? => Err(cx.throw_type_error(not_extensible)),
        _ => Ok(()),
    }
}

fn validate_own_keys(
    cx: &mut Cx,
    target: &JsObject,
    unchecked: &FastHashSet<PropertyName<'_>>,
) -> JsResult<()> {
    const MISSING: &str = "' that was not in the result from the 'ownKeys' trap";
    let is_extensible = target.is_extensible(cx)?;
    let kinds = PropertyNameMode::StringsAndSymbols;
    let own_keys = target.own_keys(cx, kinds, DontEnumMode::Include)?;
    let (mut fixed, mut configurable) = (Vec::new(), Vec::new());
    for key in own_keys.iter() {
        match fixed_property(cx, target, key.name())? {
            Some(_) => fixed.push(key.name()),
            None => configurable.push(key.name()),
        }
    }
    if let Some(&key) = fixed.iter().find(|&key| !unchecked.contains(key)) {
        let before = "Proxy object's 'target' has the non-configurable property '";
        return Err(throw_naming(cx, before, key, MISSING));
    }
    if is_extensible {
        return Ok(());
    }
    if let Some(&key) = configurable.iter().find(|&key| !unchecked.contains(key)) {
        let before = "Proxy object's non-extensible 'target' has configurable property '";
        return Err(throw_naming(cx, before, key, MISSING));
    }
    if unchecked.len() != own_keys.len() {
        return Err(cx.throw_type_error("Proxy handler's 'ownKeys' method returned a key that was not present in its non-extensible target"));
    }
    Ok(())
}

/// A trap cannot name them.
fn add_private_names_behind_proxies(
    cx: &mut Cx,
    mut target: Gc<JsObject>,
    list: &mut PropertyNameList,
) -> JsResult<()> {
    while let Some(proxy) = target.downcast::<ProxyObject>() {
        proxy.live_handler(cx)?;
        target = proxy.target();
    }
    let mut symbols = PropertyNameList::new(PropertyNameMode::Symbols).including_private_names();
    target.own_property_names(cx, &mut symbols, DontEnumMode::Include)?;
    (symbols.iter().map(|symbol| symbol.name()))
        .filter(|name| name.is_private() && !name.is_private_element())
        .for_each(|name| list.add(name));
    Ok(())
}

#[object_ops]
impl ProxyObject {
    fn call_data(&self) -> CallData {
        if self.is_callable_proxy() {
            CallData::native(call)
        } else {
            CallData::NONE
        }
    }

    fn construct_data(&self) -> CallData {
        if self.per_cell_bit() {
            CallData::native(construct)
        } else {
            CallData::NONE
        }
    }

    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        slot.taint_by_opaque_object();
        let found = match slot.method() {
            InternalMethod::Get => {
                let value = self.get_through(cx, name, slot.this_value())?;
                slot.set_value(self, Attributes::NONE, value);
                true
            }
            InternalMethod::HasProperty => self.has_through(cx, name, slot)?,
            InternalMethod::GetOwnProperty => self.get_own_property_through(cx, name, slot)?,
            InternalMethod::Inquiry => false,
        };
        slot.disable_caching();
        Ok(found)
    }

    fn get_own_property_slot_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        let key = Value::from(index).to_property_key(cx)?;
        self.op_get_own_property_slot(cx, key.name(), slot)
    }

    fn put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        slot.disable_caching();
        slot.taint_by_opaque_object();
        if name.is_private_element() {
            return Ok(false);
        }
        let (target, receiver) = (self.target(), slot.this_value());
        let Route::Handler(trap) = self.route_for_key(cx, names::set, name)? else {
            if name.is_private() && receiver == self.as_value() {
                return target.set(cx, name, value, slot.is_strict());
            }
            return target.put(cx, name, value, slot);
        };
        let (key, receiver) = (Value::from_name(cx, name), as_seen_by_scripts(receiver));
        if !trap.test(cx, &[target.into(), key, value, receiver])? {
            if slot.is_strict() {
                return Err(Self::throw_falsy_set_result(cx, name));
            }
            return Ok(false);
        }
        if target.shape().has(ShapeFlags::BINDS_GET_AND_SET_TRAPS) {
            Self::validate_positive_set_result(cx, &target, name, value)?;
        }
        Ok(true)
    }

    fn put_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        value: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        self.put_index_with_receiver(cx, self.as_value(), index, value, should_throw)
    }

    fn delete_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut DeletePropertySlot,
    ) -> JsResult<bool> {
        slot.disable_caching();
        if name.is_private_element() {
            return Ok(false);
        }
        let target = self.target();
        let Route::Handler(trap) = self.route_for_key(cx, names::deleteProperty, name)? else {
            return target.delete_property(cx, name, slot);
        };
        let result = trap.test(cx, &[target.into(), Value::from_name(cx, name)])?;
        if result && target.shape().has(ShapeFlags::BINDS_OTHER_TRAPS) {
            let messages = [
                "Proxy handler's 'deleteProperty' method should return false when the target's property is not configurable",
                "Proxy handler's 'deleteProperty' method should return false when the target has property and is not extensible",
            ];
            check_may_be_absent(cx, &target, name, messages)?;
        }
        Ok(result)
    }

    fn delete_property_by_index(&self, cx: &mut Cx, index: u32) -> JsResult<bool> {
        let key = Value::from(index).to_property_key(cx)?;
        self.op_delete_property(cx, key.name(), &mut DeletePropertySlot::default())
    }

    fn define_own_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        if name.is_private_element() {
            return Ok(false);
        }
        let target = self.target();
        let Route::Handler(trap) = self.route_for_key(cx, names::defineProperty, name)? else {
            return target.define_own_property(cx, name, descriptor, should_throw);
        };
        let (key, object) = (Value::from_name(cx, name), descriptor.to_object(cx));
        if !trap.test(cx, &[target.into(), key, object.into()])? {
            if should_throw {
                let before = "Proxy's 'defineProperty' trap returned falsy value for property '";
                return Err(throw_naming(cx, before, name, "'"));
            }
            return Ok(false);
        }
        let is_fixing = descriptor.has_configurable() && !descriptor.configurable();
        if !is_fixing && !target.shape().has(ShapeFlags::BINDS_OTHER_TRAPS) {
            return Ok(true);
        }
        let own = target.get_own_property_descriptor(cx, name)?;
        let is_extensible = target.is_extensible(cx)?;
        let message = match own {
            None if !is_extensible => {
                "Proxy's 'defineProperty' trap returned true even though getOwnPropertyDescriptor of the Proxy's target returned undefined and the target is non-extensible"
            }
            None if is_fixing => {
                "Proxy's 'defineProperty' trap returned true for a non-configurable field even though getOwnPropertyDescriptor of the Proxy's target returned undefined"
            }
            Some(own) if descriptor.conflict_with(cx, &own)?.is_some() => {
                "Proxy's 'defineProperty' trap did not define a property on its target that is compatible with the trap's input descriptor"
            }
            Some(own) if is_fixing && own.configurable() => {
                "Proxy's 'defineProperty' trap did not define a non-configurable property on its target even though the input descriptor to the trap said it must do so"
            }
            Some(own)
                if !own.configurable()
                    && own.writable()
                    && descriptor.has_writable()
                    && !descriptor.writable() =>
            {
                "Proxy's 'defineProperty' trap returned true for a non-writable input descriptor when the target's property is non-configurable and writable"
            }
            _ => return Ok(true),
        };
        Err(cx.throw_type_error(message))
    }

    fn own_property_names(
        &self,
        cx: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        if mode == DontEnumMode::Include {
            return self.own_keys_through(cx, list);
        }
        let mut keys = list.new_like();
        self.own_keys_through(cx, &mut keys)?;
        keys.try_retain(|key| {
            let mut slot = PropertySlot::new(self.as_value(), InternalMethod::GetOwnProperty);
            Ok(self.get_own_property_through(cx, key, &mut slot)?
                && slot.attributes().is_enumerable())
        })?;
        list.append(keys);
        Ok(())
    }

    fn prevent_extensions(&self, cx: &mut Cx) -> JsResult<bool> {
        let target = self.target();
        let Route::Handler(trap) = self.route(cx, names::preventExtensions)? else {
            return target.prevent_extensions(cx);
        };
        let result = trap.test(cx, &[target.into()])?;
        if result && target.is_extensible(cx)? {
            return Err(cx.throw_type_error("Proxy's 'preventExtensions' trap returned true even though its target is extensible. It should have returned false"));
        }
        Ok(result)
    }

    fn is_extensible(&self, cx: &mut Cx) -> JsResult<bool> {
        let target = self.target();
        let Route::Handler(trap) = self.route(cx, names::isExtensible)? else {
            return target.is_extensible(cx);
        };
        let result = trap.test(cx, &[target.into()])?;
        if result == target.is_extensible(cx)? {
            return Ok(result);
        }
        Err(cx.throw_type_error(if result {
            "Proxy object's 'isExtensible' trap returned true when the target is non-extensible. It should have returned false"
        } else {
            "Proxy object's 'isExtensible' trap returned false when the target is extensible. It should have returned true"
        }))
    }

    fn set_prototype_of(
        &self,
        cx: &mut Cx,
        prototype: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        let target = self.target();
        let Route::Handler(trap) = self.route(cx, names::setPrototypeOf)? else {
            return target.set_prototype_of(cx, prototype, should_throw);
        };
        if !trap.test(cx, &[target.into(), prototype])? {
            return cx.reject(should_throw, "Proxy 'setPrototypeOf' returned false indicating it could not set the prototype value. The operation was expected to succeed");
        }
        if !target.is_extensible(cx)? && target.get_prototype_of(cx)? != prototype {
            return Err(cx.throw_type_error("Proxy 'setPrototypeOf' trap returned true when its target is non-extensible and the new prototype value is not the same as the current prototype value. It should have returned false"));
        }
        Ok(true)
    }

    fn get_prototype_of(&self, cx: &mut Cx) -> JsResult<Value> {
        // A chain that has a proxy in it need not end.
        cx.check_traps()?;
        let target = self.target();
        let Route::Handler(trap) = self.route(cx, names::getPrototypeOf)? else {
            let prototype = target.get_prototype_of(cx);
            // No tail call: each proxy on the way counts towards the limit of the stack.
            target.keep_alive();
            return prototype;
        };
        let result = trap.call(cx, &[target.into()])?;
        if !result.is_object() && !result.is_null() {
            return Err(cx.throw_type_error(
                "Proxy handler's 'getPrototypeOf' trap should either return an object or null",
            ));
        }
        if !target.is_extensible(cx)? && target.get_prototype_of(cx)? != result {
            return Err(cx.throw_type_error("Proxy's 'getPrototypeOf' trap for a non-extensible target should return the same value as the target's prototype"));
        }
        Ok(result)
    }
}

/// Calling a proxy or a bound function pushes no execution context.
fn realm_of_caller(cx: &Cx) -> Gc<GlobalObject> {
    let has_context = |frame: &&CallFrame| {
        let callee = frame.callee();
        !callee.is::<ProxyObject>() && !callee.is::<JsBoundFunction>()
    };
    let mut frames = (cx.machine_frames()).take_while(|frame| !frame.has_native_callee());
    let Some(frame) = frames.find(has_context) else {
        return cx.global();
    };
    if frame.code_block().is_some_and(|it| it.is_optimized())
        && let Some(innermost) = StackVisitor::frames_from(cx, frame).next()
        && let Some(inlined) = innermost.inline_frame.and(innermost.code_block)
    {
        return inlined.global();
    }
    match frame.callee().downcast::<JsFunction>() {
        Some(function) => function.function_realm(),
        None => (frame.callee().realm()).unwrap_or_else(|| cx.global()),
    }
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let cx = cx.in_realm(realm_of_caller(cx));
    let proxy = frame.callee().cast::<ProxyObject>();
    let (target, this) = (proxy.target().into(), frame.this_value());
    let Route::Handler(trap) = proxy.route(cx, names::apply)? else {
        return cx.call(target, this, frame.arguments());
    };
    let arguments = cx.new_array_from(frame.arguments())?;
    trap.call(cx, &[target, this, arguments.into()])
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let cx = cx.in_realm(realm_of_caller(cx));
    let proxy = frame.callee().cast::<ProxyObject>();
    let (target, new_target) = (proxy.target().into(), frame.new_target());
    let Route::Handler(trap) = proxy.route(cx, names::construct)? else {
        return (cx.construct(target, frame.arguments(), new_target)).map(Into::into);
    };
    let arguments = cx.new_array_from(frame.arguments())?;
    let result = trap.call(cx, &[target, arguments.into(), new_target])?;
    if !result.is_object() {
        let message = "Result from Proxy handler's 'construct' method should be an object";
        return Err(cx.throw_type_error(message));
    }
    Ok(result)
}
