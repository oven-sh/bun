use bun_collections::StringHashMap;
use enum_map::EnumMap;

use crate::IndexStringMap::IndexInt;
use crate::options::Loader;

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

pub(crate) type GetOrPutResult<'a, V> = bun_collections::hash_map::GetOrPutResult<'a, V>;

/// Keyed by resolved path plus the loader the import asked for, so `./x.json`
/// imported `with { type: "text" }` and imported plainly are two modules.
#[derive(Default)]
pub struct ModuleMap<V> {
    /// The first loader registered for each path. Nearly every path only ever has one.
    by_path: StringHashMap<FirstRegistered<V>>,
    /// Further loaders for paths already in `by_path`.
    by_loader: Option<Box<EnumMap<Loader, StringHashMap<V>>>>,
    /// The dev server's IncrementalGraph is keyed by path alone.
    pub(crate) one_module_per_path: bool,
}

#[derive(Default)]
struct FirstRegistered<V> {
    loader: Loader,
    value: V,
}

pub type PathToSourceIndexMap = ModuleMap<IndexInt>;

impl<V: Copy + Default> ModuleMap<V> {
    /// The first module registered for `text`, whatever loader it was registered with.
    pub(crate) fn get(&self, text: &[u8]) -> Option<V> {
        self.by_path.get(text).map(|first| first.value)
    }

    pub(crate) fn get_path(&self, path: &impl PathLike) -> Option<V> {
        self.get(path.path_text())
    }

    pub(crate) fn get_with_loader(&self, text: &[u8], loader: Loader) -> Option<V> {
        let first = self.by_path.get(text)?;
        if self.one_module_per_path || first.loader == loader {
            return Some(first.value);
        }
        self.by_loader.as_ref()?[loader].get(text).copied()
    }

    pub(crate) fn get_or_put(
        &mut self,
        text: &[u8],
        loader: Loader,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError> {
        let one_module_per_path = self.one_module_per_path;
        let first = self.by_path.get_or_put(text)?;
        if !first.found_existing {
            first.value_ptr.loader = loader;
        }
        if !first.found_existing || one_module_per_path || first.value_ptr.loader == loader {
            return Ok(GetOrPutResult {
                found_existing: first.found_existing,
                value_ptr: &mut first.value_ptr.value,
            });
        }
        self.by_loader.get_or_insert_default()[loader].get_or_put(text)
    }

    pub(crate) fn put(
        &mut self,
        text: &[u8],
        loader: Loader,
        value: V,
    ) -> Result<(), bun_alloc::AllocError> {
        *self.get_or_put(text, loader)?.value_ptr = value;
        Ok(())
    }

    /// Lookups of `text` that would have found `from` find `to` instead, whichever
    /// loader `from` was registered under.
    pub(crate) fn redirect(&mut self, text: &[u8], from: V, to: V)
    where
        V: PartialEq,
    {
        if let Some(first) = self.by_path.get_mut(text) {
            if first.value == from {
                first.value = to;
                return;
            }
        }
        if let Some(by_loader) = &mut self.by_loader {
            for map in by_loader.values_mut() {
                if let Some(value) = map.get_mut(text) {
                    if *value == from {
                        *value = to;
                        return;
                    }
                }
            }
        }
    }

    /// Forgets every module registered for `text`, under any loader.
    pub fn remove(&mut self, text: &[u8]) -> bool {
        let mut removed = self.by_path.remove(text).is_some();
        if let Some(by_loader) = &mut self.by_loader {
            for map in by_loader.values_mut() {
                removed |= map.remove(text).is_some();
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

    /// `(path, value)` for every registered module, `by_path` entries first.
    pub(crate) fn iter(&self) -> impl Iterator<Item = (&[u8], V)> {
        let first = self
            .by_path
            .iter()
            .map(|(text, first)| (&**text, first.value));
        let others = self
            .by_loader
            .iter()
            .flat_map(|by_loader| by_loader.values())
            .flat_map(|map| map.iter().map(|(text, value)| (&**text, *value)));
        first.chain(others)
    }
}
