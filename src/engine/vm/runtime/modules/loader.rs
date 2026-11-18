//! The registry of modules, and where loading starts.

use core::cell::Cell;
use std::rc::Rc;

use bun_engine_bytecode::ImportPhase;
use bun_engine_macros::cell;
use bun_engine_text::{Identifier, PropertyName, StringRef, SymbolRef, private_names};

use super::failure::{self, FailureKind};
use super::loading::{Goal, GraphLoad, LoadContext};
use super::request::type_of;
use super::{handled_promise, react};
use crate::scope::realm_of_scope;
use crate::{
    AbstractModuleRecord, AnalysisError, CodeBlock, Cx, CyclicModuleRecord, Environment,
    ErrorInstance, ErrorType, FetchParameters, Field, Gc, GlobalObject, InternalMicrotask, JsCell,
    JsPromise, JsResult, JsSourceCode, JsString, ModuleEnvironment, ModuleKey, ModuleKeyRef,
    ModuleName, ModuleRegistryEntry, ModuleRequest, ModuleType, PromiseStatus, RegistryStatus,
    SourceCode, SourceProvider, SourceProviderRef, SourceTextModuleRecord, SourceType,
    SyntheticExports, SyntheticModuleRecord, TracedMap, TypeFlags, Value, Vm,
    create_compile_error_in, json, options, origin_of_caller,
};

/// The key of the referrer and the specifier.
pub(super) type ResolutionKey = (Option<Identifier>, Identifier);

#[cell(cell_type = ModuleLoader, flags = TypeFlags::SHAPE_IS_IMMORTAL, export = "engine_class_ModuleLoader")]
pub struct ModuleLoader {
    base: JsCell,
    module_scope: Gc<JsCell>,
    /// What the code at the top level of the modules runs in, if not in that of whoever evaluates them.
    pub async_context: Field<Option<Value>>,
    pub registry: TracedMap<ModuleKey, Gc<ModuleRegistryEntry>>,
    /// `[[LoadedModules]]` of the realm. Only what is in the registry.
    pub(super) loaded_modules: TracedMap<ModuleKey, Gc<AbstractModuleRecord>>,
    pub(super) resolution_failures: TracedMap<ResolutionKey, Value>,
    entries_of_other_types: Cell<u32>,
    modules_being_made: Cell<u32>,
    /// The address of the key. See `load_synchronously`.
    pub(super) root_being_reloaded: Cell<usize>,
}

/// How far a load goes, and what its promise is fulfilled with.
#[derive(Clone, Copy)]
pub enum LoadGoal {
    /// The key, once all that the module requests has been loaded.
    Load,
    /// The key, once the module has been evaluated.
    Evaluate,
    /// The namespace object.
    Import {
        phase: ImportPhase,
        /// `async_evaluation_order` of the module that calls `import()`.
        referrer_order: Option<u64>,
    },
}

type Parameters = Option<Rc<FetchParameters>>;

/// Nothing for a module that has no URL.
pub(super) fn referrer_text(key: Option<&Identifier>) -> Option<StringRef> {
    key.map(|key| match key.name().is_symbol() {
        true => StringRef::empty(),
        false => key.string().clone(),
    })
}

/// Before the embedder is asked.
pub(super) fn log(step: &str, name: Value) {
    if options().log_module_loading {
        let name = (name.as_string()).map_or_default(|it| it.to_string_without_resolving());
        bun_engine_platform::log(format_args!("Loader [{step}] {name}\n"));
    }
}

impl ModuleLoader {
    /// `module_scope` is what is around the modules: the global object, or an environment that is no `with` scope.
    pub fn create(vm: &Vm, module_scope: Gc<JsCell>) -> Gc<ModuleLoader> {
        vm.allocate::<ModuleLoader>(ModuleLoaderInit {
            base: vm.shape_for::<ModuleLoader>(),
            module_scope,
            async_context: None,
            entries_of_other_types: Cell::new(0),
            modules_being_made: Cell::new(0),
            root_being_reloaded: Cell::new(0),
        })
    }

    pub fn module_scope(&self) -> Gc<JsCell> {
        self.module_scope
    }

