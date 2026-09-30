// The tree context: the frozen files of a program, found by the page of an id, plus one open store for the ids with bit 31.
use crate::ast::ast_generated::{DEF_COUNT, Def};
use crate::ast::file::{Bound, File, ListRecord, NodeRecord, SourceFile};
use crate::ast::ids::{
    FlowListId, FlowNodeId, ModifierListId, NodeId, NodeListId, PAGE_BITS, SymbolId, SymbolTableId,
};
use crate::ast::kind_generated::Kind;
use crate::ast::layout::{LATE_LOCALS, LATE_NEXT_CONTAINER, LATE_SYMBOL, late_rank};
use crate::ast::modifierflags::ModifierFlags;
use crate::ast::nodeflags::NodeFlags;
use crate::ast::open::{BindOverlay, Open, count, read, write};
use crate::ast::tokenflags::TokenFlags;
use crate::core::{List, TextRange};
use crate::internal::{Fault, FaultKind};

// The value of a generated slot table for a definition that has no such member.
pub(crate) const NO_SLOT: u8 = 255;

#[derive(Clone, Copy, Default)]
struct PageEntry {
    // The index of the file plus one; 0 for a page that no file owns.
    file: u32,
    base: u32,
    // The page is of the range of the bind result of the file, not of the range of its nodes.
    bound: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum FrozenError {
    // Two files own the same page: they got their ids from two allocators.
    Overlap { first: usize, second: usize },
}

#[derive(Clone, Copy)]
pub(crate) enum Located<'a> {
    File(&'a File, usize),
    Bound(&'a File, &'a Bound, usize),
}

// The frozen files that a context reads.
pub struct Frozen<'a> {
    pages: Vec<PageEntry>,
    files: Vec<&'a File>,
    // True while the one file of the context is being bound: the open store keeps what the binder writes about its nodes.
    binding: bool,
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
        let end = (base.saturating_add(span) >> PAGE_BITS) as usize;
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

    // The files of a program. A file that is bound brings what its binder left.
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
        // One file cannot overlap itself.
        let _ = Self::claim(&mut pages, 0, file.base(), file.span(), false);
        Self {
            pages,
            files: vec![file],
            binding: true,
        }
    }

    // No file: the context of a store that stands alone.
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

    // The file that the context binds.
    pub(crate) fn binding_file(&self) -> Option<&'a File> {
        if !self.binding {
            return None;
        }
        self.files.first().copied()
    }

    // The owner of an id of a frozen file, in any id space.
    #[inline]
    pub(crate) fn locate_any(&self, id: u32) -> Option<Located<'a>> {
        let page = self.pages.get((id >> PAGE_BITS) as usize)?;
        let file = *self.files.get((page.file as usize).checked_sub(1)?)?;
        let local = id.wrapping_sub(page.base) as usize;
        if page.bound {
            Some(Located::Bound(file, file.bound()?, local))
        } else {
            Some(Located::File(file, local))
        }
    }

    // A node or a list that a producer made.
    #[inline]
    pub(crate) fn locate(&self, id: u32) -> Option<(&'a File, usize)> {
        match self.locate_any(id)? {
            Located::File(file, local) => Some((file, local)),
            Located::Bound(..) => None,
        }
    }

    // An object that a binder made.
    #[inline]
    pub(crate) fn locate_bound(&self, id: u32) -> Option<(&'a File, &'a Bound, usize)> {
        match self.locate_any(id)? {
            Located::Bound(file, bound, local) => Some((file, bound, local)),
            Located::File(..) => None,
        }
    }
}

// The first parameter of every function that reads the tree.
#[derive(Clone, Copy)]
pub struct Ast<'a> {
    pub(crate) frozen: &'a Frozen<'a>,
    pub(crate) open: &'a Open<'a>,
}

#[derive(Clone, Copy)]
pub(crate) enum Home<'a> {
    Open,
    File(&'a File),
    Bound(&'a Bound),
}

// A node that was found: its record, the store that holds it and its index there.
#[derive(Clone, Copy)]
pub(crate) struct Found<'a> {
    pub(crate) rec: NodeRecord,
    pub(crate) home: Home<'a>,
    pub(crate) local: usize,
}

