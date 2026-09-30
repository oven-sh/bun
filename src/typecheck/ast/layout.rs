// The shape of the generated tables: what a slot of a node holds, how a child is visited, which fields the binder writes.

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
    Any,
    FlowNode,
    FlowList,
}

impl SlotType {
    // True for a slot that holds the id of a node.
    pub const fn is_node(self) -> bool {
        matches!(self, SlotType::Node)
    }

    // True for a slot that holds the id of a list of nodes.
    pub const fn is_list(self) -> bool {
        matches!(
            self,
            SlotType::NodeList | SlotType::ModifierList | SlotType::RawNodeList
        )
    }
}

// The hook of NodeVisitor that upstream's VisitEachChild calls for a member. None is a member that is no child.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum VisitTag {
    None,
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
    // The member name of ast.json.
    pub name: &'static str,
    pub ty: SlotType,
    pub visit: VisitTag,
    // The bits of a token flags member that its constructor keeps; every bit for another member.
    pub mask: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct DefInfo {
    // The name of the definition in ast.json, which is the name of upstream's struct.
    pub name: &'static str,
    // The members in the order of ast.json, then the struct fields that no constructor sets.
    pub slots: &'static [SlotInfo],
    // The number of leading slots that the constructor sets.
    pub factory_slots: u8,
    // The slots of the children in the order of upstream's ForEachChild.
    pub children: &'static [u8],
    // The order of a node whose ForEachChild depends on a member (JSDocParameterOrPropertyTag with IsNameFirst).
    pub children_alt: &'static [u8],
    // The fields that the binder writes: a set of LATE_* bits.
    pub late: u8,
}

impl DefInfo {
    // The slot of the member with this name in ast.json.
    pub fn slot_index(&self, member: &[u8]) -> Option<usize> {
        self.slots
            .iter()
            .position(|slot| slot.name.as_bytes() == member)
    }

    // hasTextContent of upstream's generator: a constructor of the definition counts a text.
    pub fn has_text_content(&self) -> bool {
        self.slots
            .iter()
            .take(usize::from(self.factory_slots))
            .any(|slot| slot.ty == SlotType::Text)
    }

    // The number of fields of the definition that the binder writes.
    pub const fn late_count(&self) -> usize {
        self.late.count_ones() as usize
    }
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

// The position of a field of the binder among the fields of the binder that its node has.
#[inline]
pub const fn late_rank(mask: u8, bit: u8) -> usize {
    (mask & bit.wrapping_sub(1)).count_ones() as usize
}
