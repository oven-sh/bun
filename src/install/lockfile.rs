//! Lockfile — in-memory representation of bun.lock / bun.lockb

use core::cmp::Ordering;
use core::fmt;
use std::io::Write as _;

use crate::Error as BunError;
use bun_alloc::AllocError;
use bun_collections::{
    ArrayHashMap, ArrayIdentityContext, ArrayIdentityContextU64, DynamicBitSet,
    HashMap as BunHashMap, IdentityContext, LinearFifo, StringHashMap, index_sort,
    linear_fifo::DynamicBuffer,
};
use bun_core::fmt::PathSep;
use bun_core::{Global, Output, UnwrapOrOom as _};
use bun_paths::{MAX_PATH_BYTES, SEP, SEP_STR, platform, resolve_path};
// `bun_install` sits above `bun_resolver` in the crate graph (no cycle), so use
// the real resolver `FileSystem` directly — same as `PackageManager.rs`.
use crate::bun_json as JSON;
use bun_core::zstr;
use bun_core::{ZStr, strings};
use bun_perf::system_timer::Timer;
use bun_resolver::fs::{self as Fs, FileSystem};
use bun_semver::{self as Semver, ExternalString, String as SemverString};
use bun_sha_hmac as Crypto;
use bun_sys::{self as sys, Fd, File};

use crate::config_version::ConfigVersion;
use crate::migration;
use crate::package_manager::WorkspaceFilter;
use crate::package_manager_real::{
    Options as PackageManagerOptions, options::LogLevel, populate_manifest_cache,
};
use crate::resolution_real::{self as resolution, Resolution};
use crate::string_builder;
use crate::update_request::UpdateRequest;
use crate::{
    self as Install, DependencyID, ExternalSlice, Features, PackageID, PackageManager,
    PackageNameAndVersionHash, PackageNameHash, TruncatedPackageNameHash, dependency,
    dependency::Dependency, dependency::DependencyExt as _, initialize_store,
    invalid_dependency_id, invalid_package_id, npm as Npm,
};
use bun_install_types::NodeLinker::NodeLinker;

// ────────────────────────────────────────────────────────────────────────────
// Sub-module declarations — explicit #[path] attrs for PascalCase / dotted
// file names.
// ────────────────────────────────────────────────────────────────────────────

#[path = "lockfile/Buffers.rs"]
pub mod buffers;
#[path = "lockfile/bun.lock.rs"]
pub mod bun_lock;
#[path = "lockfile/bun.lockb.rs"]
pub mod bun_lockb;
#[path = "lockfile/CatalogMap.rs"]
pub mod catalog_map;
#[path = "lockfile/lockfile_json_stringify_for_debugging.rs"]
pub mod lockfile_json_stringify_for_debugging;
#[path = "lockfile/OverrideMap.rs"]
pub mod override_map;
#[path = "lockfile/override_selector.rs"]
pub(crate) mod override_selector;
#[path = "lockfile/Package.rs"]
pub mod package;
#[path = "lockfile/package_extensions.rs"]
pub(crate) mod package_extensions;
#[path = "lockfile/pruned_workspaces.rs"]
pub(crate) mod pruned_workspaces;
#[path = "lockfile/reachable.rs"]
pub mod reachable;
#[path = "lockfile/Tree.rs"]
pub mod tree;
#[path = "lockfile/printer"]
pub mod printer_mods {
    #[path = "tree_printer.rs"]
    pub mod tree_printer;
    #[path = "Yarn.rs"]
    pub mod yarn;
}

// Sub-module re-exports
pub use self::buffers::Buffers;
use self::bun_lock as TextLockfile;
pub use self::bun_lockb as Serializer;
pub use self::catalog_map::CatalogMap;
pub use self::override_map::OverrideMap;
pub use self::package::Package;
pub use self::tree::Tree;
pub use crate::padding_checker::assert_no_uninitialized_padding;
// Bring the derive-generated `items_*` column accessors (`PackageColumns` for
// `MultiArrayList<Package>`, `PackageColumns` for `Slice<Package>`) into scope.
use self::package::PackageColumns as _;

// Local aliases for module-level types.
type DependencyVersion = dependency::Version;
type ResolutionTag = resolution::Tag;
type SemverStringBuf<'a> = bun_semver::semver_string::Buf<'a>;
type SemverStringBuilder = bun_semver::semver_string::Builder;

// ────────────────────────────────────────────────────────────────────────────
// Type aliases / collection types
// ────────────────────────────────────────────────────────────────────────────

pub(crate) type PackageIDSlice = ExternalSlice<PackageID>;
pub type DependencySlice = ExternalSlice<Dependency>;
pub(crate) type DependencyIDSlice = ExternalSlice<DependencyID>;

pub(crate) type PackageIDList = Vec<PackageID>;
pub(crate) type DependencyList = Vec<Dependency>;
pub(crate) type DependencyIDList = Vec<DependencyID>;

pub(crate) type StringBuffer = Vec<u8>;
pub(crate) type ExternalStringBuffer = Vec<ExternalString>;

pub(crate) type NameHashMap = ArrayHashMap<PackageNameHash, SemverString, ArrayIdentityContextU64>;
/// Value is the exact byte string the key hash was computed from; lookups must
/// compare it since truncated hashes can collide. An empty value is the legacy
/// `bun.lockb` sentinel ("name unknown, hash-only match").
pub(crate) type TrustedDependenciesSet =
    ArrayHashMap<TruncatedPackageNameHash, Box<[u8]>, ArrayIdentityContext>;
pub(crate) type VersionHashMap =
    ArrayHashMap<PackageNameHash, Semver::Version, ArrayIdentityContextU64>;
pub(crate) type PatchedDependenciesMap =
    ArrayHashMap<PackageNameAndVersionHash, PatchedDep, ArrayIdentityContextU64>;

pub(crate) type StringPool = bun_semver::string::StringPool;

pub(crate) type MetaHash = [u8; 32]; // Sha512T256.digest_length
const ZERO_HASH: MetaHash = [0u8; 32];

// The stream owns its backing `Vec<u8>` — every load path hands the file
// contents to the stream anyway,
// which avoids threading a `&mut [u8]` lifetime through the load call graph.
pub(crate) type Stream = bun_io::FixedBufferStream<Vec<u8>>;

// ────────────────────────────────────────────────────────────────────────────
// Lockfile struct
// ────────────────────────────────────────────────────────────────────────────

pub struct Lockfile {
    /// The version of the lockfile format, intended to prevent data corruption for format changes.
    pub(crate) format: FormatVersion,

    pub(crate) text_lockfile_version: bun_lock::Version,

    pub(crate) meta_hash: MetaHash,

    pub packages: PackageList,
    pub buffers: Buffers,

    /// name -> PackageID || [*]PackageID
    /// Not for iterating.
    pub(crate) package_index: PackageIndexMap,
    pub string_pool: StringPool,
    pub(crate) scratch: Scratch,

    pub(crate) scripts: Scripts,
    pub(crate) workspace_paths: NameHashMap,
    pub workspace_versions: VersionHashMap,
    /// Name hashes of the self-contained workspaces, from the manifests. Not saved.
    pub self_contained_workspaces: ArrayHashMap<PackageNameHash, (), ArrayIdentityContextU64>,
    /// The workspaces that are reached through a symlink. They are found on disk while the
    /// workspaces' package.json files are parsed, and are not saved in the lockfile.
    pub(crate) linked_members: LinkedMembers,

    /// Optional because `trustedDependencies` in package.json might be an
    /// empty list or it might not exist
    pub trusted_dependencies: Option<TrustedDependenciesSet>,
    pub(crate) patched_dependencies: PatchedDependenciesMap,
    pub(crate) overrides: OverrideMap,
    pub catalogs: CatalogMap,
    pub(crate) package_extensions: package_extensions::PackageExtensions,

    pub(crate) saved_config_version: Option<ConfigVersion>,

    /// `packages.len()` at the moment lockfile load (including npm/pnpm/yarn
    /// migration) finished. Packages with `id < this` were carried in from a
    /// lockfile and represent a user-pinned resolution; packages with
    /// `id >= this` were appended by manifest fetches in the current
    /// resolve session. See `find_package_id` for when a range shares one of
    /// them. Set by `mark_loaded_packages`; 0 without a lockfile.
    ///
    /// Runtime-only — never serialised.
    pub(crate) loaded_package_count: PackageID,

    /// Packages that a row other than a weak peer (`is_weak_peer`) resolved to at load.
    pub(crate) held_at_load: DynamicBitSet,

    /// Packages that were appended for a dependency on one exact version. A wider range may share
    /// such a package even when the range would pick a higher major version on its own.
    /// Runtime-only, sized lazily.
    pub(crate) exact_pinned: DynamicBitSet,

    /// Packages that so far only rows inside a bundle resolve to. Runtime-only, sized lazily.
    pub(crate) only_bundled: DynamicBitSet,
}

pub(crate) type PackageList = self::package::List<u64>;

/// A workspace whose path from the project root goes through a symlink.
#[derive(Clone)]
pub(crate) struct LinkedMember {
    /// Empty if `realpath` failed.
    pub(crate) real_path: Box<[u8]>,
    is_outside: bool,
}

/// The workspaces that are reached through a symlink, or through a junction on Windows. Real paths
/// are only compared with other real paths, because on Windows `realpath` can spell the project
/// root differently than `top_level_dir` does (drive letter, short names).
#[derive(Clone, Default)]
pub(crate) struct LinkedMembers {
    /// Keyed by the workspace's path relative to the project root, as bun.lock records it.
    members: StringHashMap<LinkedMember>,
    /// Folders that are known not to be symlinks, so that each one is only checked once.
    real_folders: StringHashMap<()>,
    real_root: Box<[u8]>,
}

impl LinkedMembers {
    pub(crate) fn get(&self, path: &[u8]) -> Option<&LinkedMember> {
        if self.members.is_empty() {
            return None;
        }
        self.members.get(strings::without_trailing_slash(path))
    }

    /// Records the workspace at `path` if a symlink leads to it. `is_behind_link` is what the
    /// directory listings showed (see `WorkspaceMap::Entry`). `None` means the disk has to be
    /// asked.
    pub(crate) fn see(&mut self, path: &[u8], is_behind_link: Option<bool>) {
        match is_behind_link {
            Some(false) => {}
            Some(true) => self.add(path),
            None => self.look_at(path),
        }
    }

    /// Returns true if `path` is `folder` or is inside it. Both must be real paths. An empty path,
    /// which means `realpath` failed, never matches.
    fn is_in(folder: &[u8], path: &[u8]) -> bool {
        !folder.is_empty()
            && !path.is_empty()
            && resolve_path::is_parent_or_equal(folder, path)
                != resolve_path::ParentEqual::Unrelated
    }

