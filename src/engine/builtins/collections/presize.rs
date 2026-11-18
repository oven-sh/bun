use bun_engine_vm::{JsArray, OrderedCollection, TableKind};

use crate::prelude::*;

/// Grows a collection that is filled from an array to the size that the share of distinct keys so far suggests.
pub(super) struct Presizer {
    expected: u32,
    seen: u32,
}

impl Presizer {
    pub(super) fn new(iterable: Value) -> Presizer {
        Presizer {
            expected: iterable.downcast::<JsArray>().map_or(0, |it| it.length()),
            seen: 0,
        }
    }

    #[inline(always)]
    pub(super) fn will_add<K: TableKind>(&mut self, cx: &Cx, collection: &OrderedCollection<K>) {
        if collection.is_full() && self.seen < self.expected {
            self.reserve(cx, collection);
        }
        self.seen = self.seen.saturating_add(1);
    }

    #[inline(never)]
    fn reserve<K: TableKind>(&self, cx: &Cx, collection: &OrderedCollection<K>) {
        const FIRST_LIMIT: u64 = 1024;
        const GROWTH_LIMIT: u64 = 16;
        let size = u64::from(collection.size());
        let guess = (size + 1) * u64::from(self.expected) / (u64::from(self.seen) + 1);
        let limit = (size * GROWTH_LIMIT).max(FIRST_LIMIT);
        let left = u64::from(self.expected - self.seen);
        let additional = (guess.min(limit) - size).max(size / 2).min(left);
        collection.reserve(cx, additional as usize);
    }
}
