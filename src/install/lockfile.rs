//! Lockfile — in-memory representation of bun.lock / bun.lockb
//!
//! Ported from src/install/lockfile.zig

use core::cmp::Ordering;
use core::fmt;
use core::ptr::NonNull;
use std::io::Write as _;

use bun_collections::{
    ArrayHashMap, DynamicBitSet, HashMap as BunHashMap, IdentityContext, ArrayIdentityContext,
    LinearFifo, StaticHashMap,
};
use bun_core::{err, Error as BunError, Global, Output, ConfigVersion};
use bun_alloc::AllocError;
use bun_logger as logger;
use bun_paths::{self as Path, PathBuffer, MAX_PATH_BYTES, SEP, SEP_STR};
// MOVE_DOWN(b0): bun_resolver::fs → bun_sys::fs
use bun_sys::fs::FileSystem;
use bun_semver::{self as Semver, ExternalString, String as SemverString};
use bun_sha::Hashers as Crypto;
use bun_str::{strings, ZStr};
use bun_sys::{self as sys, Fd, File};
use bun_dotenv as DotEnv;
use bun_json as JSON;

use crate::{
    self as Install, dependency::Dependency, npm as Npm, resolution::Resolution,
    DependencyID, ExternalSlice, Features, PackageID, PackageInstall, PackageManager,
    PackageNameAndVersionHash, PackageNameHash, TruncatedPackageNameHash,
    initialize_store, invalid_dependency_id, invalid_package_id,
};
use crate::package_manager::WorkspaceFilter;
use crate::migration;

// Sub-module re-exports
pub use crate::lockfile::buffers::Buffers;
pub use crate::lockfile::bun_lockb as Serializer;
pub use crate::lockfile::catalog_map::CatalogMap;
pub use crate::lockfile::override_map::OverrideMap;
pub use crate::lockfile::package::Package; // TODO(port): Zig was `Package(u64)` — generic instantiation
pub use crate::lockfile::tree::Tree;
pub use crate::lockfile::lockfile_json_stringify_for_debugging::json_stringify;
pub use crate::padding_checker::assert_no_uninitialized_padding;
use crate::lockfile::bun_lock as TextLockfile;

// ────────────────────────────────────────────────────────────────────────────
// Type aliases / collection types
// ────────────────────────────────────────────────────────────────────────────

pub type PackageIDSlice = ExternalSlice<PackageID>;
pub type DependencySlice = ExternalSlice<Dependency>;
pub type DependencyIDSlice = ExternalSlice<DependencyID>;

pub type PackageIDList = Vec<PackageID>;
pub type DependencyList = Vec<Dependency>;
pub type DependencyIDList = Vec<DependencyID>;

pub type StringBuffer = Vec<u8>;
pub type ExternalStringBuffer = Vec<ExternalString>;

pub type NameHashMap = ArrayHashMap<PackageNameHash, SemverString, ArrayIdentityContext<u64>>;
pub type TrustedDependenciesSet =
    ArrayHashMap<TruncatedPackageNameHash, (), ArrayIdentityContext<u32>>;
pub type VersionHashMap = ArrayHashMap<PackageNameHash, Semver::Version, ArrayIdentityContext<u64>>;
pub type PatchedDependenciesMap =
    ArrayHashMap<PackageNameAndVersionHash, PatchedDep, ArrayIdentityContext<u64>>;

pub type StringPool = <SemverString as bun_semver::StringExt>::Builder::StringPool;
// TODO(port): `String.Builder.StringPool` — verify path in bun_semver

pub type MetaHash = [u8; 32]; // Sha512T256.digest_length
pub const ZERO_HASH: MetaHash = [0u8; 32];

// TODO(port): std.io.FixedBufferStream([]u8) — replace with cursor over &mut [u8]
pub type Stream = bun_io::FixedBufferStream<Vec<u8>>;

pub const DEFAULT_FILENAME: &str = "bun.lockb";

// ────────────────────────────────────────────────────────────────────────────
// Lockfile struct
// ────────────────────────────────────────────────────────────────────────────

pub struct Lockfile {
    /// The version of the lockfile format, intended to prevent data corruption for format changes.
    pub format: FormatVersion,

    pub text_lockfile_version: TextLockfile::Version,

    pub meta_hash: MetaHash,

    pub packages: <Package as PackageListProvider>::List,
    // TODO(port): Lockfile.Package.List is a MultiArrayList<Package>
    pub buffers: Buffers,

    /// name -> PackageID || [*]PackageID
    /// Not for iterating.
    pub package_index: PackageIndexMap,
    pub string_pool: StringPool,
    // allocator: Allocator — dropped per PORTING.md (global mimalloc)
    pub scratch: Scratch,

    pub scripts: Scripts,
    pub workspace_paths: NameHashMap,
    pub workspace_versions: VersionHashMap,

    /// Optional because `trustedDependencies` in package.json might be an
    /// empty list or it might not exist
    pub trusted_dependencies: Option<TrustedDependenciesSet>,
    pub patched_dependencies: PatchedDependenciesMap,
    pub overrides: OverrideMap,
    pub catalogs: CatalogMap,

    pub saved_config_version: Option<ConfigVersion>,
}

// TODO(port): placeholder trait for Package::List (MultiArrayList<Package>). Phase B: use bun_collections::MultiArrayList<Package>.
pub trait PackageListProvider {
    type List;
}

// ────────────────────────────────────────────────────────────────────────────
// DepSorter
// ────────────────────────────────────────────────────────────────────────────

pub struct DepSorter<'a> {
    pub lockfile: &'a Lockfile,
}

