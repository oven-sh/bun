use core::sync::atomic::{AtomicU8, Ordering};
use std::io::Write as _;

use bun_collections::{ArrayHashMap, DynamicBitSet, StringHashMap, UnboundedQueue};
use bun_core::{Environment, Global, Output};
use bun_logger::Log;
use bun_paths::{self as paths, AbsPath, AutoRelPath, Path, PathBuffer, RelPath};
use bun_str::{strings, ZStr};
use bun_sys::{self as sys, Fd};
use bun_threading::{Mutex, ThreadPool};


use bun_semver::String as SemverString;

use bun_install::{
    self as install, invalid_dependency_id, Bin, DependencyID, FileCopier, Lockfile, PackageID,
    PackageInstall, PackageManager, PackageNameHash, PostinstallOptimizer, Resolution, Store,
    TruncatedPackageNameHash,
};
use bun_install::isolated_install::{FileCloner, Hardlinker, Symlinker};
use bun_install::lockfile::Package;

type Bitset = DynamicBitSet;
type Progress = bun_core::Progress;

bun_output::declare_scope!(IsolatedInstaller, hidden);
macro_rules! debug {
    ($($args:tt)*) => { bun_output::scoped_log!(IsolatedInstaller, $($args)*) };
}

pub struct Installer<'a> {
    pub trusted_dependencies_mutex: Mutex,
    // this is not const for `lockfile.trusted_dependencies`
    pub lockfile: &'a mut Lockfile,

    pub summary: PackageInstall::Summary, // = .{ .successfully_installed = .empty }
    pub installed: Bitset,
    pub install_node: Option<&'a mut Progress::Node>,
    pub scripts_node: Option<&'a mut Progress::Node>,
    pub is_new_bun_modules: bool,

    pub manager: &'a mut PackageManager,
    pub command_ctx: Command::Context,

    pub store: &'a Store,

    pub task_queue: UnboundedQueue<Task>, // intrusive via .next
    pub tasks: Box<[Task]>,

    pub supported_backend: bun_core::Atomic<PackageInstall::Method>,

    pub trusted_dependencies_from_update_requests: ArrayHashMap<TruncatedPackageNameHash, ()>,

    /// Absolute path to the global virtual store (`<cache_dir>/links`). When
    /// non-null, npm/git/tarball entries are materialized once into this
    /// directory and `node_modules/.bun/<storepath>` becomes a symlink into
    /// it, so warm installs are O(packages) symlinks instead of O(files)
    /// clonefile work.
    pub global_store_path: Option<&'a ZStr>,

    /// Per-process suffix for staging global-store entries. Each entry is
    /// built under `<cache>/links/<storepath>-<hash>.tmp-<this>/` (package
    /// files, dep symlinks, bin links — all relative within the entry, so
    /// they resolve identically after the rename) and renamed into place as
    /// the final step. The directory existing at its final path is the only
    /// completeness signal the warm-hit check needs.
    pub global_store_tmp_suffix: u64,
}

impl<'a> Installer<'a> {
    /// Called from main thread
    pub fn start_task(&mut self, entry_id: Store::Entry::Id) {
        let task = &mut self.tasks[entry_id.get()];
        debug_assert!(matches!(
            task.result,
            // first time starting the task
            Result::None
            // the task returned to the main thread because it was blocked
            | Result::Blocked
            // the task returned to the main thread to spawn some scripts
            | Result::RunScripts(_)
        ));

        task.result = Result::None;
        self.manager.thread_pool.schedule(ThreadPool::Batch::from(&mut task.task));
    }

    pub fn on_package_extracted(&mut self, task_id: install::Task::Id) {
        if let Some(removed) = self.manager.task_queue.fetch_remove(task_id) {
            let store = self.store;

            let node_pkg_ids = store.nodes.items().pkg_id;

            let entries = store.entries.slice();
            let entry_steps = entries.items().step;
            let entry_node_ids = entries.items().node_id;

            let pkgs = self.lockfile.packages.slice();
            let pkg_names = pkgs.items().name;
            let pkg_name_hashes = pkgs.items().name_hash;
            let pkg_resolutions = pkgs.items().resolution;

            for install_ctx in removed.value.as_slice() {
                let entry_id = install_ctx.isolated_package_install_context;

                let node_id = entry_node_ids[entry_id.get()];
                let pkg_id = node_pkg_ids[node_id.get()];
                let pkg_name = pkg_names[pkg_id];
                let pkg_name_hash = pkg_name_hashes[pkg_id];
                let pkg_res = &pkg_resolutions[pkg_id];

                let patch_info = self
                    .package_patch_info(pkg_name, pkg_name_hash, pkg_res)
                    .unwrap_or_oom();

                if let PatchInfo::Patch(patch) = &patch_info {
                    let mut log = Log::init();
                    self.apply_package_patch(entry_id, patch, &mut log);
                    if log.has_errors() {
                        // monotonic is okay because we haven't started the task yet (it isn't running
                        // on another thread)
                        entry_steps[entry_id.get()].store(Step::Done, Ordering::Relaxed);
                        self.on_task_fail(entry_id, TaskError::Patching(log));
                        continue;
                    }
                }

                self.start_task(entry_id);
            }
        }
    }

    /// Called from main thread when a tarball download or extraction fails.
    /// Without this, the upfront pending-task slot for each waiting entry is
    /// never released and the install loop blocks forever on
    /// `pendingTaskCount() == 0`.
    pub fn on_package_download_error(
        &mut self,
        task_id: install::Task::Id,
        name: &[u8],
        resolution: &Resolution,
        err: bun_core::Error,
        url: &[u8],
    ) {
        if let Some(removed) = self.manager.task_queue.fetch_remove(task_id) {
            let callbacks = removed.value;

            let entry_steps = self.store.entries.items().step;
            for install_ctx in callbacks.as_slice() {
                let entry_id = install_ctx.isolated_package_install_context;
                entry_steps[entry_id.get()].store(Step::Done, Ordering::Relaxed);
                self.on_task_fail(
                    entry_id,
                    TaskError::Download(DownloadError { err, url: url.into() }),
                );
            }
            // callbacks dropped here
        } else {
            // No waiting entry — still surface the error so it isn't lost.
            let string_buf = self.lockfile.buffers.string_bytes.as_slice();
            Output::err_generic(format_args!(
                "failed to download <b>{}@{}<r>: {}\n  <d>{}<r>",
                bstr::BStr::new(name),
                resolution.fmt(string_buf, bun_core::fmt::PathSep::Auto),
                bstr::BStr::new(download_error_reason(err)),
                bstr::BStr::new(url),
            ));
            Output::flush();
        }
    }

    pub fn apply_package_patch(
        &mut self,
        entry_id: Store::Entry::Id,
        patch: &PatchInfoPatch,
        log: &mut Log,
    ) {
        let store = self.store;
        let entry_node_ids = store.entries.items().node_id;
        let node_id = entry_node_ids[entry_id.get()];
        let node_pkg_ids = store.nodes.items().pkg_id;
        let pkg_id = node_pkg_ids[node_id.get()];
        let mut patch_task = install::PatchTask::new_apply_patch_hash(
            self.manager,
            pkg_id,
            patch.contents_hash,
            patch.name_and_version_hash,
        );
        // patch_task dropped at end of scope
        patch_task.apply().unwrap_or_oom();

        if patch_task.callback.apply.logger.has_errors() {
            patch_task
                .callback
                .apply
                .logger
                .clone_to_with_recycled(log, true)
                .unwrap_or_oom();
        }
    }

