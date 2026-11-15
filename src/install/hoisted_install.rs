use crate::lockfile::package::PackageColumns as _;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_collections::{DynamicBitSet as Bitset, DynamicBitSetList, StringHashMap};
use bun_core::strings;
use bun_core::{Global, Output};
use bun_paths::SEP;
use bun_sys::{self as sys, Dir, Fd};

use crate::analytics;
use crate::bun_fs::FileSystem;
use crate::bun_progress::NodeId;

use crate::PackageManager;
use crate::bin_real as bin;
use crate::lockfile::tree;
use crate::package_install;
use crate::package_installer::{DeferredLinks, NodeModulesFolder, PackageInstaller, TreeContext};
use crate::package_manager::{self, WorkspaceFilter, install_fields};
use crate::package_manager_real::run_tasks::{Caller, run_tasks};
use crate::prune::LinkedNodeModules;
use crate::{DependencyID, PackageID};

/// Runs tasks whenever the event loop wakes up, until `links` is 0 or (`None`) nothing is pending or links wait.
fn run_tasks_until_done(
    installer: &mut PackageInstaller<'_>,
    links: Option<&AtomicUsize>,
) -> crate::Result<()> {
    // Not `sleep()`, which would run no task until all current lifecycle scripts have finished.
    Output::flush();
    loop {
        let log_level = installer.manager.options.log_level;
        run_tasks(Caller::HoistedLinker(installer), true, log_level)?;

        // A script that has ended makes room for one that waits.
        installer.run_available_scripts(log_level);
        installer.manager.report_slow_lifecycle_scripts();

        let pending_task_count = installer.manager.state.pending_task_count();
        if pending_task_count > 0
            && PackageManager::verbose_install()
            && (installer.manager.state).has_enough_time_passed_between_waiting_messages()
        {
            bun_core::pretty_errorln!(
                "<d>[PackageManager]<r> waiting for {} tasks\n",
                pending_task_count
            );
        }

        let is_done = match links {
            Some(links) => links.load(Ordering::Acquire) == 0,
            None => {
                installer.has_deferred_links()
                    || (installer.manager.state.pending_task_count() == 0
                        && installer.manager.has_no_more_pending_lifecycle_scripts())
            }
        };
        if is_done {
            return Ok(());
        }
        installer.manager.tick();
    }
}

/// Has the thread pool link the waiting packages, including the ones that start waiting in the
/// meantime. Must not be called from inside `run_tasks`.
fn link_deferred(
    installer: &mut PackageInstaller<'_>,
    log_level: package_manager::Options::LogLevel,
) -> crate::Result<()> {
    while let Some((links, events)) = installer.take_deferred_links() {
        // Tasks that were already started keep running while the pool links.
        let mut ran_tasks = Ok(());
        links.run(&mut |until| {
            if ran_tasks.is_ok() {
                ran_tasks = run_tasks_until_done(installer, Some(until));
            }
        });
        ran_tasks?;
        if !installer.manager.effective_do().install_packages() {
            return Err(crate::Error::InstallFailed);
        }
        installer.finish_links(links, events, log_level);
    }
    Ok(())
}

pub(crate) fn install_hoisted_packages(
    this: &mut PackageManager,
    workspace_filters: &[WorkspaceFilter],
    install_root_dependencies: bool,
    log_level: package_manager::Options::LogLevel,
    packages_to_install: Option<&[PackageID]>,
) -> crate::Result<package_install::Summary> {
    analytics::features::hoisted_bun_install.fetch_add(1, Ordering::Relaxed);

    // `filter_lockfile` repopulates the live ones in-place.
    let original_trees = this.lockfile.buffers.trees.clone();
    let original_tree_dep_ids = this.lockfile.buffers.hoisted_dependencies.clone();

    let places = this
        .filter_lockfile(
            false, // all_rows
            install_root_dependencies,
            workspace_filters,
            packages_to_install,
            tree::Layout::Locked,
        )?
        .places;

    if log_level.show_progress() {
        let hoisted_len = this.lockfile.buffers.hoisted_dependencies.len();
        this.state.start_install_progress_bar(hoisted_len);
    }

    let summary = link_trees(this, places, log_level, packages_to_install);

    this.finish_linking();
    this.state.unfinished_scripts.clear();
    this.lockfile.buffers.trees = original_trees;
    this.lockfile.buffers.hoisted_dependencies = original_tree_dep_ids;
    summary
}

