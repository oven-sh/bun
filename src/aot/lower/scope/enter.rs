use bun_sema::bind::{Binding, InitialState, ScopeId, ScopeKind, SymbolId};
use bun_sema::hir::{FnId, FnKind, StmtId, StmtKind};
use smallvec::SmallVec;

use super::analysis::find_by_key;
use super::state::EnteredScope;
use super::{
    BindingRef, DeadZone, LocalBinding, ScopeSlot, Storage, bindings, dead_zone, environments,
    find_entry,
};
use crate::ir::{BlockId, LocalVariable, PositionFlags, Type, TypeTable, ValueId};
use crate::lower::captures::Capture;
use crate::lower::{FunctionLowering, convert, function};

struct ScopeEntry<'i> {
    scope: ScopeId,
    initial: &'i [(BindingRef, ValueId)],
    undefined: Option<ValueId>,
    absent: Option<ValueId>,
}

type EntryValues = SmallVec<[(BindingRef, Option<ValueId>); 8]>;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn enter_scope(&mut self, scope: ScopeId) {
        self.allocate_scope(scope, &[]);
        self.instantiate_functions(scope);
    }

    pub(crate) fn leave_scope(&mut self, scope: ScopeId) {
        let left = self.scopes.entered.pop();
        debug_assert!(
            left.is_some_and(|left| left.scope == scope),
            "scopes are left innermost first"
        );
    }

    pub(crate) fn enter_with_scope(&mut self, scope: ScopeId, object: ValueId) {
        let binding = BindingRef::Slot(scope, ScopeSlot::WithObject);
        self.allocate_scope(scope, &[(binding, object)]);
    }

    pub(in crate::lower) fn allocate_scope(
        &mut self,
        scope: ScopeId,
        initial: &[(BindingRef, ValueId)],
    ) {
        assert!(scope.is_some(), "callers enter only scopes that exist");
        if self.scopes.innermost_scope().is_none() {
            self.bind_captures();
        }
        let mut entry = ScopeEntry {
            scope,
            initial,
            undefined: None,
            absent: None,
        };
        let bindings = self.file.scopes.bindings(scope);
        let bindings: SmallVec<[BindingRef; 8]> = SmallVec::from_slice(bindings);
        let mut values = EntryValues::new();
        for binding in bindings {
            let value = emit_entry_value(self, &mut entry, binding);
            values.push((binding, value));
        }
        debug_assert!(
            values.is_sorted_by_key(|entry| entry.0),
            "a scope lists its bindings in ascending order"
        );
        let environment = self.allocate_environment(&entry, &values);
        let entered = EnteredScope { scope, environment };
        self.scopes.entered.push(entered);
        for (binding, value) in values {
            let Some(placement) = self.file.scopes.placement(binding) else {
                debug_assert!(false, "a scope lists only the bindings it stores");
                continue;
            };
            if placement.has_local {
                self.create_local(&mut entry, binding, value);
            }
            match placement.storage {
                Storage::Variable(key) => {
                    let variable = self.file.ensure_variable(key);
                    let is_stored_at_entry = match binding {
                        BindingRef::Symbol(_) => find_entry(entry.initial, binding).is_some(),
                        BindingRef::Slot(..) => true,
                    };
                    if let Some(value) = value
                        && is_stored_at_entry
                    {
                        self.builder.put_module_variable(variable, value);
                    }
                }
                Storage::Field { .. } | Storage::Local => {}
            }
        }
    }

    pub(in crate::lower) fn instantiate_functions(&mut self, scope: ScopeId) {
        let functions = self.file.scopes.hoisted_functions(scope);
        let functions: SmallVec<[(SymbolId, FnId); 4]> = SmallVec::from_slice(functions);
        for (symbol, function) in functions {
            if self.file.scopes.initial_function(symbol).is_some() {
                continue;
            }
            let id = function::declare_source_function(self.file, function, None);
            let closure = self.emit_closure(id, None);
            let name = self.file.bound.symbol(symbol).name;
            bindings::initialize_binding(self, Binding::Symbol(symbol), name, closure, None);
        }
    }

    pub(crate) fn create_loop_header(&mut self, statement: StmtId) -> BlockId {
        let block = self.create_block();
        let mut modified: SmallVec<[LocalVariable; 8]> = SmallVec::new();
        for &binding in self.file.scopes.stored_in_loop(statement) {
            let local = self.scopes.find_local(binding);
            let local = local.expect("the scope of a local is entered before the loop");
            modified.push(local.variable);
        }
        if let StmtKind::For { .. } = self.file.hir[statement].kind {
            let scope = self.file.bound.own_scope(statement);
            modified.extend(self.scopes.find_environment(scope));
        }
        self.builder.declare_loop_header(block, &modified);
        block
    }

    pub(crate) fn copy_iteration_bindings(&mut self, scope: ScopeId) {
        let Some(variable) = self.scopes.find_environment(scope) else {
            return;
        };
        let layout = environments::environment_layout(self.file, scope);
        let field_count = self.file.scopes.environment_fields(scope).len() as u32;
        let previous = self.builder.read_variable(variable);
        let fields: SmallVec<[u32; 8]> = (0..field_count).collect();
        let mut values: SmallVec<[ValueId; 8]> = SmallVec::with_capacity(fields.len());
        for &field in &fields {
            let value = self.builder.get_environment_field(previous, layout, field);
            values.push(value);
        }
        let copy = self.builder.new_object(layout, &fields, None, &values);
        self.builder.write_variable(variable, copy);
    }

    fn get_entry_undefined(&mut self, entry: &mut ScopeEntry<'_>) -> ValueId {
        *entry
            .undefined
            .get_or_insert_with(|| self.builder.undefined())
    }

    fn get_entry_absent(&mut self, entry: &mut ScopeEntry<'_>) -> ValueId {
        *entry.absent.get_or_insert_with(|| self.builder.absent())
    }

    fn create_entry_this(&mut self, entry: &mut ScopeEntry<'_>) -> Option<ValueId> {
        let function = match self.file.bound.scopes[entry.scope.idx()].kind {
            ScopeKind::Fn(function) => Some(function),
            ScopeKind::FieldInitializer(_) => return Some(self.get_this()),
            _ => None,
        };
        if let Some(function) = function {
            if self.file.is_derived_constructor(function) {
                return Some(self.get_entry_absent(entry));
            }
            if self.file.hir.runtime_function_kind(function) == FnKind::Constructor {
                return self.scopes.entry_this;
            }
        }
        let this = self.get_entry_this();
        if self.file.bound.is_strict_scope(entry.scope) {
            return Some(this);
        }
        let this = self.builder.to_this(this);
        let binding = BindingRef::Slot(entry.scope, ScopeSlot::This);
        let position = self.file.stored_position(binding);
        if position.is_expected() {
            return Some(self.expect_type(this, position.ty));
        }
        let is_from_compiler = position.flags.contains(PositionFlags::IS_FROM_COMPILER);
        if is_from_compiler || position.ty == TypeTable::ANYTHING {
            return Some(this);
        }
        Some(convert::convert(self, this, position, None))
    }

    fn allocate_environment(
        &mut self,
        entry: &ScopeEntry<'_>,
        values: &EntryValues,
    ) -> Option<LocalVariable> {
        if !self.file.scopes.has_environment(entry.scope) {
            return None;
        }
        let layout = environments::environment_layout(self.file, entry.scope);
        let bindings = self.file.scopes.environment_fields(entry.scope);
        let mut fields: SmallVec<[u32; 8]> = SmallVec::new();
        let mut field_values: SmallVec<[ValueId; 8]> = SmallVec::new();
        for (field, &binding) in (0..).zip(bindings) {
            // The type of the field says that it holds nothing until its first store. Listed, `Absent` would be an initial value.
            if dead_zone::has_dead_zone(self.file, binding) {
                continue;
            }
            let Some(value) = find_by_key(values, binding).flatten() else {
                debug_assert!(
                    !self.file.is_listed_at_allocation(binding),
                    "a required field has a value when its scope is entered"
                );
                continue;
            };
            fields.push(field);
            field_values.push(value);
        }
        let object = self
            .builder
            .new_object(layout, &fields, None, &field_values);
        let ty = self.file.fragment.types.intern(Type::environment(layout));
        let variable = self.builder.create_variable(Some(ty));
        self.builder.write_variable(variable, object);
        Some(variable)
    }

    fn create_local(
        &mut self,
        entry: &mut ScopeEntry<'_>,
        binding: BindingRef,
        value: Option<ValueId>,
    ) {
        let (dead_zone, holds_absent) = match binding {
            BindingRef::Slot(..) => {
                let holds_absent = dead_zone::has_dead_zone(self.file, binding);
                (DeadZone::Never, holds_absent)
            }
            BindingRef::Symbol(symbol) => match self.file.bound.initial_state(symbol) {
                InitialState::Uninitialized if self.file.scopes.is_switch_scope(entry.scope) => {
                    (DeadZone::DecidedAtRunTime, true)
                }
                InitialState::Uninitialized => (DeadZone::Uninitialized, false),
                InitialState::Undefined | InitialState::Initialized => (DeadZone::Never, false),
            },
        };
        debug_assert!(
            value.is_none() || dead_zone != DeadZone::Uninitialized,
            "a binding with an entry value does not start in its dead zone"
        );
        let position = self.file.stored_position(binding);
        // The type of a variable is the type of the values it joins, and nothing tests what is only expected.
        let ty = match position.is_expected() {
            true => TypeTable::ANYTHING,
            false => position.ty,
        };
        let declared = if ty == TypeTable::ANYTHING {
            None
        } else if holds_absent {
            Some(self.file.fragment.types.union(ty, TypeTable::ABSENT))
        } else {
            Some(ty)
        };
        let variable = self.builder.create_variable(declared);
        let local = LocalBinding {
            variable,
            dead_zone,
        };
        self.scopes.locals.insert(binding, local);
        let value = match value {
            Some(value) => value,
            None => match dead_zone {
                DeadZone::DecidedAtRunTime => self.get_entry_absent(entry),
                DeadZone::Never | DeadZone::Uninitialized | DeadZone::Initialized => return,
            },
        };
        self.builder.write_variable(variable, value);
    }
}

