use core::sync::atomic::{AtomicU8, Ordering};
use std::io::Write as _;

use bun_ast::Log;
use bun_collections::{ArrayHashMap, DynamicBitSet, StringHashMap};
use bun_core::{Environment, Global, Output};
use bun_core::{ZStr, strings};
use bun_paths::{self as paths, AbsPath, AutoAbsPath, AutoRelPath, Path, PathBuffer, RelPath};
use bun_sys::{self as sys, Fd};
use bun_threading::{Mutex, ThreadPool, UnboundedQueue, thread_pool};

use bun_semver::String as SemverString;
use bun_sys::{FdDirExt as _, FdExt as _};

use crate::bin_real;
use crate::lockfile::package;
use crate::lockfile_real::PackageIDSlice;
use crate::package_install::{self, Method as InstallMethod, Summary as InstallSummary};
use crate::package_manager_real::Command;
use crate::postinstall_optimizer;
use crate::postinstall_optimizer::PostinstallOptimizer;
use crate::resolution;
use crate::{
    self as install, Bin, DependencyID, Lockfile, PackageID, PackageManager, PackageNameHash,
    Resolution, TaskCallbackContext, TruncatedPackageNameHash, bin, invalid_dependency_id,
};
// Bring `items_<field>()` column accessors into scope for
// `MultiArrayList<Package>` / `Slice<Package>` (Zig: `.items(.field)`).
use super::file_cloner::FileCloner;
use super::file_copier::FileCopier;
use super::hardlinker::Hardlinker;
use super::store::{self, Store};
use super::store::{EntryColumns as _, NodeColumns as _};
use super::symlinker::{self, Symlinker};
use crate::bun_fs;
use crate::lockfile_real::package::{PackageColumns as _};
use crate::package_manager_real::directories;
use crate::package_manager_real::package_manager_options::Do;

/// Zig: `Resolution.Tag` — Rust can't nest a type inside a struct, so the
/// enum lives at module level in `crate::resolution`.
type ResolutionTag = resolution::Tag;

type Bitset = DynamicBitSet;
type Progress = crate::bun_progress::Progress;
type ProgressNode = crate::bun_progress::Node;

// ── Store id aliases (Zig: `Store.Entry.Id` / `Store.Node.Id`) ────────────
type StoreEntryId = store::entry::Id;
type StoreNodeId = store::node::Id;

// ── Path option presets ───────────────────────────────────────────────────
use paths::path_options::{AssumeOk as _, Kind as PathKind, PathSeparators};
/// `bun.Path(.{ .sep = .auto })`
type AutoPath = paths::Path<u8, { PathKind::ANY }, { PathSeparators::AUTO }>;
/// `bun.AbsPath(.{ .unit = .os, .sep = .auto })`
type OsAutoAbsPath = AbsPath<paths::OSPathChar, { PathSeparators::AUTO }>;
/// `bun.Path(.{ .unit = .os, .sep = .auto })`
type OsAutoPath = paths::Path<paths::OSPathChar, { PathKind::ANY }, { PathSeparators::AUTO }>;
/// `bun.AbsPath(.{})` — all-default options.
type DefaultAbsPath = AbsPath<u8>;
/// `node_modules/.bun` — Zig used `Store.modules_dir_name` in compile-time
/// concat; the Rust `MODULES_DIR_NAME` const is `&[u8]` and not usable in
/// `const_format::concatcp!`, so spell the literal.
const NODE_MODULES_BUN: &str = "node_modules/.bun";

bun_output::declare_scope!(IsolatedInstaller, hidden);
macro_rules! debug {
    ($($args:tt)*) => { bun_output::scoped_log!(IsolatedInstaller, $($args)*) };
}

