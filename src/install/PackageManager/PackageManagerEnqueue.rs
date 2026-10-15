use crate::lockfile::package::PackageColumns as _;
use bun_ptr::detach_lifetime;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use crate::bun_fs::FileSystem;
use bun_core::{Output, UnwrapOrOom, fmt as bun_fmt};
use bun_core::{StringOrTinyString, strings};
use bun_paths as Path;
use bun_semver::{self as Semver, String as SemverString};
use bun_sys::Fd;
use bun_threading::thread_pool as ThreadPool;

use crate::_folder_resolver::{
    self as FolderResolution, FolderResolution as FolderResolutionValue, GlobalOrRelative,
    PackageWorkspaceSearchPathFormatter,
};
use crate::dependency;
use crate::dependency::{DependencyExt as _, TagExt as _, VersionExt as _};
use crate::lockfile::package::Package;
use crate::lockfile::reachable;
use crate::lockfile_real as Lockfile;
use crate::network_task::{Authorization, ForTarballError, add_error_or_warning, stored_string};
use crate::package_manager_real::options::{Do, OfflineMode};
use crate::package_manager_real::{
    self, PackageManager, SuccessFn, TaskCallbackList, get_cache_directory,
    get_temporary_directory, run_tasks,
};
use crate::package_manager_task as Task;
use crate::patch_install::EnqueueAfterState;
use crate::resolution::{
    NpmVersionInfo as ResolutionNpmValue, Tag as ResolutionTag, TaggedValue as ResolutionTagged,
};
use bun_install::NetworkTask;
use bun_install::{
    self as install, Behavior, Dependency, DependencyID, ExtractTarball, Features, Integrity, Npm,
    PackageID, PackageNameHash, PatchTask, Repository, Resolution, TaskCallbackContext,
    invalid_package_id,
};

#[inline]
fn verbose_install() -> bool {
    PackageManager::verbose_install()
}

const MS_PER_S: f64 = bun_core::time::MS_PER_S as f64;

fn bind_existing(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    package_id: PackageID,
    success_fn: SuccessFn,
) -> crate::Result<Option<ResolvedPackageResult>> {
    success_fn(this, dependency_id, package_id);
    Ok(Some(ResolvedPackageResult {
        // read after `success_fn`, which can change the packages array
        package: *this.lockfile.packages.get(package_id as usize),
        is_first_time: false,
        task: None,
    }))
}

fn task_callback_list(this: &mut PackageManager, task_id: Task::Id) -> &mut TaskCallbackList {
    this.task_queue
        .get_or_put(task_id)
        .expect("unreachable")
        .value_ptr
}

/// False when `task_id` already had a list: the task was started before.
fn push_task_callback(
    this: &mut PackageManager,
    task_id: Task::Id,
    callback: TaskCallbackContext,
) -> bool {
    let entry = this.task_queue.get_or_put(task_id).expect("unreachable");
    entry.value_ptr.push(callback);
    !entry.found_existing
}

pub fn enqueue_dependency_with_main(
    this: &mut PackageManager,
    id: DependencyID,
    // This must be a *const to prevent UB
    dependency: &Dependency,
    resolution: PackageID,
    install_peer: bool,
) -> crate::Result<()> {
    enqueue_dependency_with_main_and_success_fn(
        this,
        id,
        dependency,
        resolution,
        install_peer,
        PackageManager::assign_resolution,
        false,
    )
}

pub fn enqueue_dependency_list(
    this: &mut PackageManager,
    dependencies_list: Lockfile::DependencySlice,
) {
    this.task_queue
        .ensure_unused_capacity(dependencies_list.len as usize)
        .expect("unreachable");

    // Step 1. Go through main dependencies
    let end = dependencies_list.off.saturating_add(dependencies_list.len);
    let mut i = dependencies_list.off;

    // we have to be very careful with pointers here
    while i < end {
        let dependency = this.lockfile.buffers.dependencies[i as usize].clone();
        let resolution = this.lockfile.buffers.resolutions[i as usize];
        if let Err(err) = enqueue_dependency_with_main(this, i, &dependency, resolution, false) {
            add_dependency_error(this, &dependency, err);
        }
        i += 1;
    }

    this.drain_dependency_list();
}

/// Logged to `this.log`; the install fails later when `has_errors()` is checked.
#[cold]
#[inline(never)]
pub(crate) fn add_dependency_error(
    this: &mut PackageManager,
    dependency: &Dependency,
    err: crate::Error,
) {
    let path_sep = match dependency.version.tag {
        dependency::version::Tag::Folder => bun_fmt::PathSep::Auto,
        _ => bun_fmt::PathSep::Any,
    };
    let realname = dependency.realname();
    let path_fmt = bun_fmt::EscapeControlChars(bun_fmt::fmt_path_u8(
        this.lockfile.str(&realname),
        bun_fmt::PathFormatOptions {
            path_sep,
            escape_backslashes: false,
        },
    ));
    let log = this.log_mut();
    if dependency.behavior.is_optional() || dependency.behavior.is_peer() {
        log.add_warning_with_note(
            None,
            bun_ast::Loc::default(),
            err.name().as_bytes(),
            format_args!("error occurred while resolving {}", path_fmt),
        );
    } else {
        log.add_zig_error_with_note(
            err.name(),
            format_args!("error occurred while resolving {}", path_fmt),
        );
    }
}

pub fn enqueue_tarball_for_download(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    package_id: PackageID,
    url: &[u8],
    task_context: TaskCallbackContext,
) -> Result<(), ForTarballError> {
    let name = this.lockfile.packages.items_name()[package_id as usize];
    let name = this.lockfile.str_detached(&name);
    enqueue_download(
        this,
        Task::Id::for_tarball(url),
        name,
        dependency_id,
        package_id,
        url,
        task_context,
        Authorization::NoAuthorization,
    )
}

pub fn enqueue_package_for_download(
    this: &mut PackageManager,
    name: &[u8],
    dependency_id: DependencyID,
    package_id: PackageID,
    version: Semver::Version,
    url: &[u8],
    task_context: TaskCallbackContext,
) -> Result<(), ForTarballError> {
    enqueue_download(
        this,
        Task::Id::for_npm_package(name, version),
        name,
        dependency_id,
        package_id,
        url,
        task_context,
        Authorization::AllowAuthorization,
    )
}

fn enqueue_download(
    this: &mut PackageManager,
    task_id: Task::Id,
    name: &[u8],
    dependency_id: DependencyID,
    package_id: PackageID,
    url: &[u8],
    task_context: TaskCallbackContext,
    authorization: Authorization,
) -> Result<(), ForTarballError> {
    if this.network_task_has_failed(task_id) {
        if is_asked_by_linker(&task_context) {
            report_failed_download_as_required(this, task_id, dependency_id, package_id);
        }
        return Err(ForTarballError::AlreadyFailed);
    }
    if this.options.offline == OfflineMode::Offline {
        let is_required = !is_asked_by_linker(&task_context)
            && this.is_package_required(dependency_id, package_id);
        offline_miss(this, task_id, "", name, is_required);
        return Err(ForTarballError::Offline);
    }
    if !push_task_callback(this, task_id, task_context) {
        return Ok(());
    }

    let is_required = this.is_package_required(dependency_id, package_id);
    let package = *this.lockfile.packages.get(package_id as usize);
    if let Some(task) = run_tasks::generate_network_task_for_tarball(
        this,
        task_id,
        url,
        is_required,
        dependency_id,
        &package,
        authorization,
    )? {
        // reshaped for borrowck — `task: &mut NetworkTask` borrows
        // `*this` (pool slot); reborrow as raw so `this.network_tarball_batch`
        // is reachable.
        let task: *mut NetworkTask = task;
        // SAFETY: `task` is the unique handle to a freshly-vended pool slot.
        unsafe { (*task).schedule(&mut this.network_tarball_batch) };
        if this.network_tarball_batch.len > 0 {
            let _ = run_tasks::schedule_tasks(this);
        }
    }
    Ok(())
}

pub fn enqueue_tarball_for_reading(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    package_id: PackageID,
    alias: &[u8],
    resolution: &Resolution,
    task_context: TaskCallbackContext,
) {
    // `enqueue_local_tarball` copies `path` into the filename store before `string_bytes` can grow.
    let path = this.lockfile.str_detached(resolution.local_tarball());
    let task_id = Task::Id::for_tarball(path);
    if !push_task_callback(this, task_id, task_context) {
        return;
    }

    let integrity = this.lockfile.packages.items_meta()[package_id as usize].integrity;

    let task = enqueue_local_tarball(
        this,
        task_id,
        dependency_id,
        alias,
        path,
        resolution,
        Some(&integrity),
    );
    this.task_batch.push(ThreadPool::Batch::from(task));
}

/// `Err(Offline)`: not cached, nothing queued; the caller counts the package as failed or skipped.
pub fn enqueue_git_for_checkout(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    package_id: PackageID,
    alias: &[u8],
    task_context: TaskCallbackContext,
    patch_name_and_version_hash: Option<u64>,
) -> Result<(), ForTarballError> {
    let resolution: Resolution = this.lockfile.packages.items_resolution()[package_id as usize];
    let repository: Repository = *resolution.git();
    // The enqueue callees copy these into the filename store before `string_bytes` grows.
    let url = this.lockfile.str_detached(&repository.repo);
    let clone_id = Task::Id::for_git_clone(url);
    let resolved = this.lockfile.str_detached(&repository.resolved);
    let checkout_id = Task::Id::for_git_checkout(url, resolved);
    let repo_fd = this.git_repositories.get(&clone_id).copied();
    let is_required = repo_fd.is_some() || this.is_package_required(dependency_id, package_id);
    // --offline: decide before any queue registration, so an optional miss leaves
    // nothing behind and a later required edge still reaches the report
    if repo_fd.is_none()
        && offline_git_miss(
            this,
            clone_id,
            alias,
            is_required && !is_asked_by_linker(&task_context),
        )
    {
        return Err(ForTarballError::Offline);
    }
    if !push_task_callback(this, checkout_id, task_context) {
        return Ok(());
    }

    if let Some(repo_fd) = repo_fd {
        let task = enqueue_git_checkout(
            this,
            checkout_id,
            repo_fd,
            dependency_id,
            alias,
            &resolution,
            resolved,
            patch_name_and_version_hash.map(|hash| (package_id, hash)),
        );
        this.enqueue_git_task(task);
    } else {
        task_callback_list(this, clone_id).push(TaskCallbackContext::GitCheckout {
            dependency_id,
            package_id,
        });

        if !this.has_created_network_task(clone_id, is_required) {
            let task = enqueue_git_clone(this, clone_id, alias, &repository);
            this.enqueue_git_task(task);
        }
    }
    Ok(())
}

/// A linker is only told of an `--offline` miss: `report_offline_misses` judges them together.
fn is_asked_by_linker(context: &TaskCallbackContext) -> bool {
    matches!(
        context,
        TaskCallbackContext::DependencyInstallContext(_)
            | TaskCallbackContext::IsolatedPackageInstallContext(_)
    )
}

/// It failed as a warning while only optional dependencies asked: a linker that requires it errors.
#[cold]
fn report_failed_download_as_required(
    this: &mut PackageManager,
    task_id: Task::Id,
    dependency_id: DependencyID,
    package_id: PackageID,
) {
    if this.is_network_task_required(task_id)
        || !this.is_package_required(dependency_id, package_id)
    {
        return;
    }
    let _ = this.has_created_network_task(task_id, true);
    if this.options.log_level.is_silent() {
        return;
    }
    let lockfile = &*this.lockfile;
    let package = lockfile.packages.get(package_id as usize);
    Output::err_generic(
        "failed to download <b>{}@{}<r>",
        (
            bun_fmt::for_terminal(bstr::BStr::new(lockfile.str(&package.name))),
            bun_fmt::for_terminal(
                package
                    .resolution
                    .fmt(&lockfile.buffers.string_bytes, bun_fmt::PathSep::Auto),
            ),
        ),
    );
    Output::flush();
}

/// Reported once, if required. No task is registered that nobody completes.
pub(crate) fn offline_miss(
    this: &mut PackageManager,
    task_id: Task::Id,
    what: &str,
    name: &[u8],
    is_required: bool,
) {
    if is_required && !this.network_task_has_failed(task_id) {
        // reserve + mark failed so later dependents take the already-failed path
        let _ = this.has_created_network_task(task_id, true);
        this.mark_network_task_failed(task_id);
        this.log_mut().add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "--offline: {what}\"{}\" is not in the cache",
                bun_fmt::for_terminal(bstr::BStr::new(name))
            ),
        );
    }
}

/// True when the clone must not be enqueued: `--offline`, and it is not in the cache.
fn offline_git_miss(
    this: &mut PackageManager,
    clone_id: Task::Id,
    name: &[u8],
    is_required: bool,
) -> bool {
    if this.options.offline != OfflineMode::Offline {
        return false;
    }
    let folder = bun_core::ZBox::from_bytes(crate::git_runner::bare_repo_folder_name(clone_id));
    if bun_sys::directory_exists_at(get_cache_directory(this), &folder).unwrap_or(false) {
        return false;
    }
    if !is_required {
        // let a later required edge on the same repository report it
        let _ = this.network_dedupe_map.remove(&clone_id);
    }
    offline_miss(this, clone_id, "git repository for ", name, is_required);
    true
}

