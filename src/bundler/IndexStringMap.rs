use bun_collections::ArrayHashMap;

pub use bun_js_parser::Index;
/// `Index.Int` in Zig — the underlying integer repr.
pub type IndexInt = u32;

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

    pub fn put(&mut self, index: IndexInt, value: impl AsRef<[u8]>) -> Result<(), bun_alloc::AllocError> {
        let duped = Box::<[u8]>::from(value.as_ref());
        // errdefer allocator.free(duped) — deleted: `duped` is Drop, `?` handles cleanup.
        self.map.insert(index, duped);
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/IndexStringMap.zig (25 lines)
//   confidence: high
//   todos:      0
//   notes:      allocator params dropped (values retyped to Box<[u8]>); Index::Int path may need fixup
// ──────────────────────────────────────────────────────────────────────────
