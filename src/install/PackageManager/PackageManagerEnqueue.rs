use crate::lockfile::package::PackageColumns as _;
use core::sync::atomic::Ordering;

use crate::bun_fs::FileSystem;
use bun_core::{Output, UnwrapOrOom, fmt as bun_fmt};
use bun_core::{StringOrTinyString, strings};
use bun_paths::{self as Path, PathBuffer};
use bun_semver::{self as Semver, String as SemverString};
use bun_sys::Fd;

use crate::_folder_resolver::{
    self as FolderResolution, FolderResolution as FolderResolutionValue, GlobalOrRelative,
    PackageWorkspaceSearchPathFormatter,
};
use crate::dependency;
use crate::dependency::{DependencyExt as _, TagExt as _, VersionExt as _};
use crate::lockfile::PackageIndexEntry;
use crate::lockfile::package::Package;
use crate::lockfile_real as Lockfile;
use crate::package_manager_real::{
    self, FailFn, PackageManager, SuccessFn, TaskCallbackList, determine_preinstall_state,
    get_cache_directory, get_preinstall_state, get_temporary_directory, run_tasks,
    set_preinstall_state,
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

// `verbose_install` is a process-global. The associated fn lives on the real
// `PackageManager` impl; pull it into scope as a free name so the
// `verbose_install()` call sites read the same.
#[inline]
fn verbose_install() -> bool {
    PackageManager::verbose_install()
}

// `PatchTask.callback` discriminant — routed to the real
// `patch_install::Callback` enum (CalcHash / Apply).

// `SuccessFn` / `FailFn` are bare `fn(&mut PackageManager, ...)` pointers; the
// real bodies are inherent methods, so reference them via the type path.
#[allow(non_upper_case_globals)]
const assign_resolution: SuccessFn = PackageManager::assign_resolution;
#[allow(non_upper_case_globals)]
const assign_root_resolution: SuccessFn = PackageManager::assign_root_resolution;
#[allow(non_upper_case_globals)]
const fail_root_resolution: FailFn = PackageManager::fail_root_resolution;

// The `use package_manager_real::PackageManager`
// above already pulls the `declare_scope!`-generated `static PackageManager: ScopedLogger`
// (value namespace) alongside the struct (type namespace), so re-declaring it here
// would collide. `scoped_log!(PackageManager, ...)` below resolves to that import.

pub(crate) type EnqueuePackageForDownloadError = crate::network_task::ForTarballError;
pub(crate) type EnqueueTarballForDownloadError = crate::network_task::ForTarballError;

const MS_PER_S: f64 = bun_core::time::MS_PER_S as f64;

// ─────────────────────────────────────────────────────────────────────────────

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
        assign_resolution,
        None,
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
            let path_sep = match dependency.version.tag {
                dependency::version::Tag::Folder => bun_fmt::PathSep::Auto,
                _ => bun_fmt::PathSep::Any,
            };
            // `format_args!` borrows temporaries — bind the
            // formatter first so it outlives the macro expansion.
            let realname = dependency.realname();
            let path_fmt = bun_fmt::fmt_path_u8(
                this.lockfile.str(&realname),
                bun_fmt::PathFormatOptions {
                    path_sep,
                    escape_backslashes: false,
                },
            );
            let log = &mut this.log;
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

            i += 1;
            continue;
        }
        i += 1;
    }

    this.drain_dependency_list();
}

fn interned(s: &[u8]) -> StringOrTinyString {
    StringOrTinyString::init_append_if_needed(
        s,
        &mut crate::network_task::filename_store_appender(),
    )
    .expect("unreachable")
}

pub fn enqueue_tarball_for_download(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    package_id: PackageID,
    url: StringOrTinyString,
    task_context: TaskCallbackContext,
) -> Result<(), EnqueueTarballForDownloadError> {
    let task_id = Task::Id::for_tarball(url.slice());
    if this.network_task_has_failed(task_id) {
        return Err(EnqueueTarballForDownloadError::AlreadyFailed);
    }
    if this.options.offline == crate::package_manager_real::options::OfflineMode::Offline {
        let is_required = this.lockfile.buffers.dependencies[dependency_id as usize]
            .behavior
            .is_required();
        if offline_tarball_miss(this, task_id, package_id, is_required) {
            return Err(EnqueueTarballForDownloadError::Offline);
        }
    }
    let task_queue = this.task_queue.get_or_put(task_id)?;
    if !task_queue.found_existing {
        *task_queue.value_ptr = TaskCallbackList::default();
    }

    task_queue.value_ptr.push(task_context);

    if task_queue.found_existing {
        return Ok(());
    }

    let is_required = this.lockfile.buffers.dependencies[dependency_id as usize]
        .behavior
        .is_required();
    let package = *this.lockfile.packages.get(package_id as usize);
    if let Some(task) = run_tasks::generate_network_task_for_tarball(
        this,
        task_id,
        url,
        is_required,
        dependency_id,
        &package,
        crate::network_task::Authorization::NoAuthorization,
    )? {
        // The HTTP thread takes the task over until its terminal callback
        // hands it back through `Shared::async_network_task_queue`.
        bun_http::schedule_owned_request(task, &mut this.network_tarball_batch);
        if this.network_tarball_batch.len > 0 {
            let _ = this.schedule_tasks();
        }
    }
    Ok(())
}

pub fn enqueue_tarball_for_reading(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    package_id: PackageID,
    alias: Semver::String,
    resolution: &Resolution,
    task_context: TaskCallbackContext,
) {
    let (task_id, alias, path) = {
        let string_buf = this.lockfile.buffers.string_bytes.as_slice();
        let path = resolution.local_tarball().slice(string_buf);
        (
            Task::Id::for_tarball(path),
            interned(alias.slice(string_buf)),
            interned(path),
        )
    };
    let task_queue = this.task_queue.get_or_put(task_id).expect("unreachable");
    if !task_queue.found_existing {
        *task_queue.value_ptr = TaskCallbackList::default();
    }

    task_queue.value_ptr.push(task_context);

    if task_queue.found_existing {
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
        &integrity,
    );
    this.task_batch.push_owned(task);
}

/// Outcome of `enqueue_git_for_checkout`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GitEnqueueResult {
    /// a task was queued (or joined an existing one); completion arrives via the task queue
    Queued,
    /// `--offline` and the repository is not cached: nothing was queued (already reported
    /// if required); the caller must count the package as failed/skipped itself
    OfflineMiss,
}

pub fn enqueue_git_for_checkout(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    alias: Semver::String,
    resolution: &Resolution,
    task_context: TaskCallbackContext,
    patch_name_and_version_hash: Option<u64>,
) -> GitEnqueueResult {
    let repository: Repository = *resolution.git();
    let (clone_id, checkout_id, alias, resolved) = {
        let string_buf = this.lockfile.buffers.string_bytes.as_slice();
        let url = repository.repo.slice(string_buf);
        let resolved = repository.resolved.slice(string_buf);
        (
            Task::Id::for_git_clone(url),
            Task::Id::for_git_checkout(url, resolved),
            interned(alias.slice(string_buf)),
            interned(resolved),
        )
    };
    // --offline: decide before any queue registration, so an optional miss leaves
    // nothing behind and a later required edge still reaches the report
    if this.git_repositories.get(&clone_id).is_none() {
        let is_required = this.lockfile.buffers.dependencies[dependency_id as usize]
            .behavior
            .is_required();
        if offline_git_miss(this, clone_id, alias.slice(), is_required) {
            return GitEnqueueResult::OfflineMiss;
        }
    }
    let checkout_queue = this
        .task_queue
        .get_or_put(checkout_id)
        .expect("unreachable");
    if !checkout_queue.found_existing {
        *checkout_queue.value_ptr = TaskCallbackList::default();
    }

    checkout_queue.value_ptr.push(task_context);

    if checkout_queue.found_existing {
        return GitEnqueueResult::Queued;
    }

    if let Some(repo_fd) = this.git_repositories.get(&clone_id).copied() {
        let task = enqueue_git_checkout(
            this,
            checkout_id,
            repo_fd,
            dependency_id,
            alias,
            resolution,
            resolved,
            patch_name_and_version_hash,
        );
        this.enqueue_git_task(task);
    } else {
        let clone_queue = this.task_queue.get_or_put(clone_id).expect("unreachable");
        if !clone_queue.found_existing {
            *clone_queue.value_ptr = TaskCallbackList::default();
        }

        clone_queue
            .value_ptr
            .push(TaskCallbackContext::Dependency(dependency_id));

        if clone_queue.found_existing {
            return GitEnqueueResult::Queued;
        }

        let dep = this.lockfile.buffers.dependencies[dependency_id as usize].clone();
        let task = enqueue_git_clone(this, clone_id, alias, &repository, &dep, resolution, None);
        this.enqueue_git_task(task);
    }
    GitEnqueueResult::Queued
}

/// Under `--offline`, an install-phase request for a package that is not in the cache
/// (these helpers are only reached after the cache lookup missed): report it once if
/// required, skip if optional, and never register a task nobody will complete.
fn offline_tarball_miss(
    this: &mut PackageManager,
    task_id: Task::Id,
    package_id: PackageID,
    is_required: bool,
) -> bool {
    if this.options.offline != crate::package_manager_real::options::OfflineMode::Offline {
        return false;
    }
    if is_required && !this.network_task_has_failed(task_id) {
        // reserve + mark failed so later dependents take the already-failed path
        let _ = this.has_created_network_task(task_id, true);
        this.mark_network_task_failed(task_id);
        let name = this.lockfile.packages.items_name()[package_id as usize];
        let name = this.lockfile.str(&name);
        this.log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "--offline: \"{}\" is not in the cache",
                bstr::BStr::new(name)
            ),
        );
    }
    true
}

/// Under `--offline`, a git dependency whose clone is not already in the cache cannot
/// be installed: report it (once, and only if some edge requires it) instead of
/// spawning `git`. Returns true when the clone must not be enqueued.
fn offline_git_miss(
    this: &mut PackageManager,
    clone_id: Task::Id,
    name: &[u8],
    is_required: bool,
) -> bool {
    if this.options.offline != crate::package_manager_real::options::OfflineMode::Offline {
        return false;
    }
    let mut folder = Vec::with_capacity(24);
    {
        use std::io::Write;
        let _ = write!(
            folder,
            "{}.git",
            bun_core::fmt::hex_int_lower::<16>(clone_id.get())
        );
    }
    let cache_dir = package_manager_real::get_cache_directory(this);
    let cached = bun_sys::directory_exists_at(cache_dir, &bun_core::ZBox::from_bytes(&folder))
        .unwrap_or(false);
    if cached {
        return false;
    }
    if is_required {
        if !this.network_task_has_failed(clone_id) {
            // reserve + mark failed: reported once, later dependents see the failure
            let _ = this.has_created_network_task(clone_id, true);
            this.mark_network_task_failed(clone_id);
            let _ = this.log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "--offline: git repository for \"{}\" is not in the cache",
                    bstr::BStr::new(name)
                ),
            );
        }
    } else {
        // let a later required edge on the same repository report it
        let _ = this.network_dedupe_map.remove(&clone_id);
    }
    true
}