impl<'a> DepSorter<'a> {
    pub fn is_less_than(&self, l: DependencyID, r: DependencyID) -> bool {
        let deps_buf = self.lockfile.buffers.dependencies.as_slice();
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();

        let l_dep = &deps_buf[l as usize];
        let r_dep = &deps_buf[r as usize];

        match l_dep.behavior.cmp(&r_dep.behavior) {
            Ordering::Less => true,
            Ordering::Greater => false,
            Ordering::Equal => {
                strings::order(l_dep.name.slice(string_buf), r_dep.name.slice(string_buf))
                    == Ordering::Less
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Scripts
// ────────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct Scripts {
    pub preinstall: Vec<Box<[u8]>>,
    pub install: Vec<Box<[u8]>>,
    pub postinstall: Vec<Box<[u8]>>,
    pub preprepare: Vec<Box<[u8]>>,
    pub prepare: Vec<Box<[u8]>>,
    pub postprepare: Vec<Box<[u8]>>,
}

impl Scripts {
    const MAX_PARALLEL_PROCESSES: usize = 10;

    pub const NAMES: [&'static str; 6] = [
        "preinstall",
        "install",
        "postinstall",
        "preprepare",
        "prepare",
        "postprepare",
    ];

    /// Iterate (name, &mut entries) pairs in declaration order — replaces Zig `inline for` over field names.
    fn fields_mut(&mut self) -> [(&'static str, &mut Vec<Box<[u8]>>); 6] {
        [
            ("preinstall", &mut self.preinstall),
            ("install", &mut self.install),
            ("postinstall", &mut self.postinstall),
            ("preprepare", &mut self.preprepare),
            ("prepare", &mut self.prepare),
            ("postprepare", &mut self.postprepare),
        ]
    }

    fn fields(&self) -> [(&'static str, &Vec<Box<[u8]>>); 6] {
        [
            ("preinstall", &self.preinstall),
            ("install", &self.install),
            ("postinstall", &self.postinstall),
            ("preprepare", &self.preprepare),
            ("prepare", &self.prepare),
            ("postprepare", &self.postprepare),
        ]
    }

    pub fn has_any(&self) -> bool {
        for (_, list) in self.fields() {
            if !list.is_empty() {
                return true;
            }
        }
        false
    }

    pub fn count(&self) -> usize {
        let mut res: usize = 0;
        for (_, list) in self.fields() {
            res += list.len();
        }
        res
    }
}

// `deinit` becomes `Drop` — body only frees owned fields → delete entirely; Vec<Box<[u8]>> drops automatically.

// ────────────────────────────────────────────────────────────────────────────
// LoadResult
// ────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LockfileFormat {
    Text,
    Binary,
}

impl LockfileFormat {
    pub fn filename(self) -> &'static ZStr {
        match self {
            LockfileFormat::Text => ZStr::from_static("bun.lock\0"),
            LockfileFormat::Binary => ZStr::from_static("bun.lockb\0"),
        }
        // TODO(port): verify ZStr::from_static API in bun_str
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LoadStep {
    OpenFile,
    ReadFile,
    ParseFile,
    Migrating,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Migrated {
    #[default]
    None,
    Npm,
    Yarn,
    Pnpm,
}

pub struct LoadResultErr {
    pub step: LoadStep,
    pub value: BunError,
    pub lockfile_path: &'static ZStr,
    pub format: LockfileFormat,
}

pub struct LoadResultOk<'a> {
    pub lockfile: &'a mut Lockfile,
    pub loaded_from_binary_lockfile: bool,
    pub migrated: Migrated,
    pub serializer_result: Serializer::SerializerLoadResult,
    pub format: LockfileFormat,
}

pub enum LoadResult<'a> {
    NotFound,
    Err(LoadResultErr),
    Ok(LoadResultOk<'a>),
}

impl<'a> LoadResult<'a> {
    pub fn loaded_from_text_lockfile(&self) -> bool {
        match self {
            LoadResult::NotFound => false,
            LoadResult::Err(err) => err.format == LockfileFormat::Text,
            LoadResult::Ok(ok) => ok.format == LockfileFormat::Text,
        }
    }

    pub fn loaded_from_binary_lockfile(&self) -> bool {
        match self {
            LoadResult::NotFound => false,
            LoadResult::Err(err) => err.format == LockfileFormat::Binary,
            LoadResult::Ok(ok) => ok.format == LockfileFormat::Binary,
        }
    }

    pub fn migrated_from_npm(&self) -> bool {
        match self {
            LoadResult::Ok(ok) => ok.migrated == Migrated::Npm,
            _ => false,
        }
    }

    pub fn save_format(&self, options: &PackageManager::Options) -> LockfileFormat {
        match self {
            LoadResult::NotFound => {
                // saving a lockfile for a new project. default to text lockfile
                // unless saveTextLockfile is false in bunfig
                let save_text_lockfile = options.save_text_lockfile.unwrap_or(true);
                if save_text_lockfile {
                    LockfileFormat::Text
                } else {
                    LockfileFormat::Binary
                }
            }
            LoadResult::Err(err) => {
                // an error occurred, but we still loaded from an existing lockfile
                if let Some(save_text_lockfile) = options.save_text_lockfile {
                    if save_text_lockfile {
                        return LockfileFormat::Text;
                    }
                }
                err.format
            }
            LoadResult::Ok(ok) => {
                // loaded from an existing lockfile
                if let Some(save_text_lockfile) = options.save_text_lockfile {
                    if save_text_lockfile {
                        return LockfileFormat::Text;
                    }

                    if ok.migrated != Migrated::None {
                        return LockfileFormat::Binary;
                    }
                }

                if ok.migrated != Migrated::None {
                    return LockfileFormat::Text;
                }

                ok.format
            }
        }
    }

    /// configVersion and boolean for if the configVersion previously existed/needs to be saved to lockfile
    pub fn choose_config_version(&self) -> (ConfigVersion, bool) {
        match self {
            LoadResult::NotFound | LoadResult::Err(_) => (ConfigVersion::Current, true),
            LoadResult::Ok(ok) => match ok.migrated {
                Migrated::None => {
                    if let Some(config_version) = ok.lockfile.saved_config_version {
                        return (config_version, false);
                    }

                    // existing bun project without configVersion
                    (ConfigVersion::V0, true)
                }
                Migrated::Pnpm => (ConfigVersion::V1, true),
                Migrated::Npm => (ConfigVersion::V0, true),
                Migrated::Yarn => (ConfigVersion::V0, true),
            },
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// InstallResult
// ────────────────────────────────────────────────────────────────────────────

pub struct InstallResult {
    pub lockfile: Option<NonNull<Lockfile>>,
    // TODO(port): lifetime — no construction sites found in src/install/
    pub summary: PackageInstall::Summary,
}

// ────────────────────────────────────────────────────────────────────────────
// Lockfile impl — load / clone / hoist / etc.
// ────────────────────────────────────────────────────────────────────────────

impl Lockfile {
    pub fn is_empty(&self) -> bool {
        self.packages.len() == 0
            || (self.packages.len() == 1 && self.packages.get(0).resolutions.len == 0)
    }

    pub fn load_from_cwd<'a, const ATTEMPT_LOADING_FROM_OTHER_LOCKFILE: bool>(
        &'a mut self,
        manager: Option<&mut PackageManager>,
        log: &mut logger::Log,
    ) -> LoadResult<'a> {
        self.load_from_dir::<ATTEMPT_LOADING_FROM_OTHER_LOCKFILE>(Fd::cwd(), manager, log)
    }

    pub fn load_from_dir<'a, const ATTEMPT_LOADING_FROM_OTHER_LOCKFILE: bool>(
        &'a mut self,
        dir: Fd,
        manager: Option<&mut PackageManager>,
        log: &mut logger::Log,
    ) -> LoadResult<'a> {
        if cfg!(debug_assertions) {
            debug_assert!(FileSystem::instance_loaded());
        }

        let mut lockfile_format = LockfileFormat::Text;
        let file = 'file: {
            match File::openat(dir, b"bun.lock", sys::O::RDONLY, 0).unwrap_result() {
                Ok(f) => break 'file f,
                Err(text_open_err) => {
                    if text_open_err != err!("ENOENT") {
                        return LoadResult::Err(LoadResultErr {
                            step: LoadStep::OpenFile,
                            value: text_open_err.into(),
                            lockfile_path: ZStr::from_static("bun.lock\0"),
                            format: LockfileFormat::Text,
                        });
                    }

                    lockfile_format = LockfileFormat::Binary;

                    match File::openat(dir, b"bun.lockb", sys::O::RDONLY, 0).unwrap_result() {
                        Ok(f) => break 'file f,
                        Err(binary_open_err) => {
                            if binary_open_err != err!("ENOENT") {
                                return LoadResult::Err(LoadResultErr {
                                    step: LoadStep::OpenFile,
                                    value: binary_open_err.into(),
                                    lockfile_path: ZStr::from_static("bun.lockb\0"),
                                    format: LockfileFormat::Binary,
                                });
                            }

                            if ATTEMPT_LOADING_FROM_OTHER_LOCKFILE {
                                if let Some(pm) = manager {
                                    let migrate_result =
                                        migration::detect_and_load_other_lockfile(
                                            self, dir, pm, log,
                                        );

                                    if matches!(migrate_result, LoadResult::Ok(_)) {
                                        // lockfile_format = .text — note: local mutation has no
                                        // observable effect after return; preserved for parity.
                                        let _ = LockfileFormat::Text;
                                    }

                                    return migrate_result;
                                }
                            }

                            return LoadResult::NotFound;
                        }
                    }
                }
            }
        };

        let buf = match file.read_to_end().unwrap_result() {
            Ok(b) => b,
            Err(e) => {
                return LoadResult::Err(LoadResultErr {
                    step: LoadStep::ReadFile,
                    value: e.into(),
                    lockfile_path: if lockfile_format == LockfileFormat::Text {
                        ZStr::from_static("bun.lock\0")
                    } else {
                        ZStr::from_static("bun.lockb\0")
                    },
                    format: lockfile_format,
                });
            }
        };

        if lockfile_format == LockfileFormat::Text {
            let source = logger::Source::init_path_string(b"bun.lock", &buf);
            initialize_store();
            let json = match JSON::parse_package_json_utf8(&source, log) {
                Ok(j) => j,
                Err(e) => {
                    return LoadResult::Err(LoadResultErr {
                        step: LoadStep::ParseFile,
                        value: e,
                        lockfile_path: ZStr::from_static("bun.lock\0"),
                        format: lockfile_format,
                    });
                }
            };

            if let Err(e) =
                TextLockfile::parse_into_binary_lockfile(self, json, &source, log, manager)
            {
                if e == err!("OutOfMemory") {
                    bun_core::out_of_memory();
                }
                return LoadResult::Err(LoadResultErr {
                    step: LoadStep::ParseFile,
                    value: e,
                    lockfile_path: ZStr::from_static("bun.lock\0"),
                    format: lockfile_format,
                });
            }

            bun_core::analytics::Features::text_lockfile_inc(1);

            return LoadResult::Ok(LoadResultOk {
                lockfile: self,
                serializer_result: Serializer::SerializerLoadResult::default(),
                loaded_from_binary_lockfile: false,
                migrated: Migrated::None,
                format: lockfile_format,
            });
        }

        let result = self.load_from_bytes(manager.as_deref_mut(), buf, log);
        // TODO(port): borrowck — `self` is reborrowed inside `result` via &'a mut Lockfile.
        // PORT NOTE: reshaped for borrowck — the debug round-trip block below mutates `self`
        // through `result.ok.lockfile` which already holds the &mut.

        if let LoadResult::Ok(ok) = &result {
            if bun_core::env_var::BUN_DEBUG_TEST_TEXT_LOCKFILE.get() && manager.is_some() {
                // Convert the loaded binary lockfile into a text lockfile in memory, then
                // parse it back into a binary lockfile.

                let mut writer_buf: Vec<u8> = Vec::new();

                if let Err(e) = TextLockfile::Stringifier::save_from_binary(
                    ok.lockfile,
                    &result,
                    &manager.as_ref().unwrap().options,
                    &mut writer_buf,
                ) {
                    Output::panic(
                        format_args!("failed to convert binary lockfile to text lockfile: {}", e.name()),
                    );
                }

                let text_lockfile_bytes = writer_buf;

                let source = logger::Source::init_path_string(b"bun.lock", &text_lockfile_bytes);
                initialize_store();
                let json = match JSON::parse_package_json_utf8(&source, log) {
                    Ok(j) => j,
                    Err(e) => Output::panic(format_args!(
                        "failed to print valid json from binary lockfile: {}",
                        e.name()
                    )),
                };

                if let Err(e) = TextLockfile::parse_into_binary_lockfile(
                    ok.lockfile, // TODO(port): borrowck — was `this` in Zig; aliases ok.lockfile
                    json,
                    &source,
                    log,
                    manager,
                ) {
                    Output::panic(format_args!(
                        "failed to parse text lockfile converted from binary lockfile: {}",
                        e.name()
                    ));
                }

                bun_core::analytics::Features::text_lockfile_inc(1);
            }
        }

        result
    }

    pub fn load_from_bytes<'a>(
        &'a mut self,
        pm: Option<&mut PackageManager>,
        buf: Vec<u8>,
        log: &mut logger::Log,
    ) -> LoadResult<'a> {
        let mut stream = Stream::new(buf);
        // TODO(port): Stream{ .buffer = buf, .pos = 0 }

        self.format = FormatVersion::current();
        self.scripts = Scripts::default();
        self.trusted_dependencies = None;
        self.workspace_paths = NameHashMap::default();
        self.workspace_versions = VersionHashMap::default();
        self.overrides = OverrideMap::default();
        self.catalogs = CatalogMap::default();
        self.patched_dependencies = PatchedDependenciesMap::default();

        let load_result = match Serializer::load(self, &mut stream, log, pm) {
            Ok(r) => r,
            Err(e) => {
                return LoadResult::Err(LoadResultErr {
                    step: LoadStep::ParseFile,
                    value: e,
                    lockfile_path: ZStr::from_static("bun.lockb\0"),
                    format: LockfileFormat::Binary,
                });
            }
        };

        if cfg!(debug_assertions) {
            self.verify_data().expect("lockfile data is corrupt");
        }

        LoadResult::Ok(LoadResultOk {
            lockfile: self,
            serializer_result: load_result,
            loaded_from_binary_lockfile: true,
            migrated: Migrated::None,
            format: LockfileFormat::Binary,
        })
    }

    pub fn is_resolved_dependency_disabled(
        &self,
        dep_id: DependencyID,
        features: Features,
        meta: &Package::Meta,
        cpu: Npm::Architecture,
        os: Npm::OperatingSystem,
    ) -> bool {
        if meta.is_disabled(cpu, os) {
            return true;
        }

        let dep = self.buffers.dependencies[dep_id as usize];

        dep.behavior.is_bundled() || !dep.behavior.is_enabled(features)
    }

    /// This conditionally clones the lockfile with root packages marked as non-resolved
    /// that do not satisfy `Features`. The package may still end up installed even
    /// if it was e.g. in "devDependencies" and its a production install. In that case,
    /// it would be installed because another dependency or transient dependency needed it.
    ///
    /// Warning: This potentially modifies the existing lockfile in-place. That is
    /// safe to do because at this stage, the lockfile has already been saved to disk.
    /// Our in-memory representation is all that's left.
    pub fn maybe_clone_filtering_root_packages(
        old: &mut Lockfile,
        manager: &mut PackageManager,
        features: Features,
        exact_versions: bool,
        log_level: PackageManager::Options::LogLevel,
    ) -> Result<&mut Lockfile, BunError> {
        // TODO(port): narrow error set
        let old_packages = old.packages.slice();
        let old_dependencies_lists = old_packages.items_dependencies();
        let old_resolutions_lists = old_packages.items_resolutions();
        let old_resolutions = old_packages.items_resolution();
        let mut any_changes = false;
        let end: PackageID = old.packages.len() as PackageID; // @truncate

        // set all disabled dependencies of workspaces to `invalid_package_id`
        for package_id in 0..end as usize {
            if package_id != 0 && old_resolutions[package_id].tag != Resolution::Tag::Workspace {
                continue;
            }

            let old_workspace_dependencies_list = old_dependencies_lists[package_id];
            let old_workspace_resolutions_list = old_resolutions_lists[package_id];

            let old_workspace_dependencies =
                old_workspace_dependencies_list.get(old.buffers.dependencies.as_slice());
            let old_workspace_resolutions =
                old_workspace_resolutions_list.get_mut(old.buffers.resolutions.as_mut_slice());

            debug_assert_eq!(
                old_workspace_dependencies.len(),
                old_workspace_resolutions.len()
            );
            for (dependency, resolution) in old_workspace_dependencies
                .iter()
                .zip(old_workspace_resolutions.iter_mut())
            {
                if !dependency.behavior.is_enabled(features) && *resolution < end {
                    *resolution = invalid_package_id;
                    any_changes = true;
                }
            }
        }

        if !any_changes {
            return Ok(old);
        }

        old.clean(manager, &mut [], exact_versions, log_level)
    }

    fn preprocess_update_requests(
        old: &mut Lockfile,
        manager: &mut PackageManager,
        updates: &mut [PackageManager::UpdateRequest],
        exact_versions: bool,
    ) -> Result<(), BunError> {
        // TODO(port): narrow error set
        let workspace_package_id = manager
            .root_package_id
            .get(old, manager.workspace_name_hash);
        let root_deps_list: DependencySlice =
            old.packages.items_dependencies()[workspace_package_id as usize];

        if (root_deps_list.off as usize) < old.buffers.dependencies.len() {
            let mut string_builder = old.string_builder();

            {
                let root_deps: &[Dependency] =
                    root_deps_list.get(old.buffers.dependencies.as_slice());
                let old_resolutions_list =
                    old.packages.items_resolutions()[workspace_package_id as usize];
                let old_resolutions: &[PackageID] =
                    old_resolutions_list.get(old.buffers.resolutions.as_slice());
                let resolutions_of_yore: &[Resolution] = old.packages.items_resolution();

                for update in updates.iter() {
                    if update.package_id == invalid_package_id {
                        debug_assert_eq!(root_deps.len(), old_resolutions.len());
                        for (dep, &old_resolution) in root_deps.iter().zip(old_resolutions.iter()) {
                            if dep.name_hash == SemverString::Builder::string_hash(update.name()) {
                                if old_resolution as usize >= old.packages.len() {
                                    continue;
                                }
                                let res = resolutions_of_yore[old_resolution as usize];
                                if res.tag != Resolution::Tag::Npm
                                    || update.version.tag != Dependency::Version::Tag::DistTag
                                {
                                    continue;
                                }

                                // TODO(dylan-conway): this will need to handle updating dependencies (exact, ^, or ~) and aliases

                                // PORT NOTE: Zig's `switch (exact_versions) { else => |exact| ... }` is just a
                                // way to capture a comptime-ish bool; in Rust we use it directly.
                                let len = bun_core::fmt::count(format_args!(
                                    "{}{}",
                                    if exact_versions { "" } else { "^" },
                                    res.value.npm.version.fmt(old.buffers.string_bytes.as_slice()),
                                ));

                                if len >= SemverString::MAX_INLINE_LEN {
                                    string_builder.cap += len;
                                }
                            }
                        }
                    }
                }
            }

            string_builder.allocate()?;
            let _clamp = scopeguard::guard((), |_| string_builder.clamp());
            // TODO(port): errdefer — `defer string_builder.clamp()` was unconditional in Zig.
            // PORT NOTE: reshaped for borrowck — string_builder borrows `old` mutably; the
            // following block also needs &mut access to old.buffers.dependencies. Phase B may
            // need to split borrows.

            {
                let mut temp_buf = [0u8; 513];

                let root_deps: &mut [Dependency] =
                    root_deps_list.get_mut(old.buffers.dependencies.as_mut_slice());
                let old_resolutions_list_lists = old.packages.items_resolutions();
                let old_resolutions_list = old_resolutions_list_lists[workspace_package_id as usize];
                let old_resolutions: &[PackageID] =
                    old_resolutions_list.get(old.buffers.resolutions.as_slice());
                let resolutions_of_yore: &[Resolution] = old.packages.items_resolution();

                for update in updates.iter_mut() {
                    if update.package_id == invalid_package_id {
                        debug_assert_eq!(root_deps.len(), old_resolutions.len());
                        for (dep, &old_resolution) in
                            root_deps.iter_mut().zip(old_resolutions.iter())
                        {
                            if dep.name_hash == SemverString::Builder::string_hash(update.name()) {
                                if old_resolution as usize >= old.packages.len() {
                                    continue;
                                }
                                let res = resolutions_of_yore[old_resolution as usize];
                                if res.tag != Resolution::Tag::Npm
                                    || update.version.tag != Dependency::Version::Tag::DistTag
                                {
                                    continue;
                                }

                                // TODO(dylan-conway): this will need to handle updating dependencies (exact, ^, or ~) and aliases

                                let buf = {
                                    let mut cursor: &mut [u8] = &mut temp_buf[..];
                                    let start_len = cursor.len();
                                    if write!(
                                        cursor,
                                        "{}{}",
                                        if exact_versions { "" } else { "^" },
                                        res.value
                                            .npm
                                            .version
                                            .fmt(old.buffers.string_bytes.as_slice()),
                                    )
                                    .is_err()
                                    {
                                        // Zig: `catch break` — breaks the inner for-loop.
                                        break;
                                    }
                                    let written = start_len - cursor.len();
                                    &temp_buf[..written]
                                };

                                let external_version =
                                    string_builder.append::<ExternalString>(buf);
                                let sliced = external_version
                                    .value
                                    .sliced(old.buffers.string_bytes.as_slice());
                                dep.version = Dependency::parse(
                                    dep.name,
                                    dep.name_hash,
                                    sliced.slice,
                                    &sliced,
                                    None,
                                    manager,
                                )
                                .unwrap_or_default();
                            }
                        }
                    }

                    update.e_string = None;
                }
            }
        }
        Ok(())
    }

    pub fn clean(
        old: &mut Lockfile,
        manager: &mut PackageManager,
        updates: &mut [PackageManager::UpdateRequest],
        exact_versions: bool,
        log_level: PackageManager::Options::LogLevel,
    ) -> Result<&mut Lockfile, BunError> {
        // TODO(port): narrow error set
        // This is wasteful, but we rarely log anything so it's fine.
        let mut log = logger::Log::init();
        // defer { for (...) item.deinit(); log.deinit(); } — handled by Drop

        old.clean_with_logger(manager, updates, &mut log, exact_versions, log_level)
    }

    pub fn resolve_catalog_dependency(&self, dep: &Dependency) -> Option<Dependency::Version> {
        if dep.version.tag != Dependency::Version::Tag::Catalog {
            return Some(dep.version);
        }

        let catalog_dep = self
            .catalogs
            .get(self, dep.version.value.catalog, dep.name)?;

        Some(catalog_dep.version)
    }

    /// Is this a direct dependency of the workspace root package.json?
    pub fn is_workspace_root_dependency(&self, id: DependencyID) -> bool {
        self.packages.items_dependencies()[0].contains(id)
    }

    /// Is this a direct dependency of the workspace the install is taking place in?
    pub fn is_root_dependency(&self, manager: &PackageManager, id: DependencyID) -> bool {
        self.packages.items_dependencies()
            [manager.root_package_id.get(self, manager.workspace_name_hash) as usize]
            .contains(id)
    }

    /// Is this a direct dependency of any workspace (including workspace root)?
    /// TODO make this faster by caching the workspace package ids
    pub fn is_workspace_dependency(&self, id: DependencyID) -> bool {
        self.get_workspace_pkg_if_workspace_dep(id) != invalid_package_id
    }

    pub fn get_workspace_pkg_if_workspace_dep(&self, id: DependencyID) -> PackageID {
        let packages = self.packages.slice();
        let resolutions = packages.items_resolution();
        let dependencies_lists = packages.items_dependencies();
        for (pkg_id, (resolution, dependencies)) in
            resolutions.iter().zip(dependencies_lists.iter()).enumerate()
        {
            if resolution.tag != Resolution::Tag::Workspace
                && resolution.tag != Resolution::Tag::Root
            {
                continue;
            }
            if dependencies.contains(id) {
                return PackageID::try_from(pkg_id).unwrap();
            }
        }

        invalid_package_id
    }

    /// Does this tree id belong to a workspace (including workspace root)?
    /// TODO(dylan-conway) fix!
    pub fn is_workspace_tree_id(&self, id: Tree::Id) -> bool {
        id == 0
            || self.buffers.dependencies
                [self.buffers.trees[id as usize].dependency_id as usize]
                .behavior
                .is_workspace()
    }

    /// Returns the package id of the workspace the install is taking place in.
    pub fn get_workspace_package_id(&self, workspace_name_hash: Option<PackageNameHash>) -> PackageID {
        if let Some(workspace_name_hash_) = workspace_name_hash {
            let packages = self.packages.slice();
            let name_hashes = packages.items_name_hash();
            let resolutions = packages.items_resolution();
            for (i, (res, name_hash)) in resolutions.iter().zip(name_hashes.iter()).enumerate() {
                if res.tag == Resolution::Tag::Workspace && *name_hash == workspace_name_hash_ {
                    return PackageID::try_from(i).unwrap();
                }
            }

            // should not hit this, default to root just in case
            0
        } else {
            0
        }
    }

    pub fn clean_with_logger(
        old: &mut Lockfile,
        manager: &mut PackageManager,
        updates: &mut [PackageManager::UpdateRequest],
        log: &mut logger::Log,
        exact_versions: bool,
        log_level: PackageManager::Options::LogLevel,
    ) -> Result<&mut Lockfile, BunError> {
        // TODO(port): narrow error set
        let mut timer = bun_core::Timer::default();
        if log_level.is_verbose() {
            timer = bun_core::Timer::start()?;
        }

        let old_trusted_dependencies = old.trusted_dependencies.take();
        let old_scripts = core::mem::take(&mut old.scripts);
        // We will only shrink the number of packages here.
        // never grow

        // preinstall_state is used during installPackages. the indexes(package ids) need
        // to be remapped. Also ensure `preinstall_state` has enough capacity to contain
        // all packages. It's possible it doesn't because non-npm packages do not use
        // preinstall state before linking stage.
        manager.ensure_preinstall_state_list_capacity(old.packages.len());
        let preinstall_state = &mut manager.preinstall_state;
        let old_preinstall_state = preinstall_state.clone();
        preinstall_state.fill(Install::PreinstallState::Unknown);

        if !updates.is_empty() {
            old.preprocess_update_requests(manager, updates, exact_versions)?;
        }

        let new: &mut Lockfile = Box::leak(Box::new(Lockfile::init_empty_value()));
        // TODO(port): Zig allocates via `old.allocator.create(Lockfile)`; ownership is
        // returned to caller. In Rust, return type should likely be Box<Lockfile> in Phase B.
        new.string_pool.ensure_total_capacity(old.string_pool.capacity())?;
        new.package_index
            .ensure_total_capacity(old.package_index.capacity())?;
        new.packages.ensure_total_capacity(old.packages.len())?;
        new.buffers.preallocate(&old.buffers)?;
        new.patched_dependencies
            .ensure_total_capacity(old.patched_dependencies.entries.len())?;

        old.scratch.dependency_list_queue.head = 0;

        {
            let mut builder = new.string_builder();
            old.overrides.count(old, &mut builder);
            old.catalogs.count(old, &mut builder);
            builder.allocate()?;
            new.overrides = old.overrides.clone(manager, old, new, &mut builder)?;
            new.catalogs = old.catalogs.clone(manager, old, new, &mut builder)?;
        }

        // Step 1. Recreate the lockfile with only the packages that are still alive
        let root = old.root_package().ok_or(err!("NoPackage"))?;

        let mut package_id_mapping = vec![invalid_package_id; old.packages.len()];
        let clone_queue_ = PendingResolutions::new();
        let mut cloner = Cloner {
            old,
            lockfile: new,
            mapping: &mut package_id_mapping,
            clone_queue: clone_queue_,
            log,
            old_preinstall_state,
            manager,
            trees: Tree::List::default(),
            trees_count: 1,
        };

        // try clone_queue.ensureUnusedCapacity(root.dependencies.len);
        let _ = root.clone(manager, old, new, &mut package_id_mapping, &mut cloner)?;
        // TODO(port): borrowck — cloner already borrows old/new/mapping/manager mutably.

        // Clone workspace_paths and workspace_versions at the end.
        if old.workspace_paths.count() > 0 || old.workspace_versions.count() > 0 {
            new.workspace_paths
                .ensure_total_capacity(old.workspace_paths.count())?;
            new.workspace_versions
                .ensure_total_capacity(old.workspace_versions.count())?;

            let mut workspace_paths_builder = new.string_builder();

            // Sort by name for determinism
            // PORT NOTE: Zig defines a local `WorkspacePathSorter` struct; in Rust we use a closure.
            {
                let string_buf = old.buffers.string_bytes.as_slice();
                let entries = &old.workspace_paths.entries;
                old.workspace_paths.sort_by(|a, b| {
                    let left = entries.items_value()[a];
                    let right = entries.items_value()[b];
                    strings::order(left.slice(string_buf), right.slice(string_buf))
                });
                // TODO(port): ArrayHashMap::sort API — Zig sort takes (a: usize, b: usize) -> bool.
            }

            for path in old.workspace_paths.values() {
                workspace_paths_builder.count(old.str(path));
            }
            let versions: &[Semver::Version] = old.workspace_versions.values();
            for version in versions {
                version.count(
                    old.buffers.string_bytes.as_slice(),
                    &mut workspace_paths_builder,
                );
            }

            workspace_paths_builder.allocate()?;

            new.workspace_paths.entries.set_len(old.workspace_paths.entries.len());
            // TODO(port): set_len semantics on ArrayHashMap entries

            debug_assert_eq!(
                old.workspace_paths.values().len(),
                new.workspace_paths.values().len()
            );
            for (src, dest) in old
                .workspace_paths
                .values()
                .iter()
                .zip(new.workspace_paths.values_mut().iter_mut())
            {
                *dest = workspace_paths_builder.append::<SemverString>(old.str(src));
            }
            new.workspace_paths
                .keys_mut()
                .copy_from_slice(old.workspace_paths.keys());

            new.workspace_versions
                .ensure_total_capacity(old.workspace_versions.count())?;
            new.workspace_versions
                .entries
                .set_len(old.workspace_versions.entries.len());
            for (src, dest) in versions
                .iter()
                .zip(new.workspace_versions.values_mut().iter_mut())
            {
                *dest = src.append(
                    old.buffers.string_bytes.as_slice(),
                    &mut workspace_paths_builder,
                );
            }

            new.workspace_versions
                .keys_mut()
                .copy_from_slice(old.workspace_versions.keys());

            workspace_paths_builder.clamp();

            new.workspace_versions.re_index()?;
            new.workspace_paths.re_index()?;
        }

        // When you run `"bun add react"
        // This is where we update it in the lockfile from "latest" to "^17.0.2"
        cloner.flush()?;

        new.trusted_dependencies = old_trusted_dependencies;
        new.scripts = old_scripts;
        new.meta_hash = old.meta_hash;

        {
            let mut builder = new.string_builder();
            for patched_dep in old.patched_dependencies.values() {
                builder.count(patched_dep.path.slice(old.buffers.string_bytes.as_slice()));
            }
            builder.allocate()?;
            for (k, v) in old
                .patched_dependencies
                .keys()
                .iter()
                .zip(old.patched_dependencies.values().iter())
            {
                debug_assert!(!v.patchfile_hash_is_null);
                let mut patchdep = *v;
                patchdep.path = builder
                    .append::<SemverString>(patchdep.path.slice(old.buffers.string_bytes.as_slice()));
                new.patched_dependencies.put(*k, patchdep)?;
            }
        }

        // Don't allow invalid memory to happen
        if !updates.is_empty() {
            let string_buf = new.buffers.string_bytes.as_slice();
            let slice = new.packages.slice();

            // updates might be applied to the root package.json or one
            // of the workspace package.json files.
            let workspace_package_id = manager
                .root_package_id
                .get(new, manager.workspace_name_hash);

            let dep_list = slice.items_dependencies()[workspace_package_id as usize];
            let res_list = slice.items_resolutions()[workspace_package_id as usize];
            let workspace_deps: &[Dependency] = dep_list.get(new.buffers.dependencies.as_slice());
            let resolved_ids: &[PackageID] = res_list.get(new.buffers.resolutions.as_slice());

            'request_updated: for update in updates.iter_mut() {
                if update.package_id == invalid_package_id {
                    debug_assert_eq!(resolved_ids.len(), workspace_deps.len());
                    for (&package_id, dep) in resolved_ids.iter().zip(workspace_deps.iter()) {
                        if update.matches(dep, string_buf) {
                            if package_id as usize > new.packages.len() {
                                continue;
                            }
                            update.version_buf = string_buf;
                            // TODO(port): version_buf is a borrowed slice into new.buffers — lifetime hazard
                            update.version = dep.version;
                            update.package_id = package_id;

                            continue 'request_updated;
                        }
                    }
                }
            }
        }

        if log_level.is_verbose() {
            Output::pretty_errorln(format_args!(
                "Clean lockfile: {} packages -> {} packages in {}\n",
                old.packages.len(),
                new.packages.len(),
                bun_core::fmt::fmt_duration_one_decimal(timer.read()),
            ));
        }

        Ok(new)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// MetaHashFormatter
// ────────────────────────────────────────────────────────────────────────────

pub struct MetaHashFormatter<'a> {
    pub meta_hash: &'a MetaHash,
}

impl<'a> fmt::Display for MetaHashFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let remain: &[u8] = &self.meta_hash[..];

