//! What the thread of the heap does for markers that are at work while it runs scripts.
//!
//! They are not to see a cell before it is complete, so what is allocated is hidden from them. A cell that is stored
//! into is remembered, whether they have been there or not. Only at a safepoint, which is a call that may collect, does
//! the thread show them both, so it takes no fence to allocate or to store. What it does take, in all tiers:
//!
//! - At a safepoint all cells are complete, all barriers have run, and no id of a shape is nuked.
//! - What has been allocated since the last safepoint is written in any way and without a barrier, also once another
//!   cell refers to it.
//! - Any other cell gets the barrier between the same two safepoints as the store, before or after it, when a cell, a
//!   shape or a storage is stored, and when values move inside it or its storage.
//! - Values are stored as whole words. Slots and elements that are not in use are zero or holes.
//! - What a marker follows without marking it first is stored with release ordering: a storage, a count of words, the
//!   shape after elements have been converted.
//! - A shape and a storage change together under `nuke_shape_and_set_storage`, and the indexing mode only atomically.
//! - Two markers may visit a cell at the same time, unless its class is one of the embedder.
//! - Memory outside the heap that a visit reads changes under the lock of the cell, or the visit is put off.

use core::ffi::c_void;

use bun_alloc::default_alloc;
use bun_engine_platform::clock;

use super::collector::{Callback, Cycle, Pause, Request};
use super::{AllocationKind, Heap, MutatorState, barrier, delay};
use crate::options;

impl Heap {
    pub(super) fn can_mark_concurrently(&self) -> bool {
        let options = options();
        options.use_concurrent_gc
            && !options.force_mini_vm_mode
            && (options.number_of_gc_markers > 1 || self.policy.is_stressed())
    }

    /// Between two pauses of a collection.
    #[inline(always)]
    pub(crate) fn is_marking_concurrently(&self) -> bool {
        self.mutator_should_be_fenced.get()
    }

    /// If not, none is until the next allocation.
    pub(crate) fn has_markers_at_work(&self) -> bool {
        (self.cycle.borrow().as_ref()).is_some_and(|cycle| !cycle.marking.is_idle())
    }

    fn set_marking_concurrently(&self, value: bool) {
        self.mutator_should_be_fenced.set(value);
        self.barrier_threshold
            .set(barrier::threshold_for(value).into());
        barrier::did_change_threshold(value);
    }

    /// At the end of a pause.
    pub(super) fn start_marking_concurrently(&self, cycle: &mut Cycle) {
        self.set_marking_concurrently(true);
        self.first_hidden_precise.set(self.precise.borrow().len());
        cycle.marking.will_resume_mutator();
    }

    /// At the start of a pause. Allocation has stopped.
    pub(super) fn stop_marking_concurrently(&self, cycle: &mut Cycle) {
        self.reveal_allocated_cells();
        self.for_each_directory(|directory| {
            if let Some(block) = directory.stopped_block() {
                let free = directory.take_hidden(&[u64::MAX; _]);
                self.marks().reveal(block.address(), &free);
            }
        });
        cycle.marking.did_stop_mutator(&mut cycle.visitor);
        self.set_marking_concurrently(false);
    }

    /// A marker may come upon one before what that refers to has been revealed too. Such a cell is remembered.
    fn reveal_allocated_cells(&self) {
        let (marks, mut blocks) = (self.marks(), self.blocks_to_reveal.borrow_mut());
        (blocks.iter()).for_each(|(block, _)| block.set_hidden_from(block.end()));
        let allocators = self.allocators.borrow();
        blocks.extend(
            allocators
                .iter()
                .filter_map(|it| it.take_hidden_cells_in_use()),
        );
        for (block, cells) in blocks.iter() {
            marks.reveal(block.address(), cells);
            delay::of_mutator();
        }
        let precise = self.precise.borrow();
        let precise = &precise[self.first_hidden_precise.replace(precise.len())..];
        for allocation in precise {
            marks.remove_precise(allocation.cell());
        }
        let mut remembered = self.remembered.borrow_mut();
        for (block, cells) in blocks.drain(..) {
            if block.attributes.kind == AllocationKind::Cell {
                let marked = marks.among_by_now(block.address(), &cells);
                block.for_each_cell_among(&marked, |cell| remembered.push(cell));
            }
        }
        let cells = (precise.iter()).filter(|it| it.attributes.kind == AllocationKind::Cell);
        remembered.extend(
            cells
                .map(|it| it.cell())
                .filter(|&it| marks.contains_by_now(it)),
        );
    }

    /// Where a collection can run.
    #[inline(never)]
    pub(super) fn attend_to_markers(&self) {
        const MANY_CELLS: usize = 1 << 16;
        if self.policy.has_used_up_headroom(0) {
            return self.pause(Request::default(), Pause::UntilDone);
        }
        let mut borrowed = self.cycle.borrow_mut();
        let cycle = borrowed.as_mut().expect("under way");
        let is_stressed = self.policy.is_stressed();
        let remembers_many = self.remembered.borrow().len() >= MANY_CELLS || is_stressed;
        let has_changes = cycle.marking.has_changed() || remembers_many;
        if cycle.marking.is_idle() && (!has_changes || is_stressed) {
            drop(borrowed);
            return self.pause(Request::default(), Pause::Short);
        }
        let seconds = self.policy.seconds_owed_to_markers();
        if seconds == 0.0 && !has_changes {
            return;
        }
        if seconds != 0.0 {
            cycle.marking.hurry();
        }
        let _state = self.enter_state(MutatorState::Collecting);
        self.reveal_allocated_cells();
        if remembers_many {
            let remembered = cycle.lists.keep_remembered(self);
            cycle.visitor.stack.push_run(remembered);
        }
        let has_helpers = options().number_of_gc_markers > 1;
        cycle.visitor.deadline = match seconds == 0.0 && has_helpers {
            true => f64::NEG_INFINITY,
            false => clock::monotonic_seconds() + seconds,
        };
        cycle.marking.drain(&mut cycle.visitor);
        if seconds != 0.0 {
            self.policy.did_pause(clock::monotonic_seconds());
        }
    }

    /// # Safety
    /// From the default allocator, and only markers may still use it.
    pub(crate) unsafe fn free_after_marking(&self, memory: *mut c_void) {
        self.retired_memory.borrow_mut().push(memory);
    }

    pub(super) fn free_retired_memory(&self) {
        for memory in self.retired_memory.take() {
            // SAFETY: promised to `free_after_marking`.
            unsafe { default_alloc::free(memory) };
        }
    }

    /// The heap is going away.
    pub(crate) fn stop_collecting(&self) {
        self.policy.stop_collecting();
        if let Some(mut cycle) = self.cycle.take() {
            cycle.marking.abandon(&mut cycle.visitor);
            self.set_marking_concurrently(false);
            self.free_retired_memory();
            cycle
                .progress
                .did_finish
                .into_iter()
                .for_each(Callback::run);
        }
        let requests = self.requests.take().into_iter();
        requests
            .flat_map(|it| it.did_finish)
            .for_each(Callback::run);
    }
}
