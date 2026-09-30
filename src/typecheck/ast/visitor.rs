// Port of internal/ast/visitor.go. A callback gets the caller's state `C` first and the visitor itself, as it cannot capture them.
use crate::ast::ast_generated::{MAX_SLOTS, NodeFactory};
use crate::ast::factory::NodeUpdate;
use crate::ast::ids::{ModifierListId, NodeId, NodeListId};
use crate::ast::kind_generated::Kind;
use crate::ast::layout::{SlotType, VisitTag};
use crate::ast::reader::{Ast, Home};
use crate::internal::FaultKind;

pub type VisitFn<'v, 'a, C> = &'v dyn Fn(&mut C, &NodeVisitor<'v, 'a, C>, NodeId) -> NodeId;
pub type NodeHook<'v, 'a, C> = &'v dyn Fn(&mut C, NodeId, &NodeVisitor<'v, 'a, C>) -> NodeId;
pub type NodesHook<'v, 'a, C> =
    &'v dyn Fn(&mut C, NodeListId, &NodeVisitor<'v, 'a, C>) -> NodeListId;
pub type ModifiersHook<'v, 'a, C> =
    &'v dyn Fn(&mut C, ModifierListId, &NodeVisitor<'v, 'a, C>) -> ModifierListId;
// The NodeFactory of a visitor is made from the caller's state each time a node or a list is made, so a visit between two of them can use the state: the callback runs its argument with the factory.
pub type FactoryFn<'v, C> = &'v dyn Fn(&mut C, &mut dyn FnMut(&mut dyn NodeUpdate));

// NodeVisitor
pub struct NodeVisitor<'v, 'a, C> {
    pub a: Ast<'a>,                         // The tree that the visitor reads
    pub visit: Option<VisitFn<'v, 'a, C>>,  // Required. The callback used to visit a node
    pub factory: FactoryFn<'v, C>, // Required. The NodeFactory used to produce new nodes when passed to VisitEachChild
    pub hooks: NodeVisitorHooks<'v, 'a, C>, // Hooks to be invoked when visiting a node
}

// These hooks are used to intercept the default behavior of the visitor
pub struct NodeVisitorHooks<'v, 'a, C> {
    pub visit_node: Option<NodeHook<'v, 'a, C>>, // Overrides visiting a Node. Only invoked by the VisitEachChild method on a given Node subtype.
    pub visit_token: Option<NodeHook<'v, 'a, C>>, // Overrides visiting a TokenNode. Only invoked by the VisitEachChild method on a given Node subtype.
    pub visit_nodes: Option<NodesHook<'v, 'a, C>>, // Overrides visiting a NodeList. Only invoked by the VisitEachChild method on a given Node subtype.
    pub visit_modifiers: Option<ModifiersHook<'v, 'a, C>>, // Overrides visiting a ModifierList. Only invoked by the VisitEachChild method on a given Node subtype.
    pub visit_embedded_statement: Option<NodeHook<'v, 'a, C>>, // Overrides visiting a Node when it is the embedded statement body of an iteration statement, `if` statement, or `with` statement. Only invoked by the VisitEachChild method on a given Node subtype.
    pub visit_iteration_body: Option<NodeHook<'v, 'a, C>>, // Overrides visiting a Node when it is the embedded statement body of an iteration statement. Only invoked by the VisitEachChild method on a given Node subtype.
    pub visit_parameters: Option<NodesHook<'v, 'a, C>>, // Overrides visiting a ParameterList. Only invoked by the VisitEachChild method on a given Node subtype.
    pub visit_function_body: Option<NodeHook<'v, 'a, C>>, // Overrides visiting a function body. Only invoked by the VisitEachChild method on a given Node subtype.
    pub visit_top_level_statements: Option<NodesHook<'v, 'a, C>>, // Overrides visiting a variable environment. Only invoked by the VisitEachChild method on a given Node subtype.
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
            visit_token: None,
            visit_nodes: None,
            visit_modifiers: None,
            visit_embedded_statement: None,
            visit_iteration_body: None,
            visit_parameters: None,
            visit_function_body: None,
            visit_top_level_statements: None,
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

// `(&NodeVisitor{Visit: visit, Factory: factory}).VisitEachChild(node)`: a visitor without hooks for one node.
pub fn visit_each_child<C>(
    a: Ast<'_>,
    c: &mut C,
    node: NodeId,
    visit: impl Fn(&mut C, NodeId) -> NodeId,
    factory: impl Fn(&mut C, &mut dyn FnMut(&mut dyn NodeUpdate)),
) -> NodeId {
    let visit_child = |c: &mut C, _: &NodeVisitor<'_, '_, C>, child: NodeId| visit(c, child);
    let hooks = NodeVisitorHooks::default();
    new_node_visitor(a, Some(&visit_child), &factory, &hooks).visit_each_child(c, node)
}

impl<'v, 'a, C> NodeVisitor<'v, 'a, C> {
    // Runs `make` with the factory of the caller: None when the caller runs nothing.
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

