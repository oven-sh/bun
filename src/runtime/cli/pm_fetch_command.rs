use bstr::BStr;

use bun_core::{Global, Output};
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::package_manager_real::{
    PackageManager, ROOT_PACKAGE_JSON_PATH, get_cache_directory, get_temporary_directory,
    install_with_manager,
    package_manager_options::LogLevel,
    run_tasks::{RunTasksCallbacks, run_tasks},
};
use bun_install::resolution::Tag as ResolutionTag;
use bun_install::{
    DependencyID, INVALID_DEPENDENCY_ID, PackageID, PreinstallState, TaskCallbackContext,
};
use bun_paths::PathBuffer;

use crate::cli::Command;

pub struct PmFetchCommand;

impl PmFetchCommand {
    pub fn exec(
        ctx: Command::Context,
        pm: &mut PackageManager,
        original_cwd: &[u8],
    ) -> Result<(), bun_core::Error> {
        let log_level = pm.options.log_level;

        if pm.options.should_print_command_name() {
            bun_core::prettyln!(
                "<r><b>bun pm fetch <r><d>v{}<r>\n",
                Global::package_json_version_with_sha,
            );
            Output::flush();
        }

        // Resolve and download into the cache, but never touch node_modules,
        // run scripts, or write package.json / the lockfile.
        pm.options.do_.set_install_packages(false);
        pm.options.do_.set_run_scripts(false);
        pm.options.do_.set_write_package_json(false);
        pm.options.do_.set_save_lockfile(false);
        pm.options.do_.set_summary(false);

        // Resolve dependencies and download any newly-resolved tarballs into the
        // cache. This reuses the standard install pipeline with node_modules
        // installation disabled above.
        // SAFETY: `ROOT_PACKAGE_JSON_PATH` is written exactly once inside
        // `PackageManager::init` (already called by `bun pm` dispatch) on this
        // thread; only read thereafter.
        let root_package_json_path = unsafe { ROOT_PACKAGE_JSON_PATH.read() };
        install_with_manager(pm, &mut *ctx, root_package_json_path, original_cwd)?;

        if pm.any_failed_to_install || pm.log_mut().has_errors() {
            let _ = pm
                .log_mut()
                .print(std::ptr::from_mut(Output::error_writer()));
            Global::exit(1);
        }

        // The resolve phase only prefetches tarballs for packages it *newly* resolved.
        // Packages already resolved in the lockfile need a second pass to ensure
        // they are present in the cache.

        // Build a reverse index from package id to a dependency id that
        // resolves to it, preferring required edges over optional ones so
        // download failures on transitively-required packages are errors.
        let packages_len = pm.lockfile.packages.len();
        let dep_ids: Vec<DependencyID> = {
            let deps = pm.lockfile.buffers.dependencies.as_slice();
            let dep_resolutions = pm.lockfile.buffers.resolutions.as_slice();
            let mut index = vec![INVALID_DEPENDENCY_ID; packages_len];
            for (dep_idx, &res_pkg_id) in dep_resolutions.iter().enumerate() {
                if res_pkg_id as usize >= packages_len {
                    continue;
                }
                let id = dep_idx as DependencyID;
                let existing = index[res_pkg_id as usize];
                if existing == INVALID_DEPENDENCY_ID
                    || (!deps[existing as usize].behavior.is_required()
                        && deps[id as usize].behavior.is_required())
                {
                    index[res_pkg_id as usize] = id;
                }
            }
            index
        };

        let mut already_cached: u32 = 0;
        let mut skipped_git: u32 = 0;

        let _ = get_cache_directory(pm);
        let _ = get_temporary_directory(pm);

        let cpu = pm.options.cpu;
        let os = pm.options.os;

        for i in 0..packages_len {
            let pkg_id = i as PackageID;
            // Re-read each iteration: the enqueue calls below take `&mut pm`,
            // so we can't hold a borrowed slice into `pm.lockfile.packages`
            // across iterations (the array itself is stable for this loop).
            let resolution = pm.lockfile.packages.slice().items_resolution()[i];

            if !resolution.tag.can_enqueue_install_task() {
                continue;
            }

            let pkg = pm.lockfile.packages.get(i);

            if pkg.is_disabled(cpu, os) {
                continue;
            }

            let mut name_and_version_hash: Option<u64> = None;
            let mut patchfile_hash: Option<u64> = None;

            match pm.determine_preinstall_state(
                &pkg,
                &mut name_and_version_hash,
                &mut patchfile_hash,
            ) {
                PreinstallState::Done => {
                    already_cached += 1;
                    continue;
                }
                PreinstallState::Extract => {}
                PreinstallState::ApplyPatch => {
                    // The unpatched tarball is already in the cache. `bun pm fetch`
                    // only guarantees tarballs are cached; patches are applied
                    // during `bun install`.
                    already_cached += 1;
                    continue;
                }
                // `CalcPatchHash` is returned before the cache is checked;
                // in practice pass 1 computes all patch hashes so this should
                // not occur here, but if it does the cache state is unknown.
                PreinstallState::CalcPatchHash
                | PreinstallState::Unknown
                | PreinstallState::Extracting
                | PreinstallState::CalcingPatchHash
                | PreinstallState::ApplyingPatch => continue,
            }

            let dep_id = dep_ids[i];
            // Orphaned package, skip it.
            if dep_id == INVALID_DEPENDENCY_ID {
                continue;
            }

            let task_ctx = TaskCallbackContext::Dependency(dep_id);
            let string_buf = pm.lockfile.buffers.string_bytes.as_slice();

            match resolution.tag {
                ResolutionTag::Npm => {
                    let pkg_name = pm.lockfile.packages.slice().items_name()[i]
                        .slice(string_buf)
                        .to_vec();
                    let version = resolution.npm().version;
                    let url = resolution.npm().url.slice(string_buf).to_vec();
                    match pm.enqueue_package_for_download(
                        &pkg_name,
                        dep_id,
                        pkg_id,
                        version,
                        &url,
                        task_ctx,
                        name_and_version_hash,
                    ) {
                        Ok(()) => {}
                        Err(e) if e == bun_core::err!(OutOfMemory) => bun_core::out_of_memory(),
                        // `NetworkTask::for_tarball` has already logged a
                        // specific error to `pm.log` for `InvalidURL`.
                        Err(_) => continue,
                    }
                }
                ResolutionTag::Git => {
                    // The `GitClone` completion handler in `runTasks.rs` only
                    // schedules a checkout when `IS_PACKAGE_INSTALLER`. In the
                    // resolve-mode callbacks used here it re-resolves the
                    // dependency (finding the existing lockfile package) and
                    // never schedules the checkout, so the cache would not be
                    // populated. Skip `git:` dependencies in this pass; they
                    // are populated during the resolve phase above when first
                    // resolved, and otherwise during `bun install`.
                    skipped_git += 1;
                    continue;
                }
                ResolutionTag::Github => {
                    let url = pm.alloc_github_url(resolution.github());
                    match pm.enqueue_tarball_for_download(
                        dep_id,
                        pkg_id,
                        &url,
                        task_ctx,
                        name_and_version_hash,
                    ) {
                        Ok(()) => {}
                        Err(e) if e == bun_core::err!(OutOfMemory) => bun_core::out_of_memory(),
                        // `NetworkTask::for_tarball` has already logged a
                        // specific error to `pm.log` for `InvalidURL`.
                        Err(_) => continue,
                    }
                }
                ResolutionTag::LocalTarball => {
                    let alias = pm.lockfile.buffers.dependencies[dep_id as usize]
                        .name
                        .slice(string_buf)
                        .to_vec();
                    pm.enqueue_tarball_for_reading(dep_id, pkg_id, &alias, &resolution, task_ctx);
                }
                ResolutionTag::RemoteTarball => {
                    let url = resolution.remote_tarball().slice(string_buf).to_vec();
                    match pm.enqueue_tarball_for_download(
                        dep_id,
                        pkg_id,
                        &url,
                        task_ctx,
                        name_and_version_hash,
                    ) {
                        Ok(()) => {}
                        Err(e) if e == bun_core::err!(OutOfMemory) => bun_core::out_of_memory(),
                        // `NetworkTask::for_tarball` has already logged a
                        // specific error to `pm.log` for `InvalidURL`.
                        Err(_) => continue,
                    }
                }
                _ => continue,
            }
        }

        let _ = pm.schedule_tasks();

        if pm.pending_task_count() > 0 {
            if log_level.show_progress() {
                pm.start_progress_bar();
            } else if log_level != LogLevel::Silent {
                bun_core::pretty_errorln!("Fetching packages");
                Output::flush();
            }

            let wait_result = WaitClosure::run_and_wait(pm);

            if log_level.show_progress() {
                pm.end_progress_bar();
            }

            if let Err(err) = wait_result {
                let _ = pm
                    .log_mut()
                    .print(std::ptr::from_mut(Output::error_writer()));
                return Err(err);
            }
        }

        let _ = pm
            .log_mut()
            .print(std::ptr::from_mut(Output::error_writer()));
        if pm.log_mut().has_errors() || pm.any_failed_to_install {
            Global::exit(1);
        }

        if log_level != LogLevel::Silent {
            let mut cache_dir_buf = PathBuffer::uninit();
            let cache_dir: &[u8] =
                match bun_sys::get_fd_path(get_cache_directory(pm), &mut cache_dir_buf) {
                    Ok(p) => &p[..],
                    Err(_) => b"",
                };

            let total_fetched = pm.extracted_count;

            if total_fetched > 0 {
                bun_core::pretty!(
                    "<green>Fetched {} package{}<r> into cache ",
                    total_fetched,
                    if total_fetched == 1 { "" } else { "s" },
                );
            } else if already_cached > 0 {
                bun_core::pretty!(
                    "<green>Done<r>! {} package{} already in cache ",
                    already_cached,
                    if already_cached == 1 { "" } else { "s" },
                );
            } else {
                bun_core::pretty!("<green>Done<r>! No packages to fetch ");
            }
            Output::print_start_end_stdout(ctx.start_time, bun_core::time::nano_timestamp());
            bun_core::pretty!("<r>\n");
            if skipped_git > 0 {
                bun_core::prettyln!(
                    "<yellow>note<r>: skipped {} git dependenc{} (run <b>bun install<r> to populate)",
                    skipped_git,
                    if skipped_git == 1 { "y" } else { "ies" },
                );
            }
            if !cache_dir.is_empty() {
                bun_core::prettyln!("<d>Cache: {}<r>", BStr::new(cache_dir));
            }
            Output::flush();
        }

        Ok(())
    }
}

