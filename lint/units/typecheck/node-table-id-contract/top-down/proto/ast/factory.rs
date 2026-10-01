// The hand-written half of NodeFactory (ast.go:60-173) and NodeVisitor (visitor.go). The New, Update and Clone
// functions of each node are in ast_generated.rs. A factory writes into the arena of its context through a
// shared reference, so calls nest as they do upstream: f.new_a(f.new_b(..), ..).
use crate::ast::ast_generated::{Def, visit_each_child};
use crate::ast::context::Ast;
use crate::ast::flags_generated::ModifierFlags;
use crate::ast::kind_generated::Kind;
use crate::core;
use crate::ids::{ModifierListId, NodeId, NodeListId};
use crate::internal::FaultKind;
use std::cell::Cell;

#[derive(Clone, Copy, Default)]
pub struct NodeFactoryHooks<'a> {
    pub on_create: Option<&'a dyn Fn(NodeId)>,
    pub on_update: Option<&'a dyn Fn(NodeId, NodeId)>,
    pub on_clone: Option<&'a dyn Fn(NodeId, NodeId)>,
}

pub struct NodeFactory<'a> {
    pub(crate) a: Ast<'a>,
    hooks: NodeFactoryHooks<'a>,
    node_count: Cell<u32>,
    text_count: Cell<u32>,
}

pub fn new_node_factory<'a>(a: Ast<'a>, hooks: NodeFactoryHooks<'a>) -> NodeFactory<'a> {
    NodeFactory {
        a,
        hooks,
        node_count: Cell::new(0),
        text_count: Cell::new(0),
    }
}

impl<'a> NodeFactory<'a> {
    pub fn ast(&self) -> Ast<'a> {
        self.a
    }
    pub(crate) fn new_node(&self, def: Def, kind: Kind, slots: &[u32]) -> NodeId {
        self.node_count.set(self.node_count.get().saturating_add(1));
        let node = self.a.arena.new_node(kind, def, slots);
        if node.is_nil() {
            self.a
                .log
                .record(FaultKind::IdSpaceExhausted, "newNode", kind as u32);
            return node;
        }
        if let Some(on_create) = self.hooks.on_create {
            on_create(node);
        }
        node
    }
    pub(crate) fn text(&self, text: &[u8]) -> u32 {
        self.a.arena.new_text(text)
    }
    pub(crate) fn count_text(&self) {
        self.text_count.set(self.text_count.get().saturating_add(1));
    }
    pub fn node_count(&self) -> u32 {
        self.node_count.get()
    }
    pub fn text_count(&self) -> u32 {
        self.text_count.get()
    }
    pub(crate) fn update_node(&self, updated: NodeId, original: NodeId) -> NodeId {
        if updated != original {
            self.a.set_flags(updated, original.flags(self.a));
            self.a.set_loc(updated, original.loc(self.a));
            if let Some(on_update) = self.hooks.on_update {
                on_update(updated, original);
            }
        }
        updated
    }
    pub(crate) fn clone_node(&self, updated: NodeId, original: NodeId) -> NodeId {
        self.update_node(updated, original);
        if updated != original {
            if let Some(on_clone) = self.hooks.on_clone {
                on_clone(updated, original);
            }
        }
        updated
    }
    #[cold]
    pub(crate) fn unexpected_kind(&self, who: &'static str, node: NodeId) -> NodeId {
        self.a.unhandled(who, node);
        node
    }
    pub fn new_node_list(&self, nodes: &[NodeId]) -> NodeListId {
        self.a
            .arena
            .new_list(nodes, core::undefined_text_range(), ModifierFlags::empty())
    }
    pub fn new_modifier_list(&self, nodes: &[NodeId]) -> ModifierListId {
        let mut flags = ModifierFlags::empty();
        for modifier in nodes {
            flags |= modifier_to_flag(modifier.kind(self.a));
        }
        ModifierListId(
            self.a
                .arena
                .new_list(nodes, core::undefined_text_range(), flags)
                .0,
        )
    }
    pub fn new_modifier(&self, kind: Kind) -> NodeId {
        self.new_token(kind)
    }
}

