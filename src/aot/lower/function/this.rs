use bun_sema::bind::{FnOwner, FunctionFlags, ScopeId, ScopeKind};
use bun_sema::hir::{FnId, FnKind, find_transpiled_mark};
use bun_sema::module_format::evaluates_own_this;

use crate::ir::generated::{HomeObjectKind, ModuleKind, RuntimeErrorKind};
use crate::ir::{TypeTable, ValueId};
use crate::lower::class::ClassElement;
use crate::lower::scope::{BindingRef, ScopeSlot};
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone)]
enum LexicalOwner {
    Generated,
    File(ScopeId),
    Function(ScopeId, FnId),
    FieldInitializer(ScopeId),
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn is_code_of_constructor(&self, scope: ScopeId) -> bool {
        let ScopeKind::FieldInitializer(member) = self.bound.scopes[scope.idx()].kind else {
            return false;
        };
        let Some(class) = self.bound.member_class(member) else {
            return false;
        };
        let field = ClassElement::AssignedField { member };
        self.class_plan(class).injected_elements.contains(&field)
    }

    pub(in crate::lower) fn find_scope_of_evaluating_constructor(
        &self,
        scope: ScopeId,
    ) -> Option<ScopeId> {
        let constructor = self.bound.constructor_of_field_value(self.hir, scope)?;
        self.is_code_of_constructor(scope)
            .then(|| self.bound.fns[constructor.idx()].scope)
    }
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

    fn is_in_value_of_field(&self) -> bool {
        let scopes = &self.file.bound.scopes;
        let parent_of = |&scope: &ScopeId| scopes[scope.idx()].parent.some();
        std::iter::successors(self.innermost_scope().some(), parent_of)
            .any(|scope| matches!(scopes[scope.idx()].kind, ScopeKind::FieldInitializer(_)))
    }

    pub(crate) fn lower_this_expression(&mut self) -> ValueId {
        match self.find_lexical_owner() {
            LexicalOwner::File(_)
                if self.file.compiled.analysis.has_esm_syntax
                    && !self.is_in_value_of_field()
                    && find_transpiled_mark(&self.file.hir.text).is_none() =>
            {
                self.builder.null()
            }
            _ => self.get_this(),
        }
    }

    fn judges_say_that_this_is_read(&self) -> bool {
        let LexicalOwner::Function(_, function) = self.find_lexical_owner() else {
            return true;
        };
        let (hir, bound) = (self.file.hir, self.file.bound);
        !matches!(
            hir.runtime_function_kind(function),
            FnKind::Decl | FnKind::Expr
        ) || bound.fns[function.idx()].contains_this
            || bound
                .function_flags(function)
                .contains(FunctionFlags::HAS_DIRECT_EVAL)
            || evaluates_own_this(hir, function, self.file.compiled.analysis.jsx_takes_this())
    }

    pub(crate) fn get_this(&mut self) -> ValueId {
        debug_assert!(
            self.judges_say_that_this_is_read(),
            "the lowering takes `this` in a function that reads none by the judges of `this`"
        );
        assert!(
            self.birth.is_none(),
            "the object is taken while its fields are not yet defined"
        );
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

    pub(in crate::lower) fn is_this_of_module(&self) -> bool {
        matches!(self.find_lexical_owner(), LexicalOwner::File(_))
    }

    fn get_derived_constructor_this(&mut self, owner: ScopeId) -> ValueId {
        let value = self.get_slot(owner, ScopeSlot::This);
        if self.scopes.initialized_this.contains(&value) {
            return value;
        }
        let split = self.split_on_type(value, TypeTable::ABSENT);
        self.builder.switch_to(split.taken);
        self.emit_throw_runtime_error(RuntimeErrorKind::UninitializedThis, None);
        self.builder.switch_to(split.not_taken);
        let binding = BindingRef::Slot(owner, ScopeSlot::This);
        if let Some(local) = self.scopes.find_local(binding) {
            self.builder
                .write_variable(local.variable, split.not_taken_value);
            self.scopes.initialized_this.push(split.not_taken_value);
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
        if !self.builder.is_absent(old) {
            let split = self.split_on_type(old, TypeTable::ABSENT);
            self.builder.switch_to(split.not_taken);
            self.emit_throw_runtime_error(RuntimeErrorKind::ThisAlreadyBound, None);
            self.builder.switch_to(split.taken);
        }
        self.set_slot(owner, ScopeSlot::This, value);
        self.scopes.initialized_this.push(value);
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
            LexicalOwner::FieldInitializer(scope) if self.file.is_code_of_constructor(scope) => {
                self.get_slot(scope, ScopeSlot::NewTarget)
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
