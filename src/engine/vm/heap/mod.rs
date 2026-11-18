//! The garbage-collected heap.

mod activity;
mod allocator;
mod analyzer;
pub mod barrier;
mod block;
mod block_memory;
mod block_set;
mod cell;
mod collector;
mod concurrent;
mod conservative;
mod container;
pub(crate) mod delay;
mod directory;
mod fast_marker;
mod field;
mod gc;
mod iteration;
mod mark_stack;
mod marking;
mod marks;
mod once_box;
mod parked_stack;
mod policy;
mod precise;
mod root_alloc;
mod root_stack;
mod space;
pub mod stack;
mod statistics;
mod strong;
mod sweeper;
mod trace;
mod value_vec;
mod verifier;
pub mod virtual_memory;
mod visitor;
mod weak;
mod weak_map;

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use std::collections::VecDeque;

use bun_engine_macros::FieldOffsets;

pub use allocator::Allocator;
pub use analyzer::{HeapAnalyzer, HeapGraphSink, HeapObserver, MarkingConstraint, RootReason};
pub use block::{ATOM_SIZE, BLOCK_SIZE, Block, PAYLOAD_SIZE};
pub use block_memory::shape_base;
pub use cell::{CellState, JsCell};
pub use collector::{Callback, Request};
pub(crate) use fast_marker::Marker;
pub use field::{
    Field, FieldArray, FieldValue, GcCell, GcRef, GcRefMut, Owned, OwnedField, PlainKey, TracedMap,
    TracedVec, WeakField,
};
pub(crate) use gc::keep_alive;
pub use gc::{CellKind, Extends, Gc, GcFree, Held, Never};
pub use marking::is_helper_thread;
pub use once_box::OnceBox;
pub use parked_stack::ParkedStack;
pub(crate) use policy::Moment;
pub use policy::{HeapKind, HeapSizes};
pub use precise::{PRECISE_BIT, PreciseAllocation};
pub use root_alloc::{
    RootAlloc, RootBox, RootDeque, RootMap, RootSet, RootVec, free_root_words, root_box, root_vec,
    try_allocate_root_words,
};
pub use root_stack::RootStack;
pub use space::{
    EXACT_CUTOFF, IsoSpace, LARGE_CUTOFF, SIZE_CLASS_CHECKSUM, SIZE_CLASS_COUNT,
    SIZE_CLASS_OF_STEP, Space, optimal_size, size_class,
};
pub use strong::{Strong, duplicate_strong_slot, free_strong_slot};
pub use trace::{Trace, destroy, select_trace, visit_children_of};
pub use value_vec::ValueVec;
pub use visitor::{Survivors, Visitor};
pub use weak::{Weak, WeakImpl, WeakOwner};
pub(crate) use weak_map::{WeakCellSet, WeakValueMap};

