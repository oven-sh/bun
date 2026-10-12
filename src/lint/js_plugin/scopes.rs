//! Scopes, variables, definitions and references of a file for JavaScript plugins, as arrays of numbers.
//!
//! [`crate::semantic`] does the analysis. This module turns the result into what `eslint-scope` or
//! `@typescript-eslint/scope-manager` report under ESLint, in their order, with ESTree nodes by number.
//! `worker/scope.js` only builds objects from the arrays.
//!
//! # The message
//!
//! [`HEADER`] words, then the parts in this order. A list is stored as its offset into the last part,
//! where its length comes before its items. Offset 0 is the empty list. [`NONE`] stands for `null`. A map is a list of pairs,
//! a node and a list.
//!
//! | Part | Words |
//! | --- | --- |
//! | header | counts of scopes, declared variables, all variables, definitions, references and implicit globals, the length of the lists, the list `scopeManager.scopes`, two maps, from a block to its scopes and from a node to the variables it declares, then how many of the implicit globals are in `globalScope.implicit` |
//! | scopes | 9 each: [`ScopeKind`] with flags from bit 8 on, block, upper scope, variable scope, last scope inside it, then the lists `childScopes`, `variables`, `references`, `through` |
//! | variables | 8 each: name, scope, flags, the lists `defs`, `references` and `identifiers`, what ESLint sets on a global with the shape above bit 8, the list of where the `/* global */` comments start |
//! | definitions | 7 each: [`DeclarationKind`], name, node, parent, index, flags, `kind` |
//! | references | 5 each: identifier, flags, written expression, resolved variable, scope |
//! | implicit globals | 1 each: a list of pairs, identifier and assigning node |
//! | lists | |
//!
//! Declared variables come first, scope by scope, in the order [`mark_used`] counts them. After them
//! come the second variable of each class declaration and the globals that the file doesn't declare. In a map the implicit
//! globals are numbered after all variables.
//!
//! A name is a number with a tag in its low 2 bits. See [`Name`].

use super::ast::Numbered;
use super::wire::{self, push_list};
use crate::ast::{ExprKind, File, Node};
use crate::estree::{Dialect, Field, NodeType, VNode, Value};
use crate::language::Global;
use crate::semantic::{Declaration, DeclarationKind, Reference, ReferenceFlags, Scope, ScopeKind};
use crate::span::Span;
use bun_core::strings::Utf16OffsetTable;
use rustc_hash::{FxHashMap, FxHashSet};

const HEADER: usize = 11;
const NONE: u32 = u32::MAX;

/// In the flags of a variable.
const IS_TYPE: u32 = 1 << 0;
const IS_VALUE: u32 = 1 << 1;
const IS_USED: u32 = 1 << 2;
const IS_EXPORTED: u32 = 1 << 3;
const IS_ARGUMENTS: u32 = 1 << 4;
/// In those of a global variable.
const IS_WRITABLE: u32 = 1 << 5;
const IS_IN_LIB: u32 = 1 << 6;
/// Something other than a TypeScript library defines it.
const IS_CONFIGURED: u32 = 1 << 7;
/// `variable.stack` of `eslint-scope`.
const IS_STACK: u32 = 1 << 8;
/// `variable.tainted` of `eslint-scope`.
const IS_TAINTED_VARIABLE: u32 = 1 << 9;

/// In the kind of a scope.
const IS_STRICT: u32 = 1 << 8;
/// `scope.thisFound` of `eslint-scope`.
const HAS_THIS: u32 = 1 << 9;
/// It's the scope of a function that has `arguments`, which `eslint-scope` has in `scope.taints`.
const HAS_ARGUMENTS: u32 = 1 << 10;

/// In the flags of a reference, above its [`ReferenceFlags`]. It refers to a global variable that the
/// file doesn't declare.
const TO_GLOBAL: u32 = 1 << 8;
/// `reference.partial` of `eslint-scope`.
const IS_PARTIAL: u32 = 1 << 9;
/// `reference.tainted` of `eslint-scope`.
const IS_TAINTED: u32 = 1 << 10;

/// In the flags of a definition. `definition.rest`.
const IS_REST: u32 = 1 << 0;
/// `eslint-scope` leaves `parent`, `index` and `kind` undefined for a class name in the class's own scope.
const LACKS_PARENT: u32 = 1 << 1;

/// In the bits of a global setting. The low 2 bits are `eslintImplicitGlobalSetting`.
const SETTING_UNDEFINED: u32 = 3;
const IS_WRITEABLE: u32 = 1 << 2;
/// The configuration or a comment names the variable, so it also has `eslintExplicitGlobal`.
const IS_NAMED: u32 = 1 << 3;
const IS_EXPLICIT: u32 = 1 << 4;
/// ESLint has set something on the variable.
const HAS_SETTING: u32 = 1 << 5;

/// The shape of a variable says which properties it has besides those of every variable. The four that ESLint sets on a global.
const SHAPE_GLOBAL: u32 = 1 << 0;
/// It's an `ImplicitLibVariable` of typescript-eslint.
const SHAPE_LIB: u32 = 1 << 1;
/// `eslintUsed`, which every variable of typescript-eslint has.
const SHAPE_USED: u32 = 1 << 2;
const SHAPE_EXPORTED: u32 = 1 << 3;

/// The first of the ESTree nodes made of `base` that `is_it` accepts.
fn find<'a>(
    base: Node<'a>,
    mut is_it: impl FnMut(VNode<'a>, NodeType) -> bool,
) -> Option<VNode<'a>> {
    let mut found = None;
    VNode::for_each_with_type_at(base, &mut |node, node_type| {
        if found.is_none() && is_it(node, node_type) {
            found = Some(node);
        }
    });
    found
}

/// The name that starts at `start` among the ESTree nodes made of `base`.
fn name_at(base: Node<'_>, start: u32) -> Option<VNode<'_>> {
    find(base, |node, node_type| {
        matches!(
            node_type,
            NodeType::Identifier
                | NodeType::JSXIdentifier
                | NodeType::Literal
                | NodeType::ThisExpression
        ) && node.span().start == start
    })
}

/// What the ESTree has where the expression `e` is.
fn expression<'a>(e: crate::ast::Expr<'a>) -> Option<VNode<'a>> {
    let base = match e.kind() {
        ExprKind::Fn(func) => Node::Func(func),
        ExprKind::Class(class) => Node::Class(class),
        _ => Node::Expr(e),
    };
    find(base, |_, _| true)
}

/// ESLint's `scope.block`.
fn block<'a>(scope: Scope<'a>) -> Option<VNode<'a>> {
    let span = scope.span();
    let with_span = |base: Node<'a>| find(base, |node, _| node.span() == span);
    match scope.node() {
        Node::File(file) => Some(VNode::program(file)),
        Node::Expr(e) => expression(e),
        Node::Func(func) => with_span(Node::Func(func)).or_else(|| with_span(func.owner())),
        Node::Stmt(_) if scope.kind() == ScopeKind::Catch => {
            find(scope.node(), |_, it| it == NodeType::CatchClause)
        }
        node => with_span(node).or_else(|| find(node, |_, _| true)),
    }
}

/// ESLint's `def.name`.
fn name_of<'a>(declaration: Declaration<'a>) -> Option<VNode<'a>> {
    let start = declaration.name_span()?.start;
    match declaration {
        Declaration::Var(pat) | Declaration::Param(pat) => name_at(Node::Pat(pat), start),
        Declaration::ImportSpec(it) => {
            match find(Node::ImportSpec(it), |_, _| true)?.field(Field::Local) {
                Value::Node(local) => Some(local),
                _ => None,
            }
        }
        _ => name_at(declaration.node()?, start),
    }
}

/// ESLint's `reference.identifier`.
fn identifier<'a>(reference: Reference<'a>) -> Option<VNode<'a>> {
    match reference.is_jsx_pragma() {
        true => name_of(reference.symbol()?.declarations().next()?),
        false => name_at(reference.node(), reference.span().start),
    }
}

