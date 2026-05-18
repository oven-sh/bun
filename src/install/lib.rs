#![allow(
    unused,
    nonstandard_style,
    ambiguous_glob_reexports,
    incomplete_features
)]
#![warn(unused_must_use)]
#![feature(adt_const_params)]

// ──────────────────────────────────────────────────────────────────────────
// Crate aliases — Phase-A drafts use the porting-doc crate names; map them
// to the real workspace crates here so module bodies stay diff-minimal.
// ──────────────────────────────────────────────────────────────────────────
// Self-alias so Phase-A drafts written against `bun_install::…` resolve
// without rewriting every `use` (e.g. yarn.rs, extract_tarball.rs,
// lifecycle_script_runner.rs).
use bun_collections::VecExt;
extern crate bun_core as bun_str;
extern crate bun_sha_hmac as bun_sha;
extern crate self as bun_install;
// `bun_output::declare_scope!` / `scoped_log!` in Phase-A drafts → the macros
// live at `bun_core` crate root (#[macro_export]); alias the crate so the
// `bun_output::` path resolves in un-gated install modules.
extern crate bun_analytics as analytics;
extern crate bun_core as bun_output;
// `bun_simdutf` → real crate is `bun_simdutf_sys`.
extern crate bun_simdutf_sys as bun_simdutf;

/// `bun_schema::api` → schema lives in `bun_options_types::schema::api`.
pub(crate) mod bun_schema {
    pub use bun_options_types::schema::api;
}

/// `bun_json` → JSON parser lives in `bun_parsers::json`; AST nodes
/// (`Expr`, `ExprData`, `E*` variants) live in `bun_ast::js_ast`.
pub(crate) mod bun_json {
    pub use bun_ast::{Expr, ExprData, G::Property, e as E, expr::Query};
    pub use bun_parsers::json::*;
}

/// `bun.fs` namespace — resolver-tier `FileSystem` / `DirEntry` / `Entry`.
/// `bun_install` depends on `bun_resolver` directly (no cycle), so re-export
/// the real types instead of routing through any lower-tier shim.
pub(crate) mod bun_fs {
    pub use bun_resolver::fs::*;
}

/// `bun_progress` → re-export of the real `bun_core::Progress` (snapshot of
/// pre-0.13 `std.Progress`). The earlier value-type counter shim was dropped
/// once `ProgressStrings.rs`, `hoisted_install.rs`, `runTasks.rs` etc. started
/// touching the full surface (`supports_ansi_escape_codes`, public `root`,
/// `unprotected_*` atomics, `&mut Node` from `start()`); keeping a parallel
/// type here just bifurcated `Node` identity across the crate.
pub(crate) mod bun_progress {
    pub use bun_core::Progress::{Node, Progress};
}

/// `bun_bunfig` → config-loading entrypoint. The real `bun_bunfig` crate now
/// hosts `Arguments::loadConfig` (MOVE_DOWN b0); this local shim only adds the
/// legacy `Arguments` alias (= `bun_options_types::context`) that
/// `hoisted_install` / `isolated_install` import for `Transpiler::init`
/// plumbing. Kept as a local module so those callers don't need updating; the
/// crate-root `bun_bunfig` name shadows the extern crate, so callers needing
/// the real crate spell it `::bun_bunfig`.
pub(crate) mod bun_bunfig {
    pub use ::bun_bunfig::*;
    pub use bun_options_types::context as Arguments;
}

use core::cell::Cell;
use core::fmt;

// ──────────────────────────────────────────────────────────────────────────
// Module declarations — Zig basenames preserved per PORTING.md, hence
// explicit #[path] attrs for PascalCase files.
// ──────────────────────────────────────────────────────────────────────────

pub mod npm;
#[path = "PackageManifestMap.rs"]
pub mod package_manifest_map;
pub mod resolution;
// Legacy alias kept while callers migrate from the stub/real split.
pub use resolution as resolution_real;
pub mod auto_installer;
#[path = "ConfigVersion.rs"]
pub mod config_version;
pub mod dependency;
#[path = "ExternalSlice.rs"]
pub mod external_slice;
pub mod hosted_git_info;
pub mod integrity;
pub mod padding_checker;
pub mod postinstall_optimizer;
pub mod versioned_url;

pub mod extract_tarball;
#[path = "lockfile.rs"]
pub mod lockfile_real;
#[path = "NetworkTask.rs"]
pub mod network_task;
#[path = "PackageManager.rs"]
pub mod package_manager_real;
#[path = "PackageManagerTask.rs"]
pub mod package_manager_task;
#[path = "TarballStream.rs"]
pub mod tarball_stream;
pub use lockfile_real::{DEFAULT_TRUSTED_DEPENDENCIES_LIST, default_trusted_dependencies};
#[path = "bin.rs"]
pub mod bin_real;
pub mod hoisted_install;
pub mod isolated_install;
pub mod lifecycle_script_runner;
pub mod migration;
#[path = "PackageInstall.rs"]
pub mod package_install;
#[path = "PackageInstaller.rs"]
pub mod package_installer;
pub mod patch_install;
pub mod pnpm;
#[path = "repository.rs"]
pub mod repository_real;
pub mod yarn;

/// `repository` — re-export of the file-backed `repository_real` module
/// (src/install/repository.rs). The earlier inline stub duplicated the
/// `Repository` struct and stubbed `download`/`checkout`/`try_https` with
/// `Err("RepositoryNotPorted")` / a partial rewrite table; the real module
/// lives in the same crate with no dep cycle, so re-export it directly.
pub use repository_real as repository;

/// `bin` — re-export of the file-backed `bin_real` module (src/install/bin.rs).
pub use bin_real as bin;

/// `lockfile` — re-export of the file-backed `lockfile_real` module
/// (src/install/lockfile.rs). The earlier inline stub defined a parallel
/// `Lockfile` struct with column-vec `PackageList` and ~25 no-op/stub methods
/// (`load_from_dir` returning unpopulated `Ok`, `save_to_disk` building a
/// buffer and never writing it, `generate_meta_hash` returning `[0;32]`,
/// `filter` clearing trees without rebuilding, `get_package_id` ignoring the
/// resolution, …). Stub and real are in the same crate; unify on the real
/// type so every caller — `PackageManager`, `migration`, `pnpm`/`yarn`,
/// `PackageInstaller`, `isolated_install` — agrees on a single `Lockfile`.
pub mod lockfile {
    pub use crate::lockfile_real::*;
    // Back-compat aliases for names the inline stub spelled differently.
    pub use crate::Origin;
    pub use crate::lockfile_real::LockfileFormat as Format;
    pub use crate::lockfile_real::Serializer::SerializerLoadResult;
    pub use crate::lockfile_real::package_index::Entry as PackageIndexEntry;
    /// Zig callers spell `.root` (a `Resolution.Tag` literal) when invoking
    /// `Scripts.createList` for the root package; alias the tag enum here so
    /// `lockfile::ScriptsListKind::Root` resolves.
    pub use crate::resolution::Tag as ScriptsListKind;
    /// `MultiArrayList<Package>.append` row type — the real `PackageList`
    /// (`package::List<u64>`) takes a `Package` value, so alias the row type
    /// for callers (e.g. `migration.rs`) that spell it `PackageListEntry`.
    pub type PackageListEntry = crate::lockfile_real::Package;
    pub mod package {
        pub use crate::lockfile_real::package::meta::{HasInstallScript, Meta};
        pub use crate::lockfile_real::package::*;
        pub mod scripts {
            pub use crate::lockfile_real::package::scripts::*;
        }
    }
    pub use package::{HasInstallScript, Meta};
    pub mod tree {
        pub use crate::lockfile_real::tree::IteratorPathStyle as PathStyle;
        pub use crate::lockfile_real::tree::*;
    }
}

