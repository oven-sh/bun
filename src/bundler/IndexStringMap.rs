use bun_collections::ArrayHashMap;

/// The underlying integer repr of `Index`.
pub(crate) use crate::IndexInt;

#[derive(Default)]
pub struct IndexStringMap {
    map: ArrayHashMap<IndexInt, Box<[u8]>>,
}

impl IndexStringMap {
    pub(crate) fn get(&self, index: IndexInt) -> Option<&[u8]> {
        self.map.get(&index).map(|v| v.as_ref())
    }

    pub(crate) fn put(
        &mut self,
        index: IndexInt,
        value: impl AsRef<[u8]>,
    ) -> Result<(), bun_alloc::AllocError> {
        let duped = Box::<[u8]>::from(value.as_ref());
        // errdefer arena.free(duped) — deleted: `duped` is Drop, `?` handles cleanup.
        self.map.insert(index, duped);
        Ok(())
    }
}
