use crate::lockfile::package::PackageColumns as _;
use core::mem::ManuallyDrop;
use core::sync::atomic::Ordering;

use bun_core::Output;
use bun_core::{StringOrTinyString, strings};
use bun_paths::{self as Path, PathBuffer};
use bun_semver::{self as Semver, String as SemverString};
use bun_sys::Fd;
use bun_threading::thread_pool as ThreadPool;

use crate::bun_fs::FileSystem;

use crate::dependency;
use crate::dependency::{DependencyExt as _, VersionExt as _};
use crate::lockfile::PackageIndexEntry;
use crate::package_manager_real::{
    PackageManager, TaskCallbackList, get_cache_directory, get_temporary_directory, run_tasks,
};
use crate::package_manager_task as Task;
use crate::resolution::Tag as ResolutionTag;
use bun_install::NetworkTask;
use bun_install::{
    Behavior, Dependency, DependencyID, ExtractTarball, Integrity, PackageID, PatchTask,
    Repository, Resolution, TaskCallbackContext, invalid_package_id,
};

// The `use package_manager_real::PackageManager`
// above already pulls the `declare_scope!`-generated `static PackageManager: ScopedLogger`
// (value namespace) alongside the struct (type namespace), so re-declaring it here
// would collide. `scoped_log!(PackageManager, ...)` below resolves to that import.

pub(crate) type EnqueuePackageForDownloadError = crate::network_task::ForTarballError;
pub(crate) type EnqueueTarballForDownloadError = crate::network_task::ForTarballError;

// ─────────────────────────────────────────────────────────────────────────────