/// Where the name of a variable comes from.
#[derive(Copy, Clone)]
enum Name {
    /// The `name` of this node, or its `value` if it's a `Literal`.
    Node(u32),
    Arguments,
    /// A list of its UTF-16 code units, which isn't empty.
    Units(u32),
    /// The key at this index of the configured globals.
    Configured(u32),
    /// A list with where the name starts and ends in the text.
    Text(u32),
}

impl Name {
    fn word(self) -> u32 {
        match self {
            Name::Node(id) => id << 2,
            Name::Arguments => 1,
            Name::Units(list) => list << 2 | 1,
            Name::Configured(index) => index << 2 | 2,
            Name::Text(list) => list << 2 | 3,
        }
    }
}

struct ScopeRecord {
    /// [`ScopeKind`], and flags from [`IS_STRICT`] on.
    kind: u32,
    block: u32,
    upper: Option<u32>,
    variable_scope: u32,
    /// The last scope inside it, or itself.
    last: u32,
    /// The first variable it declares. They end where those of the next scope start.
    first_variable: u32,
}

impl ScopeRecord {
    fn is(&self, kind: ScopeKind) -> bool {
        self.kind & 255 == kind as u32
    }

    fn is_strict(&self) -> bool {
        self.kind & IS_STRICT != 0
    }
}

struct VariableRecord<'t> {
    name: Name,
    text: &'t [u8],
    scope: u32,
    flags: u32,
    /// Its definitions are `first_definition..end_definition`, without those whose name isn't in the tree.
    first_definition: u32,
    end_definition: u32,
    /// What ESLint sets on it, if it's a global.
    settings: u32,
    /// A list of where the `/* global */` comments that name it start.
    comments: u32,
}

struct DefinitionRecord {
    kind: u32,
    name: u32,
    node: u32,
    parent: u32,
    index: u32,
    flags: u32,
    /// `kind` of the `VariableDeclaration`, from 1 in the order `var`, `let`, `const`, `using`, `await using`. 0 for `null`.
    declaration_kind: u32,
}

#[derive(Copy, Clone)]
struct ReferenceRecord<'t> {
    identifier: u32,
    flags: u32,
    written: u32,
    variable: u32,
    from: u32,
    name: &'t [u8],
}

/// The numbered ESTree.
struct Tree<'t, 'a> {
    nodes: &'t [VNode<'a>],
    types: &'t [u8],
    parents: &'t [u32],
    /// The last node inside each node, or the node itself.
    last: Vec<u32>,
}

const FUNCTION_TYPES: &[NodeType] = &[
    NodeType::FunctionDeclaration,
    NodeType::FunctionExpression,
    NodeType::ArrowFunctionExpression,
    NodeType::TSDeclareFunction,
    NodeType::TSEmptyBodyFunctionExpression,
    NodeType::TSFunctionType,
    NodeType::TSConstructorType,
    NodeType::TSCallSignatureDeclaration,
    NodeType::TSConstructSignatureDeclaration,
    NodeType::TSMethodSignature,
];

impl<'t, 'a> Tree<'t, 'a> {
    fn new(numbered: &'t Numbered<'a>) -> Self {
        let parents = &numbered.parents[..];
        let mut last: Vec<u32> = (0..parents.len() as u32).collect();
        for id in (1..parents.len()).rev() {
            let parent = parents[id] as usize;
            last[parent] = last[parent].max(last[id]);
        }
        Tree {
            nodes: &numbered.nodes,
            types: &numbered.types,
            parents,
            last,
        }
    }

    fn node_type(&self, id: u32) -> Option<NodeType> {
        NodeType::ALL
            .get(usize::from(*self.types.get(id as usize)?))
            .copied()
    }

    fn is(&self, id: u32, node_type: NodeType) -> bool {
        self.node_type(id) == Some(node_type)
    }

    /// [`NONE`] for the `Program`.
    fn parent(&self, id: u32) -> u32 {
        match id {
            0 => NONE,
            _ => self.parents.get(id as usize).copied().unwrap_or(NONE),
        }
    }

    fn last(&self, id: u32) -> u32 {
        self.last.get(id as usize).copied().unwrap_or(NONE)
    }

    /// The node that follows `id` and everything inside it.
    fn after(&self, id: u32) -> u32 {
        self.last(id).wrapping_add(1)
    }

    /// `id` or the closest node around it that has one of `types`.
    fn closest(&self, id: u32, types: &[NodeType]) -> u32 {
        let mut found = id;
        while let Some(node_type) = self.node_type(found) {
            if types.contains(&node_type) {
                return found;
            }
            found = self.parent(found);
        }
        NONE
    }

    fn field(&self, id: u32, field: Field) -> Value<'a> {
        self.nodes
            .get(id as usize)
            .map_or(Value::Undefined, |it| it.field(field))
    }

    fn has_node(&self, id: u32, field: Field) -> bool {
        matches!(self.field(id, field), Value::Node(_))
    }

    /// `nodes[id][field].indexOf(nodes[item])`
    fn index_in(&self, id: u32, field: Field, item: u32) -> u32 {
        match (self.field(id, field), self.nodes.get(item as usize)) {
            (Value::Nodes(list), Some(&item)) => list.index_of(item).map_or(NONE, |it| it as u32),
            _ => NONE,
        }
    }

    fn is_field(&self, id: u32, field: Field, item: u32) -> bool {
        matches!(
            (self.field(id, field), self.nodes.get(item as usize)),
            (Value::Node(node), Some(&item)) if node == item
        )
    }

    /// `reference.partial` of `eslint-scope`: `written` isn't what `identifier` has afterwards, only something that it's taken from.
    fn is_partial_write(&self, identifier: u32, written: u32) -> bool {
        let (around, writer) = (self.parent(identifier), self.parent(written));
        match self.node_type(writer) {
            // A default value is written to the whole left side.
            Some(NodeType::AssignmentPattern) if self.is_field(writer, Field::Right, written) => {
                around != writer
            }
            Some(NodeType::ForInStatement | NodeType::ForOfStatement)
                if self.is_field(writer, Field::Right, written) =>
            {
                true
            }
            _ => matches!(
                self.node_type(around),
                Some(
                    NodeType::Property
                        | NodeType::ArrayPattern
                        | NodeType::RestElement
                        | NodeType::AssignmentPattern
                )
            ),
        }
    }

    /// Fills in `node`, `parent`, `index` and the flags of a definition from its kind and its name.
    fn complete(&self, definition: &mut DefinitionRecord, is_espree: bool) {
        let name = definition.name;
        let around = self.parent(name);
        let is = |kind: DeclarationKind| definition.kind == kind as u32;
        let (node, parent) = if is(DeclarationKind::Variable) {
            let declarator = self.closest(name, &[NodeType::VariableDeclarator]);
            (declarator, self.parent(declarator))
        } else if is(DeclarationKind::Parameter) {
            (self.closest(name, FUNCTION_TYPES), NONE)
        } else if is(DeclarationKind::CatchClause) {
            (self.closest(name, &[NodeType::CatchClause]), NONE)
        } else if is(DeclarationKind::ImportBinding) {
            match self.is(around, NodeType::TSImportEqualsDeclaration) {
                true => (around, around),
                false => (around, self.parent(around)),
            }
        } else if is(DeclarationKind::TsModuleName) {
            (self.closest(around, &[NodeType::TSModuleDeclaration]), NONE)
        } else {
            (around, NONE)
        };
        let is_parameter = is(DeclarationKind::Parameter);
        if is_espree && is(DeclarationKind::Variable) {
            definition.index = self.index_in(parent, Field::Declarations, node);
            definition.declaration_kind = match self.field(parent, Field::Kind) {
                Value::Str(b"var") => 1,
                Value::Str(b"let") => 2,
                Value::Str(b"const") => 3,
                Value::Str(b"using") => 4,
                Value::Str(b"await using") => 5,
                _ => 0,
            };
        }
        if is_parameter {
            if is_espree {
                let mut parameter = name;
                while parameter != NONE && self.parent(parameter) != node {
                    parameter = self.parent(parameter);
                }
                definition.index = self.index_in(node, Field::Params, parameter);
            }
            if self.is(around, NodeType::RestElement)
                && self.is_field(around, Field::Argument, name)
            {
                definition.flags |= IS_REST;
            }
        }
        definition.node = node;
        definition.parent = parent;
    }
}

