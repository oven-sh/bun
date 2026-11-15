use crate::lockfile::package::PackageColumns as _;
use core::cell::Cell;
use core::sync::atomic::Ordering;
use std::io::Write as _;

use bun_collections::HiveBox;
use bun_core::strings;
use bun_core::{Environment, Output};
use bun_http::{self as http, AsyncHTTP};

use crate::bun_fs::FileSystem;
use crate::network_task::Callback as NetworkTaskCallback;
use crate::npm;
use crate::patch_install::Callback as PatchTaskCallback;
use crate::retry_timer;
use bun_install::{
    DependencyID, ExtractTarball, INVALID_PACKAGE_ID, NetworkTask, PackageID, Repository,
};
// Import the *module* under the `Task` name so `Task::Id` resolves as a path.
use super::{INBOX, InstallFields, InstallState, directories, enqueue, install_pool};
use super::{
    ManifestFailure, PackageInstaller, PackageManager, ProgressStrings, RemoteTurn, Subcommand,
    TaskCallbackList,
};
use crate::isolated_install::installer as store_installer;
use crate::isolated_install::store::{EntryColumns as _, NodeColumns as _};
use crate::lifecycle_script_runner::{InstallCtx, ScriptCaller};
use crate::network_task::{Authorization, ForTarballError, add_error_or_warning, stored_string};
use crate::package_manifest_map::Value as ManifestEntry;
use bun_core::fmt::PathSep;
use bun_install::lockfile::{Lockfile, Package};
use bun_install::package_manager_task as Task;
// Import the *module* under the `Options` name so `Options::LogLevel` resolves as a path
// (matches the `Task` module-alias pattern above and `CommandLineArguments.rs`).
use super::package_manager_options as Options;
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

/// Who runs the tasks, which decides where their results go.
pub(crate) enum Caller<'c, 'i> {
    /// Resolves dependencies for a command.
    Resolver(&'c mut PackageManager),
    /// Resolves the dependency of an import that blocks the runtime's thread.
    BlockedImport(&'c mut PackageManager),
    /// Fills the manifest cache.
    ManifestCache(&'c mut PackageManager),
    HoistedLinker(&'c mut PackageInstaller<'i>),
    IsolatedLinker(&'c mut Store::Installer<'i>),
}

impl Caller<'_, '_> {
    fn is_linker(&self) -> bool {
        matches!(self, Self::HoistedLinker(_) | Self::IsolatedLinker(_))
    }

    fn install_fields(&mut self) -> InstallFields<'_> {
        match self {
            Self::Resolver(manager)
            | Self::BlockedImport(manager)
            | Self::ManifestCache(manager) => manager.install_fields(),
            Self::HoistedLinker(installer) => installer.manager.reborrow(),
            Self::IsolatedLinker(installer) => installer.manager.reborrow(),
        }
    }

    /// `None` for a linker, which ignores the results of tasks that resolve dependencies.
    fn manager(&mut self) -> Option<&mut PackageManager> {
        match self {
            Self::Resolver(manager)
            | Self::BlockedImport(manager)
            | Self::ManifestCache(manager) => Some(manager),
            Self::HoistedLinker(_) | Self::IsolatedLinker(_) => None,
        }
    }

    /// Marks the task as failed, so that a later enqueue fails fast. Returns `Some(is_required)` if
    /// the caller has to report the error.
    fn dispatch_tarball_error(
        &mut self,
        task_id: Task::Id,
        dependency_id: DependencyID,
        name: &[u8],
        resolution: &bun_install::Resolution,
        err: crate::Error,
        url: &[u8],
    ) -> Option<bool> {
        let is_linker = self.is_linker();
        let manager = self.install_fields();
        manager.state.mark_network_task_failed(task_id);
        // A linker queues a tarball once, for the first dependency that reaches it.
        let is_required = if is_linker {
            let package_id = manager.lockfile.buffers.resolutions[dependency_id as usize];
            manager.is_package_required(dependency_id, package_id)
        } else {
            manager.state.is_network_task_required(task_id)
        };
        match self {
            Self::IsolatedLinker(installer) if is_required => {
                installer.on_package_download_error(task_id, name, resolution, err, url);
                None
            }
            Self::IsolatedLinker(installer) => {
                installer.on_optional_package_download_error(task_id);
                Some(false)
            }
            _ => Some(is_required),
        }
    }
}

/// The cleanup that runs however `run_tasks` exits.
struct FinishPass<'a, 'c, 'i> {
    caller: Caller<'c, 'i>,
    log_level: Options::LogLevel,
    has_updated_this_run: &'a Cell<bool>,
}

impl Drop for FinishPass<'_, '_, '_> {
    fn drop(&mut self) {
        let counts_tasks = matches!(self.caller, Caller::Resolver(_) | Caller::ManifestCache(_));
        match self.caller.manager() {
            Some(manager) => manager.drain_dependency_list(),
            None => self.caller.install_fields().schedule_queued_tasks(),
        }

        if self.log_level.show_progress() {
            let state = self.caller.install_fields().state;
            state.start_progress_bar_if_none();

            if counts_tasks {
                let completed_items =
                    (state.total_tasks.get() - state.pending_task_count()) as usize;
                let node = state.progress.node(state.downloads_node());
                if completed_items != node.completed_items.get() || self.has_updated_this_run.get()
                {
                    node.completed_items.set(completed_items);
                    node.estimated_total_items
                        .set(state.total_tasks.get() as usize);
                }
            }
            // The progress bar shows the node that was activated last, so the downloads node is
            // only activated once there is something to download.
            if state.total_tasks.get() > 0 {
                state.progress.activate(state.downloads_node());
            }
            state.progress.maybe_refresh();
        }
    }
}

