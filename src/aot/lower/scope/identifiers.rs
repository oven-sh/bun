use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, StoreKind, SymbolId};
use bun_sema::hir::{ExprId, ExprKind, NodeData, PatId, PatKind};

use super::{
    BindingForm, BindingRef, DeadZone, IdentifierTarget, IdentifierTargetKind, bindings, dead_zone,
    dynamic,
};
use crate::builtins::id::BuiltinId;
use crate::builtins::Resolved;
use crate::ir::ValueId;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, commonjs, expression, member};

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum BindingRead {
    Value,
    TypeOf,
}

pub(super) fn lower_identifier(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> ValueId {
    read_identifier(lowering, identifier, BindingRead::Value)
}

pub(super) fn lower_identifier_for_typeof(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> ValueId {
    read_identifier(lowering, identifier, BindingRead::TypeOf)
}

pub(super) fn lower_identifier_callee(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> (ValueId, Option<ValueId>) {
    if has_dynamic_lookup(lowering.file, identifier) {
        let found = dynamic::resolve_dynamic_binding(lowering, identifier);
        let function =
            dynamic::get_dynamic_value(lowering, identifier, found.holder, BindingRead::Value);
        return (function, Some(found.with_base));
    }
    let Some(container) = find_member_container(lowering.file, identifier) else {
        return (lower_identifier(lowering, identifier), None);
    };
    let name = identifier_name(lowering.file, identifier);
    let object = bindings::get_container_object(lowering, container);
    let key = member::name_key(lowering.file, name);
    let function = member::emit_get(lowering, object, PropertyName::Constant(key));
    (function, Some(object))
}

pub(super) fn delete_identifier(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> ValueId {
    if has_dynamic_lookup(lowering.file, identifier) {
        return dynamic::delete_dynamic_binding(lowering, identifier);
    }
    let name = identifier_name(lowering.file, identifier);
    let binding = lowering.file.bound.binding(identifier);
    delete_binding(lowering, binding, name)
}

pub(super) fn resolve_identifier_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> IdentifierTarget {
    IdentifierTarget {
        kind: resolve_binding(lowering, identifier),
    }
}

pub(super) fn resolve_pattern_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    pattern: PatId,
) -> IdentifierTarget {
    let name = pattern_name(lowering.file, pattern);
    let bound = lowering.file.bound;
    let binding = bound.initialized_binding(pattern);
    let kind = match bound.dynamic_lookup_scope(NodeData::Pat(pattern)) {
        Some(start) => IdentifierTargetKind::Dynamic {
            binding,
            name,
            holder: dynamic::resolve_dynamic_name(lowering, start, binding, name).holder,
        },
        None => IdentifierTargetKind::Binding {
            binding,
            name,
            is_dead_zone_tested: true,
        },
    };
    IdentifierTarget { kind }
}

pub(super) fn get_identifier_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: &IdentifierTarget,
) -> ValueId {
    match target.kind {
        IdentifierTargetKind::Binding { binding, name, .. } => {
            bindings::get_binding(lowering, binding, name)
        }
        IdentifierTargetKind::Dynamic {
            binding,
            name,
            holder,
        } => dynamic::get_dynamic_target(lowering, binding, name, holder),
    }
}

pub(super) fn set_identifier_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: &IdentifierTarget,
    value: ValueId,
    source: Option<ExprId>,
) {
    match target.kind {
        IdentifierTargetKind::Binding {
            binding,
            name,
            is_dead_zone_tested: true,
        } => bindings::store_checked_binding(lowering, binding, name, value, source),
        IdentifierTargetKind::Binding {
            binding,
            name,
            is_dead_zone_tested: false,
        } => bindings::set_binding(lowering, binding, name, value, source),
        IdentifierTargetKind::Dynamic {
            binding,
            name,
            holder,
        } => {
            dynamic::store_dynamic_binding(lowering, binding, name, holder, value);
        }
    }
}

pub(super) fn initialize_pattern_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    pattern: PatId,
    value: ValueId,
    source: Option<ExprId>,
) {
    let name = pattern_name(lowering.file, pattern);
    let bound = lowering.file.bound;
    let binding = bound.initialized_binding(pattern);
    match bound.dynamic_lookup_scope(NodeData::Pat(pattern)) {
        Some(start) => {
            let holder = dynamic::resolve_dynamic_name(lowering, start, binding, name).holder;
            dynamic::store_dynamic_binding(lowering, binding, name, holder, value);
        }
        None => bindings::initialize_binding(lowering, binding, name, value, source),
    }
}

pub(super) fn find_tested_local(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> Option<SymbolId> {
    let file = &*lowering.file;
    let mut tested = expression::skip_type_syntax(file, expression);
    if let ExprKind::Assign {
        op: None,
        target,
        ..
    } = file.hir[tested].kind
    {
        tested = expression::skip_type_syntax(file, target);
    }
    let ExprKind::Ident(_) = file.hir[tested].kind else {
        return None;
    };
    if has_dynamic_lookup(file, tested) {
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

pub(super) fn read_local(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
) -> ValueId {
    let local = lowering.scopes.find_local(BindingRef::Symbol(symbol));
    let local = local.expect("find_tested_local found the local");
    lowering.builder.read_variable(local.variable)
}

pub(super) fn rebind_local(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
    value: ValueId,
) {
    let local = lowering.scopes.find_local(BindingRef::Symbol(symbol));
    let local = local.expect("find_tested_local found the local");
    lowering.builder.write_variable(local.variable, value);
}

pub(super) fn get_free_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    name: Atom,
    is_for_typeof: bool,
) -> ValueId {
    expression::emit_free_name_get(lowering, name, is_for_typeof)
}

pub(super) fn set_free_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    name: Atom,
    value: ValueId,
) {
    expression::emit_free_name_set(lowering, name, value);
}

pub(super) fn read_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
    read: BindingRead,
) -> ValueId {
    match read {
        BindingRead::Value => bindings::get_binding(lowering, binding, name),
        BindingRead::TypeOf => match bindings::normalize_binding(lowering.file, binding) {
            Binding::Free => get_free_name(lowering, name, true),
            Binding::CommonJs(variable) => {
                commonjs::get_commonjs_variable_for_typeof(lowering, variable)
            }
            Binding::Symbol(_) | Binding::Arguments(_) => {
                bindings::get_binding(lowering, binding, name)
            }
        },
    }
}

