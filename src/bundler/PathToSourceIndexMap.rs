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

/// A module is identified by its resolved path plus the loader the import asked
/// for: `import a from "./x.json" with { type: "text" }` and `import b from
/// "./x.json"` are two different modules. Nearly every path is only ever
/// requested with one loader, so that first registration lives in `by_path`;
/// further loaders for the same path go in `by_loader`, allocated the first time
/// a build needs it.
///
/// `V` is a source index in the module graph (`PathToSourceIndexMap`), or the
/// pending `ParseTask` while one file's imports are being resolved
/// (`bundle_v2::ResolveQueue`).
#[derive(Default)]
pub struct ModuleMap<V> {
    by_path: StringHashMap<FirstRegistered<V>>,
    by_loader: Option<Box<EnumMap<Loader, StringHashMap<V>>>>,
    /// The dev server's IncrementalGraph identifies files by path alone, so it
    /// keeps one module per path no matter which loader each import asked for.
    pub(crate) one_module_per_path: bool,
}

#[derive(Default)]
struct FirstRegistered<V> {
    loader: Loader,
    value: V,
}

pub type PathToSourceIndexMap = ModuleMap<IndexInt>;

impl<V: Copy + Default> ModuleMap<V> {
    /// The first module registered for `text`, whatever loader requested it.
    /// For callers that identify a module by path alone (entry points, the dev
    /// server, dual-package `secondary_path` lookups).
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
        // PERF: bun_collections::StringHashMap is keyed by `Box<[u8]>`, so the key is
        // duped on insert. Revisit once StringHashMap gains a borrowed-key variant.
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

    /// Forgets every module registered for `text`. `by_loader` entries are only
    /// reachable through the path's `by_path` entry, so they go too.
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

    /// `(path, value)` for every registered module. The first module registered
    /// for each path comes before any registered for the same path under another
    /// loader.
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
