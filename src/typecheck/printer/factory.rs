// printer/factory.go: the node factory of an emit context. Its hooks mark every node it makes as synthesized and link an updated or cloned node to its original.
use crate::ast::{
    Ast, Def, Factory, Kind, ModifierListId, NodeFlags, NodeId, NodeListId, NodeSink, NodeUpdate,
    deep_clone_node,
};
use crate::printer::emitcontext::EmitContext;

pub struct NodeFactory<'c> {
    a: Ast<'c>,
    base: Factory<'c>,
    emit_context: &'c mut EmitContext,
}

pub fn new_node_factory<'c>(a: Ast<'c>, context: &'c mut EmitContext) -> NodeFactory<'c> {
    NodeFactory {
        a,
        base: Factory::new(a),
        emit_context: context,
    }
}

// ast.NodeFactoryHooks.OnCreate
impl NodeSink for NodeFactory<'_> {
    fn alloc_node(&mut self, def: Def, kind: Kind, flags: NodeFlags, slots: &[u32]) -> NodeId {
        let node = self.base.alloc_node(def, kind, flags, slots);
        self.emit_context.on_create(self.a, node);
        node
    }

    fn text_slot(&mut self, text: &[u8]) -> u32 {
        self.base.text_slot(text)
    }

    fn count_text(&mut self) {
        self.base.count_text();
    }

    fn new_node_list(&mut self, nodes: &[NodeId]) -> NodeListId {
        self.base.new_node_list(nodes)
    }

    fn new_modifier_list(&mut self, nodes: &[NodeId]) -> ModifierListId {
        self.base.new_modifier_list(nodes)
    }
}

// ast.NodeFactoryHooks.OnUpdate
impl NodeUpdate for NodeFactory<'_> {
    fn update_node(
        &mut self,
        node: NodeId,
        def: Def,
        flags: Option<NodeFlags>,
        listed: &[u32],
    ) -> NodeId {
        let updated = self.base.update_node(node, def, flags, listed);
        if updated != node {
            self.emit_context.on_create(self.a, updated);
            self.emit_context.on_update(self.a, updated, node);
        }
        updated
    }
}

impl NodeFactory<'_> {
    // Node.Clone: ast.NodeFactoryHooks.OnCreate, then OnClone.
    pub fn clone_node(&mut self, node: NodeId) -> NodeId {
        let clone = self.base.clone_node(node);
        if !clone.is_nil() {
            self.emit_context.on_create(self.a, clone);
            self.emit_context.on_clone(self.a, clone, node);
        }
        clone
    }

    // NodeFactory.DeepCloneNode
    pub fn deep_clone_node(&mut self, node: NodeId) -> NodeId {
        deep_clone_node(self, self.a, node)
    }
}
