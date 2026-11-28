use core::cell::Cell;
use core::sync::atomic::{AtomicU8, AtomicUsize, Ordering};

use bun_collections::{ArrayHashMap, DynamicBitSet};
use bun_core::strings;
use bun_core::{MutableString, ZStr};
#[cfg(windows)]
use bun_paths::OSPath;
use bun_paths::{self as path, OSPathSlice};
use bun_semver::String as SemverString;
#[cfg(not(windows))]
use bun_sys::OpenDirOptions;
use bun_sys::{self as sys, Dir, EntryKind, Fd, walker_skippable};
use bun_threading::thread_pool::Batch;
#[cfg(windows)]
use bun_threading::wait_group::{Pending, WaitGroup};
use bun_threading::work_pool::{OwnedTask, Task as WorkPoolTask};

use crate::package_installer::NodeModulesFolder;
use crate::package_manager::{INBOX, THREAD_POOL};
use crate::{
    BuntagHashBuf, DependencyID, Integrity, Lockfile, Npm, PackageID, PackageManager, Resolution,
    TruncatedPackageNameHash, bun_fs, bun_json, buntaghashbuf_make, initialize_store, resolution,
};

bun_output::declare_scope!(install, hidden);

pub struct PackageInstall<'a> {
    /// Borrowed view of the cache directory fd. The owner is either
    /// the `CacheDirectory`, the cwd sentinel, or a
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

    /// The dependency of each blocked package, when the command names packages. For the note that names the blocked ones among them.
    pub(crate) blocked_dependencies: Vec<DependencyID>,

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
    #[cfg(not(windows))]
    subdir: Dir,
    #[cfg(windows)]
    dest: OSPath,
    #[cfg(windows)]
    src: OSPath,
}

// ───────────────────────────── helpers ─────────────────────────────

#[cfg(windows)]
fn mkdir_recursive_os_path(path: &[u16]) -> sys::Maybe<()> {
    sys::mkdir_recursive_with(path, |dir| {
        sys::mkdir_w(&sys::win32_path(dir, sys::Tag::mkdir)?)
    })
}

