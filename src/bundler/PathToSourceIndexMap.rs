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
    pub(crate) fn get_path(&self, path: &impl PathLike) -> Option<V> {
        self.get(path.path_text())
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

    pub(crate) fn get_or_put(
        &mut self,
        text: impl AsRef<[u8]>,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError> {
        // PERF: see note in `put` re: key duplication.
        self.by_path.get_or_put(text.as_ref())
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

    pub(crate) fn get_keyed(&self, text: &[u8], key_loader: Option<Loader>) -> Option<V> {
        match key_loader {
            None => self.get(text),
            Some(loader) => self.by_loader.as_ref()?[loader].get(text).copied(),
        }
    }

    pub(crate) fn put_keyed(
        &mut self,
        text: &[u8],
        key_loader: Option<Loader>,
        value: V,
    ) -> Result<(), bun_alloc::AllocError> {
        *self.get_or_put_keyed(text, key_loader)?.value_ptr = value;
        Ok(())
    }

    pub(crate) fn get_or_put_keyed(
        &mut self,
        text: &[u8],
        key_loader: Option<Loader>,
    ) -> Result<GetOrPutResult<'_, V>, bun_alloc::AllocError> {
        match key_loader {
            None => self.by_path.get_or_put(text),
            Some(loader) => self.by_loader.get_or_insert_default()[loader].get_or_put(text),
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
