use crate::lockfile::package::PackageColumns as _;
use bun_collections::DynamicBitSet;
use bun_core::Output;

use super::PackageManager;
use super::enqueue;
use super::manifest_requests::{Lookup, Reader};
use super::options::OfflineMode;
use super::run_tasks::{self, Caller};
use crate::PackageID;
use crate::network_task::ForManifestError;
use crate::package_manager_task as Task;
use crate::resolution::Tag as ResolutionTag;

fn backfill_manifest(
    manager: &mut PackageManager,
    name: &[u8],
    reader: Reader,
) -> Result<(), ForManifestError> {
    if manager.options.offline == OfflineMode::Offline {
        return Ok(());
    }
    let task_id = Task::ManifestId::new(name);
    let unrequested = match manager.manifest_requests.look_up(task_id) {
        Lookup::NotRequested(unrequested) => unrequested,
        Lookup::InFlight(request) => {
            request.join(reader, None);
            return Ok(());
        }
        Lookup::Failed(_) | Lookup::NothingWillCome => return Ok(()),
    };
    if manager.options.log_level.show_progress() {
        manager.start_progress_bar_if_none();
    }
    let is_optional = reader == Reader::OptionalBackfill;
    enqueue::request_manifest(manager, unrequested, name, None, is_optional, reader, None)
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

/// A dependency that is queued before or during the call resolves inside it.
pub fn populate_manifest_cache(
    manager: &mut PackageManager,
    packages: Packages<'_>,
) -> crate::Result<()> {
    let log_level = manager.options.log_level;
    let cache_ctx = manager.manifest_disk_cache_ctx();
    let needs_extended_manifest = manager.options.minimum_release_age_ms.is_some();
    let is_all = matches!(packages, Packages::All);

    let lockfile = &*manager.lockfile;
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let wanted: Vec<(PackageID, Reader)> = match packages {
        Packages::All => {
            let mut seen = DynamicBitSet::init_empty(lockfile.packages.len())?;
            (resolutions.iter())
                .filter(|&&id| {
                    let is_new = !seen.is_set_allow_out_of_bound(id as usize, true);
                    if is_new {
                        seen.set(id as usize);
                    }
                    is_new
                })
                .map(|&id| (id, Reader::OptionalBackfill))
                .collect()
        }
        Packages::Ids(ids) => (ids.iter())
            .map(|&id| lockfile.packages.items_dependencies()[id as usize])
            .flat_map(|rows| rows.begin() as usize..rows.end() as usize)
            .filter_map(|row| {
                let is_required = lockfile
                    .buffers
                    .dependencies
                    .get(row)?
                    .behavior
                    .is_required();
                let reader = if is_required {
                    Reader::RequiredBackfill
                } else {
                    Reader::OptionalBackfill
                };
                (resolutions[row] != crate::invalid_package_id)
                    .then_some((resolutions[row], reader))
            })
            .collect(),
        Packages::Exact(ids) => (ids.iter())
            .map(|&id| (id, Reader::OptionalBackfill))
            .collect(),
    };

    for (id, reader) in wanted {
        let lockfile = &*manager.lockfile;
        let resolution = &lockfile.packages.items_resolution()[id as usize];
        if resolution.tag != ResolutionTag::Npm {
            continue;
        }
        let name = lockfile.str(&lockfile.packages.items_name()[id as usize]);
        let mut expired = false;
        let cached = manager.manifests.by_name_allow_expired(
            cache_ctx,
            manager.options.scope_for_package_name(name),
            name,
            is_all.then_some(&mut expired),
            needs_extended_manifest,
        );
        // A published version's metadata never changes.
        if cached.is_some_and(|manifest| {
            !expired || manifest.find_by_version(resolution.npm().version).is_some()
        }) {
            continue;
        }
        let name = name.to_vec();
        backfill_manifest(manager, &name, reader)?;
        run_tasks::flush_network_queue(manager);
        let _ = run_tasks::schedule_tasks(manager);
    }

    run_tasks::flush_network_queue(manager);
    let _ = run_tasks::schedule_tasks(manager);

    if manager.pending_task_count() > 0 {
        // `run_tasks` names the bar when a manifest download completes, and `backfill_manifest` starts none when every name is cached or already requested by a queued row.
        if log_level.show_progress() {
            manager.start_progress_bar_if_none();
        }

        let mut result = Ok(());
        manager.sleep_until(|manager| {
            let log_level = manager.options.log_level;
            result = run_tasks::run_tasks(manager, Caller::ManifestCache, true, log_level);
            result.is_err() || manager.pending_task_count() == 0
        });

        if log_level.show_progress() {
            manager.end_progress_bar();
            Output::flush();
        }

        result?;
    }

    Ok(())
}

/// Prints the fetch failures a [`Packages::Ids`] pass logged; true when one of them is a required dependency's.
pub fn print_fetch_failures(manager: &PackageManager) -> crate::Result<bool> {
    let log = manager.log_mut();
    let failed_required = log.has_errors();
    if !log.msgs.is_empty() {
        Output::flush();
        log.print(Output::error_writer())?;
        log.reset();
    }
    Ok(failed_required)
}