pub fn enqueue_tarball_for_download(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    package_id: PackageID,
    url: &[u8],
    task_context: TaskCallbackContext,
    patch_name_and_version_hash: Option<u64>,
) -> Result<(), EnqueueTarballForDownloadError> {
    let task_id = Task::Id::for_tarball(url);
    if this.network_task_has_failed(task_id) {
        return Err(EnqueueTarballForDownloadError::AlreadyFailed);
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
        patch_name_and_version_hash,
        crate::network_task::Authorization::NoAuthorization,
    )? {
        // reshaped for borrowck — `task: &mut NetworkTask` borrows
        // `*this` (pool slot); reborrow as raw so `this.network_tarball_batch`
        // is reachable.
        let task: *mut NetworkTask = task;
        // SAFETY: `task` is the unique handle to a freshly-vended pool slot.
        unsafe { (*task).schedule(&mut this.network_tarball_batch) };
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
    // reshaped for borrowck — `path` borrows
    // `this.lockfile.buffers.string_bytes`; detach the slice lifetime so the
    // `&mut PackageManager` reborrow for `enqueue_local_tarball` below does
    // not conflict.
    // SAFETY: caller passes `resolution.tag == LocalTarball`; the
    // `local_tarball` arm is the active union field. `string_bytes` is not
    // resized in this fn — `enqueue_local_tarball` copies `path` into the
    // filename store before any append.
    let path = this.lockfile.str_detached(resolution.local_tarball());
    let task_id = Task::Id::for_tarball(path);
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
    this.task_batch.push(ThreadPool::Batch::from(task));
}

pub fn enqueue_git_for_checkout(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    alias: &[u8],
    resolution: &Resolution,
    task_context: TaskCallbackContext,
    patch_name_and_version_hash: Option<u64>,
) {
    // SAFETY: caller passes `resolution.tag == Git`; the `git` arm is the
    // active union field. Copy out so the value no longer borrows
    // `*resolution` while `*this` is mutably reborrowed below.
    let repository: Repository = *resolution.git();
    // reshaped for borrowck — `url`/`resolved` borrow
    // `this.lockfile.buffers.string_bytes`; detach the slice lifetimes so the
    // `&mut PackageManager` reborrows for the enqueue callees below do not
    // conflict.
    // SAFETY: the enqueue callees copy these slices into the filename store
    // and never resize `string_bytes` while they are live.
    let url = this.lockfile.str_detached(&repository.repo);
    let clone_id = Task::Id::for_git_clone(url);
    let resolved = this.lockfile.str_detached(&repository.resolved);
    let checkout_id = Task::Id::for_git_checkout(url, resolved);
    let checkout_queue = this
        .task_queue
        .get_or_put(checkout_id)
        .expect("unreachable");
    if !checkout_queue.found_existing {
        *checkout_queue.value_ptr = TaskCallbackList::default();
    }

    checkout_queue.value_ptr.push(task_context);

    if checkout_queue.found_existing {
        return;
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
        this.task_batch.push(ThreadPool::Batch::from(task));
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

        let dep = this.lockfile.buffers.dependencies[dependency_id as usize].clone();
        let task = enqueue_git_clone(
            this,
            clone_id,
            alias,
            &repository,
            dependency_id,
            &dep,
            resolution,
            None,
        );
        this.task_batch.push(ThreadPool::Batch::from(task));
    }
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
    if this.network_task_has_failed(task_id) {
        return Err(EnqueuePackageForDownloadError::AlreadyFailed);
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
        patch_name_and_version_hash,
        crate::network_task::Authorization::AllowAuthorization,
    )? {
        // reshaped for borrowck — see `enqueue_tarball_for_download`.
        let task: *mut NetworkTask = task;
        // SAFETY: `task` is the unique handle to a freshly-vended pool slot.
        unsafe { (*task).schedule(&mut this.network_tarball_batch) };
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
            .clone_with_different_buffers(name, version_buf, &mut builder)
            .expect("unreachable");
        builder.clamp();
        let index = lf.dependencies.len();
        lf.dependencies.push(dep);
        lf.resolutions.push(invalid_package_id);
        debug_assert!(lf.dependencies.len() == lf.resolutions.len());
        break 'brk index;
    } as DependencyID;

    if this.lockfile.buffers.resolutions[dep_id as usize] == invalid_package_id {
        if this.options.log_level.show_progress() {
            this.start_progress_bar_if_none();
        }

        // Resolve only this dependency and what it pulls in: every other edge
        // the runtime lockfile leaves unresolved stays unresolved. The edge
        // lives outside the root package's dependency slice, so it is seeded
        // into the cursor explicitly.
        this.mark_settled_unresolved_edges(&[dep_id]);
        let log_level = this.options.log_level;
        if let Err(err) = this.resolve_graph::<VoidRunTasksCallbacks>(
            log_level,
            &[dep_id],
            super::resolve_graph::Announce::Silent,
            false,
        ) {
            return DependencyToEnqueue::Failure(err);
        }

        if this.options.log_level.show_progress() {
            this.end_progress_bar();
            Output::flush();
        }
    }

    let resolution_id = this.lockfile.buffers.resolutions[dep_id as usize];

    if resolution_id == invalid_package_id {
        return DependencyToEnqueue::NotFound;
    }

    DependencyToEnqueue::Resolution {
        resolution: this.lockfile.packages.items_resolution()[resolution_id as usize],
        package_id: resolution_id,
    }
}

/// All-void callback set for resolution driven outside an install command
/// (runtime auto-install): `Ctx = ()`, no callbacks, so the `HAS_*`
/// const-gates compile out the callback paths.
pub(crate) struct VoidRunTasksCallbacks;
impl run_tasks::RunTasksCallbacks for VoidRunTasksCallbacks {
    type Ctx = ();
}

pub fn enqueue_network_task(this: &mut PackageManager, task: *mut NetworkTask) {
    if this.network_task_fifo.writable_length() == 0 {
        this.flush_network_queue();
    }

    this.network_task_fifo.write_item_assume_capacity(task);
}

/// # Safety
/// `task` must be a non-null `heap::alloc`'d `PatchTask` whose ownership is
/// being transferred to the patch-task fifo.
pub unsafe fn enqueue_patch_task(this: &mut PackageManager, task: *mut PatchTask) {
    bun_output::scoped_log!(
        PackageManager,
        "Enqueue patch task: 0x{:x} {}",
        task as usize,
        // SAFETY: `task` is non-null (fresh `heap::alloc` from `new_*`).
        unsafe { (*task).callback.tag_name() }
    );
    if this.patch_task_fifo.writable_length() == 0 {
        this.flush_patch_task_queue();
    }

    this.patch_task_fifo.write_item_assume_capacity(task);
}

/// We need to calculate all the patchfile hashes at the beginning so we don't run into problems with stale hashes
/// # Safety
/// `task` must be a non-null `heap::alloc`'d `PatchTask` whose ownership is
/// being transferred to the patch-task fifo.
pub unsafe fn enqueue_patch_task_pre(this: &mut PackageManager, task: *mut PatchTask) {
    bun_output::scoped_log!(
        PackageManager,
        "Enqueue patch task pre: 0x{:x} {}",
        task as usize,
        // SAFETY: `task` is non-null (fresh `heap::alloc` from `new_*`).
        unsafe { (*task).callback.tag_name() }
    );
    // SAFETY: `task` is non-null (fresh `heap::alloc` from `new_*`).
    unsafe { (*task).pre = true };
    if this.patch_task_fifo.writable_length() == 0 {
        this.flush_patch_task_queue();
    }

    this.patch_task_fifo.write_item_assume_capacity(task);
    let _ = this.pending_pre_calc_hashes.fetch_add(1, Ordering::Relaxed);
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
                        skip_verify: !this
                            .options
                            .do_
                            .contains(crate::package_manager_real::options::Do::VERIFY_INTEGRITY),
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
    // SAFETY: init_extract_task returns a valid *mut Task
    unsafe { &raw mut (*init_extract_task(this, tarball, network_task)).threadpool_task }
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
) -> *mut Task::Task<'static> {
    init_extract_task(this, tarball, network_task)
}

