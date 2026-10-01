// The context that resolves an id: the published files of a program, or the one file a binder binds, plus an open store.
use crate::ast::ast_generated::Def;
use crate::ast::file::{Bound, File, FlowList, FlowNode, NodeRecord};
use crate::ast::flags_generated::{
    CheckFlags, FlowFlags, ModifierFlags, NodeFlags, SymbolFlags, TokenFlags,
};
use crate::ast::kind_generated::Kind;
use crate::ast::layout::{
    ChildSlot, LATE_END_FLOW_NODE, LATE_FALLTHROUGH_FLOW_NODE, LATE_FLOW_NODE, LATE_LOCAL_SYMBOL,
    LATE_LOCALS, LATE_NEXT_CONTAINER, LATE_RETURN_FLOW_NODE, LATE_SYMBOL, SlotType, VisitTag,
    late_rank,
};
use crate::ast::open::{Open, OpenList, OpenNode, Symbol, push, read, write};
use crate::tscore::golang::{List, OrderedMap, Text};
use crate::tscore::ids::{
    FlowListId, FlowNodeId, ModifierListId, NodeId, NodeListId, OPEN_BIT, PAGE_BITS, SymbolId,
    SymbolTableId, TypeId,
};
use crate::tscore::internal::{Fault, FaultKind};
use crate::tscore::text::TextRange;
use std::sync::atomic::{AtomicU32, Ordering};

#[derive(Clone, Copy, Default)]
struct PageEntry {
    // The index of the file plus one; 0 for a page that no file owns.
    file: u32,
    base: u32,
    // The page is of the range that the binder of the file got, not of the range of its nodes and lists.
    bound: bool,
}

// The files that a context reads, found by the page of an id.
pub struct Frozen<'a> {
    pages: Vec<PageEntry>,
    files: Vec<&'a File>,
    // True while the one file of the context is being bound: its flags and late fields accept writes.
    binding: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum FrozenError {
    // Two files own the same page: they got their ids from two allocators.
    Overlap { first: usize, second: usize },
}

impl<'a> Frozen<'a> {
    fn claim(
        pages: &mut Vec<PageEntry>,
        index: usize,
        base: u32,
        span: u32,
        bound: bool,
    ) -> Result<(), FrozenError> {
        let first = (base >> PAGE_BITS) as usize;
        let end = ((base + span) >> PAGE_BITS) as usize;
        if pages.len() < end {
            pages.resize(end, PageEntry::default());
        }
        for page in pages.get_mut(first..end).unwrap_or(&mut []) {
            if page.file != 0 {
                return Err(FrozenError::Overlap {
                    first: page.file as usize - 1,
                    second: index,
                });
            }
            *page = PageEntry {
                file: index as u32 + 1,
                base,
                bound,
            };
        }
        Ok(())
    }
    // The page table of a set of files, each with what its binder added when it is bound.
    pub fn of_files(files: &[&'a File]) -> Result<Self, FrozenError> {
        let mut pages: Vec<PageEntry> = Vec::new();
        for (index, file) in files.iter().enumerate() {
            Self::claim(&mut pages, index, file.base(), file.span(), false)?;
            if let Some(bound) = file.bound() {
                Self::claim(&mut pages, index, bound.base(), bound.span(), true)?;
            }
        }
        Ok(Self {
            pages,
            files: files.to_vec(),
            binding: false,
        })
    }
    // The context of the binder of `file`.
    pub fn of_binding(file: &'a File) -> Self {
        let mut pages: Vec<PageEntry> = Vec::new();
        let _ = Self::claim(&mut pages, 0, file.base(), file.span(), false);
        Self {
            pages,
            files: vec![file],
            binding: true,
        }
    }
    pub fn none() -> Self {
        Self {
            pages: Vec::new(),
            files: Vec::new(),
            binding: false,
        }
    }
    pub fn files(&self) -> &[&'a File] {
        &self.files
    }
    pub fn page_count(&self) -> usize {
        self.pages.len()
    }
    // A node or a list that a producer made.
    #[inline]
    fn locate(&self, id: u32) -> Option<(&'a File, usize)> {
        let page = self.pages.get((id >> PAGE_BITS) as usize)?;
        if page.bound {
            return None;
        }
        let file = self.files.get((page.file as usize).checked_sub(1)?)?;
        Some((*file, (id - page.base) as usize))
    }
    // An object that a binder made.
    #[inline]
    fn locate_bound(&self, id: u32) -> Option<(&'a File, &'a Bound, usize)> {
        let page = self.pages.get((id >> PAGE_BITS) as usize)?;
        if !page.bound {
            return None;
        }
        let file = self.files.get((page.file as usize).checked_sub(1)?)?;
        Some((*file, file.bound()?, (id - page.base) as usize))
    }
}

#[derive(Clone, Copy)]
pub struct Ast<'a> {
    frozen: &'a Frozen<'a>,
    open: &'a Open<'a>,
}

