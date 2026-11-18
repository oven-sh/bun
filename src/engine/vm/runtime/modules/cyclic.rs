//! The Cyclic Module Record of ECMA-262, and how it is linked.

use core::cell::Cell;

use bun_engine_macros::cell;
use bun_engine_text::{Identifier, StringBuilder, Text};

use super::failure::{self, FailureKind};
use crate::heap::stack::stack_pointer;
use crate::{
    AbstractModuleRecord, Cx, ExportSource, Field, Gc, JsPromise, JsResult, ModuleKeyRef,
    ModuleLoader, ModuleType, Resolution, RootVec, Shape, SourceTextModuleRecord, Thrown,
    TracedVec, Value, Vm, anchor, root_vec,
};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub enum ModuleStatus {
    New,
    Unlinked,
    Linking,
    Linked,
    Evaluating,
    EvaluatingAsync,
    Evaluated,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AsyncEvaluationOrder {
    Unset,
    At(u64),
    Done,
}

/// What a kind of module that is not written in JavaScript does. It has its environment from the start.
pub struct ForeignModuleOps {
    /// ExecuteModule
    pub execute: fn(&mut Cx, Gc<CyclicModuleRecord>) -> JsResult<()>,
    /// What a namespace object shows of the value of an export, if that is something else.
    pub read_export: fn(&mut Cx, Value) -> JsResult<Option<Value>>,
}

#[cell(
    name = "CyclicModuleRecord",
    export = "engine_class_CyclicModuleRecord"
)]
pub struct CyclicModuleRecord {
    base: AbstractModuleRecord,
    foreign_ops: Option<&'static ForeignModuleOps>,
    status: Cell<ModuleStatus>,
    is_initialized: Cell<bool>,
    has_top_level_await: Cell<bool>,
    pub(super) dfs_ancestor_index: Cell<u32>,
    pub(super) pending_async_dependencies: Cell<u32>,
    pub(super) async_evaluation_order: Cell<AsyncEvaluationOrder>,
    pub(super) error: Field<Option<Value>>,
    pub(super) cycle_root: Field<Option<Gc<CyclicModuleRecord>>>,
    pub(super) top_level_promise: Field<Option<Gc<JsPromise>>>,
    pub(super) async_parents: TracedVec<Gc<CyclicModuleRecord>>,
}

pub(super) fn check_graph_depth(cx: &Cx) -> JsResult<()> {
    if stack_pointer() < cx.soft_stack_limit() {
        let was_handling_error = cx.replace_is_handling_error(true);
        let thrown = cx.throw_range_error("Maximum call stack size exceeded");
        cx.replace_is_handling_error(was_handling_error);
        return Err(thrown);
    }
    Ok(())
}

/// Every other part is a name, starting with the second.
#[cold]
pub(super) fn throw_link_error(cx: &Cx, words: &[&str], names: &[&Identifier]) -> Thrown {
    let mut message = StringBuilder::new();
    for (index, words) in words.iter().enumerate() {
        message.push_ascii(words);
        message.push_text(names.get(index).map_or(Text::EMPTY, |it| it.name().text()));
    }
    cx.throw_syntax_error(message)
}

impl CyclicModuleRecord {
    /// For a type that extends this one.
    pub fn init(
        vm: &Vm,
        shape: Gc<Shape>,
        loader: Gc<ModuleLoader>,
        key: Identifier,
        module_type: ModuleType,
        foreign_ops: Option<&'static ForeignModuleOps>,
    ) -> CyclicModuleRecordInit {
        CyclicModuleRecordInit {
            base: AbstractModuleRecord::init(vm, shape, loader, key, module_type),
            foreign_ops,
            status: Cell::new(ModuleStatus::New),
            is_initialized: Cell::new(false),
            has_top_level_await: Cell::new(false),
            dfs_ancestor_index: Cell::new(0),
            pending_async_dependencies: Cell::new(0),
            async_evaluation_order: Cell::new(AsyncEvaluationOrder::Unset),
            error: None,
            cycle_root: None,
            top_level_promise: None,
        }
    }