/// `UpdateRequest` — mounted directly (sibling of `package_manager_real`) so
/// `bunx_command` / `outdated_command` can name `bun_install::update_request`.
pub use package_manager_real::update_request;
pub use update_request::UpdateRequest;

/// `package_manager` — re-export of the file-backed `package_manager_real`
/// module (src/install/PackageManager.rs). The earlier inline stub defined a
/// parallel `PackageManager` struct with ~1600 lines of no-op/partial method
/// bodies; both live in the same crate, so unify by re-exporting and add the
/// few accessor types the inline module owned outright.
pub mod package_manager {
    pub use crate::package_manager_real::package_manager_options::LogLevel;
    pub use crate::package_manager_real::*;
    pub use crate::update_request;

    /// `PackageManager.Options` namespace alias — `LogLevel` plus the
    /// free-function helpers callers spell as `Options::open_global_dir`.
    #[allow(non_snake_case)]
    pub mod Options {
        pub use crate::package_manager_real::package_manager_options::*;
        // `open_global_dir` lives in PackageManagerOptions.rs (`options::`
        // namespace in Zig); re-export so `Options::open_global_dir` resolves.
        pub use crate::package_manager_real::package_manager_options::open_global_dir;
    }

    /// Re-export the file-backed workspace package.json cache.
    pub use crate::package_manager_real::workspace_package_json_cache;
    pub use workspace_package_json_cache::{
        GetJSONOptions as GetJsonOptions, GetResult as GetJsonResult,
        MapEntry as WorkspacePackageJsonCacheEntry, WorkspacePackageJSONCache,
    };

    /// `populateManifestCache` `Packages` union
    /// (src/install/PackageManager/PopulateManifestCache.zig).
    pub enum ManifestCacheOptions<'a> {
        Ids(&'a [crate::PackageID]),
        Names(&'a [&'a [u8]]),
    }
    /// Alias used by `outdated_command.rs`.
    pub type ManifestCacheRequest<'a> = ManifestCacheOptions<'a>;

    /// `PackageManifestMap.load` `When` enum — re-export the real enum so
    /// callers naming either path agree on one type.
    pub use crate::package_manifest_map::CacheBehavior as ManifestLoad;

    /// `CommandLineArguments.AuditLevel` (subset surfaced for
    /// `bun_runtime::cli::audit_command`). Re-exported alongside the full
    /// `command_line_arguments` module from `package_manager_real`.
    pub mod audit {
        pub use crate::package_manager_real::command_line_arguments::AuditLevel;
    }

    /// Re-export the file-backed security-scanner module so callers naming
    /// `bun_install::package_manager::security_scanner` reach the real
    /// `perform_security_scan_for_all` / `print_security_advisories` /
    /// `SecurityScanResults` / `SecurityAdvisory`.
    pub use crate::package_manager_real::security_scanner;
}

/// `crate::install::…` shim — Phase-A drafts (bin.rs, repository.rs,
/// migration.rs, resolvers/folder_resolver.rs) were written against a
/// `bun_install::install` submodule path mirroring `install.zig`. The crate
/// root *is* that file now, so re-export everything under both names.
pub(crate) mod install {
    pub use crate::*;
}

/// `windows-shim/BinLinkingShim.zig` — `.bunx` shim encoder consumed by
/// `bin::Linker` (Windows only at runtime, but the encoder types are
/// referenced unconditionally so the module must exist on all targets).
// PORT NOTE: `#[path]` inside an inline `mod {}` resolves relative to the
// synthetic `windows_shim/` directory, which doesn't exist on disk. Hoist the
// file-backed module to crate level with an absolute-ish path and re-export
// through the inline mod so `windows_shim::bin_linking_shim` keeps resolving.
#[path = "windows-shim/BinLinkingShim.rs"]
pub mod _bin_linking_shim;
// `bun_shim_impl` is a *freestanding Windows PE* (no CRT, raw NT syscalls) —
// in Zig it is a separate `exe` artifact whose output is `@embedFile`d above.
// Unlike Zig the Rust port also compiles as a library `mod` (Windows-only) so
// `run_command.rs` can call `try_startup_from_bun_js` / `FromBunRunContext`
// directly — the standalone PE entrypoint is gated behind
// `feature = "shim_standalone"` inside the file, and there is no
// `#[global_allocator]` in the library configuration.
#[cfg(windows)]
#[path = "windows-shim/bun_shim_impl.rs"]
pub mod _bun_shim_impl;
pub mod windows_shim {
    pub use crate::_bin_linking_shim as bin_linking_shim;
    #[cfg(windows)]
    pub use crate::_bun_shim_impl as bun_shim_impl;
    pub use bin_linking_shim::{
        BinLinkingShim, Decoded, EMBEDDED_EXECUTABLE_DATA, Flags, Shebang,
        embedded_executable_data, loose_decode,
    };
}

