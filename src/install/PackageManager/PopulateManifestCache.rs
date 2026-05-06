use bun_collections::HashMap;
use bun_core::Output;

use crate::Dependency;
use crate::DependencyID;
use crate::PackageID;
use crate::PackageManager;
use crate::Resolution;
use crate::Task;
use crate::invalid_package_id;

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum StartManifestTaskError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("InvalidURL")]
    InvalidURL,
}
impl From<bun_alloc::AllocError> for StartManifestTaskError {
    fn from(_: bun_alloc::AllocError) -> Self {
        Self::OutOfMemory
    }
}
// `Into<bun_core::Error>` is auto-derived for thiserror enums (see PORTING.md type map).

fn start_manifest_task(
    manager: &mut PackageManager,
    pkg_name: &[u8],
    dep: &Dependency,
    needs_extended_manifest: bool,
) -> Result<(), StartManifestTaskError> {
    let task_id = Task::Id::for_manifest(pkg_name);
    if manager.has_created_network_task(task_id, dep.behavior.optional) {
        return Ok(());
    }
    manager.start_progress_bar_if_none();
    // PORT NOTE: reshaped for borrowck — compute scope before borrowing the pooled task slot.
    let scope = manager.scope_for_package_name(pkg_name);
    let task = manager.get_network_task();
    // TODO(port): in-place init of pooled NetworkTask slot; `package_manager` is a backref (raw ptr),
    // `callback` was `undefined` in Zig (overwritten by `for_manifest` below).
    *task = crate::NetworkTask {
        package_manager: manager as *mut PackageManager,
        callback: Default::default(), // TODO(port): Zig had `undefined`
        task_id,
        ..Default::default()
    };
    task.for_manifest(pkg_name, scope, None, dep.behavior.optional, needs_extended_manifest)?;
    // PORT NOTE: reshaped for borrowck — `task` is a raw slot in `manager`'s pool; re-borrow `manager` here.
    manager.enqueue_network_task(task);
    Ok(())
}

pub enum Packages<'a> {
    All,
    Ids(&'a [PackageID]),
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
    // PORT NOTE: reshaped for borrowck — these lockfile slices alias `*manager`; Phase B may need
    // to re-derive them per use-site or hold raw pointers, since the loop bodies call &mut methods
    // on `manager`.
    let lockfile = &manager.lockfile;
    let resolutions = lockfile.buffers.resolutions.items();
    let dependencies = lockfile.buffers.dependencies.items();
    let string_buf = lockfile.buffers.string_bytes.items();
    let pkgs = lockfile.packages.slice();
    let pkg_resolutions = pkgs.items_resolution();
    let pkg_names = pkgs.items_name();
    let pkg_dependencies = pkgs.items_dependencies();

    match packages {
        Packages::All => {
            let mut seen_pkg_ids: HashMap<PackageID, ()> = HashMap::new();

            for (_dep_id, dep) in dependencies.iter().enumerate() {
                let dep_id: DependencyID = DependencyID::try_from(_dep_id).unwrap();

                let pkg_id = resolutions[dep_id as usize];
                if pkg_id == invalid_package_id {
                    continue;
                }

                // `getOrPut(pkg_id).found_existing` — value is `void`, so this is a set insert.
                if seen_pkg_ids.insert(pkg_id, ()).is_some() {
                    continue;
                }

                let res = &pkg_resolutions[pkg_id as usize];
                if res.tag != Resolution::Tag::Npm {
                    continue;
                }

                let pkg_name = pkg_names[pkg_id as usize];
                let needs_extended_manifest = manager.options.minimum_release_age_ms.is_some();

                if manager
                    .manifests
                    .by_name(
                        manager,
                        manager.scope_for_package_name(pkg_name.slice(string_buf)),
                        pkg_name.slice(string_buf),
                        ManifestLoad::LoadFromMemoryFallbackToDisk,
                        needs_extended_manifest,
                    )
                    .is_none()
                {
                    start_manifest_task(
                        manager,
                        pkg_name.slice(string_buf),
                        dep,
                        needs_extended_manifest,
                    )?;
                }

                manager.flush_network_queue();
                let _ = manager.schedule_tasks();
            }
        }
        Packages::Ids(ids) => {
            for &root_pkg_id in ids {
                let pkg_deps = pkg_dependencies[root_pkg_id as usize];
                for dep_id in pkg_deps.begin()..pkg_deps.end() {
                    if dep_id >= dependencies.len() {
                        continue;
                    }
                    let pkg_id = resolutions[dep_id];
                    if pkg_id == invalid_package_id {
                        continue;
                    }
                    let dep = &dependencies[dep_id];

                    let resolution: &Resolution = &pkg_resolutions[pkg_id as usize];
                    if resolution.tag != Resolution::Tag::Npm {
                        continue;
                    }

                    let needs_extended_manifest = manager.options.minimum_release_age_ms.is_some();
                    let package_name = pkg_names[pkg_id as usize].slice(string_buf);
                    if manager
                        .manifests
                        .by_name(
                            manager,
                            manager.scope_for_package_name(package_name),
                            package_name,
                            ManifestLoad::LoadFromMemoryFallbackToDisk,
                            needs_extended_manifest,
                        )
                        .is_none()
                    {
                        start_manifest_task(manager, package_name, dep, needs_extended_manifest)?;

                        manager.flush_network_queue();
                        let _ = manager.schedule_tasks();
                    }
                }
            }
        }
    }

    manager.flush_network_queue();
    let _ = manager.schedule_tasks();

    if manager.pending_task_count() > 0 {
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
                // PORT NOTE: void RunTasksCallbacks — `extract_ctx` is unit. Do NOT pass `manager`
                // as both receiver and ctx (aliased &mut). Zig passed `(comptime *PackageManager,
                // closure.manager)`; the generic context pair collapses to `&mut ()` in Rust.
                if let Err(err) = manager.run_tasks(
                    &mut (),
                    PackageManager::RunTasksCallbacks {
                        on_extract: (),
                        on_resolve: (),
                        on_package_manifest_error: (),
                        on_package_download_error: (),
                        progress_bar: true,
                        manifests_only: true,
                    },
                    true,
                    log_level,
                ) {
                    closure.err = Some(err);
                    return true;
                }

                manager.pending_task_count() == 0
            }
        }

        // Derive the raw provenance root first so both `sleep_until` and the
        // closure body's `&mut *run_closure.manager` share the same SRW tag.
        let mgr: *mut PackageManager = manager;
        let mut run_closure = RunClosure { manager: mgr, err: None };
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

// `.load_from_memory_fallback_to_disk` enum literal — `PackageManifestMap.When` in Zig,
// re-exported at the crate root as `ManifestLoad`.
use crate::ManifestLoad;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/PopulateManifestCache.zig (163 lines)
//   confidence: medium
//   todos:      6
//   notes:      heavy borrowck overlap (manager ↔ lockfile slices, sleep_until self-borrow); NetworkTask in-place init and run_tasks callback struct shape guessed
// ──────────────────────────────────────────────────────────────────────────