#[derive(Clone, Copy)]
enum Texts<'a> {
    File(&'a File),
    Bound(&'a Bound),
    Open(&'a Open<'a>),
}

#[derive(Clone, Copy)]
enum Late<'a> {
    File { cells: &'a [AtomicU32], mask: u8 },
    Open { values: [u32; 8] },
}

// The payload of one node, located once.
pub struct NodeData<'a> {
    slots: &'a [u32],
    texts: Texts<'a>,
    late: Late<'a>,
}

impl<'a> NodeData<'a> {
    #[inline]
    fn raw(&self, index: usize) -> u32 {
        self.slots.get(index).copied().unwrap_or(0)
    }
    #[inline]
    pub fn node(&self, index: usize) -> NodeId {
        NodeId(self.raw(index))
    }
    #[inline]
    pub fn list(&self, index: usize) -> NodeListId {
        NodeListId(self.raw(index))
    }
    #[inline]
    pub fn modifiers(&self, index: usize) -> ModifierListId {
        ModifierListId(self.raw(index))
    }
    #[inline]
    pub fn bool(&self, index: usize) -> bool {
        self.raw(index) != 0
    }
    #[inline]
    pub fn kind(&self, index: usize) -> Kind {
        Kind::from_u32(self.raw(index))
    }
    #[inline]
    pub fn token_flags(&self, index: usize) -> TokenFlags {
        TokenFlags(self.raw(index) as i32)
    }
    #[inline]
    pub fn int(&self, index: usize) -> i32 {
        self.raw(index) as i32
    }
    #[inline]
    pub fn type_id(&self, index: usize) -> TypeId {
        TypeId(self.raw(index))
    }
    #[inline]
    pub fn flow_node(&self, index: usize) -> FlowNodeId {
        FlowNodeId(self.raw(index))
    }
    #[inline]
    pub fn flow_list(&self, index: usize) -> FlowListId {
        FlowListId(self.raw(index))
    }
    #[inline]
    pub fn text(&self, index: usize) -> Text<'a> {
        match self.texts {
            Texts::File(file) => file.text(self.raw(index)),
            Texts::Bound(bound) => bound.text(self.raw(index)),
            Texts::Open(open) => read(&open.texts, self.raw(index) as usize, |text| *text),
        }
    }
    #[inline]
    fn late(&self, bit: u8) -> u32 {
        match self.late {
            Late::File { cells, mask } => {
                if mask & bit == 0 {
                    return 0;
                }
                cells
                    .get(late_rank(mask, bit))
                    .map_or(0, |cell| cell.load(Ordering::Relaxed))
            }
            Late::Open { values } => values
                .get(bit.trailing_zeros() as usize)
                .copied()
                .unwrap_or(0),
        }
    }
    #[inline]
    pub fn late_symbol(&self, bit: u8) -> SymbolId {
        SymbolId(self.late(bit))
    }
    #[inline]
    pub fn late_table(&self, bit: u8) -> SymbolTableId {
        SymbolTableId(self.late(bit))
    }
    #[inline]
    pub fn late_node(&self, bit: u8) -> NodeId {
        NodeId(self.late(bit))
    }
    #[inline]
    pub fn late_flow(&self, bit: u8) -> FlowNodeId {
        FlowNodeId(self.late(bit))
    }
}

// The children of a node in the order of ForEachChild. Holds no borrow of the context.
pub struct Children<'a> {
    ast: Ast<'a>,
    slots: &'a [u32],
    layout: &'static [ChildSlot],
    next_slot: usize,
    list: &'a [NodeId],
    next_item: usize,
}

impl Iterator for Children<'_> {
    type Item = NodeId;
    fn next(&mut self) -> Option<NodeId> {
        loop {
            if let Some(&node) = self.list.get(self.next_item) {
                self.next_item += 1;
                return Some(node);
            }
            let child = self.layout.get(self.next_slot)?;
            self.next_slot += 1;
            let value = self
                .slots
                .get(usize::from(child.slot))
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
                    self.list = self.ast.nodes(NodeListId(value)).as_slice();
                    self.next_item = 0;
                }
                VisitTag::Node
                | VisitTag::Token
                | VisitTag::EmbeddedStatement
                | VisitTag::IterationBody
                | VisitTag::FunctionBody => {
                    return Some(NodeId(value));
                }
            }
        }
    }
}

