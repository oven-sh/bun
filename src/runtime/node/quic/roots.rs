//! The GC roots through which an endpoint, its sessions and their streams reach each other.

use core::borrow::Borrow;
use core::cell::Cell;
use core::marker::PhantomData;

use bun_jsc::bindgen::{BorrowedWrapper, JsPayload, StrongWrapper};
use bun_ptr::{CellExt as _, OptionCellExt as _, VecCellExt as _};

/// An optional `StrongWrapper` that is set and taken through `&self`.
pub(super) struct StrongWrapperCell<T>(Cell<Option<StrongWrapper<T>>>);

impl<T: JsPayload> StrongWrapperCell<T> {
    pub(super) fn new(value: Option<StrongWrapper<T>>) -> Self {
        Self(Cell::new(value))
    }

    pub(super) fn set(&self, value: StrongWrapper<T>) {
        self.0.set(Some(value));
    }

    pub(super) fn take(&self) -> Option<StrongWrapper<T>> {
        self.0.take()
    }

    pub(super) fn is_none(&self) -> bool {
        !self.0.is_some()
    }

    /// `f` can change the cell.
    pub(super) fn with<R>(&self, f: impl FnOnce(BorrowedWrapper<'_, T>) -> R) -> Option<R> {
        StrongWrapper::try_with_cell(&self.0, Option::as_ref, f)
    }
}

/// Keys are never reused, so unlike a pointer, a stale key can't match a newer entry.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Key(u64);

pub(super) struct StrongWrapperMap<T, V = StrongWrapper<T>> {
    /// Sorted by key.
    entries: Cell<Vec<(Key, V)>>,
    next_key: Cell<u64>,
    _payload: PhantomData<T>,
}

fn binary_search<V>(entries: &[(Key, V)], key: Key) -> Result<usize, usize> {
    entries.binary_search_by_key(&key, |entry| entry.0)
}

impl<T, V> Default for StrongWrapperMap<T, V> {
    fn default() -> Self {
        Self {
            entries: Cell::default(),
            next_key: Cell::default(),
            _payload: PhantomData,
        }
    }
}

impl<T: JsPayload, V: Borrow<StrongWrapper<T>>> StrongWrapperMap<T, V> {
    pub(super) fn next_key(&self) -> Key {
        Key(self.next_key.replace(self.next_key.get() + 1))
    }

    pub(super) fn insert(&self, key: Key, value: V) {
        self.entries.with_taken(|entries| {
            let (Ok(index) | Err(index)) = binary_search(entries, key);
            entries.insert(index, (key, value));
        });
    }

    pub(super) fn remove(&self, key: Key) -> Option<V> {
        self.entries
            .with_taken(|entries| Some(entries.remove(binary_search(entries, key).ok()?).1))
    }

    pub(super) fn drain(&self) -> impl Iterator<Item = V> {
        self.entries.take().into_iter().map(|entry| entry.1)
    }

    pub(super) fn len(&self) -> usize {
        self.entries.len()
    }

    pub(super) fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The map is empty while `f` runs.
    pub(super) fn with_taken<R>(&self, key: Key, f: impl FnOnce(&V) -> R) -> Option<R> {
        self.entries
            .with_taken(|entries| Some(f(&entries[binary_search(entries, key).ok()?].1)))
    }

    /// The map is empty while `f` runs.
    pub(super) fn find_map<R>(&self, mut f: impl FnMut(Key, &T) -> Option<R>) -> Option<R> {
        let entries = self.entries.take();
        let found = entries
            .iter()
            .find_map(|(key, value)| value.borrow().try_with(|wrapper| f(*key, &wrapper))?);
        debug_assert!(self.is_empty());
        self.entries.put_back(entries);
        found
    }

    /// The map is empty while `f` runs.
    pub(super) fn for_each_taken(&self, mut f: impl FnMut(&T)) {
        self.any(|payload| {
            f(payload);
            false
        });
    }

    /// The map is empty while `f` runs.
    pub(super) fn any(&self, mut f: impl FnMut(&T) -> bool) -> bool {
        self.find_map(|_, payload| f(payload).then_some(()))
            .is_some()
    }

    /// `f` can change the map.
    pub(super) fn with<R>(
        &self,
        key: Key,
        f: impl FnOnce(BorrowedWrapper<'_, T>) -> R,
    ) -> Option<R> {
        StrongWrapper::try_with_cell(
            &self.entries,
            |entries| Some(entries[binary_search(entries, key).ok()?].1.borrow()),
            f,
        )
    }

    /// `f` can change the map. Skips what it removes, and keys that `next_key` returns from now on.
    pub(super) fn for_each(&self, mut f: impl FnMut(BorrowedWrapper<'_, T>)) {
        let end = Key(self.next_key.get());
        let mut start = Key(0);
        while StrongWrapper::try_with_cell(
            &self.entries,
            |entries| {
                let (Ok(index) | Err(index)) = binary_search(entries, start);
                let (key, value) = entries.get(index).filter(|entry| entry.0 < end)?;
                start = Key(key.0 + 1);
                Some(value.borrow())
            },
            &mut f,
        )
        .is_some()
        {}
    }
}
