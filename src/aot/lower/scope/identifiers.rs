use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, StoreKind, SymbolId};
use bun_sema::hir::{ExprId, ExprKind, NodeData, PatId, PatKind};

use super::{BindingForm, BindingRef, DeadZone, IdentifierTarget, IdentifierTargetKind, bindings};
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::ValueId;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum BindingRead {
    Value,
    TypeOf,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_identifier(&mut self, identifier: ExprId) -> ValueId {
        self.read_identifier(identifier, BindingRead::Value)
    }

    pub(crate) fn lower_identifier_for_typeof(&mut self, identifier: ExprId) -> ValueId {
        self.read_identifier(identifier, BindingRead::TypeOf)
    }

    pub(crate) fn lower_identifier_callee(
        &mut self,
        identifier: ExprId,
    ) -> (ValueId, Option<ValueId>) {
        if self.file.has_dynamic_lookup(identifier) {
            let found = self.resolve_dynamic_binding(identifier);
            let function = self.get_dynamic_value(identifier, found.holder, BindingRead::Value);
            return (function, Some(found.with_base));
        }
        let Some(container) = self.file.find_member_container(identifier) else {
            return (self.lower_identifier(identifier), None);
        };
        let name = self.file.identifier_name(identifier);
        let object = self.get_container_object(container);
        let key = self.file.name_key(name);
        let function = self.emit_get(object, PropertyName::Constant(key));
        (function, Some(object))
    }

    pub(crate) fn delete_identifier(&mut self, identifier: ExprId) -> ValueId {
        if self.file.has_dynamic_lookup(identifier) {
            return self.delete_dynamic_binding(identifier);
        }
        let name = self.file.identifier_name(identifier);
        let binding = self.file.bound.binding(identifier);
        self.delete_binding(binding, name)
    }

    pub(crate) fn resolve_identifier_target(&mut self, identifier: ExprId) -> IdentifierTarget {
        IdentifierTarget {
            kind: self.resolve_binding(identifier),
        }
    }

    pub(crate) fn resolve_pattern_target(&mut self, pattern: PatId) -> IdentifierTarget {
        let name = self.file.pattern_name(pattern);
        let bound = self.file.bound;
        let binding = bound.initialized_binding(pattern);
        let kind = match bound.dynamic_lookup_scope(NodeData::Pat(pattern)) {
            Some(start) => IdentifierTargetKind::Dynamic {
                binding,
                name,
                holder: self.resolve_dynamic_name(start, binding, name).holder,
            },
            None => IdentifierTargetKind::Binding {
                binding,
                name,
                is_dead_zone_tested: true,
            },
        };
        IdentifierTarget { kind }
    }

    pub(crate) fn get_identifier_target(&mut self, target: &IdentifierTarget) -> ValueId {
        match target.kind {
            IdentifierTargetKind::Binding { binding, name, .. } => self.get_binding(binding, name),
            IdentifierTargetKind::Dynamic {
                binding,
                name,
                holder,
            } => self.get_dynamic_target(binding, name, holder),
        }
    }

    pub(crate) fn set_identifier_target(
        &mut self,
        target: &IdentifierTarget,
        value: ValueId,
        source: Option<ExprId>,
    ) {
        match target.kind {
            IdentifierTargetKind::Binding {
                binding,
                name,
                is_dead_zone_tested: true,
            } => self.store_checked_binding(binding, name, value, source),
            IdentifierTargetKind::Binding {
                binding,
                name,
                is_dead_zone_tested: false,
            } => bindings::set_binding(self, binding, name, value, source),
            IdentifierTargetKind::Dynamic {
                binding,
                name,
                holder,
            } => {
                self.store_dynamic_binding(binding, name, holder, value);
            }
        }
    }

    pub(crate) fn initialize_pattern_name(
        &mut self,
        pattern: PatId,
        value: ValueId,
        source: Option<ExprId>,
    ) {
        let name = self.file.pattern_name(pattern);
        let bound = self.file.bound;
        let binding = bound.initialized_binding(pattern);
        match bound.dynamic_lookup_scope(NodeData::Pat(pattern)) {
            Some(start) => {
                let holder = self.resolve_dynamic_name(start, binding, name).holder;
                self.store_dynamic_binding(binding, name, holder, value);
            }
            None => bindings::initialize_binding(self, binding, name, value, source),
        }
    }

    pub(crate) fn read_local(&mut self, symbol: SymbolId) -> ValueId {
        let local = self.scopes.find_local(BindingRef::Symbol(symbol));
        let local = local.expect("find_tested_local found the local");
        self.builder.read_variable(local.variable)
    }

    pub(crate) fn rebind_local(&mut self, symbol: SymbolId, value: ValueId) {
        let local = self.scopes.find_local(BindingRef::Symbol(symbol));
        let local = local.expect("find_tested_local found the local");
        self.builder.write_variable(local.variable, value);
    }

    pub(super) fn get_free_name(&mut self, name: Atom, is_for_typeof: bool) -> ValueId {
        self.emit_free_name_get(name, is_for_typeof)
    }

    pub(super) fn set_free_name(&mut self, name: Atom, value: ValueId) {
        self.emit_free_name_set(name, value);
    }

    pub(super) fn read_binding(
        &mut self,
        binding: Binding,
        name: Atom,
        read: BindingRead,
    ) -> ValueId {
        match read {
            BindingRead::Value => self.get_binding(binding, name),
            BindingRead::TypeOf => match bindings::normalize_binding(self.file, binding) {
                Binding::Free => self.get_free_name(name, true),
                Binding::CommonJs(variable) => self.get_commonjs_variable_for_typeof(variable),
                Binding::Symbol(_) | Binding::Arguments(_) => self.get_binding(binding, name),
            },
        }
    }

    pub(super) fn delete_binding(&mut self, binding: Binding, name: Atom) -> ValueId {
        match bindings::normalize_binding(self.file, binding) {
            Binding::Free => self.emit_free_name_delete(name),
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) => {
                self.builder.boolean(false)
            }
        }
    }

    fn read_identifier(&mut self, identifier: ExprId, read: BindingRead) -> ValueId {
        if self.file.has_dynamic_lookup(identifier) {
            let found = self.resolve_dynamic_binding(identifier);
            return self.get_dynamic_value(identifier, found.holder, read);
        }
        let name = self.file.identifier_name(identifier);
        let binding = self.file.bound.binding(identifier);
        match binding {
            Binding::Free => {
                if let Some(builtin) = self.file.find_locked_global(identifier) {
                    return self.emit_locked_builtin(builtin);
                }
                let value = self.read_binding(binding, name, read);
                self.expect_resolved_path(identifier, value)
            }
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) => {
                self.read_binding(binding, name, read)
            }
        }
    }

    fn resolve_binding(&mut self, identifier: ExprId) -> IdentifierTargetKind {
        let name = self.file.identifier_name(identifier);
        let binding = self.file.bound.binding(identifier);
        if self.file.has_dynamic_lookup(identifier) {
            let holder = self.resolve_dynamic_binding(identifier).holder;
            return IdentifierTargetKind::Dynamic {
                binding,
                name,
                holder,
            };
        }
        let is_dead_zone_tested = match binding {
            Binding::Symbol(symbol) if self.file.is_plain_assignment_target(symbol, identifier) => {
                self.test_dead_zone_before_value(symbol, name)
            }
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
                false
            }
        };
        IdentifierTargetKind::Binding {
            binding,
            name,
            is_dead_zone_tested,
        }
    }

    fn test_dead_zone_before_value(&mut self, symbol: SymbolId, name: Atom) -> bool {
        match self.file.scopes.form(symbol) {
            BindingForm::Import => {
                self.get_binding(Binding::Symbol(symbol), name);
                true
            }
            BindingForm::Stored if self.is_tested_before_value(symbol) => {
                self.get_checked(symbol, name);
                true
            }
            _ => false,
        }
    }
}

