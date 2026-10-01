// The node table of one file: flat vectors, ids are `first + index` in every id space.
// Before `freeze` the table is local (`first` is 1) and the binder writes its fields through a shared reference.
// After `freeze` nothing writes: the type has no setter that a frozen table accepts.
use crate::ast::ast_generated::{Def, SlotType, layout};
use crate::ast::flags_generated::{ModifierFlags, NodeFlags};
use crate::ast::kind_generated::Kind;
use crate::ast::symbol::BoundData;
use crate::core::TextRange;
use crate::ids::{NodeId, NodeListId};
use std::sync::atomic::{AtomicU32, Ordering};

pub struct NodeRec {
    pub(crate) kind: Kind,
    pub(crate) def: Def,
    pub(crate) flags: AtomicU32,
    pub(crate) pos: i32,
    pub(crate) end: i32,
    pub(crate) parent: u32,
    pub(crate) data: u32,
}

const _: () = assert!(std::mem::size_of::<NodeRec>() == 24);

#[derive(Clone, Copy, Default)]
pub struct ListRec {
    pub(crate) pos: i32,
    pub(crate) end: i32,
    pub(crate) start: u32,
    pub(crate) len: u32,
    pub(crate) modifier_flags: u32,
}

// What upstream keeps on SourceFile beside the tree. The producers fill it.
#[derive(Default)]
pub struct FileData {
    pub file_name: Vec<u8>,
    pub script_kind: u8,
    pub language_variant: u8,
    pub is_declaration_file: bool,
    pub external_module_indicator: NodeId,
    pub common_js_module_indicator: NodeId,
    pub identifier_count: u32,
    pub node_count: u32,
    pub text_count: u32,
}

#[derive(Default)]
pub struct NodeTable {
    pub(crate) first: u32,
    pub(crate) frozen: bool,
    pub(crate) recs: Vec<NodeRec>,
    pub(crate) slots: Vec<AtomicU32>,
    pub(crate) lists: Vec<ListRec>,
    pub(crate) list_items: Vec<NodeId>,
    pub(crate) text_spans: Vec<(u32, u32)>,
    pub(crate) bytes: Vec<u8>,
    // Hosts in ascending order with the list of their JSDoc nodes.
    pub(crate) jsdoc: Vec<(NodeId, NodeListId)>,
    pub(crate) source_text: Vec<u8>,
    pub root: NodeId,
    pub file: FileData,
    pub bound: BoundData,
}

// The table of a file is shared between the programs and the checkers of one process.
const _: () = {
    const fn assert_sync<T: Sync + Send>() {}
    assert_sync::<NodeTable>();
};

impl NodeTable {
    pub(crate) fn with_first(first: u32) -> Self {
        Self {
            first,
            text_spans: vec![(0, 0)],
            ..Self::default()
        }
    }
    pub fn first(&self) -> u32 {
        self.first
    }
    pub fn is_frozen(&self) -> bool {
        self.frozen
    }
    pub fn node_count(&self) -> u32 {
        self.recs.len() as u32
    }
    pub fn list_count(&self) -> u32 {
        self.lists.len() as u32
    }
    pub fn source_text(&self) -> &[u8] {
        &self.source_text
    }
    // The number of ids the file needs in the one block it owns.
    pub fn id_count(&self) -> u32 {
        self.node_count()
            .max(self.list_count())
            .max(self.bound.id_count())
    }
    pub fn heap_bytes(&self) -> usize {
        self.recs.capacity() * std::mem::size_of::<NodeRec>()
            + self.slots.capacity() * 4
            + self.lists.capacity() * std::mem::size_of::<ListRec>()
            + self.list_items.capacity() * 4
            + self.text_spans.capacity() * 8
            + self.bytes.capacity()
            + self.jsdoc.capacity() * 8
            + self.source_text.capacity()
            + self.bound.heap_bytes()
    }
    // Bytes of: node records, slots, list records, list items, node texts, the source text.
    pub fn heap_parts(&self) -> [usize; 6] {
        [
            self.recs.len() * std::mem::size_of::<NodeRec>(),
            self.slots.len() * 4,
            self.lists.len() * std::mem::size_of::<ListRec>(),
            self.list_items.len() * 4,
            self.text_spans.len() * 8 + self.bytes.len(),
            self.source_text.len(),
        ]
    }
    #[inline]
    pub(crate) fn payload(&self, rec: &NodeRec) -> &[AtomicU32] {
        let start = rec.data as usize;
        let n = layout(rec.def).slots.len();
        self.slots.get(start..start + n).unwrap_or(&[])
    }
    #[inline]
    pub(crate) fn list(&self, id: u32) -> Option<&ListRec> {
        self.lists.get(id.wrapping_sub(self.first) as usize)
    }
    #[inline]
    pub(crate) fn list_nodes(&self, list: &ListRec) -> &[NodeId] {
        let start = list.start as usize;
        self.list_items
            .get(start..start + list.len as usize)
            .unwrap_or(&[])
    }
    #[inline]
    pub(crate) fn text(&self, handle: u32) -> &[u8] {
        match self.text_spans.get(handle as usize) {
            Some(&(start, len)) => self
                .bytes
                .get(start as usize..(start + len) as usize)
                .unwrap_or(&[]),
            None => &[],
        }
    }
    pub(crate) fn jsdoc_of(&self, host: NodeId) -> NodeListId {
        match self.jsdoc.binary_search_by_key(&host, |entry| entry.0) {
            Ok(at) => self.jsdoc.get(at).map_or(NodeListId::NIL, |entry| entry.1),
            Err(_) => NodeListId::NIL,
        }
    }

