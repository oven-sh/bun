use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::collections::VecDeque;

use crate::Error;
use crate::bun_fs as fs;
use crate::bun_fs::FileSystem;
use crate::bun_progress::{Node as ProgressNode, Progress};
use crate::bun_schema::api as Api;
use bun_collections::linear_fifo::{DynamicBuffer, StaticBuffer};
use bun_collections::{
    ArrayHashMap, HashMap, HiveArrayFallback, LinearFifo, StringArrayHashMap, index_sort,
};
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
use bun_paths::string_paths::without_trailing_slash_windows_path;
use bun_paths::{DELIMITER, PathBuffer, SEP};
use bun_semver as Semver;
use bun_sys::{self, Fd};
use bun_threading::{ThreadPool, UnboundedQueue, thread_pool};
use bun_transpiler as transpiler;
use bun_url::URL;

// `bun.spawn.process.WaiterThread` — the force-waiter-thread flag was moved
// down into `bun_spawn::process` (MOVE_DOWN b0); install just flips it during
// init. The full waiter-thread machinery (queue, signalfd, loop) lives in
// `bun_runtime::api::bun::process` and *reads* the same flag.
#[cfg(unix)]
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
#[path = "PackageManager/PopulatePackageCache.rs"]
pub mod populate_package_cache;
#[path = "PackageManager/processDependencyList.rs"]
pub mod process_dependency_list;
#[path = "PackageManager/ProgressStrings.rs"]
pub mod progress_strings;
#[path = "PackageManager/remove_stale_workspace_links.rs"]
pub(crate) mod remove_stale_workspace_links;
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
// Only the `printHelp` text is needed by `CommandLineArguments::parse`. The
// `exec()` body remains in bun_cli (it depends on tier-6 ScanCommand /
// PackCommand etc. and is the *consumer* of install, not a dependency).
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
  <b><green>bun pm<r> <blue>ls<r>                   list the tree of installed dependencies
  <d>├<r> <cyan>names ...<r>                 list every installed package with one of these names
  <d>├<r> <cyan>--all<r>                     list the entire tree of installed dependencies
  <d>├<r> <cyan>--trusted<r>                 list only trusted dependencies
  <d>├<r> <cyan>--prod<r>                    omit devDependencies
  <d>└<r> <cyan>-g<r>                        list the tree of <b>globally<r> installed dependencies
  <b><green>bun pm<r> <blue>why<r> <d>\<pkg\><r>            show dependency tree explaining why a package is installed
  <b><green>bun pm<r> <blue>diff<r> <d>[a] [b]<r>         show what changed between two versions of a package (or vs a folder/tarball)
  <d>├<r> <d>bun pm diff react<r>            installed version → latest
  <d>├<r> <d>bun pm diff react@18.2.0 19.0.0<r>
  <d>├<r> <d>bun pm diff axios@1.6.0:lib 1.6.1<r>  only files under lib/ <d>(also<r> <d>:file.js<r><d>, or paths after the two sides)<r>
  <d>├<r> <cyan>--stat<r>, <cyan>--name-only<r>       summarize instead of printing hunks
  <d>├<r> <cyan>-U<r> <d>n<r>                      lines of context (default 3)
  <d>└<r> <cyan>--json<r>                    one JSON document (files, patch text, notes, totals)
  <b><green>bun pm<r> <blue>licenses<r>             list installed packages grouped by license
  <d>├<r> <cyan>--json<r>                    output as JSON
  <d>├<r> <cyan>--prod<r>                    omit devDependencies
  <d>├<r> <cyan>--dev<r>                     list only what devDependencies pull in
  <d>├<r> <cyan>--long<r>                    also print author, description and homepage
  <d>└<r> <cyan>--filter<r> <d>\<pattern\><r>        list only the matching workspaces' dependencies
  <b><green>bun pm<r> <blue>whoami<r>               print the current npm username
  <b><green>bun pm<r> <blue>view<r> <d>name[@version] [property ...]<r>  view package metadata from the registry <d>(use `bun info` instead)<r>
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
  <d>└<r> <cyan>--dry-run<r>                 print what would be deleted without deleting anything
  <b><green>bun pm<r> <blue>cache prune<r>          remove the packages that are older than 30 days
  <d>├<r> <cyan>--max-age<r> <d>\<days\><r>          age threshold in days (default 30)
  <d>└<r> <cyan>--dry-run<r>                 print what would be removed without deleting anything
  <b><green>bun pm<r> <blue>cache pack<r><d>|<r><blue>unpack<r> <d>file<r>  save / restore the cache entries this lockfile needs as one file (for CI caches)
  <b><green>bun pm<r> <blue>fetch<r>                download all dependencies into the cache without installing
  <b><green>bun pm<r> <blue>migrate<r>              migrate another package manager's lockfile without installing anything
  <b><green>bun pm<r> <blue>untrusted<r>            print current untrusted dependencies with scripts
  <b><green>bun pm<r> <blue>trust<r> <d>names ...<r>      run scripts for untrusted dependencies and add to `trustedDependencies`
  <d>├<r>  <cyan>--all<r>                    trust all untrusted dependencies
  <d>└<r>  <cyan>--dry-run<r>                print the scripts that would run, without running them or saving
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
use crate::resolvers::folder_resolver::{
    Entry as FolderResolutionEntry, FolderResolution, Key as FolderResolutionKey,
    Kind as FolderResolutionKind,
};
use bun_install::lockfile::{self, Lockfile};
use bun_install::{
    DependencyID, NetworkTask, PackageID, PackageManifestMap, PackageNameAndVersionHash,
    PackageNameHash, PatchTask, PreinstallState, TaskCallbackContext, initialize_store,
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
    fetch_cache_directory_path, get_cache_directory, get_cache_directory_and_abs_path,
    get_temporary_directory, global_link_dir, global_link_dir_path, is_folder_in_cache,
    path_for_cached_npm_path, path_for_resolution, save_lockfile, setup_global_dir,
    update_lockfile_if_needed, write_yarn_lock,
};

pub use self::package_manager_enqueue as enqueue;
pub use enqueue::{
    enqueue_dependency_list, enqueue_dependency_to_root, enqueue_dependency_with_main,
    enqueue_extract_npm_package, enqueue_git_checkout, enqueue_git_for_checkout,
    enqueue_network_task, enqueue_package_for_download, enqueue_parse_npm_package,
    enqueue_patch_task, enqueue_patch_task_pre, enqueue_tarball_for_download,
    enqueue_tarball_for_reading,
};

pub use self::progress_strings::ProgressStrings;

pub use self::patch_package::PatchCommitResult;

pub use self::run_tasks::{
    flush_dependency_queue, flush_network_queue, flush_patch_task_queue,
    generate_network_task_for_tarball, get_network_task, run_tasks, schedule_tasks,
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

type PreallocatedTaskStore = HiveArrayFallback<Task::Task<'static>, 64>;
type PreallocatedNetworkTasks = HiveArrayFallback<NetworkTask, 128>;
type ResolveTaskQueue = UnboundedQueue<Task::Task<'static> /* , .next */>;

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
pub(crate) type FolderResolutionMap = HashMap<FolderResolutionKey, FolderResolutionEntry>;
pub(crate) type NpmAliasMap =
    HashMap<PackageNameHash, Box<[u8]> /* , IdentityContext<u64>, 80 */>;

type NetworkQueue = LinearFifo<*mut NetworkTask, StaticBuffer<*mut NetworkTask, 32>>;
type PatchTaskFifo = LinearFifo<*mut PatchTask, StaticBuffer<*mut PatchTask, 32>>;

pub type PatchTaskQueue = UnboundedQueue<PatchTask /* , .next */>;
pub type AsyncNetworkTaskQueue = UnboundedQueue<NetworkTask /* , .next */>;

pub(crate) type SuccessFn = fn(&mut PackageManager, DependencyID, PackageID);

/// What a message in `PackageManager::held_messages` is about. Only "the registry has no such
/// package" and "no such version" are held. A request that failed is reported right away.
#[derive(Clone, Copy)]
pub(crate) enum HeldAbout {
    /// The manifest has no version that this dependency accepts.
    Row(DependencyID),
    /// The registry has no such package. The dependencies that needed its manifest are in this
    /// task's entry of `task_queue`.
    Task(Task::Id),
}

// How dependencies are resolved
//
// bun.lock must only depend on the package.json files and on what the registry has, not on which
// response arrives first. So dependencies are resolved in one fixed order: the order that a run
// with every manifest already in the cache would use.
//
// - A "row" is one dependency of one package: an index into `lockfile.buffers.dependencies`.
// - `lockfile::DependencyQueue` holds the rows that are not resolved yet. Its "commanded" lane has
//   what the command itself wants resolved, and the peer dependencies. Its "found" lane has the
//   dependencies of the packages that were resolved. Commanded rows go first.
// - The "head" is the first row of the queue. It is the only row that is ever resolved, and the
//   only one that the queue waits for (`enqueue::advance`).
// - The rows behind the head "request ahead": they start their manifest requests and downloads, but
//   are not resolved (`enqueue::request_ahead`).
// - `LookAhead` goes further. It guesses which versions the waiting rows will resolve to and
//   requests the manifests that those versions will need. It never changes the lockfile.
// - A request that fails is kept as a `ManifestFailure` until a row needs it, because a request
//   made on a wrong guess must not fail the install.
// - What a git, GitHub or tarball package depends on is only known after its download, so these
//   packages are added one at a time once the queue is empty. See `RemotePackages`.

/// A manifest request that ended without a manifest. The message is logged by the first dependency
/// that needs the manifest when it is resolved, not when the answer arrives: `LookAhead` requests
/// manifests on a guess, and a failure that no dependency runs into must not fail the install.
pub(crate) struct ManifestFailure {
    /// The messages to log, stored as errors.
    pub(crate) msgs: Vec<bun_ast::Msg>,
    /// The registry answered 404, so it has no package of this name.
    pub(crate) is_missing: bool,
    /// True if no attempt got a response about the package. `fail_update_requests` reads this.
    pub(crate) is_unanswered: bool,
    /// An optional dependency that needs the manifest only logs a warning.
    pub(crate) spares_optional: bool,
    pub(crate) reported: FailureReport,
}

impl ManifestFailure {
    /// Use this for a failure that was already reported elsewhere. A dependency that needs the
    /// manifest then fails without logging anything.
    pub(crate) fn already_reported() -> Self {
        ManifestFailure {
            reported: FailureReport::Errored,
            ..Default::default()
        }
    }
}

impl Default for ManifestFailure {
    fn default() -> Self {
        ManifestFailure {
            msgs: Vec::new(),
            is_missing: false,
            is_unanswered: false,
            spares_optional: true,
            reported: FailureReport::NotYet,
        }
    }
}

/// How far along the messages of a `ManifestFailure` are in being reported.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum FailureReport {
    NotYet,
    /// In `held_messages`, where `log_held` decides between a warning and an error.
    Held,
    Warned,
    Errored,
}

/// A dependency that `LookAhead` follows.
pub(crate) struct Wanted {
    /// The name in package.json, the version range, and the name in the registry. They share a
    /// buffer so that one parsed `dependency::Version` can point at the first two.
    pub(crate) text: Box<[u8]>,
    pub(crate) alias_len: usize,
    pub(crate) range_len: usize,
    /// The hash of the name in the registry.
    pub(crate) name_hash: PackageNameHash,
    /// True if it was found during the peer pass, which installs the peers that nothing provides.
    pub(crate) follows_peers: bool,
}

/// While the dependency at the front of the queue waits for its manifest, nothing behind it can be
/// resolved, so nothing new would be requested either. To keep the network busy, `look_ahead`
/// guesses which versions the waiting dependencies will resolve to and requests the manifests that
/// those versions depend on. It only fills `PackageManager::manifests`, never the lockfile.
#[derive(Default)]
pub(crate) struct LookAhead {
    /// The packages that were looked at, by the hash of their name. One guess per package is
    /// enough: its versions mostly depend on the same packages, and a second range mostly shares
    /// the version that the first one picked.
    pub(crate) seen: HashMap<PackageNameHash, (), bun_collections::IdentityContext<u64>>,
    /// The dependency to follow once a manifest arrives, by the task that fetches it.
    pub(crate) waiting: HashMap<Task::Id, Wanted, bun_collections::IdentityContext<Task::Id>>,
    /// The manifest tasks that have finished since `request_ahead` last ran.
    pub(crate) arrived: Vec<Task::Id>,
    /// The peer pass has started. The peers of a package that it adds wait in
    /// `PackageManager::peer_dependencies` for the queue to empty, but may ask for their manifests.
    pub(crate) in_peer_pass: bool,
    /// How many entries of `PackageManager::peer_dependencies` `request_ahead` has looked at.
    pub(crate) deferred_peers_seen: usize,
}

