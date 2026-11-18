//! What a cell holds references in. A store goes through the cell that owns the memory, for the write barrier.

use core::cell::UnsafeCell;
use core::hash::Hash;
use core::marker::PhantomData;
use core::ops::{Deref, DerefMut};
use core::sync::atomic::{AtomicU64, Ordering};

use bun_alloc::AllocError;

use super::cell::CellLockGuard;
use super::{Gc, GcFree, RootVec, Trace, Visitor, barrier, gc::keep_alive, root_vec};
use crate::{CellKind, Cx, FastHashMap, JsCell, Value, Vm};

/// # Safety
/// The word is zero or the bits of a `Value`, and converts back to what it was made from.
pub unsafe trait FieldValue: Copy {
    fn to_word(self) -> u64;

    /// # Safety
    /// The word came from `to_word`, and its cell is alive.
    unsafe fn from_word(word: u64) -> Self;
}

macro_rules! field_values {
    ($(impl<$($parameter:ident)?> $type:ty, |$value:ident| $to:expr, |$word:ident| $from:expr;)*) => {$(
        // SAFETY: a cell is encoded as its address, and `None` as zero.
        unsafe impl<$($parameter: CellKind)?> FieldValue for $type {
            #[inline(always)]
            fn to_word(self) -> u64 {
                let $value = self;
                $to
            }

            #[inline(always)]
            unsafe fn from_word($word: u64) -> Self {
                // SAFETY: the caller's.
                unsafe { $from }
            }
        }
    )*};
}

field_values! {
    impl<> Value, |value| value.to_bits(), |word| Value::from_bits(word);
    impl<> Option<Value>, |value| Value::bits_of(value), |word| Value::from_bits_or_empty(word);
    impl<T> Gc<T>, |cell| cell.address() as u64, |word| Gc::from_address(word as usize);
    impl<T> Option<Gc<T>>, |cell| cell.map_or(0, |cell| cell.address() as u64),
        |word| core::mem::transmute::<*mut T, Option<Gc<T>>>(core::ptr::with_exposed_provenance_mut(word as usize));
}

#[repr(transparent)]
pub struct Field<T>(UnsafeCell<u64>, PhantomData<T>);

impl<T> !GcFree for Field<T> {}

impl<T: FieldValue> Field<T> {
    #[inline(always)]
    pub fn new(value: T) -> Field<T> {
        Field(UnsafeCell::new(value.to_word()), PhantomData)
    }

    #[inline(always)]
    pub fn get(&self) -> T {
        // SAFETY: only this thread stores, and the owner keeps what it refers to alive.
        unsafe { T::from_word(*self.0.get()) }
    }

    /// For a marker that looks into the cell, which `publish` has stored.
    #[inline(always)]
    pub(crate) fn get_published(&self) -> T {
        // SAFETY: nothing that a marker can get at is freed while it is at work.
        unsafe { T::from_word(self.atomic().load(Ordering::Acquire)) }
    }

    /// # Safety
    /// As for `set`.
    #[inline(always)]
    pub(crate) unsafe fn publish(&self, owner: &JsCell, value: T) {
        self.atomic().store(value.to_word(), Ordering::Release);
        owner.write_barrier_for_cell();
    }

    /// # Safety
    /// `owner` is the cell that traces the field.
    #[inline(always)]
    pub unsafe fn set(&self, owner: &JsCell, value: T) {
        let word = value.to_word();
        self.atomic().store(word, Ordering::Relaxed);
        if word & Value::NOT_CELL_MASK == 0 && word != 0 {
            owner.write_barrier_for_cell();
        }
    }

    /// # Safety
    /// `value` is no cell, or the barrier of the owner runs before the next allocation, or the owner is new.
    #[inline(always)]
    pub unsafe fn set_without_barrier(&self, value: T) {
        self.atomic().store(value.to_word(), Ordering::Relaxed);
    }
}

