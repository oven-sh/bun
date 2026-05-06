use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_core::{Global, Output};
use bun_str::strings;
use bun_sys::{self as sys, Dir, Fd};
use bun_paths::SEP;
use bun_collections::{DynamicBitSet as Bitset, DynamicBitSetList, StringHashMap};

use crate::analytics;
use crate::bun_fs::FileSystem;
use crate::bun_progress::{Node as ProgressNode, Progress};
use crate::bun_bunfig::Arguments as Command;

use crate::{self as install, DependencyID, PackageID, RunTasksCallbacks};
use crate::lockfile::tree;
#[allow(unused_imports)]
use crate::bin_real as bin;
use crate::PackageManager;
use crate::package_manager::{self, WorkspaceFilter};
use crate::package_manager_real::{options::Do, ProgressStrings};
use crate::package_install;
use crate::package_installer::{NodeModulesFolder, PackageInstaller, TreeContext};

// TODO(port): narrow error set
pub fn install_hoisted_packages(
    this: &mut PackageManager,
    ctx: Command::Context,
    workspace_filters: &[WorkspaceFilter],
    install_root_dependencies: bool,
    log_level: package_manager::Options::LogLevel,
    packages_to_install: Option<&[PackageID]>,
) -> Result<package_install::Summary, bun_core::Error> {
    analytics::features::hoisted_bun_install.fetch_add(1, Ordering::Relaxed);

    // PORT NOTE: `defer { restore buffers }` (Zig:16) — side-effecting rollback,
    // not a free. Captures `*mut PackageManager` so the guard can write back
    // through the same provenance root the body uses (see `mgr_ptr` below).
    let mgr_ptr: *mut PackageManager = this;
    // SAFETY: `mgr_ptr` is freshly derived from the unique `&mut` fn param;
    // shadowing `this` with a reborrow through it makes every body access a
    // child of `mgr_ptr`, so the guard's later derefs keep provenance.
    let this = unsafe { &mut *mgr_ptr };

    let original_trees = core::mem::take(&mut this.lockfile.buffers.trees);
    let original_tree_dep_ids = core::mem::take(&mut this.lockfile.buffers.hoisted_dependencies);
    // Put them back immediately — Zig's `const original_* = buffers.*` is a
    // by-value copy of the ArrayList header (ptr/len/cap), leaving the buffer
    // live. Rust `Vec` can't alias like that, so the rollback below restores
    // the *taken* originals; `filter()` repopulates the live ones in-place.
    this.lockfile.buffers.trees = original_trees.clone();
    this.lockfile.buffers.hoisted_dependencies = original_tree_dep_ids.clone();

    {
        // PORT NOTE: reshaped for borrowck — Zig passes `this.log, this` (two
        // borrows of `this`). Snapshot the raw log ptr first; pass `mgr_ptr`
        // (raw) for the manager so `&mut this.lockfile` doesn't overlap a
        // simultaneous `&mut *this`.
        let log = this.log.map_or(core::ptr::null_mut(), |p| p.as_ptr());
        this.lockfile.filter(
            log,
            mgr_ptr,
            install_root_dependencies,
            workspace_filters,
            packages_to_install,
        )?;
    }

    let _restore_buffers = scopeguard::guard((), move |()| {
        // SAFETY: `mgr_ptr` is the provenance root for every body access to
        // `this` (see shadow-reborrow above); guard runs after all body
        // borrows have ended.
        let this = unsafe { &mut *mgr_ptr };
        this.lockfile.buffers.trees = original_trees;
        this.lockfile.buffers.hoisted_dependencies = original_tree_dep_ids;
    });

    let mut root_node: *mut ProgressNode = core::ptr::null_mut();
    let mut download_node: ProgressNode = ProgressNode::default();
    let mut install_node: ProgressNode = ProgressNode::default();
    let mut scripts_node: ProgressNode = ProgressNode::default();

    if log_level.show_progress() {
        let progress = &mut this.progress;
        progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        root_node = progress.start(b"", 0);
        // SAFETY: `root_node` was just set by `progress.start()` and is non-null
        // for the remainder of this `show_progress()` branch.
        download_node = unsafe { (*root_node).start(ProgressStrings::download(), 0) };
        // SAFETY: same `root_node` validity as above.
        install_node = unsafe {
            (*root_node).start(
                ProgressStrings::install(),
                this.lockfile.buffers.hoisted_dependencies.len(),
            )
        };
        // SAFETY: same `root_node` validity as above.
        scripts_node = unsafe { (*root_node).start(ProgressStrings::script(), 0) };
        this.downloads_node = Some(&mut download_node);
        this.scripts_node = NonNull::new(&mut scripts_node);
        // TODO(port): storing pointers to stack locals into `this` — Phase B must reshape
        // (move nodes into PackageManager or thread lifetimes).
    }

    // PORT NOTE: `defer { progress.root.end(); progress = .{} }`
    let _end_progress = scopeguard::guard(log_level, move |log_level| {
        if log_level.show_progress() {
            // SAFETY: `mgr_ptr` provenance — see `_restore_buffers` note.
            let this = unsafe { &mut *mgr_ptr };
            this.progress.root.end();
            this.progress = Progress::default();
        }
    });

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
                Output::err(err, "could not create the <b>\"node_modules\"<r> directory", ());
                Global::crash();
            }
        }
        match sys::open_dir(Dir::from_fd(cwd), b"node_modules") {
            Ok(dir) => break 'brk dir,
            Err(err) => {
                Output::err(err, "could not open the <b>\"node_modules\"<r> directory", ());
                Global::crash();
            }
        }
    };

    let mut skip_delete = new_node_modules;
    let mut skip_verify_installed_version_number = new_node_modules;

    if this.options.enable.force_install {
        skip_verify_installed_version_number = true;
        skip_delete = false;
    }

    let mut summary = package_install::Summary::default();

    {
        #[cfg(unix)]
        {
            bin::Linker::ensure_umask();
        }

        let mut installer: PackageInstaller = 'brk: {
            let (completed_trees, tree_ids_to_trees_the_id_depends_on) = 'trees: {
                let trees = this.lockfile.buffers.trees.as_slice();
                let completed_trees = Bitset::init_empty(trees.len())?;
                let mut tree_ids_to_trees_the_id_depends_on =
                    DynamicBitSetList::init_empty(trees.len(), trees.len())?;

                {
                    // For each tree id, traverse through it's parents and mark all visited tree
                    // ids as dependents for the current tree parent
                    let mut deps = Bitset::init_empty(trees.len())?;
                    for _curr in trees {
                        let mut curr = *_curr;
                        tree_ids_to_trees_the_id_depends_on
                            .set(curr.id as usize, curr.id as usize);

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
                            tree_ids_to_trees_the_id_depends_on.at(trees.len() - 1).count() == 1
                        );
                        // and it should be itself
                        debug_assert!(
                            tree_ids_to_trees_the_id_depends_on
                                .at(trees.len() - 1)
                                .is_set(trees.len() - 1)
                        );

                        // root tree should always depend on all trees
                        debug_assert!(
                            tree_ids_to_trees_the_id_depends_on.at(0).count() == trees.len()
                        );
                    }

                    // a tree should always depend on itself
                    for j in 0..trees.len() {
                        debug_assert!(tree_ids_to_trees_the_id_depends_on.at(j).is_set(j));
                    }
                }

                break 'trees (completed_trees, tree_ids_to_trees_the_id_depends_on);
            };

            // These slices potentially get resized during iteration
            // so we want to make sure they're not accessible to the rest of this function
            // to make mistakes harder
            let parts = this.lockfile.packages.slice();
            // Hoist the by-value reads out of the struct literal so they
            // finish before the long-lived `&mut *mgr_ptr` borrow for
            // `manager` begins (struct fields evaluate in source order).
            let force_install = this.options.enable.force_install;
            let pkg_len = this.lockfile.packages.len();
            let trees_count = this.lockfile.buffers.trees.len();
            let trusted_deps = this.find_trusted_dependencies_from_update_requests();
            // PORT NOTE: spec reads MultiArrayList column ptrs out of `parts`
            // and stuffs them into `PackageInstaller`. The stub `PackageList`
            // columns are typed against `crate::lockfile` (`bin::Bin`,
            // `package::Meta`) but `PackageInstaller`'s slice fields are typed
            // against `lockfile_real` (`bin_real::Bin`, `lockfile_real::
            // package::Meta`). Until the two `Lockfile` shapes unify
            // (reconciler-6) those slices cannot be borrowed across; defer the
            // construction of those fields.
            let _ = parts;

            // SAFETY: `mgr_ptr` is the provenance root for every `this` access
            // in this fn (see shadow-reborrow at top). `PackageInstaller`
            // stores `&'a mut PackageManager` (Zig: non-exclusive `*PM`); the
            // body below also reborrows `*mgr_ptr` for `pending_task_count` /
            // `run_tasks` / lifecycle ticks. Under Stacked Borrows the
            // installer's `&mut` and those reborrows alias — Phase B must
            // retype `PackageInstaller.manager` as `*mut PackageManager`
            // (LIFETIMES.tsv: BACKREF). For now derive both from `mgr_ptr` so
            // the code compiles with the spec's call shape intact.
            break 'brk PackageInstaller {
                manager: unsafe { &mut *mgr_ptr },
                // TODO(port): blocked_on lockfile stub/real unification
                // (reconciler-6) — `PackageInstaller::{options, lockfile,
                // metas, bins, names, pkg_name_hashes, resolutions,
                // pkg_dependencies}` are typed against `lockfile_real` /
                // `package_manager_real::Options`, but `this` carries the stub
                // shapes. The Zig spec just aliases pointers; Rust needs the
                // types to agree.
                options: todo!("blocked_on: reconciler-6 — stub PackageManager.options vs package_manager_real::Options"),
                metas: todo!("blocked_on: reconciler-6 — stub PackageList::meta vs lockfile_real::package::Meta"),
                bins: todo!("blocked_on: reconciler-6 — stub PackageList::bin vs bin_real::Bin"),
                names: todo!("blocked_on: reconciler-6 — stub PackageList::name vs lockfile_real column"),
                pkg_name_hashes: todo!("blocked_on: reconciler-6 — stub PackageList::name_hash column"),
                resolutions: todo!("blocked_on: reconciler-6 — stub PackageList::resolution (&mut) column"),
                pkg_dependencies: todo!("blocked_on: reconciler-6 — stub PackageList::dependencies column"),
                lockfile: todo!("blocked_on: reconciler-6 — stub Lockfile vs lockfile_real::Lockfile"),
                root_node_modules_folder: node_modules_folder,
                node: &mut install_node,
                node_modules: NodeModulesFolder {
                    path: strings::without_trailing_slash(FileSystem::instance().top_level_dir())
                        .to_vec(),
                    tree_id: 0,
                },
                // SAFETY: same `mgr_ptr` BACKREF note as `manager` above —
                // `&Progress` aliases the `&mut PackageManager` in `manager`;
                // Phase B retypes one of them to a raw ptr.
                progress: unsafe { &(*mgr_ptr).progress },
                skip_verify_installed_version_number,
                skip_delete,
                summary: &mut summary,
                force_install,
                successfully_installed: Bitset::init_empty(pkg_len)?,
                command_ctx: ctx,
                tree_ids_to_trees_the_id_depends_on,
                completed_trees,
                trees: 'trees: {
                    let mut trees: Vec<TreeContext> = Vec::with_capacity(trees_count);
                    for _i in 0..trees_count {
                        trees.push(TreeContext {
                            // TODO(port): blocked_on reconciler-6 —
                            // `TreeContext.binaries` is `bin::PriorityQueue
                            // <'static>` but the queue context borrows
                            // `&this.lockfile.buffers.{dependencies,
                            // string_bytes}`. Zig stores raw `*ArrayList`
                            // pointers (no lifetime); the Rust field needs the
                            // queue to be `<'a>` once `PackageInstaller<'a>`
                            // threads through.
                            binaries: todo!("blocked_on: reconciler-6 — bin::PriorityQueue<'static> vs lockfile-borrowed context"),
                            pending_installs: Vec::new(),
                            install_count: 0,
                        });
                    }
                    break 'trees trees.into_boxed_slice();
                },
                trusted_dependencies_from_update_requests: trusted_deps,
                seen_bin_links: StringHashMap::<()>::default(),
                destination_dir_subpath_buf: bun_paths::PathBuffer::uninit(),
                folder_path_buf: bun_paths::PathBuffer::uninit(),
                current_tree_id: 0,
                pending_lifecycle_scripts: Vec::new(),
            };
        };

        installer.node_modules.path.push(SEP);

        // `defer installer.deinit()` — handled by Drop.

        // Re-derive `this` from the raw root so post-construction accesses
        // don't trip "use of moved value" on the borrow handed to
        // `installer.manager`. SAFETY: see the BACKREF note on the
        // `PackageInstaller { manager: ... }` initialiser above.
        let this = unsafe { &mut *mgr_ptr };

        // PORT NOTE: `Lockfile.Tree.Iterator(.node_modules).init(this.lockfile)`.
        // The real iterator (`lockfile_real::tree::Iterator`) is typed against
        // `lockfile_real::Lockfile`; the stub `this.lockfile` cannot satisfy
        // that borrow yet (reconciler-6). Iterate the stub `buffers.trees`
        // directly so the dependency-install loop below still type-checks.
        let trees_snapshot = this.lockfile.buffers.trees.len();
        let mut tree_id: u32 = 0;
        while (tree_id as usize) < trees_snapshot {
            // TODO(port): blocked_on reconciler-6 — replace with
            // `lockfile_real::tree::Iterator::<{NodeModules}>::init(...)` once
            // `this.lockfile` is the real `Lockfile`. The stub iteration below
            // mirrors the spec's per-tree loop shape so the body compiles.
            let node_modules_tree = this.lockfile.buffers.trees[tree_id as usize];
            let dep_slice = node_modules_tree.dependencies;
            if dep_slice.len == 0 {
                installer.completed_trees.set(tree_id as usize);
                tree_id += 1;
                continue;
            }
            let hoisted = this.lockfile.buffers.hoisted_dependencies.as_slice();
            let remaining_all: &[DependencyID] = dep_slice.get(hoisted);

            installer.node_modules.path.truncate(
                strings::without_trailing_slash(FileSystem::instance().top_level_dir()).len() + 1,
            );
            // TODO(port): blocked_on reconciler-6 — `relative_path` comes from
            // `tree::relative_path_and_depth` over the real lockfile; the stub
            // path-builder is the no-op in `crate::lockfile::tree`.
            installer.node_modules.tree_id = tree_id;
            installer.current_tree_id = tree_id;
            let mut remaining = remaining_all;

            // cache line is 64 bytes on ARM64 and x64
            // PackageIDs are 4 bytes
            // Hence, we can fit up to 64 / 4 = 16 package IDs in a cache line
            const UNROLL_COUNT: usize = 64 / core::mem::size_of::<PackageID>();

            while remaining.len() > UNROLL_COUNT {
                // PERF(port): was `inline while` manual unroll — profile in Phase B.
                let mut i: usize = 0;
                while i < UNROLL_COUNT {
                    installer.install_package(remaining[i], log_level);
                    i += 1;
                }
                remaining = &remaining[UNROLL_COUNT..];

                // We want to minimize how often we call this function
                // That's part of why we unroll this loop
                if this.pending_task_count() > 0 {
                    this.run_tasks(
                        &mut installer,
                        RunTasksCallbacks {
                            on_extract:
                                PackageInstaller::install_enqueued_packages_after_extraction,
                            on_resolve: (),
                            on_package_manifest_error: (),
                            on_package_download_error: (),
                            progress_bar: false,
                            manifests_only: false,
                        },
                        true,
                        log_level,
                    )?;
                    if !installer.options.do_.contains(Do::INSTALL_PACKAGES) {
                        return Err(bun_core::err!("InstallFailed"));
                    }
                }
                this.tick_lifecycle_scripts();
                this.report_slow_lifecycle_scripts();
            }

            for dependency_id in remaining {
                installer.install_package(*dependency_id, log_level);
            }

            this.run_tasks(
                &mut installer,
                RunTasksCallbacks {
                    on_extract: PackageInstaller::install_enqueued_packages_after_extraction,
                    on_resolve: (),
                    on_package_manifest_error: (),
                    on_package_download_error: (),
                    progress_bar: false,
                    manifests_only: false,
                },
                true,
                log_level,
            )?;
            if !installer.options.do_.contains(Do::INSTALL_PACKAGES) {
                return Err(bun_core::err!("InstallFailed"));
            }

            this.tick_lifecycle_scripts();
            this.report_slow_lifecycle_scripts();

            tree_id += 1;
        }

        while this.pending_task_count() > 0
            && installer.options.do_.contains(Do::INSTALL_PACKAGES)
        {
            struct Closure<'a, 'b> {
                installer: &'a mut PackageInstaller<'b>,
                err: Option<bun_core::Error>,
                // PORT NOTE: raw `*mut` (Zig `*PackageManager`) — `sleep_until`
                // also receives this pointer, so `&mut` here would alias.
                manager: *mut PackageManager,
            }

            impl<'a, 'b> Closure<'a, 'b> {
                pub fn is_done(closure: &mut Self) -> bool {
                    // SAFETY: `closure.manager` is the raw provenance root set
                    // below; `sleep_until`/`tick_raw` hold no `&mut` across
                    // this callback, so this is the unique live borrow.
                    let manager = unsafe { &mut *closure.manager };
                    let log_level = manager.options.log_level;
                    if let Err(err) = manager.run_tasks(
                        closure.installer,
                        RunTasksCallbacks {
                            on_extract:
                                PackageInstaller::install_enqueued_packages_after_extraction,
                            on_resolve: (),
                            on_package_manifest_error: (),
                            on_package_download_error: (),
                            progress_bar: false,
                            manifests_only: false,
                        },
                        true,
                        log_level,
                    ) {
                        closure.err = Some(err);
                    }

                    if closure.err.is_some() {
                        return true;
                    }

                    manager.report_slow_lifecycle_scripts();

                    if PackageManager::verbose_install() && manager.pending_task_count() > 0 {
                        let pending_task_count = manager.pending_task_count();
                        if pending_task_count > 0
                            && PackageManager::has_enough_time_passed_between_waiting_messages()
                        {
                            Output::pretty_errorln(format_args!(
                                "<d>[PackageManager]<r> waiting for {} tasks\n",
                                pending_task_count
                            ));
                        }
                    }

                    manager.pending_task_count() == 0
                        && manager.has_no_more_pending_lifecycle_scripts()
                }
            }

            // Derive the raw provenance root *before* building the closure so
            // both `sleep_until`'s `this` arg and `closure.manager` share the
            // same SRW tag (Zig spec stores `*PackageManager` non-exclusively).
            let mgr: *mut PackageManager = mgr_ptr;
            let mut closure = Closure { installer: &mut installer, err: None, manager: mgr };

            // Whenever the event loop wakes up, we need to call `runTasks`
            // If we call sleep() instead of sleepUntil(), it will wait forever until there are no more lifecycle scripts
            // which means it will not call runTasks until _all_ current lifecycle scripts have finished running
            // SAFETY: `mgr` is derived from the live exclusive `this` borrow;
            // `sleep_until` + `tick_raw` hold no `&mut PackageManager` across
            // `Closure::is_done`, so the callback's `&mut *closure.manager`
            // is the unique live borrow.
            unsafe { PackageManager::sleep_until(mgr, &mut closure, Closure::is_done) };

            if let Some(err) = closure.err {
                return Err(err);
            }
        }
        // PORT NOTE: Zig `while ... else { ... }` — else runs when the condition becomes false (no break in body).
        this.tick_lifecycle_scripts();
        this.report_slow_lifecycle_scripts();

        for tree in installer.trees.iter() {
            if cfg!(debug_assertions) {
                debug_assert!(tree.pending_installs.len() == 0);
            }
            // force = true
            installer.install_available_packages::<true>(log_level);
        }

        // .monotonic is okay because this value is only accessed on this thread.
        this.finished_installing.store(true, Ordering::Relaxed);
        if log_level.show_progress() {
            scripts_node.activate();
        }

        if !installer.options.do_.contains(Do::INSTALL_PACKAGES) {
            return Err(bun_core::err!("InstallFailed"));
        }

        summary.successfully_installed = Some(installer.successfully_installed);

        // need to make sure bins are linked before completing any remaining scripts.
        // this can happen if a package fails to download
        installer.link_remaining_bins(log_level);
        installer.complete_remaining_scripts(log_level);

        // .monotonic is okay because this value is only accessed on this thread.
        while this.pending_lifecycle_script_tasks.load(Ordering::Relaxed) > 0 {
            this.report_slow_lifecycle_scripts();

            this.sleep();
        }

        if log_level.show_progress() {
            scripts_node.end();
        }
    }

    Ok(summary)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/hoisted_install.zig (380 lines)
//   confidence: low
//   todos:      reconciler-6 lockfile/options unification gates the
//               `PackageInstaller` field borrows and the real
//               `Tree::Iterator(.node_modules)` walk
// ──────────────────────────────────────────────────────────────────────────
