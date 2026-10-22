use core::sync::atomic::{AtomicU8, Ordering};
use std::collections::VecDeque;
use std::io::Write as _;

use bun_ast::Log;
use bun_collections::{ArrayHashMap, DynamicBitSet, StringHashMap};
use bun_core::fmt::EscapeControlChars;
use bun_core::{Environment, Global, Output};
use bun_core::{ZStr, strings};
use bun_paths::{self as paths, AbsPath, AutoAbsPath, AutoRelPath};
use bun_sys::{self as sys, Fd};
use bun_threading::{UnboundedQueue, WaitGroup, thread_pool};

use bun_sys::{FdDirExt as _, FdExt as _};

use crate::bin_real;
use crate::cache_publish::{RenameError, RenameRetry};
use crate::lockfile::package;
use crate::package_install::{
    BUN_TAG, Method as InstallMethod, Staging, StagingLock, StagingPath, Summary as InstallSummary,
    rename_staging_into_place,
};
use crate::package_manager_real::Command;
use crate::postinstall_optimizer;
use crate::postinstall_optimizer::PostinstallOptimizer;
use crate::prune::LinkedNodeModules;
use crate::resolution;
use crate::{
    self as install, Lockfile, PackageID, PackageManager, Resolution, TaskCallbackContext,
    TruncatedPackageNameHash, bin, invalid_dependency_id,
};
// Bring `items_<field>()` column accessors into scope for
// `MultiArrayList<Package>` / `Slice<Package>`.
#[cfg(target_os = "macos")]
use super::file_cloner::FileCloner;
use super::file_copier::FileCopier;
use super::hardlinker::Hardlinker;
use super::store::{self, Store};
use super::store::{EntryColumns as _, NodeColumns as _};
use super::symlinker::{self, Symlinker};
use crate::bun_fs;
use crate::lockfile_real::package::PackageColumns as _;
use crate::package_manager_real::directories;
use crate::package_manager_real::package_manager_options::{Do, Enable};

/// The enum lives at module level in `crate::resolution`.
type ResolutionTag = resolution::Tag;

type Bitset = DynamicBitSet;
type ProgressNode = crate::bun_progress::Node;

// ── Store id aliases ───────────────────────────────────────────────────────
type StoreEntryId = store::entry::Id;

// ── Path option presets ───────────────────────────────────────────────────
use paths::path_options::{AssumeOk as _, Kind as PathKind, PathSeparators};
type AutoPath = paths::Path<u8, { PathKind::ANY }, { PathSeparators::AUTO }>;
type OsAutoAbsPath = AbsPath<paths::OSPathChar, { PathSeparators::AUTO }>;
type OsAutoPath = paths::Path<paths::OSPathChar, { PathKind::ANY }, { PathSeparators::AUTO }>;
type DefaultAbsPath = AbsPath<u8>;

/// What the `append_*_path` helpers need from a `Path` of any unit, kind and separators.
pub(crate) trait PathLike {
    fn clear(&mut self);
    fn append(&mut self, bytes: &[u8]) -> sys::Result<()>;
    fn append_fmt(&mut self, args: core::fmt::Arguments<'_>) -> sys::Result<()>;
}
impl<U: paths::PathUnit, const KIND: u8, const SEP: u8> PathLike for paths::Path<U, KIND, SEP> {
    fn clear(&mut self) {
        paths::Path::clear(self);
    }
    fn append(&mut self, bytes: &[u8]) -> sys::Result<()> {
        self.try_append(bytes).map_err(name_too_long)
    }
    fn append_fmt(&mut self, args: core::fmt::Arguments<'_>) -> sys::Result<()> {
        self.try_append_fmt(args).map_err(name_too_long)
    }
}

fn name_too_long(_: paths::path_options::Error) -> sys::Error {
    sys::Error::from_code(sys::E::ENAMETOOLONG, sys::Tag::symlink)
}

pub struct Installer<'a> {
    /// BACKREF, as `manager`.
    pub lockfile: *mut Lockfile,

    pub(crate) summary: InstallSummary,
    pub(crate) installed: Bitset,
    pub(crate) install_node: Option<&'a mut ProgressNode>,
    pub(crate) is_new_bun_modules: bool,
    /// Set when the project's root `node_modules` is a symlink.
    pub(crate) linked: Option<LinkedNodeModules>,
    /// Taken by the first task that links a project-local package.
    pub(crate) staging_lock: std::sync::OnceLock<StagingLock>,

    /// BACKREF, never null; not `&'a mut`: the tasks on the thread pool all read through it.
    pub(crate) manager: *mut PackageManager,
    pub(crate) command_ctx: Command::Context<'a>,

    pub(crate) store: &'a Store,

    pub(crate) task_queue: UnboundedQueue<Task>, // intrusive via .next
    pub(crate) tasks: Box<[Task]>,
    /// Counts the tasks on the thread pool. `start_task` adds one, and `Task::task` removes itself
    /// when it's done.
    pub(crate) tasks_in_flight: &'a WaitGroup,

    /// An `InstallMethod`.
    pub(crate) supported_backend: AtomicU8,

    /// Built before tasks spawn and only read concurrently afterwards.
    pub(crate) trusted_dependencies_from_update_requests: ArrayHashMap<PackageID, ()>,

    /// `<cache_dir>/links`: the global virtual store; `node_modules/.bun/<storepath>` links to it.
    pub(crate) global_store_path: Option<&'a ZStr>,

    /// An entry is built in `<cache>/links/<storepath>-<hash>.tmp-<this>/`, renamed when complete.
    pub(crate) global_store_tmp_suffix: u64,

    /// Main-thread only: `waiters_head[dep]` starts the intrusive list of blocked entries waiting on `dep`, linked through `next_waiter`.
    pub(crate) waiters_head: Box<[StoreEntryId]>,
    pub(crate) next_waiter: Box<[StoreEntryId]>,

    /// Main-thread only: see `release_members`.
    pub(crate) held_members: Option<Vec<StoreEntryId>>,

    /// Main-thread only: see `leave_out_entry`.
    pub(crate) left_out_entries: Vec<StoreEntryId>,

    /// Main-thread only: entries that returned `Result::RunScripts`, in that order.
    pub(crate) pending_lifecycle_scripts: VecDeque<StoreEntryId>,
}

/// A task on the pool reads `self` and the store through `Task::installer`.
impl Drop for Installer<'_> {
    fn drop(&mut self) {
        self.tasks_in_flight.wait();
    }
}

