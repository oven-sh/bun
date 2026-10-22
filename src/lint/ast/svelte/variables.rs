//! A component's variables as svelte-eslint-parser 1.9's scope manager has them, which eslint-plugin-svelte's rules
//! read: [`File::svelte_variables`]. Built once per component program, on first use, from the program's scopes, symbols
//! and references. For a file that isn't a component, such as a `.svelte.js` file, they're ESLint's.
//!
//! The program declares and references both more and less than the component does (`ast/svelte.rs`, the lowering). The
//! view undoes that the way svelte-eslint-parser repairs its scopes (`analyze-scope.ts`), so each variable matches the
//! parser's:
//!
//! - Nothing declared only by synthesized code is a variable, and nothing in synthesized code is a reference.
//! - `analyzeStoreScope`: each store's `$x` is a read-only reference to `x`, even where it's written. The program has a
//!   variable `$x`, and the lowering names both `x` and `$x` in one call. If `$x` is only ever written and nothing else
//!   references `x`, `x` is read where it's first declared. svelte-eslint-parser adds every `$x` except the first to
//!   `x`'s references a second time, and so does the view.
//! - A variable's references are in the order of svelte-eslint-parser's script, not the component's: the scripts, the
//!   template, the snippets at its top, `generics`, and a component's name after the element's content
//!   ([`place_in_script`]). That order also decides which `$x` is first.
//! - `analyzeReactiveScope`: an undeclared variable that the first `$: x = ..` assigns is a top-level variable with one
//!   `ComputedVariable` definition, whose node is the assignment. That reference resolves to it, but the variable
//!   doesn't list it. It lists the later ones, which write it.
//! - `analyzeSnippetsScope`: a snippet passed to a component is read where it's named.
//! - `analyzePropsScope`: each top-level variable that a script without `context="module"` exports with `export let`,
//!   `export const`, .., or names in `export { .. }`, or that `$props()` gives a `$bindable()` default, is read and
//!   written once where that names it.
//! - The parameters of blocks and snippets are defined by the component node: the `{#each}`, the `{#snippet}`, the
//!   `{:then}`, the `{:catch}`, a `let:`'s element. The `{@const}` variable has the `SvelteConstTag` as its parent.
//! - A class declaration has its name as a second variable in its own scope, and a function's `arguments` is a
//!   variable.
//!
//! The parser's variables and definitions are ESLint's ([`crate::semantic`]). The differences are in
//! [`SvelteVariable`], [`SvelteDefinition`] and [`SvelteReference`].
//!
//! Ports parts of svelte-eslint-parser, Copyright (c) 2021 Yosuke Ota, under the MIT License: see LICENSE.md.

use super::{CodeKind, Role, Root, SvelteId, SvelteKind, SvelteNode, SvelteTag};
use crate::ast::{Expr, File, Node, Packed, Pat, PatKind, PatTag, Stmt, StmtKind};
use crate::semantic::{
    Declaration, DeclarationKind, Reference, ReferenceFlags, Scope, ScopeKind, Symbol, VariableKind,
};
use crate::span::Span;
use bun_sema::atom::Atom;
use bun_sema::bind::ScopeId;
use rustc_hash::FxHashMap;

const NONE: u32 = u32::MAX;

/// ESLint's `def.type`, and svelte-eslint-parser's `ComputedVariable`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DefinitionKind {
    Declared(DeclarationKind),
    /// A variable that `$: x = ..` assigns: `analyzeReactiveScope`.
    Computed,
}

impl DefinitionKind {
    /// `def.type`
    pub fn type_name(self) -> &'static str {
        match self {
            DefinitionKind::Computed => "ComputedVariable",
            DefinitionKind::Declared(kind) => match kind {
                DeclarationKind::Variable => "Variable",
                DeclarationKind::Parameter => "Parameter",
                DeclarationKind::FunctionName => "FunctionName",
                DeclarationKind::ClassName => "ClassName",
                DeclarationKind::CatchClause => "CatchClause",
                DeclarationKind::ImportBinding => "ImportBinding",
                DeclarationKind::TsEnumName => "TSEnumName",
                DeclarationKind::TsEnumMember => "TSEnumMember",
                DeclarationKind::TsModuleName => "TSModuleName",
                DeclarationKind::Type => "Type",
            },
        }
    }
}

