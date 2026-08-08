use bun_collections::StringHashMap;
use bun_paths::fs::is_file_namespace;

use crate::IndexStringMap::IndexInt;

/// Abstracts over the two structurally-identical `Path` ports (`bun_paths::fs::Path`
/// and `bun_resolver::fs::Path`) so the bundler can key the map with either while
/// the crates converge.
pub trait PathLike {
    fn path_text(&self) -> &[u8];
    fn path_namespace(&self) -> &[u8];
}

// `bun_resolver::fs::Path` is now a re-export of `bun_paths::fs::Path` (D090),
// so a single impl covers both.
impl PathLike for bun_paths::fs::Path<'_> {
    #[inline]
    fn path_text(&self) -> &[u8] {
        self.text
    }
    #[inline]
    fn path_namespace(&self) -> &[u8] {
        self.namespace
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

/// Module identity is `(namespace, text)`. File-namespace entries key on bare
/// `text`; other namespaces key on `len(namespace) as u32 LE ++ namespace ++ text`.
impl PathToSourceIndexMap {
    #[inline]
    fn composite_key(namespace: &[u8], text: &[u8]) -> Vec<u8> {
        let mut v = Vec::with_capacity(4 + namespace.len() + text.len());
        v.extend_from_slice(&(namespace.len() as u32).to_le_bytes());
        v.extend_from_slice(namespace);
        v.extend_from_slice(text);
        v
    }

    pub(crate) fn get_path(&self, path: &impl PathLike) -> Option<IndexInt> {
        self.get(path.path_namespace(), path.path_text())
    }

    pub(crate) fn get(&self, namespace: &[u8], text: &[u8]) -> Option<IndexInt> {
        if is_file_namespace(namespace) {
            self.map.get(text).copied()
        } else {
            self.map
                .get(Self::composite_key(namespace, text).as_slice())
                .copied()
        }
    }

    pub(crate) fn put(
        &mut self,
        namespace: &[u8],
        text: &[u8],
        value: IndexInt,
    ) -> Result<(), bun_alloc::AllocError> {
        // PERF: bun_collections::StringHashMap is keyed by `Box<[u8]>`, so we dupe here.
        // Revisit once StringHashMap gains a borrowed-key variant.
        if is_file_namespace(namespace) {
            self.map.put(text, value)
        } else {
            self.map
                .put(Self::composite_key(namespace, text).as_slice(), value)
        }
    }

    pub(crate) fn get_or_put(
        &mut self,
        namespace: &[u8],
        text: &[u8],
    ) -> Result<GetOrPutResult<'_>, bun_alloc::AllocError> {
        // PERF: see note in `put` re: key duplication.
        if is_file_namespace(namespace) {
            self.map.get_or_put(text)
        } else {
            self.map
                .get_or_put(Self::composite_key(namespace, text).as_slice())
        }
    }

    pub fn remove(&mut self, namespace: &[u8], text: &[u8]) -> bool {
        if is_file_namespace(namespace) {
            self.map.remove(text).is_some()
        } else {
            self.map
                .remove(Self::composite_key(namespace, text).as_slice())
                .is_some()
        }
    }
}
