use crate::lockfile::package::PackageColumns as _;
use core::cell::Cell;
use core::sync::atomic::Ordering;
use std::io::Write as _;

use bun_core::Output;
use bun_core::strings;
use bun_http::{self as http, AsyncHTTP};

use crate::extract_tarball;
use crate::network_task::Callback as NetworkTaskCallback;
use crate::npm;
use crate::patch_install::Callback as PatchTaskCallback;
use crate::tarball_stream::TarballStream;
use bun_install::{
    DependencyID, ExtractTarball, INVALID_PACKAGE_ID, NetworkTask, PackageID, PackageManifestError,
    Repository,
};
// Import the *module* under the `Task` name so `Task::Id` resolves as a path.
use super::{PackageManager, ProgressStrings, Subcommand, TaskCallbackList};
use super::{directories, enqueue};
use crate::network_task::{Authorization, ForTarballError};
use crate::package_manifest_map::Value as ManifestEntry;
use bun_core::fmt::PathSep;
use bun_install::lockfile::Package;
use bun_install::package_manager_task as Task;
// Import the *module* under the `Options` name so `Options::LogLevel` resolves as a path
// (matches the `Task` module-alias pattern above and `CommandLineArguments.rs`).
use super::package_manager_options as Options;
use super::package_manager_options::{Do, Enable};

// ──────────────────────────────────────────────────────────────────────────
// Callbacks trait
// ──────────────────────────────────────────────────────────────────────────
//
// Object-safe so the ~2k-line body of `run_tasks` is compiled once. The
// context owns access to the `PackageManager` (`manager()`); `run_tasks`
// re-derives it after every hook call so no `&mut PackageManager` is live
// while a hook that can reach the same manager runs. Impls: `PackageInstaller`
// (hoisted), `Store::Installer` (isolated), the void/manifests-only contexts in
// this crate, and the auto-install `Queue` in `src/jsc/AsyncModule.rs`.
pub trait RunTasksCtx {
    fn manager(&mut self) -> &mut PackageManager;

    fn progress_bar(&self) -> bool {
        false
    }
    fn manifests_only(&self) -> bool {
        false
    }
    fn has_on_extract(&self) -> bool {
        false
    }
    fn has_on_package_manifest_error(&self) -> bool {
        false
    }
    fn has_on_package_download_error(&self) -> bool {
        false
    }
    fn has_on_resolve(&self) -> bool {
        false
    }
    /// `PackageInstaller` (hoisted linker)
    fn is_package_installer(&self) -> bool {
        false
    }
    /// `Store::Installer` (isolated linker)
    fn is_store_installer(&self) -> bool {
        false
    }

    fn on_package_manifest_error(&mut self, _name: &[u8], _err: crate::Error, _url: &[u8]) {
        unreachable!()
    }

    // `on_package_download_error` is called with two distinct shapes depending
    // on the context: `task.task_id: Task::Id` for the store installer,
    // `package_id: PackageID` otherwise.
    fn on_package_download_error_store(
        &mut self,
        _task_id: Task::Id,
        _name: &[u8],
        _resolution: &bun_install::Resolution,
        _err: crate::Error,
        _url: &[u8],
    ) {
        unreachable!()
    }
    fn on_package_download_error_pkg(
        &mut self,
        _package_id: PackageID,
        _name: &[u8],
        _resolution: &bun_install::Resolution,
        _err: crate::Error,
        _url: &[u8],
    ) {
        unreachable!()
    }

    fn on_extract_package_installer(
        &mut self,
        _task_id: Task::Id,
        _dependency_id: DependencyID,
        _data: &bun_install::ExtractData,
        _log_level: Options::LogLevel,
    ) {
        unreachable!()
    }
    fn on_extract_store_installer(&mut self, _task_id: Task::Id) {
        unreachable!()
    }

    fn on_resolve(&mut self) {
        unreachable!()
    }

    /// `PackageInstaller` only: a patch task with an install context finished;
    /// install the now-patched package into that context's `node_modules`.
    fn on_patch_applied(
        &mut self,
        _install_context: &mut crate::patch_install::InstallContext,
        _pkg_id: PackageID,
        _pkg_name: bun_semver::String,
        _log_level: Options::LogLevel,
    ) {
        unreachable!()
    }

    /// A lifecycle script run for a store entry finished (isolated installs).
    fn on_lifecycle_script_event(
        &mut self,
        entry_id: crate::isolated_install::store::entry::Id,
        event: crate::lifecycle_script_runner::EntryEvent,
    ) {
        let _ = (entry_id, event);
        unreachable!("lifecycle script with a store entry outside the isolated installer");
    }

    /// `Store::Installer` only: drain the finished isolated-install tasks.
    fn drain_store_tasks(&mut self, _log_level: Options::LogLevel) {
        unreachable!()
    }
}

/// `RunTasksCtx` for callers with no hooks: the manager itself.
impl RunTasksCtx for PackageManager {
    fn manager(&mut self) -> &mut PackageManager {
        self
    }
}

/// Drain finished network/extract/git/patch work into the lockfile and
/// enqueue whatever it unblocks. Main thread only.
pub fn run_tasks(
    ctx: &mut dyn RunTasksCtx,
    install_peer: bool,
    log_level: Options::LogLevel,
) -> crate::Result<()> {
    let mut state = RunState {
        flags: CtxFlags {
            manifests_only: ctx.manifests_only(),
            has_on_extract: ctx.has_on_extract(),
            has_on_package_manifest_error: ctx.has_on_package_manifest_error(),
            has_on_package_download_error: ctx.has_on_package_download_error(),
            has_on_resolve: ctx.has_on_resolve(),
            is_package_installer: ctx.is_package_installer(),
            is_store_installer: ctx.is_store_installer(),
        },
        has_updated_this_run: false,
        has_network_error: false,
        timestamp_this_tick: None,
        install_peer,
        log_level,
    };
    let result = run_tasks_body(ctx, &mut state);

    let progress_bar = ctx.progress_bar();
    let manager = ctx.manager();
    manager.drain_dependency_list();

    if log_level.show_progress() {
        manager.start_progress_bar_if_none();

        if progress_bar {
            let completed_items = (manager.total_tasks - manager.pending_task_count()) as usize;
            let total_tasks = manager.total_tasks as usize;
            let node = manager.downloads_node_mut();
            if completed_items != node.unprotected_completed_items.load(Ordering::Relaxed)
                || state.has_updated_this_run
            {
                node.set_completed_items(completed_items);
                node.set_estimated_total_items(total_tasks);
            }
        }
        manager.downloads_node_mut().activate();
        manager.progress.maybe_refresh();
    }

    result
}

