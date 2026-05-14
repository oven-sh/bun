use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::io::Write as _;

use crate::bun_fs as fs;
use crate::bun_fs::FileSystem;
use crate::bun_progress::{Node as ProgressNode, Progress};
use crate::bun_schema::api as Api;
use bun_alloc::AllocError;
use bun_collections::linear_fifo::{DynamicBuffer, StaticBuffer};
use bun_collections::{ArrayHashMap, HashMap, HiveArrayFallback, LinearFifo, StringArrayHashMap};
use bun_core::ZBox;
use bun_core::{Error, Global, Once, Output, err};
use bun_core::{ZStr, strings};
use bun_dotenv as dot_env;
use bun_event_loop::MiniEventLoop as mini_event_loop;
use bun_event_loop::MiniEventLoop::MiniEventLoop;
use bun_event_loop::{self, AnyEventLoop, EventLoopHandle};
use bun_http as http;
use bun_http::AsyncHTTP;
use bun_ini as ini;
use bun_paths::resolve_path::{self, PosixToWinNormalizer, platform};
use bun_paths::{self as path, DELIMITER, PathBuffer, SEP, SEP_STR};
use bun_semver::{self as Semver, String as SemverString};
use bun_sys::{self, Fd};
use bun_threading::{ThreadPool, UnboundedQueue, thread_pool};
use bun_transpiler::{self as transpiler, Transpiler};
use bun_url::URL;

/// Port of `bun.LazyBool` (bun.zig:2234) — caches the result of a getter the
/// first time `get()` is called. Zig used `@fieldParentPtr` to recover the
/// containing struct from the field address; Rust has no field-parent-pointer
/// so the getter receives `&mut PackageManager` explicitly and the caller
/// passes `self` (the field is always read via `self.ci_mode.get(self)` in
/// PackageManager — see `is_continuous_integration`). Because the field lives
/// inside the parent and we'd otherwise need a simultaneous `&mut self.ci_mode`
/// + `&self` borrow, model the cache as a `Cell<Option<bool>>` and read the
/// parent through a raw pointer (mirrors Zig's non-exclusive `*Parent`).
pub struct LazyBool<F> {
    value: core::cell::Cell<Option<bool>>,
    getter: F,
}
impl<F> LazyBool<F> {
    pub const fn new(getter: F) -> Self {
        Self {
            value: core::cell::Cell::new(None),
            getter,
        }
    }
}
impl LazyBool<fn(&PackageManager) -> bool> {
    pub fn get(&self, parent: &PackageManager) -> bool {
        if let Some(v) = self.value.get() {
            return v;
        }
        let v = (self.getter)(parent);
        self.value.set(Some(v));
        v
    }
}

// `bun.spawn.process.WaiterThread` — the force-waiter-thread flag was moved
// down into `bun_spawn::process` (MOVE_DOWN b0); install just flips it during
// init. The full waiter-thread machinery (queue, signalfd, loop) lives in
// `bun_runtime::api::bun::process` and *reads* the same flag.
use bun_spawn::process::WaiterThread;

// TODO(b0): RunCommand arrives from move-in (bun_runtime::cli::RunCommand → install).
use crate::RunCommand;

/// `Command::Context` shim — Zig's `Command.Context` (= `*ContextData`) lives in
/// `bun_runtime::cli::Command`; the option-carrying `ContextData` shape was lifted
/// into `bun_options_types::context` so install can reference it without the CLI
/// tier. Re-export under the Zig path so `init()` / `install_with_manager()` /
/// `setup_global_dir()` etc. keep their `Command::Context` signatures.
#[allow(non_snake_case)]
pub mod Command {
    pub use bun_options_types::context::{Context, ContextData};

    /// Hook (GENUINE b0): `bun_runtime::cli::Command::get()` returns the
    /// process-global `*ContextData`. The static itself lives in tier-6
    /// (`cli.rs`); install only needs a pointer for the bundler hook in
    /// `update_package_json_and_install`. Registered once at startup by bun_cli.
    pub static GLOBAL_CTX: core::sync::atomic::AtomicPtr<ContextData> =
        core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