/// `RunTasksCallbacks` impl for the void-callback `run_tasks` call inside
/// `WaitClosure::is_done` — only drain network/extract with a progress bar.
struct FetchWaitCallbacks;
impl RunTasksCallbacks for FetchWaitCallbacks {
    type Ctx = ();
    const PROGRESS_BAR: bool = true;
}

struct WaitClosure {
    // Raw pointer so the callback's reborrow shares provenance with the
    // `sleep_until` receiver; see `RunAndWaitClosure` in
    // `install_with_manager.rs` for the Stacked-Borrows rationale.
    manager: *mut PackageManager,
    err: Option<bun_core::Error>,
}

impl WaitClosure {
    fn is_done(closure: &mut Self) -> bool {
        // SAFETY: `closure.manager` is the raw provenance root set in
        // `run_and_wait`. `sleep_until` takes a raw pointer and `tick_raw`
        // holds no `&mut event_loop` across `is_done`, so this is the unique
        // live borrow for the duration of the callback.
        let this = unsafe { &mut *closure.manager };
        this.drain_dependency_list();

        let log_level = this.options.log_level;
        if let Err(err) = run_tasks::<FetchWaitCallbacks>(this, &mut (), false, log_level) {
            closure.err = Some(err);
            return true;
        }

        this.pending_task_count() == 0
    }

    fn run_and_wait(this: &mut PackageManager) -> Result<(), bun_core::Error> {
        // Derive the raw pointer first and route every manager access through
        // it so the `sleep_until` receiver and the closure share provenance.
        let mgr: *mut PackageManager = this;
        let mut closure = WaitClosure {
            manager: mgr,
            err: None,
        };

        // SAFETY: `mgr` was just derived from the live exclusive `this` borrow
        // and is the sole access path from here on.
        unsafe { PackageManager::sleep_until(mgr, &mut closure, Self::is_done) };

        if let Some(err) = closure.err {
            return Err(err);
        }
        Ok(())
    }
}

// ported from: src/cli/pm_fetch_command.zig
