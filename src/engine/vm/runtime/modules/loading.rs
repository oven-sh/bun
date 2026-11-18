//! LoadRequestedModules, HostLoadImportedModule and what they call.

use core::cell::{Cell, RefCell};

use bun_engine_bytecode::ImportPhase;
use bun_engine_macros::cell;
use bun_engine_text::Identifier;

use super::failure::{self, FailureKind};
use super::loader::{ResolutionKey, referrer_text};
use super::{handled_promise, react};
use crate::{
    AbstractModuleRecord, Cx, CyclicModuleRecord, FastHashSet, Field, Gc, InternalMicrotask,
    InternalReaction, JsCell, JsPromise, JsResult, LoadGoal, ModuleKeyRef, ModuleLoader,
    ModuleName, ModuleRegistryEntry, ModuleRequest, ModuleStatus, PromiseStatus, RegistryStatus,
    TracedVec, TypeFlags, Value, Vm,
};

/// The module that requests another. `None` stands for the realm.
type Referrer = Option<Gc<CyclicModuleRecord>>;
type Completion = Result<Gc<AbstractModuleRecord>, Value>;

/// The payload of HostLoadImportedModule. At the root of a load, its promise is joined with another.
#[cell(flags = TypeFlags::SHAPE_IS_IMMORTAL)]
pub(super) struct Payload {
    base: JsCell,
    promise: Gc<JsPromise>,
    is_half_joined: Cell<bool>,
    pub(super) joined_value: Field<Value>,
}

impl Payload {
    fn init(shape: Gc<crate::Shape>, promise: Gc<JsPromise>) -> PayloadInit {
        PayloadInit {
            base: shape,
            promise,
            is_half_joined: Cell::new(false),
            joined_value: Value::UNDEFINED,
        }
    }

    pub(super) fn promise(&self) -> Gc<JsPromise> {
        self.promise
    }

    /// One of the two has settled. Whether it is the second.
    pub(super) fn join(&self) -> bool {
        self.is_half_joined.replace(true)
    }
}

/// The GraphLoadingState Record of ECMA-262.
#[cell(name = "ModuleGraphLoadingState")]
pub(super) struct GraphLoad {
    base: Payload,
    is_loading: Cell<bool>,
    pending_modules: Cell<usize>,
    pub(self) visited: TracedVec<Gc<CyclicModuleRecord>>,
    visited_addresses: RefCell<FastHashSet<usize>>,
    /// What InnerModuleLoading is yet to be performed on, in place of recursion.
    pub(self) queue: TracedVec<Gc<AbstractModuleRecord>>,
    is_draining_queue: Cell<bool>,
}

#[cell(name = "ModuleLoaderPayload")]
pub(super) struct DynamicImport {
    base: Payload,
    phase: ImportPhase,
    referrer_order: Option<u64>,
    /// Of a deferred module, those that are awaited.
    pending_dependencies: Cell<usize>,
}

impl DynamicImport {
    pub(super) fn create(
        vm: &Vm,
        promise: Gc<JsPromise>,
        phase: ImportPhase,
        referrer_order: Option<u64>,
    ) -> Gc<DynamicImport> {
        vm.allocate::<DynamicImport>(DynamicImportInit {
            base: Payload::init(vm.shape_for::<DynamicImport>(), promise),
            phase,
            referrer_order,
            pending_dependencies: Cell::new(0),
        })
    }

    pub(super) fn phase(&self) -> ImportPhase {
        self.phase
    }

    pub(super) fn referrer_order(&self) -> Option<u64> {
        self.referrer_order
    }

    pub(super) fn pending_dependencies(&self) -> &Cell<usize> {
        &self.pending_dependencies
    }
}

#[derive(Clone, Copy)]
pub(super) enum Goal {
    Load,
    Evaluate,
    Import(ImportPhase, Option<u64>),
}

impl From<LoadGoal> for Goal {
    fn from(goal: LoadGoal) -> Goal {
        match goal {
            LoadGoal::Load => Goal::Load,
            LoadGoal::Evaluate => Goal::Evaluate,
            LoadGoal::Import {
                phase,
                referrer_order,
            } => Goal::Import(phase, referrer_order),
        }
    }
}