impl<T> Field<T> {
    #[inline(always)]
    fn atomic(&self) -> &AtomicU64 {
        // SAFETY: aligned. The plain loads are on the only thread that stores.
        unsafe { AtomicU64::from_ptr(self.0.get()) }
    }

    /// # Safety
    /// As for `set_without_barrier`, and the word suits what the memory is taken for.
    #[inline(always)]
    pub unsafe fn set_word_without_barrier(&self, word: u64) {
        self.atomic().store(word, Ordering::Relaxed);
    }

    #[inline(always)]
    pub(crate) fn word_concurrently(&self) -> u64 {
        self.atomic().load(Ordering::Relaxed)
    }
}

// SAFETY: `set` runs the barrier.
unsafe impl<T> Trace for Field<T> {
    #[inline(always)]
    fn trace(&self, visitor: &mut Visitor) {
        // SAFETY: zero or a value that the owner keeps alive.
        unsafe { visitor.append_word(self.word_concurrently()) }
    }
}

/// Does not keep its cell alive, and becomes `None` when the cell dies. `T` is an `Option<Gc<_>>`. Only for a field of
/// the cell itself, whose address does not change.
#[repr(transparent)]
pub struct WeakField<T>(Field<T>);

impl<T: CellKind> WeakField<Option<Gc<T>>> {
    #[inline(always)]
    pub fn new(value: Option<Gc<T>>) -> Self {
        WeakField(Field::new(value))
    }

    #[inline(always)]
    pub fn get(&self) -> Option<Gc<T>> {
        self.0.get()
    }

    /// # Safety
    /// `owner` is the cell that the field is in.
    #[inline(always)]
    pub unsafe fn set(&self, owner: &JsCell, value: Option<Gc<T>>) {
        // SAFETY: the caller's.
        unsafe { self.0.set(owner, value) }
    }
}

// SAFETY: the collector clears the field before it frees the cell.
unsafe impl<T> Trace for WeakField<T> {
    #[inline]
    fn trace(&self, visitor: &mut Visitor) {
        // SAFETY: inside the cell that is being visited, which outlives this collection.
        unsafe { visitor.append_weak_word(self.0.atomic()) }
    }
}

/// A part of a cell together with the cell.
pub struct Owned<'a, T: ?Sized> {
    owner: &'a JsCell,
    field: &'a T,
}

impl<T: ?Sized> Clone for Owned<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T: ?Sized> Copy for Owned<'_, T> {}

impl<'a, T: ?Sized> Owned<'a, T> {
    /// # Safety
    /// `owner` traces `field` for as long as the borrow lasts.
    #[inline(always)]
    #[cfg_attr(rootcheck, rootcheck::stays("as long as `field` does"))]
    pub unsafe fn new(owner: &'a JsCell, field: &'a T) -> Owned<'a, T> {
        Owned { owner, field }
    }

    #[inline(always)]
    fn lock_if_marking(self) -> Option<CellLockGuard<'a>> {
        barrier::is_fenced().then(|| self.owner.lock())
    }

    #[inline(always)]
    fn did_change(self, added_bytes: usize) {
        if added_bytes != 0 {
            (self.owner.heap()).note_extra_memory_allocated(self.owner, added_bytes);
        }
        self.owner.write_barrier_for_cell();
    }
}

pub trait OwnedField {
    type Init;
}

impl<'a, T: FieldValue> Owned<'a, [Field<T>]> {
    #[inline(always)]
    pub fn len(self) -> usize {
        self.field.len()
    }

    #[inline(always)]
    pub fn is_empty(self) -> bool {
        self.field.is_empty()
    }

    /// Panics past the end.
    #[inline(always)]
    pub fn at(self, index: usize) -> T {
        self.field[index].get()
    }

    #[inline(always)]
    pub fn get(self, index: usize) -> Option<T> {
        self.field.get(index).map(Field::get)
    }