pub fn enqueue_parse_npm_package(
    this: &mut PackageManager,
    task_id: Task::Id,
    name: StringOrTinyString,
    network_task: Box<NetworkTask>,
) -> Box<Task::Task> {
    Task::Task::new(
        this,
        task_id,
        crate::package_manager_task::Request::PackageManifest {
            network: Some(network_task),
            name,
        },
    )
}

pub fn enqueue_package_for_download(
    this: &mut PackageManager,
    name: Semver::String,
    dependency_id: DependencyID,
    package_id: PackageID,
    version: Semver::Version,
    url: Semver::String,
    task_context: TaskCallbackContext,
) -> Result<(), EnqueuePackageForDownloadError> {
    let (task_id, url) = {
        let string_buf = this.lockfile.buffers.string_bytes.as_slice();
        (
            Task::Id::for_npm_package(name.slice(string_buf), version),
            interned(url.slice(string_buf)),
        )
    };
    if this.network_task_has_failed(task_id) {
        return Err(EnqueuePackageForDownloadError::AlreadyFailed);
    }
    {
        let is_required = this.lockfile.buffers.dependencies[dependency_id as usize]
            .behavior
            .is_required();
        if offline_tarball_miss(this, task_id, package_id, is_required) {
            return Err(EnqueuePackageForDownloadError::Offline);
        }
    }
    let task_queue = this.task_queue.get_or_put(task_id)?;
    if !task_queue.found_existing {
        *task_queue.value_ptr = TaskCallbackList::default();
    }

    task_queue.value_ptr.push(task_context);

    if task_queue.found_existing {
        return Ok(());
    }

    let is_required = this.lockfile.buffers.dependencies[dependency_id as usize]
        .behavior
        .is_required();
    let package = *this.lockfile.packages.get(package_id as usize);

    if let Some(task) = run_tasks::generate_network_task_for_tarball(
        this,
        task_id,
        url,
        is_required,
        dependency_id,
        &package,
        crate::network_task::Authorization::AllowAuthorization,
    )? {
        // The HTTP thread takes the task over until its terminal callback
        // hands it back through `Shared::async_network_task_queue`.
        bun_http::schedule_owned_request(task, &mut this.network_tarball_batch);
        if this.network_tarball_batch.len > 0 {
            let _ = this.schedule_tasks();
        }
    }
    Ok(())
}

pub enum DependencyToEnqueue {
    Pending(DependencyID),
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

    if this.lockfile.buffers.resolutions[dep_id as usize] == invalid_package_id {
        // Copy to the stack: `enqueue_dependency_with_main_and_success_fn` can call
        // `Package::from_npm`, which grows `buffers.dependencies` and
        // would invalidate a pointer taken directly into it.
        let dependency = this.lockfile.buffers.dependencies[dep_id as usize].clone();
        if let Err(err) = enqueue_dependency_with_main_and_success_fn(
            this,
            dep_id,
            &dependency,
            invalid_package_id,
            false,
            assign_root_resolution,
            Some(fail_root_resolution),
            true,
        ) {
            return DependencyToEnqueue::Failure(err);
        }
    }

    let resolution_id = match this.lockfile.buffers.resolutions[dep_id as usize] {
        id if id == invalid_package_id => 'brk: {
            this.drain_dependency_list();

            if this.options.log_level.show_progress() {
                this.start_progress_bar_if_none();
            }

            let mut err: Option<crate::Error> = None;
            PackageManager::sleep_until(this, |manager| {
                if manager.pending_task_count() > 0 {
                    let log_level = manager.options.log_level;
                    if let Err(e) = run_tasks::run_tasks(manager, false, log_level) {
                        err = Some(e);
                        return true;
                    }

                    if verbose_install() && manager.pending_task_count() > 0 {
                        if manager.has_enough_time_passed_between_waiting_messages() {
                            bun_core::pretty_errorln!(
                                "<d>[PackageManager]<r> waiting for {} tasks\n",
                                manager.pending_task_count()
                            );
                        }
                    }
                }

                manager.pending_task_count() == 0
            });

            if this.options.log_level.show_progress() {
                this.end_progress_bar();
                Output::flush();
            }

            if let Some(err) = err {
                return DependencyToEnqueue::Failure(err);
            }

            break 'brk this.lockfile.buffers.resolutions[dep_id as usize];
        }
        // we managed to synchronously resolve the dependency
        pkg_id => pkg_id,
    };

    if resolution_id == invalid_package_id {
        return DependencyToEnqueue::NotFound;
    }

    DependencyToEnqueue::Resolution {
        resolution: this.lockfile.packages.items_resolution()[resolution_id as usize],
        package_id: resolution_id,
    }
}

pub fn enqueue_network_task(this: &mut PackageManager, task: Box<NetworkTask>) {
    if this.network_task_fifo.is_full() {
        this.flush_network_queue();
    }

    this.network_task_fifo.push(task);
}

/// Queues the task for the thread pool; `run_tasks` gets it back through
/// `patch_task_queue`.
pub fn enqueue_patch_task(this: &mut PackageManager, task: Box<PatchTask>) {
    bun_output::scoped_log!(
        PackageManager,
        "Enqueue patch task: {:p} {}",
        task,
        task.callback.tag_name()
    );
    if this.patch_task_fifo.is_full() {
        this.flush_patch_task_queue();
    }

    this.patch_task_fifo.push(task);
}

/// We need to calculate all the patchfile hashes at the beginning so we don't run into problems with stale hashes
pub fn enqueue_patch_task_pre(this: &mut PackageManager, mut task: Box<PatchTask>) {
    bun_output::scoped_log!(
        PackageManager,
        "Enqueue patch task pre: {:p} {}",
        task,
        task.callback.tag_name()
    );
    task.pre = true;
    if this.patch_task_fifo.is_full() {
        this.flush_patch_task_queue();
    }

    this.patch_task_fifo.push(task);
    let _ = this.pending_pre_calc_hashes.fetch_add(1, Ordering::Relaxed);
}

/// A resolve task's callback queue is drained exactly once. If `task_id`
/// already completed and appended a package, resolve `id` against it directly:
/// a context queued now would never be processed. Applies the same
/// `package_name` / `resolved` fix-up the completion drain applies.
fn resolve_from_appended_task(
    this: &mut PackageManager,
    task_id: Task::Id,
    id: DependencyID,
) -> Option<PackageID> {
    let &pkg_id = this.appended_task_packages.get(&task_id)?;
    let pkg_name = this.lockfile.packages.items_name()[pkg_id as usize];
    let pkg_res = this.lockfile.packages.items_resolution()[pkg_id as usize];
    let v = &mut this.lockfile.buffers.dependencies[id as usize].version;
    // The buffer row can hold a different tag than the enqueue arm when the
    // dependency comes from `overrides`.
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
    Some(pkg_id)
}

