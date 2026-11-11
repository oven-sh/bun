use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingKind, Decl, InitialState, ScopeId, ScopeKind, SymbolId};
use bun_sema::hir::{self, ModuleName};
use rustc_hash::FxHashSet;

use crate::ir::ValueId;
use crate::lower::{FunctionLowering, object, scope};

#[derive(Copy, Clone, Debug)]
pub(super) struct Container {
    pub(super) binding: SymbolId,
    pub(super) merged: SymbolId,
    pub(super) name: Atom,
    is_single_declaration: bool,
    ends_dead_zone: bool,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn find_container(&self, declaration: Decl, name: Atom) -> Container {
        let bound = self.file.bound;
        let binding = bound.declared_symbol(declaration);
        let has_dead_zone = bound.binding_kind(binding) == BindingKind::TypeScriptContainer
            && bound.initial_state(binding) == InitialState::Uninitialized;
        let locals = bound.scopes[bound.symbol_scope(binding).idx()].locals;
        let local = bound.lookup(locals, name).unwrap_or(binding);
        let declarations = &bound.symbol(local).decls;
        let first = declarations.iter().find(|&&it| self.produces_code(it));
        let exported = bound.export_symbol_of_value_symbol_if_exported(binding);
        let is_exported = bound.symbol(exported).decls.contains(&declaration);
        let merged = if is_exported { exported } else { binding };
        let is_stored_by_code = [binding, merged].into_iter().any(|variable| {
            !bound.stores_to(variable).is_empty() || bound.is_visible_to_eval(variable)
        });
        Container {
            binding,
            merged,
            name,
            is_single_declaration: declarations.len() == 1
                && bound.symbol(exported).decls.len() == 1
                && !is_stored_by_code
                && !self.is_inside_name_with_two_tables(bound.symbol_scope(binding))
                && !(is_exported && self.is_member_of_container(exported)),
            ends_dead_zone: has_dead_zone && first == Some(&declaration),
        }
    }

    fn is_member_of_container(&self, member: SymbolId) -> bool {
        let bound = self.file.bound;
        let outer = bound.symbol(member).parent;
        outer.is_some() && outer != bound.file_symbol
    }

    fn is_inside_name_with_two_tables(&self, scope: ScopeId) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let parent_of = |scope: &ScopeId| bound.scopes[scope.idx()].parent.some();
        std::iter::successors(scope.some(), parent_of).any(|scope| {
            let ScopeKind::Module(outer) = bound.scopes[scope.idx()].kind else {
                return false;
            };
            let (ModuleName::Ident(name), Some(binding)) = (
                hir[outer].name,
                bound.declared_symbol(Decl::Module(outer)).some(),
            ) else {
                return false;
            };
            self.has_two_tables(binding, name)
        })
    }

    fn has_two_tables(&self, binding: SymbolId, name: Atom) -> bool {
        let known = &self.file.namespaces_with_two_tables;
        if let Some(&has_two) = known.borrow().get(&binding) {
            return has_two;
        }
        let bound = self.file.bound;
        let locals = bound.scopes[bound.symbol_scope(binding).idx()].locals;
        let local = bound.lookup(locals, name).unwrap_or(binding);
        let exported = bound.export_symbol_of_value_symbol_if_exported(binding);
        let has_two = local != exported && {
            let listed: FxHashSet<Decl> = bound.symbol(exported).decls.iter().copied().collect();
            let mut declarations = bound.symbol(local).decls.iter();
            declarations.any(|declaration| !listed.contains(declaration))
        };
        known.borrow_mut().insert(binding, has_two);
        has_two
    }

    fn produces_code(&self, declaration: Decl) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        bound.makes_container_object(hir, declaration)
    }

    pub(super) fn has_single_declaration(&self, container: Container) -> bool {
        container.is_single_declaration
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
            ModuleName::Ident(name) if bound.makes_namespace_object(self.file.hir, declaration) => {
                name
            }
            ModuleName::Ident(_) | ModuleName::String(_) | ModuleName::Global => return,
        };
        let container = self.find_container(Decl::Module(declaration), name);
        let object = self.ensure_container(container);
        let scope = bound.module_scope[declaration.idx()];
        self.enter_container_scope(scope, object);
        self.lower_statements(data.body);
        self.leave_scope(scope);
    }

    fn allocate_container(&mut self, container: Container) -> ValueId {
        let layout = self.file.container_layout(container.merged);
        let builder = self.begin_object(layout);
        object::finish_object(self, builder)
    }
}