use crate::{FastHashMap, JsRopeString, JsString, Shape, Value, Vm, object, options};
use block::Version;
use block_memory::BlockSource;
use block_set::BlockSet;
use container::Container;
use marks::Marks;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Scope {
    /// Only what has been allocated since the last collection can die.
    Eden,
    Full,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum MutatorState {
    Running,
    Sweeping,
    Collecting,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum AllocationKind {
    Cell,
    /// Memory without a header, which the cell that owns it marks and traces.
    Auxiliary,
}

pub type DestroyFunction = unsafe extern "C" fn(*mut JsCell);
pub type Finalizer = unsafe extern "C" fn(cell: *mut JsCell, context: *mut c_void);

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum Destruction {
    ByFunction,
    /// The sweeper knows the function.
    OfStrings,
    /// The same, but only in a block that has asked for it.
    OnRequest,
}

#[derive(Clone, Copy)]
pub(crate) struct CellAttributes {
    kind: AllocationKind,
    destruction: Destruction,
    destroy: Option<DestroyFunction>,
}

impl CellAttributes {
    const fn new(kind: AllocationKind, destroy: Option<DestroyFunction>) -> CellAttributes {
        CellAttributes {
            kind,
            destruction: Destruction::ByFunction,
            destroy,
        }
    }

    const fn cell(destroy: Option<DestroyFunction>) -> CellAttributes {
        Self::new(AllocationKind::Cell, destroy)
    }

    const fn string(destruction: Destruction) -> CellAttributes {
        CellAttributes {
            destruction,
            ..Self::cell(Some(destroy::<JsString>))
        }
    }

    fn destroys_every_cell(self) -> bool {
        self.destroy.is_some() && self.destruction != Destruction::OnRequest
    }
}

#[derive(FieldOffsets)]
#[repr(C)]
pub struct Heap {
    /// A store into a cell whose state is at most this takes the slow path of the write barrier.
    pub barrier_threshold: Cell<u32>,
    /// Markers may be at work. See `concurrent`.
    pub mutator_should_be_fenced: Cell<bool>,
    state: Cell<MutatorState>,
    did_defer_collection: Cell<bool>,
    /// With assertions: C++ has allocated a cell that cannot be visited yet.
    is_constructing_cell: Cell<bool>,
    deferral_depth: Cell<u32>,

    pub strings: IsoSpace,
    pub rope_strings: IsoSpace,
    pub shapes: IsoSpace,
    /// Cells that need no destruction.
    pub cells: Space,
    pub auxiliary: Space,
    /// Objects that have their class in a field.
    pub destructible_objects: Space,
    /// Cells whose shape lives as long as the heap.
    pub destructible_cells: Space,

    #[expect(clippy::vec_box, reason = "handed out by address")]
    iso_spaces: RefCell<Vec<Box<IsoSpace>>>,
    spaces_with_output_constraints: RefCell<Vec<&'static IsoSpace>>,
    allocators: RefCell<Vec<&'static Allocator>>,
    steal_cursor: Cell<usize>,
    sweeper: sweeper::Sweeper,
    /// A block is being swept.
    is_destroying_cells: Cell<bool>,
    blocks: RefCell<BlockSet>,
    precise: RefCell<Vec<&'static PreciseAllocation>>,
    /// The precise allocations from here on are new since the last collection.
    first_young_precise: Cell<usize>,
    precise_bytes: Cell<usize>,

    full_collection_count: Cell<u32>,
    allocation_version: Cell<Version>,
    marks: Cell<Marks>,
    is_marking: Cell<bool>,
    /// These two are said of the collection that is under way.
    may_let_scripts_run: Cell<bool>,
    has_swapped_marks: Cell<bool>,
    stale_cursor: Cell<usize>,
    /// Between its pauses.
    cycle: RefCell<Option<Box<collector::Cycle>>>,
    requests: RefCell<VecDeque<Request>>,
    request_timer: activity::HeapTimer,
    /// Each with the cells that are hidden in it, which have all been allocated.
    blocks_to_reveal: RefCell<Vec<(&'static Block, marks::Bits)>>,
    first_hidden_precise: Cell<usize>,
    retired_memory: RefCell<Vec<*mut c_void>>,
    collection_scope: Cell<Option<Scope>>,
    last_collection_scope: Cell<Option<Scope>>,
    remembered: RefCell<Vec<usize>>,
    spare_mark_stack: Cell<mark_stack::MarkStack>,
    opaque_roots: marking::OpaqueRoots,
    analyzer: Cell<*mut HeapAnalyzer>,

    strong_set: strong::StrongSet,
    weak_set: weak::WeakSet,
    protected: RefCell<FastHashMap<usize, u32>>,
    parked_stacks: parked_stack::ParkedStacks,
    observers: RefCell<Vec<*const HeapObserver>>,
    constraints: RefCell<Vec<MarkingConstraint>>,

    policy: policy::Policy,
    activity: activity::Activity,
}

pub(crate) struct StateGuard<'a> {
    heap: &'a Heap,
    previous: MutatorState,
}

impl Drop for StateGuard<'_> {
    fn drop(&mut self) {
        self.heap.state.set(self.previous);
    }
}

struct DestructionGuard<'a>(StateGuard<'a>);

impl Drop for DestructionGuard<'_> {
    fn drop(&mut self) {
        self.0.heap.is_destroying_cells.set(false);
    }
}

/// No collection runs while it is alive. One that has become due runs at the next opportunity.
pub struct DeferCollection<'a>(&'a Heap);

impl Drop for DeferCollection<'_> {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: begun by `defer_collection`.
        unsafe { self.0.end_deferral() }
    }
}

impl Heap {
    pub const OFFSET_OF_BARRIER_THRESHOLD: usize = core::mem::offset_of!(Heap, barrier_threshold);

