use core::sync::atomic::{AtomicU8, AtomicUsize, Ordering};

use bun_collections::{ArrayHashMap, DynamicBitSet};
use bun_core::{MutableString, ZStr};
use bun_paths::strings;
use bun_paths::{self as path, OSPathChar, OSPathSlice};
use bun_semver::String as SemverString;
#[cfg(not(windows))]
use bun_sys::OpenDirOptions;
use bun_sys::{self as sys, Dir, EntryKind, Fd, FdExt, walker_skippable};
use bun_threading::thread_pool::{Batch, Node as ThreadPoolNode};
use bun_threading::work_pool::Task as WorkPoolTask;
#[cfg(windows)]
use bun_threading::{IntrusiveWorkTask, ThreadPool, WaitGroup};

use crate::package_installer::NodeModulesFolder;
use crate::{
    BuntagHashBuf, DependencyID, Integrity, Lockfile, Npm, PackageID, PackageManager, Resolution,
    TruncatedPackageNameHash, bun_fs, bun_json, buntaghashbuf_make, initialize_store, resolution,
};

bun_output::declare_scope!(install, hidden);

pub struct PackageInstall<'a> {
    /// Borrowed view of the cache directory fd. The owner is either
    /// `PackageManager`'s cached directory handle, the cwd sentinel, or a
    /// short-lived `Dir` held by the caller — `PackageInstall` never closes it.
    pub(crate) cache_dir: Fd,
    pub(crate) cache_dir_subpath: &'a ZStr,
    pub(crate) destination_dir_subpath: &'a ZStr,

    pub(crate) package_name: SemverString,
    pub(crate) package_version: &'a [u8],
    pub(crate) patch: Option<Patch>,

    pub(crate) node_modules: &'a NodeModulesFolder,
    pub lockfile: &'a Lockfile,
}

/// The file work of a `PackageInstall`. No lockfile and no manager, so any thread can do it.
#[derive(Clone, Copy)]
pub(crate) struct PackageFiles<'a> {
    pub(crate) cache_dir: Fd,
    pub(crate) cache_dir_subpath: &'a ZStr,
    pub(crate) destination_dir_subpath: &'a ZStr,
}

#[derive(Clone, Copy)]
pub struct Patch {
    pub(crate) contents_hash: u64,
}

#[derive(Default)]
pub struct Summary {
    pub(crate) fail: u32,
    pub(crate) success: u32,
    pub(crate) skipped: u32,
    pub(crate) successfully_installed: Option<DynamicBitSet>,

    /// Package name hash -> number of scripts skipped.
    /// Multiple versions of the same package might add to the count, and each version
    /// might have a different number of scripts
    pub(crate) packages_with_blocked_scripts: ArrayHashMap<TruncatedPackageNameHash, usize>,

    /// Set when this install replaced the tree of the other linker.
    pub(crate) old_modules: Option<crate::prune::OldModules>,

    /// Set by the hoisted linker only. A copy of `tree::Builder::places`.
    pub(crate) places: Vec<(u64, PackageID)>,

    pub(crate) offline_misses: OfflineMisses,
}

/// Only used with `--offline`. Has one entry per folder. `report_offline_misses` decides which ones
/// are errors.
#[derive(Default)]
pub(crate) struct OfflineMisses {
    /// Packages that are neither installed nor in the cache.
    pub(crate) missing: Vec<PackageID>,
    /// Already installed.
    pub(crate) in_place: Vec<PackageID>,
}

impl OfflineMisses {
    pub(crate) fn push(&mut self, package_id: PackageID) {
        self.missing.push(package_id);
    }
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Method {
    Clonefile,

    /// Slower than clonefile
    ClonefileEachDir,

    /// On macOS, slow.
    /// On Linux, fast.
    Hardlink,

    /// Slowest if single-threaded
    /// Note that copyfile does technically support recursion
    /// But I suspect it is slower in practice than manually doing it because:
    /// - it adds syscalls
    /// - it runs in userspace
    /// - it reads each dir twice incase the first pass modifies it
    Copyfile,

    /// Creates one symlink per file. Used for `--backend=symlink` and for a package that depends on
    /// itself (`file:.`).
    Symlink,
}

impl Method {
    /// Decode the `AtomicU8` repr back into a `Method`. Stored via
    /// `Method::* as u8` so the value is always a valid discriminant.
    #[inline]
    pub(crate) const fn from_u8(n: u8) -> Self {
        match n {
            0 => Method::Clonefile,
            1 => Method::ClonefileEachDir,
            2 => Method::Hardlink,
            3 => Method::Copyfile,
            4 => Method::Symlink,
            // Was @enumFromInt; cold atomic-load decode so the panic branch is fine.
            _ => unreachable!(),
        }
    }
}

bun_core::comptime_string_map! {
    pub(crate) static METHOD_MAP: Method = {
        b"clonefile" => Method::Clonefile,
        b"clonefile_each_dir" => Method::ClonefileEachDir,
        b"hardlink" => Method::Hardlink,
        b"copyfile" => Method::Copyfile,
        b"symlink" => Method::Symlink,
    };
}

impl Method {
    pub(crate) fn is_supported(self) -> bool {
        match self {
            Method::Clonefile | Method::ClonefileEachDir => cfg!(target_os = "macos"),
            Method::Hardlink | Method::Copyfile => true,
            Method::Symlink => cfg!(not(windows)),
        }
    }
}

pub struct Failure {
    pub(crate) err: crate::Error,
    pub(crate) step: Step,
    /// The file the copyfile backend stopped at, for `InstallResult::report`.
    pub(crate) file: Vec<u8>,
}

impl Failure {
    #[inline]
    fn boxed(err: crate::Error, step: Step) -> Box<Failure> {
        Box::new(Failure {
            err,
            step,
            file: Vec::new(),
        })
    }

    #[inline]
    pub(crate) fn is_package_missing_from_cache(&self) -> bool {
        (self.err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT)
            || self.err == crate::Error::FileNotFound)
            && self.step == Step::OpeningCacheDir
    }
}

pub(crate) enum InstallResult {
    Success,
    Failure(Box<Failure>),
}

impl InstallResult {
    #[inline]
    pub(crate) fn fail(err: crate::Error, step: Step) -> InstallResult {
        InstallResult::Failure(Failure::boxed(err, step))
    }

    /// Prints the details that a backend recorded in addition to the error itself. The backend may
    /// have run on a thread pool thread.
    pub(crate) fn report(self) -> InstallResult {
        if let InstallResult::Failure(failure) = &self
            && !failure.file.is_empty()
        {
            bun_core::pretty_errorln!(
                "<r><red>{}<r>: copying file {}",
                failure.err.name(),
                bun_core::fmt::EscapeControlChars(bstr::BStr::new(&failure.file))
            );
        }
        self
    }
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Step {
    OpeningCacheDir,
    OpeningDestDir,
    CopyingFiles,
    LinkingDependency,
}

impl Step {
    /// "error: failed {s} for package"
    pub(crate) fn name(self) -> &'static [u8] {
        match self {
            Step::CopyingFiles => b"copying files from cache to destination",
            Step::OpeningCacheDir => b"opening cache/package/version dir",
            Step::OpeningDestDir => b"opening node_modules/package dir",
            Step::LinkingDependency => b"linking dependency/workspace to node_modules",
        }
    }
}

/// Controls whether an install links packages through a `StagingPath`, and how it names those
/// folders.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Staging {
    Off,
    /// This install holds the project's lock. It uses fixed names, which the next install cleans
    /// up.
    Locked,
    /// This install doesn't hold the lock, so it uses unique names derived from this seed. If it's
    /// killed, its leftovers stay until `bun prune`.
    Unlocked(u64),
}

/// A `flock` on the root `node_modules`. It also covers the workspaces' `node_modules`.
pub(crate) struct StagingLock {
    pub(crate) mode: Staging,
    /// True if another install holds the lock. If this is false and the install is `Unlocked`,
    /// directories can't be locked here (Windows, NFS).
    pub(crate) is_busy: bool,
    _node_modules: Option<Dir>,
}

impl StagingLock {
    /// Never waits. The cwd is the project's root.
    pub(crate) fn acquire() -> StagingLock {
        let node_modules = if cfg!(windows) {
            None
        } else {
            Dir::open(b"node_modules").ok()
        };
        let locked = node_modules
            .as_ref()
            .and_then(|dir| sys::flock(dir.fd(), sys::FileLockMode::Exclusive, true).ok());
        StagingLock {
            mode: if locked == Some(true) {
                Staging::Locked
            } else {
                Staging::Unlocked(bun_core::fast_random())
            },
            is_busy: locked == Some(false),
            _node_modules: node_modules,
        }
    }
}

/// The sibling `.bun-tmp-<hash>` a package is linked in before it is renamed onto its real path.
pub(crate) struct StagingPath<'a>(pub(crate) &'a [u8], pub(crate) Staging);

impl StagingPath<'_> {
    pub(crate) const PREFIX: &'static str = ".bun-tmp-";
}

impl core::fmt::Display for StagingPath<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let seed = match self.1 {
            Staging::Unlocked(seed) => seed,
            Staging::Locked | Staging::Off => 0,
        };
        let name_start = strings::last_index_of_char(self.0, b'/').map_or(0, |slash| slash + 1);
        let scope = &self.0[..name_start];
        // Use a hash, because the name itself may already be NAME_MAX bytes long.
        write!(
            f,
            "{}{}{:016x}",
            bstr::BStr::new(scope),
            Self::PREFIX,
            bun_wyhash::hash_with_seed(seed, self.0)
        )
    }
}

/// Renames a fully linked `StagingPath` (relative to `dir`) onto `dest`, which has to be free.
pub(crate) fn rename_staging_into_place(dir: Fd, staging: &ZStr, dest: &ZStr) -> sys::Maybe<()> {
    crate::cache_publish::RenameRetry::new()
        .rename(dir, staging, dir, dest)
        .map_err(|err| err.err)
}

// Only a hint, and any thread can write it. A thread that reads a stale value just detects the
// right method again, so `Relaxed` is enough.
pub(crate) static SUPPORTED_METHOD: AtomicU8 = AtomicU8::new(if cfg!(target_os = "macos") {
    Method::Clonefile as u8
} else {
    Method::Hardlink as u8
});

impl PackageInstall<'_> {
    /// Read accessor for the [`SUPPORTED_METHOD`] global. Associated fn so
    /// cross-module callers keep the `PackageInstall::supported_method()` call shape.
    #[inline]
    pub(crate) fn supported_method() -> Method {
        Method::from_u8(SUPPORTED_METHOD.load(Ordering::Relaxed))
    }
}

// ───────────────────────────── InstallDirState ─────────────────────────────

/// What `init_install_dir` opens for one package install. `walker` owns the
/// cache directory it walks.
struct InstallDirState {
    walker: Walker,
    /// Not opened on Windows; the copy loops there work from `buf`/`buf2`.
    subdir: Dir,
    // A by-value `WPathBuffer` here would
    // memset+move ~128 KB through `Default::default()` per package. Use the
    // thread-local pool guard (heap-backed, uninit) so construction is O(1)
    // and the struct stays small enough to return by value.
    #[cfg(windows)]
    buf: bun_paths::w_path_buffer_pool::Guard,
    #[cfg(windows)]
    buf2: bun_paths::w_path_buffer_pool::Guard,
    // Store the copy-target offset directly instead of a self-referential
    // slice into `buf` — no self-referential raw fat pointer needed.
    #[cfg(windows)]
    to_copy_buf_off: usize, // offset into `buf` where the copy-target tail starts
    #[cfg(windows)]
    to_copy_buf2_off: usize, // offset into `buf2` where the copy-target tail starts
}

// ───────────────────────────── helpers ─────────────────────────────

