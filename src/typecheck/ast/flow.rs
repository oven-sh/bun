// Port of internal/ast/flow.go. A flow node is read by value through the tree context.
use crate::ast::ast_generated::{Def, FlowSwitchClauseData};
use crate::ast::flags::define_flags;
use crate::ast::ids::{FlowListId, FlowNodeId, NodeId};
use crate::ast::kind_generated::Kind;
use crate::ast::nodeflags::NodeFlags;
use crate::ast::open::{push, read, write};
use crate::ast::reader::Ast;
use crate::internal::FaultKind;

// FlowFlags
define_flags!(FlowFlags: u32 {
    UNREACHABLE = 1 << 0, // Unreachable code
    START = 1 << 1, // Start of flow graph
    BRANCH_LABEL = 1 << 2, // Non-looping junction
    LOOP_LABEL = 1 << 3, // Looping junction
    ASSIGNMENT = 1 << 4, // Assignment
    TRUE_CONDITION = 1 << 5, // Condition known to be true
    FALSE_CONDITION = 1 << 6, // Condition known to be false
    SWITCH_CLAUSE = 1 << 7, // Switch statement clause
    ARRAY_MUTATION = 1 << 8, // Potential array mutation
    CALL = 1 << 9, // Potential assertion call
    REDUCE_LABEL = 1 << 10, // Temporarily reduce antecedents of label
    REFERENCED = 1 << 11, // Referenced as antecedent once
    SHARED = 1 << 12, // Referenced as antecedent more than once
    LABEL = Self::BRANCH_LABEL.0 | Self::LOOP_LABEL.0,
    CONDITION = Self::TRUE_CONDITION.0 | Self::FALSE_CONDITION.0,
});

// FlowNode
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct FlowNode {
    pub flags: FlowFlags,
    pub node: NodeId,            // Associated AST node
    pub antecedent: FlowNodeId,  // Antecedent for all but FlowLabel
    pub antecedents: FlowListId, // Linked list of antecedents for FlowLabel
}

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct FlowList {
    pub flow: FlowNodeId,
    pub next: FlowListId,
}

pub type FlowLabel = FlowNode;

impl FlowSwitchClauseData {
    pub fn is_empty(&self) -> bool {
        self.clause_start == self.clause_end
    }
}

impl<'a> Ast<'a> {
    // The flow node behind an id: one of the open store, or one of a bound file. The nil flow node reads as the zero flow node.
    pub fn flow(self, flow: FlowNodeId) -> FlowNode {
        let found = if flow.is_open() {
            read(&self.open.flow_nodes, flow.open_index(), |f| *f)
        } else {
            self.frozen
                .locate_bound(flow.0)
                .and_then(|(_, bound, local)| bound.flow_nodes.get(local).filter(|_| local != 0))
                .copied()
        };
        found.unwrap_or_default()
    }

    // `&ast.FlowNode{Flags: flags, Node: node, Antecedent: antecedent}`
    pub fn new_flow_node(
        self,
        flags: FlowFlags,
        node: NodeId,
        antecedent: FlowNodeId,
    ) -> FlowNodeId {
        let flow = FlowNode {
            flags,
            node,
            antecedent,
            antecedents: FlowListId::NIL,
        };
        let index = push(&self.open.flow_nodes, flow);
        if index == 0 {
            self.fault(FaultKind::IdSpaceExhausted, "FlowNode", 0, 0);
            return FlowNodeId::NIL;
        }
        FlowNodeId::from_open_index(index)
    }

    // A write to a flow node of the open store. A flow node of a bound file is never written.
    pub fn update_flow(self, flow: FlowNodeId, f: impl FnOnce(&mut FlowNode)) {
        if flow.is_open() {
            if let Some(mut value) = read(&self.open.flow_nodes, flow.open_index(), |n| *n) {
                f(&mut value);
                write(&self.open.flow_nodes, flow.open_index(), |n| *n = value);
                return;
            }
        }
        let kind = if flow.is_nil() {
            FaultKind::NilWrite
        } else {
            FaultKind::WriteToFrozen
        };
        self.fault(kind, "FlowNode", 0, flow.0);
    }

    // The flow list behind an id.
    pub fn flow_list(self, list: FlowListId) -> FlowList {
        let found = if list.is_open() {
            read(&self.open.flow_lists, list.open_index(), |l| *l)
        } else {
            self.frozen
                .locate_bound(list.0)
                .and_then(|(_, bound, local)| bound.flow_lists.get(local).filter(|_| local != 0))
                .copied()
        };
        found.unwrap_or_default()
    }

    // `&ast.FlowList{Flow: flow, Next: next}`
    pub fn new_flow_list(self, flow: FlowNodeId, next: FlowListId) -> FlowListId {
        let index = push(&self.open.flow_lists, FlowList { flow, next });
        if index == 0 {
            self.fault(FaultKind::IdSpaceExhausted, "FlowList", 0, 0);
            return FlowListId::NIL;
        }
        FlowListId::from_open_index(index)
    }

    // A write to a flow list of the open store.
    pub fn update_flow_list(self, list: FlowListId, f: impl FnOnce(&mut FlowList)) {
        if list.is_open() {
            if let Some(mut value) = read(&self.open.flow_lists, list.open_index(), |l| *l) {
                f(&mut value);
                write(&self.open.flow_lists, list.open_index(), |l| *l = value);
                return;
            }
        }
        let kind = if list.is_nil() {
            FaultKind::NilWrite
        } else {
            FaultKind::WriteToFrozen
        };
        self.fault(kind, "FlowList", 0, list.0);
    }
}

// FlowSwitchClauseData (synthetic AST node for FlowFlagsSwitchClause)
pub fn new_flow_switch_clause_data(
    a: Ast<'_>,
    switch_statement: NodeId,
    clause_start: isize,
    clause_end: isize,
) -> NodeId {
    // `int32(clauseStart)` and `int32(clauseEnd)`: the low 32 bits.
    let slots = [switch_statement.0, clause_start as u32, clause_end as u32];
    let def = Def::FlowSwitchClauseData;
    a.push_open_node(def, Kind::Unknown, NodeFlags::NONE, &slots)
}

// FlowReduceLabelData (synthetic AST node for FlowFlagsReduceLabel)
pub fn new_flow_reduce_label_data(
    a: Ast<'_>,
    target: FlowNodeId,
    antecedents: FlowListId,
) -> NodeId {
    let slots = [target.0, antecedents.0];
    let def = Def::FlowReduceLabelData;
    a.push_open_node(def, Kind::Unknown, NodeFlags::NONE, &slots)
}