impl<'a> Installer<'a> {
    // BACKREF accessors — `manager` points outside `Self`; see field doc.
    #[inline]
    pub(crate) fn manager(&self) -> &'a PackageManager {
        // SAFETY: BACKREF — never null; pointee outlives `'a`.
        unsafe { &*self.manager }
    }
    #[inline]
    pub(crate) fn manager_mut(&self) -> &'a mut PackageManager {
        // SAFETY: BACKREF — never null; disjoint from `*self`. Return is `'a`
        // (not elided) so `start_task` can hold it across `&mut self.tasks[i]`
        // — same field-disjoint shape the prior `&'a mut` field permitted.
        // Caller must be on the main thread (only main mutates
        // `PackageManager`; `Task::run` / `Task::callback` on the pool read
        // via the raw field, never this accessor).
        unsafe { &mut *self.manager }
    }
    #[inline]
    pub fn lockfile(&self) -> &'a Lockfile {
        // SAFETY: BACKREF — never null; pointee outlives `'a`. Never aliased by
        // a *whole-struct* `&mut Lockfile` while a task runs.
        unsafe { &*self.lockfile }
    }

    fn resolution(&self, entry_id: StoreEntryId) -> &'a Resolution {
        &self.lockfile().packages.items_resolution()[self.store.ids(entry_id).pkg_id as usize]
    }

    fn pkg_name(&self, entry_id: StoreEntryId) -> &'a [u8] {
        let pkg_id = self.store.ids(entry_id).pkg_id;
        self.lockfile()
            .str(&self.lockfile().packages.items_name()[pkg_id as usize])
    }

    /// Only called on the main thread while the entry's task isn't running, so relaxed ordering is
    /// enough.
    pub(crate) fn set_step(&self, entry_id: StoreEntryId, step: Step) {
        self.store.entries.items_step()[entry_id.get() as usize]
            .store(step as u32, Ordering::Relaxed);
    }

    /// Called from main thread
    pub(crate) fn start_task(&mut self, entry_id: StoreEntryId) {
        let manager = self.manager_mut();
        let task = &mut self.tasks[entry_id.get() as usize];
        debug_assert!(matches!(
            task.result,
            // first time starting the task
            Result::None
            // the task returned to the main thread because it was blocked
            | Result::Blocked
            // the task returned to the main thread to spawn some scripts
            | Result::RunScripts
        ));

        task.result = Result::None;
        self.tasks_in_flight.add_one();
        manager
            .thread_pool
            .schedule(thread_pool::Batch::from(&raw mut task.task.task));
    }

    /// Called from main thread, for an existing project-local store entry.
    pub(crate) fn start_relink_task(&mut self, entry_id: StoreEntryId) {
        let newly_trusted = self.is_newly_trusted(entry_id);
        let task = &mut self.tasks[entry_id.get() as usize];
        task.relink = Relink::Pending;
        task.newly_trusted = newly_trusted;
        self.set_step(entry_id, Step::SymlinkDependencies);
        self.start_task(entry_id);
    }

    /// Like the hoisted linker, runs a `link:` dependency's scripts if no dependent links to
    /// `target` yet. Call this before the dependents' tasks start, because they create those links.
    pub(crate) fn start_link_task(&mut self, entry_id: StoreEntryId, target: &ZStr) {
        let linked = !self.manager().options.enable.force_install()
            && self.has_link_from_dependent(entry_id, target);
        if linked && !self.is_newly_trusted(entry_id) {
            self.set_step(entry_id, Step::Done);
            self.on_task_complete(entry_id, CompleteState::Skipped);
            return;
        }
        if linked {
            self.tasks[entry_id.get() as usize].relink = Relink::Unchanged;
        }
        self.set_step(entry_id, Step::RunPreinstall);
        self.start_task(entry_id);
    }

    fn has_link_from_dependent(&self, entry_id: StoreEntryId, target: &ZStr) -> bool {
        let Ok(target) = sys::stat(target) else {
            return false;
        };
        let lockfile = self.lockfile();
        let entry_dependencies = self.store.entries.items_dependencies();
        let dependents = &self.store.entries.items_parents()[entry_id.get() as usize];
        dependents.iter().any(|&dependent| {
            (entry_dependencies[dependent.get() as usize].slice().iter())
                .filter(|dep| dep.entry_id == entry_id)
                .any(|dep| {
                    let mut link = AutoPath::init_top_level_dir();
                    self.append_store_node_modules_path(&mut link, dependent)
                        .and_then(|()| {
                            append_dependency_link_name(
                                &mut link,
                                lockfile
                                    .str(&lockfile.buffers.dependencies[dep.dep_id as usize].name),
                                self.entry_store_node_modules_package_name(dependent),
                            )
                        })
                        .and_then(|()| sys::stat(link.slice_z()))
                        .is_ok_and(|st| st.st_ino == target.st_ino && st.st_dev == target.st_dev)
                })
        })
    }

    /// Returns true if an earlier install blocked the entry's scripts and the package may be
    /// trusted now. `Step::RunPreinstall` checks the trust and runs them.
    fn is_newly_trusted(&self, entry_id: StoreEntryId) -> bool {
        let store::Ids { dep_id, pkg_id } = self.store.ids(entry_id);
        if self
            .trusted_dependencies_from_update_requests
            .contains(&pkg_id)
        {
            return true;
        }

        let added = &self.manager().summary.added_trusted_dependencies;
        if added.count() == 0 || dep_id == invalid_dependency_id {
            return false;
        }
        let lockfile = self.lockfile();
        let dep = &lockfile.buffers.dependencies[dep_id as usize];
        let pkgs = lockfile.packages.slice();
        let (name, name_hash) = pkgs.items_resolution()[pkg_id as usize].trusted_name(
            (dep.name, dep.name_hash),
            (
                pkgs.items_name()[pkg_id as usize],
                pkgs.items_name_hash()[pkg_id as usize],
            ),
        );
        added
            .get(&(name_hash as TruncatedPackageNameHash))
            .is_some_and(|added| **added == *name.slice(lockfile.buffers.string_bytes.as_slice()))
    }

    pub(crate) fn on_package_extracted(
        &mut self,
        task_id: crate::package_manager_task::Id,
        data: &install::ExtractData,
    ) {
        let Some(removed) = self.manager_mut().task_queue.remove(&task_id) else {
            return;
        };
        for install_ctx in removed.as_slice() {
            let &TaskCallbackContext::IsolatedPackageInstallContext(entry_id) = install_ctx else {
                continue;
            };

            let pkg_id = self.store.ids(entry_id).pkg_id;
            if data.integrity.tag.is_supported() {
                self.record_extracted_integrity(pkg_id, &data.integrity);
            }

            let patched = self
                .package_patch_info(pkg_id)
                .and_then(|patch_info| self.apply_package_patch(entry_id, &patch_info));
            match patched {
                Ok(()) => self.start_task(entry_id),
                Err(err) => self.on_task_fail(entry_id, &err),
            }
        }
    }

    /// Called on the main thread before the package's tasks start, because they use the integrity
    /// to name a tarball's cache entry.
    fn record_extracted_integrity(&mut self, pkg_id: PackageID, integrity: &install::Integrity) {
        let pkgs = self.lockfile().packages.slice();
        assert!((pkg_id as usize) < pkgs.len());
        // SAFETY: in bounds; raw column pointer, so no `&mut Lockfile` is formed. Only this
        // package's tasks read its `integrity` and none has started; other tasks' `&[Meta]`
        // borrows never touch these bytes.
        let recorded = unsafe {
            core::ptr::addr_of_mut!(
                (*pkgs
                    .items_raw::<"meta", package::Meta>()
                    .add(pkg_id as usize))
                .integrity
            )
        };
        // SAFETY: see above.
        if unsafe { (*recorded).tag.is_supported() } {
            return;
        }
        // SAFETY: see above.
        unsafe { recorded.write(*integrity) };
        self.manager_mut()
            .options
            .enable
            .set(Enable::FORCE_SAVE_LOCKFILE, true);
    }

    /// Called from main thread when a tarball download or extraction fails.
    /// Without this, the upfront pending-task slot for each waiting entry is
    /// never released and the install loop blocks forever on
    /// `pendingTaskCount() == 0`.
    pub(crate) fn on_package_download_error(
        &mut self,
        task_id: crate::package_manager_task::Id,
        name: &[u8],
        resolution: &Resolution,
        err: crate::Error,
        url: &[u8],
    ) {
        let Some(callbacks) = self.manager_mut().task_queue.remove(&task_id) else {
            // No waiting entry — still surface the error so it isn't lost.
            let string_buf = self.lockfile().buffers.string_bytes.as_slice();
            Output::err_generic(
                "failed to download <b>{}@{}<r>: {}\n  <d>{}<r>",
                (
                    bun_core::fmt::escape_control_chars(name),
                    bun_core::fmt::for_terminal(
                        resolution.fmt(string_buf, bun_core::fmt::PathSep::Auto),
                    ),
                    bstr::BStr::new(download_error_reason(err)),
                    EscapeControlChars(bun_core::fmt::redacted_npm_url(url)),
                ),
            );
            Output::flush();
            return;
        };
        for install_ctx in callbacks.as_slice() {
            if let &TaskCallbackContext::IsolatedPackageInstallContext(entry_id) = install_ctx {
                let url = url.into();
                self.on_task_fail(entry_id, &TaskError::Download { err, url });
            }
        }
    }

    pub(crate) fn on_optional_package_download_error(
        &mut self,
        task_id: crate::package_manager_task::Id,
    ) {
        let Some(callbacks) = self.manager_mut().task_queue.remove(&task_id) else {
            return;
        };
        for install_ctx in callbacks.as_slice() {
            if let &TaskCallbackContext::IsolatedPackageInstallContext(entry_id) = install_ctx {
                self.leave_out_entry(entry_id);
            }
        }
    }

    /// Main thread. Reported by whoever saw the download fail, or by `report_offline_misses`.
    pub(crate) fn on_download_not_queued(&mut self, entry_id: StoreEntryId) {
        let store::Ids { dep_id, pkg_id } = self.store.ids(entry_id);
        let offline = self.manager().options.offline
            == crate::package_manager_real::options::OfflineMode::Offline;
        if offline {
            self.summary.offline_misses.push(pkg_id);
        }
        if !self.manager().is_package_required(dep_id, pkg_id) {
            self.leave_out_entry(entry_id);
            return;
        }
        self.set_step(entry_id, Step::Done);
        self.on_task_complete(
            entry_id,
            if offline {
                CompleteState::Skipped
            } else {
                CompleteState::Fail
            },
        );
    }

    pub(crate) fn apply_package_patch(
        &mut self,
        entry_id: StoreEntryId,
        patch_info: &PatchInfo,
    ) -> TaskResult<()> {
        let PatchInfo::Patch(patch) = patch_info else {
            return Ok(());
        };
        let mut patch_task = install::PatchTask::new_apply_patch_hash(
            self.manager_mut(),
            self.store.ids(entry_id).pkg_id,
            patch.contents_hash,
            patch.name_and_version_hash,
        );
        // Every peer variant shares one patched cache dir (named by the patch
        // contents hash, not the peer set). Once it exists, reuse it: rebuilding
        // it replaces the directory under earlier entries' running hardlink tasks.
        if let crate::patch_install::Callback::Apply(apply) = &patch_task.callback {
            if sys::directory_exists_at(apply.cache_dir, apply.cache_dir_subpath.as_zstr())
                .unwrap_or(false)
            {
                return Ok(());
            }
        }
        bun_core::handle_oom(patch_task.apply());

        if let crate::patch_install::Callback::Apply(apply) = &mut patch_task.callback {
            if apply.logger.has_errors() {
                let mut log = Log::init();
                apply.logger.clone_to_with_recycled(&mut log, true);
                return Err(TaskError::Patching(log));
            }
            let _ = apply
                .logger
                .print(std::ptr::from_mut(Output::error_writer()));
        }
        Ok(())
    }

    /// Called from main thread
    pub(crate) fn on_task_fail(&mut self, entry_id: StoreEntryId, err: &TaskError) {
        self.set_step(entry_id, Step::Done);

        let string_buf = self.lockfile().buffers.string_bytes.as_slice();
        let pkg_res = self.resolution(entry_id);
        let pkg_name = bun_core::fmt::escape_control_chars(self.pkg_name(entry_id));
        let pkg_res_fmt =
            bun_core::fmt::for_terminal(pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Auto));
        let pkg = (&pkg_name, &pkg_res_fmt);

        match err {
            TaskError::LinkPackage(err) => {
                Output::err(err.clone(), "failed to link package: {}@{}", pkg);
            }
            TaskError::SymlinkDependencies(err) => {
                Output::err(
                    err.clone(),
                    "failed to symlink dependencies for package: {}@{}",
                    pkg,
                );
            }
            TaskError::Patching(patch_log) => {
                Output::err_generic("failed to patch package: {}@{}", pkg);
                let _ = patch_log.print(std::ptr::from_mut(Output::error_writer()));
            }
            TaskError::Binaries(err) => {
                Output::err(*err, "failed to link binaries for package: {}@{}", pkg);
            }
            TaskError::DependencyBinaries(dep_errs) => {
                for &(dep_entry_id, dep_err) in dep_errs.iter() {
                    Output::err(
                        dep_err,
                        "failed to link binaries of dependency {}@{} for package: {}@{}",
                        (
                            bstr::BStr::new(self.pkg_name(dep_entry_id)),
                            bun_core::fmt::for_terminal(
                                self.resolution(dep_entry_id)
                                    .fmt(string_buf, bun_core::fmt::PathSep::Auto),
                            ),
                            &pkg_name,
                            &pkg_res_fmt,
                        ),
                    );
                }
            }
            TaskError::Download { err, url } => {
                Output::err_generic(
                    "failed to download <b>{}@{}<r>: {}\n  <d>{}<r>",
                    (
                        &pkg_name,
                        &pkg_res_fmt,
                        bstr::BStr::new(download_error_reason(*err)),
                        EscapeControlChars(bun_core::fmt::redacted_npm_url(url)),
                    ),
                );
            }
            TaskError::RunScripts(err) => {
                Output::err(
                    *err,
                    "failed to run lifecycle scripts for package: {}@{}",
                    pkg,
                );
                // The package is at its final path, so the next install would treat it as
                // installed.
                self.delete_store_copy(entry_id);
            }
        }
        Output::flush();

        // Clean up the staging directory so a half-built global-store entry
        // doesn't leak in the cache (it would never be reused — the suffix is
        // random — but it's wasted disk).
        if self.entry_uses_global_store(entry_id) {
            let mut staging = AutoAbsPath::init();
            let _ = self
                .append_global_store_entry_path(&mut staging, entry_id, Which::Staging)
                .and_then(|()| Fd::cwd().delete_tree(staging.slice()));
        } else if let Some(lock) = self.staging_lock.get()
            && pkg_res.can_enqueue_install_task()
        {
            // A staged link that failed only wrote to the staging directory.
            let mut staging = AutoPath::init();
            let _ = self
                .append_local_staging_path(&mut staging, entry_id, lock.mode)
                .and_then(|()| Fd::cwd().delete_tree(staging.slice()));
        }

        // Like the hoisted linker, exit without saving the lockfile when a patch does not apply.
        if self.manager().options.enable.fail_early() || matches!(err, TaskError::Patching(_)) {
            Global::exit(1);
        }

        // Remove the symlinks to this `link:` dependency. Otherwise `start_link_task` in the next
        // install would consider it already linked and never run its scripts.
        if pkg_res.tag == ResolutionTag::Symlink && self.is_trusted(entry_id) {
            self.left_out_entries.push(entry_id);
        }

        self.summary.fail += 1;

        self.manager_mut().decrement_pending_tasks();
        self.resume_unblocked_tasks(entry_id);
    }

    /// Called from main thread
    pub(crate) fn on_task_blocked(&mut self, entry_id: StoreEntryId) {
        // race condition (fixed now): task decides it is blocked because one of its dependencies
        // has not finished. before the task can mark itself as blocked, the dependency finishes its
        // install, causing the task to never finish because resumeUnblockedTasks is called before
        // its state is set to blocked.
        //
        // fix: check if the task is unblocked after the task returns blocked, and only set/unset
        // blocked from the main thread.

        if self.is_member(entry_id)
            && let Some(held) = self.held_members.as_mut()
        {
            held.push(entry_id);
            self.set_step(entry_id, Step::Blocked);
            return;
        }

        match self.is_task_blocked(entry_id, &mut ArrayHashMap::default()) {
            None => {
                self.set_step(entry_id, Step::SymlinkDependencyBinaries);
                self.start_task(entry_id);
            }
            Some(blocked_on) => {
                self.set_step(entry_id, Step::Blocked);
                self.push_waiter(blocked_on, entry_id);
            }
        }
    }

    /// Called on the main thread. Resumes the workspaces once they're the only tasks left, so that
    /// their scripts see the finished install.
    pub(crate) fn release_members(&mut self) {
        let pending = self.manager().pending_task_count() as usize;
        if self
            .held_members
            .as_ref()
            .is_some_and(|held| !held.is_empty() && held.len() == pending)
        {
            for entry_id in self.held_members.take().unwrap_or_default() {
                self.on_task_blocked(entry_id);
            }
        }
    }

    fn is_member(&self, entry_id: StoreEntryId) -> bool {
        self.resolution(entry_id).tag == ResolutionTag::Workspace
    }

    /// Main thread, once every task is done. A member's scripts can write the files of its bins.
    pub(crate) fn relink_bins_of_members_with_scripts(&mut self) {
        let store = self.store;
        let pkg_bins = self.lockfile().packages.items_bin();

        let mut members: Vec<PackageID> = Vec::new();
        for (index, scripts) in store.entries.items_scripts().iter().enumerate() {
            let entry_id = StoreEntryId::from(index as u32);
            if scripts.get().is_some()
                && self.is_member(entry_id)
                && pkg_bins[store.ids(entry_id).pkg_id as usize].tag != bin::Tag::None
                && !self.left_out_entries.contains(&entry_id)
            {
                members.push(store.ids(entry_id).pkg_id);
            }
        }
        if members.is_empty() {
            return;
        }

        // Compare by package, because a `workspace:` dependency on a workspace can have its own
        // entry.
        let dependents: Vec<StoreEntryId> = (store.entries.items_dependencies().iter().enumerate())
            .filter(|(_, deps)| {
                (deps.slice().iter()).any(|dep| members.contains(&store.ids(dep.entry_id).pkg_id))
            })
            .map(|(index, _)| StoreEntryId::from(index as u32))
            .collect();
        for dependent in dependents {
            // It depends on a workspace, so its `Which::Staging` is where it is.
            debug_assert!(!self.entry_uses_global_store(dependent));
            if let Err(err) = self.link_dependency_bins(dependent) {
                self.manager_mut().increment_pending_tasks(1);
                self.on_task_fail(dependent, &err);
            }
        }
    }

    /// Main thread only.
    fn push_waiter(&mut self, dep: StoreEntryId, waiter: StoreEntryId) {
        let head = &mut self.waiters_head[dep.get() as usize];
        self.next_waiter[waiter.get() as usize] = *head;
        *head = waiter;
    }

    /// Returns the first unfinished non-cyclic dependency; runs on main and task threads, so `parent_dedupe` must not be shared.
    fn is_task_blocked(
        &self,
        entry_id: StoreEntryId,
        parent_dedupe: &mut ArrayHashMap<StoreEntryId, ()>,
    ) -> Option<StoreEntryId> {
        let entries = &self.store.entries;
        let entry_deps = entries.items_dependencies();
        let entry_steps = entries.items_step();

        let deps = &entry_deps[entry_id.get() as usize];
        for dep in deps.slice() {
            if entry_steps[dep.entry_id.get() as usize].load(Ordering::Acquire) != Step::Done as u32
            {
                // See `release_members`.
                if self.is_member(dep.entry_id) && !self.is_member(entry_id) {
                    continue;
                }
                parent_dedupe.clear_retaining_capacity();
                if self.store.is_cycle(entry_id, dep.entry_id, parent_dedupe) {
                    continue;
                }
                return Some(dep.entry_id);
            }
        }
        None
    }

    /// Called from main thread
    pub(crate) fn on_task_complete(&mut self, entry_id: StoreEntryId, state: CompleteState) {
        self.manager_mut().decrement_pending_tasks();
        self.resume_unblocked_tasks(entry_id);

        if let Some(node) = self.install_node.as_mut() {
            node.complete_one();
        }

        let store::Ids { dep_id, pkg_id } = self.store.ids(entry_id);
        let dependencies = self.lockfile().buffers.dependencies.as_slice();
        let relink = self.tasks[entry_id.get() as usize].relink;

        let state = if matches!(relink, Relink::Unchanged | Relink::ChangedOptional)
            || dep_id == invalid_dependency_id
            || dependencies[dep_id as usize].behavior.is_workspace()
            || self.is_member(entry_id)
        {
            CompleteState::Skipped
        } else {
            state
        };
        match state {
            CompleteState::Success => {}
            CompleteState::Skipped => {
                self.summary.skipped += 1;
                return;
            }
            CompleteState::Fail => {
                self.summary.fail += 1;
                return;
            }
        }

        let is_duplicate = self.installed.is_set(pkg_id as usize);
        self.summary.success += (!is_duplicate) as u32;
        self.installed.set(pkg_id as usize);

        // Count once per package, like `success`. A package has one store entry per set of peers.
        let blocked_scripts = self.tasks[entry_id.get() as usize].blocked_scripts;
        if blocked_scripts > 0 && !is_duplicate {
            *self
                .summary
                .packages_with_blocked_scripts
                .entry(dependencies[dep_id as usize].name_hash as TruncatedPackageNameHash)
                .or_default() += usize::from(blocked_scripts);
        }
    }

    /// Called from main thread; dependents finish without the entry. Returns `delete_store_copy`.
    pub(crate) fn leave_out_entry(&mut self, entry_id: StoreEntryId) -> bool {
        // Delete it first, so that the dependents that resume don't link its binaries.
        let deleted = self.delete_store_copy(entry_id);
        self.left_out_entries.push(entry_id);
        self.store.entries.items_step()[entry_id.get() as usize]
            .store(Step::Done as u32, Ordering::Release);
        self.on_task_complete(entry_id, CompleteState::Skipped);
        deleted
    }

    /// False without a copy in this project's store: other entries are the user's own folders.
    pub(crate) fn delete_store_copy(&self, entry_id: StoreEntryId) -> bool {
        let tag = self.resolution(entry_id).tag;
        let is_store_copy = !self.entry_uses_global_store(entry_id)
            && (tag.can_enqueue_install_task() || tag == ResolutionTag::Folder);
        if is_store_copy
            && self
                .remove_planted_links_in(entry_id, Self::store_path_len())
                .is_ok()
        {
            if tag == ResolutionTag::Folder {
                // Nothing cleans up a staging path next to a folder, so delete it in place.
                self.delete_local_store_package_in_place(entry_id);
            } else {
                let staging = self.staging_lock.get_or_init(StagingLock::acquire).mode;
                // Don't wait, because a running script keeps its package open on Windows. Whatever
                // the error, nothing is left installed.
                let _ = self.clear_local_store_package(entry_id, staging, false);
            }
        }
        is_store_copy
    }

    /// Deletes the `installed_marker` file first, because `delete_tree` can stop midway.
    fn delete_local_store_package_in_place(&self, entry_id: StoreEntryId) {
        let mut path = AutoAbsPath::init_top_level_dir();
        if self.append_store_path(&mut path, entry_id).is_err() {
            return;
        }
        let package_len = path.len();
        if is_link(path.slice_z()) == Some(false)
            && let Ok(patch_info) = self.package_patch_info(self.store.ids(entry_id).pkg_id)
        {
            let mut hash_buf = install::BuntagHashBuf::default();
            let tag = self.resolution(entry_id).tag;
            if PathLike::append(&mut path, installed_marker(tag, &patch_info, &mut hash_buf))
                .is_ok()
            {
                let _ = sys::unlink(path.slice_z());
            }
            path.set_length(package_len);
        }
        let _ = Fd::cwd().delete_tree(path.slice());
    }

    /// Of `<project>/node_modules/.bun`, which `install_isolated_packages` looked at.
    fn store_path_len() -> usize {
        let mut store = AutoPath::init_top_level_dir();
        let _ = store.try_append(b"node_modules/.bun");
        store.len()
    }

    /// Call before anything in the entry is written or deleted. `real_len` is the length of the
    /// part that was already checked.
    fn remove_planted_links_in(&self, entry_id: StoreEntryId, real_len: usize) -> sys::Result<()> {
        if self.is_new_bun_modules {
            return Ok(());
        }
        let mut bin = AutoPath::init_top_level_dir();
        self.append_store_node_modules_path(&mut bin, entry_id)?;
        let node_modules_len = bin.len();
        PathLike::append(&mut bin, b".bin")?;
        crate::prune::remove_planted_links(bin.slice(), real_len)?;

        let mut package = AutoPath::init_top_level_dir();
        self.append_store_path(&mut package, entry_id)?;
        crate::prune::remove_planted_links(
            // A cached package replaces whatever is at its path. A folder's files are linked into
            // the existing directory.
            if self.resolution(entry_id).can_enqueue_install_task() {
                package.dirname().unwrap_or_default()
            } else {
                package.slice()
            },
            node_modules_len,
        )
    }

    /// Called on the main thread. An entry that stays at its final path counts as installed, so its
    /// scripts would never run.
    pub(crate) fn discard_entries_with_unfinished_scripts(&mut self, failed: StoreEntryId) {
        // A task that still runs would put its entry in place after this has looked at it.
        self.tasks_in_flight.wait();
        let store = self.store;
        for (index, step) in store.entries.items_step().iter().enumerate() {
            let entry_id = StoreEntryId::from(index as u32);
            // Every unfinished trusted entry is discarded, because it is not known yet whether it
            // has scripts: a bun.lock written by an older Bun does not record that.
            if entry_id == failed
                || (step.load(Ordering::Acquire) != Step::Done as u32 && self.is_trusted(entry_id))
            {
                self.delete_store_copy(entry_id);
                // Also remove the symlinks to a `link:` dependency, because `start_link_task` takes
                // them to mean that its scripts already ran.
                if self.resolution(entry_id).tag == ResolutionTag::Symlink {
                    self.left_out_entries.push(entry_id);
                }
            }
        }
        self.unlink_left_out_entries();
    }

    /// Returns true if the scripts of a dependency's entry may run. Called on the main thread and
    /// on task threads.
    fn is_trusted(&self, entry_id: StoreEntryId) -> bool {
        let store::Ids { dep_id, pkg_id } = self.store.ids(entry_id);
        if dep_id == invalid_dependency_id {
            return false;
        }
        let lockfile = self.lockfile();
        self.trusted_dependencies_from_update_requests
            .contains(&pkg_id)
            || lockfile.has_trusted_dependency(
                lockfile.str(&lockfile.buffers.dependencies[dep_id as usize].name),
                self.pkg_name(entry_id),
                self.resolution(entry_id),
            )
    }

    /// Main thread, once no task runs: tasks read `lockfile.trusted_dependencies` without a lock.
    pub(crate) fn record_update_request_trust(&mut self) {
        if self.trusted_dependencies_from_update_requests.is_empty() {
            return;
        }
        let lockfile = self.lockfile();
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let pkg_names = lockfile.packages.items_name();
        let pkg_resolutions = lockfile.packages.items_resolution();
        let entries = &self.store.entries;

        let mut names: Vec<Box<[u8]>> = Vec::new();
        for (scripts, node_id) in entries.items_scripts().iter().zip(entries.items_node_id()) {
            let pkg_id = self.store.nodes.items_pkg_id()[node_id.get() as usize];
            if scripts.get().is_none()
                || !self
                    .trusted_dependencies_from_update_requests
                    .contains(&pkg_id)
            {
                continue;
            }
            let dep_id = self.store.nodes.items_dep_id()[node_id.get() as usize];
            let name = pkg_resolutions[pkg_id as usize].trusted_name(
                lockfile.buffers.dependencies[dep_id as usize].name,
                pkg_names[pkg_id as usize],
            );
            names.push(Box::from(name.slice(string_buf)));
        }
        if names.is_empty() {
            return;
        }

        let manager = self.manager_mut();
        let trusted = manager
            .lockfile
            .trusted_dependencies
            .get_or_insert_with(Default::default);
        for name in &names {
            trusted.insert(
                bun_semver::semver_string::Builder::string_hash(name) as TruncatedPackageNameHash,
                name.clone(),
            );
        }
        manager
            .trusted_deps_to_add_to_package_json
            .append(&mut names);
    }

    /// Main thread only: `completed` just reached `Step::Done`; re-check every entry waiting on it.
    pub(crate) fn resume_unblocked_tasks(&mut self, completed: StoreEntryId) {
        let entry_steps = self.store.entries.items_step();
        if Environment::CI_ASSERT {
            assert!(
                entry_steps[completed.get() as usize].load(Ordering::Relaxed) == Step::Done as u32
            );
        }

        let mut parent_dedupe: ArrayHashMap<StoreEntryId, ()> = ArrayHashMap::default();

        let mut waiter = core::mem::replace(
            &mut self.waiters_head[completed.get() as usize],
            StoreEntryId::INVALID,
        );
        while waiter != StoreEntryId::INVALID {
            let entry_id = waiter;
            waiter = core::mem::replace(
                &mut self.next_waiter[entry_id.get() as usize],
                StoreEntryId::INVALID,
            );
            if Environment::CI_ASSERT {
                assert!(
                    entry_steps[entry_id.get() as usize].load(Ordering::Relaxed)
                        == Step::Blocked as u32
                );
            }

            if let Some(blocked_on) = self.is_task_blocked(entry_id, &mut parent_dedupe) {
                self.push_waiter(blocked_on, entry_id);
                continue;
            }

            self.set_step(entry_id, Step::SymlinkDependencyBinaries);
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

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Relink {
    Off,
    Pending,
    Unchanged,
    /// Only the link to a skipped optional dependency changed. Every install creates that link and
    /// removes it again.
    ChangedOptional,
    Changed,
}

fn download_error_reason(e: crate::Error) -> &'static [u8] {
    match e {
        crate::Error::TarballHTTP400 => b"400 Bad Request",
        crate::Error::TarballHTTP401 => b"401 Unauthorized",
        crate::Error::TarballHTTP402 => b"402 Payment Required",
        crate::Error::TarballHTTP403 => b"403 Forbidden",
        crate::Error::TarballHTTP404 => b"404 Not Found",
        crate::Error::TarballHTTP4xx => b"HTTP 4xx",
        crate::Error::TarballHTTP5xx => b"HTTP 5xx",
        crate::Error::TarballFailedToExtract => b"failed to extract",
        crate::Error::TarballFailedToDownload => b"download failed",
        _ => e.name().as_bytes(),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Task
// ──────────────────────────────────────────────────────────────────────────

pub struct Task {
    pub(crate) entry_id: StoreEntryId,
    /// BACKREF: `Installer` owns `tasks[]` and outlives every `Task`. Stored as
    /// `BackRef` so worker-thread read sites use safe `Deref`/`get()` instead of
    /// per-site raw-pointer derefs. Constructed with a `NonNull::dangling()`
    /// placeholder (never dereferenced) and patched to the real address before
    /// any `start_task` call — see `isolated_install.rs`.
    pub(crate) installer: bun_ptr::BackRef<Installer<'static>>,

    pub(crate) task: thread_pool::CountedTask,
    pub(crate) next: bun_threading::Link<Task>, // INTRUSIVE: bun.UnboundedQueue(Task, .next) link

    pub(crate) result: Result,
    pub(crate) relink: Relink,
    /// The relink task continues with the lifecycle script steps. See
    /// `Installer::is_newly_trusted`.
    pub(crate) newly_trusted: bool,
    /// Set by `Step::RunPreinstall` on the task thread, read by `on_task_complete` like `relink`.
    pub(crate) blocked_scripts: u8,
    /// The warnings that `lay_folder_links` returned. `Installer::warn_left_out_links` logs them.
    pub(crate) left_out_links: Vec<Box<[u8]>>,
}

// SAFETY: `next` is the sole intrusive link for `UnboundedQueue<Task>`.
unsafe impl bun_threading::Linked for Task {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

pub enum Result {
    None,
    Err(TaskError),
    Blocked,
    /// Those of `store.entries.items_scripts()[entry_id]`, from its `first_index` on.
    RunScripts,
    Done,
}

pub enum TaskError {
    LinkPackage(sys::Error),
    SymlinkDependencies(sys::Error),
    RunScripts(crate::Error),
    Binaries(crate::Error),
    /// (dependency entry, error)
    DependencyBinaries(Box<[(StoreEntryId, crate::Error)]>),
    Patching(Log),
    Download {
        err: crate::Error,
        url: Box<[u8]>,
    },
}

type TaskResult<T> = core::result::Result<T, TaskError>;

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

impl Step {
    /// Decode the `AtomicU32` column repr back into a `Step`. The column is
    /// only ever stored via `Step::* as u32` (this file) so the value is
    /// always a valid discriminant.
    #[inline]
    const fn from_u32(raw: u32) -> Step {
        match raw {
            0 => Step::LinkPackage,
            1 => Step::SymlinkDependencies,
            2 => Step::CheckIfBlocked,
            3 => Step::SymlinkDependencyBinaries,
            4 => Step::RunPreinstall,
            5 => Step::Binaries,
            6 => Step::RunPostInstallAndPrePostPrepare,
            7 => Step::Done,
            8 => Step::Blocked,
            // Was @enumFromInt; cold atomic-load decode so the panic branch is fine.
            _ => unreachable!(),
        }
    }
}

impl Task {
    /// Called from task thread
    fn next_step(&self, current_step: Step) -> Step {
        let next_step: Step = match current_step {
            Step::LinkPackage => Step::SymlinkDependencies,
            Step::SymlinkDependencies => Step::CheckIfBlocked,
            Step::CheckIfBlocked => Step::SymlinkDependencyBinaries,
            Step::SymlinkDependencyBinaries => {
                if self.relink == Relink::Off || self.newly_trusted {
                    Step::RunPreinstall
                } else {
                    Step::Done
                }
            }
            Step::RunPreinstall => Step::Binaries,
            Step::Binaries => Step::RunPostInstallAndPrePostPrepare,
            Step::RunPostInstallAndPrePostPrepare => Step::Done,

            Step::Done | Step::Blocked => unreachable!("unexpected step"),
        };

        // SAFETY: `installer` is a BACKREF — the `Installer` owns `tasks[]` and
        // outlives every `Task` it schedules; the pointer is never null.
        //
        // We deliberately do **not** materialize `&Installer` here: this runs on
        // a thread-pool worker while the main thread may concurrently hold
        // `&mut Installer` (e.g. `start_task` writing `tasks[i].result`, or
        // `on_package_extracted`). A worker-side `&Installer` would alias that
        // `&mut` under Stacked Borrows. Instead, raw-read the `store: &Store`
        // field by value via `addr_of!` so no `&Installer` is formed — `Store`
        // lives outside the `Installer` allocation and `items_step()` is atomic.
        // This also avoids leaking the erased `'static` from
        // `*mut Installer<'static>` into a whole-struct borrow.
        let store: &Store = unsafe { *core::ptr::addr_of!((*self.installer.as_const_ptr()).store) };
        store.entries.items_step()[self.entry_id.get() as usize]
            .store(next_step as u32, Ordering::Release);

        next_step
    }

    /// Called from task thread
    fn run(&mut self) -> TaskResult<Result> {
        // Many `Task`s on the thread pool share one `Installer`, so only form `&Installer`.
        let installer_ptr = self.installer;
        let installer = installer_ptr.get();
        let entry_id = self.entry_id;
        let pkg_id = installer.store.ids(entry_id).pkg_id;
        let pkg_res = installer.resolution(entry_id);
        let pkgs = installer.lockfile().packages.slice();
        let entries = &installer.store.entries;
        let entry_step = &entries.items_step()[entry_id.get() as usize];

        let mut step = Step::from_u32(entry_step.load(Ordering::Acquire));
        // There was no directory of the entry before `Step::LinkPackage`.
        let mut made_entry = false;
        loop {
            match step {
                Step::LinkPackage => {
                    if pkg_res.tag == ResolutionTag::Folder {
                        self.left_out_links = installer
                            .link_folder(entry_id)
                            .map_err(TaskError::LinkPackage)?;
                    } else {
                        made_entry = installer.link_cached_package(entry_id)?;
                    }
                }

                Step::SymlinkDependencies => {
                    let relinking = self.relink != Relink::Off;
                    let strategy = if relinking
                        || matches!(pkg_res.tag, ResolutionTag::Root | ResolutionTag::Workspace)
                    {
                        symlinker::Strategy::ExpectExisting
                    } else {
                        symlinker::Strategy::ExpectMissing
                    };

                    let changed = installer.symlink_dependencies(entry_id, strategy, made_entry)?;

                    if relinking {
                        self.relink = changed;
                        if changed == Relink::Unchanged && !self.newly_trusted {
                            entry_step.store(Step::Done as u32, Ordering::Release);
                            return Ok(Result::Done);
                        }
                    } else if installer.entry_uses_global_store(entry_id) {
                        installer
                            .link_project_to_global_store(entry_id)
                            .map_err(TaskError::SymlinkDependencies)?;
                    }
                }

                Step::CheckIfBlocked => {
                    // preinstall scripts need to run before binaries can be linked. Block here if any dependencies
                    // of this entry are not finished. Do not count cycles towards blocking.

                    // The main thread holds back a workspace that may have scripts. See
                    // `release_members`.
                    let scripts = &pkgs.items_scripts()[pkg_id as usize];
                    let is_held = pkg_res.tag == ResolutionTag::Workspace
                        && installer.manager().options.do_.contains(Do::RUN_SCRIPTS)
                        && (scripts.has_any() || !scripts.filled);

                    if is_held
                        || installer
                            .is_task_blocked(entry_id, &mut ArrayHashMap::default())
                            .is_some()
                    {
                        return Ok(Result::Blocked);
                    }
                }

                Step::SymlinkDependencyBinaries => {
                    // `Step::LinkPackage` was skipped, so this check hasn't run yet.
                    if self.relink != Relink::Off {
                        installer
                            .remove_planted_links_in(entry_id, Installer::store_path_len())
                            .map_err(|err| TaskError::Binaries(err.into()))?;
                    }
                    installer.link_dependency_bins(entry_id)?;

                    if pkg_res.can_enqueue_install_task() {
                        installer.link_to_hidden_node_modules(entry_id);
                    }
                }

                Step::RunPreinstall => {
                    if self.prepare_scripts(installer)? {
                        return Ok(Result::RunScripts);
                    }
                }

                Step::Binaries => {
                    // A tarball without a package name has no folder and no bin.
                    if pkgs.items_bin()[pkg_id as usize].tag != bin::Tag::None
                        && let Some(own_name) = installer
                            .entry_store_node_modules_package_name(entry_id)
                            .filter(|name| !name.is_empty())
                    {
                        installer
                            .bin_links(entry_id)
                            .map_err(crate::Error::from)
                            .and_then(|mut links| {
                                installer.link_bins(&mut links, pkg_id, own_name, false)
                            })
                            .map_err(TaskError::Binaries)?;
                    }
                    installer
                        .commit_global_store_entry(entry_id)
                        .map_err(TaskError::LinkPackage)?;
                }

                Step::RunPostInstallAndPrePostPrepare => {
                    // Written, if at all, by this same Task in `Step::RunPreinstall`.
                    if let Some(list) = entries.items_scripts()[entry_id.get() as usize].get() {
                        // SAFETY: single-owner — the slot holds a `*mut List` boxed per entry, and
                        // each Task is the unique consumer of its own `entry_id`. No other
                        // `&`/`&mut` to this allocation is live.
                        let list = unsafe { &mut *list };

                        if list.first_index == 0 {
                            for (i, item) in list.items[1..].iter().enumerate() {
                                if item.is_some() {
                                    list.first_index = u8::try_from(i + 1).expect("int cast");
                                    break;
                                }
                            }
                        }

                        if list.first_index != 0 {
                            // There's nothing left to do after these scripts, so don't go back to
                            // the thread pool.
                            return Ok(Result::RunScripts);
                        }
                    }
                }

                Step::Done => return Ok(Result::Done),

                Step::Blocked => {
                    debug_assert!(false);
                    return Ok(Result::None);
                }
            }
            step = self.next_step(step);
        }
    }

    /// Task thread: `Step::RunPreinstall`. True: the entry has a preinstall script to run now.
    fn prepare_scripts(&mut self, installer: &Installer<'_>) -> TaskResult<bool> {
        let (manager, lockfile) = (installer.manager(), installer.lockfile());
        let store::Ids { dep_id, pkg_id } = installer.store.ids(self.entry_id);
        let pkg_res = installer.resolution(self.entry_id);
        if dep_id == invalid_dependency_id {
            return Ok(false);
        }

        let pkgs = lockfile.packages.slice();
        let pkg_metas = pkgs.items_meta();
        let mut pkg_scripts: package::scripts::Scripts = pkgs.items_scripts()[pkg_id as usize];
        let dep_name = lockfile.str(&lockfile.buffers.dependencies[dep_id as usize].name);
        let is_trusted = installer.is_trusted(self.entry_id);

        if pkg_res.tag != ResolutionTag::Workspace && !is_trusted {
            // Before the early returns below, like the hoisted installer.
            // `Which::Staging`, because a global-store entry stays in its staging directory until
            // `Step::Binaries` renames it.
            self.blocked_scripts =
                Self::count_blocked_scripts(installer, self.entry_id, Which::Staging);
            return Ok(false);
        }

        // Trusted entries are never global-store eligible; never run in the shared dir.
        if !manager.options.do_.contains(Do::RUN_SCRIPTS)
            || installer.entry_uses_global_store(self.entry_id)
        {
            return Ok(false);
        }

        if is_trusted
            && manager
                .postinstall_optimizer
                .should_ignore_lifecycle_scripts(
                    &postinstall_optimizer::PkgInfo {
                        name_hash: pkgs.items_name_hash()[pkg_id as usize],
                        version: if pkg_res.tag == ResolutionTag::Npm {
                            Some(pkg_res.npm().version)
                        } else {
                            None
                        },
                        version_buf: lockfile.buffers.string_bytes.as_slice(),
                    },
                    pkgs.items_resolutions()[pkg_id as usize]
                        .get(lockfile.buffers.resolutions.as_slice()),
                    pkg_metas,
                    manager.options.cpu,
                    manager.options.os,
                    manager.options.libc,
                )
        {
            return Ok(false);
        }

        let mut cwd = AutoAbsPath::init_top_level_dir();
        installer
            .append_store_path(&mut cwd, self.entry_id)
            .map_err(|err| TaskError::RunScripts(err.into()))?;
        let mut log = Log::init();
        let Some(list) = pkg_scripts
            .get_list(&mut log, lockfile, &mut cwd, dep_name, pkg_res, is_trusted)
            .map_err(TaskError::RunScripts)?
        else {
            return Ok(false);
        };

        let has_preinstall = list.first_index == 0;
        // Only this task writes the slot, and nothing reads it until the task returns
        // `Result::RunScripts`.
        installer.store.entries.items_scripts()[self.entry_id.get() as usize]
            .set(Some(bun_core::heap::into_raw(Box::new(list))));
        Ok(has_preinstall)
    }

    /// Returns how many lifecycle scripts of an untrusted dependency were blocked. It counts the
    /// scripts of the installed package, because `hasInstallScript` alone can be a false positive.
    pub(crate) fn count_blocked_scripts(
        installer: &Installer<'_>,
        entry_id: StoreEntryId,
        which: Which,
    ) -> u8 {
        let (manager, lockfile) = (installer.manager(), installer.lockfile());
        let store::Ids { dep_id, pkg_id } = installer.store.ids(entry_id);
        let pkgs = lockfile.packages.slice();
        if !pkgs.items_meta()[pkg_id as usize].has_install_script() {
            return 0;
        }
        let mut pkg_scripts: package::scripts::Scripts = pkgs.items_scripts()[pkg_id as usize];
        let dep_name = lockfile.str(&lockfile.buffers.dependencies[dep_id as usize].name);
        let pkg_res = installer.resolution(entry_id);
        let mut pkg_dir = AutoAbsPath::init_top_level_dir();

        let mut log = Log::init();
        let list = installer
            .append_real_store_path(&mut pkg_dir, entry_id, which)
            .map_err(crate::Error::from)
            // `true` counts the scripts that would run, like the hoisted installer does.
            .and_then(|()| {
                pkg_scripts.get_list(&mut log, lockfile, &mut pkg_dir, dep_name, pkg_res, true)
            });
        match list {
            Ok(Some(list)) => {
                if manager.options.log_level.is_verbose() {
                    bun_core::pretty_error!(
                        "Blocked {} scripts for: {}@{}\n",
                        list.total,
                        bstr::BStr::new(dep_name),
                        bun_core::fmt::for_terminal(pkg_res.fmt(
                            lockfile.buffers.string_bytes.as_slice(),
                            bun_core::fmt::PathSep::Posix
                        )),
                    );
                    // The pool flushes a thread out of tasks, when the process may be gone.
                    Output::flush();
                }
                list.total
            }
            Ok(None) => 0,
            Err(err) => {
                if !manager.options.log_level.is_silent() {
                    Output::err_generic(
                        "failed to fill lifecycle scripts for <b>{}<r>: {}",
                        (bstr::BStr::new(dep_name), err.name()),
                    );
                    Output::flush();
                }
                0
            }
        }
    }

    /// Called from task thread
    pub(crate) unsafe fn callback(task: *mut thread_pool::Task) {
        // SAFETY: task points to Task.task field
        let this: &mut Task = unsafe { &mut *bun_core::from_field_ptr!(Task, task, task) };

        // Many `Task`s on the thread pool share one `Installer`, so never form `&mut Installer`.
        let installer_ptr = this.installer;
        let installer = installer_ptr.get();
        let manager_ptr: *mut PackageManager = installer.manager;
        let entry_step = &installer.store.entries.items_step()[this.entry_id.get() as usize];

        let result = this.run();
        if Environment::CI_ASSERT {
            // .monotonic is okay because this should have been set by this thread.
            let step = Step::from_u32(entry_step.load(Ordering::Relaxed));
            assert!(match &result {
                Ok(Result::Done) => step == Step::Done,
                Ok(Result::Blocked) => step == Step::CheckIfBlocked,
                Ok(_) => true,
                Err(_) => step != Step::Done,
            });
        }
        this.result = match result {
            Ok(Result::None) => return,
            Ok(result) => result,
            Err(err) => {
                entry_step.store(Step::Done as u32, Ordering::Release);
                Result::Err(err)
            }
        };
        installer.task_queue.push(core::ptr::NonNull::from(this));
        // SAFETY: `manager_ptr` is the non-null BACKREF and outlives every `Task`. `wake_raw` never
        // forms `&mut PackageManager`, so two threads finishing at once do not alias.
        unsafe { PackageManager::wake_raw(manager_ptr) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PatchInfo
// ──────────────────────────────────────────────────────────────────────────

pub enum PatchInfo {
    None,
    Remove,
    Patch(PatchInfoPatch),
}

pub struct PatchInfoPatch {
    pub(crate) name_and_version_hash: u64,
    pub(crate) contents_hash: u64,
}

impl PatchInfo {
    pub(crate) fn contents_hash(&self) -> Option<u64> {
        match self {
            PatchInfo::None | PatchInfo::Remove => None,
            PatchInfo::Patch(patch) => Some(patch.contents_hash),
        }
    }

    pub(crate) fn name_and_version_hash(&self) -> Option<u64> {
        match self {
            PatchInfo::None | PatchInfo::Remove => None,
            PatchInfo::Patch(patch) => Some(patch.name_and_version_hash),
        }
    }
}

impl<'a> Installer<'a> {
    /// A patch entry without a hash is an error, not `PatchInfo::None`.
    pub(crate) fn package_patch_info(&self, pkg_id: PackageID) -> TaskResult<PatchInfo> {
        let lockfile = self.lockfile();
        if lockfile.patched_dependencies.len() == 0
            && self.manager().patched_dependencies_to_remove.len() == 0
        {
            return Ok(PatchInfo::None);
        }

        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let pkgs = lockfile.packages.slice();
        let pkg_name = pkgs.items_name()[pkg_id as usize].slice(string_buf);
        let pkg_name_hash = pkgs.items_name_hash()[pkg_id as usize];
        let pkg_res = &pkgs.items_resolution()[pkg_id as usize];

        let mut version_buf: Vec<u8> = Vec::new();

        write!(&mut version_buf, "{}@", bstr::BStr::new(pkg_name)).expect("unreachable");

        match pkg_res.tag {
            ResolutionTag::Workspace => {
                if let Some(workspace_version) = lockfile.workspace_versions.get(&pkg_name_hash) {
                    write!(&mut version_buf, "{}", workspace_version.fmt(string_buf))
                        .expect("unreachable");
                }
            }
            _ => {
                write!(
                    &mut version_buf,
                    "{}",
                    pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Posix),
                )
                .expect("unreachable");
            }
        }

        let name_and_version_hash = bun_semver::semver_string::Builder::string_hash(&version_buf);

        if let Some(patch) = lockfile.patched_dependencies.get(&name_and_version_hash) {
            let Some(contents_hash) = patch.patchfile_hash() else {
                let mut log = Log::init();
                log.add_error_fmt_opts(
                    format_args!(
                        "the hash of patch file {} was not calculated before install, this is a bug in Bun",
                        bun_core::fmt::quote(patch.path.slice(string_buf)),
                    ),
                    Default::default(),
                );
                return Err(TaskError::Patching(log));
            };
            return Ok(PatchInfo::Patch(PatchInfoPatch {
                name_and_version_hash,
                contents_hash,
            }));
        }

        if self
            .manager()
            .patched_dependencies_to_remove
            .contains_key(&name_and_version_hash)
        {
            return Ok(PatchInfo::Remove);
        }

        Ok(PatchInfo::None)
    }

    /// Returns the name of the entry's folder in the cache. It's empty for a tarball whose
    /// integrity isn't known yet.
    pub(crate) fn cached_folder_name(
        &self,
        entry_id: StoreEntryId,
        patch_hash: Option<u64>,
    ) -> &'static ZStr {
        let manager = self.manager();
        let pkg_res = self.resolution(entry_id);
        match pkg_res.tag {
            ResolutionTag::Npm => directories::cached_npm_package_folder_name(
                manager,
                self.pkg_name(entry_id),
                pkg_res.npm().version,
                patch_hash,
            ),
            ResolutionTag::Git => {
                directories::cached_git_folder_name(manager, pkg_res.git(), patch_hash)
            }
            ResolutionTag::Github => {
                directories::cached_github_folder_name(manager, pkg_res.github(), patch_hash)
            }
            ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
                let pkg_id = self.store.ids(entry_id).pkg_id;
                directories::cached_tarball_folder_name(
                    manager,
                    &self.lockfile().packages.items_meta()[pkg_id as usize].integrity,
                    pkg_res,
                    patch_hash,
                )
            }
            _ => unreachable!(),
        }
    }

    /// Runs `Step::LinkPackage` for a folder dependency, on a task thread. Returns the warnings to
    /// store in `Task::left_out_links`.
    fn link_folder(&self, entry_id: StoreEntryId) -> sys::Result<Vec<Box<[u8]>>> {
        let skip_dirnames: &[&paths::OSPathSlice] = &[bun_paths::os_path_literal!("node_modules")];
        let path: &[u8] = self.lockfile().str(self.resolution(entry_id).folder());
        // The folder isn't in the cache, so whether it's on another device is checked for each
        // folder dependency.
        let folder_dir = sys::open_dir_for_iteration(Fd::cwd(), path)?;
        let _folder_dir_guard = sys::CloseOnDrop::new(folder_dir);

        self.remove_planted_links_in(entry_id, Self::store_path_len())?;

        // The hardlink and copy walks below only visit what the folder contains now. First remove
        // what it no longer has from the old copy, and any symlink that they would write through.
        let mut copy = AutoPath::init();
        self.append_store_path(&mut copy, entry_id)?;
        if let (Ok(src), Ok(dest)) = (sys::Dir::open(path), sys::Dir::open(copy.slice())) {
            crate::prune::remove_entries_missing_from(&src, &dest);
        }

        let hardlinked = {
            let mut src = OsAutoAbsPath::init_top_level_dir_long_path();
            src.try_append_join(path).map_err(name_too_long)?;
            let mut dest = OsAutoPath::init();
            self.append_store_path(&mut dest, entry_id)?;

            let mut hardlinker =
                bun_core::handle_oom(Hardlinker::init(folder_dir, src, dest, skip_dirnames));
            match hardlinker.link() {
                Ok(()) => true,
                Err(err) if needs_copy(&err) => false,
                Err(err) => {
                    print_link_error(
                        "hardlink package folder",
                        &err,
                        &os_path(hardlinker.src.slice()),
                        hardlinker.dest.slice(),
                    );
                    return Err(err);
                }
            }
        };

        if !hardlinked {
            // rewind the dir cursor the hardlink walk consumed (Windows restarts the scan itself)
            #[cfg(not(windows))]
            sys::set_file_offset(folder_dir, 0)?;

            #[cfg(windows)]
            let mut src_path = OsAutoAbsPath::init();
            #[cfg(not(windows))]
            let src_path = OsAutoAbsPath::init();

            #[cfg(windows)]
            {
                // Borrow once. A second `src_path.buf()` for the length would invalidate `ptr`.
                let buf = src_path.buf();
                let cap = buf.len();
                let ptr = buf.as_mut_ptr();
                // SAFETY: FFI — `folder_dir` is an open handle; `ptr`
                // points into a writable WPathBuffer of `cap` elements.
                let src_path_len = unsafe {
                    bun_sys::windows::GetFinalPathNameByHandleW(
                        folder_dir.native(),
                        ptr,
                        u32::try_from(cap).expect("int cast"),
                        0,
                    )
                };

                if src_path_len == 0 {
                    return Err(sys::Error::from_win32(
                        sys::windows::Win32Error::get(),
                        sys::Tag::copyfile,
                    ));
                }
                if src_path_len as usize >= cap {
                    return Err(sys::Error::from_code(
                        sys::E::ENAMETOOLONG,
                        sys::Tag::copyfile,
                    ));
                }

                src_path.set_length(src_path_len as usize);
            }

            let mut dest = OsAutoPath::init();
            self.append_store_path(&mut dest, entry_id)?;

            let mut file_copier =
                bun_core::handle_oom(FileCopier::init(folder_dir, src_path, dest, skip_dirnames));
            if let Err(err) = file_copier.copy() {
                print_link_error(
                    "copy package",
                    &err,
                    &os_path(file_copier.src_path.slice()),
                    file_copier.dest_subpath.slice(),
                );
                return Err(err);
            }
        }

        let pkg_id = self.store.ids(entry_id).pkg_id;
        if self.lockfile().is_trusted_folder_package(pkg_id)
            && let Ok(dest) = sys::Dir::open(copy.slice())
        {
            return Ok(crate::package_install::lay_folder_links(path, &dest));
        }
        Ok(Vec::new())
    }

    /// `Relaxed`: an optimization, it's okay if another thread doesn't see the update "in time".
    fn set_backend(&self, method: InstallMethod) -> InstallMethod {
        self.supported_backend
            .store(method as u8, Ordering::Relaxed);
        method
    }

    /// Task thread. True: the entry had no directory before.
    fn link_cached_package(&self, entry_id: StoreEntryId) -> TaskResult<bool> {
        let patch_info = self.package_patch_info(self.store.ids(entry_id).pkg_id)?;
        let subpath = self.cached_folder_name(entry_id, patch_info.contents_hash());
        #[cfg(target_os = "macos")]
        let mut subpath = AutoRelPath::from(subpath).assume_ok();
        #[cfg(not(target_os = "macos"))]
        let subpath = AutoRelPath::from(subpath).assume_ok();

        // SAFETY: idempotent cache-dir initialization (once-init internally). The
        // `&mut PackageManager` does not outlive this statement; no `&PackageManager` is live on
        // this thread across it. Concurrent task threads may race the same once-init path — that
        // is a data-level race the once-init guards, not an aliasing violation here because no
        // long-lived `&mut PackageManager` exists.
        let (cache_dir, cache_dir_path) =
            directories::get_cache_directory_and_abs_path(unsafe { &mut *self.manager });

        let uses_global_store = self.entry_uses_global_store(entry_id);
        let staging = if uses_global_store {
            // Clear any leftover staging directory from a crashed earlier run with the same suffix.
            let mut staging = AutoAbsPath::init();
            self.append_global_store_entry_path(&mut staging, entry_id, Which::Staging)
                .map_err(TaskError::LinkPackage)?;
            let _ = Fd::cwd().delete_tree(staging.slice());
            Staging::Off
        } else {
            self.staging_lock.get_or_init(StagingLock::acquire).mode
        };

        let mut link_in_place = false;
        let mut made_entry = false;
        loop {
            // If this install created `node_modules/.bun`, nothing from this entry is in there yet.
            if !uses_global_store && (!self.is_new_bun_modules || link_in_place) {
                // An entry that lost global-store eligibility is still a link into that store.
                let mut local = AutoPath::init_top_level_dir();
                self.append_local_store_entry_path(&mut local, entry_id)
                    .map_err(TaskError::LinkPackage)?;
                let is_stale_link = is_link(local.slice_z());
                if is_stale_link == Some(true)
                    && let Err(err) = remove_link(local.slice_z())
                    && err.get_errno() != sys::Errno::ENOENT
                {
                    // Do NOT proceed: the backend below would write *through* the live symlink.
                    return Err(TaskError::LinkPackage(err));
                }

                made_entry |= is_stale_link != Some(false);
                if is_stale_link == Some(false) {
                    self.remove_planted_links_in(entry_id, local.len())
                        .map_err(TaskError::LinkPackage)?;
                    link_in_place |= self
                        .clear_local_store_package(entry_id, staging, true)
                        .is_err();
                }
            }

            let mut backend =
                InstallMethod::from_u8(self.supported_backend.load(Ordering::Relaxed));
            let linked: sys::Result<()> = 'backend: loop {
                // Rebuilt per iteration; this only re-runs once on an EXDEV/OPNOTSUPP retry.
                let mut dest_subpath = OsAutoPath::init();
                if let Err(err) = if uses_global_store || link_in_place {
                    self.append_real_store_path(&mut dest_subpath, entry_id, Which::Staging)
                } else {
                    self.append_local_staging_path(&mut dest_subpath, entry_id, staging)
                } {
                    break 'backend Err(err);
                }
                match backend {
                    InstallMethod::Clonefile => {
                        #[cfg(not(target_os = "macos"))]
                        {
                            backend = self.set_backend(InstallMethod::Hardlink);
                            continue 'backend;
                        }
                        #[cfg(target_os = "macos")]
                        {
                            if self.manager().options.log_level.is_verbose() {
                                bun_core::pretty_errorln!(
                                    "Cloning {} to {}",
                                    os_path(subpath.slice_z()),
                                    os_path(dest_subpath.slice_z()),
                                );
                                Output::flush();
                            }

                            let mut cloner = FileCloner {
                                cache_dir,
                                cache_dir_subpath: &mut subpath,
                                dest_subpath,
                            };
                            let Err(err) = cloner.clone() else {
                                break 'backend Ok(());
                            };
                            backend = self.set_backend(match err.get_errno() {
                                sys::Errno::EXDEV => InstallMethod::Copyfile,
                                sys::Errno::EOPNOTSUPP => InstallMethod::Hardlink,
                                _ => break 'backend Err(err),
                            });
                            continue 'backend;
                        }
                    }

                    InstallMethod::Hardlink => {
                        let dir = match sys::open_dir_for_iteration(cache_dir, subpath.slice()) {
                            Ok(fd) => fd,
                            Err(err) => {
                                if PackageManager::verbose_install() {
                                    bun_core::pretty_errorln!(
                                        "Failed to open cache directory for hardlink: {}",
                                        bstr::BStr::new(subpath.slice()),
                                    );
                                    Output::flush();
                                }
                                return Err(TaskError::LinkPackage(err));
                            }
                        };
                        let _dir_guard = sys::CloseOnDrop::new(dir);

                        let mut src =
                            OsAutoAbsPath::from_long_path(cache_dir_path.slice()).assume_ok();
                        if let Err(err) = src.try_append_join(subpath.slice()) {
                            break 'backend Err(name_too_long(err));
                        }

                        let mut hardlinker =
                            bun_core::handle_oom(Hardlinker::init(dir, src, dest_subpath, &[]));
                        let Err(err) = hardlinker.link() else {
                            break 'backend Ok(());
                        };
                        if needs_copy(&err) {
                            backend = self.set_backend(InstallMethod::Copyfile);
                            continue 'backend;
                        }
                        print_link_error(
                            "hardlink package",
                            &err,
                            &bstr::BStr::new(subpath.slice()),
                            hardlinker.dest.slice(),
                        );
                        break 'backend Err(err);
                    }

                    _ => {
                        let dir = sys::open_dir_for_iteration(cache_dir, subpath.slice())
                            .inspect_err(|err| {
                                print_link_error(
                                    "open cache directory for copyfile",
                                    err,
                                    &bstr::BStr::new(subpath.slice()),
                                    dest_subpath.slice(),
                                );
                            })
                            .map_err(TaskError::LinkPackage)?;
                        let _dir_guard = sys::CloseOnDrop::new(dir);

                        let mut src = OsAutoAbsPath::from(cache_dir_path.slice()).assume_ok();
                        if let Err(err) = PathLike::append(&mut src, subpath.slice()) {
                            break 'backend Err(err);
                        }

                        let mut file_copier =
                            bun_core::handle_oom(FileCopier::init(dir, src, dest_subpath, &[]));
                        let Err(err) = file_copier.copy() else {
                            break 'backend Ok(());
                        };
                        print_link_error(
                            "copy package",
                            &err,
                            &bstr::BStr::new(subpath.slice()),
                            file_copier.dest_subpath.slice(),
                        );
                        break 'backend Err(err);
                    }
                }
            };

            if let Err(err) = linked {
                if !uses_global_store
                    && !link_in_place
                    && err.get_errno() == sys::Errno::ENAMETOOLONG
                {
                    // The staging name can be longer than the package's name.
                    link_in_place = true;
                    continue;
                }
                if link_in_place {
                    // Whatever is at the final path counts as installed.
                    self.delete_store_copy(entry_id);
                }
                return Err(TaskError::LinkPackage(err));
            }

            if uses_global_store
                || link_in_place
                || self.commit_local_store_package(entry_id, staging)
            {
                return Ok(made_entry);
            }
            // The rename was refused: link again, in place.
            link_in_place = true;
        }
    }

    /// `build_store` assigns each name to one entry, so only one thread writes each link.
    fn hidden_hoist_names(&self, entry_id: StoreEntryId) -> impl Iterator<Item = &'a [u8]> {
        let (store, lockfile) = (self.store, self.lockfile());
        (store.entries.items_hoisted()[entry_id.get() as usize])
            .then(|| store.ids(entry_id).dep_id)
            .into_iter()
            .chain(
                (store.hidden_hoist_keys.iter())
                    .filter(move |key| key.entry_id == entry_id)
                    .map(|key| key.dep_id),
            )
            .map(move |dep_id| lockfile.str(&lockfile.buffers.dependencies[dep_id as usize].name))
    }

    pub(crate) fn link_to_hidden_node_modules(&self, entry_id: StoreEntryId) {
        for name in self.hidden_hoist_names(entry_id) {
            let (store, lockfile) = (self.store, self.lockfile());
            Self::link_hidden_name(store, lockfile, entry_id, name, self.is_new_bun_modules);
        }
    }

    /// `entry_id` must be the entry of a package whose resolution `can_enqueue_install_task`.
    pub(crate) fn link_hidden_name(
        store: &Store,
        lockfile: &Lockfile,
        entry_id: StoreEntryId,
        name: &[u8],
        is_new_bun_modules: bool,
    ) {
        let pkg_id = store.ids(entry_id).pkg_id;
        let pkg_name = lockfile.str(&lockfile.packages.items_name()[pkg_id as usize]);
        let mut hidden_hoisted_node_modules = AutoPath::init();
        let _ = hidden_hoisted_node_modules.append(b"node_modules/.bun/node_modules");
        // `install_isolated_packages` looked at it.
        let mut real_len = hidden_hoisted_node_modules.len();
        let _ = hidden_hoisted_node_modules.append(name); // OOM/capacity: fire-and-forget
        if is_new_bun_modules {
            real_len = hidden_hoisted_node_modules.len();
        }

        let mut target = AutoRelPath::init();

        let _ = target.append(b".."); // OOM/capacity: fire-and-forget
        if strings::index_of_char(name, b'/').is_some() {
            let _ = target.append(b".."); // OOM/capacity: fire-and-forget
        }

        // OOM/capacity: fire-and-forget
        let _ = target.append_fmt(format_args!(
            "{}/node_modules/{}",
            store::entry::fmt_store_path(entry_id, store, lockfile),
            bstr::BStr::new(pkg_name),
        ));

        #[cfg(windows)]
        let mut full_target = AutoAbsPath::init_top_level_dir();
        #[cfg(windows)]
        let _ = full_target.append_fmt(format_args!(
            "node_modules/.bun/{}/node_modules/{}",
            store::entry::fmt_store_path(entry_id, store, lockfile),
            bstr::BStr::new(pkg_name),
        ));

        let mut symlinker = Symlinker {
            dest: hidden_hoisted_node_modules.into_sep::<{ PathSeparators::ANY }>(),
            target: target.into_sep::<{ PathSeparators::ANY }>(),
            real_len,
            node_modules_len: 0,
            is_behind_link: false,
            is_absolute: false,
            #[cfg(windows)]
            fallback_junction_target: full_target.into_sep::<{ PathSeparators::ANY }>(),
        };

        // symlinks won't exist if node_modules/.bun is new
        let link_strategy: symlinker::Strategy = if is_new_bun_modules {
            symlinker::Strategy::ExpectMissing
        } else {
            symlinker::Strategy::ExpectExisting
        };

        let _ = symlinker.ensure_symlink(link_strategy);
    }

    fn maybe_replace_node_modules_path(&self, pkg_id: PackageID) -> Option<StoreEntryId> {
        let (manager, lockfile) = (self.manager(), self.lockfile());
        if !manager.postinstall_optimizer.is_native_binlink_enabled() {
            return None;
        }
        let pkgs = lockfile.packages.slice();
        let pkg_info = postinstall_optimizer::PkgInfo {
            name_hash: pkgs.items_name_hash()[pkg_id as usize],
            ..postinstall_optimizer::PkgInfo::default()
        };
        let Some(PostinstallOptimizer::NativeBinlink) =
            manager.postinstall_optimizer.get(&pkg_info)
        else {
            return None;
        };
        let replacement_pkg_id = PostinstallOptimizer::get_native_binlink_replacement_package_id(
            pkgs.items_resolutions()[pkg_id as usize].get(lockfile.buffers.resolutions.as_slice()),
            pkgs.items_meta(),
            manager.options.cpu,
            manager.options.os,
            manager.options.libc,
        )?;
        let node_pkg_ids = self.store.nodes.items_pkg_id();
        let new_entry_id = (self.store.entries.items_node_id().iter())
            .position(|node_id| node_pkg_ids[node_id.get() as usize] == replacement_pkg_id)?;
        Some(StoreEntryId::from(new_entry_id as u32))
    }

    /// Which dependency links of the entry were written: `Unchanged`, `ChangedOptional`, `Changed`.
    fn symlink_dependencies(
        &self,
        entry_id: StoreEntryId,
        strategy: symlinker::Strategy,
        made_entry: bool,
    ) -> TaskResult<Relink> {
        match self.symlink_dependencies_behind(None, entry_id, strategy, made_entry) {
            // `ELOOP` means the workspace's `node_modules` is a symlink (see
            // `Symlinker::node_modules_len`). Try again with that symlink resolved.
            Err(TaskError::SymlinkDependencies(err))
                if err.get_errno() == sys::E::ELOOP
                    && self.resolution(entry_id).tag == ResolutionTag::Workspace =>
            {
                let mut node_modules = AutoPath::init_top_level_dir();
                self.append_store_node_modules_path(&mut node_modules, entry_id)
                    .map_err(TaskError::SymlinkDependencies)?;
                let Some(linked) = LinkedNodeModules::at(node_modules.slice_z()) else {
                    return Err(TaskError::SymlinkDependencies(err));
                };
                self.symlink_dependencies_behind(Some(&linked), entry_id, strategy, made_entry)
            }
            result => result,
        }
    }

    /// `own` is set when the entry is a workspace whose own `node_modules` is a symlink.
    fn symlink_dependencies_behind(
        &self,
        own: Option<&LinkedNodeModules>,
        entry_id: StoreEntryId,
        strategy: symlinker::Strategy,
        made_entry: bool,
    ) -> TaskResult<Relink> {
        let lockfile = self.lockfile();
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let dependencies = lockfile.buffers.dependencies.as_slice();
        let pkg_resolutions = lockfile.packages.items_resolution();

        let pkg_id = self.store.ids(entry_id).pkg_id;
        let pkg_res = &pkg_resolutions[pkg_id as usize];
        let entry_node_modules_name = self.entry_store_node_modules_package_name(entry_id);
        let uses_global_store = self.entry_uses_global_store(entry_id);

        let mut dest = AutoPath::init_top_level_dir();
        self.append_real_store_node_modules_path(&mut dest, entry_id, Which::Staging)
            .map_err(TaskError::SymlinkDependencies)?;
        // A relative symlink is resolved from its real location, so `dest` needs its real path when
        // `node_modules` or the workspace's directory is itself a symlink.
        let is_linked = (self.linked.iter().chain(own)).any(|linked| linked.resolve(&mut dest));
        let linked_member = if !is_linked && pkg_res.tag == ResolutionTag::Workspace {
            let path = lockfile.str(pkg_res.workspace());
            lockfile.linked_members.get(path)
        } else {
            None
        };
        if cfg!(not(windows))
            && let Some(member) = linked_member
        {
            dest = AutoPath::from(&*member.real_path).assume_ok();
            PathLike::append(&mut dest, b"node_modules").map_err(TaskError::SymlinkDependencies)?;
        }
        let base_len = dest.len();
        // The links go directly into the symlinked `node_modules` of the project or of a workspace.
        // Not even a first install clears that directory, so it can contain anything.
        let is_behind_link =
            is_linked && matches!(pkg_res.tag, ResolutionTag::Root | ResolutionTag::Workspace);
        // `LinkedNodeModules::resolve` explains why Windows needs absolute links here.
        let all_absolute = cfg!(windows) && (is_behind_link || linked_member.is_some());

        // See `Symlinker::real_len`. A first install with `--filter` doesn't clear the workspaces'
        // `node_modules`.
        let all_real = made_entry
            || uses_global_store
            || (self.is_new_bun_modules
                && pkg_res.tag != ResolutionTag::Workspace
                && !is_behind_link);
        let mut real_len = match (pkg_res.tag, strategy) {
            (ResolutionTag::Root, _) | (_, symlinker::Strategy::ExpectMissing) => base_len,
            _ if is_behind_link => base_len,
            _ => base_len - "/node_modules".len(),
        };
        let node_modules_len = match pkg_res.tag {
            ResolutionTag::Workspace => base_len,
            _ => 0,
        };
        let mut real_scope: &[u8] = b"";

        // Returns `dest` along with the `real_len` that the symlinker ended with.
        let link = |mut dest: AutoPath, mut to: AutoAbsPath, real_len: usize| {
            // True if the target is inside the same symlinked `node_modules` as the link, as when
            // one store entry links to another.
            let stays_behind_link =
                is_linked && (self.linked.iter().chain(own)).any(|linked| linked.resolve(&mut to));
            let dest_len = dest.len();
            dest.undo(1);
            let target = dest.relative(&to);
            dest.set_length(dest_len);

            let mut symlinker = Symlinker {
                dest: dest.into_sep::<{ PathSeparators::ANY }>(),
                target: target.into_sep::<{ PathSeparators::ANY }>(),
                real_len: if all_real { dest_len } else { real_len },
                node_modules_len,
                is_behind_link,
                is_absolute: all_absolute || (cfg!(windows) && is_linked && !stays_behind_link),
                #[cfg(windows)]
                fallback_junction_target: to.into_sep::<{ PathSeparators::ANY }>(),
            };
            let written = symlinker
                .ensure_symlink(strategy)
                .map_err(TaskError::SymlinkDependencies);
            let dest = symlinker.dest.into_sep::<{ PathSeparators::AUTO }>();
            (dest, symlinker.real_len, written)
        };

        let mut changed = Relink::Unchanged;
        for dep in self.store.entries.items_dependencies()[entry_id.get() as usize].slice() {
            let dep_name = dependencies[dep.dep_id as usize].name.slice(string_buf);

            dest.set_length(base_len);
            append_dependency_link_name(&mut dest, dep_name, entry_node_modules_name)
                .map_err(TaskError::SymlinkDependencies)?;
            if real_len > base_len
                && !(dep_name.starts_with(real_scope)
                    && dep_name.get(real_scope.len()) == Some(&b'/'))
            {
                real_len = base_len;
            }

            let dep_pkg_id = self.store.ids(dep.entry_id).pkg_id;
            let dep_res = &pkg_resolutions[dep_pkg_id as usize];
            let folder_is_inside_this_package = dep_res.tag == ResolutionTag::Folder
                && super::folder_is_inside_package(lockfile, pkg_id, dep_pkg_id);
            let dep_is_nested_folder =
                self.store.entries.items_nested_folder()[dep.entry_id.get() as usize];
            // `build_store` only binds a nested folder to the packages containing it.
            debug_assert!(folder_is_inside_this_package || !dep_is_nested_folder);

            let mut dep_store_path = AutoAbsPath::init_top_level_dir();
            if folder_is_inside_this_package {
                let Some(package_dir_name) = entry_node_modules_name else {
                    continue;
                };
                if !self
                    .append_nested_folder_path(
                        &mut dep_store_path,
                        entry_id,
                        package_dir_name,
                        dep_res.folder().slice(string_buf),
                    )
                    .map_err(TaskError::SymlinkDependencies)?
                {
                    continue;
                }
            } else if dep_is_nested_folder {
                continue;
            } else if uses_global_store {
                debug_assert!(self.entry_uses_global_store(dep.entry_id));
                self.append_real_store_path(&mut dep_store_path, dep.entry_id, Which::Final)
                    .map_err(TaskError::SymlinkDependencies)?;
            } else {
                self.append_store_path(&mut dep_store_path, dep.entry_id)
                    .map_err(TaskError::SymlinkDependencies)?;
            }

            let (linked_dest, looked_len, written) = link(dest, dep_store_path, real_len);
            dest = linked_dest;
            if !all_real && looked_len != real_len {
                real_len = looked_len;
                real_scope = dep_name
                    .get(..real_len.saturating_sub(base_len + 1))
                    .unwrap_or(b"");
            }
            if written? {
                let behavior = dependencies[dep.dep_id as usize].behavior;
                if !(behavior.is_optional() || behavior.is_optional_peer()) {
                    changed = Relink::Changed;
                } else if changed == Relink::Unchanged {
                    changed = Relink::ChangedOptional;
                }
            }
        }

        // See `Lockfile::bundled_by_folder`.
        if pkg_res.tag == ResolutionTag::Folder {
            let folder = pkg_res.folder().slice(string_buf);
            for bundled in lockfile.bundled_by_folder(folder) {
                let dep_name = bundled.name.slice(string_buf);
                let mut shipped = AutoAbsPath::init_top_level_dir();
                if shipped.len() + folder.len() + dep_name.len() + "/node_modules//".len()
                    >= paths::MAX_PATH_BYTES
                {
                    continue;
                }
                shipped.append_join(folder).assume_ok();
                shipped.append(b"node_modules").assume_ok();
                shipped.append(dep_name).assume_ok();
                if !sys::directory_exists_at(Fd::cwd(), shipped.slice_z()).unwrap_or(false) {
                    continue;
                }

                dest.set_length(base_len);
                append_dependency_link_name(&mut dest, dep_name, entry_node_modules_name)
                    .map_err(TaskError::SymlinkDependencies)?;
                let (linked_dest, _, written) = link(dest, shipped, real_len.min(base_len));
                dest = linked_dest;
                if written? {
                    changed = Relink::Changed;
                }
            }
        }

        Ok(changed)
    }

    /// Main thread, once every task is done: dependents may still be linking while a script fails.
    pub(crate) fn unlink_left_out_entries(&self) {
        if self.left_out_entries.is_empty() {
            return;
        }
        let lockfile = self.lockfile();

        // Not `parents`: public hoisting adds root dependencies without recording a parent.
        for (entry_index, entry_deps) in self.store.entries.items_dependencies().iter().enumerate()
        {
            let entry_id = StoreEntryId::from(entry_index as u32);
            for dep in entry_deps.slice() {
                // Other projects share a dependent in the global store.
                if !self.left_out_entries.contains(&dep.entry_id)
                    || self.entry_uses_global_store(entry_id)
                {
                    continue;
                }
                let mut dest = AutoPath::init_top_level_dir();
                let fits = self
                    .append_real_store_node_modules_path(&mut dest, entry_id, Which::Final)
                    .and_then(|()| {
                        append_dependency_link_name(
                            &mut dest,
                            lockfile.str(&lockfile.buffers.dependencies[dep.dep_id as usize].name),
                            self.entry_store_node_modules_package_name(entry_id),
                        )
                    });
                if fits.is_ok() && is_link(dest.slice_z()) == Some(true) {
                    let _ = remove_link(dest.slice_z());
                }
            }
        }

        for &entry_id in &self.left_out_entries {
            for name in self.hidden_hoist_names(entry_id) {
                let mut hidden = AutoPath::init();
                let _ = hidden.append(b"node_modules/.bun/node_modules");
                let real_len = hidden.len();
                let _ = hidden.append(name);
                let scope = hidden.dirname().unwrap_or_default();
                if crate::prune::remove_planted_links(scope, real_len).is_ok() {
                    let _ = remove_link(hidden.slice_z());
                }
            }
        }
    }

    /// Call on the main thread once every task is done. The warnings are logged in entry order, so
    /// the output does not depend on which task finished first.
    pub(crate) fn warn_left_out_links(&self) {
        for text in self.tasks.iter().flat_map(|task| &task.left_out_links) {
            self.manager().log_mut().add_warning_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!("{}", bun_core::fmt::escape_control_chars(text)),
            );
        }
    }

    pub(crate) fn link_dependency_bins(&self, parent_entry_id: StoreEntryId) -> TaskResult<()> {
        let (lockfile, store) = (self.lockfile(), self.store);
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let dependencies = lockfile.buffers.dependencies.as_slice();
        let entry_deps = store.entries.items_dependencies();
        let pkgs = lockfile.packages.slice();
        let pkg_bins = pkgs.items_bin();

        let mut links = self
            .bin_links(parent_entry_id)
            .map_err(|err| TaskError::Binaries(err.into()))?;
        let mut failed = Vec::new();

        // Public hoisting gives the root entry dependencies that the root package does not declare.
        let is_importer = matches!(
            self.resolution(parent_entry_id).tag,
            ResolutionTag::Root | ResolutionTag::Workspace
        );
        let parent_dependencies = if is_importer {
            pkgs.items_dependencies()[store.ids(parent_entry_id).pkg_id as usize]
        } else {
            Default::default()
        };
        // Match by name, not by dependency id. A store entry keeps the id of whichever dependency
        // reached it first, which may be another package's peer dependency.
        let is_direct = |name_hash: u64| {
            (parent_dependencies.get(dependencies).iter()).any(|own| {
                own.name_hash == name_hash && bin_real::LinkOrder::declares(own.behavior)
            })
        };

        let mut deps_with_bins: Vec<_> = entry_deps[parent_entry_id.get() as usize]
            .slice()
            .iter()
            .filter(|dep| pkg_bins[store.ids(dep.entry_id).pkg_id as usize].tag != bin::Tag::None)
            .collect();
        bun_collections::index_sort::sort_slice_by(&mut deps_with_bins, |a, b| {
            let [a, b] = [a, b].map(|dep| {
                let dependency = &dependencies[dep.dep_id as usize];
                bin_real::LinkOrder::new(
                    is_direct(dependency.name_hash),
                    self.resolution(dep.entry_id).tag,
                    dependency.name.slice(string_buf),
                )
            });
            a.cmp(&b)
        });

        // The `.bin` of a store entry: `remove_planted_links_in`.
        if !deps_with_bins.is_empty() && is_importer {
            let path = &mut links.node_modules_path;
            let node_modules_len = path.len();
            let looked = PathLike::append(path, b".bin")
                .and_then(|()| crate::prune::remove_planted_link(&sys::Dir::cwd(), path.slice_z()));
            path.set_length(node_modules_len);
            looked.map_err(|err| TaskError::Binaries(err.into()))?;
        }

        for dep in deps_with_bins {
            let pkg_id = store.ids(dep.entry_id).pkg_id;
            let global = parent_entry_id == StoreEntryId::ROOT && self.manager().options.global;
            // A relink task: the package was installed before this run.
            let installed = self.tasks[dep.entry_id.get() as usize].relink == Relink::Off;
            if global && !self.manager().links_bins_globally(pkg_id, installed) {
                continue;
            }

            let alias = dependencies[dep.dep_id as usize].name.slice(string_buf);
            if let Err(err) = self.link_bins(&mut links, pkg_id, alias, global) {
                failed.push((dep.entry_id, err));
            }
        }

        if failed.is_empty() {
            return Ok(());
        }
        Err(TaskError::DependencyBinaries(failed.into_boxed_slice()))
    }

    fn bin_links(&self, entry_id: StoreEntryId) -> sys::Result<BinLinks> {
        let mut node_modules_path = DefaultAbsPath::init_top_level_dir();
        self.append_real_store_node_modules_path(&mut node_modules_path, entry_id, Which::Staging)?;
        let is_linked = (self.linked.iter()).any(|linked| linked.resolve(&mut node_modules_path));
        let is_behind_link = match self.resolution(entry_id).tag {
            ResolutionTag::Root => Some(is_linked),
            ResolutionTag::Workspace => None,
            _ => Some(false),
        };
        Ok(BinLinks {
            node_modules_path,
            is_behind_link,
            seen: StringHashMap::default(),
            abs_target_buf: paths::path_buffer_pool::get(),
            abs_dest_buf: paths::path_buffer_pool::get(),
            rel_buf: paths::path_buffer_pool::get(),
        })
    }

    /// Links the bins of `pkg_id`, which is `package_name` in `links.node_modules_path`.
    fn link_bins(
        &self,
        links: &mut BinLinks,
        pkg_id: PackageID,
        package_name: &[u8],
        global: bool,
    ) -> crate::Result<()> {
        let lockfile = self.lockfile();
        let package_name = strings::StringOrTinyString::init(package_name);

        let replacement = self
            .maybe_replace_node_modules_path(pkg_id)
            .map(|entry_id| {
                let mut path = DefaultAbsPath::init_top_level_dir();
                self.append_real_store_node_modules_path(&mut path, entry_id, Which::Final)?;
                if let Some(linked) = &self.linked {
                    linked.resolve(&mut path);
                }
                Ok::<_, sys::Error>((
                    path,
                    strings::StringOrTinyString::init(self.pkg_name(entry_id)),
                ))
            })
            .transpose()?;
        // A bin link to a replacement package points outside the workspace's `node_modules`. If
        // that directory is a symlink, the relative target has to start from its real path.
        if replacement.is_some() && links.is_behind_link != Some(false) {
            if let Some(linked) = LinkedNodeModules::at(links.node_modules_path.slice_z()) {
                linked.resolve(&mut links.node_modules_path);
                links.is_behind_link = Some(true);
            }
            links.is_behind_link.get_or_insert(false);
        }
        // Aliases `node_modules_path` without a replacement: the Linker field is a raw pointer.
        let (target_node_modules_path, target_package_name) = match &replacement {
            Some((path, name)) => (core::ptr::from_ref(path), *name),
            None => (&raw const links.node_modules_path, package_name),
        };
        let mut bin_linker = bin_real::Linker {
            bin: lockfile.packages.items_bin()[pkg_id as usize],
            global_bin_path: self.manager().options.bin_path,
            package_name,
            target_package_name,
            string_buf: lockfile.buffers.string_bytes.as_slice(),
            extern_string_buf: lockfile.buffers.extern_strings.as_slice(),
            seen: Some(&mut links.seen),
            target_node_modules_path,
            node_modules_path: &mut links.node_modules_path,
            abs_target_buf: &mut *links.abs_target_buf,
            abs_dest_buf: &mut *links.abs_dest_buf,
            rel_buf: &mut *links.rel_buf,
            is_behind_link: links.is_behind_link,
            err: None,
            skipped_due_to_missing_bin: false,
        };

        bin_linker.link(global);

        if replacement.is_some()
            && (bin_linker.skipped_due_to_missing_bin || bin_linker.err.is_some())
        {
            bin_linker.target_node_modules_path = bin_linker.node_modules_path;
            bin_linker.target_package_name = package_name;
            bin_linker.err = None;
            bin_linker.skipped_due_to_missing_bin = false;

            if self.manager().options.log_level.is_verbose() {
                bun_core::pretty_errorln!(
                    "<d>[Bin Linker]<r> {} -> {} retrying without native bin link",
                    bstr::BStr::new(package_name.slice()),
                    bstr::BStr::new(target_package_name.slice()),
                );
            }

            bin_linker.link(global);
        }

        links.is_behind_link = bin_linker.is_behind_link;
        bin_linker.err.map_or(Ok(()), Err)
    }

    /// True when this entry should live in the shared global virtual store
    /// instead of being materialized under the project's `node_modules/.bun/`.
    /// Root, workspace, folder, symlink, and patched packages always stay
    /// project-local because their contents are mutable / project-specific.
    pub(crate) fn entry_uses_global_store(&self, entry_id: StoreEntryId) -> bool {
        if self.global_store_path.is_none() {
            return false;
        }
        self.store.entries.items_entry_hash()[entry_id.get() as usize] != 0
    }

    /// Absolute path to the global virtual-store directory for `entry_id`:
    ///   <cache>/links/<storepath>-<entry_hash>
    /// (no trailing `/node_modules`). Pass `.staging` to get the per-process
    /// temp sibling that the build steps write into; the final `binaries`
    /// step renames staging → final.
    pub(crate) fn append_global_store_entry_path(
        &self,
        buf: &mut impl PathLike,
        entry_id: StoreEntryId,
        which: Which,
    ) -> sys::Result<()> {
        debug_assert!(self.entry_uses_global_store(entry_id));
        buf.clear();
        buf.append(self.global_store_path.as_ref().unwrap().as_bytes())?;
        match which {
            Which::Final => buf.append_fmt(format_args!(
                "{}",
                store::entry::fmt_global_store_path(entry_id, self.store, self.lockfile()),
            )),
            Which::Staging => buf.append_fmt(format_args!(
                "{}.tmp-{:x}",
                store::entry::fmt_global_store_path(entry_id, self.store, self.lockfile()),
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
    pub(crate) fn commit_global_store_entry(&self, entry_id: StoreEntryId) -> sys::Result<()> {
        if !self.entry_uses_global_store(entry_id) {
            return Ok(());
        }
        let mut staging = AutoAbsPath::init();
        self.append_global_store_entry_path(&mut staging, entry_id, Which::Staging)?;
        let mut final_ = AutoAbsPath::init();
        self.append_global_store_entry_path(&mut final_, entry_id, Which::Final)?;

        let mut retry = RenameRetry::new();
        let Err(err) = retry.rename(Fd::cwd(), staging.slice_z(), Fd::cwd(), final_.slice_z())
        else {
            return Ok(());
        };
        if !is_rename_collision(&err.err, final_.slice_z()) {
            let _ = Fd::cwd().delete_tree(staging.slice());
            return Err(global_store_publish_error(err, &final_));
        }
        if !self.manager().options.enable.force_install() {
            // A concurrent install renamed first; its content-addressed bytes are as good as ours.
            let _ = Fd::cwd().delete_tree(staging.slice());
            return Ok(());
        }

        // Under --force, the existing entry may be the corrupt one we were asked to replace.
        // Swap the two atomically where the file system supports it, because other projects may be
        // loading this entry right now.
        #[cfg(not(windows))]
        {
            let swapped = sys::renameat2(
                Fd::cwd(),
                staging.slice_z(),
                Fd::cwd(),
                final_.slice_z(),
                sys::RenameMode::Exchange,
            );
            if swapped.is_ok() {
                let _ = Fd::cwd().delete_tree(staging.slice());
                return Ok(());
            }
        }
        let mut old = AutoAbsPath::init();
        let fits = PathLike::append(
            &mut old,
            self.global_store_path.as_ref().unwrap().as_bytes(),
        )
        .and_then(|()| {
            PathLike::append_fmt(
                &mut old,
                format_args!(
                    "{}.old-{:x}",
                    store::entry::fmt_global_store_path(entry_id, self.store, self.lockfile()),
                    bun_core::fast_random(),
                ),
            )
        });
        if let Err(err) = fits {
            let _ = Fd::cwd().delete_tree(staging.slice());
            return Err(err);
        }
        if let Err(err) = retry.rename(Fd::cwd(), final_.slice_z(), Fd::cwd(), old.slice_z()) {
            let _ = Fd::cwd().delete_tree(staging.slice());
            return Err(global_store_publish_error(err, &final_));
        }
        let Err(err) = retry.rename(Fd::cwd(), staging.slice_z(), Fd::cwd(), final_.slice_z())
        else {
            let _ = Fd::cwd().delete_tree(old.slice());
            return Ok(());
        };
        // Another --force install raced us between swap-out and publish. Theirs is fresh too.
        let _ = Fd::cwd().delete_tree(staging.slice());
        let _ = Fd::cwd().delete_tree(old.slice());
        if is_rename_collision(&err.err, final_.slice_z()) {
            return Ok(());
        }
        Err(global_store_publish_error(err, &final_))
    }

    /// The `StagingPath` next to a project-local entry's package directory.
    /// `buf` must be relative to the project, like the package's path. An absolute staging path
    /// could exceed the path length limit when the package's relative path does not.
    fn append_local_staging_path(
        &self,
        buf: &mut impl PathLike,
        entry_id: StoreEntryId,
        mode: Staging,
    ) -> sys::Result<()> {
        debug_assert!(!self.entry_uses_global_store(entry_id) && mode != Staging::Off);
        self.append_local_store_entry_path(buf, entry_id)?;
        buf.append(b"node_modules")?;
        buf.append_fmt(format_args!(
            "{}",
            StagingPath(self.pkg_name(entry_id), mode),
        ))
    }

    /// Frees the final path, and the staging path of a dead install's rest. On an error, link in place.
    fn clear_local_store_package(
        &self,
        entry_id: StoreEntryId,
        mode: Staging,
        wait: bool,
    ) -> sys::Maybe<()> {
        let mut final_ = AutoPath::init();
        self.append_store_path(&mut final_, entry_id)?;
        let mut staging = AutoPath::init();
        self.append_local_staging_path(&mut staging, entry_id, mode)?;

        // A delete can be interrupted halfway, so rename the existing package away from its final
        // path first.
        let is_refused = |moved: &core::result::Result<(), RenameError>| {
            moved
                .as_ref()
                .is_err_and(|refused| refused.err.get_errno() != sys::Errno::ENOENT)
        };
        let mut retry = RenameRetry::new();
        let mut rename = |from: &ZStr, to: &ZStr| {
            if wait {
                retry.rename(Fd::cwd(), from, Fd::cwd(), to)
            } else {
                sys::renameat(Fd::cwd(), from, Fd::cwd(), to).map_err(RenameError::from)
            }
        };
        let mut moved = rename(final_.slice_z(), staging.slice_z());
        if is_refused(&moved) {
            let _ = Fd::cwd().delete_tree(staging.slice());
            moved = rename(final_.slice_z(), staging.slice_z());
        }
        if is_refused(&moved) {
            self.delete_local_store_package_in_place(entry_id);
            return moved.map_err(|refused| refused.err);
        }
        Fd::cwd().delete_tree(staging.slice())
    }

    /// Moves the package to its final path, which is what the next install checks before skipping
    /// it. Returns false if the caller should link in place instead.
    fn commit_local_store_package(&self, entry_id: StoreEntryId, mode: Staging) -> bool {
        let mut staging = AutoPath::init();
        let mut final_ = AutoPath::init();
        if self
            .append_local_staging_path(&mut staging, entry_id, mode)
            .and_then(|()| self.append_store_path(&mut final_, entry_id))
            .is_err()
        {
            return false;
        }

        if rename_staging_into_place(Fd::cwd(), staging.slice_z(), final_.slice_z()).is_ok() {
            return true;
        }
        let _ = Fd::cwd().delete_tree(staging.slice());
        false
    }

    /// Project-local path `node_modules/.bun/<storepath>` (the symlink that
    /// points at the global virtual-store entry). Relative to top-level dir.
    pub(crate) fn append_local_store_entry_path(
        &self,
        buf: &mut impl PathLike,
        entry_id: StoreEntryId,
    ) -> sys::Result<()> {
        buf.append_fmt(format_args!(
            "node_modules/.bun/{}",
            store::entry::fmt_store_path(entry_id, self.store, self.lockfile()),
        ))
    }

    /// Create the project-level symlink `node_modules/.bun/<storepath>` →
    /// `<cache>/links/<storepath>-<hash>`. This is the only per-install
    /// filesystem write for a warm global-store hit. A link that is already correct costs one
    /// `readlink` and no write. Returns true if the project had nothing at that path before.
    pub(crate) fn link_project_to_global_store(&self, entry_id: StoreEntryId) -> sys::Result<bool> {
        let mut dest = AutoPath::init_top_level_dir();
        self.append_local_store_entry_path(&mut dest, entry_id)?;

        let mut target_abs = AutoAbsPath::init();
        self.append_global_store_entry_path(&mut target_abs, entry_id, Which::Final)?;

        // Absolute target so the link is independent of where node_modules
        // lives (project root may itself be behind a symlink). Symlinker's
        // `target` field is RelPath-typed for the common in-tree case, so
        // call sys.symlink/symlinkOrJunction directly here.
        fn do_symlink(d: &ZStr, t: &ZStr) -> sys::Result<()> {
            #[cfg(windows)]
            {
                // `target_abs` is already absolute, so the junction fallback
                // can reuse it directly.
                return sys::symlink_or_junction(d, t, None);
            }
            #[cfg(not(windows))]
            {
                sys::symlink(t, d)
            }
        }

        // If this install created `node_modules/.bun`, there is no existing link to read.
        let mut is_new = self.is_new_bun_modules;
        let mut current = paths::path_buffer_pool::get();
        loop {
            if !is_new {
                match sys::readlink(dest.slice_z(), current.as_mut_slice()) {
                    // Keep a link that is already correct, so the package stays loadable during the
                    // install. libuv reports a junction's target with a trailing slash.
                    Ok(len)
                        if strings::without_trailing_slash(&current[..len])
                            == target_abs.slice() =>
                    {
                        return Ok(false);
                    }
                    // The link points to an entry with a different hash. Replace it atomically.
                    Ok(_) if cfg!(not(windows)) => {
                        let mut tmp = AutoPath::init_top_level_dir();
                        PathLike::append_fmt(
                            &mut tmp,
                            format_args!(
                                "node_modules/.bun/{}",
                                StagingPath(
                                    paths::basename(dest.slice()),
                                    Staging::Unlocked(self.global_store_tmp_suffix),
                                ),
                            ),
                        )?;
                        do_symlink(tmp.slice_z(), target_abs.slice_z())?;
                        let renamed =
                            sys::renameat(Fd::cwd(), tmp.slice_z(), Fd::cwd(), dest.slice_z());
                        if renamed.is_err() {
                            let _ = sys::unlink(tmp.slice_z());
                        }
                        return renamed.map(|()| false);
                    }
                    Ok(_) => {
                        if let Err(err) = remove_link(dest.slice_z())
                            && err.get_errno() != sys::Errno::ENOENT
                        {
                            return Err(err);
                        }
                    }
                    Err(err) => match err.get_errno() {
                        sys::Errno::ENOENT => is_new = true,
                        // `dest` is a real directory from an install without the global store.
                        // (`bun patch` detaches `node_modules/<pkg>`, not this path.)
                        sys::Errno::EINVAL => Fd::cwd().delete_tree(dest.slice())?,
                        _ => return Err(err),
                    },
                }
            }
            let Err(err) = do_symlink(dest.slice_z(), target_abs.slice_z()) else {
                return Ok(is_new);
            };
            match err.get_errno() {
                // Another install created the link in the meantime, so go back and read it.
                sys::Errno::EEXIST => is_new = false,
                sys::Errno::ENOENT => {
                    if let Some(parent) = dest.dirname() {
                        let _ = Fd::cwd().make_path(parent);
                    }
                    return do_symlink(dest.slice_z(), target_abs.slice_z()).map(|()| is_new);
                }
                _ => return Err(err),
            }
        }
    }

    pub(crate) fn append_store_node_modules_path(
        &self,
        buf: &mut impl PathLike,
        entry_id: StoreEntryId,
    ) -> sys::Result<()> {
        let pkg_res = self.resolution(entry_id);
        match pkg_res.tag {
            ResolutionTag::Root => {}
            ResolutionTag::Workspace => {
                append_workspace_path(buf, self.lockfile().str(pkg_res.workspace()))?;
            }
            _ => self.append_local_store_entry_path(buf, entry_id)?,
        }
        buf.append(b"node_modules")
    }

    /// Like `appendStoreNodeModulesPath`, but resolves to the *physical*
    /// location of the entry's `node_modules` directory: the global virtual
    /// store for global-eligible entries, or the project-local `.bun/` path
    /// otherwise. See `Which` for when to pass `.staging` vs `.final`.
    pub(crate) fn append_real_store_node_modules_path(
        &self,
        buf: &mut impl PathLike,
        entry_id: StoreEntryId,
        which: Which,
    ) -> sys::Result<()> {
        if self.entry_uses_global_store(entry_id) {
            self.append_global_store_entry_path(buf, entry_id, which)?;
            return buf.append(b"node_modules");
        }
        self.append_store_node_modules_path(buf, entry_id)
    }

    /// `appendStorePath` resolved to the entry's *physical* location. See
    /// `Which` for when to pass `.staging` vs `.final`.
    pub(crate) fn append_real_store_path(
        &self,
        buf: &mut impl PathLike,
        entry_id: StoreEntryId,
        which: Which,
    ) -> sys::Result<()> {
        if self.entry_uses_global_store(entry_id) {
            self.append_global_store_entry_path(buf, entry_id, which)?;
            buf.append(b"node_modules")?;
            return buf.append(self.pkg_name(entry_id));
        }
        self.append_store_path(buf, entry_id)
    }

    /// `check_link_entries` bounded the length. Normalized: a Windows junction resolves no `..`.
    fn link_target_path<'b>(&self, target: &[u8], buf: &'b mut paths::PathBuffer) -> &'b [u8] {
        let base: &[u8] = if crate::dependency::is_link_path(target) {
            bun_fs::FileSystem::instance().top_level_dir()
        } else {
            &self.manager().global_link_dir_path
        };
        debug_assert!(!base.is_empty());
        let len = paths::resolve_path::join_abs_string_buf::<paths::platform::Auto>(
            base,
            &mut buf[..],
            &[target],
        )
        .len();
        &buf[..len]
    }

    pub(crate) fn append_store_path(
        &self,
        buf: &mut impl PathLike,
        entry_id: StoreEntryId,
    ) -> sys::Result<()> {
        let pkg_res = self.resolution(entry_id);
        match pkg_res.tag {
            ResolutionTag::Workspace => {
                append_workspace_path(buf, self.lockfile().str(pkg_res.workspace()))
            }
            ResolutionTag::Symlink => {
                let mut join_buf = paths::path_buffer_pool::get();
                buf.clear();
                buf.append(
                    self.link_target_path(self.lockfile().str(pkg_res.symlink()), &mut join_buf),
                )
            }
            _ => {
                // `None`: the root. `buf` is already top_level_dir.
                let Some(name) = self.entry_store_node_modules_package_name(entry_id) else {
                    return Ok(());
                };
                self.append_local_store_entry_path(buf, entry_id)?;
                buf.append(b"node_modules")?;
                buf.append(name)
            }
        }
    }

    /// Returns `Ok(false)` if there's nothing to link, because the path leaves the package or the
    /// directory doesn't exist.
    fn append_nested_folder_path(
        &self,
        buf: &mut AutoAbsPath,
        entry_id: StoreEntryId,
        package_dir_name: &[u8],
        folder: &[u8],
    ) -> sys::Result<bool> {
        if bin_real::bin_target_escapes_package_dir(folder) {
            return Ok(false);
        }

        self.append_real_store_node_modules_path(buf, entry_id, Which::Staging)?;
        PathLike::append(buf, package_dir_name)?;
        // `folder` comes from a third-party manifest, so its length is unchecked.
        if buf.len() + 1 + folder.len() >= paths::MAX_PATH_BYTES {
            return Err(sys::Error::from_code(
                sys::Errno::ENAMETOOLONG,
                sys::Tag::fstatat,
            ));
        }
        buf.append_join(folder).assume_ok();

        match sys::directory_exists_at(Fd::cwd(), buf.slice_z()) {
            Ok(is_dir) => Ok(is_dir),
            Err(err) if err.get_errno() == sys::Errno::ENOTDIR => Ok(false),
            Err(err) => Err(err),
        }
    }

    /// The directory name for the entry store node_modules install
    /// folder.
    /// ./node_modules/.bun/jquery@3.7.1/node_modules/jquery
    ///                                               ^ this one
    /// Need to know this to avoid collisions with dependencies
    /// with the same name as the package.
    pub(crate) fn entry_store_node_modules_package_name(
        &self,
        entry_id: StoreEntryId,
    ) -> Option<&'a [u8]> {
        match self.resolution(entry_id).tag {
            ResolutionTag::Root | ResolutionTag::Workspace | ResolutionTag::Symlink => None,
            _ => Some(self.pkg_name(entry_id)),
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

struct BinLinks {
    node_modules_path: DefaultAbsPath,
    /// See `bin::Linker::is_behind_link`.
    is_behind_link: Option<bool>,
    seen: StringHashMap<()>,
    abs_target_buf: paths::path_buffer_pool::Guard,
    abs_dest_buf: paths::path_buffer_pool::Guard,
    rel_buf: paths::path_buffer_pool::Guard,
}

/// `buf` is the project's directory. Appends the path of a workspace. On Windows, the path of a
/// workspace outside the project is normalized, because the `..` in the path of a new link isn't
/// resolved there. Elsewhere the kernel resolves it, also when the project is behind a symlink.
fn append_workspace_path(buf: &mut impl PathLike, workspace_path: &[u8]) -> sys::Result<()> {
    if cfg!(not(windows)) || !crate::bin::path_climbs_out(workspace_path) {
        return buf.append(workspace_path);
    }
    let mut join_buf = paths::path_buffer_pool::get();
    let absolute = paths::resolve_path::join_abs_string_buf::<paths::platform::Auto>(
        bun_fs::FileSystem::instance().top_level_dir(),
        &mut join_buf[..],
        &[workspace_path],
    );
    buf.clear();
    buf.append(absolute)
}

fn append_dependency_link_name(
    dest: &mut AutoPath,
    dep_name: &[u8],
    entry_node_modules_name: Option<&[u8]>,
) -> sys::Result<()> {
    PathLike::append(dest, dep_name)?;
    if entry_node_modules_name.is_some_and(|name| strings::eql_long(dep_name, name, true)) {
        // It has the same name as the entry itself, so nest it one `node_modules` deeper to avoid
        // the collision.
        PathLike::append(dest, b"node_modules")?;
        PathLike::append(dest, dep_name)?;
    }
    Ok(())
}

/// The next install skips a project-local package that has this file. A discard deletes it first.
pub(crate) fn installed_marker<'b>(
    tag: ResolutionTag,
    patch_info: &PatchInfo,
    hash_buf: &'b mut install::BuntagHashBuf,
) -> &'b [u8] {
    match patch_info {
        // A folder is never patched.
        PatchInfo::Patch(patch) if tag.can_enqueue_install_task() => {
            install::buntaghashbuf_make(hash_buf, patch.contents_hash)
        }
        // A git repository needs no package.json.
        _ if tag.is_git() => BUN_TAG,
        _ => b"package.json",
    }
}

/// Returns whether `path` itself is a symlink (or a junction on Windows), or `None` if nothing
/// exists there.
pub(crate) fn is_link(path: &ZStr) -> Option<bool> {
    #[cfg(windows)]
    {
        sys::get_file_attributes(path).map(|a| a.is_reparse_point)
    }
    #[cfg(not(windows))]
    {
        sys::lstat(path)
            .ok()
            .map(|st| sys::posix::s_islnk(st.st_mode as u32))
    }
}

/// Removes a symlink; on Windows also a directory symlink or junction (dangling or not).
pub(crate) fn remove_link(path: &ZStr) -> sys::Result<()> {
    #[cfg(windows)]
    {
        if sys::rmdir(path).is_ok() {
            return Ok(());
        }
    }
    sys::unlink(path)
}

/// EACCES/EPERM: FUSE (e.g. Android SDCARD) does not support hardlinks.
/// Only the link itself can say that. A `mkdir` or the walk of the package fails with the same
/// errnos, and a copy does not avoid those.
fn needs_copy(hardlink_err: &sys::Error) -> bool {
    hardlink_err.syscall == sys::Tag::link
        && matches!(
            hardlink_err.get_errno(),
            sys::Errno::EXDEV | sys::Errno::EACCES | sys::Errno::EPERM
        )
}

fn os_path(path: &[paths::OSPathChar]) -> bun_core::fmt::FormatOSPath<'_> {
    bun_core::fmt::fmt_os_path(
        path,
        bun_core::fmt::PathFormatOptions {
            path_sep: bun_core::fmt::PathSep::Auto,
            escape_backslashes: false,
        },
    )
}

#[cold]
fn print_link_error(
    what: &str,
    err: &sys::Error,
    from: &dyn core::fmt::Display,
    to: &[paths::OSPathChar],
) {
    if PackageManager::verbose_install() {
        bun_core::pretty_errorln!(
            "<red><b>error<r><d>:<r>Failed to {}\n{}\n<d>From: {}<r>\n<d>  To: {}<r>\n<r>",
            what,
            err,
            from,
            os_path(to),
        );
        Output::flush();
    }
}

fn is_rename_collision(err: &sys::Error, final_: &ZStr) -> bool {
    match err.get_errno() {
        sys::Errno::EEXIST | sys::Errno::ENOTEMPTY => true,
        // Windows also returns ERROR_ACCESS_DENIED when a virus scanner has one of the staged files
        // open.
        sys::Errno::EPERM | sys::Errno::EACCES => cfg!(windows) && sys::exists_z(final_),
        _ => false,
    }
}

/// The caller only prints the errno, which doesn't mention that Bun retried for a while.
fn global_store_publish_error(err: RenameError, final_: &AutoAbsPath) -> sys::Error {
    if err.gave_up_after_ms.is_some() {
        bun_core::pretty_errorln!(
            "<r><red>error<r>: publishing {} to the global store failed: {}",
            bstr::BStr::new(final_.slice()),
            err,
        );
        Output::flush();
    }
    err.err
}
