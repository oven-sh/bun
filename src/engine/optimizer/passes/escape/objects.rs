//! What the kinds of objects are made of.

use bun_engine_codegen::ir::{Heap, Value as Ssa};
use bun_engine_vm::{Environment, JsFunction, JsObject};
use smallvec::SmallVec;

use crate::graph::{Graph, Kind, heaps, out_of_line_offset};

/// One bit of a `Positions` is left.
pub(super) const MOST_WORDS: usize = 63;

pub(super) fn is_made_by(kind: Kind) -> bool {
    matches!(kind, Kind::NewObject | Kind::NewScope | Kind::NewFunction)
}

const fn word_at(offset: usize) -> usize {
    offset / 8 - 1
}

pub(super) const EXECUTABLE: usize = word_at(JsFunction::OFFSET_OF_EXECUTABLE);
const STORAGE: usize = word_at(JsObject::OFFSET_OF_STORAGE);

#[derive(Clone)]
pub(super) struct Object {
    /// The node, which stands for the object once a trial has found it necessary to make it.
    pub(super) node: Ssa,
    pub(super) kind: Kind,
    pub(super) allocation: u32,
    pub(super) inline_words: usize,
    /// For each word, what it has been stored as.
    heaps: SmallVec<[Heap; 8]>,
}

pub(super) enum Part {
    Storage,
    Word(usize),
}

impl Object {
    pub(super) fn new(graph: &Graph, node: Ssa, kind: Kind, allocation: u32) -> Self {
        Self {
            node,
            kind,
            allocation,
            inline_words: word_at(graph.allocations[allocation as usize].size as usize),
            heaps: SmallVec::new(),
        }
    }

    /// The words that the operands of the node go to. They never change.
    pub(super) fn fixed_words(&self) -> &'static [usize] {
        const OF_SCOPE: [usize; 2] = [
            word_at(Environment::OFFSET_OF_PARENT),
            word_at(Environment::OFFSET_OF_TEMPLATE),
        ];
        const OF_FUNCTION: [usize; 2] = [word_at(JsFunction::OFFSET_OF_SCOPE), EXECUTABLE];
        match self.kind {
            Kind::NewScope => &OF_SCOPE,
            Kind::NewFunction => &OF_FUNCTION,
            _ => &[],
        }
    }

    /// Objects that differ in it have too little in common to be taken for one.
    pub(super) fn telling_word(&self) -> Option<usize> {
        self.fixed_words().last().copied()
    }

    pub(super) fn has_storage(&self) -> bool {
        self.kind != Kind::NewScope
    }

    /// Whether the node leaves the other words empty.
    pub(super) fn is_cleared(&self) -> bool {
        self.kind != Kind::NewScope
    }

    pub(super) fn part_in_cell(&self, offset: i32) -> Option<Part> {
        let offset = usize::try_from(offset).ok();
        let word = word_at(offset.filter(|it| it % 8 == 0 && *it != 0)?);
        if word == STORAGE && self.has_storage() {
            return Some(Part::Storage);
        }
        (word < self.inline_words).then_some(Part::Word(word))
    }

    pub(super) fn part_in_storage(&self, offset: i32, word_count: usize) -> Option<Part> {
        let distance = usize::try_from(out_of_line_offset(0).checked_sub(offset)?).ok();
        let word = self.inline_words + distance.filter(|it| it % 8 == 0)? / 8;
        (word < word_count).then_some(Part::Word(word))
    }

    /// From the cell or, if negative, from the storage.
    pub(super) fn offset_of(&self, word: usize) -> i32 {
        match word.checked_sub(self.inline_words) {
            Some(position) => out_of_line_offset(position),
            None => (word as i32 + 1) * 8,
        }
    }

    fn any_heap(&self) -> Heap {
        match self.kind {
            Kind::NewScope => heaps::SCOPE_SLOTS,
            _ => heaps::NAMED,
        }
    }

    pub(super) fn heap_of(&self, word: usize) -> Heap {
        let known = self.heaps.get(word).filter(|&&it| it != Heap::NOTHING);
        known.map_or_else(|| self.any_heap(), |&it| it)
    }

    pub(super) fn note_store(&mut self, word: usize, heap: Heap) {
        if self.heaps.len() <= word {
            self.heaps.resize(word + 1, Heap::NOTHING);
        }
        if self.heaps[word] == Heap::NOTHING {
            self.heaps[word] = heap;
        } else if self.heaps[word] != heap {
            self.heaps[word] = self.any_heap();
        }
    }

    pub(super) fn stand_for(&mut self, other: &Object) {
        let stored = other.heaps.iter().enumerate();
        for (word, &heap) in stored.filter(|it| *it.1 != Heap::NOTHING) {
            self.note_store(word, heap);
        }
    }
}
