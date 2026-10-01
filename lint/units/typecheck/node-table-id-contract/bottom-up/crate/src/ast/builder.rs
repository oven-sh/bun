// The write side of a producer: nodes are made in any order, `finish` numbers them in the order of ForEachChild.
use crate::ast::ast_generated::Def;
use crate::ast::factory::{NodeSink, modifier_to_flag};
use crate::ast::file::{
    File, IdAllocator, ListRecord, NodeRecord, SourceFileData, TextSpan, round_up_to_page,
};
use crate::ast::flags_generated::{ModifierFlags, NodeFlags};
use crate::ast::kind_generated::Kind;
use crate::ast::layout::{ChildSlot, SlotType, VisitTag};
use crate::ast::node_methods_generated::{expression_slot, initializer_slot, type_node_slot};
use crate::tscore::ids::{ModifierListId, NodeId, NodeListId};
use crate::tscore::internal::{Fault, FaultKind, Faults};
use crate::tscore::text::{TextRange, undefined_text_range};
use std::sync::atomic::AtomicU32;

#[derive(Clone, Copy, Default)]
struct BuilderNode {
    loc: TextRange,
    flags: NodeFlags,
    data: u32,
    kind: Kind,
    def: Def,
}

// The lengths of the builder at one moment. `rewind` drops what was made after it.
#[derive(Clone, Copy, Debug)]
pub struct Mark {
    nodes: usize,
    slots: usize,
    lists: usize,
    list_items: usize,
    texts: usize,
    text_bytes: usize,
    jsdoc: usize,
}

pub struct FileBuilder {
    nodes: Vec<BuilderNode>,
    slots: Vec<u32>,
    lists: Vec<ListRecord>,
    list_items: Vec<NodeId>,
    texts: Vec<TextSpan>,
    text_bytes: Vec<u8>,
    source_len: u32,
    jsdoc: Vec<(NodeId, NodeListId)>,
    text_count: u32,
    pub faults: Faults,
}

