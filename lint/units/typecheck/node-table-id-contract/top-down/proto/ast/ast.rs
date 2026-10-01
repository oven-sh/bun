// The methods of *Node that ast.go writes by hand and that are not a switch on the kind (ast.go:192-270, 476-626,
// 870-876, 945-951, 1035-1065, 1155-1177, 1560-1574). A node is its id; every method takes the context.
use crate::ast::ast_generated::{
    BODY_ASTERISK_TOKEN_SLOT, BODY_SLOT, CLASS_LIKE_HERITAGE_CLAUSES_SLOT, CLASS_LIKE_MEMBERS_SLOT,
    CLASS_LIKE_TYPE_PARAMETERS_SLOT, Def, END_FLOW_NODE_SLOT, FLOW_NODE_SLOT,
    FUNCTION_LIKE_FULL_SIGNATURE_SLOT, FUNCTION_LIKE_PARAMETERS_SLOT,
    FUNCTION_LIKE_TYPE_PARAMETERS_SLOT, FUNCTION_LIKE_TYPE_SLOT, LITERAL_LIKE_TEXT_SLOT,
    LITERAL_LIKE_TOKEN_FLAGS_SLOT, LOCAL_SYMBOL_SLOT, LOCALS_SLOT, MODIFIERS_SLOT, NAME_SLOT,
    NEXT_CONTAINER_SLOT, SYMBOL_SLOT, SlotType, TEMPLATE_LITERAL_LIKE_RAW_TEXT_SLOT,
    TEMPLATE_LITERAL_LIKE_TEMPLATE_FLAGS_SLOT, layout,
};
use crate::ast::context::Ast;
use crate::ast::flags_generated::{ModifierFlags, NodeFlags, TokenFlags};
use crate::ast::kind_generated::Kind;
use crate::core::TextRange;
use crate::golang::{List, Text};
use crate::ids::{FlowNodeId, ModifierListId, NodeId, NodeListId, SymbolId, SymbolTableId};

// The views of the base structs. `nil` is true where the reference returns a nil pointer.
#[derive(Clone, Copy, Default, Debug)]
pub struct DeclarationBase {
    pub nil: bool,
    pub symbol: SymbolId,
}
#[derive(Clone, Copy, Default, Debug)]
pub struct ExportableBase {
    pub nil: bool,
    pub local_symbol: SymbolId,
}
#[derive(Clone, Copy, Default, Debug)]
pub struct LocalsContainerBase {
    pub nil: bool,
    pub locals: SymbolTableId,
    pub next_container: NodeId,
}
#[derive(Clone, Copy, Default, Debug)]
pub struct FlowNodeBase {
    pub nil: bool,
    pub flow_node: FlowNodeId,
}
#[derive(Clone, Copy, Default, Debug)]
pub struct FunctionLikeBase {
    pub nil: bool,
    pub type_parameters: NodeListId,
    pub parameters: NodeListId,
    pub type_node: NodeId,
    pub full_signature: NodeId,
}
#[derive(Clone, Copy, Default, Debug)]
pub struct BodyBase {
    pub nil: bool,
    pub asterisk_token: NodeId,
    pub body: NodeId,
    pub end_flow_node: FlowNodeId,
}
#[derive(Clone, Copy, Default, Debug)]
pub struct ClassLikeBase {
    pub nil: bool,
    pub name: NodeId,
    pub type_parameters: NodeListId,
    pub heritage_clauses: NodeListId,
    pub members: NodeListId,
}
#[derive(Clone, Copy, Default, Debug)]
pub struct LiteralLikeNodeBase<'a> {
    pub nil: bool,
    pub text: Text<'a>,
    pub token_flags: TokenFlags,
}
#[derive(Clone, Copy, Default, Debug)]
pub struct TemplateLiteralLikeNodeBase<'a> {
    pub nil: bool,
    pub raw_text: Text<'a>,
    pub template_flags: TokenFlags,
}