fn run_tasks_body(ctx: &mut dyn RunTasksCtx, state: &mut RunState) -> crate::Result<()> {
    let log_level = state.log_level;

    for mut ptask in ctx.manager().shared.patch_task_queue.drain() {
        let manager = ctx.manager();
        debug_assert!(manager.pending_task_count() > 0);
        manager.decrement_pending_tasks();
        ptask.run_from_main_thread(manager, log_level)?;
        if let PatchTaskCallback::Apply(apply) = &mut ptask.callback {
            if apply.logger.errors == 0 {
                if ctx.has_on_extract() {
                    if let Some(_task_id) = apply.task_id {
                        // autofix
                    } else if ctx.is_package_installer() {
                        if let Some(install_context) = apply.install_context.as_mut() {
                            ctx.on_patch_applied(
                                install_context,
                                apply.pkg_id,
                                apply.pkgname,
                                log_level,
                            );
                        }
                    }
                }
            } else {
                // Patch application failed - propagate error to cause install failure
                return Err(crate::Error::InstallFailed);
            }
        }
    }

    if ctx.is_store_installer() {
        ctx.drain_store_tasks(log_level);
    }

    for task in ctx.manager().shared.async_network_task_queue.drain() {
        process_network_task(ctx, state, task)?;
    }

    for mut task in ctx.manager().shared.resolve_tasks.drain() {
        process_resolve_task(ctx, state, &mut task)?;
    }

    Ok(())
}

#[derive(Clone, Copy)]
struct CtxFlags {
    manifests_only: bool,
    has_on_extract: bool,
    has_on_package_manifest_error: bool,
    has_on_package_download_error: bool,
    has_on_resolve: bool,
    is_package_installer: bool,
    is_store_installer: bool,
}

struct RunState {
    flags: CtxFlags,
    has_updated_this_run: bool,
    has_network_error: bool,
    timestamp_this_tick: Option<u32>,
    install_peer: bool,
    log_level: Options::LogLevel,
}

