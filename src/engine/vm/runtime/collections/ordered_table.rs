//! The hash table of a `Map` or a `Set`. It is one cell: the header, a power of two of buckets, then the entries in
//! the order in which they were added. The entries of a bucket are chained by links.

use core::cell::Cell;
use core::marker::PhantomData;
use core::mem::offset_of;
use core::ops::Deref;
use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

use bun_alloc::AllocError;

use super::{HashedKey, OrderedCollection};
use crate::heap::{Never, delay, optimal_size};
use crate::{
    CellKind, CellType, CellTypeRange, Class, ClassOps, Extends, Field, Gc, GcFree, JsCell, Shape,
    TypeFlags, Value, Visitor, Vm, ascii_literal,
};

const WORD: usize = size_of::<u64>();

/// The distance of an entry from the start of the table, in words.
type Link = u32;
const END_OF_CHAIN: Link = 0;

mod sealed {
    pub trait Sealed {}
}

/// `MapKind` or `SetKind`.
pub trait TableKind: sealed::Sealed + Sized + 'static {
    /// What an entry has besides the key.
    type Payload: Copy;
    type Slot;
    type Item: Copy;

    const HAS_VALUES: bool;
    const COLLECTION_TYPE: CellType;

    fn payload(slot: &Self::Slot) -> Self::Payload;
    fn cell_in(payload: Self::Payload) -> Option<Gc<JsCell>>;
    /// # Safety
    /// As for `Field::set_without_barrier`.
    unsafe fn store(slot: &Self::Slot, payload: Self::Payload);
    fn clear(slot: &Self::Slot);
    fn item(key: Value, payload: Self::Payload) -> Self::Item;
    fn empty_table(vm: &Vm) -> Gc<OrderedTable<Self>>;
}

pub enum MapKind {}

impl sealed::Sealed for MapKind {}

impl TableKind for MapKind {
    type Payload = Value;
    type Slot = Field<Value>;
    type Item = (Value, Value);

    const HAS_VALUES: bool = true;
    const COLLECTION_TYPE: CellType = CellType::Map;

    #[inline(always)]
    fn payload(slot: &Field<Value>) -> Value {
        slot.get()
    }

    #[inline(always)]
    fn cell_in(payload: Value) -> Option<Gc<JsCell>> {
        payload.as_cell()
    }

    #[inline(always)]
    unsafe fn store(slot: &Field<Value>, payload: Value) {
        // SAFETY: the caller's.
        unsafe { slot.set_without_barrier(payload) }
    }

    #[inline(always)]
    fn clear(slot: &Field<Value>) {
        // SAFETY: no cell.
        unsafe { slot.set_without_barrier(Value::UNDEFINED) }
    }

    #[inline(always)]
    fn item(key: Value, payload: Value) -> (Value, Value) {
        (key, payload)
    }

    #[inline(always)]
    fn empty_table(vm: &Vm) -> Gc<MapTable> {
        vm.services.collections.empty_map_table()
    }
}

pub enum SetKind {}

impl sealed::Sealed for SetKind {}

impl TableKind for SetKind {
    type Payload = ();
    type Slot = ();
    type Item = Value;

    const HAS_VALUES: bool = false;
    const COLLECTION_TYPE: CellType = CellType::Set;

    #[inline(always)]
    fn payload((): &()) {}

    #[inline(always)]
    fn cell_in((): ()) -> Option<Gc<JsCell>> {
        None
    }

    #[inline(always)]
    unsafe fn store((): &(), (): ()) {}

    #[inline(always)]
    fn clear((): &()) {}

    #[inline(always)]
    fn item(key: Value, (): ()) -> Value {
        key
    }

    #[inline(always)]
    fn empty_table(vm: &Vm) -> Gc<SetTable> {
        vm.services.collections.empty_set_table()
    }
}

#[repr(C)]
pub(super) struct Entry<K: TableKind> {
    /// Empty once the entry has been removed. It is then in no chain.
    key: Field<Option<Value>>,
    hash: Cell<u32>,
    next: Cell<Link>,
    slot: K::Slot,
}