    /// Returns the raw process-global `*mut ContextData` (Zig: `Command.get()
    /// -> *ContextData`). Returns a raw pointer rather than `&'static mut`
    /// because callers (e.g. `update_package_json_and_install`) already hold a
    /// live `ctx: &mut ContextData` to the same allocation — materializing a
    /// second `&mut` here would alias and is UB. Callers must deref at point
    /// of use under their own SAFETY justification.
    #[inline]
    pub fn get() -> *mut ContextData {
        // SAFETY: `GLOBAL_CTX` is set exactly once during single-threaded CLI
        // startup (before any install entry point runs) and never cleared; we
        // only read the pointer value here, no dereference.
        GLOBAL_CTX.load(core::sync::atomic::Ordering::Relaxed)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-module declarations — Zig basenames preserved per PORTING.md, hence
// explicit #[path] attrs for PascalCase / camelCase file names.
// ──────────────────────────────────────────────────────────────────────────
#[path = "PackageManager/CommandLineArguments.rs"]
pub mod command_line_arguments;
#[path = "PackageManager/install_with_manager.rs"]
pub mod install_with_manager;
#[path = "PackageManager/PackageJSONEditor.rs"]
pub mod package_json_editor;
#[path = "PackageManager/PackageManagerDirectories.rs"]
pub mod package_manager_directories;
#[path = "PackageManager/PackageManagerEnqueue.rs"]
pub mod package_manager_enqueue;
#[path = "PackageManager/PackageManagerLifecycle.rs"]
pub mod package_manager_lifecycle;
#[path = "PackageManager/PackageManagerOptions.rs"]
pub mod package_manager_options;
#[path = "PackageManager/PackageManagerResolution.rs"]
pub mod package_manager_resolution;
#[path = "PackageManager/patchPackage.rs"]
pub mod patch_package;
#[path = "PackageManager/PopulateManifestCache.rs"]
pub mod populate_manifest_cache;
#[path = "PackageManager/processDependencyList.rs"]
pub mod process_dependency_list;
#[path = "PackageManager/ProgressStrings.rs"]
pub mod progress_strings;
#[path = "PackageManager/runTasks.rs"]
pub mod run_tasks;
#[path = "PackageManager/security_scanner.rs"]
pub mod security_scanner;
#[path = "PackageManager/updatePackageJSONAndInstall.rs"]
pub mod update_package_json_and_install;
#[path = "PackageManager/UpdateRequest.rs"]
pub mod update_request;
#[path = "PackageManager/WorkspacePackageJSONCache.rs"]
pub mod workspace_package_json_cache;

/// Lower-case path alias so `package_manager::options::Options` (used by the
/// retired stub surface) keeps resolving.
pub mod options {
    pub use super::package_manager_options::*;
}

// ──────────────────────────────────────────────────────────────────────────
// Only the `printHelp` text is needed by `CommandLineArguments::parse`. The
// `exec()` body remains in bun_cli (it depends on tier-6 ScanCommand /
// PackCommand etc. and is the *consumer* of install, not a dependency).
// ──────────────────────────────────────────────────────────────────────────
pub struct PackageManagerCommand;

impl PackageManagerCommand {
    pub fn print_help() {
        // the output of --help uses the following syntax highlighting
        // template: <b>Usage<r>: <b><green>bun <command><r> <cyan>[flags]<r> <blue>[arguments]<r>
        // use [foo] for multiple arguments or flags for foo.
        // use <bar> to emphasize 'bar'

        let intro_text = r"
<b>Usage<r>: <b><green>bun pm<r> <cyan>[flags]<r> <blue>[\<command\>]<r>

  Run package manager utilities.
";
        let outro_text = r"

<b>Commands:<r>

  <b><green>bun pm<r> <blue>scan<r>                 scan all packages in lockfile for security vulnerabilities
  <b><green>bun pm<r> <blue>pack<r>                 create a tarball of the current workspace
  <d>├<r> <cyan>--dry-run<r>                 do everything except for writing the tarball to disk
  <d>├<r> <cyan>--destination<r>             the directory the tarball will be saved in
  <d>├<r> <cyan>--filename<r>                the name of the tarball
  <d>├<r> <cyan>--ignore-scripts<r>          don't run pre/postpack and prepare scripts
  <d>├<r> <cyan>--gzip-level<r>              specify a custom compression level for gzip (0-9, default is 9)
  <d>└<r> <cyan>--quiet<r>                   only output the tarball filename
  <b><green>bun pm<r> <blue>bin<r>                  print the path to bin folder
  <d>└<r> <cyan>-g<r>                        print the <b>global<r> path to bin folder
  <b><green>bun<r> <blue>list<r>                  list the dependency tree according to the current lockfile
  <d>└<r> <cyan>--all<r>                     list the entire dependency tree according to the current lockfile
  <b><green>bun pm<r> <blue>why<r> <d>\<pkg\><r>            show dependency tree explaining why a package is installed
  <b><green>bun pm<r> <blue>whoami<r>               print the current npm username
  <b><green>bun pm<r> <blue>view<r> <d>name[@version]<r>  view package metadata from the registry <d>(use `bun info` instead)<r>
  <b><green>bun pm<r> <blue>version<r> <d>[increment]<r>  bump the version in package.json and create a git tag
  <d>└<r> <cyan>increment<r>                 patch, minor, major, prepatch, preminor, premajor, prerelease, from-git, or a specific version
  <b><green>bun pm<r> <blue>pkg<r>                  manage data in package.json
  <d>├<r> <cyan>get<r> <d>[key ...]<r>
  <d>├<r> <cyan>set<r> <d>key=value ...<r>
  <d>├<r> <cyan>delete<r> <d>key ...<r>
  <d>└<r> <cyan>fix<r>                       auto-correct common package.json errors
  <b><green>bun pm<r> <blue>hash<r>                 generate & print the hash of the current lockfile
  <b><green>bun pm<r> <blue>hash-string<r>          print the string used to hash the lockfile
  <b><green>bun pm<r> <blue>hash-print<r>           print the hash stored in the current lockfile
  <b><green>bun pm<r> <blue>cache<r>                print the path to the cache folder
  <b><green>bun pm<r> <blue>cache rm<r>             clear the cache
  <b><green>bun pm<r> <blue>migrate<r>              migrate another package manager's lockfile without installing anything
  <b><green>bun pm<r> <blue>untrusted<r>            print current untrusted dependencies with scripts
  <b><green>bun pm<r> <blue>trust<r> <d>names ...<r>      run scripts for untrusted dependencies and add to `trustedDependencies`
  <d>└<r>  <cyan>--all<r>                    trust all untrusted dependencies
  <b><green>bun pm<r> <blue>default-trusted<r>      print the default trusted dependencies list

Learn more about these at <magenta>https://bun.com/docs/cli/pm<r>.
";

        Output::pretty(format_args!("{}", intro_text));
        Output::pretty(format_args!("{}", outro_text));
        Output::flush();
    }
}

// `bun.resolver.DirInfo` — only stored as a raw pointer in
// `ScriptRunEnvironment.root_dir_info`. `bun_resolver` is a lower tier than
// `bun_install` (already a transitive dep via `bun_transpiler` → `bun_bundler`),
// so import the real type directly instead of an opaque ZST stub.
use bun_resolver::dir_info::DirInfo;

use crate::lockfile_real::package as Package;
use crate::package_manager_task as Task;
use crate::resolvers::folder_resolver::FolderResolution;
use bun_install::lockfile::{self, Lockfile};
use bun_install::{
    ArrayIdentityContext, Dependency, DependencyID, Features, IdentityContext,
    LifecycleScriptSubprocess, NetworkTask, PackageID, PackageManifestMap,
    PackageNameAndVersionHash, PackageNameHash, PatchTask, PostinstallOptimizer, PreinstallState,
    TaskCallbackContext, initialize_store,
};

// ──────────────────────────────────────────────────────────────────────────
// Sub-module re-exports (thin re-exports — bodies live in their own files)
// ──────────────────────────────────────────────────────────────────────────

pub use self::command_line_arguments as command_line_arguments_mod;
pub use self::command_line_arguments::CommandLineArguments;
pub use self::package_manager_options::Options;
// Zig's `PackageJSONEditor` is a file-level namespace (no struct) — re-export
// the module itself so `PackageJSONEditor::edit(...)` resolves to the free fns.
pub use self::install_with_manager::install_with_manager;
#[allow(non_snake_case)]
pub use self::package_json_editor as PackageJSONEditor;
pub use self::update_request::UpdateRequest;
pub use self::workspace_package_json_cache::WorkspacePackageJSONCache;
pub use super::package_installer::PackageInstaller;

pub use self::package_manager_directories as directories;
use directories::attempt_to_create_package_json_and_open;
pub use directories::{
    attempt_to_create_package_json, cached_git_folder_name, cached_git_folder_name_print,
    cached_git_folder_name_print_auto, cached_github_folder_name, cached_github_folder_name_print,
    cached_github_folder_name_print_auto, cached_npm_package_folder_name,
    cached_npm_package_folder_name_print, cached_npm_package_folder_print_basename,
    cached_tarball_folder_name, cached_tarball_folder_name_print, compute_cache_dir_and_subpath,
    fetch_cache_directory_path, get_cache_directory, get_cache_directory_and_abs_path,
    get_temporary_directory, global_link_dir, global_link_dir_and_path, global_link_dir_path,
    is_folder_in_cache, path_for_cached_npm_path, path_for_resolution, save_lockfile,
    setup_global_dir, update_lockfile_if_needed, write_yarn_lock,
};

pub use self::package_manager_enqueue as enqueue;
pub use enqueue::{
    create_extract_task_for_streaming, enqueue_dependency_list, enqueue_dependency_to_root,
    enqueue_dependency_with_main, enqueue_dependency_with_main_and_success_fn,
    enqueue_extract_npm_package, enqueue_git_checkout, enqueue_git_for_checkout,
    enqueue_network_task, enqueue_package_for_download, enqueue_parse_npm_package,
    enqueue_patch_task, enqueue_patch_task_pre, enqueue_tarball_for_download,
    enqueue_tarball_for_reading,
};

use self::package_manager_lifecycle as lifecycle;
pub use lifecycle::{
    LifecycleScriptTimeLog, LifecycleScriptTimeLogEntry, determine_preinstall_state,
    ensure_preinstall_state_list_capacity, find_trusted_dependencies_from_update_requests,
    get_preinstall_state, has_no_more_pending_lifecycle_scripts, load_root_lifecycle_scripts,
    report_slow_lifecycle_scripts, set_preinstall_state, sleep, spawn_package_lifecycle_scripts,
    tick_lifecycle_scripts,
};

use self::package_manager_resolution as resolution;
pub use resolution::{
    assign_resolution, assign_root_resolution, format_later_version_in_cache,
    get_installed_versions_from_disk_cache, resolve_from_disk_cache, scope_for_package_name,
    verify_resolutions,
};

pub use self::progress_strings as progress_mod;
pub use progress_mod::{
    ProgressStrings, end_progress_bar, set_node_name, start_progress_bar,
    start_progress_bar_if_none,
};

pub use self::patch_package::{PatchCommitResult, do_patch_commit, prepare_patch};

pub use self::process_dependency_list::{
    GitResolver, process_dependency_list, process_dependency_list_item,
    process_extracted_tarball_package, process_peer_dependency_list,
};

pub use self::run_tasks::{
    alloc_github_url, decrement_pending_tasks, drain_dependency_list, flush_dependency_queue,
    flush_network_queue, flush_patch_task_queue, generate_network_task_for_tarball,
    get_network_task, has_created_network_task, increment_pending_tasks, is_network_task_required,
    pending_task_count, run_tasks, schedule_tasks,
};

pub use self::update_package_json_and_install::{
    update_package_json_and_install_and_cli, update_package_json_and_install_with_manager,
};

pub use self::populate_manifest_cache::populate_manifest_cache;

// ──────────────────────────────────────────────────────────────────────────
// Type aliases
// ──────────────────────────────────────────────────────────────────────────

pub type TaskCallbackList = Vec<TaskCallbackContext>;
pub type TaskDependencyQueue =
    HashMap<Task::Id, TaskCallbackList /* , IdentityContext<Task::Id>, 80 */>;

type PreallocatedTaskStore = HiveArrayFallback<Task::Task<'static>, 64>;
type PreallocatedNetworkTasks = HiveArrayFallback<NetworkTask, 128>;
type ResolveTaskQueue = UnboundedQueue<Task::Task<'static> /* , .next */>;

type RepositoryMap = HashMap<Task::Id, Fd /* , IdentityContext<Task::Id>, 80 */>;
/// Zig: `FolderResolution.Map` (resolvers/folder_resolver.zig) =
/// `std.HashMap(u64, FolderResolution, IdentityContext(u64), 80)`.
pub type FolderResolutionMap = HashMap<u64, FolderResolution /* , IdentityContext<u64>, 80 */>;
pub type NpmAliasMap =
    HashMap<PackageNameHash, crate::dependency::Version /* , IdentityContext<u64>, 80 */>;

type NetworkQueue = LinearFifo<*mut NetworkTask, StaticBuffer<*mut NetworkTask, 32>>;
type PatchTaskFifo = LinearFifo<*mut PatchTask, StaticBuffer<*mut PatchTask, 32>>;

pub type PatchTaskQueue = UnboundedQueue<PatchTask /* , .next */>;
pub type AsyncNetworkTaskQueue = UnboundedQueue<NetworkTask /* , .next */>;

pub type SuccessFn = fn(&mut PackageManager, DependencyID, PackageID);
pub type FailFn = fn(&mut PackageManager, &Dependency, PackageID, Error);

// Default to a maximum of 64 simultaneous HTTP requests for bun install if no proxy is specified
// if a proxy IS specified, default to 64. We have different values because we might change this in the future.
// https://github.com/npm/cli/issues/7072
// https://pnpm.io/npmrc#network-concurrency (pnpm defaults to 16)
// https://yarnpkg.com/configuration/yarnrc#networkConcurrency (defaults to 50)
const DEFAULT_MAX_SIMULTANEOUS_REQUESTS_FOR_BUN_INSTALL: usize = 64;
const DEFAULT_MAX_SIMULTANEOUS_REQUESTS_FOR_BUN_INSTALL_FOR_PROXIES: usize = 64;

bun_output::declare_scope!(PackageManager, hidden);

// ──────────────────────────────────────────────────────────────────────────
// PackageManager
// ──────────────────────────────────────────────────────────────────────────

pub struct PackageManager {
    pub cache_directory_: Option<bun_sys::Dir>, // TODO(port): std.fs.Dir → bun_sys::Dir
    pub cache_directory_path: ZBox,             // TODO(port): lifetime — singleton-leaked
    pub root_dir: &'static mut fs::DirEntry,
    // allocator dropped per §Allocators (was `bun.default_allocator`). For the
    // handful of sites that allocated AST nodes via `Expr.allocate(manager.allocator, …)`
    // — i.e. nodes that must outlive `Expr.Data.Store.reset()` across workspace
    // iterations — use `ast_arena` instead. The manager is a leaked singleton, so
    // this arena has process lifetime, matching the Zig allocator's semantics.
    pub ast_arena: bun_alloc::Arena,
    // TODO(port): lifetime — LIFETIMES.tsv classifies this BORROW_PARAM → `&'a mut bun_ast::Log`
    // (struct gets `<'a>`). Kept as raw ptr because PackageManager is a leaked singleton stored
    // in a `static`; threading `<'a>` through the global holder is deferred to Phase B.
    pub log: *mut bun_ast::Log,
    pub resolve_tasks: ResolveTaskQueue,
    pub timestamp_for_manifest_cache_control: u32,
    pub extracted_count: u32,
    pub default_features: Features,
    pub summary: Package::DiffSummary,
    // Set once in `init()`/`init_with_runtime()` to the process-singleton
    // `DotEnv.Loader` (leaked allocation; outlives the manager). `BackRef`
    // encapsulates the liveness invariant so `env()` is a safe accessor.
    pub env: Option<bun_ptr::BackRef<dot_env::Loader<'static>>>,
    pub progress: Progress,
    pub downloads_node: Option<*mut ProgressNode>, // BORROW_FIELD — points into self.progress
    pub scripts_node: Option<NonNull<ProgressNode>>, // UNKNOWN — points to caller stack-local // TODO(port): lifetime
    pub progress_name_buf: [u8; 768],
    pub progress_name_buf_dynamic: Vec<u8>,
    pub cpu_count: u32,

    pub track_installed_bin: TrackInstalledBin,

    // progress bar stuff when not stack allocated
    pub root_progress_node: *mut ProgressNode, // BORROW_FIELD — self.progress.start() returns &self.progress.root

    pub to_update: bool,

    pub subcommand: Subcommand,
    pub update_requests: Box<[UpdateRequest]>,

    /// Only set in `bun pm`
    pub root_package_json_name_at_time_of_init: Box<[u8]>,

    pub root_package_json_file: bun_sys::File, // TODO(port): std.fs.File → bun_sys::File

    /// The package id corresponding to the workspace the install is happening in. Could be root, or
    /// could be any of the workspaces.
    pub root_package_id: RootPackageId,

    pub thread_pool: ThreadPool,
    pub task_batch: thread_pool::Batch,
    pub task_queue: TaskDependencyQueue,

    pub manifests: PackageManifestMap,
    pub folders: FolderResolutionMap,
    pub git_repositories: RepositoryMap,

    pub network_dedupe_map: crate::network_task::DedupeMap,
    pub async_network_task_queue: AsyncNetworkTaskQueue,
    pub network_tarball_batch: thread_pool::Batch,
    pub network_resolve_batch: thread_pool::Batch,
    pub network_task_fifo: NetworkQueue,
    pub patch_apply_batch: thread_pool::Batch,
    pub patch_calc_hash_batch: thread_pool::Batch,
    pub patch_task_fifo: PatchTaskFifo,
    pub patch_task_queue: PatchTaskQueue,
    /// We actually need to calculate the patch file hashes
    /// every single time, because someone could edit the patchfile at anytime
    ///
    /// TODO: Does this need to be atomic? It seems to be accessed only from the main thread.
    pub pending_pre_calc_hashes: AtomicU32,
    pub pending_tasks: AtomicU32,
    pub total_tasks: u32,
    pub preallocated_network_tasks: PreallocatedNetworkTasks,
    pub preallocated_resolve_tasks: PreallocatedTaskStore,

    /// items are only inserted into this if they took more than 500ms
    pub lifecycle_script_time_log: LifecycleScriptTimeLog,

    pub pending_lifecycle_script_tasks: AtomicU32,
    pub finished_installing: AtomicBool,
    pub total_scripts: usize,

    pub root_lifecycle_scripts: Option<Package::scripts::List>,

    pub node_gyp_tempdir_name: Box<[u8]>,

    pub env_configure: Option<ScriptRunEnvironment>,

    pub lockfile: Box<Lockfile>, // OWNED

    pub options: Options,
    pub preinstall_state: Vec<PreinstallState>,
    pub postinstall_optimizer: crate::postinstall_optimizer::List,

    pub global_link_dir: Option<bun_sys::Dir>, // TODO(port): std.fs.Dir
    pub global_dir: Option<bun_sys::Dir>,      // TODO(port): std.fs.Dir
    pub global_link_dir_path: Box<[u8]>,

    pub on_wake: WakeHandler,
    pub ci_mode: LazyBool<fn(&PackageManager) -> bool>, // TODO(port): bun.LazyBool(computeIsContinuousIntegration, @This(), "ci_mode")

    pub peer_dependencies: LinearFifo<DependencyID, DynamicBuffer<DependencyID>>,

    // name hash from alias package name -> aliased package dependency version info
    pub known_npm_aliases: NpmAliasMap,

    pub event_loop: AnyEventLoop<'static>,

    // During `installPackages` we learn exactly what dependencies from --trust
    // actually have scripts to run, and we add them to this list
    pub trusted_deps_to_add_to_package_json: Vec<Box<[u8]>>,

    pub any_failed_to_install: bool,

    // When adding a `file:` dependency in a workspace package, we want to install it
    // relative to the workspace root, but the path provided is relative to the
    // workspace package. We keep track of the original here.
    pub original_package_json_path: ZBox, // TODO(port): owned [:0]const u8

    // null means root. Used during `cleanWithLogger` to identifier which
    // workspace is adding/removing packages
    pub workspace_name_hash: Option<PackageNameHash>,

    pub workspace_package_json_cache: WorkspacePackageJSONCache,

    // normally we have `UpdateRequests` to work with for adding/deleting/updating packages, but
    // if `bun update` is used without any package names we need a way to keep information for
    // the original packages that are updating.
    //
    // dependency name -> original version information
    pub updating_packages: StringArrayHashMap<PackageUpdateInfo>,

    pub patched_dependencies_to_remove:
        ArrayHashMap<PackageNameAndVersionHash, () /* , ArrayIdentityContext::U64, false */>,

    pub active_lifecycle_scripts: crate::lifecycle_script_runner::List<'static>,
    pub last_reported_slow_lifecycle_script_at: u64,
    pub cached_tick_for_slow_lifecycle_script_logging: u64,
}

#[derive(Default)]
pub struct RootPackageId {
    pub id: Option<PackageID>,
}

impl RootPackageId {
    pub fn get(
        &mut self,
        lockfile: &Lockfile,
        workspace_name_hash: Option<PackageNameHash>,
    ) -> PackageID {
        if let Some(id) = self.id {
            return id;
        }
        let id = lockfile.get_workspace_package_id(workspace_name_hash);
        self.id = Some(id);
        id
    }
}

/// Corresponds to possible commands from the CLI.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")] // @tagName compat: Zig tags are lowercase ("install", "update", ...)
pub enum Subcommand {
    Install,
    Update,
    Pm,
    Add,
    Remove,
    Link,
    Unlink,
    Patch,
    #[strum(serialize = "patch-commit")]
    PatchCommit,
    Outdated,
    Pack,
    Publish,
    Audit,
    Info,
    Why,
    Scan,
    // bin,
    // hash,
    // @"hash-print",
    // @"hash-string",
    // cache,
    // @"default-trusted",
    // untrusted,
    // trust,
    // ls,
    // migrate,
}

impl Subcommand {
    pub fn can_globally_install_packages(self) -> bool {
        matches!(self, Self::Install | Self::Update | Self::Add)
    }

    pub fn supports_workspace_filtering(self) -> bool {
        matches!(self, Self::Outdated | Self::Install | Self::Update)
        // .pack => true,
        // .add => true,
    }

    pub fn supports_json_output(self) -> bool {
        matches!(self, Self::Audit | Self::Pm | Self::Info)
    }

    // TODO: make all subcommands find root and chdir
    pub fn should_chdir_to_root(self) -> bool {
        !matches!(self, Self::Link)
    }
}

pub enum WorkspaceFilter {
    All,
    Name(Box<[u8]>),
    Path(Box<[u8]>),
}

impl WorkspaceFilter {
    pub fn init(
        input: &[u8],
        cwd: &[u8],
        path_buf: &mut [u8],
    ) -> Result<WorkspaceFilter, AllocError> {
        if (input.len() == 1 && input[0] == b'*') || input == b"**" {
            return Ok(WorkspaceFilter::All);
        }

        let mut remain = input;

        let mut prepend_negate = false;
        while !remain.is_empty() && remain[0] == b'!' {
            prepend_negate = !prepend_negate;
            remain = &remain[1..];
        }

        let is_path = !remain.is_empty() && remain[0] == b'.';

        let filter: &[u8] =
            if is_path {
                strings::without_trailing_slash(
                    resolve_path::join_abs_string_buf::<platform::Posix>(cwd, path_buf, &[remain]),
                )
            } else {
                remain
            };

        if filter.is_empty() {
            // won't match anything
            return Ok(WorkspaceFilter::Path(Box::default()));
        }
        let copy_start = prepend_negate as usize;
        let copy_end = copy_start + filter.len();

        let mut buf = vec![0u8; copy_end].into_boxed_slice();
        buf[copy_start..copy_end].copy_from_slice(filter);

        if prepend_negate {
            buf[0] = b'!';
        }

        // pattern = buf[0..copy_end] == buf (since buf.len() == copy_end)
        Ok(if is_path {
            WorkspaceFilter::Path(buf)
        } else {
            WorkspaceFilter::Name(buf)
        })
    }
}

// deinit → Drop is automatic for Box<[u8]> variants; no explicit impl needed.

#[derive(Default)]
pub struct PackageUpdateInfo {
    pub original_version_literal: Box<[u8]>,
    pub is_alias: bool,
    pub original_version_string_buf: Box<[u8]>,
    pub original_version: Option<Semver::Version>,
}

pub enum TrackInstalledBin {
    None,
    Pending,
    Basename(Box<[u8]>),
}

impl Default for TrackInstalledBin {
    fn default() -> Self {
        Self::None
    }
}

pub struct ScriptRunEnvironment {
    pub root_dir_info: Option<NonNull<DirInfo>>, // UNKNOWN — struct appears unused // TODO(port): lifetime
    pub transpiler: Transpiler<'static>,
}

// MOVE_DOWN: data struct + accessors live in `bun_install_types::WakeHandler`
// (single definition the resolver also stores). The `handler` second arg is
// erased to `*mut c_void` there because that crate cannot name
// `PackageManager`; `wake_raw()` casts it back at the call site.
pub use bun_install_types::resolver_hooks::WakeHandler;

// ──────────────────────────────────────────────────────────────────────────
// Globals / statics
// ──────────────────────────────────────────────────────────────────────────

/// Port of Zig `pub var verbose_install: bool`. Set once during
/// single-threaded CLI startup (`PackageManagerOptions::load`) and read on
/// both the main thread and ThreadPool workers thereafter — `AtomicBool` with
/// `Relaxed` is sufficient (no ordering against other state; the write
/// happens-before any worker spawn).
pub static VERBOSE_INSTALL: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

impl PackageManager {
    /// Port of Zig `pub var verbose_install: bool` (PackageManager.zig) — read
    /// as `PackageManager.verbose_install` throughout the install pipeline.
    #[inline]
    pub fn verbose_install() -> bool {
        VERBOSE_INSTALL.load(core::sync::atomic::Ordering::Relaxed)
    }
    #[inline]
    pub fn set_verbose_install(v: bool) {
        VERBOSE_INSTALL.store(v, core::sync::atomic::Ordering::Relaxed);
    }

    /// Reborrow the externally-owned [`bun_ast::Log`].
    ///
    /// `log` is `*mut Log` (not `&'a mut Log`) only because `PackageManager` is
    /// a leaked `'static` singleton stored in a global; threading the borrow
    /// lifetime through `static INSTANCE` is deferred (see field comment). The
    /// `Log` itself outlives the manager — it's the CLI-scope log allocated in
    /// `Command::init` before the manager exists.
    ///
    /// The returned lifetime is **decoupled** from `&self`: callers routinely
    /// hold a borrow into `self.lockfile`/`self.options` while appending an
    /// error, and the `Log` is a disjoint allocation. This mirrors Zig's
    /// `*PackageManager` field-aliasing; it is the caller's responsibility not
    /// to alias the returned `&mut Log` (single-threaded by construction —
    /// only the main install loop touches `log`).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn log_mut<'a>(&self) -> &'a mut bun_ast::Log {
        let p = self.log;
        // SAFETY: `self.log` is non-null for the manager's lifetime (set in
        // `init`, never cleared) and the pointee is the CLI-scope `Log`, which
        // outlives every `'a` a caller can name. Exclusive access is upheld by
        // single-threaded use; see doc comment.
        unsafe { &mut *p }
    }

    /// Reborrow the active progress download node (`self.progress.root`-rooted).
    /// Panics if no download node is active — callers gate on
    /// `options.log_level.show_progress()`, which is the same condition that
    /// populates `downloads_node`. Lifetime is decoupled from `&self` for the
    /// same reason as [`log_mut`]: `Progress` is a stable allocation on the
    /// leaked-singleton manager and callers interleave node updates with
    /// disjoint `&mut self.X` field writes.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn downloads_node_mut<'a>(&self) -> &'a mut ProgressNode {
        let p = self.downloads_node.expect("downloads_node active");
        // SAFETY: `downloads_node` points into `self.progress` (BORROW_FIELD);
        // `Progress` is pinned for the manager's lifetime (leaked singleton)
        // and the node is set before any caller reaches this path.
        unsafe { &mut *p }
    }