fn process_network_task(
    ctx: &mut dyn RunTasksCtx,
    state: &mut RunState,
    mut task: Box<NetworkTask>,
) -> crate::Result<()> {
    let RunState {
        flags,
        has_updated_this_run,
        has_network_error,
        timestamp_this_tick,
        install_peer,
        log_level,
    } = state;
    let (flags, install_peer, log_level) = (*flags, *install_peer, *log_level);
    let manager = ctx.manager();
    {
        debug_assert!(manager.pending_task_count() > 0);
        manager.decrement_pending_tasks();

        // The callback data moves on with the task (retry) or into the
        // resolve task built from it below.
        match core::mem::replace(&mut task.callback, NetworkTaskCallback::LocalTarball) {
            NetworkTaskCallback::PackageManifest {
                mut loaded_manifest,
                name: name_owned,
                is_extended_manifest,
            } => {
                let name = name_owned.slice();
                if log_level.show_progress() {
                    if !*has_updated_this_run {
                        PackageManager::set_node_name(
                            manager.downloads_node_mut(),
                            name,
                            ProgressStrings::DOWNLOAD_EMOJI.as_bytes(),
                        );
                        *has_updated_this_run = true;
                    }
                }

                // Headers can arrive and the connection still die before the
                // body does; for a 2xx/3xx that is a failed download too (an
                // error status keeps its own handling below).
                let download_failed = match &task.response.metadata {
                    None => true,
                    Some(m) => task.response.fail.is_some() && m.response.status_code < 400,
                };
                if download_failed {
                    throttle_after_network_error(manager, has_network_error);
                }

                // Handle retry-able errors.
                if download_failed
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
                        .map(crate::Error::from)
                        .unwrap_or(crate::Error::HTTPError);

                    if task.retried < manager.options.max_retry_count {
                        task.retried += 1;
                        if manager.options.log_level.is_verbose() {
                            bun_ast::add_warning_pretty!(
                                &mut manager.log,
                                None,
                                bun_ast::Loc::EMPTY,
                                "{} downloading package manifest <b>{}<r>. Retry {}/{}...",
                                bstr::BStr::new(err.name().as_bytes()),
                                bstr::BStr::new(name),
                                task.retried,
                                manager.options.max_retry_count,
                            );
                        }
                        task.callback = NetworkTaskCallback::PackageManifest {
                            loaded_manifest,
                            name: name_owned,
                            is_extended_manifest,
                        };
                        enqueue::enqueue_network_task(manager, task);

                        return Ok(());
                    }
                }

                let Some(metadata) = task.response.metadata.as_ref().filter(|_| !download_failed)
                else {
                    // Handle non-retry-able errors.
                    let err = task
                        .response
                        .fail
                        .map(crate::Error::from)
                        .unwrap_or(crate::Error::HTTPError);

                    if flags.has_on_package_manifest_error {
                        ctx.on_package_manifest_error(name, err, task.url_buf());
                    } else {
                        let fmt_args = (err.name(), name);
                        if manager.is_network_task_required(task.task_id) {
                            bun_ast::add_error_pretty!(
                                &mut manager.log,
                                None,
                                bun_ast::Loc::EMPTY,
                                "{} downloading package manifest <b>{}<r>",
                                fmt_args.0,
                                bstr::BStr::new(fmt_args.1),
                            );
                        } else {
                            bun_ast::add_warning_pretty!(
                                &mut manager.log,
                                None,
                                bun_ast::Loc::EMPTY,
                                "{} downloading package manifest <b>{}<r>",
                                fmt_args.0,
                                bstr::BStr::new(fmt_args.1),
                            );
                        }

                        if manager.subcommand != Subcommand::Remove {
                            for request in manager.update_requests.iter_mut() {
                                if strings::eql(request.name, name) {
                                    request.failed = true;
                                    manager.options.do_.remove(Do::SAVE_LOCKFILE);
                                    manager.options.do_.remove(Do::SAVE_YARN_LOCK);
                                    manager.options.do_.remove(Do::INSTALL_PACKAGES);
                                }
                            }
                        }
                    }

                    return Ok(());
                };
                let response = &metadata.response;

                if response.status_code > 399 {
                    if flags.has_on_package_manifest_error {
                        let err: PackageManifestError = match response.status_code {
                            400 => PackageManifestError::PackageManifestHTTP400,
                            401 => PackageManifestError::PackageManifestHTTP401,
                            402 => PackageManifestError::PackageManifestHTTP402,
                            403 => PackageManifestError::PackageManifestHTTP403,
                            404 => PackageManifestError::PackageManifestHTTP404,
                            405..=499 => PackageManifestError::PackageManifestHTTP4xx,
                            _ => PackageManifestError::PackageManifestHTTP5xx,
                        };

                        ctx.on_package_manifest_error(name, err.into(), task.url_buf());

                        return Ok(());
                    }

                    if manager.is_network_task_required(task.task_id) {
                        bun_ast::add_error_pretty!(
                            &mut manager.log,
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><red><b>GET<r><red> {}<d> - {}<r>",
                            bstr::BStr::new(metadata.url.slice()),
                            response.status_code,
                        );
                    } else {
                        bun_ast::add_warning_pretty!(
                            &mut manager.log,
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><yellow><b>GET<r><yellow> {}<d> - {}<r>",
                            bstr::BStr::new(metadata.url.slice()),
                            response.status_code,
                        );
                    }
                    if manager.subcommand != Subcommand::Remove {
                        for request in manager.update_requests.iter_mut() {
                            if strings::eql(request.name, name) {
                                request.failed = true;
                                manager.options.do_.remove(Do::SAVE_LOCKFILE);
                                manager.options.do_.remove(Do::SAVE_YARN_LOCK);
                                manager.options.do_.remove(Do::INSTALL_PACKAGES);
                            }
                        }
                    }

                    return Ok(());
                }

                if log_level.is_verbose() {
                    bun_core::pretty_error!("    ");
                    Output::print_elapsed(
                        (task.http().elapsed() as f64) / bun_core::time::NS_PER_MS as f64,
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
                            *timestamp_this_tick = Some((now as u32).saturating_add(300));
                        }

                        manifest.pkg.public_max_age = timestamp_this_tick.unwrap();

                        // Insert by value (overwriting any prior entry) and reborrow.
                        let name_hash = manifest.pkg.name.hash;
                        manager
                            .manifests
                            .hash_map
                            .insert(name_hash, ManifestEntry::Manifest(manifest));

                        if manager.options.enable.contains(Enable::MANIFEST_CACHE) {
                            let _ = directories::get_temporary_directory(manager);
                            let _ = directories::get_cache_directory(manager);
                            npm::package_manifest::Serializer::save_async(
                                manager
                                    .manifests
                                    .hash_map
                                    .get(&name_hash)
                                    .unwrap()
                                    .manifest(),
                                manager.options.scope_for_package_name(name),
                                manager,
                            );
                        }

                        if flags.manifests_only {
                            return Ok(());
                        }

                        let dependency_list_entry = manager
                            .task_queue
                            .get_mut(&task.task_id)
                            .expect("infallible: task queued");

                        let dependency_list = core::mem::take(dependency_list_entry);

                        if manager.process_dependency_list(&dependency_list, install_peer)?
                            && flags.has_on_resolve
                        {
                            ctx.on_resolve();
                        }

                        return Ok(());
                    }
                }

                let task_id = task.task_id;
                // The parse task reads the manifest bits back off the network task.
                task.callback = NetworkTaskCallback::PackageManifest {
                    loaded_manifest,
                    name: name_owned,
                    is_extended_manifest,
                };
                let queued = enqueue::enqueue_parse_npm_package(manager, task_id, name_owned, task);
                manager.task_batch.push_owned(queued);
            }
            NetworkTaskCallback::Extract(tarball) => {
                let extract = &tarball;
                // A committed stream publishes its result through the extract
                // Task, except when the connection failed mid-body:
                // `TarballStream::finish()` then un-commits and sends the
                // NetworkTask back here to be retried like any failed download.
                debug_assert!(!task.streaming_committed);

                let download_failed = match &task.response.metadata {
                    None => true,
                    Some(m) => task.response.fail.is_some() && m.response.status_code < 400,
                };
                if download_failed {
                    throttle_after_network_error(manager, has_network_error);
                }

                if download_failed
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
                        .map(crate::Error::from)
                        .unwrap_or(crate::Error::TarballFailedToDownload);

                    if task.retried < manager.options.max_retry_count {
                        task.retried += 1;
                        task.reset_streaming_for_retry();
                        if manager.options.log_level.is_verbose() {
                            bun_ast::add_warning_pretty!(
                                &mut manager.log,
                                None,
                                bun_ast::Loc::EMPTY,
                                "{} downloading tarball <b>{}@{}<r>. Retrying {}/{}...",
                                bstr::BStr::new(err.name().as_bytes()),
                                bstr::BStr::new(extract.name.slice()),
                                extract
                                    .resolution
                                    .fmt(&manager.lockfile.buffers.string_bytes, PathSep::Auto,),
                                task.retried,
                                manager.options.max_retry_count,
                            );
                        }
                        task.callback = NetworkTaskCallback::Extract(tarball);
                        enqueue::enqueue_network_task(manager, task);

                        return Ok(());
                    }
                }

                // Past this point we will not retry. If streaming state was
                // allocated but never scheduled, release it now so the
                // pre-created Task and the stream buffers are freed. The
                // buffered `enqueue_extract_npm_package` path below allocates
                // its own Task.
                task.discard_unused_streaming_state();

                let Some(metadata) = task.response.metadata.as_ref().filter(|_| !download_failed)
                else {
                    let err = task
                        .response
                        .fail
                        .map(crate::Error::from)
                        .unwrap_or(crate::Error::TarballFailedToDownload);

                    // The download will not be retried for this task_id. Mark
                    // the dedupe entry as failed so a later
                    // `enqueue_package_for_download` for the same package observes
                    // the failure and fails fast instead of either waiting
                    // forever on a callback that never arrives (entry kept) or
                    // re-running the entire download+retry cycle (entry removed).
                    // Runs before the callback branch so `Store.Installer`
                    // (which `continue`s from the callback) is covered too.
                    let is_required = manager.is_network_task_required(task.task_id);
                    manager.mark_network_task_failed(task.task_id);

                    if flags.has_on_package_download_error {
                        if flags.is_store_installer {
                            ctx.on_package_download_error_store(
                                task.task_id,
                                extract.name.slice(),
                                &extract.resolution,
                                err,
                                task.url_buf(),
                            );
                        } else {
                            let package_id = manager.lockfile.buffers.resolutions
                                [extract.dependency_id as usize];
                            ctx.on_package_download_error_pkg(
                                package_id,
                                extract.name.slice(),
                                &extract.resolution,
                                err,
                                task.url_buf(),
                            );
                        }
                        return Ok(());
                    }

                    if is_required {
                        bun_ast::add_error_pretty!(
                            &mut manager.log,
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
                            &mut manager.log,
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
                            if strings::eql(request.name, extract.name.slice()) {
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

                    return Ok(());
                };

                let response = &metadata.response;

                if response.status_code > 399 {
                    // Non-retryable HTTP error: mark the dedupe entry as failed
                    // so a later enqueue for this task_id fails fast instead of
                    // waiting on this failed one or re-downloading it. Runs
                    // before the callback branch so `Store.Installer` (which
                    // `continue`s from the callback) is covered too.
                    let is_required = manager.is_network_task_required(task.task_id);
                    manager.mark_network_task_failed(task.task_id);

                    if flags.has_on_package_download_error {
                        let err = match response.status_code {
                            400 => crate::Error::TarballHTTP400,
                            401 => crate::Error::TarballHTTP401,
                            402 => crate::Error::TarballHTTP402,
                            403 => crate::Error::TarballHTTP403,
                            404 => crate::Error::TarballHTTP404,
                            405..=499 => crate::Error::TarballHTTP4xx,
                            _ => crate::Error::TarballHTTP5xx,
                        };

                        if flags.is_store_installer {
                            ctx.on_package_download_error_store(
                                task.task_id,
                                extract.name.slice(),
                                &extract.resolution,
                                err,
                                task.url_buf(),
                            );
                        } else {
                            let package_id = manager.lockfile.buffers.resolutions
                                [extract.dependency_id as usize];
                            ctx.on_package_download_error_pkg(
                                package_id,
                                extract.name.slice(),
                                &extract.resolution,
                                err,
                                task.url_buf(),
                            );
                        }
                        return Ok(());
                    }

                    if is_required {
                        bun_ast::add_error_pretty!(
                            &mut manager.log,
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><red><b>GET<r><red> {}<d> - {}<r>",
                            bstr::BStr::new(metadata.url.slice()),
                            response.status_code,
                        );
                    } else {
                        bun_ast::add_warning_pretty!(
                            &mut manager.log,
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><yellow><b>GET<r><yellow> {}<d> - {}<r>",
                            bstr::BStr::new(metadata.url.slice()),
                            response.status_code,
                        );
                    }
                    if manager.subcommand != Subcommand::Remove {
                        for request in manager.update_requests.iter_mut() {
                            if strings::eql(request.name, extract.name.slice()) {
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

                    return Ok(());
                }

                if log_level.is_verbose() {
                    bun_core::pretty_error!("    ");
                    Output::print_elapsed(
                        (task.http().elapsed() as f64) / bun_core::time::NS_PER_MS as f64,
                    );
                    bun_core::pretty_error!(
                        "<d> Downloaded <r><green>{}<r> tarball\n",
                        bstr::BStr::new(extract.name.slice()),
                    );
                    Output::flush();
                }

                if log_level.show_progress() {
                    if !*has_updated_this_run {
                        PackageManager::set_node_name(
                            manager.downloads_node_mut(),
                            extract.name.slice(),
                            ProgressStrings::EXTRACT_EMOJI.as_bytes(),
                        );
                        *has_updated_this_run = true;
                    }
                }

                let queued = enqueue::enqueue_extract_npm_package(manager, &tarball, task);
                manager.task_batch.push_owned(queued);
            }
            _ => unreachable!(),
        }
    }
    Ok(())
}

fn process_resolve_task(
    ctx: &mut dyn RunTasksCtx,
    state: &mut RunState,
    task: &mut Task::Task,
) -> crate::Result<()> {
    let RunState {
        flags,
        has_updated_this_run,
        install_peer,
        log_level,
        ..
    } = state;
    let (flags, install_peer, log_level) = (*flags, *install_peer, *log_level);
    let mut manager = ctx.manager();
    {
        debug_assert!(manager.pending_task_count() > 0);
        manager.decrement_pending_tasks();

        if !task.log.msgs.is_empty() {
            // `IntoLogWrite` is implemented for `*mut bun_core::io::Writer`,
            // not `&mut Writer` (the underlying `Writer` is the FFI shape).
            // Propagate the write error (WriteFailed) out of `run_tasks`.
            task.log.print(std::ptr::from_mut(Output::error_writer()))?;
            if task.log.errors > 0 {
                manager.any_failed_to_install = true;
            }
            task.log.reset();
        }

        match task.tag() {
            Task::Tag::PackageManifest => {
                if task.status == Task::Status::Fail {
                    let (name, network) = task.request_package_manifest();
                    let name = name.slice();
                    let err = task.err.unwrap_or(crate::Error::Failed);

                    if flags.has_on_package_manifest_error {
                        ctx.on_package_manifest_error(name, err, network.url_buf());
                    } else {
                        bun_ast::add_error_pretty!(
                            &mut manager.log,
                            None,
                            bun_ast::Loc::EMPTY,
                            "{} parsing package manifest for <b>{}<r>",
                            err.name(),
                            bstr::BStr::new(name),
                        );
                    }

                    return Ok(());
                }
                let Task::Data::PackageManifest(manifest) =
                    core::mem::replace(&mut task.data, Task::Data::None)
                else {
                    unreachable!()
                };
                let name_hash = manifest.pkg.name.hash;
                let progress_name: Option<Vec<u8>> =
                    (!flags.manifests_only && log_level.show_progress() && !*has_updated_this_run)
                        .then(|| manifest.name().to_vec());

                manager.manifests.insert(name_hash, manifest)?;

                if flags.manifests_only {
                    return Ok(());
                }

                let dependency_list_entry = manager
                    .task_queue
                    .get_mut(&task.id)
                    .expect("infallible: task queued");
                let dependency_list = core::mem::take(dependency_list_entry);

                if manager.process_dependency_list(&dependency_list, install_peer)?
                    && flags.has_on_resolve
                {
                    ctx.on_resolve();
                }
                let manager = ctx.manager();

                if let Some(name) = progress_name {
                    PackageManager::set_node_name(
                        manager.downloads_node_mut(),
                        &name,
                        ProgressStrings::DOWNLOAD_EMOJI.as_bytes(),
                    );
                    *has_updated_this_run = true;
                }
            }
            Task::Tag::Extract | Task::Tag::LocalTarball => {
                let tarball = task.request_tarball();
                let dependency_id = tarball.dependency_id;
                let mut package_id = manager.lockfile.buffers.resolutions[dependency_id as usize];
                let alias = tarball.name.slice();
                let resolution = &tarball.resolution;

                if task.status == Task::Status::Fail {
                    let err = task.err.unwrap_or(crate::Error::TarballFailedToExtract);

                    // Extract-task failure (integrity check, libarchive error, etc.)
                    // is symmetric with the HTTP 4xx/5xx branch above: mark the
                    // dedupe entry as failed so a later `enqueue_package_for_download`
                    // for this `task_id` fails fast instead of waiting on this
                    // failed one forever or re-downloading it. Runs before the
                    // callback branch so `Store.Installer` (which `continue`s from
                    // the callback) is covered too. The mark is a no-op for
                    // `local_tarball` tasks (they never populate the map).
                    manager.mark_network_task_failed(task.id);

                    if flags.has_on_package_download_error {
                        let fail_url: &[u8] = match &task.request {
                            Task::Request::Extract { network, .. } => network
                                .as_ref()
                                .expect("extract task owns its network task")
                                .url_buf(),
                            Task::Request::LocalTarball { tarball, .. } => tarball.url.slice(),
                            _ => unreachable!(),
                        };
                        if flags.is_store_installer {
                            ctx.on_package_download_error_store(
                                task.id, alias, resolution, err, fail_url,
                            );
                        } else {
                            ctx.on_package_download_error_pkg(
                                package_id, alias, resolution, err, fail_url,
                            );
                        }
                        return Ok(());
                    }

                    bun_ast::add_error_pretty!(
                        &mut manager.log,
                        None,
                        bun_ast::Loc::EMPTY,
                        "{} extracting tarball from <b>{}<r>",
                        err.name(),
                        bstr::BStr::new(alias),
                    );

                    // Void-callback fallback (resolve phase): drain the
                    // `task_queue` entry too so a later install-phase
                    // `enqueue_package_for_download` doesn't wedge on `found_existing`.
                    if let Some(removed) = manager.task_queue.remove(&task.id) {
                        drop(removed);
                    }

                    return Ok(());
                }

                manager.extracted_count += 1;
                bun_core::analytics::Features::extracted_packages_inc();

                if flags.has_on_extract {
                    if flags.is_package_installer {
                        ctx.on_extract_package_installer(
                            task.id,
                            dependency_id,
                            task.data_extract(),
                            log_level,
                        );
                    } else if flags.is_store_installer {
                        ctx.on_extract_store_installer(task.id);
                    } else {
                        unreachable!("unexpected context type");
                    }
                    manager = ctx.manager();
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
                    // Record the appended package so a later-enqueued dependency
                    // on this same tarball can resolve; see `AppendedTaskPackageMap`.
                    manager.appended_task_packages.insert(task.id, pkg.meta.id);
                    // In the middle of an install, you could end up needing to downlaod the github tarball for a dependency
                    // We need to make sure we resolve the dependencies first before calling the on_extract callback
                    if let Some(entry) = manager.task_queue.get_mut(&task.id) {
                        let dependency_list: TaskCallbackList = core::mem::take(entry);
                        let any_root = Cell::new(false);
                        let result = (|| -> crate::Result<()> {
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
                                            &dep,
                                            Some(&any_root),
                                            install_peer,
                                        )?;
                                    }
                                    _ => {
                                        // if it's a node_module folder to install, handle that after we process all the dependencies within the on_extract callback.
                                        manager.task_queue.get_mut(&task.id).unwrap().push(dep);
                                    }
                                }
                            }
                            Ok(())
                        })();
                        if flags.has_on_resolve && any_root.get() {
                            ctx.on_resolve();
                            manager = ctx.manager();
                        }
                        result?;
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

                    manager.process_dependency_list(&dependency_list, install_peer)?;
                }

                manager.set_preinstall_state(package_id, crate::PreinstallState::Done);

                if log_level.show_progress() {
                    if !*has_updated_this_run {
                        PackageManager::set_node_name(
                            manager.downloads_node_mut(),
                            alias,
                            ProgressStrings::EXTRACT_EMOJI.as_bytes(),
                        );
                        *has_updated_this_run = true;
                    }
                }
            }
            Task::Tag::GitClone => {
                let clone = task.request_git_clone();
                let repo_fd: bun_sys::Fd = task.data_git_clone();
                let name = clone.name.slice();
                let url = clone.url.slice();

                if task.status == Task::Status::Fail {
                    let err = task.err.unwrap_or(crate::Error::Failed);

                    if flags.has_on_package_manifest_error {
                        ctx.on_package_manifest_error(name, err, url);
                    } else if flags.has_on_package_download_error && flags.is_store_installer {
                        // The isolated installer queued its entry contexts
                        // under `checkout_id`, not `clone_id`. A failed clone
                        // never reaches checkout, so drain every waiting
                        // checkout for this repo or the install loop blocks
                        // forever on the entry's pending-task slot.
                        let mut drained_any = false;
                        if let Some(waiters) = manager.task_queue.remove(&task.id) {
                            for waiter in waiters.iter() {
                                let dep_id = match waiter {
                                    bun_install::TaskCallbackContext::Dependency(id) => *id,
                                    _ => continue,
                                };
                                let pkg_id = manager.lockfile.buffers.resolutions[dep_id as usize];
                                if pkg_id == INVALID_PACKAGE_ID {
                                    continue;
                                }
                                let res =
                                    manager.lockfile.packages.items_resolution()[pkg_id as usize];
                                if res.tag != bun_install::ResolutionTag::Git {
                                    continue;
                                }
                                let res_git = res.git();
                                let checkout_id = Task::Id::for_git_checkout(
                                    manager.lockfile.str(&res_git.repo),
                                    manager.lockfile.str(&res_git.resolved),
                                );
                                drained_any = true;
                                ctx.on_package_download_error_store(
                                    checkout_id,
                                    name,
                                    &res,
                                    err,
                                    url,
                                );
                                manager = ctx.manager();
                            }
                        }
                        if !drained_any {
                            // No clone waiters recorded (or all were skipped
                            // above) — fall back to the clone task's own
                            // resolution so the originating entry is still
                            // released.
                            let resolved = &clone.res.git().resolved;
                            let checkout_id =
                                Task::Id::for_git_checkout(url, manager.lockfile.str(resolved));
                            ctx.on_package_download_error_store(
                                checkout_id,
                                name,
                                &clone.res,
                                err,
                                url,
                            );
                        }
                    } else if log_level != Options::LogLevel::Silent {
                        bun_ast::add_error_pretty!(
                            &mut manager.log,
                            None,
                            bun_ast::Loc::EMPTY,
                            "{} cloning repository for <b>{}<r>",
                            err.name(),
                            bstr::BStr::new(name),
                        );
                    }
                    return Ok(());
                }

                manager.git_repositories.insert(task.id, repo_fd);

                if flags.has_on_extract && flags.is_package_installer {
                    // Installing! The clone task is shared by every dependency on
                    // this repo URL; enqueue a checkout per waiter, not just one.
                    let Some(waiters) = manager.task_queue.remove(&task.id) else {
                        return Ok(());
                    };
                    for waiter in waiters.iter() {
                        let dep_id = match waiter {
                            bun_install::TaskCallbackContext::Dependency(id) => *id,
                            _ => continue,
                        };
                        let (dep_name_handle, is_required) = {
                            let dep = &manager.lockfile.buffers.dependencies[dep_id as usize];
                            (dep.name, dep.behavior.is_required())
                        };
                        let pkg_id = manager.lockfile.buffers.resolutions[dep_id as usize];
                        if pkg_id == INVALID_PACKAGE_ID {
                            continue;
                        }
                        let res = manager.lockfile.packages.items_resolution()[pkg_id as usize];
                        if res.tag != bun_install::ResolutionTag::Git {
                            continue;
                        }
                        let git = *res.git();
                        let (checkout_id, dep_name, resolved) = {
                            let string_buf = manager.lockfile.buffers.string_bytes.as_slice();
                            let repo = git.repo.slice(string_buf);
                            let resolved = git.resolved.slice(string_buf);
                            let appender = &mut crate::network_task::filename_store_appender();
                            (
                                Task::Id::for_git_checkout(repo, resolved),
                                strings::StringOrTinyString::init_append_if_needed(
                                    dep_name_handle.slice(string_buf),
                                    appender,
                                )
                                .expect("unreachable"),
                                strings::StringOrTinyString::init_append_if_needed(
                                    resolved, appender,
                                )
                                .expect("unreachable"),
                            )
                        };

                        if manager.has_created_network_task(checkout_id, is_required) {
                            continue;
                        }

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

                    if manager.process_dependency_list(&dependency_list, install_peer)?
                        && flags.has_on_resolve
                    {
                        ctx.on_resolve();
                        manager = ctx.manager();
                    }
                }

                if log_level.show_progress() {
                    if !*has_updated_this_run {
                        PackageManager::set_node_name(
                            manager.downloads_node_mut(),
                            name,
                            ProgressStrings::DOWNLOAD_EMOJI.as_bytes(),
                        );
                        *has_updated_this_run = true;
                    }
                }
            }
            Task::Tag::GitCommit => {
                let commit = task.request_git_commit();
                let name = commit.name.slice();
                let url = commit.url.slice();
                // Pending while it ran, but not one of the N downloads the summary prints.
                manager.total_tasks -= 1;

                if task.status == Task::Status::Fail {
                    let err = task.err.unwrap_or(crate::Error::Failed);
                    let _ = manager.task_queue.remove(&task.id);
                    if flags.has_on_package_manifest_error {
                        ctx.on_package_manifest_error(name, err, url);
                    } else {
                        manager.log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "no commit matching \"{}\" found for \"{}\" (but repository exists)",
                                bstr::BStr::new(commit.committish.slice()),
                                bstr::BStr::new(name),
                            ),
                        );
                    }
                    return Ok(());
                }

                manager
                    .git_commits
                    .insert(task.id, task.data_git_commit().to_vec());

                // Each waiter re-enters the enqueue path and now finds the commit.
                let dependency_list = manager
                    .task_queue
                    .remove(&task.id)
                    .expect("infallible: task queued");
                if manager.process_dependency_list(&dependency_list, install_peer)?
                    && flags.has_on_resolve
                {
                    ctx.on_resolve();
                }
            }
            Task::Tag::GitCheckout => {
                let git_checkout = task.request_git_checkout();
                let alias = &git_checkout.name;
                let resolution = &git_checkout.resolution;
                let mut package_id: PackageID = INVALID_PACKAGE_ID;

                if task.status == Task::Status::Fail {
                    let err = task.err.unwrap_or(crate::Error::Failed);

                    if flags.has_on_package_download_error && flags.is_store_installer {
                        let repo = manager.lockfile.str(&resolution.git().repo).to_vec();
                        ctx.on_package_download_error_store(
                            task.id,
                            alias.slice(),
                            resolution,
                            err,
                            &repo,
                        );
                    } else {
                        bun_ast::add_error_pretty!(
                            &mut manager.log,
                            None,
                            bun_ast::Loc::EMPTY,
                            "{} checking out repository for <b>{}<r>",
                            err.name(),
                            bstr::BStr::new(alias.slice()),
                        );
                    }

                    return Ok(());
                }

                if flags.has_on_extract {
                    // We've populated the cache, package already exists in memory. Call the package installer callback
                    // and don't enqueue dependencies
                    if flags.is_package_installer {
                        ctx.on_extract_package_installer(
                            task.id,
                            git_checkout.dependency_id,
                            task.data_git_checkout(),
                            log_level,
                        );
                    } else if flags.is_store_installer {
                        ctx.on_extract_store_installer(task.id);
                    } else {
                        unreachable!("unexpected context type");
                    }
                    manager = ctx.manager();
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
                    // Record the appended package so a later-enqueued dependency
                    // on this same repo+commit can resolve; see `AppendedTaskPackageMap`.
                    manager.appended_task_packages.insert(task.id, pkg.meta.id);
                    if let Some(entry) = manager.task_queue.get_mut(&task.id) {
                        let dependency_list: TaskCallbackList = core::mem::take(entry);
                        let any_root = Cell::new(false);
                        let result = (|| -> crate::Result<()> {
                            for dep in dependency_list.into_iter() {
                                match dep {
                                    bun_install::TaskCallbackContext::Dependency(id)
                                    | bun_install::TaskCallbackContext::RootDependency(id) => {
                                        // Only reached for git dependencies.
                                        let repo = manager.lockfile.buffers.dependencies
                                            [id as usize]
                                            .version
                                            .git_mut();
                                        repo.resolved = pkg.resolution.git().resolved;
                                        repo.package_name = pkg.name;
                                        manager.process_dependency_list_item(
                                            &dep,
                                            Some(&any_root),
                                            install_peer,
                                        )?;
                                    }
                                    _ => {
                                        // if it's a node_module folder to install, handle that after we process all the dependencies within the on_extract callback.
                                        manager.task_queue.get_mut(&task.id).unwrap().push(dep);
                                    }
                                }
                            }
                            Ok(())
                        })();
                        // Invariant: this branch only reachable when !HAS_ON_EXTRACT.
                        debug_assert!(!flags.has_on_extract, "ctx should be void");
                        if flags.has_on_resolve && any_root.get() {
                            ctx.on_resolve();
                            manager = ctx.manager();
                        }
                        result?;
                    }
                }

                if log_level.show_progress() {
                    if !*has_updated_this_run {
                        PackageManager::set_node_name(
                            manager.downloads_node_mut(),
                            alias.slice(),
                            ProgressStrings::DOWNLOAD_EMOJI.as_bytes(),
                        );
                        *has_updated_this_run = true;
                    }
                }
            }
        }
    }
    Ok(())
}