impl<K: TableKind> Entry<K> {
    #[inline(always)]
    pub(super) fn key(&self) -> Option<HashedKey> {
        let key = self.key.get()?;
        Some(HashedKey::from_parts(key, self.hash.get()))
    }

    #[inline(always)]
    pub(super) fn payload(&self) -> K::Payload {
        K::payload(&self.slot)
    }

    #[inline(always)]
    pub(super) fn item(&self) -> Option<K::Item> {
        Some(K::item(self.key.get()?, self.payload()))
    }
}

#[repr(C)]
pub struct OrderedTable<K: TableKind> {
    base: JsCell,
    bucket_mask: u32,
    live: Cell<u32>,
    /// With `IS_CURRENT`, the collection. Once the table is retired, where cursors go on: a table that has the live
    /// entries in the same order, or the collection if it has been cleared.
    forward: AtomicUsize,
    /// How many entries have been written, the removed ones too.
    used: AtomicU32,
    capacity: u32,
    /// The entries before this one have been removed.
    first_live: AtomicU32,
    /// No cell has been stored in the entries before this link since the collector has last visited them.
    clean_until: AtomicU32,
    /// Where `OrderedCursor::advance_for_builtin` has stopped.
    builtin_position: Cell<u32>,
    /// Without it nothing knows an entry by its number, so entries may move.
    may_have_cursors: Cell<bool>,
    has_values: bool,
    kind: PhantomData<K>,
}

pub type MapTable = OrderedTable<MapKind>;
pub type SetTable = OrderedTable<SetKind>;

static CLASS: Class = Class::new::<MapTable>(
    ascii_literal!("OrderedHashTable"),
    None,
    CellTypeRange::new(CellType::OrderedHashTable, CellType::OrderedHashTable),
);

impl<K: TableKind> !GcFree for OrderedTable<K> {}

impl<K: TableKind> Deref for OrderedTable<K> {
    type Target = JsCell;

    #[inline(always)]
    fn deref(&self) -> &JsCell {
        &self.base
    }
}

// SAFETY: starts with a `JsCell`.
unsafe impl<K: TableKind> Extends<JsCell> for OrderedTable<K> {}

unsafe extern "C" fn visit_children(cell: &JsCell, visitor: &mut Visitor) {
    match cell.downcast::<MapTable>() {
        Some(table) => table.trace_fields(visitor),
        None => Gc::from(cell).cast::<SetTable>().trace_fields(visitor),
    }
}

// SAFETY: visits the entries for as long as anything reads them.
unsafe impl<K: TableKind> CellKind for OrderedTable<K> {
    type Base = JsCell;
    /// Only `OrderedTable::try_allocate` knows the size.
    type Init = Never;

    const CLASS: &'static Class = &CLASS;
    const CELL_TYPE: CellType = CellType::OrderedHashTable;
    const FLAGS: TypeFlags = TypeFlags::SHAPE_IS_IMMORTAL;
    const HOLDS_CLASS: bool = false;
    const OPS: ClassOps = {
        let mut ops = JsCell::OPS;
        ops.visit_children = visit_children;
        ops
    };

    #[inline(always)]
    fn is(cell: &JsCell) -> bool {
        // SAFETY: both kinds have the same header.
        cell.cell_type() == CellType::OrderedHashTable
            && unsafe { Gc::from(cell).cast_unchecked::<Self>() }.has_values == K::HAS_VALUES
    }

    fn shape_of(init: &Never) -> Gc<Shape> {
        match *init {}
    }

    unsafe fn initialize(_: *mut Self, init: Never) {
        match init {}
    }

    fn trace_fields(&self, visitor: &mut Visitor) {
        let forward = self.forward.load(Ordering::Relaxed);
        // SAFETY: zero, or a cell that the table keeps alive.
        unsafe { visitor.append_word((forward & !Self::IS_CURRENT) as u64) };
        if forward & Self::IS_CURRENT == 0 {
            return;
        }
        delay::of_helper(3);
        let end = self.link_of(self.used.load(Ordering::Acquire));
        delay::of_helper(3);
        let mut first = self.link_of(self.first_live.load(Ordering::Relaxed));
        if !visitor.is_first_visit() && !visitor.is_verifying() {
            first = first.max(self.clean_until.load(Ordering::Relaxed));
        }
        if !visitor.is_mutator_running() {
            self.clean_until.store(end, Ordering::Relaxed);
        }
        let count = (end.saturating_sub(first) / Self::ENTRY_WORDS) as usize;
        let first = self.entry_ptr(first).cast();
        // SAFETY: they have been written, and are inside the cell.
        unsafe {
            if K::HAS_VALUES {
                visitor.append_entries::<{ MapTable::ENTRY_WORDS as usize }>(first, count);
            } else {
                visitor.append_entries::<{ SetTable::ENTRY_WORDS as usize }>(first, count);
            }
        }
    }
}

