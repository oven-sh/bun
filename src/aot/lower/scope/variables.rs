use bun_sema::atom::{Atom, known};
use bun_sema::bind::{BindingKind, InitialState, SymbolId};
use bun_sema::check::aot::ClassRef;
use bun_sema::program::Sym;

use super::{BindingRef, ScopeSlot, Storage, environments};
use crate::ir::generated::{Variable, VariableFlags, VariableInitialization};
use crate::ir::{ClassSlot, DeclaredType, FunctionKey, Type, TypeTable, VariableId, VariableKey};
use crate::lower::{FileLowering, class, function, module};
use crate::modules::ModuleRef;

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn ensure_variable(&mut self, key: VariableKey) -> VariableId {
        let id = self.fragment.declare_variable(key);
        if key.home_file() != Some(self.file) || self.fragment.is_variable_defined(id) {
            return id;
        }
        let mut variable = match key {
            VariableKey::Symbol(symbol)
                if self.bound.binding_kind(symbol.id) == BindingKind::Import =>
            {
                Variable {
                    flags: VariableFlags::IS_IMMUTABLE,
                    ..self.create_untyped_variable(self.bound.symbol(symbol.id).name)
                }
            }
            VariableKey::Symbol(symbol) => self.create_symbol_variable(symbol.id),
            VariableKey::ClassSlot { class, slot } => self.create_class_slot_variable(class, slot),
            VariableKey::ModulePath { variable, .. } => {
                self.create_untyped_variable(variable.name())
            }
            VariableKey::PrivateState { part, .. } => self.create_private_state_variable(part),
            VariableKey::AddedStatic(property) => {
                let class = self.class_with_added_static(property.id);
                Variable {
                    initialization: VariableInitialization::Uninitialized,
                    owner: Some(self.class_layout(class)),
                    ..self.create_untyped_variable(self.bound.symbol(property.id).name)
                }
            }
            VariableKey::ModuleExports(_) => self.create_untyped_variable(known::exports),
            VariableKey::MockOf(_) => {
                let mut declared = DeclaredType::untyped();
                declared.ty = self.fragment.types.union(declared.ty, TypeTable::ABSENT);
                let mut flags = VariableFlags::IS_REPLACEABLE | VariableFlags::HOLDS_MOCK;
                if self.inputs.modules.originals_beside_mocks_may_run() {
                    flags |= VariableFlags::ORIGINAL_MAY_RUN;
                }
                Variable {
                    name: None,
                    declared,
                    initialization: VariableInitialization::Uninitialized,
                    flags,
                    ..self.create_untyped_variable(known::default)
                }
            }
            VariableKey::InstantiationState(_) => Variable {
                name: None,
                flags: match self.inputs.modules.has_instances(self.file) {
                    true => VariableFlags::IS_REPLACEABLE | VariableFlags::GUARDS_INSTANCE,
                    false => VariableFlags::default(),
                },
                ..self.create_untyped_variable(known::default)
            },
            VariableKey::EvaluationMark(_) => Variable {
                name: None,
                flags: VariableFlags::MARKS_EVALUATION,
                ..self.create_untyped_variable(known::default)
            },
            VariableKey::EnvironmentMadeAhead(_) => {
                let scope = module::file_scope(self);
                let layout = environments::environment_layout(self, scope);
                let ty = self.fragment.types.intern(Type::environment(layout));
                Variable {
                    name: None,
                    declared: DeclaredType::from_compiler(ty),
                    initialization: VariableInitialization::Uninitialized,
                    ..self.create_untyped_variable(known::default)
                }
            }
            VariableKey::InstanceOf(_) => {
                let layout = environments::instance_layout(self);
                let ty = self.fragment.types.intern(Type::environment(layout));
                Variable {
                    name: None,
                    declared: DeclaredType::from_compiler(ty),
                    initialization: VariableInitialization::Uninitialized,
                    flags: VariableFlags::HOLDS_INSTANCE,
                    ..self.create_untyped_variable(known::default)
                }
            }
            VariableKey::InstanceAllocator(file) => {
                let allocation = self.reference_function(FunctionKey::Instantiation(file));
                Variable {
                    name: None,
                    initialization: VariableInitialization::Function,
                    function: Some(allocation),
                    flags: VariableFlags::IS_REPLACEABLE | VariableFlags::ALLOCATES_INSTANCE,
                    ..self.create_untyped_variable(known::default)
                }
            }
            VariableKey::PrototypeMaker(variable) => {
                let maker = self.declare_prototype_maker(variable.id);
                let ty = self.fragment.types.intern(Type::function(maker));
                Variable {
                    name: None,
                    declared: DeclaredType::from_compiler(ty),
                    initialization: VariableInitialization::Function,
                    function: Some(maker),
                    flags: VariableFlags::IS_IMMUTABLE,
                    ..self.create_untyped_variable(known::default)
                }
            }
            VariableKey::HasSeveralInstances(_) => Variable {
                name: None,
                flags: VariableFlags::IS_REPLACEABLE | VariableFlags::HAS_SEVERAL_INSTANCES,
                ..self.create_untyped_variable(known::default)
            },
            VariableKey::RequiredAnswer(_)
            | VariableKey::RequiresMadeForOwnFile(_)
            | VariableKey::RequiresMadeForOtherFolders(_)
            | VariableKey::RequiresMadeForPaths(_) => {
                let mut declared = DeclaredType::untyped();
                declared.ty = self.fragment.types.union(declared.ty, TypeTable::ABSENT);
                Variable {
                    declared,
                    initialization: VariableInitialization::Uninitialized,
                    ..self.create_untyped_variable(known::default)
                }
            }
            VariableKey::InnerModuleExports(callback) => {
                let module = self.fragment.declare_module(ModuleRef::Inner {
                    file: callback.file,
                    callback: callback.function,
                });
                Variable {
                    module,
                    ..self.create_untyped_variable(known::exports)
                }
            }
            VariableKey::SyntheticExport(_)
            | VariableKey::Copy(_)
            | VariableKey::MockOfRuntimeModule(_) => {
                unreachable!("link defines the variable of an export")
            }
        };
        variable.place = Some(self.place_in_source_of(key));
        let is_defined_reentrantly = self.fragment.is_variable_defined(id);
        if !is_defined_reentrantly {
            self.fragment.define_variable(id, variable);
        }
        id
    }

    fn place_in_source_of(&self, key: VariableKey) -> u32 {
        let one_a_file = self.scopes.number_of_symbols_at_module_level();
        let by_number = |number: usize, part: u32| one_a_file + 16 + 8 * number as u32 + part;
        match key {
            VariableKey::InnerModuleExports(_) => 0,
            VariableKey::ModuleExports(_) => one_a_file,
            VariableKey::MockOf(_) => one_a_file + 1,
            VariableKey::InstantiationState(_) => one_a_file + 2,
            VariableKey::EnvironmentMadeAhead(_) => one_a_file + 3,
            VariableKey::RequiresMadeForOwnFile(_) => one_a_file + 4,
            VariableKey::RequiresMadeForOtherFolders(_) => one_a_file + 5,
            VariableKey::InstanceOf(_) => one_a_file + 14,
            VariableKey::HasSeveralInstances(_) => one_a_file + 13,
            VariableKey::InstanceAllocator(_) => one_a_file + 15,
            VariableKey::ModulePath { variable, .. } => one_a_file + 6 + variable as u32,
            VariableKey::RequiresMadeForPaths(_) => one_a_file + 12,
            VariableKey::EvaluationMark(_) => one_a_file + 11,
            VariableKey::Symbol(symbol) => match self.scopes.place_at_module_level(symbol.id) {
                Some(place) => place,
                None => by_number(symbol.id.idx(), 0),
            },
            VariableKey::RequiredAnswer(holder) => by_number(holder.id.idx(), 1),
            VariableKey::PrototypeMaker(variable) => by_number(variable.id.idx(), 2),
            VariableKey::AddedStatic(property) => by_number(property.id.idx(), 0),
            VariableKey::PrivateState { state, part } => by_number(state.id.idx(), 2 + part as u32),
            VariableKey::ClassSlot { class, slot } => match slot {
                ClassSlot::ClassObject => by_number(class.class.idx(), 4),
                ClassSlot::ClassToken => by_number(class.class.idx(), 5),
                ClassSlot::DecoratorState => by_number(class.class.idx(), 6),
                ClassSlot::ComputedKey(member)
                | ClassSlot::StaticField(member)
                | ClassSlot::PrivateMethod(member) => by_number(member.idx(), 7),
            },
            VariableKey::SyntheticExport(_)
            | VariableKey::Copy(_)
            | VariableKey::MockOfRuntimeModule(_) => {
                unreachable!("link defines the variable of an export")
            }
        }
    }

    fn create_untyped_variable(&mut self, name: Atom) -> Variable {
        Variable {
            name: Some(self.intern_atom(name)),
            module: self.module_id(),
            declared: DeclaredType::untyped(),
            initialization: VariableInitialization::Undefined,
            ..Variable::default()
        }
    }

    pub(super) fn is_export_that_code_fills(&self, symbol: SymbolId) -> bool {
        let placement = self.scopes.placement(BindingRef::Symbol(symbol));
        let (file, id) = (self.file, symbol);
        let is_visible_to_importers = |placement: super::Placement| {
            matches!(
                placement.storage,
                Storage::Variable(_) | Storage::Instance { .. }
            )
        };
        placement.is_some_and(is_visible_to_importers)
            && matches!(self.bound.initial_state(symbol), InitialState::Initialized)
            && self.scopes.initial_function(symbol).is_none()
            && self.is_exported_variable(VariableKey::Symbol(Sym { file, id }))
    }

    fn create_symbol_variable(&mut self, symbol: SymbolId) -> Variable {
        let bound = self.bound;
        let binding = BindingRef::Symbol(symbol);
        let name = self.intern_variable_name(symbol);
        let mut declared = self.location_position(binding);
        let (initialization, function) = match self.scopes.initial_function(symbol) {
            Some(source) => {
                let function = function::declare_source_function(self, source, None);
                (VariableInitialization::Function, Some(function))
            }
            None => match bound.initial_state(symbol) {
                InitialState::Undefined => (VariableInitialization::Undefined, None),
                InitialState::Uninitialized | InitialState::Initialized => {
                    if self.is_export_that_code_fills(symbol) {
                        declared.ty = self.fragment.types.union(declared.ty, TypeTable::ABSENT);
                    }
                    (VariableInitialization::Uninitialized, None)
                }
            },
        };
        Variable {
            name: Some(name),
            module: self.module_id(),
            declared,
            initialization,
            function,
            owner: None,
            flags: self.compute_flags(binding),
            place: None,
        }
    }

    fn create_class_slot_variable(&mut self, class: ClassRef, slot: ClassSlot) -> Variable {
        let scope = self.bound.class_scope[class.class.idx()];
        let binding = BindingRef::Slot(scope, ScopeSlot::Class(slot));
        let declared = self.location_position(binding);
        let owner = match slot {
            ClassSlot::StaticField(member)
                if !class::has_private_static_storage(self.hir, member) =>
            {
                Some(self.class_layout(class))
            }
            _ => None,
        };
        Variable {
            module: self.module_id(),
            declared,
            initialization: VariableInitialization::Uninitialized,
            owner,
            flags: self.compute_flags(binding),
            ..Variable::default()
        }
    }

    fn compute_flags(&self, binding: BindingRef) -> VariableFlags {
        match (self.scopes.placement(binding), binding) {
            (Some(placement), _) if placement.is_immutable => VariableFlags::IS_IMMUTABLE,
            (_, BindingRef::Symbol(symbol)) if self.is_replaceable(symbol) => {
                VariableFlags::IS_REPLACEABLE
            }
            _ => VariableFlags::default(),
        }
    }

    pub(super) fn is_replaceable(&self, id: SymbolId) -> bool {
        let file = self.file;
        self.inputs.modules.is_replaceable(Sym { file, id })
    }
}
