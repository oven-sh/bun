//! The code that makes what has been put off.

use bun_engine_codegen::ir::{Access, AccessFlags, Builder, Edge, State, Type, Value as Ssa};
use bun_engine_vm::JsObject;
use smallvec::SmallVec;

use super::picture::{Id, Positions, Word, members};
use super::{Arrival, Sinking};
use crate::graph::{Allocation, Gives, Kind, Transition, heaps};

/// Stores that may belong together, so that the collector has to be kept out: up to a barrier, or until what has been
/// allocated is complete. They are all to one object, so the picture is as it was at the start.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Run {
    None,
    From(Ssa),
    /// It starts where this is made.
    Filling(Id),
}

impl Sinking<'_> {
    /// With all that it leads to, unless it is there.
    pub(super) fn make(&mut self, id: Id) -> Ssa {
        let position = self.now.position(id);
        if self.now.entries[position].is_virtual() {
            let reached = members(self.now.reachable_from(1 << position));
            let missing = reached.filter(|&it| self.now.entries[it].is_virtual());
            let missing = missing.fold(0, |all, it| all | 1 << it);
            let place = self.before;
            if let Run::From(start) = self.run {
                self.before = start;
            }
            self.make_all(missing);
            self.before = place;
            if self.run == Run::Filling(id) {
                self.run = Run::From(self.now.entries[position].made);
            }
        }
        self.now.entries[position].made
    }

    /// For an instruction that stays.
    pub(super) fn extend_run(&mut self, value: Ssa, kind: Option<Kind>) {
        let writes = match kind {
            Some(Kind::StoreBarrier) => return self.run = Run::None,
            Some(Kind::GrowSlots | Kind::SearchForStore | Kind::SetShape) => true,
            Some(kind) => kind.allocates(),
            None => self.graph.function.effects(value).writes_memory(),
        };
        if writes && !matches!(self.run, Run::From(_)) {
            self.run = Run::From(value);
        }
    }

    /// For what is done to the picture alone.
    pub(super) fn end_run_unless_filling(&mut self, id: Id) {
        if self.run != Run::Filling(id) {
            self.run = Run::None;
        }
    }

    pub(super) fn make_with_storage(&mut self, id: Id) -> Ssa {
        let object = self.make(id);
        match self.is_on_trial() {
            true => object,
            false => self.load_storage(object),
        }
    }

    pub(super) fn make_on_the_way(&mut self, arrival: &mut Arrival, id: Id) {
        if arrival.picture.entry(id).is_virtual() {
            self.stand_on(&mut arrival.edge);
            core::mem::swap(&mut self.now, &mut arrival.picture);
            self.make(id);
            core::mem::swap(&mut self.now, &mut arrival.picture);
        }
    }

    fn stand_on(&mut self, edge: &mut Edge) {
        self.run = Run::None;
        if self.is_on_trial() {
            return;
        }
        let function = &mut self.graph.function;
        if function.successors(function.source(*edge)).len() > 1 {
            let middle = function.split_edge(*edge);
            *edge = function.successor(middle, 0);
            self.changed_control_flow = true;
        }
        self.before = function.last(function.source(*edge));
    }

    fn is_among(&self, word: Word, positions: Positions) -> bool {
        (word.as_object()).is_some_and(|id| positions >> self.now.position(id) & 1 != 0)
    }

    /// One that has all that goes into it or, where they form a cycle, at least what it cannot be made without.
    fn next_to_make(&self, missing: Positions) -> usize {
        let is_ready = |&position: &usize| {
            let (mut words, others) = (self.now.words_at(position).iter(), !(1 << position));
            !words.any(|&word| self.is_among(word, missing & others))
        };
        let is_possible = |&position: &usize| {
            let words = self.now.words_at(position);
            let mut fixed = self
                .object(self.now.entries[position].id)
                .fixed_words()
                .iter();
            !fixed.any(|&word| self.is_among(words[word], missing))
        };
        (members(missing).find(is_ready))
            .or_else(|| members(missing).find(is_possible))
            .expect("a scope is older than what it is the scope of")
    }

    fn make_all(&mut self, mut missing: Positions) {
        let all = missing;
        let mut put_off: SmallVec<[(usize, usize); 4]> = SmallVec::new();
        while missing != 0 && !self.is_on_trial() {
            let position = self.next_to_make(missing);
            missing &= !(1 << position);
            self.emit(position, missing, &mut put_off);
        }
        for (position, word) in put_off {
            let made = self.now.entries[position].made;
            let storage = match word < self.object(self.now.entries[position].id).inline_words {
                true => Ssa::NONE,
                false => self.load_storage(made),
            };
            let stored = self.emit_store(position, word, storage);
            self.node(Kind::StoreBarrier, &[made, stored], 0);
        }
        for position in members(all) {
            let (stamp, id) = (self.new_stamp(), self.now.entries[position].id);
            if self.is_on_trial() {
                self.now.entries[position].made = self.object(id).node;
            }
            let entry = &mut self.now.entries[position];
            (entry.stamp, entry.word_count) = (stamp, 0);
        }
    }

    fn emit(
        &mut self,
        position: usize,
        missing: Positions,
        put_off: &mut SmallVec<[(usize, usize); 4]>,
    ) {
        let entry = self.now.entries[position];
        let object = self.object(entry.id);
        let (kind, fixed, is_cleared) = (object.kind, object.fixed_words(), object.is_cleared());
        let (mut data, count) = (object.allocation, usize::from(entry.word_count));
        let has_slots_outside = count > object.inline_words;
        let (allocation, words) = (
            self.graph.allocations[data as usize],
            self.now.words_at(position),
        );
        let operands: SmallVec<[Ssa; 2]> = (fixed.iter())
            .map(|&word| self.now.value_of(words[word]))
            .collect();
        if allocation.shape != entry.shape && !has_slots_outside {
            data = self.graph.allocations.len() as u32;
            self.graph.allocations.push(Allocation {
                shape: entry.shape,
                ..allocation
            });
        }
        let made = self.node(kind, &operands, data);
        self.now.entries[position].made = made;
        let (mut storage, transition) = (Ssa::NONE, self.graph.transitions.len() as u32);
        if has_slots_outside {
            let (from, to) = (allocation.shape, entry.shape);
            self.graph.transitions.push(Transition { from, to });
            storage = self.node(Kind::GrowSlots, &[made], transition);
        }
        for word in (0..count).filter(|it| !fixed.contains(it)) {
            let content = self.now.words_at(position)[word];
            if self.is_among(content, missing) {
                put_off.push((position, word));
                if !is_cleared {
                    self.now.words_at_mut(position)[word] = self.empty;
                    self.emit_store(position, word, storage);
                    self.now.words_at_mut(position)[word] = content;
                }
            } else if content != self.empty || !is_cleared {
                self.emit_store(position, word, storage);
            }
        }
        if has_slots_outside {
            self.node(Kind::SetShape, &[made], transition);
            self.node(Kind::StoreBarrier, &[made], 0);
        }
    }

    /// Gives what is stored.
    fn emit_store(&mut self, position: usize, word: usize, storage: Ssa) -> Ssa {
        let entry = self.now.entries[position];
        let object = self.object(entry.id);
        let (offset, heap) = (object.offset_of(word), object.heap_of(word));
        let stored = self.now.value_of(self.now.words_at(position)[word]);
        let base = if offset > 0 { entry.made } else { storage };
        self.ir().store(stored, base, offset, heap);
        stored
    }

    fn load_storage(&mut self, object: Ssa) -> Ssa {
        let access = Access::new(heaps::STORAGE, AccessFlags::ALWAYS_READABLE);
        let offset = JsObject::OFFSET_OF_STORAGE as i32;
        self.ir().load(Type::I64, object, offset, access)
    }

    fn node(&mut self, kind: Kind, operands: &[Ssa], data: u32) -> Ssa {
        let ty = kind.gives().machine_type();
        let value = self.ir().node(kind.id(), ty, operands, data, State::NONE);
        if let Gives::Value(ty) = kind.gives() {
            self.graph.predict(value, ty);
        }
        value
    }

    fn ir(&mut self) -> Builder<'_> {
        Builder::before(&mut self.graph.function, self.before)
    }
}
