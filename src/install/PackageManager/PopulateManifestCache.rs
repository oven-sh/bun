use crate::lockfile::package::PackageColumns as _;
use bun_collections::HashMap;
use bun_core::Output;

use crate::NetworkTask;
use crate::PackageID;
use crate::invalid_package_id;
use crate::lockfile::Lockfile;
// Import the
// *module* under the `Task` name so `Task::Id` resolves as a path (matches
// `run_tasks.rs` / `PackageManagerEnqueue.rs`).
use super::PackageManager;
use super::enqueue;
use super::run_tasks;
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
    manager: &mut PackageManager,
    pkg_name: &[u8],
    is_required: bool,
    needs_extended_manifest: bool,
) -> Result<(), StartManifestTaskError> {
    // best-effort metadata backfill: nothing to do without the network
    if manager.options.offline == crate::package_manager_real::options::OfflineMode::Offline {
        return Ok(());
    }
    let task_id = Task::Id::for_manifest(pkg_name);
    if run_tasks::has_created_network_task(manager, task_id, is_required) {
        return Ok(());
    }
    if manager.options.log_level.show_progress() {
        manager.start_progress_bar_if_none();
    }

    let mut task = NetworkTask::new(task_id, manager);
    {
        let PackageManager {
            log, env, options, ..
        } = &mut *manager;
        let scope = options.scope_for_package_name(pkg_name);
        task.for_manifest(
            log,
            env.get(),
            pkg_name,
            scope,
            None,
            !is_required,
            needs_extended_manifest,
        )?;
    }

    enqueue::enqueue_network_task(manager, task);
    Ok(())
}

#[derive(Clone, Copy)]
pub enum Packages<'a> {
    /// Every npm package in this lockfile (the one a migration is building,
    /// not yet `manager.lockfile`); best-effort backfill, so failures are warnings.
    All(&'a Lockfile),
    /// The direct dependencies of these workspace packages; a required one failing is an error, see [`print_fetch_failures`].
    Ids(&'a [PackageID]),
    /// The manifests of these packages themselves (by name), not of their dependencies; best-effort, so failures are warnings.
    Exact(&'a [PackageID]),
}

/// `RunTasksCtx` for the hook-less `run_tasks` call in
/// `populate_manifest_cache`.
struct ManifestsOnlyCtx<'a>(&'a mut PackageManager);
impl run_tasks::RunTasksCtx for ManifestsOnlyCtx<'_> {
    fn manager(&mut self) -> &mut PackageManager {
        self.0
    }
    fn progress_bar(&self) -> bool {
        true
    }
    fn manifests_only(&self) -> bool {
        true
    }
}

/// An npm package whose manifest may need fetching: its name copied out of the
/// lockfile string buffer so the manager can be mutated while it is in use.
struct ManifestCandidate {
    name: NameBuf,
    is_required: bool,
}

/// npm package names are at most 214 bytes; anything longer cannot have come
/// from a registry and is fetched with a heap copy instead.
#[allow(clippy::large_enum_variant)] // the inline buffer is the point
enum NameBuf {
    Inline { buf: [u8; 214], len: u8 },
    Heap(Box<[u8]>),
}

impl NameBuf {
    fn new(name: &[u8]) -> NameBuf {
        if name.len() <= 214 {
            let mut buf = [0u8; 214];
            buf[..name.len()].copy_from_slice(name);
            NameBuf::Inline {
                buf,
                len: name.len() as u8,
            }
        } else {
            NameBuf::Heap(Box::from(name))
        }
    }
    fn as_slice(&self) -> &[u8] {
        match self {
            NameBuf::Inline { buf, len } => &buf[..*len as usize],
            NameBuf::Heap(b) => b,
        }
    }
}

fn npm_candidate(
    lockfile: &Lockfile,
    pkg_id: PackageID,
    is_required: bool,
) -> Option<ManifestCandidate> {
    if lockfile.packages.items_resolution()[pkg_id as usize].tag != ResolutionTag::Npm {
        return None;
    }
    let name = lockfile.packages.items_name()[pkg_id as usize]
        .slice(lockfile.buffers.string_bytes.as_slice());
    Some(ManifestCandidate {
        name: NameBuf::new(name),
        is_required,
    })
}

