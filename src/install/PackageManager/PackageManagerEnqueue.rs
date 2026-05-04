use core::sync::atomic::Ordering;

use bun_core::{fmt as bun_fmt, Output};
use bun_logger as logger;
use bun_paths::{self as Path, PathBuffer};
use bun_semver::{self as Semver, String as SemverString};
use bun_str::strings::{self, StringOrTinyString};
use bun_threading::ThreadPool;
use bun_fs::FileSystem;
use bun_sys::Fd;

use bun_install::{
    self as install, invalid_package_id, Behavior, Dependency, DependencyID, ExtractTarball,
    Features, FolderResolution, Integrity, Npm, PackageID, PackageNameHash, PatchTask, Repository,
    Resolution, Task, TaskCallbackContext,
};
use bun_install::lockfile::{self as Lockfile, Package};
use bun_install::NetworkTask;
use bun_install::package_manager::{
    assign_resolution, assign_root_resolution, fail_root_resolution, FailFn, PackageManager,
    SuccessFn, TaskCallbackList,
};

bun_output::declare_scope!(PackageManager, hidden);

pub type EnqueuePackageForDownloadError = bun_install::network_task::ForTarballError;
pub type EnqueueTarballForDownloadError = bun_install::network_task::ForTarballError;

const MS_PER_S: u64 = 1000;

// ─────────────────────────────────────────────────────────────────────────────

pub fn enqueue_dependency_with_main(
    this: &mut PackageManager,
    id: DependencyID,
    /// This must be a *const to prevent UB
    dependency: &Dependency,
    resolution: PackageID,
    install_peer: bool,
) -> Result<(), bun_core::Error> {
    enqueue_dependency_with_main_and_success_fn(
        this,
        id,
        dependency,
        resolution,
        install_peer,
        assign_resolution,
        None,
    )
}

pub fn enqueue_dependency_list(
    this: &mut PackageManager,
    dependencies_list: Lockfile::DependencySlice,
) {
    this.task_queue
        .ensure_unused_capacity(dependencies_list.len as usize)
        .expect("unreachable");
    let lockfile = &mut *this.lockfile;

    // Step 1. Go through main dependencies
    let mut begin = dependencies_list.off;
    let end = dependencies_list.off.saturating_add(dependencies_list.len);

    // if dependency is peer and is going to be installed
    // through "dependencies", skip it
    if end - begin > 1 && lockfile.buffers.dependencies[0].behavior.is_peer() {
        let mut peer_i: usize = 0;
        // PORT NOTE: reshaped for borrowck — index into the slice instead of holding &mut across loop
        while lockfile.buffers.dependencies[peer_i].behavior.is_peer() {
            let mut dep_i: usize = (end - 1) as usize;
            let mut dep = lockfile.buffers.dependencies[dep_i];
            while !dep.behavior.is_peer() {
                if !dep.behavior.is_dev() {
                    if lockfile.buffers.dependencies[peer_i].name_hash == dep.name_hash {
                        lockfile.buffers.dependencies[peer_i] =
                            lockfile.buffers.dependencies[begin as usize];
                        begin += 1;
                        break;
                    }
                }
                dep_i -= 1;
                dep = lockfile.buffers.dependencies[dep_i];
            }
            peer_i += 1;
            if peer_i == end as usize {
                break;
            }
        }
    }

    let mut i = begin;

    // we have to be very careful with pointers here
    while i < end {
        let dependency = this.lockfile.buffers.dependencies[i as usize];
        let resolution = this.lockfile.buffers.resolutions[i as usize];
        if let Err(err) = enqueue_dependency_with_main(this, i, &dependency, resolution, false) {
            let path_sep = match dependency.version.tag {
                Dependency::version::Tag::Folder => bun_fmt::PathSep::Auto,
                _ => bun_fmt::PathSep::Any,
            };
            let note_fmt = "error occurred while resolving {}";
            let note_args = format_args!(
                "error occurred while resolving {}",
                bun_fmt::fmt_path(this.lockfile.str(&dependency.realname()), path_sep)
            );
            // TODO(port): logger note API — Zig passes (fmt, args) tuple separately

            if dependency.behavior.is_optional() || dependency.behavior.is_peer() {
                this.log
                    .add_warning_with_note(None, logger::Loc::default(), err.name(), note_fmt, note_args)
                    .expect("unreachable");
            } else {
                this.log
                    .add_zig_error_with_note(err, note_fmt, note_args)
                    .expect("unreachable");
            }

            i += 1;
            continue;
        }
        i += 1;
    }

    this.drain_dependency_list();
}