/// `def.node` or `def.parent`: a program node or a component node.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DefNode<'a> {
    Program(Node<'a>),
    Svelte(SvelteNode<'a>),
    /// A node in ESLint's tree that has no counterpart here, with its `type` and its span in the component: an
    /// `ImportDefaultSpecifier`, an `ImportNamespaceSpecifier`, a `generics` `TSTypeParameter`.
    Other(&'static str, Span),
}

#[derive(Copy, Clone)]
enum Stored {
    Program(Packed),
    Svelte(SvelteId),
    Other(&'static str, Span),
}

impl Stored {
    fn of(node: DefNode<'_>) -> Stored {
        match node {
            DefNode::Program(node) => Stored::Program(node.packed()),
            DefNode::Svelte(node) => Stored::Svelte(node.id()),
            DefNode::Other(type_name, span) => Stored::Other(type_name, span),
        }
    }

    fn get<'a>(self, file: &'a File<'a>) -> Option<DefNode<'a>> {
        match self {
            Stored::Program(node) => Some(DefNode::Program(node.unpack(file))),
            Stored::Svelte(id) => file.svelte_node(id).map(DefNode::Svelte),
            Stored::Other(type_name, span) => Some(DefNode::Other(type_name, span)),
        }
    }
}

struct DefinitionData {
    kind: DefinitionKind,
    /// `def.name`, in the program, without a type annotation.
    name: Span,
    node: Option<Stored>,
    parent: Option<Stored>,
}

/// The origin of a view reference.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Origin {
    /// A program reference.
    Written,
    /// A store's `$x`, as a reference to `x`: [`analyzeStoreScope`](self).
    Store,
    /// The read of a snippet passed to a component, where it's named.
    Snippet,
    /// The read and write of a prop where it's exported or declared. Its `identifier` is a copy, which isn't a tree
    /// node.
    Prop,
    /// The read of a store variable that only `$x = ..` uses, where it's first declared.
    MarkedUsed,
}

struct ReferenceData {
    origin: Origin,
    /// The program reference, or `NONE`.
    program_reference: u32,
    name: Atom,
    /// The identifier's span in the program.
    span: Span,
    /// Its start in the component, which svelte-eslint-parser sorts references by.
    key: u32,
    from: u32,
    variable: u32,
    flags: ReferenceFlags,
    /// True if it was written and not read before it became a store read: `toBeMarkAsUsedReferences`.
    was_write_only: bool,
}

enum VariableOrigin {
    Symbol(u32),
    NameInClass(Packed),
}

struct VariableData {
    origin: VariableOrigin,
    name: Atom,
    scope: u32,
    definitions: Vec<DefinitionData>,
    /// `variable.references`, in order, as reference indices.
    references: Vec<u32>,
    is_computed: bool,
}

/// See the [module](self).
#[derive(Default)]
pub struct ComponentVariables {
    /// Grouped by scope, each in `scope.variables` order.
    variables: Vec<VariableData>,
    /// The start of each scope's variables in `variables`, plus one end.
    scope_starts: Vec<u32>,
    /// All references, sorted by their start in the component.
    references: Vec<ReferenceData>,
    /// The view reference for each program reference, or `NONE`.
    program_reference: Vec<u32>,
    /// The variable for each symbol, or `NONE`.
    symbol_variables: Vec<u32>,
    /// `scope.set`: the variable for a name in a scope.
    by_name: FxHashMap<(u32, u32), u32>,
    /// The start of each `ComputedVariable`'s assignment, the assignment, and the variable. Sorted.
    computed: Vec<(u32, Packed, u32)>,
    /// Each reference's position in svelte-eslint-parser's script: [`SvelteReference::place`].
    places: Vec<ScriptPlace>,
}

/// svelte-eslint-parser's `sortedLastIndex` of `key` in a list of length `len` sorted by `key_at`, which returns the
/// key at an index.
fn sorted_last_index(len: usize, key: u32, key_at: impl Fn(usize) -> u32) -> usize {
    let (mut lower, mut upper) = (0, len);
    while lower < upper {
        let mid = lower + (upper - lower) / 2;
        let target = key_at(mid);
        match target.cmp(&key) {
            std::cmp::Ordering::Less => lower = mid + 1,
            std::cmp::Ordering::Greater => upper = mid,
            std::cmp::Ordering::Equal => return mid + 1,
        }
    }
    upper
}

/// `addReference`: inserts `reference` into `list`, sorted by start.
fn add_reference(list: &mut Vec<u32>, references: &[ReferenceData], reference: u32) {
    let key_of = |it: u32| references.get(it as usize).map_or(0, |it| it.key);
    let key_at = |at: usize| list.get(at).map_or(0, |&it| key_of(it));
    let index = sorted_last_index(list.len(), key_of(reference), key_at);
    list.insert(index, reference);
}

/// The names in a `$props()` object pattern whose default is `$bindable()`, at any depth, each with its pattern.
fn bindables<'a>(pattern: Pat<'a>, out: &mut Vec<Pat<'a>>) {
    let is_bindable = |default: Option<Expr<'_>>| {
        (default.and_then(Expr::as_call)).is_some_and(|it| it.callee().is_ident("$bindable"))
    };
    match pattern.kind() {
        PatKind::Object(props) => {
            for prop in props.iter() {
                let value = prop.value();
                match value.kind() {
                    PatKind::Ident(_) if is_bindable(prop.default()) => out.push(value),
                    _ => bindables(value, out),
                }
            }
        }
        PatKind::Array(elements) => {
            for element in elements.iter() {
                let Some(value) = element.pat() else {
                    continue;
                };
                match value.kind() {
                    PatKind::Ident(_) if is_bindable(element.default()) => out.push(value),
                    _ => bindables(value, out),
                }
            }
        }
        PatKind::Missing | PatKind::Ident(_) => {}
    }
}

/// True if svelte-eslint-parser treats `script` as a module script: it has `context="module"`.
fn is_module_script(script: SvelteNode<'_>) -> bool {
    let attributes = script
        .child(Role::StartTag)
        .into_iter()
        .flat_map(|it| it.nodes(Role::Attributes));
    attributes
        .filter(|it| it.tag() == SvelteTag::Attribute && it.name() == b"context")
        .any(|it| {
            let mut values = it.nodes(Role::Value);
            matches!((values.next(), values.next()), (Some(value), None)
                if value.tag() == SvelteTag::Literal && value.text() == b"module")
        })
}

/// The sections of svelte-eslint-parser's script, in the order its scope manager visits them.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default)]
pub enum Section {
    #[default]
    Scripts,
    Template,
    /// The snippets at the top of the template.
    Snippets,
    /// `generics`
    Generics,
}

/// Where svelte-eslint-parser's scope manager reaches a reference in its script: [`SvelteReference::place`]. Ordered
/// accordingly.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default)]
pub struct ScriptPlace {
    pub section: Section,
    /// In the scripts, its index among the program's references. After them, the start of its piece of code in the
    /// component.
    pub at: u32,
    /// After the scripts, its index among the program's references.
    pub then: u32,
}