fn fetch_manifest_if_uncached(
    manager: &mut PackageManager,
    candidate: &ManifestCandidate,
) -> crate::Result<()> {
    let cache_ctx = manager.manifest_disk_cache_ctx();
    let name = candidate.name.as_slice();
    let needs_extended_manifest = manager.options.minimum_release_age_ms.is_some();
    let scope = manager.options.scope_for_package_name(name);
    let cached = manager
        .manifests
        .by_name(cache_ctx, scope, name, needs_extended_manifest);
    if cached.is_none() {
        start_manifest_task(
            manager,
            name,
            candidate.is_required,
            needs_extended_manifest,
        )?;
        run_tasks::flush_network_queue(manager);
        let _ = run_tasks::schedule_tasks(manager);
    }
    Ok(())
}

/// Populate the manifest cache for the packages `packages` selects (see
/// [`Packages`]).
pub fn populate_manifest_cache(
    manager: &mut PackageManager,
    packages: Packages<'_>,
) -> crate::Result<()> {
    let log_level = manager.options.log_level;

    match packages {
        Packages::All(lockfile) => {
            let mut seen_pkg_ids: HashMap<PackageID, ()> = HashMap::new();

            for dep_id in 0..lockfile.buffers.dependencies.len() {
                let pkg_id = lockfile.buffers.resolutions[dep_id];
                if pkg_id == invalid_package_id {
                    continue;
                }

                if seen_pkg_ids.insert(pkg_id, ()).is_some() {
                    continue;
                }

                let Some(candidate) = npm_candidate(lockfile, pkg_id, false) else {
                    continue;
                };
                fetch_manifest_if_uncached(manager, &candidate)?;
                // `.All` flushes after every candidate, cached or not.
                run_tasks::flush_network_queue(manager);
                let _ = run_tasks::schedule_tasks(manager);
            }
        }
        Packages::Ids(ids) => {
            for &root_pkg_id in ids {
                let pkg_deps = manager.lockfile.packages.items_dependencies()[root_pkg_id as usize];
                for dep_id in pkg_deps.begin()..pkg_deps.end() {
                    let dep_id = dep_id as usize;
                    let (pkg_id, is_required) = {
                        let buffers = &manager.lockfile.buffers;
                        if dep_id >= buffers.dependencies.len() {
                            continue;
                        }
                        let pkg_id = buffers.resolutions[dep_id];
                        if pkg_id == invalid_package_id {
                            continue;
                        }
                        (pkg_id, buffers.dependencies[dep_id].behavior.is_required())
                    };
                    let Some(candidate) = npm_candidate(&manager.lockfile, pkg_id, is_required)
                    else {
                        continue;
                    };
                    fetch_manifest_if_uncached(manager, &candidate)?;
                }
            }
        }
        Packages::Exact(ids) => {
            for &pkg_id in ids {
                let Some(candidate) = npm_candidate(&manager.lockfile, pkg_id, false) else {
                    continue;
                };
                fetch_manifest_if_uncached(manager, &candidate)?;
            }
        }
    }

    run_tasks::flush_network_queue(manager);
    let _ = run_tasks::schedule_tasks(manager);

    if run_tasks::pending_task_count(manager) > 0 {
        let mut err: Option<crate::Error> = None;
        PackageManager::sleep_until(manager, |manager| {
            let log_level = manager.options.log_level;
            if let Err(e) = run_tasks::run_tasks(&mut ManifestsOnlyCtx(manager), true, log_level) {
                err = Some(e);
                return true;
            }
            run_tasks::pending_task_count(manager) == 0
        });

        if log_level.show_progress() {
            manager.end_progress_bar();
            Output::flush();
        }

        if let Some(err) = err {
            return Err(err);
        }
    }

    Ok(())
}

/// Prints the fetch failures a [`Packages::Ids`] pass logged; true when one of them is a required dependency's.
pub fn print_fetch_failures(manager: &mut PackageManager) -> crate::Result<bool> {
    let log = &mut manager.log;
    let failed_required = log.has_errors();
    if !log.msgs.is_empty() {
        Output::flush();
        log.print(core::ptr::from_mut(Output::error_writer()))?;
        log.reset();
    }
    Ok(failed_required)
}
