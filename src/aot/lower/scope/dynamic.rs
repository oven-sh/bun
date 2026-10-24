use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, ScopeId, ScopeKind};
use bun_sema::hir::{ExprId, NodeData};

use super::identifiers::BindingRead;
use super::{BindingRef, ScopeSlot, bindings};
use crate::builtins::{Mutability, Resolved};
use crate::ir::generated::ECMAMode;
use crate::ir::{BlockId, Edge, LocalVariable, TypeTable, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::member::PropertyName;

pub(super) struct DynamicBinding {
    pub(super) holder: ValueId,
    pub(super) with_base: ValueId,
}

#[derive(Copy, Clone)]
struct DynamicUse {
    on_binding: BlockId,
    join: BlockId,
    result: LocalVariable,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn resolve_dynamic_binding(&mut self, identifier: ExprId) -> Option<DynamicBinding> {
        let bound = self.file.bound;
        let start = bound.dynamic_lookup_scope(NodeData::Expr(identifier))?;
        let name = self.file.identifier_name(identifier);
        Some(self.resolve_dynamic_name(start, bound.binding(identifier), name))
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
        let key = self.file.name_key(name);
        let holder = self.builder.create_variable(None);
        let with_base = self.builder.create_variable(None);
        let found = self.create_block();
        let mut enclosing = start;
        while enclosing.is_some() && enclosing != until {
            let scope = enclosing;
            enclosing = bound.scopes[scope.idx()].parent;
            let is_with = matches!(bound.scopes[scope.idx()].kind, ScopeKind::With(_));
            let stored = if is_with {
                BindingRef::Slot(scope, ScopeSlot::WithObject)
            } else {
                BindingRef::Slot(scope, ScopeSlot::EvalVariables)
            };
            if !is_with && self.file.scopes.placement(stored).is_none() {
                continue;
            }
            let object = self.get_stored(stored);
            let has_binding = self.builder.scope_has_binding(object, key);
            let hit = self.create_block();
            let next = self.create_block();
            self.builder
                .branch(has_binding, Edge::to(hit), Edge::to(next));
            self.continue_in(hit);
            self.builder.write_variable(holder, object);
            let base = if is_with {
                object
            } else {
                self.builder.undefined()
            };
            self.builder.write_variable(with_base, base);
            self.jump(found);
            self.continue_in(next);
        }
        let missing = self.builder.undefined();
        self.builder.write_variable(holder, missing);
        self.builder.write_variable(with_base, missing);
        self.jump(found);
        self.continue_in(found);
        DynamicBinding {
            holder: self.builder.read_variable(holder),
            with_base: self.builder.read_variable(with_base),
        }
    }

    pub(super) fn get_dynamic_value(
        &mut self,
        identifier: ExprId,
        holder: ValueId,
        read: BindingRead,
    ) -> ValueId {
        let name = self.file.identifier_name(identifier);
        let dynamic = self.emit_object_path_get(name, holder);
        let value = self.read_binding(self.file.bound.binding(identifier), name, read);
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
        self.store_binding(binding, name, value, None, true);
        self.finish_binding_path(dynamic, value);
    }

    pub(crate) fn delete_identifier(&mut self, identifier: ExprId) -> ValueId {
        let name = self.file.identifier_name(identifier);
        let binding = self.file.bound.binding(identifier);
        let Some(found) = self.resolve_dynamic_binding(identifier) else {
            return self.delete_binding(binding, name);
        };
        let (object, dynamic) = self.begin_dynamic_use(found.holder);
        let key = self.file.name_key(name);
        let deleted = self
            .builder
            .prop_delete(object, key, ECMAMode::Sloppy, false);
        self.finish_object_path(dynamic, deleted);
        let deleted = self.delete_binding(binding, name);
        self.finish_binding_path(dynamic, deleted)
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
