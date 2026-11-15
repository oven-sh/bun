use core::cell::Cell;
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering};
use std::collections::VecDeque;
use std::sync::{Arc, OnceLock};

use crate::Error;
use crate::bun_fs as fs;
use crate::bun_fs::FileSystem;
use crate::bun_progress::{NodeId as ProgressNodeId, Progress};
use crate::bun_schema::api as Api;
use bun_collections::linear_fifo::DynamicBuffer;
use bun_collections::{ArrayHashMap, HashMap, HiveBox, LinearFifo, StringArrayHashMap, index_sort};
use bun_core::ZBox;
use bun_core::{Global, Output};
use bun_core::{ZStr, strings};
use bun_dotenv as dot_env;
use bun_event_loop::{self, AnyEventLoop, EventLoopHandle};
use bun_http as http;
use bun_ini as ini;
use bun_paths::resolve_path::{self, PosixToWinNormalizer, SpillBuf, platform};
use bun_paths::string_paths::without_trailing_slash_windows_path;
use bun_paths::{DELIMITER, SEP};
use bun_semver as Semver;
use bun_sys::{self, Fd};
use bun_threading::{OwnedQueue, ThreadPool, thread_pool};
use bun_url::URL;

// `bun.spawn.process.WaiterThread` — the force-waiter-thread flag was moved
// down into `bun_spawn::process` (MOVE_DOWN b0); install just flips it during
// init. The full waiter-thread machinery (queue, signalfd, loop) lives in
// `bun_runtime::api::bun::process` and *reads* the same flag.
#[cfg(unix)]
use bun_spawn::process::WaiterThread;

use crate::RunCommand;
use crate::buffered_subprocess::BufferedSubprocess;
use crate::git_runner::GitRunner;
use crate::lifecycle_script_runner::{LifecycleScriptRunner, ScriptCaller};

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

use crate::lockfile_real::package::{self as Package, PackageColumns as _};
use crate::package_manager_real::package_manager_lifecycle::PreinstallStates;
use crate::package_manager_task as Task;
use crate::resolvers::folder_resolver::{
    Entry as FolderResolutionEntry, FolderResolution, Key as FolderResolutionKey,
    Kind as FolderResolutionKind,
};
use bun_install::lockfile::{self, Lockfile, TrustedDependenciesSet};
use bun_install::{
    DependencyID, Integrity, NetworkTask, PackageID, PackageManifestMap, PackageNameAndVersionHash,
    PackageNameHash, PatchTask, Resolution, TaskCallbackContext, TruncatedPackageNameHash,
};

// ──────────────────────────────────────────────────────────────────────────
// Sub-module re-exports (thin re-exports — bodies live in their own files)
// ──────────────────────────────────────────────────────────────────────────

pub use self::command_line_arguments::CommandLineArguments;
use self::package_manager_options::Do;
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
    cached_npm_package_folder_print_basename, cached_tarball_folder_name_print,
    fetch_cache_directory_path, global_link_dir, path_for_cached_npm_path, path_for_resolution,
    save_lockfile, setup_global_dir, update_lockfile_if_needed, write_yarn_lock,
};
pub(crate) use directories::{
    compute_cache_dir_and_subpath, get_cache_directory, get_temporary_directory, is_folder_in_cache,
};

pub use self::package_manager_enqueue as enqueue;
pub use enqueue::{
    enqueue_dependency_list, enqueue_dependency_to_root, enqueue_dependency_with_main,
    enqueue_patch_task_pre,
};
pub(crate) use enqueue::{enqueue_install_task, enqueue_network_task, enqueue_patch_task};

pub use self::progress_strings::ProgressStrings;

pub use self::patch_package::PatchCommitResult;

pub(crate) use self::run_tasks::generate_network_task_for_tarball;

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

/// What other threads hand to the install thread.
pub(crate) struct Inbox {
    pub(crate) resolve_tasks: OwnedQueue<HiveBox<Task::Task>>,
    pub(crate) network_tasks: OwnedQueue<HiveBox<NetworkTask>>,
    pub(crate) patch_tasks: OwnedQueue<Box<PatchTask>>,
    pub(crate) pending_tasks: AtomicU32,
    /// Null unless the install thread is the main thread, whose loop is never freed.
    uws_loop: AtomicPtr<bun_uws::Loop>,
    runtime_auto_install: AtomicBool,
}

pub(crate) static INBOX: Inbox = Inbox {
    resolve_tasks: OwnedQueue::new(),
    network_tasks: OwnedQueue::new(),
    patch_tasks: OwnedQueue::new(),
    pending_tasks: AtomicU32::new(0),
    uws_loop: AtomicPtr::new(core::ptr::null_mut()),
    runtime_auto_install: AtomicBool::new(false),
};

impl Inbox {
    pub(crate) fn decrement_pending_tasks(&self) {
        let pending = self.pending_tasks.fetch_sub(1, Ordering::Release);
        debug_assert!(pending > 0);
    }

    pub(crate) fn wake(&self) {
        let uws_loop = self.uws_loop.load(Ordering::Acquire);
        if !uws_loop.is_null() {
            // SAFETY: never freed. `Loop` is `!Sync`, but any thread may wake it.
            unsafe { bun_uws::us_wakeup_loop(uws_loop) };
        }
        if self.runtime_auto_install.load(Ordering::Acquire) {
            crate::auto_installer::Parked::wake_all();
        }
    }
}

pub(crate) static THREAD_POOL: OnceLock<ThreadPool> = OnceLock::new();

pub(crate) fn install_pool() -> &'static ThreadPool {
    ThreadPool::get_or_init(&THREAD_POOL, || thread_pool::Config {
        max_threads: u32::from(bun_core::get_thread_count()),
        ..Default::default()
    })
}

pub struct PackageManager {
    pub root_dir: &'static fs::DirEntry,
    /// Holds the nodes that edits add to a package.json. Never reset: the manager is a leaked singleton.
    pub(crate) ast_arena: bun_ast::AstArena,
    pub(crate) timestamp_for_manifest_cache_control: u32,
    pub(crate) summary: Package::DiffSummary,

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

    pub(crate) project: ProjectInfo,

    pub manifests: PackageManifestMap,
    pub(crate) folders: FolderResolutionMap,
    pub(crate) git_commits: GitCommitMap,
    pub(crate) appended_task_packages: AppendedTaskPackageMap,

