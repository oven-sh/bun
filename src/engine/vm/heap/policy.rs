//! When to collect.

use core::cell::Cell;

use bun_engine_platform::{clock, machine};

use super::collector::{Pause, log};
use super::{BLOCK_SIZE, CellState, DeferCollection, Heap, JsCell, MutatorState, Scope};
use crate::{Forbidden, options};

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum HeapKind {
    Small,
    Medium,
    Large,
}

#[derive(Clone, Copy, Default)]
#[repr(C)]
pub struct HeapSizes {
    pub before_last_eden: usize,
    pub after_last_eden: usize,
    pub before_last_full: usize,
    pub after_last_full: usize,
    pub after_last: usize,
}

/// Of the cells that a collection has marked.
#[derive(Clone, Copy, Default)]
pub(super) struct MarkedBytes {
    pub(super) total: usize,
    /// At least so many have been allocated while it was under way.
    pub(super) late: usize,
}

/// When a collection began.
#[derive(Clone, Copy, Default)]
pub(crate) struct Moment {
    /// Since the heap was made.
    pub(crate) seconds: f32,
    /// For how long the program has had next to nothing to do, if that is why there is a collection.
    pub(crate) idle_seconds: Option<f32>,
}

const WHITE: u8 = CellState::DefinitelyWhite as u8;
const OVERSIZED: usize = 64 * 1024;
const NEGLIGIBLE_EXTRA_MEMORY: usize = 256;
const MIN_BYTES_BETWEEN_MEASUREMENTS: usize = 100 * BLOCK_SIZE;

pub(super) struct Policy {
    kind: HeapKind,
    max_heap_size: Cell<usize>,
    max_eden_size: Cell<usize>,
    allocated: Cell<usize>,
    last_oversized: Cell<usize>,
    extra_since_check: Cell<usize>,
    old_cell_bytes: Cell<usize>,
    extra_memory: Cell<usize>,
    untracked_extra_memory: Cell<usize>,
    /// What these two were when the full collection that is under way began.
    extra_memory_at_start: Cell<(usize, usize)>,
    array_buffer_bytes: Cell<usize>,
    should_collect_fully: Cell<bool>,
    is_safe_to_collect: Cell<bool>,
    sizes: Cell<HeapSizes>,
    /// The process has taken most of the memory that it can get.
    is_critical: Cell<bool>,
    /// When `allocated` gets there, it is time to look again.
    next_measurement: Cell<usize>,
    last_collection_end: Cell<f64>,
    /// What `allocated` was when the collection that is under way began, and where it has to end.
    allocated_at_start: Cell<usize>,
    allocated_at_end: Cell<usize>,
    last_pause_end: Cell<f64>,
    /// While the last collection of each scope was under way.
    allocated_meanwhile: [Cell<usize>; 2],
    creation_time: f64,
    /// When a collection last found that more than a trickle had been allocated, and how much has been since.
    last_busy_time: Cell<f64>,
    trickle: Cell<usize>,
    stress_count: Cell<u32>,
    stress_period: Cell<u32>,
    stress_collections: Cell<u32>,
}

fn min_heap_size(kind: HeapKind) -> usize {
    let options = options();
    match kind {
        HeapKind::Large => options
            .large_heap_size
            .min((options.ram_size as f64 * options.small_heap_ram_fraction) as usize),
        HeapKind::Medium => options.medium_heap_size,
        HeapKind::Small => options.small_heap_size,
    }
}