    /// What a `Vm` sets aside for it.
    pub const SIZE_LIMIT: usize = 10240;

    pub(crate) fn new(kind: HeapKind) -> Heap {
        block_memory::initialize();
        let strings = |size, destruction| {
            let attributes = CellAttributes::string(destruction);
            IsoSpace::new(size, attributes, BlockSource::General)
        };
        let first_version = options().initial_heap_version.max(block::FIRST_VERSION);
        Heap {
            barrier_threshold: Cell::new(u32::from(barrier::BLACK_THRESHOLD)),
            mutator_should_be_fenced: Cell::new(false),
            state: Cell::new(MutatorState::Running),
            did_defer_collection: Cell::new(false),
            is_constructing_cell: Cell::new(false),
            deferral_depth: Cell::new(0),
            strings: strings(size_of::<JsString>(), Destruction::OfStrings),
            rope_strings: strings(size_of::<JsRopeString>(), Destruction::OnRequest),
            shapes: IsoSpace::new(
                size_of::<Shape>(),
                CellAttributes::cell(Some(destroy::<Shape>)),
                BlockSource::Shapes,
            ),
            cells: Space::new(CellAttributes::cell(None)),
            auxiliary: Space::new(CellAttributes::new(AllocationKind::Auxiliary, None)),
            destructible_objects: Space::new(CellAttributes::cell(Some(
                object::destroy_by_class_field,
            ))),
            destructible_cells: Space::new(CellAttributes::cell(Some(object::destroy_by_shape))),
            iso_spaces: RefCell::default(),
            spaces_with_output_constraints: RefCell::default(),
            allocators: RefCell::default(),
            steal_cursor: Cell::new(0),
            sweeper: sweeper::Sweeper::default(),
            is_destroying_cells: Cell::new(false),
            blocks: RefCell::new(BlockSet::new()),
            precise: RefCell::default(),
            first_young_precise: Cell::new(0),
            precise_bytes: Cell::new(0),
            full_collection_count: Cell::new(0),
            allocation_version: Cell::new(first_version),
            marks: Cell::default(),
            is_marking: Cell::new(false),
            may_let_scripts_run: Cell::new(false),
            has_swapped_marks: Cell::new(false),
            stale_cursor: Cell::new(0),
            cycle: RefCell::default(),
            requests: RefCell::default(),
            request_timer: activity::HeapTimer::default(),
            blocks_to_reveal: RefCell::default(),
            first_hidden_precise: Cell::new(0),
            retired_memory: RefCell::default(),
            collection_scope: Cell::new(None),
            last_collection_scope: Cell::new(None),
            remembered: RefCell::default(),
            spare_mark_stack: Cell::default(),
            opaque_roots: marking::OpaqueRoots::default(),
            analyzer: Cell::new(core::ptr::null_mut()),
            strong_set: strong::StrongSet::default(),
            weak_set: weak::WeakSet::default(),
            protected: RefCell::default(),
            parked_stacks: parked_stack::ParkedStacks::default(),
            observers: RefCell::default(),
            constraints: RefCell::default(),
            policy: policy::Policy::new(kind),
            activity: activity::Activity::default(),
        }
    }

    #[inline(always)]
    pub fn vm(&self) -> &Vm {
        let address = core::ptr::from_ref(self).addr() - core::mem::offset_of!(Vm, heap);
        // SAFETY: a heap exists only as that field of a `Vm`, whose provenance is exposed.
        unsafe { &*core::ptr::with_exposed_provenance(address) }
    }

    pub fn mutator_state(&self) -> MutatorState {
        self.state.get()
    }

    pub fn collection_scope(&self) -> Option<Scope> {
        self.collection_scope.get()
    }

    pub fn last_collection_scope(&self) -> Option<Scope> {
        self.last_collection_scope.get()
    }

    #[inline(always)]
    fn marks(&self) -> Marks {
        self.marks.get()
    }

    /// Those that say what has survived the last collection.
    #[inline]
    fn last_marks(&self) -> Marks {
        if self.has_swapped_marks.get() {
            return self.marks().other();
        }
        debug_assert!(!self.is_marking.get() || self.collection_scope() == Some(Scope::Eden));
        self.marks()
    }

