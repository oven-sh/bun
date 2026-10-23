use bun_collections::StringHashMap;
use enum_map::EnumMap;

use crate::IndexStringMap::IndexInt;
use crate::options::{Loader, ModuleKey};

/// A module is its resolved path plus a key loader: `None` for the loader the path gets by default.
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
    pub(crate) fn get(&self, key: ModuleKey<'_>) -> Option<V> {
        let map = match key.key_loader() {
            None => &self.by_path,
            Some(loader) => &self.by_loader.as_ref()?[loader],
        };
        map.get(key.path()).copied()
    }

    pub(crate) fn put(
        &mut self,
        key: ModuleKey<'_>,
        value: V,
    ) -> Result<(), bun_alloc::AllocError> {
        // PERF: bun_collections::StringHashMap is keyed by `Box<[u8]>`, so we dupe here.
        // Revisit once StringHashMap gains a borrowed-key variant.
        self.map_mut(key.key_loader()).put(key.path(), value)
    }

    pub(crate) fn get_or_put(
        &mut self,
        key: ModuleKey<'_>,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError> {
        // PERF: see note in `put` re: key duplication.
        self.map_mut(key.key_loader()).get_or_put(key.path())
    }

    fn map_mut(&mut self, key_loader: Option<Loader>) -> &mut StringHashMap<V> {
        match key_loader {
            None => &mut self.by_path,
            Some(loader) => &mut self.by_loader.get_or_insert_default()[loader],
        }
    }

    /// Forgets every module of `path`.
    pub fn remove_path(&mut self, path: &[u8]) -> bool {
        let mut removed = self.by_path.remove(path).is_some();
        if let Some(by_loader) = &mut self.by_loader {
            for map in by_loader.values_mut() {
                removed |= map.remove(path).is_some();
            }
        }
        removed
    }

    pub(crate) fn reserve(&mut self, additional: usize) {
        self.by_path.reserve(additional);
    }

    pub(crate) fn clear(&mut self) {
        self.by_path.clear();
        self.by_loader = None;
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = (ModuleKey<'_>, V)> {
        let by_path = self
            .by_path
            .iter()
            .map(|(path, value)| (ModuleKey::of_path(path), *value));
        let by_loader = self.by_loader.iter().flat_map(|by_loader| {
            by_loader.iter().flat_map(|(loader, map)| {
                map.iter()
                    .map(move |(path, value)| (ModuleKey::new(path, Some(loader)), *value))
            })
        });
        by_path.chain(by_loader)
    }
}