    /// Reborrow the active scripts progress node, if any.
    ///
    /// Unlike [`downloads_node_mut`], this returns `Option` — `scripts_node` is
    /// `None` until the install pass (hoisted/isolated) populates it with a
    /// pointer to a stack-local `ProgressNode` that outlives the pass. Lifetime
    /// is decoupled from `&self` for the same reason as [`downloads_node_mut`]:
    /// callers interleave node updates with disjoint `&mut self.X` writes, and
    /// the pointee lives on the *caller's* stack, not inside the manager.
    /// Single-threaded by construction (main install loop only — see
    /// `lifecycle_script_runner` "monotonic is okay" comments).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn scripts_node_mut<'a>(&self) -> Option<&'a mut ProgressNode> {
        let mut p = self.scripts_node?;
        // SAFETY: `scripts_node` is `Some(NonNull)` pointing at a caller
        // stack-local `ProgressNode` that outlives the install pass; access is
        // single-threaded (main install loop only).
        Some(unsafe { p.as_mut() })
    }

    /// Port of Zig `pub fn get() *PackageManager` (PackageManager.zig:442) —
    /// the global singleton accessor. Associated-fn spelling that forwards to
    /// the free [`get`] so callers can write `PackageManager::get()` (the Zig
    /// `PackageManager.get()` call shape).
    ///
    /// Returns `&'static` (shared) — NOT `&'static mut`. Thread-pool workers
    /// (`Repository` git ops, npm `SaveTask`, `UninstallTask::run`) call this
    /// concurrently with the main thread; a shared ref is the only sound
    /// shape. Mutating accessors (`increment_pending_tasks`, `wake`, …) take
    /// `&self` and use interior atomics. For exclusive in-place mutation use
    /// the raw [`get`] free fn with field projection (see its doc).
    #[inline]
    pub fn get() -> &'static PackageManager {
        // SAFETY: `holder::RAW_PTR` is written once on the main thread by
        // `allocate_package_manager()` before any caller of `get()` (asserted
        // by Zig's `Holder.ptr = undefined` → init ordering); the singleton
        // lives for the process. Shared `&` aliases freely across threads.
        unsafe { &*get() }
    }

    /// Port of `PackageManager.init` (src/install/PackageManager.zig:568).
    /// Associated-fn spelling that forwards to the free [`init`] so callers
    /// can write `PackageManager::init(ctx, cli, subcommand)` (the Zig
    /// `PackageManager.init` call shape).
    #[inline]
    pub fn init(
        ctx: Command::Context,
        cli: CommandLineArguments,
        subcommand: Subcommand,
    ) -> Result<(&'static mut PackageManager, Box<[u8]>), Error> {
        init(ctx, cli, subcommand)
    }
}

// Zig: `const TimePasser = struct { pub var last_time: u64 = 0; };` — a one-field
// namespace whose only consumer is `hasEnoughTimePassedBetweenWaitingMessages`.
// PORTING.md §Global mutable state: counter → Atomic. Main-thread-only so
// `Relaxed` matches the Zig non-atomic read/write.
static TIME_PASSER_LAST_TIME: core::sync::atomic::AtomicU64 = core::sync::atomic::AtomicU64::new(0);

thread_local! {
    // bun.ThreadlocalBuffers: heap-backed so only a pointer lives in TLS
    // (see test/js/bun/binary/tls-segment-size).
    static CACHED_PACKAGE_FOLDER_NAME_BUFS: core::cell::Cell<*mut PathBuffer> =
        const { core::cell::Cell::new(core::ptr::null_mut()) };
}

#[inline]
pub fn cached_package_folder_name_buf() -> *mut PathBuffer {
    // bun.ThreadlocalBuffers semantics: lazily heap-allocate, return raw ptr into
    // thread-local storage. Callers reborrow per-field; valid for the thread's lifetime.
    CACHED_PACKAGE_FOLDER_NAME_BUFS.with(|c| {
        let mut p = c.get();
        if p.is_null() {
            p = bun_core::heap::into_raw(Box::new(PathBuffer::ZEROED));
            c.set(p);
        }
        p
    })
}

mod holder {
    use super::PackageManager;
    use bun_dotenv as dot_env;
    // OWNED — global singleton, leaked.
    // PORT NOTE: LIFETIMES.tsv prescribes `OnceLock<Box<PackageManager>>` for Holder.ptr, but
    // Zig uses `var ptr: *PackageManager = undefined` then assigns via allocatePackageManager()
    // and later writes `manager.* = ...` in-place. OnceLock<Box<T>> can't express
    // allocate-then-fill (no `&mut` after set). Keep a raw ptr for now.
    // TODO(port): in-place init — reconcile with OnceLock<Box<PackageManager>> in Phase B.
    // PORTING.md §Global mutable state: ptr written once on main thread, read
    // from worker threads → AtomicPtr (Release/Acquire pairs the publish).
    pub static RAW_PTR: core::sync::atomic::AtomicPtr<PackageManager> =
        core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

    // Process-lifetime env storage for `init()`. `dot_env::Loader<'a>` borrows `&'a mut Map`,
    // so the pair is self-referential and cannot live in `OnceLock<T>` (which only yields `&T`).
    // Mirrors Zig's `ctx.allocator.create(dot_env::Map)` / `create(dot_env::Loader)` — owned by
    // the singleton, never freed. Avoids `Box::leak` per PORTING.md §Forbidden.
    // TODO(port): retype `dot_env::Loader.map` to `Box<Map>` so this becomes an owned field
    // (`Box<dot_env::Loader>`) on `PackageManager` and these statics disappear.
    // Write-once during single-threaded init; never read afterwards (kept only
    // to anchor the allocation). `AtomicCell<*mut T>` — payload is `Copy` and
    // pointer-sized, so `.store()` is a safe Release write (no `RacyCell`
    // raw-ptr deref needed).
    pub static ENV_MAP: bun_core::AtomicCell<*mut dot_env::Map> =
        bun_core::AtomicCell::new(core::ptr::null_mut());
    pub static ENV_LOADER: bun_core::AtomicCell<*mut dot_env::Loader<'static>> =
        bun_core::AtomicCell::new(core::ptr::null_mut());

    /// Process-lifetime storage for `http::http_thread::InitOpts.abs_ca_file_name`
    /// (Zig: `allocator.dupeZ` into a leaked singleton field). `OnceLock` per
    /// PORTING.md §Forbidden — never `Box::leak` to mint `&'static`.
    pub static ABS_CA_FILE_NAME: std::sync::OnceLock<Box<[u8]>> = std::sync::OnceLock::new();

    /// Process-lifetime storage for `http::http_thread::InitOpts.ca` C-strings
    /// (Zig: `manager.allocator.dupeZ` per entry, never freed). The HTTP thread
    /// reads these asynchronously after `init()` returns, so they must outlive
    /// the local that builds them.
    pub static CA: std::sync::OnceLock<Vec<bun_core::ZBox>> = std::sync::OnceLock::new();
}

// PORTING.md §Global mutable state: single-thread (main) scratch buffers →
// RacyCell. `ROOT_PACKAGE_JSON_PATH` is a slice into the buf above it; written
// once in `init()`, read on main + CLI commands afterwards.
static CWD_BUF: bun_core::RacyCell<PathBuffer> = bun_core::RacyCell::new(PathBuffer::ZEROED);
static ROOT_PACKAGE_JSON_PATH_BUF: bun_core::RacyCell<PathBuffer> =
    bun_core::RacyCell::new(PathBuffer::ZEROED);
pub static ROOT_PACKAGE_JSON_PATH: bun_core::RacyCell<&ZStr> = bun_core::RacyCell::new(ZStr::EMPTY); // TODO(port): [:0]const u8 static slice into ROOT_PACKAGE_JSON_PATH_BUF

// ──────────────────────────────────────────────────────────────────────────
// impl PackageManager
// ──────────────────────────────────────────────────────────────────────────

impl PackageManager {
    pub fn clear_cached_items_depending_on_lockfile_buffer(&mut self) {
        self.root_package_id.id = None;
    }