impl FileBuilder {
    pub fn new(source_text: &[u8]) -> Self {
        Self {
            nodes: vec![BuilderNode::default()],
            slots: Vec::new(),
            lists: vec![ListRecord::default()],
            list_items: Vec::new(),
            texts: vec![TextSpan::default()],
            text_bytes: source_text.to_vec(),
            source_len: source_text.len() as u32,
            jsdoc: Vec::new(),
            text_count: 0,
            faults: Faults::default(),
        }
    }
    pub fn node_count(&self) -> u32 {
        self.nodes.len().saturating_sub(1) as u32
    }
    // A text that the source has at `start`: nothing is copied.
    pub fn source_text_slot(&mut self, start: u32, len: u32) -> u32 {
        if start
            .checked_add(len)
            .is_none_or(|end| end > self.source_len)
        {
            return 0;
        }
        self.texts.push(TextSpan { start, len });
        (self.texts.len() - 1) as u32
    }
    // NodeFactory.NewSourceFile without the file data, which `finish` takes.
    pub fn new_source_file(&mut self, statements: NodeListId, end_of_file_token: NodeId) -> NodeId {
        self.alloc_node(
            Def::SourceFile,
            Kind::SourceFile,
            NodeFlags::NONE,
            &[statements.0, end_of_file_token.0],
        )
    }
    pub fn kind(&self, node: NodeId) -> Kind {
        self.nodes
            .get(node.0 as usize)
            .map_or(Kind::Unknown, |n| n.kind)
    }
    pub fn def(&self, node: NodeId) -> Def {
        self.nodes.get(node.0 as usize).map_or(Def::None, |n| n.def)
    }
    pub fn flags(&self, node: NodeId) -> NodeFlags {
        self.nodes
            .get(node.0 as usize)
            .map_or(NodeFlags::NONE, |n| n.flags)
    }
    pub fn loc(&self, node: NodeId) -> TextRange {
        self.nodes
            .get(node.0 as usize)
            .map_or_else(undefined_text_range, |n| n.loc)
    }
    pub fn set_flags(&mut self, node: NodeId, flags: NodeFlags) {
        match self.nodes.get_mut(node.0 as usize) {
            Some(n) if node.0 != 0 => n.flags = flags,
            _ => self.nil_write("Node.Flags", node.0),
        }
    }
    pub fn set_loc(&mut self, node: NodeId, loc: TextRange) {
        match self.nodes.get_mut(node.0 as usize) {
            Some(n) if node.0 != 0 => n.loc = loc,
            _ => self.nil_write("Node.Loc", node.0),
        }
    }
    pub fn set_list_loc(&mut self, list: NodeListId, loc: TextRange) {
        match self.lists.get_mut(list.0 as usize) {
            Some(l) if list.0 != 0 => l.loc = loc,
            _ => self.nil_write("NodeList.Loc", list.0),
        }
    }
    fn nil_write(&self, message: &'static str, id: u32) {
        self.faults.record(Fault {
            kind: FaultKind::NilWrite,
            message,
            detail: 0,
            id,
        });
    }
    // The word in a slot of a node.
    pub fn slot(&self, node: NodeId, index: u8) -> u32 {
        let Some(n) = self.nodes.get(node.0 as usize) else {
            return 0;
        };
        if usize::from(index) >= n.def.info().slots.len() {
            return 0;
        }
        self.slots
            .get(n.data as usize + usize::from(index))
            .copied()
            .unwrap_or(0)
    }
    // Writes a slot after the node was made, as the reparser of upstream does through MutableNode.
    pub fn set_slot(&mut self, node: NodeId, def: Def, index: u8, value: u32) {
        let target = match self.nodes.get(node.0 as usize) {
            Some(n)
                if n.def == def && node.0 != 0 && usize::from(index) < def.info().slots.len() =>
            {
                n.data as usize + usize::from(index)
            }
            _ => {
                self.faults.record(Fault {
                    kind: FaultKind::BadCast,
                    message: def.info().name,
                    detail: u32::from(index),
                    id: node.0,
                });
                return;
            }
        };
        if let Some(slot) = self.slots.get_mut(target) {
            *slot = value;
        }
    }
    fn set_by_kind(
        &mut self,
        node: NodeId,
        slot: Option<(Def, u8)>,
        value: u32,
        message: &'static str,
    ) {
        match slot {
            Some((def, index)) => self.set_slot(node, def, index, value),
            None => self.faults.record(Fault {
                kind: FaultKind::Panic,
                message,
                detail: self.kind(node) as u32,
                id: node.0,
            }),
        }
    }
    // MutableNode.SetExpression
    pub fn set_expression(&mut self, node: NodeId, expression: NodeId) {
        self.set_by_kind(
            node,
            expression_slot(self.kind(node)),
            expression.0,
            "Unhandled case in mutableNode.SetExpression",
        );
    }
    // MutableNode.SetInitializer
    pub fn set_initializer(&mut self, node: NodeId, initializer: NodeId) {
        self.set_by_kind(
            node,
            initializer_slot(self.kind(node)),
            initializer.0,
            "Unhandled case in mutableNode.SetInitializer",
        );
    }
    // MutableNode.SetType: a kind of the switch, else a node that has FunctionLikeData.
    pub fn set_type_node(&mut self, node: NodeId, type_node: NodeId) {
        let def = self.def(node);
        let slot = type_node_slot(self.kind(node)).or_else(|| {
            let index = def
                .info()
                .slots
                .iter()
                .position(|slot| slot.name == "Type")?;
            def.info()
                .slots
                .iter()
                .any(|slot| slot.name == "FullSignature")
                .then_some((def, index as u8))
        });
        self.set_by_kind(
            node,
            slot,
            type_node.0,
            "Unhandled case in mutableNode.SetType",
        );
    }
    // MutableNode.SetModifiers
    pub fn set_modifiers(&mut self, node: NodeId, modifiers: ModifierListId) {
        let def = self.def(node);
        if let Some(index) = def
            .info()
            .slots
            .iter()
            .position(|slot| slot.name == "modifiers")
        {
            self.set_slot(node, def, index as u8, modifiers.0);
        }
    }
    // The JSDoc nodes of a host: SourceFile.jsdocCache of upstream, filled before the file is published.
    pub fn attach_jsdoc(&mut self, host: NodeId, jsdoc: &[NodeId]) {
        let list = self.new_node_list(jsdoc);
        self.jsdoc.push((host, list));
        let flags = self.flags(host) | NodeFlags::HAS_JSDOC;
        self.set_flags(host, flags);
    }
    // Node.Clone for the reparser: a node with the same members, flags and range.
    pub fn clone_node(&mut self, node: NodeId) -> NodeId {
        let Some(original) = self.nodes.get(node.0 as usize).copied() else {
            return NodeId::NIL;
        };
        let start = original.data as usize;
        let slots = self
            .slots
            .get(start..start + original.def.info().slots.len())
            .unwrap_or(&[])
            .to_vec();
        let clone = self.alloc_node(original.def, original.kind, original.flags, &slots);
        self.set_loc(clone, original.loc);
        clone
    }
    pub fn mark(&self) -> Mark {
        Mark {
            nodes: self.nodes.len(),
            slots: self.slots.len(),
            lists: self.lists.len(),
            list_items: self.list_items.len(),
            texts: self.texts.len(),
            text_bytes: self.text_bytes.len(),
            jsdoc: self.jsdoc.len(),
        }
    }
    // Drops every node, list and text made after `mark`. Slots written into older nodes since then stay.
    pub fn rewind(&mut self, mark: Mark) {
        self.nodes.truncate(mark.nodes.max(1));
        self.slots.truncate(mark.slots);
        self.lists.truncate(mark.lists.max(1));
        self.list_items.truncate(mark.list_items);
        self.texts.truncate(mark.texts.max(1));
        self.text_bytes
            .truncate(mark.text_bytes.max(self.source_len as usize));
        self.jsdoc.truncate(mark.jsdoc);
    }

