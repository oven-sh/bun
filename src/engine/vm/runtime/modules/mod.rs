//! Module records, namespaces and the loader.

mod cyclic;
mod entries;
mod environment;
mod evaluation;
mod failure;
mod hooks;
mod jobs;
mod loader;
mod loading;
mod namespace;
mod record;
mod registry;
mod request;
mod resolve;
mod source_code;
mod source_text;
mod synthetic;

use core::cell::Cell;

pub use cyclic::{CyclicModuleRecord, CyclicModuleRecordInit, ForeignModuleOps, ModuleStatus};
pub use entries::{ExportEntry, ExportSource, ImportEntry, ImportKind, ModuleEntries};
pub use hooks::{ModuleHooks, ModuleName};
pub(crate) use jobs::run_microtask;
pub use loader::{
    LoadGoal, ModuleLoader, dynamic_import, evaluate_module_source, load_and_evaluate_module,
};
pub use namespace::ModuleNamespace;
pub use record::AbstractModuleRecord;
pub use registry::{ModuleRegistryEntry, RegistryStatus};
pub use request::{FetchParameters, ModuleKey, ModuleKeyRef, ModuleRequest, ModuleType};
pub use resolve::{Resolution, ResolvedBinding};
pub use source_code::JsSourceCode;
pub use source_text::{AnalysisError, SourceTextModuleRecord};
pub use synthetic::{SyntheticExports, SyntheticModuleRecord};

use crate::heap::{Survivors, WeakValueMap};
use crate::{
    Cx, Gc, InternalMicrotask, InternalReaction, JsPromise, ModuleExecutable, RealmSlot, Shape,
    ShapeSpec, Value, Vm,
};

/// False if the slot belongs to another part.
pub fn initialize_module_slot(cx: &Cx, slot: RealmSlot) -> bool {
    let global = cx.global();
    let shape = |spec| Shape::create(cx, Some(global), Value::NULL, spec);
    match slot {
        RealmSlot::module_loader => {
            global.init_module_loader(ModuleLoader::create(cx, global.cell()));
        }
        RealmSlot::module_record_shape => {
            global.init_module_record_shape(shape(ShapeSpec::of::<SourceTextModuleRecord>()));
        }
        RealmSlot::synthetic_module_record_shape => {
            let spec = ShapeSpec::of::<SyntheticModuleRecord>();
            global.init_synthetic_module_record_shape(shape(spec));
        }
        RealmSlot::module_namespace_shape => {
            global.init_module_namespace_shape((global.hooks().modules.create_namespace_shape)(cx));
        }
        _ => return false,
    }
    true
}

/// For a promise whose rejection is nothing to report.
fn handled_promise(cx: &Cx) -> Gc<JsPromise> {
    let promise = JsPromise::new(cx);
    promise.mark_as_handled();
    promise
}

fn react(
    vm: &Vm,
    promise: &JsPromise,
    task: InternalMicrotask,
    next: Gc<JsPromise>,
    context: impl Into<Value>,
) {
    let reaction = InternalReaction::new(task, Some(next.cell()), context.into());
    promise.react(vm, reaction);
}

#[derive(Default)]
pub(crate) struct State {
    async_evaluation_count: Cell<u64>,
    /// Reading a lazy export can start one inside another.
    links_in_progress: Cell<u32>,
    executables: WeakValueMap<source_text::ExecutableKey, ModuleExecutable>,
}

impl crate::services::Service for State {
    fn reconcile_weak_references(&self, _: &Vm, survivors: &Survivors) {
        self.executables.prune(survivors);
    }
}
