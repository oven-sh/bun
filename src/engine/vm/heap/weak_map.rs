use core::cell::RefCell;
use core::hash::Hash;
use core::marker::PhantomData;

use bun_alloc::AllocError;
use hashbrown::HashTable;

use super::{Gc, GcFree, PlainKey, Scope, Survivors};
use crate::{CellKind, FastHashMap, Vm};

/// A map whose entries go when their values die. Only the `Vm` has them, and it prunes them after each collection.
pub(crate) struct WeakValueMap<K, T> {
    map: RefCell<FastHashMap<K, usize>>,
    added_since_collection: RefCell<Vec<K>>,
    value: PhantomData<*const T>,
}

// SAFETY: pruned after each collection.
unsafe impl<K: GcFree, T> GcFree for WeakValueMap<K, T> {}

impl<K, T> Default for WeakValueMap<K, T> {
    fn default() -> Self {
        WeakValueMap {
            map: RefCell::default(),
            added_since_collection: RefCell::default(),
            value: PhantomData,
        }
    }
}

impl<K: PlainKey, T: CellKind> WeakValueMap<K, T> {
    #[inline]
    pub(crate) fn get<Q>(&self, _: &Vm, key: &Q) -> Option<Gc<T>>
    where
        Q: Hash + hashbrown::Equivalent<K> + ?Sized,
    {
        let address = *self.map.borrow().get(key)?;
        // SAFETY: pruned before it is freed.
        Some(unsafe { Gc::from_address(address) })
    }

    pub(crate) fn insert(&self, key: K, value: Gc<T>) {
        self.added_since_collection.borrow_mut().push(key.clone());
        self.map.borrow_mut().insert(key, value.address());
    }

    pub(crate) fn try_insert(&self, key: K, value: Gc<T>) -> Result<(), AllocError> {
        let has_room = self
            .added_since_collection
            .borrow_mut()
            .try_reserve(1)
            .is_ok()
            && self.map.borrow_mut().try_reserve(1).is_ok();
        has_room.then(|| self.insert(key, value)).ok_or(AllocError)
    }

    /// `visit` does not allocate.
    pub(crate) fn for_each_value(&self, _: &Vm, mut visit: impl FnMut(Gc<T>)) {
        for &address in self.map.borrow().values() {
            // SAFETY: as in `get`.
            visit(unsafe { Gc::from_address(address) });
        }
    }

    pub(crate) fn clear(&self) {
        self.map.take();
        self.added_since_collection.take();
    }

    pub(crate) fn prune(&self, survivors: &Survivors) {
        // SAFETY: only the address is looked at.
        let is_live = |address| survivors.contains(unsafe { Gc::<T>::from_address(address) });
        let (mut map, added) = (self.map.borrow_mut(), self.added_since_collection.take());
        if survivors.scope() == Scope::Full || added.len() * 4 > map.len() {
            map.retain(|_, &mut address| is_live(address));
            if map.len() * 8 < map.capacity() {
                map.shrink_to_fit();
            }
            return;
        }
        for key in added {
            if map.get(&key).is_some_and(|&address| !is_live(address)) {
                map.remove(&key);
            }
        }
    }
}

/// The same for cells that have their keys.
pub(crate) struct WeakCellSet<T> {
    table: RefCell<HashTable<usize>>,
    added_since_collection: RefCell<Vec<usize>>,
    hash: fn(&T) -> u64,
}

// SAFETY: as above.
unsafe impl<T> GcFree for WeakCellSet<T> {}

impl<T: CellKind> WeakCellSet<T> {
    /// `hash` looks at nothing but the cell, which may have just died.
    pub(crate) fn new(hash: fn(&T) -> u64) -> Self {
        WeakCellSet {
            table: RefCell::default(),
            added_since_collection: RefCell::default(),
            hash,
        }
    }

    fn cell(address: usize) -> Gc<T> {
        // SAFETY: pruned before it is destroyed.
        unsafe { Gc::from_address(address) }
    }

    #[inline]
    pub(crate) fn find(&self, _: &Vm, hash: u64, matches: impl Fn(&T) -> bool) -> Option<Gc<T>> {
        let table = self.table.borrow();
        let found = table.find(hash, |&address| matches(&Self::cell(address)));
        found.map(|&address| Self::cell(address))
    }

    /// `find` has found nothing.
    pub(crate) fn insert(&self, cell: Gc<T>) {
        let hash = |&address: &usize| (self.hash)(&Self::cell(address));
        let address = cell.address();
        self.added_since_collection.borrow_mut().push(address);
        (self.table.borrow_mut()).insert_unique(hash(&address), address, hash);
    }

    pub(crate) fn prune(&self, survivors: &Survivors) {
        let (mut table, added) = (self.table.borrow_mut(), self.added_since_collection.take());
        if survivors.scope() == Scope::Full || added.len() * 4 > table.len() {
            return table.retain(|&mut address| survivors.contains_address(address));
        }
        for dead in added
            .into_iter()
            .filter(|&it| !survivors.contains_address(it))
        {
            let entry = table.find_entry((self.hash)(&Self::cell(dead)), |&it| it == dead);
            entry.expect("added").remove();
        }
    }
}
