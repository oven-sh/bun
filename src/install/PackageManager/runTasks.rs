use crate::lockfile::package::PackageColumns as _;
use core::cell::Cell;
use core::sync::atomic::Ordering;
use std::io::Write as _;

use bun_core::strings;
use bun_core::{Environment, Output};
use bun_http::{self as http, AsyncHTTP};
use bun_threading::thread_pool::Batch as ThreadPoolBatch;

use crate::extract_tarball;
use crate::network_task::Callback as NetworkTaskCallback;
use crate::npm;
use crate::patch_install::Callback as PatchTaskCallback;
use crate::retry_timer;
use crate::tarball_stream::TarballStream;
use bun_install::{
    DependencyID, ExtractTarball, INVALID_PACKAGE_ID, NetworkTask, PackageID, PackageManifestError,
    Repository,
};
// Import the *module* under the `Task` name so `Task::Id` resolves as a path.
use super::{
    Command, ManifestFailure, PackageInstaller, PackageManager, ProgressStrings, RemoteTurn,
    Subcommand, TaskCallbackList,
};
use super::{directories, enqueue};
use crate::isolated_install::installer as store_installer;
use crate::isolated_install::store::{EntryColumns as _, NodeColumns as _};
use crate::lifecycle_script_runner::{InstallCtx, LifecycleScriptSubprocess};
use crate::network_task::{Authorization, ForTarballError, add_error_or_warning, stored_string};
use crate::package_manifest_map::Value as ManifestEntry;
use bun_core::fmt::PathSep;
use bun_install::lockfile::Package;
use bun_install::package_manager_task as Task;
// Import the *module* under the `Options` name so `Options::LogLevel` resolves as a path
// (matches the `Task` module-alias pattern above and `CommandLineArguments.rs`).
use super::package_manager_options as Options;
use super::package_manager_options::{Do, Enable};
use crate::isolated_install::store as Store;

macro_rules! add_error_or_warning_pretty {
    ($log:expr, $is_error:expr, $($message:tt)+) => {
        if $is_error {
            bun_ast::add_error_pretty!($log, None, bun_ast::Loc::EMPTY, $($message)+)
        } else {
            bun_ast::add_warning_pretty!($log, None, bun_ast::Loc::EMPTY, $($message)+)
        }
    };
}
pub(crate) use add_error_or_warning_pretty;

// ──────────────────────────────────────────────────────────────────────────
// Callbacks trait
// ──────────────────────────────────────────────────────────────────────────
//
// A single trait with associated consts gating the
// optional hooks (default-unreachable bodies), plus associated-const tags for
// the `Ctx` identity checks. The trait branches on three `Ctx` identities
// (`PackageInstaller`, `Store.Installer`, neither), but there are six impls
// across four `Ctx` shapes: `PackageInstaller` (`HoistedRunTasksCallbacks`),
// `Store::Installer` (`StoreRunTasksCallbacks`), unit
// (`VoidRunTasksCallbacks`, `ManifestsOnlyCallbacks`, `InstallWaitCallbacks`),
// and `Queue` (`QueueRunTasksCallbacks` in `src/jsc/AsyncModule.rs`).
pub trait RunTasksCallbacks {
    /// Mirrors `Ctx` (the `extract_ctx` value type).
    type Ctx;

    const PROGRESS_BAR: bool = false;
    const MANIFESTS_ONLY: bool = false;

    const HAS_ON_EXTRACT: bool = false;
    const HAS_ON_PACKAGE_MANIFEST_ERROR: bool = false;
    const HAS_ON_PACKAGE_DOWNLOAD_ERROR: bool = false;
    const HAS_ON_RESOLVE: bool = false;

    /// `Ctx == *PackageInstaller`
    const IS_PACKAGE_INSTALLER: bool = false;
    /// `Ctx == *Store.Installer`
    const IS_STORE_INSTALLER: bool = false;

    fn on_package_manifest_error(
        _ctx: &mut Self::Ctx,
        _name: &[u8],
        _err: crate::Error,
        _url: &[u8],
    ) {
        unreachable!()
    }

    // `onPackageDownloadError` is called with two distinct shapes depending
    // on the `Ctx`: `task.task_id: Task::Id` for the store installer,
    // `package_id: PackageID` otherwise. Static dispatch via two trait
    // methods lets impls receive the correctly-typed id without a
    // `Task::Id` round-trip pun.
    fn on_package_download_error_store(
        _ctx: &mut Self::Ctx,
        _task_id: Task::Id,
        _name: &[u8],
        _resolution: &bun_install::Resolution,
        _err: crate::Error,
        _url: &[u8],
    ) {
        unreachable!()
    }
    fn on_package_download_error_pkg(
        _ctx: &mut Self::Ctx,
        _package_id: PackageID,
        _name: &[u8],
        _resolution: &bun_install::Resolution,
        _err: crate::Error,
        _url: &[u8],
    ) {
        unreachable!()
    }

    fn on_extract_package_installer(
        _ctx: &mut Self::Ctx,
        _task_id: Task::Id,
        _dependency_id: DependencyID,
        _data: &mut bun_install::ExtractData,
        _log_level: Options::LogLevel,
    ) {
        unreachable!()
    }
    fn on_extract_store_installer(
        _ctx: &mut Self::Ctx,
        _task_id: Task::Id,
        _data: &bun_install::ExtractData,
    ) {
        unreachable!()
    }

    fn on_resolve(_ctx: &mut Self::Ctx) {
        unreachable!()
    }
}

/// Type-erased view of a `RunTasksCallbacks` impl, so the ~2k-line body of
/// `run_tasks` is compiled once rather than once per callbacks type. Every fn
/// pointer expects `ctx` to be the `*mut C::Ctx` it was erased alongside.
struct ErasedCallbacks {
    progress_bar: bool,
    manifests_only: bool,
    has_on_extract: bool,
    has_on_package_manifest_error: bool,
    has_on_package_download_error: bool,
    has_on_resolve: bool,
    is_package_installer: bool,
    is_store_installer: bool,
    on_package_manifest_error: fn(*mut (), &[u8], crate::Error, &[u8]),
    on_package_download_error_store:
        fn(*mut (), Task::Id, &[u8], &bun_install::Resolution, crate::Error, &[u8]),
    on_package_download_error_pkg:
        fn(*mut (), PackageID, &[u8], &bun_install::Resolution, crate::Error, &[u8]),
    on_extract_package_installer:
        fn(*mut (), Task::Id, DependencyID, &mut bun_install::ExtractData, Options::LogLevel),
    on_extract_store_installer: fn(*mut (), Task::Id, &bun_install::ExtractData),
    on_resolve: fn(*mut ()),
}

impl ErasedCallbacks {
    fn of<C: RunTasksCallbacks>() -> Self {
        /// Recovers the `&mut C::Ctx` that `run_tasks::<C>` erased.
        fn ctx<'a, C: RunTasksCallbacks>(ctx: *mut ()) -> &'a mut C::Ctx {
            // SAFETY: only ever called by `run_tasks_erased` with the pointer
            // `run_tasks::<C>` erased from a `&mut C::Ctx`, which is the sole
            // live handle to that context for the duration of the call.
            unsafe { &mut *ctx.cast() }
        }
        Self {
            progress_bar: C::PROGRESS_BAR,
            manifests_only: C::MANIFESTS_ONLY,
            has_on_extract: C::HAS_ON_EXTRACT,
            has_on_package_manifest_error: C::HAS_ON_PACKAGE_MANIFEST_ERROR,
            has_on_package_download_error: C::HAS_ON_PACKAGE_DOWNLOAD_ERROR,
            has_on_resolve: C::HAS_ON_RESOLVE,
            is_package_installer: C::IS_PACKAGE_INSTALLER,
            is_store_installer: C::IS_STORE_INSTALLER,
            on_package_manifest_error: |c, name, err, url| {
                C::on_package_manifest_error(ctx::<C>(c), name, err, url)
            },
            on_package_download_error_store: |c, task_id, name, resolution, err, url| {
                C::on_package_download_error_store(ctx::<C>(c), task_id, name, resolution, err, url)
            },
            on_package_download_error_pkg: |c, package_id, name, resolution, err, url| {
                C::on_package_download_error_pkg(
                    ctx::<C>(c),
                    package_id,
                    name,
                    resolution,
                    err,
                    url,
                )
            },
            on_extract_package_installer: |c, task_id, dependency_id, data, log_level| {
                C::on_extract_package_installer(
                    ctx::<C>(c),
                    task_id,
                    dependency_id,
                    data,
                    log_level,
                )
            },
            on_extract_store_installer: |c, task_id, data| {
                C::on_extract_store_installer(ctx::<C>(c), task_id, data)
            },
            on_resolve: |c| C::on_resolve(ctx::<C>(c)),
        }
    }
}

impl ErasedCallbacks {
    /// `ctx` *is* the installer when `is_package_installer` (`C::Ctx == PackageInstaller`).
    fn package_installer<'a>(&self, ctx: *mut ()) -> &'a mut PackageInstaller<'a> {
        debug_assert!(self.is_package_installer);
        // SAFETY: `is_package_installer` means `C::Ctx == PackageInstaller`, and
        // `ctx` is the erased `&mut C::Ctx` (see `ErasedCallbacks::of`).
        unsafe { &mut *ctx.cast() }
    }

    /// `ctx` *is* the installer when `is_store_installer` (`C::Ctx == Store::Installer`).
    fn store_installer<'a>(&self, ctx: *mut ()) -> &'a mut Store::Installer<'a> {
        debug_assert!(self.is_store_installer);
        // SAFETY: `is_store_installer` means `C::Ctx == Store::Installer`, and
        // `ctx` is the erased `&mut C::Ctx` (see `ErasedCallbacks::of`).
        unsafe { &mut *ctx.cast() }
    }

    /// Marks the task as failed, so that a later enqueue fails fast. Returns `Some(is_required)` if
    /// the caller has to report the error.
    fn dispatch_tarball_error(
        &self,
        manager: &mut PackageManager,
        ctx: *mut (),
        task_id: Task::Id,
        dependency_id: DependencyID,
        name: &[u8],
        resolution: &bun_install::Resolution,
        err: crate::Error,
        url: &[u8],
    ) -> Option<bool> {
        manager.mark_network_task_failed(task_id);
        // A linker queues a tarball once, for the first dependency that reaches it.
        let is_required = if self.has_on_extract {
            let package_id = manager.lockfile.buffers.resolutions[dependency_id as usize];
            manager.is_package_required(dependency_id, package_id)
        } else {
            manager.is_network_task_required(task_id)
        };
        if !self.has_on_package_download_error {
            return Some(is_required);
        }
        if !self.is_store_installer {
            let package_id = manager.lockfile.buffers.resolutions[dependency_id as usize];
            (self.on_package_download_error_pkg)(ctx, package_id, name, resolution, err, url);
        } else if is_required {
            (self.on_package_download_error_store)(ctx, task_id, name, resolution, err, url);
        } else {
            self.store_installer(ctx)
                .on_optional_package_download_error(task_id);
            return Some(false);
        }
        None
    }
}

