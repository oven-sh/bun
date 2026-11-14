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

/// The modules of one namespace.
#[derive(Default)]
struct Table<V> {
    by_path: StringHashMap<V>,
    /// The `Some(loader)` keys: a `with { type }` import of a file under another loader. Rare.
    by_loader: Option<Box<EnumMap<Loader, StringHashMap<V>>>>,
}

impl<V: Copy + Default> Table<V> {
    fn get(&self, text: &[u8], key_loader: Option<Loader>) -> Option<V> {
        match key_loader {
            None => self.by_path.get(text).copied(),
            Some(loader) => self.by_loader.as_ref()?[loader].get(text).copied(),
        }
    }

    fn get_or_put(
        &mut self,
        text: &[u8],
        key_loader: Option<Loader>,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError> {
        // PERF: bun_collections::StringHashMap is keyed by `Box<[u8]>`, so we dupe here.
        // Revisit once StringHashMap gains a borrowed-key variant.
        match key_loader {
            None => self.by_path.get_or_put(text),
            Some(loader) => self.by_loader.get_or_insert_default()[loader].get_or_put(text),
        }
    }

    /// Forgets the modules of `text` under every key loader.
    fn remove(&mut self, text: &[u8]) -> bool {
        let mut removed = self.by_path.remove(text).is_some();
        if let Some(by_loader) = &mut self.by_loader {
            for map in by_loader.values_mut() {
                removed |= map.remove(text).is_some();
            }
        }
        removed
    }

    fn iter(&self) -> impl Iterator<Item = (&[u8], Option<Loader>, V)> {
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

/// A module is its namespace, its resolved path, and a key loader: `None` for the loader the path gets by default.
/// The functions that take `text` are for files.
#[derive(Default)]
pub struct ModuleMap<V> {
    files: Table<V>,
    /// Every namespace but `file`. Only plugins and a few virtual modules fill it, and a lookup does not allocate.
    namespaces: Option<Box<StringHashMap<Table<V>>>>,
}

pub type PathToSourceIndexMap = ModuleMap<IndexInt>;

/// std `HashMap::entry` doesn't expose
/// `found_existing` + value-ptr together, so we hand-roll a thin shim.
pub(crate) type GetOrPutResult<'a, V> = bun_collections::string_hash_map::GetOrPutResult<'a, V>;

impl<V: Copy + Default> ModuleMap<V> {
    fn table(&self, namespace: &[u8]) -> Option<&Table<V>> {
        if is_file_namespace(namespace) {
            return Some(&self.files);
        }
        self.namespaces.as_ref()?.get(namespace)
    }

    fn table_mut(&mut self, namespace: &[u8]) -> Result<&mut Table<V>, bun_alloc::AllocError> {
        if is_file_namespace(namespace) {
            return Ok(&mut self.files);
        }
        Ok(self
            .namespaces
            .get_or_insert_default()
            .get_or_put(namespace)?
            .value_ptr)
    }

    pub(crate) fn get(&self, text: impl AsRef<[u8]>) -> Option<V> {
        self.files.get(text.as_ref(), None)
    }

    // Takes `&[u8]` (not `impl AsRef<[u8]>`)
    // to avoid E0283 inference ambiguity at `.into()` call sites in bundle_v2.
    pub(crate) fn put(&mut self, text: &[u8], value: V) -> Result<(), bun_alloc::AllocError> {
        *self.files.get_or_put(text, None)?.value_ptr = value;
        Ok(())
    }

    /// Forgets the modules of `text` under every key loader.
    pub fn remove(&mut self, text: impl AsRef<[u8]>) -> bool {
        self.files.remove(text.as_ref())
    }

    pub(crate) fn get_path(&self, path: &impl PathLike) -> Option<V> {
        self.get_keyed(path, None)
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
        let namespace = path.path_namespace();
        if is_file_namespace(namespace) {
            return self.files.remove(path.path_text());
        }
        self.namespaces
            .as_mut()
            .and_then(|namespaces| namespaces.get_mut(namespace))
            .is_some_and(|table| table.remove(path.path_text()))
    }

    pub(crate) fn get_keyed(&self, path: &impl PathLike, key_loader: Option<Loader>) -> Option<V> {
        self.table(path.path_namespace())?
            .get(path.path_text(), key_loader)
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
        self.get_or_put_key(path.path_namespace(), path.path_text(), key_loader)
    }

    /// The parts of a key that `iter` gave.
    pub(crate) fn get_or_put_key(
        &mut self,
        namespace: &[u8],
        text: &[u8],
        key_loader: Option<Loader>,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError> {
        self.table_mut(namespace)?.get_or_put(text, key_loader)
    }

    pub(crate) fn reserve(&mut self, additional: usize) {
        self.files.by_path.reserve(additional);
    }

    pub(crate) fn clear(&mut self) {
        self.files.by_path.clear();
        self.files.by_loader = None;
        self.namespaces = None;
    }

    /// (namespace, text, key loader, value). The namespace of a file is empty.
    pub(crate) fn iter(&self) -> impl Iterator<Item = (&[u8], &[u8], Option<Loader>, V)> {
        let files = self
            .files
            .iter()
            .map(|(text, loader, value)| (&b""[..], text, loader, value));
        let others = self.namespaces.iter().flat_map(|namespaces| {
            namespaces.iter().flat_map(|(namespace, table)| {
                table
                    .iter()
                    .map(move |(text, loader, value)| (&**namespace, text, loader, value))
            })
        });
        files.chain(others)
    }
}