fn proportional_heap_size(heap_size: usize, footprint: Option<usize>) -> usize {
    const GROWTH_FUNCTION_THRESHOLD: usize = 16 << 30;
    let options = options();
    let (size, ram) = (heap_size as f64, options.ram_size as f64);
    let footprint = footprint.unwrap_or(heap_size) as f64;
    let factor = if options.force_mini_vm_mode {
        options.mini_vm_heap_growth_factor
    } else if options.ram_size >= GROWTH_FUNCTION_THRESHOLD
        && !cfg!(all(target_os = "macos", target_arch = "x86_64"))
    {
        let steepness = options.heap_growth_steepness_factor;
        options.heap_growth_max_increase * (-steepness * size.min(ram) / ram).exp() + 1.0
    } else if footprint < ram * options.small_heap_ram_fraction {
        options.small_heap_growth_factor
    } else if footprint < ram * options.medium_heap_ram_fraction {
        options.medium_heap_growth_factor
    } else {
        options.large_heap_growth_factor
    };
    (factor * size) as usize
}

impl Policy {
    pub(super) fn new(kind: HeapKind) -> Policy {
        let now = clock::monotonic_seconds();
        Policy {
            kind,
            max_heap_size: Cell::new(min_heap_size(kind)),
            max_eden_size: Cell::new(min_heap_size(kind)),
            allocated: Cell::new(0),
            last_oversized: Cell::new(0),
            extra_since_check: Cell::new(0),
            old_cell_bytes: Cell::new(0),
            extra_memory: Cell::new(0),
            untracked_extra_memory: Cell::new(0),
            extra_memory_at_start: Cell::default(),
            array_buffer_bytes: Cell::new(0),
            should_collect_fully: Cell::new(false),
            is_safe_to_collect: Cell::new(false),
            sizes: Cell::default(),
            is_critical: Cell::new(false),
            next_measurement: Cell::new(MIN_BYTES_BETWEEN_MEASUREMENTS),
            last_collection_end: Cell::new(now),
            allocated_at_start: Cell::new(0),
            allocated_at_end: Cell::new(0),
            last_pause_end: Cell::new(now),
            allocated_meanwhile: Default::default(),
            creation_time: now,
            last_busy_time: Cell::new(now),
            trickle: Cell::new(0),
            stress_count: Cell::new(0),
            stress_collections: Cell::new(0),
            stress_period: Cell::new(options().collect_every_n_allocations),
        }
    }

    fn measure_footprint(&self) -> Option<usize> {
        let footprint = machine::memory_footprint();
        let threshold = machine::ram_size() as f64 * options().critical_gc_memory_threshold;
        let headroom = footprint.map_or(f64::INFINITY, |it| threshold - it as f64);
        self.is_critical.set(headroom < 0.0);
        let interval = ((headroom / 16.0) as usize).max(MIN_BYTES_BETWEEN_MEASUREMENTS);
        (self.next_measurement).set(self.allocated().saturating_add(interval));
        footprint
    }

    pub(super) fn is_critical(&self) -> bool {
        self.is_critical.get()
    }

    /// In this cycle.
    fn allowed(&self) -> usize {
        let allowed = self.max_heap_size.get() - self.sizes.get().after_last;
        if !self.is_critical() {
            return allowed;
        }
        let above_threshold = 1.0 - options().critical_gc_memory_threshold;
        allowed.min((options().ram_size as f64 * above_threshold) as usize / 4)
    }

    /// So that it ends about where it would if scripts waited for it.
    fn allowed_before_start(&self) -> usize {
        let (allowed, scope) = (self.allowed(), self.choose_scope(None));
        allowed - (self.allocated_meanwhile[scope as usize].get()).min(allowed / 3)
    }

    pub(super) fn remaining(&self) -> usize {
        self.allowed().saturating_sub(self.allocated())
    }

    pub(super) fn allocated(&self) -> usize {
        self.allocated.get()
    }

    fn is_due(&self) -> bool {
        const CONTINUOUS_PERIOD: f64 = 0.001;
        if self.allocated() >= self.next_measurement.get() {
            self.measure_footprint();
        }
        let (allocated, limit) = (self.allocated(), options().gc_max_heap_size);
        if (limit != 0 && allocated > limit)
            || (options().collect_continuously
                && clock::monotonic_seconds() - self.last_collection_end.get() > CONTINUOUS_PERIOD)
        {
            return true;
        }
        // A large allocation that has just been made is alive, and says little about the rest.
        allocated > self.allowed_before_start()
            && (self.is_critical()
                || self.kind != HeapKind::Large
                || self.last_oversized.get() <= allocated / 3)
    }

