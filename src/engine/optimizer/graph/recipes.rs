//! Objects that the code has not made, and that whoever takes over from it has to.
//!
//! A state has them after the values of its registers, one after the other: a position in `Graph::recipes`, and then
//! the words that the recipe asks for. A `Format::Virtual` is the position in the state at which its object starts.

use bun_engine_codegen::ir::{State, Value as Ssa};
use bun_engine_vm::{CellType, JsCell, PropertyOffset, SpeculatedType};

use super::{Graph, Kind, Layout, NO_LAYOUT};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Recipe {
    pub(crate) header: u64,
    /// From the `Vm` to the `Allocator`.
    pub(crate) allocator: i32,
    /// What the state has nothing for is zero.
    pub(crate) size: u32,
    /// From the start of the cell to the first word that the state has.
    pub(crate) first_offset: u8,
    pub(crate) inline_words: u8,
    pub(crate) out_of_line_words: u8,
    pub(crate) out_of_line_capacity: u8,
}

/// From the storage to the slot at a position among those that it has.
pub(crate) fn out_of_line_offset(position: usize) -> i32 {
    PropertyOffset::new(PropertyOffset::FIRST_OUT_OF_LINE + position as i32).byte_offset() as i32
}

impl Recipe {
    pub(crate) fn word_count(self) -> usize {
        usize::from(self.inline_words) + usize::from(self.out_of_line_words)
    }

    /// For each word: from the cell or, if negative, from its storage.
    pub(crate) fn offsets(self) -> impl Iterator<Item = i32> {
        let inline = (i32::from(self.first_offset)..).step_by(8);
        (inline.take(self.inline_words.into()))
            .chain((0..self.out_of_line_words.into()).map(out_of_line_offset))
    }

    pub(crate) fn ty(self) -> SpeculatedType {
        let cell_type = self.header.to_le_bytes()[JsCell::OFFSET_OF_TYPE];
        SpeculatedType::of_cell_type(CellType(cell_type))
    }
}

impl Graph {
    /// One that no code takes over from. It has the empty value for an object that has not been made.
    pub(crate) fn has_state_for_walks(&self, value: Ssa) -> bool {
        self.kind(value).is_some_and(|kind| {
            kind == Kind::InlineEntry
                || kind.can_throw() && !self.site(self.function.origin(value)).has_handler
        })
    }

    /// Its own, and that of what it may turn into.
    pub(crate) fn states_for(&self, value: Ssa) -> [State; 2] {
        let for_handler = match self.kind(value) {
            Some(kind) if kind.may_come_to_throw() => {
                self.site(self.function.origin(value)).state_for_handler
            }
            _ => State::NONE,
        };
        [self.function.state_of(value), for_handler]
    }

    /// The innermost first, each with the position of its first value.
    pub(crate) fn layouts_of(&self, state: State) -> impl Iterator<Item = (usize, &Layout)> {
        let layout = |index| (index != NO_LAYOUT).then(|| &self.layouts[index as usize]);
        let innermost = layout(self.function.state_layout(state));
        let chain = core::iter::successors(innermost, move |it| layout(it.caller));
        let registers: usize = chain.clone().map(|it| it.register_count as usize).sum();
        chain.scan(registers, |end, layout| {
            *end -= layout.register_count as usize;
            Some((*end, layout))
        })
    }

    /// The positions of what scripts can get hold of by looking at the stack.
    pub(crate) fn shown_in(&self, state: State) -> impl Iterator<Item = usize> {
        self.layouts_of(state).flat_map(|(first, layout)| {
            let shows = self.frame_at(layout.resume).shows;
            let registers = &self.layout_registers[layout.first_register as usize..];
            let own = (first..).zip(&registers[..layout.register_count as usize]);
            own.filter(move |it| shows.includes(*it.1)).map(|it| it.0)
        })
    }

    pub(crate) fn add_recipe(&mut self, recipe: Recipe) -> u32 {
        const COMPARED: usize = 16;
        let first = self.recipes.len().saturating_sub(COMPARED);
        let known = self.recipes[first..].iter().position(|&it| it == recipe);
        known.map_or_else(
            || {
                self.recipes.push(recipe);
                self.recipes.len() - 1
            },
            |position| first + position,
        ) as u32
    }
}
