// checker/nodecopy.go: the reuse of nodes that a declaration already has. The bodies are not ported yet: each records a stand-in and reuses nothing, so the node builder serializes the type of the checker.
use crate::ast::NodeId;
use crate::checker::Checker;
use crate::checker::nodebuilderimpl::NodeBuilderImpl;

impl NodeBuilderImpl {
    pub(crate) fn reuse_node(self, c: &mut Checker<'_>, _node: NodeId) -> NodeId {
        let _: () = c.stand_in("NodeBuilderImpl.reuseNode");
        NodeId::NIL
    }

    pub(crate) fn try_reuse_existing_node_helper(
        self,
        c: &mut Checker<'_>,
        _existing: NodeId,
    ) -> NodeId {
        let _: () = c.stand_in("NodeBuilderImpl.tryReuseExistingNodeHelper");
        NodeId::NIL
    }
}
