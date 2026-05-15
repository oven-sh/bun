use crate::lockfile::package::PackageColumns as _;
use bun_ptr::detach_lifetime;
use core::mem::ManuallyDrop;
use core::sync::atomic::Ordering;

use crate::bun_fs::FileSystem;
use bun_core::{Output, fmt as bun_fmt};
use bun_core::{StringOrTinyString, strings};
use bun_paths::{self as Path, PathBuffer};
use bun_semver::{self as Semver, String as SemverString};
use bun_sys::Fd;
use bun_threading::thread_pool as ThreadPool;

use crate::_folder_resolver::{
    self as FolderResolution, FolderResolution as FolderResolutionValue, GlobalOrRelative,
    PackageWorkspaceSearchPathFormatter,
};
use crate::dependency::{DependencyExt as _, TagExt as _, VersionExt as _};
use crate::lockfile::PackageIndexEntry;
use crate::lockfile::package::Package;
use crate::lockfile_real as Lockfile;
use crate::network_task::Authorization;
use crate::package_manager_real::{
    self, FailFn, PackageManager, SuccessFn, TaskCallbackList, determine_preinstall_state,
    generate_network_task_for_tarball, get_cache_directory, get_preinstall_state,
    get_temporary_directory, run_tasks, set_preinstall_state,
};
use crate::package_manager_task as Task;
use crate::patch_install::{Callback as PatchCallback, EnqueueAfterState};
use crate::repository_real::RepositoryExt as _;
use crate::resolution::{
    NpmVersionInfo as ResolutionNpmValue, Tag as ResolutionTag, TaggedValue as ResolutionTagged,
    Value as ResolutionValue,
};
use crate::{ManifestLoad, dependency};
use bun_install::NetworkTask;
use bun_install::{
    self as install, Behavior, Dependency, DependencyID, ExtractTarball, Features, Integrity, Npm,
    PackageID, PackageNameHash, PatchTask, Repository, Resolution, TaskCallbackContext,
    invalid_package_id,
};

// PORT NOTE: Zig accesses `PackageManager.verbose_install` (a `pub var`); the
// Rust port stores it as a process-global. The associated fn lives on the real
// `PackageManager` impl; pull it into scope as a free name so the comptime-ish
// `verbose_install()` call sites read the same.
#[inline]
fn verbose_install() -> bool {
    // SAFETY: set once during single-threaded CLI startup; only read here.
    PackageManager::verbose_install()
}

// PORT NOTE: `PatchTask.callback` discriminant — routed to the real
// `patch_install::Callback` enum (CalcHash / Apply).

// `SuccessFn` / `FailFn` are bare `fn(&mut PackageManager, ...)` pointers; the
// real bodies are inherent methods, so reference them via the type path.
#[allow(non_upper_case_globals)]
const assign_resolution: SuccessFn = PackageManager::assign_resolution;
#[allow(non_upper_case_globals)]
const assign_root_resolution: SuccessFn = PackageManager::assign_root_resolution;
#[allow(non_upper_case_globals)]
const fail_root_resolution: FailFn = PackageManager::fail_root_resolution;

// Zig: `const debug = PackageManager.debug;` — the `use package_manager_real::PackageManager`
// above already pulls the `declare_scope!`-generated `static PackageManager: ScopedLogger`
// (value namespace) alongside the struct (type namespace), so re-declaring it here
// would collide. `scoped_log!(PackageManager, ...)` below resolves to that import.

pub type EnqueuePackageForDownloadError = crate::network_task::ForTarballError;
pub type EnqueueTarballForDownloadError = crate::network_task::ForTarballError;

const MS_PER_S: f64 = bun_core::time::MS_PER_S as f64;

// ─────────────────────────────────────────────────────────────────────────────