/// # Safety
/// `network_task` must point to a live, exclusively-owned `NetworkTask` pool
/// slot for the duration of the enqueued resolve task.
pub unsafe fn enqueue_parse_npm_package(
    this: &mut PackageManager,
    task_id: Task::Id,
    name: StringOrTinyString,
    network_task: *mut NetworkTask,
) -> *mut ThreadPool::Task {
    // SAFETY: `this` is a live `&mut PackageManager`; `network_task` is a
    // freshly-vended pool slot whose `'static` reborrow matches the
    // `Task<'static>` slot lifetime.
    let task_value = unsafe {
        Task::Task {
            package_manager: Some(bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<
                PackageManager,
            >(this))),
            log: bun_ast::Log::init(),
            tag: crate::package_manager_task::Tag::PackageManifest,
            request: crate::package_manager_task::Request {
                package_manifest: ManuallyDrop::new(
                    crate::package_manager_task::PackageManifestRequest {
                        network: &mut *network_task,
                        name,
                    },
                ),
            },
            id: task_id,
            ..Task::uninit()
        }
    };
    let task = this.preallocated_resolve_tasks.get_init(task_value);
    // SAFETY: `task` points to a freshly initialized pool slot.
    unsafe { &raw mut (*task.as_ptr()).threadpool_task }
}

pub enum DependencyToEnqueue {
    Resolution {
        package_id: PackageID,
        resolution: Resolution,
    },
    NotFound,
    Failure(crate::Error),
}

pub fn enqueue_dependency_to_root(
    this: &mut PackageManager,
    name: &[u8],
    version: &dependency::Version,
    version_buf: &[u8],
    behavior: Behavior,
) -> DependencyToEnqueue {
    let dep_id = 'brk: {
        let str_buf = this.lockfile.buffers.string_bytes.as_slice();
        for (id, dep) in this.lockfile.buffers.dependencies.iter().enumerate() {
            if !strings::eql_long(dep.name.slice(str_buf), name, true) {
                continue;
            }
            if !dep.version.eql(version, str_buf, version_buf) {
                continue;
            }
            break 'brk id;
        }

        // `clone_with_different_buffers` only needs the npm-alias registry,
        // so split-borrow `this.known_npm_aliases` alongside the lockfile
        // string builder + the `dependencies`/`resolutions` columns.
        let known_npm_aliases = &mut this.known_npm_aliases;
        let (mut builder, lf) = this.lockfile.string_builder_split();
        let dummy = Dependency {
            name: SemverString::init(name, name),
            name_hash: Semver::string::Builder::string_hash(name),
            version: version.clone(),
            behavior,
        };
        dummy.count_with_different_buffers(name, version_buf, &mut builder);

        if let Err(err) = builder.allocate() {
            return DependencyToEnqueue::Failure(err.into());
        }

        let dep = dummy
            .clone_with_different_buffers(known_npm_aliases, name, version_buf, &mut builder)
            .expect("unreachable");
        builder.clamp();
        let index = lf.dependencies.len();
        lf.dependencies.push(dep);
        lf.resolutions.push(invalid_package_id);
        debug_assert!(lf.dependencies.len() == lf.resolutions.len());
        break 'brk index;
    } as DependencyID;

    // A failed lookup stands until the event loop has gone around; a 404 as long as a manifest.
    let turn = this.event_loop.iteration_number();
    let manifest_task_id = {
        let real_name = this.lockfile.buffers.dependencies[dep_id as usize].realname();
        Task::Id::for_manifest(this.lockfile.str(&real_name))
    };

    if this.lockfile.buffers.resolutions[dep_id as usize] == invalid_package_id {
        if (this.network_dedupe_map.get(&manifest_task_id)).is_some_and(|entry| {
            entry.missed_in.is_some_and(|missed_in| missed_in != turn)
                && i64::from(entry.missing_until) <= bun_core::time::timestamp()
        }) {
            let _ = this.network_dedupe_map.remove(&manifest_task_id);
        }

        // Copy to the stack: `enqueueDependencyWithMainAndSuccessFn` can call
        // `Lockfile.Package.fromNPM`, which grows `buffers.dependencies` and
        // would invalidate a pointer taken directly into it.
        let dependency = this.lockfile.buffers.dependencies[dep_id as usize].clone();
        if let Err(err) = enqueue_dependency_with_main_and_success_fn(
            this,
            dep_id,
            &dependency,
            invalid_package_id,
            false,
            PackageManager::assign_root_resolution,
            true,
        ) {
            return DependencyToEnqueue::Failure(err);
        }
    }

    // A manifest from the disk cache resolves the row at once and only queues the tarball.
    this.drain_dependency_list();

    let resolution_id = match this.lockfile.buffers.resolutions[dep_id as usize] {
        id if id == invalid_package_id || this.pending_task_count() > 0 => 'brk: {
            if this.options.log_level.show_progress() {
                this.start_progress_bar_if_none();
            }
            Output::flush();

            let parked = crate::auto_installer::Parked::new();
            let result = loop {
                let wakes = parked.wakes();
                if this.pending_task_count() > 0 {
                    let log_level = this.options.log_level;
                    if let Err(err) = run_tasks::run_tasks::<VoidRunTasksCallbacks>(
                        this,
                        &mut (),
                        false,
                        log_level,
                    ) {
                        break Err(err);
                    }

                    if verbose_install() && this.pending_task_count() > 0 {
                        if PackageManager::has_enough_time_passed_between_waiting_messages() {
                            bun_core::pretty_errorln!(
                                "<d>[PackageManager]<r> waiting for {} tasks\n",
                                this.pending_task_count()
                            );
                        }
                    }
                }

                if this.pending_task_count() == 0 {
                    break Ok(());
                }
                parked.wait(wakes);
            };
            drop(parked);

            if this.options.log_level.show_progress() {
                this.end_progress_bar();
                Output::flush();
            }

            if let Err(err) = result {
                return DependencyToEnqueue::Failure(err);
            }

            break 'brk this.lockfile.buffers.resolutions[dep_id as usize];
        }
        // we managed to synchronously resolve the dependency
        pkg_id => pkg_id,
    };

    if resolution_id == invalid_package_id {
        if let Some(entry) = this.network_dedupe_map.get_mut(&manifest_task_id) {
            entry.missed_in = Some(turn);
        }
        let _ = this.task_queue.remove(&manifest_task_id);
        return DependencyToEnqueue::NotFound;
    }

    DependencyToEnqueue::Resolution {
        resolution: this.lockfile.packages.items_resolution()[resolution_id as usize],
        package_id: resolution_id,
    }
}

/// `Ctx = ()`, no callbacks.
struct VoidRunTasksCallbacks;
impl run_tasks::RunTasksCallbacks for VoidRunTasksCallbacks {
    type Ctx = ();
}

pub fn enqueue_network_task(this: &mut PackageManager, task: *mut NetworkTask) {
    if this.network_task_fifo.writable_length() == 0 {
        run_tasks::flush_network_queue(this);
    }

    this.network_task_fifo.write_item_assume_capacity(task);
}

/// Hands the task to the patch-task fifo as a raw pointer; it is reclaimed once
/// in `run_tasks` after the thread pool pushes it onto `patch_task_queue`.
pub fn enqueue_patch_task(this: &mut PackageManager, task: Box<PatchTask>) {
    if this.patch_task_fifo.writable_length() == 0 {
        run_tasks::flush_patch_task_queue(this);
    }

    this.patch_task_fifo
        .write_item_assume_capacity(bun_core::heap::into_raw(task));
}

/// We need to calculate all the patchfile hashes at the beginning so we don't run into problems with stale hashes
pub fn enqueue_patch_task_pre(this: &mut PackageManager, mut task: Box<PatchTask>) {
    task.pre = true;
    enqueue_patch_task(this, task);
    let _ = this.pending_pre_calc_hashes.fetch_add(1, Ordering::Relaxed);
}

/// A resolve task's callback queue is drained exactly once. If `task_id`
/// already completed and appended a package, resolve `id` against it directly:
/// a context queued now would never be processed.
fn resolve_from_appended_task(
    this: &mut PackageManager,
    task_id: Task::Id,
    id: DependencyID,
) -> Option<PackageID> {
    let &pkg_id = this.appended_task_packages.get(&task_id)?;
    let pkg_name = this.lockfile.packages.items_name()[pkg_id as usize];
    let pkg_res = this.lockfile.packages.items_resolution()[pkg_id as usize];
    let version = &mut this.lockfile.buffers.dependencies[id as usize].version;
    name_resolved_row(version, pkg_name, &pkg_res);
    Some(pkg_id)
}

/// A git / tarball row learns its name at extraction. Under `overrides` its tag is not its task's.
pub(crate) fn name_resolved_row(
    v: &mut dependency::Version,
    pkg_name: SemverString,
    pkg_res: &Resolution,
) {
    match v.tag {
        dependency::version::Tag::Git => {
            let repo = v.git_mut();
            if pkg_res.tag == ResolutionTag::Git {
                repo.resolved = pkg_res.git().resolved;
            }
            repo.package_name = pkg_name;
        }
        dependency::version::Tag::Github => v.github_mut().package_name = pkg_name,
        dependency::version::Tag::Tarball => v.tarball_mut().package_name = pkg_name,
        _ => {}
    }
}

/// `cached` makes the request conditional on its etag / last-modified.
fn enqueue_manifest_download(
    this: &mut PackageManager,
    task_id: Task::Id,
    name: &[u8],
    cached: Option<&Npm::PackageManifest>,
    is_optional: bool,
) -> crate::Result<()> {
    let this_ptr: *mut PackageManager = this;
    let network_task = run_tasks::get_network_task(this);
    // SAFETY: `network_task` is the unique handle to a
    // freshly-vended pool slot. `write_init` resets every
    // defaulted field (callback is uninitialized and
    // overwritten by `for_manifest`).
    unsafe {
        NetworkTask::write_init(network_task, task_id, this_ptr);
    }

    let scope = this.scope_for_package_name(name);
    // SAFETY: network_task points to a valid initialized NetworkTask slot
    unsafe {
        (*network_task).for_manifest(
            name,
            scope,
            cached,
            is_optional,
            this.options.minimum_release_age_ms.is_some(),
        )?;
    }
    enqueue_network_task(this, network_task);
    Ok(())
}

/// A stale edge confirms a stale manifest with a 304. True while this run's one full request runs.
fn refetch_stale_manifest(
    this: &mut PackageManager,
    name: &[u8],
    is_optional: bool,
) -> crate::Result<bool> {
    use crate::network_task::ManifestOrigin;
    if this.options.offline == OfflineMode::Offline {
        return Ok(false);
    }
    let task_id = Task::Id::for_manifest(name);
    let entry = this.network_dedupe_map.get_or_put(task_id)?.value_ptr;
    match entry.manifest {
        ManifestOrigin::Registry => return Ok(false),
        ManifestOrigin::Refetching => return Ok(true),
        ManifestOrigin::Cache => entry.manifest = ManifestOrigin::Refetching,
    }
    if verbose_install() {
        bun_core::pretty_errorln!(
            "Enqueue package manifest for download, the cached one lacks the version: {}",
            bstr::BStr::new(name)
        );
    }
    enqueue_manifest_download(this, task_id, name, None, is_optional)?;
    Ok(true)
}

#[cold]
fn warn_latest_names_no_version(
    this: &mut PackageManager,
    manifest: &Npm::PackageManifest,
    instead: Npm::FindResult,
) {
    this.log_mut().add_warning_fmt(
        None,
        bun_ast::Loc::EMPTY,
        format_args!(
            "the \"latest\" tag of \"{}\" names no published version, using {}",
            bun_fmt::escape_control_chars(manifest.name()),
            instead.version.fmt(&manifest.string_buf),
        ),
    );
}

/// What bun.lock has for a git / tarball row of package.json, which does not know its name yet.
fn locked_repository(
    this: &PackageManager,
    dependency: &Dependency,
    res: &Resolution,
) -> Option<PackageID> {
    if this.repins_tarball(
        dependency,
        this.lockfile.buffers.string_bytes.as_slice(),
        true,
    ) {
        return None;
    }
    this.locked_tarball(res)
}

/// Any manifest's `npm:` alias; for a row of the root package.json, only one the root declares.
fn followed_npm_alias(
    this: &mut PackageManager,
    id: DependencyID,
    is_root: bool,
    name: SemverString,
    name_hash: PackageNameHash,
) -> Option<dependency::Version> {
    let known = this.known_npm_aliases.get(&name_hash)?;
    let lockfile = &mut *this.lockfile;
    // `is_root` is an import that the runtime resolves, not a row of the root package.json.
    let Some(root_dependencies) = lockfile
        .packages
        .items_dependencies()
        .first()
        .filter(|root| !is_root && root.contains(id))
    else {
        let literal = lockfile.string_buf().append(known).unwrap_or_oom();
        let sliced = literal.sliced(lockfile.buffers.string_bytes.as_slice());
        return dependency::parse_with_tag(
            name,
            Some(name_hash),
            sliced.slice,
            dependency::version::Tag::Npm,
            &sliced,
            None,
            None,
        );
    };
    root_dependencies
        .get(lockfile.buffers.dependencies.as_slice())
        .iter()
        .filter(|dep| dep.name_hash == name_hash)
        .filter_map(|dep| lockfile.resolve_catalog_dependency(dep))
        .find(|version| version.tag == dependency::version::Tag::Npm && version.npm().is_alias)
}