    /// Checks every folder on the way to the workspace at `path` with `lstat`. This is for a
    /// workspace that no directory listing covered.
    pub(crate) fn look_at(&mut self, path: &[u8]) {
        let path = strings::without_trailing_slash(path);
        if crate::bin::path_climbs_out(path) || self.get(path).is_some() {
            return;
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        let mut end = 0;
        while end < path.len() {
            end = strings::index_of_char_pos(path, b'/', end + 1).unwrap_or(path.len());
            let folder = &path[..end];
            if self.real_folders.contains_key(folder) {
                continue;
            }
            let is_link = !resolve_path::join_abs_string_buf_z_checked::<platform::Auto>(
                FileSystem::instance().top_level_dir(),
                &mut buf.0,
                &[folder],
            )
            .and_then(|folder| sys::lstat(folder).ok())
            .is_some_and(|st| {
                sys::kind_from_mode(st.st_mode as sys::Mode) != sys::EntryKind::SymLink
            });
            if is_link {
                return self.add(path);
            }
            self.real_folders.put(folder, ()).unwrap_or_oom();
        }
    }

    /// Records the workspace at `path`, which is known to be reached through a symlink.
    pub(crate) fn add(&mut self, path: &[u8]) {
        let path = strings::without_trailing_slash(path);
        if crate::bin::path_climbs_out(path) || self.get(path).is_some() {
            return;
        }
        if self.real_root.is_empty() {
            self.real_root = Self::real_path_of(b".");
        }
        let real_path = Self::real_path_of(path);
        let member = LinkedMember {
            is_outside: !Self::is_in(&self.real_root, &real_path),
            real_path,
        };
        self.members.put(path, member).unwrap_or_oom();
    }

    /// `path` is absolute or relative to the project root. Returns an empty path if `realpath`
    /// fails.
    pub(crate) fn real_path_of(path: &[u8]) -> Box<[u8]> {
        let mut buf = bun_paths::path_buffer_pool::get();
        let mut real_buf = bun_paths::path_buffer_pool::get();
        let Some(path) = resolve_path::join_abs_string_buf_z_checked::<platform::Auto>(
            FileSystem::instance().top_level_dir(),
            &mut buf.0,
            &[path],
        ) else {
            return Box::default();
        };
        match sys::realpath(path, &mut *real_buf) {
            Ok(real_path) => real_path.into(),
            Err(_) => Box::default(),
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// DepSorter
// ────────────────────────────────────────────────────────────────────────────

pub(crate) struct DepSorter<'a> {
    pub lockfile: &'a Lockfile,
}

impl<'a> DepSorter<'a> {
    pub(crate) fn is_less_than(&self, l: DependencyID, r: DependencyID) -> bool {
        let deps_buf = self.lockfile.buffers.dependencies.as_slice();
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();

        let l_dep = &deps_buf[l as usize];
        let r_dep = &deps_buf[r as usize];

        match l_dep.behavior.cmp(r_dep.behavior) {
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
    pub(crate) preinstall: Vec<Box<[u8]>>,
    pub(crate) install: Vec<Box<[u8]>>,
    pub(crate) postinstall: Vec<Box<[u8]>>,
    pub(crate) preprepare: Vec<Box<[u8]>>,
    pub(crate) prepare: Vec<Box<[u8]>>,
    pub(crate) postprepare: Vec<Box<[u8]>>,
}

impl Scripts {
    pub(crate) const NAMES: [&'static str; 6] = [
        "preinstall",
        "install",
        "postinstall",
        "preprepare",
        "prepare",
        "postprepare",
    ];

    /// Indexed mutable access matching `NAMES` order.
    pub(crate) fn hook_mut(&mut self, i: usize) -> &mut Vec<Box<[u8]>> {
        match i {
            0 => &mut self.preinstall,
            1 => &mut self.install,
            2 => &mut self.postinstall,
            3 => &mut self.preprepare,
            4 => &mut self.prepare,
            5 => &mut self.postprepare,
            _ => unreachable!(),
        }
    }

    /// (name, &entries) in `NAMES` order — single source of truth for the name half.
    /// The field-ref half stays hand-listed (no field-by-name reflection),
    /// but the string half is derived from `NAMES` so the literals exist exactly once.
    fn fields(&self) -> [(&'static str, &Vec<Box<[u8]>>); 6] {
        [
            (Self::NAMES[0], &self.preinstall),
            (Self::NAMES[1], &self.install),
            (Self::NAMES[2], &self.postinstall),
            (Self::NAMES[3], &self.preprepare),
            (Self::NAMES[4], &self.prepare),
            (Self::NAMES[5], &self.postprepare),
        ]
    }
}

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
            LockfileFormat::Text => zstr!("bun.lock"),
            LockfileFormat::Binary => zstr!("bun.lockb"),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LoadStep {
    OpenFile,
    ReadFile,
    ParseFile,
    Migrating,
}

impl LoadStep {
    pub fn verb(self) -> &'static str {
        match self {
            LoadStep::OpenFile => "open",
            LoadStep::ReadFile => "read",
            LoadStep::ParseFile => "parse",
            LoadStep::Migrating => "migrate",
        }
    }
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
    pub(crate) lockfile_path: &'static ZStr,
    pub(crate) format: LockfileFormat,
}

impl LoadResultErr {
    fn of<'a>(step: LoadStep, value: BunError, format: LockfileFormat) -> LoadResult<'a> {
        LoadResult::Err(LoadResultErr {
            step,
            value,
            lockfile_path: format.filename(),
            format,
        })
    }

    /// Used by the commands that exit on this error. `bun install` continues and prints a different
    /// message.
    #[cold]
    pub(crate) fn report(&self, log: &bun_ast::Log) {
        if crate::migration::reported_unsupported_lockfile_version(self) {
            return;
        }
        Output::err_generic(
            "failed to {s} lockfile: {s}",
            (self.step.verb(), self.value.name()),
        );
        print_log_errors(log);
    }
}

pub(crate) fn print_log_errors(log: &bun_ast::Log) {
    if log.has_errors() {
        let _ = log.print(core::ptr::from_mut(Output::error_writer()));
    }
}

pub struct LoadResultOk<'a> {
    pub lockfile: &'a mut Lockfile,
    pub(crate) migrated: Migrated,
    pub serializer_result: Serializer::SerializerLoadResult,
    pub(crate) format: LockfileFormat,
}

pub enum LoadResult<'a> {
    NotFound,
    Err(LoadResultErr),
    Ok(LoadResultOk<'a>),
}

impl<'a> LoadResult<'a> {
    pub(crate) fn loaded_from_text_lockfile(&self) -> bool {
        match self {
            LoadResult::NotFound => false,
            LoadResult::Err(err) => err.format == LockfileFormat::Text,
            LoadResult::Ok(ok) => ok.format == LockfileFormat::Text,
        }
    }

    pub(crate) fn loaded_from_binary_lockfile(&self) -> bool {
        match self {
            LoadResult::NotFound => false,
            LoadResult::Err(err) => err.format == LockfileFormat::Binary,
            LoadResult::Ok(ok) => ok.format == LockfileFormat::Binary,
        }
    }

    pub(crate) fn migrated_from_npm(&self) -> bool {
        matches!(self, LoadResult::Ok(ok) if ok.migrated == Migrated::Npm)
    }

    pub(crate) fn migrated_from_pnpm(&self) -> bool {
        matches!(self, LoadResult::Ok(ok) if ok.migrated == Migrated::Pnpm)
    }

    pub(crate) fn migrated_from(&self) -> Option<&'static str> {
        match self {
            LoadResult::Ok(LoadResultOk { migrated, .. }) => match migrated {
                Migrated::None => None,
                Migrated::Npm => Some("package-lock.json"),
                Migrated::Yarn => Some("yarn.lock"),
                Migrated::Pnpm => Some("pnpm-lock.yaml"),
            },
            _ => None,
        }
    }

    pub fn save_format(&self, options: &PackageManagerOptions) -> LockfileFormat {
        match (self, options.save_text_lockfile) {
            (_, Some(true)) => LockfileFormat::Text,
            // a new project: text lockfile unless saveTextLockfile is false in bunfig
            (LoadResult::NotFound, None) => LockfileFormat::Text,
            (LoadResult::NotFound, Some(false)) => LockfileFormat::Binary,
            // an error occurred, but we still loaded from an existing lockfile
            (LoadResult::Err(err), _) => err.format,
            (LoadResult::Ok(ok), _) if ok.migrated == Migrated::None => ok.format,
            (LoadResult::Ok(_), Some(false)) => LockfileFormat::Binary,
            (LoadResult::Ok(_), None) => LockfileFormat::Text,
        }
    }

    /// configVersion and boolean for if the configVersion previously existed/needs to be saved to lockfile
    pub(crate) fn choose_config_version(&self) -> (ConfigVersion, bool) {
        self.choose_config_version_with_saved(match self {
            LoadResult::Ok(ok) => ok.lockfile.saved_config_version,
            LoadResult::NotFound | LoadResult::Err(_) => None,
        })
    }

    /// For a caller that holds the lockfile mutably.
    fn choose_config_version_with_saved(
        &self,
        saved_config_version: Option<ConfigVersion>,
    ) -> (ConfigVersion, bool) {
        match self {
            LoadResult::NotFound | LoadResult::Err(_) => (ConfigVersion::CURRENT, true),
            LoadResult::Ok(ok) => match (ok.migrated, saved_config_version) {
                (Migrated::None, Some(config_version)) => (config_version, false),
                (Migrated::Pnpm, _) => (ConfigVersion::V1, true),
                // npm, yarn, or an existing bun project without configVersion
                _ => (ConfigVersion::V0, true),
            },
        }
    }

    /// Resolves `Auto` the way `bun install` picks the linker for this lockfile; never returns `Auto`.
    pub fn node_linker(&self, configured: NodeLinker) -> NodeLinker {
        resolve_node_linker(
            configured,
            self.choose_config_version().0,
            matches!(self, LoadResult::Ok(ok) if ok.lockfile.workspace_paths.len() > 0),
        )
    }

    // Callers reach this only after `handleLoadLockfileErrors` has exited on
    // the `NotFound`/`Err` arms, so the variant is known-`Ok`.
    bun_core::enum_unwrap!(pub LoadResult, Ok => fn ok / ok_mut -> LoadResultOk<'a>);
}

/// Returns the linker for the project in the cwd. Never returns `Auto`.
pub(crate) fn resolve_node_linker(
    configured: NodeLinker,
    config_version: ConfigVersion,
    has_workspaces: bool,
) -> NodeLinker {
    if configured != NodeLinker::Auto {
        return configured;
    }
    // No linker is configured, so a `node_modules` that `--linker=isolated` created stays isolated.
    if (config_version == ConfigVersion::V1 && has_workspaces)
        || sys::directory_exists_at(Fd::cwd(), bun_paths::path_literal!("node_modules/.bun"))
            .unwrap_or(false)
    {
        NodeLinker::Isolated
    } else {
        NodeLinker::Hoisted
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Lockfile impl — load / clone / hoist / etc.
// ────────────────────────────────────────────────────────────────────────────

impl Lockfile {
    pub(crate) fn is_empty(&self) -> bool {
        self.packages.len() == 0
            || (self.packages.len() == 1 && self.packages.get(0).resolutions.len == 0)
    }

    pub fn load_from_cwd<'a, const ATTEMPT_LOADING_FROM_OTHER_LOCKFILE: bool>(
        &'a mut self,
        manager: Option<&mut PackageManager>,
        log: &mut bun_ast::Log,
    ) -> LoadResult<'a> {
        self.load_from_dir::<ATTEMPT_LOADING_FROM_OTHER_LOCKFILE>(Fd::cwd(), manager, log)
    }

    pub fn load_from_dir<'a, const ATTEMPT_LOADING_FROM_OTHER_LOCKFILE: bool>(
        &'a mut self,
        dir: Fd,
        manager: Option<&mut PackageManager>,
        log: &mut bun_ast::Log,
    ) -> LoadResult<'a> {
        let mut result = self.read_from_dir(ATTEMPT_LOADING_FROM_OTHER_LOCKFILE, dir, manager, log);
        if let LoadResult::Ok(ok) = &mut result {
            ok.lockfile.rebase_folder_dependencies().unwrap_or_oom();
        }
        result
    }

    /// Reads bun.lock or bun.lockb. If neither exists, reads another package manager's lockfile to
    /// migrate from.
    fn read_from_dir<'a>(
        &'a mut self,
        attempt_loading_from_other_lockfile: bool,
        dir: Fd,
        manager: Option<&mut PackageManager>,
        log: &mut bun_ast::Log,
    ) -> LoadResult<'a> {
        debug_assert!(Fs::INSTANCE_LOADED.load(core::sync::atomic::Ordering::Relaxed));

        let mut opened = None;
        for format in [LockfileFormat::Text, LockfileFormat::Binary] {
            match File::openat(dir, format.filename(), sys::O::RDONLY, 0) {
                Ok(file) => {
                    opened = Some((file, format));
                    break;
                }
                Err(err) if err.errno != sys::SystemErrno::ENOENT as u16 => {
                    return LoadResultErr::of(LoadStep::OpenFile, err.into(), format);
                }
                Err(_) => {}
            }
        }
        let Some((file, lockfile_format)) = opened else {
            if attempt_loading_from_other_lockfile && let Some(pm) = manager {
                return migration::detect_and_load_other_lockfile(self, dir, pm, log);
            }
            return LoadResult::NotFound;
        };

        let buf = match file.read_to_end() {
            Ok(bytes) => bytes,
            Err(e) => return LoadResultErr::of(LoadStep::ReadFile, e.into(), lockfile_format),
        };

        if lockfile_format == LockfileFormat::Text {
            let source = bun_ast::Source::init_path_string(b"bun.lock", buf.as_slice());
            initialize_store();
            let parsed = match JSON::ParsedJson::parse_package_json(&source, log) {
                Ok(j) => j,
                Err(e) => return LoadResultErr::of(LoadStep::ParseFile, e.into(), lockfile_format),
            };

            if let Err(e) = TextLockfile::parse_into_binary_lockfile(
                self,
                parsed.root,
                &source,
                log,
                manager.as_deref(),
            ) {
                if matches!(e, TextLockfile::ParseError::OutOfMemory) {
                    bun_core::out_of_memory();
                }
                return LoadResultErr::of(LoadStep::ParseFile, e.into(), lockfile_format);
            }

            bun_core::analytics::Features::text_lockfile_inc();

            return LoadResult::Ok(LoadResultOk {
                lockfile: self,
                serializer_result: Serializer::SerializerLoadResult::default(),
                migrated: Migrated::None,
                format: lockfile_format,
            });
        }

        self.load_from_bytes(manager.as_deref(), buf, log)
    }