// utilities.go:990
pub fn modifier_to_flag(token: Kind) -> ModifierFlags {
    match token {
        Kind::StaticKeyword => ModifierFlags::STATIC,
        Kind::PublicKeyword => ModifierFlags::PUBLIC,
        Kind::ProtectedKeyword => ModifierFlags::PROTECTED,
        Kind::PrivateKeyword => ModifierFlags::PRIVATE,
        Kind::AbstractKeyword => ModifierFlags::ABSTRACT,
        Kind::AccessorKeyword => ModifierFlags::ACCESSOR,
        Kind::ExportKeyword => ModifierFlags::EXPORT,
        Kind::DeclareKeyword => ModifierFlags::AMBIENT,
        Kind::ConstKeyword => ModifierFlags::CONST,
        Kind::DefaultKeyword => ModifierFlags::DEFAULT,
        Kind::AsyncKeyword => ModifierFlags::ASYNC,
        Kind::ReadonlyKeyword => ModifierFlags::READONLY,
        Kind::OverrideKeyword => ModifierFlags::OVERRIDE,
        Kind::InKeyword => ModifierFlags::IN,
        Kind::OutKeyword => ModifierFlags::OUT,
        Kind::Decorator => ModifierFlags::DECORATOR,
        _ => ModifierFlags::empty(),
    }
}

type VisitFn<'v> = &'v dyn Fn(NodeId) -> NodeId;
type NodeHook<'v, 'a> = &'v dyn Fn(NodeId, &NodeVisitor<'v, 'a>) -> NodeId;
type ListHook<'v, 'a> = &'v dyn Fn(NodeListId, &NodeVisitor<'v, 'a>) -> NodeListId;
type ModifiersHook<'v, 'a> = &'v dyn Fn(ModifierListId, &NodeVisitor<'v, 'a>) -> ModifierListId;

#[derive(Clone, Copy, Default)]
pub struct NodeVisitorHooks<'v, 'a> {
    pub visit_node: Option<NodeHook<'v, 'a>>,
    pub visit_token: Option<NodeHook<'v, 'a>>,
    pub visit_nodes: Option<ListHook<'v, 'a>>,
    pub visit_modifiers: Option<ModifiersHook<'v, 'a>>,
    pub visit_embedded_statement: Option<NodeHook<'v, 'a>>,
    pub visit_iteration_body: Option<NodeHook<'v, 'a>>,
    pub visit_parameters: Option<ListHook<'v, 'a>>,
    pub visit_function_body: Option<NodeHook<'v, 'a>>,
    pub visit_top_level_statements: Option<ListHook<'v, 'a>>,
}

pub struct NodeVisitor<'v, 'a> {
    pub visit: Option<VisitFn<'v>>,
    pub factory: &'v NodeFactory<'a>,
    pub hooks: NodeVisitorHooks<'v, 'a>,
}

pub fn new_node_visitor<'v, 'a>(
    visit: Option<VisitFn<'v>>,
    factory: &'v NodeFactory<'a>,
    hooks: &NodeVisitorHooks<'v, 'a>,
) -> NodeVisitor<'v, 'a> {
    NodeVisitor {
        visit,
        factory,
        hooks: *hooks,
    }
}

impl<'v, 'a> NodeVisitor<'v, 'a> {
    // VisitNode of the reference: the exported twin of visitNode.
    pub fn visit_node_exported(&self, node: NodeId) -> NodeId {
        let Some(visit) = self.visit else {
            return node;
        };
        if node.is_nil() {
            return node;
        }
        let a = self.factory.a;
        let mut visited = visit(node);
        if !visited.is_nil() && visited.kind(a) == Kind::SyntaxList {
            let nodes = a.list_nodes(visited.as_syntax_list(a).children);
            if nodes.len() != 1 {
                a.unhandled(
                    "Expected only a single node to be written to output",
                    visited,
                );
            }
            visited = nodes.at(0usize);
            if !visited.is_nil() && visited.kind(a) == Kind::SyntaxList {
                a.unhandled(
                    "The result of visiting and lifting a Node may not be SyntaxList",
                    visited,
                );
            }
        }
        visited
    }
    pub fn visit_embedded_statement_exported(&self, node: NodeId) -> NodeId {
        let Some(visit) = self.visit else {
            return node;
        };
        if node.is_nil() {
            return node;
        }
        let visited = visit(node);
        if visited.is_nil() {
            return NodeId::NIL;
        }
        self.lift_to_block(visited)
    }
    pub fn visit_nodes_exported(&self, nodes: NodeListId) -> NodeListId {
        if nodes.is_nil() || self.visit.is_none() {
            return nodes;
        }
        let a = self.factory.a;
        if let Some(result) = self.visit_slice(a.list_nodes(nodes).as_slice()) {
            let list = self.factory.new_node_list(&result);
            a.set_list_loc(list, a.list_loc(nodes));
            return list;
        }
        nodes
    }
    pub fn visit_modifiers_exported(&self, nodes: ModifierListId) -> ModifierListId {
        if nodes.is_nil() || self.visit.is_none() {
            return nodes;
        }
        let a = self.factory.a;
        if let Some(result) = self.visit_slice(a.list_nodes(nodes.as_node_list()).as_slice()) {
            let list = self.factory.new_modifier_list(&result);
            a.set_list_loc(list.as_node_list(), a.list_loc(nodes.as_node_list()));
            return list;
        }
        nodes
    }
    // VisitSlice of the reference. None stands for "the input, unchanged".
    pub fn visit_slice(&self, nodes: &[NodeId]) -> Option<Vec<NodeId>> {
        let visit = self.visit?;
        let a = self.factory.a;
        let mut i = 0;
        while let Some(&node) = nodes.get(i) {
            let mut visited = visit(node);
            if visited.is_nil() || visited != node {
                let mut updated: Vec<NodeId> = nodes.get(..i).unwrap_or(&[]).to_vec();
                loop {
                    if visited.is_nil() {
                    } else if visited.kind(a) == Kind::SyntaxList {
                        updated.extend_from_slice(
                            a.list_nodes(visited.as_syntax_list(a).children).as_slice(),
                        );
                    } else {
                        updated.push(visited);
                    }
                    i += 1;
                    match nodes.get(i) {
                        Some(&next) => visited = visit(next),
                        None => break,
                    }
                }
                return Some(updated);
            }
            i += 1;
        }
        None
    }
    pub fn visit_each_child(&self, node: NodeId) -> NodeId {
        if node.is_nil() || self.visit.is_none() {
            return node;
        }
        visit_each_child(self, node)
    }

