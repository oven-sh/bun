use core::hash::{BuildHasherDefault, Hasher};

use bun_alloc::BSSList;
use bun_collections::hashbrown::HashMap;
use bun_core::feature_flags as FeatureFlags;
use bun_core::{Generation, Once, strings};
use bun_sys::Fd;
use bun_threading::Guarded;

use crate::fs;
use crate::package_json::PackageJSON;
use crate::tsconfig_json::TSConfigJSON;

pub struct DirInfo {
    // These objects are immutable, so we can just point to the parent directory
    // and avoid having to lock the cache again
    pub(crate) parent: Option<&'static DirInfo>,

    // A pointer to the enclosing dirInfo with a valid "browser" field in
    // package.json. We need this to remap paths after they have been resolved.
    // Does not apply if `Flags::IsBrowserScope` is set.
    pub(crate) enclosing_browser_scope: Option<&'static DirInfo>,
    pub(crate) enclosing_tsconfig_json: Option<&'static TSConfigJSON>,

    /// package.json used for bundling
    /// it's the deepest one in the hierarchy with a "name" field
    /// or, if using `bun run`, the name field is optional
    /// https://github.com/oven-sh/bun/issues/229
    pub enclosing_package_json: Option<&'static PackageJSON>,

    /// The nearest package.json in this directory or above it, with or without
    /// a "name". The bundler takes the module type of a `.js`-like file in this
    /// directory from its "type" (`finalize_result`), as esbuild does. The
    /// lookup does not stop at a "node_modules" directory, so a package with no
    /// package.json of its own gets the one above it. `enclosing_package_json`
    /// skips a nameless package.json.
    pub package_json_for_module_type: Option<&'static PackageJSON>,

    pub(crate) package_json_for_dependencies: Option<&'static PackageJSON>,

    // lifetime — slice into BSS-backed path storage; never individually freed
    pub abs_path: &'static [u8],
    pub entries: fs::DirEntryIndex,
    /// Is there a "package.json" file?
    pub package_json: Option<&'static PackageJSON>,
    /// Is there a "tsconfig.json" file in this directory or a parent directory?
    pub(crate) tsconfig_json: Option<&'static TSConfigJSON>,
    /// If non-empty, this is the real absolute path resolving any symlinks
    // lifetime — slice into BSS-backed path storage; never individually freed
    pub abs_real_path: &'static [u8],

    pub(crate) flags: Flags,
}

impl DirInfo {
    /// Is there a "node_modules" subdirectory?
    #[inline]
    pub(crate) fn has_node_modules(&self) -> bool {
        self.flags.contains(Flags::HasNodeModules)
    }

    /// Is this a "node_modules" directory?
    #[inline]
    pub(crate) fn is_node_modules(&self) -> bool {
        self.flags.contains(Flags::IsNodeModules)
    }

    /// Is this inside a "node_modules" directory?
    #[inline]
    pub(crate) fn is_inside_node_modules(&self) -> bool {
        self.flags.contains(Flags::InsideNodeModules)
    }

    pub fn get_file_descriptor(&self) -> Fd {
        if FeatureFlags::STORE_FILE_DESCRIPTORS {
            return (fs::FileSystem::get().fs.entries.lock())
                .at_index(self.entries)
                .map_or(Fd::INVALID, |e| e.fd);
        }
        Fd::INVALID
    }

    /// The listing, read again first if it is older than `generation`.
    pub fn get_entries<'a>(
        &self,
        entries_map: &'a mut fs::EntriesMap,
        generation: Generation,
    ) -> Option<&'a fs::DirEntry> {
        entries_map.at_generation(self.entries, generation)
    }

    /// Generation-checked lookup of one basename. Locks `RealFS::entries`.
    pub(crate) fn get_entry(
        &self,
        generation: Generation,
        query: &[u8],
    ) -> Option<&'static fs::Entry> {
        self.get_entries(&mut fs::FileSystem::get().fs.entries.lock(), generation)?
            .get(query)
    }

    pub(crate) fn get_enclosing_browser_scope(&'static self) -> Option<&'static DirInfo> {
        if self.flags.contains(Flags::IsBrowserScope) {
            return Some(self);
        }
        self.enclosing_browser_scope
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
    pub struct Flags: u8 {
        /// This directory is a node_modules directory
        const IsNodeModules     = 1 << 0;
        /// This directory has a node_modules subdirectory
        const HasNodeModules    = 1 << 1;
        const InsideNodeModules = 1 << 2;
        /// The package.json in this directory has a non-empty "browser" map
        const IsBrowserScope    = 1 << 3;
    }
}
impl Flags {
    #[inline]
    pub(crate) fn set_present(&mut self, flag: Flags, present: bool) {
        self.set(flag, present);
    }
}
/// Allows addressing individual flags as `DirInfo::Flag::X`.
pub use Flags as Flag;

// Goal: Really fast, low allocation directory map exploiting cache locality where we don't worry about lifetimes much.
// 1. Don't store the keys or values of directories that don't exist
// 2. Don't expect a provided key to exist after it's queried
// 3. Store whether a directory has been queried and whether that query was successful.
// 4. Allocate onto the https://en.wikipedia.org/wiki/.bss#BSS_in_C instead of the heap, so we can avoid memory leaks
pub(crate) struct Cache {
    state: Guarded<CacheState>,
}

const DIR_COUNT: usize = 2048;

struct CacheState {
    by_hash: ByHash<&'static DirInfo>,
    store: BSSList<DirInfo, DIR_COUNT>,
}

/// Keyed by [`Cache::hash`].
pub(crate) type ByHash<T> = HashMap<u64, Cached<T>, BuildHasherDefault<IdentityU64Hasher>>;

#[derive(Clone, Copy, Default)]
pub(crate) enum Cached<T> {
    #[default]
    Unknown,
    NotFound,
    Exists(T),
}

/// The keys are `bun_wyhash` outputs, so they are not hashed again.
#[derive(Default, Clone, Copy)]
pub(crate) struct IdentityU64Hasher(u64);

impl Hasher for IdentityU64Hasher {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        self.0 = bun_wyhash::hash_with_seed(self.0, bytes);
    }
    #[inline]
    fn write_u64(&mut self, n: u64) {
        self.0 = n;
    }
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
}

impl Cache {
    pub(crate) fn instance() -> &'static Cache {
        static CACHE: Once<Cache> = Once::new();
        CACHE.get_or_init(|| Cache {
            state: Guarded::new(CacheState {
                by_hash: Default::default(),
                store: BSSList::new(DIR_COUNT),
            }),
        })
    }

    #[inline]
    pub(crate) fn hash(path: &[u8]) -> u64 {
        bun_wyhash::hash(strings::trim_right(path, &[bun_paths::SEP]))
    }

    pub(crate) fn get_or_put(&self, hash: u64) -> Cached<&'static DirInfo> {
        *self.state.lock().by_hash.entry(hash).or_default()
    }

    pub(crate) fn put(&self, hash: u64, info: DirInfo) -> &'static DirInfo {
        let mut state = self.state.lock();
        let info = state.store.append_uninit().write(info);
        state.by_hash.insert(hash, Cached::Exists(info));
        info
    }

    pub(crate) fn mark_not_found(&self, hash: u64) {
        self.state.lock().by_hash.insert(hash, Cached::NotFound);
    }

    /// True if there was an entry, in any state.
    pub(crate) fn remove(&self, hash: u64) -> bool {
        self.state.lock().by_hash.remove(&hash).is_some()
    }
}
