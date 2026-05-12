use crate::lockfile::package::PackageColumns as _;
use core::cell::Cell;
use core::sync::atomic::Ordering;
use std::io::Write as _;

use bun_core::strings;
use bun_core::{self as bun, Environment, Output};
use bun_http::{self as http, AsyncHTTP};
use bun_threading::thread_pool::{self as thread_pool, Batch as ThreadPoolBatch};

use crate::extract_tarball;
use crate::network_task::Callback as NetworkTaskCallback;
use crate::npm;
use crate::patch_install::{self, Callback as PatchTaskCallback, PatchTask};
use crate::tarball_stream::TarballStream;
use bun_install::{
    DependencyID, ExtractTarball, INVALID_PACKAGE_ID, NetworkTask, PackageID, PackageManifestError,
    Repository,
};
// `Task::Id` etc. are namespaced types in Zig (`PackageManagerTask.Id`); import
// the *module* under the `Task` name so `Task::Id` resolves as a path.
use super::{
    Command, PackageInstaller, PackageManager, ProgressStrings, Subcommand, TaskCallbackList,
};
use super::{directories, enqueue};
use crate::dependency::Behavior;
use crate::isolated_install::installer as store_installer;
use crate::isolated_install::store::{EntryColumns as _, NodeColumns as _};
use crate::lifecycle_script_runner::InstallCtx;
use crate::network_task::{Authorization, ForTarballError};
use crate::package_manifest_map::Value as ManifestEntry;
use bun_core::fmt::PathSep;
use bun_install::lockfile::{Lockfile, Package};
use bun_install::package_manager_task as Task;
// `Options::LogLevel` etc. are namespaced types in Zig (`PackageManager.Options.LogLevel`);
// import the *module* under the `Options` name so `Options::LogLevel` resolves as a path
// (matches the `Task` module-alias pattern above and `CommandLineArguments.rs`).
use super::package_manager_options as Options;
use super::package_manager_options::{Do, Enable};
use crate::isolated_install::store as Store;

// ──────────────────────────────────────────────────────────────────────────
// Callbacks trait
// ──────────────────────────────────────────────────────────────────────────
//
// The Zig `runTasks` takes `comptime Ctx: type` + `comptime callbacks: anytype`
// and branches on `@TypeOf(callbacks.onExtract) != void`, `Ctx == *PackageInstaller`,
// etc. Rust models this as a single trait with associated consts gating the
// optional hooks (default-unreachable bodies), plus associated-const tags for
// the `Ctx` identity checks. Phase B should revisit whether the call sites can
// be split into 2–3 concrete impls instead of const-gated branches.
//
// TODO(port): callbacks trait — comptime duck-typing reshape; verify against
// the three call sites (`PackageInstaller`, `Store.Installer`, void) in Phase B.
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
        _err: bun_core::Error,
        _url: &[u8],
    ) {
        unreachable!()
    }

    // PORT NOTE: Zig calls `onPackageDownloadError` with two distinct shapes
    // depending on the comptime `Ctx`: `task.task_id: Task.Id` for
    // `*Store.Installer`, `package_id: PackageID` otherwise. Model the
    // comptime branch as static dispatch via two trait methods so impls
    // receive the correctly-typed id without a `Task::Id` round-trip pun.
    fn on_package_download_error_store(
        _ctx: &mut Self::Ctx,
        _task_id: Task::Id,
        _name: &[u8],
        _resolution: &bun_install::Resolution,
        _err: bun_core::Error,
        _url: &[u8],
    ) {
        unreachable!()
    }
    fn on_package_download_error_pkg(
        _ctx: &mut Self::Ctx,
        _package_id: PackageID,
        _name: &[u8],
        _resolution: &bun_install::Resolution,
        _err: bun_core::Error,
        _url: &[u8],
    ) {
        unreachable!()
    }

    // TODO(port): two distinct call shapes in Zig:
    //   PackageInstaller: (ctx, task_id, dependency_id, *ExtractData, log_level)
    //   Store.Installer:  (ctx, task_id)
    // Model as two methods; only one is reachable per impl.
    fn on_extract_package_installer(
        _ctx: &mut Self::Ctx,
        _task_id: Task::Id,
        _dependency_id: DependencyID,
        _data: &mut bun_install::ExtractData,
        _log_level: Options::LogLevel,
    ) {
        unreachable!()
    }
    fn on_extract_store_installer(_ctx: &mut Self::Ctx, _task_id: Task::Id) {
        unreachable!()
    }

    fn on_resolve(_ctx: &mut Self::Ctx) {
        unreachable!()
    }

    /// Reinterpret `&mut Self::Ctx` as `&mut PackageInstaller` — only valid
    /// when `IS_PACKAGE_INSTALLER` is true (Zig: `Ctx == *PackageInstaller`
    /// comptime check). Default body is unreachable; the `PackageInstaller`
    /// impl overrides it with an identity cast.
    fn as_package_installer<'a>(_ctx: &'a mut Self::Ctx) -> &'a mut PackageInstaller<'a> {
        unreachable!()
    }

    /// Reinterpret `&mut Self::Ctx` as `&mut Store::Installer` — only valid
    /// when `IS_STORE_INSTALLER` is true (Zig: `Ctx == *Store.Installer`
    /// comptime check). Default body is unreachable; the `Store::Installer`
    /// impl overrides it with an identity cast.
    fn as_store_installer<'a>(_ctx: &'a mut Self::Ctx) -> &'a mut Store::Installer<'a> {
        unreachable!()
    }
}

