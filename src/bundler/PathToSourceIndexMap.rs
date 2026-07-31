use bun_collections::StringHashMap;

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

/// Module identity is `(namespace, text)`, matching esbuild's plugin contract.
/// The stored key is `text` for the `file` namespace (the overwhelmingly common
/// case: every disk/entry/resolver path) and `namespace ++ '\0' ++ text` otherwise.
/// NUL is disallowed in real filesystem paths on every platform we target, so a
/// file-namespace `text` can never equal a composite key.
impl PathToSourceIndexMap {
    #[inline]
    fn is_file_namespace(namespace: &[u8]) -> bool {
        namespace.is_empty() || namespace == b"file"
    }

    #[inline]
    fn composite_key(namespace: &[u8], text: &[u8]) -> Vec<u8> {
        let mut v = Vec::with_capacity(namespace.len() + 1 + text.len());
        v.extend_from_slice(namespace);
        v.push(0);
        v.extend_from_slice(text);
        v
    }

    pub(crate) fn get_path(&self, path: &impl PathLike) -> Option<IndexInt> {
        self.get(path.path_namespace(), path.path_text())
    }

    pub(crate) fn get(&self, namespace: &[u8], text: &[u8]) -> Option<IndexInt> {
        if Self::is_file_namespace(namespace) {
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
        if Self::is_file_namespace(namespace) {
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
        if Self::is_file_namespace(namespace) {
            self.map.get_or_put(text)
        } else {
            self.map
                .get_or_put(Self::composite_key(namespace, text).as_slice())
        }
    }

    pub fn remove(&mut self, namespace: &[u8], text: &[u8]) -> bool {
        if Self::is_file_namespace(namespace) {
            self.map.remove(text).is_some()
        } else {
            self.map
                .remove(Self::composite_key(namespace, text).as_slice())
                .is_some()
        }
    }
}