    /// Panics past the end.
    #[inline(always)]
    pub fn set(self, index: usize, value: T) {
        // SAFETY: the owner traces the slice.
        unsafe { self.field[index].set(self.owner, value) }
    }

    #[inline(always)]
    pub fn iter(self) -> impl DoubleEndedIterator<Item = T> + ExactSizeIterator + Clone + 'a {
        self.field.iter().map(Field::get)
    }

    #[inline(always)]
    pub fn slice(self, range: core::ops::Range<usize>) -> Owned<'a, [Field<T>]> {
        Owned {
            owner: self.owner,
            field: &self.field[range],
        }
    }

    /// Stops at the end of the shorter of the two.
    #[inline]
    pub fn fill_from(self, values: impl IntoIterator<Item = T>) {
        for (field, value) in self.field.iter().zip(values) {
            // SAFETY: the owner traces the slice.
            unsafe { field.set(self.owner, value) }
        }
    }

    /// As `memmove`. Panics if the lengths differ.
    #[inline]
    pub fn copy_from(self, source: Owned<'_, [Field<T>]>) {
        assert!(self.len() == source.len());
        // SAFETY: both are `len` fields of the same type, and the barrier follows.
        unsafe {
            barrier::move_words(
                source.field.as_ptr().cast(),
                self.field.as_ptr().cast_mut().cast(),
                self.len(),
            );
        }
        self.owner.write_barrier_for_cell();
    }

    #[inline]
    pub fn fill(self, value: T) {
        for field in self.field {
            // SAFETY: the barrier follows.
            unsafe { field.set_without_barrier(value) }
        }
        self.owner.write_barrier_for_cell();
    }

    #[inline]
    pub fn reverse(self) {
        let (mut front, mut back) = (0, self.len());
        while front + 1 < back {
            back -= 1;
            let (a, b) = (self.field[front].get(), self.field[back].get());
            // SAFETY: the barrier follows.
            unsafe {
                self.field[front].set_without_barrier(b);
                self.field[back].set_without_barrier(a);
            }
            front += 1;
        }
        self.owner.write_barrier_for_cell();
    }
}

#[repr(transparent)]
pub struct FieldArray<T, const N: usize>([Field<T>; N]);

impl<T, const N: usize> OwnedField for FieldArray<T, N> {
    type Init = [T; N];
}

impl<T: FieldValue, const N: usize> FieldArray<T, N> {
    #[inline(always)]
    pub fn new(values: [T; N]) -> Self {
        FieldArray(values.map(Field::new))
    }
}

// SAFETY: visits each field.
unsafe impl<T, const N: usize> Trace for FieldArray<T, N> {
    #[inline]
    fn trace(&self, visitor: &mut Visitor) {
        self.0.trace(visitor);
    }
}

impl<'a, T: FieldValue, const N: usize> Owned<'a, FieldArray<T, N>> {
    #[inline(always)]
    pub fn as_slice(self) -> Owned<'a, [Field<T>]> {
        Owned {
            owner: self.owner,
            field: &self.field.0,
        }
    }

    #[inline(always)]
    pub fn at(self, index: usize) -> T {
        self.as_slice().at(index)
    }

    #[inline(always)]
    pub fn set(self, index: usize, value: T) {
        self.as_slice().set(index, value);
    }
}

/// A growable list that a cell owns. Elements are copied in and out, so nothing borrows it across other code.
#[cfg_attr(rootcheck, rootcheck::allow("filled and read only through `Owned`"))]
#[cfg_attr(rootcheck, rootcheck::stays("lends nothing"))]
pub struct TracedVec<T>(UnsafeCell<Vec<T>>);

impl<T> TracedVec<T> {
    pub const fn empty() -> TracedVec<T> {
        TracedVec(UnsafeCell::new(Vec::new()))
    }
}

