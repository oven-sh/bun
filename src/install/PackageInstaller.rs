use core::sync::atomic::Ordering;

use bun_collections::{ArrayHashMap, DynamicBitSet, StringHashMap};
use bun_core::fmt::PathSep;
use bun_core::{Global, Output};
use bun_core::{ZStr, strings};
use bun_paths::resolve_path::{dirname, join_abs_string_z, join_z_buf};
use bun_paths::{AbsPath, AutoAbsPath, MAX_PATH_BYTES, PathBuffer, SEP, platform};
use bun_semver::String;
use bun_sys::{self as Syscall, Dir, Fd};

use crate::bin_real as bin;
use crate::bun_fs::FileSystem;
use crate::bun_progress::Node as ProgressNode;

use crate::lifecycle_script_runner::LifecycleScriptSubprocess;
// `Lockfile` here is the in-crate `crate::lockfile::Lockfile` (the
// struct `PackageManager.lockfile` actually carries). `lockfile_real` is still
// imported for `tree::Id` / `Tree` / `package::*`, all of
// which are the same types re-exported through `crate::lockfile`.
use crate::lockfile::Lockfile;
use crate::lockfile_real::package::{PackageColumns, scripts::Scripts as PackageScripts};
use crate::lockfile_real::{self as lockfile, Tree};
use crate::network_task::ForTarballError;
use crate::package_install::{self, InstallEnv, PackageInstall};
use crate::package_manager::{self, Options, PackageManager};
use crate::package_manager_real::progress_strings::ProgressStrings;
use crate::package_manager_task as task;
use crate::patch_install::{self, PatchTask};
use crate::postinstall_optimizer::{self, PostinstallOptimizer};
use crate::resolution::{self, Resolution};
use crate::{
    DependencyID, DependencyInstallContext, ExtractData, PackageID, TaskCallbackContext,
    TruncatedPackageNameHash, invalid_package_id,
};

bun_output::declare_scope!(PackageInstaller, hidden);

type Bitset = DynamicBitSet;

pub struct PendingLifecycleScript {
    pub(crate) list: lockfile::package::scripts::List,
    pub(crate) tree_id: lockfile::tree::Id,
    pub(crate) optional: bool,
}

pub struct PackageInstaller<'a> {
    pub manager: &'a mut PackageManager,

    /// relative paths from `next` will be copied into this list.
    pub(crate) node_modules: NodeModulesFolder,

    pub(crate) skip_verify_installed_version_number: bool,
    pub(crate) skip_delete: bool,
    pub(crate) force_install: bool,
    pub(crate) root_node_modules_folder: Dir,
    pub(crate) summary: &'a mut package_install::Summary,
    pub(crate) node: &'a mut ProgressNode,
    pub(crate) destination_dir_subpath_buf: PathBuffer,
    pub(crate) folder_path_buf: PathBuffer,
    pub(crate) successfully_installed: Bitset,
    pub(crate) current_tree_id: lockfile::tree::Id,
    /// Trees that live under a self-contained workspace: packages there are copied
    /// (real files) rather than hardlinked/cloned/symlinked from the cache, so tools
    /// that walk, prune or rewrite that node_modules cannot reach the shared cache.
    pub(crate) copy_trees: Bitset,

    // fields used for running lifecycle scripts when it's safe
    //
    /// set of completed tree ids
    pub(crate) completed_trees: Bitset,
    /// the tree ids a tree depends on before it can run the lifecycle scripts of it's immediate dependencies
    pub(crate) tree_ids_to_trees_the_id_depends_on: bun_collections::DynamicBitSetList,
    pub(crate) pending_lifecycle_scripts: Vec<PendingLifecycleScript>,

    pub(crate) trusted_dependencies_from_update_requests: ArrayHashMap<PackageID, ()>,

    /// uses same ids as lockfile.trees
    pub(crate) trees: Box<[TreeContext]>,

    pub(crate) seen_bin_links: StringHashMap<()>,
}

use bun_core::UnwrapOrOom;

#[derive(Default)]
pub struct NodeModulesFolder {
    pub(crate) tree_id: lockfile::tree::Id,
    pub(crate) path: Vec<u8>,
}

impl NodeModulesFolder {
    /// Since the stack size of these functions are rather large, let's not let them be inlined.
    #[inline(never)]
    fn directory_exists_at_without_opening_directories(
        &self,
        root_node_modules_dir: &Dir,
        file_path: &ZStr,
    ) -> bool {
        let mut path_buf = PathBuffer::uninit();
        let parts: [&[u8]; 2] = [self.path.as_slice(), file_path.as_bytes()];
        bun_sys::directory_exists_at(
            root_node_modules_dir.fd(),
            join_z_buf::<platform::Auto>(path_buf.as_mut_slice(), &parts),
        )
        .unwrap_or(false)
    }

    pub(crate) fn directory_exists_at(
        &self,
        root_node_modules_dir: &Dir,
        file_path: &ZStr,
    ) -> bool {
        if file_path.len() + self.path.len() * 2 < MAX_PATH_BYTES {
            return self
                .directory_exists_at_without_opening_directories(root_node_modules_dir, file_path);
        }

        let dir = match self.open_dir(root_node_modules_dir) {
            Ok(d) => d,
            Err(_) => return false,
        };
        bun_sys::directory_exists_at(&dir, file_path).unwrap_or(false)
    }

    /// Since the stack size of these functions are rather large, let's not let them be inlined.
    #[inline(never)]
    fn open_file_without_opening_directories(
        &self,
        root_node_modules_dir: &Dir,
        file_path: &ZStr,
    ) -> bun_sys::Result<bun_sys::File> {
        let mut path_buf = PathBuffer::uninit();
        let parts: [&[u8]; 2] = [self.path.as_slice(), file_path.as_bytes()];
        root_node_modules_dir.open_file(
            join_z_buf::<platform::Auto>(path_buf.as_mut_slice(), &parts),
            bun_sys::O::RDONLY,
            0,
        )
    }

    pub(crate) fn read_small_file(
        &self,
        root_node_modules_dir: &Dir,
        file_path: &ZStr,
    ) -> crate::Result<bun_sys::file::ReadToEndResult> {
        let file = self.open_file(root_node_modules_dir, file_path)?;
        let res = file.read_to_end_small();
        let _ = file.close(); // close error is non-actionable
        Ok(match res {
            Ok(bytes) => bun_sys::file::ReadToEndResult { bytes, err: None },
            Err(e) => bun_sys::file::ReadToEndResult {
                bytes: Vec::new(),
                err: Some(e),
            },
        })
    }