/// A reference's position in svelte-eslint-parser's script, which decides how its scope manager orders a variable's
/// references.
#[derive(Copy, Clone)]
enum Place {
    /// In a script, in program order.
    Script,
    /// In a section after the scripts, at this component position: the start of the piece of code, within which
    /// references come in program order. A component's name and `<svelte:element>`'s `this` are placed where the
    /// element ends.
    At(Section, u32),
}

/// The [`Place`] of the identifier at `at` in the component, `len` bytes long. `snippets` holds the top-level snippets'
/// spans, in order.
fn place_in_script<'a>(file: &'a File<'a>, snippets: &[Span], at: u32, len: u32) -> Place {
    let Some(component) = file.svelte() else {
        return Place::Script;
    };
    let code = component.code_at(Span::new(at, at + len));
    let Some((piece, kind, owner, role)) = code.and_then(|it| component.code(it)) else {
        return Place::Script;
    };
    let section = match kind {
        CodeKind::Statements => return Place::Script,
        CodeKind::TypeParameters => return Place::At(Section::Generics, at),
        _ if snippets
            .get(snippets.partition_point(|it| it.end <= at))
            .is_some_and(|it| it.start <= at) =>
        {
            Section::Snippets
        }
        _ => Section::Template,
    };
    let Some(node) = file.svelte_node(owner) else {
        return Place::At(section, piece.start);
    };
    // The name of a transition, an animation or an action comes after its expression.
    if node.tag() == SvelteTag::DirectiveKey
        && let Some(directive) = node.parent()
        && matches!(
            directive.kind(),
            SvelteKind::Transition | SvelteKind::Animation | SvelteKind::Action
        )
        && directive.code(Role::Expression).is_some()
    {
        return Place::At(section, directive.span().end);
    }
    let is_at_end = match node.tag() {
        SvelteTag::MemberExpressionName | SvelteTag::SpecialDirective => true,
        SvelteTag::Element => role == Role::Name,
        _ => false,
    };
    let element = is_at_end
        .then(|| {
            (std::iter::once(node).chain(node.ancestors()))
                .find(|it| it.tag() == SvelteTag::Element)
        })
        .flatten();
    Place::At(section, element.map_or(piece.start, |it| it.span().end))
}

impl ComponentVariables {
    fn new<'a>(file: &'a File<'a>) -> ComponentVariables {
        // A file that isn't a component has no lowering to undo.
        let view = file.view();
        let hides = |at: u32| view.is_some_and(|it| it.hides(at));
        let is_copy = |at: u32| view.is_some_and(|it| it.is_copy(at));
        let in_file = |at: u32| view.map_or(at, |it| it.in_file(at));
        let mut it = ComponentVariables {
            symbol_variables: vec![NONE; file.symbol_key_limit()],
            ..ComponentVariables::default()
        };
        // The stores' `$x` variables, and the matching `x`: the lowering calls a helper with both, `helper(x, $x)`.
        let mut store_of: FxHashMap<u32, u32> = FxHashMap::default();
        for statement in file.body().with_hidden() {
            if !hides(statement.span().start) {
                continue;
            }
            let StmtKind::Expr(e) = statement.kind() else {
                continue;
            };
            let Some(call) = e.as_call() else {
                continue;
            };
            let mut args = call.args().with_hidden();
            if let (Some(base), Some(store), None) = (args.next(), args.next(), args.next())
                && let (Some(base), Some(store)) = (base.symbol(), store.symbol())
                && store.declarations().all(|it| {
                    it.name_span()
                        .is_some_and(|it| hides(it.start) && !is_copy(it.start))
                })
            {
                store_of.insert(store.key() as u32, base.key() as u32);
            }
        }
        // `$:` statements, sorted by start, with their assignments.
        let reactive: Vec<(Span, Stmt<'a>, Expr<'a>)> = (file.body().with_hidden())
            .filter(|it| it.is_svelte_reactive())
            .filter_map(|statement| {
                let StmtKind::Labeled { body, .. } = statement.kind() else {
                    return None;
                };
                let StmtKind::Expr(e) = body.kind() else {
                    return None;
                };
                e.as_assign().map(|_| (statement.span(), statement, e))
            })
            .collect();

        // The variables, scope by scope.
        let top = file.top_level_scope();
        for scope in file.scopes() {
            it.scope_starts.push(it.variables.len() as u32);
            // Each with its first identifier's start in the component, which `addVariable` sorts by.
            let mut list: Vec<(VariableData, u32)> = Vec::new();
            if let Node::Class(class) = scope.node()
                && let (Some(outer), Some(name)) = (class.symbol(), class.name())
                && outer.scope() != scope
            {
                let data = VariableData {
                    origin: VariableOrigin::NameInClass(Node::Class(class).packed()),
                    name: name.name().atom(),
                    scope: scope.id().0,
                    definitions: vec![DefinitionData {
                        kind: DefinitionKind::Declared(DeclarationKind::ClassName),
                        name: name.span(),
                        node: Some(Stored::Program(Node::Class(class).packed())),
                        parent: None,
                    }],
                    references: Vec::new(),
                    is_computed: false,
                };
                list.push((data, in_file(name.span().start)));
            }
            for symbol in scope.symbols() {
                let first = symbol.declarations().find_map(|it| it.name_span());
                let is_made_up = first.is_some_and(|it| hides(it.start))
                    && (symbol.declarations())
                        .all(|it| it.name_span().is_none_or(|it| hides(it.start)));
                let is_computed = is_made_up && first.is_some_and(|it| is_copy(it.start));
                if is_made_up && !is_computed {
                    continue;
                }
                let definitions = match is_computed {
                    true => Vec::new(),
                    false => definitions_of(file, symbol),
                };
                let data = VariableData {
                    origin: VariableOrigin::Symbol(symbol.key() as u32),
                    name: symbol.name().atom(),
                    scope: scope.id().0,
                    definitions,
                    references: Vec::new(),
                    is_computed,
                };
                list.push((data, first.map_or(0, |it| in_file(it.start))));
            }
            if scope == top {
                // svelte-eslint-parser adds the computed variables to the top-level ones, sorted by their first
                // identifiers.
                let (mut declared, computed): (Vec<_>, Vec<_>) =
                    list.into_iter().partition(|it| !it.0.is_computed);
                for variable in computed {
                    let key_at = |at: usize| declared.get(at).map_or(0, |it| it.1);
                    let index = sorted_last_index(declared.len(), variable.1, key_at);
                    declared.insert(index, variable);
                }
                list = declared;
            }
            for (data, _) in list {
                if let VariableOrigin::Symbol(symbol) = data.origin
                    && let Some(slot) = it.symbol_variables.get_mut(symbol as usize)
                {
                    *slot = it.variables.len() as u32;
                }
                it.variables.push(data);
            }
        }
        it.scope_starts.push(it.variables.len() as u32);

