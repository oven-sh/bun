use crate::lockfile::package::PackageColumns as _;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_collections::{DynamicBitSet as Bitset, DynamicBitSetList, StringHashMap};
use bun_core::strings;
use bun_core::{Global, Output};
use bun_paths::SEP;
use bun_sys::{self as sys, Dir, Fd};

use crate::analytics;
use crate::bun_bunfig::Arguments as Command;
use crate::bun_fs::FileSystem;
use crate::bun_progress::{Node as ProgressNode, Progress};

use crate::lockfile::tree;
use crate::{DependencyID, ExtractData, PackageID};
// Bring the `items_<field>{,_mut}()` column accessors for
// `MultiArrayList::Slice<Package>` into scope.
use crate::PackageManager;
use crate::bin_real as bin;
use crate::package_install;
use crate::package_installer::{DeferredLinks, NodeModulesFolder, PackageInstaller, TreeContext};
use crate::package_manager::{self, WorkspaceFilter};
use crate::package_manager_real::ProgressStrings;
use crate::package_manager_real::run_tasks;
use crate::package_manager_task as Task;
use crate::prune::LinkedNodeModules;

/// `RunTasksCallbacks` impl for the hoisted-install loop, with
/// `Ctx == PackageInstaller`.
pub(crate) struct HoistedRunTasksCallbacks<'a>(core::marker::PhantomData<&'a mut ()>);

impl<'a> run_tasks::RunTasksCallbacks for HoistedRunTasksCallbacks<'a> {
    type Ctx = PackageInstaller<'a>;

    const HAS_ON_EXTRACT: bool = true;
    const IS_PACKAGE_INSTALLER: bool = true;

    fn on_extract_package_installer(
        ctx: &mut Self::Ctx,
        task_id: Task::Id,
        dependency_id: DependencyID,
        data: &mut ExtractData,
        log_level: package_manager::Options::LogLevel,
    ) {
        ctx.install_enqueued_packages_after_extraction(task_id, dependency_id, &*data, log_level);
    }
}

/// Restores the trees that `Lockfile::filter` replaced for the install pass, and ends the progress
/// bar.
struct RestoreManager {
    manager: *mut PackageManager,
    trees: Vec<tree::Tree>,
    hoisted_dependencies: Vec<DependencyID>,
    log_level: package_manager::Options::LogLevel,
}

impl Drop for RestoreManager {
    fn drop(&mut self) {
        // SAFETY: `manager` is the provenance root for every access of
        // `install_hoisted_packages` to its `this`; this runs after all of
        // its borrows have ended.
        let this = unsafe { &mut *self.manager };
        if self.log_level.show_progress() {
            this.progress.root.end();
            this.progress = Progress::default();
        }
        // The progress-node pointers target stack locals of `install_hoisted_packages`.
        this.scripts_node = None;
        this.downloads_node = None;
        this.lockfile.buffers.trees = core::mem::take(&mut self.trees);
        this.lockfile.buffers.hoisted_dependencies =
            core::mem::take(&mut self.hoisted_dependencies);
    }
}

