use crate::lockfile::package::PackageColumns as _;
use core::sync::atomic::Ordering;

use bun_collections::{DynamicBitSet as Bitset, DynamicBitSetList, StringHashMap};
use bun_core::strings;
use bun_core::{Global, Output};
use bun_paths::SEP;
use bun_sys::{self as sys, Dir, Fd};

use crate::analytics;
use crate::bun_fs::FileSystem;
use crate::bun_progress::{Node as ProgressNode, Progress};

use crate::lockfile::tree;
use crate::{DependencyID, ExtractData, PackageID};
// Bring the `items_<field>{,_mut}()` column accessors for
// `MultiArrayList::Slice<Package>` into scope.
use crate::PackageManager;
#[cfg(unix)]
use crate::bin_real as bin;
use crate::package_install;
use crate::package_installer::{NodeModulesFolder, PackageInstaller, TreeContext};
use crate::package_manager::{self, WorkspaceFilter};
use crate::package_manager_real::ProgressStrings;
use crate::package_manager_real::run_tasks;
use crate::package_manager_task as Task;

/// `RunTasksCtx` for the hoisted-install loop: the installer owns access to
/// the manager for the pass.
impl run_tasks::RunTasksCtx for PackageInstaller<'_> {
    fn manager(&mut self) -> &mut PackageManager {
        self.manager
    }
    fn has_on_extract(&self) -> bool {
        true
    }
    fn is_package_installer(&self) -> bool {
        true
    }

    fn on_extract_package_installer(
        &mut self,
        task_id: Task::Id,
        dependency_id: DependencyID,
        data: &ExtractData,
        log_level: package_manager::Options::LogLevel,
    ) {
        self.grow_successfully_installed();
        self.install_enqueued_packages_after_extraction(task_id, dependency_id, data, log_level);
    }

    fn on_patch_applied(
        &mut self,
        install_context: &mut crate::patch_install::InstallContext,
        pkg_id: PackageID,
        pkg_name: bun_semver::String,
        log_level: package_manager::Options::LogLevel,
    ) {
        let path = core::mem::take(&mut install_context.path);
        self.node_modules.path = path;
        self.current_tree_id = install_context.tree_id;
        let resolution = self.manager.lockfile.packages.items_resolution()[pkg_id as usize];

        // Downloaded, so already known to need an install.
        let needs_verify = false;
        let is_pending_package_install = false;
        self.install_package_with_name_and_resolution(
            install_context.dependency_id,
            pkg_id,
            log_level,
            pkg_name,
            &resolution,
            needs_verify,
            is_pending_package_install,
        );
    }
}

pub(crate) fn install_hoisted_packages(
    this: &mut PackageManager,
    workspace_filters: &[WorkspaceFilter],
    install_root_dependencies: bool,
    log_level: package_manager::Options::LogLevel,
    packages_to_install: Option<&[PackageID]>,
) -> crate::Result<package_install::Summary> {
    analytics::features::hoisted_bun_install.fetch_add(1, Ordering::Relaxed);

    let original_trees = this.lockfile.buffers.trees.clone();
    let original_tree_dep_ids = this.lockfile.buffers.hoisted_dependencies.clone();

    let result = (|| {
        crate::lockfile::Lockfile::filter(
            this,
            install_root_dependencies,
            workspace_filters,
            packages_to_install,
        )?;
        install_filtered(this, log_level)
    })();

    // Restore-buffers: side-effecting rollback, not a free — `filter()`
    // rewrote the live trees in place.
    this.lockfile.buffers.trees = original_trees;
    this.lockfile.buffers.hoisted_dependencies = original_tree_dep_ids;

    result
}

fn install_filtered(
    this: &mut PackageManager,
    log_level: package_manager::Options::LogLevel,
) -> crate::Result<package_install::Summary> {
    let mut install_node: ProgressNode = ProgressNode::default();

    if log_level.show_progress() {
        let hoisted_len = this.lockfile.buffers.hoisted_dependencies.len();
        let progress = &mut this.progress;
        progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        let root_node = progress.start(b"", 0);
        let download_node = root_node.start(ProgressStrings::download(), 0);
        install_node = root_node.start(ProgressStrings::install(), hoisted_len);
        let scripts_node = root_node.start(ProgressStrings::script(), 0);
        this.downloads_node = Some(download_node);
        this.scripts_node = Some(scripts_node);
    }

    let result = install_with_progress(this, log_level, &mut install_node);

    if log_level.show_progress() {
        this.progress.root.end();
        this.progress = Progress::default();
    }
    this.scripts_node = None;
    this.downloads_node = None;

    result
}