    /// We actually need to calculate the patch file hashes
    /// every single time, because someone could edit the patchfile at anytime
    ///
    /// TODO: Does this need to be atomic? It seems to be accessed only from the main thread.
    pub(crate) pending_pre_calc_hashes: AtomicU32,

    pub(crate) root_lifecycle_scripts: Option<Package::scripts::List>,

    pub lockfile: Box<Lockfile>, // OWNED

    pub options: Options,
    // Not in `options`, because `PnpmMatcher` is not `Sync`.
    pub(crate) public_hoist_pattern: Option<Api::PnpmMatcher>,
    pub(crate) hoist_pattern: Option<Api::PnpmMatcher>,
    pub state: InstallState,

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

    // When adding a `file:` dependency in a workspace package, we want to install it
    // relative to the workspace root, but the path provided is relative to the
    // workspace package. We keep track of the original here.
    pub original_package_json_path: ZBox,

    /// `<top_level_dir>/package.json`. Empty for auto-install, which does not call `init`.
    pub root_package_json_path: &'static ZStr,

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
}

/// The fields of `PackageManager` that downloading, extracting and linking use, besides the options and the lockfile.
pub struct InstallState {
    log: &'static bun_ast::Log,
    /// Shared with the VM for auto-install.
    env: Arc<dot_env::Loader>,
    pub(crate) event_loop: &'static AnyEventLoop,

    /// Install thread only.
    pub progress: Progress,
    pub(crate) downloads_node: Option<ProgressNodeId>,
    pub scripts_node: Option<ProgressNodeId>,
    pub(crate) extracted_count: u32,

    pub(crate) task_batch: thread_pool::Batch,
    pub(crate) task_queue: TaskDependencyQueue,

    pub(crate) git_repositories: RepositoryMap,
    /// Git tasks queued by `enqueue_git_task` and not yet started.
    pub(crate) git_tasks: VecDeque<HiveBox<Task::Task>>,
    pub(crate) running_git_tasks: Vec<(BufferedSubprocess, GitRunner)>,
    /// Set by the first git task.
    pub(crate) git_env: Option<crate::repository::GitEnv>,

    pub(crate) network_dedupe_map: crate::network_task::DedupeMap,
    pub(crate) network_tarball_batch: Vec<http::OwnedRequest>,
    pub(crate) network_resolve_batch: Vec<http::OwnedRequest>,
    pub(crate) retry_queue: crate::retry_timer::RetryQueue,
    /// Joins `task_batch` in `flush_dependency_queue`.
    pub(crate) patch_batch: thread_pool::Batch,
    pub(crate) total_tasks: Cell<u32>,
    pub(crate) preinstall_state: PreinstallStates,
    /// Set by `fail_update_requests`.
    pub(crate) update_request_failed: bool,
    pending_lockfile_changes: PendingLockfileChanges,

    pub(crate) finished_installing: bool,
    pub(crate) total_scripts: usize,
    has_configured_env_for_scripts: bool,
    pub(crate) node_gyp_tempdir_name: Box<[u8]>,

    // During `installPackages` we learn exactly what dependencies from --trust
    // actually have scripts to run, and we add them to this list
    pub(crate) trusted_deps_to_add_to_package_json: Vec<Box<[u8]>>,

    pub any_failed_to_install: bool,

    /// In the order in which they started.
    pub(crate) active_lifecycle_scripts: Vec<(BufferedSubprocess, LifecycleScriptRunner)>,
    /// The packages that the hoisted linker placed and whose scripts haven't all run yet.
    pub(crate) unfinished_scripts: Vec<(lockfile::tree::Id, Box<[u8]>)>,
    pub(crate) last_reported_slow_lifecycle_script_at: u64,
    pub(crate) cached_tick_for_slow_lifecycle_script_logging: u64,
}

/// Collected while a linker borrows the lockfile, and applied by `finish_linking`.
#[derive(Default)]
struct PendingLockfileChanges {
    /// For packages that have none in the lockfile.
    integrities: ArrayHashMap<PackageID, Integrity>,
    /// Replaces `lockfile.trusted_dependencies`.
    trusted_dependencies: Option<TrustedDependenciesSet>,
}

/// The fields of `PackageManager` for code that only reads the lockfile and the options.
pub struct InstallFields<'a> {
    pub(crate) options: &'a Options,
    pub(crate) lockfile: &'a Lockfile,
    pub(crate) state: &'a mut InstallState,
    pub(crate) subcommand: Subcommand,
    pub(crate) update_requests: &'a mut [UpdateRequest],
    pub(crate) pending_filtered_write: Option<&'a add_remove_with_filter::PendingWrite>,
    pub(crate) workspace_name_hash: Option<PackageNameHash>,
}

/// `PackageManager::install_fields` that does not borrow the other fields.
macro_rules! install_fields {
    ($manager:expr) => {
        $crate::package_manager_real::InstallFields {
            options: &$manager.options,
            lockfile: &$manager.lockfile,
            state: &mut $manager.state,
            subcommand: $manager.subcommand,
            update_requests: &mut $manager.update_requests,
            pending_filtered_write: $manager.pending_filtered_write.as_deref(),
            workspace_name_hash: $manager.workspace_name_hash,
        }
    };
}
pub(crate) use install_fields;

impl PackageManager {
    pub fn install_fields(&mut self) -> InstallFields<'_> {
        install_fields!(self)
    }

    pub(crate) fn effective_do(&self) -> Do {
        self.state.effective_do(&self.options)
    }

    /// Call when a linker is done.
    pub(crate) fn finish_linking(&mut self) {
        if self.options.log_level.show_progress() {
            self.state.progress.end();
            self.state.progress = Progress::default();
        }
        self.state.scripts_node = None;
        self.state.downloads_node = None;

        let changes = core::mem::take(&mut self.state.pending_lockfile_changes);
        if !changes.integrities.is_empty() {
            (self.options.enable).set(options::Enable::FORCE_SAVE_LOCKFILE, true);
        }
        for (&package_id, integrity) in changes.integrities.iter() {
            self.lockfile.packages.items_meta_mut()[package_id as usize].integrity = *integrity;
        }
        if changes.trusted_dependencies.is_some() {
            self.lockfile.trusted_dependencies = changes.trusted_dependencies;
        }
    }
}

