use bun_sema::bind::{Binding, CodeUnit, InitialState, ScopeId, ScopeKind, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{FnKind, IdList, StmtId, StmtKind};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::analysis::find_by_key;
use super::state::{EnteredScope, EnvironmentPutOff};
use super::{
    BindingRef, DeadZone, LocalBinding, ScopeSlot, Storage, bindings, dead_zone, environments,
};
use crate::ir::{
    BlockId, ClassSlot, LocalVariable, PositionFlags, Type, TypeTable, ValueId, VariableKey,
};
use crate::lower::captures::Capture;
use crate::lower::{FunctionLowering, convert, function};

struct ScopeEntry<'i> {
    scope: ScopeId,
    initial_in_order: &'i [(BindingRef, ValueId)],
    initial: FxHashMap<BindingRef, ValueId>,
    undefined: Option<ValueId>,
    absent: Option<ValueId>,
}

impl<'i> ScopeEntry<'i> {
    fn new(scope: ScopeId, initial_values: &'i [(BindingRef, ValueId)]) -> ScopeEntry<'i> {
        let mut initial = FxHashMap::default();
        let is_in_order = initial_values.is_sorted_by(|first, second| first.0 < second.0);
        if !is_in_order {
            for &(binding, value) in initial_values {
                initial.entry(binding).or_insert(value);
            }
        }
        ScopeEntry {
            scope,
            initial_in_order: if is_in_order { initial_values } else { &[] },
            initial,
            undefined: None,
            absent: None,
        }
    }

    #[inline]
    fn find_initial(&self, binding: BindingRef) -> Option<ValueId> {
        match self.initial_in_order {
            [] => self.initial.get(&binding).copied(),
            in_order => find_by_key(in_order, binding),
        }
    }
}

type EntryValues = SmallVec<[(BindingRef, Option<ValueId>); 8]>;

fn is_born_undefined(binding: BindingRef) -> bool {
    matches!(
        binding,
        BindingRef::Slot(
            _,
            ScopeSlot::Class(ClassSlot::PrivateMethod(_) | ClassSlot::DecoratorState)
        )
    )
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(in crate::lower) enum MakerOfScope {
    HereWhenAskedFor,
    Here,
    Instantiation,
    AheadOfBody,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn enter_scope(&mut self, scope: ScopeId) {
        self.allocate_scope(scope, &[]);
        self.instantiate_functions(scope);
    }

    pub(crate) fn leave_scope(&mut self, scope: ScopeId) {
        let left = self.scopes.entered.pop();
        let depth = self.scopes.entered.len();
        if !self.scopes.environments_put_off.is_empty() {
            self.scopes
                .environments_put_off
                .retain(|it| it.depth < depth);
        }
        debug_assert!(
            left.is_some_and(|left| left.scope == scope),
            "scopes are left innermost first"
        );
    }

    pub(crate) fn enter_container_scope(&mut self, scope: ScopeId, object: ValueId) {
        let parameter = self.file.bound.container_parameter(scope);
        let position = self.file.binding_position(parameter);
        let object = self.convert_initializer(object, position, None);
        self.allocate_scope(scope, &[(BindingRef::Symbol(parameter), object)]);
        self.instantiate_functions(scope);
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
        self.allocate_scope_made_by(scope, initial, MakerOfScope::Here);
    }

    pub(in crate::lower) fn allocate_scope_of_function(
        &mut self,
        scope: ScopeId,
        initial: &[(BindingRef, ValueId)],
    ) {
        self.allocate_scope_made_by(scope, initial, MakerOfScope::HereWhenAskedFor);
    }

    pub(in crate::lower) fn enter_scope_made_by(&mut self, scope: ScopeId, maker: MakerOfScope) {
        self.allocate_scope_made_by(scope, &[], maker);
        self.instantiate_functions_made_by(scope, maker);
    }

    fn allocate_scope_made_by(
        &mut self,
        scope: ScopeId,
        initial: &[(BindingRef, ValueId)],
        maker: MakerOfScope,
    ) {
        assert!(scope.is_some(), "callers enter only scopes that exist");
        if self.scopes.innermost_scope().is_none() {
            self.bind_captures();
        }
        let mut entry = ScopeEntry::new(scope, initial);
        let mut values = EntryValues::new();
        for index in 0..self.file.scopes.bindings(scope).len() {
            let binding = self.file.scopes.bindings(scope)[index];
            let value = emit_entry_value(self, &mut entry, binding);
            values.push((binding, value));
        }
        debug_assert!(
            values.is_sorted_by_key(|entry| entry.0),
            "a scope lists its bindings in ascending order"
        );
        let environment = match maker {
            MakerOfScope::HereWhenAskedFor => self.put_off_environment(&entry, &values),
            MakerOfScope::Here | MakerOfScope::Instantiation => {
                self.allocate_environment(&entry, &values)
            }
            MakerOfScope::AheadOfBody => self.take_environment_made_ahead(scope),
        };
        let entered = EnteredScope { scope, environment };
        self.scopes.entered.push(entered);
        for &(binding, value) in values.iter() {
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
                    let may_be_reevaluated =
                        self.file.inputs.modules.may_be_reevaluated(self.file.file);
                    let is_stored_at_entry = match binding {
                        BindingRef::Symbol(_) => {
                            may_be_reevaluated || entry.find_initial(binding).is_some()
                        }
                        BindingRef::Slot(..) => true,
                    };
                    let value = match (value, binding) {
                        (None, BindingRef::Symbol(_))
                            if may_be_reevaluated
                                && dead_zone::has_dead_zone(self.file, binding) =>
                        {
                            Some(self.get_entry_absent(&mut entry))
                        }
                        _ => value,
                    };
                    if let Some(value) = value
                        && is_stored_at_entry
                        && maker != MakerOfScope::AheadOfBody
                    {
                        self.builder.put_module_variable(variable, value);
                    }
                }
                Storage::Field { .. } | Storage::Local => {}
            }
        }
    }

