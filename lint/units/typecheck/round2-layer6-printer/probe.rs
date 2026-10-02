// A file that stands alone: stand-ins with the shapes of ast/visitor.rs, ast/factory.rs and printer/factory.rs of src/typecheck, to ask rustc about lifetimes and closures only.
// From the tree: the five aliases of ast/visitor.rs letter for letter; the code lines of NodeClone, of its impl for Factory, of get_deep_clone_visitor and of deep_clone_node without their comments and without `.as_slice()` (twice); the code of the record, the constructor, the inherent impl and the NodeClone impl of printer::NodeFactory.
// Not from the tree: every other body and signature (fewer members, three of the nine hooks, a slice where the tree has a List, a tuple where it has a TextRange, no bun_core).
// Run: rustc --edition 2024 --crate-type bin --emit=metadata -o /tmp/probe.rmeta probe.rs
#![deny(warnings)]
#![deny(dead_code, unreachable_pub, unused_imports, unused_variables, unused_mut)]
use std::cell::Cell;

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct NodeId(pub u32);
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct NodeListId(pub u32);
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct ModifierListId(pub u32);
impl NodeId {
    pub const NIL: Self = Self(0);
    pub const fn is_nil(self) -> bool {
        self.0 == 0
    }
}
impl NodeListId {
    pub const NIL: Self = Self(0);
    pub const fn is_nil(self) -> bool {
        self.0 == 0
    }
}
impl ModifierListId {
    pub const NIL: Self = Self(0);
    pub const fn is_nil(self) -> bool {
        self.0 == 0
    }
    pub const fn as_node_list(self) -> NodeListId {
        NodeListId(self.0)
    }
}

pub struct Open<'a> {
    pub mark: Cell<&'a u8>,
    pub count: Cell<u32>,
}

#[derive(Clone, Copy)]
pub struct Ast<'a> {
    pub open: &'a Open<'a>,
}

impl<'a> Ast<'a> {
    pub fn set_loc(self, _node: NodeId, _loc: (i32, i32)) {}
    pub fn set_list_loc(self, _list: NodeListId, _loc: (i32, i32)) {}
    pub fn has_trailing_comma(self, list: NodeListId) -> bool {
        list.0 > 3
    }
    pub fn nodes(self, _list: NodeListId) -> &'a [NodeId] {
        &[]
    }
    pub fn modifier_list_nodes(self, list: ModifierListId) -> &'a [NodeId] {
        self.nodes(list.as_node_list())
    }
    pub fn fault(self, _message: &'static str, _id: u32) {}
    pub fn end(self, node: NodeId) -> i32 {
        node.0 as i32
    }
}

pub trait NodeSink {
    fn alloc_node(&mut self, kind: u16) -> NodeId;
    fn new_node_list(&mut self, nodes: &[NodeId]) -> NodeListId;
    fn new_modifier_list(&mut self, nodes: &[NodeId]) -> ModifierListId;
}

pub trait NodeUpdate: NodeSink {
    fn update_node(&mut self, node: NodeId, listed: &[u32]) -> NodeId;
}

pub trait NodeFactory: NodeSink {
    fn new_token(&mut self, kind: u16) -> NodeId {
        self.alloc_node(kind)
    }
}
impl<T: NodeSink + ?Sized> NodeFactory for T {}

#[derive(Clone, Copy)]
pub struct Factory<'a> {
    pub ast: Ast<'a>,
}

impl<'a> Factory<'a> {
    pub fn new(ast: Ast<'a>) -> Self {
        Self { ast }
    }
    pub fn clone_node(&mut self, node: NodeId) -> NodeId {
        let open = self.ast.open;
        open.count.set(open.count.get() + 1);
        NodeId(node.0 + 100)
    }
    pub fn clone_node_list(&mut self, list: NodeListId) -> NodeListId {
        NodeListId(list.0 + 100)
    }
    pub fn clone_modifier_list(&mut self, list: ModifierListId) -> ModifierListId {
        ModifierListId(list.0 + 100)
    }
}

impl NodeSink for Factory<'_> {
    fn alloc_node(&mut self, kind: u16) -> NodeId {
        NodeId(u32::from(kind))
    }
    fn new_node_list(&mut self, nodes: &[NodeId]) -> NodeListId {
        NodeListId(nodes.len() as u32)
    }
    fn new_modifier_list(&mut self, nodes: &[NodeId]) -> ModifierListId {
        ModifierListId(nodes.len() as u32)
    }
}

impl NodeUpdate for Factory<'_> {
    fn update_node(&mut self, node: NodeId, listed: &[u32]) -> NodeId {
        NodeId(node.0 + listed.len() as u32)
    }
}