    fn list_nodes(&self, list: u32) -> &[NodeId] {
        match self.lists.get(list as usize) {
            Some(record) => {
                let start = record.start as usize;
                self.list_items
                    .get(start..start + record.len as usize)
                    .unwrap_or(&[])
            }
            None => &[],
        }
    }
    fn layout_of(&self, node: &BuilderNode) -> &'static [ChildSlot] {
        let info = node.def.info();
        if info.children_alt.is_empty() {
            return info.children;
        }
        let name_first = info
            .slots
            .iter()
            .position(|slot| slot.name == "IsNameFirst")
            .is_some_and(|index| {
                self.slots
                    .get(node.data as usize + index)
                    .copied()
                    .unwrap_or(0)
                    != 0
            });
        if name_first {
            info.children_alt
        } else {
            info.children
        }
    }
    // The JSDoc nodes of a node, then its children in the order of ForEachChild.
    fn collect_children(&self, node: &BuilderNode, jsdoc: u32, out: &mut Vec<u32>) {
        out.extend(self.list_nodes(jsdoc).iter().map(|n| n.0));
        for child in self.layout_of(node) {
            let value = self
                .slots
                .get(node.data as usize + usize::from(child.slot))
                .copied()
                .unwrap_or(0);
            if value == 0 {
                continue;
            }
            match child.visit {
                VisitTag::Nodes
                | VisitTag::Modifiers
                | VisitTag::RawNodes
                | VisitTag::Parameters
                | VisitTag::TopLevelStatements => {
                    out.extend(self.list_nodes(value).iter().map(|n| n.0));
                }
                VisitTag::Node
                | VisitTag::Token
                | VisitTag::EmbeddedStatement
                | VisitTag::IterationBody
                | VisitTag::FunctionBody => {
                    out.push(value);
                }
            }
        }
    }

    // Ends the parse: the nodes reachable from `root` get their ids in the order of ForEachChild, and their parents.
    pub fn finish(
        self,
        root: NodeId,
        mut source_file: SourceFileData,
        ids: &IdAllocator,
    ) -> Option<File> {
        let count = self.nodes.len();
        let mut new_id = vec![0u32; count];
        let mut jsdoc_of = vec![0u32; count];
        for (host, list) in &self.jsdoc {
            if let Some(slot) = jsdoc_of.get_mut(host.0 as usize) {
                *slot = list.0;
            }
        }
        let mut order: Vec<u32> = Vec::with_capacity(count);
        let mut parents: Vec<u32> = Vec::with_capacity(count);
        let mut stack: Vec<(u32, u32)> = vec![(root.0, 0)];
        let mut children: Vec<u32> = Vec::new();
        while let Some((temp, parent)) = stack.pop() {
            let (Some(node), Some(slot)) =
                (self.nodes.get(temp as usize), new_id.get_mut(temp as usize))
            else {
                continue;
            };
            if temp == 0 {
                continue;
            }
            if *slot != 0 {
                self.faults.record(Fault {
                    kind: FaultKind::TwoParents,
                    message: node.def.info().name,
                    detail: parent,
                    id: temp,
                });
                continue;
            }
            order.push(temp);
            parents.push(parent);
            let id = order.len() as u32;
            *slot = id;
            children.clear();
            self.collect_children(
                node,
                jsdoc_of.get(temp as usize).copied().unwrap_or(0),
                &mut children,
            );
            stack.extend(children.iter().rev().map(|child| (*child, id)));
        }

        // One range for the nodes and the lists. A list is copied at most once, so the count of lists bounds theirs.
        let needed = (order.len() as u32)
            .max(self.lists.len() as u32)
            .checked_add(1)?;
        let span = round_up_to_page(needed)?;
        let base = ids.alloc(span)?;
        let final_id = |local: u32| if local == 0 { 0 } else { base + local };
        let mut file = File {
            base,
            span,
            ..File::default()
        };
        file.records.reserve_exact(order.len() + 1);
        file.flags.reserve_exact(order.len() + 1);
        file.slots.reserve_exact(self.slots.len());
        file.list_items.reserve_exact(self.list_items.len());
        file.records.push(NodeRecord::default());
        file.flags.push(AtomicU32::new(0));
        file.lists.push(ListRecord::default());
        let mut new_list = vec![0u32; self.lists.len()];
        let mut late_len = 0u32;
        for (index, temp) in order.iter().enumerate() {
            let Some(node) = self.nodes.get(*temp as usize) else {
                continue;
            };
            let info = node.def.info();
            let data = file.slots.len() as u32;
            for (k, slot) in info.slots.iter().enumerate() {
                let value = self.slots.get(node.data as usize + k).copied().unwrap_or(0);
                let moved = match slot.ty {
                    SlotType::Node => final_id(new_id.get(value as usize).copied().unwrap_or(0)),
                    SlotType::NodeList | SlotType::ModifierList | SlotType::RawNodeList => {
                        final_id(self.move_list(value, &new_id, base, &mut new_list, &mut file))
                    }
                    _ => value,
                };
                file.slots.push(moved);
            }
            let id = index as u32 + 1;
            file.records.push(NodeRecord {
                loc: node.loc,
                parent: NodeId(final_id(parents.get(index).copied().unwrap_or(0))),
                data,
                late: late_len,
                kind: node.kind,
                def: node.def,
            });
            file.flags.push(AtomicU32::new(node.flags.0));
            late_len += info.late.count_ones();
            let jsdoc = jsdoc_of.get(*temp as usize).copied().unwrap_or(0);
            if jsdoc != 0 {
                let list = self.move_list(jsdoc, &new_id, base, &mut new_list, &mut file);
                file.jsdoc
                    .push((NodeId(final_id(id)), NodeListId(final_id(list))));
            }
        }
        file.late = (0..late_len).map(|_| AtomicU32::new(0)).collect();
        file.texts = self.texts;
        file.text_bytes = self.text_bytes;
        source_file.root = NodeId(final_id(new_id.get(root.0 as usize).copied().unwrap_or(0)));
        source_file.text_len = self.source_len;
        source_file.node_count = order.len() as u32;
        source_file.text_count = self.text_count;
        file.source_file = source_file;
        file.lists.shrink_to_fit();
        file.list_items.shrink_to_fit();
        file.jsdoc.shrink_to_fit();
        file.texts.shrink_to_fit();
        file.text_bytes.shrink_to_fit();
        Some(file)
    }

    // Copies a list into the file at its first use and returns its index there.
    fn move_list(
        &self,
        list: u32,
        new_id: &[u32],
        base: u32,
        new_list: &mut [u32],
        file: &mut File,
    ) -> u32 {
        let (Some(record), Some(moved)) = (
            self.lists.get(list as usize),
            new_list.get_mut(list as usize),
        ) else {
            return 0;
        };
        if list == 0 || *moved != 0 {
            return *moved;
        }
        let start = file.list_items.len() as u32;
        for node in self.list_nodes(list) {
            let local = new_id.get(node.0 as usize).copied().unwrap_or(0);
            file.list_items
                .push(NodeId(if local == 0 { 0 } else { base + local }));
        }
        file.lists.push(ListRecord {
            loc: record.loc,
            start,
            len: record.len,
            modifier_flags: record.modifier_flags,
        });
        *moved = (file.lists.len() - 1) as u32;
        *moved
    }
}

