use core::sync::atomic::Ordering;

use bun_collections::{ArrayHashMap, DynamicBitSet, StringHashMap};
use bun_core::fmt::PathSep;
use bun_core::{Global, Output};
use bun_core::{ZStr, strings};
use bun_paths::resolve_path::{dirname, join_abs_string_buf_z_checked, join_z_buf};
use bun_paths::{AbsPath, AutoAbsPath, MAX_PATH_BYTES, PathBuffer, SEP, platform};
use bun_semver::String;
use bun_sys::{Dir, Fd};

use crate::bin_real as bin;
use crate::bin_real::Bin;
use crate::bun_bunfig::Arguments as Command;
use crate::bun_fs::FileSystem;
use crate::bun_progress::{Node as ProgressNode, Progress};

use crate::lifecycle_script_runner::{InstallCtx, LifecycleScriptSubprocess, UnfinishedScripts};
// `Lockfile` here is the in-crate `crate::lockfile::Lockfile` (the
// struct `PackageManager.lockfile` actually carries). `lockfile_real` is still
// imported for `tree::Id` / `Tree` / `package::*`, all of
// which are the same types re-exported through `crate::lockfile`.
use crate::lockfile::Lockfile;
use crate::lockfile_real::package::{
    self as Package, PackageColumns, scripts::Scripts as PackageScripts,
};
use crate::lockfile_real::{self as lockfile, Tree};
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
    pub(crate) list: lockfile::package::scripts::List,
    pub(crate) tree_id: lockfile::tree::Id,
    pub(crate) optional: bool,
}

pub struct PackageInstaller<'a> {
    /// BACKREF, never null; not `&'a mut`: `run_tasks(this, &mut installer)` borrows it as well.
    pub(crate) manager: *mut PackageManager,
    /// BACKREF into `(*manager).lockfile`. Never null.
    pub lockfile: *mut Lockfile,
    /// BACKREF into `(*manager).progress`. Never null.
    pub(crate) progress: *mut Progress,

    /// relative paths from `next` will be copied into this list.
    pub(crate) node_modules: NodeModulesFolder,

    pub(crate) skip_verify_installed_version_number: bool,
    pub(crate) skip_delete: bool,
    /// For `set_outlived_root`: the workspaces whose first tree the install has reached.
    pub(crate) workspaces_seen: Vec<PackageID>,
    pub(crate) root_node_modules_folder: Dir,
    /// Acquired when the first package is linked, so an install with nothing to link never takes
    /// the lock.
    pub(crate) staging_lock: Option<package_install::StagingLock>,
    /// The `node_modules` that the last package was linked into. It's kept open for the next
    /// package.
    pub(crate) tree_dir: Option<TreeDir>,
    /// `None`: every package is linked in its turn.
    pub(crate) deferred: Option<DeferredLinks>,
    pub(crate) summary: &'a mut package_install::Summary,
    // Columns of `lockfile.packages`: `fix_cached_lockfile_package_slices` after it grows.
    pub(crate) metas: bun_ptr::RawSlice<Package::Meta>,
    pub(crate) names: bun_ptr::RawSlice<String>,
    pub(crate) pkg_name_hashes: bun_ptr::RawSlice<PackageNameHash>,
    pub(crate) bins: bun_ptr::RawSlice<Bin>,
    pub(crate) resolutions: bun_ptr::RawSlice<Resolution>,
    pub(crate) node: &'a mut ProgressNode,
    pub(crate) destination_dir_subpath_buf: Box<PathBuffer>,
    pub(crate) folder_path_buf: Box<PathBuffer>,
    pub(crate) successfully_installed: Bitset,
    pub(crate) command_ctx: Command::Context<'a>,
    pub(crate) current_tree_id: lockfile::tree::Id,
    /// Trees that live under a self-contained workspace: packages there are copied
    /// (real files) rather than hardlinked/cloned/symlinked from the cache, so tools
    /// that walk, prune or rewrite that node_modules cannot reach the shared cache.
    pub(crate) copy_trees: Bitset,

    // fields used for running lifecycle scripts when it's safe
    //
    /// set of completed tree ids
    pub(crate) completed_trees: Bitset,
    /// Number of entries across every tree's `pending_installs`. When it's zero, which is always
    /// the case if nothing had to be downloaded, `install_available_packages` returns early.
    pub(crate) pending_install_count: usize,
    /// the tree ids a tree depends on before it can run the lifecycle scripts of it's immediate dependencies
    pub(crate) tree_ids_to_trees_the_id_depends_on: bun_collections::DynamicBitSetList,
    pub(crate) pending_lifecycle_scripts: Vec<PendingLifecycleScript>,
    pub(crate) unfinished_scripts: UnfinishedScripts,

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

pub struct TreeDir {
    tree_id: lockfile::tree::Id,
    dir: Dir,
    /// The last `@scope` in it that was seen to be no link.
    scope: Vec<u8>,
}

/// Packages whose files the thread pool links in the background. The main thread finishes
/// installing them afterwards.
pub struct DeferredLinks {
    jobs: Vec<package_install::LinkJob>,
    /// Work that came up after the given number of `jobs` and has to wait for them, so that
    /// everything still happens in order.
    events: Vec<(usize, DeferredEvent)>,
    /// The directories that the jobs link into.
    tree_dirs: Vec<TreeDir>,
    /// Trees that may share a directory with another tree. Only the main thread writes to those.
    shared_trees: Bitset,
}

pub(crate) enum DeferredEvent {
    /// A package of this tree is done.
    Count(lockfile::tree::Id),
    /// A package that the main thread installs.
    Install {
        tree_id: lockfile::tree::Id,
        dependency_id: DependencyID,
        needs_verify: bool,
    },
}

/// Returns true if `name` could collide with another entry's name on a case-insensitive volume.
fn may_fold(name: &[u8]) -> bool {
    name.iter()
        .any(|byte| byte.is_ascii_uppercase() || !byte.is_ascii())
}

impl DeferredLinks {
    /// Each is an open directory.
    const MAX_TREES: usize = 64;

    pub(crate) fn init(lockfile: &Lockfile) -> DeferredLinks {
        let trees = lockfile.buffers.trees.as_slice();
        let dependencies = lockfile.buffers.dependencies.as_slice();
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let resolutions = lockfile.packages.items_resolution();
        // The package whose `node_modules` a tree is, if its folder can be a link to it.
        let local_package = |tree: &Tree| -> Option<usize> {
            let package_id =
                *(lockfile.buffers.resolutions.as_slice()).get(tree.dependency_id as usize)?;
            let resolution = resolutions.get(package_id as usize)?;
            (!resolution.tag.can_enqueue_install_task()).then_some(package_id as usize)
        };

        let mut seen = Bitset::init_empty(resolutions.len()).unwrap_or_oom();
        let mut seen_twice = Bitset::init_empty(resolutions.len()).unwrap_or_oom();
        // The root's is tree 0.
        if !resolutions.is_empty() {
            seen.set(0);
        }
        for package_id in trees.iter().filter_map(&local_package) {
            if seen.is_set(package_id) {
                seen_twice.set(package_id);
            }
            seen.set(package_id);
        }

        // A parent tree comes before its children.
        let mut shared_trees = Bitset::init_empty(trees.len()).unwrap_or_oom();
        for tree in trees {
            if (tree.parent != lockfile::tree::INVALID_ID
                && (shared_trees.is_set(tree.parent as usize)
                    || may_fold(tree.folder_name(dependencies, string_buf))))
                || local_package(tree).is_some_and(|package_id| seen_twice.is_set(package_id))
            {
                shared_trees.set(tree.id as usize);
            }
        }

        DeferredLinks {
            jobs: Vec::new(),
            events: Vec::new(),
            tree_dirs: Vec::new(),
            shared_trees,
        }
    }
}

const NAME_TOO_LONG: crate::Error = crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG);

/// A cheaper `join_z_buf` for two paths that are already normalized. A warm install calls this for
/// every package.
fn join_normalized_z<'b>(buf: &'b mut [u8], folder: &[u8], file_path: &[u8]) -> &'b ZStr {
    // A scoped alias contains a `/`, which Windows needs converted to `\`.
    if cfg!(windows) {
        return join_z_buf::<platform::Auto>(buf, &[folder, file_path]);
    }
    let mut len = 0;
    if !folder.is_empty() {
        buf[..folder.len()].copy_from_slice(folder);
        buf[folder.len()] = SEP;
        len = folder.len() + 1;
    }
    buf[len..len + file_path.len()].copy_from_slice(file_path);
    len += file_path.len();
    buf[len] = 0;
    ZStr::from_buf(buf, len)
}