impl<'a> Ast<'a> {
    pub fn new(frozen: &'a Frozen<'a>, open: &'a Open<'a>) -> Self {
        Self { frozen, open }
    }
    pub fn open(self) -> &'a Open<'a> {
        self.open
    }
    pub fn frozen(self) -> &'a Frozen<'a> {
        self.frozen
    }
    pub fn fault(self, kind: FaultKind, message: &'static str, detail: u32, id: u32) {
        self.open.faults.record(Fault {
            kind,
            message,
            detail,
            id,
        });
    }
    // What a method of Node does where upstream panics on a kind it does not handle.
    pub fn unhandled<T: Default>(self, message: &'static str, node: NodeId) -> T {
        self.fault(FaultKind::Panic, message, self.kind(node) as u32, node.0);
        T::default()
    }

    #[inline]
    fn file_record(self, node: NodeId) -> Option<(&'a File, usize, &'a NodeRecord)> {
        let (file, local) = self.frozen.locate(node.0)?;
        Some((file, local, file.record(local)?))
    }
    // The record of a node of a file: one that a producer made, or one that the binder added.
    #[inline]
    fn record(self, node: NodeId) -> Option<&'a NodeRecord> {
        match self.frozen.locate(node.0) {
            Some((file, local)) => file.record(local),
            None => {
                let (_, bound, local) = self.frozen.locate_bound(node.0)?;
                bound.records.get(local)
            }
        }
    }
    #[inline]
    fn open_node<R: Default>(self, node: NodeId, f: impl FnOnce(&OpenNode<'a>) -> R) -> R {
        read(&self.open.nodes, node.open_index(), f)
    }

    #[inline]
    pub fn kind(self, node: NodeId) -> Kind {
        if node.is_open() {
            return self.open_node(node, |n| n.kind);
        }
        self.record(node)
            .map_or(Kind::Unknown, |record| record.kind)
    }
    #[inline]
    pub fn def(self, node: NodeId) -> Def {
        if node.is_open() {
            return self.open_node(node, |n| n.def);
        }
        self.record(node).map_or(Def::None, |record| record.def)
    }
    #[inline]
    pub fn parent(self, node: NodeId) -> NodeId {
        if node.is_open() {
            return self.open_node(node, |n| n.parent);
        }
        self.record(node)
            .map_or(NodeId::NIL, |record| record.parent)
    }
    #[inline]
    pub fn loc(self, node: NodeId) -> TextRange {
        if node.is_open() {
            return self.open_node(node, |n| n.loc);
        }
        self.record(node)
            .map_or_else(TextRange::default, |record| record.loc)
    }
    #[inline]
    pub fn pos(self, node: NodeId) -> i32 {
        self.loc(node).pos
    }
    #[inline]
    pub fn end(self, node: NodeId) -> i32 {
        self.loc(node).end
    }
    #[inline]
    pub fn flags(self, node: NodeId) -> NodeFlags {
        if node.is_open() {
            return self.open_node(node, |n| n.flags);
        }
        match self.frozen.locate(node.0) {
            Some((file, local)) => file.node_flags(local),
            None => match self.frozen.locate_bound(node.0) {
                Some((_, bound, local)) => {
                    bound.flags.get(local).copied().unwrap_or(NodeFlags::NONE)
                }
                None => NodeFlags::NONE,
            },
        }
    }
    // True for a node that exists in this context.
    pub fn exists(self, node: NodeId) -> bool {
        self.def(node) != Def::None
    }
    // ast.GetSourceFileOfNode: the root of the file that owns the node, else the end of the parent chain.
    pub fn source_file_of(self, node: NodeId) -> NodeId {
        if let Some((file, _)) = self.frozen.locate(node.0) {
            return file.source_file.root;
        }
        let mut current = node;
        // A chain of parents that does not end is cut: the nodes outside the files are the ones of the stores.
        for _ in 0..self.open.node_count().saturating_add(4096) {
            if current.is_nil() || self.kind(current) == Kind::SourceFile {
                return current;
            }
            if !current.is_open() && self.frozen.locate(current.0).is_some() {
                return self.source_file_of(current);
            }
            current = self.parent(current);
        }
        NodeId::NIL
    }

    // The payload of a node of any definition.
    pub fn data_any(self, node: NodeId) -> Option<(Def, NodeData<'a>)> {
        if node.is_open() {
            let n = self.open_node(node, |n| *n);
            if n.def == Def::None {
                return None;
            }
            return Some((
                n.def,
                NodeData {
                    slots: n.slots,
                    texts: Texts::Open(self.open),
                    late: Late::Open { values: n.late },
                },
            ));
        }
        let Some((file, _, record)) = self.file_record(node) else {
            let (_, bound, local) = self.frozen.locate_bound(node.0)?;
            let record = bound.records.get(local)?;
            if record.def == Def::None {
                return None;
            }
            return Some((
                record.def,
                NodeData {
                    slots: bound.node_slots(record),
                    texts: Texts::Bound(bound),
                    late: Late::Open { values: [0; 8] },
                },
            ));
        };
        if record.def == Def::None {
            return None;
        }
        let mask = record.def.info().late;
        let start = record.late as usize;
        let cells = file
            .late
            .get(start..start + mask.count_ones() as usize)
            .unwrap_or(&[]);
        Some((
            record.def,
            NodeData {
                slots: file.node_slots(record),
                texts: Texts::File(file),
                late: Late::File { cells, mask },
            },
        ))
    }
    // The payload behind a cast. A node of another definition is a fault, as a failed type assertion is upstream.
    pub fn data(self, node: NodeId, def: Def) -> Option<NodeData<'a>> {
        match self.data_any(node) {
            Some((actual, data)) if actual == def => Some(data),
            Some((actual, _)) => {
                self.fault(FaultKind::BadCast, def.info().name, actual as u32, node.0);
                None
            }
            None => {
                self.fault(FaultKind::BadCast, def.info().name, 0, node.0);
                None
            }
        }
    }

    // NodeList.Nodes. The nil list has no nodes.
    pub fn nodes(self, list: NodeListId) -> List<'a, NodeId> {
        if list.is_nil() {
            return List::NIL;
        }
        if list.is_open() {
            return read(&self.open.lists, list.open_index(), |l: &OpenList<'a>| {
                l.nodes
            });
        }
        match self.frozen.locate(list.0) {
            Some((file, local)) => match file.list(local) {
                Some(record) if local != 0 => List::from_slice(file.list_nodes(record)),
                _ => List::NIL,
            },
            None => List::NIL,
        }
    }
    // NodeList.Loc
    pub fn list_loc(self, list: NodeListId) -> TextRange {
        if list.is_open() {
            return read(&self.open.lists, list.open_index(), |l| l.loc);
        }
        match self.frozen.locate(list.0) {
            Some((file, local)) => file
                .list(local)
                .map_or_else(TextRange::default, |record| record.loc),
            None => TextRange::default(),
        }
    }
    // NodeList.HasTrailingComma
    pub fn has_trailing_comma(self, list: NodeListId) -> bool {
        let nodes = self.nodes(list);
        if nodes.len() == 0 {
            return false;
        }
        let last = nodes.at(nodes.len() - 1);
        self.end(last) < self.list_loc(list).end
    }
    // ModifierList.ModifierFlags
    pub fn modifier_list_flags(self, list: ModifierListId) -> ModifierFlags {
        if list.is_open() {
            return read(&self.open.lists, list.open_index(), |l| l.modifier_flags);
        }
        match self.frozen.locate(list.0) {
            Some((file, local)) => file
                .list(local)
                .map_or(ModifierFlags::NONE, |record| record.modifier_flags),
            None => ModifierFlags::NONE,
        }
    }

    // Node.JSDoc: the JSDoc nodes attached to a host. The producers attach them before the file is published.
    pub fn jsdoc(self, node: NodeId) -> List<'a, NodeId> {
        if !self.flags(node).intersects(NodeFlags::HAS_JSDOC) || node.is_open() {
            return List::NIL;
        }
        match self.frozen.locate(node.0) {
            Some((file, _)) => self.nodes(file.jsdoc_of(node)),
            None => List::NIL,
        }
    }

    // Node.IterChildren: the children in the order of ForEachChild.
    pub fn iter_children(self, node: NodeId) -> Children<'a> {
        let (layout, slots): (&'static [ChildSlot], &'a [u32]) = match self.data_any(node) {
            Some((def, data)) => {
                let info = def.info();
                // JSDocParameterOrPropertyTag: the name comes first when IsNameFirst is set.
                let name_first = !info.children_alt.is_empty()
                    && info
                        .slots
                        .iter()
                        .position(|slot| slot.name == "IsNameFirst")
                        .is_some_and(|index| data.bool(index));
                (
                    if name_first {
                        info.children_alt
                    } else {
                        info.children
                    },
                    data.slots,
                )
            }
            None => (&[], &[]),
        };
        Children {
            ast: self,
            slots,
            layout,
            next_slot: 0,
            list: &[],
            next_item: 0,
        }
    }
    // Node.ForEachChild: stops at the first child for which `visit` returns true.
    pub fn for_each_child(self, node: NodeId, visit: &mut dyn FnMut(NodeId) -> bool) -> bool {
        for child in self.iter_children(node) {
            if visit(child) {
                return true;
            }
        }
        false
    }

    fn late_value(self, node: NodeId, bit: u8) -> u32 {
        if node.is_open() {
            return self.open_node(node, |n| {
                if n.def.info().late & bit == 0 {
                    0
                } else {
                    n.late
                        .get(bit.trailing_zeros() as usize)
                        .copied()
                        .unwrap_or(0)
                }
            });
        }
        match self.file_record(node) {
            Some((file, _, record)) => file
                .late_cell(record, bit)
                .map_or(0, |cell| cell.load(Ordering::Relaxed)),
            None => 0,
        }
    }
    fn has_late(self, node: NodeId, bit: u8) -> bool {
        self.def(node).info().late & bit != 0
    }
    // Writes a field that upstream reaches through DeclarationData(), FlowNodeData() and the like.
    fn set_late(self, node: NodeId, bit: u8, value: u32, name: &'static str) {
        if !self.has_late(node, bit) {
            self.fault(FaultKind::NilWrite, name, self.kind(node) as u32, node.0);
            return;
        }
        if node.is_open() {
            write(&self.open.nodes, node.open_index(), |n| {
                if let Some(slot) = n.late.get_mut(bit.trailing_zeros() as usize) {
                    *slot = value;
                }
            });
            return;
        }
        if !self.frozen.binding {
            self.fault(FaultKind::WriteToFrozen, name, 0, node.0);
            return;
        }
        if let Some((file, _, record)) = self.file_record(node) {
            if let Some(cell) = file.late_cell(record, bit) {
                cell.store(value, Ordering::Relaxed);
            }
        }
    }

    // DeclarationData() != nil
    pub fn has_declaration_data(self, node: NodeId) -> bool {
        self.has_late(node, LATE_SYMBOL)
    }
    // ExportableData() != nil
    pub fn has_exportable_data(self, node: NodeId) -> bool {
        self.has_late(node, LATE_LOCAL_SYMBOL)
    }
    // LocalsContainerData() != nil
    pub fn has_locals_container_data(self, node: NodeId) -> bool {
        self.has_late(node, LATE_LOCALS)
    }
    // FlowNodeData() != nil
    pub fn has_flow_node_data(self, node: NodeId) -> bool {
        self.has_late(node, LATE_FLOW_NODE)
    }
    // Node.Symbol
    pub fn symbol(self, node: NodeId) -> SymbolId {
        SymbolId(self.late_value(node, LATE_SYMBOL))
    }
    // Node.LocalSymbol
    pub fn local_symbol(self, node: NodeId) -> SymbolId {
        SymbolId(self.late_value(node, LATE_LOCAL_SYMBOL))
    }
    // Node.Locals
    pub fn locals(self, node: NodeId) -> SymbolTableId {
        SymbolTableId(self.late_value(node, LATE_LOCALS))
    }
    pub fn next_container(self, node: NodeId) -> NodeId {
        NodeId(self.late_value(node, LATE_NEXT_CONTAINER))
    }
    pub fn flow_node(self, node: NodeId) -> FlowNodeId {
        FlowNodeId(self.late_value(node, LATE_FLOW_NODE))
    }
    pub fn end_flow_node(self, node: NodeId) -> FlowNodeId {
        FlowNodeId(self.late_value(node, LATE_END_FLOW_NODE))
    }
    pub fn return_flow_node(self, node: NodeId) -> FlowNodeId {
        FlowNodeId(self.late_value(node, LATE_RETURN_FLOW_NODE))
    }
    pub fn fallthrough_flow_node(self, node: NodeId) -> FlowNodeId {
        FlowNodeId(self.late_value(node, LATE_FALLTHROUGH_FLOW_NODE))
    }
    pub fn set_symbol(self, node: NodeId, symbol: SymbolId) {
        self.set_late(node, LATE_SYMBOL, symbol.0, "DeclarationData().Symbol");
    }
    pub fn set_local_symbol(self, node: NodeId, symbol: SymbolId) {
        self.set_late(
            node,
            LATE_LOCAL_SYMBOL,
            symbol.0,
            "ExportableData().LocalSymbol",
        );
    }
    pub fn set_locals(self, node: NodeId, locals: SymbolTableId) {
        self.set_late(node, LATE_LOCALS, locals.0, "LocalsContainerData().Locals");
    }
    pub fn set_next_container(self, node: NodeId, next: NodeId) {
        self.set_late(
            node,
            LATE_NEXT_CONTAINER,
            next.0,
            "LocalsContainerData().NextContainer",
        );
    }
    pub fn set_flow_node(self, node: NodeId, flow: FlowNodeId) {
        self.set_late(node, LATE_FLOW_NODE, flow.0, "FlowNodeData().FlowNode");
    }
    pub fn set_end_flow_node(self, node: NodeId, flow: FlowNodeId) {
        self.set_late(node, LATE_END_FLOW_NODE, flow.0, "BodyData().EndFlowNode");
    }
    pub fn set_return_flow_node(self, node: NodeId, flow: FlowNodeId) {
        self.set_late(node, LATE_RETURN_FLOW_NODE, flow.0, "ReturnFlowNode");
    }
    pub fn set_fallthrough_flow_node(self, node: NodeId, flow: FlowNodeId) {
        self.set_late(
            node,
            LATE_FALLTHROUGH_FLOW_NODE,
            flow.0,
            "FallthroughFlowNode",
        );
    }

    // node.Flags = flags: a node of the open store, or a node of the file that is being bound.
    pub fn set_flags(self, node: NodeId, flags: NodeFlags) {
        if node.is_open() {
            if !write(&self.open.nodes, node.open_index(), |n| n.flags = flags) {
                self.fault(FaultKind::NilWrite, "Node.Flags", 0, node.0);
            }
            return;
        }
        if !self.frozen.binding {
            self.fault(FaultKind::WriteToFrozen, "Node.Flags", 0, node.0);
            return;
        }
        if let Some((file, local)) = self.frozen.locate(node.0) {
            if let Some(cell) = file.flags.get(local) {
                cell.store(flags.0, Ordering::Relaxed);
            }
        }
    }
    // node.Parent = parent: only a node of the open store.
    pub fn set_parent(self, node: NodeId, parent: NodeId) {
        if !node.is_open() {
            self.fault(FaultKind::WriteToFrozen, "Node.Parent", 0, node.0);
        } else if !write(&self.open.nodes, node.open_index(), |n| n.parent = parent) {
            self.fault(FaultKind::NilWrite, "Node.Parent", 0, node.0);
        }
    }
    // node.Loc = loc: only a node of the open store.
    pub fn set_loc(self, node: NodeId, loc: TextRange) {
        if !node.is_open() {
            self.fault(FaultKind::WriteToFrozen, "Node.Loc", 0, node.0);
        } else if !write(&self.open.nodes, node.open_index(), |n| n.loc = loc) {
            self.fault(FaultKind::NilWrite, "Node.Loc", 0, node.0);
        }
    }
    // list.Loc = loc: only a list of the open store.
    pub fn set_list_loc(self, list: NodeListId, loc: TextRange) {
        if !list.is_open() || !write(&self.open.lists, list.open_index(), |l| l.loc = loc) {
            self.fault(FaultKind::WriteToFrozen, "NodeList.Loc", 0, list.0);
        }
    }
    // One slot of a node of the open store, for the setters of MutableNode.
    pub fn set_slot(self, node: NodeId, def: Def, index: u8, value: u32) {
        if !node.is_open() {
            self.fault(
                FaultKind::WriteToFrozen,
                def.info().name,
                u32::from(index),
                node.0,
            );
            return;
        }
        let current = self.open_node(node, |n| *n);
        if current.def != def || usize::from(index) >= current.slots.len() {
            self.fault(
                FaultKind::BadCast,
                def.info().name,
                current.def as u32,
                node.0,
            );
            return;
        }
        let mut slots = current.slots.to_vec();
        if let Some(slot) = slots.get_mut(usize::from(index)) {
            *slot = value;
        }
        let slots = self.open.arena.alloc_slice_copy(&slots);
        write(&self.open.nodes, node.open_index(), |n| n.slots = slots);
    }

    // Node.Text of the kinds that keep one text. The prototype leaves out the two kinds that build a string.
    pub fn text(self, node: NodeId) -> Text<'a> {
        match self.data_any(node) {
            Some((def, data)) => match def.info().slots.iter().position(|slot| {
                slot.ty == SlotType::Text && (slot.name == "Text" || slot.name == "text")
            }) {
                Some(index) => data.text(index),
                None => self.unhandled("Unhandled case in Node.Text", node),
            },
            None => b"",
        }
    }
    // Node.ModifierFlags
    pub fn modifier_flags(self, node: NodeId) -> ModifierFlags {
        self.modifier_list_flags(self.modifiers(node))
    }
    // Node.ModifierNodes
    pub fn modifier_nodes(self, node: NodeId) -> List<'a, NodeId> {
        self.nodes(self.modifiers(node).as_node_list())
    }
    // Node.PropertyNameOrName
    pub fn property_name_or_name(self, node: NodeId) -> NodeId {
        let name = self.property_name(node);
        if name.is_nil() { self.name(node) } else { name }
    }
    // Node.Body
    pub fn body(self, node: NodeId) -> NodeId {
        self.body_data(node).map_or(NodeId::NIL, |data| data.body)
    }
    // Node.ParameterList
    pub fn parameter_list(self, node: NodeId) -> NodeListId {
        self.function_like_data(node)
            .map_or(NodeListId::NIL, |data| data.parameters)
    }
    // Node.Parameters
    pub fn parameters(self, node: NodeId) -> List<'a, NodeId> {
        self.nodes(self.parameter_list(node))
    }
    // Node.IsTypeOnly
    pub fn is_type_only(self, node: NodeId) -> bool {
        match self.kind(node) {
            Kind::ImportEqualsDeclaration => self.as_import_equals_declaration(node).is_type_only,
            Kind::ImportSpecifier => self.as_import_specifier(node).is_type_only,
            Kind::ImportClause => self.as_import_clause(node).phase_modifier == Kind::TypeKeyword,
            Kind::ExportDeclaration => self.as_export_declaration(node).is_type_only,
            Kind::ExportSpecifier => self.as_export_specifier(node).is_type_only,
            _ => false,
        }
    }
    // Node.Contains: walks the parents of `descendant`.
    pub fn contains(self, node: NodeId, descendant: NodeId) -> bool {
        let mut current = descendant;
        while !current.is_nil() {
            if current == node {
                return true;
            }
            let parent = self.parent(current);
            if parent.is_nil() && self.kind(current) != Kind::SourceFile {
                self.fault(FaultKind::Panic, "descendant is not parented", 0, current.0);
                return false;
            }
            current = parent;
        }
        false
    }
    // Node.Decorators
    pub fn decorators(self, node: NodeId) -> Vec<NodeId> {
        self.modifier_nodes(node)
            .iter()
            .filter(|modifier| self.kind(*modifier) == Kind::Decorator)
            .collect()
    }

    // ast.Symbol behind an id.
    pub fn sym(self, symbol: SymbolId) -> Symbol<'a> {
        if symbol.is_open() {
            return read(&self.open.symbols, symbol.open_index(), |s: &Symbol<'a>| *s);
        }
        let Some((file, bound, local)) = self.frozen.locate_bound(symbol.0) else {
            return Symbol::default();
        };
        match bound.symbols.get(local) {
            Some(record) if local != 0 => {
                let declarations = bound.symbol_declarations(record);
                Symbol {
                    flags: record.flags,
                    check_flags: CheckFlags::NONE,
                    name: file.name(bound, record.name),
                    declarations: if declarations.is_empty() {
                        List::NIL
                    } else {
                        List::from_slice(declarations)
                    },
                    value_declaration: record.value_declaration,
                    members: record.members,
                    exports: record.exports,
                    parent: record.parent,
                    export_symbol: record.export_symbol,
                }
            }
            _ => Symbol::default(),
        }
    }
    // newSymbol of the binder and of the checker.
    pub fn new_symbol(self, flags: SymbolFlags, name: Text<'a>) -> SymbolId {
        let index = push(
            &self.open.symbols,
            Symbol {
                flags,
                name,
                ..Symbol::default()
            },
        );
        push(&self.open.open_symbol_ids, 0);
        if index == 0 {
            self.fault(FaultKind::IdSpaceExhausted, "newSymbol", 0, 0);
            return SymbolId::NIL;
        }
        SymbolId::from_open_index(index)
    }
    // A write to a symbol of the open store. A symbol of a file is never written: upstream clones it first.
    pub fn update_symbol(self, symbol: SymbolId, f: impl FnOnce(&mut Symbol<'a>)) {
        if !symbol.is_open() {
            self.fault(FaultKind::WriteToFrozen, "Symbol", 0, symbol.0);
        } else if !write(&self.open.symbols, symbol.open_index(), f) {
            self.fault(FaultKind::NilWrite, "Symbol", 0, symbol.0);
        }
    }
    // ast.GetSymbolId: assigned at the first call, in the order of the calls.
    pub fn get_symbol_id(self, symbol: SymbolId) -> u64 {
        if symbol.is_nil() {
            return 0;
        }
        if symbol.is_open() {
            let id = read(&self.open.open_symbol_ids, symbol.open_index(), |id| *id);
            if id != 0 {
                return id;
            }
            let id = self.next_symbol_id();
            write(&self.open.open_symbol_ids, symbol.open_index(), |slot| {
                *slot = id
            });
            return id;
        }
        if let Some((_, bound, local)) = self.frozen.locate_bound(symbol.0) {
            if let Some(record) = bound.symbols.get(local) {
                if record.lazy_id != 0 {
                    return record.lazy_id;
                }
            }
        }
        let known = match self.open.file_symbol_ids.try_borrow() {
            Ok(ids) => ids.get(&symbol.0),
            Err(_) => 0,
        };
        if known != 0 {
            return known;
        }
        let id = self.next_symbol_id();
        if let Ok(mut ids) = self.open.file_symbol_ids.try_borrow_mut() {
            let _ = ids.set(symbol.0, id);
        }
        id
    }
    fn next_symbol_id(self) -> u64 {
        self.open.ids.next_symbol_id()
    }

    // make(SymbolTable)
    pub fn new_table(self) -> SymbolTableId {
        let index = push(&self.open.tables, OrderedMap::make());
        if index == 0 {
            self.fault(FaultKind::IdSpaceExhausted, "SymbolTable", 0, 0);
            return SymbolTableId::NIL;
        }
        SymbolTableId::from_open_index(index)
    }
    // table[name]
    pub fn table_get(self, table: SymbolTableId, name: &[u8]) -> SymbolId {
        if table.is_open() {
            return read(&self.open.tables, table.open_index(), |t| t.get(&name));
        }
        match self.frozen.locate_bound(table.0) {
            Some((file, bound, local)) => match bound.tables.get(local) {
                Some(record) if local != 0 => file.table_lookup(bound, record, name),
                _ => SymbolId::NIL,
            },
            None => SymbolId::NIL,
        }
    }
    // len(table)
    pub fn table_len(self, table: SymbolTableId) -> isize {
        if table.is_open() {
            return read(&self.open.tables, table.open_index(), |t| t.len());
        }
        match self.frozen.locate_bound(table.0) {
            Some((_, bound, local)) => bound
                .tables
                .get(local)
                .map_or(0, |record| record.len as isize),
            None => 0,
        }
    }
    // The entry at a position of the iteration order, for `for name, symbol := range table`.
    pub fn table_entry_at(
        self,
        table: SymbolTableId,
        position: usize,
    ) -> Option<(Text<'a>, SymbolId)> {
        if table.is_open() {
            return read(&self.open.tables, table.open_index(), |t| {
                t.entry_at(position)
            });
        }
        let (file, bound, local) = self.frozen.locate_bound(table.0)?;
        let record = bound.tables.get(local)?;
        let entry = bound.table_entries(record).get(position)?;
        Some((file.name(bound, entry.name), entry.symbol))
    }
    // table[name] = symbol: only a table of the open store.
    pub fn table_set(self, table: SymbolTableId, name: Text<'a>, symbol: SymbolId) {
        if !table.is_open() {
            self.fault(
                if table.is_nil() {
                    FaultKind::NilMapWrite
                } else {
                    FaultKind::WriteToFrozen
                },
                "SymbolTable",
                0,
                table.0,
            );
            return;
        }
        let mut ok = false;
        write(&self.open.tables, table.open_index(), |t| {
            ok = t.set(name, symbol)
        });
        if !ok {
            self.fault(FaultKind::NilMapWrite, "SymbolTable", 0, table.0);
        }
    }

    // *ast.FlowNode behind an id.
    pub fn flow(self, flow: FlowNodeId) -> FlowNode {
        if flow.is_open() {
            return read(&self.open.flow_nodes, flow.open_index(), |f| *f);
        }
        match self.frozen.locate_bound(flow.0) {
            Some((_, bound, local)) if local != 0 => {
                bound.flow_nodes.get(local).copied().unwrap_or_default()
            }
            _ => FlowNode::default(),
        }
    }
    pub fn new_flow_node(
        self,
        flags: FlowFlags,
        node: NodeId,
        antecedent: FlowNodeId,
    ) -> FlowNodeId {
        let index = push(
            &self.open.flow_nodes,
            FlowNode {
                flags,
                node,
                antecedent,
                antecedents: FlowListId::NIL,
            },
        );
        if index == 0 {
            self.fault(FaultKind::IdSpaceExhausted, "FlowNode", 0, 0);
            return FlowNodeId::NIL;
        }
        FlowNodeId::from_open_index(index)
    }
    pub fn update_flow(self, flow: FlowNodeId, f: impl FnOnce(&mut FlowNode)) {
        if !flow.is_open() || !write(&self.open.flow_nodes, flow.open_index(), f) {
            self.fault(FaultKind::WriteToFrozen, "FlowNode", 0, flow.0);
        }
    }
    // *ast.FlowList behind an id.
    pub fn flow_list(self, list: FlowListId) -> FlowList {
        if list.is_open() {
            return read(&self.open.flow_lists, list.open_index(), |l| *l);
        }
        match self.frozen.locate_bound(list.0) {
            Some((_, bound, local)) if local != 0 => {
                bound.flow_lists.get(local).copied().unwrap_or_default()
            }
            _ => FlowList::default(),
        }
    }
    pub fn new_flow_list(self, flow: FlowNodeId, next: FlowListId) -> FlowListId {
        let index = push(&self.open.flow_lists, FlowList { flow, next });
        if index == 0 {
            self.fault(FaultKind::IdSpaceExhausted, "FlowList", 0, 0);
            return FlowListId::NIL;
        }
        FlowListId::from_open_index(index)
    }
}

const _: () = assert!(OPEN_BIT == 1 << 31);