#[path = "resolvers/folder_resolver.rs"]
pub mod _folder_resolver;
pub mod resolvers {
    pub mod folder_resolver {
        pub use crate::_folder_resolver::*;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Re-exports — every type that previously had an inline ZST/stub shadow now
// re-exports the real definition from its file-backed sibling module.
// ──────────────────────────────────────────────────────────────────────────

pub use npm as Npm;
pub use resolution::Resolution;
// D024: PnpmMatcher canonical lives in `bun_install_types::NodeLinker`; the
// local PnpmMatcher.rs duplicate (4-arg `from_expr`, dead) was deleted.
pub use bun_install_types::NodeLinker::PnpmMatcher;

pub use bun_collections::identity_context::ArrayIdentityContext;
pub use bun_collections::identity_context::IdentityContext;

pub use external::ExternalPackageNameHashList;
pub use external::ExternalSlice;
pub use external::ExternalStringList;
pub use external::ExternalStringMap;
pub use external::VersionSlice;
pub use external_slice as external;

pub use dependency::Behavior;
pub use dependency::{Dependency, DependencyExt, TagExt, ValueExt, VersionExt};
pub use integrity::Integrity;

pub use bin::Bin;
pub use lockfile_real::bun_lock as TextLockfile;
pub use patch_install as patch;

pub use dependency::Tag as DependencyVersionTag;
pub use extract_tarball::ExtractTarball;
pub use lockfile::{LoadResult, LoadStep, Lockfile, PatchedDep};
pub use package_manager::Options::LogLevel;
pub use package_manager::{
    GetJsonOptions, GetJsonResult, ManifestCacheOptions, ManifestCacheRequest, ManifestLoad,
    WorkspaceFilter, WorkspacePackageJsonCacheEntry,
};
pub use repository::{Repository, RepositoryExt};
pub use resolution::Tag as ResolutionTag;

// Real types — previously shadowed by inline ZST stubs in this file.
pub use _folder_resolver::FolderResolution;
pub use lifecycle_script_runner::LifecycleScriptSubprocess;
pub use network_task::NetworkTask;
pub use package_install::PackageInstall;
pub use package_manager_task::Task;
pub use package_manifest_map::PackageManifestMap;
pub use postinstall_optimizer::PostinstallOptimizer;
pub use tarball_stream::TarballStream;
// `FileCopier` was hoisted out of `PackageInstall.rs` into
// `isolated_install/FileCopier.rs` (shared by both linkers); re-export from
// the new home so `bun_install::FileCopier` keeps resolving.
pub use isolated_install::FileCopier;
pub use isolated_install::Store;
pub use package_manager_real::security_scanner::SecurityScanSubprocess;
pub use patch_install::PatchTask;

// PackageManager + its associated types — re-exported from the file-backed
// `package_manager_real` so `crate::PackageManager` and
// `package_manager_real::PackageManager` are the SAME type.
pub use package_manager_real::package_manager_directories::CacheDirAndSubpath;
pub use package_manager_real::{
    AsyncNetworkTaskQueue, CommandLineArguments, PackageManager, PatchTaskQueue, RootPackageId,
    Subcommand,
};

// ──────────────────────────────────────────────────────────────────────────
// Back-compat type aliases — `*Stub` names that other files still reference
// during the port now resolve to the real types. Once every call site is
// migrated these aliases drop.
// ──────────────────────────────────────────────────────────────────────────
pub type PackageManagerOptionsStub = package_manager_real::Options;
pub type PackageManagerDoStub = package_manager_real::package_manager_options::Do;
pub type PackageManagerEnableStub = package_manager_real::package_manager_options::Enable;
pub type PublishConfigStub = package_manager_real::package_manager_options::PublishConfig;
pub type AsyncNetworkTaskQueueStub = package_manager_real::AsyncNetworkTaskQueue;
pub type PreallocatedResolveTasksStub =
    bun_collections::HiveArrayFallback<package_manager_task::Task<'static>, 64>;
pub use package_manager_real::package_manager_options::{Access, AuthType};

/// Port of the anonymous `comptime callbacks: anytype` struct passed to
/// `PackageManager.runTasks` (src/install/PackageManager/runTasks.zig). Zig
/// duck-types `@TypeOf(callbacks.onExtract) != void` etc.; the Rust shape is
/// generic over each slot so call sites can pass `()` for unused hooks and a
/// fn item for active ones. The trait-based dispatch lives in
/// `package_manager_real::run_tasks::RunTasksCallbacks`; this value-level
/// struct is only the call-site spelling.
pub struct RunTasksCallbacks<E = (), R = (), M = (), D = ()> {
    pub on_extract: E,
    pub on_resolve: R,
    pub on_package_manifest_error: M,
    pub on_package_download_error: D,
    /// Zig: `comptime callbacks.progress_bar` (defaults absent → false).
    pub progress_bar: bool,
    /// Zig: `comptime callbacks.manifests_only` (defaults absent → false).
    pub manifests_only: bool,
}
impl<E: Default, R: Default, M: Default, D: Default> Default for RunTasksCallbacks<E, R, M, D> {
    fn default() -> Self {
        Self {
            on_extract: E::default(),
            on_resolve: R::default(),
            on_package_manifest_error: M::default(),
            on_package_download_error: D::default(),
            progress_bar: false,
            manifests_only: false,
        }
    }
}

/// MOVE_DOWN: `bun_resolver::package_json::PackageJSON` — the resolver crate
/// depends on `bun_install` (for `Dependency`), so re-importing `PackageJSON`
/// from there would create a cycle. Mounted here with the install-side field
/// surface (`name`/`version`/`dependencies`/`arch`/`os`) so
/// `lockfile::Package::from_package_json` can type-check; the resolver-only
/// fields (`browser_map`, `exports`, …) stay in `bun_resolver` until the type
/// is split into install-layer / resolver-layer halves.
#[derive(Default)]
pub struct PackageJSON {
    pub name: Box<[u8]>,
    pub version: Box<[u8]>,
    pub arch: npm::Architecture,
    pub os: npm::OperatingSystem,
    pub package_manager_package_id: PackageID,
    pub dependencies: PackageJSONDependencyMap,
}

/// Port of `bun.PackageJSON.DependencyMap` (src/resolver/package_json.zig).
#[derive(Default)]
pub struct PackageJSONDependencyMap {
    pub map: bun_collections::ArrayHashMap<bun_semver::String, Dependency>,
    // TODO(port): lifetime — borrows the package.json source contents
    pub source_buf: &'static [u8],
}

/// `crate::ci_info` — install-tier shim for `bun_runtime::cli::ci_info`
/// (`src/runtime/cli/ci_info.rs`). Only `detect_ci_name` is exposed; the
/// CI-probe table itself is generated at build time in `bun_runtime` and is
/// not reachable from this tier, so the shim returns the `CI` env var name
/// when set (the same fallback `npm-registry-fetch` uses) and `None` otherwise.
pub mod ci_info {
    pub fn detect_ci_name() -> Option<&'static [u8]> {
        // Port of the trailing fallback in `ci_info.zig:detectCiName` —
        // the per-vendor probes live in `bun_runtime` (T6) and are wired in
        // there; install only needs *some* answer for the user-agent string.
        if std::env::var_os("CI").is_some() {
            return Some(b"ci");
        }
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Only the `Shell` enum (variant detection) is consumed here — the embedded
// completion script bodies stay in bun_cli (they pull in @embedFile assets).
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_snake_case)]
pub mod ShellCompletions {
    #[repr(u8)]
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub enum Shell {
        #[default]
        Unknown,
        Bash,
        Zsh,
        Fish,
        Pwsh,
    }