    /// Whether a collection would become due before so much more is allocated, and has something to find now.
    fn is_due_ahead_of(&self, bytes: usize) -> bool {
        let (allocated, allowed) = (self.allocated.get(), self.allowed());
        allocated.saturating_add(bytes) > allowed
            && allocated.saturating_sub(self.last_oversized.get()) >= allowed / 8
    }

    pub(super) fn choose_scope(&self, requested: Option<Scope>) -> Scope {
        if !options().use_generational_gc || options().force_mini_vm_mode {
            return Scope::Full;
        }
        match requested {
            Some(scope) => scope,
            None if self.should_collect_fully.get() || self.is_critical() => Scope::Full,
            None => Scope::Eden,
        }
    }

    pub(super) fn will_collect(&self, scope: Scope, now: f64) {
        (self.trickle).update(|bytes| bytes.saturating_add(self.allocated()));
        if self.trickle.get() > (options().quiet_allocation_megabytes as usize) << 20 {
            self.trickle.set(0);
            self.last_busy_time.set(now);
        }
        let budget = self.allocated().max(self.allowed()) as f64;
        self.allocated_at_start.set(self.allocated());
        (self.allocated_at_end).set((budget * options().concurrent_gc_max_headroom) as usize);
        let mut sizes = self.sizes.get();
        let before = sizes.after_last.saturating_add(self.allocated.get());
        match scope {
            Scope::Eden => sizes.before_last_eden = before,
            Scope::Full => {
                sizes.before_last_full = before;
                self.should_collect_fully.set(false);
                let known = (self.extra_memory.get(), self.untracked_extra_memory.get());
                self.extra_memory_at_start.set(known);
            }
        }
        self.sizes.set(sizes);
    }

    pub(super) fn did_collect(&self, scope: Scope, marked: MarkedBytes, extra_memory: usize) {
        if scope == Scope::Full {
            let (extra, untracked) = self.extra_memory_at_start.take();
            self.old_cell_bytes.set(0);
            self.extra_memory.update(|bytes| bytes - extra);
            (self.untracked_extra_memory).update(|bytes| bytes - untracked);
        }
        self.old_cell_bytes.update(|bytes| bytes + marked.total);
        self.extra_memory
            .update(|bytes| bytes.saturating_add(extra_memory));
        let size = self
            .old_cell_bytes
            .get()
            .saturating_add(self.extra_memory_size());
        let meanwhile = self.allocated() - self.allocated_at_start.get();
        self.allocated_meanwhile[scope as usize].set(meanwhile);
        let mut sizes = self.sizes.get();
        let footprint = (self.allocated.take() != 0 || scope == Scope::Full)
            .then(|| self.measure_footprint())
            .flatten();
        // The limits are those that a collection without delay would have come to.
        let size_at_start = size - marked.late;
        match scope {
            Scope::Full => {
                let max = min_heap_size(self.kind)
                    .max(proportional_heap_size(size_at_start, footprint))
                    .max(size_at_start.saturating_add(BLOCK_SIZE));
                self.max_heap_size.set(max);
                self.max_eden_size.set(max - size_at_start);
                sizes.after_last_full = size;
            }
            Scope::Eden => {
                let max = self.max_heap_size.get();
                let remaining = max.saturating_sub(size_at_start) as f64;
                if remaining / (max as f64) < options().min_eden_to_old_generation_ratio
                    || options().collect_continuously
                {
                    self.should_collect_fully.set(true);
                }
                let room = size_at_start.saturating_add(self.max_eden_size.get());
                self.max_heap_size.set(max.max(room));
                sizes.after_last_eden = size;
            }
        }
        let least = size.saturating_add(self.max_eden_size.get() / 2);
        self.max_heap_size.update(|max| max.max(least));
        sizes.after_last = size;
        self.sizes.set(sizes);
        self.last_oversized.set(0);
        self.last_collection_end.set(clock::monotonic_seconds());
    }