    pub fn load_from_bytes<'a>(
        &'a mut self,
        pm: Option<&PackageManager>,
        buf: Vec<u8>,
        log: &mut bun_ast::Log,
    ) -> LoadResult<'a> {
        let mut stream = Stream::new(buf);

        self.format = FormatVersion::current();
        self.scripts = Scripts::default();
        self.trusted_dependencies = None;
        self.workspace_paths = NameHashMap::default();
        self.workspace_versions = VersionHashMap::default();
        self.self_contained_workspaces = ArrayHashMap::default();
        self.overrides = OverrideMap::default();
        self.catalogs = CatalogMap::default();
        self.package_extensions = Default::default();
        self.patched_dependencies = PatchedDependenciesMap::default();

        let link_workspace_packages = pm.is_none_or(|pm| pm.options.link_workspace_packages);
        let load_result = match Serializer::load(self, &mut stream, log, pm) {
            Ok(r) => r,
            Err(e) => return LoadResultErr::of(LoadStep::ParseFile, e, LockfileFormat::Binary),
        };

        self.tag_workspace_links(link_workspace_packages);

        LoadResult::Ok(LoadResultOk {
            lockfile: self,
            serializer_result: load_result,
            migrated: Migrated::None,
            format: LockfileFormat::Binary,
        })
    }

    /// The stored literal is relative to the package. `Package::parse` also rebases the
    /// dependencies of local packages.
    pub(crate) fn rebase_folder_dependencies(&mut self) -> Result<(), AllocError> {
        let pkgs = self.packages.slice();
        let mut path_buf = bun_paths::path_buffer_pool::get();
        for (pkg_resolution, pkg_dependencies) in
            (pkgs.items_resolution().iter()).zip(pkgs.items_dependencies())
        {
            let pkg_dir: SemverString = match pkg_resolution.tag {
                ResolutionTag::Root => SemverString::default(),
                ResolutionTag::Workspace => *pkg_resolution.workspace(),
                ResolutionTag::Folder => *pkg_resolution.folder(),
                _ => continue,
            };
            for dep in pkg_dependencies.mut_(self.buffers.dependencies.as_mut_slice()) {
                let is_link = dep.version.tag == dependency::Tag::Symlink;
                if dep.version.tag != dependency::Tag::Folder && !is_link {
                    continue;
                }
                let buf = self.buffers.string_bytes.as_slice();
                let literal = dep.version.literal.sliced(buf);
                let Some(declared) = dependency::parse_with_tag(
                    dep.name,
                    Some(dep.name_hash),
                    literal.slice,
                    dep.version.tag,
                    &literal,
                    None,
                    None,
                ) else {
                    continue;
                };
                let declared_path = if is_link {
                    declared.symlink().slice(buf)
                } else {
                    declared.folder().slice(buf)
                };
                if is_link && !dependency::is_link_path(declared_path) {
                    continue;
                }
                let Some(relative) = package::folder_relative_to_top_level_dir(
                    pkg_dir.slice(buf),
                    declared_path,
                    &mut path_buf[..],
                ) else {
                    continue;
                };
                let mut string_buf = SemverStringBuf {
                    bytes: &mut self.buffers.string_bytes,
                    pool: &mut self.string_pool,
                };
                if is_link {
                    dep.version.value.symlink =
                        string_buf.append(&dependency::link_path_for_lockfile(relative))?;
                } else {
                    dep.version.value.folder = string_buf.append(relative)?;
                }
            }
        }
        Ok(())
    }

    pub(crate) fn is_resolved_dependency_disabled(
        &self,
        dep_id: DependencyID,
        features: Features,
        meta: &package::Meta,
        cpu: Npm::Architecture,
        os: Npm::OperatingSystem,
        libc: Npm::Libc,
    ) -> bool {
        let dep = &self.buffers.dependencies[dep_id as usize];

        meta.is_disabled(cpu, os, libc.for_dependency(dep.behavior))
            || !dep.behavior.is_placed(features)
    }

    pub fn resolve_catalog_dependency(&self, dep: &Dependency) -> Option<DependencyVersion> {
        if dep.version.tag != dependency::Tag::Catalog {
            return Some(dep.version.clone());
        }

        let catalog_name = *dep.version.catalog();
        let catalog_dep = self.catalogs.get(self, catalog_name, dep.name)?;

        Some(catalog_dep.version)
    }

    /// Is this a direct dependency of the workspace root package.json?
    pub(crate) fn is_workspace_root_dependency(&self, id: DependencyID) -> bool {
        self.packages.items_dependencies()[0].contains(id)
    }

    /// Returns `None` for git, tarball and unversioned workspace packages, which have no version to
    /// compare.
    pub(crate) fn package_version(&self, id: PackageID) -> Option<Semver::Version> {
        let resolution = &self.packages.items_resolution()[id as usize];
        match resolution.tag {
            ResolutionTag::Npm => Some(resolution.npm().version),
            ResolutionTag::Workspace => self
                .workspace_versions
                .get(&self.packages.items_name_hash()[id as usize])
                .copied(),
            _ => None,
        }
    }

    /// Returns true for an optional peer, and for a peer without an override that's bound to a
    /// version outside its range.
    pub(crate) fn is_weak_peer(&self, id: DependencyID, target: PackageID) -> bool {
        let dependency = &self.buffers.dependencies[id as usize];
        if !dependency.behavior.is_peer() || dependency.behavior.is_optional_peer() {
            return dependency.behavior.is_peer();
        }
        let buf = self.buffers.string_bytes.as_slice();
        let range = self.catalogs.resolve_range(buf, dependency);
        range.try_npm().is_some_and(|npm| {
            (self.package_version(target))
                .is_some_and(|version| !npm.version.satisfies(version, buf, buf))
        }) && !self.is_overridden_dependency(id)
    }

    /// Is `id` a direct dependency of one of the `targets` workspaces?
    pub fn is_dependency_of_workspace_in(
        &self,
        targets: &[crate::package_manager::UpdateTargetWorkspace],
        id: DependencyID,
    ) -> bool {
        let pkg_id = self.get_workspace_pkg_if_workspace_dep(id);
        if pkg_id == invalid_package_id {
            return false;
        }
        let is_root =
            self.packages.items_resolution()[pkg_id as usize].tag == crate::resolution::Tag::Root;
        let hash = self.packages.items_name_hash()[pkg_id as usize];
        let name =
            self.packages.items_name()[pkg_id as usize].slice(self.buffers.string_bytes.as_slice());
        targets.iter().any(|t| t.matches(is_root, hash, name))
    }

    /// Is this a direct dependency of any workspace (including workspace root)?
    /// TODO make this faster by caching the workspace package ids
    pub(crate) fn is_workspace_dependency(&self, id: DependencyID) -> bool {
        self.get_workspace_pkg_if_workspace_dep(id) != invalid_package_id
    }

    /// Returns the packages with this name, highest version first (see `get_or_put_id`). Empty if
    /// there are none.
    pub(crate) fn packages_named(&self, name_hash: PackageNameHash) -> &[PackageID] {
        self.package_index
            .get(&name_hash)
            .map_or(&[], PackageIndexEntry::as_slice)
    }

    pub(crate) fn package_satisfying(
        &self,
        name_hash: PackageNameHash,
        version: &DependencyVersion,
        accept: impl Fn(PackageID) -> bool,
    ) -> Option<PackageID> {
        TextLockfile::resolve_peer_dep_by_range(
            version,
            name_hash,
            &self.package_index,
            self.packages.items_resolution(),
            self.buffers.string_bytes.as_slice(),
            accept,
        )
    }

    /// Returns a patched npm package that `version` still allows. `bun update` keeps dependencies
    /// on it.
    pub(crate) fn patched_package_satisfying(
        &self,
        name_hash: PackageNameHash,
        version: &DependencyVersion,
    ) -> Option<PackageID> {
        if self.patched_dependencies.count() == 0 {
            return None;
        }
        self.package_satisfying(name_hash, version, |id| {
            let label = crate::dedupe::label(self, id);
            self.patched_dependencies
                .contains(&SemverStringBuilder::string_hash(&label))
        })
    }

    /// `None` for the edges `enqueue_dependency_to_root` appends outside of any package.
    pub(crate) fn get_parent_pkg_of_dependency(&self, id: DependencyID) -> Option<PackageID> {
        (self.packages.items_dependencies().iter())
            .position(|dependencies| dependencies.contains(id))
            .map(|pkg_id| pkg_id as PackageID)
    }

    pub(crate) fn has_equal_root_dependency(&self, dependency: &Dependency) -> bool {
        let buf = self.buffers.string_bytes.as_slice();
        self.packages.items_dependencies()[0]
            .get(self.buffers.dependencies.as_slice())
            .iter()
            .any(|root_dependency| root_dependency.eql(dependency, buf, buf))
    }

    pub(crate) fn get_workspace_pkg_if_workspace_dep(&self, id: DependencyID) -> PackageID {
        let packages = self.packages.slice();
        (packages.items_resolution().iter())
            .zip(packages.items_dependencies())
            .position(|(resolution, dependencies)| {
                matches!(
                    resolution.tag,
                    ResolutionTag::Workspace | ResolutionTag::Root
                ) && dependencies.contains(id)
            })
            .map_or(invalid_package_id, |pkg_id| pkg_id as PackageID)
    }

    /// Workspace packages whose node_modules must be self-contained: listed in the
    /// root manifest's `workspaces.selfContained` (by path or name) or declaring
    /// `"installConfig": { "hoistingLimits": "workspaces" }` in their own manifest.
    /// Both are recorded in `self_contained_workspaces` while the workspaces are
    /// parsed.
    pub(crate) fn self_contained_workspace_ids(&self) -> Vec<PackageID> {
        if self.self_contained_workspaces.count() == 0 {
            return Vec::new();
        }
        let mut out = Vec::new();
        let pkgs = self.packages.slice();
        for (i, res) in pkgs.items_resolution().iter().enumerate() {
            if res.tag == crate::resolution::Tag::Workspace
                && self
                    .self_contained_workspaces
                    .contains(&pkgs.items_name_hash()[i])
            {
                out.push(i as PackageID);
            }
        }
        out
    }

    /// Returns true if `pkg_id` is a workspace whose folder is outside the project. Another project
    /// may own that folder, so nothing is ever deleted from its `node_modules`.
    pub(crate) fn is_member_outside(&self, pkg_id: PackageID) -> bool {
        let res = &self.packages.items_resolution()[pkg_id as usize];
        res.tag == ResolutionTag::Workspace
            && self.is_member_path_outside(res.workspace().slice(&self.buffers.string_bytes))
    }

    pub(crate) fn is_member_path_outside(&self, path: &[u8]) -> bool {
        crate::bin::path_climbs_out(path)
            || (self.linked_members.get(path)).is_some_and(|member| member.is_outside)
    }

    /// The workspace (or root, 0) package that owns tree `id`: walk up until a
    /// workspace/root tree is reached and return the package it stands for.
    pub(crate) fn owning_workspace_of_tree(&self, mut id: tree::Id) -> PackageID {
        while id != 0 && (id as usize) < self.buffers.trees.len() {
            let t = &self.buffers.trees[id as usize];
            let dep_id = t.dependency_id;
            if (dep_id as usize) < self.buffers.dependencies.len()
                && self.buffers.dependencies[dep_id as usize]
                    .behavior
                    .is_workspace()
            {
                return self.buffers.resolutions[dep_id as usize];
            }
            id = t.parent;
        }
        0
    }

    /// Does the root or a workspace depend on package `id` directly?
    pub(crate) fn is_workspace_declared_package(&self, id: PackageID) -> bool {
        let packages = self.packages.slice();
        let resolutions = self.buffers.resolutions.as_slice();
        (packages.items_resolution().iter())
            .zip(packages.items_resolutions())
            .any(|(resolution, res_list)| {
                matches!(
                    resolution.tag,
                    ResolutionTag::Workspace | ResolutionTag::Root
                ) && res_list.get(resolutions).contains(&id)
            })
    }

    /// Compares paths, because bun.lock can bind a dependency that a `file:` override applies to,
    /// to any folder.
    fn is_override_selected_package(&self, id: PackageID) -> bool {
        if self.overrides.is_empty() {
            return false;
        }
        let buf = self.buffers.string_bytes.as_slice();
        let folder = self.packages.items_resolution()[id as usize].folder();
        let Some(selected) = join_top_level_dir(&[folder.slice(buf)]) else {
            return false;
        };
        let selected = strings::without_trailing_slash(selected.slice());
        (self.buffers.resolutions.iter().enumerate()).any(|(row, &target)| {
            let dependency = &self.buffers.dependencies[row];
            target == id
                && crate::dedupe::applied_override(self, row as DependencyID, dependency)
                    .map(|rule| rule.version())
                    .filter(|version| version.tag == dependency::version::Tag::Folder)
                    .and_then(|version| join_top_level_dir(&[version.folder().slice(buf)]))
                    .is_some_and(|named| strings::without_trailing_slash(named.slice()) == selected)
        })
    }

    /// Returns true if dependency `id` is declared by the root, a workspace, or a `file:` package
    /// that one of them depends on or overrides to. This is checked rather than assumed, because a
    /// migrated lockfile can have dependencies for a folder that a registry package shipped.
    pub(crate) fn is_dependency_of_local_package(&self, id: DependencyID) -> bool {
        self.get_parent_pkg_of_dependency(id)
            .is_some_and(|parent_id| self.is_local_declarer(parent_id))
    }

    /// See `is_dependency_of_local_package`.
    pub(crate) fn is_local_declarer(&self, id: PackageID) -> bool {
        match self.packages.items_resolution()[id as usize].tag {
            ResolutionTag::Root | ResolutionTag::Workspace => true,
            ResolutionTag::Folder => {
                self.is_workspace_declared_package(id) || self.is_override_selected_package(id)
            }
            _ => false,
        }
    }

    /// May the folder path of dependency `id` leave its package directory? Yes
    /// when a local package declares the dependency, or when a plain override or
    /// resolution supplies the path (those are only ever parsed from the root
    /// package.json). Both are user authored, like a root `file:` dependency.
    pub(crate) fn is_trusted_folder_dependency(&self, id: DependencyID) -> bool {
        if self.is_dependency_of_local_package(id) {
            return true;
        }
        let buf = self.buffers.string_bytes.as_slice();
        let dep = &self.buffers.dependencies[id as usize];
        self.overrides
            .contains_name(dep.name_hash, dep.name.slice(buf), buf)
    }

    /// Returns true if dependency `id` is a `file:` folder inside the package that declares it. The
    /// lifecycle scripts of such a folder aren't run.
    pub fn is_folder_inside_declarer(&self, id: DependencyID) -> bool {
        let target = self.buffers.resolutions[id as usize] as usize;
        target < self.packages.len()
            && self.packages.items_resolution()[target].tag == ResolutionTag::Folder
            && !self.is_trusted_folder_dependency(id)
    }

    /// Returns true if `is_trusted_folder_dependency` holds for any dependency that resolves to
    /// `id`, whether or not this install links it.
    pub(crate) fn is_trusted_folder_package(&self, id: PackageID) -> bool {
        (0..self.buffers.resolutions.len()).any(|dep_id| {
            self.buffers.resolutions[dep_id] == id
                && self.is_trusted_folder_dependency(dep_id as DependencyID)
        })
    }

    /// Does this tree id belong to a workspace (including workspace root)?
    /// TODO(dylan-conway) fix!
    pub(crate) fn is_workspace_tree_id(&self, id: tree::Id) -> bool {
        id == 0
            || self.buffers.dependencies[self.buffers.trees[id as usize].dependency_id as usize]
                .behavior
                .is_workspace()
    }

    /// The folder dependencies of a `file:` folder are relative to the project root, not to the
    /// package.
    pub(crate) fn is_folder_tree_id(&self, id: tree::Id) -> bool {
        self.tree_owner_tag(id) == Some(ResolutionTag::Folder)
    }

    /// Returns true if tree `id` is the `node_modules` of the project or of a workspace. Users
    /// sometimes make that folder a symlink to another volume or to a store.
    pub(crate) fn is_importer_tree_id(&self, id: tree::Id) -> bool {
        id == 0 || self.tree_owner_tag(id) == Some(ResolutionTag::Workspace)
    }

    fn tree_owner_tag(&self, id: tree::Id) -> Option<ResolutionTag> {
        if id == 0 {
            return None;
        }
        let dependency_id = self.buffers.trees[id as usize].dependency_id;
        let package_id = self.buffers.resolutions[dependency_id as usize];
        (package_id != invalid_package_id)
            .then(|| self.packages.slice().items_resolution()[package_id as usize].tag)
    }

    /// A folder's `node_modules` isn't copied, so the linkers link these to
    /// `<path>/node_modules/<name>`.
    pub(crate) fn bundled_by_folder<'a>(
        &'a self,
        path: &'a [u8],
    ) -> impl Iterator<Item = &'a Dependency> {
        let buf = self.buffers.string_bytes.as_slice();
        (self.packages.items_resolution().iter())
            .zip(self.packages.items_dependencies())
            .find(|(resolution, _)| {
                resolution.tag == ResolutionTag::Folder && resolution.folder().slice(buf) == path
            })
            .map_or(&[][..], |(_, rows)| {
                rows.get(self.buffers.dependencies.as_slice())
            })
            .iter()
            .filter(|dependency| dependency.behavior.is_bundled())
    }

    pub(crate) fn is_overridden_dependency(&self, id: DependencyID) -> bool {
        let dependency = &self.buffers.dependencies[id as usize];
        self.overrides.get(self, id, dependency.name_hash).is_some()
    }

    /// Returns the package id of the workspace the install is taking place in.
    pub(crate) fn get_workspace_package_id(
        &self,
        workspace_name_hash: Option<PackageNameHash>,
    ) -> PackageID {
        let Some(workspace_name_hash) = workspace_name_hash else {
            return 0;
        };
        let packages = self.packages.slice();
        (packages.items_resolution().iter())
            .zip(packages.items_name_hash())
            .position(|(res, name_hash)| {
                res.tag == ResolutionTag::Workspace && *name_hash == workspace_name_hash
            })
            // should not hit this, default to root just in case
            .map_or(0, |i| i as PackageID)
    }

    /// The workspaces whose dependency lists `request` names: the ones that received it under `--filter` / `-r`, else the cwd's.
    pub(crate) fn workspaces_of_update_request(
        &self,
        pending: Option<&crate::package_manager_real::add_remove_with_filter::PendingWrite>,
        workspace_name_hash: Option<PackageNameHash>,
        request: &UpdateRequest,
    ) -> Vec<PackageID> {
        match pending {
            Some(pending) => pending.workspace_ids_receiving(self, request.name_hash),
            None => vec![self.get_workspace_package_id(workspace_name_hash)],
        }
    }

    /// Re-runnable: package_json_write_back binds again after re-deriving the declared columns.
    #[cold]
    #[inline(never)]
    pub(crate) fn bind_update_requests(
        &self,
        pending: Option<&crate::package_manager_real::add_remove_with_filter::PendingWrite>,
        workspace_name_hash: Option<PackageNameHash>,
        updates: &mut [UpdateRequest],
    ) {
        // `version_buf` is a raw (ptr, len) into `self.buffers.string_bytes`, finalized by now and outliving every `UpdateRequest`.
        let string_buf = self.buffers.string_bytes.as_slice();
        let string_buf_ptr = bun_ptr::RawSlice::new(string_buf);
        let slice = self.packages.slice();

        'request_updated: for update in updates.iter_mut() {
            update.e_string = None;
            let workspace_ids =
                self.workspaces_of_update_request(pending, workspace_name_hash, update);
            for &workspace_package_id in &workspace_ids {
                let dep_list = slice.items_dependencies()[workspace_package_id as usize];
                let res_list = slice.items_resolutions()[workspace_package_id as usize];
                let workspace_deps: &[Dependency] =
                    dep_list.get(self.buffers.dependencies.as_slice());
                let resolved_ids: &[PackageID] = res_list.get(self.buffers.resolutions.as_slice());
                debug_assert_eq!(resolved_ids.len(), workspace_deps.len());
                for (&package_id, dep) in resolved_ids.iter().zip(workspace_deps.iter()) {
                    // The root's implicit `workspaces` rows are not package.json entries.
                    if dep.behavior.is_workspace() {
                        continue;
                    }
                    if update.matches(dep, string_buf) {
                        if package_id as usize > self.packages.len() {
                            // `-r` binds the request once per workspace, so clear what another
                            // workspace's entry bound.
                            update.package_id = invalid_package_id;
                            continue;
                        }
                        update.version_buf = string_buf_ptr;
                        update.version = dep.version.clone();
                        update.package_id = package_id;

                        continue 'request_updated;
                    }
                }
            }
        }
    }

    // `#[inline(never)]` keeps the panic/format machinery from
    // `bun_core::output` (pulled in by the cold helpers below) out of callers;
    // the hot copy/remap loop stays in this body while the cold sections
    // — update-request binding (`bind_update_requests`), verbose timer
    // reporting, and the patched-dependency migration — are outlined so a
    // no-change `bun install` (install/fastify bench) does not page them in.
    #[inline(never)]
    pub(crate) fn clean_with_logger(
        &mut self,
        manager: &mut PackageManager,
        updates: &mut [UpdateRequest],
        log: &mut bun_ast::Log,
        log_level: LogLevel,
    ) -> Result<Box<Lockfile>, BunError> {
        let old: &mut Lockfile = self;
        let timer: Option<Timer> = if log_level.is_verbose() {
            Some(clean_verbose_timer_start()?)
        } else {
            None
        };

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

        let mut new: Box<Lockfile> = Box::default();
        new.string_pool
            .ensure_total_capacity(old.string_pool.capacity())?;
        new.package_index
            .ensure_total_capacity(old.package_index.capacity())?;
        new.packages.ensure_total_capacity(old.packages.len())?;
        new.buffers.preallocate(&old.buffers)?;
        new.patched_dependencies
            .ensure_total_capacity(old.patched_dependencies.count())?;

        old.scratch.dependency_list_queue.clear();

        {
            let old_buf = old.buffers.string_bytes.as_slice();
            let (mut builder, lf) = new.string_builder_split();
            old.overrides.count(old_buf, &mut builder);
            old.catalogs.count(old_buf, &mut builder);
            builder.allocate()?;
            *lf.overrides = old.overrides.clone(manager, old_buf, &mut builder)?;
            *lf.catalogs = old.catalogs.clone(manager, old_buf, &mut builder)?;
        }

        // Step 1. Recreate the lockfile with only the packages that are still alive
        let root = old.root_package().ok_or(crate::Error::NoPackage)?;

        let mut package_id_mapping = vec![invalid_package_id; old.packages.len()];
        let mut cloner = Cloner {
            old: &mut *old,
            lockfile: &mut *new,
            mapping: &mut package_id_mapping,
            clone_queue: PendingResolutions::new(),
            weak_peers: PendingResolutions::new(),
            log: &mut *log,
            old_preinstall_state,
            manager: &mut *manager,
        };

        let _ = root.clone(&mut cloner)?;

        {
            let old = &mut *cloner.old;
            let new = &mut *cloner.lockfile;

            // Clone workspace_paths and workspace_versions at the end.
            if old.workspace_paths.count() > 0 || old.workspace_versions.count() > 0 {
                new.workspace_paths
                    .ensure_total_capacity(old.workspace_paths.count())?;
                new.workspace_versions
                    .ensure_total_capacity(old.workspace_versions.count())?;

                let mut workspace_paths_builder = string_builder!(new);

                // Sort by name for determinism
                {
                    let string_buf = old.buffers.string_bytes.as_slice();
                    old.workspace_paths.sort(|_keys, values, a, b| {
                        values[a].order(values[b], string_buf, string_buf) == Ordering::Less
                    });
                }

                let old_string_buf = old.buffers.string_bytes.as_slice();
                for path in old.workspace_paths.values() {
                    workspace_paths_builder.count(path.slice(old_string_buf));
                }
                let versions: &[Semver::Version] = old.workspace_versions.values();
                for version in versions {
                    version.count(old_string_buf, &mut workspace_paths_builder);
                }

                workspace_paths_builder.allocate()?;

                // SAFETY: capacity reserved by `ensure_total_capacity` above; every
                // slot in `0..old.count()` is overwritten by the copy/zip loops below
                // before `re_index()` reads them.
                unsafe {
                    new.workspace_paths
                        .set_entries_len(old.workspace_paths.count())
                };

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
                    *dest =
                        workspace_paths_builder.append::<SemverString>(src.slice(old_string_buf));
                }
                new.workspace_paths
                    .keys_mut()
                    .copy_from_slice(old.workspace_paths.keys());

                new.workspace_versions
                    .ensure_total_capacity(old.workspace_versions.count())?;
                // SAFETY: capacity reserved immediately above; every slot is filled by
                // the zip loop below before `re_index()`.
                unsafe {
                    new.workspace_versions
                        .set_entries_len(old.workspace_versions.count())
                };
                for (src, dest) in versions
                    .iter()
                    .zip(new.workspace_versions.values_mut().iter_mut())
                {
                    *dest = src.append(old_string_buf, &mut workspace_paths_builder);
                }

                new.workspace_versions
                    .keys_mut()
                    .copy_from_slice(old.workspace_versions.keys());

                workspace_paths_builder.clamp();

                new.workspace_versions.re_index()?;
                new.workspace_paths.re_index()?;
            }
            for key in old.self_contained_workspaces.keys() {
                new.self_contained_workspaces.put(*key, ())?;
            }
            new.linked_members = old.linked_members.clone();
        }

        // When you run `"bun add react"
        // This is where we update it in the lockfile from "latest" to "^17.0.2"
        let moved_a_row = cloner.flush()?;
        drop(cloner);

        new.trusted_dependencies = old_trusted_dependencies;
        new.scripts = old_scripts;
        new.meta_hash = old.meta_hash;
        // Carry the on-disk format version over from the lockfile we loaded so a
        // re-save preserves it (a fresh `new` defaults to the current version).
        new.text_lockfile_version = old.text_lockfile_version;

        if old.patched_dependencies.count() > 0 {
            clean_migrate_patched_dependencies_cold(old, &mut new)?;
        }
        if !old.package_extensions.applied.is_empty() {
            new.keep_package_extensions_of(old);
        }

        // `flush` rebinds peers after it has chosen which packages to copy, so a copied package may
        // no longer be used by any dependency. With a frozen lockfile it is kept, because older
        // versions of Bun saved it and the hash in their bun.lockb covers it.
        if moved_a_row {
            let held =
                reachable::packages(&new, &new.buffers.resolutions, reachable::Options::all(0));
            if held.count() < new.packages.len() {
                // The second pass removes nothing else: a weak peer keeps the package it is bound
                // to.
                new.held_at_load = DynamicBitSet::init_empty(new.packages.len())?;
                return new.clean_with_logger(manager, updates, log, log_level);
            }
        }

        if !updates.is_empty() {
            new.bind_update_requests(
                manager.pending_filtered_write.as_deref(),
                manager.workspace_name_hash,
                updates,
            );
        }

        if log_level.is_verbose() {
            clean_verbose_report_cold(old, &new, timer.as_ref());
        }

        Ok(new)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// clean_with_logger cold helpers — outlined so the hot copy/remap loop in the