// ───────────── the order of typescript-eslint ─────────────

/// From `first` to `last`, both included. Empty if `first` is after `last`.
#[derive(Copy, Clone)]
struct Run {
    first: u32,
    last: u32,
}

/// Things in source order, each at a node, that can be put in another order.
struct Order {
    node_of: Vec<u32>,
    /// The things sorted by their nodes.
    sorted: Vec<u32>,
    /// Where each thing is in `order`.
    place: Vec<u32>,
    order: Vec<u32>,
    has_moved: bool,
}

impl Order {
    fn new(node_of: Vec<u32>) -> Order {
        let order: Vec<u32> = (0..node_of.len() as u32).collect();
        let mut sorted = order.clone();
        sorted.sort_unstable_by_key(|&it| (node_of[it as usize], it));
        Order {
            node_of,
            sorted,
            place: order.clone(),
            order,
            has_moved: false,
        }
    }

    /// The first of `sorted` that isn't before the node `id`.
    fn lower_bound(&self, id: u32) -> usize {
        self.sorted
            .partition_point(|&it| self.node_of[it as usize] < id)
    }

    /// The places of what is at the nodes in `runs`, if these places are next to each other.
    fn places(&self, runs: &[Run]) -> Option<Run> {
        let (mut first, mut last, mut found) = (u32::MAX, 0, 0);
        for run in runs.iter().filter(|it| it.first <= it.last) {
            let stop = self.lower_bound(run.last.saturating_add(1));
            for &it in &self.sorted[self.lower_bound(run.first).min(stop)..stop] {
                let at = self.place[it as usize];
                first = first.min(at);
                last = last.max(at);
                found += 1;
            }
        }
        (found > 0 && last - first == found - 1).then_some(Run { first, last })
    }

    /// Moves what is at the places `before` behind what is at the places `after`, which follow directly.
    fn exchange(&mut self, before: Option<Run>, after: Option<Run>) {
        let (Some(before), Some(after)) = (before, after) else {
            return;
        };
        if before.last + 1 != after.first {
            return;
        }
        self.order[before.first as usize..=after.last as usize]
            .rotate_left((after.first - before.first) as usize);
        for at in before.first..=after.last {
            self.place[self.order[at as usize] as usize] = at;
        }
        self.has_moved = true;
    }
}

/// Puts references and scopes in the order in which typescript-eslint's scope manager comes to them. It
/// visits a type annotation after the value, type arguments after the arguments, the type parameters of
/// a function after its parameters, and decorators last.
struct TypeScriptOrder<'o, 't, 'a> {
    tree: &'o Tree<'t, 'a>,
    orders: [&'o mut Order; 2],
}

impl TypeScriptOrder<'_, '_, '_> {
    /// What is at the nodes `before` comes after what is at the nodes `after`.
    fn exchange(&mut self, before: &[Run], after: &[Run]) {
        for order in &mut self.orders {
            let (before, after) = (order.places(before), order.places(after));
            order.exchange(before, after);
        }
    }

    /// The nodes from `first` to `middle` come after those from there to `last`.
    fn swap(&mut self, first: u32, middle: u32, last: u32) {
        let before = Run {
            first,
            last: middle,
        };
        let after = Run {
            first: middle.wrapping_add(1),
            last,
        };
        self.exchange(&[before], &[after]);
    }

    /// The end of the last decorator that `id` starts with, or `id` if it has none.
    fn decorators_of(&self, id: u32) -> u32 {
        let mut end = id;
        while end < self.tree.last(id) && self.tree.is(end + 1, NodeType::Decorator) {
            end = self.tree.last(end + 1);
        }
        end
    }

    /// The type annotation of the pattern `id`, which is its last child.
    fn annotation_of(&self, id: u32) -> Option<u32> {
        let (tree, mut child) = (self.tree, id.wrapping_add(1));
        if child > tree.last(id) {
            return None;
        }
        while tree.last(child) < tree.last(id) {
            child = tree.after(child);
        }
        tree.is(child, NodeType::TSTypeAnnotation).then_some(child)
    }

    /// `is_of_method`: the decorators of a method's parameters come before all the parameters.
    fn parameter(&mut self, id: u32, is_of_method: bool) {
        let (tree, decorators) = (self.tree, self.decorators_of(id));
        if tree.is(id, NodeType::TSParameterProperty) {
            self.parameter(decorators + 1, is_of_method);
        } else if tree.is(id, NodeType::AssignmentPattern) {
            let left = decorators + 1;
            if let Some(annotation) = self.annotation_of(left) {
                self.swap(annotation, tree.last(left), tree.last(id));
            }
        }
        if !is_of_method {
            self.swap(id + 1, decorators, tree.last(id));
        }
    }

    fn function(&mut self, id: u32) {
        let tree = self.tree;
        let mut child = match tree.has_node(id, Field::Id) {
            true => tree.after(id + 1),
            false => id + 1,
        };
        let type_parameters = tree
            .is(child, NodeType::TSTypeParameterDeclaration)
            .then_some(child);
        if type_parameters.is_some() {
            child = tree.after(child);
        }
        let mut end = child - 1;
        let is_of_method = matches!(
            tree.node_type(tree.parent(id)),
            Some(NodeType::MethodDefinition | NodeType::TSAbstractMethodDefinition)
        );
        let parameters = match tree.field(id, Field::Params) {
            Value::Nodes(list) => list.len(),
            _ => 0,
        };
        // The parameters so far, without their decorators.
        let mut undecorated = Vec::new();
        for _ in 0..parameters {
            self.parameter(child, is_of_method);
            if is_of_method {
                let decorators = self.decorators_of(child);
                let decorated = Run {
                    first: child + 1,
                    last: decorators,
                };
                self.exchange(&undecorated, &[decorated]);
                undecorated.push(Run {
                    first: decorators + 1,
                    last: tree.last(child),
                });
            }
            end = tree.last(child);
            child = end.wrapping_add(1);
        }
        if tree.has_node(id, Field::ReturnType) {
            end = tree.last(child);
        }
        if let Some(type_parameters) = type_parameters {
            self.swap(type_parameters, tree.last(type_parameters), end);
        }
    }

    fn class(&mut self, id: u32) {
        let tree = self.tree;
        if !tree.has_node(id, Field::TypeParameters) || !tree.has_node(id, Field::SuperClass) {
            return;
        }
        let mut child = self.decorators_of(id) + 1;
        if tree.has_node(id, Field::Id) {
            child = tree.after(child);
        }
        self.swap(child, tree.last(child), tree.last(tree.after(child)));
    }

    fn member(&mut self, id: u32) {
        let (tree, decorators) = (self.tree, self.decorators_of(id));
        let key = decorators + 1;
        let annotation = tree.after(key);
        let has_annotation =
            tree.last(key) < tree.last(id) && tree.is(annotation, NodeType::TSTypeAnnotation);
        if !has_annotation {
            return self.swap(id + 1, decorators, tree.last(id));
        }
        self.swap(annotation, tree.last(annotation), tree.last(id));
        let decorated = Run {
            first: id + 1,
            last: decorators,
        };
        let key = Run {
            first: key,
            last: tree.last(key),
        };
        let value = Run {
            first: tree.after(annotation),
            last: tree.last(id),
        };
        self.exchange(&[decorated], &[key, value]);
    }

    fn run(&mut self) {
        let tree = self.tree;
        for id in 0..tree.types.len() as u32 {
            let Some(node_type) = tree.node_type(id).filter(|_| tree.last(id) != id) else {
                continue;
            };
            match node_type {
                NodeType::VariableDeclarator => {
                    if let Some(annotation) = self.annotation_of(id + 1) {
                        self.swap(annotation, tree.last(id + 1), tree.last(id));
                    }
                }
                NodeType::FunctionDeclaration
                | NodeType::FunctionExpression
                | NodeType::ArrowFunctionExpression
                | NodeType::TSDeclareFunction
                | NodeType::TSEmptyBodyFunctionExpression => self.function(id),
                NodeType::ClassDeclaration | NodeType::ClassExpression => self.class(id),
                NodeType::PropertyDefinition
                | NodeType::AccessorProperty
                | NodeType::TSAbstractPropertyDefinition
                | NodeType::TSAbstractAccessorProperty
                | NodeType::MethodDefinition
                | NodeType::TSAbstractMethodDefinition => self.member(id),
                NodeType::CallExpression
                | NodeType::NewExpression
                | NodeType::TaggedTemplateExpression => {
                    let arguments = tree.after(id + 1);
                    if arguments <= tree.last(id)
                        && tree.is(arguments, NodeType::TSTypeParameterInstantiation)
                    {
                        self.swap(arguments, tree.last(arguments), tree.last(id));
                    }
                }
                NodeType::TSTypeAssertion => self.swap(id + 1, tree.last(id + 1), tree.last(id)),
                _ => {}
            }
        }
    }
}