pub(crate) fn enqueue_git_clone(
    this: &mut PackageManager,
    task_id: Task::Id,
    name: &[u8],
    repository: &Repository,
    dep_id: DependencyID,
    dependency: &Dependency,
    res: &Resolution,
    // if patched then we need to do apply step after network task is done
    patch_name_and_version_hash: Option<u64>,
) -> *mut ThreadPool::Task {
    // Build the `Task` value *before* claiming a hive slot. Several initializers
    // below (`.expect()`, `.unwrap()`, `panic!`) can unwind; doing them with the
    // slot already claimed would leave a claimed-but-uninit `Task` (which carries
    // `Log`/`Box<PatchTask>` drop glue) for the next `put()` to drop. With
    // `get_init` the slot is claimed only after the value is fully constructed.
    //
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
    let value = Task::Task {
        // `this` is a live `&mut PackageManager`; the task is owned by
        // `this.preallocated_resolve_tasks` and never outlives the manager.
        // Safe `From<NonNull>` construction preserves the `&mut`-derived write
        // provenance for `assume_mut()` in `Task::callback`.
        package_manager: Some(bun_ptr::ParentRef::from(core::ptr::NonNull::from(
            &mut *this,
        ))),
        log: bun_ast::Log::init(),
        tag: crate::package_manager_task::Tag::GitClone,
        request: crate::package_manager_task::Request {
            git_clone: ManuallyDrop::new(crate::package_manager_task::GitCloneRequest {
                name: StringOrTinyString::init_append_if_needed(
                    name,
                    &mut crate::network_task::filename_store_appender(),
                )
                .expect("unreachable"),
                url: StringOrTinyString::init_append_if_needed(
                    this.lockfile.str(&repository.repo),
                    &mut crate::network_task::filename_store_appender(),
                )
                .expect("unreachable"),
                env: crate::repository::SharedEnv::get(this.env_mut()),
                dep_id,
                res: *res,
            }),
        },
        id: task_id,
        apply_patch_task: if let Some((h, patch_hash)) = patch {
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
            let pt = PatchTask::new_apply_patch_hash(this, pkg_id, patch_hash, h);
            // SAFETY: `pt` is fresh from `heap::alloc`; reclaim ownership.
            let mut pt = unsafe { bun_core::heap::take(pt) };
            pt.callback.apply_mut().task_id = Some(task_id);
            Some(pt)
        } else {
            None
        },
        ..Task::uninit()
    };
    let task = this.preallocated_resolve_tasks.get_init(value).as_ptr();
    // SAFETY: `get_init` just fully initialized the slot.
    unsafe { &raw mut (*task).threadpool_task }
}

