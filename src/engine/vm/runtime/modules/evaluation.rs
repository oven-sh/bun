//! Evaluate of a Cyclic Module Record.

use bun_engine_bytecode::ImportPhase;

use super::cyclic::{AsyncEvaluationOrder, check_graph_depth, throw_link_error};
use super::failure::{self, FailureKind};
use crate::heap::RootSet;
use crate::{
    AbstractModuleRecord, Cx, CyclicModuleRecord, Gc, InternalMicrotask, InternalReaction,
    JsPromise, JsResult, ModuleStatus, PromiseStatus, RootVec, SourceTextModuleRecord, Value,
    anchor, root_vec,
};

type Modules = RootVec<Gc<CyclicModuleRecord>>;

/// The `import()` that an evaluation is for. A module that waits for it is not waited for in turn.
pub(super) struct Importer {
    /// Of the module that has called it, which may wait in ways that the promises do not show.
    pub(super) async_evaluation_order: Option<u64>,
    pub(super) promise: Gc<JsPromise>,
}

impl Importer {
    fn is_awaited_by(&self, module: Gc<CyclicModuleRecord>) -> bool {
        const MAX_PROMISES: usize = 4096;
        if self.async_evaluation_order == module.async_evaluation_order() {
            return true;
        }
        let (mut pending, mut seen) = (root_vec(), RootSet::default());
        pending.push(self.promise);
        while let Some(promise) = pending.pop() {
            if !promise.is_pending() || !seen.insert(promise) {
                continue;
            }
            if seen.len() > MAX_PROMISES {
                return false;
            }
            for reaction in promise.reactions() {
                match reaction.task {
                    InternalMicrotask::AsyncModuleExecutionDone => {
                        if holds_up(reaction.context.cast(), module) {
                            return true;
                        }
                    }
                    InternalMicrotask::PromiseRaceElement
                    | InternalMicrotask::PromiseAnyElement => {}
                    _ => pending.extend(reaction.dependent_promise()),
                }
            }
        }
        false
    }
}

/// Whether `other` is the module or one of those that wait for it.
fn holds_up(module: Gc<CyclicModuleRecord>, other: Gc<CyclicModuleRecord>) -> bool {
    let (mut pending, mut seen) = (root_vec(), RootSet::default());
    pending.push(module);
    while let Some(module) = pending.pop() {
        if module == other {
            return true;
        }
        if seen.insert(module) {
            pending.extend(module.async_parents().iter());
        }
    }
    false
}

impl AbstractModuleRecord {
    fn push_cyclic_imports(&self, pending: &mut Modules) {
        let entries = self.entries();
        let requests = entries.requests().iter().rev();
        pending.extend(requests.filter_map(|it| self.imported_module(it.key())?.downcast()));
    }

    /// GatherAsynchronousTransitiveDependencies
    pub(super) fn gather_async_dependencies(&self, mut add: impl FnMut(Gc<CyclicModuleRecord>)) {
        let (mut pending, mut seen): (Modules, _) = (root_vec(), RootSet::default());
        pending.extend(self.downcast());
        while let Some(module) = pending.pop() {
            if !seen.insert(module)
                || module.status() == ModuleStatus::Evaluating
                || module.is_cycle_evaluated()
            {
                continue;
            }
            if module.has_top_level_await().get() {
                add(module);
            } else {
                module.push_cyclic_imports(&mut pending);
            }
        }
    }

    /// ReadyForSyncExecution
    fn is_ready_for_sync_execution(&self) -> bool {
        let (mut pending, mut seen): (Modules, _) = (root_vec(), RootSet::default());
        pending.extend(self.downcast());
        while let Some(module) = pending.pop() {
            if !seen.insert(module) || module.is_cycle_evaluated() {
                continue;
            }
            if let ModuleStatus::Evaluating | ModuleStatus::EvaluatingAsync = module.status() {
                return false;
            }
            if module.has_top_level_await().get() {
                return false;
            }
            module.push_cyclic_imports(&mut pending);
        }
        true
    }

    /// EvaluateModuleSync
    pub(super) fn evaluate_synchronously(&self, cx: &mut Cx) -> JsResult<()> {
        if !self.is_ready_for_sync_execution() {
            return Err(cx.throw_type_error("Unable to synchronously evaluate deferred module"));
        }
        let promise = self.evaluate(cx)?;
        if promise.status() == PromiseStatus::Rejected {
            promise.mark_as_handled();
            return Err(cx.throw(promise.result()));
        }
        Ok(())
    }
}

