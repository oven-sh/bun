//! The hash table of a `WeakMap` or a `WeakSet`. It is laid out as the buckets and entries of an `OrderedTable` are, so
//! what has been added since the last collection is at the end. The collector changes it, so it is not in the heap.

use core::cell::{Cell, UnsafeCell};
use core::marker::PhantomData;
use core::mem::{MaybeUninit, offset_of};
use core::ops::Deref;
use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

use bun_alloc::{AllocError, default_alloc};

use super::{HashedKey, MapKind, SetKind, TableKind};
use crate::heap::stack::prefetch;
use crate::heap::{Scope, Survivors};
use crate::{
    CellKind, CellType, Class, ClassOps, Extends, Gc, GcFree, JsCell, JsDestructibleObject,
    JsObjectInit, NoGc, Shape, TypeFlags, Value, Visitor, Vm,
};

const WORD: usize = size_of::<u64>();
const INLINE_WORDS: usize = 7;

/// The distance of an entry from the start of the buffer, in words.
type Link = u32;
const END_OF_CHAIN: Link = 0;
/// In a key that the collector has found dead. The entry stays in its chain, where nothing finds it, until the table is
/// rebuilt.
const IS_DEAD: usize = 1;

/// CanBeHeldWeakly
#[inline]
pub fn can_be_held_weakly(value: Value) -> bool {
    value.is_object()
        || value.as_symbol().is_some_and(|symbol| {
            (symbol.name().symbol_flags()).is_some_and(|flags| !flags.is_registered())
        })
}

pub trait WeakKind: TableKind {
    const WEAK_COLLECTION_TYPE: CellType;
}

impl WeakKind for MapKind {
    const WEAK_COLLECTION_TYPE: CellType = CellType::WeakMap;
}

impl WeakKind for SetKind {
    const WEAK_COLLECTION_TYPE: CellType = CellType::WeakSet;
}

#[repr(C)]
struct Entry<K: WeakKind> {
    /// The address of the cell. Zero once the entry has been removed, which is then in no chain.
    key: Cell<usize>,
    unused: MaybeUninit<u32>,
    next: Cell<Link>,
    slot: K::Slot,
}

impl<K: WeakKind> Entry<K> {
    #[inline(always)]
    fn set_key(&self, key: usize) {
        // SAFETY: aligned. The plain loads are on the only thread that stores while scripts run.
        unsafe { AtomicUsize::from_ptr(self.key.as_ptr()) }.store(key, Ordering::Relaxed);
    }

    #[inline(always)]
    fn live_key(&self) -> Option<usize> {
        let key = self.key.get();
        (key != 0 && key & IS_DEAD == 0).then_some(key)
    }
}

/// What `JsWeakMap` and `JsWeakSet` have in common. Nothing here allocates in the heap.
#[repr(C)]
pub struct WeakCollection<K: WeakKind> {
    base: JsDestructibleObject,
    /// `inline`, or an allocation of the default allocator.
    buffer: Cell<*mut u64>,
    bucket_mask: Cell<u32>,
    live: Cell<u32>,
    /// How many entries have been written, the removed ones too.
    used: Cell<u32>,
    capacity: Cell<u32>,
    /// The entries before this link have not been written since the last collection.
    clean_until: Cell<Link>,
    /// How many words the heap's count of the memory outside it has for the buffer.
    counted_words: AtomicU32,
    inline: UnsafeCell<MaybeUninit<[u64; INLINE_WORDS]>>,
    kind: PhantomData<K>,
}

impl<K: WeakKind> !GcFree for WeakCollection<K> {}

impl<K: WeakKind> Deref for WeakCollection<K> {
    type Target = JsDestructibleObject;

    #[inline(always)]
    fn deref(&self) -> &JsDestructibleObject {
        &self.base
    }
}

impl<K: WeakKind> Drop for WeakCollection<K> {
    fn drop(&mut self) {
        if !self.is_inline() {
            // SAFETY: owned.
            unsafe { default_alloc::free(self.buffer.get().cast()) };
        }
    }
}

// SAFETY: starts with a `JsDestructibleObject`.
unsafe impl<K: WeakKind, T> Extends<T> for WeakCollection<K> where JsDestructibleObject: Extends<T> {}

unsafe extern "C" fn visit_output_constraints<K: WeakKind>(cell: &JsCell, visitor: &mut Visitor) {
    Gc::from(cell)
        .cast::<WeakCollection<K>>()
        .visit_values_of_marked_keys(visitor);
}

