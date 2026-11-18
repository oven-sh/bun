use core::cell::UnsafeCell;
use core::mem::offset_of;
use core::sync::atomic::{AtomicU8, AtomicU32, Ordering, fence};

use super::{Gc, GcFree, Heap, barrier, container};
use crate::{
    CellKind, CellType, Class, ClassOps, IndexingMode, JsObject, Shape, ShapeId, TypeFlags, Value,
    Visitor,
};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum CellState {
    /// May have been visited: a store needs the barrier.
    PossiblyBlack = 0,
    /// New since the last collection. A store needs the barrier while markers are at work.
    DefinitelyWhite = 1,
    /// Remembered, so it will be visited after the next safepoint if it is alive.
    PossiblyGrey = 2,
}

/// The header of every cell.
#[repr(C, align(8))]
pub struct JsCell {
    shape_id: UnsafeCell<u32>,
    indexing_and_lock: AtomicU8,
    cell_type: UnsafeCell<CellType>,
    flags: UnsafeCell<u8>,
    state: AtomicU8,
}

impl !GcFree for JsCell {}
impl !Send for JsCell {}
impl !Sync for JsCell {}

impl JsCell {
    pub const OFFSET_OF_SHAPE_ID: usize = offset_of!(JsCell, shape_id);
    pub const OFFSET_OF_INDEXING_MODE: usize = offset_of!(JsCell, indexing_and_lock);
    pub const OFFSET_OF_TYPE: usize = offset_of!(JsCell, cell_type);
    pub const OFFSET_OF_FLAGS: usize = offset_of!(JsCell, flags);
    pub const OFFSET_OF_STATE: usize = offset_of!(JsCell, state);

    pub const IS_LOCKED: u8 = 0x40;
    const IS_BEING_VISITED: u8 = 0x80;
    pub const LOCK_BITS: u8 = Self::IS_LOCKED | Self::IS_BEING_VISITED;

    #[inline(always)]
    pub fn as_cell(&self) -> &JsCell {
        self
    }

    #[inline(always)]
    pub fn as_value(&self) -> Value {
        self.into()
    }

    #[inline(always)]
    pub fn address(&self) -> usize {
        core::ptr::from_ref(self).expose_provenance()
    }

    #[inline(always)]
    pub fn is_same(&self, other: &JsCell) -> bool {
        core::ptr::eq(self, other)
    }

    #[inline(always)]
    pub fn shape_id(&self) -> ShapeId {
        // SAFETY: only this thread writes it.
        ShapeId::from_bits(unsafe { *self.shape_id.get() })
    }

    #[inline(always)]
    pub fn shape(&self) -> Gc<Shape> {
        // SAFETY: a cell keeps its shape alive.
        unsafe { self.shape_id().decode() }
    }

    #[inline(always)]
    fn shape_id_atomic(&self) -> &AtomicU32 {
        // SAFETY: aligned. The plain loads are on the only thread that stores.
        unsafe { AtomicU32::from_ptr(self.shape_id.get()) }
    }

    #[inline(always)]
    pub(crate) fn load_shape_id(&self, order: Ordering) -> ShapeId {
        ShapeId::from_bits(self.shape_id_atomic().load(order))
    }

    #[inline(always)]
    pub(crate) fn shape_id_concurrently(&self) -> ShapeId {
        self.load_shape_id(Ordering::Acquire)
    }

