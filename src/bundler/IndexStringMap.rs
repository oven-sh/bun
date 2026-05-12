use bun_collections::ArrayHashMap;
use bun_collections::VecExt;

/// `Index.Int` in Zig — the underlying integer repr.
pub(crate) use crate::IndexInt;
use bun_ast::Index;

#[derive(Default)]
pub struct IndexStringMap {
    map: ArrayHashMap<IndexInt, Box<[u8]>>,
}

// PORT NOTE: `deinit` only freed owned values + the map; with `Box<[u8]>` values and
// `ArrayHashMap`'s own Drop, no explicit `impl Drop` is needed.

impl IndexStringMap {
    pub fn get(&self, index: IndexInt) -> Option<&[u8]> {
        self.map.get(&index).map(|v| v.as_ref())
    }

    pub fn put(
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

// ported from: src/bundler/IndexStringMap.zig
