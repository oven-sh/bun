use bun_sema::bind::{Binding, InitialState, ScopeId, ScopeKind, SymbolId};
use bun_sema::hir::{FnId, FnKind, StmtId, StmtKind};
use smallvec::SmallVec;

use super::analysis::find_by_key;
use super::state::EnteredScope;
use super::{
    BindingRef, DeadZone, LocalBinding, ScopeSlot, Storage, bindings, dead_zone, environments,
    variables,
};
use crate::ir::{BlockId, LocalVariable, PositionFlags, Type, TypeTable, ValueId};
use crate::lower::captures::{self, Capture};
use crate::lower::{FunctionLowering, convert, function, layouts};

struct ScopeEntry<'i> {
    scope: ScopeId,
    initial: &'i [(BindingRef, ValueId)],
    undefined: Option<ValueId>,
    absent: Option<ValueId>,
}

impl ScopeEntry<'_> {
    fn find_initial_value(&self, binding: BindingRef) -> Option<ValueId> {
        let entry = self.initial.iter().find(|entry| entry.0 == binding)?;
        Some(entry.1)
    }
}

type EntryValues = SmallVec<[(BindingRef, Option<ValueId>); 8]>;

pub(super) fn enter_scope(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, scope: ScopeId) {
    allocate_scope(lowering, scope, &[]);
    instantiate_functions(lowering, scope);
}

pub(super) fn leave_scope(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, scope: ScopeId) {
    let left = lowering.scopes.pop_scope();
    debug_assert!(
        left.is_some_and(|left| left.scope == scope),
        "scopes are left innermost first"
    );
}

pub(super) fn enter_with_scope(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
    object: ValueId,
) {
    let binding = BindingRef::Slot(scope, ScopeSlot::WithObject);
    allocate_scope(lowering, scope, &[(binding, object)]);
}

pub(super) fn allocate_scope(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
    initial: &[(BindingRef, ValueId)],
) {
    assert!(scope.is_some(), "callers enter only scopes that exist");
    if lowering.scopes.innermost_scope().is_none() {
        captures::bind_captures(lowering);
    }
    let mut entry = ScopeEntry {
        scope,
        initial,
        undefined: None,
        absent: None,
    };
    let bindings = lowering.file.scopes.bindings(scope);
    let bindings: SmallVec<[BindingRef; 8]> = SmallVec::from_slice(bindings);
    let mut values = EntryValues::new();
    for binding in bindings {
        let value = emit_entry_value(lowering, &mut entry, binding);
        values.push((binding, value));
    }
    debug_assert!(
        values.is_sorted_by_key(|entry| entry.0),
        "a scope lists its bindings in ascending order"
    );
    let environment = allocate_environment(lowering, &entry, &values);
    lowering
        .scopes
        .push_scope(EnteredScope { scope, environment });
    for (binding, value) in values {
        declare_binding(lowering, &mut entry, binding, value);
    }
}

pub(super) fn instantiate_functions(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
) {
    let functions = lowering.file.scopes.hoisted_functions(scope);
    let functions: SmallVec<[(SymbolId, FnId); 4]> = SmallVec::from_slice(functions);
    for (symbol, function) in functions {
        if lowering.file.scopes.initial_function(symbol).is_some() {
            continue;
        }
        let id = function::declare_source_function(lowering.file, function, None);
        let closure = function::emit_closure(lowering, id, None);
        let name = lowering.file.bound.symbol(symbol).name;
        bindings::initialize_binding(lowering, Binding::Symbol(symbol), name, closure, None);
    }
}

pub(super) fn create_loop_header(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
) -> BlockId {
    let block = lowering.create_block();
    let mut modified: SmallVec<[LocalVariable; 8]> = SmallVec::new();
    for &binding in lowering.file.scopes.stored_in_loop(statement) {
        let local = lowering.scopes.find_local(binding);
        let local = local.expect("the scope of a local is entered before the loop");
        modified.push(local.variable);
    }
    if let StmtKind::For { .. } = lowering.file.hir[statement].kind {
        let scope = lowering.file.bound.own_scope(statement);
        modified.extend(lowering.scopes.find_environment(scope));
    }
    lowering.builder.declare_loop_header(block, &modified);
    block
}

