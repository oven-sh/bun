use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::cell::RefCell;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_collections::{ArrayHashMap, HashMap, HiveArray, LinearFifo, StringArrayHashMap, UnboundedQueue};
use bun_core::{err, Error, Global, LazyBool, Once, Output};
use bun_dotenv as dot_env;
use bun_fs as fs;
use bun_fs::FileSystem;
use bun_http as http;
use bun_http::AsyncHTTP;
use bun_ini as ini;
// MOVE_DOWN(b0): bun_jsc::{AnyEventLoop, MiniEventLoop, EventLoopHandle} → bun_event_loop
use bun_event_loop::{self, AnyEventLoop, EventLoopHandle, MiniEventLoop};
use bun_logger as logger;
use bun_paths::{self as path, PathBuffer, DELIMITER, SEP, SEP_STR};
use bun_progress::Progress;
use bun_schema::api as Api;
use bun_semver::{self as Semver, String as SemverString};
use bun_spawn::process::WaiterThread;
use bun_str::{strings, ZStr};
use bun_sys::{self, Fd};
use bun_threading::ThreadPool;
use bun_transpiler::{self as transpiler, Transpiler};
use bun_url::URL;

// MOVE_DOWN(b0): bun_cli::Arguments → bun_bunfig::Arguments (config loading is bunfig-tier).
use bun_bunfig::Arguments as BunArguments;
// TODO(b0): RunCommand arrives from move-in (bun_cli::RunCommand → install).
use crate::RunCommand;

// ──────────────────────────────────────────────────────────────────────────
// MOVE_DOWN(b0): bun_cli::package_manager_command::PackageManagerCommand → install
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

        Output::pretty(intro_text);
        Output::pretty(outro_text);
        Output::flush();
    }
}

// FORWARD_DECL(b0): bun_resolver::DirInfo — only stored as raw pointer in
// ScriptRunEnvironment.root_dir_info; never dereferenced in this crate.
#[repr(C)]
pub struct DirInfo {
    _opaque: [u8; 0],
}

use bun_install::{
    initialize_store, ArrayIdentityContext, Dependency, DependencyID, Features, FolderResolution,
    IdentityContext, LifecycleScriptSubprocess, NetworkTask, PackageID, PackageManifestMap,
    PackageNameAndVersionHash, PackageNameHash, PatchTask, PostinstallOptimizer, PreinstallState,
    Task, TaskCallbackContext,
};
use bun_install::lockfile::{self, Lockfile, Package};

// ──────────────────────────────────────────────────────────────────────────
// Sub-module re-exports (thin re-exports — bodies live in their own files)
// ──────────────────────────────────────────────────────────────────────────

pub use super::package_manager::command_line_arguments as command_line_arguments_mod;
pub use super::package_manager::command_line_arguments::CommandLineArguments;
pub use super::package_manager::package_manager_options::Options;
pub use super::package_manager::package_json_editor::PackageJSONEditor;
pub use super::package_manager::update_request::UpdateRequest;
pub use super::package_manager::workspace_package_json_cache::WorkspacePackageJSONCache;
pub use super::package_installer::PackageInstaller;
pub use super::package_manager::install_with_manager::install_with_manager;

pub use super::package_manager::package_manager_directories as directories;
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
use directories::attempt_to_create_package_json_and_open;

pub use super::package_manager::package_manager_enqueue as enqueue;
pub use enqueue::{
    create_extract_task_for_streaming, enqueue_dependency_list, enqueue_dependency_to_root,
    enqueue_dependency_with_main, enqueue_dependency_with_main_and_success_fn,
    enqueue_extract_npm_package, enqueue_git_checkout, enqueue_git_for_checkout,
    enqueue_network_task, enqueue_package_for_download, enqueue_parse_npm_package,
    enqueue_patch_task, enqueue_patch_task_pre, enqueue_tarball_for_download,
    enqueue_tarball_for_reading,
};

use super::package_manager::package_manager_lifecycle as lifecycle;
pub use lifecycle::{
    determine_preinstall_state, ensure_preinstall_state_list_capacity,
    find_trusted_dependencies_from_update_requests, get_preinstall_state,
    has_no_more_pending_lifecycle_scripts, load_root_lifecycle_scripts,
    report_slow_lifecycle_scripts, set_preinstall_state, sleep, spawn_package_lifecycle_scripts,
    tick_lifecycle_scripts, LifecycleScriptTimeLog,
};

use super::package_manager::package_manager_resolution as resolution;
pub use resolution::{
    assign_resolution, assign_root_resolution, format_later_version_in_cache,
    get_installed_versions_from_disk_cache, resolve_from_disk_cache, scope_for_package_name,
    verify_resolutions,
};

pub use super::package_manager::progress_strings as progress_mod;
pub use progress_mod::{
    end_progress_bar, set_node_name, start_progress_bar, start_progress_bar_if_none,
    ProgressStrings,
};

pub use super::package_manager::patch_package::{do_patch_commit, prepare_patch, PatchCommitResult};

pub use super::package_manager::process_dependency_list::{
    process_dependency_list, process_dependency_list_item, process_extracted_tarball_package,
    process_peer_dependency_list, GitResolver,
};

pub use super::package_manager::run_tasks::{
    alloc_github_url, decrement_pending_tasks, drain_dependency_list, flush_dependency_queue,
    flush_network_queue, flush_patch_task_queue, generate_network_task_for_tarball,
    get_network_task, has_created_network_task, increment_pending_tasks, is_network_task_required,
    pending_task_count, run_tasks, schedule_tasks,
};

pub use super::package_manager::update_package_json_and_install::{
    update_package_json_and_install_catch_error, update_package_json_and_install_with_manager,
};

pub use super::package_manager::populate_manifest_cache::populate_manifest_cache;

// ──────────────────────────────────────────────────────────────────────────
// Type aliases
// ──────────────────────────────────────────────────────────────────────────

pub type TaskCallbackList = Vec<TaskCallbackContext>;
type TaskDependencyQueue = HashMap<Task::Id, TaskCallbackList /* , IdentityContext<Task::Id>, 80 */>;

type PreallocatedTaskStore = HiveArray<Task, 64 /* .Fallback */>;
type PreallocatedNetworkTasks = HiveArray<NetworkTask, 128 /* .Fallback */>;
type ResolveTaskQueue = UnboundedQueue<Task /* , .next */>;

type RepositoryMap = HashMap<Task::Id, Fd /* , IdentityContext<Task::Id>, 80 */>;
type NpmAliasMap = HashMap<PackageNameHash, Dependency::Version /* , IdentityContext<u64>, 80 */>;