    pub fn realm(&self) -> Gc<GlobalObject> {
        realm_of_scope(self.module_scope)
    }

    /// What `import()` in that scope uses. The embedder can bind `@moduleLoader`.
    pub fn for_scope(vm: &Vm, scope: Gc<JsCell>) -> Gc<ModuleLoader> {
        let of_environment = |environment: Gc<Environment>| {
            if let Some(environment) = environment.downcast::<ModuleEnvironment>() {
                return Some(environment.module().loader());
            }
            let template = environment.template();
            let slot = template.scope().find(private_names::moduleLoader)?;
            environment.get(slot.index)?.downcast()
        };
        let first = scope.downcast::<Environment>();
        (first.and_then(|first| first.chain().find_map(of_environment)))
            .unwrap_or_else(|| realm_of_scope(scope).module_loader(vm))
    }

    // The registry

    pub fn find_entry(&self, key: ModuleKeyRef<'_>) -> Option<Gc<ModuleRegistryEntry>> {
        self.registry().get(&key)
    }

    pub fn find_entry_of_any_type(&self, key: PropertyName<'_>) -> Option<Gc<ModuleRegistryEntry>> {
        use ModuleType::{Css, HostDefined, JavaScript, Json, Text, WebAssembly};
        let find = |module_type| self.find_entry(ModuleKeyRef::new(key, module_type));
        let entry = find(JavaScript);
        if entry.is_some() || self.entries_of_other_types.get() == 0 {
            return entry;
        }
        [HostDefined, Json, Text, WebAssembly, Css]
            .into_iter()
            .find_map(find)
    }

    pub fn ensure_entry(&self, vm: &Vm, key: ModuleKeyRef<'_>) -> Gc<ModuleRegistryEntry> {
        self.find_entry(key).unwrap_or_else(|| {
            let entry = ModuleRegistryEntry::create(vm, self, key);
            self.registry().insert(key.to_key(), entry);
            if key.module_type != ModuleType::JavaScript {
                self.entries_of_other_types.update(|count| count + 1);
            }
            entry
        })
    }

    fn unregister(&self, key: ModuleKeyRef<'_>) -> bool {
        let was_registered = self.registry().remove(&key).is_some();
        if was_registered && key.module_type != ModuleType::JavaScript {
            self.entries_of_other_types.update(|count| count - 1);
        }
        was_registered
    }

    /// Those of all types. Whether there was one.
    pub fn remove_entries(&self, key: PropertyName<'_>) -> bool {
        (self.loaded_modules())
            .retain(|request, module| request.name != key && *module.key() != key);
        self.resolution_failures()
            .retain(|(referrer, specifier), _| {
                *specifier != key && referrer.as_ref().is_none_or(|it| *it != key)
            });
        let mut was_registered = false;
        while let Some(entry) = self.find_entry_of_any_type(key) {
            was_registered |= self.unregister(entry.typed_key());
        }
        was_registered
    }

    pub fn clear(&self) {
        self.loaded_modules().clear();
        self.registry().clear();
        self.resolution_failures().clear();
        self.entries_of_other_types.set(0);
    }

    pub fn async_evaluation_order(&self, key: PropertyName<'_>) -> Option<u64> {
        let entry = self.find_entry(ModuleKeyRef::new(key, ModuleType::JavaScript))?;
        (entry.record()?.downcast::<CyclicModuleRecord>()?).async_evaluation_order()
    }

    /// In place of a fetch, unless one has begun. `data` is what `make_module` takes.
    pub fn provide_fetch(&self, cx: &Cx, key: ModuleKeyRef<'_>, data: Value) {
        let entry = self.ensure_entry(cx, key);
        if entry.status() == RegistryStatus::New {
            entry.provide_fetch(cx, data);
        }
    }

    // The embedder

