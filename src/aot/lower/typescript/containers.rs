use bun_sema::atom::Atom;
use bun_sema::bind::{
    Binding, BindingKind, Decl, InitialState, ModuleInstanceState, SymbolId,
};
use bun_sema::hir::{self, Flags, ModuleName};

use crate::ir::ValueId;
use crate::lower::{FunctionLowering, condition, layouts, object, scope, statement};

#[derive(Copy, Clone, Debug)]
pub(super) struct Container {
    pub(super) binding: SymbolId,
    pub(super) merged: SymbolId,
    pub(super) name: Atom,
    ends_dead_zone: bool,
}

pub(super) fn find_container(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    declaration: Decl,
    name: Atom,
) -> Container {
    let bound = lowering.file.bound;
    let binding = bound.declared_symbol(declaration);
    // Each block of a namespace has a binding of its own for what it exports, and a class or a function that a namespace merges with is the binding.
    let has_dead_zone = bound.binding_kind(binding) == BindingKind::TypeScriptContainer
        && bound.initial_state(binding) == InitialState::Uninitialized;
    let mut declarations = bound.symbol(binding).decls.iter().copied();
    let first = declarations.find(|&it| produces_code(lowering, it));
    Container {
        binding,
        merged: bound.export_symbol_of_value_symbol_if_exported(binding),
        name,
        ends_dead_zone: has_dead_zone && first == Some(declaration),
    }
}

fn produces_code(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, declaration: Decl) -> bool {
    let (hir, bound) = (lowering.file.hir, lowering.file.bound);
    match declaration {
        Decl::Enum(it) => !hir[it].flags.contains(Flags::AMBIENT),
        Decl::Module(it) => {
            !hir[it].flags.contains(Flags::AMBIENT)
                && bound.module_instance_state[it.idx()] != ModuleInstanceState::NonInstantiated
        }
        _ => false,
    }
}

pub(super) fn has_single_declaration(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    container: Container,
) -> bool {
    lowering.file.bound.symbol(container.merged).decls.len() == 1
}

pub(super) fn initialize_container(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    container: Container,
    created: ValueId,
) {
    if container.merged != container.binding {
        let merged = Binding::Symbol(container.merged);
        scope::initialize_binding(lowering, merged, container.name, created);
    }
    let binding = Binding::Symbol(container.binding);
    scope::initialize_binding(lowering, binding, container.name, created);
}

pub(super) fn ensure_container(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    container: Container,
) -> ValueId {
    if has_single_declaration(lowering, container) {
        let created = allocate_container(lowering, container);
        initialize_container(lowering, container, created);
        return created;
    }
    let merged = Binding::Symbol(container.merged);
    if container.ends_dead_zone && container.merged == container.binding {
        let undefined = lowering.builder.undefined();
        scope::initialize_binding(lowering, merged, container.name, undefined);
    }
    let current = scope::get_binding(lowering, merged, container.name);
    let join = lowering.create_block();
    let object = lowering.builder.add_parameter(join, None);
    let split = condition::split_on_truthiness(lowering, current);

    lowering.builder.switch_to(split.taken);
    lowering.jump_with(join, &[split.taken_value]);

    lowering.builder.switch_to(split.not_taken);
    let created = allocate_container(lowering, container);
    scope::set_binding(lowering, merged, container.name, created);
    lowering.jump_with(join, &[created]);

    lowering.continue_in(join);
    if container.merged != container.binding {
        let binding = Binding::Symbol(container.binding);
        match container.ends_dead_zone {
            true => scope::initialize_binding(lowering, binding, container.name, object),
            false => scope::set_binding(lowering, binding, container.name, object),
        }
    }
    object
}

pub(super) fn lower_namespace(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    declaration: hir::ModuleId,
) {
    let bound = lowering.file.bound;
    let data = lowering.file.hir[declaration];
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
    let container = find_container(lowering, Decl::Module(declaration), name);
    ensure_container(lowering, container);
    let scope = bound.module_scope[declaration.idx()];
    scope::enter_scope(lowering, scope);
    statement::lower_statements(lowering, data.body);
    scope::leave_scope(lowering, scope);
}

fn allocate_container(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    container: Container,
) -> ValueId {
    let layout = layouts::container_layout(lowering.file, container.merged);
    let builder = object::begin_object(lowering, layout);
    object::finish_object(lowering, builder)
}