#[inline]
pub fn pending_task_count(manager: &PackageManager) -> u32 {
    manager.shared.pending_tasks.load(Ordering::Acquire)
}

#[inline]
pub fn increment_pending_tasks(manager: &mut PackageManager, count: u32) {
    manager.total_tasks += count;
    // .monotonic is okay because the start of a task doesn't carry any side effects that other
    // threads depend on (but finishing a task does). Note that this method should usually be called
    // before the task is actually spawned.
    let _ = manager
        .shared
        .pending_tasks
        .fetch_add(count, Ordering::Relaxed);
}

#[inline]
pub fn decrement_pending_tasks(manager: &mut PackageManager) {
    let _ = manager.shared.pending_tasks.fetch_sub(1, Ordering::Release);
}

impl PackageManager {
    #[inline]
    pub(crate) fn pending_task_count(&self) -> u32 {
        pending_task_count(self)
    }
    #[inline]
    pub(crate) fn increment_pending_tasks(&mut self, count: u32) {
        increment_pending_tasks(self, count)
    }
    #[inline]
    pub(crate) fn decrement_pending_tasks(&mut self) {
        decrement_pending_tasks(self)
    }
}

pub fn flush_network_queue(this: &mut PackageManager) {
    while let Some(network_task) = this.network_task_fifo.pop() {
        // The HTTP thread takes the task over until its terminal callback
        // hands it back through `Shared::async_network_task_queue`.
        let batch = if matches!(network_task.callback, NetworkTaskCallback::Extract(_)) {
            &mut this.network_tarball_batch
        } else {
            &mut this.network_resolve_batch
        };
        bun_http::schedule_owned_request(network_task, batch);
    }
}