    /// Zig: `pm.lockfile.loadFromCwd(pm, allocator, log, attempt_loading_from_other_lockfile)`.
    ///
    /// PORT NOTE: reshaped for borrowck — the Zig call passes `pm` as a separate
    /// argument while the receiver borrows `pm.lockfile`, which is a
    /// self-referential split borrow in Rust. Encapsulated here so callers stay
    /// in safe code: the returned `LoadResult` mutably borrows `self` for its
    /// lifetime, after which `self.lockfile` holds the loaded data.
    pub fn load_lockfile_from_cwd<const ATTEMPT_OTHER: bool>(
        &mut self,
    ) -> lockfile::LoadResult<'_> {
        let pm: *mut PackageManager = self;
        // SAFETY: `self.lockfile` is `Box<Lockfile>` — its pointee lives in a
        // separate heap allocation, so `&mut Lockfile` and `&mut PackageManager`
        // never alias overlapping bytes. `Lockfile::load_from_cwd` reads
        // `manager.options`/`manager.log` only and never re-projects
        // `manager.lockfile`. Both raw pointers below are derived from `self`,
        // so the caller's borrow stays on the Stacked-Borrows stack.
        unsafe {
            let lf: *mut Lockfile = &raw mut *(*pm).lockfile;
            let log: *mut bun_ast::Log = (*pm).log;
            (*lf).load_from_cwd::<ATTEMPT_OTHER>(Some(&mut *pm), &mut *log)
        }
    }

    pub fn crash(&mut self) -> ! {
        if self.options.log_level != package_manager_options::LogLevel::Silent {
            // SAFETY: `self.log` points to a separate `bun_ast::Log` allocation (borrowed from
            // `ctx.log`) that outlives the singleton. `&mut self` only covers the pointer field,
            // not the pointee. `bun_ast::Log::print` takes `&self` (Zig spec `*const Log`,
            // logger.zig:1204), so we only need a shared borrow here — the sole invariant is
            // that no `&mut bun_ast::Log` to the pointee is live, which holds on this path.
            // `IntoLogWrite` is impl'd for `*mut io::Writer`, not `&mut`.
            let _ = self
                .log_mut()
                .print(std::ptr::from_mut(Output::error_writer()));
        }
        Global::crash();
    }

    pub fn has_enough_time_passed_between_waiting_messages() -> bool {
        // Main-thread only (also guards TIME_PASSER_LAST_TIME below); reads
        // event_loop.iteration_number which is written only by the same main-thread tick loop.
        // `Self::get()` is the safe `&'static PackageManager` singleton accessor.
        let iter = Self::get().event_loop.iteration_number();
        if TIME_PASSER_LAST_TIME.load(core::sync::atomic::Ordering::Relaxed) < iter {
            TIME_PASSER_LAST_TIME.store(iter, core::sync::atomic::Ordering::Relaxed);
            return true;
        }
        false
    }

    pub fn configure_env_for_scripts(
        &mut self,
        ctx: Command::Context,
        log_level: package_manager_options::LogLevel,
    ) -> Result<&mut transpiler::Transpiler<'static>, Error> {
        // TODO(port): narrow error set
        // PORT NOTE: Zig `bun.once` caches the `Transpiler` value and returns it on
        // subsequent calls. `Transpiler` is non-`Copy` (and self-referential via
        // `linker.options = &options`), so cache by pointer in a process-static.
        // SAFETY: `PackageManager` is a leaked singleton; main-thread-only call site.
        let mut ptr = CONFIGURE_ENV_FOR_SCRIPTS_ONCE.load(core::sync::atomic::Ordering::Acquire);
        if ptr.is_null() {
            let t = configure_env_for_scripts_run(self, ctx, log_level)?;
            ptr = bun_core::heap::into_raw(Box::new(t));
            CONFIGURE_ENV_FOR_SCRIPTS_ONCE.store(ptr, core::sync::atomic::Ordering::Release);
        }
        // SAFETY: `ptr` is a leaked `Box<Transpiler>`; main-thread-only so the
        // `&mut` is exclusive for the caller's scope.
        Ok(unsafe { &mut *ptr })
    }

    pub fn http_proxy(&mut self, url: &URL<'_>) -> Option<URL<'static>> {
        // `self.env` is `NonNull<dot_env::Loader<'static>>`; `get_http_proxy_for`
        // returns `Option<URL<'a>>` where `'a` is the loader's map lifetime —
        // i.e. `'static` here. The lifetime contract (env-map values are
        // process-lifetime `Box<[u8]>`) is encapsulated in `bun_dotenv`, not at
        // every call site (PORTING.md §Forbidden: never mint `'static` from
        // a borrowed reference).
        self.env_mut().get_http_proxy_for(url)
    }

    pub fn tls_reject_unauthorized(&mut self) -> bool {
        self.env_mut().get_tls_reject_unauthorized()
    }

    pub fn compute_is_continuous_integration(&self) -> bool {
        self.env().is_ci()
    }

    #[inline]
    pub fn is_continuous_integration(&mut self) -> bool {
        // PORT NOTE: Zig `LazyBool.get` recovers `*PackageManager` via
        // `@fieldParentPtr("ci_mode", self)`. Rust has no field-parent-pointer,
        // so pass the parent explicitly. `ci_mode.value` is a `Cell` so a
        // shared `&self` projection suffices — both the receiver `&self.ci_mode`
        // and the `&PackageManager` arg are shared reborrows of `*self` and may
        // freely overlap.
        let this: &PackageManager = self;
        this.ci_mode.get(this)
    }

    pub fn fail_root_resolution(
        &mut self,
        dependency: &Dependency,
        dependency_id: DependencyID,
        err: Error,
    ) {
        if let Some(ctx) = self.on_wake.context {
            (self.on_wake.get_on_dependency_error())(ctx.as_ptr(), dependency, dependency_id, err);
        }
    }

    pub fn wake(&mut self) {
        // Main-thread / single-owner callers go through `&mut self`; delegate to the
        // raw-pointer path so there is one body.
        // SAFETY: `self` is a valid `*mut PackageManager`.
        unsafe { Self::wake_raw(self) };
    }

    /// Raw-pointer wake for concurrent task-thread callers (see
    /// `isolated_install::Installer::Task::callback`). Never materializes
    /// `&mut PackageManager`, so two task threads finishing simultaneously do
    /// not hold aliased exclusive borrows. `on_wake` is read-only; the handler
    /// receives the raw `*mut` (Zig's `*PackageManager` carries no exclusivity
    /// contract); `event_loop.wakeup()` is the cross-thread signal and is
    /// internally synchronized — we reach it via `addr_of_mut!` so the `&mut`
    /// covers only the event-loop field, never the whole `PackageManager`.
    ///
    /// # Safety
    /// `this` must point to a live `PackageManager` (BACKREF).
    pub unsafe fn wake_raw(this: *mut Self) {
        unsafe {
            let on_wake = &*core::ptr::addr_of!((*this).on_wake);
            if let Some(ctx) = on_wake.context {
                // `WakeHandler.handler`'s second arg is the erased
                // `*mut PackageManager` (`bun_install_types` cannot name this
                // type); cast back to `*mut c_void` here.
                (on_wake.get_handler())(ctx.as_ptr(), this.cast::<c_void>());
            }
            (*core::ptr::addr_of_mut!((*this).event_loop)).wakeup();
        }
    }

    /// Spec: PackageManager.zig:424 `sleepUntil(this, closure, isDoneFn)`.
    ///
    /// Associated fn taking `*mut PackageManager` (NOT `&mut self`): every
    /// `is_done_fn` body in this crate reborrows the *whole* `PackageManager`
    /// from a raw pointer stashed in `C` (`&mut *closure.manager`). If this
    /// were a `&mut self` method, that whole-struct Unique retag would pop
    /// `self`'s tag (and the `&mut self.event_loop` borrow `tick` holds) under
    /// Stacked Borrows, making the next loop-iteration deref UB. Zig spec has
    /// no such constraint because Zig `*T` is non-exclusive.
    ///
    /// SAFETY: `this` must be valid for `&mut` access between callback
    /// invocations; while `is_done_fn` runs, the callback owns the unique
    /// `&mut PackageManager` and `sleep_until`/`tick_raw` hold no borrow.
    pub unsafe fn sleep_until<C>(
        this: *mut PackageManager,
        closure: &mut C,
        is_done_fn: fn(&mut C) -> bool,
    ) {
        Output::flush();
        // PORT NOTE: Zig `sleepUntil(closure: anytype, isDoneFn)` passes a `*Closure` and
        // a fn-pointer that mutates it. `AnyEventLoop::tick_raw` takes the type-erased
        // `(*mut c_void, fn(*mut c_void) -> bool)`; trampoline through a small wrapper so
        // `is_done_fn` receives `&mut C` and can drive `run_tasks` / record `err`.
        struct Erased<C> {
            ctx: *mut C,
            is_done: fn(&mut C) -> bool,
        }
        fn trampoline<C>(p: *mut c_void) -> bool {
            // SAFETY: `p` is the `Erased<C>` local we pass to `tick_raw` below. We only
            // read its two POD fields here (no `&mut Erased` materialized — the local
            // `&mut erased` borrow in the caller is still notionally live across the call).
            let erased = p as *const Erased<C>;
            let (ctx_ptr, is_done) = unsafe { ((*erased).ctx, (*erased).is_done) };
            // SAFETY: `ctx_ptr` was derived from the caller's exclusive `closure: &mut C`
            // and the caller does not touch `closure` again until `tick_raw` returns, so
            // this is the unique live `&mut C` for the duration of the callback.
            let ctx = unsafe { &mut *ctx_ptr };
            is_done(ctx)
        }
        let mut erased = Erased::<C> {
            ctx: std::ptr::from_mut::<C>(closure),
            is_done: is_done_fn,
        };
        // Derive the event-loop pointer through `this`'s raw provenance (NOT
        // via a `&mut self.event_loop` reborrow) so it shares `this`'s SRW tag
        // and survives the callback's `&mut *this` retag.
        // SAFETY: `this` is valid per fn contract; `&raw mut` does not create a
        // reference, only a place projection.
        let event_loop: *mut AnyEventLoop<'static> = unsafe { &raw mut (*this).event_loop };
        // SAFETY: `tick_raw` reborrows `*event_loop` only between `is_done`
        // calls (never across them), so the callback's `&mut PackageManager`
        // never overlaps a live `&mut AnyEventLoop`.
        unsafe {
            AnyEventLoop::tick_raw(
                event_loop,
                (&raw mut erased).cast::<c_void>(),
                trampoline::<C>,
            )
        };
    }

    pub fn ensure_temp_node_gyp_script(&mut self) -> Result<(), Error> {
        // TODO(port): narrow error set
        // PORT NOTE: Zig `bun.once` caches the `()` result. The body itself is
        // already idempotent (early-returns when `node_gyp_tempdir_name` is
        // non-empty), so a simple `AtomicBool` ran-flag matches semantics.
        // NB: not `bun_core::run_once!` — body is fallible and the contract is
        // "2nd call = Ok(()) regardless of 1st outcome" (D006).
        if ENSURE_TEMP_NODE_GYP_SCRIPT_ONCE.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        ensure_temp_node_gyp_script_run(self)
    }

    // Helper: deref env (set-once BackRef to process-singleton loader)
    #[inline]
    pub fn env(&self) -> &dot_env::Loader<'static> {
        // `env` is set during init() and never None afterward; `BackRef::get`
        // encapsulates the deref under the back-reference invariant.
        self.env.as_ref().expect("env initialised").get()
    }
    /// Reborrow the process-global env loader.
    ///
    /// Lifetime is decoupled from `&self` for the same reason as [`log_mut`] /
    /// [`downloads_node_mut`]: the loader is a singleton-leaked allocation
    /// outside the manager (set once in `init()`), and callers interleave env
    /// mutation with disjoint `&mut self.X` field writes (e.g. `find_commit`
    /// takes `env`, `log`, and reads `lockfile` in the same argument list).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn env_mut<'a>(&self) -> &'a mut dot_env::Loader<'static> {
        // SAFETY: `env` is set during `init()` and never None afterward; the
        // pointee is a process-lifetime singleton (leaked `DotEnv.Loader`)
        // that lives outside `self`, so the unbounded `'a` is sound under the
        // same single-threaded contract as `log_mut`/`scripts_node_mut`.
        // `BackRef` guarantees liveness; exclusivity is the caller's contract.
        unsafe { &mut *self.env.expect("env initialised").as_ptr() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// bun.once wrappers
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): bun.once returns a struct whose .call() runs the closure exactly once
// and caches the result. `Transpiler` is non-`Copy` and self-referential, so cache
// a process-static raw pointer (mirrors Zig `var ..: Transpiler = undefined;`).
// PORTING.md §Global mutable state: init-once ptr → AtomicPtr.
static CONFIGURE_ENV_FOR_SCRIPTS_ONCE: core::sync::atomic::AtomicPtr<
    transpiler::Transpiler<'static>,
> = core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

fn configure_env_for_scripts_run(
    this: &mut PackageManager,
    ctx: Command::Context,
    log_level: package_manager_options::LogLevel,
) -> Result<transpiler::Transpiler<'static>, Error> {
    // We need to figure out the PATH and other environment variables
    // to do that, we re-use the code from bun run
    // this is expensive, it traverses the entire directory tree going up to the root
    // so we really only want to do it when strictly necessary
    // PORT NOTE: `var this_transpiler: Transpiler = undefined` — Zig leaves it uninit and
    // RunCommand.configureEnvForRun fully initializes via out-param. Transpiler is NOT
    // all-zero-valid POD, so `zeroed()` is wrong; use MaybeUninit and assume_init after fill.
    let mut this_transpiler_slot =
        core::mem::MaybeUninit::<transpiler::Transpiler<'static>>::uninit();
    // Zig spec PackageManager.zig:322 passes `this.env` (a `*DotEnv.Loader`).
    // `self.env` is `Option<BackRef<Loader>>` here; pass the raw pointer so
    // the shim's `Transpiler::init` reuses the manager's loader instead of
    // allocating a fresh singleton.
    let env_ptr: Option<*mut dot_env::Loader<'static>> = this.env.map(|p| p.as_ptr());
    let _ = RunCommand::configure_env_for_run(
        ctx,
        &mut this_transpiler_slot,
        env_ptr,
        log_level != package_manager_options::LogLevel::Silent,
        false,
    )?;
    // SAFETY: the install-tier `RunCommand::configure_env_for_run` shim
    // (lib.rs) `.write()`s the slot via `Transpiler::init` before returning
    // `Ok` — same contract as the runtime impl (run_command.rs:628) and the
    // Zig spec (run_command.zig:780 `this_transpiler.* = try Transpiler.init(...)`).
    let mut this_transpiler = unsafe { this_transpiler_slot.assume_init() };

    let init_cwd_entry = this.env_mut().map.get_or_put_without_value(b"INIT_CWD")?;
    if !init_cwd_entry.found_existing {
        *init_cwd_entry.key_ptr = Box::<[u8]>::from(&**init_cwd_entry.key_ptr);
        *init_cwd_entry.value_ptr = dot_env::HashTableValue {
            value: Box::<[u8]>::from(strings::without_trailing_slash(
                FileSystem::instance().top_level_dir(),
            )),
            conditional: false,
        };
    }

    // Zig passes `this_transpiler.fs` (`*Fs.FileSystem`); the resolver-tier
    // `FileSystem` mirrors `bun_paths::fs::FileSystem` for `top_level_dir`.
    let paths_fs = bun_paths::fs::FileSystem::instance();
    this.env_mut().load_ccache_path(paths_fs);

    {
        // Run node-gyp jobs in parallel.
        // https://github.com/nodejs/node-gyp/blob/7d883b5cf4c26e76065201f85b0be36d5ebdcc0e/lib/build.js#L150-L184
        let thread_count = bun_core::get_thread_count();
        if thread_count > 2 {
            let t_env = this_transpiler.env_mut();
            if !t_env.has(b"JOBS") {
                let mut int_buf = bun_core::fmt::ItoaBuf::new();
                let jobs_str = bun_core::fmt::itoa(&mut int_buf, thread_count);
                t_env
                    .map
                    .put_alloc_value(b"JOBS", jobs_str)
                    .expect("unreachable");
            }
        }
    }

    {
        let mut node_path = PathBuffer::uninit();
        if let Some(node_path_z) = this.env_mut().get_node_path(paths_fs, &mut node_path) {
            let node_path_owned: Box<[u8]> = Box::<[u8]>::from(node_path_z.as_ref());
            let _ = this
                .env_mut()
                .load_node_js_config(paths_fs, &node_path_owned)?;
        } else {
            'brk: {
                let current_path = this.env().get(b"PATH").unwrap_or(b"");
                let mut path_var: Vec<u8> = Vec::with_capacity(current_path.len());
                path_var.extend_from_slice(current_path);
                let mut bun_path: &[u8] = b"";
                if RunCommand::create_fake_temporary_node_executable(&mut path_var, &mut bun_path)
                    .is_err()
                {
                    break 'brk;
                }
                this.env_mut().map.put(b"PATH", &path_var)?;
                let _ = this.env_mut().load_node_js_config(paths_fs, bun_path)?;
            }
        }
    }

    Ok(this_transpiler)
}

static ENSURE_TEMP_NODE_GYP_SCRIPT_ONCE: AtomicBool = AtomicBool::new(false);

fn ensure_temp_node_gyp_script_run(manager: &mut PackageManager) -> Result<(), Error> {
    if !manager.node_gyp_tempdir_name.is_empty() {
        return Ok(());
    }

    let tempdir = get_temporary_directory(manager);
    let mut path_buf = PathBuffer::uninit();
    let node_gyp_tempdir_name = fs::FileSystem::tmpname(b"node-gyp", &mut path_buf.0, 12345)?;

    // used later for adding to path for scripts
    manager.node_gyp_tempdir_name = Box::<[u8]>::from(node_gyp_tempdir_name.as_ref());

    let node_gyp_tempdir = match tempdir
        .handle
        .make_open_path(&manager.node_gyp_tempdir_name, Default::default())
    {
        Ok(d) => d,
        Err(e) if e == bun_core::err!(EEXIST) => {
            // it should not exist
            Output::pretty_errorln("<r><red>error<r>: node-gyp tempdir already exists");
            Global::crash();
        }
        Err(e) => {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: <b><red>{}<r> creating node-gyp tempdir",
                e.name(),
            ));
            Global::crash();
        }
    };
    let _node_gyp_tempdir_guard = bun_sys::CloseOnDrop::dir(node_gyp_tempdir);
    // PORT NOTE: reshaped for borrowck — `defer node_gyp_tempdir.close()`

    #[cfg(windows)]
    const FILE_NAME: &str = "node-gyp.cmd";
    #[cfg(not(windows))]
    const FILE_NAME: &str = "node-gyp";

    #[cfg(windows)]
    const MODE: u32 = 0; // windows does not have an executable bit
    #[cfg(not(windows))]
    const MODE: u32 = 0o755;

    // Zig: `node_gyp_tempdir.createFile(file_name, .{ .mode = mode })`.
    // `bun_sys::Dir` has no `create_file`; route through `File::openat` with the
    // same flags `std.fs.Dir.createFile` uses (`O_WRONLY|O_CREAT|O_TRUNC`).
    let node_gyp_file = match bun_sys::File::openat(
        node_gyp_tempdir.fd,
        FILE_NAME.as_bytes(),
        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC | bun_sys::O::CLOEXEC,
        MODE,
    ) {
        Ok(f) => f,
        Err(e) => {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: <b><red>{}<r> creating node-gyp tempdir",
                bstr::BStr::new(e.name()),
            ));
            Global::crash();
        }
    };
    let _close_node_gyp_file = bun_sys::CloseOnDrop::file(&node_gyp_file);

    #[cfg(windows)]
    const CONTENT: &str = "if not defined npm_config_node_gyp (\n  bun x --silent node-gyp %*\n) else (\n  node \"%npm_config_node_gyp%\" %*\n)\n";
    #[cfg(all(not(windows), not(target_os = "android")))]
    const CONTENT: &str = concat!(
        "#!/bin/sh\n",
        "if [ \"x$npm_config_node_gyp\" = \"x\" ]; then\n",
        "  bun x --silent node-gyp $@\n",
        "else\n",
        "  \"$npm_config_node_gyp\" $@\n",
        "fi\n"
    );
    #[cfg(target_os = "android")]
    const CONTENT: &str = concat!(
        "#!/system/bin/sh\n",
        "if [ \"x$npm_config_node_gyp\" = \"x\" ]; then\n",
        "  bun x --silent node-gyp $@\n",
        "else\n",
        "  \"$npm_config_node_gyp\" $@\n",
        "fi\n"
    );

    if let Err(e) = node_gyp_file.write_all(CONTENT.as_bytes()) {
        // Zig: "..." ++ file_name ++ " file" — comptime concat, no runtime alloc
        Output::pretty_errorln(format_args!(
            "<r><red>error<r>: <b><red>{}<r> writing to {} file",
            bstr::BStr::new(e.name()),
            FILE_NAME,
        ));
        Global::crash();
    }

    // Add our node-gyp tempdir to the path
    let existing_path = manager.env().get(b"PATH").unwrap_or(b"");
    let mut path_var: Vec<u8> = Vec::with_capacity(
        existing_path.len() + 1 + tempdir.name.len() + 1 + manager.node_gyp_tempdir_name.len(),
    );
    path_var.extend_from_slice(existing_path);
    if !existing_path.is_empty() && existing_path[existing_path.len() - 1] != DELIMITER {
        path_var.push(DELIMITER);
    }
    path_var.extend_from_slice(strings::without_trailing_slash(tempdir.name));
    path_var.push(SEP);
    path_var.extend_from_slice(&manager.node_gyp_tempdir_name);
    manager.env_mut().map.put(b"PATH", &path_var)?;

    let path_buf_len = path_buf.len();
    let mut cursor = &mut path_buf[..];
    write!(
        cursor,
        "{}{}{}{}{}",
        bstr::BStr::new(strings::without_trailing_slash(tempdir.name)),
        SEP_STR,
        bstr::BStr::new(strings::without_trailing_slash(
            &manager.node_gyp_tempdir_name
        )),
        SEP_STR,
        FILE_NAME
    )?;
    let written = path_buf_len - cursor.len();
    let npm_config_node_gyp = &path_buf[..written];

    let node_gyp_abs_dir = bun_core::dirname(npm_config_node_gyp).unwrap();
    manager
        .env_mut()
        .map
        .put_alloc_key_and_value(b"BUN_WHICH_IGNORE_CWD", node_gyp_abs_dir)?;

    Ok(())
}

