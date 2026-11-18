//! Destroys what has died and gives memory back, where allocation does not get to it first.

use core::cell::Cell;

use bun_engine_platform::clock;

use super::activity::HeapTimer;
use super::collector::log;
use super::directory::Directory;
use super::{BLOCK_SIZE, Heap, MutatorState, marks};
use crate::options;

const SLICE_SECONDS: f64 = 0.01;
const SECONDS_BETWEEN_SLICES: f64 = 0.1;
/// The empty blocks that are kept are those that it takes to go on allocating at the same pace for that long.
const RESERVE_SECONDS: f64 = 1.0;

#[derive(Default)]
pub(super) struct Sweeper {
    timer: HeapTimer,
    unswept_cursor: Cell<usize>,
    swept_empty_cursor: Cell<usize>,
    sparse_cursor: Cell<usize>,
    surplus: Cell<usize>,
    last_slice_time: Cell<f64>,
    allocated_at_last_slice: Cell<usize>,
}

impl Heap {
    /// False once `step` has said so of every directory.
    fn step_through(&self, cursor: &Cell<usize>, step: impl Fn(&Directory) -> bool) -> bool {
        loop {
            let Some(&allocator) = self.allocators.borrow().get(cursor.get()) else {
                return false;
            };
            if allocator.directory().is_some_and(&step) {
                return true;
            }
            cursor.update(|index| index + 1);
        }
    }

    fn sweep_next_block(&self) -> bool {
        self.step_through(&self.sweeper.unswept_cursor, Directory::sweep_next_block)
    }

    pub(super) fn clear_some_stale_marks(&self) -> bool {
        self.step_through(&self.stale_cursor, Directory::clear_some_stale_marks)
    }

    fn discard_pages_of_next_sparse_block(&self) -> bool {
        let step = Directory::discard_pages_of_next_sparse_block;
        options().discard_unused_pages && self.step_through(&self.sweeper.sparse_cursor, step)
    }

    fn empty_block_count(&self) -> usize {
        let mut count = 0;
        self.for_each_directory(|directory| count += directory.empty_block_count());
        count
    }

    /// False if there is none.
    fn free_next_swept_empty_block(&self) -> bool {
        self.step_through(&self.sweeper.swept_empty_cursor, |directory| {
            let block = directory.take_swept_empty_block();
            if let Some(block) = block {
                self.blocks.borrow_mut().remove(block);
                // SAFETY: empty, and in no directory.
                unsafe { directory.allocator().source.free(block) };
            }
            block.is_some()
        })
    }

    pub(super) fn free_swept_empty_blocks(&self) {
        self.sweeper.swept_empty_cursor.set(0);
        while self.free_next_swept_empty_block() {}
    }

    /// Those that will not be filled before the next collection.
    pub(super) fn note_surplus_of_empty_blocks(&self) {
        let needed = self.policy.remaining() / BLOCK_SIZE;
        (self.sweeper.surplus).set(self.empty_block_count().saturating_sub(needed));
    }

    /// For a program that leaves no time for timers.
    #[inline]
    pub(super) fn free_some_surplus_blocks(&self) {
        const AT_A_TIME: usize = 32;
        let surplus = self.sweeper.surplus.get();
        for _ in 0..surplus.min(AT_A_TIME) {
            self.free_next_swept_empty_block();
        }
        self.sweeper.surplus.set(surplus.saturating_sub(AT_A_TIME));
    }

    pub fn sweep_synchronously(&self) {
        let (start, before) = (clock::monotonic_seconds(), self.capacity());
        while self.sweep_next_block() {}
        self.free_swept_empty_blocks();
        if options().use_zombie_mode || cfg!(bun_asan) {
            self.for_each_directory(Directory::scribble_on_dead_cells);
        } else {
            while self.discard_pages_of_next_sparse_block() {}
        }
        marks::discard_idle_pages();
        self.sweeper.timer.cancel();
        let elapsed = (clock::monotonic_seconds() - start) * 1e3;
        let (before, after) = (before >> 10, self.capacity() >> 10);
        log!(self, "Full sweep: {before}kb => {after}kb, {elapsed:.3}ms]");
    }

    pub(super) fn reset_sweeper(&self) {
        self.sweeper.unswept_cursor.set(0);
        self.sweeper.swept_empty_cursor.set(0);
        self.sweeper.sparse_cursor.set(0);
        self.sweeper.surplus.set(0);
        self.sweeper.allocated_at_last_slice.set(0);
        (self.sweeper.last_slice_time).set(clock::monotonic_seconds());
    }

    pub(super) fn schedule_sweep(&self, seconds: Option<f64>) {
        let seconds = seconds.unwrap_or(SECONDS_BETWEEN_SLICES);
        (self.sweeper.timer).start(self.vm(), seconds, |vm| vm.heap.sweep_for_a_while());
    }

    fn sweep_for_a_while(&self) {
        if self.mutator_state() != MutatorState::Running || self.is_marking_concurrently() {
            return self.schedule_sweep(None);
        }
        let now = clock::monotonic_seconds();
        let has_time = || clock::monotonic_seconds() < now + SLICE_SECONDS;
        let allocated = self.policy.allocated();
        let bytes = allocated - self.sweeper.allocated_at_last_slice.replace(allocated);
        let seconds = now - self.sweeper.last_slice_time.replace(now);
        let reserve = (bytes as f64 / seconds * RESERVE_SECONDS) as usize;
        let keep = reserve.min(self.policy.remaining()) / BLOCK_SIZE;

        while has_time() && self.sweep_next_block() {}
        let surplus = self.empty_block_count().saturating_sub(keep);
        self.sweeper.surplus.set(0);
        self.sweeper.swept_empty_cursor.set(0);
        for _ in (0..surplus).take_while(|_| has_time()) {
            self.free_next_swept_empty_block();
        }
        while has_time() && self.clear_some_stale_marks() {}
        while has_time() && self.discard_pages_of_next_sparse_block() {}
        if !has_time() {
            let is_idle = bytes < BLOCK_SIZE;
            return self.schedule_sweep(is_idle.then_some(SLICE_SECONDS));
        }
        marks::discard_idle_pages();
        if self.empty_block_count() != 0 {
            self.schedule_sweep(Some(RESERVE_SECONDS));
        }
    }
}
