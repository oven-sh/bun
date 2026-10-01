// The shape of the generated tables: what a slot of a node holds and how the children are visited.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SlotType {
    Node,
    NodeList,
    ModifierList,
    RawNodeList,
    Text,
    Bool,
    Kind,
    TokenFlags,
    Int,
    TypeId,
    FlowNode,
    FlowList,
}

// The hook of NodeVisitor that upstream's VisitEachChild calls for a member.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum VisitTag {
    Node,
    Token,
    Nodes,
    Modifiers,
    RawNodes,
    EmbeddedStatement,
    IterationBody,
    Parameters,
    FunctionBody,
    TopLevelStatements,
}

#[derive(Clone, Copy, Debug)]
pub struct SlotInfo {
    // The member name of _scripts/ast.json.
    pub name: &'static str,
    pub ty: SlotType,
}

#[derive(Clone, Copy, Debug)]
pub struct ChildSlot {
    pub slot: u8,
    pub visit: VisitTag,
}

#[derive(Clone, Copy, Debug)]
pub struct DefInfo {
    pub name: &'static str,
    pub slots: &'static [SlotInfo],
    // In the order of upstream's ForEachChild.
    pub children: &'static [ChildSlot],
    // The second order of a node whose ForEachChild depends on a member (JSDocParameterOrPropertyTag).
    pub children_alt: &'static [ChildSlot],
    // The fields that the binder writes: a set of LATE_* bits.
    pub late: u8,
}

// DeclarationBase.Symbol
pub const LATE_SYMBOL: u8 = 1 << 0;
// ExportableBase.LocalSymbol
pub const LATE_LOCAL_SYMBOL: u8 = 1 << 1;
// LocalsContainerBase.Locals
pub const LATE_LOCALS: u8 = 1 << 2;
// LocalsContainerBase.NextContainer
pub const LATE_NEXT_CONTAINER: u8 = 1 << 3;
// FlowNodeBase.FlowNode
pub const LATE_FLOW_NODE: u8 = 1 << 4;
// BodyBase.EndFlowNode
pub const LATE_END_FLOW_NODE: u8 = 1 << 5;
// ReturnFlowNode of the four function-like nodes that have one
pub const LATE_RETURN_FLOW_NODE: u8 = 1 << 6;
// CaseOrDefaultClause.FallthroughFlowNode
pub const LATE_FALLTHROUGH_FLOW_NODE: u8 = 1 << 7;

// The position of a late field among the late fields of its node.
#[inline]
pub const fn late_rank(mask: u8, bit: u8) -> usize {
    (mask & bit.wrapping_sub(1)).count_ones() as usize
}
