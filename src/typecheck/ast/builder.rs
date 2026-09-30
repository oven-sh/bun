// The write side of a producer: nodes are made in any order, by constructor or by member name, and `finish` freezes the ones the root reaches.
use crate::ast::ast_generated::Def;
use crate::ast::factory::NodeSink;
use crate::ast::file::{
    File, IdAllocator, ListRecord, NodeRecord, SourceFileData, TextSpan, round_up_to_page,
};
use crate::ast::ids::{ModifierListId, NodeId, NodeListId};
use crate::ast::kind_generated::Kind;
use crate::ast::layout::SlotType;
use crate::ast::modifierflags::ModifierFlags;
use crate::ast::node_methods::{MutableMember, mutable_slot};
use crate::ast::nodeflags::NodeFlags;
use crate::ast::reader::Ast;
use crate::ast::tokenflags::TokenFlags;
use crate::ast::utilities::modifier_to_flag;
use crate::core::{TextRange, undefined_text_range};
use crate::internal::{Fault, FaultKind, Faults};

#[derive(Clone, Copy, Default)]
struct BuilderNode {
    loc: TextRange,
    // The parent that the producer set, nil for the node that holds the node.
    parent: NodeId,
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
    text_count: u32,
}

// The value of a member that a producer names as ast.json does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemberValue<'t> {
    Node(NodeId),
    // A NodeList, a ModifierList or a plain slice of nodes.
    List(NodeListId),
    Text(&'t [u8]),
    Bool(bool),
    Kind(Kind),
    TokenFlags(TokenFlags),
    Int(i32),
    // A member of type `any`, or the id of a flow node or flow list.
    Raw(u32),
}

// The ids that a builder hands out are indexes of the builder: `finish` gives the nodes and the lists their ids of the file.
pub struct FileBuilder {
    nodes: Vec<BuilderNode>,
    slots: Vec<u32>,
    lists: Vec<ListRecord>,
    list_items: Vec<NodeId>,
    texts: Vec<TextSpan>,
    // The source text, then the texts that are not in it.
    text_bytes: Vec<u8>,
    source_len: u32,
    // Where the source text lay when the builder was made: a text at an address in it is looked up before it is copied.
    source_addr: usize,
    jsdoc: Vec<(NodeId, NodeListId)>,
    text_count: u32,
    pub faults: Faults,
}

impl FileBuilder {
    // An empty builder for a source text. Index 0 of the nodes, of the lists and of the texts is nil.
    pub fn new(source_text: &[u8]) -> Self {
        // A text that the ids cannot span is left out: every node text is then copied.
        let kept = match u32::try_from(source_text.len()) {
            Ok(_) => source_text,
            Err(_) => &[],
        };
        Self {
            nodes: vec![BuilderNode::default()],
            slots: Vec::new(),
            lists: vec![ListRecord::default()],
            list_items: Vec::new(),
            texts: vec![TextSpan::default()],
            text_bytes: kept.to_vec(),
            source_len: kept.len() as u32,
            source_addr: kept.as_ptr().addr(),
            jsdoc: Vec::new(),
            text_count: 0,
            faults: Faults::default(),
        }
    }

    // NodeFactory.NodeCount
    pub fn node_count(&self) -> u32 {
        self.nodes.len().saturating_sub(1) as u32
    }

    // NodeFactory.TextCount
    pub fn text_count(&self) -> u32 {
        self.text_count
    }

    // SourceFile.Text() of the file under construction.
    pub fn source_text(&self) -> &[u8] {
        self.text_bytes
            .get(..self.source_len as usize)
            .unwrap_or(&[])
    }

    fn fault(&self, kind: FaultKind, message: &'static str, detail: u32, id: u32) {
        self.faults.record(Fault {
            kind,
            message,
            detail,
            id,
        });
    }

    fn node(&self, node: NodeId) -> Option<&BuilderNode> {
        if node.is_nil() {
            return None;
        }
        self.nodes.get(node.0 as usize)
    }

    // The word of a text slot for the text that the source has at `start`: nothing is copied. 0 when the source has no such span.
    pub fn source_text_slot(&mut self, start: u32, len: u32) -> u32 {
        if len == 0
            || start
                .checked_add(len)
                .is_none_or(|end| end > self.source_len)
        {
            return 0;
        }
        self.push_text(TextSpan { start, len })
    }

