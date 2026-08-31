use core::cell::OnceCell;
use core::ffi::c_void;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::collections::VecDeque;
use std::io::Write as _;

use crate::Error;
use crate::bun_fs as fs;
use crate::bun_fs::FileSystem;
use crate::bun_progress::{Node as ProgressNode, Progress};
use crate::bun_schema::api as Api;
use bun_collections::linear_fifo::DynamicBuffer;
use bun_collections::{ArrayHashMap, HashMap, LinearFifo, StringArrayHashMap, index_sort};
use bun_core::ZBox;
use bun_core::{Global, Output};
use bun_core::{ZStr, strings};
use bun_dotenv as dot_env;
use bun_event_loop::MiniEventLoop as mini_event_loop;
use bun_event_loop::MiniEventLoop::MiniEventLoop;
use bun_event_loop::{self, AnyEventLoop, EventLoopHandle};
use bun_http as http;
use bun_ini as ini;
use bun_paths::resolve_path::{self, PosixToWinNormalizer, platform};
use bun_paths::{DELIMITER, PathBuffer, SEP, SEP_STR};
use bun_semver as Semver;
use bun_sys::{self, Fd};
use bun_threading::{ThreadPool, thread_pool};
use bun_url::URL;

// Install only flips the force-waiter-thread flag during init; the waiter
// thread itself (queue, signalfd, loop) lives in `bun_runtime::api::bun::process`.
use bun_spawn::process::WaiterThread;

use crate::RunCommand;

/// `Command::Context` shim — the option-carrying `ContextData` shape was lifted
/// into `bun_options_types::context` so install can reference it without the CLI
/// tier. Re-export here so `init()` / `install_with_manager()` /
/// `setup_global_dir()` etc. keep their `Command::Context` signatures.
#[allow(non_snake_case)]
pub mod Command {
    pub use bun_options_types::context::{Context, ContextData};
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-module declarations — explicit #[path] attrs for PascalCase /
// camelCase file names.
// ──────────────────────────────────────────────────────────────────────────
#[path = "PackageManager/add_catalog.rs"]
pub mod add_catalog;
#[path = "PackageManager/add_remove_with_filter.rs"]
pub mod add_remove_with_filter;
#[path = "PackageManager/CommandLineArguments.rs"]
pub mod command_line_arguments;
#[path = "PackageManager/install_with_manager.rs"]
pub mod install_with_manager;
#[path = "PackageManager/PackageJSONEditor.rs"]
pub mod package_json_editor;
#[path = "PackageManager/package_json_write_back.rs"]
pub mod package_json_write_back;
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
#[path = "PackageManager/workspace_manifests.rs"]
pub mod workspace_manifests;
#[path = "PackageManager/WorkspacePackageJSONCache.rs"]
pub mod workspace_package_json_cache;
#[path = "PackageManager/workspace_selection.rs"]
pub mod workspace_selection;

/// Lower-case path alias so `package_manager::options::Options` (used by the
/// retired stub surface) keeps resolving.
pub mod options {
    pub use super::package_manager_options::*;
}

// ──────────────────────────────────────────────────────────────────────────
// Only the help text is needed by `CommandLineArguments::parse`; the
// commands themselves live in the runtime CLI.
// ──────────────────────────────────────────────────────────────────────────
pub(crate) struct PackageManagerCommand;

impl PackageManagerCommand {
    fn print_help() {
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
  <b><green>bun pm<r> <blue>ls<r>                   list the dependency tree according to the current lockfile
  <d>├<r> <cyan>--all<r>                     list the entire dependency tree according to the current lockfile
  <d>└<r> <cyan>--trusted<r>                 list only trusted dependencies
  <b><green>bun pm<r> <blue>why<r> <d>\<pkg\><r>            show dependency tree explaining why a package is installed
  <b><green>bun pm<r> <blue>licenses<r>             list installed packages grouped by license
  <d>├<r> <cyan>--json<r>                    output as JSON
  <d>├<r> <cyan>--prod<r>                    omit devDependencies
  <d>├<r> <cyan>--dev<r>                     list only what devDependencies pull in
  <d>├<r> <cyan>--long<r>                    also print author, description and homepage
  <d>└<r> <cyan>--filter<r> <d>\<pattern\><r>        list only the matching workspaces' dependencies
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

        #[allow(clippy::disallowed_methods)]
        // help-text consts contain <tag> markup that must be tag-walked
        Output::pretty(format_args!("{}", intro_text));
        #[allow(clippy::disallowed_methods)]
        Output::pretty(format_args!("{}", outro_text));
        Output::flush();
    }
}

use crate::lockfile_real::package as Package;
use crate::package_manager_task as Task;
use crate::resolvers::folder_resolver::{Entry as FolderResolutionEntry, FolderResolution};
use bun_install::lockfile::{self, Lockfile};
use bun_install::{
    Dependency, DependencyID, NetworkTask, PackageID, PackageManifestMap,
    PackageNameAndVersionHash, PackageNameHash, PatchTask, PreinstallState, TaskCallbackContext,
    initialize_store,
};

// ──────────────────────────────────────────────────────────────────────────
// Sub-module re-exports (thin re-exports — bodies live in their own files)
// ──────────────────────────────────────────────────────────────────────────

pub use self::command_line_arguments::CommandLineArguments;
pub use self::package_manager_options::Options;
// `PackageJSONEditor` is a module-level namespace (no struct) — re-export
// the module itself so `PackageJSONEditor::edit(...)` resolves to the free fns.
pub use self::install_with_manager::install_with_manager;
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
    fetch_cache_directory_path, get_cache_directory, get_temporary_directory, global_link_dir,
    global_link_dir_path, is_folder_in_cache, path_for_cached_npm_path, path_for_resolution,
    save_lockfile, setup_global_dir, update_lockfile_if_needed, write_yarn_lock,
};

pub use self::package_manager_enqueue as enqueue;
pub use enqueue::{
    GitEnqueueResult, create_extract_task_for_streaming, enqueue_dependency_list,
    enqueue_dependency_to_root, enqueue_dependency_with_main,
    enqueue_dependency_with_main_and_success_fn, enqueue_extract_npm_package, enqueue_git_checkout,
    enqueue_git_for_checkout, enqueue_network_task, enqueue_package_for_download,
    enqueue_parse_npm_package, enqueue_patch_task, enqueue_patch_task_pre,
    enqueue_tarball_for_download, enqueue_tarball_for_reading,
};

use self::package_manager_lifecycle as lifecycle;
pub use lifecycle::{determine_preinstall_state, get_preinstall_state, set_preinstall_state};

use self::package_manager_resolution as resolution;
pub use resolution::{assign_root_resolution, resolve_from_disk_cache};

pub use self::progress_strings::ProgressStrings;

pub use self::patch_package::PatchCommitResult;

pub use self::run_tasks::{
    alloc_github_url, decrement_pending_tasks, drain_dependency_list, flush_dependency_queue,
    flush_network_queue, flush_patch_task_queue, generate_network_task_for_tarball,
    has_created_network_task, increment_pending_tasks, is_network_task_required,
    pending_task_count, run_tasks, schedule_tasks,
};

pub use self::update_package_json_and_install::{
    update_package_json_and_install_and_cli, update_package_json_and_install_with_manager,
};

pub use self::populate_manifest_cache::populate_manifest_cache;

// ──────────────────────────────────────────────────────────────────────────
// Type aliases
// ──────────────────────────────────────────────────────────────────────────

pub(crate) type TaskCallbackList = Vec<TaskCallbackContext>;
pub(crate) type TaskDependencyQueue =
    HashMap<Task::Id, TaskCallbackList /* , IdentityContext<Task::Id>, 80 */>;

type ResolveTaskQueue = bun_threading::OwnedQueue<Task::Task>;

type RepositoryMap = HashMap<Task::Id, Fd /* , IdentityContext<Task::Id>, 80 */>;
/// Git-commit task id -> the SHA it resolved, for the waiters that re-enter.
type GitCommitMap = HashMap<Task::Id, Vec<u8> /* , IdentityContext<Task::Id>, 80 */>;
/// Resolve-task id (git checkout / tarball extract) -> the package that task
/// appended during the resolve phase. A task's callback queue is drained
/// exactly once, so a dependency enqueued after that drain must resolve
/// through this map instead of queueing a callback that nothing will ever
/// process.
type AppendedTaskPackageMap =
    HashMap<Task::Id, PackageID /* , IdentityContext<Task::Id>, 80 */>;
pub(crate) type FolderResolutionMap =
    HashMap<u64, FolderResolutionEntry /* , IdentityContext<u64>, 80 */>;
pub(crate) type NpmAliasMap =
    HashMap<PackageNameHash, crate::dependency::Version /* , IdentityContext<u64>, 80 */>;

