use crate::lockfile::package::PackageColumns as _;
use bun_ptr::detach_lifetime;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use crate::bun_fs::FileSystem;
use bun_collections::DynamicBitSet;
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
use crate::package_manager_real::directories::{
    try_get_cache_directory, try_get_temporary_directory, try_global_link_dir,
};
use crate::package_manager_real::options::{Do, OfflineMode};
use crate::package_manager_real::process_dependency_list::ListedDependencies;
use crate::package_manager_real::{
    self, HeldAbout, PackageManager, RemoteTurn, SuccessFn, TaskCallbackList, Wanted,
    get_cache_directory, get_temporary_directory, run_tasks,
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
        // Read this after `success_fn`, which can change the packages array.
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

/// Makes a git, GitHub or tarball dependency wait for the task that fetches its package.
fn wait_for_remote_task(this: &mut PackageManager, task_id: Task::Id, waiter: TaskCallbackContext) {
    use TaskCallbackContext::Dependency as Row;
    let waiting = task_callback_list(this, task_id);
    // `request_remote_package_ahead` may have put the dependency on the list before its turn.
    let is_waiting = (waiting.iter())
        .any(|other| matches!((other, &waiter), (Row(other), Row(id)) if other == id));
    if !is_waiting {
        waiting.push(waiter);
    }
    if !this.remote_packages.tasks.contains(&task_id) {
        this.remote_packages.tasks.push(task_id);
    }
}

/// Returns false if `task_id` already had a list, which means the task was started earlier.
fn push_task_callback(
    this: &mut PackageManager,
    task_id: Task::Id,
    callback: TaskCallbackContext,
) -> bool {
    let entry = this.task_queue.get_or_put(task_id).expect("unreachable");
    entry.value_ptr.push(callback);
    !entry.found_existing
}

/// What `bind_row` did with a dependency.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Row {
    /// The dependency is resolved, or it cannot be and the reason is logged.
    Done,
    /// The dependency needs the manifest that this task is fetching, so it must be tried again.
    Waiting(Task::Id),
}

/// Resolves a dependency that the command wants resolved. With its manifest at hand that happens
/// right here, and the code that follows can rely on it. Otherwise a copy of `dependency` is
/// queued, and so is every later one: they are resolved in the order they were asked for.
pub fn enqueue_dependency_with_main(
    this: &mut PackageManager,
    id: DependencyID,
    // This must be a *const to prevent UB
    dependency: &Dependency,
    resolution: PackageID,
    install_peer: bool,
) -> crate::Result<()> {
    if !(this.lockfile.scratch.dependency_list_queue).has_commanded_rows() {
        let row = bind_row(
            this,
            id,
            dependency,
            resolution,
            install_peer,
            PackageManager::assign_resolution,
            false,
        )?;
        if row == Row::Done {
            return Ok(());
        }
    }
    (this.lockfile.scratch.dependency_list_queue).push_commanded(
        id,
        dependency.clone(),
        install_peer,
    )?;
    Ok(())
}

/// Returns a queued dependency in the form that it should be resolved in.
#[inline]
fn queued_row(this: &PackageManager, id: DependencyID, item: Lockfile::QueuedRows) -> &Dependency {
    let asked_as = if item.from_command {
        this.lockfile.scratch.dependency_list_queue.asked_as(id)
    } else {
        None
    };
    asked_as.unwrap_or(&this.lockfile.buffers.dependencies[id as usize])
}

