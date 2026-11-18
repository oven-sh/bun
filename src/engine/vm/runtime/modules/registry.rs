//! What a loader knows of a module.

use core::cell::Cell;

use bun_engine_macros::cell;
use bun_engine_text::Identifier;

use super::{failure, handled_promise, react};
use crate::{
    AbstractModuleRecord, Cx, CyclicModuleRecord, Field, Gc, InternalMicrotask, JsCell, JsPromise,
    JsResult, ModuleKey, ModuleKeyRef, ModuleLoader, ModuleType, PromiseStatus, TypeFlags, Value,
    Vm,
};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub enum RegistryStatus {
    New,
    Fetching,
    Fetched,
    FetchFailed,
    InstantiationFailed,
    EvaluationFailed,
}

#[cell(cell_type = ModuleRegistryEntry, flags = TypeFlags::SHAPE_IS_IMMORTAL,
    export = "engine_class_ModuleRegistryEntry")]
pub struct ModuleRegistryEntry {
    base: JsCell,
    key: ModuleKey,
    loader: Gc<ModuleLoader>,
    status: Cell<RegistryStatus>,
    is_loaded: Cell<bool>,
    was_load_started_synchronously: Cell<bool>,
    pub(self) module: Field<Option<Gc<AbstractModuleRecord>>>,
    /// For what the record is made from.
    pub(self) fetch_promise: Field<Option<Gc<JsPromise>>>,
    /// For the record.
    pub(self) module_promise: Field<Option<Gc<JsPromise>>>,
    /// For the record, once all that it requests is loaded too.
    pub(self) promise_of_load: Field<Option<Gc<JsPromise>>>,
    /// The status says of which kind.
    pub(self) failure: Field<Option<Value>>,
}

impl ModuleRegistryEntry {
    pub(super) fn create(
        vm: &Vm,
        loader: &ModuleLoader,
        key: ModuleKeyRef<'_>,
    ) -> Gc<ModuleRegistryEntry> {
        vm.allocate::<ModuleRegistryEntry>(ModuleRegistryEntryInit {
            base: vm.shape_for::<ModuleRegistryEntry>(),
            key: key.to_key(),
            loader: loader.into(),
            status: Cell::new(RegistryStatus::New),
            is_loaded: Cell::new(false),
            was_load_started_synchronously: Cell::new(false),
            module: None,
            fetch_promise: None,
            module_promise: None,
            promise_of_load: None,
            failure: None,
        })
    }

    pub fn key(&self) -> &Identifier {
        &self.key.name
    }

    pub fn module_type(&self) -> ModuleType {
        self.key.module_type
    }