/// Resolves the dependencies that waited for `task_id` to `pkg`, and fills in the package's name
/// where a dependency did not know it. Entries that a linker queued stay in the task's list.
pub(crate) fn resolve_waiters_of_appended_package(
    manager: &mut PackageManager,
    task_id: Task::Id,
    pkg: &Package,
    install_peer: bool,
) -> crate::Result<()> {
    // Recorded for a dependency that's enqueued on the same task later. See
    // `AppendedTaskPackageMap`.
    manager.appended_task_packages.insert(task_id, pkg.meta.id);
    let Some(entry) = manager.state.task_queue.get_mut(&task_id) else {
        return Ok(());
    };
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
                result = manager.process_dependency_list_item(&dep, install_peer);
                if result.is_err() {
                    break;
                }
            }
            // if it's a node_module folder to install, handle that after we process all the dependencies.
            _ => manager
                .state
                .task_queue
                .get_mut(&task_id)
                .unwrap()
                .push(dep),
        }
    }
    result
}

pub(crate) fn run_tasks(
    caller: Caller<'_, '_>,
    install_peer: bool,
    log_level: Options::LogLevel,
) -> crate::Result<()> {
    // `Cell<bool>` so `FinishPass` below can read it via `&self`
    // while the loop body sets it — no raw-ptr provenance dance needed.
    let has_updated_this_run = Cell::new(false);
    let mut has_network_error = false;

    let mut finish_pass = FinishPass {
        caller,
        log_level,
        has_updated_this_run: &has_updated_this_run,
    };
    let caller = &mut finish_pass.caller;

    const DOWNLOAD: &str = ProgressStrings::DOWNLOAD_EMOJI;
    const EXTRACT: &str = ProgressStrings::EXTRACT_EMOJI;
    // The progress bar shows the name of the first task in each pass.
    let name_progress = |state: &InstallState, name: &[u8], emoji: &str| {
        if log_level.show_progress() && !has_updated_this_run.replace(true) {
            state.set_node_name(state.downloads_node(), name, emoji.as_bytes());
        }
    };

    for mut ptask in INBOX.patch_tasks.pop_batch() {
        INBOX.decrement_pending_tasks();
        if matches!(ptask.callback, PatchTaskCallback::Apply(_)) {
            ptask.run_from_main_thread_apply();
        } else if let Some(manager) = caller.manager() {
            ptask.run_from_main_thread_calc_hash(manager, log_level)?;
        }
        if let PatchTaskCallback::Apply(apply) = &mut ptask.callback {
            if !apply.logger.has_errors() {
                if let Caller::HoistedLinker(installer) = caller {
                    if apply.task_id.is_none() {
                        if let Some(ctx) = apply.install_context.as_mut() {
                            // The hoisted loop runs tasks in the middle of a tree.
                            let prev_node_modules = core::mem::take(&mut installer.node_modules);
                            let prev_tree_id = installer.current_tree_id;
                            installer.node_modules.path = core::mem::take(&mut ctx.path);
                            installer.node_modules.tree_id = ctx.tree_id;
                            installer.current_tree_id = ctx.tree_id;
                            let pkg_id = apply.pkg_id;
                            let resolution = &installer.resolutions[pkg_id as usize];

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

    if let Caller::IsolatedLinker(installer) = caller {
        installer.tasks.pop_finished_batch();
        while let Some(task) = installer.tasks.next_finished() {
            let entry_id = task.entry_id;
            match core::mem::replace(&mut task.result, store_installer::Result::None) {
                store_installer::Result::None => {
                    if Environment::CI_ASSERT {
                        unreachable!();
                    }
                    installer.on_task_complete(entry_id, store_installer::CompleteState::Success);
                }
                store_installer::Result::Err(err) => {
                    installer.on_task_fail(entry_id, &err);
                }
                store_installer::Result::Blocked => {
                    installer.on_task_blocked(entry_id);
                }
                store_installer::Result::RunScripts => {
                    installer.pending_lifecycle_scripts.push_back(entry_id);
                }
                store_installer::Result::Done => {
                    if Environment::CI_ASSERT {
                        // .monotonic is okay because we should have already synchronized with the
                        // completed task thread by virtue of popping from the `UnboundedQueue`.
                        let step = installer.shared.step(entry_id).load(Ordering::Relaxed);
                        assert!(step == store_installer::Step::Done as u32);
                    }
                    installer.on_task_complete(entry_id, store_installer::CompleteState::Success);
                }
            }
        }

        let max_scripts = installer.manager.options.max_concurrent_lifecycle_scripts;
        while installer.manager.state.active_lifecycle_script_count() < max_scripts {
            let Some(entry_id) = installer.pending_lifecycle_scripts.pop_front() else {
                break;
            };
            let node_id = installer.shared.store.entries.items_node_id()[entry_id.get() as usize];
            let dep_id = installer.shared.store.nodes.items_dep_id()[node_id.get() as usize];
            let pkg_id = installer.shared.store.nodes.items_pkg_id()[node_id.get() as usize];
            let optional = !installer.manager.is_package_required(dep_id, pkg_id);
            let list_val = (installer.tasks[entry_id.get() as usize].scripts.as_deref())
                .expect("a queued entry has a scripts list")
                .clone();
            let spawn_res = ScriptCaller::IsolatedLinker(installer)
                .spawn_package_lifecycle_scripts(
                    list_val,
                    optional,
                    false,
                    Some(InstallCtx::Isolated { entry_id }),
                );
            if let Err(err) = spawn_res {
                installer
                    .shared
                    .set_step(entry_id, store_installer::Step::Done);
                installer.on_task_fail(entry_id, &store_installer::TaskError::RunScripts(err));
            }
        }
    }

    for mut task in INBOX.network_tasks.pop_batch() {
        INBOX.decrement_pending_tasks();

        match task.callback {
            NetworkTaskCallback::PackageManifest {
                name: stored_name,
                is_extended_manifest,
                registry,
                ..
            } => {
                let fills_cache = matches!(caller, Caller::ManifestCache(_));
                let Some(manager) = caller.manager() else {
                    continue;
                };
                let name = stored_name.slice();
                name_progress(&manager.state, name, DOWNLOAD);

                // Headers can arrive and the connection still die before the
                // body does; for a 2xx/3xx that is a failed download too (an
                // error status keeps its own handling below).
                let (download_failed, retry) =
                    download_outcome(&task.response, manager.options.runtime_auto_install);
                if download_failed && task.retried > 0 {
                    throttle_after_network_error(
                        &mut manager.install_fields(),
                        &mut has_network_error,
                    );
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
                        let retried = task.retried;
                        let wait = retry_timer::retry(&mut manager.install_fields(), task);

                        if manager.options.log_level.is_verbose() {
                            bun_ast::add_warning_pretty!(
                                manager.log(),
                                None,
                                bun_ast::Loc::EMPTY,
                                "{} downloading package manifest <b>{}<r>. Retry {}/{} in {}ms...",
                                bstr::BStr::new(err.name().as_bytes()),
                                bun_core::fmt::escape_control_chars(name),
                                retried,
                                manager.options.max_retry_count,
                                wait.as_millis(),
                            );
                        }

                        continue;
                    }

                    // Try once more, because the full document was only requested for `libc`.
                    if is_extended_manifest && manager.options.minimum_release_age_ms.is_none() {
                        let is_optional = !manager.state.is_network_task_required(task.task_id);
                        let log = manager.log();
                        task.retry_with_abbreviated_manifest(
                            &manager.install_fields(),
                            log,
                            is_optional,
                        )?;
                        enqueue::enqueue_network_task(&mut manager.state, task);
                        continue;
                    }
                }

                let Some(metadata) = task.response.metadata.as_ref().filter(|_| !download_failed)
                else {
                    // Handle non-retry-able errors.
                    // The dependency that reports it decides between error and warning.
                    let is_required = manager.state.is_network_task_required(task.task_id)
                        || manager.state.task_queue.contains_key(&task.task_id);
                    let log_mark = manager.log().msgs_len();
                    add_error_or_warning_pretty!(
                        manager.log(),
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
                        manager,
                        install_peer,
                        task.task_id,
                        log_mark,
                        failure,
                    )? {
                        fail_update_requests(
                            &mut manager.install_fields(),
                            task.task_id,
                            name,
                            None,
                            is_required,
                        );
                    }

                    continue;
                };

                if metadata.status_code() > 399 {
                    if metadata.status_code() == 404
                        && let Some(entry) = manager.state.network_dedupe_map.get_mut(&task.task_id)
                    {
                        entry.missing_until = npm::Registry::manifest_expiry(metadata);
                    }

                    // A dist-tag on the name of an unpublished workspace links the workspace, once
                    // `get_or_put_resolved_package` sees that the task has failed.
                    if metadata.status_code() == 404
                        && !fills_cache
                        && enqueue::has_linkable_workspace(
                            manager,
                            bun_semver::string::Builder::string_hash(name),
                        )
                    {
                        manager.state.mark_network_task_failed(task.task_id);
                        if !manager.state.task_queue.contains_key(&task.task_id) {
                            continue;
                        }
                    }

                    // The dependency that reports it decides between error and warning.
                    let is_required = manager.state.is_network_task_required(task.task_id)
                        || manager.state.task_queue.contains_key(&task.task_id);
                    let log_mark = manager.log().msgs_len();
                    if is_required {
                        bun_ast::add_error_pretty!(
                            manager.log(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><red><b>GET<r><red> {}<d> - {}<r>",
                            bun_core::fmt::EscapeControlChars(bun_core::fmt::redacted_npm_url(
                                metadata.url()
                            )),
                            metadata.status_code(),
                        );
                    } else {
                        bun_ast::add_warning_pretty!(
                            manager.log(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><yellow><b>GET<r><yellow> {}<d> - {}<r>",
                            bun_core::fmt::EscapeControlChars(bun_core::fmt::redacted_npm_url(
                                metadata.url()
                            )),
                            metadata.status_code(),
                        );
                    }
                    let failure = ManifestFailure {
                        is_missing: metadata.status_code() == 404,
                        is_unanswered: retry,
                        ..Default::default()
                    };
                    if !leave_failure_to_dependencies(
                        manager,
                        install_peer,
                        task.task_id,
                        log_mark,
                        failure,
                    )? {
                        let is_unanswered = is_required && retry;
                        fail_update_requests(
                            &mut manager.install_fields(),
                            task.task_id,
                            name,
                            None,
                            is_unanswered,
                        );
                    }

                    continue;
                }

                if log_level.is_verbose() {
                    bun_core::pretty_error!("    ");
                    Output::print_elapsed(
                        task.request().elapsed() as f64 / bun_core::time::NS_PER_MS as f64,
                    );
                    bun_core::pretty_error!(
                        "\n<d>Downloaded <r><green>{}<r> versions\n",
                        bstr::BStr::new(name),
                    );
                    Output::flush();
                }

                if metadata.status_code() == 304 {
                    let expiry = npm::Registry::manifest_expiry(metadata);
                    // The HTTP request was cached
                    if let NetworkTaskCallback::PackageManifest {
                        loaded_manifest, ..
                    } = &mut task.callback
                        && let Some(mut manifest) = loaded_manifest.take()
                    {
                        // If we requested extended manifest but we somehow got an abbreviated one, this is a bug
                        debug_assert!(
                            !is_extended_manifest || manifest.pkg.has_extended_manifest()
                        );

                        manifest.pkg.public_max_age = expiry;

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

                        if let Some(temp_dir) = manager.manifest_cache_temporary_directory() {
                            npm::package_manifest::Serializer::save_async(
                                manager
                                    .manifests
                                    .hash_map
                                    .get(&name_hash)
                                    .unwrap()
                                    .manifest(),
                                registry,
                                temp_dir,
                            );
                        }

                        // A task that `populate_manifest_cache` started has no entry.
                        if let Some(dependency_list_entry) =
                            manager.state.task_queue.get_mut(&task.task_id)
                        {
                            let dependency_list = core::mem::take(dependency_list_entry);

                            process_dependency_list(manager, &dependency_list, install_peer)?;
                        }

                        continue;
                    }
                }

                enqueue::enqueue_parse_npm_package(manager, stored_name, task);
            }
            NetworkTaskCallback::Extract(ExtractTarball {
                name, resolution, ..
            }) => {
                let manager = &mut caller.install_fields();
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
                        let retried = task.retried;
                        let wait = retry_timer::retry(manager, task);

                        if manager.options.log_level.is_verbose() {
                            bun_ast::add_warning_pretty!(
                                manager.state.log(),
                                None,
                                bun_ast::Loc::EMPTY,
                                "{} downloading tarball <b>{}@{}<r>. Retrying {}/{} in {}ms...",
                                bstr::BStr::new(err.name().as_bytes()),
                                bun_core::fmt::for_terminal(bstr::BStr::new(name.slice())),
                                bun_core::fmt::for_terminal(
                                    resolution
                                        .fmt(&manager.lockfile.buffers.string_bytes, PathSep::Auto),
                                ),
                                retried,
                                manager.options.max_retry_count,
                                wait.as_millis(),
                            );
                        }

                        continue;
                    }
                }

                let extract = task.tarball();

                let Some(metadata) = task.response.metadata.as_ref().filter(|_| !download_failed)
                else {
                    let Some(is_required) = caller.dispatch_tarball_error(
                        task.task_id,
                        extract.dependency_id,
                        extract.name.slice(),
                        &extract.resolution,
                        err,
                        task.request().href(),
                    ) else {
                        continue;
                    };
                    let manager = &mut caller.install_fields();

                    add_error_or_warning_pretty!(
                        manager.state.log(),
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

                    let _ = manager.state.task_queue.remove(&task.task_id);

                    continue;
                };

                if metadata.status_code() > 399 {
                    let Some(is_required) = caller.dispatch_tarball_error(
                        task.task_id,
                        extract.dependency_id,
                        extract.name.slice(),
                        &extract.resolution,
                        match metadata.status_code() {
                            400 => crate::Error::TarballHTTP400,
                            401 => crate::Error::TarballHTTP401,
                            402 => crate::Error::TarballHTTP402,
                            403 => crate::Error::TarballHTTP403,
                            404 => crate::Error::TarballHTTP404,
                            405..=499 => crate::Error::TarballHTTP4xx,
                            _ => crate::Error::TarballHTTP5xx,
                        },
                        task.request().href(),
                    ) else {
                        continue;
                    };
                    let manager = &mut caller.install_fields();

                    if is_required {
                        bun_ast::add_error_pretty!(
                            manager.state.log(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><red><b>GET<r><red> {}<d> - {}<r>",
                            bun_core::fmt::EscapeControlChars(bun_core::fmt::redacted_npm_url(
                                metadata.url()
                            )),
                            metadata.status_code(),
                        );
                    } else {
                        bun_ast::add_warning_pretty!(
                            manager.state.log(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "<r><yellow><b>GET<r><yellow> {}<d> - {}<r>",
                            bun_core::fmt::EscapeControlChars(bun_core::fmt::redacted_npm_url(
                                metadata.url()
                            )),
                            metadata.status_code(),
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

                    let _ = manager.state.task_queue.remove(&task.task_id);

                    continue;
                }

                if log_level.is_verbose() {
                    bun_core::pretty_error!("    ");
                    Output::print_elapsed(
                        task.request().elapsed() as f64 / bun_core::time::NS_PER_MS as f64,
                    );
                    bun_core::pretty_error!(
                        "<d> Downloaded <r><green>{}<r> tarball\n",
                        bun_core::fmt::for_terminal(bstr::BStr::new(extract.name.slice())),
                    );
                    Output::flush();
                }

                name_progress(manager.state, extract.name.slice(), EXTRACT);

                enqueue::enqueue_extract_npm_package(manager.state, task);
            }
        }
    }

    for mut task in INBOX.resolve_tasks.pop_batch() {
        let task = &mut *task;
        INBOX.decrement_pending_tasks();

        // An error in a manifest is reported by the dependency that needs it, if there is one.
        let holds_log = matches!(task.job, Task::Job::PackageManifest { .. })
            && task.status == Task::Status::Fail;
        if task.log.has_msgs() && !holds_log {
            task.log.print(Output::error_writer())?;
            if task.log.has_errors() {
                caller.install_fields().state.any_failed_to_install = true;
            }
            task.log.reset();
        }

        match &mut task.job {
            Task::Job::PackageManifest { name, manifest, .. } => {
                let fills_cache = matches!(caller, Caller::ManifestCache(_));
                let Some(manager) = caller.manager() else {
                    continue;
                };
                let Some(manifest) = manifest.take() else {
                    let log_mark = manager.log().msgs_len();
                    if holds_log {
                        task.log.append_to(manager.log());
                    }
                    let name = name.slice();
                    let err = task.err.unwrap_or(crate::Error::Failed);

                    bun_ast::add_error_pretty!(
                        manager.log(),
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
                        manager,
                        install_peer,
                        task.id,
                        log_mark,
                        failure,
                    )?;

                    continue;
                };
                let name_hash = manifest.pkg.name.hash;
                let progress_name: Option<Vec<u8>> =
                    (log_level.show_progress() && !has_updated_this_run.get() && !fills_cache)
                        .then(|| manifest.name().to_vec());

                manager.manifests.insert(name_hash, manifest)?;
                manager.look_ahead.arrived.push(task.id);
                if let Some(entry) = manager.state.network_dedupe_map.get_mut(&task.id) {
                    entry.manifest = crate::network_task::ManifestOrigin::Registry;
                }

                // A task that `populate_manifest_cache` started has no entry.
                if let Some(dependency_list_entry) = manager.state.task_queue.get_mut(&task.id) {
                    let dependency_list = core::mem::take(dependency_list_entry);

                    process_dependency_list(manager, &dependency_list, install_peer)?;
                }

                if let Some(name) = progress_name {
                    manager.state.set_node_name(
                        manager.state.downloads_node(),
                        &name,
                        ProgressStrings::DOWNLOAD_EMOJI.as_bytes(),
                    );
                    has_updated_this_run.set(true);
                }
            }
            Task::Job::Extract {
                tarball,
                source,
                data,
            } => {
                let dependency_id = tarball.dependency_id;
                let alias = tarball.name.slice();
                let resolution = &tarball.resolution;

                let Some(data) = data else {
                    let err = task.err.unwrap_or(crate::Error::TarballFailedToExtract);

                    let fail_url: &[u8] = match source {
                        Task::TarballSource::Network(network) => network.request().href(),
                        Task::TarballSource::Local { .. } => tarball.url.slice(),
                    };
                    // A linker's task for a local tarball is not in the map, so it gets no mark.
                    let Some(is_required) = caller.dispatch_tarball_error(
                        task.id,
                        dependency_id,
                        alias,
                        resolution,
                        err,
                        fail_url,
                    ) else {
                        continue;
                    };
                    let manager = &mut caller.install_fields();

                    add_error_or_warning_pretty!(
                        manager.state.log(),
                        is_required,
                        "{} extracting tarball from <b>{}<r>",
                        err.name(),
                        bun_core::fmt::for_terminal(bstr::BStr::new(alias)),
                    );
                    fail_update_requests(manager, task.id, alias, Some(dependency_id), false);

                    // Resolve phase: drain the
                    // `task_queue` entry too so a later install-phase
                    // `enqueue_download` doesn't wedge on `found_existing`.
                    let _ = manager.state.task_queue.remove(&task.id);

                    continue;
                };

                let manager = caller.install_fields();
                let mut package_id = manager.lockfile.buffers.resolutions[dependency_id as usize];
                manager.state.extracted_count += 1;
                bun_core::analytics::Features::extracted_packages_inc();

                match caller {
                    Caller::HoistedLinker(installer) => installer
                        .install_enqueued_packages_after_extraction(
                            task.id,
                            dependency_id,
                            data,
                            log_level,
                        ),
                    Caller::IsolatedLinker(installer) => {
                        installer.on_package_extracted(task.id, data)
                    }
                    Caller::Resolver(manager)
                    | Caller::BlockedImport(manager)
                    | Caller::ManifestCache(manager) => {
                        if manager.defers_remote_package(task.id, resolution) {
                            manager.keep_arrived_package(task.id, resolution, data);
                            name_progress(&manager.state, alias, EXTRACT);
                            continue;
                        } else if let Some(pkg) = manager.process_extracted_tarball_package(
                            &mut package_id,
                            resolution,
                            data,
                            log_level,
                        ) {
                            resolve_waiters_of_appended_package(
                                manager,
                                task.id,
                                &pkg,
                                install_peer,
                            )?;
                        } else if let Some(dependency_list_entry) = (manager.state.task_queue)
                            .get_mut(&Task::Id::for_manifest(manager.lockfile.str(
                                &manager.lockfile.packages.items_name()[package_id as usize],
                            )))
                        {
                            // Peer dependencies do not initiate any downloads of their own, thus need to be resolved here instead
                            let dependency_list = core::mem::take(dependency_list_entry);
                            process_dependency_list(manager, &dependency_list, install_peer)?;
                        }
                    }
                }

                let manager = caller.install_fields();
                (manager.state.preinstall_state).set(
                    manager.lockfile,
                    package_id,
                    crate::PreinstallState::Done,
                );

                name_progress(manager.state, alias, EXTRACT);
            }
            &mut Task::Job::GitClone {
                request: ref clone,
                repo: repo_fd,
            } => {
                let name = clone.name.slice();
                let url = clone.url.slice();
                let is_linker = caller.is_linker();
                let manager = &mut caller.install_fields();

                if task.status == Task::Status::Fail {
                    let err = task.err.unwrap_or(crate::Error::Failed);
                    let is_required = manager.state.is_network_task_required(task.id);
                    let waiters = forget_failed_git_task(manager, task.id, name);

                    if let Caller::IsolatedLinker(installer) = caller {
                        let lockfile = installer.shared.lockfile;
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
                            let res = &lockfile.packages.items_resolution()[package_id as usize];
                            let git = res.git();
                            let checkout_id = Task::Id::for_git_checkout(
                                lockfile.str(&git.repo),
                                lockfile.str(&git.resolved),
                            );
                            if is_required {
                                installer.on_package_download_error(
                                    checkout_id,
                                    name,
                                    res,
                                    err,
                                    url,
                                );
                            } else {
                                installer.on_optional_package_download_error(checkout_id);
                            }
                        }
                    }

                    // If the dependency that requires it joined later, git's own output was only
                    // logged as warnings, so report the error here.
                    if !is_required || !matches!(caller, Caller::IsolatedLinker(_)) {
                        add_error_or_warning_pretty!(
                            caller.install_fields().state.log(),
                            is_required,
                            "{} cloning repository for <b>{}<r>",
                            err.name(),
                            bun_core::fmt::for_terminal(bstr::BStr::new(name)),
                        );
                    }
                    continue;
                }

                manager.state.git_repositories.insert(task.id, repo_fd);

                // `bun pm fetch` has no installer, but like an installer, it queues its checkouts
                // on the clone task.
                let has_checkout_waiters = is_linker
                    || manager
                        .state
                        .task_queue
                        .get(&task.id)
                        .is_some_and(|waiters| {
                            waiters.iter().any(|waiter| {
                                matches!(
                                    waiter,
                                    bun_install::TaskCallbackContext::GitCheckout { .. }
                                )
                            })
                        });
                if has_checkout_waiters {
                    // Installing! The clone task is shared by every dependency on
                    // this repo URL; enqueue a checkout per waiter, not just one.
                    let Some(waiters) = manager.state.task_queue.remove(&task.id) else {
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
                        let dep = &manager.lockfile.buffers.dependencies[dep_id as usize];
                        let res =
                            &manager.lockfile.packages.items_resolution()[package_id as usize];
                        let git = res.git();
                        let checkout_id = Task::Id::for_git_checkout(
                            manager.lockfile.str(&git.repo),
                            manager.lockfile.str(&git.resolved),
                        );

                        if manager
                            .state
                            .has_created_network_task(checkout_id, dep.behavior.is_required())
                        {
                            continue;
                        }

                        let resolved = stored_string(manager.lockfile.str(&git.resolved));
                        let queued = enqueue::enqueue_git_checkout(
                            manager,
                            checkout_id,
                            repo_fd,
                            dep_id,
                            dep.name,
                            res,
                            resolved,
                            None,
                        );
                        manager.enqueue_git_task(queued);
                    }
                } else if let Some(manager) = caller.manager() {
                    // Resolving!
                    let dependency_list = manager
                        .state
                        .task_queue
                        .remove(&task.id)
                        .expect("infallible: task queued");

                    process_dependency_list(manager, &dependency_list, install_peer)?;
                }

                name_progress(caller.install_fields().state, name, DOWNLOAD);
            }
            Task::Job::GitCommit {
                request: commit,
                sha,
            } => {
                let Some(manager) = caller.manager() else {
                    continue;
                };
                let name = commit.name.slice();
                // Pending while it ran, but not one of the N downloads the summary prints.
                manager.state.total_tasks.update(|total| total - 1);

                if task.status == Task::Status::Fail {
                    let is_required = manager.state.is_network_task_required(task.id);
                    // The repository (with `--offline`, its cached clone) has no such commit.
                    for waiter in
                        forget_failed_git_task(&mut manager.install_fields(), task.id, name).iter()
                    {
                        if let &bun_install::TaskCallbackContext::Dependency(id) = waiter {
                            manager.lockfile.unbind_refreshing(id);
                        }
                    }
                    add_error_or_warning(
                        manager.log(),
                        is_required,
                        format_args!(
                            "no commit matching \"{}\" found for \"{}\" (but repository exists)",
                            bun_core::fmt::escape_control_chars(commit.committish.slice()),
                            bun_core::fmt::for_terminal(bstr::BStr::new(name)),
                        ),
                    );
                    continue;
                }

                manager.git_commits.insert(task.id, core::mem::take(sha));

                // Each waiter re-enters the enqueue path and now finds the commit.
                let dependency_list = manager
                    .state
                    .task_queue
                    .remove(&task.id)
                    .expect("infallible: task queued");
                process_dependency_list(manager, &dependency_list, install_peer)?;
            }
            Task::Job::GitCheckout {
                request: git_checkout,
                data,
            } => {
                let alias = &git_checkout.name;
                let resolution = &git_checkout.resolution;
                let mut package_id: PackageID = INVALID_PACKAGE_ID;

                let Some(data) = data else {
                    let err = task.err.unwrap_or(crate::Error::Failed);

                    if let Caller::IsolatedLinker(installer) = caller {
                        // SAFETY: `resolution.tag == Git` — git-checkout tasks are
                        // only enqueued for git resolutions; `value.git` is the
                        // active union arm.
                        let repo = &resolution.git().repo;
                        installer.on_package_download_error(
                            task.id,
                            alias.slice(),
                            resolution,
                            err,
                            installer.shared.lockfile.str(repo),
                        );
                    } else {
                        let manager = &mut caller.install_fields();
                        bun_ast::add_error_pretty!(
                            manager.state.log(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "{} checking out repository for <b>{}<r>",
                            err.name(),
                            bun_core::fmt::for_terminal(bstr::BStr::new(alias.slice())),
                        );
                        let _ = forget_failed_git_task(manager, task.id, alias.slice());
                    }

                    continue;
                };

                caller.install_fields().state.extracted_count += 1;
                bun_core::analytics::Features::extracted_packages_inc();

                match caller {
                    Caller::HoistedLinker(installer) => installer
                        .install_enqueued_packages_after_extraction(
                            task.id,
                            git_checkout.dependency_id,
                            data,
                            log_level,
                        ),
                    Caller::IsolatedLinker(installer) => {
                        installer.on_package_extracted(task.id, data)
                    }
                    Caller::Resolver(manager)
                    | Caller::BlockedImport(manager)
                    | Caller::ManifestCache(manager) => {
                        if manager.defers_remote_package(task.id, resolution) {
                            manager.keep_arrived_package(task.id, resolution, data);
                        } else if let Some(pkg) = manager.process_extracted_tarball_package(
                            &mut package_id,
                            resolution,
                            data,
                            log_level,
                        ) {
                            resolve_waiters_of_appended_package(
                                manager,
                                task.id,
                                &pkg,
                                install_peer,
                            )?;
                        }
                    }
                }

                name_progress(caller.install_fields().state, alias.slice(), DOWNLOAD);
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
        .map(|reply| reply.status_code());
    let failed = match &response.metadata {
        None => proxy_status.is_none(),
        Some(m) => response.fail.is_some() && m.status_code() < 400,
    };
    let status = response
        .metadata
        .as_ref()
        .map(|m| m.status_code())
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
            Some(reply) => write!(f, " ({})", reply.status_code()),
            None => Ok(()),
        }
    }
}

impl InstallState {
    #[inline]
    pub(crate) fn pending_task_count(&self) -> u32 {
        INBOX.pending_tasks.load(Ordering::Acquire) + self.retry_queue.len() as u32
    }

    #[inline]
    pub(crate) fn increment_pending_tasks(&self, count: u32) {
        self.total_tasks.update(|total| total + count);
        // Relaxed is enough, because starting a task has no side effects that other threads depend
        // on.
        let _ = INBOX.pending_tasks.fetch_add(count, Ordering::Relaxed);
    }
}

pub(crate) fn enqueue_due_retries(this: &mut InstallState) {
    while let Some(network_task) = this.retry_queue.pop_due() {
        enqueue::enqueue_network_task(this, network_task);
    }
}

fn flush_patch_batch(this: &mut InstallState) {
    this.task_batch.push(core::mem::take(&mut this.patch_batch));
}

fn flush_dependency_queue(this: &mut PackageManager) {
    let mut last_count = this.state.total_tasks.get();
    loop {
        enqueue_due_retries(&mut this.state);
        enqueue::advance(this);
        flush_patch_batch(&mut this.state);

        if this.state.total_tasks.get() == last_count {
            break;
        }
        last_count = this.state.total_tasks.get();
    }
}

pub(crate) fn schedule_tasks(manager: &mut InstallFields<'_>) -> usize {
    let state = &mut *manager.state;
    let count = state.task_batch.len()
        + state.network_resolve_batch.len()
        + state.network_tarball_batch.len();

    state.increment_pending_tasks(u32::try_from(count).expect("int cast"));
    install_pool().schedule(core::mem::take(&mut state.task_batch));
    let manifests = state.network_resolve_batch.drain(..);
    http::OwnedRequest::schedule(manifests.chain(state.network_tarball_batch.drain(..)));
    // Git tasks were counted as pending when they were queued.
    manager.start_git_tasks();
    count
}

pub(crate) fn alloc_github_url_for_ref(
    env: &bun_dotenv::Loader,
    lockfile: &Lockfile,
    repository: &Repository,
    committish: &[u8],
) -> Vec<u8> {
    let mut github_api_url: &[u8] = b"https://api.github.com";
    if let Some(url) = env.get(b"GITHUB_API_URL") {
        if !url.is_empty() {
            github_api_url = url;
        }
    }

    let owner = lockfile.str(&repository.owner);
    let repo = lockfile.str(&repository.repo);

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
    this: &mut InstallFields<'_>,
    task_id: Task::Id,
    name: &[u8],
) -> TaskCallbackList {
    fail_update_requests(this, task_id, name, None, false);
    let _ = this.state.network_dedupe_map.remove(&task_id);
    this.state.task_queue.remove(&task_id).unwrap_or_default()
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
    ) && !manager.state.is_network_task_required(task_id)
        && !manager.state.task_queue.contains_key(&task_id)
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
    is_bunx_tree(FileSystem::get().top_level_dir())
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
    this: &mut InstallFields<'_>,
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
    let lockfile = this.lockfile;
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let waiters = this
        .state
        .task_queue
        .get(&task_id)
        .map_or(&[][..], Vec::as_slice);
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
    let pending = this.pending_filtered_write;

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
        this.state.update_request_failed = true;
        if unanswered {
            REQUEST_GOT_NO_ANSWER.store(true, Ordering::Relaxed);
        }
    }
}

/// Runs once per pass. Skipped for auto-install, because the limit also applies to `fetch()`.
fn throttle_after_network_error(manager: &mut InstallFields<'_>, has_network_error: &mut bool) {
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
                manager.state.log(),
                None,
                bun_ast::Loc::EMPTY,
                "request failed twice, limiting to {} concurrent requests",
                lowered,
            );
        }
    }
}

pub(crate) fn generate_network_task_for_tarball(
    this: &mut InstallFields<'_>,
    task_id: Task::Id,
    github_url: Option<&[u8]>,
    is_required: bool,
    dependency_id: DependencyID,
    package: &Package,
) -> Result<Option<HiveBox<NetworkTask>>, ForTarballError> {
    // Only reached when the tarball is not already extracted in the cache.
    if this.options.offline == Options::OfflineMode::Offline {
        enqueue::offline_miss(this, task_id, "", package.name, is_required);
        return Err(ForTarballError::Offline);
    }
    if this.state.has_created_network_task(task_id, is_required) {
        return Ok(None);
    }

    let temp_dir = match directories::try_get_temporary_directory(this) {
        Ok(temp_dir) => temp_dir,
        Err(why) => {
            this.exit_or_log(&why);
            this.state.mark_network_task_failed(task_id);
            // No task was started, so the entry is removed. Otherwise a later enqueue would wait
            // for a task that never runs.
            let _ = this.state.task_queue.remove(&task_id);
            return Err(ForTarballError::AlreadyFailed);
        }
    };

    let log = this.state.log();
    let pkg_name = this.lockfile.str(&package.name);
    let url = match (github_url, package.resolution.tag) {
        (Some(url), _) => url,
        (None, bun_install::ResolutionTag::Npm) => this.lockfile.str(&package.resolution.npm().url),
        (None, _) => this.lockfile.str(package.resolution.remote_tarball()),
    };
    let (scope, authorization) = match package.resolution.tag {
        bun_install::ResolutionTag::Npm => (
            this.options.scope_for_package_name(pkg_name),
            Authorization::AllowAuthorization,
        ),
        // One download serves every name that the URL is listed under, so the name picks no scope.
        bun_install::ResolutionTag::RemoteTarball
            if this.lockfile.is_tarball_url_of_project(url) =>
        {
            (&this.options.scope, Authorization::AllowAuthorization)
        }
        _ => (
            this.options.scope_for_package_name(pkg_name),
            Authorization::NoAuthorization,
        ),
    };

    let extract_tarball = ExtractTarball {
        registry: directories::folder_cache_key(this.options, scope),
        name: stored_string(pkg_name),
        resolution: package.resolution,
        temp_dir,
        dependency_id,
        skip_verify: this.options.skips_verify(package.resolution.tag),
        in_trusted_dependencies: this.in_trusted_dependencies(pkg_name),
        integrity: package.meta.integrity,
        stays_unpinned: package.meta.id != bun_install::invalid_package_id && !this.pins_tarballs(),
        url: stored_string(url),
        // Copied here: extract workers must not read lockfile buffers.
        github_resolved: if package.resolution.tag == bun_install::ResolutionTag::Github
            && let resolved @ [_, ..] = this.lockfile.str(&package.resolution.github().resolved)
        {
            bun_core::handle_oom(FileSystem::get().dirname_store().append(resolved))
        } else {
            b""
        },
    };

    let task = NetworkTask::for_tarball(this, log, task_id, extract_tarball, scope, authorization);
    if task.is_err() {
        // No task will ever complete the dedupe entry, so a later enqueue would wait forever.
        this.state.mark_network_task_failed(task_id);
    }
    task.map(Some)
}

impl PackageManager {
    pub(crate) fn drain_dependency_list(&mut self) {
        loop {
            // Step 2. If there were cached dependencies, go through all of those but don't download
            // the devDependencies for them.
            flush_dependency_queue(self);

            if PackageManager::verbose_install() {
                Output::flush();
            }

            // It's only network requests here because we don't store tarballs.
            let _ = schedule_tasks(&mut self.install_fields());

            // With no task left to finish, nothing would ever try the dependency at the front of
            // the queue again. It stays unresolved, so that the ones behind it get their turn.
            if self.state.pending_task_count() > 0 {
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
}

impl InstallState {
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
}

impl InstallFields<'_> {
    /// `drain_dependency_list` without resolving dependencies.
    pub(crate) fn schedule_queued_tasks(&mut self) {
        enqueue_due_retries(self.state);
        flush_patch_batch(self.state);
        if PackageManager::verbose_install() {
            Output::flush();
        }
        let _ = schedule_tasks(self);
    }

    pub(crate) fn alloc_github_url(&self, repository: &Repository) -> Vec<u8> {
        let committish = self.lockfile.str(&repository.committish);
        alloc_github_url_for_ref(self.state.env(), self.lockfile, repository, committish)
    }
}

/// A manifest request ended without a manifest, and the messages logged since `log_mark` say why.
/// Removes them from the log, because each dependency that needs the manifest reports the failure
/// when it's resolved. If no dependency asked for the manifest, `populate_manifest_cache` did, and
/// its caller reads the log. In that case this returns false and leaves the log alone.
fn leave_failure_to_dependencies(
    manager: &mut PackageManager,
    install_peer: bool,
    task_id: Task::Id,
    log_mark: usize,
    failure: ManifestFailure,
) -> crate::Result<bool> {
    let Some(waiting) = manager
        .state
        .task_queue
        .get_mut(&task_id)
        .map(core::mem::take)
    else {
        let _ = (manager.manifest_failures).insert(task_id, ManifestFailure::already_reported());
        return Ok(false);
    };
    manager.keep_manifest_failure(task_id, log_mark, failure);
    // `advance` tries the queued dependencies again. Only imports of the runtime wait in this list.
    process_dependency_list(manager, &waiting, install_peer)?;
    Ok(true)
}

/// Resolves the rows that waited for a task.
fn process_dependency_list(
    manager: &mut PackageManager,
    dependency_list: &TaskCallbackList,
    install_peer: bool,
) -> crate::Result<()> {
    for item in dependency_list.iter() {
        manager.process_dependency_list_item(item, install_peer)?;
    }
    Ok(())
}