pub fn enqueue_dependency_list(
    this: &mut PackageManager,
    dependencies_list: Lockfile::DependencySlice,
) {
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

/// Resolves the queued dependencies from the front of the queue, and stops at the first one whose
/// manifest has not arrived. `run_tasks` calls this again after every batch of finished tasks.
pub(crate) fn advance(this: &mut PackageManager) {
    // Trying the same dependency again is pointless until the task that it waits for has ended.
    if let Some(task_id) = this.lockfile.scratch.dependency_list_queue.waits_for
        && !this.look_ahead.arrived.contains(&task_id)
        && !this.manifest_failures.contains_key(&task_id)
    {
        request_ahead(this);
        return;
    }
    this.lockfile.scratch.dependency_list_queue.waits_for = None;

    loop {
        while let Some(head) = this.lockfile.scratch.dependency_list_queue.head() {
            for id in head.rows.begin()..head.rows.end() {
                let dependency = queued_row(this, id, head).clone();
                let resolution = this.lockfile.buffers.resolutions[id as usize];
                match bind_row(
                    this,
                    id,
                    &dependency,
                    resolution,
                    head.install_peer,
                    PackageManager::assign_resolution,
                    false,
                ) {
                    Ok(Row::Done) => {}
                    Ok(Row::Waiting(task_id)) => {
                        let queue = &mut this.lockfile.scratch.dependency_list_queue;
                        queue.finish_rows_before(head, id);
                        queue.waits_for = Some(task_id);
                        request_ahead(this);
                        return;
                    }
                    Err(err) if head.from_command => add_dependency_error(this, &dependency, err),
                    // It stays unresolved, which `verify_resolutions` reports if it matters.
                    Err(_) => {}
                }
            }
            (this.lockfile.scratch.dependency_list_queue).finish_rows_before(head, head.rows.end());
        }

        // The queue is empty, so it is the turn of the next git, GitHub or tarball package.
        if this.remote_packages.tasks.is_empty() {
            return;
        }
        if !this.append_next_remote_package(RemoteTurn::InOrder) {
            // While the queue waits for that package, the look-ahead goes on from the others.
            request_ahead(this);
            return;
        }
    }
}

/// Logs the error to `this.log`. The install fails later, when `has_errors()` is checked.
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
    if has_already_failed(this, task_id, dependency_id, package_id, &task_context) {
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
) -> Result<(), ForTarballError> {
    // `enqueue_local_tarball` copies `path` into the filename store before `string_bytes` can grow.
    let path = this.lockfile.str_detached(resolution.local_tarball());
    let task_id = Task::Id::for_tarball(path);
    if has_already_failed(this, task_id, dependency_id, package_id, &task_context) {
        return Err(ForTarballError::AlreadyFailed);
    }
    if !push_task_callback(this, task_id, task_context) {
        return Ok(());
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
    Ok(())
}

/// Returns `Err(Offline)` if the repository isn't cached. Nothing is queued then, and the caller
/// counts the package as failed or skipped.
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

/// An `--offline` miss is only returned to a linker and not logged, because `report_offline_misses`
/// evaluates all of them together.
fn is_asked_by_linker(context: &TaskCallbackContext) -> bool {
    matches!(
        context,
        TaskCallbackContext::DependencyInstallContext(_)
            | TaskCallbackContext::IsolatedPackageInstallContext(_)
    )
}

/// Returns true if `task_id` has failed, which means that nothing would answer a request for it.
fn has_already_failed(
    this: &mut PackageManager,
    task_id: Task::Id,
    dependency_id: DependencyID,
    package_id: PackageID,
    context: &TaskCallbackContext,
) -> bool {
    if !this.network_task_has_failed(task_id) {
        return false;
    }
    if is_asked_by_linker(context) {
        report_failed_download_as_required(this, task_id, dependency_id, package_id);
    }
    true
}

/// The download failed with only a warning, because only optional dependencies needed it at the
/// time. A linker that requires the package reports an error.
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

/// Reports the miss once, if the package is required. Doesn't register a task, because nothing
/// would ever complete it.
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

/// Returns true if the clone must not be enqueued, because `--offline` is set and the repository
/// isn't in the cache.
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
    if let Err(why) = try_get_cache_directory(this) {
        this.exit_or_log(&why);
        return DependencyToEnqueue::NotFound;
    }

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

        // The importing file can belong to any package, so no `npm:` alias is registered for this
        // import. The project's own aliases were registered when its package.json was parsed.
        let dep = dummy
            .clone_with_different_buffers(
                &mut crate::lockfile::override_map::NoAliases,
                name,
                version_buf,
                &mut builder,
            )
            .expect("unreachable");
        builder.clamp();
        let index = lf.dependencies.len();
        lf.dependencies.push(dep);
        lf.resolutions.push(invalid_package_id);
        debug_assert!(lf.dependencies.len() == lf.resolutions.len());
        break 'brk index;
    } as DependencyID;

    // If the project's package.json lists the peer's name, the peer resolves to what the project
    // asks for, whatever the peer's own range says. `bun install` does the same.
    let rows = this.lockfile.buffers.dependencies.as_slice();
    let dep_id = (this.lockfile.root_package())
        .filter(|_| rows[dep_id as usize].behavior.is_peer())
        .and_then(|root| {
            (root.dependencies.begin()..root.dependencies.end()).find(|&id| {
                let own = &rows[id as usize];
                own.name_hash == rows[dep_id as usize].name_hash
                    && !matches!(
                        own.version.tag,
                        dependency::version::Tag::Workspace
                            | dependency::version::Tag::Folder
                            | dependency::version::Tag::Symlink
                    )
            })
        })
        .unwrap_or(dep_id);

    // A peer would wait for the peer pass, which auto-install does not have, so it is resolved like
    // a regular dependency.
    let row = &mut this.lockfile.buffers.dependencies[dep_id as usize];
    if row.behavior.is_peer() {
        row.behavior = Behavior::PROD;
    }

    // A failed lookup is remembered until the next iteration of the event loop. A 404 is remembered
    // for as long as a manifest is cached.
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

        // Copy to the stack: `bind_row` can call `Package::from_npm`, which grows
        // `buffers.dependencies` and would invalidate a pointer taken directly into it.
        let dependency = this.lockfile.buffers.dependencies[dep_id as usize].clone();
        let (install_peer, is_root) = (false, true);
        if let Err(err) = bind_row(
            this,
            dep_id,
            &dependency,
            invalid_package_id,
            install_peer,
            PackageManager::assign_root_resolution,
            is_root,
        ) {
            return DependencyToEnqueue::Failure(err);
        }
    }

    // With a manifest from the disk cache, the dependency is resolved immediately and only the
    // tarball is queued.
    this.drain_dependency_list();

    let resolution_id = match this.lockfile.buffers.resolutions[dep_id as usize] {
        id if id == invalid_package_id || this.pending_task_count() > 0 => {
            if let Err(err) = wait_for_tasks(this) {
                return DependencyToEnqueue::Failure(err);
            }
            this.lockfile.buffers.resolutions[dep_id as usize]
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

/// Auto-install: an import needs an npm package that is resolved but not in the cache. It came
/// from the lockfile on disk and nothing has asked for its tarball, or its download failed.
pub fn download_missing_package(
    this: &mut PackageManager,
    package_id: PackageID,
) -> crate::Result<()> {
    let dependency_id = (this.lockfile.buffers).legacy_package_to_dependency_id(package_id)?;
    let package = *this.lockfile.packages.get(package_id as usize);
    let npm = *package.resolution.npm();
    let name = this.lockfile.str(&package.name).to_vec();
    let url = this.lockfile.str(&npm.url).to_vec();

    // A failed download is remembered for the rest of this turn of the event loop, like a failed
    // lookup. After that it is tried again.
    let task_id = Task::Id::for_npm_package(&name, npm.version);
    let turn = this.event_loop.iteration_number();
    if (this.network_dedupe_map.get(&task_id))
        .is_some_and(|entry| entry.failed && entry.missed_in != Some(turn))
    {
        let _ = this.network_dedupe_map.remove(&task_id);
    }

    enqueue_package_for_download(
        this,
        &name,
        dependency_id,
        package_id,
        npm.version,
        &url,
        TaskCallbackContext::RootRequestId(0),
    )?;
    wait_for_tasks(this)?;
    if this.network_task_has_failed(task_id) {
        return Err(crate::Error::TarballFailedToDownload);
    }
    Ok(())
}

/// Blocks the thread until no task is pending. The event loop does not run.
fn wait_for_tasks(this: &mut PackageManager) -> crate::Result<()> {
    if this.options.log_level.show_progress() {
        this.start_progress_bar_if_none();
    }
    Output::flush();

    let parked = crate::auto_installer::Parked::new();
    let result = loop {
        let wakes = parked.wakes();
        if this.pending_task_count() > 0 {
            let log_level = this.options.log_level;
            if let Err(err) =
                run_tasks::run_tasks::<VoidRunTasksCallbacks>(this, &mut (), false, log_level)
            {
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

    result
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

/// A git or tarball dependency only learns its name when it's extracted. With `overrides`, its tag
/// can differ from its task's tag.
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
    // How an earlier request for this manifest failed no longer matters.
    let _ = this.manifest_failures.remove(&task_id);
    // A list for the task, even an empty one, tells `run_tasks` that a dependency wants it.
    task_callback_list(this, task_id);

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
    let built = unsafe {
        (*network_task).for_manifest(
            name,
            scope,
            cached,
            is_optional,
            this.options.minimum_release_age_ms.is_some(),
        )
    };
    if let Err(err) = built {
        // `for_manifest` has logged why. The next dependency on this package must not wait for a
        // request that was never sent.
        let reported = package_manager_real::ManifestFailure::already_reported();
        let _ = this.manifest_failures.insert(task_id, reported);
        return Err(err.into());
    }
    enqueue_network_task(this, network_task);
    Ok(())
}

/// The cached manifest doesn't have the version a dependency needs, and a conditional request would
/// only confirm the stale copy with a 304. Sends one unconditional request per run. Returns true
/// while that request is in flight.
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
    if !this.options.log_level.is_verbose() {
        return;
    }
    this.log_mut().add_warning_fmt(
        None,
        bun_ast::Loc::EMPTY,
        format_args!(
            "\"latest\" tag of \"{}\" points to unpublished version, using {}",
            bun_fmt::escape_control_chars(manifest.name()),
            instead.version.fmt(&manifest.string_buf),
        ),
    );
}

/// Returns what bun.lock has for a git or tarball dependency in package.json whose name isn't known
/// yet.
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

/// Only a package.json read from the project may name a tarball in the project.
fn may_name_local_tarball(
    lockfile: &Lockfile::Lockfile,
    declarer: PackageID,
    dependency: &Dependency,
) -> bool {
    lockfile.is_local_declarer(declarer)
        || lockfile.has_equal_root_dependency(dependency)
        || lockfile.packages.items_resolution()[declarer as usize].tag
            == ResolutionTag::LocalTarball
}

/// Returns false for a dependency that never `refreshes_in_place`, whatever bun.lock has for it.
#[inline]
pub(crate) fn may_refresh_in_place(dependency: &Dependency) -> bool {
    use dependency::version::Tag;
    dependency.behavior.is_optional()
        && matches!(
            dependency.version.tag,
            Tag::Git | Tag::Github | Tag::Tarball
        )
}

/// Returns true if `dependency` of `declarer` keeps `locked` while this run reads its source again.
pub(crate) fn refreshes_in_place(
    this: &PackageManager,
    declarer: PackageID,
    dependency: &Dependency,
    locked: PackageID,
) -> bool {
    use dependency::version::Tag;
    if !may_refresh_in_place(dependency) {
        return false;
    }
    let lockfile = &*this.lockfile;
    let Some(locked_res) = lockfile.packages.items_resolution().get(locked as usize) else {
        return false;
    };
    let buf = lockfile.buffers.string_bytes.as_slice();
    // An older bun.lock binds a dependency that never resolved to any package of its name.
    let is_from_source = match dependency.version.tag {
        Tag::Github => {
            let asks = dependency.version.github();
            locked_res.tag == ResolutionTag::Github
                && locked_res.github().owner.eql(asks.owner, buf, buf)
                && locked_res.github().repo.eql(asks.repo, buf, buf)
        }
        Tag::Git => {
            let asks = dependency.version.git().repo.slice(buf);
            // bun.lock has `host:path` as a URL.
            let recorded = crate::repository_real::locked_scp_like(asks);
            locked_res.tag == ResolutionTag::Git
                && locked_res.git().repo.slice(buf) == recorded.as_deref().unwrap_or(asks)
        }
        _ => match &dependency.version.tarball().uri {
            dependency::tarball::Uri::Remote(url) => {
                locked_res.tag == ResolutionTag::RemoteTarball
                    && locked_res.remote_tarball().eql(*url, buf, buf)
            }
            dependency::tarball::Uri::Local(path) => {
                locked_res.tag == ResolutionTag::LocalTarball
                    && locked_res.local_tarball().eql(*path, buf, buf)
                    && may_name_local_tarball(lockfile, declarer, dependency)
            }
        },
    };
    let has_rule = |name_hash: PackageNameHash| {
        lockfile.overrides.has_rule_for_name(name_hash)
            || this
                .summary
                .overridden_names
                .binary_search(&name_hash)
                .is_ok()
    };
    is_from_source
        // A rule replaces what the dependency declares, and a changed rule can replace `locked`.
        && !has_rule(dependency.name_hash)
        && !has_rule(lockfile.packages.items_name_hash()[locked as usize])
        && unsafe_alias(lockfile, dependency).is_none()
}

/// Returns the `npm:` alias that the project declares for `name`, if any. A dependency of the root
/// package.json only follows an alias that the root package.json itself declares.
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

/// Like npm, a dependency shares the folder of a same-named alias only if its range accepts the
/// version that the alias resolves to. `Err`: the returned task is still fetching the manifest
/// that says which version that is.
fn takes_alias_target(
    this: &mut PackageManager,
    declared: &Semver::query::Group,
    aliased: &dependency::Version,
) -> Result<bool, Task::Id> {
    let lockfile = &*this.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let name = aliased.npm().name.slice(buf);
    let name_hash = Semver::string::Builder::string_hash(name);
    if links_workspace(this, name_hash, &aliased.npm().version) {
        return Ok(links_workspace(this, name_hash, declared));
    }
    if let Some(id) = lockfile.package_satisfying(name_hash, aliased, |_| true) {
        let bound = lockfile.packages.items_resolution()[id as usize]
            .npm()
            .version;
        return Ok(declared.satisfies(bound, buf, buf));
    }
    let name = name.to_vec();
    match prefetch_manifest(this, &name, name_hash, &|| None) {
        ManifestState::Ready => {}
        ManifestState::Requested(task_id) => return Err(task_id),
        // The dependency follows the alias, and then reports why the manifest cannot be read.
        ManifestState::Unavailable => return Ok(true),
    }
    let buf = this.lockfile.buffers.string_bytes.as_slice();
    let Some(manifest) = this.manifests.by_name_hash_in_memory(&name, name_hash) else {
        return Ok(true);
    };
    match manifest.find_for_dependency(
        aliased,
        buf,
        this.options.minimum_release_age_ms,
        this.options.minimum_release_age_excludes,
    ) {
        Npm::FindVersionResult::Err(Npm::FindVersionError::NotFound) => Ok(false),
        found => Ok((found.unwrap())
            .is_none_or(|found| declared.satisfies(found.version, buf, &manifest.string_buf))),
    }
}

/// Where `prefetch_manifest` left a manifest.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ManifestState {
    /// It is in `PackageManager::manifests` and can be read now.
    Ready,
    /// This task is fetching it.
    Requested(Task::Id),
    /// It is not in memory and no task will bring it.
    Unavailable,
}

/// Makes sure that the manifest of `name` is in memory or on its way, without resolving anything.
/// `exact` returns the version of a dependency that asks for exactly one.
fn prefetch_manifest(
    this: &mut PackageManager,
    name: &[u8],
    name_hash: PackageNameHash,
    exact: &dyn Fn() -> Option<Semver::Version>,
) -> ManifestState {
    let cache_ctx = this.manifest_disk_cache_ctx();
    let mut expired = false;
    let cached = this.manifests.by_name_hash_allow_expired(
        cache_ctx,
        this.options.scope_for_package_name(name),
        name,
        name_hash,
        Some(&mut expired),
        this.options.minimum_release_age_ms.is_some(),
    );
    let cached: Option<Npm::PackageManifest> = match cached {
        Some(_) if !expired => return ManifestState::Ready,
        // `bind_row` takes an exact version from an expired manifest without asking the registry.
        Some(manifest) => {
            if exact().is_some_and(|exact| manifest.find_by_version(exact).is_some()) {
                return ManifestState::Unavailable;
            }
            Some(manifest.clone())
        }
        None => None,
    };
    if this.options.offline == OfflineMode::Offline {
        return ManifestState::Unavailable;
    }

    let task_id = Task::Id::for_manifest(name);
    // Not required: only a dependency that is being resolved can say that the install needs it.
    if this.has_created_network_task(task_id, false) {
        return if this.manifest_failures.contains_key(&task_id) {
            ManifestState::Unavailable
        } else {
            ManifestState::Requested(task_id)
        };
    }
    if verbose_install() {
        bun_core::pretty_errorln!(
            "Enqueue package manifest for download: {}",
            bstr::BStr::new(name)
        );
    }
    let log_mark = this.log_mut().msgs.len();
    match enqueue_manifest_download(this, task_id, name, cached.as_ref(), true) {
        Ok(()) => ManifestState::Requested(task_id),
        // The dependency that needs the manifest makes the request again and reports the error.
        Err(_) => {
            drop(this.take_log_since(log_mark));
            let _ = this.manifest_failures.remove(&task_id);
            let _ = this.network_dedupe_map.remove(&task_id);
            ManifestState::Unavailable
        }
    }
}

/// Starts the downloads of the dependencies that are queued behind the one that `advance` stopped
/// at, so that they do not have to wait for their turn to ask. Nothing is resolved here.
#[cold]
#[inline(never)]
fn request_ahead(this: &mut PackageManager) {
    while let Some(item) = (this.lockfile.scratch.dependency_list_queue).next_unrequested() {
        for id in item.rows.begin()..item.rows.end() {
            request_row_ahead(this, id, item);
        }
    }
    // These are not queued yet: they are the next batch of the peer pass.
    while this.look_ahead.in_peer_pass
        && this.look_ahead.deferred_peers_seen < this.peer_dependencies.readable_length()
    {
        let id = (this.peer_dependencies).peek_item(this.look_ahead.deferred_peers_seen);
        this.look_ahead.deferred_peers_seen += 1;
        let item = Lockfile::QueuedRows {
            rows: Lockfile::DependencySlice::new(id, 1),
            install_peer: true,
            from_command: false,
        };
        request_row_ahead(this, id, item);
    }
    for task_id in core::mem::take(&mut this.look_ahead.arrived) {
        if let Some(wanted) = this.look_ahead.waiting.remove(&task_id) {
            look_ahead(this, wanted);
        }
    }
}

/// Requests what the row `id` of `item` will need when its turn comes, and looks ahead from it.
fn request_row_ahead(this: &mut PackageManager, id: DependencyID, item: Lockfile::QueuedRows) {
    let row = queued_row(this, id, item);
    // Most names come up many times, and one request serves all of them.
    if row.behavior.is_optional_peer()
        || (row.version.tag == dependency::version::Tag::Npm
            && !row.version.npm().is_alias
            && this.look_ahead.seen.contains_key(&row.name_hash))
    {
        return;
    }
    let dependency = row.clone();
    let mut replacement = None;
    let Ok(asked) = asked_version(this, id, &dependency, false, &mut replacement) else {
        return;
    };
    if unsafe_name(&this.lockfile, &dependency, &asked).is_some() {
        return;
    }
    // The rows of a package that the peer pass added are queued like any other package's. Its
    // peers are in the next batch, and all they wait for is their turn.
    let install_peer = item.install_peer || this.look_ahead.in_peer_pass;
    match asked.version.tag {
        // `Wanted` keeps the text of a range, and a range that a command made up has none. A tag
        // without text is what `bun add <name>` and `"name": ""` ask for, and it means `latest`.
        dependency::version::Tag::Npm if asked.version.literal.is_empty() => return,
        dependency::version::Tag::Npm | dependency::version::Tag::DistTag => {}
        dependency::version::Tag::Git
        | dependency::version::Tag::Github
        | dependency::version::Tag::Tarball => {
            return request_remote_package_ahead(this, id, item, &dependency, asked, install_peer);
        }
        dependency::version::Tag::Folder | dependency::version::Tag::Workspace => {
            return look_ahead_from_project_folder(this, id, asked);
        }
        _ => return,
    }
    let latest_for_target = picks_latest_tag(
        this,
        &dependency,
        id,
        asked.name_hash,
        asked.name,
        asked.version,
        asked.version_was_replaced,
    );
    let resolution = this.lockfile.buffers.resolutions[id as usize];
    let settled = settle_without_manifest(
        this,
        asked.name_hash,
        &dependency,
        asked.version,
        asked.version_was_replaced,
        id,
        resolution,
        install_peer,
        latest_for_target,
    );
    if settled.is_some() || this.look_ahead.seen.insert(asked.name_hash, ()).is_some() {
        return;
    }
    let buf = this.lockfile.buffers.string_bytes.as_slice();
    let wanted = Wanted::new(
        dependency.name.slice(buf),
        asked.version.literal.slice(buf),
        asked.name.slice(buf),
        asked.name_hash,
        install_peer,
    );
    look_ahead(this, wanted);
}

/// Starts the download of a git, GitHub or tarball dependency before its turn. The package waits
/// for its own turn once it is downloaded (`RemotePackages`), so nothing is resolved by this.
fn request_remote_package_ahead(
    this: &mut PackageManager,
    id: DependencyID,
    item: Lockfile::QueuedRows,
    dependency: &Dependency,
    asked: Asked<'_>,
    install_peer: bool,
) {
    let resolution = this.lockfile.buffers.resolutions[id as usize];
    let is_local_tarball = asked.version.tag == dependency::version::Tag::Tarball
        && matches!(
            asked.version.tarball().uri,
            dependency::tarball::Uri::Local(_)
        );
    if !this.lockfile.awaits_resolve(id)
        || this.options.runtime_auto_install
        // A deferred peer doesn't request anything, because the tree may provide it.
        || (dependency.behavior.is_peer() && !install_peer)
        // Whether another package may refer to a tarball in the project is decided and reported
        // when the dependency is resolved.
        || (is_local_tarball && !this.lockfile.is_dependency_of_local_package(id))
    {
        return;
    }
    let started = bind_row_without_manifest(
        this,
        id,
        dependency,
        resolution,
        install_peer,
        PackageManager::assign_resolution,
        false,
        asked,
    );
    // The task is on record now, so the dependency does not run into the same error at its turn.
    if let Err(err) = started
        && item.from_command
    {
        add_dependency_error(this, dependency, err);
    }
}

/// Looks ahead from what a `file:` or `workspace:` folder of the project depends on. Resolving the
/// folder needs no download, but it has to wait for its turn like any other dependency.
fn look_ahead_from_project_folder(this: &mut PackageManager, id: DependencyID, asked: Asked<'_>) {
    // What the `file:` folder of another package depends on is not resolved. A dependency that
    // bun.lock has resolved is done when its turn comes, and its folder is not read then either.
    if !this.lockfile.is_workspace_dependency(id)
        || this.lockfile.buffers.resolutions[id as usize] != invalid_package_id
    {
        return;
    }
    let path = match asked.version.tag {
        dependency::version::Tag::Workspace => (this.lockfile.workspace_paths)
            .get(&asked.name_hash)
            .copied()
            .unwrap_or_else(|| *asked.version.workspace()),
        _ => *asked.version.folder(),
    };
    let path = this.lockfile.str_detached(&path);
    let mut buf = bun_paths::path_buffer_pool::get();
    let Some(abs) = project_path(path, &mut buf[..]) else {
        return;
    };
    if let Some(listed) = FolderResolution::listed_dependencies(asked.version.tag, abs, this) {
        let locked = names_locked_for_folder(this, &listed);
        look_ahead_from(this, &listed, &locked);
    }
}

/// The dependencies in `listed`, by name, that keep the version that bun.lock has for them. When the
/// package.json of a folder that bun.lock has is read again, `Diff::keep_resolutions` leaves a
/// dependency on its version if its range is unchanged or still accepts that version, and that
/// takes no manifest.
fn names_locked_for_folder(
    this: &PackageManager,
    listed: &ListedDependencies,
) -> Vec<PackageNameHash> {
    use crate::lockfile_real::package::Diff;
    use crate::resolution::Tag;
    let lockfile = &*this.lockfile;
    if this.to_update {
        return Vec::new();
    }
    let resolutions = lockfile.packages.items_resolution();
    let lists = lockfile.packages.items_dependencies();
    let locked_rows: Vec<usize> = (lockfile.packages_named(listed.package.name_hash).iter())
        .filter(|&&id| {
            id < lockfile.loaded_package_count
                && matches!(resolutions[id as usize].tag, Tag::Workspace | Tag::Folder)
        })
        .flat_map(|&id| lists[id as usize].begin() as usize..lists[id as usize].end() as usize)
        .filter(|&row| lockfile.buffers.resolutions[row] != invalid_package_id)
        .collect();
    let buf = lockfile.buffers.string_bytes.as_slice();
    let listed_buf = listed.lockfile.buffers.string_bytes.as_slice();
    (listed.package.dependencies)
        .get(listed.lockfile.buffers.dependencies.as_slice())
        .iter()
        .filter(|dependency| {
            locked_rows.iter().any(|&row| {
                let locked = &lockfile.buffers.dependencies[row];
                locked.name_hash == dependency.name_hash
                    && (locked.version.literal.slice(buf)
                        == dependency.version.literal.slice(listed_buf)
                        || Diff::locked_version_satisfies(
                            lockfile,
                            lockfile.buffers.resolutions[row],
                            dependency,
                            listed_buf,
                        ))
            })
        })
        .map(|dependency| dependency.name_hash)
        .collect()
}

impl Wanted {
    fn new(
        alias: &[u8],
        range: &[u8],
        name: &[u8],
        name_hash: PackageNameHash,
        follows_peers: bool,
    ) -> Wanted {
        Wanted {
            text: [alias, range, name].concat().into(),
            alias_len: alias.len(),
            range_len: range.len(),
            name_hash,
            follows_peers,
        }
    }

    /// The name that the registry knows the package by.
    fn name(&self) -> &[u8] {
        &self.text[self.alias_len + self.range_len..]
    }

    /// The strings of the returned version are in `self.text`.
    fn version(&self) -> Option<dependency::Version> {
        let (alias, rest) = self.text.split_at(self.alias_len);
        let range = &rest[..self.range_len];
        dependency::parse_with_tag(
            SemverString::init(&self.text, alias),
            None,
            range,
            dependency::version::Tag::infer(dependency::trim_literal(range)),
            &Semver::SlicedString::init(&self.text, range),
            None,
            None,
        )
    }
}

/// Requests the manifest of `first`. Once that is in memory, guesses which version `first` will
/// resolve to, and does the same for everything that version depends on. See `LookAhead`.
fn look_ahead(this: &mut PackageManager, first: Wanted) {
    let mut stack = vec![first];
    while let Some(wanted) = stack.pop() {
        let exact = || wanted.version()?.try_npm()?.version.get_exact_version();
        match prefetch_manifest(this, wanted.name(), wanted.name_hash, &exact) {
            ManifestState::Ready => follow_likely_version(this, &wanted, &mut stack),
            ManifestState::Requested(task_id) => {
                let _ = this.look_ahead.waiting.insert(task_id, wanted);
            }
            ManifestState::Unavailable => {}
        }
    }
}

/// Pushes what the version that `wanted` most likely resolves to depends on, except for the
/// packages that were looked at before. The manifest of `wanted` is in memory.
fn follow_likely_version(this: &mut PackageManager, wanted: &Wanted, stack: &mut Vec<Wanted>) {
    use dependency::version::Tag;
    let name_hash = wanted.name_hash;
    let Some(version) = wanted.version() else {
        return;
    };
    let has_patches = has_patched_versions(this);

    // If the lockfile has a version that the range accepts, the dependency most likely shares it,
    // and what that version depends on is queued already.
    let lockfile = &*this.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let resolutions = lockfile.packages.items_resolution();
    if version.tag == Tag::Npm
        && lockfile.packages_named(name_hash).iter().any(|&id| {
            let existing = &resolutions[id as usize];
            existing.tag == ResolutionTag::Npm
                && (version.npm().version).satisfies(existing.npm().version, &wanted.text, buf)
        })
    {
        return;
    }

    let Some(manifest) = (this.manifests).by_name_hash_in_memory(wanted.name(), name_hash) else {
        return;
    };
    let Some(found) = manifest
        .find_for_dependency(
            &version,
            &wanted.text,
            this.options.minimum_release_age_ms,
            this.options.minimum_release_age_excludes,
        )
        .unwrap()
    else {
        return;
    };
    let patched = if has_patches {
        let patched = this.patched_versions.as_deref().unwrap_or_default();
        patched_version_in_range(patched, manifest, &version, &wanted.text)
    } else {
        None
    };
    let package = patched.unwrap_or(found).package;
    if !manifest.is_in_bounds(package) || package.all_dependencies_bundled() {
        return;
    }

    let bundled = package.bundled_dependencies.get(&manifest.bundled_deps_buf);
    let mut follow = Follow {
        lockfile,
        known_npm_aliases: &this.known_npm_aliases,
        look_ahead: &mut this.look_ahead,
        follows_peers: wanted.follows_peers,
    };
    // Only the first entry of a name is followed. An optional dependency goes first because it
    // replaces a dependency of the same name.
    for (group, is_peer) in [
        (package.optional_dependencies, false),
        (package.dependencies, false),
        (package.peer_dependencies, true),
    ] {
        // Before the peer pass nobody can tell whether the tree will provide a peer.
        if is_peer && !wanted.follows_peers {
            break;
        }
        let optional_peers = if is_peer {
            package.non_optional_peer_dependencies_start as usize
        } else {
            0
        };
        let names = group.name.get(&manifest.external_strings);
        let ranges = group.value.get(&manifest.external_strings_for_versions);
        for (alias, range) in names.iter().zip(ranges).skip(optional_peers) {
            // A bundled dependency comes in the tarball of its parent.
            if bundled.contains(&alias.hash) {
                continue;
            }
            let range = range.slice(&manifest.string_buf);
            let name = alias.slice(&manifest.string_buf);
            stack.extend(follow.dependency(name, alias.hash, range, is_peer));
        }
    }
}

/// Decides which of the dependencies that a package lists `look_ahead` follows.
struct Follow<'a> {
    lockfile: &'a Lockfile::Lockfile,
    known_npm_aliases: &'a package_manager_real::NpmAliasMap,
    look_ahead: &'a mut package_manager_real::LookAhead,
    /// See `Wanted::follows_peers`.
    follows_peers: bool,
}

impl Follow<'_> {
    /// Returns the dependency `alias@range` if it is worth following, and then marks its package
    /// as looked at.
    fn dependency(
        &mut self,
        alias: &[u8],
        alias_hash: PackageNameHash,
        range: &[u8],
        is_peer: bool,
    ) -> Option<Wanted> {
        use crate::package_installer::alias_is_safe_install_target as is_safe_name;
        use dependency::version::Tag;
        let lockfile = self.lockfile;
        let buf = lockfile.buffers.string_bytes.as_slice();
        let is_npm_alias = dependency::trim_literal(range).starts_with(b"npm:");
        if !is_npm_alias && self.look_ahead.seen.contains_key(&alias_hash) {
            return None;
        }
        // A name that the project aliases, overrides or has a workspace for is left to the queued
        // dependency, because those rules depend on which package the dependency belongs to.
        if self.known_npm_aliases.contains_key(&alias_hash)
            || lockfile.workspace_paths.contains(&alias_hash)
            || lockfile.overrides.contains_name(alias_hash, alias, buf)
            // The running runtime is the `bun` that a package asks for.
            || (is_peer && (alias == b"bun" || !lockfile.packages_named(alias_hash).is_empty()))
        {
            return None;
        }
        let follows_peers = self.follows_peers;
        let next = if is_npm_alias {
            // Only the parser knows where the name in `npm:name@range` ends.
            let unnamed = Wanted::new(alias, range, b"", 0, follows_peers);
            let version = unnamed.version()?;
            let name = match version.tag {
                Tag::Npm => version.npm().name.slice(&unnamed.text),
                Tag::DistTag => version.dist_tag().name.slice(&unnamed.text),
                _ => return None,
            };
            let name_hash = Semver::string::Builder::string_hash(name);
            Wanted::new(alias, range, name, name_hash, follows_peers)
        } else if Tag::infer(dependency::trim_literal(range)).is_npm() {
            Wanted::new(alias, range, alias, alias_hash, follows_peers)
        } else {
            // Only the registry is asked on a guess, never a git host or a tarball's server.
            return None;
        };
        // The name comes from somebody else's package, so it is checked as `unsafe_name` does.
        let is_new = is_safe_name(next.name())
            && (self.look_ahead.seen.insert(next.name_hash, ())).is_none();
        is_new.then_some(next)
    }
}

/// Looks ahead from what a package that waits for its turn depends on, except for the names in
/// `locked`.
#[cold]
pub(crate) fn look_ahead_from(
    this: &mut PackageManager,
    listed: &ListedDependencies,
    locked: &[PackageNameHash],
) {
    let follows_peers = this.look_ahead.in_peer_pass;
    let lockfile = &*this.lockfile;
    let buf = listed.lockfile.buffers.string_bytes.as_slice();
    let rows = (listed.package.dependencies).get(listed.lockfile.buffers.dependencies.as_slice());
    let mut follow = Follow {
        lockfile,
        known_npm_aliases: &this.known_npm_aliases,
        look_ahead: &mut this.look_ahead,
        follows_peers,
    };
    let wanted: Vec<Wanted> = rows
        .iter()
        .filter(|row| {
            !row.behavior.is_bundled()
                && !row.behavior.is_optional_peer()
                && (follows_peers || !row.behavior.is_peer())
                && !locked.contains(&row.name_hash)
        })
        .filter_map(|row| {
            follow.dependency(
                row.name.slice(buf),
                row.name_hash,
                row.version.literal.slice(buf),
                row.behavior.is_peer(),
            )
        })
        .collect();
    for wanted in wanted {
        look_ahead(this, wanted);
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
    (this.lockfile.scratch.dependency_list_queue).push(Lockfile::QueuedRows {
        rows: package.dependencies,
        install_peer: false,
        from_command: false,
    })?;
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
/// What a dependency asks for once the project's `npm:` aliases, `overrides` and catalogs apply.
#[derive(Clone, Copy)]
struct Asked<'a> {
    name: SemverString,
    name_hash: PackageNameHash,
    version: &'a dependency::Version,
    /// One of those three replaced the version that the dependency declares.
    version_was_replaced: bool,
}

/// `replacement` is where the caller keeps the version if one of the three replaces the declared
/// one. Most dependencies keep theirs, and a version is too big to copy for each of them.
/// `Err`: the answer depends on a manifest that the returned task is still fetching.
#[inline(always)]
fn asked_version<'a>(
    this: &mut PackageManager,
    id: DependencyID,
    dependency: &'a Dependency,
    is_root: bool,
    replacement: &'a mut Option<dependency::Version>,
) -> Result<Asked<'a>, Task::Id> {
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

    'replaced: {
        // Only a plain dependency follows a same-named `npm:` alias of the project.
        if dependency.version.tag == dependency::version::Tag::Npm
            && !dependency.version.npm().is_alias
            && !this.known_npm_aliases.is_empty()
        {
            if let Some(aliased) = followed_npm_alias(this, id, is_root, name, name_hash) {
                let group = &dependency.version.npm().version;
                let buf = this.lockfile.buffers.string_bytes.as_slice();
                // SAFETY: `aliased` is always tag == Npm (`followed_npm_alias` returns no other).
                let alias_group = &aliased.npm().version;
                // The bounds guess where the alias resolves. A peer is not held to its range.
                if (dependency.behavior.is_peer() || group.intersects(buf, alias_group, buf))
                    && group.is_satisfied_by_a_bound_of(buf, alias_group, buf)
                    // A rule for this dependency wins over the alias.
                    && (dependency.behavior.is_workspace()
                        || (this.lockfile.overrides)
                            .lookup(&this.lockfile, id, name_hash)
                            .is_none())
                    && (dependency.behavior.is_peer()
                        || group.is_star()
                        || takes_alias_target(this, group, &aliased)?)
                {
                    name = aliased.npm().name;
                    name_hash = Semver::string::Builder::string_hash(this.lockfile.str(&name));
                    *replacement = Some(aliased);
                    break 'replaced;
                }

                // It has the alias's name but doesn't accept its version, so it's a normal npm
                // dependency that overrides can apply to.
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
            let rule = (this.lockfile.overrides)
                .lookup_declared(&this.lockfile, id, rule_name_hash, &dependency.version)
                .map(|rule| rule.dep())
                // Auto-install only follows an override that points to the registry. Others, such
                // as `file:`, are ignored.
                .filter(|rule| {
                    !this.options.runtime_auto_install
                        || matches!(
                            rule.version.tag,
                            dependency::version::Tag::Npm
                                | dependency::version::Tag::DistTag
                                | dependency::version::Tag::Catalog
                        )
                });
            if let Some(rule) = rule {
                bun_output::scoped_log!(
                    PackageManager,
                    "override: {} -> {}",
                    bstr::BStr::new(this.lockfile.str(&dependency.version.literal)),
                    bstr::BStr::new(this.lockfile.str(&rule.version.literal))
                );

                // The value is read under the name in the key, like a dependency of that name.
                (name, name_hash) = update_name_and_name_hash_from_version_replacement(
                    &this.lockfile,
                    rule.name,
                    rule.name_hash,
                    &rule.version,
                );
            }

            let declared = rule.map_or(&dependency.version, |rule| &rule.version);
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
                    *replacement = Some(v);
                    break 'replaced;
                }
            }

            if let Some(rule) = rule {
                *replacement = Some(rule.version.clone());
            }
        }
    }
    let replacement: &'a Option<dependency::Version> = replacement;
    Ok(Asked {
        name,
        name_hash,
        version: replacement.as_ref().unwrap_or(&dependency.version),
        version_was_replaced: replacement.is_some(),
    })
}