impl NodeId {
    #[inline]
    pub fn kind(self, a: Ast<'_>) -> Kind {
        a.kind(self)
    }
    #[inline]
    pub fn flags(self, a: Ast<'_>) -> NodeFlags {
        a.flags(self)
    }
    #[inline]
    pub fn loc(self, a: Ast<'_>) -> TextRange {
        a.loc(self)
    }
    #[inline]
    pub fn pos(self, a: Ast<'_>) -> i32 {
        a.loc(self).pos()
    }
    #[inline]
    pub fn end(self, a: Ast<'_>) -> i32 {
        a.loc(self).end()
    }
    #[inline]
    pub fn parent(self, a: Ast<'_>) -> NodeId {
        a.parent(self)
    }
    pub fn kind_string(self, a: Ast<'_>) -> &'static str {
        a.kind(self).string()
    }
    pub fn name(self, a: Ast<'_>) -> NodeId {
        NodeId(a.slot_by_table(self, &NAME_SLOT).unwrap_or(0))
    }
    pub fn modifiers(self, a: Ast<'_>) -> ModifierListId {
        ModifierListId(a.slot_by_table(self, &MODIFIERS_SLOT).unwrap_or(0))
    }
    pub fn declaration_data(self, a: Ast<'_>) -> DeclarationBase {
        match a.slot_by_table(self, &SYMBOL_SLOT) {
            Some(symbol) => DeclarationBase {
                nil: false,
                symbol: SymbolId(symbol),
            },
            None => DeclarationBase {
                nil: true,
                ..DeclarationBase::default()
            },
        }
    }
    pub fn exportable_data(self, a: Ast<'_>) -> ExportableBase {
        match a.slot_by_table(self, &LOCAL_SYMBOL_SLOT) {
            Some(symbol) => ExportableBase {
                nil: false,
                local_symbol: SymbolId(symbol),
            },
            None => ExportableBase {
                nil: true,
                ..ExportableBase::default()
            },
        }
    }
    pub fn locals_container_data(self, a: Ast<'_>) -> LocalsContainerBase {
        match a.slot_by_table(self, &LOCALS_SLOT) {
            Some(locals) => LocalsContainerBase {
                nil: false,
                locals: SymbolTableId(locals),
                next_container: NodeId(a.slot_by_table(self, &NEXT_CONTAINER_SLOT).unwrap_or(0)),
            },
            None => LocalsContainerBase {
                nil: true,
                ..LocalsContainerBase::default()
            },
        }
    }
    pub fn flow_node_data(self, a: Ast<'_>) -> FlowNodeBase {
        match a.slot_by_table(self, &FLOW_NODE_SLOT) {
            Some(flow_node) => FlowNodeBase {
                nil: false,
                flow_node: FlowNodeId(flow_node),
            },
            None => FlowNodeBase {
                nil: true,
                ..FlowNodeBase::default()
            },
        }
    }
    pub fn function_like_data(self, a: Ast<'_>) -> FunctionLikeBase {
        match a.slot_by_table(self, &FUNCTION_LIKE_PARAMETERS_SLOT) {
            Some(parameters) => FunctionLikeBase {
                nil: false,
                type_parameters: NodeListId(
                    a.slot_by_table(self, &FUNCTION_LIKE_TYPE_PARAMETERS_SLOT)
                        .unwrap_or(0),
                ),
                parameters: NodeListId(parameters),
                type_node: NodeId(a.slot_by_table(self, &FUNCTION_LIKE_TYPE_SLOT).unwrap_or(0)),
                full_signature: NodeId(
                    a.slot_by_table(self, &FUNCTION_LIKE_FULL_SIGNATURE_SLOT)
                        .unwrap_or(0),
                ),
            },
            None => FunctionLikeBase {
                nil: true,
                ..FunctionLikeBase::default()
            },
        }
    }
    pub fn body_data(self, a: Ast<'_>) -> BodyBase {
        match a.slot_by_table(self, &BODY_SLOT) {
            Some(body) => BodyBase {
                nil: false,
                asterisk_token: NodeId(
                    a.slot_by_table(self, &BODY_ASTERISK_TOKEN_SLOT)
                        .unwrap_or(0),
                ),
                body: NodeId(body),
                end_flow_node: FlowNodeId(a.slot_by_table(self, &END_FLOW_NODE_SLOT).unwrap_or(0)),
            },
            None => BodyBase {
                nil: true,
                ..BodyBase::default()
            },
        }
    }
    pub fn class_like_data(self, a: Ast<'_>) -> ClassLikeBase {
        match a.slot_by_table(self, &CLASS_LIKE_MEMBERS_SLOT) {
            Some(members) => ClassLikeBase {
                nil: false,
                name: self.name(a),
                type_parameters: NodeListId(
                    a.slot_by_table(self, &CLASS_LIKE_TYPE_PARAMETERS_SLOT)
                        .unwrap_or(0),
                ),
                heritage_clauses: NodeListId(
                    a.slot_by_table(self, &CLASS_LIKE_HERITAGE_CLAUSES_SLOT)
                        .unwrap_or(0),
                ),
                members: NodeListId(members),
            },
            None => ClassLikeBase {
                nil: true,
                ..ClassLikeBase::default()
            },
        }
    }
    pub fn literal_like_data<'a>(self, a: Ast<'a>) -> LiteralLikeNodeBase<'a> {
        match a.slot_by_table(self, &LITERAL_LIKE_TEXT_SLOT) {
            Some(text) => LiteralLikeNodeBase {
                nil: false,
                text: a.node_text(self, text),
                token_flags: TokenFlags::from_bits_retain(
                    a.slot_by_table(self, &LITERAL_LIKE_TOKEN_FLAGS_SLOT)
                        .unwrap_or(0),
                ),
            },
            None => LiteralLikeNodeBase {
                nil: true,
                ..LiteralLikeNodeBase::default()
            },
        }
    }
    pub fn template_literal_like_data<'a>(self, a: Ast<'a>) -> TemplateLiteralLikeNodeBase<'a> {
        match a.slot_by_table(self, &TEMPLATE_LITERAL_LIKE_RAW_TEXT_SLOT) {
            Some(text) => TemplateLiteralLikeNodeBase {
                nil: false,
                raw_text: a.node_text(self, text),
                template_flags: TokenFlags::from_bits_retain(
                    a.slot_by_table(self, &TEMPLATE_LITERAL_LIKE_TEMPLATE_FLAGS_SLOT)
                        .unwrap_or(0),
                ),
            },
            None => TemplateLiteralLikeNodeBase {
                nil: true,
                ..TemplateLiteralLikeNodeBase::default()
            },
        }
    }
    // ast.go:238, MutableNode.SetModifiers: a node without modifiers ignores the call, as NodeDefault does.
    pub fn set_modifiers(self, a: Ast<'_>, modifiers: ModifierListId) {
        a.set_slot_by_table(self, &MODIFIERS_SLOT, modifiers.0);
    }
    // What the binder writes through DeclarationData, ExportableData, LocalsContainerData, FlowNodeData and BodyData.
    pub fn set_symbol(self, a: Ast<'_>, symbol: SymbolId) -> bool {
        a.set_slot_by_table(self, &SYMBOL_SLOT, symbol.0)
    }
    pub fn set_local_symbol(self, a: Ast<'_>, symbol: SymbolId) -> bool {
        a.set_slot_by_table(self, &LOCAL_SYMBOL_SLOT, symbol.0)
    }
    pub fn set_locals(self, a: Ast<'_>, locals: SymbolTableId) -> bool {
        a.set_slot_by_table(self, &LOCALS_SLOT, locals.0)
    }
    pub fn set_next_container(self, a: Ast<'_>, next: NodeId) -> bool {
        a.set_slot_by_table(self, &NEXT_CONTAINER_SLOT, next.0)
    }
    pub fn set_flow_node(self, a: Ast<'_>, flow_node: FlowNodeId) -> bool {
        a.set_slot_by_table(self, &FLOW_NODE_SLOT, flow_node.0)
    }
    pub fn set_end_flow_node(self, a: Ast<'_>, flow_node: FlowNodeId) -> bool {
        a.set_slot_by_table(self, &END_FLOW_NODE_SLOT, flow_node.0)
    }
    // ast.go:216: a nil FunctionLikeData is a panic upstream.
    pub fn parameter_list(self, a: Ast<'_>) -> NodeListId {
        match a.slot_by_table(self, &FUNCTION_LIKE_PARAMETERS_SLOT) {
            Some(parameters) => NodeListId(parameters),
            None => {
                a.unhandled("Node.ParameterList", self);
                NodeListId::NIL
            }
        }
    }
    pub fn parameters<'a>(self, a: Ast<'a>) -> List<'a, NodeId> {
        a.list_nodes(self.parameter_list(a))
    }
    pub fn symbol(self, a: Ast<'_>) -> SymbolId {
        self.declaration_data(a).symbol
    }
    pub fn local_symbol(self, a: Ast<'_>) -> SymbolId {
        self.exportable_data(a).local_symbol
    }
    pub fn locals(self, a: Ast<'_>) -> SymbolTableId {
        self.locals_container_data(a).locals
    }
    pub fn body(self, a: Ast<'_>) -> NodeId {
        self.body_data(a).body
    }
    fn nodes_or_nil<'a>(a: Ast<'a>, list: NodeListId) -> List<'a, NodeId> {
        if list.is_nil() {
            return List::NIL;
        }
        a.list_nodes(list)
    }
    pub fn arguments<'a>(self, a: Ast<'a>) -> List<'a, NodeId> {
        Self::nodes_or_nil(a, self.argument_list(a))
    }
    pub fn type_arguments<'a>(self, a: Ast<'a>) -> List<'a, NodeId> {
        Self::nodes_or_nil(a, self.type_argument_list(a))
    }
    pub fn type_parameters<'a>(self, a: Ast<'a>) -> List<'a, NodeId> {
        Self::nodes_or_nil(a, self.type_parameter_list(a))
    }
    pub fn members<'a>(self, a: Ast<'a>) -> List<'a, NodeId> {
        Self::nodes_or_nil(a, self.member_list(a))
    }
    pub fn statements<'a>(self, a: Ast<'a>) -> List<'a, NodeId> {
        Self::nodes_or_nil(a, self.statement_list(a))
    }
    pub fn comments<'a>(self, a: Ast<'a>) -> List<'a, NodeId> {
        Self::nodes_or_nil(a, self.comment_list(a))
    }
    pub fn properties<'a>(self, a: Ast<'a>) -> List<'a, NodeId> {
        Self::nodes_or_nil(a, self.property_list(a))
    }
    pub fn elements<'a>(self, a: Ast<'a>) -> List<'a, NodeId> {
        Self::nodes_or_nil(a, self.element_list(a))
    }
    pub fn modifier_flags(self, a: Ast<'_>) -> ModifierFlags {
        let modifiers = self.modifiers(a);
        if !modifiers.is_nil() {
            return a.list_modifier_flags(modifiers);
        }
        ModifierFlags::empty()
    }
    pub fn modifier_nodes<'a>(self, a: Ast<'a>) -> List<'a, NodeId> {
        Self::nodes_or_nil(a, self.modifiers(a).as_node_list())
    }
    pub fn property_name_or_name(self, a: Ast<'_>) -> NodeId {
        let mut name = self.property_name(a);
        if name.is_nil() {
            name = self.name(a);
        }
        name
    }
    // ast.go:1155
    pub fn contains(self, a: Ast<'_>, descendant: NodeId) -> bool {
        let mut descendant = descendant;
        while !descendant.is_nil() {
            if descendant == self {
                return true;
            }
            let parent = descendant.parent(a);
            if parent.is_nil() && descendant.kind(a) != Kind::SourceFile {
                a.unhandled("descendant is not parented", descendant);
                return false;
            }
            descendant = parent;
        }
        false
    }
    // ast.go:1560. The cache of the reference is the file's table of hosts here.
    pub fn jsdoc<'a>(self, a: Ast<'a>) -> List<'a, NodeId> {
        if !self.flags(a).intersects(NodeFlags::HAS_JSDOC) {
            return List::NIL;
        }
        a.jsdoc_of(self)
    }
    // Node.ForEachChild: the children in the reference's order, until the visitor returns true.
    pub fn for_each_child(self, a: Ast<'_>, v: &mut dyn FnMut(NodeId) -> bool) -> bool {
        let (def, slots) = a.slots_any(self);
        if def == Def::JSDocParameterOrPropertyTag {
            return for_each_child_jsdoc_parameter_or_property_tag(self, a, v);
        }
        for &(slot, _) in layout(def).children {
            let value = slots.get(slot as usize).copied().unwrap_or(0);
            if value == 0 {
                continue;
            }
            let is_node = layout(def)
                .slots
                .get(slot as usize)
                .is_some_and(|field| field.ty == SlotType::Node);
            if is_node {
                if v(NodeId(value)) {
                    return true;
                }
            } else {
                for child in a.list_nodes(NodeListId(value)).iter() {
                    if v(child) {
                        return true;
                    }
                }
            }
        }
        false
    }
}

// ast.go:3183
fn for_each_child_jsdoc_parameter_or_property_tag(
    node: NodeId,
    a: Ast<'_>,
    v: &mut dyn FnMut(NodeId) -> bool,
) -> bool {
    let n = node.as_jsdoc_parameter_or_property_tag(a);
    let mut visit = |child: NodeId| !child.is_nil() && v(child);
    if visit(n.tag_name) {
        return true;
    }
    let (first, second) = if n.is_name_first {
        (n.name, n.type_expression)
    } else {
        (n.type_expression, n.name)
    };
    if visit(first) || visit(second) {
        return true;
    }
    if !n.comment.is_nil() {
        for child in a.list_nodes(n.comment).iter() {
            if visit(child) {
                return true;
            }
        }
    }
    false
}