/// Q: "What do we do with a dependency in a package.json?"
/// A: "We enqueue it!"
pub fn enqueue_dependency_with_main_and_success_fn(
    this: &mut PackageManager,
    id: DependencyID,
    // This must be a *const to prevent UB
    dependency: &Dependency,
    resolution: PackageID,
    install_peer: bool,
    success_fn: SuccessFn,
    fail_fn: Option<FailFn>,
    // The two `SuccessFn` candidates
    // (`assign_resolution` / `assign_root_resolution`) have byte-identical
    // bodies in release builds, so Apple ld64 (which ignores `.llvm_addrsig`)
    // folds them and a runtime fn-pointer address comparison is unsound. Thread
    // an explicit flag instead.
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
        // An `npm:` alias names its registry target explicitly, so only plain
        // dependencies may be redirected to a same-named alias elsewhere in the tree.
        if dependency.version.tag == dependency::version::Tag::Npm
            && !dependency.version.npm().is_alias
        {
            if let Some(aliased) = this.known_npm_aliases.get(&name_hash) {
                let group = &dependency.version.npm().version;
                let buf = this.lockfile.buffers.string_bytes.as_slice();
                let mut curr_list: Option<&Semver::semver_query::List> =
                    Some(&aliased.npm().version.head);
                while let Some(queries) = curr_list {
                    let mut curr: Option<&Semver::Query> = Some(&queries.head);
                    while let Some(query) = curr {
                        if group.satisfies(query.range.left.version, buf, buf)
                            || group.satisfies(query.range.right.version, buf, buf)
                        {
                            name = aliased.npm().name;
                            name_hash =
                                Semver::string::Builder::string_hash(this.lockfile.str(&name));
                            break 'version aliased.clone();
                        }
                        curr = query.next.as_deref();
                    }
                    curr_list = queries.next.as_deref();
                }

                // fallthrough. a package that matches the name of an alias but does not match
                // the version should be enqueued as a normal npm dependency, overrides allowed
            }
        }

        // allow overriding all dependencies unless the dependency is coming directly from an alias, "npm:<this dep>" or
        // if it's a workspaceOnly dependency
        if !dependency.behavior.is_workspace()
            && (dependency.version.tag != dependency::version::Tag::Npm
                || !dependency.version.npm().is_alias)
        {
            if let Some(new) = this.lockfile.overrides.get(&this.lockfile, id, name_hash) {
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
                    &new,
                );

                if new.tag == dependency::version::Tag::Catalog {
                    if let Some(catalog_dep) =
                        this.lockfile
                            .catalogs
                            .get(&this.lockfile, *new.catalog(), name)
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

                // `name_hash` stays the same
                break 'version new;
            }

            if dependency.version.tag == dependency::version::Tag::Catalog {
                if let Some(catalog_dep) =
                    this.lockfile
                        .catalogs
                        .get(&this.lockfile, *dependency.version.catalog(), name)
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
        }

        // explicit copy here due to `dependency.version` becoming undefined
        // when `get_or_put_resolved_package_with_find_result` is called and resizes the list.
        version_was_replaced = false;
        break 'version dependency.version.clone();
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
                            if err == crate::Error::DistTagNotFound {
                                if dependency.behavior.is_required() {
                                    if let Some(fail) = fail_fn {
                                        fail(this, dependency, id, err);
                                    } else if dependency.behavior.is_peer() {
                                        warn_unmet_peer_dependency(this, name, &version);
                                    } else {
                                        this.log
                    .add_error_fmt(
                                                None,
                                                bun_ast::Loc::EMPTY,
                                                format_args!(
                                                    "Package \"{}\" with tag \"{}\" not found, but package exists",
                                                    bstr::BStr::new(this.lockfile.str(&name)),
                                                    bstr::BStr::new(
                                                        this.lockfile.str(&version.dist_tag().tag)
                                                    ),
                                                ),
                                            );
                                    }
                                }
                                return Ok(());
                            } else if err == crate::Error::NoMatchingVersion {
                                if dependency.behavior.is_required() {
                                    if let Some(fail) = fail_fn {
                                        fail(this, dependency, id, err);
                                    } else if dependency.behavior.is_peer() {
                                        warn_unmet_peer_dependency(this, name, &version);
                                    } else {
                                        bun_ast::add_error_pretty!(
                                            &mut this.log,
                                            None,
                                            bun_ast::Loc::EMPTY,
                                            "No version matching \"{}\" found for specifier \"{}\"<r> <d>(but package exists)<r>",
                                            bstr::BStr::new(this.lockfile.str(&version.literal)),
                                            bstr::BStr::new(this.lockfile.str(&name)),
                                        );
                                    }
                                }
                                return Ok(());
                            } else if err == crate::Error::TooRecentVersion {
                                if dependency.behavior.is_required() {
                                    if let Some(fail) = fail_fn {
                                        fail(this, dependency, id, err);
                                    } else {
                                        let age_gate_ms =
                                            this.options.minimum_release_age_ms.unwrap_or(0.0);
                                        if version.tag == dependency::version::Tag::DistTag {
                                            bun_ast::add_error_pretty!(
                                                &mut this.log,
                                                None,
                                                bun_ast::Loc::EMPTY,
                                                "Package \"{}\" with tag \"{}\" not found<r> <d>(all versions blocked by minimum-release-age: {} seconds)<r>",
                                                bstr::BStr::new(this.lockfile.str(&name)),
                                                bstr::BStr::new(
                                                    this.lockfile.str(&version.dist_tag().tag)
                                                ),
                                                age_gate_ms / MS_PER_S,
                                            );
                                        } else {
                                            bun_ast::add_error_pretty!(
                                                &mut this.log,
                                                None,
                                                bun_ast::Loc::EMPTY,
                                                "No version matching \"{}\" found for specifier \"{}\"<r> <d>(blocked by minimum-release-age: {} seconds)<r>",
                                                bstr::BStr::new(this.lockfile.str(&name)),
                                                bstr::BStr::new(
                                                    this.lockfile.str(&version.literal)
                                                ),
                                                age_gate_ms / MS_PER_S,
                                            );
                                        }
                                    }
                                }
                                return Ok(());
                            } else if err == crate::Error::MissingPackageJSON {
                                if dependency.behavior.is_required() {
                                    if let Some(fail) = fail_fn {
                                        fail(this, dependency, id, err);
                                    } else if version.tag == dependency::version::Tag::Folder {
                                        this.log
                    .add_error_fmt(
                                                None,
                                                bun_ast::Loc::EMPTY,
                                                format_args!(
                                                    "Could not find package.json for \"file:{}\" dependency \"{}\"",
                                                    bstr::BStr::new(this.lockfile.str(version.folder())),
                                                    bstr::BStr::new(this.lockfile.str(&name)),
                                                ),
                                            );
                                    } else {
                                        this.log.add_error_fmt(
                                            None,
                                            bun_ast::Loc::EMPTY,
                                            format_args!(
                                                "Could not find package.json for dependency \"{}\"",
                                                bstr::BStr::new(this.lockfile.str(&name)),
                                            ),
                                        );
                                    }
                                }
                                return Ok(());
                            } else {
                                if let Some(fail) = fail_fn {
                                    fail(this, dependency, id, err);
                                    return Ok(());
                                }
                                return Err(err);
                            }
                        }
                    };

                    if let Some(result) = resolve_result {
                        // First time?
                        if result.is_first_time {
                            if verbose_install() {
                                let label = this.lockfile.str(&version.literal);

                                bun_core::pretty_errorln!(
                                    "   -> \"{}\": \"{}\" -> {}@{}",
                                    bstr::BStr::new(this.lockfile.str(&result.package.name)),
                                    bstr::BStr::new(label),
                                    bstr::BStr::new(this.lockfile.str(&result.package.name)),
                                    result.package.resolution.fmt(
                                        this.lockfile.buffers.string_bytes.as_slice(),
                                        bun_fmt::PathSep::Auto
                                    ),
                                );
                            }
                            // Resolve dependencies first
                            if result.package.dependencies.len > 0 {
                                this.lockfile
                                    .scratch
                                    .dependency_list_queue
                                    .write_item(result.package.dependencies)?;
                            }
                        }

                        if let Some(task) = result.task {
                            match task {
                                ResolvedPackageTask::NetworkTask(network_task) => {
                                    if get_preinstall_state(this, result.package.meta.id)
                                        == install::PreinstallState::Extract
                                    {
                                        set_preinstall_state(
                                            this,
                                            result.package.meta.id,
                                            install::PreinstallState::Extracting,
                                        );
                                        enqueue_network_task(this, network_task);
                                    }
                                }
                                ResolvedPackageTask::PatchTask(patch_task) => {
                                    if patch_task.callback.is_calc_hash()
                                        && get_preinstall_state(this, result.package.meta.id)
                                            == install::PreinstallState::CalcPatchHash
                                    {
                                        set_preinstall_state(
                                            this,
                                            result.package.meta.id,
                                            install::PreinstallState::CalcingPatchHash,
                                        );
                                        enqueue_patch_task(this, patch_task);
                                    } else if patch_task.callback.is_apply()
                                        && get_preinstall_state(this, result.package.meta.id)
                                            == install::PreinstallState::ApplyPatch
                                    {
                                        set_preinstall_state(
                                            this,
                                            result.package.meta.id,
                                            install::PreinstallState::ApplyingPatch,
                                        );
                                        enqueue_patch_task(this, patch_task);
                                    }
                                }
                            }
                        }

                        if cfg!(debug_assertions) {
                            bun_output::scoped_log!(
                                PackageManager,
                                "enqueueDependency({}, {}, {}, {}) = {}",
                                id,
                                <&'static str>::from(version.tag),
                                bstr::BStr::new(this.lockfile.str(&name)),
                                bstr::BStr::new(this.lockfile.str(&version.literal)),
                                result.package.meta.id,
                            );
                        }
                    } else if version.tag.is_npm() {
                        let cache_ctx = this.manifest_disk_cache_ctx();
                        // Owned copy: `get_or_put_resolved_package_with_find_result`
                        // below appends to `string_bytes` (and may reallocate it),
                        // and `name_str` is still read afterwards on the
                        // fall-through path.
                        let name_str: Vec<u8> = this.lockfile.str(&name).to_vec();
                        let task_id = Task::Id::for_manifest(&name_str);

                        debug_assert!(task_id.get() != 0);

                        if cfg!(debug_assertions) {
                            bun_output::scoped_log!(
                                PackageManager,
                                "enqueueDependency({}, {}, {}, {}) = task {}",
                                id,
                                <&'static str>::from(version.tag),
                                bstr::BStr::new(this.lockfile.str(&name)),
                                bstr::BStr::new(this.lockfile.str(&version.literal)),
                                task_id,
                            );
                        }

                        if !dependency.behavior.is_peer() || install_peer {
                            if !this.has_created_network_task(
                                task_id,
                                dependency.behavior.is_required(),
                            ) {
                                let needs_extended_manifest =
                                    this.options.minimum_release_age_ms.is_some();
                                if this.options.enable.manifest_cache() {
                                    let mut expired = false;
                                    let cached = {
                                        let PackageManager {
                                            manifests, options, ..
                                        } = &mut *this;
                                        let scope = options.scope_for_package_name(&name_str);
                                        manifests
                                            .by_name_hash_allow_expired(
                                                cache_ctx,
                                                scope,
                                                &name_str,
                                                name_hash,
                                                Some(&mut expired),
                                                needs_extended_manifest,
                                            )
                                            .map(|m| m.clone())
                                    };
                                    if let Some(manifest) = cached {
                                        loaded_manifest = Some(manifest);

                                        // If it's an exact package version already living in the cache
                                        // We can skip the network request, even if it's beyond the caching period
                                        if version.tag == dependency::version::Tag::Npm
                                            && version.npm().version.is_exact()
                                        {
                                            if let Some(find_result) =
                                                loaded_manifest.as_ref().unwrap().find_by_version(
                                                    version
                                                        .npm()
                                                        .version
                                                        .head
                                                        .head
                                                        .range
                                                        .left
                                                        .version,
                                                )
                                            {
                                                if let Some(min_age_ms) =
                                                    this.options.minimum_release_age_ms
                                                {
                                                    if !loaded_manifest
                                                        .as_ref()
                                                        .unwrap()
                                                        .should_exclude_from_age_filter(
                                                            this.options.minimum_release_age_excludes,
                                                        )
                                                        && Npm::PackageManifest::is_package_version_too_recent(
                                                            find_result.package, min_age_ms,
                                                        )
                                                    {
                                                        let package_name = this.lockfile.str(&name);
                                                        let min_age_seconds = min_age_ms / MS_PER_S;
                                                        let _ = this.log.add_error_fmt(
                                                            None,
                                                            bun_ast::Loc::EMPTY,
                                                            format_args!(
                                                                "Version \"{}@{}\" was published within minimum release age of {} seconds",
                                                                bstr::BStr::new(package_name),
                                                                find_result.version.fmt(this.lockfile.buffers.string_bytes.as_slice()),
                                                                min_age_seconds,
                                                            ),
                                                        );
                                                        return Ok(());
                                                    }
                                                }
                                                if let Some(new_resolve_result) =
                                                    get_or_put_resolved_package_with_find_result(
                                                        this,
                                                        name_hash,
                                                        name,
                                                        dependency,
                                                        &version,
                                                        id,
                                                        dependency.behavior,
                                                        loaded_manifest.as_ref().unwrap(),
                                                        find_result,
                                                        install_peer,
                                                        success_fn,
                                                    )
                                                    .ok()
                                                    .flatten()
                                                {
                                                    resolve_result_ = Ok(Some(new_resolve_result));
                                                    let _ =
                                                        this.network_dedupe_map.remove(&task_id);
                                                    continue 'retry_with_new_resolve_result;
                                                }
                                            }
                                        }

                                        // Was it recent enough to just load it without the network call?
                                        // (`--prefer-offline` / `--offline` load cached manifests as fresh
                                        // regardless of age — see `DiskCacheCtx::accept_expired` — so they
                                        // take this branch too; an entry still marked expired here needs
                                        // the extended manifest and must be fetched.)
                                        if !expired
                                            && (this.options.enable.manifest_cache_control()
                                                || this.options.offline
                                                    != crate::package_manager_real::options::OfflineMode::Online)
                                        {
                                            let _ = this.network_dedupe_map.remove(&task_id);
                                            continue 'retry_from_manifests_ptr;
                                        }
                                    }
                                }

                                if this.options.offline
                                    == crate::package_manager_real::options::OfflineMode::Offline
                                {
                                    // Optional/peer edges are skipped like any other unavailable
                                    // optional dependency (and release the reservation so a later
                                    // *required* edge on the same package still reports it); a
                                    // required edge reports once and marks the task failed so
                                    // later dependents take the already-failed path.
                                    if dependency.behavior.is_required() {
                                        this.mark_network_task_failed(task_id);
                                        let _ = this.log.add_error_fmt(
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

                                let mut network_task = NetworkTask::new(task_id, this);
                                {
                                    let PackageManager {
                                        log, env, options, ..
                                    } = &mut *this;
                                    let scope = options.scope_for_package_name(&name_str);
                                    network_task.for_manifest(
                                        log,
                                        env.get(),
                                        &name_str,
                                        scope,
                                        loaded_manifest.as_ref(),
                                        dependency.behavior.is_optional(),
                                        needs_extended_manifest,
                                    )?;
                                }
                                enqueue_network_task(this, network_task);
                            }
                        } else {
                            this.peer_dependencies.write_item(id)?;
                            return Ok(());
                        }

                        let manifest_entry_parse =
                            this.task_queue.get_or_put_context(task_id, ())?;
                        if !manifest_entry_parse.found_existing {
                            *manifest_entry_parse.value_ptr = TaskCallbackList::default();
                        }

                        let ctx = if is_root {
                            TaskCallbackContext::RootDependency(id)
                        } else {
                            TaskCallbackContext::Dependency(id)
                        };
                        manifest_entry_parse.value_ptr.push(ctx);
                    }
                    return Ok(());
                }
            }
        }
        dependency::version::Tag::Git => {
            let dep: Repository = *version.git();
            let res = Resolution::init(ResolutionTagged::Git(dep));

            // First: see if we already loaded the git package in-memory
            if let Some(pkg_id) = this.lockfile.get_package_id(name_hash, None, &res) {
                success_fn(this, id, pkg_id);
                return Ok(());
            }

            let (alias, clone_id) = {
                let string_buf = this.lockfile.buffers.string_bytes.as_slice();
                let url = dep.repo.slice(string_buf);
                (
                    interned(dependency.name.slice(string_buf)),
                    Task::Id::for_git_clone(url),
                )
            };
            let ctx = if is_root {
                TaskCallbackContext::RootDependency(id)
            } else {
                TaskCallbackContext::Dependency(id)
            };

            if cfg!(debug_assertions) {
                bun_output::scoped_log!(
                    PackageManager,
                    "enqueueDependency({}, {}, {}, {}) = {}",
                    id,
                    <&'static str>::from(version.tag),
                    bstr::BStr::new(this.lockfile.str(&name)),
                    bstr::BStr::new(this.lockfile.str(&version.literal)),
                    bstr::BStr::new(this.lockfile.str(&dep.repo)),
                );
            }

            if let Some(repo_fd) = this.git_repositories.get(&clone_id).copied() {
                let needs_ctx =
                    this.lockfile.buffers.resolutions[id as usize] == invalid_package_id;

                // An already-resolved dependency (install-phase re-enqueue
                // after the shared clone finished) is pinned: its install
                // context is keyed on the stored SHA, and a branch
                // committish's current tip may differ.
                let pinned: Option<Vec<u8>> = if needs_ctx {
                    None
                } else {
                    let pkg_id = this.lockfile.buffers.resolutions[id as usize];
                    let pkg_res = this.lockfile.packages.items_resolution()[pkg_id as usize];
                    (pkg_res.tag == ResolutionTag::Git)
                        .then(|| this.lockfile.str(&pkg_res.git().resolved).to_vec())
                };
                let resolved = match pinned {
                    Some(resolved) => resolved,
                    None => {
                        // Waits on a `git log` task; `run_tasks` fills `git_commits` and re-enters here.
                        let commit_id = Task::Id::for_git_commit(
                            this.lockfile.str(&dep.repo),
                            this.lockfile.str(&dep.committish),
                        );
                        match this.git_commits.get(&commit_id) {
                            Some(resolved) => resolved.clone(),
                            None => {
                                let url = interned(this.lockfile.str(&dep.repo));
                                let committish = interned(this.lockfile.str(&dep.committish));
                                let entry = this
                                    .task_queue
                                    .get_or_put_context(commit_id, ())
                                    .expect("unreachable");
                                if !entry.found_existing {
                                    *entry.value_ptr = TaskCallbackList::default();
                                }
                                entry.value_ptr.push(ctx);

                                if dependency.behavior.is_peer() && !install_peer {
                                    this.peer_dependencies.write_item(id)?;
                                    return Ok(());
                                }

                                if this.has_created_network_task(
                                    commit_id,
                                    dependency.behavior.is_required(),
                                ) {
                                    return Ok(());
                                }

                                let task = enqueue_git_commit(
                                    this, commit_id, clone_id, alias, url, committish,
                                );
                                this.enqueue_git_task(task);
                                return Ok(());
                            }
                        }
                    }
                };
                let checkout_id =
                    Task::Id::for_git_checkout(this.lockfile.str(&dep.repo), &resolved);

                if needs_ctx {
                    if let Some(pkg_id) = resolve_from_appended_task(this, checkout_id, id) {
                        success_fn(this, id, pkg_id);
                        return Ok(());
                    }
                }

                let entry = this
                    .task_queue
                    .get_or_put_context(checkout_id, ())
                    .expect("unreachable");
                if !entry.found_existing {
                    *entry.value_ptr = TaskCallbackList::default();
                }
                if needs_ctx {
                    entry.value_ptr.push(ctx);
                }

                if dependency.behavior.is_peer() {
                    if !install_peer {
                        this.peer_dependencies.write_item(id)?;
                        return Ok(());
                    }
                }

                if this.has_created_network_task(checkout_id, dependency.behavior.is_required()) {
                    return Ok(());
                }

                let resolved = interned(&resolved);
                let task = enqueue_git_checkout(
                    this,
                    checkout_id,
                    repo_fd,
                    id,
                    alias,
                    &res,
                    resolved,
                    None,
                );
                this.enqueue_git_task(task);
            } else {
                let entry = this
                    .task_queue
                    .get_or_put_context(clone_id, ())
                    .expect("unreachable");
                if !entry.found_existing {
                    *entry.value_ptr = TaskCallbackList::default();
                }
                entry.value_ptr.push(ctx);

                if dependency.behavior.is_peer() {
                    if !install_peer {
                        this.peer_dependencies.write_item(id)?;
                        return Ok(());
                    }
                }

                if this.has_created_network_task(clone_id, dependency.behavior.is_required()) {
                    return Ok(());
                }
                if offline_git_miss(
                    this,
                    clone_id,
                    alias.slice(),
                    dependency.behavior.is_required(),
                ) {
                    return Ok(());
                }

                let task = enqueue_git_clone(this, clone_id, alias, &dep, dependency, &res, None);
                this.enqueue_git_task(task);
            }
            Ok(())
        }
        dependency::version::Tag::Github => {
            let dep: &Repository = version.github();
            let res = Resolution::init(ResolutionTagged::Github(*dep));

            // First: see if we already loaded the github package in-memory
            if let Some(pkg_id) = this.lockfile.get_package_id(name_hash, None, &res) {
                success_fn(this, id, pkg_id);
                return Ok(());
            }

            let url = this.alloc_github_url(dep);
            // url is Box<[u8]>; dropped at scope end
            let task_id = Task::Id::for_tarball(&url);

            if cfg!(debug_assertions) {
                bun_output::scoped_log!(
                    PackageManager,
                    "enqueueDependency({}, {}, {}, {}) = {}",
                    id,
                    <&'static str>::from(version.tag),
                    bstr::BStr::new(this.lockfile.str(&name)),
                    bstr::BStr::new(this.lockfile.str(&version.literal)),
                    bstr::BStr::new(&url),
                );
            }

            if this.lockfile.buffers.resolutions[id as usize] == invalid_package_id {
                if let Some(pkg_id) = resolve_from_appended_task(this, task_id, id) {
                    success_fn(this, id, pkg_id);
                    return Ok(());
                }
            }

            let ctx = if is_root {
                TaskCallbackContext::RootDependency(id)
            } else {
                TaskCallbackContext::Dependency(id)
            };
            {
                let entry = this
                    .task_queue
                    .get_or_put_context(task_id, ())
                    .expect("unreachable");
                if !entry.found_existing {
                    *entry.value_ptr = TaskCallbackList::default();
                }
                entry.value_ptr.push(ctx);
            }

            if dependency.behavior.is_peer() {
                if !install_peer {
                    this.peer_dependencies.write_item(id)?;
                    return Ok(());
                }
            }

            let generated = match run_tasks::generate_network_task_for_tarball(
                this,
                task_id,
                interned(&url),
                dependency.behavior.is_required(),
                id,
                &Package {
                    name: dependency.name,
                    name_hash: dependency.name_hash,
                    resolution: res,
                    ..Package::default()
                },
                crate::network_task::Authorization::NoAuthorization,
            ) {
                // --offline miss: already reported (if required) / skipped (if optional)
                Err(crate::network_task::ForTarballError::Offline) => return Ok(()),
                other => other?,
            };
            if let Some(network_task) = generated {
                enqueue_network_task(this, network_task);
            }
            Ok(())
        }
        dependency::version::Tag::Symlink | dependency::version::Tag::Workspace => {
            let dependency_tag = version.tag;

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
                // First time?
                if result.is_first_time {
                    if verbose_install() {
                        let label = this.lockfile.str(&version.literal);

                        bun_core::pretty_errorln!(
                            "   -> \"{}\": \"{}\" -> {}@{}",
                            bstr::BStr::new(this.lockfile.str(&result.package.name)),
                            bstr::BStr::new(label),
                            bstr::BStr::new(this.lockfile.str(&result.package.name)),
                            result.package.resolution.fmt(
                                this.lockfile.buffers.string_bytes.as_slice(),
                                bun_fmt::PathSep::Auto
                            ),
                        );
                    }
                    // We shouldn't see any dependencies
                    if result.package.dependencies.len > 0 {
                        this.lockfile
                            .scratch
                            .dependency_list_queue
                            .write_item(result.package.dependencies)?;
                    }
                }

                // should not trigger a network call
                debug_assert!(result.task.is_none());

                if cfg!(debug_assertions) {
                    bun_output::scoped_log!(
                        PackageManager,
                        "enqueueDependency({}, {}, {}, {}) = {}",
                        id,
                        <&'static str>::from(version.tag),
                        bstr::BStr::new(this.lockfile.str(&name)),
                        bstr::BStr::new(this.lockfile.str(&version.literal)),
                        result.package.meta.id,
                    );
                }
            } else if dependency.behavior.is_required() {
                if dependency_tag == dependency::version::Tag::Workspace {
                    bun_ast::add_error_pretty!(
                        &mut this.log,
                        None,
                        bun_ast::Loc::EMPTY,
                        "Workspace dependency \"{}\" not found\n\nSearched in <b>{}<r>\n\nWorkspace documentation: https://bun.com/docs/install/workspaces\n\n",
                        bstr::BStr::new(this.lockfile.str(&name)),
                        PackageWorkspaceSearchPathFormatter {
                            lockfile: &this.lockfile,
                            version,
                            quoted: true
                        },
                    );
                } else {
                    bun_ast::add_error_pretty!(
                        &mut this.log,
                        None,
                        bun_ast::Loc::EMPTY,
                        "Package \"{}\" is not linked\n\nTo install a linked package:\n   <cyan>bun link my-pkg-name-from-package-json<r>\n\nTip: the package name is from package.json, which can differ from the folder name.\n\n",
                        bstr::BStr::new(this.lockfile.str(&name)),
                    );
                }
            } else if this.options.log_level.is_verbose() {
                if dependency_tag == dependency::version::Tag::Workspace {
                    bun_ast::add_warning_pretty!(
                        &mut this.log,
                        None,
                        bun_ast::Loc::EMPTY,
                        "Workspace dependency \"{}\" not found\n\nSearched in <b>{}<r>\n\nWorkspace documentation: https://bun.com/docs/install/workspaces\n\n",
                        bstr::BStr::new(this.lockfile.str(&name)),
                        PackageWorkspaceSearchPathFormatter {
                            lockfile: &this.lockfile,
                            version,
                            quoted: true
                        },
                    );
                } else {
                    bun_ast::add_warning_pretty!(
                        &mut this.log,
                        None,
                        bun_ast::Loc::EMPTY,
                        "Package \"{}\" is not linked\n\nTo install a linked package:\n   <cyan>bun link my-pkg-name-from-package-json<r>\n\nTip: the package name is from package.json, which can differ from the folder name.\n\n",
                        bstr::BStr::new(this.lockfile.str(&name)),
                    );
                }
            }
            Ok(())
        }
        dependency::version::Tag::Tarball => {
            let tarball = version.tarball();
            let res: Resolution = match &tarball.uri {
                dependency::tarball::Uri::Local(path) => {
                    Resolution::init(ResolutionTagged::LocalTarball(*path))
                }
                dependency::tarball::Uri::Remote(url) => {
                    Resolution::init(ResolutionTagged::RemoteTarball(*url))
                }
            };

            // First: see if we already loaded the tarball package in-memory
            if let Some(pkg_id) = this.lockfile.get_package_id(name_hash, None, &res) {
                success_fn(this, id, pkg_id);
                return Ok(());
            }

            let url_string = match &tarball.uri {
                dependency::tarball::Uri::Local(path) => *path,
                dependency::tarball::Uri::Remote(url) => *url,
            };
            let url = interned(this.lockfile.str(&url_string));
            let task_id = Task::Id::for_tarball(url.slice());

            if cfg!(debug_assertions) {
                bun_output::scoped_log!(
                    PackageManager,
                    "enqueueDependency({}, {}, {}, {}) = {}",
                    id,
                    <&'static str>::from(version.tag),
                    bstr::BStr::new(this.lockfile.str(&name)),
                    bstr::BStr::new(this.lockfile.str(&version.literal)),
                    bstr::BStr::new(url.slice()),
                );
            }

            if this.lockfile.buffers.resolutions[id as usize] == invalid_package_id {
                if let Some(pkg_id) = resolve_from_appended_task(this, task_id, id) {
                    success_fn(this, id, pkg_id);
                    return Ok(());
                }
            }

            let ctx = if is_root {
                TaskCallbackContext::RootDependency(id)
            } else {
                TaskCallbackContext::Dependency(id)
            };
            {
                let entry = this
                    .task_queue
                    .get_or_put_context(task_id, ())
                    .expect("unreachable");
                if !entry.found_existing {
                    *entry.value_ptr = TaskCallbackList::default();
                }
                entry.value_ptr.push(ctx);
            }

            if dependency.behavior.is_peer() {
                if !install_peer {
                    this.peer_dependencies.write_item(id)?;
                    return Ok(());
                }
            }

            match &tarball.uri {
                dependency::tarball::Uri::Local(_) => {
                    if this.has_created_network_task(task_id, dependency.behavior.is_required()) {
                        return Ok(());
                    }

                    let dep_name = interned(this.lockfile.str(&dependency.name));
                    let task = enqueue_local_tarball(
                        this,
                        task_id,
                        id,
                        dep_name,
                        url,
                        &res,
                        &Integrity::default(),
                    );
                    this.task_batch.push_owned(task);
                }
                dependency::tarball::Uri::Remote(_) => {
                    let network_task: Option<Box<NetworkTask>> =
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
                            crate::network_task::Authorization::NoAuthorization,
                        ) {
                            // --offline miss: already reported / skipped
                            Err(crate::network_task::ForTarballError::Offline) => return Ok(()),
                            other => other?,
                        };
                    if let Some(network_task) = network_task {
                        enqueue_network_task(this, network_task);
                    }
                }
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

/// Unmet peers stay unresolved instead of failing the install; see `may_stay_unresolved`.
#[cold]
#[inline(never)]
fn warn_unmet_peer_dependency(
    this: &mut PackageManager,
    name: SemverString,
    version: &dependency::Version,
) {
    bun_ast::add_warning_pretty!(
        &mut this.log,
        None,
        bun_ast::Loc::EMPTY,
        "No version matching \"{}\" found for peer dependency \"{}\"<r> <d>(but package exists)<r>",
        bstr::BStr::new(this.lockfile.str(&version.literal)),
        bstr::BStr::new(this.lockfile.str(&name)),
    );
}

/// Allocate and initialise an `.extract` Task for an npm tarball.
/// Shared by the buffered path (`enqueue_extract_npm_package`) and the
/// streaming path (`create_extract_task_for_streaming`) so both produce
/// an identical Task shape; only the return type differs.
fn init_extract_task(
    this: &PackageManager,
    tarball: &ExtractTarball,
    task_id: Task::Id,
    network_task: Option<Box<NetworkTask>>,
) -> Box<Task::Task> {
    Task::Task::new(
        this,
        task_id,
        crate::package_manager_task::Request::Extract {
            network: network_task,
            tarball: ExtractTarball {
                skip_verify: !this
                    .options
                    .do_
                    .contains(crate::package_manager_real::options::Do::VERIFY_INTEGRITY),
                ..*tarball
            },
        },
    )
}

pub fn enqueue_extract_npm_package(
    this: &PackageManager,
    tarball: &ExtractTarball,
    network_task: Box<NetworkTask>,
) -> Box<Task::Task> {
    let task_id = network_task.task_id;
    init_extract_task(this, tarball, task_id, Some(network_task))
}

/// Allocate the extract Task up front so the streaming extractor can
/// publish it to `resolve_tasks` when extraction finishes. The network task
/// holds it (`streaming_extract_task`) until then, so `network` starts empty.
pub fn create_extract_task_for_streaming(
    this: &PackageManager,
    tarball: &ExtractTarball,
    task_id: Task::Id,
) -> Box<Task::Task> {
    init_extract_task(this, tarball, task_id, None)
}

fn enqueue_git_clone(
    this: &mut PackageManager,
    task_id: Task::Id,
    name: StringOrTinyString,
    repository: &Repository,
    dependency: &Dependency,
    res: &Resolution,
    // if patched then we need to do apply step after network task is done
    patch_name_and_version_hash: Option<u64>,
) -> Box<Task::Task> {
    // The patched-dependency entry can be missing (or its hash not yet
    // computed) when install state went stale — e.g. the patch was removed
    // from package.json, leaving the hash only in
    // `patched_dependencies_to_remove`. Install the package unpatched instead
    // of panicking.
    let patch = patch_name_and_version_hash.and_then(|h| {
        Some((
            h,
            this.lockfile
                .patched_dependencies
                .get(&h)?
                .patchfile_hash()?,
        ))
    });
    let request = crate::package_manager_task::Request::GitClone(
        crate::package_manager_task::GitCloneRequest {
            name,
            url: interned(this.lockfile.str(&repository.repo)),
            res: *res,
        },
    );
    let mut task = Task::Task::new(this, task_id, request);
    if let Some((h, patch_hash)) = patch {
        let dep = dependency;
        let pkg_id = match this
            .lockfile
            .package_index
            .get(&dep.name_hash)
            .unwrap_or_else(|| panic!("Package not found"))
        {
            PackageIndexEntry::Id(p) => *p,
            PackageIndexEntry::Ids(ps) => ps[0], // TODO is this correct
        };
        let mut pt = PatchTask::new_apply_patch_hash(this, pkg_id, patch_hash, h);
        pt.callback.apply_mut().task_id = Some(task_id);
        task.apply_patch_task = Some(pt);
    }
    task
}

/// `git log`: resolves `committish` in the bare repository of `clone_id`.
fn enqueue_git_commit(
    this: &mut PackageManager,
    task_id: Task::Id,
    clone_id: Task::Id,
    name: StringOrTinyString,
    url: StringOrTinyString,
    committish: StringOrTinyString,
) -> Box<Task::Task> {
    let request = crate::package_manager_task::Request::GitCommit(
        crate::package_manager_task::GitCommitRequest {
            clone_id,
            name,
            url,
            committish,
        },
    );
    Task::Task::new(this, task_id, request)
}

pub fn enqueue_git_checkout(
    this: &mut PackageManager,
    task_id: Task::Id,
    dir: Fd,
    dependency_id: DependencyID,
    name: StringOrTinyString,
    resolution: &Resolution,
    resolved: StringOrTinyString,
    // if patched then we need to do apply step after network task is done
    patch_name_and_version_hash: Option<u64>,
) -> Box<Task::Task> {
    // The patched-dependency entry can be missing (or its hash not yet
    // computed) when install state went stale — e.g. the patch was removed
    // from package.json, leaving the hash only in
    // `patched_dependencies_to_remove`. Install the package unpatched instead
    // of panicking.
    let patch = patch_name_and_version_hash.and_then(|h| {
        Some((
            h,
            this.lockfile
                .patched_dependencies
                .get(&h)?
                .patchfile_hash()?,
        ))
    });
    let request = crate::package_manager_task::Request::GitCheckout(
        crate::package_manager_task::GitCheckoutRequest {
            repo_dir: dir,
            resolution: *resolution,
            dependency_id,
            name,
            // `resolution.tag == Git` for the git-checkout path.
            url: interned(this.lockfile.str(&resolution.git().repo)),
            resolved,
        },
    );
    let mut task = Task::Task::new(this, task_id, request);
    if let Some((h, patch_hash)) = patch {
        let dep_name_hash = this.lockfile.buffers.dependencies[dependency_id as usize].name_hash;
        let pkg_id = match this
            .lockfile
            .package_index
            .get(&dep_name_hash)
            .unwrap_or_else(|| panic!("Package not found"))
        {
            PackageIndexEntry::Id(p) => *p,
            PackageIndexEntry::Ids(ps) => ps[0], // TODO is this correct
        };
        let mut pt = PatchTask::new_apply_patch_hash(this, pkg_id, patch_hash, h);
        pt.callback.apply_mut().task_id = Some(task_id);
        task.apply_patch_task = Some(pt);
    }
    task
}

fn enqueue_local_tarball(
    this: &mut PackageManager,
    task_id: Task::Id,
    dependency_id: DependencyID,
    name: StringOrTinyString,
    path: StringOrTinyString,
    resolution: &Resolution,
    integrity: &Integrity,
) -> Box<Task::Task> {
    // Resolve the on-disk tarball path here on the main thread. The task
    // callback runs on a ThreadPool worker and must not read
    // `lockfile.packages` / `lockfile.buffers.string_bytes`: those buffers
    // can be reallocated concurrently by the main thread while processing
    // other dependencies (e.g. `append_package` / `StringBuilder::allocate`
    // in `Package::from_npm`).
    let cache_dir = get_cache_directory(this);
    let temp_dir = get_temporary_directory(this).handle.fd();
    let mut abs_buf = PathBuffer::uninit();
    let (tarball_path, normalize): (StringOrTinyString, bool) =
        match local_tarball_base_dir(&this.lockfile, dependency_id, path.slice()) {
            None => (interned(path.slice()), true),
            Some(base_dir) => (
                interned(Path::resolve_path::join_abs_string_buf::<
                    Path::platform::Auto,
                >(
                    FileSystem::instance().top_level_dir(),
                    &mut abs_buf,
                    &[base_dir, path.slice()],
                )),
                false,
            ),
        };

    let request = crate::package_manager_task::Request::LocalTarball {
        tarball: ExtractTarball {
            package_manager: bun_ptr::BackRef::new(this),
            name,
            resolution: *resolution,
            // `ExtractTarball::{cache_dir,temp_dir}` are borrowed views — the
            // descriptors are owned by the `PackageManager` singleton and the
            // `TemporaryDirectory` once-cell. They must be `Fd`, not owning `Dir`.
            cache_dir,
            temp_dir,
            dependency_id,
            integrity: *integrity,
            url: path,
            skip_verify: false,
            in_trusted_dependencies: false,
            github_resolved: StringOrTinyString::init(b""),
        },
        tarball_path,
        normalize,
    };
    Task::Task::new(this, task_id, request)
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

pub(crate) enum ResolvedPackageTask {
    /// Pending network task to schedule
    NetworkTask(Box<NetworkTask>),

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

fn get_or_put_resolved_package_with_find_result(
    this: &mut PackageManager,
    name_hash: PackageNameHash,
    name: SemverString,
    dependency: &Dependency,
    version: &dependency::Version,
    dependency_id: DependencyID,
    behavior: Behavior,
    manifest: &Npm::PackageManifest,
    find_result: Npm::FindResult,
    install_peer: bool,
    success_fn: SuccessFn,
) -> crate::Result<Option<ResolvedPackageResult>> {
    let should_update = this.to_update
        && if !this.update_requests.is_empty() {
            // bun update <name>: every in-scope <name> row (declared or `npm:<name>@…` aliased, see update_scope); other resolutions stay pinned.
            let string_buf = this.lockfile.buffers.string_bytes.as_slice();
            (this.is_update_request(dependency.name_hash, dependency.name.slice(string_buf))
                || (name_hash != dependency.name_hash
                    && this.is_update_request(name_hash, name.slice(string_buf))))
                && crate::update_scope::UpdateScope::of(&*this)
                    .contains_dependency(&this.lockfile, dependency_id)
        } else if let Some(targets) = this.update_target_workspaces.as_deref() {
            // `bun update -r`/`--filter`: direct deps of the selected workspaces; catalogs are root-scoped.
            dependency.version.tag == dependency::version::Tag::Catalog
                || this
                    .lockfile
                    .is_dependency_of_workspace_in(targets, dependency_id)
        } else {
            // Bare `bun update`: direct deps of the cwd workspace; catalogs are root-scoped.
            dependency.version.tag == dependency::version::Tag::Catalog
                || this.is_root_dependency(dependency_id)
        };

    // A patched package is held while the range still allows it (update_transitive holds the transitive rows the same way); audit fix does not set to_update and moves it.
    if should_update && !behavior.is_peer() {
        if let Some(id) = patched_package_satisfying(this, name_hash, version) {
            this.kept_patched.push(id);
            success_fn(this, dependency_id, id);
            return Ok(Some(ResolvedPackageResult {
                package: *this.lockfile.packages.get(id as usize),
                is_first_time: false,
                task: None,
            }));
        }
    }

    // Was this package already allocated? Let's reuse the existing one.
    //
    // Determinism: passing `version` here unconditionally lets a
    // peer like `>= 1.0.2` collapse onto whichever sibling-appended entry
    // (e.g. `1.0.9`) happens to be highest in the index *at this instant* — a
    // network-order artefact that the `^1.0.2` peer-hoisting test already
    // todoIf's on macOS. The floor guard in `get_package_id` was
    // meant to close that, but its exact-pinned/same-major exemptions reopen
    // it when *every* candidate is an exact-pinned same-major sibling
    // (`uses-a-dep-1..10`). For deferred peers, suppress the satisfies-
    // fallback so only an exact `eql(find_result)` can bind here; everything
    // else falls through to the `is_peer && !install_peer` branch below and is
    // resolved deterministically by phase 2's descending-index scan in
    // `get_or_put_resolved_package`. `*` is left alone — it expresses no
    // version preference, and the "peer *" hoisting test depends on it
    // deduping to whatever sibling pin exists rather than the manifest floor.
    let suppress_peer_satisfies = behavior.is_peer()
        && !install_peer
        && !(version.tag == dependency::version::Tag::Npm && version.npm().version.is_star());
    if let Some(id) = this.lockfile.get_package_id(
        name_hash,
        if should_update || suppress_peer_satisfies {
            None
        } else {
            Some(version)
        },
        &Resolution::init(ResolutionTagged::Npm(ResolutionNpmValue {
            version: find_result.version,
            url: find_result.package.tarball_url.value,
        })),
    ) {
        success_fn(this, dependency_id, id);
        return Ok(Some(ResolvedPackageResult {
            package: *this.lockfile.packages.get(id as usize),
            is_first_time: false,
            task: None,
        }));
    } else if behavior.is_peer() && !install_peer {
        return Ok(None);
    }

    // append_package sets the PackageID on the package
    let package = {
        let PackageManager {
            lockfile,
            known_npm_aliases,
            log,
            ..
        } = &mut *this;
        let package = Package::from_npm(
            known_npm_aliases,
            lockfile,
            log,
            manifest,
            find_result.version,
            find_result.package,
            Features::NPM,
        )?;
        lockfile.append_package(&package)?
    };

    debug_assert!(package.meta.id != invalid_package_id);
    // Record exact-version pins so `Lockfile::get_package_id`'s
    // order-independence guard can tell them apart from range-resolved
    // entries (which it treats as network-order artefacts).
    if version.tag == dependency::version::Tag::Npm && version.npm().version.is_exact() {
        this.lockfile.mark_exact_pin(package.meta.id);
    }
    // `success_fn` runs on every return below (including the `?` paths).
    let result = (|| -> crate::Result<Option<ResolvedPackageResult>> {
        let this = &mut *this;

        // non-null if the package is in "patchedDependencies"
        let mut name_and_version_hash: Option<u64> = None;
        let mut patchfile_hash: Option<u64> = None;

        let result = match determine_preinstall_state(
            this,
            &package,
            &mut name_and_version_hash,
            &mut patchfile_hash,
        ) {
            // Is this package already in the cache?
            // We don't need to download the tarball, but we should enqueue dependencies
            install::PreinstallState::Done => Some(ResolvedPackageResult {
                package,
                is_first_time: true,
                task: None,
            }),
            // Do we need to download the tarball?
            install::PreinstallState::Extract => 'extract: {
                // Skip tarball download when prefetch_resolved_tarballs is disabled (e.g., --lockfile-only)
                if !this
                    .options
                    .do_
                    .contains(crate::package_manager_real::options::Do::PREFETCH_RESOLVED_TARBALLS)
                {
                    break 'extract Some(ResolvedPackageResult {
                        package,
                        is_first_time: true,
                        task: None,
                    });
                }

                let task_id = Task::Id::for_npm_package(
                    this.lockfile.str(&name),
                    package.resolution.npm().version,
                );
                debug_assert!(!this.network_dedupe_map.contains(&task_id));

                break 'extract Some(ResolvedPackageResult {
                    package,
                    is_first_time: true,
                    task: Some(ResolvedPackageTask::NetworkTask(
                        run_tasks::generate_network_task_for_tarball(
                            this,
                            task_id,
                            interned(manifest.str(&find_result.package.tarball_url)),
                            behavior.is_required(),
                            dependency_id,
                            &package,
                            // its npm.
                            crate::network_task::Authorization::AllowAuthorization,
                        )?
                        .expect("unreachable"),
                    )),
                });
            }
            install::PreinstallState::CalcPatchHash => Some(ResolvedPackageResult {
                package,
                is_first_time: true,
                task: Some(ResolvedPackageTask::PatchTask(
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
            }),
            install::PreinstallState::ApplyPatch => Some(ResolvedPackageResult {
                package,
                is_first_time: true,
                task: Some(ResolvedPackageTask::PatchTask(
                    PatchTask::new_apply_patch_hash(
                        this,
                        package.meta.id,
                        patchfile_hash.unwrap(),
                        name_and_version_hash.unwrap(),
                    ),
                )),
            }),
            _ => unreachable!(),
        };

        Ok(result)
    })();
    success_fn(this, dependency_id, package.meta.id);
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
    if install_peer && behavior.is_peer() {
        if let Some(index) = this.lockfile.package_index.get(&name_hash) {
            let resolutions = this.lockfile.packages.items_resolution();
            match index {
                PackageIndexEntry::Id(existing_id) => {
                    let existing_id = *existing_id;
                    if (existing_id as usize) < resolutions.len() {
                        let existing_resolution = resolutions[existing_id as usize];
                        if resolution_satisfies_dependency(this, &existing_resolution, version) {
                            success_fn(this, dependency_id, existing_id);
                            return Ok(Some(ResolvedPackageResult {
                                // we must fetch it from the packages array again, incase the package array mutates the value in the `success_fn`
                                package: *this.lockfile.packages.get(existing_id as usize),
                                ..Default::default()
                            }));
                        }

                        let res_tag = resolutions[existing_id as usize].tag;
                        let ver_tag = version.tag;
                        if (res_tag == ResolutionTag::Npm
                            && ver_tag == dependency::version::Tag::Npm)
                            || (res_tag == ResolutionTag::Git
                                && ver_tag == dependency::version::Tag::Git)
                            || (res_tag == ResolutionTag::Github
                                && ver_tag == dependency::version::Tag::Github)
                        {
                            let existing_package = this.lockfile.packages.get(existing_id as usize);
                            this.log.add_warning_fmt(
                                None,
                                bun_ast::Loc::EMPTY,
                                format_args!(
                                    "incorrect peer dependency \"{}@{}\"",
                                    existing_package
                                        .name
                                        .fmt(this.lockfile.buffers.string_bytes.as_slice()),
                                    existing_package.resolution.fmt(
                                        this.lockfile.buffers.string_bytes.as_slice(),
                                        bun_fmt::PathSep::Auto
                                    ),
                                ),
                            );
                            success_fn(this, dependency_id, existing_id);
                            return Ok(Some(ResolvedPackageResult {
                                // we must fetch it from the packages array again, incase the package array mutates the value in the `success_fn`
                                package: *this.lockfile.packages.get(existing_id as usize),
                                ..Default::default()
                            }));
                        }
                    }
                }
                PackageIndexEntry::Ids(list) => {
                    for &existing_id in list.iter() {
                        if (existing_id as usize) < resolutions.len() {
                            let existing_resolution = resolutions[existing_id as usize];
                            if resolution_satisfies_dependency(this, &existing_resolution, version)
                            {
                                success_fn(this, dependency_id, existing_id);
                                return Ok(Some(ResolvedPackageResult {
                                    package: *this.lockfile.packages.get(existing_id as usize),
                                    ..Default::default()
                                }));
                            }
                        }
                    }

                    if (list[0] as usize) < resolutions.len() {
                        let res_tag = resolutions[list[0] as usize].tag;
                        let ver_tag = version.tag;
                        if (res_tag == ResolutionTag::Npm
                            && ver_tag == dependency::version::Tag::Npm)
                            || (res_tag == ResolutionTag::Git
                                && ver_tag == dependency::version::Tag::Git)
                            || (res_tag == ResolutionTag::Github
                                && ver_tag == dependency::version::Tag::Github)
                        {
                            let existing_package_id = list[0];
                            let existing_package =
                                this.lockfile.packages.get(existing_package_id as usize);
                            this.log.add_warning_fmt(
                                None,
                                bun_ast::Loc::EMPTY,
                                format_args!(
                                    "incorrect peer dependency \"{}@{}\"",
                                    existing_package
                                        .name
                                        .fmt(this.lockfile.buffers.string_bytes.as_slice()),
                                    existing_package.resolution.fmt(
                                        this.lockfile.buffers.string_bytes.as_slice(),
                                        bun_fmt::PathSep::Auto
                                    ),
                                ),
                            );
                            success_fn(this, dependency_id, list[0]);
                            return Ok(Some(ResolvedPackageResult {
                                // we must fetch it from the packages array again, incase the package array mutates the value in the `success_fn`
                                package: *this.lockfile.packages.get(existing_package_id as usize),
                                ..Default::default()
                            }));
                        }
                    }
                }
            }
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
            'resolve_from_workspace: {
                if version.tag == dependency::version::Tag::Npm {
                    let workspace_path = if this.lockfile.workspace_paths.count() > 0 {
                        this.lockfile.workspace_paths.get(&name_hash)
                    } else {
                        None
                    };
                    let workspace_version = this.lockfile.workspace_versions.get(&name_hash);
                    let buf = this.lockfile.buffers.string_bytes.as_slice();
                    let npm_group = &version.npm().version;
                    if this.options.link_workspace_packages
                        && ((workspace_version.is_some()
                            && npm_group.satisfies(*workspace_version.unwrap(), buf, buf))
                            // https://github.com/oven-sh/bun/pull/10899#issuecomment-2099609419
                            // if the workspace doesn't have a version, it can still be used if
                            // dependency version is wildcard
                            || (workspace_path.is_some() && npm_group.is_star()))
                    {
                        let Some(workspace_package_id) =
                            root_workspace_package_id(&this.lockfile, name_hash)
                        else {
                            break 'resolve_from_workspace;
                        };
                        // make sure verify_resolutions sees this resolution as a valid package id
                        success_fn(this, dependency_id, workspace_package_id);
                        return Ok(Some(ResolvedPackageResult {
                            package: *this.lockfile.packages.get(workspace_package_id as usize),
                            is_first_time: false,
                            task: None,
                        }));
                    }
                }
            }

            // Resolve the version from the loaded NPM manifest. `manifest`
            // is held across `&mut PackageManager` calls that never touch
            // `manifests`, so take the map out for the duration.
            let cache_ctx = this.manifest_disk_cache_ctx();
            let needs_ext = this.options.minimum_release_age_ms.is_some();
            let mut manifests = core::mem::take(&mut this.manifests);
            let result = (|| -> crate::Result<Option<ResolvedPackageResult>> {
                let this = &mut *this;
                let Some(manifest) = manifests.by_name_hash(
                    cache_ctx,
                    this.options
                        .scope_for_package_name(this.lockfile.str(&name)),
                    this.lockfile.str(&name),
                    name_hash,
                    needs_ext,
                ) else {
                    return Ok(None); // manifest might still be downloading. This feels unreliable.
                };
                let manifest: &Npm::PackageManifest = manifest;

                // `bun update -r/--filter --latest`: resolve targeted workspaces' npm deps by dist-tag `latest`.
                let latest_for_target = !version_was_replaced
                    && matches!(
                        version.tag,
                        dependency::version::Tag::Npm | dependency::version::Tag::DistTag
                    )
                    && this.to_update
                    && this.update_requests.is_empty()
                    && this
                        .options
                        .do_
                        .contains(crate::package_manager::options::Do::UPDATE_TO_LATEST)
                    && this.update_target_workspaces.as_deref().is_some_and(|t| {
                        this.lockfile
                            .is_dependency_of_workspace_in(t, dependency_id)
                    });

                let version_result: Npm::FindVersionResult = match version.tag {
                    _ if latest_for_target => manifest.find_by_dist_tag_with_filter(
                        b"latest",
                        this.options.minimum_release_age_ms,
                        this.options.minimum_release_age_excludes,
                    ),
                    dependency::version::Tag::DistTag => manifest.find_by_dist_tag_with_filter(
                        this.lockfile.str(&version.dist_tag().tag),
                        this.options.minimum_release_age_ms,
                        this.options.minimum_release_age_excludes,
                    ),
                    dependency::version::Tag::Npm => manifest.find_best_version_with_filter(
                        &version.npm().version,
                        this.lockfile.buffers.string_bytes.as_slice(),
                        this.options.minimum_release_age_ms,
                        this.options.minimum_release_age_excludes,
                    ),
                    _ => unreachable!(),
                };

                let find_result_opt: Option<Npm::FindResult> = match version_result {
                    Npm::FindVersionResult::Found(result) => Some(result),
                    Npm::FindVersionResult::FoundWithFilter {
                        result,
                        newest_filtered,
                    } => 'blk: {
                        let package_name = this.lockfile.str(&name);
                        if this.options.log_level.is_verbose() {
                            if let Some(newest) = &newest_filtered {
                                let min_age_seconds =
                                    this.options.minimum_release_age_ms.unwrap_or(0.0) / MS_PER_S;
                                let manifest_buf: &[u8] = &manifest.string_buf;
                                match version.tag {
                                    dependency::version::Tag::DistTag => {
                                        let tag_str = this.lockfile.str(&version.dist_tag().tag);
                                        bun_core::pretty_errorln!(
                                            "<d>[minimum-release-age]<r> <b>{}@{}<r> selected <green>{}<r> instead of <yellow>{}<r> due to {}-second filter",
                                            bstr::BStr::new(package_name),
                                            bstr::BStr::new(tag_str),
                                            result.version.fmt(manifest_buf),
                                            newest.fmt(manifest_buf),
                                            min_age_seconds,
                                        );
                                    }
                                    dependency::version::Tag::Npm => {
                                        let version_str = &version.npm().version.fmt(manifest_buf);
                                        bun_core::pretty_errorln!(
                                            "<d>[minimum-release-age]<r> <b>{}<r>@{}<r> selected <green>{}<r> instead of <yellow>{}<r> due to {}-second filter",
                                            bstr::BStr::new(package_name),
                                            version_str,
                                            result.version.fmt(manifest_buf),
                                            newest.fmt(manifest_buf),
                                            min_age_seconds,
                                        );
                                    }
                                    _ => unreachable!(),
                                }
                            }
                        }

                        break 'blk Some(result);
                    }
                    Npm::FindVersionResult::Err(err_type) => match err_type {
                        Npm::FindVersionError::TooRecent
                        | Npm::FindVersionError::AllVersionsTooRecent => {
                            return Err(crate::Error::TooRecentVersion);
                        }
                        Npm::FindVersionError::NotFound => None, // Handle below with existing logic
                    },
                };

                let find_result = match find_result_opt {
                    Some(r) => r,
                    None => {
                        'resolve_workspace_from_dist_tag: {
                            // choose a workspace for a dist_tag only if a version was not found
                            if version.tag == dependency::version::Tag::DistTag {
                                let workspace_path = if this.lockfile.workspace_paths.count() > 0 {
                                    this.lockfile.workspace_paths.get(&name_hash)
                                } else {
                                    None
                                };
                                if workspace_path.is_some() {
                                    let Some(workspace_package_id) =
                                        root_workspace_package_id(&this.lockfile, name_hash)
                                    else {
                                        break 'resolve_workspace_from_dist_tag;
                                    };
                                    // make sure verify_resolutions sees this resolution as a valid package id
                                    success_fn(this, dependency_id, workspace_package_id);
                                    return Ok(Some(ResolvedPackageResult {
                                        package: *this
                                            .lockfile
                                            .packages
                                            .get(workspace_package_id as usize),
                                        is_first_time: false,
                                        task: None,
                                    }));
                                }
                            }
                        }

                        // `Ok(None)` in the peer pass makes the caller reload the manifest and retry.
                        if behavior.is_peer() && !install_peer {
                            return Ok(None);
                        }

                        return match version.tag {
                            dependency::version::Tag::Npm => Err(crate::Error::NoMatchingVersion),
                            dependency::version::Tag::DistTag => Err(crate::Error::DistTagNotFound),
                            _ => unreachable!(),
                        };
                    }
                };

                let find_result = if version_was_replaced {
                    find_result
                } else {
                    let locked = if latest_for_target {
                        locked_version_in_lockfile(this, name_hash, version)
                    } else {
                        locked_version_of_invoking_workspace_row(
                            this,
                            dependency,
                            dependency_id,
                            version,
                        )
                    };
                    keep_locked_if_ahead(manifest, find_result, &locked)
                };

                get_or_put_resolved_package_with_find_result(
                    this,
                    name_hash,
                    name,
                    dependency,
                    version,
                    dependency_id,
                    behavior,
                    manifest,
                    find_result,
                    install_peer,
                    success_fn,
                )
            })();
            this.manifests = manifests;
            result
        }

        dependency::version::Tag::Folder => {
            let folder = *version.folder();
            let res: FolderResolutionValue = 'res: {
                if this.lockfile.is_workspace_dependency(dependency_id) {
                    // relative to cwd
                    let mut buf2 = PathBuffer::uninit();
                    let folder_path_abs = abs_from_top_level(this.lockfile.str(&folder), &mut buf2);

                    break 'res FolderResolution::get_or_put(
                        GlobalOrRelative::Relative(dependency::version::Tag::Folder),
                        version,
                        folder_path_abs,
                        this,
                    );
                }

                // transitive folder dependencies do not have their dependencies resolved
                if crate::bin::bin_target_escapes_package_dir(this.lockfile.str(&folder)) {
                    // overrides/resolutions are only ever parsed from the root
                    // package.json, so a folder path that reached here via an
                    // override was written by the user and is trusted the same
                    // as a direct dependency of the root.
                    let buf = this.lockfile.buffers.string_bytes.as_slice();
                    if !this.lockfile.overrides.contains_name(
                        dependency.name_hash,
                        dependency.name.slice(buf),
                        buf,
                    ) {
                        break 'res FolderResolutionValue::Err(crate::Error::MissingPackageJSON);
                    }
                }

                let mut package = Package::default();

                {
                    // only need name and path
                    // copy the two slices out of `string_bytes`
                    // before creating the builder — `StringBuilder::allocate`
                    // may grow the buffer and invalidate borrows into it, so
                    // owned copies are required regardless of borrowck.
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

                // these are always new
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
                    let Some(workspace_package_id) =
                        root_workspace_package_id(&this.lockfile, name_hash)
                    else {
                        return Err(crate::Error::MissingPackageJSON);
                    };
                    success_fn(this, dependency_id, workspace_package_id);
                    return Ok(Some(ResolvedPackageResult {
                        package: *this.lockfile.packages.get(workspace_package_id as usize),
                        ..Default::default()
                    }));
                }
            }
            // package name hash should be used to find workspace path from map
            let workspace_path_raw: SemverString = this
                .lockfile
                .workspace_paths
                .get(&name_hash)
                .copied()
                .unwrap_or_else(|| *version.workspace());
            let mut buf2 = PathBuffer::uninit();
            let workspace_path_u8 =
                abs_from_top_level(this.lockfile.str(&workspace_path_raw), &mut buf2);

            let res = FolderResolution::get_or_put(
                GlobalOrRelative::Relative(dependency::version::Tag::Workspace),
                version,
                workspace_path_u8,
                this,
            );

            resolved_folder_package(this, res, dependency_id, success_fn)
        }
        dependency::version::Tag::Symlink => {
            let mut buf = PathBuffer::uninit();
            let mut buf2 = PathBuffer::uninit();
            let link_dir = copy_into(package_manager_real::global_link_dir_path(this), &mut buf);
            let symlink_path = copy_into(this.lockfile.str(version.symlink()), &mut buf2);
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

/// `path` copied into `buf`, so it no longer borrows its source.
fn copy_into<'b>(path: &[u8], buf: &'b mut PathBuffer) -> &'b [u8] {
    buf[..path.len()].copy_from_slice(path);
    &buf[..path.len()]
}

