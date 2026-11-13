use std::borrow::Cow;

use bun_collections::StringHashMap;
use bun_paths::fs::is_file_namespace;
use enum_map::EnumMap;

use crate::IndexStringMap::IndexInt;
use crate::options::Loader;

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

/// The bare text for a file. Any other namespace: `len(namespace) as u32 LE ++ namespace ++ text`.
fn path_key(path: &impl PathLike) -> Cow<'_, [u8]> {
    let (namespace, text) = (path.path_namespace(), path.path_text());
    if is_file_namespace(namespace) {
        return Cow::Borrowed(text);
    }
    let mut key = Vec::with_capacity(4 + namespace.len() + text.len());
    key.extend_from_slice(
        &u32::try_from(namespace.len())
            .expect("int cast")
            .to_le_bytes(),
    );
    key.extend_from_slice(namespace);
    key.extend_from_slice(text);
    Cow::Owned(key)
}

/// A module is its namespace and resolved path (see `path_key`) plus a key loader: `None` for the loader the path gets by default.
/// The functions that take `text` are for files.
#[derive(Default)]
pub struct ModuleMap<V> {
    by_path: StringHashMap<V>,
    /// The `Some(loader)` keys: a `with { type }` import of a file under another loader. Rare.
    by_loader: Option<Box<EnumMap<Loader, StringHashMap<V>>>>,
}

pub type PathToSourceIndexMap = ModuleMap<IndexInt>;

/// std `HashMap::entry` doesn't expose
/// `found_existing` + value-ptr together, so we hand-roll a thin shim.
pub(crate) type GetOrPutResult<'a, V> = bun_collections::string_hash_map::GetOrPutResult<'a, V>;

impl<V: Copy + Default> ModuleMap<V> {
    pub(crate) fn get_path(&self, path: &impl PathLike) -> Option<V> {
        self.get_keyed(path, None)
    }

    pub(crate) fn get(&self, text: impl AsRef<[u8]>) -> Option<V> {
        self.by_path.get(text.as_ref()).copied()
    }

    // Takes `&[u8]` (not `impl AsRef<[u8]>`)
    // to avoid E0283 inference ambiguity at `.into()` call sites in bundle_v2.
    pub(crate) fn put(&mut self, text: &[u8], value: V) -> Result<(), bun_alloc::AllocError> {
        // PERF: bun_collections::StringHashMap is keyed by `Box<[u8]>`, so we dupe here.
        // Revisit once StringHashMap gains a borrowed-key variant.
        self.by_path.put(text, value)
    }

    /// Forgets the modules of `text` under every key loader.
    pub fn remove(&mut self, text: impl AsRef<[u8]>) -> bool {
        let text = text.as_ref();
        let mut removed = self.by_path.remove(text).is_some();
        if let Some(by_loader) = &mut self.by_loader {
            for map in by_loader.values_mut() {
                removed |= map.remove(text).is_some();
            }
        }
        removed
    }

    pub(crate) fn put_path(
        &mut self,
        path: &impl PathLike,
        value: V,
    ) -> Result<(), bun_alloc::AllocError> {
        self.put_keyed(path, None, value)
    }

    pub(crate) fn get_or_put_path(
        &mut self,
        path: &impl PathLike,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError> {
        self.get_or_put_keyed(path, None)
    }

    pub(crate) fn remove_path(&mut self, path: &impl PathLike) -> bool {
        self.remove(path_key(path))
    }

    pub(crate) fn get_keyed(&self, path: &impl PathLike, key_loader: Option<Loader>) -> Option<V> {
        let key = path_key(path);
        match key_loader {
            None => self.by_path.get(&*key).copied(),
            Some(loader) => self.by_loader.as_ref()?[loader].get(&*key).copied(),
        }
    }

    pub(crate) fn put_keyed(
        &mut self,
        path: &impl PathLike,
        key_loader: Option<Loader>,
        value: V,
    ) -> Result<(), bun_alloc::AllocError> {
        *self.get_or_put_keyed(path, key_loader)?.value_ptr = value;
        Ok(())
    }

    pub(crate) fn get_or_put_keyed(
        &mut self,
        path: &impl PathLike,
        key_loader: Option<Loader>,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError> {
        self.get_or_put_key(&path_key(path), key_loader)
    }

    /// `key`: one that `iter` gave.
    pub(crate) fn get_or_put_key(
        &mut self,
        key: &[u8],
        key_loader: Option<Loader>,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError> {
        match key_loader {
            None => self.by_path.get_or_put(key),
            Some(loader) => self.by_loader.get_or_insert_default()[loader].get_or_put(key),
        }
    }

    pub(crate) fn reserve(&mut self, additional: usize) {
        self.by_path.reserve(additional);
    }

    pub(crate) fn clear(&mut self) {
        self.by_path.clear();
        self.by_loader = None;
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = (&[u8], Option<Loader>, V)> {
        let by_path = self
            .by_path
            .iter()
            .map(|(text, value)| (&**text, None, *value));
        let by_loader = self.by_loader.iter().flat_map(|by_loader| {
            by_loader.iter().flat_map(|(loader, map)| {
                map.iter()
                    .map(move |(text, value)| (&**text, Some(loader), *value))
            })
        });
        by_path.chain(by_loader)
    }
}