pub(crate) fn find_tested_local(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> Option<SymbolId> {
    let file = &*lowering.file;
    let mut tested = file.skip_type_syntax(expression);
    if let ExprKind::Assign {
        op: None, target, ..
    } = file.hir[tested].kind
    {
        tested = file.skip_type_syntax(target);
    }
    let ExprKind::Ident(_) = file.hir[tested].kind else {
        return None;
    };
    if file.has_dynamic_lookup(tested) {
        return None;
    }
    let symbol = match file.bound.binding(tested) {
        Binding::Symbol(symbol) => symbol,
        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => return None,
    };
    let local = lowering.scopes.find_local(BindingRef::Symbol(symbol))?;
    match local.dead_zone {
        DeadZone::Never | DeadZone::Initialized => Some(symbol),
        DeadZone::Uninitialized | DeadZone::DecidedAtRunTime => None,
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn is_plain_assignment_target(&self, symbol: SymbolId, identifier: ExprId) -> bool {
        let stores = self.bound.stores_to(symbol);
        let Ok(index) = stores.binary_search_by_key(&identifier, |store| store.target) else {
            return false;
        };
        matches!(stores[index].kind, StoreKind::Assign)
    }

    fn find_locked_global(&self, identifier: ExprId) -> Option<BuiltinId> {
        match self.builtins.of_expr(identifier) {
            Some(Resolved::Builtin(path)) => path.locked_builtin(),
            Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
        }
    }

    fn find_member_container(&self, identifier: ExprId) -> Option<SymbolId> {
        let symbol = match self.bound.binding(identifier) {
            Binding::Symbol(symbol) => symbol,
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => return None,
        };
        match self.scopes.form(symbol) {
            BindingForm::ContainerMember { container } => Some(container),
            _ => None,
        }
    }

    fn has_dynamic_lookup(&self, identifier: ExprId) -> bool {
        let start = self.bound.dynamic_lookup_scope(NodeData::Expr(identifier));
        start.is_some()
    }

    fn identifier_name(&self, identifier: ExprId) -> Atom {
        let ExprKind::Ident(name) = self.hir[identifier].kind else {
            unreachable!("the expression is an identifier");
        };
        name
    }

    fn pattern_name(&self, pattern: PatId) -> Atom {
        let PatKind::Ident(name) = self.hir[pattern].kind else {
            unreachable!("the pattern is a name");
        };
        name
    }
}