// SAFETY: every change is made under the lock of the owner, if a marker is running, and followed by the barrier.
unsafe impl<T: Trace> Trace for TracedVec<T> {
    fn trace(&self, visitor: &mut Visitor) {
        visitor.with_current_cell_locked(|visitor| {
            // SAFETY: nothing changes the list while the lock is held.
            let list = unsafe { &*self.0.get() };
            list.trace(visitor);
            visitor.report_extra_memory(list.capacity() * size_of::<T>());
        });
    }
}

impl<'a, T: Copy> Owned<'a, TracedVec<T>> {
    #[inline(always)]
    fn read<R>(self, read: impl FnOnce(&Vec<T>) -> R) -> R {
        // SAFETY: the callers in this file run no other code while they have the reference.
        read(unsafe { &*self.field.0.get() })
    }

    #[inline(always)]
    fn change<R>(self, change: impl FnOnce(&mut Vec<T>) -> R) -> R {
        let lock = self.lock_if_marking();
        // SAFETY: as in `read`, and no marker reads the list meanwhile.
        let list = unsafe { &mut *self.field.0.get() };
        let capacity = list.capacity();
        let result = change(list);
        let added = list.capacity().saturating_sub(capacity);
        drop(lock);
        self.did_change(added * size_of::<T>());
        result
    }

    #[inline]
    pub fn len(self) -> usize {
        self.read(Vec::len)
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.len() == 0
    }

    #[inline]
    pub fn get(self, index: usize) -> Option<T> {
        self.read(|list| list.get(index).copied())
    }

    /// Panics past the end.
    #[inline]
    pub fn at(self, index: usize) -> T {
        self.read(|list| list[index])
    }

    pub fn last(self) -> Option<T> {
        self.read(|list| list.last().copied())
    }

    pub fn set(self, index: usize, value: T) {
        self.change(|list| list[index] = value);
    }

    pub fn push(self, value: T) {
        self.change(|list| list.push(value));
    }

    pub fn pop(self) -> Option<T> {
        self.change(Vec::pop)
    }

    pub fn insert(self, index: usize, value: T) {
        self.change(|list| list.insert(index, value));
    }

    pub fn remove(self, index: usize) -> T {
        self.change(|list| list.remove(index))
    }

    pub fn swap_remove(self, index: usize) -> T {
        self.change(|list| list.swap_remove(index))
    }

    pub fn truncate(self, length: usize) {
        self.change(|list| list.truncate(length));
    }

    pub fn reverse_from(self, index: usize) {
        self.change(|list| list[index..].reverse());
    }

    pub fn resize(self, length: usize, value: T) {
        self.change(|list| list.resize(length, value));
    }

    pub fn extend_from_slice(self, values: &[T]) {
        self.change(|list| {
            list.reserve_exact(values.len());
            list.extend_from_slice(values);
        });
    }

    /// Frees the memory too.
    pub fn clear(self) {
        self.change(|list| *list = Vec::new());
    }

    pub fn to_root_vec(self) -> RootVec<T> {
        let mut copy = root_vec();
        self.read(|list| copy.extend_from_slice(list));
        copy
    }

    pub fn take(self) -> RootVec<T> {
        let copy = self.to_root_vec();
        self.clear();
        copy
    }

    /// Goes by index, so the list may change on the way.
    pub fn iter(self) -> impl Iterator<Item = T> + 'a {
        (0..).map_while(move |index| self.get(index))
    }
}

/// A hash map that a cell owns. Values are copied in and out.
#[cfg_attr(rootcheck, rootcheck::allow("filled and read only through `Owned`"))]
#[cfg_attr(rootcheck, rootcheck::stays("lends nothing"))]
pub struct TracedMap<K, V>(UnsafeCell<FastHashMap<K, V>>);

impl<K, V> Default for TracedMap<K, V> {
    fn default() -> TracedMap<K, V> {
        TracedMap::empty()
    }
}

impl<K, V> TracedMap<K, V> {
    pub fn empty() -> TracedMap<K, V> {
        TracedMap(UnsafeCell::new(FastHashMap::default()))
    }
}

