//! Module namespace exotic objects.

use core::cell::Cell;

use bun_engine_bytecode::ImportPhase;
use bun_engine_macros::{cell, object_ops};
use bun_engine_text::{Identifier, PropertyName, names, symbols};
use hashbrown::HashTable;

use crate::{
    AbstractModuleRecord, Attributes, Cx, CyclicModuleRecord, DeletePropertySlot, DontEnumMode, Gc,
    InternalMethod, JsDestructibleObject, JsObject, JsObjectInit, JsResult, JsString, ModuleStatus,
    PropertyDescriptor, PropertyNameList, PropertyNameMode, PropertySlot, PutPropertySlot,
    Resolution, ResolvedBinding, RootVec, Shape, ShapeSpec, TypeFlags, Value, anchor, errors,
};

#[cell(name = "ModuleNamespaceObject", cell_type = ModuleNamespaceObject, ops,
    export = "engine_class_ModuleNamespace",
    flags = TypeFlags::INTERCEPTS_INDEXED_ACCESS
        .union(TypeFlags::GET_OWN_PROPERTY_SLOT_IS_IMPURE_FOR_ABSENCE)
        .union(TypeFlags::IS_IMMUTABLE_PROTOTYPE_EXOTIC_OBJECT))]
pub struct ModuleNamespace {
    base: JsDestructibleObject,
    module: Gc<AbstractModuleRecord>,
    is_deferred: bool,
    has_es_module_marker: Cell<bool>,
    /// In the order of their code units.
    names: Box<[Identifier]>,
    /// One for each name.
    #[cfg_attr(
        rootcheck,
        rootcheck::allow("`create` has them in a `RootVec` meanwhile")
    )]
    bindings: Box<[ResolvedBinding]>,
    positions: HashTable<u32>,
}

fn spread(name: PropertyName<'_>) -> u64 {
    u64::from(name.hash()).wrapping_mul(0x9e37_79b9_7f4a_7c15)
}

#[object_ops(export = "engine_ModuleNamespace")]
impl ModuleNamespace {
    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        self.get_slot(cx, name, slot)
    }

    fn get_own_property_slot_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        self.get_slot(cx, Identifier::from_index(index).name(), slot)
    }

    fn put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        slot.disable_caching();
        if self.is_es_module_marker(name) {
            return self.ordinary_put(cx, name, value, slot);
        }
        let is_strict = slot.is_strict();
        match self.live_source(cx)? {
            Some(source) if slot.is_receiver(self) => source.set(cx, name, value, is_strict),
            Some(_) => self.ordinary_set_slow(cx, name, value, slot.this_value(), is_strict),
            None => cx.reject(is_strict, errors::READ_ONLY_PROPERTY_WRITE),
        }
    }

    fn put_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        value: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        match self.live_source(cx)? {
            Some(source) => source.put_by_index(cx, index, value, should_throw),
            None => cx.reject(should_throw, errors::READ_ONLY_PROPERTY_WRITE),
        }
    }

    fn delete_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut DeletePropertySlot,
    ) -> JsResult<bool> {
        slot.disable_caching();
        if self.is_symbol_like(name) {
            return self.ordinary_delete_property(cx, name, slot);
        }
        self.delete_export(cx, name)
    }

    fn delete_property_by_index(&self, cx: &mut Cx, index: u32) -> JsResult<bool> {
        self.delete_export(cx, Identifier::from_index(index).name())
    }

    fn own_property_names(
        &self,
        cx: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        self.evaluate_if_deferred(cx)?;
        if let Some(source) = self.live_source(cx)? {
            let names = source.own_keys(cx, PropertyNameMode::Strings, DontEnumMode::Exclude)?;
            names.iter().for_each(|name| list.add(name.name()));
        }
        let this = anchor!(self);
        for (name, binding) in this.names.iter().zip(&this.bindings) {
            // To ask whether it is enumerable throws if it is not initialized.
            if mode == DontEnumMode::Exclude && !binding.is_live() {
                let method = InternalMethod::GetOwnProperty;
                let mut slot = PropertySlot::new(self.as_value(), method);
                if !self.get_slot(cx, name.name(), &mut slot)? {
                    continue;
                }
            }
            list.add(name.name());
        }
        if list.includes_symbols() {
            self.own_non_index_property_names(cx, list, mode)?;
        }
        Ok(())
    }

    fn define_own_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        if self.is_symbol_like(name) {
            return self.ordinary_define_own_property(cx, name, descriptor, should_throw);
        }
        if let Some(source) = self.live_source(cx)? {
            return source.define_own_property(cx, name, descriptor, should_throw);
        }
        let current = self.get_own_property_descriptor(cx, name)?;
        if self.is_es_module_marker(name) {
            return self.ordinary_define_own_property(cx, name, descriptor, should_throw);
        }
        let Some(current) = current else {
            return cx.reject(should_throw, errors::NON_EXTENSIBLE_DEFINE);
        };
        let refusal = if descriptor.is_accessor() {
            "Cannot change module namespace object's binding to accessor"
        } else if descriptor.has_writable() && !descriptor.writable() {
            "Cannot change module namespace object's binding to non-writable attribute"
        } else if descriptor.has_enumerable() && !descriptor.enumerable() {
            "Cannot replace module namespace object's binding with non-enumerable attribute"
        } else if descriptor.configurable() {
            "Cannot replace module namespace object's binding with configurable attribute"
        } else if let Some(value) = descriptor.value()
            && !value.same_value(cx, current.value().unwrap_or_default())?
        {
            "Cannot replace module namespace object's binding's value"
        } else {
            return Ok(true);
        };
        cx.reject(should_throw, refusal)
    }
}