/// Called from isolated_install on the main thread.
pub fn run_tasks<C: RunTasksCallbacks>(
    manager: &mut PackageManager,
    extract_ctx: &mut C::Ctx,
    install_peer: bool,
    log_level: Options::LogLevel,
) -> Result<(), bun_core::Error> {
    // `Cell<bool>` so the `scopeguard::defer!` below can read it via `&self`
    // while the loop body sets it — no raw-ptr provenance dance needed.
    let has_updated_this_run = Cell::new(false);
    let mut has_network_error = false;

    let mut timestamp_this_tick: Option<u32> = None;

    // Zig: `defer { manager.drainDependencyList(); ... progress update ... }`
    // PORT NOTE: scopeguard captures `manager` via raw pointer because the loop
    // body holds `&mut` to it for the function's duration; `has_updated_this_run`
    // is a `Cell<bool>` so the guard captures it by shared ref. The guard runs
    // on every exit (incl. `?` early-returns), matching Zig `defer` semantics.
    //
    // Stacked Borrows: the raw pointers must remain the provenance root for all
    // body accesses, otherwise the first direct use of the `&mut` fn params
    // would pop the raw tags and the guard derefs become UB. We therefore
    // shadow the params with reborrows *through* the raw pointers — every body
    // use of `manager`/`extract_ctx` below is a child of `*_ptr`, so the
    // pointers stay valid until the guards fire.
    let manager_ptr: *mut PackageManager = manager;
    let extract_ctx_ptr: *mut C::Ctx = extract_ctx;
    // SAFETY: `manager_ptr`/`extract_ctx_ptr` were just derived from unique
    // `&mut` fn params; reborrowing here yields the sole live `&mut` to each
    // for the body. Dropped before the guards reborrow the same pointers.
    let manager = unsafe { &mut *manager_ptr };
    let extract_ctx = unsafe { &mut *extract_ctx_ptr };
    scopeguard::defer! {
        // SAFETY: guard drops after every body borrow of `manager` has ended
        // (scope exit or `?` unwind); `manager_ptr` retains provenance because
        // the body only ever accessed that allocation through reborrows of it.
        let manager = unsafe { &mut *manager_ptr };
        manager.drain_dependency_list();

        if log_level.show_progress() {
            manager.start_progress_bar_if_none();

            if C::PROGRESS_BAR {
                let completed_items = (manager.total_tasks - manager.pending_task_count()) as usize;
                // SAFETY: `downloads_node` set by `start_progress_bar_if_none`;
                // points into `manager.progress` which is live.
                let node = manager.downloads_node_mut();
                if completed_items != node.unprotected_completed_items.load(Ordering::Relaxed)
                    || has_updated_this_run.get()
                {
                    node.set_completed_items(completed_items);
                    node.set_estimated_total_items(manager.total_tasks as usize);
                }
            }
            manager.downloads_node_mut().activate();
            manager.progress.maybe_refresh();
        }
    };

    let patch_tasks_batch = manager.patch_task_queue.pop_batch();
    let mut patch_tasks_iter = patch_tasks_batch.iterator();
    loop {
        let ptask_ptr = patch_tasks_iter.next();
        if ptask_ptr.is_null() {
            break;
        }
        // SAFETY: `next()` returned non-null; node is exclusively owned by this
        // batch. `ptask_ptr` was produced by `heap::alloc` in `PatchTask::new_*`
        // — reclaim ownership exactly once here so the `Box` drops at end of
        // iteration on every path (Zig: `defer ptask.deinit();`).
        let mut ptask = unsafe { bun_core::heap::take(ptask_ptr) };
        if cfg!(debug_assertions) {
            debug_assert!(manager.pending_task_count() > 0);
        }
        manager.decrement_pending_tasks();
        ptask.run_from_main_thread(manager, log_level)?;
        if let PatchTaskCallback::Apply(apply) = &mut ptask.callback {
            if apply.logger.errors == 0 {
                if C::HAS_ON_EXTRACT {
                    if let Some(_task_id) = apply.task_id {
                        // autofix
                    } else if C::IS_PACKAGE_INSTALLER {
                        if let Some(ctx) = apply.install_context.as_mut() {
                            // Zig: `Ctx == *PackageInstaller` so `extract_ctx`
                            // *is* the installer.
                            let installer: &mut PackageInstaller =
                                C::as_package_installer(extract_ctx);
                            let path = core::mem::take(&mut ctx.path);
                            // Zig: `ctx.path = std.array_list.Managed(u8).init(bun.default_allocator);`
                            // → `Vec::new()` via `mem::take` above.
                            installer.node_modules.path = path;
                            installer.current_tree_id = ctx.tree_id;
                            let pkg_id = apply.pkg_id;
                            let resolution =
                                &manager.lockfile.packages.items_resolution()[pkg_id as usize];

                            installer.install_package_with_name_and_resolution::<false, false>(
                                ctx.dependency_id,
                                pkg_id,
                                log_level,
                                apply.pkgname,
                                resolution,
                            );
                        }
                    }
                }
            } else {
                // Patch application failed - propagate error to cause install failure
                return Err(bun_core::err!("InstallFailed"));
            }
        }
    }

    if C::IS_STORE_INSTALLER {
        // PORT NOTE: reshaped for borrowck — Zig writes `const installer:
        // *Store.Installer = extract_ctx;` and freely aliases
        // `installer.manager` with the outer `manager`. Here we obtain the
        // installer via the trait downcast and access PackageManager only
        // through `installer.manager` for the duration of this block, never
        // via the function-scope `manager` shadow, so the two `&mut` do not
        // overlap in use.
        let installer: &mut Store::Installer<'_> = C::as_store_installer(extract_ctx);
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
                        bun_core::assert_with_location(false, core::panic::Location::caller());
                    }
                    installer
                        .on_task_complete(task.entry_id, store_installer::CompleteState::Success);
                }
                store_installer::Result::Err(err) => {
                    let err = err.clone();
                    installer.on_task_fail(task.entry_id, err);
                }
                store_installer::Result::Blocked => {
                    installer.on_task_blocked(task.entry_id);
                }
                &store_installer::Result::RunScripts(list) => {
                    let entry_id = task.entry_id;
                    let node_id = installer.store.entries.items_node_id()[entry_id.get() as usize];
                    let dep_id = installer.store.nodes.items_dep_id()[node_id.get() as usize];
                    let dep = &installer.lockfile().buffers.dependencies[dep_id as usize];
                    let optional = dep.behavior.contains(Behavior::OPTIONAL);
                    // SAFETY: `list` is the per-entry scripts slot owned by
                    // `store.entries.items_scripts()[entry_id]`; this Task is
                    // its sole consumer (see Installer.rs Yield::RunScripts).
                    // Zig: `list.*` — by-value copy of the List.
                    let list_val = unsafe { (*list).clone() };
                    // PORT NOTE: reshaped for borrowck — `Command::Context<'a>`
                    // is `&'a mut ContextData`; reborrow instead of moving the
                    // field out of `*installer`.
                    let command_ctx: Command::Context<'_> = &mut *installer.command_ctx;
                    // PORT NOTE: `installer.manager == manager` (same allocation,
                    // see fn-signature note); call via the body shadow which is a
                    // reborrow of `manager_ptr` — no extra unsafe alias needed.
                    let spawn_res = manager.spawn_package_lifecycle_scripts(
                        command_ctx,
                        list_val,
                        optional,
                        false,
                        Some(InstallCtx {
                            entry_id,
                            installer: installer_ptr,
                        }),
                    );
                    if let Err(err) = spawn_res {
                        // .monotonic is okay for the same reason as `.done`: we popped this
                        // task from the `UnboundedQueue`, and the task is no longer running.
                        installer.store.entries.items_step()[entry_id.get() as usize]
                            .store(store_installer::Step::Done as u32, Ordering::Relaxed);
                        installer
                            .on_task_fail(entry_id, store_installer::TaskError::RunScripts(err));
                    }
                }
                store_installer::Result::Done => {
                    if Environment::CI_ASSERT {
                        // .monotonic is okay because we should have already synchronized with the
                        // completed task thread by virtue of popping from the `UnboundedQueue`.
                        let step = installer.store.entries.items_step()
                            [task.entry_id.get() as usize]
                            .load(Ordering::Relaxed);
                        bun_core::assert_with_location(
                            step == store_installer::Step::Done as u32,
                            core::panic::Location::caller(),
                        );
                    }
                    installer
                        .on_task_complete(task.entry_id, store_installer::CompleteState::Success);
                }
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
        if cfg!(debug_assertions) {
            debug_assert!(manager.pending_task_count() > 0);
        }
        manager.decrement_pending_tasks();
        // We cannot free the network task at the end of this scope.
        // It may continue to be referenced in a future task.

        match &mut task.callback {
            NetworkTaskCallback::PackageManifest {
                loaded_manifest,
                name,
                is_extended_manifest,
            } => {
                // PORT NOTE: reshaped for borrowck — capture the name's slice
                // pointer (`StringOrTinyString` is self-referential and not
                // `Clone`) so the loop body can read `name` after the
                // `&mut task.callback` borrow ends.
                // SAFETY: `name` lives in `task.callback` which outlives this
                // match arm (the task is only `put` back to the pool by a later
                // resolve-task pass, never inside this loop iteration).
                let name = unsafe { bun_ptr::detach_lifetime(name.slice()) };
                let is_extended_manifest = *is_extended_manifest;
                if log_level.show_progress() {
                    if !has_updated_this_run.get() {
                        manager.set_node_name::<true>(
                            manager.downloads_node_mut(),
                            name,
                            ProgressStrings::DOWNLOAD_EMOJI.as_bytes(),
                        );
                        has_updated_this_run.set(true);
                    }
                }

                if !has_network_error && task.response.metadata.is_none() {
                    has_network_error = true;
                    let min = manager.options.min_simultaneous_requests;
                    let max = AsyncHTTP::max_simultaneous_requests().load(Ordering::Relaxed);
                    if max > min {
                        AsyncHTTP::max_simultaneous_requests()
                            .store(min.max(max / 2), Ordering::Relaxed);
                    }
                }

                // Handle retry-able errors.
                if task.response.metadata.is_none()
                    || task
                        .response
                        .metadata
                        .as_ref()
                        .unwrap()
                        .response
                        .status_code
                        > 499
                {
                    let err = task.response.fail.unwrap_or(bun_core::err!("HTTPError"));

                    if task.retried < manager.options.max_retry_count {
                        task.retried += 1;
                        enqueue::enqueue_network_task(manager, task_ptr);

                        if manager.options.log_level.is_verbose() {
                            bun_ast::add_warning_pretty!(
                                manager.log_mut(),
                                None,
                                bun_ast::Loc::EMPTY,
                                "{} downloading package manifest <b>{}<r>. Retry {}/{}...",
                                bstr::BStr::new(err.name().as_bytes()),
                                bstr::BStr::new(name),
                                task.retried,
                                manager.options.max_retry_count,
                            );
                        }

                        continue;
                    }
                }

                let Some(metadata) = task.response.metadata.as_ref() else {
                    // Handle non-retry-able errors.
                    let err = task.response.fail.unwrap_or(bun_core::err!("HTTPError"));

                    if C::HAS_ON_PACKAGE_MANIFEST_ERROR {
                        C::on_package_manifest_error(extract_ctx, name, err, &task.url_buf);
                    } else {
                        let fmt_args = (err.name(), name);
                        if manager.is_network_task_required(task.task_id) {
                            bun_ast::add_error_pretty!(
                                manager.log_mut(),
                                None,
                                bun_ast::Loc::EMPTY,
                                "{} downloading package manifest <b>{}<r>",
                                fmt_args.0,
                                bstr::BStr::new(fmt_args.1),
                            );
                        } else {
                            bun_ast::add_warning_pretty!(
                                manager.log_mut(),
                                None,
                                bun_ast::Loc::EMPTY,
                                "{} downloading package manifest <b>{}<r>",
                                fmt_args.0,
                                bstr::BStr::new(fmt_args.1),
                            );
                        }

                        if manager.subcommand != Subcommand::Remove {
                            for request in manager.update_requests.iter_mut() {
                                if strings::eql(&request.name, name) {
                                    request.failed = true;
                                    manager.options.do_.remove(Do::SAVE_LOCKFILE);
                                    manager.options.do_.remove(Do::SAVE_YARN_LOCK);
                                    manager.options.do_.remove(Do::INSTALL_PACKAGES);
                                }
                            }
                        }
                    }

                    continue;
                };
                let response = &metadata.response;

                if response.status_code > 399 {
                    if C::HAS_ON_PACKAGE_MANIFEST_ERROR {
                        let err: PackageManifestError = match response.status_code {
                            400 => PackageManifestError::PackageManifestHTTP400,
                            401 => PackageManifestError::PackageManifestHTTP401,
                            402 => PackageManifestError::PackageManifestHTTP402,
                            403 => PackageManifestError::PackageManifestHTTP403,
                            404 => PackageManifestError::PackageManifestHTTP404,
                            405..=499 => PackageManifestError::PackageManifestHTTP4xx,
                            _ => PackageManifestError::PackageManifestHTTP5xx,
                        };

                        C::on_package_manifest_error(extract_ctx, name, err.into(), &task.url_buf);

                        continue;
                    }

                    if manager.is_network_task_required(task.task_id) {
                        bun_ast::add_error_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><red><b>GET<r><red> {}<d> - {}<r>",
                            bstr::BStr::new(metadata.url.slice()),
                            response.status_code,
                        );
                    } else {
                        bun_ast::add_warning_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><yellow><b>GET<r><yellow> {}<d> - {}<r>",
                            bstr::BStr::new(metadata.url.slice()),
                            response.status_code,
                        );
                    }
                    if manager.subcommand != Subcommand::Remove {
                        for request in manager.update_requests.iter_mut() {
                            if strings::eql(&request.name, name) {
                                request.failed = true;
                                manager.options.do_.remove(Do::SAVE_LOCKFILE);
                                manager.options.do_.remove(Do::SAVE_YARN_LOCK);
                                manager.options.do_.remove(Do::INSTALL_PACKAGES);
                            }
                        }
                    }

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

                        if timestamp_this_tick.is_none() {
                            let now = u64::try_from(bun_core::time::timestamp().max(0))
                                .expect("int cast");
                            timestamp_this_tick = Some((now as u32).saturating_add(300));
                        }

                        manifest.pkg.public_max_age = timestamp_this_tick.unwrap();

                        // PORT NOTE: reshaped for borrowck — Zig writes through
                        // the `getOrPut` slot then re-reads it for `saveAsync`.
                        // `bun_collections::HashMap` lacks `get_or_put` for
                        // non-`Default` values, so insert by-value (overwriting
                        // any prior entry, matching Zig semantics) and reborrow.
                        let name_hash = manifest.pkg.name.hash;
                        manager
                            .manifests
                            .hash_map
                            .insert(name_hash, ManifestEntry::Manifest(manifest));

                        if manager.options.enable.contains(Enable::MANIFEST_CACHE) {
                            // PORT NOTE: reshaped for borrowck — compute the
                            // `&mut`-taking directory accessors first so the
                            // shared `scope_for_package_name` / `manifests`
                            // borrows below do not overlap them. `save_async`
                            // only needs `&PackageManifest`, so reborrow the
                            // freshly-inserted entry immutably alongside the
                            // scope (both `&manager`, no conflict).
                            let tmp_fd = directories::get_temporary_directory(manager).handle.fd;
                            let cache_fd = directories::get_cache_directory(manager).fd;
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

                        if C::MANIFESTS_ONLY {
                            continue;
                        }

                        let dependency_list_entry = manager
                            .task_queue
                            .get_mut(&task.task_id)
                            .expect("infallible: task queued");

                        let dependency_list = core::mem::take(dependency_list_entry);

                        process_dependency_list_for_ctx::<C>(
                            manager,
                            dependency_list,
                            extract_ctx,
                            install_peer,
                        )?;

                        continue;
                    }
                }

                // PORT NOTE: reshaped — `enqueue_parse_npm_package` takes
                // `StringOrTinyString` by value; reconstruct from the slice we
                // captured (the original lives in `task.callback`, which the
                // enqueued resolve Task takes ownership of via `network`).
                let name_tiny = strings::StringOrTinyString::init_append_if_needed(
                    name,
                    &mut crate::network_task::filename_store_appender(),
                )
                .expect("unreachable");
                // PORT NOTE: reshaped for borrowck — split the nested `&mut
                // manager` borrows (`task_batch.push` vs. `enqueue_*`).
                let queued =
                    enqueue::enqueue_parse_npm_package(manager, task.task_id, name_tiny, task_ptr);
                manager.task_batch.push(ThreadPoolBatch::from(queued));
            }
            NetworkTaskCallback::Extract(extract) => {
                // PORT NOTE: reshaped for borrowck — `extract` borrows
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
                // Streaming extraction never pushes its NetworkTask to
                // `async_network_task_queue` once committed — the
                // extract Task published by `TarballStream.finish()`
                // owns its lifetime — so every `.extract` task that
                // arrives here is taking the buffered path.
                debug_assert!(!task.streaming_committed);

                if !has_network_error && task.response.metadata.is_none() {
                    has_network_error = true;
                    let min = manager.options.min_simultaneous_requests;
                    let max = AsyncHTTP::max_simultaneous_requests().load(Ordering::Relaxed);
                    if max > min {
                        AsyncHTTP::max_simultaneous_requests()
                            .store(min.max(max / 2), Ordering::Relaxed);
                    }
                }

                if task.response.metadata.is_none()
                    || task
                        .response
                        .metadata
                        .as_ref()
                        .unwrap()
                        .response
                        .status_code
                        > 499
                {
                    let err = task
                        .response
                        .fail
                        .unwrap_or(bun_core::err!("TarballFailedToDownload"));

                    if task.retried < manager.options.max_retry_count {
                        task.retried += 1;
                        // Streaming never committed (asserted above), so
                        // the pre-allocated stream is safe to reuse for
                        // the retry attempt.
                        task.reset_streaming_for_retry();
                        enqueue::enqueue_network_task(manager, task_ptr);

                        if manager.options.log_level.is_verbose() {
                            bun_ast::add_warning_pretty!(
                                manager.log_mut(),
                                None,
                                bun_ast::Loc::EMPTY,
                                "<r><yellow>warn:<r> {} downloading tarball <b>{}@{}<r>. Retrying {}/{}...",
                                bstr::BStr::new(err.name().as_bytes()),
                                bstr::BStr::new(extract.name.slice()),
                                extract
                                    .resolution
                                    .fmt(&manager.lockfile.buffers.string_bytes, PathSep::Auto,),
                                task.retried,
                                manager.options.max_retry_count,
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

                let Some(metadata) = task.response.metadata.as_ref() else {
                    let err = task
                        .response
                        .fail
                        .unwrap_or(bun_core::err!("TarballFailedToDownload"));

                    // The download will not be retried for this task_id, so
                    // drop the dedupe state before dispatching the error.
                    // Otherwise a later `enqueuePackageForDownload` for the
                    // same package sees `found_existing`, never schedules a
                    // network task, and waits forever for a callback that
                    // will not arrive. `Store.Installer.onPackageDownloadError`
                    // drains `task_queue` itself but does not touch
                    // `network_dedupe_map`, so this must run on the callback
                    // path too. Capture `is_required` first —
                    // `isNetworkTaskRequired` reads the map and returns `true`
                    // when the entry is gone, which would upgrade optional-dep
                    // warnings to errors on the void-callback fallback below.
                    let is_required = manager.is_network_task_required(task.task_id);
                    let _ = manager.network_dedupe_map.remove(&task.task_id);

                    if C::HAS_ON_PACKAGE_DOWNLOAD_ERROR {
                        if C::IS_STORE_INSTALLER {
                            C::on_package_download_error_store(
                                extract_ctx,
                                task.task_id,
                                extract.name.slice(),
                                &extract.resolution,
                                err,
                                &task.url_buf,
                            );
                        } else {
                            let package_id = manager.lockfile.buffers.resolutions
                                [extract.dependency_id as usize];
                            C::on_package_download_error_pkg(
                                extract_ctx,
                                package_id,
                                extract.name.slice(),
                                &extract.resolution,
                                err,
                                &task.url_buf,
                            );
                        }
                        continue;
                    }

                    if is_required {
                        bun_ast::add_error_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "{} downloading tarball <b>{}@{}<r>",
                            err.name(),
                            bstr::BStr::new(extract.name.slice()),
                            extract
                                .resolution
                                .fmt(&manager.lockfile.buffers.string_bytes, PathSep::Auto,),
                        );
                    } else {
                        bun_ast::add_warning_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "{} downloading tarball <b>{}@{}<r>",
                            err.name(),
                            bstr::BStr::new(extract.name.slice()),
                            extract
                                .resolution
                                .fmt(&manager.lockfile.buffers.string_bytes, PathSep::Auto,),
                        );
                    }
                    if manager.subcommand != Subcommand::Remove {
                        for request in manager.update_requests.iter_mut() {
                            if strings::eql(&request.name, extract.name.slice()) {
                                request.failed = true;
                                manager.options.do_.remove(Do::SAVE_LOCKFILE);
                                manager.options.do_.remove(Do::SAVE_YARN_LOCK);
                                manager.options.do_.remove(Do::INSTALL_PACKAGES);
                            }
                        }
                    }

                    if let Some(removed) = manager.task_queue.remove(&task.task_id) {
                        drop(removed);
                    }

                    continue;
                };

                let response = &metadata.response;

                if response.status_code > 399 {
                    // Non-retryable HTTP error: drop dedupe state so a later
                    // enqueue for this task_id schedules a fresh network task
                    // instead of waiting on this failed one. Runs before the
                    // callback branch so `Store.Installer` (which `continue`s
                    // from the callback) is covered too. Capture
                    // `is_required` first — `isNetworkTaskRequired` reads the
                    // map and returns `true` when the entry is gone.
                    let is_required = manager.is_network_task_required(task.task_id);
                    let _ = manager.network_dedupe_map.remove(&task.task_id);

                    if C::HAS_ON_PACKAGE_DOWNLOAD_ERROR {
                        let err = match response.status_code {
                            400 => bun_core::err!("TarballHTTP400"),
                            401 => bun_core::err!("TarballHTTP401"),
                            402 => bun_core::err!("TarballHTTP402"),
                            403 => bun_core::err!("TarballHTTP403"),
                            404 => bun_core::err!("TarballHTTP404"),
                            405..=499 => bun_core::err!("TarballHTTP4xx"),
                            _ => bun_core::err!("TarballHTTP5xx"),
                        };

                        if C::IS_STORE_INSTALLER {
                            C::on_package_download_error_store(
                                extract_ctx,
                                task.task_id,
                                extract.name.slice(),
                                &extract.resolution,
                                err,
                                &task.url_buf,
                            );
                        } else {
                            let package_id = manager.lockfile.buffers.resolutions
                                [extract.dependency_id as usize];
                            C::on_package_download_error_pkg(
                                extract_ctx,
                                package_id,
                                extract.name.slice(),
                                &extract.resolution,
                                err,
                                &task.url_buf,
                            );
                        }
                        continue;
                    }

                    if is_required {
                        bun_ast::add_error_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><red><b>GET<r><red> {}<d> - {}<r>",
                            bstr::BStr::new(metadata.url.slice()),
                            response.status_code,
                        );
                    } else {
                        bun_ast::add_warning_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><yellow><b>GET<r><yellow> {}<d> - {}<r>",
                            bstr::BStr::new(metadata.url.slice()),
                            response.status_code,
                        );
                    }
                    if manager.subcommand != Subcommand::Remove {
                        for request in manager.update_requests.iter_mut() {
                            if strings::eql(&request.name, extract.name.slice()) {
                                request.failed = true;
                                manager.options.do_.remove(Do::SAVE_LOCKFILE);
                                manager.options.do_.remove(Do::SAVE_YARN_LOCK);
                                manager.options.do_.remove(Do::INSTALL_PACKAGES);
                            }
                        }
                    }

                    if let Some(removed) = manager.task_queue.remove(&task.task_id) {
                        drop(removed);
                    }

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
                        bstr::BStr::new(extract.name.slice()),
                    );
                    Output::flush();
                }

                if log_level.show_progress() {
                    if !has_updated_this_run.get() {
                        manager.set_node_name::<true>(
                            manager.downloads_node_mut(),
                            extract.name.slice(),
                            ProgressStrings::EXTRACT_EMOJI.as_bytes(),
                        );
                        has_updated_this_run.set(true);
                    }
                }

                // PORT NOTE: reshaped for borrowck — split nested `&mut manager`.
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
        if cfg!(debug_assertions) {
            debug_assert!(manager.pending_task_count() > 0);
        }
        // Zig: `defer manager.preallocated_resolve_tasks.put(task);`
        // PORT NOTE: raw-ptr capture — borrowck would reject overlapping `&mut`
        // with the loop body. Guard runs on every `continue`/`?`/fallthrough.
        // Phase B: have the iterator yield a pool guard that puts back on Drop.
        // SAFETY: `task_ptr` non-null per loop guard; node exclusively owned by this batch.
        let task = unsafe { &mut *task_ptr };
        // The per-iteration scopeguards capture the function-scope provenance
        // roots (`manager_ptr`/`extract_ctx_ptr`) — the body shadows
        // `manager`/`extract_ctx` are reborrows of those same roots (see
        // drain `defer!` setup), so dereffing a root in a guard is valid both
        // before *and* after every body use of the shadow under Stacked Borrows.
        scopeguard::defer! {
            // SAFETY: `manager_ptr` is the provenance root for every body access
            // to `manager`; `task_ptr` is the sole live handle to this pool slot.
            unsafe { (*manager_ptr).preallocated_resolve_tasks.put(task_ptr) };
        };
        manager.decrement_pending_tasks();

        if !task.log.msgs.is_empty() {
            // `IntoLogWrite` is implemented for `*mut bun_core::io::Writer`,
            // not `&mut Writer` (the underlying `Writer` is the FFI shape).
            // Zig: `try task.log.print(Output.errorWriter())` — propagate the
            // write error (WriteFailed) out of `runTasks`.
            task.log.print(std::ptr::from_mut(Output::error_writer()))?;
            if task.log.errors > 0 {
                manager.any_failed_to_install = true;
            }
            // Zig: `task.log.deinit();` — Drop handles via reset.
            task.log.reset();
        }

        match task.tag {
            Task::Tag::PackageManifest => {
                // Zig: `defer manager.preallocated_network_tasks.put(task.request.package_manifest.network);`
                // PORT NOTE: capture the `*mut NetworkTask` up front — the
                // `&'a mut NetworkTask` field can't be moved out through
                // `ManuallyDrop`'s immutable `Deref` inside the defer body.
                let net_ptr: *mut NetworkTask = {
                    let req = task.request_package_manifest_mut();
                    &raw mut *req.network
                };
                scopeguard::defer! {
                    // SAFETY: see the put-task `defer!` above — `manager_ptr` is the
                    // function-scope provenance root; `net_ptr` is the network task
                    // owned by this resolve task and is returned to the pool here.
                    // `unsafe_http_client` is `MaybeUninit` so `put()`'s
                    // `drop_in_place<NetworkTask>` skips it — drop manually
                    // (HTTP completed, so it IS init) so the inner
                    // `AsyncHTTP.{request,response}_headers: EntryList` don't
                    // leak per put/get cycle.
                    unsafe {
                        (*net_ptr).unsafe_http_client.assume_init_drop();
                        (*manager_ptr).preallocated_network_tasks.put(net_ptr);
                    }
                };
                if task.status == Task::Status::Fail {
                    let req = task.request_package_manifest();
                    let name = req.name.slice();
                    let err = task.err.unwrap_or(bun_core::err!("Failed"));

                    if C::HAS_ON_PACKAGE_MANIFEST_ERROR {
                        C::on_package_manifest_error(
                            extract_ctx,
                            name,
                            err,
                            // SAFETY: same active-arm read as `req` above.
                            unsafe { &(*req.network).url_buf },
                        );
                    } else {
                        bun_ast::add_error_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "{} parsing package manifest for <b>{}<r>",
                            err.name(),
                            bstr::BStr::new(name),
                        );
                    }

                    continue;
                }
                let manifest: &npm::PackageManifest = task.data_package_manifest();

                manager.manifests.insert(manifest.pkg.name.hash, manifest)?;

                if C::MANIFESTS_ONLY {
                    continue;
                }

                let dependency_list_entry = manager
                    .task_queue
                    .get_mut(&task.id)
                    .expect("infallible: task queued");
                let dependency_list = core::mem::take(dependency_list_entry);

                process_dependency_list_for_ctx::<C>(
                    manager,
                    dependency_list,
                    extract_ctx,
                    install_peer,
                )?;

                if log_level.show_progress() {
                    if !has_updated_this_run.get() {
                        manager.set_node_name::<true>(
                            manager.downloads_node_mut(),
                            manifest.name(),
                            ProgressStrings::DOWNLOAD_EMOJI.as_bytes(),
                        );
                        has_updated_this_run.set(true);
                    }
                }
            }
            Task::Tag::Extract | Task::Tag::LocalTarball => {
                // Zig: `defer { switch (task.tag) { .extract => preallocated_network_tasks.put(...), else => {} } }`
                // PORT NOTE: capture the `*mut NetworkTask` up front (only for the
                // Extract arm) so the defer body need not move the `&mut` out
                // through `ManuallyDrop`'s immutable `Deref`.
                let net_ptr: *mut NetworkTask = if task.tag == Task::Tag::Extract {
                    let req = task.request_extract_mut();
                    &raw mut *req.network
                } else {
                    core::ptr::null_mut()
                };
                scopeguard::defer! {
                    // SAFETY: see the put-task `defer!` above — `manager_ptr` is the
                    // function-scope provenance root; `net_ptr` (when non-null) is
                    // the network task owned by this resolve task.
                    // `unsafe_http_client` is `MaybeUninit` so `put()`'s drop
                    // skips it — drop manually so headers don't leak.
                    if !net_ptr.is_null() {
                        unsafe {
                            (*net_ptr).unsafe_http_client.assume_init_drop();
                            (*manager_ptr).preallocated_network_tasks.put(net_ptr);
                        }
                    }
                };

                // SAFETY: `task.tag` selects the active union arm.
                let tarball = match task.tag {
                    Task::Tag::Extract => unsafe { &task.request.extract.tarball },
                    Task::Tag::LocalTarball => unsafe { &task.request.local_tarball.tarball },
                    _ => unreachable!(),
                };
                let dependency_id = tarball.dependency_id;
                let mut package_id = manager.lockfile.buffers.resolutions[dependency_id as usize];
                // SAFETY: `tarball` borrows `task.request` which is reborrowed
                // `&mut` below; the backing `StringOrTinyString` lives in the
                // pooled `Task` for the whole iteration and is not mutated.
                let alias = unsafe { bun_ptr::detach_lifetime(tarball.name.slice()) };
                let resolution = &tarball.resolution;

                if task.status == Task::Status::Fail {
                    let err = task.err.unwrap_or(bun_core::err!("TarballFailedToExtract"));

                    // Extract-task failure (integrity check, libarchive error, etc.)
                    // is symmetric with the HTTP 4xx/5xx branch above: drop the
                    // dedupe state so a later `enqueuePackageForDownload` for this
                    // `task_id` schedules a fresh network task instead of waiting
                    // on this failed one forever. Runs before the callback branch
                    // so `Store.Installer` (which `continue`s from the callback)
                    // is covered too. `network_dedupe_map.remove` is a no-op for
                    // `local_tarball` tasks (they never populate the map).
                    let _ = manager.network_dedupe_map.remove(&task.id);

                    if C::HAS_ON_PACKAGE_DOWNLOAD_ERROR {
                        // SAFETY: `task.tag` selects the active union arm.
                        let fail_url: &[u8] = match task.tag {
                            Task::Tag::Extract => unsafe {
                                &(*task.request.extract.network).url_buf
                            },
                            Task::Tag::LocalTarball => unsafe {
                                task.request.local_tarball.tarball.url.slice()
                            },
                            _ => unreachable!(),
                        };
                        if C::IS_STORE_INSTALLER {
                            C::on_package_download_error_store(
                                extract_ctx,
                                task.id,
                                alias,
                                resolution,
                                err,
                                fail_url,
                            );
                        } else {
                            C::on_package_download_error_pkg(
                                extract_ctx,
                                package_id,
                                alias,
                                resolution,
                                err,
                                fail_url,
                            );
                        }
                        continue;
                    }

                    bun_ast::add_error_pretty!(
                        manager.log_mut(),
                        None,
                        bun_ast::Loc::EMPTY,
                        "{} extracting tarball from <b>{}<r>",
                        err.name(),
                        bstr::BStr::new(alias),
                    );

                    // Void-callback fallback (resolve phase): drain the
                    // `task_queue` entry too so a later install-phase
                    // `enqueuePackageForDownload` doesn't wedge on `found_existing`.
                    if let Some(removed) = manager.task_queue.remove(&task.id) {
                        drop(removed);
                    }

                    continue;
                }

                manager.extracted_count += 1;
                bun_core::analytics::Features::extracted_packages_inc();

                if C::HAS_ON_EXTRACT {
                    if C::IS_PACKAGE_INSTALLER {
                        C::as_package_installer(extract_ctx).fix_cached_lockfile_package_slices();
                        C::on_extract_package_installer(
                            extract_ctx,
                            task.id,
                            dependency_id,
                            // SAFETY: `task.tag` is Extract/LocalTarball — `data.extract`
                            // is the active union arm.
                            unsafe { &mut task.data.extract },
                            log_level,
                        );
                    } else if C::IS_STORE_INSTALLER {
                        C::on_extract_store_installer(extract_ctx, task.id);
                    } else {
                        // Zig: @compileError("unexpected context type")
                        unreachable!("unexpected context type");
                    }
                } else if let Some(pkg) = manager.process_extracted_tarball_package(
                    &mut package_id,
                    dependency_id,
                    resolution,
                    // Tag-checked accessor (debug_asserts Extract|LocalTarball);
                    // shared `&task` here coexists with the field-disjoint
                    // `&task.request` borrow held via `resolution` above.
                    task.data_extract(),
                    log_level,
                ) {
                    'handle_pkg: {
                        // In the middle of an install, you could end up needing to downlaod the github tarball for a dependency
                        // We need to make sure we resolve the dependencies first before calling the onExtract callback
                        // TODO: move this into a separate function
                        let any_root = Cell::new(false);
                        let dependency_list: TaskCallbackList = {
                            let Some(entry) = manager.task_queue.get_mut(&task.id) else {
                                break 'handle_pkg;
                            };
                            core::mem::take(entry)
                        };

                        // Zig: `defer { dependency_list.deinit(); if (any_root) callbacks.onResolve(extract_ctx); }`
                        // `dependency_list` is a Drop type (frees on every path); only the
                        // `on_resolve` side-effect needs the guard so it fires on `?` too.
                        scopeguard::defer! {
                            // SAFETY: `extract_ctx_ptr` is the function-scope provenance
                            // root for `extract_ctx`.
                            if C::HAS_ON_RESOLVE && any_root.get() {
                                C::on_resolve(unsafe { &mut *extract_ctx_ptr });
                            }
                        };

                        for dep in dependency_list.into_iter() {
                            match dep {
                                bun_install::TaskCallbackContext::Dependency(id)
                                | bun_install::TaskCallbackContext::RootDependency(id) => {
                                    let version = &mut manager.lockfile.buffers.dependencies
                                        [id as usize]
                                        .version;
                                    match version.tag {
                                        bun_install::DependencyVersionTag::Git => {
                                            version.git_mut().package_name = pkg.name;
                                        }
                                        bun_install::DependencyVersionTag::Github => {
                                            version.github_mut().package_name = pkg.name;
                                        }
                                        bun_install::DependencyVersionTag::Tarball => {
                                            version.tarball_mut().package_name = pkg.name;
                                        }

                                        // `else` is reachable if this package is from `overrides`. Version in `lockfile.buffer.dependencies`
                                        // will still have the original.
                                        _ => {}
                                    }
                                    manager.process_dependency_list_item(
                                        dep,
                                        Some(&any_root),
                                        install_peer,
                                    )?;
                                }
                                _ => {
                                    // if it's a node_module folder to install, handle that after we process all the dependencies within the onExtract callback.
                                    manager.task_queue.get_mut(&task.id).unwrap().push(dep);
                                    // PERF(port): was `catch unreachable` — Vec::push aborts on OOM
                                }
                            }
                        }
                    }
                } else if let Some(dependency_list_entry) =
                    manager.task_queue.get_mut(&Task::Id::for_manifest(
                        manager
                            .lockfile
                            .str(&manager.lockfile.packages.items_name()[package_id as usize]),
                    ))
                {
                    // Peer dependencies do not initiate any downloads of their own, thus need to be resolved here instead
                    let dependency_list = core::mem::take(dependency_list_entry);

                    // Zig passes `void, {}, {}` for Ctx/ctx/callbacks here.
                    manager.process_dependency_list(
                        dependency_list,
                        (),
                        None::<fn(())>,
                        install_peer,
                    )?;
                }

                manager.set_preinstall_state(package_id, crate::PreinstallState::Done);

                if log_level.show_progress() {
                    if !has_updated_this_run.get() {
                        manager.set_node_name::<true>(
                            manager.downloads_node_mut(),
                            alias,
                            ProgressStrings::EXTRACT_EMOJI.as_bytes(),
                        );
                        has_updated_this_run.set(true);
                    }
                }
            }
            Task::Tag::GitClone => {
                let clone = task.request_git_clone();
                let repo_fd: bun_sys::Fd = task.data_git_clone();
                let name = clone.name.slice();
                let url = clone.url.slice();

                manager.git_repositories.insert(task.id, repo_fd);

                if task.status == Task::Status::Fail {
                    let err = task.err.unwrap_or(bun_core::err!("Failed"));

                    if C::HAS_ON_PACKAGE_MANIFEST_ERROR {
                        C::on_package_manifest_error(extract_ctx, name, err, url);
                    } else if C::HAS_ON_PACKAGE_DOWNLOAD_ERROR && C::IS_STORE_INSTALLER {
                        // The isolated installer queued its entry contexts
                        // under `checkout_id`, not `clone_id`. A failed clone
                        // never reaches checkout, so drain every waiting
                        // checkout for this repo or the install loop blocks
                        // forever on the entry's pending-task slot.
                        let mut drained_any = false;
                        if let Some(waiters) = manager.task_queue.remove(&task.id) {
                            // Zig: defer waiters.deinit() — Drop at end of `if` scope.
                            let pkg_resolutions = manager.lockfile.packages.items_resolution();
                            for waiter in waiters.iter() {
                                let dep_id = match waiter {
                                    bun_install::TaskCallbackContext::Dependency(id) => *id,
                                    _ => continue,
                                };
                                let pkg_id = manager.lockfile.buffers.resolutions[dep_id as usize];
                                if pkg_id == INVALID_PACKAGE_ID {
                                    continue;
                                }
                                let res = &pkg_resolutions[pkg_id as usize];
                                if res.tag != bun_install::ResolutionTag::Git {
                                    continue;
                                }
                                // SAFETY: `res.tag == Git` checked just above —
                                // `value.git` is the active union arm.
                                let res_git = res.git();
                                let checkout_id = Task::Id::for_git_checkout(
                                    manager.lockfile.str(&res_git.repo),
                                    manager.lockfile.str(&res_git.resolved),
                                );
                                drained_any = true;
                                C::on_package_download_error_store(
                                    extract_ctx,
                                    checkout_id,
                                    name,
                                    res,
                                    err,
                                    url,
                                );
                            }
                        }
                        if !drained_any {
                            // No clone waiters recorded (or all were skipped
                            // above) — fall back to the clone task's own
                            // resolution so the originating entry is still
                            // released.
                            // SAFETY: `clone.res.tag == Git` — git-clone tasks are
                            // only enqueued for git resolutions; `value.git` is
                            // the active union arm.
                            let resolved = &clone.res.git().resolved;
                            let checkout_id =
                                Task::Id::for_git_checkout(url, manager.lockfile.str(resolved));
                            C::on_package_download_error_store(
                                extract_ctx,
                                checkout_id,
                                name,
                                &clone.res,
                                err,
                                url,
                            );
                        }
                    } else if log_level != Options::LogLevel::Silent {
                        bun_ast::add_error_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "{} cloning repository for <b>{}<r>",
                            err.name(),
                            bstr::BStr::new(name),
                        );
                    }
                    continue;
                }

                if C::HAS_ON_EXTRACT && C::IS_PACKAGE_INSTALLER {
                    // Installing!
                    // this dependency might be something other than a git dependency! only need the name and
                    // behavior, use the resolution from the task.
                    let dep_id = clone.dep_id;
                    // PORT NOTE: reshaped for borrowck — Zig copies `dep` by
                    // value. Copy the small `String` handles + behavior bit so
                    // the `&manager.lockfile` borrow doesn't extend across the
                    // `&mut manager` calls (`has_created_network_task`,
                    // `enqueue_git_checkout`) below; detach the slice backing
                    // through `string_buf_ptr` (matching the
                    // `PackageManifest`-arm `name` detach pattern above).
                    let (dep_name_handle, is_required) = {
                        let dep = &manager.lockfile.buffers.dependencies[dep_id as usize];
                        (dep.name, dep.behavior.is_required())
                    };
                    // SAFETY: `clone.res.tag == Git` — git-clone tasks are only
                    // enqueued for git resolutions; `value.git` is the active arm.
                    let git = *clone.res.git();
                    // SAFETY: `string_bytes` lives as long as `manager.lockfile`
                    // and is not reallocated while resolve tasks are draining
                    // (Zig: same buffer is read after `enqueueGitCheckout`).
                    let string_buf = unsafe {
                        bun_ptr::detach_lifetime(manager.lockfile.buffers.string_bytes.as_slice())
                    };
                    let dep_name = dep_name_handle.slice(string_buf);
                    let committish = git.committish.slice(string_buf);
                    let repo = git.repo.slice(string_buf);

                    use crate::repository_real::RepositoryExt as _;
                    let resolved = crate::repository_real::Repository::find_commit(
                        manager.env_mut(),
                        manager.log_mut(),
                        bun_sys::Dir { fd: repo_fd },
                        dep_name,
                        committish,
                        task.id,
                    )?;

                    let checkout_id = Task::Id::for_git_checkout(repo, &resolved);

                    if manager.has_created_network_task(checkout_id, is_required) {
                        continue;
                    }

                    // PORT NOTE: reshaped for borrowck — split nested `&mut manager`.
                    let queued = enqueue::enqueue_git_checkout(
                        manager,
                        checkout_id,
                        repo_fd,
                        dep_id,
                        dep_name,
                        clone.res,
                        &resolved,
                        None,
                    );
                    manager.task_batch.push(ThreadPoolBatch::from(queued));
                } else {
                    // Resolving!
                    let dependency_list_entry = manager
                        .task_queue
                        .get_mut(&task.id)
                        .expect("infallible: task queued");
                    let dependency_list = core::mem::take(dependency_list_entry);

                    process_dependency_list_for_ctx::<C>(
                        manager,
                        dependency_list,
                        extract_ctx,
                        install_peer,
                    )?;
                }

                if log_level.show_progress() {
                    if !has_updated_this_run.get() {
                        manager.set_node_name::<true>(
                            manager.downloads_node_mut(),
                            name,
                            ProgressStrings::DOWNLOAD_EMOJI.as_bytes(),
                        );
                        has_updated_this_run.set(true);
                    }
                }
            }
            Task::Tag::GitCheckout => {
                // SAFETY: `task.tag == GitCheckout` — active union arm.
                let git_checkout = unsafe { &*task.request.git_checkout };
                let alias = &git_checkout.name;
                let resolution = &git_checkout.resolution;
                let mut package_id: PackageID = INVALID_PACKAGE_ID;

                if task.status == Task::Status::Fail {
                    let err = task.err.unwrap_or(bun_core::err!("Failed"));

                    if C::HAS_ON_PACKAGE_DOWNLOAD_ERROR && C::IS_STORE_INSTALLER {
                        // SAFETY: `resolution.tag == Git` — git-checkout tasks are
                        // only enqueued for git resolutions; `value.git` is the
                        // active union arm.
                        let repo = &resolution.git().repo;
                        C::on_package_download_error_store(
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
                            bstr::BStr::new(alias.slice()),
                        );
                    }

                    continue;
                }

                if C::HAS_ON_EXTRACT {
                    // We've populated the cache, package already exists in memory. Call the package installer callback
                    // and don't enqueue dependencies
                    if C::IS_PACKAGE_INSTALLER {
                        // TODO(dylan-conway) most likely don't need to call this now that the package isn't appended, but
                        // keeping just in case for now
                        C::as_package_installer(extract_ctx).fix_cached_lockfile_package_slices();

                        C::on_extract_package_installer(
                            extract_ctx,
                            task.id,
                            git_checkout.dependency_id,
                            // SAFETY: `task.tag == GitCheckout` — `data.git_checkout`
                            // is the active union arm.
                            unsafe { &mut task.data.git_checkout },
                            log_level,
                        );
                    } else if C::IS_STORE_INSTALLER {
                        C::on_extract_store_installer(extract_ctx, task.id);
                    } else {
                        // Zig: @compileError("unexpected context type")
                        unreachable!("unexpected context type");
                    }
                } else if let Some(pkg) = manager.process_extracted_tarball_package(
                    &mut package_id,
                    git_checkout.dependency_id,
                    resolution,
                    // Tag-checked accessor (debug_asserts GitCheckout); shared
                    // `&task` here coexists with the field-disjoint
                    // `&task.request` borrow held via `git_checkout` above.
                    task.data_git_checkout(),
                    log_level,
                ) {
                    'handle_pkg: {
                        let any_root = Cell::new(false);
                        let dependency_list: TaskCallbackList = {
                            let Some(entry) = manager.task_queue.get_mut(&task.id) else {
                                break 'handle_pkg;
                            };
                            core::mem::take(entry)
                        };

                        // Zig: `defer { dependency_list.deinit(); if (any_root) callbacks.onResolve(extract_ctx); }`
                        scopeguard::defer! {
                            // SAFETY: `extract_ctx_ptr` is the function-scope provenance
                            // root for `extract_ctx`.
                            if C::HAS_ON_RESOLVE && any_root.get() {
                                C::on_resolve(unsafe { &mut *extract_ctx_ptr });
                            }
                        };

                        for dep in dependency_list.into_iter() {
                            match dep {
                                bun_install::TaskCallbackContext::Dependency(id)
                                | bun_install::TaskCallbackContext::RootDependency(id) => {
                                    // SAFETY: this branch is only reached for
                                    // git dependencies — `version.tag == Git`.
                                    let repo = unsafe {
                                        &mut *manager.lockfile.buffers.dependencies[id as usize]
                                            .version
                                            .value
                                            .git
                                    };
                                    // SAFETY: `pkg.resolution.value` is a Zig `extern union`;
                                    // `Tag::Git` was checked when the resolution was set.
                                    repo.resolved = pkg.resolution.git().resolved;
                                    repo.package_name = pkg.name;
                                    manager.process_dependency_list_item(
                                        dep,
                                        Some(&any_root),
                                        install_peer,
                                    )?;
                                }
                                _ => {
                                    // if it's a node_module folder to install, handle that after we process all the dependencies within the onExtract callback.
                                    manager.task_queue.get_mut(&task.id).unwrap().push(dep);
                                }
                            }
                        }

                        // Zig: `if (@TypeOf(callbacks.onExtract) != void) @compileError("ctx should be void");`
                        // — compile-time invariant: this branch only reachable when !HAS_ON_EXTRACT.
                        debug_assert!(!C::HAS_ON_EXTRACT, "ctx should be void");
                    }
                }

                if log_level.show_progress() {
                    if !has_updated_this_run.get() {
                        manager.set_node_name::<true>(
                            manager.downloads_node_mut(),
                            alias.slice(),
                            ProgressStrings::DOWNLOAD_EMOJI.as_bytes(),
                        );
                        has_updated_this_run.set(true);
                    }
                }
            }
        }
    }

    Ok(())
}