// SAFETY: as for `TracedVec`.
unsafe impl<K: GcFree, V: Trace> Trace for TracedMap<K, V> {
    fn trace(&self, visitor: &mut Visitor) {
        visitor.with_current_cell_locked(|visitor| {
            // SAFETY: nothing changes the map while the lock is held.
            let map = unsafe { &*self.0.get() };
            map.trace(visitor);
            visitor.report_extra_memory(map.capacity() * size_of::<(K, V)>());
        });
    }
}

/// # Safety
/// Hashing, comparing, cloning and dropping touch no cell.
pub unsafe trait PlainKey: Hash + Eq + Clone + GcFree {}

macro_rules! plain_keys {
    ($($type:ty),*) => {$(
        // SAFETY: knows nothing of cells.
        unsafe impl PlainKey for $type {}
    )*};
}

plain_keys!(
    u8,
    u16,
    u32,
    u64,
    usize,
    i32,
    i64,
    bun_engine_text::Identifier,
    bun_engine_text::Atom,
    bun_engine_text::StringRef
);

// SAFETY: made of two that are.
unsafe impl<A: PlainKey, B: PlainKey> PlainKey for (A, B) {}

// SAFETY: one that is, or nothing.
unsafe impl<A: PlainKey> PlainKey for Option<A> {}

impl<K: PlainKey, V: Copy> Owned<'_, TracedMap<K, V>> {
    #[inline(always)]
    fn read<R>(self, read: impl FnOnce(&FastHashMap<K, V>) -> R) -> R {
        // SAFETY: the callers in this file run no other code while they have the reference.
        read(unsafe { &*self.field.0.get() })
    }

    #[inline(always)]
    fn change<R>(self, change: impl FnOnce(&mut FastHashMap<K, V>) -> R) -> R {
        let lock = self.lock_if_marking();
        // SAFETY: as in `read`, and no marker reads the map meanwhile.
        let map = unsafe { &mut *self.field.0.get() };
        let capacity = map.capacity();
        let result = change(map);
        let added = map.capacity().saturating_sub(capacity);
        drop(lock);
        self.did_change(added * size_of::<(K, V)>());
        result
    }

    pub fn len(self) -> usize {
        self.read(FastHashMap::len)
    }

    pub fn is_empty(self) -> bool {
        self.len() == 0
    }

    pub fn get<Q: Hash + hashbrown::Equivalent<K> + ?Sized>(self, key: &Q) -> Option<V> {
        self.read(|map| map.get(key).copied())
    }

    pub fn contains_key<Q: Hash + hashbrown::Equivalent<K> + ?Sized>(self, key: &Q) -> bool {
        self.read(|map| map.contains_key(key))
    }

    pub fn insert(self, key: K, value: V) -> Option<V> {
        self.change(|map| map.insert(key, value))
    }

    pub fn try_reserve(self, additional: usize) -> Result<(), AllocError> {
        self.change(|map| map.try_reserve(additional).map_err(|_| AllocError))
    }

    pub fn capacity(self) -> usize {
        self.read(FastHashMap::capacity)
    }

    pub fn remove<Q: Hash + hashbrown::Equivalent<K> + ?Sized>(self, key: &Q) -> Option<V> {
        self.change(|map| map.remove(key))
    }

    pub fn clear(self) {
        self.change(|map| *map = FastHashMap::default());
    }

    /// `keeps` does not touch the map.
    pub(crate) fn retain(self, mut keeps: impl FnMut(&K, V) -> bool) {
        self.change(|map| map.retain(|key, &mut value| keeps(key, value)));
    }

    /// `visit` does not touch the map.
    pub(crate) fn for_each(self, mut visit: impl FnMut(&K, V)) {
        self.read(|map| map.iter().for_each(|(key, &value)| visit(key, value)));
    }

    /// `update` does not touch the map.
    pub(crate) fn update_values(self, update: impl FnMut(&mut V)) {
        self.change(|map| map.values_mut().for_each(update));
    }

    pub fn keys(self) -> Vec<K> {
        self.read(|map| map.keys().cloned().collect())
    }

    /// Of those that `filter`, which touches no cell, lets pass.
    pub(crate) fn min_key(self, filter: impl Fn(&K) -> bool) -> Option<K>
    where
        K: Ord,
    {
        self.read(|map| map.keys().filter(|key| filter(key)).min().cloned())
    }

    pub fn values(self) -> RootVec<V> {
        let mut values = root_vec();
        self.read(|map| values.extend(map.values()));
        values
    }

    pub fn entries(self) -> RootVec<(K, V)> {
        let mut entries = root_vec();
        self.read(|map| entries.extend(map.iter().map(|(key, &value)| (key.clone(), value))));
        entries
    }
}