    pub fn visit_source_file(&self, c: &mut C, node: NodeId) -> NodeId {
        self.visit_node_exported(c, node)
    }

    // VisitNode: visits a Node, possibly returning a new Node in its place. A nil input gives nil; without a callback the output is the input; a SyntaxList result gives its only child.
    pub fn visit_node_exported(&self, c: &mut C, node: NodeId) -> NodeId {
        let Some(visit) = self.visit else {
            return node;
        };
        if node.is_nil() {
            return node;
        }
        let a = self.a;
        let mut visited = visit(c, self, node);
        if !visited.is_nil() && a.kind(visited) == Kind::SyntaxList {
            let nodes = a.nodes(a.as_syntax_list(visited).children).as_slice();
            if nodes.len() != 1 {
                let message = "Expected only a single node to be written to output";
                a.fault(FaultKind::Panic, message, 0, visited.0);
            }
            visited = nodes.first().copied().unwrap_or(NodeId::NIL);
            if !visited.is_nil() && a.kind(visited) == Kind::SyntaxList {
                let message = "The result of visiting and lifting a Node may not be SyntaxList";
                a.fault(FaultKind::Panic, message, 0, visited.0);
            }
        }
        visited
    }

    // VisitEmbeddedStatement: visits the single statement body of a loop or branch. A SyntaxList result gives its only child, or a Block containing the nodes in the list.
    pub fn visit_embedded_statement_exported(&self, c: &mut C, node: NodeId) -> NodeId {
        let Some(visit) = self.visit else {
            return node;
        };
        if node.is_nil() {
            return node;
        }
        let visited = visit(c, self, node);
        if visited.is_nil() {
            return NodeId::NIL;
        }
        self.lift_to_block(c, visited)
    }

    // VisitNodes: visits a NodeList. A node for which the callback returns nil is absent in the output, and a new list has the Loc of the input.
    pub fn visit_nodes_exported(&self, c: &mut C, nodes: NodeListId) -> NodeListId {
        if nodes.is_nil() || self.visit.is_none() {
            return nodes;
        }
        let a = self.a;
        if let Some(result) = self.visit_slice(c, a.nodes(nodes).as_slice()) {
            if let Some(list) = self.with_factory(c, |factory| factory.new_node_list(&result)) {
                a.set_list_loc(list, a.list_loc(nodes));
                return list;
            }
        }
        nodes
    }

    // VisitModifiers: visits a ModifierList, as VisitNodes visits a NodeList.
    pub fn visit_modifiers_exported(&self, c: &mut C, nodes: ModifierListId) -> ModifierListId {
        if nodes.is_nil() || self.visit.is_none() {
            return nodes;
        }
        let a = self.a;
        if let Some(result) = self.visit_slice(c, a.modifier_list_nodes(nodes).as_slice()) {
            let made = self.with_factory(c, |factory| factory.new_modifier_list(&result));
            if let Some(list) = made {
                a.set_list_loc(list.as_node_list(), a.modifier_list_loc(nodes));
                return list;
            }
        }
        nodes
    }