// The members of one node: what a cast of upstream gives.
#[derive(Clone, Copy)]
pub struct NodeData<'a> {
    ast: Ast<'a>,
    found: Found<'a>,
}

impl<'a> NodeData<'a> {
    // The word of a slot: 0 for a slot that the definition does not have.
    #[inline]
    pub fn word(&self, index: usize) -> u32 {
        self.ast.word(&self.found, index)
    }

    #[inline]
    pub fn node(&self, index: usize) -> NodeId {
        NodeId(self.word(index))
    }

    #[inline]
    pub fn list(&self, index: usize) -> NodeListId {
        NodeListId(self.word(index))
    }

    #[inline]
    pub fn modifiers(&self, index: usize) -> ModifierListId {
        ModifierListId(self.word(index))
    }

    #[inline]
    pub fn bool(&self, index: usize) -> bool {
        self.word(index) != 0
    }

    #[inline]
    pub fn kind(&self, index: usize) -> Kind {
        Kind::from_u16(self.word(index) as u16)
    }

    #[inline]
    pub fn token_flags(&self, index: usize) -> TokenFlags {
        TokenFlags::from_bits(self.word(index) as i32)
    }

    #[inline]
    pub fn int(&self, index: usize) -> i32 {
        self.word(index) as i32
    }

    #[inline]
    pub fn flow_node(&self, index: usize) -> FlowNodeId {
        FlowNodeId(self.word(index))
    }

    #[inline]
    pub fn flow_list(&self, index: usize) -> FlowListId {
        FlowListId(self.word(index))
    }