impl<K: TableKind> OrderedTable<K> {
    pub const OFFSET_OF_BUCKET_MASK: usize = offset_of!(Self, bucket_mask);
    pub const OFFSET_OF_LIVE: usize = offset_of!(Self, live);
    pub const OFFSET_OF_FORWARD: usize = offset_of!(Self, forward);
    pub const IS_CURRENT: usize = 1;
    pub const OFFSET_OF_USED: usize = offset_of!(Self, used);
    pub const OFFSET_OF_CAPACITY: usize = offset_of!(Self, capacity);
    pub const OFFSET_OF_FIRST_LIVE: usize = offset_of!(Self, first_live);
    pub const OFFSET_OF_CLEAN_UNTIL: usize = offset_of!(Self, clean_until);
    pub const OFFSET_OF_BUILTIN_POSITION: usize = offset_of!(Self, builtin_position);
    pub const OFFSET_OF_MAY_HAVE_CURSORS: usize = offset_of!(Self, may_have_cursors);
    pub const OFFSET_OF_BUCKETS: usize = size_of::<Self>();
    pub const ENTRY_WORDS: u32 = (size_of::<Entry<K>>() / WORD) as u32;
    pub const OFFSET_OF_ENTRY_KEY: usize = offset_of!(Entry<K>, key);
    pub const OFFSET_OF_ENTRY_HASH: usize = offset_of!(Entry<K>, hash);
    pub const OFFSET_OF_ENTRY_NEXT: usize = offset_of!(Entry<K>, next);
    pub const OFFSET_OF_ENTRY_VALUE: usize = offset_of!(Entry<K>, slot);

    /// The buckets fill whole words.
    const EMPTY_TABLE_BUCKETS: u32 = 2;
    const MIN_BUCKETS: u32 = 4;
    const MAX_BUCKETS: u32 = 1 << 27;
    /// A table grows fourfold up to here, and twofold from then on.
    const FEW_BUCKETS: u32 = 1 << 16;

    const fn offset_of_entries(buckets: u32) -> usize {
        Self::OFFSET_OF_BUCKETS + buckets as usize * size_of::<Link>()
    }

    const fn allocation_size(buckets: u32, capacity: u32) -> usize {
        Self::offset_of_entries(buckets) + capacity as usize * size_of::<Entry<K>>()
    }

    /// Half as many entries as buckets, and some more if the allocation has room for them anyway.
    const fn capacity_for(buckets: u32) -> u32 {
        if buckets == Self::MIN_BUCKETS {
            return buckets;
        }
        let size = optimal_size(Self::allocation_size(buckets, buckets / 2));
        let fitting = (size - Self::offset_of_entries(buckets)) / size_of::<Entry<K>>();
        let limit = buckets / 8 * 5;
        if fitting < limit as usize {
            fitting as u32
        } else {
            limit
        }
    }

    pub(super) fn buckets_for(entries: usize) -> Result<u32, AllocError> {
        if entries <= Self::MIN_BUCKETS as usize {
            return Ok(Self::MIN_BUCKETS);
        }
        if entries > Self::MAX_BUCKETS as usize / 2 {
            return Err(AllocError);
        }
        let buckets = (entries as u32 * 2).next_power_of_two();
        let is_half_enough = Self::capacity_for(buckets / 2) as usize >= entries;
        Ok(if is_half_enough { buckets / 2 } else { buckets })
    }