// main body is contiguous in `.text` and the install/fastify no-change bench
// does not fault in update-request binding, patched-dep migration, or the
// verbose timer/format machinery.
// ────────────────────────────────────────────────────────────────────────────

#[cold]
#[inline(never)]
fn clean_verbose_timer_start() -> Result<Timer, BunError> {
    Ok(Timer::start()?)
}

#[cold]
#[inline(never)]
fn clean_verbose_report_cold(old: &Lockfile, new: &Lockfile, timer: Option<&Timer>) {
    bun_core::pretty_errorln!(
        "Clean lockfile: {} packages -> {} packages in {}\n",
        old.packages.len(),
        new.packages.len(),
        // SAFETY: only entered when `log_level.is_verbose()`, which set `timer = Some(..)`.
        bun_core::fmt::fmt_duration_one_decimal(timer.unwrap().read()),
    );
}

#[cold]
#[inline(never)]
fn clean_migrate_patched_dependencies_cold(
    old: &Lockfile,
    new: &mut Lockfile,
) -> Result<(), BunError> {
    let mut builder = string_builder!(new);
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
    Ok(())
}

// ────────────────────────────────────────────────────────────────────────────
// MetaHashFormatter
// ────────────────────────────────────────────────────────────────────────────

pub struct MetaHashFormatter<'a> {
    pub(crate) meta_hash: &'a MetaHash,
}

impl<'a> fmt::Display for MetaHashFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let remain: &[u8] = &self.meta_hash[..];

        // Alternating uppercase/lowercase hex groups; `HexBytes` emits two
        // digits per byte, contiguous, no separators.
        write!(
            f,
            "{}-{}-{}-{}",
            bun_core::fmt::HexBytes::<false>(&remain[0..8]),
            bun_core::fmt::HexBytes::<true>(&remain[8..16]),
            bun_core::fmt::HexBytes::<false>(&remain[16..24]),
            bun_core::fmt::HexBytes::<true>(&remain[24..32]),
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
    pub(crate) clone_queue: PendingResolutions,
    /// Bound in `flush`, once `clone_queue` has decided which targets survive.
    pub(crate) weak_peers: PendingResolutions,
    pub lockfile: &'a mut Lockfile,
    pub(crate) old: &'a mut Lockfile,
    pub(crate) mapping: &'a mut [PackageID],
    pub(crate) log: &'a mut bun_ast::Log,
    pub(crate) old_preinstall_state: Vec<Install::PreinstallState>,
    pub(crate) manager: &'a mut PackageManager,
}

impl<'a> Cloner<'a> {
    /// Returns a required peer whose dropped target was the last package with that name, so nothing
    /// would bind it again.
    fn peer_on_last_copy(&mut self) -> Option<PendingResolution> {
        let name_hashes = self.old.packages.items_name_hash();
        let dependencies = self.lockfile.buffers.dependencies.as_slice();
        let index = self.weak_peers.iter().position(|peer| {
            self.mapping[peer.old_resolution as usize] == invalid_package_id
                && !dependencies[peer.resolve_id as usize]
                    .behavior
                    .is_optional_peer()
                && (self.lockfile)
                    .packages_named(name_hashes[peer.old_resolution as usize])
                    .is_empty()
        })?;
        Some(self.weak_peers.swap_remove(index))
    }