pub fn flush_patch_task_queue(this: &mut PackageManager) {
    while let Some(patch_task) = this.patch_task_fifo.pop() {
        let is_apply = matches!(patch_task.callback, PatchTaskCallback::Apply(_));
        patch_task.schedule(if is_apply {
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
    if manager.task_batch.len > 0 {
        // Resolve tasks read the cache/temp directories on the worker.
        let _ = directories::get_cache_directory(manager);
        manager.ensure_cache_and_temp_directories();
    }
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

pub fn drain_dependency_list(this: &mut PackageManager) {
    // Step 2. If there were cached dependencies, go through all of those but don't download the devDependencies for them.
    flush_dependency_queue(this);

    if PackageManager::verbose_install() {
        Output::flush();
    }

    // It's only network requests here because we don't store tarballs.
    let _ = schedule_tasks(this);
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

pub(crate) fn mark_network_task_failed(this: &mut PackageManager, task_id: Task::Id) {
    if let Some(entry) = this.network_dedupe_map.get_mut(&task_id) {
        entry.failed = true;
    }
}

pub(crate) fn network_task_has_failed(this: &PackageManager, task_id: Task::Id) -> bool {
    this.network_dedupe_map
        .get(&task_id)
        .is_some_and(|e| e.failed)
}

/// The first failed download in a `run_tasks` pass halves the number of
/// concurrent requests (down to the configured minimum).
fn throttle_after_network_error(manager: &PackageManager, has_network_error: &mut bool) {
    if core::mem::replace(has_network_error, true) {
        return;
    }
    let min = manager.options.min_simultaneous_requests;
    let max = AsyncHTTP::max_simultaneous_requests().load(Ordering::Relaxed);
    if max > min {
        AsyncHTTP::max_simultaneous_requests().store(min.max(max / 2), Ordering::Relaxed);
    }
}

pub fn generate_network_task_for_tarball(
    this: &mut PackageManager,
    task_id: Task::Id,
    url: strings::StringOrTinyString,
    is_required: bool,
    dependency_id: DependencyID,
    package: &Package,
    authorization: Authorization,
) -> Result<Option<Box<NetworkTask>>, ForTarballError> {
    if has_created_network_task(this, task_id, is_required) {
        return Ok(None);
    }
    // Only reached when the tarball is not already extracted in the cache. Under
    // --offline nothing can be fetched: report it once (the dedupe entry above stays,
    // so later edges to the same package are quiet) — as an error only if some edge
    // requires it — and let the caller treat it like an already-failed download.
    if this.options.offline == crate::package_manager_real::options::OfflineMode::Offline {
        if is_required {
            // reported once; later dependents see the failed dedupe entry
            mark_network_task_failed(this, task_id);
            let name = this.lockfile.str(&package.name).to_vec();
            this.log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "--offline: \"{}\" is not in the cache",
                    bstr::BStr::new(&name)
                ),
            );
        } else {
            // let a later required edge on the same package report it
            let _ = this.network_dedupe_map.remove(&task_id);
        }
        return Err(ForTarballError::Offline);
    }

    // Borrowed views: `cache_dir` and `temp_dir` are owned by the `PackageManager`
    // singleton and the `TemporaryDirectory` once-cell, respectively. They flow
    // into `ExtractTarball::{cache_dir,temp_dir}`, which must be `Fd` (not `Dir`)
    // so the task's drop never closes them.
    let cache_dir = directories::get_cache_directory(this);
    let temp_dir = directories::get_temporary_directory(this).handle.fd();

    let mut network_task = NetworkTask::new(task_id, this);

    let pkg_name = this.lockfile.str(&package.name);
    let extract_tarball = ExtractTarball {
        package_manager: bun_ptr::BackRef::new(this),
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
        in_trusted_dependencies: this.lockfile.in_trusted_dependencies(pkg_name),
        integrity: package.meta.integrity,
        url,
        // Copied here: extract workers must not read lockfile buffers.
        github_resolved: if package.resolution.tag == bun_install::ResolutionTag::Github {
            strings::StringOrTinyString::init_append_if_needed(
                this.lockfile.str(&package.resolution.github().resolved),
                &mut crate::network_task::filename_store_appender(),
            )
            .expect("unreachable")
        } else {
            strings::StringOrTinyString::init(b"")
        },
    };

    {
        let PackageManager {
            log,
            env,
            options,
            lockfile,
            ..
        } = &mut *this;
        let scope = options.scope_for_package_name(lockfile.str(&package.name));
        network_task.for_tarball(
            log,
            env.get(),
            lockfile.buffers.string_bytes.as_slice(),
            extract_tarball,
            scope,
            authorization,
        )?;
    }

    if extract_tarball::uses_streaming_extraction() {
        // Pre-create the extract Task and streaming state here on the main
        // thread; the streaming extractor publishes that Task to
        // `resolve_tasks` when it finishes.
        let NetworkTaskCallback::Extract(tarball) = &network_task.callback else {
            unreachable!()
        };
        let extract_task = enqueue::create_extract_task_for_streaming(this, tarball, task_id);
        network_task.tarball_stream = Some(TarballStream::new(
            extract_task,
            bun_ptr::BackRef::new(&*this),
        ));
    }

    Ok(Some(network_task))
}

// ──────────────────────────────────────────────────────────────────────────
// `impl PackageManager` — method-syntax shims over the free functions above so
// callers (incl. this file) can write `manager.foo()`.
// ──────────────────────────────────────────────────────────────────────────
impl PackageManager {
    #[inline]
    pub fn drain_dependency_list(&mut self) {
        drain_dependency_list(self)
    }
    #[inline]
    pub(crate) fn flush_network_queue(&mut self) {
        flush_network_queue(self)
    }
    #[inline]
    pub(crate) fn flush_patch_task_queue(&mut self) {
        flush_patch_task_queue(self)
    }
    #[inline]
    pub(crate) fn schedule_tasks(&mut self) -> usize {
        schedule_tasks(self)
    }
    #[inline]
    pub(crate) fn has_created_network_task(
        &mut self,
        task_id: Task::Id,
        is_required: bool,
    ) -> bool {
        has_created_network_task(self, task_id, is_required)
    }
    #[inline]
    pub(crate) fn is_network_task_required(&self, task_id: Task::Id) -> bool {
        is_network_task_required(self, task_id)
    }
    #[inline]
    pub(crate) fn mark_network_task_failed(&mut self, task_id: Task::Id) {
        mark_network_task_failed(self, task_id)
    }
    #[inline]
    pub(crate) fn network_task_has_failed(&self, task_id: Task::Id) -> bool {
        network_task_has_failed(self, task_id)
    }
    #[inline]
    pub(crate) fn alloc_github_url(&self, repository: &Repository) -> Vec<u8> {
        alloc_github_url(self, repository)
    }
}