        // The references.
        let mut hidden: Vec<u32> = (view.map(|it| it.adjustments()).unwrap_or_default().iter())
            .filter_map(|it| match *it {
                crate::ast::view::Adjustment::Hide { at } => Some(at),
                _ => None,
            })
            .collect();
        hidden.sort_unstable();
        it.program_reference = vec![NONE; file.references().len()];
        let mut class_variables: Vec<(Packed, u32)> = Vec::new();
        for (variable, at) in it.variables.iter().zip(0..) {
            if let VariableOrigin::NameInClass(class) = variable.origin {
                class_variables.push((class, at));
            }
        }
        let snippets: Vec<Span> = (file.svelte_nodes_of(SvelteTag::SnippetBlock))
            .filter(|it| it.parent().is_some_and(|it| it.tag() == SvelteTag::Program))
            .map(|it| it.span())
            .collect();
        // The first `$:` that assigns each computed variable, which the variable doesn't list.
        let mut unlisted: Vec<u32> = Vec::new();
        let mut first_assigned = vec![NONE; it.variables.len()];
        for (reference, index) in file.references().zip(0u32..) {
            let span = reference.span();
            if hides(span.start) {
                continue;
            }
            // The core's prop writes: the view has svelte-eslint-parser's instead.
            if reference.is_restored() && reference.is_write() {
                continue;
            }
            let mut origin = match reference.is_restored() {
                true => Origin::Snippet,
                false => Origin::Written,
            };
            let mut flags = reference.flags();
            let mut was_write_only = false;
            let variable = match reference.symbol() {
                None => NONE,
                Some(symbol) => match store_of.get(&(symbol.key() as u32)) {
                    Some(&base) => {
                        origin = Origin::Store;
                        was_write_only = reference.is_write_only();
                        flags.remove(ReferenceFlags::WRITE);
                        flags.insert(ReferenceFlags::READ);
                        it.symbol_variables
                            .get(base as usize)
                            .copied()
                            .unwrap_or(NONE)
                    }
                    None => match reference.variable().map(|it| it.kind()) {
                        Some(VariableKind::NameInClass { class, .. }) => {
                            let class = Node::Class(class).packed();
                            (class_variables.iter())
                                .find(|it| it.0 == class)
                                .map_or(NONE, |it| it.1)
                        }
                        _ => it
                            .symbol_variables
                            .get(symbol.key())
                            .copied()
                            .unwrap_or(NONE),
                    },
                },
            };
            let id = it.references.len() as u32;
            if let Some(data) = it.variables.get(variable as usize)
                && data.is_computed
                && hidden.binary_search(&span.start).is_ok()
                && let Some(first) = first_assigned.get_mut(variable as usize)
                && *first == NONE
            {
                *first = id;
                unlisted.push(id);
            }
            if let Some(slot) = it.program_reference.get_mut(index as usize) {
                *slot = id;
            }
            it.references.push(ReferenceData {
                origin,
                program_reference: index,
                name: reference.name().atom(),
                span,
                key: in_file(span.start),
                from: reference.scope().id().0,
                variable,
                flags,
                was_write_only,
            });
        }

        // The definitions of computed variables: the first `$:` that assigns each one.
        for (variable, &first) in first_assigned.iter().enumerate() {
            let Some(reference) = it.references.get(first as usize) else {
                continue;
            };
            let at = reference.span.start;
            let index = reactive.partition_point(|it| it.0.end <= at);
            let Some(&(_, statement, assignment)) =
                reactive.get(index).filter(|it| it.0.contains_offset(at))
            else {
                continue;
            };
            let name = reference.span;
            if let Some(data) = it.variables.get_mut(variable) {
                data.definitions.push(DefinitionData {
                    kind: DefinitionKind::Computed,
                    name,
                    node: Some(Stored::Program(Node::Expr(assignment).packed())),
                    parent: Some(Stored::Program(Node::Stmt(statement).packed())),
                });
            }
            it.computed.push((
                assignment.span().start,
                Node::Expr(assignment).packed(),
                variable as u32,
            ));
        }
        // Sorted by each assignment's start, and an assignment's variables by where they're first assigned.
        it.computed.sort_by_key(|it| it.0);