/// Up to 32 tasks buffered on the main thread before they are flushed to
/// their thread-pool batch.
pub(crate) struct TaskFifo<T>(std::collections::VecDeque<Box<T>>);

impl<T> TaskFifo<T> {
    const CAPACITY: usize = 32;
    fn new() -> Self {
        Self(std::collections::VecDeque::with_capacity(Self::CAPACITY))
    }
    #[inline]
    pub(crate) fn is_full(&self) -> bool {
        self.0.len() >= Self::CAPACITY
    }
    #[inline]
    pub(crate) fn push(&mut self, task: Box<T>) {
        debug_assert!(!self.is_full());
        self.0.push_back(task);
    }
    #[inline]
    pub(crate) fn pop(&mut self) -> Option<Box<T>> {
        self.0.pop_front()
    }
}

type NetworkQueue = TaskFifo<NetworkTask>;
type PatchTaskFifo = TaskFifo<PatchTask>;

pub type PatchTaskQueue = bun_threading::OwnedQueue<PatchTask>;
pub type AsyncNetworkTaskQueue = bun_threading::OwnedQueue<NetworkTask>;

pub(crate) type SuccessFn = fn(&mut PackageManager, DependencyID, PackageID);
pub(crate) type FailFn = fn(&mut PackageManager, &Dependency, PackageID, Error);

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
    pub(crate) cache_directory: Option<bun_sys::Dir>,
    pub(crate) cache_directory_path: ZBox, // owned; process lifetime via the leaked singleton
    /// The resolver's directory-cache entry for the project root (lives as long as the resolver's directory cache).
    pub root_dir: &'static fs::DirEntry,
    /// AST nodes that must outlive `Expr.Data.Store.reset()` across workspace
    /// iterations are allocated here. The manager is a leaked singleton, so
    /// this arena has process lifetime.
    pub(crate) ast_arena: bun_alloc::Arena,
    /// The install log. In CLI mode `init()` re-points the command context's
    /// `log` at this one, so the rest of the CLI reads and prints the same log.
    pub log: Box<bun_ast::Log>,
    /// Cross-thread state: what worker/HTTP threads use to hand results back
    /// and wake the main loop. Leaked alongside the manager.
    pub shared: &'static Shared,
    pub(crate) timestamp_for_manifest_cache_control: u32,
    pub(crate) extracted_count: u32,
    pub(crate) summary: Package::DiffSummary,
    pub env: EnvLoader,
    pub progress: Progress,
    /// Children of `progress.root` while an install pass shows progress.
    pub(crate) downloads_node: Option<ProgressNode>,
    pub scripts_node: Option<ProgressNode>,

    pub(crate) track_installed_bin: TrackInstalledBin,

    pub to_update: bool,

    pub subcommand: Subcommand,
    pub(crate) update_requests: Box<[UpdateRequest]>,
    pub(crate) update_request_index: update_request::UpdateRequestIndex,
    pub audit_fix_pins: Box<[crate::audit_fix::PlannedFix]>,

    /// Only set in `bun pm`
    pub root_package_json_name_at_time_of_init: Box<[u8]>,

    pub root_package_json_file: bun_sys::File,

    /// The package id corresponding to the workspace the install is happening in. Could be root, or
    /// could be any of the workspaces.
    pub root_package_id: RootPackageId,

    pub(crate) thread_pool: ThreadPool,
    pub(crate) task_batch: thread_pool::Batch,
    pub(crate) task_queue: TaskDependencyQueue,

    pub manifests: PackageManifestMap,
    pub(crate) folders: FolderResolutionMap,
    pub(crate) git_repositories: RepositoryMap,
    pub(crate) git_commits: GitCommitMap,
    /// Git tasks queued by `enqueue_git_task` and not yet started.
    pub(crate) git_tasks: VecDeque<Box<Task::Task>>,
    /// Git tasks whose `git_runner::GitSubprocess` is alive.
    pub(crate) running_git_tasks: AtomicU32,
    /// The environment for the `git` children, built on first use.
    pub(crate) git_env: OnceCell<crate::repository::GitEnv>,
    pub(crate) appended_task_packages: AppendedTaskPackageMap,

    pub(crate) network_dedupe_map: crate::network_task::DedupeMap,
    pub(crate) network_tarball_batch: thread_pool::Batch,
    pub(crate) network_resolve_batch: thread_pool::Batch,
    pub(crate) network_task_fifo: NetworkQueue,
    pub(crate) patch_apply_batch: thread_pool::Batch,
    pub(crate) patch_calc_hash_batch: thread_pool::Batch,
    pub(crate) patch_task_fifo: PatchTaskFifo,
    /// We actually need to calculate the patch file hashes
    /// every single time, because someone could edit the patchfile at anytime
    ///
    /// TODO: Does this need to be atomic? It seems to be accessed only from the main thread.
    pub(crate) pending_pre_calc_hashes: AtomicU32,
    pub total_tasks: u32,

    pub pending_lifecycle_script_tasks: AtomicU32,
    pub(crate) finished_installing: AtomicBool,
    pub(crate) total_scripts: usize,

    pub(crate) root_lifecycle_scripts: Option<Package::scripts::List>,

    pub(crate) node_gyp_tempdir_name: Box<[u8]>,

    pub lockfile: Box<Lockfile>, // OWNED

    pub options: Options,
    pub(crate) preinstall_state: Vec<PreinstallState>,
    pub(crate) postinstall_optimizer: crate::postinstall_optimizer::List,

    pub(crate) global_link_dir: Option<bun_sys::Dir>,
    pub global_dir: Option<bun_sys::Dir>,
    pub(crate) global_link_dir_path: Box<[u8]>,

    pub(crate) peer_dependencies: LinearFifo<DependencyID, DynamicBuffer<DependencyID>>,

    // name hash from alias package name -> aliased package dependency version info
    pub(crate) known_npm_aliases: NpmAliasMap,

    pub(crate) event_loop: AnyEventLoop,

    // While installing packages we learn exactly what dependencies from --trust
    // actually have scripts to run, and we add them to this list
    pub(crate) trusted_deps_to_add_to_package_json: Vec<Box<[u8]>>,

    pub any_failed_to_install: bool,

    // When adding a `file:` dependency in a workspace package, we want to install it
    // relative to the workspace root, but the path provided is relative to the
    // workspace package. We keep track of the original here.
    pub original_package_json_path: ZBox,

    // null means root. Used during `clean_with_logger` to identify which
    // workspace is adding/removing packages
    pub workspace_name_hash: Option<PackageNameHash>,

    pub workspace_package_json_cache: WorkspacePackageJSONCache,

    // normally we have `UpdateRequest`s to work with for adding/deleting/updating packages, but
    // if `bun update` is used without any package names we need a way to keep information for
    // the original packages that are updating.
    //
    // dependency name -> original version information
    pub(crate) updating_packages: StringArrayHashMap<PackageUpdateInfo>,

    // (catalog name, dependency name) -> original version literal
    pub updating_catalogs: Vec<CatalogUpdateInfo>,

    // `bun update -r`/`--filter`: workspaces whose deps update. None = cwd only.
    pub update_target_workspaces: Option<Box<[UpdateTargetWorkspace]>>,

    // `bun update <name>`: packages reachable from the workspaces in scope, see update_scope::plan_named.
    pub(crate) named_update_reachable: Option<bun_collections::DynamicBitSet>,

    // bun update: patched packages a move was held back for; drained by update_transitive::print_kept_patched.
    pub(crate) kept_patched: Vec<PackageID>,
    pub kept_patched_text: Vec<u8>,

    // bun dedupe: printed by dedupe::print_dedupe_summary in place of the install summary.
    pub(crate) dedupe_report: Option<crate::dedupe::Report>,

    // add/remove/update --filter: only these importers are linked; None = every importer.
    pub(crate) filtered_link_targets: Option<workspace_selection::LinkTargets>,

    // bun add --filter: which target received which request; consumed by bind_update_requests and package_json_write_back.
    pub(crate) pending_filtered_write: Option<Box<add_remove_with_filter::PendingWrite>>,

    // package.json cache entries that differ from disk; written by package_json_write_back::flush.
    pub(crate) edited_package_jsons: Vec<package_json_write_back::EditedPackageJson>,

    // bun add: catalog references decided per target and the root entries they need; see add_catalog.rs
    pub(crate) catalog_add: add_catalog::State,

    pub(crate) patched_dependencies_to_remove:
        ArrayHashMap<PackageNameAndVersionHash, () /* , ArrayIdentityContext::U64, false */>,

    pub(crate) active_lifecycle_scripts: crate::lifecycle_script_runner::List,
    pub(crate) last_reported_slow_lifecycle_script_at: u64,
    pub(crate) cached_tick_for_slow_lifecycle_script_logging: u64,
}