    fn push_text(&mut self, span: TextSpan) -> u32 {
        match u32::try_from(self.texts.len()) {
            Ok(handle) => {
                self.texts.push(span);
                handle
            }
            Err(_) => {
                self.fault(FaultKind::IdSpaceExhausted, "text", 0, 0);
                0
            }
        }
    }

    // Where `text` lies in the source when it is a slice of the text that the builder was made with and the source still has these bytes there.
    fn span_in_source(&self, text: &[u8]) -> Option<TextSpan> {
        let start = text.as_ptr().addr().checked_sub(self.source_addr)?;
        let end = start.checked_add(text.len())?;
        if end > self.source_len as usize || self.text_bytes.get(start..end) != Some(text) {
            return None;
        }
        Some(TextSpan {
            start: start as u32,
            len: text.len() as u32,
        })
    }

    // NodeFactory.NewSourceFile without the file data, which `finish` takes.
    pub fn new_source_file(&mut self, statements: NodeListId, end_of_file_token: NodeId) -> NodeId {
        let slots = [statements.0, end_of_file_token.0];
        self.alloc_node(Def::SourceFile, Kind::SourceFile, NodeFlags::NONE, &slots)
    }

    // A node of `def` with every member zero, for a producer that sets members by name. Nil when `kind` is no kind of `def`.
    pub fn new_node_by_def(&mut self, def: Def, kind: Kind) -> NodeId {
        let (main, second) = Def::of_kind(kind);
        if def == Def::None || (def != main && def != second) {
            self.fault(FaultKind::BadCast, def.info().name, kind as u32, 0);
            return NodeId::NIL;
        }
        if def.info().has_text_content() {
            self.count_text();
        }
        self.alloc_node(def, kind, NodeFlags::NONE, &[])
    }

    // Node.Kind
    pub fn kind(&self, node: NodeId) -> Kind {
        self.node(node).map_or(Kind::Unknown, |n| n.kind)
    }

    // The definition of ast.json that the node was made with.
    pub fn def(&self, node: NodeId) -> Def {
        self.node(node).map_or(Def::None, |n| n.def)
    }

    // Node.Flags
    pub fn flags(&self, node: NodeId) -> NodeFlags {
        self.node(node).map_or(NodeFlags::NONE, |n| n.flags)
    }

    // Node.Loc
    pub fn loc(&self, node: NodeId) -> TextRange {
        self.node(node).map_or_else(undefined_text_range, |n| n.loc)
    }

    // Node.Parent as the producer set it.
    pub fn parent(&self, node: NodeId) -> NodeId {
        self.node(node).map_or(NodeId::NIL, |n| n.parent)
    }

    fn node_mut(&mut self, node: NodeId, who: &'static str) -> Option<&mut BuilderNode> {
        let found = !node.is_nil() && (node.0 as usize) < self.nodes.len();
        if !found {
            self.fault(FaultKind::NilWrite, who, 0, node.0);
            return None;
        }
        self.nodes.get_mut(node.0 as usize)
    }

    // `node.Flags = flags`
    pub fn set_flags(&mut self, node: NodeId, flags: NodeFlags) {
        if let Some(n) = self.node_mut(node, "Node.Flags") {
            n.flags = flags;
        }
    }

    // `node.Loc = loc`: `pos` is the full start of the node, leading trivia included.
    pub fn set_loc(&mut self, node: NodeId, loc: TextRange) {
        if let Some(n) = self.node_mut(node, "Node.Loc") {
            n.loc = loc;
        }
    }

    // `node.Parent = parent`: a parent that is not the node that holds the node, as the reparser sets one.
    pub fn set_parent(&mut self, node: NodeId, parent: NodeId) {
        if let Some(n) = self.node_mut(node, "Node.Parent") {
            n.parent = parent;
        }
    }

    // `list.Loc = loc`
    pub fn set_list_loc(&mut self, list: NodeListId, loc: TextRange) {
        match self.lists.get_mut(list.0 as usize) {
            Some(l) if !list.is_nil() => l.loc = loc,
            _ => self.fault(FaultKind::NilWrite, "NodeList.Loc", 0, list.0),
        }
    }