impl InstallFields<'_> {
    pub(crate) fn reborrow(&mut self) -> InstallFields<'_> {
        InstallFields {
            state: self.state,
            update_requests: self.update_requests,
            ..*self
        }
    }

    pub(crate) fn effective_do(&self) -> Do {
        self.state.effective_do(self.options)
    }

    pub(crate) fn integrity(&self, package_id: PackageID) -> &Integrity {
        let locked = &self.lockfile.packages.items_meta()[package_id as usize].integrity;
        let pending = &self.state.pending_lockfile_changes.integrities;
        if pending.is_empty() || locked.tag.is_supported() {
            return locked;
        }
        pending.get(&package_id).unwrap_or(locked)
    }

    /// Does nothing if the package already has an integrity.
    pub(crate) fn record_extracted_integrity(
        &mut self,
        package_id: PackageID,
        integrity: &Integrity,
    ) {
        if integrity.tag.is_supported() && !self.integrity(package_id).tag.is_supported() {
            (self.state.pending_lockfile_changes.integrities).insert(package_id, *integrity);
        }
    }

    pub(crate) fn trusted_dependencies(&self) -> Option<&TrustedDependenciesSet> {
        let pending = &self.state.pending_lockfile_changes;
        (pending.trusted_dependencies.as_ref()).or(self.lockfile.trusted_dependencies.as_ref())
    }

    pub(crate) fn in_trusted_dependencies(&self, name: &[u8]) -> bool {
        let hash = Semver::string::Builder::string_hash(name) as u32;
        (self.trusted_dependencies()).is_some_and(|trusted| trusted.contains(&hash))
    }

    pub(crate) fn has_trusted_dependency(
        &self,
        alias: &[u8],
        pkg_name: &[u8],
        resolution: &Resolution,
    ) -> bool {
        let (trusted, options) = (self.trusted_dependencies(), self.options);
        (self.lockfile).has_trusted_dependency_in(trusted, options, alias, pkg_name, resolution)
    }

    /// For a package with scripts that was named with `--trust`.
    pub(crate) fn add_trusted_dependency(
        &mut self,
        name_hash: TruncatedPackageNameHash,
        name: &[u8],
    ) {
        let locked = self.lockfile.trusted_dependencies.as_ref();
        (self.state.pending_lockfile_changes.trusted_dependencies)
            .get_or_insert_with(|| {
                locked.map_or_else(Default::default, |set| bun_core::handle_oom(set.clone()))
            })
            .insert(name_hash, Box::from(name));
        (self.state.trusted_deps_to_add_to_package_json).push(Box::from(name));
    }

    pub(crate) fn crash(&self) -> ! {
        if self.options.log_level != package_manager_options::LogLevel::Silent {
            let _ = self.state.log().print(Output::error_writer());
        }
        Global::crash();
    }
}

/// Read from the project's package.json files and not recorded in the lockfile.
#[derive(Default)]
pub(crate) struct ProjectInfo {
    /// The hash of the `name` in the root package.json. `workspace_paths` only has the workspaces,
    /// not the root.
    pub(crate) workspace_root_name_hash: PackageNameHash,
    /// The `version` in the root package.json, as written. The lockfile records none for the root.
    pub(crate) workspace_root_version: Box<[u8]>,
    pub(crate) postinstall_optimizer: crate::postinstall_optimizer::List,
    // Maps the name hash of an alias to the text of its `npm:` specifier. It only has the aliases
    // that the project's own package.json files declare.
    pub(crate) known_npm_aliases: NpmAliasMap,
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
    pub fn log(&self) -> &'static bun_ast::Log {
        self.state.log()
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

mod holder {
    /// Process-lifetime storage for `http::http_thread::InitOpts.abs_ca_file_name`.
    /// `OnceLock` per PORTING.md §Forbidden — never `Box::leak` to mint `&'static`.
    pub(super) static ABS_CA_FILE_NAME: std::sync::OnceLock<bun_core::ZBox> =
        std::sync::OnceLock::new();

    /// Process-lifetime storage for `http::http_thread::InitOpts.ca` C-strings
    /// (never freed). The HTTP thread
    /// reads these asynchronously after `init()` returns, so they must outlive
    /// the local that builds them.
    pub(super) static CA: std::sync::OnceLock<Vec<bun_core::ZBox>> = std::sync::OnceLock::new();
}

// ──────────────────────────────────────────────────────────────────────────
// impl PackageManager
// ──────────────────────────────────────────────────────────────────────────

impl PackageManager {
    pub(crate) fn clear_cached_items_depending_on_lockfile_buffer(&mut self) {
        self.root_package_id.id = None;
    }

    pub fn load_lockfile_from_cwd<const ATTEMPT_OTHER: bool>(&mut self) -> lockfile::LoadResult {
        self.clear_cached_items_depending_on_lockfile_buffer();
        let log = self.log();
        match (self.lockfile).load_from_dir(Fd::cwd(), Some(&self.options), log) {
            lockfile::LoadResult::NotFound if ATTEMPT_OTHER => {
                let migrated = self.migrate_lockfile_from_cwd();
                self.lockfile.finish_load(migrated)
            }
            result => result,
        }
    }

    pub fn migrate_lockfile_from_cwd(&mut self) -> lockfile::LoadResult {
        let log = self.log();
        let mut lockfile = core::mem::take(&mut *self.lockfile);
        let result = crate::migration::detect_and_load_other_lockfile(
            &mut lockfile,
            Fd::cwd(),
            self,
            log,
            true,
        );
        *self.lockfile = lockfile;
        result
    }

    /// `nothing` is the end of the error message for a missing lockfile, e.g. "nothing to update".
    pub fn load_lockfile_from_cwd_or_exit(&mut self, nothing: &str) {
        let silent = self.options.log_level == package_manager_options::LogLevel::Silent;
        match self.load_lockfile_from_cwd::<true>() {
            lockfile::LoadResult::Ok(_) => return,
            lockfile::LoadResult::NotFound if !silent => {
                Output::err_generic("missing lockfile, {s}", (nothing,));
                bun_core::note!("run 'bun install' first");
            }
            lockfile::LoadResult::Err(cause) if !silent => cause.report(self.log()),
            _ => {}
        }
        Global::exit(1);
    }

    pub(crate) fn crash(&mut self) -> ! {
        self.install_fields().crash()
    }

    pub fn tls_reject_unauthorized(&self) -> bool {
        self.env().get_tls_reject_unauthorized()
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
    ) -> Box<http::AsyncHTTP<'a>> {
        let mut req = http::AsyncHTTP::init_sync(
            method,
            url,
            headers,
            headers_buf,
            body,
            self.state.proxy_settings(),
            http::FetchRedirect::Follow,
        );
        req.client.flags.reject_unauthorized = self.tls_reject_unauthorized();
        req.client.flags.redirect_credentials = http::RedirectCredentialsPolicy::HttpsUpgrade;
        req
    }

