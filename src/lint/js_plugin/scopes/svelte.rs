//! A component's scopes as svelte-eslint-parser's scope manager has them, built from the [variable
//! view](crate::ast::svelte::variables) and the program's scopes.
//!
//! - A scope the lowering opens for a component node has that node as its `block`: the `{#each}`, the `{#snippet}`, the
//!   `{:then}`. The wrapper it opens around an `{:else if}` isn't a scope, and its contents are in the enclosing scope.
//!   A `{:then}` or `{:catch}` without a parameter is a block, not a function.
//! - The scopes and references are in the order the scope manager reaches them in svelte-eslint-parser's script: the
//!   scripts, the template, the snippets at its top ([`SvelteReference::place`]).
//! - The variables, their definitions and the order of their references are the view's. References that
//!   svelte-eslint-parser only adds to a variable's references are in no scope's `references` or `through`.
//!
//! Ports parts of svelte-eslint-parser, Copyright (c) 2021 Yosuke Ota, under the MIT License: see LICENSE.md.

use super::{Builder, DefinitionRecord, NONE, Name, ReferenceRecord, ScopeRecord, VariableRecord};
use super::{
    IS_ARGUMENTS, IS_EXPORTED, IS_PARTIAL, IS_STRICT, IS_TYPE, IS_USED, IS_VALUE, TO_GLOBAL,
};
use crate::ast::svelte::variables::{
    DefNode, DefinitionKind, Origin, ScriptPlace, Section, SvelteReference,
};
use crate::ast::svelte::{CodeKind, Role, SvelteFlags, SvelteTag};
use crate::ast::{File, Node};
use crate::estree::{Field, NodeType, VNode, Value};
use crate::semantic::{Reference, ReferenceFlags, ScopeKind};
use crate::span::Span;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// A `ComputedVariable`'s `def.type`, after the ones in [`crate::semantic::DeclarationKind`].
/// src/jsc/bindings/LintScopes.cpp has the same number.
pub(super) const COMPUTED_VARIABLE: u32 = 11;

/// What [`Builder::collect_svelte`] found in addition to the builder's own state.
pub(super) struct Collected {
    /// `scopeManager.scopes`.
    pub(super) listed: Vec<u32>,
    /// `scope.variables` of each scope except the global one.
    pub(super) variables: Vec<Vec<u32>>,
    /// `variable.references` of each declared variable.
    pub(super) references: Vec<Vec<u32>>,
}

/// Where the scope manager reaches something: see the [module](self).
type Place = (Section, u32);

/// A component reference with its identifier, or a reference to the `const` of `x as const` with its position: at
/// another reference's [place](SvelteReference::place), after it if `true`.
enum Item<'a, 't> {
    Of(SvelteReference<'a>, u32),
    ToConst(ReferenceRecord<'t>, (ScriptPlace, bool)),
}

/// The tree node for `node`, if it's in the tree.
fn find<'a>(ids: &FxHashMap<VNode<'a>, u32>, node: Option<VNode<'a>>) -> u32 {
    node.and_then(|it| ids.get(&it)).copied().unwrap_or(NONE)
}

/// Of the names `found` that start at one position, the one the scope manager has as the identifier there: the value,
/// for a shorthand property, an import or export without `as`, and a shorthand attribute.
fn the_name<'a>(nodes: &[VNode<'a>], parents: &[u32], found: &[u32]) -> u32 {
    let [first, ..] = found else {
        return NONE;
    };
    if found.len() == 1 {
        return *first;
    }
    let is_field = |parent: VNode<'a>, field: Field, id: u32| matches!((parent.field(field), nodes.get(id as usize)), (Value::Node(node), Some(&it)) if node == it);
    let value = found.iter().copied().find(|&id| {
        let Some(&parent) = parents
            .get(id as usize)
            .and_then(|&it| nodes.get(it as usize))
        else {
            return true;
        };
        let is_key = match parent.node_type() {
            NodeType::Property => {
                is_field(parent, Field::Key, id)
                    && !matches!(parent.field(Field::Computed), Value::Bool(true))
            }
            NodeType::ImportSpecifier => is_field(parent, Field::Imported, id),
            NodeType::ExportSpecifier => is_field(parent, Field::Exported, id),
            NodeType::SvelteShorthandAttribute => is_field(parent, Field::Key, id),
            _ => false,
        };
        !is_key
    });
    value.unwrap_or(*first)
}

