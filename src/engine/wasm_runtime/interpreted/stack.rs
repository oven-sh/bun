//! Where functions keep their locals and operands.

use core::cell::Cell;
use core::ops::Range;
use core::{ptr, slice};

use bun_engine_wasm_format::{ValKind, ValType};

use super::Context;
use crate::memory::system;

pub const WINDOW: usize = (1 << 16) + 16;

/// From the first of a frame. An index of 16 bits needs no check, nor do the slots right after it.
pub type Slots = [Cell<u64>; WINDOW];

const SLOT_SIZE: usize = size_of::<u64>();
const LARGEST_PAGE: usize = 64 << 10;

/// A `v128` takes two.
pub fn slot_count(types: &[ValType]) -> usize {
    types.len() + types.iter().filter(|ty| ty.kind() == ValKind::V128).count()
}

pub(crate) struct ValueStack {
    start: usize,
    size: usize,
    /// How many the collector has to look at, and a call from the host has to leave alone.
    in_use: Cell<usize>,
}

impl ValueStack {
    /// Frames can start in the first `size` bytes.
    pub(crate) fn new(size: usize) -> Option<Self> {
        let size = (size + size_of::<Slots>()).next_multiple_of(LARGEST_PAGE);
        let stack = Self {
            start: system::reserve(size)?,
            size,
            in_use: Cell::new(0),
        };
        // SAFETY: the whole reservation.
        unsafe { system::commit(stack.start, size) }.then_some(stack)
    }

    #[inline]
    pub(super) fn all(&self) -> &[Cell<u64>] {
        let first = ptr::with_exposed_provenance(self.start);
        // SAFETY: committed, and so zero at first.
        unsafe { slice::from_raw_parts(first, self.size / SLOT_SIZE) }
    }

    #[inline]
    pub(super) fn in_use(&self) -> &Cell<usize> {
        &self.in_use
    }

    pub(crate) fn addresses_in_use(&self) -> Range<usize> {
        self.start..self.start + self.in_use.get() * SLOT_SIZE
    }
}

impl Drop for ValueStack {
    fn drop(&mut self) {
        // SAFETY: the reservation that `new` made.
        unsafe { system::release(self.start, self.size) };
    }
}

impl<'a> Context<'a> {
    #[inline(always)]
    pub(super) fn index_of(&self, slots: &Slots) -> usize {
        slots
            .as_ptr()
            .addr()
            .wrapping_sub(self.values.as_ptr().addr())
            / SLOT_SIZE
    }

    /// Those of a frame that starts at slot `first` of another. `None` if there is no room.
    #[inline(always)]
    pub fn window(&self, slots: &Slots, first: u32) -> Option<&'a Slots> {
        let start = self.index_of(slots) + first as usize;
        self.values.get(start..start + WINDOW)?.first_chunk()
    }

    /// Slots of a frame, near or far. `None` if there is no room.
    #[inline(always)]
    pub fn range(&self, slots: &Slots, first: u32, count: usize) -> Option<&'a [Cell<u64>]> {
        let start = self.index_of(slots) + first as usize;
        self.values.get(start..)?.get(..count)
    }

    /// Before whatever may collect garbage or call back: what counts is in the first `count` slots of the innermost
    /// frame and below.
    #[inline(always)]
    pub fn keep(&self, slots: &Slots, count: usize) {
        let end = self.index_of(slots).saturating_add(count);
        self.in_use.set(end.min(self.values.len()));
    }
}