    /// Runs the event loop until `is_done`.
    pub(crate) fn sleep_until(&mut self, mut is_done: impl FnMut(&mut Self) -> bool) {
        Output::flush();
        while !is_done(self) {
            self.install_fields().tick();
        }
    }

    pub fn env(&self) -> &dot_env::Loader {
        self.state.env()
    }

    pub fn env_mut(&mut self) -> &mut dot_env::Loader {
        self.state.env_mut()
    }
}

impl InstallState {
    /// `options.do_` without the steps that a failed update request cancels.
    fn effective_do(&self, options: &Options) -> Do {
        if self.update_request_failed {
            options.do_ - (Do::SAVE_LOCKFILE | Do::SAVE_YARN_LOCK | Do::INSTALL_PACKAGES)
        } else {
            options.do_
        }
    }

    pub(crate) fn log(&self) -> &'static bun_ast::Log {
        self.log
    }

    pub fn has_enough_time_passed_between_waiting_messages(&self) -> bool {
        let iter = self.event_loop.iteration_number();
        if TIME_PASSER_LAST_TIME.load(core::sync::atomic::Ordering::Relaxed) < iter {
            TIME_PASSER_LAST_TIME.store(iter, core::sync::atomic::Ordering::Relaxed);
            return true;
        }
        false
    }

    pub(crate) fn configure_env_for_scripts(&mut self) -> Result<(), Error> {
        if !self.has_configured_env_for_scripts {
            configure_env_for_scripts_run(self.env_mut())?;
            self.has_configured_env_for_scripts = true;
        }
        Ok(())
    }

    pub(crate) fn proxy_settings(&self) -> Option<Box<http::ProxySettings>> {
        http::ProxySettings::from_env(&self.env)
    }

    pub(crate) fn env(&self) -> &dot_env::Loader {
        &self.env
    }

    /// Panics for auto-install, which shares the loader of the VM.
    fn env_mut(&mut self) -> &mut dot_env::Loader {
        Arc::get_mut(&mut self.env).expect("the env loader is not shared")
    }
}

impl InstallFields<'_> {
    /// Auto-install blocks the JS thread while it waits for a response, so it gives up after 30
    /// seconds of silence instead of the default five minutes.
    pub(crate) fn idle_timeout_seconds(&self) -> Option<core::ffi::c_uint> {
        (self.options.runtime_auto_install
            && self
                .state
                .env()
                .get(b"BUN_CONFIG_HTTP_IDLE_TIMEOUT")
                .is_none())
        .then_some(30)
    }

    /// One turn of the event loop, which waits if there is nothing to run.
    pub(crate) fn tick(&mut self) {
        self.state.event_loop.tick(core::ptr::null_mut());
        ScriptCaller::Manager(self.reborrow()).finish_exited_subprocesses();
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
}

// ──────────────────────────────────────────────────────────────────────────
// run-once wrappers
// ──────────────────────────────────────────────────────────────────────────

fn configure_env_for_scripts_run(env: &mut dot_env::Loader) -> Result<(), Error> {
    RunCommand::seed_script_env(env);

    // Overwritten like npm does: an outer `bun run` in another project may have left a stale value.
    env.map.put(
        b"npm_config_local_prefix",
        FileSystem::get().top_level_dir(),
    )?;

    let init_cwd_entry = env.map.get_or_put_without_value(b"INIT_CWD")?;
    if !init_cwd_entry.found_existing {
        *init_cwd_entry.value_ptr = dot_env::HashTableValue {
            value: Box::<[u8]>::from(without_trailing_slash_windows_path(
                FileSystem::get().top_level_dir(),
            )),
        };
    }

    // The resolver-tier
    // `FileSystem` mirrors `bun_paths::fs::FileSystem` for `top_level_dir`.
    let paths_fs = bun_paths::fs::FileSystem::instance();
    env.load_ccache_path(paths_fs);

    {
        // Run node-gyp jobs in parallel.
        // https://github.com/nodejs/node-gyp/blob/7d883b5cf4c26e76065201f85b0be36d5ebdcc0e/lib/build.js#L150-L184
        let thread_count = bun_core::get_thread_count();
        if thread_count > 2 {
            if !env.has(b"JOBS") {
                let mut int_buf = bun_core::fmt::ItoaBuf::new();
                let jobs_str = bun_core::fmt::itoa(&mut int_buf, thread_count);
                env.map
                    .put_alloc_value(b"JOBS", jobs_str)
                    .expect("unreachable");
            }
        }
    }

    {
        let mut node_path = bun_paths::path_buffer_pool::get();
        if let Some(node_path_z) = env.get_node_path(paths_fs, &mut node_path) {
            let _ = env.load_node_js_config(paths_fs, node_path_z.as_ref())?;
        } else {
            'brk: {
                let current_path = env.get(b"PATH").unwrap_or(b"");
                let mut path_var: Vec<u8> = Vec::with_capacity(current_path.len());
                path_var.extend_from_slice(current_path);
                let mut bun_path: &[u8] = b"";
                if RunCommand::create_fake_temporary_node_executable(&mut path_var, &mut bun_path)
                    .is_err()
                {
                    break 'brk;
                }
                env.map.put(b"PATH", &path_var)?;
                let _ = env.load_node_js_config(paths_fs, bun_path)?;
            }
        }
    }

    package_manager_lifecycle::resolve_bin_dirs_in_path(env)?;
    Ok(())
}

static ENSURE_TEMP_NODE_GYP_SCRIPT_ONCE: AtomicBool = AtomicBool::new(false);

/// Kept until the process exits, because scripts find the shim through PATH.
static NODE_GYP_TEMPDIR: std::sync::OnceLock<(Fd, Box<[u8]>)> = std::sync::OnceLock::new();

extern "C" fn remove_node_gyp_tempdir() {
    if let Some((tempdir, name)) = NODE_GYP_TEMPDIR.get() {
        let _ = bun_sys::Dir::borrow(tempdir).delete_tree(name);
    }
}