impl NodeModulesFolder {
    /// Returns the path of `file_path` in this folder, relative to the root `node_modules`, so a
    /// syscall on that directory's fd does not walk the directories above it.
    fn path_from_root<'b>(&self, buf: &'b mut [u8], file_path: &ZStr) -> &'b ZStr {
        let top_level_dir = strings::without_trailing_slash(FileSystem::instance().top_level_dir());
        let folder = (self.path.strip_prefix(top_level_dir))
            .and_then(|rest| rest.strip_prefix(&[SEP]))
            .and_then(|rest| rest.strip_prefix(b"node_modules"))
            .and_then(|rest| {
                rest.strip_prefix(&[SEP])
                    .or_else(|| rest.is_empty().then_some(rest))
            })
            .unwrap_or(self.path.as_slice());
        join_normalized_z(buf, folder, file_path.as_bytes())
    }

    /// Since the stack size of these functions are rather large, let's not let them be inlined.
    #[inline(never)]
    fn directory_exists_at_without_opening_directories(
        &self,
        root_node_modules_dir: &Dir,
        file_path: &ZStr,
    ) -> bool {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        bun_sys::directory_exists_at(
            root_node_modules_dir.fd(),
            self.path_from_root(path_buf.as_mut_slice(), file_path),
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

    /// Follows links.
    pub(crate) fn stat(
        &self,
        root_node_modules_dir: &Dir,
        file_path: &ZStr,
    ) -> Option<bun_sys::Stat> {
        if file_path.len() + self.path.len() * 2 < MAX_PATH_BYTES {
            let mut path_buf = bun_paths::path_buffer_pool::get();
            return bun_sys::fstatat(
                root_node_modules_dir.fd(),
                self.path_from_root(path_buf.as_mut_slice(), file_path),
            )
            .ok();
        }

        let dir = self.open_dir(root_node_modules_dir).ok()?;
        bun_sys::fstatat(&dir, file_path).ok()
    }

    /// Since the stack size of these functions are rather large, let's not let them be inlined.
    #[inline(never)]
    fn open_file_without_opening_directories(
        &self,
        root_node_modules_dir: &Dir,
        file_path: &ZStr,
    ) -> bun_sys::Result<bun_sys::File> {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        root_node_modules_dir.open_file(
            self.path_from_root(path_buf.as_mut_slice(), file_path),
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

    #[cfg(unix)]
    fn path_z<'b>(&self, buf: &'b mut PathBuffer) -> crate::Result<&'b ZStr> {
        if self.path.len() >= MAX_PATH_BYTES {
            return Err(NAME_TOO_LONG);
        }
        Ok(bun_paths::resolve_path::z(self.path.as_slice(), buf))
    }

    pub(crate) fn open_dir(&self, root: &Dir) -> crate::Result<Dir> {
        #[cfg(unix)]
        {
            let mut path_buf = bun_paths::path_buffer_pool::get();
            let path_z = self.path_z(&mut path_buf)?;
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

    fn make_and_open_dir(&self, root: &Dir, lockfile: &Lockfile) -> crate::Result<Dir> {
        #[cfg(unix)]
        {
            if lockfile.is_importer_tree_id(self.tree_id) {
                return Ok(root.make_open_path(self.path.as_slice(), Default::default())?);
            }
            let mut path_buf = bun_paths::path_buffer_pool::get();
            let path = self.path_z(&mut path_buf)?;
            Ok(package_install::make_open_real_dir(root, path)?)
        }

        #[cfg(not(unix))]
        {
            let _ = lockfile;
            Ok(Dir::from_fd(
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
            ))
        }
    }
}

/// The point in the install at which a tree's bins are linked.
#[derive(Clone, Copy, PartialEq, Eq)]
enum BinPass {
    /// The tree just finished installing. A bin that points into a tree that has not finished yet
    /// is queued again for `Remaining`.
    TreeDone,
    Remaining,
    /// Lifecycle scripts have run. Names that already exist in `.bin` are not replaced.
    AfterScripts,
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

    pub(crate) binaries: bin::PriorityQueue,
    /// Dependencies that have a bin and run lifecycle scripts, which may create the bin's file.
    /// A dependency is removed from the list once its bins are linked with no file missing.
    pub(crate) bins_after_scripts: Vec<DependencyID>,

    /// Number of installed dependencies. Could be successful or failure.
    pub(crate) install_count: usize,

    /// Dependencies whose folder in this tree is replaced by this install.
    pub(crate) replaced: Vec<DependencyID>,
    /// This tree is inside an ancestor's `replaced` folder. Everything on disk here is about to be
    /// deleted, so no package is skipped.
    pub(crate) inside_replaced_folder: bool,
    /// See `PackageInstaller::set_outlived_root`.
    pub(crate) outlived_root: bool,
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
        if t.parent == start_tree
            && t.folder_name(deps, string_buf) == alias
            && !t.is_unlinked_member(trees, hoisted_deps, deps)
        {
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
) -> Option<AbsPath> {
    let mut rel_buf = bun_paths::path_buffer_pool::get();
    rel_buf[..b"node_modules".len()].copy_from_slice(b"node_modules");
    let mut depth_buf = lockfile::tree::depth_buf_uninit();
    let (rel, _) = lockfile::tree::relative_path_and_depth::<
        { lockfile::tree::IteratorPathStyle::NodeModules },
    >(
        lockfile.buffers.trees.as_slice(),
        lockfile.buffers.hoisted_dependencies.as_slice(),
        lockfile.buffers.dependencies.as_slice(),
        string_buf,
        tree_id,
        &mut rel_buf,
        &mut depth_buf,
    );
    let mut abs = AbsPath::init_top_level_dir();
    abs.try_append(rel.as_bytes()).ok()?;
    Some(abs)
}

/// For a workspace or a `link:` package, this only removes the link.
pub(crate) fn remove_placed_package(
    lockfile: &Lockfile,
    tree_id: lockfile::tree::Id,
    alias: &[u8],
) {
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let Some(Ok(node_modules)) =
        abs_node_modules_path(lockfile, string_buf, tree_id).map(|path| Dir::open(path.slice()))
    else {
        return;
    };
    // Rename first: a delete can stop midway, and a half-deleted package must not pass `verify`.
    let moved = package_install::move_aside(
        &node_modules,
        &bun_core::ZBox::from_bytes(alias),
        bun_core::fast_random(),
    );
    if let Some(old) = moved {
        let _ = node_modules.delete_tree(old.as_bytes());
    } else {
        // If the rename fails, delete the files `verify` reads first.
        if let Some(package) = crate::prune::descend(&node_modules, alias) {
            let _ = package.delete_tree(b"package.json");
            let _ = package.delete_tree(package_install::BUN_TAG);
        }
        let _ = node_modules.delete_tree(alias);
    }
    crate::prune::prune_bins(&node_modules);
}

/// Only checks the path rules. Used for the name of the project itself, of a workspace, or of a
/// folder.
pub(crate) fn name_is_single_path_entry(name: &[u8]) -> bool {
    if name.len() >= MAX_PATH_BYTES || !crate::dependency::is_safe_install_folder_name(name) {
        return false;
    }

    match strings::count_char(name, b'/') {
        0 => true,
        1 => name[0] == b'@',
        _ => false,
    }
}

/// `node_modules/<alias>` is deleted and made again: it is no directory the installer owns there.
pub fn alias_is_safe_install_target(alias: &[u8]) -> bool {
    if !name_is_single_path_entry(alias) {
        return false;
    }

    let name = match strings::split_once_char(alias, b'/') {
        Some((scope, name)) if scope.len() > 1 => name,
        None if alias[0] != b'@' => alias,
        _ => return false,
    };
    // On a case-insensitive volume `NODE_MODULES` is `node_modules`.
    !name.starts_with(b".") && !name.eq_ignore_ascii_case(b"node_modules")
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
    // BACKREF accessors: do not hold a `_mut` result across a call that derives another one.
    #[inline]
    pub(crate) fn manager(&self) -> &'a PackageManager {
        // SAFETY: BACKREF — never null; pointee outlives `'a`.
        unsafe { &*self.manager }
    }

    #[inline]
    fn manager_mut(&self) -> &'a mut PackageManager {
        // SAFETY: BACKREF — never null; disjoint from `*self`; install pass
        // is single-threaded so no concurrent `&mut PackageManager` exists.
        unsafe { &mut *self.manager }
    }

    #[inline]
    fn lockfile(&self) -> &'a Lockfile {
        // SAFETY: BACKREF — never null; pointee outlives `'a`.
        unsafe { &*self.lockfile }
    }

    #[inline]
    fn lockfile_mut(&self) -> &'a mut Lockfile {
        // SAFETY: BACKREF — never null; disjoint from `*self`; see `manager_mut`.
        unsafe { &mut *self.lockfile }
    }

    #[inline]
    fn progress_mut(&self) -> &'a mut Progress {
        // SAFETY: BACKREF into `manager.progress` — never null; disjoint from
        // `*self`; the install pass is single-threaded so no concurrent `&mut
        // Progress` exists. Same shape as `manager_mut`/`lockfile_mut`.
        unsafe { &mut *self.progress }
    }

    /// Increments the number of installed packages for the current tree and runs available scripts
    /// if the tree is finished.
    fn increment_tree_install_count(
        &mut self,
        is_pending_package_install: bool,
        log_level: Options::LogLevel,
    ) {
        let tree_id = self.current_tree_id;
        if self.defer_event(|| DeferredEvent::Count(tree_id)) {
            return;
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

            let mut link_target_buf = bun_paths::path_buffer_pool::get();
            let mut link_dest_buf = bun_paths::path_buffer_pool::get();
            let mut link_rel_buf = bun_paths::path_buffer_pool::get();
            self.link_tree_bins(
                tree_id,
                BinPass::TreeDone,
                link_target_buf.as_mut_slice(),
                link_dest_buf.as_mut_slice(),
                link_rel_buf.as_mut_slice(),
            );
        }

        if !is_pending_package_install {
            const FORCE: bool = false;
            self.install_available_packages::<FORCE>(log_level);
        }
        self.run_available_scripts(log_level);
    }

    fn fail(&mut self, is_pending_package_install: bool, log_level: Options::LogLevel) {
        self.summary.fail += 1;
        self.increment_tree_install_count(is_pending_package_install, log_level);
    }

    fn link_tree_bins(
        &mut self,
        tree_id: TreeContextId,
        pass: BinPass,
        link_target_buf: &mut [u8],
        link_dest_buf: &mut [u8],
        link_rel_buf: &mut [u8],
    ) {
        let lockfile = self.lockfile();
        let manager = self.manager_mut();
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let mut node_modules_path: AbsPath =
            AbsPath::from(self.node_modules.path.as_slice()).unwrap_or_oom();
        let mut is_behind_link = (!lockfile.is_importer_tree_id(tree_id)).then_some(false);

        let pkgs = lockfile.packages.slice();
        let pkg_name_hashes = pkgs.items_name_hash();
        let pkg_metas = pkgs.items_meta();
        let pkg_resolutions_lists = pkgs.items_resolutions();
        let pkg_resolutions_buffer = lockfile.buffers.resolutions.as_slice();
        let pkg_names = pkgs.items_name();

        let completed_trees = &self.completed_trees;
        let tree = &mut self.trees[tree_id as usize];
        let mut deferred: Vec<DependencyID> = Vec::new();

        // If the `.bin` path doesn't fit in the buffer, the linker reports an error for each bin.
        if let Some(bin_dir) = join_abs_string_buf_z_checked::<platform::Auto>(
            self.node_modules.path.as_slice(),
            link_dest_buf,
            &[b".bin"],
        ) && let Err(err) =
            crate::prune::remove_planted_link(&self.root_node_modules_folder, bin_dir)
        {
            bun_ast::add_error_pretty!(
                manager.log_mut(),
                None,
                bun_ast::Loc::EMPTY,
                "failed to link into <b>{}<r>: {}",
                bun_core::fmt::EscapeControlChars(bstr::BStr::new(err.path.as_ref())),
                bstr::BStr::new(err.name()),
            );
            while tree.binaries.remove_or_null().is_some() {}
            return;
        }
        if pass == BinPass::AfterScripts {
            bin::see_linked_names(node_modules_path.slice(), &mut self.seen_bin_links);
        }

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
            let mut defer_this_bin = false;

            'native_binlink_optimization: {
                if !manager.postinstall_optimizer.is_native_binlink_enabled() {
                    break 'native_binlink_optimization;
                }
                // Check for native binlink optimization
                let name_hash = pkg_name_hashes[package_id as usize];
                if let Some(optimizer) =
                    manager
                        .postinstall_optimizer
                        .get(&postinstall_optimizer::PkgInfo {
                            name_hash,
                            ..Default::default()
                        })
                {
                    match optimizer {
                        PostinstallOptimizer::NativeBinlink => {
                            let target_cpu = manager.options.cpu;
                            let target_os = manager.options.os;
                            let target_libc = manager.options.libc;
                            if let Some(replacement_pkg_id) =
                                PostinstallOptimizer::get_native_binlink_replacement_package_id(
                                    pkg_resolutions_lists[package_id as usize]
                                        .get(pkg_resolutions_buffer),
                                    pkg_metas,
                                    target_cpu,
                                    target_os,
                                    target_libc,
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
                                    if pass == BinPass::TreeDone
                                        && !completed_trees.is_set(target_tree_id as usize)
                                    {
                                        // Platform package's tree isn't installed
                                        // yet: link the package's own bin now and
                                        // re-queue for `link_remaining_bins`.
                                        defer_this_bin = true;
                                        break 'native_binlink_optimization;
                                    }
                                    target_node_modules_path_opt =
                                        abs_node_modules_path(lockfile, string_buf, target_tree_id);
                                    if target_node_modules_path_opt.is_none() {
                                        break 'native_binlink_optimization;
                                    }
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
            // globally linked packages should always belong to the root
            // tree (0).
            let global = tree_id == 0
                && manager.links_bins_globally(
                    package_id,
                    self.successfully_installed
                        .is_set_allow_out_of_bound(package_id as usize, false),
                );
            // The other global packages keep their links in the global bin dir.
            if !global
                && tree_id == 0
                && manager.options.global
                && pkgs.items_dependencies()[0].contains(dep_id)
            {
                continue;
            }

            loop {
                // `node_modules_path` (mut) and `target_node_modules_path`
                // (read-only) refer to the same buffer when no replacement is
                // set. Derive both from a single `*mut` so the read pointer
                // shares the write reference's provenance (a `*const` taken
                // from `&node_modules_path` would be popped by the later
                // `&mut` reborrow under stacked-borrows).
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
                        .map(std::ptr::from_ref::<AbsPath>)
                        .unwrap_or_else(|| nm_ptr.cast_const()),
                    // SAFETY: `nm_ptr` = `&raw mut node_modules_path` (live local); the only
                    // other pointer derived from it is the read-only `target_node_modules_path`
                    // above, which `bin::Linker::link` never writes through.
                    node_modules_path: unsafe { &mut *nm_ptr },
                    abs_target_buf: link_target_buf,
                    abs_dest_buf: link_dest_buf,
                    rel_buf: link_rel_buf,
                    is_behind_link,
                    err: None,
                    skipped_due_to_missing_bin: false,
                };

                bin_linker.link(global);
                is_behind_link = bin_linker.is_behind_link;

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

                if !bin_linker.skipped_due_to_missing_bin {
                    tree.bins_after_scripts.retain(|&id| id != dep_id);
                }
                if let Some(err) = bin_linker.err {
                    if global {
                        // Print the error instead of logging it. A logged error stops the lockfile
                        // from being saved, and `bun remove -g` can only remove saved packages.
                        self.summary.fail += 1;
                        if manager.options.log_level != Options::LogLevel::Silent {
                            bun_core::pretty_errorln!(
                                "<r><red>error<r>: failed to link <b>{}<r>: {}",
                                bstr::BStr::new(alias),
                                err.name(),
                            );
                        }
                    } else {
                        bun_ast::add_error_pretty!(
                            manager.log_mut(),
                            None,
                            bun_ast::Loc::EMPTY,
                            "failed to link <b>{}<r>: {}",
                            bstr::BStr::new(alias),
                            err.name(),
                        );
                    }

                    if manager.options.enable.fail_early() {
                        manager.crash();
                    }
                }

                break;
            }
        }

        for dep_id in deferred {
            tree.binaries.add(dep_id).unwrap_or_oom();
        }
    }

    pub(crate) fn link_remaining_bins(&mut self) {
        self.link_queued_bins(BinPass::Remaining);
    }

    fn link_queued_bins(&mut self, pass: BinPass) {
        let mut depth_buf = lockfile::tree::depth_buf_uninit();
        let mut node_modules_rel_path_buf = bun_paths::path_buffer_pool::get();
        node_modules_rel_path_buf[..b"node_modules".len()].copy_from_slice(b"node_modules");

        let mut link_target_buf = bun_paths::path_buffer_pool::get();
        let mut link_dest_buf = bun_paths::path_buffer_pool::get();
        let mut link_rel_buf = bun_paths::path_buffer_pool::get();

        let trees_len = self.trees.len();
        for tree_id in 0..trees_len {
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
                    self.lockfile().buffers.hoisted_dependencies.as_slice(),
                    self.lockfile().buffers.dependencies.as_slice(),
                    self.lockfile().buffers.string_bytes.as_slice(),
                    tree_id as u32,
                    &mut node_modules_rel_path_buf,
                    &mut depth_buf,
                );

                self.node_modules
                    .path
                    .extend_from_slice(rel_path.as_bytes());

                self.link_tree_bins(
                    tree_id as u32,
                    pass,
                    link_target_buf.as_mut_slice(),
                    link_dest_buf.as_mut_slice(),
                    link_rel_buf.as_mut_slice(),
                );
            }
        }
    }

    /// Links the bins in `bins_after_scripts`, skipping any name that another package or a script
    /// already created.
    pub(crate) fn link_bins_after_scripts(&mut self) {
        let mut queued = false;
        for tree in self.trees.iter_mut() {
            for dep_id in core::mem::take(&mut tree.bins_after_scripts) {
                tree.binaries.add(dep_id).unwrap_or_oom();
                queued = true;
            }
        }
        if queued {
            self.link_queued_bins(BinPass::AfterScripts);
        }
    }

    pub(crate) fn run_available_scripts(&mut self, log_level: Options::LogLevel) {
        let mut i: usize = self.pending_lifecycle_scripts.len();
        while i > 0 {
            i -= 1;
            if !self.can_run_scripts(self.pending_lifecycle_scripts[i].tree_id) {
                continue;
            }
            let entry = self.pending_lifecycle_scripts.swap_remove(i);
            self.spawn_scripts(entry, log_level);
        }
    }

    fn spawn_scripts(&mut self, entry: PendingLifecycleScript, log_level: Options::LogLevel) {
        let name = entry.list.package_name.clone();
        let output_in_foreground = false;
        if let Err(err) = self.manager_mut().spawn_package_lifecycle_scripts(
            self.command_ctx,
            entry.list,
            entry.optional,
            output_in_foreground,
            Some(InstallCtx::Hoisted {
                tree_id: entry.tree_id,
                unfinished: std::rc::Rc::clone(&self.unfinished_scripts),
            }),
        ) {
            self.on_scripts_error(log_level, "spawn life-cycle", &name, err);
        }
    }

    #[cold]
    fn on_scripts_error(
        &mut self,
        log_level: Options::LogLevel,
        action: &str,
        name: &[u8],
        err: crate::Error,
    ) {
        let name = bstr::BStr::new(name);
        if log_level.show_progress() {
            if Output::enable_ansi_colors_stderr() {
                self.progress_mut().log(format_args!(
                    bun_core::pretty_fmt!(
                        "\n<r><red>error:<r> failed to {s} scripts for <b>{s}<r>: {s}\n",
                        true
                    ),
                    action,
                    name,
                    err.name(),
                ));
            } else {
                self.progress_mut().log(format_args!(
                    bun_core::pretty_fmt!(
                        "\n<r><red>error:<r> failed to {s} scripts for <b>{s}<r>: {s}\n",
                        false
                    ),
                    action,
                    name,
                    err.name(),
                ));
            }
        } else if log_level != Options::LogLevel::Silent {
            bun_core::pretty_errorln!(
                "\n<r><red>error:<r> failed to {} scripts for <b>{}<r>: {}\n",
                action,
                name,
                err.name(),
            );
        }

        if self.manager().options.enable.fail_early() {
            Global::exit(1);
        }

        Output::flush();
        self.summary.fail += 1;
    }

    pub(crate) fn install_available_packages<const FORCE: bool>(
        &mut self,
        log_level: Options::LogLevel,
    ) {
        if self.pending_install_count == 0 {
            return;
        }
        let prev_node_modules = core::mem::take(&mut self.node_modules);
        let prev_tree_id = self.current_tree_id;

        let trees_len = self.trees.len();
        for i in 0..trees_len {
            if self.trees[i].pending_installs.is_empty() {
                continue;
            }
            if FORCE
                || Self::can_install_package_for_tree(
                    &self.completed_trees,
                    self.lockfile().buffers.trees.as_slice(),
                    i as u32,
                )
            {
                // If installing these packages completes the tree, we don't allow it
                // to call `installAvailablePackages` recursively. Starting at id 0 and
                // going up ensures we will reach any trees that will be able to install
                // packages upon completing the current tree
                let resolutions = self.resolutions;
                let pending = core::mem::take(&mut self.trees[i].pending_installs);
                self.pending_install_count -= pending.len();
                for context in pending {
                    let package_id = self.lockfile().buffers.resolutions.as_slice()
                        [context.dependency_id as usize];
                    let name = self.names[package_id as usize];
                    self.node_modules.tree_id = context.tree_id;
                    self.node_modules.path = context.path;
                    self.current_tree_id = context.tree_id;

                    let needs_verify = false;
                    let is_pending_package_install = true;
                    self.install_package_with_name_and_resolution(
                        // This id might be different from the id used to enqueue the task. Important
                        // to use the correct one because the package might be aliased with a different
                        // name
                        context.dependency_id,
                        package_id,
                        log_level,
                        name,
                        &resolutions[package_id as usize],
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
            // .monotonic is okay because this value isn't modified from any other thread.
            // (Scripts are spawned on this thread.)
            while LifecycleScriptSubprocess::alive_count().load(Ordering::Relaxed)
                >= self.manager().options.max_concurrent_lifecycle_scripts
            {
                // Don't use `sleep`, which only returns once every script has exited. One script
                // exiting is enough to make room.
                self.manager_mut().tick_lifecycle_scripts();
                self.manager_mut().report_slow_lifecycle_scripts();
            }

            self.spawn_scripts(entry, log_level);
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
    fn can_run_scripts(&self, scripts_tree_id: lockfile::tree::Id) -> bool {
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

    /// Opens the tree's `node_modules`, creating it if needed, and keeps it open for the next
    /// package. `alias` is about to be replaced in it.
    fn open_tree_dir(
        lockfile: &Lockfile,
        deferred: &mut Option<DeferredLinks>,
        tree_dir: &mut Option<TreeDir>,
        node_modules: &NodeModulesFolder,
        root_node_modules_folder: &Dir,
        alias: &[u8],
    ) -> crate::Result<Fd> {
        let tree_id = node_modules.tree_id;
        let kept = deferred.as_mut().and_then(|deferred| {
            (deferred.tree_dirs.iter_mut().rev()).find(|open| open.tree_id == tree_id)
        });
        let open = match kept {
            Some(open) => open,
            None => {
                if (tree_dir.as_ref()).is_none_or(|open| open.tree_id != tree_id) {
                    // Closes the other tree's first.
                    *tree_dir = None;
                    *tree_dir = Some(TreeDir {
                        tree_id,
                        dir: node_modules.make_and_open_dir(root_node_modules_folder, lockfile)?,
                        scope: Vec::new(),
                    });
                }
                tree_dir.as_mut().expect("opened above")
            }
        };

        if let Some((scope, _)) = strings::split_once_char(alias, b'/')
            && open.scope != scope
        {
            let mut path_buf = bun_paths::path_buffer_pool::get();
            // Open it relative to the directory that's already open, so the full path doesn't have
            // to fit in a buffer.
            #[cfg(not(windows))]
            let scope_path = bun_paths::resolve_path::z(scope, &mut path_buf);
            #[cfg(windows)]
            let scope_path = join_z_buf::<platform::Auto>(
                path_buf.as_mut_slice(),
                &[node_modules.path.as_slice(), scope],
            );
            crate::prune::remove_planted_link(&open.dir, scope_path)?;
            open.scope.clear();
            open.scope.extend_from_slice(scope);
        }
        Ok(open.dir.fd())
    }

    /// The entry of the cache that a package which `can_enqueue_install_task` is linked from.
    fn cache_entry_name(
        &self,
        package_id: PackageID,
        pkg_name: String,
        resolution: &Resolution,
        patch_contents_hash: Option<u64>,
    ) -> &'static ZStr {
        match resolution.tag {
            resolution::Tag::Npm => package_manager::cached_npm_package_folder_name(
                self.manager(),
                pkg_name.slice(self.lockfile().buffers.string_bytes.as_slice()),
                resolution.npm().version,
                patch_contents_hash,
            ),
            resolution::Tag::Git => package_manager::cached_git_folder_name(
                self.manager(),
                resolution.git(),
                patch_contents_hash,
            ),
            resolution::Tag::Github => package_manager::cached_github_folder_name(
                self.manager(),
                resolution.github(),
                patch_contents_hash,
            ),
            _ => package_manager::cached_tarball_folder_name(
                self.manager(),
                &self.metas[package_id as usize].integrity,
                resolution,
                patch_contents_hash,
            ),
        }
    }

    /// Returns true if the thread pool can link this package's files. The package is in the current
    /// tree.
    fn can_defer_link(&self, alias: &[u8], pkg_name: &[u8], package_id: PackageID) -> bool {
        let Some(deferred) = &self.deferred else {
            return false;
        };
        let tree_id = self.current_tree_id;
        let resolution = &self.resolutions[package_id as usize];
        resolution.tag.can_enqueue_install_task()
            && (deferred.tree_dirs.len() < DeferredLinks::MAX_TREES
                || (deferred.tree_dirs.iter()).any(|open| open.tree_id == tree_id))
            && !deferred.shared_trees.is_set(tree_id as usize)
            && !may_fold(alias)
            // Another install is running in this project. Two installs that both link in batches
            // would keep replacing each other's packages.
            && !(self.staging_lock.as_ref()).is_some_and(|lock| lock.is_busy)
            // Placing a trusted package and listing its scripts is one step, because a failed
            // install removes the listed packages.
            && !(self.trusted_dependencies_from_update_requests).contains(&package_id)
            && !(self.lockfile()).has_trusted_dependency(alias, pkg_name, resolution)
    }

    fn defer_link(&mut self, job: package_install::LinkJob) {
        let deferred = self.deferred.as_mut().expect("can_defer_link");
        deferred
            .tree_dirs
            .extend((self.tree_dir).take_if(|open| open.tree_id == job.tree_id));
        deferred.jobs.push(job);
    }

    /// Returns true if earlier packages are still waiting for their files. In that case the event
    /// is queued behind them.
    fn defer_event(&mut self, event: impl FnOnce() -> DeferredEvent) -> bool {
        match &mut self.deferred {
            Some(deferred) if !deferred.jobs.is_empty() => {
                deferred.events.push((deferred.jobs.len(), event()));
                true
            }
            _ => false,
        }
    }

    /// Makes `tree_id` the current tree, as the walk does.
    fn enter_tree(&mut self, tree_id: lockfile::tree::Id) {
        let mut depth_buf = lockfile::tree::depth_buf_uninit();
        let mut rel_path_buf = bun_paths::path_buffer_pool::get();
        rel_path_buf[..b"node_modules".len()].copy_from_slice(b"node_modules");
        let (rel_path, _) = lockfile::tree::relative_path_and_depth::<
            { lockfile::tree::IteratorPathStyle::NodeModules },
        >(
            self.lockfile().buffers.trees.as_slice(),
            self.lockfile().buffers.hoisted_dependencies.as_slice(),
            self.lockfile().buffers.dependencies.as_slice(),
            self.lockfile().buffers.string_bytes.as_slice(),
            tree_id,
            &mut rel_path_buf,
            &mut depth_buf,
        );
        let path = &mut self.node_modules.path;
        path.clear();
        path.extend_from_slice(strings::without_trailing_slash(
            FileSystem::instance().top_level_dir(),
        ));
        path.push(SEP);
        path.extend_from_slice(rel_path.as_bytes());
        self.node_modules.tree_id = tree_id;
        self.current_tree_id = tree_id;
    }

    /// Returns true if the thread pool has to link the waiting packages before the walk enters
    /// `tree_id`.
    pub(crate) fn must_link_before(&self, tree_id: lockfile::tree::Id) -> bool {
        self.deferred.as_ref().is_some_and(|deferred| {
            !deferred.jobs.is_empty()
                && (deferred.tree_dirs.len() >= DeferredLinks::MAX_TREES
                    || !Self::can_install_package_for_tree(
                        &self.completed_trees,
                        self.lockfile().buffers.trees.as_slice(),
                        tree_id,
                    ))
        })
    }

    pub(crate) fn has_deferred_links(&self) -> bool {
        (self.deferred.as_ref()).is_some_and(|deferred| !deferred.jobs.is_empty())
    }

    pub(crate) fn take_deferred_links(
        &mut self,
    ) -> Option<(package_install::LinkBatch, Vec<(usize, DeferredEvent)>)> {
        let deferred = self.deferred.as_mut()?;
        if deferred.jobs.is_empty() {
            return None;
        }
        let staging = self
            .staging_lock
            .as_ref()
            .expect("taken for the first job")
            .mode;
        let batch = package_install::LinkBatch {
            jobs: core::mem::take(&mut deferred.jobs),
            staging,
            next: Default::default(),
            remaining: Default::default(),
        };
        Some((batch, core::mem::take(&mut deferred.events)))
    }

    /// Finishes installing each linked package and runs the events queued behind it, in order. Must
    /// not be called from inside `run_tasks`.
    pub(crate) fn finish_links(
        &mut self,
        batch: package_install::LinkBatch,
        events: Vec<(usize, DeferredEvent)>,
        log_level: Options::LogLevel,
    ) {
        let prev_node_modules = core::mem::take(&mut self.node_modules);
        let prev_tree_id = self.current_tree_id;
        let resolutions = self.resolutions;
        // A tree that's complete now unblocks the trees below it.
        let is_pending_package_install = false;

        let mut events = events.into_iter().peekable();
        for (index, job) in batch.jobs.into_iter().enumerate() {
            if self.node_modules.path.is_empty() || self.current_tree_id != job.tree_id {
                self.enter_tree(job.tree_id);
            }
            let package_id =
                self.lockfile().buffers.resolutions.as_slice()[job.dependency_id as usize];
            self.finish_install(
                job.dependency_id,
                package_id,
                log_level,
                self.names[package_id as usize],
                &resolutions[package_id as usize],
                is_pending_package_install,
                job.tree_dir,
                job.result.into_inner().expect("linked").report(),
            );
            while let Some((_, event)) = events.next_if(|(after, _)| *after == index + 1) {
                let (DeferredEvent::Count(tree_id) | DeferredEvent::Install { tree_id, .. }) =
                    event;
                if self.current_tree_id != tree_id {
                    self.enter_tree(tree_id);
                }
                match event {
                    DeferredEvent::Count(_) => {
                        self.increment_tree_install_count(is_pending_package_install, log_level);
                    }
                    DeferredEvent::Install {
                        dependency_id,
                        needs_verify,
                        ..
                    } => {
                        let package_id =
                            self.lockfile().buffers.resolutions.as_slice()[dependency_id as usize];
                        self.install_package_with_name_and_resolution(
                            dependency_id,
                            package_id,
                            log_level,
                            self.names[package_id as usize],
                            &resolutions[package_id as usize],
                            needs_verify,
                            is_pending_package_install,
                        );
                    }
                }
            }
        }
        debug_assert!(events.next().is_none());

        self.node_modules = prev_node_modules;
        self.current_tree_id = prev_tree_id;
        // The downloads and patches that this queued don't count as pending until they're
        // scheduled.
        self.manager_mut().drain_dependency_list();

        if let Some(deferred) = &mut self.deferred {
            let jobs = &deferred.jobs;
            (deferred.tree_dirs).retain(|open| jobs.iter().any(|job| job.tree_id == open.tree_id));
        }
    }

    /// When this install creates the project's `node_modules`, `skip_delete` is on, because there's
    /// nothing to delete before linking a package. A workspace's `node_modules` can still exist
    /// from an earlier install and contain older packages, so the delete isn't skipped there.
    ///
    /// This has to be decided before any of the workspace's packages are linked, because afterwards
    /// the folder always exists. `path` is the tree's `node_modules`, relative to the working
    /// directory.
    pub(crate) fn set_outlived_root(&mut self, tree_id: lockfile::tree::Id, path: &ZStr) {
        let lockfile = self.lockfile();
        let tree = lockfile.buffers.trees.as_slice()[tree_id as usize];
        if !self.skip_delete || tree.parent == lockfile::tree::INVALID_ID {
            return;
        }
        let outlived = if lockfile.is_importer_tree_id(tree_id) {
            // A workspace that's depended on under two names has two trees for one folder. Whatever
            // the second tree finds there was linked by this install for the first tree.
            let workspace = lockfile.buffers.resolutions[tree.dependency_id as usize];
            let is_first_tree = !self.workspaces_seen.contains(&workspace);
            if is_first_tree {
                self.workspaces_seen.push(workspace);
            }
            is_first_tree && bun_sys::directory_exists_at(Fd::cwd(), path).unwrap_or(true)
        } else {
            self.trees[tree.parent as usize].outlived_root
        };
        self.trees[tree_id as usize].outlived_root = outlived;
    }

    /// Trees are visited in id order, so the parent's `replaced` is complete.
    pub(crate) fn set_inside_replaced_folder(&mut self, tree_id: lockfile::tree::Id) {
        let lockfile = self.lockfile();
        let tree = lockfile.buffers.trees.as_slice()[tree_id as usize];
        if tree.parent == lockfile::tree::INVALID_ID {
            return;
        }
        debug_assert!(tree.parent < tree_id);

        let parent = &self.trees[tree.parent as usize];
        let inside = parent.inside_replaced_folder || {
            let deps = lockfile.buffers.dependencies.as_slice();
            let string_buf = lockfile.buffers.string_bytes.as_slice();
            let folder = tree.folder_name(deps, string_buf);
            let buffers = &lockfile.buffers;
            !tree.is_unlinked_member(&buffers.trees, &buffers.hoisted_dependencies, deps)
                && parent
                    .replaced
                    .iter()
                    .any(|&dep_id| deps[dep_id as usize].name.slice(string_buf) == folder)
        };
        self.trees[tree_id as usize].inside_replaced_folder = inside;
    }

    /// Call when you mutate the length of `lockfile.packages`
    pub(crate) fn fix_cached_lockfile_package_slices(&mut self) {
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

        // fixes an assertion failure where a transitive dependency is a git dependency newly added to the lockfile after the list of dependencies has been resized
        // this assertion failure would also only happen after the lockfile has been written to disk and the summary is being printed.
        if self.successfully_installed.bit_length() < self.lockfile().packages.len() {
            let new = Bitset::init_empty(self.lockfile().packages.len()).unwrap_or_oom();
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
        let package_id = self.lockfile().buffers.resolutions.as_slice()[dependency_id as usize];
        let name = self.names[package_id as usize];

        // If a newly computed integrity hash is available (e.g. for a GitHub
        // tarball) and the lockfile doesn't already have one, persist it so
        // the lockfile gets re-saved with the hash.
        // Before the callbacks below: a `file:` / URL tarball's cache entry is named after it.
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

        if let Some(removed) = self.manager_mut().task_queue.fetch_remove(&task_id) {
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
                // `DependencyInstallContext.path: Vec<u8>` — clone since `cb` is `&`.
                self.node_modules.path.clone_from(&context.path);
                self.current_tree_id = context.tree_id;
                let needs_verify = false;
                let is_pending_package_install = false;
                self.install_package_with_name_and_resolution(
                    // This id might be different from the id used to enqueue the task. Important
                    // to use the correct one because the package might be aliased with a different
                    // name
                    context.dependency_id,
                    callback_package_id,
                    log_level,
                    name,
                    &resolutions[callback_package_id as usize],
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
                bun_core::fmt::quote(name.slice(self.lockfile().buffers.string_bytes.as_slice())),
                bun_core::fmt::quote(&data.url),
                dependency_id,
            ));
        }
    }

    /// The absolute path of `alias` in the current tree's `node_modules`.
    fn package_path(&self, alias: &[u8]) -> crate::Result<AutoAbsPath> {
        let mut path = AutoAbsPath::init();
        path.try_append(self.node_modules.path.as_slice())
            .and_then(|()| path.try_append(alias))
            .map_err(|_| NAME_TOO_LONG)?;
        Ok(path)
    }

    fn get_installed_package_scripts_count(
        &mut self,
        alias: &[u8],
        package_id: PackageID,
        resolution_tag: resolution::Tag,
        folder_path: &mut bun_paths::AutoAbsPath,
        log_level: Options::LogLevel,
    ) -> usize {
        debug_assert!(resolution_tag != resolution::Tag::Root);
        debug_assert!(resolution_tag != resolution::Tag::Workspace);
        debug_assert!(package_id != 0);
        let mut count: usize = 0;
        let (scripts, gypfile) = 'brk: {
            let scripts = self.lockfile().packages.items_scripts()[package_id as usize];
            if scripts.filled {
                break 'brk (scripts, None);
            }

            let mut temp = PackageScripts::default();
            let mut temp_lockfile = Lockfile::default();
            temp_lockfile.init_empty();
            let mut string_builder = temp_lockfile.string_builder();
            let log = self.manager().log_mut();
            match temp.fill_from_package_json(&mut string_builder, log, folder_path) {
                Ok(gypfile) => break 'brk (temp, Some(gypfile)),
                Err(err) => {
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
            }
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

        count += scripts.wants_default_node_gyp(folder_path.slice(), gypfile) as usize;

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
        // reshaped for borrowck — `string_bytes` is not mutated during install,
        // so capture a raw slice once to avoid repeatedly re-borrowing `self.lockfile`
        // across `&mut self` method calls below.
        // SAFETY: `buffers.string_bytes` is append-only and never freed
        // for the lifetime of this `PackageInstaller`.
        let string_buf_ptr =
            bun_ptr::RawSlice::new(self.lockfile().buffers.string_bytes.as_slice());
        macro_rules! string_buf {
            () => {
                string_buf_ptr.slice()
            };
        }

        let alias = self.lockfile().buffers.dependencies.as_slice()[dependency_id as usize].name;

        // The alias is used as a path relative to `node_modules` for delete,
        // rename, and create operations. Refuse anything that could escape it.
        if !alias_is_safe_install_target(alias.slice(string_buf!())) {
            if log_level != Options::LogLevel::Silent {
                bun_core::pretty_errorln!(
                    "<r><red>error<r>: refusing to install dependency with unsafe name <b>{}<r>",
                    bun_core::fmt::for_terminal(bstr::BStr::new(alias.slice(string_buf!()))),
                );
            }
            return self.fail(is_pending_package_install, log_level);
        }

        // Nothing is installed ahead of the packages that are waiting for their files.
        let can_defer_link = self.has_deferred_links().then(|| {
            self.can_defer_link(
                alias.slice(string_buf!()),
                pkg_name.slice(string_buf!()),
                package_id,
            )
        });
        if can_defer_link == Some(false) {
            let tree_id = self.current_tree_id;
            self.defer_event(|| DeferredEvent::Install {
                tree_id,
                dependency_id,
                needs_verify,
            });
            return;
        }

        let destination_dir_subpath = {
            let alias = alias.slice(string_buf!());
            self.destination_dir_subpath_buf[..alias.len()].copy_from_slice(alias);
            self.destination_dir_subpath_buf[alias.len()] = 0;
            ZStr::from_buf(&self.destination_dir_subpath_buf, alias.len())
        };

        let pkg_name_hash = self.pkg_name_hashes[package_id as usize];

        let mut resolution_buf = [0u8; 512];
        let mut resolution_spill = Vec::new();
        let package_version: &[u8] = if resolution.tag != resolution::Tag::Workspace {
            print_package_version(
                &mut resolution_buf,
                &mut resolution_spill,
                format_args!("{}", resolution.fmt(string_buf!(), PathSep::Posix)),
            )
        } else if let Some(version) = self.lockfile().workspace_versions.get(&pkg_name_hash) {
            print_package_version(
                &mut resolution_buf,
                &mut resolution_spill,
                format_args!("{}", version.fmt(string_buf!())),
            )
        } else {
            b""
        };

        let (patch_contents_hash, patch_name_and_version_hash, remove_patch) = 'brk: {
            if self.manager().lockfile.patched_dependencies.count() == 0
                && self.manager().patched_dependencies_to_remove.count() == 0
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
                .lockfile()
                .patched_dependencies
                .get(&name_and_version_hash)
            else {
                let to_remove = &self.manager().patched_dependencies_to_remove;
                break 'brk (None, None, to_remove.contains(&name_and_version_hash));
            };
            let Some(patch_contents_hash) = patchdep.patchfile_hash() else {
                if log_level != Options::LogLevel::Silent {
                    bun_core::pretty_errorln!(
                        "<r><red>error<r>: failed to patch package <b>{}<r>: the hash of patch file {} was not calculated before install, this is a bug in Bun",
                        bun_core::fmt::for_terminal(bstr::BStr::new(&name_and_version)),
                        bun_core::fmt::quote(patchdep.path.slice(string_buf!())),
                    );
                }
                return self.fail(is_pending_package_install, log_level);
            };
            (
                Some(patch_contents_hash),
                Some(name_and_version_hash),
                false,
            )
        };

        // reshaped for borrowck — `PackageInstall` borrows several `self.*`
        // fields while subsequent code also accesses `self.manager` / `self.node_modules`
        // / `self.lockfile` mutably. Detach the borrows via a
        // `ParentRef` so `installer`'s lifetime is independent of `&mut self`.
        // BACKREF — none of these fields are dropped, moved, or resized while
        // `installer` is alive (see `PackageInstaller` field docs).
        let node_modules_ref = bun_ptr::ParentRef::<NodeModulesFolder>::new(&self.node_modules);
        let mut installer = PackageInstall {
            cache_dir: Fd::INVALID, // assigned below
            destination_dir_subpath,
            package_name: pkg_name,
            patch: patch_contents_hash
                .map(|contents_hash| package_install::Patch { contents_hash }),
            package_version,
            node_modules: node_modules_ref.get(),
            lockfile: self.lockfile(),
            cache_dir_subpath: ZStr::EMPTY,
        };
        bun_output::scoped_log!(
            PackageInstaller,
            "Installing {}@{}",
            bstr::BStr::new(pkg_name.slice(string_buf!())),
            resolution.fmt(string_buf!(), PathSep::Posix),
        );

        match resolution.tag {
            resolution::Tag::Npm
            | resolution::Tag::Git
            | resolution::Tag::Github
            | resolution::Tag::LocalTarball
            | resolution::Tag::RemoteTarball => {
                installer.cache_dir_subpath =
                    self.cache_entry_name(package_id, pkg_name, resolution, patch_contents_hash);
                installer.cache_dir = package_manager::get_cache_directory(self.manager_mut());
            }
            resolution::Tag::Folder | resolution::Tag::Workspace => {
                let is_workspace = resolution.tag == resolution::Tag::Workspace;
                let folder_str = if is_workspace {
                    *resolution.workspace()
                } else {
                    *resolution.folder()
                };
                let folder = folder_str.slice(string_buf!());

                // transitive folder dependencies are not hoisted
                let is_transitive =
                    !is_workspace && !self.lockfile().is_workspace_tree_id(self.current_tree_id);
                if folder.len() >= self.folder_path_buf.len() {
                    if log_level != Options::LogLevel::Silent {
                        Output::err(
                            "ENAMETOOLONG",
                            "folder path for package <b>{}<r> is too long",
                            (bstr::BStr::new(pkg_name.slice(string_buf!())),),
                        );
                    }
                    return self.fail(is_pending_package_install, log_level);
                }
                if is_transitive
                    && bin::bin_target_escapes_package_dir(folder)
                    && !self.lockfile().is_trusted_folder_dependency(dependency_id)
                {
                    if log_level != Options::LogLevel::Silent {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r>: refusing to install dependency <b>{}<r> with unsafe folder path \"{}\"",
                            bstr::BStr::new(pkg_name.slice(string_buf!())),
                            bun_core::fmt::escape_control_chars(folder),
                        );
                    }
                    return self.fail(is_pending_package_install, log_level);
                }

                // Handle when a package depends on itself: "mineflayer": "file:."
                if !is_transitive && matches!(folder, b"" | b".") {
                    installer.cache_dir_subpath = ZStr::from_static(b".\0");
                } else {
                    self.folder_path_buf[..folder.len()].copy_from_slice(folder);
                    self.folder_path_buf[folder.len()] = 0;
                    installer.cache_dir_subpath =
                        ZStr::from_buf(&self.folder_path_buf, folder.len());
                }
                // cache_dir might not be created yet (if it's in node_modules)
                installer.cache_dir = Fd::cwd();
            }
            resolution::Tag::Root => {
                installer.cache_dir_subpath = ZStr::from_static(b".\0");
                installer.cache_dir = Fd::cwd();
            }
            resolution::Tag::Symlink => {
                let folder_str = *resolution.symlink();
                let folder = folder_str.slice(string_buf!());
                let is_path = crate::dependency::is_link_path(folder);

                // Rows loaded from bun.lock skip the resolver's check.
                if is_path && !self.lockfile().is_trusted_folder_package(package_id) {
                    if log_level != Options::LogLevel::Silent {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r>: refusing to link dependency <b>{}<r> to \"{}\": {}",
                            bstr::BStr::new(pkg_name.slice(string_buf!())),
                            bun_core::fmt::escape_control_chars(folder),
                            crate::dependency::LINK_PATH_RULE,
                        );
                    }
                    return self.fail(is_pending_package_install, log_level);
                }

                if matches!(folder, b"" | b".") {
                    installer.cache_dir_subpath = ZStr::from_static(b".\0");
                    installer.cache_dir = Fd::cwd();
                } else {
                    // A path is relative to the project. A name is relative to the global link
                    // directory.
                    let (directory, global_link_dir): (Fd, &[u8]) = if is_path {
                        (Fd::cwd(), b"".as_slice())
                    } else {
                        (
                            package_manager::global_link_dir(self.manager_mut()),
                            package_manager::global_link_dir_path(self.manager_mut()),
                        )
                    };
                    let sep_len = global_link_dir.last().is_some_and(|&c| c != SEP) as usize;
                    let len = global_link_dir.len() + sep_len + folder.len();
                    // The resolution of a bun.lock row is used as written.
                    if len >= self.folder_path_buf.len() {
                        if log_level != Options::LogLevel::Silent {
                            Output::err(
                                "ENAMETOOLONG",
                                "link path for package <b>{}<r> is too long",
                                (bstr::BStr::new(pkg_name.slice(string_buf!())),),
                            );
                        }
                        return self.fail(is_pending_package_install, log_level);
                    }
                    let buf = self.folder_path_buf.as_mut_slice();
                    buf[..global_link_dir.len()].copy_from_slice(global_link_dir);
                    if sep_len != 0 {
                        buf[global_link_dir.len()] = SEP;
                    }
                    buf[global_link_dir.len() + sep_len..len].copy_from_slice(folder);
                    buf[len] = 0;
                    installer.cache_dir_subpath = ZStr::from_buf(&self.folder_path_buf, len);
                    installer.cache_dir = directory;
                }
            }
            _ => {
                if cfg!(debug_assertions) {
                    panic!("Internal assertion failure: unexpected resolution tag");
                }
                self.increment_tree_install_count(is_pending_package_install, log_level);
                return;
            }
        }

        let tree = &self.trees[self.current_tree_id as usize];
        let (inside_replaced_folder, outlived_root) =
            (tree.inside_replaced_folder, tree.outlived_root);
        let verifying = needs_verify && !self.skip_verify_installed_version_number;
        let needs_install = !verifying
            || remove_patch
            || inside_replaced_folder
            || !installer.verify(
                resolution,
                &self.metas[package_id as usize].integrity,
                self.manager().skips_verify(resolution.tag),
                &self.root_node_modules_folder,
            );
        self.summary.skipped += (!needs_install) as u32;
        if !needs_install && log_level.show_progress() {
            self.node.complete_one();
        }

        // `install_from_link` only re-points one symlink. Everything else replaces the folder.
        if verifying
            && needs_install
            && !inside_replaced_folder
            && !matches!(
                resolution.tag,
                resolution::Tag::Symlink | resolution::Tag::Workspace | resolution::Tag::Root
            )
        {
            self.trees[self.current_tree_id as usize]
                .replaced
                .push(dependency_id);
        }

        if needs_install {
            if resolution.tag.can_enqueue_install_task()
                && installer.package_missing_from_cache(
                    self.manager_mut(),
                    package_id,
                    resolution.tag,
                )
            {
                // Re-enqueueing would dedupe against the finished download and never call back.
                if !needs_verify {
                    if log_level != Options::LogLevel::Silent {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r>: failed to install <b>{}<r>: the downloaded package was not found in the cache",
                            bstr::BStr::new(alias.slice(string_buf!())),
                        );
                    }
                    return self.fail(is_pending_package_install, log_level);
                }

                let context =
                    TaskCallbackContext::DependencyInstallContext(DependencyInstallContext {
                        tree_id: self.current_tree_id,
                        path: self.node_modules.path.clone(),
                        dependency_id,
                    });
                let queued = match resolution.tag {
                    resolution::Tag::Git => package_manager::enqueue_git_for_checkout(
                        self.manager_mut(),
                        dependency_id,
                        package_id,
                        alias.slice(string_buf!()),
                        context,
                        patch_name_and_version_hash,
                    ),
                    resolution::Tag::Github => {
                        let url = self.manager_mut().alloc_github_url(resolution.github());
                        package_manager::enqueue_tarball_for_download(
                            self.manager_mut(),
                            dependency_id,
                            package_id,
                            &url,
                            context,
                        )
                    }
                    resolution::Tag::LocalTarball => package_manager::enqueue_tarball_for_reading(
                        self.manager_mut(),
                        dependency_id,
                        package_id,
                        alias.slice(string_buf!()),
                        resolution,
                        context,
                    ),
                    resolution::Tag::RemoteTarball => {
                        package_manager::enqueue_tarball_for_download(
                            self.manager_mut(),
                            dependency_id,
                            package_id,
                            resolution.remote_tarball().slice(string_buf!()),
                            context,
                        )
                    }
                    resolution::Tag::Npm => {
                        let npm = *resolution.npm();
                        package_manager::enqueue_package_for_download(
                            self.manager_mut(),
                            pkg_name.slice(string_buf!()),
                            dependency_id,
                            package_id,
                            npm.version,
                            npm.url.slice(string_buf!()),
                            context,
                        )
                    }
                    _ => {
                        debug_assert!(false, "unreachable, handled above");
                        Err(ForTarballError::InvalidURL)
                    }
                };
                match queued {
                    Ok(()) => {}
                    Err(ForTarballError::OutOfMemory) => bun_core::out_of_memory(),
                    Err(ForTarballError::InvalidURL) => {
                        self.fail(is_pending_package_install, log_level)
                    }
                    // Reported by whoever saw the download fail, or by `report_offline_misses`.
                    Err(ForTarballError::AlreadyFailed | ForTarballError::Offline) => {
                        if self.manager().options.offline
                            == crate::package_manager_real::options::OfflineMode::Offline
                        {
                            self.summary.offline_misses.push(package_id);
                        } else {
                            let required = self
                                .manager()
                                .is_package_required(dependency_id, package_id);
                            self.summary.fail += required as u32;
                        }
                        self.increment_tree_install_count(is_pending_package_install, log_level);
                    }
                }

                return;
            }

            // above checks if unpatched package is in cache, if not null apply patch in temp directory, copy
            // into cache, then install into node_modules
            if let Some(patch_contents_hash) = installer.patch.as_ref().map(|p| p.contents_hash) {
                if installer.patched_package_missing_from_cache(self.manager_mut(), package_id) {
                    let mut task = PatchTask::new_apply_patch_hash(
                        self.manager_mut(),
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
                    package_manager::enqueue_patch_task(self.manager_mut(), task);
                    return;
                }
            }

            if !is_pending_package_install
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
                self.pending_install_count += 1;
                return;
            }

            // creating this directory now, right before installing package
            let destination_fd = match Self::open_tree_dir(
                self.lockfile(),
                &mut self.deferred,
                &mut self.tree_dir,
                &self.node_modules,
                &self.root_node_modules_folder,
                alias.slice(string_buf!()),
            ) {
                Ok(fd) => fd,
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
                    return self.fail(is_pending_package_install, log_level);
                }
            };
            let destination_dir = Dir::borrow(&destination_fd);
            let skip_delete = self.skip_delete && !outlived_root;

            let install_result: package_install::InstallResult = match resolution.tag {
                resolution::Tag::Symlink | resolution::Tag::Workspace => {
                    installer.install_from_link(skip_delete, destination_dir)
                }
                _ => 'result: {
                    let staging = self
                        .staging_lock
                        .get_or_insert_with(package_install::StagingLock::acquire)
                        .mode;

                    if resolution.tag == resolution::Tag::Root
                        || (resolution.tag == resolution::Tag::Folder
                            && !self.lockfile().is_workspace_tree_id(self.current_tree_id))
                    {
                        // This is a transitive folder dependency. It is not hoisted.
                        //
                        // A transitive `Resolution::Folder` declared by a local `file:` package
                        // is relative to the top-level dir (`Package::parse` normalized it), so
                        // install it from `installer.cache_dir` (the cwd, set in the switch above).
                        // The same holds for a path from a root `overrides`/`resolutions` rule.
                        if resolution.tag == resolution::Tag::Folder
                            && (self.lockfile().is_folder_tree_id(self.current_tree_id)
                                || self.lockfile().is_overridden_dependency(dependency_id))
                        {
                            break 'result installer.install(
                                staging,
                                skip_delete,
                                destination_dir,
                                installer.get_install_method(),
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
                                );
                            }
                        };
                        installer.cache_dir = owned_cache_dir.fd();

                        let result = if resolution.tag == resolution::Tag::Root {
                            installer.install_from_link(skip_delete, destination_dir)
                        } else if installer.cache_dir_subpath.as_bytes() != b"." {
                            // A folder that a package ships inside itself is linked from where it
                            // is.
                            let mut shipped_buf = bun_paths::path_buffer_pool::get();
                            match join_abs_string_buf_z_checked::<platform::Auto>(
                                dir_name,
                                shipped_buf.as_mut_slice(),
                                &[installer.cache_dir_subpath.as_bytes()],
                            ) {
                                Some(shipped) => PackageInstall {
                                    cache_dir: Fd::cwd(),
                                    cache_dir_subpath: shipped,
                                    ..installer
                                }
                                .install_from_link(false, destination_dir),
                                None => package_install::InstallResult::fail(
                                    crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG),
                                    package_install::Step::OpeningCacheDir,
                                ),
                            }
                        } else {
                            installer.install(
                                staging,
                                skip_delete,
                                destination_dir,
                                installer.get_install_method(),
                                resolution.tag,
                            )
                        };

                        // npm packages can declare `file:` paths missing from the published
                        // tarball (e.g. excluded by `files`); nothing to link is not a failure.
                        if let package_install::InstallResult::Failure(f) = &result
                            && matches!(
                                f.err,
                                crate::Error::Sys(bun_errno::SystemErrno::ENOENT)
                                    | crate::Error::FileNotFound
                            )
                        {
                            break 'result package_install::InstallResult::Success;
                        }

                        break 'result result;
                    }

                    let copy = (self.copy_trees)
                        .is_set_allow_out_of_bound(self.current_tree_id as usize, false);
                    if can_defer_link.unwrap_or_else(|| {
                        self.can_defer_link(
                            alias.slice(string_buf!()),
                            pkg_name.slice(string_buf!()),
                            package_id,
                        )
                    }) {
                        return self.defer_link(package_install::LinkJob {
                            tree_id: self.current_tree_id,
                            dependency_id,
                            tree_dir: destination_fd,
                            cache_dir: installer.cache_dir,
                            cache_dir_subpath: bun_core::ZBox::from_bytes(
                                installer.cache_dir_subpath.as_bytes(),
                            ),
                            destination_dir_subpath: bun_core::ZBox::from_bytes(
                                alias.slice(string_buf!()),
                            ),
                            copy,
                            skip_delete,
                            random: bun_core::fast_random(),
                            resolution_tag: resolution.tag,
                            result: Default::default(),
                        });
                    }
                    let method = if copy {
                        package_install::Method::Copyfile
                    } else {
                        installer.get_install_method()
                    };
                    break 'result installer.install(
                        staging,
                        skip_delete,
                        destination_dir,
                        method,
                        resolution.tag,
                    );
                }
            };

            // A folder that a published package ships inside itself is copied from that package's
            // directory, not from the cwd, so its symlinks are not recreated.
            if resolution.tag == resolution::Tag::Folder
                && matches!(install_result, package_install::InstallResult::Success)
                && installer.cache_dir == Fd::cwd()
                && self.lockfile().is_trusted_folder_dependency(dependency_id)
                && let Ok(dest) = destination_dir.open_at(installer.destination_dir_subpath)
            {
                for text in package_install::lay_folder_links(installer.cache_dir_subpath, &dest) {
                    self.manager().log_mut().add_warning_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!("{}", bun_core::fmt::escape_control_chars(&text)),
                    );
                }
            }

            self.finish_install(
                dependency_id,
                package_id,
                log_level,
                pkg_name,
                resolution,
                is_pending_package_install,
                destination_fd,
                install_result,
            );
        } else {
            if self.manager().options.offline
                == crate::package_manager_real::options::OfflineMode::Offline
            {
                self.summary.offline_misses.in_place.push(package_id);
            }

            if self.bins[package_id as usize].tag != bin::Tag::None {
                self.trees[self.current_tree_id as usize]
                    .binaries
                    .add(dependency_id)
                    .unwrap_or_oom();
            }

            let dep = &self.lockfile().buffers.dependencies.as_slice()[dependency_id as usize];
            let (trusted_name, trusted_name_hash) = resolution.trusted_name(
                (alias, dep.name_hash as TruncatedPackageNameHash),
                (pkg_name, pkg_name_hash as TruncatedPackageNameHash),
            );
            let is_trusted_through_update_request =
                (self.trusted_dependencies_from_update_requests).contains(&package_id);
            let is_trusted = is_trusted_through_update_request
                || (self.manager().summary.added_trusted_dependencies)
                    .get(&trusted_name_hash)
                    .is_some_and(|added| {
                        **added == *trusted_name.slice(string_buf!())
                            && self.lockfile().has_trusted_dependency(
                                alias.slice(string_buf!()),
                                pkg_name.slice(string_buf!()),
                                resolution,
                            )
                    });

            if resolution.tag != resolution::Tag::Root && is_trusted {
                self.enqueue_lifecycle_scripts_for_trusted(
                    log_level,
                    dependency_id,
                    package_id,
                    pkg_name,
                    resolution,
                    is_trusted_through_update_request,
                );
            }

            self.increment_tree_install_count(is_pending_package_install, log_level);
        }
    }

    /// What follows the files of a package in the current tree.
    fn finish_install(
        &mut self,
        dependency_id: DependencyID,
        package_id: PackageID,
        log_level: Options::LogLevel,
        pkg_name: String,
        resolution: &Resolution,
        is_pending_package_install: bool,
        destination_fd: Fd,
        install_result: package_install::InstallResult,
    ) {
        // SAFETY: `buffers.string_bytes` is append-only and never freed
        // for the lifetime of this `PackageInstaller`.
        let string_buf_ptr =
            bun_ptr::RawSlice::new(self.lockfile().buffers.string_bytes.as_slice());
        macro_rules! string_buf {
            () => {
                string_buf_ptr.slice()
            };
        }
        let alias = self.lockfile().buffers.dependencies.as_slice()[dependency_id as usize].name;
        #[cfg(windows)]
        let _ = destination_fd;

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

                let is_trusted_through_update_request =
                    (self.trusted_dependencies_from_update_requests).contains(&package_id);
                let is_trusted = is_trusted_through_update_request
                    || self.lockfile().has_trusted_dependency(
                        alias.slice(string_buf!()),
                        pkg_name.slice(string_buf!()),
                        resolution,
                    );

                if resolution.tag != resolution::Tag::Root
                    && (resolution.tag == resolution::Tag::Workspace || is_trusted)
                {
                    self.enqueue_lifecycle_scripts_for_trusted(
                        log_level,
                        dependency_id,
                        package_id,
                        pkg_name,
                        resolution,
                        is_trusted_through_update_request,
                    );
                }

                // The root and workspaces are never blocked.
                if !is_trusted
                    && !matches!(
                        resolution.tag,
                        resolution::Tag::Root | resolution::Tag::Workspace
                    )
                    && self.metas[package_id as usize].has_install_script()
                {
                    // `hasInstallScript` is a false positive when binding.gyp is not published.
                    let count = self.package_path(alias.slice(string_buf!())).map_or(
                        0,
                        |mut folder_path| {
                            self.get_installed_package_scripts_count(
                                alias.slice(string_buf!()),
                                package_id,
                                resolution.tag,
                                &mut folder_path,
                                log_level,
                            )
                        },
                    );
                    if count > 0 {
                        if log_level.is_verbose() {
                            bun_core::pretty_error!(
                                "Blocked {} scripts for: {}@{}\n",
                                count,
                                bstr::BStr::new(alias.slice(string_buf!())),
                                bun_core::fmt::for_terminal(
                                    resolution.fmt(string_buf!(), PathSep::Posix)
                                ),
                            );
                        }
                        let dependencies = self.lockfile().buffers.dependencies.as_slice();
                        let name_hash = dependencies[dependency_id as usize].name_hash;
                        let entry = (self.summary.packages_with_blocked_scripts)
                            .get_or_put(name_hash as TruncatedPackageNameHash)
                            .unwrap_or_oom();
                        if !entry.found_existing {
                            *entry.value_ptr = 0;
                        }
                        *entry.value_ptr += count;
                    }
                }

                self.increment_tree_install_count(is_pending_package_install, log_level);
            }
            package_install::InstallResult::Failure(cause) => {
                debug_assert!(
                    !cause.is_package_missing_from_cache()
                        || (resolution.tag != resolution::Tag::Symlink
                            && resolution.tag != resolution::Tag::Workspace)
                );

                let name = self.names[package_id as usize];
                let name = bstr::BStr::new(name.slice(string_buf!()));
                if cause.err == crate::Error::DanglingSymlink {
                    bun_core::pretty_errorln!(
                        "<r><red>error<r>: <b>{}<r> \"link:{}\" not found (try running 'bun link' in the intended package's folder)<r>",
                        cause.err.name(),
                        name,
                    );
                } else if resolution.tag == resolution::Tag::Folder
                    && cause.is_package_missing_from_cache()
                {
                    bun_core::pretty_errorln!(
                        "<r><red>error<r>: Could not find folder \"file:{}\" for dependency \"{}\"",
                        bun_core::fmt::escape_control_chars(
                            resolution.folder().slice(string_buf!())
                        ),
                        bstr::BStr::new(alias.slice(string_buf!())),
                    );
                } else if matches!(
                    cause.err,
                    crate::Error::Sys(bun_errno::SystemErrno::EACCES) | crate::Error::AccessDenied
                ) {
                    // If `node_modules` itself isn't writable, every package fails, so exit early.
                    // This is only checked once.
                    static NODE_MODULES_IS_OK: core::sync::atomic::AtomicBool =
                        core::sync::atomic::AtomicBool::new(false);
                    if !NODE_MODULES_IS_OK.load(Ordering::Relaxed) {
                        #[cfg(not(windows))]
                        {
                            let stat = match bun_sys::fstat(destination_fd) {
                                Ok(s) => s,
                                Err(_) => {
                                    Output::err(
                                        "EACCES",
                                        "Permission denied while installing <b>{}<r>",
                                        (name,),
                                    );
                                    Global::exit(1);
                                }
                            };

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
                        (name,),
                    );
                } else {
                    Output::err(
                        cause.err,
                        "failed {} for package <b>{}<r>",
                        (bstr::BStr::new(cause.step.name()), name),
                    );
                }

                // A failed package still counts toward its tree. This comes last, because the work
                // it unblocks closes `destination_fd`.
                self.fail(is_pending_package_install, log_level);
            }
        }
    }

    /// `record_trust` means `--trust` named the package, so its name is added to package.json and
    /// the lockfile.
    fn enqueue_lifecycle_scripts_for_trusted(
        &mut self,
        log_level: Options::LogLevel,
        dependency_id: DependencyID,
        package_id: PackageID,
        pkg_name: String,
        resolution: &Resolution,
        record_trust: bool,
    ) {
        if self.lockfile().is_folder_inside_declarer(dependency_id) {
            return;
        }

        // SAFETY: `buffers.string_bytes` is append-only and never freed
        // for the lifetime of this `PackageInstaller`.
        let string_buf_ptr =
            bun_ptr::RawSlice::new(self.lockfile().buffers.string_bytes.as_slice());
        let string_buf = string_buf_ptr.slice();

        let dep = &self.lockfile().buffers.dependencies.as_slice()[dependency_id as usize];
        let (alias, alias_hash) = (dep.name, dep.name_hash);
        let pkg_name_hash = self.pkg_name_hashes[package_id as usize];

        let mut folder_path = match self.package_path(alias.slice(string_buf)) {
            Ok(folder_path) => folder_path,
            Err(err) => {
                let name = alias.slice(string_buf);
                return self.on_scripts_error(log_level, "enqueue lifecycle", name, err);
            }
        };

        if self
            .manager()
            .postinstall_optimizer
            .should_ignore_lifecycle_scripts(
                &postinstall_optimizer::PkgInfo {
                    name_hash: pkg_name_hash,
                    version: (resolution.tag == resolution::Tag::Npm)
                        .then(|| resolution.npm().version),
                    version_buf: string_buf,
                },
                self.lockfile().packages.items_resolutions()[package_id as usize]
                    .get(self.lockfile().buffers.resolutions.as_slice()),
                self.lockfile().packages.items_meta(),
                self.manager().options.cpu,
                self.manager().options.os,
                self.manager().options.libc,
            )
        {
            if PackageManager::verbose_install() {
                bun_core::pretty_errorln!(
                    "<d>[Lifecycle Scripts]<r> ignoring {} lifecycle scripts",
                    bstr::BStr::new(pkg_name.slice(string_buf)),
                );
            }
            return;
        }

        if self.enqueue_lifecycle_scripts(
            alias.slice(string_buf),
            log_level,
            &mut folder_path,
            dependency_id,
            package_id,
            resolution,
        ) && record_trust
        {
            let (trusted_name, trusted_name_hash) = resolution.trusted_name(
                (alias, alias_hash as TruncatedPackageNameHash),
                (pkg_name, pkg_name_hash as TruncatedPackageNameHash),
            );
            let trusted_name = trusted_name.slice(string_buf);
            self.manager_mut()
                .trusted_deps_to_add_to_package_json
                .push(Box::<[u8]>::from(trusted_name));
            self.lockfile_mut()
                .trusted_dependencies
                .get_or_insert_with(Default::default)
                .put(trusted_name_hash, Box::<[u8]>::from(trusted_name))
                .unwrap_or_oom();
        }
    }

    /// returns true if scripts are enqueued
    fn enqueue_lifecycle_scripts(
        &mut self,
        folder_name: &[u8],
        log_level: Options::LogLevel,
        package_path: &mut bun_paths::AutoAbsPath,
        dependency_id: DependencyID,
        package_id: PackageID,
        resolution: &Resolution,
    ) -> bool {
        let mut scripts: PackageScripts =
            self.lockfile().packages.items_scripts()[package_id as usize];
        // Only a workspace gets here without being trusted.
        let trusted = resolution.tag != resolution::Tag::Workspace
            || self
                .lockfile()
                .has_trusted_dependency(folder_name, folder_name, resolution);
        let log = self.manager().log_mut();
        let scripts_list = match scripts.get_list(
            log,
            self.lockfile(),
            package_path,
            folder_name,
            resolution,
            trusted,
        ) {
            Ok(Some(list)) => list,
            Ok(None) => return false,
            Err(err) => {
                self.on_scripts_error(log_level, "enqueue lifecycle", folder_name, err);
                return false;
            }
        };

        if !self
            .manager()
            .options
            .do_
            .contains(Options::Do::RUN_SCRIPTS)
        {
            return false;
        }

        // Bind once: a second `manager_mut()` would invalidate `scripts_node`, derived from this.
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
        let optional = !self
            .manager()
            .is_package_required(dependency_id, package_id);
        if self.bins[package_id as usize].tag != bin::Tag::None {
            self.trees[self.current_tree_id as usize]
                .bins_after_scripts
                .push(dependency_id);
        }
        self.unfinished_scripts
            .borrow_mut()
            .push((self.current_tree_id, scripts_list.package_name.clone()));
        self.pending_lifecycle_scripts.push(PendingLifecycleScript {
            list: scripts_list,
            tree_id: self.current_tree_id,
            optional,
        });
        true
    }

    pub(crate) fn install_package(&mut self, dep_id: DependencyID, log_level: Options::LogLevel) {
        let package_id = self.lockfile().buffers.resolutions.as_slice()[dep_id as usize];

        let name = self.names[package_id as usize];
        let resolutions = self.resolutions;

        let needs_verify = true;
        let is_pending_package_install = false;
        self.install_package_with_name_and_resolution(
            dep_id,
            package_id,
            log_level,
            name,
            &resolutions[package_id as usize],
            needs_verify,
            is_pending_package_install,
        );
    }
}