/// The alias (a future folder) or the registry name of a dependency, if it is unsafe. Such a
/// dependency is refused before anything is fetched for it or printed about it.
#[inline(always)]
fn unsafe_name<'a>(
    lockfile: &'a Lockfile::Lockfile,
    dependency: &'a Dependency,
    asked: &'a Asked<'_>,
) -> Option<&'a [u8]> {
    if let Some(alias) = unsafe_alias(lockfile, dependency) {
        return Some(alias);
    }
    let registry_name: Option<&[u8]> = match asked.version.tag {
        dependency::version::Tag::Npm | dependency::version::Tag::DistTag => {
            Some(lockfile.str(&asked.name))
        }
        _ => None,
    };
    // A name like `""`, `@1.0.0` or `@scope/` (from an older lockfile or an override) would request
    // `/` or `/@1.0.0`.
    registry_name.filter(|name| !crate::package_installer::alias_is_safe_install_target(name))
}

/// The alias of a dependency, which is a future folder, if it is unsafe.
#[inline(always)]
fn unsafe_alias<'a>(
    lockfile: &'a Lockfile::Lockfile,
    dependency: &'a Dependency,
) -> Option<&'a [u8]> {
    let alias = lockfile.str(&dependency.name);
    let alias_is_safe = if alias == lockfile.str(&dependency.version.literal) {
        // Until `assign_resolution` runs, the alias of `bun add <specifier>` is the specifier
        // itself. It never becomes a folder name, but it is printed.
        !dependency::contains_control_character(alias)
    } else {
        alias.is_empty() || crate::package_installer::alias_is_safe_install_target(alias)
    };
    (!alias_is_safe).then_some(alias)
}

