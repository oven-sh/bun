use core::marker::PhantomData;
use core::mem::offset_of;
use core::ops::Deref;

use bun_alloc::AllocError;

use super::ordered_table::Entry;
use super::{HashedKey, MapKind, OrderedTable, SetKind, TableKind};
use crate::{
    CellKind, CellType, Class, ClassOps, Cx, Extends, Field, Gc, GcFree, JsCell, JsObject,
    JsObjectInit, JsResult, NoGc, Shape, Trace, TypeFlags, Value, Visitor, Vm,
};

/// What `JsMap` and `JsSet` have in common.
#[repr(C)]
pub struct OrderedCollection<K: TableKind> {
    base: JsObject,
    /// Never a retired one.
    table: Field<Gc<OrderedTable<K>>>,
}

pub struct OrderedCollectionInit<K: TableKind> {
    base: JsObjectInit,
    table: Gc<OrderedTable<K>>,
}

impl<K: TableKind> !GcFree for OrderedCollection<K> {}

impl<K: TableKind> Deref for OrderedCollection<K> {
    type Target = JsObject;

    #[inline(always)]
    fn deref(&self) -> &JsObject {
        &self.base
    }
}

// SAFETY: starts with a `JsObject`.
unsafe impl<K: TableKind, T> Extends<T> for OrderedCollection<K> where JsObject: Extends<T> {}

// SAFETY: visits the table. The type of cell means the one class that extends this one.
unsafe impl<K: TableKind> CellKind for OrderedCollection<K> {
    type Base = JsObject;
    type Init = OrderedCollectionInit<K>;

    const CLASS: &'static Class = JsObject::CLASS;
    const CELL_TYPE: CellType = K::COLLECTION_TYPE;
    const FLAGS: TypeFlags = JsObject::FLAGS;
    const HOLDS_CLASS: bool = false;
    const OPS: ClassOps = JsObject::OPS;

    #[inline(always)]
    fn is(cell: &JsCell) -> bool {
        cell.cell_type() == K::COLLECTION_TYPE
    }

    #[inline(always)]
    fn shape_of(init: &Self::Init) -> Gc<Shape> {
        JsObject::shape_of(&init.base)
    }

    #[inline(always)]
    unsafe fn initialize(this: *mut Self, init: Self::Init) {
        assert!(Self::shape_of(&init).instance_type() == K::COLLECTION_TYPE);
        // SAFETY: the caller's.
        unsafe {
            JsObject::initialize(&raw mut (*this).base, init.base);
            (&raw mut (*this).table).write(Field::new(init.table));
        }
    }

    #[inline]
    fn trace_fields(&self, visitor: &mut Visitor) {
        self.base.trace_fields(visitor);
        self.table.trace(visitor);
    }
}

impl<K: TableKind> OrderedCollection<K> {
    pub const OFFSET_OF_TABLE: usize = offset_of!(Self, table);
    /// A table of at most this many buckets is not worth giving up for a smaller one.
    const BUCKETS_KEPT_BY_REMOVE: u32 = 32;
    const BUCKETS_KEPT_BY_CLEAR: u32 = 128;

    #[inline(always)]
    pub(super) fn init(vm: &Vm, shape: Gc<Shape>) -> OrderedCollectionInit<K> {
        OrderedCollectionInit {
            base: JsObjectInit::new(vm, shape),
            table: K::empty_table(vm),
        }
    }

    #[inline(always)]
    pub(super) fn table(&self) -> Gc<OrderedTable<K>> {
        self.table.get()
    }

    #[inline(always)]
    pub(super) fn set_table(&self, table: Gc<OrderedTable<K>>) {
        table.set_collection(self);
        // SAFETY: its own field.
        unsafe { self.table.set(self, table) };
    }

    #[inline(always)]
    pub fn size(&self) -> u32 {
        self.table().len()
    }

    /// `None` if the collection is empty, so that nothing is to be looked up.
    #[inline(always)]
    pub(super) fn hash_for_lookup(&self, cx: &Cx, key: Value) -> JsResult<Option<HashedKey>> {
        if self.size() == 0 {
            return Ok(None);
        }
        HashedKey::new(cx, key).map(Some)
    }

    #[inline(always)]
    pub fn has(&self, cx: &Cx, key: Value) -> JsResult<bool> {
        let key = self.hash_for_lookup(cx, key)?;
        Ok(key.is_some_and(|key| self.has_hashed(key)))
    }

    #[inline(always)]
    pub fn has_hashed(&self, key: HashedKey) -> bool {
        self.table().find(key).is_some()
    }

    /// The address of the entry, or zero.
    #[inline]
    pub fn entry_address(&self, key: HashedKey) -> usize {
        let table = self.table();
        table
            .find(key)
            .map_or(0, |entry| core::ptr::from_ref(entry).expose_provenance())
    }

    #[inline(always)]
    pub(super) fn insert(
        &self,
        vm: &Vm,
        key: HashedKey,
        payload: K::Payload,
    ) -> Result<(), AllocError> {
        if self.table().replace(key, payload) {
            return Ok(());
        }
        self.append(vm, key, payload)
    }

