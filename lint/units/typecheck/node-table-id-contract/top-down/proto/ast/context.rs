// The one way to read a node: a context maps an id to its table.
//   id without bit 31: a node of a file. The page of the id names the table; the index is `id - first`.
//   id with bit 31   : a node of the context's own arena (a file under construction, or what a checker made).
// A nil id, an unknown id and a cast to the wrong struct give zero values and one entry in the log. Nothing panics.
use crate::ast::ast_generated::{DEF_COUNT, Def, MAX_SLOTS, layout};
use crate::ast::flags_generated::{ModifierFlags, NodeFlags};
use crate::ast::kind_generated::Kind;
use crate::ast::node_arena::{NodeArena, rec_def, rec_flags, rec_kind, rec_word};
use crate::ast::symbol::{FlowListRec, FlowNodeRec, Symbol};
use crate::ast::table::{NodeRec, NodeTable};
use crate::core::{TextRange, new_text_range};
use crate::golang::{List, Text};
use crate::ids::{
    FlowListId, FlowNodeId, ModifierListId, NodeId, NodeListId, PAGE_SHIFT, SYNTH, SymbolId,
    SymbolTableId,
};
use crate::internal::{FaultKind, InternalLog};
use std::sync::atomic::Ordering::Relaxed;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    // A producer fills the arena. There is no file yet.
    Build,
    // The binder reads one local table and writes its own fields into it.
    Bind,
    // A checker reads frozen files and writes only the nodes of its arena.
    Check,
}

#[derive(Clone, Copy)]
struct Page<'a> {
    recs: &'a [NodeRec],
    first: u32,
    table: Option<&'a NodeTable>,
}

pub struct AstContext<'a> {
    pages: Vec<Page<'a>>,
    mode: Mode,
    pub(crate) arena: NodeArena,
    pub log: InternalLog,
}

pub type Ast<'a> = &'a AstContext<'a>;

const NO_SLOT: u8 = 255;

