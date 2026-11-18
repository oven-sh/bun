//! The Module Record of ECMA-262.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_engine_bytecode::ImportPhase;
use bun_engine_macros::cell;
use bun_engine_text::{Identifier, PropertyName};

use crate::{
    Cx, CyclicModuleRecord, FastHashMap, Field, Gc, GcCell, JsDestructibleObject, JsObject,
    JsObjectInit, JsPromise, JsResult, ModuleEntries, ModuleEnvironment, ModuleKey, ModuleKeyRef,
    ModuleLoader, ModuleNamespace, ModuleRequest, ModuleType, ResolvedBinding, Shape, TracedMap,
    Value, Vm, errors,
};

#[cell(
    name = "AbstractModuleRecord",
    export = "engine_class_AbstractModuleRecord",
    estimated_size
)]
pub struct AbstractModuleRecord {
    base: JsDestructibleObject,
    key: Identifier,
    loader: Gc<ModuleLoader>,
    module_type: ModuleType,
    is_typescript: Cell<bool>,
    has_live_exports: Cell<bool>,
    entries: RefCell<Rc<ModuleEntries>>,
    /// `[[LoadedModules]]`
    pub loaded_modules: TracedMap<ModuleKey, Gc<AbstractModuleRecord>>,
    /// The keys of the requested modules that are being loaded.
    resolved_requests: RefCell<FastHashMap<ModuleKey, Identifier>>,
    pub(super) resolutions: GcCell<FastHashMap<Identifier, ResolvedBinding>>,
    pub(super) created_environment: Field<Option<Gc<ModuleEnvironment>>>,
    pub(super) created_namespace: Field<Option<Gc<ModuleNamespace>>>,
    pub(super) created_deferred_namespace: Field<Option<Gc<ModuleNamespace>>>,
    pub(self) live_exports: Field<Option<Gc<JsObject>>>,
}

impl AbstractModuleRecord {
    pub(super) fn init(
        vm: &Vm,
        shape: Gc<Shape>,
        loader: Gc<ModuleLoader>,
        key: Identifier,
        module_type: ModuleType,
    ) -> AbstractModuleRecordInit {
        AbstractModuleRecordInit {
            base: JsObjectInit::new(vm, shape),
            key,
            loader,
            module_type,
            is_typescript: Cell::new(false),
            has_live_exports: Cell::new(false),
            entries: RefCell::default(),
            resolved_requests: RefCell::default(),
            created_environment: None,
            created_namespace: None,
            created_deferred_namespace: None,
            live_exports: None,
        }
    }

    pub fn key(&self) -> &Identifier {
        &self.key
    }

    pub fn loader(&self) -> Gc<ModuleLoader> {
        self.loader
    }

    pub fn module_type(&self) -> ModuleType {
        self.module_type
    }

    /// Whether what it exports from other modules may be a type.
    pub fn is_typescript(&self) -> &Cell<bool> {
        &self.is_typescript
    }

    pub fn entries(&self) -> Rc<ModuleEntries> {
        Rc::clone(&self.entries.borrow())
    }

    /// Before the module is loaded any further.
    pub fn edit_entries(&self, edit: impl FnOnce(&mut ModuleEntries)) {
        edit(Rc::make_mut(&mut self.entries.borrow_mut()));
    }

    pub fn environment(&self) -> Option<Gc<ModuleEnvironment>> {
        self.created_environment()
    }

    pub fn resolved_requests(&self) -> &RefCell<FastHashMap<ModuleKey, Identifier>> {
        &self.resolved_requests
    }

    pub(super) fn forget_resolved_request(&self, request: &ModuleRequest) {
        let mut requests = self.resolved_requests.borrow_mut();
        if requests.remove(&request.key()).is_some() && requests.is_empty() {
            requests.shrink_to_fit();
        }
    }

    /// GetImportedModule. There is none if the entries that the embedder gave name what they do not request.
    pub fn imported_module(&self, request: ModuleKeyRef<'_>) -> Option<Gc<AbstractModuleRecord>> {
        self.loaded_modules().get(&request)
    }

    /// For modules that the embedder loads itself.
    pub fn set_imported_module(&self, request: ModuleKeyRef<'_>, module: Gc<AbstractModuleRecord>) {
        self.loaded_modules().insert(request.to_key(), module);
    }

