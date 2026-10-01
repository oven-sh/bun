// The nodes that one context makes: a file under construction, or the synthetic nodes of one checker.
// Everything is written through a shared reference and nothing moves, so ids, lists and texts stay valid.
use crate::ast::ast_generated::Def;
use crate::ast::flags_generated::{ModifierFlags, NodeFlags};
use crate::ast::kind_generated::Kind;
use crate::core::TextRange;
use crate::ids::{NodeId, NodeListId, SYNTH};
use crate::stable::{StableCells, StableVec};
use bun_collections::StringHashMap;
use std::cell::Cell;

// kind and struct, flags, pos, end, parent, first slot, list of JSDoc nodes.
pub(crate) const REC_WORDS: usize = 7;
const LIST_WORDS: usize = 4;

#[derive(Clone, Copy)]
pub struct ArenaMark {
    recs: u32,
    slots: u32,
    lists: u32,
}

pub struct NodeArena {
    recs: StableCells,
    slots: StableCells,
    lists: StableCells,
    list_store: StableVec<Box<[NodeId]>>,
    text_store: StableVec<Box<[u8]>>,
    interned: Cell<StringHashMap<u32>>,
    text_bytes: Cell<usize>,
}

impl NodeArena {
    pub fn new() -> Self {
        Self {
            recs: StableCells::new(REC_WORDS as u32 * 256),
            slots: StableCells::new(1024),
            lists: StableCells::new(LIST_WORDS as u32 * 256),
            list_store: StableVec::new(),
            text_store: StableVec::new(),
            interned: Cell::new(StringHashMap::new()),
            text_bytes: Cell::new(0),
        }
    }
    pub fn node_count(&self) -> u32 {
        self.recs.len() / REC_WORDS as u32
    }
    pub fn list_count(&self) -> u32 {
        self.lists.len() / LIST_WORDS as u32
    }
    // A point to which `rewind` returns: the nodes and lists made after it are forgotten, their ids are reused.
    pub fn mark(&self) -> ArenaMark {
        ArenaMark {
            recs: self.recs.len(),
            slots: self.slots.len(),
            lists: self.lists.len(),
        }
    }
    pub fn rewind(&self, mark: ArenaMark) {
        self.recs.truncate(mark.recs);
        self.slots.truncate(mark.slots);
        self.lists.truncate(mark.lists);
    }
    pub fn heap_bytes(&self) -> usize {
        (self.recs.len() as usize + self.slots.len() as usize + self.lists.len() as usize) * 4
            + self.list_store.len() as usize * 16
            + self.text_store.len() as usize * 16
            + self.text_bytes.get()
    }
    #[inline]
    pub(crate) fn rec(&self, id: u32) -> Option<&[Cell<u32>]> {
        let index = (id & !SYNTH).wrapping_sub(1);
        self.recs
            .run(index.checked_mul(REC_WORDS as u32)?, REC_WORDS)
    }
    #[inline]
    pub(crate) fn payload(&self, rec: &[Cell<u32>], n: usize) -> &[Cell<u32>] {
        match rec.get(5) {
            Some(data) if n != 0 => self.slots.run(data.get(), n).unwrap_or(&[]),
            _ => &[],
        }
    }
    #[inline]
    fn list_rec(&self, id: u32) -> Option<&[Cell<u32>]> {
        let index = (id & !SYNTH).wrapping_sub(1);
        self.lists
            .run(index.checked_mul(LIST_WORDS as u32)?, LIST_WORDS)
    }
    pub(crate) fn list_nodes(&self, id: u32) -> Option<&[NodeId]> {
        let rec = self.list_rec(id)?;
        Some(self.list_store.get(rec.get(2)?.get())?)
    }
    pub(crate) fn list_loc(&self, id: u32) -> Option<TextRange> {
        let rec = self.list_rec(id)?;
        Some(crate::core::new_text_range(
            rec.first()?.get() as i32,
            rec.get(1)?.get() as i32,
        ))
    }
    pub(crate) fn set_list_loc(&self, id: u32, loc: TextRange) -> bool {
        let Some(rec) = self.list_rec(id) else {
            return false;
        };
        if let (Some(pos), Some(end)) = (rec.first(), rec.get(1)) {
            pos.set(loc.pos() as u32);
            end.set(loc.end() as u32);
        }
        true
    }
    pub(crate) fn list_modifier_flags(&self, id: u32) -> Option<ModifierFlags> {
        Some(ModifierFlags::from_bits_retain(
            self.list_rec(id)?.get(3)?.get(),
        ))
    }
    pub(crate) fn text(&self, handle: u32) -> &[u8] {
        match handle.checked_sub(1).and_then(|i| self.text_store.get(i)) {
            Some(text) => text,
            None => &[],
        }
    }