        // Each reference's position in svelte-eslint-parser's script: in the scripts, the order in which the scope
        // manager creates the program's references.
        let mut places = vec![ScriptPlace::default(); it.references.len()];
        // `variable.references`, as the scope manager creates them from that script.
        let mut listed: Vec<u32> = Vec::new();
        for (reference, visited) in file.references_as_visited().zip(0u32..) {
            let Some(&id) = it.program_reference.get(reference.index()) else {
                continue;
            };
            let Some(data) = it.references.get(id as usize) else {
                continue;
            };
            let place = match place_in_script(file, &snippets, data.key, data.span.len()) {
                Place::Script => ScriptPlace {
                    section: Section::Scripts,
                    at: visited,
                    then: 0,
                },
                Place::At(section, at) => ScriptPlace {
                    section,
                    at,
                    then: visited,
                },
            };
            if let Some(slot) = places.get_mut(id as usize) {
                *slot = place;
            }
            if data.origin == Origin::Written && !unlisted.contains(&id) {
                listed.push(id);
            }
        }
        let place_of = |id: u32| places.get(id as usize).copied().unwrap_or_default();
        listed.sort_by_key(|&id| place_of(id));
        for id in listed {
            let variable = it
                .references
                .get(id as usize)
                .map_or(NONE, |it| it.variable);
            if let Some(variable) = it.variables.get_mut(variable as usize) {
                variable.references.push(id);
            }
        }
        // svelte-eslint-parser adds the computed variables' references in order.
        for variable in it.variables.iter_mut().filter(|it| it.is_computed) {
            let references = &it.references;
            variable
                .references
                .sort_by_key(|&id| references.get(id as usize).map_or(0, |it| it.key));
        }

        // `analyzeStoreScope`: the references of `$x` and, where `x` is only written through them, a read of `x`.
        let mut stores: Vec<(u32, u32)> = (it.references.iter().zip(0u32..))
            .filter(|(data, _)| data.origin == Origin::Store && data.variable != NONE)
            .map(|(data, id)| (data.variable, id))
            .collect();
        // Sorted by where each `$x` leaves `through`: svelte-eslint-parser's script order.
        stores.sort_by_key(|&(variable, id)| (variable, place_of(id)));
        for group in stores.chunk_by(|a, b| a.0 == b.0) {
            let variable = group.first().map_or(NONE, |it| it.0) as usize;
            let ids: Vec<u32> = group.iter().map(|it| it.1).collect();
            let Some(data) = it.variables.get_mut(variable) else {
                continue;
            };
            // The first `$x` adds the others when it removes them from `through`, and each one adds itself again.
            let again = ids.get(1..).unwrap_or_default();
            let order = ids.iter().take(1).chain(again).chain(again);
            for &id in order {
                add_reference(&mut data.references, &it.references, id);
            }
            if !ids.iter().any(|&id| {
                it.references
                    .get(id as usize)
                    .is_some_and(|it| it.was_write_only)
            }) {
                continue;
            }
            let Some(first) = data.definitions.first().map(|it| it.name) else {
                continue;
            };
            let is_used = data.references.iter().any(|&id| {
                let Some(reference) = it.references.get(id as usize) else {
                    return false;
                };
                let is_marked = reference.origin == Origin::Store && reference.was_write_only;
                let is_first_name = reference.origin == Origin::Written
                    && Reference::at_index(file, reference.program_reference as usize).is_some_and(
                        |it| matches!(it.node(), Node::Pat(pat) if pat.span() == first),
                    );
                !is_marked && !is_first_name
            });
            if is_used {
                continue;
            }
            let id = it.references.len() as u32;
            it.references.push(ReferenceData {
                origin: Origin::MarkedUsed,
                program_reference: NONE,
                name: data.name,
                span: first,
                key: in_file(first.start),
                from: file.top_level_scope().id().0,
                variable: variable as u32,
                flags: ReferenceFlags::READ,
                was_write_only: false,
            });
            add_reference(&mut data.references, &it.references, id);
        }

        // `analyzeSnippetsScope`
        let snippets: Vec<u32> = (it.references.iter().zip(0u32..))
            .filter(|(data, _)| data.origin == Origin::Snippet)
            .map(|it| it.1)
            .collect();
        for id in snippets {
            let variable = it
                .references
                .get(id as usize)
                .map_or(NONE, |it| it.variable);
            if let Some(data) = it.variables.get_mut(variable as usize) {
                add_reference(&mut data.references, &it.references, id);
            }
        }