    pub(crate) fn visit_node(&self, node: NodeId) -> NodeId {
        if let Some(hook) = self.hooks.visit_node {
            return hook(node, self);
        }
        self.visit_node_exported(node)
    }
    pub(crate) fn visit_embedded_statement(&self, node: NodeId) -> NodeId {
        if let Some(hook) = self.hooks.visit_embedded_statement {
            return hook(node, self);
        }
        if let Some(hook) = self.hooks.visit_node {
            return self.lift_to_block(hook(node, self));
        }
        self.visit_embedded_statement_exported(node)
    }
    pub(crate) fn visit_iteration_body(&self, node: NodeId) -> NodeId {
        if let Some(hook) = self.hooks.visit_iteration_body {
            return hook(node, self);
        }
        self.visit_embedded_statement(node)
    }
    pub(crate) fn visit_function_body(&self, node: NodeId) -> NodeId {
        if let Some(hook) = self.hooks.visit_function_body {
            return hook(node, self);
        }
        self.visit_node(node)
    }
    pub(crate) fn visit_token(&self, node: NodeId) -> NodeId {
        if let Some(hook) = self.hooks.visit_token {
            return hook(node, self);
        }
        self.visit_node_exported(node)
    }
    pub(crate) fn visit_nodes(&self, nodes: NodeListId) -> NodeListId {
        if let Some(hook) = self.hooks.visit_nodes {
            return hook(nodes, self);
        }
        self.visit_nodes_exported(nodes)
    }
    // core.SameMap over a raw slice of nodes with visitNode.
    pub(crate) fn visit_raw_nodes(&self, nodes: NodeListId) -> NodeListId {
        if nodes.is_nil() {
            return nodes;
        }
        let a = self.factory.a;
        let old = a.list_nodes(nodes);
        let new: Vec<NodeId> = old.iter().map(|n| self.visit_node(n)).collect();
        if new.as_slice() == old.as_slice() {
            return nodes;
        }
        self.factory.new_node_list(&new)
    }
    pub(crate) fn visit_modifiers(&self, nodes: ModifierListId) -> ModifierListId {
        if let Some(hook) = self.hooks.visit_modifiers {
            return hook(nodes, self);
        }
        self.visit_modifiers_exported(nodes)
    }
    pub(crate) fn visit_parameters(&self, nodes: NodeListId) -> NodeListId {
        if let Some(hook) = self.hooks.visit_parameters {
            return hook(nodes, self);
        }
        self.visit_nodes(nodes)
    }
    pub(crate) fn visit_top_level_statements(&self, nodes: NodeListId) -> NodeListId {
        if let Some(hook) = self.hooks.visit_top_level_statements {
            return hook(nodes, self);
        }
        self.visit_nodes(nodes)
    }
    fn lift_to_block(&self, node: NodeId) -> NodeId {
        let a = self.factory.a;
        let mut node = node;
        let mut nodes: Vec<NodeId> = Vec::new();
        if !node.is_nil() {
            if node.kind(a) == Kind::SyntaxList {
                nodes.extend_from_slice(a.list_nodes(node.as_syntax_list(a).children).as_slice());
            } else {
                nodes.push(node);
            }
        }
        match nodes.as_slice() {
            [only] => node = *only,
            _ => {
                node = self
                    .factory
                    .new_block(self.factory.new_node_list(&nodes), true)
            }
        }
        if node.kind(a) == Kind::SyntaxList {
            a.unhandled(
                "The result of visiting and lifting a Node may not be SyntaxList",
                node,
            );
        }
        node
    }
}