unsafe extern "C" fn reconcile<K: WeakKind>(cell: &JsCell, survivors: &Survivors) {
    Gc::from(cell)
        .cast::<WeakCollection<K>>()
        .remove_dead_keys(survivors);
}

unsafe extern "C" fn estimated_size<K: WeakKind>(cell: &JsCell, vm: &Vm) -> usize {
    let words = Gc::from(cell).cast::<WeakCollection<K>>().allocated_words();
    // SAFETY: the method of the base.
    unsafe { (JsDestructibleObject::OPS.estimated_size)(cell, vm) + words as usize * WORD }
}

// SAFETY: a value is visited if its key is alive, and the entry is removed if it is not. The type of cell means a class
// that extends this one.
unsafe impl<K: WeakKind> CellKind for WeakCollection<K> {
    type Base = JsDestructibleObject;
    type Init = JsObjectInit;

    const CLASS: &'static Class = JsDestructibleObject::CLASS;
    const CELL_TYPE: CellType = K::WEAK_COLLECTION_TYPE;
    const FLAGS: TypeFlags = JsDestructibleObject::FLAGS;
    const HOLDS_CLASS: bool = true;
    const OPS: ClassOps = {
        let mut ops = JsDestructibleObject::OPS;
        ops.visit_output_constraints = visit_output_constraints::<K>;
        ops.reconcile_weak_references = reconcile::<K>;
        ops.estimated_size = estimated_size::<K>;
        ops
    };

    #[inline(always)]
    fn is(cell: &JsCell) -> bool {
        cell.cell_type() == K::WEAK_COLLECTION_TYPE
    }

    #[inline(always)]
    fn shape_of(init: &JsObjectInit) -> Gc<Shape> {
        JsDestructibleObject::shape_of(init)
    }

    #[inline(always)]
    unsafe fn initialize(this: *mut Self, init: JsObjectInit) {
        assert!(Self::shape_of(&init).instance_type() == K::WEAK_COLLECTION_TYPE);
        // SAFETY: the caller's.
        unsafe {
            JsDestructibleObject::initialize(&raw mut (*this).base, init);
            Self::initialize_table(this);
        }
    }

    fn trace_fields(&self, visitor: &mut Visitor) {
        self.base.trace_fields(visitor);
        if visitor.is_first_visit() {
            self.counted_words.store(0, Ordering::Relaxed);
        }
        if K::HAS_VALUES {
            visitor.constrain_by_ephemerons_of_current_cell();
        }
        visitor.reconcile_current_cell_later();
    }
}

impl<K: WeakKind> WeakCollection<K> {
    pub const OFFSET_OF_BUFFER: usize = offset_of!(Self, buffer);
    pub const OFFSET_OF_BUCKET_MASK: usize = offset_of!(Self, bucket_mask);
    pub const OFFSET_OF_LIVE: usize = offset_of!(Self, live);
    pub const OFFSET_OF_USED: usize = offset_of!(Self, used);
    pub const OFFSET_OF_CAPACITY: usize = offset_of!(Self, capacity);
    pub const OFFSET_OF_CLEAN_UNTIL: usize = offset_of!(Self, clean_until);
    pub const OFFSET_OF_COUNTED_WORDS: usize = offset_of!(Self, counted_words);
    pub const OFFSET_OF_INLINE: usize = offset_of!(Self, inline);
    pub const ENTRY_WORDS: u32 = (size_of::<Entry<K>>() / WORD) as u32;
    pub const OFFSET_OF_ENTRY_KEY: usize = offset_of!(Entry<K>, key);
    pub const OFFSET_OF_ENTRY_NEXT: usize = offset_of!(Entry<K>, next);
    pub const OFFSET_OF_ENTRY_VALUE: usize = offset_of!(Entry<K>, slot);
    /// One word of them.
    pub const INLINE_BUCKETS: u32 = 2;
    pub const INLINE_CAPACITY: u32 = (INLINE_WORDS as u32 - 1) / Self::ENTRY_WORDS;

    const MIN_ALLOCATED_BUCKETS: u32 = 16;
    const BUCKETS_KEPT_BY_REMOVE: u32 = 64;
    const MAX_BUCKETS: u32 = 1 << 30;
    /// A table grows fourfold up to here, and twofold from then on.
    const FEW_BUCKETS: u32 = 1 << 12;