/// Called from isolated_install on the main thread.
pub fn run_tasks<C: RunTasksCallbacks>(
    manager: &mut PackageManager,
    extract_ctx: &mut C::Ctx,
    install_peer: bool,
    log_level: Options::LogLevel,
) -> crate::Result<()> {
    run_tasks_erased(
        manager,
        core::ptr::from_mut(extract_ctx).cast(),
        &ErasedCallbacks::of::<C>(),
        install_peer,
        log_level,
    )
}

/// The cleanup that runs however `run_tasks_erased` exits.
struct FinishPass<'a> {
    manager: *mut PackageManager,
    counts_tasks: bool,
    log_level: Options::LogLevel,
    has_updated_this_run: &'a Cell<bool>,
}

impl Drop for FinishPass<'_> {
    fn drop(&mut self) {
        // SAFETY: drops after every body borrow of `manager` has ended
        // (scope exit or `?` unwind); the pointer retains provenance because
        // the body only ever accessed that allocation through reborrows of it.
        let manager = unsafe { &mut *self.manager };
        manager.drain_dependency_list();

        if self.log_level.show_progress() {
            manager.start_progress_bar_if_none();

            if self.counts_tasks {
                let completed_items = (manager.total_tasks - manager.pending_task_count()) as usize;
                // SAFETY: `downloads_node` set by `start_progress_bar_if_none`;
                // points into `manager.progress` which is live.
                let node = manager.downloads_node_mut();
                if completed_items != node.unprotected_completed_items.load(Ordering::Relaxed)
                    || self.has_updated_this_run.get()
                {
                    node.set_completed_items(completed_items);
                    node.set_estimated_total_items(manager.total_tasks as usize);
                }
            }
            // The progress bar shows the node that was activated last, so the downloads node is
            // only activated once there is something to download.
            if manager.total_tasks > 0 {
                manager.downloads_node_mut().activate();
            }
            manager.progress.maybe_refresh();
        }
    }
}

struct ReturnResolveTask {
    manager: *mut PackageManager,
    task: *mut Task::Task<'static>,
}

impl Drop for ReturnResolveTask {
    fn drop(&mut self) {
        // SAFETY: `manager` is the provenance root for every body access
        // to the manager; `task` is the sole live handle to this pool slot.
        unsafe {
            (*self.task).deinit_payload();
            (*self.manager).preallocated_resolve_tasks.put(self.task);
        }
    }
}

/// Null if the resolve task doesn't own a network task.
struct ReturnNetworkTask {
    manager: *mut PackageManager,
    task: *mut NetworkTask,
}

impl Drop for ReturnNetworkTask {
    fn drop(&mut self) {
        if self.task.is_null() {
            return;
        }
        // SAFETY: see `ReturnResolveTask`. `unsafe_http_client` is `MaybeUninit` so
        // `put()`'s `drop_in_place<NetworkTask>` skips it — drop manually
        // (HTTP completed, so it IS init) so the inner
        // `AsyncHTTP.{request,response}_headers: EntryList` don't
        // leak per put/get cycle.
        unsafe {
            (*self.task).unsafe_http_client.assume_init_drop();
            (*self.manager).preallocated_network_tasks.put(self.task);
        }
    }
}

/// `resolve_waiters_of_appended_package`, then tells the runtime if one of its imports was
/// resolved.
fn resolve_waiters_and_notify(
    cb: &ErasedCallbacks,
    manager: &mut PackageManager,
    extract_ctx: *mut (),
    task_id: Task::Id,
    pkg: &Package,
    install_peer: bool,
) -> crate::Result<()> {
    let any_root = Cell::new(false);
    let result =
        resolve_waiters_of_appended_package(manager, task_id, pkg, install_peer, &any_root);
    if cb.has_on_resolve && any_root.get() {
        (cb.on_resolve)(extract_ctx);
    }
    result
}

/// Resolves the dependencies that waited for `task_id` to `pkg`, and fills in the package's name
/// where a dependency did not know it. Entries that a linker queued stay in the task's list.
/// Sets `any_root` if an import of the runtime was resolved.
pub(crate) fn resolve_waiters_of_appended_package(
    manager: &mut PackageManager,
    task_id: Task::Id,
    pkg: &Package,
    install_peer: bool,
    any_root: &Cell<bool>,
) -> crate::Result<()> {
    // Recorded for a dependency that's enqueued on the same task later. See
    // `AppendedTaskPackageMap`.
    manager.appended_task_packages.insert(task_id, pkg.meta.id);
    let Some(entry) = manager.task_queue.get_mut(&task_id) else {
        return Ok(());
    };
    // The dependencies are resolved before the onExtract callback is called
    let mut result = Ok(());
    for dep in core::mem::take(entry) {
        match dep {
            bun_install::TaskCallbackContext::Dependency(id)
            | bun_install::TaskCallbackContext::RootDependency(id) => {
                enqueue::name_resolved_row(
                    &mut manager.lockfile.buffers.dependencies[id as usize].version,
                    pkg.name,
                    &pkg.resolution,
                );
                result = manager.process_dependency_list_item(&dep, Some(any_root), install_peer);
                if result.is_err() {
                    break;
                }
            }
            // if it's a node_module folder to install, handle that after we process all the dependencies within the onExtract callback.
            _ => manager.task_queue.get_mut(&task_id).unwrap().push(dep),
        }
    }
    result
}