    impl Shell {
        /// Port of `Shell.fromEnv` (src/cli/shell_completions.zig). The Zig version was
        /// generic over the string type purely so it could accept both `[]const u8` and
        /// `[:0]const u8`; in Rust both coerce to `&[u8]`.
        pub fn from_env(shell: &[u8]) -> Shell {
            use bun_core::strings;
            let basename = bun_paths::basename(shell);
            if strings::eql_comptime(basename, b"bash") {
                Shell::Bash
            } else if strings::eql_comptime(basename, b"zsh") {
                Shell::Zsh
            } else if strings::eql_comptime(basename, b"fish") {
                Shell::Fish
            } else if strings::eql_comptime(basename, b"pwsh")
                || strings::eql_comptime(basename, b"powershell")
            {
                Shell::Pwsh
            } else {
                Shell::Unknown
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Only the helpers the package manager needs: shell discovery, fake `node`
// shim creation, and env bootstrap for lifecycle scripts. The interactive
// `bun run` entrypoint stays in bun_cli.
// ──────────────────────────────────────────────────────────────────────────
pub struct RunCommand;

/// Canonical `PRETEND_TO_BE_NODE` flag (port of `Cli.pretend_to_be_node`,
/// src/cli.zig). Set once during single-threaded startup by `Command::which()`
/// in `bun_runtime::cli` when argv[0] basename == "node"; read by both the
/// runtime CLI and the install-tier `RunCommand` helpers below. Lives in
/// `bun_install` (not `bun_runtime`) so both crates can address the SAME
/// static without a dep-cycle — `bun_runtime::cli` re-exports it.
pub static PRETEND_TO_BE_NODE: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

use bun_core::ZStr;

impl RunCommand {
    const SHELLS_TO_SEARCH: &'static [&'static [u8]] = &[b"bash", b"sh", b"zsh"];

    /// `/tmp/bun-node-<sha>` (or debug variant). Windows builds compute the path
    /// at runtime via GetTempPathW, so this constant is POSIX-only.
    ///
    /// NOTE: the SHA alone does not uniquely identify a binary — two local
    /// builds at the same commit share this dir. `create_fake_temporary_node_executable`
    /// therefore re-points a stale link on EEXIST instead of trusting it.
    #[cfg(not(windows))]
    pub const BUN_NODE_DIR: &'static str = {
        // PORT NOTE: Zig used comptime `++`; `const_format::concatcp!` cannot host
        // `if` expressions inline, so split into helper consts.
        use const_format::concatcp;
        const TMP: &str = if cfg!(target_os = "macos") {
            "/private/tmp"
        } else if cfg!(target_os = "android") {
            "/data/local/tmp"
        } else {
            "/tmp"
        };
        const SUFFIX: &str = if cfg!(debug_assertions) {
            "/bun-node-debug"
        } else if bun_core::env::GIT_SHA_SHORT.is_empty() {
            "/bun-node"
        } else {
            concatcp!("/bun-node-", bun_core::env::GIT_SHA_SHORT)
        };
        concatcp!(TMP, SUFFIX)
    };

    fn find_shell_impl<'a>(
        buf: &'a mut bun_paths::PathBuffer,
        path: &[u8],
        cwd: &[u8],
    ) -> Option<&'a ZStr> {
        #[cfg(windows)]
        {
            let _ = (buf, path, cwd);
            return Some(bun_core::zstr!("C:\\Windows\\System32\\cmd.exe"));
        }

        #[cfg(not(windows))]
        {
            for shell in Self::SHELLS_TO_SEARCH {
                if let Some(found) = bun_which::which(buf, path, cwd, shell) {
                    // `which()` writes a NUL-terminated path into `buf` and
                    // returns a borrow of it; reborrow as `&ZStr`.
                    let len = found.len();
                    return Some(ZStr::from_buf(buf, len));
                }
            }

            const HARDCODED_POPULAR_ONES: &[&ZStr] = &[
                bun_core::zstr!("/bin/bash"),
                bun_core::zstr!("/usr/bin/bash"),
                bun_core::zstr!("/usr/local/bin/bash"), // don't think this is a real one
                bun_core::zstr!("/bin/sh"),
                bun_core::zstr!("/usr/bin/sh"), // don't think this is a real one
                bun_core::zstr!("/usr/bin/zsh"),
                bun_core::zstr!("/usr/local/bin/zsh"),
                bun_core::zstr!("/system/bin/sh"), // Android
            ];
            for &shell in HARDCODED_POPULAR_ONES {
                if bun_sys::is_executable_file_path(shell) {
                    let body = shell.as_bytes();
                    buf[..body.len()].copy_from_slice(body);
                    buf[body.len()] = 0;
                    return Some(ZStr::from_buf(buf, body.len()));
                }
            }

            None
        }
    }

    /// Find the "best" shell to use. Cached to only run once.
    /// Returns a slice into a process-lifetime static buffer (includes trailing NUL).
    pub fn find_shell(path: &[u8], cwd: &[u8]) -> Option<&'static [u8]> {
        // PORTING.md §Concurrency: `bun.once` + static buf → OnceLock. Store the
        // result bytes (including NUL) directly in the OnceLock so the borrow is
        // trivially `'static` — avoids the Mutex+data_ptr dance from the draft.
        static ONCE: std::sync::OnceLock<Option<Vec<u8>>> = std::sync::OnceLock::new();

        ONCE.get_or_init(|| {
            let mut scratch = bun_paths::PathBuffer::uninit();
            let found = Self::find_shell_impl(&mut scratch, path, cwd)?;
            // Includes trailing NUL so the caller may treat it as `[:0]const u8`.
            Some(found.as_bytes_with_nul().to_vec())
        })
        .as_deref()
    }