/// `path` made absolute against the top-level directory, into `buf`.
fn abs_from_top_level<'b>(path: &[u8], buf: &'b mut PathBuffer) -> &'b [u8] {
    if bun_paths::is_absolute(path) {
        copy_into(path, buf)
    } else {
        Path::resolve_path::join_abs_string_buf::<Path::platform::Auto>(
            FileSystem::instance().top_level_dir(),
            buf,
            &[path],
        )
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

/// `--latest` never moves a row below what bun.lock already has (e.g. a prerelease or a version ahead of the tag).
fn keep_locked_if_ahead<'m>(
    manifest: &'m Npm::PackageManifest,
    found: Npm::FindResult<'m>,
    locked: &Option<(Semver::Version, &[u8])>,
) -> Npm::FindResult<'m> {
    let &Some((locked, locked_buf)) = locked else {
        return found;
    };
    if found
        .version
        .order(locked, &manifest.string_buf, locked_buf)
        != core::cmp::Ordering::Less
    {
        return found;
    }
    manifest.find_by_version(locked).unwrap_or(found)
}

/// Bare `bun update --latest` in a workspace: the row was rewritten to a dist-tag before install, so its locked version lives in `updating_packages`; rows that were dist-tag literals in package.json follow the tag.
fn locked_version_of_invoking_workspace_row<'a>(
    this: &'a PackageManager,
    dependency: &Dependency,
    dependency_id: DependencyID,
    version: &dependency::Version,
) -> Option<(Semver::Version, &'a [u8])> {
    if version.tag != dependency::version::Tag::DistTag
        || !this.to_update
        || !this
            .options
            .do_
            .contains(crate::package_manager::options::Do::UPDATE_TO_LATEST)
    {
        return None;
    }
    let own_rows = this.root_package_id.id?;
    if !this.lockfile.packages.items_dependencies()[own_rows as usize].contains(dependency_id) {
        return None;
    }
    let entry = this
        .updating_packages
        .get(this.lockfile.str(&dependency.name))?;
    if dependency::version::Tag::infer(&entry.original_version_literal)
        == dependency::version::Tag::DistTag
    {
        return None;
    }
    Some((entry.original_version?, &entry.original_version_string_buf))
}