    pub(super) fn buckets_after_growth(&self) -> Result<u32, AllocError> {
        match self.bucket_count() {
            Self::EMPTY_TABLE_BUCKETS => Ok(Self::MIN_BUCKETS),
            Self::MIN_BUCKETS => Ok(Self::MIN_BUCKETS * 8),
            Self::MAX_BUCKETS => Err(AllocError),
            buckets if buckets < Self::FEW_BUCKETS => Ok(buckets * 4),
            buckets => Ok(buckets * 2),
        }
    }

    /// # Safety
    /// The caller writes the buckets before the next allocation.
    #[inline(always)]
    unsafe fn try_allocate(
        vm: &Vm,
        shape: Gc<Shape>,
        buckets: u32,
        capacity: u32,
    ) -> Result<Gc<Self>, AllocError> {
        let size = Self::allocation_size(buckets, capacity);
        let address = vm.heap.cells.try_allocate(&vm.heap, size);
        if address == 0 {
            return Err(AllocError);
        }
        let table = core::ptr::with_exposed_provenance_mut::<Self>(address);
        // SAFETY: a new cell of that size.
        unsafe {
            JsCell::initialize(table.cast(), shape);
            (&raw mut (*table).bucket_mask).write(buckets - 1);
            (&raw mut (*table).live).write(Cell::new(0));
            (&raw mut (*table).forward).write(AtomicUsize::new(Self::IS_CURRENT));
            (&raw mut (*table).used).write(AtomicU32::new(0));
            (&raw mut (*table).capacity).write(capacity);
            (&raw mut (*table).first_live).write(AtomicU32::new(0));
            (&raw mut (*table).clean_until).write(AtomicU32::new(0));
            (&raw mut (*table).builtin_position).write(Cell::new(0));
            (&raw mut (*table).may_have_cursors).write(Cell::new(false));
            (&raw mut (*table).has_values).write(K::HAS_VALUES);
            Ok(Gc::from_address(address))
        }
    }

    #[inline(always)]
    fn try_create(
        vm: &Vm,
        shape: Gc<Shape>,
        buckets: u32,
        capacity: u32,
    ) -> Result<Gc<Self>, AllocError> {
        // SAFETY: follows.
        let table = unsafe { Self::try_allocate(vm, shape, buckets, capacity) }?;
        table.clear_buckets();
        Ok(table)
    }

    /// The one that all collections without a table of their own share.
    pub(super) fn create_empty(vm: &Vm) -> Gc<Self> {
        Self::try_create(vm, vm.shape_for::<Self>(), Self::EMPTY_TABLE_BUCKETS, 0)
            .unwrap_or_else(|_| bun_alloc::out_of_memory())
    }

    #[inline(always)]
    pub fn len(&self) -> u32 {
        self.live.get()
    }

    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    #[inline(always)]
    pub(super) fn used(&self) -> u32 {
        self.used.load(Ordering::Relaxed)
    }

    #[inline(always)]
    pub(super) fn first_live(&self) -> u32 {
        self.first_live.load(Ordering::Relaxed)
    }

    #[inline(always)]
    pub(super) fn capacity(&self) -> u32 {
        self.capacity
    }

    #[inline(always)]
    pub(super) fn bucket_count(&self) -> u32 {
        self.bucket_mask + 1
    }

    #[inline(always)]
    pub(super) fn is_full(&self) -> bool {
        self.used() == self.capacity
    }

    #[inline(always)]
    pub(super) fn is_shared(&self) -> bool {
        self.capacity == 0
    }

    #[inline(always)]
    pub(super) fn may_have_cursors(&self) -> bool {
        self.may_have_cursors.get()
    }

    #[inline(always)]
    pub(super) fn will_have_cursor(&self) {
        self.may_have_cursors.set(true);
    }

    #[inline(always)]
    pub(super) fn is_current(&self) -> bool {
        self.forward.load(Ordering::Relaxed) & Self::IS_CURRENT != 0
    }

    /// `None` for a shared table.
    #[inline(always)]
    pub(super) fn collection_or_successor(&self) -> Option<Gc<JsCell>> {
        let address = self.forward.load(Ordering::Relaxed) & !Self::IS_CURRENT;
        // SAFETY: a cell that the table keeps alive.
        (address != 0).then(|| unsafe { Gc::from_address(address) })
    }