    pub fn resolve(
        &self,
        cx: &mut Cx,
        name: &Identifier,
        referrer: Option<&Identifier>,
        kind: ModuleName,
    ) -> JsResult<Identifier> {
        let value = |name: Option<&Identifier>| match name.filter(|it| !it.name().is_symbol()) {
            Some(name) => JsString::from_name(cx, name.name()).into(),
            None => Value::UNDEFINED,
        };
        let (name, referrer) = (value(Some(name)), value(referrer));
        log("resolve", name);
        (cx.global().hooks().modules.resolve)(cx, self.into(), name, referrer, kind)
    }

    pub(super) fn fetch(
        &self,
        cx: &mut Cx,
        key: &Identifier,
        referrer: Option<&StringRef>,
        parameters: Parameters,
    ) -> JsResult<Gc<JsPromise>> {
        let key = Value::from_name(cx, key.name());
        log("fetch", key);
        (cx.global().hooks().modules.fetch)(cx, self.into(), key, referrer, parameters)
    }

    /// A synchronous load does not wait for a fetch that is under way.
    pub(super) fn fetch_again(
        &self,
        cx: &mut Cx,
        pending: &JsPromise,
        key: &Identifier,
        referrer: Option<&StringRef>,
        parameters: Parameters,
    ) -> JsResult<()> {
        let promise = self.fetch(cx, key, referrer, parameters)?;
        match promise.status() {
            PromiseStatus::Fulfilled => pending.fulfill_promise(cx, promise.result()),
            PromiseStatus::Rejected => pending.reject_promise(cx, promise.result()),
            PromiseStatus::Pending => {}
        }
        Ok(())
    }

    // Records

    /// From a `JsSourceCode`, a record, or any other value, which becomes the default export.
    pub fn make_module(
        &self,
        cx: &mut Cx,
        key: &Identifier,
        data: Value,
    ) -> JsResult<Gc<JsPromise>> {
        let promise = handled_promise(cx);
        self.modules_being_made.update(|count| count + 1);
        let result = self.make_module_for(cx, key, data, promise);
        self.modules_being_made.update(|count| count - 1);
        if let Err(thrown) = result {
            promise.reject_with_caught(cx, thrown)?;
        }
        Ok(promise)
    }

    fn make_module_for(
        &self,
        cx: &mut Cx,
        key: &Identifier,
        data: Value,
        promise: Gc<JsPromise>,
    ) -> JsResult<()> {
        let this = Gc::from(self);
        let fulfill_with_default = |cx: &Cx, module_type, value| {
            let key = key.clone();
            let module =
                SyntheticModuleRecord::with_default_export(cx, this, key, module_type, value);
            promise.fulfill(cx, module.into());
        };
        let Some(code) = data.downcast::<JsSourceCode>() else {
            match data.is::<AbstractModuleRecord>() {
                true => promise.fulfill(cx, data),
                false => fulfill_with_default(cx, ModuleType::Css, data),
            }
            return Ok(());
        };
        let source = code.source().clone();
        let hooks = &cx.global().hooks().modules;
        match source.provider.source_type() {
            SourceType::WebAssembly => (cx.hooks().make_wasm_module)(cx, this, key, code, promise)?,
            SourceType::AnalyzedModule => {
                cx.ensure_can_run(&source.provider)?;
                (hooks.make_analyzed_module)(cx, this, key, &source, promise)?;
            }
            SourceType::Json => {
                let value = json::parse(cx, source.text().into()).inspect_err(|_| {
                    let error = cx.exception().map_or_default(|it| it.value());
                    let key = ModuleKeyRef::new(key.name(), ModuleType::Json);
                    failure::note(cx, error, key, FailureKind::Evaluation);
                })?;
                fulfill_with_default(cx, ModuleType::Json, value);
            }
            SourceType::Text => {
                let text = JsString::new(cx, source.provider.source().clone());
                fulfill_with_default(cx, ModuleType::Text, text.into());
            }
            SourceType::Synthetic => {
                let mut exports = SyntheticExports::default();
                (hooks.generate_exports)(cx, &source.provider, key, &mut exports)?;
                let (key, module_type) = (key.clone(), ModuleType::JavaScript);
                let module = match source.provider.has_live_exports().get() {
                    true => SyntheticModuleRecord::create_live(cx, this, key, &exports),
                    false => SyntheticModuleRecord::create(cx, this, key, module_type, &exports),
                };
                promise.fulfill(cx, module.into());
            }
            _ => {
                cx.ensure_can_run(&source.provider)?;
                self.make_source_text_module(cx, key, &source, promise);
            }
        }
        Ok(())
    }