impl NodeSink for FileBuilder {
    fn alloc_node(&mut self, def: Def, kind: Kind, flags: NodeFlags, slots: &[u32]) -> NodeId {
        let Ok(index) = u32::try_from(self.nodes.len()) else {
            return NodeId::NIL;
        };
        let data = self.slots.len() as u32;
        self.slots.extend_from_slice(slots);
        self.slots.resize(data as usize + def.info().slots.len(), 0);
        self.nodes.push(BuilderNode {
            loc: undefined_text_range(),
            flags,
            data,
            kind,
            def,
        });
        NodeId(index)
    }
    fn text_slot(&mut self, text: &[u8]) -> u32 {
        let start = self.text_bytes.len() as u32;
        self.text_bytes.extend_from_slice(text);
        self.texts.push(TextSpan {
            start,
            len: text.len() as u32,
        });
        (self.texts.len() - 1) as u32
    }
    fn count_text(&mut self) {
        self.text_count = self.text_count.saturating_add(1);
    }
    fn new_node_list(&mut self, nodes: &[NodeId]) -> NodeListId {
        let start = self.list_items.len() as u32;
        self.list_items.extend_from_slice(nodes);
        self.lists.push(ListRecord {
            loc: undefined_text_range(),
            start,
            len: nodes.len() as u32,
            modifier_flags: ModifierFlags::NONE,
        });
        NodeListId((self.lists.len() - 1) as u32)
    }
    fn new_modifier_list(&mut self, nodes: &[NodeId]) -> ModifierListId {
        let mut modifier_flags = ModifierFlags::NONE;
        for node in nodes {
            modifier_flags |= modifier_to_flag(self.kind(*node));
        }
        let list = self.new_node_list(nodes);
        if let Some(record) = self.lists.get_mut(list.0 as usize) {
            record.modifier_flags = modifier_flags;
        }
        ModifierListId(list.0)
    }
}