pub struct Installer<'a> {
    pub trusted_dependencies_mutex: Mutex,
    /// Zig: `*Lockfile` — BACKREF. Raw pointer (not `&'a mut`) for the same
    /// reason as `manager`: `Task::run` executes concurrently on the thread
    /// pool and each task derefs this field; a `&'a mut` would assert
    /// exclusivity every concurrent task violates. Mutated only for
    /// `lockfile.trusted_dependencies` (under `trusted_dependencies_mutex`,
    /// narrowed via `addr_of_mut!`). Never null. Read via `lockfile()`.
    pub lockfile: *mut Lockfile,

    pub summary: InstallSummary, // = .{ .successfully_installed = .empty }
    pub installed: Bitset,
    pub install_node: Option<&'a mut ProgressNode>,
    /// Mirrors Zig's `?*Progress.Node`. Stored as `NonNull` (not `&mut`)
    /// because `PackageManager.scripts_node` already holds a raw pointer to the
    /// same stack local; materializing a second long-lived `&mut` here would
    /// invalidate that pointer's provenance under Stacked Borrows. Currently
    /// unread on the Rust side — kept for layout/port parity.
    pub scripts_node: Option<core::ptr::NonNull<ProgressNode>>,
    pub is_new_bun_modules: bool,

    /// Zig: `*PackageManager` — BACKREF. Raw pointer (not `&'a mut`) because
    /// `Task::run`/`Task::callback` execute concurrently on the thread pool
    /// and each derefs this field; a `&'a mut` here would assert exclusivity
    /// every concurrent task violates. Never null. Access via `manager()` /
    /// `manager_mut()` (main thread only for `_mut`).
    pub manager: *mut PackageManager,
    pub command_ctx: Command::Context<'a>,

    pub store: &'a Store,

    pub task_queue: UnboundedQueue<Task>, // intrusive via .next
    pub tasks: Box<[Task]>,

    /// Zig: `std.atomic.Value(PackageInstall.Method)`. Stable Rust has no
    /// generic atomic-enum, so store the `#[repr(u8)]` discriminant and
    /// round-trip via `Method::from_u8` at the load sites below.
    pub supported_backend: AtomicU8,

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
    // BACKREF accessors — `manager` points outside `Self`; see field doc.
    #[inline]
    pub fn manager(&self) -> &'a PackageManager {
        // SAFETY: BACKREF — never null; pointee outlives `'a`.
        unsafe { &*self.manager }
    }
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn manager_mut(&self) -> &'a mut PackageManager {
        // SAFETY: BACKREF — never null; disjoint from `*self`. Return is `'a`
        // (not elided) so `start_task` can hold it across `&mut self.tasks[i]`
        // — same field-disjoint shape the prior `&'a mut` field permitted.
        // Caller must be on the main thread (only main mutates
        // `PackageManager`; `Task::run` / `Task::callback` on the pool read
        // via the raw field, never this accessor). A
        // `debug_assert!(is_main_thread())` is deferred until
        // `bun_crash_handler::cli_state::set_main_thread_id` is actually
        // wired at startup — today the sentinel is never set, so the assert
        // would fire unconditionally.
        unsafe { &mut *self.manager }
    }
    #[inline]
    pub fn lockfile(&self) -> &'a Lockfile {
        // SAFETY: BACKREF — never null; pointee outlives `'a`. Never aliased by
        // a *whole-struct* `&mut Lockfile`; the single mutated field
        // (`trusted_dependencies`) is written under
        // `trusted_dependencies_mutex` via a raw narrowed `addr_of_mut!` place
        // (Task::run), not a `&mut Lockfile`. Callers must not project into
        // `trusted_dependencies` from this `&Lockfile` across a tick.
        unsafe { &*self.lockfile }
    }

    /// Called from main thread
    pub fn start_task(&mut self, entry_id: StoreEntryId) {
        let manager = self.manager_mut();
        let task = &mut self.tasks[entry_id.get() as usize];
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
        manager
            .thread_pool
            .schedule(thread_pool::Batch::from(&raw mut task.task));
    }

    pub fn on_package_extracted(&mut self, task_id: crate::package_manager_task::Id) {
        if let Some(removed) = self.manager_mut().task_queue.remove(&task_id) {
            let store = self.store;

            let node_pkg_ids = store.nodes.items_pkg_id();

            let entries = &store.entries;
            let entry_steps = entries.items_step();
            let entry_node_ids = entries.items_node_id();

            let pkgs = self.lockfile().packages.slice();
            let pkg_names = pkgs.items_name();
            let pkg_name_hashes = pkgs.items_name_hash();
            let pkg_resolutions = pkgs.items_resolution();

            for install_ctx in removed.as_slice() {
                // Zig: `install_ctx.isolated_package_install_context` (union field
                // access). Rust models `TaskCallbackContext` as an enum, so destructure.
                let &TaskCallbackContext::IsolatedPackageInstallContext(entry_id) = install_ctx
                else {
                    continue;
                };

                let node_id = entry_node_ids[entry_id.get() as usize];
                let pkg_id = node_pkg_ids[node_id.get() as usize];
                let pkg_name = pkg_names[pkg_id as usize];
                let pkg_name_hash = pkg_name_hashes[pkg_id as usize];
                let pkg_res = &pkg_resolutions[pkg_id as usize];

                let patch_info =
                    bun_core::handle_oom(self.package_patch_info(pkg_name, pkg_name_hash, pkg_res));

                if let PatchInfo::Patch(patch) = &patch_info {
                    let mut log = Log::init();
                    self.apply_package_patch(entry_id, &patch, &mut log);
                    if log.has_errors() {
                        // monotonic is okay because we haven't started the task yet (it isn't running
                        // on another thread)
                        entry_steps[entry_id.get() as usize]
                            .store(Step::Done as u32, Ordering::Relaxed);
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
        task_id: crate::package_manager_task::Id,
        name: &[u8],
        resolution: &Resolution,
        err: bun_core::Error,
        url: &[u8],
    ) {
        if let Some(removed) = self.manager_mut().task_queue.remove(&task_id) {
            let callbacks = removed;

            let entry_steps = self.store.entries.items_step();
            for install_ctx in callbacks.as_slice() {
                // Zig: `install_ctx.isolated_package_install_context` (union field
                // access). Rust models `TaskCallbackContext` as an enum, so destructure.
                let &TaskCallbackContext::IsolatedPackageInstallContext(entry_id) = install_ctx
                else {
                    continue;
                };
                entry_steps[entry_id.get() as usize].store(Step::Done as u32, Ordering::Relaxed);
                self.on_task_fail(
                    entry_id,
                    TaskError::Download(DownloadError {
                        err,
                        url: url.into(),
                    }),
                );
            }
            // callbacks dropped here
        } else {
            // No waiting entry — still surface the error so it isn't lost.
            let string_buf = self.lockfile().buffers.string_bytes.as_slice();
            Output::err_generic(
                "failed to download <b>{}@{}<r>: {}\n  <d>{}<r>",
                (
                    bstr::BStr::new(name),
                    resolution.fmt(string_buf, bun_core::fmt::PathSep::Auto),
                    bstr::BStr::new(download_error_reason(err)),
                    bstr::BStr::new(url),
                ),
            );
            Output::flush();
        }
    }

    pub fn apply_package_patch(
        &mut self,
        entry_id: StoreEntryId,
        patch: &PatchInfoPatch,
        log: &mut Log,
    ) {
        let store = self.store;
        let entry_node_ids = store.entries.items_node_id();
        let node_id = entry_node_ids[entry_id.get() as usize];
        let node_pkg_ids = store.nodes.items_pkg_id();
        let pkg_id = node_pkg_ids[node_id.get() as usize];
        let patch_task_ptr = install::PatchTask::new_apply_patch_hash(
            self.manager_mut(),
            pkg_id,
            patch.contents_hash,
            patch.name_and_version_hash,
        );
        // SAFETY: `new_apply_patch_hash` returns a freshly Box-allocated PatchTask;
        // sole ownership lives in this scope. Mirrors Zig `defer patch_task.deinit()`.
        struct PatchTaskGuard(*mut install::PatchTask);
        impl Drop for PatchTaskGuard {
            fn drop(&mut self) {
                // SAFETY: exclusive owner; created by `heap::alloc` in `new_*`.
                unsafe { install::PatchTask::destroy(self.0) };
            }
        }
        let _guard = PatchTaskGuard(patch_task_ptr);
        // SAFETY: exclusive owner — see above.
        let patch_task = unsafe { &mut *patch_task_ptr };
        bun_core::handle_oom(patch_task.apply());

        if let crate::patch_install::Callback::Apply(apply) = &mut patch_task.callback {
            if apply.logger.has_errors() {
                apply.logger.clone_to_with_recycled(log, true);
            }
        }
    }

    /// Called from main thread
    pub fn on_task_fail(&mut self, entry_id: StoreEntryId, err: TaskError) {
        let string_buf = self.lockfile().buffers.string_bytes.as_slice();

        let entries = &self.store.entries;
        let entry_node_ids = entries.items_node_id();

        let nodes = &self.store.nodes;
        let node_pkg_ids = nodes.items_pkg_id();

        let pkgs = self.lockfile().packages.slice();
        let pkg_names = pkgs.items_name();
        let pkg_resolutions = pkgs.items_resolution();

        let node_id = entry_node_ids[entry_id.get() as usize];
        let pkg_id = node_pkg_ids[node_id.get() as usize];

        let pkg_name = pkg_names[pkg_id as usize];
        let pkg_res = pkg_resolutions[pkg_id as usize];

        match &err {
            TaskError::LinkPackage(link_err) => {
                Output::err(
                    link_err.clone(),
                    "failed to link package: {}@{}",
                    (
                        bstr::BStr::new(pkg_name.slice(string_buf)),
                        pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Auto),
                    ),
                );
            }
            TaskError::SymlinkDependencies(symlink_err) => {
                Output::err(
                    symlink_err.clone(),
                    "failed to symlink dependencies for package: {}@{}",
                    (
                        bstr::BStr::new(pkg_name.slice(string_buf)),
                        pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Auto),
                    ),
                );
            }
            TaskError::Patching(patch_log) => {
                Output::err_generic(
                    "failed to patch package: {}@{}",
                    (
                        bstr::BStr::new(pkg_name.slice(string_buf)),
                        pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Auto),
                    ),
                );
                let _ = patch_log.print(std::ptr::from_mut(Output::error_writer()));
            }
            TaskError::Binaries(bin_err) => {
                Output::err(
                    *bin_err,
                    "failed to link binaries for package: {}@{}",
                    (
                        bstr::BStr::new(pkg_name.slice(string_buf)),
                        pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Auto),
                    ),
                );
            }
            TaskError::Download(dl) => {
                Output::err_generic(
                    "failed to download <b>{}@{}<r>: {}\n  <d>{}<r>",
                    (
                        bstr::BStr::new(pkg_name.slice(string_buf)),
                        pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Auto),
                        bstr::BStr::new(download_error_reason(dl.err)),
                        bstr::BStr::new(&dl.url),
                    ),
                );
            }
            _ => {}
        }
        Output::flush();

        // Clean up the staging directory so a half-built global-store entry
        // doesn't leak in the cache (it would never be reused — the suffix is
        // random — but it's wasted disk).
        if self.entry_uses_global_store(entry_id) {
            let mut staging = AutoAbsPath::init();
            self.append_global_store_entry_path(&mut staging, entry_id, Which::Staging);
            let _ = Fd::cwd().delete_tree(staging.slice());
        }

        // attempt deleting the package so the next install will install it again
        match pkg_res.tag {
            ResolutionTag::Uninitialized
            | ResolutionTag::SingleFileModule
            | ResolutionTag::Root
            | ResolutionTag::Workspace
            | ResolutionTag::Symlink => {}

            // to be safe make sure we only delete packages in the store
            ResolutionTag::Npm
            | ResolutionTag::Git
            | ResolutionTag::Github
            | ResolutionTag::LocalTarball
            | ResolutionTag::RemoteTarball
            | ResolutionTag::Folder => {
                let mut store_path = AutoRelPath::init();

                // OOM/capacity: Zig aborts; port keeps fire-and-forget
                let _ = store_path.append_fmt(format_args!(
                    "node_modules/{}",
                    store::entry::fmt_store_path(entry_id, self.store, self.lockfile()),
                ));

                let _ = sys::unlink(store_path.slice_z());
            }

            _ => {}
        }

        if self.manager().options.enable.fail_early() {
            Global::exit(1);
        }

        self.summary.fail += 1;

        self.decrement_pending_tasks();
        self.resume_unblocked_tasks();
    }

    pub fn decrement_pending_tasks(&mut self) {
        self.manager_mut().decrement_pending_tasks();
    }

    /// Called from main thread
    pub fn on_task_blocked(&mut self, entry_id: StoreEntryId) {
        // race condition (fixed now): task decides it is blocked because one of its dependencies
        // has not finished. before the task can mark itself as blocked, the dependency finishes its
        // install, causing the task to never finish because resumeUnblockedTasks is called before
        // its state is set to blocked.
        //
        // fix: check if the task is unblocked after the task returns blocked, and only set/unset
        // blocked from the main thread.

        let mut parent_dedupe: ArrayHashMap<StoreEntryId, ()> = ArrayHashMap::default();

        if !self.is_task_blocked(entry_id, &mut parent_dedupe) {
            // .monotonic is okay because the task isn't running right now.
            self.store.entries.items_step()[entry_id.get() as usize]
                .store(Step::SymlinkDependencyBinaries as u32, Ordering::Relaxed);
            self.start_task(entry_id);
            return;
        }

        // .monotonic is okay because the task isn't running right now.
        self.store.entries.items_step()[entry_id.get() as usize]
            .store(Step::Blocked as u32, Ordering::Relaxed);
    }

    /// Called from both the main thread (via `onTaskBlocked` and `resumeUnblockedTasks`) and the
    /// task thread (via `run`). `parent_dedupe` should not be shared between threads.
    fn is_task_blocked(
        &self,
        entry_id: StoreEntryId,
        parent_dedupe: &mut ArrayHashMap<StoreEntryId, ()>,
    ) -> bool {
        let entries = &self.store.entries;
        let entry_deps = entries.items_dependencies();
        let entry_steps = entries.items_step();

        let deps = &entry_deps[entry_id.get() as usize];
        for dep in deps.slice() {
            if entry_steps[dep.entry_id.get() as usize].load(Ordering::Acquire) != Step::Done as u32
            {
                parent_dedupe.clear_retaining_capacity();
                if self.store.is_cycle(entry_id, dep.entry_id, parent_dedupe) {
                    continue;
                }
                return true;
            }
        }
        false
    }

    /// Called from main thread
    pub fn on_task_complete(&mut self, entry_id: StoreEntryId, state: CompleteState) {
        if Environment::CI_ASSERT {
            // .monotonic is okay because we should have already synchronized with the completed
            // task thread by virtue of popping from the `UnboundedQueue`.
            bun_core::assert_with_location(
                self.store.entries.items_step()[entry_id.get() as usize].load(Ordering::Relaxed)
                    == Step::Done as u32,
                core::panic::Location::caller(),
            );
        }

        self.decrement_pending_tasks();
        self.resume_unblocked_tasks();

        if let Some(node) = self.install_node.as_mut() {
            node.complete_one();
        }

        let nodes = &self.store.nodes;

        let (node_id, real_state) = 'state: {
            if entry_id == StoreEntryId::ROOT {
                break 'state (StoreNodeId::ROOT, CompleteState::Skipped);
            }

            let node_id = self.store.entries.items_node_id()[entry_id.get() as usize];
            let dep_id = nodes.items_dep_id()[node_id.get() as usize];

            if dep_id == invalid_dependency_id {
                // should be coverd by `entry_id == .root` above, but
                // just in case
                break 'state (StoreNodeId::ROOT, CompleteState::Skipped);
            }

            let dep = &self.lockfile().buffers.dependencies[dep_id as usize];

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

        let pkg_id = nodes.items_pkg_id()[node_id.get() as usize];

        let is_duplicate = self.installed.is_set(pkg_id as usize);
        self.summary.success += (!is_duplicate) as u32;
        self.installed.set(pkg_id as usize);
    }

    // This function runs only on the main thread. The installer tasks threads
    // will be changing values in `entry_step`, but the blocked state is only
    // set on the main thread, allowing the code between
    // `entry_steps[entry_id.get() as usize].load(.monotonic)`
    // and
    // `entry_steps[entry_id.get() as usize].store(.symlink_dependency_binaries, .monotonic)`
    pub fn resume_unblocked_tasks(&mut self) {
        let entries = &self.store.entries;
        let entry_steps = entries.items_step();

        let mut parent_dedupe: ArrayHashMap<StoreEntryId, ()> = ArrayHashMap::default();

        for id_int in 0..self.store.entries.len() {
            let entry_id = StoreEntryId::from(u32::try_from(id_int).expect("int cast"));

            // .monotonic is okay because only the main thread sets this to `.blocked`.
            let entry_step = entry_steps[entry_id.get() as usize].load(Ordering::Relaxed);
            if entry_step != Step::Blocked as u32 {
                continue;
            }

            if self.is_task_blocked(entry_id, &mut parent_dedupe) {
                continue;
            }

            // .monotonic is okay because the task isn't running right now.
            entry_steps[entry_id.get() as usize]
                .store(Step::SymlinkDependencyBinaries as u32, Ordering::Relaxed);
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
    pub entry_id: StoreEntryId,
    /// BACKREF: `Installer` owns `tasks[]` and outlives every `Task`. Stored as
    /// `BackRef` so worker-thread read sites use safe `Deref`/`get()` instead of
    /// per-site raw-pointer derefs. Constructed with a `NonNull::dangling()`
    /// placeholder (never dereferenced) and patched to the real address before
    /// any `start_task` call — see `isolated_install.rs`.
    pub installer: bun_ptr::BackRef<Installer<'static>>,

    pub task: thread_pool::Task,
    pub next: bun_threading::Link<Task>, // INTRUSIVE: bun.UnboundedQueue(Task, .next) link

    pub result: Result,
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
    RunScripts(*mut package::scripts::List), // TODO(port): LIFETIMES.tsv=BORROW_FIELD &'a mut package::scripts::List — kept raw for borrowck (owned by store.entries.items(.scripts)[entry_id])
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
            TaskError::Patching(_log) => {
                // TODO(port): `bun_ast::Log` is non-Clone; the only caller of
                // `TaskError::clone()` is `Yield::failure` which never receives a
                // `Patching` payload (Patching is only constructed on the main
                // thread via `on_package_extracted`, never passed through the
                // task-thread `Yield::Fail` path). Preserve a fresh Log so we
                // don't UAF a borrowed one.
                TaskError::Patching(Log::init())
            }
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

impl From<Step> for &'static str {
    /// Zig `@tagName(step)`.
    fn from(s: Step) -> &'static str {
        match s {
            Step::LinkPackage => "link_package",
            Step::SymlinkDependencies => "symlink_dependencies",
            Step::CheckIfBlocked => "check_if_blocked",
            Step::SymlinkDependencyBinaries => "symlink_dependency_binaries",
            Step::RunPreinstall => "run_preinstall",
            Step::Binaries => "binaries",
            Step::RunPostInstallAndPrePostPrepare => "run (post)install and (pre/post)prepare",
            Step::Done => "done",
            Step::Blocked => "blocked",
        }
    }
}