type NetworkQueue = LinearFifo<*mut NetworkTask, 32 /* .Static */>;
type PatchTaskFifo = LinearFifo<*mut PatchTask, 32 /* .Static */>;

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
    pub cache_directory_path: Box<ZStr>,        // TODO(port): lifetime — singleton-leaked
    pub root_dir: &'static mut fs::DirEntry,
    // allocator: dropped per §Allocators
    // TODO(port): lifetime — LIFETIMES.tsv classifies this BORROW_PARAM → `&'a mut logger::Log`
    // (struct gets `<'a>`). Kept as raw ptr because PackageManager is a leaked singleton stored
    // in a `static`; threading `<'a>` through the global holder is deferred to Phase B.
    pub log: *mut logger::Log,
    pub resolve_tasks: ResolveTaskQueue,
    pub timestamp_for_manifest_cache_control: u32,
    pub extracted_count: u32,
    pub default_features: Features,
    pub summary: lockfile::package::diff::Summary,
    pub env: Option<NonNull<dot_env::Loader>>, // UNKNOWN — mixed ownership, no deinit // TODO(port): lifetime
    pub progress: Progress,
    pub downloads_node: Option<*mut Progress::Node>, // BORROW_FIELD — points into self.progress
    pub scripts_node: Option<NonNull<Progress::Node>>, // UNKNOWN — points to caller stack-local // TODO(port): lifetime
    pub progress_name_buf: [u8; 768],
    pub progress_name_buf_dynamic: Vec<u8>,
    pub cpu_count: u32,

    pub track_installed_bin: TrackInstalledBin,

    // progress bar stuff when not stack allocated
    pub root_progress_node: *mut Progress::Node, // BORROW_FIELD — self.progress.start() returns &self.progress.root

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
    pub task_batch: ThreadPool::Batch,
    pub task_queue: TaskDependencyQueue,

    pub manifests: PackageManifestMap,
    pub folders: FolderResolution::Map,
    pub git_repositories: RepositoryMap,

    pub network_dedupe_map: NetworkTask::DedupeMap,
    pub async_network_task_queue: AsyncNetworkTaskQueue,
    pub network_tarball_batch: ThreadPool::Batch,
    pub network_resolve_batch: ThreadPool::Batch,
    pub network_task_fifo: NetworkQueue,
    pub patch_apply_batch: ThreadPool::Batch,
    pub patch_calc_hash_batch: ThreadPool::Batch,
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

    pub root_lifecycle_scripts: Option<Package::Scripts::List>,

    pub node_gyp_tempdir_name: Box<[u8]>,

    pub env_configure: Option<ScriptRunEnvironment>,

    pub lockfile: Box<Lockfile>, // OWNED

    pub options: Options,
    pub preinstall_state: Vec<PreinstallState>,
    pub postinstall_optimizer: PostinstallOptimizer::List,

    pub global_link_dir: Option<bun_sys::Dir>, // TODO(port): std.fs.Dir
    pub global_dir: Option<bun_sys::Dir>,      // TODO(port): std.fs.Dir
    pub global_link_dir_path: Box<[u8]>,

    pub on_wake: WakeHandler,
    pub ci_mode: LazyBool<fn(&mut PackageManager) -> bool>, // TODO(port): bun.LazyBool(computeIsContinuousIntegration, @This(), "ci_mode")

    pub peer_dependencies: LinearFifo<DependencyID, /* .Dynamic */ 0>, // TODO(port): LinearFifo dynamic variant

    // name hash from alias package name -> aliased package dependency version info
    pub known_npm_aliases: NpmAliasMap,

    pub event_loop: AnyEventLoop,

    // During `installPackages` we learn exactly what dependencies from --trust
    // actually have scripts to run, and we add them to this list
    pub trusted_deps_to_add_to_package_json: Vec<Box<[u8]>>,

    pub any_failed_to_install: bool,

    // When adding a `file:` dependency in a workspace package, we want to install it
    // relative to the workspace root, but the path provided is relative to the
    // workspace package. We keep track of the original here.
    pub original_package_json_path: Box<ZStr>, // TODO(port): owned [:0]const u8

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

    pub active_lifecycle_scripts: LifecycleScriptSubprocess::List,
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

        let filter: &[u8] = if is_path {
            strings::without_trailing_slash(path::join_abs_string_buf(
                cwd,
                path_buf,
                &[remain],
                path::Style::Posix,
            ))
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
    pub transpiler: Transpiler,
}

#[derive(Default)]
pub struct WakeHandler {
    // handler: fn (ctx: *anyopaque, pm: *PackageManager) void = undefined,
    // onDependencyError: fn (ctx: *anyopaque, Dependency, PackageID, anyerror) void = undefined,
    pub handler: Option<fn(*mut c_void, &mut PackageManager)>, // STATIC fn ptr (cast at get_handler)
    pub on_dependency_error: Option<fn(*mut c_void, Dependency, DependencyID, Error)>, // STATIC fn ptr
    pub context: Option<NonNull<c_void>>, // BORROW_PARAM — caller-owned opaque ctx
}

impl WakeHandler {
    #[inline]
    pub fn get_handler(&self) -> fn(*mut c_void, &mut PackageManager) {
        // SAFETY: handler is always set before context per VirtualMachine.zig:1162
        self.handler.unwrap()
    }