impl<'a> AstContext<'a> {
    pub fn for_building() -> Self {
        Self {
            pages: Vec::new(),
            mode: Mode::Build,
            arena: NodeArena::new(),
            log: InternalLog::default(),
        }
    }
    // The view of the binder: one table that is not frozen yet, whose ids start at 1.
    pub fn for_binding(table: &'a NodeTable) -> Self {
        let page = Page {
            recs: &table.recs,
            first: table.first,
            table: Some(table),
        };
        let count = (table.id_count() >> PAGE_SHIFT) as usize + 1;
        Self {
            pages: vec![page; count],
            mode: Mode::Bind,
            arena: NodeArena::new(),
            log: InternalLog::default(),
        }
    }
    // The view of a checker: the frozen files of one program. Each file owns the pages of its block.
    pub fn for_checking(tables: &[&'a NodeTable]) -> Self {
        let nil = Page {
            recs: &[],
            first: 0,
            table: None,
        };
        let last = tables
            .iter()
            .map(|t| t.first.saturating_add(t.id_count().max(1) - 1) >> PAGE_SHIFT)
            .max()
            .unwrap_or(0);
        let mut pages = vec![nil; last as usize + 1];
        let log = InternalLog::default();
        for table in tables {
            if !table.frozen {
                log.record(
                    FaultKind::BuilderMisuse,
                    "a table that is not frozen",
                    table.first,
                );
                continue;
            }
            let from = (table.first >> PAGE_SHIFT) as usize;
            let to =
                (table.first.saturating_add(table.id_count().max(1) - 1) >> PAGE_SHIFT) as usize;
            let page = Page {
                recs: &table.recs,
                first: table.first,
                table: Some(table),
            };
            if let Some(range) = pages.get_mut(from..=to) {
                range.fill(page);
            }
        }
        Self {
            pages,
            mode: Mode::Check,
            arena: NodeArena::new(),
            log,
        }
    }
    pub fn mode(&self) -> Mode {
        self.mode
    }
    pub fn page_count(&self) -> usize {
        self.pages.len()
    }

    #[cold]
    fn nil_read(&self, who: &'static str, id: u32) {
        self.log.record(FaultKind::NilRead, who, id);
    }
    #[cold]
    fn bad_cast(&self, who: &'static str, kind: Kind) {
        self.log.record(FaultKind::BadCast, who, kind as u32);
    }
    // What the reference does with `panic("Unhandled case in Node.X: " + n.Kind.String())`.
    #[cold]
    pub fn unhandled(&self, message: &'static str, node: NodeId) {
        self.log
            .record(FaultKind::Panic, message, self.kind_quiet(node) as u32);
    }

    #[inline]
    fn file_rec(&self, id: u32) -> Option<&'a NodeRec> {
        let page = self.pages.get((id >> PAGE_SHIFT) as usize)?;
        page.recs.get(id.wrapping_sub(page.first) as usize)
    }
    #[inline]
    fn file_table(&self, id: u32) -> Option<&'a NodeTable> {
        self.pages.get((id >> PAGE_SHIFT) as usize)?.table
    }
    // The table that owns a frozen or local id of any id space.
    #[inline]
    pub fn table_of(&self, id: u32) -> Option<&'a NodeTable> {
        if id & SYNTH != 0 {
            return None;
        }
        self.file_table(id)
    }

    fn kind_quiet(&self, node: NodeId) -> Kind {
        let id = node.0;
        if id & SYNTH == 0 {
            return self.file_rec(id).map_or(Kind::Unknown, |rec| rec.kind);
        }
        self.arena
            .rec(id)
            .map_or(Kind::Unknown, |rec| Kind::from_u16(rec_kind(rec)))
    }
    #[inline]
    pub fn kind(&self, node: NodeId) -> Kind {
        let id = node.0;
        if id & SYNTH == 0 {
            if let Some(rec) = self.file_rec(id) {
                return rec.kind;
            }
        } else if let Some(rec) = self.arena.rec(id) {
            return Kind::from_u16(rec_kind(rec));
        }
        self.nil_read("Kind", id);
        Kind::Unknown
    }
    #[inline]
    pub fn def(&self, node: NodeId) -> Def {
        let id = node.0;
        if id & SYNTH == 0 {
            if let Some(rec) = self.file_rec(id) {
                return rec.def;
            }
        } else if let Some(rec) = self.arena.rec(id) {
            return Def::from_u8(rec_def(rec));
        }
        self.nil_read("data", id);
        Def::None
    }
    #[inline]
    pub fn flags(&self, node: NodeId) -> NodeFlags {
        let id = node.0;
        if id & SYNTH == 0 {
            if let Some(rec) = self.file_rec(id) {
                return rec.flags();
            }
        } else if let Some(rec) = self.arena.rec(id) {
            return rec_flags(rec);
        }
        self.nil_read("Flags", id);
        NodeFlags::empty()
    }
    #[inline]
    pub fn loc(&self, node: NodeId) -> TextRange {
        let id = node.0;
        if id & SYNTH == 0 {
            if let Some(rec) = self.file_rec(id) {
                return new_text_range(rec.pos, rec.end);
            }
        } else if let Some(rec) = self.arena.rec(id) {
            return new_text_range(rec_word(rec, 2) as i32, rec_word(rec, 3) as i32);
        }
        self.nil_read("Loc", id);
        TextRange::default()
    }
    #[inline]
    pub fn parent(&self, node: NodeId) -> NodeId {
        let id = node.0;
        if id & SYNTH == 0 {
            if let Some(rec) = self.file_rec(id) {
                return NodeId(rec.parent);
            }
        } else if let Some(rec) = self.arena.rec(id) {
            return NodeId(rec_word(rec, 4));
        }
        self.nil_read("Parent", id);
        NodeId::NIL
    }

    // `n.data.(*X)`: the slots of the node when its struct is `def`, zeros and a BadCast entry otherwise.
    #[inline]
    pub(crate) fn slots<const N: usize>(
        &self,
        node: NodeId,
        def: Def,
        who: &'static str,
    ) -> [u32; N] {
        let mut out = [0u32; N];
        let id = node.0;
        if id & SYNTH == 0 {
            if let (Some(rec), Some(table)) = (self.file_rec(id), self.file_table(id)) {
                if rec.def == def {
                    let start = rec.data as usize;
                    if let Some(payload) = table.slots.get(start..start + N) {
                        for (value, slot) in out.iter_mut().zip(payload) {
                            *value = slot.load(Relaxed);
                        }
                    }
                } else {
                    self.bad_cast(who, rec.kind);
                }
                return out;
            }
        } else if let Some(rec) = self.arena.rec(id) {
            if rec_def(rec) == def as u8 {
                for (value, slot) in out.iter_mut().zip(self.arena.payload(rec, N)) {
                    *value = slot.get();
                }
            } else {
                self.bad_cast(who, Kind::from_u16(rec_kind(rec)));
            }
            return out;
        }
        self.nil_read(who, id);
        out
    }
    pub(crate) fn check_def(&self, node: NodeId, def: Def, who: &'static str) {
        let found = self.def(node);
        if found != def && found != Def::None {
            self.bad_cast(who, self.kind_quiet(node));
        }
    }
    // `n.AsX().F` for one field.
    #[inline]
    pub(crate) fn field(&self, node: NodeId, def: Def, slot: usize, who: &'static str) -> u32 {
        let id = node.0;
        if id & SYNTH == 0 {
            if let (Some(rec), Some(table)) = (self.file_rec(id), self.file_table(id)) {
                if rec.def == def {
                    return table
                        .slots
                        .get(rec.data as usize + slot)
                        .map_or(0, |s| s.load(Relaxed));
                }
                self.bad_cast(who, rec.kind);
                return 0;
            }
        } else if let Some(rec) = self.arena.rec(id) {
            if rec_def(rec) == def as u8 {
                let n = layout(def).slots.len();
                return self.arena.payload(rec, n).get(slot).map_or(0, |s| s.get());
            }
            self.bad_cast(who, Kind::from_u16(rec_kind(rec)));
            return 0;
        }
        self.nil_read(who, id);
        0
    }
    // A field that a base struct provides: the table gives its slot for each struct, or none.
    #[inline]
    pub(crate) fn slot_by_table(&self, node: NodeId, slots: &[u8; DEF_COUNT]) -> Option<u32> {
        let id = node.0;
        if id & SYNTH == 0 {
            if let (Some(rec), Some(table)) = (self.file_rec(id), self.file_table(id)) {
                let slot = slots.get(rec.def as usize).copied().unwrap_or(NO_SLOT);
                if slot == NO_SLOT {
                    return None;
                }
                return Some(
                    table
                        .slots
                        .get(rec.data as usize + slot as usize)
                        .map_or(0, |s| s.load(Relaxed)),
                );
            }
        } else if let Some(rec) = self.arena.rec(id) {
            let def = rec_def(rec);
            let slot = slots.get(def as usize).copied().unwrap_or(NO_SLOT);
            if slot == NO_SLOT {
                return None;
            }
            let n = layout(Def::from_u8(def)).slots.len();
            return Some(
                self.arena
                    .payload(rec, n)
                    .get(slot as usize)
                    .map_or(0, |s| s.get()),
            );
        }
        self.nil_read("data", id);
        None
    }
    // Every slot of a node, in the order of its layout, with its struct. For the generic walkers.
    #[inline]
    pub(crate) fn slots_any(&self, node: NodeId) -> (Def, [u32; MAX_SLOTS]) {
        let mut out = [0u32; MAX_SLOTS];
        let id = node.0;
        if id & SYNTH == 0 {
            if let (Some(rec), Some(table)) = (self.file_rec(id), self.file_table(id)) {
                for (value, slot) in out.iter_mut().zip(table.payload(rec)) {
                    *value = slot.load(Relaxed);
                }
                return (rec.def, out);
            }
        } else if let Some(rec) = self.arena.rec(id) {
            let def = Def::from_u8(rec_def(rec));
            let n = layout(def).slots.len();
            for (value, slot) in out.iter_mut().zip(self.arena.payload(rec, n)) {
                *value = slot.get();
            }
            return (def, out);
        }
        self.nil_read("data", id);
        (Def::None, out)
    }

    // The text behind a text slot of `node`.
    #[inline]
    pub(crate) fn node_text(&'a self, node: NodeId, handle: u32) -> Text<'a> {
        if node.0 & SYNTH == 0 {
            return match self.file_table(node.0) {
                Some(table) => table.text(handle),
                None => &[],
            };
        }
        self.arena.text(handle)
    }
    pub(crate) fn jsx_namespaced_name_text(&'a self, node: NodeId) -> Text<'a> {
        let n = node.as_jsx_namespaced_name(self);
        let mut text = n.namespace.text(self).to_vec();
        text.push(b':');
        text.extend_from_slice(n.name.text(self));
        self.arena.text(self.arena.new_text(&text))
    }

    // `list.Nodes`. A nil list gives the nil slice and an entry in the log, as the reference would panic.
    #[inline]
    pub fn list_nodes(&'a self, list: NodeListId) -> List<'a, NodeId> {
        let id = list.0;
        if id & SYNTH == 0 {
            if let Some(table) = self.file_table(id) {
                if let Some(rec) = table.list(id) {
                    return List::from_slice(table.list_nodes(rec));
                }
            }
        } else if let Some(nodes) = self.arena.list_nodes(id) {
            return List::from_slice(nodes);
        }
        self.nil_read("NodeList.Nodes", id);
        List::NIL
    }
    pub fn list_loc(&self, list: NodeListId) -> TextRange {
        let id = list.0;
        if id & SYNTH == 0 {
            if let Some(rec) = self.file_table(id).and_then(|table| table.list(id)) {
                return new_text_range(rec.pos, rec.end);
            }
        } else if let Some(loc) = self.arena.list_loc(id) {
            return loc;
        }
        self.nil_read("NodeList.Loc", id);
        TextRange::default()
    }
    pub fn list_modifier_flags(&self, list: ModifierListId) -> ModifierFlags {
        let id = list.0;
        if id & SYNTH == 0 {
            if let Some(rec) = self.file_table(id).and_then(|table| table.list(id)) {
                return ModifierFlags::from_bits_retain(rec.modifier_flags);
            }
        } else if let Some(flags) = self.arena.list_modifier_flags(id) {
            return flags;
        }
        self.nil_read("ModifierList.ModifierFlags", id);
        ModifierFlags::empty()
    }
    // The JSDoc nodes of a host: the nil slice for a host without any.
    pub fn jsdoc_of(&'a self, host: NodeId) -> List<'a, NodeId> {
        let list = if host.0 & SYNTH == 0 {
            self.file_table(host.0)
                .map_or(NodeListId::NIL, |table| table.jsdoc_of(host))
        } else {
            self.arena.jsdoc_of(host)
        };
        if list.is_nil() {
            return List::NIL;
        }
        self.list_nodes(list)
    }

    // Writes. A node of the arena takes any write. A node of a file takes the binder's writes in Bind mode only.
    fn writable_file_rec(
        &self,
        id: u32,
        who: &'static str,
    ) -> Option<(&'a NodeRec, &'a NodeTable)> {
        match (self.mode, self.file_rec(id), self.file_table(id)) {
            (Mode::Bind, Some(rec), Some(table)) if !table.frozen => Some((rec, table)),
            (_, Some(_), _) => {
                self.log.record(FaultKind::WriteToBoundObject, who, id);
                None
            }
            _ => {
                self.nil_read(who, id);
                None
            }
        }
    }
    pub fn set_flags(&self, node: NodeId, flags: NodeFlags) {
        let id = node.0;
        if id & SYNTH == 0 {
            if let Some((rec, _)) = self.writable_file_rec(id, "Flags") {
                rec.flags.store(flags.bits(), Relaxed);
            }
        } else if let Some(word) = self.arena.rec(id).and_then(|rec| rec.get(1)) {
            word.set(flags.bits());
        } else {
            self.nil_read("Flags", id);
        }
    }
    pub fn set_loc(&self, node: NodeId, loc: TextRange) {
        let id = node.0;
        match self.arena.rec(id) {
            Some(rec) if id & SYNTH != 0 => {
                if let (Some(pos), Some(end)) = (rec.get(2), rec.get(3)) {
                    pos.set(loc.pos() as u32);
                    end.set(loc.end() as u32);
                }
            }
            _ => self.log.record(FaultKind::WriteToBoundObject, "Loc", id),
        }
    }
    pub fn set_parent(&self, node: NodeId, parent: NodeId) {
        let id = node.0;
        match self.arena.rec(id).and_then(|rec| rec.get(4)) {
            Some(word) if id & SYNTH != 0 => word.set(parent.0),
            _ => self.log.record(FaultKind::WriteToBoundObject, "Parent", id),
        }
    }
    pub fn set_list_loc(&self, list: NodeListId, loc: TextRange) {
        if list.0 & SYNTH == 0 || !self.arena.set_list_loc(list.0, loc) {
            self.log
                .record(FaultKind::WriteToBoundObject, "NodeList.Loc", list.0);
        }
    }
    fn write_slot(&self, node: NodeId, def: Def, slot: usize, value: u32, who: &'static str) {
        let id = node.0;
        let field = layout(def).slots.get(slot);
        if id & SYNTH == 0 {
            if let Some((rec, table)) = self.writable_file_rec(id, who) {
                match field {
                    Some(field) if field.bound => {
                        if let Some(s) = table.slots.get(rec.data as usize + slot) {
                            s.store(value, Relaxed);
                        }
                    }
                    _ => self.log.record(FaultKind::WriteToBoundObject, who, id),
                }
            }
        } else if let Some(rec) = self.arena.rec(id) {
            let n = layout(def).slots.len();
            if let Some(s) = self.arena.payload(rec, n).get(slot) {
                s.set(value);
            }
        } else {
            self.nil_read(who, id);
        }
    }
    // `n.AsX().F = v`.
    pub(crate) fn set_field(
        &self,
        node: NodeId,
        def: Def,
        slot: usize,
        value: u32,
        who: &'static str,
    ) {
        let found = self.def(node);
        if found != def {
            if found != Def::None {
                self.bad_cast(who, self.kind_quiet(node));
            }
            return;
        }
        self.write_slot(node, def, slot, value, who);
    }
    // Writes a field of a base struct. False when the node's struct does not have it.
    pub(crate) fn set_slot_by_table(
        &self,
        node: NodeId,
        slots: &[u8; DEF_COUNT],
        value: u32,
    ) -> bool {
        let def = self.def(node);
        let slot = slots.get(def as usize).copied().unwrap_or(NO_SLOT);
        if slot == NO_SLOT {
            return false;
        }
        self.write_slot(node, def, slot as usize, value, "base data");
        true
    }

    // The bound data of the file that owns an id.
    pub fn symbol(&self, symbol: SymbolId) -> Symbol<'a> {
        match self
            .table_of(symbol.0)
            .and_then(|t| t.bound.symbol(t.first, symbol))
        {
            Some(found) => found,
            None => {
                self.nil_read("Symbol", symbol.0);
                Symbol::default()
            }
        }
    }
    pub fn symbol_table_get(&self, table: SymbolTableId, name: &[u8]) -> SymbolId {
        match self.table_of(table.0) {
            Some(t) => t.bound.symbol_table_get(t.first, table, name),
            None => SymbolId::NIL,
        }
    }
    pub fn flow_node(&self, flow: FlowNodeId) -> FlowNodeRec {
        match self.table_of(flow.0) {
            Some(t) => t.bound.flow_node(t.first, flow),
            None => FlowNodeRec::default(),
        }
    }
    pub fn flow_list(&self, list: FlowListId) -> FlowListRec {
        match self.table_of(list.0) {
            Some(t) => t.bound.flow_list(t.first, list),
            None => FlowListRec::default(),
        }
    }
}