fn http_thread_on_init_error(err: http::InitError, opts: &http::http_thread::InitOpts) -> ! {
    // `opts.abs_ca_file_name` is Zig `stringZ` (`[:0]const u8`) by contract —
    // populated in `init()` from a `ZBox` via `into_vec_with_nul()`, so the
    // stored slice length INCLUDES the trailing NUL. Re-derive the `&ZStr`
    // (NUL-stripped) once and use it for both the path resolver and the error
    // message so we don't print a literal `\0`.
    // SAFETY: trailing-NUL invariant established by `init()` for any non-empty
    // value; the empty default (`b""`) maps to `ZStr::EMPTY`.
    let abs_ca_z: &ZStr = if opts.abs_ca_file_name.is_empty() {
        ZStr::EMPTY
    } else {
        ZStr::from_slice_with_nul(opts.abs_ca_file_name)
    };
    match err {
        http::InitError::LoadCAFile => {
            let mut normalizer = PosixToWinNormalizer::default();
            let normalized = normalizer.resolve_z(FileSystem::instance().top_level_dir(), abs_ca_z);
            if !bun_sys::exists_z(normalized) {
                Output::err(
                    "HTTPThread",
                    "could not find CA file: '{s}'",
                    &[&bstr::BStr::new(abs_ca_z.as_bytes())],
                );
            } else {
                Output::err(
                    "HTTPThread",
                    "invalid CA file: '{s}'",
                    &[&bstr::BStr::new(abs_ca_z.as_bytes())],
                );
            }
        }
        http::InitError::InvalidCAFile => {
            Output::err(
                "HTTPThread",
                "invalid CA file: '{s}'",
                &[&bstr::BStr::new(abs_ca_z.as_bytes())],
            );
        }
        http::InitError::InvalidCA => {
            Output::err("HTTPThread", "the CA is invalid", ());
        }
        http::InitError::FailedToOpenSocket => {
            Output::err_generic("failed to start HTTP client thread", ());
        }
    }
    Global::crash();
}

// ──────────────────────────────────────────────────────────────────────────
// allocate / get singleton
// ──────────────────────────────────────────────────────────────────────────

pub fn allocate_package_manager() {
    // SAFETY: called once before get(); allocates uninitialized PackageManager.
    // Zig: `bun.handleOom(bun.default_allocator.create(PackageManager))` — uninitialized
    // memory, abort-on-OOM. The init() functions below write the full struct via
    // `core::ptr::write` (no Drop on the uninit bytes).
    unsafe {
        let layout = core::alloc::Layout::new::<PackageManager>();
        let ptr = std::alloc::alloc(layout).cast::<PackageManager>();
        if ptr.is_null() {
            bun_alloc::out_of_memory();
        }
        holder::RAW_PTR.store(ptr, core::sync::atomic::Ordering::Release);
    }
}

/// Returns the raw singleton pointer (Zig: `pub fn get() *PackageManager`).
///
/// Intentionally returns `*mut` rather than `&'static mut`: Zig's `*T` freely
/// aliases, and this accessor is invoked from thread-pool workers
/// (`UninstallTask::run`, npm `SaveTask`, `Repository` git ops) concurrently
/// with the main thread holding the `&mut PackageManager` returned by `init()`.
/// Materializing `&'static mut` here would create aliased mutable references
/// (UB). Callers must form their own narrowly-scoped reference via raw-pointer
/// projection (e.g. `unsafe { &(*get()).cache_directory_path }`) and justify
/// exclusivity / atomicity at the deref site.
pub fn get() -> *mut PackageManager {
    // `allocate_package_manager()` is the sole writer and runs on the main
    // thread before any caller of `get()`; Acquire pairs with its Release.
    holder::RAW_PTR.load(core::sync::atomic::Ordering::Acquire)
}

// ──────────────────────────────────────────────────────────────────────────
// init
// ──────────────────────────────────────────────────────────────────────────

