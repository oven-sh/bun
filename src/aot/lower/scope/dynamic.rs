use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, ScopeId, ScopeKind};
use bun_sema::hir::{ExprId, ExprKind, NodeData};

use super::identifiers::{self, BindingRead};
use super::{BindingRef, ScopeSlot, bindings};
use crate::builtins::{Mutability, Resolved};
use crate::ir::generated::ECMAMode;
use crate::ir::{BlockId, Edge, LocalVariable, PropertyKeyId, TypeTable, ValueId};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FileLowering, FunctionLowering, condition};

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

fn find_identifier_binding(
    file: &FileLowering<'_, '_, '_, '_>,
    identifier: ExprId,
) -> (Binding, Atom) {
    let ExprKind::Ident(name) = file.hir[identifier].kind else {
        unreachable!("a dynamic lookup names an Ident expression");
    };
    (file.bound.binding(identifier), name)
}

pub(super) fn resolve_dynamic_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> DynamicBinding {
    let (binding, name) = find_identifier_binding(lowering.file, identifier);
    let node = NodeData::Expr(identifier);
    let start = lowering.file.bound.dynamic_lookup_scope(node);
    resolve_dynamic_name(lowering, start.unwrap_or(ScopeId::NONE), binding, name)
}

pub(super) fn resolve_dynamic_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    start: ScopeId,
    binding: Binding,
    name: Atom,
) -> DynamicBinding {
    let bound = lowering.file.bound;
    let until = match bindings::normalize_binding(lowering.file, binding) {
        Binding::Symbol(symbol) => bound.symbol_scope(symbol),
        Binding::Arguments(unit) => bound.top_scope(lowering.file.hir, unit),
        Binding::Free | Binding::CommonJs(_) => ScopeId::NONE,
    };
    let lookup = DynamicLookup {
        key: member::name_key(lowering.file, name),
        holder: lowering.builder.create_variable(None),
        with_base: lowering.builder.create_variable(None),
        found: lowering.create_block(),
    };
    let mut scope = start;
    while scope.is_some() && scope != until {
        emit_dynamic_scope_test(lowering, scope, lookup);
        scope = bound.scopes[scope.idx()].parent;
    }
    let missing = lowering.builder.undefined();
    lowering.builder.write_variable(lookup.holder, missing);
    lowering.builder.write_variable(lookup.with_base, missing);
    lowering.jump(lookup.found);
    lowering.continue_in(lookup.found);
    DynamicBinding {
        holder: lowering.builder.read_variable(lookup.holder),
        with_base: lowering.builder.read_variable(lookup.with_base),
    }
}

pub(super) fn get_dynamic_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
    holder: ValueId,
    read: BindingRead,
) -> ValueId {
    let (binding, name) = find_identifier_binding(lowering.file, identifier);
    let dynamic = emit_object_path_get(lowering, name, holder);
    let value = identifiers::read_binding(lowering, binding, name, read);
    let value = match lowering.file.builtins.of_expr(identifier) {
        Some(Resolved::DynamicGlobal(path))
            if path.mutability >= Mutability::ConstantUnlessWritten =>
        {
            lowering.expect_builtin(value, path.id)
        }
        Some(Resolved::DynamicGlobal(_) | Resolved::Builtin(_) | Resolved::Intrinsic(_)) | None => {
            value
        }
    };
    finish_binding_path(lowering, dynamic, value)
}

pub(super) fn get_dynamic_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
    holder: ValueId,
) -> ValueId {
    let dynamic = emit_object_path_get(lowering, name, holder);
    let value = identifiers::read_binding(lowering, binding, name, BindingRead::Value);
    finish_binding_path(lowering, dynamic, value)
}

pub(super) fn store_dynamic_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
    holder: ValueId,
    value: ValueId,
) {
    let (object, dynamic) = begin_dynamic_use(lowering, holder);
    let key = member::name_key(lowering.file, name);
    // A store to a binding of an object asks once more whether the object still has the name. A proxy sees the question.
    lowering.builder.prop_has(object, key);
    member::emit_set(lowering, object, PropertyName::Constant(key), value);
    finish_object_path(lowering, dynamic, value);
    bindings::set_binding(lowering, binding, name, value, None);
    finish_binding_path(lowering, dynamic, value);
}

pub(super) fn delete_dynamic_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> ValueId {
    let (binding, name) = find_identifier_binding(lowering.file, identifier);
    let holder = resolve_dynamic_binding(lowering, identifier).holder;
    let (object, dynamic) = begin_dynamic_use(lowering, holder);
    let key = member::name_key(lowering.file, name);
    let deleted = lowering
        .builder
        .prop_delete(object, key, ECMAMode::Sloppy, false);
    finish_object_path(lowering, dynamic, deleted);
    let deleted = identifiers::delete_binding(lowering, binding, name);
    finish_binding_path(lowering, dynamic, deleted)
}

fn emit_dynamic_scope_test(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
    lookup: DynamicLookup,
) {
    let kind = lowering.file.bound.scopes[scope.idx()].kind;
    let is_with = matches!(kind, ScopeKind::With(_));
    let binding = if is_with {
        BindingRef::Slot(scope, ScopeSlot::WithObject)
    } else {
        BindingRef::Slot(scope, ScopeSlot::EvalVariables)
    };
    if !is_with && lowering.file.scopes.placement(binding).is_none() {
        return;
    }
    let object = bindings::get_stored(lowering, binding);
    let has_binding = lowering.builder.scope_has_binding(object, lookup.key);
    let hit = lowering.create_block();
    let next = lowering.create_block();
    lowering
        .builder
        .branch(has_binding, Edge::to(hit), Edge::to(next));
    lowering.continue_in(hit);
    lowering.builder.write_variable(lookup.holder, object);
    let with_base = if is_with {
        object
    } else {
        lowering.builder.undefined()
    };
    lowering.builder.write_variable(lookup.with_base, with_base);
    lowering.jump(lookup.found);
    lowering.continue_in(next);
}

fn begin_dynamic_use(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    holder: ValueId,
) -> (ValueId, DynamicUse) {
    let result = lowering.builder.create_variable(None);
    let join = lowering.create_block();
    let split = condition::split_on_type(lowering, holder, TypeTable::OBJECT);
    lowering.builder.switch_to(split.taken);
    let dynamic = DynamicUse {
        on_binding: split.not_taken,
        join,
        result,
    };
    (split.taken_value, dynamic)
}

fn emit_object_path_get(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    name: Atom,
    holder: ValueId,
) -> DynamicUse {
    let (object, dynamic) = begin_dynamic_use(lowering, holder);
    let key = member::name_key(lowering.file, name);
    let found = member::emit_get(lowering, object, PropertyName::Constant(key));
    finish_object_path(lowering, dynamic, found);
    dynamic
}

fn finish_object_path(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    dynamic: DynamicUse,
    value: ValueId,
) {
    lowering.builder.write_variable(dynamic.result, value);
    lowering.jump(dynamic.join);
    lowering.builder.switch_to(dynamic.on_binding);
}

fn finish_binding_path(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    dynamic: DynamicUse,
    value: ValueId,
) -> ValueId {
    lowering.builder.write_variable(dynamic.result, value);
    lowering.jump(dynamic.join);
    lowering.continue_in(dynamic.join);
    lowering.builder.read_variable(dynamic.result)
}