    /// Port of `RunCommand.createFakeTemporaryNodeExecutable`
    /// (src/cli/run_command.zig). Symlinks/hardlinks the running bun binary as
    /// `node` + `bun` inside a temp dir and prepends that dir to `path`.
    ///
    /// `#[cold]`: only reached on the `bun run <script>` / lifecycle-script
    /// slow path, never on plain `bun foo.js` startup. Forcing it into
    /// `.text.unlikely.*` keeps it out of the hot fault-around windows that
    /// the startup/dot benches page in (belt-and-suspenders alongside
    /// `startup.order` regen — survives mangling-hash drift).
    #[cold]
    pub fn create_fake_temporary_node_executable(
        path: &mut Vec<u8>,
        optional_bun_path: &mut &[u8],
    ) -> Result<(), bun_core::Error> {
        // If we are already running as "node", the path should exist
        if PRETEND_TO_BE_NODE.load(core::sync::atomic::Ordering::Relaxed) {
            return Ok(());
        }

        #[cfg(not(windows))]
        {
            use const_format::concatcp;

            let argv0: &ZStr = bun_core::argv().get(0).unwrap_or(bun_core::zstr!("bun"));

            // if we are already an absolute path, use that
            // if the user started the application via a shebang, it's likely that the path is absolute already
            let argv0_z: &ZStr = if argv0.as_bytes().first() == Some(&b'/') {
                *optional_bun_path = argv0.as_bytes();
                argv0
            } else if optional_bun_path.is_empty() {
                // otherwise, ask the OS for the absolute path
                // Zig: `try bun.selfExePath()` — propagate the error.
                let self_path = bun_core::self_exe_path()?;
                if !self_path.as_bytes().is_empty() {
                    *optional_bun_path = self_path.as_bytes();
                    self_path
                } else {
                    // Zig: trailing `if (optional_bun_path.len == 0) argv0 = bun.argv[0];`
                    argv0
                }
            } else {
                // Zig: `var argv0 = @ptrCast(optional_bun_path.ptr)` — when argv[0] is
                // not absolute and the caller pre-supplied a path, that path is the
                // symlink target (NOT bun.argv[0]).
                // SAFETY: callers pass a slice borrowed from a `ZStr` (argv[0] /
                // self_exe_path / static literal), so `ptr[len] == 0` holds — same
                // precondition Zig's `@ptrCast` relies on.
                unsafe { ZStr::from_raw(optional_bun_path.as_ptr(), optional_bun_path.len()) }
            };

            #[cfg(debug_assertions)]
            {
                // Zig: `std.fs.deleteTreeAbsolute(BUN_NODE_DIR) catch {}` —
                // debug-only cleanup; failures are ignored. The EEXIST branch
                // below already handles a stale dir.
                let _ = bun_sys::delete_tree_absolute(Self::BUN_NODE_DIR.as_bytes());
            }

            const NODE_LINK: &ZStr = {
                const B: &[u8] = concatcp!(RunCommand::BUN_NODE_DIR, "/node\0").as_bytes();
                // SAFETY: literal ends in NUL; len excludes it.
                ZStr::from_static(B)
            };
            const BUN_LINK: &ZStr = {
                const B: &[u8] = concatcp!(RunCommand::BUN_NODE_DIR, "/bun\0").as_bytes();
                // SAFETY: literal ends in NUL; len excludes it.
                ZStr::from_static(B)
            };
            const DIR_Z: &ZStr = {
                const B: &[u8] = concatcp!(RunCommand::BUN_NODE_DIR, "\0").as_bytes();
                // SAFETY: literal ends in NUL; len excludes it.
                ZStr::from_static(B)
            };

            // Don't trust attacker-created entries in a shared temp dir
            // (`BUN_NODE_DIR` lives under e.g. `/tmp`). Create it `0700`; if it
            // already exists, refuse to use it unless it's a directory we own
            // with no group/other write bits.
            match bun_sys::mkdir(DIR_Z, 0o700) {
                Ok(()) => {}
                Err(e) if e.get_errno() == bun_sys::E::EEXIST => match bun_sys::lstat(DIR_Z) {
                    Ok(st)
                        if bun_sys::kind_from_mode(st.st_mode as bun_sys::Mode)
                            == bun_sys::FileKind::Directory
                            && st.st_uid == bun_sys::c::getuid()
                            && (st.st_mode as bun_sys::Mode) & 0o022 == 0 => {}
                    _ => return Ok(()),
                },
                Err(_) => return Ok(()),
            }

            for dest in [NODE_LINK, BUN_LINK] {
                let mut replaced = false;
                loop {
                    match bun_sys::symlink(argv0_z, dest) {
                        Ok(()) => break,
                        Err(e) if e.get_errno() == bun_sys::E::EEXIST => {
                            // The dir is keyed only on GIT_SHA_SHORT, so two
                            // different binaries built at the same commit (e.g.
                            // side-by-side local builds being benchmarked)
                            // collide here. Blindly reusing the existing link
                            // would make every `--bun` child of the SECOND
                            // binary silently exec the FIRST. Verify the target
                            // before reusing; replace it once if stale.
                            let mut buf = bun_paths::PathBuffer::uninit();
                            let matches = bun_sys::readlink(dest, &mut buf)
                                .map(|n| &buf[..n] == argv0_z.as_bytes())
                                .unwrap_or(false);
                            if matches || replaced {
                                break;
                            }
                            let _ = bun_sys::unlink(dest);
                            replaced = true;
                        }
                        Err(_) => return Ok(()),
                    }
                }
            }

            if !path.is_empty() && *path.last().unwrap() != bun_paths::DELIMITER {
                path.push(bun_paths::DELIMITER);
            }

            // The reason for the extra delim is because we are going to append the system PATH
            // later on. this is done by the caller, and explains why we are adding bun_node_dir
            // to the end of the path slice rather than the start.
            path.extend_from_slice(Self::BUN_NODE_DIR.as_bytes());
            path.push(bun_paths::DELIMITER);
            Ok(())
        }

        #[cfg(windows)]
        {
            use bun_core::strings;
            use bun_sys::windows as win;

            let mut target_path_buffer = bun_paths::WPathBuffer::default();
            let prefix: &[u16] = strings::w!("\\??\\");

            // SAFETY: GetTempPathW writes at most `nBufferLength` WCHARs (incl.
            // trailing NUL) into the offset slice; we reserve `prefix.len()` at
            // the front for the NT object prefix.
            let len = unsafe {
                win::GetTempPathW(
                    (target_path_buffer.len() - prefix.len()) as u32,
                    target_path_buffer.as_mut_ptr().add(prefix.len()),
                )
            } as usize;
            if len == 0 {
                // Zig: `Output.debug(...)` — non-fatal; fall through and leave
                // PATH unmodified. (No `RUN` scope is declared in this crate.)
                return Ok(());
            }

            target_path_buffer[..prefix.len()].copy_from_slice(prefix);

            // Zig: `comptime bun.strings.w("bun-node-" ++ git_sha_short)` —
            // the dir name is ASCII-only, so widen the const `&str` byte-by-
            // byte into a small stack buffer at runtime (Rust macros require a
            // single string *literal* token, which `concatcp!` doesn't yield).
            let dir_name_str: &str = if cfg!(debug_assertions) {
                "bun-node-debug"
            } else if bun_core::env::GIT_SHA_SHORT.is_empty() {
                "bun-node"
            } else {
                const_format::concatcp!("bun-node-", bun_core::env::GIT_SHA_SHORT)
            };
            let mut dir_name_buf = [0u16; 64];
            for (i, b) in dir_name_str.bytes().enumerate() {
                debug_assert!(b < 0x80, "dir_name is ASCII-only");
                dir_name_buf[i] = b as u16;
            }
            let dir_name: &[u16] = &dir_name_buf[..dir_name_str.len()];
            target_path_buffer[prefix.len() + len..][..dir_name.len()].copy_from_slice(dir_name);
            let dir_slice_len = prefix.len() + len + dir_name.len();

            #[cfg(debug_assertions)]
            {
                // Zig: `std.fs.deleteTreeAbsolute(dir_slice_u8) catch {};
                //       std.fs.makeDirAbsolute(dir_slice_u8) catch @panic("huh?");`
                // Debug builds wipe and recreate the bun-node temp dir so the
                // ALREADY_EXISTS short-circuit below never reuses a stale
                // hardlink at a previous debug binary.
                //
                // PORT NOTE: Zig's `@panic("huh?")` assumes the wipe always
                // leaves the path absent. `bun-run.test.ts` now uses
                // `describe.concurrent`, so multiple debug processes race on
                // this shared dir and `make_dir` can legitimately observe
                // `PathAlreadyExists` after a sibling re-created it. Swallow
                // the error — the `CreateHardLinkW` retry below already
                // re-mkdirs on failure, so a lost race here is harmless.
                let dir_slice_u8 = bun_core::immutable::to_utf8_alloc_with_type(
                    &target_path_buffer[..dir_slice_len],
                );
                let _ = bun_sys::delete_tree_absolute(&dir_slice_u8);
                let _ = bun_sys::Dir::cwd().make_dir(&dir_slice_u8);
            }

            let image_path = win::exe_path_w();
            for name in [strings::w!("\\node.exe\0"), strings::w!("\\bun.exe\0")] {
                target_path_buffer[dir_slice_len..][..name.len()].copy_from_slice(name);
                // PORT NOTE: Zig held a `[]const u16` into `target_path_buffer`
                // across in-place mutation (the dir-NUL/backslash toggle below).
                // Under Stacked Borrows a `*const` derived via `Deref::deref`
                // is invalidated by the intervening `&mut` from `IndexMut`, so
                // re-derive `as_ptr()` at each FFI call site instead of caching.
                if win::CreateHardLinkW(target_path_buffer.as_ptr(), image_path.as_ptr(), None) == 0
                {
                    match win::Win32Error::get() {
                        win::Win32Error::ALREADY_EXISTS => {}
                        _ => {
                            target_path_buffer[dir_slice_len] = 0;
                            // SAFETY: `dir_slice_len` is in-bounds; the byte at
                            // `dir_slice_len` was just set to NUL.
                            let dir_w =
                                bun_core::WStr::from_buf(&target_path_buffer[..], dir_slice_len);
                            let _ = bun_sys::mkdir_w(dir_w);
                            target_path_buffer[dir_slice_len] = b'\\' as u16;

                            if win::CreateHardLinkW(
                                target_path_buffer.as_ptr(),
                                image_path.as_ptr(),
                                None,
                            ) == 0
                            {
                                return Ok(());
                            }
                        }
                    }
                }
            }

            if !path.is_empty() && *path.last().unwrap() != bun_paths::DELIMITER {
                path.push(bun_paths::DELIMITER);
            }

            // The reason for the extra delim is because we are going to append the system PATH
            // later on. this is done by the caller, and explains why we are adding bun_node_dir
            // to the end of the path slice rather than the start.
            strings::to_utf8_append_to_list(path, &target_path_buffer[prefix.len()..dir_slice_len]);
            path.push(bun_paths::DELIMITER);
            let _ = optional_bun_path;
            Ok(())
        }
    }
}