/// Returns `&'static mut PackageManager` — the process-singleton (held in
/// `holder::RAW_PTR`) is leaked for the process lifetime and `init()` is called
/// exactly once on the single CLI dispatch thread (PackageManager.zig:568). Every
/// CLI command immediately reborrows the result as `&mut` for the command's
/// duration; centralising the deref here removes a dozen identical
/// `unsafe { &mut *ptr }` blocks at call sites.
///
/// Thread-pool workers (`UninstallTask::run`, npm `SaveTask`, `Repository` git ops)
/// project `&(*get()).field` concurrently once tasks are scheduled — same
/// aliasing story as before this change (the prior callers already held `&mut`
/// across those points). The raw [`get`] accessor remains `*mut` for those
/// worker-side projections.
pub fn init(
    ctx: Command::Context,
    cli: CommandLineArguments,
    subcommand: Subcommand,
) -> Result<(&'static mut PackageManager, Box<[u8]>), Error> {
    // TODO(port): narrow error set
    if cli.global {
        // Zig: `if (ctx.install) |opts|` — non-consuming peek. `ctx.install` is
        // `Option<Box<BunInstall>>` borrowed via `&mut ContextData`; reborrow with
        // `as_deref()` so the boxed config remains in `ctx` for the
        // `get_or_insert_with` calls below (npmrc loading).
        let mut explicit_global_dir: &[u8] = b"";
        if let Some(opts) = ctx.install.as_deref() {
            explicit_global_dir = opts.global_dir.as_deref().unwrap_or(explicit_global_dir);
        }
        let global_dir = package_manager_options::open_global_dir(explicit_global_dir)?;
        // Zig: `global_dir.setAsCwd()` → `fchdir`.
        bun_sys::fchdir(global_dir)?;
    }

    // Zig: `Fs.FileSystem.init(null)` — registers the resolver-tier singleton
    // and seeds `top_level_dir` from `getcwd`.
    bun_resolver::fs::FileSystem::init(None)?;
    let fs = FileSystem::instance();
    let top_level_dir_no_trailing_slash = strings::without_trailing_slash(fs.top_level_dir());
    // SAFETY: CWD_BUF is a process-global path buffer only touched on the main thread.
    // repr(transparent) makes the `*mut PathBuffer → *mut u8` cast sound.
    unsafe {
        let cwd_ptr = CWD_BUF.get().cast::<u8>();
        #[cfg(windows)]
        {
            let _ =
                path::path_to_posix_buf::<u8>(top_level_dir_no_trailing_slash, &mut *CWD_BUF.get());
        }
        #[cfg(not(windows))]
        {
            // Avoid memcpy alias when source and dest are the same
            if cwd_ptr.cast_const() != top_level_dir_no_trailing_slash.as_ptr() {
                core::ptr::copy_nonoverlapping(
                    top_level_dir_no_trailing_slash.as_ptr(),
                    cwd_ptr,
                    top_level_dir_no_trailing_slash.len(),
                );
            }
        }
        #[cfg(windows)]
        let _ = cwd_ptr;
    }

    // Zig: comptime `sep_str ++ "package.json"` — per-cfg const literal, no runtime alloc.
    #[cfg(windows)]
    const SEP_PACKAGE_JSON: &[u8] = b"\\package.json";
    #[cfg(not(windows))]
    const SEP_PACKAGE_JSON: &[u8] = b"/package.json";

    let mut original_package_json_path_buf: Vec<u8> =
        Vec::with_capacity(top_level_dir_no_trailing_slash.len() + SEP_PACKAGE_JSON.len() + 1);
    // PERF(port): was assume_capacity
    original_package_json_path_buf.extend_from_slice(top_level_dir_no_trailing_slash);
    original_package_json_path_buf.extend_from_slice(SEP_PACKAGE_JSON);
    original_package_json_path_buf.push(0);

    let path_len = top_level_dir_no_trailing_slash.len() + SEP_PACKAGE_JSON.len();
    // SAFETY: NUL written at `path_len` above. Not `from_buf`: this borrow is
    // intentionally detached — `original_package_json_path_buf` is mutated and
    // re-sliced below (the directory-walk rewrites the tail in place), and
    // borrowck cannot see that `original_package_json_path` is reassigned
    // before the next use after each mutation.
    let mut original_package_json_path =
        unsafe { ZStr::from_raw(original_package_json_path_buf.as_ptr(), path_len) };
    let original_cwd =
        strings::without_suffix_comptime(original_package_json_path.as_bytes(), SEP_PACKAGE_JSON);
    let original_cwd_clone = Box::<[u8]>::from(original_cwd);

    let mut workspace_names = Package::WorkspaceMap::WorkspaceMap::init();
    let mut workspace_package_json_cache = WorkspacePackageJSONCache {
        map: Default::default(),
    };

    let mut workspace_name_hash: Option<PackageNameHash> = None;
    let mut root_package_json_name_at_time_of_init: Box<[u8]> = Box::default();

    // Step 1. Find the nearest package.json directory
    //
    // We will walk up from the cwd, trying to find the nearest package.json file.
    let root_package_json_file = 'root_package_json_file: {
        let mut this_cwd: &[u8] = original_cwd;
        let mut created_package_json = false;
        let child_json: bun_sys::File = 'child: {
            // if we are only doing `bun install` (no args), then we can open as read_only
            // in all other cases we will need to write new data later.
            // this is relevant because it allows us to succeed an install if package.json
            // is readable but not writable
            //
            // probably wont matter as if package.json isn't writable, it's likely that
            // the underlying directory and node_modules isn't either.
            let need_write = subcommand != Subcommand::Install || cli.positionals.len() > 1;

            loop {
                let mut package_json_path_buf = PathBuffer::uninit();
                package_json_path_buf[..this_cwd.len()].copy_from_slice(this_cwd);
                package_json_path_buf[this_cwd.len()..this_cwd.len() + b"/package.json".len()]
                    .copy_from_slice(b"/package.json");
                package_json_path_buf[this_cwd.len() + b"/package.json".len()] = 0;
                // SAFETY: NUL written above
                let package_json_path = ZStr::from_buf(
                    &package_json_path_buf[..],
                    this_cwd.len() + b"/package.json".len(),
                );

                match bun_sys::File::openat(
                    bun_sys::Fd::cwd(),
                    package_json_path.as_bytes(),
                    if need_write {
                        bun_sys::O::RDWR
                    } else {
                        bun_sys::O::RDONLY
                    } | bun_sys::O::CLOEXEC,
                    0,
                ) {
                    Ok(f) => break 'child f,
                    Err(e) if e.get_errno() == bun_sys::E::ENOENT => {
                        if let Some(parent) = bun_core::dirname(this_cwd) {
                            this_cwd = strings::without_trailing_slash(parent);
                            continue;
                        } else {
                            break;
                        }
                    }
                    Err(e) if e.get_errno() == bun_sys::E::EACCES => {
                        Output::err(
                            "EACCES",
                            "Permission denied while opening \"{s}\"",
                            &[&bstr::BStr::new(package_json_path.as_bytes())],
                        );
                        if need_write {
                            Output::note("package.json must be writable to add packages");
                        } else {
                            Output::note(
                                "package.json is missing read permissions, or is owned by another user",
                            );
                        }
                        Global::crash();
                    }
                    Err(e) => {
                        // Zig: `Output.err(err, "could not open \"{s}\"", .{path})` —
                        // `bun.Output.err` accepts an error value directly.
                        Output::err(
                            &e,
                            "could not open \"{s}\"",
                            &[&bstr::BStr::new(package_json_path.as_bytes())],
                        );
                        return Err(e.into());
                    }
                }
            }

            if subcommand == Subcommand::Install {
                if cli.positionals.len() > 1 {
                    // this is `bun add <package>`.
                    //
                    // create the package json instead of return error. this works around
                    // a zig bug where continuing control flow through a catch seems to
                    // cause a segfault the second time `PackageManager.init` is called after
                    // switching to the add command.
                    this_cwd = original_cwd;
                    created_package_json = true;
                    break 'child attempt_to_create_package_json_and_open()?;
                }
            }
            return Err(err!("MissingPackageJSON"));
        };

        debug_assert!(strings::eql_long(
            &original_package_json_path_buf[..this_cwd.len()],
            this_cwd,
            true,
        ));
        original_package_json_path_buf.truncate(this_cwd.len());
        // PERF(port): was assume_capacity
        original_package_json_path_buf.push(SEP);
        original_package_json_path_buf.extend_from_slice(b"package.json");
        original_package_json_path_buf.push(0);

        let new_path_len = this_cwd.len() + "/package.json".len();
        // SAFETY: NUL written above
        original_package_json_path =
            ZStr::from_buf(&original_package_json_path_buf[..], new_path_len);
        let child_cwd = &original_package_json_path.as_bytes()[..this_cwd.len()];
        // PORT NOTE: reshaped — Zig uses withoutSuffixComptime(.., sep_str ++ "package.json")

        // Check if this is a workspace; if so, use root package
        if subcommand.should_chdir_to_root() {
            if !created_package_json {
                while let Some(parent) = bun_core::dirname(this_cwd) {
                    let parent_without_trailing_slash = strings::without_trailing_slash(parent);
                    let mut parent_path_buf = PathBuffer::uninit();
                    parent_path_buf[..parent_without_trailing_slash.len()]
                        .copy_from_slice(parent_without_trailing_slash);
                    parent_path_buf[parent_without_trailing_slash.len()
                        ..parent_without_trailing_slash.len() + b"/package.json".len()]
                        .copy_from_slice(b"/package.json");
                    parent_path_buf[parent_without_trailing_slash.len() + b"/package.json".len()] =
                        0;

                    let json_file = match bun_sys::File::openat(
                        bun_sys::Fd::cwd(),
                        &parent_path_buf
                            [..parent_without_trailing_slash.len() + b"/package.json".len()],
                        bun_sys::O::RDWR | bun_sys::O::CLOEXEC,
                        0,
                    ) {
                        Ok(f) => f,
                        Err(_) => {
                            this_cwd = parent;
                            continue;
                        }
                    };
                    // Zig: `defer if (!found) json_file.close()`. The only path
                    // that sets `found = true` immediately hands the file out
                    // via `break :root_package_json_file`, so model it as an
                    // unconditional close-on-drop guard that the success path
                    // defuses with `ScopeGuard::into_inner` — avoids the
                    // `&mut found` capture that borrowck rejects.
                    let json_file_guard = scopeguard::guard(json_file, |f| {
                        let _ = f.close(); // close error is non-actionable (Zig parity: discarded)
                    });
                    let json_stat_size = json_file_guard.get_end_pos()?;
                    let mut json_buf = vec![0u8; (json_stat_size + 64) as usize];
                    let json_len = json_file_guard.pread_all(&mut json_buf, 0)?;
                    // SAFETY: ROOT_PACKAGE_JSON_PATH_BUF is a process-global only touched on main
                    // thread; `&raw mut` + explicit reborrow avoids the 2024 `static_mut_refs` deny.
                    let json_path = unsafe {
                        bun_sys::get_fd_path(
                            json_file_guard.handle,
                            &mut *ROOT_PACKAGE_JSON_PATH_BUF.get(),
                        )?
                    };
                    let json_source =
                        bun_ast::Source::init_path_string(&*json_path, &json_buf[..json_len]);
                    initialize_store();
                    // Zig threads `ctx.allocator`; the Rust JSON parser takes a bump arena.
                    let json_arena = bun_alloc::Arena::new();
                    // SAFETY: `ctx.log` is a borrow of the CLI's `Log`; valid for the
                    // duration of `init()` (set by `Command::create()` before any install
                    // entry point runs).
                    let json = crate::bun_json::parse_package_json_utf8(
                        &json_source,
                        unsafe { &mut *ctx.log },
                        &json_arena,
                    )?;
                    if subcommand == Subcommand::Pm {
                        if let Some(name) = json.get(b"name").and_then(|e| {
                            if let bun_ast::ExprData::EString(s) = &e.data {
                                Some(s.data.slice())
                            } else {
                                None
                            }
                        }) {
                            root_package_json_name_at_time_of_init = Box::<[u8]>::from(name);
                        }
                    }

                    use crate::bun_json::ExprData;
                    if let Some(prop) = json.as_property(b"workspaces") {
                        let mut json_array = match prop.expr.data {
                            ExprData::EArray(arr) => arr,
                            ExprData::EObject(obj) => {
                                if let Some(packages) = obj.get().get(b"packages") {
                                    match packages.data {
                                        ExprData::EArray(arr) => arr,
                                        _ => break,
                                    }
                                } else {
                                    break;
                                }
                            }
                            _ => break,
                        };
                        let mut log = bun_ast::Log::init();
                        let _ = match workspace_names.process_names_array(
                            &mut workspace_package_json_cache,
                            &mut log,
                            &*json_array,
                            &json_source,
                            prop.loc,
                            None,
                        ) {
                            Ok(v) => v,
                            Err(_) => break,
                        };
                        drop(log);

                        debug_assert_eq!(
                            workspace_names.keys().len(),
                            workspace_names.values().len()
                        );
                        for (path_, entry) in workspace_names
                            .keys()
                            .iter()
                            .zip(workspace_names.values().iter())
                        {
                            let child_path: &[u8] = if bun_paths::is_absolute(path_) {
                                child_cwd
                            } else {
                                resolve_path::relative_normalized::<platform::Auto, true>(
                                    json_source.path.name.dir,
                                    child_cwd,
                                )
                            };

                            #[cfg(windows)]
                            let maybe_workspace_path = {
                                parent_path_buf[..child_path.len()].copy_from_slice(child_path);
                                resolve_path::dangerously_convert_path_to_posix_in_place::<u8>(
                                    &mut parent_path_buf[..child_path.len()],
                                );
                                &parent_path_buf[..child_path.len()]
                            };
                            #[cfg(not(windows))]
                            let maybe_workspace_path = child_path;

                            if strings::eql_long(maybe_workspace_path, path_, true) {
                                // Zig: `fs.top_level_dir = try allocator.dupeZ(u8, parent)`.
                                // Intern via the resolver's DirnameStore so the slice is
                                // process-lifetime (`set_top_level_dir` requires `'static`).
                                fs.set_top_level_dir(fs.dirname_store().append(parent)?);
                                let _ = child_json.close();
                                // Zig sets `found = true` here so the deferred close is
                                // skipped; defuse the guard to the same effect. On the
                                // Windows `seekTo` error path Zig also leaves the file
                                // open (defer sees `found == true`), which `into_inner`
                                // before `seek_to(0)?` preserves.
                                let json_file = scopeguard::ScopeGuard::into_inner(json_file_guard);
                                #[cfg(windows)]
                                {
                                    json_file.seek_to(0)?;
                                }
                                workspace_name_hash =
                                    Some(Semver::string::Builder::string_hash(&entry.name));
                                break 'root_package_json_file json_file;
                            }
                        }

                        break;
                    }

                    this_cwd = parent;
                }
            }
        }

        // Zig: `fs.top_level_dir = try allocator.dupeZ(u8, child_cwd)`.
        // Intern via DirnameStore so the slice is process-lifetime.
        fs.set_top_level_dir(fs.dirname_store().append(child_cwd)?);
        break 'root_package_json_file child_json;
    };

    // Zig: `try bun.sys.chdir(fs.top_level_dir, fs.top_level_dir).unwrap()` —
    // `bun_sys::chdir` takes a single `&ZStr` in the Rust port.
    let top_level_dir_z = ZBox::from_bytes(fs.top_level_dir());
    bun_sys::chdir(&top_level_dir_z)?;
    // Zig: `try bun.cli.Arguments.loadConfig(ctx.allocator, cli.config, ctx, .InstallCommand);`
    // (PackageManager.zig:801). `loadConfig` was moved down into `bun_bunfig`
    // (MOVE_DOWN b0) so install can call it directly — no fn-pointer hook.
    // (`::`-qualified because `crate::bun_bunfig` is a legacy local shim mod.)
    ::bun_bunfig::arguments::load_config(
        bun_options_types::command_tag::Tag::InstallCommand,
        cli.config.as_deref(),
        ctx,
    )?;
    // SAFETY: main-thread global
    unsafe {
        let tld = fs.top_level_dir();
        let cwd = &mut *CWD_BUF.get();
        cwd[..tld.len()].copy_from_slice(tld);
        cwd[tld.len()] = 0;
        // Zig: `fs.top_level_dir = cwd_buf[0..len :0]` (PackageManager.zig:776).
        // Route through the FsVTable setter so the resolver's cached cwd is
        // rebound to the process-lifetime CWD_BUF (it was a transient slice
        // until now). The slice excludes the NUL — `top_level_dir` is `[]u8`.
        // PathBuffer is repr(transparent) over [u8; N], so the raw cast is sound.
        fs.set_top_level_dir(bun_core::ffi::slice(CWD_BUF.get().cast::<u8>(), tld.len()));
        // Zig: `bun.getFdPathZ(file, &buf)` — bun_sys exposes the non-Z form;
        // append the NUL ourselves so the static `&ZStr` invariant holds.
        let root_buf = &mut *ROOT_PACKAGE_JSON_PATH_BUF.get();
        let p = bun_sys::get_fd_path(root_package_json_file.handle, root_buf)?;
        let plen = p.len();
        root_buf[plen] = 0;
        ROOT_PACKAGE_JSON_PATH.write(ZStr::from_raw(root_buf.as_ptr(), plen));
    }

    // Zig: `try fs.fs.readDirectory(fs.top_level_dir, null, 0, true)`
    // (PackageManager.zig:779). Returns the resolver's BSSMap-owned
    // `*EntriesOption` slot.
    let entries_option = match fs.read_directory(fs.top_level_dir(), 0, true)? {
        fs::EntriesOption::Entries(e) => {
            // SAFETY: the BSSMap singleton owns `*e` for the process
            // lifetime, and `init()` runs single-threaded before any other
            // access — sole exclusive borrow is sound.
            unsafe { &mut *std::ptr::from_mut::<fs::DirEntry>(*e) }
        }
        fs::EntriesOption::Err(e) => return Err(e.canonical_error),
    };

    // SAFETY: `init()` runs once on the main thread before any other access to the singleton.
    // `dot_env::Loader<'a>` borrows `&'a mut Map`, so the pair is self-referential; allocate
    // both into process-lifetime statics (same allocate-then-fill pattern as `holder::RAW_PTR`)
    // instead of `Box::leak`. Zig: `ctx.allocator.create(dot_env::Map)` + `create(dot_env::Loader)`.
    let env: &mut dot_env::Loader = unsafe {
        let map_ptr =
            std::alloc::alloc(core::alloc::Layout::new::<dot_env::Map>()).cast::<dot_env::Map>();
        if map_ptr.is_null() {
            bun_alloc::out_of_memory();
        }
        core::ptr::write(map_ptr, dot_env::Map::init());
        holder::ENV_MAP.store(map_ptr);

        let loader_ptr = std::alloc::alloc(core::alloc::Layout::new::<dot_env::Loader<'static>>())
            .cast::<dot_env::Loader<'static>>();
        if loader_ptr.is_null() {
            bun_alloc::out_of_memory();
        }
        core::ptr::write(loader_ptr, dot_env::Loader::init(&mut *map_ptr));
        holder::ENV_LOADER.store(loader_ptr);
        &mut *loader_ptr
    };

    env.load_process()?;
    // Zig: `try env.load(entries_option.entries, &[_][]u8{}, .production, false)`
    // (PackageManager.zig:794). Reborrow the BSSMap-owned `*DirEntry` for the
    // call; `env.load` only reads it (`hasComptimeQuery` lookups for `.env*`).
    // SAFETY: see `entries_option` above — single-threaded init, BSSMap-owned.
    env.load(
        unsafe { &mut *std::ptr::from_mut::<fs::DirEntry>(entries_option) },
        &[],
        dot_env::DotEnvFileSuffix::Production,
        false,
    )?;

    initialize_store();

    if let Some(data_dir) = bun_core::env_var::XDG_CONFIG_HOME
        .get()
        .or_else(|| bun_core::env_var::HOME.get())
    {
        let mut buf = PathBuffer::uninit();
        let parts = [b"./.npmrc" as &[u8]];

        let install_ref = ctx.install.get_or_insert_with(|| {
            // `Api::BunInstall` derives `Default` (all fields `None`/empty), matching
            // Zig's `std.mem.zeroes(Api.BunInstall)`. Own via `Box` — never `Box::leak`.
            Box::new(Api::BunInstall::default())
        });
        let npmrc_local = ZBox::from_bytes(b".npmrc");
        ini::load_npmrc_config(
            &mut **install_ref,
            env,
            true,
            &[
                resolve_path::join_abs_string_buf_z::<platform::Auto>(data_dir, &mut buf, &parts),
                &*npmrc_local,
            ],
        );
    } else {
        let install_ref = ctx.install.get_or_insert_with(|| {
            // `Api::BunInstall` derives `Default` (all fields `None`/empty), matching
            // Zig's `std.mem.zeroes(Api.BunInstall)`. Own via `Box` — never `Box::leak`.
            Box::new(Api::BunInstall::default())
        });
        let npmrc_local = ZBox::from_bytes(b".npmrc");
        ini::load_npmrc_config(&mut **install_ref, env, true, &[&*npmrc_local]);
    }
    let cpu_count: u32 = u32::from(bun_core::get_thread_count());
    // Captured before `cli` is moved into `options.load(Some(cli), ...)` below.
    let cli_network_concurrency = cli.network_concurrency;

    let options = Options {
        global: cli.global,
        max_concurrent_lifecycle_scripts: cli
            .concurrent_scripts
            .unwrap_or((cpu_count * 2) as usize),
        ..Default::default()
    };

    if env.get(b"BUN_INSTALL_VERBOSE").is_some() {
        PackageManager::set_verbose_install(true);
    }

    if env.get(b"BUN_FEATURE_FLAG_FORCE_WAITER_THREAD").is_some() {
        WaiterThread::set_should_use_waiter_thread();
    }

    if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_FORCE_WINDOWS_JUNCTIONS
        .get()
        .unwrap_or(false)
    {
        bun_sys::WindowsSymlinkOptions::set_has_failed_to_create_symlink(true);
    }

    // SAFETY: main-thread init
    if PackageManager::verbose_install() {
        Output::pretty_errorln(format_args!(
            "Cache Dir: {}",
            bstr::BStr::new(&options.cache_directory),
        ));
        Output::flush();
    }

    drop(workspace_names); // workspace_names.map.deinit()

    allocate_package_manager();
    let manager_ptr: *mut PackageManager = get();
    // var progress = Progress{};
    // var node = progress.start(name: []const u8, estimated_total_items: usize)
    // SAFETY: manager_ptr points to uninitialized memory from allocate_package_manager();
    // we fully initialize it here field-by-field via `addr_of_mut!((*p).field).write(..)`.
    //
    // PERF NOTE — do NOT build `PackageManager` by value and `ptr::write` it.
    // Rust has no result-location semantics, so a struct literal first
    // materializes on the stack, and `PackageManager` embeds two
    // `HiveArrayFallback` pools inline (`NetworkTask` × 128 ≈ 395 KB,
    // `Task` × 64 ≈ 39 KB). The by-value form was measured at a 911 KB stack
    // frame (objdump: `subq $0xde000,%r11` probe loop, ≈220 page faults) plus
    // a ≈443 KB memcpy into the singleton. Zig's `manager.* = .{...}` writes
    // fields directly to the heap (RLS); per-field placement mirrors that and
    // keeps the frame under 16 KB.
    unsafe {
        let p = manager_ptr;
        macro_rules! wr {
            ($field:ident, $val:expr) => {
                core::ptr::addr_of_mut!((*p).$field).write($val)
            };
        }
        // The two large pools: in-place init that only zeros the 256 B
        // occupancy bitset and leaves `[MaybeUninit<T>; N]` untouched — no
        // stack temporary, no memcpy.
        PreallocatedNetworkTasks::init_in_place(core::ptr::addr_of_mut!(
            (*p).preallocated_network_tasks
        ));
        PreallocatedTaskStore::init_in_place(core::ptr::addr_of_mut!(
            (*p).preallocated_resolve_tasks
        ));

        wr!(cache_directory_, None);
        wr!(cache_directory_path, ZBox::from_bytes(b"")); // TODO(port): default ""
        wr!(options, options);
        wr!(
            active_lifecycle_scripts,
            crate::lifecycle_script_runner::List {
                root: core::ptr::null_mut(),
                // `lifecycle_script_runner::List`'s heap comparator never
                // dereferences its Zig `*PackageManager` context arg, so the
                // Rust port models it as a ZST (`StartedAtCtx`) instead of
                // threading a back-pointer.
                context: crate::lifecycle_script_runner::StartedAtCtx,
            }
        );
        wr!(network_task_fifo, NetworkQueue::init());
        wr!(patch_task_fifo, PatchTaskFifo::init());
        wr!(log, ctx.log);
        wr!(root_dir, entries_option);
        wr!(ast_arena, bun_alloc::Arena::new());
        // PORT NOTE: reborrow `&mut *env` so the local stays usable for
        // the post-construction `BUN_MANIFEST_CACHE` / `options.load`
        // reads (Zig PackageManager.zig:910 keeps using `env` after
        // storing it in the struct). `BackRef` stores a raw pointer —
        // ending the reborrow here does not alias the later uses.
        wr!(env, Some(bun_ptr::BackRef::new_mut(&mut *env)));
        wr!(cpu_count, cpu_count);
        wr!(
            thread_pool,
            ThreadPool::init(thread_pool::Config {
                max_threads: cpu_count,
                ..Default::default()
            })
        );
        wr!(resolve_tasks, ResolveTaskQueue::default());
        // Zig: `.lockfile = undefined` (uninit `*Lockfile`), then
        // `manager.lockfile = try allocator.create(Lockfile)` immediately after the
        // struct literal. `Lockfile` contains `HashMap`/`Vec`/`NonNull` fields, so a
        // zero-bit pattern is UB; allocate the real (empty) lockfile here directly.
        // `Lockfile::default()` ≡ `Lockfile::init_empty()`.
        wr!(lockfile, Box::new(Lockfile::default()));
        wr!(root_package_json_file, root_package_json_file);
        // .progress
        wr!(event_loop, AnyEventLoop::init());
        wr!(
            original_package_json_path,
            ZBox::from_vec_with_nul(original_package_json_path_buf)
        );
        // TODO(port): owned [:0]const u8 conversion
        wr!(workspace_package_json_cache, workspace_package_json_cache);
        wr!(workspace_name_hash, workspace_name_hash);
        wr!(subcommand, subcommand);
        wr!(
            root_package_json_name_at_time_of_init,
            root_package_json_name_at_time_of_init
        );

        // remaining defaults:
        wr!(timestamp_for_manifest_cache_control, 0);
        wr!(extracted_count, 0);
        wr!(default_features, Features::default());
        wr!(summary, Default::default());
        wr!(progress, Progress::default());
        wr!(downloads_node, None);
        wr!(scripts_node, None);
        wr!(progress_name_buf, [0; 768]);
        wr!(progress_name_buf_dynamic, Vec::new());
        wr!(track_installed_bin, TrackInstalledBin::None);
        wr!(root_progress_node, core::ptr::null_mut());
        wr!(to_update, false);
        wr!(update_requests, Box::default());
        wr!(root_package_id, RootPackageId::default());
        wr!(task_batch, thread_pool::Batch::default());
        wr!(task_queue, TaskDependencyQueue::default());
        wr!(manifests, PackageManifestMap::default());
        wr!(folders, Default::default());
        wr!(git_repositories, RepositoryMap::default());
        wr!(network_dedupe_map, Default::default());
        wr!(async_network_task_queue, AsyncNetworkTaskQueue::default());
        wr!(network_tarball_batch, thread_pool::Batch::default());
        wr!(network_resolve_batch, thread_pool::Batch::default());
        wr!(patch_apply_batch, thread_pool::Batch::default());
        wr!(patch_calc_hash_batch, thread_pool::Batch::default());
        wr!(patch_task_queue, PatchTaskQueue::default());
        wr!(pending_pre_calc_hashes, AtomicU32::new(0));
        wr!(pending_tasks, AtomicU32::new(0));
        wr!(total_tasks, 0);
        wr!(lifecycle_script_time_log, LifecycleScriptTimeLog::default());
        wr!(pending_lifecycle_script_tasks, AtomicU32::new(0));
        wr!(finished_installing, AtomicBool::new(false));
        wr!(total_scripts, 0);
        wr!(root_lifecycle_scripts, None);
        wr!(node_gyp_tempdir_name, Box::default());
        wr!(env_configure, None);
        wr!(preinstall_state, Vec::new());
        wr!(postinstall_optimizer, Default::default());
        wr!(global_link_dir, None);
        wr!(global_dir, None);
        wr!(global_link_dir_path, Box::default());
        wr!(on_wake, WakeHandler::default());
        wr!(
            ci_mode,
            LazyBool::new(PackageManager::compute_is_continuous_integration)
        );
        wr!(
            peer_dependencies,
            LinearFifo::<DependencyID, DynamicBuffer<DependencyID>>::init()
        );
        wr!(known_npm_aliases, NpmAliasMap::default());
        wr!(trusted_deps_to_add_to_package_json, Vec::new());
        wr!(any_failed_to_install, false);
        wr!(updating_packages, StringArrayHashMap::default());
        wr!(patched_dependencies_to_remove, ArrayHashMap::default());
        wr!(last_reported_slow_lifecycle_script_at, 0);
        wr!(cached_tick_for_slow_lifecycle_script_logging, 0);
    }
    // The per-field placement above fully initialized the singleton; the
    // `&mut PackageManager` validity invariant now holds (Zig PackageManager.zig:850
    // onward). We do NOT bind a long-lived `&'static mut` here: `http::HTTPThread::init`
    // below spawns workers that deref `get()` concurrently, which would alias such a
    // borrow under Stacked Borrows. Instead each statement forms its own narrowly-scoped
    // reborrow via `unsafe { &mut *manager_ptr }`, dropped before the next raw-ptr use.
    {
        // SAFETY: singleton fully initialized; main thread, no workers yet.
        let manager = unsafe { &mut *manager_ptr };
        // Zig: `manager.event_loop.loop().internal_loop_data.setParentEventLoop(
        //     jsc.EventLoopHandle.init(&manager.event_loop))` (PackageManager.zig:883).
        // `r#loop()` returns the process-global `*mut uws::Loop`; build the
        // handle from `&mut manager.event_loop` and write it back as the loop's
        // parent so uSockets timers / lifecycle subprocess waiters can find the
        // mini event loop on tick.
        let uws_loop = manager.event_loop.r#loop();
        EventLoopHandle::from_any(&mut manager.event_loop).set_as_parent_of(uws_loop);
    }
    // PORT NOTE: Zig `manager.lockfile = try ctx.allocator.create(Lockfile)` —
    // folded into the struct literal above (`Box::new(Lockfile::default())`) so
    // we never construct a zeroed `Lockfile` only to drop it.

    {
        // make sure folder packages can find the root package without creating a new one
        // Zig: `var normalized: AbsPath(.{ .sep = .posix }) = .from(root_package_json_path)`
        // (PackageManager.zig:888). `AbsPath(.{.sep=.posix}).from` posix-normalizes the
        // separators before hashing; `FolderResolution.hash` is always fed `/`-separated
        // bytes by every resolver-side caller. On Windows `getFdPath` yields `\`, so
        // hashing the raw bytes would seed a key the resolver never looks up — copy into
        // a stack buffer and convert separators in place.
        // SAFETY: ROOT_PACKAGE_JSON_PATH set above on the main thread.
        let raw: &[u8] = unsafe { ROOT_PACKAGE_JSON_PATH.read() }.as_ref();
        let mut buf = PathBuffer::uninit();
        buf[..raw.len()].copy_from_slice(raw);
        let normalized = &mut buf[..raw.len()];
        resolve_path::dangerously_convert_path_to_posix_in_place::<u8>(normalized);
        // SAFETY: singleton fully initialized; main thread, no workers yet.
        unsafe { &mut *manager_ptr }.folders.put(
            crate::resolvers::folder_resolver::hash(normalized),
            crate::resolvers::folder_resolver::FolderResolution::PackageId(0),
        )?;
        // normalized.deinit() → Drop (stack buffer)
    }

    // SAFETY: singleton fully initialized; main thread, no workers yet.
    // Zig: `jsc.MiniEventLoop.global = &manager.event_loop.mini` — set the
    // thread-local global to point at the embedded mini loop. The Rust port
    // stores it in `bun_event_loop::mini_event_loop::GLOBAL`.
    {
        let evl = unsafe { &mut (*manager_ptr).event_loop };
        if let AnyEventLoop::Mini(mini) = evl {
            let mini_ptr: *mut MiniEventLoop<'static> = mini;
            // Zig spec (PackageManager.zig:893) sets ONLY `MiniEventLoop.global`,
            // NOT `globalInitialized`. The distinction is load-bearing: a later
            // `initGlobal(env, top_level_dir)` (e.g. from `bun pm pack` /
            // `pm version` lifecycle scripts → RunCommand::run_package_script_*)
            // checks `globalInitialized` and, when false, allocates a FRESH mini
            // with env/top_level_dir/uv-loop fully wired, then that becomes the
            // global. If we flip `GLOBAL_INITIALIZED` here, that call returns
            // *this* embedded mini instead — which was constructed without env,
            // without top_level_dir, and (on Windows) without going through
            // `init_global`'s uv-loop setup. The shell's IOWriter then opens
            // stdout/stderr against an under-initialised loop → EBADF (exit 9).
            mini_event_loop::GLOBAL.with(|g| g.set(mini_ptr));
        }
    }
    {
        // SAFETY: as above; scoped reborrow for the options/manifest-cache block.
        let manager = unsafe { &mut *manager_ptr };
        if !manager.options.enable.cache() {
            manager.options.enable.set_manifest_cache(false);
            manager.options.enable.set_manifest_cache_control(false);
        }

        if let Some(manifest_cache) = env.get(b"BUN_MANIFEST_CACHE") {
            if manifest_cache == b"1" {
                manager.options.enable.set_manifest_cache(true);
                manager.options.enable.set_manifest_cache_control(false);
            } else if manifest_cache == b"2" {
                manager.options.enable.set_manifest_cache(true);
                manager.options.enable.set_manifest_cache_control(true);
            } else {
                manager.options.enable.set_manifest_cache(false);
                manager.options.enable.set_manifest_cache_control(false);
            }
        }

        manager
            .options
            // SAFETY: ctx.log is the process-lifetime CLI log set by
            // create_context_data(); single-threaded init region.
            .load(
                unsafe { &mut *ctx.log },
                env,
                Some(cli),
                ctx.install.as_deref(),
                subcommand,
            )?;

        if let Some(config) = ctx.install.as_deref_mut() {
            if let Some(p) = config.public_hoist_pattern.take() {
                manager.options.public_hoist_pattern = Some(p);
            }
            if let Some(p) = config.hoist_pattern.take() {
                manager.options.hoist_pattern = Some(p);
            }
        }
    }

    // Singleton fully initialized; main thread, no workers yet. Wrapped once as
    // `ParentRef` so the two read-only `options` projections below go through
    // safe `Deref` instead of per-site raw deref. Safe `From<NonNull>`
    // construction — `manager_ptr` is the live singleton address.
    let mgr_ref = bun_ptr::ParentRef::<PackageManager>::from(
        NonNull::new(manager_ptr).expect("manager singleton non-null"),
    );
    let mut ca: Vec<ZBox> = Vec::new();
    {
        let options = &mgr_ref.options;
        if !options.ca.is_empty() {
            ca = Vec::with_capacity(options.ca.len());
            debug_assert_eq!(ca.capacity(), options.ca.len());
            for s in options.ca.iter() {
                ca.push(ZBox::from_bytes(s));
            }
        }
    }

    let mut abs_ca_file_name: ZBox = ZBox::from_bytes(b"");
    {
        let options = &mgr_ref.options;
        if !options.ca_file_name.is_empty() {
            // resolve with original cwd
            if bun_paths::is_absolute(&options.ca_file_name) {
                abs_ca_file_name = ZBox::from_bytes(&options.ca_file_name);
            } else {
                let mut path_buf = PathBuffer::uninit();
                abs_ca_file_name =
                    ZBox::from_bytes(resolve_path::join_abs_string_buf::<platform::Auto>(
                        &original_cwd_clone,
                        &mut path_buf,
                        &[&options.ca_file_name],
                    ));
            }
        }
    }

    http::async_http::MAX_SIMULTANEOUS_REQUESTS.store(
        'brk: {
            if let Some(network_concurrency) = cli_network_concurrency {
                break 'brk network_concurrency.max(1) as usize;
            }

            // If any HTTP proxy is set, use a diferent limit
            // (env_loader.zig:167 hasHTTPProxy — PackageManager.zig open-codes this)
            if env.has_http_proxy() {
                break 'brk DEFAULT_MAX_SIMULTANEOUS_REQUESTS_FOR_BUN_INSTALL_FOR_PROXIES;
            }

            DEFAULT_MAX_SIMULTANEOUS_REQUESTS_FOR_BUN_INSTALL
        },
        Ordering::Relaxed, // .monotonic
    );

    // `InitOpts.ca: Vec<*const c_void>` (erased `[*:0]const u8`). The HTTP
    // thread reads these asynchronously after `init` returns, so park the
    // owning `ZBox`es in `holder::CA` for process lifetime (Zig: `dupeZ`,
    // never freed) and project the pointers from there.
    let ca_ptrs: Vec<*const c_void> = if ca.is_empty() {
        Vec::new()
    } else {
        let _ = holder::CA.set(ca);
        holder::CA
            .get()
            .map(|v| v.iter().map(|z| z.as_ptr().cast::<c_void>()).collect())
            .unwrap_or_default()
    };
    // `InitOpts.abs_ca_file_name: &'static [u8]` — process-lifetime config
    // string (Zig: `allocator.dupeZ` into a leaked singleton field). Park it in
    // `holder::ABS_CA_FILE_NAME: OnceLock<Box<[u8]>>` per PORTING.md §Forbidden
    // (never `Box::leak` to mint `&'static`). `init()` runs once on
    // the main thread, so `.set()` cannot race; ignore the already-set case for
    // hot-reload re-entry (the existing CA path stays valid for the process).
    let abs_ca_file_name_static: &'static [u8] = if abs_ca_file_name.is_empty() {
        b""
    } else {
        let _ =
            holder::ABS_CA_FILE_NAME.set(abs_ca_file_name.into_vec_with_nul().into_boxed_slice());
        holder::ABS_CA_FILE_NAME.get().map(|b| &**b).unwrap_or(b"")
    };
    http::http_thread::init(&http::http_thread::InitOpts {
        ca: ca_ptrs,
        abs_ca_file_name: abs_ca_file_name_static,
        on_init_error: http_thread_on_init_error,
        ..Default::default()
    });

    let timestamp_for_manifest_cache_control: u32 = 'brk: {
        if cfg!(debug_assertions) {
            // TODO(port): bun.Environment.allow_assert
            if let Some(cache_control) = env.get(b"BUN_CONFIG_MANIFEST_CACHE_CONTROL_TIMESTAMP") {
                // env-var bytes are not guaranteed UTF-8; parse on bytes directly (Zig: std.fmt.parseInt)
                if let Ok(int) = bun_core::parse_int::<u32>(cache_control, 10) {
                    break 'brk int;
                }
            }
        }

        (u64::try_from(bun_core::time::timestamp().max(0)).expect("int cast")) as u32 // @truncate
    };
    // SAFETY: singleton fully initialized. The HTTP thread is now live and may
    // project `&(*get()).field` concurrently, but `timestamp_for_manifest_cache_control`
    // is main-thread-only state; this raw-pointer place write does not materialize a
    // `&mut PackageManager` that could alias worker projections.
    unsafe {
        (*manager_ptr).timestamp_for_manifest_cache_control = timestamp_for_manifest_cache_control;
    }

    // SAFETY: `manager_ptr` is `holder::RAW_PTR`, written once by
    // `allocate_package_manager()` above and fully initialized via `ptr::write`
    // earlier in this function. `init()` is called exactly once per process on
    // the CLI dispatch thread; the returned `&'static mut` is the sole
    // first-class reference handed out (worker threads project fields via the
    // raw [`get`] accessor, never via this reference).
    Ok((unsafe { &mut *manager_ptr }, original_cwd_clone))
}