pub fn enqueue_git_checkout(
    this: &mut PackageManager,
    task_id: Task::Id,
    dir: Fd,
    dependency_id: DependencyID,
    name: &[u8],
    resolution: &Resolution,
    resolved: &[u8],
    // if patched then we need to do apply step after network task is done
    patch_name_and_version_hash: Option<u64>,
) -> *mut ThreadPool::Task {
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
                    name: StringOrTinyString::init_append_if_needed(
                        name,
                        &mut crate::network_task::filename_store_appender(),
                    )
                    .expect("unreachable"),
                    url: StringOrTinyString::init_append_if_needed(
                        // `resolution.tag == Git` for the git-checkout path.
                        this.lockfile.str(&resolution.git().repo),
                        &mut crate::network_task::filename_store_appender(),
                    )
                    .expect("unreachable"),
                    resolved: StringOrTinyString::init_append_if_needed(
                        resolved,
                        &mut crate::network_task::filename_store_appender(),
                    )
                    .expect("unreachable"),
                    env: crate::repository::SharedEnv::get(this.env_mut()),
                }),
            },
            apply_patch_task: if let Some((h, patch_hash)) = patch {
                let dep_name_hash =
                    this.lockfile.buffers.dependencies[dependency_id as usize].name_hash;
                let pkg_id = match this
                    .lockfile
                    .package_index
                    .get(&dep_name_hash)
                    .unwrap_or_else(|| panic!("Package not found"))
                {
                    PackageIndexEntry::Id(p) => *p,
                    PackageIndexEntry::Ids(ps) => ps[0], // TODO is this correct
                };
                let pt = PatchTask::new_apply_patch_hash(this, pkg_id, patch_hash, h);
                // SAFETY: `pt` is fresh from `heap::alloc`; reclaim ownership.
                let mut pt = bun_core::heap::take(pt);
                pt.callback.apply_mut().task_id = Some(task_id);
                Some(pt)
            } else {
                None
            },
            id: task_id,
            ..Task::uninit()
        }
    };
    let task = this.preallocated_resolve_tasks.get_init(task_value);
    // SAFETY: `task` points to a freshly initialized pool slot.
    unsafe { &raw mut (*task.as_ptr()).threadpool_task }
}