    // NodeList.Nodes
    pub fn list_nodes(&self, list: NodeListId) -> &[NodeId] {
        match self.lists.get(list.0 as usize) {
            Some(record) => {
                let start = record.start as usize;
                self.list_items
                    .get(start..start + record.len as usize)
                    .unwrap_or(&[])
            }
            None => &[],
        }
    }

    // The word in a slot of a node.
    pub fn slot(&self, node: NodeId, index: u8) -> u32 {
        let Some(n) = self.node(node) else {
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
        let target = match self.node(node) {
            Some(n) if n.def == def && usize::from(index) < def.info().slots.len() => {
                n.data as usize + usize::from(index)
            }
            _ => {
                self.fault(
                    FaultKind::BadCast,
                    def.info().name,
                    u32::from(index),
                    node.0,
                );
                return;
            }
        };
        if let Some(slot) = self.slots.get_mut(target) {
            *slot = value;
        }
    }

    fn set_mutable(
        &mut self,
        node: NodeId,
        member: MutableMember,
        value: u32,
        message: &'static str,
    ) {
        let def = self.def(node);
        match mutable_slot(def, self.kind(node), member) {
            Some(slot) => self.set_slot(node, def, slot, value),
            None => self.fault(FaultKind::Panic, message, self.kind(node) as u32, node.0),
        }
    }

    // MutableNode.SetExpression
    pub fn set_expression(&mut self, node: NodeId, expression: NodeId) {
        let message = "Unhandled case in mutableNode.SetExpression";
        self.set_mutable(node, MutableMember::Expression, expression.0, message);
    }

    // MutableNode.SetInitializer
    pub fn set_initializer(&mut self, node: NodeId, initializer: NodeId) {
        let message = "Unhandled case in mutableNode.SetInitializer";
        self.set_mutable(node, MutableMember::Initializer, initializer.0, message);
    }

    // MutableNode.SetType
    pub fn set_type_node(&mut self, node: NodeId, type_node: NodeId) {
        let message = "Unhandled case in mutableNode.SetType";
        self.set_mutable(node, MutableMember::Type, type_node.0, message);
    }

    // MutableNode.SetModifiers: a node without modifiers ignores the call, as NodeDefault does.
    pub fn set_modifiers(&mut self, node: NodeId, modifiers: ModifierListId) {
        let def = self.def(node);
        if let Some(slot) = mutable_slot(def, self.kind(node), MutableMember::Modifiers) {
            self.set_slot(node, def, slot, modifiers.0);
        }
    }

    // Sets the member with this name in ast.json. False when the definition has no such member or the value has another type.
    pub fn set_member(&mut self, node: NodeId, member: &[u8], value: MemberValue<'_>) -> bool {
        let def = self.def(node);
        let info = def.info();
        let slot = info
            .slot_index(member)
            .and_then(|index| info.slots.get(index).map(|slot| (index, slot)));
        let Some((index, slot)) = slot else {
            self.fault(
                FaultKind::BadCast,
                info.name,
                self.kind(node) as u32,
                node.0,
            );
            return false;
        };
        let word = match (slot.ty, value) {
            (SlotType::Node, MemberValue::Node(child)) => child.0,
            (
                SlotType::NodeList | SlotType::ModifierList | SlotType::RawNodeList,
                MemberValue::List(list),
            ) => list.0,
            (SlotType::Text, MemberValue::Text(text)) => self.text_slot(text),
            (SlotType::Bool, MemberValue::Bool(value)) => u32::from(value),
            (SlotType::Kind, MemberValue::Kind(kind)) => kind as u32,
            (SlotType::TokenFlags, MemberValue::TokenFlags(flags)) => {
                flags.bits() as u32 & slot.mask
            }
            (SlotType::Int, MemberValue::Int(value)) => value as u32,
            (SlotType::Any | SlotType::FlowNode | SlotType::FlowList, MemberValue::Raw(value)) => {
                value
            }
            _ => {
                self.fault(
                    FaultKind::BadCast,
                    slot.name,
                    self.kind(node) as u32,
                    node.0,
                );
                return false;
            }
        };
        self.set_slot(node, def, index as u8, word);
        true
    }

    // `file.jsdocCache[host] = jsdoc` with the flag HasJSDoc on the host, as upstream's parser does.
    pub fn attach_jsdoc(&mut self, host: NodeId, jsdoc: &[NodeId]) {
        if self.node(host).is_none() {
            self.fault(FaultKind::NilWrite, "jsdocCache", 0, host.0);
            return;
        }
        let list = self.new_node_list(jsdoc);
        self.jsdoc.push((host, list));
        let flags = self.flags(host) | NodeFlags::HAS_JSDOC;
        self.set_flags(host, flags);
    }

    // Node.Clone for the reparser: a node with the same members, flags and range.
    pub fn clone_node(&mut self, node: NodeId) -> NodeId {
        let Some(original) = self.node(node).copied() else {
            return NodeId::NIL;
        };
        let start = original.data as usize;
        let slots = self
            .slots
            .get(start..start + original.def.info().slots.len())
            .unwrap_or(&[])
            .to_vec();
        if original.def.info().has_text_content() {
            self.count_text();
        }
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
            text_count: self.text_count,
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
        self.text_count = self.text_count.min(mark.text_count);
    }

    // The nodes that a node holds: its JSDoc nodes, then its children in the order of ForEachChild.
    fn collect_children(&self, node: &BuilderNode, jsdoc: u32, out: &mut Vec<u32>) {
        out.extend(self.list_nodes(NodeListId(jsdoc)).iter().map(|item| item.0));
        let info = node.def.info();
        let slot = |index: usize| {
            self.slots
                .get(node.data as usize + index)
                .copied()
                .unwrap_or(0)
        };
        // forEachChild_JSDocParameterOrPropertyTag: the name comes before the type when IsNameFirst is set.
        let name_first = !info.children_alt.is_empty()
            && info
                .slot_index(b"IsNameFirst")
                .is_some_and(|index| slot(index) != 0);
        let layout = if name_first {
            info.children_alt
        } else {
            info.children
        };
        for child in layout {
            let index = usize::from(*child);
            match info.slots.get(index) {
                Some(member) if member.ty.is_list() => {
                    let items = self.list_nodes(NodeListId(slot(index)));
                    out.extend(items.iter().map(|item| item.0));
                }
                Some(_) => out.push(slot(index)),
                None => {}
            }
        }
    }

    // Ends the construction of a file: the nodes that `root` reaches get their ids in the order of ForEachChild, the JSDoc of a host before its children, and are frozen with the source text. None when the root is no node of the builder or the id space is used up.
    pub fn finish(
        self,
        root: NodeId,
        mut source_file: SourceFileData,
        ids: &IdAllocator,
    ) -> Option<File> {
        self.node(root)?;
        let count = self.nodes.len();
        // The JSDoc list of a node of the builder, 0 for a node without one.
        let mut jsdoc_of = vec![0u32; count];
        for (host, list) in &self.jsdoc {
            if let Some(slot) = jsdoc_of.get_mut(host.0 as usize) {
                *slot = list.0;
            }
        }
        // The index of a node of the builder in the file, 0 for a node that the root does not reach.
        let mut new_id = vec![0u32; count];
        let mut order: Vec<u32> = Vec::with_capacity(count);
        let mut parents: Vec<u32> = Vec::with_capacity(count);
        let mut stack: Vec<(u32, u32)> = vec![(root.0, 0)];
        let mut children: Vec<u32> = Vec::new();
        while let Some((index, parent)) = stack.pop() {
            let (Some(node), Some(slot)) = (
                self.nodes.get(index as usize).filter(|_| index != 0),
                new_id.get_mut(index as usize),
            ) else {
                continue;
            };
            if *slot != 0 {
                // A node that two nodes hold keeps the id of its first visit.
                self.fault(FaultKind::TwoParents, node.def.info().name, parent, index);
                continue;
            }
            order.push(index);
            parents.push(parent);
            let id = order.len() as u32;
            *slot = id;
            children.clear();
            let jsdoc = jsdoc_of.get(index as usize).copied().unwrap_or(0);
            self.collect_children(node, jsdoc, &mut children);
            stack.extend(children.iter().rev().map(|child| (*child, id)));
        }

        // One range for the nodes and the lists. A list is copied at most once, so the lists of the builder bound theirs.
        let needed = u32::try_from(order.len().max(self.lists.len()) + 1).ok()?;
        let span = round_up_to_page(needed)?;
        let base = ids.alloc(span)?;
        let final_id = |local: u32| if local == 0 { 0 } else { base + local };
        let map_node = |index: u32| final_id(new_id.get(index as usize).copied().unwrap_or(0));

        let mut file = File {
            base,
            span,
            ..File::default()
        };
        file.records.reserve_exact(order.len() + 1);
        file.flags.reserve_exact(order.len() + 1);
        file.records.push(NodeRecord::default());
        file.flags.push(NodeFlags::NONE);
        file.lists.push(ListRecord::default());
        file.texts.push(TextSpan::default());
        // The list of the file for a list of the builder, 0 until it is copied.
        let mut new_list = vec![0u32; self.lists.len()];
        let mut move_list = |file: &mut File, index: u32| -> u32 {
            let (Some(list), Some(moved)) = (
                self.lists.get(index as usize),
                new_list.get_mut(index as usize),
            ) else {
                return 0;
            };
            if *moved == 0 && index != 0 {
                let start = file.list_items.len() as u32;
                let items = self.list_nodes(NodeListId(index));
                file.list_items
                    .extend(items.iter().map(|node| NodeId(map_node(node.0))));
                file.lists.push(ListRecord {
                    loc: list.loc,
                    start,
                    len: list.len,
                    modifier_flags: list.modifier_flags,
                });
                *moved = (file.lists.len() - 1) as u32;
            }
            final_id(*moved)
        };
        // The text of the file for a text of the builder, 0 until it is moved.
        let mut new_text = vec![0u32; self.texts.len()];
        let mut move_text = |file: &mut File, handle: u32| -> u32 {
            let (Some(span), Some(moved)) = (
                self.texts.get(handle as usize),
                new_text.get_mut(handle as usize),
            ) else {
                return 0;
            };
            if *moved == 0 && span.len != 0 {
                file.texts.push(*span);
                *moved = (file.texts.len() - 1) as u32;
            }
            *moved
        };

        let mut late_len = 0u32;
        for (position, index) in order.iter().enumerate() {
            let Some(node) = self.nodes.get(*index as usize) else {
                continue;
            };
            let info = node.def.info();
            let data = file.slots.len() as u32;
            for (at, slot) in info.slots.iter().enumerate() {
                let value = self
                    .slots
                    .get(node.data as usize + at)
                    .copied()
                    .unwrap_or(0);
                let moved = match slot.ty {
                    SlotType::Node => map_node(value),
                    SlotType::NodeList | SlotType::ModifierList | SlotType::RawNodeList => {
                        move_list(&mut file, value)
                    }
                    SlotType::Text => move_text(&mut file, value),
                    // A producer makes no flow node: the flow nodes of the binder are no part of a file.
                    SlotType::FlowNode | SlotType::FlowList => 0,
                    SlotType::Bool
                    | SlotType::Kind
                    | SlotType::TokenFlags
                    | SlotType::Int
                    | SlotType::Any => value,
                };
                file.slots.push(moved);
            }
            // The parent that a producer set wins when it is in the tree. Otherwise the parent is the node that holds the node.
            let explicit = map_node(node.parent.0);
            let parent = if explicit != 0 {
                explicit
            } else {
                final_id(parents.get(position).copied().unwrap_or(0))
            };
            file.records.push(NodeRecord {
                loc: node.loc,
                parent: NodeId(parent),
                data,
                late: late_len,
                kind: node.kind,
                def: node.def,
            });
            file.flags.push(node.flags);
            late_len = late_len.saturating_add(info.late_count() as u32);
            let jsdoc = jsdoc_of.get(*index as usize).copied().unwrap_or(0);
            if jsdoc != 0 {
                let list = move_list(&mut file, jsdoc);
                let host = NodeId(final_id(position as u32 + 1));
                file.jsdoc.push((host, NodeListId(list)));
            }
        }
        file.late_len = late_len;

        let map_id = |node: NodeId| NodeId(map_node(node.0));
        for node in source_file
            .imports
            .iter_mut()
            .chain(source_file.module_augmentations.iter_mut())
            .chain(source_file.reparsed_clones.iter_mut())
        {
            *node = map_id(*node);
        }
        source_file.common_js_module_indicator = map_id(source_file.common_js_module_indicator);
        source_file.external_module_indicator = map_id(source_file.external_module_indicator);
        source_file.root = map_id(root);
        source_file.text_len = self.source_len;
        source_file.node_count = self.node_count();
        source_file.text_count = self.text_count;
        file.source_file = source_file;
        file.faults = self.faults.snapshot();
        file.fault_count = self.faults.count();
        file.text_bytes = self.text_bytes;

        file.slots.shrink_to_fit();
        file.lists.shrink_to_fit();
        file.list_items.shrink_to_fit();
        file.texts.shrink_to_fit();
        file.text_bytes.shrink_to_fit();
        file.jsdoc.shrink_to_fit();
        Some(file)
    }
}

impl NodeSink for FileBuilder {
    fn alloc_node(&mut self, def: Def, kind: Kind, flags: NodeFlags, slots: &[u32]) -> NodeId {
        let total = def.info().slots.len();
        let (Ok(index), Ok(data)) = (
            u32::try_from(self.nodes.len()),
            u32::try_from(self.slots.len()),
        ) else {
            self.fault(FaultKind::IdSpaceExhausted, "newNode", kind as u32, 0);
            return NodeId::NIL;
        };
        self.slots
            .extend((0..total).map(|at| slots.get(at).copied().unwrap_or(0)));
        self.nodes.push(BuilderNode {
            loc: undefined_text_range(),
            parent: NodeId::NIL,
            flags,
            data,
            kind,
            def,
        });
        NodeId(index)
    }

