//! `bun pm fetch`: downloads the lockfile packages the resolve phase did not already cache.

use bun_core::Output;

use super::PackageManager;
use super::install_with_manager::wait_for_everything_except_peers;
use super::package_manager_options::LogLevel;
use crate::network_task::ForTarballError;
use crate::resolution::Tag as ResolutionTag;
use crate::{DependencyID, PackageID, PreinstallState, TaskCallbackContext, invalid_dependency_id};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Summary {
    /// Packages extracted by this process, including the resolve phase's prefetches.
    pub fetched: u32,
    /// Packages that were already in the cache.
    pub already_cached: u32,
    /// `git:` dependencies missing from the cache that were left alone.
    pub skipped_git: u32,
}

/// Failures are reported like `bun install`'s: in `manager.log` and `any_failed_to_install`.
pub fn populate_package_cache(manager: &mut PackageManager) -> crate::Result<Summary> {
    let log_level = manager.options.log_level;
    let cpu = manager.options.cpu;
    let os = manager.options.os;

    let _ = manager.get_cache_directory();
    let _ = manager.get_temporary_directory();

    let packages_len = manager.lockfile.packages.len();

    // Enqueueing is keyed by dependency edge; prefer a required one so failures are errors.
    let dep_ids: Vec<DependencyID> = {
        let dependencies = manager.lockfile.buffers.dependencies.as_slice();
        let resolutions = manager.lockfile.buffers.resolutions.as_slice();
        let mut index = vec![invalid_dependency_id; packages_len];
        for (dep_id, &pkg_id) in resolutions.iter().enumerate() {
            let Some(slot) = index.get_mut(pkg_id as usize) else {
                continue;
            };
            let dep_id = dep_id as DependencyID;
            if *slot == invalid_dependency_id
                || (!dependencies[*slot as usize].behavior.is_required()
                    && dependencies[dep_id as usize].behavior.is_required())
            {
                *slot = dep_id;
            }
        }
        index
    };

    let mut summary = Summary::default();

    for (i, &dep_id) in dep_ids.iter().enumerate() {
        let pkg_id = i as PackageID;
        let pkg = manager.lockfile.packages.get(i);
        let resolution = pkg.resolution;

        if !resolution.can_enqueue_install_task() || pkg.is_disabled(cpu, os) {
            continue;
        }

        let mut name_and_version_hash: Option<u64> = None;
        let mut patchfile_hash: Option<u64> = None;
        match manager.determine_preinstall_state(
            &pkg,
            &mut name_and_version_hash,
            &mut patchfile_hash,
        ) {
            PreinstallState::Extract => {}
            // `ApplyPatch`: the unpatched tarball is cached, which is all this command promises.
            PreinstallState::Done | PreinstallState::ApplyPatch => {
                summary.already_cached += 1;
                continue;
            }
            PreinstallState::Unknown
            | PreinstallState::Extracting
            | PreinstallState::CalcPatchHash
            | PreinstallState::CalcingPatchHash
            | PreinstallState::ApplyingPatch => continue,
        }

        // Nothing in the lockfile depends on this package.
        if dep_id == invalid_dependency_id {
            continue;
        }

        let task_context = TaskCallbackContext::Dependency(dep_id);
        let string_buf = manager.lockfile.buffers.string_bytes.as_slice();

        let enqueued = match resolution.tag {
            ResolutionTag::Npm => {
                let name = pkg.name.slice(string_buf).to_vec();
                let npm = *resolution.npm();
                let url = npm.url.slice(string_buf).to_vec();
                manager.enqueue_package_for_download(
                    &name,
                    dep_id,
                    pkg_id,
                    npm.version,
                    &url,
                    task_context,
                    name_and_version_hash,
                )
            }
            ResolutionTag::Github => {
                let url = manager.alloc_github_url(resolution.github());
                manager.enqueue_tarball_for_download(
                    dep_id,
                    pkg_id,
                    &url,
                    task_context,
                    name_and_version_hash,
                )
            }
            ResolutionTag::RemoteTarball => {
                let url = resolution.remote_tarball().slice(string_buf).to_vec();
                manager.enqueue_tarball_for_download(
                    dep_id,
                    pkg_id,
                    &url,
                    task_context,
                    name_and_version_hash,
                )
            }
            ResolutionTag::LocalTarball => {
                let alias = manager.lockfile.buffers.dependencies[dep_id as usize]
                    .name
                    .slice(string_buf)
                    .to_vec();
                manager.enqueue_tarball_for_reading(
                    dep_id,
                    pkg_id,
                    &alias,
                    &resolution,
                    task_context,
                );
                Ok(())
            }
            // `run_tasks` only schedules a checkout after a clone when `IS_PACKAGE_INSTALLER`.
            ResolutionTag::Git => {
                summary.skipped_git += 1;
                continue;
            }
            _ => continue,
        };

        match enqueued {
            Ok(()) => {}
            Err(ForTarballError::OutOfMemory) => bun_core::out_of_memory(),
            // `for_tarball` already added the error to `manager.log`.
            Err(ForTarballError::InvalidURL) => {}
            // Not expected here: downloads that failed during the resolve phase stay `Extracting`.
            Err(ForTarballError::AlreadyFailed) => {}
        }
    }

    let _ = manager.schedule_tasks();

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

    summary.fetched = manager.extracted_count;
    Ok(summary)
}
