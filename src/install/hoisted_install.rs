use core::sync::atomic::Ordering;

use bun_core::{Global, Output, Progress};
use bun_core::analytics; // TODO(port): verify crate path for `bun.analytics`
use bun_str::strings;
use bun_sys::{self as sys, Fd};
use bun_paths::SEP;
use bun_collections::{DynamicBitSet as Bitset, StringHashMap};

use bun_cli::Command;
use bun_fs::FileSystem;

use bun_install::{self as install, Bin, Lockfile, PackageID, PackageInstall};
use bun_install::PackageManager;
use bun_install::package_manager::{ProgressStrings, WorkspaceFilter};
use bun_install::package_manager::package_installer::{PackageInstaller, TreeContext};

// TODO(port): narrow error set
pub fn install_hoisted_packages(
    this: &mut PackageManager,
    ctx: Command::Context,
    workspace_filters: &[WorkspaceFilter],
    install_root_dependencies: bool,
    log_level: PackageManager::Options::LogLevel,
    packages_to_install: Option<&[PackageID]>,
) -> Result<PackageInstall::Summary, bun_core::Error> {
    analytics::Features::hoisted_bun_install_inc(1);

    let original_trees = this.lockfile.buffers.trees;
    let original_tree_dep_ids = this.lockfile.buffers.hoisted_dependencies;

    this.lockfile.filter(this.log, this, install_root_dependencies, workspace_filters, packages_to_install)?;

    // PORT NOTE: `defer { restore buffers }` — side-effecting rollback, not a free.
    let _restore_buffers = scopeguard::guard((), |()| {
        this.lockfile.buffers.trees = original_trees;
        this.lockfile.buffers.hoisted_dependencies = original_tree_dep_ids;
    });
    // TODO(port): the guard above borrows `this` mutably across the rest of the fn;
    // Phase B may need to capture raw ptrs or restructure to satisfy borrowck.

    let mut root_node: &mut Progress::Node;
    let mut download_node: Progress::Node;
    let mut install_node: Progress::Node;
    let mut scripts_node: Progress::Node;
    let options = &this.options;
    let progress = &mut this.progress;

    if log_level.show_progress() {
        progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        root_node = progress.start("", 0);
        download_node = root_node.start(ProgressStrings::download(), 0);

        install_node = root_node.start(ProgressStrings::install(), this.lockfile.buffers.hoisted_dependencies.len());
        scripts_node = root_node.start(ProgressStrings::script(), 0);
        this.downloads_node = Some(&mut download_node);
        this.scripts_node = Some(&mut scripts_node);
        // TODO(port): storing &mut to stack locals into `this` — Phase B must reshape (raw ptrs or move nodes into PackageManager).
    }

    // PORT NOTE: `defer { progress.root.end(); progress = .{} }`
    let _end_progress = scopeguard::guard((), |()| {
        if log_level.show_progress() {
            progress.root.end();
            *progress = Progress::default();
        }
    });
    // TODO(port): same borrowck concern as above.

    // If there was already a valid lockfile and so we did not resolve, i.e. there was zero network activity
    // the packages could still not be in the cache dir
    // this would be a common scenario in a CI environment
    // or if you just cloned a repo
    // we want to check lazily though
    // no need to download packages you've already installed!!
    let mut new_node_modules = false;
    let cwd = Fd::cwd();
    let node_modules_folder = 'brk: {
        // Attempt to open the existing node_modules folder
        match sys::openat_os_path(cwd, sys::os_path_literal!("node_modules"), sys::O::DIRECTORY | sys::O::RDONLY, 0o755) {
            sys::Result::Ok(fd) => break 'brk sys::Dir::from_fd(fd),
            sys::Result::Err(_) => {}
        }

        new_node_modules = true;

        // Attempt to create a new node_modules folder
        if let Some(err) = sys::mkdir(b"node_modules", 0o755).as_err() {
            if err.errno != sys::E::EXIST as _ {
                Output::err(err, "could not create the <b>\"node_modules\"<r> directory", format_args!(""));
                Global::crash();
            }
        }
        match sys::open_dir(cwd, b"node_modules") {
            Ok(dir) => break 'brk dir,
            Err(err) => {
                Output::err(err, "could not open the <b>\"node_modules\"<r> directory", format_args!(""));
                Global::crash();
            }
        }
    };
    // TODO(port): Zig used `std.fs.Dir` here; mapped to `bun_sys::Dir` (no std::fs allowed).

    let mut skip_delete = new_node_modules;
    let mut skip_verify_installed_version_number = new_node_modules;

    if options.enable.force_install {
        skip_verify_installed_version_number = true;
        skip_delete = false;
    }

    let mut summary = PackageInstall::Summary::default();

    {
        let mut iterator = Lockfile::Tree::Iterator::<{ Lockfile::Tree::IterKind::NodeModules }>::init(this.lockfile);
        // TODO(port): `Iterator(.node_modules)` is a comptime enum param — verify const-generic spelling in Phase B.

        #[cfg(unix)]
        {
            Bin::Linker::ensure_umask();
        }

        let mut installer: PackageInstaller = 'brk: {
            let (completed_trees, tree_ids_to_trees_the_id_depends_on) = 'trees: {
                let trees = this.lockfile.buffers.trees.as_slice();
                let completed_trees = Bitset::init_empty(trees.len())?;
                let mut tree_ids_to_trees_the_id_depends_on = Bitset::List::init_empty(trees.len(), trees.len())?;
                // TODO(port): `Bitset.List` (DynamicBitSetUnmanaged.List) — verify Rust type name in bun_collections.

                {
                    // For each tree id, traverse through it's parents and mark all visited tree
                    // ids as dependents for the current tree parent
                    let mut deps = Bitset::init_empty(trees.len())?;
                    for _curr in trees {
                        let mut curr = *_curr;
                        tree_ids_to_trees_the_id_depends_on.set(curr.id, curr.id);

                        while curr.parent != Lockfile::Tree::INVALID_ID {
                            deps.set(curr.id);
                            tree_ids_to_trees_the_id_depends_on.set_union(curr.parent, &deps);
                            curr = trees[curr.parent as usize];
                        }

                        deps.set_all(false);
                    }
                }

                if cfg!(debug_assertions) {
                    if trees.len() > 0 {
                        // last tree should only depend on one other
                        debug_assert!(tree_ids_to_trees_the_id_depends_on.at(trees.len() - 1).count() == 1);
                        // and it should be itself
                        debug_assert!(tree_ids_to_trees_the_id_depends_on.at(trees.len() - 1).is_set(trees.len() - 1));

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

            // These slices potentially get resized during iteration
            // so we want to make sure they're not accessible to the rest of this function
            // to make mistakes harder
            let parts = this.lockfile.packages.slice();

            break 'brk PackageInstaller {
                manager: this,
                options: &this.options,
                metas: parts.items_meta(),
                bins: parts.items_bin(),
                root_node_modules_folder: node_modules_folder,
                names: parts.items_name(),
                pkg_name_hashes: parts.items_name_hash(),
                resolutions: parts.items_resolution(),
                pkg_dependencies: parts.items_dependencies(),
                lockfile: this.lockfile,
                node: &mut install_node,
                node_modules: PackageInstaller::NodeModules {
                    path: strings::without_trailing_slash(FileSystem::instance().top_level_dir).to_vec(),
                    tree_id: 0,
                },
                progress,
                skip_verify_installed_version_number,
                skip_delete,
                summary: &mut summary,
                force_install: options.enable.force_install,
                successfully_installed: Bitset::init_empty(this.lockfile.packages.len())?,
                command_ctx: ctx,
                tree_ids_to_trees_the_id_depends_on,
                completed_trees,
                trees: 'trees: {
                    let mut trees: Vec<TreeContext> = Vec::with_capacity(this.lockfile.buffers.trees.len());
                    for _i in 0..this.lockfile.buffers.trees.len() {
                        trees.push(TreeContext {
                            binaries: Bin::PriorityQueue::init(Bin::PriorityQueue::Context {
                                dependencies: &this.lockfile.buffers.dependencies,
                                string_buf: &this.lockfile.buffers.string_bytes,
                            }),
                            ..TreeContext::default()
                        });
                    }
                    break 'trees trees.into_boxed_slice();
                },
                trusted_dependencies_from_update_requests: this.find_trusted_dependencies_from_update_requests(),
                seen_bin_links: StringHashMap::<()>::new(),
            };
            // TODO(port): PackageInstaller likely has additional fields with defaults; Phase B fill via `..Default::default()` if needed.
            // TODO(port): MultiArrayList `.items(.field)` mapped to `parts.items_<field>()` — verify accessor names in bun_collections::MultiArrayList.
        };

        installer.node_modules.path.push(SEP);

        // `defer installer.deinit()` — handled by Drop.

        while let Some(node_modules) = iterator.next(&installer.completed_trees) {
            installer.node_modules.path.truncate(
                strings::without_trailing_slash(FileSystem::instance().top_level_dir).len() + 1,
            );
            installer.node_modules.path.extend_from_slice(node_modules.relative_path);
            installer.node_modules.tree_id = node_modules.tree_id;
            let mut remaining = node_modules.dependencies;
            installer.current_tree_id = node_modules.tree_id;

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
                        PackageManager::RunTasksCallbacks {
                            on_extract: PackageInstaller::install_enqueued_packages_after_extraction,
                            on_resolve: (),
                            on_package_manifest_error: (),
                            on_package_download_error: (),
                        },
                        true,
                        log_level,
                    )?;
                    // TODO(port): `runTasks` takes `comptime T: type` + callbacks anon struct in Zig — verify Rust signature.
                    if !installer.options.do_.install_packages {
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
                PackageManager::RunTasksCallbacks {
                    on_extract: PackageInstaller::install_enqueued_packages_after_extraction,
                    on_resolve: (),
                    on_package_manifest_error: (),
                    on_package_download_error: (),
                },
                true,
                log_level,
            )?;
            if !installer.options.do_.install_packages {
                return Err(bun_core::err!("InstallFailed"));
            }

            this.tick_lifecycle_scripts();
            this.report_slow_lifecycle_scripts();
        }

        while this.pending_task_count() > 0 && installer.options.do_.install_packages {
            struct Closure<'a> {
                installer: &'a mut PackageInstaller,
                err: Option<bun_core::Error>,
                manager: &'a mut PackageManager,
            }

            impl<'a> Closure<'a> {
                pub fn is_done(closure: &mut Self) -> bool {
                    let pm = &*closure.manager;
                    if let Err(err) = closure.manager.run_tasks(
                        closure.installer,
                        PackageManager::RunTasksCallbacks {
                            on_extract: PackageInstaller::install_enqueued_packages_after_extraction,
                            on_resolve: (),
                            on_package_manifest_error: (),
                            on_package_download_error: (),
                        },
                        true,
                        pm.options.log_level,
                    ) {
                        closure.err = Some(err);
                    }

                    if closure.err.is_some() {
                        return true;
                    }

                    closure.manager.report_slow_lifecycle_scripts();

                    if PackageManager::verbose_install() && closure.manager.pending_task_count() > 0 {
                        let pending_task_count = closure.manager.pending_task_count();
                        if pending_task_count > 0 && PackageManager::has_enough_time_passed_between_waiting_messages() {
                            Output::pretty_errorln(format_args!(
                                "<d>[PackageManager]<r> waiting for {} tasks\n",
                                pending_task_count
                            ));
                        }
                    }

                    closure.manager.pending_task_count() == 0 && closure.manager.has_no_more_pending_lifecycle_scripts()
                }
            }

            let mut closure = Closure {
                installer: &mut installer,
                err: None,
                manager: this,
            };

            // Whenever the event loop wakes up, we need to call `runTasks`
            // If we call sleep() instead of sleepUntil(), it will wait forever until there are no more lifecycle scripts
            // which means it will not call runTasks until _all_ current lifecycle scripts have finished running
            this.sleep_until(&mut closure, Closure::is_done);
            // TODO(port): `this` is mutably borrowed by `closure.manager` here — Phase B may need to call via `closure.manager.sleep_until(...)` or reshape.

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
            let force = true;
            installer.install_available_packages(log_level, force);
        }

        // .monotonic is okay because this value is only accessed on this thread.
        this.finished_installing.store(true, Ordering::Relaxed);
        if log_level.show_progress() {
            scripts_node.activate();
        }

        if !installer.options.do_.install_packages {
            return Err(bun_core::err!("InstallFailed"));
        }

        summary.successfully_installed = installer.successfully_installed;

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
//   confidence: medium
//   todos:      9
//   notes:      heavy aliasing of `this` (scopeguards, Closure, PackageInstaller fields) will need borrowck reshaping; runTasks callback-struct signature guessed
// ──────────────────────────────────────────────────────────────────────────
