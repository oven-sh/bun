use bun_collections::StringHashMap;
use bun_paths::fs::Path;

use crate::IndexStringMap::IndexInt;

/// Pretty-path prefix of the empty module of a disabled file, as in esbuild.
pub(crate) const DISABLED_PRETTY_PREFIX: &[u8] = b"(disabled):";

/// The lifetime of the keys are not owned by this map.
///
/// We assume it's arena allocated.
#[derive(Default)]
pub struct PathMap<V> {
    pub(crate) map: StringHashMap<V>,
    /// A disabled file and its empty module are two modules with one `text`.
    disabled_modules: StringHashMap<V>,
}

pub type PathToSourceIndexMap = PathMap<IndexInt>;

pub type Map = StringHashMap<IndexInt>;

/// std `HashMap::entry` doesn't expose
/// `found_existing` + value-ptr together, so we hand-roll a thin shim.
pub(crate) type GetOrPutResult<'a, V = IndexInt> =
    bun_collections::string_hash_map::GetOrPutResult<'a, V>;

impl<V: Copy + Default> PathMap<V> {
    fn map_for(&self, path: &Path<'_>) -> &StringHashMap<V> {
        if path.is_disabled_module {
            &self.disabled_modules
        } else {
            &self.map
        }
    }

    fn map_for_mut(&mut self, path: &Path<'_>) -> &mut StringHashMap<V> {
        if path.is_disabled_module {
            &mut self.disabled_modules
        } else {
            &mut self.map
        }
    }

    pub(crate) fn get_path(&self, path: &Path<'_>) -> Option<V> {
        self.map_for(path).get(path.text).copied()
    }

    pub(crate) fn put_path(
        &mut self,
        path: &Path<'_>,
        value: V,
    ) -> Result<(), bun_alloc::AllocError> {
        self.map_for_mut(path).put(path.text, value)
    }

    pub(crate) fn get_or_put_path(
        &mut self,
        path: &Path<'_>,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError> {
        self.map_for_mut(path).get_or_put(path.text)
    }

    pub(crate) fn get(&self, text: impl AsRef<[u8]>) -> Option<V> {
        self.map.get(text.as_ref()).copied()
    }

    // Takes `&[u8]` (not `impl AsRef<[u8]>`)
    // to avoid E0283 inference ambiguity at `.into()` call sites in bundle_v2.
    pub(crate) fn put(&mut self, text: &[u8], value: V) -> Result<(), bun_alloc::AllocError> {
        // PERF: bun_collections::StringHashMap is keyed by `Box<[u8]>`, so we dupe here.
        // Revisit once StringHashMap gains a borrowed-key variant.
        self.map.put(text, value)
    }

    pub(crate) fn get_or_put(
        &mut self,
        text: impl AsRef<[u8]>,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError> {
        // PERF: see note in `put` re: key duplication.
        self.map.get_or_put(text.as_ref())
    }

    pub fn remove(&mut self, text: impl AsRef<[u8]>) -> bool {
        self.map.remove(text.as_ref()).is_some()
    }

    pub(crate) fn values(&self) -> impl Iterator<Item = &V> {
        self.map.values().chain(self.disabled_modules.values())
    }

    pub(crate) fn reserve(&mut self, additional: usize) {
        self.map.reserve(additional);
    }

    pub(crate) fn clear(&mut self) {
        self.map.clear();
        self.disabled_modules.clear();
    }
}
