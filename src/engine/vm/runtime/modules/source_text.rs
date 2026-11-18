//! The Source Text Module Record of ECMA-262.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_engine_bytecode::{CodeFlags, ImportPhase, Instrumentation, Module, SlotKind};
use bun_engine_macros::cell;
use bun_engine_text::{Identifier, StringRef, names};

use super::cyclic::throw_link_error;
use crate::runtime::control::AsyncContextScope;
use crate::scope::static_scope_of;
use crate::{
    AbstractModuleRecord, CompileError, Cx, CyclicModuleRecord, Field, Gc, ImportEntry, ImportKind,
    JsObject, JsPromise, JsResult, ModuleEntries, ModuleEnvironment, ModuleExecutable,
    ModuleLoader, ModuleType, Resolution, ResolvedBinding, SourceCode, SourceProvider,
    SyntheticModuleRecord, Thrown, Value, Vm, anchor, throw_compile_error,
};

#[cell(
    name = "ModuleRecord",
    export = "engine_class_SourceTextModuleRecord",
    estimated_size
)]
pub struct SourceTextModuleRecord {
    base: CyclicModuleRecord,
    source: SourceCode,
    /// From the analysis, until the module is linked.
    unit: RefCell<Option<Rc<Module>>>,
    has_finished_with_code: Cell<bool>,
    pub(super) executable: Field<Option<Gc<ModuleExecutable>>>,
    /// Of code that awaits, what settles when it ends. See `Options::eval_mode` for its value.
    pub(super) promise_of_code: Field<Option<Gc<JsPromise>>>,
}

pub enum AnalysisError {
    Compile(CompileError),
    /// The message of a TypeError.
    Attributes(StringRef),
}

/// The realm and the scope around the module by address, and the key of the module.
pub(super) type ExecutableKey = ((usize, usize), Identifier);

fn is_indistinguishable(cx: &Cx, a: &SourceProvider, b: &SourceProvider) -> bool {
    core::ptr::eq(a, b)
        || (a.hash() == b.hash()
            && a.url() == b.url()
            && a.start_position() == b.start_position()
            && (cx.global().hooks().modules.have_same_origin)(a, b)
            && a.source() == b.source())
}

impl ModuleLoader {
    fn shares_code(&self, vm: &Vm) -> bool {
        !self.realm().module_loader(vm).is_same(self)
    }

    fn executable_key(&self, key: &Identifier) -> ExecutableKey {
        let scope = static_scope_of(self.module_scope());
        let scope = scope.map_or(0, |it| Rc::as_ptr(&it).addr());
        ((self.realm().address(), scope), key.clone())
    }

    /// What another loader has for the same module.
    fn find_executable(
        &self,
        cx: &Cx,
        key: &Identifier,
        source: &SourceProvider,
    ) -> Option<Gc<ModuleExecutable>> {
        if !self.shares_code(cx) {
            return None;
        }
        let executables = &cx.services.modules.executables;
        let executable = executables.get(cx, &self.executable_key(key))?;
        let (flags, wanted) = (executable.flags(), cx.global().instrumentation(cx));
        let is_alike = flags.contains(CodeFlags::HAS_DEBUG_HOOKS)
            == wanted.contains(Instrumentation::DEBUGGER)
            && flags.contains(CodeFlags::HAS_COVERAGE)
                == wanted.contains(Instrumentation::COVERAGE)
            && is_indistinguishable(cx, executable.provider(), source);
        is_alike.then_some(executable)
    }

    /// While something keeps it alive, the records of later loaders run the code that it has.
    pub fn shareable_executable(&self, cx: &Cx, key: &Identifier) -> Option<Gc<ModuleExecutable>> {
        (cx.services.modules.executables).get(cx, &self.executable_key(key))
    }

    fn compile(
        &self,
        cx: &Cx,
        key: &Identifier,
        source: &SourceProvider,
        needs_interface: bool,
    ) -> Result<Rc<Module>, CompileError> {
        let shared = (self.find_executable(cx, key, source)).and_then(|it| it.unit());
        match shared.filter(|it| it.has_interface || !needs_interface) {
            Some(unit) => Ok(unit),
            None => {
                let outer = static_scope_of(self.module_scope());
                cx.compile_module(source, outer.as_ref(), needs_interface)
            }
        }
    }
}

impl SourceTextModuleRecord {
    /// For an embedder that knows the entries. The text is compiled when the module is linked.
    pub fn create(
        cx: &Cx,
        loader: Gc<ModuleLoader>,
        key: Identifier,
        source: SourceCode,
    ) -> Gc<SourceTextModuleRecord> {
        let shape = loader.realm().module_record_shape(cx);
        let module_type = ModuleType::JavaScript;
        cx.allocate::<SourceTextModuleRecord>(SourceTextModuleRecordInit {
            base: CyclicModuleRecord::init(cx, shape, loader, key, module_type, None),
            source,
            unit: RefCell::new(None),
            has_finished_with_code: Cell::new(false),
            executable: None,
            promise_of_code: None,
        })
    }