impl Step {
    /// Decode the `AtomicU32` column repr back into a `Step`. The column is
    /// only ever stored via `Step::* as u32` (this file) so the value is
    /// always a valid discriminant.
    #[inline]
    pub const fn from_u32(raw: u32) -> Step {
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

pub enum Yield {
    Yield,
    RunScripts(*mut package::scripts::List), // TODO(port): LIFETIMES.tsv=BORROW_PARAM &'a mut package::scripts::List — kept raw for borrowck (borrow of entry_scripts)
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
        let store: &Store = unsafe { *core::ptr::addr_of!((*self.installer.as_ptr()).store) };
        store.entries.items_step()[self.entry_id.get() as usize]
            .store(next_step as u32, Ordering::Release);

        next_step
    }

    /// Called from task thread
    fn run(&mut self) -> core::result::Result<Yield, bun_alloc::AllocError> {
        // SAFETY: installer outlives all tasks (BACKREF). `run()` executes on the
        // thread pool concurrently across many `Task`s that all share the same
        // `*mut Installer`, and `next_step()` re-derefs `self.installer` mid-loop —
        // materializing `&mut Installer` here would alias both (Zig's `*Installer`
        // is freely shared). Instead:
        //   * `installer` is a shared `&Installer`; every Installer method called
        //     below takes `&self`.
        //   * `manager_ptr` / `lockfile_ptr` are reached by raw-reading their
        //     pointer fields. They point to allocations *outside* `Installer`, so
        //     they do not overlap `installer`. They stay RAW for the whole body —
        //     binding a function-scoped `&mut PackageManager` / `&mut Lockfile`
        //     here would mean every concurrent task thread holds an aliased
        //     `&mut` to the same object (UB regardless of mutex discipline; Zig's
        //     `*PackageManager` / `*Lockfile` carry no exclusivity contract).
        //     Per-site reborrows below are `&*manager_ptr` for read-only access,
        //     and mutation is narrowed via `addr_of_mut!` to the single field
        //     being written while `trusted_dependencies_mutex` is held.
        //   * Never access `installer.manager.*` / mutate `installer.lockfile.*`
        //     while these locals are live — that would reborrow through
        //     `&Installer` and alias `*manager_ptr` / `*lockfile_ptr`.
        let installer_ptr = self.installer;
        let installer = installer_ptr.get();
        let manager_ptr: *mut PackageManager = installer.manager;
        let lockfile_ptr: *mut Lockfile = installer.lockfile;
        // BACKREF — `manager_ptr` is non-null and the `PackageManager` outlives
        // every `Task` (see top-of-fn note). Wrapped once as `ParentRef` so the
        // read-only deref sites below go through safe `Deref`/`get()` instead
        // of per-site `unsafe { &* }`. Mutation and narrowed `addr_of_mut!`
        // field projections still go through the raw `manager_ptr` directly
        // (same provenance tag as `manager_ref.ptr`). Safe `From<NonNull>`
        // construction — non-null is guaranteed by the BACKREF field invariant.
        let manager_ref = bun_ptr::ParentRef::<PackageManager>::from(
            core::ptr::NonNull::new(manager_ptr).expect("Installer.manager BACKREF is non-null"),
        );
        // Read-only `&Lockfile` via the BACKREF accessor (centralised deref);
        // same provenance as `&*lockfile_ptr`. `lockfile_ptr` itself is kept
        // raw for the narrowed `addr_of_mut!((*lockfile_ptr).trusted_dependencies)`
        // write under `trusted_dependencies_mutex` below.
        let lockfile: &Lockfile = installer.lockfile();

        let pkgs = lockfile.packages.slice();
        let pkg_names = pkgs.items_name();
        let pkg_name_hashes = pkgs.items_name_hash();
        let pkg_resolutions = pkgs.items_resolution();
        let pkg_resolutions_lists = pkgs.items_resolutions();
        let pkg_metas: &[package::Meta] = pkgs.items_meta();
        let pkg_bins = pkgs.items_bin();
        let pkg_script_lists = pkgs.items_scripts();

        let entries = &installer.store.entries;
        let entry_node_ids = entries.items_node_id();
        let entry_dependencies = entries.items_dependencies();
        let entry_steps = entries.items_step();
        let entry_scripts = entries.items_scripts();
        let entry_hoisted = entries.items_hoisted();

        let nodes = &installer.store.nodes;
        let node_pkg_ids = nodes.items_pkg_id();
        let node_dep_ids = nodes.items_dep_id();

        let node_id = entry_node_ids[self.entry_id.get() as usize];
        let pkg_id = node_pkg_ids[node_id.get() as usize];
        let dep_id = node_dep_ids[node_id.get() as usize];

        let pkg_name = pkg_names[pkg_id as usize];
        let pkg_name_hash = pkg_name_hashes[pkg_id as usize];
        let pkg_res = pkg_resolutions[pkg_id as usize];

        // TODO(port): Zig labeled-switch `next_step:` modeled as loop+match
        let mut step =
            Step::from_u32(entry_steps[self.entry_id.get() as usize].load(Ordering::Acquire));
        'step: loop {
            match step {
                Step::LinkPackage => {
                    let current_step = Step::LinkPackage;
                    let string_buf = lockfile.buffers.string_bytes.as_slice();

                    // Compute pkg_cache_dir_subpath; for .folder/.root the work happens inline and
                    // we `continue` to next step from inside the match.
                    let pkg_cache_dir_subpath_init = match pkg_res.tag {
                        ResolutionTag::Folder | ResolutionTag::Root => {
                            let path: &[u8] = match pkg_res.tag {
                                ResolutionTag::Folder => pkg_res.folder().slice(string_buf),
                                ResolutionTag::Root => b".",
                                _ => unreachable!(),
                            };
                            // the folder does not exist in the cache. xdev is per folder dependency
                            let folder_dir = match bun_sys::open_dir_for_iteration(Fd::cwd(), path)
                            {
                                sys::Result::Ok(fd) => fd,
                                sys::Result::Err(err) => {
                                    return Ok(Yield::failure(TaskError::LinkPackage(err)));
                                }
                            };
                            let _folder_dir_guard = sys::CloseOnDrop::new(folder_dir);

                            // TODO(port): Zig labeled-switch `backend:` modeled as loop+match
                            let mut backend = InstallMethod::Hardlink;
                            'backend: loop {
                                match backend {
                                    InstallMethod::Hardlink => {
                                        let mut src = OsAutoAbsPath::init_top_level_dir_long_path();
                                        if pkg_res.tag == ResolutionTag::Folder {
                                            let _ =
                                                src.append_join(pkg_res.folder().slice(string_buf));
                                        }

                                        let mut dest = OsAutoPath::init();
                                        installer.append_store_path(&mut dest, self.entry_id);

                                        let mut hardlinker = Hardlinker::init(
                                            folder_dir,
                                            src,
                                            dest,
                                            &[bun_paths::os_path_literal!("node_modules")],
                                        )?;

                                        match hardlinker.link()? {
                                            sys::Result::Ok(()) => {}
                                            sys::Result::Err(err) => {
                                                if err.get_errno() == sys::Errno::EXDEV {
                                                    backend = InstallMethod::Copyfile;
                                                    continue 'backend;
                                                }

                                                if PackageManager::verbose_install() {
                                                    Output::pretty_errorln(format_args!(
                                                        "<red><b>error<r><d>:<r>Failed to hardlink package folder\n{}\n<d>From: {}<r>\n<d>  To: {}<r>\n<r>",
                                                        err,
                                                        bun_core::fmt::fmt_os_path(
                                                            hardlinker.src.slice(),
                                                            bun_core::fmt::PathFormatOptions {
                                                                path_sep:
                                                                    bun_core::fmt::PathSep::Auto,
                                                                escape_backslashes: false
                                                            }
                                                        ),
                                                        bun_core::fmt::fmt_os_path(
                                                            hardlinker.dest.slice(),
                                                            bun_core::fmt::PathFormatOptions {
                                                                path_sep:
                                                                    bun_core::fmt::PathSep::Auto,
                                                                escape_backslashes: false
                                                            }
                                                        ),
                                                    ));
                                                    Output::flush();
                                                }
                                                return Ok(Yield::failure(TaskError::LinkPackage(
                                                    err,
                                                )));
                                            }
                                        }
                                        break 'backend;
                                    }

                                    InstallMethod::Copyfile => {
                                        let mut src_path = OsAutoAbsPath::init();

                                        #[cfg(windows)]
                                        {
                                            // Hoist a single `&mut [u16]` borrow so the raw pointer
                                            // and length come from the SAME reborrow — calling
                                            // `src_path.buf()` twice in the FFI arg list would take
                                            // a fresh `&mut` for the len, invalidating the `*mut u16`
                                            // derived from the first call under Stacked Borrows.
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

                                            if src_path_len == 0 || src_path_len as usize >= cap {
                                                use bun_sys::windows::Win32ErrorExt as _;
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
                                                        syscall: sys::Tag::copyfile,
                                                        ..Default::default()
                                                    },
                                                )));
                                            }

                                            src_path.set_length(src_path_len as usize);
                                        }

                                        let mut dest = OsAutoPath::init();
                                        installer.append_store_path(&mut dest, self.entry_id);

                                        let mut file_copier = FileCopier::init(
                                            folder_dir,
                                            src_path.into_sep::<{ PathSeparators::AUTO }>(),
                                            dest.into_sep::<{ PathSeparators::AUTO }>(),
                                            &[bun_paths::os_path_literal!("node_modules")],
                                        )?;

                                        match file_copier.copy() {
                                            sys::Result::Ok(()) => {}
                                            sys::Result::Err(err) => {
                                                if PackageManager::verbose_install() {
                                                    Output::pretty_errorln(format_args!(
                                                        "<red><b>error<r><d>:<r>Failed to copy package\n{}\n<d>From: {}<r>\n<d>  To: {}<r>\n<r>",
                                                        err,
                                                        bun_core::fmt::fmt_os_path(
                                                            file_copier.src_path.slice(),
                                                            bun_core::fmt::PathFormatOptions {
                                                                path_sep:
                                                                    bun_core::fmt::PathSep::Auto,
                                                                escape_backslashes: false
                                                            }
                                                        ),
                                                        bun_core::fmt::fmt_os_path(
                                                            file_copier.dest_subpath.slice(),
                                                            bun_core::fmt::PathFormatOptions {
                                                                path_sep:
                                                                    bun_core::fmt::PathSep::Auto,
                                                                escape_backslashes: false
                                                            }
                                                        ),
                                                    ));
                                                    Output::flush();
                                                }
                                                return Ok(Yield::failure(TaskError::LinkPackage(
                                                    err,
                                                )));
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

                            let manager = manager_ref.get();
                            // SAFETY: `tag` discriminates the active `Resolution.value` variant
                            // for each arm below.
                            match tag {
                                ResolutionTag::Npm => directories::cached_npm_package_folder_name(
                                    manager,
                                    pkg_name.slice(string_buf),
                                    pkg_res.npm().version,
                                    patch_info.contents_hash(),
                                ),
                                ResolutionTag::Git => directories::cached_git_folder_name(
                                    manager,
                                    pkg_res.git(),
                                    patch_info.contents_hash(),
                                ),
                                ResolutionTag::Github => directories::cached_github_folder_name(
                                    manager,
                                    pkg_res.github(),
                                    patch_info.contents_hash(),
                                ),
                                ResolutionTag::LocalTarball => {
                                    directories::cached_tarball_folder_name(
                                        manager,
                                        *pkg_res.local_tarball(),
                                        patch_info.contents_hash(),
                                    )
                                }
                                ResolutionTag::RemoteTarball => {
                                    directories::cached_tarball_folder_name(
                                        manager,
                                        *pkg_res.remote_tarball(),
                                        patch_info.contents_hash(),
                                    )
                                }

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
                    let mut pkg_cache_dir_subpath =
                        AutoRelPath::from(pkg_cache_dir_subpath_init).assume_ok();

                    // SAFETY: idempotent cache-dir initialization (once-init internally).
                    // Scoped tightly so the `&mut PackageManager` does not outlive this
                    // statement; no `&*manager_ptr` is live on this thread across it.
                    // Concurrent task threads may race the same once-init path — that
                    // is a data-level race the once-init guards, not an aliasing
                    // violation here because no long-lived `&mut PackageManager` exists.
                    let (cache_dir, cache_dir_path) =
                        directories::get_cache_directory_and_abs_path(unsafe { &mut *manager_ptr });

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
                        let mut local = AutoPath::init_top_level_dir();
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
                                if let Some(st) = sys::lstat(local.slice_z()).ok() {
                                    sys::posix::s_islnk(
                                        u32::try_from(st.st_mode).expect("int cast"),
                                    )
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
                                        if let Some(_e) = sys::rmdir(local.slice_z()).err() {
                                            if let Some(e) = sys::unlink(local.slice_z()).err() {
                                                break 'win Some(e);
                                            }
                                        }
                                        break 'win None;
                                    }
                                }
                                #[cfg(not(windows))]
                                {
                                    sys::unlink(local.slice_z()).err()
                                }
                            };
                            if let Some(e) = remove_err {
                                if e.get_errno() != sys::Errno::ENOENT {
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
                        let mut staging = AutoAbsPath::init();
                        installer.append_global_store_entry_path(
                            &mut staging,
                            self.entry_id,
                            Which::Staging,
                        );
                        let _ = Fd::cwd().delete_tree(staging.slice());
                    }

                    // PORT NOTE: reshaped for borrowck — `defer if (cached_package_dir) |d| d.close()`
                    // becomes a guard that *owns* the `Option<Fd>` so the loop body can reassign
                    // through `*cached_package_dir` without an outstanding closure borrow.
                    let mut cached_package_dir = scopeguard::guard(None::<Fd>, |dir| {
                        if let Some(d) = dir {
                            d.close();
                        }
                    });

                    // .monotonic access of `supported_backend` is okay because it's an
                    // optimization. It's okay if another thread doesn't see an update to this
                    // value "in time".
                    let mut backend =
                        InstallMethod::from_u8(installer.supported_backend.load(Ordering::Relaxed));
                    'backend: loop {
                        // PORT NOTE: reshaped for borrowck — Zig builds `dest_subpath` once
                        // before the labeled-switch and passes it by-value (struct copy)
                        // into each backend's helper. Rust moves it, so rebuild per
                        // iteration; this only re-runs once on an EXDEV/OPNOTSUPP retry.
                        let mut dest_subpath = OsAutoPath::init();
                        installer.append_real_store_path(
                            &mut dest_subpath,
                            self.entry_id,
                            Which::Staging,
                        );
                        match backend {
                            InstallMethod::Clonefile => {
                                #[cfg(not(target_os = "macos"))]
                                {
                                    installer
                                        .supported_backend
                                        .store(InstallMethod::Hardlink as u8, Ordering::Relaxed);
                                    backend = InstallMethod::Hardlink;
                                    continue 'backend;
                                }
                                #[cfg(target_os = "macos")]
                                {
                                    if manager_ref.options.log_level.is_verbose() {
                                        Output::pretty_errorln(format_args!(
                                            "Cloning {} to {}",
                                            bun_core::fmt::fmt_os_path(
                                                pkg_cache_dir_subpath.slice_z(),
                                                bun_core::fmt::PathFormatOptions {
                                                    path_sep: bun_core::fmt::PathSep::Auto,
                                                    ..Default::default()
                                                },
                                            ),
                                            bun_core::fmt::fmt_os_path(
                                                dest_subpath.slice_z(),
                                                bun_core::fmt::PathFormatOptions {
                                                    path_sep: bun_core::fmt::PathSep::Auto,
                                                    ..Default::default()
                                                },
                                            ),
                                        ));
                                        Output::flush();
                                    }

                                    let mut cloner = FileCloner {
                                        cache_dir,
                                        cache_dir_subpath: &mut pkg_cache_dir_subpath,
                                        dest_subpath,
                                    };

                                    match cloner.clone() {
                                        sys::Result::Ok(()) => {}
                                        sys::Result::Err(err) => match err.get_errno() {
                                            sys::Errno::EXDEV => {
                                                installer.supported_backend.store(
                                                    InstallMethod::Copyfile as u8,
                                                    Ordering::Relaxed,
                                                );
                                                backend = InstallMethod::Copyfile;
                                                continue 'backend;
                                            }
                                            sys::Errno::EOPNOTSUPP => {
                                                installer.supported_backend.store(
                                                    InstallMethod::Hardlink as u8,
                                                    Ordering::Relaxed,
                                                );
                                                backend = InstallMethod::Hardlink;
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
                                    continue 'step;
                                }
                            }

                            InstallMethod::Hardlink => {
                                *cached_package_dir = match bun_sys::open_dir_for_iteration(
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

                                let mut src = OsAutoAbsPath::from_long_path(cache_dir_path.slice())
                                    .assume_ok();
                                let _ = src.append_join(pkg_cache_dir_subpath.slice()); // OOM/capacity: Zig aborts; port keeps fire-and-forget

                                let mut hardlinker = Hardlinker::init(
                                    cached_package_dir.unwrap(),
                                    src,
                                    dest_subpath,
                                    &[],
                                )?;

                                match hardlinker.link()? {
                                    sys::Result::Ok(()) => {}
                                    sys::Result::Err(err) => {
                                        if err.get_errno() == sys::Errno::EXDEV {
                                            installer.supported_backend.store(
                                                InstallMethod::Copyfile as u8,
                                                Ordering::Relaxed,
                                            );
                                            backend = InstallMethod::Copyfile;
                                            continue 'backend;
                                        }
                                        if PackageManager::verbose_install() {
                                            Output::pretty_errorln(format_args!(
                                                "<red><b>error<r><d>:<r>Failed to hardlink package\n{}\n<d>From: {}<r>\n<d>  To: {}<r>\n<r>",
                                                err,
                                                bstr::BStr::new(pkg_cache_dir_subpath.slice()),
                                                bun_core::fmt::fmt_os_path(
                                                    hardlinker.dest.slice(),
                                                    bun_core::fmt::PathFormatOptions {
                                                        path_sep: bun_core::fmt::PathSep::Auto,
                                                        escape_backslashes: false
                                                    }
                                                ),
                                            ));
                                            Output::flush();
                                        }
                                        return Ok(Yield::failure(TaskError::LinkPackage(err)));
                                    }
                                }

                                step = self.next_step(current_step);
                                continue 'step;
                            }

                            // fallthrough copyfile
                            _ => {
                                *cached_package_dir = match bun_sys::open_dir_for_iteration(
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
                                                bun_core::fmt::fmt_os_path(
                                                    (&dest_subpath).slice(),
                                                    bun_core::fmt::PathFormatOptions {
                                                        path_sep: bun_core::fmt::PathSep::Auto,
                                                        escape_backslashes: false
                                                    }
                                                ),
                                            ));
                                            Output::flush();
                                        }
                                        return Ok(Yield::failure(TaskError::LinkPackage(err)));
                                    }
                                };

                                let mut src_path =
                                    OsAutoAbsPath::from(cache_dir_path.slice()).assume_ok();
                                let _ = src_path.append(pkg_cache_dir_subpath.slice()); // OOM/capacity: Zig aborts; port keeps fire-and-forget

                                let mut file_copier = FileCopier::init(
                                    cached_package_dir.unwrap(),
                                    src_path.into_sep::<{ PathSeparators::AUTO }>(),
                                    dest_subpath.into_sep::<{ PathSeparators::AUTO }>(),
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
                                                bun_core::fmt::fmt_os_path(
                                                    file_copier.dest_subpath.slice(),
                                                    bun_core::fmt::PathFormatOptions {
                                                        path_sep: bun_core::fmt::PathSep::Auto,
                                                        escape_backslashes: false
                                                    }
                                                ),
                                            ));
                                            Output::flush();
                                        }
                                        return Ok(Yield::failure(TaskError::LinkPackage(err)));
                                    }
                                }

                                step = self.next_step(current_step);
                                continue 'step;
                            }
                        }
                    }
                    // unreachable: every backend arm continues to next_step or returns
                }

