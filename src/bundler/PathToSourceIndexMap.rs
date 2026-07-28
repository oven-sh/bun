use bun_collections::StringHashMap;

use crate::IndexStringMap::IndexInt;

/// Abstracts over the two structurally-identical `Path` ports (`bun_paths::fs::Path`
/// and `bun_resolver::fs::Path`) so the bundler can key the map with either while
/// the crates converge. Both expose `.text: &[u8]`, which is all we need.
pub trait PathLike {
    fn path_text(&self) -> &[u8];
}

// `bun_resolver::fs::Path` is now a re-export of `bun_paths::fs::Path` (D090),
// so a single impl covers both.
impl PathLike for bun_paths::fs::Path<'_> {
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
    pub(crate) map: Map,
}

pub type Map = StringHashMap<IndexInt>;

/// std `HashMap::entry` doesn't expose
/// `found_existing` + value-ptr together, so we hand-roll a thin shim.
pub(crate) type GetOrPutResult<'a> = bun_collections::string_hash_map::GetOrPutResult<'a, IndexInt>;

impl PathToSourceIndexMap {
    pub(crate) fn get_path(&self, path: &impl PathLike) -> Option<IndexInt> {
        self.get(path.path_text())
    }

    pub(crate) fn get(&self, text: impl AsRef<[u8]>) -> Option<IndexInt> {
        self.map.get(text.as_ref()).copied()
    }

    // Takes `&[u8]` (not `impl AsRef<[u8]>`)
    // to avoid E0283 inference ambiguity at `.into()` call sites in bundle_v2.
    pub(crate) fn put(&mut self, text: &[u8], value: IndexInt) -> Result<(), bun_alloc::AllocError> {
        // PERF: bun_collections::StringHashMap is keyed by `Box<[u8]>`, so we dupe here.
        // Revisit once StringHashMap gains a borrowed-key variant.
        self.map.put(text, value)
    }

    pub(crate) fn get_or_put(
        &mut self,
        text: impl AsRef<[u8]>,
    ) -> Result<GetOrPutResult<'_>, bun_alloc::AllocError> {
        // PERF: see note in `put` re: key duplication.
        self.map.get_or_put(text.as_ref())
    }

    pub fn remove(&mut self, text: impl AsRef<[u8]>) -> bool {
        self.map.remove(text.as_ref()).is_some()
    }
}