    // Appends a node. Only the builder's `finish` and the binder's flow data call this, on a local table.
    pub(crate) fn push_node(
        &mut self,
        kind: Kind,
        def: Def,
        flags: NodeFlags,
        loc: TextRange,
        parent: NodeId,
        slots: &[u32],
    ) -> NodeId {
        let Some(id) = u32::try_from(self.recs.len())
            .ok()
            .and_then(|n| n.checked_add(self.first))
        else {
            return NodeId::NIL;
        };
        let data = self.slots.len() as u32;
        self.slots.extend(slots.iter().map(|v| AtomicU32::new(*v)));
        self.recs.push(NodeRec {
            kind,
            def,
            flags: AtomicU32::new(flags.bits()),
            pos: loc.pos(),
            end: loc.end(),
            parent: parent.0,
            data,
        });
        NodeId(id)
    }
    // The id the binder gives to the next flow data node it makes, when it has made `pending` of them already.
    pub fn next_flow_data_id(&self, pending: u32) -> NodeId {
        NodeId(self.first + self.node_count() + pending)
    }
    // ast.NewFlowSwitchClauseData, appended when the binder hands over. Only a local table takes it.
    pub fn push_flow_switch_clause_data(
        &mut self,
        switch_statement: NodeId,
        clause_start: i32,
        clause_end: i32,
    ) -> NodeId {
        if self.frozen {
            return NodeId::NIL;
        }
        self.push_node(
            Kind::Unknown,
            Def::FlowSwitchClauseData,
            NodeFlags::empty(),
            crate::core::undefined_text_range(),
            NodeId::NIL,
            &[switch_statement.0, clause_start as u32, clause_end as u32],
        )
    }
    // ast.NewFlowReduceLabelData.
    pub fn push_flow_reduce_label_data(
        &mut self,
        target: crate::ids::FlowNodeId,
        antecedents: crate::ids::FlowListId,
    ) -> NodeId {
        if self.frozen {
            return NodeId::NIL;
        }
        self.push_node(
            Kind::Unknown,
            Def::FlowReduceLabelData,
            NodeFlags::empty(),
            crate::core::undefined_text_range(),
            NodeId::NIL,
            &[target.0, antecedents.0],
        )
    }
    pub(crate) fn shrink(&mut self) {
        self.recs.shrink_to_fit();
        self.slots.shrink_to_fit();
        self.lists.shrink_to_fit();
        self.list_items.shrink_to_fit();
        self.text_spans.shrink_to_fit();
        self.bytes.shrink_to_fit();
        self.jsdoc.shrink_to_fit();
    }
    pub(crate) fn push_list(
        &mut self,
        loc: TextRange,
        nodes: &[NodeId],
        modifier_flags: ModifierFlags,
    ) -> NodeListId {
        let Some(id) = u32::try_from(self.lists.len())
            .ok()
            .and_then(|n| n.checked_add(self.first))
        else {
            return NodeListId::NIL;
        };
        let start = self.list_items.len() as u32;
        self.list_items.extend_from_slice(nodes);
        self.lists.push(ListRec {
            pos: loc.pos(),
            end: loc.end(),
            start,
            len: nodes.len() as u32,
            modifier_flags: modifier_flags.bits(),
        });
        NodeListId(id)
    }
    pub(crate) fn push_text(&mut self, text: &[u8]) -> u32 {
        if text.is_empty() {
            return 0;
        }
        let start = self.bytes.len() as u32;
        self.bytes.extend_from_slice(text);
        self.text_spans.push((start, text.len() as u32));
        (self.text_spans.len() - 1) as u32
    }

    // Moves every id of the table from the local space into the block that starts at `base`.
    pub(crate) fn rebase(&mut self, base: u32) {
        let delta = base.wrapping_sub(self.first);
        let shift = |v: u32| if v == 0 { 0 } else { v.wrapping_add(delta) };
        for rec in &mut self.recs {
            rec.parent = shift(rec.parent);
            let types = layout(rec.def).slots;
            let start = rec.data as usize;
            if let Some(payload) = self.slots.get_mut(start..start + types.len()) {
                for (slot, field) in payload.iter_mut().zip(types) {
                    if field.ty.is_id() {
                        let value = slot.get_mut();
                        *value = shift(*value);
                    }
                }
            }
        }
        for item in &mut self.list_items {
            item.0 = shift(item.0);
        }
        for entry in &mut self.jsdoc {
            entry.0.0 = shift(entry.0.0);
            entry.1.0 = shift(entry.1.0);
        }
        self.root.0 = shift(self.root.0);
        self.file.external_module_indicator.0 = shift(self.file.external_module_indicator.0);
        self.file.common_js_module_indicator.0 = shift(self.file.common_js_module_indicator.0);
        self.bound.rebase(delta);
        self.first = base;
        self.frozen = true;
    }
}

impl NodeRec {
    #[inline]
    pub(crate) fn flags(&self) -> NodeFlags {
        NodeFlags::from_bits_retain(self.flags.load(Ordering::Relaxed))
    }
}

impl SlotType {
    // True for a slot that holds an id of the file's block.
    pub const fn is_id(self) -> bool {
        matches!(
            self,
            SlotType::Node
                | SlotType::NodeList
                | SlotType::ModifierList
                | SlotType::RawNodeList
                | SlotType::Symbol
                | SlotType::SymbolTable
                | SlotType::FlowNode
                | SlotType::FlowList
        )
    }
}