    pub(crate) fn open_file(
        &self,
        root_node_modules_dir: &Dir,
        file_path: &ZStr,
    ) -> crate::Result<bun_sys::File> {
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
                    _ => return Err(e.to_zig_err().into()),
                },
                Ok(file) => return Ok(file),
            }
        }

        let dir = self.open_dir(root_node_modules_dir)?;
        let res = dir.open_file(file_path, bun_sys::O::RDONLY, 0);
        res.map_err(|e| e.to_zig_err().into())
    }

    pub(crate) fn open_dir(&self, root: &Dir) -> crate::Result<Dir> {
        #[cfg(unix)]
        {
            // Copy into a NUL-terminated PathBuffer.
            let mut path_buf = PathBuffer::uninit();
            let path_z = bun_paths::resolve_path::z(self.path.as_slice(), &mut path_buf);
            return root
                .open_at_with(path_z.as_bytes(), 0)
                .map_err(|e| e.to_zig_err().into());
        }

        #[cfg(not(unix))]
        {
            return Ok(Dir::from_fd(
                bun_sys::open_dir_at_windows_a(
                    root.fd(),
                    self.path.as_slice(),
                    bun_sys::WindowsOpenDirOptions {
                        can_rename_or_delete: false,
                        ..Default::default()
                    },
                )
                .map_err(|e| e.to_zig_err())?,
            ));
        }
    }

    fn make_and_open_dir(&self, root: &Dir) -> crate::Result<Dir> {
        let out = 'brk: {
            #[cfg(unix)]
            {
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

/// Where a `PackageInstall`'s `cache_dir_subpath` lives.
#[derive(Clone, Copy)]
enum Subpath {
    Static(&'static ZStr),
    /// `folder_path_buf[..len]`, NUL at `len`.
    Folder(usize),
}

impl Subpath {
    const DOT: Subpath = Subpath::Static(ZStr::from_static(b".\0"));
    #[inline]
    fn of(z: &ZStr) -> Subpath {
        Subpath::Folder(z.len())
    }
    #[inline]
    fn get(self, folder_path_buf: &PathBuffer) -> &ZStr {
        match self {
            Subpath::Static(z) => z,
            Subpath::Folder(len) => ZStr::from_buf(&folder_path_buf[..], len),
        }
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
    pub(crate) pending_installs: Vec<DependencyInstallContext>,

    /// Drained in dependency-name order by `link_tree_bins`.
    pub(crate) binaries: Vec<DependencyID>,

    /// Number of installed dependencies. Could be successful or failure.
    pub(crate) install_count: usize,
}

type TreeContextId = lockfile::tree::Id;

/// Finds the tree whose `node_modules` contains `target_pkg_id`, walked in
/// Node resolution order from `<start_tree>/<alias>/`: the child tree at
/// `<start_tree>/<alias>/node_modules/`, then `start_tree`, then each ancestor.
fn find_native_binlink_target_tree(
    trees: &[Tree],
    hoisted_deps: &[DependencyID],
    resolutions: &[PackageID],
    deps: &[crate::Dependency],
    string_buf: &[u8],
    start_tree: lockfile::tree::Id,
    alias: &[u8],
    target_pkg_id: PackageID,
) -> Option<lockfile::tree::Id> {
    let tree_contains = |id: lockfile::tree::Id| -> bool {
        trees[id as usize]
            .dependencies
            .get(hoisted_deps)
            .iter()
            .any(|&dep_id| resolutions[dep_id as usize] == target_pkg_id)
    };

    for t in trees {
        if t.parent == start_tree && t.folder_name(deps, string_buf) == alias {
            if tree_contains(t.id) {
                return Some(t.id);
            }
            break;
        }
    }

    let mut cur = start_tree;
    loop {
        if tree_contains(cur) {
            return Some(cur);
        }
        let parent = trees[cur as usize].parent;
        if parent == lockfile::tree::INVALID_ID {
            return None;
        }
        cur = parent;
    }
}

fn abs_node_modules_path(
    lockfile: &Lockfile,
    string_buf: &[u8],
    tree_id: lockfile::tree::Id,
) -> AbsPath {
    let mut rel_buf = PathBuffer::uninit();
    rel_buf[..b"node_modules".len()].copy_from_slice(b"node_modules");
    let mut depth_buf = lockfile::tree::depth_buf_uninit();
    let (rel, _) = lockfile::tree::relative_path_and_depth::<
        { lockfile::tree::IteratorPathStyle::NodeModules },
    >(
        lockfile.buffers.trees.as_slice(),
        lockfile.buffers.dependencies.as_slice(),
        string_buf,
        tree_id,
        &mut rel_buf,
        &mut depth_buf,
    );
    let top = strings::without_trailing_slash(FileSystem::instance().top_level_dir());
    let mut abs = AbsPath::from(top).unwrap_or_oom();
    abs.append(rel.as_bytes()).unwrap_or_oom();
    abs
}

/// A dependency alias becomes the install destination inside `node_modules`
/// (the existing entry is renamed aside, deleted, and re-created). Reject
/// anything that could escape `node_modules`: empty names, `.`/`..`
/// components, absolute paths, drive letters, backslashes, NUL bytes, and any
/// separator other than the single `/` in a scoped name (`@scope/name`).
pub(crate) fn alias_is_safe_install_target(alias: &[u8]) -> bool {
    if alias.is_empty() || alias.len() >= MAX_PATH_BYTES || strings::contains_any(alias, b"\\:\0") {
        return false;
    }

    let mut component_count = 0usize;
    for component in strings::split(alias, b"/") {
        component_count += 1;
        if component.is_empty() || component == b"." || component == b".." {
            return false;
        }
    }

    component_count == 1 || (component_count == 2 && alias[0] == b'@')
}

/// Formats the version label `PackageInstall` verifies and hashes patches
/// against. npm versions fit `buf`; tarball, folder and git resolutions (and
/// prerelease tags) repeat a user-supplied path, URL or tag of unbounded
/// length, so a label that does not fit is formatted into `spill` instead.
fn print_package_version<'a>(
    buf: &'a mut [u8],
    spill: &'a mut Vec<u8>,
    args: core::fmt::Arguments<'_>,
) -> &'a [u8] {
    if let Ok(label) = bun_core::fmt::buf_print(buf, args) {
        return label;
    }
    std::io::Write::write_fmt(spill, args).expect("formatting into a Vec is infallible");
    spill
}

impl<'a> PackageInstaller<'a> {
    /// Increments the number of installed packages for a tree id and runs available scripts
    /// if the tree is finished.
    // `should_install_packages` only gates a single call below, so it's a
    // runtime arg rather than a const generic.
    fn increment_tree_install_count(
        &mut self,
        should_install_packages: bool,
        tree_id: lockfile::tree::Id,
        log_level: Options::LogLevel,
    ) {
        debug_assert!(tree_id != lockfile::tree::INVALID_ID);

        let tree = &mut self.trees[tree_id as usize];
        let current_count = tree.install_count;
        let max = self.manager.lockfile.buffers.trees.as_slice()[tree_id as usize]
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

        if !self.trees[tree_id as usize].binaries.is_empty() {
            self.seen_bin_links.clear();

            let mut link_target_buf = PathBuffer::uninit();
            let mut link_dest_buf = PathBuffer::uninit();
            let mut link_rel_buf = PathBuffer::uninit();
            self.link_tree_bins(
                tree_id,
                true,
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

    fn link_tree_bins(
        &mut self,
        // Takes only `tree_id` and re-borrows `&mut self.trees[tree_id]` to
        // satisfy borrowck.
        tree_id: TreeContextId,
        can_defer: bool,
        link_target_buf: &mut [u8],
        link_dest_buf: &mut [u8],
        link_rel_buf: &mut [u8],
        log_level: Options::LogLevel,
    ) {
        let PackageManager {
            lockfile,
            log,
            options,
            postinstall_optimizer,
            update_requests,
            ..
        } = &mut *self.manager;
        let lockfile: &Lockfile = lockfile;
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let mut node_modules_path: AbsPath =
            AbsPath::from(self.node_modules.path.as_slice()).unwrap_or_oom();

        let pkgs = lockfile.packages.slice();
        let pkg_name_hashes = pkgs.items_name_hash();
        let pkg_metas = pkgs.items_meta();
        let pkg_resolutions_lists = pkgs.items_resolutions();
        let pkg_resolutions_buffer = lockfile.buffers.resolutions.as_slice();
        let pkg_names = pkgs.items_name();

        let completed_trees = &self.completed_trees;
        let tree = &mut self.trees[tree_id as usize];
        let mut deferred: Vec<DependencyID> = Vec::new();

        let mut binaries = core::mem::take(&mut tree.binaries);
        {
            let dependencies = lockfile.buffers.dependencies.as_slice();
            binaries.sort_unstable_by(|&a, &b| {
                strings::order(
                    dependencies[a as usize].name.slice(string_buf),
                    dependencies[b as usize].name.slice(string_buf),
                )
            });
        }
        for dep_id in binaries {
            debug_assert!((dep_id as usize) < lockfile.buffers.dependencies.as_slice().len());
            let package_id = lockfile.buffers.resolutions.as_slice()[dep_id as usize];
            debug_assert!(package_id != invalid_package_id);
            let bin = lockfile.packages.items_bin()[package_id as usize];
            debug_assert!(bin.tag != bin::Tag::None);

            let alias = lockfile.buffers.dependencies.as_slice()[dep_id as usize]
                .name
                .slice(string_buf);
            let package_name_ = strings::StringOrTinyString::init(alias);
            let mut target_package_name = package_name_;
            let mut can_retry_without_native_binlink_optimization = false;
            let mut target_node_modules_path_opt: Option<AbsPath> = None;
            let mut defer_this_bin = false;

            'native_binlink_optimization: {
                if !postinstall_optimizer.is_native_binlink_enabled() {
                    break 'native_binlink_optimization;
                }
                // Check for native binlink optimization
                let name_hash = pkg_name_hashes[package_id as usize];
                if let Some(optimizer) =
                    postinstall_optimizer.get(&postinstall_optimizer::PkgInfo {
                        name_hash,
                        ..Default::default()
                    })
                {
                    match optimizer {
                        PostinstallOptimizer::NativeBinlink => {
                            let target_cpu = options.cpu;
                            let target_os = options.os;
                            if let Some(replacement_pkg_id) =
                                PostinstallOptimizer::get_native_binlink_replacement_package_id(
                                    pkg_resolutions_lists[package_id as usize]
                                        .get(pkg_resolutions_buffer),
                                    pkg_metas,
                                    target_cpu,
                                    target_os,
                                )
                            {
                                let Some(target_tree_id) = find_native_binlink_target_tree(
                                    lockfile.buffers.trees.as_slice(),
                                    lockfile.buffers.hoisted_dependencies.as_slice(),
                                    lockfile.buffers.resolutions.as_slice(),
                                    lockfile.buffers.dependencies.as_slice(),
                                    string_buf,
                                    tree_id,
                                    alias,
                                    replacement_pkg_id,
                                ) else {
                                    break 'native_binlink_optimization;
                                };

                                if target_tree_id != tree_id {
                                    if can_defer && !completed_trees.is_set(target_tree_id as usize)
                                    {
                                        // Platform package's tree isn't installed
                                        // yet: link the package's own bin now and
                                        // re-queue for `link_remaining_bins`.
                                        defer_this_bin = true;
                                        break 'native_binlink_optimization;
                                    }
                                    target_node_modules_path_opt = Some(abs_node_modules_path(
                                        lockfile,
                                        string_buf,
                                        target_tree_id,
                                    ));
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

            if defer_this_bin {
                deferred.push(dep_id);
            }
            // globally linked packages shouls always belong to the root
            // tree (0).
            let global = if !options.global || tree_id != 0 {
                false
            } else {
                'global: {
                    for request in update_requests.iter() {
                        if request.package_id == package_id {
                            break 'global true;
                        }
                    }
                    break 'global false;
                }
            };

            loop {
                let mut bin_linker = bin::Linker {
                    bin,
                    global_bin_path: options.bin_path,
                    package_name: package_name_,
                    target_package_name,
                    string_buf,
                    extern_string_buf: lockfile.buffers.extern_strings.as_slice(),
                    seen: Some(&mut self.seen_bin_links),
                    target_node_modules_path: target_node_modules_path_opt.as_ref(),
                    node_modules_path: &mut node_modules_path,
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
                        bun_core::pretty_errorln!(
                            "<d>[Bin Linker]<r> {} -> {} retrying without native bin link",
                            bstr::BStr::new(package_name_.slice()),
                            bstr::BStr::new(target_package_name.slice()),
                        );
                    }
                    target_package_name = package_name_;
                    target_node_modules_path_opt = None;
                    continue;
                }

                if let Some(err) = bin_linker.err {
                    if log_level != Options::LogLevel::Silent {
                        bun_ast::add_error_pretty!(
                            log,
                            None,
                            bun_ast::Loc::EMPTY,
                            "Failed to link <b>{}<r>: {}",
                            bstr::BStr::new(alias),
                            err.name(),
                        );
                    }

                    if options.enable.fail_early() {
                        PackageManager::crash_with_log(options, log);
                    }
                }

                break;
            }
        }

        tree.binaries.extend_from_slice(&deferred);
    }

    pub(crate) fn link_remaining_bins(&mut self, log_level: Options::LogLevel) {
        let mut depth_buf = lockfile::tree::depth_buf_uninit();
        let mut node_modules_rel_path_buf = PathBuffer::uninit();
        node_modules_rel_path_buf[..b"node_modules".len()].copy_from_slice(b"node_modules");

        let mut link_target_buf = PathBuffer::uninit();
        let mut link_dest_buf = PathBuffer::uninit();
        let mut link_rel_buf = PathBuffer::uninit();

        let trees_len = self.trees.len();
        for tree_id in 0..trees_len {
            if !self.trees[tree_id].binaries.is_empty() {
                self.seen_bin_links.clear();
                self.node_modules.path.truncate(
                    strings::without_trailing_slash(FileSystem::instance().top_level_dir()).len()
                        + 1,
                );
                let (rel_path, _) = lockfile::tree::relative_path_and_depth::<
                    { lockfile::tree::IteratorPathStyle::NodeModules },
                >(
                    self.manager.lockfile.buffers.trees.as_slice(),
                    self.manager.lockfile.buffers.dependencies.as_slice(),
                    self.manager.lockfile.buffers.string_bytes.as_slice(),
                    // `tree_id` ranges over `0..self.trees.len()`
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
                    false,
                    link_target_buf.as_mut_slice(),
                    link_dest_buf.as_mut_slice(),
                    link_rel_buf.as_mut_slice(),
                    log_level,
                );
            }
        }
    }

    fn run_available_scripts(&mut self, log_level: Options::LogLevel) {
        let mut i: usize = self.pending_lifecycle_scripts.len();
        while i > 0 {
            i -= 1;
            let tree_id = self.pending_lifecycle_scripts[i].tree_id;
            let optional = self.pending_lifecycle_scripts[i].optional;
            if self.can_run_scripts(tree_id) {
                let entry = self.pending_lifecycle_scripts.swap_remove(i);
                // Cloned for the error message; `entry.list` is moved into the spawn.
                let name: Box<[u8]> = entry.list.package_name.clone();
                let output_in_foreground = false;

                if let Err(err) = self.manager.spawn_package_lifecycle_scripts(
                    entry.list,
                    optional,
                    output_in_foreground,
                    None,
                ) {
                    if log_level != Options::LogLevel::Silent {
                        if log_level.show_progress() {
                            if Output::enable_ansi_colors_stderr() {
                                self.manager.progress.log(format_args!(
                                    bun_core::pretty_fmt!(
                                        "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{s}<r>: {s}\n",
                                        true
                                    ),
                                    bstr::BStr::new(&name),
                                    err.name(),
                                ));
                            } else {
                                self.manager.progress.log(format_args!(
                                    bun_core::pretty_fmt!(
                                        "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{s}<r>: {s}\n",
                                        false
                                    ),
                                    bstr::BStr::new(&name),
                                    err.name(),
                                ));
                            }
                        } else {
                            bun_core::pretty_errorln!(
                                "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{}<r>: {}\n",
                                bstr::BStr::new(&name),
                                err.name(),
                            );
                        }
                    }

                    if self.manager.options.enable.fail_early() {
                        Global::exit(1);
                    }

                    Output::flush();
                    self.summary.fail += 1;
                }
            }
        }
    }

    pub(crate) fn install_available_packages<const FORCE: bool>(
        &mut self,
        log_level: Options::LogLevel,
    ) {
        // Manual save/restore of self.node_modules / self.current_tree_id:
        // a guard cannot capture `&mut self` alongside the loop body's
        // `&mut self`. The function is infallible and its single exit below restores.
        let prev_node_modules = core::mem::take(&mut self.node_modules);
        let prev_tree_id = self.current_tree_id;

        let trees_len = self.trees.len();
        for i in 0..trees_len {
            if FORCE
                || Self::can_install_package_for_tree(
                    &self.completed_trees,
                    self.manager.lockfile.buffers.trees.as_slice(),
                    // `i` ranges over `0..self.trees.len()`; tree
                    // IDs are u32 by construction.
                    i as u32,
                )
            {
                // If installing these packages completes the tree, we don't allow it
                // to call `install_available_packages` recursively. Starting at id 0 and
                // going up ensures we will reach any trees that will be able to install
                // packages upon completing the current tree
                //
                // Drain by move (`mem::take`): no per-item clones, and
                // `pending_installs` is left empty.
                for context in core::mem::take(&mut self.trees[i].pending_installs) {
                    let package_id = self.manager.lockfile.buffers.resolutions.as_slice()
                        [context.dependency_id as usize];
                    let name = self.manager.lockfile.packages.items_name()[package_id as usize];
                    let resolution =
                        self.manager.lockfile.packages.items_resolution()[package_id as usize];
                    self.node_modules.tree_id = context.tree_id;
                    self.node_modules.path = context.path;
                    self.current_tree_id = context.tree_id;

                    // Re-verify: a parent reinstall may have deleted a deferred entry.
                    let needs_verify = true;
                    let is_pending_package_install = true;
                    self.install_package_with_name_and_resolution(
                        // This id might be different from the id used to enqueue the task. Important
                        // to use the correct one because the package might be aliased with a different
                        // name
                        context.dependency_id,
                        package_id,
                        log_level,
                        name,
                        &resolution,
                        needs_verify,
                        is_pending_package_install,
                    );
                }
            }
        }

        self.node_modules = prev_node_modules;
        self.current_tree_id = prev_tree_id;
    }

    pub(crate) fn complete_remaining_scripts(&mut self, log_level: Options::LogLevel) {
        for entry in core::mem::take(&mut self.pending_lifecycle_scripts) {
            let package_name: Box<[u8]> = entry.list.package_name.clone();
            // .monotonic is okay because this value isn't modified from any other thread.
            // (Scripts are spawned on this thread.)
            while LifecycleScriptSubprocess::alive_count().load(Ordering::Relaxed)
                >= self.manager.options.max_concurrent_lifecycle_scripts
            {
                self.manager.sleep();
            }

            let optional = entry.optional;
            let output_in_foreground = false;
            if let Err(err) = self.manager.spawn_package_lifecycle_scripts(
                entry.list,
                optional,
                output_in_foreground,
                None,
            ) {
                if log_level != Options::LogLevel::Silent {
                    if log_level.show_progress() {
                        if Output::enable_ansi_colors_stderr() {
                            self.manager.progress.log(format_args!(
                                bun_core::pretty_fmt!(
                                    "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{s}<r>: {s}\n",
                                    true
                                ),
                                bstr::BStr::new(&package_name),
                                err.name(),
                            ));
                        } else {
                            self.manager.progress.log(format_args!(
                                bun_core::pretty_fmt!(
                                    "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{s}<r>: {s}\n",
                                    false
                                ),
                                bstr::BStr::new(&package_name),
                                err.name(),
                            ));
                        }
                    } else {
                        bun_core::pretty_errorln!(
                            "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{}<r>: {}\n",
                            bstr::BStr::new(&package_name),
                            err.name(),
                        );
                    }
                }

                if self.manager.options.enable.fail_early() {
                    Global::exit(1);
                }

                Output::flush();
                self.summary.fail += 1;
            }
        }

        // .monotonic is okay because this value isn't modified from any other thread.
        while self
            .manager
            .pending_lifecycle_script_tasks
            .load(Ordering::Relaxed)
            > 0
        {
            self.manager.report_slow_lifecycle_scripts();

            if log_level.show_progress() {
                if let Some(scripts_node) = self.manager.scripts_node_mut() {
                    scripts_node.activate();
                    self.manager.progress.refresh();
                }
            }

            self.manager.sleep();
        }
    }

    /// Check if a tree is ready to start running lifecycle scripts
    fn can_run_scripts(&self, scripts_tree_id: lockfile::tree::Id) -> bool {
        let deps = self
            .tree_ids_to_trees_the_id_depends_on
            .at(scripts_tree_id as usize);
        // .monotonic is okay because this value isn't modified from any other thread.
        (deps.subset_of(&self.completed_trees.unmanaged)
            || deps.eql(&self.completed_trees.unmanaged))
            && LifecycleScriptSubprocess::alive_count().load(Ordering::Relaxed)
                < self.manager.options.max_concurrent_lifecycle_scripts
    }

    /// A tree can start installing packages when the parent has installed all its packages. If the parent
    /// isn't finished, we need to wait because it's possible a package installed in this tree will be deleted by the parent.
    // free fn (not `&self`) so callers can pass disjoint borrows
    // (`&self.completed_trees` + `&self.manager.lockfile.buffers.trees`) without
    // tripping borrowck on the whole-`self` reborrow.
    fn can_install_package_for_tree(
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

    /// Grow `successfully_installed` to cover packages appended to the
    /// lockfile since it was sized (e.g. a git dependency's transitive deps).
    pub(crate) fn grow_successfully_installed(&mut self) {
        let packages_len = self.manager.lockfile.packages.len();
        if self.successfully_installed.bit_length() < packages_len {
            let new = Bitset::init_empty(packages_len).unwrap_or_oom();
            let old = core::mem::replace(&mut self.successfully_installed, new);
            old.copy_into(&mut self.successfully_installed);
        }
    }

    /// Install versions of a package which are waiting on a network request
    pub(crate) fn install_enqueued_packages_after_extraction(
        &mut self,
        task_id: task::Id,
        dependency_id: DependencyID,
        data: &ExtractData,
        log_level: Options::LogLevel,
    ) {
        let package_id =
            self.manager.lockfile.buffers.resolutions.as_slice()[dependency_id as usize];
        let name = self.manager.lockfile.packages.items_name()[package_id as usize];

        // If a newly computed integrity hash is available (e.g. for a GitHub
        // tarball) and the lockfile doesn't already have one, persist it so
        // the lockfile gets re-saved with the hash.
        if data.integrity.tag.is_supported() {
            let pkg_metas = self.manager.lockfile.packages.items_meta_mut();
            if !pkg_metas[package_id as usize].integrity.tag.is_supported() {
                pkg_metas[package_id as usize].integrity = data.integrity;
                self.manager
                    .options
                    .enable
                    .set(Options::Enable::FORCE_SAVE_LOCKFILE, true);
            }
        }

        if let Some(removed) = self.manager.task_queue.fetch_remove(&task_id) {
            let callbacks = removed.value;

            // Manual save/restore of self.node_modules / self.current_tree_id
            // (see install_available_packages). Infallible body — both exit
            // paths below restore the saved values.
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
                let TaskCallbackContext::DependencyInstallContext(context) = cb else {
                    debug_assert!(false, "expected DependencyInstallContext");
                    continue;
                };
                let callback_package_id = self.manager.lockfile.buffers.resolutions.as_slice()
                    [context.dependency_id as usize];
                self.node_modules.tree_id = context.tree_id;
                // `DependencyInstallContext.path: Vec<u8>` — clone since `cb` is `&`.
                self.node_modules.path.clone_from(&context.path);
                self.current_tree_id = context.tree_id;
                let needs_verify = false;
                let is_pending_package_install = false;
                let resolution =
                    self.manager.lockfile.packages.items_resolution()[callback_package_id as usize];
                self.install_package_with_name_and_resolution(
                    // This id might be different from the id used to enqueue the task. Important
                    // to use the correct one because the package might be aliased with a different
                    // name
                    context.dependency_id,
                    callback_package_id,
                    log_level,
                    name,
                    &resolution,
                    needs_verify,
                    is_pending_package_install,
                );
            }
            self.node_modules = prev_node_modules;
            self.current_tree_id = prev_tree_id;
            return;
        }

        if cfg!(debug_assertions) {
            Output::panic(format_args!(
                "Ran callback to install enqueued packages, but there was no task associated with it. {}:{} (dependency_id: {})",
                bun_core::fmt::quote(
                    name.slice(self.manager.lockfile.buffers.string_bytes.as_slice())
                ),
                bun_core::fmt::quote(&data.url),
                dependency_id,
            ));
        }
    }

    fn get_installed_package_scripts_count(
        &mut self,
        alias: String,
        package_id: PackageID,
        resolution_tag: resolution::Tag,
        folder_path: &mut bun_paths::AutoAbsPath,
        log_level: Options::LogLevel,
    ) -> usize {
        debug_assert!(resolution_tag != resolution::Tag::Root);
        debug_assert!(resolution_tag != resolution::Tag::Workspace);
        debug_assert!(package_id != 0);
        let mut count: usize = 0;
        let scripts = 'brk: {
            let scripts = self.manager.lockfile.packages.items_scripts()[package_id as usize];
            if scripts.filled {
                break 'brk scripts;
            }

            let mut temp = PackageScripts::default();
            let mut temp_lockfile = Lockfile::default();
            temp_lockfile.init_empty();
            let mut string_builder = temp_lockfile.string_builder();
            if let Err(err) =
                temp.fill_from_package_json(&mut string_builder, &mut self.manager.log, folder_path)
            {
                if log_level != Options::LogLevel::Silent {
                    Output::err_generic(
                        "failed to fill lifecycle scripts for <b>{}<r>: {}",
                        (
                            bstr::BStr::new(self.manager.lockfile.str(&alias)),
                            err.name(),
                        ),
                    );
                }

                if self.manager.options.enable.fail_early() {
                    Global::crash();
                }

                return 0;
            }
            break 'brk temp;
        };

        debug_assert!(scripts.filled);

        match resolution_tag {
            resolution::Tag::Git | resolution::Tag::Github | resolution::Tag::Root => {
                // The `FIELD_NAMES` table lists each script field accessor.
                for &(_, accessor) in PackageScripts::FIELD_NAMES.iter() {
                    count += (!accessor(&scripts).is_empty()) as usize;
                }
            }
            _ => {
                count += (!scripts.preinstall.is_empty()) as usize;
                count += (!scripts.install.is_empty()) as usize;
                count += (!scripts.postinstall.is_empty()) as usize;
            }
        }

        if scripts.preinstall.is_empty() && scripts.install.is_empty() {
            let binding_dot_gyp_path = join_abs_string_z::<platform::Auto>(
                self.node_modules.path.as_slice(),
                &[self.manager.lockfile.str(&alias), b"binding.gyp"],
            );
            count += Syscall::exists(binding_dot_gyp_path) as usize;
        }

        count
    }

    pub(crate) fn install_package_with_name_and_resolution(
        &mut self,
        dependency_id: DependencyID,
        package_id: PackageID,
        log_level: Options::LogLevel,
        pkg_name: String,
        resolution: &Resolution,
        // false when coming from download. if the package was downloaded
        // it was already determined to need an install
        needs_verify: bool,
        // we don't want to allow more package installs through
        // pending packages if we're already draining them.
        is_pending_package_install: bool,
    ) {
        macro_rules! string_buf {
            () => {
                self.manager.lockfile.buffers.string_bytes.as_slice()
            };
        }

        let alias =
            self.manager.lockfile.buffers.dependencies.as_slice()[dependency_id as usize].name;

        // The alias is used as a path relative to `node_modules` for delete,
        // rename, and create operations. Refuse anything that could escape it.
        if !alias_is_safe_install_target(alias.slice(string_buf!())) {
            if log_level != Options::LogLevel::Silent {
                bun_core::pretty_errorln!(
                    "<r><red>error<r>: refusing to install dependency with unsafe name <b>{}<r>",
                    bstr::BStr::new(alias.slice(string_buf!())),
                );
            }
            self.summary.fail += 1;
            self.increment_tree_install_count(
                !is_pending_package_install,
                self.current_tree_id,
                log_level,
            );
            return;
        }

        let destination_dir_subpath_len = {
            let alias_slice = alias.slice(self.manager.lockfile.buffers.string_bytes.as_slice());
            let buf = &mut self.destination_dir_subpath_buf;
            buf[..alias_slice.len()].copy_from_slice(alias_slice);
            buf[alias_slice.len()] = 0;
            alias_slice.len()
        };

        let pkg_name_hash = self.manager.lockfile.packages.items_name_hash()[package_id as usize];

        let mut resolution_buf = [0u8; 512];
        let mut resolution_spill = Vec::new();
        let package_version: &[u8] = if resolution.tag == resolution::Tag::Workspace {
            'brk: {
                if let Some(workspace_version) =
                    self.manager.lockfile.workspace_versions.get(&pkg_name_hash)
                {
                    break 'brk print_package_version(
                        &mut resolution_buf,
                        &mut resolution_spill,
                        format_args!("{}", workspace_version.fmt(string_buf!())),
                    );
                }

                // no version
                break 'brk b"";
            }
        } else {
            print_package_version(
                &mut resolution_buf,
                &mut resolution_spill,
                format_args!("{}", resolution.fmt(string_buf!(), PathSep::Posix)),
            )
        };

        let (patch_contents_hash, patch_name_and_version_hash, remove_patch) = 'brk: {
            if self.manager.lockfile.patched_dependencies.count() == 0
                && self.manager.patched_dependencies_to_remove.count() == 0
            {
                break 'brk (None, None, false);
            }
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
                .manager
                .lockfile
                .patched_dependencies
                .get(&name_and_version_hash)
            else {
                let to_remove = self
                    .manager
                    .patched_dependencies_to_remove
                    .contains(&name_and_version_hash);
                if to_remove {
                    break 'brk (None, Some(name_and_version_hash), true);
                }
                break 'brk (None, None, false);
            };
            let Some(patch_contents_hash) = patchdep.patchfile_hash() else {
                if log_level != Options::LogLevel::Silent {
                    bun_core::pretty_errorln!(
                        "<r><red>error<r>: failed to patch package <b>{}<r>: the hash of patch file {} was not calculated before install, this is a bug in Bun",
                        bstr::BStr::new(&name_and_version),
                        bun_core::fmt::quote(patchdep.path.slice(string_buf!())),
                    );
                }
                self.summary.fail += 1;
                self.increment_tree_install_count(
                    !is_pending_package_install,
                    self.current_tree_id,
                    log_level,
                );
                return;
            };
            break 'brk (
                Some(patch_contents_hash),
                Some(name_and_version_hash),
                false,
            );
        };

        let patch =
            patch_contents_hash.map(|contents_hash| package_install::Patch { contents_hash });
        let mut cache_dir: Fd;
        let cache_dir_subpath: Subpath;
        // A `PackageInstall` over this installer's buffers, built per use so
        // the buffers stay free between uses.
        macro_rules! pkg_install {
            () => {
                PackageInstall {
                    cache_dir,
                    cache_dir_subpath: cache_dir_subpath.get(&self.folder_path_buf),
                    destination_dir_subpath_buf: &mut self.destination_dir_subpath_buf,
                    destination_dir_subpath_len,
                    package_name: pkg_name,
                    package_version,
                    patch,
                    node_modules: &self.node_modules,
                }
            };
        }
        bun_output::scoped_log!(
            PackageInstaller,
            "Installing {}@{}",
            bstr::BStr::new(pkg_name.slice(string_buf!())),
            resolution.fmt(string_buf!(), PathSep::Posix),
        );

        match resolution.tag {
            resolution::Tag::Npm => {
                cache_dir = package_manager::get_cache_directory(self.manager);
                cache_dir_subpath = Subpath::of(package_manager::cached_npm_package_folder_name(
                    self.manager,
                    &mut self.folder_path_buf,
                    pkg_name.slice(self.manager.lockfile.buffers.string_bytes.as_slice()),
                    resolution.npm().version,
                    patch_contents_hash,
                ));
            }
            resolution::Tag::Git => {
                cache_dir = package_manager::get_cache_directory(self.manager);
                cache_dir_subpath = Subpath::of(package_manager::cached_git_folder_name(
                    self.manager,
                    &mut self.folder_path_buf,
                    resolution.git(),
                    patch_contents_hash,
                ));
            }
            resolution::Tag::Github => {
                cache_dir = package_manager::get_cache_directory(self.manager);
                cache_dir_subpath = Subpath::of(package_manager::cached_github_folder_name(
                    self.manager,
                    &mut self.folder_path_buf,
                    resolution.github(),
                    patch_contents_hash,
                ));
            }
            resolution::Tag::Folder => {
                let folder_str = *resolution.folder();
                let folder = folder_str.slice(string_buf!());

                if self
                    .manager
                    .lockfile
                    .is_workspace_tree_id(self.current_tree_id)
                {
                    // Handle when a package depends on itself via file:
                    // example:
                    //   "mineflayer": "file:."
                    if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                        cache_dir_subpath = Subpath::DOT;
                    } else {
                        self.folder_path_buf[..folder.len()].copy_from_slice(folder);
                        self.folder_path_buf[folder.len()] = 0;
                        cache_dir_subpath = Subpath::Folder(folder.len());
                    }
                    cache_dir = Fd::cwd();
                } else {
                    // transitive folder dependencies are not hoisted
                    if folder.len() >= self.folder_path_buf.len()
                        || (bin::bin_target_escapes_package_dir(folder) && {
                            // overrides/resolutions are only ever parsed from the root
                            // package.json, so a folder path that reached here via an
                            // override was written by the user and is trusted the same
                            // as a direct dependency of the root.
                            let dep = &self.manager.lockfile.buffers.dependencies.as_slice()
                                [dependency_id as usize];
                            !self.manager.lockfile.overrides.contains_name(
                                dep.name_hash,
                                dep.name.slice(string_buf!()),
                                string_buf!(),
                            )
                        })
                    {
                        if log_level != Options::LogLevel::Silent {
                            bun_core::pretty_errorln!(
                                "<r><red>error<r>: refusing to install dependency <b>{}<r> with unsafe folder path \"{}\"",
                                bstr::BStr::new(pkg_name.slice(string_buf!())),
                                bstr::BStr::new(folder),
                            );
                        }
                        self.summary.fail += 1;
                        self.increment_tree_install_count(
                            !is_pending_package_install,
                            self.current_tree_id,
                            log_level,
                        );
                        return;
                    }
                    self.folder_path_buf[..folder.len()].copy_from_slice(folder);
                    self.folder_path_buf[folder.len()] = 0;
                    cache_dir_subpath = Subpath::Folder(folder.len());

                    // cache_dir might not be created yet (if it's in node_modules)
                    cache_dir = Fd::cwd();
                }
            }
            resolution::Tag::LocalTarball => {
                cache_dir = package_manager::get_cache_directory(self.manager);
                cache_dir_subpath = Subpath::of(package_manager::cached_tarball_folder_name(
                    self.manager,
                    &mut self.folder_path_buf,
                    *resolution.local_tarball(),
                    patch_contents_hash,
                ));
            }
            resolution::Tag::RemoteTarball => {
                cache_dir = package_manager::get_cache_directory(self.manager);
                cache_dir_subpath = Subpath::of(package_manager::cached_tarball_folder_name(
                    self.manager,
                    &mut self.folder_path_buf,
                    *resolution.remote_tarball(),
                    patch_contents_hash,
                ));
            }
            resolution::Tag::Workspace => {
                let folder_str = *resolution.workspace();
                let folder = folder_str.slice(string_buf!());
                // Handle when a package depends on itself
                if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                    cache_dir_subpath = Subpath::DOT;
                } else {
                    self.folder_path_buf[..folder.len()].copy_from_slice(folder);
                    self.folder_path_buf[folder.len()] = 0;
                    cache_dir_subpath = Subpath::Folder(folder.len());
                }
                cache_dir = Fd::cwd();
            }
            resolution::Tag::Root => {
                cache_dir_subpath = Subpath::DOT;
                cache_dir = Fd::cwd();
            }
            resolution::Tag::Symlink => {
                let directory = package_manager::global_link_dir(self.manager);

                let folder_str = *resolution.symlink();
                let folder = folder_str.slice(string_buf!());

                if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                    cache_dir_subpath = Subpath::DOT;
                    cache_dir = Fd::cwd();
                } else {
                    // `global_link_dir` above opened it.
                    let global_link_dir: &[u8] = &self.manager.global_link_dir_path;
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
                    cache_dir_subpath = Subpath::Folder(len);
                    cache_dir = directory;
                }
            }
            _ => {
                if cfg!(debug_assertions) {
                    panic!("Internal assertion failure: unexpected resolution tag");
                }
                self.increment_tree_install_count(
                    !is_pending_package_install,
                    self.current_tree_id,
                    log_level,
                );
                return;
            }
        }

        let needs_install = self.force_install
            || self.skip_verify_installed_version_number
            || !needs_verify
            || remove_patch
            || !pkg_install!().verify(
                &self.manager.lockfile,
                resolution,
                &self.root_node_modules_folder,
            );

        if needs_install {
            if resolution.tag.can_enqueue_install_task()
                && pkg_install!().package_missing_from_cache(
                    self.manager,
                    package_id,
                    resolution.tag,
                )
            {
                debug_assert!(resolution.can_enqueue_install_task());

                // Re-enqueueing would dedupe against the finished download and never call back.
                if !needs_verify {
                    if log_level != Options::LogLevel::Silent {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r>: failed to install <b>{}<r>: the downloaded package was not found in the cache",
                            bstr::BStr::new(alias.slice(string_buf!())),
                        );
                    }
                    self.summary.fail += 1;
                    self.increment_tree_install_count(
                        !is_pending_package_install,
                        self.current_tree_id,
                        log_level,
                    );
                    return;
                }

                let context =
                    TaskCallbackContext::DependencyInstallContext(DependencyInstallContext {
                        tree_id: self.current_tree_id,
                        path: self.node_modules.path.clone(),
                        dependency_id,
                    });
                // When the patch is being removed, its entry is no longer in
                // `lockfile.patched_dependencies` (only in
                // `patched_dependencies_to_remove`), so there is no patch to
                // apply after download — fetch the package unpatched.
                let download_patch_hash = if remove_patch {
                    None
                } else {
                    patch_name_and_version_hash
                };
                match resolution.tag {
                    resolution::Tag::Git => {
                        if package_manager::enqueue_git_for_checkout(
                            self.manager,
                            dependency_id,
                            alias,
                            resolution,
                            context,
                            download_patch_hash,
                        ) == package_manager::GitEnqueueResult::OfflineMiss
                        {
                            self.increment_tree_install_count(
                                !is_pending_package_install,
                                self.current_tree_id,
                                log_level,
                            );
                        }
                    }
                    resolution::Tag::Github => {
                        let url = self.manager.alloc_github_url(resolution.github());
                        let url = strings::StringOrTinyString::init_append_if_needed(
                            &url,
                            &mut crate::network_task::filename_store_appender(),
                        )
                        .unwrap_or_oom();
                        match package_manager::enqueue_tarball_for_download(
                            self.manager,
                            dependency_id,
                            package_id,
                            url,
                            context,
                        ) {
                            Ok(()) => {}
                            Err(ForTarballError::OutOfMemory) => bun_core::out_of_memory(),
                            Err(ForTarballError::InvalidURL) => {
                                self.fail_with_invalid_url(log_level, is_pending_package_install)
                            }
                            Err(ForTarballError::AlreadyFailed | ForTarballError::Offline) => self
                                .increment_tree_install_count(
                                    !is_pending_package_install,
                                    self.current_tree_id,
                                    log_level,
                                ),
                        }
                    }
                    resolution::Tag::LocalTarball => {
                        package_manager::enqueue_tarball_for_reading(
                            self.manager,
                            dependency_id,
                            package_id,
                            alias,
                            resolution,
                            context,
                        );
                    }
                    resolution::Tag::RemoteTarball => {
                        let url = strings::StringOrTinyString::init_append_if_needed(
                            resolution.remote_tarball().slice(string_buf!()),
                            &mut crate::network_task::filename_store_appender(),
                        )
                        .unwrap_or_oom();
                        match package_manager::enqueue_tarball_for_download(
                            self.manager,
                            dependency_id,
                            package_id,
                            url,
                            context,
                        ) {
                            Ok(()) => {}
                            Err(ForTarballError::OutOfMemory) => bun_core::out_of_memory(),
                            Err(ForTarballError::InvalidURL) => {
                                self.fail_with_invalid_url(log_level, is_pending_package_install)
                            }
                            Err(ForTarballError::AlreadyFailed | ForTarballError::Offline) => self
                                .increment_tree_install_count(
                                    !is_pending_package_install,
                                    self.current_tree_id,
                                    log_level,
                                ),
                        }
                    }
                    resolution::Tag::Npm => {
                        let npm = *resolution.npm();
                        #[cfg(debug_assertions)]
                        {
                            // Very old versions of Bun didn't store the tarball url when it didn't seem necessary
                            // This caused bugs. We can't assert on it because they could come from old lockfiles
                            if npm.url.is_empty() {
                                bun_core::debug_warn!(
                                    "package {}@{} missing tarball_url",
                                    bstr::BStr::new(pkg_name.slice(string_buf!())),
                                    resolution.fmt(string_buf!(), PathSep::Posix),
                                );
                            }
                        }

                        match package_manager::enqueue_package_for_download(
                            self.manager,
                            pkg_name,
                            dependency_id,
                            package_id,
                            npm.version,
                            npm.url,
                            context,
                        ) {
                            Ok(()) => {}
                            Err(ForTarballError::OutOfMemory) => bun_core::out_of_memory(),
                            Err(ForTarballError::InvalidURL) => {
                                self.fail_with_invalid_url(log_level, is_pending_package_install)
                            }
                            Err(ForTarballError::AlreadyFailed | ForTarballError::Offline) => self
                                .increment_tree_install_count(
                                    !is_pending_package_install,
                                    self.current_tree_id,
                                    log_level,
                                ),
                        }
                    }
                    _ => {
                        if cfg!(debug_assertions) {
                            panic!("unreachable, handled above");
                        }
                        self.increment_tree_install_count(
                            !is_pending_package_install,
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
            if let Some(patch_contents_hash) = patch_contents_hash {
                if pkg_install!().patched_package_missing_from_cache(self.manager, package_id) {
                    let mut task = PatchTask::new_apply_patch_hash(
                        self.manager,
                        package_id,
                        patch_contents_hash,
                        patch_name_and_version_hash.unwrap(),
                    );
                    if let patch_install::Callback::Apply(apply) = &mut task.callback {
                        apply.install_context = Some(patch_install::InstallContext {
                            dependency_id,
                            tree_id: self.current_tree_id,
                            path: self.node_modules.path.clone(),
                        });
                    }
                    package_manager::enqueue_patch_task(self.manager, task);
                    return;
                }
            }

            if !is_pending_package_install
                && !Self::can_install_package_for_tree(
                    &self.completed_trees,
                    self.manager.lockfile.buffers.trees.as_slice(),
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
            let destination_dir = match self
                .node_modules
                .make_and_open_dir(&self.root_node_modules_folder)
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
                        !is_pending_package_install,
                        self.current_tree_id,
                        log_level,
                    );
                    return;
                }
            };

            let install_result: package_install::InstallResult = match resolution.tag {
                resolution::Tag::Symlink | resolution::Tag::Workspace => pkg_install!()
                    .install_from_link(self.manager, self.skip_delete, &destination_dir),
                _ => 'result: {
                    if resolution.tag == resolution::Tag::Root
                        || (resolution.tag == resolution::Tag::Folder
                            && !self
                                .manager
                                .lockfile
                                .is_workspace_tree_id(self.current_tree_id))
                    {
                        // This is a transitive folder dependency. It is installed with a single symlink to the target folder/file,
                        // and is not hoisted.
                        //
                        // A transitive `Resolution::Folder` declared by a local `file:` package
                        // is relative to the top-level dir (`Package::parse` normalized it), so
                        // install it from `cache_dir` (the cwd, set in the switch above).
                        if resolution.tag == resolution::Tag::Folder
                            && self
                                .manager
                                .lockfile
                                .is_folder_tree_id(self.current_tree_id)
                        {
                            let mut install = pkg_install!();
                            let method = install.get_install_method();
                            break 'result install.install(
                                InstallEnv::Manager(self.manager),
                                self.skip_delete,
                                &destination_dir,
                                method,
                                resolution.tag,
                            );
                        }

                        // One declared by an npm manifest (`Package::from_npm`) is verbatim,
                        // i.e. relative to the declaring package, which installs at
                        // `dirname(node_modules.path)` because transitive folders never hoist.
                        let dir_name = {
                            let d = dirname::<platform::Auto>(self.node_modules.path.as_slice());
                            if d.is_empty() {
                                self.node_modules.path.as_slice()
                            } else {
                                d
                            }
                        };

                        let owned_cache_dir = match self.root_node_modules_folder.open_dir(
                            dir_name,
                            bun_sys::OpenDirOptions {
                                iterate: true,
                                ..Default::default()
                            },
                        ) {
                            Ok(d) => d,
                            Err(err) => {
                                break 'result package_install::InstallResult::fail(
                                    err.into(),
                                    package_install::Step::OpeningCacheDir,
                                    None,
                                );
                            }
                        };
                        cache_dir = owned_cache_dir.fd();

                        let mut install = pkg_install!();
                        let result = if resolution.tag == resolution::Tag::Root {
                            install.install_from_link(
                                self.manager,
                                self.skip_delete,
                                &destination_dir,
                            )
                        } else {
                            let method = install.get_install_method();
                            install.install(
                                InstallEnv::Manager(self.manager),
                                self.skip_delete,
                                &destination_dir,
                                method,
                                resolution.tag,
                            )
                        };

                        // npm packages can declare `file:` paths missing from the published
                        // tarball (e.g. excluded by `files`); nothing to link is not a failure.
                        if let package_install::InstallResult::Failure(f) = &result {
                            if matches!(
                                f.err,
                                crate::Error::Sys(bun_errno::SystemErrno::ENOENT)
                                    | crate::Error::FileNotFound
                            ) {
                                break 'result package_install::InstallResult::Success;
                            }
                        }

                        break 'result result;
                    }

                    let method = if (self.current_tree_id as usize) < self.copy_trees.bit_length()
                        && self.copy_trees.is_set(self.current_tree_id as usize)
                    {
                        package_install::Method::Copyfile
                    } else {
                        pkg_install!().get_install_method()
                    };
                    break 'result pkg_install!().install(
                        InstallEnv::Manager(self.manager),
                        self.skip_delete,
                        &destination_dir,
                        method,
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

                    if self.manager.lockfile.packages.items_bin()[package_id as usize].tag
                        != bin::Tag::None
                    {
                        self.trees[self.current_tree_id as usize]
                            .binaries
                            .push(dependency_id);
                    }

                    let dep = &self.manager.lockfile.buffers.dependencies.as_slice()
                        [dependency_id as usize];
                    let dep_behavior = dep.behavior;
                    let truncated_dep_name_hash: TruncatedPackageNameHash =
                        dep.name_hash as TruncatedPackageNameHash;
                    let (is_trusted, is_trusted_through_update_request) = 'brk: {
                        if self
                            .trusted_dependencies_from_update_requests
                            .contains(&package_id)
                        {
                            break 'brk (true, true);
                        }
                        if self.manager.lockfile.has_trusted_dependency(
                            &self.manager.options,
                            alias.slice(string_buf!()),
                            pkg_name.slice(string_buf!()),
                            resolution,
                        ) {
                            break 'brk (true, false);
                        }
                        break 'brk (false, false);
                    };

                    if resolution.tag != resolution::Tag::Root
                        && (resolution.tag == resolution::Tag::Workspace || is_trusted)
                    {
                        let mut folder_path =
                            AutoAbsPath::from(self.node_modules.path.as_slice()).unwrap_or_oom();
                        folder_path
                            .append(alias.slice(string_buf!()))
                            .unwrap_or_oom();

                        'enqueue_lifecycle_scripts: {
                            if self
                                .manager
                                .postinstall_optimizer
                                .should_ignore_lifecycle_scripts(
                                    &postinstall_optimizer::PkgInfo {
                                        name_hash: pkg_name_hash,
                                        version: if resolution.tag == resolution::Tag::Npm {
                                            Some(resolution.npm().version)
                                        } else {
                                            None
                                        },
                                        version_buf: string_buf!(),
                                    },
                                    self.manager.lockfile.packages.items_resolutions()
                                        [package_id as usize]
                                        .get(self.manager.lockfile.buffers.resolutions.as_slice()),
                                    self.manager.lockfile.packages.items_meta(),
                                    self.manager.options.cpu,
                                    self.manager.options.os,
                                )
                            {
                                if PackageManager::verbose_install() {
                                    bun_core::pretty_errorln!(
                                        "<d>[Lifecycle Scripts]<r> ignoring {} lifecycle scripts",
                                        bstr::BStr::new(pkg_name.slice(string_buf!())),
                                    );
                                }
                                break 'enqueue_lifecycle_scripts;
                            }

                            if self.enqueue_lifecycle_scripts(
                                alias,
                                log_level,
                                &mut folder_path,
                                package_id,
                                dep_behavior.contains(crate::dependency::Behavior::OPTIONAL),
                                resolution,
                            ) {
                                if is_trusted_through_update_request {
                                    let (trusted_name, trusted_name_hash) =
                                        if resolution.tag == resolution::Tag::Npm {
                                            (pkg_name, pkg_name_hash as TruncatedPackageNameHash)
                                        } else {
                                            (alias, truncated_dep_name_hash)
                                        };
                                    self.manager.trusted_deps_to_add_to_package_json.push(Box::<
                                        [u8],
                                    >::from(
                                        trusted_name.slice(string_buf!()),
                                    ));

                                    if self.manager.lockfile.trusted_dependencies.is_none() {
                                        self.manager.lockfile.trusted_dependencies =
                                            Some(Default::default());
                                    }
                                    self.manager
                                        .lockfile
                                        .trusted_dependencies
                                        .as_mut()
                                        .unwrap()
                                        .put(
                                            trusted_name_hash,
                                            Box::<[u8]>::from(trusted_name.slice(string_buf!())),
                                        )
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
                            if !is_trusted
                                && self.manager.lockfile.packages.items_meta()[package_id as usize]
                                    .has_install_script()
                            {
                                // Check if the package actually has scripts. `hasInstallScript` can be false positive if a package is published with
                                // an auto binding.gyp rebuild script but binding.gyp is excluded from the published files.
                                let mut folder_path =
                                    AutoAbsPath::from(self.node_modules.path.as_slice())
                                        .unwrap_or_oom();
                                folder_path
                                    .append(alias.slice(string_buf!()))
                                    .unwrap_or_oom();

                                let count = self.get_installed_package_scripts_count(
                                    alias,
                                    package_id,
                                    resolution.tag,
                                    &mut folder_path,
                                    log_level,
                                );
                                if count > 0 {
                                    if log_level.is_verbose() {
                                        bun_core::pretty_error!(
                                            "Blocked {} scripts for: {}@{}\n",
                                            count,
                                            bstr::BStr::new(alias.slice(string_buf!())),
                                            resolution.fmt(string_buf!(), PathSep::Posix),
                                        );
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
                        !is_pending_package_install,
                        self.current_tree_id,
                        log_level,
                    );
                }
                package_install::InstallResult::Failure(cause) => {
                    debug_assert!(
                        !cause.is_package_missing_from_cache()
                            || (resolution.tag != resolution::Tag::Symlink
                                && resolution.tag != resolution::Tag::Workspace)
                    );

                    // even if the package failed to install, we still need to increment the install
                    // counter for this tree
                    self.increment_tree_install_count(
                        !is_pending_package_install,
                        self.current_tree_id,
                        log_level,
                    );

                    if cause.err == crate::Error::DanglingSymlink {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r>: <b>{}<r> \"link:{}\" not found (try running 'bun link' in the intended package's folder)<r>",
                            cause.err.name(),
                            bstr::BStr::new(
                                self.manager.lockfile.packages.items_name()[package_id as usize]
                                    .slice(string_buf!())
                            ),
                        );
                        self.summary.fail += 1;
                    } else if resolution.tag == resolution::Tag::Folder
                        && cause.is_package_missing_from_cache()
                    {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r>: Could not find folder \"file:{}\" for dependency \"{}\"",
                            bstr::BStr::new(resolution.folder().slice(string_buf!())),
                            bstr::BStr::new(alias.slice(string_buf!())),
                        );
                        self.summary.fail += 1;
                    } else if matches!(
                        cause.err,
                        crate::Error::Sys(bun_errno::SystemErrno::EACCES)
                            | crate::Error::AccessDenied
                    ) {
                        // there are two states this can happen
                        // - Access Denied because node_modules/ is unwritable
                        // - Access Denied because this specific package is unwritable
                        // in the case of the former, the logs are extremely noisy, so we
                        // will exit early, otherwise set a flag to not re-stat
                        // Static flag since Rust lacks fn-local mutable statics.
                        static NODE_MODULES_IS_OK: core::sync::atomic::AtomicBool =
                            core::sync::atomic::AtomicBool::new(false);
                        if !NODE_MODULES_IS_OK.load(Ordering::Relaxed) {
                            #[cfg(not(windows))]
                            {
                                let dir = destination_dir.fd();
                                let stat = match bun_sys::fstat(dir) {
                                    Ok(s) => s,
                                    Err(err) => {
                                        Output::err(
                                            "EACCES",
                                            "Permission denied while installing <b>{}<r>",
                                            (bstr::BStr::new(
                                                self.manager.lockfile.packages.items_name()
                                                    [package_id as usize]
                                                    .slice(
                                                        self.manager
                                                            .lockfile
                                                            .buffers
                                                            .string_bytes
                                                            .as_slice(),
                                                    ),
                                            ),),
                                        );
                                        if cfg!(debug_assertions) {
                                            Output::err(err, "Failed to stat node_modules", ());
                                        }
                                        Global::exit(1);
                                    }
                                };

                                // `bun_sys::c::getuid`/`getgid` are local `safe fn`
                                // redecls (zero args, read kernel process state —
                                // no preconditions).
                                // `st_mode` is u16 on FreeBSD, u32 elsewhere; widen.
                                let st_mode = stat.st_mode as u32;
                                let is_writable = if stat.st_uid == bun_sys::c::getuid() {
                                    st_mode & bun_sys::S::IWUSR > 0
                                } else if stat.st_gid == bun_sys::c::getgid() {
                                    st_mode & bun_sys::S::IWGRP > 0
                                } else {
                                    st_mode & bun_sys::S::IWOTH > 0
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

                        Output::err(
                            "EACCES",
                            "Permission denied while installing <b>{}<r>",
                            (bstr::BStr::new(
                                self.manager.lockfile.packages.items_name()[package_id as usize]
                                    .slice(string_buf!()),
                            ),),
                        );

                        self.summary.fail += 1;
                    } else {
                        Output::err(
                            cause.err,
                            "failed {} for package <b>{}<r>",
                            (
                                bstr::BStr::new(cause.step.name()),
                                bstr::BStr::new(
                                    self.manager.lockfile.packages.items_name()
                                        [package_id as usize]
                                        .slice(string_buf!()),
                                ),
                            ),
                        );
                        #[cfg(bun_debug)]
                        {
                            let t = cause.debug_trace;
                            bun_crash_handler::dump_stack_trace(&t.trace(), Default::default());
                        }
                        self.summary.fail += 1;
                    }
                }
            }
        } else {
            // Same gate as the `needs_install` branch: a pending parent's
            // `uninstall_before_install` would delete this verified package.
            if !is_pending_package_install
                && !Self::can_install_package_for_tree(
                    &self.completed_trees,
                    self.manager.lockfile.buffers.trees.as_slice(),
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

            self.summary.skipped += 1;

            if self.manager.lockfile.packages.items_bin()[package_id as usize].tag != bin::Tag::None
            {
                self.trees[self.current_tree_id as usize]
                    .binaries
                    .push(dependency_id);
            }

            let dep =
                &self.manager.lockfile.buffers.dependencies.as_slice()[dependency_id as usize];
            let dep_behavior = dep.behavior;
            let truncated_dep_name_hash: TruncatedPackageNameHash =
                dep.name_hash as TruncatedPackageNameHash;
            let (is_trusted, is_trusted_through_update_request, add_to_lockfile) = 'brk: {
                // trusted through a --trust dependency. need to enqueue scripts, write to package.json, and add to lockfile
                if self
                    .trusted_dependencies_from_update_requests
                    .contains(&package_id)
                {
                    break 'brk (true, true, true);
                }

                if let Some(added) = self
                    .manager
                    .summary
                    .added_trusted_dependencies
                    .get(&truncated_dep_name_hash)
                {
                    // is a new trusted dependency. need to enqueue scripts and maybe add to lockfile
                    if *added.name == *alias.slice(string_buf!())
                        && self.manager.lockfile.has_trusted_dependency(
                            &self.manager.options,
                            alias.slice(string_buf!()),
                            pkg_name.slice(string_buf!()),
                            resolution,
                        )
                    {
                        break 'brk (true, false, added.add_to_lockfile);
                    }
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
                        .manager
                        .postinstall_optimizer
                        .should_ignore_lifecycle_scripts(
                            &postinstall_optimizer::PkgInfo {
                                name_hash: pkg_name_hash,
                                version: if resolution.tag == resolution::Tag::Npm {
                                    Some(resolution.npm().version)
                                } else {
                                    None
                                },
                                version_buf: string_buf!(),
                            },
                            self.manager.lockfile.packages.items_resolutions()[package_id as usize]
                                .get(self.manager.lockfile.buffers.resolutions.as_slice()),
                            self.manager.lockfile.packages.items_meta(),
                            self.manager.options.cpu,
                            self.manager.options.os,
                        )
                    {
                        if PackageManager::verbose_install() {
                            bun_core::pretty_errorln!(
                                "<d>[Lifecycle Scripts]<r> ignoring {} lifecycle scripts",
                                bstr::BStr::new(pkg_name.slice(string_buf!())),
                            );
                        }
                        break 'enqueue_lifecycle_scripts;
                    }

                    if self.enqueue_lifecycle_scripts(
                        alias,
                        log_level,
                        &mut folder_path,
                        package_id,
                        dep_behavior.contains(crate::dependency::Behavior::OPTIONAL),
                        resolution,
                    ) {
                        let (trusted_name, trusted_name_hash) =
                            if resolution.tag == resolution::Tag::Npm {
                                (pkg_name, pkg_name_hash as TruncatedPackageNameHash)
                            } else {
                                (alias, truncated_dep_name_hash)
                            };

                        if is_trusted_through_update_request {
                            self.manager
                                .trusted_deps_to_add_to_package_json
                                .push(Box::<[u8]>::from(trusted_name.slice(string_buf!())));
                        }

                        if add_to_lockfile {
                            if self.manager.lockfile.trusted_dependencies.is_none() {
                                self.manager.lockfile.trusted_dependencies =
                                    Some(Default::default());
                            }
                            self.manager
                                .lockfile
                                .trusted_dependencies
                                .as_mut()
                                .unwrap()
                                .put(
                                    trusted_name_hash,
                                    Box::<[u8]>::from(trusted_name.slice(string_buf!())),
                                )
                                .unwrap_or_oom();
                        }
                    }
                }
            }

            self.increment_tree_install_count(
                !is_pending_package_install,
                self.current_tree_id,
                log_level,
            );
        }
    }

    fn fail_with_invalid_url(
        &mut self,
        log_level: Options::LogLevel,
        is_pending_package_install: bool,
    ) {
        self.summary.fail += 1;
        self.increment_tree_install_count(
            !is_pending_package_install,
            self.current_tree_id,
            log_level,
        );
    }

    /// returns true if scripts are enqueued
    fn enqueue_lifecycle_scripts(
        &mut self,
        folder_name: String,
        log_level: Options::LogLevel,
        package_path: &mut bun_paths::AutoAbsPath,
        package_id: PackageID,
        optional: bool,
        resolution: &Resolution,
    ) -> bool {
        let mut scripts: PackageScripts =
            self.manager.lockfile.packages.items_scripts()[package_id as usize];
        let scripts_list = match scripts.get_list(
            &self.manager.options,
            &mut self.manager.log,
            &self.manager.lockfile,
            package_path,
            self.manager.lockfile.str(&folder_name),
            resolution,
        ) {
            Ok(v) => v,
            Err(err) => {
                if log_level != Options::LogLevel::Silent {
                    if log_level.show_progress() {
                        if Output::enable_ansi_colors_stderr() {
                            self.manager.progress.log(format_args!(
                                bun_core::pretty_fmt!(
                                    "\n<r><red>error:<r> failed to enqueue lifecycle scripts for <b>{s}<r>: {s}\n",
                                    true
                                ),
                                bstr::BStr::new(self.manager.lockfile.str(&folder_name)),
                                err.name(),
                            ));
                        } else {
                            self.manager.progress.log(format_args!(
                                bun_core::pretty_fmt!(
                                    "\n<r><red>error:<r> failed to enqueue lifecycle scripts for <b>{s}<r>: {s}\n",
                                    false
                                ),
                                bstr::BStr::new(self.manager.lockfile.str(&folder_name)),
                                err.name(),
                            ));
                        }
                    } else {
                        bun_core::pretty_errorln!(
                            "\n<r><red>error:<r> failed to enqueue lifecycle scripts for <b>{}<r>: {}\n",
                            bstr::BStr::new(self.manager.lockfile.str(&folder_name)),
                            err.name(),
                        );
                    }
                }

                if self.manager.options.enable.fail_early() {
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

        if self.manager.options.do_.contains(Options::Do::RUN_SCRIPTS) {
            let m = &mut *self.manager;
            m.total_scripts += scripts_list.total as usize;
            if let Some(scripts_node) = m.scripts_node_mut() {
                PackageManager::set_node_name(
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

    pub(crate) fn install_package(&mut self, dep_id: DependencyID, log_level: Options::LogLevel) {
        let package_id = self.manager.lockfile.buffers.resolutions.as_slice()[dep_id as usize];

        let name = self.manager.lockfile.packages.items_name()[package_id as usize];
        let resolution = self.manager.lockfile.packages.items_resolution()[package_id as usize];

        let needs_verify = true;
        let is_pending_package_install = false;
        self.install_package_with_name_and_resolution(
            dep_id,
            package_id,
            log_level,
            name,
            &resolution,
            needs_verify,
            is_pending_package_install,
        );
    }
}