    pub(crate) fn new_node(&self, kind: Kind, def: Def, slots: &[u32]) -> NodeId {
        let data = if slots.is_empty() {
            Some(0)
        } else {
            self.slots.push_run(slots)
        };
        let Some(data) = data else {
            return NodeId::NIL;
        };
        let undefined = crate::core::undefined_text_range();
        let words = [
            kind as u32 | (def as u32) << 16,
            0,
            undefined.pos() as u32,
            undefined.end() as u32,
            0,
            data,
            0,
        ];
        match self.recs.push_run(&words) {
            Some(start) => match (start / REC_WORDS as u32).checked_add(1) {
                Some(index) if index & SYNTH == 0 => NodeId(index | SYNTH),
                _ => NodeId::NIL,
            },
            None => NodeId::NIL,
        }
    }
    pub(crate) fn new_list(
        &self,
        nodes: &[NodeId],
        loc: TextRange,
        modifier_flags: ModifierFlags,
    ) -> NodeListId {
        let Some(items) = self.list_store.push(nodes.into()) else {
            return NodeListId::NIL;
        };
        let words = [
            loc.pos() as u32,
            loc.end() as u32,
            items,
            modifier_flags.bits(),
        ];
        match self.lists.push_run(&words) {
            Some(start) => match (start / LIST_WORDS as u32).checked_add(1) {
                Some(index) if index & SYNTH == 0 => NodeListId(index | SYNTH),
                _ => NodeListId::NIL,
            },
            None => NodeListId::NIL,
        }
    }
    // Returns the handle of a text, one handle per distinct text.
    pub(crate) fn new_text(&self, text: &[u8]) -> u32 {
        if text.is_empty() {
            return 0;
        }
        let mut interned = self.interned.take();
        let mut handle = 0;
        if let Ok(entry) = interned.get_or_put(text) {
            if entry.found_existing {
                handle = *entry.value_ptr;
            } else if let Some(index) = self.text_store.push(text.into()) {
                handle = index + 1;
                *entry.value_ptr = handle;
                self.text_bytes.set(self.text_bytes.get() + text.len());
            }
        }
        self.interned.set(interned);
        handle
    }
    pub(crate) fn set_jsdoc(&self, host: NodeId, list: NodeListId) -> bool {
        match self.rec(host.0).and_then(|rec| rec.get(6)) {
            Some(word) => {
                word.set(list.0);
                true
            }
            None => false,
        }
    }
    pub(crate) fn jsdoc_of(&self, host: NodeId) -> NodeListId {
        NodeListId(self.rec(host.0).map_or(0, |rec| rec_word(rec, 6)))
    }
}

#[inline]
pub(crate) fn rec_kind(rec: &[Cell<u32>]) -> u16 {
    rec.first().map_or(0, |w| w.get() as u16)
}
#[inline]
pub(crate) fn rec_def(rec: &[Cell<u32>]) -> u8 {
    rec.first().map_or(0, |w| (w.get() >> 16) as u8)
}
#[inline]
pub(crate) fn rec_word(rec: &[Cell<u32>], at: usize) -> u32 {
    rec.get(at).map_or(0, Cell::get)
}
#[inline]
pub(crate) fn rec_flags(rec: &[Cell<u32>]) -> NodeFlags {
    NodeFlags::from_bits_retain(rec_word(rec, 1))
}