pub type VisitFn<'v, 'a, C> = &'v dyn Fn(&mut C, &NodeVisitor<'v, 'a, C>, NodeId) -> NodeId;
pub type NodeHook<'v, 'a, C> = &'v dyn Fn(&mut C, NodeId, &NodeVisitor<'v, 'a, C>) -> NodeId;
pub type NodesHook<'v, 'a, C> =
    &'v dyn Fn(&mut C, NodeListId, &NodeVisitor<'v, 'a, C>) -> NodeListId;
pub type ModifiersHook<'v, 'a, C> =
    &'v dyn Fn(&mut C, ModifierListId, &NodeVisitor<'v, 'a, C>) -> ModifierListId;
pub type FactoryFn<'v, C> = &'v dyn Fn(&mut C, &mut dyn FnMut(&mut dyn NodeUpdate));

pub struct NodeVisitor<'v, 'a, C> {
    pub a: Ast<'a>,
    pub visit: Option<VisitFn<'v, 'a, C>>,
    pub factory: FactoryFn<'v, C>,
    pub hooks: NodeVisitorHooks<'v, 'a, C>,
}

pub struct NodeVisitorHooks<'v, 'a, C> {
    pub visit_node: Option<NodeHook<'v, 'a, C>>,
    pub visit_nodes: Option<NodesHook<'v, 'a, C>>,
    pub visit_modifiers: Option<ModifiersHook<'v, 'a, C>>,
}

impl<C> Clone for NodeVisitorHooks<'_, '_, C> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<C> Copy for NodeVisitorHooks<'_, '_, C> {}

impl<C> Default for NodeVisitorHooks<'_, '_, C> {
    fn default() -> Self {
        Self {
            visit_node: None,
            visit_nodes: None,
            visit_modifiers: None,
        }
    }
}

pub fn new_node_visitor<'v, 'a, C>(
    a: Ast<'a>,
    visit: Option<VisitFn<'v, 'a, C>>,
    factory: FactoryFn<'v, C>,
    hooks: &NodeVisitorHooks<'v, 'a, C>,
) -> NodeVisitor<'v, 'a, C> {
    NodeVisitor {
        a,
        visit,
        factory,
        hooks: *hooks,
    }
}

impl<'v, 'a, C> NodeVisitor<'v, 'a, C> {
    fn with_factory<R>(&self, c: &mut C, make: impl FnOnce(&mut dyn NodeUpdate) -> R) -> Option<R> {
        let mut make = Some(make);
        let mut made = None;
        (self.factory)(c, &mut |factory| {
            if let Some(make) = make.take() {
                made = Some(make(factory));
            }
        });
        made
    }

    pub fn visit_node_exported(&self, c: &mut C, node: NodeId) -> NodeId {
        let Some(visit) = self.visit else {
            return node;
        };
        if node.is_nil() {
            return node;
        }
        visit(c, self, node)
    }

    pub fn visit_nodes_exported(&self, c: &mut C, nodes: NodeListId) -> NodeListId {
        if nodes.is_nil() || self.visit.is_none() {
            return nodes;
        }
        let a = self.a;
        let result: Vec<NodeId> = a
            .nodes(nodes)
            .iter()
            .map(|node| self.visit_node_exported(c, *node))
            .collect();
        self.with_factory(c, |factory| factory.new_node_list(&result))
            .unwrap_or(nodes)
    }

    pub fn visit_modifiers_exported(&self, c: &mut C, nodes: ModifierListId) -> ModifierListId {
        if nodes.is_nil() || self.visit.is_none() {
            return nodes;
        }
        let result: Vec<NodeId> = Vec::new();
        self.with_factory(c, |factory| factory.new_modifier_list(&result))
            .unwrap_or(nodes)
    }

    pub fn visit_each_child(&self, c: &mut C, node: NodeId) -> NodeId {
        if node.is_nil() || self.visit.is_none() {
            return node;
        }
        let child = match self.hooks.visit_node {
            Some(hook) => hook(c, NodeId(node.0 / 2), self),
            None => self.visit_node_exported(c, NodeId(node.0 / 2)),
        };
        let list = match self.hooks.visit_nodes {
            Some(hook) => hook(c, NodeListId(node.0), self),
            None => self.visit_nodes_exported(c, NodeListId(node.0)),
        };
        let modifiers = match self.hooks.visit_modifiers {
            Some(hook) => hook(c, ModifierListId(node.0), self),
            None => self.visit_modifiers_exported(c, ModifierListId(node.0)),
        };
        let listed = [child.0, list.0, modifiers.0];
        self.with_factory(c, |factory| factory.update_node(node, &listed))
            .unwrap_or(node)
    }
}

// ---- the new file, as written ----
pub trait NodeClone: NodeUpdate {
    fn clone_node(&mut self, node: NodeId) -> NodeId;
    fn clone_node_list(&mut self, list: NodeListId) -> NodeListId;
    fn clone_modifier_list(&mut self, list: ModifierListId) -> ModifierListId;
}