fn link_trees(
    this: &mut PackageManager,
    places: Vec<(u64, PackageID)>,
    log_level: package_manager::Options::LogLevel,
    packages_to_install: Option<&[PackageID]>,
) -> crate::Result<package_install::Summary> {
    // A partial install (for the security scanner) runs before the real one, so it leaves the
    // layout alone.
    let has_isolated_store = packages_to_install.is_none()
        && this.options.node_linker == bun_install_types::NodeLinker::NodeLinker::Hoisted
        && sys::directory_exists_at(Fd::cwd(), bun_paths::path_literal!("node_modules/.bun"))
            .unwrap_or(false);
    // If `node_modules` is a symlink, nothing behind it is cleared, so every install finds `.bun`
    // again. Warn instead of treating each install as a switch away from the isolated linker.
    let is_linked = has_isolated_store
        && LinkedNodeModules::is_at(bun_paths::path_literal!("node_modules")) == Some(true);
    let replacing_isolated_node_modules = has_isolated_store && !is_linked;
    let old_modules = if replacing_isolated_node_modules {
        crate::isolated_install::move_node_modules_aside(
            &this.lockfile,
            this.options.global,
            log_level,
        )
    } else {
        if is_linked {
            let folder = Box::<[u8]>::from(&b"node_modules"[..]);
            LinkedNodeModules::warn_not_cleared(log_level, &[folder]);
        }
        None
    };

    // If there was already a valid lockfile and so we did not resolve, i.e. there was zero network activity
    // the packages could still not be in the cache dir
    // this would be a common scenario in a CI environment
    // or if you just cloned a repo
    // we want to check lazily though
    // no need to download packages you've already installed!!
    let mut new_node_modules = false;
    let cwd = Fd::cwd();
    let node_modules_folder: Dir = 'brk: {
        // Attempt to open the existing node_modules folder
        match sys::openat_os_path(
            cwd,
            bun_paths::os_path_literal!("node_modules"),
            sys::O::DIRECTORY | sys::O::RDONLY,
            0o755,
        ) {
            Ok(fd) => break 'brk Dir::from_fd(fd),
            Err(_) => {}
        }

        new_node_modules = true;

        // Attempt to create a new node_modules folder
        if let Err(err) = sys::mkdir(bun_core::zstr!("node_modules"), 0o755) {
            if err.errno != sys::E::EEXIST as _ {
                Output::err(
                    err,
                    "could not create the <b>\"node_modules\"<r> directory",
                    (),
                );
                Global::crash();
            }
        }
        match Dir::borrow(&cwd).open_at(b"node_modules") {
            Ok(dir) => break 'brk dir,
            Err(err) => {
                Output::err(
                    err,
                    "could not open the <b>\"node_modules\"<r> directory",
                    (),
                );
                Global::crash();
            }
        }
    };

    let mut skip_delete = new_node_modules;
    let mut skip_verify_installed_version_number = new_node_modules;

    // Whatever `move_node_modules_aside` could not move is still deleted before it is reinstalled.
    if this.options.enable.force_install() || replacing_isolated_node_modules {
        skip_verify_installed_version_number = true;
        skip_delete = false;
    }

    let mut summary = package_install::Summary {
        old_modules,
        places,
        ..Default::default()
    };

    {
        let trusted_deps = this.find_trusted_dependencies_from_update_requests();
        let lockfile = &*this.lockfile;

        let mut iterator = tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::from_slices(
            lockfile.buffers.trees.as_slice(),
            lockfile.buffers.hoisted_dependencies.as_slice(),
            lockfile.buffers.dependencies.as_slice(),
            lockfile.buffers.string_bytes.as_slice(),
        );

        let direct_packages = bin::LinkOrder::direct_packages(lockfile)?;

        let mut installer: PackageInstaller = 'brk: {
            let (completed_trees, tree_ids_to_trees_the_id_depends_on) = 'trees: {
                let trees = lockfile.buffers.trees.as_slice();
                let completed_trees = Bitset::init_empty(trees.len())?;
                let mut tree_ids_to_trees_the_id_depends_on = DynamicBitSetList::init_empty(
                    trees.len(),
                    u32::try_from(trees.len()).expect("int cast"),
                );

                {
                    // For each tree id, traverse through it's parents and mark all visited tree
                    // ids as dependents for the current tree parent
                    let mut deps = Bitset::init_empty(trees.len())?;
                    for _curr in trees {
                        let mut curr = *_curr;
                        tree_ids_to_trees_the_id_depends_on
                            .at_mut(curr.id)
                            .set(curr.id as usize);

                        while curr.parent != tree::Tree::INVALID_ID {
                            deps.set(curr.id as usize);
                            tree_ids_to_trees_the_id_depends_on
                                .at_mut(curr.parent)
                                .set_union(&deps);
                            curr = trees[curr.parent as usize];
                        }

                        deps.set_all(false);
                    }
                }

                break 'trees (completed_trees, tree_ids_to_trees_the_id_depends_on);
            };

            let parts = &lockfile.packages;
            let pkg_len = parts.len();
            let trees_count = lockfile.buffers.trees.len();

            break 'brk PackageInstaller {
                log: this.log(),
                manager: install_fields!(this),
                postinstall_optimizer: &this.project.postinstall_optimizer,
                patched_dependencies_to_remove: &this.patched_dependencies_to_remove,
                added_trusted_dependencies: &this.summary.added_trusted_dependencies,
                metas: parts.items_meta(),
                bins: parts.items_bin(),
                names: parts.items_name(),
                pkg_name_hashes: parts.items_name_hash(),
                resolutions: parts.items_resolution(),
                root_node_modules_folder: node_modules_folder,
                staging_lock: None,
                tree_dir: None,
                // Disabled on Windows, where the hardlink backend has its own queue. A batch keeps
                // up to 64 directories open.
                deferred: (cfg!(not(windows)) && !FileSystem::get().fs.need_to_close_files())
                    .then(|| DeferredLinks::init(lockfile)),
                node_modules: NodeModulesFolder {
                    path: strings::without_trailing_slash(FileSystem::get().top_level_dir())
                        .to_vec(),
                    tree_id: 0,
                },
                skip_verify_installed_version_number,
                skip_delete,
                workspaces_seen: Vec::new(),
                summary: &mut summary,
                successfully_installed: Bitset::init_empty(pkg_len)?,
                tree_ids_to_trees_the_id_depends_on,
                completed_trees,
                pending_install_count: 0,
                trees: 'trees: {
                    let mut trees: Vec<TreeContext> = Vec::with_capacity(trees_count);
                    for _i in 0..trees_count {
                        trees.push(TreeContext {
                            binaries: bin::PriorityQueue::init(bin::PriorityQueueContext {
                                lockfile,
                                direct_packages: &direct_packages,
                            }),
                            pending_installs: Vec::new(),
                            bins_after_scripts: Vec::new(),
                            install_count: 0,
                            replaced: Vec::new(),
                            inside_replaced_folder: false,
                            outlived_root: false,
                        });
                    }
                    break 'trees trees.into_boxed_slice();
                },
                trusted_dependencies_from_update_requests: trusted_deps,
                seen_bin_links: StringHashMap::<()>::default(),
                destination_dir_subpath_buf: bun_paths::PathBuffer::ZEROED,
                folder_path_buf: bun_paths::PathBuffer::ZEROED,
                current_tree_id: tree::INVALID_ID,
                pending_lifecycle_scripts: Vec::new(),
                direct_packages: &direct_packages,
                copy_trees: {
                    let self_contained = lockfile.self_contained_workspace_ids();
                    let mut set = Bitset::init_empty(trees_count)?;
                    if !self_contained.is_empty() {
                        for tid in 0..trees_count {
                            let owner = lockfile.owning_workspace_of_tree(tid as tree::Id);
                            if owner != 0 && self_contained.contains(&owner) {
                                set.set(tid);
                            }
                        }
                    }
                    set
                },
            };
        };

        installer.node_modules.path.push(SEP);

        let top_level_len =
            strings::without_trailing_slash(FileSystem::get().top_level_dir()).len() + 1;

        while let Some(node_modules) = iterator.next(Some(&mut installer.completed_trees)) {
            if installer.must_link_before(node_modules.tree_id) {
                link_deferred(&mut installer, log_level)?;
            }

            installer.node_modules.path.truncate(top_level_len);
            installer
                .node_modules
                .path
                .extend_from_slice(node_modules.relative_path.as_bytes());
            installer.node_modules.tree_id = node_modules.tree_id;
            let mut remaining: &[DependencyID] = node_modules.dependencies;
            installer.current_tree_id = node_modules.tree_id;
            installer.set_inside_replaced_folder(node_modules.tree_id);
            installer.set_outlived_root(node_modules.tree_id, node_modules.relative_path);

            // cache line is 64 bytes on ARM64 and x64
            // PackageIDs are 4 bytes
            // Hence, we can fit up to 64 / 4 = 16 package IDs in a cache line
            const UNROLL_COUNT: usize = 64 / core::mem::size_of::<PackageID>();

            while remaining.len() > UNROLL_COUNT {
                let mut i: usize = 0;
                while i < UNROLL_COUNT {
                    installer.install_package(remaining[i], log_level);
                    i += 1;
                }
                remaining = &remaining[UNROLL_COUNT..];

                // We want to minimize how often we call this function
                // That's part of why we unroll this loop
                if installer.manager.state.pending_task_count() > 0 {
                    run_tasks(Caller::HoistedLinker(&mut installer), true, log_level)?;
                    if !installer.manager.effective_do().install_packages() {
                        return Err(crate::Error::InstallFailed);
                    }
                }
                installer.manager.tick_lifecycle_scripts();
                installer.manager.report_slow_lifecycle_scripts();
            }

            for dependency_id in remaining {
                installer.install_package(*dependency_id, log_level);
            }

            run_tasks(Caller::HoistedLinker(&mut installer), true, log_level)?;
            if !installer.manager.effective_do().install_packages() {
                return Err(crate::Error::InstallFailed);
            }

            installer.manager.tick_lifecycle_scripts();
            installer.manager.report_slow_lifecycle_scripts();
        }

        loop {
            link_deferred(&mut installer, log_level)?;
            if installer.manager.state.pending_task_count() == 0
                || !installer.manager.effective_do().install_packages()
            {
                break;
            }
            run_tasks_until_done(&mut installer, None)?;
        }
        installer.deferred = None;
        installer.manager.tick_lifecycle_scripts();
        installer.manager.report_slow_lifecycle_scripts();

        // A tree never completes if one of its packages failed to download. Install everything
        // that was still waiting on it (force = true).
        installer.install_available_packages::<true>(log_level);
        // Every package is linked. The scripts that still have to run don't need the lock.
        installer.staging_lock = None;
        installer.tree_dir = None;

        installer.manager.state.finished_installing = true;
        if log_level.show_progress() {
            installer.manager.state.progress.activate(NodeId::Scripts);
        }

        if !installer.manager.effective_do().install_packages() {
            return Err(crate::Error::InstallFailed);
        }

        // need to make sure bins are linked before completing any remaining scripts.
        // this can happen if a package fails to download
        installer.link_remaining_bins();
        installer.complete_remaining_scripts(log_level);

        while installer.manager.state.active_lifecycle_script_count() > 0 {
            installer.manager.report_slow_lifecycle_scripts();

            installer.manager.sleep();
        }
        installer.link_bins_after_scripts();
        // Bin linking reads `successfully_installed`, so move it into the summary only afterwards.
        installer.summary.successfully_installed =
            Some(core::mem::take(&mut installer.successfully_installed));

        if log_level.show_progress() {
            installer.manager.state.progress.end_child(NodeId::Scripts);
        }
    }

    Ok(summary)
}