/// With the `\\?\` prefix.
#[cfg(windows)]
fn long_path_of(dir: Fd) -> Result<OSPath, bun_errno::SystemErrno> {
    use bun_sys::windows::{self, Win32ErrorExt as _};
    let mut buf = bun_paths::w_path_buffer_pool::get();
    let len = windows::GetFinalPathNameByHandleW(dir.native(), &mut buf[..], 0)
        .map_err(|err| err.to_system_errno())?;
    Ok(OSPath::from(&buf[..len]))
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
                    sys::fstatat(dir, entry.name.as_zstr()).ok()?.st_ino
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
    // `strip_prefix` ignores case on Windows, but real paths have to match exactly.
    path::strip_prefix(real, root).filter(|_| real.starts_with(root))
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
        const NOWHERE: FolderLink = FolderLink::LeftOut("target does not exist");
        let root: &[u8] = &paths.folder;

        let mut real_buf = path::path_buffer_pool::get();
        let Ok(real) = sys::realpath(&path::Path::from_parts(&[root, rel]), &mut real_buf) else {
            return NOWHERE;
        };
        let real_z = bun_core::ZBox::from_bytes(real);
        let Ok(target) = sys::stat(&real_z) else {
            return NOWHERE;
        };
        // The install backends skip `node_modules`, so a target inside one is not in the copy.
        let in_folder = path_below(root, real).is_some_and(|rest| {
            // Windows keeps no link, so nothing has to be there.
            cfg!(windows) || !path::components(rest).any(|part| part == b"node_modules")
        });

        // A symlink is kept only if both its resolved target and its literal text stay in the
        // folder. The text alone is not enough, because it can pass through another symlink.
        if cfg!(not(windows))
            && in_folder
            && let Some(text) = read_link(src, &rel[dir_len..])
            && !path::is_absolute(&text)
            && !crate::bin::path_climbs_out(&[&rel[..dir_len], &text[..]].concat())
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
        // A project at `/` (common in containers) must not make every file count as inside it.
        let in_project = *paths.project != *b"/" && path_below(&paths.project, real).is_some();
        if !in_folder && !in_project {
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
                if let Ok(dir) = sys::get_fd_path_owned(dest.fd())
                    && sys::sys_uv::link(&real, &path::Path::from_parts(&[&dir, name])).is_ok()
                {
                    return Ok(());
                }
            }
            sys::File::open(&real, sys::O::RDONLY | sys::O::CLOEXEC, 0)
                .and_then(|from| {
                    let to = dest.create_file_z(name, Default::default())?;
                    if cfg!(not(windows)) {
                        let _ = sys::fchmod(to.handle(), target.st_mode as sys::Mode);
                    }
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

// ───────────────────────────── HardLinkWindowsInstallTask ─────────────────────────────

#[cfg(windows)]
struct HardLinkWindowsInstallTask {
    /// Layout: `[src .. , 0, dest .. , 0]`. `src` and `dest` are reconstructed
    /// on demand from `src_len` instead of storing self-referential pointers
    /// (which would be invalidated when this `Box<[u16]>` is moved into `Self`
    /// and again whenever `&mut self` reasserts uniqueness over it).
    bytes: Box<[u16]>,
    src_len: usize,
    task: WorkPoolTask,
    _pending: Pending<&'static WaitGroup>,
}

#[cfg(windows)]
bun_threading::intrusive_work_task!(HardLinkWindowsInstallTask, task);

#[cfg(windows)]
impl OwnedTask for HardLinkWindowsInstallTask {
    fn run(mut self: Box<Self>) {
        if let Some(err) = self.link() {
            FIRST_HARDLINK_ERROR.lock().get_or_insert(err);
        }
    }
}

#[cfg(windows)]
static HARDLINK_TASKS: WaitGroup = WaitGroup::init();

#[cfg(windows)]
static FIRST_HARDLINK_ERROR: bun_threading::Guarded<Option<crate::Error>> =
    bun_threading::Guarded::new(None);

/// One at a time: Windows has no `LinkBatch`. Dropping it waits for the tasks that were pushed.
#[cfg(windows)]
struct HardLinkQueue;

#[cfg(windows)]
impl HardLinkQueue {
    fn new() -> Self {
        *FIRST_HARDLINK_ERROR.lock() = None;
        Self
    }

    fn push(&self, task: Box<HardLinkWindowsInstallTask>) {
        THREAD_POOL.schedule(Batch::from_owned(task));
    }

    fn finish(self) -> crate::Result<()> {
        drop(self);
        FIRST_HARDLINK_ERROR.lock().take().map_or(Ok(()), Err)
    }
}

#[cfg(windows)]
impl Drop for HardLinkQueue {
    fn drop(&mut self) {
        HARDLINK_TASKS.wait();
    }
}

#[cfg(windows)]
impl HardLinkWindowsInstallTask {
    fn init(src: &[path::OSPathChar], dest: &[path::OSPathChar]) -> Box<Self> {
        let allocation_size = src.len() + 1 + dest.len() + 1;

        let mut combined = vec![0u16; allocation_size].into_boxed_slice();
        combined[..src.len()].copy_from_slice(src);
        combined[src.len()] = 0;
        let remaining = &mut combined[src.len() + 1..];
        remaining[..dest.len()].copy_from_slice(dest);
        remaining[dest.len()] = 0;

        Box::new(Self {
            bytes: combined,
            src_len: src.len(),
            task: WorkPoolTask::default(),
            _pending: Pending::new(&HARDLINK_TASKS),
        })
    }

    fn link(&mut self) -> Option<crate::Error> {
        use bun_core::WStr;
        use bun_sys::windows::{self, Win32ErrorExt as _};
        let (src, dest) = self.bytes.split_at(self.src_len + 1);
        let src = WStr::from_slice_with_nul(src);
        let dest = WStr::from_slice_with_nul(dest);

        let err = windows::CreateHardLinkW(dest, src).err()?;

        match err {
            windows::Win32Error::ALREADY_EXISTS
            | windows::Win32Error::FILE_EXISTS
            | windows::Win32Error::CANNOT_MAKE => {
                // Race condition: this shouldn't happen
                if cfg!(debug_assertions) {
                    bun_output::scoped_log!(
                        install,
                        "CreateHardLinkW returned EEXIST, this shouldn't happen: {}",
                        bun_core::fmt::fmt_path_u16(dest, Default::default())
                    );
                }
                let _ = sys::unlink_w(dest);
                if windows::CreateHardLinkW(dest, src).is_ok() {
                    return None;
                }
            }
            _ => {}
        }

        let _ = mkdir_recursive_os_path(path::dirname(dest).unwrap_or_default());
        if windows::CreateHardLinkW(dest, src).is_ok() {
            return None;
        }

        if PackageManager::verbose_install() {
            bun_core::run_once! {{
                bun_core::warn!(
                    "CreateHardLinkW failed, falling back to CopyFileW: {} -> {}\n",
                    bun_core::fmt::fmt_os_path(src, Default::default()),
                    bun_core::fmt::fmt_os_path(dest, Default::default()),
                );
            }}
        }

        let err = windows::CopyFileW(src, dest, false).err()?;
        Some(err.to_system_errno().into())
    }
}

// ───────────────────────────── UninstallTask ─────────────────────────────

struct UninstallTask {
    absolute_path: Box<[u8]>,
    task: WorkPoolTask,
}

bun_threading::intrusive_work_task!(UninstallTask, task);

impl OwnedTask for UninstallTask {
    fn run(self: Box<Self>) {
        if let Some(dirname) = path::dirname(&self.absolute_path)
            && let Ok(dir) = open_dir(Fd::cwd(), dirname)
        {
            let _ = dir.delete_tree(bun_paths::basename(&self.absolute_path));
        }
        // Freed before the main thread can see that no task is pending.
        drop(self);
        INBOX.decrement_pending_tasks();
        INBOX.wake();
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
        let _old = if job.skip_delete {
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
        let pool = &*THREAD_POOL;
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
                    INBOX.wake();
                }
            },
            &vec![(); threads],
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
    strings::eql_long(integrity.sri(&mut [0; Integrity::MAX_SRI_LEN]), tag)
        || (skips_verify && tag.is_empty())
}

impl<'a> PackageInstall<'a> {
    fn verify_patch_hash(&mut self, patch: Patch, root_node_modules_dir: &Dir) -> bool {
        // hash from the .patch file, to be checked against bun tag
        let patchfile_contents_hash = patch.contents_hash;
        let mut buf: BuntagHashBuf = BuntagHashBuf::default();
        let bunhashtag = buntaghashbuf_make(&mut buf, patchfile_contents_hash);

        let patch_tag_path: &ZStr =
            &path::Path::from_parts(&[self.destination_dir_subpath, bunhashtag]);

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
            if sys::openat(&destination_dir, patch_tag_path, sys::O::RDONLY, 0)
                .map(sys::File::from_fd)
                .is_err()
            {
                return false;
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
        let bun_tag_path = path::Path::from_parts(&[self.destination_dir_subpath, BUN_TAG]);

        let Ok(bun_tag_file) = self
            .node_modules
            .read_small_file(root_node_modules_dir, &bun_tag_path)
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
                    &|tag| strings::eql_long(resolved, tag),
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

    fn read_installed_package_json<'m>(
        &mut self,
        root_node_modules_dir: &Dir,
        mutable: &'m mut MutableString,
        until_eof: bool,
    ) -> Option<&'m [u8]> {
        mutable.reset();

        let package_json_path =
            path::Path::from_parts(&[self.destination_dir_subpath, b"package.json"]);

        let package_json_file = self
            .node_modules
            .open_file(root_node_modules_dir, &package_json_path)
            .ok()?;

        // Heuristic: most package.jsons will be less than 2048 bytes.
        loop {
            if mutable.list.capacity() - mutable.list.len() < 1024 {
                mutable.grow_by(4096).ok()?;
            }
            let read = bun_core::vec::append_with(&mut mutable.list, usize::MAX, |spare| {
                bun_sys::read_buf(package_json_file.handle(), spare)
            })
            .ok()?;
            if read == 0 || (!until_eof && mutable.list.len() < mutable.list.capacity()) {
                break;
            }
        }

        Some(&mutable.list)
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
        let Some(contents) =
            self.read_installed_package_json(root_node_modules_dir, mutable, until_eof)
        else {
            return Some(false);
        };
        let source = &bun_ast::Source::init_path_string("package.json", contents);

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
                        if entry.path.len() >= path::MAX_PATH_BYTES {
                            return Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
                        }
                        let clone = || {
                            sys::clonefileat(
                                entry.dir,
                                entry.basename,
                                destination_dir_.fd(),
                                entry.path,
                            )
                        };
                        // The existing file may belong to a different version.
                        let cloned = match clone() {
                            Err(e) if e.get_errno() == sys::Errno::EEXIST => {
                                let _ = sys::unlinkat(destination_dir_, entry.path);
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
                                sys::Errno::ENOTSUP | sys::Errno::EOPNOTSUPP => {
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
                sys::Errno::ENOTSUP | sys::Errno::EOPNOTSUPP => Err(crate::Error::NotSupported),
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
            let mut dest = long_path_of(destbase.fd())
                .map_err(|err| Failure::boxed(err.into(), Step::OpeningDestDir))?;
            dest.push(destpath);

            if let Err(err) = sys::mkdir_w(&dest) {
                // Like `make_open_real_dir`, replace a symlink at the destination, never follow it.
                if err.get_errno() == sys::E::EEXIST
                    && let Err(err) =
                        crate::prune::remove_planted_link(destbase, &path::Path::from(&dest[..]))
                {
                    return Err(Failure::boxed(err.into(), Step::OpeningDestDir));
                }
                let _ = mkdir_recursive_os_path(&dest);
            }

            let src = long_path_of(walker.root())
                .map_err(|err| Failure::boxed(err.into(), Step::CopyingFiles))?;
            Ok(InstallDirState { walker, dest, src })
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

                let in_file = sys::openat(entry.dir, entry.basename, sys::O::RDONLY, 0)
                    .map(sys::CloseOnDrop::new)?;

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
                        .map(sys::CloseOnDrop::new)
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
                        if let Some(entry_dirname) = path::dirname(entry.path.as_bytes()) {
                            let _ = bun_sys::make_path::make_path(destination_dir_, entry_dirname);
                        }
                        create(entry.path).map_err(|err| {
                            copy_failed(err.into(), entry.path.as_bytes(), failed_file)
                        })?
                    }
                };

                let stat = in_file.stat()?;
                // Best effort: filesystems without permission bits reject fchmod.
                let _ = sys::fchmod(outfile.fd(), stat.st_mode as bun_sys::Mode);

                bun_sys::copy_file::copy_file_with_state(
                    in_file.fd(),
                    outfile.fd(),
                    &mut copy_file_state,
                )
                .map_err(|err| copy_failed(err.into(), entry.path.as_bytes(), failed_file))?;
            }

            Ok(())
        }

        #[cfg(windows)]
        let result = walk_install_dir_windows(&mut state, &mut |dest, src, entry_path| {
            use bun_sys::windows::{self, Win32ErrorExt as _};
            // `dest` can be a hardlink of `src`, which CopyFileW cannot overwrite.
            let mut result = windows::CopyFileW(src, dest, true);
            if let Err(windows::Win32Error::FILE_EXISTS | windows::Win32Error::ALREADY_EXISTS) =
                result
            {
                let _ = sys::unlink_w(dest);
                result = windows::CopyFileW(src, dest, true);
            }
            result.map_err(|err| {
                copy_failed(err.to_system_errno().into(), entry_path, &mut failed_file)
            })
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

        fn copy(state: &mut InstallDirState) -> crate::Result<()> {
            #[cfg(not(windows))]
            let destination_dir = &state.subdir;
            let walker = &mut state.walker;
            #[cfg(windows)]
            let queue = HardLinkQueue::new();

            while let Some(entry) = walker.next()? {
                #[cfg(unix)]
                {
                    match entry.kind {
                        EntryKind::Directory => {
                            bun_sys::make_path::make_path(destination_dir, entry.path.as_bytes())?;
                        }
                        EntryKind::File => {
                            // EACCES/EPERM: FUSE (e.g. Android SDCARD) does not support hardlinks
                            fn map_linkat_err(err: sys::Error) -> crate::Error {
                                match err.get_errno() {
                                    sys::E::EXDEV
                                    | sys::E::EACCES
                                    | sys::E::EPERM
                                    | sys::E::ENOTSUP => crate::Error::NotSameFileSystem,
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

                    queue.push(HardLinkWindowsInstallTask::init(
                        &state.src.push_scoped(entry.path),
                        &state.dest.push_scoped(entry.path),
                    ));
                }
            }

            #[cfg(windows)]
            queue.finish()?;

            Ok(())
        }

        match copy(&mut state) {
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

        #[cfg(not(windows))]
        fn copy(
            destination_dir: &Dir,
            walker: &mut Walker,
            source_dir: &mut path::Path,
        ) -> crate::Result<()> {
            while let Some(entry) = walker.next()? {
                match entry.kind {
                    EntryKind::Directory => {
                        bun_sys::make_path::make_path(destination_dir, entry.path.as_bytes())?;
                    }
                    EntryKind::File => {
                        let target: &ZStr = &source_dir.push_scoped(entry.path);

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
            let mut buf = bun_paths::path_buffer_pool::get();
            let mut source_dir = path::Path::from(sys::get_fd_path(state.walker.root(), &mut buf)?);
            copy(&state.subdir, &mut state.walker, &mut source_dir)
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
pub(crate) fn move_aside<'a>(
    destination_dir: &'a Dir,
    subpath: &ZStr,
    random: u64,
) -> Option<sys::DeleteTreeOnDrop<bun_core::ZBox, &'a Dir>> {
    let old = bun_core::ZBox::from_vec(
        format!(
            "{MOVED_ASIDE_PREFIX}{}",
            bun_core::fmt::hex_upper(&random.to_ne_bytes())
        )
        .into_bytes(),
    );
    match sys::renameat(destination_dir.fd(), subpath, destination_dir.fd(), &old) {
        Ok(()) => Some(sys::DeleteTreeOnDrop::new(destination_dir, old)),
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
    fn uninstall_before_install(&self, destination_dir: &Dir, total_tasks: &Cell<u32>) {
        let Some(temp_path) = move_aside(
            destination_dir,
            self.destination_dir_subpath,
            bun_core::fast_random(),
        ) else {
            return;
        };
        // If the OS can't start the pool's first worker, tasks scheduled on the pool would never
        // run.
        let pool = &*THREAD_POOL;
        pool.warm(1);
        if !pool.has_workers() {
            return;
        }
        // Deleting a large tree takes a while. Now that it has a random name, another thread can
        // delete it.
        let top_level_dir = bun_fs::FileSystem::get().top_level_dir();
        let absolute_path =
            path::Path::resolve(&[top_level_dir, &self.node_modules.path, &temp_path.keep()]);
        let task = Box::new(UninstallTask {
            absolute_path: absolute_path.as_bytes().into(),
            task: WorkPoolTask::default(),
        });
        total_tasks.update(|total| total + 1);
        INBOX.pending_tasks.fetch_add(1, Ordering::Relaxed);
        pool.schedule(Batch::from_owned(task));
    }

    fn is_dangling_symlink(path: &ZStr) -> bool {
        #[cfg(windows)]
        let opened = sys::sys_uv::open(path, 0, 0);
        #[cfg(not(windows))]
        let opened = sys::open(path, sys::O::PATH, 0);
        opened.map(sys::File::from_fd).is_err()
    }

    pub(crate) fn install_from_link(
        &mut self,
        skip_delete: bool,
        destination_dir: &Dir,
        total_tasks: &Cell<u32>,
    ) -> InstallResult {
        // If this fails, we don't care.
        // we'll catch it the next error
        if !skip_delete && self.destination_dir_subpath.as_bytes() != b"." {
            self.uninstall_before_install(destination_dir, total_tasks);
        }
        self.link_into(destination_dir)
    }

    fn link_into(&mut self, destination_dir: &Dir) -> InstallResult {
        let dest_path = self.destination_dir_subpath;
        // `None` when there is no directory component.
        let subdir = path::dirname(dest_path.as_bytes());

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
            let dir = match sys::openat(
                self.cache_dir,
                symlinked_path,
                sys::O::RDONLY | sys::O::DIRECTORY,
                0,
            ) {
                Ok(fd) => sys::File::from_fd(fd),
                Err(err) => {
                    return InstallResult::fail(realpath_err(err), Step::LinkingDependency);
                }
            };
            match sys::get_fd_path(dir.fd(), &mut to_buf) {
                Ok(s) => &*s,
                Err(err) => {
                    return InstallResult::fail(realpath_err(err), Step::LinkingDependency);
                }
            }
        };
        // When we're linking on Windows, we want to avoid keeping the source directory handle open
        #[cfg(windows)]
        {
            let mut dest_wide = match long_path_of(destination_dir.fd()) {
                Ok(wide) => wide,
                Err(err) => return InstallResult::fail(err.into(), Step::LinkingDependency),
            };
            dest_wide.push(dest_path);
            if subdir.is_some() {
                let _ = mkdir_recursive_os_path(dest_wide.dirname().unwrap_or_default());
            }
            let dest_z: &ZStr = &path::Path::from(&dest_wide[..]);

            let to_len = to_path.len();
            let target_z = ZStr::nul_terminate(&mut to_buf, to_len);

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
                    match bun_sys::make_path::make_open_path(
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
            let dest: &ZStr = dest_path.substring(subdir.map_or(0, |dir| dir.len() + 1));
            debug_assert_eq!(dest.as_bytes(), path::basename(dest_path));

            let mut dest_buf = bun_paths::path_buffer_pool::get();
            let dest_dir_path = match sys::get_fd_path(dest_dir.fd(), &mut dest_buf) {
                Ok(p) => p,
                Err(err) => return InstallResult::fail(err.into(), Step::LinkingDependency),
            };

            let target: &ZStr = &path::Path::relative(dest_dir_path, to_path);
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
        total_tasks: &Cell<u32>,
    ) -> InstallResult {
        // If this fails, we don't care.
        // we'll catch it the next error
        if !skip_delete && self.destination_dir_subpath.as_bytes() != b"." {
            self.uninstall_before_install(destination_dir, total_tasks);
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
        for bundled in lockfile.bundled_by_folder(self.cache_dir_subpath.as_bytes()) {
            let name = bundled.name.slice(&lockfile.buffers.string_bytes);
            let [src, dest] = [self.cache_dir_subpath, self.destination_dir_subpath]
                .map(|dir| path::Path::from_parts(&[dir, b"node_modules", name]));
            // An error means the folder doesn't have it, like a tarball that lacks a bundled dependency.
            let _ = PackageInstall {
                cache_dir_subpath: &src,
                destination_dir_subpath: &dest,
                ..*self
            }
            .link_into(destination_dir);
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
            let staging = sys::DeleteTreeOnDrop::new(destination_dir, staging);
            let staged = PackageFiles {
                destination_dir_subpath: &staging,
                ..*self
            }
            .install_into(destination_dir, method_, resolution_tag, owner);
            if let failure @ InstallResult::Failure(_) = staged {
                return failure;
            }
            if rename_staging_into_place(destination_dir.fd(), &staging, dest).is_ok() {
                staging.keep();
                return InstallResult::Success;
            }
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

    while let Some(entry) = state.walker.next()? {
        match entry.kind {
            EntryKind::Directory | EntryKind::File => {}
            _ => continue,
        }

        let src: &bun_core::WStr = &state.src.push_scoped(entry.path);
        let dest: &bun_core::WStr = &state.dest.push_scoped(entry.path);

        if entry.kind == EntryKind::File {
            // The walker returned its parent directory first, so that directory already exists.
            per_file(dest, src, entry.path.as_slice())?;
            continue;
        }
        if windows::CreateDirectoryExW(src, dest).is_err() {
            mkdir_recursive_os_path(dest)?;
        }
    }

    Ok(())
}