    fn enter_destruction(&self) -> DestructionGuard<'_> {
        assert!(!self.is_destroying_cells.replace(true));
        DestructionGuard(self.enter_state(MutatorState::Sweeping))
    }

    /// For dropping what is no cell, so that a destructor of the embedder can tell that no script may run.
    pub(crate) fn as_part_of_sweeping(&self, release: impl FnOnce()) {
        let _state = self.enter_state(MutatorState::Sweeping);
        release();
    }

    pub(crate) fn enter_state(&self, state: MutatorState) -> StateGuard<'_> {
        StateGuard {
            heap: self,
            previous: self.state.replace(state),
        }
    }

    fn register_allocator(&self, allocator: &Allocator) {
        // SAFETY: a part of the heap or of a space that it owns, which does not move.
        let allocator = unsafe { &*core::ptr::from_ref(allocator) };
        self.allocators.borrow_mut().push(allocator);
    }

    fn for_each_directory(&self, mut visit: impl FnMut(&directory::Directory)) {
        let mut index = 0;
        loop {
            let Some(&allocator) = self.allocators.borrow().get(index) else {
                return;
            };
            allocator.directory().into_iter().for_each(&mut visit);
            index += 1;
        }
    }

    pub fn create_iso_space(&self, size: usize, destroy: Option<DestroyFunction>) -> &IsoSpace {
        let attributes = CellAttributes::cell(destroy);
        self.keep_iso_space(IsoSpace::new(size, attributes, BlockSource::General))
    }

    /// For a type that extends `Shape`.
    pub(crate) fn create_iso_space_for_shapes(
        &self,
        size: usize,
        destroy: DestroyFunction,
    ) -> &IsoSpace {
        let attributes = CellAttributes::cell(Some(destroy));
        self.keep_iso_space(IsoSpace::new(size, attributes, BlockSource::Shapes))
    }

    fn keep_iso_space(&self, space: IsoSpace) -> &IsoSpace {
        let space = Box::new(space);
        let address = core::ptr::from_ref(&*space);
        self.iso_spaces.borrow_mut().push(space);
        // SAFETY: boxed, and kept until the heap goes.
        unsafe { &*address }
    }

    /// The cells get references without a barrier, which `visit_output_constraints` shows. Panics unless the heap made
    /// the space.
    pub fn constrain_by_cells_in(&self, space: &IsoSpace) {
        assert!((self.iso_spaces.borrow().iter()).any(|it| core::ptr::eq(&raw const **it, space)));
        // SAFETY: lives as long as the heap.
        let space = unsafe { &*core::ptr::from_ref(space) };
        self.spaces_with_output_constraints.borrow_mut().push(space);
    }

    fn steal_block(&self) -> Option<usize> {
        loop {
            let cursor = self.steal_cursor.get();
            let allocator = *self.allocators.borrow().get(cursor)?;
            if allocator.source == BlockSource::General
                && let Some(block) = allocator.directory().and_then(|it| it.take_empty_block())
            {
                return Some(block);
            }
            self.steal_cursor.set(cursor + 1);
        }
    }

    /// In a block of the directory, in an empty one of another, or in a new one.
    fn find_free_cells(&self, directory: &directory::Directory) -> Option<directory::FreeCells> {
        if let found @ Some(_) = directory.resume_allocating() {
            return found;
        }
        if !self.is_marking.get() {
            self.clear_some_stale_marks();
        }
        self.free_some_surplus_blocks();
        let source = directory.allocator().source;
        let mut memory = None;
        // A finalizer that has yet to run counts on the dead being as they were.
        if self.mutator_state() == MutatorState::Running {
            if let found @ Some(_) = directory.find_free_cells() {
                return found;
            }
            if source == BlockSource::General {
                memory = self.steal_block();
            }
        }
        let memory = memory.or_else(|| {
            let block = source.allocate()?;
            self.blocks.borrow_mut().add(block);
            Some(block)
        })?;
        // SAFETY: empty, and in no directory.
        unsafe { directory.add_block(memory) }
    }

    /// For a cell of a space whose cells do not all need it.
    #[inline]
    pub(crate) fn request_destruction(cell: &JsCell) {
        if let Container::Block(block) = container::of(cell.address())
            && block.request_destruction()
        {
            block.directory().did_request_destruction(block);
        }
    }

    #[inline(never)]
    fn allocate_precisely(
        &self,
        size: usize,
        attributes: CellAttributes,
        allocate: fn(usize) -> *mut c_void,
    ) -> usize {
        #[cfg(debug_assertions)]
        self.collect_if_stressed();
        self.will_allocate_slowly();
        let create = || PreciseAllocation::try_create(self, size, attributes, allocate);
        let could_fit = size < options().ram_size;
        let Some(allocation) = create().or_else(|| {
            (could_fit && self.collect_for_lack_of_memory())
                .then(create)
                .flatten()
        }) else {
            return 0;
        };
        let mut precise = self.precise.borrow_mut();
        allocation.index.set(precise.len() as u32);
        precise.push(allocation);
        if self.is_marking_concurrently() {
            self.marks().hide_precise(allocation.cell());
        }
        self.precise_bytes.update(|bytes| bytes + size);
        self.did_allocate(size);
        allocation.cell()
    }

    /// Makes auxiliary memory that has `PRECISE_BIT` larger. The new address, or zero if it stays as it is. May
    /// collect.
    ///
    /// # Safety
    /// Its owner is alive and is all that has the address, which it replaces before the next allocation.
    pub(crate) unsafe fn try_grow_precise(&self, cell: usize, size: usize) -> usize {
        self.collect_if_necessary();
        if self.is_marking_concurrently() || self.mutator_state() != MutatorState::Running {
            return 0;
        }
        // SAFETY: the caller's.
        let (old_size, resized) = unsafe {
            let old_size = PreciseAllocation::of_cell(cell).cell_size();
            (
                old_size,
                PreciseAllocation::try_resize(self.marks(), cell, size),
            )
        };
        let Some(allocation) = resized else { return 0 };
        self.precise.borrow_mut()[allocation.index.get() as usize] = allocation;
        self.precise_bytes.update(|bytes| bytes + size - old_size);
        self.did_allocate(size - old_size);
        if allocation.is_marked() {
            self.policy.did_grow_old_cell(size - old_size);
        }
        allocation.cell()
    }

    fn remember(&self, cell: &JsCell) {
        cell.set_state(CellState::PossiblyGrey);
        self.remembered.borrow_mut().push(cell.address());
    }

    #[inline]
    pub fn defer_collection(&self) -> DeferCollection<'_> {
        self.begin_deferral();
        DeferCollection(self)
    }

    #[inline]
    pub fn begin_deferral(&self) {
        self.deferral_depth.update(|depth| depth + 1);
    }

    /// # Safety
    /// The caller has begun it.
    #[inline]
    pub unsafe fn end_deferral(&self) {
        self.deferral_depth.update(|depth| depth - 1);
    }

    /// For a caller that can stand a collection.
    pub fn collect_if_deferred(&self) {
        if self.deferral_depth.get() == 0 && self.did_defer_collection.take() {
            self.collect_if_necessary();
        }
    }

    #[inline]
    pub fn is_deferred(&self) -> bool {
        self.deferral_depth.get() != 0
    }

    #[inline]
    pub fn allocate_strong_slot(&self, word: u64) -> usize {
        self.strong_set.allocate(word)
    }

    /// # Safety
    /// As for `Weak::with_owner`.
    pub unsafe fn allocate_weak_handle(
        &self,
        cell: Gc<JsCell>,
        owner: *const WeakOwner,
        context: *mut c_void,
    ) -> &'static WeakImpl {
        self.weak_set.allocate(self, cell.address(), owner, context)
    }

    pub fn protect(&self, value: Value) {
        if let Some(cell) = value.as_cell() {
            *self
                .protected
                .borrow_mut()
                .entry(cell.address())
                .or_default() += 1;
        }
    }

    /// Whether that was the last protection.
    pub fn unprotect(&self, value: Value) -> bool {
        let address = value.to_bits() as usize;
        let mut protected = self.protected.borrow_mut();
        match protected.get_mut(&address) {
            Some(1) => protected.remove(&address).is_some(),
            Some(count) => {
                *count -= 1;
                false
            }
            None => false,
        }
    }

    /// # Safety
    /// `finalizer` can be called with the dead cell and `context`.
    pub unsafe fn add_finalizer(
        &self,
        cell: Gc<JsCell>,
        finalizer: Finalizer,
        context: *mut c_void,
    ) {
        unsafe extern "C" fn is_reachable(
            _: &WeakOwner,
            _: &WeakImpl,
            _: *mut c_void,
            _: &mut Visitor,
            _: Option<&mut crate::AsciiLiteral>,
        ) -> bool {
            false
        }
        unsafe extern "C" fn finalize(
            _: &WeakOwner,
            handle: &WeakImpl,
            boxed: *mut c_void,
        ) -> bool {
            // SAFETY: the box below, and the promise of its maker.
            unsafe {
                let (finalizer, context) = *Box::from_raw(boxed.cast::<(Finalizer, *mut c_void)>());
                finalizer(
                    core::ptr::with_exposed_provenance_mut(handle.target()),
                    context,
                );
            }
            true
        }
        static OWNER: WeakOwner = WeakOwner {
            is_reachable_from_opaque_roots: is_reachable,
            finalize,
        };
        let boxed = Box::into_raw(Box::new((finalizer, context)));
        self.weak_set
            .allocate(self, cell.address(), &raw const OWNER, boxed.cast());
    }

    /// # Safety
    /// The observer stays valid until it is removed.
    pub unsafe fn add_observer(&self, observer: *const HeapObserver) {
        self.observers.borrow_mut().push(observer);
    }

    pub fn remove_observer(&self, observer: *const HeapObserver) {
        self.observers.borrow_mut().retain(|&it| it != observer);
    }

    pub fn add_marking_constraint(&self, constraint: MarkingConstraint) {
        self.constraints.borrow_mut().push(constraint);
    }

    /// False for a cell that the last collection found dead and that has not been swept.
    ///
    /// # Safety
    /// The address of a cell of this heap whose memory has not been freed.
    pub unsafe fn is_live(&self, cell: usize) -> bool {
        match container::of(cell) {
            Container::Precise(allocation) => allocation.is_live(),
            Container::Block(block) if block.is_being_filled() => {
                !block.directory().allocator().is_free(block, cell)
            }
            Container::Block(block) => block.is_live(cell),
        }
    }

    /// The cell that starts at `word`, which may be anything, if `is_live` holds for it. No marker is running.
    pub fn live_cell_at(&self, word: usize) -> Option<Gc<JsCell>> {
        let kind = if word & PRECISE_BIT != 0 {
            let precise = self.precise.borrow();
            precise.iter().find(|it| it.cell() == word)?.attributes.kind
        } else {
            let block = self.blocks.borrow().block_containing(word)?;
            (block.cell_containing(word) == Some(word)).then_some(block.attributes.kind)?
        };
        // SAFETY: the start of a cell in memory of the heap.
        unsafe {
            let is_cell = kind == AllocationKind::Cell && self.is_live(word);
            let cell = is_cell.then(|| Gc::<JsCell>::from_address(word));
            cell.filter(|cell| !cell.shape_id().is_none())
        }
    }

    fn stop_allocating(&self) {
        for allocator in self.allocators.borrow().iter() {
            allocator.stop_allocating(self);
        }
    }

    /// Destroys every cell and frees all memory.
    ///
    /// # Safety
    /// After `stop_collecting`. Nothing uses a cell afterwards.
    pub(crate) unsafe fn tear_down(&self) {
        let _state = self.enter_state(MutatorState::Sweeping);
        self.stop_allocating();
        self.weak_set.finalize_all();
        self.stop_allocating();
        self.is_marking.set(false);
        self.has_swapped_marks.set(false);
        self.for_each_directory(|directory| {
            directory.blocks().for_each(Block::forget_version);
            directory.clear_all_marks();
            directory.end_marking(Scope::Full, &mut core::iter::repeat(0));
        });
        let precise = self.precise.take();
        for allocation in &precise {
            self.marks().remove_precise(allocation.cell());
            self.marks().other().remove_precise(allocation.cell());
            allocation.end_marking();
        }
        // A destructor may look at another dead cell, and at its shape.
        let sweep = |source| {
            self.for_each_directory(|directory| {
                while directory.allocator().source == source && directory.sweep_next_block() {}
            });
        };
        sweep(BlockSource::General);
        // SAFETY: the caller's.
        precise.iter().for_each(|it| unsafe { it.destroy_cell() });
        sweep(BlockSource::Shapes);
        // SAFETY: as above.
        precise.iter().for_each(|it| unsafe { it.free() });
        self.free_swept_empty_blocks();
        marks::discard_idle_pages();
        assert!(self.blocks.borrow().len() == 0);
    }
}