    pub(super) fn stop_collecting(&self) {
        self.is_safe_to_collect.set(false);
    }

    pub(super) fn is_stressed(&self) -> bool {
        self.stress_period.get() != 0 || options().collect_continuously
    }

    /// `expected_seconds` is how long the whole collection may take.
    pub(super) fn seconds_for_pause(&self, earlier_pauses: u32, expected_seconds: f64) -> f64 {
        const PAUSES_UNDER_STRESS: u32 = 3;
        let unit = options().minimum_gc_pause_milliseconds / 1e3;
        match earlier_pauses {
            0 if self.is_stressed() => f64::NEG_INFINITY,
            ..PAUSES_UNDER_STRESS if self.is_stressed() => 0.0,
            0 if expected_seconds > unit * 10.0 => unit / 4.0,
            // Most collections can end in the first, which is cheaper than to go on.
            0 => unit * 2.0,
            // The longer it goes on, the more time it gets for coming to an end.
            _ => unit * f64::from(1 << (earlier_pauses - 1).min(20)),
        }
    }

    pub(super) fn did_pause(&self, end: f64) {
        self.last_pause_end.set(end);
    }

    /// Once so much more has been allocated.
    pub(super) fn has_used_up_headroom(&self, bytes: usize) -> bool {
        self.allocated().saturating_add(bytes) >= self.allocated_at_end.get()
    }

    /// The less room is left, the less of the time scripts get.
    pub(super) fn seconds_owed_to_markers(&self) -> f64 {
        const FREE_SHARE: f64 = 0.25;
        let start = self.allocated_at_start.get();
        let used = (self.allocated() - start) as f64 / (self.allocated_at_end.get() - start) as f64;
        if used < FREE_SHARE {
            return 0.0;
        }
        let share = (used - FREE_SHARE) / (1.0 - FREE_SHARE);
        let running = clock::monotonic_seconds() - self.last_pause_end.get();
        let slice = options().minimum_gc_pause_milliseconds / 1e3;
        match running * share / (1.0 - share) < slice {
            true => 0.0,
            false => slice,
        }
    }

    pub(super) fn moment(&self, now: f64, is_idle: bool) -> Moment {
        Moment {
            seconds: (now - self.creation_time) as f32,
            idle_seconds: is_idle.then(|| (now - self.last_busy_time.get()) as f32),
        }
    }

    pub(super) fn old_cell_bytes(&self) -> usize {
        self.old_cell_bytes.get()
    }

    pub(super) fn did_grow_old_cell(&self, bytes: usize) {
        self.old_cell_bytes.update(|total| total + bytes);
    }

    fn extra_memory_size(&self) -> usize {
        self.extra_memory
            .get()
            .saturating_add(self.untracked_extra_memory.get())
            .saturating_add(self.array_buffer_bytes.get())
    }
}

impl Heap {
    pub(crate) fn notify_is_safe_to_collect(&self) {
        self.policy.is_safe_to_collect.set(true);
        log!(self, "starting ]");
    }

    pub(super) fn is_collected(&self) -> bool {
        self.policy.is_safe_to_collect.get() && options().use_gc
    }

    pub(super) fn can_collect(&self) -> bool {
        self.is_collected() && self.mutator_state() == MutatorState::Running
    }

    #[inline]
    pub(crate) fn did_allocate(&self, bytes: usize) {
        self.policy
            .allocated
            .update(|allocated| allocated.saturating_add(bytes));
        if bytes >= OVERSIZED {
            self.policy.last_oversized.set(bytes);
        }
    }

