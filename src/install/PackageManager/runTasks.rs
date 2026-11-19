use crate::lockfile::package::PackageColumns as _;
use core::sync::atomic::Ordering;
use std::io::Write as _;

use bun_core::strings;
use bun_core::{Environment, Output};
use bun_http::{self as http, AsyncHTTP};
use bun_threading::thread_pool::Batch as ThreadPoolBatch;

use crate::bun_fs::FileSystem;
use crate::extract_tarball;
use crate::network_task::{Callback as NetworkTaskCallback, ManifestRequest};
use crate::npm;
use crate::patch_install::Callback as PatchTaskCallback;
use crate::retry_timer;
use crate::tarball_stream::TarballStream;
use bun_install::{
    DependencyID, ExtractData, ExtractTarball, INVALID_PACKAGE_ID, NetworkTask, Repository,
    Resolution, ResolutionTag,
};

use super::fetch_table::{Claim, Ended, Need, Started, Turn, WaitingRow};
use super::manifest_requests::{Answered, Origin, Reader};
use super::{INBOX, THREAD_POOL, directories, enqueue};
use super::{
    ManifestFailure, PackageInstaller, PackageManager, ProgressStrings, RemoteTurn, Subcommand,
};
use crate::isolated_install::installer as store_installer;
use crate::isolated_install::store::{EntryColumns as _, NodeColumns as _};
use crate::lifecycle_script_runner::{InstallCtx, LifecycleScriptSubprocess};
use crate::network_task::{Authorization, ForTarballError, add_error_or_warning, stored_string};
use bun_core::fmt::PathSep;
use bun_install::lockfile::Package;
use bun_install::package_manager_task as Task;
// Import the *module* under the `Options` name so `Options::LogLevel` resolves as a path
// (matches the `Task` module-alias pattern above and `CommandLineArguments.rs`).
use super::package_manager_options as Options;
use super::package_manager_options::Do;
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
    Resolver,
    /// Resolves the dependency of an import that blocks the runtime's thread.
    BlockedImport,
    /// Fills the manifest cache.
    ManifestCache,
    HoistedLinker(&'c mut PackageInstaller<'i>),
    IsolatedLinker(&'c mut Store::Installer<'i>),
}

impl Caller<'_, '_> {
    /// Lets go of what a linker has waiting for `fetch`. Returns true if `err` is reported now.
    fn report_failed_fetch(
        &mut self,
        fetch: Task::PackageFetchId,
        is_required: bool,
        name: &[u8],
        res: &Resolution,
        err: crate::Error,
        url: &[u8],
    ) -> bool {
        match self {
            Self::IsolatedLinker(installer) => {
                installer.on_package_download_error(fetch, is_required, name, res, err, url);
                is_required
            }
            Self::HoistedLinker(installer) => {
                drop(installer.waits_for_fetch.take(fetch));
                false
            }
            Self::Resolver | Self::BlockedImport | Self::ManifestCache => false,
        }
    }

    fn is_linker(&self) -> bool {
        matches!(self, Self::HoistedLinker(_) | Self::IsolatedLinker(_))
    }
}

/// One call of `run_tasks`. `Drop` is the cleanup that runs however it exits.
struct Pass<'a, 'c, 'i> {
    manager: &'a mut PackageManager,
    caller: Caller<'c, 'i>,
    install_peer: bool,
    log_level: Options::LogLevel,
    has_named_progress: bool,
    has_network_error: bool,
}

impl Drop for Pass<'_, '_, '_> {
    fn drop(&mut self) {
        let manager = &mut *self.manager;
        manager.drain_dependency_list();

        if self.log_level.show_progress() {
            manager.start_progress_bar_if_none();

            if matches!(self.caller, Caller::Resolver | Caller::ManifestCache) {
                let completed_items =
                    (manager.total_tasks.get() - manager.pending_task_count()) as usize;
                let node = manager.progress.node(manager.downloads_node());
                if completed_items != node.completed_items.get() || self.has_named_progress {
                    node.completed_items.set(completed_items);
                    node.estimated_total_items
                        .set(manager.total_tasks.get() as usize);
                }
            }
            // The progress bar shows the node that was activated last, so the downloads node is
            // only activated once there is something to download.
            if manager.total_tasks.get() > 0 {
                manager.progress.activate(manager.downloads_node());
            }
            manager.progress.maybe_refresh();
        }
    }
}

/// Where a `NetworkTask` goes once its response was looked at.
enum Next {
    Retry,
    AskForAbbreviated {
        request: ManifestRequest,
        cached: Option<npm::PackageManifest>,
        answered: Answered,
    },
    Parse(ManifestRequest, http::HTTPResponseMetadata),
    Extract(ExtractTarball),
    Free,
}

/// A failure that is still to be logged.
struct Unreported {
    is_required: bool,
    rows: Vec<WaitingRow>,
}

const DOWNLOAD: &str = ProgressStrings::DOWNLOAD_EMOJI;
const EXTRACT: &str = ProgressStrings::EXTRACT_EMOJI;