/// Like npm, only then they share a folder. `None` until the alias's manifest has arrived.
fn takes_alias_target(
    this: &mut PackageManager,
    declared: &Semver::query::Group,
    aliased: &dependency::Version,
) -> Option<bool> {
    let lockfile = &*this.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let name = aliased.npm().name.slice(buf);
    let name_hash = Semver::string::Builder::string_hash(name);
    if links_workspace(this, name_hash, &aliased.npm().version) {
        return Some(links_workspace(this, name_hash, declared));
    }
    if let Some(id) = lockfile.package_satisfying(name_hash, aliased, |_| true) {
        let bound = lockfile.packages.items_resolution()[id as usize]
            .npm()
            .version;
        return Some(declared.satisfies(bound, buf, buf));
    }
    let manifest = this.manifests.by_name_hash_in_memory(name, name_hash)?;
    match manifest.find_for_dependency(
        aliased,
        buf,
        this.options.minimum_release_age_ms,
        this.options.minimum_release_age_excludes,
    ) {
        Npm::FindVersionResult::Err(Npm::FindVersionError::NotFound) => Some(false),
        found => Some(declared.satisfies(found.unwrap()?.version, buf, &manifest.string_buf)),
    }
}

fn on_first_resolution(
    this: &mut PackageManager,
    version: &dependency::Version,
    package: &Package,
) -> crate::Result<()> {
    if verbose_install() {
        bun_core::pretty_errorln!(
            "   -> \"{}\": \"{}\" -> {}@{}",
            bstr::BStr::new(this.lockfile.str(&package.name)),
            bun_fmt::escape_control_chars(this.lockfile.str(&version.literal)),
            bstr::BStr::new(this.lockfile.str(&package.name)),
            bun_fmt::for_terminal(package.resolution.fmt(
                this.lockfile.buffers.string_bytes.as_slice(),
                bun_fmt::PathSep::Auto
            )),
        );
    }
    if package.dependencies.len > 0 {
        (this.lockfile.scratch.dependency_list_queue).write_item(package.dependencies)?;
    }
    Ok(())
}

fn enqueue_resolved_task(
    this: &mut PackageManager,
    package_id: PackageID,
    task: ResolvedPackageTask,
) {
    use install::PreinstallState as State;
    let state = this.get_preinstall_state(package_id);
    match task {
        ResolvedPackageTask::NetworkTask(network_task) => {
            if state == State::Extract {
                this.set_preinstall_state(package_id, State::Extracting);
                enqueue_network_task(this, network_task);
            }
        }
        ResolvedPackageTask::PatchTask(patch_task) => {
            let (ready, started) = match patch_task.callback {
                crate::patch_install::Callback::CalcHash(_) => {
                    (State::CalcPatchHash, State::CalcingPatchHash)
                }
                crate::patch_install::Callback::Apply(_) => {
                    (State::ApplyPatch, State::ApplyingPatch)
                }
            };
            if state == ready {
                this.set_preinstall_state(package_id, started);
                enqueue_patch_task(this, patch_task);
            }
        }
    }
}

