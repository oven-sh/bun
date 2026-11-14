use core::hash::{BuildHasher, Hash, Hasher};
use core::ptr::NonNull;

use bun_collections::hashbrown::{self, hash_map::RawEntryMut};
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

/// The namespace and resolved path of a module. The `file` namespace is stored as the empty one.
///
/// The hash covers the text alone. A lookup hashes the text it has and builds no key, and a table
/// iterates in the order `StringHashMap` gave it: the resolve queue hands out source indices in that order.
/// Modules that differ only in namespace share a hash; a build has few namespaces.
pub(crate) struct ModuleKey {
    /// The text, then the namespace. One allocation that the key owns.
    bytes: NonNull<u8>,
    text_len: u32,
    namespace_len: u32,
}

const _: () = assert!(
    core::mem::size_of::<ModuleKey>() == core::mem::size_of::<bun_collections::StringHashMapKey>()
);

impl ModuleKey {
    fn new(namespace: &[u8], text: &[u8]) -> Self {
        let text_len = u32::try_from(text.len()).expect("int cast");
        let namespace_len = u32::try_from(namespace.len()).expect("int cast");
        let mut bytes = Vec::with_capacity(text.len() + namespace.len());
        bytes.extend_from_slice(text);
        bytes.extend_from_slice(namespace);
        Self {
            bytes: NonNull::from(Box::leak(bytes.into_boxed_slice())).cast(),
            text_len,
            namespace_len,
        }
    }

    #[inline]
    fn text(&self) -> &[u8] {
        // SAFETY: `bytes` points at `text_len + namespace_len` initialized bytes for the lifetime of `self`.
        unsafe { core::slice::from_raw_parts(self.bytes.as_ptr(), self.text_len as usize) }
    }

    #[inline]
    fn namespace(&self) -> &[u8] {
        // SAFETY: see `text`.
        unsafe {
            core::slice::from_raw_parts(
                self.bytes.as_ptr().add(self.text_len as usize),
                self.namespace_len as usize,
            )
        }
    }

    #[inline]
    fn is(&self, namespace: &[u8], text: &[u8]) -> bool {
        self.namespace_len as usize == namespace.len()
            && self.text() == text
            && (namespace.is_empty() || self.namespace() == namespace)
    }
}

impl Drop for ModuleKey {
    fn drop(&mut self) {
        let len = self.text_len as usize + self.namespace_len as usize;
        // SAFETY: `bytes` and `len` are the `Box<[u8]>` that `new` leaked.
        unsafe {
            drop(Box::from_raw(core::ptr::slice_from_raw_parts_mut(
                self.bytes.as_ptr(),
                len,
            )));
        }
    }
}

impl Hash for ModuleKey {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.text().hash(state);
    }
}

impl PartialEq for ModuleKey {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.is(other.namespace(), other.text())
    }
}
impl Eq for ModuleKey {}

type Table<V> = hashbrown::HashMap<ModuleKey, V, bun_wyhash::BuildHasher>;

/// The namespace that the key of `path` stores.
#[inline]
fn key_namespace(path: &impl PathLike) -> &[u8] {
    let namespace = path.path_namespace();
    if is_file_namespace(namespace) {
        b""
    } else {
        namespace
    }
}

fn find<'a, V>(table: &'a Table<V>, namespace: &[u8], text: &[u8]) -> Option<&'a V> {
    table
        .raw_entry()
        .from_hash(table.hasher().hash_one(text), |key| key.is(namespace, text))
        .map(|(_, value)| value)
}

/// The key is allocated only when the module is new.
fn find_or_insert<'a, V: Default>(
    table: &'a mut Table<V>,
    namespace: &[u8],
    text: &[u8],
) -> GetOrPutResult<'a, V> {
    let hash = table.hasher().hash_one(text);
    match table
        .raw_entry_mut()
        .from_hash(hash, |key| key.is(namespace, text))
    {
        RawEntryMut::Occupied(entry) => GetOrPutResult {
            found_existing: true,
            value_ptr: entry.into_mut(),
        },
        RawEntryMut::Vacant(entry) => GetOrPutResult {
            found_existing: false,
            value_ptr: entry
                .insert_hashed_nocheck(hash, ModuleKey::new(namespace, text), V::default())
                .1,
        },
    }
}

fn remove<V>(table: &mut Table<V>, namespace: &[u8], text: &[u8]) -> bool {
    let hash = table.hasher().hash_one(text);
    match table
        .raw_entry_mut()
        .from_hash(hash, |key| key.is(namespace, text))
    {
        RawEntryMut::Occupied(entry) => {
            entry.remove();
            true
        }
        RawEntryMut::Vacant(_) => false,
    }
}