/// Runs tasks whenever the event loop wakes up, until `links` is 0 or (`None`) nothing is pending or links wait.
fn run_tasks_until_done(
    mgr: *mut PackageManager,
    installer: &mut PackageInstaller<'_>,
    links: Option<&AtomicUsize>,
) -> crate::Result<()> {
    struct Closure<'a, 'b> {
        installer: &'a mut PackageInstaller<'b>,
        err: Option<crate::Error>,
        // raw `*mut` — `sleep_until` also receives this pointer, so `&mut` here would alias.
        manager: *mut PackageManager,
        links: Option<&'a AtomicUsize>,
    }

    impl<'a, 'b> Closure<'a, 'b> {
        fn is_done(closure: &mut Self) -> bool {
            // SAFETY: `closure.manager` is the raw provenance root set
            // below; `sleep_until`/`tick_raw` hold no `&mut` across
            // this callback, so this is the unique live borrow.
            let manager = unsafe { &mut *closure.manager };
            let log_level = manager.options.log_level;
            if let Err(err) = run_tasks::run_tasks::<HoistedRunTasksCallbacks>(
                manager,
                closure.installer,
                true,
                log_level,
            ) {
                closure.err = Some(err);
                return true;
            }

            // A script that has ended makes room for one that waits.
            closure.installer.run_available_scripts(log_level);
            manager.report_slow_lifecycle_scripts();

            let pending_task_count = manager.pending_task_count();
            if pending_task_count > 0
                && PackageManager::verbose_install()
                && PackageManager::has_enough_time_passed_between_waiting_messages()
            {
                bun_core::pretty_errorln!(
                    "<d>[PackageManager]<r> waiting for {} tasks\n",
                    pending_task_count
                );
            }

            match closure.links {
                Some(links) => links.load(Ordering::Acquire) == 0,
                None => {
                    closure.installer.has_deferred_links()
                        || (manager.pending_task_count() == 0
                            && manager.has_no_more_pending_lifecycle_scripts())
                }
            }
        }
    }

    let mut closure = Closure {
        installer,
        err: None,
        manager: mgr,
        links,
    };

    // Whenever the event loop wakes up, we need to call `run_tasks`
    // If we call sleep() instead of sleep_until(), it will wait forever until there are no more lifecycle scripts
    // which means it will not call run_tasks until _all_ current lifecycle scripts have finished running
    // SAFETY: `mgr` is the caller's provenance root for its live exclusive borrow;
    // `sleep_until` + `tick_raw` hold no `&mut PackageManager` across
    // `Closure::is_done`, so the callback's `&mut *closure.manager`
    // is the unique live borrow.
    unsafe { PackageManager::sleep_until(mgr, &mut closure, Closure::is_done) };

    closure.err.map_or(Ok(()), Err)
}

/// Has the thread pool link the waiting packages, including the ones that start waiting in the
/// meantime. Must not be called from inside `run_tasks`.
fn link_deferred(
    mgr: *mut PackageManager,
    installer: &mut PackageInstaller<'_>,
    log_level: package_manager::Options::LogLevel,
) -> crate::Result<()> {
    while let Some((links, events)) = installer.take_deferred_links() {
        // Tasks that were already started keep running while the pool links.
        let mut ran_tasks = Ok(());
        links.run(&mut |until| {
            if ran_tasks.is_ok() {
                ran_tasks = run_tasks_until_done(mgr, installer, Some(until));
            }
        });
        ran_tasks?;
        if !installer.manager().options.do_.install_packages() {
            return Err(crate::Error::InstallFailed);
        }
        installer.finish_links(links, events, log_level);
    }
    Ok(())
}