impl ModuleNamespace {
    pub const OFFSET_OF_MODULE: usize = core::mem::offset_of!(ModuleNamespace, module);

    pub fn create_shape(cx: &Cx, prototype: Value) -> Gc<Shape> {
        let spec = ShapeSpec::of::<ModuleNamespace>();
        Shape::create(cx, Some(cx.global()), prototype, spec)
    }

    /// ModuleNamespaceCreate
    pub(super) fn create(
        cx: &Cx,
        module: &AbstractModuleRecord,
        mut exports: RootVec<(Identifier, ResolvedBinding)>,
        phase: ImportPhase,
        is_extensible: bool,
    ) -> Gc<ModuleNamespace> {
        exports.sort_unstable_by(|a, b| a.0.name().text().cmp(&b.0.name().text()));
        let mut positions = HashTable::with_capacity(exports.len());
        let hash = |&position: &u32| spread(exports[position as usize].0.name());
        for position in 0..exports.len() as u32 {
            positions.insert_unique(hash(&position), position, hash);
        }
        let namespace = cx.allocate::<ModuleNamespace>(ModuleNamespaceInit {
            base: JsObjectInit::new(cx, cx.module_namespace_shape()),
            module: module.into(),
            is_deferred: phase == ImportPhase::Defer,
            has_es_module_marker: Cell::new(false),
            names: exports.iter().map(|it| it.0.clone()).collect(),
            bindings: exports.iter().map(|it| it.1.clone()).collect(),
            positions,
        });
        drop(exports);
        let tag = match phase {
            ImportPhase::Evaluation => JsString::from_name(cx, names::Module),
            ImportPhase::Defer => JsString::from_literal(cx, "Deferred Module"),
        };
        namespace.put_direct(cx, symbols::toStringTag, tag.into(), Attributes::CONSTANT);
        if !is_extensible {
            namespace.ordinary_prevent_extensions(cx);
        }
        namespace
    }

    pub fn module(&self) -> Gc<AbstractModuleRecord> {
        self.module
    }

    /// For the `__esModule` accessor that the embedder puts on the prototype.
    pub fn has_es_module_marker(&self) -> &Cell<bool> {
        &self.has_es_module_marker
    }

    /// Assigns to the binding, whatever it is declared as. False if there is none.
    pub fn override_export(&self, cx: &mut Cx, name: &Identifier, value: Value) -> JsResult<bool> {
        let Resolution::Resolved(binding) = self.module.resolve_export(cx, name) else {
            return Ok(false);
        };
        if binding.module.has_live_exports() {
            return Ok(false);
        }
        if binding.is_namespace() {
            binding.module.namespace(cx, ImportPhase::Evaluation)?;
        }
        if let Some(environment) = binding.module.environment()
            && let Some(index) = environment.slot_of_binding(binding.name.name())
        {
            // SAFETY: code takes it for any value, and is told of the change.
            unsafe { environment.set(index, Some(value)) };
            (environment.template().foreign_write_watchpoints()).invalidate(cx);
        }
        Ok(true)
    }

