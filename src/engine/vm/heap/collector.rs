use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::fmt::Display;
use core::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use bun_engine_platform::clock;

use super::block::{Block, FIRST_VERSION, next_version};
use super::conservative::{ConservativeRoots, Found};
use super::directory::Directory;
use super::mark_stack::{Run, RunKind};
use super::marking::{Marking, OpaqueRoots};
use super::policy::MarkedBytes;
use super::verifier::Verifier;
use super::visitor::Findings;
use super::{
    AllocationKind, DeferCollection, Gc, Heap, HeapAnalyzer, HeapGraphSink, JsCell, Moment,
    MutatorState, RootReason, Scope, StateGuard, Survivors, Visitor, WeakImpl, delay, root_alloc,
    stack, weak,
};
use crate::{Forbidden, options};

macro_rules! log {
    ($heap:expr, $($argument:tt)*) => {
        if $crate::options().log_gc {
            $heap.log(format_args!($($argument)*));
        }
    };
}

pub(super) use log;

/// For C++.
#[derive(Clone, Copy)]
pub struct Callback {
    function: unsafe extern "C" fn(*mut c_void),
    context: *mut c_void,
}

impl Callback {
    /// # Safety
    /// The function can be called with the context, once.
    pub unsafe fn new(
        function: unsafe extern "C" fn(*mut c_void),
        context: *mut c_void,
    ) -> Callback {
        Callback { function, context }
    }

    pub(super) fn run(self) {
        // SAFETY: promised by its maker.
        unsafe { (self.function)(self.context) }
    }
}

#[derive(Clone, Copy, Default)]
pub struct Request {
    pub scope: Option<Scope>,
    /// The program has had nothing to do for a while.
    pub is_idle: bool,
    /// Also if there will be no collection.
    pub did_finish: Option<Callback>,
}