        // `analyzePropsScope`, for each script except module scripts.
        let context = file.svelte_context();
        let may_have_runes = context.is_some_and(|it| {
            !matches!(it.svelte_version.as_deref(), None | Some("3/4")) && it.runes != Some(false)
        });
        let mut props: Vec<(Atom, Span)> = Vec::new();
        for script in file
            .svelte_nodes_of(SvelteTag::ScriptElement)
            .filter(|it| !is_module_script(*it))
        {
            let statements = script.codes(Role::Body).flat_map(|it| it.roots());
            for root in statements {
                let Root::Node(Node::Stmt(statement)) = root else {
                    continue;
                };
                match statement.kind() {
                    StmtKind::Var(declarators) if statement.is_exported() => {
                        for declarator in declarators.iter() {
                            declarator.pat().for_each_binding(&mut |pat| {
                                if let Some(name) = pat.as_ident() {
                                    props.push((name.atom(), pat.span()));
                                }
                            });
                        }
                    }
                    StmtKind::Var(declarators) if may_have_runes => {
                        for declarator in declarators.iter() {
                            let is_props = (declarator.init().and_then(Expr::as_call))
                                .is_some_and(|it| it.callee().is_ident("$props"));
                            if !is_props || declarator.pat().tag() != PatTag::Object {
                                continue;
                            }
                            let mut found = Vec::new();
                            bindables(declarator.pat(), &mut found);
                            props.extend(
                                found
                                    .iter()
                                    .filter_map(|it| Some((it.as_ident()?.atom(), it.span()))),
                            );
                        }
                    }
                    StmtKind::ExportNamed(export) => {
                        for item in export.items().iter() {
                            let local = item.local();
                            let is_string = file
                                .slice(local.span())
                                .first()
                                .is_some_and(|it| matches!(it, b'"' | b'\''));
                            if !is_string {
                                props.push((local.name().atom(), local.span()));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        let mut has_prop = vec![false; it.variables.len()];
        for (name, span) in props {
            let Some(symbol) = top.get_name(file.name(name)) else {
                continue;
            };
            let variable = it
                .symbol_variables
                .get(symbol.key())
                .copied()
                .unwrap_or(NONE);
            let (Some(data), Some(seen)) = (
                it.variables.get_mut(variable as usize),
                has_prop.get_mut(variable as usize),
            ) else {
                continue;
            };
            if std::mem::replace(seen, true) {
                continue;
            }
            let id = it.references.len() as u32;
            it.references.push(ReferenceData {
                origin: Origin::Prop,
                program_reference: NONE,
                name,
                span,
                key: in_file(span.start),
                from: top.id().0,
                variable,
                flags: ReferenceFlags::READ | ReferenceFlags::WRITE | ReferenceFlags::INIT_UNSET,
                was_write_only: false,
            });
            add_reference(&mut data.references, &it.references, id);
        }

        // `scope.set`
        for (variable, at) in it.variables.iter().zip(0u32..) {
            it.by_name
                .entry((variable.scope, variable.name.0))
                .or_insert(at);
        }
        it.places = places;
        it
    }
}

/// The definitions of `symbol`, a variable the component declares, as svelte-eslint-parser has them.
fn definitions_of<'a>(file: &'a File<'a>, symbol: Symbol<'a>) -> Vec<DefinitionData> {
    // A block's or snippet's parameter, or a snippet's name.
    let binding = file.svelte_binding(symbol).filter(|it| {
        matches!(
            it.role,
            Role::Context
                | Role::Index
                | Role::Params
                | Role::Id
                | Role::Value
                | Role::Error
                | Role::Expression
        )
    });
    let mut out = Vec::new();
    for declaration in symbol.declarations() {
        let (Some(kind), Some(name)) = (declaration.kind(), declaration.name_span()) else {
            continue;
        };
        let other = node_in_component(file, declaration);
        let (node, parent) = match binding {
            Some(binding) => {
                let node = match binding.role {
                    // A `let:` is defined by its element.
                    Role::Expression => binding.scope_owner.unwrap_or(binding.node),
                    _ => binding.node,
                };
                (Some(DefNode::Svelte(node)), None)
            }
            None if kind == DeclarationKind::CatchClause => {
                (Some(DefNode::Program(symbol.scope().node())), None)
            }
            None if other.is_some() => (other, declaration.parent().map(DefNode::Program)),
            None => {
                let node = match declaration.node() {
                    // A parameter of a function type or an interface method is defined by the type or the method.
                    Some(Node::Func(func)) if kind == DeclarationKind::Parameter => {
                        match func.owner() {
                            Node::Type(ty) => Some(Node::Type(ty)),
                            Node::Member(member) if !matches!(member.parent(), Node::Class(_)) => {
                                Some(Node::Member(member))
                            }
                            _ => Some(Node::Func(func)),
                        }
                    }
                    node => node,
                };
                let mut parent = declaration.parent().map(DefNode::Program);
                if let Some(Node::VarDecl(declarator)) = node
                    && let Some((owner, _)) = file.svelte_owner(Node::VarDecl(declarator))
                    && owner.tag() == SvelteTag::ConstTag
                    && owner.code(Role::Declarations).and_then(|it| it.node())
                        == Some(Node::VarDecl(declarator))
                {
                    parent = Some(DefNode::Svelte(owner));
                }
                (node.map(DefNode::Program), parent)
            }
        };
        out.push(DefinitionData {
            kind: DefinitionKind::Declared(kind),
            name,
            node: node.map(Stored::of),
            parent: parent.map(Stored::of),
        });
    }
    out
}

/// `def.node` where ESLint's tree has a node with no counterpart here: a default or namespace import, and a `generics`
/// type parameter, which the program has in an alias.
fn node_in_component<'a>(file: &'a File<'a>, declaration: Declaration<'a>) -> Option<DefNode<'a>> {
    let in_file = |span: Span| match file.view() {
        Some(view) => {
            let start = view.in_file(span.start);
            Span::new(start, start + span.len())
        }
        None => span,
    };
    match declaration {
        Declaration::ImportDefault(import) => Some(DefNode::Other(
            "ImportDefaultSpecifier",
            in_file(import.default()?.span()),
        )),
        Declaration::ImportNamespace(import) => Some(DefNode::Other(
            "ImportNamespaceSpecifier",
            in_file(import.namespace_span()?),
        )),
        Declaration::TypeAlias(alias) => {
            let (component, name) = (file.svelte()?, in_file(alias.name().span()));
            let (span, kind, ..) = component.code(component.code_at(name)?)?;
            (kind == CodeKind::TypeParameters).then_some(DefNode::Other("TSTypeParameter", span))
        }
        _ => None,
    }
}

/// A variable of [`ComponentVariables`], or an undeclared global variable: ESLint's `Variable`.
#[derive(Copy, Clone)]
pub struct SvelteVariable<'a> {
    file: &'a File<'a>,
    of: Of,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Of {
    Local(u32),
    Global(Atom),
}

impl PartialEq for SvelteVariable<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.of == other.of
    }
}
impl Eq for SvelteVariable<'_> {}

impl std::fmt::Debug for SvelteVariable<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SvelteVariable({:?})", self.name())
    }
}