        // {X}-{x}-{X}-{x} — Zig's `{X}` on a slice prints uppercase hex, `{x}` lowercase.
        // TODO(port): verify byte-slice hex formatting matches Zig std.fmt exactly.
        write!(
            f,
            "{}-{}-{}-{}",
            bun_core::fmt::HexUpper(&remain[0..8]),
            bun_core::fmt::HexLower(&remain[8..16]),
            bun_core::fmt::HexUpper(&remain[16..24]),
            bun_core::fmt::HexLower(&remain[24..32]),
        )
    }
}

impl Lockfile {
    pub fn fmt_meta_hash(&self) -> MetaHashFormatter<'_> {
        MetaHashFormatter {
            meta_hash: &self.meta_hash,
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Cloner
// ────────────────────────────────────────────────────────────────────────────

pub struct Cloner<'a> {
    pub clone_queue: PendingResolutions,
    pub lockfile: &'a mut Lockfile,
    pub old: &'a mut Lockfile,
    pub mapping: &'a mut [PackageID],
    pub trees: Tree::List,
    pub trees_count: u32,
    pub log: &'a mut logger::Log,
    pub old_preinstall_state: Vec<Install::PreinstallState>,
    pub manager: &'a mut PackageManager,
}

impl<'a> Cloner<'a> {
    pub fn flush(&mut self) -> Result<(), BunError> {
        let max_package_id = self.old.packages.len();
        while let Some(to_clone) = self.clone_queue.pop() {
            let mapping = self.mapping[to_clone.old_resolution as usize];
            if (mapping as usize) < max_package_id {
                self.lockfile.buffers.resolutions[to_clone.resolve_id as usize] = mapping;
                continue;
            }

            let old_package = self.old.packages.get(to_clone.old_resolution as usize);

            self.lockfile.buffers.resolutions[to_clone.resolve_id as usize] = old_package.clone(
                self.manager,
                self.old,
                self.lockfile,
                self.mapping,
                self,
            )?;
            // TODO(port): borrowck — passes self plus disjoint &mut fields of self
        }

        // cloning finished, items in lockfile buffer might have a different order, meaning
        // package ids and dependency ids have changed
        self.manager.clear_cached_items_depending_on_lockfile_buffer();

        if self.lockfile.packages.len() != 0 {
            self.lockfile.resolve(self.log)?;
        }

        // capacity is used for calculating byte size
        // so we need to make sure it's exact
        if self.lockfile.packages.capacity() != self.lockfile.packages.len()
            && self.lockfile.packages.len() > 0
        {
            self.lockfile
                .packages
                .shrink_and_free(self.lockfile.packages.len());
        }
        Ok(())
    }
}

// ────────────────────────────────────────────────────────────────────────────
// resolve / filter / hoist
// ────────────────────────────────────────────────────────────────────────────

impl Lockfile {
    pub fn resolve(&mut self, log: &mut logger::Log) -> Result<(), Tree::SubtreeError> {
        self.hoist::<{ Tree::BuilderMethod::Resolvable }>(log, (), (), (), ())
    }

