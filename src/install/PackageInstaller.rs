use core::sync::atomic::Ordering;

use bun_collections::{ArrayHashMap, DynamicBitSet, StringHashMap};
use bun_core::fmt::PathSep;
use bun_core::{Global, Output};
use bun_core::{ZStr, strings};
use bun_paths::resolve_path::{dirname, join_abs_string_z, join_z_buf};
use bun_paths::{self as Path, AbsPath, AutoAbsPath, MAX_PATH_BYTES, PathBuffer, SEP, platform};
use bun_semver::String;
use bun_sys::{self as Syscall, Dir, Fd, FdDirExt, FdExt};

use crate::bin_real as bin;
use crate::bin_real::Bin;
use crate::bun_bunfig::Arguments as Command;
use crate::bun_fs::FileSystem;
use crate::bun_progress::{Node as ProgressNode, Progress};

use crate::lifecycle_script_runner::LifecycleScriptSubprocess;
// PORT NOTE: `Lockfile` here is the in-crate `crate::lockfile::Lockfile` (the
// struct `PackageManager.lockfile` actually carries). `lockfile_real` is still
// imported for `tree::Id` / `Tree` / `DependencySlice` / `package::*`, all of
// which are the same types re-exported through `crate::lockfile`.
use crate::lockfile::Lockfile;
use crate::lockfile_real::package::{
    self as Package, PackageColumns, scripts::Scripts as PackageScripts,
};
use crate::lockfile_real::{self as lockfile, DependencySlice, Tree};
use crate::network_task::ForTarballError;
use crate::package_install::{self, PackageInstall};
use crate::package_manager::{self, Options, PackageManager};
use crate::package_manager_real::progress_strings::ProgressStrings;
use crate::package_manager_task as task;
use crate::patch_install::{self, PatchTask};
use crate::postinstall_optimizer::{self, PostinstallOptimizer};
use crate::resolution::{self, Resolution};
use crate::{
    DependencyID, DependencyInstallContext, ExtractData, PackageID, PackageNameHash,
    TaskCallbackContext, TruncatedPackageNameHash, invalid_package_id,
};

bun_output::declare_scope!(PackageInstaller, hidden);

type Bitset = DynamicBitSet;

pub struct PendingLifecycleScript {
    pub list: lockfile::package::scripts::List,
    pub tree_id: lockfile::tree::Id,
    pub optional: bool,
}

pub struct PackageInstaller<'a> {
    /// Zig: `*PackageManager` — BACKREF into the singleton. Raw pointer (not
    /// `&'a mut`) because the install loop also re-borrows the same object
    /// via the caller's `this`/`mgr_ptr` (e.g. `run_tasks(this, &mut installer)`
    /// in `hoisted_install`); a `&'a mut` here would assert exclusivity that
    /// the call shape contradicts. Never null. Access via `manager()` /
    /// `manager_mut()`.
    pub manager: *mut PackageManager,
    /// Zig: `*Lockfile` — BACKREF into `(*manager).lockfile`. Same aliasing
    /// rationale as `manager`; the column-slice fields below also point into
    /// it. Never null. Access via `lockfile()` / `lockfile_mut()`.
    pub lockfile: *mut Lockfile,
    /// Zig: `*Progress` — BACKREF into `(*manager).progress`. Never null.
    pub progress: *mut Progress,

    /// relative paths from `next` will be copied into this list.
    pub node_modules: NodeModulesFolder,

    pub skip_verify_installed_version_number: bool,
    pub skip_delete: bool,
    pub force_install: bool,
    pub root_node_modules_folder: Dir,
    pub summary: &'a mut package_install::Summary,
    // PORT NOTE: Zig also stored `options: *const Options` (a BACKREF into
    // `(*manager).options`). Dropped — every caller reads via
    // `self.manager().options` so the shared borrow stays a child of the live
    // `&mut PackageManager` Unique tag rather than a sibling raw.
    // The following slice fields alias into `self.lockfile.packages` (BACKREF).
    // Stored as `RawSlice<T>` (raw `*const [T]`, `usize` len) — the lockfile's
    // `MultiArrayList<Package>` column buffers outlive this `PackageInstaller`
    // and are only ever *grown*, never freed; `fix_cached_lockfile_package_slices`
    // re-snapshots after a grow. `RawSlice` carries no lifetime, so the
    // assignment sites do not need a `&'a → &'a` lifetime-detach round-trip.
    // `resolutions` was `&'a mut [Resolution]` in the Zig spec but every Rust
    // call site is a read (`&raw const self.resolutions[i]`), so it is also
    // `RawSlice` here.
    pub metas: bun_ptr::RawSlice<Package::Meta>,
    pub names: bun_ptr::RawSlice<String>,
    pub pkg_dependencies: bun_ptr::RawSlice<DependencySlice>,
    pub pkg_name_hashes: bun_ptr::RawSlice<PackageNameHash>,
    pub bins: bun_ptr::RawSlice<Bin>,
    pub resolutions: bun_ptr::RawSlice<Resolution>,
    pub node: &'a mut ProgressNode,
    pub destination_dir_subpath_buf: PathBuffer,
    pub folder_path_buf: PathBuffer,
    pub successfully_installed: Bitset,
    pub command_ctx: Command::Context<'a>,
    pub current_tree_id: lockfile::tree::Id,

    // fields used for running lifecycle scripts when it's safe
    //
    /// set of completed tree ids
    pub completed_trees: Bitset,
    /// the tree ids a tree depends on before it can run the lifecycle scripts of it's immediate dependencies
    pub tree_ids_to_trees_the_id_depends_on: bun_collections::DynamicBitSetList,
    pub pending_lifecycle_scripts: Vec<PendingLifecycleScript>,

    pub trusted_dependencies_from_update_requests: ArrayHashMap<TruncatedPackageNameHash, ()>,

    /// uses same ids as lockfile.trees
    pub trees: Box<[TreeContext]>,

    pub seen_bin_links: StringHashMap<()>,
}

use bun_core::UnwrapOrOom;

#[derive(Default)]
pub struct NodeModulesFolder {
    pub tree_id: lockfile::tree::Id,
    pub path: Vec<u8>,
}

impl NodeModulesFolder {
    /// Since the stack size of these functions are rather large, let's not let them be inlined.
    #[inline(never)]
    fn directory_exists_at_without_opening_directories(
        &self,
        root_node_modules_dir: Dir,
        file_path: &ZStr,
    ) -> bool {
        let mut path_buf = PathBuffer::uninit();
        let parts: [&[u8]; 2] = [self.path.as_slice(), file_path.as_bytes()];
        bun_sys::directory_exists_at(
            Fd::from_std_dir(&root_node_modules_dir),
            join_z_buf::<platform::Auto>(path_buf.as_mut_slice(), &parts),
        )
        .unwrap_or(false)
    }

    pub fn directory_exists_at(&self, root_node_modules_dir: Dir, file_path: &ZStr) -> bool {
        if file_path.len() + self.path.len() * 2 < MAX_PATH_BYTES {
            return self
                .directory_exists_at_without_opening_directories(root_node_modules_dir, file_path);
        }

        let dir = match self.open_dir(root_node_modules_dir) {
            Ok(d) => Fd::from_std_dir(&d),
            Err(_) => return false,
        };
        let res = bun_sys::directory_exists_at(dir, file_path).unwrap_or(false);
        dir.close();
        res
    }

    /// Since the stack size of these functions are rather large, let's not let them be inlined.
    #[inline(never)]
    fn open_file_without_opening_directories(
        &self,
        root_node_modules_dir: Dir,
        file_path: &ZStr,
    ) -> bun_sys::Result<bun_sys::File> {
        let mut path_buf = PathBuffer::uninit();
        let parts: [&[u8]; 2] = [self.path.as_slice(), file_path.as_bytes()];
        bun_sys::File::openat(
            Fd::from_std_dir(&root_node_modules_dir),
            join_z_buf::<platform::Auto>(path_buf.as_mut_slice(), &parts),
            bun_sys::O::RDONLY,
            0,
        )
    }

    pub fn read_file(
        &self,
        root_node_modules_dir: Dir,
        file_path: &ZStr,
    ) -> Result<bun_sys::file::ReadToEndResult, bun_core::Error> {
        // TODO(port): narrow error set
        let file = self.open_file(root_node_modules_dir, file_path)?;
        let res = file.read_to_end();
        let _ = file.close(); // close error is non-actionable (Zig parity: discarded)
        Ok(match res {
            Ok(bytes) => bun_sys::file::ReadToEndResult { bytes, err: None },
            Err(e) => bun_sys::file::ReadToEndResult {
                bytes: Vec::new(),
                err: Some(e),
            },
        })
    }

    pub fn read_small_file(
        &self,
        root_node_modules_dir: Dir,
        file_path: &ZStr,
    ) -> Result<bun_sys::file::ReadToEndResult, bun_core::Error> {
        // TODO(port): narrow error set
        let file = self.open_file(root_node_modules_dir, file_path)?;
        let res = file.read_to_end_small();
        let _ = file.close(); // close error is non-actionable (Zig parity: discarded)
        Ok(match res {
            Ok(bytes) => bun_sys::file::ReadToEndResult { bytes, err: None },
            Err(e) => bun_sys::file::ReadToEndResult {
                bytes: Vec::new(),
                err: Some(e),
            },
        })
    }

    pub fn open_file(
        &self,
        root_node_modules_dir: Dir,
        file_path: &ZStr,
    ) -> Result<bun_sys::File, bun_core::Error> {
        // TODO(port): narrow error set
        if self.path.len() + file_path.len() * 2 < MAX_PATH_BYTES {
            // If we do not run the risk of ENAMETOOLONG, then let's just avoid opening the extra directories altogether.
            match self.open_file_without_opening_directories(root_node_modules_dir, file_path) {
                Err(e) => match e.get_errno() {
                    // Just incase we're wrong, let's try the fallback
                    bun_sys::Errno::EPERM
                    | bun_sys::Errno::EACCES
                    | bun_sys::Errno::EINVAL
                    | bun_sys::Errno::ENAMETOOLONG => {
                        // Use fallback
                    }
                    _ => return Err(e.to_zig_err()),
                },
                Ok(file) => return Ok(file),
            }
        }

        let dir = Fd::from_std_dir(&self.open_dir(root_node_modules_dir)?);
        let res = bun_sys::File::openat(dir, file_path, bun_sys::O::RDONLY, 0);
        dir.close();
        res.map_err(|e| e.to_zig_err())
    }

