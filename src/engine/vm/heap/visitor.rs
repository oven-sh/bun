use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::sync::atomic::{AtomicU64, Ordering};

use super::block::Block;
use super::fast_marker::FastMarker;
use super::mark_stack::{MarkStack, RECORDS_PER_CHUNK, REVISIT, Run, RunKind, Share};
use super::marking::{Company, Marking, Milestone};
use super::marks::Marks;
use super::verifier::Verifier;
use super::weak::Chunk;
use super::{CellState, Gc, HeapAnalyzer, Moment, RootReason, Scope, WeakImpl, delay};
use crate::{CellKind, ClassOps, FastHashMap, FastHashSet, JsCell, Shape, ShapeId, Value};

pub(super) const MIN_RECORDS_TO_SHARE: usize = 2 * RECORDS_PER_CHUNK;

/// What a marker has found out besides marks.
#[derive(Default)]
pub(super) struct Findings {
    pub(super) visit_count: usize,
    pub(super) turn_count: usize,
    pub(super) extra_memory: usize,
    pub(super) weak_words: Vec<usize>,
    pub(super) to_reconcile: Vec<usize>,
    pub(super) output_constraints: Vec<usize>,
    pub(super) ephemeron_tables: Vec<usize>,
    pub(super) handles_at_stake: Vec<&'static WeakImpl>,
    pub(super) condemned_keys: usize,
    /// Entries for a mark stack, which have to wait until no script runs.
    pub(super) put_off: Vec<usize>,
    /// Those that wait until there is only one marker.
    pub(super) opaque_roots: FastHashSet<usize>,
}