/// What the steps at the root of a load have to know.
#[cell(name = "ModuleLoadingContext", flags = TypeFlags::SHAPE_IS_IMMORTAL)]
pub(super) struct LoadContext {
    base: JsCell,
    loader: Gc<ModuleLoader>,
    request: ModuleRequest,
    goal: Goal,
}

impl LoadContext {
    pub(super) fn for_root(
        vm: &Vm,
        loader: &ModuleLoader,
        request: ModuleRequest,
        goal: Goal,
    ) -> Gc<LoadContext> {
        vm.allocate::<LoadContext>(LoadContextInit {
            base: vm.shape_for::<LoadContext>(),
            loader: loader.into(),
            request,
            goal,
        })
    }

    pub(super) fn loader(&self) -> Gc<ModuleLoader> {
        self.loader
    }

    pub(super) fn request(&self) -> ModuleRequest {
        self.request.clone()
    }

    pub(super) fn goal(&self) -> Goal {
        self.goal
    }
}

/// A call of HostLoadImportedModule that has to wait.
#[cell(name = "ModuleLoadingContext", flags = TypeFlags::SHAPE_IS_IMMORTAL)]
pub(super) struct PendingRequest {
    base: JsCell,
    referrer: Referrer,
    request: ModuleRequest,
    payload: Gc<Payload>,
    entry: Gc<ModuleRegistryEntry>,
    awaits: Cell<Awaited>,
    pub(self) module: Field<Option<Gc<AbstractModuleRecord>>>,
}

#[derive(Clone, Copy)]
enum Awaited {
    Record,
    RequestedModules,
    /// What an earlier request for the same module has started.
    OtherLoad,
}

impl PendingRequest {
    /// What it waits for has settled. `load` is what HostLoadImportedModule has returned.
    pub(super) fn go_on(
        &self,
        cx: &mut Cx,
        load: Gc<JsPromise>,
        status: PromiseStatus,
        value: Value,
    ) -> JsResult<()> {
        let (entry, request) = (self.entry, self.request.clone());
        if status == PromiseStatus::Rejected {
            if let Some(referrer) = self.referrer {
                referrer.forget_resolved_request(&request);
            }
            if !matches!(self.awaits.get(), Awaited::Record) {
                entry.set_evaluation_error(value);
            }
            load.reject(cx, value);
            return Ok(());
        }
        let loader = entry.loader();
        if let Awaited::Record = self.awaits.get() {
            self.set_module(Some(value.cast()));
            let requested = loader.load_requested_modules(cx, value.cast())?;
            self.awaits.set(Awaited::RequestedModules);
            react(
                cx,
                &requested,
                InternalMicrotask::ModuleLoadStep,
                load,
                self,
            );
            return Ok(());
        }
        let module = self.module().unwrap_or_else(|| value.cast());
        loader.finish_loading(cx, self.referrer, &request, self.payload, Ok(module))?;
        if let Awaited::OtherLoad = self.awaits.get() {
            load.fulfill(cx, value);
            return Ok(());
        }
        if (module.downcast::<CyclicModuleRecord>())
            .is_none_or(|it| it.status() == ModuleStatus::Unlinked)
        {
            entry.set_fetched(module);
        }
        load.fulfill(cx, entry.record().unwrap_or(module).into());
        Ok(())
    }
}

impl GraphLoad {
    pub(super) fn create(vm: &Vm, promise: Gc<JsPromise>) -> Gc<GraphLoad> {
        vm.allocate::<GraphLoad>(GraphLoadInit {
            base: Payload::init(vm.shape_for::<GraphLoad>(), promise),
            is_loading: Cell::new(true),
            pending_modules: Cell::new(1),
            visited_addresses: RefCell::default(),
            is_draining_queue: Cell::new(false),
        })
    }

    fn has_visited(&self, module: &AbstractModuleRecord) -> bool {
        self.visited_addresses.borrow().contains(&module.address())
    }