pub(super) fn copy_iteration_bindings(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
) {
    let Some(variable) = lowering.scopes.find_environment(scope) else {
        return;
    };
    let layout = environments::environment_layout(lowering.file, scope);
    let field_count = lowering.file.scopes.environment_fields(scope).len() as u32;
    let previous = lowering.builder.read_variable(variable);
    let fields: SmallVec<[u32; 8]> = (0..field_count).collect();
    let mut values: SmallVec<[ValueId; 8]> = SmallVec::with_capacity(fields.len());
    for &field in &fields {
        let value = lowering
            .builder
            .get_environment_field(previous, layout, field);
        values.push(value);
    }
    let copy = lowering.builder.new_object(layout, &fields, None, &values);
    lowering.builder.write_variable(variable, copy);
}

fn get_entry_undefined(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    entry: &mut ScopeEntry<'_>,
) -> ValueId {
    *entry
        .undefined
        .get_or_insert_with(|| lowering.builder.undefined())
}

fn get_entry_absent(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    entry: &mut ScopeEntry<'_>,
) -> ValueId {
    *entry
        .absent
        .get_or_insert_with(|| lowering.builder.absent())
}

fn emit_entry_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    entry: &mut ScopeEntry<'_>,
    binding: BindingRef,
) -> Option<ValueId> {
    if let Some(value) = entry.find_initial_value(binding) {
        return Some(value);
    }
    match binding {
        BindingRef::Symbol(symbol) => match lowering.file.bound.initial_state(symbol) {
            InitialState::Undefined => Some(get_entry_undefined(lowering, entry)),
            InitialState::Uninitialized | InitialState::Initialized => None,
        },
        BindingRef::Slot(scope, slot) => match slot {
            ScopeSlot::This => create_entry_this(lowering, entry),
            ScopeSlot::NewTarget => lowering.builder.new_target(),
            ScopeSlot::Callee => lowering.builder.callee(),
            ScopeSlot::HomeObject => {
                captures::find_captured_value(lowering, Capture::Value(binding))
            }
            ScopeSlot::ArgumentsBinding => {
                entry.find_initial_value(BindingRef::Slot(scope, ScopeSlot::Arguments))
            }
            ScopeSlot::EvalVariables => Some(create_eval_variables_object(lowering)),
            ScopeSlot::Arguments
            | ScopeSlot::WithObject
            | ScopeSlot::CommonJs(_)
            | ScopeSlot::Class(_) => None,
        },
    }
}

fn create_entry_this(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    entry: &mut ScopeEntry<'_>,
) -> Option<ValueId> {
    let function = match lowering.file.bound.scopes[entry.scope.idx()].kind {
        ScopeKind::Fn(function) => Some(function),
        ScopeKind::FieldInitializer(_) => return Some(function::get_this(lowering)),
        ScopeKind::File
        | ScopeKind::Module(_)
        | ScopeKind::Block
        | ScopeKind::Class(_)
        | ScopeKind::Interface(_)
        | ScopeKind::TypeAlias(_)
        | ScopeKind::TypeParams
        | ScopeKind::Enum(_)
        | ScopeKind::TypeParamList(_)
        | ScopeKind::Param(_)
        | ScopeKind::ReturnType(_)
        | ScopeKind::Extends
        | ScopeKind::InferConstraint
        | ScopeKind::StaticMember
        | ScopeKind::ComputedName
        | ScopeKind::BaseExpression
        | ScopeKind::FunctionName(_)
        | ScopeKind::PropertyDeclaration(..)
        | ScopeKind::PropertyType(..)
        | ScopeKind::With(_)
        | ScopeKind::ClassDecorators(_)
        | ScopeKind::ImplicitBlock(_) => None,
    };
    if let Some(function) = function {
        if function::is_derived_constructor(lowering.file, function) {
            return Some(get_entry_absent(lowering, entry));
        }
        if lowering.file.hir.runtime_function_kind(function) == FnKind::Constructor {
            return lowering.scopes.entry_this();
        }
    }
    let this = function::get_entry_this(lowering);
    if lowering.file.bound.is_strict_scope(entry.scope) {
        return Some(this);
    }
    let this = lowering.builder.to_this(this);
    let binding = BindingRef::Slot(entry.scope, ScopeSlot::This);
    let position = environments::stored_position(lowering.file, binding);
    if position.is_expected() {
        return Some(lowering.expect_type(this, position.ty));
    }
    let is_from_compiler = position.flags.contains(PositionFlags::IS_FROM_COMPILER);
    if is_from_compiler || position.ty == TypeTable::ANYTHING {
        return Some(this);
    }
    Some(convert::convert(lowering, this, position, None))
}

