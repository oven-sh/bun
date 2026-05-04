use core::ptr::NonNull;

use enumset::{EnumSet, EnumSetType};

use bun_alloc as allocators;
use bun_core::FeatureFlags;
use bun_sys::Fd;

use crate::fs;
use crate::package_json::PackageJSON;
use crate::tsconfig_json::TSConfigJSON;

pub type Index = allocators::IndexType;

pub struct DirInfo {
    // These objects are immutable, so we can just point to the parent directory
    // and avoid having to lock the cache again
    pub parent: Index,

    // A pointer to the enclosing dirInfo with a valid "browser" field in
    // package.json. We need this to remap paths after they have been resolved.
    pub enclosing_browser_scope: Index,
    // TODO(port): lifetime — borrowed from resolver-owned PackageJSON cache
    pub package_json_for_browser_field: Option<NonNull<PackageJSON>>,
    // TODO(port): lifetime — borrowed from resolver-owned TSConfigJSON cache
    pub enclosing_tsconfig_json: Option<NonNull<TSConfigJSON>>,

    /// package.json used for bundling
    /// it's the deepest one in the hierarchy with a "name" field
    /// or, if using `bun run`, the name field is optional
    /// https://github.com/oven-sh/bun/issues/229
    // TODO(port): lifetime — borrowed from resolver-owned PackageJSON cache
    pub enclosing_package_json: Option<NonNull<PackageJSON>>,

    // TODO(port): lifetime — borrowed from resolver-owned PackageJSON cache
    pub package_json_for_dependencies: Option<NonNull<PackageJSON>>,

    // TODO(port): lifetime — slice into BSS-backed path storage; never individually freed
    pub abs_path: &'static [u8],
    pub entries: Index,
    /// Is there a "package.json" file?
    // TODO(port): lifetime — deinit() calls .deinit() on this in-place; storage owned by resolver cache
    pub package_json: Option<NonNull<PackageJSON>>,
    /// Is there a "tsconfig.json" file in this directory or a parent directory?
    // TODO(port): lifetime — deinit() calls .deinit() on this in-place; storage owned by resolver cache
    pub tsconfig_json: Option<NonNull<TSConfigJSON>>,
    /// If non-empty, this is the real absolute path resolving any symlinks
    // TODO(port): lifetime — slice into BSS-backed path storage; never individually freed
    pub abs_real_path: &'static [u8],

    pub flags: EnumSet<Flags>,
}

impl Default for DirInfo {
    fn default() -> Self {
        Self {
            parent: allocators::NOT_FOUND,
            enclosing_browser_scope: allocators::NOT_FOUND,
            package_json_for_browser_field: None,
            enclosing_tsconfig_json: None,
            enclosing_package_json: None,
            package_json_for_dependencies: None,
            abs_path: b"",
            // PORT NOTE: Zig left this `= undefined`; using a zero-value placeholder.
            entries: Index::default(),
            package_json: None,
            tsconfig_json: None,
            abs_real_path: b"",
            flags: EnumSet::empty(),
        }
    }
}

impl DirInfo {
    /// Is there a "node_modules" subdirectory?
    #[inline]
    pub fn has_node_modules(&self) -> bool {
        self.flags.contains(Flags::HasNodeModules)
    }

    /// Is this a "node_modules" directory?
    #[inline]
    pub fn is_node_modules(&self) -> bool {
        self.flags.contains(Flags::IsNodeModules)
    }

    /// Is this inside a "node_modules" directory?
    #[inline]
    pub fn is_inside_node_modules(&self) -> bool {
        self.flags.contains(Flags::InsideNodeModules)
    }

    pub fn has_parent_package(&self) -> bool {
        let Some(parent) = self.get_parent() else {
            return false;
        };
        !parent.is_node_modules()
    }

    pub fn get_file_descriptor(&self) -> Fd {
        if FeatureFlags::STORE_FILE_DESCRIPTORS {
            if let Some(entries) = self.get_entries(0) {
                return entries.fd;
            }
        }
        Fd::INVALID
    }

    pub fn get_entries(&self, generation: bun_core::Generation) -> Option<&mut fs::FileSystem::DirEntry> {
        let Some(entries_ptr) = fs::FileSystem::instance().fs.entries_at(self.entries, generation) else {
            return None;
        };
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(entries),
            fs::EntriesOption::Err(_) => None,
        }
    }

    pub fn get_entries_const(&self) -> Option<&fs::FileSystem::DirEntry> {
        let Some(entries_ptr) = fs::FileSystem::instance().fs.entries.at_index(self.entries) else {
            return None;
        };
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(entries),
            fs::EntriesOption::Err(_) => None,
        }
    }

    pub fn get_parent(&self) -> Option<&mut DirInfo> {
        HashMap::instance().at_index(self.parent)
    }

    pub fn get_enclosing_browser_scope(&self) -> Option<&mut DirInfo> {
        HashMap::instance().at_index(self.enclosing_browser_scope)
    }
}

#[derive(EnumSetType, Debug)]
pub enum Flags {
    /// This directory is a node_modules directory
    IsNodeModules,
    /// This directory has a node_modules subdirectory
    HasNodeModules,

    InsideNodeModules,
}

impl Drop for DirInfo {
    fn drop(&mut self) {
        if let Some(p) = self.package_json.take() {
            // SAFETY: package_json points to a live PackageJSON in the resolver cache;
            // deinit() releases its owned resources in-place (storage itself is BSS/cache-owned).
            // TODO(port): revisit ownership — Zig calls p.deinit() without freeing the allocation.
            unsafe { p.as_ptr().as_mut().unwrap().deinit() };
        }
        if let Some(t) = self.tsconfig_json.take() {
            // SAFETY: tsconfig_json points to a live TSConfigJSON in the resolver cache;
            // deinit() releases its owned resources in-place.
            // TODO(port): revisit ownership — Zig calls t.deinit() without freeing the allocation.
            unsafe { t.as_ptr().as_mut().unwrap().deinit() };
        }
    }
}

// Goal: Really fast, low allocation directory map exploiting cache locality where we don't worry about lifetimes much.
// 1. Don't store the keys or values of directories that don't exist
// 2. Don't expect a provided key to exist after it's queried
// 3. Store whether a directory has been queried and whether that query was successful.
// 4. Allocate onto the https://en.wikipedia.org/wiki/.bss#BSS_in_C instead of the heap, so we can avoid memory leaks
pub type HashMap = allocators::BSSMap<DirInfo, { fs::Preallocate::Counts::DIR_ENTRY }, false, 128, true>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/resolver/dir_info.zig (128 lines)
//   confidence: medium
//   todos:      9
//   notes:      LIFETIMES.tsv had no rows; all *PackageJSON/*TSConfigJSON fields use Option<NonNull<T>> pending Phase B ownership analysis. BSSMap const-generic params and fs::EntriesOption variant names are guesses.
// ──────────────────────────────────────────────────────────────────────────
