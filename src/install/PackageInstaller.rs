use core::sync::atomic::Ordering;


use bun_collections::{ArrayHashMap, DynamicBitSet, StringHashMap};
use bun_core::{Global, Output};
use bun_fs::FileSystem;
use bun_paths::{self as Path, PathBuffer, AbsPath, MAX_PATH_BYTES, SEP};
use bun_progress::Progress;
use bun_semver::String;
use bun_str::{strings, ZStr};
use bun_sys::{self as Syscall, Dir, Fd};

use crate::bin::Bin;
use crate::lifecycle_script_subprocess::LifecycleScriptSubprocess;
use crate::lockfile::{self, Lockfile, Package};
use crate::package_install::PackageInstall;
use crate::package_manager::{self, PackageManager, Options};
use crate::patch_task::PatchTask;
use crate::postinstall_optimizer::PostinstallOptimizer;
use crate::resolution::Resolution;
use crate::task::Task;
use crate::{
    invalid_package_id, DependencyID, DependencyInstallContext, ExtractData, PackageID,
    PackageNameHash, TaskCallbackContext, TruncatedPackageNameHash,
};

bun_output::declare_scope!(PackageInstaller, hidden);

type Bitset = DynamicBitSet;

pub struct PendingLifecycleScript {
    pub list: lockfile::package::scripts::List,
    pub tree_id: lockfile::tree::Id,
    pub optional: bool,
}

pub struct PackageInstaller<'a> {
    pub manager: &'a mut PackageManager,
    pub lockfile: &'a mut Lockfile,
    pub progress: &'a Progress,

    /// relative paths from `next` will be copied into this list.
    pub node_modules: NodeModulesFolder,

    pub skip_verify_installed_version_number: bool,
    pub skip_delete: bool,
    pub force_install: bool,
    pub root_node_modules_folder: Dir,
    pub summary: &'a mut PackageInstall::Summary,
    pub options: &'a PackageManager::Options,
    // TODO(port): the following slice fields alias into `self.lockfile.packages` (BACKREF);
    // borrowck will reject `&'a mut Lockfile` + `&'a [T]` into it. Phase B: store as raw
    // `*const [T]` or re-fetch via `fix_cached_lockfile_package_slices` helper accessors.
    pub metas: &'a [lockfile::package::Meta],
    pub names: &'a [String],
    pub pkg_dependencies: &'a [lockfile::DependencySlice],
    pub pkg_name_hashes: &'a [PackageNameHash],
    pub bins: &'a [Bin],
    pub resolutions: &'a mut [Resolution],
    pub node: &'a mut Progress::Node,
    pub destination_dir_subpath_buf: PathBuffer,
    pub folder_path_buf: PathBuffer,
    pub successfully_installed: Bitset,
    pub command_ctx: Command::Context,
    pub current_tree_id: lockfile::tree::Id,

    // fields used for running lifecycle scripts when it's safe
    //
    /// set of completed tree ids
    pub completed_trees: Bitset,
    /// the tree ids a tree depends on before it can run the lifecycle scripts of it's immediate dependencies
    pub tree_ids_to_trees_the_id_depends_on: bun_collections::dynamic_bit_set::List,
    pub pending_lifecycle_scripts: Vec<PendingLifecycleScript>,

    pub trusted_dependencies_from_update_requests: ArrayHashMap<TruncatedPackageNameHash, ()>,

    /// uses same ids as lockfile.trees
    pub trees: Box<[TreeContext]>,

    pub seen_bin_links: StringHashMap<()>,
}

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
            Fd::from_std_dir(root_node_modules_dir),
            bun_paths::join_z_buf(&mut path_buf, &parts, bun_paths::Style::Auto),
        )
        .unwrap_or(false)
    }

    pub fn directory_exists_at(&self, root_node_modules_dir: Dir, file_path: &ZStr) -> bool {
        if file_path.len() + self.path.len() * 2 < MAX_PATH_BYTES {
            return self
                .directory_exists_at_without_opening_directories(root_node_modules_dir, file_path);
        }

        let dir = match self.open_dir(root_node_modules_dir) {
            Ok(d) => Fd::from_std_dir(d),
            Err(_) => return false,
        };
        let res = dir.directory_exists_at(file_path).unwrap_or(false);
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
            Fd::from_std_dir(root_node_modules_dir),
            bun_paths::join_z_buf(&mut path_buf, &parts, bun_paths::Style::Auto),
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
        file.close();
        Ok(res)
    }

    pub fn read_small_file(
        &self,
        root_node_modules_dir: Dir,
        file_path: &ZStr,
    ) -> Result<bun_sys::file::ReadToEndResult, bun_core::Error> {
        // TODO(port): narrow error set
        let file = self.open_file(root_node_modules_dir, file_path)?;
        let res = file.read_to_end_small();
        file.close();
        Ok(res)
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
                    bun_sys::Errno::PERM
                    | bun_sys::Errno::ACCES
                    | bun_sys::Errno::INVAL
                    | bun_sys::Errno::NAMETOOLONG => {
                        // Use fallback
                    }
                    _ => return Err(e.to_zig_err()),
                },
                Ok(file) => return Ok(file),
            }
        }

        let dir = Fd::from_std_dir(self.open_dir(root_node_modules_dir)?);
        let res = bun_sys::File::openat(dir, file_path, bun_sys::O::RDONLY, 0).unwrap();
        dir.close();
        res.map_err(Into::into)
    }

    pub fn open_dir(&self, root: Dir) -> Result<Dir, bun_core::Error> {
        // TODO(port): narrow error set
        #[cfg(unix)]
        {
            // TODO(port): std.posix.toPosixPath — copies into a NUL-terminated PathBuffer
            let path_z = bun_paths::to_posix_path(self.path.as_slice())?;
            return Ok(bun_sys::openat(
                Fd::from_std_dir(root),
                &path_z,
                bun_sys::O::DIRECTORY,
                0,
            )
            .unwrap()?
            .std_dir());
        }

        #[cfg(not(unix))]
        {
            return Ok(bun_sys::open_dir_at_windows_a(
                Fd::from_std_dir(root),
                self.path.as_slice(),
                bun_sys::windows::OpenDirOptions {
                    can_rename_or_delete: false,
                    read_only: false,
                    ..Default::default()
                },
            )
            .unwrap()?
            .std_dir());
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
                    bun_sys::DirOpenOptions { iterate: true, access_sub_paths: true },
                )?;
            }

            #[cfg(not(unix))]
            {
                break 'brk bun_sys::open_dir_at_windows_a(
                    Fd::from_std_dir(root),
                    self.path.as_slice(),
                    bun_sys::windows::OpenDirOptions {
                        can_rename_or_delete: false,
                        op: bun_sys::windows::OpenDirOp::OpenOrCreate,
                        read_only: false,
                    },
                )
                .unwrap()?
                .std_dir();
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

    pub binaries: Bin::PriorityQueue,

    /// Number of installed dependencies. Could be successful or failure.
    pub install_count: usize,
}