/// Q: "What do we do with a dependency in a package.json?" A: "We enqueue it!"
pub fn enqueue_dependency_with_main_and_success_fn(
    this: &mut PackageManager,
    id: DependencyID,
    // This must be a *const to prevent UB
    dependency: &Dependency,
    resolution: PackageID,
    install_peer: bool,
    success_fn: SuccessFn,
    // Auto-install: resolution errors go to `this.log` instead of propagating.
    is_root: bool,
) -> crate::Result<()> {
    if dependency.behavior.is_optional_peer() {
        return Ok(());
    }

    let mut name = dependency.realname();
    let mut name_hash = match dependency.version.tag {
        dependency::version::Tag::DistTag
        | dependency::version::Tag::Git
        | dependency::version::Tag::Github
        | dependency::version::Tag::Npm
        | dependency::version::Tag::Tarball
        | dependency::version::Tag::Workspace => {
            Semver::string::Builder::string_hash(this.lockfile.str(&name))
        }
        _ => dependency.name_hash,
    };

    let mut version_was_replaced = true;
    let version: dependency::Version = 'version: {
        // Only a plain dependency follows a same-named `npm:` alias elsewhere in the tree.
        if dependency.version.tag == dependency::version::Tag::Npm
            && !dependency.version.npm().is_alias
        {
            if let Some(aliased) = followed_npm_alias(this, id, is_root, name, name_hash) {
                let group = &dependency.version.npm().version;
                let buf = this.lockfile.buffers.string_bytes.as_slice();
                // SAFETY: `aliased` is always tag == Npm (`followed_npm_alias` returns no other).
                let alias_group = &aliased.npm().version;
                // The bounds guess where the alias resolves. A peer is not held to its range.
                if (dependency.behavior.is_peer() || group.intersects(buf, alias_group, buf))
                    && group.is_satisfied_by_a_bound_of(buf, alias_group, buf)
                    && (dependency.behavior.is_peer()
                        || group.is_star()
                        || takes_alias_target(this, group, &aliased) != Some(false))
                    // A rule for this dependency wins over the alias.
                    && (dependency.behavior.is_workspace()
                        || (this.lockfile.overrides)
                            .lookup(&this.lockfile, id, name_hash)
                            .is_none())
                {
                    name = aliased.npm().name;
                    name_hash = Semver::string::Builder::string_hash(this.lockfile.str(&name));
                    break 'version aliased;
                }

                // An alias's name but not its version: a normal npm dependency, overrides allowed.
            }
        }

        // A workspaceOnly dependency is never overridden. `lookup` decides which rules reach an alias.
        if !dependency.behavior.is_workspace() {
            let is_alias = dependency.version.tag == dependency::version::Tag::Npm
                && dependency.version.npm().is_alias;
            // Rules for an alias are keyed by the alias, not by the package it points at.
            let rule_name_hash = if is_alias {
                dependency.name_hash
            } else {
                name_hash
            };
            let overridden = (this.lockfile.overrides)
                .lookup_declared(&this.lockfile, id, rule_name_hash, &dependency.version)
                .map(|rule| rule.version().clone())
                .filter(|_| !links_workspace_member(this, id, dependency, name_hash));
            if let Some(new) = &overridden {
                bun_output::scoped_log!(
                    PackageManager,
                    "override: {} -> {}",
                    bstr::BStr::new(this.lockfile.str(&dependency.version.literal)),
                    bstr::BStr::new(this.lockfile.str(&new.literal))
                );

                (name, name_hash) = update_name_and_name_hash_from_version_replacement(
                    &this.lockfile,
                    name,
                    name_hash,
                    new,
                );
            }

            let declared = overridden.as_ref().unwrap_or(&dependency.version);
            if declared.tag == dependency::version::Tag::Catalog {
                if let Some(catalog_dep) =
                    this.lockfile
                        .catalogs
                        .get(&this.lockfile, *declared.catalog(), name)
                {
                    let v = catalog_dep.version;
                    (name, name_hash) = update_name_and_name_hash_from_version_replacement(
                        &this.lockfile,
                        name,
                        name_hash,
                        &v,
                    );
                    break 'version v;
                }
            }

            if let Some(new) = overridden {
                break 'version new;
            }
        }

        // explicit copy here due to `dependency.version` becoming undefined
        // when `getOrPutResolvedPackageWithFindResult` is called and resizes the list.
        version_was_replaced = false;
        break 'version dependency.version.clone();
    };

    // An unsafe alias (a future folder) or registry name: refused before it is fetched or printed.
    let alias = this.lockfile.str(&dependency.name);
    let alias_is_safe = if alias == this.lockfile.str(&dependency.version.literal) {
        // `bun add <specifier>`'s alias until `assign_resolution`: never a folder, but printed.
        !dependency::contains_control_character(alias)
    } else {
        alias.is_empty() || crate::package_installer::alias_is_safe_install_target(alias)
    };
    let registry_name: Option<&[u8]> = match version.tag {
        dependency::version::Tag::Npm | dependency::version::Tag::DistTag => {
            Some(this.lockfile.str(&name))
        }
        _ => None,
    };
    let invalid_name = if !alias_is_safe {
        Some(alias)
    } else {
        // `""`, `@1.0.0`, `@scope/` (an older lockfile, an override) would request `/`, `/@1.0.0`.
        registry_name.filter(|name| !crate::package_installer::alias_is_safe_install_target(name))
    };
    if let Some(invalid_name) = invalid_name {
        let name = bun_fmt::for_terminal(bstr::BStr::new(invalid_name));
        add_error_or_warning(
            this.log_mut(),
            dependency.behavior.is_required(),
            format_args!("Invalid dependency name \"{name}\""),
        );
        return Ok(());
    }

    let mut loaded_manifest: Option<Npm::PackageManifest> = None;
    let waiter = || {
        if is_root {
            TaskCallbackContext::RootDependency(id)
        } else {
            TaskCallbackContext::Dependency(id)
        }
    };

    match version.tag {
        dependency::version::Tag::DistTag
        | dependency::version::Tag::Folder
        | dependency::version::Tag::Npm => {
            'retry_from_manifests_ptr: loop {
                let mut resolve_result_ = get_or_put_resolved_package(
                    this,
                    name_hash,
                    name,
                    dependency,
                    &version,
                    version_was_replaced,
                    dependency.behavior,
                    id,
                    resolution,
                    install_peer,
                    success_fn,
                );

                'retry_with_new_resolve_result: loop {
                    let resolve_result = match resolve_result_ {
                        Ok(v) => v,
                        Err(err) => {
                            return report_resolve_error(
                                this, id, dependency, name, &version, err, is_root,
                            );
                        }
                    };

                    if let Some(result) = resolve_result {
                        if result.is_first_time {
                            on_first_resolution(this, &version, &result.package)?;
                        }
                        if let Some(task) = result.task {
                            enqueue_resolved_task(this, result.package.meta.id, task);
                        }
                        return Ok(());
                    }
                    if !version.tag.is_npm() {
                        return Ok(());
                    }

                    // Before `this_ptr`: a `&mut *this_ptr` later would invalidate `scope`.
                    let cache_ctx = this.manifest_disk_cache_ctx();
                    let this_ptr: *mut PackageManager = this;
                    // Owned: resolving can reallocate `string_bytes`, and this is read afterwards.
                    let name_str: Vec<u8> = this.lockfile.str(&name).to_vec();
                    let task_id = Task::Id::for_manifest(&name_str);

                    debug_assert!(task_id.get() != 0);

                    if dependency.behavior.is_peer() && !install_peer {
                        this.peer_dependencies.write_item(id)?;
                        return Ok(());
                    }
                    if this.has_created_network_task(task_id, dependency.behavior.is_required()) {
                        task_callback_list(this, task_id).push(waiter());
                        return Ok(());
                    }

                    let needs_extended_manifest = this.options.minimum_release_age_ms.is_some();
                    if this.options.enable.manifest_cache() {
                        let mut expired = false;
                        // SAFETY: `this_ptr` is the live exclusive borrow's address; `options` is
                        // disjoint from `manifests`.
                        let scope: *const crate::npm::registry::Scope =
                            unsafe { &(*this_ptr).options }.scope_for_package_name(&name_str);
                        // SAFETY: `manifests` projected from `this_ptr`; `cache_ctx` was snapshotted
                        // before `this_ptr` so the lookup holds only this disjoint field borrow.
                        if let Some(manifest) = unsafe {
                            (*this_ptr).manifests.by_name_hash_allow_expired(
                                cache_ctx,
                                &*scope,
                                &name_str,
                                name_hash,
                                Some(&mut expired),
                                needs_extended_manifest,
                            )
                        } {
                            let manifest: &Npm::PackageManifest =
                                loaded_manifest.insert(manifest.clone());
                            let excludes = this.options.minimum_release_age_excludes;

                            // An exact version in an expired manifest needs no request.
                            let exact = (version.tag == dependency::version::Tag::Npm
                                && version.npm().version.is_exact())
                            .then(|| version.npm().version.head.head.range.left.version);
                            if let Some(exact) = exact
                                && (!needs_extended_manifest
                                    || manifest.pkg.has_extended_manifest
                                    || manifest.should_exclude_from_age_filter(excludes))
                                && !picks_latest_tag(
                                    this,
                                    dependency,
                                    id,
                                    name_hash,
                                    name,
                                    &version,
                                    version_was_replaced,
                                )
                                && let Some(find_result) = manifest.find_by_version(exact)
                            {
                                if let Some(min_age_ms) = this.options.minimum_release_age_ms
                                    && !manifest.should_exclude_from_age_filter(excludes)
                                    && manifest.is_version_blocked_by_age_filter(
                                        find_result,
                                        min_age_ms,
                                        excludes,
                                    )
                                    // The gate is for new resolutions, not for pinned ones.
                                    && locked_version_in_lockfile(this, name_hash, &version)
                                        .is_none()
                                {
                                    // Reported like a fresh manifest's would be.
                                    resolve_result_ = Err(crate::Error::TooRecentVersion);
                                    let _ = this.network_dedupe_map.remove(&task_id);
                                    continue 'retry_with_new_resolve_result;
                                }
                                if let Some(new_resolve_result) =
                                    get_or_put_resolved_package_with_find_result(
                                        // SAFETY: see `this_ptr` note above.
                                        unsafe { &mut *this_ptr },
                                        name_hash,
                                        name,
                                        dependency,
                                        &version,
                                        false,
                                        id,
                                        dependency.behavior,
                                        manifest,
                                        find_result,
                                        install_peer,
                                        success_fn,
                                    )
                                    .ok()
                                    .flatten()
                                {
                                    resolve_result_ = Ok(Some(new_resolve_result));
                                    let _ = this.network_dedupe_map.remove(&task_id);
                                    continue 'retry_with_new_resolve_result;
                                }
                            }

                            // Offline modes load any as fresh: `expired` then wants the full one.
                            if !expired
                                && (this.options.enable.manifest_cache_control()
                                    || this.options.offline != OfflineMode::Online)
                            {
                                let _ = this.network_dedupe_map.remove(&task_id);
                                continue 'retry_from_manifests_ptr;
                            }
                        }
                    }

                    if this.options.offline == OfflineMode::Offline {
                        // Any other releases the reservation: a later required edge still reports.
                        if dependency.behavior.is_required() {
                            this.mark_network_task_failed(task_id);
                            this.log_mut().add_error_fmt(
                                None,
                                bun_ast::Loc::EMPTY,
                                format_args!(
                                    "--offline: no cached manifest for \"{}\" (run once online, or use --prefer-offline)",
                                    bstr::BStr::new(&name_str),
                                ),
                            );
                        } else {
                            let _ = this.network_dedupe_map.remove(&task_id);
                        }
                        return Ok(());
                    }

                    if verbose_install() {
                        bun_core::pretty_errorln!(
                            "Enqueue package manifest for download: {}",
                            bstr::BStr::new(&name_str)
                        );
                    }

                    enqueue_manifest_download(
                        this,
                        task_id,
                        &name_str,
                        loaded_manifest.as_ref(),
                        dependency.behavior.is_optional(),
                    )?;
                    task_callback_list(this, task_id).push(waiter());
                    return Ok(());
                }
            }
        }
        dependency::version::Tag::Git => {
            let dep: Repository = *version.git();
            let res = Resolution::init(ResolutionTagged::Git(dep));

            // First: see if we already loaded the git package in-memory
            if let Some(pkg_id) = this
                .lockfile
                .get_package_id(name_hash, None, &res)
                .or_else(|| locked_repository(this, dependency, &res))
            {
                success_fn(this, id, pkg_id);
                return Ok(());
            }

            // A git child exits through the event loop, which `auto_installer::Parked` never runs.
            if this.options.runtime_auto_install {
                return Ok(());
            }

            // The enqueue callees copy these into the filename store before `string_bytes` grows.
            let alias = this.lockfile.str_detached(&dependency.name);
            let url = this.lockfile.str_detached(&dep.repo);
            let clone_id = Task::Id::for_git_clone(url);

            if let Some(repo_fd) = this.git_repositories.get(&clone_id).copied() {
                let needs_ctx =
                    this.lockfile.buffers.resolutions[id as usize] == invalid_package_id;

                // Waits on a `git log` task; `run_tasks` fills `git_commits` and re-enters here.
                let committish = this.lockfile.str_detached(&dep.committish);
                let commit_id = Task::Id::for_git_commit(url, committish);
                let resolved = match this.git_commits.get(&commit_id) {
                    Some(resolved) => resolved.clone(),
                    None => {
                        task_callback_list(this, commit_id).push(waiter());

                        if dependency.behavior.is_peer() && !install_peer {
                            this.peer_dependencies.write_item(id)?;
                            return Ok(());
                        }

                        if this
                            .has_created_network_task(commit_id, dependency.behavior.is_required())
                        {
                            return Ok(());
                        }

                        let task =
                            enqueue_git_commit(this, commit_id, clone_id, alias, url, committish);
                        this.enqueue_git_task(task);
                        return Ok(());
                    }
                };
                let checkout_id = Task::Id::for_git_checkout(url, &resolved);

                if needs_ctx {
                    if let Some(pkg_id) = resolve_from_appended_task(this, checkout_id, id) {
                        success_fn(this, id, pkg_id);
                        return Ok(());
                    }
                }

                let waiters = task_callback_list(this, checkout_id);
                if needs_ctx {
                    waiters.push(waiter());
                }

                if dependency.behavior.is_peer() && !install_peer {
                    this.peer_dependencies.write_item(id)?;
                    return Ok(());
                }

                if this.has_created_network_task(checkout_id, dependency.behavior.is_required()) {
                    return Ok(());
                }

                let task = enqueue_git_checkout(
                    this,
                    checkout_id,
                    repo_fd,
                    id,
                    alias,
                    &res,
                    &resolved,
                    None,
                );
                this.enqueue_git_task(task);
            } else {
                task_callback_list(this, clone_id).push(waiter());

                if dependency.behavior.is_peer() && !install_peer {
                    this.peer_dependencies.write_item(id)?;
                    return Ok(());
                }

                if this.has_created_network_task(clone_id, dependency.behavior.is_required()) {
                    return Ok(());
                }
                if offline_git_miss(this, clone_id, alias, dependency.behavior.is_required()) {
                    return Ok(());
                }

                let task = enqueue_git_clone(this, clone_id, alias, &dep);
                this.enqueue_git_task(task);
            }
            Ok(())
        }
        dependency::version::Tag::Symlink | dependency::version::Tag::Workspace => {
            let dependency_tag = version.tag;

            // The trust rule of `get_or_put_resolved_package`'s `file:` arm.
            let is_link_path = dependency_tag == dependency::version::Tag::Symlink
                && dependency::is_link_path(this.lockfile.str(version.symlink()));
            if is_link_path && !this.lockfile.is_trusted_folder_dependency(id) {
                if dependency.behavior.is_required() {
                    reject_link_path_of_remote_package(this, id, dependency, &version);
                }
                return Ok(());
            }

            let _result = match get_or_put_resolved_package(
                this,
                name_hash,
                name,
                dependency,
                &version,
                version_was_replaced,
                dependency.behavior,
                id,
                resolution,
                install_peer,
                success_fn,
            ) {
                Ok(v) => v,
                Err(crate::Error::MissingPackageJSON) => None,
                Err(err) => return Err(err),
            };

            if let Some(result) = _result {
                if result.is_first_time {
                    on_first_resolution(this, &version, &result.package)?;
                }

                // should not trigger a network call
                debug_assert!(result.task.is_none());
                return Ok(());
            }

            let is_required = requires_local_target(this, id, dependency);
            if !is_required && !this.options.log_level.is_verbose() {
                return Ok(());
            }
            if is_link_path {
                add_error_or_warning(
                    this.log_mut(),
                    is_required,
                    format_args!(
                        "Could not find directory \"{}\" for linked dependency \"{}\"",
                        bun_fmt::escape_control_chars(this.lockfile.str(version.symlink())),
                        bun_fmt::escape_control_chars(this.lockfile.str(&name)),
                    ),
                );
            } else if dependency_tag == dependency::version::Tag::Workspace {
                run_tasks::add_error_or_warning_pretty!(
                    this.log_mut(),
                    is_required,
                    "Workspace dependency \"{}\" not found\n\nSearched in <b>{}<r>\n\nWorkspace documentation: https://bun.com/docs/install/workspaces\n\n",
                    bstr::BStr::new(this.lockfile.str(&name)),
                    PackageWorkspaceSearchPathFormatter {
                        manager: this,
                        version
                    },
                );
            } else {
                run_tasks::add_error_or_warning_pretty!(
                    this.log_mut(),
                    is_required,
                    "Package \"{}\" is not linked\n\nTo install a linked package:\n   <cyan>bun link my-pkg-name-from-package-json<r>\n\nTip: the package name is from package.json, which can differ from the folder name.\n\n",
                    bstr::BStr::new(this.lockfile.str(&name)),
                );
            }
            Ok(())
        }
        dependency::version::Tag::Github | dependency::version::Tag::Tarball => {
            let res = Resolution::init(match version.tag {
                dependency::version::Tag::Github => ResolutionTagged::Github(*version.github()),
                _ => match &version.tarball().uri {
                    dependency::tarball::Uri::Local(path) => ResolutionTagged::LocalTarball(*path),
                    dependency::tarball::Uri::Remote(url) => ResolutionTagged::RemoteTarball(*url),
                },
            });
            // Only a package.json read from the project may name a tarball in the project.
            if res.tag == ResolutionTag::LocalTarball
                && !version_was_replaced
                && !this.lockfile.is_dependency_of_local_package(id)
                && !this.lockfile.has_equal_root_dependency(dependency)
                && let Some(declarer) = this.lockfile.get_parent_pkg_of_dependency(id)
                && this.lockfile.packages.items_resolution()[declarer as usize].tag
                    != ResolutionTag::LocalTarball
            {
                if dependency.behavior.is_required() {
                    reject_local_tarball_of_remote_package(this, declarer, dependency);
                }
                return Ok(());
            }

            // First: see if we already loaded the package in-memory
            if let Some(pkg_id) = this
                .lockfile
                .get_package_id(name_hash, None, &res)
                .or_else(|| locked_repository(this, dependency, &res))
            {
                success_fn(this, id, pkg_id);
                return Ok(());
            }

            // The enqueue callees copy `url` into the filename store before `string_bytes` grows.
            let github_url;
            let url: &[u8] = match res.tag {
                ResolutionTag::Github => {
                    github_url = this.alloc_github_url(res.github());
                    &github_url
                }
                ResolutionTag::LocalTarball => this.lockfile.str_detached(res.local_tarball()),
                _ => this.lockfile.str_detached(res.remote_tarball()),
            };
            let task_id = Task::Id::for_tarball(url);

            if this.lockfile.buffers.resolutions[id as usize] == invalid_package_id {
                if let Some(pkg_id) = resolve_from_appended_task(this, task_id, id) {
                    success_fn(this, id, pkg_id);
                    return Ok(());
                }
            }

            task_callback_list(this, task_id).push(waiter());

            if dependency.behavior.is_peer() && !install_peer {
                this.peer_dependencies.write_item(id)?;
                return Ok(());
            }

            if res.tag == ResolutionTag::LocalTarball {
                if !this.has_created_network_task(task_id, dependency.behavior.is_required()) {
                    let dep_name = this.lockfile.str_detached(&dependency.name);
                    let task = enqueue_local_tarball(this, task_id, id, dep_name, url, &res, None);
                    this.task_batch.push(ThreadPool::Batch::from(task));
                }
                return Ok(());
            }

            // `*mut` at once: the borrow of `this` ends before `enqueue_network_task` reborrows it.
            let network_task: Option<*mut NetworkTask> =
                match run_tasks::generate_network_task_for_tarball(
                    this,
                    task_id,
                    url,
                    dependency.behavior.is_required(),
                    id,
                    &Package {
                        name: dependency.name,
                        name_hash: dependency.name_hash,
                        resolution: res,
                        ..Package::default()
                    },
                    Authorization::NoAuthorization,
                ) {
                    // --offline miss: already reported (if required) / skipped (if optional)
                    Err(ForTarballError::Offline) => return Ok(()),
                    other => other?.map(std::ptr::from_mut::<NetworkTask>),
                };
            if let Some(network_task) = network_task {
                enqueue_network_task(this, network_task);
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

/// Logs why `get_or_put_resolved_package` failed. An `Err` is left to the caller to report.
#[cold]
fn report_resolve_error(
    this: &mut PackageManager,
    id: DependencyID,
    dependency: &Dependency,
    name: SemverString,
    version: &dependency::Version,
    err: crate::Error,
    is_root: bool,
) -> crate::Result<()> {
    use crate::Error as E;
    use bun_fmt::escape_control_chars as escape;
    match err {
        E::DistTagNotFound | E::NoMatchingVersion | E::TooRecentVersion => {
            if !dependency.behavior.is_required() {
                return Ok(());
            }
            if dependency.behavior.is_peer() {
                warn_unmet_peer_dependency(this, name, version, err);
                return Ok(());
            }
        }
        E::MissingPackageJSON if !requires_local_target(this, id, dependency) => return Ok(()),
        E::MissingPackageJSON => {}
        _ if !is_root => return Err(err),
        _ => {}
    }
    let buf = this.lockfile.buffers.string_bytes.as_slice();
    let name = escape(name.slice(buf));
    let age_gate_s = this.options.minimum_release_age_ms.unwrap_or(0.0) / MS_PER_S;
    let log = this.log_mut();
    match err {
        E::DistTagNotFound => log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "Package \"{name}\" with tag \"{}\" not found, but package exists",
                escape(version.dist_tag().tag.slice(buf)),
            ),
        ),
        E::NoMatchingVersion => bun_ast::add_error_pretty!(
            log,
            None,
            bun_ast::Loc::EMPTY,
            "No version matching \"{}\" found for specifier \"{}\"<r> <d>(but package exists)<r>",
            escape(version.literal.slice(buf)),
            name,
        ),
        E::TooRecentVersion if version.tag == dependency::version::Tag::DistTag => {
            bun_ast::add_error_pretty!(
                log,
                None,
                bun_ast::Loc::EMPTY,
                "Package \"{}\" with tag \"{}\" not found<r> <d>(all versions blocked by minimum-release-age: {} seconds)<r>",
                name,
                escape(version.dist_tag().tag.slice(buf)),
                age_gate_s,
            )
        }
        E::TooRecentVersion => bun_ast::add_error_pretty!(
            log,
            None,
            bun_ast::Loc::EMPTY,
            "No version matching \"{}\" found for specifier \"{}\"<r> <d>(blocked by minimum-release-age: {} seconds)<r>",
            escape(version.literal.slice(buf)),
            name,
            age_gate_s,
        ),
        E::MissingPackageJSON if version.tag == dependency::version::Tag::Folder => log
            .add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "Could not find package.json for \"file:{}\" dependency \"{name}\"",
                    escape(version.folder().slice(buf)),
                ),
            ),
        E::MissingPackageJSON => log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!("Could not find package.json for dependency \"{name}\""),
        ),
        _ => log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!("{} while resolving package \"{name}\"", err.name()),
        ),
    }
    Ok(())
}