    pub fn collect_if_necessary(&self) {
        #[cfg(debug_assertions)]
        crate::direct::will_allocate();
        if !self.can_collect() {
            return;
        }
        let is_marking = self.is_marking_concurrently();
        if !is_marking && self.requests.borrow().is_empty() && !self.policy.is_due() {
            self.schedule_eden_collection();
        } else if self.is_deferred() {
            self.did_defer_collection.set(true);
        } else if is_marking {
            self.attend_to_markers();
        } else {
            let request = self.requests.borrow_mut().pop_front();
            self.pause(request.unwrap_or_default(), Pause::Short);
        }
    }

    /// For making about so many bytes of cells that are all alive in the end, which a collection in the middle of it
    /// could only waste time on. May collect now.
    #[inline]
    pub(crate) fn defer_collection_for(&self, bytes: usize) -> DeferCollection<'_> {
        #[cfg(debug_assertions)]
        self.collect_if_stressed();
        if self.did_defer_collection.get() || bytes >= BLOCK_SIZE {
            self.collect_ahead_of(bytes);
        }
        self.defer_collection()
    }

    /// So that it can take the place of what has died, and is not taken for a survivor. May collect.
    #[inline]
    pub(crate) fn will_allocate_extra_memory(&self, bytes: usize) {
        if bytes >= OVERSIZED {
            self.collect_ahead_of(bytes);
        }
    }

    #[inline(never)]
    fn collect_ahead_of(&self, bytes: usize) {
        /// Making that much takes about as long as marking what has been made since the last pause.
        const WORTH_A_PAUSE: usize = 1 << 20;
        if !self.is_marking_concurrently() {
            if self.policy.is_due() || self.policy.is_due_ahead_of(bytes) {
                self.begin_collection(None);
            }
        } else if self.policy.has_used_up_headroom(bytes)
            || (bytes >= WORTH_A_PAUSE && !self.has_markers_at_work())
        {
            self.finish_collection();
        } else {
            self.collect_if_necessary();
        }
    }

    pub(super) fn will_allocate_slowly(&self) {
        assert!(
            !self.is_destroying_cells.get() && self.mutator_state() != MutatorState::Collecting,
            "an allocation while the collector is at work"
        );
        self.vm().clear_dead_stack();
        #[cfg(not(debug_assertions))]
        self.collect_if_stressed();
        self.collect_if_necessary();
    }

    /// In place of `collect_every_n_allocations`, which has to be set for all allocations to count. Returns the old count.
    pub fn set_stress_period(&self, period: u32, count: u32) -> u32 {
        self.policy.stress_period.set(period);
        self.policy.stress_count.replace(count)
    }

    pub(super) fn collect_if_stressed(&self) {
        debug_assert!(
            !self.is_constructing_cell.get() || self.is_deferred(),
            "an allocation between `allocateCell()` and `finishCreation()`"
        );
        if !self.is_deferred() {
            self.vm().assert_is_allowed(Forbidden::COLLECTING);
        }
        let period = self.policy.stress_period.get();
        if period == 0 || !self.can_collect() || self.is_deferred() {
            return;
        }
        let count = self.policy.stress_count.get().wrapping_add(1);
        self.policy.stress_count.set(count);
        if count.is_multiple_of(period) {
            self.collect_for_stress();
        }
    }

    /// Where a collection can run.
    pub fn collect_for_stress(&self) {
        if self.is_marking_concurrently() {
            return self.attend_to_markers();
        }
        let collections = self.policy.stress_collections.get().wrapping_add(1);
        self.policy.stress_collections.set(collections);
        let is_full =
            collections.is_multiple_of(4) && !options().use_only_eden_collections_under_stress;
        let scope = if is_full { Scope::Full } else { Scope::Eden };
        // Every other one, and of the full ones too.
        if self.can_mark_concurrently() && (collections / 4 + collections).is_multiple_of(2) {
            self.begin_collection(Some(scope));
        } else {
            self.collect_and_sweep(Some(scope));
        }
    }

    /// Whether it is worth trying again.
    #[cold]
    pub(super) fn collect_for_lack_of_memory(&self) -> bool {
        if !self.can_collect() || self.is_deferred() {
            return false;
        }
        self.collect_and_sweep(Some(Scope::Full));
        true
    }

    /// `cell` has come to own that much more memory outside the heap. May collect.
    #[inline]
    pub fn report_extra_memory_allocated(&self, cell: &JsCell, bytes: usize) {
        #[cfg(debug_assertions)]
        crate::direct::will_allocate();
        if bytes > NEGLIGIBLE_EXTRA_MEMORY {
            self.note_extra_memory_allocated(cell, bytes);
            self.collect_if_extra_memory_adds_up();
        }
    }

    /// As `report_extra_memory_allocated`, where it is spread over many cells.
    pub fn report_extra_memory_allocated_by_many(&self, bytes: usize) {
        if bytes > NEGLIGIBLE_EXTRA_MEMORY {
            self.count_extra_memory_allocated(bytes);
            self.collect_if_extra_memory_adds_up();
        }
    }

    /// Does not collect.
    pub(crate) fn count_extra_memory_allocated(&self, bytes: usize) {
        self.did_allocate(bytes);
        self.policy
            .extra_since_check
            .update(|total| total.saturating_add(bytes));
    }

    #[inline]
    pub(crate) fn collect_if_extra_memory_adds_up(&self) {
        debug_assert!(!self.is_constructing_cell.get() || self.is_deferred());
        if self.policy.extra_since_check.get() >= BLOCK_SIZE {
            self.policy.extra_since_check.set(0);
            self.collect_if_necessary();
        }
    }

    /// As `report_extra_memory_allocated`, but does not collect.
    pub(crate) fn note_extra_memory_allocated(&self, cell: &JsCell, bytes: usize) {
        self.count_extra_memory_allocated(bytes);
        // An old cell is not visited for the first time again before the next full collection.
        let has_been_counted = match self.is_marking_concurrently() {
            true => cell.state() != WHITE && self.marks().contains(cell.address()),
            false => cell.state() != WHITE,
        };
        if has_been_counted {
            self.policy
                .extra_memory
                .update(|total| total.saturating_add(bytes));
        }
    }

    pub(super) fn did_find_extra_memory(&self, bytes: usize) {
        self.policy
            .extra_memory
            .update(|total| total.saturating_add(bytes));
    }

    /// Memory that no visit will report. May collect.
    pub fn report_untracked_extra_memory(&self, bytes: usize) {
        if bytes > NEGLIGIBLE_EXTRA_MEMORY {
            (self.policy.untracked_extra_memory).update(|total| total.saturating_add(bytes));
            self.report_extra_memory_allocated_by_many(bytes);
        }
    }

    /// So many of the bytes have already been reported as allocated.
    #[inline]
    pub(crate) fn did_add_array_buffer(&self, bytes: usize, already_reported: usize) {
        self.policy.array_buffer_bytes.update(|total| total + bytes);
        let new = bytes.saturating_sub(already_reported);
        self.did_allocate(new);
        self.policy
            .extra_since_check
            .update(|total| total.saturating_add(new));
    }

    pub(crate) fn did_remove_array_buffer(&self, bytes: usize) {
        self.policy
            .array_buffer_bytes
            .update(|total| total.saturating_sub(bytes));
    }

    pub fn set_initial_allocation_budget(&self, bytes: usize) {
        if self.last_collection_scope().is_none() && bytes > self.policy.max_eden_size.get() {
            self.policy.max_eden_size.set(bytes);
            self.policy.max_heap_size.set(bytes);
            self.activity.suspend_until_next_collection();
        }
    }

    pub fn sizes(&self) -> HeapSizes {
        self.policy.sizes.get()
    }

    pub fn bytes_allocated_this_cycle(&self) -> usize {
        self.policy.allocated.get()
    }

    pub fn array_buffer_size(&self) -> usize {
        self.policy.array_buffer_bytes.get()
    }

    pub fn extra_memory_size(&self) -> usize {
        self.policy.extra_memory_size()
    }
}