/// The `.env`/environment loader the manager reads settings and proxies from.
/// The CLI owns one; under the runtime it is the VM's, which the manager only
/// reads.
pub enum EnvLoader {
    Owned(Box<dot_env::Loader>),
    Vm(bun_ptr::BackRef<dot_env::Loader>),
}

impl EnvLoader {
    #[inline]
    pub fn get(&self) -> &dot_env::Loader {
        match self {
            EnvLoader::Owned(l) => l,
            EnvLoader::Vm(l) => l.get(),
        }
    }
    #[inline]
    pub fn get_mut(&mut self) -> &mut dot_env::Loader {
        match self {
            EnvLoader::Owned(l) => l,
            EnvLoader::Vm(_) => {
                unreachable!("the runtime's env loader is read-only to the package manager")
            }
        }
    }
}

/// The part of the package manager that worker and HTTP threads touch. They
/// never see `PackageManager` itself; they hold `&'static Shared`.
pub struct Shared {
    pub pending_tasks: AtomicU32,
    /// Finished resolve/extract tasks, pushed by thread-pool workers.
    pub(crate) resolve_tasks: ResolveTaskQueue,
    /// Finished network tasks, pushed by the HTTP thread.
    pub(crate) async_network_task_queue: AsyncNetworkTaskQueue,
    /// Patch tasks that finished on the thread pool.
    pub(crate) patch_task_queue: PatchTaskQueue,
    waker: bun_event_loop::LoopWaker,
    /// Installed by the runtime (`set_on_wake`) to nudge the JS loop.
    on_wake: bun_threading::Guarded<WakeHandler>,
}

impl Shared {
    fn new(waker: bun_event_loop::LoopWaker) -> &'static Shared {
        Box::leak(Box::new(Shared {
            pending_tasks: AtomicU32::new(0),
            resolve_tasks: ResolveTaskQueue::new(),
            async_network_task_queue: AsyncNetworkTaskQueue::new(),
            patch_task_queue: PatchTaskQueue::new(),
            waker,
            on_wake: bun_threading::Guarded::new(WakeHandler::default()),
        }))
    }

    /// Wake the main install loop (and the runtime's JS loop, if one installed
    /// a handler). Callable from any thread.
    pub fn wake(&self) {
        let on_wake = *self.on_wake.lock();
        on_wake.wake(core::ptr::null_mut());
        self.waker.wakeup();
    }

    pub(crate) fn set_on_wake(&self, handler: WakeHandler) {
        *self.on_wake.lock() = handler;
    }

    pub(crate) fn on_wake(&self) -> WakeHandler {
        *self.on_wake.lock()
    }
}

#[derive(Default)]
pub struct RootPackageId {
    pub(crate) id: Option<PackageID>,
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
#[strum(serialize_all = "snake_case")] // serialized names are lowercase ("install", "update", ...)
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
    Dedupe,
    Prune,
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
    pub(crate) fn can_globally_install_packages(self) -> bool {
        matches!(self, Self::Install | Self::Update | Self::Add)
    }

    pub(crate) fn supports_workspace_filtering(self) -> bool {
        matches!(
            self,
            Self::Outdated
                | Self::Install
                | Self::Update
                | Self::Add
                | Self::Remove
                | Self::Prune
                | Self::Pm
        )
    }

    pub(crate) fn supports_json_output(self) -> bool {
        matches!(self, Self::Audit | Self::Pm | Self::Info)
    }

    // TODO: make all subcommands find root and chdir
    pub(crate) fn should_chdir_to_root(self) -> bool {
        !matches!(self, Self::Link)
    }
}

/// The resolved outcome of `--filter` for one install: the importer ids whose dependencies get installed.
pub struct WorkspaceFilter {
    pub(crate) workspace_ids: Box<[PackageID]>,
}

impl WorkspaceFilter {
    pub(crate) fn from_ids(mut ids: Vec<PackageID>) -> WorkspaceFilter {
        index_sort::sort_indices_unstable(&mut ids, &mut |a, b| a.cmp(&b));
        ids.dedup();
        WorkspaceFilter {
            workspace_ids: ids.into_boxed_slice(),
        }
    }

    #[inline]
    pub(crate) fn is_selected(filters: &[WorkspaceFilter], pkg_id: PackageID) -> bool {
        filters
            .iter()
            .all(|f| f.workspace_ids.binary_search(&pkg_id).is_ok())
    }

    /// Every workspace (root included) selected by `filter_patterns` (empty = all); warns about positive patterns that matched nothing.
    pub fn select_workspaces(
        lockfile: &crate::Lockfile,
        filter_patterns: &[&[u8]],
        original_cwd: &[u8],
    ) -> Vec<PackageID> {
        let selection = workspace_selection::select_lockfile_workspaces(
            lockfile,
            filter_patterns,
            original_cwd,
            workspace_selection::RootSelection::Implicit,
        );
        workspace_selection::warn_unmatched(filter_patterns, &selection.unmatched_patterns);
        selection.ids
    }
}

#[derive(Default)]
pub struct PackageUpdateInfo {
    pub(crate) original_version_literal: Box<[u8]>,
    // set by the post-install write-back; the install summary still needs the entry
    pub(crate) written_back: bool,
    pub(crate) original_version_string_buf: Box<[u8]>,
    pub(crate) original_version: Option<Semver::Version>,
}

pub struct CatalogUpdateInfo {
    /// Catalog group name; empty for the default catalog.
    pub catalog_name: Box<[u8]>,
    pub dep_name: Box<[u8]>,
    pub original_version_literal: Box<[u8]>,
    /// Set by package_json_editor::resolve_catalog_literals; None leaves the entry as written.
    pub new_version_literal: Option<Box<[u8]>>,
}

pub struct UpdateTargetWorkspace {
    pub is_root: bool,
    pub name_hash: PackageNameHash,
    pub name: Box<[u8]>,
}

impl UpdateTargetWorkspace {
    /// Root is unique, so `is_root` alone identifies it; members match by hash then name.
    pub fn matches(&self, is_root: bool, name_hash: PackageNameHash, name: &[u8]) -> bool {
        if self.is_root || is_root {
            return self.is_root && is_root;
        }
        self.name_hash == name_hash && &*self.name == name
    }
}

#[derive(Default)]
pub enum TrackInstalledBin {
    #[default]
    None,
    Pending,
    Basename(Box<[u8]>),
}

// MOVE_DOWN: data struct + accessors live in `bun_install_types::WakeHandler`
// (single definition the resolver also stores). The `handler` second arg is
// erased to `*mut c_void` there because that crate cannot name
// `PackageManager`; `Shared::wake` passes null and the runtime handler ignores it.
pub use bun_install_types::resolver_hooks::WakeHandler;

// ──────────────────────────────────────────────────────────────────────────
// Globals / statics
// ──────────────────────────────────────────────────────────────────────────

/// Set once during
/// single-threaded CLI startup (`PackageManagerOptions::load`) and read on
/// both the main thread and ThreadPool workers thereafter — `AtomicBool` with
/// `Relaxed` is sufficient (no ordering against other state; the write
/// happens-before any worker spawn).
static VERBOSE_INSTALL: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

impl PackageManager {
    /// Read as `PackageManager::verbose_install()` throughout the install pipeline.
    #[inline]
    pub(crate) fn verbose_install() -> bool {
        VERBOSE_INSTALL.load(core::sync::atomic::Ordering::Relaxed)
    }
    #[inline]
    pub(crate) fn set_verbose_install(v: bool) {
        VERBOSE_INSTALL.store(v, core::sync::atomic::Ordering::Relaxed);
    }

    #[inline]
    pub fn log_mut(&mut self) -> &mut bun_ast::Log {
        &mut self.log
    }

    /// The active progress download node. Panics if no download node is
    /// active — callers gate on `options.log_level.show_progress()`, which
    /// is the same condition that populates `downloads_node`.
    #[inline]
    pub(crate) fn downloads_node_mut(&mut self) -> &mut ProgressNode {
        self.downloads_node.as_mut().expect("downloads_node active")
    }

    /// The active scripts progress node, if the install pass set one up.
    #[inline]
    pub(crate) fn scripts_node_mut(&mut self) -> Option<&mut ProgressNode> {
        self.scripts_node.as_mut()
    }

    /// Associated-fn spelling that forwards to the free [`init`] so callers
    /// can write `PackageManager::init(ctx, cli, subcommand)`.
    #[inline]
    pub fn init(
        ctx: Command::Context,
        cli: CommandLineArguments,
        subcommand: Subcommand,
    ) -> Result<(&'static mut PackageManager, Box<[u8]>), Error> {
        init(ctx, cli, subcommand)
    }
}

// Only consumer is `has_enough_time_passed_between_waiting_messages`.
// Main-thread-only, so `Relaxed` suffices.
static TIME_PASSER_LAST_TIME: core::sync::atomic::AtomicU64 = core::sync::atomic::AtomicU64::new(0);