impl<'a> SvelteVariable<'a> {
    fn data(self) -> Option<&'a VariableData> {
        match self.of {
            Of::Local(id) => self.file.svelte_variables()?.variables.get(id as usize),
            Of::Global(_) => None,
        }
    }

    /// `variable.name`
    pub fn name(self) -> crate::ast::Name<'a> {
        match self.of {
            Of::Global(name) => self.file.name(name),
            Of::Local(_) => self.file.name(self.data().map_or(Atom::NONE, |it| it.name)),
        }
    }

    /// `variable.scope`
    pub fn scope(self) -> Scope<'a> {
        match self.data() {
            Some(data) => Scope::new(self.file, ScopeId(data.scope)),
            None => self.file.scope(),
        }
    }

    /// The program's symbol for it, if any. For a class name in its own scope, the enclosing symbol.
    pub fn symbol(self) -> Option<Symbol<'a>> {
        match self.data()?.origin {
            VariableOrigin::Symbol(key) => Some(Symbol::from_key(self.file, key as usize)),
            VariableOrigin::NameInClass(class) => match class.unpack(self.file) {
                Node::Class(class) => class.symbol(),
                _ => None,
            },
        }
    }

    /// Its index among the view's variables, which are in scope order. `None` for an undeclared global variable.
    pub fn index(self) -> Option<u32> {
        match self.of {
            Of::Local(id) => Some(id),
            Of::Global(_) => None,
        }
    }

    /// True if it's an undeclared variable that `$: x = ..` assigns.
    pub fn is_computed(self) -> bool {
        self.data().is_some_and(|it| it.is_computed)
    }

    /// `variable.defs`. A global variable has none.
    pub fn definitions(self) -> impl ExactSizeIterator<Item = SvelteDefinition<'a>> + 'a {
        let (file, data) = (self.file, self.data());
        let all = data.map_or(&[][..], |it| &it.definitions[..]);
        all.iter().map(move |data| SvelteDefinition { file, data })
    }

    /// `variable.references`, in order. A reference can appear twice, because svelte-eslint-parser adds a store's
    /// second and later `$x` twice.
    pub fn references(self) -> impl Iterator<Item = SvelteReference<'a>> + 'a {
        let file = self.file;
        let listed = self.data().map_or(&[][..], |it| &it.references[..]);
        let globals = match self.of {
            Of::Global(_) => file
                .svelte_variables()
                .map_or(&[][..], |it| &it.references[..]),
            Of::Local(_) => &[][..],
        };
        let global = match self.of {
            Of::Global(name) => name,
            Of::Local(_) => Atom::NONE,
        };
        let global_variables = (globals.iter().zip(0u32..))
            .filter(move |(it, _)| it.variable == NONE && it.name == global)
            .map(|it| it.1);
        listed
            .iter()
            .copied()
            .chain(global_variables)
            .map(move |id| SvelteReference { file, id })
    }
}

/// A [`SvelteVariable`]'s definition: ESLint's `Definition`.
#[derive(Copy, Clone)]
pub struct SvelteDefinition<'a> {
    file: &'a File<'a>,
    data: &'a DefinitionData,
}

impl<'a> SvelteDefinition<'a> {
    /// `def.type`
    pub fn kind(self) -> DefinitionKind {
        self.data.kind
    }

    /// The span of `def.name` in the program, without a type annotation.
    pub fn name_span(self) -> Span {
        self.data.name
    }

    /// `def.node`: the component node for a block's or snippet's parameter, the assignment for a `ComputedVariable`.
    pub fn node(self) -> Option<DefNode<'a>> {
        self.data.node.and_then(|it| it.get(self.file))
    }

    /// `def.parent`: a variable or import declaration, the `SvelteConstTag` of a `{@const}`, the `$:` statement of a
    /// `ComputedVariable`.
    pub fn parent(self) -> Option<DefNode<'a>> {
        self.data.parent.and_then(|it| it.get(self.file))
    }
}

/// A reference in [`ComponentVariables`]: ESLint's `Reference`.
#[derive(Copy, Clone)]
pub struct SvelteReference<'a> {
    file: &'a File<'a>,
    id: u32,
}

impl PartialEq for SvelteReference<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
impl Eq for SvelteReference<'_> {}

impl std::fmt::Debug for SvelteReference<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SvelteReference({:?}, {:?})", self.name(), self.span())
    }
}

impl<'a> SvelteReference<'a> {
    fn data(self) -> Option<&'a ReferenceData> {
        self.file
            .svelte_variables()?
            .references
            .get(self.id as usize)
    }

    pub fn origin(self) -> Origin {
        self.data().map_or(Origin::Written, |it| it.origin)
    }

    /// Its index among the view's references.
    #[inline]
    pub fn index(self) -> u32 {
        self.id
    }

    /// Where svelte-eslint-parser's scope manager reaches it in its script: in the scripts, in program order, or in a
    /// section after them at a component position, then in program order. For a synthesized reference with no source
    /// text, the start of the scripts.
    pub fn place(self) -> ScriptPlace {
        (self.file.svelte_variables())
            .and_then(|it| it.places.get(self.id as usize).copied())
            .unwrap_or_default()
    }

    /// True if svelte-eslint-parser only adds it to its variable's references (`addVirtualReference`), and to no scope.
    pub fn is_virtual(self) -> bool {
        matches!(
            self.origin(),
            Origin::Snippet | Origin::Prop | Origin::MarkedUsed
        )
    }

    /// The name of `reference.identifier`: `$x` for a store.
    pub fn name(self) -> crate::ast::Name<'a> {
        self.file.name(self.data().map_or(Atom::NONE, |it| it.name))
    }

    /// The span of `reference.identifier` in the program.
    pub fn span(self) -> Span {
        self.data().map_or_else(Span::default, |it| it.span)
    }

    /// `reference.from`
    pub fn scope(self) -> Scope<'a> {
        Scope::new(self.file, ScopeId(self.data().map_or(0, |it| it.from)))
    }

    pub fn flags(self) -> ReferenceFlags {
        self.data().map_or(ReferenceFlags::empty(), |it| it.flags)
    }

    pub fn is_read(self) -> bool {
        self.flags().contains(ReferenceFlags::READ)
    }

    pub fn is_write(self) -> bool {
        self.flags().contains(ReferenceFlags::WRITE)
    }

    pub fn is_read_only(self) -> bool {
        self.is_read() && !self.is_write()
    }

    pub fn is_write_only(self) -> bool {
        self.is_write() && !self.is_read()
    }

    /// The program reference, which has the identifier. `None` for references svelte-eslint-parser adds with no source
    /// text: a prop, a store variable marked as used.
    pub fn reference(self) -> Option<Reference<'a>> {
        let data = self.data()?;
        match data.origin {
            Origin::Written | Origin::Store | Origin::Snippet => {
                Reference::at_index(self.file, data.program_reference as usize)
            }
            Origin::Prop | Origin::MarkedUsed => None,
        }
    }

    /// The identifier, if it's a program expression.
    pub fn expr(self) -> Option<Expr<'a>> {
        self.reference()?.expr()
    }

    /// `reference.resolved`
    pub fn variable(self) -> Option<SvelteVariable<'a>> {
        let data = self.data()?;
        if data.variable != NONE {
            return Some(SvelteVariable {
                file: self.file,
                of: Of::Local(data.variable),
            });
        }
        let reference = self.reference()?;
        reference.global()?;
        Some(SvelteVariable {
            file: self.file,
            of: Of::Global(data.name),
        })
    }
}

