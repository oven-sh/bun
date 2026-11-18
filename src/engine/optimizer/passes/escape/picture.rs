//! What is known at one place of the objects that are followed.

use bun_engine_codegen::ir::{Entity, Value as Ssa};

use crate::graph::ShapeIndex;

/// The number of the instruction that makes the object. Where objects meet, that of the first stands for them all.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) struct Id(pub(super) u16);

impl Id {
    pub(super) fn index(self) -> usize {
        self.0.into()
    }
}

/// What is in an object that has not been made.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Word(u32);

impl Word {
    /// It depends on the way here, and there is no parameter for it yet.
    pub(super) const UNKNOWN: Self = Self(u32::MAX);
    const OBJECT: u32 = 1 << 31;

    pub(super) fn value(value: Ssa) -> Self {
        Self(value.index() as u32)
    }

    pub(super) fn object(id: Id) -> Self {
        Self(Self::OBJECT | u32::from(id.0))
    }

    pub(super) fn as_object(self) -> Option<Id> {
        (self.0 >> u16::BITS == Self::OBJECT >> u16::BITS).then_some(Id(self.0 as u16))
    }

    pub(super) fn as_value(self) -> Option<Ssa> {
        (self.0 < Self::OBJECT).then(|| Ssa::from_index(self.0 as usize))
    }
}

#[derive(Clone, Copy)]
pub(super) struct Entry {
    pub(super) id: Id,
    /// `NONE` until it is made. What follows is of no use from then on, except the stamp.
    pub(super) made: Ssa,
    pub(super) shape: ShapeIndex,
    /// Two with the same say the same.
    pub(super) stamp: u32,
    pub(super) first_word: u32,
    /// Those of the cell after the header, and then the slots of the storage.
    pub(super) word_count: u8,
}

impl Entry {
    pub(super) fn is_virtual(&self) -> bool {
        self.made.is_none()
    }
}

/// A set of positions among the entries, or among the words of one.
pub(super) type Positions = u64;

pub(super) const MOST_ENTRIES: usize = Positions::BITS as usize;

pub(super) fn members(set: Positions) -> impl Iterator<Item = usize> {
    core::iter::successors((set != 0).then_some(set), |&rest| {
        Some(rest & (rest - 1)).filter(|&rest| rest != 0)
    })
    .map(|rest| rest.trailing_zeros() as usize)
}

#[derive(Clone, Default)]
pub(super) struct Picture {
    pub(super) entries: Vec<Entry>,
    pub(super) words: Vec<Word>,
}

impl Picture {
    pub(super) fn clear(&mut self) {
        self.entries.clear();
        self.words.clear();
    }

    pub(super) fn has_virtual(&self) -> bool {
        self.entries.iter().any(Entry::is_virtual)
    }

    pub(super) fn position(&self, id: Id) -> usize {
        let found = self.entries.iter().position(|entry| entry.id == id);
        found.expect("kept while something points to it")
    }

    pub(super) fn entry(&self, id: Id) -> &Entry {
        &self.entries[self.position(id)]
    }

    pub(super) fn words_at(&self, position: usize) -> &[Word] {
        let entry = &self.entries[position];
        &self.words[entry.first_word as usize..][..entry.word_count.into()]
    }

    pub(super) fn words_at_mut(&mut self, position: usize) -> &mut [Word] {
        let entry = &self.entries[position];
        &mut self.words[entry.first_word as usize..][..entry.word_count.into()]
    }

    /// Of a word that is known, and is no object that has not been made.
    pub(super) fn value_of(&self, word: Word) -> Ssa {
        let made = || self.entry(word.as_object()?).made.expand();
        word.as_value().or_else(made).expect("at hand")
    }

    /// With all that they lead to.
    pub(super) fn reachable_from(&self, roots: Positions) -> Positions {
        let (mut found, mut pending) = (roots, roots);
        while pending != 0 {
            let position = pending.trailing_zeros() as usize;
            pending &= pending - 1;
            for id in self
                .words_at(position)
                .iter()
                .filter_map(|it| it.as_object())
            {
                let bit = 1 << self.position(id);
                pending |= bit & !found;
                found |= bit;
            }
        }
        found
    }

    pub(super) fn copy_part(&self, part: Positions, into: &mut Picture) {
        into.clear();
        for position in members(part) {
            into.entries.push(Entry {
                first_word: into.words.len() as u32,
                ..self.entries[position]
            });
            into.words.extend_from_slice(self.words_at(position));
        }
    }
}