    #[inline]
    pub fn geton_dependency_error(&self) -> fn(*mut c_void, Dependency, DependencyID, Error) {
        // PORT NOTE: Zig casts `t.handler` (the wrong field) to the dep-error fn type — this is
        // a Zig bug. The port intentionally fixes it by reading `on_dependency_error` instead;
        // preserving the bug would require an unsound transmute between fn-pointer signatures.
        // TODO(port): upstream fix to PackageManager.zig
        self.on_dependency_error.unwrap()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Globals / statics
// ──────────────────────────────────────────────────────────────────────────

pub static mut VERBOSE_INSTALL: bool = false;

struct TimePasser;
impl TimePasser {
    // TODO(port): Zig `pub var last_time: u64 = 0` — needs interior mutability
    thread_local! {
        static LAST_TIME: core::cell::Cell<u64> = const { core::cell::Cell::new(0) };
    }
}
// PORT NOTE: Zig used a plain `pub var`; in Rust this would need `static mut` or atomic.
// Since `hasEnoughTimePassedBetweenWaitingMessages` is only called from the main thread,
// a plain static mut is closest. Using a module-level static for fidelity:
static mut TIME_PASSER_LAST_TIME: u64 = 0;

thread_local! {
    static CACHED_PACKAGE_FOLDER_NAME_BUFS: RefCell<PathBuffer> =
        const { RefCell::new(PathBuffer::ZEROED) };
}

#[inline]
pub fn cached_package_folder_name_buf() -> *mut PathBuffer {
    // TODO(port): bun.ThreadlocalBuffers returns &mut PathBuffer; Rust thread_local
    // can't return a bare &'static mut. Callers should use with_borrow_mut instead.
    CACHED_PACKAGE_FOLDER_NAME_BUFS.with(|b| b.as_ptr())
}

mod holder {
    use super::PackageManager;
    // OWNED — global singleton, leaked.
    // PORT NOTE: LIFETIMES.tsv prescribes `OnceLock<Box<PackageManager>>` for Holder.ptr, but
    // Zig uses `var ptr: *PackageManager = undefined` then assigns via allocatePackageManager()
    // and later writes `manager.* = ...` in-place. OnceLock<Box<T>> can't express
    // allocate-then-fill (no `&mut` after set). Keep a raw ptr for now.
    // TODO(port): in-place init — reconcile with OnceLock<Box<PackageManager>> in Phase B.
    pub static mut RAW_PTR: *mut PackageManager = core::ptr::null_mut();
}

static mut CWD_BUF: PathBuffer = PathBuffer::ZEROED;
static mut ROOT_PACKAGE_JSON_PATH_BUF: PathBuffer = PathBuffer::ZEROED;
pub static mut ROOT_PACKAGE_JSON_PATH: &ZStr = ZStr::EMPTY; // TODO(port): [:0]const u8 static slice into ROOT_PACKAGE_JSON_PATH_BUF

// ──────────────────────────────────────────────────────────────────────────
// impl PackageManager
// ──────────────────────────────────────────────────────────────────────────

impl PackageManager {
    pub fn clear_cached_items_depending_on_lockfile_buffer(&mut self) {
        self.root_package_id.id = None;
    }

    pub fn crash(&mut self) -> ! {
        if self.options.log_level != Options::LogLevel::Silent {
            // SAFETY: log is always valid for the lifetime of the singleton
            let _ = unsafe { &mut *self.log }.print(Output::error_writer());
        }
        Global::crash();
    }

    pub fn has_enough_time_passed_between_waiting_messages() -> bool {
        let iter = get().event_loop.loop_().iteration_number();
        // SAFETY: only called from main thread
        unsafe {
            if TIME_PASSER_LAST_TIME < iter {
                TIME_PASSER_LAST_TIME = iter;
                return true;
            }
        }
        false
    }

    pub fn configure_env_for_scripts(
        &mut self,
        ctx: Command::Context,
        log_level: Options::LogLevel,
    ) -> Result<transpiler::Transpiler, Error> {
        // TODO(port): narrow error set
        CONFIGURE_ENV_FOR_SCRIPTS_ONCE.call((self, ctx, log_level))
    }

    pub fn http_proxy(&self, url: URL) -> Option<URL> {
        self.env().get_http_proxy_for(url)
    }

    pub fn tls_reject_unauthorized(&self) -> bool {
        self.env().get_tls_reject_unauthorized()
    }

    pub fn compute_is_continuous_integration(&self) -> bool {
        self.env().is_ci()
    }

    #[inline]
    pub fn is_continuous_integration(&mut self) -> bool {
        self.ci_mode.get()
    }

    pub fn fail_root_resolution(
        &mut self,
        dependency: &Dependency,
        dependency_id: DependencyID,
        err: Error,
    ) {
        if let Some(ctx) = self.on_wake.context {
            (self.on_wake.geton_dependency_error())(
                ctx.as_ptr(),
                dependency.clone(),
                dependency_id,
                err,
            );
        }
    }

    pub fn wake(&mut self) {
        if let Some(ctx) = self.on_wake.context {
            (self.on_wake.get_handler())(ctx.as_ptr(), self);
        }
        self.event_loop.wakeup();
    }

    pub fn sleep_until<C, F>(&mut self, closure: C, is_done_fn: F)
    where
        F: Fn(&C) -> bool,
    {
        Output::flush();
        self.event_loop.tick(closure, is_done_fn);
    }

    pub fn ensure_temp_node_gyp_script(&mut self) -> Result<(), Error> {
        // TODO(port): narrow error set
        ENSURE_TEMP_NODE_GYP_SCRIPT_ONCE.call((self,))
    }

    // Helper: deref env (UNKNOWN ownership wrapper)
    #[inline]
    fn env(&self) -> &dot_env::Loader {
        // SAFETY: env is set during init() and never null afterward
        unsafe { self.env.unwrap().as_ref() }
    }
    #[inline]
    fn env_mut(&mut self) -> &mut dot_env::Loader {
        // SAFETY: env is set during init() and never null afterward
        unsafe { self.env.unwrap().as_mut() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// bun.once wrappers
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): bun.once returns a struct whose .call() runs the closure exactly once
// and caches the result. Mapping to bun_core::Once with the run fn below.
pub static CONFIGURE_ENV_FOR_SCRIPTS_ONCE: Once<
    fn(&mut PackageManager, Command::Context, Options::LogLevel) -> Result<transpiler::Transpiler, Error>,
> = Once::new(configure_env_for_scripts_run);

fn configure_env_for_scripts_run(
    this: &mut PackageManager,
    ctx: Command::Context,
    log_level: Options::LogLevel,
) -> Result<transpiler::Transpiler, Error> {
    // We need to figure out the PATH and other environment variables
    // to do that, we re-use the code from bun run
    // this is expensive, it traverses the entire directory tree going up to the root
    // so we really only want to do it when strictly necessary
    // TODO(port): `var this_transpiler: Transpiler = undefined` — Zig leaves it uninit and
    // RunCommand.configureEnvForRun fully initializes via out-param. Transpiler is NOT
    // all-zero-valid POD, so `zeroed()` is wrong; use MaybeUninit and assume_init after fill.
    let mut this_transpiler_slot = core::mem::MaybeUninit::<transpiler::Transpiler>::uninit();
    let _ = RunCommand::configure_env_for_run(
        ctx,
        // SAFETY: configure_env_for_run writes the full Transpiler value before reading it
        unsafe { &mut *this_transpiler_slot.as_mut_ptr() },
        this.env_mut(),
        log_level != Options::LogLevel::Silent,
        false,
    )?;
    // SAFETY: configure_env_for_run returned Ok, so the slot is fully initialized
    let mut this_transpiler = unsafe { this_transpiler_slot.assume_init() };

    let init_cwd_entry = this.env_mut().map.get_or_put_without_value("INIT_CWD")?;
    if !init_cwd_entry.found_existing {
        *init_cwd_entry.key_ptr = Box::<[u8]>::from(&**init_cwd_entry.key_ptr);
        *init_cwd_entry.value_ptr = dot_env::Value {
            value: Box::<[u8]>::from(strings::without_trailing_slash(
                FileSystem::instance().top_level_dir,
            )),
            conditional: false,
        };
    }

    this.env_mut().load_ccache_path(this_transpiler.fs);

    {
        // Run node-gyp jobs in parallel.
        // https://github.com/nodejs/node-gyp/blob/7d883b5cf4c26e76065201f85b0be36d5ebdcc0e/lib/build.js#L150-L184
        let thread_count = bun_core::get_thread_count();
        if thread_count > 2 {
            if !this_transpiler.env.has("JOBS") {
                let mut int_buf = [0u8; 10];
                let mut cursor = &mut int_buf[..];
                write!(cursor, "{}", thread_count).expect("unreachable");
                let written = 10 - cursor.len();
                let jobs_str = &int_buf[..written];
                this_transpiler
                    .env
                    .map
                    .put_alloc_value("JOBS", jobs_str)
                    .expect("unreachable");
            }
        }
    }

    {
        let mut node_path = PathBuffer::uninit();
        if let Some(node_path_z) = this.env().get_node_path(this_transpiler.fs, &mut node_path) {
            let _ = this
                .env_mut()
                .load_nodejs_config(this_transpiler.fs, Box::<[u8]>::from(node_path_z))?;
        } else {
            'brk: {
                let current_path = this.env().get("PATH").unwrap_or(b"");
                let mut path_var: Vec<u8> = Vec::with_capacity(current_path.len());
                path_var.extend_from_slice(current_path);
                let mut bun_path: &[u8] = b"";
                if RunCommand::create_fake_temporary_node_executable(&mut path_var, &mut bun_path)
                    .is_err()
                {
                    break 'brk;
                }
                this.env_mut().map.put("PATH", &path_var)?;
                let _ = this
                    .env_mut()
                    .load_nodejs_config(this_transpiler.fs, Box::<[u8]>::from(bun_path))?;
            }
        }
    }

    Ok(this_transpiler)
}

static ENSURE_TEMP_NODE_GYP_SCRIPT_ONCE: Once<fn(&mut PackageManager) -> Result<(), Error>> =
    Once::new(ensure_temp_node_gyp_script_run);

fn ensure_temp_node_gyp_script_run(manager: &mut PackageManager) -> Result<(), Error> {
    if !manager.node_gyp_tempdir_name.is_empty() {
        return Ok(());
    }

    let tempdir = get_temporary_directory(manager);
    let mut path_buf = PathBuffer::uninit();
    let node_gyp_tempdir_name =
        fs::FileSystem::tmpname("node-gyp", &mut path_buf, 12345)?;

    // used later for adding to path for scripts
    manager.node_gyp_tempdir_name = Box::<[u8]>::from(node_gyp_tempdir_name);

    let node_gyp_tempdir = match tempdir
        .handle
        .make_open_path(&manager.node_gyp_tempdir_name, Default::default())
    {
        Ok(d) => d,
        Err(e) if e == err!("EEXIST") => {
            // it should not exist
            Output::pretty_errorln("<r><red>error<r>: node-gyp tempdir already exists", &[]);
            Global::crash();
        }
        Err(e) => {
            Output::pretty_errorln(
                "<r><red>error<r>: <b><red>{s}<r> creating node-gyp tempdir",
                &[&e.name()],
            );
            Global::crash();
        }
    };
    let _node_gyp_tempdir_guard = scopeguard::guard(node_gyp_tempdir, |mut d| d.close());
    // PORT NOTE: reshaped for borrowck — `defer node_gyp_tempdir.close()`

    #[cfg(windows)]
    const FILE_NAME: &str = "node-gyp.cmd";
    #[cfg(not(windows))]
    const FILE_NAME: &str = "node-gyp";

    #[cfg(windows)]
    const MODE: u32 = 0; // windows does not have an executable bit
    #[cfg(not(windows))]
    const MODE: u32 = 0o755;

    let node_gyp_file = match _node_gyp_tempdir_guard.create_file(
        FILE_NAME,
        bun_sys::CreateFileOptions { mode: MODE },
    ) {
        Ok(f) => f,
        Err(e) => {
            Output::pretty_errorln(
                "<r><red>error<r>: <b><red>{s}<r> creating node-gyp tempdir",
                &[&e.name()],
            );
            Global::crash();
        }
    };
    let mut node_gyp_file = scopeguard::guard(node_gyp_file, |mut f| f.close());

    #[cfg(windows)]
    const CONTENT: &str = "if not defined npm_config_node_gyp (\n  bun x --silent node-gyp %*\n) else (\n  node \"%npm_config_node_gyp%\" %*\n)\n";
    #[cfg(not(windows))]
    const CONTENT: &str = concat!(
        // TODO(port): Environment.isAndroid → cfg(target_os = "android") changes shebang
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
        Output::pretty_errorln(
            // Zig: "..." ++ file_name ++ " file" — comptime concat, no runtime alloc
            const_format::concatcp!(
                "<r><red>error<r>: <b><red>{s}<r> writing to ",
                FILE_NAME,
                " file"
            ),
            &[&e.name()],
        );
        Global::crash();
    }

    // Add our node-gyp tempdir to the path
    let existing_path = manager.env().get("PATH").unwrap_or(b"");
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
    manager.env_mut().map.put("PATH", &path_var)?;

    let mut cursor = &mut path_buf[..];
    write!(
        cursor,
        "{}{}{}{}{}",
        bstr::BStr::new(strings::without_trailing_slash(tempdir.name)),
        SEP_STR,
        bstr::BStr::new(strings::without_trailing_slash(&manager.node_gyp_tempdir_name)),
        SEP_STR,
        FILE_NAME
    )?;
    let written = path_buf.len() - cursor.len();
    let npm_config_node_gyp = &path_buf[..written];

    let node_gyp_abs_dir = path::dirname(npm_config_node_gyp).unwrap();
    manager
        .env_mut()
        .map
        .put_alloc_key_and_value("BUN_WHICH_IGNORE_CWD", node_gyp_abs_dir)?;

    Ok(())
}

fn http_thread_on_init_error(err: http::InitError, opts: http::HTTPThread::InitOpts) -> ! {
    match err {
        http::InitError::LoadCAFile => {
            let mut normalizer = path::PosixToWinNormalizer::default();
            let normalized =
                normalizer.resolve_z(FileSystem::instance().top_level_dir, opts.abs_ca_file_name);
            if !bun_sys::exists_z(normalized) {
                Output::err(
                    "HTTPThread",
                    "could not find CA file: '{s}'",
                    &[&bstr::BStr::new(opts.abs_ca_file_name)],
                );
            } else {
                Output::err(
                    "HTTPThread",
                    "invalid CA file: '{s}'",
                    &[&bstr::BStr::new(opts.abs_ca_file_name)],
                );
            }
        }
        http::InitError::InvalidCAFile => {
            Output::err(
                "HTTPThread",
                "invalid CA file: '{s}'",
                &[&bstr::BStr::new(opts.abs_ca_file_name)],
            );
        }
        http::InitError::InvalidCA => {
            Output::err("HTTPThread", "the CA is invalid", &[]);
        }
        http::InitError::FailedToOpenSocket => {
            Output::err_generic("failed to start HTTP client thread", &[]);
        }
    }
    Global::crash();
}

// ──────────────────────────────────────────────────────────────────────────
// allocate / get singleton
// ──────────────────────────────────────────────────────────────────────────

pub fn allocate_package_manager() {
    // SAFETY: called once before get(); allocates uninitialized PackageManager.
    // Zig: `bun.default_allocator.create(PackageManager)` — uninitialized memory.
    // TODO(port): Rust cannot Box<MaybeUninit<PackageManager>> and later treat as init
    // without unsafe transmute. The init() functions below write the full struct via
    // `*manager = PackageManager { ... }`. Using raw alloc + ptr::write pattern:
    unsafe {
        let layout = core::alloc::Layout::new::<PackageManager>();
        let ptr = std::alloc::alloc(layout) as *mut PackageManager;
        holder::RAW_PTR = ptr;
    }
}

pub fn get() -> &'static mut PackageManager {
    // SAFETY: allocate_package_manager() must have been called and the value initialized.
    unsafe { &mut *holder::RAW_PTR }
}

// ──────────────────────────────────────────────────────────────────────────
// init
// ──────────────────────────────────────────────────────────────────────────

pub fn init(
    ctx: Command::Context,
    cli: CommandLineArguments,
    subcommand: Subcommand,
) -> Result<(&'static mut PackageManager, Box<[u8]>), Error> {
    // TODO(port): narrow error set
    if cli.global {
        let mut explicit_global_dir: &[u8] = b"";
        if let Some(opts) = ctx.install {
            explicit_global_dir = opts.global_dir.as_deref().unwrap_or(explicit_global_dir);
        }
        let mut global_dir = Options::open_global_dir(explicit_global_dir)?;
        global_dir.set_as_cwd()?;
    }

    let fs = fs::FileSystem::init(None)?;
    let top_level_dir_no_trailing_slash = strings::without_trailing_slash(fs.top_level_dir);
    // SAFETY: CWD_BUF is a process-global path buffer only touched on the main thread
    unsafe {
        #[cfg(windows)]
        {
            let _ = path::path_to_posix_buf::<u8>(top_level_dir_no_trailing_slash, &mut CWD_BUF);
        }
        #[cfg(not(windows))]
        {
            // Avoid memcpy alias when source and dest are the same
            if CWD_BUF.as_ptr() != top_level_dir_no_trailing_slash.as_ptr() {
                CWD_BUF[..top_level_dir_no_trailing_slash.len()]
                    .copy_from_slice(top_level_dir_no_trailing_slash);
            }
        }
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
    // SAFETY: NUL written at path_len above
    let mut original_package_json_path =
        unsafe { ZStr::from_raw(original_package_json_path_buf.as_ptr(), path_len) };
    let original_cwd =
        strings::without_suffix(original_package_json_path.as_bytes(), SEP_PACKAGE_JSON);
    let original_cwd_clone = Box::<[u8]>::from(original_cwd);

    let mut workspace_names = Package::WorkspaceMap::init();
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
                let package_json_path = unsafe {
                    ZStr::from_raw(
                        package_json_path_buf.as_ptr(),
                        this_cwd.len() + b"/package.json".len(),
                    )
                };

                match bun_sys::open_file_z(
                    bun_sys::Fd::cwd(),
                    &package_json_path,
                    if need_write {
                        bun_sys::OpenMode::ReadWrite
                    } else {
                        bun_sys::OpenMode::ReadOnly
                    },
                ) {
                    Ok(f) => break 'child f,
                    Err(e) if e == err!("FileNotFound") => {
                        if let Some(parent) = path::dirname(this_cwd) {
                            this_cwd = strings::without_trailing_slash(parent);
                            continue;
                        } else {
                            break;
                        }
                    }
                    Err(e) if e == err!("AccessDenied") => {
                        Output::err(
                            "EACCES",
                            "Permission denied while opening \"{s}\"",
                            &[&bstr::BStr::new(package_json_path.as_bytes())],
                        );
                        if need_write {
                            Output::note("package.json must be writable to add packages", &[]);
                        } else {
                            Output::note(
                                "package.json is missing read permissions, or is owned by another user",
                                &[],
                            );
                        }
                        Global::crash();
                    }
                    Err(e) => {
                        Output::err_value(
                            e,
                            "could not open \"{s}\"",
                            &[&bstr::BStr::new(package_json_path.as_bytes())],
                        );
                        return Err(e);
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
            unsafe { ZStr::from_raw(original_package_json_path_buf.as_ptr(), new_path_len) };
        let child_cwd = &original_package_json_path.as_bytes()[..this_cwd.len()];
        // PORT NOTE: reshaped — Zig uses withoutSuffixComptime(.., sep_str ++ "package.json")

        // Check if this is a workspace; if so, use root package
        let mut found = false;
        if subcommand.should_chdir_to_root() {
            if !created_package_json {
                while let Some(parent) = path::dirname(this_cwd) {
                    let parent_without_trailing_slash = strings::without_trailing_slash(parent);
                    let mut parent_path_buf = PathBuffer::uninit();
                    parent_path_buf[..parent_without_trailing_slash.len()]
                        .copy_from_slice(parent_without_trailing_slash);
                    parent_path_buf[parent_without_trailing_slash.len()
                        ..parent_without_trailing_slash.len() + b"/package.json".len()]
                        .copy_from_slice(b"/package.json");
                    parent_path_buf[parent_without_trailing_slash.len() + b"/package.json".len()] =
                        0;

                    let json_file = match bun_sys::open_file_z(
                        bun_sys::Fd::cwd(),
                        // SAFETY: NUL written above
                        unsafe {
                            &ZStr::from_raw(
                                parent_path_buf.as_ptr(),
                                parent_without_trailing_slash.len() + b"/package.json".len(),
                            )
                        },
                        bun_sys::OpenMode::ReadWrite,
                    ) {
                        Ok(f) => f,
                        Err(_) => {
                            this_cwd = parent;
                            continue;
                        }
                    };
                    let json_file_guard = scopeguard::guard(json_file, |f| {
                        if !found {
                            f.close();
                        }
                    });
                    // TODO(port): errdefer — `defer if (!found) json_file.close()` captures &mut found
                    let json_stat_size = json_file_guard.get_end_pos()?;
                    let mut json_buf = vec![0u8; (json_stat_size + 64) as usize];
                    let json_len = json_file_guard.pread_all(&mut json_buf, 0)?;
                    // SAFETY: ROOT_PACKAGE_JSON_PATH_BUF is a process-global only touched on main thread
                    let json_path = unsafe {
                        bun_sys::get_fd_path(
                            Fd::from_std_file(&*json_file_guard),
                            &mut ROOT_PACKAGE_JSON_PATH_BUF,
                        )?
                    };
                    let json_source =
                        logger::Source::init_path_string(json_path, &json_buf[..json_len]);
                    initialize_store();
                    let json =
                        bun_json::parse_package_json_utf8(&json_source, ctx.log, /* allocator */)?;
                    if subcommand == Subcommand::Pm {
                        if let Ok(Some(name)) = json.get_string_cloned("name") {
                            root_package_json_name_at_time_of_init = name;
                        }
                    }

                    if let Some(prop) = json.as_property("workspaces") {
                        let json_array = match prop.expr.data {
                            bun_js_parser::ExprData::EArray(arr) => arr,
                            bun_js_parser::ExprData::EObject(obj) => {
                                if let Some(packages) = obj.get("packages") {
                                    match packages.data {
                                        bun_js_parser::ExprData::EArray(arr) => arr,
                                        _ => break,
                                    }
                                } else {
                                    break;
                                }
                            }
                            _ => break,
                        };
                        let mut log = logger::Log::init();
                        let _ = match workspace_names.process_names_array(
                            &mut workspace_package_json_cache,
                            &mut log,
                            json_array,
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
                                path::relative_normalized(
                                    json_source.path.name.dir,
                                    child_cwd,
                                    path::Style::Auto,
                                    true,
                                )
                            };

                            #[cfg(windows)]
                            let maybe_workspace_path = {
                                parent_path_buf[..child_path.len()].copy_from_slice(child_path);
                                path::dangerously_convert_path_to_posix_in_place::<u8>(
                                    &mut parent_path_buf[..child_path.len()],
                                );
                                &parent_path_buf[..child_path.len()]
                            };
                            #[cfg(not(windows))]
                            let maybe_workspace_path = child_path;

                            if strings::eql_long(maybe_workspace_path, path_, true) {
                                fs.top_level_dir = bun_str::ZStr::dupe_z(parent)?;
                                // TODO(port): allocator.dupeZ → owned ZStr stored in singleton
                                found = true;
                                child_json.close();
                                #[cfg(windows)]
                                {
                                    json_file_guard.seek_to(0)?;
                                }
                                workspace_name_hash =
                                    Some(SemverString::Builder::string_hash(entry.name));
                                let json_file = scopeguard::ScopeGuard::into_inner(json_file_guard);
                                break 'root_package_json_file json_file;
                            }
                        }

                        break;
                    }

                    this_cwd = parent;
                }
            }
        }

        fs.top_level_dir = bun_str::ZStr::dupe_z(child_cwd)?;
        // TODO(port): allocator.dupeZ
        break 'root_package_json_file child_json;
    };

    bun_sys::chdir(fs.top_level_dir, fs.top_level_dir).unwrap()?;
    BunArguments::load_config(cli.config, ctx, BunArguments::ConfigKind::InstallCommand)?;
    // SAFETY: main-thread global
    unsafe {
        CWD_BUF[..fs.top_level_dir.len()].copy_from_slice(fs.top_level_dir);
        CWD_BUF[fs.top_level_dir.len()] = 0;
        fs.top_level_dir = ZStr::from_raw(CWD_BUF.as_ptr(), fs.top_level_dir.len());
        ROOT_PACKAGE_JSON_PATH = bun_sys::get_fd_path_z(
            Fd::from_std_file(&root_package_json_file),
            &mut ROOT_PACKAGE_JSON_PATH_BUF,
        )?;
    }

    let entries_option = fs.fs.read_directory(fs.top_level_dir, None, 0, true)?;
    if let fs::EntriesOption::Err(e) = &*entries_option {
        return Err(e.canonical_error);
    }

    let env: &mut dot_env::Loader = {
        let map = Box::leak(Box::new(dot_env::Map::init()));
        let loader = Box::leak(Box::new(dot_env::Loader::init(map)));
        loader
    };
    // PORT NOTE: env has UNKNOWN ownership per LIFETIMES.tsv; Zig allocates and never frees.
    // Using Box::leak to get &'static mut, stored as NonNull below.

    env.load_process()?;
    env.load(entries_option.entries(), &[], dot_env::Mode::Production, false)?;

    initialize_store();

    if let Some(data_dir) = bun_core::env_var::XDG_CONFIG_HOME
        .get()
        .or_else(|| bun_core::env_var::HOME.get())
    {
        let mut buf = PathBuffer::uninit();
        let parts = [b"./.npmrc" as &[u8]];

        let install_ref = ctx.install.get_or_insert_with(|| {
            // SAFETY: all-zero is a valid Api::BunInstall (extern struct in Zig)
            Box::leak(Box::new(unsafe { core::mem::zeroed::<Api::BunInstall>() }))
        });
        ini::load_npmrc_config(
            install_ref,
            env,
            true,
            &[
                path::join_abs_string_buf_z(data_dir, &mut buf, &parts, path::Style::Auto),
                ZStr::from_bytes(b".npmrc"),
            ],
        );
    } else {
        let install_ref = ctx.install.get_or_insert_with(|| {
            // SAFETY: all-zero is a valid Api::BunInstall
            Box::leak(Box::new(unsafe { core::mem::zeroed::<Api::BunInstall>() }))
        });
        ini::load_npmrc_config(install_ref, env, true, &[ZStr::from_bytes(b".npmrc")]);
    }
    let cpu_count = bun_core::get_thread_count();

    let options = Options {
        global: cli.global,
        max_concurrent_lifecycle_scripts: cli.concurrent_scripts.unwrap_or(cpu_count * 2),
        ..Default::default()
    };

    if env.get("BUN_INSTALL_VERBOSE").is_some() {
        // SAFETY: main-thread init
        unsafe {
            VERBOSE_INSTALL = true;
        }
    }

    if env.get("BUN_FEATURE_FLAG_FORCE_WAITER_THREAD").is_some() {
        WaiterThread::set_should_use_waiter_thread();
    }

    if bun_core::feature_flag::BUN_FEATURE_FLAG_FORCE_WINDOWS_JUNCTIONS.get() {
        bun_sys::WindowsSymlinkOptions::set_has_failed_to_create_symlink(true);
    }

    // SAFETY: main-thread init
    if unsafe { VERBOSE_INSTALL } {
        Output::pretty_errorln(
            "Cache Dir: {s}",
            &[&bstr::BStr::new(&options.cache_directory)],
        );
        Output::flush();
    }

    drop(workspace_names); // workspace_names.map.deinit()

    allocate_package_manager();
    let manager = get();
    // var progress = Progress{};
    // var node = progress.start(name: []const u8, estimated_total_items: usize)
    // SAFETY: manager points to uninitialized memory from allocate_package_manager();
    // we fully initialize it here via ptr::write.
    unsafe {
        core::ptr::write(
            manager as *mut PackageManager,
            PackageManager {
                cache_directory_: None,
                cache_directory_path: ZStr::EMPTY_BOX, // TODO(port): default ""
                preallocated_network_tasks: PreallocatedNetworkTasks::init(),
                preallocated_resolve_tasks: PreallocatedTaskStore::init(),
                options,
                active_lifecycle_scripts: LifecycleScriptSubprocess::List {
                    context: manager as *mut _,
                },
                network_task_fifo: NetworkQueue::init(),
                patch_task_fifo: PatchTaskFifo::init(),
                log: ctx.log,
                root_dir: entries_option.entries(),
                env: Some(NonNull::from(env)),
                cpu_count,
                thread_pool: ThreadPool::init(ThreadPool::Options {
                    max_threads: cpu_count,
                }),
                resolve_tasks: ResolveTaskQueue::default(),
                // SAFETY: placeholder — Lockfile is NOT all-zero-valid POD. Zig leaves this
                // `undefined` and immediately overwrites with `allocator.create(Lockfile)` below.
                // TODO(port): replace with Box::<MaybeUninit<Lockfile>>::new_uninit() or
                // construct via Lockfile::init_empty() directly here.
                lockfile: Box::new(unsafe { core::mem::zeroed() }), // overwritten below
                root_package_json_file,
                // .progress
                event_loop: AnyEventLoop::Mini(MiniEventLoop::init()),
                original_package_json_path: ZStr::from_vec(original_package_json_path_buf),
                // TODO(port): owned [:0]const u8 conversion
                workspace_package_json_cache,
                workspace_name_hash,
                subcommand,
                root_package_json_name_at_time_of_init,

                // remaining defaults:
                timestamp_for_manifest_cache_control: 0,
                extracted_count: 0,
                default_features: Features::default(),
                summary: Default::default(),
                progress: Progress::default(),
                downloads_node: None,
                scripts_node: None,
                progress_name_buf: [0; 768],
                progress_name_buf_dynamic: Vec::new(),
                track_installed_bin: TrackInstalledBin::None,
                root_progress_node: core::ptr::null_mut(),
                to_update: false,
                update_requests: Box::default(),
                root_package_id: RootPackageId::default(),
                task_batch: ThreadPool::Batch::default(),
                task_queue: TaskDependencyQueue::default(),
                manifests: PackageManifestMap::default(),
                folders: FolderResolution::Map::default(),
                git_repositories: RepositoryMap::default(),
                network_dedupe_map: NetworkTask::DedupeMap::init(),
                async_network_task_queue: AsyncNetworkTaskQueue::default(),
                network_tarball_batch: ThreadPool::Batch::default(),
                network_resolve_batch: ThreadPool::Batch::default(),
                patch_apply_batch: ThreadPool::Batch::default(),
                patch_calc_hash_batch: ThreadPool::Batch::default(),
                patch_task_queue: PatchTaskQueue::default(),
                pending_pre_calc_hashes: AtomicU32::new(0),
                pending_tasks: AtomicU32::new(0),
                total_tasks: 0,
                lifecycle_script_time_log: LifecycleScriptTimeLog::default(),
                pending_lifecycle_script_tasks: AtomicU32::new(0),
                finished_installing: AtomicBool::new(false),
                total_scripts: 0,
                root_lifecycle_scripts: None,
                node_gyp_tempdir_name: Box::default(),
                env_configure: None,
                preinstall_state: Vec::new(),
                postinstall_optimizer: PostinstallOptimizer::List::default(),
                global_link_dir: None,
                global_dir: None,
                global_link_dir_path: Box::default(),
                on_wake: WakeHandler::default(),
                ci_mode: LazyBool::new(PackageManager::compute_is_continuous_integration),
                peer_dependencies: LinearFifo::init(),
                known_npm_aliases: NpmAliasMap::default(),
                trusted_deps_to_add_to_package_json: Vec::new(),
                any_failed_to_install: false,
                updating_packages: StringArrayHashMap::default(),
                patched_dependencies_to_remove: ArrayHashMap::default(),
                last_reported_slow_lifecycle_script_at: 0,
                cached_tick_for_slow_lifecycle_script_logging: 0,
            },
        );
    }
    manager
        .event_loop
        .loop_()
        .internal_loop_data
        .set_parent_event_loop(EventLoopHandle::init(&manager.event_loop));
    manager.lockfile = Box::new(Lockfile::default());
    // PORT NOTE: Zig `try ctx.allocator.create(Lockfile)` allocates uninit; Rust needs Default.

    {
        // make sure folder packages can find the root package without creating a new one
        // SAFETY: ROOT_PACKAGE_JSON_PATH set above
        let mut normalized =
            bun_paths::AbsPath::<{ bun_paths::Sep::Posix }>::from(unsafe { ROOT_PACKAGE_JSON_PATH });
        manager.folders.put(
            FolderResolution::hash(normalized.slice()),
            FolderResolution::PackageId(0),
        )?;
        // normalized.deinit() → Drop
    }

    MiniEventLoop::set_global(&mut manager.event_loop.mini());
    if !manager.options.enable.cache {
        manager.options.enable.manifest_cache = false;
        manager.options.enable.manifest_cache_control = false;
    }

    if let Some(manifest_cache) = env.get("BUN_MANIFEST_CACHE") {
        if manifest_cache == b"1" {
            manager.options.enable.manifest_cache = true;
            manager.options.enable.manifest_cache_control = false;
        } else if manifest_cache == b"2" {
            manager.options.enable.manifest_cache = true;
            manager.options.enable.manifest_cache_control = true;
        } else {
            manager.options.enable.manifest_cache = false;
            manager.options.enable.manifest_cache_control = false;
        }
    }

    manager
        .options
        .load(ctx.log, env, cli, ctx.install, subcommand)?;

    let mut ca: Vec<Box<ZStr>> = Vec::new();
    if !manager.options.ca.is_empty() {
        ca = Vec::with_capacity(manager.options.ca.len());
        debug_assert_eq!(ca.capacity(), manager.options.ca.len());
        for s in manager.options.ca.iter() {
            ca.push(ZStr::dupe_z(s)?);
        }
    }

    let mut abs_ca_file_name: Box<ZStr> = ZStr::EMPTY_BOX; // TODO(port): empty ZStr
    if !manager.options.ca_file_name.is_empty() {
        // resolve with original cwd
        if bun_paths::is_absolute(&manager.options.ca_file_name) {
            abs_ca_file_name = ZStr::dupe_z(&manager.options.ca_file_name)?;
        } else {
            let mut path_buf = PathBuffer::uninit();
            abs_ca_file_name = ZStr::dupe_z(path::join_abs_string_buf(
                &original_cwd_clone,
                &mut path_buf,
                &[&manager.options.ca_file_name],
                path::Style::Auto,
            ))?;
        }
    }

    AsyncHTTP::max_simultaneous_requests().store(
        'brk: {
            if let Some(network_concurrency) = cli.network_concurrency {
                break 'brk network_concurrency.max(1);
            }

            // If any HTTP proxy is set, use a diferent limit
            if env.has("http_proxy")
                || env.has("https_proxy")
                || env.has("HTTPS_PROXY")
                || env.has("HTTP_PROXY")
            {
                break 'brk DEFAULT_MAX_SIMULTANEOUS_REQUESTS_FOR_BUN_INSTALL_FOR_PROXIES;
            }

            DEFAULT_MAX_SIMULTANEOUS_REQUESTS_FOR_BUN_INSTALL
        },
        Ordering::Relaxed, // .monotonic
    );

    http::HTTPThread::init(&http::HTTPThread::InitOpts {
        ca: ca.into_boxed_slice(),
        abs_ca_file_name,
        on_init_error: http_thread_on_init_error,
    });

    manager.timestamp_for_manifest_cache_control = 'brk: {
        if cfg!(debug_assertions) {
            // TODO(port): bun.Environment.allow_assert
            if let Some(cache_control) = env.get("BUN_CONFIG_MANIFEST_CACHE_CONTROL_TIMESTAMP") {
                // env-var bytes are not guaranteed UTF-8; parse on bytes directly (Zig: std.fmt.parseInt)
                if let Some(int) = bun_str::strings::parse_int::<u32>(cache_control, 10) {
                    break 'brk int;
                }
            }
        }

        (u64::try_from(bun_core::time::timestamp().max(0)).unwrap()) as u32 // @truncate
    };

    Ok((manager, original_cwd_clone))
}

pub fn init_with_runtime(
    log: &mut logger::Log,
    bun_install: Option<&mut Api::BunInstall>,
    cli: CommandLineArguments,
    env: &mut dot_env::Loader,
) -> &'static mut PackageManager {
    INIT_WITH_RUNTIME_ONCE.call((log, bun_install, cli, env));
    get()
}

