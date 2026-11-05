use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, ScopeId};
use bun_sema::hir::{ExprId, NodeData, PatId};
use smallvec::SmallVec;

use super::identifiers::BindingRead;
use super::lexical_owners::{ScopeObjectSearch, find_container_binding, for_each_scope_object};
use super::{BindingRef, ScopeSlot, bindings};
use crate::builtins::{Mutability, Resolved};
use crate::ir::generated::{ECMAMode, RuntimeErrorKind};
use crate::ir::{BlockId, Edge, LocalVariable, PropertyKeyId, TypeTable, ValueId};
use crate::load::test_runner_names::name_asked_of_scope_objects;
use crate::lower::FunctionLowering;
use crate::lower::member::PropertyName;

pub(super) struct DynamicBinding {
    pub(super) holder: ValueId,
    pub(super) with_base: ValueId,
}

pub(super) enum DynamicIdentifier {
    Name(DynamicBinding),
    MemberOf(ValueId),
}

#[derive(Copy, Clone)]
struct DynamicUse {
    on_binding: BlockId,
    join: BlockId,
    result: LocalVariable,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn resolve_dynamic_identifier(
        &mut self,
        identifier: ExprId,
    ) -> Option<DynamicIdentifier> {
        let bound = self.file.bound;
        bound.dynamic_lookup_scope(NodeData::Expr(identifier))?;
        let Some(container) = self.file.find_member_container(identifier) else {
            let name = self.file.identifier_name(identifier);
            let binding = bound.binding(identifier);
            let found = self.resolve_dynamic_name(identifier, binding, name, false)?;
            return Some(DynamicIdentifier::Name(found));
        };
        let symbol = find_container_binding(bound, self.scopes.innermost_scope(), container);
        let (binding, name) = (Binding::Symbol(symbol), bound.symbol(symbol).name);
        let found = self.resolve_dynamic_name(identifier, binding, name, true)?;
        let object = self.get_dynamic_target(binding, name, found.holder);
        Some(DynamicIdentifier::MemberOf(object))
    }

    fn resolve_dynamic_name(
        &mut self,
        written: ExprId,
        binding: Binding,
        name: Atom,
        asks_with_objects_alone: bool,
    ) -> Option<DynamicBinding> {
        let bound = self.file.bound;
        let start = bound.dynamic_lookup_scope(NodeData::Expr(written))?;
        name_asked_of_scope_objects(self.file.queries.atom_bytes(name))?;
        let declaring_scope = self.find_declaring_scope(binding);
        let search = ScopeObjectSearch {
            start,
            until: bound.dynamic_lookup_end(written, declaring_scope),
            declaring_scope,
            pos: self.file.hir[written].pos,
            asks_with_objects_alone,
        };
        Some(self.search_scope_objects(search, name))
    }

    pub(super) fn resolve_dynamic_pattern_name(
        &mut self,
        start: ScopeId,
        pattern: PatId,
        binding: Binding,
        name: Atom,
    ) -> DynamicBinding {
        let declaring_scope = self.find_declaring_scope(binding);
        let search = ScopeObjectSearch {
            start,
            until: declaring_scope,
            declaring_scope,
            pos: self.file.hir[pattern].pos,
            asks_with_objects_alone: false,
        };
        self.search_scope_objects(search, name)
    }

    fn find_declaring_scope(&self, binding: Binding) -> ScopeId {
        let bound = self.file.bound;
        match bindings::normalize_binding(self.file, binding) {
            Binding::Symbol(symbol) => bound.symbol_scope(symbol),
            Binding::Arguments(unit) => bound.top_scope(self.file.hir, unit),
            Binding::Free | Binding::CommonJs(_) => ScopeId::NONE,
        }
    }

    fn scope_object_key(&mut self, name: Atom) -> PropertyKeyId {
        let written = self.file.queries.atom_bytes(name);
        match name_asked_of_scope_objects(written) {
            Some(asked) if asked.len() != written.len() => {
                let asked = self.file.intern_bytes(asked);
                self.file.text_key(asked)
            }
            Some(_) | None => self.file.name_key(name),
        }
    }

    fn search_scope_objects(&mut self, search: ScopeObjectSearch, name: Atom) -> DynamicBinding {
        let key = self.scope_object_key(name);
        let holder = self.builder.create_variable(None);
        let with_base = self.builder.create_variable(None);
        let found = self.create_block();
        let mut objects: SmallVec<[BindingRef; 4]> = SmallVec::new();
        let file = &*self.file;
        for_each_scope_object(file.hir, file.bound, search, |stored| {
            let is_with = matches!(stored, BindingRef::Slot(_, ScopeSlot::WithObject));
            if is_with || file.scopes.placement(stored).is_some() {
                objects.push(stored);
            }
        });
        for stored in objects {
            let is_with = matches!(stored, BindingRef::Slot(_, ScopeSlot::WithObject));
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
        let key = self.scope_object_key(name);
        let still_has_name = self.builder.prop_has(object, key);
        if self.mode() == ECMAMode::Strict {
            let kept = self.create_block();
            let lost = self.create_block();
            self.builder
                .branch(still_has_name, Edge::to(kept), Edge::to(lost));
            self.continue_in(lost);
            self.emit_binding_error(RuntimeErrorKind::UnresolvableReference, Binding::Free, name);
            self.continue_in(kept);
        }
        self.emit_set(object, PropertyName::Constant(key), value);
        self.finish_object_path(dynamic, value);
        self.store_binding(binding, name, value, None, true);
        self.finish_binding_path(dynamic, value);
    }

    pub(crate) fn delete_identifier(&mut self, identifier: ExprId) -> ValueId {
        let name = self.file.identifier_name(identifier);
        let binding = self.file.bound.binding(identifier);
        let found = match self.resolve_dynamic_identifier(identifier) {
            Some(DynamicIdentifier::Name(found)) => found,
            Some(DynamicIdentifier::MemberOf(object)) => {
                let key = self.file.name_key(name);
                return self.emit_delete(object, PropertyName::Constant(key));
            }
            None => return self.delete_binding(binding, name),
        };
        let (object, dynamic) = self.begin_dynamic_use(found.holder);
        let key = self.scope_object_key(name);
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
        let key = self.scope_object_key(name);
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