// ───────────── lists ─────────────

/// Groups `values` by the key at the same index, which is below `count` or [`NONE`]. Appends a list for
/// each key, with its values in their order, and returns the offsets of the lists.
fn group(keys: &[u32], values: &[u32], count: usize, lists: &mut Vec<u32>) -> Vec<u32> {
    let mut lengths = vec![0u32; count];
    for &key in keys.iter().filter(|&&it| it != NONE) {
        lengths[key as usize] += 1;
    }
    let mut offsets = vec![0u32; count];
    // Where the next value of each key goes.
    let mut next = vec![0u32; count];
    for (key, &length) in lengths.iter().enumerate().filter(|it| *it.1 > 0) {
        offsets[key] = lists.len() as u32;
        next[key] = lists.len() as u32 + 1;
        lists.push(length);
        lists.resize(lists.len() + length as usize, 0);
    }
    for (&key, &value) in keys.iter().zip(values).filter(|it| *it.0 != NONE) {
        lists[next[key as usize] as usize] = value;
        next[key as usize] += 1;
    }
    offsets
}
// ───────────── the message ─────────────

/// Everything about the scopes of a file, while it's put together.
struct Builder<'t, 'a> {
    tree: Tree<'t, 'a>,
    is_espree: bool,
    scopes: Vec<ScopeRecord>,
    /// How many of `variables` the file declares.
    declared: u32,
    variables: Vec<VariableRecord<'t>>,
    definitions: Vec<DefinitionRecord>,
    references: Vec<ReferenceRecord<'t>>,
    /// For each global variable that is referred to and not declared: a reference to it, and its flags.
    referred: Vec<(u32, u32)>,
    /// By the index of a class scope: the second variable for the name of the class.
    inner_class_names: FxHashMap<u32, u32>,
    lists: Vec<u32>,
}

impl<'t, 'a> Builder<'t, 'a> {
    /// Takes the scopes, variables, definitions and references from [`crate::semantic`].
    fn collect(&mut self, file: &'a File<'a>) {
        let ids: FxHashMap<VNode<'a>, u32> = self.tree.nodes.iter().copied().zip(0..).collect();
        let id =
            |node: Option<VNode<'a>>| node.and_then(|it| ids.get(&it)).copied().unwrap_or(NONE);

        // By `Symbol::key`: the index of the variable.
        let mut index_of = vec![NONE; file.symbol_key_limit()];
        for scope in file.scopes() {
            let index = self.scopes.len() as u32;
            self.scopes.push(ScopeRecord {
                kind: scope.kind() as u32 | (u32::from(scope.is_strict()) * IS_STRICT),
                block: id(block(scope)),
                upper: scope.parent().map(|it| it.id().0),
                variable_scope: scope.variable_scope().id().0,
                last: index,
                first_variable: self.variables.len() as u32,
            });
            for symbol in scope.symbols() {
                if let Some(index) = index_of.get_mut(symbol.key()) {
                    *index = self.variables.len() as u32;
                }
                let flags = (u32::from(symbol.is_type_variable()) * IS_TYPE)
                    | (u32::from(symbol.is_value_variable()) * IS_VALUE)
                    | (u32::from(symbol.is_marked_used()) * IS_USED)
                    | (u32::from(symbol.is_marked_exported()) * IS_EXPORTED)
                    | (u32::from(symbol.is_implicit_arguments()) * IS_ARGUMENTS);
                let first_definition = self.definitions.len() as u32;
                for declaration in symbol.declarations() {
                    if let Some(kind) = declaration.kind() {
                        self.definitions.push(DefinitionRecord {
                            kind: kind as u32,
                            name: id(name_of(declaration)),
                            node: NONE,
                            parent: NONE,
                            index: NONE,
                            flags: 0,
                            declaration_kind: 0,
                        });
                    }
                }
                let first_name = self.definitions.get(first_definition as usize);
                self.variables.push(VariableRecord {
                    name: match symbol.is_implicit_arguments() {
                        true => Name::Arguments,
                        false => Name::Node(first_name.map_or(NONE, |it| it.name)),
                    },
                    text: symbol.name().bytes(),
                    scope: index,
                    flags,
                    first_definition,
                    end_definition: self.definitions.len() as u32,
                    settings: 0,
                    comments: 0,
                });
            }
        }
        self.declared = self.variables.len() as u32;
        for index in (1..self.scopes.len()).rev() {
            if let ScopeRecord {
                last,
                upper: Some(upper),
                ..
            } = self.scopes[index]
            {
                let upper = &mut self.scopes[upper as usize];
                upper.last = upper.last.max(last);
            }
        }

        let mut to_const = self.references_to_const().into_iter().peekable();
        let mut is_first_to_const = true;
        let mut seen = FxHashSet::default();
        for reference in file.references_as_visited() {
            // A rule can't see a reference whose identifier isn't in the tree.
            let identifier = id(identifier(reference));
            if identifier == NONE {
                continue;
            }
            while let Some(it) = to_const.next_if(|it| it.identifier < identifier) {
                self.add_reference_to_const(it, std::mem::take(&mut is_first_to_const));
            }
            let global = reference.global();
            if let Some(global) = global
                && seen.insert(reference.name().atom())
            {
                let flags = (u32::from(global.is_type) * IS_TYPE)
                    | (u32::from(global.is_value) * IS_VALUE)
                    | (u32::from(global.is_exported) * (IS_USED | IS_EXPORTED))
                    | (u32::from(global.is_writable) * IS_WRITABLE)
                    | (u32::from(global.is_in_lib) * IS_IN_LIB)
                    | (u32::from(!global.is_only_in_lib) * IS_CONFIGURED);
                self.referred.push((self.references.len() as u32, flags));
            }
            let written = id(reference.write_expr().and_then(expression));
            let is_partial = self.is_espree
                && reference.flags().contains(ReferenceFlags::WRITE)
                && self.tree.is_partial_write(identifier, written);
            self.references.push(ReferenceRecord {
                identifier,
                flags: u32::from(reference.flags().bits())
                    | (u32::from(global.is_some()) * TO_GLOBAL)
                    | (u32::from(is_partial) * IS_PARTIAL),
                written,
                variable: (reference.symbol())
                    .and_then(|it| index_of.get(it.key()))
                    .copied()
                    .unwrap_or(NONE),
                from: reference.scope().id().0,
                name: reference.name().bytes(),
            });
        }
        for it in to_const {
            self.add_reference_to_const(it, std::mem::take(&mut is_first_to_const));
        }
    }

