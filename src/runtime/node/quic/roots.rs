//! How an endpoint, its sessions and their streams reach each other: what names an object roots it.

use core::cell::Cell;

use bun_jsc::bindgen::{JsPayload, LentWrapper, StrongWrapper};

use crate::test_runner::cells::CellExt as _;

pub(super) struct RootSlot<T>(Cell<Option<StrongWrapper<T>>>);

impl<T: JsPayload> RootSlot<T> {
    pub(super) fn new(root: Option<StrongWrapper<T>>) -> Self {
        Self(Cell::new(root))
    }

    pub(super) fn set(&self, root: StrongWrapper<T>) {
        self.0.set(Some(root));
    }

    pub(super) fn take(&self) -> Option<StrongWrapper<T>> {
        self.0.take()
    }

    pub(super) fn with<R>(&self, f: impl FnOnce(LentWrapper<'_, T>) -> R) -> Option<R> {
        StrongWrapper::lend_from(&self.0, Option::as_ref, f)
    }
}

/// Keys are never reused, so unlike a pointer, a stale key can't match a newer entry.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Key(u64);

pub(super) trait Root {
    type Payload: JsPayload;
    fn wrapper(&self) -> &StrongWrapper<Self::Payload>;
}

impl<T: JsPayload> Root for StrongWrapper<T> {
    type Payload = T;
    fn wrapper(&self) -> &Self {
        self
    }
}

pub(super) struct Table<E> {
    /// Sorted by key.
    entries: Cell<Vec<(Key, E)>>,
    next_key: Cell<u64>,
}

fn position<E>(entries: &[(Key, E)], key: Key) -> Result<usize, usize> {
    entries.binary_search_by_key(&key, |entry| entry.0)
}

impl<E: Root> Table<E> {
    pub(super) const fn new() -> Self {
        Self {
            entries: Cell::new(Vec::new()),
            next_key: Cell::new(0),
        }
    }

    pub(super) fn new_key(&self) -> Key {
        Key(self.next_key.replace(self.next_key.get() + 1))
    }

    pub(super) fn insert(&self, key: Key, entry: E) {
        self.entries.with_taken(|entries| {
            let (Ok(at) | Err(at)) = position(entries, key);
            entries.insert(at, (key, entry));
        });
    }

    pub(super) fn remove(&self, key: Key) -> Option<E> {
        self.entries
            .with_taken(|entries| Some(entries.remove(position(entries, key).ok()?).1))
    }

    pub(super) fn take_all(&self) -> impl Iterator<Item = E> {
        self.entries.take().into_iter().map(|entry| entry.1)
    }

    pub(super) fn len(&self) -> usize {
        self.entries.with_taken(|entries| entries.len())
    }

    pub(super) fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The table is empty while `f` runs.
    pub(super) fn with_entry<R>(&self, key: Key, f: impl FnOnce(&E) -> R) -> Option<R> {
        self.entries
            .with_taken(|entries| Some(f(&entries[position(entries, key).ok()?].1)))
    }

    /// The table is empty while `f` runs.
    pub(super) fn find_map<R>(
        &self,
        mut f: impl FnMut(Key, &E::Payload) -> Option<R>,
    ) -> Option<R> {
        self.entries.with_taken(|entries| {
            entries
                .iter()
                .find_map(|(key, entry)| entry.wrapper().lend(|lent| f(*key, &lent))?)
        })
    }

    /// The table is empty while `f` runs.
    pub(super) fn any(&self, mut f: impl FnMut(&E::Payload) -> bool) -> bool {
        self.find_map(|_, payload| f(payload).then_some(()))
            .is_some()
    }

    /// `f` can change the table.
    pub(super) fn with<R>(
        &self,
        key: Key,
        f: impl FnOnce(LentWrapper<'_, E::Payload>) -> R,
    ) -> Option<R> {
        StrongWrapper::lend_from(
            &self.entries,
            |entries| Some(entries[position(entries, key).ok()?].1.wrapper()),
            f,
        )
    }

    /// Visits what is in the table now and still is when its turn comes. `f` can change the table.
    pub(super) fn for_each(&self, mut f: impl FnMut(LentWrapper<'_, E::Payload>)) {
        let end = Key(self.next_key.get());
        let mut from = Key(0);
        while StrongWrapper::lend_from(
            &self.entries,
            |entries| {
                let (Ok(at) | Err(at)) = position(entries, from);
                let (key, entry) = entries.get(at).filter(|entry| entry.0 < end)?;
                from = Key(key.0 + 1);
                Some(entry.wrapper())
            },
            &mut f,
        )
        .is_some()
        {}
    }
}