    fn text_slot(&mut self, text: &[u8]) -> u32 {
        if text.is_empty() {
            return 0;
        }
        if let Some(span) = self.span_in_source(text) {
            return self.push_text(span);
        }
        let (Ok(start), Ok(len)) = (
            u32::try_from(self.text_bytes.len()),
            u32::try_from(text.len()),
        ) else {
            self.fault(FaultKind::IdSpaceExhausted, "text", 0, 0);
            return 0;
        };
        self.text_bytes.extend_from_slice(text);
        self.push_text(TextSpan { start, len })
    }

    fn count_text(&mut self) {
        self.text_count = self.text_count.saturating_add(1);
    }

    fn new_node_list(&mut self, nodes: &[NodeId]) -> NodeListId {
        let (Ok(index), Ok(start), Ok(len)) = (
            u32::try_from(self.lists.len()),
            u32::try_from(self.list_items.len()),
            u32::try_from(nodes.len()),
        ) else {
            self.fault(FaultKind::IdSpaceExhausted, "NodeList", 0, 0);
            return NodeListId::NIL;
        };
        self.list_items.extend_from_slice(nodes);
        self.lists.push(ListRecord {
            loc: undefined_text_range(),
            start,
            len,
            modifier_flags: ModifierFlags::NONE,
        });
        NodeListId(index)
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

impl<'a> Ast<'a> {
    // The member with this name in ast.json of any node: None when the definition has no such member.
    pub fn member(self, node: NodeId, member: &[u8]) -> Option<MemberValue<'a>> {
        let (def, data) = self.data_any(node)?;
        let info = def.info();
        let index = info.slot_index(member)?;
        Some(match info.slots.get(index)?.ty {
            SlotType::Node => MemberValue::Node(data.node(index)),
            SlotType::NodeList | SlotType::ModifierList | SlotType::RawNodeList => {
                MemberValue::List(data.list(index))
            }
            SlotType::Text => MemberValue::Text(data.text(index)),
            SlotType::Bool => MemberValue::Bool(data.bool(index)),
            SlotType::Kind => MemberValue::Kind(data.kind(index)),
            SlotType::TokenFlags => MemberValue::TokenFlags(data.token_flags(index)),
            SlotType::Int => MemberValue::Int(data.int(index)),
            SlotType::Any | SlotType::FlowNode | SlotType::FlowList => {
                MemberValue::Raw(data.word(index))
            }
        })
    }
}