pub fn enqueue_dependency_with_main(
    this: &mut PackageManager,
    id: DependencyID,
    // This must be a *const to prevent UB
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
            let mut dep = lockfile.buffers.dependencies[dep_i].clone();
            while !dep.behavior.is_peer() {
                if !dep.behavior.is_dev() {
                    if lockfile.buffers.dependencies[peer_i].name_hash == dep.name_hash {
                        lockfile.buffers.dependencies[peer_i] =
                            lockfile.buffers.dependencies[begin as usize].clone();
                        begin += 1;
                        break;
                    }
                }
                dep_i -= 1;
                dep = lockfile.buffers.dependencies[dep_i].clone();
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
        let dependency = this.lockfile.buffers.dependencies[i as usize].clone();
        let resolution = this.lockfile.buffers.resolutions[i as usize];
        if let Err(err) = enqueue_dependency_with_main(this, i, &dependency, resolution, false) {
            let path_sep = match dependency.version.tag {
                dependency::version::Tag::Folder => bun_fmt::PathSep::Auto,
                _ => bun_fmt::PathSep::Any,
            };
            // PORT NOTE: `format_args!` borrows temporaries — bind the
            // formatter first so it outlives the macro expansion.
            let realname = dependency.realname();
            let path_fmt = bun_fmt::fmt_path_u8(
                this.lockfile.str(&realname),
                bun_fmt::PathFormatOptions {
                    path_sep,
                    escape_backslashes: false,
                },
            );
            // TODO(port): logger note API — Zig passes (fmt, args) tuple separately
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
                    err,
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
        package,
        patch_name_and_version_hash,
        crate::network_task::Authorization::NoAuthorization,
    )? {
        // PORT NOTE: reshaped for borrowck — `task: &mut NetworkTask` borrows
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
    // PORT NOTE: reshaped for borrowck — `path` borrows
    // `this.lockfile.buffers.string_bytes`; detach the slice lifetime so the
    // `&mut PackageManager` reborrow for `enqueue_local_tarball` below does
    // not conflict (Zig passes the aliased `*PackageManager` freely).
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
    // PERF(port): was assume-capacity append via ArrayList — profile in Phase B

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
        *resolution,
        integrity,
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
    // PORT NOTE: reshaped for borrowck — `url`/`resolved` borrow
    // `this.lockfile.buffers.string_bytes`; detach the slice lifetimes so the
    // `&mut PackageManager` reborrows for the enqueue callees below do not
    // conflict (Zig passes the aliased `*PackageManager` freely).
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
            *resolution,
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

pub fn enqueue_parse_npm_package(
    this: &mut PackageManager,
    task_id: Task::Id,
    name: StringOrTinyString,
    network_task: *mut NetworkTask,
) -> *mut ThreadPool::Task {
    let task = this.preallocated_resolve_tasks.get();
    // SAFETY: task is a freshly acquired slot from the preallocated pool; we own the write.
    unsafe {
        task.write(Task::Task {
            package_manager: Some(bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<
                PackageManager,
            >(this))),
            log: bun_ast::Log::init(),
            tag: crate::package_manager_task::Tag::PackageManifest,
            request: crate::package_manager_task::Request {
                package_manifest: ManuallyDrop::new(
                    crate::package_manager_task::PackageManifestRequest {
                        // SAFETY: `network_task` is a freshly-vended pool slot; the
                        // `'static` reborrow matches the `Task<'static>` slot lifetime.
                        network: &mut *network_task,
                        name,
                    },
                ),
            },
            id: task_id,
            // TODO(port): `data: undefined` — Task::data left uninitialized in Zig
            ..Task::uninit()
        });
        &raw mut (*task).threadpool_task
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
    let package = *this.lockfile.packages.get(package_id as usize);

    if let Some(task) = run_tasks::generate_network_task_for_tarball(
        this,
        task_id,
        url,
        is_required,
        dependency_id,
        package,
        patch_name_and_version_hash,
        crate::network_task::Authorization::AllowAuthorization,
    )? {
        // PORT NOTE: reshaped for borrowck — see `enqueue_tarball_for_download`.
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
    Failure(bun_core::Error),
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
        if cfg!(debug_assertions) {
            debug_assert!(lf.dependencies.len() == lf.resolutions.len());
        }
        break 'brk index;
    } as DependencyID;

    if this.lockfile.buffers.resolutions[dep_id as usize] == invalid_package_id {
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

            // https://github.com/ziglang/zig/issues/19586 — Zig needed a workaround fn-returning-type;
            // in Rust we just declare the closure struct directly.
            struct Closure {
                err: Option<bun_core::Error>,
                // PORT NOTE: raw `*mut` (Zig `*PackageManager`) — `sleep_until`
                // also receives this pointer, so `&mut` here would alias.
                manager: *mut PackageManager,
            }
            impl Closure {
                fn is_done(&mut self) -> bool {
                    // SAFETY: `self.manager` is the raw provenance root set
                    // below; `sleep_until`/`tick_raw` hold no `&mut` across
                    // this callback, so this is the unique live borrow.
                    let manager = unsafe { &mut *self.manager };
                    if manager.pending_task_count() > 0 {
                        // Zig: `runTasks(void, {}, .{ .onExtract = {}, ... }, false, log_level)`
                        // — all callbacks `void`. `VoidRunTasksCallbacks` (below)
                        // mirrors that with `Ctx = ()` and every `HAS_* = false`.
                        let log_level = manager.options.log_level;
                        if let Err(err) = run_tasks::run_tasks::<VoidRunTasksCallbacks>(
                            manager,
                            &mut (),
                            false,
                            log_level,
                        ) {
                            self.err = Some(err);
                            return true;
                        }

                        if verbose_install() && manager.pending_task_count() > 0 {
                            if PackageManager::has_enough_time_passed_between_waiting_messages() {
                                Output::pretty_errorln(format_args!(
                                    "<d>[PackageManager]<r> waiting for {} tasks\n",
                                    manager.pending_task_count()
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

            let mgr: *mut PackageManager = this;
            let mut closure = Closure {
                err: None,
                manager: mgr,
            };
            // SAFETY: `mgr` derived from the live exclusive `this` borrow;
            // `sleep_until` + `tick_raw` hold no `&mut PackageManager` across
            // `Closure::is_done`, so the callback's `&mut *closure.manager`
            // is the unique live borrow.
            unsafe { PackageManager::sleep_until(mgr, &mut closure, Closure::is_done) };

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

/// Mirrors Zig's `runTasks(void, {}, .{ all-void callbacks }, ...)` shape used
/// by `enqueueDependencyToRoot` and `runAndWaitFn`: `Ctx = void`, every `on*`
/// is `{}` so the `HAS_*` const-gates compile out the callback paths.
pub struct VoidRunTasksCallbacks;
impl run_tasks::RunTasksCallbacks for VoidRunTasksCallbacks {
    type Ctx = ();
}

pub fn enqueue_network_task(this: &mut PackageManager, task: *mut NetworkTask) {
    if this.network_task_fifo.writable_length() == 0 {
        this.flush_network_queue();
    }

    // PERF(port): was writeItemAssumeCapacity — profile in Phase B
    this.network_task_fifo.write_item_assume_capacity(task);
}

pub fn enqueue_patch_task(this: &mut PackageManager, task: *mut PatchTask) {
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

    // PERF(port): was writeItemAssumeCapacity — profile in Phase B
    this.patch_task_fifo.write_item_assume_capacity(task);
}

/// We need to calculate all the patchfile hashes at the beginning so we don't run into problems with stale hashes
pub fn enqueue_patch_task_pre(this: &mut PackageManager, task: *mut PatchTask) {
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

    // PERF(port): was writeItemAssumeCapacity — profile in Phase B
    this.patch_task_fifo.write_item_assume_capacity(task);
    let _ = this.pending_pre_calc_hashes.fetch_add(1, Ordering::Relaxed);
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
    // PERF(port): was comptime monomorphization (successFn/failFn) — profile in Phase B
    success_fn: SuccessFn,
    fail_fn: Option<FailFn>,
    // Zig: `comptime if (successFn == assignRootResolution)`. The Zig check is a
    // compile-time identity comparison; in Rust the two `SuccessFn` candidates
    // (`assign_resolution` / `assign_root_resolution`) have byte-identical
    // bodies in release builds, so Apple ld64 (which ignores `.llvm_addrsig`)
    // folds them and a runtime fn-pointer address comparison is unsound. Thread
    // an explicit flag instead.
    is_root: bool,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
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

    let version: dependency::Version = 'version: {
        if dependency.version.tag == dependency::version::Tag::Npm {
            if let Some(aliased) = this.known_npm_aliases.get(&name_hash) {
                let group = &dependency.version.npm().version;
                let buf = this.lockfile.buffers.string_bytes.as_slice();
                // SAFETY: `aliased` is always tag == Npm (known_npm_aliases only stores npm versions).
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
            if let Some(new) = this.lockfile.overrides.get(name_hash) {
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
                    new.clone(),
                );

                if new.tag == dependency::version::Tag::Catalog {
                    if let Some(catalog_dep) =
                        this.lockfile
                            .catalogs
                            .get(&this.lockfile, *new.catalog(), name)
                    {
                        let v = catalog_dep.version.clone();
                        (name, name_hash) = update_name_and_name_hash_from_version_replacement(
                            &this.lockfile,
                            name,
                            name_hash,
                            v.clone(),
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
                    let v = catalog_dep.version.clone();
                    (name, name_hash) = update_name_and_name_hash_from_version_replacement(
                        &this.lockfile,
                        name,
                        name_hash,
                        v.clone(),
                    );

                    break 'version v;
                }
            }
        }

        // explicit copy here due to `dependency.version` becoming undefined
        // when `getOrPutResolvedPackageWithFindResult` is called and resizes the list.
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
                    version.clone(),
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
                                        this.log_mut()
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
                            } else if err == bun_core::err!("NoMatchingVersion") {
                                if dependency.behavior.is_required() {
                                    if let Some(fail) = fail_fn {
                                        fail(this, dependency, id, err);
                                    } else {
                                        bun_ast::add_error_pretty!(
                                            this.log_mut(),
                                            None,
                                            bun_ast::Loc::EMPTY,
                                            "No version matching \"{}\" found for specifier \"{}\"<r> <d>(but package exists)<r>",
                                            bstr::BStr::new(this.lockfile.str(&version.literal)),
                                            bstr::BStr::new(this.lockfile.str(&name)),
                                        );
                                    }
                                }
                                return Ok(());
                            } else if err == bun_core::err!("TooRecentVersion") {
                                if dependency.behavior.is_required() {
                                    if let Some(fail) = fail_fn {
                                        fail(this, dependency, id, err);
                                    } else {
                                        let age_gate_ms =
                                            this.options.minimum_release_age_ms.unwrap_or(0.0);
                                        if version.tag == dependency::version::Tag::DistTag {
                                            bun_ast::add_error_pretty!(
                                                this.log_mut(),
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
                                                this.log_mut(),
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
                            } else if err == bun_core::err!("MissingPackageJSON") {
                                if dependency.behavior.is_required() {
                                    if let Some(fail) = fail_fn {
                                        fail(this, dependency, id, err);
                                    } else if version.tag == dependency::version::Tag::Folder {
                                        this.log_mut()
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
                                        this.log_mut().add_error_fmt(
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

                                Output::pretty_errorln(format_args!(
                                    "   -> \"{}\": \"{}\" -> {}@{}",
                                    bstr::BStr::new(this.lockfile.str(&result.package.name)),
                                    bstr::BStr::new(label),
                                    bstr::BStr::new(this.lockfile.str(&result.package.name)),
                                    result.package.resolution.fmt(
                                        this.lockfile.buffers.string_bytes.as_slice(),
                                        bun_fmt::PathSep::Auto
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
                                    // SAFETY: `patch_task` is a non-null `heap::alloc`.
                                    let cb = unsafe { &(*patch_task).callback };
                                    if cb.is_calc_hash()
                                        && get_preinstall_state(this, result.package.meta.id)
                                            == install::PreinstallState::CalcPatchHash
                                    {
                                        set_preinstall_state(
                                            this,
                                            result.package.meta.id,
                                            install::PreinstallState::CalcingPatchHash,
                                        );
                                        enqueue_patch_task(this, patch_task);
                                    } else if cb.is_apply()
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
                        // PORT NOTE: reshaped for borrowck — `name_str` borrows
                        // `this.lockfile.buffers.string_bytes`. Route the whole
                        // branch through a raw root so the slice and the
                        // `&mut PackageManager` calls below can coexist (Zig
                        // passes the aliased `*PackageManager` freely).
                        // Snapshot the manifest disk-cache scalars while we
                        // still hold `&mut this` exclusively — taking it via
                        // `&mut *this_ptr` after `name_str`/`scope` exist
                        // would pop their borrow-stack tags under SB.
                        let cache_ctx = this.manifest_disk_cache_ctx();
                        let this_ptr: *mut PackageManager = this;
                        // SAFETY: `string_bytes` is not resized in the
                        // manifest-lookup path; every call below either copies
                        // `name_str` out or only reads it before any append.
                        // Detach the slice lifetime so the `&mut PackageManager`
                        // reborrows below do not conflict with it.
                        let name_str = this.lockfile.str_detached(&name);
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
                            if !this.has_created_network_task(
                                task_id,
                                dependency.behavior.is_required(),
                            ) {
                                let needs_extended_manifest =
                                    this.options.minimum_release_age_ms.is_some();
                                if this.options.enable.manifest_cache() {
                                    let mut expired = false;
                                    // SAFETY: `this_ptr` is the live exclusive
                                    // borrow's address; `options` is disjoint
                                    // from `manifests`.
                                    let scope: *const crate::npm::registry::Scope =
                                        unsafe { &(*this_ptr).options }
                                            .scope_for_package_name(name_str);
                                    // SAFETY: `manifests` projected from
                                    // `this_ptr`; `cache_ctx` was snapshotted
                                    // before `this_ptr` so the lookup holds
                                    // only this disjoint field borrow.
                                    if let Some(manifest) = unsafe {
                                        (*this_ptr).manifests.by_name_hash_allow_expired(
                                            cache_ctx,
                                            &*scope,
                                            name_hash,
                                            Some(&mut expired),
                                            ManifestLoad::LoadFromMemoryFallbackToDisk,
                                            needs_extended_manifest,
                                        )
                                    } {
                                        loaded_manifest = Some(manifest.clone());

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
                                                        let _ = this.log_mut().add_error_fmt(
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
                                                // PORT NOTE: reshaped for borrowck — `find_result`
                                                // borrows `loaded_manifest`; route the manifest
                                                // through a `BackRef` so the `&mut PackageManager`
                                                // call below doesn't conflict. `loaded_manifest`
                                                // is owned by this stack frame and not touched
                                                // until the call returns.
                                                let manifest_ref = bun_ptr::BackRef::new(
                                                    loaded_manifest.as_ref().unwrap(),
                                                );
                                                if let Some(new_resolve_result) =
                                                    get_or_put_resolved_package_with_find_result(
                                                        // SAFETY: see `this_ptr` note above.
                                                        unsafe { &mut *this_ptr },
                                                        name_hash,
                                                        name,
                                                        dependency,
                                                        version.clone(),
                                                        id,
                                                        dependency.behavior,
                                                        manifest_ref.get(),
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
                                        if this.options.enable.manifest_cache_control() && !expired
                                        {
                                            let _ = this.network_dedupe_map.remove(&task_id);
                                            continue 'retry_from_manifests_ptr;
                                        }
                                    }
                                }

                                if verbose_install() {
                                    Output::pretty_errorln(format_args!(
                                        "Enqueue package manifest for download: {}",
                                        bstr::BStr::new(name_str)
                                    ));
                                }

                                // `get_network_task` touches only the
                                // preallocated pool, not `string_bytes`; with
                                // `name_str` lifetime-detached above, `this`
                                // is free to reborrow `&mut`.
                                let network_task = this.get_network_task();
                                // SAFETY: `network_task` is the unique handle to a
                                // freshly-vended pool slot. Zig's `network_task.* = .{ ... }`
                                // resets every defaulted field; `write_init` mirrors that
                                // (callback is `= undefined` and overwritten by `for_manifest`).
                                unsafe {
                                    NetworkTask::write_init(network_task, task_id, this_ptr, None);
                                }

                                let scope = this.scope_for_package_name(name_str);
                                // SAFETY: network_task points to a valid initialized NetworkTask slot
                                unsafe {
                                    (*network_task).for_manifest(
                                        name_str,
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
            #[allow(unreachable_code)]
            return Ok(());
        }
        dependency::version::Tag::Git => {
            let dep: Repository = *version.git();
            let res = Resolution::init(ResolutionTagged::Git(dep));

            // First: see if we already loaded the git package in-memory
            if let Some(pkg_id) = this.lockfile.get_package_id(name_hash, None, &res) {
                success_fn(this, id, pkg_id);
                return Ok(());
            }

            // PORT NOTE: reshaped for borrowck — `alias`/`url` borrow
            // `this.lockfile.buffers.string_bytes`; detach the slice
            // lifetimes so the `&mut PackageManager` reborrows for the
            // enqueue callees below do not conflict.
            // SAFETY: `string_bytes` is not resized in this branch; the
            // enqueue callees copy the slices into the filename store.
            let alias = this.lockfile.str_detached(&dependency.name);
            let url = this.lockfile.str_detached(&dep.repo);
            let clone_id = Task::Id::for_git_clone(url);
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
                    bstr::BStr::new(url),
                );
            }

            if let Some(repo_fd) = this.git_repositories.get(&clone_id).copied() {
                let resolved = Repository::find_commit(
                    this.env_mut(),
                    this.log_mut(),
                    bun_sys::Dir::from_fd(repo_fd),
                    alias,
                    this.lockfile.str(&dep.committish),
                    clone_id,
                )?;
                let checkout_id = Task::Id::for_git_checkout(url, &resolved);

                let needs_ctx =
                    this.lockfile.buffers.resolutions[id as usize] == invalid_package_id;
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

                let task = enqueue_git_checkout(
                    this,
                    checkout_id,
                    repo_fd,
                    id,
                    alias,
                    res,
                    &resolved,
                    None,
                );
                this.task_batch.push(ThreadPool::Batch::from(task));
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

                let task =
                    enqueue_git_clone(this, clone_id, alias, &dep, id, dependency, &res, None);
                this.task_batch.push(ThreadPool::Batch::from(task));
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
            // url is Box<[u8]>; dropped at scope end (Zig had `defer allocator.free(url)`)
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

            let ctx = if is_root {
                TaskCallbackContext::RootDependency(id)
            } else {
                TaskCallbackContext::Dependency(id)
            };
            // PORT NOTE: reshaped for borrowck — `entry` mutably borrows
            // `this.task_queue`; scope it tightly so the calls below can
            // reborrow `*this`.
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

            if let Some(network_task) = run_tasks::generate_network_task_for_tarball(
                this,
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
                crate::network_task::Authorization::NoAuthorization,
            )? {
                // PORT NOTE: reshaped for borrowck — see `enqueue_tarball_for_download`.
                let nt: *mut NetworkTask = network_task;
                enqueue_network_task(this, nt);
            }
            Ok(())
        }
        dependency::version::Tag::Symlink | dependency::version::Tag::Workspace => {
            // PORT NOTE: Zig used `inline .symlink, .workspace => |dependency_tag|` to capture
            // the comptime tag; we check `version.tag` at runtime instead.
            let dependency_tag = version.tag;

            let _result = match get_or_put_resolved_package(
                this,
                name_hash,
                name,
                dependency,
                version.clone(),
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
                    if verbose_install() {
                        let label = this.lockfile.str(&version.literal);

                        Output::pretty_errorln(format_args!(
                            "   -> \"{}\": \"{}\" -> {}@{}",
                            bstr::BStr::new(this.lockfile.str(&result.package.name)),
                            bstr::BStr::new(label),
                            bstr::BStr::new(this.lockfile.str(&result.package.name)),
                            result.package.resolution.fmt(
                                this.lockfile.buffers.string_bytes.as_slice(),
                                bun_fmt::PathSep::Auto
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
                if dependency_tag == dependency::version::Tag::Workspace {
                    this.log_mut()
                    .add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                // TODO(port): WORKSPACE_NOT_FOUND_FMT with named args
                                "Workspace dependency \"{}\" not found\n\nSearched in <b>{}<r>\n\nWorkspace documentation: https://bun.com/docs/install/workspaces\n\n",
                                bstr::BStr::new(this.lockfile.str(&name)),
                                PackageWorkspaceSearchPathFormatter { manager: this, version, quoted: true },
                            ),
                        );
                } else {
                    this.log_mut()
                    .add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                // TODO(port): LINK_NOT_FOUND_FMT with named args
                                "Package \"{}\" is not linked\n\nTo install a linked package:\n   <cyan>bun link my-pkg-name-from-package-json<r>\n\nTip: the package name is from package.json, which can differ from the folder name.\n\n",
                                bstr::BStr::new(this.lockfile.str(&name)),
                            ),
                        );
                }
            } else if this.options.log_level.is_verbose() {
                if dependency_tag == dependency::version::Tag::Workspace {
                    this.log_mut()
                    .add_warning_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "Workspace dependency \"{}\" not found\n\nSearched in <b>{}<r>\n\nWorkspace documentation: https://bun.com/docs/install/workspaces\n\n",
                                bstr::BStr::new(this.lockfile.str(&name)),
                                PackageWorkspaceSearchPathFormatter { manager: this, version, quoted: true },
                            ),
                        );
                } else {
                    this.log_mut()
                    .add_warning_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "Package \"{}\" is not linked\n\nTo install a linked package:\n   <cyan>bun link my-pkg-name-from-package-json<r>\n\nTip: the package name is from package.json, which can differ from the folder name.\n\n",
                                bstr::BStr::new(this.lockfile.str(&name)),
                            ),
                        );
                }
            }
            let _ = (WORKSPACE_NOT_FOUND_FMT, LINK_NOT_FOUND_FMT);
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

            // PORT NOTE: reshaped for borrowck — `url` borrows `string_bytes`;
            // detach the slice lifetime so the `&mut PackageManager` reborrows
            // for the enqueue callees below do not conflict.
            // SAFETY: the enqueue callees copy `url` into the filename store
            // before any `string_bytes` resize.
            let url = unsafe {
                detach_lifetime(match &tarball.uri {
                    dependency::tarball::Uri::Local(path) => this.lockfile.str(path),
                    dependency::tarball::Uri::Remote(url) => this.lockfile.str(url),
                })
            };
            let task_id = Task::Id::for_tarball(url);

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

            let ctx = if is_root {
                TaskCallbackContext::RootDependency(id)
            } else {
                TaskCallbackContext::Dependency(id)
            };
            // PORT NOTE: reshaped for borrowck — scope `entry` tightly.
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

                    // SAFETY: `string_bytes` is not resized before
                    // `enqueue_local_tarball` copies `dep_name` into the
                    // filename store.
                    let dep_name = this.lockfile.str_detached(&dependency.name);
                    let task = enqueue_local_tarball(
                        this,
                        task_id,
                        id,
                        dep_name,
                        url,
                        res,
                        Integrity::default(),
                    );
                    this.task_batch.push(ThreadPool::Batch::from(task));
                }
                dependency::tarball::Uri::Remote(_) => {
                    // PORT NOTE: `generate_network_task_for_tarball` returns
                    // `&'a mut NetworkTask` tied to `this`; coerce to `*mut`
                    // immediately so the `&mut *this` borrow ends before
                    // `enqueue_network_task(this, …)` reborrows it (NLL).
                    let network_task: Option<*mut NetworkTask> =
                        run_tasks::generate_network_task_for_tarball(
                            this,
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
                            crate::network_task::Authorization::NoAuthorization,
                        )?
                        .map(|r| r as *mut NetworkTask);
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
    let task = this.preallocated_resolve_tasks.get();
    // SAFETY: task is a freshly acquired uninitialized slot from the preallocated
    // pool; we own the write. `ptr::write` (no drop of prior value) matches Zig's
    // `task.* = Task{...}` semantics on uninit memory.
    unsafe {
        task.write(Task::Task {
            package_manager: Some(bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<
                PackageManager,
            >(this))),
            log: bun_ast::Log::init(),
            tag: crate::package_manager_task::Tag::Extract,
            request: crate::package_manager_task::Request {
                extract: ManuallyDrop::new(crate::package_manager_task::ExtractRequest {
                    // SAFETY: `network_task` is a freshly-vended pool slot; the
                    // `'static` reborrow matches the `Task<'static>` slot lifetime.
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
            // TODO(port): `data: undefined`
            ..Task::uninit()
        });
        task
    }
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

fn enqueue_git_clone(
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
        apply_patch_task: if let Some(h) = patch_name_and_version_hash {
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
            let patch_hash = this
                .lockfile
                .patched_dependencies
                .get(&h)
                .unwrap()
                .patchfile_hash()
                .unwrap();
            let pt = PatchTask::new_apply_patch_hash(this, pkg_id, patch_hash, h);
            // SAFETY: `pt` is fresh from `heap::alloc`; reclaim ownership.
            let mut pt = unsafe { bun_core::heap::take(pt) };
            pt.callback.apply_mut().task_id = Some(task_id);
            Some(pt)
        } else {
            None
        },
        // TODO(port): `data: undefined`
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
    resolution: Resolution,
    resolved: &[u8],
    // if patched then we need to do apply step after network task is done
    patch_name_and_version_hash: Option<u64>,
) -> *mut ThreadPool::Task {
    let task = this.preallocated_resolve_tasks.get();
    // SAFETY: task is a freshly acquired uninitialized slot from the preallocated
    // pool; we own the write. `ptr::write` (no drop of prior value) matches Zig's
    // `task.* = Task{...}` semantics on uninit memory.
    unsafe {
        task.write(Task::Task {
            package_manager: Some(bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<
                PackageManager,
            >(this))),
            log: bun_ast::Log::init(),
            tag: crate::package_manager_task::Tag::GitCheckout,
            request: crate::package_manager_task::Request {
                git_checkout: ManuallyDrop::new(crate::package_manager_task::GitCheckoutRequest {
                    repo_dir: dir,
                    resolution,
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
            apply_patch_task: if let Some(h) = patch_name_and_version_hash {
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
                let patch_hash = this
                    .lockfile
                    .patched_dependencies
                    .get(&h)
                    .unwrap()
                    .patchfile_hash()
                    .unwrap();
                let pt = PatchTask::new_apply_patch_hash(this, pkg_id, patch_hash, h);
                // SAFETY: `pt` is fresh from `heap::alloc`; reclaim ownership.
                let mut pt = bun_core::heap::take(pt);
                pt.callback.apply_mut().task_id = Some(task_id);
                Some(pt)
            } else {
                None
            },
            id: task_id,
            // TODO(port): `data: undefined`
            ..Task::uninit()
        });
        &raw mut (*task).threadpool_task
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
                    resolution,
                    cache_dir: get_cache_directory(this),
                    temp_dir: get_temporary_directory(this).handle,
                    dependency_id,
                    integrity,
                    url: StringOrTinyString::init_append_if_needed(
                        path,
                        &mut crate::network_task::filename_store_appender(),
                    )
                    .expect("unreachable"),
                    skip_verify: false,
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
        // TODO(port): `data: undefined`
        ..Task::uninit()
    };
    let task = this.preallocated_resolve_tasks.get_init(value).as_ptr();
    // SAFETY: `get_init` just fully initialized the slot.
    unsafe { &raw mut (*task).threadpool_task }
}

fn update_name_and_name_hash_from_version_replacement(
    lockfile: &Lockfile::Lockfile,
    original_name: SemverString,
    original_name_hash: PackageNameHash,
    new_version: dependency::Version,
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

pub enum ResolvedPackageTask {
    /// Pending network task to schedule
    NetworkTask(*mut NetworkTask),

    /// Apply patch task or calc patch hash task
    PatchTask(*mut PatchTask),
}

pub struct ResolvedPackageResult {
    pub package: Package,

    /// Is this the first time we've seen this package?
    pub is_first_time: bool,

    pub task: Option<ResolvedPackageTask>,
}

impl Default for ResolvedPackageResult {
    fn default() -> Self {
        Self {
            package: Package::default(),
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
    version: dependency::Version,
    dependency_id: DependencyID,
    behavior: Behavior,
    manifest: &Npm::PackageManifest,
    find_result: Npm::FindResult,
    install_peer: bool,
    // PERF(port): was comptime monomorphization — profile in Phase B
    success_fn: SuccessFn,
) -> Result<Option<ResolvedPackageResult>, bun_core::Error> {
    // TODO(port): narrow error set
    // PORT NOTE: reshaped for borrowck — `is_root_dependency(&self, &mut PackageManager, …)`
    // borrows `this.lockfile` and `this` at once. Split via raw root.
    let should_update = {
        let this_ptr: *mut PackageManager = this;
        // SAFETY: `is_root_dependency` reads `manager.root_dependency_list` /
        // `manager.workspace_package_json_cache` only — disjoint from
        // `manager.lockfile`.
        this.to_update
            // If updating, only update packages in the current workspace
            && unsafe { &*(*this_ptr).lockfile }
                .is_root_dependency(unsafe { &mut *this_ptr }, dependency_id)
            // no need to do a look up if update requests are empty (`bun update` with no args)
            && (this.update_requests.is_empty()
                || this.updating_packages.contains(
                    dependency.name.slice(this.lockfile.buffers.string_bytes.as_slice()),
                ))
    };

    // Was this package already allocated? Let's reuse the existing one.
    //
    // PORT NOTE (determinism): Zig passes `version` here unconditionally, so a
    // peer like `>= 1.0.2` can collapse onto whichever sibling-appended entry
    // (e.g. `1.0.9`) happens to be highest in the index *at this instant* — a
    // network-order artefact that the `^1.0.2` peer-hoisting test already
    // todoIf's on macOS. The Rust port's floor guard in `get_package_id` was
    // meant to close that, but its exact-pinned/same-major exemptions reopen
    // it when *every* candidate is an exact-pinned same-major sibling
    // (`uses-a-dep-1..10`). For deferred peers, suppress the satisfies-
    // fallback so only an exact `eql(find_result)` can bind here; everything
    // else falls through to the `is_peer && !install_peer` defer below and is
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
            Some(version.clone())
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

    // appendPackage sets the PackageID on the package
    // PORT NOTE: reshaped for borrowck — `from_npm` takes both `&mut PackageManager`
    // and `&mut Lockfile`, which alias through `this.lockfile`. Split via raw root
    // (Zig passes both freely).
    let this_ptr: *mut PackageManager = this;
    // SAFETY: `from_npm` reads `pm` fields disjoint from `pm.lockfile` (options /
    // updating_packages); the raw split mirrors Zig's aliased `*PackageManager`.
    let package = unsafe { &mut *(*this_ptr).lockfile }.append_package(Package::from_npm(
        unsafe { &mut *this_ptr },
        unsafe { &mut *(*this_ptr).lockfile },
        this.log_mut(),
        manifest,
        find_result.version,
        find_result.package,
        Features::NPM,
    )?)?;

    if cfg!(debug_assertions) {
        debug_assert!(package.meta.id != invalid_package_id);
    }
    // Record exact-version pins so `Lockfile::get_package_id`'s
    // order-independence guard can tell them apart from range-resolved
    // entries (which it treats as network-order artefacts).
    if version.tag == dependency::version::Tag::Npm && version.npm().version.is_exact() {
        // SAFETY: `this_ptr` is the sole live `&mut PackageManager` here;
        // `lockfile.exact_pinned` is disjoint from `package` (returned
        // by-value above).
        unsafe { &mut *(*this_ptr).lockfile }.mark_exact_pin(package.meta.id);
    }
    // PORT NOTE: Zig used `defer successFn(...)`. Use scopeguard so success_fn runs on every
    // return below (including the `?` paths). The guard owns the raw pointer so the
    // `this` reborrow below doesn't conflict with the closure capture.
    let mut guard = scopeguard::guard((this_ptr, package.meta.id), |(this_ptr, pkg_id)| {
        // SAFETY: `this_ptr` came from the live exclusive `this` borrow; the
        // guard fires after all reborrows of `this` below have ended.
        success_fn(unsafe { &mut *this_ptr }, dependency_id, pkg_id);
    });
    // SAFETY: see above — sole live `&mut PackageManager` until scope exit.
    let this: &mut PackageManager = unsafe { &mut *guard.0 };
    // PORT NOTE: Zig `defer` (not errdefer) — scopeguard runs on ALL exits, never disarmed.

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
                        manifest.str(&find_result.package.tarball_url),
                        behavior.is_required(),
                        dependency_id,
                        package,
                        name_and_version_hash,
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
    // `guard` drops here → success_fn(this, dependency_id, package.meta.id)
}

fn get_or_put_resolved_package(
    this: &mut PackageManager,
    name_hash: PackageNameHash,
    name: SemverString,
    dependency: &Dependency,
    version: dependency::Version,
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
                PackageIndexEntry::Id(existing_id) => {
                    let existing_id = *existing_id;
                    if (existing_id as usize) < resolutions.len() {
                        let existing_resolution = resolutions[existing_id as usize];
                        if resolution_satisfies_dependency(this, existing_resolution, &version) {
                            success_fn(this, dependency_id, existing_id);
                            return Ok(Some(ResolvedPackageResult {
                                // we must fetch it from the packages array again, incase the package array mutates the value in the `successFn`
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
                            this.log_mut().add_warning_fmt(
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
                                // we must fetch it from the packages array again, incase the package array mutates the value in the `successFn`
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
                            if resolution_satisfies_dependency(this, existing_resolution, &version)
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
                            this.log_mut().add_warning_fmt(
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
                                // we must fetch it from the packages array again, incase the package array mutates the value in the `successFn`
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
                                && root_dep.version.tag == dependency::version::Tag::Workspace
                                && root_dep.name_hash == name_hash
                            {
                                // make sure verifyResolutions sees this resolution as a valid package id
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
                }
            }

            // Resolve the version from the loaded NPM manifest
            // PORT NOTE: reshaped for borrowck — `name_str`/`manifest` borrow
            // `*this`; route through a raw root so the `&mut PackageManager`
            // calls below can coexist (Zig passes the aliased `*PackageManager`).
            // Snapshot the disk-fallback scalars *before* establishing
            // `this_ptr`: `manifest_disk_cache_ctx` takes `&mut self`, and
            // materializing `&mut *this_ptr` after `name_str`/`scope` are
            // derived from it would pop their borrow-stack tags under SB.
            let cache_ctx = this.manifest_disk_cache_ctx();
            let needs_ext = this.options.minimum_release_age_ms.is_some();
            let this_ptr: *mut PackageManager = this;
            // SAFETY: `string_bytes` is not resized between here and the
            // `find_result` lookup; `manifest` lives in `this.manifests` and
            // is only read. Detach the slice lifetime so `name_str` does not
            // borrow `*this`.
            let name_str = this.lockfile.str_detached(&name);

            let scope = bun_ptr::BackRef::new(
                unsafe { &(*this_ptr).options }.scope_for_package_name(name_str),
            );
            // SAFETY: `manifests` projected from `this_ptr`; the lookup holds
            // only that disjoint field borrow alongside the shared `options`
            // / `lockfile` projections above. `scope` points into
            // `(*this_ptr).options`, disjoint from `manifests`.
            let Some(manifest) = (unsafe { &mut (*this_ptr).manifests }).by_name_hash(
                cache_ctx,
                scope.get(),
                name_hash,
                ManifestLoad::LoadFromMemoryFallbackToDisk,
                needs_ext,
            ) else {
                return Ok(None); // manifest might still be downloading. This feels unreliable.
            };
            let manifest: &Npm::PackageManifest = manifest;

            let version_result: Npm::FindVersionResult = match version.tag {
                // SAFETY: `version.tag` discriminates the union arm.
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
                                    // SAFETY: `version.tag == DistTag`.
                                    let tag_str = this.lockfile.str(&version.dist_tag().tag);
                                    Output::pretty_errorln(format_args!(
                                        "<d>[minimum-release-age]<r> <b>{}@{}<r> selected <green>{}<r> instead of <yellow>{}<r> due to {}-second filter",
                                        bstr::BStr::new(package_name),
                                        bstr::BStr::new(tag_str),
                                        result.version.fmt(manifest_buf),
                                        newest.fmt(manifest_buf),
                                        min_age_seconds,
                                    ));
                                }
                                dependency::version::Tag::Npm => {
                                    // SAFETY: `version.tag == Npm`.
                                    let version_str = &version.npm().version.fmt(manifest_buf);
                                    Output::pretty_errorln(format_args!(
                                        "<d>[minimum-release-age]<r> <b>{}<r>@{}<r> selected <green>{}<r> instead of <yellow>{}<r> due to {}-second filter",
                                        bstr::BStr::new(package_name),
                                        version_str,
                                        result.version.fmt(manifest_buf),
                                        newest.fmt(manifest_buf),
                                        min_age_seconds,
                                    ));
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
                        return Err(bun_core::err!("TooRecentVersion"));
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
                                            == dependency::version::Tag::Workspace
                                        && root_dep.name_hash == name_hash
                                    {
                                        // make sure verifyResolutions sees this resolution as a valid package id
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
                        }
                    }

                    if behavior.is_peer() {
                        return Ok(None);
                    }

                    return match version.tag {
                        dependency::version::Tag::Npm => Err(bun_core::err!("NoMatchingVersion")),
                        dependency::version::Tag::DistTag => Err(bun_core::err!("DistTagNotFound")),
                        _ => unreachable!(),
                    };
                }
            };

            // PORT NOTE: reshaped for borrowck — `manifest`/`find_result`
            // borrow `this.manifests`; detach via `BackRef` so the `&mut *this`
            // call can proceed (`this.manifests` is not mutated by the callee).
            let manifest_ref: bun_ptr::BackRef<Npm::PackageManifest> =
                bun_ptr::BackRef::new(manifest);
            get_or_put_resolved_package_with_find_result(
                // SAFETY: see `this_ptr` note above.
                unsafe { &mut *this_ptr },
                name_hash,
                name,
                dependency,
                version,
                dependency_id,
                behavior,
                manifest_ref.get(),
                find_result,
                install_peer,
                success_fn,
            )
        }

        dependency::version::Tag::Folder => {
            let folder = *version.folder();
            let res: FolderResolutionValue = 'res: {
                if this.lockfile.is_workspace_dependency(dependency_id) {
                    // relative to cwd
                    // PORT NOTE: reshaped for borrowck — `folder_path` borrows
                    // `string_bytes`; detach the slice lifetime so the
                    // `&mut PackageManager` reborrow for `get_or_put` below
                    // does not conflict.
                    // SAFETY: `get_or_put` copies `folder_path_abs` into the
                    // lockfile string buffer before any other mutation.
                    let folder_path = this.lockfile.str_detached(&folder);
                    let mut buf2 = PathBuffer::uninit();
                    let folder_path_abs = if bun_paths::is_absolute(folder_path) {
                        folder_path
                    } else {
                        Path::resolve_path::join_abs_string_buf::<Path::platform::Auto>(
                            FileSystem::instance().top_level_dir(),
                            &mut buf2,
                            &[folder_path],
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
                        GlobalOrRelative::Relative(dependency::version::Tag::Folder),
                        version,
                        folder_path_abs,
                        this,
                    );
                }

                // transitive folder dependencies do not have their dependencies resolved
                let mut package = Package::default();

                {
                    // only need name and path
                    // PORT NOTE: copy the two slices out of `string_bytes`
                    // before creating the builder — `StringBuilder::allocate`
                    // may grow the buffer and invalidate borrows into it, so
                    // owned copies are required regardless of borrowck.
                    let name_slice: Vec<u8> = this.lockfile.str(&name).to_vec();
                    let folder_path: Vec<u8> = this.lockfile.str(&folder).to_vec();
                    let mut builder = this.lockfile.string_builder();

                    builder.count(&name_slice);
                    builder.count(&folder_path);

                    builder.allocate().expect("OOM");

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
                package = this.lockfile.append_package(package).expect("OOM");

                break 'res FolderResolutionValue::NewPackageId(package.meta.id);
            };

            match res {
                FolderResolutionValue::Err(err) => Err(err),
                FolderResolutionValue::PackageId(package_id) => {
                    success_fn(this, dependency_id, package_id);
                    Ok(Some(ResolvedPackageResult {
                        package: *this.lockfile.packages.get(package_id as usize),
                        ..Default::default()
                    }))
                }
                FolderResolutionValue::NewPackageId(package_id) => {
                    success_fn(this, dependency_id, package_id);
                    Ok(Some(ResolvedPackageResult {
                        package: *this.lockfile.packages.get(package_id as usize),
                        is_first_time: true,
                        task: None,
                    }))
                }
            }
        }
        dependency::version::Tag::Workspace => {
            // package name hash should be used to find workspace path from map
            // SAFETY: `version.tag == Workspace` discriminates the union arm.
            let workspace_path_raw: SemverString = this
                .lockfile
                .workspace_paths
                .get(&name_hash)
                .copied()
                .unwrap_or(*version.workspace());
            // PORT NOTE: reshaped for borrowck — `workspace_path` may borrow
            // `string_bytes`; detach the slice lifetime so the
            // `&mut PackageManager` reborrow for `get_or_put` below does not
            // conflict.
            // SAFETY: `get_or_put` copies `workspace_path_u8` into the
            // lockfile string buffer before any other mutation.
            let workspace_path = this.lockfile.str_detached(&workspace_path_raw);
            let mut buf2 = PathBuffer::uninit();
            let workspace_path_u8 = if bun_paths::is_absolute(workspace_path) {
                workspace_path
            } else {
                Path::resolve_path::join_abs_string_buf::<Path::platform::Auto>(
                    FileSystem::instance().top_level_dir(),
                    &mut buf2,
                    &[workspace_path],
                )
            };

            let res = FolderResolution::get_or_put(
                GlobalOrRelative::Relative(dependency::version::Tag::Workspace),
                version,
                workspace_path_u8,
                this,
            );

            match res {
                FolderResolutionValue::Err(err) => Err(err),
                FolderResolutionValue::PackageId(package_id) => {
                    success_fn(this, dependency_id, package_id);
                    Ok(Some(ResolvedPackageResult {
                        package: *this.lockfile.packages.get(package_id as usize),
                        ..Default::default()
                    }))
                }
                FolderResolutionValue::NewPackageId(package_id) => {
                    success_fn(this, dependency_id, package_id);
                    Ok(Some(ResolvedPackageResult {
                        package: *this.lockfile.packages.get(package_id as usize),
                        is_first_time: true,
                        task: None,
                    }))
                }
            }
        }
        dependency::version::Tag::Symlink => {
            // PORT NOTE: reshaped for borrowck — `link_dir` / `symlink_path`
            // borrow into `*this`; detach their lifetimes so the
            // `&mut PackageManager` reborrow for `get_or_put` does not
            // conflict.
            // SAFETY: `global_link_dir_path` returns a slice into the lazily-
            // initialized `PackageManager.global_link_dir_path` (a `Box<[u8]>`
            // set once and never freed); `get_or_put` copies `symlink_path`
            // into the lockfile string buffer before any other mutation.
            // `version.tag == Symlink`.
            let link_dir =
                unsafe { detach_lifetime(package_manager_real::global_link_dir_path(this)) };
            let symlink_path = this.lockfile.str_detached(version.symlink());
            let res = FolderResolution::get_or_put(
                GlobalOrRelative::Global(link_dir),
                version.clone(),
                symlink_path,
                this,
            );

            match res {
                FolderResolutionValue::Err(err) => Err(err),
                FolderResolutionValue::PackageId(package_id) => {
                    success_fn(this, dependency_id, package_id);
                    Ok(Some(ResolvedPackageResult {
                        package: *this.lockfile.packages.get(package_id as usize),
                        ..Default::default()
                    }))
                }
                FolderResolutionValue::NewPackageId(package_id) => {
                    success_fn(this, dependency_id, package_id);
                    Ok(Some(ResolvedPackageResult {
                        package: *this.lockfile.packages.get(package_id as usize),
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
    dependency: &dependency::Version,
) -> bool {
    let buf = this.lockfile.buffers.string_bytes.as_slice();
    if resolution.tag == ResolutionTag::Npm && dependency.tag == dependency::version::Tag::Npm {
        return dependency
            .npm()
            .version
            .satisfies(resolution.npm().version, buf, buf);
    }

    if resolution.tag == ResolutionTag::Git && dependency.tag == dependency::version::Tag::Git {
        return resolution.git().eql(dependency.git(), buf, buf);
    }

    if resolution.tag == ResolutionTag::Github && dependency.tag == dependency::version::Tag::Github
    {
        return resolution.github().eql(dependency.github(), buf, buf);
    }

    false
}

// ──────────────────────────────────────────────────────────────────────────
// `impl PackageManager` — inherent-method facade over the free fns above.
//
// Zig mounts this file via `usingnamespace`, so `pkg_manager.enqueueX(...)`
// resolves to these free fns by first-arg-is-`*Self` UFCS. Rust has no
// `usingnamespace`; sibling files (PackageManagerLifecycle, …Directories,
// runTasks) all expose an `impl PackageManager` block instead. Match that
// pattern here so cross-file callers can keep the `.method()` shape.
// ──────────────────────────────────────────────────────────────────────────

impl PackageManager {
    #[inline]
    pub fn enqueue_dependency_with_main(
        &mut self,
        id: DependencyID,
        dependency: &Dependency,
        resolution: PackageID,
        install_peer: bool,
    ) -> Result<(), bun_core::Error> {
        enqueue_dependency_with_main(self, id, dependency, resolution, install_peer)
    }

    #[inline]
    pub fn enqueue_dependency_with_main_and_success_fn(
        &mut self,
        id: DependencyID,
        dependency: &Dependency,
        resolution: PackageID,
        install_peer: bool,
        success_fn: SuccessFn,
        fail_fn: Option<FailFn>,
        is_root: bool,
    ) -> Result<(), bun_core::Error> {
        enqueue_dependency_with_main_and_success_fn(
            self,
            id,
            dependency,
            resolution,
            install_peer,
            success_fn,
            fail_fn,
            is_root,
        )
    }

    #[inline]
    pub fn enqueue_dependency_list(&mut self, dependencies_list: Lockfile::DependencySlice) {
        enqueue_dependency_list(self, dependencies_list)
    }

    #[inline]
    pub fn enqueue_tarball_for_download(
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
    pub fn enqueue_tarball_for_reading(
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
    pub fn enqueue_git_for_checkout(
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
    pub fn enqueue_package_for_download(
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

    #[inline]
    pub fn enqueue_dependency_to_root(
        &mut self,
        name: &[u8],
        version: &dependency::Version,
        version_buf: &[u8],
        behavior: Behavior,
    ) -> DependencyToEnqueue {
        enqueue_dependency_to_root(self, name, version, version_buf, behavior)
    }

    #[inline]
    pub fn enqueue_network_task(&mut self, task: *mut NetworkTask) {
        enqueue_network_task(self, task)
    }

    #[inline]
    pub fn enqueue_patch_task(&mut self, task: *mut PatchTask) {
        enqueue_patch_task(self, task)
    }

    #[inline]
    pub fn enqueue_patch_task_pre(&mut self, task: *mut PatchTask) {
        enqueue_patch_task_pre(self, task)
    }

    #[inline]
    pub fn enqueue_parse_npm_package(
        &mut self,
        task_id: Task::Id,
        name: StringOrTinyString,
        network_task: *mut NetworkTask,
    ) -> *mut ThreadPool::Task {
        enqueue_parse_npm_package(self, task_id, name, network_task)
    }

    #[inline]
    pub fn enqueue_extract_npm_package(
        &mut self,
        tarball: &ExtractTarball,
        network_task: *mut NetworkTask,
    ) -> *mut ThreadPool::Task {
        enqueue_extract_npm_package(self, tarball, network_task)
    }

    #[inline]
    pub fn create_extract_task_for_streaming(
        &mut self,
        tarball: &ExtractTarball,
        network_task: *mut NetworkTask,
    ) -> *mut Task::Task<'static> {
        create_extract_task_for_streaming(self, tarball, network_task)
    }

    #[inline]
    pub fn enqueue_git_checkout(
        &mut self,
        task_id: Task::Id,
        dir: Fd,
        dependency_id: DependencyID,
        name: &[u8],
        resolution: Resolution,
        resolved: &[u8],
        patch_name_and_version_hash: Option<u64>,
    ) -> *mut ThreadPool::Task {
        enqueue_git_checkout(
            self,
            task_id,
            dir,
            dependency_id,
            name,
            resolution,
            resolved,
            patch_name_and_version_hash,
        )
    }
}

// ported from: src/install/PackageManager/PackageManagerEnqueue.zig