    /// For typescript-eslint the `const` of `x as const` is a reference to a type that is called `const`, which it defines
    /// along with the libraries.
    fn references_to_const(&self) -> Vec<ReferenceRecord<'t>> {
        let mut found = Vec::new();
        if self.is_espree {
            return found;
        }
        // By its block: the innermost scope.
        let mut by_block: Option<FxHashMap<u32, u32>> = None;
        let reference = NodeType::TSTypeReference as u8;
        for (_, id) in (self.tree.types.iter().zip(0..)).filter(|it| *it.0 == reference) {
            let identifier = id + 1;
            let is_const = self.tree.is(identifier, NodeType::Identifier)
                && (self.tree.nodes.get(identifier as usize))
                    .is_some_and(|it| it.file().slice(it.span()) == b"const");
            if !is_const {
                continue;
            }
            let by_block = by_block
                .get_or_insert_with(|| self.scopes.iter().map(|it| it.block).zip(0..).collect());
            let mut node = id;
            while node != NONE && !by_block.contains_key(&node) {
                node = self.tree.parent(node);
            }
            found.push(ReferenceRecord {
                identifier,
                flags: u32::from((ReferenceFlags::READ | ReferenceFlags::TYPE).bits()) | TO_GLOBAL,
                written: NONE,
                variable: NONE,
                from: by_block.get(&node).copied().unwrap_or(0),
                name: b"const",
            });
        }
        found
    }

    fn add_reference_to_const(&mut self, reference: ReferenceRecord<'t>, is_first: bool) {
        if is_first {
            let flags = IS_TYPE | IS_IN_LIB;
            self.referred.push((self.references.len() as u32, flags));
        }
        self.references.push(reference);
    }

    /// Puts the references in typescript-eslint's order. Returns `scopeManager.scopes` in that order.
    fn order_as_typescript_eslint(&mut self) -> Vec<u32> {
        let mut references = Order::new(self.references.iter().map(|it| it.identifier).collect());
        let mut scopes = Order::new(self.scopes.iter().map(|it| it.block).collect());
        TypeScriptOrder {
            tree: &self.tree,
            orders: [&mut references, &mut scopes],
        }
        .run();
        if references.has_moved {
            let moved = references.order.iter();
            self.references = moved.map(|&it| self.references[it as usize]).collect();
            for (reference, _) in &mut self.referred {
                *reference = references.place[*reference as usize];
            }
        }
        scopes.order
    }

    fn contains(&self, scope: u32, inner: u32) -> bool {
        scope <= inner && inner <= self.scopes[scope as usize].last
    }

    /// A class declaration has a second variable for its name, in its own scope. That's what the name
    /// means inside the class.
    fn add_inner_class_names(&mut self) {
        // By the `id` of a class declaration: its scope.
        let scope_of_name: FxHashMap<u32, u32> = (self.scopes.iter().zip(0..))
            .filter(|(scope, _)| {
                scope.is(ScopeKind::Class) && self.tree.is(scope.block, NodeType::ClassDeclaration)
            })
            .filter(|(scope, _)| self.tree.has_node(scope.block, Field::Id))
            .map(|(scope, index)| (self.class_name(scope.block), index))
            .collect();
        if scope_of_name.is_empty() {
            return;
        }
        // By the variable around the class: the scopes of the classes that declare it.
        let mut outer: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
        for variable in 0..self.declared {
            let record = &self.variables[variable as usize];
            let (text, definitions) = (record.text, record.first_definition..record.end_definition);
            for definition in definitions {
                let DefinitionRecord { kind, name, .. } = self.definitions[definition as usize];
                let Some(&scope) = scope_of_name.get(&name) else {
                    continue;
                };
                if kind != DeclarationKind::ClassName as u32 {
                    continue;
                }
                let first_definition = self.definitions.len() as u32;
                self.definitions.push(DefinitionRecord {
                    kind,
                    name,
                    node: NONE,
                    parent: NONE,
                    index: NONE,
                    flags: 0,
                    declaration_kind: 0,
                });
                self.inner_class_names
                    .insert(scope, self.variables.len() as u32);
                self.variables.push(VariableRecord {
                    name: Name::Node(name),
                    text,
                    scope,
                    flags: IS_TYPE | IS_VALUE,
                    first_definition,
                    end_definition: first_definition + 1,
                    settings: 0,
                    comments: 0,
                });
                outer.entry(variable).or_default().push(scope);
            }
        }
        for at in 0..self.references.len() {
            let ReferenceRecord { variable, from, .. } = self.references[at];
            let scope = (outer.get(&variable).into_iter().flatten().rev())
                .find(|&&scope| self.contains(scope, from));
            if let Some(inner) = scope.and_then(|it| self.inner_class_names.get(it)) {
                self.references[at].variable = *inner;
            }
        }
    }

    /// The `id` of the class `block`, which comes after its decorators.
    fn class_name(&self, block: u32) -> u32 {
        let mut id = block + 1;
        while self.tree.is(id, NodeType::Decorator) {
            id = self.tree.after(id);
        }
        id
    }

    fn complete_definitions(&mut self) {
        for variable in &self.variables {
            let lacks_parent =
                self.is_espree && self.scopes[variable.scope as usize].is(ScopeKind::Class);
            for at in variable.first_definition..variable.end_definition {
                let definition = &mut self.definitions[at as usize];
                if definition.name == NONE {
                    continue;
                }
                self.tree.complete(definition, self.is_espree);
                if lacks_parent && definition.kind == DeclarationKind::ClassName as u32 {
                    definition.flags |= LACKS_PARENT;
                }
            }
        }
    }

    /// The definitions of `variable` whose names are in the tree.
    fn definitions_of(&self, variable: &VariableRecord) -> impl Iterator<Item = u32> {
        (variable.first_definition..variable.end_definition)
            .filter(|&it| self.definitions[it as usize].name != NONE)
    }

    /// Puts `scope.variables` of a scope other than the global one into `variables`.
    fn variables_of(&self, scope: u32, variables: &mut Vec<u32>) {
        let record = &self.scopes[scope as usize];
        let end =
            (self.scopes.get(scope as usize + 1)).map_or(self.declared, |it| it.first_variable);
        let inner = self.inner_class_names.get(&scope).copied();
        variables.clear();
        variables.extend(inner.into_iter().chain(record.first_variable..end));
        // typescript-eslint comes to the type parameters of a function after its parameters.
        let has_type_parameters = !self.is_espree
            && record.is(ScopeKind::Function)
            && self.tree.has_node(record.block, Field::TypeParameters);
        if !has_type_parameters {
            return;
        }
        let type_parameters = self.type_parameters_of(record.block);
        variables.sort_by_cached_key(|&it| {
            let variable = &self.variables[it as usize];
            let first = self.definitions.get(variable.first_definition as usize);
            let is = |kind: DeclarationKind| first.is_some_and(|it| it.kind == kind as u32);
            let declared_at = self.definitions_of(variable).next();
            if variable.flags & IS_ARGUMENTS != 0 {
                0
            } else if is(DeclarationKind::Parameter) {
                1
            } else if is(DeclarationKind::Type)
                && declared_at.is_some_and(|it| {
                    self.tree.parent(self.definitions[it as usize].node) == type_parameters
                })
            {
                2
            } else {
                3
            }
        });
    }

    /// The `typeParameters` of the function `block`, which come after its `id`.
    fn type_parameters_of(&self, block: u32) -> u32 {
        match self.tree.has_node(block, Field::Id) {
            true => self.tree.after(block + 1),
            false => block + 1,
        }
    }
}

/// What ESLint sets on a variable of the global scope.
struct GlobalSetting {
    variable: u32,
    bits: u32,
    /// A list of where the `/* global */` comments that name it start.
    comments: u32,
}

