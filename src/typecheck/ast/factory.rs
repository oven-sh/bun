// What the generated NodeFactory needs from the place that keeps the nodes, and the factory of an open store.
use crate::ast::ast_generated::Def;
use crate::ast::file::NodeRecord;
use crate::ast::ids::{ModifierListId, NodeId, NodeListId, OPEN_BIT};
use crate::ast::kind_generated::Kind;
use crate::ast::layout::SlotType;
use crate::ast::modifierflags::ModifierFlags;
use crate::ast::nodeflags::NodeFlags;
use crate::ast::open::{OpenList, OpenNode, push};
use crate::ast::reader::Ast;
use crate::ast::utilities::modifier_to_flag;
use crate::core::undefined_text_range;
use crate::internal::FaultKind;

pub trait NodeSink {
    // newNode: a node of `def`. The slots that `slots` does not give are 0, and the range is undefined.
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
    // The body of an Update function: `listed` are the members that the constructor sets, in slot order, and `flags` its flags member.
    fn update_node(
        &mut self,
        node: NodeId,
        def: Def,
        flags: Option<NodeFlags>,
        listed: &[u32],
    ) -> NodeId;
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

    // NodeFactory.NodeCount
    pub fn node_count(&self) -> u32 {
        self.ast.open.node_count()
    }

    // NodeFactory.TextCount
    pub fn text_count(&self) -> u32 {
        self.ast.open.text_count()
    }

    // The words of a node as a node of the open store holds them: a text is kept by the store.
    fn copy_slots(&mut self, node: NodeId) -> Option<(Def, Vec<u32>)> {
        let (def, data) = self.ast.data_any(node)?;
        let info = def.info();
        let mut slots = Vec::with_capacity(info.slots.len());
        for (index, slot) in info.slots.iter().enumerate() {
            slots.push(match slot.ty {
                SlotType::Text => self.text_slot(data.text(index)),
                _ => data.word(index),
            });
        }
        Some((def, slots))
    }

    // Node.Clone: a node with the same members, flags and range. The fields that the binder writes are not copied.
    pub fn clone_node(&mut self, node: NodeId) -> NodeId {
        let Some((def, slots)) = self.copy_slots(node) else {
            return NodeId::NIL;
        };
        if def.info().has_text_content() {
            self.count_text();
        }
        let clone = self.alloc_node(def, self.ast.kind(node), self.ast.flags(node), &slots);
        if !clone.is_nil() {
            self.ast.set_loc(clone, self.ast.loc(node));
        }
        clone
    }

    // NodeList.Clone: a list of the store with the same nodes and the same range.
    pub fn clone_node_list(&mut self, list: NodeListId) -> NodeListId {
        if list.is_nil() {
            return NodeListId::NIL;
        }
        let nodes = self.ast.nodes(list);
        let index = self.push_list(nodes.as_slice(), ModifierFlags::NONE);
        let clone = NodeListId::from_open_index(index);
        if !clone.is_nil() {
            self.ast.set_list_loc(clone, self.ast.list_loc(list));
        }
        clone
    }

    // ModifierList.Clone
    pub fn clone_modifier_list(&mut self, list: ModifierListId) -> ModifierListId {
        if list.is_nil() {
            return ModifierListId::NIL;
        }
        let nodes = self.ast.modifier_list_nodes(list);
        let index = self.push_list(nodes.as_slice(), self.ast.modifier_list_flags(list));
        let clone = ModifierListId::from_open_index(index);
        if !clone.is_nil() {
            let loc = self.ast.modifier_list_loc(list);
            self.ast.set_list_loc(clone.as_node_list(), loc);
        }
        clone
    }

    fn push_list(&mut self, nodes: &[NodeId], modifier_flags: ModifierFlags) -> u32 {
        let open = self.ast.open;
        let list = OpenList {
            loc: undefined_text_range(),
            nodes: open.arena.alloc_slice_copy(nodes),
            modifier_flags,
        };
        let index = push(&open.lists, list);
        if index == 0 {
            self.ast
                .fault(FaultKind::IdSpaceExhausted, "NodeList", 0, 0);
        }
        index
    }
}