mod holder {
    use super::PackageManager;
    /// The leaked singleton, kept reachable from a global so leak checkers see
    /// everything it owns as live. Never dereferenced.
    pub(super) static LSAN_ROOT: core::sync::atomic::AtomicPtr<PackageManager> =
        core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

    /// Process-lifetime storage for `http::http_thread::InitOpts.abs_ca_file_name`.
    pub(super) static ABS_CA_FILE_NAME: std::sync::OnceLock<Box<[u8]>> = std::sync::OnceLock::new();

    /// Process-lifetime storage for `http::http_thread::InitOpts.ca` C-strings
    /// (never freed). The HTTP thread
    /// reads these asynchronously after `init()` returns, so they must outlive
    /// the local that builds them.
    pub(super) static CA: std::sync::OnceLock<Vec<bun_core::ZBox>> = std::sync::OnceLock::new();

    /// Absolute path of the root `package.json`, set once by `init()`.
    pub(super) static ROOT_PACKAGE_JSON_PATH: std::sync::OnceLock<bun_core::ZBox> =
        std::sync::OnceLock::new();
}

/// Absolute path of the root `package.json` (empty before `PackageManager::init`).
pub fn root_package_json_path() -> &'static ZStr {
    holder::ROOT_PACKAGE_JSON_PATH
        .get()
        .map(|p| p.as_zstr())
        .unwrap_or(ZStr::EMPTY)
}

// ──────────────────────────────────────────────────────────────────────────
// impl PackageManager
// ──────────────────────────────────────────────────────────────────────────

impl PackageManager {
    pub(crate) fn clear_cached_items_depending_on_lockfile_buffer(&mut self) {
        self.root_package_id.id = None;
    }