/// Recursive mkdir following the NodeFS algorithm, restricted to the
/// `Ctx == void, return_path = false` instantiation used here. The previous routing to
/// `bun_sys::make_path_w` was wrong: that helper transcodes to UTF-8, strips the `\\?\`
/// prefix and forward-iterates components via `mkdirat(Fd::cwd(), comp)`, so the first
/// component is `"C:"` (drive-relative — wrong dir) or `"UNC"` (creates a literal
/// `UNC\server\share\...` tree under CWD). NodeFS instead calls `CreateDirectoryW` on
/// the FULL absolute path and on `ENOENT` walks back to the first existing ancestor,
/// then forward — never touching the filesystem root.
#[cfg(windows)]
fn mkdir_recursive_os_path(fullpath: &bun_core::WStr) -> sys::Maybe<()> {
    use sys::E;
    let path = fullpath.as_slice();
    let len = path.len() as u16;

    // First, attempt to create the desired directory.
    match sys::mkdir_w(fullpath) {
        Ok(()) => return Ok(()),
        Err(err) => match err.get_errno() {
            // `mkpath_np` on macOS also checks EISDIR; on Windows EEXIST suffices.
            // An existing entry counts as success, like `make_path`.
            E::EISDIR | E::EEXIST => return Ok(()),
            E::ENOENT => {
                if len == 0 {
                    return Err(err);
                }
                // fall through to walk-back
            }
            _ => return Err(err),
        },
    }

    // Use the thread-local WPathBuffer pool so we don't add 64 KB
    // of stack on ThreadPool worker threads (HardLinkWindowsInstallTask::run).
    let mut working_mem = bun_paths::w_path_buffer_pool::get();
    working_mem[..usize::from(len)].copy_from_slice(path);

    use bun_paths::is_sep_any_t as is_sep;

    // Walk back until creating a parent succeeds (or one already exists).
    let mut i: u16 = len - 1;
    while i > 0 {
        if is_sep(path[usize::from(i)]) {
            working_mem[usize::from(i)] = 0;
            let parent = bun_core::WStr::from_buf(&working_mem[..], usize::from(i));
            match sys::mkdir_w(parent) {
                Ok(()) => {
                    working_mem[usize::from(i)] = bun_paths::SEP_WINDOWS as u16;
                    break;
                }
                Err(err) => {
                    match err.get_errno() {
                        E::EEXIST => {
                            // On Windows, if the existing
                            // entry is a *file*, bail with ENOTDIR instead of
                            // forward-walking under it. `parent` is still
                            // NUL-terminated (separator not yet restored).
                            let mut tmp = bun_paths::path_buffer_pool::get();
                            let narrow = strings::from_wpath(&mut tmp[..], parent.as_slice());
                            if let Ok(false) = sys::directory_exists_at(Fd::INVALID, narrow) {
                                return Err(sys::Error::from_code(E::ENOTDIR, sys::Tag::mkdir));
                            }
                            working_mem[usize::from(i)] = bun_paths::SEP_WINDOWS as u16;
                            break;
                        }
                        E::ENOENT => {
                            working_mem[usize::from(i)] = bun_paths::SEP_WINDOWS as u16;
                        }
                        _ => return Err(err),
                    }
                }
            }
        }
        i -= 1;
    }
    i += 1;
    // Now walk forward creating each remaining component.
    while i < len {
        if is_sep(path[usize::from(i)]) {
            working_mem[usize::from(i)] = 0;
            let parent = bun_core::WStr::from_buf(&working_mem[..], usize::from(i));
            match sys::mkdir_w(parent) {
                Ok(()) => {}
                Err(err) => match err.get_errno() {
                    E::EEXIST => {} // race: another thread created it
                    _ => return Err(err),
                },
            }
            working_mem[usize::from(i)] = bun_paths::SEP_WINDOWS as u16;
        }
        i += 1;
    }

    // Final component (no trailing sep case).
    working_mem[usize::from(len)] = 0;
    let leaf = bun_core::WStr::from_buf(&working_mem[..], usize::from(len));
    match sys::mkdir_w(leaf) {
        Ok(()) => Ok(()),
        Err(err) => match err.get_errno() {
            E::EEXIST => Ok(()),
            _ => Err(err),
        },
    }
}

/// Open a directory handle relative to `dir`.
#[inline]
fn open_dir(dir: Fd, subpath: &[u8]) -> crate::Result<Dir> {
    sys::open_dir_at(dir, subpath)
        .map(Dir::from_fd)
        .map_err(Into::into)
}

/// Like `Dir::make_open_path`, but doesn't follow a symlink at the last component.
#[cfg(not(windows))]
pub(crate) fn make_open_real_dir(base: &Dir, sub_path: &ZStr) -> sys::Maybe<Dir> {
    let open = || {
        base.open_at_with(
            sub_path.as_bytes(),
            sys::O::RDONLY | sys::O::CLOEXEC | sys::O::NOFOLLOW,
        )
    };
    match open() {
        Err(err) if err.get_errno() == sys::E::ENOENT => {}
        // Linux and macOS return these errors for a symlink.
        Err(err) if matches!(err.get_errno(), sys::E::ENOTDIR | sys::E::ELOOP) => {
            crate::prune::remove_planted_link(base, sub_path)?;
        }
        result => return result,
    }
    base.make_path(sub_path.as_bytes())?;
    open()
}

/// Returns true if `dest` is still a hardlinked copy of `src`, which means both have the same entry
/// names and inodes. `rel` is the path of `src` inside the `file:` folder.
fn is_hardlinked_copy(root: &mut FolderRoot<'_>, rel: &mut Vec<u8>, src: &Dir, dest: &Dir) -> bool {
    const INO_LEN: usize = core::mem::size_of::<u64>();
    // Lists each entry name followed by its inode number, or 0 for a directory. `folder` is `Some`
    // when `dir` is in the source folder and `None` when it is in the copy.
    fn list(
        dir: &Dir,
        mut folder: Option<(&mut FolderRoot<'_>, &mut Vec<u8>)>,
    ) -> Option<Vec<Box<[u8]>>> {
        let mut entries: Vec<Box<[u8]>> = Vec::new();
        let mut iter = sys::iterate_dir(dir.fd());
        while let Some(entry) = iter.next().ok()? {
            let name = entry.name.slice_u8();
            let ino: u64 = match crate::prune::entry_kind(dir, name, entry.kind) {
                EntryKind::File if cfg!(windows) => {
                    sys::fstatat(dir, &bun_core::ZBox::from_bytes(name))
                        .ok()?
                        .st_ino
                }
                EntryKind::File => entry.ino,
                EntryKind::Directory if name == b"node_modules" => continue,
                EntryKind::Directory => 0,
                EntryKind::Unknown => return None,
                // For a symlink in the source folder, list what `lay_folder_links` creates for it
                // in the copy, because that is what the copy is expected to contain.
                EntryKind::SymLink if name != b"node_modules" => {
                    let link = match &mut folder {
                        Some((root, rel)) => {
                            let root = root.get()?;
                            let dir_len = rel.len();
                            rel.extend_from_slice(name);
                            let link = FolderLink::of(root, rel.as_slice(), dir_len, dir);
                            rel.truncate(dir_len);
                            link
                        }
                        None => FolderLink::Link(read_link(dir, name)?),
                    };
                    match link {
                        FolderLink::Link(text) => {
                            let link = [name, &b"/"[..], &text[..], &[0xff; INO_LEN][..]].concat();
                            entries.push(link.into_boxed_slice());
                            continue;
                        }
                        FolderLink::File(_, target) => target.st_ino,
                        FolderLink::LeftOut(_) => continue,
                    }
                }
                // The backends skip these.
                _ => continue,
            };
            entries.push([name, &ino.to_ne_bytes()[..]].concat().into_boxed_slice());
        }
        crate::prune::sort_names(&mut entries);
        Some(entries)
    }

    let (Some(src_entries), Some(dest_entries)) =
        (list(src, Some((&mut *root, &mut *rel))), list(dest, None))
    else {
        return false;
    };
    src_entries == dest_entries
        && src_entries.iter().all(|entry| {
            let (name, ino) = entry.split_at(entry.len() - INO_LEN);
            if ino != [0; INO_LEN] {
                return true;
            }
            let flags = sys::O::RDONLY | sys::O::CLOEXEC | sys::O::NOFOLLOW;
            match (
                src.open_at_with(name, flags),
                dest.open_at_with(name, flags),
            ) {
                (Ok(src), Ok(dest)) => {
                    let dir_len = rel.len();
                    rel.extend_from_slice(name);
                    rel.push(b'/');
                    let same = is_hardlinked_copy(root, rel, &src, &dest);
                    rel.truncate(dir_len);
                    same
                }
                _ => false,
            }
        })
}

pub(crate) fn is_linked_folder(src: &Dir, dest: &Dir) -> bool {
    let (Ok(dest_stat), Ok(src_stat)) = (sys::fstat(dest.fd()), sys::fstat(src.fd())) else {
        return false;
    };
    // Inode numbers are only comparable on the same device. If both are the same directory, `dest`
    // is a link to the folder, not a copy of it.
    dest_stat.st_dev == src_stat.st_dev
        && dest_stat.st_ino != src_stat.st_ino
        && is_hardlinked_copy(&mut FolderRoot(src, None), &mut Vec::new(), src, dest)
}

/// Real paths to compare a symlink's resolved target against. `top_level_dir` cannot be used for
/// this because it may contain symlinks itself.
struct RealPaths {
    folder: Box<[u8]>,
    project: Box<[u8]>,
}

/// The `RealPaths` of a `file:` folder. They are resolved when the first symlink is found, because
/// most folders have no symlinks.
struct FolderRoot<'a>(&'a Dir, Option<RealPaths>);

impl FolderRoot<'_> {
    fn get(&mut self) -> Option<&RealPaths> {
        if self.1.is_none() {
            let mut fd_path = path::path_buffer_pool::get();
            let mut real = path::path_buffer_pool::get();
            let fd_path = sys::get_fd_path_z(self.0.fd(), &mut fd_path).ok()?;
            let folder = sys::realpath(fd_path, &mut real).ok()?.into();
            let project = crate::lockfile_real::LinkedMembers::real_path_of(b".");
            if project.is_empty() {
                return None;
            }
            self.1 = Some(RealPaths { folder, project });
        }
        self.1.as_ref()
    }
}

/// Recreates the symlinks of `folder` in `dest`, its installed copy, because the install backends
/// skip them. Only call this for a folder that the user named. Returns a warning per omitted link.
pub(crate) fn lay_folder_links(folder: &[u8], dest: &Dir) -> Vec<Box<[u8]>> {
    let mut left_out: Vec<Box<[u8]>> = Vec::new();
    if let Ok(src) = Dir::open(folder) {
        let root = &mut FolderRoot(&src, None);
        lay_links_below(root, &mut Vec::new(), &src, dest, &mut left_out);
    }
    crate::prune::sort_names(&mut left_out);
    for link in &mut left_out {
        *link = [&b"skipping link "[..], folder, &b"/"[..], &link[..]]
            .concat()
            .into_boxed_slice();
    }
    left_out
}

/// `rel` is the path of `src` inside the folder. It is either empty or ends with a slash.
fn lay_links_below(
    root: &mut FolderRoot<'_>,
    rel: &mut Vec<u8>,
    src: &Dir,
    dest: &Dir,
    left_out: &mut Vec<Box<[u8]>>,
) {
    let flags = sys::O::RDONLY | sys::O::CLOEXEC | sys::O::NOFOLLOW;
    let dir_len = rel.len();
    let mut iter = sys::iterate_dir(src.fd());
    while let Ok(Some(entry)) = iter.next() {
        let name = entry.name.slice_u8();
        if name == b"node_modules" {
            continue;
        }
        rel.truncate(dir_len);
        rel.extend_from_slice(name);
        match crate::prune::entry_kind(src, name, entry.kind) {
            EntryKind::Directory => {
                if let (Ok(src), Ok(dest)) = (
                    src.open_at_with(name, flags),
                    dest.open_at_with(name, flags),
                ) {
                    rel.push(b'/');
                    lay_links_below(root, rel, &src, &dest, left_out);
                }
            }
            EntryKind::SymLink => {
                if let Some(root) = root.get()
                    && let Err(why) = lay_link(root, rel.as_slice(), dir_len, src, dest)
                {
                    let text = [rel.as_slice(), &b": "[..], why.as_bytes()];
                    left_out.push(text.concat().into_boxed_slice());
                }
            }
            _ => {}
        }
    }
    rel.truncate(dir_len);
}

/// Returns the part of `real` that follows the directory `root`, or `None` if `real` is not inside
/// `root`. Both must be real paths.
fn path_below<'a>(root: &[u8], real: &'a [u8]) -> Option<&'a [u8]> {
    real.strip_prefix(strings::without_trailing_slash(root))
        .filter(|rest| rest.first().is_none_or(|&c| c == path::SEP))
}

fn read_link(dir: &Dir, name: &[u8]) -> Option<Box<[u8]>> {
    let mut text = path::path_buffer_pool::get();
    let len = sys::readlinkat(dir, &bun_core::ZBox::from_bytes(name), &mut text[..]).ok()?;
    (len < text.len()).then(|| Box::from(&text[..len]))
}