pub(crate) fn install_hoisted_packages(
    this: &mut PackageManager,
    ctx: Command::Context,
    workspace_filters: &[WorkspaceFilter],
    install_root_dependencies: bool,
    log_level: package_manager::Options::LogLevel,
    packages_to_install: Option<&[PackageID]>,
) -> crate::Result<package_install::Summary> {
    analytics::features::hoisted_bun_install.fetch_add(1, Ordering::Relaxed);

    let mgr_ptr: *mut PackageManager = this;
    // SAFETY: `mgr_ptr` is freshly derived from the unique `&mut` fn param;
    // shadowing `this` with a reborrow through it makes every body access a
    // child of `mgr_ptr`, so the guard's later derefs keep provenance.
    let this = unsafe { &mut *mgr_ptr };

    // `filter()` repopulates the live ones in-place.
    let original_trees = this.lockfile.buffers.trees.clone();
    let original_tree_dep_ids = this.lockfile.buffers.hoisted_dependencies.clone();

    let places = {
        // `lockfile` is `Box<Lockfile>` so the heap object
        // is disjoint from the `PackageManager` struct; snapshot raw `*mut
        // Lockfile` and `*mut Log` first so `filter` can hold `&mut Lockfile`
        // and `&mut PackageManager` simultaneously through `mgr_ptr`'s
        // provenance root.
        let log: *mut bun_ast::Log = this.log;
        // SAFETY: `mgr_ptr` is the provenance root; `lockfile` is heap-owned
        // via `Box`, so `*mut Lockfile` does not overlap `*mut PackageManager`.
        let lockfile_ptr: *mut crate::lockfile::Lockfile = unsafe { &raw mut *(*mgr_ptr).lockfile };
        // SAFETY: `log` is the always-live logger backref (never null);
        // `mgr_ptr` see shadow-reborrow above.
        unsafe {
            (*lockfile_ptr)
                .filter(
                    &mut *log,
                    &mut *mgr_ptr,
                    install_root_dependencies,
                    workspace_filters,
                    packages_to_install,
                )?
                .places
        }
    };
    // SAFETY: `mgr_ptr` is the provenance root derived from the unique `&mut`
    // fn param; the first reborrow's tag was popped by `&mut *mgr_ptr` in the
    // block above, so no other borrow of `*mgr_ptr` is live here.
    let this = unsafe { &mut *mgr_ptr };

    let mut download_node: ProgressNode;
    let mut install_node: ProgressNode = ProgressNode::default();
    let mut scripts_node: ProgressNode;

    if log_level.show_progress() {
        let hoisted_len = this.lockfile.buffers.hoisted_dependencies.len();
        let progress = &mut this.progress;
        progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        let root_node = progress.start(b"", 0);
        download_node = root_node.start(ProgressStrings::download(), 0);
        install_node = root_node.start(ProgressStrings::install(), hoisted_len);
        scripts_node = root_node.start(ProgressStrings::script(), 0);
        // These are stack locals of this frame. `_restore_manager` clears the pointers before the
        // function returns.
        this.downloads_node = Some(core::ptr::addr_of_mut!(download_node));
        this.scripts_node = NonNull::new(&raw mut scripts_node);
    }

    // Declared after the nodes, so that it ends the progress bar while they're still alive.
    let _restore_manager = RestoreManager {
        manager: mgr_ptr,
        trees: original_trees,
        hoisted_dependencies: original_tree_dep_ids,
        log_level,
    };

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
        // SAFETY: `mgr_ptr` is the provenance root; `lockfile` is heap-owned
        // via `Box`, so deref the Box for the heap addr.
        let lockfile_ptr: *mut crate::lockfile::Lockfile = unsafe { &raw mut *(*mgr_ptr).lockfile };
        // BACKREF — outlives this install pass; `PackageInstaller` reaches `this` at the same time.
        let lockfile_ref = bun_ptr::BackRef::<crate::lockfile::Lockfile>::from(
            core::ptr::NonNull::new(lockfile_ptr).expect("lockfile BACKREF non-null"),
        );

        // `filter()` (the only mutator of these buffers) has already run.
        let mut iterator = tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::from_slices(
            lockfile_ref.buffers.trees.as_slice(),
            lockfile_ref.buffers.hoisted_dependencies.as_slice(),
            lockfile_ref.buffers.dependencies.as_slice(),
            lockfile_ref.buffers.string_bytes.as_slice(),
        );

        // Outlives `installer`, whose bin queues point at it.
        let direct_packages = bin::LinkOrder::direct_packages(&lockfile_ref)?;

        let mut installer: PackageInstaller = 'brk: {
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

                break 'trees (completed_trees, tree_ids_to_trees_the_id_depends_on);
            };

            // These slices potentially get resized during iteration
            // so we want to make sure they're not accessible to the rest of this function
            // to make mistakes harder
            //
            // RawSlice invariant: on growth `fix_cached_lockfile_package_slices` re-snapshots.
            let parts = lockfile_ref.packages.slice();
            let metas = bun_ptr::RawSlice::new(parts.items_meta());
            let bins = bun_ptr::RawSlice::new(parts.items_bin());
            let names = bun_ptr::RawSlice::new(parts.items_name());
            let pkg_name_hashes = bun_ptr::RawSlice::new(parts.items_name_hash());
            let resolutions = bun_ptr::RawSlice::new(parts.items_resolution());

            let pkg_len = this.lockfile.packages.len();
            let trees_count = this.lockfile.buffers.trees.len();
            let trusted_deps = this.find_trusted_dependencies_from_update_requests();

            break 'brk PackageInstaller {
                manager: mgr_ptr,
                metas,
                bins,
                names,
                pkg_name_hashes,
                resolutions,
                lockfile: lockfile_ptr,
                root_node_modules_folder: node_modules_folder,
                staging_lock: None,
                tree_dir: None,
                // Disabled on Windows, where the hardlink backend has its own queue. A batch keeps
                // up to 64 directories open.
                deferred: (cfg!(not(windows)) && !FileSystem::instance().fs.need_to_close_files())
                    .then(|| DeferredLinks::init(&lockfile_ref)),
                node: &mut install_node,
                node_modules: NodeModulesFolder {
                    path: strings::without_trailing_slash(FileSystem::instance().top_level_dir())
                        .to_vec(),
                    tree_id: 0,
                },
                // SAFETY: `mgr_ptr` is the provenance root; raw place addr.
                progress: unsafe { core::ptr::addr_of_mut!((*mgr_ptr).progress) },
                skip_verify_installed_version_number,
                skip_delete,
                workspaces_seen: Vec::new(),
                summary: &mut summary,
                successfully_installed: Bitset::init_empty(pkg_len)?,
                command_ctx: ctx,
                tree_ids_to_trees_the_id_depends_on,
                completed_trees,
                pending_install_count: 0,
                trees: 'trees: {
                    let mut trees: Vec<TreeContext> = Vec::with_capacity(trees_count);
                    for _i in 0..trees_count {
                        trees.push(TreeContext {
                            binaries: bin::PriorityQueue::init(bin::PriorityQueueContext {
                                lockfile: lockfile_ref,
                                direct_packages: bun_ptr::BackRef::new(&direct_packages),
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
                unfinished_scripts: Default::default(),
                copy_trees: {
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
                },
            };
        };

        installer.node_modules.path.push(SEP);

        let top_level_len =
            strings::without_trailing_slash(FileSystem::instance().top_level_dir()).len() + 1;

        while let Some(node_modules) = iterator.next(Some(&mut installer.completed_trees)) {
            if installer.must_link_before(node_modules.tree_id) {
                link_deferred(mgr_ptr, &mut installer, log_level)?;
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
                if this.pending_task_count() > 0 {
                    run_tasks::run_tasks::<HoistedRunTasksCallbacks>(
                        this,
                        &mut installer,
                        true,
                        log_level,
                    )?;
                    if !this.options.do_.install_packages() {
                        return Err(crate::Error::InstallFailed);
                    }
                }
                this.tick_lifecycle_scripts();
                this.report_slow_lifecycle_scripts();
            }

            for dependency_id in remaining {
                installer.install_package(*dependency_id, log_level);
            }

            run_tasks::run_tasks::<HoistedRunTasksCallbacks>(
                this,
                &mut installer,
                true,
                log_level,
            )?;
            if !this.options.do_.install_packages() {
                return Err(crate::Error::InstallFailed);
            }

            this.tick_lifecycle_scripts();
            this.report_slow_lifecycle_scripts();
        }

        loop {
            link_deferred(mgr_ptr, &mut installer, log_level)?;
            if this.pending_task_count() == 0 || !this.options.do_.install_packages() {
                break;
            }
            run_tasks_until_done(mgr_ptr, &mut installer, None)?;
        }
        installer.deferred = None;
        this.tick_lifecycle_scripts();
        this.report_slow_lifecycle_scripts();

        // A tree never completes if one of its packages failed to download. Install everything
        // that was still waiting on it (force = true).
        installer.install_available_packages::<true>(log_level);
        // Every package is linked. The scripts that still have to run don't need the lock.
        installer.staging_lock = None;
        installer.tree_dir = None;

        // .monotonic is okay because this value is only accessed on this thread.
        this.finished_installing.store(true, Ordering::Relaxed);
        if log_level.show_progress() {
            // Route through the stored `NonNull` (set above) instead of
            // re-borrowing the `scripts_node` local directly: under Stacked
            // Borrows a fresh `&mut local` here would invalidate the raw
            // pointer that lifecycle-script callbacks dereference via
            // `scripts_node_mut()` while we drain below.
            if let Some(n) = this.scripts_node_mut() {
                n.activate();
            }
        }

        if !this.options.do_.install_packages() {
            return Err(crate::Error::InstallFailed);
        }

        // need to make sure bins are linked before completing any remaining scripts.
        // this can happen if a package fails to download
        installer.link_remaining_bins();
        installer.complete_remaining_scripts(log_level);

        // .monotonic is okay because this value is only accessed on this thread.
        while this.pending_lifecycle_script_tasks.load(Ordering::Relaxed) > 0 {
            this.report_slow_lifecycle_scripts();

            this.sleep();
        }
        // Still listed: a package that waited for scripts inside its folder, or never ran its own.
        crate::package_installer::discard_unfinished_packages(
            &lockfile_ref,
            &installer.unfinished_scripts,
        );
        installer.link_bins_after_scripts();
        // Bin linking reads `successfully_installed`, so move it into the summary only afterwards.
        installer.summary.successfully_installed =
            Some(core::mem::take(&mut installer.successfully_installed));

        if log_level.show_progress() {
            // See `activate()` note above — reuse the stored `NonNull`'s
            // provenance instead of re-borrowing the stack local.
            if let Some(n) = this.scripts_node_mut() {
                n.end();
            }
        }
    }

    Ok(summary)
}