    /// Reshaped for borrowck — `Lockfile::load_from_cwd` takes the manager as
    /// a separate argument while the receiver borrows `self.lockfile`, which
    /// is a self-referential split borrow. Encapsulated here so callers stay
    /// in safe code: the returned `LoadResult` mutably borrows `self` for its
    /// lifetime, after which `self.lockfile` holds the loaded data.
    pub fn load_lockfile_from_cwd<const ATTEMPT_OTHER: bool>(
        &mut self,
    ) -> lockfile::LoadResult<'_> {
        self.load_lockfile_from_cwd_detached::<ATTEMPT_OTHER>()
            .attach(&mut self.lockfile)
    }

    /// [`load_lockfile_from_cwd`](Self::load_lockfile_from_cwd) whose result
    /// does not keep `self.lockfile` borrowed.
    pub fn load_lockfile_from_cwd_detached<const ATTEMPT_OTHER: bool>(
        &mut self,
    ) -> lockfile::DetachedLoadResult {
        // `Lockfile::load_from_cwd` takes the manager as a separate argument
        // while the receiver is `self.lockfile`; move the lockfile out for the
        // call so the two borrows are disjoint, then put the loaded one back.
        let mut lockfile = core::mem::take(&mut self.lockfile);
        let result = self.with_log(|this, log| {
            lockfile
                .load_from_cwd::<ATTEMPT_OTHER>(Some(this), log)
                .detach()
        });
        self.lockfile = lockfile;
        result
    }

    /// Is `id` a direct dependency of the root (cwd workspace) package?
    pub(crate) fn is_root_dependency(&mut self, id: DependencyID) -> bool {
        // `RootPackageId::get` caches into `self`.
        let root_id = self
            .root_package_id
            .get(&self.lockfile, self.workspace_name_hash);
        crate::lockfile::package::PackageColumns::items_dependencies(
            &self.lockfile.packages.slice(),
        )[root_id as usize]
            .contains(id)
    }

    /// Run `f` with `self.log` moved out, for callees that take the manager
    /// and the log as separate arguments; anything logged through `self.log`
    /// meanwhile is appended after.
    pub fn with_log<R>(&mut self, f: impl FnOnce(&mut Self, &mut bun_ast::Log) -> R) -> R {
        let mut log = core::mem::take(&mut self.log);
        self.log.level = log.level;
        let result = f(self, &mut log);
        let mut meanwhile = core::mem::replace(&mut self.log, log);
        meanwhile.transfer_to(&mut self.log);
        result
    }

    /// Move everything this manager has logged so far into `dest` (the
    /// runtime routes install diagnostics into whichever log the current
    /// resolve/transpile reports through).
    pub fn take_log_into(&mut self, dest: &mut bun_ast::Log) {
        self.log.transfer_to(dest);
    }

    /// Run `f` with `self.lockfile` and `self.log` moved out, for callees that
    /// take the lockfile, the manager and the log as separate arguments.
    /// `self.lockfile` is empty meanwhile.
    pub fn with_lockfile_and_log<R>(
        &mut self,
        f: impl FnOnce(&mut Lockfile, &mut Self, &mut bun_ast::Log) -> R,
    ) -> R {
        let mut lockfile = core::mem::take(&mut self.lockfile);
        let result = self.with_log(|this, log| f(&mut lockfile, this, log));
        self.lockfile = lockfile;
        result
    }

    pub(crate) fn crash(&mut self) -> ! {
        Self::crash_with_log(&self.options, &mut self.log)
    }

    pub(crate) fn crash_with_log(options: &Options, log: &mut bun_ast::Log) -> ! {
        if options.log_level != package_manager_options::LogLevel::Silent {
            // `IntoLogWrite` is impl'd for `*mut io::Writer`, not `&mut`.
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
        }
        Global::crash();
    }

    pub fn has_enough_time_passed_between_waiting_messages(&self) -> bool {
        // Main-thread only (also guards TIME_PASSER_LAST_TIME below).
        let iter = self.event_loop.iteration_number();
        if TIME_PASSER_LAST_TIME.load(core::sync::atomic::Ordering::Relaxed) < iter {
            TIME_PASSER_LAST_TIME.store(iter, core::sync::atomic::Ordering::Relaxed);
            return true;
        }
        false
    }

    /// The env loader, with everything lifecycle scripts expect in their
    /// environment (`npm_config_user_agent`, `PATH` with a `node` shim, …)
    /// added on first call.
    pub(crate) fn configure_env_for_scripts(&mut self) -> Result<&mut dot_env::Loader, Error> {
        if !CONFIGURED_ENV_FOR_SCRIPTS.load(Ordering::Acquire) {
            configure_env_for_scripts_run(self)?;
            CONFIGURED_ENV_FOR_SCRIPTS.store(true, Ordering::Release);
        }
        Ok(self.env_mut())
    }

    pub fn http_proxy(&self, url: &URL<'_>) -> Option<URL<'_>> {
        self.env().get_http_proxy_for(url)
    }

    pub fn tls_reject_unauthorized(&self) -> bool {
        self.env().get_tls_reject_unauthorized()
    }

    pub(crate) fn fail_root_resolution(
        &mut self,
        dependency: &Dependency,
        dependency_id: DependencyID,
        err: Error,
    ) {
        self.shared
            .on_wake()
            .dependency_error(dependency, dependency_id, err.name());
    }

    /// Tick the event loop until `is_done(ctx)` returns true. `ctx` owns
    /// access to the manager (see [`run_tasks::RunTasksCtx`]), so no borrow of
    /// it (or of its `event_loop`) is held while `is_done` runs.
    pub(crate) fn sleep_until<C: run_tasks::RunTasksCtx + ?Sized>(
        ctx: &mut C,
        mut is_done: impl FnMut(&mut C) -> bool,
    ) {
        Output::flush();
        // A lifecycle script can finish without the loop seeing an event
        // (its exit is reaped synchronously while spawning it), so pick those
        // up before deciding to block.
        Self::drain_lifecycle_scripts(ctx);
        while !is_done(ctx) {
            ctx.manager().event_loop.sleep_tick(core::ptr::null_mut());
            Self::drain_lifecycle_scripts(ctx);
        }
    }

    pub(crate) fn ensure_temp_node_gyp_script(&mut self) -> Result<(), Error> {
        // The body is
        // already idempotent (early-returns when `node_gyp_tempdir_name` is
        // non-empty), so a simple `AtomicBool` ran-flag suffices.
        // NB: not `bun_core::run_once!` — body is fallible and the contract is
        // "2nd call = Ok(()) regardless of 1st outcome" (D006).
        if ENSURE_TEMP_NODE_GYP_SCRIPT_ONCE.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        ensure_temp_node_gyp_script_run(self)
    }

    #[inline]
    pub fn env(&self) -> &dot_env::Loader {
        self.env.get()
    }

    /// CLI mode only (the runtime's loader is read-only here).
    #[inline]
    pub fn env_mut(&mut self) -> &mut dot_env::Loader {
        self.env.get_mut()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// run-once wrappers
// ──────────────────────────────────────────────────────────────────────────

static CONFIGURED_ENV_FOR_SCRIPTS: AtomicBool = AtomicBool::new(false);

fn configure_env_for_scripts_run(this: &mut PackageManager) -> Result<(), Error> {
    // We need to figure out the PATH and other environment variables
    // to do that, we re-use the code from bun run
    // this is expensive, it traverses the entire directory tree going up to the root
    // so we really only want to do it when strictly necessary
    let quiet = !this.log.level.at_least(bun_ast::Level::Info);
    let env = this.env_mut();
    if dot_env::instance().is_none() {
        dot_env::set_instance(env);
    }
    env.quiet = quiet;
    RunCommand::configure_env_for_run(env);

    let init_cwd_entry = this.env_mut().map.get_or_put_without_value(b"INIT_CWD")?;
    if !init_cwd_entry.found_existing {
        *init_cwd_entry.value_ptr = dot_env::HashTableValue {
            value: Box::<[u8]>::from(strings::without_trailing_slash(
                FileSystem::instance().top_level_dir(),
            )),
        };
    }

    // The resolver-tier
    // `FileSystem` mirrors `bun_paths::fs::FileSystem` for `top_level_dir`.
    let paths_fs = bun_paths::fs::FileSystem::instance();
    this.env_mut().load_ccache_path(paths_fs);

    {
        // Run node-gyp jobs in parallel.
        // https://github.com/nodejs/node-gyp/blob/7d883b5cf4c26e76065201f85b0be36d5ebdcc0e/lib/build.js#L150-L184
        let thread_count = bun_core::get_thread_count();
        if thread_count > 2 {
            let t_env = this.env_mut();
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
            let _ = this
                .env_mut()
                .load_node_js_config(paths_fs, node_path_z.as_ref())?;
        } else {
            'brk: {
                let current_path = this.env().get(b"PATH").unwrap_or(b"");
                let mut path_var: Vec<u8> = Vec::with_capacity(current_path.len());
                path_var.extend_from_slice(current_path);
                let mut bun_path: &ZStr = ZStr::EMPTY;
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

    Ok(())
}

static ENSURE_TEMP_NODE_GYP_SCRIPT_ONCE: AtomicBool = AtomicBool::new(false);

fn ensure_temp_node_gyp_script_run(manager: &mut PackageManager) -> Result<(), Error> {
    if !manager.node_gyp_tempdir_name.is_empty() {
        return Ok(());
    }

    let tempdir = get_temporary_directory(manager);
    let mut path_buf = PathBuffer::uninit();
    let node_gyp_tempdir_name =
        fs::FileSystem::tmpname(b"node-gyp", &mut path_buf.0, bun_core::fast_random())?;

    // used later for adding to path for scripts
    manager.node_gyp_tempdir_name = Box::<[u8]>::from(node_gyp_tempdir_name.as_ref());

    let node_gyp_tempdir = match tempdir
        .handle
        .make_open_path(&manager.node_gyp_tempdir_name, Default::default())
    {
        Ok(d) => d,
        Err(e) if e.get_errno() == bun_sys::E::EEXIST => {
            // it should not exist
            bun_core::pretty_errorln!("<r><red>error<r>: node-gyp tempdir already exists");
            Global::crash();
        }
        Err(e) => {
            bun_core::pretty_errorln!(
                "<r><red>error<r>: <b><red>{}<r> creating node-gyp tempdir",
                bstr::BStr::new(e.name()),
            );
            Global::crash();
        }
    };

    #[cfg(windows)]
    const FILE_NAME: &str = "node-gyp.cmd";
    #[cfg(not(windows))]
    const FILE_NAME: &str = "node-gyp";

    #[cfg(windows)]
    const MODE: u32 = 0; // windows does not have an executable bit
    #[cfg(not(windows))]
    const MODE: u32 = 0o755;

    // `bun_sys::Dir` has no `create_file`; route through `File::openat` with
    // create-file flags (`O_WRONLY|O_CREAT|O_TRUNC`).
    let node_gyp_file = match bun_sys::File::openat(
        node_gyp_tempdir.fd,
        FILE_NAME.as_bytes(),
        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC | bun_sys::O::CLOEXEC,
        MODE,
    ) {
        Ok(f) => f,
        Err(e) => {
            bun_core::pretty_errorln!(
                "<r><red>error<r>: <b><red>{}<r> creating node-gyp tempdir",
                bstr::BStr::new(e.name()),
            );
            Global::crash();
        }
    };

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
        bun_core::pretty_errorln!(
            "<r><red>error<r>: <b><red>{}<r> writing to {} file",
            bstr::BStr::new(e.name()),
            FILE_NAME,
        );
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
    // `opts.abs_ca_file_name` is NUL-terminated by contract —
    // populated in `init()` from a `ZBox` via `into_vec_with_nul()`, so the
    // stored slice length INCLUDES the trailing NUL. Re-derive the `&ZStr`
    // (NUL-stripped) once and use it for both the path resolver and the error
    // message so we don't print a literal `\0`.
    // Trailing-NUL invariant established by `init()` for any non-empty
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
        http::InitError::InvalidCRL => {
            Output::err("HTTPThread", "the CRL is invalid", ());
        }
        http::InitError::FailedToOpenSocket => {
            Output::err_generic("failed to start HTTP client thread", ());
        }
    }
    Global::crash();
}

/// The fields of [`PackageManager`] that differ between the CLI and runtime
/// constructors; everything else starts from the same defaults.
struct NewOptions {
    options: Options,
    log: Box<bun_ast::Log>,
    env: EnvLoader,
    root_dir: &'static fs::DirEntry,
    thread_pool: ThreadPool,
    event_loop: AnyEventLoop,
    shared: &'static Shared,
    root_package_json_file: bun_sys::File,
    original_package_json_path: ZBox,
    workspace_package_json_cache: WorkspacePackageJSONCache,
    workspace_name_hash: Option<PackageNameHash>,
    subcommand: Subcommand,
    root_package_json_name_at_time_of_init: Box<[u8]>,
}

impl PackageManager {
    fn new(o: NewOptions) -> PackageManager {
        PackageManager {
            cache_directory: None,
            cache_directory_path: ZBox::from_bytes(b""),
            root_dir: o.root_dir,
            ast_arena: bun_alloc::Arena::new(),
            log: o.log,
            shared: o.shared,
            timestamp_for_manifest_cache_control: 0,
            extracted_count: 0,
            summary: Default::default(),
            env: o.env,
            progress: Progress::default(),
            downloads_node: None,
            scripts_node: None,
            track_installed_bin: TrackInstalledBin::None,
            to_update: false,
            subcommand: o.subcommand,
            update_requests: Box::default(),
            update_request_index: Default::default(),
            audit_fix_pins: Box::default(),
            root_package_json_name_at_time_of_init: o.root_package_json_name_at_time_of_init,
            root_package_json_file: o.root_package_json_file,
            root_package_id: RootPackageId::default(),
            thread_pool: o.thread_pool,
            task_batch: thread_pool::Batch::default(),
            task_queue: TaskDependencyQueue::default(),
            manifests: PackageManifestMap::default(),
            folders: Default::default(),
            git_repositories: RepositoryMap::default(),
            git_commits: GitCommitMap::default(),
            git_tasks: VecDeque::new(),
            running_git_tasks: AtomicU32::new(0),
            git_env: OnceCell::new(),
            appended_task_packages: AppendedTaskPackageMap::default(),
            network_dedupe_map: Default::default(),
            network_tarball_batch: thread_pool::Batch::default(),
            network_resolve_batch: thread_pool::Batch::default(),
            network_task_fifo: NetworkQueue::new(),
            patch_apply_batch: thread_pool::Batch::default(),
            patch_calc_hash_batch: thread_pool::Batch::default(),
            patch_task_fifo: PatchTaskFifo::new(),
            pending_pre_calc_hashes: AtomicU32::new(0),
            total_tasks: 0,
            pending_lifecycle_script_tasks: AtomicU32::new(0),
            finished_installing: AtomicBool::new(false),
            total_scripts: 0,
            root_lifecycle_scripts: None,
            node_gyp_tempdir_name: Box::default(),
            lockfile: Box::new(Lockfile::default()),
            options: o.options,
            preinstall_state: Vec::new(),
            postinstall_optimizer: Default::default(),
            global_link_dir: None,
            global_dir: None,
            global_link_dir_path: Box::default(),
            peer_dependencies: LinearFifo::<DependencyID, DynamicBuffer<DependencyID>>::init(),
            known_npm_aliases: NpmAliasMap::default(),
            event_loop: o.event_loop,
            trusted_deps_to_add_to_package_json: Vec::new(),
            any_failed_to_install: false,
            original_package_json_path: o.original_package_json_path,
            workspace_name_hash: o.workspace_name_hash,
            workspace_package_json_cache: o.workspace_package_json_cache,
            updating_packages: StringArrayHashMap::default(),
            updating_catalogs: Vec::new(),
            update_target_workspaces: None,
            named_update_reachable: None,
            kept_patched: Vec::new(),
            kept_patched_text: Vec::new(),
            dedupe_report: None,
            filtered_link_targets: None,
            pending_filtered_write: None,
            edited_package_jsons: Vec::new(),
            catalog_add: add_catalog::State::default(),
            patched_dependencies_to_remove: ArrayHashMap::default(),
            active_lifecycle_scripts: Vec::new(),
            last_reported_slow_lifecycle_script_at: 0,
            cached_tick_for_slow_lifecycle_script_logging: 0,
        }
    }
}

/// Leak the manager for the process and record it as a leak-checker root.
fn publish(manager: Box<PackageManager>) -> &'static mut PackageManager {
    let manager = Box::leak(manager);
    holder::LSAN_ROOT.store(
        core::ptr::from_mut(manager),
        core::sync::atomic::Ordering::Release,
    );
    manager
}

// ──────────────────────────────────────────────────────────────────────────
// init
// ──────────────────────────────────────────────────────────────────────────

fn overlay_bunfig_install(install: &mut Api::BunInstall, bunfig: Api::BunInstall) {
    let Api::BunInstall {
        default_registry,
        scoped,
        lockfile_path,
        save_lockfile_path,
        cache_directory,
        dry_run,
        force,
        save_dev,
        save_optional,
        save_peer,
        save_lockfile,
        production,
        save_yarn_lockfile,
        disable_cache,
        disable_manifest_cache,
        global_dir,
        global_bin_dir,
        frozen_lockfile,
        exact,
        concurrent_scripts,
        cafile,
        save_text_lockfile,
        ca,
        ignore_scripts,
        link_workspace_packages,
        node_linker,
        global_store,
        security_scanner,
        minimum_release_age_ms,
        minimum_release_age_excludes,
        public_hoist_pattern,
        hoist_pattern,
        hoist,
        offline,
    } = bunfig;

    if let Some(registry) = default_registry {
        install.default_registry = Some(registry);
    }

    if let Some(bunfig_scopes) = scoped {
        match install.scoped.as_mut().filter(|m| !m.scopes.is_empty()) {
            None => install.scoped = Some(bunfig_scopes),
            Some(existing) => {
                for (name, registry) in bunfig_scopes.scopes.iter() {
                    existing.scopes.insert(name, registry.clone());
                }
            }
        }
    }

    macro_rules! overlay {
        ($($field:ident),* $(,)?) => {
            $( if $field.is_some() { install.$field = $field; } )*
        };
    }
    overlay!(
        lockfile_path,
        save_lockfile_path,
        cache_directory,
        dry_run,
        force,
        save_dev,
        save_optional,
        save_peer,
        save_lockfile,
        production,
        save_yarn_lockfile,
        disable_cache,
        disable_manifest_cache,
        global_dir,
        global_bin_dir,
        frozen_lockfile,
        exact,
        concurrent_scripts,
        cafile,
        save_text_lockfile,
        ca,
        ignore_scripts,
        link_workspace_packages,
        node_linker,
        global_store,
        security_scanner,
        minimum_release_age_ms,
        minimum_release_age_excludes,
        public_hoist_pattern,
        hoist_pattern,
        hoist,
        offline,
    );
}

/// Builds the process's package manager (once, on the CLI dispatch thread)
/// and leaks it; the caller holds the returned `&mut` for the command's
/// duration. Worker threads only ever see [`Shared`] and read-only
/// `BackRef`s handed to their tasks.
pub fn init(
    ctx: Command::Context,
    cli: CommandLineArguments,
    subcommand: Subcommand,
) -> Result<(&'static mut PackageManager, Box<[u8]>), Error> {
    // The manager owns the install log from here on; the command context is
    // re-pointed at it so the rest of the CLI reads and prints the same log.
    // If setup fails, the context gets its previous log back with whatever
    // was logged meanwhile.
    let ctx_log = ctx.log;
    let mut log = Box::new(bun_ast::Log::init());
    {
        let old = ctx.log_ref();
        log.level = old.level;
        log.clone_line_text = old.clone_line_text;
    }
    ctx.log_mut_checked().transfer_to(&mut log);
    let mut log = Some(log);
    let result = init_with_log(ctx, cli, subcommand, &mut log);
    if let Some(mut log) = log {
        ctx.log = ctx_log;
        log.transfer_to(ctx.log_mut_checked());
    }
    result
}

fn init_with_log(
    ctx: Command::Context,
    cli: CommandLineArguments,
    subcommand: Subcommand,
    log_slot: &mut Option<Box<bun_ast::Log>>,
) -> Result<(&'static mut PackageManager, Box<[u8]>), Error> {
    let log = log_slot.as_mut().expect("set by init");
    ctx.log = &raw mut **log;

    if cli.global {
        // Non-consuming peek: `ctx.install` is
        // `Option<Box<BunInstall>>` borrowed via `&mut ContextData`; reborrow with
        // `as_deref()` so the boxed config remains in `ctx` for the
        // `get_or_insert_with` calls below (npmrc loading).
        let mut explicit_global_dir: &[u8] = b"";
        if let Some(opts) = ctx.install.as_deref() {
            explicit_global_dir = opts.global_dir.as_deref().unwrap_or(explicit_global_dir);
        }
        let global_dir = package_manager_options::open_global_dir(explicit_global_dir)?;
        bun_sys::fchdir(global_dir)?;
    }

    // Registers the resolver-tier singleton
    // and seeds `top_level_dir` from `getcwd`.
    bun_resolver::fs::FileSystem::init(None)?;
    let fs = FileSystem::instance();
    let top_level_dir_no_trailing_slash = strings::without_trailing_slash(fs.top_level_dir());

    // Per-cfg const literal, no runtime alloc.
    #[cfg(windows)]
    const SEP_PACKAGE_JSON: &[u8] = b"\\package.json";
    #[cfg(not(windows))]
    const SEP_PACKAGE_JSON: &[u8] = b"/package.json";

    let mut original_package_json_path_buf: Vec<u8> =
        Vec::with_capacity(top_level_dir_no_trailing_slash.len() + SEP_PACKAGE_JSON.len() + 1);
    original_package_json_path_buf.extend_from_slice(top_level_dir_no_trailing_slash);
    original_package_json_path_buf.extend_from_slice(SEP_PACKAGE_JSON);
    original_package_json_path_buf.push(0);

    let original_cwd_clone = Box::<[u8]>::from(top_level_dir_no_trailing_slash);
    let original_cwd: &[u8] = &original_cwd_clone;

    let mut workspace_names = Package::WorkspaceMap::WorkspaceMap::init();
    let mut workspace_package_json_cache = WorkspacePackageJSONCache {
        map: Default::default(),
    };

    let mut workspace_name_hash: Option<PackageNameHash> = None;
    let mut root_package_json_name_at_time_of_init: Box<[u8]> = Box::default();

    // Step 1. Find the nearest package.json directory
    //
    // We will walk up from the cwd, trying to find the nearest package.json file.
    let mut no_project = false;
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
                            bun_core::note!("package.json must be writable to add packages");
                        } else {
                            bun_core::note!(
                                "package.json is missing read permissions, or is owned by another user"
                            );
                        }
                        Global::crash();
                    }
                    Err(e) => {
                        // `Output::err` accepts an error value directly.
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
                if cli.positionals.len() > 1 && cli.filters.is_empty() {
                    // this is `bun add <package>`.
                    //
                    // create the package.json instead of returning an error so that
                    // `bun add <pkg>` works in an empty directory.
                    this_cwd = original_cwd;
                    created_package_json = true;
                    break 'child attempt_to_create_package_json_and_open()?;
                }
            }
            if cli.no_project_ok {
                // Registry-only commands (`bun pm diff a b`) run fine from any folder: no root file, no workspaces.
                this_cwd = original_cwd;
                no_project = true;
                break 'child bun_sys::File::from_fd(bun_sys::Fd::INVALID);
            }
            return Err(crate::Error::MissingPackageJSON);
        };

        debug_assert!(strings::eql_long(
            &original_package_json_path_buf[..this_cwd.len()],
            this_cwd,
            true,
        ));
        original_package_json_path_buf.truncate(this_cwd.len());
        original_package_json_path_buf.push(SEP);
        original_package_json_path_buf.extend_from_slice(b"package.json");
        original_package_json_path_buf.push(0);

        let new_path_len = this_cwd.len() + "/package.json".len();
        let original_package_json_path =
            ZStr::from_buf(&original_package_json_path_buf[..], new_path_len);
        let child_cwd = &original_package_json_path.as_bytes()[..this_cwd.len()];

        // Check if this is a workspace; if so, use root package
        if subcommand.should_chdir_to_root() {
            if !created_package_json && !no_project {
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
                    let json_stat_size = json_file.get_end_pos()?;
                    let mut json_buf = vec![0u8; (json_stat_size + 64) as usize];
                    let json_len = json_file.pread_all(&mut json_buf, 0)?;
                    let mut json_path_buf = PathBuffer::uninit();
                    let json_path = bun_sys::get_fd_path(json_file.handle, &mut json_path_buf)?;
                    let json_source =
                        bun_ast::Source::init_path_string(&*json_path, &json_buf[..json_len]);
                    initialize_store();
                    let parsed =
                        crate::bun_json::ParsedJson::parse_package_json(&json_source, log)?;
                    let json = parsed.root;
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

                    if let Some(prop) = json.as_property(b"workspaces") {
                        let value_loc =
                            crate::bun_json::property_value_loc(&json_source.contents, prop.loc)
                                .unwrap_or(prop.loc);
                        let names = match &prop.expr.data {
                            bun_ast::ExprData::EArrayJSON(arr) => Some(
                                Package::WorkspaceMap::NamesArray::Immutable(arr.get(), value_loc),
                            ),
                            bun_ast::ExprData::EObjectJSON(obj) => obj
                                .get()
                                .properties()
                                .iter()
                                .find(|row| row.key.slice() == b"packages")
                                .and_then(|row| match &row.value {
                                    bun_ast::E::JsonValue::Array(arr) => {
                                        let packages_loc = crate::bun_json::property_value_loc(
                                            &json_source.contents,
                                            row.key_loc,
                                        )
                                        .unwrap_or(row.key_loc);
                                        Some(Package::WorkspaceMap::NamesArray::Immutable(
                                            arr.get(),
                                            packages_loc,
                                        ))
                                    }
                                    _ => None,
                                }),
                            _ => None,
                        };
                        let Some(names) = names else {
                            break;
                        };
                        let mut log = bun_ast::Log::init();
                        let _ = match workspace_names.process_names_array(
                            &mut workspace_package_json_cache,
                            &mut log,
                            names,
                            &json_source,
                            prop.loc,
                            None,
                            Package::WorkspaceMap::MissingWorkspace::Skip,
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
                                    json_source.path.name().dir,
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
                                // Intern via the resolver's DirnameStore so the slice is
                                // process-lifetime (`set_top_level_dir` requires `'static`).
                                fs.set_top_level_dir(fs.dirname_store().append(parent)?);
                                let _ = child_json.close();
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

        // Intern via DirnameStore so the slice is process-lifetime.
        fs.set_top_level_dir(fs.dirname_store().append(child_cwd)?);
        break 'root_package_json_file child_json;
    };

    let top_level_dir_z = ZBox::from_bytes(fs.top_level_dir());
    bun_sys::chdir(&top_level_dir_z)?;
    bun_bunfig::arguments::load_config(
        bun_options_types::command_tag::Tag::InstallCommand,
        cli.config,
        ctx,
    )?;
    {
        let root_package_json_path = if no_project {
            // Where the file would be; nothing reads it in this mode.
            ZBox::from_vec_with_nul(original_package_json_path_buf.clone())
        } else {
            let mut root_buf = PathBuffer::uninit();
            ZBox::from_bytes(bun_sys::get_fd_path(
                root_package_json_file.handle,
                &mut root_buf,
            )?)
        };
        let _ = holder::ROOT_PACKAGE_JSON_PATH.set(root_package_json_path);
    }

    let root_dir: &'static fs::DirEntry = match fs.read_directory(fs.top_level_dir(), 0, true)? {
        fs::EntriesOption::Entries(e) => &**e,
        fs::EntriesOption::Err(e) => return Err(e.canonical_error.into()),
    };

    let mut env = Box::new(dot_env::Loader::init());

    env.load_process()?;
    // Copy the listing's basenames out under `entries_mutex`; `.data` must
    // only be probed while the lock is held.
    let env_probe_keys = {
        let _entries_lock = FileSystem::instance().fs.entries_mutex.lock_guard();
        dot_env::DirEntryKeys(root_dir.data.iter().map(|(k, _)| Box::from(&**k)).collect())
    };
    env.load(
        &env_probe_keys,
        &[],
        dot_env::DotEnvFileSuffix::Production,
        false,
    )?;

    initialize_store();

    {
        // npmrc < bunfig < CLI
        let mut bunfig_install = ctx
            .install
            .take()
            .map_or_else(Api::BunInstall::default, |b| *b);
        let mut install = Api::BunInstall::default();
        let npmrc_local = ZBox::from_bytes(b".npmrc");

        let mut buf = PathBuffer::uninit();
        let parts = [b"./.npmrc" as &[u8]];

        // npm reads `$HOME/.npmrc` and ignores XDG_CONFIG_HOME; keep
        // `$XDG_CONFIG_HOME/.npmrc` only when that file actually exists.
        let mut global_len: usize = 0;
        if let Some(xdg_dir) = bun_core::env_var::XDG_CONFIG_HOME.get_not_empty() {
            let p =
                resolve_path::join_abs_string_buf_z::<platform::Auto>(xdg_dir, &mut buf, &parts);
            if bun_sys::exists_z(p) {
                global_len = p.len();
            }
        }
        if global_len == 0 {
            if let Some(home_dir) = bun_core::env_var::HOME.get_not_empty() {
                global_len = resolve_path::join_abs_string_buf_z::<platform::Auto>(
                    home_dir, &mut buf, &parts,
                )
                .len();
            }
        }

        let registry_auth = if global_len > 0 {
            ini::load_npmrc_config(
                &mut install,
                &env,
                true,
                &[ZStr::from_buf(&buf[..], global_len), &*npmrc_local],
            )
        } else {
            ini::load_npmrc_config(&mut install, &env, true, &[&*npmrc_local])
        };

        ini::apply_registry_auth(&mut bunfig_install, &registry_auth);
        overlay_bunfig_install(&mut install, bunfig_install);
        ctx.install = Some(Box::new(install));
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

    if PackageManager::verbose_install() {
        bun_core::pretty_errorln!("Cache Dir: {}", bstr::BStr::new(&options.cache_directory));
        Output::flush();
    }

    drop(workspace_names);

    let mut event_loop = AnyEventLoop::init();
    {
        // Write the handle back as the uws loop's parent so uSockets timers /
        // lifecycle subprocess waiters can find the mini event loop on tick.
        EventLoopHandle::from_any(&mut event_loop).set_as_parent_of_own_loop();
        // Set the thread-local global to point at the embedded mini loop
        // (`bun_event_loop::mini_event_loop::GLOBAL`).
        if let AnyEventLoop::Mini(mini) = &mut event_loop {
            let mini_ptr: *mut MiniEventLoop = &raw mut **mini;
            // Set ONLY `mini_event_loop::GLOBAL`,
            // NOT `GLOBAL_INITIALIZED`. The distinction is load-bearing: a later
            // `init_global(env, top_level_dir)` (e.g. from `bun pm pack` /
            // `pm version` lifecycle scripts → RunCommand::run_package_script_*)
            // checks `GLOBAL_INITIALIZED` and, when false, allocates a FRESH mini
            // with env/top_level_dir/uv-loop fully wired, then that becomes the
            // global. If we flip `GLOBAL_INITIALIZED` here, that call returns
            // *this* embedded mini instead — which was constructed without env,
            // without top_level_dir, and (on Windows) without going through
            // `init_global`'s uv-loop setup. The shell's IOWriter then opens
            // stdout/stderr against an under-initialised loop → EBADF (exit 9).
            mini_event_loop::GLOBAL.with(|g| g.set(mini_ptr));
        }
    }
    let shared = Shared::new(event_loop.waker());

    let manager = publish(Box::new(PackageManager::new(NewOptions {
        options,
        log: log_slot.take().expect("set by init"),
        env: EnvLoader::Owned(env),
        root_dir,
        thread_pool: ThreadPool::init(thread_pool::Config {
            max_threads: cpu_count,
            ..Default::default()
        }),
        event_loop,
        shared,
        root_package_json_file,
        original_package_json_path: ZBox::from_vec_with_nul(original_package_json_path_buf),
        workspace_package_json_cache,
        workspace_name_hash,
        subcommand,
        root_package_json_name_at_time_of_init,
    })));

    {
        // make sure folder packages can find the root package without creating a new one
        // Posix-normalize the
        // separators before hashing; `FolderResolution.hash` is always fed `/`-separated
        // bytes by every resolver-side caller. On Windows `get_fd_path` yields `\`, so
        // hashing the raw bytes would seed a key the resolver never looks up — copy into
        // a stack buffer and convert separators in place.
        let raw: &[u8] = root_package_json_path().as_bytes();
        let mut buf = PathBuffer::uninit();
        buf[..raw.len()].copy_from_slice(raw);
        let normalized = &mut buf[..raw.len()];
        resolve_path::dangerously_convert_path_to_posix_in_place::<u8>(normalized);
        manager.folders.put(
            crate::resolvers::folder_resolver::hash(normalized),
            FolderResolutionEntry {
                abs_path: Box::<[u8]>::from(&*normalized),
                resolution: FolderResolution::PackageId(0),
            },
        )?;
    }

    {
        if !manager.options.enable.cache() {
            manager.options.enable.set_manifest_cache(false);
            manager.options.enable.set_manifest_cache_control(false);
        }

        if let Some(manifest_cache) = manager.env().get(b"BUN_MANIFEST_CACHE") {
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

        {
            let PackageManager {
                options, log, env, ..
            } = &mut *manager;
            options.load(
                log,
                env.get_mut(),
                Some(cli),
                ctx.install.as_deref(),
                subcommand,
            )?;
        }

        // `install.prefer = "offline"` in bunfig (also what `bun --prefer-offline` sets
        // for the runtime's auto-install) means prefer-offline for `bun install` too,
        // unless a flag already asked for more.
        if manager.options.offline == options::OfflineMode::Online
            && ctx.debug.offline_mode_setting
                == Some(bun_options_types::offline_mode::OfflineMode::Offline)
        {
            manager.options.offline = options::OfflineMode::PreferOffline;
            // the manifest cache is the data source in this mode (see Options::load)
            manager
                .options
                .enable
                .set(options::Enable::MANIFEST_CACHE, true);
        }

        if let Some(config) = ctx.install.as_deref_mut() {
            if let Some(p) = config.public_hoist_pattern.take() {
                manager.options.public_hoist_pattern = Some(p);
            }
            if let Some(p) = config.hoist_pattern.take() {
                manager.options.hoist_pattern = Some(p);
            }
        }
    }

    let mut ca: Vec<ZBox> = Vec::new();
    {
        let options = &manager.options;
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
        let options = &manager.options;
        if !options.ca_file_name.is_empty() {
            // resolve with original cwd
            if bun_paths::is_absolute(options.ca_file_name) {
                abs_ca_file_name = ZBox::from_bytes(options.ca_file_name);
            } else {
                let mut path_buf = PathBuffer::uninit();
                abs_ca_file_name =
                    ZBox::from_bytes(resolve_path::join_abs_string_buf::<platform::Auto>(
                        &original_cwd_clone,
                        &mut path_buf,
                        &[options.ca_file_name],
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
            if manager.env().has_http_proxy() {
                break 'brk DEFAULT_MAX_SIMULTANEOUS_REQUESTS_FOR_BUN_INSTALL_FOR_PROXIES;
            }

            DEFAULT_MAX_SIMULTANEOUS_REQUESTS_FOR_BUN_INSTALL
        },
        Ordering::Relaxed, // .monotonic
    );

    // `InitOpts.ca: Vec<*const c_void>` (erased `[*:0]const u8`). The HTTP
    // thread reads these asynchronously after `init` returns, so park the
    // owning `ZBox`es in `holder::CA` for process lifetime (never freed)
    // and project the pointers from there.
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
    // string kept in `holder::ABS_CA_FILE_NAME`. `init()` runs once on the
    // main thread, so `.set()` cannot race; ignore the already-set case for
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
            if let Some(cache_control) = manager
                .env()
                .get(b"BUN_CONFIG_MANIFEST_CACHE_CONTROL_TIMESTAMP")
            {
                // env-var bytes are not guaranteed UTF-8; parse on bytes directly
                if let Ok(int) = bun_core::parse_int::<u32>(cache_control, 10) {
                    break 'brk int;
                }
            }
        }

        (u64::try_from(bun_core::time::timestamp().max(0)).expect("int cast")) as u32 // @truncate
    };
    manager.timestamp_for_manifest_cache_control = timestamp_for_manifest_cache_control;

    Ok((manager, original_cwd_clone))
}

pub(crate) fn init_with_runtime(
    log: &mut bun_ast::Log,
    // Read-only (`Options::load` only ever reads `config.*`); the resolver
    // holds it as `Option<NonNull<api::BunInstall>>`.
    bun_install: Option<&Api::BunInstall>,
    cli: CommandLineArguments,
    env: &mut dot_env::Loader,
) -> crate::Result<&'static mut PackageManager> {
    // `auto_installer::init_for_resolver` calls this at most once per process.
    if env.get(b"BUN_INSTALL_VERBOSE").is_some() {
        PackageManager::set_verbose_install(true);
    }

    // Read the root directory BEFORE allocating the singleton. This is
    // user-reachable failure (the cwd may have been deleted out from under the
    // process, or be unreadable: ENOENT/EACCES/ENOTDIR). Returns the
    // resolver's BSSMap-owned `EntriesOption` slot.
    let fs_instance = FileSystem::instance();
    let root_dir: &'static fs::DirEntry =
        match fs_instance.read_directory(fs_instance.top_level_dir(), 0, true)? {
            fs::EntriesOption::Entries(e) => &**e,
            fs::EntriesOption::Err(e) => return Err(e.canonical_error.into()),
        };

    let cpu_count: u32 = u32::from(bun_core::get_thread_count());

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

    let event_loop = AnyEventLoop::js_current();
    // The JS event loop's uws loop is created with the VM; `js_current()` only
    // wraps the handle.
    let shared = {
        let mut event_loop = AnyEventLoop::js_current();
        Shared::new(event_loop.waker())
    };
    let manager = publish(Box::new(PackageManager::new(NewOptions {
        options: Options {
            max_concurrent_lifecycle_scripts: cli
                .concurrent_scripts
                .unwrap_or((cpu_count * 2) as usize),
            ..Default::default()
        },
        // Diagnostics collect here and are moved into whichever log the
        // resolve/transpile in progress reports through; filter as it would.
        log: Box::new(bun_ast::Log {
            level: log.level,
            ..bun_ast::Log::init()
        }),
        env: EnvLoader::Vm(bun_ptr::BackRef::new(env)),
        root_dir,
        thread_pool: ThreadPool::init(thread_pool::Config {
            max_threads: cpu_count,
            ..Default::default()
        }),
        event_loop,
        shared,
        // `.root_package_json_file` is never read in the runtime
        // path. Use the explicit invalid-fd sentinel — on posix `Fd(0)` is stdin.
        root_package_json_file: bun_sys::File::from_fd(Fd::invalid()),
        original_package_json_path: ZBox::from_vec_with_nul(original_package_json_path),
        workspace_package_json_cache: WorkspacePackageJSONCache::default(),
        workspace_name_hash: None,
        subcommand: Subcommand::Install,
        root_package_json_name_at_time_of_init: Box::default(),
    })));

    if Output::enable_ansi_colors_stderr() {
        manager.progress = Progress::default();
        manager.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        let _ = manager.progress.start(b"", 0);
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
            let _ = e; // only out-of-memory is possible here
            bun_core::out_of_memory();
        }
    }

    manager.timestamp_for_manifest_cache_control =
        ((u64::try_from(bun_core::time::timestamp().max(0)).expect("int cast")) as u32)
            // When using "bun install", we check for updates with a 300 second cache.
            // When using bun, we only do staleness checks once per day
            .saturating_sub(bun_core::time::S_PER_DAY);

    // Gate the disk load on the cached dir listing so the runtime auto-install
    // path doesn't open()/read() a lockfile that isn't there.
    // `load_from_cwd` mutates `*manager.lockfile` in place and returns a
    // borrow of it, so `Ok` keeps the loaded value as-is.
    // `Lockfile::load_from_cwd(manager, …)` is a
    // self-aliasing receiver+argument pair Rust forbids. Split-borrow by
    // temporarily moving the boxed lockfile out so the `&mut PackageManager`
    // passed in does not alias the `&mut Lockfile` receiver.
    // `.data` probes must hold `entries_mutex`.
    let has_lockb = {
        let _entries_lock = FileSystem::instance().fs.entries_mutex.lock_guard();
        manager.root_dir.has_comptime_query(b"bun.lockb")
    };
    if has_lockb {
        let mut lockfile = core::mem::take(&mut manager.lockfile);
        match lockfile.load_from_cwd::<true>(Some(&mut *manager), log) {
            lockfile::LoadResult::Ok(_) => {}
            _ => lockfile.init_empty(),
        }
        manager.lockfile = lockfile;
    } else {
        manager.lockfile.init_empty();
    }
    // Anything the load logged through the manager goes to the runtime's log.
    manager.log.append_to_with_recycled(log, false);

    Ok(manager)
}