impl NodeClone for Factory<'_> {
    fn clone_node(&mut self, node: NodeId) -> NodeId {
        Factory::clone_node(self, node)
    }

    fn clone_node_list(&mut self, list: NodeListId) -> NodeListId {
        Factory::clone_node_list(self, list)
    }

    fn clone_modifier_list(&mut self, list: ModifierListId) -> ModifierListId {
        Factory::clone_modifier_list(self, list)
    }
}

#[inline]
fn stack_is_safe(a: Ast<'_>, node: NodeId) -> bool {
    if node.0 < 1_000_000 {
        return true;
    }
    stack_limit(a, node);
    false
}

#[cold]
fn stack_limit(a: Ast<'_>, node: NodeId) {
    a.fault("stack limit reached", node.0);
}

fn new_text_range(pos: i32, end: i32) -> (i32, i32) {
    (pos, end)
}

fn get_deep_clone_visitor<F: NodeClone, R>(
    a: Ast<'_>,
    synthetic_location: bool,
    run: impl FnOnce(&NodeVisitor<'_, '_, F>) -> R,
) -> R {
    let visit = |f: &mut F, visitor: &NodeVisitor<'_, '_, F>, node: NodeId| -> NodeId {
        if stack_is_safe(a, node) {
            let visited = visitor.visit_each_child(f, node);
            if visited != node {
                if synthetic_location {
                    a.set_loc(visited, new_text_range(-1, -1));
                }
                return visited;
            }
        }
        let c = f.clone_node(node);
        if synthetic_location {
            a.set_loc(c, new_text_range(-1, -1));
        }
        c
    };
    let visit_nodes = |f: &mut F, nodes: NodeListId, v: &NodeVisitor<'_, '_, F>| -> NodeListId {
        if nodes.is_nil() {
            return NodeListId::NIL;
        }
        let visited = v.visit_nodes_exported(f, nodes);
        let new_list = if visited != nodes {
            visited
        } else {
            f.clone_node_list(nodes)
        };
        if synthetic_location {
            a.set_list_loc(new_list, new_text_range(-1, -1));
            if a.has_trailing_comma(nodes) {
                if let Some(last) = a.nodes(new_list).last() {
                    a.set_loc(*last, new_text_range(-2, -2));
                }
            }
        }
        new_list
    };
    let visit_modifiers =
        |f: &mut F, nodes: ModifierListId, v: &NodeVisitor<'_, '_, F>| -> ModifierListId {
            if nodes.is_nil() {
                return ModifierListId::NIL;
            }
            let visited = v.visit_modifiers_exported(f, nodes);
            let new_list = if visited != nodes {
                visited
            } else {
                f.clone_modifier_list(nodes)
            };
            if synthetic_location {
                a.set_list_loc(new_list.as_node_list(), new_text_range(-1, -1));
                if a.has_trailing_comma(nodes.as_node_list()) {
                    if let Some(last) = a.modifier_list_nodes(new_list).last() {
                        a.set_loc(*last, new_text_range(-2, -2));
                    }
                }
            }
            new_list
        };
    let factory: FactoryFn<'_, F> = &|f, make| make(f);
    let hooks: NodeVisitorHooks<'_, '_, F> = NodeVisitorHooks {
        visit_nodes: Some(&visit_nodes),
        visit_modifiers: Some(&visit_modifiers),
        ..NodeVisitorHooks::default()
    };
    let visitor = new_node_visitor(a, Some(&visit), factory, &hooks);
    run(&visitor)
}

pub fn deep_clone_node<F: NodeClone>(f: &mut F, a: Ast<'_>, node: NodeId) -> NodeId {
    get_deep_clone_visitor(a, true, |visitor: &NodeVisitor<'_, '_, F>| {
        visitor.visit_node_exported(f, node)
    })
}

// ---- printer/factory.rs, as written ----
#[derive(Default)]
pub struct EmitContext {
    pub created: u32,
    pub cloned: u32,
}

impl EmitContext {
    pub(crate) fn on_create(&mut self, _a: Ast<'_>, _node: NodeId) {
        self.created += 1;
    }
    pub(crate) fn on_update(&mut self, _a: Ast<'_>, _updated: NodeId, _original: NodeId) {}
    pub(crate) fn on_clone(&mut self, _a: Ast<'_>, _updated: NodeId, _original: NodeId) {
        self.cloned += 1;
    }
    pub fn add_emit_flags(&mut self, _node: NodeId, _flags: u32) {}
}

pub mod printer_factory {
    use super::{
        Ast, EmitContext, Factory, ModifierListId, NodeClone, NodeId, NodeListId, NodeSink,
        NodeUpdate, deep_clone_node,
    };