impl From<Option<Scope>> for Request {
    fn from(scope: Option<Scope>) -> Request {
        Request {
            scope,
            ..Request::default()
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Pause {
    /// If it is not enough, the helpers go on marking while scripts run.
    Short,
    UntilDone,
}

#[derive(Clone, Copy)]
pub(super) struct Progress {
    start: f64,
    capacity: usize,
    pause_count: u32,
    pub(super) did_finish: Option<Callback>,
}

impl Progress {
    fn describe(&self, scope: Scope) -> impl Display + use<> {
        let (is_first, capacity) = (self.pause_count == 0, self.capacity >> 10);
        core::fmt::from_fn(move |out| match is_first {
            true => write!(out, "START M {capacity}kb => {scope:?}Collection, "),
            false => write!(out, "M "),
        })
    }
}

/// What runs on the mark stacks refer to.
#[derive(Default)]
pub(super) struct Lists {
    remembered: Vec<Vec<usize>>,
    blocks: Vec<&'static Block>,
    chunks_of_weak_handles: Vec<&'static weak::Chunk>,
    /// Whose targets were not marked in the first round of the last pause.
    handles_at_stake: Vec<&'static WeakImpl>,
    constraining_cells: Vec<usize>,
    ephemeron_tables: Vec<usize>,
}

impl Lists {
    pub(super) fn keep_remembered(&mut self, heap: &Heap) -> Run {
        let kind = match heap.may_let_scripts_run.get() {
            true => RunKind::Remembered,
            false => RunKind::Changed,
        };
        Run::of(kind, self.remembered.push_mut(heap.remembered.take()))
    }

    fn give_memory_back(&mut self, heap: &Heap) {
        const KEPT_CELLS: usize = 1 << 14;
        if let Some(first) = self.remembered.first_mut() {
            first.clear();
            first.shrink_to(KEPT_CELLS);
            assert!(heap.remembered.replace(core::mem::take(first)).is_empty());
        }
    }
}

/// A cell that is visited again says again what it needs.
fn drop_repetitions(cells: &mut Vec<usize>) {
    cells.sort_unstable();
    cells.dedup();
}

/// A collection that is marking.
pub(super) struct Cycle {
    pub(super) scope: Scope,
    pub(super) progress: Progress,
    pub(super) visitor: Visitor,
    pub(super) marking: Arc<Marking>,
    pub(super) lists: Lists,
}

impl Heap {
    #[cold]
    pub(super) fn log(&self, message: core::fmt::Arguments<'_>) {
        bun_engine_platform::log(format_args!("[GC<{self:p}>: {message}\n"));
    }

    /// One that begins now and has ended when this returns. Does nothing where a collection cannot run.
    pub fn collect(&self, scope: Option<Scope>) {
        if !self.can_collect() {
            return;
        }
        if self.is_deferred() {
            return self.did_defer_collection.set(true);
        }
        self.collect_now(scope);
    }

    fn collect_now(&self, scope: Option<Scope>) {
        self.end_concurrent_marking();
        self.pause(scope.into(), Pause::UntilDone);
    }

    fn end_concurrent_marking(&self) {
        while self.is_marking_concurrently() {
            self.pause(Request::default(), Pause::UntilDone);
        }
    }

    /// The one that is under way, for a thread that will not come by for a while.
    pub(crate) fn finish_collection(&self) {
        if self.can_collect() && !self.is_deferred() {
            self.end_concurrent_marking();
        }
    }

    /// One that begins at the next opportunity, unless one that is under way or has been asked for will do.
    pub fn request_collection(&self, request: Request) {
        if !self.is_collected() {
            return request.did_finish.into_iter().for_each(Callback::run);
        }
        let mut requests = self.requests.borrow_mut();
        let current = self.collection_scope().map(Some);
        let is_subsumed = (requests.iter().map(|it| it.scope).chain(current))
            .any(|it| it == Some(Scope::Full) || request.scope != Some(Scope::Full));
        if is_subsumed && request.did_finish.is_none() {
            return;
        }
        requests.push_back(request);
        if requests.len() == 1 {
            self.make_opportunity();
        }
    }

    /// For a program that does not allocate.
    fn make_opportunity(&self) {
        (self.request_timer).start(self.vm(), 0.0, |vm| vm.heap.collect_if_necessary());
    }

    pub(super) fn begin_collection(&self, scope: Option<Scope>) {
        if !self.can_collect() {
            return;
        }
        if self.is_marking_concurrently() || self.is_deferred() {
            self.request_collection(scope.into());
            self.collect_if_necessary();
        } else {
            self.pause(scope.into(), Pause::Short);
        }
    }

    /// The request counts unless a collection is under way.
    pub(super) fn pause(&self, request: Request, pause: Pause) {
        self.vm().assert_is_allowed(Forbidden::COLLECTING);
        self.vm().clear_dead_stack();
        // Code that is running keeps what it names alive, so what is invalidated is other code.
        let forbidden = self.vm().probes().forbidden.take();
        delay::suspended_during(|| {
            stack::with_registers_on_stack(|stack_top| self.run_pause(request, pause, stack_top));
        });
        self.vm().probes().forbidden.set(forbidden);
        stack::clear_what_the_collector_left();
    }

    /// Also destroys everything that died.
    pub fn collect_and_sweep(&self, scope: Option<Scope>) {
        self.collect(scope);
        if self.mutator_state() == MutatorState::Running
            && !self.is_marking_concurrently()
            && !self.sweeps_synchronously()
        {
            self.sweep_synchronously();
        }
    }

    /// A full collection that reports what it finds, which is there for as long as the result is. Reports nothing
    /// where a collection cannot run.
    pub fn collect_and_analyze(&self, sink: &mut dyn HeapGraphSink) -> DeferCollection<'_> {
        let can_collect = self.can_collect() && !self.is_deferred();
        let deferral = self.defer_collection();
        if can_collect {
            self.end_concurrent_marking();
            // SAFETY: a local.
            let mut analyzer = unsafe { HeapAnalyzer::new(sink) };
            self.analyzer.set(&raw mut analyzer);
            self.collect_now(Some(Scope::Full));
            self.sweep_synchronously();
        }
        deferral
    }

    fn sweeps_synchronously(&self) -> bool {
        options().sweep_synchronously || options().force_mini_vm_mode || self.policy.is_critical()
    }

    #[inline(never)]
    fn run_pause(&self, request: Request, pause: Pause, stack_top: usize) {
        let start = clock::monotonic_seconds();
        let state = self.enter_state(MutatorState::Collecting);
        self.did_defer_collection.set(false);
        self.stop_allocating();
        if let Some(mut cycle) = self.cycle.take() {
            let was_idle = cycle.marking.is_idle();
            self.stop_marking_concurrently(&mut cycle);
            if options().verify_gc && was_idle {
                self.verify_progress(&mut cycle);
            }
            let roots = self.find_roots(cycle.scope, stack_top);
            return self.continue_cycle(*cycle, state, pause, start, &roots);
        }

        let scope = self.policy.choose_scope(request.scope);
        (self.requests.borrow_mut()).retain(|it| {
            it.did_finish.is_some() || (it.scope == Some(Scope::Full) && scope != Scope::Full)
        });
        let capacity = self.capacity();
        self.collection_scope.set(Some(scope));
        self.policy.will_collect(scope, start);
        self.activity.will_collect(scope);
        self.notify_observers(|observer| observer.will_collect());
        (self.vm()).notify_collection_observers(|observer| observer.will_collect());
        let progress = Progress {
            start,
            capacity,
            pause_count: 0,
            did_finish: request.did_finish,
        };
        if scope == Scope::Eden && self.policy.allocated() == 0 {
            self.policy.did_collect(scope, MarkedBytes::default(), 0);
            return self.end_collection(scope, progress, state, start, None);
        }
        let pause = match self.can_mark_concurrently() {
            true => pause,
            false => Pause::UntilDone,
        };
        let roots = self.find_roots(scope, stack_top);
        self.begin_marking(scope, pause);
        let moment = self.policy.moment(start, request.is_idle);
        let marking = Marking::new(self, scope, moment, &self.opaque_roots, false);
        let visitor = Visitor::new(&marking, self.spare_mark_stack.take());
        let cycle = Cycle {
            scope,
            progress,
            marking,
            visitor,
            lists: Lists::default(),
        };
        self.continue_cycle(cycle, state, pause, start, &roots);
    }

    fn continue_cycle(
        &self,
        mut cycle: Cycle,
        state: StateGuard<'_>,
        pause: Pause,
        start: f64,
        roots: &Found,
    ) {
        cycle.visitor.deadline = match pause {
            Pause::Short => {
                let expected = self.activity.last_duration(cycle.scope);
                start + (self.policy).seconds_for_pause(cycle.progress.pause_count, expected)
            }
            Pause::UntilDone => f64::INFINITY,
        };
        if pause == Pause::UntilDone {
            cycle.marking.let_helpers_count_on_pause();
        }
        self.weak_set.begin_marking(cycle.scope);
        if self.mark(&cycle.marking, &mut cycle.visitor, &mut cycle.lists, roots) {
            let (scope, pauses) = (cycle.scope, cycle.progress.pause_count);
            self.finish_marking(scope, cycle.visitor, cycle.lists, pauses, roots);
            return self.end_collection(scope, cycle.progress, state, start, Some(roots));
        }
        self.start_marking_concurrently(&mut cycle);
        let now = clock::monotonic_seconds();
        let (beginning, pause) = (cycle.progress.describe(cycle.scope), (now - start) * 1e3);
        log!(self, "{beginning}p={pause:.3}ms ...]");
        cycle.progress.pause_count += 1;
        self.policy.did_pause(now);
        self.cycle.replace(Some(Box::new(cycle)));
    }

    /// Without roots, there was nothing to find.
    fn end_collection(
        &self,
        scope: Scope,
        progress: Progress,
        state: StateGuard<'_>,
        start_of_pause: f64,
        roots: Option<&Found>,
    ) {
        let end_of_marking = clock::monotonic_seconds();
        self.collection_scope.set(None);
        self.last_collection_scope.set(Some(scope));
        drop(state);

        if let Some(roots) = roots {
            let state = self.enter_state(MutatorState::Sweeping);
            let examined = self.precise.borrow().len();
            self.weak_set.finalize_dead();
            self.sweep_precise_allocations(examined);
            drop(state);
            let _defer = self.defer_collection();
            self.vm().did_collect(scope, &roots.cells);
        }
        self.notify_observers(|observer| observer.did_collect(scope));
        (self.vm()).notify_collection_observers(|observer| observer.did_collect(scope));
        if roots.is_some() {
            self.give_memory_back(scope);
        }

        let end = clock::monotonic_seconds();
        self.activity.did_collect(scope, end - progress.start);
        if scope == Scope::Eden {
            self.schedule_full_collection(0);
        }
        let (beginning, after) = (progress.describe(scope), self.sizes().after_last >> 10);
        let [marking, pause, cycle] = [
            end_of_marking - start_of_pause,
            end - start_of_pause,
            end - progress.start,
        ]
        .map(|seconds| seconds * 1e3);
        log!(
            self,
            "{beginning}=> {after}kb, m={marking:.3}ms, p={pause:.3}ms, cycle {cycle:.3}ms END]"
        );
        progress.did_finish.into_iter().for_each(Callback::run);
        if !self.requests.borrow().is_empty() {
            self.make_opportunity();
        }
    }

    fn give_memory_back(&self, scope: Scope) {
        if scope == Scope::Full {
            self.strong_set.shrink();
        }
        if self.sweeps_synchronously() {
            self.sweep_synchronously();
        } else {
            if scope == Scope::Full {
                self.note_surplus_of_empty_blocks();
            }
            self.schedule_sweep(None);
        }
        if scope == Scope::Full && !cfg!(bun_asan) {
            bun_alloc::mimalloc::mi_collect(false);
        }
    }

    fn notify_observers(&self, notify: impl Fn(&super::HeapObserver)) {
        let _defer = self.defer_collection();
        let observers = self.observers.borrow().clone();
        for observer in observers {
            if self.observers.borrow().contains(&observer) {
                // SAFETY: valid until it is removed.
                notify(unsafe { &*observer });
            }
        }
    }

    fn find_roots(&self, scope: Scope, stack_top: usize) -> Found {
        self.vm().will_collect(scope);
        self.vm().will_mark();
        self.find_conservative_roots(scope, stack_top)
    }

    fn finish_marking(
        &self,
        scope: Scope,
        mut visitor: Visitor,
        mut lists: Lists,
        pauses: u32,
        roots: &Found,
    ) {
        lists.give_memory_back(self);
        let weak_words = options().verify_gc.then(|| self.verify_marking(roots));
        let mut findings = core::mem::take(&mut visitor.findings);
        if pauses != 0 {
            drop_repetitions(&mut findings.to_reconcile);
        }
        visitor.deadline = f64::INFINITY;
        let marked = self.end_marking(scope, &mut visitor);

        // SAFETY: it outlives the collection, and the visitor is done with it.
        if let Some(analyzer) = unsafe { self.analyzer.take().as_mut() } {
            self.for_each_live_cell(|cell| analyzer.analyze(cell));
        }

        let survivors = Survivors {
            scope,
            marks: self.marks(),
            vm: self.vm(),
            visitor: RefCell::new(visitor),
        };
        self.weak_set.reap(&lists.handles_at_stake, &survivors);
        self.clear_weak_references(&survivors, &findings);
        if let Some(addresses) = weak_words {
            self.verify_weak_words(&addresses);
        }
        let mut stack = survivors.visitor.into_inner().stack;
        stack.shrink();
        self.spare_mark_stack.set(stack);
        self.policy
            .did_collect(scope, marked, findings.extra_memory);
    }

    fn begin_marking(&self, scope: Scope, pause: Pause) {
        self.is_marking.set(true);
        self.may_let_scripts_run.set(pause == Pause::Short);
        if scope == Scope::Eden {
            return;
        }
        (self.full_collection_count).update(|count| count.wrapping_add(1));
        if pause == Pause::Short {
            while self.clear_some_stale_marks() {}
            self.for_each_directory(Directory::will_swap_marks);
            self.marks.set(self.marks().other());
            self.has_swapped_marks.set(true);
        } else {
            self.for_each_directory(Directory::clear_marks);
            for allocation in self.precise.borrow().iter() {
                self.marks().remove_precise(allocation.cell());
            }
            self.remembered.borrow_mut().clear();
        }
        self.first_young_precise.set(0);
        // SAFETY: nothing is marking.
        unsafe { self.opaque_roots.get_mut() }.clear();
    }

    fn find_conservative_roots(&self, scope: Scope, stack_top: usize) -> Found {
        let vm = self.vm();
        let (blocks, precise) = (self.blocks.borrow(), self.precise.borrow());
        // The old ones are marked as it is.
        let first = if scope == Scope::Full || options().verify_gc {
            0
        } else {
            self.first_young_precise.get()
        };
        assert!(stack_top <= vm.stack_bounds().origin);
        let mut roots = ConservativeRoots::new(&blocks, &precise[first..], vm.code_address_range());
        // SAFETY: the stack of this thread, live allocations, and what the `Vm` vouches for.
        unsafe {
            roots.scan(stack_top, vm.stack_bounds().origin);
            root_alloc::for_each_range(|start, end| roots.scan(start, end));
            vm.for_each_conservative_range(|start, end| roots.scan(start, end));
        }
        self.scan_parked_stacks(&mut roots.found);
        roots.found
    }

    /// False if the deadline of the visitor came first.
    fn mark(
        &self,
        marking: &Marking,
        visitor: &mut Visitor,
        lists: &mut Lists,
        roots: &Found,
    ) -> bool {
        for &cell in &roots.cells {
            visitor.append_hidden_cell(cell);
        }
        for &base in &roots.auxiliary {
            // SAFETY: live.
            unsafe { visitor.mark_auxiliary(base) };
        }
        visitor.replace_root_reason(RootReason::ExecutingCode);
        (self.vm()).visit_code_on_stack(&roots.code_addresses, &roots.cells, visitor);
        visitor.replace_root_reason(RootReason::ProtectedValues);
        for &cell in self.protected.borrow().keys() {
            // SAFETY: kept alive so far.
            unsafe { visitor.append_word(cell as u64) };
        }
        visitor.replace_root_reason(RootReason::StrongHandles);
        self.strong_set.visit(visitor);
        self.vm().visit_roots(visitor);
        self.execute_constraints(visitor, false);
        self.mark_to_fixpoint(marking, visitor, lists)
    }

    fn execute_constraints(&self, visitor: &mut Visitor, depend_on_marking: bool) {
        visitor.replace_root_reason(RootReason::None);
        for constraint in self.constraints.borrow().iter() {
            if constraint.depends_on_marking == depend_on_marking {
                constraint.execute(visitor);
            }
        }
    }

    /// As `Marking::drain`.
    fn drain(&self, marking: &Marking, visitor: &mut Visitor, lists: &mut Lists) -> bool {
        loop {
            if !self.remembered.borrow().is_empty() {
                visitor.stack.push_run(lists.keep_remembered(self));
            }
            marking.take_changed(visitor);
            (visitor.stack.cells).append(&mut visitor.findings.put_off);
            if !marking.drain(visitor) {
                return false;
            }
            if self.remembered.borrow().is_empty()
                && visitor.findings.put_off.is_empty()
                && !marking.has_changed()
            {
                return true;
            }
        }
    }

    /// As `mark`.
    fn mark_to_fixpoint(
        &self,
        marking: &Marking,
        visitor: &mut Visitor,
        lists: &mut Lists,
    ) -> bool {
        /// A chain of entries of weak maps would take a round for each link.
        const ROUNDS_BEFORE_REMEMBERING_EPHEMERONS: usize = 8;
        visitor.stack.push_run(lists.keep_remembered(self));
        if !marking.drain(visitor) {
            return false;
        }
        marking.let_helpers_count_on_pause();
        if !self.drain(marking, visitor, lists) {
            return false;
        }
        lists.blocks.clear();
        for space in self.spaces_with_output_constraints.borrow().iter() {
            let directory = space.allocator.directory();
            (lists.blocks).extend(directory.into_iter().flat_map(Directory::blocks_in_use));
        }
        visitor.push_output_of_blocks(&lists.blocks);
        lists.chunks_of_weak_handles = self.weak_set.chunks(marking.scope);
        visitor.push_chunks_of_weak_handles(&lists.chunks_of_weak_handles);
        lists.handles_at_stake.clear();
        visitor.findings.handles_at_stake.clear();
        for round in 0.. {
            if round == ROUNDS_BEFORE_REMEMBERING_EPHEMERONS {
                visitor.start_remembering_ephemerons();
            }
            let visits = visitor.findings.visit_count;
            visitor.push_weak_handles(&lists.handles_at_stake);
            (lists.constraining_cells).append(&mut visitor.findings.output_constraints);
            (lists.ephemeron_tables).append(&mut visitor.findings.ephemeron_tables);
            if round == 0 && self.may_let_scripts_run.get() {
                drop_repetitions(&mut lists.constraining_cells);
                drop_repetitions(&mut lists.ephemeron_tables);
            }
            visitor.push_output_of_cells(&lists.constraining_cells);
            visitor.push_output_of_cells(&lists.ephemeron_tables);
            visitor.replace_root_reason(RootReason::Output);
            self.vm().visit_output_constraints(visitor);
            self.execute_constraints(visitor, true);
            if !self.drain(marking, visitor, lists) {
                return false;
            }
            (lists.handles_at_stake).append(&mut visitor.findings.handles_at_stake);
            if visitor.remembers_ephemerons() {
                lists.ephemeron_tables.clear();
            }
            if visitor.findings.visit_count == visits {
                break;
            }
        }
        true
    }

    /// Returns the addresses of the weak fields of all survivors.
    #[cold]
    fn verify_marking(&self, roots: &Found) -> Vec<usize> {
        let opaque_roots = OpaqueRoots::default();
        let marking = Marking::new(self, Scope::Full, Moment::default(), &opaque_roots, true);
        let mut visitor = Visitor::verifying(&marking, Verifier::new(self, true));
        self.mark(&marking, &mut visitor, &mut Lists::default(), roots);
        // What stays although nothing refers to it has to be whole as well.
        self.for_each_marked_cell(|cell| visitor.append_hidden_cell(cell));
        marking.drain(&mut visitor);
        self.for_each_directory(Directory::verify_marks);
        core::mem::take(&mut visitor.findings.weak_words)
    }

    /// What has been visited, and is not going to be visited again, refers only to what is marked. A later store would
    /// cover a missing barrier up. No helper is at work.
    #[cold]
    fn verify_progress(&self, cycle: &mut Cycle) {
        let mut pending = cycle.marking.cells_to_visit_again(&mut cycle.visitor);
        pending.extend(self.remembered.borrow().iter());
        let opaque_roots = OpaqueRoots::default();
        let marking = Marking::new(self, Scope::Full, Moment::default(), &opaque_roots, true);
        let mut visitor = Visitor::verifying(&marking, Verifier::new(self, false));
        self.for_each_marked_cell(|cell| {
            // SAFETY: marked.
            let class = unsafe { Gc::<JsCell>::from_address(cell) }.class();
            // Those of the embedder may leave it to their output constraints.
            if !pending.contains(&cell) && !class.is_of_embedder() {
                visitor.append_hidden_cell(cell);
            }
        });
        marking.drain(&mut visitor);
    }

    fn for_each_marked_cell(&self, mut visit: impl FnMut(usize)) {
        self.for_each_directory(|directory| {
            if directory.attributes().kind == AllocationKind::Cell {
                for block in directory.blocks_in_use() {
                    block.for_each_marked_cell(self.marks(), &mut visit);
                }
            }
        });
        for allocation in self.precise.borrow().iter() {
            if allocation.attributes.kind == AllocationKind::Cell && allocation.is_marked() {
                visit(allocation.cell());
            }
        }
    }

    #[cold]
    fn verify_weak_words(&self, addresses: &[usize]) {
        for &address in addresses {
            // SAFETY: inside a cell that has survived.
            let cell = unsafe { *core::ptr::with_exposed_provenance::<usize>(address) };
            let is_valid = cell == 0 || self.marks().contains(cell);
            assert!(
                is_valid,
                "the weak field at {address:#x} refers to {cell:#x}, which is dead"
            );
        }
    }

    fn end_marking(&self, scope: Scope, visitor: &mut Visitor) -> MarkedBytes {
        let mut blocks = Vec::new();
        self.for_each_directory(|directory| directory.add_blocks_to_count(scope, &mut blocks));
        visitor.count_marks(&blocks);
        let mut mark_counts = blocks.into_iter().map(Cell::into_inner);
        self.is_marking.set(false);
        self.may_let_scripts_run.set(false);
        self.free_retired_memory();
        let has_swapped_marks = self.has_swapped_marks.take();
        let version = next_version(self.allocation_version.get());
        let mut marked = MarkedBytes::default();
        self.for_each_directory(|directory| {
            if version == FIRST_VERSION {
                directory.blocks().for_each(Block::forget_version);
            }
            let bytes = directory.end_marking(scope, &mut mark_counts);
            marked.total += bytes.total;
            marked.late += bytes.late;
        });
        self.allocation_version.set(version);
        for allocation in &self.precise.borrow()[self.first_young_precise.get()..] {
            allocation.end_marking();
            if has_swapped_marks {
                self.marks().other().remove_precise(allocation.cell());
            }
            if allocation.is_marked() {
                marked.total += allocation.cell_size();
            }
        }
        self.steal_cursor.set(0);
        self.stale_cursor.set(0);
        self.reset_sweeper();
        marked
    }

    fn clear_weak_references(&self, survivors: &Survivors, findings: &Findings) {
        self.parked_stacks.prune(survivors);
        for &address in &findings.weak_words {
            // SAFETY: inside a cell that has survived.
            let word =
                unsafe { AtomicU64::from_ptr(core::ptr::with_exposed_provenance_mut(address)) };
            let cell = word.load(Ordering::Relaxed) as usize;
            if cell != 0 && !survivors.contains_address(cell) {
                word.store(0, Ordering::Relaxed);
            }
        }
        self.vm().will_reconcile_weak_references(survivors);
        for &cell in &findings.to_reconcile {
            // SAFETY: visited by this collection, and the method of its class.
            unsafe {
                let cell = Gc::<JsCell>::from_address(cell);
                (cell.class().ops().reconcile_weak_references)(&cell, survivors);
            }
        }
        self.vm().reconcile_weak_references(survivors);
    }

    /// Those that come after the first `examined` are new.
    fn sweep_precise_allocations(&self, examined: usize) {
        let first = self.first_young_precise.get();
        let mut precise = self.precise.borrow_mut();
        let dead: Vec<_> = (precise.extract_if(first..examined, |it| !it.is_marked())).collect();
        for (index, allocation) in precise.iter().enumerate().skip(first) {
            allocation.index.set(index as u32);
        }
        self.first_young_precise.set(examined - dead.len());
        drop(precise);
        let _state = self.enter_destruction();
        for allocation in dead {
            self.precise_bytes
                .update(|bytes| bytes - allocation.cell_size());
            // SAFETY: dead, and out of the list.
            unsafe {
                allocation.destroy_cell();
                allocation.free();
            }
        }
    }
}