/// The names a component's props are written with, from which svelte-eslint-parser creates the identifiers of the
/// references it adds to them (`addPropReference`): copies that are in no field. In terms of the numbered tree `nodes`.
pub(in crate::js_plugin) fn copied_identifiers<'a>(
    file: &'a File<'a>,
    nodes: &[VNode<'a>],
    parents: &[u32],
) -> Vec<u32> {
    let starts: Vec<u32> = (file.svelte_references_by_index())
        .filter(|it| it.origin() == Origin::Prop)
        .map(|it| it.span().start)
        .collect();
    if starts.is_empty() {
        return Vec::new();
    }
    let mut names: FxHashMap<u32, SmallVec<[u32; 2]>> =
        starts.iter().map(|&it| (it, SmallVec::new())).collect();
    for (node, id) in nodes.iter().zip(0u32..) {
        if !node.is_in_component() && node.node_type() == NodeType::Identifier {
            if let Some(found) = names.get_mut(&node.span().start) {
                found.push(id);
            }
        }
    }
    (starts.iter())
        .filter_map(|start| Some(the_name(nodes, parents, names.get(start)?)))
        .filter(|&it| it != NONE)
        .collect()
}

impl<'t, 'a> Builder<'t, 'a> {
    /// Collects the scopes, variables, definitions and references of the component whose program is `file`.
    pub(super) fn collect_svelte(&mut self, file: &'a File<'a>) -> Collected {
        let ids: FxHashMap<VNode<'a>, u32> = self.tree.nodes.iter().copied().zip(0..).collect();
        let (Some(component), Some(view)) = (file.svelte(), file.view()) else {
            return Collected {
                listed: Vec::new(),
                variables: Vec::new(),
                references: Vec::new(),
            };
        };
        // The names, keyed by their start in the program.
        let mut names: FxHashMap<u32, SmallVec<[u32; 2]>> = FxHashMap::default();
        // The other nodes, keyed by type and component span.
        let mut by_place: FxHashMap<(u8, u32, u32), u32> = FxHashMap::default();
        for (node, id) in self.tree.nodes.iter().zip(0u32..) {
            let node_type = self.tree.node_type(id);
            let span = node.span();
            if !node.is_in_component()
                && matches!(
                    node_type,
                    Some(
                        NodeType::Identifier
                            | NodeType::JSXIdentifier
                            | NodeType::Literal
                            | NodeType::PrivateIdentifier
                    )
                )
            {
                names.entry(span.start).or_default().push(id);
            }
            let original = match node.is_in_component() {
                true => span,
                false => {
                    let start = view.in_file(span.start);
                    Span::new(start, start + span.len())
                }
            };
            let key = (
                node_type.map_or(u8::MAX, |it| it as u8),
                original.start,
                original.end,
            );
            by_place.entry(key).or_insert(id);
        }
        let name_at = |start: u32| -> u32 {
            names.get(&start).map_or(NONE, |found| {
                the_name(self.tree.nodes, self.tree.parents, found)
            })
        };
        let node_of = |node: Option<DefNode<'a>>| -> u32 {
            match node {
                None => NONE,
                Some(DefNode::Svelte(node)) => find(&ids, Some(svelte_vnode(file, node.id().0))),
                Some(DefNode::Program(node)) => find(&ids, def_vnode(node)),
                Some(DefNode::Other(type_name, span)) => {
                    let node_type = NodeType::ALL.iter().find(|it| it.name() == type_name);
                    node_type
                        .and_then(|it| by_place.get(&(*it as u8, span.start, span.end)))
                        .copied()
                        .unwrap_or(NONE)
                }
            }
        };

