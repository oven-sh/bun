use bun_sema::bind::{FnOwner, ScopeId, ScopeKind};
use bun_sema::hir::{FnId, FnKind};

use crate::ir::generated::{BlockFrequency, HomeObjectKind, ModuleKind, RuntimeErrorKind};
use crate::ir::{DeclaredType, TypeTable, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::scope::{BindingRef, ScopeSlot};

#[derive(Copy, Clone)]
enum LexicalOwner {
    Generated,
    File(ScopeId),
    Function(ScopeId, FnId),
    FieldInitializer(ScopeId),
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn find_lexical_owner(&self) -> LexicalOwner {
        let innermost = self.innermost_scope();
        if innermost.is_none() {
            return LexicalOwner::Generated;
        }
        let owner = self.file.scopes.lexical_owner(innermost);
        match self.file.bound.scopes[owner.idx()].kind {
            ScopeKind::File => LexicalOwner::File(owner),
            ScopeKind::Fn(function) => LexicalOwner::Function(owner, function),
            ScopeKind::FieldInitializer(_) => LexicalOwner::FieldInitializer(owner),
            _ => {
                debug_assert!(
                    false,
                    "a lexical owner is a file, function or field initializer"
                );
                LexicalOwner::Generated
            }
        }
    }

    pub(in crate::lower) fn get_entry_this(&mut self) -> ValueId {
        let bound_this = self.scopes.entry_this;
        match bound_this.or_else(|| self.builder.this_value()) {
            Some(this) => this,
            None => self.builder.undefined(),
        }
    }

    // `bun run` replaces the `this` of a file that has ES module syntax with `undefined`, in a CommonJS file with `import.meta` too.
    pub(crate) fn lower_this_expression(&mut self) -> ValueId {
        match self.find_lexical_owner() {
            LexicalOwner::File(_) if self.file.compiled.analysis.has_esm_syntax => {
                self.builder.undefined()
            }
            _ => self.get_this(),
        }
    }

    pub(crate) fn get_this(&mut self) -> ValueId {
        match self.find_lexical_owner() {
            LexicalOwner::Generated => self.get_entry_this(),
            LexicalOwner::File(scope) => match self.file.inputs.modules.kind(self.file.file) {
                ModuleKind::CommonJs => self.get_slot(scope, ScopeSlot::This),
                _ => self.builder.undefined(),
            },
            LexicalOwner::Function(scope, function) => {
                if self.file.is_derived_constructor(function) {
                    self.get_derived_constructor_this(scope)
                } else {
                    self.get_slot(scope, ScopeSlot::This)
                }
            }
            LexicalOwner::FieldInitializer(scope) => self.get_slot(scope, ScopeSlot::This),
        }
    }

    // The exports object of a CommonJS module, `undefined` in an ES module: what the loader passes, whatever the checker says.
    pub(in crate::lower) fn is_this_of_module(&self) -> bool {
        matches!(self.find_lexical_owner(), LexicalOwner::File(_))
    }

    fn get_derived_constructor_this(&mut self, owner: ScopeId) -> ValueId {
        let value = self.get_slot(owner, ScopeSlot::This);
        let split = self.split_on_type(value, TypeTable::ABSENT);
        self.builder
            .set_frequency(split.taken, BlockFrequency::Unlikely);
        self.builder.switch_to(split.taken);
        self.emit_throw_runtime_error(RuntimeErrorKind::UninitializedThis, None);
        self.builder.switch_to(split.not_taken);
        let binding = BindingRef::Slot(owner, ScopeSlot::This);
        if let Some(local) = self.scopes.find_local(binding) {
            self.builder
                .write_variable(local.variable, split.not_taken_value);
        }
        split.not_taken_value
    }

    pub(crate) fn bind_this(&mut self, value: ValueId) {
        let owner = match self.find_lexical_owner() {
            LexicalOwner::File(scope)
            | LexicalOwner::Function(scope, _)
            | LexicalOwner::FieldInitializer(scope) => scope,
            LexicalOwner::Generated => {
                self.scopes.entry_this = Some(value);
                return;
            }
        };
        let old = self.get_slot(owner, ScopeSlot::This);
        let split = self.split_on_type(old, TypeTable::ABSENT);
        self.builder
            .set_frequency(split.not_taken, BlockFrequency::Unlikely);
        self.builder.switch_to(split.not_taken);
        self.emit_throw_runtime_error(RuntimeErrorKind::ThisAlreadyBound, None);
        self.builder.switch_to(split.taken);
        self.set_slot(owner, ScopeSlot::This, value);
    }

    pub(crate) fn get_new_target(&mut self) -> ValueId {
        match self.find_lexical_owner() {
            LexicalOwner::Function(scope, function) => {
                match self.file.hir.runtime_function_kind(function) {
                    FnKind::Decl | FnKind::Expr | FnKind::Constructor => {
                        self.get_slot(scope, ScopeSlot::NewTarget)
                    }
                    _ => self.builder.undefined(),
                }
            }
            LexicalOwner::Generated | LexicalOwner::File(_) | LexicalOwner::FieldInitializer(_) => {
                self.builder.undefined()
            }
        }
    }

    pub(crate) fn get_home_object(&mut self) -> (HomeObjectKind, ValueId) {
        match self.find_lexical_owner() {
            LexicalOwner::Function(scope, function) => {
                match self.file.bound.fns[function.idx()].owner {
                    FnOwner::Expr(_) => {
                        let home = match self.file.hir[function].kind {
                            FnKind::Method | FnKind::Getter | FnKind::Setter => {
                                self.get_slot(scope, ScopeSlot::HomeObject)
                            }
                            _ => self.builder.undefined(),
                        };
                        (HomeObjectKind::Object, home)
                    }
                    FnOwner::Member(_) => self.get_class_home(),
                    FnOwner::None | FnOwner::Stmt(_) | FnOwner::Type(_) => {
                        (HomeObjectKind::Object, self.builder.undefined())
                    }
                }
            }
            LexicalOwner::FieldInitializer(_) => self.get_class_home(),
            LexicalOwner::Generated | LexicalOwner::File(_) => {
                (HomeObjectKind::Object, self.builder.undefined())
            }
        }
    }
}

// An arrow function reads the `this` of the function around it.
pub(in crate::lower) fn find_this_position(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) -> Option<DeclaredType> {
    match lowering.find_lexical_owner() {
        LexicalOwner::Generated => None,
        LexicalOwner::File(scope)
        | LexicalOwner::Function(scope, _)
        | LexicalOwner::FieldInitializer(scope) => {
            let binding = BindingRef::Slot(scope, ScopeSlot::This);
            Some(lowering.file.stored_position(binding))
        }
    }
}