/// What a symlink in a `file:` folder becomes in the installed copy. A symlink in the copy never
/// points outside the copy, and a file is only copied from the folder or the project.
enum FolderLink {
    /// A symlink with this target text.
    Link(Box<[u8]>),
    /// A hardlink to the file at this real path, or a copy of it.
    File(bun_core::ZBox, Box<sys::Stat>),
    LeftOut(&'static str),
}

impl FolderLink {
    /// Decides what the symlink at `rel` in the folder becomes in the copy. `src` is the symlink's
    /// parent directory, and `rel[dir_len..]` is its name there.
    fn of(paths: &RealPaths, rel: &[u8], dir_len: usize, src: &Dir) -> FolderLink {
        use path::resolve_path::{join_abs_string_buf_z_checked, platform};
        const NOWHERE: FolderLink = FolderLink::LeftOut("target does not exist");
        let root: &[u8] = &paths.folder;

        let mut link_buf = path::path_buffer_pool::get();
        let mut real_buf = path::path_buffer_pool::get();
        let Some(link) =
            join_abs_string_buf_z_checked::<platform::Auto>(root, &mut link_buf[..], &[rel])
        else {
            return NOWHERE;
        };
        let Ok(real) = sys::realpath(link, &mut real_buf) else {
            return NOWHERE;
        };
        let real_z = bun_core::ZBox::from_bytes(real);
        let Ok(target) = sys::stat(&real_z) else {
            return NOWHERE;
        };
        // The install backends skip `node_modules`, so a target inside one is not in the copy.
        let in_folder = path_below(root, real)
            .is_some_and(|rest| !strings::split(rest, b"/").any(|part| part == b"node_modules"));

        // A symlink is kept only if both its resolved target and its literal text stay in the
        // folder. The text alone is not enough, because it can pass through another symlink.
        if cfg!(not(windows))
            && in_folder
            && let Some(text) = read_link(src, &rel[dir_len..])
            && !path::is_absolute(&text)
            && !crate::bin::bin_target_escapes_package_dir(&[&rel[..dir_len], &text[..]].concat())
        {
            return FolderLink::Link(text);
        }
        if sys::kind_from_mode(target.st_mode as sys::Mode) != EntryKind::File {
            return FolderLink::LeftOut(if cfg!(windows) {
                "target is a directory"
            } else {
                "directory links must be relative and stay inside the folder"
            });
        }
        if !in_folder && path_below(&paths.project, real).is_none() {
            return FolderLink::LeftOut("target is outside the project");
        }
        FolderLink::File(real_z, Box::new(target))
    }
}

fn lay_link(
    root: &RealPaths,
    rel: &[u8],
    dir_len: usize,
    src: &Dir,
    dest: &Dir,
) -> Result<(), &'static str> {
    let name = &bun_core::ZBox::from_bytes(&rel[dir_len..]);
    let _ = dest.delete_tree(name.as_bytes());
    match FolderLink::of(root, rel, dir_len, src) {
        FolderLink::Link(text) => sys::symlinkat(&bun_core::ZBox::from_bytes(&text), dest, name)
            .map_err(|_| "failed to create link"),
        FolderLink::File(real, target) => {
            #[cfg(not(windows))]
            {
                if sys::linkat(Fd::cwd(), &real, dest, name).is_ok() {
                    return Ok(());
                }
            }
            #[cfg(windows)]
            {
                use path::resolve_path::{join_abs_string_buf_z_checked, platform};
                let mut dir_buf = path::path_buffer_pool::get();
                let mut to_buf = path::path_buffer_pool::get();
                if let Ok(dir) = dest.get_fd_path(&mut dir_buf)
                    && let Some(to) = join_abs_string_buf_z_checked::<platform::Auto>(
                        dir,
                        &mut to_buf[..],
                        &[name.as_bytes()],
                    )
                    && sys::sys_uv::link(&real, to).is_ok()
                {
                    return Ok(());
                }
            }
            sys::File::open(&real, sys::O::RDONLY | sys::O::CLOEXEC, 0)
                .and_then(|from| {
                    let to = dest.create_file_z(name, Default::default())?;
                    let _ = sys::fchmod(to.handle(), target.st_mode as sys::Mode);
                    sys::copy_file(from.handle(), to.handle())
                })
                .map_err(|_| "failed to copy target")
        }
        FolderLink::LeftOut(why) => Err(why),
    }
}

// macOS clonefileat(2) — routed through the safe `sys::clonefileat` wrapper
// (takes `Fd`/`&ZStr`, returns `Maybe<()>`). The wrapper preserves the errno
// via `Error::get_errno()` for the per-errno branching below.

// ───────────────────────────── NewTaskQueue ─────────────────────────────

#[cfg(windows)]
pub(crate) struct NewTaskQueue<TaskType> {
    pub(crate) thread_pool: &'static ThreadPool,
    /// One-shot, first-write-wins handoff of the failed task from a worker
    /// thread to the consumer that called `wait()`. A `Mutex<Option<Box<_>>>`
    /// makes ownership explicit (vs. the original `AtomicPtr`, which forced
    /// every reader to remember `Box::from_raw` and risked leaks/double-free).
    pub(crate) errored_task: bun_threading::Guarded<Option<Box<TaskType>>>,
    pub(crate) wait_group: WaitGroup,
}

#[cfg(windows)]
impl<TaskType> NewTaskQueue<TaskType> {
    pub(crate) fn complete_one(&self) {
        self.wait_group.finish();
    }

    /// # Safety
    /// `task` must point to a live, Box-allocated `TaskType` whose ownership is
    /// being handed to the thread pool; the worker reclaims it in its callback.
    pub(crate) unsafe fn push(&self, task: *mut TaskType)
    where
        TaskType: IntrusiveWorkTask,
    {
        self.wait_group.add_one();
        // SAFETY: caller contract; projecting through `task` keeps the allocation's provenance.
        self.thread_pool
            .schedule(Batch::from(unsafe { TaskType::field_of(task) }));
    }

    pub(crate) fn wait(&self) {
        self.wait_group.wait();
    }
}

// ───────────────────────────── HardLinkWindowsInstallTask ─────────────────────────────

#[cfg(windows)]
struct HardLinkWindowsInstallTask {
    /// Layout: `[src .. , 0, dest .. , 0]`. `src` and `dest` are reconstructed
    /// on demand from `src_len` instead of storing self-referential pointers
    /// (which would be invalidated when this `Box<[u16]>` is moved into `Self`
    /// and again whenever `&mut self` reasserts uniqueness over it).
    bytes: Box<[u16]>,
    src_len: usize,
    basename: u16,
    task: WorkPoolTask,
    err: Option<crate::Error>,
}

#[cfg(windows)]
bun_threading::intrusive_work_task!(HardLinkWindowsInstallTask, task);

#[cfg(windows)]
type HardLinkQueue = NewTaskQueue<HardLinkWindowsInstallTask>;

// PORTING.md §Global mutable state: written once on the main thread by
// `init_queue()` before any worker `run_from_thread_pool` reads it; workers
// only ever take `&HardLinkQueue` (all queue methods are `&self`).
#[cfg(windows)]
static HARDLINK_QUEUE: bun_core::RacyCell<core::mem::MaybeUninit<HardLinkQueue>> =
    bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());

#[cfg(windows)]
impl HardLinkWindowsInstallTask {
    fn init_queue() -> &'static HardLinkQueue {
        // SAFETY: called once per install batch on the install main thread before any
        // push(). Returns a shared ref so worker threads in run_from_thread_pool() may
        // safely alias it via HARDLINK_QUEUE.assume_init_ref(); all queue methods take
        // &self.
        //
        // `INITIALIZED` is *not* the cross-thread publication edge — it is read and
        // written only here, on the main thread, so `Relaxed` is sufficient. Workers
        // never observe HARDLINK_QUEUE until after `push()` → `ThreadPool::schedule()`,
        // whose internal Release/Acquire on the task queue is what publishes the
        // first-call `MaybeUninit::write` below.
        //
        // On re-init we only drain `errored_task` through its own mutex instead of
        // re-assigning the whole struct: `wait_group`'s counter is already 0 and
        // `thread_pool` points at the process-wide `PackageManager` singleton that
        // never changes, so a fresh write would be a no-op anyway.
        static INITIALIZED: core::sync::atomic::AtomicBool =
            core::sync::atomic::AtomicBool::new(false);
        unsafe {
            if INITIALIZED.swap(true, Ordering::Relaxed) {
                let q = (*HARDLINK_QUEUE.get()).assume_init_ref();
                *q.errored_task.lock() = None;
                debug_assert_eq!(
                    q.thread_pool as *const ThreadPool,
                    core::ptr::from_ref(&PackageManager::get().thread_pool),
                    "PackageManager singleton changed between install batches",
                );
            } else {
                (*HARDLINK_QUEUE.get()).write(HardLinkQueue {
                    thread_pool: &PackageManager::get().thread_pool,
                    errored_task: bun_threading::Guarded::new(None),
                    wait_group: WaitGroup::init(),
                });
            }
            (*HARDLINK_QUEUE.get()).assume_init_ref()
        }
    }

    fn init(src: &[OSPathChar], dest: &[OSPathChar], basename: &[OSPathChar]) -> *mut Self {
        let allocation_size = src.len() + 1 + dest.len() + 1;

        let mut combined = vec![0u16; allocation_size].into_boxed_slice();
        combined[..src.len()].copy_from_slice(src);
        combined[src.len()] = 0;
        let remaining = &mut combined[src.len() + 1..];
        remaining[..dest.len()].copy_from_slice(dest);
        remaining[dest.len()] = 0;

        bun_core::heap::into_raw(Box::new(Self {
            bytes: combined,
            src_len: src.len(),
            basename: basename.len() as u16, // @truncate
            task: WorkPoolTask {
                callback: Self::run_from_thread_pool,
                node: ThreadPoolNode::default(),
            },
            err: None,
        }))
    }

    fn run_from_thread_pool(task: *mut WorkPoolTask) {
        // SAFETY: `task` is the `task` field pointer `NewTaskQueue::push` scheduled.
        let self_: *mut Self = unsafe { Self::from_task_ptr(task) };
        // SAFETY: HARDLINK_QUEUE initialized by init_queue() before scheduling.
        let queue = unsafe { (*HARDLINK_QUEUE.get()).assume_init_ref() };
        scopeguard::defer! { queue.complete_one(); }

        // SAFETY: self_ is valid until we reclaim the Box below.
        if let Some(err) = unsafe { (*self_).run() } {
            unsafe { (*self_).err = Some(err) };
            // SAFETY: self_ was heap-allocated in init(); reclaim ownership now.
            let boxed = unsafe { bun_core::heap::take(self_) };
            // First-write-wins: keep only the first error. Any later failing task
            // simply drops its Box here (leaking it would also leak the inner
            // `Box<[u16]>` per failed file).
            let mut slot = queue.errored_task.lock();
            if slot.is_none() {
                *slot = Some(boxed);
            }
            return;
        }
        // SAFETY: self_ was heap-allocated in init().
        unsafe { drop(bun_core::heap::take(self_)) };
    }

    fn run(&mut self) -> Option<crate::Error> {
        use bun_sys::windows;
        // Read scalar fields before borrowing `bytes` so no `&mut self` reborrow
        // overlaps the slice borrows below.
        let src_len = self.src_len;
        let basename = usize::from(self.basename);
        // Disjoint borrows into the single backing buffer: `src` is read-only,
        // `dest` is mutated in place (temporary NUL for the dirpath).
        let (src, dest) = self.bytes.split_at_mut(src_len + 1);
        let src: &[u16] = &src[..src_len];
        let dest_len = dest.len() - 1;
        debug_assert_eq!(dest[dest_len], 0);

        // `windows::CreateHardLinkW` is the safe wrapper (logs + Option<&mut SA>).
        if windows::CreateHardLinkW(dest.as_ptr(), src.as_ptr(), None) != 0 {
            return None;
        }

        match windows::Win32Error::get() {
            windows::Win32Error::ALREADY_EXISTS
            | windows::Win32Error::FILE_EXISTS
            | windows::Win32Error::CANNOT_MAKE => {
                // Race condition: this shouldn't happen
                if cfg!(debug_assertions) {
                    bun_output::scoped_log!(
                        install,
                        "CreateHardLinkW returned EEXIST, this shouldn't happen: {}",
                        bun_core::fmt::fmt_path_u16(&dest[..dest_len], Default::default())
                    );
                }
                // SAFETY: FFI — dest is a valid NUL-terminated u16 buffer.
                unsafe { windows::DeleteFileW(dest.as_ptr()) };
                if windows::CreateHardLinkW(dest.as_ptr(), src.as_ptr(), None) != 0 {
                    return None;
                }
            }
            _ => {}
        }

        let dirpath_len = dest_len - basename - 1;
        dest[dirpath_len] = 0;
        let dirpath = bun_core::WStr::from_buf(dest, dirpath_len);
        let _ = mkdir_recursive_os_path(dirpath);
        dest[dirpath_len] = bun_paths::SEP_WINDOWS as u16;

        if windows::CreateHardLinkW(dest.as_ptr(), src.as_ptr(), None) != 0 {
            return None;
        }

        if PackageManager::verbose_install() {
            bun_core::run_once! {{
                bun_core::warn!(
                    "CreateHardLinkW failed, falling back to CopyFileW: {} -> {}\n",
                    bun_core::fmt::fmt_os_path(src, Default::default()),
                    bun_core::fmt::fmt_os_path(&dest[..dest_len], Default::default()),
                );
            }}
        }

        // SAFETY: FFI — src/dest are valid NUL-terminated u16 buffers.
        if unsafe { windows::CopyFileW(src.as_ptr(), dest.as_ptr(), 0) } != 0 {
            return None;
        }

        Some(windows::last_system_errno().into())
    }
}

