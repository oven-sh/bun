use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingKind, Decl, InitialState, ModuleInstanceState, SymbolId};
use bun_sema::hir::{self, Flags, ModuleName};

use crate::ir::ValueId;
use crate::lower::{FunctionLowering, object, scope};

#[derive(Copy, Clone, Debug)]
pub(super) struct Container {
    pub(super) binding: SymbolId,
    pub(super) merged: SymbolId,
    pub(super) name: Atom,
    ends_dead_zone: bool,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn find_container(&self, declaration: Decl, name: Atom) -> Container {
        let bound = self.file.bound;
        let binding = bound.declared_symbol(declaration);
        // Each block of a namespace has a binding of its own for what it exports, and a class or a function that a namespace merges with is the binding.
        let has_dead_zone = bound.binding_kind(binding) == BindingKind::TypeScriptContainer
            && bound.initial_state(binding) == InitialState::Uninitialized;
        let mut declarations = bound.symbol(binding).decls.iter().copied();
        let first = declarations.find(|&it| self.produces_code(it));
        Container {
            binding,
            merged: bound.export_symbol_of_value_symbol_if_exported(binding),
            name,
            ends_dead_zone: has_dead_zone && first == Some(declaration),
        }
    }

    fn produces_code(&self, declaration: Decl) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        match declaration {
            Decl::Enum(it) => !hir[it].flags.contains(Flags::AMBIENT),
            Decl::Module(it) => {
                !hir[it].flags.contains(Flags::AMBIENT)
                    && bound.module_instance_state[it.idx()] != ModuleInstanceState::NonInstantiated
            }
            _ => false,
        }
    }

    pub(super) fn has_single_declaration(&self, container: Container) -> bool {
        self.file.bound.symbol(container.merged).decls.len() == 1
    }

    pub(super) fn initialize_container(&mut self, container: Container, created: ValueId) {
        if container.merged != container.binding {
            let merged = Binding::Symbol(container.merged);
            scope::initialize_binding(self, merged, container.name, created);
        }
        let binding = Binding::Symbol(container.binding);
        scope::initialize_binding(self, binding, container.name, created);
    }

    pub(super) fn ensure_container(&mut self, container: Container) -> ValueId {
        if self.has_single_declaration(container) {
            let created = self.allocate_container(container);
            self.initialize_container(container, created);
            return created;
        }
        let merged = Binding::Symbol(container.merged);
        if container.ends_dead_zone && container.merged == container.binding {
            let undefined = self.builder.undefined();
            scope::initialize_binding(self, merged, container.name, undefined);
        }
        let current = self.get_binding(merged, container.name);
        let join = self.create_block();
        let object = self.builder.add_parameter(join, None);
        let split = self.split_on_truthiness(current);

        self.builder.switch_to(split.taken);
        self.jump_with(join, &[split.taken_value]);

        self.builder.switch_to(split.not_taken);
        let created = self.allocate_container(container);
        scope::set_binding(self, merged, container.name, created);
        self.jump_with(join, &[created]);

        self.continue_in(join);
        if container.merged != container.binding {
            let binding = Binding::Symbol(container.binding);
            match container.ends_dead_zone {
                true => scope::initialize_binding(self, binding, container.name, object),
                false => scope::set_binding(self, binding, container.name, object),
            }
        }
        object
    }

    pub(crate) fn lower_namespace(&mut self, declaration: hir::ModuleId) {
        let bound = self.file.bound;
        let data = self.file.hir[declaration];
        let name = match data.name {
            ModuleName::Ident(name) => name,
            ModuleName::String(_) | ModuleName::Global => return,
        };
        if data.flags.contains(Flags::AMBIENT) {
            return;
        }
        match bound.module_instance_state[declaration.idx()] {
            ModuleInstanceState::NonInstantiated => return,
            ModuleInstanceState::Instantiated | ModuleInstanceState::ConstEnumOnly => {}
        }
        let container = self.find_container(Decl::Module(declaration), name);
        self.ensure_container(container);
        let scope = bound.module_scope[declaration.idx()];
        self.enter_scope(scope);
        self.lower_statements(data.body);
        self.leave_scope(scope);
    }

    fn allocate_container(&mut self, container: Container) -> ValueId {
        let layout = self.file.container_layout(container.merged);
        let builder = self.begin_object(layout);
        object::finish_object(self, builder)
    }
}
