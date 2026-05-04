use core::sync::atomic::Ordering;
use std::io::Write as _;

use bun_core::{self as bun, Output};
use bun_logger as logger;
use bun_str::strings;
use bun_threading::ThreadPool;
use bun_http::{self as http, AsyncHTTP};
use bun_fs::FileSystem;

use bun_install::{
    DependencyID, ExtractTarball, NetworkTask, Npm, PackageID, PackageManifestError, PatchTask,
    Repository, Store, TarballStream, Task, INVALID_PACKAGE_ID,
};
use bun_install::lockfile::{Lockfile, Package};

use super::{Options, PackageInstaller, PackageManager, ProgressStrings};

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

    // TODO(port): the Zig calls this with either `task.task_id` (Store.Installer)
    // or `package_id` (PackageInstaller) as the second arg. Phase B may want two
    // methods or a small enum for the id parameter.
    fn on_package_download_error(
        _ctx: &mut Self::Ctx,
        _id: Task::Id, // or PackageID — see note above
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
}

/// Called from isolated_install on the main thread.
pub fn run_tasks<C: RunTasksCallbacks>(
    manager: &mut PackageManager,
    extract_ctx: &mut C::Ctx,
    install_peer: bool,
    log_level: Options::LogLevel,
) -> Result<(), bun_core::Error> {
    let mut has_updated_this_run = false;
    let mut has_network_error = false;

    let mut timestamp_this_tick: Option<u32> = None;

    // Zig: `defer { manager.drainDependencyList(); ... progress update ... }`
    // PORT NOTE: scopeguard captures `manager` / `has_updated_this_run` via raw
    // pointers because the loop body holds `&mut` to both for the function's
    // duration. The guard runs on every exit (incl. `?` early-returns), matching
    // Zig `defer` semantics.
    let manager_ptr = manager as *mut PackageManager;
    let extract_ctx_ptr = extract_ctx as *mut C::Ctx;
    let has_updated_ptr = &mut has_updated_this_run as *mut bool;
    let _drain_guard = scopeguard::guard((), move |()| {
        // SAFETY: `manager` / `has_updated_this_run` outlive this fn body; the
        // guard is the first local declared after them so it drops last, after
        // all body borrows have ended (scope exit or `?` unwind).
        let manager = unsafe { &mut *manager_ptr };
        let has_updated_this_run = unsafe { *has_updated_ptr };
        manager.drain_dependency_list();

        if log_level.show_progress() {
            manager.start_progress_bar_if_none();

            if C::PROGRESS_BAR {
                let completed_items = manager.total_tasks - manager.pending_task_count();
                let node = manager.downloads_node.as_mut().unwrap();
                if completed_items != node.unprotected_completed_items || has_updated_this_run {
                    node.set_completed_items(completed_items);
                    node.set_estimated_total_items(manager.total_tasks);
                }
            }
            manager.downloads_node.as_mut().unwrap().activate();
            manager.progress.maybe_refresh();
        }
    });
    let _ = extract_ctx_ptr; // used by nested guards below

    let mut patch_tasks_batch = manager.patch_task_queue.pop_batch();
    let mut patch_tasks_iter = patch_tasks_batch.iterator();
    while let Some(ptask) = patch_tasks_iter.next() {
        if cfg!(debug_assertions) {
            debug_assert!(manager.pending_task_count() > 0);
        }
        manager.decrement_pending_tasks();
        // Zig: `defer ptask.deinit();` — Drop handles this; ensure `ptask` is
        // owned (Box) by the iterator. // TODO(port): confirm PatchTask ownership
        ptask.run_from_main_thread(manager, log_level)?;
        if matches!(ptask.callback, PatchTask::Callback::Apply(_)) {
            let apply = ptask.callback.apply_mut();
            if apply.logger.errors == 0 {
                if C::HAS_ON_EXTRACT {
                    if let Some(_task_id) = apply.task_id {
                        // autofix
                    } else if C::IS_PACKAGE_INSTALLER {
                        if let Some(ctx) = apply.install_context.as_mut() {
                            // TODO(port): downcast `extract_ctx` to `&mut PackageInstaller`.
                            // In Zig this is `Ctx == *PackageInstaller` so `extract_ctx`
                            // *is* the installer. Phase B: add `as_package_installer()`
                            // on the trait or split monomorphizations.
                            let installer: &mut PackageInstaller =
                                PackageInstaller::from_ctx_mut(extract_ctx);
                            let path = core::mem::take(&mut ctx.path);
                            // Zig: `ctx.path = std.array_list.Managed(u8).init(bun.default_allocator);`
                            // → `Vec::new()` via `mem::take` above.
                            installer.node_modules.path = path;
                            installer.current_tree_id = ctx.tree_id;
                            let pkg_id = apply.pkg_id;
                            let resolution =
                                &manager.lockfile.packages.items_resolution()[pkg_id as usize];

                            installer.install_package_with_name_and_resolution(
                                ctx.dependency_id,
                                pkg_id,
                                log_level,
                                &apply.pkgname,
                                resolution,
                                false,
                                false,
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
        // TODO(port): downcast `extract_ctx` to `&mut Store::Installer` (see note above).
        let installer: &mut Store::Installer = Store::Installer::from_ctx_mut(extract_ctx);
        let batch = installer.task_queue.pop_batch();
        let mut iter = batch.iterator();
        while let Some(task) = iter.next() {
            match &task.result {
                Store::TaskResult::None => {
                    if cfg!(feature = "ci_assert") {
                        debug_assert!(false);
                    }
                    installer.on_task_complete(task.entry_id, Store::CompleteStatus::Success);
                }
                Store::TaskResult::Err(err) => {
                    installer.on_task_fail(task.entry_id, err.clone());
                }
                Store::TaskResult::Blocked => {
                    installer.on_task_blocked(task.entry_id);
                }
                Store::TaskResult::RunScripts(list) => {
                    let entries = installer.store.entries.slice();

                    let node_id = entries.items_node_id()[task.entry_id.get()];
                    let dep_id = installer.store.nodes.items_dep_id()[node_id.get()];
                    let dep = &installer.lockfile.buffers.dependencies[dep_id as usize];
                    if let Err(err) = installer.manager.spawn_package_lifecycle_scripts(
                        &installer.command_ctx,
                        list.clone(),
                        dep.behavior.optional,
                        false,
                        Store::ScriptCtx {
                            entry_id: task.entry_id,
                            installer,
                        },
                    ) {
                        // .monotonic is okay for the same reason as `.done`: we popped this
                        // task from the `UnboundedQueue`, and the task is no longer running.
                        entries.items_step()[task.entry_id.get()]
                            .store(Store::Step::Done, Ordering::Relaxed);
                        installer.on_task_fail(
                            task.entry_id,
                            Store::TaskError::RunScripts(err),
                        );
                    }
                }
                Store::TaskResult::Done => {
                    if cfg!(feature = "ci_assert") {
                        // .monotonic is okay because we should have already synchronized with the
                        // completed task thread by virtue of popping from the `UnboundedQueue`.
                        let step = installer.store.entries.items_step()[task.entry_id.get()]
                            .load(Ordering::Relaxed);
                        debug_assert!(step == Store::Step::Done);
                    }
                    installer.on_task_complete(task.entry_id, Store::CompleteStatus::Success);
                }
            }
        }
    }

    let mut network_tasks_batch = manager.async_network_task_queue.pop_batch();
    let mut network_tasks_iter = network_tasks_batch.iterator();
    while let Some(task) = network_tasks_iter.next() {
        if cfg!(debug_assertions) {
            debug_assert!(manager.pending_task_count() > 0);
        }
        manager.decrement_pending_tasks();
        // We cannot free the network task at the end of this scope.
        // It may continue to be referenced in a future task.

        match &mut task.callback {
            NetworkTask::Callback::PackageManifest(manifest_req) => {
                let name = manifest_req.name.clone();
                if log_level.show_progress() {
                    if !has_updated_this_run {
                        manager.set_node_name(
                            manager.downloads_node.as_ref().unwrap(),
                            name.slice(),
                            ProgressStrings::DOWNLOAD_EMOJI,
                            true,
                        );
                        has_updated_this_run = true;
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
                    || task.response.metadata.as_ref().unwrap().response.status_code > 499
                {
                    let err = task.response.fail.unwrap_or(bun_core::err!("HTTPError"));

                    if task.retried < manager.options.max_retry_count {
                        task.retried += 1;
                        manager.enqueue_network_task(task);

                        if manager.options.log_level.is_verbose() {
                            manager
                                .log
                                .add_warning_fmt(
                                    None,
                                    logger::Loc::EMPTY,
                                    format_args!(
                                        "{} downloading package manifest <b>{}<r>. Retry {}/{}...",
                                        bstr::BStr::new(err.name().as_bytes()),
                                        bstr::BStr::new(name.slice()),
                                        task.retried,
                                        manager.options.max_retry_count,
                                    ),
                                )
                                .expect("unreachable");
                        }

                        continue;
                    }
                }

                let Some(metadata) = task.response.metadata.as_ref() else {
                    // Handle non-retry-able errors.
                    let err = task.response.fail.unwrap_or(bun_core::err!("HTTPError"));

                    if C::HAS_ON_PACKAGE_MANIFEST_ERROR {
                        C::on_package_manifest_error(
                            extract_ctx,
                            name.slice(),
                            err,
                            &task.url_buf,
                        );
                    } else {
                        let fmt_args = (err.name(), name.slice());
                        if manager.is_network_task_required(task.task_id) {
                            let _ = manager.log.add_error_fmt(
                                None,
                                logger::Loc::EMPTY,
                                format_args!(
                                    "{} downloading package manifest <b>{}<r>",
                                    fmt_args.0,
                                    bstr::BStr::new(fmt_args.1),
                                ),
                            );
                        } else {
                            let _ = manager.log.add_warning_fmt(
                                None,
                                logger::Loc::EMPTY,
                                format_args!(
                                    "{} downloading package manifest <b>{}<r>",
                                    fmt_args.0,
                                    bstr::BStr::new(fmt_args.1),
                                ),
                            );
                        }

                        if manager.subcommand != PackageManager::Subcommand::Remove {
                            for request in manager.update_requests.iter_mut() {
                                if strings::eql(&request.name, name.slice()) {
                                    request.failed = true;
                                    manager.options.do_.save_lockfile = false;
                                    manager.options.do_.save_yarn_lock = false;
                                    manager.options.do_.install_packages = false;
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

                        C::on_package_manifest_error(
                            extract_ctx,
                            name.slice(),
                            err.into(),
                            &task.url_buf,
                        );

                        continue;
                    }

                    if manager.is_network_task_required(task.task_id) {
                        let _ = manager.log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "<r><red><b>GET<r><red> {}<d> - {}<r>",
                                bstr::BStr::new(&metadata.url),
                                response.status_code,
                            ),
                        );
                    } else {
                        let _ = manager.log.add_warning_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "<r><yellow><b>GET<r><yellow> {}<d> - {}<r>",
                                bstr::BStr::new(&metadata.url),
                                response.status_code,
                            ),
                        );
                    }
                    if manager.subcommand != PackageManager::Subcommand::Remove {
                        for request in manager.update_requests.iter_mut() {
                            if strings::eql(&request.name, name.slice()) {
                                request.failed = true;
                                manager.options.do_.save_lockfile = false;
                                manager.options.do_.save_yarn_lock = false;
                                manager.options.do_.install_packages = false;
                            }
                        }
                    }

                    continue;
                }

                if log_level.is_verbose() {
                    Output::pretty_error("    ", format_args!(""));
                    Output::print_elapsed(
                        (task.unsafe_http_client.elapsed as f64) / bun_core::time::NS_PER_MS,
                    );
                    Output::pretty_error(
                        "\n<d>Downloaded <r><green>{}<r> versions\n",
                        format_args!("{}", bstr::BStr::new(name.slice())),
                    );
                    Output::flush();
                }

                if response.status_code == 304 {
                    // The HTTP request was cached
                    if let Some(manifest) = manifest_req.loaded_manifest.take() {
                        // If we requested extended manifest but we somehow got an abbreviated one, this is a bug
                        debug_assert!(
                            !manifest_req.is_extended_manifest || manifest.pkg.has_extended_manifest
                        );

                        let entry = manager
                            .manifests
                            .hash_map
                            .get_or_put(manifest.pkg.name.hash)?;
                        *entry.value_ptr = Npm::ManifestEntry::Manifest(manifest);

                        if timestamp_this_tick.is_none() {
                            // TODO(port): std.time.timestamp() — replace with bun_core time API.
                            let now = u64::try_from(bun_core::time::timestamp().max(0)).unwrap();
                            timestamp_this_tick = Some((now as u32).saturating_add(300));
                        }

                        entry
                            .value_ptr
                            .manifest_mut()
                            .pkg
                            .public_max_age = timestamp_this_tick.unwrap();

                        if manager.options.enable.manifest_cache {
                            Npm::PackageManifest::Serializer::save_async(
                                entry.value_ptr.manifest_mut(),
                                manager.scope_for_package_name(name.slice()),
                                manager.get_temporary_directory().handle,
                                manager.get_cache_directory(),
                            );
                        }

                        if C::MANIFESTS_ONLY {
                            continue;
                        }

                        let dependency_list_entry =
                            manager.task_queue.get_entry(task.task_id).unwrap();

                        let dependency_list = core::mem::take(dependency_list_entry.value_ptr);

                        manager.process_dependency_list::<C>(
                            dependency_list,
                            extract_ctx,
                            install_peer,
                        )?;

                        continue;
                    }
                }

                manager.task_batch.push(ThreadPool::Batch::from(
                    manager.enqueue_parse_npm_package(task.task_id, &name, task),
                ));
            }
            NetworkTask::Callback::Extract(extract) => {
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
                    || task.response.metadata.as_ref().unwrap().response.status_code > 499
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
                        manager.enqueue_network_task(task);

                        if manager.options.log_level.is_verbose() {
                            manager
                                .log
                                .add_warning_fmt(
                                    None,
                                    logger::Loc::EMPTY,
                                    format_args!(
                                        "<r><yellow>warn:<r> {} downloading tarball <b>{}@{}<r>. Retrying {}/{}...",
                                        bstr::BStr::new(err.name().as_bytes()),
                                        bstr::BStr::new(extract.name.slice()),
                                        extract.resolution.fmt(
                                            &manager.lockfile.buffers.string_bytes,
                                            bun_install::ResolutionFmtMode::Auto,
                                        ),
                                        task.retried,
                                        manager.options.max_retry_count,
                                    ),
                                )
                                .expect("unreachable");
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
                            C::on_package_download_error(
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
                            C::on_package_download_error(
                                extract_ctx,
                                // TODO(port): second arg is PackageID here, Task::Id above — see trait note
                                Task::Id::from_package_id(package_id),
                                extract.name.slice(),
                                &extract.resolution,
                                err,
                                &task.url_buf,
                            );
                        }
                        continue;
                    }

                    if is_required {
                        let _ = manager.log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "{} downloading tarball <b>{}@{}<r>",
                                err.name(),
                                bstr::BStr::new(extract.name.slice()),
                                extract.resolution.fmt(
                                    &manager.lockfile.buffers.string_bytes,
                                    bun_install::ResolutionFmtMode::Auto,
                                ),
                            ),
                        );
                    } else {
                        let _ = manager.log.add_warning_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "{} downloading tarball <b>{}@{}<r>",
                                err.name(),
                                bstr::BStr::new(extract.name.slice()),
                                extract.resolution.fmt(
                                    &manager.lockfile.buffers.string_bytes,
                                    bun_install::ResolutionFmtMode::Auto,
                                ),
                            ),
                        );
                    }
                    if manager.subcommand != PackageManager::Subcommand::Remove {
                        for request in manager.update_requests.iter_mut() {
                            if strings::eql(&request.name, extract.name.slice()) {
                                request.failed = true;
                                manager.options.do_.save_lockfile = false;
                                manager.options.do_.save_yarn_lock = false;
                                manager.options.do_.install_packages = false;
                            }
                        }
                    }

                    if let Some(removed) = manager.task_queue.fetch_remove(&task.task_id) {
                        drop(removed.value);
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
                            C::on_package_download_error(
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
                            C::on_package_download_error(
                                extract_ctx,
                                // TODO(port): PackageID vs Task::Id — see trait note
                                Task::Id::from_package_id(package_id),
                                extract.name.slice(),
                                &extract.resolution,
                                err,
                                &task.url_buf,
                            );
                        }
                        continue;
                    }

                    if is_required {
                        let _ = manager.log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "<r><red><b>GET<r><red> {}<d> - {}<r>",
                                bstr::BStr::new(&metadata.url),
                                response.status_code,
                            ),
                        );
                    } else {
                        let _ = manager.log.add_warning_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "<r><yellow><b>GET<r><yellow> {}<d> - {}<r>",
                                bstr::BStr::new(&metadata.url),
                                response.status_code,
                            ),
                        );
                    }
                    if manager.subcommand != PackageManager::Subcommand::Remove {
                        for request in manager.update_requests.iter_mut() {
                            if strings::eql(&request.name, extract.name.slice()) {
                                request.failed = true;
                                manager.options.do_.save_lockfile = false;
                                manager.options.do_.save_yarn_lock = false;
                                manager.options.do_.install_packages = false;
                            }
                        }
                    }

                    if let Some(removed) = manager.task_queue.fetch_remove(&task.task_id) {
                        drop(removed.value);
                    }

                    continue;
                }

                if log_level.is_verbose() {
                    Output::pretty_error("    ", format_args!(""));
                    Output::print_elapsed(
                        (task.unsafe_http_client.elapsed as f64) / bun_core::time::NS_PER_MS,
                    );
                    Output::pretty_error(
                        "<d> Downloaded <r><green>{}<r> tarball\n",
                        format_args!("{}", bstr::BStr::new(extract.name.slice())),
                    );
                    Output::flush();
                }

                if log_level.show_progress() {
                    if !has_updated_this_run {
                        manager.set_node_name(
                            manager.downloads_node.as_ref().unwrap(),
                            extract.name.slice(),
                            ProgressStrings::EXTRACT_EMOJI,
                            true,
                        );
                        has_updated_this_run = true;
                    }
                }

                manager.task_batch.push(ThreadPool::Batch::from(
                    manager.enqueue_extract_npm_package(extract, task),
                ));
            }
            _ => unreachable!(),
        }
    }

    let mut resolve_tasks_batch = manager.resolve_tasks.pop_batch();
    let mut resolve_tasks_iter = resolve_tasks_batch.iterator();
    while let Some(task) = resolve_tasks_iter.next() {
        if cfg!(debug_assertions) {
            debug_assert!(manager.pending_task_count() > 0);
        }
        // Zig: `defer manager.preallocated_resolve_tasks.put(task);`
        // PORT NOTE: raw-ptr capture — borrowck would reject overlapping `&mut`
        // with the loop body. Guard runs on every `continue`/`?`/fallthrough.
        // Phase B: have the iterator yield a pool guard that puts back on Drop.
        let task_ptr = task as *mut Task;
        let _put_task = scopeguard::guard((), |()| {
            // SAFETY: `manager` and `task` are live for the whole loop iteration;
            // guard drops at iteration end after all body borrows end.
            unsafe { (*manager_ptr).preallocated_resolve_tasks.put(&mut *task_ptr) };
        });
        manager.decrement_pending_tasks();

        if !task.log.msgs.is_empty() {
            task.log.print(&mut Output::error_writer())?;
            if task.log.errors > 0 {
                manager.any_failed_to_install = true;
            }
            // Zig: `task.log.deinit();` — Drop handles via reset.
            task.log.reset();
        }

        match task.tag {
            Task::Tag::PackageManifest => {
                // Zig: `defer manager.preallocated_network_tasks.put(task.request.package_manifest.network);`
                let _put_net = scopeguard::guard((), |()| {
                    // SAFETY: see `_put_task` above — same iteration-scoped raw ptrs.
                    unsafe {
                        (*manager_ptr)
                            .preallocated_network_tasks
                            .put((*task_ptr).request.package_manifest_mut().network);
                    }
                });
                if task.status == Task::Status::Fail {
                    let name = &task.request.package_manifest().name;
                    let err = task.err.unwrap_or(bun_core::err!("Failed"));

                    if C::HAS_ON_PACKAGE_MANIFEST_ERROR {
                        C::on_package_manifest_error(
                            extract_ctx,
                            name.slice(),
                            err,
                            &task.request.package_manifest().network.url_buf,
                        );
                    } else {
                        let _ = manager.log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "{} parsing package manifest for <b>{}<r>",
                                err.name(),
                                bstr::BStr::new(name.slice()),
                            ),
                        );
                    }

                    continue;
                }
                let manifest = &task.data.package_manifest;

                manager.manifests.insert(manifest.pkg.name.hash, manifest)?;

                if C::MANIFESTS_ONLY {
                    continue;
                }

                let dependency_list_entry = manager.task_queue.get_entry(task.id).unwrap();
                let dependency_list = core::mem::take(dependency_list_entry.value_ptr);

                manager.process_dependency_list::<C>(dependency_list, extract_ctx, install_peer)?;

                if log_level.show_progress() {
                    if !has_updated_this_run {
                        manager.set_node_name(
                            manager.downloads_node.as_ref().unwrap(),
                            manifest.name(),
                            ProgressStrings::DOWNLOAD_EMOJI,
                            true,
                        );
                        has_updated_this_run = true;
                    }
                }
            }
            Task::Tag::Extract | Task::Tag::LocalTarball => {
                // Zig: `defer { switch (task.tag) { .extract => preallocated_network_tasks.put(...), else => {} } }`
                let _put_net = scopeguard::guard((), |()| {
                    // SAFETY: see `_put_task` above — same iteration-scoped raw ptrs.
                    unsafe {
                        if (*task_ptr).tag == Task::Tag::Extract {
                            (*manager_ptr)
                                .preallocated_network_tasks
                                .put((*task_ptr).request.extract_mut().network);
                        }
                    }
                });

                let tarball = match task.tag {
                    Task::Tag::Extract => &task.request.extract().tarball,
                    Task::Tag::LocalTarball => &task.request.local_tarball().tarball,
                    _ => unreachable!(),
                };
                let dependency_id = tarball.dependency_id;
                let mut package_id =
                    manager.lockfile.buffers.resolutions[dependency_id as usize];
                let alias = tarball.name.slice();
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
                        let fail_url: &[u8] = match task.tag {
                            Task::Tag::Extract => &task.request.extract().network.url_buf,
                            Task::Tag::LocalTarball => {
                                task.request.local_tarball().tarball.url.slice()
                            }
                            _ => unreachable!(),
                        };
                        if C::IS_STORE_INSTALLER {
                            C::on_package_download_error(
                                extract_ctx,
                                task.id,
                                alias,
                                resolution,
                                err,
                                fail_url,
                            );
                        } else {
                            C::on_package_download_error(
                                extract_ctx,
                                // TODO(port): PackageID vs Task::Id — see trait note
                                Task::Id::from_package_id(package_id),
                                alias,
                                resolution,
                                err,
                                fail_url,
                            );
                        }
                        continue;
                    }

                    let _ = manager.log.add_error_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!(
                            "{} extracting tarball from <b>{}<r>",
                            err.name(),
                            bstr::BStr::new(alias),
                        ),
                    );

                    // Void-callback fallback (resolve phase): drain the
                    // `task_queue` entry too so a later install-phase
                    // `enqueuePackageForDownload` doesn't wedge on `found_existing`.
                    if let Some(removed) = manager.task_queue.fetch_remove(&task.id) {
                        drop(removed.value);
                    }

                    continue;
                }

                manager.extracted_count += 1;
                bun_core::analytics::Features::extracted_packages_inc(1);

                if C::HAS_ON_EXTRACT {
                    if C::IS_PACKAGE_INSTALLER {
                        PackageInstaller::from_ctx_mut(extract_ctx)
                            .fix_cached_lockfile_package_slices();
                        C::on_extract_package_installer(
                            extract_ctx,
                            task.id,
                            dependency_id,
                            &mut task.data.extract,
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
                    &mut task.data.extract,
                    log_level,
                ) {
                    'handle_pkg: {
                        // In the middle of an install, you could end up needing to downlaod the github tarball for a dependency
                        // We need to make sure we resolve the dependencies first before calling the onExtract callback
                        // TODO: move this into a separate function
                        let mut any_root = false;
                        let Some(dependency_list_entry) = manager.task_queue.get_entry(task.id)
                        else {
                            break 'handle_pkg;
                        };
                        let dependency_list =
                            core::mem::take(dependency_list_entry.value_ptr);

                        // Zig: `defer { dependency_list.deinit(); if (any_root) callbacks.onResolve(extract_ctx); }`
                        // `dependency_list` is a Drop type (frees on every path); only the
                        // `on_resolve` side-effect needs the guard so it fires on `?` too.
                        let any_root_ptr = &mut any_root as *mut bool;
                        let _resolve_guard = scopeguard::guard((), move |()| {
                            // SAFETY: `any_root`/`extract_ctx` outlive this labeled block;
                            // guard drops at block exit (incl. `?` unwind) after body borrows end.
                            if C::HAS_ON_RESOLVE && unsafe { *any_root_ptr } {
                                C::on_resolve(unsafe { &mut *extract_ctx_ptr });
                            }
                        });

                        for dep in dependency_list.iter() {
                            match dep {
                                bun_install::TaskCallbackContext::Dependency(id)
                                | bun_install::TaskCallbackContext::RootDependency(id) => {
                                    let id = *id;
                                    let version = &mut manager.lockfile.buffers.dependencies
                                        [id as usize]
                                        .version;
                                    match version.tag {
                                        bun_install::DependencyVersionTag::Git => {
                                            version.value.git_mut().package_name = pkg.name;
                                        }
                                        bun_install::DependencyVersionTag::Github => {
                                            version.value.github_mut().package_name = pkg.name;
                                        }
                                        bun_install::DependencyVersionTag::Tarball => {
                                            version.value.tarball_mut().package_name = pkg.name;
                                        }

                                        // `else` is reachable if this package is from `overrides`. Version in `lockfile.buffer.dependencies`
                                        // will still have the original.
                                        _ => {}
                                    }
                                    manager.process_dependency_list_item(
                                        dep,
                                        &mut any_root,
                                        install_peer,
                                    )?;
                                }
                                _ => {
                                    // if it's a node_module folder to install, handle that after we process all the dependencies within the onExtract callback.
                                    dependency_list_entry
                                        .value_ptr
                                        .push(dep.clone());
                                    // PERF(port): was `catch unreachable` — Vec::push aborts on OOM
                                }
                            }
                        }
                    }
                } else if let Some(dependency_list_entry) =
                    manager.task_queue.get_entry(Task::Id::for_manifest(
                        manager
                            .lockfile
                            .str(&manager.lockfile.packages.items_name()[package_id as usize]),
                    ))
                {
                    // Peer dependencies do not initiate any downloads of their own, thus need to be resolved here instead
                    let dependency_list = core::mem::take(dependency_list_entry.value_ptr);

                    // TODO(port): Zig passes `void, {}, {}` for Ctx/ctx/callbacks here — needs a
                    // void impl of `RunTasksCallbacks`. Phase B: add `VoidCallbacks` unit impl.
                    manager.process_dependency_list_void(dependency_list, install_peer)?;
                }

                manager.set_preinstall_state(package_id, &manager.lockfile, bun_install::PreinstallState::Done);

                if log_level.show_progress() {
                    if !has_updated_this_run {
                        manager.set_node_name(
                            manager.downloads_node.as_ref().unwrap(),
                            alias,
                            ProgressStrings::EXTRACT_EMOJI,
                            true,
                        );
                        has_updated_this_run = true;
                    }
                }
            }
            Task::Tag::GitClone => {
                let clone = &task.request.git_clone();
                let repo_fd = task.data.git_clone;
                let name = clone.name.slice();
                let url = clone.url.slice();

                manager
                    .git_repositories
                    .put(task.id, repo_fd)
                    .expect("unreachable");

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
                        if let Some(removed) = manager.task_queue.fetch_remove(&task.id) {
                            let waiters = removed.value;
                            // Zig: defer waiters.deinit() — Drop at end of `if` scope.
                            let pkg_resolutions = manager.lockfile.packages.items_resolution();
                            for waiter in waiters.iter() {
                                let dep_id = match waiter {
                                    bun_install::TaskCallbackContext::Dependency(id) => *id,
                                    _ => continue,
                                };
                                let pkg_id =
                                    manager.lockfile.buffers.resolutions[dep_id as usize];
                                if pkg_id == INVALID_PACKAGE_ID {
                                    continue;
                                }
                                let res = &pkg_resolutions[pkg_id as usize];
                                if res.tag != bun_install::ResolutionTag::Git {
                                    continue;
                                }
                                let checkout_id = Task::Id::for_git_checkout(
                                    manager.lockfile.str(&res.value.git().repo),
                                    manager.lockfile.str(&res.value.git().resolved),
                                );
                                drained_any = true;
                                C::on_package_download_error(
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
                            let checkout_id = Task::Id::for_git_checkout(
                                url,
                                manager.lockfile.str(&clone.res.value.git().resolved),
                            );
                            C::on_package_download_error(
                                extract_ctx,
                                checkout_id,
                                name,
                                &clone.res,
                                err,
                                url,
                            );
                        }
                    } else if log_level != Options::LogLevel::Silent {
                        let _ = manager.log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "{} cloning repository for <b>{}<r>",
                                err.name(),
                                bstr::BStr::new(name),
                            ),
                        );
                    }
                    continue;
                }

                if C::HAS_ON_EXTRACT && C::IS_PACKAGE_INSTALLER {
                    // Installing!
                    // this dependency might be something other than a git dependency! only need the name and
                    // behavior, use the resolution from the task.
                    let dep_id = clone.dep_id;
                    let dep = &manager.lockfile.buffers.dependencies[dep_id as usize];
                    let dep_name = dep.name.slice(&manager.lockfile.buffers.string_bytes);

                    let git = &clone.res.value.git();
                    let committish = git.committish.slice(&manager.lockfile.buffers.string_bytes);
                    let repo = git.repo.slice(&manager.lockfile.buffers.string_bytes);

                    let resolved = Repository::find_commit(
                        &manager.env,
                        &mut manager.log,
                        task.data.git_clone.std_dir(),
                        dep_name,
                        committish,
                        task.id,
                    )?;

                    let checkout_id = Task::Id::for_git_checkout(repo, &resolved);

                    if manager.has_created_network_task(checkout_id, dep.behavior.is_required()) {
                        continue;
                    }

                    manager.task_batch.push(ThreadPool::Batch::from(
                        manager.enqueue_git_checkout(
                            checkout_id,
                            repo_fd,
                            dep_id,
                            dep_name,
                            clone.res.clone(),
                            &resolved,
                            None,
                        ),
                    ));
                } else {
                    // Resolving!
                    let dependency_list_entry = manager.task_queue.get_entry(task.id).unwrap();
                    let dependency_list = core::mem::take(dependency_list_entry.value_ptr);

                    manager.process_dependency_list::<C>(
                        dependency_list,
                        extract_ctx,
                        install_peer,
                    )?;
                }

                if log_level.show_progress() {
                    if !has_updated_this_run {
                        manager.set_node_name(
                            manager.downloads_node.as_ref().unwrap(),
                            name,
                            ProgressStrings::DOWNLOAD_EMOJI,
                            true,
                        );
                        has_updated_this_run = true;
                    }
                }
            }
            Task::Tag::GitCheckout => {
                let git_checkout = &task.request.git_checkout();
                let alias = &git_checkout.name;
                let resolution = &git_checkout.resolution;
                let mut package_id: PackageID = INVALID_PACKAGE_ID;

                if task.status == Task::Status::Fail {
                    let err = task.err.unwrap_or(bun_core::err!("Failed"));

                    if C::HAS_ON_PACKAGE_DOWNLOAD_ERROR && C::IS_STORE_INSTALLER {
                        C::on_package_download_error(
                            extract_ctx,
                            task.id,
                            alias.slice(),
                            resolution,
                            err,
                            manager.lockfile.str(&resolution.value.git().repo),
                        );
                    } else {
                        let _ = manager.log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "{} checking out repository for <b>{}<r>",
                                err.name(),
                                bstr::BStr::new(alias.slice()),
                            ),
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
                        PackageInstaller::from_ctx_mut(extract_ctx)
                            .fix_cached_lockfile_package_slices();

                        C::on_extract_package_installer(
                            extract_ctx,
                            task.id,
                            git_checkout.dependency_id,
                            &mut task.data.git_checkout,
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
                    &mut task.data.git_checkout,
                    log_level,
                ) {
                    'handle_pkg: {
                        let mut any_root = false;
                        let Some(dependency_list_entry) = manager.task_queue.get_entry(task.id)
                        else {
                            break 'handle_pkg;
                        };
                        let dependency_list =
                            core::mem::take(dependency_list_entry.value_ptr);

                        // Zig: `defer { dependency_list.deinit(); if (any_root) callbacks.onResolve(extract_ctx); }`
                        let any_root_ptr = &mut any_root as *mut bool;
                        let _resolve_guard = scopeguard::guard((), move |()| {
                            // SAFETY: see Extract arm `_resolve_guard`.
                            if C::HAS_ON_RESOLVE && unsafe { *any_root_ptr } {
                                C::on_resolve(unsafe { &mut *extract_ctx_ptr });
                            }
                        });

                        for dep in dependency_list.iter() {
                            match dep {
                                bun_install::TaskCallbackContext::Dependency(id)
                                | bun_install::TaskCallbackContext::RootDependency(id) => {
                                    let id = *id;
                                    let repo = &mut manager.lockfile.buffers.dependencies
                                        [id as usize]
                                        .version
                                        .value
                                        .git_mut();
                                    repo.resolved = pkg.resolution.value.git().resolved;
                                    repo.package_name = pkg.name;
                                    manager.process_dependency_list_item(
                                        dep,
                                        &mut any_root,
                                        install_peer,
                                    )?;
                                }
                                _ => {
                                    // if it's a node_module folder to install, handle that after we process all the dependencies within the onExtract callback.
                                    dependency_list_entry
                                        .value_ptr
                                        .push(dep.clone());
                                }
                            }
                        }

                        // Zig: `if (@TypeOf(callbacks.onExtract) != void) @compileError("ctx should be void");`
                        // — compile-time invariant: this branch only reachable when !HAS_ON_EXTRACT.
                        debug_assert!(!C::HAS_ON_EXTRACT, "ctx should be void");
                    }
                }

                if log_level.show_progress() {
                    if !has_updated_this_run {
                        manager.set_node_name(
                            manager.downloads_node.as_ref().unwrap(),
                            alias.slice(),
                            ProgressStrings::DOWNLOAD_EMOJI,
                            true,
                        );
                        has_updated_this_run = true;
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

pub fn flush_network_queue(this: &mut PackageManager) {
    let network = &mut this.network_task_fifo;

    while let Some(network_task) = network.read_item() {
        network_task.schedule(if matches!(network_task.callback, NetworkTask::Callback::Extract(_)) {
            &mut this.network_tarball_batch
        } else {
            &mut this.network_resolve_batch
        });
    }
}

pub fn flush_patch_task_queue(this: &mut PackageManager) {
    let patch_task_fifo = &mut this.patch_task_fifo;

    while let Some(patch_task) = patch_task_fifo.read_item() {
        patch_task.schedule(if matches!(patch_task.callback, PatchTask::Callback::Apply(_)) {
            &mut this.patch_apply_batch
        } else {
            &mut this.patch_calc_hash_batch
        });
    }
}

fn do_flush_dependency_queue(this: &mut PackageManager) {
    let lockfile = &mut *this.lockfile;
    let dependency_queue = &mut lockfile.scratch.dependency_list_queue;

    while let Some(dependencies_list) = dependency_queue.read_item() {
        let mut i: u32 = dependencies_list.off;
        let end = dependencies_list.off + dependencies_list.len;
        while i < end {
            let dependency = lockfile.buffers.dependencies[i as usize].clone();
            let _ = this.enqueue_dependency_with_main(
                i,
                &dependency,
                lockfile.buffers.resolutions[i as usize],
                false,
            );
            i += 1;
        }
    }

    this.flush_network_queue();
}

pub fn flush_dependency_queue(this: &mut PackageManager) {
    let mut last_count = this.total_tasks;
    loop {
        this.flush_network_queue();
        do_flush_dependency_queue(this);
        this.flush_network_queue();
        this.flush_patch_task_queue();

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

    manager.increment_pending_tasks(u32::try_from(count).unwrap());
    manager.thread_pool.schedule(core::mem::take(&mut manager.patch_apply_batch));
    manager.thread_pool.schedule(core::mem::take(&mut manager.patch_calc_hash_batch));
    manager.thread_pool.schedule(core::mem::take(&mut manager.task_batch));
    manager
        .network_resolve_batch
        .push(core::mem::take(&mut manager.network_tarball_batch));
    http::http_thread().schedule(core::mem::take(&mut manager.network_resolve_batch));
    // Zig resets these to `.{}` after passing by-value; `mem::take` above already did that.
    count
}

pub fn drain_dependency_list(this: &mut PackageManager) {
    // Step 2. If there were cached dependencies, go through all of those but don't download the devDependencies for them.
    this.flush_dependency_queue();

    if PackageManager::verbose_install() {
        Output::flush();
    }

    // It's only network requests here because we don't store tarballs.
    let _ = this.schedule_tasks();
}

pub fn get_network_task(this: &mut PackageManager) -> &mut NetworkTask {
    this.preallocated_network_tasks.get()
}

pub fn alloc_github_url(this: &PackageManager, repository: &Repository) -> Vec<u8> {
    let mut github_api_url: &[u8] = b"https://api.github.com";
    if let Some(url) = this.env.get(b"GITHUB_API_URL") {
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

pub fn has_created_network_task(this: &mut PackageManager, task_id: Task::Id, is_required: bool) -> bool {
    let gpe = this.network_dedupe_map.get_or_put(task_id);

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

pub fn generate_network_task_for_tarball(
    this: &mut PackageManager,
    task_id: Task::Id,
    url: &[u8],
    is_required: bool,
    dependency_id: DependencyID,
    package: Lockfile::Package,
    patch_name_and_version_hash: Option<u64>,
    authorization: NetworkTask::Authorization,
) -> Result<Option<&mut NetworkTask>, NetworkTask::ForTarballError> {
    if this.has_created_network_task(task_id, is_required) {
        return Ok(None);
    }

    let network_task = this.get_network_task();

    // PORT NOTE: reshaped for borrowck — Zig writes the whole struct via `.* = .{}`.
    // Here we set fields individually since `network_task` is `&mut NetworkTask`
    // borrowed from a pool, and `apply_patch_task` needs `this`.
    network_task.task_id = task_id;
    // `callback` left to be set by `for_tarball` below (Zig: `undefined`).
    // TODO(port): allocator field dropped (global allocator).
    network_task.package_manager = this as *mut PackageManager; // TODO(port): lifetime — BACKREF
    network_task.apply_patch_task = if let Some(h) = patch_name_and_version_hash {
        'brk: {
            let patch_hash = this
                .lockfile
                .patched_dependencies
                .get(&h)
                .unwrap()
                .patchfile_hash()
                .unwrap();
            let task = PatchTask::new_apply_patch_hash(this, package.meta.id, patch_hash, h);
            task.callback.apply_mut().task_id = Some(task_id);
            break 'brk Some(task);
        }
    } else {
        None
    };

    let scope = this.scope_for_package_name(this.lockfile.str(&package.name));

    network_task.for_tarball(
        &ExtractTarball {
            package_manager: this as *mut PackageManager, // TODO(port): lifetime — BACKREF
            name: strings::StringOrTinyString::init_append_if_needed(
                this.lockfile.str(&package.name),
                FileSystem::FilenameStore::instance(),
            ),
            resolution: package.resolution,
            cache_dir: this.get_cache_directory(),
            temp_dir: this.get_temporary_directory().handle,
            dependency_id,
            integrity: package.meta.integrity,
            url: strings::StringOrTinyString::init_append_if_needed(
                url,
                FileSystem::FilenameStore::instance(),
            ),
        },
        scope,
        authorization,
    )?;

    if ExtractTarball::uses_streaming_extraction() {
        // Pre-create the extract Task and streaming state here on the
        // main thread: `preallocated_resolve_tasks` is not thread-safe,
        // and the streaming extractor needs a stable `Task` pointer so
        // it can push the result onto `resolve_tasks` when it finishes.
        let extract_task =
            this.create_extract_task_for_streaming(&mut network_task.callback.extract_mut(), network_task);
        network_task.streaming_extract_task = Some(extract_task);
        network_task.tarball_stream =
            Some(TarballStream::init(extract_task, network_task, this));
    }

    Ok(Some(network_task))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/runTasks.zig (1307 lines)
//   confidence: medium
//   todos:      15
//   notes:      Heavy comptime duck-typing (`callbacks: anytype`, `Ctx: type`) modeled as `RunTasksCallbacks` trait with HAS_*/IS_* assoc consts; `defer` blocks expressed via scopeguard with raw-ptr captures (SAFETY-annotated) so they fire on `?` paths — Phase B should replace with pool-guard iterators; `on_package_download_error` id param is PackageID|Task::Id union.
// ──────────────────────────────────────────────────────────────────────────