impl Findings {
    pub(super) fn merge(&mut self, other: &mut Findings) {
        self.visit_count += core::mem::take(&mut other.visit_count);
        self.turn_count += core::mem::take(&mut other.turn_count);
        self.extra_memory = self
            .extra_memory
            .saturating_add(core::mem::take(&mut other.extra_memory));
        self.weak_words.append(&mut other.weak_words);
        self.to_reconcile.append(&mut other.to_reconcile);
        self.output_constraints
            .append(&mut other.output_constraints);
        self.ephemeron_tables.append(&mut other.ephemeron_tables);
        self.handles_at_stake.append(&mut other.handles_at_stake);
        self.condemned_keys += core::mem::take(&mut other.condemned_keys);
        self.put_off.append(&mut other.put_off);
        self.opaque_roots.extend(other.opaque_roots.drain());
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Edge {
    Visible,
    Hidden,
}

/// Marks cells. Each marking thread has one.
pub struct Visitor {
    pub(super) stack: MarkStack,
    /// For an analyzer or a verifier.
    looks_closely: bool,
    pub(super) company: Company,
    pub(super) is_helper: bool,
    /// Among the markers at work, ahead of `Marking::drain`.
    pub(super) is_counted: bool,
    pub(super) must_stop: bool,
    /// On the monotonic clock.
    pub(super) deadline: f64,
    pub(super) first_share: Option<Milestone>,
    pub(super) marks: Marks,
    is_first_visit: bool,
    pub(super) turns_since_sharing: u32,
    /// Only the first few are counted.
    pub(super) turns_since_accepting: u32,
    current_cell: usize,
    last_opaque_root: *const c_void,
    marking: *const Marking,
    pub(super) findings: Findings,
    /// In place of the marks of the heap.
    verifier: Option<Verifier>,
    /// The values that live if the key does. `None` while the tables are gone through again and again instead.
    ephemerons: Option<FastHashMap<usize, smallvec::SmallVec<[usize; 1]>>>,
}

impl Visitor {
    pub(super) fn new(marking: &Marking, stack: MarkStack) -> Visitor {
        Visitor {
            stack,
            looks_closely: !marking.analyzer.is_null(),
            company: Company::Nobody,
            is_helper: false,
            is_counted: false,
            must_stop: false,
            deadline: f64::INFINITY,
            first_share: None,
            marks: marking.marks,
            is_first_visit: false,
            turns_since_sharing: 0,
            turns_since_accepting: u32::MAX,
            current_cell: 0,
            last_opaque_root: core::ptr::null(),
            marking,
            findings: Findings::default(),
            verifier: None,
            ephemerons: None,
        }
    }

    pub(super) fn for_helper(marking: &Marking, stack: MarkStack) -> Visitor {
        Visitor {
            company: Company::Mutator,
            is_helper: true,
            ..Visitor::new(marking, stack)
        }
    }

    /// `marking` has one marker.
    pub(super) fn verifying(marking: &Marking, verifier: Verifier) -> Visitor {
        Visitor {
            looks_closely: true,
            verifier: Some(verifier),
            ..Visitor::new(marking, MarkStack::default())
        }
    }

    #[inline(always)]
    pub(super) fn marking(&self) -> &Marking {
        // SAFETY: a visitor is not used after its collection.
        unsafe { &*self.marking }
    }

    /// Whether a `FastMarker` can stand in.
    #[inline(always)]
    fn is_fast(&self) -> bool {
        !self.looks_closely
    }

    /// What the cell that is being visited refers to may change meanwhile.
    #[inline(always)]
    pub fn is_mutator_running(&self) -> bool {
        self.company == Company::Mutator
    }

    /// For what cannot be read while it may change. True if the cell will be visited again when it cannot.
    #[inline]
    pub fn puts_off_current_cell(&mut self) -> bool {
        if self.is_mutator_running() {
            self.did_race();
        }
        self.is_mutator_running()
    }

    pub fn scope(&self) -> Scope {
        self.marking().scope
    }

    pub(crate) fn moment(&self) -> Moment {
        self.marking().moment
    }

    /// What has been marked stays so while this is the same.
    pub fn epoch(&self) -> u32 {
        self.marking().epoch
    }

    /// Marking is over, and is being done again to check it. The scope is full, and no visit is the first.
    pub fn is_verifying(&self) -> bool {
        self.verifier.is_some()
    }

    #[inline(always)]
    pub fn append<T: CellKind>(&mut self, cell: Gc<T>) {
        self.append_cell(cell.address(), Edge::Visible);
    }

    #[inline(always)]
    pub fn append_value(&mut self, value: Value) {
        if value.is_cell() {
            self.append_cell(value.to_bits() as usize, Edge::Visible);
        }
    }

    /// # Safety
    /// Zero, or the bits of a value whose cell has not been freed.
    #[inline(always)]
    pub unsafe fn append_word(&mut self, word: u64) {
        if word & Value::NOT_CELL_MASK == 0 && word != 0 {
            self.append_cell(word as usize, Edge::Visible);
        }
    }

    #[inline(always)]
    pub(crate) fn append_shape(&mut self, id: ShapeId) {
        self.append_cell(id.address(), Edge::Visible);
    }

    /// An edge that a heap snapshot learns of in another way, or not at all.
    ///
    /// # Safety
    /// As for `append_word`.
    #[inline(always)]
    pub unsafe fn append_hidden_word(&mut self, word: u64) {
        if word & Value::NOT_CELL_MASK == 0 && word != 0 {
            self.append_cell(word as usize, Edge::Hidden);
        }
    }

    pub(super) fn append_hidden_cell(&mut self, cell: usize) {
        self.append_cell(cell, Edge::Hidden);
    }

    #[inline(always)]
    fn append_cell(&mut self, cell: usize, edge: Edge) {
        if self.looks_closely {
            self.append_closely(cell, edge);
        } else if !self.marks.contains(cell) {
            self.mark_and_push(cell);
        }
    }

    #[inline(never)]
    fn mark_and_push(&mut self, cell: usize) {
        if self.mark(cell) {
            self.stack.push(cell);
        }
    }

    /// Whether it was not marked.
    #[inline(always)]
    fn mark(&self, cell: usize) -> bool {
        if self.company == Company::Nobody {
            self.marks.add_exclusively(cell)
        } else {
            self.marks.add(cell)
        }
    }

    #[cold]
    #[inline(never)]
    fn append_closely(&mut self, cell: usize, edge: Edge) {
        let from = self.current_cell;
        if let Some(verifier) = &mut self.verifier {
            if verifier.reach_cell(from, cell) {
                self.stack.push(cell);
            }
            return;
        }
        if edge == Edge::Visible
            && let Some(analyzer) = self.analyzer()
        {
            analyzer.will_mark(from, cell);
        }
        self.mark_and_push(cell);
    }

    /// # Safety
    /// The start of an allocation of the auxiliary space that has not been freed.
    #[inline(always)]
    pub unsafe fn mark_auxiliary(&mut self, base: usize) {
        match &self.verifier {
            Some(verifier) => verifier.reach_auxiliary(self.current_cell, base),
            None => {
                self.mark(base);
            }
        }
    }

    /// Other markers may get a part of a long run.
    ///
    /// # Safety
    /// Each word is as for `append_word`, and the memory is that of the heap.
    #[inline(always)]
    pub unsafe fn append_hidden_words(&mut self, first: *const u64, count: usize) {
        // SAFETY: the caller's.
        unsafe { self.append_records::<1>(first, count, Edge::Hidden) }
    }

    /// The same, as edges that a heap snapshot sees.
    ///
    /// # Safety
    /// As above.
    #[inline(always)]
    pub unsafe fn append_words(&mut self, first: *const u64, count: usize) {
        // SAFETY: the caller's.
        unsafe { self.append_records::<1>(first, count, Edge::Visible) }
    }

    /// The same, of records of two or three words, the second of which is no value.
    ///
    /// # Safety
    /// As above.
    #[inline(always)]
    pub(crate) unsafe fn append_entries<const WORDS: usize>(
        &mut self,
        first: *const u64,
        count: usize,
    ) {
        // SAFETY: the caller's.
        unsafe { self.append_records::<WORDS>(first, count, Edge::Visible) }
    }

    #[inline(always)]
    unsafe fn append_records<const WORDS: usize>(
        &mut self,
        first: *const u64,
        count: usize,
        edge: Edge,
    ) {
        if count >= MIN_RECORDS_TO_SHARE && self.is_fast() {
            return self.put_off_records::<WORDS>(first, count);
        }
        for index in 0..count {
            delay::of_helper(64);
            for offset in [0, 2].into_iter().filter(|&offset| offset < WORDS) {
                // SAFETY: the caller's.
                let word =
                    unsafe { AtomicU64::from_ptr(first.add(index * WORDS + offset).cast_mut()) }
                        .load(Ordering::Relaxed);
                if word & Value::NOT_CELL_MASK == 0 && word != 0 {
                    self.append_cell(word as usize, edge);
                }
            }
        }
    }

    #[inline(never)]
    pub(super) fn put_off_records<const WORDS: usize>(&mut self, first: *const u64, count: usize) {
        let kind = const {
            match WORDS {
                1 => RunKind::Words,
                2 => RunKind::Keys,
                3 => RunKind::KeysAndValues,
                _ => unreachable!(),
            }
        };
        let first = first.expose_provenance();
        self.stack.push_run(Run { kind, first, count });
    }

    fn visit_records<const WORDS: usize>(&mut self, chunk: Run) {
        let first = core::ptr::with_exposed_provenance(chunk.first);
        // SAFETY: promised to `append_records`.
        unsafe {
            let queue = &mut [0; _];
            if self.company == Company::Nobody {
                let mut marker = FastMarker::<{ Company::Nobody }>::new(self, queue);
                marker.append_records::<WORDS>(first, chunk.count);
                marker.finish();
            } else {
                let mut marker = FastMarker::<{ Company::Markers }>::new(self, queue);
                marker.append_records::<WORDS>(first, chunk.count);
                marker.finish();
            }
        }
    }

    /// The slice stays as it is until the stack has been drained. So for the next three.
    pub(super) fn push_weak_handles(&mut self, handles: &[&'static WeakImpl]) {
        self.stack.push_run(Run::of(RunKind::WeakHandles, handles));
    }

    /// Those whose target is not marked go to the findings.
    pub(super) fn push_chunks_of_weak_handles(&mut self, chunks: &[&'static Chunk]) {
        (self.stack).push_run(Run::of(RunKind::ChunksOfWeakHandles, chunks));
    }

    pub(super) fn push_output_of_cells(&mut self, cells: &[usize]) {
        self.stack.push_run(Run::of(RunKind::OutputOfCells, cells));
    }

    pub(super) fn push_output_of_blocks(&mut self, blocks: &[&'static Block]) {
        self.stack
            .push_run(Run::of(RunKind::OutputOfBlocks, blocks));
    }

    fn visit_remembered(&mut self, chunk: Run, cells: &[usize]) {
        for &cell in cells {
            // SAFETY: nothing has been freed since.
            unsafe { Gc::<JsCell>::from_address(cell) }.set_state(CellState::PossiblyBlack);
        }
        if self.is_mutator_running() {
            // A store that the barrier has just passed over may not have arrived.
            delay::of_helper(2);
            let kind = RunKind::Changed;
            self.marking().add_changed(Run { kind, ..chunk });
        } else {
            self.visit_changed(cells);
        }
    }

    /// The others will be visited for the first time, if at all.
    fn visit_changed(&mut self, cells: &[usize]) {
        let marked = (cells.iter()).filter(|&&cell| self.marks.contains_by_now(cell));
        self.stack.cells.extend(marked.map(|cell| cell | REVISIT));
    }

    pub(super) fn accept(&mut self, share: Share) {
        self.stack.accept(share);
        (self.turns_since_accepting, self.turns_since_sharing) = (0, 0);
    }

    fn visit_weak_handles(&mut self, handles: &[&WeakImpl]) {
        let reason = self.replace_root_reason(RootReason::WeakSets);
        self.did_finish_draining();
        for handle in handles {
            handle.visit(self);
        }
        self.replace_root_reason(reason);
    }

    fn visit_output(&mut self, address: usize, reason: RootReason) {
        let reason = self.replace_root_reason(reason);
        // SAFETY: marked.
        let cell = unsafe { Gc::<JsCell>::from_address(address) };
        (self.current_cell, self.is_first_visit) = (address, false);
        self.visit_with(cell, |ops| ops.visit_output_constraints);
        self.replace_root_reason(reason);
    }

    #[inline]
    pub fn is_marked<T>(&self, cell: Gc<T>) -> bool {
        self.is_address_marked(cell.address())
    }

    #[inline]
    pub(crate) fn is_address_marked(&self, cell: usize) -> bool {
        match &self.verifier {
            Some(verifier) => verifier.has_reached(cell),
            None => self.marks.contains(cell),
        }
    }

    /// The word becomes zero if the cell in it is not marked when marking ends.
    ///
    /// # Safety
    /// The word is zero or the address of a cell, and stays where it is until this collection ends.
    pub unsafe fn append_weak_word(&mut self, word: &AtomicU64) {
        let cell = word.load(Ordering::Relaxed) as usize;
        if cell != 0 && (self.is_verifying() || !self.marks.contains(cell)) {
            self.findings
                .weak_words
                .push(word.as_ptr().expose_provenance());
        }
    }

    /// Has `reconcile_weak_references` of the cell that is being visited called when marking ends.
    pub fn reconcile_current_cell_later(&mut self) {
        self.findings.to_reconcile.push(self.current_cell);
    }

    /// Has `visit_output_constraints` of the cell that is being visited called, on any thread, until it marks nothing
    /// new.
    pub fn constrain_by_current_cell(&mut self) {
        self.findings.output_constraints.push(self.current_cell);
    }

    /// The same, for a method that does nothing but `append_ephemerons`.
    pub(crate) fn constrain_by_ephemerons_of_current_cell(&mut self) {
        self.findings.ephemeron_tables.push(self.current_cell);
    }

    /// Records of three words. The value in the last lives if the cell in the first does. There is none if that word
    /// is zero or odd.
    ///
    /// # Safety
    /// The memory stays until marking ends, and has words of these kinds, as of some time since it began.
    pub(crate) unsafe fn append_ephemerons(&mut self, first: *const u64, count: usize) {
        let (kind, first) = (RunKind::Ephemerons, first.expose_provenance());
        let run = Run { kind, first, count };
        if count >= MIN_RECORDS_TO_SHARE && self.is_fast() {
            self.stack.push_run(run);
        } else {
            self.visit_ephemerons(run);
        }
    }

    fn visit_ephemerons(&mut self, run: Run) {
        let first = core::ptr::with_exposed_provenance_mut::<u64>(run.first);
        for index in 0..run.count {
            // SAFETY: promised to `append_ephemerons`.
            let [key, value] = [0, 2].map(|offset| unsafe {
                AtomicU64::from_ptr(first.add(index * 3 + offset)).load(Ordering::Relaxed)
            });
            if key == 0 || key & 1 != 0 || value & Value::NOT_CELL_MASK != 0 {
                continue;
            }
            let (key, value) = (key as usize, value as usize);
            if self.is_address_marked(key) {
                self.append_cell(value, Edge::Visible);
            } else if let Some(ephemerons) = &mut self.ephemerons {
                ephemerons.entry(key).or_default().push(value);
            }
        }
    }

    /// Replaces the address of each block with the number of its marks. Marking has ended.
    pub(super) fn count_marks(&mut self, blocks: &[Cell<usize>]) {
        self.see_to(Run::of(RunKind::BlocksToCount, blocks));
    }

    /// With the helpers, if it is worth it. Nothing else is left to do.
    fn see_to(&mut self, run: Run) {
        if run.count < MIN_RECORDS_TO_SHARE {
            return self.visit_run(run);
        }
        self.stack.push_run(run);
        // SAFETY: as in `marking`.
        unsafe { &*self.marking }.drain(self);
    }

    fn condemn_keys<const WORDS: usize>(&mut self, run: Run) {
        let first = core::ptr::with_exposed_provenance_mut::<u64>(run.first);
        for index in 0..run.count {
            // SAFETY: promised to `Survivors::condemn_keys`.
            unsafe {
                let key = first.add(index * WORDS);
                if *key != 0 && *key & 1 == 0 && !self.marks.contains(*key as usize) {
                    *key |= 1;
                    if WORDS == 3 {
                        *key.add(2) = Value::UNDEFINED.to_bits();
                    }
                    self.findings.condemned_keys += 1;
                }
            }
        }
    }

    /// From now on this visitor does all that is left by itself, and has to see each table only once more.
    pub(super) fn start_remembering_ephemerons(&mut self) {
        self.ephemerons.get_or_insert_default();
        self.deadline = f64::INFINITY;
    }

    pub(super) fn remembers_ephemerons(&self) -> bool {
        self.ephemerons.is_some()
    }

    /// Memory outside the heap that the cell being visited owns.
    #[inline]
    pub fn report_extra_memory(&mut self, bytes: usize) {
        if self.is_first_visit {
            self.findings.extra_memory = self.findings.extra_memory.saturating_add(bytes);
        }
    }

    pub fn is_first_visit(&self) -> bool {
        self.is_first_visit
    }

    #[inline]
    pub fn with_current_cell_locked<R>(&mut self, body: impl FnOnce(&mut Visitor) -> R) -> R {
        if !self.is_mutator_running() || self.current_cell == 0 {
            return body(self);
        }
        // SAFETY: it is being visited.
        let cell = unsafe { Gc::<JsCell>::from_address(self.current_cell) };
        let _lock = cell.lock();
        body(self)
    }

    /// The cell was caught in the middle of a change, so it is visited again.
    #[cold]
    pub(crate) fn did_race(&mut self) {
        let entry = self.current_cell | if self.is_first_visit { 0 } else { REVISIT };
        self.findings.put_off.push(entry);
    }

    /// Whether the root is new, as far as this marker knows.
    pub fn add_opaque_root(&mut self, root: *const c_void) -> bool {
        if root.is_null() || root == self.last_opaque_root {
            return false;
        }
        self.last_opaque_root = root;
        let is_new = if self.company == Company::Nobody {
            // SAFETY: alone.
            unsafe { self.marking().opaque_roots().get_mut() }.insert(root.addr())
        } else {
            !self.marking().opaque_roots().contains(root.addr())
                && self.findings.opaque_roots.insert(root.addr())
        };
        self.findings.visit_count += usize::from(is_new);
        is_new
    }

    /// What another marker has just added may be missing, so this is for what is asked again until nothing changes.
    pub fn contains_opaque_root(&self, root: *const c_void) -> bool {
        self.marking().opaque_roots().contains(root.addr())
            || self.findings.opaque_roots.contains(&root.addr())
    }

    pub fn analyzer(&mut self) -> Option<&mut HeapAnalyzer> {
        // SAFETY: with an analyzer there is one marker, and it outlives the collection.
        unsafe { self.marking().analyzer.as_mut() }
    }

    /// Attributes what `body` appends to `cell`.
    pub fn with_referrer<R>(&mut self, cell: &JsCell, body: impl FnOnce(&mut Visitor) -> R) -> R {
        let old = core::mem::replace(&mut self.current_cell, cell.address());
        let result = body(self);
        self.current_cell = old;
        result
    }

    /// For C++, which restores the old one in a destructor.
    pub fn replace_referrer(&mut self, cell: usize) -> usize {
        core::mem::replace(&mut self.current_cell, cell)
    }

    /// What a heap snapshot says of the roots that are appended from now on. Returns the old one.
    pub fn replace_root_reason(&mut self, reason: RootReason) -> RootReason {
        self.analyzer().map_or(RootReason::None, |analyzer| {
            core::mem::replace(&mut analyzer.root_reason, reason)
        })
    }

    fn visit_cell(&mut self, address: usize, is_first_visit: bool) {
        // SAFETY: marked.
        let cell = unsafe { Gc::<JsCell>::from_address(address) };
        (self.current_cell, self.is_first_visit) = (address, is_first_visit);
        self.findings.visit_count += 1;
        cell.set_state(CellState::PossiblyBlack);
        self.visit_with(cell, |ops| ops.visit_children);
    }

    #[inline(always)]
    fn visit_with(
        &mut self,
        cell: Gc<JsCell>,
        method: impl Fn(&ClassOps) -> unsafe extern "C" fn(&JsCell, &mut Visitor),
    ) {
        delay::of_helper(40);
        // SAFETY: the shape that a cell keeps alive, and a method of its class.
        unsafe {
            let shape = cell.shape_id_concurrently().address();
            let class = Gc::<Shape>::from_address(shape).class();
            if class.is_of_embedder() && self.company != Company::Nobody {
                cell.without_other_visitors(|| method(class.ops())(&cell, self));
            } else {
                method(class.ops())(&cell, self);
            }
        }
    }

    /// It is black.
    #[inline(always)]
    pub(super) fn visit_through_class(&mut self, cell: Gc<JsCell>, is_first_visit: bool) {
        (self.current_cell, self.is_first_visit) = (cell.address(), is_first_visit);
        self.visit_with(cell, |ops| ops.visit_children);
    }

    /// False if there is none.
    fn visit_chunk(&mut self) -> bool {
        let Some(chunk) = self.stack.pop_chunk() else {
            return false;
        };
        let is_pause_certain =
            !self.is_mutator_running() && (self.is_helper || self.marking().is_pause_certain());
        if chunk.kind.can_be_visited_while_scripts_run() || is_pause_certain {
            self.visit_run(chunk);
        }
        true
    }

    #[inline(always)]
    fn visit_run(&mut self, chunk: Run) {
        delay::of_helper(2);
        // SAFETY: each is what the method that has pushed it has been given.
        unsafe {
            match chunk.kind {
                RunKind::Words => self.visit_records::<1>(chunk),
                RunKind::Keys => self.visit_records::<2>(chunk),
                RunKind::KeysAndValues => self.visit_records::<3>(chunk),
                RunKind::Ephemerons => self.visit_ephemerons(chunk),
                RunKind::Remembered => self.visit_remembered(chunk, chunk.items()),
                RunKind::Changed => self.visit_changed(chunk.items()),
                RunKind::OutputOfCells => {
                    for &cell in chunk.items() {
                        self.visit_output(cell, RootReason::Output);
                    }
                }
                RunKind::OutputOfBlocks => {
                    for block in chunk.items::<&Block>() {
                        block.for_each_marked_cell(self.marks, |cell| {
                            if self.is_address_marked(cell) {
                                self.visit_output(cell, RootReason::Embedder);
                            }
                        });
                    }
                }
                RunKind::ChunksOfWeakHandles => {
                    for chunk in chunk.items::<&Chunk>() {
                        let mut handles = core::mem::take(&mut self.findings.handles_at_stake);
                        let known = handles.len();
                        handles.extend(
                            chunk
                                .live()
                                .filter(|it| !self.is_address_marked(it.target())),
                        );
                        self.visit_weak_handles(&handles[known..]);
                        self.findings.handles_at_stake = handles;
                    }
                }
                RunKind::WeakHandles => self.visit_weak_handles(chunk.items()),
                RunKind::WeakKeys => self.condemn_keys::<2>(chunk),
                RunKind::WeakKeysWithValues => self.condemn_keys::<3>(chunk),
                RunKind::BlocksToCount => {
                    for block in chunk.items::<Cell<usize>>() {
                        block.set(self.marks.count_in_block(block.get()));
                    }
                }
            }
        }
    }

    #[inline(never)]
    pub(super) fn visit_chunk_and_end_turn(&mut self) -> bool {
        self.visit_chunk();
        self.did_take_turn()
    }

    /// Whether to stop for now.
    #[inline(never)]
    pub(super) fn did_take_turn(&mut self) -> bool {
        // SAFETY: as in `marking`.
        unsafe { &*self.marking }.did_take_turn(self)
    }

    /// May stop early.
    pub(super) fn drain(&mut self) {
        #[inline(never)]
        fn drain_quickly<const COMPANY: Company>(visitor: &mut Visitor) {
            FastMarker::<COMPANY>::new(visitor, &mut [0; _]).drain();
        }
        if !self.is_fast() || self.remembers_ephemerons() {
            return self.drain_slowly();
        }
        match self.company {
            Company::Nobody => drain_quickly::<{ Company::Nobody }>(self),
            Company::Markers => drain_quickly::<{ Company::Markers }>(self),
            Company::Mutator => drain_quickly::<{ Company::Mutator }>(self),
        }
    }

    #[cold]
    fn drain_slowly(&mut self) {
        loop {
            let Some(entry) = self.stack.pop() else {
                if self.visit_chunk() {
                    continue;
                }
                return;
            };
            let cell = entry & !REVISIT;
            self.visit_cell(cell, entry == cell && !self.is_verifying());
            if let Some(values) = self.ephemerons.as_mut().and_then(|it| it.remove(&cell)) {
                let reason = self.replace_root_reason(RootReason::Output);
                for value in values {
                    self.append_cell(value, Edge::Visible);
                }
                self.replace_root_reason(reason);
            }
        }
    }

    pub(super) fn did_finish_draining(&mut self) {
        self.current_cell = 0;
        self.is_first_visit = false;
    }
}

/// Says which cells have survived the marking that just ended.
pub struct Survivors {
    pub(super) scope: Scope,
    pub(super) marks: Marks,
    pub(super) vm: *const crate::Vm,
    /// For what is worth sharing with the helpers.
    pub(super) visitor: RefCell<Visitor>,
}

impl Survivors {
    #[inline]
    pub fn contains<T>(&self, cell: Gc<T>) -> bool {
        self.contains_address(cell.address())
    }

    /// Of a cell that was alive when the collection began.
    #[inline]
    pub fn contains_address(&self, cell: usize) -> bool {
        self.marks.contains(cell)
    }

    /// In records of two or three words, makes the first odd if it is the address of a cell that has died, and the
    /// third undefined. Returns how many those are.
    ///
    /// # Safety
    /// The first word is zero, odd, or as for `contains_address`.
    pub(crate) unsafe fn condemn_keys<const WORDS: usize>(
        &self,
        first: *const u64,
        count: usize,
    ) -> usize {
        let kind = match WORDS {
            2 => RunKind::WeakKeys,
            _ => RunKind::WeakKeysWithValues,
        };
        let (first, visitor) = (first.expose_provenance(), &mut *self.visitor.borrow_mut());
        visitor.see_to(Run { kind, first, count });
        core::mem::take(&mut visitor.findings.condemned_keys)
    }

    /// Memory outside the heap that a survivor owns, and that its visit has not reported.
    pub fn report_extra_memory(&self, bytes: usize) {
        self.vm().heap.did_find_extra_memory(bytes);
    }

    #[inline]
    pub fn contains_value(&self, value: Value) -> bool {
        value.as_cell().is_none_or(|cell| self.contains(cell))
    }

    #[inline]
    pub fn contains_shape(&self, id: ShapeId) -> bool {
        self.marks.contains(id.address())
    }

    pub fn scope(&self) -> Scope {
        self.scope
    }

    /// Nothing may be allocated.
    pub fn vm(&self) -> &crate::Vm {
        // SAFETY: the collection runs inside a call that has it.
        unsafe { &*self.vm }
    }
}