    pub struct NodeFactory<'a, 'c> {
        a: Ast<'a>,
        base: Factory<'a>,
        emit_context: &'c mut EmitContext,
    }

    pub fn new_node_factory<'a, 'c>(
        a: Ast<'a>,
        context: &'c mut EmitContext,
    ) -> NodeFactory<'a, 'c> {
        NodeFactory {
            a,
            base: Factory::new(a),
            emit_context: context,
        }
    }

    impl NodeSink for NodeFactory<'_, '_> {
        fn alloc_node(&mut self, kind: u16) -> NodeId {
            let node = self.base.alloc_node(kind);
            self.emit_context.on_create(self.a, node);
            node
        }
        fn new_node_list(&mut self, nodes: &[NodeId]) -> NodeListId {
            self.base.new_node_list(nodes)
        }
        fn new_modifier_list(&mut self, nodes: &[NodeId]) -> ModifierListId {
            self.base.new_modifier_list(nodes)
        }
    }

    impl NodeUpdate for NodeFactory<'_, '_> {
        fn update_node(&mut self, node: NodeId, listed: &[u32]) -> NodeId {
            let updated = self.base.update_node(node, listed);
            if updated != node {
                self.emit_context.on_create(self.a, updated);
                self.emit_context.on_update(self.a, updated, node);
            }
            updated
        }
    }

    impl NodeFactory<'_, '_> {
        pub fn clone_node(&mut self, node: NodeId) -> NodeId {
            let clone = self.base.clone_node(node);
            if !clone.is_nil() {
                self.emit_context.on_create(self.a, clone);
                self.emit_context.on_clone(self.a, clone, node);
            }
            clone
        }

        pub fn deep_clone_node(&mut self, node: NodeId) -> NodeId {
            deep_clone_node(self, self.a, node)
        }
    }

    impl NodeClone for NodeFactory<'_, '_> {
        fn clone_node(&mut self, node: NodeId) -> NodeId {
            NodeFactory::clone_node(self, node)
        }

        fn clone_node_list(&mut self, list: NodeListId) -> NodeListId {
            self.base.clone_node_list(list)
        }

        fn clone_modifier_list(&mut self, list: ModifierListId) -> ModifierListId {
            self.base.clone_modifier_list(list)
        }
    }
}

// ---- the shape of the caller in printer/printer.rs ----
pub struct Printer<'p> {
    a: Ast<'p>,
    emit_context: &'p mut EmitContext,
    lines: isize,
}

pub fn new_printer<'p>(a: Ast<'p>, emit_context: &'p mut EmitContext) -> Printer<'p> {
    Printer {
        a,
        emit_context,
        lines: 0,
    }
}

impl Printer<'_> {
    fn get_lines_between_nodes(&mut self, a: NodeId, b: NodeId) -> isize {
        self.lines += 1;
        (a.0 + b.0) as isize
    }

    pub fn emit_property_access_expression(&mut self, node: NodeId) -> isize {
        let a = self.a;
        let mut token = NodeId::NIL;
        if token.is_nil() {
            token = crate::printer_factory::new_node_factory(a, self.emit_context).new_token(7);
            a.set_loc(token, new_text_range(a.end(node), a.end(node)));
            self.emit_context.add_emit_flags(token, 1);
        }
        let lines = self.get_lines_between_nodes(node, token);
        let clone = crate::printer_factory::new_node_factory(a, self.emit_context)
            .deep_clone_node(node);
        lines + self.get_lines_between_nodes(clone, token)
    }
}

// The base factory deep-clones as well.
pub fn deep_clone_with_base(a: Ast<'_>, node: NodeId) -> NodeId {
    deep_clone_node(&mut Factory::new(a), a, node)
}

fn main() {
    let byte = 0u8;
    let open = Open {
        mark: Cell::new(&byte),
        count: Cell::new(0),
    };
    let a = Ast { open: &open };
    let mut context = EmitContext::default();
    let base = deep_clone_with_base(a, NodeId(40));
    let count = open.count.get();
    let n = {
        let mut p = new_printer(a, &mut context);
        p.emit_property_access_expression(NodeId(40))
    };
    println!("{n} {} {count}", base.0);
}

// With this body of `main`, rustc answers E0503 at `context.created`: the printer has one lifetime for the tree and for its borrows, and `Ast` is invariant, so `context` stays borrowed for as long as the tree is used.
//     let byte = 0u8;
//     let open = Open { mark: Cell::new(&byte), count: Cell::new(0) };
//     let a = Ast { open: &open };
//     let mut context = EmitContext::default();
//     let base = deep_clone_with_base(a, NodeId(40));
//     let mut p = new_printer(a, &mut context);
//     let n = p.emit_property_access_expression(NodeId(40));
//     println!("{n} {} {}", base.0, context.created + open.count.get());