/// ESLint's `configGlobals`.
#[derive(Debug)]
pub(super) struct ConfiguredGlobals {
    /// In the order of its keys.
    list: Vec<(Box<[u8]>, Global)>,
    index_of: FxHashMap<Box<[u8]>, usize>,
    /// For each: [`IS_IN_LIB`] with [`IS_TYPE`] and [`IS_VALUE`] if a library of TypeScript defines it too.
    lib_flags: Vec<u32>,
}

impl ConfiguredGlobals {
    /// `libs`: what the libraries of TypeScript define. The name, whether it's a type, whether it's a value.
    pub(super) fn new<'n>(
        list: Vec<(Box<[u8]>, Global)>,
        libs: impl Iterator<Item = (&'n [u8], bool, bool)>,
    ) -> ConfiguredGlobals {
        let index_of: FxHashMap<Box<[u8]>, usize> =
            list.iter().map(|it| it.0.clone()).zip(0..).collect();
        let mut lib_flags = vec![0; list.len()];
        for (name, is_type, is_value) in libs {
            if let Some(&index) = index_of.get(name) {
                lib_flags[index] =
                    IS_IN_LIB | (u32::from(is_type) * IS_TYPE) | (u32::from(is_value) * IS_VALUE);
            }
        }
        ConfiguredGlobals {
            list,
            index_of,
            lib_flags,
        }
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = &(Box<[u8]>, Global)> {
        self.list.iter()
    }

    fn index_of(&self, name: &[u8]) -> Option<usize> {
        self.index_of.get(name).copied()
    }
}

/// A number for each name of a global variable.
struct GlobalNames<'t> {
    configured: &'t ConfiguredGlobals,
    /// By the index of a configured global.
    of_configured: Vec<u32>,
    others: FxHashMap<&'t [u8], u32>,
}

impl<'t> GlobalNames<'t> {
    /// The number of `name`. A name that isn't configured starts with [`NONE`].
    fn slot(&mut self, name: &'t [u8]) -> &mut u32 {
        match self.configured.index_of(name) {
            Some(index) => &mut self.of_configured[index],
            None => self.others.entry(name).or_insert(NONE),
        }
    }

    fn get(&self, name: &[u8]) -> Option<u32> {
        match self.configured.index_of(name) {
            Some(index) => Some(self.of_configured[index]),
            None => self.others.get(name).copied(),
        }
    }
}

fn setting_bits(setting: Global) -> u32 {
    match setting {
        Global::Readonly => 0,
        Global::Writable => 1,
        Global::Off => 2,
    }
}

impl<'t, 'a> Builder<'t, 'a> {
    /// ESLint's `addDeclaredGlobals`. Adds the globals that the file doesn't declare to `variables`, which are those of
    /// the global scope: those of the TypeScript libraries that the file refers to, those of the configuration and those
    /// of `/* global */` comments. Resolves the references to them.
    fn add_globals(
        &mut self,
        file: &'a File<'a>,
        offsets: &Utf16OffsetTable,
        configured: &'t ConfiguredGlobals,
        variables: &mut Vec<u32>,
    ) {
        // The variable of each name so far. Configured names are found by their index, so that a file only hashes the names
        // that it mentions.
        let mut named = GlobalNames {
            configured,
            of_configured: vec![NONE; configured.list.len()],
            others: FxHashMap::default(),
        };
        for &variable in variables.iter() {
            *named.slot(self.variables[variable as usize].text) = variable;
        }
        // The flags of the globals that are referred to, found the same way.
        let mut flags_of = GlobalNames {
            configured,
            of_configured: vec![0; configured.list.len()],
            others: FxHashMap::default(),
        };
        for &(reference, flags) in &self.referred {
            *flags_of.slot(self.references[reference as usize].name) = flags;
        }
        let mut comment_of = vec![None; configured.list.len()];
        for comment in file.globals_in_comments() {
            if let Some(index) = configured.index_of(&comment.name) {
                comment_of[index] = Some(comment);
            }
        }

        let end_definition = self.definitions.len() as u32;
        let all = &mut self.variables;
        let mut define = |slot: &mut u32, text: &'t [u8], name: Name, flags: u32| {
            if *slot == NONE {
                *slot = all.len() as u32;
                variables.push(*slot);
                all.push(VariableRecord {
                    name,
                    text,
                    scope: 0,
                    flags,
                    first_definition: end_definition,
                    end_definition,
                    settings: 0,
                    comments: 0,
                });
            }
            *slot
        };

        let mut settings = Vec::with_capacity(configured.list.len());
        for &(reference, flags) in &self.referred {
            if flags & IS_CONFIGURED == 0 {
                let ReferenceRecord {
                    identifier, name, ..
                } = self.references[reference as usize];
                settings.push(GlobalSetting {
                    variable: define(named.slot(name), name, Name::Node(identifier), flags),
                    bits: setting_bits(Global::Readonly),
                    comments: 0,
                });
            }
        }
        let lists = &mut self.lists;
        let starts_of = |comments: &[Span]| -> Vec<u32> {
            comments
                .iter()
                .map(|it| offsets.to_utf16(it.start))
                .collect()
        };
        for (index, (name, implicit)) in configured.list.iter().enumerate() {
            let comment = comment_of[index];
            let setting = comment.map_or(*implicit, |it| it.setting);
            if setting == Global::Off {
                continue;
            }
            let (slot, flags) = (
                &mut named.of_configured[index],
                flags_of.of_configured[index] | configured.lib_flags[index],
            );
            settings.push(GlobalSetting {
                variable: define(slot, name, Name::Configured(index as u32), flags),
                bits: setting_bits(*implicit)
                    | IS_NAMED
                    | (u32::from(setting == Global::Writable) * IS_WRITEABLE)
                    | (u32::from(comment.is_some()) * IS_EXPLICIT),
                comments: comment.map_or(0, |it| push_list(lists, &starts_of(&it.comments))),
            });
        }
        // ESLint 8 counts what `/* eslint-env */` comments define among the configured globals.
        for (name, implicit) in file.globals_of_environments_in_comments() {
            let comment = file.global_in_comments(name);
            let setting = comment.map_or(implicit, |it| it.setting);
            if configured.index_of(name).is_some() || setting == Global::Off {
                continue;
            }
            let units: Vec<u32> = (bun_core::strings::wtf8_to_utf16(name).iter())
                .map(|&it| u32::from(it))
                .collect();
            let written = Name::Units(push_list(lists, &units));
            let flags = flags_of.get(name).unwrap_or(0);
            settings.push(GlobalSetting {
                variable: define(named.slot(name), name, written, flags),
                bits: setting_bits(implicit)
                    | IS_NAMED
                    | (u32::from(setting == Global::Writable) * IS_WRITEABLE)
                    | (u32::from(comment.is_some()) * IS_EXPLICIT),
                comments: comment.map_or(0, |it| push_list(lists, &starts_of(&it.comments))),
            });
        }
        for comment in file.globals_in_comments() {
            let is_configured = configured.index_of(&comment.name).is_some()
                || (file.global_of_environment_in_comments(&comment.name)).is_some();
            if is_configured || comment.setting == Global::Off {
                continue;
            }
            let span = comment.comments.first().map_or(Span::new(0, 0), |it| {
                file.name_in_global_comment(*it, &comment.name)
            });
            let comments = push_list(lists, &starts_of(&comment.comments));
            let text = [offsets.to_utf16(span.start), offsets.to_utf16(span.end)];
            let name = Name::Text(push_list(lists, &text));
            let flags = flags_of.get(&comment.name).unwrap_or(0);
            settings.push(GlobalSetting {
                variable: define(named.slot(&comment.name), &comment.name, name, flags),
                bits: SETTING_UNDEFINED
                    | IS_NAMED
                    | IS_EXPLICIT
                    | (u32::from(comment.setting == Global::Writable) * IS_WRITEABLE),
                comments,
            });
        }