fn run_tasks_erased(
    manager: &mut PackageManager,
    extract_ctx: *mut (),
    cb: &ErasedCallbacks,
    install_peer: bool,
    log_level: Options::LogLevel,
) -> crate::Result<()> {
    // `Cell<bool>` so `FinishPass` below can read it via `&self`
    // while the loop body sets it — no raw-ptr provenance dance needed.
    let has_updated_this_run = Cell::new(false);
    let mut has_network_error = false;

    // The guards hold `manager` as a raw pointer: the loop body holds `&mut` to it.
    //
    // Stacked Borrows: the raw pointers must remain the provenance root for all
    // body accesses, otherwise the first direct use of the `&mut` fn params
    // would pop the raw tags and the guard derefs become UB. We therefore
    // shadow the params with reborrows *through* the raw pointers — every body
    // use of `manager`/`extract_ctx` below is a child of `*_ptr`, so the
    // pointers stay valid until the guards fire.
    let manager_ptr: *mut PackageManager = manager;
    // SAFETY: `manager_ptr` was just derived from the unique `&mut` fn param;
    // reborrowing here yields the sole live `&mut` for the body. Dropped
    // before the guards reborrow the same pointer. (`extract_ctx` is already a
    // raw pointer and is only materialized as `&mut` inside the callbacks.)
    let manager = unsafe { &mut *manager_ptr };
    let _finish_pass = FinishPass {
        manager: manager_ptr,
        counts_tasks: cb.progress_bar,
        log_level,
        has_updated_this_run: &has_updated_this_run,
    };

    const DOWNLOAD: &str = ProgressStrings::DOWNLOAD_EMOJI;
    const EXTRACT: &str = ProgressStrings::EXTRACT_EMOJI;
    // The progress bar shows the name of the first task in each pass.
    let name_progress = |manager: &mut PackageManager, name: &[u8], emoji: &str| {
        if log_level.show_progress() && !has_updated_this_run.replace(true) {
            manager.set_node_name::<true>(manager.downloads_node_mut(), name, emoji.as_bytes());
        }
    };
    let return_network_task = |task: *mut NetworkTask| {
        drop(ReturnNetworkTask {
            manager: manager_ptr,
            task,
        })
    };

    let patch_tasks_batch = manager.patch_task_queue.pop_batch();
    let mut patch_tasks_iter = patch_tasks_batch.iterator();
    loop {
        let ptask_ptr = patch_tasks_iter.next();
        if ptask_ptr.is_null() {
            break;
        }
        // SAFETY: `next()` returned non-null; node is exclusively owned by this
        // batch. `ptask_ptr` is the `Box` that `enqueue_patch_task` /
        // `enqueue_patch_task_pre` handed to the fifo via `heap::into_raw`;
        // reclaim ownership exactly once here so the `Box` drops at end of
        // iteration on every path.
        let mut ptask = unsafe { bun_core::heap::take(ptask_ptr) };
        debug_assert!(manager.pending_task_count() > 0);
        manager.decrement_pending_tasks();
        ptask.run_from_main_thread(manager, log_level)?;
        if let PatchTaskCallback::Apply(apply) = &mut ptask.callback {
            if apply.logger.errors == 0 {
                if cb.has_on_extract {
                    if let Some(_task_id) = apply.task_id {
                        // autofix
                    } else if cb.is_package_installer {
                        if let Some(ctx) = apply.install_context.as_mut() {
                            // `extract_ctx` *is* the installer here.
                            let installer: &mut PackageInstaller =
                                cb.package_installer(extract_ctx);
                            // The hoisted loop runs tasks in the middle of a tree.
                            let prev_node_modules = core::mem::take(&mut installer.node_modules);
                            let prev_tree_id = installer.current_tree_id;
                            installer.node_modules.path = core::mem::take(&mut ctx.path);
                            installer.node_modules.tree_id = ctx.tree_id;
                            installer.current_tree_id = ctx.tree_id;
                            let pkg_id = apply.pkg_id;
                            let resolution =
                                &manager.lockfile.packages.items_resolution()[pkg_id as usize];

                            // Downloaded, so already known to need an install.
                            let needs_verify = false;
                            let is_pending_package_install = false;
                            installer.install_package_with_name_and_resolution(
                                ctx.dependency_id,
                                pkg_id,
                                log_level,
                                apply.pkgname,
                                resolution,
                                needs_verify,
                                is_pending_package_install,
                            );
                            installer.node_modules = prev_node_modules;
                            installer.current_tree_id = prev_tree_id;
                        }
                    }
                }
            } else {
                // Patch application failed - propagate error to cause install failure
                return Err(crate::Error::InstallFailed);
            }
        }
    }

    if cb.is_store_installer {
        // We obtain the
        // installer via the trait downcast and access PackageManager only
        // through `installer.manager` for the duration of this block, never
        // via the function-scope `manager` shadow, so the two `&mut` do not
        // overlap in use.
        let installer: &mut Store::Installer<'_> = cb.store_installer(extract_ctx);
        let installer_ptr: *mut Store::Installer<'_> = installer;
        let batch = installer.task_queue.pop_batch();
        let mut iter = batch.iterator();
        loop {
            let task_ptr = iter.next();
            if task_ptr.is_null() {
                break;
            }
            // SAFETY: `next()` returned non-null; node is exclusively owned by this batch.
            let task = unsafe { &mut *task_ptr };
            match &task.result {
                store_installer::Result::None => {
                    if Environment::CI_ASSERT {
                        unreachable!();
                    }
                    installer
                        .on_task_complete(task.entry_id, store_installer::CompleteState::Success);
                }
                store_installer::Result::Err(_) => {
                    // Move the error out: `on_task_fail` takes `&mut installer`, which owns `task`.
                    let store_installer::Result::Err(err) =
                        core::mem::replace(&mut task.result, store_installer::Result::None)
                    else {
                        unreachable!()
                    };
                    installer.on_task_fail(task.entry_id, &err);
                }
                store_installer::Result::Blocked => {
                    installer.on_task_blocked(task.entry_id);
                }
                store_installer::Result::RunScripts => {
                    installer.pending_lifecycle_scripts.push_back(task.entry_id);
                }
                store_installer::Result::Done => {
                    if Environment::CI_ASSERT {
                        // .monotonic is okay because we should have already synchronized with the
                        // completed task thread by virtue of popping from the `UnboundedQueue`.
                        let step = installer.store.entries.items_step()
                            [task.entry_id.get() as usize]
                            .load(Ordering::Relaxed);
                        assert!(step == store_installer::Step::Done as u32);
                    }
                    installer
                        .on_task_complete(task.entry_id, store_installer::CompleteState::Success);
                }
            }
        }

        // Relaxed is enough, because scripts are spawned and reaped on this thread.
        while LifecycleScriptSubprocess::alive_count().load(Ordering::Relaxed)
            < manager.options.max_concurrent_lifecycle_scripts
        {
            let Some(entry_id) = installer.pending_lifecycle_scripts.pop_front() else {
                break;
            };
            let node_id = installer.store.entries.items_node_id()[entry_id.get() as usize];
            let dep_id = installer.store.nodes.items_dep_id()[node_id.get() as usize];
            let pkg_id = installer.store.nodes.items_pkg_id()[node_id.get() as usize];
            let optional = !manager.is_package_required(dep_id, pkg_id);
            let list = installer.store.entries.items_scripts()[entry_id.get() as usize]
                .get()
                .expect("a queued entry has a scripts list");
            // SAFETY: `list` is the per-entry scripts slot owned by
            // `store.entries.items_scripts()[entry_id]`; this Task is
            // its sole consumer (see Installer.rs Result::RunScripts).
            let list_val = unsafe { (*list).clone() };
            // reborrow instead of moving the field out of `*installer`
            let command_ctx: Command::Context<'_> = &mut *installer.command_ctx;
            // `installer.manager == manager`, so this is called through the reborrow of
            // `manager_ptr`.
            let spawn_res = manager.spawn_package_lifecycle_scripts(
                command_ctx,
                list_val,
                optional,
                false,
                Some(InstallCtx::Isolated {
                    entry_id,
                    installer: installer_ptr,
                }),
            );
            if let Err(err) = spawn_res {
                // Relaxed is enough, because the task was popped from the queue and isn't running
                // anymore.
                installer.store.entries.items_step()[entry_id.get() as usize]
                    .store(store_installer::Step::Done as u32, Ordering::Relaxed);
                installer.on_task_fail(entry_id, &store_installer::TaskError::RunScripts(err));
            }
        }
    }

    let network_tasks_batch = manager.async_network_task_queue.pop_batch();
    let mut network_tasks_iter = network_tasks_batch.iterator();
    loop {
        let task_ptr = network_tasks_iter.next();
        if task_ptr.is_null() {
            break;
        }
        // SAFETY: `next()` returned non-null; node is exclusively owned by this batch.
        let task = unsafe { &mut *task_ptr };
        debug_assert!(manager.pending_task_count() > 0);
        manager.decrement_pending_tasks();
        // We cannot free the network task at the end of this scope.
        // It may continue to be referenced in a future task.

        match &mut task.callback {
            NetworkTaskCallback::PackageManifest {
                loaded_manifest,
                name,
                is_extended_manifest,
            } => {
                // reshaped for borrowck — capture the name's slice
                // pointer (`StringOrTinyString` is self-referential and not
                // `Clone`) so the loop body can read `name` after the
                // `&mut task.callback` borrow ends.
                // SAFETY: `name` lives in `task.callback` which outlives this
                // match arm (the task is only `put` back to the pool by a later
                // resolve-task pass, never inside this loop iteration).
                let name = unsafe { bun_ptr::detach_lifetime(name.slice()) };
                let is_extended_manifest = *is_extended_manifest;
                name_progress(manager, name, DOWNLOAD);

                // Headers can arrive and the connection still die before the
                // body does; for a 2xx/3xx that is a failed download too (an
                // error status keeps its own handling below).
                let (download_failed, retry) =
                    download_outcome(&task.response, manager.options.runtime_auto_install);
                if download_failed && task.retried > 0 {
                    throttle_after_network_error(manager, &mut has_network_error);
                }

                let err = task
                    .response
                    .fail
                    .map(crate::Error::from)
                    .unwrap_or(crate::Error::HTTPError);

                // Handle retry-able errors.
                if retry {
                    if task.retried
                        < manifest_retry_count(manager, task.task_id, name, task.response.fail)
                    {
                        task.retried += 1;
                        let wait =
                            retry_timer::retry(manager, task_ptr, task.retried, &task.response);
                        // `notify` keeps the metadata it finds here if the next attempt gets none.
                        task.response = Default::default();

                        if manager.options.log_level.is_verbose() {
                            bun_ast::add_warning_pretty!(
                                manager.log_mut(),
                                None,
                                bun_ast::Loc::EMPTY,
                                "{} downloading package manifest <b>{}<r>. Retry {}/{} in {}ms...",
                                bstr::BStr::new(err.name().as_bytes()),
                                bun_core::fmt::escape_control_chars(name),
                                task.retried,
                                manager.options.max_retry_count,
                                wait.as_millis(),
                            );
                        }

                        continue;
                    }

                    // Try once more, because the full document was only requested for `libc`.
                    if is_extended_manifest && manager.options.minimum_release_age_ms.is_none() {
                        task.retry_with_abbreviated_manifest(
                            manager.scope_for_package_name(name),
                            !manager.is_network_task_required(task.task_id),
                        )?;
                        enqueue::enqueue_network_task(manager, task_ptr);
                        continue;
                    }
                }

                let Some(metadata) = task.response.metadata.as_ref().filter(|_| !download_failed)
                else {
                    // Handle non-retry-able errors.
                    if cb.has_on_package_manifest_error {
                        (cb.on_package_manifest_error)(extract_ctx, name, err, &task.url_buf);
                        let _ = (manager.manifest_failures)
                            .insert(task.task_id, ManifestFailure::already_reported());
                    } else {
                        // The dependency that reports it decides between error and warning.
                        let is_required = manager.is_network_task_required(task.task_id)
                            || manager.task_queue.contains_key(&task.task_id);
                        let log_mark = manager.log_mut().msgs.len();
                        add_error_or_warning_pretty!(
                            manager.log_mut(),
                            is_required,
                            "{} downloading package manifest <b>{}<r>",
                            DownloadFailure(err.name(), &task.response),
                            bstr::BStr::new(name),
                        );

                        let failure = ManifestFailure {
                            is_unanswered: true,
                            ..Default::default()
                        };
                        if !leave_failure_to_dependencies(
                            cb,
                            manager,
                            extract_ctx,
                            install_peer,
                            task.task_id,
                            log_mark,
                            failure,
                        )? {
                            fail_update_requests(manager, task.task_id, name, None, is_required);
                        }
                    }

                    return_network_task(task_ptr);
                    continue;
                };
                let response = &metadata.response;

                if response.status_code > 399 {
                    if response.status_code == 404
                        && let Some(entry) = manager.network_dedupe_map.get_mut(&task.task_id)
                    {
                        entry.missing_until = npm::Registry::manifest_expiry(&response.headers);
                    }
                    if cb.has_on_package_manifest_error {
                        let err: PackageManifestError = match response.status_code {
                            400 => PackageManifestError::PackageManifestHTTP400,
                            401 => PackageManifestError::PackageManifestHTTP401,
                            402 => PackageManifestError::PackageManifestHTTP402,
                            403 => PackageManifestError::PackageManifestHTTP403,
                            404 => PackageManifestError::PackageManifestHTTP404,
                            405..=499 => PackageManifestError::PackageManifestHTTP4xx,
                            _ => PackageManifestError::PackageManifestHTTP5xx,
                        };

                        (cb.on_package_manifest_error)(
                            extract_ctx,
                            name,
                            err.into(),
                            &task.url_buf,
                        );
                        let _ = (manager.manifest_failures)
                            .insert(task.task_id, ManifestFailure::already_reported());

                        return_network_task(task_ptr);
                        continue;
                    }

                    // A dist-tag on the name of an unpublished workspace links the workspace, once
                    // `get_or_put_resolved_package` sees that the task has failed.
                    if response.status_code == 404
                        && !cb.manifests_only
                        && enqueue::has_linkable_workspace(
                            manager,
                            bun_semver::string::Builder::string_hash(name),
                        )
                    {
                        manager.mark_network_task_failed(task.task_id);
                        if !manager.task_queue.contains_key(&task.task_id) {
                            return_network_task(task_ptr);
                            continue;
                        }
                    }

                    // The dependency that reports it decides between error and warning.
                    let is_required = manager.is_network_task_required(task.task_id)
                        || manager.task_queue.contains_key(&task.task_id);
                    let log_mark = manager.log_mut().msgs.len();
                    if is_required {
                        bun_ast::add_error_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><red><b>GET<r><red> {}<d> - {}<r>",
                            bun_core::fmt::EscapeControlChars(bun_core::fmt::redacted_npm_url(
                                metadata.url.slice()
                            )),
                            response.status_code,
                        );
                    } else {
                        bun_ast::add_warning_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><yellow><b>GET<r><yellow> {}<d> - {}<r>",
                            bun_core::fmt::EscapeControlChars(bun_core::fmt::redacted_npm_url(
                                metadata.url.slice()
                            )),
                            response.status_code,
                        );
                    }
                    let failure = ManifestFailure {
                        is_missing: response.status_code == 404,
                        is_unanswered: retry,
                        ..Default::default()
                    };
                    if !leave_failure_to_dependencies(
                        cb,
                        manager,
                        extract_ctx,
                        install_peer,
                        task.task_id,
                        log_mark,
                        failure,
                    )? {
                        let is_unanswered = is_required && retry;
                        fail_update_requests(manager, task.task_id, name, None, is_unanswered);
                    }

                    return_network_task(task_ptr);
                    continue;
                }

                if log_level.is_verbose() {
                    bun_core::pretty_error!("    ");
                    Output::print_elapsed(
                        // SAFETY: `unsafe_http_client` was initialized by
                        // `for_manifest`/`for_tarball` before `schedule()`;
                        // direct field access (not `task.http()`) to keep the
                        // split borrow with `&mut task.callback` above.
                        (unsafe { task.unsafe_http_client.assume_init_ref() }.elapsed as f64)
                            / bun_core::time::NS_PER_MS as f64,
                    );
                    bun_core::pretty_error!(
                        "\n<d>Downloaded <r><green>{}<r> versions\n",
                        bstr::BStr::new(name),
                    );
                    Output::flush();
                }

                if response.status_code == 304 {
                    // The HTTP request was cached
                    if let Some(mut manifest) = loaded_manifest.take() {
                        // If we requested extended manifest but we somehow got an abbreviated one, this is a bug
                        debug_assert!(!is_extended_manifest || manifest.pkg.has_extended_manifest);

                        manifest.pkg.public_max_age =
                            npm::Registry::manifest_expiry(&response.headers);

                        // reshaped for borrowck —
                        // `bun_collections::HashMap` lacks `get_or_put` for
                        // non-`Default` values, so insert by-value (overwriting
                        // any prior entry) and reborrow.
                        let name_hash = manifest.pkg.name.hash;
                        manager
                            .manifests
                            .hash_map
                            .insert(name_hash, ManifestEntry::Manifest(manifest));
                        manager.look_ahead.arrived.push(task.task_id);

                        if manager.options.enable.contains(Enable::MANIFEST_CACHE)
                            && let Ok(temp_dir) = directories::try_get_temporary_directory(manager)
                        {
                            // reshaped for borrowck — compute the
                            // `&mut`-taking directory accessors first so the
                            // shared `scope_for_package_name` / `manifests`
                            // borrows below do not overlap them. `save_async`
                            // only needs `&PackageManifest`, so reborrow the
                            // freshly-inserted entry immutably alongside the
                            // scope (both `&manager`, no conflict).
                            let tmp_fd = temp_dir.handle.fd;
                            let cache_fd = directories::get_cache_directory(manager);
                            npm::package_manifest::Serializer::save_async(
                                manager
                                    .manifests
                                    .hash_map
                                    .get(&name_hash)
                                    .unwrap()
                                    .manifest(),
                                manager.scope_for_package_name(name),
                                tmp_fd,
                                cache_fd,
                            );
                        }

                        // A task that `populate_manifest_cache` started has no entry.
                        if let Some(dependency_list_entry) =
                            manager.task_queue.get_mut(&task.task_id)
                        {
                            let dependency_list = core::mem::take(dependency_list_entry);

                            process_dependency_list_for_ctx(
                                cb,
                                manager,
                                &dependency_list,
                                extract_ctx,
                                install_peer,
                            )?;
                        }

                        return_network_task(task_ptr);
                        continue;
                    }
                }

                // reshaped — `enqueue_parse_npm_package` takes
                // `StringOrTinyString` by value; reconstruct from the slice we
                // captured (the original lives in `task.callback`, which the
                // enqueued resolve Task takes ownership of via `network`).
                let name_tiny = stored_string(name);
                // reshaped for borrowck — split the nested `&mut
                // manager` borrows (`task_batch.push` vs. `enqueue_*`).
                // SAFETY: `task_ptr` is non-null (checked by the iterator loop guard)
                // and exclusively owned by this batch; `manager` is the live PackageManager.
                let queued = unsafe {
                    enqueue::enqueue_parse_npm_package(manager, task.task_id, name_tiny, task_ptr)
                };
                manager.task_batch.push(ThreadPoolBatch::from(queued));
            }
            NetworkTaskCallback::Extract(extract) => {
                // reshaped for borrowck — `extract` borrows
                // `task.callback`; the body also calls `&mut self` methods on
                // `task` (`reset_streaming_for_retry`,
                // `discard_unused_streaming_state`) which only touch disjoint
                // fields. Detach via raw pointer (mirroring the
                // `PackageManifest` arm above) so those calls don't overlap.
                let extract_ptr: *mut ExtractTarball = extract;
                // SAFETY: `extract` lives in `task.callback`, which outlives
                // this match arm; the methods called on `task` below never
                // touch `task.callback` (see `NetworkTask::reset_streaming_*`
                // / `discard_unused_streaming_state`).
                let extract = unsafe { &mut *extract_ptr };
                // A committed stream publishes its result through the extract
                // Task, except when the connection failed mid-body:
                // `TarballStream::finish()` then un-commits and sends the
                // NetworkTask back here to be retried like any failed download.
                debug_assert!(!task.streaming_committed);

                let (download_failed, retry) =
                    download_outcome(&task.response, manager.options.runtime_auto_install);
                if download_failed && task.retried > 0 {
                    throttle_after_network_error(manager, &mut has_network_error);
                }

                let err = task
                    .response
                    .fail
                    .map(crate::Error::from)
                    .unwrap_or(crate::Error::TarballFailedToDownload);

                if retry {
                    if task.retried < manager.options.max_retry_count {
                        task.retried += 1;
                        let wait =
                            retry_timer::retry(manager, task_ptr, task.retried, &task.response);
                        task.reset_streaming_for_retry();

                        if manager.options.log_level.is_verbose() {
                            bun_ast::add_warning_pretty!(
                                manager.log_mut(),
                                None,
                                bun_ast::Loc::EMPTY,
                                "{} downloading tarball <b>{}@{}<r>. Retrying {}/{} in {}ms...",
                                bstr::BStr::new(err.name().as_bytes()),
                                bun_core::fmt::for_terminal(bstr::BStr::new(extract.name.slice())),
                                bun_core::fmt::for_terminal(
                                    extract
                                        .resolution
                                        .fmt(&manager.lockfile.buffers.string_bytes, PathSep::Auto),
                                ),
                                task.retried,
                                manager.options.max_retry_count,
                                wait.as_millis(),
                            );
                        }

                        continue;
                    }
                }

                // Past this point we will not retry. If streaming state was
                // allocated but never scheduled, release it now so the
                // pre-created Task goes back to the pool and the stream
                // buffers are freed. The buffered `enqueueExtractNPMPackage`
                // path below allocates its own Task.
                task.discard_unused_streaming_state(manager);

                let Some(metadata) = task.response.metadata.as_ref().filter(|_| !download_failed)
                else {
                    let Some(is_required) = cb.dispatch_tarball_error(
                        manager,
                        extract_ctx,
                        task.task_id,
                        extract.dependency_id,
                        extract.name.slice(),
                        &extract.resolution,
                        err,
                        &task.url_buf,
                    ) else {
                        continue;
                    };

                    add_error_or_warning_pretty!(
                        manager.log_mut(),
                        is_required,
                        "{} downloading tarball <b>{}@{}<r>",
                        DownloadFailure(err.name(), &task.response),
                        bun_core::fmt::for_terminal(bstr::BStr::new(extract.name.slice())),
                        bun_core::fmt::for_terminal(
                            extract
                                .resolution
                                .fmt(&manager.lockfile.buffers.string_bytes, PathSep::Auto),
                        ),
                    );
                    fail_update_requests(
                        manager,
                        task.task_id,
                        extract.name.slice(),
                        Some(extract.dependency_id),
                        is_required,
                    );

                    let _ = manager.task_queue.remove(&task.task_id);

                    continue;
                };

                let response = &metadata.response;

                if response.status_code > 399 {
                    let Some(is_required) = cb.dispatch_tarball_error(
                        manager,
                        extract_ctx,
                        task.task_id,
                        extract.dependency_id,
                        extract.name.slice(),
                        &extract.resolution,
                        match response.status_code {
                            400 => crate::Error::TarballHTTP400,
                            401 => crate::Error::TarballHTTP401,
                            402 => crate::Error::TarballHTTP402,
                            403 => crate::Error::TarballHTTP403,
                            404 => crate::Error::TarballHTTP404,
                            405..=499 => crate::Error::TarballHTTP4xx,
                            _ => crate::Error::TarballHTTP5xx,
                        },
                        &task.url_buf,
                    ) else {
                        continue;
                    };

                    if is_required {
                        bun_ast::add_error_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><red><b>GET<r><red> {}<d> - {}<r>",
                            bun_core::fmt::EscapeControlChars(bun_core::fmt::redacted_npm_url(
                                metadata.url.slice()
                            )),
                            response.status_code,
                        );
                    } else {
                        bun_ast::add_warning_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><yellow><b>GET<r><yellow> {}<d> - {}<r>",
                            bun_core::fmt::EscapeControlChars(bun_core::fmt::redacted_npm_url(
                                metadata.url.slice()
                            )),
                            response.status_code,
                        );
                    }
                    fail_update_requests(
                        manager,
                        task.task_id,
                        extract.name.slice(),
                        Some(extract.dependency_id),
                        // The manifest just listed this version, so an error status for its tarball
                        // counts as no response. It says nothing about the package's other
                        // versions.
                        is_required,
                    );

                    let _ = manager.task_queue.remove(&task.task_id);

                    continue;
                }

                if log_level.is_verbose() {
                    bun_core::pretty_error!("    ");
                    Output::print_elapsed(
                        // SAFETY: `unsafe_http_client` was initialized by
                        // `for_manifest`/`for_tarball` before `schedule()`;
                        // direct field access (not `task.http()`) to keep the
                        // split borrow with `&mut task.callback` above.
                        (unsafe { task.unsafe_http_client.assume_init_ref() }.elapsed as f64)
                            / bun_core::time::NS_PER_MS as f64,
                    );
                    bun_core::pretty_error!(
                        "<d> Downloaded <r><green>{}<r> tarball\n",
                        bun_core::fmt::for_terminal(bstr::BStr::new(extract.name.slice())),
                    );
                    Output::flush();
                }

                name_progress(manager, extract.name.slice(), EXTRACT);

                // reshaped for borrowck — split nested `&mut manager`.
                let queued = enqueue::enqueue_extract_npm_package(manager, &*extract, task_ptr);
                manager.task_batch.push(ThreadPoolBatch::from(queued));
            }
            _ => unreachable!(),
        }
    }

    let resolve_tasks_batch = manager.resolve_tasks.pop_batch();
    let mut resolve_tasks_iter = resolve_tasks_batch.iterator();
    loop {
        let task_ptr = resolve_tasks_iter.next();
        if task_ptr.is_null() {
            break;
        }
        debug_assert!(manager.pending_task_count() > 0);
        // raw-ptr capture — borrowck would reject overlapping `&mut`
        // with the loop body. Guard runs on every `continue`/`?`/fallthrough.
        // Phase B: have the iterator yield a pool guard that puts back on Drop.
        // SAFETY: `task_ptr` non-null per loop guard; node exclusively owned by this batch.
        let task = unsafe { &mut *task_ptr };
        // The per-iteration guards hold the function-scope provenance
        // root (`manager_ptr`) — the body shadow `manager` is a reborrow of
        // that same root (see the `FinishPass` setup), so dereffing the root in a
        // guard is valid both before *and* after every body use of the shadow
        // under Stacked Borrows.
        let _return_task = ReturnResolveTask {
            manager: manager_ptr,
            task: task_ptr,
        };
        manager.decrement_pending_tasks();

        // An error in a manifest is reported by the dependency that needs it, if there is one.
        let holds_log = task.tag == Task::Tag::PackageManifest
            && task.status == Task::Status::Fail
            && !cb.has_on_package_manifest_error;
        if !task.log.msgs.is_empty() && !holds_log {
            // `IntoLogWrite` is implemented for `*mut bun_core::io::Writer`,
            // not `&mut Writer` (the underlying `Writer` is the FFI shape).
            // Propagate the write error (WriteFailed) out of `run_tasks`.
            task.log.print(std::ptr::from_mut(Output::error_writer()))?;
            if task.log.errors > 0 {
                manager.any_failed_to_install = true;
            }
            task.log.reset();
        }

        match task.tag {
            Task::Tag::PackageManifest => {
                // capture the `*mut NetworkTask` up front — the
                // `&'a mut NetworkTask` field can't be moved out through
                // `ManuallyDrop`'s immutable `Deref` inside the guard.
                let _return_network_task = ReturnNetworkTask {
                    manager: manager_ptr,
                    task: &raw mut *task.request_package_manifest_mut().network,
                };
                if task.status == Task::Status::Fail {
                    let log_mark = manager.log_mut().msgs.len();
                    if holds_log {
                        task.log.append_to_with_recycled(manager.log_mut(), false);
                        task.log.reset();
                    }
                    let req = task.request_package_manifest();
                    let name = req.name.slice();
                    let err = task.err.unwrap_or(crate::Error::Failed);

                    if cb.has_on_package_manifest_error {
                        (cb.on_package_manifest_error)(
                            extract_ctx,
                            name,
                            err,
                            &req.network.url_buf,
                        );
                        let _ = (manager.manifest_failures)
                            .insert(task.id, ManifestFailure::already_reported());
                    } else {
                        bun_ast::add_error_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "{} parsing package manifest for <b>{}<r>",
                            err.name(),
                            bstr::BStr::new(name),
                        );
                        let failure = ManifestFailure {
                            spares_optional: false,
                            ..Default::default()
                        };
                        leave_failure_to_dependencies(
                            cb,
                            manager,
                            extract_ctx,
                            install_peer,
                            task.id,
                            log_mark,
                            failure,
                        )?;
                    }

                    continue;
                }
                debug_assert!(task.tag == Task::Tag::PackageManifest);
                // SAFETY: tag-guarded read of the active union arm; default placeholder restored immediately.
                let manifest: npm::PackageManifest = unsafe {
                    let m = core::mem::ManuallyDrop::take(&mut task.data.package_manifest);
                    task.data.package_manifest =
                        core::mem::ManuallyDrop::new(npm::PackageManifest::default());
                    m
                };
                let name_hash = manifest.pkg.name.hash;
                let progress_name: Option<Vec<u8>> = (log_level.show_progress()
                    && !has_updated_this_run.get()
                    && !cb.manifests_only)
                    .then(|| manifest.name().to_vec());

                manager.manifests.insert(name_hash, manifest)?;
                manager.look_ahead.arrived.push(task.id);
                if let Some(entry) = manager.network_dedupe_map.get_mut(&task.id) {
                    entry.manifest = crate::network_task::ManifestOrigin::Registry;
                }

                // A task that `populate_manifest_cache` started has no entry.
                if let Some(dependency_list_entry) = manager.task_queue.get_mut(&task.id) {
                    let dependency_list = core::mem::take(dependency_list_entry);

                    process_dependency_list_for_ctx(
                        cb,
                        manager,
                        &dependency_list,
                        extract_ctx,
                        install_peer,
                    )?;
                }

                if let Some(name) = progress_name {
                    manager.set_node_name::<true>(
                        manager.downloads_node_mut(),
                        &name,
                        ProgressStrings::DOWNLOAD_EMOJI.as_bytes(),
                    );
                    has_updated_this_run.set(true);
                }
            }
            Task::Tag::Extract | Task::Tag::LocalTarball => {
                // capture the `*mut NetworkTask` up front (only for the
                // Extract arm) so the guard need not move the `&mut` out
                // through `ManuallyDrop`'s immutable `Deref`.
                let _return_network_task = ReturnNetworkTask {
                    manager: manager_ptr,
                    task: if task.tag == Task::Tag::Extract {
                        &raw mut *task.request_extract_mut().network
                    } else {
                        core::ptr::null_mut()
                    },
                };

                // SAFETY: `task.tag` selects the active `task.request` union arm.
                let tarball = unsafe {
                    match task.tag {
                        Task::Tag::Extract => &task.request.extract.tarball,
                        Task::Tag::LocalTarball => &task.request.local_tarball.tarball,
                        _ => unreachable!(),
                    }
                };
                let dependency_id = tarball.dependency_id;
                let mut package_id = manager.lockfile.buffers.resolutions[dependency_id as usize];
                // SAFETY: `tarball` borrows `task.request` which is reborrowed
                // `&mut` below; the backing `StringOrTinyString` lives in the
                // pooled `Task` for the whole iteration and is not mutated.
                let alias = unsafe { bun_ptr::detach_lifetime(tarball.name.slice()) };
                let resolution = &tarball.resolution;

                if task.status == Task::Status::Fail {
                    let err = task.err.unwrap_or(crate::Error::TarballFailedToExtract);

                    // SAFETY: `task.tag` selects the active `task.request` union arm.
                    let fail_url: &[u8] = unsafe {
                        match task.tag {
                            Task::Tag::Extract => &(*task.request.extract.network).url_buf,
                            Task::Tag::LocalTarball => {
                                task.request.local_tarball.tarball.url.slice()
                            }
                            _ => unreachable!(),
                        }
                    };
                    // A linker's `local_tarball` task is not in the map, so it gets no mark.
                    let Some(is_required) = cb.dispatch_tarball_error(
                        manager,
                        extract_ctx,
                        task.id,
                        dependency_id,
                        alias,
                        resolution,
                        err,
                        fail_url,
                    ) else {
                        continue;
                    };

                    add_error_or_warning_pretty!(
                        manager.log_mut(),
                        is_required,
                        "{} extracting tarball from <b>{}<r>",
                        err.name(),
                        bun_core::fmt::for_terminal(bstr::BStr::new(alias)),
                    );
                    fail_update_requests(manager, task.id, alias, Some(dependency_id), false);

                    // Void-callback fallback (resolve phase): drain the
                    // `task_queue` entry too so a later install-phase
                    // `enqueuePackageForDownload` doesn't wedge on `found_existing`.
                    let _ = manager.task_queue.remove(&task.id);

                    continue;
                }

                manager.extracted_count += 1;
                bun_core::analytics::Features::extracted_packages_inc();

                if cb.has_on_extract {
                    if cb.is_package_installer {
                        cb.package_installer(extract_ctx)
                            .fix_cached_lockfile_package_slices();
                        (cb.on_extract_package_installer)(
                            extract_ctx,
                            task.id,
                            dependency_id,
                            // SAFETY: `task.tag` is Extract/LocalTarball — `data.extract`
                            // is the active union arm.
                            unsafe { &mut task.data.extract },
                            log_level,
                        );
                    } else if cb.is_store_installer {
                        (cb.on_extract_store_installer)(extract_ctx, task.id, task.data_extract());
                    } else {
                        unreachable!("unexpected context type");
                    }
                } else if manager.defers_remote_package(task.id, resolution) {
                    manager.keep_arrived_package(task.id, resolution, task.data_extract());
                    name_progress(manager, alias, EXTRACT);
                    continue;
                } else if let Some(pkg) = manager.process_extracted_tarball_package(
                    &mut package_id,
                    resolution,
                    // Tag-checked accessor (debug_asserts Extract|LocalTarball);
                    // shared `&task` here coexists with the field-disjoint
                    // `&task.request` borrow held via `resolution` above.
                    task.data_extract(),
                    log_level,
                ) {
                    resolve_waiters_and_notify(
                        cb,
                        manager,
                        extract_ctx,
                        task.id,
                        &pkg,
                        install_peer,
                    )?;
                } else if let Some(dependency_list_entry) =
                    manager.task_queue.get_mut(&Task::Id::for_manifest(
                        manager
                            .lockfile
                            .str(&manager.lockfile.packages.items_name()[package_id as usize]),
                    ))
                {
                    // Peer dependencies do not initiate any downloads of their own, thus need to be resolved here instead
                    for item in core::mem::take(dependency_list_entry).iter() {
                        manager.process_dependency_list_item(item, None, install_peer)?;
                    }
                }

                manager.set_preinstall_state(package_id, crate::PreinstallState::Done);

                name_progress(manager, alias, EXTRACT);
            }
            Task::Tag::GitClone => {
                let clone = task.request_git_clone();
                let repo_fd: bun_sys::Fd = task.data_git_clone();
                let name = clone.name.slice();
                let url = clone.url.slice();

                if task.status == Task::Status::Fail {
                    let err = task.err.unwrap_or(crate::Error::Failed);
                    let is_required = manager.is_network_task_required(task.id);
                    let waiters = forget_failed_git_task(manager, task.id, name);

                    if cb.has_on_package_manifest_error {
                        (cb.on_package_manifest_error)(extract_ctx, name, err, url);
                        continue;
                    }

                    if cb.is_store_installer {
                        // The isolated installer queued its entry contexts
                        // under `checkout_id`, not `clone_id`. A failed clone
                        // never reaches checkout, so drain every waiting
                        // checkout for this repo or the install loop blocks
                        // forever on the entry's pending-task slot.
                        for waiter in waiters.iter() {
                            let &bun_install::TaskCallbackContext::GitCheckout {
                                package_id, ..
                            } = waiter
                            else {
                                continue;
                            };
                            let res =
                                manager.lockfile.packages.items_resolution()[package_id as usize];
                            let git = res.git();
                            let checkout_id = Task::Id::for_git_checkout(
                                manager.lockfile.str(&git.repo),
                                manager.lockfile.str(&git.resolved),
                            );
                            if is_required {
                                (cb.on_package_download_error_store)(
                                    extract_ctx,
                                    checkout_id,
                                    name,
                                    &res,
                                    err,
                                    url,
                                );
                            } else {
                                cb.store_installer(extract_ctx)
                                    .on_optional_package_download_error(checkout_id);
                            }
                        }
                    }

                    // If the dependency that requires it joined later, git's own output was only
                    // logged as warnings, so report the error here.
                    if !is_required || !cb.is_store_installer {
                        add_error_or_warning_pretty!(
                            manager.log_mut(),
                            is_required,
                            "{} cloning repository for <b>{}<r>",
                            err.name(),
                            bun_core::fmt::for_terminal(bstr::BStr::new(name)),
                        );
                    }
                    continue;
                }

                manager.git_repositories.insert(task.id, repo_fd);

                // `bun pm fetch` has no installer, but like an installer, it queues its checkouts
                // on the clone task.
                let has_checkout_waiters = cb.has_on_extract
                    || manager.task_queue.get(&task.id).is_some_and(|waiters| {
                        waiters.iter().any(|waiter| {
                            matches!(waiter, bun_install::TaskCallbackContext::GitCheckout { .. })
                        })
                    });
                if has_checkout_waiters {
                    // Installing! The clone task is shared by every dependency on
                    // this repo URL; enqueue a checkout per waiter, not just one.
                    let Some(waiters) = manager.task_queue.remove(&task.id) else {
                        continue;
                    };
                    for waiter in waiters.iter() {
                        let &bun_install::TaskCallbackContext::GitCheckout {
                            dependency_id: dep_id,
                            package_id,
                        } = waiter
                        else {
                            continue;
                        };
                        // reshaped for borrowck — copy the small `String` handles
                        // so the `&manager.lockfile` borrow doesn't extend across
                        // the `&mut manager` calls below.
                        let (dep_name_handle, is_required) = {
                            let dep = &manager.lockfile.buffers.dependencies[dep_id as usize];
                            (dep.name, dep.behavior.is_required())
                        };
                        let res = manager.lockfile.packages.items_resolution()[package_id as usize];
                        let git = *res.git();
                        // SAFETY: `string_bytes` lives as long as `manager.lockfile`
                        // and is not reallocated while resolve tasks are draining.
                        let string_buf = unsafe {
                            bun_ptr::detach_lifetime(
                                manager.lockfile.buffers.string_bytes.as_slice(),
                            )
                        };
                        let dep_name = dep_name_handle.slice(string_buf);
                        let repo = git.repo.slice(string_buf);
                        let resolved = git.resolved.slice(string_buf);

                        let checkout_id = Task::Id::for_git_checkout(repo, resolved);

                        if manager.has_created_network_task(checkout_id, is_required) {
                            continue;
                        }

                        // reshaped for borrowck — split nested `&mut manager`.
                        let queued = enqueue::enqueue_git_checkout(
                            manager,
                            checkout_id,
                            repo_fd,
                            dep_id,
                            dep_name,
                            &res,
                            resolved,
                            None,
                        );
                        manager.enqueue_git_task(queued);
                    }
                } else {
                    // Resolving!
                    let dependency_list = manager
                        .task_queue
                        .remove(&task.id)
                        .expect("infallible: task queued");

                    process_dependency_list_for_ctx(
                        cb,
                        manager,
                        &dependency_list,
                        extract_ctx,
                        install_peer,
                    )?;
                }

                name_progress(manager, name, DOWNLOAD);
            }
            Task::Tag::GitCommit => {
                let commit = task.request_git_commit();
                let name = commit.name.slice();
                let url = commit.url.slice();
                // Pending while it ran, but not one of the N downloads the summary prints.
                manager.total_tasks -= 1;

                if task.status == Task::Status::Fail {
                    let err = task.err.unwrap_or(crate::Error::Failed);
                    let is_required = manager.is_network_task_required(task.id);
                    // The repository (with `--offline`, its cached clone) has no such commit.
                    for waiter in forget_failed_git_task(manager, task.id, name).iter() {
                        if let &bun_install::TaskCallbackContext::Dependency(id) = waiter {
                            manager.lockfile.unbind_refreshing(id);
                        }
                    }
                    if cb.has_on_package_manifest_error {
                        (cb.on_package_manifest_error)(extract_ctx, name, err, url);
                    } else {
                        add_error_or_warning(
                            manager.log_mut(),
                            is_required,
                            format_args!(
                                "no commit matching \"{}\" found for \"{}\" (but repository exists)",
                                bun_core::fmt::escape_control_chars(commit.committish.slice()),
                                bun_core::fmt::for_terminal(bstr::BStr::new(name)),
                            ),
                        );
                    }
                    continue;
                }

                manager
                    .git_commits
                    .insert(task.id, task.data_git_commit().clone());

                // Each waiter re-enters the enqueue path and now finds the commit.
                let dependency_list = manager
                    .task_queue
                    .remove(&task.id)
                    .expect("infallible: task queued");
                process_dependency_list_for_ctx(
                    cb,
                    manager,
                    &dependency_list,
                    extract_ctx,
                    install_peer,
                )?;
            }
            Task::Tag::GitCheckout => {
                // SAFETY: `task.tag == GitCheckout` — active union arm.
                let git_checkout = unsafe { &*task.request.git_checkout };
                let alias = &git_checkout.name;
                let resolution = &git_checkout.resolution;
                let mut package_id: PackageID = INVALID_PACKAGE_ID;

                if task.status == Task::Status::Fail {
                    let err = task.err.unwrap_or(crate::Error::Failed);

                    if cb.has_on_package_download_error && cb.is_store_installer {
                        // SAFETY: `resolution.tag == Git` — git-checkout tasks are
                        // only enqueued for git resolutions; `value.git` is the
                        // active union arm.
                        let repo = &resolution.git().repo;
                        (cb.on_package_download_error_store)(
                            extract_ctx,
                            task.id,
                            alias.slice(),
                            resolution,
                            err,
                            manager.lockfile.str(repo),
                        );
                    } else {
                        bun_ast::add_error_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "{} checking out repository for <b>{}<r>",
                            err.name(),
                            bun_core::fmt::for_terminal(bstr::BStr::new(alias.slice())),
                        );
                        let _ = forget_failed_git_task(manager, task.id, alias.slice());
                    }

                    continue;
                }

                manager.extracted_count += 1;
                bun_core::analytics::Features::extracted_packages_inc();

                if cb.has_on_extract {
                    // We've populated the cache, package already exists in memory. Call the package installer callback
                    // and don't enqueue dependencies
                    if cb.is_package_installer {
                        // TODO(dylan-conway) most likely don't need to call this now that the package isn't appended, but
                        // keeping just in case for now
                        cb.package_installer(extract_ctx)
                            .fix_cached_lockfile_package_slices();

                        (cb.on_extract_package_installer)(
                            extract_ctx,
                            task.id,
                            git_checkout.dependency_id,
                            // SAFETY: `task.tag == GitCheckout` — `data.git_checkout`
                            // is the active union arm.
                            unsafe { &mut task.data.git_checkout },
                            log_level,
                        );
                    } else if cb.is_store_installer {
                        (cb.on_extract_store_installer)(
                            extract_ctx,
                            task.id,
                            task.data_git_checkout(),
                        );
                    } else {
                        unreachable!("unexpected context type");
                    }
                } else if manager.defers_remote_package(task.id, resolution) {
                    manager.keep_arrived_package(task.id, resolution, task.data_git_checkout());
                } else if let Some(pkg) = manager.process_extracted_tarball_package(
                    &mut package_id,
                    resolution,
                    // Tag-checked accessor (debug_asserts GitCheckout); shared
                    // `&task` here coexists with the field-disjoint
                    // `&task.request` borrow held via `git_checkout` above.
                    task.data_git_checkout(),
                    log_level,
                ) {
                    resolve_waiters_and_notify(
                        cb,
                        manager,
                        extract_ctx,
                        task.id,
                        &pkg,
                        install_peer,
                    )?;
                }

                name_progress(manager, alias.slice(), DOWNLOAD);
            }
        }
    }

    Ok(())
}