pub fn init_with_runtime(
    log: &mut bun_ast::Log,
    // Spec PackageManager.zig:983 `bun_install: ?*Api.BunInstall` — used read-only
    // (PackageManagerOptions.zig:load lines 224-380 only ever reads `config.*`).
    // Upstream storage is `Option<&api::BunInstall>` (options.rs) / `*const ()`
    // (resolver opts); taking `&mut` here would force a const→mut provenance
    // launder at the resolver call site.
    bun_install: Option<&Api::BunInstall>,
    cli: CommandLineArguments,
    env: &mut dot_env::Loader<'static>,
) -> *mut PackageManager {
    bun_core::run_once! {{
        init_with_runtime_once(log, bun_install, cli, env);
    }}
    get()
}

pub fn init_with_runtime_once(
    log: &mut bun_ast::Log,
    bun_install: Option<&Api::BunInstall>,
    cli: CommandLineArguments,
    env: &mut dot_env::Loader<'static>,
) {
    if env.get(b"BUN_INSTALL_VERBOSE").is_some() {
        PackageManager::set_verbose_install(true);
    }

    let cpu_count: u32 = u32::from(bun_core::get_thread_count());
    allocate_package_manager();
    // SAFETY: holder::RAW_PTR was just set by allocate_package_manager() to a
    // freshly allocated, *uninitialized* PackageManager. Do NOT call `get()` /
    // form `&mut PackageManager` yet — the struct contains niche-bearing fields
    // (`Box`, `Vec`, `Option<NonNull<_>>`, `ZStr`) for which the uninit bit
    // pattern is an invalid value, so materializing a reference is instant UB.
    // Work through the raw pointer until `ptr::write` below has fully
    // initialized it (Zig PackageManager.zig:1013 `const manager = get()`
    // yields a raw `*PackageManager` with no validity invariant).
    let manager_ptr: *mut PackageManager =
        holder::RAW_PTR.load(core::sync::atomic::Ordering::Acquire);
    // Zig: `FileSystem.instance.fs.readDirectory(top_level_dir, null, 0, true)`
    // (PackageManager.zig:1014). Returns the resolver's BSSMap-owned
    // `*EntriesOption` slot. On error Zig calls `Output.err` then `@panic`
    // (lines 1019-1022) — match that: this is the runtime auto-install path
    // where the resolver already opened `top_level_dir`, so failure is a
    // programmer-error / fs-disappeared edge.
    let fs_instance = FileSystem::instance();
    let root_dir = match fs_instance
        .read_directory(fs_instance.top_level_dir(), 0, true)
        .map(|r| &mut *r)
    {
        // SAFETY: the BSSMap singleton owns `*e` for the process lifetime,
        // and runtime init runs once on the main thread before any other access.
        Ok(fs::EntriesOption::Entries(e)) => unsafe {
            &mut *std::ptr::from_mut::<fs::DirEntry>(*e)
        },
        Ok(fs::EntriesOption::Err(e)) => {
            Output::err(
                e.canonical_error,
                "failed to read root directory: '{s}'",
                (bstr::BStr::new(fs_instance.top_level_dir()),),
            );
            panic!("Failed to initialize package manager");
        }
        Err(err) => {
            Output::err(
                err,
                "failed to read root directory: '{s}'",
                (bstr::BStr::new(fs_instance.top_level_dir()),),
            );
            panic!("Failed to initialize package manager");
        }
    };

    // var progress = Progress{};
    // var node = progress.start(name: []const u8, estimated_total_items: usize)
    let top_level_dir_no_trailing_slash =
        strings::without_trailing_slash(FileSystem::instance().top_level_dir());
    let mut original_package_json_path =
        vec![0u8; top_level_dir_no_trailing_slash.len() + "/package.json".len() + 1];
    original_package_json_path[..top_level_dir_no_trailing_slash.len()]
        .copy_from_slice(top_level_dir_no_trailing_slash);
    original_package_json_path[top_level_dir_no_trailing_slash.len()
        ..top_level_dir_no_trailing_slash.len() + b"/package.json".len()]
        .copy_from_slice(b"/package.json");
    // last byte already 0 (sentinel)

    // SAFETY: manager_ptr points to uninitialized memory; fully initialize
    // field-by-field via `addr_of_mut!((*p).field).write(..)`. See the PERF
    // NOTE in `init()` above — building `PackageManager` by value and
    // `ptr::write`ing it materialized a ≈911 KB stack frame because of the
    // two inline `HiveArrayFallback` pools; per-field placement mirrors Zig's
    // result-location semantics and writes directly to the heap singleton.
    unsafe {
        let p = manager_ptr;
        macro_rules! wr {
            ($field:ident, $val:expr) => {
                core::ptr::addr_of_mut!((*p).$field).write($val)
            };
        }
        // The two large pools: in-place init that only zeros the 256 B
        // occupancy bitset and leaves `[MaybeUninit<T>; N]` untouched.
        PreallocatedNetworkTasks::init_in_place(core::ptr::addr_of_mut!(
            (*p).preallocated_network_tasks
        ));
        PreallocatedTaskStore::init_in_place(core::ptr::addr_of_mut!(
            (*p).preallocated_resolve_tasks
        ));

        wr!(cache_directory_, None);
        wr!(cache_directory_path, ZBox::from_bytes(b"")); // TODO(port): default
        wr!(
            options,
            Options {
                max_concurrent_lifecycle_scripts: cli
                    .concurrent_scripts
                    .unwrap_or((cpu_count * 2) as usize),
                ..Default::default()
            }
        );
        wr!(
            active_lifecycle_scripts,
            crate::lifecycle_script_runner::List {
                root: core::ptr::null_mut(),
                context: crate::lifecycle_script_runner::StartedAtCtx,
            }
        );
        wr!(network_task_fifo, NetworkQueue::init());
        wr!(log, std::ptr::from_mut(log));
        wr!(root_dir, root_dir);
        wr!(ast_arena, bun_alloc::Arena::new());
        // PORT NOTE: reborrow `&mut *env` so the local stays usable for
        // the post-construction `BUN_MANIFEST_CACHE` / `options.load`
        // reads (Zig PackageManager.zig:1072 keeps using `env` after
        // storing it in the struct). `BackRef` stores a raw pointer —
        // ending the reborrow here does not alias the later uses.
        wr!(env, Some(bun_ptr::BackRef::new_mut(&mut *env)));
        wr!(cpu_count, cpu_count);
        wr!(
            thread_pool,
            ThreadPool::init(thread_pool::Config {
                max_threads: cpu_count,
                ..Default::default()
            })
        );
        // Zig: `.lockfile = undefined` then `manager.lockfile = try allocator.create(Lockfile)`
        // immediately after. `Lockfile` holds `HashMap`/`Vec`/`NonNull` (zero-bit pattern is
        // UB), so allocate the real empty lockfile here directly instead of a zeroed placeholder.
        wr!(lockfile, Box::new(Lockfile::default()));
        // Zig leaves `.root_package_json_file = undefined` (never read in the runtime
        // path). Use the explicit invalid-fd sentinel rather than `mem::zeroed()` —
        // on posix `Fd(0)` is stdin, not the invalid marker.
        wr!(root_package_json_file, bun_sys::File::from_fd(Fd::invalid()));
        // erased *mut () set by tier-6; `js_current()` resolves the per-thread JS
        // event loop via `bun_io::__bun_get_vm_ctx` (link-time, definer in bun_runtime).
        wr!(event_loop, AnyEventLoop::js_current());
        wr!(
            original_package_json_path,
            ZBox::from_vec_with_nul(original_package_json_path)
        );
        wr!(subcommand, Subcommand::Install);

        // remaining defaults:
        wr!(resolve_tasks, ResolveTaskQueue::default());
        wr!(timestamp_for_manifest_cache_control, 0);
        wr!(extracted_count, 0);
        wr!(default_features, Features::default());
        wr!(summary, Default::default());
        wr!(progress, Progress::default());
        wr!(downloads_node, None);
        wr!(scripts_node, None);
        wr!(progress_name_buf, [0; 768]);
        wr!(progress_name_buf_dynamic, Vec::new());
        wr!(track_installed_bin, TrackInstalledBin::None);
        wr!(root_progress_node, core::ptr::null_mut());
        wr!(to_update, false);
        wr!(update_requests, Box::default());
        wr!(root_package_json_name_at_time_of_init, Box::default());
        wr!(root_package_id, RootPackageId::default());
        wr!(task_batch, thread_pool::Batch::default());
        wr!(task_queue, TaskDependencyQueue::default());
        wr!(manifests, PackageManifestMap::default());
        wr!(folders, Default::default());
        wr!(git_repositories, RepositoryMap::default());
        wr!(network_dedupe_map, Default::default());
        wr!(async_network_task_queue, AsyncNetworkTaskQueue::default());
        wr!(network_tarball_batch, thread_pool::Batch::default());
        wr!(network_resolve_batch, thread_pool::Batch::default());
        wr!(patch_apply_batch, thread_pool::Batch::default());
        wr!(patch_calc_hash_batch, thread_pool::Batch::default());
        wr!(patch_task_fifo, PatchTaskFifo::init());
        wr!(patch_task_queue, PatchTaskQueue::default());
        wr!(pending_pre_calc_hashes, AtomicU32::new(0));
        wr!(pending_tasks, AtomicU32::new(0));
        wr!(total_tasks, 0);
        wr!(lifecycle_script_time_log, LifecycleScriptTimeLog::default());
        wr!(pending_lifecycle_script_tasks, AtomicU32::new(0));
        wr!(finished_installing, AtomicBool::new(false));
        wr!(total_scripts, 0);
        wr!(root_lifecycle_scripts, None);
        wr!(node_gyp_tempdir_name, Box::default());
        wr!(env_configure, None);
        wr!(preinstall_state, Vec::new());
        wr!(postinstall_optimizer, Default::default());
        wr!(global_link_dir, None);
        wr!(global_dir, None);
        wr!(global_link_dir_path, Box::default());
        wr!(on_wake, WakeHandler::default());
        wr!(
            ci_mode,
            LazyBool::new(PackageManager::compute_is_continuous_integration)
        );
        wr!(
            peer_dependencies,
            LinearFifo::<DependencyID, DynamicBuffer<DependencyID>>::init()
        );
        wr!(known_npm_aliases, NpmAliasMap::default());
        wr!(trusted_deps_to_add_to_package_json, Vec::new());
        wr!(any_failed_to_install, false);
        wr!(workspace_name_hash, None);
        wr!(
            workspace_package_json_cache,
            WorkspacePackageJSONCache::default()
        );
        wr!(updating_packages, StringArrayHashMap::default());
        wr!(patched_dependencies_to_remove, ArrayHashMap::default());
        wr!(last_reported_slow_lifecycle_script_at, 0);
        wr!(cached_tick_for_slow_lifecycle_script_logging, 0);
    }
    // SAFETY: per-field placement above fully initialized the PackageManager;
    // the `&mut PackageManager` validity invariant now holds for the post-init
    // body (Zig PackageManager.zig:1031 onward).
    let manager = unsafe { &mut *manager_ptr };
    // PORT NOTE: Zig `manager.lockfile = try allocator.create(Lockfile)` —
    // folded into the struct literal above (`Box::new(Lockfile::default())`).

    if Output::enable_ansi_colors_stderr() {
        manager.progress = Progress::default();
        manager.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        // `Progress::start` returns `&mut Node` borrowing `manager.progress.root`.
        // Coerce to a raw pointer immediately so the borrow doesn't outlive the
        // statement; `root_progress_node` is BORROW_FIELD into `self.progress`.
        let node: *mut ProgressNode = manager.progress.start(b"", 0);
        manager.root_progress_node = node;
    } else {
        manager.options.log_level = package_manager_options::LogLevel::DefaultNoProgress;
    }

    if !manager.options.enable.cache() {
        manager.options.enable.set_manifest_cache(false);
        manager.options.enable.set_manifest_cache_control(false);
    }

    if let Some(manifest_cache) = env.get(b"BUN_MANIFEST_CACHE") {
        if manifest_cache == b"1" {
            manager.options.enable.set_manifest_cache(true);
            manager.options.enable.set_manifest_cache_control(false);
        } else if manifest_cache == b"2" {
            manager.options.enable.set_manifest_cache(true);
            manager.options.enable.set_manifest_cache_control(true);
        } else {
            manager.options.enable.set_manifest_cache(false);
            manager.options.enable.set_manifest_cache_control(false);
        }
    }

    match manager
        .options
        .load(log, env, Some(cli), bun_install, Subcommand::Install)
    {
        Ok(()) => {}
        Err(e) => {
            // only error.OutOfMemory possible
            let _ = e;
            bun_core::out_of_memory();
        }
    }

    manager.timestamp_for_manifest_cache_control =
        ((u64::try_from(bun_core::time::timestamp().max(0)).expect("int cast")) as u32)
            // When using "bun install", we check for updates with a 300 second cache.
            // When using bun, we only do staleness checks once per day
            .saturating_sub(bun_core::time::S_PER_DAY);

    // Zig (PackageManager.zig:1111): `if (root_dir.entries.hasComptimeQuery("bun.lockb"))`
    // — gate the disk load on the cached dir listing so the runtime auto-install
    // path doesn't open()/read() a lockfile that isn't there. The Zig
    // `manager.lockfile = load.lockfile` self-assignment is a no-op in the Rust
    // shape (`load_from_cwd` mutates `*manager.lockfile` in place and returns a
    // borrow of it), so `Ok` keeps the loaded value as-is.
    // PORT NOTE: Zig calls `manager.lockfile.loadFromCwd(manager, …)` — a
    // self-aliasing receiver+argument pair Rust forbids. Split-borrow by
    // temporarily moving the boxed lockfile out so the `&mut PackageManager`
    // passed in does not alias the `&mut Lockfile` receiver.
    // PORT NOTE: `root_dir` was moved into `*manager` above (the field is
    // an unbounded `&mut DirEntry`, so the local reborrow is for `'static` and the
    // original binding is dead). Read it back through `manager.root_dir`.
    if manager.root_dir.has_comptime_query(b"bun.lockb") {
        let mut lockfile = core::mem::replace(&mut manager.lockfile, Box::new(Lockfile::default()));
        match lockfile.load_from_cwd::<true>(Some(&mut *manager), log) {
            lockfile::LoadResult::Ok(_) => {}
            _ => lockfile.init_empty(),
        }
        manager.lockfile = lockfile;
    } else {
        manager.lockfile.init_empty();
    }
}

// ported from: src/install/PackageManager.zig