    #[inline(always)]
    fn set_forward(&self, forward: usize) {
        self.forward.store(forward, Ordering::Relaxed);
        self.write_barrier_for_cell();
    }

    #[inline(always)]
    pub(super) fn set_collection(&self, collection: &OrderedCollection<K>) {
        if !self.is_shared() {
            self.set_forward(collection.address() | Self::IS_CURRENT);
        }
    }

    #[inline(always)]
    pub(super) fn set_builtin_position(&self, number: u32) {
        self.builtin_position.set(number);
    }

    #[inline(always)]
    pub fn builtin_position(&self) -> u32 {
        self.builtin_position.get()
    }

    #[inline(always)]
    pub fn item_at_builtin_position(&self) -> Option<K::Item> {
        if !self.is_current() {
            return None;
        }
        self.entry(self.builtin_position())?.item()
    }

    #[inline(always)]
    fn buckets_ptr(&self) -> *mut Link {
        core::ptr::with_exposed_provenance_mut(self.address() + Self::OFFSET_OF_BUCKETS)
    }

    #[inline(always)]
    fn buckets(&self) -> &[Cell<Link>] {
        // SAFETY: inside the cell, and initialized.
        unsafe {
            core::slice::from_raw_parts(self.buckets_ptr().cast(), self.bucket_count() as usize)
        }
    }

    #[inline(always)]
    fn bucket(&self, hash: u32) -> &Cell<Link> {
        let index = (hash & self.bucket_mask) as usize;
        // SAFETY: as above.
        unsafe { &*self.buckets_ptr().add(index).cast() }
    }

    #[inline(always)]
    fn clear_buckets(&self) {
        let count = self.bucket_count() as usize;
        // SAFETY: inside the cell, and no marker reads them.
        unsafe { self.buckets_ptr().write_bytes(0, count) };
    }

    #[inline(always)]
    fn link_of(&self, number: u32) -> Link {
        (Self::offset_of_entries(self.bucket_count()) / WORD) as Link + number * Self::ENTRY_WORDS
    }

    #[inline(always)]
    fn entry_ptr(&self, link: Link) -> *mut Entry<K> {
        core::ptr::with_exposed_provenance_mut(self.address() + link as usize * WORD)
    }

    /// # Safety
    /// The link of an entry that has been written.
    #[inline(always)]
    #[cfg_attr(rootcheck, rootcheck::stays("points into the cell"))]
    unsafe fn entry_at(&self, link: Link) -> &Entry<K> {
        // SAFETY: the caller's.
        unsafe { &*self.entry_ptr(link) }
    }

    /// The table is not retired.
    #[inline(always)]
    #[cfg_attr(rootcheck, rootcheck::stays("points into the cell"))]
    pub(super) fn entry(&self, number: u32) -> Option<&Entry<K>> {
        debug_assert!(self.is_current());
        // SAFETY: checked.
        (number < self.used()).then(|| unsafe { self.entry_at(self.link_of(number)) })
    }

    /// From the first live one on. The table is not retired.
    #[inline(always)]
    #[cfg_attr(rootcheck, rootcheck::stays("points into the cell"))]
    pub(super) fn entries(&self) -> &[Entry<K>] {
        let first = self.first_live();
        let count = (self.used() - first) as usize;
        // SAFETY: have been written.
        unsafe { core::slice::from_raw_parts(self.entry_ptr(self.link_of(first)), count) }
    }

    /// What holds the link of the entry that has the key.
    #[inline(always)]
    fn find_referrer(&self, key: HashedKey) -> Option<&Cell<Link>> {
        let mut referrer = self.bucket(key.hash());
        while referrer.get() != END_OF_CHAIN {
            // SAFETY: from a chain.
            let entry = unsafe { self.entry_at(referrer.get()) };
            if key.matches(entry.key.get(), entry.hash.get()) {
                return Some(referrer);
            }
            referrer = &entry.next;
        }
        None
    }

    #[inline(always)]
    pub(super) fn find(&self, key: HashedKey) -> Option<&Entry<K>> {
        // SAFETY: from a chain.
        self.find_referrer(key)
            .map(|referrer| unsafe { self.entry_at(referrer.get()) })
    }