// ───────────────────────────── UninstallTask ─────────────────────────────

fn wake_main_thread() {
    // SAFETY: the manager lives as long as the process. `wake_raw` is the documented
    // thread-safe wake path that never forms `&mut PackageManager` (the main thread
    // holds the install borrow).
    unsafe { PackageManager::wake_raw(crate::package_manager::get()) };
}

struct PendingTaskDone;

impl Drop for PendingTaskDone {
    fn drop(&mut self) {
        PackageManager::get()
            .pending_tasks
            .fetch_sub(1, Ordering::Release);
        wake_main_thread();
    }
}

struct UninstallTask {
    absolute_path: Box<[u8]>,
    task: WorkPoolTask,
}

impl UninstallTask {
    fn run(task: *mut WorkPoolTask) {
        // SAFETY: task points to the `task` field of an UninstallTask.
        let uninstall_task: *mut Self = unsafe { bun_core::from_field_ptr!(Self, task, task) };

        // declared *before* the Box is reclaimed so it drops *after* the
        // Box — Rust drops locals in reverse declaration order. The task must be freed
        // before the main thread can observe pending_tasks==0.
        let _done = PendingTaskDone;

        // SAFETY: heap-allocated in uninstall_before_install; reclaim ownership here.
        let uninstall_task = unsafe { bun_core::heap::take(uninstall_task) };

        let dirname =
            path::resolve_path::dirname::<path::platform::Auto>(&uninstall_task.absolute_path);
        if !dirname.is_empty()
            && let Ok(dir) = open_dir(Fd::cwd(), dirname)
        {
            let _ = dir.delete_tree(bun_paths::basename(&uninstall_task.absolute_path));
        }
    }
}

pub(crate) struct LinkJob {
    /// A package that is nested in two places has its dependencies, with the same ids, in two trees.
    pub(crate) tree_id: crate::lockfile::tree::Id,
    pub(crate) dependency_id: DependencyID,
    /// The `node_modules` to install into. The creator of the batch keeps it open.
    pub(crate) tree_dir: Fd,
    pub(crate) cache_dir: Fd,
    pub(crate) cache_dir_subpath: bun_core::ZBox,
    pub(crate) destination_dir_subpath: bun_core::ZBox,
    /// See `PackageInstaller::copy_trees`.
    pub(crate) copy: bool,
    pub(crate) skip_delete: bool,
    /// Generated on the main thread, because `fast_random` returns the same numbers on every
    /// thread.
    pub(crate) random: u64,
    pub(crate) resolution_tag: resolution::Tag,
    pub(crate) result: std::sync::OnceLock<InstallResult>,
}

/// Jobs that are linked in parallel. No destination equals or contains another one, and nothing
/// exists at any of them.
pub(crate) struct LinkBatch {
    pub(crate) jobs: Vec<LinkJob>,
    pub(crate) staging: Staging,
    pub(crate) next: AtomicUsize,
    /// The number of threads that are still running. The last one to finish wakes the main thread.
    pub(crate) remaining: AtomicUsize,
}

impl LinkBatch {
    fn link(&self, job: &LinkJob) {
        let method = if job.copy {
            Method::Copyfile
        } else {
            PackageInstall::supported_method()
        };
        // Move the old package aside right before linking, so it's only missing for as long as
        // linking takes.
        let tree_dir = Dir::borrow(&job.tree_dir);
        let old = if job.skip_delete {
            None
        } else {
            move_aside(tree_dir, &job.destination_dir_subpath, job.random)
        };
        let result = PackageFiles {
            cache_dir: job.cache_dir,
            cache_dir_subpath: &job.cache_dir_subpath,
            destination_dir_subpath: &job.destination_dir_subpath,
        }
        .install(
            self.staging,
            job.skip_delete,
            tree_dir,
            method,
            job.resolution_tag,
            None,
        );
        if let Some(old) = old {
            let _ = tree_dir.delete_tree(old.as_bytes());
        }
        let _ = job.result.set(result);
    }

    fn next_job(&self) -> Option<&LinkJob> {
        self.jobs.get(self.next.fetch_add(1, Ordering::Relaxed))
    }

    /// `run_tasks(until)` runs on this thread meanwhile; it is to return when `until` is 0.
    pub(crate) fn run(&self, run_tasks: &mut dyn FnMut(&AtomicUsize)) {
        // The kernel only lets one thread at a time modify a `node_modules` directory, so more
        // threads make it slower.
        const MAX_THREADS: usize = 8;

        if let [job] = self.jobs.as_slice() {
            return self.link(job);
        }
        let pool = &PackageManager::get().thread_pool;
        // If the OS can't start the pool's first worker, tasks scheduled on the pool would never
        // run.
        pool.warm(1);
        if !pool.has_workers() {
            return self.jobs.iter().for_each(|job| self.link(job));
        }
        let threads = MAX_THREADS.min(pool.max_threads()).min(self.jobs.len());
        self.remaining.store(threads, Ordering::Relaxed);
        pool.each_while(
            self,
            |batch, (), _| {
                while let Some(job) = batch.next_job() {
                    batch.link(job);
                }
                if batch.remaining.fetch_sub(1, Ordering::AcqRel) == 1 {
                    wake_main_thread();
                }
            },
            &mut vec![(); threads],
            || {
                // The threads spend much of their time waiting on the disk, so when there are only
                // a few of them, this thread links packages too.
                if self.jobs.len() > threads {
                    while let Some(job) = self.next_job() {
                        self.link(job);
                        run_tasks(&AtomicUsize::new(0));
                    }
                }
                run_tasks(&self.remaining);
            },
        );
    }
}

// ───────────────────────────── impl PackageInstall ─────────────────────────────

/// Contains a git package's commit or a tarball's integrity. Both linkers read it.
pub(crate) const BUN_TAG: &[u8] = b".bun-tag";

/// Returns true if an installed tarball's `.bun-tag` matches the integrity in bun.lock.
pub(crate) fn tarball_tag_matches(tag: &[u8], integrity: &Integrity, skips_verify: bool) -> bool {
    // A copy installed with `--no-verify` has an empty tag.
    strings::eql_long(integrity.sri(&mut [0; Integrity::MAX_SRI_LEN]), tag, true)
        || (skips_verify && tag.is_empty())
}

impl<'a> PackageInstall<'a> {
    fn verify_patch_hash(&mut self, patch: Patch, root_node_modules_dir: &Dir) -> bool {
        // hash from the .patch file, to be checked against bun tag
        let patchfile_contents_hash = patch.contents_hash;
        let mut buf: BuntagHashBuf = BuntagHashBuf::default();
        let bunhashtag = buntaghashbuf_make(&mut buf, patchfile_contents_hash);

        let patch_tag_path = path::resolve_path::join_z::<path::platform::Posix>(&[
            self.destination_dir_subpath.as_bytes(),
            bunhashtag,
        ]);

        let Ok(destination_dir) = self.node_modules.open_dir(root_node_modules_dir) else {
            return false;
        };
        #[cfg(unix)]
        {
            if sys::fstatat(&destination_dir, patch_tag_path).is_err() {
                return false;
            }
        }
        #[cfg(not(unix))]
        {
            match sys::openat(&destination_dir, patch_tag_path, sys::O::RDONLY, 0) {
                Err(_) => return false,
                Ok(fd) => fd.close(),
            }
        }

        true
    }

    // 1. verify that .bun-tag exists (was it installed from bun?)
    // 2. check .bun-tag against what bun.lock records: the commit, or a tarball's integrity
    fn verify_bun_tag(
        &mut self,
        matches: &dyn Fn(&[u8]) -> bool,
        root_node_modules_dir: &Dir,
    ) -> bool {
        let mut spill = Vec::new();
        let bun_tag_path = path::resolve_path::join_z_spill::<path::platform::Posix>(
            &mut spill,
            &[self.destination_dir_subpath.as_bytes(), BUN_TAG],
        );

        let Ok(bun_tag_file) = self
            .node_modules
            .read_small_file(root_node_modules_dir, bun_tag_path)
        else {
            return false;
        };
        matches(&bun_tag_file.bytes)
    }

    pub(crate) fn verify(
        &mut self,
        resolution: &Resolution,
        integrity: &Integrity,
        skips_verify: bool,
        root_node_modules_dir: &Dir,
    ) -> bool {
        let verified = match resolution.tag {
            resolution::Tag::Git | resolution::Tag::Github => {
                let lockfile = self.lockfile;
                let resolved = resolution
                    .repository()
                    .resolved
                    .slice(&lockfile.buffers.string_bytes);
                self.verify_bun_tag(
                    &|tag| strings::eql_long(resolved, tag, true),
                    root_node_modules_dir,
                )
            }
            resolution::Tag::LocalTarball | resolution::Tag::RemoteTarball => self.verify_bun_tag(
                &|tag| tarball_tag_matches(tag, integrity, skips_verify),
                root_node_modules_dir,
            ),
            resolution::Tag::Root => self.verify_directory_exists(root_node_modules_dir),
            resolution::Tag::Symlink | resolution::Tag::Workspace => {
                self.verify_link(root_node_modules_dir)
            }
            resolution::Tag::Folder => {
                let tree_id = self.node_modules.tree_id;
                if self.lockfile.is_workspace_tree_id(tree_id)
                    || self.lockfile.is_folder_tree_id(tree_id)
                {
                    self.verify_folder()
                } else {
                    // Inside an installed package, and replaced together with it.
                    self.verify_directory_exists(root_node_modules_dir)
                }
            }
            _ => self.verify_package_json_name_and_version(root_node_modules_dir),
        };

        verified
            && (self.patch).is_none_or(|patch| self.verify_patch_hash(patch, root_node_modules_dir))
    }

    // Only check for destination directory in node_modules. We can't use package.json because
    // it might not exist
    fn verify_directory_exists(&self, root_node_modules_dir: &Dir) -> bool {
        self.node_modules
            .directory_exists_at(root_node_modules_dir, self.destination_dir_subpath)
    }

    /// `node_modules/<alias>` leads to the directory `install_from_link` links it to.
    fn verify_link(&self, root_node_modules_dir: &Dir) -> bool {
        let Some(linked) = self
            .node_modules
            .stat(root_node_modules_dir, self.destination_dir_subpath)
        else {
            return false;
        };
        sys::fstatat(self.cache_dir, self.cache_dir_subpath)
            .is_ok_and(|target| target.st_ino == linked.st_ino && target.st_dev == linked.st_dev)
    }

    /// A folder's contents can change while its lockfile entry stays the same, so this compares the
    /// folder itself.
    fn verify_folder(&self) -> bool {
        let Ok(node_modules) = Dir::open(&self.node_modules.path) else {
            return false;
        };
        let (Ok(dest), Ok(src)) = (
            open_dir(node_modules.fd(), self.destination_dir_subpath),
            open_dir(self.cache_dir, self.cache_dir_subpath),
        ) else {
            return false;
        };
        is_linked_folder(&src, &dest)
    }

