use bun_engine_macros::{cell, object_ops};
use bun_engine_text::PropertyName;

use crate::{
    Cx, DeletePropertySlot, DontEnumMode, Gc, GlobalObject, JsObject, JsObjectInit, JsResult,
    PropertyDescriptor, PropertyNameList, PropertySlot, PutPropertySlot, Shape, ShapeSpec,
    TypeFlags, Value, Vm,
};

/// What scripts see as `globalThis`.
#[cell(name = "JSGlobalProxy", cell_type = GlobalProxy, ops, export = "engine_class_GlobalProxy",
    flags = TypeFlags::INTERCEPTS_INDEXED_ACCESS.union(TypeFlags::PROHIBITS_PROPERTY_CACHING))]
pub struct GlobalProxy {
    base: JsObject,
    /// The realm of the shape, which no other object has.
    target: Gc<GlobalObject>,
}

impl GlobalProxy {
    pub const OFFSET_OF_TARGET: usize = core::mem::offset_of!(GlobalProxy, target);

    pub fn create(vm: &Vm, target: Gc<GlobalObject>) -> Gc<GlobalProxy> {
        let (prototype, spec) = (target.prototype_direct(), ShapeSpec::of::<GlobalProxy>());
        let shape = Shape::create(vm, Some(target), prototype, spec);
        vm.allocate::<GlobalProxy>(GlobalProxyInit {
            base: JsObjectInit::new(vm, shape),
            target,
        })
    }

    #[inline(always)]
    pub fn target(&self) -> Gc<GlobalObject> {
        self.target
    }
}

#[object_ops]
impl GlobalProxy {
    fn put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        self.target().put(cx, name, value, slot)
    }

    fn put_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        value: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        self.target().put_by_index(cx, index, value, should_throw)
    }

    fn delete_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut DeletePropertySlot,
    ) -> JsResult<bool> {
        slot.disable_caching();
        self.target().delete_property(cx, name, slot)
    }

    fn delete_property_by_index(&self, cx: &mut Cx, index: u32) -> JsResult<bool> {
        self.target().delete_property_by_index(cx, index)
    }

    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        self.target().get_own_property_slot(cx, name, slot)
    }

    fn get_own_property_slot_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        self.target()
            .get_own_property_slot_by_index(cx, index, slot)
    }

    fn own_property_names(
        &self,
        cx: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        self.target().own_property_names(cx, list, mode)
    }

    fn define_own_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        self.target()
            .define_own_property(cx, name, descriptor, should_throw)
    }

    fn prevent_extensions(&self, cx: &mut Cx) -> JsResult<bool> {
        self.target().prevent_extensions(cx)
    }

    fn is_extensible(&self, cx: &mut Cx) -> JsResult<bool> {
        self.target().is_extensible(cx)
    }

    fn set_prototype_of(
        &self,
        cx: &mut Cx,
        prototype: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        self.target().set_prototype_of(cx, prototype, should_throw)
    }

    fn get_prototype_of(&self, cx: &mut Cx) -> JsResult<Value> {
        self.target().get_prototype_of(cx)
    }
}