    /// False if the key is not there.
    #[inline(always)]
    pub(super) fn replace(&self, key: HashedKey, payload: K::Payload) -> bool {
        let Some(link) = self.find_referrer(key).map(Cell::get) else {
            return false;
        };
        // SAFETY: from a chain, and the barrier follows.
        unsafe { K::store(&self.entry_at(link).slot, payload) };
        if K::cell_in(payload).is_some() {
            self.did_dirty(link);
            self.write_barrier_for_cell();
        }
        true
    }

    #[inline(always)]
    fn did_dirty(&self, link: Link) {
        if link < self.clean_until.load(Ordering::Relaxed) {
            self.clean_until.store(link, Ordering::Relaxed);
        }
    }

    /// # Safety
    /// The link is that of an entry below the capacity which is in no chain, and which no marker reads unless it has
    /// been written before. The barrier follows.
    #[inline(always)]
    unsafe fn write_entry(&self, link: Link, key: HashedKey, payload: K::Payload) {
        let next = self.bucket(key.hash()).replace(link);
        let entry = self.entry_ptr(link);
        // SAFETY: the caller's. Nothing is read.
        unsafe {
            (*entry).key.set_without_barrier(Some(key.value()));
            (&raw mut (*entry).hash).write(Cell::new(key.hash()));
            (&raw mut (*entry).next).write(Cell::new(next));
            K::store(&(*entry).slot, payload);
        }
    }

    /// The key is not there. Panics if the table is full.
    #[inline(always)]
    pub(super) fn push(&self, key: HashedKey, payload: K::Payload) {
        let used = self.used();
        assert!(used < self.capacity);
        // SAFETY: checked.
        unsafe { self.write_entry(self.link_of(used), key, payload) };
        self.used.store(used + 1, Ordering::Release);
        self.live.update(|live| live + 1);
        if key.value().is_cell() || K::cell_in(payload).is_some() {
            self.write_barrier_for_cell();
        }
    }

    /// False if the key is not there.
    #[inline(always)]
    pub(super) fn remove(&self, key: HashedKey) -> bool {
        let Some(referrer) = self.find_referrer(key) else {
            return false;
        };
        let link = referrer.get();
        // SAFETY: from a chain, and no cell is stored.
        unsafe {
            let entry = self.entry_at(link);
            referrer.set(entry.next.get());
            entry.key.set_without_barrier(None);
            K::clear(&entry.slot);
        }
        self.live.update(|live| live - 1);
        if !self.may_have_cursors() && link == self.link_of(self.used() - 1) {
            self.reclaim_removed_suffix();
        } else if link == self.link_of(self.first_live()) {
            self.skip_removed_prefix();
        }
        true
    }

    #[inline]
    fn reclaim_removed_suffix(&self) {
        let is_live = |entry: &Entry<K>| entry.key.get().is_some();
        match self.entries().iter().rposition(is_live) {
            Some(last) => self.truncate(self.first_live() + last as u32 + 1),
            None => self.truncate(0),
        }
    }

    #[inline]
    fn skip_removed_prefix(&self) {
        let is_removed = |entry: &&Entry<K>| entry.key.get().is_none();
        let removed = self.entries().iter().take_while(is_removed).count();
        self.first_live
            .store(self.first_live() + removed as u32, Ordering::Relaxed);
    }

    /// The entries from `used` on are in no chain.
    #[inline(always)]
    fn truncate(&self, used: u32) {
        self.used.store(used, Ordering::Relaxed);
        self.first_live
            .store(self.first_live().min(used), Ordering::Relaxed);
        self.did_dirty(self.link_of(used));
    }

    pub(super) fn clear_in_place(&self) {
        assert!(!self.may_have_cursors());
        self.clear_buckets();
        self.truncate(0);
        self.live.set(0);
    }

