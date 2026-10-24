mod captures;
mod classes;
mod evals;
mod forms;
mod holders;
mod loop_updates;
mod module_level;
mod namespaces;
mod stores_before_captures;
mod tables;

use bun_sema::bind::{Bound, CodeUnit, ScopeId, SymbolId};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{self, ClassId, FnId, FnKind, StmtId, StmtKind};

use crate::ir::{ClassSlot, FunctionKey};
use crate::lower::captures::Capture;
use crate::lower::scope::testing::{
    file_scope, first_statement, function_named, functions_of_kind, only_function, symbol_named,
    top_scope, with_scope_analysis,
};
use crate::lower::scope::{
    ArgumentsObject, BindingForm, BindingRef, Placement, ScopeAnalysis, ScopeSlot, Storage,
};

struct Probe<'a, 'h, 'b> {
    hir: &'a hir::File<'h>,
    bound: &'a Bound<'b>,
    analysis: &'a ScopeAnalysis,
}

fn analyze_files<R>(files: &[(&str, &str)], test: impl FnOnce(&Probe<'_, '_, '_>) -> R) -> R {
    with_scope_analysis(files, |hir, bound, analysis| {
        test(&Probe {
            hir,
            bound,
            analysis,
        })
    })
}

fn analyze_source<R>(file: &str, source: &str, test: impl FnOnce(&Probe<'_, '_, '_>) -> R) -> R {
    analyze_files(&[(file, source)], test)
}

fn storage_in(file: &str, source: &str, name: &str) -> Storage {
    analyze_source(file, source, |probe| probe.placement_of(name).storage)
}

// What closures copy.
const COPIED: Placement = Placement {
    storage: Storage::Local,
    has_local: true,
    is_immutable: true,
    is_shared: true,
};

// What closures read from the first field of the environment of `scope`. Its owner keeps a copy of what is never stored again.
fn first_field(scope: ScopeId, is_immutable: bool) -> Placement {
    Placement {
        storage: Storage::Field { scope, field: 0 },
        has_local: is_immutable,
        is_immutable,
        is_shared: true,
    }
}

fn is_field(storage: Storage) -> bool {
    match storage {
        Storage::Field { .. } => true,
        Storage::Local | Storage::Variable(_) => false,
    }
}

impl std::ops::Deref for Probe<'_, '_, '_> {
    type Target = ScopeAnalysis;

    fn deref(&self) -> &ScopeAnalysis {
        self.analysis
    }
}

impl Probe<'_, '_, '_> {
    fn symbol(&self, name: &str) -> SymbolId {
        symbol_named(self.hir, self.bound, name)
    }

    fn binding(&self, name: &str) -> BindingRef {
        BindingRef::Symbol(self.symbol(name))
    }

    fn form_of(&self, name: &str) -> BindingForm {
        self.form(self.symbol(name))
    }

    fn placement(&self, binding: BindingRef) -> Placement {
        let placement = self.analysis.placement(binding);
        placement.expect("the binding is stored")
    }

    fn placement_of(&self, name: &str) -> Placement {
        self.placement(self.binding(name))
    }

    fn function(&self, name: &str) -> FnId {
        function_named(self.hir, name)
    }

    fn functions(&self, kind: FnKind) -> Vec<FnId> {
        functions_of_kind(self.hir, kind)
    }

    fn only_function(&self, kind: FnKind) -> FnId {
        only_function(self.hir, kind)
    }

    fn arrow(&self) -> FnId {
        self.only_function(FnKind::Arrow)
    }

    fn top_scope(&self, function: FnId) -> ScopeId {
        top_scope(self.bound, function)
    }

    fn top_of(&self, name: &str) -> ScopeId {
        self.top_scope(self.function(name))
    }

    fn file_scope(&self) -> ScopeId {
        file_scope(self.hir, self.bound)
    }

    fn slot(&self, function: FnId, slot: ScopeSlot) -> BindingRef {
        BindingRef::Slot(self.top_scope(function), slot)
    }

    fn file_slot(&self, slot: ScopeSlot) -> BindingRef {
        BindingRef::Slot(self.file_scope(), slot)
    }

    fn arguments_object(&self, function: FnId) -> ArgumentsObject {
        self.analysis.arguments_object(CodeUnit::Function(function))
    }

    fn first_statement(&self, is_wanted: fn(&StmtKind) -> bool) -> StmtId {
        first_statement(self.hir, is_wanted)
    }

    fn key(&self, function: FnId) -> FunctionKey {
        self.analysis.function_key(CodeUnit::Function(function))
    }

    fn captures(&self, function: FnId) -> &[Capture] {
        self.analysis.captures(self.key(function))
    }

    fn captures_of(&self, name: &str) -> &[Capture] {
        self.captures(self.function(name))
    }

    fn copy_of(&self, name: &str) -> Capture {
        Capture::Value(self.binding(name))
    }

    fn class(&self, class: u32) -> ClassRef {
        ClassRef {
            file: self.analysis.file,
            class: ClassId(class),
        }
    }

    fn class_scope(&self, class: u32) -> ScopeId {
        self.bound.class_scope[class as usize]
    }

    fn class_slot(&self, class: u32, slot: ClassSlot) -> BindingRef {
        BindingRef::Slot(self.class_scope(class), ScopeSlot::Class(slot))
    }
}
