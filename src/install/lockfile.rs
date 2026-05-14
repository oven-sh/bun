//! Lockfile — in-memory representation of bun.lock / bun.lockb
//!
//! Ported from src/install/lockfile.zig

use core::cmp::Ordering;
use core::fmt;
use core::ptr::NonNull;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_collections::{
    ArrayHashMap, ArrayIdentityContext, ArrayIdentityContextU64, DynamicBitSet,
    HashMap as BunHashMap, IdentityContext, LinearFifo, linear_fifo::DynamicBuffer,
};
use bun_core::fmt::PathSep;
use bun_core::{Error as BunError, Global, Output, err};
use bun_paths::{self as Path, MAX_PATH_BYTES, PathBuffer, SEP, SEP_STR, platform, resolve_path};
// `bun_install` sits above `bun_resolver` in the crate graph (no cycle), so use
// the real resolver `FileSystem` directly — same as `PackageManager.rs`.
use crate::bun_json as JSON;
use bun_core::zstr;
use bun_core::{ZStr, strings};
use bun_dotenv as DotEnv;
use bun_perf::system_timer::Timer;
use bun_resolver::fs::{self as Fs, FileSystem};
use bun_semver::{self as Semver, ExternalString, String as SemverString};
use bun_sha_hmac as Crypto;
use bun_sys::{self as sys, Fd, File};

use crate::config_version::ConfigVersion;
use crate::migration;
use crate::package_install::Summary as PackageInstallSummary;
use crate::package_manager::WorkspaceFilter;
use crate::package_manager_real::{
    Options as PackageManagerOptions, options::LogLevel, populate_manifest_cache,
};
use crate::resolution_real::{self as resolution, Resolution};
use crate::string_builder;
use crate::update_request::UpdateRequest;
use crate::{
    self as Install, DependencyID, ExternalSlice, Features, PackageID, PackageInstall,
    PackageManager, PackageNameAndVersionHash, PackageNameHash, TruncatedPackageNameHash,
    dependency, dependency::Dependency, initialize_store, invalid_dependency_id,
    invalid_package_id, npm as Npm,
};

// ────────────────────────────────────────────────────────────────────────────
// Sub-module declarations — Zig basenames preserved per PORTING.md, hence
// explicit #[path] attrs for PascalCase / dotted file names.
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
#[path = "lockfile/Package.rs"]
pub mod package;
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
pub use self::lockfile_json_stringify_for_debugging::json_stringify;
pub use self::override_map::OverrideMap;
pub use self::package::Package; // TODO(port): Zig was `Package(u64)` — generic instantiation
pub use self::tree::Tree;
pub use crate::padding_checker::assert_no_uninitialized_padding;
// Bring the derive-generated `items_*` column accessors (`PackageColumns` for
// `MultiArrayList<Package>`, `PackageColumns` for `Slice<Package>`) into scope.
use self::package::{PackageColumns as _};

// Zig path-style associated types (`Dependency.Version`, `Resolution.Tag`,
// `String.Buf`/`String.Builder`) are module-level types in the Rust port.
// Alias them locally so the body reads like the spec.
type DependencyVersion = dependency::Version;
type ResolutionTag = resolution::Tag;
type SemverStringBuf<'a> = bun_semver::semver_string::Buf<'a>;
type SemverStringBuilder = bun_semver::semver_string::Builder;

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

pub type NameHashMap = ArrayHashMap<PackageNameHash, SemverString, ArrayIdentityContextU64>;
pub type TrustedDependenciesSet = ArrayHashMap<TruncatedPackageNameHash, (), ArrayIdentityContext>;
pub type VersionHashMap = ArrayHashMap<PackageNameHash, Semver::Version, ArrayIdentityContextU64>;
pub type PatchedDependenciesMap =
    ArrayHashMap<PackageNameAndVersionHash, PatchedDep, ArrayIdentityContextU64>;

pub type StringPool = bun_semver::string::StringPool;
// Zig: `String.Builder.StringPool` — `bun_semver::semver_string::StringPool`.

pub type MetaHash = [u8; 32]; // Sha512T256.digest_length
pub const ZERO_HASH: MetaHash = [0u8; 32];

/// Result of `maybe_clone_filtering_root_packages`: either the input lockfile was
/// returned unchanged (borrowed), or a freshly-allocated cleaned lockfile is returned
/// (owned). Spec lockfile.zig returns a `*Lockfile` in both cases; Rust distinguishes
/// ownership so the caller can drop the `Box` when done.
pub enum Cleaned<'a> {
    /// No changes needed — caller's lockfile is returned as-is.
    Same(&'a mut Lockfile),
    /// A new lockfile was allocated by `clean`; caller owns it.
    New(Box<Lockfile>),
}

impl<'a> Cleaned<'a> {
    #[inline]
    pub fn as_mut(&mut self) -> &mut Lockfile {
        match self {
            Cleaned::Same(l) => l,
            Cleaned::New(l) => l,
        }
    }
}

// TODO(port): std.io.FixedBufferStream([]u8) — replace with cursor over &mut [u8]
pub type Stream = bun_io::FixedBufferStream<Vec<u8>>;

/// Duck-typed surface that `Buffers::write_array`/`save` and
/// `Package::Serializer::save` expect of their `stream` parameter — Zig passes
/// `anytype` (lockfile/Buffers.zig:142, bun.lockb.zig). Expressed as a trait so
/// the Rust port can stay generic over the borrowck-reshaped `StreamType` in
/// `bun.lockb.rs` (which collapses stream + writer into one `&mut`).
pub trait PositionalStream {
    /// Zig: `try stream.getPos()` — current write position.
    fn get_pos(&self) -> Result<usize, BunError>;
    /// Zig: `stream.pwrite(bytes, index)` — positional write, returns bytes
    /// written (always `data.len()` for in-memory buffers).
    fn pwrite(&mut self, data: &[u8], index: usize) -> usize;
}

impl<'a> PositionalStream for Serializer::StreamType<'a> {
    #[inline]
    fn get_pos(&self) -> Result<usize, BunError> {
        Serializer::StreamType::get_pos(self)
    }
    #[inline]
    fn pwrite(&mut self, data: &[u8], index: usize) -> usize {
        Serializer::StreamType::pwrite(self, data, index)
    }
}

pub const DEFAULT_FILENAME: &str = "bun.lockb";

// ────────────────────────────────────────────────────────────────────────────
// Lockfile struct
// ────────────────────────────────────────────────────────────────────────────

pub struct Lockfile {
    /// The version of the lockfile format, intended to prevent data corruption for format changes.
    pub format: FormatVersion,

    pub text_lockfile_version: bun_lock::Version,

    pub meta_hash: MetaHash,

    pub packages: PackageList,
    // TODO(port): Lockfile.Package.List is a MultiArrayList<Package>
    pub buffers: Buffers,

    /// name -> PackageID || [*]PackageID
    /// Not for iterating.
    pub package_index: PackageIndexMap,
    pub string_pool: StringPool,
    // std.mem.Allocator param — dropped per PORTING.md (global mimalloc)
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

    /// `packages.len()` at the moment lockfile load (including npm/pnpm/yarn
    /// migration) finished. Packages with `id < this` were carried in from a
    /// lockfile and represent a user-pinned resolution; packages with
    /// `id >= this` were appended by manifest fetches in the current
    /// resolve session. `get_package_id` uses this to keep its
    /// order-independence guard from overriding lockfile pins. Set by
    /// `mark_loaded_packages`; defaults to `invalid_package_id` (no lockfile
    /// loaded → guard applies to nothing, equivalent to "all entries are
    /// session-appended").
    ///
    /// Runtime-only — never serialised.
    pub loaded_package_count: PackageID,

    /// `bit[id] == true` ⇔ package `id` was appended for a dependency whose
    /// version range was an exact `=X.Y.Z` (i.e. the user — root or workspace
    /// — pinned this exact version somewhere in the tree). `get_package_id`'s
    /// order-independence guard never blocks deduping to one of these: an
    /// exact pin is a deliberate choice, not an artifact of which manifest
    /// happened to land first. Runtime-only — never serialised; sized lazily
    /// in `mark_exact_pin`.
    pub exact_pinned: Vec<bool>,
}