    fn find(&self, name: PropertyName<'_>) -> Option<&ResolvedBinding> {
        let has_name = |&position: &u32| self.names[position as usize] == name;
        let &position = self.positions.find(spread(name), has_name)?;
        Some(&self.bindings[position as usize])
    }

    /// IsSymbolLikeNamespaceKey
    fn is_symbol_like(&self, name: PropertyName<'_>) -> bool {
        name.is_symbol() || (self.is_deferred && name == names::then)
    }

    fn is_es_module_marker(&self, name: PropertyName<'_>) -> bool {
        name == names::__esModule && self.find(name).is_none()
    }

    /// It can lead back here without a frame of a script in between.
    fn live_source(&self, cx: &Cx) -> JsResult<Option<Gc<JsObject>>> {
        let source = self.module.live_exports_source();
        if source.is_some() {
            cx.check_stack()?;
        }
        Ok(source)
    }

    /// What GetModuleExportsList does besides returning the list.
    #[inline]
    fn evaluate_if_deferred(&self, cx: &mut Cx) -> JsResult<()> {
        if !self.is_deferred {
            return Ok(());
        }
        if let Some(module) = self.module.downcast::<CyclicModuleRecord>() {
            let root = module.cycle_root().unwrap_or(module);
            if root.status() == ModuleStatus::Evaluated && root.evaluation_error().is_none() {
                return Ok(());
            }
        }
        self.module.evaluate_synchronously(cx)
    }

    fn delete_export(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<bool> {
        self.evaluate_if_deferred(cx)?;
        match self.live_source(cx)? {
            Some(source) => source.delete(cx, name),
            None => Ok(self.find(name).is_none()),
        }
    }

    fn get_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if self.is_symbol_like(name) {
            return self.ordinary_get_own_property_slot(cx, name, slot);
        }
        if slot.is_inquiry() {
            if self.is_es_module_marker(name) && !self.module.has_live_exports() {
                return self.ordinary_get_own_property_slot(cx, name, slot);
            }
            slot.taint_by_opaque_object();
            return Ok(false);
        }
        self.evaluate_if_deferred(cx)?;
        if self.module.has_live_exports() {
            slot.taint_by_opaque_object();
            return self.get_live_slot(cx, name, slot);
        }
        let Some(binding) = self.find(name).cloned() else {
            slot.taint_by_opaque_object();
            return Ok(
                name == names::__esModule && self.ordinary_get_own_property_slot(cx, name, slot)?
            );
        };
        let value = if slot.method() == InternalMethod::HasProperty {
            slot.taint_by_opaque_object();
            Value::UNDEFINED
        } else if binding.is_live() {
            slot.taint_by_opaque_object();
            (binding.module).get_reexported_live_export(cx, binding.name.name())?
        } else {
            self.read_binding(cx, name, &binding, slot)?
        };
        slot.set_value(self, Attributes::DONT_DELETE, value);
        Ok(true)
    }

    fn read_binding(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        binding: &ResolvedBinding,
        slot: &mut PropertySlot,
    ) -> JsResult<Value> {
        let Some((environment, index)) = binding.prepare(cx)? else {
            return Ok(Value::UNDEFINED);
        };
        let Some(value) = environment.read_variable(cx, index) else {
            return Err(errors::throw_uninitialized_variable(cx, name));
        };
        if let Some(module) = binding.module.downcast::<CyclicModuleRecord>()
            && let Some(ops) = module.foreign_ops()
            && let Some(shown) = (ops.read_export)(cx, value)?
        {
            return Ok(shown);
        }
        slot.set_module_binding(environment, index);
        Ok(value)
    }

    fn get_live_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        let is_marker = name == names::__esModule;
        if (slot.method() != InternalMethod::Get || is_marker)
            && !self.module.has_live_export(cx, name)?
        {
            return Ok(is_marker && self.ordinary_get_own_property_slot(cx, name, slot)?);
        }
        let value = match slot.method() {
            InternalMethod::HasProperty => Value::UNDEFINED,
            _ => self.module.get_live_export(cx, name)?,
        };
        slot.set_value(self, Attributes::NONE, value);
        Ok(true)
    }
}