    pub fn filter(
        &mut self,
        log: &mut logger::Log,
        manager: &mut PackageManager,
        install_root_dependencies: bool,
        workspace_filters: &[WorkspaceFilter],
        packages_to_install: Option<&[PackageID]>,
    ) -> Result<(), Tree::SubtreeError> {
        self.hoist::<{ Tree::BuilderMethod::Filter }>(
            log,
            manager,
            install_root_dependencies,
            workspace_filters,
            packages_to_install,
        )
    }

    /// Sets `buffers.trees` and `buffers.hoisted_dependencies`
    // TODO(port): Zig uses `comptime method` to make several params conditionally `void`.
    // Rust const-generic enums need #[derive(ConstParamTy)] on Tree::BuilderMethod and the
    // value-level branching can't change param types. Phase B may want two monomorphized fns.
    pub fn hoist<const METHOD: Tree::BuilderMethod>(
        &mut self,
        log: &mut logger::Log,
        manager: impl Tree::MaybeManager<METHOD>,
        install_root_dependencies: impl Tree::MaybeBool<METHOD>,
        workspace_filters: impl Tree::MaybeWorkspaceFilters<METHOD>,
        packages_to_install: impl Tree::MaybePackagesToInstall<METHOD>,
    ) -> Result<(), Tree::SubtreeError> {
        let slice = self.packages.slice();

        let mut builder = Tree::Builder::<METHOD> {
            queue: Tree::BuilderQueue::init(),
            resolution_lists: slice.items_resolutions(),
            resolutions: self.buffers.resolutions.as_slice(),
            dependencies: self.buffers.dependencies.as_slice(),
            log,
            lockfile: self,
            manager,
            install_root_dependencies,
            workspace_filters,
            packages_to_install,
            pending_optional_peers: Tree::PendingOptionalPeers::init(),
            ..Default::default()
        };
        // TODO(port): Tree::Builder field set may differ; verify in Phase B.

        Tree::default().process_subtree(
            Tree::ROOT_DEP_ID,
            Tree::INVALID_ID,
            &mut builder,
        )?;

        // This goes breadth-first
        while let Some(item) = builder.queue.read_item() {
            // PORT NOTE: reshaped for borrowck — Zig indexes builder.list while passing &mut builder.
            let tree = builder.list.items_tree()[item.tree_id as usize];
            tree.process_subtree(item.dependency_id, item.hoist_root_id, &mut builder)?;
            // TODO(port): `tree` may need to be a reference into builder.list, not a copy.
        }

        let cleaned = builder.clean()?;
        self.buffers.trees = cleaned.trees;
        self.buffers.hoisted_dependencies = cleaned.dep_ids;
        Ok(())
    }
}

#[derive(Clone, Copy)]
pub struct PendingResolution {
    pub old_resolution: PackageID,
    pub resolve_id: PackageID,
    pub parent: PackageID,
}

pub type PendingResolutions = Vec<PendingResolution>;

// ────────────────────────────────────────────────────────────────────────────
// fetchNecessaryPackageMetadataAfterYarnOrPnpmMigration
// ────────────────────────────────────────────────────────────────────────────

impl Lockfile {
    pub fn fetch_necessary_package_metadata_after_yarn_or_pnpm_migration<
        const UPDATE_OS_CPU: bool,
    >(
        &mut self,
        manager: &mut PackageManager,
    ) -> Result<(), AllocError> {
        if manager.populate_manifest_cache(Install::ManifestCacheMode::All).is_err() {
            return Ok(());
        }

        let pkgs = self.packages.slice();

        let pkg_names = pkgs.items_name();
        let pkg_name_hashes = pkgs.items_name_hash();
        let pkg_resolutions = pkgs.items_resolution();
        let pkg_bins = pkgs.items_bin_mut();
        // TODO(port): MultiArrayList simultaneous mutable column access

        // PORT NOTE: Zig has two near-identical loops gated by `update_os_cpu`. We branch
        // on the const generic but cannot conditionally bind `pkg_metas` to `undefined`, so
        // we use Option.
        let pkg_metas = if UPDATE_OS_CPU {
            Some(pkgs.items_meta_mut())
        } else {
            None
        };

        for i in 0..pkg_names.len() {
            let pkg_name = pkg_names[i];
            let pkg_name_hash = pkg_name_hashes[i];
            let pkg_res = pkg_resolutions[i];
            let pkg_bin = &mut pkg_bins[i];

            match pkg_res.tag {
                Resolution::Tag::Npm => {
                    let Some(manifest) = manager.manifests.by_name_hash(
                        manager,
                        manager.scope_for_package_name(
                            pkg_name.slice(self.buffers.string_bytes.as_slice()),
                        ),
                        pkg_name_hash,
                        Install::ManifestLoad::LoadFromMemoryFallbackToDisk,
                        false,
                    ) else {
                        continue;
                    };

                    let Some(pkg) = manifest.find_by_version(pkg_res.value.npm.version) else {
                        continue;
                    };

                    let mut builder = manager.lockfile.string_builder();

                    let mut bin_extern_strings_count: u32 = 0;

                    bin_extern_strings_count += pkg.package.bin.count(
                        manifest.string_buf,
                        manifest.extern_strings_bin_entries,
                        &mut builder,
                    );

                    builder.allocate()?;
                    let _clamp = scopeguard::guard((), |_| builder.clamp());
                    // TODO(port): defer builder.clamp() — scopeguard captures &mut builder

                    let extern_strings_list = &mut manager.lockfile.buffers.extern_strings;
                    extern_strings_list.reserve(bin_extern_strings_count as usize);
                    // PERF(port): was ensureUnusedCapacity
                    let new_len = extern_strings_list.len() + bin_extern_strings_count as usize;
                    // SAFETY: reserved above; bin.clone fills the new tail.
                    unsafe { extern_strings_list.set_len(new_len) };
                    let start = new_len - bin_extern_strings_count as usize;
                    let (all, _) = extern_strings_list.split_at_mut(new_len);
                    let extern_strings = &mut all[start..];

                    *pkg_bin = pkg.package.bin.clone(
                        manifest.string_buf,
                        manifest.extern_strings_bin_entries,
                        all,
                        extern_strings,
                        &mut builder,
                    );
                    // TODO(port): borrowck — `all` and `extern_strings` overlap; Zig passes
                    // both items.ptr-based slices. Phase B may need raw pointers.

                    if UPDATE_OS_CPU {
                        let pkg_meta = &mut pkg_metas.as_mut().unwrap()[i];
                        // Update os/cpu metadata if not already set
                        if pkg_meta.os == Npm::OperatingSystem::All {
                            pkg_meta.os = pkg.package.os;
                        }
                        if pkg_meta.arch == Npm::Architecture::All {
                            pkg_meta.arch = pkg.package.cpu;
                        }
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Printer
// ────────────────────────────────────────────────────────────────────────────

pub struct Printer<'a> {
    pub lockfile: &'a mut Lockfile,
    pub options: PackageManager::Options,
    pub successfully_installed: Option<DynamicBitSet>,
    pub updates: &'a [PackageManager::UpdateRequest],
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PrinterFormat {
    Yarn,
}

pub mod printer {
    pub use crate::lockfile::printer::tree_printer as Tree;
    pub use crate::lockfile::printer::yarn as Yarn;
}

impl<'a> Printer<'a> {
    #[cold]
    pub fn print(
        log: &mut logger::Log,
        input_lockfile_path: &[u8],
        format: PrinterFormat,
    ) -> Result<(), BunError> {
        // TODO(port): narrow error set

        // We truncate longer than allowed paths. We should probably throw an error instead.
        let path = &input_lockfile_path[..input_lockfile_path.len().min(MAX_PATH_BYTES)];

        let mut lockfile_path_buf1 = PathBuffer::uninit();
        let mut lockfile_path_buf2 = PathBuffer::uninit();

        let mut lockfile_path: &ZStr = ZStr::EMPTY;

        if !bun_paths::is_absolute(path) {
            let cwd = bun_sys::getcwd(&mut lockfile_path_buf1)?;
            let parts = [path];
            let lockfile_path__ =
                Path::join_abs_string_buf(cwd, &mut lockfile_path_buf2, &parts, Path::Style::Auto);
            lockfile_path_buf2[lockfile_path__.len()] = 0;
            // SAFETY: NUL written at [len] above.
            lockfile_path =
                unsafe { ZStr::from_raw(lockfile_path_buf2.as_ptr(), lockfile_path__.len()) };
        } else if !path.is_empty() {
            lockfile_path_buf1[..path.len()].copy_from_slice(path);
            lockfile_path_buf1[path.len()] = 0;
            // SAFETY: NUL written at [len] above.
            lockfile_path =
                unsafe { ZStr::from_raw(lockfile_path_buf1.as_ptr(), path.len()) };
        }

        if !lockfile_path.as_bytes().is_empty() && lockfile_path.as_bytes()[0] == SEP {
            let _ = sys::chdir(
                b"",
                bun_paths::dirname(lockfile_path.as_bytes()).unwrap_or(SEP_STR.as_bytes()),
            );
        }

        let _ = FileSystem::init(None)?;

        let mut lockfile = Box::new(Lockfile::init_empty_value());
        // TODO(port): Zig allocates uninitialized then calls loadFromCwd which initializes via
        // initEmpty/loadFromBytes. Here we pre-initialize.

        let load_from_disk = lockfile.load_from_cwd::<false>(None, log);
        match load_from_disk {
            LoadResult::Err(cause) => {
                match cause.step {
                    LoadStep::OpenFile => Output::pretty_errorln(format_args!(
                        "<r><red>error<r> opening lockfile:<r> {}.",
                        cause.value.name()
                    )),
                    LoadStep::ParseFile => Output::pretty_errorln(format_args!(
                        "<r><red>error<r> parsing lockfile:<r> {}",
                        cause.value.name()
                    )),
                    LoadStep::ReadFile => Output::pretty_errorln(format_args!(
                        "<r><red>error<r> reading lockfile:<r> {}",
                        cause.value.name()
                    )),
                    LoadStep::Migrating => Output::pretty_errorln(format_args!(
                        "<r><red>error<r> while migrating lockfile:<r> {}",
                        cause.value.name()
                    )),
                }
                if log.errors > 0 {
                    log.print(Output::error_writer())?;
                }
                Global::crash();
            }
            LoadResult::NotFound => {
                Output::pretty_errorln(format_args!(
                    "<r><red>lockfile not found:<r> {}",
                    bun_core::fmt::QuotedFormatter {
                        text: lockfile_path.as_bytes()
                    },
                ));
                Global::crash();
            }
            LoadResult::Ok(_) => {}
        }

        let writer = Output::writer_buffered();
        match Self::print_with_lockfile(&mut lockfile, format, writer) {
            Ok(()) => {}
            Err(e) if e == err!("OutOfMemory") => bun_core::out_of_memory(),
            Err(e) if e == err!("BrokenPipe") || e == err!("WriteFailed") => return Ok(()),
            Err(e) => return Err(e),
        }
        Output::flush();
        Ok(())
    }

    pub fn print_with_lockfile<W: bun_io::Write>(
        lockfile: &mut Lockfile,
        format: PrinterFormat,
        writer: W,
    ) -> Result<(), BunError> {
        // TODO(port): narrow error set
        let fs = FileSystem::instance_mut();
        let mut options = PackageManager::Options {
            max_concurrent_lifecycle_scripts: 1,
            ..Default::default()
        };

        let entries_option = fs.fs.read_directory(&fs.top_level_dir, None, 0, true)?;
        if let bun_sys::fs::EntriesOption::Err(e) = &*entries_option {
            return Err(e.canonical_error);
        }

        let env_loader: &mut DotEnv::Loader = {
            let map = Box::leak(Box::new(DotEnv::Map::init()));
            let loader = Box::leak(Box::new(DotEnv::Loader::init(map)));
            loader.quiet = true;
            loader
        };

        env_loader.load_process()?;
        env_loader.load(
            entries_option.entries(),
            &[] as &[&[u8]],
            DotEnv::Mode::Production,
            false,
        )?;
        let mut log = logger::Log::init();
        options.load(&mut log, env_loader, None, None, PackageManager::Subcommand::Install)?;

        let mut printer = Printer {
            lockfile,
            options,
            successfully_installed: None,
            updates: &[],
        };

        match format {
            PrinterFormat::Yarn => {
                printer::Yarn::print(&mut printer, writer)?;
            }
        }
        Ok(())
    }
}

// ────────────────────────────────────────────────────────────────────────────
// verifyData / saveToDisk / rootPackage / str / initEmpty
// ────────────────────────────────────────────────────────────────────────────

impl Lockfile {
    pub fn verify_data(&self) -> Result<(), BunError> {
        // TODO(port): narrow error set
        debug_assert!(self.format == FormatVersion::current());
        let mut i: usize = 0;
        while i < self.packages.len() {
            let package: Package = self.packages.get(i);
            debug_assert!(self.str(&package.name).len() == package.name.len() as usize);
            debug_assert!(
                SemverString::Builder::string_hash(self.str(&package.name))
                    == package.name_hash as u64
            );
            debug_assert!(
                package.dependencies.get(self.buffers.dependencies.as_slice()).len()
                    == package.dependencies.len as usize
            );
            debug_assert!(
                package.resolutions.get(self.buffers.resolutions.as_slice()).len()
                    == package.resolutions.len as usize
            );
            debug_assert!(
                package.resolutions.get(self.buffers.resolutions.as_slice()).len()
                    == package.dependencies.len as usize
            );
            let dependencies = package.dependencies.get(self.buffers.dependencies.as_slice());
            for dependency in dependencies {
                debug_assert!(
                    self.str(&dependency.name).len() == dependency.name.len() as usize
                );
                debug_assert!(
                    SemverString::Builder::string_hash(self.str(&dependency.name))
                        == dependency.name_hash
                );
            }
            i += 1;
        }
        Ok(())
    }

    pub fn save_to_disk(&mut self, load_result: &LoadResult<'_>, options: &PackageManager::Options) {
        let save_format = load_result.save_format(options);
        if cfg!(debug_assertions) {
            if let Err(e) = self.verify_data() {
                Output::pretty_errorln(format_args!(
                    "<r><red>error:<r> failed to verify lockfile: {}",
                    e.name()
                ));
                Global::crash();
            }
            debug_assert!(FileSystem::instance_loaded());
        }

        let bytes: Vec<u8> = 'bytes: {
            if save_format == LockfileFormat::Text {
                let mut writer_buf: Vec<u8> = Vec::new();

                if let Err(_e) = TextLockfile::Stringifier::save_from_binary(
                    self,
                    load_result,
                    options,
                    &mut writer_buf,
                ) {
                    // error.WriteFailed -> OOM in Zig (Allocating writer)
                    bun_core::out_of_memory();
                }

                // writer.flush() catch error.WriteFailed -> OOM
                // (Vec<u8> writer needs no flush)

                break 'bytes writer_buf;
            }

            let mut bytes: Vec<u8> = Vec::new();

            let mut total_size: usize = 0;
            let mut end_pos: usize = 0;
            if let Err(e) = Serializer::save(self, options, &mut bytes, &mut total_size, &mut end_pos)
            {
                Output::err(e, "failed to serialize lockfile", format_args!(""));
                Global::crash();
            }
            if bytes.len() >= end_pos {
                bytes[end_pos..end_pos + core::mem::size_of::<usize>()]
                    .copy_from_slice(&total_size.to_ne_bytes());
            }
            break 'bytes bytes;
        };
        // defer bun.default_allocator.free(bytes) — Vec drops at scope end.

        let mut tmpname_buf = [0u8; 512];
        let mut base64_bytes = [0u8; 8];
        bun_core::csprng(&mut base64_bytes);
        let tmpname: &ZStr = {
            let mut cursor: &mut [u8] = &mut tmpname_buf[..];
            let start_len = cursor.len();
            if save_format == LockfileFormat::Text {
                write!(cursor, ".lock-{:x}.tmp\0", bun_core::fmt::HexBytes(&base64_bytes))
                    .expect("unreachable");
            } else {
                write!(cursor, ".lockb-{:x}.tmp\0", bun_core::fmt::HexBytes(&base64_bytes))
                    .expect("unreachable");
            }
            let written = start_len - cursor.len();
            // SAFETY: trailing NUL written above; len excludes it.
            unsafe { ZStr::from_raw(tmpname_buf.as_ptr(), written - 1) }
        };
        // TODO(port): Zig `{x}` on `&[8]u8` formats as lowercase hex of bytes; verify HexBytes matches.

        let file = match File::openat(
            Fd::cwd(),
            tmpname,
            sys::O::CREAT | sys::O::WRONLY,
            0o777,
        ) {
            sys::Result::Err(e) => {
                Output::err(e, "failed to create temporary file to save lockfile", format_args!(""));
                Global::crash();
            }
            sys::Result::Ok(f) => f,
        };

        match file.write_all(&bytes) {
            sys::Result::Err(e) => {
                file.close();
                let _ = sys::unlink(tmpname);
                Output::err(e, "failed to write lockfile", format_args!(""));
                Global::crash();
            }
            sys::Result::Ok(()) => {}
        }

        #[cfg(unix)]
        {
            // chmod 755 for binary, 644 for plaintext
            let mut filemode: sys::Mode = 0o755;
            if save_format == LockfileFormat::Text {
                filemode = 0o644;
            }
            match sys::fchmod(file.handle, filemode) {
                sys::Result::Err(e) => {
                    file.close();
                    let _ = sys::unlink(tmpname);
                    Output::err(e, "failed to change lockfile permissions", format_args!(""));
                    Global::crash();
                }
                sys::Result::Ok(()) => {}
            }
        }

        if let Err(e) = file.close_and_move_to(tmpname, save_format.filename()) {
            bun_core::handle_error_return_trace(e);

            // note: file is already closed here.
            let _ = sys::unlink(tmpname);

            Output::err(
                e,
                "Failed to replace old lockfile with new lockfile on disk",
                format_args!(""),
            );
            Global::crash();
        }
    }

    pub fn root_package(&self) -> Option<Package> {
        if self.packages.len() == 0 {
            return None;
        }

        Some(self.packages.get(0))
    }

    #[inline]
    pub fn str<T: bun_semver::Slicable>(&self, slicable: &T) -> &[u8] {
        // PORT NOTE: Zig had compile-time guards rejecting by-value String/ExternalString.
        // In Rust we just take &T; the temporary-pointer hazard does not exist.
        slicable.slice(self.buffers.string_bytes.as_slice())
    }

    /// Construct an empty Lockfile value (in-place equivalent of Zig `initEmpty`).
    pub fn init_empty(&mut self) {
        *self = Self::init_empty_value();
    }

    fn init_empty_value() -> Self {
        Lockfile {
            format: FormatVersion::current(),
            text_lockfile_version: TextLockfile::Version::current(),
            packages: Default::default(),
            buffers: Buffers::default(),
            package_index: PackageIndexMap::default(),
            string_pool: StringPool::default(),
            scratch: Scratch::init(),
            scripts: Scripts::default(),
            trusted_dependencies: None,
            workspace_paths: NameHashMap::default(),
            workspace_versions: VersionHashMap::default(),
            overrides: OverrideMap::default(),
            catalogs: CatalogMap::default(),
            meta_hash: ZERO_HASH,
            patched_dependencies: PatchedDependenciesMap::default(),
            saved_config_version: None,
        }
    }

    pub fn get_package_id(
        &self,
        name_hash: u64,
        // If non-null, attempt to use an existing package
        // that satisfies this version range.
        version: Option<Dependency::Version>,
        resolution: &Resolution,
    ) -> Option<PackageID> {
        let entry = self.package_index.get(&name_hash)?;
        let resolutions: &[Resolution] = self.packages.items_resolution();
        let npm_version = version.and_then(|v| match v.tag {
            Dependency::Version::Tag::Npm => Some(v.value.npm.version),
            _ => None,
        });
        let buf = self.buffers.string_bytes.as_slice();

        match entry {
            PackageIndexEntry::Id(id) => {
                if cfg!(debug_assertions) {
                    debug_assert!((*id as usize) < resolutions.len());
                }

                if resolutions[*id as usize].eql(resolution, buf, buf) {
                    return Some(*id);
                }

                if resolutions[*id as usize].tag == Resolution::Tag::Npm {
                    if let Some(npm_v) = &npm_version {
                        if npm_v.satisfies(resolutions[*id as usize].value.npm.version, buf, buf) {
                            return Some(*id);
                        }
                    }
                }
            }
            PackageIndexEntry::Ids(ids) => {
                for &id in ids.iter() {
                    if cfg!(debug_assertions) {
                        debug_assert!((id as usize) < resolutions.len());
                    }

                    if resolutions[id as usize].eql(resolution, buf, buf) {
                        return Some(id);
                    }

                    if resolutions[id as usize].tag == Resolution::Tag::Npm {
                        if let Some(npm_v) = &npm_version {
                            if npm_v.satisfies(resolutions[id as usize].value.npm.version, buf, buf)
                            {
                                return Some(id);
                            }
                        }
                    }
                }
            }
        }

        None
    }

    /// Appends `pkg` to `this.packages`, and adds to `this.package_index`
    pub fn append_package_dedupe(
        &mut self,
        pkg: &mut Package,
        buf: &[u8],
    ) -> Result<PackageID, AllocError> {
        let entry = self.package_index.get_or_put(pkg.name_hash)?;

        if !entry.found_existing {
            let new_id: PackageID = PackageID::try_from(self.packages.len()).unwrap();
            pkg.meta.id = new_id;
            self.packages.append(*pkg)?;
            *entry.value_ptr = PackageIndexEntry::Id(new_id);
            return Ok(new_id);
        }

        let mut resolutions = self.packages.items_resolution();

        match entry.value_ptr {
            PackageIndexEntry::Id(existing_id) => {
                let existing_id = *existing_id;
                if pkg.resolution.eql(&resolutions[existing_id as usize], buf, buf) {
                    pkg.meta.id = existing_id;
                    return Ok(existing_id);
                }

                let new_id: PackageID = PackageID::try_from(self.packages.len()).unwrap();
                pkg.meta.id = new_id;
                self.packages.append(*pkg)?;

                resolutions = self.packages.items_resolution();

                let mut ids = PackageIDList::with_capacity(8);
                // SAFETY: capacity reserved; we write both elements immediately.
                unsafe { ids.set_len(2) };

                let pair = if pkg
                    .resolution
                    .order(&resolutions[existing_id as usize], buf, buf)
                    == Ordering::Greater
                {
                    [new_id, existing_id]
                } else {
                    [existing_id, new_id]
                };
                ids[0..2].copy_from_slice(&pair);

                *entry.value_ptr = PackageIndexEntry::Ids(ids);

                Ok(new_id)
            }
            PackageIndexEntry::Ids(existing_ids) => {
                for &existing_id in existing_ids.iter() {
                    if pkg.resolution.eql(&resolutions[existing_id as usize], buf, buf) {
                        pkg.meta.id = existing_id;
                        return Ok(existing_id);
                    }
                }

                let new_id: PackageID = PackageID::try_from(self.packages.len()).unwrap();
                pkg.meta.id = new_id;
                self.packages.append(*pkg)?;

                resolutions = self.packages.items_resolution();

                for (i, &existing_id) in existing_ids.iter().enumerate() {
                    if pkg
                        .resolution
                        .order(&resolutions[existing_id as usize], buf, buf)
                        == Ordering::Greater
                    {
                        existing_ids.insert(i, new_id);
                        return Ok(new_id);
                    }
                }

                existing_ids.push(new_id);

                Ok(new_id)
            }
        }
        // TODO(port): borrowck — `entry.value_ptr` borrows package_index while we also
        // call self.packages.append/items_resolution. Phase B may need to restructure.
    }

    pub fn get_or_put_id(
        &mut self,
        id: PackageID,
        name_hash: PackageNameHash,
    ) -> Result<(), AllocError> {
        let gpe = self.package_index.get_or_put(name_hash)?;

        if gpe.found_existing {
            let index: &mut PackageIndexEntry = gpe.value_ptr;

            match index {
                PackageIndexEntry::Id(existing_id) => {
                    let existing_id = *existing_id;
                    let mut ids = PackageIDList::with_capacity(8);
                    // SAFETY: capacity reserved; both elements written below.
                    unsafe { ids.set_len(2) };

                    let resolutions = self.packages.items_resolution();
                    let buf = self.buffers.string_bytes.as_slice();

                    let pair = if resolutions[id as usize]
                        .order(&resolutions[existing_id as usize], buf, buf)
                        == Ordering::Greater
                    {
                        [id, existing_id]
                    } else {
                        [existing_id, id]
                    };
                    ids[0..2].copy_from_slice(&pair);

                    *index = PackageIndexEntry::Ids(ids);
                }
                PackageIndexEntry::Ids(existing_ids) => {
                    let resolutions = self.packages.items_resolution();
                    let buf = self.buffers.string_bytes.as_slice();

                    for (i, &existing_id) in existing_ids.iter().enumerate() {
                        if resolutions[id as usize]
                            .order(&resolutions[existing_id as usize], buf, buf)
                            == Ordering::Greater
                        {
                            existing_ids.insert(i, id);
                            return Ok(());
                        }
                    }

                    // append to end because it's the smallest or equal to the smallest
                    existing_ids.push(id);
                }
            }
        } else {
            *gpe.value_ptr = PackageIndexEntry::Id(id);
        }
        Ok(())
    }

    pub fn append_package(&mut self, package_: Package) -> Result<Package, AllocError> {
        let id: PackageID = self.packages.len() as PackageID; // @truncate
        self.append_package_with_id(package_, id)
    }

    pub fn append_package_with_id(
        &mut self,
        package_: Package,
        id: PackageID,
    ) -> Result<Package, AllocError> {
        let mut package = package_;
        package.meta.id = id;
        self.packages.append(package)?;
        self.get_or_put_id(id, package.name_hash)?;

        if cfg!(debug_assertions) {
            debug_assert!(self
                .get_package_id(package.name_hash, None, &package.resolution)
                .is_some());
        }

        Ok(package)
    }

    #[inline]
    pub fn string_builder(&mut self) -> StringBuilder<'_> {
        StringBuilder {
            len: 0,
            cap: 0,
            off: 0,
            ptr: None,
            lockfile: self,
        }
    }

    pub fn string_buf(&mut self) -> SemverString::Buf<'_> {
        SemverString::Buf {
            bytes: &mut self.buffers.string_bytes,
            pool: &mut self.string_pool,
        }
        // TODO(port): String.Buf API in bun_semver — Zig also passed `allocator`.
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Scratch
// ────────────────────────────────────────────────────────────────────────────

pub struct Scratch {
    pub duplicate_checker_map: DuplicateCheckerMap,
    pub dependency_list_queue: DependencyQueue,
}

pub type DuplicateCheckerMap =
    BunHashMap<PackageNameHash, logger::Loc, IdentityContext<PackageNameHash>>;
pub type DependencyQueue = LinearFifo<DependencySlice>;

impl Scratch {
    pub fn init() -> Scratch {
        Scratch {
            dependency_list_queue: DependencyQueue::init(),
            duplicate_checker_map: DuplicateCheckerMap::default(),
        }
    }
}

impl Default for Scratch {
    fn default() -> Self {
        // Zig field defaults are `undefined`; we initialize properly.
        Self::init()
    }
}

// ────────────────────────────────────────────────────────────────────────────
// StringBuilder
// ────────────────────────────────────────────────────────────────────────────

pub struct StringBuilder<'a> {
    pub len: usize,
    pub cap: usize,
    pub off: usize,
    pub ptr: Option<*mut u8>,
    pub lockfile: &'a mut Lockfile,
}

/// Trait implemented by `String` and `ExternalString` to support generic `append*`.
/// Replaces Zig's `comptime Type: type` switch.
pub trait StringBuilderType: Sized {
    fn from_init(string_bytes: &[u8], slice: &[u8], hash: u64) -> Self;
    fn from_pooled(value: SemverString, hash: u64) -> Self;
}

impl StringBuilderType for SemverString {
    fn from_init(string_bytes: &[u8], slice: &[u8], _hash: u64) -> Self {
        SemverString::init(string_bytes, slice)
    }
    fn from_pooled(value: SemverString, _hash: u64) -> Self {
        value
    }
}

impl StringBuilderType for ExternalString {
    fn from_init(string_bytes: &[u8], slice: &[u8], hash: u64) -> Self {
        ExternalString::init(string_bytes, slice, hash)
    }
    fn from_pooled(value: SemverString, hash: u64) -> Self {
        ExternalString { value, hash }
    }
}

impl<'a> StringBuilder<'a> {
    #[inline]
    pub fn count(&mut self, slice: &[u8]) {
        self.assert_not_allocated();

        if SemverString::can_inline(slice) {
            return;
        }
        self._count_with_hash(slice, SemverString::Builder::string_hash(slice));
    }

    #[inline]
    pub fn count_with_hash(&mut self, slice: &[u8], hash: u64) {
        self.assert_not_allocated();

        if SemverString::can_inline(slice) {
            return;
        }
        self._count_with_hash(slice, hash);
    }

    #[inline]
    fn assert_not_allocated(&self) {
        if cfg!(debug_assertions) {
            if self.ptr.is_some() {
                Output::panic(format_args!(
                    "StringBuilder.count called after StringBuilder.allocate. This is a bug in Bun. Please make sure to call StringBuilder.count before allocating."
                ));
            }
        }
    }

    #[inline]
    fn _count_with_hash(&mut self, slice: &[u8], hash: u64) {
        self.assert_not_allocated();

        if !self.lockfile.string_pool.contains(&hash) {
            self.cap += slice.len();
        }
    }

    pub fn allocated_slice(&self) -> &[u8] {
        match self.ptr {
            // SAFETY: ptr was set by allocate() to a region of length self.cap inside
            // lockfile.buffers.string_bytes.
            Some(ptr) => unsafe { core::slice::from_raw_parts(ptr, self.cap) },
            None => b"",
        }
    }

    pub fn clamp(&mut self) {
        if cfg!(debug_assertions) {
            debug_assert!(self.cap >= self.len);
            // assert that no other builder was allocated while this builder was being used
            debug_assert!(
                self.lockfile.buffers.string_bytes.len() == self.off + self.cap
            );
        }

        let excess = self.cap - self.len;

        if excess > 0 {
            let new_len = self.lockfile.buffers.string_bytes.len() - excess;
            self.lockfile.buffers.string_bytes.truncate(new_len);
        }
    }

    pub fn allocate(&mut self) -> Result<(), AllocError> {
        let string_bytes = &mut self.lockfile.buffers.string_bytes;
        string_bytes.reserve(self.cap);
        // PERF(port): was ensureUnusedCapacity
        let prev_len = string_bytes.len();
        self.off = prev_len;
        // SAFETY: capacity reserved above; bytes are written before being read by callers.
        unsafe { string_bytes.set_len(prev_len + self.cap) };
        self.ptr = Some(unsafe { string_bytes.as_mut_ptr().add(prev_len) });
        self.len = 0;
        Ok(())
    }

    #[inline]
    pub fn append<T: StringBuilderType>(&mut self, slice: &[u8]) -> T {
        self.append_with_hash::<T>(slice, SemverString::Builder::string_hash(slice))
    }

    /// SlicedString is not supported due to inline strings.
    pub fn append_without_pool<T: StringBuilderType>(&mut self, slice: &[u8], hash: u64) -> T {
        if SemverString::can_inline(slice) {
            return T::from_init(self.lockfile.buffers.string_bytes.as_slice(), slice, hash);
        }
        if cfg!(debug_assertions) {
            debug_assert!(self.len <= self.cap); // didn't count everything
            debug_assert!(self.ptr.is_some()); // must call allocate first
        }

        // SAFETY: ptr is non-null (asserted above) and points into string_bytes with
        // self.cap bytes available; slice.len() fits within remaining capacity.
        let final_slice = unsafe {
            let dst = self.ptr.unwrap().add(self.len);
            core::ptr::copy_nonoverlapping(slice.as_ptr(), dst, slice.len());
            core::slice::from_raw_parts(dst, slice.len())
        };
        self.len += slice.len();

        if cfg!(debug_assertions) {
            debug_assert!(self.len <= self.cap);
        }

        T::from_init(
            self.lockfile.buffers.string_bytes.as_slice(),
            final_slice,
            hash,
        )
    }

    pub fn append_with_hash<T: StringBuilderType>(&mut self, slice: &[u8], hash: u64) -> T {
        if SemverString::can_inline(slice) {
            return T::from_init(self.lockfile.buffers.string_bytes.as_slice(), slice, hash);
        }

        if cfg!(debug_assertions) {
            debug_assert!(self.len <= self.cap); // didn't count everything
            debug_assert!(self.ptr.is_some()); // must call allocate first
        }

        let string_entry = self
            .lockfile
            .string_pool
            .get_or_put(hash)
            .expect("unreachable");
        if !string_entry.found_existing {
            // SAFETY: see append_without_pool.
            let final_slice = unsafe {
                let dst = self.ptr.unwrap().add(self.len);
                core::ptr::copy_nonoverlapping(slice.as_ptr(), dst, slice.len());
                core::slice::from_raw_parts(dst, slice.len())
            };
            self.len += slice.len();

            *string_entry.value_ptr =
                SemverString::init(self.lockfile.buffers.string_bytes.as_slice(), final_slice);
        }

        if cfg!(debug_assertions) {
            debug_assert!(self.len <= self.cap);
        }

        T::from_pooled(*string_entry.value_ptr, hash)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// PackageIndex
// ────────────────────────────────────────────────────────────────────────────

pub mod package_index {
    use super::*;

    pub type Map = BunHashMap<PackageNameHash, Entry, IdentityContext<PackageNameHash>>;
    // TODO(port): Zig uses load factor 80; bun_collections::HashMap should match.

    #[repr(u8)]
    pub enum Tag {
        Id = 0,
        Ids = 1,
    }

    pub enum Entry {
        Id(PackageID),
        Ids(PackageIDList),
    }
}

pub use package_index::Entry as PackageIndexEntry;
pub use package_index::Map as PackageIndexMap;

// ────────────────────────────────────────────────────────────────────────────
// FormatVersion
// ────────────────────────────────────────────────────────────────────────────

#[repr(u32)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FormatVersion {
    V0 = 0,
    /// bun v0.0.x - bun v0.1.6
    V1 = 1,
    /// bun v0.1.7+
    /// This change added tarball URLs to npm-resolved packages
    V2 = 2,
    /// Changed semver major/minor/patch to each use u64 instead of u32
    V3 = 3,
    // Zig has `_` (non-exhaustive). TODO(port): represent unknown values if needed.
}

impl FormatVersion {
    pub const fn current() -> Self {
        FormatVersion::V3
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Drop (deinit)
// ────────────────────────────────────────────────────────────────────────────

// `deinit` only frees owned fields → handled by Drop on each field type.
// No explicit Drop impl needed.

// ────────────────────────────────────────────────────────────────────────────
// EqlSorter
// ────────────────────────────────────────────────────────────────────────────

pub struct EqlSorter<'a> {
    pub string_buf: &'a [u8],
    pub pkg_names: &'a [SemverString],
}

/// Basically placement id
#[derive(Clone, Copy)]
pub struct PathToId {
    pub pkg_id: PackageID,
    pub tree_path: *const [u8],
    // TODO(port): Zig stores a borrowed slice (allocated and freed via sort_buf scope).
    // Using *const [u8] to avoid lifetime threading on the sort buffer; revisit in Phase B.
}

impl<'a> EqlSorter<'a> {
    pub fn is_less_than(&self, l: PathToId, r: PathToId) -> bool {
        // SAFETY: tree_path points into allocations alive for the duration of `eql`.
        let l_path = unsafe { &*l.tree_path };
        let r_path = unsafe { &*r.tree_path };
        match strings::order(l_path, r_path) {
            Ordering::Less => return true,
            Ordering::Greater => return false,
            Ordering::Equal => {}
        }

        // they exist in the same tree, name can't be the same so string
        // compare.
        let l_name = self.pkg_names[l.pkg_id as usize];
        let r_name = self.pkg_names[r.pkg_id as usize];
        l_name.order(&r_name, self.string_buf, self.string_buf) == Ordering::Less
    }
}

impl Lockfile {
    /// `cut_off_pkg_id` should be removed when we stop appending packages to lockfile during install step
    pub fn eql(
        l: &Lockfile,
        r: &Lockfile,
        cut_off_pkg_id: usize,
    ) -> Result<bool, AllocError> {
        let l_hoisted_deps = l.buffers.hoisted_dependencies.as_slice();
        let r_hoisted_deps = r.buffers.hoisted_dependencies.as_slice();
        let l_string_buf = l.buffers.string_bytes.as_slice();
        let r_string_buf = r.buffers.string_bytes.as_slice();

        let l_len = l_hoisted_deps.len();
        let r_len = r_hoisted_deps.len();

        if l_len != r_len {
            return Ok(false);
        }

        let mut sort_buf: Vec<PathToId> = Vec::with_capacity(l_len + r_len);
        // SAFETY: capacity reserved; we fill via indexed writes below up to i.
        unsafe { sort_buf.set_len(l_len + r_len) };
        let (l_buf_full, r_buf_full) = sort_buf.split_at_mut(l_len);
        let mut l_buf = &mut l_buf_full[..];
        let mut r_buf = &mut r_buf_full[..];

        let mut path_buf = PathBuffer::uninit();
        let mut depth_buf = Tree::DepthBuf::default();

        // Track owned tree-path allocations so they outlive the sort and are freed at scope end.
        let mut tree_paths: Vec<Box<[u8]>> = Vec::new();

        let mut i: usize = 0;
        for l_tree in l.buffers.trees.iter() {
            let (rel_path, _) = Tree::relative_path_and_depth(
                l,
                l_tree.id,
                &mut path_buf,
                &mut depth_buf,
                Tree::PathStyle::PkgPath,
            );
            let tree_path: Box<[u8]> = Box::<[u8]>::from(rel_path);
            let tree_path_ptr: *const [u8] = &*tree_path;
            tree_paths.push(tree_path);
            for &l_dep_id in l_tree.dependencies.get(l_hoisted_deps) {
                if l_dep_id == invalid_dependency_id {
                    continue;
                }
                let l_pkg_id = l.buffers.resolutions[l_dep_id as usize];
                if l_pkg_id == invalid_package_id || l_pkg_id as usize >= cut_off_pkg_id {
                    continue;
                }
                l_buf[i] = PathToId {
                    pkg_id: l_pkg_id,
                    tree_path: tree_path_ptr,
                };
                i += 1;
            }
        }
        l_buf = &mut l_buf[..i];

        i = 0;
        for r_tree in r.buffers.trees.iter() {
            let (rel_path, _) = Tree::relative_path_and_depth(
                r,
                r_tree.id,
                &mut path_buf,
                &mut depth_buf,
                Tree::PathStyle::PkgPath,
            );
            let tree_path: Box<[u8]> = Box::<[u8]>::from(rel_path);
            let tree_path_ptr: *const [u8] = &*tree_path;
            tree_paths.push(tree_path);
            for &r_dep_id in r_tree.dependencies.get(r_hoisted_deps) {
                if r_dep_id == invalid_dependency_id {
                    continue;
                }
                let r_pkg_id = r.buffers.resolutions[r_dep_id as usize];
                if r_pkg_id == invalid_package_id || r_pkg_id as usize >= cut_off_pkg_id {
                    continue;
                }
                r_buf[i] = PathToId {
                    pkg_id: r_pkg_id,
                    tree_path: tree_path_ptr,
                };
                i += 1;
            }
        }
        r_buf = &mut r_buf[..i];

        if l_buf.len() != r_buf.len() {
            return Ok(false);
        }

        let l_pkgs = l.packages.slice();
        let r_pkgs = r.packages.slice();
        let l_pkg_names = l_pkgs.items_name();
        let r_pkg_names = r_pkgs.items_name();

        {
            let sorter = EqlSorter {
                pkg_names: l_pkg_names,
                string_buf: l_string_buf,
            };
            l_buf.sort_by(|a, b| {
                if sorter.is_less_than(*a, *b) {
                    Ordering::Less
                } else {
                    Ordering::Greater
                }
            });
            // PERF(port): Zig used pdqsort; slice::sort_by is stable mergesort. Profile in Phase B.
        }

        {
            let sorter = EqlSorter {
                pkg_names: r_pkg_names,
                string_buf: r_string_buf,
            };
            r_buf.sort_by(|a, b| {
                if sorter.is_less_than(*a, *b) {
                    Ordering::Less
                } else {
                    Ordering::Greater
                }
            });
        }

        let l_pkg_name_hashes = l_pkgs.items_name_hash();
        let l_pkg_resolutions = l_pkgs.items_resolution();
        let l_pkg_bins = l_pkgs.items_bin();
        let l_pkg_scripts = l_pkgs.items_scripts();
        let r_pkg_name_hashes = r_pkgs.items_name_hash();
        let r_pkg_resolutions = r_pkgs.items_resolution();
        let r_pkg_bins = r_pkgs.items_bin();
        let r_pkg_scripts = r_pkgs.items_scripts();

        let l_extern_strings = l.buffers.extern_strings.as_slice();
        let r_extern_strings = r.buffers.extern_strings.as_slice();

        debug_assert_eq!(l_buf.len(), r_buf.len());
        for (l_ids, r_ids) in l_buf.iter().zip(r_buf.iter()) {
            let l_pkg_id = l_ids.pkg_id as usize;
            let r_pkg_id = r_ids.pkg_id as usize;
            if l_pkg_name_hashes[l_pkg_id] != r_pkg_name_hashes[r_pkg_id] {
                return Ok(false);
            }
            let l_res = l_pkg_resolutions[l_pkg_id];
            let r_res = r_pkg_resolutions[r_pkg_id];

            if l_res.tag == Resolution::Tag::Uninitialized
                || r_res.tag == Resolution::Tag::Uninitialized
            {
                if l_res.tag != r_res.tag {
                    return Ok(false);
                }
            } else if !l_res.eql(&r_res, l_string_buf, r_string_buf) {
                return Ok(false);
            }

            if !l_pkg_bins[l_pkg_id].eql(
                &r_pkg_bins[r_pkg_id],
                l_string_buf,
                l_extern_strings,
                r_string_buf,
                r_extern_strings,
            ) {
                return Ok(false);
            }

            if !l_pkg_scripts[l_pkg_id].eql(&r_pkg_scripts[r_pkg_id], l_string_buf, r_string_buf) {
                return Ok(false);
            }
        }

        Ok(true)
    }

    pub fn has_meta_hash_changed(
        &mut self,
        print_name_version_string: bool,
        packages_len: usize,
    ) -> Result<bool, BunError> {
        // TODO(port): narrow error set
        let previous_meta_hash = self.meta_hash;
        self.meta_hash = self.generate_meta_hash(print_name_version_string, packages_len)?;
        Ok(!strings::eql_long(&previous_meta_hash, &self.meta_hash, false))
    }

    pub fn generate_meta_hash(
        &self,
        print_name_version_string: bool,
        packages_len: usize,
    ) -> Result<MetaHash, BunError> {
        // TODO(port): narrow error set
        if packages_len <= 1 {
            return Ok(ZERO_HASH);
        }

        let mut string_builder = bun_core::StringBuilder::default();
        let names: &[SemverString] = &self.packages.items_name()[..packages_len];
        let resolutions: &[Resolution] = &self.packages.items_resolution()[..packages_len];
        let bytes = self.buffers.string_bytes.as_slice();
        let mut alphabetized_names: Vec<PackageID> =
            vec![0; packages_len.saturating_sub(1)];

        const HASH_PREFIX: &[u8] =
            b"\n-- BEGIN SHA512/256(`${alphabetize(name)}@${order(version)}`) --\n";
        const HASH_SUFFIX: &[u8] = b"-- END HASH--\n";
        string_builder.cap += HASH_PREFIX.len() + HASH_SUFFIX.len();
        {
            let mut i: usize = 1;

            while i + 16 < packages_len {
                // PORT NOTE: Zig used `inline while` to unroll 16 iterations. Plain loop here.
                // PERF(port): was comptime-unrolled inner loop — profile in Phase B.
                for j in 0..16usize {
                    alphabetized_names[(i + j) - 1] = (i + j) as PackageID; // @truncate
                    // posix path separators because we only use posix in the lockfile
                    string_builder.fmt_count(format_args!(
                        "{}@{}\n",
                        bstr::BStr::new(names[i + j].slice(bytes)),
                        resolutions[i + j].fmt(bytes, Path::Style::Posix)
                    ));
                }
                i += 16;
            }

            while i < packages_len {
                alphabetized_names[i - 1] = i as PackageID; // @truncate
                // posix path separators because we only use posix in the lockfile
                string_builder.fmt_count(format_args!(
                    "{}@{}\n",
                    bstr::BStr::new(names[i].slice(bytes)),
                    resolutions[i].fmt(bytes, Path::Style::Posix)
                ));
                i += 1;
            }
        }

        const SCRIPTS_BEGIN: &[u8] = b"\n-- BEGIN SCRIPTS --\n";
        const SCRIPTS_END: &[u8] = b"\n-- END SCRIPTS --\n";
        let mut has_scripts = false;

        for (field_name, scripts) in self.scripts.fields() {
            for script in scripts.iter() {
                if !script.is_empty() {
                    string_builder.fmt_count(format_args!(
                        "{}: {}\n",
                        field_name,
                        bstr::BStr::new(script)
                    ));
                    has_scripts = true;
                }
            }
        }

        if has_scripts {
            string_builder.count(SCRIPTS_BEGIN);
            string_builder.count(SCRIPTS_END);
        }

        {
            let alphabetizer = Package::Alphabetizer {
                names,
                buf: bytes,
                resolutions,
            };
            alphabetized_names.sort_by(|a, b| {
                if alphabetizer.is_alphabetical(*a, *b) {
                    Ordering::Less
                } else {
                    Ordering::Greater
                }
            });
            // PERF(port): Zig used pdqsort — profile in Phase B.
        }

        string_builder.allocate().expect("unreachable");
        // SAFETY: cap >= HASH_PREFIX.len() (added above), ptr set by allocate().
        unsafe {
            core::ptr::copy_nonoverlapping(
                HASH_PREFIX.as_ptr(),
                string_builder.ptr.unwrap(),
                HASH_PREFIX.len(),
            );
        }
        string_builder.len += HASH_PREFIX.len();

        for &i in alphabetized_names.iter() {
            let _ = string_builder.fmt(format_args!(
                "{}@{}\n",
                bstr::BStr::new(names[i as usize].slice(bytes)),
                resolutions[i as usize].fmt(bytes, Path::Style::Any)
            ));
        }

        if has_scripts {
            let _ = string_builder.append(SCRIPTS_BEGIN);
            for (field_name, scripts) in self.scripts.fields() {
                for script in scripts.iter() {
                    if !script.is_empty() {
                        let _ = string_builder.fmt(format_args!(
                            "{}: {}\n",
                            field_name,
                            bstr::BStr::new(script)
                        ));
                    }
                }
            }
            let _ = string_builder.append(SCRIPTS_END);
        }

        // SAFETY: cap - len >= HASH_SUFFIX.len() by construction.
        unsafe {
            core::ptr::copy_nonoverlapping(
                HASH_SUFFIX.as_ptr(),
                string_builder.ptr.unwrap().add(string_builder.len),
                HASH_SUFFIX.len(),
            );
        }
        string_builder.len += HASH_SUFFIX.len();

        // SAFETY: ptr is non-null and points to len initialized bytes.
        let alphabetized_name_version_string =
            unsafe { core::slice::from_raw_parts(string_builder.ptr.unwrap(), string_builder.len) };
        if print_name_version_string {
            Output::flush();
            Output::disable_buffering();
            Output::writer()
                .write_all(alphabetized_name_version_string)
                .expect("unreachable");
            Output::enable_buffering();
        }

        let mut digest = ZERO_HASH;
        Crypto::SHA512_256::hash(alphabetized_name_version_string, &mut digest);

        Ok(digest)
    }

    pub fn resolve_package_from_name_and_version(
        &self,
        package_name: &[u8],
        version: Dependency::Version,
    ) -> Option<PackageID> {
        let name_hash = SemverString::Builder::string_hash(package_name);
        let entry = self.package_index.get(&name_hash)?;
        let buf = self.buffers.string_bytes.as_slice();

        match version.tag {
            Dependency::Version::Tag::Npm => match entry {
                PackageIndexEntry::Id(id) => {
                    let resolutions = self.packages.items_resolution();

                    if cfg!(debug_assertions) {
                        debug_assert!((*id as usize) < resolutions.len());
                    }
                    if version
                        .value
                        .npm
                        .version
                        .satisfies(resolutions[*id as usize].value.npm.version, buf, buf)
                    {
                        return Some(*id);
                    }
                }
                PackageIndexEntry::Ids(ids) => {
                    let resolutions = self.packages.items_resolution();

                    for &id in ids.iter() {
                        if cfg!(debug_assertions) {
                            debug_assert!((id as usize) < resolutions.len());
                        }
                        if version
                            .value
                            .npm
                            .version
                            .satisfies(resolutions[id as usize].value.npm.version, buf, buf)
                        {
                            return Some(id);
                        }
                    }
                }
            },
            _ => {}
        }

        None
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Default trusted dependencies
// ────────────────────────────────────────────────────────────────────────────

const MAX_DEFAULT_TRUSTED_DEPENDENCIES: usize = 512;

// TODO(port): Zig builds this list at comptime from default-trusted-dependencies.txt via
// @embedFile + tokenize + sort. Rust cannot tokenize/sort at const time without a build
// script or proc-macro. Phase B: generate via build.rs into an `include!`-ed const slice.
pub static DEFAULT_TRUSTED_DEPENDENCIES_LIST: &[&[u8]] =
    include!(concat!(env!("OUT_DIR"), "/default_trusted_dependencies_list.rs"));
// TODO(port): placeholder include path; wire up in Phase B.

/// The default list of trusted dependencies is a static hashmap
// TODO(port): Zig builds a comptime StaticHashMap keyed by truncated u32 string-hash.
// Phase B: generate a phf::Map<u32, ()> (or StaticHashMap) via build.rs from the same
// .txt source. The hash MUST be `String.Builder.stringHash(s) as u32` to match
// `Lockfile.trusted_dependencies` keys.
pub static DEFAULT_TRUSTED_DEPENDENCIES: &StaticHashMap<&'static [u8], (), TrustedDepHashCtx, MAX_DEFAULT_TRUSTED_DEPENDENCIES> =
    &include!(concat!(env!("OUT_DIR"), "/default_trusted_dependencies_map.rs"));
// TODO(port): placeholder; build.rs must enforce no duplicates and ≤512 entries.

pub struct TrustedDepHashCtx;
impl TrustedDepHashCtx {
    pub fn hash(s: &[u8]) -> u64 {
        // truncate to u32 because Lockfile.trustedDependencies uses the same u32 string hash
        (SemverString::Builder::string_hash(s) as u32) as u64
    }
    pub fn eql(a: &[u8], b: &[u8]) -> bool {
        a == b
    }
}

impl Lockfile {
    pub fn has_trusted_dependency(&self, name: &[u8], resolution: &Resolution) -> bool {
        if let Some(trusted_dependencies) = &self.trusted_dependencies {
            let hash = SemverString::Builder::string_hash(name) as u32;
            return trusted_dependencies.contains(&hash);
        }

        // Only allow default trusted dependencies for npm packages
        resolution.tag == Resolution::Tag::Npm && DEFAULT_TRUSTED_DEPENDENCIES.has(name)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// PatchedDep
// ────────────────────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Clone, Copy)]
pub struct PatchedDep {
    /// e.g. "patches/is-even@1.0.0.patch"
    pub path: SemverString,
    _padding: [u8; 7],
    pub patchfile_hash_is_null: bool,
    /// the hash of the patch file contents
    __patchfile_hash: u64,
}

impl Default for PatchedDep {
    fn default() -> Self {
        PatchedDep {
            path: SemverString::default(),
            _padding: [0; 7],
            patchfile_hash_is_null: true,
            __patchfile_hash: 0,
        }
    }
}

impl PatchedDep {
    pub fn set_patchfile_hash(&mut self, val: Option<u64>) {
        self.patchfile_hash_is_null = val.is_none();
        self.__patchfile_hash = val.unwrap_or(0);
    }

    pub fn patchfile_hash(&self) -> Option<u64> {
        if self.patchfile_hash_is_null {
            None
        } else {
            Some(self.__patchfile_hash)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile.zig (2217 lines)
//   confidence: medium
//   todos:      44
//   notes:      Heavy borrowck reshaping needed (StringBuilder/Cloner hold &mut Lockfile while callers also mutate buffers); MultiArrayList column accessors stubbed as items_*(); default-trusted-dependencies needs build.rs codegen; clean_with_logger return should become Box<Lockfile>.
// ──────────────────────────────────────────────────────────────────────────