    // VisitSlice: the resulting slice when the callback changed a node, None for `changed == false`. The children of a SyntaxList result are merged into the output.
    pub fn visit_slice(&self, c: &mut C, nodes: &[NodeId]) -> Option<Vec<NodeId>> {
        let visit = self.visit?;
        let a = self.a;
        let mut i = 0;
        while let Some(&node) = nodes.get(i) {
            let mut visited = visit(c, self, node);
            if visited.is_nil() || visited != node {
                let mut updated: Vec<NodeId> = nodes.get(..i).unwrap_or(&[]).to_vec();
                loop {
                    // finish prior loop
                    if !visited.is_nil() {
                        if a.kind(visited) == Kind::SyntaxList {
                            let children = a.nodes(a.as_syntax_list(visited).children);
                            updated.extend_from_slice(children.as_slice());
                        } else {
                            updated.push(visited);
                        }
                    }
                    i += 1;
                    // loop over remaining elements
                    match nodes.get(i) {
                        Some(&next) => visited = visit(c, self, next),
                        None => break,
                    }
                }
                return Some(updated);
            }
            i += 1;
        }
        None
    }

    // Visits each child of a Node, possibly returning a new Node of the same kind in its place.
    pub fn visit_each_child(&self, c: &mut C, node: NodeId) -> NodeId {
        if node.is_nil() || self.visit.is_none() {
            return node;
        }
        self.node_visit_each_child(c, node)
    }

    // Node.VisitEachChild: the Update function of the definition with every member visited as ast.json says.
    fn node_visit_each_child(&self, c: &mut C, node: NodeId) -> NodeId {
        let a = self.a;
        let Some(found) = a.find(node) else {
            return node;
        };
        let def = found.rec.def;
        let info = def.info();
        // NodeDefault.VisitEachChild: a node without children is returned as it is.
        if info.children.is_empty() {
            return node;
        }
        let listed = usize::from(info.factory_slots).min(MAX_SLOTS);
        let mut new = [0u32; MAX_SLOTS];
        for (index, slot) in info.slots.iter().enumerate().take(listed) {
            let value = a.word(&found, index);
            let visited = match slot.visit {
                // A text that the store of the factory does not keep is copied into it, so the Update function compares two texts.
                VisitTag::None => match (slot.ty, found.home) {
                    (SlotType::Text, Home::File(_) | Home::Bound(_)) => {
                        let text = a.text_of(&found, value);
                        self.with_factory(c, |factory| factory.text_slot(text))
                            .unwrap_or(0)
                    }
                    _ => value,
                },
                VisitTag::Node => self.visit_node(c, NodeId(value)).0,
                VisitTag::Token => self.visit_token(c, NodeId(value)).0,
                VisitTag::Nodes => self.visit_nodes(c, NodeListId(value)).0,
                VisitTag::Modifiers => self.visit_modifiers(c, ModifierListId(value)).0,
                VisitTag::RawNodes => self.visit_raw_nodes(c, NodeListId(value)).0,
                VisitTag::EmbeddedStatement => self.visit_embedded_statement(c, NodeId(value)).0,
                VisitTag::IterationBody => self.visit_iteration_body(c, NodeId(value)).0,
                VisitTag::Parameters => self.visit_parameters(c, NodeListId(value)).0,
                VisitTag::FunctionBody => self.visit_function_body(c, NodeId(value)).0,
                VisitTag::TopLevelStatements => {
                    self.visit_top_level_statements(c, NodeListId(value)).0
                }
            };
            if let Some(target) = new.get_mut(index) {
                *target = visited;
            }
        }
        let listed = new.get(..listed).unwrap_or(&[]);
        // The flags member of a constructor is passed as `node.Flags`, which never differs.
        self.with_factory(c, |factory| factory.update_node(node, def, None, listed))
            .unwrap_or(node)
    }

