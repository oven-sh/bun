//! Where bindings live and how names find them.

use core::num::NonZeroU32;
use std::rc::Rc;

use bun_engine_syntax::ast::{
    self, Binding, BindingFlags, BindingKind, FunctionId, ScopeFlags, ScopeId,
};
use bun_engine_syntax::{FunctionFlags, Name, NameKind};
use bun_engine_text::Identifier;

use super::intrinsic::Builtin;
use super::{Dest, Generator};
use crate::function::Origin;
use crate::operand::{Operand, Register, ScopeIndex, StaticError, Unresolved};
use crate::scope::{ScopeKind, Slot, SlotFlags, SlotKind, StaticScope};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Place {
    Register(Register),
    Slot {
        scope: Register,
        depth: u32,
        slot: u32,
    },
    Import {
        depth: u32,
        slot: u32,
    },
    /// In the object of `create_direct_arguments`.
    Argument {
        arguments: Register,
        index: u32,
    },
    Global,
    Dynamic,
    /// An `arguments` object that nothing needs.
    Nowhere,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Mutability {
    Mutable,
    Constant,
    Callee,
}

/// What a name refers to at some position.
#[derive(Clone, Copy)]
pub(super) struct Variable {
    pub(super) name: Name,
    pub(super) place: Place,
    pub(super) mutability: Mutability,
    /// It may not be initialized.
    pub(super) is_checked: bool,
    /// A read creates the value. A write need not.
    is_lazy: bool,
}

impl Variable {
    pub(super) fn register(&self) -> Option<Register> {
        match self.place {
            Place::Register(register) => Some(register),
            _ => None,
        }
    }

    /// The register, if a value can go straight into it.
    pub(super) fn writable_register(&self) -> Option<Register> {
        self.register()
            .filter(|_| self.mutability == Mutability::Mutable && !self.is_checked)
    }
}

/// A binding of the code that is being generated.
#[derive(Clone, Copy)]
pub(super) struct Bound {
    name: Name,
    place: Place,
    mutability: Mutability,
    is_lazy: bool,
    flags: BindingFlags,
    initialized_from: u32,
    initialized_until: u32,
    private: Option<Private>,
    shadowed: u32,
    /// The link to the innermost of the name that is not lexical.
    below_lexicals: u32,
}

#[derive(Clone, Copy)]
pub(super) struct Private {
    pub(super) kind: SlotKind,
    pub(super) flags: SlotFlags,
    /// In the same scope.
    pub(super) brand_slot: u32,
}

/// What a name finds outside of the code.
#[derive(Clone, Copy)]
pub(super) struct Outer {
    variable: Variable,
    private: Option<Private>,
    builtin: Option<Builtin>,
}

/// What to restore when a scope ends.
pub(super) struct OpenScope {
    bindings: u32,
    top: u32,
    chain: Option<Rc<StaticScope>>,
    scope: Register,
    barrier: Option<u32>,
}

/// The slots of a scope that is being laid out.
pub(super) struct Layout {
    kind: ScopeKind,
    slots: Vec<Slot>,
    names: Vec<Identifier>,
    count: u32,
    undefined_slots: u32,
    mapped_parameters: u32,
    eval_variables_slot: Option<u32>,
    is_extensible_by_debugger_only: bool,
    body_start: Option<NonZeroU32>,
}

impl Layout {
    pub(super) fn new(kind: ScopeKind) -> Layout {
        Layout {
            kind,
            slots: Vec::new(),
            names: Vec::new(),
            count: 0,
            undefined_slots: 0,
            mapped_parameters: 0,
            eval_variables_slot: None,
            is_extensible_by_debugger_only: false,
            body_start: None,
        }
    }

    pub(super) fn anonymous_slot(&mut self) -> u32 {
        self.count += 1;
        self.count - 1
    }

    pub(super) fn end_mapped_parameters(&mut self) {
        self.mapped_parameters = self.count;
    }

    pub(super) fn end_undefined_slots(&mut self) {
        self.undefined_slots = self.count;
    }

    pub(super) fn make_extensible(&mut self) {
        self.eval_variables_slot = Some(self.anonymous_slot());
    }

    /// The last step for the scope that `var` declares in.
    pub(super) fn prepare_for_debugger(&mut self, body_start: Option<u32>) {
        self.body_start = body_start.and_then(NonZeroU32::new);
        if self.eval_variables_slot.is_none() {
            self.make_extensible();
            self.is_extensible_by_debugger_only = true;
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.count == 0
    }

    pub(super) fn slot_count(&self) -> u32 {
        self.count
    }

    pub(super) fn set_detail_of_last(&mut self, detail: u32) {
        if let Some(slot) = self.slots.last_mut() {
            slot.detail = detail;
        }
    }
}

fn slot_kind(binding: &Binding) -> SlotKind {
    match binding.kind {
        BindingKind::Var | BindingKind::Parameter | BindingKind::Arguments => SlotKind::Variable,
        BindingKind::Callee => SlotKind::Callee,
        BindingKind::Internal if binding.name == Name::IMPORT_META => SlotKind::ImportMeta,
        BindingKind::Internal => SlotKind::Internal,
        BindingKind::Let | BindingKind::LexicalFunction => SlotKind::Let,
        BindingKind::Const
        | BindingKind::Using
        | BindingKind::AwaitUsing
        | BindingKind::ImportNamespace => SlotKind::Const,
        BindingKind::Import => SlotKind::Import,
        BindingKind::PrivateField => SlotKind::PrivateField,
        BindingKind::PrivateMethod => SlotKind::PrivateMethod,
        BindingKind::PrivateAccessor => SlotKind::PrivateAccessor,
    }
}

fn slot_flags(binding: &Binding) -> SlotFlags {
    let has = |flag| binding.flags.contains(flag);
    let starts_undefined = has(BindingFlags::STARTS_UNDEFINED)
        || (binding.kind == BindingKind::Var && !has(BindingFlags::FUNCTION));
    let is_writable = matches!(slot_kind(binding), SlotKind::Variable | SlotKind::Let);
    let mut flags = SlotFlags::empty();
    flags.set(
        SlotFlags::IMMUTABLE,
        !is_writable || !has(BindingFlags::WRITTEN),
    );
    flags.set(
        SlotFlags::WRITTEN_ONCE,
        starts_undefined && !has(BindingFlags::REWRITTEN),
    );
    flags.set(SlotFlags::LEXICAL, binding.kind.is_lexical());
    flags.set(SlotFlags::EXPORTED, has(BindingFlags::EXPORTED));
    flags.set(SlotFlags::STATIC, has(BindingFlags::STATIC));
    flags.set(SlotFlags::HAS_GETTER, has(BindingFlags::HAS_GETTER));
    flags.set(SlotFlags::HAS_SETTER, has(BindingFlags::HAS_SETTER));
    flags.set(
        SlotFlags::PARAMETER,
        matches!(
            binding.kind,
            BindingKind::Parameter | BindingKind::Arguments
        ),
    );
    flags
}

fn mutability(kind: SlotKind) -> Mutability {
    match kind {
        SlotKind::Callee => Mutability::Callee,
        SlotKind::Const | SlotKind::Import => Mutability::Constant,
        _ => Mutability::Mutable,
    }
}

impl Generator<'_> {
    // Laying out and entering scopes

    pub(super) fn add_slot(&mut self, layout: &mut Layout, binding: &Binding) -> u32 {
        let (name, kind) = (binding.name, slot_kind(binding));
        let names = &self.ast.names;
        let in_source = names.source_start(name);
        let (hash, name_start, name_length) = if Name::known_text(name.index()).is_some() {
            (self.text_of(name).hash(), name.index() as u32, Slot::KNOWN)
        } else if let Some(start) = in_source.filter(|_| names.kind(name) == NameKind::Ordinary) {
            (self.text_of(name).hash(), start, names.length(name))
        } else {
            let identifier = self.make_identifier(name);
            let hash = identifier.name().hash();
            layout.names.push(identifier);
            (hash, layout.names.len() as u32 - 1, Slot::OWNED)
        };
        let mut flags = slot_flags(binding);
        if layout.kind == ScopeKind::Parameters {
            flags |= SlotFlags::LEXICAL;
        }
        let index = layout.anonymous_slot();
        if matches!(kind, SlotKind::Import | SlotKind::PrivateAccessor) {
            layout.anonymous_slot();
        }
        layout.slots.push(Slot {
            hash,
            name_start,
            name_length,
            index,
            detail: if binding.initialized_until == u32::MAX {
                binding.initialized_from
            } else {
                u32::MAX
            },
            kind,
            flags,
        });
        index
    }

    pub(super) fn add_lazy_function_slot(
        &mut self,
        layout: &mut Layout,
        binding: &Binding,
        function: u32,
    ) -> u32 {
        let index = self.add_slot(layout, binding);
        if let Some(slot) = layout.slots.last_mut() {
            (slot.kind, slot.detail) = (SlotKind::LazyFunction, function);
        }
        index
    }

    pub(super) fn is_chain_outer(&self) -> bool {
        match (&self.chain, &self.outer) {
            (Some(chain), Some(outer)) => Rc::ptr_eq(chain, outer),
            (chain, _) => chain.is_none(),
        }
    }

    /// Makes the scope the innermost one, held by `register`.
    pub(super) fn chain_scope(&mut self, layout: Layout, register: Register) -> Rc<StaticScope> {
        let entered_at = self.is_chain_outer().then_some(self.created_at);
        let scope = Rc::new(StaticScope {
            parent: self.chain.take(),
            kind: layout.kind,
            eval_variables_slot: layout.eval_variables_slot,
            is_extensible_by_debugger_only: layout.is_extensible_by_debugger_only,
            body_start: layout.body_start,
            entered_at,
            slot_count: layout.count,
            undefined_slots: layout.undefined_slots,
            mapped_parameters: layout.mapped_parameters,
            table: StaticScope::table_for(&layout.slots),
            slots: layout.slots.into(),
            source: self.source.clone(),
            names: layout.names.into(),
        });
        self.chain = Some(Rc::clone(&scope));
        self.scope = register;
        scope
    }

    fn add_scope(&mut self, scope: Rc<StaticScope>) -> ScopeIndex {
        self.b.scopes.push(scope);
        ScopeIndex(self.b.scopes.len() as u32 - 1)
    }

    pub(super) fn create_scope(&mut self, layout: Layout, register: Register) -> ScopeIndex {
        let parent = self.scope;
        let scope = self.chain_scope(layout, register);
        let index = self.add_scope(scope);
        self.asm().create_scope(register, parent, index);
        self.show_scope(register);
        index
    }

    /// Tells a debugger where the innermost scope is from here on.
    #[inline]
    pub(super) fn show_scope(&mut self, register: Register) {
        if self.debugs {
            self.asm().set_scope_register(register);
        }
    }

    /// After a `resume`: a debugger may look at a scope that the code does not use again.
    #[cold]
    pub(super) fn keep_scopes(&mut self) {
        let innermost = self.scope;
        self.asm().mov(innermost, innermost);
        for index in 0..self.b.open_scopes.len() {
            let outer = self.b.open_scopes[index].scope;
            self.asm().mov(outer, outer);
        }
    }

    /// Whether the code uses it again or not. It has just been initialized.
    #[cold]
    pub(super) fn keep_binding(&mut self, name: Name, register: Register) {
        let index = self.state(name).binding - 1;
        if self.b.bindings[index as usize].initialized_until == u32::MAX {
            self.b.kept_bindings.push((index, register));
        }
    }

    pub(super) fn open_scope(&mut self) {
        self.b.open_scopes.push(OpenScope {
            bindings: self.b.bindings.len() as u32,
            top: self.top,
            chain: self.chain.clone(),
            scope: self.scope,
            barrier: self.barrier,
        });
    }

    pub(super) fn close_scope(&mut self) {
        let Some(open) = self.b.open_scopes.pop() else {
            return;
        };
        for index in (open.bindings as usize..self.b.bindings.len()).rev() {
            let bound = self.b.bindings[index];
            self.state(bound.name).binding = bound.shadowed;
            if let Place::Register(register) = bound.place {
                self.untrack_allocation(register);
            }
        }
        self.b.bindings.truncate(open.bindings as usize);
        self.b.kept_bindings.retain(|it| it.0 < open.bindings);
        self.top = open.top;
        self.chain = open.chain;
        if self.scope != open.scope {
            self.scope = open.scope;
            self.show_scope(open.scope);
        }
        self.barrier = open.barrier;
    }

    pub(super) fn bind(&mut self, binding: &Binding, place: Place) {
        let link = self.b.bindings.len() as u32 + 1;
        let shadowed = core::mem::replace(&mut self.state(binding.name).binding, link);
        let kind = slot_kind(binding);
        let below_lexicals = match shadowed {
            _ if !binding.kind.is_lexical() => link,
            0 => 0,
            _ => self.b.bindings[shadowed as usize - 1].below_lexicals,
        };
        self.b.bindings.push(Bound {
            name: binding.name,
            place,
            mutability: mutability(kind),
            is_lazy: kind == SlotKind::ImportMeta,
            flags: binding.flags,
            initialized_from: binding.initialized_from,
            initialized_until: binding.initialized_until,
            private: None,
            shadowed,
            below_lexicals,
        });
    }

    pub(super) fn bind_slot(&mut self, binding: &Binding, scope: Register, slot: u32) {
        let place = Place::Slot {
            scope,
            depth: 0,
            slot,
        };
        self.bind(binding, place);
    }

    pub(super) fn make_last_binding_lazy(&mut self) {
        if let Some(bound) = self.b.bindings.last_mut() {
            bound.is_lazy = true;
        }
    }

    pub(super) fn bind_register(&mut self, binding: &Binding) -> Register {
        let register = self.temp();
        self.bind(binding, Place::Register(register));
        if binding.flags.contains(BindingFlags::USED_EARLY) && binding.initialized_from != 0 {
            let empty = self.empty();
            self.asm().mov(register, empty);
        }
        register
    }

    /// The private names among the bindings from `first` on learn where the brands of their class are.
    pub(super) fn describe_private_names(&mut self, first: usize) {
        let Some(scope) = self.chain.clone() else {
            return;
        };
        for index in first..self.b.bindings.len() {
            if let Place::Slot { slot, .. } = self.b.bindings[index].place
                && let Some(slot) = scope.slot_at(slot)
            {
                self.b.bindings[index].private = self.private_of(&scope, slot);
            }
        }
    }

    /// A block, or the like. Ends with [`Generator::close_scope`]. Returns what it creates, if anything.
    pub(super) fn enter_block_scope(&mut self, id: ScopeId) -> Option<ScopeIndex> {
        self.enter_lexical_scope(id, ScopeKind::Block)
    }

    pub(super) fn enter_catch_scope(&mut self, id: ScopeId) {
        let kind = match self.ast[id].kind {
            ast::ScopeKind::SimpleCatch => ScopeKind::SimpleCatch,
            _ => ScopeKind::Catch,
        };
        self.enter_lexical_scope(id, kind);
    }

    fn enter_lexical_scope(&mut self, id: ScopeId, kind: ScopeKind) -> Option<ScopeIndex> {
        let ast = self.ast;
        let scope = &ast[id];
        self.open_scope();
        let mut created = None;
        if scope.flags.contains(ScopeFlags::HAS_CAPTURED) {
            let register = self.temp();
            let mut layout = Layout::new(kind);
            for binding in ast.bindings(id) {
                if binding.flags.contains(BindingFlags::CAPTURED) {
                    let slot = self.add_slot(&mut layout, binding);
                    self.bind_slot(binding, register, slot);
                }
            }
            created = Some(self.create_scope(layout, register));
        }
        for binding in ast.bindings(id) {
            if !binding.flags.contains(BindingFlags::CAPTURED) {
                self.bind_register(binding);
            }
        }
        self.instantiate_functions(id);
        created
    }

    #[inline(never)]
    pub(super) fn enter_with_scope(&mut self, object: Operand) {
        self.open_scope();
        let (parent, register) = (self.scope, self.temp());
        let scope = self.chain_scope(Layout::new(ScopeKind::With), register);
        let index = self.add_scope(scope);
        self.asm()
            .create_with_scope(register, parent, index, object);
        self.show_scope(register);
        self.raise_barrier();
    }

    /// From here on only a search at run time finds what has been bound so far.
    pub(super) fn raise_barrier(&mut self) {
        self.barrier = Some(self.b.bindings.len() as u32);
    }

    pub(super) fn declared_name(&self, function: FunctionId) -> Name {
        self.ast[function].own_name.unwrap_or(Name::DEFAULT_EXPORT)
    }

    /// But for those that nothing refers to or that are created on demand.
    pub(super) fn instantiate_functions(&mut self, id: ScopeId) {
        let ast = self.ast;
        let mark = self.top;
        for function in ast.iter(ast[id].functions) {
            let name = self.declared_name(function);
            let link = self.state(name).binding;
            let bound = self.b.bindings[link as usize - 1];
            let is_hoisted = (ast[function].flags).contains(FunctionFlags::HOISTED_AS_VARIABLE);
            let is_used = bound.flags.contains(BindingFlags::USED);
            if bound.is_lazy || !(is_used || is_hoisted || self.covers) {
                continue;
            }
            let register = match bound.place {
                Place::Register(register) => register,
                _ => self.temp(),
            };
            self.new_function(register, function, ast[id].start);
            self.put(bound.place, name, None, register.into());
            self.top = mark;
        }
    }

    // Finding bindings

    #[inline]
    pub(super) fn resolve(&mut self, name: Name, position: u32) -> Variable {
        let link = self.state(name).binding;
        if let Some(barrier) = self.barrier
            && link <= barrier
            && !name.is_internal()
        {
            return Variable {
                name,
                place: Place::Dynamic,
                mutability: Mutability::Mutable,
                is_checked: false,
                is_lazy: false,
            };
        }
        if link == 0 {
            return self.outer(name).variable;
        }
        let bound = &self.b.bindings[link as usize - 1];
        Variable {
            name,
            place: bound.place,
            mutability: bound.mutability,
            is_checked: position < bound.initialized_from || position >= bound.initialized_until,
            is_lazy: bound.is_lazy,
        }
    }

    /// For the declaration that initializes a lexical binding.
    pub(super) fn resolve_declared(&mut self, name: Name) -> Place {
        match self.state(name).binding {
            0 => Place::Global,
            link => self.b.bindings[link as usize - 1].place,
        }
    }

    /// Of the binding that is not lexical, which one that is may shadow.
    pub(super) fn place_below_lexicals(&mut self, name: Name) -> Place {
        let link = self.state(name).binding;
        let bound = |link: u32| self.b.bindings.get((link as usize).wrapping_sub(1));
        let below = bound(link).and_then(|it| bound(it.below_lexicals));
        below.map_or(Place::Global, |it| it.place)
    }

    pub(super) fn is_used_early(&mut self, name: Name) -> bool {
        let link = self.state(name).binding;
        let bound = self.b.bindings.get((link as usize).wrapping_sub(1));
        bound.is_some_and(|it| it.flags.contains(BindingFlags::USED_EARLY))
    }

    pub(super) fn resolve_private(&mut self, name: Name) -> Option<(Place, Private)> {
        match self.state(name).binding {
            0 => {
                let outer = self.outer(name);
                Some((outer.variable.place, outer.private?))
            }
            link => {
                let bound = &self.b.bindings[link as usize - 1];
                Some((bound.place, bound.private?))
            }
        }
    }

    /// A name of the engine, in the scopes around the code.
    pub(super) fn resolve_outer_internal(&mut self, name: Name) -> Option<Place> {
        let place = self.outer(name).variable.place;
        matches!(place, Place::Slot { .. }).then_some(place)
    }

    pub(super) fn builtin(&mut self, name: Name) -> Option<Builtin> {
        match self.ast.names.kind(name) {
            NameKind::Private => self.outer(name).builtin,
            _ => None,
        }
    }

    #[inline]
    fn outer(&mut self, name: Name) -> Outer {
        match self.state(name).outer {
            0 => self.find_outer(name),
            link => self.b.outers[link as usize - 1],
        }
    }

    fn find_outer(&mut self, name: Name) -> Outer {
        let kind = self.ast.names.kind(name);
        let symbol = (kind != NameKind::Ordinary).then(|| self.make_identifier(name));
        let mut outer = Outer {
            variable: Variable {
                name,
                place: Place::Global,
                mutability: Mutability::Mutable,
                is_checked: false,
                is_lazy: false,
            },
            private: None,
            builtin: symbol.as_ref().and_then(|it| self.find_builtin(it.name())),
        };
        if outer.builtin.is_none() && self.outer.is_some() {
            self.walk_outer_scopes(&mut outer, symbol.as_ref());
        }
        self.b.outers.push(outer);
        self.state(name).outer = self.b.outers.len() as u32;
        outer
    }

    fn walk_outer_scopes(&self, outer: &mut Outer, symbol: Option<&Identifier>) {
        let name = outer.variable.name;
        let text = self.text_of(name);
        let hash = text.hash();
        let is_internal = name.is_internal();
        let is_static = is_internal || text.get(0) == Some(u16::from(b'#'));
        let (mut depth, mut position) = (self.outer_depth, self.created_at);
        let mut next = self.outer.as_deref();
        while let Some(scope) = next {
            let found = match symbol {
                Some(symbol) => scope.find(symbol.name()),
                None => scope.find_text(text, hash, is_internal),
            };
            if let Some(slot) = found {
                let is_lazy = matches!(slot.kind, SlotKind::LazyFunction | SlotKind::ImportMeta);
                outer.variable.place = match slot.kind {
                    SlotKind::Import => Place::Import {
                        depth,
                        slot: slot.index,
                    },
                    _ => Place::Slot {
                        scope: Register::SCOPE,
                        depth,
                        slot: slot.index,
                    },
                };
                outer.variable.mutability = mutability(slot.kind);
                // A debugger stops where no code of the program could see the variable.
                outer.variable.is_checked =
                    !is_lazy && (position < slot.detail || self.origin.contains(Origin::DEBUGGER));
                outer.variable.is_lazy = is_lazy;
                outer.private = self.private_of(scope, slot);
                return;
            }
            let is_extensible = scope.eval_variables_slot.is_some()
                && (!scope.is_extensible_by_debugger_only
                    || self.origin.contains(Origin::DEBUGGER));
            if !is_static && (scope.kind == ScopeKind::With || is_extensible) {
                outer.variable.place = Place::Dynamic;
                return;
            }
            position = scope.entered_at.unwrap_or(position);
            depth += 1;
            next = scope.parent.as_deref();
        }
    }

    fn private_of(&self, scope: &StaticScope, slot: &Slot) -> Option<Private> {
        let brand_slot = match slot.kind {
            SlotKind::PrivateField => 0,
            SlotKind::PrivateMethod | SlotKind::PrivateAccessor => {
                let brand = self.text_of(if slot.flags.contains(SlotFlags::STATIC) {
                    Name::CLASS_STATIC_HOME
                } else {
                    Name::CLASS_BRAND
                });
                scope.find_text(brand, brand.hash(), true)?.index
            }
            _ => return None,
        };
        Some(Private {
            kind: slot.kind,
            flags: slot.flags,
            brand_slot,
        })
    }

    pub(super) fn is_in_module(&self) -> bool {
        core::iter::successors(self.outer.as_deref(), |scope| scope.parent.as_deref())
            .any(|scope| scope.kind == ScopeKind::Module)
    }

    // Reading and writing

    /// The first step of an access: what has to be found before anything else is evaluated.
    pub(super) fn holder(&mut self, variable: &Variable) -> Option<Register> {
        (variable.place == Place::Dynamic).then(|| self.resolve_dynamic(variable.name))
    }

    fn resolve_dynamic(&mut self, name: Name) -> Register {
        // Parameters do not see what the body has in the scope that they share.
        let scope = self.barrier.map_or(Register::SCOPE, |_| self.scope);
        let (holder, name) = (self.temp(), self.identifier(name));
        self.asm().resolve_dynamic(holder, scope, name);
        holder
    }

    pub(super) fn load(
        &mut self,
        variable: &Variable,
        holder: Option<Register>,
        dst: Dest,
        unresolved: Unresolved,
    ) -> Operand {
        if let Place::Register(register) = variable.place {
            self.check_initialized(variable);
            return self.deliver(dst, register);
        }
        let dst = self.final_dst(dst);
        let is_checked = variable.is_checked || variable.is_lazy;
        match variable.place {
            Place::Register(_) => {}
            Place::Nowhere => {
                let undefined = self.undefined();
                self.asm().mov(dst, undefined);
            }
            Place::Slot { scope, depth, slot } => match (depth, is_checked) {
                (0, false) => self.asm().get_scoped(dst, scope, slot),
                (0, true) => self.asm().get_scoped_checked(dst, scope, slot),
                (_, false) => self.asm().get_outer(dst, scope, depth, slot),
                (_, true) => self.asm().get_outer_checked(dst, scope, depth, slot),
            },
            Place::Import { depth, slot } => {
                self.asm().get_import(dst, Register::SCOPE, depth, slot);
            }
            Place::Argument { arguments, index } => {
                self.asm().get_from_arguments(dst, arguments, index);
            }
            Place::Global => {
                let name = self.identifier(variable.name);
                self.asm().get_global(dst, name, unresolved);
            }
            Place::Dynamic => {
                let holder = holder.unwrap_or_else(|| self.resolve_dynamic(variable.name));
                let (name, strict) = (self.identifier(variable.name), self.is_strict);
                self.asm()
                    .get_dynamic(dst, holder, name, unresolved, strict);
            }
        }
        dst.into()
    }

    pub(super) fn check_initialized(&mut self, variable: &Variable) {
        if !variable.is_checked {
            return;
        }
        if let Place::Register(register) = variable.place {
            let name = self.identifier(variable.name);
            self.asm().check_initialized(register, name);
        } else {
            let mark = self.top;
            self.load(variable, None, Dest::Any, Unresolved::Throw);
            self.top = mark;
        }
    }

    /// PutValue. `is_loaded` says that the binding has just been read, and so is initialized.
    pub(super) fn store(
        &mut self,
        variable: &Variable,
        holder: Option<Register>,
        value: Operand,
        is_loaded: bool,
    ) {
        if !is_loaded {
            self.check_initialized(variable);
        }
        match variable.mutability {
            Mutability::Mutable => self.put(variable.place, variable.name, holder, value),
            Mutability::Callee if !self.is_strict => {}
            _ => self.throw_static(StaticError::AssignToConstant),
        }
    }

    pub(super) fn put(
        &mut self,
        place: Place,
        name: Name,
        holder: Option<Register>,
        value: Operand,
    ) {
        match place {
            Place::Register(register) => self.mov(register, value),
            Place::Slot {
                scope,
                depth: 0,
                slot,
            } => self.asm().put_scoped(scope, slot, value),
            Place::Slot { scope, depth, slot } => self.asm().put_outer(scope, depth, slot, value),
            Place::Import { .. } | Place::Nowhere => {}
            Place::Argument { arguments, index } => {
                self.asm().put_to_arguments(arguments, index, value);
            }
            Place::Global => {
                let (name, strict) = (self.identifier(name), self.is_strict);
                self.asm().put_global(name, value, strict);
            }
            Place::Dynamic => {
                let holder = holder.unwrap_or_else(|| self.resolve_dynamic(name));
                let (name, strict) = (self.identifier(name), self.is_strict);
                self.asm().put_dynamic(holder, name, value, strict);
            }
        }
    }

    pub(super) fn initialize(&mut self, name: Name, value: Operand) {
        match self.resolve_declared(name) {
            Place::Global => {
                let name = self.identifier(name);
                self.asm().initialize_global(name, value);
            }
            place => self.put(place, name, None, value),
        }
    }

    /// Slot `slot` of the scope that `place` is in.
    pub(super) fn load_internal_beside(&mut self, place: Place, slot: u32) -> Register {
        let dst = self.temp();
        if let Place::Slot { scope, depth, .. } = place {
            self.asm().get_internal(dst, scope, depth, slot);
        }
        dst
    }

    pub(super) fn load_internal(&mut self, place: Place, dst: Register) {
        if let Place::Slot { scope, depth, slot } = place {
            self.asm().get_internal(dst, scope, depth, slot);
        }
    }

    /// The slot of a name of the engine that the code binds itself.
    pub(super) fn own_internal(&mut self, name: Name) -> Option<Place> {
        match self.state(name).binding {
            0 => None,
            link => Some(self.b.bindings[link as usize - 1].place),
        }
    }
}