/// Unmet peers stay unresolved instead of failing the install; see `may_stay_unresolved`.
#[cold]
#[inline(never)]
fn warn_unmet_peer_dependency(
    this: &PackageManager,
    name: SemverString,
    version: &dependency::Version,
    err: crate::Error,
) {
    let literal = bstr::BStr::new(this.lockfile.str(&version.literal));
    let name = bstr::BStr::new(this.lockfile.str(&name));
    if err == crate::Error::TooRecentVersion {
        bun_ast::add_warning_pretty!(
            this.log_mut(),
            None,
            bun_ast::Loc::EMPTY,
            "No version matching \"{}\" found for peer dependency \"{}\"<r> <d>(blocked by minimum-release-age: {} seconds)<r>",
            literal,
            name,
            this.options.minimum_release_age_ms.unwrap_or(0.0) / MS_PER_S,
        );
    } else {
        bun_ast::add_warning_pretty!(
            this.log_mut(),
            None,
            bun_ast::Loc::EMPTY,
            "No version matching \"{}\" found for peer dependency \"{}\"<r> <d>(but package exists)<r>",
            literal,
            name,
        );
    }
}

/// `enqueue_local_tarball` would read the path relative to the project, not to the declarer.
#[cold]
#[inline(never)]
fn reject_local_tarball_of_remote_package(
    this: &PackageManager,
    declarer: PackageID,
    dependency: &Dependency,
) {
    let buf = this.lockfile.buffers.string_bytes.as_slice();
    let packages = this.lockfile.packages.slice();
    let name = bun_fmt::escape_control_chars(dependency.name.slice(buf));
    let literal = bun_fmt::escape_control_chars(dependency.version.literal.slice(buf));
    let declarer_name =
        bun_fmt::escape_control_chars(packages.items_name()[declarer as usize].slice(buf));
    // A bundled dependency ships inside the declaring package. The root cannot stand in for it.
    let notes: Box<[bun_ast::Data]> = if dependency.behavior.is_bundled() {
        Box::new([])
    } else {
        Box::new([bun_ast::range_data(
            None,
            bun_ast::Range::NONE,
            bun_ast::alloc_print(format_args!(
                "add \"{name}\": \"{literal}\" to the root package.json to install that tarball for {declarer_name} as well",
            )),
        )])
    };
    this.log_mut().add_range_error_fmt_with_notes(
        None,
        bun_ast::Range::NONE,
        notes,
        format_args!(
            "refusing to resolve \"{name}@{literal}\" declared by {declarer_name}@{}: local tarball dependencies are only allowed in the package.json files of this project",
            bun_fmt::for_terminal(
                packages.items_resolution()[declarer as usize].fmt(buf, bun_fmt::PathSep::Posix)
            ),
        ),
    );
}

/// `version`: the declared specifier, or the one a scoped override supplied.
#[cold]
#[inline(never)]
fn reject_link_path_of_remote_package(
    this: &PackageManager,
    dependency_id: DependencyID,
    dependency: &Dependency,
    version: &dependency::Version,
) {
    const REASON: &str = dependency::LINK_PATH_RULE;
    let buf = this.lockfile.buffers.string_bytes.as_slice();
    let packages = this.lockfile.packages.slice();
    let name = bun_fmt::escape_control_chars(dependency.name.slice(buf));
    let literal = bun_fmt::escape_control_chars(version.literal.slice(buf));
    match this.lockfile.get_parent_pkg_of_dependency(dependency_id) {
        Some(declarer) => this.log_mut().add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "refusing to resolve \"{name}@{literal}\" declared by {}@{}: {REASON}",
                bun_fmt::escape_control_chars(packages.items_name()[declarer as usize].slice(buf)),
                bun_fmt::for_terminal(
                    packages.items_resolution()[declarer as usize]
                        .fmt(buf, bun_fmt::PathSep::Posix)
                ),
            ),
        ),
        None => this.log_mut().add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!("refusing to resolve \"{name}@{literal}\": {REASON}"),
        ),
    }
}

/// Not in a group this install omits; then no lockfile is saved (`may_stay_unresolved`).
#[cold]
fn requires_local_target(
    this: &mut PackageManager,
    id: DependencyID,
    dependency: &Dependency,
) -> bool {
    let declarer = match this.lockfile.get_parent_pkg_of_dependency(id) {
        Some(declarer) => this.lockfile.packages.items_resolution()[declarer as usize].tag,
        None => ResolutionTag::Root,
    };
    let omitted = !(dependency.behavior).is_enabled(this.options.dependency_features(declarer));
    if omitted && !Lockfile::bun_lock::may_stay_unresolved(dependency) {
        (this.options.do_).remove(Do::SAVE_LOCKFILE | Do::SAVE_YARN_LOCK);
    }
    !omitted && dependency.behavior.is_required()
}

/// Allocated up front on the main thread: `preallocated_resolve_tasks` is not thread-safe.
pub(crate) fn create_extract_task_for_streaming(
    this: &mut PackageManager,
    tarball: &ExtractTarball,
    network_task: *mut NetworkTask,
) -> *mut Task::Task<'static> {
    // SAFETY: `this` is a live `&mut PackageManager`; `network_task` is a
    // freshly-vended pool slot whose `'static` reborrow matches the
    // `Task<'static>` slot lifetime.
    let task_value = unsafe {
        Task::Task {
            package_manager: Some(bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<
                PackageManager,
            >(this))),
            log: bun_ast::Log::init(),
            tag: crate::package_manager_task::Tag::Extract,
            request: crate::package_manager_task::Request {
                extract: ManuallyDrop::new(crate::package_manager_task::ExtractRequest {
                    network: &mut *network_task,
                    tarball: ExtractTarball {
                        skip_verify: this.skips_verify(tarball.resolution.tag),
                        ..*tarball
                    },
                }),
            },
            id: (*network_task).task_id,
            ..Task::uninit()
        }
    };
    this.preallocated_resolve_tasks
        .get_init(task_value)
        .as_ptr()
}

pub fn enqueue_extract_npm_package(
    this: &mut PackageManager,
    tarball: &ExtractTarball,
    network_task: *mut NetworkTask,
) -> *mut ThreadPool::Task {
    let task = create_extract_task_for_streaming(this, tarball, network_task);
    // SAFETY: a valid, initialized pool slot
    unsafe { &raw mut (*task).threadpool_task }
}

fn enqueue_git_clone(
    this: &mut PackageManager,
    task_id: Task::Id,
    name: &[u8],
    repository: &Repository,
) -> NonNull<Task::Task<'static>> {
    let value = Task::Task {
        package_manager: Some(bun_ptr::ParentRef::from_ref_mut(&mut *this)),
        log: bun_ast::Log::init(),
        tag: crate::package_manager_task::Tag::GitClone,
        request: crate::package_manager_task::Request {
            git_clone: ManuallyDrop::new(crate::package_manager_task::GitCloneRequest {
                name: stored_string(name),
                url: stored_string(this.lockfile.str(&repository.repo)),
            }),
        },
        id: task_id,
        ..Task::uninit()
    };
    this.preallocated_resolve_tasks.get_init(value)
}

/// `git log`: resolves `committish` in the bare repository of `clone_id`.
fn enqueue_git_commit(
    this: &mut PackageManager,
    task_id: Task::Id,
    clone_id: Task::Id,
    name: &[u8],
    url: &[u8],
    committish: &[u8],
) -> NonNull<Task::Task<'static>> {
    let value = Task::Task {
        package_manager: Some(bun_ptr::ParentRef::from_ref_mut(&mut *this)),
        log: bun_ast::Log::init(),
        tag: crate::package_manager_task::Tag::GitCommit,
        request: crate::package_manager_task::Request {
            git_commit: ManuallyDrop::new(crate::package_manager_task::GitCommitRequest {
                clone_id,
                name: stored_string(name),
                url: stored_string(url),
                committish: stored_string(committish),
            }),
        },
        id: task_id,
        ..Task::uninit()
    };
    this.preallocated_resolve_tasks.get_init(value)
}

pub fn enqueue_git_checkout(
    this: &mut PackageManager,
    task_id: Task::Id,
    dir: Fd,
    dependency_id: DependencyID,
    name: &[u8],
    resolution: &Resolution,
    resolved: &[u8],
    // the package to patch and its name-and-version hash, if an apply step follows the checkout
    patch: Option<(PackageID, u64)>,
) -> NonNull<Task::Task<'static>> {
    // The patched-dependency entry can be missing (or its hash not yet
    // computed) when install state went stale — e.g. the patch was removed
    // from package.json, leaving the hash only in
    // `patched_dependencies_to_remove`. Install the package unpatched instead
    // of panicking.
    let patch = patch.and_then(|(pkg_id, h)| {
        Some((
            pkg_id,
            h,
            this.lockfile
                .patched_dependencies
                .get(&h)?
                .patchfile_hash()?,
        ))
    });
    // SAFETY: `this` is a live `&mut PackageManager`.
    let task_value = unsafe {
        Task::Task {
            package_manager: Some(bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<
                PackageManager,
            >(this))),
            log: bun_ast::Log::init(),
            tag: crate::package_manager_task::Tag::GitCheckout,
            request: crate::package_manager_task::Request {
                git_checkout: ManuallyDrop::new(crate::package_manager_task::GitCheckoutRequest {
                    repo_dir: dir,
                    resolution: *resolution,
                    dependency_id,
                    name: stored_string(name),
                    url: stored_string(this.lockfile.str(&resolution.git().repo)),
                    resolved: stored_string(resolved),
                }),
            },
            apply_patch_task: if let Some((pkg_id, h, patch_hash)) = patch {
                let mut pt = PatchTask::new_apply_patch_hash(this, pkg_id, patch_hash, h);
                pt.callback.apply_mut().task_id = Some(task_id);
                Some(pt)
            } else {
                None
            },
            id: task_id,
            ..Task::uninit()
        }
    };
    this.preallocated_resolve_tasks.get_init(task_value)
}

fn enqueue_local_tarball(
    this: &mut PackageManager,
    task_id: Task::Id,
    dependency_id: DependencyID,
    name: &[u8],
    path: &[u8],
    resolution: &Resolution,
    // Of the package in the loaded lockfile.
    locked_integrity: Option<&Integrity>,
) -> *mut ThreadPool::Task {
    // Resolve the on-disk tarball path here on the main thread. The task
    // callback runs on a ThreadPool worker and must not read
    // `lockfile.packages` / `lockfile.buffers.string_bytes`: those buffers
    // can be reallocated concurrently by the main thread while processing
    // other dependencies (e.g. `appendPackage` / `StringBuilder.allocate`
    // in `Package.fromNPM`).
    let mut abs_buf = bun_paths::path_buffer_pool::get();
    let (tarball_path, normalize): (&[u8], bool) =
        match local_tarball_base_dir(&this.lockfile, dependency_id, path) {
            None => (path, true),
            Some(base_dir) => (
                Path::resolve_path::join_abs_string_buf::<Path::platform::Auto>(
                    FileSystem::instance().top_level_dir(),
                    &mut abs_buf,
                    &[base_dir, path],
                ),
                false,
            ),
        };

    let value = Task::Task {
        package_manager: Some(bun_ptr::ParentRef::from_ref_mut(&mut *this)),
        log: bun_ast::Log::init(),
        tag: crate::package_manager_task::Tag::LocalTarball,
        request: crate::package_manager_task::Request {
            local_tarball: ManuallyDrop::new(crate::package_manager_task::LocalTarballRequest {
                tarball: ExtractTarball {
                    package_manager: bun_ptr::BackRef::new(this),
                    name: stored_string(name),
                    resolution: *resolution,
                    cache_dir: get_cache_directory(this),
                    temp_dir: get_temporary_directory(this).handle.fd(),
                    dependency_id,
                    integrity: locked_integrity.copied().unwrap_or_default(),
                    stays_unpinned: locked_integrity.is_some() && !this.pins_tarballs(),
                    url: stored_string(path),
                    skip_verify: false,
                    in_trusted_dependencies: false,
                    github_resolved: StringOrTinyString::init(b""),
                },
                tarball_path: stored_string(tarball_path),
                normalize,
            }),
        },
        id: task_id,
        ..Task::uninit()
    };
    let task = this.preallocated_resolve_tasks.get_init(value).as_ptr();
    // SAFETY: `get_init` just fully initialized the slot.
    unsafe { &raw mut (*task).threadpool_task }
}

/// The workspace or `file:` folder directory that `path` is relative to; `None` is the top-level dir.
fn local_tarball_base_dir<'a>(
    lockfile: &'a Lockfile::Lockfile,
    dependency_id: DependencyID,
    path: &[u8],
) -> Option<&'a [u8]> {
    let declared = &lockfile.buffers.dependencies[dependency_id as usize].version;
    let declared_by_parent = declared.tag == dependency::version::Tag::Tarball
        && matches!(
            &declared.tarball().uri,
            dependency::tarball::Uri::Local(declared_path) if lockfile.str(declared_path) == path
        );
    if !declared_by_parent {
        // Overrides, resolutions and catalogs are all written in the root package.json.
        return None;
    }

    let declarer = lockfile.get_parent_pkg_of_dependency(dependency_id)?;
    let declarer_res = &lockfile.packages.items_resolution()[declarer as usize];
    let base_dir = match declarer_res.tag {
        ResolutionTag::Workspace => declarer_res.workspace(),
        ResolutionTag::Folder => declarer_res.folder(),
        _ => return None,
    };
    Some(lockfile.str(base_dir))
}

fn update_name_and_name_hash_from_version_replacement(
    lockfile: &Lockfile::Lockfile,
    original_name: SemverString,
    original_name_hash: PackageNameHash,
    new_version: &dependency::Version,
) -> (SemverString, PackageNameHash) {
    match new_version.tag {
        // only get name hash for npm and dist_tag. git, github, tarball don't have names until after extracting tarball
        dependency::version::Tag::DistTag => (
            new_version.dist_tag().name,
            Semver::string::Builder::string_hash(lockfile.str(&new_version.dist_tag().name)),
        ),
        dependency::version::Tag::Npm => (
            new_version.npm().name,
            Semver::string::Builder::string_hash(lockfile.str(&new_version.npm().name)),
        ),
        dependency::version::Tag::Git => (new_version.git().package_name, original_name_hash),
        dependency::version::Tag::Github => (new_version.github().package_name, original_name_hash),
        dependency::version::Tag::Tarball => {
            (new_version.tarball().package_name, original_name_hash)
        }
        _ => (original_name, original_name_hash),
    }
}