/// Resolves one dependency: binds it to a package that the lockfile has, or appends the package.
pub(crate) fn bind_row(
    this: &mut PackageManager,
    id: DependencyID,
    // This must be a *const to prevent UB
    dependency: &Dependency,
    resolution: PackageID,
    install_peer: bool,
    success_fn: SuccessFn,
    // Auto-install: resolution errors go to `this.log` instead of propagating.
    is_root: bool,
) -> crate::Result<Row> {
    if dependency.behavior.is_optional_peer() {
        return Ok(Row::Done);
    }

    // `advance` tries a queued dependency again. An import of the runtime is not queued, so it is
    // tried again when the task that it waits for finishes. The task's list is created in both
    // cases, because without one `run_tasks` takes the task for one that no dependency wants.
    let wait_for = |this: &mut PackageManager, task_id: Task::Id| {
        let waiting = task_callback_list(this, task_id);
        if is_root {
            waiting.push(TaskCallbackContext::RootDependency(id));
        }
        Row::Waiting(task_id)
    };

    let mut replacement = None;
    let asked = match asked_version(this, id, dependency, is_root, &mut replacement) {
        Ok(asked) => asked,
        Err(task_id) => return Ok(wait_for(this, task_id)),
    };
    if let Some(invalid_name) = unsafe_name(&this.lockfile, dependency, &asked) {
        let name = bun_fmt::for_terminal(bstr::BStr::new(invalid_name));
        add_error_or_warning(
            this.log_mut(),
            dependency.behavior.is_required(),
            format_args!("invalid dependency name \"{name}\""),
        );
        return Ok(Row::Done);
    }

    let Asked {
        name,
        name_hash,
        version,
        version_was_replaced,
    } = asked;
    // A rule for the name that its source has now replaces what the dependency asks for.
    let resolution = if version_was_replaced && this.lockfile.is_refreshing(id) {
        this.lockfile.unbind_refreshing(id);
        invalid_package_id
    } else {
        resolution
    };
    let mut loaded_manifest: Option<Npm::PackageManifest> = None;

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
                    version,
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
                            let log_mark = this.log_mut().msgs.len();
                            report_resolve_error(
                                this, id, dependency, name, version, err, is_root,
                            )?;
                            // The manifest is loaded and doesn't have that version.
                            if version.tag.is_npm() {
                                this.hold_log_since(log_mark, id);
                            }
                            return Ok(Row::Done);
                        }
                    };

                    if let Some(result) = resolve_result {
                        if result.is_first_time {
                            on_first_resolution(this, version, &result.package)?;
                        }
                        if let Some(task) = result.task {
                            enqueue_resolved_task(this, result.package.meta.id, task);
                        }
                        return Ok(Row::Done);
                    }
                    if !version.tag.is_npm() {
                        return Ok(Row::Done);
                    }

                    if dependency.behavior.is_peer() && !install_peer {
                        this.peer_dependencies.write_item(id)?;
                        return Ok(Row::Done);
                    }

                    // Before `this_ptr`: a `&mut *this_ptr` later would invalidate `scope`.
                    let cache_ctx = this.manifest_disk_cache_ctx();
                    let this_ptr: *mut PackageManager = this;
                    // Owned: resolving can reallocate `string_bytes`, and this is read afterwards.
                    let name_str: Vec<u8> = this.lockfile.str(&name).to_vec();
                    let task_id = Task::Id::for_manifest(&name_str);

                    debug_assert!(task_id.get() != 0);

                    if this.has_created_network_task(task_id, dependency.behavior.is_required()) {
                        if this.manifest_failures.contains_key(&task_id) {
                            report_manifest_failure(this, task_id, id, dependency, &name_str);
                            return Ok(Row::Done);
                        }
                        // The code that marked the task as failed also reported why, like
                        // `--offline` does.
                        if this.network_task_has_failed(task_id) {
                            return Ok(Row::Done);
                        }
                        return Ok(wait_for(this, task_id));
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
                                    version,
                                    version_was_replaced,
                                )
                                && let Some(find_result) = manifest.find_by_version(exact)
                                && manifest.is_in_bounds(find_result.package)
                            {
                                if let Some(min_age_ms) = this.options.minimum_release_age_ms
                                    && !manifest.should_exclude_from_age_filter(excludes)
                                    && manifest.is_version_blocked_by_age_filter(
                                        find_result,
                                        min_age_ms,
                                        excludes,
                                    )
                                    // The gate is for new resolutions, not for pinned ones.
                                    && locked_version_in_lockfile(this, name_hash, version)
                                        .is_none()
                                {
                                    // Report it the same way as for a fresh manifest.
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
                                        version,
                                        false,
                                        id,
                                        dependency.behavior,
                                        manifest,
                                        find_result,
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

                            // The offline modes treat every cached manifest as fresh. In that case
                            // `expired` means the full manifest is needed.
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
                        // An optional dependency releases the reservation, so that a required
                        // dependency that comes later still reports the error.
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
                        return Ok(Row::Done);
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
                    return Ok(wait_for(this, task_id));
                }
            }
        }
        _ => {
            bind_row_without_manifest(
                this,
                id,
                dependency,
                resolution,
                install_peer,
                success_fn,
                is_root,
                asked,
            )?;
            Ok(Row::Done)
        }
    }
}

