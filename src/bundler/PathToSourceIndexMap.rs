use bun_collections::StringHashMap;

use crate::IndexStringMap::IndexInt;

/// The pretty-path prefix of the empty module that stands in for a path the
/// "browser" field disabled. esbuild prints the same prefix.
pub(crate) const DISABLED_PRETTY_PREFIX: &[u8] = b"(disabled):";

/// An unused import of that empty module is dropped, as esbuild drops it.
pub(crate) const DISABLED_MODULE_SIDE_EFFECTS: bun_ast::SideEffects =
    bun_ast::SideEffects::NoSideEffectsPureData;

/// Abstracts over the two structurally-identical `Path` ports (`bun_paths::fs::Path`
/// and `bun_resolver::fs::Path`) so the bundler can key the map with either while
/// the crates converge.
pub trait PathLike {
    fn path_text(&self) -> &[u8];

    /// The path names the empty module of a disabled file, not the file.
    /// `is_disabled` alone does not say so: records that stay external carry it too.
    fn is_disabled_module(&self) -> bool;
}

// `bun_resolver::fs::Path` is now a re-export of `bun_paths::fs::Path` (D090),
// so a single impl covers both.
impl PathLike for bun_paths::fs::Path<'_> {
    #[inline]
    fn path_text(&self) -> &[u8] {
        self.text
    }

    #[inline]
    fn is_disabled_module(&self) -> bool {
        self.is_disabled && self.pretty.starts_with(DISABLED_PRETTY_PREFIX)
    }
}

/// The lifetime of the keys are not owned by this map.
///
/// We assume it's arena allocated.
#[derive(Default)]
pub struct PathToSourceIndexMap {
    pub(crate) map: Map,
    /// The empty modules of disabled files, keyed by the same text. A file can be in
    /// the graph both ways.
    disabled: Map,
}

pub type Map = StringHashMap<IndexInt>;

/// std `HashMap::entry` doesn't expose
/// `found_existing` + value-ptr together, so we hand-roll a thin shim.
pub(crate) type GetOrPutResult<'a> = bun_collections::string_hash_map::GetOrPutResult<'a, IndexInt>;

impl PathToSourceIndexMap {
    fn map_for(&self, path: &impl PathLike) -> &Map {
        if path.is_disabled_module() {
            &self.disabled
        } else {
            &self.map
        }
    }

    fn map_for_mut(&mut self, path: &impl PathLike) -> &mut Map {
        if path.is_disabled_module() {
            &mut self.disabled
        } else {
            &mut self.map
        }
    }

    pub(crate) fn get_path(&self, path: &impl PathLike) -> Option<IndexInt> {
        self.map_for(path).get(path.path_text()).copied()
    }

    pub(crate) fn put_path(
        &mut self,
        path: &impl PathLike,
        value: IndexInt,
    ) -> Result<(), bun_alloc::AllocError> {
        self.map_for_mut(path).put(path.path_text(), value)
    }

    pub(crate) fn get_or_put_path(
        &mut self,
        path: &impl PathLike,
    ) -> Result<GetOrPutResult<'_>, bun_alloc::AllocError> {
        self.map_for_mut(path).get_or_put(path.path_text())
    }

    pub(crate) fn get(&self, text: impl AsRef<[u8]>) -> Option<IndexInt> {
        self.map.get(text.as_ref()).copied()
    }

    // Takes `&[u8]` (not `impl AsRef<[u8]>`)
    // to avoid E0283 inference ambiguity at `.into()` call sites in bundle_v2.
    pub(crate) fn put(
        &mut self,
        text: &[u8],
        value: IndexInt,
    ) -> Result<(), bun_alloc::AllocError> {
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