    /// Closes the gaps that removed entries have left.
    pub(super) fn compact_in_place(&self) {
        assert!(!self.may_have_cursors());
        self.clear_buckets();
        let (first, used) = (self.first_live(), self.used());
        self.first_live.store(0, Ordering::Relaxed);
        let mut target = self.link_of(0);
        for number in first..used {
            // SAFETY: both have been written, and the target is not past the source.
            unsafe {
                let entry = self.entry_at(self.link_of(number));
                if let Some(key) = entry.key() {
                    self.write_entry(target, key, entry.payload());
                    target += Self::ENTRY_WORDS;
                }
            }
        }
        self.used.store(self.len(), Ordering::Relaxed);
        self.clean_until.store(0, Ordering::Relaxed);
        self.write_barrier_for_cell();
    }

    /// A new table with the live entries that `keeps` holds for. Panics if they do not fit.
    #[inline(always)]
    pub(super) fn try_filter(
        &self,
        vm: &Vm,
        buckets: u32,
        mut keeps: impl FnMut(HashedKey) -> bool,
    ) -> Result<Gc<Self>, AllocError> {
        let table = Self::try_create(vm, self.shape(), buckets, Self::capacity_for(buckets))?;
        let mut count = 0;
        for entry in self.entries() {
            if let Some(key) = entry.key()
                && keeps(key)
            {
                assert!(count < table.capacity);
                // SAFETY: checked, and past what is in use.
                unsafe { table.write_entry(table.link_of(count), key, entry.payload()) };
                count += 1;
            }
        }
        table.used.store(count, Ordering::Release);
        table.live.set(count);
        table.write_barrier_for_cell();
        Ok(table)
    }

    #[inline(never)]
    pub(super) fn try_rehash(&self, vm: &Vm, buckets: u32) -> Result<Gc<Self>, AllocError> {
        self.try_filter(vm, buckets, |_| true)
    }

    pub(super) fn try_clone(&self, vm: &Vm) -> Result<Gc<Self>, AllocError> {
        let (used, live) = (self.used(), self.len());
        if live == 0 {
            return Ok(K::empty_table(vm));
        }
        if used - live > live / 2 {
            return self.try_rehash(vm, Self::buckets_for(live as usize)?);
        }
        let buckets = self.bucket_count();
        let size = Self::allocation_size(buckets, used) - Self::OFFSET_OF_BUCKETS;
        // SAFETY: links are relative to the table, so they hold in a new one of the same dimensions.
        unsafe {
            let table = Self::try_allocate(vm, self.shape(), buckets, self.capacity)?;
            let (from, to) = (self.buckets_ptr(), table.buckets_ptr());
            core::ptr::copy_nonoverlapping(from.cast::<u8>(), to.cast::<u8>(), size);
            table.used.store(used, Ordering::Relaxed);
            table.live.set(live);
            (table.first_live).store(self.first_live(), Ordering::Relaxed);
            Ok(table)
        }
    }

    /// `successor` has the live entries. The buckets become the list of the removed ones from the first live one on.
    pub(super) fn retire_for(&self, successor: Gc<Self>) {
        if !self.may_have_cursors() || self.is_shared() {
            return;
        }
        successor.will_have_cursor();
        if self.used() - self.first_live() != self.len() {
            let removed = (self.first_live()..)
                .zip(self.entries())
                .filter(|(_, entry)| entry.key.get().is_none());
            for (slot, (number, _)) in self.buckets().iter().zip(removed) {
                slot.set(number);
            }
        }
        self.set_forward(successor.address());
    }

    /// Cursors start over with whatever the collection has when they next move.
    pub(super) fn retire_cleared(&self) {
        if let Some(collection) = self.collection_or_successor() {
            self.forward.store(collection.address(), Ordering::Relaxed);
        }
    }

    /// The number, in the table that this one was retired for, of the first live entry from `number` on.
    pub(super) fn number_in_successor(&self, number: u32) -> u32 {
        let (first, number) = (self.first_live(), number.min(self.used()));
        let removed = &self.buckets()[..(self.used() - first - self.len()) as usize];
        let removed_before = removed.partition_point(|it| it.get() < number);
        number.saturating_sub(first) - removed_before as u32
    }
}

const _: () = {
    assert!(MapTable::OFFSET_OF_BUCKETS.is_multiple_of(WORD));
    assert!(
        MapTable::allocation_size(MapTable::MAX_BUCKETS, MapTable::MAX_BUCKETS) / WORD
            <= Link::MAX as usize
    );
};