impl<'a> File<'a> {
    /// The variables of the component whose program the file is: see [the module](self). For any other file, ESLint's.
    pub fn svelte_variables(&'a self) -> Option<&'a ComponentVariables> {
        Some(
            self.svelte_variables
                .get_or_init(|| Box::new(ComponentVariables::new(self))),
        )
    }

    /// `scope.set.get(name)`
    pub fn svelte_variable(
        &'a self,
        scope: Scope<'a>,
        name: crate::ast::Name<'a>,
    ) -> Option<SvelteVariable<'a>> {
        let variables = self.svelte_variables()?;
        if let Some(&id) = variables.by_name.get(&(scope.id().0, name.atom().0)) {
            return Some(SvelteVariable {
                file: self,
                of: Of::Local(id),
            });
        }
        let is_global = scope.kind() == ScopeKind::Global && self.global_named(name).is_some();
        is_global.then_some(SvelteVariable {
            file: self,
            of: Of::Global(name.atom()),
        })
    }

    /// eslint-utils' `findVariable(scope, name)`: the first scope from `scope` outwards that has a variable with that
    /// name.
    pub fn svelte_find_variable(
        &'a self,
        scope: Scope<'a>,
        name: crate::ast::Name<'a>,
    ) -> Option<SvelteVariable<'a>> {
        scope.chain().find_map(|it| self.svelte_variable(it, name))
    }

    /// `scope.variables`
    pub fn svelte_variables_of(
        &'a self,
        scope: Scope<'a>,
    ) -> impl Iterator<Item = SvelteVariable<'a>> + 'a {
        let variables = self.svelte_variables();
        let id = scope.id().0 as usize;
        let range =
            variables.and_then(|it| Some(*it.scope_starts.get(id)?..*it.scope_starts.get(id + 1)?));
        range.into_iter().flatten().map(move |id| SvelteVariable {
            file: self,
            of: Of::Local(id),
        })
    }

    /// The view reference for the program reference `reference`. `None` for one in synthesized code, and for the core's
    /// prop writes.
    pub fn svelte_reference(&'a self, reference: Reference<'a>) -> Option<SvelteReference<'a>> {
        let id = *self
            .svelte_variables()?
            .program_reference
            .get(reference.index())?;
        (id != NONE).then_some(SvelteReference { file: self, id })
    }

    /// Every view reference, sorted by its start in the component.
    pub fn svelte_references(&'a self) -> impl Iterator<Item = SvelteReference<'a>> + 'a {
        let count = self
            .svelte_variables()
            .map_or(0, |it| it.references.len() as u32);
        let mut ids: Vec<u32> = (0..count).collect();
        if let Some(variables) = self.svelte_variables() {
            ids.sort_by_key(|&it| variables.references.get(it as usize).map_or(0, |it| it.key));
        }
        ids.into_iter()
            .map(move |id| SvelteReference { file: self, id })
    }

    /// The variables whose `ComputedVariable` definition has `assignment`, a `$:` statement's assignment, as its node,
    /// in `scope.variables` order.
    pub fn svelte_computed_of(
        &'a self,
        assignment: Expr<'a>,
    ) -> impl Iterator<Item = SvelteVariable<'a>> + 'a {
        let computed = self
            .svelte_variables()
            .map_or(&[][..], |it| &it.computed[..]);
        let (start, packed) = (assignment.span().start, Node::Expr(assignment).packed());
        let from = computed.partition_point(|it| it.0 < start);
        let rest = computed.get(from..).unwrap_or_default();
        let mut found: Vec<u32> = (rest.iter())
            .take_while(|it| it.0 == start)
            .filter(|it| it.1 == packed)
            .map(|it| it.2)
            .collect();
        found.sort_unstable();
        found.into_iter().map(move |id| SvelteVariable {
            file: self,
            of: Of::Local(id),
        })
    }

    /// `symbol`'s variable in the view. `None` for one that only the lowering declares.
    pub fn svelte_variable_of(&'a self, symbol: Symbol<'a>) -> Option<SvelteVariable<'a>> {
        let id = *self
            .svelte_variables()?
            .symbol_variables
            .get(symbol.key())?;
        (id != NONE).then_some(SvelteVariable {
            file: self,
            of: Of::Local(id),
        })
    }
}
