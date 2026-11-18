//! States as they have to be at the place of an instruction that has one.

use core::ops::Range;

use bun_engine_codegen::ir::{Function, Origin, State, Table, Value as Ssa};
use bun_engine_vm::JsObject;
use smallvec::SmallVec;

use super::picture::{Id, Word};
use super::{Meaning, Sinking};
use crate::graph::{Format, Kind, Recipe, Site};

#[derive(Clone)]
struct Latest {
    state: State,
    /// In `Descriptions::stamps`.
    rests_on: Range<u32>,
}

pub(super) struct Descriptions {
    latest: Table<State, Latest>,
    stamps: Vec<(Id, u32)>,
    values: Vec<Ssa>,
    references: Vec<u32>,
}

impl Descriptions {
    pub(super) fn new(function: &Function) -> Self {
        let none = Latest {
            state: State::NONE,
            rests_on: 0..0,
        };
        Self {
            latest: Table::filled(function.state_count(), none),
            stamps: Vec::new(),
            values: Vec::new(),
            references: Vec::new(),
        }
    }
}

struct Described {
    id: Id,
    start: usize,
    recipe: Recipe,
}

impl Sinking<'_> {
    pub(super) fn update_state(&mut self, value: Ssa, kind: Option<Kind>) {
        let [state, for_handler] = self.graph.states_for(value);
        if self.pointers.are_in(for_handler) && !self.is_on_trial() {
            self.update_state_for_handler(value, for_handler);
        }
        if !self.pointers.are_in(state) {
            return;
        }
        if kind.is_some_and(Kind::shows_stack) {
            self.make_what_is_shown(state);
        }
        if !self.is_on_trial() {
            let state = self.describe(state, self.graph.has_state_for_walks(value));
            self.graph.function.set_state_of(value, state);
        }
    }

    /// Other nodes of the instruction may find things otherwise, so this one gets a site of its own.
    fn update_state_for_handler(&mut self, value: Ssa, state: State) {
        let state_for_handler = self.describe(state, false);
        if state_for_handler != state {
            let site = *self.graph.site(self.graph.function.origin(value));
            let origin = Origin(self.graph.sites.len() as u32);
            self.graph.function.set_origin(value, origin);
            self.graph.sites.push(Site {
                state_for_handler,
                ..site
            });
        }
    }

    fn make_what_is_shown(&mut self, state: State) {
        let shown = self.graph.shown_in(state);
        let held = shown.map(|position| self.graph.function.state(state)[position]);
        let ids: SmallVec<[Id; 4]> = held.filter_map(|it| self.object_behind(it)).collect();
        for id in ids {
            self.make(id);
        }
    }

    fn describe(&mut self, original: State, is_for_walks: bool) -> State {
        let Latest { state, rests_on } = self.descriptions.latest[original].clone();
        let stamps = &self.descriptions.stamps[rests_on.start as usize..rests_on.end as usize];
        let holds = |&(id, stamp): &(Id, u32)| {
            (self.now.entries.iter()).any(|it| it.id == id && it.stamp == stamp)
        };
        if !state.is_none() && stamps.iter().all(holds) {
            return state;
        }
        let first_stamp = self.descriptions.stamps.len();
        let mut described: SmallVec<[Described; 4]> = SmallVec::new();
        let registers = self.graph.function.state(original).len();
        self.descriptions.values.clear();
        self.descriptions.references.clear();
        for position in 0..registers {
            let held = self.graph.function.state(original)[position];
            let word = match self.meaning(held) {
                Meaning::Object(id) if is_for_walks && self.now.entry(id).is_virtual() => {
                    self.rest_on(id, first_stamp);
                    self.empty
                }
                Meaning::Object(id) => Word::object(id),
                _ => Word::value(held),
            };
            self.hold(word, &mut described, registers, first_stamp);
        }
        let mut next = 0;
        while let Some(&Described { id, recipe, .. }) = described.get(next) {
            let number = self.graph.add_recipe(recipe);
            let number = self.graph.function.const64(number.into());
            self.descriptions.values.push(number);
            let (position, outside) = (self.now.position(id), self.object(id).inline_words);
            let first = usize::from(recipe.first_offset) / 8 - 1;
            let words = (first..first + usize::from(recipe.inline_words))
                .chain(outside..outside + usize::from(recipe.out_of_line_words));
            for word in words {
                let word = self.now.words_at(position)[word];
                self.hold(word, &mut described, registers, first_stamp);
            }
            next += 1;
        }
        let (function, found) = (&mut self.graph.function, &mut self.descriptions);
        let state = if found.stamps.len() == first_stamp {
            original
        } else {
            let layout = function.state_layout(original);
            function.add_described_state(found.values.iter().copied(), layout)
        };
        for &position in &found.references {
            let start = found.values[position as usize];
            function.retag(state, position as usize, start, Format::Virtual as u8);
        }
        let rests_on = first_stamp as u32..found.stamps.len() as u32;
        found.latest[original] = Latest { state, rests_on };
        state
    }

    fn rest_on(&mut self, id: Id, first_stamp: usize) {
        let stamp = (id, self.now.entry(id).stamp);
        if !self.descriptions.stamps[first_stamp..].contains(&stamp) {
            self.descriptions.stamps.push(stamp);
        }
    }

    fn hold(
        &mut self,
        word: Word,
        described: &mut SmallVec<[Described; 4]>,
        registers: usize,
        first_stamp: usize,
    ) {
        let id = word
            .as_object()
            .inspect(|&id| self.rest_on(id, first_stamp));
        let Some(id) = id.filter(|&id| self.now.entry(id).is_virtual()) else {
            return self.descriptions.values.push(self.now.value_of(word));
        };
        let known = described.iter().find(|it| it.id == id);
        let start = known.map(|it| it.start).unwrap_or_else(|| {
            let last = described.last();
            let start = last.map_or(registers, |it| it.start + 1 + it.recipe.word_count());
            let recipe = self.recipe_for(id);
            described.push(Described { id, start, recipe });
            start
        });
        let found = &mut self.descriptions;
        found.references.push(found.values.len() as u32);
        found.values.push(self.graph.function.const64(start as i64));
    }

    fn recipe_for(&self, id: Id) -> Recipe {
        let (object, position) = (self.object(id), self.now.position(id));
        let allocation = self.graph.allocations[object.allocation as usize];
        let (inline, outside) = self.now.words_at(position).split_at(object.inline_words);
        let first = match object.has_storage() {
            true => size_of::<JsObject>() / 8 - 1,
            false => 0,
        };
        let in_use = |words: &[Word]| {
            let last = words.iter().rposition(|&it| it != self.empty);
            last.map_or(0, |it| it + 1) as u8
        };
        Recipe {
            header: self.graph.shapes[self.now.entries[position].shape].header,
            allocator: allocation.allocator,
            size: allocation.size,
            first_offset: (first as u8 + 1) * 8,
            inline_words: in_use(&inline[first..]),
            out_of_line_words: in_use(outside),
            out_of_line_capacity: outside.len() as u8,
        }
    }
}