/// Resolves a git, GitHub, tarball, `link:` or `workspace:` dependency. One that has to be
/// downloaded does not keep the queue waiting: `append_next_remote_package` resolves it later.
fn bind_row_without_manifest(
    this: &mut PackageManager,
    id: DependencyID,
    dependency: &Dependency,
    resolution: PackageID,
    install_peer: bool,
    success_fn: SuccessFn,
    is_root: bool,
    asked: Asked<'_>,
) -> crate::Result<()> {
    let Asked {
        name,
        name_hash,
        version,
        version_was_replaced,
    } = asked;
    let waiter = || {
        if is_root {
            TaskCallbackContext::RootDependency(id)
        } else {
            TaskCallbackContext::Dependency(id)
        }
    };

    match version.tag {
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
                // An import needs it.
                if is_root {
                    let buf = this.lockfile.buffers.string_bytes.as_slice();
                    this.log_mut().add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "\"{}@{}\" is a git dependency, run `bun install`",
                            bun_fmt::escape_control_chars(dependency.name.slice(buf)),
                            bun_fmt::for_terminal(bstr::BStr::new(version.literal.slice(buf))),
                        ),
                    );
                }
                return Ok(());
            }

            // The enqueue callees copy these into the filename store before `string_bytes` grows.
            let alias = this.lockfile.str_detached(&dependency.name);
            let url = this.lockfile.str_detached(&dep.repo);
            let clone_id = Task::Id::for_git_clone(url);

            if let Some(repo_fd) = this.git_repositories.get(&clone_id).copied() {
                let needs_ctx = this.lockfile.awaits_resolve(id);

                // Waits on a `git log` task; `run_tasks` fills `git_commits` and re-enters here.
                let committish = this.lockfile.str_detached(&dep.committish);
                let commit_id = Task::Id::for_git_commit(url, committish);
                let resolved = match this.git_commits.get(&commit_id) {
                    Some(resolved) => resolved.clone(),
                    None => {
                        wait_for_remote_task(this, commit_id, waiter());

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

                task_callback_list(this, checkout_id);
                if needs_ctx {
                    wait_for_remote_task(this, checkout_id, waiter());
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
                wait_for_remote_task(this, clone_id, waiter());

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

            // The same trust rule as in the `file:` arm of `get_or_put_resolved_package`.
            let is_link_path = dependency_tag == dependency::version::Tag::Symlink
                && dependency::is_link_path(this.lockfile.str(version.symlink()));
            if is_link_path && !this.lockfile.is_trusted_folder_dependency(id) {
                if dependency.behavior.is_required() {
                    reject_link_path_of_remote_package(this, id, dependency, version);
                }
                return Ok(());
            }

            let _result = match get_or_put_resolved_package(
                this,
                name_hash,
                name,
                dependency,
                version,
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
                    on_first_resolution(this, version, &result.package)?;
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
                        "directory \"{}\" not found for linked dependency \"{}\"",
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
                        version: version.clone(),
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
            if res.tag == ResolutionTag::LocalTarball
                && !version_was_replaced
                && let Some(declarer) = this.lockfile.get_parent_pkg_of_dependency(id)
                && !may_name_local_tarball(&this.lockfile, declarer, dependency)
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

            if this.lockfile.awaits_resolve(id) {
                if let Some(pkg_id) = resolve_from_appended_task(this, task_id, id) {
                    success_fn(this, id, pkg_id);
                    return Ok(());
                }
            }

            wait_for_remote_task(this, task_id, waiter());

            if dependency.behavior.is_peer() && !install_peer {
                this.peer_dependencies.write_item(id)?;
                return Ok(());
            }

            if res.tag == ResolutionTag::LocalTarball {
                if let Err(why) = try_get_temporary_directory(this) {
                    this.exit_or_log(&why);
                    return Ok(());
                }
                if !this.has_created_network_task(task_id, dependency.behavior.is_required()) {
                    let dep_name = this.lockfile.str_detached(&dependency.name);
                    let task = enqueue_local_tarball(this, task_id, id, dep_name, url, &res, None);
                    this.task_batch.push(ThreadPool::Batch::from(task));
                }
                return Ok(());
            }

            // Convert to `*mut` right away, so the borrow of `this` ends before
            // `enqueue_network_task` reborrows it.
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
                    // An `--offline` miss. It was already reported if required, or skipped if
                    // optional.
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

/// `dependency` needs a manifest whose request failed. Logs the failure, unless a dependency that
/// needed the manifest earlier has logged it already.
#[cold]
fn report_manifest_failure(
    this: &mut PackageManager,
    task_id: Task::Id,
    id: DependencyID,
    dependency: &Dependency,
    name: &[u8],
) {
    use bun_ast::Kind;
    use package_manager_real::FailureReport as Report;
    // `log_held` and `fail_update_requests` read this list to see who needs the manifest.
    task_callback_list(this, task_id).push(TaskCallbackContext::Dependency(id));
    let is_of_project = this.lockfile.is_workspace_dependency(id);
    let can_hold = this.held_messages.is_some();
    let Some(failure) = this.manifest_failures.get_mut(&task_id) else {
        return;
    };
    // A peer that finds the failure already reported stays unbound, which is not an error.
    let fails_install = !failure.spares_optional
        || (dependency.behavior.is_required()
            && (!dependency.behavior.is_peer() || failure.reported == Report::NotYet));
    let kind = if fails_install { Kind::Err } else { Kind::Warn };
    let is_unanswered = failure.is_unanswered && fails_install;
    // Dedupe may still drop a dependency of a package, but never one of the project. Only "there is
    // no such package" is held back for that. A request that got no response doesn't say anything
    // about the package.
    let holds = failure.is_missing && can_hold && !(fails_install && is_of_project);
    let before = failure.reported;
    failure.reported = match (before, kind) {
        (Report::Errored, _) | (Report::Warned | Report::Held, Kind::Warn) => before,
        (Report::NotYet | Report::Held, _) if holds => Report::Held,
        (_, Kind::Err) => Report::Errored,
        _ => Report::Warned,
    };
    let after = failure.reported;
    let mut msgs: Vec<bun_ast::Msg> = failure.msgs.iter().map(bun_ast::Msg::clone).collect();

    if after != Report::Held {
        if after != before && !(before == Report::Warned && this.raise_copies_to_errors(&msgs)) {
            this.log_copies(&msgs, kind);
        }
    } else if let Some(held) = &mut this.held_messages {
        if before == Report::NotYet {
            msgs.iter_mut().for_each(|msg| msg.kind = kind);
            held.push((HeldAbout::Task(task_id), msgs));
        } else if kind == Kind::Err {
            // A held warning becomes an error as soon as a dependency that requires the package
            // comes up.
            (held.iter_mut())
                .filter(|(about, _)| matches!(about, HeldAbout::Task(held) if *held == task_id))
                .flat_map(|(_, msgs)| msgs.iter_mut())
                .for_each(|msg| msg.kind = kind);
        }
    }
    run_tasks::fail_update_requests(this, task_id, name, None, is_unanswered);
}

/// Logs why `get_or_put_resolved_package` failed. The caller has to report an `Err` itself.
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
            // `update_transitive::reresolve` passes a copy of a peer without its peer bit.
            if dependency.behavior.is_peer()
                || this.lockfile.buffers.dependencies[id as usize]
                    .behavior
                    .is_peer()
            {
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
                    "package.json not found for \"file:{}\" dependency \"{name}\"",
                    escape(version.folder().slice(buf)),
                ),
            ),
        E::MissingPackageJSON => log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!("package.json not found for dependency \"{name}\""),
        ),
        _ => log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!("{} while resolving package \"{name}\"", err.name()),
        ),
    }
    Ok(())
}

/// An unmet peer stays unresolved instead of failing the install. See `may_stay_unresolved`.
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
    // A bundled dependency ships inside the package that declares it, so adding it to the root
    // wouldn't help.
    let notes: Box<[bun_ast::Data]> = if dependency.behavior.is_bundled() {
        Box::new([])
    } else {
        Box::new([bun_ast::range_data(
            None,
            bun_ast::Range::NONE,
            bun_ast::alloc_print(format_args!(
                "add \"{name}\": \"{literal}\" to the root package.json to install it for {declarer_name} too",
            )),
        )])
    };
    this.log_mut().add_range_error_fmt_with_notes(
        None,
        bun_ast::Range::NONE,
        notes,
        format_args!(
            "refusing to resolve \"{name}@{literal}\" declared by {declarer_name}@{}: local tarballs are only allowed in this project's package.json files",
            bun_fmt::for_terminal(
                packages.items_resolution()[declarer as usize].fmt(buf, bun_fmt::PathSep::Posix)
            ),
        ),
    );
}

/// `version` is the declared specifier, or the one that a scoped override supplied.
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