/// Returns `(failed, retry)`. `failed` means the connection died before a response, or during a 2xx
/// or 3xx response. `blocking` means the caller blocks on this one request, so it isn't retried
/// after a timeout or a 501 (Not Implemented).
pub(crate) fn download_outcome(
    response: &http::HTTPClientResult<'static>,
    blocking: bool,
) -> (bool, bool) {
    let proxy_status = response
        .proxy_connect_response
        .as_ref()
        .map(|reply| reply.response.status_code);
    let failed = match &response.metadata {
        None => proxy_status.is_none(),
        Some(m) => response.fail.is_some() && m.response.status_code < 400,
    };
    let status = response
        .metadata
        .as_ref()
        .map(|m| m.response.status_code)
        .or(proxy_status);
    // Another attempt would fail in the same way.
    let is_final = matches!(
        response.fail,
        Some(
            http::Error::Cert(_)
                | http::Error::ERR_TLS_CERT_ALTNAME_INVALID
                | http::Error::TooManyRedirects
        )
    );
    // `connect_errno` is a Winsock code on Windows: WSAETIMEDOUT.
    const CONNECT_TIMED_OUT: i32 = if cfg!(windows) {
        10060
    } else {
        bun_errno::SystemErrno::ETIMEDOUT as i32
    };
    let silence = matches!(response.fail, Some(http::Error::Timeout))
        || response.connect_errno == CONNECT_TIMED_OUT;
    let retry = !is_final
        && !(blocking && (silence || status == Some(501)))
        && (failed || status.is_some_and(|status| status > 499 || status == 429 || status == 408));
    (failed, retry)
}