/// Process-lifetime arena for the install-tier `Transpiler` constructed in
/// `RunCommand::configure_env_for_run`. Mirrors `runner_arena()` in
/// `runtime/cli/run_command.rs` — `bun_alloc::Arena` is `!Sync`, so guard a
/// a raw `MaybeUninit` global with `Once` (PORTING.md §Forbidden bars
/// `Box::leak`).
fn install_runner_arena() -> &'static bun_alloc::Arena {
    static ONCE: std::sync::Once = std::sync::Once::new();
    // PORTING.md §Global mutable state: `Once`-guarded init; RacyCell because
    // `Bump` is `!Sync` so `OnceLock<Arena>` can't be used.
    static ARENA: bun_core::RacyCell<::core::mem::MaybeUninit<bun_alloc::Arena>> =
        bun_core::RacyCell::new(::core::mem::MaybeUninit::uninit());
    ONCE.call_once(|| {
        // SAFETY: one-time init under `Once`; no concurrent writer.
        unsafe { (*ARENA.get()).write(bun_alloc::Arena::new()) };
    });
    // SAFETY: initialized exactly once above. `configure_env_for_run` is only
    // ever called from the single CLI dispatch thread, so the `!Sync` Bump is
    // never observed concurrently.
    unsafe { (*ARENA.get()).assume_init_ref() }
}