        // The scopes, by their program ids: each one's index in `self.scopes`, or the enclosing one's where the scope
        // manager has none.
        let scopes: Vec<_> = file.scopes().collect();
        let mut place_of_scope: Vec<u32> = vec![NONE; scopes.len()];
        let mut places: Vec<Place> = Vec::new();
        let top_level_snippets: Vec<Span> = (file.svelte_nodes_of(SvelteTag::SnippetBlock))
            .filter(|it| it.parent().is_some_and(|it| it.tag() == SvelteTag::Program))
            .map(|it| it.span())
            .collect();
        let section_at = |original: u32| -> Option<Section> {
            let code = component.code_at(Span::new(original, original))?;
            let (_, kind, ..) = component.code(code)?;
            (kind == CodeKind::Statements).then_some(Section::Scripts)
        };
        let in_template = |original: u32| -> Section {
            let at = top_level_snippets.partition_point(|it| it.end <= original);
            match top_level_snippets
                .get(at)
                .is_some_and(|it| it.start <= original)
            {
                true => Section::Snippets,
                false => Section::Template,
            }
        };
        for (scope, at) in scopes.iter().zip(0usize..) {
            let owner = file.svelte_scope_owner(*scope);
            let is_else_if = owner
                .is_some_and(|it| it.tag() == SvelteTag::ElseBlock && it.has(SvelteFlags::ELSE_IF));
            if is_else_if {
                let upper = scope
                    .parent()
                    .map_or(NONE, |it| place_of_scope[it.id().0 as usize]);
                place_of_scope[at] = upper;
                continue;
            }
            let index = self.scopes.len() as u32;
            place_of_scope[at] = index;
            let upper = scope.parent().map(|it| place_of_scope[it.id().0 as usize]);
            let mut kind = scope.kind();
            let mut variable_scope = place_of_scope[scope.variable_scope().id().0 as usize];
            // An `{#await}` clause without its parameter.
            if let Some(owner) = owner
                && matches!(
                    owner.tag(),
                    SvelteTag::AwaitThenBlock | SvelteTag::AwaitCatchBlock
                )
                && owner.code(Role::Value).is_none()
                && owner.code(Role::Error).is_none()
            {
                kind = ScopeKind::Block;
                variable_scope = upper
                    .and_then(|it| self.scopes.get(it as usize))
                    .map_or(index, |it| it.variable_scope);
            }
            let block = match (owner, scope.kind()) {
                (Some(owner), _) => find(&ids, Some(svelte_vnode(file, owner.id().0))),
                (None, ScopeKind::Global | ScopeKind::Module) => 0,
                (None, _) => find(&ids, super::block(*scope)),
            };
            self.scopes.push(ScopeRecord {
                kind: kind as u32 | (u32::from(scope.is_strict()) * IS_STRICT),
                block,
                upper,
                variable_scope,
                last: index,
                first_variable: 0,
            });
            let original = view.in_file(scope.span().start);
            places.push(match scope.kind() {
                ScopeKind::Global | ScopeKind::Module => (Section::Scripts, 0),
                _ => match section_at(original) {
                    Some(section) => (section, scope.span().start),
                    None => (in_template(original), original),
                },
            });
        }
        for index in (1..self.scopes.len()).rev() {
            if let ScopeRecord {
                last,
                upper: Some(upper),
                ..
            } = self.scopes[index]
                && let Some(upper) = self.scopes.get_mut(upper as usize)
            {
                upper.last = upper.last.max(last);
            }
        }
        let mut listed: Vec<u32> = (0..self.scopes.len() as u32).collect();
        crate::utils::sort::sort_by_key(&mut listed, |&it| places[it as usize]);
        let scope_of = |scope: crate::semantic::Scope<'a>| place_of_scope[scope.id().0 as usize];