    /// Returns whether hoisting rebound a dependency to a different package than the one that was
    /// copied for it. Always false with a frozen lockfile, where the caller does not need to know.
    pub(crate) fn flush(&mut self) -> Result<bool, BunError> {
        let max_package_id = self.old.packages.len();
        while let Some(to_clone) = (self.clone_queue.pop()).or_else(|| self.peer_on_last_copy()) {
            let mapping = self.mapping[to_clone.old_resolution as usize];
            if (mapping as usize) < max_package_id {
                self.lockfile.buffers.resolutions[to_clone.resolve_id as usize] = mapping;
                continue;
            }

            let old_package = *self.old.packages.get(to_clone.old_resolution as usize);

            let new_id = old_package.clone(self)?;
            self.lockfile.buffers.resolutions[to_clone.resolve_id as usize] = new_id;
        }

        // bun.lock.rs binds these before hoisting; the hoist below has to see the same bindings.
        for pending in self.weak_peers.drain(..) {
            let mapping = self.mapping[pending.old_resolution as usize];
            if (mapping as usize) < max_package_id {
                self.lockfile.buffers.resolutions[pending.resolve_id as usize] = mapping;
            }
        }

        // cloning finished, items in lockfile buffer might have a different order, meaning
        // package ids and dependency ids have changed
        self.manager
            .clear_cached_items_depending_on_lockfile_buffer();

        let mut moved_a_row = false;
        if self.lockfile.packages.len() != 0 {
            let copied = (!self.manager.options.enable.frozen_lockfile())
                .then(|| self.lockfile.buffers.resolutions.clone());
            self.lockfile.resolve(self.log)?;
            moved_a_row = copied.is_some_and(|copied| {
                (copied.iter().zip(&self.lockfile.buffers.resolutions))
                    .any(|(&before, &after)| before != after && before != invalid_package_id)
            });
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
        Ok(moved_a_row)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// resolve / filter / hoist
// ────────────────────────────────────────────────────────────────────────────

impl Lockfile {
    /// Hoists again for as long as a pass binds or rebinds a peer. The result is then the same as
    /// after a reload of the lockfile, where those peers are bound before the first pass.
    pub(crate) fn resolve(&mut self, log: &mut bun_ast::Log) -> Result<(), tree::SubtreeError> {
        const METHOD: tree::BuilderMethod = tree::BuilderMethod::Resolvable;
        while (self.hoist::<METHOD>(log, None, true, &[], None, tree::Layout::Locked)?)
            .late_bound_peer
        {}
        TextLockfile::rebind_peers_to_printed_packages(self)?;
        Ok(())
    }

    pub(crate) fn filter(
        &mut self,
        log: &mut bun_ast::Log,
        manager: &mut PackageManager,
        install_root_dependencies: bool,
        workspace_filters: &[WorkspaceFilter],
        packages_to_install: Option<&[PackageID]>,
    ) -> Result<tree::Hoisted, tree::SubtreeError> {
        self.hoist::<{ tree::BuilderMethod::Filter }>(
            log,
            Some(manager),
            install_root_dependencies,
            workspace_filters,
            packages_to_install,
            tree::Layout::Locked,
        )
    }

    /// Sets `buffers.trees`/`hoisted_dependencies`.
    /// `Filter` without a `manager` gives the install tree for every dependency type, workspace and
    /// platform.
    pub(crate) fn hoist<const METHOD: tree::BuilderMethod>(
        &mut self,
        log: &mut bun_ast::Log,
        manager: Option<&PackageManager>,
        install_root_dependencies: bool,
        workspace_filters: &[WorkspaceFilter],
        packages_to_install: Option<&[PackageID]>,
        layout: tree::Layout,
    ) -> Result<tree::Hoisted, tree::SubtreeError> {
        let slice = self.packages.slice();

        // Only the install applies the barrier, so the saved tree does not depend on it.
        let self_contained = if METHOD == tree::BuilderMethod::Filter {
            self.self_contained_workspace_ids()
        } else {
            Vec::new()
        };

        // Lets the `&mut buffers.resolutions` split-borrow below coexist with `Builder::lockfile`.
        let lockfile_ref = bun_ptr::ParentRef::<Lockfile>::new(&*self);
        let mut builder = tree::Builder::<METHOD> {
            self_contained,
            queue: tree::TreeFiller::init(),
            resolution_lists: slice.items_resolutions(),
            resolutions: self.buffers.resolutions.as_mut_slice(),
            dependencies: self.buffers.dependencies.as_slice(),
            log,
            lockfile: lockfile_ref,
            manager,
            install_root_dependencies,
            workspace_filters,
            packages_to_install,
            pending_peers: Default::default(),
            late_bound_peer: false,
            bundle_placed: false,
            walked: DynamicBitSet::init_empty(slice.len())?,
            served: Default::default(),
            list: Default::default(),
            sort_buf: Default::default(),
            peer_probes: Default::default(),
            // Most lookups find nothing, and a miss is cheap in a table that is at most half full.
            placed: tree::Placed::with_capacity(slice.len() * 2),
            replaced_row: false,
            shipped_rows: Default::default(),
            in_shipped_folder: false,
            contested: Default::default(),
            contested_rows: Default::default(),
            kept: None,
            older_layout: layout == tree::Layout::Older,
            places: Vec::new(),
            linked: Default::default(),
        };

        Tree::default().process_subtree(tree::ROOT_DEP_ID, tree::INVALID_ID, &mut builder)?;

        // This goes breadth-first
        while let Some(item) = builder.queue.read_item() {
            use tree::BuilderEntryColumns as _;
            let tree = builder.list.items_tree()[item.tree_id as usize];
            tree.process_subtree(item.dependency_id, item.hoist_root_id, &mut builder)?;
        }

        tree::bind_served_peers(
            &mut builder.served,
            &builder.list,
            builder.dependencies,
            &mut *builder.resolutions,
        );
        builder.keep_linked_rows();
        let cleaned = builder.clean()?;
        let hoisted = tree::Hoisted {
            late_bound_peer: builder.late_bound_peer,
            places: core::mem::take(&mut builder.places),
        };
        self.buffers.trees = cleaned.trees;
        self.buffers.hoisted_dependencies = cleaned.dep_ids;
        Ok(hoisted)
    }
}

#[derive(Clone, Copy)]
pub struct PendingResolution {
    pub(crate) old_resolution: PackageID,
    pub(crate) resolve_id: PackageID,
}

pub(crate) type PendingResolutions = Vec<PendingResolution>;

// ────────────────────────────────────────────────────────────────────────────
// fetchNecessaryPackageMetadataAfterYarnOrPnpmMigration
// ────────────────────────────────────────────────────────────────────────────

/// Returns `<registry>/<name>/-/<name without its scope>-<version>.tgz`.
fn registry_tarball_url(
    registry: &[u8],
    name: &[u8],
    version: Semver::Version,
    buf: &[u8],
) -> Vec<u8> {
    let mut url = Vec::new();
    // Writing to a `Vec` does not fail.
    let _ = crate::extract_tarball::build_url_with_printer(
        registry,
        &strings::StringOrTinyString::init(name),
        version,
        buf,
        |args| url.write_fmt(args),
    );
    url
}

impl Lockfile {
    /// `fill_integrity`: yarn berry records a checksum of its own zip archive, not of the tarball.
    /// `only`: package-lock.json records this metadata for the other packages, so only these are
    /// completed.
    pub(crate) fn fetch_necessary_package_metadata_after_yarn_or_pnpm_migration(
        &mut self,
        manager: &mut PackageManager,
        update_os_cpu: bool,
        fill_integrity: bool,
        only: Option<&[PackageID]>,
    ) -> Result<(), AllocError> {
        // Manifests are fetched for `manager.lockfile`, but `bun why` and `bun pm diff` load into a
        // different lockfile.
        let detached =
            fill_integrity && !core::ptr::eq(&raw const *self, &raw const *manager.lockfile);
        if detached {
            core::mem::swap(self, &mut *manager.lockfile);
        }
        let populated = populate_manifest_cache::populate_manifest_cache(
            manager,
            only.map_or(
                populate_manifest_cache::Packages::All,
                populate_manifest_cache::Packages::Exact,
            ),
        );
        if detached {
            core::mem::swap(self, &mut *manager.lockfile);
        }
        if populated.is_err() {
            return Ok(());
        }
        // Otherwise the command loading this lockfile would dedupe its own fetch of a manifest this pass failed to get.
        manager.network_dedupe_map.clear();

        let cache_ctx = manager.manifest_disk_cache_ctx();
        // Lockfile fields are taken from `self` (== `manager.lockfile`), never via `manager_ptr`.
        let manager_ptr: *mut PackageManager = manager;
        let mgr_ref = bun_ptr::ParentRef::<PackageManager>::from(
            core::ptr::NonNull::new(manager_ptr).expect("derived from &mut, non-null"),
        );
        let mut pkgs = self.packages.slice();
        let len = pkgs.len();
        let mut added_by_extensions: Vec<(PackageID, PackageNameHash, bool)> = Vec::new();

        let self::package::PackageColumnsMut {
            name: pkg_names,
            name_hash: pkg_name_hashes,
            resolution: pkg_resolutions,
            bin: pkg_bins,
            meta: pkg_metas,
            ..
        } = pkgs.split_mut();

        for i in 0..len {
            let pkg_name = pkg_names[i];
            let pkg_name_hash = pkg_name_hashes[i];
            let pkg_res = pkg_resolutions[i];
            let pkg_bin = &mut pkg_bins[i];

            if pkg_res.tag != ResolutionTag::Npm
                || only.is_some_and(|only| !only.contains(&(i as PackageID)))
            {
                continue;
            }
            let pkg_name_str = pkg_name.slice(self.buffers.string_bytes.as_slice());
            let scope = mgr_ref.options.scope_for_package_name(pkg_name_str);
            // SAFETY: the call holds only that field, which nothing below resizes or relocates
            // while `manifest` is held.
            let Some(manifest) = unsafe { &mut (*manager_ptr).manifests }
                .by_name_hash_allow_expired(
                    cache_ctx,
                    scope,
                    pkg_name_str,
                    pkg_name_hash,
                    Some(&mut false),
                    false,
                )
            else {
                continue;
            };

            let npm_ver = pkg_res.npm().version;
            let Some(pkg) = manifest.find_by_version(npm_ver) else {
                continue;
            };

            // The manifest's metadata is only used if the locked tarball is the one that it
            // describes.
            let buf = self.buffers.string_bytes.as_slice();
            let url = pkg_res.npm().url.slice(buf);
            let locked_integrity = pkg_metas[i].integrity;
            let is_from_registry = url.is_empty()
                || bun_lock::url_is_under_registry(
                    url,
                    &crate::yarn_berry::registry_without_auth(scope.url.href()),
                )
                || url == pkg.package.tarball_url.slice(&manifest.string_buf);
            let is_described = is_from_registry
                || if locked_integrity.tag.is_supported()
                    && locked_integrity.tag == pkg.package.integrity.tag
                {
                    locked_integrity == pkg.package.integrity
                } else {
                    // There are no two hashes to compare. A mirror serves the registry's path from
                    // its own host, so the path is compared.
                    url.ends_with(&registry_tarball_url(b"", pkg_name_str, npm_ver, buf))
                };
            if !is_described {
                continue;
            }

            // pnpm-lock.yaml mixes the dependencies that `packageExtensions` added in with the
            // package's own. Anything the manifest doesn't declare came from an extension.
            let extensions = &self.package_extensions;
            for (name_hash, is_peer) in
                extensions.dependencies_added_to(pkg_name_hash, npm_ver, buf)
            {
                let groups = if is_peer {
                    [pkg.package.peer_dependencies; 2]
                } else {
                    [pkg.package.dependencies, pkg.package.optional_dependencies]
                };
                let declares = groups.iter().any(|group| {
                    (group.name.get(&manifest.external_strings).iter())
                        .any(|name| name.hash == name_hash)
                });
                if !declares {
                    added_by_extensions.push((i as PackageID, name_hash, is_peer));
                }
            }

            let mut builder = string_builder!(self);

            let bin_extern_strings_count = pkg.package.bin.count(
                &manifest.string_buf,
                &manifest.extern_strings_bin_entries,
                &mut builder,
            );

            builder.allocate()?;

            let extern_strings_list = &mut self.buffers.extern_strings;
            let start = extern_strings_list.len();
            let extern_strings_slice =
                bun_core::vec::grow_default(extern_strings_list, bin_extern_strings_count as usize);

            *pkg_bin = pkg.package.bin.clone_with_buffers(
                &manifest.string_buf,
                &manifest.extern_strings_bin_entries,
                start as u32,
                extern_strings_slice,
                &mut builder,
            );

            builder.clamp();

            let pkg_meta = &mut pkg_metas[i];
            // Neither yarn.lock nor pnpm-lock.yaml records this.
            pkg_meta.set_has_install_script(pkg.package.has_install_script);

            if update_os_cpu {
                if pkg_meta.os == Npm::OperatingSystem::ALL {
                    pkg_meta.os = pkg.package.os;
                }
                if pkg_meta.arch == Npm::Architecture::ALL {
                    pkg_meta.arch = pkg.package.cpu;
                }
                if pkg_meta.libc == Npm::Libc::NONE {
                    pkg_meta.libc = pkg.package.libc;
                }
            }
            // A matching path does not prove that a mirror serves the registry's bytes, so the
            // registry's hash is only recorded for a tarball from the registry.
            if fill_integrity
                && is_from_registry
                && !pkg_meta.integrity.tag.is_supported()
                && pkg.package.integrity.tag.is_supported()
            {
                pkg_meta.integrity = pkg.package.integrity;
            }
        }
        self.record_migrated_package_extensions(manager.log_mut(), &added_by_extensions)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Printer
// ────────────────────────────────────────────────────────────────────────────

pub struct Printer<'a> {
    pub lockfile: &'a Lockfile,
    pub(crate) options: &'a PackageManagerOptions,
    pub(crate) successfully_installed: Option<&'a DynamicBitSet>,
    pub(crate) updates: &'a [UpdateRequest],
}

pub mod printer {
    pub use super::printer_mods::tree_printer as Tree;
    pub use super::printer_mods::yarn as Yarn;
}

impl<'a> Printer<'a> {
    #[cold]
    pub fn print(log: &mut bun_ast::Log, input_lockfile_path: &[u8]) -> Result<(), BunError> {
        // We truncate longer than allowed paths. We should probably throw an error instead.
        let path = &input_lockfile_path[..input_lockfile_path.len().min(MAX_PATH_BYTES)];

        let mut cwd_buf = bun_paths::path_buffer_pool::get();
        let mut joined_buf = bun_paths::path_buffer_pool::get();
        let lockfile_path: &[u8] = if bun_paths::is_absolute(path) {
            path
        } else {
            let cwd_len = bun_sys::getcwd(&mut cwd_buf[..])?;
            resolve_path::join_abs_string_buf::<platform::Auto>(
                &cwd_buf[..cwd_len],
                &mut joined_buf.0,
                &[path],
            )
        };

        if lockfile_path.first() == Some(&SEP) {
            let dir = bun_paths::dirname(lockfile_path).unwrap_or(SEP_STR.as_bytes());
            let mut dir_buf = bun_paths::path_buffer_pool::get();
            let _ = sys::chdir(resolve_path::z(dir, &mut dir_buf));
        }

        // An entry point (`bun bun.lockb`): the resolver FS singleton may not exist yet.
        let _ = FileSystem::init(None)?;

        let mut lockfile = Box::<Lockfile>::default();

        // git's textconv hands over `<random>_bun.lockb`. `bun bun.lockb` also prints a bun.lock.
        let load_from_disk = match File::read_from(Fd::cwd(), lockfile_path) {
            Ok(bytes) => lockfile.load_from_bytes(None, bytes, log),
            Err(_) => lockfile.load_from_cwd::<false>(None, log),
        };
        match load_from_disk {
            crate::lockfile::LoadResult::Err(cause) => {
                let (doing, end) = match cause.step {
                    LoadStep::OpenFile => ("opening", "."),
                    LoadStep::ParseFile => ("parsing", ""),
                    LoadStep::ReadFile => ("reading", ""),
                    LoadStep::Migrating => ("while migrating", ""),
                };
                bun_core::pretty_errorln!(
                    "<r><red>error<r> {} lockfile:<r> {}{}",
                    doing,
                    cause.value.name(),
                    end
                );
                print_log_errors(log);
                Global::crash();
            }
            crate::lockfile::LoadResult::NotFound => {
                bun_core::pretty_errorln!(
                    "<r><red>lockfile not found:<r> {}",
                    bun_core::fmt::QuotedFormatter {
                        text: lockfile_path
                    },
                );
                Global::crash();
            }
            crate::lockfile::LoadResult::Ok(_) => {}
        }

        match printer::Yarn::print(&lockfile, Output::writer_buffered()) {
            Ok(()) => {}
            Err(crate::Error::Alloc(bun_alloc::AllocError)) => bun_core::out_of_memory(),
            Err(crate::Error::WriteFailed) => return Ok(()),
            Err(e) => return Err(e),
        }
        Output::flush();
        Ok(())
    }
}

// saveToDisk / rootPackage / str / initEmpty

impl Lockfile {
    /// Returns false when the lockfile on disk already had exactly these bytes and was left untouched.
    pub fn save_to_disk(
        &mut self,
        load_result: &LoadResult<'_>,
        options: &PackageManagerOptions,
    ) -> bool {
        let save_format = load_result.save_format(options);
        // Only `bun install` sets the option. `self` is `load_result`'s lockfile.
        let config_version = options.config_version.unwrap_or_else(|| {
            load_result
                .choose_config_version_with_saved(self.saved_config_version)
                .0
        });
        debug_assert!(Fs::INSTANCE_LOADED.load(core::sync::atomic::Ordering::Relaxed));

        let bytes: Vec<u8> = 'bytes: {
            if save_format == LockfileFormat::Text {
                let mut writer_buf: Vec<u8> = Vec::new();

                if let Err(_e) = TextLockfile::Stringifier::save_from_binary(
                    self,
                    load_result,
                    config_version,
                    &mut writer_buf,
                ) {
                    // The only write failure on an allocating writer is OOM.
                    bun_core::out_of_memory();
                }

                break 'bytes writer_buf;
            }

            let mut bytes: Vec<u8> = Vec::new();

            let mut total_size: usize = 0;
            let mut end_pos: usize = 0;
            if let Err(e) = Serializer::save(
                self,
                options,
                config_version,
                &mut bytes,
                &mut total_size,
                &mut end_pos,
            ) {
                Output::err(e, "failed to serialize lockfile", format_args!(""));
                Global::crash();
            }
            if bytes.len() >= end_pos {
                bytes[end_pos..end_pos + core::mem::size_of::<usize>()]
                    .copy_from_slice(&total_size.to_ne_bytes());
            }
            break 'bytes bytes;
        };
        // bun.lockb starts with `#!/usr/bin/env bun`.
        let mode = if save_format == LockfileFormat::Text {
            0o666
        } else {
            0o777
        };
        replace_in_cwd(save_format.filename(), &bytes, mode)
    }

    pub(crate) fn root_package(&self) -> Option<Package> {
        if self.packages.len() == 0 {
            return None;
        }

        Some(*self.packages.get(0))
    }

    /// The integrity hash that the lockfile records for the registry package `name@version`.
    pub fn npm_integrity(&self, name: &[u8], version: Semver::Version) -> Option<crate::Integrity> {
        let resolutions = self.packages.items_resolution();
        let id = (0..resolutions.len()).find(|&id| {
            resolutions[id].tag == ResolutionTag::Npm
                && resolutions[id].npm().version.eql(version)
                && self.str(&self.packages.items_name()[id]) == name
        })?;
        Some(self.packages.items_meta()[id].integrity)
    }

    #[inline]
    pub fn str<'a, T: bun_semver::Slicable>(&'a self, slicable: &'a T) -> &'a [u8] {
        slicable.slice(self.buffers.string_bytes.as_slice())
    }

    /// [`str`](Self::str) with the borrow detached from `self`.
    ///
    /// The install pipeline frequently needs to read a string out of
    /// `buffers.string_bytes` and then call back into `&mut PackageManager`
    /// (which owns the `Lockfile`). The caller would otherwise have to write
    /// `unsafe { detach_lifetime(self.str(x)) }` at
    /// every site. Consolidating that here keeps the SAFETY argument in one
    /// place.
    ///
    /// SAFETY (internal): `string_bytes` is append-only for the lifetime of a
    /// resolve/enqueue pass and is never reallocated while a detached slice is
    /// live. The returned slice must not outlive the
    /// `Lockfile`.
    #[inline]
    pub(crate) fn str_detached<'a, T: bun_semver::Slicable>(&self, slicable: &T) -> &'a [u8] {
        // SAFETY: see doc comment — same invariant every prior call site
        // already relied on via `bun_ptr::detach_lifetime`.
        unsafe { bun_ptr::detach_lifetime(slicable.slice(self.buffers.string_bytes.as_slice())) }
    }

    /// Construct an empty Lockfile value in place.
    #[inline(never)]
    pub fn init_empty(&mut self) {
        *self = Self::init_empty_value();
    }
}

impl Default for Lockfile {
    #[inline]
    fn default() -> Self {
        Self::init_empty_value()
    }
}

/// Writes a temporary file (with `mode` minus the umask) and renames it over `filename`. Returns
/// false if the file already had these bytes.
pub(crate) fn replace_in_cwd(filename: &ZStr, bytes: &[u8], mode: sys::Mode) -> bool {
    if File::read_from(Fd::cwd(), filename.as_bytes()).is_ok_and(|existing| existing == bytes) {
        return false;
    }

    let mut tmpname_buf = [0u8; 64];
    let mut random = [0u8; 8];
    bun_boringssl_sys::rand_bytes(&mut random);
    let tmpname: &ZStr = {
        let mut cursor: &mut [u8] = &mut tmpname_buf[..];
        let start_len = cursor.len();
        write!(
            cursor,
            "{}-{}.tmp\0",
            bstr::BStr::new(bun_paths::extension(filename.as_bytes())),
            bun_core::fmt::HexBytes::<true>(&random)
        )
        .expect("unreachable");
        let written = start_len - cursor.len();
        ZStr::from_buf(&tmpname_buf, written - 1)
    };

    let flags = sys::O::CREAT | sys::O::EXCL | sys::O::WRONLY;
    let file = File::openat(Fd::cwd(), tmpname, flags, mode).unwrap_or_else(|e| {
        Output::err(
            e,
            "failed to create temporary file to save lockfile",
            format_args!(""),
        );
        Global::crash();
    });

    if let Err(e) = file.write_all(bytes) {
        let _ = file.close(); // close error is non-actionable
        let _ = sys::unlink(tmpname);
        Output::err(e, "failed to write lockfile", format_args!(""));
        Global::crash();
    }

    if let Err(e) = file.close_and_move_to(tmpname, filename) {
        bun_core::handle_error_return_trace(&e);

        // note: file is already closed here.
        let _ = sys::unlink(tmpname);

        Output::err(
            &e,
            "Failed to replace old lockfile with new lockfile on disk",
            format_args!(""),
        );
        Global::crash();
    }
    true
}

/// The workspace an npm range on `name_hash`'s package links to instead of the registry: the
/// workspace of that name, when the range satisfies its version or is a `*` range (which links even
/// a workspace without a version, https://github.com/oven-sh/bun/pull/10899#issuecomment-2099609419).
pub(crate) fn linked_workspace_path(
    link_workspace_packages: bool,
    workspace_paths: &NameHashMap,
    workspace_versions: &VersionHashMap,
    name_hash: PackageNameHash,
    range: &Semver::query::Group,
    buf: &[u8],
) -> Option<SemverString> {
    linked_workspace_path_in(
        link_workspace_packages,
        workspace_paths,
        workspace_versions,
        name_hash,
        range,
        buf,
        buf,
    )
}

/// `range` was parsed against `range_buf`, which is not the lockfile's `buf`.
pub(crate) fn linked_workspace_path_in(
    link_workspace_packages: bool,
    workspace_paths: &NameHashMap,
    workspace_versions: &VersionHashMap,
    name_hash: PackageNameHash,
    range: &Semver::query::Group,
    range_buf: &[u8],
    buf: &[u8],
) -> Option<SemverString> {
    if !link_workspace_packages {
        return None;
    }
    let path = *workspace_paths.get(&name_hash)?;
    if range.is_star() {
        return Some(path);
    }
    let version = *workspace_versions.get(&name_hash)?;
    range.satisfies(version, range_buf, buf).then_some(path)
}

/// Use this for paths from a lockfile, because `join` resolves absolute paths and `..`. Returns
/// `None` if the result doesn't fit in a path buffer.
pub(crate) fn join_top_level_dir(parts: &[&[u8]]) -> Option<bun_paths::AutoAbsPathChecked> {
    let mut path = bun_paths::AutoAbsPathChecked::init_top_level_dir();
    path.join(parts).ok()?;
    Some(path)
}

impl Lockfile {
    #[inline(never)]
    pub(crate) fn init_empty_value() -> Self {
        Lockfile {
            format: FormatVersion::current(),
            text_lockfile_version: bun_lock::Version::current(),
            packages: Default::default(),
            buffers: Buffers::default(),
            package_index: PackageIndexMap::default(),
            string_pool: StringPool::default(),
            scratch: Scratch::init(),
            scripts: Scripts::default(),
            trusted_dependencies: None,
            workspace_paths: NameHashMap::default(),
            workspace_versions: VersionHashMap::default(),
            self_contained_workspaces: ArrayHashMap::default(),
            linked_members: LinkedMembers::default(),
            overrides: OverrideMap::default(),
            catalogs: CatalogMap::default(),
            package_extensions: Default::default(),
            meta_hash: ZERO_HASH,
            patched_dependencies: PatchedDependenciesMap::default(),
            saved_config_version: None,
            loaded_package_count: 0,
            held_at_load: DynamicBitSet::default(),
            exact_pinned: DynamicBitSet::default(),
            only_bundled: DynamicBitSet::default(),
        }
    }

    /// Call once after `load_from_cwd`, before a resolution is re-pointed or a package appended.
    pub(crate) fn mark_loaded_packages(&mut self) -> Result<(), AllocError> {
        let packages_len = self.packages.len();
        self.loaded_package_count = packages_len as PackageID;
        let mut held = DynamicBitSet::init_empty(packages_len)?;
        let rows = self.buffers.dependencies.len();
        for (id, &package_id) in self.buffers.resolutions.iter().enumerate().take(rows) {
            if (package_id as usize) < packages_len
                && !self.is_weak_peer(id as DependencyID, package_id)
            {
                held.set(package_id as usize);
            }
        }
        self.held_at_load = held;
        Ok(())
    }

    /// Loaders (bun.lock, bun.lockb, migrated foreign lockfiles) rebuild a dependency from its
    /// literal, so every loader finishes with this to give edges resolved to a workspace package the
    /// shape `Package::parse` gives them: a `workspace:` edge's value becomes the workspace's path,
    /// and an npm range becomes a workspace edge when `linked_workspace_path`, asked with the
    /// workspaces this lockfile records, links it. Ranges bound to a workspace any other way (a peer
    /// that took a sibling's version, an override) stay ranges, as they do in a reparse.
    pub(crate) fn tag_workspace_links(&mut self, link_workspace_packages: bool) {
        const ROOT: PackageID = 0;
        let pkg_resolutions = self.packages.items_resolution();
        // Most projects have no workspace and no dependency on the project itself.
        if !(pkg_resolutions.iter().skip(1))
            .any(|res| matches!(res.tag, ResolutionTag::Root | ResolutionTag::Workspace))
            && !self.buffers.resolutions.contains(&ROOT)
        {
            return;
        }
        let root_rows = self.packages.items_dependencies().first();
        let is_local_row = |dep_id: usize| {
            (self.packages.items_dependencies().iter())
                .zip(pkg_resolutions)
                .any(|(rows, owner)| {
                    rows.contains(dep_id as DependencyID)
                        && matches!(owner.tag, ResolutionTag::Root | ResolutionTag::Workspace)
                })
        };
        let buf = self.buffers.string_bytes.as_slice();
        for (dep_id, (dep, &pkg_id)) in self
            .buffers
            .dependencies
            .iter_mut()
            .zip(self.buffers.resolutions.iter())
            .enumerate()
        {
            if pkg_id as usize >= pkg_resolutions.len() {
                continue;
            }
            let res = &pkg_resolutions[pkg_id as usize];
            // The root package's path.
            if res.tag == ResolutionTag::Root && dep.version.tag == dependency::Tag::Workspace {
                dep.version.value.workspace = SemverString::from(b".");
            }
            if res.tag != ResolutionTag::Workspace {
                continue;
            }
            // This peer was tagged as a workspace link when the lockfile was loaded. A published
            // version that its range accepts may have been added since, so the range is parsed
            // again.
            if dep.version.tag == dependency::Tag::Workspace
                && dep.behavior.is_peer()
                && !dep.behavior.is_optional_peer()
                && !is_local_row(dep_id)
            {
                let literal = dep.version.literal.sliced(buf);
                if let Some(range) =
                    dependency::parse(dep.name, dep.name_hash, literal.slice, &literal, None, None)
                    && range.tag == dependency::Tag::Npm
                {
                    dep.version = range;
                }
            }
            let linked = match dep.version.tag {
                dependency::Tag::Workspace => true,
                dependency::Tag::Npm => {
                    let npm = dep.version.npm();
                    linked_workspace_path(
                        link_workspace_packages,
                        &self.workspace_paths,
                        &self.workspace_versions,
                        Semver::string::Builder::string_hash(npm.name.slice(buf)),
                        &npm.version,
                        buf,
                    )
                    .is_some()
                        // Hoisting binds the peers of registry packages, so such a peer stays a
                        // range: an optional one always, and a required one while the lockfile has
                        // a published version that the range accepts.
                        && (!dep.behavior.is_peer()
                            || is_local_row(dep_id)
                            || (!dep.behavior.is_optional_peer()
                                && bun_lock::resolve_peer_dep_version_based(
                                    dep,
                                    &self.catalogs,
                                    &self.package_index,
                                    &self.overrides,
                                    pkg_resolutions,
                                    buf,
                                    |_| true,
                                )
                                .is_none()))
                }
                // For the root, the workspace of that name wins over a `file:` folder.
                dependency::Tag::Folder => {
                    root_rows.is_some_and(|root| root.contains(dep_id as DependencyID))
                }
                // It also wins over a dist-tag of a package with the workspace's name. An `npm:`
                // alias stays a dist-tag, as it does when package.json is parsed.
                dependency::Tag::DistTag => {
                    root_rows.is_some_and(|root| root.contains(dep_id as DependencyID))
                        && self.workspace_paths.contains(&dep.name_hash)
                        && (dep.version.dist_tag().name).eql(dep.name, buf, buf)
                }
                _ => false,
            };
            if !linked {
                continue;
            }
            // Whole-struct move so `Drop` frees the old npm chain; keep the existing `literal`.
            let literal = dep.version.literal;
            dep.version = DependencyVersion {
                tag: dependency::Tag::Workspace,
                literal,
                value: dependency::Value {
                    workspace: *res.workspace(),
                },
            };
        }
    }

    /// Undoes `tag_workspace_links` for one dependency. Returns false for a `workspace:` specifier,
    /// which that pass didn't tag.
    pub(crate) fn untag_workspace_link(&mut self, dep_id: DependencyID) -> bool {
        let dep = &self.buffers.dependencies[dep_id as usize];
        if dep.version.tag != dependency::Tag::Workspace {
            return true;
        }
        let sliced = dep
            .version
            .literal
            .sliced(self.buffers.string_bytes.as_slice());
        match dependency::parse(dep.name, dep.name_hash, sliced.slice, &sliced, None, None) {
            Some(version) if version.tag == dependency::Tag::Npm => {
                self.buffers.dependencies[dep_id as usize].version = version;
                true
            }
            _ => false,
        }
    }

    /// Binds a dependency that `Package::parse` tagged as a workspace link to that workspace.
    /// Returns true if it was bound to another package before.
    pub(crate) fn bind_workspace_link(
        &mut self,
        dep_id: DependencyID,
        link_workspace_packages: bool,
    ) -> bool {
        let dependency = &self.buffers.dependencies[dep_id as usize];
        let version = &dependency.version;
        if version.tag != dependency::Tag::Workspace {
            return false;
        }
        let buf = self.buffers.string_bytes.as_slice();
        let path = version.workspace().slice(buf);
        // The resolver asks for the version of an override, and that links this workspace or not.
        if self.is_overridden_dependency(dep_id) {
            let links = (crate::dedupe::effective_npm_range(self, dep_id, dependency)).is_some_and(
                |asked| {
                    let npm = asked.npm();
                    linked_workspace_path(
                        link_workspace_packages,
                        &self.workspace_paths,
                        &self.workspace_versions,
                        Semver::string::Builder::string_hash(npm.name.slice(buf)),
                        &npm.version,
                        buf,
                    )
                    .is_some_and(|linked| linked.slice(buf) == path)
                },
            );
            if !links {
                return false;
            }
        }
        let Some(id) = (self.packages.items_resolution().iter()).position(|res| {
            res.tag == ResolutionTag::Workspace && res.workspace().slice(buf) == path
        }) else {
            return false;
        };
        let bound = &mut self.buffers.resolutions[dep_id as usize];
        core::mem::replace(bound, id as PackageID) != id as PackageID
    }

    #[inline]
    pub(crate) fn mark_exact_pin(&mut self, id: PackageID) {
        let i = id as usize;
        if self.exact_pinned.bit_length() <= i {
            bun_core::handle_oom(self.exact_pinned.resize(i + 1, false));
        }
        self.exact_pinned.set(i);
    }

    pub(crate) fn mark_only_bundled(&mut self, id: PackageID) {
        let i = id as usize;
        if self.only_bundled.bit_length() <= i {
            bun_core::handle_oom(self.only_bundled.resize(i + 1, false));
        }
        self.only_bundled.set(i);
    }

    /// Returns true if the dependency is bundled, or if its owner is only used inside bundles.
    pub(crate) fn is_row_inside_bundle(
        &self,
        id: DependencyID,
        behavior: dependency::Behavior,
    ) -> bool {
        behavior.is_bundled()
            || (self.is_in_unplaced_subtree(id)
                && self.get_parent_pkg_of_dependency(id).is_some_and(|owner| {
                    self.only_bundled
                        .is_set_allow_out_of_bound(owner as usize, false)
                }))
    }

    /// See `Scratch::unplaced_subtree`.
    pub(crate) fn mark_unplaced_subtree(&mut self, dependencies: DependencySlice) {
        let range = bun_collections::bit_set::Range {
            start: dependencies.begin() as usize,
            end: dependencies.end() as usize,
        };
        let unplaced_subtree = &mut self.scratch.unplaced_subtree;
        if unplaced_subtree.bit_length() < range.end {
            bun_core::handle_oom(unplaced_subtree.resize(range.end, false));
        }
        unplaced_subtree.set_range_value(range, true);
    }

    #[inline]
    pub(crate) fn is_in_unplaced_subtree(&self, id: DependencyID) -> bool {
        self.scratch
            .unplaced_subtree
            .is_set_allow_out_of_bound(id as usize, false)
    }

    /// See `Scratch::refreshing`.
    pub(crate) fn mark_refreshing(&mut self, id: DependencyID) {
        let rows = self.buffers.dependencies.len();
        let refreshing = &mut self.scratch.refreshing;
        if refreshing.bit_length() < rows {
            bun_core::handle_oom(refreshing.resize(rows, false));
        }
        refreshing.set(id as usize);
    }

    #[inline]
    pub(crate) fn is_refreshing(&self, id: DependencyID) -> bool {
        self.scratch
            .refreshing
            .is_set_allow_out_of_bound(id as usize, false)
    }

    /// The resolve has an answer for `id`. Returns false if `id` was not being refreshed.
    #[inline]
    pub(crate) fn take_refreshing(&mut self, id: DependencyID) -> bool {
        let was_refreshing = self.is_refreshing(id);
        if was_refreshing {
            self.scratch.refreshing.unset(id as usize);
        }
        was_refreshing
    }

    /// Returns true if `id` has no package, or keeps the one of bun.lock only until it is resolved.
    #[inline]
    pub(crate) fn awaits_resolve(&self, id: DependencyID) -> bool {
        self.buffers.resolutions[id as usize] == invalid_package_id || self.is_refreshing(id)
    }

    /// The source of `id` was read, and it has no package for it: the one of bun.lock goes.
    pub(crate) fn unbind_refreshing(&mut self, id: DependencyID) {
        if self.take_refreshing(id) {
            self.buffers.resolutions[id as usize] = invalid_package_id;
        }
    }

    /// Once everything is resolved: the packages that stay only because a source could not be read.
    pub(crate) fn kept_without_refresh(&self) -> Vec<PackageID> {
        let mut kept = Vec::new();
        if self.scratch.refreshing.count() == 0 {
            return kept;
        }
        let resolutions = self.buffers.resolutions.as_slice();
        let stays = reachable::packages(self, resolutions, reachable::Options::all(0));
        for (declarer, rows) in self.packages.items_dependencies().iter().enumerate() {
            if !stays.is_set(declarer) {
                continue;
            }
            for row in rows.begin()..rows.end() {
                let package_id = resolutions[row as usize];
                if self.is_refreshing(row)
                    && (package_id as usize) < self.packages.len()
                    && !kept.contains(&package_id)
                {
                    kept.push(package_id);
                }
            }
        }
        kept
    }

    pub(crate) fn get_package_id(
        &self,
        name_hash: u64,
        // If non-null, attempt to use an existing package
        // that satisfies this version range.
        version: Option<&DependencyVersion>,
        resolution: &Resolution,
    ) -> Option<PackageID> {
        self.find_package_id(name_hash, version, resolution, false)
    }

    /// `only_bundled` packages ship inside another package's tarball, so they're skipped unless
    /// `resolution` is one of them.
    pub(crate) fn get_package_id_outside_bundles(
        &mut self,
        name_hash: u64,
        version: Option<&DependencyVersion>,
        resolution: &Resolution,
    ) -> Option<PackageID> {
        let found = self.find_package_id(name_hash, version, resolution, true);
        if found.is_some() || self.only_bundled.bit_length() == 0 {
            return found;
        }
        let id = self.find_package_id(name_hash, None, resolution, false)?;
        self.only_bundled.unset(id as usize);
        Some(id)
    }

    fn find_package_id(
        &self,
        name_hash: u64,
        version: Option<&DependencyVersion>,
        resolution: &Resolution,
        skip_only_bundled: bool,
    ) -> Option<PackageID> {
        let entry = self.package_index.get(&name_hash)?;
        let resolutions: &[Resolution] = self.packages.items_resolution();
        let npm_version = version.and_then(|v| v.try_npm()).map(|npm| &npm.version);
        let buf = self.buffers.string_bytes.as_slice();

        // A range shares a version that is already in the lockfile. Dependencies are resolved in
        // queue order, so which versions one finds here does not depend on which manifest arrived
        // first.
        let try_satisfies_dedupe = |id: PackageID| -> bool {
            let existing = &resolutions[id as usize];
            if existing.tag != ResolutionTag::Npm
                || !npm_version
                    .is_some_and(|range| range.satisfies(existing.npm().version, buf, buf))
            {
                return false;
            }
            // A range only moves down from the major version it would pick itself onto a version
            // that bun.lock already had, or that some dependency asks for exactly.
            id < self.loaded_package_count
                || self
                    .exact_pinned
                    .is_set_allow_out_of_bound(id as usize, false)
                || resolution.tag != ResolutionTag::Npm
                || existing.npm().version.major >= resolution.npm().version.major
        };
        let skipped = |id: PackageID| -> bool {
            skip_only_bundled
                && self
                    .only_bundled
                    .is_set_allow_out_of_bound(id as usize, false)
        };

        entry.as_slice().iter().copied().find(|&id| {
            debug_assert!((id as usize) < resolutions.len());
            !skipped(id)
                && (resolutions[id as usize].eql(resolution, buf, buf) || try_satisfies_dedupe(id))
        })
    }

    /// Appends `pkg` to `this.packages`, and adds to `this.package_index`.
    pub(crate) fn append_package_dedupe(
        &mut self,
        pkg: &mut Package,
    ) -> Result<PackageID, AllocError> {
        let entry = self.package_index.get_or_put(pkg.name_hash)?;
        let buf = self.buffers.string_bytes.as_slice();

        if entry.found_existing {
            let resolutions = self.packages.items_resolution();
            if let Some(&existing_id) = (entry.value_ptr.as_slice().iter())
                .find(|&&id| pkg.resolution.eql(&resolutions[id as usize], buf, buf))
            {
                pkg.meta.id = existing_id;
                return Ok(existing_id);
            }
        }

        let new_id: PackageID = PackageID::try_from(self.packages.len()).expect("int cast");
        pkg.meta.id = new_id;
        self.packages.append(*pkg)?;
        if entry.found_existing {
            (entry.value_ptr).insert(new_id, self.packages.items_resolution(), buf);
        } else {
            *entry.value_ptr = PackageIndexEntry::Id(new_id);
        }
        Ok(new_id)
    }

    pub(crate) fn get_or_put_id(
        &mut self,
        id: PackageID,
        name_hash: PackageNameHash,
    ) -> Result<(), AllocError> {
        let gpe = self.package_index.get_or_put(name_hash)?;
        if gpe.found_existing {
            gpe.value_ptr.insert(
                id,
                self.packages.items_resolution(),
                self.buffers.string_bytes.as_slice(),
            );
        } else {
            *gpe.value_ptr = PackageIndexEntry::Id(id);
        }
        Ok(())
    }

    pub(crate) fn append_package(&mut self, package_: &Package) -> Result<Package, AllocError> {
        let id: PackageID = self.packages.len() as PackageID;
        self.append_package_with_id(package_, id)
    }

    pub(crate) fn append_package_with_id(
        &mut self,
        package_: &Package,
        id: PackageID,
    ) -> Result<Package, AllocError> {
        // Captured for the assertion at the end of the function.
        let name_hash = package_.name_hash;
        let resolution = package_.resolution;

        let mut package = *package_;
        package.meta.id = id;
        self.packages.append(package)?;
        self.get_or_put_id(id, name_hash)?;

        debug_assert!(self.get_package_id(name_hash, None, &resolution).is_some());

        Ok(package)
    }

    #[inline]
    pub(crate) fn string_builder(&mut self) -> StringBuilder<'_> {
        StringBuilder {
            len: 0,
            cap: 0,
            off: 0,
            ptr: None,
            string_bytes: &mut self.buffers.string_bytes,
            string_pool: &mut self.string_pool,
        }
    }

    /// Borrowck-approved disjoint split: returns a fresh `StringBuilder`
    /// (borrowing `buffers.string_bytes` + `string_pool`) alongside mutable
    /// references to every other `Lockfile` field a caller might need while
    /// the builder is live. Use this instead of routing through
    /// `*mut Lockfile` + `unsafe { &mut (*ptr).field }` reborrows.
    #[inline]
    pub(crate) fn string_builder_split(&mut self) -> (StringBuilder<'_>, LockfileFields<'_>) {
        let Buffers {
            string_bytes,
            dependencies,
            resolutions,
            ..
        } = &mut self.buffers;
        (
            StringBuilder {
                len: 0,
                cap: 0,
                off: 0,
                ptr: None,
                string_bytes,
                string_pool: &mut self.string_pool,
            },
            LockfileFields {
                packages: &mut self.packages,
                dependencies,
                resolutions,
                overrides: &mut self.overrides,
                catalogs: &mut self.catalogs,
                workspace_paths: &mut self.workspace_paths,
                workspace_versions: &mut self.workspace_versions,
                patched_dependencies: &mut self.patched_dependencies,
            },
        )
    }

    pub(crate) fn string_buf(&mut self) -> SemverStringBuf<'_> {
        SemverStringBuf {
            bytes: &mut self.buffers.string_bytes,
            pool: &mut self.string_pool,
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Scratch
// ────────────────────────────────────────────────────────────────────────────

pub struct Scratch {
    pub(crate) duplicate_checker_map: DuplicateCheckerMap,
    pub(crate) dependency_list_queue: DependencyQueue,
    /// `bit[dependency_id]`: this resolve reached it below a dependency that the installers filter.
    pub(crate) unplaced_subtree: DynamicBitSet,
    /// `bit[dependency_id]`: it keeps its bun.lock package until its source is read again.
    pub(crate) refreshing: DynamicBitSet,
}

pub(crate) type DuplicateCheckerMap =
    BunHashMap<PackageNameHash, bun_ast::Loc, IdentityContext<PackageNameHash>>;

/// Dependencies of one package, or a single dependency, that wait for their turn to be resolved.
#[derive(Clone, Copy)]
pub(crate) struct QueuedRows {
    pub(crate) rows: DependencySlice,
    /// True in the peer pass, where a peer dependency may install a package of its own.
    pub(crate) install_peer: bool,
    /// True for a dependency that the command itself wants resolved, false for the dependencies
    /// of a package that was just resolved. An error while resolving the former is logged.
    pub(crate) from_command: bool,
}

/// One first-in, first-out list of `DependencyQueue`.
struct Lane {
    items: LinearFifo<QueuedRows, DynamicBuffer<QueuedRows>>,
    /// How many items have left the lane so far.
    finished: usize,
    /// Counted like `finished`: every item before this one has started its downloads.
    requested: usize,
}

impl Lane {
    fn init() -> Lane {
        Lane {
            items: LinearFifo::<QueuedRows, DynamicBuffer<QueuedRows>>::init(),
            finished: 0,
            requested: 0,
        }
    }

    #[inline]
    fn is_empty(&self) -> bool {
        self.items.readable_length() == 0
    }

    /// Drops the rows of the first item that come before `next`.
    #[inline]
    fn finish_rows_before(&mut self, next: DependencyID) {
        let head = self.items.peek_item_mut(0);
        head.rows = DependencySlice::new(next, head.rows.end() - next);
        if head.rows.len == 0 {
            self.items.discard(1);
            self.finished += 1;
        }
    }

    /// `skips_first_row` is true if the first row of this lane is the one that the queue waits for.
    fn next_unrequested(&mut self, skips_first_row: bool) -> Option<QueuedRows> {
        let index = self.requested.max(self.finished) - self.finished;
        if index >= self.items.readable_length() {
            return None;
        }
        self.requested = self.finished + index + 1;
        let mut item = self.items.peek_item(index);
        if index == 0 && skips_first_row {
            item.rows = DependencySlice::new(item.rows.off + 1, item.rows.len - 1);
        }
        Some(item)
    }

    fn clear(&mut self) {
        let queued = self.items.readable_length();
        self.items.discard(queued);
        self.finished += queued;
    }
}

/// The dependencies that are not resolved yet, in the order in which they will be. Only the one at
/// the front is ever resolved, so bun.lock does not depend on which manifest arrives first.
pub(crate) struct DependencyQueue {
    /// What the command wants resolved. All of it comes before anything in `found`, as it does
    /// when every manifest is cached and a command's dependencies are resolved on the spot.
    commanded: Lane,
    /// What `push_commanded` was asked to resolve. It can differ from the row in the lockfile:
    /// `bun audit fix` asks for one exact version of a dependency that declares a range.
    asked_as: BunHashMap<DependencyID, Dependency>,
    /// The dependencies of the packages that were resolved.
    found: Lane,
    /// The task that fetches the manifest of the dependency at the front, once it was tried.
    pub(crate) waits_for: Option<crate::package_manager_task::Id>,
}

impl DependencyQueue {
    fn init() -> DependencyQueue {
        DependencyQueue {
            commanded: Lane::init(),
            asked_as: BunHashMap::default(),
            found: Lane::init(),
            waits_for: None,
        }
    }

    /// Queues one dependency that the command wants resolved, as the caller describes it.
    pub(crate) fn push_commanded(
        &mut self,
        id: DependencyID,
        dependency: Dependency,
        install_peer: bool,
    ) -> Result<(), AllocError> {
        self.asked_as.put(id, dependency)?;
        self.push(QueuedRows {
            rows: DependencySlice::new(id, 1),
            install_peer,
            from_command: true,
        })
    }

    /// Returns the dependency to resolve instead of the lockfile's row `id`, if `push_commanded`
    /// queued one.
    #[inline]
    pub(crate) fn asked_as(&self, id: DependencyID) -> Option<&Dependency> {
        if self.asked_as.is_empty() {
            return None;
        }
        self.asked_as.get(&id)
    }

    pub(crate) fn push(&mut self, item: QueuedRows) -> Result<(), AllocError> {
        if item.rows.len == 0 {
            return Ok(());
        }
        if !item.from_command {
            return self.found.items.write_item(item);
        }
        // It may be the new front of the queue.
        if self.commanded.is_empty() {
            self.waits_for = None;
        }
        self.commanded.items.write_item(item)
    }

    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.commanded.is_empty() && self.found.is_empty()
    }

    /// Returns true if a dependency that the command wants resolved is still waiting for its turn.
    #[inline]
    pub(crate) fn has_commanded_rows(&self) -> bool {
        !self.commanded.is_empty()
    }

    /// Returns the item at the front. Its first row is the next one to resolve.
    #[inline]
    pub(crate) fn head(&self) -> Option<QueuedRows> {
        if !self.commanded.is_empty() {
            return Some(self.commanded.items.peek_item(0));
        }
        (!self.found.is_empty()).then(|| self.found.items.peek_item(0))
    }

    /// Marks the rows of `head` that come before `next` as done. `head` is what `Self::head`
    /// returned.
    #[inline]
    pub(crate) fn finish_rows_before(&mut self, head: QueuedRows, next: DependencyID) {
        if head.from_command {
            if !self.asked_as.is_empty() {
                for id in head.rows.begin()..next {
                    drop(self.asked_as.remove(&id));
                }
            }
            self.commanded.finish_rows_before(next);
        } else {
            self.found.finish_rows_before(next);
        }
    }

    /// Each call returns rows behind the head row that have not started their downloads yet.
    pub(crate) fn next_unrequested(&mut self) -> Option<QueuedRows> {
        let head_is_commanded = !self.commanded.is_empty();
        (self.commanded.next_unrequested(true))
            .or_else(|| self.found.next_unrequested(!head_is_commanded))
    }

    pub(crate) fn clear(&mut self) {
        self.commanded.clear();
        self.asked_as.clear();
        self.found.clear();
        self.waits_for = None;
    }
}

impl Scratch {
    fn init() -> Scratch {
        Scratch {
            dependency_list_queue: DependencyQueue::init(),
            duplicate_checker_map: DuplicateCheckerMap::default(),
            unplaced_subtree: DynamicBitSet::default(),
            refreshing: DynamicBitSet::default(),
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// LockfileFields — disjoint split borrow alongside StringBuilder
// ────────────────────────────────────────────────────────────────────────────

/// Mutable references to every `Lockfile` field that is *disjoint* from the
/// two columns a `StringBuilder` borrows (`buffers.string_bytes` +
/// `string_pool`). Returned by `Lockfile::string_builder_split()` so callers
/// can hold a live builder and still touch `packages` / `buffers.dependencies`
/// / `overrides` / … without raw-pointer reborrow gymnastics.
pub(crate) struct LockfileFields<'a> {
    pub(crate) packages: &'a mut PackageList,
    pub(crate) dependencies: &'a mut DependencyList,
    pub(crate) resolutions: &'a mut PackageIDList,
    pub(crate) overrides: &'a mut OverrideMap,
    pub(crate) catalogs: &'a mut CatalogMap,
    pub(crate) workspace_paths: &'a mut NameHashMap,
    pub(crate) workspace_versions: &'a mut VersionHashMap,
    pub(crate) patched_dependencies: &'a mut PatchedDependenciesMap,
}

// ────────────────────────────────────────────────────────────────────────────
// StringBuilder
// ────────────────────────────────────────────────────────────────────────────

/// Holds the two fields the builder actually mutates (rather than a whole
/// `&mut Lockfile`, which would block every caller from touching disjoint
/// fields like `packages` / `buffers.dependencies` while a builder is alive)
/// so callers can split-borrow at the field level.
pub struct StringBuilder<'a> {
    pub len: usize,
    pub cap: usize,
    pub off: usize,
    pub ptr: Option<*mut u8>,
    pub string_bytes: &'a mut Vec<u8>,
    pub string_pool: &'a mut StringPool,
}

/// Construct a `StringBuilder` with a *field-level* split borrow of `$lockfile`
/// (`buffers.string_bytes` + `string_pool`). Use this — not the
/// `Lockfile::string_builder()` method — at sites that also need to read other
/// `$lockfile` fields while the builder is live; the method form borrows the
/// whole struct.
#[macro_export]
macro_rules! string_builder {
    ($lockfile:expr) => {
        $crate::lockfile_real::StringBuilder {
            len: 0,
            cap: 0,
            off: 0,
            ptr: None,
            string_bytes: &mut $lockfile.buffers.string_bytes,
            string_pool: &mut $lockfile.string_pool,
        }
    };
}

use bun_semver::semver_string::BuilderStringType as StringBuilderType;

impl<'a> StringBuilder<'a> {
    #[inline]
    pub(crate) fn count(&mut self, slice: &[u8]) {
        self.assert_not_allocated();

        if SemverString::can_inline(slice) {
            return;
        }
        self.count_with_hash(slice, SemverStringBuilder::string_hash(slice));
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
    fn count_with_hash(&mut self, slice: &[u8], hash: u64) {
        self.assert_not_allocated();

        // `append` also stores a string whose hash collides with another string's.
        let bytes = self.string_bytes.as_slice();
        let pooled = self.string_pool.get(hash);
        if !pooled.is_some_and(|pooled| strings::eql(pooled.slice(bytes), slice)) {
            self.cap += slice.len();
        }
    }

    pub(crate) fn clamp(&mut self) {
        debug_assert!(self.cap >= self.len);
        // assert that no other builder was allocated while this builder was being used
        debug_assert!(self.string_bytes.len() == self.off + self.cap);

        let excess = self.cap - self.len;

        if excess > 0 {
            let new_len = self.string_bytes.len() - excess;
            self.string_bytes.truncate(new_len);
        }
    }

    pub(crate) fn allocate(&mut self) -> Result<(), AllocError> {
        let string_bytes = &mut *self.string_bytes;
        let prev_len = string_bytes.len();
        // Zeroed: `as_slice()` callers read the full slice including the not-yet-appended tail.
        string_bytes.resize(prev_len + self.cap, 0);
        self.off = prev_len;
        // SAFETY: `string_bytes` was just resized to `prev_len + self.cap`, so
        // offsetting its base pointer by `prev_len` stays within the allocation.
        self.ptr = Some(unsafe { string_bytes.as_mut_ptr().add(prev_len) });
        self.len = 0;
        Ok(())
    }

    /// Keys the pool by the hash of `slice`, as `count` does, so it never writes uncounted bytes.
    pub(crate) fn append<T: StringBuilderType>(&mut self, slice: &[u8]) -> T {
        let hash = SemverStringBuilder::string_hash(slice);
        if SemverString::can_inline(slice) {
            return T::from_init(self.string_bytes.as_slice(), slice, hash);
        }

        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        let string_entry = self.string_pool.get_or_put(hash).expect("unreachable");
        if string_entry.found_existing
            && strings::eql(
                string_entry.value_ptr.slice(self.string_bytes.as_slice()),
                slice,
            )
        {
            return T::from_pooled(*string_entry.value_ptr, hash);
        }

        // Safe indexing into the region `allocate()` already resized.
        let start = self.off + self.len;
        let end = start + slice.len();
        self.string_bytes[start..end].copy_from_slice(slice);
        let final_slice = &self.string_bytes[start..end];
        self.len += slice.len();
        debug_assert!(self.len <= self.cap);

        let appended = SemverString::init(self.string_bytes.as_slice(), final_slice);
        // Equal hashes don't mean equal strings, so the second string isn't added to the pool.
        if !string_entry.found_existing {
            *string_entry.value_ptr = appended;
        }
        T::from_pooled(appended, hash)
    }
}

impl<'a> bun_semver::StringBuilder for StringBuilder<'a> {
    #[inline]
    fn count(&mut self, slice_: &[u8]) {
        StringBuilder::count(self, slice_)
    }
    #[inline]
    fn append<T: bun_semver::semver_string::BuilderStringType>(&mut self, slice_: &[u8]) -> T {
        StringBuilder::append::<T>(self, slice_)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// PackageIndex
// ────────────────────────────────────────────────────────────────────────────

pub mod package_index {
    use super::*;

    // `bun_collections::HashMap` hard-codes an 80% max load factor.
    pub type Map = BunHashMap<PackageNameHash, Entry, IdentityContext<PackageNameHash>>;

    pub enum Entry {
        Id(PackageID),
        Ids(PackageIDList),
    }

    impl Entry {
        pub(crate) fn as_slice(&self) -> &[PackageID] {
            match self {
                Entry::Id(id) => core::slice::from_ref(id),
                Entry::Ids(ids) => ids.as_slice(),
            }
        }

        /// Keeps the ids sorted by descending resolution. `id` goes after the ids that it's equal
        /// to.
        pub(super) fn insert(&mut self, id: PackageID, resolutions: &[Resolution], buf: &[u8]) {
            let at = (self.as_slice().iter())
                .position(|&existing_id| {
                    resolutions[id as usize].order(&resolutions[existing_id as usize], buf, buf)
                        == Ordering::Greater
                })
                .unwrap_or(self.as_slice().len());
            match self {
                Entry::Id(existing_id) => {
                    let mut ids = PackageIDList::with_capacity(8);
                    ids.push(*existing_id);
                    ids.insert(at, id);
                    *self = Entry::Ids(ids);
                }
                Entry::Ids(ids) => ids.insert(at, id),
            }
        }
    }

    impl Default for Entry {
        /// `HashMap::get_or_put` needs a `Default` to fill the value slot before
        /// the caller writes the real `Entry::Id(..)` / `Entry::Ids(..)`.
        #[inline]
        fn default() -> Self {
            Entry::Id(0)
        }
    }
}

pub use package_index::Entry as PackageIndexEntry;
pub use package_index::Map as PackageIndexMap;

// ────────────────────────────────────────────────────────────────────────────
// FormatVersion
// ────────────────────────────────────────────────────────────────────────────

/// The binary lockfile serializer reads this u32 directly from disk; an
/// exhaustive Rust enum would
/// make deserializing a future v4+ lockfile instant UB (transmute-to-enum with an
/// invalid discriminant). PORTING.md §Forbidden patterns: never transmute disk data
/// into an exhaustive enum. Represent as a transparent u32 with associated consts so
/// unknown values round-trip and can be compared against `current()` for a graceful
/// version-mismatch error.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct FormatVersion(pub(crate) u32);

impl FormatVersion {
    pub(crate) const V0: Self = Self(0);
    /// bun v0.0.x - bun v0.1.6
    pub(crate) const V1: Self = Self(1);
    /// bun v0.1.7+
    /// This change added tarball URLs to npm-resolved packages
    pub(crate) const V2: Self = Self(2);
    /// Changed semver major/minor/patch to each use u64 instead of u32
    pub(crate) const V3: Self = Self(3);

    pub(crate) const fn current() -> Self {
        FormatVersion::V3
    }
}

// ────────────────────────────────────────────────────────────────────────────
// EqlSorter
// ────────────────────────────────────────────────────────────────────────────

struct EqlSorter<'a> {
    pub string_buf: &'a [u8],
    pub pkg_names: &'a [SemverString],
    pub pkg_resolutions: &'a [Resolution],
}

/// Basically placement id
#[derive(Clone, Copy)]
pub(crate) struct PathToId {
    pub pkg_id: PackageID,
    /// Borrows a `Box<[u8]>` parked in `tree_paths` for the duration of
    /// `Lockfile::eql` — `RawSlice` carries the outlives-holder invariant.
    pub tree_path: bun_ptr::RawSlice<u8>,
}

impl<'a> EqlSorter<'a> {
    fn order(&self, l: PathToId, r: PathToId) -> Ordering {
        let l_path = l.tree_path.slice();
        let r_path = r.tree_path.slice();
        strings::order(l_path, r_path)
            .then_with(|| {
                let l_name = self.pkg_names[l.pkg_id as usize];
                let r_name = self.pkg_names[r.pkg_id as usize];
                l_name.order(r_name, self.string_buf, self.string_buf)
            })
            // npm: aliases allow same-named packages in one tree node, so the
            // resolution is needed for a total order.
            .then_with(|| {
                let l_res = &self.pkg_resolutions[l.pkg_id as usize];
                let r_res = &self.pkg_resolutions[r.pkg_id as usize];
                l_res.order(r_res, self.string_buf, self.string_buf)
            })
    }
}

impl Lockfile {
    /// A placement of `r` bound past `r_loaded_package_count` was rebound after loading: a change.
    pub(crate) fn eql(
        &self,
        r: &Lockfile,
        r_loaded_package_count: usize,
    ) -> Result<bool, AllocError> {
        let l: &Lockfile = self;
        let l_string_buf = l.buffers.string_bytes.as_slice();
        let r_string_buf = r.buffers.string_bytes.as_slice();

        let l_len = l.buffers.hoisted_dependencies.len();
        let r_len = r.buffers.hoisted_dependencies.len();

        if l_len != r_len {
            return Ok(false);
        }

        let mut sort_buf: Vec<PathToId> = Vec::with_capacity(l_len + r_len);

        let mut path_buf = bun_paths::path_buffer_pool::get();
        let mut depth_buf: tree::DepthBuf = tree::depth_buf_uninit();

        // Track owned tree-path allocations so they outlive the sort and are freed at scope end.
        let mut tree_paths: Vec<Box<[u8]>> = Vec::new();

        let mut side_starts = [0usize; 2];
        for (i, (side, loaded_package_count)) in [(l, usize::MAX), (r, r_loaded_package_count)]
            .into_iter()
            .enumerate()
        {
            side_starts[i] = sort_buf.len();
            for node in side.buffers.trees.iter() {
                const STYLE: tree::IteratorPathStyle = tree::IteratorPathStyle::PkgPath;
                let (rel_path, _) = tree::relative_path_and_depth::<STYLE>(
                    side.buffers.trees.as_slice(),
                    side.buffers.hoisted_dependencies.as_slice(),
                    side.buffers.dependencies.as_slice(),
                    side.buffers.string_bytes.as_slice(),
                    node.id,
                    &mut path_buf,
                    &mut depth_buf,
                );
                let tree_path: Box<[u8]> = Box::<[u8]>::from(rel_path.as_bytes());
                let tree_path_ptr = bun_ptr::RawSlice::new(&tree_path[..]);
                tree_paths.push(tree_path);
                for &dep_id in (node.dependencies).get(side.buffers.hoisted_dependencies.as_slice())
                {
                    if dep_id == invalid_dependency_id {
                        continue;
                    }
                    let pkg_id = side.buffers.resolutions[dep_id as usize];
                    if pkg_id == invalid_package_id {
                        continue;
                    }
                    if pkg_id as usize >= loaded_package_count {
                        return Ok(false);
                    }
                    sort_buf.push(PathToId {
                        pkg_id,
                        tree_path: tree_path_ptr,
                    });
                }
            }
        }
        let (l_buf, r_buf) = sort_buf.split_at_mut(side_starts[1]);

        if l_buf.len() != r_buf.len() {
            return Ok(false);
        }

        let l_pkgs = l.packages.slice();
        let r_pkgs = r.packages.slice();
        let l_pkg_names = l_pkgs.items_name();
        let r_pkg_names = r_pkgs.items_name();
        let l_pkg_name_hashes = l_pkgs.items_name_hash();
        let l_pkg_resolutions = l_pkgs.items_resolution();
        let l_pkg_bins = l_pkgs.items_bin();
        let l_pkg_scripts = l_pkgs.items_scripts();
        let r_pkg_name_hashes = r_pkgs.items_name_hash();
        let r_pkg_resolutions = r_pkgs.items_resolution();
        let r_pkg_bins = r_pkgs.items_bin();
        let r_pkg_scripts = r_pkgs.items_scripts();

        {
            let sorter = EqlSorter {
                pkg_names: l_pkg_names,
                string_buf: l_string_buf,
                pkg_resolutions: l_pkg_resolutions,
            };
            index_sort::sort_slice_unstable_by(l_buf, |a, b| sorter.order(*a, *b));
        }

        {
            let sorter = EqlSorter {
                pkg_names: r_pkg_names,
                string_buf: r_string_buf,
                pkg_resolutions: r_pkg_resolutions,
            };
            index_sort::sort_slice_unstable_by(r_buf, |a, b| sorter.order(*a, *b));
        }

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

            if l_res.tag == ResolutionTag::Uninitialized
                || r_res.tag == ResolutionTag::Uninitialized
            {
                if l_res.tag != r_res.tag {
                    return Ok(false);
                }
            } else if !l_res.eql(&r_res, l_string_buf, r_string_buf) {
                return Ok(false);
            }

            if !crate::bin::Bin::eql(
                &l_pkg_bins[l_pkg_id],
                &r_pkg_bins[r_pkg_id],
                l_string_buf,
                l_extern_strings,
                r_string_buf,
                r_extern_strings,
            ) {
                return Ok(false);
            }

            if !package::Scripts::eql(
                &l_pkg_scripts[l_pkg_id],
                &r_pkg_scripts[r_pkg_id],
                l_string_buf,
                r_string_buf,
            ) {
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
        let previous_meta_hash = self.meta_hash;
        self.meta_hash = self.generate_meta_hash(print_name_version_string, packages_len)?;
        Ok(!strings::eql_long(
            &previous_meta_hash,
            &self.meta_hash,
            false,
        ))
    }

    pub(crate) fn generate_meta_hash(
        &self,
        print_name_version_string: bool,
        packages_len: usize,
    ) -> Result<MetaHash, BunError> {
        if packages_len <= 1 {
            return Ok(ZERO_HASH);
        }

        let mut string_builder = bun_core::StringBuilder::default();
        let names: &[SemverString] = &self.packages.items_name()[..packages_len];
        let resolutions: &[Resolution] = &self.packages.items_resolution()[..packages_len];
        let bytes = self.buffers.string_bytes.as_slice();
        let mut alphabetized_names: Vec<PackageID> = vec![0; packages_len.saturating_sub(1)];

        const HASH_PREFIX: &[u8] =
            b"\n-- BEGIN SHA512/256(`${alphabetize(name)}@${order(version)}`) --\n";
        const HASH_SUFFIX: &[u8] = b"-- END HASH--\n";
        string_builder.cap += HASH_PREFIX.len() + HASH_SUFFIX.len();
        for i in 1..packages_len {
            alphabetized_names[i - 1] = i as PackageID;
            // posix path separators because we only use posix in the lockfile
            string_builder.fmt_count(format_args!(
                "{}@{}\n",
                bstr::BStr::new(names[i].slice(bytes)),
                resolutions[i].fmt(bytes, PathSep::Posix)
            ));
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
            let alphabetizer = package::Alphabetizer::<u64> {
                names: names.into(),
                buf: bytes.into(),
                resolutions: resolutions.into(),
            };
            index_sort::sort_indices_unstable(&mut alphabetized_names, &mut |a, b| {
                alphabetizer.order(a, b)
            });
        }

        string_builder.allocate().expect("unreachable");
        let _ = string_builder.append(HASH_PREFIX);

        for &i in alphabetized_names.iter() {
            let _ = string_builder.fmt(format_args!(
                "{}@{}\n",
                bstr::BStr::new(names[i as usize].slice(bytes)),
                resolutions[i as usize].fmt(bytes, PathSep::Any)
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

        let _ = string_builder.append(HASH_SUFFIX);

        let len = string_builder.len;
        let alphabetized_name_version_string = &string_builder.allocated_slice()[..len];
        if print_name_version_string {
            Output::flush();
            Output::disable_buffering();
            // `bun pm hash-string` is asked for the hashed bytes; `--verbose` ends up in CI logs.
            if PackageManager::verbose_install() {
                Output::writer()
                    .print(format_args!(
                        "{}",
                        bun_core::fmt::redacted(bstr::BStr::new(alphabetized_name_version_string))
                    ))
                    .expect("unreachable");
            } else {
                Output::writer()
                    .write_all(alphabetized_name_version_string)
                    .expect("unreachable");
            }
            Output::enable_buffering();
        }

        let mut digest = ZERO_HASH;
        // SAFETY: engine is null (default).
        unsafe {
            Crypto::SHA512_256::hash(
                alphabetized_name_version_string,
                &mut digest,
                core::ptr::null_mut(),
            )
        };

        Ok(digest)
    }

    /// `dependency_buf` is the buffer that `version` was parsed against. Auto-install passes a
    /// package.json's buffer.
    pub(crate) fn resolve_package_from_name_and_version(
        &self,
        package_name: &[u8],
        version: &DependencyVersion,
        dependency_buf: &[u8],
    ) -> Option<PackageID> {
        let candidates = self.packages_named(SemverStringBuilder::string_hash(package_name));
        let npm_group = &version.try_npm()?.version;
        let buf = self.buffers.string_bytes.as_slice();
        let resolutions = self.packages.items_resolution();
        // Root, workspace and folder packages are in the same name index, and `npm()` is only valid
        // for npm packages.
        candidates.iter().copied().find(|&id| {
            let resolution = &resolutions[id as usize];
            resolution.tag == ResolutionTag::Npm
                && npm_group.satisfies(resolution.npm().version, dependency_buf, buf)
        })
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Default trusted dependencies
// ────────────────────────────────────────────────────────────────────────────

const MAX_DEFAULT_TRUSTED_DEPENDENCIES: usize = 512;

/// Sorted list of default trusted dependency names.
///
/// Embeds `default-trusted-dependencies.txt` with `include_str!` and builds
/// the sorted slice on first access. Kept alphabetical so `bun pm trusted
/// --default` need not re-sort.
pub static DEFAULT_TRUSTED_DEPENDENCIES_LIST: std::sync::LazyLock<Vec<&'static [u8]>> =
    std::sync::LazyLock::new(|| {
        const DATA: &[u8] = include_bytes!("default-trusted-dependencies.txt");
        let mut names: Vec<&'static [u8]> = strings::tokenize_any(DATA, b" \r\n\t").collect();
        index_sort::sort_slice_unstable_by(&mut names, |a, b| a.cmp(b));
        debug_assert!(
            names.len() <= MAX_DEFAULT_TRUSTED_DEPENDENCIES,
            "default-trusted-dependencies.txt is too large, please increase \
             'MAX_DEFAULT_TRUSTED_DEPENDENCIES' in lockfile.rs"
        );
        names
    });

/// The default list of trusted dependencies is a static hashmap.
///
/// A `StaticHashMap` keyed by truncated-u32 string-hash, populated lazily on
/// first access. The hash is the truncated string hash so entries match
/// `Lockfile.trusted_dependencies` keys.
pub mod default_trusted_dependencies {
    use super::{
        DEFAULT_TRUSTED_DEPENDENCIES_LIST, MAX_DEFAULT_TRUSTED_DEPENDENCIES, SemverStringBuilder,
    };
    use bun_collections::static_hash_map::{
        HashContext, HashMapMixin, StaticHashMap, static_slots,
    };
    use std::sync::LazyLock;

    const SLOTS: usize = static_slots(MAX_DEFAULT_TRUSTED_DEPENDENCIES);

    /// `Lockfile.trusted_dependencies` has the low 32 bits of the string hash; the map takes a slot from the top bits.
    fn slot_hash(hash: u32) -> u64 {
        u64::from(hash) << 32
    }

    struct TrustedDepHashCtx;
    impl HashContext<&'static [u8]> for TrustedDepHashCtx {
        #[inline]
        fn ctx_hash(s: &&'static [u8]) -> u64 {
            slot_hash(SemverStringBuilder::string_hash(s) as u32)
        }
        #[inline]
        fn ctx_eql(a: &&'static [u8], b: &&'static [u8]) -> bool {
            *a == *b
        }
    }

    type Map = StaticHashMap<
        &'static [u8],
        (),
        TrustedDepHashCtx,
        MAX_DEFAULT_TRUSTED_DEPENDENCIES,
        SLOTS,
    >;

    static MAP: LazyLock<Box<Map>> = LazyLock::new(|| {
        let mut map = Box::<Map>::default();
        for &dep in DEFAULT_TRUSTED_DEPENDENCIES_LIST.iter() {
            debug_assert!(map.len < MAX_DEFAULT_TRUSTED_DEPENDENCIES);
            let entry = map.get_or_put_assume_capacity(dep);
            debug_assert!(!entry.found_existing);
            *entry.value_ptr = ();
        }
        map
    });

    pub(crate) fn entries() -> impl Iterator<Item = (u32, &'static [u8])> {
        (MAP.entries.iter().filter(|e| !e.is_empty())).map(|e| ((e.hash >> 32) as u32, e.key))
    }

    #[inline]
    pub(crate) fn has_with_hash(hash: u32) -> bool {
        MAP.has_with_hash(slot_hash(hash))
    }

    /// Open-coded `hasContext` so the lookup key can borrow with any lifetime,
    /// not just `'static`.
    pub(crate) fn has(name: &[u8]) -> bool {
        let hash = slot_hash(SemverStringBuilder::string_hash(name) as u32);
        for entry in &MAP.entries[(hash >> MAP.shift) as usize..] {
            if entry.hash >= hash {
                return entry.hash == hash && entry.key == name;
            }
        }
        unreachable!()
    }
}

impl Lockfile {
    pub(crate) fn in_trusted_dependencies(&self, name: &[u8]) -> bool {
        let hash = SemverStringBuilder::string_hash(name) as u32;
        self.trusted_dependencies
            .as_ref()
            .is_some_and(|trusted| trusted.contains(&hash))
    }

    /// No package.json has a `trustedDependencies` list and a workspace is missing from disk. The
    /// missing one may have declared what was recorded.
    pub(crate) fn recorded_default_trust(
        recorded: &TrustedDependenciesSet,
    ) -> Result<TrustedDependenciesSet, AllocError> {
        let mut trusted = TrustedDependenciesSet::default();
        for (hash, key) in default_trusted_dependencies::entries() {
            // bun.lockb records the hash alone.
            if recorded
                .get(&hash)
                .is_some_and(|name| name.is_empty() || **name == *key)
            {
                trusted.put(hash, Box::from(key))?;
            }
        }
        Ok(trusted)
    }

    /// Replaces the set with what the package.json files declare, and returns the previous set.
    pub fn read_trusted_dependencies_from_manifests(
        &mut self,
        manifests: &mut crate::package_manager::WorkspacePackageJSONCache,
        log: &mut bun_ast::Log,
    ) -> Result<Option<TrustedDependenciesSet>, BunError> {
        let bump = bun_alloc::Arena::new();
        let mut trusted: Option<TrustedDependenciesSet> = None;
        let mut member_is_missing = false;
        let string_bytes = self.buffers.string_bytes.as_slice();
        let members = self.workspace_paths.values().iter();
        for relative_dir in
            core::iter::once(b"".as_slice()).chain(members.map(|p| p.slice(string_bytes)))
        {
            let Some(package_json_path) = join_top_level_dir(&[relative_dir, b"package.json"])
            else {
                continue;
            };
            let path = package_json_path.slice();
            let entry = match manifests.get_with_path(log, path, Default::default()) {
                crate::GetJsonResult::Entry(entry) => entry,
                // An install also skips a workspace that isn't on disk.
                crate::GetJsonResult::ReadErr(_) if !relative_dir.is_empty() => {
                    member_is_missing = true;
                    continue;
                }
                crate::GetJsonResult::ReadErr(err) | crate::GetJsonResult::ParseErr(err) => {
                    return Err(err);
                }
            };
            package::parse_append_trusted_dependencies(
                &mut trusted,
                log,
                &entry.source,
                entry.root,
                &bump,
            )?;
        }
        if member_is_missing
            && trusted.is_none()
            && let Some(recorded) = &self.trusted_dependencies
        {
            trusted = Some(Self::recorded_default_trust(recorded)?);
        }
        Ok(core::mem::replace(&mut self.trusted_dependencies, trusted))
    }

    pub fn has_trusted_dependency(
        &self,
        alias: &[u8],
        pkg_name: &[u8],
        resolution: &Resolution,
    ) -> bool {
        if let Some(trusted_dependencies) = &self.trusted_dependencies {
            let trusted_name = resolution.trusted_name(alias, pkg_name);
            let hash = SemverStringBuilder::string_hash(trusted_name) as u32;
            let name_is_trusted = match trusted_dependencies.get(&hash) {
                Some(name) => !name.is_empty() && **name == *trusted_name,
                None => false,
            };
            return name_is_trusted && self.can_trust_by_name(alias, resolution);
        }

        // Only allow default trusted dependencies for npm packages. Check the
        // resolved package's real name, not the dependency alias, so an
        // `npm:`-aliased package can't inherit trust from a default-trusted
        // name.
        if resolution.tag != ResolutionTag::Npm || !default_trusted_dependencies::has(pkg_name) {
            return false;
        }

        let buf = self.buffers.string_bytes.as_slice();
        let npm = resolution.npm();
        let url = npm.url.slice(buf);
        if url.is_empty() {
            return true;
        }
        let registry = PackageManager::get()
            .scope_for_package_name(pkg_name)
            .url
            .href();
        url == registry_tarball_url(registry, pkg_name, npm.version, buf).as_slice()
    }

    /// Returns true if listing `alias` in `trustedDependencies` can make `has_trusted_dependency`
    /// return true.
    pub fn can_trust_by_name(&self, alias: &[u8], resolution: &Resolution) -> bool {
        resolution.tag == ResolutionTag::Npm
            || self.declared_by_root_or_workspace(alias, resolution)
    }

    fn declared_by_root_or_workspace(&self, alias: &[u8], resolution: &Resolution) -> bool {
        let buf = self.buffers.string_bytes.as_slice();
        let packages = self.packages.slice();
        let resolutions = packages.items_resolution();
        let dependencies_lists = packages.items_dependencies();
        for (pkg_resolution, dependencies) in resolutions.iter().zip(dependencies_lists.iter()) {
            if pkg_resolution.tag != ResolutionTag::Workspace
                && pkg_resolution.tag != ResolutionTag::Root
            {
                continue;
            }
            for dep_id in dependencies.begin()..dependencies.end() {
                let dep = &self.buffers.dependencies[dep_id as usize];
                if dep.name.slice(buf) != alias {
                    continue;
                }
                let package_id = self.buffers.resolutions[dep_id as usize];
                if package_id == invalid_package_id || package_id as usize >= resolutions.len() {
                    continue;
                }
                if resolutions[package_id as usize].eql(resolution, buf, buf) {
                    return true;
                }
            }
        }

        false
    }
}

// ────────────────────────────────────────────────────────────────────────────
// PatchedDep
// ────────────────────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Clone, Copy)]
pub struct PatchedDep {
    /// e.g. "patches/is-even@1.0.0.patch"
    pub(crate) path: SemverString,
    _padding: [u8; 7],
    pub(crate) patchfile_hash_is_null: bool,
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
    /// Construct with just `path` set. Exists because
    /// the explicit-padding / private-hash fields make the `..Default::default()`
    /// struct-update form unusable from sibling modules.
    pub(crate) fn with_path(path: SemverString) -> Self {
        Self {
            path,
            ..Default::default()
        }
    }

    pub(crate) fn set_patchfile_hash(&mut self, val: Option<u64>) {
        self.patchfile_hash_is_null = val.is_none();
        self.__patchfile_hash = val.unwrap_or(0);
    }

    pub(crate) fn patchfile_hash(&self) -> Option<u64> {
        if self.patchfile_hash_is_null {
            None
        } else {
            Some(self.__patchfile_hash)
        }
    }
}