    // `core.SameMap(nodes, v.visitNode)` of a member that is a plain slice of nodes: the same list when no node changed.
    fn visit_raw_nodes(&self, c: &mut C, nodes: NodeListId) -> NodeListId {
        if nodes.is_nil() {
            return nodes;
        }
        let a = self.a;
        let old = a.nodes(nodes).as_slice();
        let new: Vec<NodeId> = old.iter().map(|node| self.visit_node(c, *node)).collect();
        if new.as_slice() == old {
            return nodes;
        }
        self.with_factory(c, |factory| factory.new_node_list(&new))
            .unwrap_or(nodes)
    }

    fn visit_node(&self, c: &mut C, node: NodeId) -> NodeId {
        if let Some(hook) = self.hooks.visit_node {
            return hook(c, node, self);
        }
        self.visit_node_exported(c, node)
    }

    fn visit_embedded_statement(&self, c: &mut C, node: NodeId) -> NodeId {
        if let Some(hook) = self.hooks.visit_embedded_statement {
            return hook(c, node, self);
        }
        if let Some(hook) = self.hooks.visit_node {
            let visited = hook(c, node, self);
            return self.lift_to_block(c, visited);
        }
        self.visit_embedded_statement_exported(c, node)
    }

    fn visit_iteration_body(&self, c: &mut C, node: NodeId) -> NodeId {
        if let Some(hook) = self.hooks.visit_iteration_body {
            return hook(c, node, self);
        }
        self.visit_embedded_statement(c, node)
    }

    fn visit_function_body(&self, c: &mut C, node: NodeId) -> NodeId {
        if let Some(hook) = self.hooks.visit_function_body {
            return hook(c, node, self);
        }
        self.visit_node(c, node)
    }

    fn visit_token(&self, c: &mut C, node: NodeId) -> NodeId {
        if let Some(hook) = self.hooks.visit_token {
            return hook(c, node, self);
        }
        self.visit_node_exported(c, node)
    }

    fn visit_nodes(&self, c: &mut C, nodes: NodeListId) -> NodeListId {
        if let Some(hook) = self.hooks.visit_nodes {
            return hook(c, nodes, self);
        }
        self.visit_nodes_exported(c, nodes)
    }

    fn visit_modifiers(&self, c: &mut C, nodes: ModifierListId) -> ModifierListId {
        if let Some(hook) = self.hooks.visit_modifiers {
            return hook(c, nodes, self);
        }
        self.visit_modifiers_exported(c, nodes)
    }

    fn visit_parameters(&self, c: &mut C, nodes: NodeListId) -> NodeListId {
        if let Some(hook) = self.hooks.visit_parameters {
            return hook(c, nodes, self);
        }
        self.visit_nodes(c, nodes)
    }

    fn visit_top_level_statements(&self, c: &mut C, nodes: NodeListId) -> NodeListId {
        if let Some(hook) = self.hooks.visit_top_level_statements {
            return hook(c, nodes, self);
        }
        self.visit_nodes(c, nodes)
    }

    fn lift_to_block(&self, c: &mut C, node: NodeId) -> NodeId {
        let a = self.a;
        let mut node = node;
        let mut nodes: &[NodeId] = &[];
        let single = [node];
        if !node.is_nil() {
            if a.kind(node) == Kind::SyntaxList {
                nodes = a.nodes(a.as_syntax_list(node).children).as_slice();
            } else {
                nodes = &single;
            }
        }
        match nodes {
            [only] => node = *only,
            _ => {
                let block = self.with_factory(c, |factory| {
                    let statements = factory.new_node_list(nodes);
                    factory.new_block(statements, true)
                });
                node = block.unwrap_or(NodeId::NIL);
            }
        }
        if a.kind(node) == Kind::SyntaxList {
            let message = "The result of visiting and lifting a Node may not be SyntaxList";
            a.fault(FaultKind::Panic, message, 0, node.0);
        }
        node
    }
}