    pub fn open_dir(&self, root: Dir) -> Result<Dir, bun_core::Error> {
        // TODO(port): narrow error set
        #[cfg(unix)]
        {
            // PORT NOTE: std.posix.toPosixPath — copies into a NUL-terminated PathBuffer
            let mut path_buf = PathBuffer::uninit();
            let path_z = bun_paths::resolve_path::z(self.path.as_slice(), &mut path_buf);
            return Ok(Dir::from_fd(
                bun_sys::openat(Fd::from_std_dir(&root), path_z, bun_sys::O::DIRECTORY, 0)
                    .map_err(|e| e.to_zig_err())?,
            ));
        }

        #[cfg(not(unix))]
        {
            return Ok(Dir::from_fd(
                bun_sys::open_dir_at_windows_a(
                    root.fd(),
                    self.path.as_slice(),
                    bun_sys::WindowsOpenDirOptions {
                        can_rename_or_delete: false,
                        read_only: false,
                        ..Default::default()
                    },
                )
                .map_err(|e| e.to_zig_err())?,
            ));
        }
    }

    pub fn make_and_open_dir(&mut self, root: Dir) -> Result<Dir, bun_core::Error> {
        // TODO(port): narrow error set
        let out = 'brk: {
            #[cfg(unix)]
            {
                // TODO(port): std.fs.Dir.makeOpenPath — bun_sys equivalent (mkdir -p + open)
                break 'brk root.make_open_path(
                    self.path.as_slice(),
                    bun_sys::OpenDirOptions {
                        iterate: true,
                        ..Default::default()
                    },
                )?;
            }

            #[cfg(not(unix))]
            {
                break 'brk Dir::from_fd(
                    bun_sys::open_dir_at_windows_a(
                        root.fd(),
                        self.path.as_slice(),
                        bun_sys::WindowsOpenDirOptions {
                            can_rename_or_delete: false,
                            op: bun_sys::WindowsOpenDirOp::OpenOrCreate,
                            read_only: false,
                            ..Default::default()
                        },
                    )
                    .map_err(|e| e.to_zig_err())?,
                );
            }
        };
        Ok(out)
    }
}

pub struct TreeContext {
    /// Each tree (other than the root tree) can accumulate packages it cannot install until
    /// each parent tree has installed their packages. We keep arrays of these pending
    /// packages for each tree, and drain them when a tree is completed (each of it's immediate
    /// dependencies are installed).
    ///
    /// Trees are drained breadth first because if the current tree is completed from
    /// the remaining pending installs, then any child tree has a higher chance of
    /// being able to install it's dependencies
    pub pending_installs: Vec<DependencyInstallContext>,

    pub binaries: bin::PriorityQueue,

    /// Number of installed dependencies. Could be successful or failure.
    pub install_count: usize,
}

pub type TreeContextId = lockfile::tree::Id;

// PORT NOTE: TreeContext::deinit dropped — Vec and Bin::PriorityQueue impl Drop.

pub enum LazyPackageDestinationDir<'a> {
    Dir(Dir),
    NodeModulesPath {
        node_modules: &'a NodeModulesFolder,
        root_node_modules_dir: Dir,
    },
    Closed,
}

impl<'a> LazyPackageDestinationDir<'a> {
    pub fn get_dir(&mut self) -> Result<Dir, bun_core::Error> {
        // TODO(port): narrow error set
        match self {
            LazyPackageDestinationDir::Dir(dir) => Ok(*dir),
            LazyPackageDestinationDir::NodeModulesPath {
                node_modules,
                root_node_modules_dir,
            } => {
                let dir = node_modules.open_dir(*root_node_modules_dir)?;
                *self = LazyPackageDestinationDir::Dir(dir);
                Ok(dir)
            }
            LazyPackageDestinationDir::Closed => {
                panic!(
                    "LazyPackageDestinationDir is closed! This should never happen. Why did this happen?! It's not your fault. Its our fault. We're sorry."
                )
            }
        }
    }

    pub fn close(&mut self) {
        match self {
            LazyPackageDestinationDir::Dir(dir) => {
                if dir.fd() != bun_sys::cwd().fd() {
                    dir.close();
                }
            }
            LazyPackageDestinationDir::NodeModulesPath { .. }
            | LazyPackageDestinationDir::Closed => {}
        }

        *self = LazyPackageDestinationDir::Closed;
    }
}

impl<'a> PackageInstaller<'a> {
    // ──────────────────────────────────────────────────────────────────────
    // BACKREF accessors
    //
    // `manager` / `lockfile` / `options` point at allocations *outside*
    // `Self` (the singleton `PackageManager`, its boxed `Lockfile`, and its
    // `options` field), so a `&mut PackageManager` returned here never
    // overlaps `*self`. The `_mut` accessors take `&self` (not `&mut self`)
    // so call sites retain field-disjoint borrow semantics — e.g.
    // `self.manager_mut().spawn(self.command_ctx, ...)` — exactly as the
    // original `&'a mut PackageManager` field allowed. The *return* lifetime
    // is `'a` (not elided to the `&self` borrow) for the same reason: e.g.
    // `link_tree_bins` does `let m = self.manager_mut(); let t = &mut
    // self.trees[i];` — an elided return would keep `self` borrowed shared
    // while `m` is live and reject the later `&mut self.trees` projection.
    // The single-threaded install pass guarantees no two `&mut
    // PackageManager` are live at once; callers must not hold the result
    // across a call that re-derives one through another path.
    // ──────────────────────────────────────────────────────────────────────