pub(crate) fn enqueue_local_tarball(
    this: &mut PackageManager,
    task_id: Task::Id,
    dependency_id: DependencyID,
    name: &[u8],
    path: &[u8],
    resolution: &Resolution,
    integrity: &Integrity,
) -> *mut ThreadPool::Task {
    // Resolve the on-disk tarball path here on the main thread. The task
    // callback runs on a ThreadPool worker and must not read
    // `lockfile.packages` / `lockfile.buffers.string_bytes`: those buffers
    // can be reallocated concurrently by the main thread while processing
    // other dependencies (e.g. `appendPackage` / `StringBuilder.allocate`
    // in `Package.fromNPM`).
    let mut abs_buf = PathBuffer::uninit();
    let (tarball_path, normalize): (&[u8], bool) = 'tarball_path: {
        let workspace_pkg_id = this
            .lockfile
            .get_workspace_pkg_if_workspace_dep(dependency_id);
        if workspace_pkg_id == invalid_package_id {
            break 'tarball_path (path, true);
        }

        let workspace_res = this.lockfile.packages.items_resolution()[workspace_pkg_id as usize];
        if workspace_res.tag != ResolutionTag::Workspace {
            break 'tarball_path (path, true);
        }

        // Construct an absolute path to the tarball.
        // Normally tarball paths are always relative to the root directory, but if a
        // workspace depends on a tarball path, it should be relative to the workspace.
        let workspace_str = *workspace_res.workspace();
        let workspace_path = workspace_str.slice(this.lockfile.buffers.string_bytes.as_slice());
        let joined = Path::resolve_path::join_abs_string_buf::<Path::platform::Auto>(
            FileSystem::instance().top_level_dir(),
            &mut abs_buf,
            &[workspace_path, path],
        );
        break 'tarball_path (joined, false);
    };

    // Build the `Task` value *before* claiming a hive slot — the `.expect()`s
    // below can unwind, and `Task` carries drop glue. See `enqueue_git_clone`.
    let value = Task::Task {
        // `this` is a live `&mut PackageManager`; the task is owned by
        // `this.preallocated_resolve_tasks` and never outlives the manager.
        // Safe `From<NonNull>` construction preserves the `&mut`-derived write
        // provenance for `assume_mut()` in `Task::callback`.
        package_manager: Some(bun_ptr::ParentRef::from(core::ptr::NonNull::from(
            &mut *this,
        ))),
        log: bun_ast::Log::init(),
        tag: crate::package_manager_task::Tag::LocalTarball,
        request: crate::package_manager_task::Request {
            local_tarball: ManuallyDrop::new(crate::package_manager_task::LocalTarballRequest {
                tarball: ExtractTarball {
                    package_manager: bun_ptr::BackRef::new(this),
                    name: StringOrTinyString::init_append_if_needed(
                        name,
                        &mut crate::network_task::filename_store_appender(),
                    )
                    .expect("unreachable"),
                    resolution: *resolution,
                    // `ExtractTarball::{cache_dir,temp_dir}` are borrowed views — the
                    // descriptors are owned by the `PackageManager` singleton and the
                    // `TemporaryDirectory` once-cell. They must be `Fd`, not owning `Dir`.
                    cache_dir: get_cache_directory(this),
                    temp_dir: get_temporary_directory(this).handle.fd(),
                    dependency_id,
                    integrity: *integrity,
                    url: StringOrTinyString::init_append_if_needed(
                        path,
                        &mut crate::network_task::filename_store_appender(),
                    )
                    .expect("unreachable"),
                    skip_verify: false,
                    in_trusted_dependencies: false,
                },
                tarball_path: StringOrTinyString::init_append_if_needed(
                    tarball_path,
                    &mut crate::network_task::filename_store_appender(),
                )
                .expect("unreachable"),
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

// ──────────────────────────────────────────────────────────────────────────
// `impl PackageManager` — inherent-method facade over the free fns above.
//
// Sibling files (PackageManagerLifecycle, …Directories,
// runTasks) all expose an `impl PackageManager` block. Match that
// pattern here so cross-file callers can keep the `.method()` shape.
// ──────────────────────────────────────────────────────────────────────────

impl PackageManager {
    #[inline]
    pub(crate) fn enqueue_tarball_for_download(
        &mut self,
        dependency_id: DependencyID,
        package_id: PackageID,
        url: &[u8],
        task_context: TaskCallbackContext,
        patch_name_and_version_hash: Option<u64>,
    ) -> Result<(), EnqueueTarballForDownloadError> {
        enqueue_tarball_for_download(
            self,
            dependency_id,
            package_id,
            url,
            task_context,
            patch_name_and_version_hash,
        )
    }

    #[inline]
    pub(crate) fn enqueue_tarball_for_reading(
        &mut self,
        dependency_id: DependencyID,
        package_id: PackageID,
        alias: &[u8],
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
        alias: &[u8],
        resolution: &Resolution,
        task_context: TaskCallbackContext,
        patch_name_and_version_hash: Option<u64>,
    ) {
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
        name: &[u8],
        dependency_id: DependencyID,
        package_id: PackageID,
        version: Semver::Version,
        url: &[u8],
        task_context: TaskCallbackContext,
        patch_name_and_version_hash: Option<u64>,
    ) -> Result<(), EnqueuePackageForDownloadError> {
        enqueue_package_for_download(
            self,
            name,
            dependency_id,
            package_id,
            version,
            url,
            task_context,
            patch_name_and_version_hash,
        )
    }
}