    #[inline(always)]
    pub fn class(&self) -> &'static Class {
        self.shape().class()
    }

    #[inline(always)]
    pub fn cell_type(&self) -> CellType {
        // SAFETY: never written after the cell is made.
        unsafe { *self.cell_type.get() }
    }

    /// Those of the low byte.
    #[inline(always)]
    pub fn inline_flags(&self) -> TypeFlags {
        // SAFETY: only this thread writes it.
        TypeFlags::from_bits_retain(u32::from(unsafe { *self.flags.get() }))
    }

    #[inline(always)]
    pub(crate) fn load_inline_flags(&self, order: Ordering) -> TypeFlags {
        // SAFETY: a single byte, which is stored atomically.
        let flags = unsafe { AtomicU8::from_ptr(self.flags.get()) }.load(order);
        TypeFlags::from_bits_retain(u32::from(flags))
    }

    #[inline(always)]
    pub fn per_cell_bit(&self) -> bool {
        self.inline_flags().contains(TypeFlags::PER_CELL_BIT)
    }

    #[inline]
    pub(crate) fn set_per_cell_bit(&self, value: bool) {
        self.set_own_flag(TypeFlags::PER_CELL_BIT, value);
    }

    #[inline]
    pub(crate) fn set_own_flag(&self, flag: TypeFlags, value: bool) {
        let mut flags = self.inline_flags();
        flags.set(flag, value);
        // SAFETY: a single byte, which a marker loads atomically.
        unsafe { AtomicU8::from_ptr(self.flags.get()) }
            .store(flags.bits() as u8, Ordering::Relaxed);
    }

    #[inline(always)]
    pub fn indexing_mode(&self) -> IndexingMode {
        let bits = self.indexing_and_lock.load(Ordering::Relaxed) & !Self::LOCK_BITS;
        // SAFETY: from a shape.
        unsafe { IndexingMode::from_bits_unchecked(bits) }
    }

    #[inline(always)]
    pub fn inherits(&self, class: &Class) -> bool {
        self.class().is_subclass_of(class)
    }

    #[inline(always)]
    pub fn is<T: CellKind>(&self) -> bool {
        T::is(self)
    }

    #[inline(always)]
    pub fn downcast<T: CellKind>(&self) -> Option<Gc<T>> {
        Gc::from(self).downcast()
    }

    #[inline(always)]
    pub fn is_object(&self) -> bool {
        self.cell_type().is_object()
    }

    #[inline(always)]
    pub fn is_string(&self) -> bool {
        self.cell_type() == CellType::String
    }

    #[inline(always)]
    pub fn is_symbol(&self) -> bool {
        self.cell_type() == CellType::Symbol
    }

    #[inline(always)]
    pub fn is_bigint(&self) -> bool {
        self.cell_type() == CellType::BigInt
    }

    #[inline(always)]
    pub fn as_object(&self) -> Option<Gc<JsObject>> {
        self.downcast()
    }

    /// # Safety
    /// `shape` has the class and type of the old one and describes the slots and elements that the cell has.
    #[inline]
    pub unsafe fn set_shape(&self, shape: &Shape) {
        debug_assert!(shape.instance_type() == self.cell_type());
        assert!(self.cell_type().has_storage());
        // For generated code, which stores the id without ordering once a cache has it.
        if barrier::is_fenced() {
            fence(Ordering::Release);
        }
        self.shape_id_atomic()
            .store(shape.id().bits(), Ordering::Release);
        let own = TypeFlags::PER_CELL_BIT | TypeFlags::HAS_PRE_CAPACITY;
        let flags = shape.type_flags() | (self.inline_flags() & own);
        // SAFETY: as in `set_own_flag`.
        unsafe { AtomicU8::from_ptr(self.flags.get()) }
            .store(flags.bits() as u8, Ordering::Relaxed);
        let mode = shape.instance_indexing_mode();
        if mode != self.indexing_mode() {
            self.indexing_and_lock
                .update(Ordering::Release, Ordering::Relaxed, |old| {
                    old & Self::LOCK_BITS | mode.bits()
                });
        }
        self.write_barrier_for_cell();
    }

    /// # Safety
    /// As for `set_shape`. The header of an instance is the same for both, and the barrier follows.
    #[inline(always)]
    pub unsafe fn set_shape_id_directly(&self, shape: ShapeId) {
        debug_assert!(self.cell_type().has_storage());
        self.shape_id_atomic()
            .store(shape.bits(), Ordering::Release);
    }

    /// Tells a marker that the shape and the storage disagree until the next `set_shape`.
    #[inline]
    pub(crate) fn nuke_shape_id(&self) {
        self.shape_id_atomic()
            .store(self.shape_id().nuked().bits(), Ordering::Relaxed);
    }

    #[inline(always)]
    pub(crate) fn state(&self) -> u8 {
        self.state.load(Ordering::Relaxed)
    }

    #[inline(always)]
    pub fn state_bits(&self) -> u8 {
        self.state()
    }

    #[inline(always)]
    pub(crate) fn set_state(&self, state: CellState) {
        self.state.store(state as u8, Ordering::Relaxed);
    }

    /// After storing `value` in the cell or in memory that the cell owns.
    #[inline(always)]
    pub fn write_barrier(&self, value: Value) {
        if value.is_cell() {
            self.write_barrier_for_cell();
        }
    }

    /// After storing what may be a cell.
    #[inline(always)]
    pub fn write_barrier_for_cell(&self) {
        if self.needs_write_barrier() {
            barrier::slow_path(self);
        }
    }

    #[inline(always)]
    pub(crate) fn needs_write_barrier(&self) -> bool {
        self.state() <= barrier::threshold()
    }

    /// If not, none does until the next allocation.
    #[inline(always)]
    pub(crate) fn may_be_read_by_marker(&self) -> bool {
        barrier::is_fenced() && self.heap().has_markers_at_work()
    }

    /// Keeps a marker from reading what the cell owns while it is rearranged.
    #[inline]
    pub(crate) fn lock(&self) -> CellLockGuard<'_> {
        self.lock_raw();
        CellLockGuard(self)
    }

    #[inline(always)]
    fn acquire(&self, bit: u8) {
        while self.indexing_and_lock.fetch_or(bit, Ordering::Acquire) & bit != 0 {
            std::thread::yield_now();
        }
    }

    #[inline(always)]
    fn release(&self, bit: u8) {
        self.indexing_and_lock.fetch_and(!bit, Ordering::Release);
    }

    #[inline]
    pub fn lock_raw(&self) {
        self.acquire(Self::IS_LOCKED);
    }

    #[inline]
    pub fn unlock_raw(&self) {
        self.release(Self::IS_LOCKED);
    }

    /// For a marker.
    #[inline(always)]
    pub(super) fn without_other_visitors(&self, visit: impl FnOnce()) {
        self.acquire(Self::IS_BEING_VISITED);
        visit();
        self.release(Self::IS_BEING_VISITED);
    }

    #[inline(always)]
    pub(crate) fn heap(&self) -> &Heap {
        container::of(self.address()).heap()
    }

    /// # Safety
    /// The caller has the right to use it: see `Cx::from_global`.
    #[inline(always)]
    pub unsafe fn heap_unchecked(&self) -> &Heap {
        self.heap()
    }

    pub fn cell_size(&self) -> usize {
        container::of(self.address()).cell_size()
    }

    /// With what it owns.
    pub fn estimated_size(&self, vm: &crate::Vm) -> usize {
        // SAFETY: the method of its class, which leaves out the storage.
        let size = unsafe { (self.class().ops().estimated_size)(self, vm) };
        size + self.as_object().map_or(0, |object| object.storage_size())
    }

    /// The first word of a new instance of `shape`.
    #[inline(always)]
    pub fn header_for(shape: &Shape) -> u64 {
        u64::from(shape.id().bits()) | u64::from(shape.instance_header()) << 32
    }
}

