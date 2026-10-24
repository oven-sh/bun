use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, ScopeId, ScopeKind};
use bun_sema::hir::{ExprId, ExprKind, NodeData};

use super::identifiers::BindingRead;
use super::{BindingRef, ScopeSlot, bindings};
use crate::builtins::{Mutability, Resolved};
use crate::ir::generated::ECMAMode;
use crate::ir::{BlockId, Edge, LocalVariable, PropertyKeyId, TypeTable, ValueId};
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering};

pub(super) struct DynamicBinding {
    pub(super) holder: ValueId,
    pub(super) with_base: ValueId,
}

#[derive(Copy, Clone)]
struct DynamicLookup {
    key: PropertyKeyId,
    holder: LocalVariable,
    with_base: LocalVariable,
    found: BlockId,
}

#[derive(Copy, Clone)]
struct DynamicUse {
    on_binding: BlockId,
    join: BlockId,
    result: LocalVariable,
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_identifier_binding(&self, identifier: ExprId) -> (Binding, Atom) {
        let ExprKind::Ident(name) = self.hir[identifier].kind else {
            unreachable!("a dynamic lookup names an Ident expression");
        };
        (self.bound.binding(identifier), name)
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn resolve_dynamic_binding(&mut self, identifier: ExprId) -> DynamicBinding {
        let (binding, name) = self.file.find_identifier_binding(identifier);
        let node = NodeData::Expr(identifier);
        let start = self.file.bound.dynamic_lookup_scope(node);
        self.resolve_dynamic_name(start.unwrap_or(ScopeId::NONE), binding, name)
    }

    pub(super) fn resolve_dynamic_name(
        &mut self,
        start: ScopeId,
        binding: Binding,
        name: Atom,
    ) -> DynamicBinding {
        let bound = self.file.bound;
        let until = match bindings::normalize_binding(self.file, binding) {
            Binding::Symbol(symbol) => bound.symbol_scope(symbol),
            Binding::Arguments(unit) => bound.top_scope(self.file.hir, unit),
            Binding::Free | Binding::CommonJs(_) => ScopeId::NONE,
        };
        let lookup = DynamicLookup {
            key: self.file.name_key(name),
            holder: self.builder.create_variable(None),
            with_base: self.builder.create_variable(None),
            found: self.create_block(),
        };
        let mut scope = start;
        while scope.is_some() && scope != until {
            self.emit_dynamic_scope_test(scope, lookup);
            scope = bound.scopes[scope.idx()].parent;
        }
        let missing = self.builder.undefined();
        self.builder.write_variable(lookup.holder, missing);
        self.builder.write_variable(lookup.with_base, missing);
        self.jump(lookup.found);
        self.continue_in(lookup.found);
        DynamicBinding {
            holder: self.builder.read_variable(lookup.holder),
            with_base: self.builder.read_variable(lookup.with_base),
        }
    }

    pub(super) fn get_dynamic_value(
        &mut self,
        identifier: ExprId,
        holder: ValueId,
        read: BindingRead,
    ) -> ValueId {
        let (binding, name) = self.file.find_identifier_binding(identifier);
        let dynamic = self.emit_object_path_get(name, holder);
        let value = self.read_binding(binding, name, read);
        let value = match self.file.builtins.of_expr(identifier) {
            Some(Resolved::DynamicGlobal(path))
                if path.mutability >= Mutability::ConstantUnlessWritten =>
            {
                self.expect_builtin(value, path.id)
            }
            Some(Resolved::DynamicGlobal(_) | Resolved::Builtin(_) | Resolved::Intrinsic(_))
            | None => value,
        };
        self.finish_binding_path(dynamic, value)
    }

    pub(super) fn get_dynamic_target(
        &mut self,
        binding: Binding,
        name: Atom,
        holder: ValueId,
    ) -> ValueId {
        let dynamic = self.emit_object_path_get(name, holder);
        let value = self.read_binding(binding, name, BindingRead::Value);
        self.finish_binding_path(dynamic, value)
    }

    pub(super) fn store_dynamic_binding(
        &mut self,
        binding: Binding,
        name: Atom,
        holder: ValueId,
        value: ValueId,
    ) {
        let (object, dynamic) = self.begin_dynamic_use(holder);
        let key = self.file.name_key(name);
        // A store to a binding of an object asks once more whether the object still has the name. A proxy sees the question.
        self.builder.prop_has(object, key);
        self.emit_set(object, PropertyName::Constant(key), value);
        self.finish_object_path(dynamic, value);
        bindings::set_binding(self, binding, name, value, None);
        self.finish_binding_path(dynamic, value);
    }

    pub(super) fn delete_dynamic_binding(&mut self, identifier: ExprId) -> ValueId {
        let (binding, name) = self.file.find_identifier_binding(identifier);
        let holder = self.resolve_dynamic_binding(identifier).holder;
        let (object, dynamic) = self.begin_dynamic_use(holder);
        let key = self.file.name_key(name);
        let deleted = self
            .builder
            .prop_delete(object, key, ECMAMode::Sloppy, false);
        self.finish_object_path(dynamic, deleted);
        let deleted = self.delete_binding(binding, name);
        self.finish_binding_path(dynamic, deleted)
    }

    fn emit_dynamic_scope_test(&mut self, scope: ScopeId, lookup: DynamicLookup) {
        let kind = self.file.bound.scopes[scope.idx()].kind;
        let is_with = matches!(kind, ScopeKind::With(_));
        let binding = if is_with {
            BindingRef::Slot(scope, ScopeSlot::WithObject)
        } else {
            BindingRef::Slot(scope, ScopeSlot::EvalVariables)
        };
        if !is_with && self.file.scopes.placement(binding).is_none() {
            return;
        }
        let object = self.get_stored(binding);
        let has_binding = self.builder.scope_has_binding(object, lookup.key);
        let hit = self.create_block();
        let next = self.create_block();
        self.builder
            .branch(has_binding, Edge::to(hit), Edge::to(next));
        self.continue_in(hit);
        self.builder.write_variable(lookup.holder, object);
        let with_base = if is_with {
            object
        } else {
            self.builder.undefined()
        };
        self.builder.write_variable(lookup.with_base, with_base);
        self.jump(lookup.found);
        self.continue_in(next);
    }

    fn begin_dynamic_use(&mut self, holder: ValueId) -> (ValueId, DynamicUse) {
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        let split = self.split_on_type(holder, TypeTable::OBJECT);
        self.builder.switch_to(split.taken);
        let dynamic = DynamicUse {
            on_binding: split.not_taken,
            join,
            result,
        };
        (split.taken_value, dynamic)
    }

    fn emit_object_path_get(&mut self, name: Atom, holder: ValueId) -> DynamicUse {
        let (object, dynamic) = self.begin_dynamic_use(holder);
        let key = self.file.name_key(name);
        let found = self.emit_get(object, PropertyName::Constant(key));
        self.finish_object_path(dynamic, found);
        dynamic
    }

    fn finish_object_path(&mut self, dynamic: DynamicUse, value: ValueId) {
        self.builder.write_variable(dynamic.result, value);
        self.jump(dynamic.join);
        self.builder.switch_to(dynamic.on_binding);
    }

    fn finish_binding_path(&mut self, dynamic: DynamicUse, value: ValueId) -> ValueId {
        self.builder.write_variable(dynamic.result, value);
        self.jump(dynamic.join);
        self.continue_in(dynamic.join);
        self.builder.read_variable(dynamic.result)
    }
}