/// State of any shape that a cell owns. Reading it borrows the `Vm`, so no script runs meanwhile. Changing it borrows
/// the `Cx` exclusively, so nothing is allocated either.
#[cfg_attr(rootcheck, rootcheck::allow("filled and read only through `Owned`"))]
#[cfg_attr(rootcheck, rootcheck::stays("lends nothing"))]
pub struct GcCell<T>(UnsafeCell<T>);

impl<T: Default> GcCell<T> {
    pub fn empty() -> GcCell<T> {
        GcCell(UnsafeCell::new(T::default()))
    }
}

// SAFETY: `GcRefMut` holds the lock of the owner, if a marker is running, and ends with the barrier.
unsafe impl<T: Trace> Trace for GcCell<T> {
    fn trace(&self, visitor: &mut Visitor) {
        // SAFETY: nothing changes the content while the lock is held.
        visitor.with_current_cell_locked(|visitor| unsafe { &*self.0.get() }.trace(visitor));
    }
}

impl<'a, T> Owned<'a, GcCell<T>> {
    #[inline]
    pub fn borrow(self, _: &'a Vm) -> GcRef<'a, T> {
        GcRef(self)
    }

    #[inline]
    pub fn borrow_mut(self, _: &'a mut Cx) -> GcRefMut<'a, T> {
        GcRefMut {
            lock: self.lock_if_marking(),
            cell: self,
        }
    }

    /// For `reconcile_weak_references`, when nothing but the collector runs.
    ///
    /// # Safety
    /// No `GcRef` that is alive on the stack observes the change.
    #[inline]
    pub unsafe fn get_mut_unchecked(self) -> &'a mut T {
        // SAFETY: the caller's.
        unsafe { &mut *self.field.0.get() }
    }
}

pub struct GcRef<'a, T>(Owned<'a, GcCell<T>>);

impl<T> Deref for GcRef<'_, T> {
    type Target = T;

    #[inline(always)]
    fn deref(&self) -> &T {
        // SAFETY: a `GcRefMut` needs the `Cx` that this borrows from.
        unsafe { &*self.0.field.0.get() }
    }
}

impl<T> Drop for GcRef<'_, T> {
    #[inline(always)]
    fn drop(&mut self) {
        keep_alive(self.0.owner.address());
    }
}

#[cfg_attr(rootcheck, rootcheck::stays("ends with the barrier of the owner"))]
pub struct GcRefMut<'a, T> {
    lock: Option<CellLockGuard<'a>>,
    cell: Owned<'a, GcCell<T>>,
}

impl<T> Deref for GcRefMut<'_, T> {
    type Target = T;

    #[inline(always)]
    fn deref(&self) -> &T {
        // SAFETY: this has the `Cx` to itself.
        unsafe { &*self.cell.field.0.get() }
    }
}

impl<T> DerefMut for GcRefMut<'_, T> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: as above.
        unsafe { &mut *self.cell.field.0.get() }
    }
}

impl<T> Drop for GcRefMut<'_, T> {
    #[inline]
    fn drop(&mut self) {
        self.lock = None;
        self.cell.owner.write_barrier_for_cell();
    }
}