static INIT_WITH_RUNTIME_ONCE: Once<
    fn(&mut logger::Log, Option<&mut Api::BunInstall>, CommandLineArguments, &mut dot_env::Loader),
> = Once::new(init_with_runtime_once);

pub fn init_with_runtime_once(
    log: &mut logger::Log,
    bun_install: Option<&mut Api::BunInstall>,
    cli: CommandLineArguments,
    env: &mut dot_env::Loader,
) {
    if env.get("BUN_INSTALL_VERBOSE").is_some() {
        // SAFETY: main-thread init
        unsafe {
            VERBOSE_INSTALL = true;
        }
    }

    let cpu_count = bun_core::get_thread_count();
    allocate_package_manager();
    let manager = get();
    let root_dir = match FileSystem::instance().fs.read_directory(
        FileSystem::instance().top_level_dir,
        None,
        0,
        true,
    ) {
        Ok(d) => d,
        Err(e) => {
            Output::err_value(
                e,
                "failed to read root directory: '{s}'",
                &[&bstr::BStr::new(FileSystem::instance().top_level_dir)],
            );
            panic!("Failed to initialize package manager");
        }
    };

    // var progress = Progress{};
    // var node = progress.start(name: []const u8, estimated_total_items: usize)
    let top_level_dir_no_trailing_slash =
        strings::without_trailing_slash(FileSystem::instance().top_level_dir);
    let mut original_package_json_path =
        vec![0u8; top_level_dir_no_trailing_slash.len() + "/package.json".len() + 1];
    original_package_json_path[..top_level_dir_no_trailing_slash.len()]
        .copy_from_slice(top_level_dir_no_trailing_slash);
    original_package_json_path
        [top_level_dir_no_trailing_slash.len()..top_level_dir_no_trailing_slash.len() + b"/package.json".len()]
        .copy_from_slice(b"/package.json");
    // last byte already 0 (sentinel)

    // SAFETY: manager points to uninitialized memory; fully initialize via ptr::write
    unsafe {
        core::ptr::write(
            manager as *mut PackageManager,
            PackageManager {
                cache_directory_: None,
                cache_directory_path: ZStr::EMPTY_BOX, // TODO(port): default
                preallocated_network_tasks: PreallocatedNetworkTasks::init(),
                preallocated_resolve_tasks: PreallocatedTaskStore::init(),
                options: Options {
                    max_concurrent_lifecycle_scripts: cli
                        .concurrent_scripts
                        .unwrap_or(cpu_count * 2),
                    ..Default::default()
                },
                active_lifecycle_scripts: LifecycleScriptSubprocess::List {
                    context: manager as *mut _,
                },
                network_task_fifo: NetworkQueue::init(),
                log: log as *mut _,
                root_dir: root_dir.entries(),
                env: Some(NonNull::from(env)),
                cpu_count,
                thread_pool: ThreadPool::init(ThreadPool::Options {
                    max_threads: cpu_count,
                }),
                // SAFETY: placeholder — Lockfile is NOT all-zero-valid POD. Zig leaves this
                // `undefined` and overwrites below.
                // TODO(port): replace with Box::<MaybeUninit<Lockfile>>::new_uninit() or init_empty().
                lockfile: Box::new(unsafe { core::mem::zeroed() }), // overwritten below
                // SAFETY: bun_sys::File is #[repr(C)] wrapping an Fd; all-zero is the invalid-fd
                // sentinel. Zig leaves this `undefined` (never read in the runtime path).
                // TODO(port): use bun_sys::File::INVALID once available.
                root_package_json_file: unsafe { core::mem::zeroed() },
                // MOVE_DOWN(b0): AnyEventLoop is now bun_event_loop. The Js variant wraps an
                // erased *mut () set by tier-6; bun_event_loop::AnyEventLoop::js_current() reads
                // the JS_EVENT_LOOP_HOOK registered by bun_runtime::init().
                event_loop: AnyEventLoop::js_current(),
                original_package_json_path: ZStr::from_vec(original_package_json_path),
                subcommand: Subcommand::Install,

                // remaining defaults:
                resolve_tasks: ResolveTaskQueue::default(),
                timestamp_for_manifest_cache_control: 0,
                extracted_count: 0,
                default_features: Features::default(),
                summary: Default::default(),
                progress: Progress::default(),
                downloads_node: None,
                scripts_node: None,
                progress_name_buf: [0; 768],
                progress_name_buf_dynamic: Vec::new(),
                track_installed_bin: TrackInstalledBin::None,
                root_progress_node: core::ptr::null_mut(),
                to_update: false,
                update_requests: Box::default(),
                root_package_json_name_at_time_of_init: Box::default(),
                root_package_id: RootPackageId::default(),
                task_batch: ThreadPool::Batch::default(),
                task_queue: TaskDependencyQueue::default(),
                manifests: PackageManifestMap::default(),
                folders: FolderResolution::Map::default(),
                git_repositories: RepositoryMap::default(),
                network_dedupe_map: NetworkTask::DedupeMap::init(),
                async_network_task_queue: AsyncNetworkTaskQueue::default(),
                network_tarball_batch: ThreadPool::Batch::default(),
                network_resolve_batch: ThreadPool::Batch::default(),
                patch_apply_batch: ThreadPool::Batch::default(),
                patch_calc_hash_batch: ThreadPool::Batch::default(),
                patch_task_fifo: PatchTaskFifo::init(),
                patch_task_queue: PatchTaskQueue::default(),
                pending_pre_calc_hashes: AtomicU32::new(0),
                pending_tasks: AtomicU32::new(0),
                total_tasks: 0,
                lifecycle_script_time_log: LifecycleScriptTimeLog::default(),
                pending_lifecycle_script_tasks: AtomicU32::new(0),
                finished_installing: AtomicBool::new(false),
                total_scripts: 0,
                root_lifecycle_scripts: None,
                node_gyp_tempdir_name: Box::default(),
                env_configure: None,
                preinstall_state: Vec::new(),
                postinstall_optimizer: PostinstallOptimizer::List::default(),
                global_link_dir: None,
                global_dir: None,
                global_link_dir_path: Box::default(),
                on_wake: WakeHandler::default(),
                ci_mode: LazyBool::new(PackageManager::compute_is_continuous_integration),
                peer_dependencies: LinearFifo::init(),
                known_npm_aliases: NpmAliasMap::default(),
                trusted_deps_to_add_to_package_json: Vec::new(),
                any_failed_to_install: false,
                workspace_name_hash: None,
                workspace_package_json_cache: WorkspacePackageJSONCache::default(),
                updating_packages: StringArrayHashMap::default(),
                patched_dependencies_to_remove: ArrayHashMap::default(),
                last_reported_slow_lifecycle_script_at: 0,
                cached_tick_for_slow_lifecycle_script_logging: 0,
            },
        );
    }
    manager.lockfile = Box::new(Lockfile::default());

    if Output::enable_ansi_colors_stderr() {
        manager.progress = Progress::default();
        manager.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        manager.root_progress_node = manager.progress.start("", 0);
    } else {
        manager.options.log_level = Options::LogLevel::DefaultNoProgress;
    }

    if !manager.options.enable.cache {
        manager.options.enable.manifest_cache = false;
        manager.options.enable.manifest_cache_control = false;
    }

    if let Some(manifest_cache) = env.get("BUN_MANIFEST_CACHE") {
        if manifest_cache == b"1" {
            manager.options.enable.manifest_cache = true;
            manager.options.enable.manifest_cache_control = false;
        } else if manifest_cache == b"2" {
            manager.options.enable.manifest_cache = true;
            manager.options.enable.manifest_cache_control = true;
        } else {
            manager.options.enable.manifest_cache = false;
            manager.options.enable.manifest_cache_control = false;
        }
    }

    match manager
        .options
        .load(log, env, cli, bun_install, Subcommand::Install)
    {
        Ok(()) => {}
        Err(e) => {
            // only error.OutOfMemory possible
            let _ = e;
            bun_core::out_of_memory();
        }
    }

    manager.timestamp_for_manifest_cache_control =
        ((u64::try_from(bun_core::time::timestamp().max(0)).unwrap()) as u32)
            // When using "bun install", we check for updates with a 300 second cache.
            // When using bun, we only do staleness checks once per day
            .saturating_sub(bun_core::time::S_PER_DAY);

    if root_dir.entries().has_comptime_query("bun.lockb") {
        match manager.lockfile.load_from_cwd(manager, log, true) {
            lockfile::LoadResult::Ok(load) => manager.lockfile = load.lockfile,
            _ => manager.lockfile.init_empty(),
        }
    } else {
        manager.lockfile.init_empty();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager.zig (1328 lines)
//   confidence: low
//   todos:      29
//   notes:      Singleton allocate-then-fill pattern (holder RAW_PTR vs OnceLock), ZStr ownership, std.fs.Dir/File mapping, bun.once/LazyBool, and zeroed() Lockfile placeholders all need Phase-B reconciliation; WakeHandler.getonDependencyError intentionally fixes a Zig bug.
// ──────────────────────────────────────────────────────────────────────────
