use bun_collections::ArrayHashMap;

pub use bun_js_parser::Index;

#[derive(Default)]
pub struct IndexStringMap {
    map: ArrayHashMap<Index::Int, Box<[u8]>>,
}

// PORT NOTE: `deinit` only freed owned values + the map; with `Box<[u8]>` values and
// `ArrayHashMap`'s own Drop, no explicit `impl Drop` is needed.

impl IndexStringMap {
    pub fn get(&self, index: Index::Int) -> Option<&[u8]> {
        self.map.get(&index).map(|v| v.as_ref())
    }

    pub fn put(&mut self, index: Index::Int, value: &[u8]) -> Result<(), bun_alloc::AllocError> {
        let duped = Box::<[u8]>::from(value);
        // errdefer allocator.free(duped) — deleted: `duped` is Drop, `?` handles cleanup.
        self.map.put(index, duped)?;
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