    /// Link
    pub fn link(&self, cx: &mut Cx) -> JsResult<()> {
        match self.downcast::<CyclicModuleRecord>() {
            Some(cyclic) => cyclic.link(cx),
            None => Ok(()),
        }
    }

    /// Evaluate
    pub fn evaluate(&self, cx: &mut Cx) -> JsResult<Gc<JsPromise>> {
        self.evaluate_for(cx, None)
    }

    pub(super) fn evaluate_for(
        &self,
        cx: &mut Cx,
        importer: Option<&super::evaluation::Importer>,
    ) -> JsResult<Gc<JsPromise>> {
        match self.downcast::<CyclicModuleRecord>() {
            Some(cyclic) => cyclic.evaluate_graph(cx, importer),
            None => Ok(JsPromise::fulfilled(cx, Value::UNDEFINED)),
        }
    }

    /// GetModuleNamespace
    pub fn namespace(&self, cx: &mut Cx, phase: ImportPhase) -> JsResult<Gc<ModuleNamespace>> {
        self.namespace_with(cx, phase, false)
    }

    /// One that is made now can take an own property `__esModule`.
    pub fn extensible_namespace(&self, cx: &mut Cx) -> JsResult<Gc<ModuleNamespace>> {
        self.namespace_with(cx, ImportPhase::Evaluation, true)
    }

    fn namespace_with(
        &self,
        cx: &mut Cx,
        phase: ImportPhase,
        is_extensible: bool,
    ) -> JsResult<Gc<ModuleNamespace>> {
        let created = match phase {
            ImportPhase::Evaluation => self.created_namespace(),
            ImportPhase::Defer => self.created_deferred_namespace(),
        };
        if let Some(namespace) = created {
            return Ok(namespace);
        }
        let exports = self.resolve_all_exports(cx)?;
        let namespace = ModuleNamespace::create(cx, self, exports, phase, is_extensible);
        if phase == ImportPhase::Defer {
            self.set_created_deferred_namespace(Some(namespace));
            return Ok(namespace);
        }
        self.set_created_namespace(Some(namespace));
        if let Some(environment) = self.environment() {
            environment.set_namespace(namespace);
        }
        Ok(namespace)
    }

    /// For a module whose exports are all local and have no code to declare them. They are not initialized.
    pub fn create_environment_for_exports(&self, cx: &Cx) -> Gc<ModuleEnvironment> {
        let entries = self.entries();
        let names = entries.exports().iter().map(|it| it.exported.clone());
        let scope = bun_engine_bytecode::StaticScope::of_exports(names.collect());
        let template = crate::ScopeTemplate::create(cx, scope);
        // SAFETY: nothing is around it.
        unsafe { ModuleEnvironment::create(cx, cx.global().cell(), template, self) }
    }

    // Live exports are for mocks. Every name is an export, and each read of it is one of a property of the source.

    #[inline]
    pub fn has_live_exports(&self) -> bool {
        self.has_live_exports.get()
    }

    /// Before anything is linked to the module.
    pub(super) fn make_exports_live(&self) {
        self.has_live_exports.set(true);
    }

    pub fn live_exports_source(&self) -> Option<Gc<JsObject>> {
        self.live_exports()
    }

    pub fn set_live_exports_source(&self, source: Gc<JsObject>) {
        assert!(self.has_live_exports());
        self.set_live_exports(Some(source));
    }

    pub fn get_live_export(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Value> {
        cx.check_stack()?;
        match self.live_exports() {
            Some(source) => source.get(cx, name),
            None => Err(errors::throw_uninitialized_variable(cx, name)),
        }
    }

    pub(super) fn has_live_export(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<bool> {
        cx.check_stack()?;
        match self.live_exports() {
            Some(source) => source.has_property(cx, name),
            None => Ok(false),
        }
    }

    /// For a read by way of another module. What the source does not have is undefined, whatever its `[[Get]]` does.
    pub fn get_reexported_live_export(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
    ) -> JsResult<Value> {
        if self.live_exports().is_some() && !self.has_live_export(cx, name)? {
            return Ok(Value::UNDEFINED);
        }
        self.get_live_export(cx, name)
    }

    pub(super) fn estimated_size(&self, _: &Vm) -> usize {
        self.cell_size() + self.entries.borrow().size()
    }
}