fn links_workspace(
    this: &PackageManager,
    name_hash: PackageNameHash,
    range: &Semver::query::Group,
) -> bool {
    let lockfile = &*this.lockfile;
    Lockfile::linked_workspace_path(
        this.options.link_workspace_packages,
        &lockfile.workspace_paths,
        &lockfile.workspace_versions,
        name_hash,
        range,
        lockfile.buffers.string_bytes.as_slice(),
    )
    .is_some()
}

/// A rule for the member's name does not displace the link of a root or workspace row.
fn links_workspace_member(
    this: &PackageManager,
    id: DependencyID,
    dependency: &Dependency,
    name_hash: PackageNameHash,
) -> bool {
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let declared = lockfile.catalogs.resolve_range(buf, dependency);
    let links = match declared.tag {
        dependency::version::Tag::Workspace => true,
        dependency::version::Tag::Npm => links_workspace(this, name_hash, &declared.npm().version),
        _ => false,
    };
    links
        && lockfile.is_workspace_dependency(id)
        && root_workspace_package_id(lockfile, name_hash).is_some()
}

fn root_workspace_package_id(
    lockfile: &Lockfile::Lockfile,
    name_hash: PackageNameHash,
) -> Option<PackageID> {
    let root_package = lockfile.root_package()?;
    let root_dependencies = root_package
        .dependencies
        .get(lockfile.buffers.dependencies.as_slice());
    let root_resolutions = root_package
        .resolutions
        .get(lockfile.buffers.resolutions.as_slice());
    debug_assert_eq!(root_dependencies.len(), root_resolutions.len());
    for (root_dep, &workspace_package_id) in root_dependencies.iter().zip(root_resolutions) {
        if workspace_package_id != invalid_package_id
            && root_dep.version.tag == dependency::version::Tag::Workspace
            && root_dep.name_hash == name_hash
        {
            return Some(workspace_package_id);
        }
    }
    None
}

pub(crate) fn has_linkable_workspace(this: &PackageManager, name_hash: PackageNameHash) -> bool {
    this.options.link_workspace_packages && this.lockfile.workspace_paths.contains(&name_hash)
}

pub(crate) enum ResolvedPackageTask {
    /// Pending network task to schedule
    NetworkTask(*mut NetworkTask),

    /// Apply patch task or calc patch hash task
    PatchTask(Box<PatchTask>),
}

#[derive(Default)]
pub(crate) struct ResolvedPackageResult {
    pub package: Package,

    /// Is this the first time we've seen this package?
    pub is_first_time: bool,

    pub task: Option<ResolvedPackageTask>,
}

/// Once per version. What a package.json of the project names gets a line; the rest is counted.
#[cold]
fn warn_deprecated(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    manifest: &Npm::PackageManifest,
    found: Npm::FindResult,
) {
    if !this.lockfile.is_workspace_dependency(dependency_id) && !this.options.log_level.is_verbose()
    {
        this.deprecated_transitive += 1;
        return;
    }
    this.log_mut().add_warning_fmt(
        None,
        bun_ast::Loc::EMPTY,
        format_args!(
            "deprecated {}@{}: {}",
            bun_fmt::escape_control_chars(manifest.name()),
            found.version.fmt(&manifest.string_buf),
            bun_fmt::escape_control_chars(found.package.deprecated.slice(&manifest.string_buf)),
        ),
    );
}

fn get_or_put_resolved_package_with_find_result(
    this: &mut PackageManager,
    name_hash: PackageNameHash,
    name: SemverString,
    dependency: &Dependency,
    version: &dependency::Version,
    // `picks_latest_tag`
    latest_for_target: bool,
    dependency_id: DependencyID,
    behavior: Behavior,
    manifest: &Npm::PackageManifest,
    find_result: Npm::FindResult,
    install_peer: bool,
    success_fn: SuccessFn,
) -> crate::Result<Option<ResolvedPackageResult>> {
    let should_update = this.to_update
        && if !this.update_requests.is_empty() {
            // Other resolutions stay pinned.
            names_update_request(this, dependency, name_hash, name)
                && crate::update_scope::UpdateScope::of(this)
                    .contains_dependency(&this.lockfile, dependency_id)
        } else {
            // Bare `bun update`: the rows the targeted workspaces declare; catalogs are the root's.
            dependency.version.tag == dependency::version::Tag::Catalog
                || update_target_declares(this, dependency_id)
        };

    // A patched package is held while the range allows it; `--latest` and audit fix move it.
    if should_update && !latest_for_target && !behavior.is_peer() {
        if let Some(id) = this.lockfile.patched_package_satisfying(name_hash, version) {
            this.kept_patched.push(id);
            return bind_existing(this, dependency_id, id, success_fn);
        }
    }

    // A deferred peer reuses only an exact match: its range match waits for `install_peer`.
    let suppress_peer_satisfies = behavior.is_peer() && !install_peer;
    let npm_resolution = Resolution::init(ResolutionTagged::Npm(ResolutionNpmValue {
        version: find_result.version,
        url: find_result.package.tarball_url.value,
    }));
    let reusable_range = if should_update || suppress_peer_satisfies {
        None
    } else {
        Some(version)
    };
    let inside_bundle = this.lockfile.is_row_inside_bundle(dependency_id, behavior);
    let existing = if inside_bundle {
        this.lockfile
            .get_package_id(name_hash, reusable_range, &npm_resolution)
    } else {
        this.lockfile
            .get_package_id_outside_bundles(name_hash, reusable_range, &npm_resolution)
    };
    if let Some(id) = existing {
        // The existing entry may come from an abbreviated manifest or a pre-`libc` lockfile.
        if find_result.package.libc != Npm::Libc::NONE {
            let buf = this.lockfile.buffers.string_bytes.as_slice();
            let same_version = this.lockfile.packages.items_resolution()[id as usize].eql(
                &npm_resolution,
                buf,
                buf,
            );
            let meta = &mut this.lockfile.packages.items_meta_mut()[id as usize];
            if same_version && meta.libc == Npm::Libc::NONE {
                meta.libc = find_result.package.libc;
            }
        }
        return bind_existing(this, dependency_id, id, success_fn);
    } else if behavior.is_peer() && !install_peer {
        return Ok(None);
    }

    // appendPackage sets the PackageID on the package
    // reshaped for borrowck — `from_npm` takes both `&mut PackageManager`
    // and `&mut Lockfile`, which alias through `this.lockfile`. Split via raw root.
    let this_ptr: *mut PackageManager = this;
    // SAFETY: `from_npm` reads `pm` fields disjoint from `pm.lockfile` (options /
    // updating_packages), so the raw-pointer split does not alias.
    let package = unsafe { &mut *(*this_ptr).lockfile }.append_package(&Package::from_npm(
        unsafe { &mut *this_ptr },
        unsafe { &mut *(*this_ptr).lockfile },
        this.log_mut(),
        manifest,
        find_result.version,
        find_result.package,
        Features::NPM,
    )?)?;

    debug_assert!(package.meta.id != invalid_package_id);
    // Record exact-version pins so `Lockfile::get_package_id`'s
    // order-independence guard can tell them apart from range-resolved
    // entries (which it treats as network-order artefacts).
    if version.tag == dependency::version::Tag::Npm && version.npm().version.is_exact() {
        // SAFETY: `this_ptr` is the sole live `&mut PackageManager` here;
        // `lockfile.exact_pinned` is disjoint from `package` (returned
        // by-value above).
        unsafe { &mut *(*this_ptr).lockfile }.mark_exact_pin(package.meta.id);
    }
    let package_id = package.meta.id;
    // `success_fn` runs after every exit of the rest, the `?` paths included.
    let result = (|| -> crate::Result<Option<ResolvedPackageResult>> {
        let package = if this.lockfile.package_extensions.rules.is_empty() {
            package
        } else {
            let log = this.log_mut();
            this.lockfile
                .extend_new_package(&mut this.known_npm_aliases, log, package.meta.id)?
        };

        // `remote_package_features` only lacks groups that no remote package has.
        let placed = behavior.is_placed(this.options.local_package_features);
        // `is_filtered_dependency_or_workspace` filters this package and everything below it.
        let unplaced = !this.options.runtime_auto_install
            && (!placed
                || package.meta.is_disabled(
                    this.options.cpu,
                    this.options.os,
                    this.options.libc.for_dependency(behavior),
                )
                || this.lockfile.is_in_unplaced_subtree(dependency_id));
        if unplaced {
            this.lockfile.mark_unplaced_subtree(package.dependencies);
            if inside_bundle {
                this.lockfile.mark_only_bundled(package.meta.id);
            }
        } else if !find_result.package.deprecated.is_empty() && !this.options.runtime_auto_install {
            warn_deprecated(this, dependency_id, manifest, find_result);
        }

        // non-null if the package is in "patchedDependencies"
        let mut name_and_version_hash: Option<u64> = None;
        let mut patchfile_hash: Option<u64> = None;

        let task = match this.determine_preinstall_state(
            &package,
            behavior,
            &mut name_and_version_hash,
            &mut patchfile_hash,
        ) {
            // Already in the cache: no download, but its dependencies are enqueued
            install::PreinstallState::Done => None,
            // If a placed dependency needs it too, the install phase fetches and patches it.
            _ if unplaced => None,
            // e.g., --lockfile-only
            install::PreinstallState::Extract
                if !this.options.do_.contains(Do::PREFETCH_RESOLVED_TARBALLS) =>
            {
                None
            }
            // Do we need to download the tarball?
            install::PreinstallState::Extract => {
                let task_id = Task::Id::for_npm_package(
                    this.lockfile.str(&name),
                    package.resolution.npm().version,
                );
                debug_assert!(!this.network_dedupe_map.contains(&task_id));

                Some(ResolvedPackageTask::NetworkTask(
                    run_tasks::generate_network_task_for_tarball(
                        this,
                        task_id,
                        manifest.str(&find_result.package.tarball_url),
                        behavior.is_required(),
                        dependency_id,
                        &package,
                        Authorization::AllowAuthorization,
                    )?
                    .expect("unreachable"),
                ))
            }
            install::PreinstallState::CalcPatchHash => Some(ResolvedPackageTask::PatchTask(
                PatchTask::new_calc_patch_hash(
                    this,
                    name_and_version_hash.unwrap(),
                    Some(EnqueueAfterState {
                        pkg_id: package.meta.id,
                        dependency_id,
                        url: Box::<[u8]>::from(manifest.str(&find_result.package.tarball_url)),
                    }),
                ),
            )),
            install::PreinstallState::ApplyPatch => Some(ResolvedPackageTask::PatchTask(
                PatchTask::new_apply_patch_hash(
                    this,
                    package.meta.id,
                    patchfile_hash.unwrap(),
                    name_and_version_hash.unwrap(),
                ),
            )),
            _ => unreachable!(),
        };

        Ok(Some(ResolvedPackageResult {
            package,
            is_first_time: true,
            task,
        }))
    })();
    success_fn(this, dependency_id, package_id);
    result
}

