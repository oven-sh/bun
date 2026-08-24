use core::sync::atomic::{AtomicU8, Ordering};

use bun_collections::{ArrayHashMap, DynamicBitSet};
use bun_core::Progress::Progress;
use bun_core::{Global, Output};
use bun_core::{MutableString, ZStr};
use bun_paths::strings;
use bun_paths::{self as path, OSPathChar, OSPathSlice, PathBuffer, SEP};
use bun_semver::String as SemverString;
#[cfg(not(windows))]
use bun_sys::OpenDirOptions;
use bun_sys::{self as sys, Dir, EntryKind, Fd, FdExt, walker_skippable};
use bun_threading::ThreadPool;
#[cfg(windows)]
use bun_threading::WaitGroup;
use bun_threading::work_pool::Task as WorkPoolTask;

use crate::package_installer::NodeModulesFolder;
use crate::{
    BuntagHashBuf, Lockfile, Npm, PackageID, PackageManager, Repository, Resolution,
    TruncatedPackageNameHash, bun_fs, bun_json, buntaghashbuf_make, initialize_store, resolution,
};

bun_output::declare_scope!(install, hidden);

pub struct PackageInstall<'a> {
    /// Borrowed view of the cache directory fd. The owner is either
    /// `PackageManager`'s cached directory handle, the cwd sentinel, or a
    /// short-lived `Dir` held by the caller — `PackageInstall` never closes it.
    pub(crate) cache_dir: Fd,
    pub(crate) cache_dir_subpath: &'a ZStr,
    /// `destination_dir_subpath_buf[..destination_dir_subpath_len]` is the
    /// destination inside `node_modules`, NUL-terminated; the tail is scratch
    /// for `<dest>/.bun-tag`-style probes.
    pub(crate) destination_dir_subpath_buf: &'a mut [u8],
    pub(crate) destination_dir_subpath_len: usize,

    pub(crate) package_name: SemverString,
    pub(crate) package_version: &'a [u8],
    pub(crate) patch: Option<Patch>,

    pub(crate) node_modules: &'a NodeModulesFolder,
}

/// What an install needs from the package manager. On the main thread that
/// is the manager itself; a patch task on a worker only has the lockfile.
pub enum InstallEnv<'m> {
    Manager(&'m mut PackageManager),
    Worker {
        lockfile: &'m Lockfile,
        thread_pool: &'m ThreadPool,
    },
}

impl InstallEnv<'_> {
    fn lockfile(&self) -> &Lockfile {
        match self {
            InstallEnv::Manager(m) => &m.lockfile,
            InstallEnv::Worker { lockfile, .. } => lockfile,
        }
    }
    fn thread_pool(&self) -> &ThreadPool {
        match self {
            InstallEnv::Manager(m) => &m.thread_pool,
            InstallEnv::Worker { thread_pool, .. } => thread_pool,
        }
    }
    fn progress(&mut self) -> Option<&mut Progress> {
        match self {
            InstallEnv::Manager(m) if m.options.log_level.show_progress() => Some(&mut m.progress),
            _ => None,
        }
    }
}

impl PackageInstall<'_> {
    #[inline]
    pub(crate) fn destination_dir_subpath(&self) -> &ZStr {
        ZStr::from_buf(
            &*self.destination_dir_subpath_buf,
            self.destination_dir_subpath_len,
        )
    }
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
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, enum_map::Enum)]
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

    /// Used for file: when file: points to a parent directory
    /// example: "file:../"
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
            _ => unreachable!(),
        }
    }
}

type BackendSupport = enum_map::EnumMap<Method, bool>;

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
    #[cfg(target_os = "macos")]
    fn macos() -> BackendSupport {
        enum_map::EnumMap::from_fn(|k| match k {
            Method::Clonefile => true,
            Method::ClonefileEachDir => true,
            Method::Hardlink => true,
            Method::Copyfile => true,
            Method::Symlink => true,
        })
    }

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    fn linux() -> BackendSupport {
        enum_map::EnumMap::from_fn(|k| match k {
            Method::Clonefile => false,
            Method::ClonefileEachDir => false,
            Method::Hardlink => true,
            Method::Copyfile => true,
            Method::Symlink => true,
        })
    }

    #[cfg(windows)]
    fn windows() -> BackendSupport {
        enum_map::EnumMap::from_fn(|k| match k {
            Method::Clonefile => false,
            Method::ClonefileEachDir => false,
            Method::Hardlink => true,
            Method::Copyfile => true,
            Method::Symlink => false,
        })
    }

    #[inline]
    pub(crate) fn is_supported(self) -> bool {
        #[cfg(target_os = "macos")]
        return Self::macos()[self];
        // Android is listed explicitly: `target_os = "linux"` does not cover the Android ABI.
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        return Self::linux()[self];
        #[cfg(windows)]
        return Self::windows()[self];
        #[cfg(not(any(
            target_os = "macos",
            target_os = "linux",
            target_os = "android",
            target_os = "freebsd",
            windows
        )))]
        return false;
    }
}

#[derive(Copy, Clone)]
pub struct Failure {
    pub(crate) err: crate::Error,
    pub(crate) step: Step,
    #[cfg(bun_debug)]
    pub(crate) debug_trace: bun_core::StoredTrace,
}

impl Failure {
    // `Failure` is `Copy` and tiny without the `#[cfg(bun_debug)]` trace
    // field; clippy's trivially_copy_pass_by_ref fires in that config but
    // `&self` is correct when the trace field is present. Allow it rather
    // than vary the signature per-config.
    #[allow(clippy::trivially_copy_pass_by_ref)]
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
    /// Init a Result with the 'fail' tag. use `.Success` for the 'success' tag.
    #[inline]
    pub(crate) fn fail(
        err: crate::Error,
        step: Step,
        trace: Option<&bun_crash_handler::StackTrace>,
    ) -> InstallResult {
        InstallResult::Failure(Failure::boxed(err, step, trace))
    }
}