        // The variables, scope by scope. The global scope has the ones declared there, then the globals.
        let mut variables: Vec<Vec<u32>> = vec![Vec::new(); self.scopes.len()];
        let mut index_of_variable: FxHashMap<u32, u32> = FxHashMap::default();
        for scope in &scopes {
            let place = scope_of(*scope);
            for variable in file.svelte_variables_of(*scope) {
                let index = self.variables.len() as u32;
                if let Some(at) = variable.index() {
                    index_of_variable.insert(at, index);
                }
                let first_definition = self.definitions.len() as u32;
                for definition in variable.definitions() {
                    let kind = match definition.kind() {
                        DefinitionKind::Declared(kind) => kind as u32,
                        DefinitionKind::Computed => COMPUTED_VARIABLE,
                    };
                    let mut record = DefinitionRecord {
                        kind,
                        name: name_at(definition.name_span().start),
                        node: node_of(definition.node()),
                        parent: node_of(definition.parent()),
                        index: NONE,
                        flags: 0,
                        declaration_kind: 0,
                    };
                    self.tree.complete_metadata(
                        &mut record,
                        self.is_espree,
                        scope.kind() == ScopeKind::Class,
                    );
                    self.definitions.push(record);
                }
                let symbol = variable.symbol();
                let is_arguments = symbol.is_some_and(|it| it.is_implicit_arguments());
                let flags = match symbol {
                    Some(symbol) => {
                        (u32::from(symbol.is_type_variable()) * IS_TYPE)
                            | (u32::from(symbol.is_value_variable()) * IS_VALUE)
                            | (u32::from(symbol.is_marked_used()) * IS_USED)
                            | (u32::from(symbol.is_marked_exported()) * IS_EXPORTED)
                            | (u32::from(is_arguments) * IS_ARGUMENTS)
                    }
                    None => IS_VALUE,
                };
                let first_name = self.definitions.get(first_definition as usize);
                self.variables.push(VariableRecord {
                    name: match is_arguments {
                        true => Name::Arguments,
                        false => Name::Node(first_name.map_or(NONE, |it| it.name)),
                    },
                    text: variable.name().bytes(),
                    scope: place,
                    flags,
                    first_definition,
                    end_definition: self.definitions.len() as u32,
                    settings: 0,
                    comments: 0,
                });
                if let Some(list) = variables.get_mut(place as usize) {
                    list.push(index);
                }
            }
        }
        self.declared = self.variables.len() as u32;