    pub(in crate::lower) fn instantiate_functions(&mut self, scope: ScopeId) {
        self.instantiate_functions_made_by(scope, MakerOfScope::Here);
    }

    fn instantiate_functions_made_by(&mut self, scope: ScopeId, maker: MakerOfScope) {
        for index in 0..self.file.scopes.hoisted_functions(scope).len() {
            let (symbol, function) = self.file.scopes.hoisted_functions(scope)[index];
            if self.file.scopes.initial_function(symbol).is_some() {
                continue;
            }
            let placement = self.file.scopes.placement(BindingRef::Symbol(symbol));
            let is_local = placement.is_none_or(|placement| placement.storage == Storage::Local);
            let is_made_here = match maker {
                MakerOfScope::Here | MakerOfScope::HereWhenAskedFor => true,
                MakerOfScope::Instantiation => !is_local,
                MakerOfScope::AheadOfBody => is_local,
            };
            if !is_made_here {
                continue;
            }
            self.file.queries.note_idle_between_statements();
            let id = function::declare_source_function(self.file, function, None);
            let bound = self.file.bound;
            let is_name_in_function = matches!(
                bound.code_unit(bound.symbol_scope(symbol)),
                CodeUnit::Function(_)
            );
            let written = FunctionRef {
                file: self.file.file,
                function,
            };
            let is_left_out = is_local && self.file.inputs.library_functions.is_left_out(written);
            if (is_name_in_function || is_left_out)
                && !bound.is_visible_to_eval(symbol)
                && self.file.scopes.is_never_named(symbol)
            {
                continue;
            }
            if self.file.scopes.is_created_at_each_read(symbol) {
                continue;
            }
            if self
                .file
                .scopes
                .function_made_at_first_read(symbol)
                .is_some()
            {
                let name = bound.symbol(symbol).name;
                let nothing = self.builder.undefined();
                match is_local {
                    true => self.initialize_converted_symbol(symbol, name, nothing),
                    false => bindings::initialize_binding(
                        self,
                        Binding::Symbol(symbol),
                        name,
                        nothing,
                        None,
                    ),
                }
                continue;
            }
            let closure = self.emit_closure(id, None);
            let name = self.file.bound.symbol(symbol).name;
            bindings::initialize_binding(self, Binding::Symbol(symbol), name, closure, None);
        }
    }