/// A git, GitHub or tarball package that is downloaded and waits for its turn. See
/// `RemotePackages`.
pub(crate) struct ArrivedPackage {
    pub(crate) resolution: crate::Resolution,
    pub(crate) data: crate::ExtractData,
}

/// The git, GitHub and tarball packages. What such a package depends on is only known once it is
/// downloaded. If it were added to the lockfile on arrival, the place of its dependencies in the
/// queue would depend on how fast its server is. So each one is added when the queue is empty, in
/// the order of the dependencies that ask for them: `append_next_remote_package`.
#[derive(Default)]
pub(crate) struct RemotePackages {
    /// Every task that a dependency on such a package has waited for.
    pub(crate) tasks: Vec<Task::Id>,
    /// The downloaded packages whose turn has not come, by the task that fetched them.
    pub(crate) arrived:
        HashMap<Task::Id, ArrivedPackage, bun_collections::IdentityContext<Task::Id>>,
}

/// Which package `append_next_remote_package` may add.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemoteTurn {
    /// Only the package that the lowest waiting dependency needs.
    InOrder,
    /// No task is running, so a package that hasn't arrived never will. Add the lowest one that has
    /// arrived.
    NothingElseArrives,
}

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
    pub root_dir: &'static mut fs::DirEntry,
    // allocator dropped per §Allocators (was `bun.default_allocator`). For the
    // handful of sites that allocated AST nodes via `Expr.allocate(manager.allocator, …)`
    // — i.e. nodes that must outlive `Expr.Data.Store.reset()` across workspace
    // iterations — use `ast_arena` instead. The manager is a leaked singleton, so
    // this arena has process lifetime.
    pub(crate) ast_arena: bun_alloc::Arena,
    // Raw ptr rather than `&'a mut bun_ast::Log`: PackageManager is a leaked singleton
    // stored in a `static`, which cannot carry a lifetime parameter. Invariant: the
    // pointed-to Log must outlive every use of the singleton.
    pub log: *mut bun_ast::Log,
    pub(crate) resolve_tasks: ResolveTaskQueue,
    pub(crate) timestamp_for_manifest_cache_control: u32,
    pub(crate) extracted_count: u32,
    pub(crate) summary: Package::DiffSummary,
    // Set once in `init()`/`init_with_runtime()` to the process-singleton
    // `DotEnv.Loader` (leaked allocation; outlives the manager). `BackRef`
    // encapsulates the liveness invariant so `env()` is a safe accessor.
    pub env: Option<bun_ptr::BackRef<dot_env::Loader, bun_ptr::Mut>>,
    pub progress: Progress,
    pub(crate) downloads_node: Option<*mut ProgressNode>, // BORROW_FIELD — points into self.progress
    pub scripts_node: Option<NonNull<ProgressNode>>, // points to a caller stack-local Progress node; only valid while that caller frame is live
    pub(crate) progress_name_buf: [u8; 768],

    pub(crate) track_installed_bin: TrackInstalledBin,

    pub to_update: bool,

    pub subcommand: Subcommand,
    pub(crate) update_requests: Box<[UpdateRequest]>,
    pub(crate) update_request_index: update_request::UpdateRequestIndex,
    pub audit_fix_pins: Box<[crate::audit_fix::PlannedFix]>,

    /// Only set in `bun pm`
    pub root_package_json_name_at_time_of_init: Box<[u8]>,

    /// The package id corresponding to the workspace the install is happening in. Could be root, or
    /// could be any of the workspaces.
    pub root_package_id: RootPackageId,

    /// The hash of the `name` in the root package.json. `workspace_paths` only has the workspaces,
    /// not the root.
    pub(crate) workspace_root_name_hash: PackageNameHash,
    /// The `version` in the root package.json, as written. The lockfile records none for the root.
    pub(crate) workspace_root_version: Box<[u8]>,

    pub(crate) thread_pool: ThreadPool,
    pub(crate) task_batch: thread_pool::Batch,
    pub(crate) task_queue: TaskDependencyQueue,

    pub manifests: PackageManifestMap,
    pub(crate) folders: FolderResolutionMap,
    pub(crate) git_repositories: RepositoryMap,
    pub(crate) git_commits: GitCommitMap,
    /// Git tasks queued by `enqueue_git_task` and not yet started.
    pub(crate) git_tasks: VecDeque<NonNull<Task::Task<'static>>>,
    /// Git tasks whose `git_runner::GitSubprocess` is alive.
    pub(crate) running_git_tasks: AtomicU32,
    /// Set by the first git task.
    pub(crate) git_env: bun_ptr::JsCell<Option<crate::repository::GitEnv>>,
    pub(crate) appended_task_packages: AppendedTaskPackageMap,

    pub(crate) network_dedupe_map: crate::network_task::DedupeMap,
    pub(crate) async_network_task_queue: AsyncNetworkTaskQueue,
    pub(crate) network_tarball_batch: thread_pool::Batch,
    pub(crate) network_resolve_batch: thread_pool::Batch,
    pub(crate) network_task_fifo: NetworkQueue,
    pub(crate) retry_queue: crate::retry_timer::RetryQueue,
    pub(crate) patch_apply_batch: thread_pool::Batch,
    pub(crate) patch_calc_hash_batch: thread_pool::Batch,
    pub(crate) patch_task_fifo: PatchTaskFifo,
    pub(crate) patch_task_queue: PatchTaskQueue,
    /// We actually need to calculate the patch file hashes
    /// every single time, because someone could edit the patchfile at anytime
    ///
    /// TODO: Does this need to be atomic? It seems to be accessed only from the main thread.
    pub(crate) pending_pre_calc_hashes: AtomicU32,
    pub pending_tasks: AtomicU32,
    pub total_tasks: u32,
    pub(crate) preallocated_network_tasks: PreallocatedNetworkTasks,
    pub(crate) preallocated_resolve_tasks: PreallocatedTaskStore,

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

    pub(crate) on_wake: WakeHandler,

    pub(crate) peer_dependencies: LinearFifo<DependencyID, DynamicBuffer<DependencyID>>,

    // The required peer dependencies that have to agree on a version, as (name hash, dependency,
    // the package that declares it, true if no package provides it anywhere), sorted by name.
    // `enqueue::index_peer_askers` fills this and the next two fields.
    pub(crate) peer_askers: Option<Vec<(PackageNameHash, DependencyID, PackageID, bool)>>,
    // The names that the root package resolves to a folder, a tarball or a git repository.
    pub(crate) local_in_root: Vec<PackageNameHash>,
    // Every `npm:` alias as (name hash, the package that declares it, the package it resolved to).
    pub(crate) alias_rows: Vec<(PackageNameHash, PackageID, PackageID)>,
    // The packages that the keys of `patchedDependencies` name. See
    // `enqueue::index_patched_versions`.
    pub(crate) patched_versions: Option<Vec<(PackageNameHash, Semver::Version)>>,

    // Maps the name hash of an alias to the text of its `npm:` specifier. It only has the aliases
    // that the project's own package.json files declare.
    pub(crate) known_npm_aliases: NpmAliasMap,

    pub(crate) event_loop: AnyEventLoop,

    // During `installPackages` we learn exactly what dependencies from --trust
    // actually have scripts to run, and we add them to this list
    pub(crate) trusted_deps_to_add_to_package_json: Vec<Box<[u8]>>,

    pub any_failed_to_install: bool,

    // When adding a `file:` dependency in a workspace package, we want to install it
    // relative to the workspace root, but the path provided is relative to the
    // workspace package. We keep track of the original here.
    pub original_package_json_path: ZBox,

    // null means root. Used during `cleanWithLogger` to identifier which
    // workspace is adding/removing packages
    pub workspace_name_hash: Option<PackageNameHash>,

    pub workspace_package_json_cache: WorkspacePackageJSONCache,

    // normally we have `UpdateRequests` to work with for adding/deleting/updating packages, but
    // if `bun update` is used without any package names we need a way to keep information for
    // the original packages that are updating.
    //
    // dependency name (or `catalog_row_key`) -> original version information
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

    // `Some` while `bun install` resolves. A "no such package" or "no such version" message about a
    // dependency that dedupe may still drop is kept here until `log_held` decides whether to log
    // it.
    pub(crate) held_messages: Option<Vec<(HeldAbout, Vec<bun_ast::Msg>)>>,
    pub(crate) manifest_failures:
        HashMap<Task::Id, ManifestFailure, bun_collections::IdentityContext<Task::Id>>,
    pub(crate) look_ahead: LookAhead,
    pub(crate) remote_packages: RemotePackages,

    // bun dedupe: printed by dedupe::print_dedupe_summary in place of the install summary.
    pub(crate) dedupe_report: Option<crate::dedupe::Report>,

    // add/remove/update --filter: only these importers are linked; None = every importer.
    pub(crate) filtered_link_targets: Option<workspace_selection::LinkTargets>,

    // bun add --filter: which target received which request; consumed by bind_update_requests and package_json_write_back.
    pub(crate) pending_filtered_write: Option<Box<add_remove_with_filter::PendingWrite>>,

    // package.json cache entries that differ from disk; written by package_json_write_back::flush.
    pub(crate) edited_package_jsons: Vec<package_json_write_back::EditedPackageJson>,

    // Set by package_json_write_back::flush when it rewrites a file; read by the install summary.
    pub(crate) wrote_package_json: bool,

    // A migration's package.json edits, written only along with the migrated lockfile.
    pub(crate) migrated_package_json_moves: Vec<package_json_write_back::MigratedPackageJson>,

    // bun add: catalog references decided per target and the root entries they need; see add_catalog.rs
    pub(crate) catalog_add: add_catalog::State,

    pub(crate) patched_dependencies_to_remove:
        ArrayHashMap<PackageNameAndVersionHash, () /* , ArrayIdentityContext::U64, false */>,

    // For `bun patch --commit`: the files that `install_with_manager` writes and removes once its
    // checks have passed.
    pub(crate) pending_patch_commit: patch_package::PendingCommit,

    pub(crate) active_lifecycle_scripts: crate::lifecycle_script_runner::List<'static>,
    pub(crate) last_reported_slow_lifecycle_script_at: u64,
    pub(crate) cached_tick_for_slow_lifecycle_script_logging: u64,
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
                | Self::Publish
        )
    }

    pub(crate) fn supports_json_output(self) -> bool {
        matches!(self, Self::Audit | Self::Pm | Self::Info)
    }

    /// A bare `bun link` registers the folder it runs in, so it stays there. `bun link <package>`
    /// installs, like `bun add`.
    pub(crate) fn should_chdir_to_root(self, has_package_args: bool) -> bool {
        !matches!(self, Self::Link) || has_package_args
    }

    /// `init` opens package.json read-write for these so a read-only file fails before any work.
    pub(crate) fn writes_package_json(self, has_package_args: bool) -> bool {
        matches!(
            self,
            Self::Add | Self::Remove | Self::Update | Self::Patch | Self::PatchCommit
        ) || (matches!(self, Self::Install | Self::Link) && has_package_args)
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

impl PackageUpdateInfo {
    /// A name can be in several catalogs, with a different version in each. No package name
    /// contains `@catalog:`, so the key is unambiguous.
    pub(crate) fn catalog_row_key(name: &[u8], catalog_name: &[u8]) -> Vec<u8> {
        [name, b"@catalog:".as_slice(), catalog_name].concat()
    }

    /// `version`'s tag strings point into `buf`, which is rebuilt when the lockfile is cleaned, so
    /// this keeps its own copy of them.
    pub(crate) fn set_original_version(&mut self, version: Semver::Version, buf: &[u8]) {
        let mut tag_buf =
            vec![0u8; version.tag.pre.len() + version.tag.build.len()].into_boxed_slice();
        self.original_version = Some(version.clone_into(buf, &mut tag_buf, &mut 0));
        self.original_version_string_buf = tag_buf;
    }
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

// MOVE_DOWN: the data struct lives in `bun_install_types::WakeHandler`
// (single definition the resolver also stores). The `handler` second arg is
// erased to `*mut c_void` there because that crate cannot name
// `PackageManager`; `wake_raw()` casts it back at the call site.
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
    /// error, and the `Log` is a disjoint allocation. It is the caller's
    /// responsibility not to alias the returned `&mut Log` (single-threaded by
    /// construction — only the main install loop touches `log`).
    #[inline]
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
    pub(crate) fn downloads_node_mut<'a>(&self) -> &'a mut ProgressNode {
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
    pub(crate) fn scripts_node_mut<'a>(&self) -> Option<&'a mut ProgressNode> {
        let mut p = self.scripts_node?;
        // SAFETY: `scripts_node` is `Some(NonNull)` pointing at a caller
        // stack-local `ProgressNode` that outlives the install pass; access is
        // single-threaded (main install loop only).
        Some(unsafe { p.as_mut() })
    }

    /// The global singleton accessor. Associated-fn spelling that forwards to
    /// the free [`get`] so callers can write `PackageManager::get()`.
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
        // `allocate_package_manager()` before any caller of `get()`; the
        // singleton lives for the process. Shared `&` aliases freely across
        // threads.
        unsafe { &*get() }
    }

    /// Associated-fn spelling that forwards to the free [`init`] so callers
    /// can write `PackageManager::init(ctx, cli, subcommand)`.
    #[inline]
    pub fn init(
        ctx: Command::Context,
        cli: &CommandLineArguments,
        subcommand: Subcommand,
    ) -> Result<(&'static mut PackageManager, Box<[u8]>), Error> {
        init(ctx, cli, subcommand)
    }
}

// Only consumer is `hasEnoughTimePassedBetweenWaitingMessages`.
// Main-thread-only, so `Relaxed` suffices.
static TIME_PASSER_LAST_TIME: core::sync::atomic::AtomicU64 = core::sync::atomic::AtomicU64::new(0);

thread_local! {
    // bun.ThreadlocalBuffers: heap-backed so only a pointer lives in TLS
    // (see test/js/bun/binary/tls-segment-size).
    static CACHED_PACKAGE_FOLDER_NAME_BUFS: core::cell::Cell<*mut PathBuffer> =
        const { core::cell::Cell::new(core::ptr::null_mut()) };
}

#[inline]
pub(crate) fn cached_package_folder_name_buf() -> *mut PathBuffer {
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
    // OnceLock<Box<PackageManager>> can't express allocate-then-fill
    // (no `&mut` after set), so a raw ptr is used instead.
    // PORTING.md §Global mutable state: ptr written once on main thread, read
    // from worker threads → AtomicPtr (Release/Acquire pairs the publish).
    pub(super) static RAW_PTR: core::sync::atomic::AtomicPtr<PackageManager> =
        core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

    pub(super) static INITIALIZED: core::sync::atomic::AtomicBool =
        core::sync::atomic::AtomicBool::new(false);

    // Process-lifetime env storage for `init()`. Owned by the singleton, never
    // freed. Avoids `Box::leak` per PORTING.md §Forbidden. Write-once during
    // single-threaded init. `AtomicCell<*mut T>` — payload is `Copy` and
    // pointer-sized, so `.store()` is a safe Release write.
    pub(super) static ENV_LOADER: bun_core::AtomicCell<*mut dot_env::Loader> =
        bun_core::AtomicCell::new(core::ptr::null_mut());

    /// Process-lifetime storage for `http::http_thread::InitOpts.abs_ca_file_name`.
    /// `OnceLock` per PORTING.md §Forbidden — never `Box::leak` to mint `&'static`.
    pub(super) static ABS_CA_FILE_NAME: std::sync::OnceLock<Box<[u8]>> = std::sync::OnceLock::new();

    /// Process-lifetime storage for `http::http_thread::InitOpts.ca` C-strings
    /// (never freed). The HTTP thread
    /// reads these asynchronously after `init()` returns, so they must outlive
    /// the local that builds them.
    pub(super) static CA: std::sync::OnceLock<Vec<bun_core::ZBox>> = std::sync::OnceLock::new();
}

// PORTING.md §Global mutable state: single-thread (main) scratch buffers →
// RacyCell. `ROOT_PACKAGE_JSON_PATH` is a slice into the buf above it; written
// once in `init()`, read on main + CLI commands afterwards.
static CWD_BUF: bun_core::RacyCell<PathBuffer> = bun_core::RacyCell::new(PathBuffer::ZEROED);
static ROOT_PACKAGE_JSON_PATH_BUF: bun_core::RacyCell<PathBuffer> =
    bun_core::RacyCell::new(PathBuffer::ZEROED);
pub static ROOT_PACKAGE_JSON_PATH: bun_core::RacyCell<&ZStr> = bun_core::RacyCell::new(ZStr::EMPTY);

// ──────────────────────────────────────────────────────────────────────────
// impl PackageManager
// ──────────────────────────────────────────────────────────────────────────

/// What `LoadResult::Ok` holds besides the lockfile.
type LoadedParts = (
    lockfile::Migrated,
    lockfile::Serializer::SerializerLoadResult,
    lockfile::LockfileFormat,
);

impl PackageManager {
    pub(crate) fn clear_cached_items_depending_on_lockfile_buffer(&mut self) {
        self.root_package_id.id = None;
    }

    /// Reshaped for borrowck — `Lockfile::load_from_cwd` takes the manager as
    /// a separate argument while the receiver borrows `self.lockfile`, which
    /// is a self-referential split borrow. Encapsulated here so callers stay
    /// in safe code: the returned `LoadResult` mutably borrows `self` for its
    /// lifetime, after which `self.lockfile` holds the loaded data.
    pub(crate) fn load_lockfile_from_cwd<const ATTEMPT_OTHER: bool>(
        &mut self,
    ) -> lockfile::LoadResult<'_> {
        self.clear_cached_items_depending_on_lockfile_buffer();
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

    /// Exits if the lockfile exists and doesn't load. Returns `None` if there is no lockfile.
    fn load_lockfile_or_exit_if_broken<const ATTEMPT_OTHER: bool>(
        &mut self,
    ) -> Option<LoadedParts> {
        // Returning the `Ok` itself would keep `self` borrowed in the other arms of the callers.
        match self.load_lockfile_from_cwd::<ATTEMPT_OTHER>() {
            lockfile::LoadResult::Ok(ok) => Some((ok.migrated, ok.serializer_result, ok.format)),
            lockfile::LoadResult::NotFound => None,
            lockfile::LoadResult::Err(cause) => {
                if self.options.log_level != package_manager_options::LogLevel::Silent {
                    cause.report(self.log_mut());
                }
                Global::exit(1);
            }
        }
    }

    fn loaded_lockfile(
        &mut self,
        (migrated, serializer_result, format): LoadedParts,
    ) -> lockfile::LoadResult<'_> {
        lockfile::LoadResult::Ok(lockfile::LoadResultOk {
            lockfile: &mut self.lockfile,
            migrated,
            serializer_result,
            format,
        })
    }

    /// `nothing` is the end of the error message for a missing lockfile, e.g. "nothing to update".
    pub fn load_lockfile_from_cwd_or_exit<const ATTEMPT_OTHER: bool>(
        &mut self,
        nothing: &str,
    ) -> lockfile::LoadResult<'_> {
        let Some(parts) = self.load_lockfile_or_exit_if_broken::<ATTEMPT_OTHER>() else {
            if self.options.log_level != package_manager_options::LogLevel::Silent {
                if nothing.is_empty() {
                    Output::err_generic("missing lockfile", ());
                } else {
                    Output::err_generic("missing lockfile, {s}", (nothing,));
                }
                bun_core::note!("run 'bun install' first");
            }
            Global::exit(1);
        };
        self.loaded_lockfile(parts)
    }

    /// For a command that has its own answer to a missing lockfile, which comes back as `NotFound`.
    pub fn load_lockfile_from_cwd_if_any<const ATTEMPT_OTHER: bool>(
        &mut self,
    ) -> lockfile::LoadResult<'_> {
        match self.load_lockfile_or_exit_if_broken::<ATTEMPT_OTHER>() {
            Some(parts) => self.loaded_lockfile(parts),
            None => lockfile::LoadResult::NotFound,
        }
    }

    pub(crate) fn crash(&mut self) -> ! {
        if self.options.log_level != package_manager_options::LogLevel::Silent {
            // SAFETY: `self.log` points to a separate `bun_ast::Log` allocation (borrowed from
            // `ctx.log`) that outlives the singleton. `&mut self` only covers the pointer field,
            // not the pointee. `bun_ast::Log::print` takes `&self`,
            // so we only need a shared borrow here — the sole invariant is
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

    pub(crate) fn configure_env_for_scripts(
        &mut self,
        ctx: Command::Context,
    ) -> Result<&mut transpiler::Transpiler<'static>, Error> {
        // Compute once and return the cached value on
        // subsequent calls. `Transpiler` is non-`Copy` (and self-referential via
        // `linker.options = &options`), so cache by pointer in a process-static.
        // SAFETY: `PackageManager` is a leaked singleton; main-thread-only call site.
        let mut ptr = CONFIGURE_ENV_FOR_SCRIPTS_ONCE.load(core::sync::atomic::Ordering::Acquire);
        if ptr.is_null() {
            let t = configure_env_for_scripts_run(self, ctx)?;
            ptr = bun_core::heap::into_raw(Box::new(t));
            CONFIGURE_ENV_FOR_SCRIPTS_ONCE.store(ptr, core::sync::atomic::Ordering::Release);
        }
        // SAFETY: `ptr` is a leaked `Box<Transpiler>`; main-thread-only so the
        // `&mut` is exclusive for the caller's scope.
        Ok(unsafe { &mut *ptr })
    }

    pub fn http_proxy(&self, url: &URL<'_>) -> Option<URL<'static>> {
        // `env_mut()` yields an unbounded `&'a Loader` (process-lifetime
        // singleton), so the returned `URL<'_>` borrows for `'static`.
        self.env_mut().get_http_proxy_for(url)
    }

    /// The proxy settings in the environment. They are passed along with `http_proxy` so that a
    /// redirect uses the proxy that applies to its own URL.
    pub(crate) fn proxy_settings(&self) -> Option<Box<http::ProxySettings>> {
        http::ProxySettings::from_env(self.env())
    }

    pub fn tls_reject_unauthorized(&self) -> bool {
        self.env().get_tls_reject_unauthorized()
    }

    /// Auto-install blocks the JS thread while it waits for a response, so it gives up after 30
    /// seconds of silence instead of the default five minutes.
    pub(crate) fn idle_timeout_seconds(&self) -> Option<core::ffi::c_uint> {
        (self.options.runtime_auto_install
            && self.env().get(b"BUN_CONFIG_HTTP_IDLE_TIMEOUT").is_none())
        .then_some(30)
    }

    /// A blocking request, with the proxy and the certificate check the environment asks for.
    /// Send it with `send_with_retries`, unless the registry must not receive the request twice.
    pub fn registry_request<'a>(
        &self,
        method: http::Method,
        url: URL<'a>,
        headers: http::headers::EntryList,
        headers_buf: &'a [u8],
        body: &'a [u8],
    ) -> http::AsyncHTTP<'a> {
        let http_proxy = self.http_proxy(&url);
        let mut req = http::AsyncHTTP::init_sync(
            method,
            url,
            headers,
            headers_buf,
            body,
            http_proxy,
            self.proxy_settings(),
            http::FetchRedirect::Follow,
        );
        req.client.flags.reject_unauthorized = self.tls_reject_unauthorized();
        req.client.flags.redirect_credentials = http::RedirectCredentialsPolicy::HttpsUpgrade;
        req
    }

    /// Raw-pointer wake for concurrent task-thread callers (see
    /// `isolated_install::Installer::Task::callback`). Never materializes
    /// `&mut PackageManager`, so two task threads finishing simultaneously do
    /// not hold aliased exclusive borrows. `on_wake` is read-only; the handler
    /// receives the raw `*mut`;
    /// `event_loop.wakeup()` is the cross-thread signal and is
    /// internally synchronized — we reach it via `addr_of_mut!` so the `&mut`
    /// covers only the event-loop field, never the whole `PackageManager`.
    ///
    /// # Safety
    /// `this` must point to a live `PackageManager` (BACKREF).
    pub(crate) unsafe fn wake_raw(this: *mut Self) {
        // SAFETY: caller guarantees `this` points to a live `PackageManager`; we
        // only form field pointers via `addr_of!`/`addr_of_mut!` (no whole-struct
        // borrow) and `wakeup()` is internally synchronized for cross-thread use.
        unsafe {
            if let Some(wake) = (*core::ptr::addr_of!((*this).on_wake)).0 {
                // `bun_install_types` cannot name `PackageManager`: the second arg is erased.
                (wake.handler)(wake.context.as_ptr(), this.cast::<c_void>());
            }
            (*core::ptr::addr_of_mut!((*this).event_loop)).wakeup();
            if *core::ptr::addr_of!((*this).options.runtime_auto_install) {
                crate::auto_installer::Parked::wake_all();
            }
        }
    }

    /// Associated fn taking `*mut PackageManager` (NOT `&mut self`): every
    /// `is_done_fn` body in this crate reborrows the *whole* `PackageManager`
    /// from a raw pointer stashed in `C` (`&mut *closure.manager`). If this
    /// were a `&mut self` method, that whole-struct Unique retag would pop
    /// `self`'s tag (and the `&mut self.event_loop` borrow `tick` holds) under
    /// Stacked Borrows, making the next loop-iteration deref UB.
    ///
    /// SAFETY: `this` must be valid for `&mut` access between callback
    /// invocations; while `is_done_fn` runs, the callback owns the unique
    /// `&mut PackageManager` and `sleep_until`/`tick_raw` hold no borrow.
    pub(crate) unsafe fn sleep_until<C>(
        this: *mut PackageManager,
        closure: &mut C,
        is_done_fn: fn(&mut C) -> bool,
    ) {
        Output::flush();
        // `AnyEventLoop::tick_raw` takes the type-erased
        // `(*mut c_void, fn(*mut c_void) -> bool)`; trampoline through a small wrapper so
        // `is_done_fn` receives `&mut C` and can drive `run_tasks` / record `err`.
        struct Erased<C> {
            ctx: *mut C,
            is_done: fn(&mut C) -> bool,
        }
        fn trampoline<C>(p: *mut c_void) -> bool {
            let erased = p as *const Erased<C>;
            // SAFETY: `p` is the `Erased<C>` local we pass to `tick_raw` below. We only
            // read its two POD fields here (no `&mut Erased` materialized — the local
            // `&mut erased` borrow in the caller is still notionally live across the call).
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
        let event_loop: *mut AnyEventLoop = unsafe { &raw mut (*this).event_loop };
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

    // Helper: deref env (set-once BackRef to process-singleton loader)
    #[inline]
    pub(crate) fn env(&self) -> &dot_env::Loader {
        // `env` is set during init() and never None afterward; `BackRef::get`
        // encapsulates the deref under the back-reference invariant.
        self.env.as_ref().expect("env initialised").get()
    }
    #[cfg(bun_asan)]
    pub fn deinit_caches(&mut self) {
        self.workspace_package_json_cache = WorkspacePackageJSONCache::default();
        self.update_requests = Box::default();
    }

    /// Reborrow the process-global env loader.
    ///
    /// Lifetime is decoupled from `&self` for the same reason as [`log_mut`] /
    /// [`downloads_node_mut`]: the loader is a singleton-leaked allocation
    /// outside the manager (set once in `init()`), and callers interleave env
    /// mutation with disjoint `&mut self.X` field writes.
    #[inline]
    pub fn env_mut<'a>(&self) -> &'a mut dot_env::Loader {
        // SAFETY: `env` is set during `init()` and never None afterward; the
        // pointee is a process-lifetime singleton (leaked `DotEnv.Loader`)
        // that lives outside `self`, so the unbounded `'a` is sound under the
        // same single-threaded contract as `log_mut`/`scripts_node_mut`.
        // `BackRef` guarantees liveness; exclusivity is the caller's contract.
        unsafe { &mut *self.env.expect("env initialised").as_ptr() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// run-once wrappers
// ──────────────────────────────────────────────────────────────────────────

// `Transpiler` is non-`Copy` and self-referential, so cache
// a process-static raw pointer.
// PORTING.md §Global mutable state: init-once ptr → AtomicPtr.
static CONFIGURE_ENV_FOR_SCRIPTS_ONCE: core::sync::atomic::AtomicPtr<
    transpiler::Transpiler<'static>,
> = core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

fn configure_env_for_scripts_run(
    this: &mut PackageManager,
    ctx: Command::Context,
) -> Result<transpiler::Transpiler<'static>, Error> {
    // We need to figure out the PATH and other environment variables
    // to do that, we re-use the code from bun run
    // this is expensive, it traverses the entire directory tree going up to the root
    // so we really only want to do it when strictly necessary
    // `self.env` is `Option<BackRef<Loader>>`; pass the raw pointer so
    // the shim's `Transpiler::init` reuses the manager's loader instead of
    // allocating a fresh singleton.
    let env_ptr: Option<*mut dot_env::Loader> = this.env.map(|p| p.as_ptr());
    let this_transpiler = RunCommand::configure_env_for_run(ctx, env_ptr)?;

    let init_cwd_entry = this.env_mut().map.get_or_put_without_value(b"INIT_CWD")?;
    if !init_cwd_entry.found_existing {
        *init_cwd_entry.value_ptr = dot_env::HashTableValue {
            value: Box::<[u8]>::from(without_trailing_slash_windows_path(
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
        let mut node_path = bun_paths::path_buffer_pool::get();
        if let Some(node_path_z) = this.env_mut().get_node_path(paths_fs, &mut node_path) {
            let _ = this
                .env_mut()
                .load_node_js_config(paths_fs, node_path_z.as_ref())?;
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

    package_manager_lifecycle::resolve_bin_dirs_in_path(this.env_mut())?;

    Ok(this_transpiler)
}

static ENSURE_TEMP_NODE_GYP_SCRIPT_ONCE: AtomicBool = AtomicBool::new(false);

/// Kept until the process exits, because scripts find the shim through PATH.
static NODE_GYP_TEMPDIR: std::sync::OnceLock<(Fd, Box<[u8]>)> = std::sync::OnceLock::new();

extern "C" fn remove_node_gyp_tempdir() {
    if let Some((tempdir, name)) = NODE_GYP_TEMPDIR.get() {
        let _ = bun_sys::Dir::borrow(tempdir).delete_tree(name);
    }
}

fn ensure_temp_node_gyp_script_run(manager: &mut PackageManager) -> Result<(), Error> {
    if !manager.node_gyp_tempdir_name.is_empty() {
        return Ok(());
    }

    let tempdir = get_temporary_directory(manager);
    let mut path_buf = bun_paths::path_buffer_pool::get();
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
    if NODE_GYP_TEMPDIR
        .set((tempdir.handle.fd, manager.node_gyp_tempdir_name.clone()))
        .is_ok()
    {
        Global::add_exit_callback(remove_node_gyp_tempdir);
    }

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

    // `bun x` removes the PATH entry that equals BUN_WHICH_IGNORE_CWD, so the two must be identical.
    let parts: [&[u8]; 3] = [
        strings::without_trailing_slash(tempdir.name),
        &[SEP],
        &manager.node_gyp_tempdir_name,
    ];
    let node_gyp_abs_dir = parts.concat();

    // Add our node-gyp tempdir to the path
    let existing_path = manager.env().get(b"PATH").unwrap_or(b"");
    let mut path_var: Vec<u8> =
        Vec::with_capacity(existing_path.len() + 1 + node_gyp_abs_dir.len());
    path_var.extend_from_slice(existing_path);
    if !existing_path.is_empty() && existing_path[existing_path.len() - 1] != DELIMITER {
        path_var.push(DELIMITER);
    }
    path_var.extend_from_slice(&node_gyp_abs_dir);
    manager.env_mut().map.put(b"PATH", &path_var)?;

    manager
        .env_mut()
        .map
        .put_alloc_key_and_value(b"BUN_WHICH_IGNORE_CWD", &node_gyp_abs_dir)?;

    Ok(())
}

fn http_thread_on_init_error(err: http::InitError, opts: &http::http_thread::InitOpts) -> ! {
    // `opts.abs_ca_file_name` is NUL-terminated by contract —
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
        http::InitError::InvalidCRL => {
            Output::err("HTTPThread", "the CRL is invalid", ());
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

fn allocate_package_manager(
    options: Options,
    log: *mut bun_ast::Log,
    root_dir: &'static mut fs::DirEntry,
    env: &mut dot_env::Loader,
    // NUL-terminated
    original_package_json_path: Vec<u8>,
    workspace_package_json_cache: WorkspacePackageJSONCache,
    workspace_name_hash: Option<PackageNameHash>,
    subcommand: Subcommand,
    root_package_json_name_at_time_of_init: Box<[u8]>,
) -> *mut PackageManager {
    // Uninitialized memory, abort-on-OOM.
    let p = bun_core::heap::into_raw(Box::<PackageManager>::new_uninit()).cast::<PackageManager>();
    holder::RAW_PTR.store(p, core::sync::atomic::Ordering::Release);
    #[cfg(bun_asan)]
    bun_core::add_exit_callback(deinit_caches_at_exit);

    let runtime_auto_install = options.runtime_auto_install;
    // SAFETY: `p` points to uninitialized memory, fully initialized here field-by-field via
    // `addr_of_mut!((*p).field).write(..)`. No reference to it is formed before that: an uninit
    // bit pattern is invalid for its niche-bearing fields (`Box`, `Vec`, `Option<NonNull<_>>`).
    //
    // PERF NOTE — do NOT build `PackageManager` by value and `ptr::write` it.
    // Rust has no result-location semantics, so a struct literal first
    // materializes on the stack, and `PackageManager` embeds two
    // `HiveArrayFallback` pools inline (`NetworkTask` × 128 ≈ 395 KB,
    // `Task` × 64 ≈ 39 KB). The by-value form was measured at a 911 KB stack
    // frame (objdump: `subq $0xde000,%r11` probe loop, ≈220 page faults) plus
    // a ≈443 KB memcpy into the singleton. Per-field placement writes fields
    // directly to the heap and keeps the frame under 16 KB.
    unsafe {
        macro_rules! wr {
            ($field:ident, $val:expr) => {
                core::ptr::addr_of_mut!((*p).$field).write($val)
            };
        }
        // In place: zeros only the 256 B occupancy bitset; no stack temporary, no memcpy.
        PreallocatedNetworkTasks::init_in_place(core::ptr::addr_of_mut!(
            (*p).preallocated_network_tasks
        ));
        PreallocatedTaskStore::init_in_place(core::ptr::addr_of_mut!(
            (*p).preallocated_resolve_tasks
        ));

        wr!(cache_directory, None);
        wr!(cache_directory_path, ZBox::from_bytes(b""));
        wr!(options, options);
        wr!(
            active_lifecycle_scripts,
            crate::lifecycle_script_runner::List {
                root: core::ptr::null_mut(),
                context: crate::lifecycle_script_runner::StartedAtCtx,
            }
        );
        wr!(network_task_fifo, NetworkQueue::init());
        wr!(retry_queue, Default::default());
        wr!(patch_task_fifo, PatchTaskFifo::init());
        wr!(log, log);
        wr!(root_dir, root_dir);
        wr!(ast_arena, bun_alloc::Arena::new());
        wr!(env, Some(bun_ptr::BackRef::new_mut(env)));
        wr!(
            thread_pool,
            ThreadPool::init(thread_pool::Config {
                max_threads: u32::from(bun_core::get_thread_count()),
                ..Default::default()
            })
        );
        wr!(resolve_tasks, ResolveTaskQueue::default());
        wr!(lockfile, Box::new(Lockfile::default()));
        wr!(
            event_loop,
            if runtime_auto_install {
                AnyEventLoop::js_current()
            } else {
                AnyEventLoop::init()
            }
        );
        wr!(
            original_package_json_path,
            ZBox::from_vec_with_nul(original_package_json_path)
        );
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
        wr!(summary, Default::default());
        wr!(progress, Progress::default());
        wr!(downloads_node, None);
        wr!(scripts_node, None);
        wr!(progress_name_buf, [0; 768]);
        wr!(track_installed_bin, TrackInstalledBin::None);
        wr!(to_update, false);
        wr!(update_requests, Box::default());
        wr!(update_request_index, Default::default());
        wr!(audit_fix_pins, Box::default());
        wr!(root_package_id, RootPackageId::default());
        wr!(workspace_root_name_hash, 0);
        wr!(workspace_root_version, Box::default());
        wr!(task_batch, thread_pool::Batch::default());
        wr!(task_queue, TaskDependencyQueue::default());
        wr!(manifests, PackageManifestMap::default());
        wr!(folders, Default::default());
        wr!(git_repositories, RepositoryMap::default());
        wr!(git_commits, GitCommitMap::default());
        wr!(git_tasks, VecDeque::new());
        wr!(running_git_tasks, AtomicU32::new(0));
        wr!(git_env, bun_ptr::JsCell::new(None));
        wr!(appended_task_packages, AppendedTaskPackageMap::default());
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
        wr!(pending_lifecycle_script_tasks, AtomicU32::new(0));
        wr!(finished_installing, AtomicBool::new(false));
        wr!(total_scripts, 0);
        wr!(root_lifecycle_scripts, None);
        wr!(node_gyp_tempdir_name, Box::default());
        wr!(preinstall_state, Vec::new());
        wr!(postinstall_optimizer, Default::default());
        wr!(global_link_dir, None);
        wr!(global_dir, None);
        wr!(global_link_dir_path, Box::default());
        wr!(on_wake, WakeHandler::default());
        wr!(
            peer_dependencies,
            LinearFifo::<DependencyID, DynamicBuffer<DependencyID>>::init()
        );
        wr!(peer_askers, None);
        wr!(local_in_root, Vec::new());
        wr!(alias_rows, Vec::new());
        wr!(patched_versions, None);
        wr!(known_npm_aliases, NpmAliasMap::default());
        wr!(trusted_deps_to_add_to_package_json, Vec::new());
        wr!(any_failed_to_install, false);
        wr!(updating_packages, StringArrayHashMap::default());
        wr!(updating_catalogs, Vec::new());
        wr!(update_target_workspaces, None);
        wr!(named_update_reachable, None);
        wr!(kept_patched, Vec::new());
        wr!(kept_patched_text, Vec::new());
        wr!(held_messages, None);
        wr!(manifest_failures, HashMap::default());
        wr!(look_ahead, LookAhead::default());
        wr!(remote_packages, RemotePackages::default());
        wr!(dedupe_report, None);
        wr!(filtered_link_targets, None);
        wr!(pending_filtered_write, None);
        wr!(edited_package_jsons, Vec::new());
        wr!(wrote_package_json, false);
        wr!(migrated_package_json_moves, Vec::new());
        wr!(catalog_add, add_catalog::State::default());
        wr!(patched_dependencies_to_remove, ArrayHashMap::default());
        wr!(pending_patch_commit, Default::default());
        wr!(last_reported_slow_lifecycle_script_at, 0);
        wr!(cached_tick_for_slow_lifecycle_script_logging, 0);
    }
    holder::INITIALIZED.store(true, core::sync::atomic::Ordering::Release);
    // This has to come after `thread_pool` is initialized, because the callback reads it.
    bun_core::add_exit_callback(crate::npm::package_manifest::Serializer::finish_saves_at_exit);
    p
}

#[cfg(bun_asan)]
extern "C" fn deinit_caches_at_exit() {
    if !bun_crash_handler::cli_state::is_main_thread() {
        return;
    }
    if !holder::INITIALIZED.load(core::sync::atomic::Ordering::Acquire) {
        return;
    }
    let ptr = get();
    if ptr.is_null() {
        return;
    }
    // SAFETY: `deinit_caches()` only touches main-thread-owned fields.
    unsafe { (*ptr).deinit_caches() };
}

/// Returns the raw singleton pointer.
///
/// Intentionally returns `*mut` rather than `&'static mut`: this accessor is
/// invoked from thread-pool workers
/// (`UninstallTask::run`, npm `SaveTask`, `Repository` git ops) concurrently
/// with the main thread holding the `&mut PackageManager` returned by `init()`.
/// Materializing `&'static mut` here would create aliased mutable references
/// (UB). Callers must form their own narrowly-scoped reference via raw-pointer
/// projection (e.g. `unsafe { &(*get()).cache_directory_path }`) and justify
/// exclusivity / atomicity at the deref site.
pub(crate) fn get() -> *mut PackageManager {
    // `allocate_package_manager()` is the sole writer and runs on the main
    // thread before any caller of `get()`; Acquire pairs with its Release.
    holder::RAW_PTR.load(core::sync::atomic::Ordering::Acquire)
}

// ──────────────────────────────────────────────────────────────────────────
// init
// ──────────────────────────────────────────────────────────────────────────

fn overlay_bunfig_install(install: &mut Api::BunInstall, bunfig: Api::BunInstall) {
    let Api::BunInstall {
        default_registry,
        scoped,
        url_auth,
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
        provenance,
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

    install.url_auth.extend(url_auth);

    // `ca` + `cafile` are one setting: bunfig replaces both or neither.
    if ca.is_some() || cafile.is_some() {
        install.ca = ca;
        install.cafile = cafile;
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
        save_text_lockfile,
        ignore_scripts,
        provenance,
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

/// Appends `<separator>package.json\0`. A Windows drive root, `C:\`, has its separator already.
fn push_package_json(path: &mut Vec<u8>) {
    if !(cfg!(windows) && path.last().is_some_and(|&c| bun_paths::is_sep_native(c))) {
        path.push(SEP);
    }
    path.extend_from_slice(b"package.json\0");
}

/// A relative `$NPM_CONFIG_USERCONFIG` is relative to `start_dir`. A later file in `project_npmrcs`
/// overrides an earlier one, and all of them override the user's own .npmrc.
fn load_npmrc_files<'a>(
    bunfig: &Api::BunInstall,
    env: &dot_env::Loader,
    start_dir: &[u8],
    project_npmrcs: &mut dyn Iterator<Item = &'a ZStr>,
    diagnostics: ini::NpmrcDiagnostics,
) -> Api::BunInstall {
    let mut buf = bun_paths::path_buffer_pool::get();
    let parts = [b"./.npmrc" as &[u8]];
    // `None` (too long for `buf`) could not be opened either, so it counts as a missing file.
    let join = resolve_path::join_abs_string_buf_z_checked::<platform::Auto>;
    // npm's `userconfig` replaces both candidates below (actions/setup-node exports it).
    let userconfig = [b"NPM_CONFIG_USERCONFIG" as &[u8], b"npm_config_userconfig"]
        .into_iter()
        .find_map(|key| env.get(key).filter(|path| !path.is_empty()));

    // npm ignores XDG_CONFIG_HOME: `$XDG_CONFIG_HOME/.npmrc` counts only when that file exists.
    let mut global_len: usize = 0;
    // An empty or relative value is ignored, as it is when `.bunfig.toml` is looked up.
    let usable = |dir: &&[u8]| bun_paths::is_fully_qualified(dir);
    if let Some(userconfig) = userconfig {
        let userconfig = Api::BunInstall::resolve_path(start_dir, userconfig);
        global_len = join(start_dir, &mut buf, &[&userconfig[..]]).map_or(0, ZStr::len);
    } else if let Some(xdg_dir) = bun_core::env_var::XDG_CONFIG_HOME.get().filter(usable) {
        global_len =
            (join(xdg_dir, &mut buf, &parts).filter(|p| bun_sys::exists_z(p))).map_or(0, ZStr::len);
    }
    if global_len == 0 && userconfig.is_none() {
        if let Some(home_dir) = bun_core::env_var::HOME.get().filter(usable) {
            global_len = join(home_dir, &mut buf, &parts).map_or(0, ZStr::len);
        }
    }

    let user_npmrc = (global_len > 0).then(|| ZStr::from_buf(&buf[..], global_len));
    let mut paths: Vec<&ZStr> = user_npmrc.into_iter().collect();
    for path in project_npmrcs {
        paths.push(path);
    }
    let mut install = Api::BunInstall::default();
    ini::load_npmrc_config(&mut install, bunfig, env, diagnostics, &paths);
    install
}

/// Returns true if npm's `ignore-scripts` is set in the environment. It can only turn scripts off.
fn env_ignores_scripts(env: &dot_env::Loader) -> bool {
    [
        b"NPM_CONFIG_IGNORE_SCRIPTS" as &[u8],
        b"npm_config_ignore_scripts",
    ]
    .into_iter()
    .filter_map(|key| env.get(key))
    .any(|value| !value.is_empty() && ini::npm_config_bool(value))
}

/// Returns true if the configuration makes `bun install` in `cwd`, the working directory, skip
/// lifecycle scripts even without `--ignore-scripts`. This is for `bun create`, which has no
/// `PackageManager`. It resets the AST store.
pub fn config_ignores_scripts(
    ctx: Command::Context,
    env: &dot_env::Loader,
    cwd: &[u8],
) -> Result<bool, Error> {
    ::bun_bunfig::arguments::load_config(
        bun_options_types::command_tag::Tag::InstallCommand,
        None,
        ctx,
    )?;
    if env_ignores_scripts(env) {
        return Ok(true);
    }
    let no_bunfig = Api::BunInstall::default();
    let bunfig = ctx.install.as_deref().unwrap_or(&no_bunfig);
    if let Some(ignore_scripts) = bunfig.ignore_scripts {
        return Ok(ignore_scripts);
    }
    initialize_store();
    let npmrc = load_npmrc_files(
        bunfig,
        env,
        cwd,
        &mut core::iter::once(bun_core::zstr!(".npmrc")),
        ini::NpmrcDiagnostics::Discard,
    );
    Ok(npmrc.ignore_scripts.unwrap_or(false))
}

/// Returns the cache directory set in the user's own `.bunfig.toml`, or else in their `.npmrc`.
/// Those are the files that the `bun add` spawned by `bunx` reads. This is for `bunx`, which has no
/// `PackageManager`.
pub fn user_cache_directory(env: &dot_env::Loader, cwd: &[u8]) -> Option<Box<[u8]>> {
    let bunfig = (::bun_bunfig::arguments::load_user_install_section().ok())
        .flatten()
        .unwrap_or_default();
    if bunfig.cache_directory.is_some() {
        return bunfig.cache_directory;
    }
    initialize_store();
    let diagnostics = ini::NpmrcDiagnostics::Discard;
    load_npmrc_files(&bunfig, env, cwd, &mut core::iter::empty(), diagnostics).cache_directory
}

/// The upward directory walk that [`init`] does: first to the nearest `package.json`, then on to
/// the workspace root.
struct PackageJsonWalk<'a> {
    cwd: &'a [u8],
    next_dir: Option<&'a [u8]>,
    /// `<dir>/package.json` for the directory that `next` returned last. It's a `Vec` because the
    /// cwd alone can fill a path buffer.
    path: Vec<u8>,
}

impl<'a> PackageJsonWalk<'a> {
    fn new(cwd: &'a [u8]) -> Self {
        Self {
            cwd,
            next_dir: Some(cwd),
            path: Vec::with_capacity(cwd.len() + b"/package.json".len()),
        }
    }

    /// Returns the next directory and the result of opening its `package.json`.
    fn next(&mut self, flags: i32) -> Option<(&'a [u8], bun_sys::Maybe<bun_sys::File>)> {
        loop {
            let dir = self.next_dir?;
            self.next_dir = bun_core::dirname(dir);
            self.path.clear();
            self.path
                .extend_from_slice(strings::without_trailing_slash(dir));
            self.path.extend_from_slice(b"/package.json");
            let opened = bun_sys::File::openat(
                bun_sys::Fd::cwd(),
                &self.path,
                flags | bun_sys::O::CLOEXEC,
                0,
            );
            if !matches!(&opened, Err(e) if e.get_errno() == bun_sys::E::ENOENT)
                && dir.len() != self.cwd.len()
                && is_shared_directory(dir)
            {
                bun_core::warn!(
                    "ignoring package.json in <b>{}<r>: directory is writable by other users",
                    bstr::BStr::new(dir),
                );
                continue;
            }
            return Some((dir, opened));
        }
    }
}

/// Continues `walk` above `child_cwd` to find the workspace root that `child_cwd` belongs to. Only
/// the first package.json with a `workspaces` field counts. If it lists `child_cwd`, this returns
/// the root's directory, its open package.json and the hash of the workspace's name.
///
/// `last_name` receives the `name` of the last package.json that was read. `members` receives every
/// workspace, read from disk. Without `members` no workspace is read and the returned hash is 0:
/// `child_cwd` is then only matched against the patterns in `workspaces`.
fn find_workspace_root<'a>(
    walk: &mut PackageJsonWalk<'a>,
    child_cwd: &[u8],
    log: &mut bun_ast::Log,
    mut members: Option<(
        &mut Package::WorkspaceMap::WorkspaceMap,
        &mut WorkspacePackageJSONCache,
    )>,
    mut last_name: Option<&mut Box<[u8]>>,
) -> Result<Option<(&'a [u8], bun_sys::File, PackageNameHash)>, Error> {
    let found = find_workspace_root_above(
        walk,
        child_cwd,
        log,
        members
            .as_mut()
            .map(|(names, cache)| (&mut **names, &mut **cache)),
        last_name.as_deref_mut(),
    )?;
    if found.is_some() {
        return Ok(found);
    }
    // A workspace can be a symlink to a folder outside the root. The root is then only found above
    // the path that the user typed to get here.
    let Some(child_cwd) = path_as_typed(child_cwd) else {
        return Ok(None);
    };
    *walk = PackageJsonWalk::new(child_cwd);
    walk.next_dir = bun_core::dirname(child_cwd);
    if let Some((names, _)) = &mut members {
        **names = Package::WorkspaceMap::WorkspaceMap::init();
    }
    find_workspace_root_above(walk, child_cwd, log, members, last_name)
}

/// Returns `dir` as `$PWD` spells it, which keeps the symlinks that the user went through. The
/// process must have started in `dir` or below it. Returns `None` if `$PWD` gives the same path, or
/// one that does not lead to `dir`.
#[cfg(unix)]
fn path_as_typed(dir: &[u8]) -> Option<&'static [u8]> {
    let start_dir = bun_paths::fs::FileSystem::instance().initial_top_level_dir();
    let below_dir = strings::without_trailing_slash(start_dir).strip_prefix(dir)?;
    let pwd = bun_core::env_var::PWD.platform_get()?;
    let typed = strings::without_trailing_slash(pwd).strip_suffix(below_dir)?;
    if typed == dir
        || !(below_dir.is_empty() || below_dir[0] == b'/')
        || !bun_paths::is_absolute(typed)
        || strings::split_any(&typed[1..], b"/").any(|part| matches!(part, b"" | b"." | b".."))
    {
        return None;
    }
    let there = bun_sys::stat(&ZBox::from_bytes(typed)).ok()?;
    let here = bun_sys::stat(&ZBox::from_bytes(dir)).ok()?;
    (there.st_dev == here.st_dev && there.st_ino == here.st_ino).then_some(typed)
}

#[cfg(not(unix))]
fn path_as_typed(_: &[u8]) -> Option<&'static [u8]> {
    None
}

fn find_workspace_root_above<'a>(
    walk: &mut PackageJsonWalk<'a>,
    child_cwd: &[u8],
    log: &mut bun_ast::Log,
    members: Option<(
        &mut Package::WorkspaceMap::WorkspaceMap,
        &mut WorkspacePackageJSONCache,
    )>,
    mut last_name: Option<&mut Box<[u8]>>,
) -> Result<Option<(&'a [u8], bun_sys::File, PackageNameHash)>, Error> {
    // Finding the workspace root must not depend on its package.json being writable.
    while let Some((parent, opened)) = walk.next(bun_sys::O::RDONLY) {
        let Ok(json_file) = opened else {
            continue;
        };
        #[cfg(windows)]
        let mut parent_path_buf = bun_paths::path_buffer_pool::get();
        let json_stat_size = json_file.get_end_pos()?;
        let mut json_buf = vec![0u8; (json_stat_size + 64) as usize];
        let json_len = json_file.pread_all(&mut json_buf, 0)?;
        // Keep the path that was opened. The real path of the file descriptor may be on another
        // drive or outside the project. SAFETY: ROOT_PACKAGE_JSON_PATH_BUF is a process-global only
        // touched by the thread that creates the process's one manager; `&raw mut` + explicit
        // reborrow avoids the 2024 `static_mut_refs` deny.
        let json_path: &[u8] = unsafe {
            let root_buf = &mut *ROOT_PACKAGE_JSON_PATH_BUF.get();
            root_buf[..walk.path.len()].copy_from_slice(&walk.path);
            &root_buf[..walk.path.len()]
        };
        let json_source = bun_ast::Source::init_path_string(json_path, &json_buf[..json_len]);
        initialize_store();
        let parsed = crate::bun_json::ParsedJson::parse_package_json(&json_source, log)?;
        let json = parsed.root;
        if let Some(last_name) = last_name.as_deref_mut() {
            if let Some(name) = json.get(b"name").and_then(|e| {
                if let bun_ast::ExprData::EString(s) = &e.data {
                    Some(s.data.slice())
                } else {
                    None
                }
            }) {
                *last_name = Box::<[u8]>::from(name);
            }
        }

        if let Some(prop) = json.as_property(b"workspaces") {
            let value_loc = crate::bun_json::property_value_loc(&json_source.contents, prop.loc)
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
            let Some((workspace_names, workspace_package_json_cache)) = members else {
                if Package::WorkspaceMap::WorkspaceMap::lists(names, &json_source, child_cwd) {
                    return Ok(Some((parent, json_file, 0)));
                }
                break;
            };
            let mut log = bun_ast::Log::init();
            // An error here is about some other workspace. A command that needs that workspace
            // reports it later.
            let _ = workspace_names.process_names_array(
                workspace_package_json_cache,
                &mut log,
                names,
                &json_source,
                prop.loc,
                None,
                Package::WorkspaceMap::MissingWorkspace::Skip,
            );
            drop(log);

            debug_assert_eq!(workspace_names.keys().len(), workspace_names.values().len());
            for (path_, entry) in workspace_names
                .keys()
                .iter()
                .zip(workspace_names.values().iter())
            {
                let child_path: &[u8] = if bun_paths::is_absolute(path_) {
                    child_cwd
                } else {
                    resolve_path::relative_normalized::<platform::Auto, true>(
                        Package::WorkspaceMap::package_json_dir(&json_source),
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
                    let name_hash = Semver::string::Builder::string_hash(&entry.name);
                    return Ok(Some((parent, json_file, name_hash)));
                }
            }

            break;
        }
    }
    Ok(None)
}

/// Returns true if `dir` is sticky and group- or world-writable, like `/tmp`. Any local user can
/// create a `package.json` there.
#[cfg(unix)]
fn is_shared_directory(dir: &[u8]) -> bool {
    use bun_sys::S;
    !bun_sys::stat(&ZBox::from_bytes(dir)).is_ok_and(|st| {
        let mode = st.st_mode as bun_sys::Mode;
        mode & S::ISVTX == 0 || mode & (S::IWGRP | S::IWOTH) == 0
    })
}

#[cfg(not(unix))]
fn is_shared_directory(_: &[u8]) -> bool {
    false
}

/// Finds the project that `dir` is in, the way `init` does: the directory of the nearest
/// package.json, or the workspace root that this directory belongs to. A package.json that only
/// says how to read the files next to it, such as `{ "type": "commonjs" }`, belongs to the project
/// above it. If there is no project above, the topmost such directory is the project.
///
/// Returns the project's directory, and the topmost directory of the project that is `dir` or a
/// parent of it. The two differ for a workspace that a symlink leads to.
///
/// `unreadable` receives the path of a package.json that could be the project's but cannot be read
/// or parsed.
fn find_project<'a>(
    dir: &'a [u8],
    workspace_package_json_cache: &mut WorkspacePackageJSONCache,
    unreadable: &mut Option<Box<[u8]>>,
) -> Option<(&'a [u8], &'a [u8])> {
    let mut walk = PackageJsonWalk::new(dir);
    let mut project = None;
    let mut topmost = None;
    // A package.json without a `name` cannot be a workspace, so no workspace root is looked for.
    let mut is_named = false;
    while let Some((dir, opened)) = walk.next(bun_sys::O::RDONLY) {
        const OF_A_PROJECT: [&[u8]; 6] = [
            b"name",
            b"workspaces",
            b"dependencies",
            b"devDependencies",
            b"optionalDependencies",
            b"peerDependencies",
        ];
        // A directory named package.json goes on to fail in the read below, on every platform: Unix
        // opens it, and Windows reports that it is a directory.
        if opened.is_err_and(|err| !err.is_unreadable_file(&walk.path) && !err.is_directory()) {
            continue;
        }
        match workspace_package_json_cache
            .get_with_path(&mut bun_ast::Log::init(), &walk.path, Default::default())
            .unwrap()
        {
            Ok(json) if OF_A_PROJECT.iter().any(|key| json.root.get(key).is_some()) => {
                project = Some(dir);
                is_named = json.root.get(b"name").is_some_and(|name| {
                    matches!(&name.data, bun_ast::ExprData::EString(it) if !it.data.slice().is_empty())
                });
            }
            Ok(_) => {
                topmost = Some(dir);
                continue;
            }
            // This file could be the project's package.json.
            Err(_) => *unreadable = Some(walk.path.as_slice().into()),
        }
        break;
    }
    let above_dir = project.or(topmost)?;
    if project.is_some() && is_named {
        match find_workspace_root(
            &mut walk,
            without_trailing_slash_windows_path(above_dir),
            &mut bun_ast::Log::init(),
            None,
            None,
        ) {
            // The root was found above the path as the user typed it, so it is not a parent of
            // `dir`.
            Ok(Some((root, _, _))) if !core::ptr::eq(walk.cwd, dir) => {
                return Some((root, above_dir));
            }
            Ok(Some((root, _, _))) => return Some((root, root)),
            Ok(None) => {}
            // This file could be the workspace root's package.json.
            Err(_) => *unreadable = Some(walk.path.as_slice().into()),
        }
    }
    Some((above_dir, above_dir))
}

/// [`find_project`] for `bunx`, which has no `PackageManager`.
pub fn project_directory(cwd: &[u8]) -> Option<&[u8]> {
    initialize_store();
    find_project(
        without_trailing_slash_windows_path(cwd),
        &mut WorkspacePackageJSONCache::default(),
        &mut None,
    )
    .map(|(project, _)| project)
}

/// Returns `&'static mut PackageManager` — the process-singleton (held in
/// `holder::RAW_PTR`) is leaked for the process lifetime and `init()` is called
/// exactly once on the single CLI dispatch thread. Every
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
    cli: &CommandLineArguments,
    subcommand: Subcommand,
) -> Result<(&'static mut PackageManager, Box<[u8]>), Error> {
    // `.npmrc` is read below, before `Options::load` applies the log level.
    if cli.log_level.is_silent() {
        bun_ast::DEFAULT_LOG_LEVEL.store(bun_ast::Level::Err);
    }
    // SAFETY: `init()` runs on the main thread before any other access to the
    // loader. Allocate into a process-lifetime static (same pattern as
    // `holder::RAW_PTR`) instead of `Box::leak`.
    let env: &mut dot_env::Loader = unsafe {
        let mut loader_ptr = holder::ENV_LOADER.load();
        // A second `init()` runs with a different cwd, so it keeps what the first one read from the
        // `--env-file` paths.
        if loader_ptr.is_null() {
            loader_ptr = bun_core::heap::alloc(dot_env::Loader::init());
            holder::ENV_LOADER.store(loader_ptr);
        }
        &mut *loader_ptr
    };
    if !cli.env_files.is_empty() {
        // Load these before the cwd changes, because their paths are relative to it.
        env.load_process()?;
        env.load(
            &dot_env::DirEntryKeys(Vec::new()),
            cli.env_files,
            dot_env::DotEnvFileSuffix::Production,
            true,
        )?;
    }

    const CONFIG_TAG: bun_options_types::command_tag::Tag =
        bun_options_types::command_tag::Tag::InstallCommand;
    if cli.global {
        // `globalDir` is only read from the user's own bunfig or from the `--config` file.
        if cli.config.is_some() {
            ::bun_bunfig::arguments::load_config(CONFIG_TAG, cli.config, ctx)?;
        } else {
            ::bun_bunfig::arguments::load_global_bunfig(CONFIG_TAG, ctx);
        }

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
    // `C:\` keeps its separator: `C:` is the current directory of drive C, not its root.
    let top_level_dir_no_trailing_slash = without_trailing_slash_windows_path(fs.top_level_dir());
    // SAFETY: CWD_BUF is a process-global path buffer only touched on the main thread.
    // repr(transparent) makes the `*mut PathBuffer → *mut u8` cast sound.
    unsafe {
        let cwd_ptr = CWD_BUF.get().cast::<u8>();
        #[cfg(windows)]
        {
            let _ = bun_paths::path_to_posix_buf::<u8>(
                top_level_dir_no_trailing_slash,
                &mut *CWD_BUF.get(),
            );
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

    // Per-cfg const literal, no runtime alloc.
    #[cfg(windows)]
    const SEP_PACKAGE_JSON: &[u8] = b"\\package.json";
    #[cfg(not(windows))]
    const SEP_PACKAGE_JSON: &[u8] = b"/package.json";

    let mut original_package_json_path_buf: Vec<u8> =
        Vec::with_capacity(top_level_dir_no_trailing_slash.len() + SEP_PACKAGE_JSON.len() + 1);
    original_package_json_path_buf.extend_from_slice(top_level_dir_no_trailing_slash);
    push_package_json(&mut original_package_json_path_buf);

    let path_len = original_package_json_path_buf.len() - 1;
    // SAFETY: NUL written at `path_len` above. Not `from_buf`: this borrow is
    // intentionally detached — `original_package_json_path_buf` is mutated and
    // re-sliced below (the directory-walk rewrites the tail in place), and
    // borrowck cannot see that `original_package_json_path` is reassigned
    // before the next use after each mutation.
    let mut original_package_json_path =
        unsafe { ZStr::from_raw(original_package_json_path_buf.as_ptr(), path_len) };
    let original_cwd =
        &original_package_json_path.as_bytes()[..top_level_dir_no_trailing_slash.len()];
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
    let mut no_project = false;
    let root_package_json_file = 'root_package_json_file: {
        let this_cwd: &[u8];
        let mut created_package_json = false;
        let mut walk = PackageJsonWalk::new(original_cwd);
        let child_json: bun_sys::File = 'child: {
            // --dry-run and --no-save clear `Do::WRITE_PACKAGE_JSON` once the options load.
            let need_write = subcommand.writes_package_json(cli.positionals.len() > 1)
                && !cli.dry_run
                && !cli.no_save;

            while let Some((dir, opened)) = walk.next(if need_write {
                bun_sys::O::RDWR
            } else {
                bun_sys::O::RDONLY
            }) {
                // With `-g`, the project is the global directory. A package.json above it belongs
                // to some other project.
                if cli.global {
                    walk.next_dir = None;
                }
                match opened {
                    Ok(f) => {
                        this_cwd = without_trailing_slash_windows_path(dir);
                        break 'child f;
                    }
                    Err(e) if e.get_errno() == bun_sys::E::ENOENT => {}
                    Err(e) if e.get_errno() == bun_sys::E::EACCES => {
                        Output::err(
                            "EACCES",
                            "Permission denied while opening \"{s}\"",
                            &[&bstr::BStr::new(&walk.path)],
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
                            &[&bstr::BStr::new(&walk.path)],
                        );
                        return Err(e.into());
                    }
                }
            }

            if cli.dry_run
                && cli.filters.is_empty()
                && (subcommand == Subcommand::Add
                    || (subcommand == Subcommand::Install && cli.positionals.len() > 1))
            {
                // The package.json that `bun add <package>` would create here is only kept in
                // memory.
                workspace_package_json_cache.insert_unwritten(
                    &mut bun_ast::Log::init(),
                    original_package_json_path.as_bytes(),
                    directories::NEW_PACKAGE_JSON,
                )?;
                this_cwd = original_cwd;
                no_project = true;
                break 'child bun_sys::File::from_fd(bun_sys::Fd::INVALID);
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
        push_package_json(&mut original_package_json_path_buf);

        let new_path_len = original_package_json_path_buf.len() - 1;
        // SAFETY: NUL written above
        original_package_json_path =
            ZStr::from_buf(&original_package_json_path_buf[..], new_path_len);
        let child_cwd = &original_package_json_path.as_bytes()[..this_cwd.len()];

        // Check if this is a workspace; if so, use root package
        if subcommand.should_chdir_to_root(cli.positionals.len() > 1) {
            // The directories above `bunx`'s tree are the user's cache and home, so it isn't a
            // workspace of anything there.
            let is_bunx_install = run_tasks::is_bunx_tree(child_cwd);
            if !created_package_json
                && !no_project
                && !is_bunx_install
                && let Some((parent, json_file, name_hash)) = find_workspace_root(
                    &mut walk,
                    child_cwd,
                    // SAFETY: `ctx.log` is a borrow of the CLI's `Log`; valid for the
                    // duration of `init()` (set by `Command::create()` before any install
                    // entry point runs).
                    unsafe { &mut *ctx.log },
                    Some((&mut workspace_names, &mut workspace_package_json_cache)),
                    (subcommand == Subcommand::Pm)
                        .then_some(&mut root_package_json_name_at_time_of_init),
                )?
            {
                // Intern via the resolver's DirnameStore so the slice is
                // process-lifetime (`set_top_level_dir` requires `'static`).
                fs.set_top_level_dir(fs.dirname_store().append(parent)?);
                let _ = child_json.close();
                workspace_name_hash = Some(name_hash);
                // The root was found above the path as the user typed it. The root reads the
                // workspace's package.json under that path, so the same spelling is used here.
                if !core::ptr::eq(walk.cwd, original_cwd) {
                    let mut typed = walk.cwd.to_vec();
                    push_package_json(&mut typed);
                    original_package_json_path_buf = typed;
                }
                break 'root_package_json_file json_file;
            }
        }

        // Intern via DirnameStore so the slice is process-lifetime.
        fs.set_top_level_dir(fs.dirname_store().append(child_cwd)?);
        break 'root_package_json_file child_json;
    };

    let top_level_dir_z = ZBox::from_bytes(fs.top_level_dir());
    bun_sys::chdir(&top_level_dir_z)?;
    // `loadConfig` was moved down into `bun_bunfig`
    // (MOVE_DOWN b0) so install can call it directly — no fn-pointer hook.
    // (`::`-qualified because `crate::bun_bunfig` is a legacy local shim mod.)
    if !(cli.global && cli.config.is_some()) {
        ::bun_bunfig::arguments::load_config(CONFIG_TAG, cli.config, ctx)?;
    }
    // SAFETY: main-thread global
    unsafe {
        let tld = fs.top_level_dir();
        let cwd = &mut *CWD_BUF.get();
        cwd[..tld.len()].copy_from_slice(tld);
        cwd[tld.len()] = 0;
        // Route through the FsVTable setter so the resolver's cached cwd is
        // rebound to the process-lifetime CWD_BUF (it was a transient slice
        // until now). The slice excludes the NUL — `top_level_dir` is `[]u8`.
        // PathBuffer is repr(transparent) over [u8; N], so the raw cast is sound.
        fs.set_top_level_dir(bun_core::ffi::slice(CWD_BUF.get().cast::<u8>(), tld.len()));
        // Build it from `top_level_dir`, not from the fd's real path, so that relative paths never
        // cross drives.
        let root_buf = &mut *ROOT_PACKAGE_JSON_PATH_BUF.get();
        let tld_no_slash = strings::without_trailing_slash(tld);
        let plen = tld_no_slash.len() + SEP_PACKAGE_JSON.len();
        root_buf[..tld_no_slash.len()].copy_from_slice(tld_no_slash);
        root_buf[tld_no_slash.len()..plen].copy_from_slice(SEP_PACKAGE_JSON);
        root_buf[plen] = 0;
        ROOT_PACKAGE_JSON_PATH.write(ZStr::from_raw(root_buf.as_ptr(), plen));
    }
    // From here on, package.json is read by path, and written by path by the commands that write
    // it.
    let _ = root_package_json_file.close();

    // Returns the resolver's BSSMap-owned
    // `*EntriesOption` slot.
    let entries_option = match fs.read_directory(fs.top_level_dir(), 0, true)? {
        fs::EntriesOption::Entries(e) => {
            // SAFETY: the BSSMap singleton owns `*e` for the process
            // lifetime, and `init()` runs single-threaded before any other
            // access — sole exclusive borrow is sound.
            unsafe { &mut *std::ptr::from_mut::<fs::DirEntry>(*e) }
        }
        fs::EntriesOption::Err(e) => return Err(e.canonical_error.into()),
    };

    env.load_process()?;
    // This is read before the project's `.env` files are loaded, so they cannot set it.
    let env_ignores_scripts = env_ignores_scripts(env);
    if cli.env_files.is_empty() && !cli.no_env_file && !ctx.args.disable_default_env_files {
        // `.data` must only be probed while `entries_mutex` is held.
        let env_probe_keys = {
            let _entries_lock = FileSystem::instance().fs.entries_mutex.lock_guard();
            dot_env::DirEntryKeys(
                entries_option
                    .data
                    .iter()
                    .map(|(k, _)| Box::from(&**k))
                    .collect(),
            )
        };
        // Follows `BUN_ENV` / `NODE_ENV` like `bun run`, but defaults to the production set.
        let suffix = match env.get_node_env() {
            Some(b"development") => dot_env::DotEnvFileSuffix::Development,
            Some(b"test") => dot_env::DotEnvFileSuffix::Test,
            _ => dot_env::DotEnvFileSuffix::Production,
        };
        env.load(&env_probe_keys, &[], suffix, false)?;
    }
    // `bunx` sets these for this command alone. They are removed because lifecycle scripts and the
    // security scanner get a copy of this map.
    env.map.remove(b"BUN_INTERNAL_BUNX_INSTALL");
    env.map.remove(b"BUN_INTERNAL_BUNX_HAS_COPY");

    initialize_store();

    {
        // npmrc < bunfig < CLI
        let bunfig_install = ctx
            .install
            .take()
            .map_or_else(Api::BunInstall::default, |b| *b);
        let mut npmrc_local = bun_paths::path_buffer_pool::get();
        let mut install = load_npmrc_files(
            &bunfig_install,
            env,
            bun_paths::fs::FileSystem::instance().initial_top_level_dir(),
            &mut resolve_path::join_abs_string_buf_z_checked::<platform::Auto>(
                fs.top_level_dir(),
                &mut npmrc_local,
                &[b".npmrc".as_slice()],
            )
            .into_iter(),
            ini::NpmrcDiagnostics::Print,
        );

        overlay_bunfig_install(&mut install, bunfig_install);
        if env_ignores_scripts {
            install.ignore_scripts = Some(true);
        }
        ctx.install = Some(Box::new(install));
    }

    let options = Options {
        global: cli.global,
        ..Default::default()
    };

    if env.get(b"BUN_INSTALL_VERBOSE").is_some() {
        PackageManager::set_verbose_install(true);
    }

    #[cfg(unix)]
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
        bun_core::pretty_errorln!("Cache Dir: {}", bstr::BStr::new(&options.cache_directory));
        Output::flush();
    }

    drop(workspace_names); // workspace_names.map.deinit()

    let manager_ptr = allocate_package_manager(
        options,
        ctx.log,
        entries_option,
        env,
        original_package_json_path_buf,
        workspace_package_json_cache,
        workspace_name_hash,
        subcommand,
        root_package_json_name_at_time_of_init,
    );
    // The per-field placement above fully initialized the singleton; the
    // `&mut PackageManager` validity invariant now holds.
    // We do NOT bind a long-lived `&'static mut` here: `http::HTTPThread::init`
    // below spawns workers that deref `get()` concurrently, which would alias such a
    // borrow under Stacked Borrows. Instead each statement forms its own narrowly-scoped
    // reborrow via `unsafe { &mut *manager_ptr }`, dropped before the next raw-ptr use.
    {
        // SAFETY: singleton fully initialized; main thread, no workers yet.
        let manager = unsafe { &mut *manager_ptr };
        // `r#loop()` returns the process-global `*mut uws::Loop`; build the
        // handle from `&mut manager.event_loop` and write it back as the loop's
        // parent so uSockets timers / lifecycle subprocess waiters can find the
        // mini event loop on tick.
        let uws_loop = manager.event_loop.r#loop();
        // SAFETY: `uws_loop` is the live process-global `uws::Loop` (`r#loop()` above);
        // the handle's backref is `manager.event_loop`, owned by the singleton.
        let uws_loop = unsafe { &mut *uws_loop };
        EventLoopHandle::from_any(&mut manager.event_loop).set_as_parent_of(uws_loop);
    }
    {
        // make sure folder packages can find the root package without creating a new one
        // Posix-normalize the
        // separators: the folder resolver's `Key` has `/` only; on Windows this path has `\`, so
        // hashing the raw bytes would seed a key the resolver never looks up — copy into
        // a stack buffer and convert separators in place.
        // SAFETY: ROOT_PACKAGE_JSON_PATH set above on the main thread.
        let raw: &[u8] = unsafe { ROOT_PACKAGE_JSON_PATH.read() }.as_ref();
        let mut buf = bun_paths::path_buffer_pool::get();
        buf[..raw.len()].copy_from_slice(raw);
        let normalized = &mut buf[..raw.len()];
        resolve_path::dangerously_convert_path_to_posix_in_place::<u8>(normalized);
        // SAFETY: singleton fully initialized; main thread, no workers yet.
        unsafe { &mut *manager_ptr }.folders.put(
            FolderResolutionKey::new(FolderResolutionKind::Folder, normalized),
            FolderResolutionEntry {
                abs_path: Box::<[u8]>::from(&*normalized),
                resolution: FolderResolution::PackageId(0),
            },
        )?;
        // normalized.deinit() → Drop (stack buffer)
    }

    // Set the thread-local global to point at the embedded mini loop
    // (`bun_event_loop::mini_event_loop::GLOBAL`).
    {
        // SAFETY: singleton fully initialized; main thread, no workers yet.
        let evl = unsafe { &mut (*manager_ptr).event_loop };
        if let AnyEventLoop::Mini(mini) = evl {
            let mini_ptr: *mut MiniEventLoop = &raw mut **mini;
            // Set ONLY `MiniEventLoop.global`,
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
        // `options.load` applies BUN_CONFIG_MAX_HTTP_REQUESTS on top of this default.
        http::async_http::MAX_SIMULTANEOUS_REQUESTS.store(
            if env.has_http_proxy() {
                DEFAULT_MAX_SIMULTANEOUS_REQUESTS_FOR_BUN_INSTALL_FOR_PROXIES
            } else {
                DEFAULT_MAX_SIMULTANEOUS_REQUESTS_FOR_BUN_INSTALL
            },
            Ordering::Relaxed,
        );

        manager.options.load(
            // SAFETY: ctx.log is the process-lifetime CLI log set by
            // create_context_data(); single-threaded init region.
            unsafe { &mut *ctx.log },
            env,
            cli,
            ctx.install.as_deref(),
            None,
            [None, None],
            subcommand,
        )?;

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

        if let Some(network_concurrency) = cli.network_concurrency {
            http::async_http::MAX_SIMULTANEOUS_REQUESTS
                .store(usize::from(network_concurrency.max(1)), Ordering::Relaxed);
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

    let abs_ca_file_name = ZBox::from_bytes(mgr_ref.options.ca_file_name);
    // The path is still relative if joining it to its directory did not fit in a path buffer.
    if !abs_ca_file_name.is_empty() && !bun_paths::is_absolute(abs_ca_file_name.as_bytes()) {
        Output::err(
            "HTTPThread",
            "could not find CA file: '{s}'",
            &[&bstr::BStr::new(abs_ca_file_name.as_bytes())],
        );
        Global::crash();
    }

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
    // string. Park it in
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
            if let Some(cache_control) = env.get(b"BUN_CONFIG_MANIFEST_CACHE_CONTROL_TIMESTAMP") {
                // env-var bytes are not guaranteed UTF-8; parse on bytes directly
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

pub(crate) fn init_with_runtime(
    log: &mut bun_ast::Log,
    // Used read-only (`Options::load` only ever reads `config.*`).
    // Upstream storage is `Option<NonNull<api::BunInstall>>` (bundler + resolver
    // opts); taking `&mut` here would force a const→mut provenance launder at
    // the resolver call site.
    bun_install: Option<&Api::BunInstall>,
    cli: &CommandLineArguments,
    env: &mut dot_env::Loader,
    // The directory of the file whose import needs a package. Only the first call's value is used.
    importer_dir: &[u8],
) -> crate::Result<*mut PackageManager> {
    // NB: not `bun_core::run_once!` — the body is fallible (reading the root
    // directory hits ENOENT/EACCES at runtime when the cwd was deleted or is
    // unreadable), and the failure must be sticky: `holder::RAW_PTR` stays
    // null on failure, so later callers have to see the error instead of a
    // null singleton.
    static ONCE: std::sync::Once = std::sync::Once::new();
    static INIT_ERROR: bun_core::Mutex<Option<crate::Error>> = bun_core::Mutex::new(None);
    ONCE.call_once(|| {
        if let Err(err) = init_with_runtime_once(log, bun_install, cli, env, importer_dir) {
            *INIT_ERROR.lock() = Some(err);
        }
    });
    match *INIT_ERROR.lock() {
        None => Ok(get()),
        Some(code) => Err(code),
    }
}

fn init_with_runtime_once(
    log: &mut bun_ast::Log,
    bun_install: Option<&Api::BunInstall>,
    cli: &CommandLineArguments,
    env: &mut dot_env::Loader,
    importer_dir: &[u8],
) -> crate::Result<()> {
    if env.get(b"BUN_INSTALL_VERBOSE").is_some() {
        PackageManager::set_verbose_install(true);
    }

    // Read the root directory BEFORE allocating the singleton. This is
    // user-reachable failure (the cwd may have been deleted out from under the
    // process, or be unreadable: ENOENT/EACCES/ENOTDIR), and bailing out here
    // leaves `holder::RAW_PTR` null rather than pointing at an uninitialized
    // manager. Returns the resolver's BSSMap-owned `*EntriesOption` slot.
    let fs_instance = FileSystem::instance();
    let root_dir = match fs_instance.read_directory(fs_instance.top_level_dir(), 0, true)? {
        // SAFETY: the BSSMap singleton owns `*e` for the process lifetime,
        // and runtime init runs once on the main thread before any other access.
        fs::EntriesOption::Entries(e) => unsafe { &mut *std::ptr::from_mut::<fs::DirEntry>(*e) },
        fs::EntriesOption::Err(e) => return Err(e.canonical_error.into()),
    };

    // A file inside `node_modules` belongs to the project that installed the package.
    let importer_dir = match strings::index_of(importer_dir, bun_paths::NODE_MODULES_NEEDLE) {
        Some(separator) => &importer_dir[..=separator],
        None => importer_dir,
    };
    let importer_dir = without_trailing_slash_windows_path(importer_dir);
    let mut workspace_package_json_cache = WorkspacePackageJSONCache::default();
    let mut unreadable = None;
    let project = find_project(
        importer_dir,
        &mut workspace_package_json_cache,
        &mut unreadable,
    );
    // The project's bunfig.toml, .npmrc and lockfile say where packages come from. Files above the
    // project are not read.
    let (project_dir, above_importer) = project.unwrap_or((importer_dir, importer_dir));
    // A bunfig.toml or .npmrc in a folder between the importer and the project is read too, and
    // overrides the ones above it.
    let mut settings_dirs: Vec<&[u8]> = core::iter::successors(Some(importer_dir), |&dir| {
        bun_core::dirname(dir).filter(|_| dir != above_importer)
    })
    .collect();
    if project_dir != above_importer {
        settings_dirs.push(project_dir);
    }
    settings_dirs.reverse();

    // `bun_install` was loaded from the directory the process started in. `top_level_dir` is not
    // used for that, because `process.chdir()` changes it.
    let start_dir = bun_paths::fs::FileSystem::instance().initial_top_level_dir();
    let start_dir_trimmed = without_trailing_slash_windows_path(start_dir);
    // A folder nearer to the importing file overrides the ones above it, as for .npmrc. So the
    // folders below the start directory are kept apart: they override `bun_install`. If the start
    // directory is not one of the project's folders, all of them do.
    let mut root_bunfig: Option<Box<Api::BunInstall>> = None;
    let mut nearer_bunfig: Option<Box<Api::BunInstall>> = None;
    let mut merged = if settings_dirs.contains(&start_dir_trimmed) {
        &mut root_bunfig
    } else {
        &mut nearer_bunfig
    };
    for &dir in &settings_dirs {
        if dir == start_dir_trimmed {
            merged = &mut nearer_bunfig;
            continue;
        }
        match ::bun_bunfig::arguments::load_install_section(dir) {
            Ok(Some(nearer)) => match merged.as_deref_mut() {
                Some(above) => overlay_bunfig_install(above, *nearer),
                None => *merged = Some(nearer),
            },
            Ok(None) => {}
            Err(path) => unreadable = Some(path),
        }
    }
    // This also finds a scanner in a folder between the two. `bun install` wouldn't read that file,
    // but when in doubt, the scanner counts.
    let has_scanner = ::bun_bunfig::arguments::has_security_scanner(start_dir, project_dir);
    // A scanner only sees what `bun install` is about to install, so auto-install is refused.
    if [
        bun_install,
        root_bunfig.as_deref(),
        nearer_bunfig.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(|config| config.security_scanner.is_some())
        || has_scanner.unwrap_or_else(|path| {
            unreadable = Some(path);
            false
        })
    {
        return Err(bun_resolver::Error::SecurityScannerConfigured.into());
    }
    // The .npmrc in the start directory is read too, like the bunfig.toml there.
    let mut npmrc_buf = bun_paths::path_buffer_pool::get();
    let npmrcs: Vec<ZBox> = (Some(start_dir_trimmed).into_iter())
        .filter(|dir| !settings_dirs.contains(dir))
        .chain(settings_dirs.iter().copied())
        .filter_map(|dir| {
            resolve_path::join_abs_string_buf_z_checked::<platform::Auto>(
                dir,
                &mut npmrc_buf,
                &[b".npmrc".as_slice()],
            )
            .map(|path| ZBox::from_bytes(path.as_bytes()))
        })
        .collect();
    let no_bunfig = Api::BunInstall::default();
    let npmrc = load_npmrc_files(
        bun_install.unwrap_or(&no_bunfig),
        env,
        start_dir,
        &mut npmrcs.iter().map(|path| &**path),
        ini::NpmrcDiagnostics::Discard,
    );
    // The file may say where packages come from or what checks them, so nothing is installed
    // without it.
    if let Some(path) = unreadable {
        log.add_warning_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!("cannot read or parse \"{}\"", bstr::BStr::new(&path)),
        );
        return Err(bun_resolver::Error::UnreadableConfig.into());
    }

    let mut original_package_json_path =
        strings::without_trailing_slash(FileSystem::instance().top_level_dir()).to_vec();
    original_package_json_path.extend_from_slice(b"/package.json\0");
    let manager_ptr = allocate_package_manager(
        Options {
            runtime_auto_install: true,
            ..Default::default()
        },
        std::ptr::from_mut(log),
        root_dir,
        env,
        original_package_json_path,
        workspace_package_json_cache,
        None,
        Subcommand::Install,
        Box::default(),
    );
    // SAFETY: per-field placement above fully initialized the PackageManager;
    // the `&mut PackageManager` validity invariant now holds for the post-init
    // body.
    let manager = unsafe { &mut *manager_ptr };

    if Output::enable_ansi_colors_stderr() {
        manager.progress = Progress::default();
        manager.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        let _ = manager.progress.start(b"", 0);
    } else {
        manager.options.log_level = package_manager_options::LogLevel::DefaultNoProgress;
    }

    manager.options.load(
        log,
        env,
        cli,
        bun_install,
        Some(&npmrc),
        [root_bunfig.as_deref(), nearer_bunfig.as_deref()],
        Subcommand::Install,
    )?;

    manager.timestamp_for_manifest_cache_control =
        ((u64::try_from(bun_core::time::timestamp().max(0)).expect("int cast")) as u32)
            // When using "bun install", we check for updates with a 300 second cache.
            // When using bun, we only do staleness checks once per day
            .saturating_sub(bun_core::time::S_PER_DAY);

    // Gate the disk load on the cached dir listing so the runtime auto-install
    // path doesn't open()/read() a lockfile that isn't there.
    // `load_from_dir` mutates `*manager.lockfile` in place and returns a
    // borrow of it, so `Ok` keeps the loaded value as-is.
    // `Lockfile::load_from_dir(manager, …)` is a
    // self-aliasing receiver+argument pair Rust forbids. Split-borrow by
    // temporarily moving the boxed lockfile out so the `&mut PackageManager`
    // passed in does not alias the `&mut Lockfile` receiver.
    manager.lockfile.init_empty();
    if let Ok(fs::EntriesOption::Entries(entries)) =
        FileSystem::instance().read_directory(project_dir, 0, false)
        && {
            // `.data` probes must hold `entries_mutex`.
            let _entries_lock = FileSystem::instance().fs.entries_mutex.lock_guard();
            entries.has_comptime_query(b"bun.lock") || entries.has_comptime_query(b"bun.lockb")
        }
        && let Ok(dir) = bun_sys::Dir::open(project_dir)
    {
        let mut lockfile = core::mem::replace(&mut manager.lockfile, Box::new(Lockfile::default()));
        match lockfile.load_from_dir::<false>(dir.fd(), Some(&mut *manager), log) {
            lockfile::LoadResult::Ok(_) => {}
            _ => lockfile.init_empty(),
        }
        manager.lockfile = lockfile;
        // Workspace paths are relative to `root_dir`. A lockfile records them relative to its own
        // directory, and `parse_with_json` makes them relative to the working directory.
        if manager.lockfile.packages.len() > 0 {
            manager.root_dir = &mut **entries;
            // Auto-install ignores an override that points away from the registry, so it also drops
            // what such an override resolved to in the lockfile.
            use crate::lockfile_real::package::PackageColumns as _;
            let lockfile = &mut *manager.lockfile;
            let resolved_as = lockfile.packages.items_resolution();
            for (row, package_id) in
                (lockfile.buffers.dependencies.iter()).zip(lockfile.buffers.resolutions.iter_mut())
            {
                use crate::dependency::version::Tag as Declared;
                use crate::resolution::Tag;
                if matches!(row.version.tag, Declared::Npm | Declared::DistTag)
                    && resolved_as
                        .get(*package_id as usize)
                        .is_some_and(|it| !matches!(it.tag, Tag::Npm | Tag::Workspace | Tag::Root))
                {
                    *package_id = bun_install::INVALID_PACKAGE_ID;
                }
            }
            return Ok(());
        }
    }
    if project.is_some_and(|(root, _)| parse_runtime_root(manager, log, root).is_ok()) {
        return Ok(());
    }
    manager.lockfile.init_empty();
    manager.lockfile.append_package(&lockfile::Package {
        resolution: crate::resolution::Resolution::init(crate::resolution::TaggedValue::Root),
        ..Default::default()
    })?;
    Ok(())
}

/// Without a lockfile, auto-install reads the project's package.json the way `bun install` does,
/// for its overrides, catalogs and workspaces. Each dependency is only resolved when it is
/// imported.
fn parse_runtime_root(
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    root_dir: &[u8],
) -> crate::Result<()> {
    let mut path = root_dir.to_vec();
    push_package_json(&mut path);
    // The messages in this log point into `source`.
    let mut parse_log = bun_ast::Log::init();
    // Cloned because the `workspaces` walk below may grow the cache holding this entry.
    let (source, json) = {
        let entry = manager
            .workspace_package_json_cache
            .get_with_path(&mut parse_log, &path[..path.len() - 1], Default::default())
            .unwrap()?;
        (entry.source.clone(), entry.root)
    };
    let mut root = lockfile::Package::default();
    let mut lockfile = core::mem::replace(&mut manager.lockfile, Box::new(Lockfile::default()));
    let result = root
        .parse_with_json(
            &mut lockfile,
            manager,
            &mut parse_log,
            &source,
            json,
            &mut (),
            bun_install::Features {
                is_main: true,
                dev_dependencies: true,
                optional_dependencies: true,
                workspaces: true,
                ..Default::default()
            },
        )
        .and_then(|()| {
            lockfile.append_package(&root)?;
            Ok(())
        });
    manager.lockfile = lockfile;
    if parse_log.errors > 0 {
        parse_log.append_to_with_recycled(log, true);
    }
    result
}