/// Zig: `Lockfile.Package.List` — `MultiArrayList(Package)`.
pub type PackageList = self::package::List<u64>;

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

    /// Indexed mutable access matching `NAMES` order — replaces Zig
    /// `@field(lockfile.scripts, Lockfile.Scripts.names[i])`.
    pub fn hook_mut(&mut self, i: usize) -> &mut Vec<Box<[u8]>> {
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
    /// Rust has no `@field(self, name)`; the field-ref half stays hand-listed,
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

    pub fn save_format(&self, options: &PackageManagerOptions) -> LockfileFormat {
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
            LoadResult::NotFound | LoadResult::Err(_) => (ConfigVersion::CURRENT, true),
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

    /// Zig: `load_lockfile.ok` field projection (src/install/lockfile.zig).
    /// Callers reach this only after `handleLoadLockfileErrors` has exited on
    /// the `NotFound`/`Err` arms, so the variant is known-`Ok`.
    bun_core::enum_unwrap!(pub LoadResult, Ok => fn ok / ok_mut -> LoadResultOk<'a>);
}

// ────────────────────────────────────────────────────────────────────────────
// InstallResult
// ────────────────────────────────────────────────────────────────────────────

pub struct InstallResult {
    pub lockfile: Option<NonNull<Lockfile>>,
    // TODO(port): lifetime — no construction sites found in src/install/
    pub summary: PackageInstallSummary,
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
        // Zig: `bun.assert(FileSystem.instance_loaded);`
        // SAFETY: read of a process-global flag; matches Zig's bare global read.
        debug_assert!(Fs::INSTANCE_LOADED.load(core::sync::atomic::Ordering::Relaxed));

        let mut lockfile_format = LockfileFormat::Text;
        let file: File = 'file: {
            match File::openat(dir, zstr!("bun.lock"), sys::O::RDONLY, 0) {
                sys::Result::Ok(f) => break 'file f,
                sys::Result::Err(text_open_err) => {
                    if text_open_err.errno != sys::SystemErrno::ENOENT as u16 {
                        return LoadResult::Err(LoadResultErr {
                            step: LoadStep::OpenFile,
                            value: BunError::from(text_open_err),
                            lockfile_path: zstr!("bun.lock"),
                            format: LockfileFormat::Text,
                        });
                    }

                    lockfile_format = LockfileFormat::Binary;

                    match File::openat(dir, zstr!("bun.lockb"), sys::O::RDONLY, 0) {
                        sys::Result::Ok(f) => break 'file f,
                        sys::Result::Err(binary_open_err) => {
                            if binary_open_err.errno != sys::SystemErrno::ENOENT as u16 {
                                return LoadResult::Err(LoadResultErr {
                                    step: LoadStep::OpenFile,
                                    value: BunError::from(binary_open_err),
                                    lockfile_path: zstr!("bun.lockb"),
                                    format: LockfileFormat::Binary,
                                });
                            }

                            if ATTEMPT_LOADING_FROM_OTHER_LOCKFILE {
                                if let Some(pm) = manager {
                                    // Zig assigns `lockfile_format = .text` on `.ok` here,
                                    // but the local is dead past `return migrate_result` —
                                    // the format is carried inside the `LoadResult` itself.
                                    return migration::detect_and_load_other_lockfile(
                                        self, dir, pm, log,
                                    );
                                }
                            }

                            return LoadResult::NotFound;
                        }
                    }
                }
            }
        };

        // Zig: `file.readToEnd(allocator).unwrap() catch |err| ...`.
        // The live `bun_sys::File::read_to_end` returns `Maybe<Vec<u8>>`
        // (fstat-presized, pread-from-0); map the error arm to `.read_file`.
        let buf = match file.read_to_end() {
            Ok(bytes) => bytes,
            Err(e) => {
                return LoadResult::Err(LoadResultErr {
                    step: LoadStep::ReadFile,
                    value: BunError::from(e),
                    lockfile_path: if lockfile_format == LockfileFormat::Text {
                        zstr!("bun.lock")
                    } else {
                        zstr!("bun.lockb")
                    },
                    format: lockfile_format,
                });
            }
        };

        if lockfile_format == LockfileFormat::Text {
            let source = bun_ast::Source::init_path_string(b"bun.lock", buf.as_slice());
            initialize_store();
            let bump = bun_alloc::Arena::new();
            let json = match JSON::parse_package_json_utf8(&source, log, &bump) {
                Ok(j) => j,
                Err(e) => {
                    return LoadResult::Err(LoadResultErr {
                        step: LoadStep::ParseFile,
                        value: e,
                        lockfile_path: zstr!("bun.lock"),
                        format: lockfile_format,
                    });
                }
            };

            if let Err(e) =
                TextLockfile::parse_into_binary_lockfile(self, json, &source, log, manager)
            {
                if matches!(e, TextLockfile::ParseError::OutOfMemory) {
                    bun_core::out_of_memory();
                }
                return LoadResult::Err(LoadResultErr {
                    step: LoadStep::ParseFile,
                    value: BunError::from(e),
                    lockfile_path: zstr!("bun.lock"),
                    format: lockfile_format,
                });
            }

            bun_core::analytics::Features::text_lockfile_inc();

            return LoadResult::Ok(LoadResultOk {
                lockfile: self,
                serializer_result: Serializer::SerializerLoadResult::default(),
                loaded_from_binary_lockfile: false,
                migrated: Migrated::None,
                format: lockfile_format,
            });
        }

        // TODO(port): borrowck — `self` is reborrowed inside `result` via &'a mut Lockfile.
        // PORT NOTE: reshaped for borrowck — the debug round-trip block below mutates `self`
        // through `result.ok.lockfile` which already holds the &mut. The `BUN_DEBUG_TEST_
        // TEXT_LOCKFILE` round-trip path (lockfile.zig:364-406) needs simultaneous access
        // to `manager` (already moved into the call above for `Option<&mut PackageManager>`)
        // and the `&mut Lockfile` inside `result`. Restoring it requires the
        // `manager.as_deref_mut()` reborrow which today's `Option<&mut PackageManager>`
        // surface forbids. Until reconciler-6, the debug round-trip is omitted.
        // TODO(port): re-enable BUN_DEBUG_TEST_TEXT_LOCKFILE round-trip once borrowck reshape lands.
        self.load_from_bytes(manager, buf, log)
    }

    pub fn load_from_bytes<'a>(
        &'a mut self,
        pm: Option<&mut PackageManager>,
        buf: Vec<u8>,
        log: &mut bun_ast::Log,
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
                    lockfile_path: zstr!("bun.lockb"),
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
        meta: &package::Meta,
        cpu: Npm::Architecture,
        os: Npm::OperatingSystem,
    ) -> bool {
        if meta.is_disabled(cpu, os) {
            return true;
        }

        let dep = &self.buffers.dependencies[dep_id as usize];

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
    pub fn maybe_clone_filtering_root_packages<'a>(
        old: &'a mut Lockfile,
        manager: &'a mut PackageManager,
        features: Features,
        exact_versions: bool,
        log_level: LogLevel,
    ) -> Result<Cleaned<'a>, BunError> {
        // TODO(port): narrow error set
        let old_packages = old.packages.slice();
        let old_dependencies_lists = old_packages.items_dependencies();
        let old_resolutions_lists = old_packages.items_resolutions();
        let old_resolutions = old_packages.items_resolution();
        let mut any_changes = false;
        let end: PackageID = old.packages.len() as PackageID; // @truncate

        // set all disabled dependencies of workspaces to `invalid_package_id`
        for package_id in 0..end as usize {
            if package_id != 0 && old_resolutions[package_id].tag != ResolutionTag::Workspace {
                continue;
            }

            let old_workspace_dependencies_list = old_dependencies_lists[package_id];
            let old_workspace_resolutions_list = old_resolutions_lists[package_id];

            let old_workspace_dependencies =
                old_workspace_dependencies_list.get(old.buffers.dependencies.as_slice());
            let old_workspace_resolutions =
                old_workspace_resolutions_list.mut_(old.buffers.resolutions.as_mut_slice());

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
            return Ok(Cleaned::Same(old));
        }

        old.clean(manager, &mut [], exact_versions, log_level)
            .map(Cleaned::New)
    }

    fn preprocess_update_requests(
        old: &mut Lockfile,
        manager: &mut PackageManager,
        updates: &mut [UpdateRequest],
        exact_versions: bool,
    ) -> Result<(), BunError> {
        // TODO(port): narrow error set
        let workspace_package_id = manager
            .root_package_id
            .get(old, manager.workspace_name_hash);
        let root_deps_list: DependencySlice =
            old.packages.items_dependencies()[workspace_package_id as usize];

        if (root_deps_list.off as usize) < old.buffers.dependencies.len() {
            // PORT NOTE: split-borrow — `string_builder!` only takes
            // `old.buffers.string_bytes` + `old.string_pool`, leaving
            // `old.packages` / `old.buffers.{dependencies,resolutions}` free.
            let mut string_builder = string_builder!(old);

            {
                let root_deps: &[Dependency] =
                    root_deps_list.get(old.buffers.dependencies.as_slice());
                let old_resolutions_list =
                    old.packages.items_resolutions()[workspace_package_id as usize];
                let old_resolutions: &[PackageID] =
                    old_resolutions_list.get(old.buffers.resolutions.as_slice());
                let resolutions_of_yore: &[Resolution] = old.packages.items_resolution();
                let packages_len = old.packages.len();

                for update in updates.iter() {
                    if update.package_id == invalid_package_id {
                        debug_assert_eq!(root_deps.len(), old_resolutions.len());
                        for (dep, &old_resolution) in root_deps.iter().zip(old_resolutions.iter()) {
                            if dep.name_hash == SemverStringBuilder::string_hash(update.name) {
                                if old_resolution as usize >= packages_len {
                                    continue;
                                }
                                let res = resolutions_of_yore[old_resolution as usize];
                                if res.tag != ResolutionTag::Npm
                                    || update.version.tag != dependency::Tag::DistTag
                                {
                                    continue;
                                }

                                // TODO(dylan-conway): this will need to handle updating dependencies (exact, ^, or ~) and aliases

                                // PORT NOTE: Zig's `switch (exact_versions) { else => |exact| ... }` is just a
                                // way to capture a comptime-ish bool; in Rust we use it directly.
                                let npm_ver = res.npm().version;
                                let len = bun_core::fmt::count(format_args!(
                                    "{}{}",
                                    if exact_versions { "" } else { "^" },
                                    npm_ver.fmt(string_builder.string_bytes.as_slice()),
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
            // Spec lockfile.zig:507 is `defer string_builder.clamp();` — runs once after the
            // entire second loop completes. A scopeguard would mutably capture
            // `string_builder`, conflicting with the `append` calls below. Call `clamp()`
            // explicitly at the end of this block instead (the inner loop has no `?` exits;
            // the only fallible call above is `allocate()`, which precedes this point).

            {
                let mut temp_buf = [0u8; 513];

                let root_deps: &mut [Dependency] =
                    root_deps_list.mut_(old.buffers.dependencies.as_mut_slice());
                let old_resolutions_list_lists = old.packages.items_resolutions();
                let old_resolutions_list =
                    old_resolutions_list_lists[workspace_package_id as usize];
                let old_resolutions: &[PackageID] =
                    old_resolutions_list.get(old.buffers.resolutions.as_slice());
                let resolutions_of_yore: &[Resolution] = old.packages.items_resolution();
                let packages_len = old.packages.len();

                for update in updates.iter_mut() {
                    if update.package_id == invalid_package_id {
                        debug_assert_eq!(root_deps.len(), old_resolutions.len());
                        for (dep, &old_resolution) in
                            root_deps.iter_mut().zip(old_resolutions.iter())
                        {
                            if dep.name_hash == SemverStringBuilder::string_hash(update.name) {
                                if old_resolution as usize >= packages_len {
                                    continue;
                                }
                                let res = resolutions_of_yore[old_resolution as usize];
                                if res.tag != ResolutionTag::Npm
                                    || update.version.tag != dependency::Tag::DistTag
                                {
                                    continue;
                                }

                                // TODO(dylan-conway): this will need to handle updating dependencies (exact, ^, or ~) and aliases

                                let npm_ver = res.npm().version;
                                let buf = {
                                    let mut cursor: &mut [u8] = &mut temp_buf[..];
                                    let start_len = cursor.len();
                                    if write!(
                                        cursor,
                                        "{}{}",
                                        if exact_versions { "" } else { "^" },
                                        npm_ver.fmt(string_builder.string_bytes.as_slice()),
                                    )
                                    .is_err()
                                    {
                                        // Zig: `catch break` — breaks the inner for-loop.
                                        break;
                                    }
                                    let written = start_len - cursor.len();
                                    &temp_buf[..written]
                                };

                                let external_version = string_builder.append::<ExternalString>(buf);
                                let sliced = external_version
                                    .value
                                    .sliced(string_builder.string_bytes.as_slice());
                                dep.version = dependency::parse(
                                    dep.name,
                                    dep.name_hash,
                                    sliced.slice,
                                    &sliced,
                                    None,
                                    &mut *manager,
                                )
                                .unwrap_or_default();
                            }
                        }
                    }

                    update.e_string = None;
                }
            }

            string_builder.clamp();
        }
        Ok(())
    }

    pub fn clean(
        &mut self,
        manager: &mut PackageManager,
        updates: &mut [UpdateRequest],
        exact_versions: bool,
        log_level: LogLevel,
    ) -> Result<Box<Lockfile>, BunError> {
        // TODO(port): narrow error set
        // This is wasteful, but we rarely log anything so it's fine.
        let mut log = bun_ast::Log::init();
        // defer { for (...) item.deinit(); log.deinit(); } — handled by Drop

        self.clean_with_logger(manager, updates, &mut log, exact_versions, log_level)
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
    pub fn is_workspace_root_dependency(&self, id: DependencyID) -> bool {
        self.packages.items_dependencies()[0].contains(id)
    }

    /// Is this a direct dependency of the workspace the install is taking place in?
    pub fn is_root_dependency(&self, manager: &mut PackageManager, id: DependencyID) -> bool {
        // Zig: `manager: *PackageManager` — `RootPackageId::get` caches into `manager`.
        let root_id = manager
            .root_package_id
            .get(self, manager.workspace_name_hash);
        self.packages.items_dependencies()[root_id as usize].contains(id)
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
        for (pkg_id, (resolution, dependencies)) in resolutions
            .iter()
            .zip(dependencies_lists.iter())
            .enumerate()
        {
            if resolution.tag != ResolutionTag::Workspace && resolution.tag != ResolutionTag::Root {
                continue;
            }
            if dependencies.contains(id) {
                return PackageID::try_from(pkg_id).expect("int cast");
            }
        }

        invalid_package_id
    }

    /// Does this tree id belong to a workspace (including workspace root)?
    /// TODO(dylan-conway) fix!
    pub fn is_workspace_tree_id(&self, id: tree::Id) -> bool {
        id == 0
            || self.buffers.dependencies[self.buffers.trees[id as usize].dependency_id as usize]
                .behavior
                .is_workspace()
    }

    /// Returns the package id of the workspace the install is taking place in.
    pub fn get_workspace_package_id(
        &self,
        workspace_name_hash: Option<PackageNameHash>,
    ) -> PackageID {
        if let Some(workspace_name_hash_) = workspace_name_hash {
            let packages = self.packages.slice();
            let name_hashes = packages.items_name_hash();
            let resolutions = packages.items_resolution();
            for (i, (res, name_hash)) in resolutions.iter().zip(name_hashes.iter()).enumerate() {
                if res.tag == ResolutionTag::Workspace && *name_hash == workspace_name_hash_ {
                    return PackageID::try_from(i).expect("int cast");
                }
            }

            // should not hit this, default to root just in case
            0
        } else {
            0
        }
    }

    // `#[inline(never)]` keeps the panic/format machinery from
    // `bun_core::output` (pulled in by the cold helpers below) out of callers;
    // the hot copy/remap loop stays in this body while the three cold sections
    // — update-request preprocessing, verbose timer reporting, and the
    // trusted/patched-dependency migration — are outlined so a no-change
    // `bun install` (install/fastify bench) does not page them in.
    #[inline(never)]
    pub fn clean_with_logger(
        &mut self,
        manager: &mut PackageManager,
        updates: &mut [UpdateRequest],
        log: &mut bun_ast::Log,
        exact_versions: bool,
        log_level: LogLevel,
    ) -> Result<Box<Lockfile>, BunError> {
        // TODO(port): narrow error set
        // Zig names the receiver `old`; alias `self` so the body reads
        // identically to the spec (lockfile.zig:637).
        let old: &mut Lockfile = self;
        // Zig: `var timer: std.time.Timer = undefined;` — model the
        // uninitialized sentinel with `Option`. Outlined cold: the verbose arm
        // is debug-only and drags in `Timer`/clock-syscall error formatting.
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

        if !updates.is_empty() {
            clean_preprocess_update_requests_cold(old, manager, updates, exact_versions)?;
        }

        // Spec lockfile.zig:669: `var new = try old.allocator.create(Lockfile)` — caller owns
        // and later frees via `deinit`. PORTING.md §Forbidden patterns bans `Box::leak` to
        // satisfy a lifetime; return `Box<Lockfile>` so Drop reclaims it.
        let mut new: Box<Lockfile> = Box::new(Lockfile::init_empty_value());
        new.string_pool
            .ensure_total_capacity(old.string_pool.capacity())?;
        new.package_index
            .ensure_total_capacity(old.package_index.capacity())?;
        new.packages.ensure_total_capacity(old.packages.len())?;
        new.buffers.preallocate(&old.buffers)?;
        new.patched_dependencies
            .ensure_total_capacity(old.patched_dependencies.count())?;

        // Zig: `old.scratch.dependency_list_queue.head = 0;` — reset the FIFO read
        // cursor without discarding capacity. `LinearFifo::head` is private; the
        // queue is always drained to empty before reuse here, so a `discard(count)`
        // resets `head` to 0 with the same observable effect (lockfile.zig:681).
        let queued = old.scratch.dependency_list_queue.readable_length();
        old.scratch.dependency_list_queue.discard(queued);

        {
            // PORT NOTE: reshaped for borrowck. Zig holds `&old.overrides` /
            // `&old.catalogs` while also passing `*Lockfile old` and
            // `*Lockfile new` (the latter aliased again inside `builder`).
            // The Rust signatures take `&Lockfile` for `old` and read `new`
            // through `builder.lockfile`, so the only conflict left is the
            // field-assign on `new.*` while `builder` borrows `new` — store
            // the results in temps and assign after `builder` drops.
            let old_buf = old.buffers.string_bytes.as_slice();
            let (mut builder, lf) = new.string_builder_split();
            old.overrides.count(old_buf, &mut builder);
            old.catalogs.count(old_buf, &mut builder);
            builder.allocate()?;
            *lf.overrides = old.overrides.clone(manager, old_buf, &mut builder)?;
            *lf.catalogs = old.catalogs.clone(manager, old_buf, &mut builder)?;
        }

        // Step 1. Recreate the lockfile with only the packages that are still alive
        let root = old.root_package().ok_or(err!("NoPackage"))?;

        let mut package_id_mapping = vec![invalid_package_id; old.packages.len()];
        let clone_queue_ = PendingResolutions::new();
        // PORT NOTE: explicit `&mut *` reborrows so `old`/`manager`/`new` are
        // released back to this scope once `cloner` is dropped.
        let mut cloner = Cloner {
            old: &mut *old,
            lockfile: &mut *new,
            mapping: &mut package_id_mapping,
            clone_queue: clone_queue_,
            log,
            old_preinstall_state,
            manager: &mut *manager,
            trees: tree::List::default(),
            trees_count: 1,
        };

        // try clone_queue.ensureUnusedCapacity(root.dependencies.len);
        let _ = root.clone(&mut cloner)?;

        // PORT NOTE: between here and `cloner.flush()`, `old`/`new`/`manager`
        // are live inside `cloner`. Reach them via `cloner.old` /
        // `cloner.lockfile` so borrowck sees disjoint field paths.
        {
            let old = &mut *cloner.old;
            let new = &mut *cloner.lockfile;

            // Clone workspace_paths and workspace_versions at the end.
            if old.workspace_paths.count() > 0 || old.workspace_versions.count() > 0 {
                new.workspace_paths
                    .ensure_total_capacity(old.workspace_paths.count())?;
                new.workspace_versions
                    .ensure_total_capacity(old.workspace_versions.count())?;

                // Field-level split borrow of `new` (string_bytes + string_pool).
                let mut workspace_paths_builder = string_builder!(new);

                // Sort by name for determinism
                // PORT NOTE: Zig defines a local `WorkspacePathSorter` struct; in Rust we use a closure.
                {
                    let string_buf = old.buffers.string_bytes.as_slice();
                    // `ArrayHashMap::sort` mirrors Zig's `entries.sort(ctx)` —
                    // `(keys, values, a, b) -> bool` (less-than).
                    old.workspace_paths.sort(|_keys, values, a, b| {
                        let left = values[a];
                        let right = values[b];
                        strings::order(left.slice(string_buf), right.slice(string_buf))
                            == Ordering::Less
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
                // before `re_index()` reads them. Mirrors Zig `entries.len = n`.
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
                // the zip loop below before `re_index()`. Mirrors Zig `entries.len = n`.
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
        }

        // When you run `"bun add react"
        // This is where we update it in the lockfile from "latest" to "^17.0.2"
        cloner.flush()?;
        // `cloner` no longer needed — release the reborrows of `old`/`new`/`manager`.
        drop(cloner);

        new.trusted_dependencies = old_trusted_dependencies;
        new.scripts = old_scripts;
        new.meta_hash = old.meta_hash;

        if old.patched_dependencies.count() > 0 {
            clean_migrate_patched_dependencies_cold(old, &mut new)?;
        }

        // Don't allow invalid memory to happen
        if !updates.is_empty() {
            // `UpdateRequest.version_buf` is a raw `*const [u8]` (PORTING.md
            // type-map: `[]const u8` struct-field, ARENA-class). The slice
            // points into `new.buffers.string_bytes`; `new` is *returned* to
            // the caller below and `string_bytes` is finalized at this point
            // (cloner.flush() and the patched-dep StringBuilder have both
            // run), so the storage outlives every `UpdateRequest` the caller
            // threads it through. No lifetime extension — store the raw
            // (ptr, len) and let `UpdateRequest::version_buf()` reborrow at
            // each read site.
            let string_buf = new.buffers.string_bytes.as_slice();
            let string_buf_ptr = bun_ptr::RawSlice::new(string_buf);
            let slice = new.packages.slice();

            // updates might be applied to the root package.json or one
            // of the workspace package.json files.
            let workspace_package_id = manager
                .root_package_id
                .get(&new, manager.workspace_name_hash);

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
                            update.version_buf = string_buf_ptr;
                            update.version = dep.version.clone();
                            update.package_id = package_id;

                            continue 'request_updated;
                        }
                    }
                }
            }
        }

        if log_level.is_verbose() {
            clean_verbose_report_cold(old, &new, timer);
        }

        Ok(new)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// clean_with_logger cold helpers — outlined so the hot copy/remap loop in the
// main body is contiguous in `.text` and the install/fastify no-change bench
// does not fault in update-request rewriting, patched-dep migration, or the
// verbose timer/format machinery.
// ────────────────────────────────────────────────────────────────────────────

#[cold]
#[inline(never)]
fn clean_preprocess_update_requests_cold(
    old: &mut Lockfile,
    manager: &mut PackageManager,
    updates: &mut [UpdateRequest],
    exact_versions: bool,
) -> Result<(), BunError> {
    Lockfile::preprocess_update_requests(old, manager, updates, exact_versions)
}

#[cold]
#[inline(never)]
fn clean_verbose_timer_start() -> Result<Timer, BunError> {
    Ok(Timer::start()?)
}

#[cold]
#[inline(never)]
fn clean_verbose_report_cold(old: &Lockfile, new: &Lockfile, timer: Option<Timer>) {
    Output::pretty_errorln(format_args!(
        "Clean lockfile: {} packages -> {} packages in {}\n",
        old.packages.len(),
        new.packages.len(),
        // SAFETY: only entered when `log_level.is_verbose()`, which set `timer = Some(..)`.
        bun_core::fmt::fmt_duration_one_decimal(timer.as_ref().unwrap().read()),
    ));
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
    pub clone_queue: PendingResolutions,
    pub lockfile: &'a mut Lockfile,
    pub old: &'a mut Lockfile,
    pub mapping: &'a mut [PackageID],
    pub trees: tree::List,
    pub trees_count: u32,
    pub log: &'a mut bun_ast::Log,
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

            let old_package = *self.old.packages.get(to_clone.old_resolution as usize);

            // `Package::clone` reads/writes through `cloner` exclusively.
            let new_id = old_package.clone(self)?;
            self.lockfile.buffers.resolutions[to_clone.resolve_id as usize] = new_id;
        }

        // cloning finished, items in lockfile buffer might have a different order, meaning
        // package ids and dependency ids have changed
        self.manager
            .clear_cached_items_depending_on_lockfile_buffer();

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
    pub fn resolve(&mut self, log: &mut bun_ast::Log) -> Result<(), tree::SubtreeError> {
        self.hoist::<{ tree::BuilderMethod::Resolvable }>(log, None, true, &[], None)
    }

    pub fn filter(
        &mut self,
        log: &mut bun_ast::Log,
        manager: &mut PackageManager,
        install_root_dependencies: bool,
        workspace_filters: &[WorkspaceFilter],
        packages_to_install: Option<&[PackageID]>,
    ) -> Result<(), tree::SubtreeError> {
        self.hoist::<{ tree::BuilderMethod::Filter }>(
            log,
            Some(manager),
            install_root_dependencies,
            workspace_filters,
            packages_to_install,
        )
    }

    /// Sets `buffers.trees` and `buffers.hoisted_dependencies`
    // TODO(port): Zig uses `comptime method` to make several params conditionally `void`.
    // Rust const-generic enums need #[derive(ConstParamTy)] on Tree::BuilderMethod and the
    // value-level branching can't change param types. Phase B may want two monomorphized fns.
    pub fn hoist<const METHOD: tree::BuilderMethod>(
        &mut self,
        log: &mut bun_ast::Log,
        // PORT NOTE: Zig used `comptime method` to make these params `void` for
        // non-`.filter` builds. `tree::Builder` stores them unconditionally
        // (Option/slice), so accept the concrete shapes for all `METHOD`s.
        manager: Option<&PackageManager>,
        install_root_dependencies: bool,
        workspace_filters: &[WorkspaceFilter],
        packages_to_install: Option<&[PackageID]>,
    ) -> Result<(), tree::SubtreeError> {
        let slice = self.packages.slice();

        // PORT NOTE: `tree::Builder` stores `lockfile: ParentRef<Lockfile>` so
        // the `&mut buffers.resolutions` split-borrow below can coexist with
        // the read-only lockfile view inside the builder (see Tree.rs note).
        // `ParentRef::new` captures `SharedReadOnly` provenance from `&*self`,
        // which is exactly what `Builder` needs (it only ever `Deref`s); the
        // `Builder` does not outlive this `&mut self` borrow.
        let lockfile_ref = bun_ptr::ParentRef::<Lockfile>::new(&*self);
        let mut builder = tree::Builder::<METHOD> {
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
            pending_optional_peers: Default::default(),
            list: Default::default(),
            sort_buf: Default::default(),
        };
        // TODO(port): Tree::Builder field set may differ; verify in Phase B.

        Tree::default().process_subtree(tree::ROOT_DEP_ID, tree::INVALID_ID, &mut builder)?;

        // This goes breadth-first
        while let Some(item) = builder.queue.read_item() {
            use tree::BuilderEntryColumns as _;
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
        if populate_manifest_cache::populate_manifest_cache(
            manager,
            populate_manifest_cache::Packages::All,
        )
        .is_err()
        {
            return Ok(());
        }

        let cache_ctx = manager.manifest_disk_cache_ctx();
        // PORT NOTE: heavy borrowck overlap — Zig calls
        // `manager.manifests.byNameHash(manager, …)` (manifests is a field of
        // manager) and then opens a `string_builder` on `manager.lockfile`
        // while still holding `&manifest`. Route through a raw root so disjoint
        // fields (`manifests`, `lockfile.{string_pool, buffers.*}`) can be
        // split. BACKREF `mgr_ref` wraps the same root for the read-only
        // `options` projection so it goes through safe `ParentRef::Deref`.
        let manager_ptr: *mut PackageManager = manager;
        let mgr_ref = bun_ptr::ParentRef::<PackageManager>::from(
            core::ptr::NonNull::new(manager_ptr).expect("derived from &mut, non-null"),
        );
        let mut pkgs = self.packages.slice();
        let len = pkgs.len();

        // PORT NOTE: Zig takes `pkgs.items(.bin)` / `pkgs.items(.meta)` as
        // simultaneous mutable column views; `split_mut()` yields disjoint
        // `&mut [_]` per column from one `&mut Slice` borrow.
        let self::package::PackageColumnsMut {
            name: pkg_names,
            name_hash: pkg_name_hashes,
            resolution: pkg_resolutions,
            bin: pkg_bins,
            meta,
            ..
        } = pkgs.split_mut();
        // PORT NOTE: Zig has two near-identical loops gated by `update_os_cpu`;
        // collapse to one loop and bind `pkg_metas` as an empty slice when the
        // const generic is false (Zig left it `undefined`).
        let pkg_metas: &mut [self::package::meta::Meta] =
            if UPDATE_OS_CPU { meta } else { &mut [] };

        for i in 0..len {
            let pkg_name = pkg_names[i];
            let pkg_name_hash = pkg_name_hashes[i];
            let pkg_res = pkg_resolutions[i];
            let pkg_bin = &mut pkg_bins[i];

            match pkg_res.tag {
                ResolutionTag::Npm => {
                    // `options` read via BACKREF `mgr_ref` (see hoisted note
                    // above); `manifests` and `lockfile` are non-overlapping
                    // fields and nothing below resizes/relocates `manifests`
                    // while `manifest` is held.
                    let scope = mgr_ref.options.scope_for_package_name(
                        pkg_name.slice(self.buffers.string_bytes.as_slice()),
                    );
                    // SAFETY: `manifests` projected from `manager_ptr`; the
                    // call holds only that disjoint field.
                    let Some(manifest) = unsafe { &mut (*manager_ptr).manifests }.by_name_hash(
                        cache_ctx,
                        scope,
                        pkg_name_hash,
                        Install::ManifestLoad::LoadFromMemoryFallbackToDisk,
                        false,
                    ) else {
                        continue;
                    };

                    let npm_ver = pkg_res.npm().version;
                    let Some(pkg) = manifest.find_by_version(npm_ver) else {
                        continue;
                    };

                    let lockfile = unsafe { &mut *(*manager_ptr).lockfile };
                    let mut builder = string_builder!(lockfile);

                    let mut bin_extern_strings_count: u32 = 0;

                    bin_extern_strings_count += pkg.package.bin.count(
                        &manifest.string_buf,
                        &manifest.extern_strings_bin_entries,
                        &mut builder,
                    );

                    builder.allocate()?;
                    // Spec: `defer builder.clamp()` — call explicitly at end of block (no `?`
                    // exits between here and the clamp below).

                    let extern_strings_list = &mut lockfile.buffers.extern_strings;
                    // PERF(port): was ensureUnusedCapacity
                    let start = extern_strings_list.len();
                    // Default-fill the tail so it is valid before `bin.clone`
                    // overwrites it (replaces `reserve` + raw `set_len`).
                    bun_core::vec::grow_default(
                        extern_strings_list,
                        bin_extern_strings_count as usize,
                    );
                    let new_len = extern_strings_list.len();

                    // PORT NOTE: Zig passes both `extern_strings_list.items` (full slice)
                    // and a tail subslice to `bin.clone()`; the full slice is only used to
                    // compute the tail's offset for `ExternalStringList::init`. In Rust the
                    // two views would alias, so `Bin::clone_with_buffers` takes the offset
                    // directly.
                    let extern_strings_slice = &mut extern_strings_list[start..new_len];

                    *pkg_bin = pkg.package.bin.clone_with_buffers(
                        &manifest.string_buf,
                        &manifest.extern_strings_bin_entries,
                        start as u32,
                        extern_strings_slice,
                        &mut builder,
                    );

                    builder.clamp();

                    if UPDATE_OS_CPU {
                        let pkg_meta = &mut pkg_metas[i];
                        // Update os/cpu metadata if not already set
                        if pkg_meta.os == Npm::OperatingSystem::ALL {
                            pkg_meta.os = pkg.package.os;
                        }
                        if pkg_meta.arch == Npm::Architecture::ALL {
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

/// Port of `Lockfile.Printer` (src/install/lockfile.zig).
pub struct Printer<'a> {
    pub lockfile: &'a Lockfile,
    pub options: &'a PackageManagerOptions,
    pub successfully_installed: Option<&'a DynamicBitSet>,
    pub updates: &'a [UpdateRequest],
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PrinterFormat {
    Yarn,
}

pub mod printer {
    pub use super::printer_mods::tree_printer as Tree;
    pub use super::printer_mods::yarn as Yarn;
}

impl<'a> Printer<'a> {
    #[cold]
    pub fn print(
        log: &mut bun_ast::Log,
        input_lockfile_path: &[u8],
        format: PrinterFormat,
    ) -> Result<(), BunError> {
        // TODO(port): narrow error set

        // We truncate longer than allowed paths. We should probably throw an error instead.
        let path = &input_lockfile_path[..input_lockfile_path.len().min(MAX_PATH_BYTES)];

        let mut lockfile_path_buf1 = PathBuffer::uninit();
        let mut lockfile_path_buf2 = PathBuffer::uninit();

        let mut lockfile_path: &ZStr = ZStr::EMPTY;
        // Track which buffer backs `lockfile_path` so the chdir NUL-terminate
        // step below can write into the *other* buffer. `resolve_path::z` does
        // `output[..n].copy_from_slice(input)` (→ `ptr::copy_nonoverlapping`);
        // passing a slice of `bufN` as `input` while taking `&mut bufN` as
        // `output` is UB on overlapping ranges and would also corrupt
        // `lockfile_path` (printed in the NotFound arm). Zig's
        // `bun.sys.chdir("", dirname)` accepts a non-sentinel slice directly,
        // so it never re-buffers — the hazard is Rust-port-specific.
        let mut path_in_buf2 = false;

        if !bun_paths::is_absolute(path) {
            // Zig `bun.getcwd` returns the slice; the Rust `bun_sys::getcwd`
            // returns the length written into the caller-owned buffer.
            let cwd_len = bun_sys::getcwd(&mut lockfile_path_buf1[..])?;
            let parts = [path];
            // PORT NOTE: reshaped for borrowck — copy `cwd` out of `buf1` so the
            // join can write into `buf2` while `cwd` borrows `buf1` only.
            let cwd = &lockfile_path_buf1[..cwd_len];
            let lockfile_path__len = resolve_path::join_abs_string_buf::<platform::Auto>(
                cwd,
                &mut lockfile_path_buf2.0,
                &parts,
            )
            .len();
            lockfile_path_buf2[lockfile_path__len] = 0;
            // SAFETY: NUL written at [len] above. Not `from_buf`: borrowck
            // can't see that the `path_in_buf2` flag picks the *other* buffer
            // for the chdir scratch write below, so the borrow must be detached.
            lockfile_path =
                unsafe { ZStr::from_raw(lockfile_path_buf2.as_ptr(), lockfile_path__len) };
            path_in_buf2 = true;
        } else if !path.is_empty() {
            lockfile_path_buf1[..path.len()].copy_from_slice(path);
            lockfile_path_buf1[path.len()] = 0;
            // SAFETY: NUL written at [len] above. See note above re. borrowck.
            lockfile_path = unsafe { ZStr::from_raw(lockfile_path_buf1.as_ptr(), path.len()) };
        }

        if !lockfile_path.as_bytes().is_empty() && lockfile_path.as_bytes()[0] == SEP {
            // Zig `bun.sys.chdir("", dirname)` — first arg is error-context
            // path; the Rust `bun_sys::chdir` takes the destination only.
            let dir = bun_paths::dirname(lockfile_path.as_bytes()).unwrap_or(SEP_STR.as_bytes());
            // NUL-terminate into the buffer that does NOT back `lockfile_path`
            // (see `path_in_buf2` note above). `buf1`'s cwd contents are dead
            // after the join, so it is free for reuse here.
            let dir_z = if path_in_buf2 {
                resolve_path::z(dir, &mut lockfile_path_buf1)
            } else {
                resolve_path::z(dir, &mut lockfile_path_buf2)
            };
            let _ = sys::chdir(dir_z);
        }

        // Zig: `_ = try FileSystem.init(null);` — bootstraps the resolver FS
        // singleton. `Printer::print` is an entry point (`bun bun.lockb`), so
        // the singleton may not exist yet.
        let _ = FileSystem::init(None)?;

        let mut lockfile = Box::<Lockfile>::default();

        let load_from_disk = lockfile.load_from_cwd::<false>(None, log);
        match load_from_disk {
            crate::lockfile::LoadResult::Err(cause) => {
                match cause.step {
                    crate::lockfile::LoadStep::OpenFile => Output::pretty_errorln(format_args!(
                        "<r><red>error<r> opening lockfile:<r> {}.",
                        cause.value.name()
                    )),
                    crate::lockfile::LoadStep::ParseFile => Output::pretty_errorln(format_args!(
                        "<r><red>error<r> parsing lockfile:<r> {}",
                        cause.value.name()
                    )),
                    crate::lockfile::LoadStep::ReadFile => Output::pretty_errorln(format_args!(
                        "<r><red>error<r> reading lockfile:<r> {}",
                        cause.value.name()
                    )),
                    crate::lockfile::LoadStep::Migrating => Output::pretty_errorln(format_args!(
                        "<r><red>error<r> while migrating lockfile:<r> {}",
                        cause.value.name()
                    )),
                }
                if log.errors > 0 {
                    // `IntoLogWrite` is implemented for `*mut bun_core::io::Writer`,
                    // not `&mut &mut Writer` — pass the raw vtable pointer.
                    let ew: *mut bun_core::io::Writer = Output::error_writer();
                    log.print(ew)?;
                }
                Global::crash();
            }
            crate::lockfile::LoadResult::NotFound => {
                Output::pretty_errorln(format_args!(
                    "<r><red>lockfile not found:<r> {}",
                    bun_core::fmt::QuotedFormatter {
                        text: lockfile_path.as_bytes()
                    },
                ));
                Global::crash();
            }
            crate::lockfile::LoadResult::Ok(_) => {}
        }

        let writer = Output::writer_buffered();
        match Self::print_with_lockfile(&lockfile, format, writer) {
            Ok(()) => {}
            Err(e) if e == err!("OutOfMemory") => bun_core::out_of_memory(),
            Err(e) if e == err!("BrokenPipe") || e == err!("WriteFailed") => return Ok(()),
            Err(e) => return Err(e),
        }
        Output::flush();
        Ok(())
    }

    pub fn print_with_lockfile<W: bun_io::Write>(
        lockfile: &Lockfile,
        format: PrinterFormat,
        writer: W,
    ) -> Result<(), BunError> {
        // TODO(port): narrow error set
        // SAFETY: `FileSystem::init` ran in the caller (`Printer::print`); this
        // is the process-static singleton (Zig `&FileSystem.instance`). Form a
        // short-lived `&mut` for the `read_directory` call only — single-threaded
        // CLI path, no concurrent access.
        let fs = unsafe { &mut *FileSystem::instance() };
        let mut options = PackageManagerOptions {
            max_concurrent_lifecycle_scripts: 1,
            ..Default::default()
        };

        // PORT NOTE: reshaped for borrowck — capture the `'static` cwd slice
        // before borrowing `fs.fs` mutably.
        let top_level_dir = fs.top_level_dir;
        let entries_option = fs.fs.read_directory(top_level_dir, None, 0, true)?;
        // SAFETY: `read_directory` returns a `*mut EntriesOption` into the
        // resolver's process-lifetime BSSMap; sole `&mut` on this CLI path.
        let entries: &mut Fs::DirEntry = match unsafe { &mut *entries_option } {
            Fs::EntriesOption::Entries(e) => &mut **e,
            Fs::EntriesOption::Err(e) => return Err(e.canonical_error),
        };

        // PORTING.md §Forbidden patterns: never `Box::leak` — own `map`/`loader` as locals;
        // they live for the function scope (one-shot CLI path, matches lockfile.zig:1179-1183).
        let mut map = DotEnv::Map::init();
        let mut env_loader = DotEnv::Loader::init(&mut map);
        env_loader.quiet = true;

        env_loader.load_process()?;
        // `DotEnv::Loader::load` takes `impl DirEntryProbe` (bun_dotenv sits
        // below `bun_resolver` in the crate graph); `Fs::DirEntry` impls it.
        env_loader.load(
            &*entries,
            &[] as &[&[u8]],
            DotEnv::DotEnvFileSuffix::Production,
            false,
        )?;
        let mut log = bun_ast::Log::init();
        options.load(
            &mut log,
            &mut env_loader,
            None,
            None,
            crate::Subcommand::Install,
        )?;

        let mut printer = Printer {
            lockfile,
            options: &options,
            successfully_installed: None,
            updates: &[],
        };

        let mut writer = writer;
        match format {
            PrinterFormat::Yarn => {
                printer::Yarn::print(&mut printer, &mut writer)?;
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
            let package: Package = *self.packages.get(i);
            debug_assert!(self.str(&package.name).len() == package.name.len() as usize);
            debug_assert!(
                SemverStringBuilder::string_hash(self.str(&package.name))
                    == package.name_hash as u64
            );
            debug_assert!(
                package
                    .dependencies
                    .get(self.buffers.dependencies.as_slice())
                    .len()
                    == package.dependencies.len as usize
            );
            debug_assert!(
                package
                    .resolutions
                    .get(self.buffers.resolutions.as_slice())
                    .len()
                    == package.resolutions.len as usize
            );
            debug_assert!(
                package
                    .resolutions
                    .get(self.buffers.resolutions.as_slice())
                    .len()
                    == package.dependencies.len as usize
            );
            let dependencies = package
                .dependencies
                .get(self.buffers.dependencies.as_slice());
            for dependency in dependencies {
                debug_assert!(self.str(&dependency.name).len() == dependency.name.len() as usize);
                debug_assert!(
                    SemverStringBuilder::string_hash(self.str(&dependency.name))
                        == dependency.name_hash
                );
            }
            i += 1;
        }
        Ok(())
    }

    pub fn save_to_disk(&mut self, load_result: &LoadResult<'_>, options: &PackageManagerOptions) {
        let save_format = load_result.save_format(options);
        if cfg!(debug_assertions) {
            if let Err(e) = self.verify_data() {
                Output::pretty_errorln(format_args!(
                    "<r><red>error:<r> failed to verify lockfile: {}",
                    e.name()
                ));
                Global::crash();
            }
            // Zig: `bun.assert(FileSystem.instance_loaded);`
            // SAFETY: read of a process-global flag; matches Zig's bare global read.
            debug_assert!(Fs::INSTANCE_LOADED.load(core::sync::atomic::Ordering::Relaxed));
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
            if let Err(e) =
                Serializer::save(self, options, &mut bytes, &mut total_size, &mut end_pos)
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
                write!(
                    cursor,
                    ".lock-{}.tmp\0",
                    bun_core::fmt::HexBytes::<true>(&base64_bytes)
                )
                .expect("unreachable");
            } else {
                write!(
                    cursor,
                    ".lockb-{}.tmp\0",
                    bun_core::fmt::HexBytes::<true>(&base64_bytes)
                )
                .expect("unreachable");
            }
            let written = start_len - cursor.len();
            ZStr::from_buf(&tmpname_buf, written - 1)
        };
        // TODO(port): Zig `{x}` on `&[8]u8` formats as lowercase hex of bytes; verify HexBytes matches.

        let file = match File::openat(Fd::cwd(), tmpname, sys::O::CREAT | sys::O::WRONLY, 0o777) {
            sys::Result::Err(e) => {
                Output::err(
                    e,
                    "failed to create temporary file to save lockfile",
                    format_args!(""),
                );
                Global::crash();
            }
            sys::Result::Ok(f) => f,
        };

        match file.write_all(&bytes) {
            sys::Result::Err(e) => {
                let _ = file.close(); // close error is non-actionable (Zig parity: discarded)
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
                    let _ = file.close(); // close error is non-actionable (Zig parity: discarded)
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

        Some(*self.packages.get(0))
    }

    #[inline]
    pub fn str<'a, T: bun_semver::Slicable>(&'a self, slicable: &'a T) -> &'a [u8] {
        // PORT NOTE: Zig had compile-time guards rejecting by-value String/ExternalString.
        // In Rust we just take &T; the temporary-pointer hazard does not exist.
        slicable.slice(self.buffers.string_bytes.as_slice())
    }

    /// [`str`](Self::str) with the borrow detached from `self`.
    ///
    /// The install pipeline frequently needs to read a string out of
    /// `buffers.string_bytes` and then call back into `&mut PackageManager`
    /// (which owns the `Lockfile`). Zig's `[]const u8` carries no lifetime so
    /// the borrow conflict does not exist there; in Rust the caller would
    /// otherwise have to write `unsafe { detach_lifetime(self.str(x)) }` at
    /// every site. Consolidating that here keeps the SAFETY argument in one
    /// place.
    ///
    /// SAFETY (internal): `string_bytes` is append-only for the lifetime of a
    /// resolve/enqueue pass and is never reallocated while a detached slice is
    /// live (Zig invariant). The returned slice must not outlive the
    /// `Lockfile`.
    #[inline]
    pub fn str_detached<'a, T: bun_semver::Slicable>(&self, slicable: &T) -> &'a [u8] {
        // SAFETY: see doc comment — same invariant every prior call site
        // already relied on via `bun_ptr::detach_lifetime`.
        unsafe { bun_ptr::detach_lifetime(slicable.slice(self.buffers.string_bytes.as_slice())) }
    }

    /// Construct an empty Lockfile value (in-place equivalent of Zig `initEmpty`).
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

impl Lockfile {
    pub fn init_empty_value() -> Self {
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
            overrides: OverrideMap::default(),
            catalogs: CatalogMap::default(),
            meta_hash: ZERO_HASH,
            patched_dependencies: PatchedDependenciesMap::default(),
            saved_config_version: None,
            // Fresh lockfile (no load): every package appended later is
            // session-appended, so the order-independence guard in
            // `get_package_id` applies from id 0.
            loaded_package_count: 0,
            exact_pinned: Vec::new(),
        }
    }

    /// Snapshot `packages.len()` as the "loaded from lockfile" watermark.
    /// Call exactly once after `load_from_cwd` (including npm/pnpm/yarn
    /// migration) before any manifest-driven `append_package`.
    #[inline]
    pub fn mark_loaded_packages(&mut self) {
        self.loaded_package_count = self.packages.len() as PackageID;
    }

    /// Record that package `id` was appended via an exact-version dependency
    /// (`=X.Y.Z`). See the `exact_pinned` field doc.
    #[inline]
    pub fn mark_exact_pin(&mut self, id: PackageID) {
        let i = id as usize;
        if self.exact_pinned.len() <= i {
            self.exact_pinned.resize(i + 1, false);
        }
        self.exact_pinned[i] = true;
    }

    pub fn get_package_id(
        &self,
        name_hash: u64,
        // If non-null, attempt to use an existing package
        // that satisfies this version range.
        version: Option<DependencyVersion>,
        resolution: &Resolution,
    ) -> Option<PackageID> {
        let entry = self.package_index.get(&name_hash)?;
        let resolutions: &[Resolution] = self.packages.items_resolution();
        // Borrow the `npm` arm's `Semver::Group` (not `Copy` — owns a linked
        // list head). `version` is held by-value for the whole fn body so the
        // borrow is sound; Zig's by-value copy is replaced with a `&Group`.
        let npm_version = match &version {
            Some(v) if v.tag == dependency::Tag::Npm => Some(&v.npm().version),
            _ => None,
        };
        // Order-independence guard for the `satisfies` fallback below: when the
        // caller already knows the manifest's best-match version (the npm
        // `resolution` it passes), only dedupe to an existing entry whose
        // version is at least that. Without this, the result depends on which
        // sibling's manifest happened to land first — `*` deduping to a
        // previously-appended `1.0.2` instead of resolving to `2.0.2` is the
        // long-standing "text lockfile is hoisted" flake. Lockfile-pinned deps
        // are kept out of this codepath by `Diff::generate`'s
        // satisfies-preserves-mapping rule (which keeps the resolution slot
        // populated so the early return in `get_or_put_resolved_package` fires
        // before we get here).
        let resolved_npm_floor = if resolution.tag == ResolutionTag::Npm {
            Some(resolution.npm().version)
        } else {
            None
        };
        let buf = self.buffers.string_bytes.as_slice();

        let loaded_watermark = self.loaded_package_count;
        let exact_pinned = self.exact_pinned.as_slice();
        let try_satisfies_dedupe = |id: PackageID| -> bool {
            let existing = &resolutions[id as usize];
            if existing.tag != ResolutionTag::Npm {
                return false;
            }
            let Some(npm_v) = npm_version else {
                return false;
            };
            let existing_ver = existing.npm().version;
            if !npm_v.satisfies(existing_ver, buf, buf) {
                return false;
            }
            // Order-independence guard. We refuse to dedupe a wide range to a
            // *lower* existing entry only when ALL of the following hold:
            //   - the entry was appended in this resolve session
            //     (lockfile-loaded entries are the user's existing pin),
            //   - the entry was NOT appended for an exact-`=X.Y.Z` dependency
            //     (an exact pin anywhere in the tree is a deliberate choice,
            //     not a network-order artefact — `dragon test 2` /
            //     "dependency from root satisfies range from dependency"),
            //   - the manifest's best-match is a *different major* (within a
            //     major, deduping to an older patch is the long-standing
            //     behaviour and the worst case is still ^-compatible).
            // What this leaves is exactly the cross-parent network-order
            // flake: a wide range (`*`, `>=X`) collapsing onto a sibling's
            // *range-resolved* lower major depending on whose manifest landed
            // first ("text lockfile is hoisted").
            if id >= loaded_watermark && !exact_pinned.get(id as usize).copied().unwrap_or(false) {
                if let Some(floor) = resolved_npm_floor {
                    if existing_ver.order(floor, buf, buf) == Ordering::Less
                        && existing_ver.major != floor.major
                    {
                        return false;
                    }
                }
            }
            true
        };

        match entry {
            PackageIndexEntry::Id(id) => {
                if cfg!(debug_assertions) {
                    debug_assert!((*id as usize) < resolutions.len());
                }

                if resolutions[*id as usize].eql(resolution, buf, buf) {
                    return Some(*id);
                }

                if try_satisfies_dedupe(*id) {
                    return Some(*id);
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

                    if try_satisfies_dedupe(id) {
                        return Some(id);
                    }
                }
            }
        }

        None
    }

    /// Appends `pkg` to `this.packages`, and adds to `this.package_index`.
    ///
    /// PORT NOTE: Zig takes `string_buf: []const u8` as a separate parameter
    /// (always `lockfile.buffers.string_bytes.items`). In Rust that aliases the
    /// `&mut self` borrow, so read it from `self` and split borrows at the
    /// field level (`package_index` / `packages` / `buffers.string_bytes` are
    /// disjoint).
    pub fn append_package_dedupe(&mut self, pkg: &mut Package) -> Result<PackageID, AllocError> {
        let entry = self.package_index.get_or_put(pkg.name_hash)?;

        if !entry.found_existing {
            let new_id: PackageID = PackageID::try_from(self.packages.len()).expect("int cast");
            pkg.meta.id = new_id;
            self.packages.append(*pkg)?;
            *entry.value_ptr = PackageIndexEntry::Id(new_id);
            return Ok(new_id);
        }

        let buf = self.buffers.string_bytes.as_slice();
        let mut resolutions = self.packages.items_resolution();

        match entry.value_ptr {
            PackageIndexEntry::Id(existing_id) => {
                let existing_id = *existing_id;
                if pkg
                    .resolution
                    .eql(&resolutions[existing_id as usize], buf, buf)
                {
                    pkg.meta.id = existing_id;
                    return Ok(existing_id);
                }

                let new_id: PackageID = PackageID::try_from(self.packages.len()).expect("int cast");
                pkg.meta.id = new_id;
                self.packages.append(*pkg)?;

                resolutions = self.packages.items_resolution();

                let pair = if pkg
                    .resolution
                    .order(&resolutions[existing_id as usize], buf, buf)
                    == Ordering::Greater
                {
                    [new_id, existing_id]
                } else {
                    [existing_id, new_id]
                };
                let mut ids = PackageIDList::with_capacity(8);
                ids.extend_from_slice(&pair);

                *entry.value_ptr = PackageIndexEntry::Ids(ids);

                Ok(new_id)
            }
            PackageIndexEntry::Ids(existing_ids) => {
                for &existing_id in existing_ids.iter() {
                    if pkg
                        .resolution
                        .eql(&resolutions[existing_id as usize], buf, buf)
                    {
                        pkg.meta.id = existing_id;
                        return Ok(existing_id);
                    }
                }

                let new_id: PackageID = PackageID::try_from(self.packages.len()).expect("int cast");
                pkg.meta.id = new_id;
                self.packages.append(*pkg)?;

                resolutions = self.packages.items_resolution();

                for i in 0..existing_ids.len() {
                    let existing_id = existing_ids[i];
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
                    let resolutions = self.packages.items_resolution();
                    let buf = self.buffers.string_bytes.as_slice();

                    let pair = if resolutions[id as usize].order(
                        &resolutions[existing_id as usize],
                        buf,
                        buf,
                    ) == Ordering::Greater
                    {
                        [id, existing_id]
                    } else {
                        [existing_id, id]
                    };
                    let mut ids = PackageIDList::with_capacity(8);
                    ids.extend_from_slice(&pair);

                    *index = PackageIndexEntry::Ids(ids);
                }
                PackageIndexEntry::Ids(existing_ids) => {
                    let resolutions = self.packages.items_resolution();
                    let buf = self.buffers.string_bytes.as_slice();

                    for i in 0..existing_ids.len() {
                        let existing_id = existing_ids[i];
                        if resolutions[id as usize].order(
                            &resolutions[existing_id as usize],
                            buf,
                            buf,
                        ) == Ordering::Greater
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
        // Zig's `defer` reads `package_` (the original arg) for the assertion.
        let name_hash = package_.name_hash;
        let resolution = package_.resolution;

        let mut package = package_;
        package.meta.id = id;
        self.packages.append(package)?;
        self.get_or_put_id(id, name_hash)?;

        if cfg!(debug_assertions) {
            debug_assert!(self.get_package_id(name_hash, None, &resolution).is_some());
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
    pub fn string_builder_split(&mut self) -> (StringBuilder<'_>, LockfileFields<'_>) {
        let Buffers {
            string_bytes,
            dependencies,
            resolutions,
            extern_strings,
            trees,
            hoisted_dependencies,
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
                extern_strings,
                trees,
                hoisted_dependencies,
                package_index: &mut self.package_index,
                overrides: &mut self.overrides,
                catalogs: &mut self.catalogs,
                workspace_paths: &mut self.workspace_paths,
                workspace_versions: &mut self.workspace_versions,
                patched_dependencies: &mut self.patched_dependencies,
                trusted_dependencies: &mut self.trusted_dependencies,
                scripts: &mut self.scripts,
            },
        )
    }

    pub fn string_buf(&mut self) -> SemverStringBuf<'_> {
        SemverStringBuf {
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
    BunHashMap<PackageNameHash, bun_ast::Loc, IdentityContext<PackageNameHash>>;
pub type DependencyQueue = LinearFifo<DependencySlice, DynamicBuffer<DependencySlice>>;

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
// LockfileFields — disjoint split borrow alongside StringBuilder
// ────────────────────────────────────────────────────────────────────────────

/// Mutable references to every `Lockfile` field that is *disjoint* from the
/// two columns a `StringBuilder` borrows (`buffers.string_bytes` +
/// `string_pool`). Returned by `Lockfile::string_builder_split()` so callers
/// can hold a live builder and still touch `packages` / `buffers.dependencies`
/// / `overrides` / … without raw-pointer reborrow gymnastics.
pub struct LockfileFields<'a> {
    pub packages: &'a mut PackageList,
    pub dependencies: &'a mut DependencyList,
    pub resolutions: &'a mut PackageIDList,
    pub extern_strings: &'a mut ExternalStringBuffer,
    pub trees: &'a mut tree::List,
    pub hoisted_dependencies: &'a mut DependencyIDList,
    pub package_index: &'a mut PackageIndexMap,
    pub overrides: &'a mut OverrideMap,
    pub catalogs: &'a mut CatalogMap,
    pub workspace_paths: &'a mut NameHashMap,
    pub workspace_versions: &'a mut VersionHashMap,
    pub patched_dependencies: &'a mut PatchedDependenciesMap,
    pub trusted_dependencies: &'a mut Option<TrustedDependenciesSet>,
    pub scripts: &'a mut Scripts,
}

// ────────────────────────────────────────────────────────────────────────────
// StringBuilder
// ────────────────────────────────────────────────────────────────────────────

/// PORT NOTE: Zig stored `lockfile: *Lockfile` and reached `.buffers.string_bytes`
/// / `.string_pool` through it. In Rust that coarse `&mut Lockfile` borrow
/// blocks every caller from touching disjoint fields (`packages`, `buffers
/// .dependencies`, …) while a builder is alive. Hold the two fields the
/// builder actually mutates so callers can split-borrow at the field level.
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

/// Trait implemented by `String` and `ExternalString` to support generic `append*`.
/// Replaces Zig's `comptime Type: type` switch. Canonical def lives in
/// `bun_semver::semver_string`; re-exported under the local name so generic
/// bounds in this module (`append<T: StringBuilderType>`) are unchanged.
pub use bun_semver::semver_string::BuilderStringType as StringBuilderType;

impl<'a> StringBuilder<'a> {
    #[inline]
    pub fn count(&mut self, slice: &[u8]) {
        self.assert_not_allocated();

        if SemverString::can_inline(slice) {
            return;
        }
        self._count_with_hash(slice, SemverStringBuilder::string_hash(slice));
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

        if !self.string_pool.contains(&hash) {
            self.cap += slice.len();
        }
    }

    pub fn allocated_slice(&self) -> &[u8] {
        // `allocate()` resized `string_bytes` to `off + cap` and recorded `off`,
        // so the region is addressable by safe indexing — no need for the cached
        // raw `ptr`.
        if self.ptr.is_some() {
            &self.string_bytes[self.off..self.off + self.cap]
        } else {
            b""
        }
    }

    pub fn clamp(&mut self) {
        if cfg!(debug_assertions) {
            debug_assert!(self.cap >= self.len);
            // assert that no other builder was allocated while this builder was being used
            debug_assert!(self.string_bytes.len() == self.off + self.cap);
        }

        let excess = self.cap - self.len;

        if excess > 0 {
            let new_len = self.string_bytes.len() - excess;
            self.string_bytes.truncate(new_len);
        }
    }

    pub fn allocate(&mut self) -> Result<(), AllocError> {
        let string_bytes = &mut *self.string_bytes;
        let prev_len = string_bytes.len();
        // Zero-extend rather than `set_len` over uninit: `as_slice()` callers
        // (lockfile.rs:2624/2644/2649/2668, dependency.rs:327, CatalogMap.rs:173)
        // read the full slice including the not-yet-appended tail. Matches the
        // `grow_default` precedent at :1578.
        string_bytes.resize(prev_len + self.cap, 0);
        self.off = prev_len;
        self.ptr = Some(unsafe { string_bytes.as_mut_ptr().add(prev_len) });
        self.len = 0;
        Ok(())
    }

    #[inline]
    pub fn append<T: StringBuilderType>(&mut self, slice: &[u8]) -> T {
        self.append_with_hash::<T>(slice, SemverStringBuilder::string_hash(slice))
    }

    /// SlicedString is not supported due to inline strings.
    pub fn append_without_pool<T: StringBuilderType>(&mut self, slice: &[u8], hash: u64) -> T {
        if SemverString::can_inline(slice) {
            return T::from_init(self.string_bytes.as_slice(), slice, hash);
        }
        if cfg!(debug_assertions) {
            debug_assert!(self.len <= self.cap); // didn't count everything
            debug_assert!(self.ptr.is_some()); // must call allocate first
        }

        // `allocate()` resized `string_bytes` to `off + cap`; write via safe
        // indexing instead of the cached raw `ptr` + `copy_nonoverlapping`.
        let start = self.off + self.len;
        let end = start + slice.len();
        self.string_bytes[start..end].copy_from_slice(slice);
        let final_slice = &self.string_bytes[start..end];
        self.len += slice.len();

        if cfg!(debug_assertions) {
            debug_assert!(self.len <= self.cap);
        }

        T::from_init(self.string_bytes.as_slice(), final_slice, hash)
    }

    pub fn append_with_hash<T: StringBuilderType>(&mut self, slice: &[u8], hash: u64) -> T {
        if SemverString::can_inline(slice) {
            return T::from_init(self.string_bytes.as_slice(), slice, hash);
        }

        if cfg!(debug_assertions) {
            debug_assert!(self.len <= self.cap); // didn't count everything
            debug_assert!(self.ptr.is_some()); // must call allocate first
        }

        let string_entry = self.string_pool.get_or_put(hash).expect("unreachable");
        if !string_entry.found_existing {
            // See `append_without_pool` — safe indexing into the region
            // `allocate()` already resized.
            let start = self.off + self.len;
            let end = start + slice.len();
            self.string_bytes[start..end].copy_from_slice(slice);
            let final_slice = &self.string_bytes[start..end];
            self.len += slice.len();

            *string_entry.value_ptr = SemverString::init(self.string_bytes.as_slice(), final_slice);
        }

        if cfg!(debug_assertions) {
            debug_assert!(self.len <= self.cap);
        }

        T::from_pooled(*string_entry.value_ptr, hash)
    }
}

// ─── StringBuilder trait wiring ─────────────────────────────────────────────
//
// Several callees (`Version::count`/`append`, `Dependency::count`/`clone`,
// `Bin::count`/`clone`, `Scripts::clone`/`count`) accept the builder via a
// duck-typed trait that mirrors Zig's `comptime StringBuilder: type`. Wire
// `lockfile::StringBuilder` into each so `Package` can pass `&mut builder`
// straight through.

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

// `crate::dependency::StringBuilderLike` impl lives in `dependency.rs` next to
// the trait definition (it needs `string_bytes()` access to the lockfile
// buffers). `bin_real::StringBuilder` is now a re-export of
// `bun_semver::StringBuilder`, so the impl above covers it; `package::scripts`
// takes `&mut StringBuilder<'_>` concretely, so no adapter trait is needed
// there either.

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

    impl Default for Entry {
        /// Zig: `union(PackageIndex.Tag) { id, ids }` zero-initialises to `.id = 0`.
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

/// Spec lockfile.zig: `enum(u32) { v0, v1, v2, v3, _ }` — non-exhaustive. The binary
/// lockfile serializer reads this u32 directly from disk; an exhaustive Rust enum would
/// make deserializing a future v4+ lockfile instant UB (transmute-to-enum with an
/// invalid discriminant). PORTING.md §Forbidden patterns: never transmute disk data
/// into an exhaustive enum. Represent as a transparent u32 with associated consts so
/// unknown values round-trip and can be compared against `current()` for a graceful
/// version-mismatch error.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct FormatVersion(pub u32);

impl FormatVersion {
    pub const V0: Self = Self(0);
    /// bun v0.0.x - bun v0.1.6
    pub const V1: Self = Self(1);
    /// bun v0.1.7+
    /// This change added tarball URLs to npm-resolved packages
    pub const V2: Self = Self(2);
    /// Changed semver major/minor/patch to each use u64 instead of u32
    pub const V3: Self = Self(3);

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
    /// Borrows a `Box<[u8]>` parked in `tree_paths` for the duration of
    /// `Lockfile::eql` — `RawSlice` carries the outlives-holder invariant.
    pub tree_path: bun_ptr::RawSlice<u8>,
}

impl<'a> EqlSorter<'a> {
    pub fn order(&self, l: PathToId, r: PathToId) -> Ordering {
        let l_path = l.tree_path.slice();
        let r_path = r.tree_path.slice();
        // they exist in the same tree, name can't be the same so string compare.
        strings::order(l_path, r_path).then_with(|| {
            let l_name = self.pkg_names[l.pkg_id as usize];
            let r_name = self.pkg_names[r.pkg_id as usize];
            l_name.order(&r_name, self.string_buf, self.string_buf)
        })
    }
}

impl Lockfile {
    /// `cut_off_pkg_id` should be removed when we stop appending packages to lockfile during install step
    pub fn eql(&self, r: &Lockfile, cut_off_pkg_id: usize) -> Result<bool, AllocError> {
        // Zig names the receiver `l`; alias `self` so the body matches the
        // spec verbatim (lockfile.zig:1798).
        let l: &Lockfile = self;
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
        // Zig: `var depth_buf: Tree.DepthBuf = undefined;`
        let mut depth_buf: tree::DepthBuf = tree::depth_buf_uninit();

        // Track owned tree-path allocations so they outlive the sort and are freed at scope end.
        let mut tree_paths: Vec<Box<[u8]>> = Vec::new();

        let mut i: usize = 0;
        for l_tree in l.buffers.trees.iter() {
            let (rel_path, _) = tree::relative_path_and_depth::<{ tree::IteratorPathStyle::PkgPath }>(
                l.buffers.trees.as_slice(),
                l.buffers.dependencies.as_slice(),
                l.buffers.string_bytes.as_slice(),
                l_tree.id,
                &mut path_buf,
                &mut depth_buf,
            );
            let tree_path: Box<[u8]> = Box::<[u8]>::from(rel_path.as_bytes());
            let tree_path_ptr = bun_ptr::RawSlice::new(&tree_path[..]);
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
            let (rel_path, _) = tree::relative_path_and_depth::<{ tree::IteratorPathStyle::PkgPath }>(
                r.buffers.trees.as_slice(),
                r.buffers.dependencies.as_slice(),
                r.buffers.string_bytes.as_slice(),
                r_tree.id,
                &mut path_buf,
                &mut depth_buf,
            );
            let tree_path: Box<[u8]> = Box::<[u8]>::from(rel_path.as_bytes());
            let tree_path_ptr = bun_ptr::RawSlice::new(&tree_path[..]);
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
            l_buf.sort_unstable_by(|a, b| sorter.order(*a, *b));
        }

        {
            let sorter = EqlSorter {
                pkg_names: r_pkg_names,
                string_buf: r_string_buf,
            };
            r_buf.sort_unstable_by(|a, b| sorter.order(*a, *b));
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
        // TODO(port): narrow error set
        let previous_meta_hash = self.meta_hash;
        self.meta_hash = self.generate_meta_hash(print_name_version_string, packages_len)?;
        Ok(!strings::eql_long(
            &previous_meta_hash,
            &self.meta_hash,
            false,
        ))
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
        let mut alphabetized_names: Vec<PackageID> = vec![0; packages_len.saturating_sub(1)];

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
                        resolutions[i + j].fmt(bytes, PathSep::Posix)
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
                    resolutions[i].fmt(bytes, PathSep::Posix)
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
            let alphabetizer = package::Alphabetizer::<u64> {
                names: names.into(),
                buf: bytes.into(),
                resolutions: resolutions.into(),
            };
            alphabetized_names.sort_unstable_by(|a, b| alphabetizer.order(*a, *b));
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
            Output::writer()
                .write_all(alphabetized_name_version_string)
                .expect("unreachable");
            Output::enable_buffering();
        }

        let mut digest = ZERO_HASH;
        Crypto::SHA512_256::hash(
            alphabetized_name_version_string,
            &mut digest,
            core::ptr::null_mut(),
        );

        Ok(digest)
    }

    pub fn resolve_package_from_name_and_version(
        &self,
        package_name: &[u8],
        version: DependencyVersion,
    ) -> Option<PackageID> {
        let name_hash = SemverStringBuilder::string_hash(package_name);
        let entry = self.package_index.get(&name_hash)?;
        let buf = self.buffers.string_bytes.as_slice();

        match version.tag {
            dependency::Tag::Npm => {
                // SAFETY: tag checked == .npm above; `npm` is the active
                // `dependency::Value` union field. Same for `Resolution.value`
                // below — Zig reads `.npm` unconditionally on this path.
                let npm_group = &version.npm().version;
                match entry {
                    PackageIndexEntry::Id(id) => {
                        let resolutions = self.packages.items_resolution();

                        if cfg!(debug_assertions) {
                            debug_assert!((*id as usize) < resolutions.len());
                        }
                        let res_ver = resolutions[*id as usize].npm().version;
                        if npm_group.satisfies(res_ver, buf, buf) {
                            return Some(*id);
                        }
                    }
                    PackageIndexEntry::Ids(ids) => {
                        let resolutions = self.packages.items_resolution();

                        for &id in ids.iter() {
                            if cfg!(debug_assertions) {
                                debug_assert!((id as usize) < resolutions.len());
                            }
                            let res_ver = resolutions[id as usize].npm().version;
                            if npm_group.satisfies(res_ver, buf, buf) {
                                return Some(id);
                            }
                        }
                    }
                }
            }
            _ => {}
        }

        None
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Default trusted dependencies
// ────────────────────────────────────────────────────────────────────────────

const MAX_DEFAULT_TRUSTED_DEPENDENCIES: usize = 512;

/// Sorted list of default trusted dependency names.
///
/// Zig builds this at comptime from `default-trusted-dependencies.txt` via
/// `@embedFile` + tokenize + sort. Rust cannot tokenize/sort at const time, so
/// we embed the file with `include_str!` and build the sorted slice on first
/// access. Kept alphabetical so `bun pm trusted --default` need not re-sort.
pub static DEFAULT_TRUSTED_DEPENDENCIES_LIST: std::sync::LazyLock<Vec<&'static [u8]>> =
    std::sync::LazyLock::new(|| {
        // Zig: @embedFile("./default-trusted-dependencies.txt")
        const DATA: &str = include_str!("default-trusted-dependencies.txt");
        // Zig: std.mem.tokenizeAny(u8, data, " \r\n\t")
        let mut names: Vec<&'static [u8]> = DATA
            .split([' ', '\r', '\n', '\t'])
            .filter(|s| !s.is_empty())
            .map(str::as_bytes)
            .collect();
        // Zig: std.sort.pdq with std.mem.order(u8, ..) == .lt
        names.sort_unstable();
        debug_assert!(
            names.len() <= MAX_DEFAULT_TRUSTED_DEPENDENCIES,
            "default-trusted-dependencies.txt is too large, please increase \
             'MAX_DEFAULT_TRUSTED_DEPENDENCIES' in lockfile.rs"
        );
        names
    });

/// The default list of trusted dependencies is a static hashmap.
///
/// Zig builds a comptime `StaticHashMap` keyed by truncated-u32 string-hash.
/// Rust populates the same `StaticHashMap` lazily on first access from the
/// build.rs-generated list. The hash is `String.Builder.stringHash(s) as u32`
/// so entries match `Lockfile.trusted_dependencies` keys.
pub mod default_trusted_dependencies {
    use super::{
        DEFAULT_TRUSTED_DEPENDENCIES_LIST, MAX_DEFAULT_TRUSTED_DEPENDENCIES, SemverStringBuilder,
    };
    use bun_collections::static_hash_map::{
        Entry, HashContext, HashMapMixin, StaticHashMap, static_slots,
    };
    use std::sync::LazyLock;

    const SLOTS: usize = static_slots(MAX_DEFAULT_TRUSTED_DEPENDENCIES);

    pub struct TrustedDepHashCtx;
    impl HashContext<&'static [u8]> for TrustedDepHashCtx {
        #[inline]
        fn ctx_hash(s: &&'static [u8]) -> u64 {
            // truncate to u32 because Lockfile.trustedDependencies uses the same u32 string hash
            (SemverStringBuilder::string_hash(s) as u32) as u64
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

    /// Iterate populated entries (Zig: `default_trusted_dependencies.entries`).
    pub fn entries() -> impl Iterator<Item = &'static Entry<&'static [u8], ()>> {
        MAP.entries.iter().filter(|e| !e.is_empty())
    }

    /// Zig: `default_trusted_dependencies.hasWithHash`.
    #[inline]
    pub fn has_with_hash(hash: u64) -> bool {
        MAP.has_with_hash(hash)
    }

    /// Zig: `default_trusted_dependencies.has(name)`.
    ///
    /// Open-coded `hasContext` so the lookup key can borrow with any lifetime,
    /// not just `'static`.
    pub fn has(name: &[u8]) -> bool {
        let hash = (SemverStringBuilder::string_hash(name) as u32) as u64;
        for entry in &MAP.entries[(hash >> MAP.shift) as usize..] {
            if entry.hash >= hash {
                return entry.hash == hash && entry.key == name;
            }
        }
        unreachable!()
    }
}

impl Lockfile {
    pub fn has_trusted_dependency(&self, name: &[u8], resolution: &Resolution) -> bool {
        if let Some(trusted_dependencies) = &self.trusted_dependencies {
            let hash = SemverStringBuilder::string_hash(name) as u32;
            return trusted_dependencies.contains(&hash);
        }

        // Only allow default trusted dependencies for npm packages
        resolution.tag == ResolutionTag::Npm && default_trusted_dependencies::has(name)
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
    /// Construct with just `path` set (Zig: `.{ .path = path }`). Exists because
    /// the explicit-padding / private-hash fields make the `..Default::default()`
    /// struct-update form unusable from sibling modules.
    pub fn with_path(path: SemverString) -> Self {
        let mut this = Self::default();
        this.path = path;
        this
    }

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

// ported from: src/install/lockfile.zig