/// Allocated up front on the main thread, because `preallocated_resolve_tasks` isn't thread-safe.
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
    let (tarball_path, normalize) =
        match local_tarball_base_dir(&this.lockfile, dependency_id, path) {
            None => (stored_string(path), true),
            Some(base_dir) => (
                stored_string(Path::resolve_path::join_abs_string::<Path::platform::Auto>(
                    FileSystem::instance().top_level_dir(),
                    &[base_dir, path],
                )),
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
                tarball_path,
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

/// Returns true if `dependency` is what this run's `bun add <name>` adds, with no version or tag
/// given. An empty version that was already in a package.json doesn't count: it means `latest`.
fn is_bare_add_request(this: &PackageManager, dependency: &Dependency, id: DependencyID) -> bool {
    if this.subcommand != package_manager_real::Subcommand::Add
        || !dependency.version.literal.is_empty()
    {
        return false;
    }
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    let name = lockfile.str(&dependency.name);
    let Some(request) = this.index_of_update_request(dependency.name_hash, name) else {
        return false;
    };
    lockfile
        .workspaces_of_update_request(
            this.pending_filtered_write.as_deref(),
            this.workspace_name_hash,
            &this.update_requests[request],
        )
        .iter()
        .any(|&target| lockfile.packages.items_dependencies()[target as usize].contains(id))
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

/// Warns once per version. For a version that none of the project's package.json files ask for,
/// only with `--verbose`.
#[cold]
fn warn_deprecated(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    manifest: &Npm::PackageManifest,
    found: Npm::FindResult,
) {
    if !this.lockfile.is_workspace_dependency(dependency_id) && !this.options.log_level.is_verbose()
    {
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

/// Fills `PackageManager::patched_versions` if the project has patches. Returns true if it does.
#[inline]
fn has_patched_versions(this: &mut PackageManager) -> bool {
    if this.lockfile.patched_dependencies.count() == 0 {
        return false;
    }
    if this.patched_versions.is_none() {
        this.patched_versions = Some(index_patched_versions(this));
    }
    true
}

/// A dependency whose range accepts a patched version resolves to that version, whichever other
/// versions are in the lockfile.
/// `patched` is `PackageManager::patched_versions`, and the strings of `version` are in `buf`.
fn patched_version_in_range<'m>(
    patched: &[(PackageNameHash, Semver::Version)],
    manifest: &'m Npm::PackageManifest,
    version: &dependency::Version,
    buf: &[u8],
) -> Option<Npm::FindResult<'m>> {
    let group = &version.try_npm()?.version;
    let versions: &[u8] = &manifest.string_buf;
    (patched.iter())
        .filter(|&&(name_hash, _)| name_hash == manifest.pkg.name.hash)
        .filter_map(|&(_, patched)| manifest.find_by_version(patched))
        .filter(|found| group.satisfies(found.version, buf, versions))
        // Prefer the highest release. Take the highest prerelease only if there is no release.
        .max_by(|a, b| {
            (b.version.tag.has_pre().cmp(&a.version.tag.has_pre()))
                .then_with(|| a.version.order(b.version, versions, versions))
        })
}

/// Reads the `name@version` keys of `patchedDependencies` from package.json, because the lockfile
/// only has their hashes.
#[cold]
fn index_patched_versions(this: &mut PackageManager) -> Vec<(PackageNameHash, Semver::Version)> {
    use Semver::string::Builder;
    let keys = crate::update_transitive::patched_dependency_keys(this);
    let patched = &this.lockfile.patched_dependencies;
    (keys.iter())
        .filter(|key| patched.contains(&Builder::string_hash(key)))
        .filter_map(|key| {
            // The version starts after the first `@` that is not the leading `@` of a scope.
            let (name, text) = key.split_at(strings::index_of_char_pos(key, b'@', 1)?);
            let text = &text[1..];
            let version = Semver::Version::parse_exact(Semver::SlicedString::init(text, text))?;
            // A patch only applies if its key spells the version the way Bun prints it.
            (format!("{}", version.fmt(text)).as_bytes() == text)
                .then(|| (Builder::string_hash(name), version))
        })
        .collect()
}

/// Returns true if this install skips the dependency's package and everything below it, which is
/// what `is_filtered_dependency_or_workspace` decides later. Its tarball isn't downloaded then.
fn is_row_unplaced(
    this: &PackageManager,
    package: &Package,
    behavior: Behavior,
    dependency_id: DependencyID,
    inside_bundle: bool,
) -> bool {
    if this.options.runtime_auto_install {
        // A bundled dependency came inside its parent's tarball. If an import does not find it
        // there, it is downloaded at that point.
        return inside_bundle;
    }
    // `local_package_features` also works for a remote package: `remote_package_features` only
    // lacks dependency groups that no remote package has.
    !behavior.is_placed(this.options.local_package_features)
        || package.meta.is_disabled(
            this.options.cpu,
            this.options.os,
            this.options.libc.for_dependency(behavior),
        )
        || this.lockfile.is_in_unplaced_subtree(dependency_id)
}

fn tarball_task(
    this: &mut PackageManager,
    name: SemverString,
    package: &Package,
    behavior: Behavior,
    dependency_id: DependencyID,
    url: &[u8],
) -> crate::Result<Option<ResolvedPackageTask>> {
    let task_id =
        Task::Id::for_npm_package(this.lockfile.str(&name), package.resolution.npm().version);
    debug_assert!(!this.network_dedupe_map.contains(&task_id));

    let task = run_tasks::generate_network_task_for_tarball(
        this,
        task_id,
        url,
        behavior.is_required(),
        dependency_id,
        package,
        Authorization::AllowAuthorization,
    )?;
    Ok(Some(ResolvedPackageTask::NetworkTask(
        task.expect("unreachable"),
    )))
}

fn get_or_put_resolved_package_with_find_result(
    this: &mut PackageManager,
    name_hash: PackageNameHash,
    name: SemverString,
    dependency: &Dependency,
    version: &dependency::Version,
    // The result of `picks_latest_tag`.
    latest_for_target: bool,
    dependency_id: DependencyID,
    behavior: Behavior,
    manifest: &Npm::PackageManifest,
    find_result: Npm::FindResult,
    success_fn: SuccessFn,
) -> crate::Result<Option<ResolvedPackageResult>> {
    let should_update = this.to_update
        && if !this.update_requests.is_empty() {
            // Other resolutions stay pinned.
            names_update_request(this, dependency, name_hash, name)
                && crate::update_scope::UpdateScope::of(this)
                    .contains_dependency(&this.lockfile, dependency_id)
        } else {
            // A bare `bun update` updates the dependencies that the targeted workspaces declare.
            // Catalogs belong to the root.
            dependency.version.tag == dependency::version::Tag::Catalog
                || update_target_declares(this, dependency_id)
        };

    // A patched package stays at its version as long as the range allows it. Only `--latest` and
    // `bun audit fix` move it.
    if should_update && !latest_for_target && !behavior.is_peer() {
        if let Some(id) = this.lockfile.patched_package_satisfying(name_hash, version) {
            this.kept_patched.push(id);
            return bind_existing(this, dependency_id, id, success_fn);
        }
    }
    let patched = if latest_for_target || behavior.is_peer() || !has_patched_versions(this) {
        None
    } else {
        patched_version_in_range(
            this.patched_versions.as_deref().unwrap_or_default(),
            manifest,
            version,
            this.lockfile.buffers.string_bytes.as_slice(),
        )
    };
    let find_result = patched.unwrap_or(find_result);

    let npm_resolution = Resolution::init(ResolutionTagged::Npm(ResolutionNpmValue {
        version: find_result.version,
        url: find_result.package.tarball_url.value,
    }));
    let reusable_range = if should_update || patched.is_some() {
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
    }

    // A damaged file in the cache is fetched again.
    if !manifest.is_in_bounds(find_result.package) {
        if refetch_stale_manifest(this, manifest.name(), behavior.is_optional())? {
            return Ok(None);
        }
        return Err(crate::Error::PackageFailedToParse);
    }
    let log = this.log_mut();
    let package = Package::from_npm(
        &mut this.lockfile,
        log,
        this.options.log_level,
        manifest,
        find_result.version,
        find_result.package,
        Features::NPM,
    )?;
    // appendPackage sets the PackageID on the package
    let package = this.lockfile.append_package(&package)?;

    debug_assert!(package.meta.id != invalid_package_id);
    let package_id = package.meta.id;
    if version.tag == dependency::version::Tag::Npm && version.npm().version.is_exact() {
        this.lockfile.mark_exact_pin(package_id);
    }
    // `success_fn` runs however the rest exits, including through `?`.
    let result = (|| -> crate::Result<Option<ResolvedPackageResult>> {
        let package = if this.lockfile.package_extensions.rules.is_empty() {
            package
        } else {
            let log = this.log_mut();
            this.lockfile.extend_new_package(log, package.meta.id)?
        };

        let unplaced = is_row_unplaced(this, &package, behavior, dependency_id, inside_bundle);
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
                let url = manifest.str(&find_result.package.tarball_url);
                tarball_task(this, name, &package, behavior, dependency_id, url)?
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

/// How a dependency is resolved when no manifest is needed.
enum Settled {
    /// It binds to this package.
    Package(PackageID),
    /// The lockfile already has its resolution.
    Resolved,
    /// It is a peer that a folder, a tarball or a repository next to it provides. It stays unbound.
    ProvidedLocally,
    /// It is a peer, and the peer pass has not started.
    Deferred,
}

/// Returns `None` if the dependency can only be resolved from its manifest. `request_ahead` calls
/// this too, so it never requests a manifest that `get_or_put_resolved_package` wouldn't need.
#[inline(always)]
fn settle_without_manifest(
    this: &mut PackageManager,
    name_hash: PackageNameHash,
    dependency: &Dependency,
    version: &dependency::Version,
    version_was_replaced: bool,
    dependency_id: DependencyID,
    resolution: PackageID,
    install_peer: bool,
    latest_for_target: bool,
) -> Option<Settled> {
    let is_peer = dependency.behavior.is_peer();
    if install_peer && is_peer && !latest_for_target {
        index_peer_askers(this);
        let ranges = if version_was_replaced {
            Vec::new()
        } else {
            ranges_of_every_asker(this, dependency, dependency_id)
        };
        // If no installed version satisfies every range, the registry may have one, unless two of
        // the ranges don't overlap. Then the result is the same with and without the manifest.
        let existing_id = if ranges.is_empty() {
            installed_peer_target(this, name_hash, version, dependency_id)
        } else {
            let lockfile: &Lockfile::Lockfile = &this.lockfile;
            installed_version_in_ranges(lockfile, name_hash, version, &ranges).or_else(|| {
                if !has_disjoint_ranges(lockfile, &ranges) {
                    return None;
                }
                installed_peer_target(this, name_hash, version, dependency_id).or_else(|| {
                    installed_version_in_any_range(lockfile, name_hash, dependency_id, &ranges)
                })
            })
        };
        if let Some(existing_id) = existing_id {
            return Some(Settled::Package(existing_id));
        }
    }

    if (resolution as usize) < this.lockfile.packages.len() {
        return Some(Settled::Resolved);
    }

    let links = match version.tag {
        dependency::version::Tag::Npm => links_workspace(this, name_hash, &version.npm().version),
        // `bun add <name>` asks for no version and no tag, so it links a workspace as `*` would.
        dependency::version::Tag::DistTag => {
            has_linkable_workspace(this, name_hash)
                && !version_was_replaced
                && is_bare_add_request(this, dependency, dependency_id)
        }
        _ => return None,
    };
    if links && let Some(workspace_id) = root_workspace_package_id(&this.lockfile, name_hash) {
        return Some(Settled::Package(workspace_id));
    }

    if !is_peer {
        return None;
    }
    // Until every other dependency is resolved, nobody can tell which versions a peer can choose
    // from. Reading a manifest now would also make the answer depend on what the cache holds.
    if !install_peer {
        return Some(Settled::Deferred);
    }
    index_peer_askers(this);
    if is_peer_provided_locally(this, dependency, dependency_id) {
        return Some(Settled::ProvidedLocally);
    }
    alias_of_every_dependent(this, dependency, version, dependency_id).map(Settled::Package)
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
    match settle_without_manifest(
        this,
        name_hash,
        dependency,
        version,
        version_was_replaced,
        dependency_id,
        resolution,
        install_peer,
        latest_for_target,
    ) {
        // make sure verifyResolutions sees this resolution as a valid package id
        Some(Settled::Package(id)) => return bind_existing(this, dependency_id, id, success_fn),
        Some(Settled::Resolved) => {
            return Ok(Some(ResolvedPackageResult {
                package: *this.lockfile.packages.get(resolution as usize),
                ..Default::default()
            }));
        }
        Some(Settled::ProvidedLocally) => return Ok(Some(ResolvedPackageResult::default())),
        Some(Settled::Deferred) => return Ok(None),
        None => {}
    }

    match version.tag {
        dependency::version::Tag::Npm | dependency::version::Tag::DistTag => {
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
                // The registry doesn't have the name. `run_tasks` sent the dependency back here
                // after the 404.
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

            let peer_ranges = if install_peer && behavior.is_peer() && !version_was_replaced {
                ranges_of_every_asker(this, dependency, dependency_id)
            } else {
                Vec::new()
            };
            let version_result: Npm::FindVersionResult = if latest_for_target {
                manifest.find_by_dist_tag_with_filter(
                    b"latest",
                    this.options.minimum_release_age_ms,
                    this.options.minimum_release_age_excludes,
                )
            } else if let Some(shared) = version_every_peer_accepts(this, manifest, &peer_ranges) {
                shared
            } else if install_peer
                && behavior.is_peer()
                && let Some(id) = installed_peer_target(this, name_hash, version, dependency_id)
                    .or_else(|| {
                        installed_version_in_any_range(
                            &this.lockfile,
                            name_hash,
                            dependency_id,
                            &peer_ranges,
                        )
                    })
            {
                return bind_existing(this, dependency_id, id, success_fn);
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
                    // No published version satisfies the range, so fall back to the installed
                    // version that `installed_peer_target` skipped.
                    if install_peer && behavior.is_peer() {
                        if let Some(id) = highest_peer_candidate(&this.lockfile, name_hash, version)
                        {
                            return bind_existing(this, dependency_id, id, success_fn);
                        }
                    }
                    match err_type {
                        Npm::FindVersionError::TooRecent
                        | Npm::FindVersionError::AllVersionsTooRecent => {
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

                    // A workspace is only used for a dist-tag if the registry can't satisfy it.
                    if version.tag == dependency::version::Tag::DistTag
                        && let Some(id) = root_workspace_package_id(&this.lockfile, name_hash)
                    {
                        return bind_existing(this, dependency_id, id, success_fn);
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

            // `--latest` never moves a dependency below the version in bun.lock.
            if latest_for_target
                && let Some((locked, buf)) = locked_version_in_lockfile(this, name_hash, version)
                && find_result.version.order(locked, &manifest.string_buf, buf)
                    == core::cmp::Ordering::Less
                && let Some(kept) = manifest.find_by_version(locked)
            {
                find_result = kept;
            }
            // It also never moves a dependency on a dist-tag below the version that the tag points
            // to.
            if latest_for_target
                && version.tag == dependency::version::Tag::DistTag
                && let Some(tagged) = manifest
                    .find_for_dependency(
                        version,
                        this.lockfile.buffers.string_bytes.as_slice(),
                        this.options.minimum_release_age_ms,
                        this.options.minimum_release_age_excludes,
                    )
                    .unwrap()
                && tagged.is_newer_than(manifest, find_result.version, &manifest.string_buf)
            {
                find_result = tagged;
            }
            // Apply both rules to `catalog:` dependencies too. `--latest` has already replaced the
            // catalog entry with the `latest` tag, so compare against the original entry.
            if let Some(original) = catalog_entry_before_latest(this, dependency) {
                let locked_buf = &*original.original_version_string_buf;
                if let Some(locked) = original.original_version
                    && find_result
                        .version
                        .order(locked, &manifest.string_buf, locked_buf)
                        == core::cmp::Ordering::Less
                    && let Some(kept) = manifest.find_by_version(locked)
                {
                    find_result = kept;
                }
                if let Some(tagged) = manifest
                    .find_by_dist_tag_with_filter(
                        dependency::trim_literal(&original.original_version_literal),
                        this.options.minimum_release_age_ms,
                        this.options.minimum_release_age_excludes,
                    )
                    .unwrap()
                    && tagged.is_newer_than(manifest, find_result.version, &manifest.string_buf)
                {
                    find_result = tagged;
                }
            }

            // The callee doesn't touch `this.manifests`, which `manifest` and `find_result` point
            // into.
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
            if let Err(why) = try_global_link_dir(this) {
                this.exit_or_log(&why);
                return Err(crate::Error::MissingPackageJSON);
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

/// Reads the package.json of a `file:` or `workspace:` folder. `path` is absolute or relative to
/// the project.
fn resolve_project_folder(
    this: &mut PackageManager,
    version: &dependency::Version,
    path: SemverString,
) -> FolderResolutionValue {
    // `get_or_put` copies the path into the lockfile string buffer before any other mutation.
    let path = this.lockfile.str_detached(&path);
    let mut buf = bun_paths::path_buffer_pool::get();
    let Some(abs) = project_path(path, &mut buf[..]) else {
        return FolderResolutionValue::Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
    };
    FolderResolution::get_or_put(GlobalOrRelative::Relative(version.tag), version, abs, this)
}

/// Returns `path` as an absolute path, or `None` if it's too long for `buf`. Relative paths are
/// resolved against the project root.
fn project_path<'a>(path: &'a [u8], buf: &'a mut [u8]) -> Option<&'a [u8]> {
    if bun_paths::is_absolute(path) {
        return (path.len() < buf.len()).then_some(path);
    }
    Path::resolve_path::join_abs_string_buf_checked::<Path::platform::Auto>(
        FileSystem::instance().top_level_dir(),
        buf,
        &[path],
    )
}

/// For `bun update <name>`: returns true if the dependency refers to a requested package, either by
/// its own name or through `npm:`.
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

/// Only applies to a dependency that keeps its declared specifier. If an override or a catalog
/// replaced it, it isn't moved here.
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

/// The targets are the workspaces that `-r` or `--filter` select, or else the workspace that the
/// command runs in.
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

/// Returns what a `catalog:` dependency's catalog entry looked like before `bun update --latest`
/// replaced it with the `latest` tag: its original text and the version in bun.lock. Returns `None`
/// for any other dependency.
fn catalog_entry_before_latest<'a>(
    this: &'a PackageManager,
    dependency: &Dependency,
) -> Option<&'a package_manager_real::PackageUpdateInfo> {
    use package_manager_real::{PackageJSONEditor, PackageUpdateInfo};
    if dependency.version.tag != dependency::version::Tag::Catalog
        || !PackageJSONEditor::steers_catalogs_to_latest(this)
    {
        return None;
    }
    let buf = this.lockfile.buffers.string_bytes.as_slice();
    let catalog_name = dependency.version.catalog().slice(buf);
    let key = PackageUpdateInfo::catalog_row_key(dependency.name.slice(buf), catalog_name);
    this.updating_packages.get(&key)
}

/// Returns the version from the loaded lockfile that the dependency's range accepts.
/// `package_index` lists the highest version first.
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

/// Picks an installed package for a peer dependency, going by its own range. Returns `None` if the
/// registry should decide.
fn installed_peer_target(
    this: &PackageManager,
    name_hash: PackageNameHash,
    version: &dependency::Version,
    row: DependencyID,
) -> Option<PackageID> {
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    if let Some(id) = lockfile.package_satisfying(name_hash, version, |_| true) {
        return Some(id);
    }
    // An override chose this peer's version, so no other version stands in for it.
    if lockfile.is_overridden_dependency(row) {
        return None;
    }
    let provided = peer_provided_from_above(lockfile, name_hash, row)?;
    (!would_revive_leftover(lockfile, row, provided)).then_some(provided)
}

/// Returns the highest installed version that satisfies `version` and every range in `ranges`.
fn installed_version_in_ranges(
    lockfile: &Lockfile::Lockfile,
    name_hash: PackageNameHash,
    version: &dependency::Version,
    ranges: &[dependency::Version],
) -> Option<PackageID> {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let resolutions = lockfile.packages.items_resolution();
    lockfile.package_satisfying(name_hash, version, |id| {
        let resolution = &resolutions[id as usize];
        resolution.tag == ResolutionTag::Npm
            && (ranges.iter())
                .all(|range| (range.npm().version).satisfies(resolution.npm().version, buf, buf))
    })
}

/// Returns true if two of the ranges have no version in common.
fn has_disjoint_ranges(lockfile: &Lockfile::Lockfile, ranges: &[dependency::Version]) -> bool {
    let buf = lockfile.buffers.string_bytes.as_slice();
    ranges.iter().enumerate().any(|(i, a)| {
        (ranges[i + 1..].iter()).any(|b| !a.npm().version.intersects(buf, &b.npm().version, buf))
    })
}

/// No version satisfies every range in `ranges`, and no installed version satisfies `row`. Returns
/// the highest installed version that satisfies one of the other ranges.
///
/// pnpm installs nothing in this case. A second version would often end up at the top of a hoisted
/// `node_modules`, where it splits packages that have to share one copy, like `type-graphql` and its
/// helpers with `graphql`. So `row` shares the copy that's already used as a peer, out of range.
fn installed_version_in_any_range(
    lockfile: &Lockfile::Lockfile,
    name_hash: PackageNameHash,
    row: DependencyID,
    ranges: &[dependency::Version],
) -> Option<PackageID> {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let resolutions = lockfile.packages.items_resolution();
    (lockfile.packages_named(name_hash).iter().copied()).find(|&id| {
        let resolution = &resolutions[id as usize];
        resolution.tag == ResolutionTag::Npm
            && (ranges.iter())
                .any(|range| (range.npm().version).satisfies(resolution.npm().version, buf, buf))
            && !would_revive_leftover(lockfile, row, id)
    })
}

/// Returns the package that `row`'s owner, or the nearest package above it, loads under this name. As
/// in pnpm, the peer uses that package even if its version is out of range:
/// - Every library under a workspace that depends on `react@17` uses `react@17`.
/// - A library uses the same copy as the UI kit that depends on it, if both have the peer dependency.
///
/// Returns `None` if nothing above the owner has a dependency or a peer dependency on this name.
fn peer_provided_from_above(
    lockfile: &Lockfile::Lockfile,
    name_hash: PackageNameHash,
    row: DependencyID,
) -> Option<PackageID> {
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let lists = lockfile.packages.items_dependencies();
    let names = lockfile.packages.items_name_hash();
    let owner = lockfile.get_parent_pkg_of_dependency(row)?;
    let named = |package: usize, is_peer: bool| {
        (lists[package].begin() as usize..lists[package].end() as usize)
            .filter(|&id| {
                deps[id].name_hash == name_hash
                    && deps[id].behavior.is_peer() == is_peer
                    && !deps[id].behavior.is_optional_peer()
            })
            .map(|id| resolutions[id])
            .find(|&id| names.get(id as usize) == Some(&name_hash))
    };
    if let Some(own) = named(owner as usize, false) {
        return Some(own);
    }

    // A project's own peer dependency is resolved like one of its regular dependencies.
    let packages = lockfile.packages.items_resolution();
    let is_project = |package: usize| {
        matches!(
            packages[package].tag,
            ResolutionTag::Root | ResolutionTag::Workspace
        )
    };
    let mut seen = DynamicBitSet::init_empty(lists.len()).unwrap_or_oom();
    let mut level = DynamicBitSet::init_empty(lists.len()).unwrap_or_oom();
    seen.set(owner as usize);
    level.set(owner as usize);
    loop {
        let mut above = DynamicBitSet::init_empty(lists.len()).unwrap_or_oom();
        let mut any_above = false;
        // As in pnpm, a package that's only installed for a peer dependency belongs to the project.
        // The packages that have that peer dependency provide nothing to it, but the packages
        // above them do.
        for follows_peers in [false, true] {
            for (parent, list) in lists.iter().enumerate() {
                if seen.is_set(parent)
                    || !(list.begin() as usize..list.end() as usize).any(|id| {
                        (follows_peers || !deps[id].behavior.is_peer() || is_project(parent))
                            && level.is_set_allow_out_of_bound(resolutions[id] as usize, false)
                    })
                {
                    continue;
                }
                // A package provides itself to everything below it. A project doesn't: a plugin in
                // the repository of its host gets the published host.
                if names[parent] == name_hash && !is_project(parent) {
                    return Some(parent as PackageID);
                }
                if !follows_peers
                    && let Some(provided) = named(parent, false).or_else(|| named(parent, true))
                {
                    return Some(provided);
                }
                seen.set(parent);
                above.set(parent);
                any_above = true;
            }
            if any_above {
                break;
            }
        }
        if !any_above {
            return None;
        }
        level = above;
    }
}

/// Returns true if a `file:`, `link:`, tarball or git dependency provides the peer. The tree
/// builder then binds the peer to the nearest copy.
fn is_peer_provided_locally(this: &PackageManager, peer: &Dependency, row: DependencyID) -> bool {
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    // Every dependency group of the declaring package counts (`Features::main()`), because bun.lock
    // records them all, whatever this install omits.
    (peer_askers(this, peer.name_hash).iter())
        .find(|asker| asker.1 == row)
        .map(|asker| asker.2)
        .or_else(|| lockfile.get_parent_pkg_of_dependency(row))
        .is_some_and(|owner| {
            local_rows(lockfile, owner, Features::main()).any(|name| name == peer.name_hash)
        })
        || this.local_in_root.contains(&peer.name_hash)
}

/// Returns the names that `owner` resolves to a folder, a tarball or a repository.
fn local_rows(
    lockfile: &Lockfile::Lockfile,
    owner: PackageID,
    features: Features,
) -> impl Iterator<Item = PackageNameHash> {
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let packages = lockfile.packages.items_resolution();
    let list = lockfile.packages.items_dependencies().get(owner as usize);
    list.map_or(0..0, |list| list.begin() as usize..list.end() as usize)
        .filter(move |&id| {
            !deps[id].behavior.is_peer()
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
        .map(move |id| deps[id].name_hash)
}

/// Fills `peer_askers` with the required peer dependencies that no package provides in at least one
/// place, of every package that is in the tree without counting peers. Resolving peers does not
/// change that list, because all of those packages are resolved before the first peer is. Also
/// fills `local_in_root` and `alias_rows`, which are final by then for the same reason.
fn index_peer_askers(this: &mut PackageManager) {
    if this.peer_askers.is_some() {
        return;
    }
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    this.local_in_root = local_rows(lockfile, 0, this.options.local_package_features).collect();
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let known = reachable::packages(
        lockfile,
        lockfile.buffers.resolutions.as_slice(),
        reachable::Options {
            peer: false,
            optional_peer: false,
            ..reachable::Options::all(0)
        },
    );
    let mut askers = Vec::new();
    let mut aliases = Vec::new();
    for (owner, list) in lockfile.packages.items_dependencies().iter().enumerate() {
        for id in (list.begin()..list.end()).filter(|_| known.is_set(owner)) {
            let dep = &deps[id as usize];
            if dep.behavior.is_peer() {
                if !dep.behavior.is_optional_peer() {
                    askers.push((dep.name_hash, id, owner as PackageID, false));
                }
            } else if dep.version.try_npm().is_some_and(|npm| npm.is_alias)
                && resolutions[id as usize] != invalid_package_id
            {
                aliases.push((dep.name_hash, owner as PackageID, resolutions[id as usize]));
            }
        }
    }
    bun_collections::index_sort::sort_vec_by(&mut askers, |a, b| a.0.cmp(&b.0));
    // As in pnpm, only the packages that nobody provides the peer for have to agree on a version.
    // A package that has a provider in one place and none in another uses the provider's version,
    // but the others still have to agree with its range, because they can be loaded together.
    // A project's own peer dependency is resolved like one of its regular dependencies.
    let packages = lockfile.packages.items_resolution();
    let mut unprovided = Vec::new();
    for named in askers
        .chunk_by(|a, b| a.0 == b.0)
        .filter(|named| named.len() > 1)
    {
        let name_hash = named[0].0;
        let nowhere = reachable::packages_without_peer_provider(lockfile, resolutions, name_hash);
        let somewhere =
            reachable::packages_reached_without_peer_provider(lockfile, resolutions, name_hash);
        unprovided.extend(
            (named.iter().copied())
                .filter(|&(_, _, owner, _)| {
                    packages[owner as usize].tag == ResolutionTag::Npm
                        && somewhere.is_set(owner as usize)
                })
                .map(|(name, id, owner, _)| (name, id, owner, nowhere.is_set(owner as usize))),
        );
    }
    this.peer_askers = Some(unprovided);
    this.alias_rows = aliases;
}

/// If every package that depends on the peer's declaring package installs an `npm:` alias under the
/// peer's name, those aliases provide the peer, and this returns the package they resolve to. An
/// alias that some other package declares does not count.
fn alias_of_every_dependent(
    this: &PackageManager,
    peer: &Dependency,
    range: &dependency::Version,
    row: DependencyID,
) -> Option<PackageID> {
    let named = (this.alias_rows.iter()).filter(|alias| alias.0 == peer.name_hash);
    named.clone().next()?;
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let package = lockfile.get_parent_pkg_of_dependency(row)?;
    let mut target = None;
    for (dependent, list) in lockfile.packages.items_dependencies().iter().enumerate() {
        if (list.begin() as usize..list.end() as usize)
            .any(|id| resolutions[id] == package && !deps[id].behavior.is_peer())
        {
            let alias = named
                .clone()
                .find(|alias| alias.1 == dependent as PackageID)?;
            target = target.or(Some(alias.2));
        }
    }
    let target = target?;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let resolution = &lockfile.packages.items_resolution()[target as usize];
    (resolution.tag == ResolutionTag::Npm
        && (range.try_npm()?.version).satisfies(resolution.npm().version, buf, buf))
    .then_some(target)
}

/// Returns the entries of `peer_askers` for `name_hash`, in the order of the packages that declare
/// them.
fn peer_askers(
    this: &PackageManager,
    name_hash: PackageNameHash,
) -> &[(PackageNameHash, DependencyID, PackageID, bool)] {
    let askers = this.peer_askers.as_deref().unwrap_or_default();
    let start = askers.partition_point(|asker| asker.0 < name_hash);
    let count = askers[start..].partition_point(|asker| asker.0 == name_hash);
    &askers[start..start + count]
}

/// Returns the distinct ranges of the packages that have to agree with `row` on a version of this
/// peer dependency. Returns an empty list if the range of `row` alone should decide.
fn ranges_of_every_asker(
    this: &PackageManager,
    peer: &Dependency,
    row: DependencyID,
) -> Vec<dependency::Version> {
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let mut ranges: Vec<dependency::Version> = Vec::new();
    let mut row_counts = false;
    for &(_, id, _, has_no_provider) in peer_askers(this, peer.name_hash) {
        let dep = &deps[id as usize];
        let Some(range) = crate::dedupe::effective_npm_range(lockfile, id, dep) else {
            continue;
        };
        if range.npm().is_alias {
            continue;
        }
        row_counts |= id == row && has_no_provider;
        if !(ranges.iter()).any(|seen| seen.literal.eql(range.literal, buf, buf)) {
            ranges.push(range);
        }
    }
    if !row_counts || ranges.len() < 2 {
        ranges.clear();
    }
    ranges
}

/// Returns the newest version that satisfies every range in `ranges`, which come from
/// `ranges_of_every_asker`.
fn version_every_peer_accepts<'m>(
    this: &PackageManager,
    manifest: &'m Npm::PackageManifest,
    ranges: &[dependency::Version],
) -> Option<Npm::FindVersionResult<'m>> {
    let buf = this.lockfile.buffers.string_bytes.as_slice();
    let mut best: Option<(Semver::Version, Npm::FindVersionResult<'m>)> = None;
    for range in ranges {
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

/// Returns true if only the peer dependencies of non-root packages resolve to `package_id`, which
/// is usually left over from this dependency's own earlier install. For a peer that a dependency
/// declares, the check is stricter: no dependency at all resolves to the package, which happens
/// when a changed override has unbound all of them.
fn would_revive_leftover(
    lockfile: &Lockfile::Lockfile,
    row: DependencyID,
    package_id: PackageID,
) -> bool {
    if package_id >= lockfile.loaded_package_count {
        return false;
    }
    let any_holder = !lockfile.is_workspace_dependency(row);
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    !(lockfile.packages.items_dependencies().iter().enumerate()).any(|(owner, list)| {
        (list.begin() as usize..list.end() as usize).any(|row| {
            resolutions[row] == package_id
                && (any_holder || owner == 0 || !deps[row].behavior.is_peer())
        })
    })
}

impl PackageManager {
    /// Returns false if every dependency on the package is optional. The root's dependency on a
    /// workspace doesn't count.
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
        // A peer needs the copy that the tree gives it, unless the name is also in
        // `optionalDependencies`.
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

    /// Removes the messages that were logged since `mark` from the log and returns them.
    #[cold]
    pub(crate) fn take_log_since(&mut self, mark: usize) -> Vec<bun_ast::Msg> {
        let log = self.log_mut();
        let start = mark.min(log.msgs.len());
        let msgs: Vec<bun_ast::Msg> = log.msgs.drain(start..).collect();
        for msg in &msgs {
            match msg.kind {
                bun_ast::Kind::Err => log.errors -= 1,
                bun_ast::Kind::Warn => log.warnings -= 1,
                _ => {}
            }
        }
        msgs
    }

    /// Turns the copies of `msgs` that `log_copies` logged as warnings into errors, so that the
    /// failure is printed once. Returns false if the log no longer has them.
    #[cold]
    fn raise_copies_to_errors(&mut self, msgs: &[bun_ast::Msg]) -> bool {
        let log = self.log_mut();
        let mut raised = false;
        for logged in &mut log.msgs {
            if logged.kind == bun_ast::Kind::Warn
                && msgs.iter().any(|msg| msg.data.text == logged.data.text)
            {
                logged.kind = bun_ast::Kind::Err;
                log.warnings -= 1;
                log.errors += 1;
                raised = true;
            }
        }
        raised
    }

    /// Logs copies of `msgs`, all as errors or all as warnings.
    #[cold]
    fn log_copies(&mut self, msgs: &[bun_ast::Msg], kind: bun_ast::Kind) {
        let log = self.log_mut();
        for msg in msgs {
            match kind {
                bun_ast::Kind::Err => log.errors += 1,
                bun_ast::Kind::Warn => log.warnings += 1,
                _ => {}
            }
            let mut msg = msg.clone();
            msg.kind = kind;
            log.msgs.push(msg);
        }
    }

    /// The manifest has no version for `row`. Keeps what was logged about that since `mark` out of
    /// the log until `log_held` knows whether `row` is still in the tree.
    #[cold]
    pub(crate) fn hold_log_since(&mut self, mark: usize, row: DependencyID) {
        // Dedupe never drops what a package.json of the project asks for.
        if self.held_messages.is_none() || self.lockfile.is_workspace_dependency(row) {
            return;
        }
        let msgs = self.take_log_since(mark);
        if let Some(held) = &mut self.held_messages
            && !msgs.is_empty()
        {
            held.push((HeldAbout::Row(row), msgs));
        }
    }

    /// A manifest request ended without a manifest, and what was logged since `mark` says why.
    /// Moves that out of the log, to be reported by the first dependency that needs the manifest.
    #[cold]
    pub(crate) fn keep_manifest_failure(
        &mut self,
        task_id: Task::Id,
        mark: usize,
        mut failure: package_manager_real::ManifestFailure,
    ) {
        failure.msgs = self.take_log_since(mark);
        let _ = self.manifest_failures.insert(task_id, failure);
        let _ = self.look_ahead.waiting.remove(&task_id);
    }

    /// Logs the held messages. It runs after dedupe, and an error only fails the install if a
    /// dependency that is still in the tree needs the missing package or version.
    #[cold]
    pub(crate) fn log_held(&mut self) {
        use bun_ast::Kind;
        let held = self.held_messages.take().unwrap_or_default();
        if held.is_empty() {
            return;
        }
        let lockfile = &*self.lockfile;
        let all = reachable::Options::all(0);
        let tree = reachable::packages(lockfile, &lockfile.buffers.resolutions, all);
        let is_in_tree = |row: DependencyID| {
            (lockfile.get_parent_pkg_of_dependency(row))
                .is_none_or(|owner| tree.is_set(owner as usize))
        };
        let log = self.log_mut();
        for (about, msgs) in held {
            let is_needed = match about {
                HeldAbout::Row(row) => is_in_tree(row),
                // A dependency of the project needed the manifest later on and logged the error.
                HeldAbout::Task(id)
                    if (self.manifest_failures.get(&id)).is_some_and(|failure| {
                        failure.reported == package_manager_real::FailureReport::Errored
                    }) =>
                {
                    continue;
                }
                HeldAbout::Task(id) => match self.task_queue.get(&id) {
                    Some(waiters) if !waiters.is_empty() => {
                        waiters.iter().any(|waiter| match *waiter {
                            TaskCallbackContext::Dependency(row)
                            | TaskCallbackContext::RootDependency(row) => {
                                is_in_tree(row)
                                    && lockfile.buffers.dependencies[row as usize]
                                        .behavior
                                        .is_required()
                            }
                            _ => true,
                        })
                    }
                    _ => true,
                },
            };
            for mut msg in msgs {
                // It is still printed, as a warning, because the missing package may have changed
                // how other dependencies were resolved.
                if msg.kind == Kind::Err && !is_needed {
                    msg.kind = Kind::Warn;
                }
                match msg.kind {
                    Kind::Err => log.errors += 1,
                    Kind::Warn => log.warnings += 1,
                    _ => {}
                }
                log.msgs.push(msg);
            }
        }
    }

    /// Reports the `Summary::offline_misses` that the install can't continue without, and returns
    /// how many there are.
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
        // A package with an installed copy isn't skipped, because that copy needs its dependencies.
        let mut left_out = missing.clone()?;
        for &package_id in &misses.in_place {
            left_out.unset(package_id as usize);
        }
        // A peer needs the copy that the linker gives it. The copies it gets in other places count
        // as needed too.
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
            // Report each package once.
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

    /// `served` lists the peer dependencies in the layout that a linker wrote, each with the copy
    /// that its dependent loads.
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
            if range.npm().version.satisfies(version, buf, buf) {
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
