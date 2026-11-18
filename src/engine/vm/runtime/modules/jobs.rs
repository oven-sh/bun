//! The steps that follow when a promise of the loader has settled.

use bun_engine_bytecode::ImportPhase;

use super::evaluation::Importer;
use super::failure::{self, FailureKind};
use super::loading::{DynamicImport, Goal, GraphLoad, LoadContext, Payload, PendingRequest};
use super::{handled_promise, react};
use crate::{
    AbstractModuleRecord, Cx, CyclicModuleRecord, ErrorInstance, Gc, InternalFieldTuple,
    InternalMicrotask, JsPromise, JsResult, ModuleRegistryEntry, PromiseStatus, Value, root_vec,
};

/// One of those from `ImportModuleNamespace` on. The cell is the promise that is next in line, if there is one.
pub(crate) fn run_microtask(
    cx: &mut Cx,
    task: InternalMicrotask,
    status: PromiseStatus,
    cell: Value,
    value: Value,
    context: Value,
) -> JsResult<()> {
    let Some(next) = cell.downcast::<JsPromise>() else {
        return run_last(cx, task, status, value, context);
    };
    let result = match (task, status) {
        (InternalMicrotask::ModuleLoadStep, _) => {
            (context.cast::<PendingRequest>()).go_on(cx, next, status, value)
        }
        (_, PromiseStatus::Rejected) => {
            note_rejection(cx, task, next, value, context).map(|()| next.reject(cx, value))
        }
        _ => go_on(cx, task, next, value, context),
    };
    result.or_else(|thrown| next.reject_with_caught(cx, thrown))
}

fn run_last(
    cx: &mut Cx,
    task: InternalMicrotask,
    status: PromiseStatus,
    value: Value,
    context: Value,
) -> JsResult<()> {
    use InternalMicrotask::*;
    match (task, status) {
        (AsyncModuleExecutionDone, _) => {
            let module = context.cast::<CyclicModuleRecord>();
            let cx = cx.in_realm_of(&module);
            if status == PromiseStatus::Fulfilled {
                return module.async_execution_fulfilled(cx);
            }
            module.async_execution_rejected(cx, value);
        }
        (ModuleGraphLoadingError, PromiseStatus::Rejected) => {
            context.cast::<GraphLoad>().promise().reject(cx, value);
        }
        (ModuleLoadStoreError, PromiseStatus::Rejected) => {
            let context = context.cast::<LoadContext>();
            let request = context.request();
            if let Some(entry) = context.loader().find_entry(request.key()) {
                match value.downcast::<ErrorInstance>() {
                    Some(error) if !failure::is_evaluation_error(cx, &error, request.key())? => {
                        entry.set_instantiation_error(value);
                    }
                    _ => entry.set_evaluation_error(value),
                }
            }
        }
        _ => {}
    }
    Ok(())
}

/// Before the error is passed on.
fn note_rejection(
    cx: &mut Cx,
    task: InternalMicrotask,
    next: Gc<JsPromise>,
    error: Value,
    context: Value,
) -> JsResult<()> {
    use InternalMicrotask::*;
    match task {
        ModuleRegistryFetchSettled if next.is_pending() => {
            let entry = context.cast::<ModuleRegistryEntry>();
            let key = entry.anchor().typed_key();
            failure::note(cx, error, key, FailureKind::Instantiation);
            entry.set_fetch_error(cx, error);
        }
        ModuleRegistryModuleSettled if next.is_pending() => {
            (context.cast::<ModuleRegistryEntry>()).set_evaluation_error(error);
        }
        // What could not be fetched is not registered.
        ModuleLoadTopSettled => {
            let context = context.cast::<LoadContext>();
            let request = context.request();
            if let Some(instance) = error.downcast::<ErrorInstance>()
                && failure::is_evaluation_error(cx, &instance, request.key())?
            {
                let entry = context.loader().ensure_entry(cx, request.key());
                entry.set_evaluation_error(error);
            }
        }
        ModuleLoadTopRejected => {
            let context = context.cast::<LoadContext>();
            if let Some(entry) = context.loader().find_entry(context.request().key()) {
                entry.set_evaluation_error(error);
            }
        }
        ModuleLoadCombinedLoadSettled | ModuleLoadCombinedStateSettled => {
            context.cast::<Payload>().join();
        }
        _ => {}
    }
    Ok(())
}