    fn get_installed_package_json_source(
        &mut self,
        root_node_modules_dir: &Dir,
        mutable: &mut MutableString,
        until_eof: bool,
    ) -> Option<bun_ast::Source> {
        let mut total: usize = 0;
        mutable.reset();
        mutable.expand_to_capacity();

        let mut spill = Vec::new();
        let package_json_path = path::resolve_path::join_z_spill::<path::platform::Posix>(
            &mut spill,
            &[self.destination_dir_subpath.as_bytes(), b"package.json"],
        );

        let package_json_file = self
            .node_modules
            .open_file(root_node_modules_dir, package_json_path)
            .ok()?;

        // Heuristic: most package.jsons will be less than 2048 bytes.
        loop {
            if mutable.list.len() - total < 1024 {
                mutable.grow_by(4096).ok()?;
                mutable.expand_to_capacity();
            }
            let remain = &mut mutable.list[total..];
            let read = package_json_file.read(remain).ok()?;
            total += read;
            if read == 0 || (!until_eof && read < remain.len()) {
                break;
            }
        }

        Some(bun_ast::Source::init_path_string(
            package_json_path.as_bytes(),
            &mutable.list[0..total],
        ))
    }

    fn verify_package_json_name_and_version(&mut self, root_node_modules_dir: &Dir) -> bool {
        // The first attempt treats a short read as the end of the file, which saves a `read` call.
        // A few file systems return short reads earlier and truncate the JSON, so retry until EOF.
        self.verify_installed_package_json(root_node_modules_dir, false)
            .or_else(|| self.verify_installed_package_json(root_node_modules_dir, true))
            .unwrap_or(false)
    }

    /// Returns `None` if the bytes that were read are not a complete JSON document.
    fn verify_installed_package_json(
        &mut self,
        root_node_modules_dir: &Dir,
        until_eof: bool,
    ) -> Option<bool> {
        let mut body_pool = Npm::Registry::BodyPool::get();
        let mutable: &mut MutableString = &mut body_pool;

        // Read the file
        // Return false on any error.
        // Don't keep it open while we're parsing the JSON.
        // The longer the file stays open, the more likely it causes issues for
        // other processes on Windows.
        let Some(source) =
            self.get_installed_package_json_source(root_node_modules_dir, mutable, until_eof)
        else {
            return Some(false);
        };
        let source = &source;

        // If it's not long enough to have {"name": "foo", "version": "1.2.0"}, there's no way it's valid
        let minimum = br#"{"name":"","version":""}"#.len()
            + self.package_name.len()
            + self.package_version.len();

        if source.contents().len() < minimum {
            return None;
        }

        let mut log = bun_ast::Log::init();

        initialize_store();

        let mut package_json_checker = bun_json::PackageJSONVersionChecker::init(source, &mut log);
        if package_json_checker.parse().is_err() || package_json_checker.has_errors() {
            return None;
        }
        if !package_json_checker.has_found_name || !package_json_checker.has_found_version {
            return Some(false);
        }

        let found_version = package_json_checker.found_version();

        // exclude build tags from comparsion
        // https://github.com/oven-sh/bun/issues/13563
        let found_version_end =
            strings::last_index_of_char(found_version, b'+').unwrap_or(found_version.len());
        let expected_version_end = strings::last_index_of_char(self.package_version, b'+')
            .unwrap_or(self.package_version.len());
        // Check if the version matches
        if found_version[..found_version_end] != self.package_version[..expected_version_end] {
            let offset = 'brk: {
                // ASCII only.
                for c in 0..found_version.len() {
                    match found_version[c] {
                        // newlines & whitespace
                        b' ' | b'\t' | b'\n' | b'\r'
                        | 0x0B /* VT */
                        | 0x0C /* FF */
                        // version separators
                        | b'v' | b'=' => {}
                        _ => break 'brk c,
                    }
                }
                // If we didn't find any of these characters, there's no point in checking the version again.
                // it will never match.
                return Some(false);
            };

            if found_version[offset..] != *self.package_version {
                return Some(false);
            }
        }

        // lastly, check the name.
        Some(
            package_json_checker.found_name()
                == self.package_name.slice(&self.lockfile.buffers.string_bytes),
        )
    }
}