    #[inline]
    pub fn manager(&self) -> &'a PackageManager {
        // SAFETY: BACKREF — never null; pointee outlives `'a`.
        unsafe { &*self.manager }
    }

    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn manager_mut(&self) -> &'a mut PackageManager {
        // SAFETY: BACKREF — never null; disjoint from `*self`; install pass
        // is single-threaded so no concurrent `&mut PackageManager` exists.
        unsafe { &mut *self.manager }
    }

    #[inline]
    pub fn lockfile(&self) -> &'a Lockfile {
        // SAFETY: BACKREF — never null; pointee outlives `'a`.
        unsafe { &*self.lockfile }
    }

    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn lockfile_mut(&self) -> &'a mut Lockfile {
        // SAFETY: BACKREF — never null; disjoint from `*self`; see `manager_mut`.
        unsafe { &mut *self.lockfile }
    }

    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn progress_mut(&self) -> &'a mut Progress {
        // SAFETY: BACKREF into `manager.progress` — never null; disjoint from
        // `*self`; the install pass is single-threaded so no concurrent `&mut
        // Progress` exists. Same shape as `manager_mut`/`lockfile_mut`.
        unsafe { &mut *self.progress }
    }

    /// Increments the number of installed packages for a tree id and runs available scripts
    /// if the tree is finished.
    // PORT NOTE: Zig parametrised this on `comptime should_install_packages: bool`.
    // Rust can't pass `!CONST_PARAM` as a const-generic arg on stable, and the
    // bool only gates a single call below, so it's a runtime arg here.
    pub fn increment_tree_install_count(
        &mut self,
        should_install_packages: bool,
        tree_id: lockfile::tree::Id,
        log_level: Options::LogLevel,
    ) {
        if cfg!(debug_assertions) {
            debug_assert!(tree_id != lockfile::tree::INVALID_ID);
        }

        let tree = &mut self.trees[tree_id as usize];
        let current_count = tree.install_count;
        let max = self.lockfile().buffers.trees.as_slice()[tree_id as usize]
            .dependencies
            .len as usize;

        if current_count == usize::MAX {
            if cfg!(debug_assertions) {
                Output::panic(format_args!(
                    "Installed more packages than expected for tree id: {}. Expected: {}",
                    tree_id, max
                ));
            }

            return;
        }

        let is_not_done = current_count + 1 < max;

        self.trees[tree_id as usize].install_count = if is_not_done {
            current_count + 1
        } else {
            usize::MAX
        };

        if is_not_done {
            return;
        }

        self.completed_trees.set(tree_id as usize);

        if self.trees[tree_id as usize].binaries.count() > 0 {
            self.seen_bin_links.clear();

            let mut link_target_buf = PathBuffer::uninit();
            let mut link_dest_buf = PathBuffer::uninit();
            let mut link_rel_buf = PathBuffer::uninit();
            // PORT NOTE: reshaped for borrowck — pass tree_id, re-borrow tree inside.
            self.link_tree_bins(
                tree_id,
                link_target_buf.as_mut_slice(),
                link_dest_buf.as_mut_slice(),
                link_rel_buf.as_mut_slice(),
                log_level,
            );
        }

        if should_install_packages {
            const FORCE: bool = false;
            self.install_available_packages::<FORCE>(log_level);
        }
        self.run_available_scripts(log_level);
    }

    pub fn link_tree_bins(
        &mut self,
        // PORT NOTE: zig passes `tree: *TreeContext` + `tree_id`; reshaped to take only
        // `tree_id` and re-borrow `&mut self.trees[tree_id]` to satisfy borrowck.
        tree_id: TreeContextId,
        link_target_buf: &mut [u8],
        link_dest_buf: &mut [u8],
        link_rel_buf: &mut [u8],
        log_level: Options::LogLevel,
    ) {
        let lockfile = self.lockfile();
        let manager = self.manager_mut();
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let mut node_modules_path: AbsPath =
            AbsPath::from(self.node_modules.path.as_slice()).unwrap_or_oom();
        // PORT NOTE: `defer node_modules_path.deinit()` — AbsPath impls Drop.

        let pkgs = lockfile.packages.slice();
        let pkg_name_hashes = pkgs.items_name_hash();
        let pkg_metas = pkgs.items_meta();
        let pkg_resolutions_lists = pkgs.items_resolutions();
        let pkg_resolutions_buffer = lockfile.buffers.resolutions.as_slice();
        let pkg_names = pkgs.items_name();

        let tree = &mut self.trees[tree_id as usize];

        while let Some(dep_id) = tree.binaries.remove_or_null() {
            debug_assert!((dep_id as usize) < lockfile.buffers.dependencies.as_slice().len());
            let package_id = lockfile.buffers.resolutions.as_slice()[dep_id as usize];
            debug_assert!(package_id != invalid_package_id);
            let bin = self.bins[package_id as usize];
            debug_assert!(bin.tag != bin::Tag::None);

            let alias = lockfile.buffers.dependencies.as_slice()[dep_id as usize]
                .name
                .slice(string_buf);
            let package_name_ = strings::StringOrTinyString::init(alias);
            let mut target_package_name = package_name_;
            let mut can_retry_without_native_binlink_optimization = false;
            let mut target_node_modules_path_opt: Option<AbsPath> = None;
            // PORT NOTE: `defer if (target_node_modules_path_opt) |*path| path.deinit()` — Option<AbsPath> drops.

            'native_binlink_optimization: {
                if !manager.postinstall_optimizer.is_native_binlink_enabled() {
                    break 'native_binlink_optimization;
                }
                // Check for native binlink optimization
                let name_hash = pkg_name_hashes[package_id as usize];
                if let Some(optimizer) =
                    manager
                        .postinstall_optimizer
                        .get(postinstall_optimizer::PkgInfo {
                            name_hash,
                            ..Default::default()
                        })
                {
                    match optimizer {
                        PostinstallOptimizer::NativeBinlink => {
                            let target_cpu = manager.options.cpu;
                            let target_os = manager.options.os;
                            if let Some(replacement_pkg_id) =
                                PostinstallOptimizer::get_native_binlink_replacement_package_id(
                                    pkg_resolutions_lists[package_id as usize]
                                        .get(pkg_resolutions_buffer),
                                    pkg_metas,
                                    target_cpu,
                                    target_os,
                                )
                            {
                                if tree_id != 0 {
                                    // TODO: support this optimization in nested node_modules
                                    // It's tricky to get the hoisting right.
                                    // So we leave this out for now.
                                    break 'native_binlink_optimization;
                                }

                                let replacement_name =
                                    pkg_names[replacement_pkg_id as usize].slice(string_buf);
                                target_package_name =
                                    strings::StringOrTinyString::init(replacement_name);
                                can_retry_without_native_binlink_optimization = true;
                            }
                        }
                        PostinstallOptimizer::Ignore => {}
                    }
                }
            }
            // globally linked packages shouls always belong to the root
            // tree (0).
            let global = if !manager.options.global {
                false
            } else if tree_id != 0 {
                false
            } else {
                'global: {
                    for request in manager.update_requests.iter() {
                        if request.package_id == package_id {
                            break 'global true;
                        }
                    }
                    break 'global false;
                }
            };

            loop {
                // PORT NOTE: reshaped for borrowck — Zig aliases the same `*AbsPath` for
                // both `node_modules_path` (mut) and `target_node_modules_path` (read-only)
                // when no replacement is set. Derive both from a single `*mut` so the
                // read pointer shares the write reference's provenance (a `*const` taken
                // from `&node_modules_path` would be popped by the later `&mut` reborrow
                // under stacked-borrows).
                // SAFETY: `bin::Linker::link` only reads `target_node_modules_path` and
                // never writes through it while `node_modules_path` is borrowed.
                let nm_ptr: *mut AbsPath = &raw mut node_modules_path;
                let mut bin_linker = bin::Linker {
                    bin,
                    global_bin_path: manager.options.bin_path,
                    package_name: package_name_,
                    target_package_name,
                    string_buf,
                    extern_string_buf: lockfile.buffers.extern_strings.as_slice(),
                    seen: Some(&mut self.seen_bin_links),
                    target_node_modules_path: target_node_modules_path_opt
                        .as_ref()
                        .map(|p| std::ptr::from_ref::<AbsPath>(p))
                        .unwrap_or(nm_ptr.cast_const()),
                    node_modules_path: unsafe { &mut *nm_ptr },
                    abs_target_buf: link_target_buf,
                    abs_dest_buf: link_dest_buf,
                    rel_buf: link_rel_buf,
                    err: None,
                    skipped_due_to_missing_bin: false,
                };

                bin_linker.link(global);

                if can_retry_without_native_binlink_optimization
                    && (bin_linker.skipped_due_to_missing_bin || bin_linker.err.is_some())
                {
                    can_retry_without_native_binlink_optimization = false;
                    if PackageManager::verbose_install() {
                        Output::pretty_errorln(format_args!(
                            "<d>[Bin Linker]<r> {} -> {} retrying without native bin link",
                            bstr::BStr::new(package_name_.slice()),
                            bstr::BStr::new(target_package_name.slice()),
                        ));
                    }
                    target_package_name = package_name_;
                    continue;
                }

                if let Some(err) = bin_linker.err {
                    if log_level != Options::LogLevel::Silent {
                        manager.log_mut().add_error_fmt_opts(
                            format_args!(
                                "Failed to link <b>{}<r>: {}",
                                bstr::BStr::new(alias),
                                err.name(),
                            ),
                            Default::default(),
                        );
                    }

                    if manager.options.enable.fail_early() {
                        manager.crash();
                    }
                }

                break;
            }
        }
    }

    pub fn link_remaining_bins(&mut self, log_level: Options::LogLevel) {
        let mut depth_buf: lockfile::tree::DepthBuf = [0u32; lockfile::tree::MAX_DEPTH];
        let mut node_modules_rel_path_buf = PathBuffer::uninit();
        node_modules_rel_path_buf[..b"node_modules".len()].copy_from_slice(b"node_modules");

        let mut link_target_buf = PathBuffer::uninit();
        let mut link_dest_buf = PathBuffer::uninit();
        let mut link_rel_buf = PathBuffer::uninit();

        let trees_len = self.trees.len();
        for tree_id in 0..trees_len {
            // PORT NOTE: reshaped for borrowck — index instead of `for (self.trees, 0..) |*tree, tree_id|`.
            if self.trees[tree_id].binaries.count() > 0 {
                self.seen_bin_links.clear();
                self.node_modules.path.truncate(
                    strings::without_trailing_slash(FileSystem::instance().top_level_dir()).len()
                        + 1,
                );
                let (rel_path, _) = lockfile::tree::relative_path_and_depth::<
                    { lockfile::tree::IteratorPathStyle::NodeModules },
                >(
                    self.lockfile().buffers.trees.as_slice(),
                    self.lockfile().buffers.dependencies.as_slice(),
                    self.lockfile().buffers.string_bytes.as_slice(),
                    // PERF(port): `tree_id` ranges over `0..self.trees.len()`
                    // and tree IDs are u32 by construction; avoid the
                    // `try_from` panic-format path on this per-tree loop.
                    tree_id as u32,
                    &mut node_modules_rel_path_buf,
                    &mut depth_buf,
                );

                self.node_modules
                    .path
                    .extend_from_slice(rel_path.as_bytes());

                self.link_tree_bins(
                    tree_id as u32,
                    link_target_buf.as_mut_slice(),
                    link_dest_buf.as_mut_slice(),
                    link_rel_buf.as_mut_slice(),
                    log_level,
                );
            }
        }
    }

    pub fn run_available_scripts(&mut self, log_level: Options::LogLevel) {
        let mut i: usize = self.pending_lifecycle_scripts.len();
        while i > 0 {
            i -= 1;
            let tree_id = self.pending_lifecycle_scripts[i].tree_id;
            let optional = self.pending_lifecycle_scripts[i].optional;
            if self.can_run_scripts(tree_id) {
                let entry = self.pending_lifecycle_scripts.swap_remove(i);
                // PORT NOTE: reshaped for borrowck — `package_name` is `Box<[u8]>`;
                // clone it for the error message since `entry.list` is moved into `spawn`.
                let name: Box<[u8]> = entry.list.package_name.clone();
                let output_in_foreground = false;

                if let Err(err) = self.manager_mut().spawn_package_lifecycle_scripts(
                    self.command_ctx,
                    entry.list,
                    optional,
                    output_in_foreground,
                    None,
                ) {
                    if log_level != Options::LogLevel::Silent {
                        // PORT NOTE: zig used `comptime Output.prettyFmt(fmt, enable_ansi_colors)`
                        // — `Progress::log` takes a single `Arguments` so format inline.
                        if log_level.show_progress() {
                            self.progress_mut().log(format_args!(
                                "{}",
                                Output::pretty_fmt_rt(
                                    format_args!(
                                        "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{}<r>: {}\n",
                                        bstr::BStr::new(&name),
                                        err.name(),
                                    ),
                                    Output::enable_ansi_colors_stderr(),
                                ),
                            ));
                        } else {
                            Output::pretty_errorln(format_args!(
                                "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{}<r>: {}\n",
                                bstr::BStr::new(&name),
                                err.name(),
                            ));
                        }
                    }

                    if self.manager().options.enable.fail_early() {
                        Global::exit(1);
                    }

                    Output::flush();
                    self.summary.fail += 1;
                }
            }
        }
    }

    pub fn install_available_packages<const FORCE: bool>(&mut self, log_level: Options::LogLevel) {
        // TODO(port): defer save/restore of self.node_modules / self.current_tree_id.
        // Zig does a struct-copy of NodeModulesFolder (ptr+len+cap) and restores on scope
        // exit. In Rust this needs `core::mem::take` + scopeguard, but scopeguard cannot
        // capture `&mut self` alongside the loop body's `&mut self`. Phase B: hoist into
        // a helper that takes the saved values by move and restores after the loop.
        let prev_node_modules = core::mem::take(&mut self.node_modules);
        let prev_tree_id = self.current_tree_id;

        let trees_len = self.trees.len();
        for i in 0..trees_len {
            // PORT NOTE: reshaped for borrowck — index instead of iter_mut.
            if FORCE
                || Self::can_install_package_for_tree(
                    &self.completed_trees,
                    self.lockfile().buffers.trees.as_slice(),
                    // PERF(port): `i` ranges over `0..self.trees.len()`; tree
                    // IDs are u32 by construction.
                    i as u32,
                )
            {
                // If installing these packages completes the tree, we don't allow it
                // to call `installAvailablePackages` recursively. Starting at id 0 and
                // going up ensures we will reach any trees that will be able to install
                // packages upon completing the current tree
                //
                // PORT NOTE: spec iterates `tree.pending_installs.items` by struct
                // copy (each `context.path` is the same allocation that lives in
                // `pending_installs`) and `defer clearRetainingCapacity()` at the end.
                // Drain by move (`mem::take`) to transfer ownership without the
                // O(pending_installs) extra `.clone()` allocations and to leave
                // `pending_installs` empty as the spec's defer does.
                // `self.resolutions` is `RawSlice<Resolution>` (Copy); copy
                // it out so the `&Resolution` argument below borrows the
                // local, not `*self`, across the `&mut self` call.
                let resolutions = self.resolutions;
                for context in core::mem::take(&mut self.trees[i].pending_installs) {
                    let package_id = self.lockfile().buffers.resolutions.as_slice()
                        [context.dependency_id as usize];
                    let name = self.names[package_id as usize];
                    self.node_modules.tree_id = context.tree_id;
                    self.node_modules.path = context.path;
                    self.current_tree_id = context.tree_id;

                    const NEEDS_VERIFY: bool = false;
                    const IS_PENDING_PACKAGE_INSTALL: bool = true;
                    self.install_package_with_name_and_resolution::<NEEDS_VERIFY, IS_PENDING_PACKAGE_INSTALL>(
                        // This id might be different from the id used to enqueue the task. Important
                        // to use the correct one because the package might be aliased with a different
                        // name
                        context.dependency_id,
                        package_id,
                        log_level,
                        name,
                        &resolutions[package_id as usize],
                    );
                }
            }
        }

        self.node_modules = prev_node_modules;
        self.current_tree_id = prev_tree_id;
    }

    pub fn complete_remaining_scripts(&mut self, log_level: Options::LogLevel) {
        // PORT NOTE: reshaped for borrowck — drain by move since loop body needs `&mut
        // self.manager` and `spawn_package_lifecycle_scripts` consumes the list. Zig
        // iterated by struct copy and never re-read `pending_lifecycle_scripts` after.
        for entry in core::mem::take(&mut self.pending_lifecycle_scripts) {
            let package_name: Box<[u8]> = entry.list.package_name.clone();
            // .monotonic is okay because this value isn't modified from any other thread.
            // (Scripts are spawned on this thread.)
            while LifecycleScriptSubprocess::alive_count().load(Ordering::Relaxed)
                >= self.manager().options.max_concurrent_lifecycle_scripts
            {
                self.manager_mut().sleep();
            }

            let optional = entry.optional;
            let output_in_foreground = false;
            if let Err(err) = self.manager_mut().spawn_package_lifecycle_scripts(
                self.command_ctx,
                entry.list,
                optional,
                output_in_foreground,
                None,
            ) {
                if log_level != Options::LogLevel::Silent {
                    // PORT NOTE: zig used `comptime Output.prettyFmt(fmt, enable_ansi_colors)`
                    // — `Progress::log` takes a single `Arguments` so format inline.
                    if log_level.show_progress() {
                        self.progress_mut().log(format_args!(
                            "{}",
                            Output::pretty_fmt_rt(
                                format_args!(
                                    "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{}<r>: {}\n",
                                    bstr::BStr::new(&package_name),
                                    err.name(),
                                ),
                                Output::enable_ansi_colors_stderr(),
                            ),
                        ));
                    } else {
                        Output::pretty_errorln(format_args!(
                            "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{}<r>: {}\n",
                            bstr::BStr::new(&package_name),
                            err.name(),
                        ));
                    }
                }

                if self.manager().options.enable.fail_early() {
                    Global::exit(1);
                }

                Output::flush();
                self.summary.fail += 1;
            }
        }

        // .monotonic is okay because this value isn't modified from any other thread.
        while self
            .manager()
            .pending_lifecycle_script_tasks
            .load(Ordering::Relaxed)
            > 0
        {
            self.manager_mut().report_slow_lifecycle_scripts();

            if log_level.show_progress() {
                if let Some(scripts_node) = self.manager_mut().scripts_node_mut() {
                    scripts_node.activate();
                    self.manager_mut().progress.refresh();
                }
            }

            self.manager_mut().sleep();
        }
    }

    /// Check if a tree is ready to start running lifecycle scripts
    pub fn can_run_scripts(&self, scripts_tree_id: lockfile::tree::Id) -> bool {
        let deps = self
            .tree_ids_to_trees_the_id_depends_on
            .at(scripts_tree_id as usize);
        // .monotonic is okay because this value isn't modified from any other thread.
        (deps.subset_of(&self.completed_trees.unmanaged)
            || deps.eql(&self.completed_trees.unmanaged))
            && LifecycleScriptSubprocess::alive_count().load(Ordering::Relaxed)
                < self.manager().options.max_concurrent_lifecycle_scripts
    }

    /// A tree can start installing packages when the parent has installed all its packages. If the parent
    /// isn't finished, we need to wait because it's possible a package installed in this tree will be deleted by the parent.
    // PORT NOTE: free fn (not `&self`) so callers can pass disjoint borrows
    // (`&self.completed_trees` + `&self.lockfile().buffers.trees`) without
    // tripping borrowck on the whole-`self` reborrow.
    pub fn can_install_package_for_tree(
        completed_trees: &Bitset,
        trees: &[Tree],
        package_tree_id: lockfile::tree::Id,
    ) -> bool {
        let mut curr_tree_id = trees[package_tree_id as usize].parent;
        while curr_tree_id != lockfile::tree::INVALID_ID {
            if !completed_trees.is_set(curr_tree_id as usize) {
                return false;
            }
            curr_tree_id = trees[curr_tree_id as usize].parent;
        }

        true
    }

    // PORT NOTE: `pub fn deinit` dropped. All owned fields (`pending_lifecycle_scripts: Vec`,
    // `completed_trees: Bitset`, `trees: Box<[TreeContext]>`, `tree_ids_to_trees_the_id_depends_on`,
    // `node_modules`, `trusted_dependencies_from_update_requests`) impl Drop. Borrowed fields
    // (`manager`, `lockfile`, etc.) are not freed.

    /// Call when you mutate the length of `lockfile.packages`
    pub fn fix_cached_lockfile_package_slices(&mut self) {
        // These `RawSlice<T>` fields alias into `self.lockfile.packages`
        // (BACKREF). `RawSlice::new` stores the raw `(ptr, len)` without a
        // lifetime, so the borrow of `packages` ends at the end of each
        // statement — no `&'a → &'a` detach round-trip needed.
        // SAFETY (RawSlice invariant): `self.lockfile` is a BACKREF whose
        // pointee outlives `'a`; the packages column buffers are not freed for
        // the lifetime of this `PackageInstaller` (only grow, which is why
        // this fn exists — to re-snapshot after growth).
        let packages = self.lockfile_mut().packages.slice();
        self.metas = bun_ptr::RawSlice::new(packages.items_meta());
        self.names = bun_ptr::RawSlice::new(packages.items_name());
        self.pkg_name_hashes = bun_ptr::RawSlice::new(packages.items_name_hash());
        self.bins = bun_ptr::RawSlice::new(packages.items_bin());
        self.resolutions = bun_ptr::RawSlice::new(packages.items_resolution());
        self.pkg_dependencies = bun_ptr::RawSlice::new(packages.items_dependencies());

        // fixes an assertion failure where a transitive dependency is a git dependency newly added to the lockfile after the list of dependencies has been resized
        // this assertion failure would also only happen after the lockfile has been written to disk and the summary is being printed.
        if self.successfully_installed.bit_length() < self.lockfile().packages.len() {
            let new = Bitset::init_empty(self.lockfile().packages.len()).unwrap_or_oom();
            let old = core::mem::replace(&mut self.successfully_installed, new);
            old.copy_into(&mut self.successfully_installed);
            // PORT NOTE: `defer old.deinit(bun.default_allocator)` — Bitset impls Drop.
        }
    }

    /// Install versions of a package which are waiting on a network request
    pub fn install_enqueued_packages_after_extraction(
        &mut self,
        task_id: task::Id,
        dependency_id: DependencyID,
        data: &ExtractData,
        log_level: Options::LogLevel,
    ) {
        let package_id = self.lockfile().buffers.resolutions.as_slice()[dependency_id as usize];
        let name = self.names[package_id as usize];

        // const resolution = &this.resolutions[package_id];
        // const task_id = switch (resolution.tag) {
        //     .git => Task.Id.forGitCheckout(data.url, data.resolved),
        //     .github => Task.Id.forTarball(data.url),
        //     .local_tarball => Task.Id.forTarball(this.lockfile.str(&resolution.value.local_tarball)),
        //     .remote_tarball => Task.Id.forTarball(this.lockfile.str(&resolution.value.remote_tarball)),
        //     .npm => Task.Id.forNPMPackage(name.slice(this.lockfile.buffers.string_bytes.items), resolution.value.npm.version),
        //     else => unreachable,
        // };

        // If a newly computed integrity hash is available (e.g. for a GitHub
        // tarball) and the lockfile doesn't already have one, persist it so
        // the lockfile gets re-saved with the hash.
        if data.integrity.tag.is_supported() {
            let pkg_metas = self.lockfile_mut().packages.items_meta_mut();
            if !pkg_metas[package_id as usize].integrity.tag.is_supported() {
                pkg_metas[package_id as usize].integrity = data.integrity;
                self.manager_mut()
                    .options
                    .enable
                    .set(Options::Enable::FORCE_SAVE_LOCKFILE, true);
            }
        }

        if let Some(removed) = self.manager_mut().task_queue.fetch_remove(task_id) {
            let callbacks = removed.value;
            // PORT NOTE: `defer callbacks.deinit(this.manager.allocator)` — Vec drops.

            // TODO(port): defer save/restore of self.node_modules / self.current_tree_id.
            // See install_available_packages for the same issue.
            let prev_node_modules = core::mem::take(&mut self.node_modules);
            let prev_tree_id = self.current_tree_id;

            if callbacks.is_empty() {
                bun_output::scoped_log!(
                    PackageInstaller,
                    "Unexpected state: no callbacks for async task."
                );
                self.node_modules = prev_node_modules;
                self.current_tree_id = prev_tree_id;
                return;
            }

            // `self.resolutions` is `RawSlice<Resolution>` (Copy); copy out
            // so the `&Resolution` argument borrows the local, not `*self`.
            let resolutions = self.resolutions;
            for cb in callbacks.iter() {
                let TaskCallbackContext::DependencyInstallContext(context) = cb else {
                    debug_assert!(false, "expected DependencyInstallContext");
                    continue;
                };
                let callback_package_id =
                    self.lockfile().buffers.resolutions.as_slice()[context.dependency_id as usize];
                self.node_modules.tree_id = context.tree_id;
                // PORT NOTE: zig assigns `context.path` (ArrayList struct copy).
                // `DependencyInstallContext.path: Vec<u8>` — clone since `cb` is `&`.
                self.node_modules.path = context.path.clone();
                self.current_tree_id = context.tree_id;
                const NEEDS_VERIFY: bool = false;
                const IS_PENDING_PACKAGE_INSTALL: bool = false;
                self.install_package_with_name_and_resolution::<NEEDS_VERIFY, IS_PENDING_PACKAGE_INSTALL>(
                    // This id might be different from the id used to enqueue the task. Important
                    // to use the correct one because the package might be aliased with a different
                    // name
                    context.dependency_id,
                    callback_package_id,
                    log_level,
                    name,
                    &resolutions[callback_package_id as usize],
                );
            }
            self.node_modules = prev_node_modules;
            self.current_tree_id = prev_tree_id;
            return;
        }

        if cfg!(debug_assertions) {
            Output::panic(format_args!(
                "Ran callback to install enqueued packages, but there was no task associated with it. {}:{} (dependency_id: {})",
                bun_core::fmt::quote(name.slice(self.lockfile().buffers.string_bytes.as_slice())),
                bun_core::fmt::quote(&data.url),
                dependency_id,
            ));
        }
    }

    fn get_installed_package_scripts_count(
        &mut self,
        alias: &[u8],
        package_id: PackageID,
        resolution_tag: resolution::Tag,
        folder_path: &mut bun_paths::AutoAbsPath,
        log_level: Options::LogLevel,
    ) -> usize {
        if cfg!(debug_assertions) {
            debug_assert!(resolution_tag != resolution::Tag::Root);
            debug_assert!(resolution_tag != resolution::Tag::Workspace);
            debug_assert!(package_id != 0);
        }
        let mut count: usize = 0;
        let scripts = 'brk: {
            let scripts = self.lockfile().packages.items_scripts()[package_id as usize];
            if scripts.filled {
                break 'brk scripts;
            }

            let mut temp = PackageScripts::default();
            let mut temp_lockfile = Lockfile::default();
            temp_lockfile.init_empty();
            // PORT NOTE: `defer temp_lockfile.deinit()` — Lockfile impls Drop.
            let mut string_builder = temp_lockfile.string_builder();
            let log = self.manager().log_mut();
            if let Err(err) = temp.fill_from_package_json(&mut string_builder, log, folder_path) {
                if log_level != Options::LogLevel::Silent {
                    Output::err_generic(
                        "failed to fill lifecycle scripts for <b>{}<r>: {}",
                        (bstr::BStr::new(alias), err.name()),
                    );
                }

                if self.manager().options.enable.fail_early() {
                    Global::crash();
                }

                return 0;
            }
            break 'brk temp;
        };

        if cfg!(debug_assertions) {
            debug_assert!(scripts.filled);
        }

        match resolution_tag {
            resolution::Tag::Git | resolution::Tag::Github | resolution::Tag::Root => {
                // PORT NOTE: zig `inline for (Lockfile.Scripts.names) |hook| { @field(...) }`.
                // The `FIELD_NAMES` table lists each script field accessor.
                for &(_, accessor) in PackageScripts::FIELD_NAMES.iter() {
                    count += (!accessor(&scripts).is_empty()) as usize;
                }
            }
            _ => {
                // PORT NOTE: zig `inline for (.{"preinstall","install","postinstall"})` over @field.
                count += (!scripts.preinstall.is_empty()) as usize;
                count += (!scripts.install.is_empty()) as usize;
                count += (!scripts.postinstall.is_empty()) as usize;
            }
        }

        if scripts.preinstall.is_empty() && scripts.install.is_empty() {
            let binding_dot_gyp_path = join_abs_string_z::<platform::Auto>(
                self.node_modules.path.as_slice(),
                &[alias, b"binding.gyp"],
            );
            count += Syscall::exists(binding_dot_gyp_path) as usize;
        }

        count
    }

    fn get_patchfile_hash(patchfile_path: &[u8]) -> Option<u64> {
        let _ = patchfile_path; // autofix
        // TODO(port): zig body has no return statement (relies on lazy compilation / dead code).
        None
    }

    pub fn install_package_with_name_and_resolution<
        // false when coming from download. if the package was downloaded
        // it was already determined to need an install
        const NEEDS_VERIFY: bool,
        // we don't want to allow more package installs through
        // pending packages if we're already draining them.
        const IS_PENDING_PACKAGE_INSTALL: bool,
    >(
        &mut self,
        dependency_id: DependencyID,
        package_id: PackageID,
        log_level: Options::LogLevel,
        pkg_name: String,
        resolution: &Resolution,
    ) {
        // PORT NOTE: reshaped for borrowck — `string_bytes` is not mutated during install,
        // so capture a raw slice once to avoid repeatedly re-borrowing `self.lockfile`
        // across `&mut self` method calls below (Zig accessed `lockfile.buffers.string_bytes`
        // freely inline). SAFETY: `buffers.string_bytes` is append-only and never freed
        // for the lifetime of this `PackageInstaller`.
        let string_buf_ptr =
            bun_ptr::RawSlice::new(self.lockfile().buffers.string_bytes.as_slice());
        macro_rules! string_buf {
            () => {
                string_buf_ptr.slice()
            };
        }

        let alias = self.lockfile().buffers.dependencies.as_slice()[dependency_id as usize].name;
        // PORT NOTE: `PackageInstall` stores both `destination_dir_subpath: &mut ZStr`
        // and `destination_dir_subpath_buf: &mut [u8]` aliasing the same bytes (Zig
        // slices don't enforce noalias). Derive BOTH from a single `*mut PathBuffer`
        // so neither `&mut` invalidates the other under stacked-borrows.
        let subpath_buf_ptr: *mut PathBuffer = &raw mut self.destination_dir_subpath_buf;
        let destination_dir_subpath: &mut ZStr = {
            let alias_slice = alias.slice(string_buf!());
            // SAFETY: `subpath_buf_ptr` is the unique borrow of the field; valid for
            // the lifetime of this fn body.
            let buf = unsafe { &mut *subpath_buf_ptr };
            buf[..alias_slice.len()].copy_from_slice(alias_slice);
            buf[alias_slice.len()] = 0;
            // SAFETY: buf[alias_slice.len()] == 0 written above; pointer derives from
            // `subpath_buf_ptr` so it shares provenance with `destination_dir_subpath_buf`
            // below.
            unsafe { ZStr::from_raw_mut((*subpath_buf_ptr).as_mut_ptr(), alias_slice.len()) }
        };

        let pkg_name_hash = self.pkg_name_hashes[package_id as usize];

        let mut resolution_buf = [0u8; 512];
        let package_version: &[u8] = if resolution.tag == resolution::Tag::Workspace {
            'brk: {
                if let Some(workspace_version) = self
                    .manager()
                    .lockfile
                    .workspace_versions
                    .get(&pkg_name_hash)
                {
                    // TODO(port): std.fmt.bufPrint — write into &mut [u8], return written slice
                    break 'brk bun_core::fmt::buf_print(
                        &mut resolution_buf,
                        format_args!("{}", workspace_version.fmt(string_buf!())),
                    )
                    .expect("unreachable");
                }

                // no version
                break 'brk b"";
            }
        } else {
            bun_core::fmt::buf_print(
                &mut resolution_buf,
                format_args!("{}", resolution.fmt(string_buf!(), PathSep::Posix)),
            )
            .expect("unreachable")
        };

        let (patch_patch, patch_contents_hash, patch_name_and_version_hash, remove_patch) = 'brk: {
            if self.manager().lockfile.patched_dependencies.count() == 0
                && self.manager().patched_dependencies_to_remove.count() == 0
            {
                break 'brk (None, None, None, false);
            }
            // PERF(port): was stack-fallback
            let mut name_and_version: Vec<u8> = Vec::new();
            use std::io::Write;
            write!(
                &mut name_and_version,
                "{}@{}",
                bstr::BStr::new(pkg_name.slice(string_buf!())),
                bstr::BStr::new(package_version),
            )
            .expect("unreachable");

            let name_and_version_hash = bun_semver::string::Builder::string_hash(&name_and_version);

            let Some(patchdep) = self
                .lockfile()
                .patched_dependencies
                .get(&name_and_version_hash)
            else {
                let to_remove = self
                    .manager()
                    .patched_dependencies_to_remove
                    .contains(&name_and_version_hash);
                if to_remove {
                    break 'brk (None, None, Some(name_and_version_hash), true);
                }
                break 'brk (None, None, None, false);
            };
            debug_assert!(!patchdep.patchfile_hash_is_null);
            // if (!patchdep.patchfile_hash_is_null) {
            //     this.manager.enqueuePatchTask(PatchTask.newCalcPatchHash(this, package_id, name_and_version_hash, dependency_id, url: string))
            // }
            break 'brk (
                Some(patchdep.path.slice(string_buf!())),
                Some(patchdep.patchfile_hash().unwrap()),
                Some(name_and_version_hash),
                false,
            );
        };

        // PORT NOTE: reshaped for borrowck — `PackageInstall` borrows several `self.*`
        // fields while subsequent code also accesses `self.manager` / `self.node_modules`
        // / `self.lockfile` mutably (Zig aliased freely). Detach the borrows via a
        // `ParentRef` so `installer`'s lifetime is independent of `&mut self`.
        // BACKREF — none of these fields are dropped, moved, or resized while
        // `installer` is alive (matches Zig invariant; see `PackageInstaller` field docs).
        let node_modules_ref = bun_ptr::ParentRef::<NodeModulesFolder>::new(&self.node_modules);
        let mut installer = PackageInstall {
            progress: if self.manager().options.log_level.show_progress() {
                Some(self.progress_mut())
            } else {
                None
            },
            cache_dir: Dir::from_fd(Fd::INVALID), // assigned below
            destination_dir_subpath,
            destination_dir_subpath_buf: unsafe { (*subpath_buf_ptr).as_mut_slice() },
            // PORT NOTE: zig `arena: this.lockfile.allocator` dropped — global mimalloc.
            package_name: pkg_name,
            patch: patch_patch.map(|p| package_install::Patch {
                contents_hash: patch_contents_hash.unwrap(),
                path: Box::<[u8]>::from(p),
            }),
            package_version,
            node_modules: node_modules_ref.get(),
            // BACKREF accessor — `self.lockfile` is `*mut Lockfile` (never null,
            // outlives `'a`); `lockfile()` centralises the raw deref so this
            // site stays safe.
            lockfile: self.lockfile(),
            cache_dir_subpath: ZStr::EMPTY,
            file_count: 0,
        };
        bun_output::scoped_log!(
            PackageInstaller,
            "Installing {}@{}",
            bstr::BStr::new(pkg_name.slice(string_buf!())),
            resolution.fmt(string_buf!(), PathSep::Posix),
        );

        match resolution.tag {
            resolution::Tag::Npm => {
                installer.cache_dir_subpath = package_manager::cached_npm_package_folder_name(
                    self.manager_mut(),
                    pkg_name.slice(string_buf!()),
                    resolution.npm().version,
                    patch_contents_hash,
                );
                installer.cache_dir = package_manager::get_cache_directory(self.manager_mut());
            }
            resolution::Tag::Git => {
                installer.cache_dir_subpath = package_manager::cached_git_folder_name(
                    self.manager_mut(),
                    resolution.git(),
                    patch_contents_hash,
                );
                installer.cache_dir = package_manager::get_cache_directory(self.manager_mut());
            }
            resolution::Tag::Github => {
                installer.cache_dir_subpath = package_manager::cached_github_folder_name(
                    self.manager_mut(),
                    resolution.github(),
                    patch_contents_hash,
                );
                installer.cache_dir = package_manager::get_cache_directory(self.manager_mut());
            }
            resolution::Tag::Folder => {
                let folder_str = *resolution.folder();
                let folder = folder_str.slice(string_buf!());

                if self.lockfile().is_workspace_tree_id(self.current_tree_id) {
                    // Handle when a package depends on itself via file:
                    // example:
                    //   "mineflayer": "file:."
                    if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                        installer.cache_dir_subpath = ZStr::from_static(b".\0");
                    } else {
                        self.folder_path_buf[..folder.len()].copy_from_slice(folder);
                        self.folder_path_buf[folder.len()] = 0;
                        installer.cache_dir_subpath =
                            ZStr::from_buf(&self.folder_path_buf, folder.len());
                    }
                    installer.cache_dir = bun_sys::cwd();
                } else {
                    // transitive folder dependencies are relative to their parent. they are not hoisted
                    self.folder_path_buf[..folder.len()].copy_from_slice(folder);
                    self.folder_path_buf[folder.len()] = 0;
                    // SAFETY: buf[folder.len()] == 0 written above
                    installer.cache_dir_subpath =
                        ZStr::from_buf(&self.folder_path_buf, folder.len());

                    // cache_dir might not be created yet (if it's in node_modules)
                    installer.cache_dir = bun_sys::cwd();
                }
            }
            resolution::Tag::LocalTarball => {
                installer.cache_dir_subpath = package_manager::cached_tarball_folder_name(
                    self.manager_mut(),
                    *resolution.local_tarball(),
                    patch_contents_hash,
                );
                installer.cache_dir = package_manager::get_cache_directory(self.manager_mut());
            }
            resolution::Tag::RemoteTarball => {
                installer.cache_dir_subpath = package_manager::cached_tarball_folder_name(
                    self.manager_mut(),
                    *resolution.remote_tarball(),
                    patch_contents_hash,
                );
                installer.cache_dir = package_manager::get_cache_directory(self.manager_mut());
            }
            resolution::Tag::Workspace => {
                let folder_str = *resolution.workspace();
                let folder = folder_str.slice(string_buf!());
                // Handle when a package depends on itself
                if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                    installer.cache_dir_subpath = ZStr::from_static(b".\0");
                } else {
                    self.folder_path_buf[..folder.len()].copy_from_slice(folder);
                    self.folder_path_buf[folder.len()] = 0;
                    // SAFETY: buf[folder.len()] == 0 written above
                    installer.cache_dir_subpath =
                        ZStr::from_buf(&self.folder_path_buf, folder.len());
                }
                installer.cache_dir = bun_sys::cwd();
            }
            resolution::Tag::Root => {
                installer.cache_dir_subpath = ZStr::from_static(b".\0");
                installer.cache_dir = bun_sys::cwd();
            }
            resolution::Tag::Symlink => {
                let directory = package_manager::global_link_dir(self.manager_mut());

                let folder_str = *resolution.symlink();
                let folder = folder_str.slice(string_buf!());

                if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                    installer.cache_dir_subpath = ZStr::from_static(b".\0");
                    installer.cache_dir = bun_sys::cwd();
                } else {
                    let global_link_dir = package_manager::global_link_dir_path(self.manager_mut());
                    let buf = self.folder_path_buf.as_mut_slice();
                    let mut len = 0usize;
                    buf[len..len + global_link_dir.len()].copy_from_slice(global_link_dir);
                    len += global_link_dir.len();
                    if global_link_dir[global_link_dir.len() - 1] != SEP {
                        buf[len] = SEP;
                        len += 1;
                    }
                    buf[len..len + folder.len()].copy_from_slice(folder);
                    len += folder.len();
                    buf[len] = 0;
                    // SAFETY: buf[len] == 0 written above
                    installer.cache_dir_subpath = ZStr::from_buf(&self.folder_path_buf, len);
                    installer.cache_dir = directory;
                }
            }
            _ => {
                if cfg!(debug_assertions) {
                    panic!("Internal assertion failure: unexpected resolution tag");
                }
                self.increment_tree_install_count(
                    !IS_PENDING_PACKAGE_INSTALL,
                    self.current_tree_id,
                    log_level,
                );
                return;
            }
        }

        let needs_install = self.force_install
            || self.skip_verify_installed_version_number
            || !NEEDS_VERIFY
            || remove_patch
            || !installer.verify(resolution, self.root_node_modules_folder);
        self.summary.skipped += (!needs_install) as u32;

        if needs_install {
            if resolution.tag.can_enqueue_install_task()
                && installer.package_missing_from_cache(
                    self.manager_mut(),
                    package_id,
                    resolution.tag,
                )
            {
                if cfg!(debug_assertions) {
                    debug_assert!(resolution.can_enqueue_install_task());
                }

                let context =
                    TaskCallbackContext::DependencyInstallContext(DependencyInstallContext {
                        tree_id: self.current_tree_id,
                        path: self.node_modules.path.clone(),
                        dependency_id,
                    });
                match resolution.tag {
                    resolution::Tag::Git => {
                        package_manager::enqueue_git_for_checkout(
                            self.manager_mut(),
                            dependency_id,
                            alias.slice(string_buf!()),
                            resolution,
                            context,
                            patch_name_and_version_hash,
                        );
                    }
                    resolution::Tag::Github => {
                        let url = self.manager_mut().alloc_github_url(resolution.github());
                        // PORT NOTE: `defer this.manager.allocator.free(url)` — url: Vec<u8> drops.
                        match package_manager::enqueue_tarball_for_download(
                            self.manager_mut(),
                            dependency_id,
                            package_id,
                            &url,
                            context,
                            patch_name_and_version_hash,
                        ) {
                            Ok(()) => {}
                            Err(ForTarballError::OutOfMemory) => bun_core::out_of_memory(),
                            Err(ForTarballError::InvalidURL) => {
                                self.fail_with_invalid_url::<IS_PENDING_PACKAGE_INSTALL>(log_level)
                            }
                        }
                    }
                    resolution::Tag::LocalTarball => {
                        package_manager::enqueue_tarball_for_reading(
                            self.manager_mut(),
                            dependency_id,
                            package_id,
                            alias.slice(string_buf!()),
                            resolution,
                            context,
                        );
                    }
                    resolution::Tag::RemoteTarball => {
                        match package_manager::enqueue_tarball_for_download(
                            self.manager_mut(),
                            dependency_id,
                            package_id,
                            resolution.remote_tarball().slice(string_buf!()),
                            context,
                            patch_name_and_version_hash,
                        ) {
                            Ok(()) => {}
                            Err(ForTarballError::OutOfMemory) => bun_core::out_of_memory(),
                            Err(ForTarballError::InvalidURL) => {
                                self.fail_with_invalid_url::<IS_PENDING_PACKAGE_INSTALL>(log_level)
                            }
                        }
                    }
                    resolution::Tag::Npm => {
                        let npm = *resolution.npm();
                        #[cfg(debug_assertions)]
                        {
                            // Very old versions of Bun didn't store the tarball url when it didn't seem necessary
                            // This caused bugs. We can't assert on it because they could come from old lockfiles
                            if npm.url.is_empty() {
                                Output::debug_warn(format_args!(
                                    "package {}@{} missing tarball_url",
                                    bstr::BStr::new(pkg_name.slice(string_buf!())),
                                    resolution.fmt(string_buf!(), PathSep::Posix),
                                ));
                            }
                        }

                        match package_manager::enqueue_package_for_download(
                            self.manager_mut(),
                            pkg_name.slice(string_buf!()),
                            dependency_id,
                            package_id,
                            npm.version,
                            npm.url.slice(string_buf!()),
                            context,
                            patch_name_and_version_hash,
                        ) {
                            Ok(()) => {}
                            Err(ForTarballError::OutOfMemory) => bun_core::out_of_memory(),
                            Err(ForTarballError::InvalidURL) => {
                                self.fail_with_invalid_url::<IS_PENDING_PACKAGE_INSTALL>(log_level)
                            }
                        }
                    }
                    _ => {
                        if cfg!(debug_assertions) {
                            panic!("unreachable, handled above");
                        }
                        self.increment_tree_install_count(
                            !IS_PENDING_PACKAGE_INSTALL,
                            self.current_tree_id,
                            log_level,
                        );
                        self.summary.fail += 1;
                    }
                }

                return;
            }

            // above checks if unpatched package is in cache, if not null apply patch in temp directory, copy
            // into cache, then install into node_modules
            if let Some(patch_contents_hash) = installer.patch.as_ref().map(|p| p.contents_hash) {
                if installer.patched_package_missing_from_cache(self.manager_mut(), package_id) {
                    let task: *mut PatchTask = PatchTask::new_apply_patch_hash(
                        self.manager_mut(),
                        package_id,
                        patch_contents_hash,
                        patch_name_and_version_hash.unwrap(),
                    );
                    // SAFETY: `task` was just `heap::alloc`'d in `new_apply_patch_hash`;
                    // we hold the only pointer until `enqueue_patch_task` takes ownership.
                    if let patch_install::Callback::Apply(apply) = unsafe { &mut (*task).callback }
                    {
                        apply.install_context = Some(patch_install::InstallContext {
                            dependency_id,
                            tree_id: self.current_tree_id,
                            path: self.node_modules.path.clone(),
                        });
                    }
                    package_manager::enqueue_patch_task(self.manager_mut(), task);
                    return;
                }
            }

            if !IS_PENDING_PACKAGE_INSTALL
                && !Self::can_install_package_for_tree(
                    &self.completed_trees,
                    self.lockfile().buffers.trees.as_slice(),
                    self.current_tree_id,
                )
            {
                self.trees[self.current_tree_id as usize]
                    .pending_installs
                    .push(DependencyInstallContext {
                        dependency_id,
                        tree_id: self.current_tree_id,
                        path: self.node_modules.path.clone(),
                    });
                return;
            }

            // creating this directory now, right before installing package
            let mut destination_dir = match self
                .node_modules
                .make_and_open_dir(self.root_node_modules_folder)
            {
                Ok(d) => d,
                Err(err) => {
                    if log_level != Options::LogLevel::Silent {
                        Output::err(
                            err,
                            "Failed to open node_modules folder for <r><red>{}<r> in {}",
                            (
                                bstr::BStr::new(pkg_name.slice(string_buf!())),
                                bun_core::fmt::fmt_path(
                                    self.node_modules.path.as_slice(),
                                    Default::default(),
                                ),
                            ),
                        );
                    }
                    self.summary.fail += 1;
                    self.increment_tree_install_count(
                        !IS_PENDING_PACKAGE_INSTALL,
                        self.current_tree_id,
                        log_level,
                    );
                    return;
                }
            };

            // TODO(port): `defer { if (cwd().fd != destination_dir.fd) destination_dir.close(); }`
            // — needs scopeguard since there are no early returns past this point in this branch,
            // but the match arms below do not return early either. Manual close at end of branch.
            let _close_destination_dir = scopeguard::guard(destination_dir, |mut d| {
                if bun_sys::cwd().fd() != d.fd() {
                    d.close();
                }
            });

            let mut lazy_package_dir = LazyPackageDestinationDir::Dir(destination_dir);

            let install_result: package_install::InstallResult = match resolution.tag {
                resolution::Tag::Symlink | resolution::Tag::Workspace => {
                    installer.install_from_link(self.skip_delete, destination_dir)
                }
                _ => 'result: {
                    if resolution.tag == resolution::Tag::Root
                        || (resolution.tag == resolution::Tag::Folder
                            && !self.lockfile().is_workspace_tree_id(self.current_tree_id))
                    {
                        // This is a transitive folder dependency. It is installed with a single symlink to the target folder/file,
                        // and is not hoisted.
                        let dir_name = {
                            let d = dirname::<platform::Auto>(self.node_modules.path.as_slice());
                            if d.is_empty() {
                                self.node_modules.path.as_slice()
                            } else {
                                d
                            }
                        };

                        installer.cache_dir = match self.root_node_modules_folder.open_dir(
                            dir_name,
                            bun_sys::OpenDirOptions {
                                iterate: true,
                                ..Default::default()
                            },
                        ) {
                            Ok(d) => d,
                            Err(err) => {
                                break 'result package_install::InstallResult::fail(
                                    err,
                                    package_install::Step::OpeningCacheDir,
                                    // TODO(port): @errorReturnTrace()
                                    None,
                                );
                            }
                        };

                        let result = if resolution.tag == resolution::Tag::Root {
                            installer.install_from_link(self.skip_delete, destination_dir)
                        } else {
                            installer.install(
                                self.skip_delete,
                                destination_dir,
                                installer.get_install_method(),
                                resolution.tag,
                            )
                        };

                        if let package_install::InstallResult::Failure(f) = &result {
                            if f.err == bun_core::err!("ENOENT")
                                || f.err == bun_core::err!("FileNotFound")
                            {
                                break 'result package_install::InstallResult::Success;
                            }
                        }

                        break 'result result;
                    }

                    break 'result installer.install(
                        self.skip_delete,
                        destination_dir,
                        installer.get_install_method(),
                        resolution.tag,
                    );
                }
            };

            match install_result {
                package_install::InstallResult::Success => {
                    let is_duplicate = self.successfully_installed.is_set(package_id as usize);
                    self.summary.success += (!is_duplicate) as u32;
                    self.successfully_installed.set(package_id as usize);

                    if log_level.show_progress() {
                        self.node.complete_one();
                    }

                    if self.bins[package_id as usize].tag != bin::Tag::None {
                        self.trees[self.current_tree_id as usize]
                            .binaries
                            .add(dependency_id)
                            .unwrap_or_oom();
                    }

                    let dep =
                        &self.lockfile().buffers.dependencies.as_slice()[dependency_id as usize];
                    let dep_behavior = dep.behavior;
                    let truncated_dep_name_hash: TruncatedPackageNameHash =
                        dep.name_hash as TruncatedPackageNameHash;
                    let (is_trusted, is_trusted_through_update_request) = 'brk: {
                        if self
                            .trusted_dependencies_from_update_requests
                            .contains(&truncated_dep_name_hash)
                        {
                            break 'brk (true, true);
                        }
                        if self
                            .lockfile()
                            .has_trusted_dependency(alias.slice(string_buf!()), resolution)
                        {
                            break 'brk (true, false);
                        }
                        break 'brk (false, false);
                    };

                    if resolution.tag != resolution::Tag::Root
                        && (resolution.tag == resolution::Tag::Workspace || is_trusted)
                    {
                        let mut folder_path =
                            AutoAbsPath::from(self.node_modules.path.as_slice()).unwrap_or_oom();
                        // PORT NOTE: `defer folder_path.deinit()` — AbsPath impls Drop.
                        folder_path
                            .append(alias.slice(string_buf!()))
                            .unwrap_or_oom();

                        'enqueue_lifecycle_scripts: {
                            if self
                                .manager()
                                .postinstall_optimizer
                                .should_ignore_lifecycle_scripts(
                                    postinstall_optimizer::PkgInfo {
                                        name_hash: pkg_name_hash,
                                        version: if resolution.tag == resolution::Tag::Npm {
                                            Some(resolution.npm().version)
                                        } else {
                                            None
                                        },
                                        version_buf: string_buf!(),
                                    },
                                    self.lockfile().packages.items_resolutions()
                                        [package_id as usize]
                                        .get(self.lockfile().buffers.resolutions.as_slice()),
                                    self.lockfile().packages.items_meta(),
                                    self.manager().options.cpu,
                                    self.manager().options.os,
                                    Some(self.current_tree_id),
                                )
                            {
                                if PackageManager::verbose_install() {
                                    Output::pretty_errorln(format_args!(
                                        "<d>[Lifecycle Scripts]<r> ignoring {} lifecycle scripts",
                                        bstr::BStr::new(pkg_name.slice(string_buf!())),
                                    ));
                                }
                                break 'enqueue_lifecycle_scripts;
                            }

                            if self.enqueue_lifecycle_scripts(
                                alias.slice(string_buf!()),
                                log_level,
                                &mut folder_path,
                                package_id,
                                dep_behavior.contains(crate::dependency::Behavior::OPTIONAL),
                                resolution,
                            ) {
                                if is_trusted_through_update_request {
                                    self.manager_mut()
                                        .trusted_deps_to_add_to_package_json
                                        .push(Box::<[u8]>::from(alias.slice(string_buf!())));

                                    if self.lockfile().trusted_dependencies.is_none() {
                                        self.lockfile_mut().trusted_dependencies =
                                            Some(Default::default());
                                    }
                                    self.lockfile_mut()
                                        .trusted_dependencies
                                        .as_mut()
                                        .unwrap()
                                        .put(truncated_dep_name_hash, ())
                                        .unwrap_or_oom();
                                }
                            }
                        }
                    }

                    match resolution.tag {
                        resolution::Tag::Root | resolution::Tag::Workspace => {
                            // these will never be blocked
                        }
                        _ => {
                            if !is_trusted && self.metas[package_id as usize].has_install_script() {
                                // Check if the package actually has scripts. `hasInstallScript` can be false positive if a package is published with
                                // an auto binding.gyp rebuild script but binding.gyp is excluded from the published files.
                                let mut folder_path =
                                    AutoAbsPath::from(self.node_modules.path.as_slice())
                                        .unwrap_or_oom();
                                folder_path
                                    .append(alias.slice(string_buf!()))
                                    .unwrap_or_oom();

                                let count = self.get_installed_package_scripts_count(
                                    alias.slice(string_buf!()),
                                    package_id,
                                    resolution.tag,
                                    &mut folder_path,
                                    log_level,
                                );
                                if count > 0 {
                                    if log_level.is_verbose() {
                                        Output::pretty_error(format_args!(
                                            "Blocked {} scripts for: {}@{}\n",
                                            count,
                                            bstr::BStr::new(alias.slice(string_buf!())),
                                            resolution.fmt(string_buf!(), PathSep::Posix),
                                        ));
                                    }
                                    let entry = self
                                        .summary
                                        .packages_with_blocked_scripts
                                        .get_or_put(truncated_dep_name_hash)
                                        .unwrap_or_oom();
                                    if !entry.found_existing {
                                        *entry.value_ptr = 0;
                                    }
                                    *entry.value_ptr += count;
                                }
                            }
                        }
                    }

                    self.increment_tree_install_count(
                        !IS_PENDING_PACKAGE_INSTALL,
                        self.current_tree_id,
                        log_level,
                    );
                }
                package_install::InstallResult::Failure(cause) => {
                    if cfg!(debug_assertions) {
                        debug_assert!(
                            !cause.is_package_missing_from_cache()
                                || (resolution.tag != resolution::Tag::Symlink
                                    && resolution.tag != resolution::Tag::Workspace)
                        );
                    }

                    // even if the package failed to install, we still need to increment the install
                    // counter for this tree
                    self.increment_tree_install_count(
                        !IS_PENDING_PACKAGE_INSTALL,
                        self.current_tree_id,
                        log_level,
                    );

                    if cause.err == bun_core::err!("DanglingSymlink") {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r>: <b>{}<r> \"link:{}\" not found (try running 'bun link' in the intended package's folder)<r>",
                            cause.err.name(),
                            bstr::BStr::new(self.names[package_id as usize].slice(string_buf!())),
                        ));
                        self.summary.fail += 1;
                    } else if cause.err == bun_core::err!("AccessDenied") {
                        // there are two states this can happen
                        // - Access Denied because node_modules/ is unwritable
                        // - Access Denied because this specific package is unwritable
                        // in the case of the former, the logs are extremely noisy, so we
                        // will exit early, otherwise set a flag to not re-stat
                        // PORT NOTE: zig fn-local `const Singleton = struct { var node_modules_is_ok = false; }`
                        // — translated to a module-level static since Rust lacks fn-local mutable statics.
                        static NODE_MODULES_IS_OK: core::sync::atomic::AtomicBool =
                            core::sync::atomic::AtomicBool::new(false);
                        if !NODE_MODULES_IS_OK.load(Ordering::Relaxed) {
                            #[cfg(not(windows))]
                            {
                                let dir = match lazy_package_dir.get_dir() {
                                    Ok(d) => d,
                                    Err(err) => {
                                        Output::err_tag(
                                            "EACCES",
                                            format_args!(
                                                "Permission denied while installing <b>{}<r>",
                                                bstr::BStr::new(
                                                    self.names[package_id as usize].slice(
                                                        self.lockfile()
                                                            .buffers
                                                            .string_bytes
                                                            .as_slice()
                                                    )
                                                ),
                                            ),
                                        );
                                        if cfg!(debug_assertions) {
                                            Output::err(err, "Failed to stat node_modules", ());
                                        }
                                        Global::exit(1);
                                    }
                                };
                                let stat = match bun_sys::fstat(Fd::from_std_dir(&dir)) {
                                    Ok(s) => s,
                                    Err(err) => {
                                        Output::err_tag(
                                            "EACCES",
                                            format_args!(
                                                "Permission denied while installing <b>{}<r>",
                                                bstr::BStr::new(
                                                    self.names[package_id as usize].slice(
                                                        self.lockfile()
                                                            .buffers
                                                            .string_bytes
                                                            .as_slice()
                                                    )
                                                ),
                                            ),
                                        );
                                        if cfg!(debug_assertions) {
                                            Output::err(err, "Failed to stat node_modules", ());
                                        }
                                        Global::exit(1);
                                    }
                                };

                                // `bun_sys::c::getuid`/`getgid` are local `safe fn`
                                // redecls (zero args, read kernel process state —
                                // no preconditions), so no `unsafe` needed.
                                // `st_mode` is u16 on FreeBSD, u32 elsewhere; widen.
                                let st_mode = stat.st_mode as u32;
                                let is_writable = if stat.st_uid == bun_sys::c::getuid() {
                                    st_mode & bun_sys::S::IWUSR as u32 > 0
                                } else if stat.st_gid == bun_sys::c::getgid() {
                                    st_mode & bun_sys::S::IWGRP as u32 > 0
                                } else {
                                    st_mode & bun_sys::S::IWOTH as u32 > 0
                                };

                                if !is_writable {
                                    Output::err_tag(
                                        "EACCES",
                                        format_args!(
                                            "Permission denied while writing packages into node_modules."
                                        ),
                                    );
                                    Global::exit(1);
                                }
                            }
                            NODE_MODULES_IS_OK.store(true, Ordering::Relaxed);
                        }

                        Output::err_tag(
                            "EACCES",
                            format_args!(
                                "Permission denied while installing <b>{}<r>",
                                bstr::BStr::new(
                                    self.names[package_id as usize].slice(string_buf!())
                                ),
                            ),
                        );

                        self.summary.fail += 1;
                    } else {
                        Output::err(
                            cause.err,
                            "failed {} for package <b>{}<r>",
                            (
                                bstr::BStr::new(cause.step.name()),
                                bstr::BStr::new(
                                    self.names[package_id as usize].slice(string_buf!()),
                                ),
                            ),
                        );
                        #[cfg(debug_assertions)]
                        {
                            let mut t = cause.debug_trace;
                            bun_crash_handler::dump_stack_trace(&t.trace(), Default::default());
                        }
                        self.summary.fail += 1;
                    }
                }
            }
        } else {
            if self.bins[package_id as usize].tag != bin::Tag::None {
                self.trees[self.current_tree_id as usize]
                    .binaries
                    .add(dependency_id)
                    .unwrap_or_oom();
            }

            // PORT NOTE: reshaped for borrowck — `LazyPackageDestinationDir` borrows
            // `&self.node_modules`, but this else-branch never reads `destination_dir`
            // (it only `close()`s it at the end, which is a no-op for `NodeModulesPath`).
            // Detach via raw ptr so subsequent `&mut self` calls type-check.
            // BACKREF — `self.node_modules` is not moved/dropped in this branch.
            let mut destination_dir = LazyPackageDestinationDir::NodeModulesPath {
                node_modules: node_modules_ref.get(),
                root_node_modules_dir: self.root_node_modules_folder,
            };

            // PORT NOTE: `defer { destination_dir.close(); }` + `defer increment_tree_install_count`.
            // No early returns in this branch, so manual calls at end are equivalent.

            let dep = &self.lockfile().buffers.dependencies.as_slice()[dependency_id as usize];
            let dep_behavior = dep.behavior;
            let truncated_dep_name_hash: TruncatedPackageNameHash =
                dep.name_hash as TruncatedPackageNameHash;
            let (is_trusted, is_trusted_through_update_request, add_to_lockfile) = 'brk: {
                // trusted through a --trust dependency. need to enqueue scripts, write to package.json, and add to lockfile
                if self
                    .trusted_dependencies_from_update_requests
                    .contains(&truncated_dep_name_hash)
                {
                    break 'brk (true, true, true);
                }

                if let Some(should_add_to_lockfile) = self
                    .manager()
                    .summary
                    .added_trusted_dependencies
                    .get(&truncated_dep_name_hash)
                {
                    // is a new trusted dependency. need to enqueue scripts and maybe add to lockfile
                    break 'brk (true, false, *should_add_to_lockfile);
                }
                break 'brk (false, false, false);
            };

            if resolution.tag != resolution::Tag::Root && is_trusted {
                let mut folder_path =
                    AutoAbsPath::from(self.node_modules.path.as_slice()).unwrap_or_oom();
                folder_path
                    .append(alias.slice(string_buf!()))
                    .unwrap_or_oom();

                'enqueue_lifecycle_scripts: {
                    if self
                        .manager()
                        .postinstall_optimizer
                        .should_ignore_lifecycle_scripts(
                            postinstall_optimizer::PkgInfo {
                                name_hash: pkg_name_hash,
                                version: if resolution.tag == resolution::Tag::Npm {
                                    Some(resolution.npm().version)
                                } else {
                                    None
                                },
                                version_buf: string_buf!(),
                            },
                            self.lockfile().packages.items_resolutions()[package_id as usize]
                                .get(self.lockfile().buffers.resolutions.as_slice()),
                            self.lockfile().packages.items_meta(),
                            self.manager().options.cpu,
                            self.manager().options.os,
                            Some(self.current_tree_id),
                        )
                    {
                        if PackageManager::verbose_install() {
                            Output::pretty_errorln(format_args!(
                                "<d>[Lifecycle Scripts]<r> ignoring {} lifecycle scripts",
                                bstr::BStr::new(pkg_name.slice(string_buf!())),
                            ));
                        }
                        break 'enqueue_lifecycle_scripts;
                    }

                    if self.enqueue_lifecycle_scripts(
                        alias.slice(string_buf!()),
                        log_level,
                        &mut folder_path,
                        package_id,
                        dep_behavior.contains(crate::dependency::Behavior::OPTIONAL),
                        resolution,
                    ) {
                        if is_trusted_through_update_request {
                            self.manager_mut()
                                .trusted_deps_to_add_to_package_json
                                .push(Box::<[u8]>::from(alias.slice(string_buf!())));
                        }

                        if add_to_lockfile {
                            if self.lockfile().trusted_dependencies.is_none() {
                                self.lockfile_mut().trusted_dependencies = Some(Default::default());
                            }
                            self.lockfile_mut()
                                .trusted_dependencies
                                .as_mut()
                                .unwrap()
                                .put(truncated_dep_name_hash, ())
                                .unwrap_or_oom();
                        }
                    }
                }
            }

            // PORT NOTE: `destination_dir` is `LazyPackageDestinationDir::NodeModulesPath`
            // holding `&self.node_modules`. `increment_tree_install_count` takes
            // `&mut self` and (via `link_tree_bins`) reads `self.node_modules.path`,
            // which would alias the borrow held by `destination_dir`. Close it first
            // — `destination_dir` is never read in this else-branch (`get_dir()` is
            // only used in the `needs_install` branch's EACCES handler).
            destination_dir.close();
            self.increment_tree_install_count(
                !IS_PENDING_PACKAGE_INSTALL,
                self.current_tree_id,
                log_level,
            );
        }
    }

    fn fail_with_invalid_url<const IS_PENDING_PACKAGE_INSTALL: bool>(
        &mut self,
        log_level: Options::LogLevel,
    ) {
        self.summary.fail += 1;
        self.increment_tree_install_count(
            !IS_PENDING_PACKAGE_INSTALL,
            self.current_tree_id,
            log_level,
        );
    }

    /// returns true if scripts are enqueued
    fn enqueue_lifecycle_scripts(
        &mut self,
        folder_name: &[u8],
        log_level: Options::LogLevel,
        package_path: &mut bun_paths::AutoAbsPath,
        package_id: PackageID,
        optional: bool,
        resolution: &Resolution,
    ) -> bool {
        let mut scripts: PackageScripts =
            self.lockfile().packages.items_scripts()[package_id as usize];
        let log = self.manager().log_mut();
        let scripts_list = match scripts.get_list(
            log,
            self.lockfile(),
            package_path,
            folder_name,
            resolution,
        ) {
            Ok(v) => v,
            Err(err) => {
                if log_level != Options::LogLevel::Silent {
                    if log_level.show_progress() {
                        self.progress_mut().log(format_args!(
                            "{}",
                            Output::pretty_fmt_rt(
                                format_args!(
                                    "\n<r><red>error:<r> failed to enqueue lifecycle scripts for <b>{}<r>: {}\n",
                                    bstr::BStr::new(folder_name),
                                    err.name(),
                                ),
                                Output::enable_ansi_colors_stderr(),
                            ),
                        ));
                    } else {
                        Output::pretty_errorln(format_args!(
                            "\n<r><red>error:<r> failed to enqueue lifecycle scripts for <b>{}<r>: {}\n",
                            bstr::BStr::new(folder_name),
                            err.name(),
                        ));
                    }
                }

                if self.manager().options.enable.fail_early() {
                    Global::exit(1);
                }

                Output::flush();
                self.summary.fail += 1;
                return false;
            }
        };

        let Some(scripts_list) = scripts_list else {
            return false;
        };

        if self
            .manager()
            .options
            .do_
            .contains(Options::Do::RUN_SCRIPTS)
        {
            // Bind once: two sequential `manager_mut()` derives would each
            // create a fresh Unique from the raw root under SB, popping the
            // first while `scripts_node` (derived through it) is still live.
            // `scripts_node_mut()` takes `&self` and returns a backref to a
            // caller stack-local (disjoint from `*m`), so a single `m` covers
            // both the `total_scripts` write and `set_node_name`.
            let m = self.manager_mut();
            m.total_scripts += scripts_list.total as usize;
            if let Some(scripts_node) = m.scripts_node_mut() {
                m.set_node_name::<true>(
                    scripts_node,
                    &scripts_list.package_name,
                    ProgressStrings::SCRIPT_EMOJI.as_bytes(),
                );
                scripts_node.set_estimated_total_items(
                    scripts_node
                        .unprotected_estimated_total_items
                        .load(Ordering::Relaxed)
                        + scripts_list.total as usize,
                );
            }
            self.pending_lifecycle_scripts.push(PendingLifecycleScript {
                list: scripts_list,
                tree_id: self.current_tree_id,
                optional,
            });

            return true;
        }

        false
    }

    pub fn install_package(&mut self, dep_id: DependencyID, log_level: Options::LogLevel) {
        let package_id = self.lockfile().buffers.resolutions.as_slice()[dep_id as usize];

        let name = self.names[package_id as usize];
        // `self.resolutions` is `RawSlice<Resolution>` (Copy); copy out so the
        // `&Resolution` argument borrows the local, not `*self`, across the
        // `&mut self` call.
        let resolutions = self.resolutions;

        const NEEDS_VERIFY: bool = true;
        const IS_PENDING_PACKAGE_INSTALL: bool = false;
        self.install_package_with_name_and_resolution::<NEEDS_VERIFY, IS_PENDING_PACKAGE_INSTALL>(
            dep_id,
            package_id,
            log_level,
            name,
            &resolutions[package_id as usize],
        );
    }
}

// ported from: src/install/PackageInstaller.zig