impl RunCommand {
    /// Port of `RunCommand.configureEnvForRun` (src/cli/run_command.zig:780).
    ///
    /// DEP-CYCLE NOTE: the full Zig body walks `bun_resolver::DirInfo` and
    /// reads `package.json` via the resolver — T6 work that lives in
    /// `bun_runtime::cli::RunCommand::configure_env_for_run`. The install
    /// tier needs the *Transpiler-initialisation* half of that contract
    /// (run_command.zig:780 `this_transpiler.* = try Transpiler.init(...)`)
    /// because callers (`configure_env_for_scripts_run`) `assume_init()` the
    /// out-param. This shim performs the init + the env-var seeding that has
    /// no T6 dependency; the `*mut ()` return stands in for `*mut DirInfo`
    /// (opaque to install — every caller discards it).
    pub fn configure_env_for_run(
        ctx: &mut bun_options_types::context::ContextData,
        this_transpiler: &mut ::core::mem::MaybeUninit<bun_transpiler::Transpiler<'static>>,
        env: Option<*mut bun_dotenv::Loader<'static>>,
        _log_errors: bool,
        store_root_fd: bool,
    ) -> Result<*mut (), bun_core::Error> {
        use bun_core::Global;

        let args = ctx.args.clone();
        // Spec run_command.zig:780: `this_transpiler.* = try Transpiler.init(ctx.allocator, ctx.log, args, env)`.
        this_transpiler.write(bun_transpiler::Transpiler::init(
            install_runner_arena(),
            ctx.log,
            args,
            env,
        )?);
        // SAFETY: fully written on the line above.
        let this_transpiler = unsafe { this_transpiler.assume_init_mut() };
        this_transpiler.options.env.behavior =
            bun_options_types::schema::api::DotEnvBehavior::load_all;
        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.resolver.store_fd = store_root_fd;

        // Re-derive per-use rather than holding a long-lived `&mut` (matches
        // Zig's per-statement `this_transpiler.env` deref and avoids
        // Stacked-Borrows overlap with `run_env_loader`).
        let env_loader = this_transpiler.env_mut();

        // Propagate --no-orphans / [run] noOrphans to the script's env so any
        // Bun process the script spawns enables its own watchdog. The env
        // loader snapshots `environ` before flag parsing runs, so the
        // `setenv()` in `enable()` isn't reflected here.
        if bun_io::parent_death_watchdog::is_enabled() {
            let _ = env_loader.map.put(b"BUN_FEATURE_FLAG_NO_ORPHANS", b"1");
        }

        // we have no way of knowing what version they're expecting without
        // running the node executable; running the node executable is too
        // slow, so we will just hardcode it to LTS
        let _ = env_loader.map.put_default(
            b"npm_config_user_agent",
            // the use of npm/? is copying yarn
            // e.g.
            // > "yarn/1.22.4 npm/? node/v12.16.3 darwin x64",
            const_format::concatcp!(
                "bun/",
                Global::package_json_version,
                " npm/? node/v",
                bun_core::env::REPORTED_NODEJS_VERSION,
                " ",
                Global::os_name,
                " ",
                Global::arch_name,
            )
            .as_bytes(),
        );

        if env_loader.get(b"npm_execpath").is_none() {
            // we don't care if this fails
            if let Ok(self_exe) = bun_core::self_exe_path() {
                let _ = env_loader
                    .map
                    .put_default(b"npm_execpath", self_exe.as_bytes());
            }
        }

        // DirInfo walk / npm_package_* seeding is performed by the T6 impl
        // (`bun_runtime::cli::RunCommand::configure_env_for_run`); install
        // callers discard the return value.
        Ok(core::ptr::null_mut())
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub const BUN_HASH_TAG: &[u8] = b".bun-tag-";

/// Length of `u64::MAX` formatted as lowercase hex (`ffffffffffffffff`).
pub const MAX_HEX_HASH_LEN: usize = {
    // Zig computed this with std.fmt.bufPrint at comptime; u64::MAX in hex is
    // always 16 nibbles.
    let mut n = u64::MAX;
    let mut len = 0usize;
    while n != 0 {
        n >>= 4;
        len += 1;
    }
    len
};
const _: () = assert!(MAX_HEX_HASH_LEN == 16);

pub const MAX_BUNTAG_HASH_BUF_LEN: usize = MAX_HEX_HASH_LEN + BUN_HASH_TAG.len() + 1;
pub type BuntagHashBuf = [u8; MAX_BUNTAG_HASH_BUF_LEN];

pub fn buntaghashbuf_make(buf: &mut BuntagHashBuf, patch_hash: u64) -> &mut [u8] {
    buf[0..BUN_HASH_TAG.len()].copy_from_slice(BUN_HASH_TAG);
    // std.fmt.bufPrint(buf[bun_hash_tag.len..], "{x}", .{patch_hash})
    let mut tmp = [0u8; 16];
    let digits = bun_core::fmt::u64_hex_var_lower(&mut tmp, patch_hash);
    buf[BUN_HASH_TAG.len()..BUN_HASH_TAG.len() + digits.len()].copy_from_slice(digits);
    let digits_len = digits.len();
    buf[BUN_HASH_TAG.len() + digits_len] = 0;
    &mut buf[..BUN_HASH_TAG.len() + digits_len]
}

pub struct StorePathFormatter<'a> {
    str: &'a [u8],
}

impl<'a> StorePathFormatter<'a> {
    /// Spec install.zig:31-37 — `for (this.str) |c| writer.writeByte(c)` emits raw bytes
    /// verbatim (mapping `/` and `\` to `+`). This is the byte-faithful sink; callers that
    /// need an on-disk store path (legal non-UTF-8 on Linux) must use this, not `Display`.
    pub fn write_to<W: std::io::Write>(&self, w: &mut W) -> std::io::Result<()> {
        // if (!this.opts.replace_slashes) {
        //     try writer.writeAll(this.str);
        //     return;
        // }
        for &c in self.str {
            match c {
                b'/' | b'\\' => w.write_all(b"+")?,
                _ => w.write_all(core::slice::from_ref(&c))?,
            }
        }
        Ok(())
    }
}

impl<'a> fmt::Display for StorePathFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // PORT NOTE: `core::fmt` cannot emit non-UTF-8 bytes. The Zig spec writes raw
        // bytes via `writer.writeByte(c)`; routing through `to_str_lossy()` here was wrong
        // (it silently expanded each invalid byte to U+FFFD = 3 bytes, changing on-disk
        // store directory names). We now build the raw byte sequence via `write_to` and
        // pass it through only when it is already valid UTF-8 — otherwise we surface
        // `fmt::Error` rather than corrupt the path.
        let mut buf = Vec::with_capacity(self.str.len());
        self.write_to(&mut buf).map_err(|_| fmt::Error)?;
        f.write_str(bun_core::str_utf8(&buf).ok_or(fmt::Error)?)
    }
}

pub fn fmt_store_path(str: &[u8]) -> StorePathFormatter<'_> {
    StorePathFormatter { str }
}

// these bytes are skipped
// so we just make it repeat bun bun bun bun bun bun bun bun bun
pub static ALIGNMENT_BYTES_TO_REPEAT_BUFFER: [u8; 144] = [0u8; 144];

pub fn initialize_store() {
    bun_ast::initialize_store_or_reset();
}