    pub(super) fn typed_key(&self) -> ModuleKeyRef<'_> {
        self.key.borrow()
    }

    pub fn loader(&self) -> Gc<ModuleLoader> {
        self.loader
    }

    pub fn record(&self) -> Option<Gc<AbstractModuleRecord>> {
        self.module()
    }

    pub fn status(&self) -> RegistryStatus {
        self.status.get()
    }

    pub fn set_status(&self, status: RegistryStatus) {
        self.status.set(status);
    }

    pub fn ensure_fetch_promise(&self, cx: &Cx) -> Gc<JsPromise> {
        self.fetch_promise().unwrap_or_else(|| {
            let promise = handled_promise(cx);
            if let Some(error) = self.fetch_error() {
                promise.reject(cx, error);
            } else if let Some(module) = self.module() {
                promise.fulfill(cx, module.into());
            }
            self.set_fetch_promise(Some(promise));
            promise
        })
    }

    pub fn ensure_module_promise(&self, cx: &Cx) -> Gc<JsPromise> {
        self.module_promise().unwrap_or_else(|| {
            let promise = handled_promise(cx);
            self.set_module_promise(Some(promise));
            if let Some(module) = self.module() {
                promise.fulfill(cx, module.into());
            } else {
                let task = InternalMicrotask::ModuleRegistryFetchSettled;
                react(cx, &self.ensure_fetch_promise(cx), task, promise, self);
            }
            promise
        })
    }

    pub fn load_promise(&self) -> Option<Gc<JsPromise>> {
        self.promise_of_load()
    }

    pub(super) fn set_load_promise(&self, vm: &Vm, promise: Gc<JsPromise>) {
        self.set_promise_of_load(Some(promise));
        (self.was_load_started_synchronously).set(vm.has_synchronous_module_queue());
    }

    pub(super) fn was_load_started_synchronously(&self) -> bool {
        self.was_load_started_synchronously.get()
    }

    /// An entry that is marked as loaded gets one now.
    pub(super) fn loaded_promise(&self, cx: &Cx) -> Option<Gc<JsPromise>> {
        if self.load_promise().is_none() && self.is_loaded.get() {
            let promise = handled_promise(cx);
            promise.fulfill(cx, self.module()?.into());
            self.set_promise_of_load(Some(promise));
        }
        self.load_promise()
    }

    pub(super) fn fetch_error(&self) -> Option<Value> {
        (self.failure()).filter(|_| self.status() == RegistryStatus::FetchFailed)
    }

    /// Of a later stage.
    pub(super) fn error(&self) -> Option<Value> {
        let of_record = || (self.module()?.downcast::<CyclicModuleRecord>()?).evaluation_error();
        self.failure().or_else(of_record)
    }

    pub(super) fn duplicate_fetch_error(&self, cx: &mut Cx) -> JsResult<Option<Value>> {
        (self.fetch_error().map(|it| failure::duplicate(cx, it))).transpose()
    }

    pub fn set_fetch_error(&self, vm: &Vm, error: Value) {
        self.set_failure(Some(error));
        if self.status() == RegistryStatus::New
            && let Some(promise) = self.fetch_promise()
        {
            promise.reject(vm, error);
        }
        self.set_status(RegistryStatus::FetchFailed);
    }

    fn fail(&self, status: RegistryStatus, error: Value) {
        // Inside a link, what has failed may only have come too early.
        let links = &self.heap().vm().services.modules.links_in_progress;
        if self.status() != RegistryStatus::FetchFailed && links.get() == 0 {
            self.set_failure(Some(error));
            self.set_status(status);
        }
    }

    pub(super) fn set_instantiation_error(&self, error: Value) {
        self.fail(RegistryStatus::InstantiationFailed, error);
    }

    pub(super) fn set_evaluation_error(&self, error: Value) {
        self.fail(RegistryStatus::EvaluationFailed, error);
    }

    pub(super) fn provide_fetch(&self, cx: &Cx, data: Value) {
        self.ensure_module_promise(cx);
        self.set_status(RegistryStatus::Fetching);
        self.ensure_fetch_promise(cx).fulfill(cx, data);
    }

    pub(super) fn set_fetched(&self, module: Gc<AbstractModuleRecord>) {
        self.set_module(Some(module));
        self.set_status(RegistryStatus::Fetched);
    }

    pub(super) fn complete_fetch(&self, module: Gc<AbstractModuleRecord>) {
        if self.status() != RegistryStatus::FetchFailed {
            self.set_fetched(module);
        }
    }

    /// The code that generates a synthetic module has loaded that module while it ran, and got a record of what there
    /// was at the time. Later importers get all of it.
    pub(super) fn replace_record(&self, cx: &Cx, module: Gc<AbstractModuleRecord>) {
        if self.status() != RegistryStatus::FetchFailed {
            self.set_fetched(module);
            let promise = handled_promise(cx);
            promise.fulfill(cx, module.into());
            self.set_module_promise(Some(promise));
        }
    }

    /// For an embedder that has made the record itself. There is none yet.
    pub fn provide_module(&self, vm: &Vm, module: Gc<AbstractModuleRecord>) {
        self.set_fetched(module);
        if let Some(promise) = self.fetch_promise() {
            promise.fulfill_promise(vm, module.into());
        }
        if let Some(promise) = self.module_promise() {
            promise.fulfill(vm, module.into());
        }
    }

    /// The embedder has seen to all that the record requests, directly or not.
    pub fn mark_loaded(&self) {
        self.is_loaded.set(true);
    }

    pub fn is_loaded(&self) -> bool {
        self.is_loaded.get()
            || (self.load_promise()).is_some_and(|it| it.status() == PromiseStatus::Fulfilled)
    }
}
