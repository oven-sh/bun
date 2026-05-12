use crate::lockfile::package::PackageColumns as _;
use bun_collections::HashMap;
use bun_core::Output;

use crate::Dependency;
use crate::DependencyID;
use crate::ManifestLoad;
use crate::NetworkTask;
use crate::PackageID;
use crate::Resolution;
use crate::dependency::Behavior;
use crate::invalid_package_id;
// `Task::Id` is a namespaced type in Zig (`PackageManagerTask.Id`); import the
// *module* under the `Task` name so `Task::Id` resolves as a path (matches
// `runTasks.rs` / `PackageManagerEnqueue.rs`).
use super::PackageManager;
use super::enqueue;
use super::package_manager_options as Options;
use super::run_tasks::{self, RunTasksCallbacks};
use crate::package_manager_task as Task;
use crate::resolution::Tag as ResolutionTag;

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum StartManifestTaskError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("InvalidURL")]
    InvalidURL,
}
bun_core::oom_from_alloc!(StartManifestTaskError);
impl From<crate::network_task::ForManifestError> for StartManifestTaskError {
    fn from(e: crate::network_task::ForManifestError) -> Self {
        match e {
            crate::network_task::ForManifestError::OutOfMemory => Self::OutOfMemory,
            crate::network_task::ForManifestError::InvalidURL => Self::InvalidURL,
        }
    }
}
impl From<StartManifestTaskError> for bun_core::Error {
    fn from(e: StartManifestTaskError) -> Self {
        match e {
            StartManifestTaskError::OutOfMemory => bun_core::err!(OutOfMemory),
            StartManifestTaskError::InvalidURL => bun_core::err!(InvalidURL),
        }
    }
}

fn start_manifest_task(
    manager: &mut PackageManager,
    pkg_name: &[u8],
    dep: &Dependency,
    needs_extended_manifest: bool,
) -> Result<(), StartManifestTaskError> {
    let task_id = Task::Id::for_manifest(pkg_name);
    // PORT NOTE: Zig passes the *raw packed-struct bit* `dep.behavior.optional`
    // — not `Behavior.isOptional()` (which is `optional && !peer`). For
    // optional-peer deps the raw bit is `true` but `is_optional()` is `false`,
    // which would flip both the dedupe-map `is_required` bookkeeping and
    // `for_manifest`'s error-suppression branch. Mirror runTasks.rs and read
    // the raw flag.
    let is_optional = dep.behavior.contains(Behavior::OPTIONAL);
    if run_tasks::has_created_network_task(manager, task_id, is_optional) {
        return Ok(());
    }
    manager.start_progress_bar_if_none();

    // PORT NOTE: reshaped for borrowck — Zig writes the whole struct via `.* = .{}`
    // and reads `manager` again for `scopeForPackageName`. `get_network_task()`
    // borrows `&mut manager.preallocated_network_tasks`, so compute everything
    // that needs `&manager` *before* taking that borrow, then populate the pool
    // slot through a raw pointer (matches `runTasks::generate_network_task_for_tarball`).
    let scope = bun_ptr::BackRef::new(manager.scope_for_package_name(pkg_name));
    // Backref address only — stored, not dereffed in this function.
    // TODO(port): lifetime — BACKREF.
    let manager_backref: *mut PackageManager = manager;

    // Take the pool slot as a raw pointer so borrowck releases `manager` for the
    // `enqueue_network_task` tail.
    let net_ptr: *mut NetworkTask = run_tasks::get_network_task(manager);
    // Zig: `task.* = .{ .package_manager = manager, .callback = undefined,
    //                   .task_id = task_id, .allocator = manager.allocator };`
    // — full struct overwrite that resets every other field to its struct
    // default. The slot may be uninitialized (heap fallback) or stale (reused
    // hive slot).
    // SAFETY: `net_ptr` is the unique handle to a freshly-vended pool slot; no
    // other alias exists until we hand it to `enqueue_network_task`.
    unsafe { NetworkTask::write_init(net_ptr, task_id, manager_backref, None) };
    // SAFETY: `write_init` populated every field with a drop-safe value;
    // `unsafe_http_client` is `MaybeUninit` and overwritten by `for_manifest`.
    let task = unsafe { &mut *net_ptr };
    // `scope` points into `manager.options` which is not mutated by
    // `for_manifest` (it only writes the pool slot and `manager.log`).
    task.for_manifest(
        pkg_name,
        scope.get(),
        None,
        is_optional,
        needs_extended_manifest,
    )?;

    enqueue::enqueue_network_task(manager, net_ptr);
    Ok(())
}

pub enum Packages<'a> {
    All,
    Ids(&'a [PackageID]),
}