/// The default store we use pre-allocates around 16 MB of memory per thread
/// That adds up in multi-threaded scenarios.
/// ASTMemoryAllocator uses a smaller fixed buffer allocator
pub fn initialize_mini_store() {
    use bun_alloc::Arena;
    use bun_js_parser as js_ast;

    struct MiniStore {
        heap: Arena,
        memory_store: bun_ast::ASTMemoryAllocator,
    }

    thread_local! {
        static INSTANCE: Cell<Option<*mut MiniStore>> = const { Cell::new(None) };
    }

    INSTANCE.with(|instance| {
        if instance.get().is_none() {
            let heap = Arena::new();
            // Zig threads `heap.arena()` into the AST allocator; in Rust
            // the Bump (`Arena`) is passed by reference.
            let memory_store = bun_ast::ASTMemoryAllocator::new(&heap);
            let mini_store = bun_core::heap::into_raw(Box::new(MiniStore { heap, memory_store }));
            // SAFETY: just allocated, non-null, thread-local exclusive access
            unsafe {
                (*mini_store).memory_store.reset();
                (*mini_store).memory_store.push();
            }
            instance.set(Some(mini_store));
        } else {
            // SAFETY: pointer was heap-allocated on this thread in the branch above and is
            // never freed; INSTANCE is thread-local and `Cell::get` copies the raw pointer
            // out (no borrow of the Cell is held), so this `&mut` is the sole live reference
            // to the allocation for its entire scope — no aliasing. Mirrors Zig's
            // `threadlocal var instance: ?*MiniStore` single-owner deref.
            let mini_store = unsafe { &mut *instance.get().unwrap() };
            // PORT NOTE: Zig checked `stack_allocator.fixed_buffer_allocator.end_index >=
            // buffer.len() - 1` to decide whether to recycle the heap arena. The Rust
            // `ASTMemoryAllocator` collapses SFA+fallback into a single bumpalo arena,
            // so there is no stack-buffer watermark to inspect — `reset()` already
            // releases all bump allocations.
            // Spec checks `stack_allocator.fixed_buffer_allocator.end_index >=
            // buffer.len() - 1`; the equivalent size gate is
            // `reset_retain_with_limit` — only pay `mi_heap_destroy + mi_heap_new`
            // once accumulated bytes exceed 8 MiB. `push()` re-publishes the
            // (possibly unchanged) `heap_ptr()` to `AST_HEAP`.
            let _ = &mini_store.heap;
            mini_store
                .memory_store
                .reset_retain_with_limit(8 * 1024 * 1024);
            mini_store.memory_store.push();
        }
    });
}

// MOVE_DOWN: identity/sentinel scalar aliases live in `bun_install_types::resolver_hooks`
// (single canonical definition shared with `bun_resolver`). Re-exported here so existing
// `bun_install::PackageID` / `INVALID_PACKAGE_ID` / etc. paths continue to resolve.
pub use bun_install_types::{
    DependencyID, INVALID_DEPENDENCY_ID, INVALID_PACKAGE_ID, PackageID, PackageNameHash,
    TruncatedPackageNameHash,
};
// Phase-A drafts use the Zig field-style lowercase names; alias both spellings.
pub const invalid_package_id: PackageID = INVALID_PACKAGE_ID;
pub const invalid_dependency_id: DependencyID = INVALID_DEPENDENCY_ID;
pub const bun_hash_tag: &[u8] = BUN_HASH_TAG;

pub type PackageNameAndVersionHash = u64;

pub struct Aligner;

impl Aligner {
    pub fn write<T, W: bun_io::Write>(writer: &mut W, pos: u64) -> bun_io::Result<usize> {
        let to_write = Self::skip_amount::<T>(pos as usize);

        let remainder: &[u8] = &ALIGNMENT_BYTES_TO_REPEAT_BUFFER
            [0..to_write.min(ALIGNMENT_BYTES_TO_REPEAT_BUFFER.len())];
        writer.write_all(remainder)?;

        Ok(to_write)
    }

    /// Runtime-alignment variant of [`Aligner::write`] for call sites that
    /// compute `align_of::<T>()` at the caller (Zig passed `comptime Type`;
    /// Rust callers without a nameable `T` pass the alignment as a value).
    pub fn write_with_align<W: bun_io::Write>(
        align: usize,
        writer: &mut W,
        pos: u64,
    ) -> bun_io::Result<usize> {
        let to_write = Self::skip_amount_with_align(align, pos as usize);

        let remainder: &[u8] = &ALIGNMENT_BYTES_TO_REPEAT_BUFFER
            [0..to_write.min(ALIGNMENT_BYTES_TO_REPEAT_BUFFER.len())];
        writer.write_all(remainder)?;

        Ok(to_write)
    }

    #[inline]
    pub fn skip_amount<T>(pos: usize) -> usize {
        Self::skip_amount_with_align(core::mem::align_of::<T>(), pos)
    }

    #[inline]
    pub fn skip_amount_with_align(align: usize, pos: usize) -> usize {
        // std.mem.alignForward(usize, pos, align) - pos
        pos.next_multiple_of(align) - pos
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub enum Origin {
    #[default]
    Local = 0,
    Npm = 1,
    Tarball = 2,
}

// MOVE_DOWN: `Features` and `PreinstallState` now live in
// `bun_install_types::resolver_hooks` so `Behavior::is_enabled` (also moved
// down) can name a single shared `Features` without a `bun_install` upward
// edge. Re-exported here for existing `crate::Features` callers.
pub use bun_install_types::resolver_hooks::{Features, PreinstallState};

#[derive(Default)]
pub struct ExtractDataJson {
    pub path: Box<[u8]>,
    pub buf: Vec<u8>,
}

#[derive(Default)]
pub struct ExtractData {
    pub url: Box<[u8]>,
    pub resolved: Box<[u8]>,
    pub json: Option<ExtractDataJson>,
    /// Integrity hash computed from the raw tarball bytes.
    /// Used for HTTPS/local tarball dependencies where the hash
    /// is not available from a registry manifest.
    pub integrity: Integrity,
}

/// Port of `DependencyInstallContext` (src/install/install.zig:213). Zig stores
/// `path: std.array_list.Managed(u8) = .init(bun.default_allocator)` — an
/// owned, growable buffer. Earlier port modelled this as a borrowed `*const
/// [u8]` raw slice with `Copy` semantics, which broke ownership: Zig callers
/// push into this buffer; the raw-ptr version cannot grow and aliases caller
/// memory with no lifetime. Own the buffer.
#[derive(Clone, Default)]
pub struct DependencyInstallContext {
    pub tree_id: lockfile::tree::Id,
    pub path: Vec<u8>,
    pub dependency_id: DependencyID,
}

impl DependencyInstallContext {
    pub fn new(dependency_id: DependencyID) -> Self {
        Self {
            tree_id: 0,
            path: Vec::new(),
            dependency_id,
        }
    }
}

#[derive(Clone)]
pub enum TaskCallbackContext {
    Dependency(DependencyID),
    DependencyInstallContext(DependencyInstallContext),
    IsolatedPackageInstallContext(isolated_install::EntryId),
    RootDependency(DependencyID),
    RootRequestId(PackageID),
}

// We can't know all the packages we need until we've downloaded all the packages
// The easy way would be:
// 1. Download all packages, parsing their dependencies and enqueuing all dependencies for resolution
// 2.

#[derive(strum::IntoStaticStr, Debug, Copy, Clone, Eq, PartialEq)]
pub enum PackageManifestError {
    PackageManifestHTTP400,
    PackageManifestHTTP401,
    PackageManifestHTTP402,
    PackageManifestHTTP403,
    PackageManifestHTTP404,
    PackageManifestHTTP4xx,
    PackageManifestHTTP5xx,
}

bun_core::impl_tag_error!(PackageManifestError);

bun_core::named_error_set!(PackageManifestError);

// ported from: src/install/install.zig