    pub(crate) fn create_loop_header(&mut self, statement: StmtId) -> BlockId {
        let created = self.file.scopes.functions_created_before_loop(statement);
        let created: SmallVec<[SymbolId; 2]> = created.iter().map(|entry| entry.1).collect();
        for symbol in created {
            self.get_binding(Binding::Symbol(symbol), self.file.bound.symbol(symbol).name);
        }
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

    fn take_environment_made_ahead(&mut self, scope: ScopeId) -> Option<LocalVariable> {
        if !self.file.scopes.has_environment(scope) {
            return None;
        }
        let key = VariableKey::EnvironmentMadeAhead(self.file.file);
        let variable = self.file.ensure_variable(key);
        let made = self.builder.get_module_variable(variable);
        let layout = environments::environment_layout(self.file, scope);
        let ty = self.file.fragment.types.intern(Type::environment(layout));
        let variable = self.builder.create_variable(Some(ty));
        self.builder.write_variable(variable, made);
        Some(variable)
    }

    pub(in crate::lower) fn store_environment_made_ahead(&mut self, scope: ScopeId) {
        let entered = self.scopes.entered.last();
        let Some(environment) = entered.and_then(|entered| entered.environment) else {
            return;
        };
        debug_assert!(self.file.scopes.has_environment(scope));
        let made = self.builder.read_variable(environment);
        let key = VariableKey::EnvironmentMadeAhead(self.file.file);
        let variable = self.file.ensure_variable(key);
        self.builder.put_module_variable(variable, made);
    }

    fn allocate_environment(
        &mut self,
        entry: &ScopeEntry<'_>,
        values: &EntryValues,
    ) -> Option<LocalVariable> {
        let variable = self.put_off_environment(entry, values)?;
        self.make_environment_put_off(entry.scope);
        Some(variable)
    }

    fn put_off_environment(
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
            if dead_zone::has_dead_zone(self.file, binding) {
                continue;
            }
            let value = match find_by_key(values, binding).flatten() {
                None if is_born_undefined(binding) => Some(self.builder.undefined()),
                value => value,
            };
            let Some(value) = value else {
                debug_assert!(
                    !self.file.is_listed_at_allocation(binding),
                    "a required field has a value when its scope is entered"
                );
                continue;
            };
            fields.push(field);
            field_values.push(value);
        }
        let ty = self.file.fragment.types.intern(Type::environment(layout));
        let variable = self.builder.create_variable(Some(ty));
        self.scopes.environments_put_off.push(EnvironmentPutOff {
            scope: entry.scope,
            depth: self.scopes.entered.len(),
            variable,
            layout,
            fields,
            values: field_values,
            place: self.builder.place(),
            list: IdList::EMPTY,
        });
        Some(variable)
    }

    pub(super) fn make_environment_put_off(&mut self, scope: ScopeId) {
        let put_off = &mut self.scopes.environments_put_off;
        let Some(index) = put_off.iter().rposition(|it| it.scope == scope) else {
            return;
        };
        let it = put_off.remove(index);
        let object = self.builder.build_at(it.place, |builder| {
            builder.new_object(it.layout, &it.fields, None, &it.values)
        });
        self.builder
            .write_variable_at(it.place, it.variable, object);
    }

    pub(in crate::lower) fn give_list_to_scope(&mut self, scope: ScopeId, list: IdList<StmtId>) {
        for it in &mut self.scopes.environments_put_off {
            if it.scope == scope {
                it.list = list;
            }
        }
    }

    pub(in crate::lower) fn move_environments_put_off(&mut self, position: u32) {
        for it in &mut self.scopes.environments_put_off {
            if position.wrapping_sub(it.list.start) < it.list.len {
                it.place = self.builder.place();
            }
        }
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
    if let Some(value) = entry.find_initial(binding) {
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
                entry.find_initial(BindingRef::Slot(scope, ScopeSlot::Arguments))
            }
            ScopeSlot::EvalVariables | ScopeSlot::ParameterEvalVariables => {
                let layout = lowering.file.untyped_layout(&[]);
                let head = lowering.builder.new_object(layout, &[], None, &[]);
                let null = lowering.builder.null();
                lowering.builder.set_literal_prototype(head, null, false);
                Some(lowering.builder.finish_object(head))
            }
            _ => None,
        },
    }
}