    pub(super) fn foreign_ops(&self) -> Option<&'static ForeignModuleOps> {
        self.foreign_ops
    }

    pub fn status(&self) -> ModuleStatus {
        self.status.get()
    }

    pub fn set_status(&self, status: ModuleStatus) {
        self.status.set(status);
    }

    pub fn has_top_level_await(&self) -> &Cell<bool> {
        &self.has_top_level_await
    }

    pub fn evaluation_error(&self) -> Option<Value> {
        self.error()
    }

    pub(super) fn set_evaluation_error(&self, error: Value) {
        self.set_error(Some(error));
        if let Some(module) = self.downcast::<SourceTextModuleRecord>() {
            module.did_finish_with_code();
        }
    }

    pub fn pending_async_dependencies(&self) -> u32 {
        self.pending_async_dependencies.get()
    }

    pub fn async_evaluation_order(&self) -> Option<u64> {
        match self.async_evaluation_order.get() {
            AsyncEvaluationOrder::At(order) => Some(order),
            _ => None,
        }
    }

    /// IsModuleSCCEvaluated
    pub fn is_cycle_evaluated(&self) -> bool {
        let root = self.cycle_root().unwrap_or_else(|| self.into());
        root.status() == ModuleStatus::Evaluated
    }

    /// Link
    pub fn link(&self, cx: &mut Cx) -> JsResult<()> {
        let mut stack = root_vec();
        (cx.services.modules.links_in_progress).update(|count| count + 1);
        let result = self.link_inner(cx, &mut stack, 0);
        (cx.services.modules.links_in_progress).update(|count| count - 1);
        if result.is_err() {
            for module in stack {
                module.set_status(ModuleStatus::Unlinked);
            }
            failure::note_on_pending(cx, self, FailureKind::Instantiation);
        }
        result.map(|_| ())
    }

    pub(super) fn require_imported_module(
        &self,
        cx: &Cx,
        request: ModuleKeyRef<'_>,
    ) -> JsResult<Gc<AbstractModuleRecord>> {
        self.imported_module(request).ok_or_else(|| {
            let words = ["Importing module '", "' is not found."];
            throw_link_error(cx, &words, &[&request.name.to_identifier()])
        })
    }

    /// InnerModuleLinking. `require()` can come across modules that are being evaluated.
    fn link_inner(
        &self,
        cx: &mut Cx,
        stack: &mut RootVec<Gc<CyclicModuleRecord>>,
        index: u32,
    ) -> JsResult<u32> {
        if self.status() == ModuleStatus::Linking
            && cx.services.modules.links_in_progress.get() > 1
            && !stack.contains(&self.into())
        {
            let words = ["Module '", "' is needed while it is being linked."];
            return Err(throw_link_error(cx, &words, &[anchor!(self).key()]));
        }
        if self.status() >= ModuleStatus::Linking {
            return Ok(index);
        }
        self.set_status(ModuleStatus::Linking);
        self.dfs_ancestor_index.set(index);
        stack.push(self.into());
        let mut next_index = index + 1;
        for request in self.entries().requests() {
            let required = self.require_imported_module(cx, request.key())?;
            let Some(required) = required.downcast::<CyclicModuleRecord>() else {
                continue;
            };
            check_graph_depth(cx)?;
            next_index = required.link_inner(cx, stack, next_index)?;
            if required.status() == ModuleStatus::Linking {
                let ancestor = required.dfs_ancestor_index.get();
                self.dfs_ancestor_index.update(|own| own.min(ancestor));
            }
        }
        self.initialize_environment(cx)?;
        if self.dfs_ancestor_index.get() == index {
            while let Some(linked) = stack.pop() {
                linked.set_status(ModuleStatus::Linked);
                if linked.is_same(self) {
                    break;
                }
            }
        }
        Ok(next_index)
    }

    /// InitializeEnvironment
    fn initialize_environment(&self, cx: &mut Cx) -> JsResult<()> {
        if self.is_initialized.get() {
            return Ok(());
        }
        for export in self.entries().exports() {
            let ExportSource::Indirect { module, .. } = &export.source else {
                continue;
            };
            let words: &[&str] = match self.resolve_export(cx, &export.exported) {
                Resolution::Resolved(_) => continue,
                Resolution::NotFound if self.is_typescript().get() => continue,
                Resolution::NotFound => &["export '", "' not found in '", "'"],
                Resolution::Ambiguous => &["Cannot export '", "' multiple times in '", "'"],
                Resolution::NoDefault => {
                    let message = "export default cannot be used with export *";
                    return Err(cx.throw_syntax_error(message));
                }
            };
            return Err(throw_link_error(
                cx,
                words,
                &[&export.exported, &module.name],
            ));
        }
        if let Some(module) = self.downcast::<SourceTextModuleRecord>() {
            module.bind_imports(cx)?;
        }
        self.is_initialized.set(true);
        Ok(())
    }
}