/// `bun update -r/--filter --latest`: the row still carries its package.json range, so its locked version is the lockfile-loaded instance that range accepts (`package_index` lists highest first); dist-tag rows follow the tag.
fn locked_version_in_lockfile<'a>(
    this: &'a PackageManager,
    name_hash: PackageNameHash,
    version: &dependency::Version,
) -> Option<(Semver::Version, &'a [u8])> {
    if version.tag != dependency::version::Tag::Npm {
        return None;
    }
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    let candidates = lockfile.package_index.get(&name_hash)?.as_slice();
    let pkg_res = lockfile.packages.items_resolution();
    let buf = lockfile.buffers.string_bytes.as_slice();
    let range = &version.npm().version;
    candidates
        .iter()
        .copied()
        .filter(|&id| id < lockfile.loaded_package_count)
        .map(|id| &pkg_res[id as usize])
        .filter(|res| res.tag == ResolutionTag::Npm)
        .map(|res| res.npm().version)
        .find(|&locked| range.satisfies(locked, buf, buf))
        .map(|locked| (locked, buf))
}

fn resolution_satisfies_dependency(
    this: &PackageManager,
    resolution: &Resolution,
    dependency: &dependency::Version,
) -> bool {
    let buf = this.lockfile.buffers.string_bytes.as_slice();
    resolution.satisfies_dependency_version(dependency, buf, buf)
}