impl Ast<'_> {
    fn try_push_open_node(
        self,
        def: Def,
        kind: Kind,
        flags: NodeFlags,
        slots: &[u32],
    ) -> Option<u32> {
        let open = self.open;
        let info = def.info();
        let mut nodes = open.nodes.try_borrow_mut().ok()?;
        let mut words = open.slots.try_borrow_mut().ok()?;
        let index = u32::try_from(nodes.len())
            .ok()
            .filter(|index| *index < OPEN_BIT - 1)?;
        let data = u32::try_from(words.len()).ok()?;
        let total = info.slots.len() + info.late_count();
        u32::try_from(words.len() + total).ok()?;
        words.extend((0..info.slots.len()).map(|at| slots.get(at).copied().unwrap_or(0)));
        words.resize(data as usize + total, 0);
        nodes.push(OpenNode {
            rec: NodeRecord {
                loc: undefined_text_range(),
                parent: NodeId::NIL,
                data,
                late: data + info.slots.len() as u32,
                kind,
                def,
            },
            flags,
        });
        Some(index)
    }

    // newNode without a factory: a node of the open store that no factory counts.
    pub(crate) fn push_open_node(
        self,
        def: Def,
        kind: Kind,
        flags: NodeFlags,
        slots: &[u32],
    ) -> NodeId {
        match self.try_push_open_node(def, kind, flags, slots) {
            Some(index) => NodeId::from_open_index(index),
            None => {
                self.fault(FaultKind::IdSpaceExhausted, "newNode", kind as u32, 0);
                NodeId::NIL
            }
        }
    }
}

impl NodeSink for Factory<'_> {
    fn alloc_node(&mut self, def: Def, kind: Kind, flags: NodeFlags, slots: &[u32]) -> NodeId {
        let node = self.ast.push_open_node(def, kind, flags, slots);
        if !node.is_nil() {
            let open = self.ast.open;
            open.node_count.set(open.node_count.get().saturating_add(1));
        }
        node
    }

    fn text_slot(&mut self, text: &[u8]) -> u32 {
        if text.is_empty() {
            return 0;
        }
        let open = self.ast.open;
        push(&open.texts, open.arena.alloc_slice_copy(text))
    }

    fn count_text(&mut self) {
        let open = self.ast.open;
        open.text_count.set(open.text_count.get().saturating_add(1));
    }

    fn new_node_list(&mut self, nodes: &[NodeId]) -> NodeListId {
        NodeListId::from_open_index(self.push_list(nodes, ModifierFlags::NONE))
    }

    fn new_modifier_list(&mut self, nodes: &[NodeId]) -> ModifierListId {
        let mut modifier_flags = ModifierFlags::NONE;
        for node in nodes {
            modifier_flags |= modifier_to_flag(self.ast.kind(*node));
        }
        ModifierListId::from_open_index(self.push_list(nodes, modifier_flags))
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
        let original_flags = self.ast.flags(node);
        let mut changed = flags.is_some_and(|flags| flags != original_flags);
        for (index, value) in listed.iter().enumerate() {
            let same = match info.slots.get(index).map(|slot| slot.ty) {
                Some(SlotType::Text) => data.text(index) == self.ast.open_text(*value),
                _ => data.word(index) == *value,
            };
            changed |= !same;
        }
        if !changed {
            return node;
        }
        if info.has_text_content() {
            self.count_text();
        }
        // updateNode: the new node takes the flags and the range of the original.
        let updated = self.alloc_node(def, self.ast.kind(node), original_flags, listed);
        if !updated.is_nil() {
            self.ast.set_loc(updated, self.ast.loc(node));
        }
        updated
    }
}