fn go_on(
    cx: &mut Cx,
    task: InternalMicrotask,
    next: Gc<JsPromise>,
    value: Value,
    context: Value,
) -> JsResult<()> {
    use InternalMicrotask::*;
    match task {
        // A synchronous load may have been there first.
        ModuleRegistryFetchSettled | ModuleRegistryModuleSettled if !next.is_pending() => {}
        ModuleRegistryFetchSettled => {
            let entry = context.cast::<ModuleRegistryEntry>();
            let made = entry
                .loader()
                .make_module(cx, &entry.key().clone(), value)?;
            react(cx, &made, ModuleRegistryModuleSettled, next, context);
        }
        ModuleRegistryModuleSettled => {
            (context.cast::<ModuleRegistryEntry>()).complete_fetch(value.cast());
            next.fulfill(cx, value);
        }
        ModuleLoadTopSettled => load_fetched_root(cx, context.cast(), next, value)?,
        ModuleLoadTopRejected => next.fulfill(cx, value),
        ModuleLoadSpecifierTransform => {
            let request = context.cast::<LoadContext>().request();
            next.fulfill(cx, Value::from_name(cx, request.specifier.name()));
        }
        ModuleLoadCombinedLoadSettled => {
            let payload = context.cast::<Payload>();
            if payload.join() {
                next.fulfill(cx, payload.joined_value());
            }
        }
        ModuleLoadCombinedStateSettled => {
            let payload = context.cast::<Payload>();
            match payload.join() {
                true => next.fulfill(cx, value),
                false => payload.set_joined_value(value),
            }
        }
        ModuleLoadLinkEvaluateSettled => {
            let module = value.cast::<AbstractModuleRecord>();
            if let Goal::Evaluate = context.cast::<LoadContext>().goal() {
                module.link(cx)?;
                let evaluation = module.evaluate(cx)?;
                react(cx, &evaluation, ModuleLoadReturnRecord, next, value);
            } else {
                next.fulfill(cx, Value::from_name(cx, module.anchor().key().name()));
            }
        }
        ModuleLoadReturnRecord => next.fulfill(cx, context),
        DynamicImportLoadSettled => link_and_evaluate_import(cx, context.cast())?,
        DynamicImportEvaluateSettled => {
            let module = context.cast::<AbstractModuleRecord>();
            let namespace = module.namespace(cx, ImportPhase::Evaluation)?;
            next.fulfill(cx, namespace.into());
        }
        DynamicImportDeferDependencySettled => {
            let (module, import) = module_and_import(context.cast());
            import.pending_dependencies().update(|count| count - 1);
            if import.pending_dependencies().get() == 0 {
                let namespace = module.namespace(cx, ImportPhase::Defer)?;
                next.fulfill(cx, namespace.into());
            }
        }
        // The promise that scripts see, and the only step that looks for a `then` among the exports.
        ImportModuleNamespace => next.resolve(cx, value)?,
        _ => unreachable!(),
    }
    Ok(())
}

fn load_fetched_root(
    cx: &mut Cx,
    context: Gc<LoadContext>,
    next: Gc<JsPromise>,
    data: Value,
) -> JsResult<()> {
    use InternalMicrotask::*;
    let (loader, request) = (context.loader(), context.request());
    if !data.is::<AbstractModuleRecord>() {
        loader.provide_fetch(cx, request.key(), data);
    }
    let mut state = handled_promise(cx);
    let (payload, goal): (Gc<Payload>, _) = match context.goal() {
        Goal::Import(phase, order) => {
            let import = DynamicImport::create(cx, state, phase, order);
            (import.upcast(), Goal::Load)
        }
        goal => (GraphLoad::create(cx, state).upcast(), goal),
    };
    let load = loader.load_for_realm(cx, &request, payload, goal)?;
    if payload.is::<GraphLoad>() {
        let key = handled_promise(cx);
        react(cx, &state, ModuleLoadSpecifierTransform, key, context);
        state = key;
    }
    let both = handled_promise(cx);
    react(cx, &load, ModuleLoadCombinedLoadSettled, both, payload);
    react(cx, &state, ModuleLoadCombinedStateSettled, both, payload);
    next.pipe_from(cx, &both);
    Ok(())
}

fn module_and_import(
    both: Gc<InternalFieldTuple>,
) -> (Gc<AbstractModuleRecord>, Gc<DynamicImport>) {
    (both.fields().at(0).cast(), both.fields().at(1).cast())
}

/// The closure of ContinueDynamicImport that does so.
fn link_and_evaluate_import(cx: &mut Cx, context: Gc<InternalFieldTuple>) -> JsResult<()> {
    use InternalMicrotask::*;
    let (module, import) = module_and_import(context);
    let promise = import.promise();
    module.link(cx)?;
    let importer = Importer {
        async_evaluation_order: import.referrer_order(),
        promise,
    };
    if import.phase() == ImportPhase::Evaluation {
        let evaluation = module.evaluate_for(cx, Some(&importer))?;
        react(
            cx,
            &evaluation,
            DynamicImportEvaluateSettled,
            promise,
            module,
        );
        return Ok(());
    }
    let mut dependencies = root_vec();
    module.gather_async_dependencies(|it| dependencies.push(it));
    if dependencies.is_empty() {
        let namespace = module.namespace(cx, ImportPhase::Defer)?;
        promise.fulfill(cx, namespace.into());
        return Ok(());
    }
    let mut evaluations = root_vec();
    for dependency in dependencies {
        evaluations.push(dependency.evaluate_for(cx, Some(&importer))?);
    }
    import.pending_dependencies().set(evaluations.len());
    for evaluation in evaluations {
        let task = DynamicImportDeferDependencySettled;
        react(cx, &evaluation, task, promise, context);
    }
    Ok(())
}