    pub(super) fn make_source_text_module(
        &self,
        cx: &mut Cx,
        key: &Identifier,
        source: &SourceCode,
        promise: Gc<JsPromise>,
    ) {
        let module = SourceTextModuleRecord::analyze(cx, self.into(), key.clone(), source.clone());
        let error = match module {
            Ok(module) => return promise.fulfill(cx, module.into()),
            Err(AnalysisError::Compile(error)) => {
                create_compile_error_in(cx, &error, &source.provider)
            }
            Err(AnalysisError::Attributes(message)) => {
                ErrorInstance::new(cx, ErrorType::TypeError, Some(message))
            }
        };
        let key = ModuleKeyRef::new(key.name(), ModuleType::JavaScript);
        failure::note(cx, error.into(), key, FailureKind::Evaluation);
        promise.reject(cx, error.into());
    }

    // Loading

    pub fn load(
        &self,
        cx: &mut Cx,
        key: &Identifier,
        parameters: Parameters,
        goal: LoadGoal,
        referrer: Option<&StringRef>,
    ) -> JsResult<Gc<JsPromise>> {
        let typed_key = ModuleKeyRef::new(key.name(), type_of(parameters.as_ref()));
        let mut fetch = None;
        if let Some(entry) = self.find_entry(typed_key) {
            if entry.fetch_error().is_some() {
                self.unregister(typed_key);
            } else if let Some(error) = entry.error() {
                return Ok(JsPromise::rejected(cx, error));
            } else if entry.status() != RegistryStatus::New {
                let promise = entry.ensure_fetch_promise(cx);
                if cx.has_synchronous_module_queue()
                    && entry.status() == RegistryStatus::Fetching
                    && promise.is_pending()
                {
                    self.fetch_again(cx, &promise, key, referrer, parameters.clone())?;
                }
                fetch = Some(promise);
            }
        }
        let fetch = match fetch {
            Some(promise) => promise,
            None => self.fetch(cx, key, referrer, parameters.clone())?,
        };
        let parameters = parameters.unwrap_or_else(|| FetchParameters::new(typed_key.module_type));
        let request = ModuleRequest::new(key.clone(), Some(parameters));
        let context = LoadContext::for_root(cx, self, request, goal.into());
        let (loaded, result) = (handled_promise(cx), handled_promise(cx));
        let task = InternalMicrotask::ModuleLoadTopSettled;
        react(cx, &fetch, task, loaded, context);
        let task = InternalMicrotask::ModuleLoadTopRejected;
        react(cx, &loaded, task, result, context);
        Ok(result)
    }

    /// For `require()`. The promise is pending if something has to be waited for.
    pub fn load_synchronously(
        &self,
        cx: &mut Cx,
        key: &Identifier,
        parameters: Parameters,
    ) -> JsResult<Gc<JsPromise>> {
        let _queue = cx.synchronous_module_queue_scope();
        let typed_key = ModuleKeyRef::new(key.name(), type_of(parameters.as_ref()));
        let entry_being_loaded = || {
            let entry = self.find_entry(typed_key);
            entry.filter(|it| it.load_promise().is_some_and(|it| it.is_pending()))
        };
        let was_being_loaded = entry_being_loaded().is_some();
        let result = self.load(cx, key, parameters.clone(), LoadGoal::Evaluate, None)?;
        cx.drain_synchronous_module_queue()?;
        // The step that ends the other load is among the ordinary microtasks, so it is taken once more.
        let waits_for_other_load = result.is_pending()
            && was_being_loaded
            && self.modules_being_made.get() == 0
            && entry_being_loaded().is_some_and(|entry| {
                entry.status() == RegistryStatus::Fetched && !entry.was_load_started_synchronously()
            });
        if !waits_for_other_load {
            return Ok(result);
        }
        let outer_root = self.root_being_reloaded.replace(key.name().address());
        let result = (self.load(cx, key, parameters, LoadGoal::Evaluate, None))
            .and_then(|result| cx.drain_synchronous_module_queue().map(|()| result));
        self.root_being_reloaded.set(outer_root);
        result
    }