/// `RunTasksCallbacks` impl for the void-callback `runTasks` call in
/// `populateManifestCache` (Zig passed an anonymous struct with `void` hooks).
struct ManifestsOnlyCallbacks;
impl RunTasksCallbacks for ManifestsOnlyCallbacks {
    type Ctx = ();
    const PROGRESS_BAR: bool = true;
    const MANIFESTS_ONLY: bool = true;
}

/// Populate the manifest cache for packages included from `root_pkg_ids`. Only manifests of
/// direct dependencies of the `root_pkg_ids` are populated. If `root_pkg_ids` has length 0
/// all packages in the lockfile will have their manifests fetched if necessary.
pub fn populate_manifest_cache(
    manager: &mut PackageManager,
    packages: Packages<'_>,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let log_level = manager.options.log_level;

    // PORT NOTE: heavy borrowck overlap — Zig holds slices into
    // `manager.lockfile` while the loop body calls `&mut`-taking methods on
    // `manager`. The lockfile lives in `Box<Lockfile>` (stable address) and is
    // not resized by anything below, so derive the slices through a raw
    // provenance root and reborrow `manager` per-call.
    let cache_ctx = manager.manifest_disk_cache_ctx();
    let manager_ptr: *mut PackageManager = manager;
    // BACKREF wrapper over the same provenance root for the read-only
    // `options` projections in the loop body — collapses four per-site raw
    // `(*manager_ptr).options` derefs into safe `Deref` through
    // `ParentRef::get()`. Mutation (`manifests`, whole-`&mut PackageManager`)
    // still goes through `manager_ptr` directly. Safe `From<NonNull>`
    // construction — `manager_ptr` was just derived from `&mut *manager`.
    let mgr_ref = bun_ptr::ParentRef::<PackageManager>::from(
        core::ptr::NonNull::new(manager_ptr).expect("derived from &mut, non-null"),
    );
    // SAFETY: `manager_ptr` is the live exclusive borrow's address; we only
    // take *shared* projections of `lockfile` here, and the loop body never
    // mutates `lockfile.buffers` / `lockfile.packages`.
    let lockfile = unsafe { &*core::ptr::addr_of!((*manager_ptr).lockfile) };
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let pkgs = lockfile.packages.slice();
    let pkg_resolutions = pkgs.items_resolution();
    let pkg_names = pkgs.items_name();
    let pkg_dependencies = pkgs.items_dependencies();

    match packages {
        Packages::All => {
            let mut seen_pkg_ids: HashMap<PackageID, ()> = HashMap::new();

            for (_dep_id, dep) in dependencies.iter().enumerate() {
                let dep_id: DependencyID = DependencyID::try_from(_dep_id).expect("int cast");

                let pkg_id = resolutions[dep_id as usize];
                if pkg_id == invalid_package_id {
                    continue;
                }

                // `getOrPut(pkg_id).found_existing` — value is `void`, so this is a set insert.
                if seen_pkg_ids.insert(pkg_id, ()).is_some() {
                    continue;
                }

                let res = &pkg_resolutions[pkg_id as usize];
                if res.tag != ResolutionTag::Npm {
                    continue;
                }

                let pkg_name = pkg_names[pkg_id as usize];
                let pkg_name_slice = pkg_name.slice(string_buf);
                // `options` is not mutated between here and the
                // `start_manifest_task` call — read via the BACKREF `mgr_ref`.
                let needs_extended_manifest = mgr_ref.options.minimum_release_age_ms.is_some();

                // `scope_for_package_name` borrows only `options` (via the
                // BACKREF `mgr_ref`); `manifests` is a disjoint field projected
                // from the same raw provenance root. `by_name`'s `pm`-derived
                // reads are hoisted into the by-value `cache_ctx`, so the call
                // holds only `&mut manifests`.
                let scope =
                    bun_ptr::BackRef::new(mgr_ref.options.scope_for_package_name(pkg_name_slice));
                // SAFETY: `manifests` is disjoint from `options`/`lockfile`;
                // `manager_ptr` is the SRW root.
                let cached = unsafe { &mut (*manager_ptr).manifests }.by_name(
                    cache_ctx,
                    scope.get(),
                    pkg_name_slice,
                    ManifestLoad::LoadFromMemoryFallbackToDisk,
                    needs_extended_manifest,
                );
                if cached.is_none() {
                    start_manifest_task(
                        unsafe { &mut *manager_ptr },
                        pkg_name_slice,
                        dep,
                        needs_extended_manifest,
                    )?;
                }

                run_tasks::flush_network_queue(unsafe { &mut *manager_ptr });
                let _ = run_tasks::schedule_tasks(unsafe { &mut *manager_ptr });
            }
        }
        Packages::Ids(ids) => {
            for &root_pkg_id in ids {
                let pkg_deps = pkg_dependencies[root_pkg_id as usize];
                for dep_id in pkg_deps.begin()..pkg_deps.end() {
                    let dep_id = dep_id as usize;
                    if dep_id >= dependencies.len() {
                        continue;
                    }
                    let pkg_id = resolutions[dep_id];
                    if pkg_id == invalid_package_id {
                        continue;
                    }
                    let dep = &dependencies[dep_id];

                    let resolution: &Resolution = &pkg_resolutions[pkg_id as usize];
                    if resolution.tag != ResolutionTag::Npm {
                        continue;
                    }

                    // `options` read via BACKREF `mgr_ref` — see provenance-root
                    // note above.
                    let needs_extended_manifest = mgr_ref.options.minimum_release_age_ms.is_some();
                    let package_name = pkg_names[pkg_id as usize].slice(string_buf);
                    // See disjoint-field note on the `.All` arm above.
                    let scope =
                        bun_ptr::BackRef::new(mgr_ref.options.scope_for_package_name(package_name));
                    // SAFETY: `manifests` is disjoint from `options`/`lockfile`;
                    // `manager_ptr` is the SRW root.
                    let cached = unsafe { &mut (*manager_ptr).manifests }.by_name(
                        cache_ctx,
                        scope.get(),
                        package_name,
                        ManifestLoad::LoadFromMemoryFallbackToDisk,
                        needs_extended_manifest,
                    );
                    if cached.is_none() {
                        start_manifest_task(
                            unsafe { &mut *manager_ptr },
                            package_name,
                            dep,
                            needs_extended_manifest,
                        )?;

                        run_tasks::flush_network_queue(unsafe { &mut *manager_ptr });
                        let _ = run_tasks::schedule_tasks(unsafe { &mut *manager_ptr });
                    }
                }
            }
        }
    }

    // SAFETY: provenance root; no live shared borrows of `*manager_ptr` remain.
    let manager = unsafe { &mut *manager_ptr };
    run_tasks::flush_network_queue(manager);
    let _ = run_tasks::schedule_tasks(manager);

    if run_tasks::pending_task_count(manager) > 0 {
        struct RunClosure {
            // PORT NOTE: Zig stores `*PackageManager` non-exclusively;
            // `sleep_until` also receives this raw pointer, so storing
            // `&mut PackageManager` here would alias under Stacked Borrows.
            manager: *mut PackageManager,
            err: Option<bun_core::Error>,
        }
        impl RunClosure {
            pub fn is_done(closure: &mut Self) -> bool {
                // SAFETY: `closure.manager` is the raw provenance root set
                // below; `sleep_until`/`tick_raw` hold no `&mut` across this
                // callback, so this is the unique live borrow.
                let manager = unsafe { &mut *closure.manager };
                let log_level = manager.options.log_level;
                // PORT NOTE: void RunTasksCallbacks — `extract_ctx` is unit. Do NOT pass
                // `manager` as both receiver and ctx (aliased &mut). Zig passed
                // `(comptime *PackageManager, closure.manager)`; the generic context
                // pair collapses to `&mut ()` in Rust.
                if let Err(err) = run_tasks::run_tasks::<ManifestsOnlyCallbacks>(
                    manager,
                    &mut (),
                    true,
                    log_level,
                ) {
                    closure.err = Some(err);
                    return true;
                }

                run_tasks::pending_task_count(manager) == 0
            }
        }

        // Derive the raw provenance root first so both `sleep_until` and the
        // closure body's `&mut *run_closure.manager` share the same SRW tag.
        let mgr: *mut PackageManager = manager;
        let mut run_closure = RunClosure {
            manager: mgr,
            err: None,
        };
        // SAFETY: `mgr` is derived from the live exclusive `manager` borrow;
        // `sleep_until` is an associated fn taking `*mut PackageManager` and
        // `tick_raw` holds no `&mut event_loop` across `is_done`, so the
        // callback's `&mut *run_closure.manager` is the unique live borrow.
        unsafe { PackageManager::sleep_until(mgr, &mut run_closure, RunClosure::is_done) };

        if log_level.show_progress() {
            // SAFETY: `mgr` is still the live provenance root; `sleep_until`
            // has returned so no competing borrow exists.
            unsafe { (*mgr).end_progress_bar() };
            Output::flush();
        }

        if let Some(err) = run_closure.err {
            return Err(err);
        }
    }

    Ok(())
}

#[allow(unused_imports)]
use Options::LogLevel;

// ported from: src/install/PackageManager/PopulateManifestCache.zig
