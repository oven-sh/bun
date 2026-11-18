//! A global object that asks another object first, as that of a `node:vm` context asks its contextified object.

use bun_engine_macros::{cell, object_ops};
use bun_engine_text::{Identifier, PropertyName, names};

use crate::{
    Attributes, CellType, Cx, DeletePropertySlot, DontEnumMode, Gc, GlobalObject, GlobalProxy,
    Inherited, InternalMethod, JsObject, JsResult, PropertyDescriptor, PropertyNameList,
    PropertySlot, ProxyObject, PutPropertySlot, RealmHooks, Shape, ShapeFlags, ShapeSpec,
    TypeFlags, Value, Vm,
};

/// Ordinary until it has a sandbox. It has no fields, so a class that extends `GlobalObject` can take its methods.
#[cell(name = "GlobalObject", ops, cleared_flags = TypeFlags::IS_IMMUTABLE_PROTOTYPE_EXOTIC_OBJECT,
    flags = TypeFlags::INTERCEPTS_INDEXED_ACCESS.union(TypeFlags::PROHIBITS_PROPERTY_CACHING)
        .union(TypeFlags::GET_OWN_PROPERTY_SLOT_MAY_BE_WRONG_ABOUT_DONT_ENUM))]
pub struct SandboxedGlobalObject {
    base: GlobalObject,
}

impl SandboxedGlobalObject {
    pub fn create(vm: &Vm, hooks: &'static RealmHooks, sandbox: Gc<JsObject>) -> Gc<GlobalObject> {
        let shape = Shape::create(vm, None, Value::NULL, ShapeSpec::of::<Self>());
        let base = GlobalObject::init(vm, shape, hooks, core::ptr::null());
        let global = vm.allocate::<Self>(SandboxedGlobalObjectInit { base });
        global.finish_creation(vm);
        global.set_sandbox(Some(sandbox));
        global.upcast()
    }
}

/// `[[Get]]`, which tells whether there is such a property. A proxy without a trap leaves that to its target.
fn get_if_present(
    cx: &mut Cx,
    sandbox: Gc<JsObject>,
    name: PropertyName<'_>,
) -> JsResult<Option<Value>> {
    cx.check_stack()?;
    let mut slot = PropertySlot::new(sandbox.into(), InternalMethod::Get);
    let (mut object, mut proxies) = (sandbox, 0);
    loop {
        if let Some(proxy) = object.downcast::<ProxyObject>()
            && let Some(handler) = proxy.handler()
            && !name.is_private()
        {
            object = proxy.target();
            if let Some(trap) = ProxyObject::find_trap(cx, handler, names::get)? {
                let arguments = [object.into(), Value::from_name(cx, name), sandbox.into()];
                let result = cx.call(trap, handler.into(), &arguments)?;
                if object.shape().has(ShapeFlags::BINDS_GET_AND_SET_TRAPS) {
                    ProxyObject::validate_get_result(cx, result, &object, name)?;
                }
                return Ok(Some(result));
            }
            // It can be on the chain of its own target.
            proxies += 1;
            if proxies > JsObject::MAX_PROTOTYPE_CHAIN_DEPTH {
                return Err(cx.throw_stack_overflow());
            }
            continue;
        }
        if object.get_own_property_slot(cx, name, &mut slot)? {
            return slot.value(cx, name).map(Some);
        }
        if CellType::TYPED_ARRAYS.contains(object.cell_type())
            && !name.is_symbol()
            && bun_engine_number::canonical_numeric_index(name.text()).is_some()
        {
            return Ok(None);
        }
        match object.get_prototype_of(cx)?.as_object() {
            Some(prototype) => object = prototype,
            None => return Ok(None),
        }
    }
}

impl GlobalObject {
    /// What the sandbox has or inherits. The sandbox itself reads as `globalThis`.
    pub(super) fn get_from_sandbox(
        &self,
        cx: &mut Cx,
        sandbox: Gc<JsObject>,
        name: PropertyName<'_>,
    ) -> JsResult<Option<Value>> {
        let value = get_if_present(cx, sandbox, name)?;
        Ok(value.map(|value| match value == sandbox.into() {
            true => self.global_this().into(),
            false => value,
        }))
    }