fn get_or_put_resolved_package(
    this: &mut PackageManager,
    name_hash: PackageNameHash,
    name: SemverString,
    dependency: &Dependency,
    version: &dependency::Version,
    version_was_replaced: bool,
    behavior: Behavior,
    dependency_id: DependencyID,
    resolution: PackageID,
    install_peer: bool,
    success_fn: SuccessFn,
) -> crate::Result<Option<ResolvedPackageResult>> {
    let latest_for_target = picks_latest_tag(
        this,
        dependency,
        dependency_id,
        name_hash,
        name,
        version,
        version_was_replaced,
    );
    if install_peer && behavior.is_peer() && !latest_for_target {
        if let Some(existing_id) = existing_peer_target(this, name_hash, version, dependency_id) {
            return bind_existing(this, dependency_id, existing_id, success_fn);
        }
    }

    if (resolution as usize) < this.lockfile.packages.len() {
        return Ok(Some(ResolvedPackageResult {
            package: *this.lockfile.packages.get(resolution as usize),
            ..Default::default()
        }));
    }

    match version.tag {
        dependency::version::Tag::Npm | dependency::version::Tag::DistTag => {
            if version.tag == dependency::version::Tag::Npm
                && links_workspace(this, name_hash, &version.npm().version)
                && let Some(workspace_id) = root_workspace_package_id(&this.lockfile, name_hash)
            {
                // make sure verifyResolutions sees this resolution as a valid package id
                return bind_existing(this, dependency_id, workspace_id, success_fn);
            }

            if install_peer
                && behavior.is_peer()
                && is_peer_provided_locally(this, dependency, dependency_id)
            {
                return Ok(Some(ResolvedPackageResult::default()));
            }

            // Resolve the version from the loaded NPM manifest
            // Snapshot the disk-fallback scalars *before* establishing
            // `this_ptr`: `manifest_disk_cache_ctx` takes `&mut self`, and
            // materializing `&mut *this_ptr` after `name_str`/`scope` are
            // derived from it would pop their borrow-stack tags under SB.
            let cache_ctx = this.manifest_disk_cache_ctx();
            let needs_ext = this.options.minimum_release_age_ms.is_some();
            let this_ptr: *mut PackageManager = this;
            // `string_bytes` is not resized between here and the `find_result` lookup.
            let name_str = this.lockfile.str_detached(&name);

            let scope = bun_ptr::BackRef::new(
                // SAFETY: `this_ptr` is the live exclusive `this` borrow; `options`
                // is read-only here and disjoint from the `manifests` mutation below.
                unsafe { &(*this_ptr).options }.scope_for_package_name(name_str),
            );
            // SAFETY: `manifests` projected from `this_ptr`; the lookup holds
            // only that disjoint field borrow alongside the shared `options`
            // / `lockfile` projections above. `scope` points into
            // `(*this_ptr).options`, disjoint from `manifests`.
            let Some(manifest) = (unsafe { &mut (*this_ptr).manifests }).by_name_hash(
                cache_ctx,
                scope.get(),
                name_str,
                name_hash,
                needs_ext,
            ) else {
                // The registry does not have the name: `run_tasks` sent the row back after the 404.
                if version.tag == dependency::version::Tag::DistTag
                    && has_linkable_workspace(this, name_hash)
                    && this.network_task_has_failed(Task::Id::for_manifest(name_str))
                    && let Some(id) = root_workspace_package_id(&this.lockfile, name_hash)
                {
                    return bind_existing(this, dependency_id, id, success_fn);
                }
                return Ok(None); // manifest might still be downloading. This feels unreliable.
            };
            let manifest: &Npm::PackageManifest = manifest;

            let version_result: Npm::FindVersionResult = if latest_for_target {
                manifest.find_by_dist_tag_with_filter(
                    b"latest",
                    this.options.minimum_release_age_ms,
                    this.options.minimum_release_age_excludes,
                )
            } else if let Some(shared) =
                (install_peer && behavior.is_peer() && !version_was_replaced)
                    .then(|| version_every_peer_accepts(this, manifest, dependency, dependency_id))
                    .flatten()
            {
                shared
            } else {
                manifest.find_for_dependency(
                    version,
                    this.lockfile.buffers.string_bytes.as_slice(),
                    this.options.minimum_release_age_ms,
                    this.options.minimum_release_age_excludes,
                )
            };

            let find_result_opt: Option<Npm::FindResult> = match version_result {
                Npm::FindVersionResult::Found(result) => Some(result),
                Npm::FindVersionResult::FoundWithFilter {
                    result,
                    newest_filtered,
                } => {
                    if this.options.log_level.is_verbose()
                        && let Some(newest) = &newest_filtered
                    {
                        let package_name = bstr::BStr::new(this.lockfile.str(&name));
                        let min_age_seconds =
                            this.options.minimum_release_age_ms.unwrap_or(0.0) / MS_PER_S;
                        let manifest_buf: &[u8] = &manifest.string_buf;
                        let buf = this.lockfile.buffers.string_bytes.as_slice();
                        let wanted: &dyn core::fmt::Display = match version.tag {
                            dependency::version::Tag::DistTag => {
                                &bun_fmt::escape_control_chars(version.dist_tag().tag.slice(buf))
                            }
                            dependency::version::Tag::Npm => &version.npm().version.fmt(buf),
                            _ => unreachable!(),
                        };
                        bun_core::pretty_errorln!(
                            "<d>[minimum-release-age]<r> <b>{}@{}<r> selected <green>{}<r> instead of <yellow>{}<r> due to {}-second filter",
                            package_name,
                            wanted,
                            result.version.fmt(manifest_buf),
                            newest.fmt(manifest_buf),
                            min_age_seconds,
                        );
                    }

                    Some(result)
                }
                Npm::FindVersionResult::Err(err_type) => {
                    // The leftover `existing_peer_target` passed over is all there is.
                    if install_peer && behavior.is_peer() {
                        if let Some(id) = highest_peer_candidate(&this.lockfile, name_hash, version)
                        {
                            return bind_existing(this, dependency_id, id, success_fn);
                        }
                    }
                    match err_type {
                        Npm::FindVersionError::TooRecent
                        | Npm::FindVersionError::AllVersionsTooRecent => {
                            // The peer pass may still bind it to a same-named package in the tree.
                            if behavior.is_peer() && !install_peer {
                                return Ok(None);
                            }
                            // The gate is for new resolutions, not for pinned ones.
                            match locked_version_in_lockfile(this, name_hash, version)
                                .and_then(|(locked, _)| manifest.find_by_version(locked))
                            {
                                Some(locked) => Some(locked),
                                None => return Err(crate::Error::TooRecentVersion),
                            }
                        }
                        Npm::FindVersionError::NotFound => None, // Handle below with existing logic
                    }
                }
            };

            let mut find_result = match find_result_opt {
                Some(r) => r,
                None => 'instead_of_latest: {
                    // An unmet peer only warns.
                    if !behavior.is_peer()
                        && refetch_stale_manifest(this, name_str, behavior.is_optional())?
                    {
                        return Ok(None);
                    }

                    // A workspace stands in for a dist-tag only if the registry cannot satisfy it.
                    if version.tag == dependency::version::Tag::DistTag
                        && let Some(id) = root_workspace_package_id(&this.lockfile, name_hash)
                    {
                        return bind_existing(this, dependency_id, id, success_fn);
                    }

                    // `Ok(None)` in the peer pass makes the caller reload the manifest and retry.
                    if behavior.is_peer() && !install_peer {
                        return Ok(None);
                    }

                    // A mirror that lags behind its own dist-tags, or a registry that serves none.
                    if latest_for_target
                        || (version.tag == dependency::version::Tag::DistTag
                            && this.lockfile.str(&version.dist_tag().tag) == b"latest")
                    {
                        if let Some(instead) = manifest
                            .find_any_version(
                                this.options.minimum_release_age_ms,
                                this.options.minimum_release_age_excludes,
                            )
                            .unwrap()
                        {
                            warn_latest_names_no_version(this, manifest, instead);
                            break 'instead_of_latest instead;
                        }
                    }

                    return match version.tag {
                        dependency::version::Tag::Npm => Err(crate::Error::NoMatchingVersion),
                        dependency::version::Tag::DistTag => Err(crate::Error::DistTagNotFound),
                        _ => unreachable!(),
                    };
                }
            };

            // `--latest` never moves a row below what bun.lock has.
            if latest_for_target
                && let Some((locked, buf)) = locked_version_in_lockfile(this, name_hash, version)
                && find_result.version.order(locked, &manifest.string_buf, buf)
                    == core::cmp::Ordering::Less
                && let Some(kept) = manifest.find_by_version(locked)
            {
                find_result = kept;
            }

            // The callee leaves `this.manifests`, which `manifest` and `find_result` point into.
            get_or_put_resolved_package_with_find_result(
                // SAFETY: see `this_ptr` note above.
                unsafe { &mut *this_ptr },
                name_hash,
                name,
                dependency,
                version,
                latest_for_target,
                dependency_id,
                behavior,
                manifest,
                find_result,
                install_peer,
                success_fn,
            )
        }

        dependency::version::Tag::Folder => {
            let folder = *version.folder();
            let res: FolderResolutionValue = 'res: {
                // A rule of the root package.json wrote the path: read like a root `file:` row.
                let from_root_rule = version_was_replaced
                    && !behavior.is_bundled()
                    && (!crate::bin::bin_target_escapes_package_dir(this.lockfile.str(&folder))
                        || this.lockfile.is_trusted_folder_dependency(dependency_id));
                if from_root_rule || this.lockfile.is_workspace_dependency(dependency_id) {
                    break 'res resolve_project_folder(this, version, folder);
                }

                let path_is_top_level_relative =
                    this.lockfile.is_trusted_folder_dependency(dependency_id);

                // transitive folder dependencies do not have their dependencies resolved
                // Nothing installs a bundled one: the linkers and `bun patch` refuse its path.
                if !behavior.is_bundled()
                    && crate::bin::bin_target_escapes_package_dir(this.lockfile.str(&folder))
                    && !path_is_top_level_relative
                {
                    break 'res FolderResolutionValue::Err(crate::Error::MissingPackageJSON);
                }

                // One such path is one folder, so reuse the package another declarer loaded
                if path_is_top_level_relative {
                    if let Some(existing_id) = this.lockfile.get_package_id(
                        name_hash,
                        None,
                        &Resolution::init(ResolutionTagged::Folder(folder)),
                    ) {
                        break 'res FolderResolutionValue::PackageId(existing_id);
                    }
                }

                let mut package = Package::default();

                {
                    // Copied out of `string_bytes`, which `StringBuilder::allocate` may grow.
                    let name_slice: Vec<u8> = this.lockfile.str(&name).to_vec();
                    let folder_path: Vec<u8> = this.lockfile.str(&folder).to_vec();
                    let mut builder = this.lockfile.string_builder();

                    builder.count(&name_slice);
                    builder.count(&folder_path);

                    builder.allocate().unwrap_or_oom();

                    package.name = builder.append::<SemverString>(&name_slice);
                    package.name_hash = name_hash;

                    package.resolution = Resolution::init(ResolutionTagged::Folder(
                        builder.append::<SemverString>(&folder_path),
                    ));

                    package.scripts.filled = true;
                    package.meta.set_has_install_script(false);

                    builder.clamp();
                }

                package = this.lockfile.append_package(&package).unwrap_or_oom();

                break 'res FolderResolutionValue::NewPackageId(package.meta.id);
            };

            resolved_folder_package(this, res, dependency_id, success_fn)
        }
        dependency::version::Tag::Workspace => {
            if !behavior.is_workspace() && !this.lockfile.is_workspace_dependency(dependency_id) {
                let buf = this.lockfile.buffers.string_bytes.as_slice();
                if !this.lockfile.overrides.contains_name(
                    dependency.name_hash,
                    dependency.name.slice(buf),
                    buf,
                ) {
                    let workspace_id = root_workspace_package_id(&this.lockfile, name_hash)
                        .ok_or(crate::Error::MissingPackageJSON)?;
                    return bind_existing(this, dependency_id, workspace_id, success_fn);
                }
            }
            // package name hash should be used to find workspace path from map
            let workspace_path: SemverString = this
                .lockfile
                .workspace_paths
                .get(&name_hash)
                .copied()
                .unwrap_or_else(|| *version.workspace());
            let res = resolve_project_folder(this, version, workspace_path);
            resolved_folder_package(this, res, dependency_id, success_fn)
        }
        dependency::version::Tag::Symlink => {
            // `get_or_put` copies it into the lockfile string buffer before any other mutation.
            let symlink_path = this.lockfile.str_detached(version.symlink());
            if dependency::is_link_path(symlink_path) {
                let mut buf2 = bun_paths::path_buffer_pool::get();
                let res =
                    match Path::resolve_path::join_abs_string_buf_checked::<Path::platform::Auto>(
                        FileSystem::instance().top_level_dir(),
                        &mut buf2[..],
                        &[symlink_path],
                    ) {
                        Some(symlink_path_abs) => FolderResolution::get_or_put(
                            GlobalOrRelative::Relative(dependency::version::Tag::Symlink),
                            version,
                            symlink_path_abs,
                            this,
                        ),
                        None => FolderResolutionValue::Err(crate::Error::Sys(
                            bun_errno::SystemErrno::ENAMETOOLONG,
                        )),
                    };
                return resolved_folder_package(this, res, dependency_id, success_fn);
            }
            // SAFETY: a slice into `PackageManager.global_link_dir_path`, set once and never freed.
            let link_dir =
                unsafe { detach_lifetime(package_manager_real::global_link_dir_path(this)) };
            let res = FolderResolution::get_or_put(
                GlobalOrRelative::Global(link_dir),
                version,
                symlink_path,
                this,
            );

            resolved_folder_package(this, res, dependency_id, success_fn)
        }

        _ => Ok(None),
    }
}

fn resolved_folder_package(
    this: &mut PackageManager,
    res: FolderResolutionValue,
    dependency_id: DependencyID,
    success_fn: SuccessFn,
) -> crate::Result<Option<ResolvedPackageResult>> {
    let (package_id, is_first_time) = match res {
        FolderResolutionValue::Err(err) => return Err(err),
        FolderResolutionValue::PackageId(package_id) => (package_id, false),
        FolderResolutionValue::NewPackageId(package_id) => (package_id, true),
    };
    success_fn(this, dependency_id, package_id);
    Ok(Some(ResolvedPackageResult {
        package: *this.lockfile.packages.get(package_id as usize),
        is_first_time,
        task: None,
    }))
}

/// Reads the package.json of a `file:` or `workspace:` `path`, absolute or relative to the project.
fn resolve_project_folder(
    this: &mut PackageManager,
    version: &dependency::Version,
    path: SemverString,
) -> FolderResolutionValue {
    // `get_or_put` copies the path into the lockfile string buffer before any other mutation.
    let path = this.lockfile.str_detached(&path);
    let mut buf = bun_paths::path_buffer_pool::get();
    let abs = if bun_paths::is_absolute(path) {
        path
    } else {
        Path::resolve_path::join_abs_string_buf::<Path::platform::Auto>(
            FileSystem::instance().top_level_dir(),
            &mut buf,
            &[path],
        )
    };
    FolderResolution::get_or_put(GlobalOrRelative::Relative(version.tag), version, abs, this)
}

/// `bun update <name>`: the row names a requested package, as declared or through `npm:`.
fn names_update_request(
    this: &PackageManager,
    dependency: &Dependency,
    name_hash: PackageNameHash,
    name: SemverString,
) -> bool {
    let buf = this.lockfile.buffers.string_bytes.as_slice();
    this.is_update_request(dependency.name_hash, dependency.name.slice(buf))
        || (name_hash != dependency.name_hash && this.is_update_request(name_hash, name.slice(buf)))
}