    /// All but the base.
    ///
    /// # Safety
    /// `this` is a new cell of at least the size of `Self`.
    #[inline(always)]
    pub unsafe fn initialize_table(this: *mut Self) {
        // SAFETY: the caller's.
        unsafe {
            let inline = (&raw mut (*this).inline).cast::<u64>();
            inline.write(0);
            (&raw mut (*this).buffer).write(Cell::new(inline));
            (&raw mut (*this).bucket_mask).write(Cell::new(Self::INLINE_BUCKETS - 1));
            (&raw mut (*this).live).write(Cell::new(0));
            (&raw mut (*this).used).write(Cell::new(0));
            (&raw mut (*this).capacity).write(Cell::new(Self::INLINE_CAPACITY));
            (&raw mut (*this).clean_until).write(Cell::new(0));
            (&raw mut (*this).counted_words).write(AtomicU32::new(0));
        }
    }

    #[inline(always)]
    pub fn size(&self) -> u32 {
        self.live.get()
    }

    #[inline(always)]
    fn is_inline(&self) -> bool {
        self.bucket_count() == Self::INLINE_BUCKETS
    }

    #[inline(always)]
    fn bucket_count(&self) -> u32 {
        self.bucket_mask.get() + 1
    }

    const fn words_for(buckets: u32) -> u32 {
        buckets / 2 * (1 + Self::ENTRY_WORDS)
    }

    fn allocated_words(&self) -> u32 {
        if self.is_inline() {
            0
        } else {
            Self::words_for(self.bucket_count())
        }
    }

    #[inline(always)]
    fn bucket(&self, key: usize) -> &Cell<Link> {
        let index = HashedKey::hash_address(key) & self.bucket_mask.get();
        // SAFETY: inside the buffer, and initialized. No reference outlives a method that replaces the buffer.
        unsafe { &*self.buffer.get().cast::<Cell<Link>>().add(index as usize) }
    }

    #[inline(always)]
    fn link_of(&self, number: u32) -> Link {
        self.bucket_count() / 2 + number * Self::ENTRY_WORDS
    }

    #[inline(always)]
    fn entry_ptr(&self, link: Link) -> *mut Entry<K> {
        self.buffer.get().wrapping_add(link as usize).cast()
    }

    /// # Safety
    /// The link of an entry that has been written.
    #[inline(always)]
    unsafe fn entry_at(&self, link: Link) -> &Entry<K> {
        // SAFETY: the caller's.
        unsafe { &*self.entry_ptr(link) }
    }

    #[inline(always)]
    fn entries(&self) -> &[Entry<K>] {
        let first = self.entry_ptr(self.link_of(0));
        // SAFETY: have been written.
        unsafe { core::slice::from_raw_parts(first, self.used.get() as usize) }
    }

    /// The number of the first entry that may have been written since the last collection.
    fn first_dirty(&self) -> usize {
        let words = self.clean_until.get().saturating_sub(self.link_of(0));
        (words / Self::ENTRY_WORDS) as usize
    }

    /// Those that a collection has to look at.
    fn entries_in(&self, scope: Scope) -> &[Entry<K>] {
        match scope {
            Scope::Eden => &self.entries()[self.first_dirty()..],
            Scope::Full => self.entries(),
        }
    }

    #[inline(always)]
    fn did_dirty(&self, link: Link) {
        if link < self.clean_until.get() {
            self.clean_until.set(link);
        }
    }