fn patched_package_satisfying(
    this: &PackageManager,
    name_hash: PackageNameHash,
    version: &dependency::Version,
) -> Option<PackageID> {
    let lockfile: &Lockfile::Lockfile = &this.lockfile;
    if lockfile.patched_dependencies.count() == 0 {
        return None;
    }
    let candidates = lockfile.package_index.get(&name_hash)?.as_slice();
    let pkg_res = lockfile.packages.items_resolution();
    let buf = lockfile.buffers.string_bytes.as_slice();
    candidates.iter().copied().find(|&id| {
        let res = &pkg_res[id as usize];
        res.tag == ResolutionTag::Npm
            && res.satisfies_dependency_version(version, buf, buf)
            && lockfile
                .patched_dependencies
                .contains(&Semver::string::Builder::string_hash(
                    &crate::dedupe::label(lockfile, id),
                ))
    })
}

// ──────────────────────────────────────────────────────────────────────────
// `impl PackageManager` — inherent-method facade over the free fns above.
//
// Sibling files (PackageManagerLifecycle, …Directories,
// run_tasks) all expose an `impl PackageManager` block. Match that
// pattern here so cross-file callers can keep the `.method()` shape.
// ──────────────────────────────────────────────────────────────────────────

impl PackageManager {
    #[inline]
    pub fn enqueue_dependency_list(&mut self, dependencies_list: Lockfile::DependencySlice) {
        enqueue_dependency_list(self, dependencies_list)
    }