fn ensure_temp_node_gyp_script_run(manager: &mut InstallFields<'_>) -> Result<(), Error> {
    if !manager.state.node_gyp_tempdir_name.is_empty() {
        return Ok(());
    }

    let tempdir = get_temporary_directory(manager);
    let state = &mut *manager.state;
    let mut path_buf = bun_paths::path_buffer_pool::get();
    let node_gyp_tempdir_name =
        fs::FileSystem::tmpname(b"node-gyp", &mut path_buf.0, bun_core::fast_random())?;

    // used later for adding to path for scripts
    state.node_gyp_tempdir_name = Box::<[u8]>::from(node_gyp_tempdir_name.as_ref());

    let node_gyp_tempdir = match tempdir
        .handle
        .make_open_path(&state.node_gyp_tempdir_name, Default::default())
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
        .set((tempdir.handle.fd, state.node_gyp_tempdir_name.clone()))
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
        &state.node_gyp_tempdir_name,
    ];
    let node_gyp_abs_dir = parts.concat();

    // Add our node-gyp tempdir to the path
    let existing_path = state.env().get(b"PATH").unwrap_or(b"");
    let mut path_var: Vec<u8> =
        Vec::with_capacity(existing_path.len() + 1 + node_gyp_abs_dir.len());
    path_var.extend_from_slice(existing_path);
    if !existing_path.is_empty() && existing_path[existing_path.len() - 1] != DELIMITER {
        path_var.push(DELIMITER);
    }
    path_var.extend_from_slice(&node_gyp_abs_dir);
    state.env_mut().map.put(b"PATH", &path_var)?;

    state
        .env_mut()
        .map
        .put_alloc_key_and_value(b"BUN_WHICH_IGNORE_CWD", &node_gyp_abs_dir)?;

    Ok(())
}