impl CyclicModuleRecord {
    pub(super) fn evaluate_graph(
        &self,
        cx: &mut Cx,
        importer: Option<&Importer>,
    ) -> JsResult<Gc<JsPromise>> {
        let root = (self.cycle_root()).filter(|_| self.status() >= ModuleStatus::EvaluatingAsync);
        let module = root.unwrap_or_else(|| self.into());
        if let Some(promise) = module.top_level_promise() {
            return Ok(promise);
        }
        let promise = JsPromise::new(cx);
        module.set_top_level_promise(Some(promise));
        let mut stack = root_vec();
        match module.evaluate_inner(cx, &mut stack, 0, importer) {
            Ok(_) if module.status() == ModuleStatus::Evaluated => {
                promise.fulfill(cx, Value::UNDEFINED);
            }
            Ok(_) => {}
            Err(thrown) => {
                failure::note_on_pending(cx, self, FailureKind::Evaluation);
                let error = cx.exception().map_or_default(|it| it.value());
                for failed in stack {
                    failed.set_status(ModuleStatus::Evaluated);
                    failed.set_evaluation_error(error);
                }
                promise.reject_with_caught(cx, thrown)?;
            }
        }
        Ok(promise)
    }

    fn evaluation_list(&self) -> Modules {
        let (mut list, mut seen) = (root_vec(), RootSet::default());
        let mut add = |module| {
            if seen.insert(module) {
                list.push(module);
            }
        };
        for request in self.entries().requests() {
            let Some(required) = self.imported_module(request.key()) else {
                continue;
            };
            if request.phase == ImportPhase::Defer {
                required.gather_async_dependencies(&mut add);
            } else if let Some(required) = required.downcast() {
                add(required);
            }
        }
        list
    }

    /// InnerModuleEvaluation
    fn evaluate_inner(
        &self,
        cx: &mut Cx,
        stack: &mut Modules,
        index: u32,
        importer: Option<&Importer>,
    ) -> JsResult<u32> {
        if self.status() >= ModuleStatus::Evaluating {
            return match self.evaluation_error() {
                Some(error) => Err(cx.throw(error)),
                None => Ok(index),
            };
        }
        if self.status() != ModuleStatus::Linked {
            let words = ["Module '", "' is not linked."];
            return Err(throw_link_error(cx, &words, &[anchor!(self).key()]));
        }
        self.set_status(ModuleStatus::Evaluating);
        self.dfs_ancestor_index.set(index);
        self.pending_async_dependencies.set(0);
        stack.push(self.into());
        let mut next_index = index + 1;
        for mut required in self.evaluation_list() {
            check_graph_depth(cx)?;
            next_index = required.evaluate_inner(cx, stack, next_index, importer)?;
            // One that it waits for can end while another one is in a call of `require()`.
            if let Some(error) = self.evaluation_error() {
                return Err(cx.throw(error));
            }
            if required.status() != ModuleStatus::Evaluating {
                required = required.cycle_root().unwrap_or(required);
                if let Some(error) = required.evaluation_error() {
                    return Err(cx.throw(error));
                }
            } else if stack.contains(&required) {
                let ancestor = required.dfs_ancestor_index.get();
                self.dfs_ancestor_index.update(|own| own.min(ancestor));
            } else {
                // It has called `require()`, and the evaluation that is further up the native stack sees to it.
                continue;
            }
            if required.async_evaluation_order().is_some()
                && !importer.is_some_and(|it| it.is_awaited_by(required))
            {
                self.pending_async_dependencies.update(|count| count + 1);
                required.async_parents().push(self.into());
            }
        }
        if self.pending_async_dependencies() > 0 || self.has_top_level_await().get() {
            let count = &cx.services.modules.async_evaluation_count;
            let order = AsyncEvaluationOrder::At(count.replace(count.get() + 1));
            self.async_evaluation_order.set(order);
            if self.pending_async_dependencies() == 0 {
                self.execute_async(cx)?;
            }
        } else {
            self.execute(cx)?;
        }
        if self.dfs_ancestor_index.get() == index {
            while let Some(member) = stack.pop() {
                member.set_status(match member.async_evaluation_order.get() {
                    AsyncEvaluationOrder::At(_) => ModuleStatus::EvaluatingAsync,
                    _ => ModuleStatus::Evaluated,
                });
                member.set_cycle_root(Some(self.into()));
                if member.is_same(self) {
                    break;
                }
            }
        }
        Ok(next_index)
    }