                Step::SymlinkDependencies => {
                    let current_step = Step::SymlinkDependencies;
                    let string_buf = lockfile.buffers.string_bytes.as_slice();
                    let dependencies = lockfile.buffers.dependencies.as_slice();

                    for dep in entry_dependencies[self.entry_id.get() as usize].slice() {
                        let dep_name = dependencies[dep.dep_id as usize].name.slice(string_buf);

                        let mut dest = AutoPath::init_top_level_dir();

                        installer.append_real_store_node_modules_path(
                            &mut dest,
                            self.entry_id,
                            Which::Staging,
                        );

                        let _ = dest.append(dep_name); // OOM/capacity: Zig aborts; port keeps fire-and-forget

                        if let Some(entry_node_modules_name) = installer
                            .entry_store_node_modules_package_name(
                                dep_id, pkg_id, &pkg_res, pkg_names,
                            )
                        {
                            if strings::eql_long(dep_name, entry_node_modules_name, true) {
                                // nest the dependency in another node_modules if the name is the same as the entry name
                                // in the store node_modules to avoid collision
                                let _ = dest.append(b"node_modules"); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                                let _ = dest.append(dep_name); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                            }
                        }

                        let mut dep_store_path = AutoAbsPath::init_top_level_dir();

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

                        // PORT NOTE: reshaped for borrowck — Zig's
                        // `const dest_save = dest.save(); defer dest_save.restore();`
                        // can't coexist with `dest.undo()/dest.relative()` because
                        // the `ResetScope` guard holds `&mut dest`. Capture the
                        // length and restore manually.
                        let dest_saved_len = dest.len();
                        let target = {
                            dest.undo(1);
                            dest.relative(&dep_store_path)
                        };
                        dest.set_length(dest_saved_len);

                        let mut symlinker = Symlinker {
                            dest: dest.into_sep::<{ PathSeparators::ANY }>(),
                            target: target.into_sep::<{ PathSeparators::ANY }>(),
                            fallback_junction_target: dep_store_path
                                .into_sep::<{ PathSeparators::ANY }>(),
                        };

                        let link_strategy: symlinker::Strategy = if matches!(
                            pkg_res.tag,
                            ResolutionTag::Root | ResolutionTag::Workspace
                        ) {
                            // root and workspace packages ensure their dependency symlinks
                            // exist unconditionally. To make sure it's fast, first readlink
                            // then create the symlink if necessary
                            symlinker::Strategy::ExpectExisting
                        } else {
                            // Global-store entries are built under a private
                            // per-process staging directory, so nothing else
                            // is touching this path.
                            symlinker::Strategy::ExpectMissing
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

                    let mut parent_dedupe: ArrayHashMap<StoreEntryId, ()> = ArrayHashMap::default();

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
                        ResolutionTag::Uninitialized
                        | ResolutionTag::Root
                        | ResolutionTag::Workspace
                        | ResolutionTag::Folder
                        | ResolutionTag::Symlink
                        | ResolutionTag::SingleFileModule => {}

                        ResolutionTag::Npm
                        | ResolutionTag::Git
                        | ResolutionTag::Github
                        | ResolutionTag::LocalTarball
                        | ResolutionTag::RemoteTarball => {
                            if !entry_hoisted[self.entry_id.get() as usize] {
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
                    if !manager_ref.options.do_.contains(Do::RUN_SCRIPTS)
                        || self.entry_id == StoreEntryId::ROOT
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

                    let string_buf = lockfile.buffers.string_bytes.as_slice();

                    let dep = &lockfile.buffers.dependencies[dep_id as usize];
                    let truncated_dep_name_hash: TruncatedPackageNameHash =
                        dep.name_hash as TruncatedPackageNameHash;

                    let (is_trusted, is_trusted_through_update_request) = 'brk: {
                        if installer
                            .trusted_dependencies_from_update_requests
                            .contains_key(&truncated_dep_name_hash)
                        {
                            break 'brk (true, true);
                        }
                        if lockfile.has_trusted_dependency(dep.name.slice(string_buf), &pkg_res) {
                            break 'brk (true, false);
                        }
                        break 'brk (false, false);
                    };

                    let mut pkg_cwd = AutoAbsPath::init_top_level_dir();
                    installer.append_store_path(&mut pkg_cwd, self.entry_id);

                    'enqueue_lifecycle_scripts: {
                        if !(pkg_res.tag != ResolutionTag::Root
                            && (pkg_res.tag == ResolutionTag::Workspace || is_trusted))
                        {
                            break 'enqueue_lifecycle_scripts;
                        }
                        let mut pkg_scripts: package::scripts::Scripts =
                            pkg_script_lists[pkg_id as usize];
                        let manager = manager_ref.get();
                        if is_trusted
                            && manager
                                .postinstall_optimizer
                                .should_ignore_lifecycle_scripts(
                                    postinstall_optimizer::PkgInfo {
                                        name_hash: pkg_name_hash,
                                        version: if pkg_res.tag == ResolutionTag::Npm {
                                            Some(pkg_res.npm().version)
                                        } else {
                                            None
                                        },
                                        version_buf: lockfile.buffers.string_bytes.as_slice(),
                                    },
                                    lockfile.buffers.resolutions.as_slice(),
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
                            lockfile,
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
                            // Snapshot before boxing so the post-publish
                            // `first_index` check needs no raw-pointer deref.
                            let first_index = list.first_index;
                            let clone: *mut package::scripts::List =
                                bun_core::heap::into_raw(Box::new(list));
                            // Each Task is the sole writer for its own `entry_id`'s
                            // `scripts` slot; no other thread reads or writes it
                            // until this Task reaches
                            // `Step::RunPostInstallAndPrePostPrepare`. The column
                            // is `Cell<Option<*mut _>>` (see Store.rs) so writing
                            // through `&Store` provenance is a safe `.set()`.
                            entry_scripts[self.entry_id.get() as usize].set(Some(clone));

                            if is_trusted_through_update_request {
                                let trusted_dep_to_add: Box<[u8]> =
                                    Box::from(dep.name.slice(string_buf));

                                let _unlock = installer.trusted_dependencies_mutex.lock_guard();

                                // SAFETY: `trusted_dependencies_mutex` is held. Narrow the
                                // exclusive borrow to the single Vec field via raw place so
                                // no `&mut PackageManager` is formed — concurrent task
                                // threads' `&*manager_ptr` reborrows of other fields stay
                                // valid.
                                unsafe {
                                    (*core::ptr::addr_of_mut!(
                                        (*manager_ptr).trusted_deps_to_add_to_package_json
                                    ))
                                    .push(trusted_dep_to_add);
                                }
                                // SAFETY: `trusted_dependencies_mutex` is held, serializing
                                // writers. Narrow to the single `trusted_dependencies` field
                                // via raw place so no `&mut Lockfile` is ever formed — other
                                // task threads hold `&Lockfile` (and the `pkgs`/`pkg_*`
                                // slices above borrow it) for their entire run(), and those
                                // borrows never touch `trusted_dependencies`.
                                let trusted = unsafe {
                                    &mut *core::ptr::addr_of_mut!(
                                        (*lockfile_ptr).trusted_dependencies
                                    )
                                };
                                if trusted.is_none() {
                                    *trusted = Some(Default::default());
                                }
                                trusted
                                    .as_mut()
                                    .unwrap()
                                    .insert(truncated_dep_name_hash, ());
                            }

                            if first_index != 0 {
                                // has scripts but not a preinstall
                                step = self.next_step(current_step);
                                continue 'step;
                            }

                            return Ok(Yield::RunScripts(clone));
                        }
                    }

                    step = self.next_step(current_step);
                    continue;
                }

                Step::Binaries => {
                    let current_step = Step::Binaries;
                    if self.entry_id == StoreEntryId::ROOT {
                        step = self.next_step(current_step);
                        continue;
                    }

                    let bin = pkg_bins[pkg_id as usize];
                    if bin.tag == bin::Tag::None {
                        match installer.commit_global_store_entry(self.entry_id) {
                            sys::Result::Ok(()) => {}
                            sys::Result::Err(e) => {
                                return Ok(Yield::failure(TaskError::LinkPackage(e)));
                            }
                        }
                        step = self.next_step(current_step);
                        continue;
                    }

                    let string_buf = lockfile.buffers.string_bytes.as_slice();
                    let dependencies = lockfile.buffers.dependencies.as_slice();

                    let dep_name = dependencies[dep_id as usize].name.slice(string_buf);

                    let mut abs_target_buf = paths::path_buffer_pool::get();
                    let mut abs_dest_buf = paths::path_buffer_pool::get();
                    let mut rel_buf = paths::path_buffer_pool::get();

                    let mut seen: StringHashMap<()> = StringHashMap::default();

                    let mut node_modules_path = DefaultAbsPath::init_top_level_dir();
                    installer.append_real_store_node_modules_path(
                        &mut node_modules_path,
                        self.entry_id,
                        Which::Staging,
                    );

                    let mut target_node_modules_path: Option<DefaultAbsPath> = None;

                    let mut target_package_name = strings::StringOrTinyString::init(dep_name);

                    if let Some(replacement_entry_id) = installer.maybe_replace_node_modules_path(
                        entry_node_ids,
                        node_pkg_ids,
                        pkg_name_hashes,
                        pkg_resolutions_lists,
                        lockfile.buffers.resolutions.as_slice(),
                        lockfile.packages.items_meta(),
                        pkg_id,
                    ) {
                        let mut p = DefaultAbsPath::init_top_level_dir();
                        installer.append_real_store_node_modules_path(
                            &mut p,
                            replacement_entry_id,
                            Which::Final,
                        );
                        target_node_modules_path = Some(p);

                        let replacement_node_id =
                            entry_node_ids[replacement_entry_id.get() as usize];
                        let replacement_pkg_id = node_pkg_ids[replacement_node_id.get() as usize];
                        target_package_name = strings::StringOrTinyString::init(
                            lockfile.str(&pkg_names[replacement_pkg_id as usize]),
                        );
                    }

                    // PORT NOTE: `target_node_modules_path` intentionally aliases
                    // `node_modules_path` in the common (no-replacement) case —
                    // mirrors the Zig `*AbsPath` aliasing. The Linker field is a
                    // raw `*const AbsPath` for exactly this reason.
                    let target_nm_ptr: *const DefaultAbsPath =
                        match target_node_modules_path.as_ref() {
                            Some(p) => p,
                            None => &raw const node_modules_path,
                        };
                    let mut bin_linker = bin_real::Linker {
                        bin,
                        global_bin_path: manager_ref.options.bin_path,
                        package_name: strings::StringOrTinyString::init(dep_name),
                        target_package_name,
                        string_buf,
                        extern_string_buf: lockfile.buffers.extern_strings.as_slice(),
                        seen: Some(&mut seen),
                        target_node_modules_path: target_nm_ptr,
                        node_modules_path: &mut node_modules_path,
                        abs_target_buf: &mut *abs_target_buf,
                        abs_dest_buf: &mut *abs_dest_buf,
                        rel_buf: &mut *rel_buf,
                        err: None,
                        skipped_due_to_missing_bin: false,
                    };

                    bin_linker.link(false);

                    if target_node_modules_path.is_some()
                        && (bin_linker.skipped_due_to_missing_bin || bin_linker.err.is_some())
                    {
                        target_node_modules_path = None;

                        bin_linker.target_node_modules_path = bin_linker.node_modules_path;
                        bin_linker.target_package_name =
                            strings::StringOrTinyString::init(dep_name);

                        if manager_ref.options.log_level.is_verbose() {
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
                    if !manager_ref.options.do_.contains(Do::RUN_SCRIPTS)
                        || self.entry_id == StoreEntryId::ROOT
                    {
                        step = self.next_step(current_step);
                        continue;
                    }

                    // This Task is the sole owner of its `entry_id`'s `scripts`
                    // slot; written (if at all) by this same Task in
                    // `Step::RunPreinstall` above, never touched concurrently.
                    // `Cell::get` on a `Copy` payload — no unsafe needed.
                    let Some(list) = entry_scripts[self.entry_id.get() as usize].get() else {
                        step = self.next_step(current_step);
                        continue;
                    };
                    // SAFETY: single-owner — `entry_scripts[entry_id]` holds a `*mut List`
                    // boxed per-entry (see `Step::RunPreinstall` above), and each Task is
                    // the unique consumer of its own `entry_id`. No other `&`/`&mut` to
                    // this allocation is live.
                    let list = unsafe { &mut *list };

                    if list.first_index == 0 {
                        for (i, item) in list.items[1..].iter().enumerate() {
                            let i = i + 1;
                            if item.is_some() {
                                list.first_index = u8::try_from(i).expect("int cast");
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
    pub fn callback(task: *mut thread_pool::Task) {
        // SAFETY: task points to Task.task field
        let this: &mut Task = unsafe { &mut *bun_core::from_field_ptr!(Task, task, task) };

        let res = match this.run() {
            Ok(r) => r,
            Err(_oom) => bun_core::out_of_memory(),
        };

        // SAFETY: installer outlives all tasks (BACKREF). `callback` runs on the
        // thread pool concurrently across many `Task`s sharing the same
        // `*mut Installer` — never materialize `&mut Installer`. `task_queue.push`
        // takes `&self` (lock-free); `store.entries` columns are atomic / per-entry;
        // both are reached through a shared `&Installer`. `manager.wake()` is the
        // cross-thread wakeup: route through `PackageManager::wake_raw` which never
        // forms `&mut PackageManager`, so two threads finishing simultaneously do
        // not hold aliased exclusive borrows (Zig's `*PackageManager` carries no
        // exclusivity contract; "deref it fresh per call" alone would not prevent
        // the `&mut` lifetimes from overlapping).
        let installer_ptr = this.installer;
        let installer = installer_ptr.get();
        let manager_ptr: *mut PackageManager = installer.manager;

        match res {
            Yield::Yield => {}
            Yield::RunScripts(list) => {
                if Environment::CI_ASSERT {
                    bun_core::assert_with_location(
                        // `Cell::get` on a `Copy` payload — read-only check.
                        installer.store.entries.items_scripts()[this.entry_id.get() as usize]
                            .get()
                            .is_some(),
                        core::panic::Location::caller(),
                    );
                }
                this.result = Result::RunScripts(list);
                installer.task_queue.push(this);
                unsafe { PackageManager::wake_raw(manager_ptr) };
            }
            Yield::Done => {
                if Environment::CI_ASSERT {
                    // .monotonic is okay because this should have been set by this thread.
                    bun_core::assert_with_location(
                        installer.store.entries.items_step()[this.entry_id.get() as usize]
                            .load(Ordering::Relaxed)
                            == Step::Done as u32,
                        core::panic::Location::caller(),
                    );
                }
                this.result = Result::Done;
                installer.task_queue.push(this);
                unsafe { PackageManager::wake_raw(manager_ptr) };
            }
            Yield::Blocked => {
                if Environment::CI_ASSERT {
                    // .monotonic is okay because this should have been set by this thread.
                    bun_core::assert_with_location(
                        installer.store.entries.items_step()[this.entry_id.get() as usize]
                            .load(Ordering::Relaxed)
                            == Step::CheckIfBlocked as u32,
                        core::panic::Location::caller(),
                    );
                }
                this.result = Result::Blocked;
                installer.task_queue.push(this);
                unsafe { PackageManager::wake_raw(manager_ptr) };
            }
            Yield::Fail(err) => {
                if Environment::CI_ASSERT {
                    // .monotonic is okay because this should have been set by this thread.
                    bun_core::assert_with_location(
                        installer.store.entries.items_step()[this.entry_id.get() as usize]
                            .load(Ordering::Relaxed)
                            != Step::Done as u32,
                        core::panic::Location::caller(),
                    );
                }
                installer.store.entries.items_step()[this.entry_id.get() as usize]
                    .store(Step::Done as u32, Ordering::Release);
                this.result = Result::Err(err);
                installer.task_queue.push(this);
                unsafe { PackageManager::wake_raw(manager_ptr) };
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
        if self.lockfile().patched_dependencies.len() == 0
            && self.manager().patched_dependencies_to_remove.len() == 0
        {
            return Ok(PatchInfo::None);
        }

        let string_buf = self.lockfile().buffers.string_bytes.as_slice();

        let mut version_buf: Vec<u8> = Vec::new();

        write!(
            &mut version_buf,
            "{}@",
            bstr::BStr::new(pkg_name.slice(string_buf))
        )
        .map_err(|_| bun_alloc::AllocError)?;

        match pkg_res.tag {
            ResolutionTag::Workspace => {
                if let Some(workspace_version) =
                    self.lockfile().workspace_versions.get(&pkg_name_hash)
                {
                    write!(&mut version_buf, "{}", workspace_version.fmt(string_buf))
                        .map_err(|_| bun_alloc::AllocError)?;
                }
            }
            _ => {
                write!(
                    &mut version_buf,
                    "{}",
                    pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Posix),
                )
                .map_err(|_| bun_alloc::AllocError)?;
            }
        }

        let name_and_version_hash = bun_semver::semver_string::Builder::string_hash(&version_buf);

        if let Some(patch) = self
            .lockfile()
            .patched_dependencies
            .get(&name_and_version_hash)
        {
            return Ok(PatchInfo::Patch(PatchInfoPatch {
                name_and_version_hash,
                patch_path: patch.path.slice(string_buf).into(),
                contents_hash: patch.patchfile_hash().unwrap(),
            }));
        }

        if self
            .manager()
            .patched_dependencies_to_remove
            .contains_key(&name_and_version_hash)
        {
            return Ok(PatchInfo::Remove(PatchInfoRemove {
                name_and_version_hash,
            }));
        }

        Ok(PatchInfo::None)
    }

    pub fn link_to_hidden_node_modules(&self, entry_id: StoreEntryId) {
        let string_buf = self.lockfile().buffers.string_bytes.as_slice();

        let node_id = self.store.entries.items_node_id()[entry_id.get() as usize];
        let pkg_id = self.store.nodes.items_pkg_id()[node_id.get() as usize];
        let pkg_name = self.lockfile().packages.items_name()[pkg_id as usize];

        let mut hidden_hoisted_node_modules = AutoPath::init();

        // OOM/capacity: Zig aborts; port keeps fire-and-forget
        let _ = hidden_hoisted_node_modules.append(
            // "node_modules" + sep + ".bun" + sep + "node_modules"
            const_format::concatcp!(
                "node_modules",
                paths::SEP_STR,
                ".bun",
                paths::SEP_STR,
                "node_modules"
            )
            .as_bytes(),
        );
        let _ = hidden_hoisted_node_modules.append(pkg_name.slice(string_buf)); // OOM/capacity: Zig aborts; port keeps fire-and-forget

        let mut target = AutoRelPath::init();

        let _ = target.append(b".."); // OOM/capacity: Zig aborts; port keeps fire-and-forget
        if strings::index_of_char(pkg_name.slice(string_buf), b'/').is_some() {
            let _ = target.append(b".."); // OOM/capacity: Zig aborts; port keeps fire-and-forget
        }

        // OOM/capacity: Zig aborts; port keeps fire-and-forget
        let _ = target.append_fmt(format_args!(
            "{}/node_modules/{}",
            store::entry::fmt_store_path(entry_id, self.store, self.lockfile()),
            bstr::BStr::new(pkg_name.slice(string_buf)),
        ));

        let mut full_target = AutoAbsPath::init_top_level_dir();
        self.append_store_path(&mut full_target, entry_id);

        let mut symlinker = Symlinker {
            dest: hidden_hoisted_node_modules.into_sep::<{ PathSeparators::ANY }>(),
            target: target.into_sep::<{ PathSeparators::ANY }>(),
            fallback_junction_target: full_target.into_sep::<{ PathSeparators::ANY }>(),
        };

        // symlinks won't exist if node_modules/.bun is new
        let link_strategy: symlinker::Strategy = if self.is_new_bun_modules {
            symlinker::Strategy::ExpectMissing
        } else {
            symlinker::Strategy::ExpectExisting
        };

        let _ = symlinker.ensure_symlink(link_strategy);
    }

    fn maybe_replace_node_modules_path(
        &self,
        entry_node_ids: &[StoreNodeId],
        node_pkg_ids: &[PackageID],
        name_hashes: &[PackageNameHash],
        pkg_resolutions_lists: &[PackageIDSlice],
        pkg_resolutions_buffer: &[PackageID],
        pkg_metas: &[package::Meta],
        pkg_id: PackageID,
    ) -> Option<StoreEntryId> {
        let postinstall_optimizer = &self.manager().postinstall_optimizer;
        if !postinstall_optimizer.is_native_binlink_enabled() {
            return None;
        }
        let name_hash = name_hashes[pkg_id as usize];

        if let Some(optimizer) = postinstall_optimizer.get(postinstall_optimizer::PkgInfo {
            name_hash,
            ..postinstall_optimizer::PkgInfo::default()
        }) {
            match optimizer {
                PostinstallOptimizer::NativeBinlink => {
                    let manager = self.manager();
                    let target_cpu = manager.options.cpu;
                    let target_os = manager.options.os;
                    if let Some(replacement_pkg_id) =
                        postinstall_optimizer::PostinstallOptimizer::get_native_binlink_replacement_package_id(
                            pkg_resolutions_lists[pkg_id as usize].get(pkg_resolutions_buffer),
                            pkg_metas,
                            target_cpu,
                            target_os,
                        )
                    {
                        for (new_entry_id, new_node_id) in entry_node_ids.iter().enumerate() {
                            if node_pkg_ids[new_node_id.get() as usize] == replacement_pkg_id {
                                debug!(
                                    "native bin link {} -> {}",
                                    pkg_id, replacement_pkg_id
                                );
                                return Some(StoreEntryId::from(
                                    u32::try_from(new_entry_id).expect("int cast"),
                                ));
                            }
                        }
                    }
                }
                PostinstallOptimizer::Ignore => {}
            }
        }

        None
    }

    pub fn link_dependency_bins(
        &self,
        parent_entry_id: StoreEntryId,
    ) -> core::result::Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let lockfile = self.lockfile();
        let store = self.store;

        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let extern_string_buf = lockfile.buffers.extern_strings.as_slice();

        let entries = &store.entries;
        let entry_node_ids: &[StoreNodeId] = entries.items_node_id();
        let entry_deps = entries.items_dependencies();

        let nodes = &store.nodes;
        let node_pkg_ids = nodes.items_pkg_id();
        let node_dep_ids = nodes.items_dep_id();

        let pkgs = lockfile.packages.slice();
        let pkg_name_hashes = pkgs.items_name_hash();
        let pkg_metas = pkgs.items_meta();
        let pkg_resolutions_lists = pkgs.items_resolutions();
        let pkg_resolutions_buffer = lockfile.buffers.resolutions.as_slice();
        let pkg_bins = pkgs.items_bin();

        let mut link_target_buf = paths::path_buffer_pool::get();
        let mut link_dest_buf = paths::path_buffer_pool::get();
        let mut link_rel_buf = paths::path_buffer_pool::get();

        let mut seen: StringHashMap<()> = StringHashMap::default();

        let mut node_modules_path = DefaultAbsPath::init_top_level_dir();
        self.append_real_store_node_modules_path(
            &mut node_modules_path,
            parent_entry_id,
            Which::Staging,
        );

        for dep in entry_deps[parent_entry_id.get() as usize].slice() {
            let node_id = entry_node_ids[dep.entry_id.get() as usize];
            let dep_id = node_dep_ids[node_id.get() as usize];
            let pkg_id = node_pkg_ids[node_id.get() as usize];
            let bin = pkg_bins[pkg_id as usize];
            if bin.tag == bin::Tag::None {
                continue;
            }
            let alias = lockfile.buffers.dependencies[dep_id as usize].name;

            let mut target_node_modules_path: Option<DefaultAbsPath> = None;
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
                let mut p = DefaultAbsPath::init_top_level_dir();
                self.append_real_store_node_modules_path(
                    &mut p,
                    replacement_entry_id,
                    Which::Final,
                );
                target_node_modules_path = Some(p);

                let replacement_node_id = entry_node_ids[replacement_entry_id.get() as usize];
                let replacement_pkg_id = node_pkg_ids[replacement_node_id.get() as usize];
                let pkg_names = pkgs.items_name();
                target_package_name = strings::StringOrTinyString::init(
                    self.lockfile().str(&pkg_names[replacement_pkg_id as usize]),
                );
            }

            // PORT NOTE: see the matching note in `Step::LinkBinaries` — Zig
            // aliases `target_node_modules_path` with `node_modules_path` and
            // the Linker field is a raw `*const AbsPath` to permit that.
            let target_nm_ptr: *const DefaultAbsPath = match target_node_modules_path.as_ref() {
                Some(p) => p,
                None => &raw const node_modules_path,
            };
            let mut bin_linker = bin_real::Linker {
                bin,
                global_bin_path: self.manager().options.bin_path,
                package_name,
                string_buf,
                extern_string_buf,
                seen: Some(&mut seen),
                node_modules_path: &mut node_modules_path,
                target_node_modules_path: target_nm_ptr,
                target_package_name: if target_node_modules_path.is_some() {
                    target_package_name
                } else {
                    package_name
                },
                abs_target_buf: &mut *link_target_buf,
                abs_dest_buf: &mut *link_dest_buf,
                rel_buf: &mut *link_rel_buf,
                err: None,
                skipped_due_to_missing_bin: false,
            };

            bin_linker.link(false);

            if target_node_modules_path.is_some()
                && (bin_linker.skipped_due_to_missing_bin || bin_linker.err.is_some())
            {
                target_node_modules_path = None;

                bin_linker.target_node_modules_path = bin_linker.node_modules_path;
                bin_linker.target_package_name = package_name;

                if self.manager().options.log_level.is_verbose() {
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
    pub fn entry_uses_global_store(&self, entry_id: StoreEntryId) -> bool {
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
    pub fn append_global_store_entry_path(
        &self,
        buf: &mut impl paths::PathLike,
        entry_id: StoreEntryId,
        which: Which,
    ) {
        debug_assert!(self.entry_uses_global_store(entry_id));
        buf.clear();
        buf.append(self.global_store_path.as_ref().unwrap().as_bytes());
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
    pub fn commit_global_store_entry(&self, entry_id: StoreEntryId) -> sys::Result<()> {
        if !self.entry_uses_global_store(entry_id) {
            return sys::Result::Ok(());
        }
        let mut staging = AutoAbsPath::init();
        self.append_global_store_entry_path(&mut staging, entry_id, Which::Staging);
        let mut final_ = AutoAbsPath::init();
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
                if self.manager().options.enable.force_install() {
                    let mut old = AutoAbsPath::init();
                    let _ = old.append(self.global_store_path.as_ref().unwrap().as_bytes()); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    let _ = old.append_fmt(format_args!(
                        "{}.old-{:x}",
                        store::entry::fmt_global_store_path(entry_id, self.store, self.lockfile()),
                        bun_core::fast_random(),
                    ));
                    if let Some(swap_err) =
                        sys::renameat(Fd::cwd(), final_.slice_z(), Fd::cwd(), old.slice_z()).err()
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
        buf: &mut impl paths::PathLike,
        entry_id: StoreEntryId,
    ) {
        buf.append_fmt(format_args!(
            "{}/{}",
            NODE_MODULES_BUN,
            store::entry::fmt_store_path(entry_id, self.store, self.lockfile()),
        ));
    }

    /// Create the project-level symlink `node_modules/.bun/<storepath>` →
    /// `<cache>/links/<storepath>-<hash>`. This is the only per-install
    /// filesystem write for a warm global-store hit.
    pub fn link_project_to_global_store(&self, entry_id: StoreEntryId) -> sys::Result<()> {
        let mut dest = AutoPath::init_top_level_dir();
        self.append_local_store_entry_path(&mut dest, entry_id);

        let mut target_abs = AutoAbsPath::init();
        self.append_global_store_entry_path(&mut target_abs, entry_id, Which::Final);

        // Absolute target so the link is independent of where node_modules
        // lives (project root may itself be behind a symlink). Symlinker's
        // `target` field is RelPath-typed for the common in-tree case, so
        // call sys.symlink/symlinkOrJunction directly here.
        fn do_symlink(d: &ZStr, t: &ZStr) -> sys::Result<()> {
            #[cfg(windows)]
            {
                // `target_abs` is already absolute, so the junction fallback
                // can reuse it directly (Zig: passes the same `target` pointer).
                return sys::symlink_or_junction(d, t, None);
            }
            #[cfg(not(windows))]
            {
                sys::symlink(t, d)
            }
        }

        match do_symlink(dest.slice_z(), target_abs.slice_z()) {
            sys::Result::Ok(()) => return sys::Result::Ok(()),
            sys::Result::Err(err) => match err.get_errno() {
                sys::Errno::ENOENT => {
                    if let Some(parent) = dest.dirname() {
                        let _ = Fd::cwd().make_path(parent);
                    }
                }
                sys::Errno::EEXIST => {
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
                            if let Some(st) = sys::lstat(dest.slice_z()).ok() {
                                sys::posix::s_islnk(u32::try_from(st.st_mode).expect("int cast"))
                            } else {
                                true
                            }
                        }
                    };

                    if is_symlink {
                        #[cfg(windows)]
                        {
                            if sys::rmdir(dest.slice_z()).err().is_some() {
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
        buf: &mut impl paths::PathLike,
        entry_id: StoreEntryId,
    ) {
        let string_buf = self.lockfile().buffers.string_bytes.as_slice();

        let entries = &self.store.entries;
        let entry_node_ids = entries.items_node_id();

        let nodes = &self.store.nodes;
        let node_pkg_ids = nodes.items_pkg_id();

        let pkgs = self.lockfile().packages.slice();
        let pkg_resolutions = pkgs.items_resolution();

        let node_id = entry_node_ids[entry_id.get() as usize];
        let pkg_id = node_pkg_ids[node_id.get() as usize];
        let pkg_res = pkg_resolutions[pkg_id as usize];

        match pkg_res.tag {
            ResolutionTag::Root => {
                buf.append(b"node_modules");
            }
            ResolutionTag::Workspace => {
                buf.append(pkg_res.workspace().slice(string_buf));
                buf.append(b"node_modules");
            }
            _ => {
                buf.append_fmt(format_args!(
                    "{}/{}/node_modules",
                    NODE_MODULES_BUN,
                    store::entry::fmt_store_path(entry_id, self.store, self.lockfile()),
                ));
            }
        }
    }

    /// Like `appendStoreNodeModulesPath`, but resolves to the *physical*
    /// location of the entry's `node_modules` directory: the global virtual
    /// store for global-eligible entries, or the project-local `.bun/` path
    /// otherwise. See `Which` for when to pass `.staging` vs `.final`.
    pub fn append_real_store_node_modules_path(
        &self,
        buf: &mut impl paths::PathLike,
        entry_id: StoreEntryId,
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
        buf: &mut impl paths::PathLike,
        entry_id: StoreEntryId,
        which: Which,
    ) {
        if self.entry_uses_global_store(entry_id) {
            let string_buf = self.lockfile().buffers.string_bytes.as_slice();
            let node_id = self.store.entries.items_node_id()[entry_id.get() as usize];
            let pkg_id = self.store.nodes.items_pkg_id()[node_id.get() as usize];
            let pkg_name = self.lockfile().packages.items_name()[pkg_id as usize];
            self.append_global_store_entry_path(buf, entry_id, which);
            buf.append(b"node_modules");
            buf.append(pkg_name.slice(string_buf));
            return;
        }
        self.append_store_path(buf, entry_id);
    }

    pub fn append_store_path(&self, buf: &mut impl paths::PathLike, entry_id: StoreEntryId) {
        let string_buf = self.lockfile().buffers.string_bytes.as_slice();

        let entries = &self.store.entries;
        let entry_node_ids = entries.items_node_id();

        let nodes = &self.store.nodes;
        let node_pkg_ids = nodes.items_pkg_id();
        let node_dep_ids = nodes.items_dep_id();
        // let node_peers = nodes.items().peers;

        let pkgs = self.lockfile().packages.slice();
        let pkg_names = pkgs.items_name();
        let pkg_resolutions = pkgs.items_resolution();

        let node_id = entry_node_ids[entry_id.get() as usize];
        // let peers = node_peers[node_id.get() as usize];
        let pkg_id = node_pkg_ids[node_id.get() as usize];
        let dep_id = node_dep_ids[node_id.get() as usize];
        let pkg_res = pkg_resolutions[pkg_id as usize];

        match pkg_res.tag {
            ResolutionTag::Root => {
                if dep_id != invalid_dependency_id {
                    let pkg_name = pkg_names[pkg_id as usize];
                    buf.append(NODE_MODULES_BUN.as_bytes());
                    buf.append_fmt(format_args!(
                        "{}",
                        store::entry::fmt_store_path(entry_id, self.store, self.lockfile()),
                    ));
                    buf.append(b"node_modules");
                    if pkg_name.is_empty() {
                        buf.append(paths::basename(
                            bun_fs::FileSystem::instance().top_level_dir(),
                        ));
                    } else {
                        buf.append(pkg_name.slice(string_buf));
                    }
                } else {
                    // append nothing. buf is already top_level_dir
                }
            }
            ResolutionTag::Workspace => {
                buf.append(pkg_res.workspace().slice(string_buf));
            }
            ResolutionTag::Symlink => {
                // PORT NOTE: reshaped — Zig `globalLinkDirPath()` lazily ensures
                // the dir and mutates `*PackageManager`. `append_store_path` is
                // `&self` (matching Zig `*const Installer`) and may run on worker
                // threads, so the lazy init is hoisted to the main-thread caller
                // (`isolated_install::install_packages`, before any `start_task`).
                // Reading the cached field here is then equivalent.
                let symlink_dir_path: &[u8] = &self.manager().global_link_dir_path;
                debug_assert!(
                    !symlink_dir_path.is_empty(),
                    "global_link_dir_path must be ensured before tasks start",
                );

                buf.clear();
                buf.append(symlink_dir_path);
                buf.append(pkg_res.symlink().slice(string_buf));
            }
            _ => {
                let pkg_name = pkg_names[pkg_id as usize];
                buf.append(NODE_MODULES_BUN.as_bytes());
                buf.append_fmt(format_args!(
                    "{}",
                    store::entry::fmt_store_path(entry_id, self.store, self.lockfile()),
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
    pub fn entry_store_node_modules_package_name<'b>(
        &'b self,
        dep_id: DependencyID,
        pkg_id: PackageID,
        pkg_res: &Resolution,
        pkg_names: &'b [SemverString],
    ) -> Option<&'b [u8]> {
        let string_buf = self.lockfile().buffers.string_bytes.as_slice();

        match pkg_res.tag {
            ResolutionTag::Root => {
                if dep_id != invalid_dependency_id {
                    if pkg_names[pkg_id as usize].is_empty() {
                        return Some(paths::basename(
                            bun_fs::FileSystem::instance().top_level_dir(),
                        ));
                    }
                    return Some(pkg_names[pkg_id as usize].slice(string_buf));
                }
                None
            }
            ResolutionTag::Workspace => None,
            ResolutionTag::Symlink => None,
            _ => Some(pkg_names[pkg_id as usize].slice(string_buf)),
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
        sys::Errno::EEXIST | sys::Errno::ENOTEMPTY => true,
        // Windows maps a rename onto an in-use directory to
        // ERROR_ACCESS_DENIED; on POSIX PERM/ACCES are real
        // permission failures and must propagate.
        sys::Errno::EPERM | sys::Errno::EACCES => cfg!(windows),
        _ => false,
    }
}

// ported from: src/install/isolated_install/Installer.zig