impl PackageFiles<'_> {
    // ───────────────────────────── install backends ─────────────────────────────

    #[cfg(target_os = "macos")]
    fn install_with_clonefile_each_dir(
        &mut self,
        destination_dir: &Dir,
        skip_dirs: &[&OSPathSlice],
    ) -> crate::Result<InstallResult> {
        let cached_package_dir = match open_dir(self.cache_dir, self.cache_dir_subpath) {
            Ok(d) => d,
            Err(err) => return Ok(InstallResult::fail(err, Step::OpeningCacheDir)),
        };
        let mut walker_ = match walker_skippable::walk_owned(
            cached_package_dir,
            &[] as &[&OSPathSlice],
            skip_dirs,
        ) {
            Ok(w) => w,
            Err(err) => return Ok(InstallResult::fail(err.into(), Step::OpeningCacheDir)),
        };
        walker_.resolve_unknown_entry_types = true;

        fn copy(destination_dir_: &Dir, walker: &mut Walker) -> crate::Result<()> {
            let mut stackpath = [0u8; path::MAX_PATH_BYTES];
            while let Some(entry) = walker.next()? {
                match entry.kind {
                    EntryKind::Directory => {
                        // EEXIST: this is also the fallback for an existing destination.
                        match sys::mkdirat(destination_dir_, entry.path, 0o755) {
                            Err(e) if e.get_errno() != sys::Errno::EEXIST => return Err(e.into()),
                            _ => {}
                        }
                    }
                    EntryKind::File => {
                        let path_len = entry.path.len();
                        let base_len = entry.basename.len();
                        if path_len >= stackpath.len() {
                            return Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
                        }
                        stackpath[..path_len].copy_from_slice(entry.path.as_bytes());
                        stackpath[path_len] = 0;
                        // `stackpath[path_len] == 0` written above; both views are
                        // shared-only (used for `.as_ptr()` into FFI), so the
                        // overlapping borrows of `stackpath` are sound — replaces
                        // two raw `from_raw_mut` reconstructions over the same
                        // buffer (which were UB-adjacent as aliased `&mut`s).
                        let path_ = ZStr::from_buf(&stackpath, path_len);
                        let basename = ZStr::from_buf(&stackpath[path_len - base_len..], base_len);
                        let clone =
                            || sys::clonefileat(entry.dir, basename, destination_dir_.fd(), path_);
                        // The existing file may belong to a different version.
                        let cloned = match clone() {
                            Err(e) if e.get_errno() == sys::Errno::EEXIST => {
                                let _ = sys::unlinkat(destination_dir_, path_);
                                clone()
                            }
                            result => result,
                        };
                        match cloned {
                            Ok(()) => {}
                            // `get_errno` bounds-checks (SUCCESS for out-of-range errno) — avoids
                            // `from_raw`'s release-mode transmute on an unexpected value.
                            Err(e) => match e.get_errno() {
                                sys::Errno::EXDEV => return Err(crate::Error::NotSupported), // not same file system
                                sys::Errno::EOPNOTSUPP => {
                                    return Err(crate::Error::NotSupported);
                                }
                                sys::Errno::ENOENT => {
                                    return Err(crate::Error::Sys(bun_errno::SystemErrno::ENOENT));
                                }
                                // It's a directory, or another install created it again.
                                sys::Errno::EEXIST => {}
                                sys::Errno::EACCES => {
                                    return Err(crate::Error::Sys(bun_errno::SystemErrno::EACCES));
                                }
                                _ => return Err(crate::Error::Unexpected),
                            },
                        }
                    }
                    _ => {}
                }
            }

            Ok(())
        }

        let subdir = match make_open_real_dir(destination_dir, self.destination_dir_subpath) {
            Ok(d) => d,
            Err(err) => return Ok(InstallResult::fail(err.into(), Step::OpeningDestDir)),
        };
        match copy(&subdir, &mut walker_) {
            Ok(()) => Ok(InstallResult::Success),
            // `link_files_into` falls back to copyfile for this error.
            Err(crate::Error::NotSupported) => Err(crate::Error::NotSupported),
            Err(err) => Ok(InstallResult::fail(err, Step::CopyingFiles)),
        }
    }

    // https://www.unix.com/man-page/mojave/2/fclonefileat/
    #[cfg(target_os = "macos")]
    fn install_with_clonefile(&mut self, destination_dir: &Dir) -> crate::Result<InstallResult> {
        if self.destination_dir_subpath.as_bytes()[0] == b'@' {
            if let Some(slash) = strings::index_of_char_z(self.destination_dir_subpath, path::SEP) {
                let subdir = &self.destination_dir_subpath.as_bytes()[..slash as usize];
                let _ = destination_dir.make_dir(subdir);
            }
        }

        match sys::clonefileat(
            self.cache_dir,
            self.cache_dir_subpath,
            destination_dir.fd(),
            self.destination_dir_subpath,
        ) {
            Ok(()) => Ok(InstallResult::Success),
            Err(e) => match e.get_errno() {
                sys::Errno::EXDEV => Err(crate::Error::NotSupported), // not same file system
                sys::Errno::EOPNOTSUPP => Err(crate::Error::NotSupported),
                sys::Errno::ENOENT => Err(crate::Error::Sys(bun_errno::SystemErrno::ENOENT)),
                // We first try to delete the directory
                // But, this can happen if this package contains a node_modules folder
                // We want to continue installing as many packages as we can, so we shouldn't block while downloading
                // We use the slow path in this case
                sys::Errno::EEXIST => self.install_with_clonefile_each_dir(destination_dir, &[]),
                sys::Errno::EACCES => Err(crate::Error::Sys(bun_errno::SystemErrno::EACCES)),
                _ => Err(crate::Error::Unexpected),
            },
        }
    }

    fn init_install_dir(
        &mut self,
        destination_dir: &Dir,
        method: Method,
        skip_dirs: &[&OSPathSlice],
    ) -> Result<InstallDirState, Box<Failure>> {
        let destbase = destination_dir;
        let destpath = self.destination_dir_subpath;

        let cached_package_dir = match {
            #[cfg(windows)]
            {
                if method == Method::Symlink {
                    bun_sys::open_dir_no_renaming_or_deleting_windows(
                        self.cache_dir,
                        self.cache_dir_subpath.as_bytes(),
                    )
                    .map(Dir::from_fd)
                    .map_err(Into::into)
                } else {
                    open_dir(self.cache_dir, self.cache_dir_subpath)
                }
            }
            #[cfg(not(windows))]
            {
                let _ = method;
                open_dir(self.cache_dir, self.cache_dir_subpath)
            }
        } {
            Ok(d) => d,
            Err(err) => return Err(Failure::boxed(err, Step::OpeningCacheDir)),
        };

        let mut walker = bun_core::handle_oom(walker_skippable::walk_owned(
            cached_package_dir,
            &[] as &[&OSPathSlice],
            skip_dirs,
        ));
        walker.resolve_unknown_entry_types = true;

        #[cfg(not(windows))]
        {
            let subdir = match make_open_real_dir(destbase, destpath) {
                Ok(d) => d,
                Err(err) => return Err(Failure::boxed(err.into(), Step::OpeningDestDir)),
            };
            return Ok(InstallDirState { walker, subdir });
        }

        #[cfg(windows)]
        {
            use bun_sys::windows;

            let mut buf = bun_paths::w_path_buffer_pool::get();
            let mut buf2 = bun_paths::w_path_buffer_pool::get();

            // SAFETY: FFI — destbase.fd() is an open handle; buf is a valid writable
            // WPathBuffer of the passed length.
            let dest_path_length = unsafe {
                windows::GetFinalPathNameByHandleW(
                    destbase.fd().native(),
                    buf.as_mut_ptr(),
                    u32::try_from(buf.len()).expect("int cast"),
                    0,
                )
            } as usize;
            if dest_path_length == 0 || dest_path_length >= buf.len() {
                let err = crate::Error::Sys(if dest_path_length == 0 {
                    windows::last_system_errno()
                } else {
                    bun_errno::SystemErrno::ENAMETOOLONG
                });
                return Err(Failure::boxed(err, Step::OpeningDestDir));
            }

            let mut i: usize = dest_path_length;
            if buf[i] != u16::from(b'\\') {
                buf[i] = u16::from(b'\\');
                i += 1;
            }

            i += strings::to_wpath_normalized(&mut buf[i..], destpath.as_bytes()).len();
            buf[i] = bun_paths::SEP_WINDOWS as u16;
            i += 1;
            buf[i] = 0;
            let fullpath = bun_core::WStr::from_buf(&buf[..], i);

            if let Err(err) = sys::mkdir_w(fullpath) {
                // Like `make_open_real_dir`, replace a symlink at the destination, never follow it.
                if err.get_errno() == sys::E::EEXIST {
                    let mut narrow = bun_paths::path_buffer_pool::get();
                    let dest = strings::from_wpath(&mut narrow[..], &buf[..i - 1]);
                    if let Err(err) = crate::prune::remove_planted_link(destbase, dest) {
                        return Err(Failure::boxed(err.into(), Step::OpeningDestDir));
                    }
                }
                let _ = mkdir_recursive_os_path(fullpath);
            }
            let to_copy_buf_off = fullpath.len();

            // SAFETY: FFI — the walker's root is the open cache directory; buf2 is a
            // valid writable WPathBuffer of the passed length.
            let cache_path_length = unsafe {
                windows::GetFinalPathNameByHandleW(
                    walker.root().native(),
                    buf2.as_mut_ptr(),
                    u32::try_from(buf2.len()).expect("int cast"),
                    0,
                )
            } as usize;
            if cache_path_length == 0 || cache_path_length >= buf2.len() {
                let err = crate::Error::Sys(if cache_path_length == 0 {
                    windows::last_system_errno()
                } else {
                    bun_errno::SystemErrno::ENAMETOOLONG
                });
                return Err(Failure::boxed(err, Step::CopyingFiles));
            }
            // borrowck — index by `cache_path_length` directly so no shared borrow is live.
            let to_copy_buf2_off = if buf2[cache_path_length - 1] != u16::from(b'\\') {
                buf2[cache_path_length] = u16::from(b'\\');
                cache_path_length + 1
            } else {
                cache_path_length
            };
            Ok(InstallDirState {
                walker,
                subdir: Dir::from_fd(Fd::INVALID),
                buf,
                buf2,
                to_copy_buf_off,
                to_copy_buf2_off,
            })
        }
    }

    fn install_with_copyfile(
        &mut self,
        destination_dir: &Dir,
        skip_dirs: &[&OSPathSlice],
    ) -> InstallResult {
        let mut state = match self.init_install_dir(destination_dir, Method::Copyfile, skip_dirs) {
            Ok(state) => state,
            Err(failure) => return InstallResult::Failure(failure),
        };

        #[cold]
        fn copy_failed(err: crate::Error, path: &OSPathSlice, file: &mut Vec<u8>) -> crate::Error {
            use std::io::Write;
            write!(
                file,
                "{}",
                bun_core::fmt::fmt_os_path(path, Default::default())
            )
            .expect("infallible: in-memory write");
            err
        }
        let mut failed_file = Vec::new();

        #[cfg(not(windows))]
        fn copy(
            destination_dir_: &Dir,
            walker: &mut Walker,
            failed_file: &mut Vec<u8>,
        ) -> crate::Result<()> {
            let mut copy_file_state = bun_sys::copy_file::CopyFileState::default();

            while let Some(entry) = walker.next()? {
                if entry.kind != EntryKind::File {
                    continue;
                }

                let in_file = sys::openat(entry.dir, entry.basename, sys::O::RDONLY, 0)?;
                let _close_in = sys::CloseOnDrop::new(in_file);

                bun_output::scoped_log!(
                    install,
                    "createFile {} {}\n",
                    destination_dir_.fd(),
                    bstr::BStr::new(entry.path.as_bytes())
                );
                // The file can be a hardlink of `in_file`, and O_TRUNC would empty both.
                let create = |path: &ZStr| {
                    let open = || {
                        sys::openat(
                            destination_dir_.fd(),
                            path,
                            sys::O::WRONLY | sys::O::CREAT | sys::O::EXCL,
                            0o666,
                        )
                    };
                    match open() {
                        Err(err) if err.get_errno() == sys::E::EEXIST => {
                            let _ = sys::unlinkat(destination_dir_, path);
                            open()
                        }
                        result => result,
                    }
                };
                let outfile = match create(entry.path) {
                    Ok(f) => f,
                    Err(_) => {
                        let entry_dirname = bun_paths::resolve_path::dirname::<
                            bun_paths::platform::Auto,
                        >(entry.path.as_bytes());
                        if !entry_dirname.is_empty() {
                            let _ = bun_sys::MakePath::make_path::<OSPathChar>(
                                destination_dir_,
                                entry_dirname,
                            );
                        }
                        create(entry.path).map_err(|err| {
                            copy_failed(err.into(), entry.path.as_bytes(), failed_file)
                        })?
                    }
                };
                let _close_out = sys::CloseOnDrop::new(outfile);

                let stat = sys::fstat(in_file)?;
                // Best effort: filesystems without permission bits reject fchmod.
                let _ = sys::fchmod(outfile, stat.st_mode as bun_sys::Mode);

                bun_sys::copy_file::copy_file_with_state(in_file, outfile, &mut copy_file_state)
                    .map_err(|err| copy_failed(err.into(), entry.path.as_bytes(), failed_file))?;
            }

            Ok(())
        }

        #[cfg(windows)]
        let result = walk_install_dir_windows(&mut state, &mut |dest, src, entry_path| {
            use bun_sys::windows;
            // `dest` can be a hardlink of `src`, which CopyFileW cannot overwrite.
            // SAFETY: FFI — src/dest are valid NUL-terminated WStr buffers.
            let copy_file = || unsafe { windows::CopyFileW(src.as_ptr(), dest.as_ptr(), 1) } != 0;
            if copy_file() {
                return Ok(());
            }
            if matches!(
                windows::Win32Error::get(),
                windows::Win32Error::FILE_EXISTS | windows::Win32Error::ALREADY_EXISTS
            ) {
                // SAFETY: FFI — dest is a valid NUL-terminated WStr buffer.
                unsafe { windows::DeleteFileW(dest.as_ptr()) };
                if copy_file() {
                    return Ok(());
                }
            }
            Err(copy_failed(
                windows::last_system_errno().into(),
                entry_path,
                &mut failed_file,
            ))
        });
        #[cfg(not(windows))]
        let result = copy(&state.subdir, &mut state.walker, &mut failed_file);

        if let Err(err) = result {
            let mut failure = Failure::boxed(err, Step::CopyingFiles);
            failure.file = failed_file;
            return InstallResult::Failure(failure);
        }

        InstallResult::Success
    }

    fn install_with_hardlink(
        &mut self,
        dest_dir: &Dir,
        skip_dirs: &[&OSPathSlice],
    ) -> crate::Result<InstallResult> {
        let mut state = match self.init_install_dir(dest_dir, Method::Hardlink, skip_dirs) {
            Ok(state) => state,
            Err(failure) => return Ok(InstallResult::Failure(failure)),
        };

        #[cfg(windows)]
        type WinSlice<'b> = &'b mut [u16];
        #[cfg(not(windows))]
        type WinSlice<'b> = ();
        #[cfg(windows)]
        type WinOffset = usize;
        #[cfg(not(windows))]
        type WinOffset = ();

        // Two overlapping slices into the same buffer (`head` is the whole
        // buffer, `to_copy_into` is its tail) would be two live aliasing
        // `&mut [u16]`, which is UB — pass head buffer + tail offset and
        // reslice inside.
        fn copy(
            destination_dir: &Dir,
            walker: &mut Walker,
            to_copy_into1_offset: WinOffset,
            head1: WinSlice<'_>,
            to_copy_into2_offset: WinOffset,
            head2: WinSlice<'_>,
        ) -> crate::Result<()> {
            #[cfg(not(windows))]
            let _ = (to_copy_into1_offset, head1, to_copy_into2_offset, head2);
            #[cfg(windows)]
            let _ = destination_dir;
            #[cfg(windows)]
            let queue = HardLinkWindowsInstallTask::init_queue();
            // Workers are already running the tasks that were pushed, so remember any loop error
            // and always reach `queue.wait()`.
            #[cfg(windows)]
            let mut loop_err: Option<crate::Error> = None;

            loop {
                let entry = match walker.next() {
                    Ok(Some(e)) => e,
                    Ok(None) => break,
                    #[cfg(not(windows))]
                    Err(e) => return Err(e.into()),
                    #[cfg(windows)]
                    Err(e) => {
                        loop_err = Some(e.into());
                        break;
                    }
                };
                #[cfg(unix)]
                {
                    match entry.kind {
                        EntryKind::Directory => {
                            bun_sys::MakePath::make_path::<OSPathChar>(
                                destination_dir,
                                entry.path.as_bytes(),
                            )?;
                        }
                        EntryKind::File => {
                            // EACCES/EPERM: FUSE (e.g. Android SDCARD) does not support hardlinks
                            fn map_linkat_err(err: sys::Error) -> crate::Error {
                                match err.get_errno() {
                                    sys::E::EXDEV | sys::E::EACCES | sys::E::EPERM => {
                                        crate::Error::NotSameFileSystem
                                    }
                                    _ => err.into(),
                                }
                            }

                            if let Err(err) = sys::linkat(
                                entry.dir,
                                entry.basename,
                                destination_dir.fd(),
                                entry.path,
                            ) {
                                if err.get_errno() == sys::E::EEXIST {
                                    let _ = sys::unlinkat(destination_dir, entry.path);
                                    sys::linkat(
                                        entry.dir,
                                        entry.basename,
                                        destination_dir.fd(),
                                        entry.path,
                                    )
                                    .map_err(map_linkat_err)?;
                                } else {
                                    return Err(map_linkat_err(err));
                                }
                            }
                        }
                        _ => {}
                    }
                }
                #[cfg(not(unix))]
                {
                    match entry.kind {
                        EntryKind::File => {}
                        _ => continue,
                    }

                    // One unit of each buffer is reserved for the NUL terminator.
                    if entry.path.len() >= head1.len() - to_copy_into1_offset
                        || entry.path.len() >= head2.len() - to_copy_into2_offset
                    {
                        loop_err = Some(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
                        break;
                    }

                    let dest_len = to_copy_into1_offset + entry.path.len();
                    head1[to_copy_into1_offset..dest_len].copy_from_slice(entry.path.as_slice());
                    head1[dest_len] = 0;
                    let dest = bun_core::WStr::from_buf(head1, dest_len);

                    let src_len = to_copy_into2_offset + entry.path.len();
                    head2[to_copy_into2_offset..src_len].copy_from_slice(entry.path.as_slice());
                    head2[src_len] = 0;
                    let src = bun_core::WStr::from_buf(head2, src_len);

                    // SAFETY: `init` returns a fresh Box-allocated task; ownership
                    // transfers to the thread pool, reclaimed in `run_from_thread_pool`.
                    unsafe {
                        queue.push(HardLinkWindowsInstallTask::init(
                            src.as_slice(),
                            dest.as_slice(),
                            entry.basename.as_slice(),
                        ));
                    }
                }
            }

            #[cfg(windows)]
            {
                queue.wait();

                if let Some(err) = loop_err {
                    return Err(err);
                }

                // No tasks are running after `wait()`, so `.take()` is uncontended.
                if let Some(task) = queue.errored_task.lock().take() {
                    if let Some(err) = task.err {
                        return Err(err);
                    }
                }
            }

            Ok(())
        }

        #[cfg(windows)]
        let result = copy(
            &state.subdir,
            &mut state.walker,
            state.to_copy_buf_off,
            &mut state.buf[..],
            state.to_copy_buf2_off,
            &mut state.buf2[..],
        );
        #[cfg(not(windows))]
        let result = copy(&state.subdir, &mut state.walker, (), (), (), ());

        match result {
            Ok(()) => Ok(InstallResult::Success),
            // `link_files_into` falls back to copyfile for this error.
            #[cfg(not(windows))]
            Err(err @ crate::Error::NotSameFileSystem) => Err(err),
            Err(err) => Ok(InstallResult::fail(err, Step::CopyingFiles)),
        }
    }

    fn install_with_symlink(
        &mut self,
        dest_dir: &Dir,
        skip_dirs: &[&OSPathSlice],
    ) -> crate::Result<InstallResult> {
        let mut state = match self.init_install_dir(dest_dir, Method::Symlink, skip_dirs) {
            Ok(state) => state,
            Err(failure) => return Ok(InstallResult::Failure(failure)),
        };

        // `head2[..to_copy_into2_offset]` is the source directory, with a trailing separator.
        #[cfg(not(windows))]
        fn copy(
            destination_dir: &Dir,
            walker: &mut Walker,
            to_copy_into2_offset: usize,
            head2: &mut [u8],
        ) -> crate::Result<()> {
            while let Some(entry) = walker.next()? {
                match entry.kind {
                    EntryKind::Directory => {
                        bun_sys::MakePath::make_path::<OSPathChar>(
                            destination_dir,
                            entry.path.as_bytes(),
                        )?;
                    }
                    EntryKind::File => {
                        // One byte is reserved for the NUL terminator.
                        if entry.path.len() >= head2.len() - to_copy_into2_offset {
                            return Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
                        }
                        let target_len = to_copy_into2_offset + entry.path.len();
                        head2[to_copy_into2_offset..target_len]
                            .copy_from_slice(entry.path.as_bytes());
                        head2[target_len] = 0;
                        let target = ZStr::from_buf(head2, target_len);

                        if let Err(err) = sys::symlinkat(target, destination_dir.fd(), entry.path) {
                            if err.get_errno() != sys::E::EEXIST {
                                return Err(err.into());
                            }

                            let _ = sys::unlinkat(destination_dir, entry.path);
                            sys::symlinkat(target, destination_dir.fd(), entry.path)?;
                        }
                    }
                    _ => {}
                }
            }

            Ok(())
        }

        #[cfg(windows)]
        let result = walk_install_dir_windows(&mut state, &mut |dest, src, _| {
            let link = || sys::symlink_w(dest, src, Default::default());
            match link() {
                Err(err) if err.get_errno() == sys::E::EEXIST => {
                    let _ = sys::unlink_w(dest);
                    link()?;
                }
                result => {
                    result?;
                }
            }
            Ok(())
        });
        #[cfg(not(windows))]
        let result = {
            let mut buf2 = bun_paths::path_buffer_pool::get();
            let cache_len = sys::get_fd_path(state.walker.root(), &mut buf2)?.len();
            let to_copy_buf2_offset = if cache_len > 0 && buf2[cache_len - 1] != path::SEP {
                if cache_len + 1 >= buf2.len() {
                    return Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
                }
                buf2[cache_len] = path::SEP;
                cache_len + 1
            } else {
                cache_len
            };
            copy(
                &state.subdir,
                &mut state.walker,
                to_copy_buf2_offset,
                &mut buf2[..],
            )
        };

        Ok(match result {
            Ok(()) => InstallResult::Success,
            Err(err) => InstallResult::fail(err, Step::CopyingFiles),
        })
    }
}