        for reference in &mut self.references {
            if reference.variable == NONE && reference.flags & TO_GLOBAL != 0 {
                reference.variable = named.get(reference.name).unwrap_or(NONE);
            }
        }
        for it in settings {
            let variable = &mut self.variables[it.variable as usize];
            variable.settings = it.bits | HAS_SETTING;
            variable.comments = it.comments;
        }
    }

    /// typescript-eslint's `variable.isTypeVariable` or `isValueVariable` of a variable without definitions.
    fn accepts(&self, variable: u32, flag: u32) -> bool {
        let flags = self.variables[variable as usize].flags;
        flags & IS_IN_LIB == 0 || flags & flag != 0
    }

    /// `variable.references` of every variable.
    fn references_by_variable(&mut self) -> Vec<u32> {
        // A reference that only resolves to a declared variable by its name isn't among the references of that variable.
        let declared_until = self.declared + self.inner_class_names.len() as u32;
        let keys: Vec<u32> = (self.references.iter())
            .map(
                |it| match it.flags & TO_GLOBAL != 0 && it.variable < declared_until {
                    true => NONE,
                    false => it.variable,
                },
            )
            .collect();
        let mut values: Vec<u32> = (0..keys.len() as u32).collect();
        if !self.is_espree {
            // typescript-eslint resolves what the libraries say a name can be. `Promise` is only a type in the first library
            // that has it. ESLint resolves the rest afterwards.
            values.sort_by_key(|&it| {
                let reference = &self.references[it as usize];
                let is = |flag: ReferenceFlags| reference.flags & u32::from(flag.bits()) != 0;
                reference.flags & TO_GLOBAL != 0
                    && reference.variable != NONE
                    && !(is(ReferenceFlags::TYPE) && self.accepts(reference.variable, IS_TYPE)
                        || is(ReferenceFlags::VALUE) && self.accepts(reference.variable, IS_VALUE))
            });
        }
        let keys: Vec<u32> = values.iter().map(|&it| keys[it as usize]).collect();
        group(&keys, &values, self.variables.len(), &mut self.lists)
    }

    /// `scope.through` of every scope.
    fn through(&mut self) -> Vec<u32> {
        let (mut keys, mut values) = (Vec::new(), Vec::new());
        // The references that leave a `with` statement, where nobody knows what a name means.
        let mut tainted = Vec::new();
        for (reference, index) in self.references.iter().zip(0..) {
            let is_to_global = reference.flags & TO_GLOBAL != 0;
            // Where it resolves. It goes through every scope from its own up to there.
            let home = match is_to_global {
                true => None,
                false => self
                    .variables
                    .get(reference.variable as usize)
                    .map(|it| it.scope),
            };
            let mut next = Some(reference.from);
            while let Some(scope) =
                next.filter(|&it| home.is_none_or(|home| !self.contains(it, home)))
            {
                if scope != 0 || !is_to_global {
                    keys.push(scope);
                    values.push(index);
                }
                if self.scopes[scope as usize].is(ScopeKind::With) && tainted.last() != Some(&index)
                {
                    tainted.push(index);
                }
                next = self.scopes[scope as usize].upper;
            }
        }
        for index in tainted {
            let reference = &mut self.references[index as usize];
            reference.flags |= IS_TAINTED;
            if reference.flags & TO_GLOBAL == 0
                && let Some(variable) = self.variables.get_mut(reference.variable as usize)
            {
                variable.flags |= IS_TAINTED_VARIABLE;
            }
        }
        group(&keys, &values, self.scopes.len(), &mut self.lists)
    }

    /// The variables that an assignment in sloppy mode creates: for each a list of pairs, the identifier that is assigned to and
    /// the node that assigns. `through`: that of the global scope.
    fn implicit_globals(&mut self, through: u32) -> ImplicitGlobals {
        let length = self.lists[through as usize] as usize;
        let through = self.lists[through as usize + 1..][..length].to_vec();
        let kept = self.implicit_globals_among(through.into_iter());
        // `eslint-scope` has made one for a global of the configuration too. ESLint takes it out of `globalScope.implicit`
        // again, and `getDeclaredVariables()` still finds it.
        let to_globals = (0..self.references.len() as u32)
            .filter(|&it| self.references[it as usize].flags & TO_GLOBAL != 0)
            .collect::<Vec<u32>>();
        let removed = self.implicit_globals_among(to_globals.into_iter());
        ImplicitGlobals {
            kept: kept.len() as u32,
            lists: kept.into_iter().chain(removed).collect(),
        }
    }

    fn implicit_globals_among(&mut self, references: impl Iterator<Item = u32>) -> Vec<u32> {
        let mut by_name: FxHashMap<&[u8], usize> = FxHashMap::default();
        let mut variables: Vec<Vec<u32>> = Vec::new();
        for reference in references.map(|it| &self.references[it as usize]) {
            let only_writes = reference.flags & 3 == u32::from(ReferenceFlags::WRITE.bits());
            let is_init = reference.flags & u32::from(ReferenceFlags::INIT.bits()) != 0;
            if !only_writes || is_init || self.scopes[reference.from as usize].is_strict() {
                continue;
            }
            let at = *by_name.entry(reference.name).or_insert_with(|| {
                variables.push(Vec::new());
                variables.len() - 1
            });
            let assigning = &[
                NodeType::AssignmentExpression,
                NodeType::ForInStatement,
                NodeType::ForOfStatement,
            ];
            variables[at].extend_from_slice(&[
                reference.identifier,
                self.tree.closest(reference.identifier, assigning),
            ]);
        }
        (variables.iter())
            .map(|it| push_list(&mut self.lists, it))
            .collect()
    }
}

/// See [`Builder::implicit_globals`].
struct ImplicitGlobals {
    lists: Vec<u32>,
    /// How many of them are in `globalScope.implicit`. They come first.
    kept: u32,
}

impl Builder<'_, '_> {
    /// `variable.stack`: every reference that `eslint-scope` itself has resolved comes from the function that declares the
    /// variable. ESLint resolves the references to the globals that it adds, and leaves `stack` alone.
    fn set_stack(&mut self) {
        for variable in &mut self.variables {
            variable.flags |= IS_STACK;
        }
        let function_of = |scope: u32| self.scopes[scope as usize].variable_scope;
        for reference in self
            .references
            .iter()
            .filter(|it| it.flags & TO_GLOBAL == 0)
        {
            if let Some(variable) = self.variables.get_mut(reference.variable as usize)
                && function_of(reference.from) != function_of(variable.scope)
            {
                variable.flags &= !IS_STACK;
            }
        }
    }

    /// Sets [`HAS_THIS`] and [`HAS_ARGUMENTS`].
    fn find_this_and_arguments(&mut self) {
        // By its block: the innermost scope that `this` can belong to.
        let mut by_block: FxHashMap<u32, usize> = FxHashMap::default();
        for (index, scope) in self.scopes.iter_mut().enumerate() {
            if scope.variable_scope as usize == index {
                by_block.insert(scope.block, index);
            }
            if scope.is(ScopeKind::Function)
                && !self.tree.is(scope.block, NodeType::ArrowFunctionExpression)
            {
                scope.kind |= HAS_ARGUMENTS;
            }
        }
        let this = NodeType::ThisExpression as u8;
        for (_, id) in (self.tree.types.iter().zip(0..)).filter(|it| *it.0 == this) {
            let mut node = id;
            while node != NONE {
                if let Some(&scope) = by_block.get(&node) {
                    self.scopes[scope].kind |= HAS_THIS;
                    break;
                }
                node = self.tree.parent(node);
            }
        }
    }

    fn shape_of(&self, variable: &VariableRecord) -> u32 {
        let has = |flag: u32| variable.flags & flag != 0;
        let is_lib = !self.is_espree && has(IS_IN_LIB);
        (u32::from(variable.settings & HAS_SETTING != 0 && !is_lib) * SHAPE_GLOBAL)
            | (u32::from(is_lib) * SHAPE_LIB)
            | (u32::from(self.is_espree && has(IS_USED)) * SHAPE_USED)
            | (u32::from(has(IS_EXPORTED)) * SHAPE_EXPORTED)
    }