pub fn enqueue_tarball_for_download(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    package_id: PackageID,
    url: &[u8],
    task_context: TaskCallbackContext,
    patch_name_and_version_hash: Option<u64>,
) -> Result<(), EnqueueTarballForDownloadError> {
    let task_id = Task::Id::for_tarball(url);
    let task_queue = this.task_queue.get_or_put(task_id)?;
    if !task_queue.found_existing {
        *task_queue.value_ptr = TaskCallbackList::default();
    }

    task_queue.value_ptr.push(task_context);
    // TODO(port): narrow error set

    if task_queue.found_existing {
        return Ok(());
    }

    if let Some(task) = this.generate_network_task_for_tarball(
        task_id,
        url,
        this.lockfile.buffers.dependencies[dependency_id as usize]
            .behavior
            .is_required(),
        dependency_id,
        this.lockfile.packages.get(package_id),
        patch_name_and_version_hash,
        NetworkTask::Authorization::NoAuthorization,
    )? {
        task.schedule(&mut this.network_tarball_batch);
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
    alias: &[u8],
    resolution: &Resolution,
    task_context: TaskCallbackContext,
) {
    let path = this.lockfile.str(&resolution.value.local_tarball);
    let task_id = Task::Id::for_tarball(path);
    let task_queue = this.task_queue.get_or_put(task_id).expect("unreachable");
    if !task_queue.found_existing {
        *task_queue.value_ptr = TaskCallbackList::default();
    }

    task_queue.value_ptr.push(task_context);
    // PERF(port): was assume-capacity append via ArrayList — profile in Phase B

    if task_queue.found_existing {
        return;
    }

    let integrity = this.lockfile.packages.items_meta()[package_id as usize].integrity;

    this.task_batch.push(ThreadPool::Batch::from(enqueue_local_tarball(
        this,
        task_id,
        dependency_id,
        alias,
        path,
        *resolution,
        integrity,
    )));
}

pub fn enqueue_git_for_checkout(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    alias: &[u8],
    resolution: &Resolution,
    task_context: TaskCallbackContext,
    patch_name_and_version_hash: Option<u64>,
) {
    let repository = &resolution.value.git;
    let url = this.lockfile.str(&repository.repo);
    let clone_id = Task::Id::for_git_clone(url);
    let resolved = this.lockfile.str(&repository.resolved);
    let checkout_id = Task::Id::for_git_checkout(url, resolved);
    let checkout_queue = this.task_queue.get_or_put(checkout_id).expect("unreachable");
    if !checkout_queue.found_existing {
        *checkout_queue.value_ptr = TaskCallbackList::default();
    }

    checkout_queue.value_ptr.push(task_context);

    if checkout_queue.found_existing {
        return;
    }

    if let Some(repo_fd) = this.git_repositories.get(&clone_id) {
        let batch = ThreadPool::Batch::from(enqueue_git_checkout(
            this,
            checkout_id,
            *repo_fd,
            dependency_id,
            alias,
            *resolution,
            resolved,
            patch_name_and_version_hash,
        ));
        this.task_batch.push(batch);
    } else {
        let clone_queue = this.task_queue.get_or_put(clone_id).expect("unreachable");
        if !clone_queue.found_existing {
            *clone_queue.value_ptr = TaskCallbackList::default();
        }

        clone_queue
            .value_ptr
            .push(TaskCallbackContext::Dependency(dependency_id));

        if clone_queue.found_existing {
            return;
        }

        let dep = this.lockfile.buffers.dependencies[dependency_id as usize];
        this.task_batch.push(ThreadPool::Batch::from(enqueue_git_clone(
            this,
            clone_id,
            alias,
            repository,
            dependency_id,
            &dep,
            resolution,
            None,
        )));
    }
}

pub fn enqueue_parse_npm_package(
    this: &mut PackageManager,
    task_id: Task::Id,
    name: StringOrTinyString,
    network_task: *mut NetworkTask,
) -> *mut ThreadPool::Task {
    let task = this.preallocated_resolve_tasks.get();
    // SAFETY: task is a freshly acquired slot from the preallocated pool; we own the write.
    unsafe {
        *task = Task {
            package_manager: this,
            log: logger::Log::init(),
            tag: Task::Tag::PackageManifest,
            request: Task::Request::PackageManifest {
                network: network_task,
                name,
            },
            id: task_id,
            // TODO(port): `data: undefined` — Task::data left uninitialized in Zig
            ..Task::uninit()
        };
        &mut (*task).threadpool_task
    }
}

pub fn enqueue_package_for_download(
    this: &mut PackageManager,
    name: &[u8],
    dependency_id: DependencyID,
    package_id: PackageID,
    version: Semver::Version,
    url: &[u8],
    task_context: TaskCallbackContext,
    patch_name_and_version_hash: Option<u64>,
) -> Result<(), EnqueuePackageForDownloadError> {
    let task_id = Task::Id::for_npm_package(name, version);
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

    if let Some(task) = this.generate_network_task_for_tarball(
        task_id,
        url,
        is_required,
        dependency_id,
        this.lockfile.packages.get(package_id),
        patch_name_and_version_hash,
        NetworkTask::Authorization::AllowAuthorization,
    )? {
        task.schedule(&mut this.network_tarball_batch);
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
    Failure(bun_core::Error),
}

pub fn enqueue_dependency_to_root(
    this: &mut PackageManager,
    name: &[u8],
    version: &Dependency::Version,
    version_buf: &[u8],
    behavior: Dependency::Behavior,
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

        let mut builder = this.lockfile.string_builder();
        let dummy = Dependency {
            name: SemverString::init(name, name),
            name_hash: SemverString::Builder::string_hash(name),
            version: *version,
            behavior,
        };
        dummy.count_with_different_buffers(name, version_buf, &mut builder);

        if let Err(err) = builder.allocate() {
            return DependencyToEnqueue::Failure(err.into());
        }

        let dep = dummy
            .clone_with_different_buffers(this, name, version_buf, &mut builder)
            .expect("unreachable");
        builder.clamp();
        let index = this.lockfile.buffers.dependencies.len();
        this.lockfile.buffers.dependencies.push(dep);
        this.lockfile.buffers.resolutions.push(invalid_package_id);
        if cfg!(debug_assertions) {
            debug_assert!(
                this.lockfile.buffers.dependencies.len() == this.lockfile.buffers.resolutions.len()
            );
        }
        break 'brk index;
    } as DependencyID;

    if this.lockfile.buffers.resolutions[dep_id as usize] == invalid_package_id {
        // Copy to the stack: `enqueueDependencyWithMainAndSuccessFn` can call
        // `Lockfile.Package.fromNPM`, which grows `buffers.dependencies` and
        // would invalidate a pointer taken directly into it.
        let dependency = this.lockfile.buffers.dependencies[dep_id as usize];
        if let Err(err) = enqueue_dependency_with_main_and_success_fn(
            this,
            dep_id,
            &dependency,
            invalid_package_id,
            false,
            assign_root_resolution,
            Some(fail_root_resolution),
        ) {
            return DependencyToEnqueue::Failure(err);
        }
    }

    let resolution_id = match this.lockfile.buffers.resolutions[dep_id as usize] {
        id if id == invalid_package_id => 'brk: {
            this.drain_dependency_list();

            // https://github.com/ziglang/zig/issues/19586 — Zig needed a workaround fn-returning-type;
            // in Rust we just declare the closure struct directly.
            struct Closure<'a> {
                err: Option<bun_core::Error>,
                manager: &'a mut PackageManager,
            }
            impl<'a> Closure<'a> {
                fn is_done(&mut self) -> bool {
                    let manager = &mut *self.manager;
                    if manager.pending_task_count() > 0 {
                        if let Err(err) = manager.run_tasks(
                            (),
                            (),
                            PackageManager::RunTasksCallbacks {
                                on_extract: (),
                                on_resolve: (),
                                on_package_manifest_error: (),
                                on_package_download_error: (),
                            },
                            false,
                            manager.options.log_level,
                        ) {
                            self.err = Some(err);
                            return true;
                        }

                        if PackageManager::verbose_install() && manager.pending_task_count() > 0 {
                            if PackageManager::has_enough_time_passed_between_waiting_messages() {
                                Output::pretty_errorln(format_args!(
                                    "<d>[PackageManager]<r> waiting for {} tasks\n",
                                    self.manager.pending_task_count()
                                ));
                            }
                        }
                    }

                    manager.pending_task_count() == 0
                }
            }

            if this.options.log_level.show_progress() {
                this.start_progress_bar_if_none();
            }

            let mut closure = Closure { err: None, manager: this };
            // TODO(port): sleepUntil takes (&mut closure, fn ptr); reshape for borrowck if needed
            this.sleep_until(&mut closure, Closure::is_done);

            if this.options.log_level.show_progress() {
                this.end_progress_bar();
                Output::flush();
            }

            if let Some(err) = closure.err {
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

pub fn enqueue_network_task(this: &mut PackageManager, task: *mut NetworkTask) {
    if this.network_task_fifo.writable_length() == 0 {
        this.flush_network_queue();
    }

    // PERF(port): was writeItemAssumeCapacity — profile in Phase B
    this.network_task_fifo.write_item_assume_capacity(task);
}

pub fn enqueue_patch_task(this: &mut PackageManager, task: Box<PatchTask>) {
    bun_output::scoped_log!(
        PackageManager,
        "Enqueue patch task: 0x{:x} {}",
        (&*task as *const PatchTask) as usize,
        <&'static str>::from(&task.callback)
    );
    if this.patch_task_fifo.writable_length() == 0 {
        this.flush_patch_task_queue();
    }

    // PERF(port): was writeItemAssumeCapacity — profile in Phase B
    this.patch_task_fifo.write_item_assume_capacity(task);
}

/// We need to calculate all the patchfile hashes at the beginning so we don't run into problems with stale hashes
pub fn enqueue_patch_task_pre(this: &mut PackageManager, mut task: Box<PatchTask>) {
    bun_output::scoped_log!(
        PackageManager,
        "Enqueue patch task pre: 0x{:x} {}",
        (&*task as *const PatchTask) as usize,
        <&'static str>::from(&task.callback)
    );
    task.pre = true;
    if this.patch_task_fifo.writable_length() == 0 {
        this.flush_patch_task_queue();
    }

    // PERF(port): was writeItemAssumeCapacity — profile in Phase B
    this.patch_task_fifo.write_item_assume_capacity(task);
    let _ = this.pending_pre_calc_hashes.fetch_add(1, Ordering::Relaxed);
}

/// Q: "What do we do with a dependency in a package.json?"
/// A: "We enqueue it!"
pub fn enqueue_dependency_with_main_and_success_fn(
    this: &mut PackageManager,
    id: DependencyID,
    /// This must be a *const to prevent UB
    dependency: &Dependency,
    resolution: PackageID,
    install_peer: bool,
    // PERF(port): was comptime monomorphization (successFn/failFn) — profile in Phase B
    success_fn: SuccessFn,
    fail_fn: Option<FailFn>,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    if dependency.behavior.is_optional_peer() {
        return Ok(());
    }

    let mut name = dependency.realname();
    let mut name_hash = match dependency.version.tag {
        Dependency::version::Tag::DistTag
        | Dependency::version::Tag::Git
        | Dependency::version::Tag::Github
        | Dependency::version::Tag::Npm
        | Dependency::version::Tag::Tarball
        | Dependency::version::Tag::Workspace => {
            SemverString::Builder::string_hash(this.lockfile.str(&name))
        }
        _ => dependency.name_hash,
    };

    let version: Dependency::Version = 'version: {
        if dependency.version.tag == Dependency::version::Tag::Npm {
            if let Some(aliased) = this.known_npm_aliases.get(&name_hash) {
                let group = &dependency.version.value.npm.version;
                let buf = this.lockfile.buffers.string_bytes.as_slice();
                let mut curr_list: Option<&Semver::Query::List> =
                    Some(&aliased.value.npm.version.head);
                while let Some(queries) = curr_list {
                    let mut curr: Option<&Semver::Query> = Some(&queries.head);
                    while let Some(query) = curr {
                        if group.satisfies(query.range.left.version, buf, buf)
                            || group.satisfies(query.range.right.version, buf, buf)
                        {
                            name = aliased.value.npm.name;
                            name_hash = SemverString::Builder::string_hash(this.lockfile.str(&name));
                            break 'version *aliased;
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
            && (dependency.version.tag != Dependency::version::Tag::Npm
                || !dependency.version.value.npm.is_alias)
        {
            if let Some(new) = this.lockfile.overrides.get(&name_hash) {
                bun_output::scoped_log!(
                    PackageManager,
                    "override: {} -> {}",
                    bstr::BStr::new(this.lockfile.str(&dependency.version.literal)),
                    bstr::BStr::new(this.lockfile.str(&new.literal))
                );

                (name, name_hash) =
                    update_name_and_name_hash_from_version_replacement(this.lockfile, name, name_hash, new);

                if new.tag == Dependency::version::Tag::Catalog {
                    if let Some(catalog_dep) =
                        this.lockfile.catalogs.get(this.lockfile, &new.value.catalog, &name)
                    {
                        (name, name_hash) = update_name_and_name_hash_from_version_replacement(
                            this.lockfile,
                            name,
                            name_hash,
                            catalog_dep.version,
                        );
                        break 'version catalog_dep.version;
                    }
                }

                // `name_hash` stays the same
                break 'version new;
            }

            if dependency.version.tag == Dependency::version::Tag::Catalog {
                if let Some(catalog_dep) = this.lockfile.catalogs.get(
                    this.lockfile,
                    &dependency.version.value.catalog,
                    &name,
                ) {
                    (name, name_hash) = update_name_and_name_hash_from_version_replacement(
                        this.lockfile,
                        name,
                        name_hash,
                        catalog_dep.version,
                    );

                    break 'version catalog_dep.version;
                }
            }
        }

        // explicit copy here due to `dependency.version` becoming undefined
        // when `getOrPutResolvedPackageWithFindResult` is called and resizes the list.
        break 'version Dependency::Version {
            literal: dependency.version.literal,
            tag: dependency.version.tag,
            value: dependency.version.value,
        };
    };
    let mut loaded_manifest: Option<Npm::PackageManifest> = None;

    match version.tag {
        Dependency::version::Tag::DistTag
        | Dependency::version::Tag::Folder
        | Dependency::version::Tag::Npm => {
            'retry_from_manifests_ptr: loop {
                let mut resolve_result_ = get_or_put_resolved_package(
                    this,
                    name_hash,
                    name,
                    dependency,
                    version,
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
                            if err == bun_core::err!("DistTagNotFound") {
                                if dependency.behavior.is_required() {
                                    if let Some(fail) = fail_fn {
                                        fail(this, dependency, id, err);
                                    } else {
                                        this.log
                                            .add_error_fmt(
                                                None,
                                                logger::Loc::EMPTY,
                                                format_args!(
                                                    "Package \"{}\" with tag \"{}\" not found, but package exists",
                                                    bstr::BStr::new(this.lockfile.str(&name)),
                                                    bstr::BStr::new(
                                                        this.lockfile.str(&version.value.dist_tag.tag)
                                                    ),
                                                ),
                                            )
                                            .expect("unreachable");
                                    }
                                }
                                return Ok(());
                            } else if err == bun_core::err!("NoMatchingVersion") {
                                if dependency.behavior.is_required() {
                                    if let Some(fail) = fail_fn {
                                        fail(this, dependency, id, err);
                                    } else {
                                        this.log
                                            .add_error_fmt(
                                                None,
                                                logger::Loc::EMPTY,
                                                format_args!(
                                                    "No version matching \"{}\" found for specifier \"{}\"<r> <d>(but package exists)<r>",
                                                    bstr::BStr::new(this.lockfile.str(&version.literal)),
                                                    bstr::BStr::new(this.lockfile.str(&name)),
                                                ),
                                            )
                                            .expect("unreachable");
                                    }
                                }
                                return Ok(());
                            } else if err == bun_core::err!("TooRecentVersion") {
                                if dependency.behavior.is_required() {
                                    if let Some(fail) = fail_fn {
                                        fail(this, dependency, id, err);
                                    } else {
                                        let age_gate_ms =
                                            this.options.minimum_release_age_ms.unwrap_or(0);
                                        if version.tag == Dependency::version::Tag::DistTag {
                                            this.log
                                                .add_error_fmt(
                                                    None,
                                                    logger::Loc::EMPTY,
                                                    format_args!(
                                                        "Package \"{}\" with tag \"{}\" not found<r> <d>(all versions blocked by minimum-release-age: {} seconds)<r>",
                                                        bstr::BStr::new(this.lockfile.str(&name)),
                                                        bstr::BStr::new(this.lockfile.str(&version.value.dist_tag.tag)),
                                                        age_gate_ms / MS_PER_S,
                                                    ),
                                                )
                                                .expect("unreachable");
                                        } else {
                                            this.log
                                                .add_error_fmt(
                                                    None,
                                                    logger::Loc::EMPTY,
                                                    format_args!(
                                                        "No version matching \"{}\" found for specifier \"{}\"<r> <d>(blocked by minimum-release-age: {} seconds)<r>",
                                                        bstr::BStr::new(this.lockfile.str(&name)),
                                                        bstr::BStr::new(this.lockfile.str(&version.literal)),
                                                        age_gate_ms / MS_PER_S,
                                                    ),
                                                )
                                                .expect("unreachable");
                                        }
                                    }
                                }
                                return Ok(());
                            } else if err == bun_core::err!("MissingPackageJSON") {
                                if dependency.behavior.is_required() {
                                    if let Some(fail) = fail_fn {
                                        fail(this, dependency, id, err);
                                    } else if version.tag == Dependency::version::Tag::Folder {
                                        this.log
                                            .add_error_fmt(
                                                None,
                                                logger::Loc::EMPTY,
                                                format_args!(
                                                    "Could not find package.json for \"file:{}\" dependency \"{}\"",
                                                    bstr::BStr::new(this.lockfile.str(&version.value.folder)),
                                                    bstr::BStr::new(this.lockfile.str(&name)),
                                                ),
                                            )
                                            .expect("unreachable");
                                    } else {
                                        this.log
                                            .add_error_fmt(
                                                None,
                                                logger::Loc::EMPTY,
                                                format_args!(
                                                    "Could not find package.json for dependency \"{}\"",
                                                    bstr::BStr::new(this.lockfile.str(&name)),
                                                ),
                                            )
                                            .expect("unreachable");
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
                            if PackageManager::verbose_install() {
                                let label = this.lockfile.str(&version.literal);

                                Output::pretty_errorln(format_args!(
                                    "   -> \"{}\": \"{}\" -> {}@{}",
                                    bstr::BStr::new(this.lockfile.str(&result.package.name)),
                                    bstr::BStr::new(label),
                                    bstr::BStr::new(this.lockfile.str(&result.package.name)),
                                    result.package.resolution.fmt(
                                        this.lockfile.buffers.string_bytes.as_slice(),
                                        Resolution::FmtMode::Auto
                                    ),
                                ));
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
                                    if this.get_preinstall_state(result.package.meta.id)
                                        == install::PreinstallState::Extract
                                    {
                                        this.set_preinstall_state(
                                            result.package.meta.id,
                                            this.lockfile,
                                            install::PreinstallState::Extracting,
                                        );
                                        enqueue_network_task(this, network_task);
                                    }
                                }
                                ResolvedPackageTask::PatchTask(patch_task) => {
                                    if matches!(patch_task.callback, PatchTask::Callback::CalcHash(..))
                                        && this.get_preinstall_state(result.package.meta.id)
                                            == install::PreinstallState::CalcPatchHash
                                    {
                                        this.set_preinstall_state(
                                            result.package.meta.id,
                                            this.lockfile,
                                            install::PreinstallState::CalcingPatchHash,
                                        );
                                        enqueue_patch_task(this, patch_task);
                                    } else if matches!(patch_task.callback, PatchTask::Callback::Apply(..))
                                        && this.get_preinstall_state(result.package.meta.id)
                                            == install::PreinstallState::ApplyPatch
                                    {
                                        this.set_preinstall_state(
                                            result.package.meta.id,
                                            this.lockfile,
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
                        let name_str = this.lockfile.str(&name);
                        let task_id = Task::Id::for_manifest(name_str);

                        if cfg!(debug_assertions) {
                            debug_assert!(task_id.get() != 0);
                        }

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
                            if !this.has_created_network_task(task_id, dependency.behavior.is_required())
                            {
                                let needs_extended_manifest =
                                    this.options.minimum_release_age_ms.is_some();
                                if this.options.enable.manifest_cache {
                                    let mut expired = false;
                                    if let Some(manifest) = this.manifests.by_name_hash_allow_expired(
                                        this,
                                        this.scope_for_package_name(name_str),
                                        name_hash,
                                        &mut expired,
                                        Npm::ManifestLoad::LoadFromMemoryFallbackToDisk,
                                        needs_extended_manifest,
                                    ) {
                                        loaded_manifest = Some(*manifest);

                                        // If it's an exact package version already living in the cache
                                        // We can skip the network request, even if it's beyond the caching period
                                        if version.tag == Dependency::version::Tag::Npm
                                            && version.value.npm.version.is_exact()
                                        {
                                            if let Some(find_result) = loaded_manifest
                                                .as_ref()
                                                .unwrap()
                                                .find_by_version(
                                                    version.value.npm.version.head.head.range.left.version,
                                                )
                                            {
                                                if let Some(min_age_ms) =
                                                    this.options.minimum_release_age_ms
                                                {
                                                    if !loaded_manifest
                                                        .as_ref()
                                                        .unwrap()
                                                        .should_exclude_from_age_filter(
                                                            &this.options.minimum_release_age_excludes,
                                                        )
                                                        && Npm::PackageManifest::is_package_version_too_recent(
                                                            find_result.package, min_age_ms,
                                                        )
                                                    {
                                                        let package_name = this.lockfile.str(&name);
                                                        let min_age_seconds = min_age_ms / MS_PER_S;
                                                        let _ = this.log.add_error_fmt(
                                                            None,
                                                            logger::Loc::EMPTY,
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
                                                        version,
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
                                                    let _ = this.network_dedupe_map.remove(&task_id);
                                                    continue 'retry_with_new_resolve_result;
                                                }
                                            }
                                        }

                                        // Was it recent enough to just load it without the network call?
                                        if this.options.enable.manifest_cache_control && !expired {
                                            let _ = this.network_dedupe_map.remove(&task_id);
                                            continue 'retry_from_manifests_ptr;
                                        }
                                    }
                                }

                                if PackageManager::verbose_install() {
                                    Output::pretty_errorln(format_args!(
                                        "Enqueue package manifest for download: {}",
                                        bstr::BStr::new(name_str)
                                    ));
                                }

                                let network_task = this.get_network_task();
                                // SAFETY: network_task is a freshly acquired pool slot
                                unsafe {
                                    *network_task = NetworkTask {
                                        package_manager: this,
                                        // TODO(port): `callback: undefined` in Zig
                                        callback: core::mem::zeroed(),
                                        task_id,
                                        // allocator dropped — global mimalloc
                                        ..NetworkTask::uninit()
                                    };
                                }

                                // SAFETY: network_task points to a valid initialized NetworkTask slot
                                unsafe {
                                    (*network_task).for_manifest(
                                        name_str,
                                        this.scope_for_package_name(name_str),
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

                        let ctx = if success_fn as usize == assign_root_resolution as usize {
                            TaskCallbackContext::RootDependency(id)
                        } else {
                            TaskCallbackContext::Dependency(id)
                        };
                        manifest_entry_parse.value_ptr.push(ctx);
                    }
                    return Ok(());
                }
            }
            #[allow(unreachable_code)]
            return Ok(());
        }
        Dependency::version::Tag::Git => {
            let dep = &version.value.git;
            let res = Resolution {
                tag: Resolution::Tag::Git,
                value: Resolution::Value { git: *dep },
            };

            // First: see if we already loaded the git package in-memory
            if let Some(pkg_id) = this.lockfile.get_package_id(name_hash, None, &res) {
                success_fn(this, id, pkg_id);
                return Ok(());
            }

            let alias = this.lockfile.str(&dependency.name);
            let url = this.lockfile.str(&dep.repo);
            let clone_id = Task::Id::for_git_clone(url);
            let ctx = if success_fn as usize == assign_root_resolution as usize {
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
                    bstr::BStr::new(url),
                );
            }

            if let Some(repo_fd) = this.git_repositories.get(&clone_id).copied() {
                let resolved = Repository::find_commit(
                    &this.env,
                    &mut this.log,
                    repo_fd.std_dir(),
                    alias,
                    this.lockfile.str(&dep.committish),
                    clone_id,
                )?;
                let checkout_id = Task::Id::for_git_checkout(url, &resolved);

                let entry = this
                    .task_queue
                    .get_or_put_context(checkout_id, ())
                    .expect("unreachable");
                if !entry.found_existing {
                    *entry.value_ptr = TaskCallbackList::default();
                }
                if this.lockfile.buffers.resolutions[id as usize] == invalid_package_id {
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

                this.task_batch.push(ThreadPool::Batch::from(enqueue_git_checkout(
                    this,
                    checkout_id,
                    repo_fd,
                    id,
                    alias,
                    res,
                    &resolved,
                    None,
                )));
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

                this.task_batch.push(ThreadPool::Batch::from(enqueue_git_clone(
                    this, clone_id, alias, dep, id, dependency, &res, None,
                )));
            }
            Ok(())
        }
        Dependency::version::Tag::Github => {
            let dep = &version.value.github;
            let res = Resolution {
                tag: Resolution::Tag::Github,
                value: Resolution::Value { github: *dep },
            };

            // First: see if we already loaded the github package in-memory
            if let Some(pkg_id) = this.lockfile.get_package_id(name_hash, None, &res) {
                success_fn(this, id, pkg_id);
                return Ok(());
            }

            let url = this.alloc_github_url(dep);
            // url is Box<[u8]>; dropped at scope end (Zig had `defer allocator.free(url)`)
            let task_id = Task::Id::for_tarball(&url);
            let entry = this
                .task_queue
                .get_or_put_context(task_id, ())
                .expect("unreachable");
            if !entry.found_existing {
                *entry.value_ptr = TaskCallbackList::default();
            }

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

            let ctx = if success_fn as usize == assign_root_resolution as usize {
                TaskCallbackContext::RootDependency(id)
            } else {
                TaskCallbackContext::Dependency(id)
            };
            entry.value_ptr.push(ctx);

            if dependency.behavior.is_peer() {
                if !install_peer {
                    this.peer_dependencies.write_item(id)?;
                    return Ok(());
                }
            }

            if let Some(network_task) = this.generate_network_task_for_tarball(
                task_id,
                &url,
                dependency.behavior.is_required(),
                id,
                Package {
                    name: dependency.name,
                    name_hash: dependency.name_hash,
                    resolution: res,
                    ..Package::default()
                },
                None,
                NetworkTask::Authorization::NoAuthorization,
            )? {
                enqueue_network_task(this, network_task);
            }
            Ok(())
        }
        Dependency::version::Tag::Symlink | Dependency::version::Tag::Workspace => {
            // PORT NOTE: Zig used `inline .symlink, .workspace => |dependency_tag|` to capture
            // the comptime tag; we check `version.tag` at runtime instead.
            let dependency_tag = version.tag;

            let _result = match get_or_put_resolved_package(
                this,
                name_hash,
                name,
                dependency,
                version,
                dependency.behavior,
                id,
                resolution,
                install_peer,
                success_fn,
            ) {
                Ok(v) => v,
                Err(err) if err == bun_core::err!("MissingPackageJSON") => None,
                Err(err) => return Err(err),
            };

            const WORKSPACE_NOT_FOUND_FMT: &str = concat!(
                "Workspace dependency \"{name}\" not found\n",
                "\n",
                "Searched in <b>{search_path}<r>\n",
                "\n",
                "Workspace documentation: https://bun.com/docs/install/workspaces\n",
                "\n",
            );
            const LINK_NOT_FOUND_FMT: &str = concat!(
                "Package \"{name}\" is not linked\n",
                "\n",
                "To install a linked package:\n",
                "   <cyan>bun link my-pkg-name-from-package-json<r>\n",
                "\n",
                "Tip: the package name is from package.json, which can differ from the folder name.\n",
                "\n",
            );
            // TODO(port): named-argument format strings — Zig used `{[name]s}` / `{[search_path]f}`;
            // logger API in Rust may need positional args instead.

            if let Some(result) = _result {
                // First time?
                if result.is_first_time {
                    if PackageManager::verbose_install() {
                        let label = this.lockfile.str(&version.literal);

                        Output::pretty_errorln(format_args!(
                            "   -> \"{}\": \"{}\" -> {}@{}",
                            bstr::BStr::new(this.lockfile.str(&result.package.name)),
                            bstr::BStr::new(label),
                            bstr::BStr::new(this.lockfile.str(&result.package.name)),
                            result.package.resolution.fmt(
                                this.lockfile.buffers.string_bytes.as_slice(),
                                Resolution::FmtMode::Auto
                            ),
                        ));
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
                if cfg!(debug_assertions) {
                    debug_assert!(result.task.is_none());
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
            } else if dependency.behavior.is_required() {
                if dependency_tag == Dependency::version::Tag::Workspace {
                    this.log
                        .add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                // TODO(port): WORKSPACE_NOT_FOUND_FMT with named args
                                "Workspace dependency \"{}\" not found\n\nSearched in <b>{}<r>\n\nWorkspace documentation: https://bun.com/docs/install/workspaces\n\n",
                                bstr::BStr::new(this.lockfile.str(&name)),
                                FolderResolution::PackageWorkspaceSearchPathFormatter { manager: this, version },
                            ),
                        )
                        .expect("unreachable");
                } else {
                    this.log
                        .add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                // TODO(port): LINK_NOT_FOUND_FMT with named args
                                "Package \"{}\" is not linked\n\nTo install a linked package:\n   <cyan>bun link my-pkg-name-from-package-json<r>\n\nTip: the package name is from package.json, which can differ from the folder name.\n\n",
                                bstr::BStr::new(this.lockfile.str(&name)),
                            ),
                        )
                        .expect("unreachable");
                }
            } else if this.options.log_level.is_verbose() {
                if dependency_tag == Dependency::version::Tag::Workspace {
                    this.log
                        .add_warning_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "Workspace dependency \"{}\" not found\n\nSearched in <b>{}<r>\n\nWorkspace documentation: https://bun.com/docs/install/workspaces\n\n",
                                bstr::BStr::new(this.lockfile.str(&name)),
                                FolderResolution::PackageWorkspaceSearchPathFormatter { manager: this, version },
                            ),
                        )
                        .expect("unreachable");
                } else {
                    this.log
                        .add_warning_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "Package \"{}\" is not linked\n\nTo install a linked package:\n   <cyan>bun link my-pkg-name-from-package-json<r>\n\nTip: the package name is from package.json, which can differ from the folder name.\n\n",
                                bstr::BStr::new(this.lockfile.str(&name)),
                            ),
                        )
                        .expect("unreachable");
                }
            }
            let _ = (WORKSPACE_NOT_FOUND_FMT, LINK_NOT_FOUND_FMT);
            Ok(())
        }
        Dependency::version::Tag::Tarball => {
            let res: Resolution = match &version.value.tarball.uri {
                Dependency::TarballUri::Local(path) => Resolution {
                    tag: Resolution::Tag::LocalTarball,
                    value: Resolution::Value { local_tarball: *path },
                },
                Dependency::TarballUri::Remote(url) => Resolution {
                    tag: Resolution::Tag::RemoteTarball,
                    value: Resolution::Value { remote_tarball: *url },
                },
            };

            // First: see if we already loaded the tarball package in-memory
            if let Some(pkg_id) = this.lockfile.get_package_id(name_hash, None, &res) {
                success_fn(this, id, pkg_id);
                return Ok(());
            }

            let url = match &version.value.tarball.uri {
                Dependency::TarballUri::Local(path) => this.lockfile.str(path),
                Dependency::TarballUri::Remote(url) => this.lockfile.str(url),
            };
            let task_id = Task::Id::for_tarball(url);
            let entry = this
                .task_queue
                .get_or_put_context(task_id, ())
                .expect("unreachable");
            if !entry.found_existing {
                *entry.value_ptr = TaskCallbackList::default();
            }

            if cfg!(debug_assertions) {
                bun_output::scoped_log!(
                    PackageManager,
                    "enqueueDependency({}, {}, {}, {}) = {}",
                    id,
                    <&'static str>::from(version.tag),
                    bstr::BStr::new(this.lockfile.str(&name)),
                    bstr::BStr::new(this.lockfile.str(&version.literal)),
                    bstr::BStr::new(url),
                );
            }

            let ctx = if success_fn as usize == assign_root_resolution as usize {
                TaskCallbackContext::RootDependency(id)
            } else {
                TaskCallbackContext::Dependency(id)
            };
            entry.value_ptr.push(ctx);

            if dependency.behavior.is_peer() {
                if !install_peer {
                    this.peer_dependencies.write_item(id)?;
                    return Ok(());
                }
            }

            match &version.value.tarball.uri {
                Dependency::TarballUri::Local(_) => {
                    if this.has_created_network_task(task_id, dependency.behavior.is_required()) {
                        return Ok(());
                    }

                    this.task_batch.push(ThreadPool::Batch::from(enqueue_local_tarball(
                        this,
                        task_id,
                        id,
                        this.lockfile.str(&dependency.name),
                        url,
                        res,
                        Integrity::default(),
                    )));
                }
                Dependency::TarballUri::Remote(_) => {
                    if let Some(network_task) = this.generate_network_task_for_tarball(
                        task_id,
                        url,
                        dependency.behavior.is_required(),
                        id,
                        Package {
                            name: dependency.name,
                            name_hash: dependency.name_hash,
                            resolution: res,
                            ..Package::default()
                        },
                        None,
                        NetworkTask::Authorization::NoAuthorization,
                    )? {
                        enqueue_network_task(this, network_task);
                    }
                }
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

/// Allocate and initialise an `.extract` Task for an npm tarball.
/// Shared by the buffered path (`enqueueExtractNPMPackage`) and the
/// streaming path (`createExtractTaskForStreaming`) so both produce
/// an identical Task shape; only the return type differs.
///
/// Intentionally does *not* move `network_task.apply_patch_task`: the
/// install phase creates its own PatchTask via `PackageInstaller`, so
/// applying it here would run the patch twice.
fn init_extract_task(
    this: &mut PackageManager,
    tarball: &ExtractTarball,
    network_task: *mut NetworkTask,
) -> *mut Task {
    let task = this.preallocated_resolve_tasks.get();
    // SAFETY: task is a freshly acquired slot from the preallocated pool; we own the write.
    unsafe {
        *task = Task {
            package_manager: this,
            log: logger::Log::init(),
            tag: Task::Tag::Extract,
            request: Task::Request::Extract {
                network: network_task,
                tarball: *tarball,
            },
            id: (*network_task).task_id,
            // TODO(port): `data: undefined`
            ..Task::uninit()
        };
        if let Task::Request::Extract { tarball, .. } = &mut (*task).request {
            tarball.skip_verify = !this.options.do_.verify_integrity;
        }
        task
    }
}

pub fn enqueue_extract_npm_package(
    this: &mut PackageManager,
    tarball: &ExtractTarball,
    network_task: *mut NetworkTask,
) -> *mut ThreadPool::Task {
    // SAFETY: init_extract_task returns a valid *mut Task
    unsafe { &mut (*init_extract_task(this, tarball, network_task)).threadpool_task }
}

/// Allocate the extract Task up front so the streaming extractor can
/// publish it to `resolve_tasks` when extraction finishes. Done on the
/// main thread because `preallocated_resolve_tasks` is not thread-safe.
/// The NetworkTask's pending-task slot is reused for the extraction so
/// progress counters stay balanced.
pub fn create_extract_task_for_streaming(
    this: &mut PackageManager,
    tarball: &ExtractTarball,
    network_task: *mut NetworkTask,
) -> *mut Task {
    init_extract_task(this, tarball, network_task)
}

fn enqueue_git_clone(
    this: &mut PackageManager,
    task_id: Task::Id,
    name: &[u8],
    repository: &Repository,
    dep_id: DependencyID,
    dependency: &Dependency,
    res: &Resolution,
    /// if patched then we need to do apply step after network task is done
    patch_name_and_version_hash: Option<u64>,
) -> *mut ThreadPool::Task {
    let task = this.preallocated_resolve_tasks.get();
    // SAFETY: task is a freshly acquired slot from the preallocated pool
    unsafe {
        *task = Task {
            package_manager: this,
            log: logger::Log::init(),
            tag: Task::Tag::GitClone,
            request: Task::Request::GitClone {
                name: StringOrTinyString::init_append_if_needed(
                    name,
                    &mut FileSystem::FilenameStore::instance(),
                )
                .expect("unreachable"),
                url: StringOrTinyString::init_append_if_needed(
                    this.lockfile.str(&repository.repo),
                    &mut FileSystem::FilenameStore::instance(),
                )
                .expect("unreachable"),
                env: Repository::shared_env().get(&this.env),
                dep_id,
                res: *res,
            },
            id: task_id,
            apply_patch_task: if let Some(h) = patch_name_and_version_hash {
                let dep = dependency;
                let pkg_id = match this
                    .lockfile
                    .package_index
                    .get(&dep.name_hash)
                    .unwrap_or_else(|| panic!("Package not found"))
                {
                    Lockfile::PackageIndexEntry::Id(p) => *p,
                    Lockfile::PackageIndexEntry::Ids(ps) => ps[0], // TODO is this correct
                };
                let patch_hash = this
                    .lockfile
                    .patched_dependencies
                    .get(&h)
                    .unwrap()
                    .patchfile_hash()
                    .unwrap();
                let mut pt = PatchTask::new_apply_patch_hash(this, pkg_id, patch_hash, h);
                pt.callback.apply_mut().task_id = task_id;
                Some(pt)
            } else {
                None
            },
            // TODO(port): `data: undefined`
            ..Task::uninit()
        };
        &mut (*task).threadpool_task
    }
}

pub fn enqueue_git_checkout(
    this: &mut PackageManager,
    task_id: Task::Id,
    dir: Fd,
    dependency_id: DependencyID,
    name: &[u8],
    resolution: Resolution,
    resolved: &[u8],
    /// if patched then we need to do apply step after network task is done
    patch_name_and_version_hash: Option<u64>,
) -> *mut ThreadPool::Task {
    let task = this.preallocated_resolve_tasks.get();
    // SAFETY: task is a freshly acquired slot from the preallocated pool
    unsafe {
        *task = Task {
            package_manager: this,
            log: logger::Log::init(),
            tag: Task::Tag::GitCheckout,
            request: Task::Request::GitCheckout {
                repo_dir: dir,
                resolution,
                dependency_id,
                name: StringOrTinyString::init_append_if_needed(
                    name,
                    &mut FileSystem::FilenameStore::instance(),
                )
                .expect("unreachable"),
                url: StringOrTinyString::init_append_if_needed(
                    this.lockfile.str(&resolution.value.git.repo),
                    &mut FileSystem::FilenameStore::instance(),
                )
                .expect("unreachable"),
                resolved: StringOrTinyString::init_append_if_needed(
                    resolved,
                    &mut FileSystem::FilenameStore::instance(),
                )
                .expect("unreachable"),
                env: Repository::shared_env().get(&this.env),
            },
            apply_patch_task: if let Some(h) = patch_name_and_version_hash {
                let dep = this.lockfile.buffers.dependencies[dependency_id as usize];
                let pkg_id = match this
                    .lockfile
                    .package_index
                    .get(&dep.name_hash)
                    .unwrap_or_else(|| panic!("Package not found"))
                {
                    Lockfile::PackageIndexEntry::Id(p) => *p,
                    Lockfile::PackageIndexEntry::Ids(ps) => ps[0], // TODO is this correct
                };
                let patch_hash = this
                    .lockfile
                    .patched_dependencies
                    .get(&h)
                    .unwrap()
                    .patchfile_hash()
                    .unwrap();
                let mut pt = PatchTask::new_apply_patch_hash(this, pkg_id, patch_hash, h);
                pt.callback.apply_mut().task_id = task_id;
                Some(pt)
            } else {
                None
            },
            id: task_id,
            // TODO(port): `data: undefined`
            ..Task::uninit()
        };
        &mut (*task).threadpool_task
    }
}

fn enqueue_local_tarball(
    this: &mut PackageManager,
    task_id: Task::Id,
    dependency_id: DependencyID,
    name: &[u8],
    path: &[u8],
    resolution: Resolution,
    integrity: Integrity,
) -> *mut ThreadPool::Task {
    // Resolve the on-disk tarball path here on the main thread. The task
    // callback runs on a ThreadPool worker and must not read
    // `lockfile.packages` / `lockfile.buffers.string_bytes`: those buffers
    // can be reallocated concurrently by the main thread while processing
    // other dependencies (e.g. `appendPackage` / `StringBuilder.allocate`
    // in `Package.fromNPM`).
    let mut abs_buf = PathBuffer::uninit();
    let (tarball_path, normalize): (&[u8], bool) = 'tarball_path: {
        let workspace_pkg_id = this.lockfile.get_workspace_pkg_if_workspace_dep(dependency_id);
        if workspace_pkg_id == invalid_package_id {
            break 'tarball_path (path, true);
        }

        let workspace_res = this.lockfile.packages.items_resolution()[workspace_pkg_id as usize];
        if workspace_res.tag != Resolution::Tag::Workspace {
            break 'tarball_path (path, true);
        }

        // Construct an absolute path to the tarball.
        // Normally tarball paths are always relative to the root directory, but if a
        // workspace depends on a tarball path, it should be relative to the workspace.
        let workspace_path = workspace_res
            .value
            .workspace
            .slice(this.lockfile.buffers.string_bytes.as_slice());
        break 'tarball_path (
            Path::join_abs_string_buf(
                FileSystem::instance().top_level_dir,
                &mut abs_buf,
                &[workspace_path, path],
                Path::Platform::Auto,
            ),
            false,
        );
    };

    let task = this.preallocated_resolve_tasks.get();
    // SAFETY: task is a freshly acquired slot from the preallocated pool
    unsafe {
        *task = Task {
            package_manager: this,
            log: logger::Log::init(),
            tag: Task::Tag::LocalTarball,
            request: Task::Request::LocalTarball {
                tarball: ExtractTarball {
                    package_manager: this,
                    name: StringOrTinyString::init_append_if_needed(
                        name,
                        &mut FileSystem::FilenameStore::instance(),
                    )
                    .expect("unreachable"),
                    resolution,
                    cache_dir: this.get_cache_directory(),
                    temp_dir: this.get_temporary_directory().handle,
                    dependency_id,
                    integrity,
                    url: StringOrTinyString::init_append_if_needed(
                        path,
                        &mut FileSystem::FilenameStore::instance(),
                    )
                    .expect("unreachable"),
                    ..ExtractTarball::default()
                },
                tarball_path: StringOrTinyString::init_append_if_needed(
                    tarball_path,
                    &mut FileSystem::FilenameStore::instance(),
                )
                .expect("unreachable"),
                normalize,
            },
            id: task_id,
            // TODO(port): `data: undefined`
            ..Task::uninit()
        };
        &mut (*task).threadpool_task
    }
}

fn update_name_and_name_hash_from_version_replacement(
    lockfile: &Lockfile::Lockfile,
    original_name: SemverString,
    original_name_hash: PackageNameHash,
    new_version: Dependency::Version,
) -> (SemverString, PackageNameHash) {
    match new_version.tag {
        // only get name hash for npm and dist_tag. git, github, tarball don't have names until after extracting tarball
        Dependency::version::Tag::DistTag => (
            new_version.value.dist_tag.name,
            SemverString::Builder::string_hash(lockfile.str(&new_version.value.dist_tag.name)),
        ),
        Dependency::version::Tag::Npm => (
            new_version.value.npm.name,
            SemverString::Builder::string_hash(lockfile.str(&new_version.value.npm.name)),
        ),
        Dependency::version::Tag::Git => (new_version.value.git.package_name, original_name_hash),
        Dependency::version::Tag::Github => {
            (new_version.value.github.package_name, original_name_hash)
        }
        Dependency::version::Tag::Tarball => {
            (new_version.value.tarball.package_name, original_name_hash)
        }
        _ => (original_name, original_name_hash),
    }
}

pub enum ResolvedPackageTask {
    /// Pending network task to schedule
    NetworkTask(*mut NetworkTask),

    /// Apply patch task or calc patch hash task
    PatchTask(Box<PatchTask>),
}

pub struct ResolvedPackageResult {
    pub package: Lockfile::Package,

    /// Is this the first time we've seen this package?
    pub is_first_time: bool,

    pub task: Option<ResolvedPackageTask>,
}

impl Default for ResolvedPackageResult {
    fn default() -> Self {
        Self {
            package: Lockfile::Package::default(),
            is_first_time: false,
            task: None,
        }
    }
}

fn get_or_put_resolved_package_with_find_result(
    this: &mut PackageManager,
    name_hash: PackageNameHash,
    name: SemverString,
    dependency: &Dependency,
    version: Dependency::Version,
    dependency_id: DependencyID,
    behavior: Behavior,
    manifest: &Npm::PackageManifest,
    find_result: Npm::PackageManifest::FindResult,
    install_peer: bool,
    // PERF(port): was comptime monomorphization — profile in Phase B
    success_fn: SuccessFn,
) -> Result<Option<ResolvedPackageResult>, bun_core::Error> {
    // TODO(port): narrow error set
    let should_update = this.to_update
        // If updating, only update packages in the current workspace
        && this.lockfile.is_root_dependency(this, dependency_id)
        // no need to do a look up if update requests are empty (`bun update` with no args)
        && (this.update_requests.is_empty()
            || this.updating_packages.contains(
                dependency.name.slice(this.lockfile.buffers.string_bytes.as_slice()),
            ));

    // Was this package already allocated? Let's reuse the existing one.
    if let Some(id) = this.lockfile.get_package_id(
        name_hash,
        if should_update { None } else { Some(version) },
        &Resolution {
            tag: Resolution::Tag::Npm,
            value: Resolution::Value {
                npm: Resolution::NpmValue {
                    version: find_result.version,
                    url: find_result.package.tarball_url.value,
                },
            },
        },
    ) {
        success_fn(this, dependency_id, id);
        return Ok(Some(ResolvedPackageResult {
            package: this.lockfile.packages.get(id),
            is_first_time: false,
            task: None,
        }));
    } else if behavior.is_peer() && !install_peer {
        return Ok(None);
    }

    // appendPackage sets the PackageID on the package
    let package = this.lockfile.append_package(Lockfile::Package::from_npm(
        this,
        this.lockfile,
        &mut this.log,
        manifest,
        find_result.version,
        find_result.package,
        Features::npm(),
    )?)?;

    if cfg!(debug_assertions) {
        debug_assert!(package.meta.id != invalid_package_id);
    }
    // PORT NOTE: Zig used `defer successFn(...)`. Use scopeguard so success_fn runs on every
    // return below (including the `?` paths).
    let guard = scopeguard::guard((this, package.meta.id), |(this, pkg_id)| {
        success_fn(this, dependency_id, pkg_id);
    });
    let this: &mut PackageManager = &mut *guard.0;
    // PORT NOTE: Zig `defer` (not errdefer) — scopeguard runs on ALL exits, never disarmed.

    // non-null if the package is in "patchedDependencies"
    let mut name_and_version_hash: Option<u64> = None;
    let mut patchfile_hash: Option<u64> = None;

    let result = match this.determine_preinstall_state(
        package,
        this.lockfile,
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
            if !this.options.do_.prefetch_resolved_tarballs {
                break 'extract Some(ResolvedPackageResult {
                    package,
                    is_first_time: true,
                    task: None,
                });
            }

            let task_id = Task::Id::for_npm_package(
                this.lockfile.str(&name),
                package.resolution.value.npm.version,
            );
            debug_assert!(!this.network_dedupe_map.contains(&task_id));

            break 'extract Some(ResolvedPackageResult {
                package,
                is_first_time: true,
                task: Some(ResolvedPackageTask::NetworkTask(
                    this.generate_network_task_for_tarball(
                        task_id,
                        manifest.str(&find_result.package.tarball_url),
                        behavior.is_required(),
                        dependency_id,
                        package,
                        name_and_version_hash,
                        // its npm.
                        NetworkTask::Authorization::AllowAuthorization,
                    )?
                    .expect("unreachable"),
                )),
            });
        }
        install::PreinstallState::CalcPatchHash => Some(ResolvedPackageResult {
            package,
            is_first_time: true,
            task: Some(ResolvedPackageTask::PatchTask(PatchTask::new_calc_patch_hash(
                this,
                name_and_version_hash.unwrap(),
                PatchTask::CalcHashContext {
                    pkg_id: package.meta.id,
                    dependency_id,
                    url: Box::<[u8]>::from(manifest.str(&find_result.package.tarball_url)),
                },
            ))),
        }),
        install::PreinstallState::ApplyPatch => Some(ResolvedPackageResult {
            package,
            is_first_time: true,
            task: Some(ResolvedPackageTask::PatchTask(PatchTask::new_apply_patch_hash(
                this,
                package.meta.id,
                patchfile_hash.unwrap(),
                name_and_version_hash.unwrap(),
            ))),
        }),
        _ => unreachable!(),
    };

    Ok(result)
    // `guard` drops here → success_fn(this, dependency_id, package.meta.id)
}

fn get_or_put_resolved_package(
    this: &mut PackageManager,
    name_hash: PackageNameHash,
    name: SemverString,
    dependency: &Dependency,
    version: Dependency::Version,
    behavior: Behavior,
    dependency_id: DependencyID,
    resolution: PackageID,
    install_peer: bool,
    // PERF(port): was comptime monomorphization — profile in Phase B
    success_fn: SuccessFn,
) -> Result<Option<ResolvedPackageResult>, bun_core::Error> {
    // TODO(port): narrow error set
    if install_peer && behavior.is_peer() {
        if let Some(index) = this.lockfile.package_index.get(&name_hash) {
            let resolutions = this.lockfile.packages.items_resolution();
            match index {
                Lockfile::PackageIndexEntry::Id(existing_id) => {
                    let existing_id = *existing_id;
                    if (existing_id as usize) < resolutions.len() {
                        let existing_resolution = resolutions[existing_id as usize];
                        if resolution_satisfies_dependency(this, existing_resolution, version) {
                            success_fn(this, dependency_id, existing_id);
                            return Ok(Some(ResolvedPackageResult {
                                // we must fetch it from the packages array again, incase the package array mutates the value in the `successFn`
                                package: this.lockfile.packages.get(existing_id),
                                ..Default::default()
                            }));
                        }

                        let res_tag = resolutions[existing_id as usize].tag;
                        let ver_tag = version.tag;
                        if (res_tag == Resolution::Tag::Npm && ver_tag == Dependency::version::Tag::Npm)
                            || (res_tag == Resolution::Tag::Git
                                && ver_tag == Dependency::version::Tag::Git)
                            || (res_tag == Resolution::Tag::Github
                                && ver_tag == Dependency::version::Tag::Github)
                        {
                            let existing_package = this.lockfile.packages.get(existing_id);
                            this.log
                                .add_warning_fmt(
                                    None,
                                    logger::Loc::EMPTY,
                                    format_args!(
                                        "incorrect peer dependency \"{}@{}\"",
                                        existing_package
                                            .name
                                            .fmt(this.lockfile.buffers.string_bytes.as_slice()),
                                        existing_package.resolution.fmt(
                                            this.lockfile.buffers.string_bytes.as_slice(),
                                            Resolution::FmtMode::Auto
                                        ),
                                    ),
                                )
                                .expect("unreachable");
                            success_fn(this, dependency_id, existing_id);
                            return Ok(Some(ResolvedPackageResult {
                                // we must fetch it from the packages array again, incase the package array mutates the value in the `successFn`
                                package: this.lockfile.packages.get(existing_id),
                                ..Default::default()
                            }));
                        }
                    }
                }
                Lockfile::PackageIndexEntry::Ids(list) => {
                    for &existing_id in list.iter() {
                        if (existing_id as usize) < resolutions.len() {
                            let existing_resolution = resolutions[existing_id as usize];
                            if resolution_satisfies_dependency(this, existing_resolution, version) {
                                success_fn(this, dependency_id, existing_id);
                                return Ok(Some(ResolvedPackageResult {
                                    package: this.lockfile.packages.get(existing_id),
                                    ..Default::default()
                                }));
                            }
                        }
                    }

                    if (list[0] as usize) < resolutions.len() {
                        let res_tag = resolutions[list[0] as usize].tag;
                        let ver_tag = version.tag;
                        if (res_tag == Resolution::Tag::Npm
                            && ver_tag == Dependency::version::Tag::Npm)
                            || (res_tag == Resolution::Tag::Git
                                && ver_tag == Dependency::version::Tag::Git)
                            || (res_tag == Resolution::Tag::Github
                                && ver_tag == Dependency::version::Tag::Github)
                        {
                            let existing_package_id = list[0];
                            let existing_package = this.lockfile.packages.get(existing_package_id);
                            this.log
                                .add_warning_fmt(
                                    None,
                                    logger::Loc::EMPTY,
                                    format_args!(
                                        "incorrect peer dependency \"{}@{}\"",
                                        existing_package
                                            .name
                                            .fmt(this.lockfile.buffers.string_bytes.as_slice()),
                                        existing_package.resolution.fmt(
                                            this.lockfile.buffers.string_bytes.as_slice(),
                                            Resolution::FmtMode::Auto
                                        ),
                                    ),
                                )
                                .expect("unreachable");
                            success_fn(this, dependency_id, list[0]);
                            return Ok(Some(ResolvedPackageResult {
                                // we must fetch it from the packages array again, incase the package array mutates the value in the `successFn`
                                package: this.lockfile.packages.get(existing_package_id),
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
            package: this.lockfile.packages.get(resolution),
            ..Default::default()
        }));
    }

    match version.tag {
        Dependency::version::Tag::Npm | Dependency::version::Tag::DistTag => {
            'resolve_from_workspace: {
                if version.tag == Dependency::version::Tag::Npm {
                    let workspace_path = if this.lockfile.workspace_paths.count() > 0 {
                        this.lockfile.workspace_paths.get(&name_hash)
                    } else {
                        None
                    };
                    let workspace_version = this.lockfile.workspace_versions.get(&name_hash);
                    let buf = this.lockfile.buffers.string_bytes.as_slice();
                    if this.options.link_workspace_packages
                        && ((workspace_version.is_some()
                            && version
                                .value
                                .npm
                                .version
                                .satisfies(workspace_version.unwrap(), buf, buf))
                            // https://github.com/oven-sh/bun/pull/10899#issuecomment-2099609419
                            // if the workspace doesn't have a version, it can still be used if
                            // dependency version is wildcard
                            || (workspace_path.is_some() && version.value.npm.version.is_star()))
                    {
                        let Some(root_package) = this.lockfile.root_package() else {
                            break 'resolve_from_workspace;
                        };
                        let root_dependencies = root_package
                            .dependencies
                            .get(this.lockfile.buffers.dependencies.as_slice());
                        let root_resolutions = root_package
                            .resolutions
                            .get(this.lockfile.buffers.resolutions.as_slice());

                        debug_assert_eq!(root_dependencies.len(), root_resolutions.len());
                        for (root_dep, &workspace_package_id) in
                            root_dependencies.iter().zip(root_resolutions)
                        {
                            if workspace_package_id != invalid_package_id
                                && root_dep.version.tag == Dependency::version::Tag::Workspace
                                && root_dep.name_hash == name_hash
                            {
                                // make sure verifyResolutions sees this resolution as a valid package id
                                success_fn(this, dependency_id, workspace_package_id);
                                return Ok(Some(ResolvedPackageResult {
                                    package: this.lockfile.packages.get(workspace_package_id),
                                    is_first_time: false,
                                    task: None,
                                }));
                            }
                        }
                    }
                }
            }

            // Resolve the version from the loaded NPM manifest
            let name_str = this.lockfile.str(&name);

            let Some(manifest) = this.manifests.by_name_hash(
                this,
                this.scope_for_package_name(name_str),
                name_hash,
                Npm::ManifestLoad::LoadFromMemoryFallbackToDisk,
                this.options.minimum_release_age_ms.is_some(),
            ) else {
                return Ok(None); // manifest might still be downloading. This feels unreliable.
            };

            let version_result: Npm::PackageManifest::FindVersionResult = match version.tag {
                Dependency::version::Tag::DistTag => manifest.find_by_dist_tag_with_filter(
                    this.lockfile.str(&version.value.dist_tag.tag),
                    this.options.minimum_release_age_ms,
                    &this.options.minimum_release_age_excludes,
                ),
                Dependency::version::Tag::Npm => manifest.find_best_version_with_filter(
                    &version.value.npm.version,
                    this.lockfile.buffers.string_bytes.as_slice(),
                    this.options.minimum_release_age_ms,
                    &this.options.minimum_release_age_excludes,
                ),
                _ => unreachable!(),
            };

            let find_result_opt: Option<Npm::PackageManifest::FindResult> = match version_result {
                Npm::PackageManifest::FindVersionResult::Found(result) => Some(result),
                Npm::PackageManifest::FindVersionResult::FoundWithFilter(filtered) => 'blk: {
                    let package_name = this.lockfile.str(&name);
                    if this.options.log_level.is_verbose() {
                        if let Some(newest) = &filtered.newest_filtered {
                            let min_age_seconds =
                                this.options.minimum_release_age_ms.unwrap_or(0) / MS_PER_S;
                            match version.tag {
                                Dependency::version::Tag::DistTag => {
                                    let tag_str = this.lockfile.str(&version.value.dist_tag.tag);
                                    Output::pretty_errorln(format_args!(
                                        "<d>[minimum-release-age]<r> <b>{}@{}<r> selected <green>{}<r> instead of <yellow>{}<r> due to {}-second filter",
                                        bstr::BStr::new(package_name),
                                        bstr::BStr::new(tag_str),
                                        filtered.result.version.fmt(manifest.string_buf),
                                        newest.fmt(manifest.string_buf),
                                        min_age_seconds,
                                    ));
                                }
                                Dependency::version::Tag::Npm => {
                                    let version_str =
                                        version.value.npm.version.fmt(manifest.string_buf);
                                    Output::pretty_errorln(format_args!(
                                        "<d>[minimum-release-age]<r> <b>{}<r>@{}<r> selected <green>{}<r> instead of <yellow>{}<r> due to {}-second filter",
                                        bstr::BStr::new(package_name),
                                        version_str,
                                        filtered.result.version.fmt(manifest.string_buf),
                                        newest.fmt(manifest.string_buf),
                                        min_age_seconds,
                                    ));
                                }
                                _ => unreachable!(),
                            }
                        }
                    }

                    break 'blk Some(filtered.result);
                }
                Npm::PackageManifest::FindVersionResult::Err(err_type) => match err_type {
                    Npm::PackageManifest::FindVersionError::TooRecent
                    | Npm::PackageManifest::FindVersionError::AllVersionsTooRecent => {
                        return Err(bun_core::err!("TooRecentVersion"));
                    }
                    Npm::PackageManifest::FindVersionError::NotFound => None, // Handle below with existing logic
                },
            };

            let find_result = match find_result_opt {
                Some(r) => r,
                None => {
                    'resolve_workspace_from_dist_tag: {
                        // choose a workspace for a dist_tag only if a version was not found
                        if version.tag == Dependency::version::Tag::DistTag {
                            let workspace_path = if this.lockfile.workspace_paths.count() > 0 {
                                this.lockfile.workspace_paths.get(&name_hash)
                            } else {
                                None
                            };
                            if workspace_path.is_some() {
                                let Some(root_package) = this.lockfile.root_package() else {
                                    break 'resolve_workspace_from_dist_tag;
                                };
                                let root_dependencies = root_package
                                    .dependencies
                                    .get(this.lockfile.buffers.dependencies.as_slice());
                                let root_resolutions = root_package
                                    .resolutions
                                    .get(this.lockfile.buffers.resolutions.as_slice());

                                debug_assert_eq!(root_dependencies.len(), root_resolutions.len());
                                for (root_dep, &workspace_package_id) in
                                    root_dependencies.iter().zip(root_resolutions)
                                {
                                    if workspace_package_id != invalid_package_id
                                        && root_dep.version.tag
                                            == Dependency::version::Tag::Workspace
                                        && root_dep.name_hash == name_hash
                                    {
                                        // make sure verifyResolutions sees this resolution as a valid package id
                                        success_fn(this, dependency_id, workspace_package_id);
                                        return Ok(Some(ResolvedPackageResult {
                                            package: this.lockfile.packages.get(workspace_package_id),
                                            is_first_time: false,
                                            task: None,
                                        }));
                                    }
                                }
                            }
                        }
                    }

                    if behavior.is_peer() {
                        return Ok(None);
                    }

                    return match version.tag {
                        Dependency::version::Tag::Npm => Err(bun_core::err!("NoMatchingVersion")),
                        Dependency::version::Tag::DistTag => Err(bun_core::err!("DistTagNotFound")),
                        _ => unreachable!(),
                    };
                }
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
        }

        Dependency::version::Tag::Folder => {
            let res: FolderResolution = 'res: {
                if this.lockfile.is_workspace_dependency(dependency_id) {
                    // relative to cwd
                    let folder_path = this.lockfile.str(&version.value.folder);
                    let mut buf2 = PathBuffer::uninit();
                    let folder_path_abs = if bun_paths::is_absolute(folder_path) {
                        folder_path
                    } else {
                        Path::join_abs_string_buf(
                            FileSystem::instance().top_level_dir,
                            &mut buf2,
                            &[folder_path],
                            Path::Platform::Auto,
                        )
                        // break :blk Path.joinAbsStringBuf(
                        //     strings.withoutSuffixComptime(this.original_package_json_path, "package.json"),
                        //     &buf2,
                        //     &[_]string{folder_path},
                        //     .auto,
                        // );
                    };

                    // if (strings.eqlLong(strings.withoutTrailingSlash(folder_path_abs), strings.withoutTrailingSlash(FileSystem.instance.top_level_dir), true)) {
                    //     successFn(this, dependency_id, 0);
                    //     return .{ .package = this.lockfile.packages.get(0) };
                    // }

                    break 'res FolderResolution::get_or_put(
                        FolderResolution::Kind::Relative(FolderResolution::RelativeKind::Folder),
                        version,
                        folder_path_abs,
                        this,
                    );
                }

                // transitive folder dependencies do not have their dependencies resolved
                let mut name_slice = this.lockfile.str(&name);
                let mut folder_path = this.lockfile.str(&version.value.folder);
                let mut package = Lockfile::Package::default();

                {
                    // only need name and path
                    let mut builder = this.lockfile.string_builder();

                    builder.count(name_slice);
                    builder.count(folder_path);

                    builder.allocate().expect("OOM");

                    name_slice = this.lockfile.str(&name);
                    folder_path = this.lockfile.str(&version.value.folder);

                    package.name = builder.append::<SemverString>(name_slice);
                    package.name_hash = name_hash;

                    package.resolution = Resolution::init(Resolution::Value {
                        folder: builder.append::<SemverString>(folder_path),
                    });

                    package.scripts.filled = true;
                    package.meta.set_has_install_script(false);

                    builder.clamp();
                }

                // these are always new
                package = this.lockfile.append_package(package).expect("OOM");

                break 'res FolderResolution::NewPackageId(package.meta.id);
            };

            match res {
                FolderResolution::Err(err) => Err(err),
                FolderResolution::PackageId(package_id) => {
                    success_fn(this, dependency_id, package_id);
                    Ok(Some(ResolvedPackageResult {
                        package: this.lockfile.packages.get(package_id),
                        ..Default::default()
                    }))
                }
                FolderResolution::NewPackageId(package_id) => {
                    success_fn(this, dependency_id, package_id);
                    Ok(Some(ResolvedPackageResult {
                        package: this.lockfile.packages.get(package_id),
                        is_first_time: true,
                        task: None,
                    }))
                }
            }
        }
        Dependency::version::Tag::Workspace => {
            // package name hash should be used to find workspace path from map
            let workspace_path_raw: &SemverString = this
                .lockfile
                .workspace_paths
                .get_ptr(&name_hash)
                .unwrap_or(&version.value.workspace);
            let workspace_path = this.lockfile.str(workspace_path_raw);
            let mut buf2 = PathBuffer::uninit();
            let workspace_path_u8 = if bun_paths::is_absolute(workspace_path) {
                workspace_path
            } else {
                Path::join_abs_string_buf(
                    FileSystem::instance().top_level_dir,
                    &mut buf2,
                    &[workspace_path],
                    Path::Platform::Auto,
                )
            };

            let res = FolderResolution::get_or_put(
                FolderResolution::Kind::Relative(FolderResolution::RelativeKind::Workspace),
                version,
                workspace_path_u8,
                this,
            );

            match res {
                FolderResolution::Err(err) => Err(err),
                FolderResolution::PackageId(package_id) => {
                    success_fn(this, dependency_id, package_id);
                    Ok(Some(ResolvedPackageResult {
                        package: this.lockfile.packages.get(package_id),
                        ..Default::default()
                    }))
                }
                FolderResolution::NewPackageId(package_id) => {
                    success_fn(this, dependency_id, package_id);
                    Ok(Some(ResolvedPackageResult {
                        package: this.lockfile.packages.get(package_id),
                        is_first_time: true,
                        task: None,
                    }))
                }
            }
        }
        Dependency::version::Tag::Symlink => {
            let res = FolderResolution::get_or_put(
                FolderResolution::Kind::Global(this.global_link_dir_path()),
                version,
                this.lockfile.str(&version.value.symlink),
                this,
            );

            match res {
                FolderResolution::Err(err) => Err(err),
                FolderResolution::PackageId(package_id) => {
                    success_fn(this, dependency_id, package_id);
                    Ok(Some(ResolvedPackageResult {
                        package: this.lockfile.packages.get(package_id),
                        ..Default::default()
                    }))
                }
                FolderResolution::NewPackageId(package_id) => {
                    success_fn(this, dependency_id, package_id);
                    Ok(Some(ResolvedPackageResult {
                        package: this.lockfile.packages.get(package_id),
                        is_first_time: true,
                        task: None,
                    }))
                }
            }
        }

        _ => Ok(None),
    }
}

fn resolution_satisfies_dependency(
    this: &PackageManager,
    resolution: Resolution,
    dependency: Dependency::Version,
) -> bool {
    let buf = this.lockfile.buffers.string_bytes.as_slice();
    if resolution.tag == Resolution::Tag::Npm && dependency.tag == Dependency::version::Tag::Npm {
        return dependency
            .value
            .npm
            .version
            .satisfies(resolution.value.npm.version, buf, buf);
    }

    if resolution.tag == Resolution::Tag::Git && dependency.tag == Dependency::version::Tag::Git {
        return resolution.value.git.eql(&dependency.value.git, buf, buf);
    }

    if resolution.tag == Resolution::Tag::Github
        && dependency.tag == Dependency::version::Tag::Github
    {
        return resolution.value.github.eql(&dependency.value.github, buf, buf);
    }

    false
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/PackageManagerEnqueue.zig (2026 lines)
//   confidence: medium
//   todos:      15
//   notes:      comptime SuccessFn/FailFn demoted to runtime fn ptrs (identity-compared); Task pool slots kept as raw *mut with in-place init; defer successFn → scopeguard (never disarmed); Closure<'a> per LIFETIMES.tsv; heavy borrowck reshaping expected in Phase B
// ──────────────────────────────────────────────────────────────────────────
