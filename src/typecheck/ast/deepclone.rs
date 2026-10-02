// Port of internal/ast/deepclone.go 6-73. DeepCloneReparse and DeepCloneReparseModifiers run on a builder: importer/javascript/tree.rs has them.
use crate::ast::factory::{Factory, NodeUpdate};
use crate::ast::ids::{ModifierListId, NodeId, NodeListId};
use crate::ast::reader::Ast;
use crate::ast::visitor::{FactoryFn, NodeVisitor, NodeVisitorHooks, new_node_visitor};
use crate::core::new_text_range;
use crate::internal::FaultKind;

// The factory that Node.Clone, NodeList.Clone and ModifierList.Clone take: the clone of a node runs the hooks of its factory.
pub trait NodeClone: NodeUpdate {
    // Node.Clone
    fn clone_node(&mut self, node: NodeId) -> NodeId;
    // NodeList.Clone
    fn clone_node_list(&mut self, list: NodeListId) -> NodeListId;
    // ModifierList.Clone
    fn clone_modifier_list(&mut self, list: ModifierListId) -> ModifierListId;
}

// A factory without hooks: the three are its own methods of the same names.
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

// Go stacks grow: a clone that follows the depth of the tree ends here with an internal diagnostic when the thread has no stack left.
#[inline]
fn stack_is_safe(a: Ast<'_>, node: NodeId) -> bool {
    if bun_core::StackCheck::init().is_safe_to_recurse() {
        return true;
    }
    stack_limit(a, node);
    false
}

#[cold]
fn stack_limit(a: Ast<'_>, node: NodeId) {
    a.fault(FaultKind::StackLimit, "stack limit reached", 0, node.0);
}

// getDeepCloneVisitor. A visitor borrows its callbacks, so `run` gets the visitor where upstream returns it, and the factory is the state that `run` hands to the visitor.
fn get_deep_clone_visitor<F: NodeClone, R>(
    a: Ast<'_>,
    synthetic_location: bool,
    run: impl FnOnce(&NodeVisitor<'_, '_, F>) -> R,
) -> R {
    let visit = |f: &mut F, visitor: &NodeVisitor<'_, '_, F>, node: NodeId| -> NodeId {
        // Without stack left the children are not visited: the node is cloned as a leaf is.
        if stack_is_safe(a, node) {
            let visited = visitor.visit_each_child(f, node);
            if visited != node {
                if synthetic_location {
                    a.set_loc(visited, new_text_range(-1, -1));
                }
                return visited;
            }
        }
        // forcibly clone leaf nodes, which will then cascade new nodes/arrays upwards via `update` calls
        let c = f.clone_node(node);
        // Node.Clone copies locations. Deep clones are done to copy a node across files, so the location range is made synthetic on all cloned nodes.
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
                if let Some(last) = a.nodes(new_list).as_slice().last() {
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
                    if let Some(last) = a.modifier_list_nodes(new_list).as_slice().last() {
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

// NodeFactory.DeepCloneNode
pub fn deep_clone_node<F: NodeClone>(f: &mut F, a: Ast<'_>, node: NodeId) -> NodeId {
    get_deep_clone_visitor(a, true, |visitor: &NodeVisitor<'_, '_, F>| {
        visitor.visit_node_exported(f, node)
    })
}