    /// The end of InnerModuleLoading.
    fn did_load(&self, vm: &Vm, module: &AbstractModuleRecord) {
        self.pending_modules.update(|count| count - 1);
        if self.pending_modules.get() != 0 {
            return;
        }
        self.is_loading.set(false);
        for visited in self.visited().iter() {
            if visited.status() == ModuleStatus::New {
                visited.set_status(ModuleStatus::Unlinked);
            }
        }
        self.promise().fulfill(vm, module.into());
    }

    /// InnerModuleLoading
    fn load(&self, cx: &mut Cx, module: Gc<AbstractModuleRecord>) -> JsResult<()> {
        self.queue().push(module);
        if self.is_draining_queue.replace(true) {
            return Ok(());
        }
        let result = self.drain_queue(cx);
        self.is_draining_queue.set(false);
        result
    }

    fn drain_queue(&self, cx: &mut Cx) -> JsResult<()> {
        while self.is_loading.get()
            && let Some(module) = self.queue().pop()
        {
            if !self.has_visited(&module)
                && let Some(cyclic) = module.downcast::<CyclicModuleRecord>()
                && cyclic.status() == ModuleStatus::New
            {
                self.visit(cx, cyclic)?;
            }
            if self.is_loading.get() {
                self.did_load(cx, &module);
            }
        }
        Ok(())
    }

    fn visit(&self, cx: &mut Cx, module: Gc<CyclicModuleRecord>) -> JsResult<()> {
        self.visited().push(module);
        self.visited_addresses.borrow_mut().insert(module.address());
        let entries = module.entries();
        (self.pending_modules).update(|count| count + entries.requests().len());
        let waiting = self.queue().len();
        for request in entries.requests() {
            match module.loaded_modules().get(&request.key()) {
                Some(loaded) if self.has_visited(&loaded) => {
                    self.pending_modules.update(|count| count - 1);
                }
                Some(loaded) => self.queue().push(loaded),
                None => {
                    let (payload, kind) = (Gc::from(self).upcast(), ModuleName::Specifier);
                    let loader = module.loader();
                    let load = loader.load_imported(cx, Some(module), request, payload, kind)?;
                    if !module.loaded_modules().contains_key(&request.key()) {
                        let task = InternalMicrotask::ModuleGraphLoadingError;
                        load.react(cx, InternalReaction::new(task, None, self.into()));
                    }
                }
            }
            if !self.is_loading.get() {
                break;
            }
        }
        self.queue().reverse_from(waiting);
        Ok(())
    }

    /// ContinueModuleLoading
    fn go_on(&self, cx: &mut Cx, completion: Completion) -> JsResult<()> {
        if !self.is_loading.get() {
            return Ok(());
        }
        match completion {
            Ok(module) if self.has_visited(&module) => self.did_load(cx, &module),
            Ok(module) => self.load(cx, module)?,
            Err(error) => {
                self.is_loading.set(false);
                self.promise().reject(cx, error);
            }
        }
        Ok(())
    }
}

impl ModuleLoader {
    /// LoadRequestedModules
    fn load_requested_modules(
        &self,
        cx: &mut Cx,
        module: Gc<AbstractModuleRecord>,
    ) -> JsResult<Gc<JsPromise>> {
        let promise = handled_promise(cx);
        GraphLoad::create(cx, promise).load(cx, module)?;
        Ok(promise)
    }

    pub(super) fn load_for_realm(
        &self,
        cx: &mut Cx,
        request: &ModuleRequest,
        payload: Gc<Payload>,
        goal: Goal,
    ) -> JsResult<Gc<JsPromise>> {
        let load = self.load_imported(cx, None, request, payload, ModuleName::Entry)?;
        let context = LoadContext::for_root(cx, self, request.clone(), goal);
        let result = handled_promise(cx);
        let task = InternalMicrotask::ModuleLoadLinkEvaluateSettled;
        react(cx, &load, task, result, context);
        let task = InternalMicrotask::ModuleLoadStoreError;
        result.react(cx, InternalReaction::new(task, None, context.into()));
        Ok(result)
    }