    /// Makes a map of `keys`, which are nodes, and the values at the same indices. The nodes are in the order in which they
    /// come first.
    fn map_of(&mut self, keys: &[u32], values: &[u32]) -> u32 {
        let mut lists_by_node = group(keys, values, self.tree.types.len(), &mut self.lists);
        let mut pairs = Vec::new();
        for &node in keys.iter().filter(|&&it| it != NONE) {
            let list = std::mem::take(&mut lists_by_node[node as usize]);
            if list != 0 {
                pairs.extend_from_slice(&[node, list]);
            }
        }
        push_list(&mut self.lists, &pairs)
    }

    /// From the block of a scope to the scopes that have it, in the order of `listed`.
    fn node_to_scope(&mut self, listed: &[u32]) -> u32 {
        let blocks: Vec<u32> = (listed.iter())
            .map(|&it| self.scopes[it as usize].block)
            .collect();
        self.map_of(&blocks, listed)
    }

    /// From the `node` and the `parent` of a definition to the variables that have such a definition.
    fn declared_variables(&mut self, listed: &[u32], variables: &[u32], implicit: &[u32]) -> u32 {
        // The name, `node`, `parent` and variable of every definition. `eslint-scope` adds a variable to the list of a node when
        // it comes to a definition.
        let mut definitions = Vec::new();
        for &scope in listed {
            let at = variables[scope as usize] as usize;
            for &variable in &self.lists[at + 1..][..self.lists[at] as usize] {
                for definition in self.definitions_of(&self.variables[variable as usize]) {
                    let it = &self.definitions[definition as usize];
                    definitions.push((it.name, it.node, it.parent, variable));
                }
            }
        }
        definitions.sort_by_key(|it| it.0);
        // It makes the implicit globals last, in the order of the assignments.
        let first_implicit = definitions.len();
        for (&pairs, variable) in implicit.iter().zip(self.variables.len() as u32..) {
            let at = pairs as usize;
            let pairs = self.lists[at + 1..][..self.lists[at] as usize]
                .as_chunks::<2>()
                .0;
            definitions.extend(
                pairs
                    .iter()
                    .map(|&[name, node]| (name, node, NONE, variable)),
            );
        }
        definitions[first_implicit..].sort_by_key(|it| it.0);

        let (mut keys, mut values) = (Vec::new(), Vec::new());
        let mut seen = FxHashSet::default();
        for (_, node, parent, variable) in definitions {
            for node in [node, parent] {
                if node != NONE && seen.insert((node, variable)) {
                    keys.push(node);
                    values.push(variable);
                }
            }
        }
        self.map_of(&keys, &values)
    }
}

/// Appends the message. `configured`: ESLint's `configGlobals`, in the order of its keys.
pub(super) fn write<'t, 'a>(
    file: &'a File<'a>,
    offsets: &Utf16OffsetTable,
    numbered: &'t Numbered<'a>,
    configured: &'t ConfiguredGlobals,
    out: &mut Vec<u8>,
) {
    let mut builder = Builder {
        tree: Tree::new(numbered),
        is_espree: Dialect::of(file) == Dialect::Espree,
        scopes: Vec::new(),
        declared: 0,
        variables: Vec::new(),
        definitions: Vec::new(),
        references: Vec::new(),
        referred: Vec::new(),
        inner_class_names: FxHashMap::default(),
        lists: vec![0],
    };
    builder.collect(file);
    let listed = match builder.is_espree {
        true => (0..builder.scopes.len() as u32).collect(),
        false => builder.order_as_typescript_eslint(),
    };
    builder.add_inner_class_names();
    builder.complete_definitions();

    let end_of_global = builder
        .scopes
        .get(1)
        .map_or(builder.declared, |it| it.first_variable);
    let mut global_variables: Vec<u32> = (0..end_of_global).collect();
    builder.add_globals(file, offsets, configured, &mut global_variables);
    builder.set_stack();
    if builder.is_espree {
        builder.find_this_and_arguments();
    }

    let uppers: Vec<u32> = (listed.iter())
        .map(|&it| builder.scopes[it as usize].upper.unwrap_or(NONE))
        .collect();
    let scope_count = builder.scopes.len();
    let child_scopes = group(&uppers, &listed, scope_count, &mut builder.lists);
    let from: Vec<u32> = builder.references.iter().map(|it| it.from).collect();
    let indices: Vec<u32> = (0..from.len() as u32).collect();
    let references_by_scope = group(&from, &indices, scope_count, &mut builder.lists);
    let references_by_variable = builder.references_by_variable();
    let through = builder.through();
    let implicit = builder.implicit_globals(through.first().copied().unwrap_or(0));

    // The list that is being put together.
    let mut list = global_variables;
    let variables_by_scope: Vec<u32> = (0..scope_count as u32)
        .map(|scope| {
            if scope != 0 {
                builder.variables_of(scope, &mut list);
            }
            push_list(&mut builder.lists, &list)
        })
        .collect();
    let node_to_scope = builder.node_to_scope(&listed);
    let declared_variables =
        builder.declared_variables(&listed, &variables_by_scope, &implicit.lists);
    let listed = push_list(&mut builder.lists, &listed);

    let mut words = Vec::with_capacity(
        9 * scope_count
            + 8 * builder.variables.len()
            + 7 * builder.definitions.len()
            + 5 * builder.references.len()
            + implicit.lists.len(),
    );
    for (scope, at) in builder.scopes.iter().zip(0..) {
        words.extend_from_slice(&[
            scope.kind,
            scope.block,
            scope.upper.unwrap_or(NONE),
            scope.variable_scope,
            scope.last,
            child_scopes[at],
            variables_by_scope[at],
            references_by_scope[at],
            through[at],
        ]);
    }
    for (variable, &references) in builder.variables.iter().zip(&references_by_variable) {
        list.clear();
        list.extend(builder.definitions_of(variable));
        let definitions = push_list(&mut builder.lists, &list);
        // A name in quotes is no identifier.
        list.retain_mut(|it| {
            *it = builder.definitions[*it as usize].name;
            !builder.tree.is(*it, NodeType::Literal)
        });
        let identifiers = push_list(&mut builder.lists, &list);
        words.extend_from_slice(&[
            variable.name.word(),
            variable.scope,
            variable.flags,
            definitions,
            references,
            identifiers,
            variable.settings | builder.shape_of(variable) << 8,
            variable.comments,
        ]);
    }
    for it in &builder.definitions {
        words.extend_from_slice(&[
            it.kind,
            it.name,
            it.node,
            it.parent,
            it.index,
            it.flags,
            it.declaration_kind,
        ]);
    }
    for it in &builder.references {
        words.extend_from_slice(&[it.identifier, it.flags, it.written, it.variable, it.from]);
    }
    words.extend_from_slice(&implicit.lists);

    let header: [u32; HEADER] = [
        scope_count as u32,
        builder.declared,
        builder.variables.len() as u32,
        builder.definitions.len() as u32,
        builder.references.len() as u32,
        implicit.lists.len() as u32,
        builder.lists.len() as u32,
        listed,
        node_to_scope,
        declared_variables,
        implicit.kept,
    ];
    wire::words(out, &header);
    wire::words(out, &words);
    wire::words(out, &builder.lists);
}

/// Sets ESLint's `variable.eslintUsed` for the variables at `indices`, which are sorted.
pub(super) fn mark_used<'a>(file: &'a File<'a>, indices: impl Iterator<Item = u32>) {
    let mut indices = indices.peekable();
    if indices.peek().is_none() {
        return;
    }
    for (index, symbol) in file.scopes().flat_map(Scope::symbols).enumerate() {
        if indices.next_if_eq(&(index as u32)).is_some() {
            symbol.mark_used();
        }
    }
}