/// The row keeps its declared specifier; one an override or a catalog replaced is not moved here.
fn picks_latest_tag(
    this: &mut PackageManager,
    dependency: &Dependency,
    dependency_id: DependencyID,
    name_hash: PackageNameHash,
    name: SemverString,
    version: &dependency::Version,
    version_was_replaced: bool,
) -> bool {
    if !this.to_update
        || version_was_replaced
        || !this.options.do_.contains(Do::UPDATE_TO_LATEST)
        || !version.tag.is_npm()
    {
        return false;
    }
    (this.update_requests.is_empty() || names_update_request(this, dependency, name_hash, name))
        && update_target_declares(this, dependency_id)
}

/// The targets: the `-r` / `--filter` selection, else the workspace the command runs in.
fn update_target_declares(this: &mut PackageManager, dependency_id: DependencyID) -> bool {
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    if let Some(targets) = this.update_target_workspaces.as_deref() {
        return lockfile.is_dependency_of_workspace_in(targets, dependency_id);
    }
    let in_member = this.workspace_name_hash.is_some();
    let id = match this.root_package_id.id {
        Some(id) if id != 0 || !in_member => id,
        _ => {
            let id = lockfile.get_workspace_package_id(this.workspace_name_hash);
            if id == 0 && in_member {
                return false;
            }
            this.root_package_id.id = Some(id);
            id
        }
    };
    (lockfile.packages.items_dependencies().get(id as usize))
        .is_some_and(|rows| rows.contains(dependency_id))
}

/// The lockfile-loaded instance the row's range accepts (`package_index` lists highest first).
fn locked_version_in_lockfile<'a>(
    this: &'a PackageManager,
    name_hash: PackageNameHash,
    version: &dependency::Version,
) -> Option<(Semver::Version, &'a [u8])> {
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    let in_lockfile = |id| id < lockfile.loaded_package_count;
    let id = lockfile.package_satisfying(name_hash, version, in_lockfile)?;
    let res = &lockfile.packages.items_resolution()[id as usize];
    (res.tag == ResolutionTag::Npm)
        .then(|| (res.npm().version, lockfile.buffers.string_bytes.as_slice()))
}

/// The highest-or-nothing fallback is what `resolve_peer_dep_version_based` rebinds to on load.
fn existing_peer_target(
    this: &PackageManager,
    name_hash: PackageNameHash,
    version: &dependency::Version,
    row: DependencyID,
) -> Option<PackageID> {
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    if let Some(id) = lockfile.package_satisfying(name_hash, version, |_| true) {
        return Some(id);
    }
    let highest = highest_peer_candidate(lockfile, name_hash, version)?;
    (!would_revive_leftover(lockfile, row, highest)).then_some(highest)
}

/// By a `file:`, `link:`, tarball or git row: the tree builder binds the peer to the nearest copy.
fn is_peer_provided_locally(this: &PackageManager, peer: &Dependency, row: DependencyID) -> bool {
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let packages = lockfile.packages.items_resolution();
    let provides = |owner: PackageID, features: Features| {
        let Some(list) = lockfile.packages.items_dependencies().get(owner as usize) else {
            return false;
        };
        (list.begin() as usize..list.end() as usize).any(|id| {
            deps[id].name_hash == peer.name_hash
                && !deps[id].behavior.is_peer()
                && deps[id].behavior.is_enabled(features)
                && packages
                    .get(resolutions[id] as usize)
                    .is_some_and(|package| {
                        !matches!(
                            package.tag,
                            ResolutionTag::Npm | ResolutionTag::Workspace | ResolutionTag::Root
                        )
                    })
        })
    };
    // bun.lock has the declarer's own edge whatever this install omits.
    (lockfile.get_parent_pkg_of_dependency(row))
        .is_some_and(|owner| provides(owner, Features::main()))
        || provides(0, this.options.local_package_features)
}

/// The newest version the ranges of all its dependents accept. `None`: the range of `row` decides.
fn version_every_peer_accepts<'m>(
    this: &PackageManager,
    manifest: &'m Npm::PackageManifest,
    peer: &Dependency,
    row: DependencyID,
) -> Option<Npm::FindVersionResult<'m>> {
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let asks_too = |dep: &Dependency| {
        dep.name_hash == peer.name_hash
            && dep.behavior.is_peer()
            && !dep.behavior.is_optional_peer()
    };
    deps.iter().filter(|dep| asks_too(dep)).nth(1)?;

    let known = reachable::packages(
        lockfile,
        lockfile.buffers.resolutions.as_slice(),
        reachable::Options {
            peer: false,
            optional_peer: false,
            ..reachable::Options::all(0)
        },
    );
    let mut ranges: Vec<dependency::Version> = Vec::new();
    let mut row_counts = false;
    for (owner, list) in lockfile.packages.items_dependencies().iter().enumerate() {
        for id in (list.begin()..list.end()).filter(|_| known.is_set(owner)) {
            let dep = &deps[id as usize];
            if !asks_too(dep) {
                continue;
            }
            let Some(range) = crate::dedupe::effective_npm_range(lockfile, id, dep) else {
                continue;
            };
            if range.npm().is_alias {
                continue;
            }
            row_counts |= id == row;
            if !(ranges.iter()).any(|seen| seen.literal.eql(range.literal, buf, buf)) {
                ranges.push(range);
            }
        }
    }
    if !row_counts || ranges.len() < 2 {
        return None;
    }

    let mut best: Option<(Semver::Version, Npm::FindVersionResult<'m>)> = None;
    for range in &ranges {
        let found = manifest.find_for_dependency(
            range,
            buf,
            this.options.minimum_release_age_ms,
            this.options.minimum_release_age_excludes,
        );
        let version = match &found {
            Npm::FindVersionResult::Found(result)
            | Npm::FindVersionResult::FoundWithFilter { result, .. } => result.version,
            Npm::FindVersionResult::Err(_) => continue,
        };
        let versions = &manifest.string_buf;
        if (ranges.iter()).all(|range| range.npm().version.satisfies(version, buf, versions))
            && !best.as_ref().is_some_and(|(newest, _)| {
                version.order(*newest, versions, versions) != core::cmp::Ordering::Greater
            })
        {
            best = Some((version, found));
        }
    }
    best.map(|(_, found)| found)
}

/// `package_index` lists the highest version first.
fn highest_peer_candidate(
    lockfile: &Lockfile::Lockfile,
    name_hash: PackageNameHash,
    version: &dependency::Version,
) -> Option<PackageID> {
    let &highest = lockfile.packages_named(name_hash).first()?;
    let resolution = lockfile.packages.items_resolution().get(highest as usize)?;
    let same_kind = matches!(
        (resolution.tag, version.tag),
        (ResolutionTag::Npm, dependency::version::Tag::Npm)
            | (ResolutionTag::Git, dependency::version::Tag::Git)
            | (ResolutionTag::Github, dependency::version::Tag::Github)
    );
    same_kind.then_some(highest)
}

/// `package_id` is held only by non-root peer rows, usually this entry's own earlier install.
fn would_revive_leftover(
    lockfile: &Lockfile::Lockfile,
    row: DependencyID,
    package_id: PackageID,
) -> bool {
    if package_id >= lockfile.loaded_package_count || !lockfile.is_workspace_dependency(row) {
        return false;
    }
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    !(lockfile.packages.items_dependencies().iter().enumerate()).any(|(owner, list)| {
        (list.begin() as usize..list.end() as usize).any(|row| {
            resolutions[row] == package_id && (owner == 0 || !deps[row].behavior.is_peer())
        })
    })
}

impl PackageManager {
    /// False when every edge to it is optional. The root's edge to a workspace does not count.
    pub(crate) fn is_package_required(
        &self,
        dependency_id: DependencyID,
        package_id: PackageID,
    ) -> bool {
        let lockfile = &*self.lockfile;
        let dependencies = lockfile.buffers.dependencies.as_slice();
        let resolutions = lockfile.buffers.resolutions.as_slice();
        let is_optional = |id: usize| dependencies[id].behavior.contains(Behavior::OPTIONAL);
        if !is_optional(dependency_id as usize) {
            return true;
        }
        let features = self.options.local_package_features;
        let linked = reachable::packages(lockfile, resolutions, reachable::Options::install(self));
        // A peer needs the copy the tree serves it, unless `optionalDependencies` also has it.
        let names: Vec<PackageNameHash> = (resolutions.iter().zip(dependencies))
            .filter(|&(&resolved, _)| resolved == package_id)
            .map(|(_, dependency)| dependency.name_hash)
            .collect();
        let mut served: Option<Vec<(DependencyID, PackageID)>> = None;
        let mut lists = lockfile.packages.items_dependencies().iter().enumerate();
        lists.any(|(parent, slice)| {
            if !linked.is_set(parent) {
                return false;
            }
            let rows = slice.begin() as usize..slice.end() as usize;
            rows.clone().any(|id| {
                let behavior = dependencies[id].behavior;
                if is_optional(id) || behavior.is_workspace() || !behavior.is_placed(features) {
                    return false;
                }
                if !behavior.is_peer() {
                    return resolutions[id] == package_id;
                }
                let name_hash = dependencies[id].name_hash;
                let also_optional =
                    |row: usize| dependencies[row].name_hash == name_hash && is_optional(row);
                names.contains(&name_hash)
                    && !rows.clone().any(also_optional)
                    && served
                        .get_or_insert_with(|| crate::lockfile::tree::served_peers(lockfile))
                        .contains(&(id as DependencyID, package_id))
            })
        })
    }

    /// Reports the `Summary::offline_misses` the install cannot go on without; returns their count.
    #[cold]
    pub(crate) fn report_offline_misses(
        &self,
        misses: &crate::package_install::OfflineMisses,
        roots: &[PackageID],
        isolated: bool,
    ) -> Result<u32, bun_alloc::AllocError> {
        if misses.missing.is_empty() {
            return Ok(0);
        }
        let lockfile = &*self.lockfile;
        let mut missing = bun_collections::DynamicBitSet::init_empty(lockfile.packages.len())?;
        for &package_id in &misses.missing {
            missing.set(package_id as usize);
        }
        // A package with an installed copy is not left out: that copy needs its dependencies.
        let mut left_out = missing.clone()?;
        for &package_id in &misses.in_place {
            left_out.unset(package_id as usize);
        }
        // A peer needs the copy the linker serves it; what it is served elsewhere counts as needed.
        let mut resolutions = lockfile.buffers.resolutions.clone();
        for (resolved, dependency) in resolutions.iter_mut().zip(&lockfile.buffers.dependencies) {
            if dependency.behavior.is_peer() {
                *resolved = invalid_package_id;
            }
        }
        let mut roots = roots.to_vec();
        let served = if isolated {
            crate::isolated_install::served_peers(self, lockfile)?
        } else {
            crate::lockfile::tree::served_peers(lockfile)
        };
        for (dependency_id, package_id) in served {
            let resolved = &mut resolutions[dependency_id as usize];
            if *resolved == invalid_package_id {
                *resolved = package_id;
            } else {
                roots.push(package_id);
            }
        }
        let required = reachable::required_without(
            lockfile,
            &resolutions,
            &roots,
            reachable::Options::install(self),
            &left_out,
        );
        let mut reported = 0;
        for &package_id in &misses.missing {
            // once per package
            if !missing.is_set(package_id as usize) || !required.is_set(package_id as usize) {
                continue;
            }
            missing.unset(package_id as usize);
            reported += 1;
            let name = lockfile.str(&lockfile.packages.items_name()[package_id as usize]);
            self.log_mut().add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "--offline: \"{}\" is not in the cache",
                    bun_fmt::for_terminal(bstr::BStr::new(name))
                ),
            );
        }
        Ok(reported)
    }

    /// `served`: the peer rows of the layout a linker wrote and the copy each dependent loads.
    #[cold]
    #[inline(never)]
    pub(crate) fn warn_incorrect_peers(&self, served: &[(DependencyID, PackageID)]) {
        let lockfile: &Lockfile::Lockfile = &self.lockfile;
        let buf = lockfile.buffers.string_bytes.as_slice();
        let names = lockfile.packages.items_name();
        let resolutions = lockfile.packages.items_resolution();
        for &(row, copy) in served {
            let peer = &lockfile.buffers.dependencies[row as usize];
            if peer.behavior.is_optional_peer() {
                continue;
            }
            let (Some(range), Some(version)) = (
                crate::dedupe::effective_npm_range(lockfile, row, peer),
                lockfile.package_version(copy),
            ) else {
                continue;
            };
            if range.npm().version.satisfies(version, buf, buf)
                || links_workspace_member(self, row, peer, peer.name_hash)
            {
                continue;
            }
            let Some(dependent) = lockfile.get_parent_pkg_of_dependency(row) else {
                continue;
            };
            let dependent_resolution = bun_fmt::for_terminal(
                resolutions[dependent as usize].fmt(buf, bun_fmt::PathSep::Posix),
            );
            self.log_mut().add_warning_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "incorrect peer dependency \"{}@{}\": \"{}@{}\" requires \"{}@{}\"",
                    names[copy as usize].fmt(buf),
                    bun_fmt::for_terminal(
                        resolutions[copy as usize].fmt(buf, bun_fmt::PathSep::Posix)
                    ),
                    names[dependent as usize].fmt(buf),
                    // The root's resolution prints as nothing.
                    if dependent == 0 {
                        &"root" as &dyn core::fmt::Display
                    } else {
                        &dependent_resolution
                    },
                    peer.name.fmt(buf),
                    bun_fmt::escape_control_chars(range.literal.slice(buf)),
                ),
            );
        }
    }

    #[inline]
    pub fn enqueue_dependency_list(&mut self, dependencies_list: Lockfile::DependencySlice) {
        enqueue_dependency_list(self, dependencies_list)
    }
}