fn emit_entry_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    entry: &mut ScopeEntry<'_>,
    binding: BindingRef,
) -> Option<ValueId> {
    if let Some(value) = find_entry(entry.initial, binding) {
        return Some(value);
    }
    match binding {
        BindingRef::Symbol(symbol) => match lowering.file.bound.initial_state(symbol) {
            InitialState::Undefined => Some(lowering.get_entry_undefined(entry)),
            InitialState::Uninitialized | InitialState::Initialized => None,
        },
        BindingRef::Slot(scope, slot) => match slot {
            ScopeSlot::This => lowering.create_entry_this(entry),
            ScopeSlot::NewTarget => lowering.builder.new_target(),
            ScopeSlot::Callee => lowering.builder.callee(),
            ScopeSlot::HomeObject => lowering.find_captured_value(Capture::Value(binding)),
            ScopeSlot::ArgumentsBinding => {
                find_entry(entry.initial, BindingRef::Slot(scope, ScopeSlot::Arguments))
            }
            ScopeSlot::EvalVariables => {
                let layout = lowering.file.untyped_layout(&[]);
                let head = lowering.builder.new_object(layout, &[], None, &[]);
                let null = lowering.builder.null();
                lowering.builder.set_literal_prototype(head, null);
                Some(lowering.builder.finish_object(head))
            }
            _ => None,
        },
    }
}