fn http_thread_on_init_error(err: http::InitError, opts: &http::http_thread::InitOpts) -> ! {
    let abs_ca_z: &ZStr = opts.abs_ca_file_name;
    match err {
        http::InitError::LoadCAFile => {
            let mut normalizer = PosixToWinNormalizer::default();
            let normalized = normalizer.resolve_z(FileSystem::get().top_level_dir(), abs_ca_z);
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
// allocate
// ──────────────────────────────────────────────────────────────────────────

fn allocate_package_manager(
    options: Options,
    log: &'static bun_ast::Log,
    root_dir: &'static fs::DirEntry,
    env: Arc<dot_env::Loader>,
    // NUL-terminated
    original_package_json_path: Vec<u8>,
    root_package_json_path: &'static ZStr,
    workspace_package_json_cache: WorkspacePackageJSONCache,
    workspace_name_hash: Option<PackageNameHash>,
    subcommand: Subcommand,
    root_package_json_name_at_time_of_init: Box<[u8]>,
) -> &'static mut PackageManager {
    let runtime_auto_install = options.runtime_auto_install;
    (INBOX.runtime_auto_install).store(runtime_auto_install, Ordering::Release);
    if bun_crash_handler::cli_state::is_main_thread() {
        let uws_loop: &bun_uws::Loop = bun_uws::Loop::get();
        (INBOX.uws_loop).store(core::ptr::from_ref(uws_loop).cast_mut(), Ordering::Release);
    }
    let manager = Box::leak(Box::new(PackageManager {
        options,
        public_hoist_pattern: None,
        hoist_pattern: None,
        state: InstallState {
            event_loop: Box::leak(Box::new(if runtime_auto_install {
                AnyEventLoop::js_current()
            } else {
                AnyEventLoop::init()
            })),
            active_lifecycle_scripts: Vec::new(),
            unfinished_scripts: Vec::new(),
            retry_queue: Default::default(),
            log,
            env,
            extracted_count: 0,
            progress: Progress::default(),
            downloads_node: None,
            scripts_node: None,
            task_batch: thread_pool::Batch::default(),
            task_queue: TaskDependencyQueue::default(),
            git_repositories: RepositoryMap::default(),
            git_tasks: VecDeque::new(),
            running_git_tasks: Vec::new(),
            git_env: None,
            network_dedupe_map: Default::default(),
            network_tarball_batch: Vec::new(),
            network_resolve_batch: Vec::new(),
            patch_batch: thread_pool::Batch::default(),
            total_tasks: Cell::new(0),
            finished_installing: false,
            total_scripts: 0,
            has_configured_env_for_scripts: false,
            node_gyp_tempdir_name: Box::default(),
            preinstall_state: PreinstallStates::default(),
            trusted_deps_to_add_to_package_json: Vec::new(),
            any_failed_to_install: false,
            last_reported_slow_lifecycle_script_at: 0,
            cached_tick_for_slow_lifecycle_script_logging: 0,
            update_request_failed: false,
            pending_lockfile_changes: PendingLockfileChanges::default(),
        },
        root_dir,
        ast_arena: bun_ast::AstArena::new(),
        lockfile: Box::new(Lockfile::default()),
        original_package_json_path: ZBox::from_vec_with_nul(original_package_json_path),
        root_package_json_path,
        workspace_package_json_cache,
        workspace_name_hash,
        subcommand,
        root_package_json_name_at_time_of_init,

        // remaining defaults:
        timestamp_for_manifest_cache_control: 0,
        summary: Default::default(),
        track_installed_bin: TrackInstalledBin::None,
        to_update: false,
        update_requests: Box::default(),
        update_request_index: Default::default(),
        audit_fix_pins: Box::default(),
        root_package_id: RootPackageId::default(),
        project: ProjectInfo::default(),
        manifests: PackageManifestMap::default(),
        folders: Default::default(),
        git_commits: GitCommitMap::default(),
        appended_task_packages: AppendedTaskPackageMap::default(),
        pending_pre_calc_hashes: AtomicU32::new(0),
        root_lifecycle_scripts: None,
        peer_dependencies: LinearFifo::<DependencyID, DynamicBuffer<DependencyID>>::init(),
        peer_askers: None,
        local_in_root: Vec::new(),
        alias_rows: Vec::new(),
        patched_versions: None,
        updating_packages: StringArrayHashMap::default(),
        updating_catalogs: Vec::new(),
        update_target_workspaces: None,
        named_update_reachable: None,
        kept_patched: Vec::new(),
        kept_patched_text: Vec::new(),
        held_messages: None,
        manifest_failures: HashMap::default(),
        look_ahead: LookAhead::default(),
        remote_packages: RemotePackages::default(),
        dedupe_report: None,
        filtered_link_targets: None,
        pending_filtered_write: None,
        edited_package_jsons: Vec::new(),
        wrote_package_json: false,
        migrated_package_json_moves: Vec::new(),
        catalog_add: add_catalog::State::default(),
        patched_dependencies_to_remove: ArrayHashMap::default(),
        pending_patch_commit: Default::default(),
    }));
    bun_core::asan::ignore_object(core::ptr::from_mut(manager).cast());
    bun_core::add_exit_callback(crate::npm::package_manifest::Serializer::finish_saves_at_exit);
    manager
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
/// `PackageManager`.
pub fn config_ignores_scripts(
    ctx: Command::Context,
    env: &dot_env::Loader,
    cwd: &[u8],
) -> Result<bool, Error> {
    bun_bunfig::arguments::load_config(
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
    let bunfig = (bun_bunfig::arguments::load_user_install_section().ok())
        .flatten()
        .unwrap_or_default();
    if bunfig.cache_directory.is_some() {
        return bunfig.cache_directory;
    }
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
    log: &bun_ast::Log,
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
    log: &bun_ast::Log,
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
        // drive or outside the project.
        let json_source = bun_ast::Source::init_path_string(&walk.path, &json_buf[..json_len]);
        let arena = bun_ast::AstArena::new();
        let parsed = crate::bun_json::ParsedJson::parse_package_json(&json_source, log, &arena)?;
        let json = parsed.root();
        if let Some(last_name) = last_name.as_deref_mut() {
            if let Some(name) = json.get(b"name").and_then(|e| e.as_utf8_string_literal()) {
                *last_name = Box::<[u8]>::from(name);
            }
        }

        if let Some(prop) = json.as_property(b"workspaces") {
            let value_loc = crate::bun_json::property_value_loc(&json_source.contents, prop.loc)
                .unwrap_or(prop.loc);
            let names = match prop.value.as_json_value() {
                Some(bun_ast::E::JsonValue::Array(arr)) => Some(
                    Package::WorkspaceMap::NamesArray::Immutable(arr.get(), value_loc),
                ),
                Some(bun_ast::E::JsonValue::Object(obj)) => obj
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
            let log = bun_ast::Log::init();
            // An error here is about some other workspace. A command that needs that workspace
            // reports it later.
            let _ = workspace_names.process_names_array(
                workspace_package_json_cache,
                &log,
                names,
                &json_source,
                prop.loc,
                None,
                Package::WorkspaceMap::MissingWorkspace::Skip,
            );
            drop(log);

            debug_assert_eq!(workspace_names.keys().len(), workspace_names.values().len());
            let mut relative_buf = SpillBuf::default();
            for (path_, entry) in workspace_names
                .keys()
                .iter()
                .zip(workspace_names.values().iter())
            {
                let child_path: &[u8] = if bun_paths::is_absolute(path_) {
                    child_cwd
                } else {
                    resolve_path::relative_normalized_spill::<platform::Auto>(
                        &mut relative_buf,
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

                if strings::eql_long(maybe_workspace_path, path_) {
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
            .get_with_path(&bun_ast::Log::init(), &walk.path, Default::default())
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
            &bun_ast::Log::init(),
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
    find_project(
        without_trailing_slash_windows_path(cwd),
        &mut WorkspacePackageJSONCache::default(),
        &mut None,
    )
    .map(|(project, _)| project)
}

/// The manager is leaked.
pub fn init(
    ctx: Command::Context,
    cli: &CommandLineArguments,
    subcommand: Subcommand,
) -> Result<(&'static mut PackageManager, Box<[u8]>), Error> {
    // `.npmrc` is read below, before `Options::load` applies the log level.
    if cli.log_level.is_silent() {
        bun_ast::DEFAULT_LOG_LEVEL.store(bun_ast::Level::Err);
    }
    // A second `init()`, in a different cwd, keeps what the first one read from `--env-file`.
    let env = Arc::make_mut(ctx.env_loader.get_or_insert_default());
    // The `[Nms] ".env"` line is a timing trace, like the other `print_elapsed` traces of install.
    env.quiet_loaded_files = !cli.log_level.is_verbose();
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
            bun_bunfig::arguments::load_config(CONFIG_TAG, cli.config, ctx)?;
        } else {
            bun_bunfig::arguments::load_global_bunfig(CONFIG_TAG, ctx);
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
    let fs = FileSystem::get();
    // `C:\` keeps its separator: `C:` is the current directory of drive C, not its root.
    let top_level_dir_no_trailing_slash = without_trailing_slash_windows_path(fs.top_level_dir());

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
    let mut original_package_json_path =
        ZStr::from_buf(&original_package_json_path_buf[..], path_len);
    let original_cwd_clone = Box::<[u8]>::from(top_level_dir_no_trailing_slash);
    let original_cwd: &[u8] = &original_cwd_clone;

    let mut workspace_names = Package::WorkspaceMap::WorkspaceMap::init();
    let mut workspace_package_json_cache = WorkspacePackageJSONCache::default();

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
        let child_json: Option<bun_sys::File> = 'child: {
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
                        break 'child Some(f);
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
                    &bun_ast::Log::init(),
                    original_package_json_path.as_bytes(),
                    directories::NEW_PACKAGE_JSON,
                )?;
                this_cwd = original_cwd;
                no_project = true;
                break 'child None;
            }
            if subcommand == Subcommand::Install {
                if cli.positionals.len() > 1 && cli.filters.is_empty() {
                    // this is `bun add <package>`.
                    //
                    // create the package.json instead of returning an error so that
                    // `bun add <pkg>` works in an empty directory.
                    this_cwd = original_cwd;
                    created_package_json = true;
                    break 'child Some(attempt_to_create_package_json_and_open()?);
                }
            }
            if cli.no_project_ok {
                // Registry-only commands (`bun pm diff a b`) run fine from any folder: no root file, no workspaces.
                this_cwd = original_cwd;
                no_project = true;
                break 'child None;
            }
            return Err(crate::Error::MissingPackageJSON);
        };

        debug_assert!(strings::eql_long(
            &original_package_json_path_buf[..this_cwd.len()],
            this_cwd
        ));
        original_package_json_path_buf.truncate(this_cwd.len());
        push_package_json(&mut original_package_json_path_buf);

        let new_path_len = original_package_json_path_buf.len() - 1;
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
                    ctx.log(),
                    Some((&mut workspace_names, &mut workspace_package_json_cache)),
                    (subcommand == Subcommand::Pm)
                        .then_some(&mut root_package_json_name_at_time_of_init),
                )?
            {
                // Intern via the resolver's DirnameStore so the slice is
                // process-lifetime (`set_top_level_dir` requires `'static`).
                fs.set_top_level_dir(fs.dirname_store().append(parent)?);
                workspace_name_hash = Some(name_hash);
                // The root was found above the path as the user typed it. The root reads the
                // workspace's package.json under that path, so the same spelling is used here.
                if !core::ptr::eq(walk.cwd, original_cwd) {
                    let mut typed = walk.cwd.to_vec();
                    push_package_json(&mut typed);
                    original_package_json_path_buf = typed;
                }
                break 'root_package_json_file Some(json_file);
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
    if !(cli.global && cli.config.is_some()) {
        bun_bunfig::arguments::load_config(CONFIG_TAG, cli.config, ctx)?;
    }
    let with_nul = fs
        .dirname_store()
        .append(top_level_dir_z.as_bytes_with_nul())?;
    fs.set_top_level_dir(&with_nul[..top_level_dir_z.len()]);
    // Build it from `top_level_dir`, not from the fd's real path, so that relative paths never
    // cross drives.
    let root_package_json_path = ZStr::from_slice_with_nul(fs.dirname_store().append_parts(&[
        strings::without_trailing_slash(fs.top_level_dir()),
        SEP_PACKAGE_JSON,
        b"\0",
    ])?);
    // From here on, package.json is read by path, and written by path by the commands that write
    // it.
    drop(root_package_json_file);

    let top_level_dir = fs.top_level_dir();
    // Returns the resolver's BSSMap-owned
    // `*EntriesOption` slot.
    let entries_option = FileSystem::instance()
        .read_directory(top_level_dir, 0, true)?
        .try_entries()?;

    let mut env_loader = ctx.env_loader.take().unwrap_or_default();
    let env = Arc::make_mut(&mut env_loader);
    env.load_process()?;
    // This is read before the project's `.env` files are loaded, so they cannot set it.
    let env_ignores_scripts = env_ignores_scripts(env);
    if cli.env_files.is_empty() && !cli.no_env_file && !ctx.args.disable_default_env_files {
        // `.data` must only be probed while `entries_mutex` is held.
        let env_probe_keys = {
            let _entries_lock = FileSystem::get().fs.entries_mutex.lock_guard();
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
                top_level_dir,
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

    let manager = allocate_package_manager(
        options,
        ctx.log(),
        entries_option,
        env_loader,
        original_package_json_path_buf,
        root_package_json_path,
        workspace_package_json_cache,
        workspace_name_hash,
        subcommand,
        root_package_json_name_at_time_of_init,
    );
    {
        // Build the handle from `manager.event_loop` and write it back as the loop's
        // parent so uSockets timers / lifecycle subprocess waiters can find the
        // mini event loop on tick.
        let uws_loop = manager.state.event_loop.r#loop();
        EventLoopHandle::from_any(manager.state.event_loop).set_as_parent_of(uws_loop);
    }
    {
        // make sure folder packages can find the root package without creating a new one
        // Posix-normalize the
        // separators: the folder resolver's `Key` has `/` only; on Windows this path has `\`, so
        // hashing the raw bytes would seed a key the resolver never looks up — copy into
        // a stack buffer and convert separators in place.
        let raw: &[u8] = root_package_json_path.as_bytes();
        let mut buf = bun_paths::path_buffer_pool::get();
        buf[..raw.len()].copy_from_slice(raw);
        let normalized = &mut buf[..raw.len()];
        resolve_path::dangerously_convert_path_to_posix_in_place::<u8>(normalized);
        manager.folders.put(
            FolderResolutionKey::new(FolderResolutionKind::Folder, normalized),
            FolderResolutionEntry {
                abs_path: Box::<[u8]>::from(&*normalized),
                resolution: FolderResolution::PackageId(0),
            },
        )?;
        // normalized.deinit() → Drop (stack buffer)
    }

    {
        // `options.load` applies BUN_CONFIG_MAX_HTTP_REQUESTS on top of this default.
        http::async_http::MAX_SIMULTANEOUS_REQUESTS.store(
            if manager.env().snapshot().has_http_proxy() {
                DEFAULT_MAX_SIMULTANEOUS_REQUESTS_FOR_BUN_INSTALL_FOR_PROXIES
            } else {
                DEFAULT_MAX_SIMULTANEOUS_REQUESTS_FOR_BUN_INSTALL
            },
            Ordering::Relaxed,
        );

        manager.options.load(
            ctx.log(),
            &manager.state.env,
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
                manager.public_hoist_pattern = Some(p);
            }
            if let Some(p) = config.hoist_pattern.take() {
                manager.hoist_pattern = Some(p);
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

    let abs_ca_file_name = ZBox::from_bytes(manager.options.ca_file_name);
    // The path is still relative if joining it to its directory did not fit in a path buffer.
    if !abs_ca_file_name.is_empty() && !bun_paths::is_absolute(abs_ca_file_name.as_bytes()) {
        Output::err(
            "HTTPThread",
            "could not find CA file: '{s}'",
            &[&bstr::BStr::new(abs_ca_file_name.as_bytes())],
        );
        Global::crash();
    }

    let ca = holder::CA.get_or_init(|| ca);
    // `InitOpts.abs_ca_file_name: &'static ZStr` — process-lifetime config
    // string. Park it in
    // `holder::ABS_CA_FILE_NAME: OnceLock<ZBox>` per PORTING.md §Forbidden
    // (never `Box::leak` to mint `&'static`). If it is already set
    // (hot-reload re-entry), the existing CA path stays.
    let abs_ca_file_name_static: &'static ZStr = if abs_ca_file_name.is_empty() {
        ZStr::EMPTY
    } else {
        holder::ABS_CA_FILE_NAME.get_or_init(|| abs_ca_file_name)
    };
    http::http_thread::init(&http::http_thread::InitOpts {
        ca,
        abs_ca_file_name: abs_ca_file_name_static,
        on_init_error: http_thread_on_init_error,
        ..Default::default()
    });

    let timestamp_for_manifest_cache_control: u32 = 'brk: {
        if cfg!(debug_assertions) {
            if let Some(cache_control) =
                (manager.env()).get(b"BUN_CONFIG_MANIFEST_CACHE_CONTROL_TIMESTAMP")
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

/// Only the first call on the main thread can succeed. The later ones repeat its error, or fail with `PackageManagerTaken`.
pub(crate) fn init_with_runtime(
    log: &bun_ast::Log,
    // Used read-only (`Options::load` only ever reads `config.*`).
    // Upstream storage is `Option<NonNull<api::BunInstall>>` (bundler + resolver
    // opts); taking `&mut` here would force a const→mut provenance launder at
    // the resolver call site.
    bun_install: Option<&Api::BunInstall>,
    cli: &CommandLineArguments,
    env: &Arc<dot_env::Loader>,
    // The directory of the file whose import needs a package.
    importer_dir: &[u8],
) -> crate::Result<&'static mut PackageManager> {
    // The manager keeps the event loop of this thread until the process exits.
    if !bun_crash_handler::cli_state::is_main_thread() {
        return Err(bun_resolver::Error::NotMainThread.into());
    }
    static LATER_CALL_ERROR: bun_core::Mutex<Option<crate::Error>> = bun_core::Mutex::new(None);
    let mut later_call_error = LATER_CALL_ERROR.lock();
    if let Some(err) = *later_call_error {
        return Err(err);
    }
    let result = init_with_runtime_once(log, bun_install, cli, env, importer_dir);
    *later_call_error = Some(match result {
        Ok(_) => bun_resolver::Error::PackageManagerTaken.into(),
        Err(err) => err,
    });
    result
}

fn init_with_runtime_once(
    log: &bun_ast::Log,
    bun_install: Option<&Api::BunInstall>,
    cli: &CommandLineArguments,
    env_loader: &Arc<dot_env::Loader>,
    importer_dir: &[u8],
) -> crate::Result<&'static mut PackageManager> {
    let env = &*env_loader.snapshot();
    if env.get(b"BUN_INSTALL_VERBOSE").is_some() {
        PackageManager::set_verbose_install(true);
    }

    // Read the root directory BEFORE allocating the singleton. This is
    // user-reachable failure (the cwd may have been deleted out from under the
    // process, or be unreadable: ENOENT/EACCES/ENOTDIR).
    // Returns the resolver's BSSMap-owned `*EntriesOption` slot.
    let top_level_dir = FileSystem::get().top_level_dir();
    let root_dir = FileSystem::instance()
        .read_directory(top_level_dir, 0, true)?
        .try_entries()?;

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
        match bun_bunfig::arguments::load_install_section(dir) {
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
    let has_scanner = bun_bunfig::arguments::has_security_scanner(start_dir, project_dir);
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
        strings::without_trailing_slash(FileSystem::get().top_level_dir()).to_vec();
    original_package_json_path.extend_from_slice(b"/package.json\0");
    let manager = allocate_package_manager(
        Options {
            runtime_auto_install: true,
            ..Default::default()
        },
        // Outlives every caller's log, and is drained into it.
        Box::leak(Box::default()),
        root_dir,
        Arc::clone(env_loader),
        original_package_json_path,
        ZStr::EMPTY,
        workspace_package_json_cache,
        None,
        Subcommand::Install,
        Box::default(),
    );
    let _drain = manager.drain_log_on_drop(Some(log));

    if Output::enable_ansi_colors_stderr() {
        manager.state.progress = Progress::default();
        manager.state.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        manager.state.progress.start(b"", 0);
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
    // `load_from_dir` fills the lockfile in place, so `Ok` keeps the loaded
    // value as-is.
    manager.lockfile.init_empty();
    if let Ok(fs::EntriesOption::Entries(entries)) =
        FileSystem::instance().read_directory(project_dir, 0, false)
        && {
            // `.data` probes must hold `entries_mutex`.
            let _entries_lock = FileSystem::get().fs.entries_mutex.lock_guard();
            entries.has_comptime_query(b"bun.lock") || entries.has_comptime_query(b"bun.lockb")
        }
        && let Ok(dir) = bun_sys::Dir::open(project_dir)
    {
        match (manager.lockfile).load_from_dir(dir.fd(), Some(&manager.options), log) {
            lockfile::LoadResult::Ok(_) => {}
            _ => manager.lockfile.init_empty(),
        }
        // Workspace paths are relative to `root_dir`. A lockfile records them relative to its own
        // directory, and `parse_with_json` makes them relative to the working directory.
        if manager.lockfile.packages.len() > 0 {
            manager.root_dir = entries;
            // Auto-install ignores an override that points away from the registry, so it also drops
            // what such an override resolved to in the lockfile.
            let lockfile = &mut *manager.lockfile;
            let resolved_as = lockfile.packages.items_resolution();
            for (row, package_id) in
                (lockfile.buffers.dependencies.iter()).zip(lockfile.buffers.resolutions.iter_mut())
            {
                use crate::dependency::version::Tag as Declared;
                use crate::resolution::Tag;
                if matches!(row.version.tag(), Declared::Npm | Declared::DistTag)
                    && resolved_as
                        .get(*package_id as usize)
                        .is_some_and(|it| !matches!(it.tag, Tag::Npm | Tag::Workspace | Tag::Root))
                {
                    *package_id = bun_install::INVALID_PACKAGE_ID;
                }
            }
            return Ok(manager);
        }
    }
    if project.is_some_and(|(root, _)| parse_runtime_root(manager, log, root).is_ok()) {
        return Ok(manager);
    }
    manager.lockfile.init_empty();
    manager.lockfile.append_package(&lockfile::Package {
        resolution: crate::resolution::Resolution::init(crate::resolution::TaggedValue::Root),
        ..Default::default()
    })?;
    Ok(manager)
}

/// Without a lockfile, auto-install reads the project's package.json the way `bun install` does,
/// for its overrides, catalogs and workspaces. Each dependency is only resolved when it is
/// imported.
fn parse_runtime_root(
    manager: &mut PackageManager,
    log: &bun_ast::Log,
    root_dir: &[u8],
) -> crate::Result<()> {
    let mut path = root_dir.to_vec();
    push_package_json(&mut path);
    // The messages in this log point into `source`.
    let parse_log = bun_ast::Log::init();
    // Cloned because the `workspaces` walk below may grow the cache holding this entry.
    let (source, json) = {
        let entry = manager
            .workspace_package_json_cache
            .get_with_path(&parse_log, &path[..path.len() - 1], Default::default())
            .unwrap()?;
        (entry.source.clone(), entry.root)
    };
    let mut root = lockfile::Package::default();
    let (lockfile, mut fields) = Package::ParseFields::split_lockfile(manager);
    let result = root
        .parse_with_json(
            lockfile,
            &mut fields,
            &parse_log,
            &source,
            bun_ast::JsonView::from(&json),
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
    if parse_log.has_errors() {
        parse_log.append_to(log);
    }
    result
}
