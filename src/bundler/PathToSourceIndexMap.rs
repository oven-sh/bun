use bun_collections::StringHashMap;

use crate::IndexStringMap::IndexInt;

/// Abstracts over the two structurally-identical `Path` ports (`bun_paths::fs::Path`
/// and `bun_resolver::fs::Path`) so the bundler can key the map with either while
/// the crates converge. Both expose `.text: &[u8]`, which is all we need.
pub trait PathLike {
    fn path_text(&self) -> &[u8];
}

impl PathLike for bun_paths::fs::Path<'_> {
    #[inline]
    fn path_text(&self) -> &[u8] {
        self.text
    }
}

impl PathLike for bun_resolver::fs::Path<'_> {
    #[inline]
    fn path_text(&self) -> &[u8] {
        self.text
    }
}

/// The lifetime of the keys are not owned by this map.
///
/// We assume it's arena allocated.
#[derive(Default)]
pub struct PathToSourceIndexMap {
    pub map: Map,
}

pub type Map = StringHashMap<IndexInt>;

/// Mirrors Zig's `Map.GetOrPutResult` — std `HashMap::entry` doesn't expose
/// `found_existing` + value-ptr together, so we hand-roll a thin shim.
pub struct GetOrPutResult<'a> {
    pub value_ptr: &'a mut IndexInt,
    pub found_existing: bool,
}

impl PathToSourceIndexMap {
    pub fn get_path(&self, path: &impl PathLike) -> Option<IndexInt> {
        self.get(path.path_text())
    }

    pub fn get(&self, text: impl AsRef<[u8]>) -> Option<IndexInt> {
        self.map.get(text.as_ref()).copied()
    }

    pub fn put_path(&mut self, path: &impl PathLike, value: IndexInt) -> Result<(), bun_alloc::AllocError> {
        self.put(path.path_text(), value)
    }

    pub fn put(&mut self, text: impl AsRef<[u8]>, value: IndexInt) -> Result<(), bun_alloc::AllocError> {
        // PERF(port): Zig used StringHashMapUnmanaged with arena-borrowed keys (no copy);
        // bun_collections::StringHashMap is keyed by `Box<[u8]>`, so we dupe here.
        // Revisit once StringHashMap gains a borrowed-key variant.
        self.map.insert(Box::<[u8]>::from(text.as_ref()), value);
        Ok(())
    }

    pub fn get_or_put_path(&mut self, path: &impl PathLike) -> Result<GetOrPutResult<'_>, bun_alloc::AllocError> {
        self.get_or_put(path.path_text())
    }

    pub fn get_or_put(&mut self, text: impl AsRef<[u8]>) -> Result<GetOrPutResult<'_>, bun_alloc::AllocError> {
        // `Map` derefs to `std::collections::HashMap`, so this is std's Entry —
        // not `bun_collections::hash_map::Entry` (which is `ArrayHashMap`'s).
        use std::collections::hash_map::Entry;
        // PERF(port): see note in `put` re: key duplication.
        match self.map.entry(Box::<[u8]>::from(text.as_ref())) {
            Entry::Occupied(e) => Ok(GetOrPutResult { value_ptr: e.into_mut(), found_existing: true }),
            Entry::Vacant(e) => Ok(GetOrPutResult { value_ptr: e.insert(0), found_existing: false }),
        }
    }

    pub fn remove(&mut self, text: impl AsRef<[u8]>) -> bool {
        self.map.remove(text.as_ref()).is_some()
    }

    pub fn remove_path(&mut self, path: &impl PathLike) -> bool {
        self.remove(path.path_text())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/PathToSourceIndexMap.zig (46 lines)
//   confidence: medium
//   todos:      1
//   notes:      dropped allocator params (StringHashMapUnmanaged→StringHashMap); keys are arena-borrowed bytes per Zig doc comment; GetOrPutResult API needs bun_collections support
// ──────────────────────────────────────────────────────────────────────────