    /// The key is not there.
    #[inline(always)]
    pub(super) fn append(
        &self,
        vm: &Vm,
        key: HashedKey,
        payload: K::Payload,
    ) -> Result<(), AllocError> {
        let mut table = self.table();
        if table.is_full() {
            self.make_room(vm)?;
            table = self.table();
        }
        table.push(key, payload);
        Ok(())
    }

    #[inline(never)]
    fn make_room(&self, vm: &Vm) -> Result<(), AllocError> {
        let table = self.table();
        if table.len() > table.capacity() / 2 || table.is_shared() {
            return self.rehash(vm, table.buckets_after_growth()?);
        }
        if table.may_have_cursors() {
            return self.rehash(vm, table.bucket_count());
        }
        table.compact_in_place();
        Ok(())
    }

    fn rehash(&self, vm: &Vm, buckets: u32) -> Result<(), AllocError> {
        let table = self.table();
        let successor = table.try_rehash(vm, buckets)?;
        if table.is_empty() {
            table.retire_cleared();
        } else {
            table.retire_for(successor);
        }
        self.set_table(successor);
        Ok(())
    }

    /// Whether another entry takes a new table.
    #[inline(always)]
    pub fn is_full(&self) -> bool {
        self.table().is_full()
    }

    /// Makes room for that many more entries, if there is memory.
    pub fn reserve(&self, vm: &Vm, additional: usize) {
        let table = self.table();
        if additional > (table.capacity() - table.used()) as usize {
            let wanted = additional.saturating_add(table.len() as usize);
            let _ = OrderedTable::<K>::buckets_for(wanted).and_then(|it| self.rehash(vm, it));
        }
    }

    #[inline(always)]
    pub fn remove(&self, cx: &Cx, key: Value) -> JsResult<bool> {
        let key = self.hash_for_lookup(cx, key)?;
        Ok(key.is_some_and(|key| self.remove_hashed(cx, key)))
    }

    #[inline(always)]
    pub fn remove_hashed(&self, vm: &Vm, key: HashedKey) -> bool {
        let table = self.table();
        if !table.remove(key) {
            return false;
        }
        if table.bucket_count() > Self::BUCKETS_KEPT_BY_REMOVE && table.len() < table.capacity() / 8
        {
            self.shrink(vm);
        }
        true
    }

    /// Does nothing if there is no memory.
    #[inline(never)]
    fn shrink(&self, vm: &Vm) {
        let wanted = self.size() as usize * 2;
        let _ = OrderedTable::<K>::buckets_for(wanted)
            .and_then(|it| self.rehash(vm, it.max(Self::BUCKETS_KEPT_BY_REMOVE)));
    }

    /// For a collection that got fewer entries than `reserve` has made room for.
    pub fn shrink_if_sparse(&self, vm: &Vm) {
        let table = self.table();
        if table.bucket_count() > Self::BUCKETS_KEPT_BY_REMOVE && table.len() < table.capacity() / 4
        {
            let _ = OrderedTable::<K>::buckets_for(table.len() as usize)
                .and_then(|it| self.rehash(vm, it));
        }
    }

    pub fn clear(&self, vm: &Vm) {
        let table = self.table();
        if table.may_have_cursors() || table.bucket_count() > Self::BUCKETS_KEPT_BY_CLEAR {
            table.retire_cleared();
            self.set_table(K::empty_table(vm));
        } else if table.used() != 0 {
            table.clear_in_place();
        }
    }

    /// Before the first entry.
    #[inline(always)]
    pub fn cursor(&self) -> OrderedCursor<K> {
        let table = self.table();
        if table.is_shared() {
            return OrderedCursor::at(self.as_cell().into(), 0);
        }
        table.will_have_cursor();
        OrderedCursor::at(table.cell(), 0)
    }

    #[inline(always)]
    pub fn items<'a>(&'a self, _: &'a NoGc<'_>) -> impl Iterator<Item = K::Item> + 'a {
        // SAFETY: nothing can change the collection meanwhile.
        unsafe { self.items_unchecked() }
    }

    /// # Safety
    /// The collection is not changed while the iterator is in use.
    #[inline(always)]
    #[cfg_attr(rootcheck, rootcheck::stays("points into the table"))]
    pub(super) unsafe fn items_unchecked(&self) -> impl Iterator<Item = K::Item> + Clone + '_ {
        // SAFETY: the iterator points into the table, which keeps the collection alive.
        let table = unsafe { &*self.table().as_ptr() };
        table.entries().iter().filter_map(|entry| entry.item())
    }
}

/// A position in a collection that may change between two steps. An entry that is added is met later, and one that is
/// removed is not.
pub struct OrderedCursor<K: TableKind> {
    /// A table, or the collection if the position is before the first entry of whichever table it has. To a look at
    /// `OrderedTable::IS_CURRENT`, a collection is like a retired table.
    place: Gc<JsCell>,
    number: u32,
    kind: PhantomData<K>,
}