/// A module is its namespace and resolved path (see `ModuleKey`) plus a key loader: `None` for the loader the path gets by default.
/// The functions that take `text` are for files. No lookup allocates.
#[derive(Default)]
pub struct ModuleMap<V> {
    by_path: Table<V>,
    /// The `Some(loader)` keys: a `with { type }` import of a file under another loader. Rare.
    by_loader: Option<Box<EnumMap<Loader, Table<V>>>>,
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
        find(&self.by_path, b"", text.as_ref()).copied()
    }

    // Takes `&[u8]` (not `impl AsRef<[u8]>`)
    // to avoid E0283 inference ambiguity at `.into()` call sites in bundle_v2.
    pub(crate) fn put(&mut self, text: &[u8], value: V) -> Result<(), bun_alloc::AllocError> {
        *find_or_insert(&mut self.by_path, b"", text).value_ptr = value;
        Ok(())
    }

    /// Forgets the modules of `text` under every key loader.
    pub fn remove(&mut self, text: impl AsRef<[u8]>) -> bool {
        self.remove_key(b"", text.as_ref())
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
        self.remove_key(key_namespace(path), path.path_text())
    }

    fn remove_key(&mut self, namespace: &[u8], text: &[u8]) -> bool {
        let mut removed = remove(&mut self.by_path, namespace, text);
        if let Some(by_loader) = &mut self.by_loader {
            for table in by_loader.values_mut() {
                removed |= remove(table, namespace, text);
            }
        }
        removed
    }

    pub(crate) fn get_keyed(&self, path: &impl PathLike, key_loader: Option<Loader>) -> Option<V> {
        let table = match key_loader {
            None => &self.by_path,
            Some(loader) => &self.by_loader.as_ref()?[loader],
        };
        find(table, key_namespace(path), path.path_text()).copied()
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
        Ok(find_or_insert(
            self.table_mut(key_loader),
            key_namespace(path),
            path.path_text(),
        ))
    }

    /// `key`: one that `iter` gave.
    pub(crate) fn get_or_put_key(
        &mut self,
        key: &ModuleKey,
        key_loader: Option<Loader>,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError> {
        Ok(find_or_insert(
            self.table_mut(key_loader),
            key.namespace(),
            key.text(),
        ))
    }

    fn table_mut(&mut self, key_loader: Option<Loader>) -> &mut Table<V> {
        match key_loader {
            None => &mut self.by_path,
            Some(loader) => &mut self.by_loader.get_or_insert_default()[loader],
        }
    }

    pub(crate) fn reserve(&mut self, additional: usize) {
        self.by_path.reserve(additional);
    }

    pub(crate) fn clear(&mut self) {
        self.by_path.clear();
        self.by_loader = None;
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = (&ModuleKey, Option<Loader>, V)> {
        let by_path = self.by_path.iter().map(|(key, value)| (key, None, *value));
        let by_loader = self.by_loader.iter().flat_map(|by_loader| {
            by_loader.iter().flat_map(|(loader, table)| {
                table
                    .iter()
                    .map(move |(key, value)| (key, Some(loader), *value))
            })
        });
        by_path.chain(by_loader)
    }
}

#[cfg(test)]
mod tests {
    use bun_paths::fs::Path;

    use super::*;

    fn namespaced<'a>(namespace: &'a [u8], text: &'a [u8]) -> Path<'a> {
        Path::init_with_namespace(text, namespace)
    }

    #[test]
    fn one_text_in_two_namespaces_is_two_modules() {
        let mut map = ModuleMap::<u32>::default();
        map.put_path(&namespaced(b"nsa", b"SAMEPATH"), 1).unwrap();
        map.put_path(&namespaced(b"nsb", b"SAMEPATH"), 2).unwrap();
        assert_eq!(map.get_path(&namespaced(b"nsa", b"SAMEPATH")), Some(1));
        assert_eq!(map.get_path(&namespaced(b"nsb", b"SAMEPATH")), Some(2));
        assert_eq!(map.get_path(&namespaced(b"ns", b"SAMEPATH")), None);
        assert_eq!(map.get(b"SAMEPATH"), None);
    }

    #[test]
    fn file_is_the_empty_namespace() {
        let mut map = ModuleMap::<u32>::default();
        map.put(b"/a.js", 1).unwrap();
        assert_eq!(map.get_path(&Path::init(b"/a.js")), Some(1));
        assert_eq!(map.get_path(&namespaced(b"", b"/a.js")), Some(1));
        assert_eq!(map.get_path(&namespaced(b"virt", b"/a.js")), None);

        let entry = map.get_or_put_path(&namespaced(b"virt", b"/a.js")).unwrap();
        assert!(!entry.found_existing);
        *entry.value_ptr = 2;
        assert!(
            map.get_or_put_path(&Path::init(b"/a.js"))
                .unwrap()
                .found_existing
        );

        assert!(map.remove(b"/a.js"));
        assert_eq!(map.get(b"/a.js"), None);
        assert_eq!(map.get_path(&namespaced(b"virt", b"/a.js")), Some(2));
        assert!(map.remove_path(&namespaced(b"virt", b"/a.js")));
        assert!(!map.remove_path(&namespaced(b"virt", b"/a.js")));

        map.put(b"", 3).unwrap();
        assert_eq!(map.get_path(&Path::init(b"")), Some(3));
        assert!(map.remove(b""));
    }

    #[test]
    fn key_loader_is_part_of_the_key() {
        let mut map = ModuleMap::<u32>::default();
        let path = namespaced(b"virt", b"data.json");
        map.put_keyed(&path, None, 1).unwrap();
        map.put_keyed(&path, Some(Loader::Text), 2).unwrap();
        assert_eq!(map.get_keyed(&path, None), Some(1));
        assert_eq!(map.get_keyed(&path, Some(Loader::Text)), Some(2));
        assert_eq!(map.get_keyed(&path, Some(Loader::File)), None);
        assert_eq!(
            map.get_keyed(&Path::init(b"data.json"), Some(Loader::Text)),
            None
        );

        assert!(map.remove_path(&path));
        assert_eq!(map.get_keyed(&path, None), None);
        assert_eq!(map.get_keyed(&path, Some(Loader::Text)), None);
    }

    #[test]
    fn iter_gives_keys_for_another_map() {
        let mut queue = ModuleMap::<u32>::default();
        queue.put(b"/a.js", 1).unwrap();
        queue.put_path(&namespaced(b"nsa", b"SAMEPATH"), 2).unwrap();
        queue.put_path(&namespaced(b"nsb", b"SAMEPATH"), 3).unwrap();
        queue
            .put_keyed(&Path::init(b"/a.js"), Some(Loader::Text), 4)
            .unwrap();

        let mut graph = ModuleMap::<u32>::default();
        for (key, key_loader, value) in queue.iter() {
            let entry = graph.get_or_put_key(key, key_loader).unwrap();
            assert!(!entry.found_existing);
            *entry.value_ptr = value;
        }
        assert_eq!(graph.get(b"/a.js"), Some(1));
        assert_eq!(graph.get_path(&namespaced(b"nsa", b"SAMEPATH")), Some(2));
        assert_eq!(graph.get_path(&namespaced(b"nsb", b"SAMEPATH")), Some(3));
        assert_eq!(
            graph.get_keyed(&Path::init(b"/a.js"), Some(Loader::Text)),
            Some(4)
        );
        for (key, key_loader, _) in queue.iter() {
            assert!(
                graph
                    .get_or_put_key(key, key_loader)
                    .unwrap()
                    .found_existing
            );
        }

        queue.clear();
        assert_eq!(queue.iter().count(), 0);
    }

    // One text in many namespaces: every key has the same hash, and the table grows several times.
    #[test]
    fn keys_with_one_hash_survive_growth() {
        let namespaces: Vec<Vec<u8>> = (0..64u32).map(|i| format!("ns{i}").into_bytes()).collect();
        let mut map = ModuleMap::<u32>::default();
        for (i, namespace) in namespaces.iter().enumerate() {
            map.put_path(&namespaced(namespace, b"SAMEPATH"), i as u32)
                .unwrap();
        }
        for (i, namespace) in namespaces.iter().enumerate() {
            assert_eq!(
                map.get_path(&namespaced(namespace, b"SAMEPATH")),
                Some(i as u32)
            );
        }
    }

    // The resolve queue gives source indices in its iteration order, so a file has to land where `StringHashMap` put it.
    #[test]
    fn key_hashes_as_string_hash_map_hashes_its_text() {
        let text_hash = bun_collections::StringHashMap::<u32>::default().hash_key(b"/a.js");
        let hasher = bun_wyhash::BuildHasher::default();
        assert_eq!(hasher.hash_one(ModuleKey::new(b"", b"/a.js")), text_hash);
        assert_eq!(
            hasher.hash_one(ModuleKey::new(b"virt", b"/a.js")),
            text_hash
        );
    }
}
