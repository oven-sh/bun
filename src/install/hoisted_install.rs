use crate::lockfile::package::PackageColumns as _;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

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
use crate::{self as install, DependencyID, ExtractData, PackageID};
// Bring the `items_<field>{,_mut}()` column accessors for
// `MultiArrayList::Slice<Package>` into scope (Zig: `slice.items(.field)`).
use crate::PackageManager;
use crate::bin_real as bin;
use crate::package_install;
use crate::package_installer::{NodeModulesFolder, PackageInstaller, TreeContext};
use crate::package_manager::{self, WorkspaceFilter};
use crate::package_manager_real::ProgressStrings;
use crate::package_manager_real::run_tasks;
use crate::package_manager_task as Task;

/// `RunTasksCallbacks` impl for the hoisted-install loop. Mirrors the Zig
/// anonymous-struct call shape `{ .onExtract = installEnqueuedPackagesAfterExtraction,
/// .onResolve = {}, ... }` with `Ctx == *PackageInstaller`.
pub struct HoistedRunTasksCallbacks<'a>(core::marker::PhantomData<&'a mut ()>);

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

    fn as_package_installer<'x>(ctx: &'x mut Self::Ctx) -> &'x mut PackageInstaller<'x> {
        // SAFETY: identity cast — narrows the invariant `'a` param to the
        // borrow-local `'x` (`'a: 'x` is implied by `&'x mut PackageInstaller<'a>`).
        // The returned reference cannot outlive `'x`, so all inner `'a` borrows
        // remain valid. Inner-lifetime variance cast via raw pointer.
        unsafe { &mut *core::ptr::from_mut(ctx).cast::<PackageInstaller<'x>>() }
    }
}

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
        // borrows of `this`). `lockfile` is `Box<Lockfile>` so the heap object
        // is disjoint from the `PackageManager` struct; snapshot raw `*mut
        // Lockfile` and `*mut Log` first so `filter` can hold `&mut Lockfile`
        // and `&mut PackageManager` simultaneously through `mgr_ptr`'s
        // provenance root.
        let log: *mut bun_ast::Log = this.log;
        // SAFETY: `mgr_ptr` is the provenance root; `lockfile` is heap-owned
        // via `Box`, so `*mut Lockfile` does not overlap `*mut PackageManager`.
        let lockfile_ptr: *mut crate::lockfile::Lockfile = unsafe { &raw mut *(*mgr_ptr).lockfile };
        // SAFETY: `log` is the always-live logger backref (Zig: `*Log`, never
        // null); `mgr_ptr` see shadow-reborrow above.
        unsafe {
            (*lockfile_ptr).filter(
                &mut *log,
                &mut *mgr_ptr,
                install_root_dependencies,
                workspace_filters,
                packages_to_install,
            )?;
        }
    }
    // Re-derive after `filter()` so every subsequent `this` use (progress
    // setup through the install loop) is a fresh child of `mgr_ptr` under
    // Stacked Borrows — `&mut *mgr_ptr` inside the block above popped the
    // line-77 reborrow's tag.
    let this = unsafe { &mut *mgr_ptr };

    let _restore_buffers = scopeguard::guard(
        (original_trees, original_tree_dep_ids),
        move |(trees, dep_ids)| {
            // SAFETY: `mgr_ptr` is the provenance root for every body access to
            // `this` (see shadow-reborrow above); guard runs after all body
            // borrows have ended.
            let this = unsafe { &mut *mgr_ptr };
            this.lockfile.buffers.trees = trees;
            this.lockfile.buffers.hoisted_dependencies = dep_ids;
        },
    );

    let mut download_node: ProgressNode = ProgressNode::default();
    let mut install_node: ProgressNode = ProgressNode::default();
    let mut scripts_node: ProgressNode = ProgressNode::default();

    if log_level.show_progress() {
        // Hoist before the `&mut this.progress` borrow so the disjoint
        // `this.lockfile` read doesn't overlap the live `root_node` reborrow.
        let hoisted_len = this.lockfile.buffers.hoisted_dependencies.len();
        let progress = &mut this.progress;
        progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        // `Progress::start` returns `&mut Node` (points into `progress.root`);
        // keep it as a safe reborrow — it's only used to spawn the three
        // children below and is dead before any other `this.*` write.
        let root_node = progress.start(b"", 0);
        download_node = root_node.start(ProgressStrings::download(), 0);
        install_node = root_node.start(ProgressStrings::install(), hoisted_len);
        scripts_node = root_node.start(ProgressStrings::script(), 0);
        this.downloads_node = Some(core::ptr::addr_of_mut!(download_node));
        this.scripts_node = NonNull::new(&raw mut scripts_node);
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
        // Defensive: the stored progress-node pointers target stack locals in
        // this frame; clear them so `scripts_node_mut()` / `downloads_node_mut()`
        // can't observe a dangling pointer after the install pass returns.
        // SAFETY: `mgr_ptr` provenance — see `_restore_buffers` note.
        let this = unsafe { &mut *mgr_ptr };
        this.scripts_node = None;
        this.downloads_node = None;
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
                Output::err(
                    err,
                    "could not create the <b>\"node_modules\"<r> directory",
                    (),
                );
                Global::crash();
            }
        }
        match sys::open_dir(Dir::from_fd(cwd), b"node_modules") {
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
        // PORT NOTE: BACKREF — `Tree::Iterator` borrows the four buffer slices,
        // and `PackageInstaller` simultaneously holds `&mut Lockfile` (plus
        // `&[T]` column aliases into `lockfile.packages`). Zig stores
        // non-exclusive `*const Lockfile` in the iterator. Snapshot raw `*const
        // Vec<_>` headers here so the iterator's slice borrows are derived
        // through `mgr_ptr` (the same provenance root as `installer.lockfile`),
        // not through a `&this.lockfile.buffers.X` that the installer's `&mut
        // Lockfile` would invalidate.
        // SAFETY: `mgr_ptr` is the provenance root; `lockfile` is heap-owned
        // via `Box` (Zig: `*Lockfile`), so deref the Box for the heap addr.
        // Each buffer lives at a fixed offset within it for the install pass —
        // wrap them as `BackRef` once under a single SAFETY obligation.
        let (lockfile_ptr, buf_trees, buf_hoisted, buf_deps, buf_strings): (
            *mut crate::lockfile::Lockfile,
            bun_ptr::BackRef<Vec<tree::Tree>>,
            bun_ptr::BackRef<Vec<DependencyID>>,
            bun_ptr::BackRef<Vec<crate::Dependency>>,
            bun_ptr::BackRef<Vec<u8>>,
        ) = unsafe {
            let lockfile_ptr: *mut crate::lockfile::Lockfile = &raw mut *(*mgr_ptr).lockfile;
            let buffers = core::ptr::addr_of_mut!((*lockfile_ptr).buffers);
            (
                lockfile_ptr,
                bun_ptr::BackRef::from_raw(core::ptr::addr_of_mut!((*buffers).trees)),
                bun_ptr::BackRef::from_raw(core::ptr::addr_of_mut!(
                    (*buffers).hoisted_dependencies
                )),
                bun_ptr::BackRef::from_raw(core::ptr::addr_of_mut!((*buffers).dependencies)),
                bun_ptr::BackRef::from_raw(core::ptr::addr_of_mut!((*buffers).string_bytes)),
            )
        };
        // Safe `BackRef` view of the same heap `Lockfile` as `lockfile_ptr`
        // (BACKREF — outlives this install pass). `From<NonNull>` is the
        // safe constructor; the read-only column projections below go
        // through `Deref` instead of a per-site raw deref.
        let lockfile_ref = bun_ptr::BackRef::<crate::lockfile::Lockfile>::from(
            core::ptr::NonNull::new(lockfile_ptr).expect("lockfile BACKREF non-null"),
        );

        // BACKREF — slices live for the duration of this block; `filter()` (the
        // only buffer mutator) has already run.
        let mut iterator = tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::from_slices(
            buf_trees.as_slice(),
            buf_hoisted.as_slice(),
            buf_deps.as_slice(),
            buf_strings.as_slice(),
        );

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
            //
            // PORT NOTE: BACKREF — Zig's `var parts = packages.slice()` is a
            // by-value `MultiArrayList.Slice` (raw ptr+len per column), so
            // `parts.items(.field)` yields independent `[]T` regardless of
            // mutability. The `PackageInstaller` slice fields are
            // `bun_ptr::RawSlice<T>` (raw `*const [T]`, no lifetime), so
            // wrapping each column with `RawSlice::new` stores the (ptr, len)
            // without keeping a borrow live — no `&'a → &'a` detach
            // round-trip needed. Derive through `lockfile_ptr` so the
            // provenance root matches `installer.lockfile`/`installer.manager`.
            // RawSlice invariant: `lockfile_ref` derived from `mgr_ptr`;
            // the packages column buffers are not freed for the lifetime of
            // `installer` (only grow, which is why
            // `fix_cached_lockfile_package_slices` re-snapshots). Read-only
            // projection via the safe `BackRef::Deref`.
            let parts = lockfile_ref.packages.slice();
            let metas = bun_ptr::RawSlice::new(parts.items_meta());
            let bins = bun_ptr::RawSlice::new(parts.items_bin());
            let names = bun_ptr::RawSlice::new(parts.items_name());
            let pkg_name_hashes = bun_ptr::RawSlice::new(parts.items_name_hash());
            let resolutions = bun_ptr::RawSlice::new(parts.items_resolution());
            let pkg_dependencies = bun_ptr::RawSlice::new(parts.items_dependencies());

            // Hoist the by-value reads out of the struct literal so they
            // finish before the long-lived `&mut *mgr_ptr` borrow for
            // `manager` begins (struct fields evaluate in source order).
            let force_install = this.options.enable.force_install();
            let pkg_len = this.lockfile.packages.len();
            let trees_count = this.lockfile.buffers.trees.len();
            let trusted_deps = this.find_trusted_dependencies_from_update_requests();

            // `PackageInstaller.{manager,lockfile,progress}` are BACKREF raw
            // pointers (Zig: non-exclusive `*PM` / `*Lockfile`); copying
            // `mgr_ptr` into them does not move `this`, so the body below
            // keeps using `this` for `pending_task_count` / `run_tasks` /
            // lifecycle ticks via the same provenance root.
            break 'brk PackageInstaller {
                manager: mgr_ptr,
                metas,
                bins,
                names,
                pkg_name_hashes,
                resolutions,
                pkg_dependencies,
                lockfile: lockfile_ptr,
                root_node_modules_folder: node_modules_folder,
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
                            binaries: bin::PriorityQueue::init(bin::PriorityQueueContext {
                                dependencies: buf_deps,
                                string_buf: buf_strings,
                            }),
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
                current_tree_id: tree::INVALID_ID,
                pending_lifecycle_scripts: Vec::new(),
            };
        };

        installer.node_modules.path.push(SEP);

        // `defer installer.deinit()` — handled by Drop.

        let top_level_len =
            strings::without_trailing_slash(FileSystem::instance().top_level_dir()).len() + 1;

        while let Some(node_modules) = iterator.next(Some(&mut installer.completed_trees)) {
            installer.node_modules.path.truncate(top_level_len);
            installer
                .node_modules
                .path
                .extend_from_slice(node_modules.relative_path.as_bytes());
            installer.node_modules.tree_id = node_modules.tree_id;
            let mut remaining: &[DependencyID] = node_modules.dependencies;
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
                    run_tasks::run_tasks::<HoistedRunTasksCallbacks>(
                        this,
                        &mut installer,
                        true,
                        log_level,
                    )?;
                    if !this.options.do_.install_packages() {
                        return Err(bun_core::err!("InstallFailed"));
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
                return Err(bun_core::err!("InstallFailed"));
            }

            this.tick_lifecycle_scripts();
            this.report_slow_lifecycle_scripts();
        }

        while this.pending_task_count() > 0 && this.options.do_.install_packages() {
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
                    if let Err(err) = run_tasks::run_tasks::<HoistedRunTasksCallbacks>(
                        manager,
                        closure.installer,
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
            let mut closure = Closure {
                installer: &mut installer,
                err: None,
                manager: mgr,
            };

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

        // PORT NOTE: reshaped for borrowck — Zig iterates `installer.trees`
        // by value while calling `installer.installAvailablePackages` (which
        // also touches `installer.trees`); index instead of `.iter()` so the
        // immutable borrow doesn't overlap `&mut self`.
        for tree_idx in 0..installer.trees.len() {
            if cfg!(debug_assertions) {
                debug_assert!(installer.trees[tree_idx].pending_installs.len() == 0);
            }
            // force = true
            installer.install_available_packages::<true>(log_level);
        }

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
            return Err(bun_core::err!("InstallFailed"));
        }

        // PORT NOTE: Zig copies the bitset header (`summary.* = installer.*`);
        // Rust moves. `replace` with a fresh empty so `installer` stays whole
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
        while this.pending_lifecycle_script_tasks.load(Ordering::Relaxed) > 0 {
            this.report_slow_lifecycle_scripts();

            this.sleep();
        }

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

// ported from: src/install/hoisted_install.zig