fn create_eval_variables_object(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId {
    let layout = layouts::untyped_layout(lowering.file, &[]);
    let head = lowering.builder.new_object(layout, &[], None, &[]);
    let null = lowering.builder.null();
    lowering.builder.set_literal_prototype(head, null);
    lowering.builder.finish_object(head)
}

fn allocate_environment(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    entry: &ScopeEntry<'_>,
    values: &EntryValues,
) -> Option<LocalVariable> {
    if !lowering.file.scopes.has_environment(entry.scope) {
        return None;
    }
    let layout = environments::environment_layout(lowering.file, entry.scope);
    let bindings = lowering.file.scopes.environment_fields(entry.scope);
    let bindings: SmallVec<[BindingRef; 8]> = SmallVec::from_slice(bindings);
    let mut fields: SmallVec<[u32; 8]> = SmallVec::new();
    let mut field_values: SmallVec<[ValueId; 8]> = SmallVec::new();
    for (field, binding) in (0..).zip(bindings) {
        // The type of the field says that it holds nothing until its first store. Listed, `Absent` would be an initial value.
        if dead_zone::has_dead_zone(lowering.file, binding) {
            continue;
        }
        let Some(value) = find_by_key(values, binding).flatten() else {
            debug_assert!(
                !environments::is_listed_at_allocation(lowering.file, binding),
                "a required field has a value when its scope is entered"
            );
            continue;
        };
        fields.push(field);
        field_values.push(value);
    }
    let object = lowering
        .builder
        .new_object(layout, &fields, None, &field_values);
    let ty = lowering
        .file
        .fragment
        .types
        .intern(Type::environment(layout));
    let variable = lowering.builder.create_variable(Some(ty));
    lowering.builder.write_variable(variable, object);
    Some(variable)
}

fn declare_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    entry: &mut ScopeEntry<'_>,
    binding: BindingRef,
    value: Option<ValueId>,
) {
    let Some(placement) = lowering.file.scopes.placement(binding) else {
        debug_assert!(false, "a scope lists only the bindings it stores");
        return;
    };
    if placement.has_local {
        create_local(lowering, entry, binding, value);
    }
    match placement.storage {
        Storage::Variable(key) => {
            let variable = variables::ensure_variable(lowering.file, key);
            let is_stored_at_entry = match binding {
                BindingRef::Symbol(_) => entry.find_initial_value(binding).is_some(),
                BindingRef::Slot(..) => true,
            };
            if let Some(value) = value
                && is_stored_at_entry
            {
                lowering.builder.put_module_variable(variable, value);
            }
        }
        Storage::Field { .. } | Storage::Local => {}
    }
}

fn create_local(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    entry: &mut ScopeEntry<'_>,
    binding: BindingRef,
    value: Option<ValueId>,
) {
    let dead_zone = initial_dead_zone(lowering, entry.scope, binding);
    debug_assert!(
        value.is_none() || dead_zone != DeadZone::Uninitialized,
        "a binding with an entry value does not start in its dead zone"
    );
    let holds_absent = match binding {
        BindingRef::Symbol(_) => dead_zone == DeadZone::DecidedAtRunTime,
        BindingRef::Slot(..) => dead_zone::has_dead_zone(lowering.file, binding),
    };
    let position = environments::stored_position(lowering.file, binding);
    // The type of a variable is the type of the values it joins, and nothing tests what is only expected.
    let ty = match position.is_expected() {
        true => TypeTable::ANYTHING,
        false => position.ty,
    };
    let declared = if ty == TypeTable::ANYTHING {
        None
    } else if holds_absent {
        Some(lowering.file.fragment.types.union(ty, TypeTable::ABSENT))
    } else {
        Some(ty)
    };
    let variable = lowering.builder.create_variable(declared);
    let local = LocalBinding {
        variable,
        dead_zone,
    };
    lowering.scopes.declare_local(binding, local);
    let value = match value {
        Some(value) => value,
        None => match dead_zone {
            DeadZone::DecidedAtRunTime => get_entry_absent(lowering, entry),
            DeadZone::Never | DeadZone::Uninitialized | DeadZone::Initialized => return,
        },
    };
    lowering.builder.write_variable(variable, value);
}

fn initial_dead_zone(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
    binding: BindingRef,
) -> DeadZone {
    match binding {
        BindingRef::Slot(..) => DeadZone::Never,
        BindingRef::Symbol(symbol) => match lowering.file.bound.initial_state(symbol) {
            InitialState::Uninitialized if lowering.file.scopes.is_switch_scope(scope) => {
                DeadZone::DecidedAtRunTime
            }
            InitialState::Uninitialized => DeadZone::Uninitialized,
            InitialState::Undefined | InitialState::Initialized => DeadZone::Never,
        },
    }
}
