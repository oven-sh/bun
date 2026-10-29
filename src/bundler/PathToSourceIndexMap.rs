use bun_collections::StringHashMap;
use enum_map::EnumMap;

use crate::IndexStringMap::IndexInt;
use crate::options::Loader;

/// A module of the scan: a resolved path, and the loader it is parsed with when that is not
/// the loader the path gets by default.
#[derive(Clone, Copy, Debug)]
pub struct ModuleKey<'a> {
    pub text: &'a [u8],
    pub loader: Option<Loader>,
}

impl<'a> ModuleKey<'a> {
    /// The module of `text` under the loader the path gets by default.
    pub fn of_path(text: &'a [u8]) -> Self {
        Self { text, loader: None }
    }
}

/// The source index of each module of one target's graph.
#[derive(Default)]
pub struct PathToSourceIndexMap {
    by_path: StringHashMap<IndexInt>,
    /// The keys with a loader. Rare: a file that is in the build under a loader other than its default.
    by_loader: Option<Box<EnumMap<Loader, StringHashMap<IndexInt>>>>,
}

/// std `HashMap::entry` doesn't expose
/// `found_existing` + value-ptr together, so we hand-roll a thin shim.
pub(crate) type GetOrPutResult<'a> = bun_collections::string_hash_map::GetOrPutResult<'a, IndexInt>;

impl PathToSourceIndexMap {
    pub(crate) fn get(&self, key: ModuleKey<'_>) -> Option<IndexInt> {
        match key.loader {
            None => self.by_path.get(key.text).copied(),
            Some(loader) => self.by_loader.as_ref()?[loader].get(key.text).copied(),
        }
    }

    pub(crate) fn put(
        &mut self,
        key: ModuleKey<'_>,
        value: IndexInt,
    ) -> Result<(), bun_alloc::AllocError> {
        *self.get_or_put(key)?.value_ptr = value;
        Ok(())
    }

    pub(crate) fn get_or_put(
        &mut self,
        key: ModuleKey<'_>,
    ) -> Result<GetOrPutResult<'_>, bun_alloc::AllocError> {
        // PERF: bun_collections::StringHashMap is keyed by `Box<[u8]>`, so the text is duped here.
        // Revisit once StringHashMap gains a borrowed-key variant.
        match key.loader {
            None => self.by_path.get_or_put(key.text),
            Some(loader) => self.by_loader.get_or_insert_default()[loader].get_or_put(key.text),
        }
    }

    /// Forgets the modules of `text` under every loader.
    pub fn remove_all_forms(&mut self, text: &[u8]) -> bool {
        let mut removed = self.by_path.remove(text).is_some();
        if let Some(by_loader) = &mut self.by_loader {
            for map in by_loader.values_mut() {
                removed |= map.remove(text).is_some();
            }
        }
        removed
    }

    /// The modules whose key has a loader.
    pub(crate) fn keyed(&self) -> impl Iterator<Item = (Loader, &[u8], IndexInt)> {
        self.by_loader.iter().flat_map(|by_loader| {
            by_loader.iter().flat_map(|(loader, map)| {
                map.iter()
                    .map(move |(text, module)| (loader, &**text, *module))
            })
        })
    }

    /// Whether `text`, under any loader, is a key of `module`.
    pub(crate) fn is_key_of(&self, text: &[u8], module: IndexInt) -> bool {
        self.by_path.get(text) == Some(&module)
            || self.by_loader.as_ref().is_some_and(|by_loader| {
                by_loader
                    .values()
                    .any(|map| map.get(text) == Some(&module))
            })
    }

    /// Points the key of the module `from` at `to`: later imports of that key get `to`.
    /// A module does not store its key, so the key is found by its value among the forms of `text`.
    pub(crate) fn redirect(
        &mut self,
        text: &[u8],
        from: IndexInt,
        to: IndexInt,
    ) -> Result<(), bun_alloc::AllocError> {
        if let Some(by_loader) = &mut self.by_loader {
            for map in by_loader.values_mut() {
                if let Some(module) = map.get_mut(text)
                    && *module == from
                {
                    *module = to;
                    return Ok(());
                }
            }
        }
        let bare = self.by_path.get_or_put(text)?;
        if !bare.found_existing || *bare.value_ptr == from {
            *bare.value_ptr = to;
        }
        Ok(())
    }
}