        // The references: the ones the scope manager creates, in its order, then the ones svelte-eslint-parser only
        // adds to variables. References to the `const` of `x as const` aren't program references: each comes right
        // after the last reference of its section that precedes it in the tree.
        let mut all: Vec<(SvelteReference<'a>, u32)> = (file.svelte_references_by_index())
            .map(|it| (it, name_at(it.span().start)))
            .filter(|it| it.1 != NONE)
            .collect();
        crate::utils::sort::sort_by_key(&mut all, |(it, _)| (it.is_virtual(), it.place()));
        // The real ones, sorted by section and identifier, the later of two with one identifier last.
        let mut real: Vec<(ScriptPlace, u32)> = (all.iter())
            .filter(|(it, _)| !it.is_virtual())
            .map(|(it, identifier)| (it.place(), *identifier))
            .collect();
        crate::utils::sort::sort_by_key(&mut real, |it| (it.0.section, it.1));
        let mut items: Vec<Item<'a, 't>> = (all.into_iter())
            .map(|(it, identifier)| Item::Of(it, identifier))
            .collect();
        for to_const in self.references_to_const() {
            let start =
                (self.tree.nodes.get(to_const.identifier as usize)).map_or(0, |it| it.span().start);
            let original = view.in_file(start);
            let section = section_at(original).unwrap_or_else(|| in_template(original));
            let before = real
                .partition_point(|it| (it.0.section, it.1) < (section, to_const.identifier))
                .checked_sub(1)
                .and_then(|at| real.get(at))
                .filter(|it| it.0.section == section);
            let first = ScriptPlace {
                section,
                at: 0,
                then: 0,
            };
            let key = before.map_or((first, false), |it| (it.0, true));
            items.push(Item::ToConst(to_const, key));
        }
        crate::utils::sort::sort_by_key(&mut items, |it| match it {
            Item::Of(it, _) => (it.is_virtual(), it.place(), false),
            Item::ToConst(_, (place, is_after)) => (false, *place, *is_after),
        });
        let mut index_of_reference: FxHashMap<u32, u32> = FxHashMap::default();
        let mut seen = rustc_hash::FxHashSet::default();
        let mut is_first_to_const = true;
        for item in items {
            let (reference, identifier) = match item {
                Item::Of(reference, identifier) => (reference, identifier),
                Item::ToConst(record, _) => {
                    self.add_late(record, &mut is_first_to_const);
                    continue;
                }
            };
            let program = reference.reference();
            let variable = reference.variable();
            let declared = variable
                .and_then(|it| it.index())
                .and_then(|it| index_of_variable.get(&it).copied());
            let global = match (declared, program) {
                (None, Some(program)) => program.global(),
                _ => None,
            };
            if let Some(global) = global
                && !reference.is_virtual()
                && seen.insert(reference.name().atom())
            {
                let flags = (u32::from(global.is_type) * IS_TYPE)
                    | (u32::from(global.is_value) * IS_VALUE)
                    | (u32::from(global.is_exported) * (IS_USED | IS_EXPORTED))
                    | (u32::from(global.is_writable) * super::IS_WRITABLE)
                    | (u32::from(global.is_in_lib) * super::IS_IN_LIB)
                    | (u32::from(!global.is_only_in_lib) * super::IS_CONFIGURED);
                self.referenced_globals
                    .push((self.references.len() as u32, flags));
            }
            let from = scope_of(reference.scope());
            let reference_flags = reference.flags();
            let mut written = find(
                &ids,
                program
                    .and_then(Reference::write_expr)
                    .and_then(super::expression),
            );
            // An assigned store, `$a = 1`: svelte-eslint-parser creates a read-only reference to `a`, and keeps the
            // write.
            let assignment = self.tree.parent(identifier);
            if written == NONE
                && !reference_flags.contains(ReferenceFlags::WRITE)
                && self.tree.is(assignment, NodeType::AssignmentExpression)
                && self.tree.is_field(assignment, Field::Left, identifier)
                && self.tree.parent(self.tree.after(identifier)) == assignment
            {
                written = self.tree.after(identifier);
            }
            let is_partial = self.is_espree
                && reference_flags.contains(ReferenceFlags::WRITE)
                && self.tree.is_partial_write(identifier, written);
            let (assigning, implicit_global) = match reference.is_virtual() {
                true => (NONE, 0),
                false => self.maybe_implicit_global(identifier, reference_flags, from),
            };
            index_of_reference.insert(reference.index(), self.references.len() as u32);
            if reference.is_virtual() {
                self.virtual_from = self.virtual_from.min(self.references.len() as u32);
            }
            self.references.push(ReferenceRecord {
                identifier: match reference.origin() {
                    Origin::Prop => self.tree.copy_of(identifier),
                    _ => identifier,
                },
                created_at: identifier,
                flags: u32::from(reference_flags.bits())
                    | (u32::from(global.is_some()) * TO_GLOBAL)
                    | (u32::from(is_partial) * IS_PARTIAL)
                    | implicit_global,
                unwrap_jsdoc_casts: written,
                variable: declared.unwrap_or(NONE),
                from,
                assigning,
                name: reference.name().bytes(),
            });
        }

        // `variable.references`, as the view has them.
        let mut references: Vec<Vec<u32>> = vec![Vec::new(); self.declared as usize];
        for scope in &scopes {
            for variable in file.svelte_variables_of(*scope) {
                let Some(index) = variable
                    .index()
                    .and_then(|it| index_of_variable.get(&it).copied())
                else {
                    continue;
                };
                references[index as usize] = (variable.references())
                    .filter_map(|it| index_of_reference.get(&it.index()).copied())
                    .collect();
            }
        }
        Collected {
            listed,
            variables,
            references,
        }
    }
}