#[inline]
pub fn pending_task_count(manager: &PackageManager) -> u32 {
    manager.pending_tasks.load(Ordering::Acquire)
}

#[inline]
pub fn increment_pending_tasks(manager: &mut PackageManager, count: u32) {
    manager.total_tasks += count;
    // .monotonic is okay because the start of a task doesn't carry any side effects that other
    // threads depend on (but finishing a task does). Note that this method should usually be called
    // before the task is actually spawned.
    let _ = manager.pending_tasks.fetch_add(count, Ordering::Relaxed);
}

#[inline]
pub fn decrement_pending_tasks(manager: &mut PackageManager) {
    let _ = manager.pending_tasks.fetch_sub(1, Ordering::Release);
}

impl PackageManager {
    #[inline]
    pub fn pending_task_count(&self) -> u32 {
        pending_task_count(self)
    }
    #[inline]
    pub fn increment_pending_tasks(&mut self, count: u32) {
        increment_pending_tasks(self, count)
    }
    #[inline]
    pub fn decrement_pending_tasks(&mut self) {
        decrement_pending_tasks(self)
    }
}

pub fn flush_network_queue(this: &mut PackageManager) {
    while let Some(network_task) = this.network_task_fifo.read_item() {
        // SAFETY: fifo stores live `*mut NetworkTask` pushed by
        // `enqueue_network_task`; exclusive ownership transferred here.
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

fn do_flush_dependency_queue(this: &mut PackageManager) {
    while let Some(dependencies_list) = this.lockfile.scratch.dependency_list_queue.read_item() {
        let mut i: u32 = dependencies_list.off;
        let end = dependencies_list.off + dependencies_list.len;
        while i < end {
            let dependency = this.lockfile.buffers.dependencies[i as usize].clone();
            let resolution = this.lockfile.buffers.resolutions[i as usize];
            let _ = enqueue::enqueue_dependency_with_main(this, i, &dependency, resolution, false);
            i += 1;
        }
    }

    flush_network_queue(this);
}

pub fn flush_dependency_queue(this: &mut PackageManager) {
    let mut last_count = this.total_tasks;
    loop {
        flush_network_queue(this);
        do_flush_dependency_queue(this);
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
    // Zig resets these to `.{}` after passing by-value; `mem::take` above already did that.
    count
}

pub fn drain_dependency_list(this: &mut PackageManager) {
    // Step 2. If there were cached dependencies, go through all of those but don't download the devDependencies for them.
    flush_dependency_queue(this);

    // SAFETY: `VERBOSE_INSTALL` is only mutated during single-threaded options
    // parsing; reads here are race-free in practice (Zig: plain `pub var`).
    if PackageManager::verbose_install() {
        Output::flush();
    }

    // It's only network requests here because we don't store tarballs.
    let _ = schedule_tasks(this);
}

pub fn get_network_task(this: &mut PackageManager) -> *mut NetworkTask {
    this.preallocated_network_tasks.get()
}

pub fn alloc_github_url(this: &PackageManager, repository: &Repository) -> Vec<u8> {
    let mut github_api_url: &[u8] = b"https://api.github.com";
    if let Some(url) = this.env().get(b"GITHUB_API_URL") {
        if !url.is_empty() {
            github_api_url = url;
        }
    }

    let owner = this.lockfile.str(&repository.owner);
    let repo = this.lockfile.str(&repository.repo);
    let committish = this.lockfile.str(&repository.committish);

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

pub fn has_created_network_task(
    this: &mut PackageManager,
    task_id: Task::Id,
    is_required: bool,
) -> bool {
    let gpe = this
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

pub fn is_network_task_required(this: &PackageManager, task_id: Task::Id) -> bool {
    match this.network_dedupe_map.get(&task_id) {
        Some(v) => v.is_required,
        None => true,
    }
}

pub fn generate_network_task_for_tarball<'a>(
    this: &'a mut PackageManager,
    task_id: Task::Id,
    url: &[u8],
    is_required: bool,
    dependency_id: DependencyID,
    package: Package,
    patch_name_and_version_hash: Option<u64>,
    authorization: Authorization,
) -> Result<Option<&'a mut NetworkTask>, ForTarballError> {
    if has_created_network_task(this, task_id, is_required) {
        return Ok(None);
    }

    // PORT NOTE: reshaped for borrowck — Zig writes the whole struct via `.* = .{}`.
    // All `&mut this` uses (patch-task alloc, cache/temp dir, pool slot) happen
    // first; the immutable `pkg_name`/`scope` borrows are taken afterwards and
    // live only through `for_tarball`, leaving `this` free for the streaming
    // tail.
    let apply_patch_task = if let Some(h) = patch_name_and_version_hash {
        let patch_hash = this
            .lockfile
            .patched_dependencies
            .get(&h)
            .unwrap()
            .patchfile_hash()
            .unwrap();
        let task: *mut PatchTask =
            PatchTask::new_apply_patch_hash(this, package.meta.id, patch_hash, h);
        // SAFETY: `task` is a fresh non-null `heap::alloc` from
        // `new_apply_patch_hash`; we hold the only reference.
        if let PatchTaskCallback::Apply(apply) = unsafe { &mut (*task).callback } {
            apply.task_id = Some(task_id);
        }
        // SAFETY: reclaiming the `Box` produced by `new_apply_patch_hash`.
        Some(unsafe { bun_core::heap::take(task) })
    } else {
        None
    };
    let cache_dir = directories::get_cache_directory(this);
    let temp_dir = directories::get_temporary_directory(this).handle;
    // Backref address only — stored, not dereffed in this function. The tag is
    // immediately popped by the next `this` use; that's fine for a stored
    // back-pointer (TODO(port): lifetime — BACKREF).
    let this_backref: *mut PackageManager = this;

    // Take the pool slot as a raw pointer so borrowck releases `this` for the
    // streaming-setup tail. Reborrowed `&mut` per-statement below.
    let net_ptr: *mut NetworkTask = get_network_task(this);
    // Zig: `network_task.* = .{ .task_id, .callback = undefined, .allocator,
    // .package_manager, .apply_patch_task }` — full struct overwrite that resets
    // every other field (`retried`, `response`, `streaming_committed`,
    // `tarball_stream`, `streaming_extract_task`, `next`, `url_buf`,
    // `signal_store`) to its struct default. The slot may be uninitialized
    // (`HiveArrayFallback::get()` heap fallback) or stale (reused hive slot).
    // SAFETY: `net_ptr` is the unique handle to a freshly-vended pool slot; no
    // other alias exists until we return it.
    unsafe { NetworkTask::write_init(net_ptr, task_id, this_backref, apply_patch_task) };
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
        name: strings::StringOrTinyString::init_append_if_needed(
            pkg_name,
            &mut crate::network_task::filename_store_appender(),
        )
        .expect("unreachable"),
        resolution: package.resolution,
        cache_dir,
        temp_dir,
        dependency_id,
        skip_verify: false,
        integrity: package.meta.integrity,
        url: strings::StringOrTinyString::init_append_if_needed(
            url,
            &mut crate::network_task::filename_store_appender(),
        )
        .expect("unreachable"),
    };

    network_task.for_tarball(extract_tarball, scope, authorization)?;

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

// ──────────────────────────────────────────────────────────────────────────
// `impl PackageManager` — method-syntax shims over the free functions above so
// callers (incl. this file) can write `manager.foo()` matching the Zig spec.
// ──────────────────────────────────────────────────────────────────────────
impl PackageManager {
    #[inline]
    pub fn drain_dependency_list(&mut self) {
        drain_dependency_list(self)
    }
    #[inline]
    pub fn flush_dependency_queue(&mut self) {
        flush_dependency_queue(self)
    }
    #[inline]
    pub fn flush_network_queue(&mut self) {
        flush_network_queue(self)
    }
    #[inline]
    pub fn flush_patch_task_queue(&mut self) {
        flush_patch_task_queue(self)
    }
    #[inline]
    pub fn schedule_tasks(&mut self) -> usize {
        schedule_tasks(self)
    }
    #[inline]
    pub fn has_created_network_task(&mut self, task_id: Task::Id, is_required: bool) -> bool {
        has_created_network_task(self, task_id, is_required)
    }
    #[inline]
    pub fn is_network_task_required(&self, task_id: Task::Id) -> bool {
        is_network_task_required(self, task_id)
    }
    #[inline]
    pub fn get_network_task(&mut self) -> *mut NetworkTask {
        get_network_task(self)
    }
    #[inline]
    pub fn alloc_github_url(&self, repository: &Repository) -> Vec<u8> {
        alloc_github_url(self, repository)
    }
}

/// Adapter wrapping the existing `PackageManager::process_dependency_list` so
/// it can be driven by a `RunTasksCallbacks` impl (Zig: passes `extract_ctx`
/// + `callbacks` and dispatches `onResolve` if any root dep changed).
fn process_dependency_list_for_ctx<C: RunTasksCallbacks>(
    manager: &mut PackageManager,
    dependency_list: TaskCallbackList,
    extract_ctx: &mut C::Ctx,
    install_peer: bool,
) -> Result<(), bun_core::Error> {
    let ctx_ptr: *mut C::Ctx = extract_ctx;
    manager.process_dependency_list(
        dependency_list,
        (),
        if C::HAS_ON_RESOLVE {
            Some(move |()| {
                // SAFETY: `ctx_ptr` derived from a unique `&mut` that outlives
                // this closure; `process_dependency_list` does not alias it.
                C::on_resolve(unsafe { &mut *ctx_ptr });
            })
        } else {
            None
        },
        install_peer,
    )
}

// ported from: src/install/PackageManager/runTasks.zig