    /// ExecuteModule, without a capability.
    fn execute(&self, cx: &mut Cx) -> JsResult<()> {
        match self.foreign_ops() {
            Some(ops) => (ops.execute)(cx, self.into()),
            None => (Gc::from(self).cast::<SourceTextModuleRecord>().execute(cx)).map(|_| ()),
        }
    }

    /// ExecuteAsyncModule. Fails only if execution is terminated.
    fn execute_async(&self, cx: &mut Cx) -> JsResult<()> {
        let module = Gc::from(self).cast::<SourceTextModuleRecord>();
        let promise = match module.execute(cx) {
            Ok(result) => match module.async_promise() {
                Some(promise) => promise,
                None => JsPromise::new_resolved(cx, result)?,
            },
            Err(thrown) => {
                let promise = JsPromise::new(cx);
                promise.reject_as_handled(cx, cx.catch_value(thrown)?);
                promise
            }
        };
        let task = InternalMicrotask::AsyncModuleExecutionDone;
        promise.react(cx, InternalReaction::new(task, None, self.into()));
        Ok(())
    }

    /// GatherAvailableAncestors
    fn gather_available_ancestors(&self) -> Modules {
        let (mut available, mut pending): (Modules, Modules) = (root_vec(), root_vec());
        pending.push(self.into());
        while let Some(module) = pending.pop() {
            for parent in module.async_parents().iter() {
                let root = parent.cycle_root().unwrap_or(parent);
                if parent.pending_async_dependencies() == 0 || root.evaluation_error().is_some() {
                    continue;
                }
                parent.pending_async_dependencies.update(|count| count - 1);
                if parent.pending_async_dependencies() == 0
                    && parent.async_evaluation_order().is_some()
                {
                    available.push(parent);
                    if !parent.has_top_level_await().get() {
                        pending.push(parent);
                    }
                }
            }
        }
        available
    }

    fn did_evaluate_async(&self, cx: &Cx) {
        self.async_evaluation_order.set(AsyncEvaluationOrder::Done);
        self.set_status(ModuleStatus::Evaluated);
        if let Some(promise) = self.top_level_promise() {
            promise.fulfill(cx, Value::UNDEFINED);
        }
    }

    /// AsyncModuleExecutionFulfilled
    pub(super) fn async_execution_fulfilled(&self, cx: &mut Cx) -> JsResult<()> {
        if let Some(module) = self.downcast::<SourceTextModuleRecord>() {
            module.did_finish_with_code();
        }
        if self.status() == ModuleStatus::Evaluated {
            return Ok(());
        }
        self.did_evaluate_async(cx);
        let mut available = self.gather_available_ancestors();
        available.sort_unstable_by_key(|module| module.async_evaluation_order());
        for module in available {
            if module.status() == ModuleStatus::Evaluated {
                continue;
            }
            if module.has_top_level_await().get() {
                module.execute_async(cx)?;
            } else if let Err(thrown) = module.execute(cx) {
                module.async_execution_rejected(cx, cx.catch_value(thrown)?);
            } else {
                module.did_evaluate_async(cx);
            }
        }
        Ok(())
    }

    /// AsyncModuleExecutionRejected
    pub(super) fn async_execution_rejected(&self, cx: &Cx, error: Value) {
        if let Some(module) = self.downcast::<SourceTextModuleRecord>() {
            module.did_finish_with_code();
        }
        let mut pending: Modules = root_vec();
        pending.push(self.into());
        while let Some(module) = pending.pop() {
            if module.status() == ModuleStatus::Evaluated {
                continue;
            }
            module.set_evaluation_error(error);
            module.set_status(ModuleStatus::Evaluated);
            (module.async_evaluation_order).set(AsyncEvaluationOrder::Done);
            if let Some(promise) = module.top_level_promise() {
                promise.reject(cx, error);
            }
            pending.extend(module.async_parents().to_root_vec().into_iter().rev());
        }
    }
}
