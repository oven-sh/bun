//! `bun pm fetch`: resolves like `bun install`, but only writes to the cache.

use bun_core::{Output, ZBox};

use super::add_remove_with_filter::root_package_json_path;
use super::enqueue::{
    enqueue_git_for_checkout, enqueue_package_for_download, enqueue_tarball_for_download,
    enqueue_tarball_for_reading,
};
use super::install_with_manager::{install_with_manager, wait_for_everything_except_peers};
use super::package_manager_options::{Do, LogLevel};
use super::{Command, PackageManager};
use crate::network_task::ForTarballError;
use crate::resolution::Tag as ResolutionTag;
use crate::{DependencyID, PackageID, PreinstallState, TaskCallbackContext, invalid_dependency_id};

#[derive(Clone, Copy, Default)]
pub struct Summary {
    /// Packages extracted by this process, including the resolve phase's prefetches.
    pub fetched: u32,
    pub already_cached: u32,
}

/// Failures are reported the same way as in `bun install`: in `manager.log` and
/// `any_failed_to_install`.
pub fn fetch(
    manager: &mut PackageManager,
    ctx: Command::Context,
    original_cwd: &[u8],
) -> crate::Result<Summary> {
    manager.options.do_.remove(
        Do::INSTALL_PACKAGES
            | Do::RUN_SCRIPTS
            | Do::WRITE_PACKAGE_JSON
            | Do::SAVE_LOCKFILE
            | Do::SAVE_YARN_LOCK
            | Do::SUMMARY,
    );
    // `--dry-run` must not modify the cache either.
    let count_only = manager.options.dry_run;
    if count_only {
        manager.options.do_.remove(Do::PREFETCH_RESOLVED_TARBALLS);
    }
    // The bun.lockb conversion and `--lockfile-only` write the lockfile without consulting `do_`.
    manager.options.dry_run = true;
    manager.options.lockfile_only = false;

    // Resolving downloads whatever the lockfile did not pin yet.
    let root_package_json_path = ZBox::from_bytes(root_package_json_path());
    install_with_manager(manager, ctx, &root_package_json_path, original_cwd)?;
    if manager.any_failed_to_install {
        return Ok(Summary::default());
    }
    download_pinned_packages(manager, None, count_only)
}

/// With `only`, downloads just that package, which the caller already knows is not in the cache.
/// With `count_only`, downloads nothing, and `fetched` counts what would have been downloaded.
pub(crate) fn download_pinned_packages(
    manager: &mut PackageManager,
    only: Option<PackageID>,
    count_only: bool,
) -> crate::Result<Summary> {
    let log_level = manager.options.log_level;
    let (cpu, os, libc) = (
        manager.options.cpu,
        manager.options.os,
        manager.options.libc,
    );

    let _ = manager.get_cache_directory();
    let _ = manager.get_temporary_directory();

    // Enqueueing is keyed by dependency. Prefer a required one, so that failures are errors.
    let dep_ids: Vec<DependencyID> = {
        let dependencies = manager.lockfile.buffers.dependencies.as_slice();
        let mut index = vec![invalid_dependency_id; manager.lockfile.packages.len()];
        for (dep_id, &pkg_id) in manager.lockfile.buffers.resolutions.iter().enumerate() {
            let Some(slot) = index.get_mut(pkg_id as usize) else {
                continue;
            };
            if *slot == invalid_dependency_id
                || (!dependencies[*slot as usize].behavior.is_required()
                    && dependencies[dep_id].behavior.is_required())
            {
                *slot = dep_id as DependencyID;
            }
        }
        index
    };

    let mut summary = Summary::default();

    for (i, &dep_id) in dep_ids.iter().enumerate() {
        // Nothing in the lockfile depends on this package.
        if dep_id == invalid_dependency_id {
            continue;
        }
        let pkg_id = i as PackageID;
        if only.is_some_and(|only| only != pkg_id) {
            continue;
        }
        let pkg = *manager.lockfile.packages.get(i);
        let resolution = pkg.resolution;
        let behavior = manager.lockfile.buffers.dependencies[dep_id as usize].behavior;

        if !resolution.can_enqueue_install_task()
            || pkg.meta.is_disabled(cpu, os, libc.for_dependency(behavior))
        {
            continue;
        }

        let mut name_and_version_hash: Option<u64> = None;
        let mut patchfile_hash: Option<u64> = None;
        let state = if only.is_some() {
            // `determine_preinstall_state` would return `CalcPatchHash` for a patched package whose
            // patch file has not been hashed yet, and the package would be skipped below.
            PreinstallState::Extract
        } else {
            manager.determine_preinstall_state(
                &pkg,
                behavior,
                &mut name_and_version_hash,
                &mut patchfile_hash,
            )
        };
        match state {
            PreinstallState::Extract => {}
            // For `ApplyPatch`, the unpatched tarball is cached, which is all that this command
            // promises.
            PreinstallState::Done | PreinstallState::ApplyPatch => {
                summary.already_cached += 1;
                continue;
            }
            _ => continue,
        }
        if count_only {
            summary.fetched += 1;
            continue;
        }

        let waiter = TaskCallbackContext::Dependency(dep_id);
        // The callees copy these before `string_bytes` can grow.
        let alias = manager.lockfile.buffers.dependencies[dep_id as usize].name;
        let alias = manager.lockfile.str_detached(&alias);
        let enqueued = match resolution.tag {
            ResolutionTag::Npm => {
                let name = manager.lockfile.str_detached(&pkg.name);
                let url = manager.lockfile.str_detached(&resolution.npm().url);
                let version = resolution.npm().version;
                enqueue_package_for_download(manager, name, dep_id, pkg_id, version, url, waiter)
            }
            ResolutionTag::Github => {
                let url = manager.alloc_github_url(resolution.github());
                enqueue_tarball_for_download(manager, dep_id, pkg_id, &url, waiter)
            }
            ResolutionTag::RemoteTarball => {
                let url = manager.lockfile.str_detached(resolution.remote_tarball());
                enqueue_tarball_for_download(manager, dep_id, pkg_id, url, waiter)
            }
            ResolutionTag::LocalTarball => {
                enqueue_tarball_for_reading(manager, dep_id, pkg_id, alias, &resolution, waiter)
            }
            ResolutionTag::Git => enqueue_git_for_checkout(
                manager,
                dep_id,
                pkg_id,
                alias,
                waiter,
                name_and_version_hash,
            ),
            _ => continue,
        };
        // Any other error is already in `manager.log`.
        if let Err(ForTarballError::OutOfMemory) = enqueued {
            bun_core::out_of_memory();
        }
    }

    // A `Dependency` callback would resolve its dependency again, which would download a `github:`
    // package twice.
    for waiters in manager.task_queue.values_mut() {
        waiters.retain(|waiter| matches!(waiter, TaskCallbackContext::GitCheckout { .. }));
    }

    let _ = super::run_tasks::schedule_tasks(manager);

    if manager.pending_task_count() > 0 {
        if log_level.show_progress() {
            manager.start_progress_bar();
        } else if log_level != LogLevel::Silent {
            bun_core::pretty_errorln!("Fetching packages");
            Output::flush();
        }

        let waited = wait_for_everything_except_peers(manager);

        if log_level.show_progress() {
            manager.end_progress_bar();
        }

        waited?;
    }

    summary.fetched += manager.extracted_count;
    Ok(summary)
}
