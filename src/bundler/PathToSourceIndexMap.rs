use bun_collections::StringHashMap;

use crate::IndexStringMap::IndexInt;

/// The lifetime of the keys are not owned by this map.
///
/// We assume it's arena allocated.
#[derive(Default)]
pub struct PathToSourceIndexMap {
    pub map: Map,
}

pub type Map = StringHashMap<IndexInt>;

/// std `HashMap::entry` doesn't expose
/// `found_existing` + value-ptr together, so we hand-roll a thin shim.
pub(crate) type GetOrPutResult<'a> = bun_collections::string_hash_map::GetOrPutResult<'a, IndexInt>;

impl PathToSourceIndexMap {
    pub fn get_path(&self, path: &bun_paths::fs::Path<'_>) -> Option<IndexInt> {
        self.get(path.text)
    }

    pub fn get(&self, text: impl AsRef<[u8]>) -> Option<IndexInt> {
        self.map.get(text.as_ref()).copied()
    }

    pub fn put_path(
        &mut self,
        path: &bun_paths::fs::Path<'_>,
        value: IndexInt,
    ) -> Result<(), bun_alloc::AllocError> {
        self.put(path.text, value)
    }

    // Takes `&[u8]` (not `impl AsRef<[u8]>`)
    // to avoid E0283 inference ambiguity at `.into()` call sites in bundle_v2.
    pub fn put(&mut self, text: &[u8], value: IndexInt) -> Result<(), bun_alloc::AllocError> {
        // PERF: bun_collections::StringHashMap is keyed by `Box<[u8]>`, so we dupe here.
        // Revisit once StringHashMap gains a borrowed-key variant.
        self.map.put(text, value)
    }

    pub fn get_or_put_path(
        &mut self,
        path: &bun_paths::fs::Path<'_>,
    ) -> Result<GetOrPutResult<'_>, bun_alloc::AllocError> {
        self.get_or_put(path.text)
    }

    pub fn get_or_put(
        &mut self,
        text: impl AsRef<[u8]>,
    ) -> Result<GetOrPutResult<'_>, bun_alloc::AllocError> {
        // PERF: see note in `put` re: key duplication.
        self.map.get_or_put(text.as_ref())
    }

    pub fn remove(&mut self, text: impl AsRef<[u8]>) -> bool {
        self.map.remove(text.as_ref()).is_some()
    }

    pub fn remove_path(&mut self, path: &bun_paths::fs::Path<'_>) -> bool {
        self.remove(path.text)
    }
}