impl Failure {
    #[inline]
    fn boxed(
        err: crate::Error,
        step: Step,
        _trace: Option<&bun_crash_handler::StackTrace>,
    ) -> Box<Failure> {
        Box::new(Failure {
            err,
            step,
            #[cfg(bun_debug)]
            debug_trace: match _trace {
                Some(t) => bun_core::StoredTrace::from(Some(t)),
                None => bun_core::StoredTrace::capture(None /* @returnAddress() */),
            },
        })
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

// Writers are the CLI option-load and the clonefile/hardlink fallback while
// installing, all on the install main thread; isolated_install workers
// snapshot via `supported_method()` once at startup. Stored as the `repr(u8)`
// discriminant; single writer, so `Relaxed` suffices.
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

    /// Write accessor for [`SUPPORTED_METHOD`] (fallback path when
    /// clonefile/hardlink fails). Relaxed — single-writer, advisory hint.
    #[inline]
    #[cfg(not(windows))]
    pub(crate) fn set_supported_method(m: Method) {
        SUPPORTED_METHOD.store(m as u8, Ordering::Relaxed);
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
            // macOS's mkpath also checks EISDIR; on Windows EEXIST suffices.
            // node:fs additionally probes `directory_exists_at`; the package-install
            // call sites discard the result (`_ =`) so a bare Ok matches behaviour.
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
fn open_dir(dir: Fd, subpath: &ZStr) -> crate::Result<Dir> {
    sys::open_dir_at(dir, subpath.as_bytes())
        .map(Dir::from_fd)
        .map_err(Into::into)
}

/// Non-Z-terminated variant of [`open_dir`].
#[inline]
fn open_dir_a(dir: Fd, subpath: &[u8]) -> crate::Result<Dir> {
    sys::open_dir_at(dir, subpath)
        .map(Dir::from_fd)
        .map_err(Into::into)
}

// macOS clonefileat(2) — routed through the safe `sys::clonefileat` wrapper
// (takes `Fd`/`&ZStr`, returns `Maybe<()>`). The wrapper preserves the errno
// via `Error::get_errno()` for the per-errno branching below.

// ───────────────────────────── HardLinkWindowsInstallTask ─────────────────────────────

/// One batch of hardlink tasks (a single package install); the tasks report
/// into it and the installer waits on it.
#[cfg(windows)]
struct HardLinkBatch {
    /// First-write-wins error from a worker thread for the caller of `wait()`.
    errored: bun_threading::Guarded<Option<crate::Error>>,
    wait_group: WaitGroup,
}

#[cfg(windows)]
impl HardLinkBatch {
    fn new() -> std::sync::Arc<Self> {
        std::sync::Arc::new(Self {
            errored: bun_threading::Guarded::new(None),
            wait_group: WaitGroup::init(),
        })
    }

    fn push(
        self: &std::sync::Arc<Self>,
        thread_pool: &ThreadPool,
        task: HardLinkWindowsInstallTask,
    ) {
        self.wait_group.add_one();
        thread_pool.schedule_owned(Box::new(task));
    }

    fn wait(&self) {
        self.wait_group.wait();
    }
}

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
    batch: std::sync::Arc<HardLinkBatch>,
}

#[cfg(windows)]
bun_threading::owned_task!(HardLinkWindowsInstallTask, task);

#[cfg(windows)]
impl HardLinkWindowsInstallTask {
    fn new(
        batch: &std::sync::Arc<HardLinkBatch>,
        src: &[OSPathChar],
        dest: &[OSPathChar],
        basename: &[OSPathChar],
    ) -> Self {
        let allocation_size = src.len() + 1 + dest.len() + 1;

        let mut combined = vec![0u16; allocation_size].into_boxed_slice();
        combined[..src.len()].copy_from_slice(src);
        combined[src.len()] = 0;
        let remaining = &mut combined[src.len() + 1..];
        remaining[..dest.len()].copy_from_slice(dest);
        remaining[dest.len()] = 0;

        Self {
            bytes: combined,
            src_len: src.len(),
            basename: basename.len() as u16, // @truncate
            task: WorkPoolTask::default(),
            batch: batch.clone(),
        }
    }

    fn run_owned(mut self: Box<Self>) {
        if let Some(err) = self.run() {
            let mut slot = self.batch.errored.lock();
            if slot.is_none() {
                *slot = Some(err);
            }
        }
        self.batch.wait_group.finish();
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
                windows::delete_file_w(bun_core::WStr::from_buf(dest, dest_len));
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

        let (src, dest) = self.bytes.split_at(src_len + 1);
        if windows::copy_file_w(
            bun_core::WStr::from_buf(src, src_len),
            bun_core::WStr::from_buf(dest, dest_len),
            false,
        ) {
            return None;
        }

        Some(windows::last_system_errno().into())
    }
}

// ───────────────────────────── UninstallTask ─────────────────────────────

struct UninstallTask {
    absolute_path: Box<[u8]>,
    task: WorkPoolTask,
    shared: &'static crate::package_manager::Shared,
}

bun_threading::owned_task!(UninstallTask, task);

impl UninstallTask {
    fn run_owned(self: Box<Self>) {
        let shared = self.shared;
        Self::delete(&self);
        // The task must be freed before the main thread can observe pending_tasks==0.
        drop(self);
        shared.pending_tasks.fetch_sub(1, Ordering::Release);
        shared.wake();
    }

    fn delete(uninstall_task: &Self) {
        let mut debug_timer = Output::DebugTimer::start();

        let dirname =
            path::resolve_path::dirname::<path::platform::Auto>(&uninstall_task.absolute_path);
        if dirname.is_empty() {
            bun_core::debug_warn!(
                "Unexpectedly failed to get dirname of {}",
                bstr::BStr::new(&uninstall_task.absolute_path)
            );
            return;
        }
        let basename = bun_paths::basename(&uninstall_task.absolute_path);

        let dir = match open_dir_a(Fd::cwd(), dirname) {
            Ok(d) => d,
            Err(err) => {
                if bun_core::Environment::IS_DEBUG || bun_core::Environment::ENABLE_ASAN {
                    bun_core::debug_warn!(
                        "Failed to delete {}: {}",
                        bstr::BStr::new(&uninstall_task.absolute_path),
                        bstr::BStr::new(err.name())
                    );
                }
                return;
            }
        };
        if let Err(err) = dir.delete_tree(basename) {
            if bun_core::Environment::IS_DEBUG || bun_core::Environment::ENABLE_ASAN {
                bun_core::debug_warn!(
                    "Failed to delete {} in {}: {}",
                    bstr::BStr::new(basename),
                    bstr::BStr::new(dirname),
                    bstr::BStr::new(err.name())
                );
            }
        }

        if cfg!(debug_assertions) {
            let _ = &mut debug_timer;
            bun_output::scoped_log!(
                install,
                "delete_tree({}, {}) = {}",
                bstr::BStr::new(basename),
                bstr::BStr::new(dirname),
                debug_timer
            );
        }
    }
}

// ───────────────────────────── impl PackageInstall ─────────────────────────────

impl<'a> PackageInstall<'a> {
    ///
    fn verify_patch_hash(&mut self, patch: Patch, root_node_modules_dir: &Dir) -> bool {
        // hash from the .patch file, to be checked against bun tag
        let patchfile_contents_hash = patch.contents_hash;
        let mut buf: BuntagHashBuf = BuntagHashBuf::default();
        let bunhashtag = buntaghashbuf_make(&mut buf, patchfile_contents_hash);

        let patch_tag_path = path::resolve_path::join_z::<path::platform::Posix>(&[
            self.destination_dir_subpath().as_bytes(),
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

    /// `<dest>/<name>` as a `ZStr` in the scratch tail of
    /// `destination_dir_subpath_buf`; [`restore_subpath`] puts the NUL back.
    fn subpath_child(&mut self, name: &[u8]) -> &ZStr {
        let dest_len = self.destination_dir_subpath_len;
        let buf = &mut *self.destination_dir_subpath_buf;
        buf[dest_len] = SEP;
        buf[dest_len + 1..dest_len + 1 + name.len()].copy_from_slice(name);
        buf[dest_len + 1 + name.len()] = 0;
        ZStr::from_buf(&*buf, dest_len + 1 + name.len())
    }

    fn restore_subpath(&mut self) {
        self.destination_dir_subpath_buf[self.destination_dir_subpath_len] = 0;
    }

    // 1. verify that .bun-tag exists (was it installed from bun?)
    // 2. check .bun-tag against the resolved version
    fn verify_git_resolution(
        &mut self,
        lockfile: &Lockfile,
        repo: &Repository,
        root_node_modules_dir: &Dir,
    ) -> bool {
        let node_modules = self.node_modules;
        let bun_tag_path = self.subpath_child(b".bun-tag");
        let bun_tag_file = node_modules.read_small_file(root_node_modules_dir, bun_tag_path);
        self.restore_subpath();
        let Ok(bun_tag_file) = bun_tag_file else {
            return false;
        };
        strings::eql_long(
            repo.resolved.slice(&lockfile.buffers.string_bytes),
            &bun_tag_file.bytes,
            true,
        )
    }

    pub(crate) fn verify(
        &mut self,
        lockfile: &Lockfile,
        resolution: &Resolution,
        root_node_modules_dir: &Dir,
    ) -> bool {
        let verified = match resolution.tag {
            resolution::Tag::Git => {
                self.verify_git_resolution(lockfile, resolution.git(), root_node_modules_dir)
            }
            resolution::Tag::Github => {
                self.verify_git_resolution(lockfile, resolution.github(), root_node_modules_dir)
            }
            resolution::Tag::Root => self.verify_transitive_symlinked_folder(root_node_modules_dir),
            resolution::Tag::Folder => {
                if lockfile.is_workspace_tree_id(self.node_modules.tree_id) {
                    self.verify_package_json_name_and_version(
                        lockfile,
                        root_node_modules_dir,
                        resolution.tag,
                    )
                } else {
                    self.verify_transitive_symlinked_folder(root_node_modules_dir)
                }
            }
            _ => self.verify_package_json_name_and_version(
                lockfile,
                root_node_modules_dir,
                resolution.tag,
            ),
        };

        if let Some(patch) = self.patch {
            if !verified {
                return false;
            }
            return self.verify_patch_hash(patch, root_node_modules_dir);
        }
        verified
    }

    // Only check for destination directory in node_modules. We can't use package.json because
    // it might not exist
    fn verify_transitive_symlinked_folder(&self, root_node_modules_dir: &Dir) -> bool {
        self.node_modules
            .directory_exists_at(root_node_modules_dir, self.destination_dir_subpath())
    }

    fn get_installed_package_json_source(
        &mut self,
        root_node_modules_dir: &Dir,
        mutable: &mut MutableString,
        resolution_tag: resolution::Tag,
    ) -> Option<bun_ast::Source> {
        mutable.reset();
        mutable.expand_to_capacity();

        let node_modules = self.node_modules;
        let package_name_len = self.package_name.len();
        let package_version_len = self.package_version.len();
        let package_json_path = self.subpath_child(b"package.json");
        let source = Self::read_package_json_source(
            node_modules,
            root_node_modules_dir,
            package_json_path,
            mutable,
            resolution_tag,
            package_name_len,
            package_version_len,
        );
        self.restore_subpath();
        source
    }

    fn read_package_json_source(
        node_modules: &NodeModulesFolder,
        root_node_modules_dir: &Dir,
        package_json_path: &ZStr,
        mutable: &mut MutableString,
        resolution_tag: resolution::Tag,
        package_name_len: usize,
        package_version_len: usize,
    ) -> Option<bun_ast::Source> {
        let mut total: usize = 0;
        let mut read: usize;
        let package_json_file = node_modules
            .open_file(root_node_modules_dir, package_json_path)
            .ok()?;

        // Heuristic: most package.jsons will be less than 2048 bytes.
        read = package_json_file.read(&mut mutable.list[total..]).ok()?;
        let mut remain = &mut mutable.list[total.min(read)..];
        if read > 0 && remain.len() < 1024 {
            mutable.grow_by(4096).ok()?;
            mutable.expand_to_capacity();
        }

        while read > 0 {
            total += read;

            mutable.expand_to_capacity();
            remain = &mut mutable.list[total..];

            if remain.len() < 1024 {
                mutable.grow_by(4096).ok()?;
            }
            mutable.expand_to_capacity();
            remain = &mut mutable.list[total..];

            read = package_json_file.read(remain).ok()?;
        }

        // If it's not long enough to have {"name": "foo", "version": "1.2.0"}, there's no way it's valid
        let minimum = if resolution_tag == resolution::Tag::Workspace && package_version_len == 0 {
            // workspaces aren't required to have a version
            br#"{"name":""}"#.len() + package_name_len
        } else {
            br#"{"name":"","version":""}"#.len() + package_name_len + package_version_len
        };

        if total < minimum {
            return None;
        }

        Some(bun_ast::Source::init_path_string(
            package_json_path.as_bytes(),
            &mutable.list[0..total],
        ))
    }

    fn verify_package_json_name_and_version(
        &mut self,
        lockfile: &Lockfile,
        root_node_modules_dir: &Dir,
        resolution_tag: resolution::Tag,
    ) -> bool {
        let mut body_pool = Npm::Registry::BodyPool::get();
        let mutable: &mut MutableString = &mut body_pool;

        // Read the file
        // Return false on any error.
        // Don't keep it open while we're parsing the JSON.
        // The longer the file stays open, the more likely it causes issues for
        // other processes on Windows.
        let Some(source) =
            self.get_installed_package_json_source(root_node_modules_dir, mutable, resolution_tag)
        else {
            return false;
        };
        let source = &source;

        let mut log = bun_ast::Log::init();

        initialize_store();

        let mut package_json_checker = bun_json::PackageJSONVersionChecker::init(source, &mut log);
        if package_json_checker.parse().is_err() {
            return false;
        }
        if package_json_checker.has_errors() || !package_json_checker.has_found_name {
            return false;
        }
        // workspaces aren't required to have a version
        if !package_json_checker.has_found_version && resolution_tag != resolution::Tag::Workspace {
            return false;
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
                return false;
            };

            if found_version[offset..] != *self.package_version {
                return false;
            }
        }

        // lastly, check the name.
        package_json_checker.found_name() == self.package_name.slice(&lockfile.buffers.string_bytes)
    }

    // ───────────────────────────── install backends ─────────────────────────────

    #[cfg(target_os = "macos")]
    fn install_with_clonefile_each_dir(
        &mut self,
        destination_dir: &Dir,
    ) -> crate::Result<InstallResult> {
        let cached_package_dir = match open_dir(self.cache_dir, self.cache_dir_subpath) {
            Ok(d) => d,
            Err(err) => return Ok(InstallResult::fail(err, Step::OpeningCacheDir, None)),
        };
        let mut walker_ = match walker_skippable::walk_owned(
            cached_package_dir,
            &[] as &[&OSPathSlice],
            &[] as &[&OSPathSlice],
        ) {
            Ok(w) => w,
            Err(err) => return Ok(InstallResult::fail(err.into(), Step::OpeningCacheDir, None)),
        };
        walker_.resolve_unknown_entry_types = true;

        fn copy(destination_dir_: &Dir, walker: &mut Walker) -> crate::Result<()> {
            let mut stackpath = [0u8; path::MAX_PATH_BYTES];
            while let Some(entry) = walker.next()? {
                match entry.kind {
                    EntryKind::Directory => {
                        let _ = sys::mkdirat(destination_dir_, entry.path, 0o755);
                    }
                    EntryKind::File => {
                        let path_len = entry.path.len();
                        let base_len = entry.basename.len();
                        stackpath[..path_len].copy_from_slice(entry.path.as_bytes());
                        stackpath[path_len] = 0;
                        // `stackpath[path_len] == 0` written above; both views are
                        // shared-only (used for `.as_ptr()` into FFI), so the
                        // overlapping borrows of `stackpath` are sound — replaces
                        // two raw `from_raw_mut` reconstructions over the same
                        // buffer (which were UB-adjacent as aliased `&mut`s).
                        let path_ = ZStr::from_buf(&stackpath, path_len);
                        let basename = ZStr::from_buf(&stackpath[path_len - base_len..], base_len);
                        match sys::clonefileat(entry.dir, basename, destination_dir_.fd(), path_) {
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
                                // sometimes the downloaded npm package has already node_modules with it, so just ignore exist error here
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

        let subdir = match destination_dir.make_open_path(
            self.destination_dir_subpath().as_bytes(),
            OpenDirOptions::default(),
        ) {
            Ok(d) => d,
            Err(err) => return Ok(InstallResult::fail(err.into(), Step::OpeningDestDir, None)),
        };
        if let Err(err) = copy(&subdir, &mut walker_) {
            return Ok(InstallResult::fail(err, Step::CopyingFiles, None));
        }

        Ok(InstallResult::Success)
    }

    // https://www.unix.com/man-page/mojave/2/fclonefileat/
    #[cfg(target_os = "macos")]
    fn install_with_clonefile(&mut self, destination_dir: &Dir) -> crate::Result<InstallResult> {
        if self.destination_dir_subpath().as_bytes()[0] == b'@' {
            if let Some(slash) = strings::index_of_char_z(self.destination_dir_subpath(), SEP) {
                let slash = slash as usize;
                self.destination_dir_subpath_buf[slash] = 0;
                let subdir = ZStr::from_buf(&*self.destination_dir_subpath_buf, slash);
                let _ = sys::mkdirat(destination_dir, subdir, 0o755);
                self.destination_dir_subpath_buf[slash] = SEP;
            }
        }

        match sys::clonefileat(
            self.cache_dir,
            self.cache_dir_subpath,
            destination_dir.fd(),
            self.destination_dir_subpath(),
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
                sys::Errno::EEXIST => self.install_with_clonefile_each_dir(destination_dir),
                sys::Errno::EACCES => Err(crate::Error::Sys(bun_errno::SystemErrno::EACCES)),
                _ => Err(crate::Error::Unexpected),
            },
        }
    }

    fn init_install_dir(
        &mut self,
        destination_dir: &Dir,
        method: Method,
    ) -> Result<InstallDirState, Box<Failure>> {
        let destbase = destination_dir;
        let destpath = self.destination_dir_subpath();

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
                open_dir(self.cache_dir, self.cache_dir_subpath)
            }
        } {
            Ok(d) => d,
            Err(err) => return Err(Failure::boxed(err, Step::OpeningCacheDir, None)),
        };

        #[cfg(windows)]
        const NODE_MODULES_LIT: &OSPathSlice = &[
            b'n' as u16,
            b'o' as u16,
            b'd' as u16,
            b'e' as u16,
            b'_' as u16,
            b'm' as u16,
            b'o' as u16,
            b'd' as u16,
            b'u' as u16,
            b'l' as u16,
            b'e' as u16,
            b's' as u16,
        ];
        #[cfg(not(windows))]
        const NODE_MODULES_LIT: &OSPathSlice = b"node_modules";
        let skip_dirs: &[&OSPathSlice] = if method == Method::Symlink
            && self.cache_dir_subpath.len() == 1
            && self.cache_dir_subpath.as_bytes()[0] == b'.'
        {
            &[NODE_MODULES_LIT]
        } else {
            &[]
        };

        let mut walker = bun_core::handle_oom(walker_skippable::walk_owned(
            cached_package_dir,
            &[] as &[&OSPathSlice],
            skip_dirs,
        ));
        walker.resolve_unknown_entry_types = true;

        #[cfg(not(windows))]
        {
            let subdir = match destbase.make_open_path(
                destpath.as_bytes(),
                OpenDirOptions {
                    iterate: true,
                    ..Default::default()
                },
            ) {
                Ok(d) => d,
                Err(err) => return Err(Failure::boxed(err.into(), Step::OpeningDestDir, None)),
            };
            return Ok(InstallDirState { walker, subdir });
        }

        #[cfg(windows)]
        {
            use bun_sys::windows;

            let mut buf = bun_paths::w_path_buffer_pool::get();
            let mut buf2 = bun_paths::w_path_buffer_pool::get();

            let dest_path_length =
                windows::get_final_path_name_by_handle_w(destbase.fd().native(), &mut buf[..], 0);
            if dest_path_length == 0 || dest_path_length >= buf.len() {
                let err = crate::Error::Sys(if dest_path_length == 0 {
                    windows::last_system_errno()
                } else {
                    bun_errno::SystemErrno::ENAMETOOLONG
                });
                return Err(Failure::boxed(err, Step::OpeningDestDir, None));
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

            let _ = mkdir_recursive_os_path(fullpath);
            let to_copy_buf_off = fullpath.len();

            let cache_path_length =
                windows::get_final_path_name_by_handle_w(walker.root().native(), &mut buf2[..], 0);
            if cache_path_length == 0 || cache_path_length >= buf2.len() {
                let err = crate::Error::Sys(if cache_path_length == 0 {
                    windows::last_system_errno()
                } else {
                    bun_errno::SystemErrno::ENAMETOOLONG
                });
                return Err(Failure::boxed(err, Step::CopyingFiles, None));
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
        progress: Option<&mut Progress>,
        destination_dir: &Dir,
    ) -> InstallResult {
        let mut state = match self.init_install_dir(destination_dir, Method::Copyfile) {
            Ok(state) => state,
            Err(failure) => return InstallResult::Failure(failure),
        };

        #[cfg(windows)]
        type WinSlice<'b> = &'b mut [u16];
        #[cfg(not(windows))]
        type WinSlice<'b> = ();
        #[cfg(windows)]
        type WinOffset = usize;
        #[cfg(not(windows))]
        type WinOffset = ();

        // Takes the whole buffer plus the tail's offset (not two slices of
        // one buffer) and reslices inside.
        fn copy(
            destination_dir_: &Dir,
            walker: &mut Walker,
            mut progress_: Option<&mut Progress>,
            to_copy_into1_offset: WinOffset,
            head1: WinSlice<'_>,
            to_copy_into2_offset: WinOffset,
            head2: WinSlice<'_>,
        ) -> crate::Result<()> {
            #[cfg(not(windows))]
            let mut copy_file_state = bun_sys::copy_file::CopyFileState::default();
            #[cfg(not(windows))]
            let _ = (to_copy_into1_offset, head1, to_copy_into2_offset, head2);

            while let Some(entry) = walker.next()? {
                #[cfg(windows)]
                {
                    use bun_sys::windows;
                    match entry.kind {
                        EntryKind::Directory | EntryKind::File => {}
                        _ => continue,
                    }

                    if entry.path.len() > head1.len() - to_copy_into1_offset
                        || entry.path.len() > head2.len() - to_copy_into2_offset
                    {
                        return Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
                    }

                    let dest_len = to_copy_into1_offset + entry.path.len();
                    head1[to_copy_into1_offset..dest_len].copy_from_slice(entry.path.as_slice());
                    head1[dest_len] = 0;
                    let dest = bun_core::WStr::from_buf(head1, dest_len);

                    let src_len = to_copy_into2_offset + entry.path.len();
                    head2[to_copy_into2_offset..src_len].copy_from_slice(entry.path.as_slice());
                    head2[src_len] = 0;
                    let src = bun_core::WStr::from_buf(head2, src_len);

                    match entry.kind {
                        EntryKind::Directory => {
                            if !windows::create_directory_ex_w(src, dest) {
                                let _ = bun_sys::MakePath::make_path_u16(
                                    destination_dir_,
                                    entry.path.as_slice(),
                                );
                            }
                        }
                        EntryKind::File => {
                            if !windows::copy_file_w(src, dest, false) {
                                if let Some(entry_dirname) =
                                    bun_paths::Dirname::dirname_u16(entry.path.as_slice())
                                {
                                    let _ = bun_sys::MakePath::make_path_u16(
                                        destination_dir_,
                                        entry_dirname,
                                    );
                                    if windows::copy_file_w(src, dest, false) {
                                        continue;
                                    }
                                }

                                let err = windows::last_system_errno();
                                if let Some(progress) = progress_.as_deref_mut() {
                                    progress.root.end();
                                    progress.refresh();
                                }

                                bun_core::pretty_errorln!(
                                    "<r><red>{}<r>: copying file {}",
                                    err,
                                    bun_core::fmt::fmt_os_path(
                                        entry.path.as_slice(),
                                        Default::default()
                                    )
                                );

                                Global::crash();
                            }
                        }
                        _ => unreachable!(), // handled above
                    }
                }
                #[cfg(not(windows))]
                {
                    if entry.kind != EntryKind::File {
                        continue;
                    }

                    let in_file = sys::openat(entry.dir, entry.basename, sys::O::RDONLY, 0)?;
                    let _close_in = sys::CloseOnDrop::new(in_file);

                    bun_output::scoped_log!(
                        install,
                        "create_file {} {}\n",
                        destination_dir_.fd(),
                        bstr::BStr::new(entry.path.as_bytes())
                    );
                    // Open O_WRONLY|O_CREAT|O_TRUNC, mode 0o666.
                    let create = |path: &ZStr| {
                        sys::openat(
                            destination_dir_.fd(),
                            path,
                            sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
                            0o666,
                        )
                    };
                    let outfile = match create(entry.path) {
                        Ok(f) => f,
                        Err(_) => 'brk: {
                            let entry_dirname = bun_paths::resolve_path::dirname::<
                                bun_paths::platform::Auto,
                            >(entry.path.as_bytes());
                            if !entry_dirname.is_empty() {
                                let _ = bun_sys::MakePath::make_path::<OSPathChar>(
                                    destination_dir_,
                                    entry_dirname,
                                );
                            }
                            match create(entry.path) {
                                Ok(f) => break 'brk f,
                                Err(err) => {
                                    if let Some(progress) = progress_ {
                                        progress.root.end();
                                        progress.refresh();
                                    }

                                    bun_core::pretty_errorln!(
                                        "<r><red>{}<r>: copying file {}",
                                        bstr::BStr::new(err.name()),
                                        bun_core::fmt::fmt_os_path(
                                            entry.path.as_bytes(),
                                            Default::default()
                                        )
                                    );
                                    Global::crash();
                                }
                            }
                        }
                    };
                    let _close_out = sys::CloseOnDrop::new(outfile);

                    #[cfg(unix)]
                    {
                        let Ok(stat) = sys::fstat(in_file) else {
                            continue;
                        };
                        // `sys::fchmod` is the safe by-value-fd wrapper (kernel
                        // validates the fd; no memory-safety preconditions).
                        // Result intentionally ignored.
                        let _ = sys::fchmod(outfile, stat.st_mode as bun_sys::Mode);
                    }

                    if let Err(err) = bun_sys::copy_file::copy_file_with_state(
                        in_file,
                        outfile,
                        &mut copy_file_state,
                    ) {
                        if let Some(progress) = progress_.as_deref_mut() {
                            progress.root.end();
                            progress.refresh();
                        }

                        bun_core::pretty_errorln!(
                            "<r><red>{}<r>: copying file {}",
                            bstr::BStr::new(err.name()),
                            bun_core::fmt::fmt_os_path(entry.path.as_bytes(), Default::default())
                        );
                        Global::crash();
                    }
                }
            }

            Ok(())
        }

        #[cfg(windows)]
        let result = copy(
            &state.subdir,
            &mut state.walker,
            progress,
            state.to_copy_buf_off,
            &mut state.buf[..],
            state.to_copy_buf2_off,
            &mut state.buf2[..],
        );
        #[cfg(not(windows))]
        let result = copy(&state.subdir, &mut state.walker, progress, (), (), (), ());

        if let Err(err) = result {
            return InstallResult::fail(err, Step::CopyingFiles, None);
        }

        InstallResult::Success
    }

    fn install_with_hardlink(
        &mut self,
        thread_pool: &ThreadPool,
        dest_dir: &Dir,
    ) -> crate::Result<InstallResult> {
        let mut state = match self.init_install_dir(dest_dir, Method::Hardlink) {
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

        // Takes the whole buffer plus the tail's offset (not two slices of
        // one buffer) and reslices inside.
        fn copy(
            thread_pool: &ThreadPool,
            destination_dir: &Dir,
            walker: &mut Walker,
            to_copy_into1_offset: WinOffset,
            head1: WinSlice<'_>,
            to_copy_into2_offset: WinOffset,
            head2: WinSlice<'_>,
        ) -> crate::Result<()> {
            #[cfg(not(windows))]
            let _ = (
                thread_pool,
                to_copy_into1_offset,
                head1,
                to_copy_into2_offset,
                head2,
            );
            #[cfg(windows)]
            let _ = destination_dir;
            #[cfg(windows)]
            let queue = HardLinkBatch::new();
            // on Windows, tasks already pushed to `queue` are running on
            // worker threads; an early `?` here would return before `queue.wait()`
            // while workers still report into the batch. Capture loop errors and
            // always fall through to wait.
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
                            let _ = bun_sys::MakePath::make_path::<OSPathChar>(
                                destination_dir,
                                entry.path.as_bytes(),
                            );
                        }
                        EntryKind::File => {
                            // EACCES/EPERM: FUSE (e.g. Android SDCARD) does not support hardlinks
                            fn map_linkat_err(err: sys::Error) -> crate::Error {
                                match err.get_errno() {
                                    sys::E::EXDEV | sys::E::EACCES | sys::E::EPERM => {
                                        crate::Error::NotSameFileSystem
                                    }
                                    sys::E::ENXIO => {
                                        crate::Error::Sys(bun_errno::SystemErrno::ENXIO)
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

                    if entry.path.len() > head1.len() - to_copy_into1_offset
                        || entry.path.len() > head2.len() - to_copy_into2_offset
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

                    queue.push(
                        thread_pool,
                        HardLinkWindowsInstallTask::new(
                            &queue,
                            src.as_slice(),
                            dest.as_slice(),
                            entry.basename.as_slice(),
                        ),
                    );
                }
            }

            #[cfg(windows)]
            {
                queue.wait();

                if let Some(err) = loop_err {
                    return Err(err);
                }

                // No tasks are running after `wait()`, so `.take()` is uncontended.
                if let Some(err) = queue.errored.lock().take() {
                    return Err(err);
                }
            }

            Ok(())
        }

        #[cfg(windows)]
        let result = copy(
            thread_pool,
            &state.subdir,
            &mut state.walker,
            state.to_copy_buf_off,
            &mut state.buf[..],
            state.to_copy_buf2_off,
            &mut state.buf2[..],
        );
        #[cfg(not(windows))]
        let result = copy(
            thread_pool,
            &state.subdir,
            &mut state.walker,
            (),
            (),
            (),
            (),
        );

        if let Err(err) = result {
            #[cfg(windows)]
            {
                if err == crate::Error::FailedToCopyFile {
                    return Ok(InstallResult::fail(err, Step::CopyingFiles, None));
                }
            }
            #[cfg(not(windows))]
            {
                if err == crate::Error::NotSameFileSystem
                    || err == crate::Error::Sys(bun_errno::SystemErrno::ENXIO)
                {
                    return Err(err);
                }
            }

            return Ok(InstallResult::fail(err, Step::CopyingFiles, None));
        }

        Ok(InstallResult::Success)
    }

    fn install_with_symlink(&mut self, dest_dir: &Dir) -> crate::Result<InstallResult> {
        let mut state = match self.init_install_dir(dest_dir, Method::Symlink) {
            Ok(state) => state,
            Err(failure) => return Ok(InstallResult::Failure(failure)),
        };

        #[cfg(not(windows))]
        let mut buf2 = PathBuffer::uninit();
        #[cfg(not(windows))]
        let to_copy_buf2_offset: usize;
        #[cfg(unix)]
        {
            let cache_dir_path = sys::get_fd_path(state.walker.root(), &mut buf2)?;
            let cache_len = cache_dir_path.len();
            if cache_len > 0 && cache_dir_path[cache_len - 1] != SEP {
                buf2[cache_len] = SEP;
                to_copy_buf2_offset = cache_len + 1;
            } else {
                to_copy_buf2_offset = cache_len;
            }
        }

        #[cfg(windows)]
        type WinSlice<'b> = &'b mut [u16];
        #[cfg(not(windows))]
        type WinSlice<'b> = ();
        #[cfg(windows)]
        type WinOffset = usize;
        #[cfg(not(windows))]
        type WinOffset = ();
        #[cfg(windows)]
        type Head2Char = u16;
        #[cfg(not(windows))]
        type Head2Char = u8;

        // Takes the whole buffer plus the tail's offset (not two slices of
        // one buffer) and reslices inside.
        fn copy(
            destination_dir: &Dir,
            walker: &mut Walker,
            to_copy_into1_offset: WinOffset,
            head1: WinSlice<'_>,
            to_copy_into2_offset: usize,
            head2: &mut [Head2Char],
        ) -> crate::Result<()> {
            #[cfg(not(windows))]
            let _ = (to_copy_into1_offset, head1);
            while let Some(entry) = walker.next()? {
                #[cfg(unix)]
                {
                    match entry.kind {
                        EntryKind::Directory => {
                            let _ = bun_sys::MakePath::make_path::<OSPathChar>(
                                destination_dir,
                                entry.path.as_bytes(),
                            );
                        }
                        EntryKind::File => {
                            let target_len = to_copy_into2_offset + entry.path.len();
                            head2[to_copy_into2_offset..target_len]
                                .copy_from_slice(entry.path.as_bytes());
                            head2[target_len] = 0;
                            let target = ZStr::from_buf(head2, target_len);

                            if let Err(err) =
                                sys::symlinkat(target, destination_dir.fd(), entry.path)
                            {
                                if err.get_errno() != sys::E::EEXIST {
                                    return Err(err.into());
                                }

                                let _ = sys::unlinkat(destination_dir, entry.path);
                                sys::symlinkat(entry.basename, destination_dir.fd(), entry.path)?;
                            }
                        }
                        _ => {}
                    }
                }
                #[cfg(not(unix))]
                {
                    use bun_sys::windows;
                    match entry.kind {
                        EntryKind::Directory | EntryKind::File => {}
                        _ => continue,
                    }

                    if entry.path.len() > head1.len() - to_copy_into1_offset
                        || entry.path.len() > head2.len() - to_copy_into2_offset
                    {
                        return Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
                    }

                    let dest_len = to_copy_into1_offset + entry.path.len();
                    head1[to_copy_into1_offset..dest_len].copy_from_slice(entry.path.as_slice());
                    head1[dest_len] = 0;
                    let dest = bun_core::WStr::from_buf(head1, dest_len);

                    let src_len = to_copy_into2_offset + entry.path.len();
                    head2[to_copy_into2_offset..src_len].copy_from_slice(entry.path.as_slice());
                    head2[src_len] = 0;
                    let src = bun_core::WStr::from_buf(head2, src_len);

                    match entry.kind {
                        EntryKind::Directory => {
                            if !windows::create_directory_ex_w(src, dest) {
                                let _ = bun_sys::MakePath::make_path_u16(
                                    destination_dir,
                                    entry.path.as_slice(),
                                );
                            }
                        }
                        EntryKind::File => match sys::symlink_w(dest, src, Default::default()) {
                            Err(err) => {
                                if let Some(entry_dirname) =
                                    bun_paths::Dirname::dirname_u16(entry.path.as_slice())
                                {
                                    let _ = bun_sys::MakePath::make_path_u16(
                                        destination_dir,
                                        entry_dirname,
                                    );
                                    if sys::symlink_w(dest, src, Default::default()).is_ok() {
                                        continue;
                                    }
                                }

                                if PackageManager::verbose_install() {
                                    bun_core::run_once! {{
                                        bun_core::warn!(
                                            "CreateHardLinkW failed, falling back to CopyFileW: {} -> {}\n",
                                            bun_core::fmt::fmt_os_path(src.as_slice(), Default::default()),
                                            bun_core::fmt::fmt_os_path(dest.as_slice(), Default::default()),
                                        );
                                    }}
                                }

                                return Err(err.into());
                            }
                            Ok(_) => {}
                        },
                        _ => unreachable!(), // handled above
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
        let result = copy(
            &state.subdir,
            &mut state.walker,
            (),
            (),
            to_copy_buf2_offset,
            &mut buf2[..],
        );

        if let Err(err) = result {
            #[cfg(windows)]
            {
                if err == crate::Error::FailedToCopyFile {
                    return Ok(InstallResult::fail(err, Step::CopyingFiles, None));
                }
            }
            #[cfg(not(windows))]
            {
                if err == crate::Error::NotSameFileSystem
                    || err == crate::Error::Sys(bun_errno::SystemErrno::ENXIO)
                {
                    return Err(err);
                }
            }
            return Ok(InstallResult::fail(err, Step::CopyingFiles, None));
        }

        Ok(InstallResult::Success)
    }

    pub(crate) fn uninstall_before_install(
        &self,
        manager: &mut PackageManager,
        destination_dir: &Dir,
    ) {
        let mut rand_path_buf = [0u8; 48];
        let rand_bytes = bun_core::fast_random().to_ne_bytes();
        let temp_path = {
            use std::io::Write;
            let mut cursor = &mut rand_path_buf[..];
            write!(cursor, ".old-{}", bun_core::fmt::hex_upper(&rand_bytes))
                .expect("infallible: in-memory write");
            let written = 48 - cursor.len();
            rand_path_buf[written] = 0;
            ZStr::from_buf(&rand_path_buf, written)
        };

        match sys::renameat(
            destination_dir.fd(),
            self.destination_dir_subpath(),
            destination_dir.fd(),
            temp_path,
        ) {
            Err(_) => {
                // if it fails, that means the directory doesn't exist or was inaccessible
            }
            Ok(_) => {
                // Uninstall can sometimes take awhile in a large directory
                // tree. Since we're renaming the directory to a randomly
                // generated name, we can delete it in another thread without
                // worrying about race conditions or blocking the main thread.
                //
                // This should be a slight improvement to CI environments.
                //
                // on macOS ARM64 in a project with Gatsby, @mui/icons-material, and Next.js:
                //
                // ❯ hyperfine "bun install --ignore-scripts" "bun-1.1.2 install --ignore-scripts" --prepare="rm -rf node_modules/**/package.json" --warmup=2
                // Benchmark 1: bun install --ignore-scripts
                //   Time (mean ± σ):      2.281 s ±  0.027 s    [User: 0.041 s, System: 6.851 s]
                //   Range (min … max):    2.231 s …  2.312 s    10 runs
                //
                // Benchmark 2: bun-1.1.2 install --ignore-scripts
                //   Time (mean ± σ):      3.315 s ±  0.033 s    [User: 0.029 s, System: 2.237 s]
                //   Range (min … max):    3.279 s …  3.356 s    10 runs
                //
                // Summary
                //   bun install --ignore-scripts ran
                //     1.45 ± 0.02 times faster than bun-1.1.2 install --ignore-scripts
                //
                let absolute_path = path::resolve_path::join_abs_string::<path::platform::Auto>(
                    bun_fs::FileSystem::instance().top_level_dir(),
                    &[&self.node_modules.path, temp_path.as_bytes()],
                );
                manager.total_tasks += 1;
                manager.shared.pending_tasks.fetch_add(1, Ordering::Relaxed);
                manager.thread_pool.schedule_owned(Box::new(UninstallTask {
                    absolute_path: absolute_path.to_vec().into_boxed_slice(),
                    task: WorkPoolTask::default(),
                    shared: manager.shared,
                }));
            }
        }
    }

    pub(crate) fn is_dangling_symlink(path: &ZStr) -> bool {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            match sys::open(path, sys::O::PATH, 0) {
                Err(_) => return true,
                Ok(fd) => {
                    fd.close();
                    return false;
                }
            }
        }
        #[cfg(windows)]
        {
            match sys::sys_uv::open(path, 0, 0) {
                Err(_) => return true,
                Ok(fd) => {
                    fd.close();
                    return false;
                }
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", windows)))]
        {
            match sys::open(path, sys::O::PATH, 0) {
                Err(_) => return true,
                Ok(fd) => {
                    fd.close();
                    return false;
                }
            }
        }
    }

    pub(crate) fn install_from_link(
        &mut self,
        manager: &mut PackageManager,
        skip_delete: bool,
        destination_dir: &Dir,
    ) -> InstallResult {
        // If this fails, we don't care.
        // we'll catch it the next error
        if !skip_delete && self.destination_dir_subpath().as_bytes() != b"." {
            self.uninstall_before_install(manager, destination_dir);
        }
        let dest_path = self.destination_dir_subpath();

        // `None` when there is no directory component.
        let dirname_slice =
            path::resolve_path::dirname::<path::platform::Auto>(dest_path.as_bytes());
        let subdir: Option<&[u8]> = (!dirname_slice.is_empty()
            && dirname_slice != dest_path.as_bytes())
        .then_some(dirname_slice);

        let mut dest_buf = PathBuffer::uninit();
        // cache_dir_subpath in here is actually the full path to the symlink pointing to the linked package
        let symlinked_path = self.cache_dir_subpath;
        let mut to_buf = PathBuffer::uninit();
        // Open the target relative to cache_dir, then resolve its canonical path.
        // Returning a borrow of `to_buf` from an `FnMut` closure is rejected by
        // borrowck, so inline the open/get_fd_path/close.
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
                    return InstallResult::fail(realpath_err(err), Step::LinkingDependency, None);
                }
            };
            let res = sys::get_fd_path(fd, &mut to_buf);
            fd.close();
            match res {
                Ok(s) => &*s,
                Err(err) => {
                    return InstallResult::fail(realpath_err(err), Step::LinkingDependency, None);
                }
            }
        };
        let dest = bun_paths::basename(dest_path.as_bytes());
        // When we're linking on Windows, we want to avoid keeping the source directory handle open
        #[cfg(windows)]
        {
            use bun_sys::windows;
            let mut wbuf = bun_paths::WPathBuffer::uninit();
            let dest_path_length = windows::get_final_path_name_by_handle_w(
                destination_dir.fd().native(),
                &mut wbuf[..],
                0,
            );
            if dest_path_length == 0 || dest_path_length >= wbuf.len() {
                let err = crate::Error::Sys(if dest_path_length == 0 {
                    windows::last_system_errno()
                } else {
                    bun_errno::SystemErrno::ENAMETOOLONG
                });
                return InstallResult::fail(err, Step::LinkingDependency, None);
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
                let fullpath = bun_core::WStr::from_buf(&wbuf[..], i);

                let _ = mkdir_recursive_os_path(fullpath);
            }

            let res = strings::copy_utf16_into_utf8(&mut dest_buf[..], &wbuf[..i]);
            let mut offset: usize = res.written as usize;
            if dest_buf[offset - 1] != bun_paths::SEP_WINDOWS {
                dest_buf[offset] = bun_paths::SEP_WINDOWS;
                offset += 1;
            }
            dest_buf[offset..offset + dest.len()].copy_from_slice(dest);
            offset += dest.len();
            dest_buf[offset] = 0;

            let dest_z = ZStr::from_buf(&dest_buf, offset);

            let to_len = to_path.len();
            to_buf[to_len] = 0;
            let target_z = ZStr::from_buf(&to_buf, to_len);

            // https://github.com/npm/cli/blob/162c82e845d410ede643466f9f8af78a312296cc/workspaces/arborist/lib/arborist/reify.js#L738
            // https://github.com/npm/cli/commit/0e58e6f6b8f0cd62294642a502c17561aaf46553
            match sys::symlink_or_junction(dest_z, target_z, None) {
                Err(err_) => 'brk: {
                    let mut err = err_;
                    if err.get_errno() == sys::E::EEXIST {
                        let _ = sys::rmdirat(destination_dir.fd(), self.destination_dir_subpath());
                        match sys::symlink_or_junction(dest_z, target_z, None) {
                            Err(e) => err = e,
                            Ok(_) => break 'brk,
                        }
                    }

                    return InstallResult::fail(
                        bun_errno::from_errno(err.errno.into()).into(),
                        Step::LinkingDependency,
                        None,
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
                            return InstallResult::fail(err.into(), Step::LinkingDependency, None);
                        }
                    },
                )
            } else {
                None
            };
            let dest_dir: &Dir = owned_dest_dir.as_ref().unwrap_or(destination_dir);

            let dest_dir_path = match sys::get_fd_path(dest_dir.fd(), &mut dest_buf) {
                Ok(p) => p,
                Err(err) => return InstallResult::fail(err.into(), Step::LinkingDependency, None),
            };

            let target = path::resolve_path::relative(dest_dir_path, to_path);
            // `symlinkat` takes `&ZStr` for both target and dest; build NUL-terminated
            // copies in stack buffers.
            let mut target_buf = PathBuffer::uninit();
            target_buf[..target.len()].copy_from_slice(target);
            target_buf[target.len()] = 0;
            let target_z = ZStr::from_buf(&target_buf, target.len());
            let mut dest_name_buf = [0u8; 512];
            dest_name_buf[..dest.len()].copy_from_slice(dest);
            let dest_z = ZStr::from_buf(&dest_name_buf, dest.len());
            if let Err(err) = sys::symlinkat(target_z, dest_dir.fd(), dest_z) {
                return InstallResult::fail(err.into(), Step::LinkingDependency, None);
            }
        }

        if Self::is_dangling_symlink(symlinked_path) {
            return InstallResult::fail(
                crate::Error::DanglingSymlink,
                Step::LinkingDependency,
                None,
            );
        }

        InstallResult::Success
    }

    pub(crate) fn get_install_method(&self) -> Method {
        if self.cache_dir_subpath.as_bytes() == b"."
            || self.cache_dir_subpath.as_bytes().starts_with(b"..")
        {
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
        let state = manager.get_preinstall_state(package_id);
        match state {
            crate::PreinstallState::Done => false,
            _ => {
                let exists = if self.patch.is_none() {
                    crate::package_manager::directories::is_package_in_cache_at(
                        self.cache_dir,
                        self.cache_dir_subpath,
                        resolution_tag,
                    )
                } else {
                    let idx =
                        strings::last_index_of(self.cache_dir_subpath.as_bytes(), b"_patch_hash=")
                            .unwrap_or_else(|| {
                                panic!("Patched dependency cache dir subpath does not have the \"_patch_hash=HASH\" suffix. This is a bug, please file a GitHub issue.")
                            });
                    let non_patched =
                        bun_core::ZBox::from_bytes(&self.cache_dir_subpath.as_bytes()[..idx]);
                    crate::package_manager::directories::is_package_in_cache_at(
                        self.cache_dir,
                        &non_patched,
                        resolution_tag,
                    )
                };
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
        mut env: InstallEnv<'_>,
        skip_delete: bool,
        destination_dir: &Dir,
        method_: Method,
        resolution_tag: resolution::Tag,
    ) -> InstallResult {
        let _tracer = bun_core::perf::trace("PackageInstaller.install");

        // If this fails, we don't care.
        // we'll catch it the next error
        if !skip_delete && self.destination_dir_subpath().as_bytes() != b"." {
            if let InstallEnv::Manager(manager) = &mut env {
                self.uninstall_before_install(manager, destination_dir);
            }
        }

        let mut supported_method_to_use = method_;

        if resolution_tag == resolution::Tag::Folder
            && !env
                .lockfile()
                .is_workspace_tree_id(self.node_modules.tree_id)
        {
            supported_method_to_use = Method::Symlink;
        }

        match supported_method_to_use {
            Method::Clonefile => {
                #[cfg(target_os = "macos")]
                {
                    // First, attempt to use clonefile
                    // if that fails due to ENOTSUP, mark it as unsupported and then fall back to copyfile
                    match self.install_with_clonefile(destination_dir) {
                        Ok(result) => return result,
                        Err(err) => {
                            if err == crate::Error::NotSupported {
                                Self::set_supported_method(Method::Copyfile);
                                supported_method_to_use = Method::Copyfile;
                            } else if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                                return InstallResult::fail(
                                    crate::Error::Sys(bun_errno::SystemErrno::ENOENT),
                                    Step::OpeningCacheDir,
                                    None,
                                );
                            } else {
                                return InstallResult::fail(err, Step::CopyingFiles, None);
                            }
                        }
                    }
                }
            }
            Method::ClonefileEachDir => {
                #[cfg(target_os = "macos")]
                {
                    match self.install_with_clonefile_each_dir(destination_dir) {
                        Ok(result) => return result,
                        Err(err) => {
                            if err == crate::Error::NotSupported {
                                Self::set_supported_method(Method::Copyfile);
                                supported_method_to_use = Method::Copyfile;
                            } else if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                                return InstallResult::fail(
                                    crate::Error::Sys(bun_errno::SystemErrno::ENOENT),
                                    Step::OpeningCacheDir,
                                    None,
                                );
                            } else {
                                return InstallResult::fail(err, Step::CopyingFiles, None);
                            }
                        }
                    }
                }
            }
            #[allow(unused_labels)]
            Method::Hardlink => 'outer: {
                match self.install_with_hardlink(env.thread_pool(), destination_dir) {
                    Ok(result) => return result,
                    Err(err) => {
                        #[cfg(not(windows))]
                        {
                            if err == crate::Error::NotSameFileSystem {
                                Self::set_supported_method(Method::Copyfile);
                                supported_method_to_use = Method::Copyfile;
                                break 'outer;
                            }
                        }

                        return if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                            InstallResult::fail(
                                crate::Error::Sys(bun_errno::SystemErrno::ENOENT),
                                Step::OpeningCacheDir,
                                None,
                            )
                        } else {
                            InstallResult::fail(err, Step::CopyingFiles, None)
                        };
                    }
                }
            }
            Method::Symlink => {
                return match self.install_with_symlink(destination_dir) {
                    Ok(result) => result,
                    Err(err) => {
                        if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                            InstallResult::fail(err, Step::OpeningCacheDir, None)
                        } else {
                            InstallResult::fail(err, Step::CopyingFiles, None)
                        }
                    }
                };
            }
            _ => {}
        }

        if supported_method_to_use != Method::Copyfile {
            return InstallResult::Success;
        }

        // TODO: linux io_uring
        self.install_with_copyfile(env.progress(), destination_dir)
    }
}

type Walker = walker_skippable::Walker;