/// The prefix of the names that `move_aside` creates. If Bun is killed, these folders stay until
/// `bun prune`.
pub(crate) const MOVED_ASIDE_PREFIX: &str = ".old-";

/// Renames `subpath`, if it exists, to a name in `destination_dir` that's derived from `random`.
/// Can run on any thread.
pub(crate) fn move_aside(
    destination_dir: &Dir,
    subpath: &ZStr,
    random: u64,
) -> Option<bun_core::ZBox> {
    let old = bun_core::ZBox::from_vec(
        format!(
            "{MOVED_ASIDE_PREFIX}{}",
            bun_core::fmt::hex_upper(&random.to_ne_bytes())
        )
        .into_bytes(),
    );
    match sys::renameat(destination_dir.fd(), subpath, destination_dir.fd(), &old) {
        Ok(()) => Some(old),
        // overlayfs can't rename a directory from a lower layer. Delete it instead, so the new
        // files don't mix with the old ones.
        Err(err) if err.get_errno() == sys::E::EXDEV => {
            let _ = destination_dir.delete_tree(subpath.as_bytes());
            None
        }
        // Either it doesn't exist or it has to stay. For example, the contents of a mount point
        // (EBUSY) aren't Bun's to delete.
        Err(_) => None,
    }
}

impl<'a> PackageInstall<'a> {
    pub(crate) fn uninstall_before_install(&self, destination_dir: &Dir) {
        let Some(temp_path) = move_aside(
            destination_dir,
            self.destination_dir_subpath,
            bun_core::fast_random(),
        ) else {
            return;
        };
        // If the OS can't start the pool's first worker, tasks scheduled on the pool would never
        // run.
        let pool = &PackageManager::get().thread_pool;
        pool.warm(1);
        if !pool.has_workers() {
            let _ = destination_dir.delete_tree(temp_path.as_bytes());
            return;
        }
        // Deleting a large tree takes a while. Now that it has a random name, another thread can
        // delete it.
        let absolute_path = path::resolve_path::join_abs_string::<path::platform::Auto>(
            bun_fs::FileSystem::instance().top_level_dir(),
            &[&self.node_modules.path, temp_path.as_bytes()],
        );
        let task = bun_core::heap::into_raw(Box::new(UninstallTask {
            absolute_path: absolute_path.to_vec().into_boxed_slice(),
            task: WorkPoolTask {
                callback: UninstallTask::run,
                node: ThreadPoolNode::default(),
            },
        }));
        let pm = crate::package_manager::get();
        // SAFETY: `uninstall_before_install` runs on the install main thread.
        // Raw-pointer field projection avoids forming `&mut PackageManager`
        // (the caller `PackageInstaller` already holds one); `total_tasks` is
        // main-thread-only state, `pending_tasks` is atomic. Mirrors
        // `increment_pending_tasks`.
        unsafe {
            *core::ptr::addr_of_mut!((*pm).total_tasks) += 1;
            (*pm).pending_tasks.fetch_add(1, Ordering::Relaxed);
        }
        // SAFETY: task is a valid heap allocation; .task is the intrusive node.
        pool.schedule(Batch::from(unsafe {
            core::ptr::addr_of_mut!((*task).task)
        }));
    }

    fn is_dangling_symlink(path: &ZStr) -> bool {
        #[cfg(windows)]
        let opened = sys::sys_uv::open(path, 0, 0);
        #[cfg(not(windows))]
        let opened = sys::open(path, sys::O::PATH, 0);
        opened.map(|fd| fd.close()).is_err()
    }

    pub(crate) fn install_from_link(
        &mut self,
        skip_delete: bool,
        destination_dir: &Dir,
    ) -> InstallResult {
        let dest_path = self.destination_dir_subpath;
        // If this fails, we don't care.
        // we'll catch it the next error
        if !skip_delete && dest_path.as_bytes() != b"." {
            self.uninstall_before_install(destination_dir);
        }

        // `None` when there is no directory component.
        let dirname_slice =
            path::resolve_path::dirname::<path::platform::Auto>(dest_path.as_bytes());
        let subdir: Option<&[u8]> = (!dirname_slice.is_empty()
            && dirname_slice != dest_path.as_bytes())
        .then_some(dirname_slice);

        let mut dest_buf = bun_paths::path_buffer_pool::get();
        // cache_dir_subpath in here is actually the full path to the symlink pointing to the linked package
        let symlinked_path = self.cache_dir_subpath;
        let mut to_buf = bun_paths::path_buffer_pool::get();
        // Open the target relative to cache_dir, then resolve its canonical path.
        // Returning a borrow of `to_buf` from an `FnMut` closure is rejected by
        // borrowck, so inline the open/getFdPath/close.
        // `bun_sys::Error::into()` would yield raw errno tags (`ENOENT`/`EACCES`),
        // so map the openat errno to the named error tag to preserve the
        // user-visible error tag
        // (test/cli/install/bun-link.test.ts asserts on `FileNotFound:`).
        let realpath_err = |e: bun_sys::Error| -> crate::Error {
            use sys::E;
            match e.get_errno() {
                E::ENOENT => crate::Error::FileNotFound,
                E::EACCES => crate::Error::AccessDenied,
                E::ENOTDIR => crate::Error::NotDir,
                E::ENAMETOOLONG => crate::Error::NameTooLong,
                E::ELOOP => crate::Error::SymLinkLoop,
                E::ENOMEM => crate::Error::SystemResources,
                _ => e.into(),
            }
        };
        let to_path: &[u8] = {
            // `symlinked_path` is always a package *directory*; `O::DIRECTORY`
            // routes to `open_dir_at_windows_nt_path`, then `get_fd_path`
            // resolves via `GetFinalPathNameByHandleW`.
            let fd = match sys::openat(
                self.cache_dir,
                symlinked_path,
                sys::O::RDONLY | sys::O::DIRECTORY,
                0,
            ) {
                Ok(fd) => fd,
                Err(err) => {
                    return InstallResult::fail(realpath_err(err), Step::LinkingDependency);
                }
            };
            let res = sys::get_fd_path(fd, &mut to_buf);
            fd.close();
            match res {
                Ok(s) => &*s,
                Err(err) => {
                    return InstallResult::fail(realpath_err(err), Step::LinkingDependency);
                }
            }
        };
        // The entry name is the NUL-terminated tail of `dest_path`.
        let dest: &ZStr = ZStr::from_slice_with_nul(
            &dest_path.as_bytes_with_nul()[subdir.map_or(0, |dir| dir.len() + 1)..],
        );
        debug_assert_eq!(dest.as_bytes(), bun_paths::basename(dest_path.as_bytes()));
        // When we're linking on Windows, we want to avoid keeping the source directory handle open
        #[cfg(windows)]
        {
            use bun_sys::windows;
            let mut wbuf = bun_paths::w_path_buffer_pool::get();
            // SAFETY: FFI — destination_dir.fd() is an open handle; wbuf is a valid writable
            // WPathBuffer of the passed length.
            let dest_path_length = unsafe {
                windows::GetFinalPathNameByHandleW(
                    destination_dir.fd().native(),
                    wbuf.as_mut_ptr(),
                    u32::try_from(wbuf.len()).expect("int cast"),
                    0,
                )
            } as usize;
            if dest_path_length == 0 || dest_path_length >= wbuf.len() {
                let err = crate::Error::Sys(if dest_path_length == 0 {
                    windows::last_system_errno()
                } else {
                    bun_errno::SystemErrno::ENAMETOOLONG
                });
                return InstallResult::fail(err, Step::LinkingDependency);
            }

            let mut i: usize = dest_path_length;
            if wbuf[i] != u16::from(b'\\') {
                wbuf[i] = u16::from(b'\\');
                i += 1;
            }

            if let Some(dir) = subdir {
                i += strings::to_wpath_normalized(&mut wbuf[i..], dir).len();
                wbuf[i] = bun_paths::SEP_WINDOWS as u16;
                i += 1;
                wbuf[i] = 0;
                // SAFETY: NUL written at [i].
                let fullpath = bun_core::WStr::from_buf(&wbuf[..], i);

                let _ = mkdir_recursive_os_path(fullpath);
            }

            let res = strings::copy_utf16_into_utf8(&mut dest_buf[..], &wbuf[..i]);
            let mut offset: usize = res.written;
            if dest_buf[offset - 1] != bun_paths::SEP_WINDOWS {
                dest_buf[offset] = bun_paths::SEP_WINDOWS;
                offset += 1;
            }
            if offset + dest.len() >= dest_buf.len() {
                return InstallResult::fail(
                    crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG),
                    Step::LinkingDependency,
                );
            }
            dest_buf[offset..offset + dest.len()].copy_from_slice(dest.as_bytes());
            offset += dest.len();
            dest_buf[offset] = 0;

            // SAFETY: NUL written at [offset].
            let dest_z = ZStr::from_buf(&dest_buf, offset);

            let to_len = to_path.len();
            to_buf[to_len] = 0;
            // SAFETY: NUL written at [to_len].
            let target_z = ZStr::from_buf(&to_buf, to_len);

            // https://github.com/npm/cli/blob/162c82e845d410ede643466f9f8af78a312296cc/workspaces/arborist/lib/arborist/reify.js#L738
            // https://github.com/npm/cli/commit/0e58e6f6b8f0cd62294642a502c17561aaf46553
            match sys::symlink_or_junction(dest_z, target_z, None) {
                Err(err_) => 'brk: {
                    let mut err = err_;
                    if err.get_errno() == sys::E::EEXIST {
                        let _ = sys::rmdirat(destination_dir.fd(), self.destination_dir_subpath);
                        match sys::symlink_or_junction(dest_z, target_z, None) {
                            Err(e) => err = e,
                            Ok(_) => break 'brk,
                        }
                    }

                    return InstallResult::fail(
                        bun_errno::from_errno(err.errno.into()).into(),
                        Step::LinkingDependency,
                    );
                }
                Ok(_) => {}
            }
        }
        #[cfg(not(windows))]
        {
            let owned_dest_dir: Option<Dir> = if let Some(dir) = subdir {
                Some(
                    match bun_sys::MakePath::make_open_path(
                        destination_dir,
                        dir,
                        OpenDirOptions::default(),
                    ) {
                        Ok(d) => d,
                        Err(err) => {
                            return InstallResult::fail(err.into(), Step::LinkingDependency);
                        }
                    },
                )
            } else {
                None
            };
            let dest_dir: &Dir = owned_dest_dir.as_ref().unwrap_or(destination_dir);

            let dest_dir_path = match sys::get_fd_path(dest_dir.fd(), &mut dest_buf) {
                Ok(p) => p,
                Err(err) => return InstallResult::fail(err.into(), Step::LinkingDependency),
            };

            let mut target_buf = bun_paths::path_buffer_pool::get();
            let target = path::resolve_path::relative_buf_z(
                target_buf.as_mut_slice(),
                dest_dir_path,
                to_path,
            );
            if let Err(err) = sys::symlinkat(target, dest_dir.fd(), dest).or_else(|err| {
                // A workspace's own node_modules outlives a wiped root node_modules.
                if err.get_errno() != sys::E::EEXIST {
                    return Err(err);
                }
                let _ = sys::unlinkat(dest_dir.fd(), dest);
                sys::symlinkat(target, dest_dir.fd(), dest)
            }) {
                return InstallResult::fail(err.into(), Step::LinkingDependency);
            }
        }

        if Self::is_dangling_symlink(symlinked_path) {
            return InstallResult::fail(crate::Error::DanglingSymlink, Step::LinkingDependency);
        }

        InstallResult::Success
    }

    pub(crate) fn get_install_method(&self) -> Method {
        if self.cache_dir_subpath.as_bytes() == b"." {
            Method::Symlink
        } else {
            Self::supported_method()
        }
    }

    pub(crate) fn package_missing_from_cache(
        &mut self,
        manager: &mut PackageManager,
        package_id: PackageID,
        resolution_tag: resolution::Tag,
    ) -> bool {
        match manager.get_preinstall_state(package_id) {
            // A tarball has no cache entry name until extraction records its integrity.
            _ if self.cache_dir_subpath.is_empty() => true,
            crate::PreinstallState::Done => false,
            _ => {
                let non_patched;
                let entry: &ZStr = if self.patch.is_none() {
                    self.cache_dir_subpath
                } else {
                    let idx =
                        strings::last_index_of(self.cache_dir_subpath.as_bytes(), b"_patch_hash=")
                            .unwrap_or_else(|| {
                                panic!("Patched dependency cache dir subpath does not have the \"_patch_hash=HASH\" suffix. This is a bug, please file a GitHub issue.")
                            });
                    non_patched =
                        bun_core::ZBox::from_bytes(&self.cache_dir_subpath.as_bytes()[..idx]);
                    &non_patched
                };
                let exists = crate::package_manager::directories::is_package_in_cache_at(
                    self.cache_dir,
                    entry,
                    resolution_tag,
                );
                if exists {
                    manager.set_preinstall_state(package_id, crate::PreinstallState::Done);
                }
                !exists
            }
        }
    }

    pub(crate) fn patched_package_missing_from_cache(
        &mut self,
        manager: &mut PackageManager,
        package_id: PackageID,
    ) -> bool {
        let exists =
            sys::directory_exists_at(self.cache_dir, self.cache_dir_subpath).unwrap_or(false);
        if exists {
            manager.set_preinstall_state(package_id, crate::PreinstallState::Done);
        }
        !exists
    }

    pub(crate) fn install(
        &mut self,
        staging_mode: Staging,
        skip_delete: bool,
        destination_dir: &Dir,
        method_: Method,
        resolution_tag: resolution::Tag,
    ) -> InstallResult {
        // If this fails, we don't care.
        // we'll catch it the next error
        if !skip_delete && self.destination_dir_subpath.as_bytes() != b"." {
            self.uninstall_before_install(destination_dir);
        }

        PackageFiles {
            cache_dir: self.cache_dir,
            cache_dir_subpath: self.cache_dir_subpath,
            destination_dir_subpath: self.destination_dir_subpath,
        }
        .install(
            staging_mode,
            skip_delete,
            destination_dir,
            method_,
            resolution_tag,
            Some(&*self),
        )
        .report()
    }

    /// See `Lockfile::bundled_by_folder`. Relative links: a staging directory is renamed.
    #[cold]
    fn link_bundled_into(&self, destination_dir: &Dir) {
        let lockfile = self.lockfile;
        let mut src_buf = path::path_buffer_pool::get();
        let mut dest_buf = path::path_buffer_pool::get();
        for bundled in lockfile.bundled_by_folder(self.cache_dir_subpath.as_bytes()) {
            let name = bstr::BStr::new(bundled.name.slice(&lockfile.buffers.string_bytes));
            if let (Ok(src), Ok(dest)) = (
                bun_core::fmt::buf_print_z(
                    &mut src_buf[..],
                    format_args!(
                        "{}/node_modules/{}",
                        bstr::BStr::new(self.cache_dir_subpath.as_bytes()),
                        name
                    ),
                ),
                bun_core::fmt::buf_print_z(
                    &mut dest_buf[..],
                    format_args!(
                        "{}/node_modules/{}",
                        bstr::BStr::new(self.destination_dir_subpath.as_bytes()),
                        name
                    ),
                ),
            ) {
                // Ignore the error if the folder doesn't have it, like for a tarball that's missing
                // one of its bundled dependencies.
                let _ = PackageInstall {
                    cache_dir_subpath: src,
                    destination_dir_subpath: dest,
                    ..*self
                }
                .install_from_link(true, destination_dir);
            }
        }
    }
}