    fn is_or_is_behind(&self, value: Value) -> bool {
        value == self.as_value()
            || (value.downcast::<GlobalProxy>()).is_some_and(|it| it.target().is_same(self))
    }
}

#[object_ops(export = "engine_SandboxedGlobalObject")]
impl SandboxedGlobalObject {
    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        let mut receiver = slot.this_value();
        if receiver == self.as_value() {
            receiver = self.global_this().into();
        }
        if let Some(sandbox) = self.sandbox() {
            if slot.method() == InternalMethod::Get {
                if let Some(value) = self.get_from_sandbox(cx, sandbox, name)? {
                    slot.disable_caching();
                    slot.set_value(&sandbox, Attributes::NONE, value);
                    return Ok(true);
                }
            } else {
                // What the sandbox inherits can be read, and is no property of the global object.
                cx.check_stack()?;
                slot.set_this_value(sandbox.into());
                if sandbox.get_own_property_slot(cx, name, slot)? {
                    return Ok(true);
                }
            }
        }
        slot.set_this_value(receiver);
        self.base_get_own_property_slot(cx, name, slot)
    }

    fn get_own_property_slot_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        self.op_get_own_property_slot(cx, Identifier::from_index(index).name(), slot)
    }

    fn put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        if slot.this_value() == self.as_value() {
            slot.set_this_value(self.global_this().into());
        }
        let Some(sandbox) = self.sandbox() else {
            return self.base_put(cx, name, value, slot);
        };
        cx.check_stack()?;
        let receiver = slot.this_value();
        let mut found = PropertySlot::new(sandbox.into(), InternalMethod::Get);
        if !sandbox.get_property_slot(cx, name, &mut found)?
            && (value.is_symbol()
                || (slot.is_strict()
                    && !cx.global().is_or_is_behind(receiver)
                    && !value.is_callable()))
        {
            return self.base_put(cx, name, value, slot);
        }
        slot.set_this_value(sandbox.into());
        if !sandbox.put(cx, name, value, slot)? {
            return Ok(false);
        }
        if found.is_accessor() && found.attributes().is_enumerable() {
            return Ok(true);
        }
        slot.set_this_value(receiver);
        self.base_put(cx, name, value, slot)
    }

    fn define_own_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        let Some(sandbox) = self.sandbox() else {
            return self.base_define_own_property(cx, name, descriptor, should_throw);
        };
        cx.check_stack()?;
        let current = cx.global();
        let mut own = PropertySlot::new(current.into(), InternalMethod::GetOwnProperty);
        let is_own = current.get_declared_property_slot(cx, name, &mut own)?;
        if is_own && (own.attributes()).contains(Attributes::READ_ONLY | Attributes::DONT_DELETE) {
            return self.base_define_own_property(cx, name, descriptor, should_throw);
        }
        if descriptor.is_accessor() {
            return sandbox.define_own_property(cx, name, descriptor, should_throw);
        }
        let mut found = PropertySlot::new(current.into(), InternalMethod::GetOwnProperty);
        let is_only_in_sandbox = sandbox.get_property_slot(cx, name, &mut found)? && !is_own;
        if !sandbox.define_own_property(cx, name, descriptor, should_throw)? {
            return Ok(false);
        }
        Ok(is_only_in_sandbox
            || self.base_define_own_property(cx, name, descriptor, should_throw)?)
    }

    fn delete_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut DeletePropertySlot,
    ) -> JsResult<bool> {
        if let Some(sandbox) = self.sandbox()
            && !sandbox.ordinary_delete_property(cx, name, slot)?
        {
            return Ok(false);
        }
        self.base_delete_property(cx, name, slot)
    }

    fn own_property_names(
        &self,
        cx: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        if let Some(sandbox) = self.sandbox() {
            cx.check_stack()?;
            sandbox.own_property_names(cx, list, mode)?;
        }
        self.base_own_property_names(cx, list, mode)
    }
}