    /// FinishLoadingImportedModule
    fn finish_loading(
        &self,
        cx: &mut Cx,
        referrer: Referrer,
        request: &ModuleRequest,
        payload: Gc<Payload>,
        completion: Completion,
    ) -> JsResult<()> {
        if let Some(referrer) = referrer {
            referrer.forget_resolved_request(request);
        }
        if let Ok(module) = completion {
            let key = ModuleKeyRef::new(module.key().name(), request.module_type());
            let loaded = match &referrer {
                Some(referrer) => Some(referrer.loaded_modules()),
                // It may have been removed from the registry in the meantime.
                None => (self.find_entry(key))
                    .filter(|entry| entry.record() == Some(module))
                    .map(|_| self.loaded_modules()),
            };
            if let Some(loaded) = loaded
                && !loaded.contains_key(&request.key())
            {
                loaded.insert(request.key().to_key(), module);
            }
        }
        if let Some(graph) = payload.downcast::<GraphLoad>() {
            return graph.go_on(cx, completion);
        }
        // ContinueDynamicImport
        match completion {
            Ok(module) => {
                let load = self.load_requested_modules(cx, module)?;
                let task = InternalMicrotask::DynamicImportLoadSettled;
                let cell = Some(payload.promise().cell());
                let context = crate::InternalFieldTuple::create(cx, module.into(), payload.into());
                load.react(cx, InternalReaction::new(task, cell, context.into()));
            }
            Err(error) => payload.promise().reject(cx, error),
        }
        Ok(())
    }

    fn fail_to_load(
        &self,
        cx: &mut Cx,
        referrer: Referrer,
        request: &ModuleRequest,
        payload: Gc<Payload>,
        error: Value,
    ) -> JsResult<Gc<JsPromise>> {
        let promise = JsPromise::rejected(cx, error);
        self.finish_loading(cx, referrer, request, payload, Err(error))?;
        Ok(promise)
    }

    fn remember_resolution_failure(&self, key: ResolutionKey, error: Value) {
        const MAX_FAILURES: usize = 128;
        let failures = self.resolution_failures();
        if failures.len() >= MAX_FAILURES
            && let Some(any) = failures.keys().pop()
        {
            failures.remove(&any);
        }
        failures.insert(key, error);
    }

    /// The inner error is that of the host.
    fn resolve_request(
        &self,
        cx: &mut Cx,
        referrer: Referrer,
        request: &ModuleRequest,
        payload: &Payload,
        kind: ModuleName,
    ) -> JsResult<Result<Identifier, Value>> {
        let specifier = &request.specifier;
        if specifier.name().is_symbol() && self.find_entry(request.key()).is_some() {
            return Ok(Ok(specifier.clone()));
        }
        let failure_key = (referrer.map(|it| it.key().clone()), specifier.clone());
        if let Some(error) = self.resolution_failures().get(&failure_key) {
            return Ok(Err(error));
        }
        // Each module starts a graph load of its own, and all of them come to the modules that are still new.
        let memory = referrer.filter(|_| payload.is::<GraphLoad>());
        if let Some(referrer) = memory
            && let Some(key) = referrer.resolved_requests().borrow().get(&request.key())
        {
            return Ok(Ok(key.clone()));
        }
        match self.resolve(cx, specifier, failure_key.0.as_ref(), kind) {
            Ok(key) => {
                if let Some(referrer) = memory {
                    let mut requests = referrer.resolved_requests().borrow_mut();
                    requests.insert(request.key().to_key(), key.clone());
                }
                Ok(Ok(key))
            }
            Err(thrown) => {
                let error = cx.catch_value(thrown)?;
                failure::note(cx, error, request.key(), FailureKind::Instantiation);
                self.remember_resolution_failure(failure_key, error);
                Ok(Err(error))
            }
        }
    }