pub(super) fn delete_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
) -> ValueId {
    match bindings::normalize_binding(lowering.file, binding) {
        Binding::Free => expression::emit_free_name_delete(lowering, name),
        Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) => {
            lowering.builder.boolean(false)
        }
    }
}

fn read_identifier(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
    read: BindingRead,
) -> ValueId {
    if has_dynamic_lookup(lowering.file, identifier) {
        let found = dynamic::resolve_dynamic_binding(lowering, identifier);
        return dynamic::get_dynamic_value(lowering, identifier, found.holder, read);
    }
    let name = identifier_name(lowering.file, identifier);
    let binding = lowering.file.bound.binding(identifier);
    match binding {
        Binding::Free => {
            if let Some(builtin) = find_locked_global(lowering.file, identifier) {
                return expression::emit_locked_builtin(lowering, builtin);
            }
            let value = read_binding(lowering, binding, name, read);
            expression::expect_resolved_path(lowering, identifier, value)
        }
        Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) => {
            read_binding(lowering, binding, name, read)
        }
    }
}

fn resolve_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> IdentifierTargetKind {
    let name = identifier_name(lowering.file, identifier);
    let binding = lowering.file.bound.binding(identifier);
    if has_dynamic_lookup(lowering.file, identifier) {
        let holder = dynamic::resolve_dynamic_binding(lowering, identifier).holder;
        return IdentifierTargetKind::Dynamic {
            binding,
            name,
            holder,
        };
    }
    let is_dead_zone_tested = match binding {
        Binding::Symbol(symbol) if is_plain_assignment_target(lowering.file, symbol, identifier) => {
            test_dead_zone_before_value(lowering, symbol, name)
        }
        Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
    };
    IdentifierTargetKind::Binding {
        binding,
        name,
        is_dead_zone_tested,
    }
}

fn test_dead_zone_before_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
    name: Atom,
) -> bool {
    match lowering.file.scopes.form(symbol) {
        BindingForm::Import => {
            bindings::get_binding(lowering, Binding::Symbol(symbol), name);
            true
        }
        BindingForm::Stored if dead_zone::is_tested_before_value(lowering, symbol) => {
            dead_zone::get_checked(lowering, symbol, name);
            true
        }
        BindingForm::Stored
        | BindingForm::NotAValue
        | BindingForm::Callee { .. }
        | BindingForm::MappedArgument { .. }
        | BindingForm::ContainerMember { .. } => false,
    }
}

fn is_plain_assignment_target(
    file: &FileLowering<'_, '_, '_, '_>,
    symbol: SymbolId,
    identifier: ExprId,
) -> bool {
    let stores = file.bound.stores_to(symbol);
    let Ok(index) = stores.binary_search_by_key(&identifier, |store| store.target) else {
        return false;
    };
    match stores[index].kind {
        StoreKind::Assign => true,
        StoreKind::CompoundAssign(_)
        | StoreKind::Update(_)
        | StoreKind::Destructure
        | StoreKind::ForIn
        | StoreKind::ForOf => false,
    }
}

fn find_locked_global(
    file: &FileLowering<'_, '_, '_, '_>,
    identifier: ExprId,
) -> Option<BuiltinId> {
    match file.builtins.of_expr(identifier) {
        Some(Resolved::Builtin(path)) => path.locked_builtin(),
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
    }
}

fn find_member_container(
    file: &FileLowering<'_, '_, '_, '_>,
    identifier: ExprId,
) -> Option<SymbolId> {
    let symbol = match file.bound.binding(identifier) {
        Binding::Symbol(symbol) => symbol,
        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => return None,
    };
    match file.scopes.form(symbol) {
        BindingForm::ContainerMember { container } => Some(container),
        BindingForm::NotAValue
        | BindingForm::Import
        | BindingForm::Callee { .. }
        | BindingForm::MappedArgument { .. }
        | BindingForm::Stored => None,
    }
}

fn has_dynamic_lookup(file: &FileLowering<'_, '_, '_, '_>, identifier: ExprId) -> bool {
    let start = file.bound.dynamic_lookup_scope(NodeData::Expr(identifier));
    start.is_some()
}

fn identifier_name(file: &FileLowering<'_, '_, '_, '_>, identifier: ExprId) -> Atom {
    let ExprKind::Ident(name) = file.hir[identifier].kind else {
        unreachable!("the expression is an identifier");
    };
    name
}

fn pattern_name(file: &FileLowering<'_, '_, '_, '_>, pattern: PatId) -> Atom {
    let PatKind::Ident(name) = file.hir[pattern].kind else {
        unreachable!("the pattern is a name");
    };
    name
}