impl Builder<'_, '_> {
    /// The items of the list that [`super::push_list`] put at `list`.
    fn pushed(&self, list: u32) -> &[u32] {
        let length = self.lists.get(list as usize).copied().unwrap_or(0) as usize;
        (self.lists)
            .get(list as usize + 1..list as usize + 1 + length)
            .unwrap_or_default()
    }

    /// With TypeScript, svelte-eslint-parser declares what it adds to the global scope in its script, so references
    /// resolve to that declaration, and then removes the declaration (`removeAllScopeAndVariableAndReference`): the
    /// references go back into the module scope's `through`, each where `addAllReferences`' binary search places it,
    /// before the `generics` ones. `through` holds each scope's list, and `names` what it declares this way, in removal
    /// order.
    pub(super) fn put_back_into_through(
        &mut self,
        file: &File<'_>,
        through: &mut [u32],
        names: &[&[u8]],
    ) {
        let Some(module) = (self.scopes.iter()).position(|it| it.is(ScopeKind::Module)) else {
            return;
        };
        let Some(&list) = through.get(module) else {
            return;
        };
        let mut items: Vec<u32> = self.pushed(list).to_vec();
        let view = file.view();
        let (nodes, records) = (self.tree.nodes, &self.references);
        let start_of = |reference: u32| start_in_file(nodes, records, view, reference);
        let is_global = |reference: u32| {
            (self.references.get(reference as usize)).is_some_and(|it| it.flags & TO_GLOBAL != 0)
        };
        // The `generics` ones come later.
        let is_generics_reference = |reference: &u32| {
            let at = start_of(*reference);
            let code = file
                .svelte()
                .and_then(|it| Some(it.code(it.code_at(Span::new(at, at))?)?.1));
            code == Some(CodeKind::TypeParameters)
        };
        let generics_references: Vec<u32> = items
            .iter()
            .copied()
            .filter(is_generics_reference)
            .collect();
        items.retain(|it| !is_generics_reference(it));
        let mut changed = false;
        for name in names {
            let is_it = |reference: &u32| {
                is_global(*reference)
                    && self
                        .references
                        .get(*reference as usize)
                        .is_some_and(|it| it.name == *name)
            };
            let taken: Vec<u32> = items.iter().copied().filter(is_it).collect();
            if taken.is_empty() {
                continue;
            }
            items.retain(|it| !is_it(it));
            add_all_references(&mut items, &taken, &start_of);
            changed = true;
        }
        items.extend(generics_references);
        if changed && let Some(slot) = through.get_mut(module) {
            *slot = super::push_list(&mut self.lists, &items);
        }
    }