/// `ProxyConnectFailed (407)`: a refused CONNECT is reported with the proxy's status.
struct DownloadFailure<'a>(&'static str, &'a http::HTTPClientResult<'static>);

impl core::fmt::Display for DownloadFailure<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.0)?;
        match &self.1.proxy_connect_response {
            Some(reply) => write!(f, " ({})", reply.response.status_code),
            None => Ok(()),
        }
    }
}

impl PackageManager {
    #[inline]
    pub(crate) fn pending_task_count(&self) -> u32 {
        self.pending_tasks.load(Ordering::Acquire) + self.retry_queue.len() as u32
    }

    #[inline]
    pub(crate) fn increment_pending_tasks(&mut self, count: u32) {
        self.total_tasks += count;
        // Relaxed is enough, because starting a task has no side effects that other threads depend
        // on.
        let _ = self.pending_tasks.fetch_add(count, Ordering::Relaxed);
    }

    #[inline]
    pub(crate) fn decrement_pending_tasks(&mut self) {
        let _ = self.pending_tasks.fetch_sub(1, Ordering::Release);
    }
}

pub fn flush_network_queue(this: &mut PackageManager) {
    while let Some(network_task) = this
        .network_task_fifo
        .read_item()
        .or_else(|| this.retry_queue.pop_due())
    {
        // SAFETY: both queues store live `*mut NetworkTask` pushed by
        // `enqueue_network_task` / `retry_timer::retry`; exclusive ownership transferred here.
        let nt = unsafe { &mut *network_task };
        nt.schedule(if matches!(nt.callback, NetworkTaskCallback::Extract(_)) {
            &mut this.network_tarball_batch
        } else {
            &mut this.network_resolve_batch
        });
    }
}