    /// What holds the link of the entry that has the key.
    #[inline(always)]
    #[cfg_attr(
        rootcheck,
        rootcheck::allow("lent for as long as `self`, as a bucket is")
    )]
    fn find_referrer(&self, key: usize) -> Option<&Cell<Link>> {
        let mut referrer = self.bucket(key);
        while referrer.get() != END_OF_CHAIN {
            // SAFETY: from a chain.
            let entry = unsafe { self.entry_at(referrer.get()) };
            if entry.key.get() == key {
                return Some(referrer);
            }
            referrer = &entry.next;
        }
        None
    }

    #[inline(always)]
    pub fn has(&self, key: Gc<JsCell>) -> bool {
        self.find_referrer(key.address()).is_some()
    }

    #[inline(always)]
    pub(super) fn find_payload(&self, key: Gc<JsCell>) -> Option<K::Payload> {
        let link = self.find_referrer(key.address())?.get();
        // SAFETY: from a chain.
        Some(K::payload(&unsafe { self.entry_at(link) }.slot))
    }

    #[inline(always)]
    pub(super) fn insert(&self, key: Gc<JsCell>, payload: K::Payload) -> Result<(), AllocError> {
        let Some(link) = self.find_referrer(key.address()).map(Cell::get) else {
            return self.append(key, payload);
        };
        // SAFETY: from a chain, and the barrier follows.
        unsafe { K::store(&self.entry_at(link).slot, payload) };
        if K::cell_in(payload).is_some() {
            self.did_dirty(link);
            self.write_barrier_for_cell();
        }
        Ok(())
    }

    /// The key is not there.
    #[inline(always)]
    pub(super) fn append(&self, key: Gc<JsCell>, payload: K::Payload) -> Result<(), AllocError> {
        if self.used.get() == self.capacity.get() {
            self.make_room()?;
        }
        key.will_be_held_weakly();
        let used = self.used.get();
        // SAFETY: there is room, and the barrier follows.
        unsafe { self.write_entry(self.link_of(used), key.address(), payload) };
        self.used.set(used + 1);
        self.live.update(|live| live + 1);
        self.write_barrier_for_cell();
        Ok(())
    }

    /// # Safety
    /// The link is that of an entry below the capacity which is in no chain. The collector learns of what is stored.
    #[inline(always)]
    unsafe fn write_entry(&self, link: Link, key: usize, payload: K::Payload) {
        let next = self.bucket(key).replace(link);
        let entry = self.entry_ptr(link);
        // SAFETY: the caller's. Nothing is read.
        unsafe {
            (*entry).set_key(key);
            (&raw mut (*entry).next).write(Cell::new(next));
            K::store(&(*entry).slot, payload);
        }
    }

    #[inline(always)]
    pub fn remove(&self, key: Gc<JsCell>) -> bool {
        let Some(referrer) = self.find_referrer(key.address()) else {
            return false;
        };
        let link = referrer.get();
        // SAFETY: from a chain.
        let entry = unsafe { self.entry_at(link) };
        referrer.set(entry.next.get());
        entry.set_key(0);
        K::clear(&entry.slot);
        self.live.update(|live| live - 1);
        if self.bucket_count() > Self::BUCKETS_KEPT_BY_REMOVE && self.is_sparse() {
            self.shrink();
        } else if link == self.link_of(self.used.get() - 1) {
            let last_chained = self.entries().iter().rposition(|it| it.key.get() != 0);
            (self.used).set(last_chained.map_or(0, |last| last as u32 + 1));
            self.did_dirty(self.link_of(self.used.get()));
        }
        true
    }

    #[inline(always)]
    fn is_sparse(&self) -> bool {
        self.size() < self.capacity.get() / 8
    }

    #[inline(never)]
    fn make_room(&self) -> Result<(), AllocError> {
        let buckets = match self.bucket_count() {
            buckets if self.size() <= self.capacity.get() * 3 / 4 => buckets,
            Self::INLINE_BUCKETS => Self::MIN_ALLOCATED_BUCKETS,
            Self::MAX_BUCKETS => return Err(AllocError),
            buckets if buckets < Self::FEW_BUCKETS => buckets * 4,
            buckets => buckets * 2,
        };
        let words_before = self.allocated_words();
        self.rebuild(buckets)?;
        let growth = self.allocated_words() - words_before;
        self.heap().did_allocate(growth as usize * WORD);
        Ok(())
    }

    fn buckets_after_shrinking(&self) -> u32 {
        if self.size() < Self::INLINE_CAPACITY {
            return Self::INLINE_BUCKETS;
        }
        (self.size() * 4)
            .next_power_of_two()
            .max(Self::MIN_ALLOCATED_BUCKETS)
    }

    /// Does nothing if there is no memory.
    #[inline(never)]
    fn shrink(&self) {
        let _ = self.rebuild(self.buckets_after_shrinking());
    }

    /// Leaves the live entries without gaps. Cannot fail if the number of buckets stays as it is.
    fn rebuild(&self, buckets: u32) -> Result<(), AllocError> {
        let (old_entries, first_dirty) = (self.entries(), self.first_dirty());
        let mut unused = None;
        if buckets != self.bucket_count() {
            let (buffer, capacity) = if buckets == Self::INLINE_BUCKETS {
                (self.inline.get().cast(), Self::INLINE_CAPACITY)
            } else {
                let size = Self::words_for(buckets) as usize * WORD;
                (default_alloc::malloc(size).cast::<u64>(), buckets / 2)
            };
            if buffer.is_null() {
                return Err(AllocError);
            }
            unused = (!self.is_inline()).then(|| self.buffer.get());
            self.buffer.set(buffer);
            self.bucket_mask.set(buckets - 1);
            self.capacity.set(capacity);
        }
        // SAFETY: the start of the buffer, where no entry is.
        unsafe { self.buffer.get().write_bytes(0, buckets as usize / 2) };
        let (clean, dirty) = old_entries.split_at(first_dirty);
        let first_dirty = self.move_entries(clean, 0);
        self.used.set(self.move_entries(dirty, first_dirty));
        self.clean_until.set(self.link_of(first_dirty));
        if let Some(buffer) = unused {
            // SAFETY: owned, and not read again.
            unsafe {
                match self.may_be_read_by_marker() {
                    true => self.heap().free_after_marking(buffer.cast()),
                    false => default_alloc::free(buffer.cast()),
                }
            }
        }
        Ok(())
    }

    /// Writes the live ones from `target` on, and returns the number after the last. They are in no chain and, if
    /// they are in the buffer, not before `target`.
    fn move_entries(&self, entries: &[Entry<K>], mut target: u32) -> u32 {
        const LOOKAHEAD: usize = 16;
        for (index, entry) in entries.iter().enumerate() {
            if let Some(key) = entries.get(index + LOOKAHEAD).and_then(Entry::live_key) {
                prefetch(self.bucket(key).as_ptr().addr());
            }
            if let Some(key) = entry.live_key() {
                assert!(target < self.capacity.get());
                // SAFETY: checked. What is there has been moved or dropped.
                unsafe { self.write_entry(self.link_of(target), key, K::payload(&entry.slot)) };
                target += 1;
            }
        }
        target
    }

    /// In the order in which they were added. Goes by number, because a change can replace the buffer.
    pub fn items<'a>(&'a self, _: &'a NoGc<'_>) -> impl Iterator<Item = K::Item> + 'a {
        let item = |entry: &Entry<K>| {
            // SAFETY: the collector says that it is dead before it frees the cell.
            let key = unsafe { Value::from_bits(entry.live_key()? as u64) };
            Some(K::item(key, K::payload(&entry.slot)))
        };
        (0..)
            .map_while(move |number| self.entries().get(number).map(item))
            .flatten()
    }

    fn visit_values_of_marked_keys(&self, visitor: &mut Visitor) {
        const {
            assert!(
                !K::HAS_VALUES
                    || (Self::ENTRY_WORDS == 3 && Self::OFFSET_OF_ENTRY_VALUE == 2 * WORD)
            );
        };
        if K::HAS_VALUES {
            let entries = self.entries_in(visitor.scope());
            // SAFETY: laid out so. An entry without a key has no value, and `rebuild` keeps the memory.
            unsafe { visitor.append_ephemerons(entries.as_ptr().cast(), entries.len()) };
        }
    }

    fn remove_dead_keys(&self, survivors: &Survivors) {
        let entries = self.entries_in(survivors.scope());
        let (first, count) = (entries.as_ptr().cast(), entries.len());
        // SAFETY: the keys that have died earlier are odd.
        let dead = unsafe {
            match K::HAS_VALUES {
                true => survivors.condemn_keys::<3>(first, count),
                false => survivors.condemn_keys::<2>(first, count),
            }
        };
        self.live.update(|live| live - dead as u32);
        if dead != 0 && self.is_sparse() {
            self.shrink();
        }
        self.clean_until.set(self.link_of(self.used.get()));
        // What a collection of the young has counted stays counted until a full one starts over.
        let counted = self.counted_words.load(Ordering::Relaxed);
        if let Some(uncounted) = self.allocated_words().checked_sub(counted) {
            survivors.report_extra_memory(uncounted as usize * WORD);
            self.counted_words
                .store(self.allocated_words(), Ordering::Relaxed);
        }
    }
}

const _: () = {
    assert!(IS_DEAD == 1 && WeakCollection::<SetKind>::ENTRY_WORDS == 2);
    assert!(WeakCollection::<MapKind>::ENTRY_WORDS == 3);
    assert!(WeakCollection::<MapKind>::OFFSET_OF_ENTRY_VALUE == 2 * WORD);
};

const _: () = assert!(
    WeakCollection::<MapKind>::MAX_BUCKETS as usize / 2
        * (1 + WeakCollection::<MapKind>::ENTRY_WORDS as usize)
        <= Link::MAX as usize
);