    /// With TypeScript, svelte-eslint-parser wraps the argument of `$derived(a)` in a function inside a function for
    /// its types, and removes them again (`transformForDollarDerived`): the references in `a` that belong to no scope
    /// inside it go back into the call scope's `references`, each where `addAllReferences`' binary search places it.
    /// `references` holds each scope's list.
    pub(super) fn put_back_derived(&mut self, file: &File<'_>, references: &mut [u32]) {
        let view = file.view();
        let (nodes, records) = (self.tree.nodes, &self.references);
        let start_of = |reference: u32| start_in_file(nodes, records, view, reference);
        // svelte-eslint-parser changes nothing for a call inside another one's argument.
        let mut end_of_last = 0;
        let mut calls: Vec<(u32, u32, u32)> = Vec::new();
        for reference in &self.references {
            if reference.name != b"$derived"
                || reference.flags & TO_GLOBAL == 0
                || reference.identifier < end_of_last
            {
                continue;
            }
            let call = self.tree.parent(reference.identifier);
            if !self.tree.is(call, NodeType::CallExpression)
                || !self
                    .tree
                    .is_field(call, Field::Callee, reference.identifier)
            {
                continue;
            }
            let mut argument = self.tree.after(reference.identifier);
            if self.tree.parent(argument) == call
                && self
                    .tree
                    .is(argument, NodeType::TSTypeParameterInstantiation)
            {
                argument = self.tree.after(argument);
            }
            if self.tree.parent(argument) != call || self.tree.is(argument, NodeType::SpreadElement)
            {
                continue;
            }
            end_of_last = self.tree.after(call);
            calls.push((reference.from, argument, self.tree.last(argument)));
        }
        for (scope, first, last) in calls {
            let Some(&list) = references.get(scope as usize) else {
                continue;
            };
            let (moved, mut kept): (Vec<u32>, Vec<u32>) =
                self.pushed(list).iter().partition(|&&it| {
                    let identifier = self
                        .references
                        .get(it as usize)
                        .map_or(NONE, |it| it.identifier);
                    (first..=last).contains(&identifier)
                });
            if moved.is_empty() {
                continue;
            }
            let mut outer = Vec::new();
            add_all_references(&mut outer, &moved, &start_of);
            add_all_references(&mut kept, &outer, &start_of);
            if let Some(slot) = references.get_mut(scope as usize) {
                *slot = super::push_list(&mut self.lists, &kept);
            }
        }
    }
}

/// The component start of the identifier of `reference` in `references`, a node of `nodes`.
fn start_in_file(
    nodes: &[VNode<'_>],
    references: &[ReferenceRecord<'_>],
    view: Option<&crate::ast::view::View>,
    reference: u32,
) -> u32 {
    let node =
        (references.get(reference as usize)).and_then(|it| nodes.get(it.identifier as usize));
    node.map_or(0, |it| {
        let start = it.span().start;
        view.map_or(start, |view| view.in_file(start))
    })
}

/// svelte-eslint-parser's `addAllReferences`: inserts `elements` into `list` by their identifiers' starts, which
/// `start_of` returns. Neither has to be sorted, and the binary search lands wherever it lands.
fn add_all_references(list: &mut Vec<u32>, elements: &[u32], start_of: &impl Fn(u32) -> u32) {
    let compare = |a: u32, b: u32| i64::from(start_of(a)) - i64::from(start_of(b));
    let sorted_last_index = |list: &[u32], element: u32| {
        let (mut lower, mut upper) = (0, list.len());
        while lower < upper {
            let mid = lower + (upper - lower) / 2;
            let target = list.get(mid).map_or(0, |&it| compare(it, element));
            match target {
                ..0 => lower = mid + 1,
                1.. => upper = mid,
                0 => return mid + 1,
            }
        }
        upper
    };
    let Some(&first) = elements.first() else {
        return;
    };
    let mut last = first;
    let mut index = sorted_last_index(list, last);
    for &element in elements {
        if compare(last, element) > 0 {
            index = sorted_last_index(list, element);
        }
        while list.get(index).is_some_and(|&it| compare(it, element) <= 0) {
            index += 1;
        }
        list.insert(index, element);
        last = element;
    }
}

/// The tree node for the component node `id`.
fn svelte_vnode<'a>(file: &'a File<'a>, id: u32) -> VNode<'a> {
    VNode::from_svelte(file, crate::ast::svelte::SvelteId(id))
}

/// `def.node` or `def.parent`, if it's a program node.
fn def_vnode(node: Node<'_>) -> Option<VNode<'_>> {
    match node {
        Node::Stmt(statement)
            if matches!(statement.kind(), crate::ast::StmtKind::Try { .. })
                && statement.catch_clause_span().is_some() =>
        {
            Some(VNode::catch_clause(statement))
        }
        _ => VNode::from_listened(node),
    }
}