    #[inline]
    pub(crate) fn enqueue_tarball_for_download(
        &mut self,
        dependency_id: DependencyID,
        package_id: PackageID,
        url: StringOrTinyString,
        task_context: TaskCallbackContext,
    ) -> Result<(), EnqueueTarballForDownloadError> {
        enqueue_tarball_for_download(self, dependency_id, package_id, url, task_context)
    }

    #[inline]
    pub(crate) fn enqueue_tarball_for_reading(
        &mut self,
        dependency_id: DependencyID,
        package_id: PackageID,
        alias: Semver::String,
        resolution: &Resolution,
        task_context: TaskCallbackContext,
    ) {
        enqueue_tarball_for_reading(
            self,
            dependency_id,
            package_id,
            alias,
            resolution,
            task_context,
        )
    }

    #[inline]
    pub(crate) fn enqueue_git_for_checkout(
        &mut self,
        dependency_id: DependencyID,
        alias: Semver::String,
        resolution: &Resolution,
        task_context: TaskCallbackContext,
        patch_name_and_version_hash: Option<u64>,
    ) -> GitEnqueueResult {
        enqueue_git_for_checkout(
            self,
            dependency_id,
            alias,
            resolution,
            task_context,
            patch_name_and_version_hash,
        )
    }

    #[inline]
    pub(crate) fn enqueue_package_for_download(
        &mut self,
        name: Semver::String,
        dependency_id: DependencyID,
        package_id: PackageID,
        version: Semver::Version,
        url: Semver::String,
        task_context: TaskCallbackContext,
    ) -> Result<(), EnqueuePackageForDownloadError> {
        enqueue_package_for_download(
            self,
            name,
            dependency_id,
            package_id,
            version,
            url,
            task_context,
        )
    }
}
