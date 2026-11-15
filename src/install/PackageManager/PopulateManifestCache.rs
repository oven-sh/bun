use crate::lockfile::package::PackageColumns as _;
use bun_collections::HashMap;
use bun_core::Output;

use crate::DependencyID;
use crate::NetworkTask;
use crate::PackageID;
use crate::Resolution;
use crate::invalid_package_id;
// Import the
// *module* under the `Task` name so `Task::Id` resolves as a path (matches
// `runTasks.rs` / `PackageManagerEnqueue.rs`).
use super::enqueue;
use super::run_tasks::{self, Caller};
use super::{InstallFields, PackageManager, install_fields};
use crate::package_manager_task as Task;
use crate::resolution::Tag as ResolutionTag;

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub(crate) enum StartManifestTaskError {
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
impl From<StartManifestTaskError> for crate::Error {
    fn from(e: StartManifestTaskError) -> Self {
        match e {
            StartManifestTaskError::OutOfMemory => crate::Error::Alloc(bun_alloc::AllocError),
            StartManifestTaskError::InvalidURL => crate::Error::InvalidURL,
        }
    }
}

/// `is_required`: a failed fetch is logged as an error rather than a warning.
fn start_manifest_task(
    manager: &mut InstallFields<'_>,
    pkg_name: &[u8],
    is_required: bool,
    needs_extended_manifest: bool,
) -> Result<(), StartManifestTaskError> {
    // best-effort metadata backfill: nothing to do without the network
    if manager.options.offline == crate::package_manager_real::options::OfflineMode::Offline {
        return Ok(());
    }
    let task_id = Task::Id::for_manifest(pkg_name);
    if manager.state.has_created_network_task(task_id, is_required) {
        return Ok(());
    }
    if manager.options.log_level.show_progress() {
        manager.state.start_progress_bar_if_none();
    }

    let log = manager.state.log();
    let task = NetworkTask::for_manifest(
        manager,
        log,
        task_id,
        pkg_name,
        None,
        !is_required,
        needs_extended_manifest,
    )?;
    enqueue::enqueue_network_task(manager.state, task);
    Ok(())
}

#[derive(Clone, Copy)]
pub enum Packages<'a> {
    /// Every npm package in the lockfile; best-effort (the post-migration backfill), so failures are warnings.
    All,
    /// The direct dependencies of these workspace packages; a required one failing is an error, see [`print_fetch_failures`].
    Ids(&'a [PackageID]),
    /// The manifests of these packages themselves (by name), not of their dependencies; best-effort, so failures are warnings.
    Exact(&'a [PackageID]),
}

/// Populate the manifest cache for packages included from `root_pkg_ids`. Only manifests of
/// direct dependencies of the `root_pkg_ids` are populated. If `root_pkg_ids` has length 0
/// all packages in the lockfile will have their manifests fetched if necessary.
/// A dependency that is queued before or during the call resolves inside it.
pub fn populate_manifest_cache(
    manager: &mut PackageManager,
    packages: Packages<'_>,
) -> crate::Result<()> {
    let log_level = manager.options.log_level;

    let cache_ctx = manager.manifest_disk_cache_ctx();
    let manifests = &mut manager.manifests;
    let fields = &mut install_fields!(manager);
    let (options, lockfile) = (fields.options, fields.lockfile);
    let needs_extended_manifest = options.minimum_release_age_ms.is_some();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let pkgs = &lockfile.packages;
    let pkg_resolutions = pkgs.items_resolution();
    let pkg_names = pkgs.items_name();
    let pkg_dependencies = pkgs.items_dependencies();

    match packages {
        Packages::All => {
            let mut seen_pkg_ids: HashMap<PackageID, ()> = HashMap::new();

            for _dep_id in 0..dependencies.len() {
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
                let mut expired = false;
                let cached = manifests.by_name_allow_expired(
                    cache_ctx,
                    options.scope_for_package_name(pkg_name_slice),
                    pkg_name_slice,
                    Some(&mut expired),
                    needs_extended_manifest,
                );
                // A published version's metadata never changes, so an expired manifest is still
                // good enough if it lists the resolved version.
                let has_version = cached.is_some_and(|manifest| {
                    !expired || manifest.find_by_version(res.npm().version).is_some()
                });
                if !has_version {
                    start_manifest_task(fields, pkg_name_slice, false, needs_extended_manifest)?;
                }

                let _ = run_tasks::schedule_tasks(fields);
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

                    let package_name = pkg_names[pkg_id as usize].slice(string_buf);
                    let cached = manifests.by_name(
                        cache_ctx,
                        options.scope_for_package_name(package_name),
                        package_name,
                        needs_extended_manifest,
                    );
                    if cached.is_none() {
                        start_manifest_task(
                            fields,
                            package_name,
                            dep.behavior.is_required(),
                            needs_extended_manifest,
                        )?;

                        let _ = run_tasks::schedule_tasks(fields);
                    }
                }
            }
        }
        Packages::Exact(ids) => {
            for &pkg_id in ids {
                if pkg_resolutions[pkg_id as usize].tag != ResolutionTag::Npm {
                    continue;
                }
                let package_name = pkg_names[pkg_id as usize].slice(string_buf);
                let cached = manifests.by_name(
                    cache_ctx,
                    options.scope_for_package_name(package_name),
                    package_name,
                    needs_extended_manifest,
                );
                if cached.is_none() {
                    start_manifest_task(fields, package_name, false, needs_extended_manifest)?;
                    let _ = run_tasks::schedule_tasks(fields);
                }
            }
        }
    }

    run_tasks::enqueue_due_retries(fields.state);
    let _ = run_tasks::schedule_tasks(fields);

    if manager.state.pending_task_count() > 0 {
        // `run_tasks` names the bar when a manifest download completes, and `start_manifest_task` starts none when every name is cached or already requested by a queued row.
        if log_level.show_progress() {
            manager.state.start_progress_bar_if_none();
        }

        let mut result = Ok(());
        manager.sleep_until(|manager| {
            let log_level = manager.options.log_level;
            result = run_tasks::run_tasks(Caller::ManifestCache(manager), true, log_level);
            result.is_err() || manager.state.pending_task_count() == 0
        });

        if log_level.show_progress() {
            manager.state.end_progress_bar();
            Output::flush();
        }

        result?;
    }

    Ok(())
}

/// Prints the fetch failures a [`Packages::Ids`] pass logged; true when one of them is a required dependency's.
pub fn print_fetch_failures(manager: &mut PackageManager) -> crate::Result<bool> {
    let log = manager.log();
    let failed_required = log.has_errors();
    if log.has_msgs() {
        Output::flush();
        log.print(Output::error_writer())?;
        log.reset();
    }
    Ok(failed_required)
}