    /// ParseModule
    pub fn analyze(
        cx: &Cx,
        loader: Gc<ModuleLoader>,
        key: Identifier,
        source: SourceCode,
    ) -> Result<Gc<SourceTextModuleRecord>, AnalysisError> {
        let cx = cx.in_realm_shared(loader.realm());
        let unit = loader.compile(cx, &key, &source.provider, true);
        let unit = unit.map_err(AnalysisError::Compile)?;
        let is_typescript = source.provider.may_reexport_types().get();
        let entries = ModuleEntries::of_module(&unit, is_typescript);
        let entries = entries.map_err(AnalysisError::Attributes)?;
        let has_live_exports = source.provider.has_live_exports().get();
        let module = Self::create(cx, loader, key, source);
        module.edit_entries(|empty| *empty = entries);
        module.is_typescript().set(is_typescript);
        let awaits = unit.code.body.flags().contains(CodeFlags::SUSPENDS);
        module.has_top_level_await().set(awaits);
        module.unit.replace(Some(unit));
        if has_live_exports {
            module.make_exports_live();
        }
        Ok(module)
    }

    pub fn source(&self) -> &SourceCode {
        &self.source
    }

    /// What `analyze` has compiled, until the module is linked.
    pub fn analyzed_unit(&self) -> Option<Rc<Module>> {
        self.unit.borrow().clone()
    }

    pub fn async_promise(&self) -> Option<Gc<JsPromise>> {
        self.promise_of_code()
    }

    fn ensure_executable(&self, cx: &mut Cx) -> JsResult<Gc<ModuleExecutable>> {
        if let Some(executable) = self.executable() {
            return Ok(executable);
        }
        let this = anchor!(self);
        let (loader, key, source) = (self.loader(), this.key(), &this.source);
        let provider = &source.provider;
        let unit = match self.unit.take() {
            Some(unit) => unit,
            None => (loader.compile(cx, key, provider, false))
                .map_err(|error| throw_compile_error(cx, &error, provider))?,
        };
        crate::code::log_origin_of_code(unit.code.body.is_stored());
        let shared = loader.find_executable(cx, key, provider);
        let executable = shared.filter(|it| it.share(&unit)).unwrap_or_else(|| {
            let is_shareable = loader.shares_code(cx);
            let executable = ModuleExecutable::create(cx, source, unit, is_shareable);
            if is_shareable {
                let key = loader.executable_key(key);
                cx.services.modules.executables.insert(key, executable);
            }
            executable
        });
        let awaits = executable.flags().contains(CodeFlags::SUSPENDS);
        self.has_top_level_await().set(awaits);
        self.set_executable(Some(executable));
        Ok(executable)
    }

    /// In a cycle, a module is imported from before it is its turn to be initialized.
    fn ensure_environment(&self, cx: &mut Cx) -> JsResult<Gc<ModuleEnvironment>> {
        if let Some(environment) = self.environment() {
            return Ok(environment);
        }
        let cx = cx.in_realm_of(self);
        let template = self.ensure_executable(cx)?.template();
        // SAFETY: what the code was compiled against.
        Ok(unsafe { ModuleEnvironment::create(cx, self.loader().module_scope(), template, self) })
    }

    /// The part of InitializeEnvironment that is left to do once the environment exists.
    pub(super) fn bind_imports(&self, cx: &mut Cx) -> JsResult<()> {
        let environment = self.ensure_environment(cx)?;
        let template = environment.template();
        let scope = template.anchor().scope();
        for import in self.entries().imports() {
            let imported = self.require_imported_module(cx, import.module.borrow())?;
            let slot = scope.find(import.local.name());
            if import.kind == ImportKind::Namespace {
                let namespace = imported.namespace(cx, import.phase)?;
                if let Some(slot) = slot.filter(|it| it.kind == SlotKind::Const) {
                    // SAFETY: a constant that the code does not initialize.
                    unsafe { environment.set(slot.index, Some(namespace.into())) };
                }
                continue;
            }
            let binding = match imported.resolve_export(cx, &import.imported) {
                Resolution::Resolved(binding) => binding,
                Resolution::NotFound if import.kind == ImportKind::SingleTypeScript => continue,
                failure => return Err(throw_unresolved(cx, import, &imported, &failure)),
            };
            let slot = slot.filter(|it| it.kind == SlotKind::Import);
            if binding.is_live() {
                if let Some(slot) = slot {
                    let is_reexported = binding.module != imported;
                    environment.bind_live_import(cx, slot.index, binding, is_reexported);
                }
                continue;
            }
            let Some((target, index)) = binding.prepare(cx)? else {
                if import.kind == ImportKind::SingleTypeScript {
                    continue;
                }
                let failure = Resolution::NotFound;
                return Err(throw_unresolved(cx, import, &imported, &failure));
            };
            if let Some(slot) = slot {
                environment.bind_import(slot.index, target, index);
            }
        }
        Ok(())
    }

