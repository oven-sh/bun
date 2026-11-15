use core::marker::PhantomData;

use bun_collections::smallvec::SmallVec;
use bun_core::GenericIndex;

// The user-facing stdio type from `crate::api::bun_spawn::stdio`, NOT the
// low-level `PosixStdio`/`WindowsStdio` spawn-option shape that the
// `bun_spawn` *crate* re-exports under the same name.
pub(crate) use crate::api::bun_spawn::stdio::Stdio;

/// Values addressed by `GenericIndex`. An index is not reused after `remove`.
pub(crate) struct Slots<T, M>(SmallVec<[Option<T>; 2]>, PhantomData<M>);

impl<T, M> Slots<T, M> {
    pub(crate) fn new() -> Self {
        Slots(SmallVec::new(), PhantomData)
    }

    pub(crate) fn insert(&mut self, value: T) -> GenericIndex<u32, M> {
        self.insert_with(|_| value)
    }

    pub(crate) fn insert_with(
        &mut self,
        f: impl FnOnce(GenericIndex<u32, M>) -> T,
    ) -> GenericIndex<u32, M> {
        let id = GenericIndex::init(u32::try_from(self.0.len()).expect("int cast"));
        self.0.push(Some(f(id)));
        id
    }

    pub(crate) fn get(&self, id: GenericIndex<u32, M>) -> Option<&T> {
        self.0[id.get_usize()].as_ref()
    }

    pub(crate) fn get_mut(&mut self, id: GenericIndex<u32, M>) -> Option<&mut T> {
        self.0[id.get_usize()].as_mut()
    }

    pub(crate) fn remove(&mut self, id: GenericIndex<u32, M>) {
        let removed = self.0[id.get_usize()].take();
        debug_assert!(removed.is_some(), "slot {} removed twice", id);
    }

    pub(crate) fn count(&self) -> usize {
        self.0.iter().flatten().count()
    }
}

impl<T, M> core::ops::Index<GenericIndex<u32, M>> for Slots<T, M> {
    type Output = T;
    #[track_caller]
    fn index(&self, id: GenericIndex<u32, M>) -> &T {
        self.get(id).expect("slot was removed")
    }
}

impl<T, M> core::ops::IndexMut<GenericIndex<u32, M>> for Slots<T, M> {
    #[track_caller]
    fn index_mut(&mut self, id: GenericIndex<u32, M>) -> &mut T {
        self.get_mut(id).expect("slot was removed")
    }
}