    #[inline]
    pub fn text(&self, index: usize) -> &'a [u8] {
        self.ast.text_of(&self.found, self.word(index))
    }

    #[inline]
    fn late(&self, bit: u8) -> u32 {
        self.ast.late_of(&self.found, bit)
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

    #[cold]
    pub fn fault(self, kind: FaultKind, message: &'static str, detail: u32, id: u32) {
        self.open.faults.record(Fault {
            kind,
            message,
            detail,
            id,
        });
    }

    // What a method of Node does where upstream panics on a kind it does not handle: the message is recorded with the kind.
    #[cold]
    pub fn unhandled<T: Default>(self, message: &'static str, node: NodeId) -> T {
        self.fault(FaultKind::Panic, message, self.kind(node) as u32, node.0);
        T::default()
    }

    #[inline]
    pub(crate) fn find(self, node: NodeId) -> Option<Found<'a>> {
        if node.is_open() {
            let local = node.open_index();
            let rec = read(&self.open.nodes, local, |n| n.rec)?;
            return Some(Found {
                rec,
                home: Home::Open,
                local,
            });
        }
        match self.frozen.locate_any(node.0)? {
            Located::File(file, local) => Some(Found {
                rec: *file.record(local)?,
                home: Home::File(file),
                local,
            }),
            Located::Bound(_, bound, local) => Some(Found {
                rec: *bound.record(local)?,
                home: Home::Bound(bound),
                local,
            }),
        }
    }

    // Node.Kind: Unknown for the nil node.
    #[inline]
    pub fn kind(self, node: NodeId) -> Kind {
        self.find(node)
            .map_or(Kind::Unknown, |found| found.rec.kind)
    }

    // The definition of ast.json that the node was made with: the struct behind `n.data` upstream.
    #[inline]
    pub fn def(self, node: NodeId) -> Def {
        self.find(node).map_or(Def::None, |found| found.rec.def)
    }

    // True for a node that exists in this context.
    #[inline]
    pub fn exists(self, node: NodeId) -> bool {
        self.find(node).is_some()
    }

    // Node.Parent
    #[inline]
    pub fn parent(self, node: NodeId) -> NodeId {
        self.find(node)
            .map_or(NodeId::NIL, |found| found.rec.parent)
    }

    // Node.Loc
    #[inline]
    pub fn loc(self, node: NodeId) -> TextRange {
        self.find(node)
            .map_or_else(TextRange::default, |found| found.rec.loc)
    }

    // Node.Pos(): the full start, leading trivia included.
    #[inline]
    pub fn pos(self, node: NodeId) -> i32 {
        self.loc(node).pos()
    }

    // Node.End()
    #[inline]
    pub fn end(self, node: NodeId) -> i32 {
        self.loc(node).end()
    }

    // The flags of a node of a file: what its binder left, else what its binder wrote so far, else what the producer gave.
    fn file_flags(self, file: &'a File, local: usize) -> NodeFlags {
        if let Some(bound) = file.bound() {
            return match bound.flags.get(local) {
                Some(flags) => *flags,
                None => file.node_flags(local),
            };
        }
        if self.frozen.binding {
            let written = match self.open.binding.try_borrow() {
                Ok(overlay) => overlay
                    .as_ref()
                    .and_then(|overlay| overlay.flags.get(local).copied()),
                Err(_) => None,
            };
            if let Some(flags) = written {
                return flags;
            }
        }
        file.node_flags(local)
    }

    // Node.Flags
    #[inline]
    pub fn flags(self, node: NodeId) -> NodeFlags {
        let Some(found) = self.find(node) else {
            return NodeFlags::NONE;
        };
        match found.home {
            Home::Open => {
                read(&self.open.nodes, found.local, |n| n.flags).unwrap_or(NodeFlags::NONE)
            }
            Home::File(file) => self.file_flags(file, found.local),
            Home::Bound(bound) => bound.node_flags(found.local),
        }
    }

    // ast.GetSourceFileOfNode: the root of the file that owns the node, else the end of the parent chain.
    pub fn source_file_of(self, node: NodeId) -> NodeId {
        let mut current = node;
        // A chain of parents that does not end is cut: only nodes of the open store can form one.
        for _ in 0..count(&self.open.nodes).saturating_add(2) {
            if current.is_nil() {
                return NodeId::NIL;
            }
            if !current.is_open() {
                return match self.frozen.locate(current.0) {
                    Some((file, _)) => file.source_file.root,
                    None => NodeId::NIL,
                };
            }
            if self.kind(current) == Kind::SourceFile {
                return current;
            }
            current = self.parent(current);
        }
        NodeId::NIL
    }

    // One slot of a node that was found.
    #[inline]
    pub(crate) fn word(self, found: &Found<'a>, index: usize) -> u32 {
        if index >= found.rec.def.info().slots.len() {
            return 0;
        }
        let at = found.rec.data as usize + index;
        match found.home {
            Home::Open => match self.open.slots.try_borrow() {
                Ok(words) => words.get(at).copied().unwrap_or(0),
                Err(_) => 0,
            },
            Home::File(file) => file.slots.get(at).copied().unwrap_or(0),
            Home::Bound(bound) => bound.slots.get(at).copied().unwrap_or(0),
        }
    }

    // The text behind a text slot of a node that was found.
    #[inline]
    pub(crate) fn text_of(self, found: &Found<'a>, handle: u32) -> &'a [u8] {
        match found.home {
            Home::Open => self.open_text(handle),
            Home::File(file) => file.text(handle),
            Home::Bound(bound) => bound.text(handle),
        }
    }

    // The text behind a text slot of a node of the open store.
    pub(crate) fn open_text(self, handle: u32) -> &'a [u8] {
        read(&self.open.texts, handle as usize, |text| *text).unwrap_or(&[])
    }

    // The members of a node of any definition: None for the nil node.
    #[inline]
    pub fn data_any(self, node: NodeId) -> Option<(Def, NodeData<'a>)> {
        let found = self.find(node)?;
        Some((found.rec.def, NodeData { ast: self, found }))
    }

    // `n.data.(*X)`: a node of another definition is a failed type assertion, the nil node a nil dereference.
    fn cast(self, node: NodeId, def: Def) -> Option<Found<'a>> {
        match self.find(node) {
            Some(found) if found.rec.def == def => Some(found),
            Some(found) => {
                let kind = found.rec.kind as u32;
                self.fault(FaultKind::BadCast, def.info().name, kind, node.0);
                None
            }
            None => {
                self.fault(FaultKind::NilRead, def.info().name, 0, node.0);
                None
            }
        }
    }

    // The members behind a cast: None when the cast fails.
    #[inline]
    pub fn data(self, node: NodeId, def: Def) -> Option<NodeData<'a>> {
        let found = self.cast(node, def)?;
        Some(NodeData { ast: self, found })
    }

    // A cast to a definition without members: what remains of it is the fault of a node of another definition.
    pub(crate) fn check_def(self, node: NodeId, def: Def) {
        self.cast(node, def);
    }

    // The members of a node whose definition has the base that `table` describes, with the slots of the fields of the base.
    pub(crate) fn base_data<const N: usize>(
        self,
        node: NodeId,
        table: &'static [[u8; N]; DEF_COUNT],
    ) -> Option<(NodeData<'a>, [u8; N])> {
        let found = self.find(node)?;
        let row = *table.get(found.rec.def as usize)?;
        if row.first().copied().unwrap_or(NO_SLOT) == NO_SLOT {
            return None;
        }
        Some((NodeData { ast: self, found }, row))
    }

    // The slot that `table` names for the definition of the node: 0 when the definition has no such member.
    pub(crate) fn slot_by_table(self, node: NodeId, table: &'static [u8; DEF_COUNT]) -> u32 {
        let Some(found) = self.find(node) else {
            return 0;
        };
        match table.get(found.rec.def as usize).copied() {
            Some(slot) if slot != NO_SLOT => self.word(&found, usize::from(slot)),
            _ => 0,
        }
    }

    // `node.AsSourceFile()`: the root of a file brings what the file keeps beside its tree and what its binder left.
    pub fn as_source_file(self, node: NodeId) -> SourceFile<'a> {
        let Some(d) = self.data(node, Def::SourceFile) else {
            return SourceFile::detached(NodeListId::NIL, NodeId::NIL);
        };
        let root_of = match d.found.home {
            Home::File(file) if file.source_file.root == node => Some(file),
            _ => None,
        };
        let mut view = match root_of {
            Some(file) => SourceFile::of_file(file, d.list(0), d.node(1)),
            None => SourceFile::detached(d.list(0), d.node(1)),
        };
        view.symbol = d.late_symbol(LATE_SYMBOL);
        view.locals = d.late_table(LATE_LOCALS);
        view.next_container = d.late_node(LATE_NEXT_CONTAINER);
        let Some(file) = root_of else {
            return view;
        };
        if let Some(bound) = file.bound() {
            view.symbol_count = bound.file_symbol_count;
            view.pattern_ambient_modules = &bound.pattern_ambient_modules;
            view.global_exports = bound.global_exports;
            if !bound.common_js_module_indicator.is_nil() {
                view.common_js_module_indicator = bound.common_js_module_indicator;
            }
        } else if self.frozen.binding {
            if let Ok(binding) = self.open.binding.try_borrow() {
                if let Some(overlay) = binding.as_ref() {
                    view.symbol_count = overlay.symbol_count;
                    view.global_exports = overlay.global_exports;
                    if !overlay.common_js_module_indicator.is_nil() {
                        view.common_js_module_indicator = overlay.common_js_module_indicator;
                    }
                }
            }
        }
        view
    }

    // The record of a list of a frozen file.
    fn file_list(self, list: u32) -> Option<(&'a File, &'a ListRecord)> {
        let (file, local) = self.frozen.locate(list)?;
        Some((file, file.list(local)?))
    }

    // NodeList.Nodes. The nil list has no nodes.
    pub fn nodes(self, list: NodeListId) -> List<'a, NodeId> {
        if list.is_nil() {
            return List::NIL;
        }
        if list.is_open() {
            return match read(&self.open.lists, list.open_index(), |l| l.nodes) {
                Some(nodes) => List::from_slice(nodes),
                None => List::NIL,
            };
        }
        match self.file_list(list.0) {
            Some((file, record)) => List::from_slice(file.list_nodes(record)),
            None => List::NIL,
        }
    }

    // NodeList.Loc
    pub fn list_loc(self, list: NodeListId) -> TextRange {
        if list.is_open() {
            return read(&self.open.lists, list.open_index(), |l| l.loc).unwrap_or_default();
        }
        self.file_list(list.0)
            .map_or_else(TextRange::default, |(_, record)| record.loc)
    }

    // NodeList.Pos()
    pub fn list_pos(self, list: NodeListId) -> i32 {
        self.list_loc(list).pos()
    }

    // NodeList.End()
    pub fn list_end(self, list: NodeListId) -> i32 {
        self.list_loc(list).end()
    }

    // NodeList.HasTrailingComma
    pub fn has_trailing_comma(self, list: NodeListId) -> bool {
        match self.nodes(list).as_slice().last() {
            Some(last) => self.end(*last) < self.list_end(list),
            None => false,
        }
    }

    // ModifierList.ModifierFlags
    pub fn modifier_list_flags(self, list: ModifierListId) -> ModifierFlags {
        if list.is_open() {
            return read(&self.open.lists, list.open_index(), |l| l.modifier_flags)
                .unwrap_or(ModifierFlags::NONE);
        }
        self.file_list(list.0)
            .map_or(ModifierFlags::NONE, |(_, record)| record.modifier_flags)
    }

    // ModifierList.Loc
    pub fn modifier_list_loc(self, list: ModifierListId) -> TextRange {
        self.list_loc(list.as_node_list())
    }

    // ModifierList.Nodes
    pub fn modifier_list_nodes(self, list: ModifierListId) -> List<'a, NodeId> {
        self.nodes(list.as_node_list())
    }

    // Node.JSDoc: the JSDoc nodes that the producer attached to a host. A node of the open store has none.
    pub fn jsdoc(self, node: NodeId) -> List<'a, NodeId> {
        if node.is_open() || !self.flags(node).intersects(NodeFlags::HAS_JSDOC) {
            return List::NIL;
        }
        match self.frozen.locate(node.0) {
            Some((file, _)) => self.nodes(file.jsdoc_of(node)),
            None => List::NIL,
        }
    }

    // The fault of a write to something that the context cannot write.
    pub(crate) fn cannot_write(self, who: &'static str, id: u32, exists: bool) {
        let kind = if exists {
            FaultKind::WriteToFrozen
        } else {
            FaultKind::NilWrite
        };
        self.fault(kind, who, 0, id);
    }

    // What the binder of the context has written about its file: made at the first write.
    pub(crate) fn overlay<R>(self, f: impl FnOnce(&mut BindOverlay) -> R) -> Option<R> {
        let file = self.frozen.binding_file()?;
        if file.bound().is_some() {
            return None;
        }
        let mut binding = self.open.binding.try_borrow_mut().ok()?;
        let overlay = binding.get_or_insert_with(|| BindOverlay {
            flags: file.flags.clone(),
            late: vec![0; file.late_len as usize],
            ..BindOverlay::default()
        });
        Some(f(overlay))
    }

    // `node.Flags = flags`: a node of the open store, or a node of the file that the context binds.
    pub fn set_flags(self, node: NodeId, flags: NodeFlags) {
        let Some(found) = self.find(node) else {
            self.cannot_write("Node.Flags", node.0, false);
            return;
        };
        let written = match found.home {
            Home::Open => write(&self.open.nodes, found.local, |n| n.flags = flags),
            Home::File(_) => self
                .overlay(|overlay| match overlay.flags.get_mut(found.local) {
                    Some(slot) => {
                        *slot = flags;
                        true
                    }
                    None => false,
                })
                .unwrap_or(false),
            Home::Bound(_) => false,
        };
        if !written {
            self.cannot_write("Node.Flags", node.0, true);
        }
    }

    // `node.Parent = parent`: only a node of the open store.
    pub fn set_parent(self, node: NodeId, parent: NodeId) {
        if !node.is_open()
            || !write(&self.open.nodes, node.open_index(), |n| {
                n.rec.parent = parent
            })
        {
            self.cannot_write("Node.Parent", node.0, self.exists(node));
        }
    }

    // `node.Loc = loc`: only a node of the open store.
    pub fn set_loc(self, node: NodeId, loc: TextRange) {
        if !node.is_open() || !write(&self.open.nodes, node.open_index(), |n| n.rec.loc = loc) {
            self.cannot_write("Node.Loc", node.0, self.exists(node));
        }
    }

    // `list.Loc = loc`: only a list of the open store.
    pub fn set_list_loc(self, list: NodeListId, loc: TextRange) {
        if !list.is_open() || !write(&self.open.lists, list.open_index(), |l| l.loc = loc) {
            self.cannot_write("NodeList.Loc", list.0, !list.is_nil());
        }
    }

    // One slot of a node of the open store: what a setter of MutableNode writes.
    pub fn set_slot(self, node: NodeId, def: Def, index: u8, value: u32) {
        let Some(found) = self.find(node) else {
            self.cannot_write(def.info().name, node.0, false);
            return;
        };
        if found.rec.def != def || usize::from(index) >= def.info().slots.len() {
            let kind = found.rec.kind as u32;
            self.fault(FaultKind::BadCast, def.info().name, kind, node.0);
            return;
        }
        let written = matches!(found.home, Home::Open)
            && match self.open.slots.try_borrow_mut() {
                Ok(mut words) => {
                    match words.get_mut(found.rec.data as usize + usize::from(index)) {
                        Some(slot) => {
                            *slot = value;
                            true
                        }
                        None => false,
                    }
                }
                Err(_) => false,
            };
        if !written {
            self.cannot_write(def.info().name, node.0, true);
        }
    }

    // The field of the binder `bit` of a node that was found: 0 when its definition has no such field or nothing wrote it.
    pub(crate) fn late_of(self, found: &Found<'a>, bit: u8) -> u32 {
        let mask = found.rec.def.info().late;
        if mask & bit == 0 {
            return 0;
        }
        let at = found.rec.late as usize + late_rank(mask, bit);
        match found.home {
            Home::Open => match self.open.slots.try_borrow() {
                Ok(words) => words.get(at).copied().unwrap_or(0),
                Err(_) => 0,
            },
            Home::File(file) => match file.bound() {
                Some(bound) => bound.late.get(at).copied().unwrap_or(0),
                None if self.frozen.binding => match self.open.binding.try_borrow() {
                    Ok(overlay) => overlay
                        .as_ref()
                        .and_then(|overlay| overlay.late.get(at).copied())
                        .unwrap_or(0),
                    Err(_) => 0,
                },
                None => 0,
            },
            Home::Bound(_) => 0,
        }
    }

    // The field of the binder `bit` of a node: 0 for the nil node.
    pub(crate) fn late_value(self, node: NodeId, bit: u8) -> u32 {
        match self.find(node) {
            Some(found) => self.late_of(&found, bit),
            None => 0,
        }
    }

    // True when the definition of the node has the field of the binder `bit`: `n.DeclarationData() != nil` and the like.
    pub(crate) fn has_late(self, node: NodeId, bit: u8) -> bool {
        self.def(node).info().late & bit != 0
    }

    // Writes a field of the binder. A node without the field is a nil dereference upstream.
    pub(crate) fn set_late(self, node: NodeId, bit: u8, value: u32, who: &'static str) {
        let Some(found) = self.find(node) else {
            self.cannot_write(who, node.0, false);
            return;
        };
        let mask = found.rec.def.info().late;
        if mask & bit == 0 {
            self.fault(FaultKind::NilWrite, who, found.rec.kind as u32, node.0);
            return;
        }
        let at = found.rec.late as usize + late_rank(mask, bit);
        let written = match found.home {
            Home::Open => match self.open.slots.try_borrow_mut() {
                Ok(mut words) => match words.get_mut(at) {
                    Some(slot) => {
                        *slot = value;
                        true
                    }
                    None => false,
                },
                Err(_) => false,
            },
            Home::File(_) => self
                .overlay(|overlay| match overlay.late.get_mut(at) {
                    Some(slot) => {
                        *slot = value;
                        true
                    }
                    None => false,
                })
                .unwrap_or(false),
            Home::Bound(_) => false,
        };
        if !written {
            self.cannot_write(who, node.0, true);
        }
    }

    // The file that owns a node.
    pub fn file_of(self, node: NodeId) -> Option<&'a File> {
        match self.frozen.locate_any(node.0)? {
            Located::File(file, _) | Located::Bound(file, _, _) => Some(file),
        }
    }
}