pub(crate) struct CellLockGuard<'a>(&'a JsCell);

impl Drop for CellLockGuard<'_> {
    #[inline]
    fn drop(&mut self) {
        self.0.unlock_raw();
    }
}

static CELL_CLASS: Class = Class::root();

// SAFETY: every cell starts with the header, and the shape is the only reference in it.
unsafe impl CellKind for JsCell {
    type Base = ();
    type Init = Gc<Shape>;

    const CLASS: &'static Class = &CELL_CLASS;
    const CELL_TYPE: CellType = CellType::Cell;
    const FLAGS: TypeFlags = TypeFlags::empty();
    const OPS: ClassOps = ClassOps::CELL;
    const HOLDS_CLASS: bool = false;

    #[inline(always)]
    fn is(_: &JsCell) -> bool {
        true
    }

    #[inline(always)]
    fn shape_of(init: &Gc<Shape>) -> Gc<Shape> {
        *init
    }

    #[inline(always)]
    unsafe fn initialize(this: *mut JsCell, shape: Gc<Shape>) {
        // SAFETY: eight aligned bytes, laid out as the fields are on a little-endian machine.
        unsafe { this.cast::<u64>().write(JsCell::header_for(&shape)) }
    }

    #[inline(always)]
    fn trace_fields(&self, visitor: &mut Visitor) {
        visitor.append_shape(self.shape_id_concurrently());
    }
}
