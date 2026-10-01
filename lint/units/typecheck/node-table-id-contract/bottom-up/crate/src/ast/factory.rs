// What the generated NodeFactory needs from the place that keeps the nodes, and the factory of an open store.
use crate::ast::ast_generated::Def;
use crate::ast::flags_generated::{ModifierFlags, NodeFlags};
use crate::ast::kind_generated::Kind;
use crate::ast::layout::SlotType;
use crate::ast::open::{OpenList, OpenNode, push, read};
use crate::ast::reader::Ast;
use crate::tscore::golang::List;
use crate::tscore::ids::{ModifierListId, NodeId, NodeListId};
use crate::tscore::internal::FaultKind;
use crate::tscore::text::undefined_text_range;

pub trait NodeSink {
    // newNode: a node of `def` with every slot of the definition, the ones a constructor does not set as 0.
    fn alloc_node(&mut self, def: Def, kind: Kind, flags: NodeFlags, slots: &[u32]) -> NodeId;
    // Keeps a text and returns the word that a Text slot holds.
    fn text_slot(&mut self, text: &[u8]) -> u32;
    // f.textCount++
    fn count_text(&mut self);
    // NodeFactory.NewNodeList
    fn new_node_list(&mut self, nodes: &[NodeId]) -> NodeListId;
    // NodeFactory.NewModifierList
    fn new_modifier_list(&mut self, nodes: &[NodeId]) -> ModifierListId;
}

pub trait NodeUpdate: NodeSink {
    // The body of an Update function: `listed` are the members that the constructor sets, in slot order.
    fn update_node(
        &mut self,
        node: NodeId,
        def: Def,
        flags: Option<NodeFlags>,
        listed: &[u32],
    ) -> NodeId;
}

// ast.ModifierToFlag
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
        _ => ModifierFlags::NONE,
    }
}

// The NodeFactory of a checker, of a program and of a binder: its nodes live in the open store of the context.
#[derive(Clone, Copy)]
pub struct Factory<'a> {
    pub ast: Ast<'a>,
}

impl<'a> Factory<'a> {
    pub fn new(ast: Ast<'a>) -> Self {
        Self { ast }
    }
    // Node.Clone: a node with the same members, flags and range. The fields that the binder writes are not copied.
    pub fn clone_node(&mut self, node: NodeId) -> NodeId {
        let Some((def, data)) = self.ast.data_any(node) else {
            return NodeId::NIL;
        };
        let info = def.info();
        let mut slots = Vec::with_capacity(info.slots.len());
        for (index, slot) in info.slots.iter().enumerate() {
            slots.push(match slot.ty {
                SlotType::Text => self.text_slot(data.text(index)),
                _ => data.node(index).0,
            });
        }
        let clone = self.alloc_node(def, self.ast.kind(node), self.ast.flags(node), &slots);
        self.ast.set_loc(clone, self.ast.loc(node));
        clone
    }
}

impl NodeSink for Factory<'_> {
    fn alloc_node(&mut self, def: Def, kind: Kind, flags: NodeFlags, slots: &[u32]) -> NodeId {
        let open = self.ast.open();
        let slots = open.arena.alloc_slice_copy(slots);
        let node = OpenNode {
            loc: undefined_text_range(),
            parent: NodeId::NIL,
            flags,
            kind,
            def,
            slots,
            late: [0; 8],
        };
        let index = push(&open.nodes, node);
        if index == 0 {
            self.ast.fault(FaultKind::IdSpaceExhausted, "newNode", 0, 0);
            return NodeId::NIL;
        }
        open.node_count.set(open.node_count.get().saturating_add(1));
        NodeId::from_open_index(index)
    }
    fn text_slot(&mut self, text: &[u8]) -> u32 {
        let open = self.ast.open();
        push(&open.texts, open.arena.alloc_slice_copy(text))
    }
    fn count_text(&mut self) {
        let open = self.ast.open();
        open.text_count.set(open.text_count.get().saturating_add(1));
    }
    fn new_node_list(&mut self, nodes: &[NodeId]) -> NodeListId {
        let open = self.ast.open();
        let nodes = List::from_slice(open.arena.alloc_slice_copy(nodes));
        NodeListId::from_open_index(push(
            &open.lists,
            OpenList {
                loc: undefined_text_range(),
                nodes,
                modifier_flags: ModifierFlags::NONE,
            },
        ))
    }
    fn new_modifier_list(&mut self, nodes: &[NodeId]) -> ModifierListId {
        let open = self.ast.open();
        let mut modifier_flags = ModifierFlags::NONE;
        for node in nodes {
            modifier_flags |= modifier_to_flag(self.ast.kind(*node));
        }
        let nodes = List::from_slice(open.arena.alloc_slice_copy(nodes));
        ModifierListId::from_open_index(push(
            &open.lists,
            OpenList {
                loc: undefined_text_range(),
                nodes,
                modifier_flags,
            },
        ))
    }
}

impl NodeUpdate for Factory<'_> {
    fn update_node(
        &mut self,
        node: NodeId,
        def: Def,
        flags: Option<NodeFlags>,
        listed: &[u32],
    ) -> NodeId {
        let Some(data) = self.ast.data(node, def) else {
            return node;
        };
        let info = def.info();
        let open = self.ast.open();
        let mut changed = flags.is_some_and(|flags| flags != self.ast.flags(node));
        for (index, value) in listed.iter().enumerate() {
            let same = match info.slots.get(index).map(|slot| slot.ty) {
                Some(SlotType::Text) => {
                    data.text(index) == read(&open.texts, *value as usize, |text| *text)
                }
                _ => data.node(index).0 == *value,
            };
            changed |= !same;
        }
        if !changed {
            return node;
        }
        let mut slots = listed.to_vec();
        slots.resize(info.slots.len(), 0);
        let updated = self.alloc_node(def, self.ast.kind(node), self.ast.flags(node), &slots);
        self.ast.set_loc(updated, self.ast.loc(node));
        updated
    }
}