    /// What `ModuleHooks::import` comes down to.
    pub fn request_import(
        &self,
        cx: &mut Cx,
        specifier: &Identifier,
        referrer: Option<&Identifier>,
        parameters: Parameters,
        phase: ImportPhase,
        referrer_order: Option<u64>,
    ) -> JsResult<Gc<JsPromise>> {
        let key = self.resolve(cx, specifier, referrer, ModuleName::Specifier)?;
        self.request_import_of_key(cx, &key, referrer, parameters, phase, referrer_order)
    }

    pub fn request_import_of_key(
        &self,
        cx: &mut Cx,
        key: &Identifier,
        referrer: Option<&Identifier>,
        parameters: Parameters,
        phase: ImportPhase,
        referrer_order: Option<u64>,
    ) -> JsResult<Gc<JsPromise>> {
        let goal = LoadGoal::Import {
            phase,
            referrer_order,
        };
        let referrer = referrer_text(referrer);
        let loaded = self.load(cx, key, parameters, goal, referrer.as_ref())?;
        let result = handled_promise(cx);
        let task = InternalMicrotask::ImportModuleNamespace;
        react(cx, &loaded, task, result, Value::UNDEFINED);
        Ok(result)
    }

    /// From the options of `import()` on.
    pub fn import(
        &self,
        cx: &mut Cx,
        specifier: Gc<JsString>,
        options: Value,
        origin: Option<&SourceProvider>,
        phase: ImportPhase,
    ) -> JsResult<Gc<JsPromise>> {
        log("import", specifier.into());
        let parameters = FetchParameters::from_import_options(cx, options)?;
        let import = cx.global().hooks().modules.import;
        import(cx, self.into(), specifier, parameters, origin, phase)
    }
}

pub fn load_and_evaluate_module(
    cx: &mut Cx,
    name: &Identifier,
    parameters: Parameters,
) -> JsResult<Gc<JsPromise>> {
    let loader = cx.module_loader();
    let key = loader.resolve(cx, name, None, ModuleName::Entry)?;
    loader.load(cx, &key, parameters, LoadGoal::Evaluate, None)
}

/// For JavaScript code that no key names.
pub fn evaluate_module_source(cx: &mut Cx, source: SourceCode) -> JsResult<Gc<JsPromise>> {
    let loader = cx.module_loader();
    let key = SymbolRef::private(&StringRef::from_literal("EntrypointModule"));
    let request = ModuleRequest::new(key.into(), None);
    let source = JsSourceCode::create(cx, source);
    loader.provide_fetch(cx, request.key(), source.into());
    let payload = GraphLoad::create(cx, handled_promise(cx)).upcast();
    loader.load_for_realm(cx, &request, payload, Goal::Evaluate)
}

/// The instruction `dynamic_import`: EvaluateImportCall, once the operands are evaluated.
pub fn dynamic_import(
    cx: &mut Cx,
    caller: &CodeBlock,
    specifier: Value,
    options: Value,
    scope: Gc<JsCell>,
    phase: ImportPhase,
) -> JsResult<Value> {
    let origin = match caller.executable() {
        builtin if builtin.is_private_builtin() => origin_of_caller(cx),
        caller => Some(SourceProviderRef::retain(caller.provider().origin())),
    };
    let loader = ModuleLoader::for_scope(cx, scope);
    let imported = (specifier.to_string(cx))
        .and_then(|specifier| loader.import(cx, specifier, options, origin.as_deref(), phase));
    let imported = match imported {
        Ok(imported) => imported,
        Err(thrown) => return JsPromise::rejected_with_caught(cx, thrown).map(Into::into),
    };
    let promise = JsPromise::new(cx);
    match imported.status() {
        PromiseStatus::Fulfilled => promise.fulfill(cx, imported.result()),
        _ => promise.resolve_unobserved(cx, &imported),
    }
    Ok(promise.into())
}