impl TreeContext {
    pub type Id = lockfile::tree::Id;
}

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
            LazyPackageDestinationDir::NodeModulesPath { node_modules, root_node_modules_dir } => {
                let dir = node_modules.open_dir(*root_node_modules_dir)?;
                *self = LazyPackageDestinationDir::Dir(dir);
                Ok(dir)
            }
            LazyPackageDestinationDir::Closed => {
                panic!("LazyPackageDestinationDir is closed! This should never happen. Why did this happen?! It's not your fault. Its our fault. We're sorry.")
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
    /// Increments the number of installed packages for a tree id and runs available scripts
    /// if the tree is finished.
    pub fn increment_tree_install_count<const SHOULD_INSTALL_PACKAGES: bool>(
        &mut self,
        tree_id: lockfile::tree::Id,
        log_level: Options::LogLevel,
    ) {
        if cfg!(debug_assertions) {
            debug_assert!(tree_id != lockfile::tree::INVALID_ID);
        }

        let tree = &mut self.trees[tree_id as usize];
        let current_count = tree.install_count;
        let max = self.lockfile.buffers.trees.as_slice()[tree_id as usize].dependencies.len();

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

        self.trees[tree_id as usize].install_count =
            if is_not_done { current_count + 1 } else { usize::MAX };

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

        if SHOULD_INSTALL_PACKAGES {
            const FORCE: bool = false;
            self.install_available_packages::<FORCE>(log_level);
        }
        self.run_available_scripts(log_level);
    }

    pub fn link_tree_bins(
        &mut self,
        // PORT NOTE: zig passes `tree: *TreeContext` + `tree_id`; reshaped to take only
        // `tree_id` and re-borrow `&mut self.trees[tree_id]` to satisfy borrowck.
        tree_id: TreeContext::Id,
        link_target_buf: &mut [u8],
        link_dest_buf: &mut [u8],
        link_rel_buf: &mut [u8],
        log_level: Options::LogLevel,
    ) {
        let lockfile = &*self.lockfile;
        let manager = &mut *self.manager;
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let mut node_modules_path: AbsPath = AbsPath::from(self.node_modules.path.as_slice());
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
            debug_assert!(bin.tag != Bin::Tag::None);

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
                if let Some(optimizer) = manager
                    .postinstall_optimizer
                    .get(PostinstallOptimizer::Key { name_hash })
                {
                    match optimizer {
                        PostinstallOptimizer::Entry::NativeBinlink => {
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
                        PostinstallOptimizer::Entry::Ignore => {}
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
                let mut bin_linker = Bin::Linker {
                    bin,
                    global_bin_path: self.options.bin_path,
                    package_name: package_name_,
                    target_package_name,
                    string_buf,
                    extern_string_buf: lockfile.buffers.extern_strings.as_slice(),
                    seen: &mut self.seen_bin_links,
                    node_modules_path: &mut node_modules_path,
                    target_node_modules_path: match target_node_modules_path_opt.as_mut() {
                        Some(path) => path,
                        None => &mut node_modules_path,
                    },
                    abs_target_buf: link_target_buf,
                    abs_dest_buf: link_dest_buf,
                    rel_buf: link_rel_buf,
                    // TODO(port): Bin::Linker has additional default-initialized fields
                    ..Default::default()
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
                        manager
                            .log
                            .add_error_fmt_opts(
                                format_args!(
                                    "Failed to link <b>{}<r>: {}",
                                    bstr::BStr::new(alias),
                                    err.name(),
                                ),
                                Default::default(),
                            )
                            .unwrap_or_oom();
                    }

                    if self.options.enable.fail_early {
                        manager.crash();
                    }
                }

                break;
            }
        }
    }

    pub fn link_remaining_bins(&mut self, log_level: Options::LogLevel) {
        let mut depth_buf: lockfile::tree::DepthBuf = Default::default();
        let mut node_modules_rel_path_buf = PathBuffer::uninit();
        node_modules_rel_path_buf[..b"node_modules".len()].copy_from_slice(b"node_modules");

        let mut link_target_buf = PathBuffer::uninit();
        let mut link_dest_buf = PathBuffer::uninit();
        let mut link_rel_buf = PathBuffer::uninit();
        let lockfile = &*self.lockfile;

        let trees_len = self.trees.len();
        for tree_id in 0..trees_len {
            // PORT NOTE: reshaped for borrowck — index instead of `for (self.trees, 0..) |*tree, tree_id|`.
            if self.trees[tree_id].binaries.count() > 0 {
                self.seen_bin_links.clear();
                self.node_modules.path.truncate(
                    strings::without_trailing_slash(FileSystem::instance().top_level_dir).len() + 1,
                );
                let (rel_path, _) = lockfile::Tree::relative_path_and_depth(
                    lockfile,
                    u32::try_from(tree_id).unwrap(),
                    &mut node_modules_rel_path_buf,
                    &mut depth_buf,
                    lockfile::tree::PathStyle::NodeModules,
                );

                self.node_modules.path.extend_from_slice(rel_path);

                self.link_tree_bins(
                    u32::try_from(tree_id).unwrap(),
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
            let entry = &self.pending_lifecycle_scripts[i];
            let name = entry.list.package_name;
            let tree_id = entry.tree_id;
            let optional = entry.optional;
            if self.can_run_scripts(tree_id) {
                let entry = self.pending_lifecycle_scripts.swap_remove(i);
                let output_in_foreground = false;

                if let Err(err) = self.manager.spawn_package_lifecycle_scripts(
                    self.command_ctx,
                    entry.list,
                    optional,
                    output_in_foreground,
                    None,
                ) {
                    if log_level != Options::LogLevel::Silent {
                        let fmt = "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{}<r>: {}\n";
                        // TODO(port): zig used `comptime Output.prettyFmt(fmt, enable_ansi_colors)` —
                        // const-time ANSI formatting. Use bun_output::pretty_fmt! macro in Phase B.
                        if log_level.show_progress() {
                            if Output::enable_ansi_colors_stderr() {
                                self.progress.log(Output::pretty_fmt::<true>(fmt), format_args!("{} {}", bstr::BStr::new(name), err.name()));
                            } else {
                                self.progress.log(Output::pretty_fmt::<false>(fmt), format_args!("{} {}", bstr::BStr::new(name), err.name()));
                            }
                        } else {
                            Output::pretty_errorln(format_args!(
                                "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{}<r>: {}\n",
                                bstr::BStr::new(name),
                                err.name(),
                            ));
                        }
                    }

                    if self.manager.options.enable.fail_early {
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

        let lockfile = &*self.lockfile;
        let resolutions = lockfile.buffers.resolutions.as_slice();

        let trees_len = self.trees.len();
        for i in 0..trees_len {
            // PORT NOTE: reshaped for borrowck — index instead of iter_mut.
            if FORCE
                || self.can_install_package_for_tree(
                    self.lockfile.buffers.trees.as_mut_slice(),
                    u32::try_from(i).unwrap(),
                )
            {
                // PORT NOTE: `defer tree.pending_installs.clearRetainingCapacity()` moved to end of block.

                // If installing these packages completes the tree, we don't allow it
                // to call `installAvailablePackages` recursively. Starting at id 0 and
                // going up ensures we will reach any trees that will be able to install
                // packages upon completing the current tree
                let pending_len = self.trees[i].pending_installs.len();
                for j in 0..pending_len {
                    // PORT NOTE: reshaped for borrowck.
                    let context = self.trees[i].pending_installs[j].clone();
                    let package_id = resolutions[context.dependency_id as usize];
                    let name = self.names[package_id as usize];
                    let resolution = &self.resolutions[package_id as usize] as *const Resolution;
                    self.node_modules.tree_id = context.tree_id;
                    self.node_modules.path = context.path;
                    self.current_tree_id = context.tree_id;

                    const NEEDS_VERIFY: bool = false;
                    const IS_PENDING_PACKAGE_INSTALL: bool = true;
                    // SAFETY: resolution points into self.resolutions which is not resized here.
                    // TODO(port): reshape to pass by value or index to avoid raw ptr.
                    self.install_package_with_name_and_resolution::<NEEDS_VERIFY, IS_PENDING_PACKAGE_INSTALL>(
                        // This id might be different from the id used to enqueue the task. Important
                        // to use the correct one because the package might be aliased with a different
                        // name
                        context.dependency_id,
                        package_id,
                        log_level,
                        name,
                        unsafe { &*resolution },
                    );
                }
                self.trees[i].pending_installs.clear();
            }
        }

        self.node_modules = prev_node_modules;
        self.current_tree_id = prev_tree_id;
    }

    pub fn complete_remaining_scripts(&mut self, log_level: Options::LogLevel) {
        // PORT NOTE: reshaped for borrowck — drain by index since loop body needs &mut self.manager.
        for idx in 0..self.pending_lifecycle_scripts.len() {
            let entry = &self.pending_lifecycle_scripts[idx];
            let package_name = entry.list.package_name;
            // .monotonic is okay because this value isn't modified from any other thread.
            // (Scripts are spawned on this thread.)
            while LifecycleScriptSubprocess::alive_count().load(Ordering::Relaxed)
                >= self.manager.options.max_concurrent_lifecycle_scripts
            {
                self.manager.sleep();
            }

            let optional = entry.optional;
            let output_in_foreground = false;
            // TODO(port): entry.list is borrowed from self.pending_lifecycle_scripts; clone or
            // restructure to move it out before calling spawn (which needs &mut self.manager).
            let list = entry.list.clone();
            if let Err(err) = self.manager.spawn_package_lifecycle_scripts(
                self.command_ctx,
                list,
                optional,
                output_in_foreground,
                None,
            ) {
                if log_level != Options::LogLevel::Silent {
                    let fmt = "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{}<r>: {}\n";
                    // TODO(port): comptime Output.prettyFmt — see run_available_scripts.
                    if log_level.show_progress() {
                        if Output::enable_ansi_colors_stderr() {
                            self.progress.log(Output::pretty_fmt::<true>(fmt), format_args!("{} {}", bstr::BStr::new(package_name), err.name()));
                        } else {
                            self.progress.log(Output::pretty_fmt::<false>(fmt), format_args!("{} {}", bstr::BStr::new(package_name), err.name()));
                        }
                    } else {
                        Output::pretty_errorln(format_args!(
                            "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{}<r>: {}\n",
                            bstr::BStr::new(package_name),
                            err.name(),
                        ));
                    }
                }

                if self.manager.options.enable.fail_early {
                    Global::exit(1);
                }

                Output::flush();
                self.summary.fail += 1;
            }
        }

        // .monotonic is okay because this value isn't modified from any other thread.
        while self.manager.pending_lifecycle_script_tasks.load(Ordering::Relaxed) > 0 {
            self.manager.report_slow_lifecycle_scripts();

            if log_level.show_progress() {
                if let Some(scripts_node) = self.manager.scripts_node.as_mut() {
                    scripts_node.activate();
                    self.manager.progress.refresh();
                }
            }

            self.manager.sleep();
        }
    }

    /// Check if a tree is ready to start running lifecycle scripts
    pub fn can_run_scripts(&self, scripts_tree_id: lockfile::tree::Id) -> bool {
        let deps = self.tree_ids_to_trees_the_id_depends_on.at(scripts_tree_id as usize);
        // .monotonic is okay because this value isn't modified from any other thread.
        (deps.subset_of(&self.completed_trees) || deps.eql(&self.completed_trees))
            && LifecycleScriptSubprocess::alive_count().load(Ordering::Relaxed)
                < self.manager.options.max_concurrent_lifecycle_scripts
    }

    /// A tree can start installing packages when the parent has installed all its packages. If the parent
    /// isn't finished, we need to wait because it's possible a package installed in this tree will be deleted by the parent.
    pub fn can_install_package_for_tree(
        &self,
        trees: &mut [lockfile::Tree],
        package_tree_id: lockfile::tree::Id,
    ) -> bool {
        let mut curr_tree_id = trees[package_tree_id as usize].parent;
        while curr_tree_id != lockfile::tree::INVALID_ID {
            if !self.completed_trees.is_set(curr_tree_id as usize) {
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
        let packages = self.lockfile.packages.slice();
        // TODO(port): these reassign &'a [T] fields from a &'a mut Lockfile borrow — borrowck
        // conflict. Phase B: make these fields raw `*const [T]` or recompute on demand.
        self.metas = packages.items_meta();
        self.names = packages.items_name();
        self.pkg_name_hashes = packages.items_name_hash();
        self.bins = packages.items_bin();
        self.resolutions = packages.items_resolution_mut();
        self.pkg_dependencies = packages.items_dependencies();

        // fixes an assertion failure where a transitive dependency is a git dependency newly added to the lockfile after the list of dependencies has been resized
        // this assertion failure would also only happen after the lockfile has been written to disk and the summary is being printed.
        if self.successfully_installed.bit_length() < self.lockfile.packages.len() {
            let new = Bitset::init_empty(self.lockfile.packages.len());
            let old = core::mem::replace(&mut self.successfully_installed, new);
            old.copy_into(&mut self.successfully_installed);
            // PORT NOTE: `defer old.deinit(bun.default_allocator)` — Bitset impls Drop.
        }
    }

    /// Install versions of a package which are waiting on a network request
    pub fn install_enqueued_packages_after_extraction(
        &mut self,
        task_id: Task::Id,
        dependency_id: DependencyID,
        data: &ExtractData,
        log_level: Options::LogLevel,
    ) {
        let package_id = self.lockfile.buffers.resolutions.as_slice()[dependency_id as usize];
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
            let pkg_metas = self.lockfile.packages.items_meta_mut();
            if !pkg_metas[package_id as usize].integrity.tag.is_supported() {
                pkg_metas[package_id as usize].integrity = data.integrity;
                self.manager.options.enable.force_save_lockfile = true;
            }
        }

        if let Some(removed) = self.manager.task_queue.fetch_remove(task_id) {
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

            for cb in callbacks.iter() {
                let context = &cb.dependency_install_context;
                let callback_package_id =
                    self.lockfile.buffers.resolutions.as_slice()[context.dependency_id as usize];
                let callback_resolution =
                    &self.resolutions[callback_package_id as usize] as *const Resolution;
                self.node_modules.tree_id = context.tree_id;
                // TODO(port): zig assigns `context.path` (ArrayList struct copy). In Rust this
                // moves the Vec out of `context`; iterate by value (`into_iter()`) in Phase B.
                self.node_modules.path = context.path.clone();
                self.current_tree_id = context.tree_id;
                const NEEDS_VERIFY: bool = false;
                const IS_PENDING_PACKAGE_INSTALL: bool = false;
                // SAFETY: callback_resolution points into self.resolutions which is not resized here.
                self.install_package_with_name_and_resolution::<NEEDS_VERIFY, IS_PENDING_PACKAGE_INSTALL>(
                    // This id might be different from the id used to enqueue the task. Important
                    // to use the correct one because the package might be aliased with a different
                    // name
                    context.dependency_id,
                    callback_package_id,
                    log_level,
                    name,
                    unsafe { &*callback_resolution },
                );
            }
            self.node_modules = prev_node_modules;
            self.current_tree_id = prev_tree_id;
            return;
        }

        if cfg!(debug_assertions) {
            Output::panic(format_args!(
                "Ran callback to install enqueued packages, but there was no task associated with it. {:?}:{:?} (dependency_id: {})",
                bun_core::fmt::quote(name.slice(self.lockfile.buffers.string_bytes.as_slice())),
                bun_core::fmt::quote(&data.url),
                dependency_id,
            ));
        }
    }

    fn get_installed_package_scripts_count(
        &mut self,
        alias: &[u8],
        package_id: PackageID,
        resolution_tag: Resolution::Tag,
        folder_path: &mut AbsPath, // TODO(port): bun.AbsPath(.{ .sep = .auto }) const-generic sep variant
        log_level: Options::LogLevel,
    ) -> usize {
        if cfg!(debug_assertions) {
            debug_assert!(resolution_tag != Resolution::Tag::Root);
            debug_assert!(resolution_tag != Resolution::Tag::Workspace);
            debug_assert!(package_id != 0);
        }
        let mut count: usize = 0;
        let scripts = 'brk: {
            let scripts = self.lockfile.packages.items_scripts()[package_id as usize];
            if scripts.filled {
                break 'brk scripts;
            }

            let mut temp = Package::Scripts::default();
            let mut temp_lockfile = Lockfile::default();
            temp_lockfile.init_empty();
            // PORT NOTE: `defer temp_lockfile.deinit()` — Lockfile impls Drop.
            let mut string_builder = temp_lockfile.string_builder();
            if let Err(err) = temp.fill_from_package_json(
                &mut string_builder,
                &mut self.manager.log,
                folder_path,
            ) {
                if log_level != Options::LogLevel::Silent {
                    Output::err_generic(format_args!(
                        "failed to fill lifecycle scripts for <b>{}<r>: {}",
                        bstr::BStr::new(alias),
                        err.name(),
                    ));
                }

                if self.manager.options.enable.fail_early {
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
            Resolution::Tag::Git | Resolution::Tag::Github | Resolution::Tag::Root => {
                // PORT NOTE: zig `inline for (Lockfile.Scripts.names) |script_name| { @field(...) }`.
                // TODO(port): @field reflection — Phase B should add a `Scripts::iter_all()` helper
                // that yields each named script field.
                for s in scripts.iter_all() {
                    count += (!s.is_empty()) as usize;
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
            let binding_dot_gyp_path = Path::join_abs_string_z(
                self.node_modules.path.as_slice(),
                &[alias, b"binding.gyp"],
                Path::Style::Auto,
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
        let alias = self.lockfile.buffers.dependencies.as_slice()[dependency_id as usize].name;
        let destination_dir_subpath: &mut ZStr = {
            let alias_slice = alias.slice(self.lockfile.buffers.string_bytes.as_slice());
            self.destination_dir_subpath_buf[..alias_slice.len()].copy_from_slice(alias_slice);
            self.destination_dir_subpath_buf[alias_slice.len()] = 0;
            // SAFETY: buf[alias_slice.len()] == 0 written above
            unsafe {
                ZStr::from_raw_mut(
                    self.destination_dir_subpath_buf.as_mut_ptr(),
                    alias_slice.len(),
                )
            }
        };

        let pkg_name_hash = self.pkg_name_hashes[package_id as usize];

        let mut resolution_buf = [0u8; 512];
        let package_version: &[u8] = if resolution.tag == Resolution::Tag::Workspace {
            'brk: {
                if let Some(workspace_version) =
                    self.manager.lockfile.workspace_versions.get(pkg_name_hash)
                {
                    // TODO(port): std.fmt.bufPrint — write into &mut [u8], return written slice
                    break 'brk bun_core::fmt::buf_print(
                        &mut resolution_buf,
                        format_args!(
                            "{}",
                            workspace_version.fmt(self.lockfile.buffers.string_bytes.as_slice())
                        ),
                    )
                    .expect("unreachable");
                }

                // no version
                break 'brk b"";
            }
        } else {
            bun_core::fmt::buf_print(
                &mut resolution_buf,
                format_args!(
                    "{}",
                    resolution.fmt(
                        self.lockfile.buffers.string_bytes.as_slice(),
                        Path::Style::Posix
                    )
                ),
            )
            .expect("unreachable")
        };

        let (patch_patch, patch_contents_hash, patch_name_and_version_hash, remove_patch) = 'brk: {
            if self.manager.lockfile.patched_dependencies.entries().len() == 0
                && self.manager.patched_dependencies_to_remove.entries().len() == 0
            {
                break 'brk (None, None, None, false);
            }
            // PERF(port): was stack-fallback
            let mut name_and_version: Vec<u8> = Vec::new();
            use std::io::Write;
            write!(
                &mut name_and_version,
                "{}@{}",
                bstr::BStr::new(pkg_name.slice(self.lockfile.buffers.string_bytes.as_slice())),
                bstr::BStr::new(package_version),
            )
            .expect("unreachable");

            let name_and_version_hash =
                bun_semver::string::Builder::string_hash(&name_and_version);

            let Some(patchdep) = self
                .lockfile
                .patched_dependencies
                .get(name_and_version_hash)
            else {
                let to_remove = self
                    .manager
                    .patched_dependencies_to_remove
                    .contains(name_and_version_hash);
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
                Some(patchdep.path.slice(self.lockfile.buffers.string_bytes.as_slice())),
                Some(patchdep.patchfile_hash().unwrap()),
                Some(name_and_version_hash),
                false,
            );
        };

        let mut installer = PackageInstall {
            progress: if self.manager.options.log_level.show_progress() {
                Some(self.progress)
            } else {
                None
            },
            cache_dir: Dir::invalid(), // assigned below
            destination_dir_subpath,
            destination_dir_subpath_buf: &mut self.destination_dir_subpath_buf,
            // PORT NOTE: zig `allocator: this.lockfile.allocator` dropped — global mimalloc.
            package_name: pkg_name,
            patch: patch_patch.map(|p| PackageInstall::Patch {
                contents_hash: patch_contents_hash.unwrap(),
                path: p,
            }),
            package_version,
            node_modules: &self.node_modules,
            lockfile: &*self.lockfile,
            // TODO(port): PackageInstall has additional default-initialized fields
            ..Default::default()
        };
        bun_output::scoped_log!(
            PackageInstaller,
            "Installing {}@{}",
            bstr::BStr::new(pkg_name.slice(self.lockfile.buffers.string_bytes.as_slice())),
            resolution.fmt(self.lockfile.buffers.string_bytes.as_slice(), Path::Style::Posix),
        );

        match resolution.tag {
            Resolution::Tag::Npm => {
                installer.cache_dir_subpath = self.manager.cached_npm_package_folder_name(
                    pkg_name.slice(self.lockfile.buffers.string_bytes.as_slice()),
                    resolution.value.npm.version,
                    patch_contents_hash,
                );
                installer.cache_dir = self.manager.get_cache_directory();
            }
            Resolution::Tag::Git => {
                installer.cache_dir_subpath = self
                    .manager
                    .cached_git_folder_name(&resolution.value.git, patch_contents_hash);
                installer.cache_dir = self.manager.get_cache_directory();
            }
            Resolution::Tag::Github => {
                installer.cache_dir_subpath = self
                    .manager
                    .cached_github_folder_name(&resolution.value.github, patch_contents_hash);
                installer.cache_dir = self.manager.get_cache_directory();
            }
            Resolution::Tag::Folder => {
                let folder = resolution
                    .value
                    .folder
                    .slice(self.lockfile.buffers.string_bytes.as_slice());

                if self.lockfile.is_workspace_tree_id(self.current_tree_id) {
                    // Handle when a package depends on itself via file:
                    // example:
                    //   "mineflayer": "file:."
                    if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                        installer.cache_dir_subpath = ZStr::from_static(b".\0");
                    } else {
                        self.folder_path_buf[..folder.len()].copy_from_slice(folder);
                        self.folder_path_buf[folder.len()] = 0;
                        // SAFETY: buf[folder.len()] == 0 written above
                        installer.cache_dir_subpath = unsafe {
                            ZStr::from_raw(self.folder_path_buf.as_ptr(), folder.len())
                        };
                    }
                    installer.cache_dir = bun_sys::cwd();
                } else {
                    // transitive folder dependencies are relative to their parent. they are not hoisted
                    self.folder_path_buf[..folder.len()].copy_from_slice(folder);
                    self.folder_path_buf[folder.len()] = 0;
                    // SAFETY: buf[folder.len()] == 0 written above
                    installer.cache_dir_subpath =
                        unsafe { ZStr::from_raw(self.folder_path_buf.as_ptr(), folder.len()) };

                    // cache_dir might not be created yet (if it's in node_modules)
                    installer.cache_dir = bun_sys::cwd();
                }
            }
            Resolution::Tag::LocalTarball => {
                installer.cache_dir_subpath = self
                    .manager
                    .cached_tarball_folder_name(resolution.value.local_tarball, patch_contents_hash);
                installer.cache_dir = self.manager.get_cache_directory();
            }
            Resolution::Tag::RemoteTarball => {
                installer.cache_dir_subpath = self.manager.cached_tarball_folder_name(
                    resolution.value.remote_tarball,
                    patch_contents_hash,
                );
                installer.cache_dir = self.manager.get_cache_directory();
            }
            Resolution::Tag::Workspace => {
                let folder = resolution
                    .value
                    .workspace
                    .slice(self.lockfile.buffers.string_bytes.as_slice());
                // Handle when a package depends on itself
                if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                    installer.cache_dir_subpath = ZStr::from_static(b".\0");
                } else {
                    self.folder_path_buf[..folder.len()].copy_from_slice(folder);
                    self.folder_path_buf[folder.len()] = 0;
                    // SAFETY: buf[folder.len()] == 0 written above
                    installer.cache_dir_subpath =
                        unsafe { ZStr::from_raw(self.folder_path_buf.as_ptr(), folder.len()) };
                }
                installer.cache_dir = bun_sys::cwd();
            }
            Resolution::Tag::Root => {
                installer.cache_dir_subpath = ZStr::from_static(b".\0");
                installer.cache_dir = bun_sys::cwd();
            }
            Resolution::Tag::Symlink => {
                let directory = self.manager.global_link_dir();

                let folder = resolution
                    .value
                    .symlink
                    .slice(self.lockfile.buffers.string_bytes.as_slice());

                if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                    installer.cache_dir_subpath = ZStr::from_static(b".\0");
                    installer.cache_dir = bun_sys::cwd();
                } else {
                    let global_link_dir = self.manager.global_link_dir_path();
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
                    installer.cache_dir_subpath =
                        unsafe { ZStr::from_raw(self.folder_path_buf.as_ptr(), len) };
                    installer.cache_dir = directory;
                }
            }
            _ => {
                if cfg!(debug_assertions) {
                    panic!("Internal assertion failure: unexpected resolution tag");
                }
                self.increment_tree_install_count::<{ !IS_PENDING_PACKAGE_INSTALL }>(
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
                && installer.package_missing_from_cache(self.manager, package_id, resolution.tag)
            {
                if cfg!(debug_assertions) {
                    debug_assert!(resolution.can_enqueue_install_task());
                }

                let context = TaskCallbackContext::DependencyInstallContext(
                    DependencyInstallContext {
                        tree_id: self.current_tree_id,
                        path: self.node_modules.path.clone(),
                        dependency_id,
                    },
                );
                match resolution.tag {
                    Resolution::Tag::Git => {
                        self.manager.enqueue_git_for_checkout(
                            dependency_id,
                            alias.slice(self.lockfile.buffers.string_bytes.as_slice()),
                            resolution,
                            context,
                            patch_name_and_version_hash,
                        );
                    }
                    Resolution::Tag::Github => {
                        let url = self.manager.alloc_github_url(&resolution.value.github);
                        // PORT NOTE: `defer this.manager.allocator.free(url)` — url: Box<[u8]>/Vec drops.
                        match self.manager.enqueue_tarball_for_download(
                            dependency_id,
                            package_id,
                            &url,
                            context,
                            patch_name_and_version_hash,
                        ) {
                            Ok(()) => {}
                            Err(e) if e == bun_core::err!("OutOfMemory") => bun_core::out_of_memory(),
                            Err(e) if e == bun_core::err!("InvalidURL") => self
                                .fail_with_invalid_url::<IS_PENDING_PACKAGE_INSTALL>(log_level),
                            Err(_) => unreachable!(),
                        }
                    }
                    Resolution::Tag::LocalTarball => {
                        self.manager.enqueue_tarball_for_reading(
                            dependency_id,
                            package_id,
                            alias.slice(self.lockfile.buffers.string_bytes.as_slice()),
                            resolution,
                            context,
                        );
                    }
                    Resolution::Tag::RemoteTarball => {
                        match self.manager.enqueue_tarball_for_download(
                            dependency_id,
                            package_id,
                            resolution
                                .value
                                .remote_tarball
                                .slice(self.lockfile.buffers.string_bytes.as_slice()),
                            context,
                            patch_name_and_version_hash,
                        ) {
                            Ok(()) => {}
                            Err(e) if e == bun_core::err!("OutOfMemory") => bun_core::out_of_memory(),
                            Err(e) if e == bun_core::err!("InvalidURL") => self
                                .fail_with_invalid_url::<IS_PENDING_PACKAGE_INSTALL>(log_level),
                            Err(_) => unreachable!(),
                        }
                    }
                    Resolution::Tag::Npm => {
                        #[cfg(debug_assertions)]
                        {
                            // Very old versions of Bun didn't store the tarball url when it didn't seem necessary
                            // This caused bugs. We can't assert on it because they could come from old lockfiles
                            if resolution.value.npm.url.is_empty() {
                                Output::debug_warn(format_args!(
                                    "package {}@{} missing tarball_url",
                                    bstr::BStr::new(
                                        pkg_name
                                            .slice(self.lockfile.buffers.string_bytes.as_slice())
                                    ),
                                    resolution.fmt(
                                        self.lockfile.buffers.string_bytes.as_slice(),
                                        Path::Style::Posix
                                    ),
                                ));
                            }
                        }

                        match self.manager.enqueue_package_for_download(
                            pkg_name.slice(self.lockfile.buffers.string_bytes.as_slice()),
                            dependency_id,
                            package_id,
                            resolution.value.npm.version,
                            resolution
                                .value
                                .npm
                                .url
                                .slice(self.lockfile.buffers.string_bytes.as_slice()),
                            context,
                            patch_name_and_version_hash,
                        ) {
                            Ok(()) => {}
                            Err(e) if e == bun_core::err!("OutOfMemory") => bun_core::out_of_memory(),
                            Err(e) if e == bun_core::err!("InvalidURL") => self
                                .fail_with_invalid_url::<IS_PENDING_PACKAGE_INSTALL>(log_level),
                            Err(_) => unreachable!(),
                        }
                    }
                    _ => {
                        if cfg!(debug_assertions) {
                            panic!("unreachable, handled above");
                        }
                        self.increment_tree_install_count::<{ !IS_PENDING_PACKAGE_INSTALL }>(
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
            if let Some(patch) = installer.patch.as_ref() {
                if installer.patched_package_missing_from_cache(self.manager, package_id) {
                    let mut task = PatchTask::new_apply_patch_hash(
                        self.manager,
                        package_id,
                        patch.contents_hash,
                        patch_name_and_version_hash.unwrap(),
                    );
                    task.callback.apply.install_context = Some(DependencyInstallContext {
                        dependency_id,
                        tree_id: self.current_tree_id,
                        path: self.node_modules.path.clone(),
                    });
                    self.manager.enqueue_patch_task(task);
                    return;
                }
            }

            if !IS_PENDING_PACKAGE_INSTALL
                && !self.can_install_package_for_tree(
                    self.lockfile.buffers.trees.as_mut_slice(),
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
            let mut destination_dir =
                match self.node_modules.make_and_open_dir(self.root_node_modules_folder) {
                    Ok(d) => d,
                    Err(err) => {
                        if log_level != Options::LogLevel::Silent {
                            Output::err(
                                err,
                                format_args!(
                                    "Failed to open node_modules folder for <r><red>{}<r> in {}",
                                    bstr::BStr::new(
                                        pkg_name
                                            .slice(self.lockfile.buffers.string_bytes.as_slice())
                                    ),
                                    bun_core::fmt::fmt_path(
                                        self.node_modules.path.as_slice(),
                                        Default::default()
                                    ),
                                ),
                            );
                        }
                        self.summary.fail += 1;
                        self.increment_tree_install_count::<{ !IS_PENDING_PACKAGE_INSTALL }>(
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

            let install_result: PackageInstall::Result = match resolution.tag {
                Resolution::Tag::Symlink | Resolution::Tag::Workspace => {
                    installer.install_from_link(self.skip_delete, destination_dir)
                }
                _ => 'result: {
                    if resolution.tag == Resolution::Tag::Root
                        || (resolution.tag == Resolution::Tag::Folder
                            && !self.lockfile.is_workspace_tree_id(self.current_tree_id))
                    {
                        // This is a transitive folder dependency. It is installed with a single symlink to the target folder/file,
                        // and is not hoisted.
                        let dirname = bun_paths::dirname(
                            self.node_modules.path.as_slice(),
                            Path::Style::Auto,
                        )
                        .unwrap_or(self.node_modules.path.as_slice());

                        installer.cache_dir = match self.root_node_modules_folder.open_dir(
                            dirname,
                            bun_sys::DirOpenOptions { iterate: true, access_sub_paths: true },
                        ) {
                            Ok(d) => d,
                            Err(err) => {
                                break 'result PackageInstall::Result::fail(
                                    err,
                                    PackageInstall::Step::OpeningCacheDir,
                                    // TODO(port): @errorReturnTrace()
                                    None,
                                );
                            }
                        };

                        let result = if resolution.tag == Resolution::Tag::Root {
                            installer.install_from_link(self.skip_delete, destination_dir)
                        } else {
                            installer.install(
                                self.skip_delete,
                                destination_dir,
                                installer.get_install_method(),
                                resolution.tag,
                            )
                        };

                        if result.is_fail()
                            && (result.failure().err == bun_core::err!("ENOENT")
                                || result.failure().err == bun_core::err!("FileNotFound"))
                        {
                            break 'result PackageInstall::Result::SUCCESS;
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
                PackageInstall::Result::Success => {
                    let is_duplicate = self.successfully_installed.is_set(package_id as usize);
                    self.summary.success += (!is_duplicate) as u32;
                    self.successfully_installed.set(package_id as usize);

                    if log_level.show_progress() {
                        self.node.complete_one();
                    }

                    if self.bins[package_id as usize].tag != Bin::Tag::None {
                        self.trees[self.current_tree_id as usize]
                            .binaries
                            .add(dependency_id)
                            .unwrap_or_oom();
                    }

                    let dep =
                        self.lockfile.buffers.dependencies.as_slice()[dependency_id as usize];
                    let truncated_dep_name_hash: TruncatedPackageNameHash =
                        dep.name_hash as TruncatedPackageNameHash;
                    let (is_trusted, is_trusted_through_update_request) = 'brk: {
                        if self
                            .trusted_dependencies_from_update_requests
                            .contains(&truncated_dep_name_hash)
                        {
                            break 'brk (true, true);
                        }
                        if self.lockfile.has_trusted_dependency(
                            alias.slice(self.lockfile.buffers.string_bytes.as_slice()),
                            resolution,
                        ) {
                            break 'brk (true, false);
                        }
                        break 'brk (false, false);
                    };

                    if resolution.tag != Resolution::Tag::Root
                        && (resolution.tag == Resolution::Tag::Workspace || is_trusted)
                    {
                        let mut folder_path = AbsPath::from(self.node_modules.path.as_slice());
                        // PORT NOTE: `defer folder_path.deinit()` — AbsPath impls Drop.
                        folder_path
                            .append(alias.slice(self.lockfile.buffers.string_bytes.as_slice()));

                        'enqueue_lifecycle_scripts: {
                            if self.manager.postinstall_optimizer.should_ignore_lifecycle_scripts(
                                PostinstallOptimizer::ScriptCheck {
                                    name_hash: pkg_name_hash,
                                    version: if resolution.tag == Resolution::Tag::Npm {
                                        Some(resolution.value.npm.version)
                                    } else {
                                        None
                                    },
                                    version_buf: self.lockfile.buffers.string_bytes.as_slice(),
                                },
                                self.lockfile.packages.items_resolutions()[package_id as usize]
                                    .get(self.lockfile.buffers.resolutions.as_slice()),
                                self.lockfile.packages.items_meta(),
                                self.manager.options.cpu,
                                self.manager.options.os,
                                self.current_tree_id,
                            ) {
                                if PackageManager::verbose_install() {
                                    Output::pretty_errorln(format_args!(
                                        "<d>[Lifecycle Scripts]<r> ignoring {} lifecycle scripts",
                                        bstr::BStr::new(
                                            pkg_name.slice(
                                                self.lockfile.buffers.string_bytes.as_slice()
                                            )
                                        ),
                                    ));
                                }
                                break 'enqueue_lifecycle_scripts;
                            }

                            if self.enqueue_lifecycle_scripts(
                                alias.slice(self.lockfile.buffers.string_bytes.as_slice()),
                                log_level,
                                &mut folder_path,
                                package_id,
                                dep.behavior.optional,
                                resolution,
                            ) {
                                if is_trusted_through_update_request {
                                    self.manager.trusted_deps_to_add_to_package_json.push(
                                        Box::<[u8]>::from(
                                            alias.slice(
                                                self.lockfile.buffers.string_bytes.as_slice(),
                                            ),
                                        ),
                                    );

                                    if self.lockfile.trusted_dependencies.is_none() {
                                        self.lockfile.trusted_dependencies = Some(Default::default());
                                    }
                                    self.lockfile
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
                        Resolution::Tag::Root | Resolution::Tag::Workspace => {
                            // these will never be blocked
                        }
                        _ => {
                            if !is_trusted
                                && self.metas[package_id as usize].has_install_script()
                            {
                                // Check if the package actually has scripts. `hasInstallScript` can be false positive if a package is published with
                                // an auto binding.gyp rebuild script but binding.gyp is excluded from the published files.
                                let mut folder_path =
                                    AbsPath::from(self.node_modules.path.as_slice());
                                folder_path.append(
                                    alias.slice(self.lockfile.buffers.string_bytes.as_slice()),
                                );

                                let count = self.get_installed_package_scripts_count(
                                    alias.slice(self.lockfile.buffers.string_bytes.as_slice()),
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
                                            bstr::BStr::new(alias.slice(
                                                self.lockfile.buffers.string_bytes.as_slice()
                                            )),
                                            resolution.fmt(
                                                self.lockfile.buffers.string_bytes.as_slice(),
                                                Path::Style::Posix
                                            ),
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

                    self.increment_tree_install_count::<{ !IS_PENDING_PACKAGE_INSTALL }>(
                        self.current_tree_id,
                        log_level,
                    );
                }
                PackageInstall::Result::Failure(cause) => {
                    if cfg!(debug_assertions) {
                        debug_assert!(
                            !cause.is_package_missing_from_cache()
                                || (resolution.tag != Resolution::Tag::Symlink
                                    && resolution.tag != Resolution::Tag::Workspace)
                        );
                    }

                    // even if the package failed to install, we still need to increment the install
                    // counter for this tree
                    self.increment_tree_install_count::<{ !IS_PENDING_PACKAGE_INSTALL }>(
                        self.current_tree_id,
                        log_level,
                    );

                    if cause.err == bun_core::err!("DanglingSymlink") {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r>: <b>{}<r> \"link:{}\" not found (try running 'bun link' in the intended package's folder)<r>",
                            cause.err.name(),
                            bstr::BStr::new(
                                self.names[package_id as usize]
                                    .slice(self.lockfile.buffers.string_bytes.as_slice())
                            ),
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
                                                        self.lockfile
                                                            .buffers
                                                            .string_bytes
                                                            .as_slice()
                                                    )
                                                ),
                                            ),
                                        );
                                        if cfg!(debug_assertions) {
                                            Output::err(err, format_args!("Failed to stat node_modules"));
                                        }
                                        Global::exit(1);
                                    }
                                };
                                let stat = match bun_sys::fstat(Fd::from_std_dir(dir)).unwrap() {
                                    Ok(s) => s,
                                    Err(err) => {
                                        Output::err_tag(
                                            "EACCES",
                                            format_args!(
                                                "Permission denied while installing <b>{}<r>",
                                                bstr::BStr::new(
                                                    self.names[package_id as usize].slice(
                                                        self.lockfile
                                                            .buffers
                                                            .string_bytes
                                                            .as_slice()
                                                    )
                                                ),
                                            ),
                                        );
                                        if cfg!(debug_assertions) {
                                            Output::err(err, format_args!("Failed to stat node_modules"));
                                        }
                                        Global::exit(1);
                                    }
                                };

                                let is_writable = if stat.uid == bun_sys::c::getuid() {
                                    stat.mode & bun_sys::S::IWUSR > 0
                                } else if stat.gid == bun_sys::c::getgid() {
                                    stat.mode & bun_sys::S::IWGRP > 0
                                } else {
                                    stat.mode & bun_sys::S::IWOTH > 0
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
                                    self.names[package_id as usize]
                                        .slice(self.lockfile.buffers.string_bytes.as_slice())
                                ),
                            ),
                        );

                        self.summary.fail += 1;
                    } else {
                        Output::err(
                            cause.err,
                            format_args!(
                                "failed {} for package <b>{}<r>",
                                install_result.failure().step.name(),
                                bstr::BStr::new(
                                    self.names[package_id as usize]
                                        .slice(self.lockfile.buffers.string_bytes.as_slice())
                                ),
                            ),
                        );
                        #[cfg(debug_assertions)]
                        {
                            let mut t = cause.debug_trace;
                            bun_crash_handler::dump_stack_trace(t.trace(), Default::default());
                        }
                        self.summary.fail += 1;
                    }
                }
            }
        } else {
            if self.bins[package_id as usize].tag != Bin::Tag::None {
                self.trees[self.current_tree_id as usize]
                    .binaries
                    .add(dependency_id)
                    .unwrap_or_oom();
            }

            let mut destination_dir = LazyPackageDestinationDir::NodeModulesPath {
                node_modules: &self.node_modules,
                root_node_modules_dir: self.root_node_modules_folder,
            };

            // TODO(port): `defer { destination_dir.close(); }` + `defer increment_tree_install_count`.
            // No early returns in this branch, so manual calls at end are equivalent.

            let dep = self.lockfile.buffers.dependencies.as_slice()[dependency_id as usize];
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
                    .manager
                    .summary
                    .added_trusted_dependencies
                    .get(&truncated_dep_name_hash)
                {
                    // is a new trusted dependency. need to enqueue scripts and maybe add to lockfile
                    break 'brk (true, false, *should_add_to_lockfile);
                }
                break 'brk (false, false, false);
            };

            if resolution.tag != Resolution::Tag::Root && is_trusted {
                let mut folder_path = AbsPath::from(self.node_modules.path.as_slice());
                folder_path.append(alias.slice(self.lockfile.buffers.string_bytes.as_slice()));

                'enqueue_lifecycle_scripts: {
                    if self.manager.postinstall_optimizer.should_ignore_lifecycle_scripts(
                        PostinstallOptimizer::ScriptCheck {
                            name_hash: pkg_name_hash,
                            version: if resolution.tag == Resolution::Tag::Npm {
                                Some(resolution.value.npm.version)
                            } else {
                                None
                            },
                            version_buf: self.lockfile.buffers.string_bytes.as_slice(),
                        },
                        self.lockfile.packages.items_resolutions()[package_id as usize]
                            .get(self.lockfile.buffers.resolutions.as_slice()),
                        self.lockfile.packages.items_meta(),
                        self.manager.options.cpu,
                        self.manager.options.os,
                        self.current_tree_id,
                    ) {
                        if PackageManager::verbose_install() {
                            Output::pretty_errorln(format_args!(
                                "<d>[Lifecycle Scripts]<r> ignoring {} lifecycle scripts",
                                bstr::BStr::new(
                                    pkg_name
                                        .slice(self.lockfile.buffers.string_bytes.as_slice())
                                ),
                            ));
                        }
                        break 'enqueue_lifecycle_scripts;
                    }

                    if self.enqueue_lifecycle_scripts(
                        alias.slice(self.lockfile.buffers.string_bytes.as_slice()),
                        log_level,
                        &mut folder_path,
                        package_id,
                        dep.behavior.optional,
                        resolution,
                    ) {
                        if is_trusted_through_update_request {
                            self.manager.trusted_deps_to_add_to_package_json.push(
                                Box::<[u8]>::from(
                                    alias.slice(self.lockfile.buffers.string_bytes.as_slice()),
                                ),
                            );
                        }

                        if add_to_lockfile {
                            if self.lockfile.trusted_dependencies.is_none() {
                                self.lockfile.trusted_dependencies = Some(Default::default());
                            }
                            self.lockfile
                                .trusted_dependencies
                                .as_mut()
                                .unwrap()
                                .put(truncated_dep_name_hash, ())
                                .unwrap_or_oom();
                        }
                    }
                }
            }

            self.increment_tree_install_count::<{ !IS_PENDING_PACKAGE_INSTALL }>(
                self.current_tree_id,
                log_level,
            );
            destination_dir.close();
        }
    }

    fn fail_with_invalid_url<const IS_PENDING_PACKAGE_INSTALL: bool>(
        &mut self,
        log_level: Options::LogLevel,
    ) {
        self.summary.fail += 1;
        self.increment_tree_install_count::<{ !IS_PENDING_PACKAGE_INSTALL }>(
            self.current_tree_id,
            log_level,
        );
    }

    /// returns true if scripts are enqueued
    fn enqueue_lifecycle_scripts(
        &mut self,
        folder_name: &[u8],
        log_level: Options::LogLevel,
        package_path: &mut AbsPath, // TODO(port): bun.AbsPath(.{ .sep = .auto })
        package_id: PackageID,
        optional: bool,
        resolution: &Resolution,
    ) -> bool {
        let mut scripts: Package::Scripts =
            self.lockfile.packages.items_scripts()[package_id as usize];
        let scripts_list = match scripts.get_list(
            &mut self.manager.log,
            self.lockfile,
            package_path,
            folder_name,
            resolution,
        ) {
            Ok(v) => v,
            Err(err) => {
                if log_level != Options::LogLevel::Silent {
                    let fmt = "\n<r><red>error:<r> failed to enqueue lifecycle scripts for <b>{}<r>: {}\n";
                    // TODO(port): comptime Output.prettyFmt — see run_available_scripts.
                    if log_level.show_progress() {
                        if Output::enable_ansi_colors_stderr() {
                            self.progress.log(Output::pretty_fmt::<true>(fmt), format_args!("{} {}", bstr::BStr::new(folder_name), err.name()));
                        } else {
                            self.progress.log(Output::pretty_fmt::<false>(fmt), format_args!("{} {}", bstr::BStr::new(folder_name), err.name()));
                        }
                    } else {
                        Output::pretty_errorln(format_args!(
                            "\n<r><red>error:<r> failed to enqueue lifecycle scripts for <b>{}<r>: {}\n",
                            bstr::BStr::new(folder_name),
                            err.name(),
                        ));
                    }
                }

                if self.manager.options.enable.fail_early {
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

        if self.manager.options.do_.run_scripts {
            self.manager.total_scripts += scripts_list.total;
            if let Some(scripts_node) = self.manager.scripts_node.as_mut() {
                self.manager.set_node_name(
                    scripts_node,
                    scripts_list.package_name,
                    PackageManager::ProgressStrings::SCRIPT_EMOJI,
                    true,
                );
                scripts_node.set_estimated_total_items(
                    scripts_node.unprotected_estimated_total_items + scripts_list.total,
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
        let package_id = self.lockfile.buffers.resolutions.as_slice()[dep_id as usize];

        let name = self.names[package_id as usize];
        // SAFETY: resolution points into self.resolutions which is not resized here.
        // TODO(port): reshape to avoid raw ptr aliasing &mut self.
        let resolution = &self.resolutions[package_id as usize] as *const Resolution;

        const NEEDS_VERIFY: bool = true;
        const IS_PENDING_PACKAGE_INSTALL: bool = false;
        self.install_package_with_name_and_resolution::<NEEDS_VERIFY, IS_PENDING_PACKAGE_INSTALL>(
            dep_id,
            package_id,
            log_level,
            name,
            unsafe { &*resolution },
        );
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageInstaller.zig (1555 lines)
//   confidence: medium
//   todos:      29
//   notes:      Heavy borrowck reshaping needed: cached slice fields alias &mut Lockfile; defer save/restore of node_modules; *const Resolution raw ptrs to dodge &mut self overlap. std.fs.Dir mapped to bun_sys::Dir.
// ──────────────────────────────────────────────────────────────────────────