    /// `None` if the module is not linked or its code does not refer to it.
    pub fn import_meta(&self, cx: &mut Cx) -> JsResult<Option<Gc<JsObject>>> {
        let Some(environment) = self.environment() else {
            return Ok(None);
        };
        let template = environment.template();
        let mut slots = template.scope().slots().iter();
        let Some(&slot) = slots.find(|it| it.kind == SlotKind::ImportMeta) else {
            return Ok(None);
        };
        if environment.get(slot.index).is_none() {
            let cx = cx.in_realm_of(self);
            let key = Value::from_name(cx, anchor!(self).key().name());
            let create = cx.global().hooks().modules.create_import_meta;
            let meta = create(cx, self.loader(), key, self.into())?;
            // SAFETY: what the slot is for.
            unsafe { environment.set(slot.index, Some(meta.into())) };
        }
        Ok(environment.get(slot.index).and_then(Value::as_object))
    }

    pub(super) fn execute(&self, cx: &mut Cx) -> JsResult<Value> {
        let loader = self.loader();
        let _scope = (loader.async_context()).map(|it| AsyncContextScope::enter(cx, it));
        let evaluate = cx.global().hooks().modules.evaluate;
        let key = Value::from_name(cx, anchor!(self).key().name());
        super::loader::log("evaluate", key);
        evaluate(cx, loader, key, self.into())
    }

    /// What `ModuleHooks::evaluate` comes down to. Code that awaits returns its promise.
    pub fn run_code(&self, cx: &mut Cx) -> JsResult<Value> {
        let cx = cx.in_realm_of(self);
        let (executable, environment) =
            (self.executable().zip(self.environment())).expect("linked");
        assert!(!self.has_finished_with_code.get());
        let result = cx.execute(executable.upcast(), environment.cell(), Value::UNDEFINED);
        if let (Ok(promise), true) = (&result, self.has_top_level_await().get()) {
            self.set_promise_of_code(Some(promise.cast()));
        }
        self.did_finish_with_code();
        result
    }

    /// Unless it is suspended.
    pub(super) fn did_finish_with_code(&self) {
        if let Some(executable) = self.executable()
            && !self.async_promise().is_some_and(|it| it.is_pending())
            && !self.has_finished_with_code.replace(true)
        {
            executable.did_finish_evaluation();
        }
    }

    fn estimated_size(&self, vm: &Vm) -> usize {
        let text = self.source.text();
        let unit_size = if text.is_latin1() { 1 } else { 2 };
        AbstractModuleRecord::estimated_size(self, vm) + text.len() * unit_size
    }
}

impl ResolvedBinding {
    /// The slot to read from now on. `None` if the module has not declared what it is said to export.
    pub fn prepare(&self, cx: &mut Cx) -> JsResult<Option<(Gc<ModuleEnvironment>, u32)>> {
        let environment = match self.module.downcast::<SourceTextModuleRecord>() {
            Some(module) => module.ensure_environment(cx)?,
            None => self.module.environment().expect("made with the record"),
        };
        if self.is_namespace() {
            self.module.namespace(cx, ImportPhase::Evaluation)?;
        }
        let Some(index) = environment.slot_of_binding(self.name.name()) else {
            return Ok(None);
        };
        if environment.get(index).is_none()
            && let Some(module) = self.module.downcast::<SyntheticModuleRecord>()
        {
            module.read_lazy_export(cx, self.name.name(), index)?;
        }
        Ok(Some((environment, index)))
    }
}

#[cold]
fn throw_unresolved(
    cx: &mut Cx,
    import: &ImportEntry,
    imported: &AbstractModuleRecord,
    failure: &Resolution,
) -> Thrown {
    let imported = anchor!(imported);
    let (name, local, key) = (&import.imported, &import.local, imported.key());
    match failure {
        Resolution::Ambiguous => {
            let middle = "' cannot be resolved due to ambiguous multiple bindings in module '";
            throw_link_error(cx, &["Export named '", middle, "'."], &[name, key])
        }
        Resolution::NoDefault => match imported.resolve_export(cx, local) {
            Resolution::Resolved(_) => {
                let middle = "' does not have an export named 'default'. Did you mean '";
                throw_link_error(cx, &["module '", middle, "'?"], &[key, local])
            }
            _ => throw_link_error(cx, &["Missing 'default' export in module '", "'."], &[key]),
        },
        _ => {
            let end = match imported.resolve_export(cx, &names::default.to_identifier()) {
                Resolution::Resolved(binding) if binding.name == *local => {
                    "'. Did you mean to import default?"
                }
                _ => "'.",
            };
            let words = ["Export named '", "' not found in module '", end];
            throw_link_error(cx, &words, &[name, key])
        }
    }
}