    /// Takes the steps that an asynchronous load has left for later.
    fn advance_synchronously(
        &self,
        cx: &mut Cx,
        entry: &ModuleRegistryEntry,
        referrer: Referrer,
        request: &ModuleRequest,
    ) -> JsResult<()> {
        let (fetch, module) = (
            entry.ensure_fetch_promise(cx),
            entry.ensure_module_promise(cx),
        );
        if !module.is_pending() {
            return Ok(());
        }
        let key = entry.key().clone();
        if fetch.is_pending() {
            let referrer = referrer_text(referrer.as_ref().map(|it| it.key()));
            let parameters = request.parameters.clone();
            return self.fetch_again(cx, &fetch, &key, referrer.as_ref(), parameters);
        }
        if fetch.status() == PromiseStatus::Rejected {
            return Ok(());
        }
        let made = self.make_module(cx, &key, fetch.result())?;
        match made.status() {
            PromiseStatus::Fulfilled if module.is_pending() => {
                entry.complete_fetch(made.result().cast());
                module.fulfill_promise(cx, made.result());
            }
            PromiseStatus::Fulfilled => entry.replace_record(cx, made.result().cast()),
            PromiseStatus::Rejected => module.reject_promise(cx, made.result()),
            PromiseStatus::Pending => {}
        }
        Ok(())
    }

    /// HostLoadImportedModule
    fn load_imported(
        &self,
        cx: &mut Cx,
        referrer: Referrer,
        request: &ModuleRequest,
        payload: Gc<Payload>,
        kind: ModuleName,
    ) -> JsResult<Gc<JsPromise>> {
        let is_reloading_root = referrer.is_none()
            && self.root_being_reloaded.get() == request.specifier.name().address()
            && payload.is::<GraphLoad>();
        if is_reloading_root {
            self.root_being_reloaded.set(0);
        } else if referrer.is_none()
            && let Some(loaded) = self.loaded_modules().get(&request.key())
            && let key = ModuleKeyRef::new(loaded.key().name(), request.module_type())
            && let Some(load) = self.find_entry(key).and_then(|it| it.loaded_promise(cx))
        {
            self.finish_loading(cx, referrer, request, payload, Ok(loaded))?;
            return Ok(load);
        }

        let key = match self.resolve_request(cx, referrer, request, &payload, kind)? {
            Ok(key) => key,
            Err(error) => return self.fail_to_load(cx, referrer, request, payload, error),
        };
        let entry = self.ensure_entry(cx, ModuleKeyRef::new(key.name(), request.module_type()));
        // Errors of later stages come up at those stages.
        if let Some(error) = entry.duplicate_fetch_error(cx)? {
            self.finish_loading(cx, referrer, request, payload, Err(error))?;
            return Ok(JsPromise::rejected(cx, error));
        }
        if cx.has_synchronous_module_queue() && entry.status() == RegistryStatus::Fetching {
            self.advance_synchronously(cx, &entry, referrer, request)?;
        }
        let wait_for = |cx: &Cx, promise: &JsPromise, awaits| {
            let pending = cx.allocate::<PendingRequest>(PendingRequestInit {
                base: cx.shape_for::<PendingRequest>(),
                referrer,
                request: request.clone(),
                payload,
                entry,
                awaits: Cell::new(awaits),
                module: None,
            });
            let load = handled_promise(cx);
            react(
                cx,
                promise,
                InternalMicrotask::ModuleLoadStep,
                load,
                pending,
            );
            load
        };
        if let Some(load) = entry.loaded_promise(cx).filter(|_| !is_reloading_root) {
            let Some(module) = entry.record() else {
                return Ok(wait_for(cx, &load, Awaited::OtherLoad));
            };
            self.finish_loading(cx, referrer, request, payload, Ok(module))?;
            return Ok(load);
        }
        if entry.status() == RegistryStatus::New {
            let referrer = referrer_text(referrer.as_ref().map(|it| it.key()));
            let fetch = self.fetch(cx, &key, referrer.as_ref(), request.parameters.clone())?;
            // There may be one by now: from the embedder, or from a load that it has started.
            if entry.record().is_none() {
                entry.set_status(RegistryStatus::Fetching);
                entry.ensure_fetch_promise(cx).pipe_from(cx, &fetch);
            } else {
                fetch.mark_as_handled();
            }
        }
        let load = wait_for(cx, &entry.ensure_module_promise(cx), Awaited::Record);
        entry.set_load_promise(cx, load);
        Ok(load)
    }
}