pub fn flush_patch_task_queue(this: &mut PackageManager) {
    while let Some(patch_task) = this.patch_task_fifo.read_item() {
        // SAFETY: fifo stores live `*mut PatchTask` pushed by
        // `enqueue_patch_task`; exclusive ownership transferred here.
        let pt = unsafe { &mut *patch_task };
        pt.schedule(if matches!(pt.callback, PatchTaskCallback::Apply(_)) {
            &mut this.patch_apply_batch
        } else {
            &mut this.patch_calc_hash_batch
        });
    }
}

pub fn flush_dependency_queue(this: &mut PackageManager) {
    let mut last_count = this.total_tasks;
    loop {
        flush_network_queue(this);
        enqueue::advance(this);
        flush_network_queue(this);
        flush_patch_task_queue(this);

        if this.total_tasks == last_count {
            break;
        }
        last_count = this.total_tasks;
    }
}

pub fn schedule_tasks(manager: &mut PackageManager) -> usize {
    let count = manager.task_batch.len
        + manager.network_resolve_batch.len
        + manager.network_tarball_batch.len
        + manager.patch_apply_batch.len
        + manager.patch_calc_hash_batch.len;

    manager.increment_pending_tasks(u32::try_from(count).expect("int cast"));
    manager
        .thread_pool
        .schedule(core::mem::take(&mut manager.patch_apply_batch));
    manager
        .thread_pool
        .schedule(core::mem::take(&mut manager.patch_calc_hash_batch));
    manager
        .thread_pool
        .schedule(core::mem::take(&mut manager.task_batch));
    manager
        .network_resolve_batch
        .push(core::mem::take(&mut manager.network_tarball_batch));
    http::HTTPThread::schedule(core::mem::take(&mut manager.network_resolve_batch));
    // Git tasks were counted as pending when they were queued.
    manager.start_git_tasks();
    count
}