fn install_with_progress(
    this: &mut PackageManager,
    log_level: package_manager::Options::LogLevel,
    install_node: &mut ProgressNode,
) -> crate::Result<package_install::Summary> {
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

    if this.options.enable.force_install() {
        skip_verify_installed_version_number = true;
        skip_delete = false;
    }

    let mut summary = package_install::Summary::default();

    {
        let mut iterator = tree::Cursor::<{ tree::IteratorPathStyle::NodeModules }>::new();

        #[cfg(unix)]
        {
            bin::Linker::ensure_umask();
        }

        let (completed_trees, tree_ids_to_trees_the_id_depends_on) = 'trees: {
            let trees = this.lockfile.buffers.trees.as_slice();
            let completed_trees = Bitset::init_empty(trees.len())?;
            let tree_ids_to_trees_the_id_depends_on =
                DynamicBitSetList::init_empty(trees.len(), trees.len())?;

            {
                // For each tree id, traverse through it's parents and mark all visited tree
                // ids as dependents for the current tree parent
                let mut deps = Bitset::init_empty(trees.len())?;
                for _curr in trees {
                    let mut curr = *_curr;
                    tree_ids_to_trees_the_id_depends_on.set(curr.id as usize, curr.id as usize);

                    while curr.parent != tree::Tree::INVALID_ID {
                        deps.set(curr.id as usize);
                        tree_ids_to_trees_the_id_depends_on
                            .set_union(curr.parent as usize, &deps.unmanaged);
                        curr = trees[curr.parent as usize];
                    }

                    deps.unmanaged.set_all(false);
                }
            }

            if cfg!(debug_assertions) {
                if trees.len() > 0 {
                    // last tree should only depend on one other
                    debug_assert!(
                        tree_ids_to_trees_the_id_depends_on
                            .at(trees.len() - 1)
                            .count()
                            == 1
                    );
                    // and it should be itself
                    debug_assert!(
                        tree_ids_to_trees_the_id_depends_on
                            .at(trees.len() - 1)
                            .is_set(trees.len() - 1)
                    );

                    // root tree should always depend on all trees
                    debug_assert!(tree_ids_to_trees_the_id_depends_on.at(0).count() == trees.len());
                }

                // a tree should always depend on itself
                for j in 0..trees.len() {
                    debug_assert!(tree_ids_to_trees_the_id_depends_on.at(j).is_set(j));
                }
            }

            break 'trees (completed_trees, tree_ids_to_trees_the_id_depends_on);
        };

        let force_install = this.options.enable.force_install();
        let pkg_len = this.lockfile.packages.len();
        let trees_count = this.lockfile.buffers.trees.len();
        let trusted_deps = this.find_trusted_dependencies_from_update_requests();
        let copy_trees = {
            let self_contained = this.lockfile.self_contained_workspace_ids();
            let mut set = Bitset::init_empty(trees_count)?;
            if !self_contained.is_empty() {
                for tid in 0..trees_count {
                    let owner = this.lockfile.owning_workspace_of_tree(tid as tree::Id);
                    if owner != 0 && self_contained.contains(&owner) {
                        set.set(tid);
                    }
                }
            }
            set
        };

        let mut installer = PackageInstaller {
            manager: this,
            root_node_modules_folder: node_modules_folder,
            node: install_node,
            node_modules: NodeModulesFolder {
                path: strings::without_trailing_slash(FileSystem::instance().top_level_dir())
                    .to_vec(),
                tree_id: 0,
            },
            skip_verify_installed_version_number,
            skip_delete,
            summary: &mut summary,
            force_install,
            successfully_installed: Bitset::init_empty(pkg_len)?,
            tree_ids_to_trees_the_id_depends_on,
            completed_trees,
            trees: (0..trees_count)
                .map(|_| TreeContext {
                    binaries: Vec::new(),
                    pending_installs: Vec::new(),
                    install_count: 0,
                })
                .collect(),
            trusted_dependencies_from_update_requests: trusted_deps,
            seen_bin_links: StringHashMap::<()>::default(),
            destination_dir_subpath_buf: bun_paths::PathBuffer::uninit(),
            folder_path_buf: bun_paths::PathBuffer::uninit(),
            current_tree_id: tree::INVALID_ID,
            pending_lifecycle_scripts: Vec::new(),
            copy_trees,
        };

        installer.node_modules.path.push(SEP);

        let top_level_len =
            strings::without_trailing_slash(FileSystem::instance().top_level_dir()).len() + 1;

        // Reused across folders: the dependency ids of the current
        // `node_modules`, copied out so the lockfile is free while installing.
        let mut dependencies: Vec<DependencyID> = Vec::new();
        while let Some(node_modules) = iterator.next(
            &installer.manager.lockfile,
            Some(&mut installer.completed_trees),
        ) {
            installer.node_modules.path.truncate(top_level_len);
            installer
                .node_modules
                .path
                .extend_from_slice(node_modules.relative_path.as_bytes());
            installer.node_modules.tree_id = node_modules.tree_id;
            installer.current_tree_id = node_modules.tree_id;
            dependencies.clear();
            dependencies.extend_from_slice(node_modules.dependencies);
            let mut remaining: &[DependencyID] = &dependencies;

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
                if installer.manager.pending_task_count() > 0 {
                    run_tasks::run_tasks(&mut installer, true, log_level)?;
                    if !installer.manager.options.do_.install_packages() {
                        return Err(crate::Error::InstallFailed);
                    }
                }
                PackageManager::tick_lifecycle_scripts(&mut installer);
                installer.manager.report_slow_lifecycle_scripts();
            }

            for dependency_id in remaining {
                installer.install_package(*dependency_id, log_level);
            }

            run_tasks::run_tasks(&mut installer, true, log_level)?;
            if !installer.manager.options.do_.install_packages() {
                return Err(crate::Error::InstallFailed);
            }

            PackageManager::tick_lifecycle_scripts(&mut installer);
            installer.manager.report_slow_lifecycle_scripts();
        }

        while installer.manager.pending_task_count() > 0
            && installer.manager.options.do_.install_packages()
        {
            let mut err: Option<crate::Error> = None;
            // Whenever the event loop wakes up, we need to call `run_tasks`
            // If we call sleep() instead of sleep_until(), it will wait forever until there are no more lifecycle scripts
            // which means it will not call run_tasks until _all_ current lifecycle scripts have finished running
            PackageManager::sleep_until(&mut installer, |installer| {
                if let Err(e) = run_tasks::run_tasks(installer, true, log_level) {
                    err = Some(e);
                    return true;
                }

                let manager = &mut *installer.manager;
                manager.report_slow_lifecycle_scripts();

                if PackageManager::verbose_install() && manager.pending_task_count() > 0 {
                    let pending_task_count = manager.pending_task_count();
                    if pending_task_count > 0
                        && manager.has_enough_time_passed_between_waiting_messages()
                    {
                        bun_core::pretty_errorln!(
                            "<d>[PackageManager]<r> waiting for {} tasks\n",
                            pending_task_count
                        );
                    }
                }

                manager.pending_task_count() == 0 && manager.has_no_more_pending_lifecycle_scripts()
            });

            if let Some(err) = err {
                return Err(err);
            }
        }
        PackageManager::tick_lifecycle_scripts(&mut installer);
        installer.manager.report_slow_lifecycle_scripts();

        for tree_idx in 0..installer.trees.len() {
            debug_assert!(installer.trees[tree_idx].pending_installs.len() == 0);
            // force = true
            installer.install_available_packages::<true>(log_level);
        }

        // .monotonic is okay because this value is only accessed on this thread.
        installer
            .manager
            .finished_installing
            .store(true, Ordering::Relaxed);
        if log_level.show_progress() {
            if let Some(n) = installer.manager.scripts_node_mut() {
                n.activate();
            }
        }

        if !installer.manager.options.do_.install_packages() {
            return Err(crate::Error::InstallFailed);
        }

        // `replace` with a fresh empty so `installer` stays whole
        // for the `link_remaining_bins` / `complete_remaining_scripts` calls
        // below. Route through `installer.summary` because `summary` itself is
        // exclusively borrowed by `installer` for this scope.
        {
            let taken = core::mem::replace(
                &mut installer.successfully_installed,
                Bitset::init_empty(0)?,
            );
            installer.summary.successfully_installed = Some(taken);
        }

        // need to make sure bins are linked before completing any remaining scripts.
        // this can happen if a package fails to download
        installer.link_remaining_bins(log_level);
        installer.complete_remaining_scripts(log_level);

        // .monotonic is okay because this value is only accessed on this thread.
        while installer
            .manager
            .pending_lifecycle_script_tasks
            .load(Ordering::Relaxed)
            > 0
        {
            installer.manager.report_slow_lifecycle_scripts();
            PackageManager::sleep_until(&mut installer, |installer| {
                installer.manager.has_no_more_pending_lifecycle_scripts()
            });
        }
        let this = &mut *installer.manager;

        if log_level.show_progress() {
            if let Some(n) = this.scripts_node_mut() {
                n.end();
            }
        }
    }

    Ok(summary)
}