/// Resolves the dependencies that waited for `fetch` to `pkg`, and fills in the package's name
/// where a dependency did not know it.
pub(crate) fn resolve_waiters_of_appended_package(
    manager: &mut PackageManager,
    fetch: Ended<Task::PackageFetchId>,
    pkg: &Package,
    install_peer: bool,
) -> crate::Result<()> {
    for row in manager.fetches.appended(fetch, pkg.meta.id) {
        enqueue::name_resolved_row(
            &mut manager.lockfile.buffers.dependencies[row.id as usize].version,
            pkg.name,
            &pkg.resolution,
        );
        manager.resolve_waiting_row(row, install_peer)?;
    }
    Ok(())
}

pub(crate) fn run_tasks(
    manager: &mut PackageManager,
    caller: Caller<'_, '_>,
    install_peer: bool,
    log_level: Options::LogLevel,
) -> crate::Result<()> {
    let mut pass = Pass {
        manager,
        caller,
        install_peer,
        log_level,
        has_named_progress: false,
        has_network_error: false,
    };
    let manager = &mut *pass.manager;

    let patch_tasks_batch = INBOX.patch_tasks.pop_batch();
    let mut patch_tasks_iter = patch_tasks_batch.iterator();
    loop {
        let ptask_ptr = patch_tasks_iter.next();
        if ptask_ptr.is_null() {
            break;
        }
        // SAFETY: the `Box` that `PatchTask::run` pushed; `next` read its link before returning it.
        let mut ptask = unsafe { bun_core::heap::take(ptask_ptr) };
        debug_assert!(manager.pending_task_count() > 0);
        INBOX.decrement_pending_tasks();
        ptask.run_from_main_thread(manager, log_level)?;
        if let PatchTaskCallback::Apply(apply) = &mut ptask.callback {
            if apply.logger.errors == 0 {
                if let Caller::HoistedLinker(installer) = &mut pass.caller {
                    if let Some(ctx) = apply.install_context.as_mut() {
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
            } else {
                // Patch application failed - propagate error to cause install failure
                return Err(crate::Error::InstallFailed);
            }
        }
    }

    if let Caller::IsolatedLinker(installer) = &mut pass.caller {
        let installer_ptr: *mut Store::Installer<'_> = &raw mut **installer;
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
            let list_val = (installer.tasks[entry_id.get() as usize].scripts.as_deref())
                .expect("a queued entry has a scripts list")
                .clone();
            let spawn_res = manager.spawn_package_lifecycle_scripts(
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

    let network_tasks_batch = INBOX.network_tasks.pop_batch();
    let mut network_tasks_iter = network_tasks_batch.iterator();
    loop {
        let task_ptr = network_tasks_iter.next();
        if task_ptr.is_null() {
            break;
        }
        debug_assert!(pass.manager.pending_task_count() > 0);
        INBOX.decrement_pending_tasks();
        // SAFETY: `next()` returned non-null; node is exclusively owned by this batch.
        let task = unsafe { &mut *task_ptr };
        let outcome = download_outcome(&task.response, pass.manager.options.runtime_auto_install);
        if outcome.failed && task.retried > 0 {
            throttle_after_network_error(pass.manager, &mut pass.has_network_error);
        }
        let attempt = Attempt {
            outcome,
            retried: task.retried,
            elapsed: task.http.as_ref().map_or(0, |http| http.elapsed),
        };
        let next = match &mut task.callback {
            NetworkTaskCallback::PackageManifest {
                request,
                loaded_manifest,
            } => pass.on_manifest_response(request, loaded_manifest, &mut task.response, attempt),
            NetworkTaskCallback::Extract(tarball) => {
                // `TarballStream::finish()` un-commits a stream whose connection failed mid-body.
                debug_assert!(!task.streaming_committed);
                Ok(pass.on_tarball_response(tarball, &task.response, &task.url_buf, attempt))
            }
        };
        let manager = &mut *pass.manager;
        let result = match next {
            Ok(Next::Retry) => {
                task.retried += 1;
                let wait = retry_timer::retry(manager, task_ptr, task.retried, &task.response);
                if manager.options.log_level.is_verbose() {
                    log_retry(manager, task, wait);
                }
                task.reset_for_retry();
                continue;
            }
            Ok(Next::AskForAbbreviated {
                request,
                cached,
                answered,
            }) => {
                // It borrows the buffers that are replaced below.
                task.http = None;
                task.reset_for_retry();
                let scope = manager.scope_for_package_name(request.name.slice());
                let is_optional = answered.reader() == Reader::OptionalBackfill;
                match task.for_manifest(&request, scope, cached.as_ref(), is_optional) {
                    Ok(()) => {
                        manager.manifest_requests.sent_again(answered);
                        enqueue::enqueue_network_task(manager, task_ptr);
                        continue;
                    }
                    Err(err) => {
                        let reported = ManifestFailure::already_reported();
                        drop(manager.manifest_requests.failed(answered, reported));
                        Err(err.into())
                    }
                }
            }
            Ok(Next::Parse(request, metadata)) => {
                // SAFETY: the slot goes back to the pool with the resolve task.
                let queued = unsafe {
                    enqueue::enqueue_parse_npm_package(manager, request, metadata, task_ptr)
                };
                manager.task_batch.push(ThreadPoolBatch::from(queued));
                continue;
            }
            Ok(Next::Extract(tarball)) => {
                task.discard_unused_streaming_state(manager);
                let queued = enqueue::enqueue_extract_npm_package(manager, &tarball, task_ptr);
                manager.task_batch.push(ThreadPoolBatch::from(queued));
                continue;
            }
            Ok(Next::Free) => Ok(()),
            Err(err) => Err(err),
        };
        task.discard_unused_streaming_state(manager);
        // SAFETY: `task_ptr` is the sole live handle to this pool slot.
        unsafe { manager.preallocated_network_tasks.put(task_ptr) };
        result?;
    }

    let resolve_tasks_batch = INBOX.resolve_tasks.pop_batch();
    let mut resolve_tasks_iter = resolve_tasks_batch.iterator();
    loop {
        let task_ptr = resolve_tasks_iter.next();
        if task_ptr.is_null() {
            break;
        }
        debug_assert!(pass.manager.pending_task_count() > 0);
        INBOX.decrement_pending_tasks();
        // SAFETY: `task_ptr` non-null per loop guard; node exclusively owned by this batch.
        let task = unsafe { &mut *task_ptr };
        let result = pass.on_resolve_task(task);
        let network = task.network_task();
        // SAFETY: these are the sole live handles to their pool slots.
        unsafe {
            if let Some(network) = network {
                pass.manager.preallocated_network_tasks.put(network);
            }
            pass.manager.preallocated_resolve_tasks.put(task_ptr);
        }
        result?;
    }

    Ok(())
}

impl Pass<'_, '_, '_> {
    /// The progress bar shows the name of the first task in each pass.
    fn name_progress(&mut self, name: &[u8], emoji: &str) {
        if self.log_level.show_progress() && !core::mem::replace(&mut self.has_named_progress, true)
        {
            let manager = &*self.manager;
            manager.set_node_name(manager.downloads_node(), name, emoji.as_bytes());
        }
    }

    fn resolve_rows(&mut self, rows: impl IntoIterator<Item = WaitingRow>) -> crate::Result<()> {
        (rows.into_iter())
            .try_for_each(|row| self.manager.resolve_waiting_row(row, self.install_peer))
    }

    fn on_manifest_response(
        &mut self,
        request: &ManifestRequest,
        loaded_manifest: &mut Option<npm::PackageManifest>,
        response: &mut http::HTTPClientResult<'static>,
        attempt: Attempt,
    ) -> crate::Result<Next> {
        let Outcome { failed, retry } = attempt.outcome;
        let name = request.name.slice();
        self.name_progress(name, DOWNLOAD);
        let manager = &mut *self.manager;

        let is_ok = |metadata: &mut http::HTTPResponseMetadata| metadata.status_code() < 400;
        if !failed && let Some(metadata) = response.metadata.take_if(is_ok) {
            if self.log_level.is_verbose() {
                print_elapsed(attempt.elapsed);
                bun_core::pretty_error!(
                    "\n<d>Downloaded <r><green>{}<r> versions\n",
                    bstr::BStr::new(name),
                );
                Output::flush();
            }

            // A copy without publish times was not offered, so the parse reports the 304.
            let needs_times = manager.options.minimum_release_age_ms.is_some();
            if metadata.status_code() == 304
                && let Some(mut manifest) = (loaded_manifest.take())
                    .filter(|manifest| !needs_times || manifest.pkg.has_extended_manifest())
            {
                manifest.pkg.public_max_age = npm::Registry::manifest_expiry(&metadata);
                if let Some(temp_dir) = manager.manifest_cache_temporary_directory() {
                    npm::package_manifest::Serializer::save_async(
                        &manifest,
                        request.registry,
                        temp_dir,
                    );
                }
                self.on_manifest(request.id, manifest, Origin::Cache)?;
                return Ok(Next::Free);
            }
            return Ok(Next::Parse(*request, metadata));
        }

        let answered = manager.manifest_requests.finish(request.id);
        let reader = answered.reader();
        // If rows read it, the one that reports a failure decides between error and warning.
        let is_required = reader != Reader::OptionalBackfill;

        if retry {
            if attempt.retried < manifest_retry_count(manager, is_required, name, response.fail) {
                manager.manifest_requests.sent_again(answered);
                return Ok(Next::Retry);
            }
            // Try once more, because the full document was only requested for `libc`.
            if request.is_extended && manager.options.minimum_release_age_ms.is_none() {
                return Ok(Next::AskForAbbreviated {
                    request: ManifestRequest {
                        is_extended: false,
                        ..*request
                    },
                    cached: loaded_manifest.take(),
                    answered,
                });
            }
        }

        let log_mark = manager.log_mut().msgs.len();
        let mut failure = ManifestFailure::default();
        let mut links_workspace = false;
        let turn = manager.turn();
        match response.metadata.as_ref().filter(|_| !failed) {
            None => {
                add_error_or_warning_pretty!(
                    manager.log_mut(),
                    is_required,
                    "{} downloading package manifest <b>{}<r>",
                    DownloadFailure(manifest_error(response).name(), response),
                    bstr::BStr::new(name),
                );
                failure.is_unanswered = true;
            }
            Some(metadata) => {
                if metadata.status_code() == 404 {
                    failure.missing_until = Some(npm::Registry::manifest_expiry(metadata));
                    let name_hash = bun_semver::string::Builder::string_hash(name);
                    links_workspace = enqueue::has_linkable_workspace(manager, name_hash);
                }
                // The backfill that would report it has returned with an error.
                if links_workspace
                    && reader != Reader::Rows
                    && !matches!(self.caller, Caller::ManifestCache)
                {
                    manager.manifest_requests.unreported_404(answered, turn);
                    return Ok(Next::Free);
                }
                log_error_status(manager, is_required, metadata);
                failure.is_unanswered = retry;
            }
        }

        let is_unanswered = is_required && failure.is_unanswered;
        self.on_manifest_failure(answered, log_mark, failure)?;
        if reader != Reader::Rows {
            fail_update_requests(self.manager, &[], name, None, is_unanswered);
        } else if links_workspace {
            self.manager.manifest_requests.missed(request.id, turn);
        }
        Ok(Next::Free)
    }

    fn on_manifest(
        &mut self,
        id: Task::ManifestId,
        manifest: npm::PackageManifest,
        origin: Origin,
    ) -> crate::Result<()> {
        let manager = &mut *self.manager;
        manager.manifests.insert(manifest.pkg.name.hash, manifest);
        let answered = manager.manifest_requests.finish(id);
        let (follow, rows) = manager.manifest_requests.arrived(answered, origin);
        manager.look_ahead.arrived.extend(follow);
        self.resolve_rows(rows)
    }

    /// What was logged since `log_mark` says why. A backfill's caller finds it in the log.
    fn on_manifest_failure(
        &mut self,
        answered: Answered,
        log_mark: usize,
        mut failure: ManifestFailure,
    ) -> crate::Result<()> {
        let manager = &mut *self.manager;
        match answered.reader() {
            Reader::Rows => failure.msgs = manager.take_log_since(log_mark),
            Reader::OptionalBackfill | Reader::RequiredBackfill => {
                failure = ManifestFailure::already_reported();
            }
        }
        let rows = manager.manifest_requests.failed(answered, failure);
        self.resolve_rows(rows)
    }

    fn on_tarball_response(
        &mut self,
        extract: &ExtractTarball,
        response: &http::HTTPClientResult<'static>,
        url: &[u8],
        attempt: Attempt,
    ) -> Next {
        let Outcome { failed, retry } = attempt.outcome;
        if retry && attempt.retried < self.manager.options.max_retry_count {
            return Next::Retry;
        }

        let name = extract.name.slice();
        let metadata = response.metadata.as_ref().filter(|_| !failed);
        let err = match metadata.map(|metadata| metadata.status_code()) {
            None => tarball_error(response),
            Some(400) => crate::Error::TarballHTTP400,
            Some(401) => crate::Error::TarballHTTP401,
            Some(402) => crate::Error::TarballHTTP402,
            Some(403) => crate::Error::TarballHTTP403,
            Some(404) => crate::Error::TarballHTTP404,
            Some(405..=499) => crate::Error::TarballHTTP4xx,
            Some(500..) => crate::Error::TarballHTTP5xx,
            Some(..400) => {
                if self.log_level.is_verbose() {
                    print_elapsed(attempt.elapsed);
                    bun_core::pretty_error!(
                        "<d> Downloaded <r><green>{}<r> tarball\n",
                        bun_core::fmt::for_terminal(bstr::BStr::new(name)),
                    );
                    Output::flush();
                }
                self.name_progress(name, EXTRACT);
                return Next::Extract(*extract);
            }
        };

        let Some(Unreported { is_required, rows }) = self.fail_tarball(extract, err, url) else {
            return Next::Free;
        };
        let manager = &mut *self.manager;
        match metadata {
            Some(metadata) => log_error_status(manager, is_required, metadata),
            None => add_error_or_warning_pretty!(
                manager.log_mut(),
                is_required,
                "{} downloading tarball <b>{}@{}<r>",
                DownloadFailure(err.name(), response),
                bun_core::fmt::for_terminal(bstr::BStr::new(name)),
                bun_core::fmt::for_terminal(
                    extract
                        .resolution
                        .fmt(&manager.lockfile.buffers.string_bytes, PathSep::Auto),
                ),
            ),
        }
        // The manifest just listed this version, so an error status counts as no response.
        let dependency_id = Some(extract.dependency_id);
        fail_update_requests(manager, &rows, name, dependency_id, is_required);
        Next::Free
    }

    fn fail_tarball(
        &mut self,
        tarball: &ExtractTarball,
        err: crate::Error,
        url: &[u8],
    ) -> Option<Unreported> {
        let manager = &mut *self.manager;
        let ended = manager.fetches.finish(tarball.started);
        let mut is_required = ended.is_required();
        let is_locked_file =
            tarball.resolution.tag == ResolutionTag::LocalTarball && !ended.has_rows();
        let rows = if is_locked_file {
            // The same path names another file in another workspace.
            ended.release()
        } else {
            manager.fail_fetch(ended)
        };
        if self.caller.is_linker() {
            // A linker queues a tarball once, for the first dependency that reaches it.
            let dependency_id = tarball.dependency_id;
            let package_id = manager.lockfile.buffers.resolutions[dependency_id as usize];
            is_required = manager.is_package_required(dependency_id, package_id);
        }
        let (id, name, res) = (
            tarball.started.id().into(),
            tarball.name.slice(),
            &tarball.resolution,
        );
        let is_reported = (self.caller).report_failed_fetch(id, is_required, name, res, err, url);
        (!is_reported).then_some(Unreported { is_required, rows })
    }

    fn on_resolve_task(&mut self, task: &mut Task::Task) -> crate::Result<()> {
        // An error in a manifest is reported by the dependency that needs it, if there is one.
        let holds_log = matches!(
            task.job,
            Task::Job::PackageManifest {
                manifest: Err(_),
                ..
            }
        );
        if !task.log.msgs.is_empty() && !holds_log {
            task.log.print(Output::error_writer())?;
            if task.log.errors > 0 {
                self.manager.any_failed_to_install = true;
            }
            task.log.reset();
        }

        match &mut task.job {
            Task::Job::PackageManifest {
                request, manifest, ..
            } => match take_result(manifest) {
                Ok(manifest) => {
                    self.on_manifest(request.id, manifest, Origin::Registry)?;
                    if !matches!(self.caller, Caller::ManifestCache) {
                        self.name_progress(request.name.slice(), DOWNLOAD);
                    }
                }
                Err(err) => {
                    let log = self.manager.log_mut();
                    let log_mark = log.msgs.len();
                    task.log.append_to(log);
                    bun_ast::add_error_pretty!(
                        log,
                        None,
                        bun_ast::Loc::EMPTY,
                        "{} parsing package manifest for <b>{}<r>",
                        err.name(),
                        bstr::BStr::new(request.name.slice()),
                    );
                    let failure = ManifestFailure {
                        spares_optional: false,
                        ..Default::default()
                    };
                    let answered = self.manager.manifest_requests.finish(request.id);
                    self.on_manifest_failure(answered, log_mark, failure)?;
                }
            },
            Task::Job::Extract {
                tarball,
                source,
                data,
            } => match take_result(data) {
                Ok(data) => {
                    let started = tarball.started.of_package();
                    self.on_cached(started, tarball.dependency_id, &tarball.resolution, data)?;
                    self.name_progress(tarball.name.slice(), EXTRACT);
                }
                Err(err) => {
                    let url: &[u8] = match source {
                        Task::TarballSource::Network(network) => &network.url_buf,
                        Task::TarballSource::Local { .. } => tarball.url.slice(),
                    };
                    if let Some(failure) = self.fail_tarball(tarball, err, url) {
                        let alias = tarball.name.slice();
                        add_error_or_warning_pretty!(
                            self.manager.log_mut(),
                            failure.is_required,
                            "{} extracting tarball from <b>{}<r>",
                            err.name(),
                            bun_core::fmt::for_terminal(bstr::BStr::new(alias)),
                        );
                        let dependency_id = Some(tarball.dependency_id);
                        let rows = &failure.rows;
                        fail_update_requests(self.manager, rows, alias, dependency_id, false);
                    }
                }
            },
            Task::Job::GitClone { request, repo } => match *repo {
                Ok(repo) => {
                    self.on_cloned(request.started, repo)?;
                    self.name_progress(request.name.slice(), DOWNLOAD);
                }
                Err(err) => self.on_clone_failure(request, err),
            },
            Task::Job::GitCommit { request, sha } => {
                // Pending while it ran, but not one of the N downloads the summary prints.
                self.manager.total_tasks.update(|total| total - 1);
                let ended = self.manager.fetches.finish_commit(request.started);
                match sha.take() {
                    Some(sha) => {
                        let rows = self.manager.fetches.found(ended, sha);
                        self.resolve_rows(rows)?;
                    }
                    None => self.on_no_such_commit(ended, request),
                }
            }
            Task::Job::GitCheckout { request, data } => match take_result(data) {
                Ok(data) => {
                    let started = request.started.of_package();
                    self.on_cached(started, request.dependency_id, &request.resolution, data)?;
                    self.name_progress(request.name.slice(), DOWNLOAD);
                }
                Err(err) => self.on_checkout_failure(request, err),
            },
        }
        Ok(())
    }

    /// A tarball is extracted, or a commit is checked out.
    fn on_cached(
        &mut self,
        started: Started<Task::PackageFetchId>,
        dependency_id: DependencyID,
        resolution: &Resolution,
        data: ExtractData,
    ) -> crate::Result<()> {
        let manager = &mut *self.manager;
        manager.extracted_count += 1;
        bun_core::analytics::Features::extracted_packages_inc();

        let mut package_id = manager.lockfile.buffers.resolutions[dependency_id as usize];
        let (id, fetch) = (started.id(), manager.fetches.finish(started));
        let is_local = matches!(
            resolution.tag,
            ResolutionTag::LocalTarball | ResolutionTag::Git
        );
        let mut end_for_linker = |fetch: Ended<_>| match is_local {
            // A file is read again, and a commit is checked out again.
            true => drop(fetch.release()),
            false => manager.fetches.done(fetch),
        };
        match &mut self.caller {
            Caller::HoistedLinker(installer) => {
                end_for_linker(fetch);
                installer.fix_cached_lockfile_package_slices();
                installer.install_enqueued_packages_after_extraction(
                    id,
                    dependency_id,
                    &data,
                    self.log_level,
                );
            }
            Caller::IsolatedLinker(installer) => {
                end_for_linker(fetch);
                installer.on_package_extracted(id, &data);
            }
            Caller::Resolver | Caller::BlockedImport | Caller::ManifestCache => {
                if manager.defers_remote_package(&fetch, resolution) {
                    manager.keep_arrived_package(fetch, resolution, data);
                    return Ok(());
                }
                if let Some(pkg) = manager.process_extracted_tarball_package(
                    &mut package_id,
                    resolution,
                    &data,
                    self.log_level,
                ) {
                    resolve_waiters_of_appended_package(manager, fetch, &pkg, self.install_peer)?;
                } else {
                    manager.fetches.done(fetch);
                    // A peer that found no manifest of this name may take the package.
                    let name = manager.lockfile.packages.items_name()[package_id as usize];
                    let manifest_id = Task::ManifestId::new(manager.lockfile.str(&name));
                    let rows = manager.manifest_requests.take_rows(manifest_id);
                    self.resolve_rows(rows)?;
                }
            }
        }

        if resolution.tag != ResolutionTag::Git {
            (self.manager).set_preinstall_state(package_id, crate::PreinstallState::Done);
        }
        Ok(())
    }

    fn on_cloned(
        &mut self,
        started: Started<Task::CloneId>,
        repo: bun_sys::Fd,
    ) -> crate::Result<()> {
        let manager = &mut *self.manager;
        let (ended, checkouts) = manager.fetches.finish_clone(started);
        let rows = manager.fetches.cloned(ended, repo);
        if checkouts.is_empty() {
            return self.resolve_rows(rows);
        }
        // `bun pm fetch` does not go on with a row that has joined one of its clones.
        for checkout in checkouts {
            enqueue::check_out_locked_package(manager, repo, checkout, None);
        }
        Ok(())
    }

    fn on_clone_failure(&mut self, clone: &Task::GitCloneRequest, err: crate::Error) {
        let manager = &mut *self.manager;
        let name = clone.name.slice();
        let (ended, checkouts) = manager.fetches.finish_clone(clone.started);
        let is_required = ended.is_required();
        fail_update_requests(manager, &ended.release(), name, None, false);

        let is_reported = match &mut self.caller {
            Caller::IsolatedLinker(installer) => {
                for checkout in checkouts {
                    let id = checkout.claim.id().into();
                    manager.fetches.park(checkout.claim);
                    let res =
                        manager.lockfile.packages.items_resolution()[checkout.package_id as usize];
                    let url = clone.url.slice();
                    installer.on_package_download_error(id, is_required, name, &res, err, url);
                }
                is_required
            }
            Caller::HoistedLinker(_)
            | Caller::Resolver
            | Caller::BlockedImport
            | Caller::ManifestCache => {
                for checkout in checkouts {
                    manager.fetches.strand(checkout.claim);
                }
                false
            }
        };

        // If the dependency that requires it joined later, git's own output was only a warning.
        if !is_reported {
            add_error_or_warning_pretty!(
                manager.log_mut(),
                is_required,
                "{} cloning repository for <b>{}<r>",
                err.name(),
                bun_core::fmt::for_terminal(bstr::BStr::new(name)),
            );
        }
    }

    /// The repository (with `--offline`, its cached clone) has no such commit.
    fn on_no_such_commit(&mut self, ended: Ended<Task::CommitId>, commit: &Task::GitCommitRequest) {
        let manager = &mut *self.manager;
        let name = commit.name.slice();
        let (is_required, rows) = (ended.is_required(), ended.release());
        fail_update_requests(manager, &rows, name, None, false);
        for row in rows {
            manager.lockfile.unbind_refreshing(row.id);
        }
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

    /// An error, whoever asked for the checkout.
    fn on_checkout_failure(&mut self, checkout: &Task::GitCheckoutRequest, err: crate::Error) {
        let manager = &mut *self.manager;
        let rows = manager.fetches.finish(checkout.started).release();
        let (id, name, url) = (
            checkout.started.id().into(),
            checkout.name.slice(),
            checkout.url.slice(),
        );
        if (self.caller).report_failed_fetch(id, true, name, &checkout.resolution, err, url) {
            return;
        }
        bun_ast::add_error_pretty!(
            manager.log_mut(),
            None,
            bun_ast::Loc::EMPTY,
            "{} checking out repository for <b>{}<r>",
            err.name(),
            bun_core::fmt::for_terminal(bstr::BStr::new(name)),
        );
        fail_update_requests(manager, &rows, name, None, false);
    }
}

fn take_result<T>(result: &mut crate::Result<T>) -> crate::Result<T> {
    core::mem::replace(result, Err(crate::Error::Failed))
}

fn manifest_error(response: &http::HTTPClientResult<'static>) -> crate::Error {
    (response.fail).map_or(crate::Error::HTTPError, Into::into)
}

fn tarball_error(response: &http::HTTPClientResult<'static>) -> crate::Error {
    (response.fail).map_or(crate::Error::TarballFailedToDownload, Into::into)
}

#[cold]
fn log_retry(manager: &PackageManager, task: &NetworkTask, wait: core::time::Duration) {
    match &task.callback {
        NetworkTaskCallback::Extract(extract) => bun_ast::add_warning_pretty!(
            manager.log_mut(),
            None,
            bun_ast::Loc::EMPTY,
            "{} downloading tarball <b>{}@{}<r>. Retrying {}/{} in {}ms...",
            tarball_error(&task.response).name(),
            bun_core::fmt::for_terminal(bstr::BStr::new(extract.name.slice())),
            bun_core::fmt::for_terminal(
                extract
                    .resolution
                    .fmt(&manager.lockfile.buffers.string_bytes, PathSep::Auto),
            ),
            task.retried,
            manager.options.max_retry_count,
            wait.as_millis(),
        ),
        NetworkTaskCallback::PackageManifest { request, .. } => bun_ast::add_warning_pretty!(
            manager.log_mut(),
            None,
            bun_ast::Loc::EMPTY,
            "{} downloading package manifest <b>{}<r>. Retry {}/{} in {}ms...",
            manifest_error(&task.response).name(),
            bun_core::fmt::escape_control_chars(request.name.slice()),
            task.retried,
            manager.options.max_retry_count,
            wait.as_millis(),
        ),
    }
}

fn print_elapsed(elapsed: u64) {
    bun_core::pretty_error!("    ");
    Output::print_elapsed(elapsed as f64 / bun_core::time::NS_PER_MS as f64);
}

fn log_error_status(
    manager: &PackageManager,
    is_required: bool,
    metadata: &http::HTTPResponseMetadata,
) {
    let url = bun_core::fmt::EscapeControlChars(bun_core::fmt::redacted_npm_url(metadata.url()));
    let status = metadata.status_code();
    if is_required {
        bun_ast::add_error_pretty!(
            manager.log_mut(),
            None,
            bun_ast::Loc::EMPTY,
            "<r><red><b>GET<r><red> {}<d> - {}<r>",
            url,
            status,
        );
    } else {
        bun_ast::add_warning_pretty!(
            manager.log_mut(),
            None,
            bun_ast::Loc::EMPTY,
            "<r><yellow><b>GET<r><yellow> {}<d> - {}<r>",
            url,
            status,
        );
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Outcome {
    /// The connection died before a response, or during a 2xx or 3xx response.
    failed: bool,
    pub(crate) retry: bool,
}

#[derive(Clone, Copy)]
struct Attempt {
    outcome: Outcome,
    retried: u16,
    elapsed: u64,
}

/// `blocking`: the caller blocks on this request, so a timeout or a 501 is not retried.
pub(crate) fn download_outcome(
    response: &http::HTTPClientResult<'static>,
    blocking: bool,
) -> Outcome {
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
    Outcome { failed, retry }
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

impl PackageManager {
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

pub(crate) fn flush_network_queue(this: &mut PackageManager) {
    while let Some(network_task) = this
        .network_task_fifo
        .read_item()
        .or_else(|| this.retry_queue.pop_due())
    {
        // SAFETY: both queues store live `*mut NetworkTask` pushed by
        // `enqueue_network_task` / `retry_timer::retry`; exclusive ownership transferred here.
        let nt = unsafe { &mut *network_task };
        let batch = if matches!(nt.callback, NetworkTaskCallback::Extract(_)) {
            &mut this.network_tarball_batch
        } else {
            &mut this.network_resolve_batch
        };
        batch.push(nt.take_request());
    }
}

fn flush_dependency_queue(this: &mut PackageManager) {
    let mut last_count = this.total_tasks.get();
    loop {
        flush_network_queue(this);
        enqueue::advance(this);
        flush_network_queue(this);
        this.task_batch.push(core::mem::take(&mut this.patch_batch));

        if this.total_tasks.get() == last_count {
            break;
        }
        last_count = this.total_tasks.get();
    }
}

pub(crate) fn schedule_tasks(manager: &mut PackageManager) -> usize {
    let count = manager.task_batch.len
        + manager.network_resolve_batch.len()
        + manager.network_tarball_batch.len();

    manager.increment_pending_tasks(u32::try_from(count).expect("int cast"));
    THREAD_POOL.schedule(core::mem::take(&mut manager.task_batch));
    let manifests = manager.network_resolve_batch.drain(..);
    http::HTTPThread::schedule(manifests.chain(manager.network_tarball_batch.drain(..)));
    // Git tasks were counted as pending when they were queued.
    manager.start_git_tasks();
    count
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

/// How often a failed manifest request is retried. When `bunx` already has a copy of the tool, it
/// only asks once whether that copy is the latest, and runs the copy if it gets no answer.
fn manifest_retry_count(
    manager: &PackageManager,
    is_required: bool,
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
    ) && !is_required
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
    this: &mut PackageManager,
    rows: &[WaitingRow],
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
    // An npm tarball task has no rows: the dependencies it was for already resolved to its package.
    // A dependency that is refreshed still has the package of bun.lock, which the task was not for.
    let package_id = tarball_dependency_id
        .filter(|&id| !lockfile.is_refreshing(id))
        .and_then(|id| resolutions.get(id as usize).copied())
        .filter(|&package_id| package_id != INVALID_PACKAGE_ID);
    let was_for = |id: DependencyID| {
        package_id.is_some_and(|package_id| resolutions.get(id as usize) == Some(&package_id))
            || rows.iter().any(|row| row.id == id)
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

/// For a package that was just resolved. Returns `None` if another task has it, or has had it.
pub(crate) fn prefetch_npm_tarball(
    this: &mut PackageManager,
    behavior: crate::dependency::Behavior,
    dependency_id: DependencyID,
    package: &Package,
) -> Result<Option<*mut NetworkTask>, ForTarballError> {
    let name = this.lockfile.str(&package.name);
    let id = Task::TarballId::for_npm_package(name, package.resolution.npm().version);
    let need = match behavior.is_required() {
        true => Need::Required,
        false => Need::Optional,
    };
    (this.fetches.ask(id, None, need))
        .map(|claim| {
            generate_network_task_for_tarball(this, claim, None, dependency_id, package)
                .map(core::ptr::from_mut)
        })
        .transpose()
}

/// The caller sends the request.
pub(crate) fn generate_network_task_for_tarball<'a>(
    this: &'a mut PackageManager,
    claim: Claim<Task::TarballId>,
    github_url: Option<&[u8]>,
    dependency_id: DependencyID,
    package: &Package,
) -> Result<&'a mut NetworkTask, ForTarballError> {
    // Only reached when the tarball is not already extracted in the cache.
    if this.options.offline == Options::OfflineMode::Offline {
        let (id, is_required) = (claim.id(), claim.is_required());
        this.fetches.park(claim);
        enqueue::offline_miss(this, id, package.name, is_required);
        return Err(ForTarballError::Offline);
    }
    let started = this.fetches.start(claim);

    let temp_dir = match directories::try_get_temporary_directory(this) {
        Ok(temp_dir) => temp_dir,
        Err(why) => {
            this.exit_or_log(&why);
            let ended = this.fetches.finish(started);
            drop(this.fail_fetch(ended));
            return Err(ForTarballError::AlreadyFailed);
        }
    };

    let pkg_name = this.lockfile.str(&package.name);
    let url = match (github_url, package.resolution.tag) {
        (Some(url), _) => url,
        (None, bun_install::ResolutionTag::Npm) => this.lockfile.str(&package.resolution.npm().url),
        (None, _) => this.lockfile.str(package.resolution.remote_tarball()),
    };
    let (scope, authorization) = match package.resolution.tag {
        bun_install::ResolutionTag::Npm => (
            this.scope_for_package_name(pkg_name),
            Authorization::AllowAuthorization,
        ),
        // One download serves every name that the URL is listed under, so the name picks no scope.
        bun_install::ResolutionTag::RemoteTarball
            if this.lockfile.is_tarball_url_of_project(url) =>
        {
            (&this.options.scope, Authorization::AllowAuthorization)
        }
        _ => (
            this.scope_for_package_name(pkg_name),
            Authorization::NoAuthorization,
        ),
    };

    let extract_tarball = ExtractTarball {
        started,
        registry: directories::folder_cache_key(this, scope),
        name: stored_string(pkg_name),
        resolution: package.resolution,
        temp_dir,
        dependency_id,
        skip_verify: false,
        in_trusted_dependencies: this.lockfile.in_trusted_dependencies(pkg_name),
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

    let callback = NetworkTaskCallback::Extract(extract_tarball);
    let net_ptr = match NetworkTask::create(this, callback, |task| {
        task.for_tarball(&extract_tarball, scope, authorization)
    }) {
        Ok(net_ptr) => net_ptr,
        Err(err) => {
            let ended = this.fetches.finish(started);
            drop(this.fail_fetch(ended));
            return Err(err);
        }
    };

    if extract_tarball::uses_streaming_extraction() {
        // Pre-create the extract Task and streaming state here on the
        // main thread: `preallocated_resolve_tasks` is not thread-safe,
        // and the streaming extractor needs a stable `Task` pointer so
        // it can push the result onto `resolve_tasks` when it finishes.
        let extract_task =
            enqueue::create_extract_task_for_streaming(this, &extract_tarball, net_ptr);
        // SAFETY: the extract task does not run before the request is sent.
        unsafe {
            (*net_ptr).streaming_extract_task = extract_task;
            (*net_ptr).tarball_stream = Some(TarballStream::init(extract_task, net_ptr));
        }
    }

    // SAFETY: final reborrow of the pool slot for the caller; `net_ptr` is the
    // sole live handle (see above) and outlives nothing past this return.
    Ok(unsafe { &mut *net_ptr })
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
            // A row only waits for a manifest that is `InFlight`, which counts as pending.
            if Environment::CI_ASSERT {
                unreachable!("a queued dependency waits for a task that is not pending");
            }
            queue.finish_rows_before(head, head.rows.off + 1);
            queue.waits_for = None;
        }
    }

    pub(crate) fn turn(&self) -> Turn {
        Turn(self.event_loop.iteration_number())
    }

    fn fail_fetch(&mut self, ended: Ended<Task::TarballId>) -> Vec<WaitingRow> {
        let turn = self.turn();
        self.fetches.fail(ended, turn)
    }

    pub(crate) fn alloc_github_url(&self, repository: &Repository) -> Vec<u8> {
        let committish = self.lockfile.str(&repository.committish);
        alloc_github_url_for_ref(self, repository, committish)
    }
}