pub fn get_network_task(this: &mut PackageManager) -> *mut NetworkTask {
    // Forget the slot token so its `Drop` does not release the slot — the
    // caller owns the slot until a later `put()`.
    core::mem::ManuallyDrop::new(this.preallocated_network_tasks.claim())
        .addr()
        .as_ptr()
}

pub(crate) fn alloc_github_url_for_ref(
    this: &PackageManager,
    repository: &Repository,
    committish: &[u8],
) -> Vec<u8> {
    let mut github_api_url: &[u8] = b"https://api.github.com";
    if let Some(url) = this.env().get(b"GITHUB_API_URL") {
        if !url.is_empty() {
            github_api_url = url;
        }
    }

    let owner = this.lockfile.str(&repository.owner);
    let repo = this.lockfile.str(&repository.repo);

    let mut out = Vec::new();
    write!(
        &mut out,
        "{}/repos/{}/{}{}tarball/{}",
        bstr::BStr::new(strings::without_trailing_slash(github_api_url)),
        bstr::BStr::new(owner),
        bstr::BStr::new(repo),
        // repo might be empty if dep is https://github.com/... style
        if !repo.is_empty() { "/" } else { "" },
        bstr::BStr::new(committish),
    )
    .expect("unreachable");
    out
}

/// A later dependency that joins an entry left in `task_queue` waits forever. Returns the waiters.
fn forget_failed_git_task(
    this: &mut PackageManager,
    task_id: Task::Id,
    name: &[u8],
) -> TaskCallbackList {
    fail_update_requests(this, task_id, name, None, false);
    let _ = this.network_dedupe_map.remove(&task_id);
    this.task_queue.remove(&task_id).unwrap_or_default()
}

/// How often a failed manifest request is retried. When `bunx` already has a copy of the tool, it
/// only asks once whether that copy is the latest, and runs the copy if it gets no answer.
fn manifest_retry_count(
    manager: &PackageManager,
    task_id: Task::Id,
    name: &[u8],
    fail: Option<http::Error>,
) -> u16 {
    if bun_core::env_var::feature_flag::BUN_INTERNAL_BUNX_HAS_COPY.get() == Some(true)
        && is_bunx_install()
        && (manager.update_requests.iter()).any(|request| strings::eql(request.name, name))
    {
        return 0;
    }
    // No dependency is waiting for this manifest. It's only nice to have, for example for the bins
    // of a migrated lockfile, so without a network connection it isn't retried.
    // `FailedToOpenSocket` means that `connect(2)` itself failed, as it does on macOS for a closed
    // loopback port.
    if matches!(
        fail,
        Some(
            http::Error::ConnectionRefused
                | http::Error::DNSResolveFailed
                | http::Error::FailedToOpenSocket
        )
    ) && !manager.is_network_task_required(task_id)
        && !manager.task_queue.contains_key(&task_id)
    {
        return 0;
    }
    manager.options.max_retry_count
}

/// Set when a download for a package named on the command line ran out of attempts, and no attempt
/// got an answer about the package.
static REQUEST_GOT_NO_ANSWER: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

/// The exit code (`EX_TEMPFAIL`) that tells `bunx` that the `bun add` it spawned couldn't reach the
/// registry, and that it linked and saved nothing.
pub const BUNX_REGISTRY_UNREACHABLE: u32 = 75;

/// Returns true if `dir`, the directory of the root package.json, is where `bunx` spawned its `bun
/// add`. A command that merely inherits the environment variable runs in another directory and gets
/// no special treatment.
pub fn is_bunx_tree(dir: &[u8]) -> bool {
    let Some(tree) = bun_core::env_var::BUN_INTERNAL_BUNX_INSTALL.get() else {
        return false;
    };
    if !bun_paths::is_absolute(tree) {
        return false;
    }
    let [tree, dir] = [tree, dir].map(strings::without_trailing_slash);
    if tree == dir {
        return true;
    }
    // `dir` comes from `getcwd`, which resolves the symlinks in the path that `bunx` passed.
    let mut real_tree = bun_paths::path_buffer_pool::get();
    let mut real_dir = bun_paths::path_buffer_pool::get();
    match (
        bun_sys::realpath(&bun_core::ZBox::from_bytes(tree), &mut real_tree),
        bun_sys::realpath(&bun_core::ZBox::from_bytes(dir), &mut real_dir),
    ) {
        (Ok(tree), Ok(dir)) => tree == dir,
        _ => false,
    }
}

fn is_bunx_install() -> bool {
    is_bunx_tree(crate::bun_fs::FileSystem::instance().top_level_dir())
}

/// The error that a command returns when a request failed before it linked or saved anything.
pub(crate) fn failed_request_error() -> crate::Error {
    if REQUEST_GOT_NO_ANSWER.load(Ordering::Relaxed) && is_bunx_install() {
        bun_core::Global::exit(BUNX_REGISTRY_UNREACHABLE);
    }
    crate::Error::InstallFailed
}

/// The contents of the package.json in `bunx`'s install directory while packages are being linked.
/// If `bunx` finds this content later, the install didn't finish.
pub const BUNX_UNFINISHED_PACKAGE_JSON: &[u8] = b"{}\n";

/// Called right before anything is linked. Up to this point the copy that `bunx` already has is
/// untouched and still usable, so an install with errors stops here.
pub(crate) fn begin_linking_for_bunx(root_package_json_path: &bun_core::ZStr, had_errors: bool) {
    if !bun_paths::dirname(root_package_json_path.as_bytes()).is_some_and(is_bunx_tree) {
        return;
    }
    if had_errors {
        bun_core::Global::crash();
    }
    let _ = bun_sys::File::write_file(
        bun_sys::Fd::cwd(),
        root_package_json_path,
        BUNX_UNFINISHED_PACKAGE_JSON,
    );
}

/// `bun add` and `bun update <name>` exit 1 and save nothing when a download for the request fails.
/// `unanswered` means the download is required, and no attempt got a response about the package.
pub(crate) fn fail_update_requests(
    this: &mut PackageManager,
    task_id: Task::Id,
    package_name: &[u8],
    tarball_dependency_id: Option<DependencyID>,
    unanswered: bool,
) {
    if this.subcommand == Subcommand::Remove {
        return;
    }
    // Every package in `bunx`'s install directory is there for the one tool that it was asked to
    // run.
    let for_bunx = unanswered && is_bunx_install();
    let lockfile = &*this.lockfile;
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let waiters = this.task_queue.get(&task_id).map_or(&[][..], Vec::as_slice);
    // An npm tarball task has no waiters: the dependencies it was for already resolved to its package.
    // A dependency that is refreshed still has the package of bun.lock, which the task was not for.
    let package_id = tarball_dependency_id
        .filter(|&id| !lockfile.is_refreshing(id))
        .and_then(|id| resolutions.get(id as usize).copied())
        .filter(|&package_id| package_id != INVALID_PACKAGE_ID);
    let was_for = |id: DependencyID| {
        package_id.is_some_and(|package_id| resolutions.get(id as usize) == Some(&package_id))
            || waiters.iter().any(|waiter| {
                matches!(
                    waiter,
                    bun_install::TaskCallbackContext::Dependency(waiting)
                    | bun_install::TaskCallbackContext::RootDependency(waiting) if *waiting == id
                )
            })
    };
    let pending = this.pending_filtered_write.as_deref();

    let mut any_failed = false;
    for request in this.update_requests.iter_mut() {
        // A request names a package.json key, which an `npm:` alias or an override spells differently from `package_name`.
        let names_its_dependency = lockfile
            .workspaces_of_update_request(pending, this.workspace_name_hash, request)
            .into_iter()
            .any(|workspace_id| {
                let lists = lockfile.packages.items_dependencies();
                lists.get(workspace_id as usize).is_some_and(|list| {
                    (list.off..list.off + list.len).any(|id| {
                        dependencies
                            .get(id as usize)
                            .is_some_and(|dependency| request.matches(dependency, string_buf))
                            && was_for(id)
                    })
                })
            });
        if for_bunx || names_its_dependency || strings::eql(request.name, package_name) {
            request.failed = true;
            any_failed = true;
        }
    }
    if any_failed {
        this.options
            .do_
            .remove(Do::SAVE_LOCKFILE | Do::SAVE_YARN_LOCK | Do::INSTALL_PACKAGES);
        if unanswered {
            REQUEST_GOT_NO_ANSWER.store(true, Ordering::Relaxed);
        }
    }
}

/// Runs once per pass. Skipped for auto-install, because the limit also applies to `fetch()`.
fn throttle_after_network_error(manager: &PackageManager, has_network_error: &mut bool) {
    if manager.options.runtime_auto_install || core::mem::replace(has_network_error, true) {
        return;
    }
    let min = manager.options.min_simultaneous_requests;
    let max = AsyncHTTP::max_simultaneous_requests().load(Ordering::Relaxed);
    if max > min {
        let lowered = min.max(max - max / 4);
        AsyncHTTP::max_simultaneous_requests().store(lowered, Ordering::Relaxed);
        if manager.options.log_level.is_verbose() {
            bun_ast::add_warning_pretty!(
                manager.log_mut(),
                None,
                bun_ast::Loc::EMPTY,
                "request failed twice, limiting to {} concurrent requests",
                lowered,
            );
        }
    }
}