impl PackageFiles<'_> {
    /// Creates an empty `staging` folder. With `Staging::Locked`, an install that was killed may
    /// have left one behind.
    fn make_staging_dir(
        destination_dir: &Dir,
        staging: &ZStr,
        method: Method,
        skip_delete: bool,
    ) -> sys::Maybe<()> {
        // `init_install_dir` creates it, and no other install uses this name.
        if cfg!(windows) {
            return Ok(());
        }
        // clonefile has to make it itself.
        if cfg!(target_os = "macos") && method == Method::Clonefile {
            if !skip_delete {
                destination_dir.delete_tree(staging.as_bytes())?;
            }
            return Ok(());
        }
        match sys::mkdirat(destination_dir, staging, 0o755) {
            Err(err) if err.get_errno() == sys::E::EEXIST => {
                destination_dir.delete_tree(staging.as_bytes())?;
            }
            Err(err) if err.get_errno() == sys::E::ENOENT => {
                let Some(slash) = strings::last_index_of_char(staging.as_bytes(), b'/') else {
                    return Err(err);
                };
                destination_dir.make_path(&staging.as_bytes()[..slash])?;
            }
            result => return result,
        }
        sys::mkdirat(destination_dir, staging, 0o755)
    }

    /// `owner` provides the lockfile. It's `None` on a thread pool thread.
    pub(crate) fn install(
        &mut self,
        staging_mode: Staging,
        skip_delete: bool,
        destination_dir: &Dir,
        method_: Method,
        resolution_tag: resolution::Tag,
        owner: Option<&PackageInstall<'_>>,
    ) -> InstallResult {
        let _tracer = bun_core::perf::trace("PackageInstaller.install");

        let dest = self.destination_dir_subpath;
        let mut staging_buf = path::path_buffer_pool::get();
        if staging_mode != Staging::Off
            && let Ok(staging) = bun_core::fmt::buf_print_z(
                &mut staging_buf[..],
                format_args!("{}", StagingPath(dest.as_bytes(), staging_mode)),
            )
            && Self::make_staging_dir(destination_dir, staging, method_, skip_delete).is_ok()
        {
            let staged = PackageFiles {
                destination_dir_subpath: staging,
                ..*self
            }
            .install_into(destination_dir, method_, resolution_tag, owner);
            if let failure @ InstallResult::Failure(_) = staged {
                let _ = destination_dir.delete_tree(staging.as_bytes());
                return failure;
            }
            if rename_staging_into_place(destination_dir.fd(), staging, dest).is_ok() {
                return InstallResult::Success;
            }
            let _ = destination_dir.delete_tree(staging.as_bytes());
        }
        // No staging (`Staging::Off`, `dest` is occupied, the rename is refused): link in place.
        self.install_into(destination_dir, method_, resolution_tag, owner)
    }

    fn install_into(
        &mut self,
        destination_dir: &Dir,
        method_: Method,
        resolution_tag: resolution::Tag,
        owner: Option<&PackageInstall<'_>>,
    ) -> InstallResult {
        let result = self.link_files_into(destination_dir, method_, resolution_tag);
        if resolution_tag == resolution::Tag::Folder
            && matches!(result, InstallResult::Success)
            && let Some(owner) = owner
        {
            PackageInstall {
                destination_dir_subpath: self.destination_dir_subpath,
                ..*owner
            }
            .link_bundled_into(destination_dir);
        }
        result
    }

    fn link_files_into(
        &mut self,
        destination_dir: &Dir,
        method_: Method,
        resolution_tag: resolution::Tag,
    ) -> InstallResult {
        // A folder is hardlinked instead of cloned, so that edits to it show up in the copy. It
        // also may not be on the same file system as the cache.
        let is_folder = resolution_tag == resolution::Tag::Folder;
        let skip_dirs: &[&OSPathSlice] = if is_folder {
            &[bun_paths::os_path_literal!("node_modules")]
        } else {
            &[]
        };
        let method = if is_folder && method_ == Method::Clonefile {
            Method::Hardlink
        } else {
            method_
        };

        let result = match method {
            #[cfg(target_os = "macos")]
            Method::Clonefile => self.install_with_clonefile(destination_dir),
            #[cfg(target_os = "macos")]
            Method::ClonefileEachDir => {
                self.install_with_clonefile_each_dir(destination_dir, skip_dirs)
            }
            #[cfg(not(target_os = "macos"))]
            Method::Clonefile | Method::ClonefileEachDir => Ok(InstallResult::Success),
            Method::Hardlink => self.install_with_hardlink(destination_dir, skip_dirs),
            Method::Symlink => self.install_with_symlink(destination_dir, skip_dirs),
            // TODO: linux io_uring
            Method::Copyfile => Ok(self.install_with_copyfile(destination_dir, skip_dirs)),
        };
        match result {
            Ok(result) => result,
            #[cfg(not(windows))]
            Err(crate::Error::NotSupported | crate::Error::NotSameFileSystem) => {
                if !is_folder {
                    SUPPORTED_METHOD.store(Method::Copyfile as u8, Ordering::Relaxed);
                }
                self.install_with_copyfile(destination_dir, skip_dirs)
            }
            Err(err @ crate::Error::Sys(bun_errno::SystemErrno::ENOENT)) => {
                InstallResult::fail(err, Step::OpeningCacheDir)
            }
            Err(err) => InstallResult::fail(err, Step::CopyingFiles),
        }
    }
}

type Walker = walker_skippable::Walker;

/// Makes each directory; calls `per_file(dest, src, entry_path)`, both absolute, for each file.
#[cfg(windows)]
fn walk_install_dir_windows(
    state: &mut InstallDirState,
    per_file: &mut dyn FnMut(&bun_core::WStr, &bun_core::WStr, &[u16]) -> crate::Result<()>,
) -> crate::Result<()> {
    use bun_sys::windows;

    let (dest_offset, src_offset) = (state.to_copy_buf_off, state.to_copy_buf2_off);
    let head1: &mut [u16] = &mut state.buf[..];
    let head2: &mut [u16] = &mut state.buf2[..];

    while let Some(entry) = state.walker.next()? {
        match entry.kind {
            EntryKind::Directory | EntryKind::File => {}
            _ => continue,
        }

        // One unit of each buffer is reserved for the NUL terminator.
        if entry.path.len() >= head1.len() - dest_offset
            || entry.path.len() >= head2.len() - src_offset
        {
            return Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
        }

        let dest_len = dest_offset + entry.path.len();
        head1[dest_offset..dest_len].copy_from_slice(entry.path.as_slice());
        head1[dest_len] = 0;
        let dest = bun_core::WStr::from_buf(head1, dest_len);

        let src_len = src_offset + entry.path.len();
        head2[src_offset..src_len].copy_from_slice(entry.path.as_slice());
        head2[src_len] = 0;
        let src = bun_core::WStr::from_buf(head2, src_len);

        if entry.kind == EntryKind::File {
            // The walker returned its parent directory first, so that directory already exists.
            per_file(dest, src, entry.path.as_slice())?;
            continue;
        }
        // SAFETY: FFI — src/dest are the NUL-terminated buffers built above.
        if unsafe {
            windows::CreateDirectoryExW(src.as_ptr(), dest.as_ptr(), core::ptr::null_mut())
        } == 0
        {
            mkdir_recursive_os_path(dest)?;
        }
    }

    Ok(())
}