    /// Called from main thread
    pub fn on_task_fail(&mut self, entry_id: Store::Entry::Id, err: TaskError) {
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();

        let entries = self.store.entries.slice();
        let entry_node_ids = entries.items().node_id;

        let nodes = self.store.nodes.slice();
        let node_pkg_ids = nodes.items().pkg_id;

        let pkgs = self.lockfile.packages.slice();
        let pkg_names = pkgs.items().name;
        let pkg_resolutions = pkgs.items().resolution;

        let node_id = entry_node_ids[entry_id.get()];
        let pkg_id = node_pkg_ids[node_id.get()];

        let pkg_name = pkg_names[pkg_id];
        let pkg_res = pkg_resolutions[pkg_id];

        match &err {
            TaskError::LinkPackage(link_err) => {
                Output::err(
                    link_err,
                    format_args!(
                        "failed to link package: {}@{}",
                        bstr::BStr::new(pkg_name.slice(string_buf)),
                        pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Auto),
                    ),
                );
            }
            TaskError::SymlinkDependencies(symlink_err) => {
                Output::err(
                    symlink_err,
                    format_args!(
                        "failed to symlink dependencies for package: {}@{}",
                        bstr::BStr::new(pkg_name.slice(string_buf)),
                        pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Auto),
                    ),
                );
            }
            TaskError::Patching(patch_log) => {
                Output::err_generic(format_args!(
                    "failed to patch package: {}@{}",
                    bstr::BStr::new(pkg_name.slice(string_buf)),
                    pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Auto),
                ));
                let _ = patch_log.print(Output::error_writer());
            }
            TaskError::Binaries(bin_err) => {
                Output::err(
                    bin_err,
                    format_args!(
                        "failed to link binaries for package: {}@{}",
                        bstr::BStr::new(pkg_name.slice(string_buf)),
                        pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Auto),
                    ),
                );
            }
            TaskError::Download(dl) => {
                Output::err_generic(format_args!(
                    "failed to download <b>{}@{}<r>: {}\n  <d>{}<r>",
                    bstr::BStr::new(pkg_name.slice(string_buf)),
                    pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Auto),
                    bstr::BStr::new(download_error_reason(dl.err)),
                    bstr::BStr::new(&dl.url),
                ));
            }
            _ => {}
        }
        Output::flush();

        // Clean up the staging directory so a half-built global-store entry
        // doesn't leak in the cache (it would never be reused — the suffix is
        // random — but it's wasted disk).
        if self.entry_uses_global_store(entry_id) {
            let mut staging = AbsPath::<{ paths::sep::AUTO }>::init();
            self.append_global_store_entry_path(&mut staging, entry_id, Which::Staging);
            let _ = Fd::cwd().delete_tree(staging.slice());
        }

        // attempt deleting the package so the next install will install it again
        match pkg_res.tag {
            Resolution::Tag::Uninitialized
            | Resolution::Tag::SingleFileModule
            | Resolution::Tag::Root
            | Resolution::Tag::Workspace
            | Resolution::Tag::Symlink => {}

            // to be safe make sure we only delete packages in the store
            Resolution::Tag::Npm
            | Resolution::Tag::Git
            | Resolution::Tag::Github
            | Resolution::Tag::LocalTarball
            | Resolution::Tag::RemoteTarball
            | Resolution::Tag::Folder => {
                let mut store_path = RelPath::<{ paths::sep::AUTO }>::init();

                store_path.append_fmt(format_args!(
                    "node_modules/{}",
                    Store::Entry::fmt_store_path(entry_id, self.store, self.lockfile),
                ));

                let _ = sys::unlink(store_path.slice_z());
            }

            _ => {}
        }

        if self.manager.options.enable.fail_early {
            Global::exit(1);
        }

        self.summary.fail += 1;

        self.decrement_pending_tasks();
        self.resume_unblocked_tasks();
    }

    pub fn decrement_pending_tasks(&mut self) {
        self.manager.decrement_pending_tasks();
    }

    /// Called from main thread
    pub fn on_task_blocked(&mut self, entry_id: Store::Entry::Id) {
        // race condition (fixed now): task decides it is blocked because one of its dependencies
        // has not finished. before the task can mark itself as blocked, the dependency finishes its
        // install, causing the task to never finish because resumeUnblockedTasks is called before
        // its state is set to blocked.
        //
        // fix: check if the task is unblocked after the task returns blocked, and only set/unset
        // blocked from the main thread.

        let mut parent_dedupe: ArrayHashMap<Store::Entry::Id, ()> = ArrayHashMap::default();

        if !self.is_task_blocked(entry_id, &mut parent_dedupe) {
            // .monotonic is okay because the task isn't running right now.
            self.store.entries.items().step[entry_id.get()]
                .store(Step::SymlinkDependencyBinaries, Ordering::Relaxed);
            self.start_task(entry_id);
            return;
        }

        // .monotonic is okay because the task isn't running right now.
        self.store.entries.items().step[entry_id.get()].store(Step::Blocked, Ordering::Relaxed);
    }

    /// Called from both the main thread (via `onTaskBlocked` and `resumeUnblockedTasks`) and the
    /// task thread (via `run`). `parent_dedupe` should not be shared between threads.
    fn is_task_blocked(
        &self,
        entry_id: Store::Entry::Id,
        parent_dedupe: &mut ArrayHashMap<Store::Entry::Id, ()>,
    ) -> bool {
        let entries = self.store.entries.slice();
        let entry_deps = entries.items().dependencies;
        let entry_steps = entries.items().step;

        let deps = &entry_deps[entry_id.get()];
        for dep in deps.slice() {
            if entry_steps[dep.entry_id.get()].load(Ordering::Acquire) != Step::Done {
                parent_dedupe.clear();
                if self.store.is_cycle(entry_id, dep.entry_id, parent_dedupe) {
                    continue;
                }
                return true;
            }
        }
        false
    }

    /// Called from main thread
    pub fn on_task_complete(&mut self, entry_id: Store::Entry::Id, state: CompleteState) {
        if Environment::CI_ASSERT {
            // .monotonic is okay because we should have already synchronized with the completed
            // task thread by virtue of popping from the `UnboundedQueue`.
            bun_core::assert_with_location(
                self.store.entries.items().step[entry_id.get()].load(Ordering::Relaxed)
                    == Step::Done,
                core::panic::Location::caller(),
            );
        }

        self.decrement_pending_tasks();
        self.resume_unblocked_tasks();

        if let Some(node) = self.install_node.as_mut() {
            node.complete_one();
        }

        let nodes = self.store.nodes.slice();

        let (node_id, real_state) = 'state: {
            if entry_id == Store::Entry::Id::ROOT {
                break 'state (Store::Node::Id::ROOT, CompleteState::Skipped);
            }

            let node_id = self.store.entries.items().node_id[entry_id.get()];
            let dep_id = nodes.items().dep_id[node_id.get()];

            if dep_id == invalid_dependency_id {
                // should be coverd by `entry_id == .root` above, but
                // just in case
                break 'state (Store::Node::Id::ROOT, CompleteState::Skipped);
            }

            let dep = self.lockfile.buffers.dependencies[dep_id];

            if dep.behavior.is_workspace() {
                break 'state (node_id, CompleteState::Skipped);
            }

            break 'state (node_id, state);
        };

        match real_state {
            CompleteState::Success => {
                self.summary.success += 1;
            }
            CompleteState::Skipped => {
                self.summary.skipped += 1;
                return;
            }
            CompleteState::Fail => {
                self.summary.fail += 1;
                return;
            }
        }

        let pkg_id = nodes.items().pkg_id[node_id.get()];

        let is_duplicate = self.installed.is_set(pkg_id);
        self.summary.success += (!is_duplicate) as u32;
        self.installed.set(pkg_id);
    }

    // This function runs only on the main thread. The installer tasks threads
    // will be changing values in `entry_step`, but the blocked state is only
    // set on the main thread, allowing the code between
    // `entry_steps[entry_id.get()].load(.monotonic)`
    // and
    // `entry_steps[entry_id.get()].store(.symlink_dependency_binaries, .monotonic)`
    pub fn resume_unblocked_tasks(&mut self) {
        let entries = self.store.entries.slice();
        let entry_steps = entries.items().step;

        let mut parent_dedupe: ArrayHashMap<Store::Entry::Id, ()> = ArrayHashMap::default();

        for id_int in 0..self.store.entries.len() {
            let entry_id = Store::Entry::Id::from(u32::try_from(id_int).unwrap());

            // .monotonic is okay because only the main thread sets this to `.blocked`.
            let entry_step = entry_steps[entry_id.get()].load(Ordering::Relaxed);
            if entry_step != Step::Blocked {
                continue;
            }

            if self.is_task_blocked(entry_id, &mut parent_dedupe) {
                continue;
            }

            // .monotonic is okay because the task isn't running right now.
            entry_steps[entry_id.get()].store(Step::SymlinkDependencyBinaries, Ordering::Relaxed);
            self.start_task(entry_id);
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CompleteState {
    Success,
    Skipped,
    Fail,
}

fn download_error_reason(e: bun_core::Error) -> &'static [u8] {
    match e {
        e if e == bun_core::err!("TarballHTTP400") => b"400 Bad Request",
        e if e == bun_core::err!("TarballHTTP401") => b"401 Unauthorized",
        e if e == bun_core::err!("TarballHTTP402") => b"402 Payment Required",
        e if e == bun_core::err!("TarballHTTP403") => b"403 Forbidden",
        e if e == bun_core::err!("TarballHTTP404") => b"404 Not Found",
        e if e == bun_core::err!("TarballHTTP4xx") => b"HTTP 4xx",
        e if e == bun_core::err!("TarballHTTP5xx") => b"HTTP 5xx",
        e if e == bun_core::err!("TarballFailedToExtract") => b"failed to extract",
        e if e == bun_core::err!("TarballFailedToDownload") => b"download failed",
        _ => e.name().as_bytes(),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Task
// ──────────────────────────────────────────────────────────────────────────

pub struct Task {
    pub entry_id: Store::Entry::Id,
    pub installer: *mut Installer<'static>, // BACKREF: Installer owns tasks[]

    pub task: ThreadPool::Task,
    pub next: *mut Task, // INTRUSIVE: bun.UnboundedQueue(Task, .next) link

    pub result: Result,
}

pub enum Result {
    None,
    Err(TaskError),
    Blocked,
    RunScripts(*mut Package::Scripts::List), // TODO(port): LIFETIMES.tsv=BORROW_FIELD &'a mut Package::Scripts::List — kept raw for borrowck (owned by store.entries.items(.scripts)[entry_id])
    Done,
}

pub struct DownloadError {
    pub err: bun_core::Error,
    pub url: Box<[u8]>,
}

pub enum TaskError {
    LinkPackage(sys::Error),
    SymlinkDependencies(sys::Error),
    RunScripts(bun_core::Error),
    Binaries(bun_core::Error),
    Patching(Log),
    Download(DownloadError),
}

impl TaskError {
    pub fn clone(&self) -> TaskError {
        match self {
            TaskError::LinkPackage(err) => TaskError::LinkPackage(err.clone()),
            TaskError::SymlinkDependencies(err) => TaskError::SymlinkDependencies(err.clone()),
            TaskError::Binaries(err) => TaskError::Binaries(*err),
            TaskError::RunScripts(err) => TaskError::RunScripts(*err),
            TaskError::Patching(log) => TaskError::Patching(log.clone()), // TODO(port): Log clone semantics
            TaskError::Download(dl) => TaskError::Download(DownloadError {
                err: dl.err,
                url: dl.url.clone(),
            }),
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Step {
    LinkPackage,
    SymlinkDependencies,

    CheckIfBlocked,

    // blocked can only happen here

    SymlinkDependencyBinaries,
    RunPreinstall,

    // pause here while preinstall runs

    Binaries,
    RunPostInstallAndPrePostPrepare, // "run (post)install and (pre/post)prepare"

    // pause again while remaining scripts run.

    Done,

    // only the main thread sets blocked, and only the main thread
    // sets a blocked task to symlink_dependency_binaries
    Blocked,
}

pub enum Yield {
    Yield,
    RunScripts(*mut Package::Scripts::List), // TODO(port): LIFETIMES.tsv=BORROW_PARAM &'a mut Package::Scripts::List — kept raw for borrowck (borrow of entry_scripts)
    Done,
    Blocked,
    Fail(TaskError),
}

impl Yield {
    pub fn failure(e: TaskError) -> Yield {
        // clone here in case a path is kept in a buffer that
        // will be freed at the end of the current scope.
        Yield::Fail(e.clone())
    }
}

impl Task {
    /// Called from task thread
    // PERF(port): was comptime enum monomorphization — profile in Phase B
    fn next_step(&self, current_step: Step) -> Step {
        let next_step: Step = match current_step {
            Step::LinkPackage => Step::SymlinkDependencies,
            Step::SymlinkDependencies => Step::CheckIfBlocked,
            Step::CheckIfBlocked => Step::SymlinkDependencyBinaries,
            Step::SymlinkDependencyBinaries => Step::RunPreinstall,
            Step::RunPreinstall => Step::Binaries,
            Step::Binaries => Step::RunPostInstallAndPrePostPrepare,
            Step::RunPostInstallAndPrePostPrepare => Step::Done,

            Step::Done | Step::Blocked => unreachable!("unexpected step"),
        };

        // SAFETY: installer outlives all tasks (BACKREF)
        let installer = unsafe { &*self.installer };
        installer.store.entries.items().step[self.entry_id.get()]
            .store(next_step, Ordering::Release);

        next_step
    }

    /// Called from task thread
    fn run(&mut self) -> core::result::Result<Yield, bun_alloc::AllocError> {
        // SAFETY: installer outlives all tasks (BACKREF)
        let installer = unsafe { &mut *self.installer };
        let manager = &mut *installer.manager;
        let lockfile = &*installer.lockfile;

        let pkgs = installer.lockfile.packages.slice();
        let pkg_names = pkgs.items().name;
        let pkg_name_hashes = pkgs.items().name_hash;
        let pkg_resolutions = pkgs.items().resolution;
        let pkg_resolutions_lists = pkgs.items().resolutions;
        let pkg_metas: &[Lockfile::Package::Meta] = pkgs.items().meta;
        let pkg_bins = pkgs.items().bin;
        let pkg_script_lists = pkgs.items().scripts;

        let entries = installer.store.entries.slice();
        let entry_node_ids = entries.items().node_id;
        let entry_dependencies = entries.items().dependencies;
        let entry_steps = entries.items().step;
        let entry_scripts = entries.items().scripts;
        let entry_hoisted = entries.items().hoisted;

        let nodes = installer.store.nodes.slice();
        let node_pkg_ids = nodes.items().pkg_id;
        let node_dep_ids = nodes.items().dep_id;

        let node_id = entry_node_ids[self.entry_id.get()];
        let pkg_id = node_pkg_ids[node_id.get()];
        let dep_id = node_dep_ids[node_id.get()];

        let pkg_name = pkg_names[pkg_id];
        let pkg_name_hash = pkg_name_hashes[pkg_id];
        let pkg_res = pkg_resolutions[pkg_id];

        // TODO(port): Zig labeled-switch `next_step:` modeled as loop+match
        let mut step = entry_steps[self.entry_id.get()].load(Ordering::Acquire);
        loop {
            match step {
                Step::LinkPackage => {
                    let current_step = Step::LinkPackage;
                    let string_buf = lockfile.buffers.string_bytes.as_slice();

                    // Compute pkg_cache_dir_subpath; for .folder/.root the work happens inline and
                    // we `continue` to next step from inside the match.
                    let pkg_cache_dir_subpath_init = match pkg_res.tag {
                        Resolution::Tag::Folder | Resolution::Tag::Root => {
                            let path: &[u8] = match pkg_res.tag {
                                Resolution::Tag::Folder => pkg_res.value.folder.slice(string_buf),
                                Resolution::Tag::Root => b".",
                                _ => unreachable!(),
                            };
                            // the folder does not exist in the cache. xdev is per folder dependency
                            let folder_dir = match bun_sys::open_dir_for_iteration(Fd::cwd(), path) {
                                sys::Result::Ok(fd) => fd,
                                sys::Result::Err(err) => {
                                    return Ok(Yield::failure(TaskError::LinkPackage(err)));
                                }
                            };
                            let _folder_dir_guard = scopeguard::guard((), |_| folder_dir.close());

                            // TODO(port): Zig labeled-switch `backend:` modeled as loop+match
                            let mut backend = PackageInstall::Method::Hardlink;
                            'backend: loop {
                                match backend {
                                    PackageInstall::Method::Hardlink => {
                                        let mut src =
                                            AbsPath::<{ paths::os_unit::AUTO }>::init_top_level_dir_long_path();
                                        src.append_join(pkg_res.value.folder.slice(string_buf));

                                        let mut dest = Path::<{ paths::os_unit::AUTO }>::init();
                                        installer.append_store_path(&mut dest, self.entry_id);

                                        let mut hardlinker = Hardlinker::init(
                                            folder_dir,
                                            src,
                                            dest,
                                            &[paths::os_path_literal!("node_modules")],
                                        )?;

                                        match hardlinker.link()? {
                                            sys::Result::Ok(()) => {}
                                            sys::Result::Err(err) => {
                                                if err.get_errno() == sys::Errno::XDEV {
                                                    backend = PackageInstall::Method::Copyfile;
                                                    continue 'backend;
                                                }

                                                if PackageManager::verbose_install() {
                                                    Output::pretty_errorln(format_args!(
                                                        "<red><b>error<r><d>:<r>Failed to hardlink package folder\n{}\n<d>From: {}<r>\n<d>  To: {}<r>\n<r>",
                                                        err,
                                                        bun_core::fmt::fmt_os_path(src.slice(), paths::PathSep::Auto),
                                                        bun_core::fmt::fmt_os_path(dest.slice(), paths::PathSep::Auto),
                                                    ));
                                                    Output::flush();
                                                }
                                                return Ok(Yield::failure(TaskError::LinkPackage(err)));
                                            }
                                        }
                                        break 'backend;
                                    }

                                    PackageInstall::Method::Copyfile => {
                                        let mut src_path =
                                            AbsPath::<{ paths::os_unit::AUTO }>::init();

                                        #[cfg(windows)]
                                        {
                                            let src_path_len =
                                                bun_sys::windows::GetFinalPathNameByHandleW(
                                                    folder_dir.cast(),
                                                    src_path.buf().as_mut_ptr(),
                                                    u32::try_from(src_path.buf().len()).unwrap(),
                                                    0,
                                                );

                                            if src_path_len == 0
                                                || src_path_len as usize >= src_path.buf().len()
                                            {
                                                let err: sys::SystemErrno = if src_path_len == 0 {
                                                    bun_sys::windows::Win32Error::get()
                                                        .to_system_errno()
                                                        .unwrap_or(sys::SystemErrno::EUNKNOWN)
                                                } else {
                                                    sys::SystemErrno::ENAMETOOLONG
                                                };
                                                return Ok(Yield::failure(TaskError::LinkPackage(
                                                    sys::Error {
                                                        errno: err as _,
                                                        syscall: sys::Syscall::Copyfile,
                                                        ..Default::default()
                                                    },
                                                )));
                                            }

                                            src_path.set_length(src_path_len);
                                        }

                                        let mut dest = Path::<{ paths::os_unit::AUTO }>::init();
                                        installer.append_store_path(&mut dest, self.entry_id);

                                        let mut file_copier = FileCopier::init(
                                            folder_dir,
                                            src_path,
                                            dest,
                                            &[paths::os_path_literal!("node_modules")],
                                        )?;

                                        match file_copier.copy() {
                                            sys::Result::Ok(()) => {}
                                            sys::Result::Err(err) => {
                                                if PackageManager::verbose_install() {
                                                    Output::pretty_errorln(format_args!(
                                                        "<red><b>error<r><d>:<r>Failed to copy package\n{}\n<d>From: {}<r>\n<d>  To: {}<r>\n<r>",
                                                        err,
                                                        bun_core::fmt::fmt_os_path(src_path.slice(), paths::PathSep::Auto),
                                                        bun_core::fmt::fmt_os_path(dest.slice(), paths::PathSep::Auto),
                                                    ));
                                                    Output::flush();
                                                }
                                                return Ok(Yield::failure(TaskError::LinkPackage(err)));
                                            }
                                        }
                                        break 'backend;
                                    }

                                    _ => unreachable!(),
                                }
                            }

                            step = self.next_step(current_step);
                            continue;
                        }

                        tag => {
                            let patch_info =
                                installer.package_patch_info(pkg_name, pkg_name_hash, &pkg_res)?;

                            match tag {
                                Resolution::Tag::Npm => manager.cached_npm_package_folder_name(
                                    pkg_name.slice(string_buf),
                                    pkg_res.value.npm.version,
                                    patch_info.contents_hash(),
                                ),
                                Resolution::Tag::Git => manager.cached_git_folder_name(
                                    &pkg_res.value.git,
                                    patch_info.contents_hash(),
                                ),
                                Resolution::Tag::Github => manager.cached_github_folder_name(
                                    &pkg_res.value.github,
                                    patch_info.contents_hash(),
                                ),
                                Resolution::Tag::LocalTarball => manager.cached_tarball_folder_name(
                                    pkg_res.value.local_tarball,
                                    patch_info.contents_hash(),
                                ),
                                Resolution::Tag::RemoteTarball => manager
                                    .cached_tarball_folder_name(
                                        pkg_res.value.remote_tarball,
                                        patch_info.contents_hash(),
                                    ),

                                _ => {
                                    if Environment::CI_ASSERT {
                                        bun_core::assert_with_location(
                                            false,
                                            core::panic::Location::caller(),
                                        );
                                    }

                                    step = self.next_step(current_step);
                                    continue;
                                }
                            }
                        }
                    };
                    let pkg_cache_dir_subpath = AutoRelPath::from(pkg_cache_dir_subpath_init);

                    let (cache_dir, cache_dir_path) = manager.get_cache_directory_and_abs_path();

                    let mut dest_subpath = Path::<{ paths::os_unit::AUTO }>::init();
                    installer.append_real_store_path(&mut dest_subpath, self.entry_id, Which::Staging);

                    let uses_global_store = installer.entry_uses_global_store(self.entry_id);

                    if !uses_global_store {
                        // An entry can lose global-store eligibility between
                        // installs — newly patched, newly trusted, a dep that
                        // became a workspace package. The previous install
                        // left `node_modules/.bun/<storepath>` as a symlink
                        // (or junction) into the shared `<cache>/links/`
                        // directory. Writing the new project-local tree
                        // *through* that link would mutate the shared entry
                        // underneath every other consumer; on Windows the
                        // `.expect_missing` dep-symlink rewrite then bakes a
                        // project-absolute junction target into the shared
                        // directory, which dangles after the next
                        // `rm -rf node_modules`. Detach first so the build
                        // lands in a real project-local directory.
                        let mut local = Path::<{ paths::sep::AUTO }>::init_top_level_dir();
                        installer.append_local_store_entry_path(&mut local, self.entry_id);
                        let is_stale_link: bool = {
                            #[cfg(windows)]
                            {
                                if let Some(a) = sys::get_file_attributes(local.slice_z()) {
                                    a.is_reparse_point
                                } else {
                                    false
                                }
                            }
                            #[cfg(not(windows))]
                            {
                                if let Some(st) = sys::lstat(local.slice_z()).as_value() {
                                    sys::posix::s_islnk(u32::try_from(st.mode).unwrap())
                                } else {
                                    false
                                }
                            }
                        };
                        if is_stale_link {
                            let remove_err: Option<sys::Error> = {
                                #[cfg(windows)]
                                {
                                    'win: {
                                        if let Some(_e) = sys::rmdir(local.slice_z()).as_err() {
                                            if let Some(e) = sys::unlink(local.slice_z()).as_err() {
                                                break 'win Some(e);
                                            }
                                        }
                                        break 'win None;
                                    }
                                }
                                #[cfg(not(windows))]
                                {
                                    sys::unlink(local.slice_z()).as_err()
                                }
                            };
                            if let Some(e) = remove_err {
                                if e.get_errno() != sys::Errno::NOENT {
                                    // Do NOT proceed: the backend below would
                                    // write *through* the still-live symlink
                                    // into the shared `<cache>/links/` entry.
                                    return Ok(Yield::failure(TaskError::LinkPackage(e)));
                                }
                            }
                        }
                    }

                    if uses_global_store {
                        // Clear any leftover staging directory from a crashed
                        // earlier run with the same suffix (vanishingly
                        // unlikely with a 64-bit random suffix, but cheap).
                        let mut staging = AbsPath::<{ paths::sep::AUTO }>::init();
                        installer.append_global_store_entry_path(&mut staging, self.entry_id, Which::Staging);
                        let _ = Fd::cwd().delete_tree(staging.slice());
                    }

                    let mut cached_package_dir: Option<Fd> = None;
                    let _cached_package_dir_guard =
                        scopeguard::guard((), |_| {
                            if let Some(dir) = cached_package_dir {
                                dir.close();
                            }
                        });
                    // TODO(port): errdefer — scopeguard captures &mut cached_package_dir; reshaped for borrowck

                    // .monotonic access of `supported_backend` is okay because it's an
                    // optimization. It's okay if another thread doesn't see an update to this
                    // value "in time".
                    let mut backend = installer.supported_backend.load(Ordering::Relaxed);
                    'backend: loop {
                        match backend {
                            PackageInstall::Method::Clonefile => {
                                #[cfg(not(target_os = "macos"))]
                                {
                                    installer
                                        .supported_backend
                                        .store(PackageInstall::Method::Hardlink, Ordering::Relaxed);
                                    backend = PackageInstall::Method::Hardlink;
                                    continue 'backend;
                                }
                                #[cfg(target_os = "macos")]
                                {
                                    if installer.manager.options.log_level.is_verbose() {
                                        Output::pretty_errorln(format_args!(
                                            "Cloning {} to {}",
                                            bun_core::fmt::fmt_os_path(
                                                pkg_cache_dir_subpath.slice_z(),
                                                paths::PathSep::Auto
                                            ),
                                            bun_core::fmt::fmt_os_path(
                                                dest_subpath.slice_z(),
                                                paths::PathSep::Auto
                                            ),
                                        ));
                                        Output::flush();
                                    }

                                    let mut cloner = FileCloner {
                                        cache_dir,
                                        cache_dir_subpath: pkg_cache_dir_subpath,
                                        dest_subpath,
                                    };

                                    match cloner.clone() {
                                        sys::Result::Ok(()) => {}
                                        sys::Result::Err(err) => match err.get_errno() {
                                            sys::Errno::XDEV => {
                                                installer.supported_backend.store(
                                                    PackageInstall::Method::Copyfile,
                                                    Ordering::Relaxed,
                                                );
                                                backend = PackageInstall::Method::Copyfile;
                                                continue 'backend;
                                            }
                                            sys::Errno::OPNOTSUPP => {
                                                installer.supported_backend.store(
                                                    PackageInstall::Method::Hardlink,
                                                    Ordering::Relaxed,
                                                );
                                                backend = PackageInstall::Method::Hardlink;
                                                continue 'backend;
                                            }
                                            _ => {
                                                return Ok(Yield::failure(TaskError::LinkPackage(
                                                    err,
                                                )));
                                            }
                                        },
                                    }

                                    step = self.next_step(current_step);
                                    continue;
                                }
                            }

                            PackageInstall::Method::Hardlink => {
                                cached_package_dir = match bun_sys::open_dir_for_iteration(
                                    cache_dir,
                                    pkg_cache_dir_subpath.slice(),
                                ) {
                                    sys::Result::Ok(fd) => Some(fd),
                                    sys::Result::Err(err) => {
                                        if PackageManager::verbose_install() {
                                            Output::pretty_errorln(format_args!(
                                                "Failed to open cache directory for hardlink: {}",
                                                bstr::BStr::new(pkg_cache_dir_subpath.slice()),
                                            ));
                                            Output::flush();
                                        }
                                        return Ok(Yield::failure(TaskError::LinkPackage(err)));
                                    }
                                };

                                let mut src = AbsPath::<{ paths::os_unit::AUTO }>::from_long_path(
                                    cache_dir_path.slice(),
                                );
                                src.append_join(pkg_cache_dir_subpath.slice());

                                let mut hardlinker = Hardlinker::init(
                                    cached_package_dir.unwrap(),
                                    src,
                                    dest_subpath,
                                    &[],
                                )?;

                                match hardlinker.link()? {
                                    sys::Result::Ok(()) => {}
                                    sys::Result::Err(err) => {
                                        if err.get_errno() == sys::Errno::XDEV {
                                            installer.supported_backend.store(
                                                PackageInstall::Method::Copyfile,
                                                Ordering::Relaxed,
                                            );
                                            backend = PackageInstall::Method::Copyfile;
                                            continue 'backend;
                                        }
                                        if PackageManager::verbose_install() {
                                            Output::pretty_errorln(format_args!(
                                                "<red><b>error<r><d>:<r>Failed to hardlink package\n{}\n<d>From: {}<r>\n<d>  To: {}<r>\n<r>",
                                                err,
                                                bstr::BStr::new(pkg_cache_dir_subpath.slice()),
                                                bun_core::fmt::fmt_os_path(dest_subpath.slice(), paths::PathSep::Auto),
                                            ));
                                            Output::flush();
                                        }
                                        return Ok(Yield::failure(TaskError::LinkPackage(err)));
                                    }
                                }

                                step = self.next_step(current_step);
                                continue;
                            }

                            // fallthrough copyfile
                            _ => {
                                cached_package_dir = match bun_sys::open_dir_for_iteration(
                                    cache_dir,
                                    pkg_cache_dir_subpath.slice(),
                                ) {
                                    sys::Result::Ok(fd) => Some(fd),
                                    sys::Result::Err(err) => {
                                        if PackageManager::verbose_install() {
                                            Output::pretty_errorln(format_args!(
                                                "<red><b>error<r><d>:<r>Failed to open cache directory for copyfile\n{}\n<d>From: {}<r>\n<d>  To: {}<r>\n<r>",
                                                err,
                                                bstr::BStr::new(pkg_cache_dir_subpath.slice()),
                                                bun_core::fmt::fmt_os_path(dest_subpath.slice(), paths::PathSep::Auto),
                                            ));
                                            Output::flush();
                                        }
                                        return Ok(Yield::failure(TaskError::LinkPackage(err)));
                                    }
                                };

                                let mut src_path =
                                    AbsPath::<{ paths::os_unit::AUTO }>::from(cache_dir_path.slice());
                                src_path.append(pkg_cache_dir_subpath.slice());

                                let mut file_copier = FileCopier::init(
                                    cached_package_dir.unwrap(),
                                    src_path,
                                    dest_subpath,
                                    &[],
                                )?;

                                match file_copier.copy() {
                                    sys::Result::Ok(()) => {}
                                    sys::Result::Err(err) => {
                                        if PackageManager::verbose_install() {
                                            Output::pretty_errorln(format_args!(
                                                "<red><b>error<r><d>:<r>Failed to copy package\n{}\n<d>From: {}<r>\n<d>  To: {}<r>\n<r>",
                                                err,
                                                bstr::BStr::new(pkg_cache_dir_subpath.slice()),
                                                bun_core::fmt::fmt_os_path(dest_subpath.slice(), paths::PathSep::Auto),
                                            ));
                                            Output::flush();
                                        }
                                        return Ok(Yield::failure(TaskError::LinkPackage(err)));
                                    }
                                }

                                step = self.next_step(current_step);
                                continue;
                            }
                        }
                    }
                    // unreachable: every backend arm continues to next_step or returns
                }

                Step::SymlinkDependencies => {
                    let current_step = Step::SymlinkDependencies;
                    let string_buf = lockfile.buffers.string_bytes.as_slice();
                    let dependencies = lockfile.buffers.dependencies.as_slice();

                    for dep in entry_dependencies[self.entry_id.get()].slice() {
                        let dep_name = dependencies[dep.dep_id].name.slice(string_buf);

                        let mut dest = Path::<{ paths::sep::AUTO }>::init_top_level_dir();

                        installer.append_real_store_node_modules_path(
                            &mut dest,
                            self.entry_id,
                            Which::Staging,
                        );

                        dest.append(dep_name);

                        if let Some(entry_node_modules_name) = installer
                            .entry_store_node_modules_package_name(dep_id, pkg_id, &pkg_res, pkg_names)
                        {
                            if strings::eql_long(dep_name, entry_node_modules_name, true) {
                                // nest the dependency in another node_modules if the name is the same as the entry name
                                // in the store node_modules to avoid collision
                                dest.append(b"node_modules");
                                dest.append(dep_name);
                            }
                        }

                        let mut dep_store_path = AbsPath::<{ paths::sep::AUTO }>::init_top_level_dir();

                        // When this entry lives in the global virtual store, its
                        // dep symlinks must point at sibling *global* entries
                        // (relative `../../<dep>-<hash>/...`) so the entry stays
                        // valid for any project. Non-global parents (root,
                        // workspace) keep pointing at the project-local
                        // `.bun/<storepath>` indirection so `node_modules/<pkg>`
                        // remains a relative link into `node_modules/.bun/`.
                        if installer.entry_uses_global_store(self.entry_id) {
                            // The eligibility DFS + fixed-point pass guarantee
                            // every dep of a global entry is itself global; if
                            // that ever regressed the failure mode is a
                            // dangling symlink with no install-time error.
                            debug_assert!(installer.entry_uses_global_store(dep.entry_id));
                            // Target the dep's *final* path: the relative
                            // `../../<dep>/...` link is computed against our
                            // staging directory but resolves identically once
                            // we're renamed (same parent), and the dep will
                            // have been (or will be) renamed into that final
                            // path by its own task.
                            installer.append_real_store_path(
                                &mut dep_store_path,
                                dep.entry_id,
                                Which::Final,
                            );
                        } else {
                            installer.append_store_path(&mut dep_store_path, dep.entry_id);
                        }

                        let target = {
                            let dest_save = dest.save();
                            // PORT NOTE: reshaped for borrowck — restore via guard
                            let _restore = scopeguard::guard((), |_| dest_save.restore());
                            dest.undo(1);
                            dest.relative(&dep_store_path)
                        };

                        let symlinker = Symlinker {
                            dest,
                            target,
                            fallback_junction_target: dep_store_path,
                        };

                        let link_strategy: Symlinker::Strategy = if matches!(
                            pkg_res.tag,
                            Resolution::Tag::Root | Resolution::Tag::Workspace
                        ) {
                            // root and workspace packages ensure their dependency symlinks
                            // exist unconditionally. To make sure it's fast, first readlink
                            // then create the symlink if necessary
                            Symlinker::Strategy::ExpectExisting
                        } else {
                            // Global-store entries are built under a private
                            // per-process staging directory, so nothing else
                            // is touching this path.
                            Symlinker::Strategy::ExpectMissing
                        };

                        match symlinker.ensure_symlink(link_strategy) {
                            sys::Result::Ok(()) => {}
                            sys::Result::Err(err) => {
                                return Ok(Yield::failure(TaskError::SymlinkDependencies(err)));
                            }
                        }
                    }

                    if installer.entry_uses_global_store(self.entry_id) {
                        // The entry now exists in the shared global virtual store.
                        // Project-local `node_modules/.bun/<storepath>` becomes a
                        // symlink into it so that the relative `../../<dep>` links
                        // created above (which live inside the global entry) remain
                        // reachable from the project's node_modules.
                        match installer.link_project_to_global_store(self.entry_id) {
                            sys::Result::Ok(()) => {}
                            sys::Result::Err(err) => {
                                return Ok(Yield::failure(TaskError::SymlinkDependencies(err)));
                            }
                        }
                    }

                    step = self.next_step(current_step);
                    continue;
                }

                Step::CheckIfBlocked => {
                    let current_step = Step::CheckIfBlocked;
                    // preinstall scripts need to run before binaries can be linked. Block here if any dependencies
                    // of this entry are not finished. Do not count cycles towards blocking.

                    let mut parent_dedupe: ArrayHashMap<Store::Entry::Id, ()> =
                        ArrayHashMap::default();

                    if installer.is_task_blocked(self.entry_id, &mut parent_dedupe) {
                        return Ok(Yield::Blocked);
                    }

                    step = self.next_step(current_step);
                    continue;
                }

                Step::SymlinkDependencyBinaries => {
                    let current_step = Step::SymlinkDependencyBinaries;
                    if let Err(err) = installer.link_dependency_bins(self.entry_id) {
                        return Ok(Yield::failure(TaskError::Binaries(err)));
                    }

                    match pkg_res.tag {
                        Resolution::Tag::Uninitialized
                        | Resolution::Tag::Root
                        | Resolution::Tag::Workspace
                        | Resolution::Tag::Folder
                        | Resolution::Tag::Symlink
                        | Resolution::Tag::SingleFileModule => {}

                        Resolution::Tag::Npm
                        | Resolution::Tag::Git
                        | Resolution::Tag::Github
                        | Resolution::Tag::LocalTarball
                        | Resolution::Tag::RemoteTarball => {
                            if !entry_hoisted[self.entry_id.get()] {
                                step = self.next_step(current_step);
                                continue;
                            }
                            installer.link_to_hidden_node_modules(self.entry_id);
                        }

                        _ => {}
                    }

                    step = self.next_step(current_step);
                    continue;
                }

                Step::RunPreinstall => {
                    let current_step = Step::RunPreinstall;
                    if !installer.manager.options.do_.run_scripts
                        || self.entry_id == Store::Entry::Id::ROOT
                    {
                        step = self.next_step(current_step);
                        continue;
                    }

                    // The eligibility check excludes any package whose
                    // lifecycle scripts are trusted to run, so a global-store
                    // entry should never reach script enqueueing. Guard it
                    // anyway: `meta.hasInstallScript` can be a false negative
                    // (yarn-migrated lockfiles force it to `.false`), and a
                    // script running with cwd inside a shared content-
                    // addressed directory would mutate every other project's
                    // copy.
                    if installer.entry_uses_global_store(self.entry_id) {
                        step = self.next_step(current_step);
                        continue;
                    }

                    let string_buf = installer.lockfile.buffers.string_bytes.as_slice();

                    let dep = installer.lockfile.buffers.dependencies[dep_id];
                    let truncated_dep_name_hash: TruncatedPackageNameHash =
                        dep.name_hash as TruncatedPackageNameHash;

                    let (is_trusted, is_trusted_through_update_request) = 'brk: {
                        if installer
                            .trusted_dependencies_from_update_requests
                            .contains_key(&truncated_dep_name_hash)
                        {
                            break 'brk (true, true);
                        }
                        if installer
                            .lockfile
                            .has_trusted_dependency(dep.name.slice(string_buf), &pkg_res)
                        {
                            break 'brk (true, false);
                        }
                        break 'brk (false, false);
                    };

                    let mut pkg_cwd = AbsPath::<{ paths::sep::AUTO }>::init_top_level_dir();
                    installer.append_store_path(&mut pkg_cwd, self.entry_id);

                    'enqueue_lifecycle_scripts: {
                        if !(pkg_res.tag != Resolution::Tag::Root
                            && (pkg_res.tag == Resolution::Tag::Workspace || is_trusted))
                        {
                            break 'enqueue_lifecycle_scripts;
                        }
                        let mut pkg_scripts: Package::Scripts = pkg_script_lists[pkg_id];
                        if is_trusted
                            && manager.postinstall_optimizer.should_ignore_lifecycle_scripts(
                                PostinstallOptimizer::Query {
                                    name_hash: pkg_name_hash,
                                    version: if pkg_res.tag == Resolution::Tag::Npm {
                                        Some(pkg_res.value.npm.version)
                                    } else {
                                        None
                                    },
                                    version_buf: lockfile.buffers.string_bytes.as_slice(),
                                },
                                installer.lockfile.buffers.resolutions.as_slice(),
                                pkg_metas,
                                manager.options.cpu,
                                manager.options.os,
                                None,
                            )
                        {
                            break 'enqueue_lifecycle_scripts;
                        }

                        let mut log = Log::init();

                        let scripts_list = match pkg_scripts.get_list(
                            &mut log,
                            installer.lockfile,
                            &mut pkg_cwd,
                            dep.name.slice(string_buf),
                            &pkg_res,
                        ) {
                            Ok(v) => v,
                            Err(err) => {
                                return Ok(Yield::failure(TaskError::RunScripts(err)));
                            }
                        };

                        if let Some(list) = scripts_list {
                            let clone: *mut Package::Scripts::List =
                                Box::into_raw(Box::new(list));
                            entry_scripts[self.entry_id.get()] = Some(clone);

                            if is_trusted_through_update_request {
                                let trusted_dep_to_add: Box<[u8]> =
                                    Box::from(dep.name.slice(string_buf));

                                installer.trusted_dependencies_mutex.lock();
                                let _unlock = scopeguard::guard((), |_| {
                                    installer.trusted_dependencies_mutex.unlock();
                                });

                                installer
                                    .manager
                                    .trusted_deps_to_add_to_package_json
                                    .push(trusted_dep_to_add);
                                if installer.lockfile.trusted_dependencies.is_none() {
                                    installer.lockfile.trusted_dependencies = Some(Default::default());
                                }
                                installer
                                    .lockfile
                                    .trusted_dependencies
                                    .as_mut()
                                    .unwrap()
                                    .insert(truncated_dep_name_hash, ());
                            }

                            // SAFETY: clone was just allocated above
                            let list_ref = unsafe { &*clone };
                            if list_ref.first_index != 0 {
                                // has scripts but not a preinstall
                                step = self.next_step(current_step);
                                continue;
                            }

                            return Ok(Yield::RunScripts(clone));
                        }
                    }

                    step = self.next_step(current_step);
                    continue;
                }

                Step::Binaries => {
                    let current_step = Step::Binaries;
                    if self.entry_id == Store::Entry::Id::ROOT {
                        step = self.next_step(current_step);
                        continue;
                    }

                    let bin = pkg_bins[pkg_id];
                    if bin.tag == Bin::Tag::None {
                        match installer.commit_global_store_entry(self.entry_id) {
                            sys::Result::Ok(()) => {}
                            sys::Result::Err(e) => {
                                return Ok(Yield::failure(TaskError::LinkPackage(e)));
                            }
                        }
                        step = self.next_step(current_step);
                        continue;
                    }

                    let string_buf = installer.lockfile.buffers.string_bytes.as_slice();
                    let dependencies = installer.lockfile.buffers.dependencies.as_slice();

                    let dep_name = dependencies[dep_id].name.slice(string_buf);

                    let abs_target_buf = paths::path_buffer_pool().get();
                    let abs_dest_buf = paths::path_buffer_pool().get();
                    let rel_buf = paths::path_buffer_pool().get();

                    let mut seen: StringHashMap<()> = StringHashMap::default();

                    let mut node_modules_path = AbsPath::<{ paths::opts::DEFAULT }>::init_top_level_dir();
                    installer.append_real_store_node_modules_path(
                        &mut node_modules_path,
                        self.entry_id,
                        Which::Staging,
                    );

                    let mut target_node_modules_path: Option<AbsPath<{ paths::opts::DEFAULT }>> = None;

                    let mut target_package_name = strings::StringOrTinyString::init(dep_name);

                    if let Some(replacement_entry_id) = installer.maybe_replace_node_modules_path(
                        entry_node_ids,
                        node_pkg_ids,
                        pkg_name_hashes,
                        pkg_resolutions_lists,
                        installer.lockfile.buffers.resolutions.as_slice(),
                        installer.lockfile.packages.items().meta,
                        pkg_id,
                    ) {
                        let mut p = AbsPath::<{ paths::opts::DEFAULT }>::init_top_level_dir();
                        installer.append_real_store_node_modules_path(
                            &mut p,
                            replacement_entry_id,
                            Which::Final,
                        );
                        target_node_modules_path = Some(p);

                        let replacement_node_id = entry_node_ids[replacement_entry_id.get()];
                        let replacement_pkg_id = node_pkg_ids[replacement_node_id.get()];
                        target_package_name = strings::StringOrTinyString::init(
                            installer.lockfile.str(&pkg_names[replacement_pkg_id]),
                        );
                    }

                    let mut bin_linker = Bin::Linker {
                        bin,
                        global_bin_path: installer.manager.options.bin_path,
                        package_name: strings::StringOrTinyString::init(dep_name),
                        target_package_name,
                        string_buf,
                        extern_string_buf: installer.lockfile.buffers.extern_strings.as_slice(),
                        seen: &mut seen,
                        target_node_modules_path: target_node_modules_path
                            .as_mut()
                            .map(|p| p as *mut _)
                            .unwrap_or(&mut node_modules_path),
                        node_modules_path: &mut node_modules_path,
                        abs_target_buf: &mut *abs_target_buf,
                        abs_dest_buf: &mut *abs_dest_buf,
                        rel_buf: &mut *rel_buf,
                        ..Default::default()
                    };

                    bin_linker.link(false);

                    if target_node_modules_path.is_some()
                        && (bin_linker.skipped_due_to_missing_bin || bin_linker.err.is_some())
                    {
                        target_node_modules_path = None;

                        bin_linker.target_node_modules_path = &mut node_modules_path;
                        bin_linker.target_package_name = strings::StringOrTinyString::init(dep_name);

                        if installer.manager.options.log_level.is_verbose() {
                            Output::pretty_errorln(format_args!(
                                "<d>[Bin Linker]<r> {} -> {} retrying without native bin link",
                                bstr::BStr::new(dep_name),
                                bstr::BStr::new(bin_linker.target_package_name.slice()),
                            ));
                        }

                        bin_linker.link(false);
                    }

                    if let Some(err) = bin_linker.err {
                        return Ok(Yield::failure(TaskError::Binaries(err)));
                    }

                    match installer.commit_global_store_entry(self.entry_id) {
                        sys::Result::Ok(()) => {}
                        sys::Result::Err(e) => {
                            return Ok(Yield::failure(TaskError::LinkPackage(e)));
                        }
                    }

                    step = self.next_step(current_step);
                    continue;
                }

                Step::RunPostInstallAndPrePostPrepare => {
                    let current_step = Step::RunPostInstallAndPrePostPrepare;
                    if !installer.manager.options.do_.run_scripts
                        || self.entry_id == Store::Entry::Id::ROOT
                    {
                        step = self.next_step(current_step);
                        continue;
                    }

                    let Some(list) = entry_scripts[self.entry_id.get()] else {
                        step = self.next_step(current_step);
                        continue;
                    };
                    // SAFETY: list points into store-owned scripts allocation
                    let list = unsafe { &mut *list };

                    if list.first_index == 0 {
                        for (i, item) in list.items[1..].iter().enumerate() {
                            let i = i + 1;
                            if item.is_some() {
                                list.first_index = u32::try_from(i).unwrap();
                                break;
                            }
                        }
                    }

                    if list.first_index == 0 {
                        step = self.next_step(current_step);
                        continue;
                    }

                    // when these scripts finish the package install will be
                    // complete. the task does not have anymore work to complete
                    // so it does not return to the thread pool.

                    return Ok(Yield::RunScripts(list));
                }

                Step::Done => {
                    return Ok(Yield::Done);
                }

                Step::Blocked => {
                    debug_assert!(false);
                    return Ok(Yield::Yield);
                }
            }
        }
    }

    /// Called from task thread
    pub fn callback(task: *mut ThreadPool::Task) {
        // SAFETY: task points to Task.task field
        let this: &mut Task = unsafe {
            &mut *(task as *mut u8)
                .sub(core::mem::offset_of!(Task, task))
                .cast::<Task>()
        };

        let res = match this.run() {
            Ok(r) => r,
            Err(_oom) => bun_core::out_of_memory(),
        };

        // SAFETY: installer outlives all tasks (BACKREF)
        let installer = unsafe { &mut *this.installer };

        match res {
            Yield::Yield => {}
            Yield::RunScripts(list) => {
                if Environment::CI_ASSERT {
                    bun_core::assert_with_location(
                        installer.store.entries.items().scripts[this.entry_id.get()].is_some(),
                        core::panic::Location::caller(),
                    );
                }
                this.result = Result::RunScripts(list);
                installer.task_queue.push(this);
                installer.manager.wake();
            }
            Yield::Done => {
                if Environment::CI_ASSERT {
                    // .monotonic is okay because this should have been set by this thread.
                    bun_core::assert_with_location(
                        installer.store.entries.items().step[this.entry_id.get()]
                            .load(Ordering::Relaxed)
                            == Step::Done,
                        core::panic::Location::caller(),
                    );
                }
                this.result = Result::Done;
                installer.task_queue.push(this);
                installer.manager.wake();
            }
            Yield::Blocked => {
                if Environment::CI_ASSERT {
                    // .monotonic is okay because this should have been set by this thread.
                    bun_core::assert_with_location(
                        installer.store.entries.items().step[this.entry_id.get()]
                            .load(Ordering::Relaxed)
                            == Step::CheckIfBlocked,
                        core::panic::Location::caller(),
                    );
                }
                this.result = Result::Blocked;
                installer.task_queue.push(this);
                installer.manager.wake();
            }
            Yield::Fail(err) => {
                if Environment::CI_ASSERT {
                    // .monotonic is okay because this should have been set by this thread.
                    bun_core::assert_with_location(
                        installer.store.entries.items().step[this.entry_id.get()]
                            .load(Ordering::Relaxed)
                            != Step::Done,
                        core::panic::Location::caller(),
                    );
                }
                installer.store.entries.items().step[this.entry_id.get()]
                    .store(Step::Done, Ordering::Release);
                this.result = Result::Err(err);
                installer.task_queue.push(this);
                installer.manager.wake();
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PatchInfo
// ──────────────────────────────────────────────────────────────────────────

pub enum PatchInfo {
    None,
    Remove(PatchInfoRemove),
    Patch(PatchInfoPatch),
}

pub struct PatchInfoRemove {
    pub name_and_version_hash: u64,
}

pub struct PatchInfoPatch {
    pub name_and_version_hash: u64,
    pub patch_path: Box<[u8]>, // TODO(port): lifetime — slices into lockfile string_buf
    pub contents_hash: u64,
}

impl PatchInfo {
    pub fn contents_hash(&self) -> Option<u64> {
        match self {
            PatchInfo::None | PatchInfo::Remove(_) => None,
            PatchInfo::Patch(patch) => Some(patch.contents_hash),
        }
    }

    pub fn name_and_version_hash(&self) -> Option<u64> {
        match self {
            PatchInfo::None | PatchInfo::Remove(_) => None,
            PatchInfo::Patch(patch) => Some(patch.name_and_version_hash),
        }
    }
}

impl<'a> Installer<'a> {
    pub fn package_patch_info(
        &self,
        pkg_name: SemverString,
        pkg_name_hash: PackageNameHash,
        pkg_res: &Resolution,
    ) -> core::result::Result<PatchInfo, bun_alloc::AllocError> {
        if self.lockfile.patched_dependencies.entries.len() == 0
            && self.manager.patched_dependencies_to_remove.entries.len() == 0
        {
            return Ok(PatchInfo::None);
        }

        let string_buf = self.lockfile.buffers.string_bytes.as_slice();

        let mut version_buf: Vec<u8> = Vec::new();

        write!(&mut version_buf, "{}@", bstr::BStr::new(pkg_name.slice(string_buf)))?;

        match pkg_res.tag {
            Resolution::Tag::Workspace => {
                if let Some(workspace_version) = self.lockfile.workspace_versions.get(&pkg_name_hash)
                {
                    write!(&mut version_buf, "{}", workspace_version.fmt(string_buf))?;
                }
            }
            _ => {
                write!(&mut version_buf, "{}", pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Posix))?;
            }
        }

        let name_and_version_hash = SemverString::Builder::string_hash(&version_buf);

        if let Some(patch) = self.lockfile.patched_dependencies.get(&name_and_version_hash) {
            return Ok(PatchInfo::Patch(PatchInfoPatch {
                name_and_version_hash,
                patch_path: patch.path.slice(string_buf).into(),
                contents_hash: patch.patchfile_hash().unwrap(),
            }));
        }

        if self
            .manager
            .patched_dependencies_to_remove
            .contains_key(&name_and_version_hash)
        {
            return Ok(PatchInfo::Remove(PatchInfoRemove {
                name_and_version_hash,
            }));
        }

        Ok(PatchInfo::None)
    }

    pub fn link_to_hidden_node_modules(&self, entry_id: Store::Entry::Id) {
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();

        let node_id = self.store.entries.items().node_id[entry_id.get()];
        let pkg_id = self.store.nodes.items().pkg_id[node_id.get()];
        let pkg_name = self.lockfile.packages.items().name[pkg_id];

        let mut hidden_hoisted_node_modules = Path::<{ paths::sep::AUTO }>::init();

        hidden_hoisted_node_modules.append(
            // "node_modules" + sep + ".bun" + sep + "node_modules"
            const_format::concatcp!("node_modules", paths::SEP_STR, ".bun", paths::SEP_STR, "node_modules")
                .as_bytes(),
        );
        hidden_hoisted_node_modules.append(pkg_name.slice(string_buf));

        let mut target = RelPath::<{ paths::sep::AUTO }>::init();

        target.append(b"..");
        if strings::index_of_char(pkg_name.slice(string_buf), b'/').is_some() {
            target.append(b"..");
        }

        target.append_fmt(format_args!(
            "{}/node_modules/{}",
            Store::Entry::fmt_store_path(entry_id, self.store, self.lockfile),
            bstr::BStr::new(pkg_name.slice(string_buf)),
        ));

        let mut full_target = AbsPath::<{ paths::sep::AUTO }>::init_top_level_dir();
        self.append_store_path(&mut full_target, entry_id);

        let symlinker = Symlinker {
            dest: hidden_hoisted_node_modules,
            target,
            fallback_junction_target: full_target,
        };

        // symlinks won't exist if node_modules/.bun is new
        let link_strategy: Symlinker::Strategy = if self.is_new_bun_modules {
            Symlinker::Strategy::ExpectMissing
        } else {
            Symlinker::Strategy::ExpectExisting
        };

        let _ = symlinker.ensure_symlink(link_strategy);
    }

    fn maybe_replace_node_modules_path(
        &self,
        entry_node_ids: &[Store::Node::Id],
        node_pkg_ids: &[PackageID],
        name_hashes: &[PackageNameHash],
        pkg_resolutions_lists: &[Lockfile::PackageIDSlice],
        pkg_resolutions_buffer: &[PackageID],
        pkg_metas: &[Package::Meta],
        pkg_id: PackageID,
    ) -> Option<Store::Entry::Id> {
        let postinstall_optimizer = &self.manager.postinstall_optimizer;
        if !postinstall_optimizer.is_native_binlink_enabled() {
            return None;
        }
        let name_hash = name_hashes[pkg_id];

        if let Some(optimizer) = postinstall_optimizer.get(PostinstallOptimizer::Query {
            name_hash,
            ..Default::default()
        }) {
            match optimizer {
                PostinstallOptimizer::Kind::NativeBinlink => {
                    let manager = &self.manager;
                    let target_cpu = manager.options.cpu;
                    let target_os = manager.options.os;
                    if let Some(replacement_pkg_id) =
                        PostinstallOptimizer::get_native_binlink_replacement_package_id(
                            pkg_resolutions_lists[pkg_id].get(pkg_resolutions_buffer),
                            pkg_metas,
                            target_cpu,
                            target_os,
                        )
                    {
                        for (new_entry_id, new_node_id) in entry_node_ids.iter().enumerate() {
                            if node_pkg_ids[new_node_id.get()] == replacement_pkg_id {
                                debug!(
                                    "native bin link {} -> {}",
                                    pkg_id, replacement_pkg_id
                                );
                                return Some(Store::Entry::Id::from(
                                    u32::try_from(new_entry_id).unwrap(),
                                ));
                            }
                        }
                    }
                }
                PostinstallOptimizer::Kind::Ignore => {}
            }
        }

        None
    }

    pub fn link_dependency_bins(
        &self,
        parent_entry_id: Store::Entry::Id,
    ) -> core::result::Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let lockfile = &*self.lockfile;
        let store = self.store;

        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let extern_string_buf = lockfile.buffers.extern_strings.as_slice();

        let entries = store.entries.slice();
        let entry_node_ids: &[Store::Node::Id] = entries.items().node_id;
        let entry_deps = entries.items().dependencies;

        let nodes = store.nodes.slice();
        let node_pkg_ids = nodes.items().pkg_id;
        let node_dep_ids = nodes.items().dep_id;

        let pkgs = lockfile.packages.slice();
        let pkg_name_hashes = pkgs.items().name_hash;
        let pkg_metas = pkgs.items().meta;
        let pkg_resolutions_lists = pkgs.items().resolutions;
        let pkg_resolutions_buffer = lockfile.buffers.resolutions.as_slice();
        let pkg_bins = pkgs.items().bin;

        let link_target_buf = paths::path_buffer_pool().get();
        let link_dest_buf = paths::path_buffer_pool().get();
        let link_rel_buf = paths::path_buffer_pool().get();

        let mut seen: StringHashMap<()> = StringHashMap::default();

        let mut node_modules_path = AbsPath::<{ paths::opts::DEFAULT }>::init_top_level_dir();
        self.append_real_store_node_modules_path(&mut node_modules_path, parent_entry_id, Which::Staging);

        for dep in entry_deps[parent_entry_id.get()].slice() {
            let node_id = entry_node_ids[dep.entry_id.get()];
            let dep_id = node_dep_ids[node_id.get()];
            let pkg_id = node_pkg_ids[node_id.get()];
            let bin = pkg_bins[pkg_id];
            if bin.tag == Bin::Tag::None {
                continue;
            }
            let alias = lockfile.buffers.dependencies[dep_id].name;

            let mut target_node_modules_path: Option<AbsPath<{ paths::opts::DEFAULT }>> = None;
            let package_name = strings::StringOrTinyString::init(alias.slice(string_buf));

            let mut target_package_name = package_name;

            if let Some(replacement_entry_id) = self.maybe_replace_node_modules_path(
                entry_node_ids,
                node_pkg_ids,
                pkg_name_hashes,
                pkg_resolutions_lists,
                pkg_resolutions_buffer,
                pkg_metas,
                pkg_id,
            ) {
                let mut p = AbsPath::<{ paths::opts::DEFAULT }>::init_top_level_dir();
                self.append_real_store_node_modules_path(&mut p, replacement_entry_id, Which::Final);
                target_node_modules_path = Some(p);

                let replacement_node_id = entry_node_ids[replacement_entry_id.get()];
                let replacement_pkg_id = node_pkg_ids[replacement_node_id.get()];
                let pkg_names = pkgs.items().name;
                target_package_name = strings::StringOrTinyString::init(
                    self.lockfile.str(&pkg_names[replacement_pkg_id]),
                );
            }

            let mut bin_linker = Bin::Linker {
                bin,
                global_bin_path: self.manager.options.bin_path,
                package_name,
                string_buf,
                extern_string_buf,
                seen: &mut seen,
                node_modules_path: &mut node_modules_path,
                target_node_modules_path: target_node_modules_path
                    .as_mut()
                    .map(|p| p as *mut _)
                    .unwrap_or(&mut node_modules_path),
                target_package_name: if target_node_modules_path.is_some() {
                    target_package_name
                } else {
                    package_name
                },
                abs_target_buf: &mut *link_target_buf,
                abs_dest_buf: &mut *link_dest_buf,
                rel_buf: &mut *link_rel_buf,
                ..Default::default()
            };

            bin_linker.link(false);

            if target_node_modules_path.is_some()
                && (bin_linker.skipped_due_to_missing_bin || bin_linker.err.is_some())
            {
                target_node_modules_path = None;

                bin_linker.target_node_modules_path = &mut node_modules_path;
                bin_linker.target_package_name = package_name;

                if self.manager.options.log_level.is_verbose() {
                    Output::pretty_errorln(format_args!(
                        "<d>[Bin Linker]<r> {} -> {} retrying without native bin link",
                        bstr::BStr::new(package_name.slice()),
                        bstr::BStr::new(target_package_name.slice()),
                    ));
                }

                bin_linker.link(false);
            }

            if let Some(err) = bin_linker.err {
                return Err(err);
            }
        }

        Ok(())
    }

    /// True when this entry should live in the shared global virtual store
    /// instead of being materialized under the project's `node_modules/.bun/`.
    /// Root, workspace, folder, symlink, and patched packages always stay
    /// project-local because their contents are mutable / project-specific.
    pub fn entry_uses_global_store(&self, entry_id: Store::Entry::Id) -> bool {
        if self.global_store_path.is_none() {
            return false;
        }
        self.store.entries.items().entry_hash[entry_id.get()] != 0
    }

    /// Absolute path to the global virtual-store directory for `entry_id`:
    ///   <cache>/links/<storepath>-<entry_hash>
    /// (no trailing `/node_modules`). Pass `.staging` to get the per-process
    /// temp sibling that the build steps write into; the final `binaries`
    /// step renames staging → final.
    pub fn append_global_store_entry_path(
        &self,
        buf: &mut impl paths::PathBuf,
        entry_id: Store::Entry::Id,
        which: Which,
    ) {
        debug_assert!(self.entry_uses_global_store(entry_id));
        buf.clear();
        buf.append(self.global_store_path.as_ref().unwrap().as_bytes());
        match which {
            Which::Final => buf.append_fmt(format_args!(
                "{}",
                Store::Entry::fmt_global_store_path(entry_id, self.store, self.lockfile),
            )),
            Which::Staging => buf.append_fmt(format_args!(
                "{}.tmp-{:x}",
                Store::Entry::fmt_global_store_path(entry_id, self.store, self.lockfile),
                self.global_store_tmp_suffix,
            )),
        }
    }

    /// Atomically publish a staged global-store entry by renaming
    /// `<entry>.tmp-<suffix>/` → `<entry>/`. The package tree, dep symlinks,
    /// dependency-bin links and own-bin links were all written under the
    /// staging path; every link inside is relative to the entry directory, so
    /// they resolve identically after the rename. The final directory
    /// existing is the only completeness signal — no separate stamp file.
    pub fn commit_global_store_entry(&self, entry_id: Store::Entry::Id) -> sys::Result<()> {
        if !self.entry_uses_global_store(entry_id) {
            return sys::Result::Ok(());
        }
        let mut staging = AbsPath::<{ paths::sep::AUTO }>::init();
        self.append_global_store_entry_path(&mut staging, entry_id, Which::Staging);
        let mut final_ = AbsPath::<{ paths::sep::AUTO }>::init();
        self.append_global_store_entry_path(&mut final_, entry_id, Which::Final);

        match sys::renameat(Fd::cwd(), staging.slice_z(), Fd::cwd(), final_.slice_z()) {
            sys::Result::Ok(()) => sys::Result::Ok(()),
            sys::Result::Err(err) => {
                if !is_rename_collision(&err) {
                    let _ = Fd::cwd().delete_tree(staging.slice());
                    return sys::Result::Err(err);
                }
                // Under --force, the existing entry may be the corrupt one
                // we were asked to replace. Swap it aside (atomic from a
                // reader's POV: `final` is always either the old or the new
                // tree, never missing), publish staging, then GC the old
                // tree. Without --force, the existing entry came from a
                // concurrent install and is content-identical — keep it and
                // discard ours.
                if self.manager.options.enable.force_install {
                    let mut old = AbsPath::<{ paths::sep::AUTO }>::init();
                    old.append(self.global_store_path.as_ref().unwrap().as_bytes());
                    old.append_fmt(format_args!(
                        "{}.old-{:x}",
                        Store::Entry::fmt_global_store_path(entry_id, self.store, self.lockfile),
                        bun_core::fast_random(),
                    ));
                    if let Some(swap_err) =
                        sys::renameat(Fd::cwd(), final_.slice_z(), Fd::cwd(), old.slice_z()).as_err()
                    {
                        let _ = Fd::cwd().delete_tree(staging.slice());
                        return sys::Result::Err(swap_err);
                    }
                    match sys::renameat(Fd::cwd(), staging.slice_z(), Fd::cwd(), final_.slice_z()) {
                        sys::Result::Ok(()) => {
                            let _ = Fd::cwd().delete_tree(old.slice());
                            return sys::Result::Ok(());
                        }
                        sys::Result::Err(publish_err) => {
                            // Another --force install raced us in the window
                            // between swap-out and publish. Theirs is fresh
                            // too; clean up both temp trees.
                            let _ = Fd::cwd().delete_tree(staging.slice());
                            let _ = Fd::cwd().delete_tree(old.slice());
                            return if is_rename_collision(&publish_err) {
                                sys::Result::Ok(())
                            } else {
                                sys::Result::Err(publish_err)
                            };
                        }
                    }
                }
                let _ = Fd::cwd().delete_tree(staging.slice());
                // A concurrent install renamed first; both writers produced
                // the same content-addressed bytes, so theirs is as good as
                // ours.
                sys::Result::Ok(())
            }
        }
    }

    /// Project-local path `node_modules/.bun/<storepath>` (the symlink that
    /// points at the global virtual-store entry). Relative to top-level dir.
    pub fn append_local_store_entry_path(
        &self,
        buf: &mut impl paths::PathBuf,
        entry_id: Store::Entry::Id,
    ) {
        buf.append_fmt(format_args!(
            concat!("node_modules/", "{}", "/{}"),
            Store::MODULES_DIR_NAME,
            Store::Entry::fmt_store_path(entry_id, self.store, self.lockfile),
        ));
        // TODO(port): Zig used compile-time string concat with Store.modules_dir_name
    }

    /// Create the project-level symlink `node_modules/.bun/<storepath>` →
    /// `<cache>/links/<storepath>-<hash>`. This is the only per-install
    /// filesystem write for a warm global-store hit.
    pub fn link_project_to_global_store(&self, entry_id: Store::Entry::Id) -> sys::Result<()> {
        let mut dest = Path::<{ paths::sep::AUTO }>::init_top_level_dir();
        self.append_local_store_entry_path(&mut dest, entry_id);

        let mut target_abs = AbsPath::<{ paths::sep::AUTO }>::init();
        self.append_global_store_entry_path(&mut target_abs, entry_id, Which::Final);

        // Absolute target so the link is independent of where node_modules
        // lives (project root may itself be behind a symlink). Symlinker's
        // `target` field is RelPath-typed for the common in-tree case, so
        // call sys.symlink/symlinkOrJunction directly here.
        fn do_symlink(d: &ZStr, t: &ZStr) -> sys::Result<()> {
            #[cfg(windows)]
            {
                return sys::symlink_or_junction(d, t, t);
            }
            #[cfg(not(windows))]
            {
                sys::symlink(t, d)
            }
        }

        match do_symlink(dest.slice_z(), target_abs.slice_z()) {
            sys::Result::Ok(()) => return sys::Result::Ok(()),
            sys::Result::Err(err) => match err.get_errno() {
                sys::Errno::NOENT => {
                    if let Some(parent) = dest.dirname() {
                        let _ = Fd::cwd().make_path::<u8>(parent);
                    }
                }
                sys::Errno::EXIST => {
                    // Existing entry from a previous install. If it's a
                    // symlink, replace it (stale link from a different
                    // hash). If it's a real directory, that's the
                    // pre-global-store layout (`bun patch` detaches
                    // `node_modules/<pkg>`, not this path).
                    let is_symlink: bool = {
                        #[cfg(windows)]
                        {
                            if let Some(a) = sys::get_file_attributes(dest.slice_z()) {
                                a.is_reparse_point
                            } else {
                                true
                            }
                        }
                        #[cfg(not(windows))]
                        {
                            if let Some(st) = sys::lstat(dest.slice_z()).as_value() {
                                sys::posix::s_islnk(u32::try_from(st.mode).unwrap())
                            } else {
                                true
                            }
                        }
                    };

                    if is_symlink {
                        #[cfg(windows)]
                        {
                            if sys::rmdir(dest.slice_z()).as_err().is_some() {
                                let _ = sys::unlink(dest.slice_z());
                            }
                        }
                        #[cfg(not(windows))]
                        {
                            let _ = sys::unlink(dest.slice_z());
                        }
                    } else {
                        let _ = Fd::cwd().delete_tree(dest.slice());
                    }
                }
                _ => return sys::Result::Err(err),
            },
        }
        do_symlink(dest.slice_z(), target_abs.slice_z())
    }

    pub fn append_store_node_modules_path(
        &self,
        buf: &mut impl paths::PathBuf,
        entry_id: Store::Entry::Id,
    ) {
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();

        let entries = self.store.entries.slice();
        let entry_node_ids = entries.items().node_id;

        let nodes = self.store.nodes.slice();
        let node_pkg_ids = nodes.items().pkg_id;

        let pkgs = self.lockfile.packages.slice();
        let pkg_resolutions = pkgs.items().resolution;

        let node_id = entry_node_ids[entry_id.get()];
        let pkg_id = node_pkg_ids[node_id.get()];
        let pkg_res = pkg_resolutions[pkg_id];

        match pkg_res.tag {
            Resolution::Tag::Root => {
                buf.append(b"node_modules");
            }
            Resolution::Tag::Workspace => {
                buf.append(pkg_res.value.workspace.slice(string_buf));
                buf.append(b"node_modules");
            }
            _ => {
                buf.append_fmt(format_args!(
                    "node_modules/{}/{}/node_modules",
                    Store::MODULES_DIR_NAME,
                    Store::Entry::fmt_store_path(entry_id, self.store, self.lockfile),
                ));
                // TODO(port): Zig used compile-time concat with Store.modules_dir_name
            }
        }
    }

    /// Like `appendStoreNodeModulesPath`, but resolves to the *physical*
    /// location of the entry's `node_modules` directory: the global virtual
    /// store for global-eligible entries, or the project-local `.bun/` path
    /// otherwise. See `Which` for when to pass `.staging` vs `.final`.
    pub fn append_real_store_node_modules_path(
        &self,
        buf: &mut impl paths::PathBuf,
        entry_id: Store::Entry::Id,
        which: Which,
    ) {
        if self.entry_uses_global_store(entry_id) {
            self.append_global_store_entry_path(buf, entry_id, which);
            buf.append(b"node_modules");
            return;
        }
        self.append_store_node_modules_path(buf, entry_id);
    }

    /// `appendStorePath` resolved to the entry's *physical* location. See
    /// `Which` for when to pass `.staging` vs `.final`.
    pub fn append_real_store_path(
        &self,
        buf: &mut impl paths::PathBuf,
        entry_id: Store::Entry::Id,
        which: Which,
    ) {
        if self.entry_uses_global_store(entry_id) {
            let string_buf = self.lockfile.buffers.string_bytes.as_slice();
            let node_id = self.store.entries.items().node_id[entry_id.get()];
            let pkg_id = self.store.nodes.items().pkg_id[node_id.get()];
            let pkg_name = self.lockfile.packages.items().name[pkg_id];
            self.append_global_store_entry_path(buf, entry_id, which);
            buf.append(b"node_modules");
            buf.append(pkg_name.slice(string_buf));
            return;
        }
        self.append_store_path(buf, entry_id);
    }

    pub fn append_store_path(&self, buf: &mut impl paths::PathBuf, entry_id: Store::Entry::Id) {
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();

        let entries = self.store.entries.slice();
        let entry_node_ids = entries.items().node_id;

        let nodes = self.store.nodes.slice();
        let node_pkg_ids = nodes.items().pkg_id;
        let node_dep_ids = nodes.items().dep_id;
        // let node_peers = nodes.items().peers;

        let pkgs = self.lockfile.packages.slice();
        let pkg_names = pkgs.items().name;
        let pkg_resolutions = pkgs.items().resolution;

        let node_id = entry_node_ids[entry_id.get()];
        // let peers = node_peers[node_id.get()];
        let pkg_id = node_pkg_ids[node_id.get()];
        let dep_id = node_dep_ids[node_id.get()];
        let pkg_res = pkg_resolutions[pkg_id];

        match pkg_res.tag {
            Resolution::Tag::Root => {
                if dep_id != invalid_dependency_id {
                    let pkg_name = pkg_names[pkg_id];
                    buf.append(
                        const_format::concatcp!("node_modules/", Store::MODULES_DIR_NAME).as_bytes(),
                    );
                    buf.append_fmt(format_args!(
                        "{}",
                        Store::Entry::fmt_store_path(entry_id, self.store, self.lockfile),
                    ));
                    buf.append(b"node_modules");
                    if pkg_name.is_empty() {
                        buf.append(paths::basename(
                            bun_fs::FileSystem::instance().top_level_dir,
                        ));
                    } else {
                        buf.append(pkg_name.slice(string_buf));
                    }
                } else {
                    // append nothing. buf is already top_level_dir
                }
            }
            Resolution::Tag::Workspace => {
                buf.append(pkg_res.value.workspace.slice(string_buf));
            }
            Resolution::Tag::Symlink => {
                let symlink_dir_path = self.manager.global_link_dir_path();

                buf.clear();
                buf.append(symlink_dir_path);
                buf.append(pkg_res.value.symlink.slice(string_buf));
            }
            _ => {
                let pkg_name = pkg_names[pkg_id];
                buf.append(
                    const_format::concatcp!("node_modules/", Store::MODULES_DIR_NAME).as_bytes(),
                );
                buf.append_fmt(format_args!(
                    "{}",
                    Store::Entry::fmt_store_path(entry_id, self.store, self.lockfile),
                ));
                buf.append(b"node_modules");
                buf.append(pkg_name.slice(string_buf));
            }
        }
    }

    /// The directory name for the entry store node_modules install
    /// folder.
    /// ./node_modules/.bun/jquery@3.7.1/node_modules/jquery
    ///                                               ^ this one
    /// Need to know this to avoid collisions with dependencies
    /// with the same name as the package.
    pub fn entry_store_node_modules_package_name(
        &self,
        dep_id: DependencyID,
        pkg_id: PackageID,
        pkg_res: &Resolution,
        pkg_names: &[SemverString],
    ) -> Option<&[u8]> {
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();

        match pkg_res.tag {
            Resolution::Tag::Root => {
                if dep_id != invalid_dependency_id {
                    let pkg_name = pkg_names[pkg_id];
                    if pkg_name.is_empty() {
                        return Some(paths::basename(
                            bun_fs::FileSystem::instance().top_level_dir,
                        ));
                    }
                    return Some(pkg_name.slice(string_buf));
                }
                None
            }
            Resolution::Tag::Workspace => None,
            Resolution::Tag::Symlink => None,
            _ => Some(pkg_names[pkg_id].slice(string_buf)),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Which {
    /// The published location (`<cache>/links/<entry>`). Use for symlink
    /// *targets* that point at other entries, and for the warm-hit check.
    Final,
    /// The per-process temp sibling (`<entry>.tmp-<suffix>`) the build
    /// steps write into. Use for *destinations* of clonefile/hardlink/
    /// dep-symlink/bin-link when building this entry.
    Staging,
}

fn is_rename_collision(err: &sys::Error) -> bool {
    match err.get_errno() {
        sys::Errno::EXIST | sys::Errno::NOTEMPTY => true,
        // Windows maps a rename onto an in-use directory to
        // ERROR_ACCESS_DENIED; on POSIX PERM/ACCES are real
        // permission failures and must propagate.
        sys::Errno::PERM | sys::Errno::ACCES => cfg!(windows),
        _ => false,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/isolated_install/Installer.zig (2045 lines)
//   confidence: medium
//   todos:      10
//   notes:      run() labeled-switch state machine reshaped to loop+match; heavy borrowck reshaping needed for installer/manager/lockfile aliasing in Task::run; bun.Path/AbsPath const-generic option syntax is placeholder; MultiArrayList .items(.field) → .items().field accessor assumed; Result/Yield::RunScripts kept raw ptr pending &'a mut reshape
// ──────────────────────────────────────────────────────────────────────────