pub fn generate_network_task_for_tarball<'a>(
    this: &'a mut PackageManager,
    task_id: Task::Id,
    url: &[u8],
    is_required: bool,
    dependency_id: DependencyID,
    package: &Package,
    authorization: Authorization,
) -> Result<Option<&'a mut NetworkTask>, ForTarballError> {
    // Only reached when the tarball is not already extracted in the cache.
    if this.options.offline == Options::OfflineMode::Offline {
        let name = this.lockfile.str_detached(&package.name);
        enqueue::offline_miss(this, task_id, "", name, is_required);
        return Err(ForTarballError::Offline);
    }
    if this.has_created_network_task(task_id, is_required) {
        return Ok(None);
    }

    // reshaped for borrowck —
    // all `&mut this` uses (cache/temp dir, pool slot) happen
    // first; the immutable `pkg_name`/`scope` borrows are taken afterwards and
    // live only through `for_tarball`, leaving `this` free for the streaming
    // tail.
    // Borrowed views: `cache_dir` and `temp_dir` are owned by the `PackageManager`
    // singleton and the `TemporaryDirectory` once-cell, respectively. They flow
    // into `ExtractTarball::{cache_dir,temp_dir}`, which must be `Fd` (not `Dir`)
    // so the task's drop never closes them.
    let cache_dir = directories::get_cache_directory(this);
    let temp_dir = match directories::try_get_temporary_directory(this) {
        Ok(temp_dir) => temp_dir.handle.fd(),
        Err(why) => {
            this.exit_or_log(&why);
            this.mark_network_task_failed(task_id);
            // No task was started, so the entry is removed. Otherwise a later enqueue would wait
            // for a task that never runs.
            let _ = this.task_queue.remove(&task_id);
            return Err(ForTarballError::AlreadyFailed);
        }
    };
    // Backref address only — stored, not dereffed in this function. The tag is
    // immediately popped by the next `this` use; that's fine for a stored
    // back-pointer.
    let this_backref: *mut PackageManager = this;

    // Take the pool slot as a raw pointer so borrowck releases `this` for the
    // streaming-setup tail. Reborrowed `&mut` per-statement below.
    let net_ptr: *mut NetworkTask = get_network_task(this);
    // Full struct overwrite that resets
    // every other field (`retried`, `response`, `streaming_committed`,
    // `tarball_stream`, `streaming_extract_task`, `next`, `url_buf`,
    // `signal_store`) to its struct default. The slot may be uninitialized
    // (`HiveArrayFallback::get()` heap fallback) or stale (reused hive slot).
    // SAFETY: `net_ptr` is the unique handle to a freshly-vended pool slot; no
    // other alias exists until we return it.
    unsafe { NetworkTask::write_init(net_ptr, task_id, this_backref) };
    // SAFETY: `write_init` populated every field with a drop-safe value;
    // `unsafe_http_client` is `MaybeUninit` and overwritten by `for_tarball`.
    let network_task = unsafe { &mut *net_ptr };

    let pkg_name = this.lockfile.str(&package.name);
    let scope = this.scope_for_package_name(pkg_name);

    let extract_tarball = ExtractTarball {
        // BACKREF — `this_backref` is non-null (just derived from `&mut *this`)
        // and the PackageManager outlives every ExtractTarball it enqueues.
        // Safe `From<NonNull>` construction.
        package_manager: bun_ptr::BackRef::from(
            core::ptr::NonNull::new(this_backref).expect("derived from &mut, non-null"),
        ),
        name: stored_string(pkg_name),
        resolution: package.resolution,
        cache_dir,
        temp_dir,
        dependency_id,
        skip_verify: false,
        in_trusted_dependencies: this.lockfile.in_trusted_dependencies(pkg_name),
        integrity: package.meta.integrity,
        stays_unpinned: package.meta.id != bun_install::invalid_package_id && !this.pins_tarballs(),
        url: stored_string(url),
        // Copied here: extract workers must not read lockfile buffers.
        github_resolved: if package.resolution.tag == bun_install::ResolutionTag::Github {
            stored_string(this.lockfile.str(&package.resolution.github().resolved))
        } else {
            strings::StringOrTinyString::init(b"")
        },
    };

    if let Err(err) = network_task.for_tarball(extract_tarball, scope, authorization) {
        // No task will ever complete the dedupe entry, so a later enqueue would wait forever.
        this.mark_network_task_failed(task_id);
        return Err(err);
    }

    if extract_tarball::uses_streaming_extraction() {
        // Pre-create the extract Task and streaming state here on the
        // main thread: `preallocated_resolve_tasks` is not thread-safe,
        // and the streaming extractor needs a stable `Task` pointer so
        // it can push the result onto `resolve_tasks` when it finishes.
        //
        // Borrowck/SB: `create_extract_task_for_streaming` / `TarballStream::init`
        // need `&mut PackageManager` while `net_ptr` points into
        // `this.preallocated_network_tasks`. The pool slot is disjoint from
        // every other `this` field these calls touch (resolve-task pool,
        // allocator, options) and the network-task pool is never reallocated
        // or `put()` here, so we reborrow `*net_ptr` per-statement alongside
        // `this`. Phase B: have `get_network_task` return a pool index so this
        // intrusive-pointer pattern goes away.
        // SAFETY: see disjointness note above.
        let tarball_ref = unsafe {
            let NetworkTaskCallback::Extract(t) = &(*net_ptr).callback else {
                unreachable!()
            };
            t
        };
        let extract_task = enqueue::create_extract_task_for_streaming(this, tarball_ref, net_ptr);
        // SAFETY: `net_ptr` is the unique handle to the freshly-vended pool slot
        // (see `write_init` above); `TarballStream::init` returns a fresh
        // `heap::alloc` which we reclaim ownership of exactly once here.
        unsafe {
            (*net_ptr).streaming_extract_task = extract_task;
            (*net_ptr).tarball_stream = Some(bun_core::heap::take(TarballStream::init(
                extract_task,
                net_ptr,
                this,
            )));
        }
    }

    // SAFETY: final reborrow of the pool slot for the caller; `net_ptr` is the
    // sole live handle (see above) and outlives nothing past this return.
    Ok(Some(unsafe { &mut *net_ptr }))
}

impl PackageManager {
    pub fn drain_dependency_list(&mut self) {
        loop {
            // Step 2. If there were cached dependencies, go through all of those but don't download
            // the devDependencies for them.
            flush_dependency_queue(self);

            if PackageManager::verbose_install() {
                Output::flush();
            }

            // It's only network requests here because we don't store tarballs.
            let _ = schedule_tasks(self);

            // With no task left to finish, nothing would ever try the dependency at the front of
            // the queue again. It stays unresolved, so that the ones behind it get their turn.
            if self.pending_task_count() > 0 {
                break;
            }
            let queue = &mut self.lockfile.scratch.dependency_list_queue;
            let Some(head) = queue.head() else {
                // A package can be downloaded while the one whose turn comes first has failed in
                // a way that left its dependency waiting. Nothing else arrives, so it is added now.
                if self.append_next_remote_package(RemoteTurn::NothingElseArrives) {
                    continue;
                }
                break;
            };
            // However a request ends, it leaves a manifest or a `ManifestFailure` for `bind_row` to
            // find. A dependency that still waits here has been forgotten by one of those paths.
            if Environment::CI_ASSERT {
                unreachable!("a queued dependency waits for a task that is not pending");
            }
            queue.finish_rows_before(head, head.rows.off + 1);
            queue.waits_for = None;
        }
    }

    pub(crate) fn has_created_network_task(
        &mut self,
        task_id: Task::Id,
        is_required: bool,
    ) -> bool {
        let gpe = self
            .network_dedupe_map
            .get_or_put(task_id)
            .expect("unreachable");

        // if there's an existing network task that is optional, we want to make it non-optional if this one would be required
        gpe.value_ptr.is_required = if !gpe.found_existing {
            is_required
        } else {
            gpe.value_ptr.is_required || is_required
        };

        gpe.found_existing
    }

    pub(crate) fn is_network_task_required(&self, task_id: Task::Id) -> bool {
        match self.network_dedupe_map.get(&task_id) {
            Some(v) => v.is_required,
            None => true,
        }
    }

    pub(crate) fn mark_network_task_failed(&mut self, task_id: Task::Id) {
        let turn = self.event_loop.iteration_number();
        if let Some(entry) = self.network_dedupe_map.get_mut(&task_id) {
            entry.failed = true;
            entry.missed_in = Some(turn);
        }
    }
    pub(crate) fn network_task_has_failed(&self, task_id: Task::Id) -> bool {
        (self.network_dedupe_map.get(&task_id)).is_some_and(|e| e.failed)
    }

    pub(crate) fn alloc_github_url(&self, repository: &Repository) -> Vec<u8> {
        let committish = self.lockfile.str(&repository.committish);
        alloc_github_url_for_ref(self, repository, committish)
    }
}

/// A manifest request ended without a manifest, and the messages logged since `log_mark` say why.
/// Removes them from the log, because each dependency that needs the manifest reports the failure
/// when it's resolved. If no dependency asked for the manifest, `populate_manifest_cache` did, and
/// its caller reads the log. In that case this returns false and leaves the log alone.
fn leave_failure_to_dependencies(
    cb: &ErasedCallbacks,
    manager: &mut PackageManager,
    extract_ctx: *mut (),
    install_peer: bool,
    task_id: Task::Id,
    log_mark: usize,
    failure: ManifestFailure,
) -> crate::Result<bool> {
    let Some(waiting) = manager.task_queue.get_mut(&task_id).map(core::mem::take) else {
        let _ = (manager.manifest_failures).insert(task_id, ManifestFailure::already_reported());
        return Ok(false);
    };
    manager.keep_manifest_failure(task_id, log_mark, failure);
    // `advance` tries the queued dependencies again. Only imports of the runtime wait in this list.
    process_dependency_list_for_ctx(cb, manager, &waiting, extract_ctx, install_peer)?;
    Ok(true)
}

/// Resolves the rows that waited for a task, then calls `on_resolve` if a root dependency changed.
fn process_dependency_list_for_ctx(
    cb: &ErasedCallbacks,
    manager: &mut PackageManager,
    dependency_list: &TaskCallbackList,
    extract_ctx: *mut (),
    install_peer: bool,
) -> crate::Result<()> {
    let any_root = Cell::new(false);
    for item in dependency_list.iter() {
        manager.process_dependency_list_item(item, Some(&any_root), install_peer)?;
    }
    if cb.has_on_resolve && any_root.get() {
        (cb.on_resolve)(extract_ctx);
    }
    Ok(())
}