pub type MapCursor = OrderedCursor<MapKind>;
pub type SetCursor = OrderedCursor<SetKind>;

const _: () = assert!(
    OrderedCollection::<MapKind>::OFFSET_OF_TABLE == OrderedTable::<MapKind>::OFFSET_OF_FORWARD
);

impl<K: TableKind> Clone for OrderedCursor<K> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}

impl<K: TableKind> Copy for OrderedCursor<K> {}

impl<K: TableKind> OrderedCursor<K> {
    #[inline(always)]
    fn at(place: Gc<JsCell>, number: u32) -> Self {
        OrderedCursor {
            place,
            number,
            kind: PhantomData,
        }
    }

    /// Never yields anything.
    #[inline(always)]
    pub fn finished(vm: &Vm) -> Self {
        Self::at(K::empty_table(vm).cell(), 0)
    }

    #[inline(always)]
    pub fn parts(self) -> (Gc<JsCell>, u32) {
        (self.place, self.number)
    }

    /// Panics unless `place` is what `parts` gives for some cursor of this kind.
    #[inline(always)]
    pub fn from_parts(place: Gc<JsCell>, number: u32) -> Self {
        assert!(place.is::<OrderedTable<K>>() || place.is::<OrderedCollection<K>>());
        Self::at(place, number)
    }

    /// # Safety
    /// As for `from_parts`.
    #[inline(always)]
    pub unsafe fn from_parts_unchecked(place: Gc<JsCell>, number: u32) -> Self {
        Self::at(place, number)
    }

    /// `None` for one that `finished` has made.
    pub fn collection(self) -> Option<Gc<OrderedCollection<K>>> {
        let mut place = self.place;
        while let Some(table) = place.downcast::<OrderedTable<K>>() {
            place = table.collection_or_successor()?;
        }
        Some(place.cast())
    }

    #[inline(always)]
    pub(crate) fn is_at_current_table(&self) -> bool {
        let address = self.place.address() + OrderedTable::<K>::OFFSET_OF_FORWARD;
        // SAFETY: a field of either kind of place, which only this thread writes.
        let word = unsafe { *core::ptr::with_exposed_provenance::<usize>(address) };
        word & OrderedTable::<K>::IS_CURRENT != 0
    }

    /// `None` if the collection has none of its own.
    #[inline(always)]
    fn current_table(&mut self) -> Option<Gc<OrderedTable<K>>> {
        if !self.is_at_current_table() {
            *self = self.caught_up();
            if !self.is_at_current_table() {
                return None;
            }
        }
        // SAFETY: the address of a table, which is what a collection has there, does not have the bit.
        Some(unsafe { self.place.cast_unchecked() })
    }

    #[cold]
    #[inline(never)]
    fn caught_up(mut self) -> Self {
        while let Some(table) = self.place.downcast::<OrderedTable<K>>() {
            if table.is_current() {
                return self;
            }
            self.place = table.collection_or_successor().expect("retired");
            if !self.place.is_object() {
                self.number = table.number_in_successor(self.number);
            }
        }
        self.place.cast::<OrderedCollection<K>>().cursor()
    }

    #[inline(always)]
    fn step<R>(&mut self, read: impl Fn(&Entry<K>) -> Option<R>) -> Option<R> {
        let table = self.current_table()?;
        self.step_in(table, read)
    }

    /// # Safety
    /// `is_at_current_table` holds.
    #[inline(always)]
    pub(crate) unsafe fn next_in_current_table(&mut self) -> Option<K::Item> {
        // SAFETY: the caller's, and as in `current_table`.
        self.step_in(unsafe { self.place.cast_unchecked() }, |entry| entry.item())
    }

    #[inline(always)]
    fn step_in<R>(
        &mut self,
        table: Gc<OrderedTable<K>>,
        read: impl Fn(&Entry<K>) -> Option<R>,
    ) -> Option<R> {
        loop {
            let found = read(table.entry(self.number)?);
            self.number += 1;
            if found.is_some() {
                return found;
            }
            self.number = self.number.max(table.first_live());
        }
    }

    /// With the hash, which spares computing it for a lookup elsewhere.
    #[inline(always)]
    pub fn next_key(&mut self) -> Option<HashedKey> {
        self.step(|entry| entry.key())
    }

    /// How many entries are left at most.
    pub fn remaining(mut self) -> u32 {
        self.current_table().map_or(0, |table| {
            (table.used().saturating_sub(self.number)).min(table.len())
        })
    }

    /// For loops that are written in JavaScript: the table that has the next entry, which it remembers.
    #[inline]
    pub fn advance_for_builtin(mut self) -> Option<Gc<OrderedTable<K>>> {
        self.next()?;
        let table = self.current_table()?;
        table.set_builtin_position(self.number - 1);
        Some(table)
    }
}

impl<K: TableKind> Iterator for OrderedCursor<K> {
    type Item = K::Item;

    #[inline(always)]
    fn next(&mut self) -> Option<K::Item> {
        self.step(|entry| entry.item())
    }
}
