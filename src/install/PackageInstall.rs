use core::ffi::c_int;
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_collections::{ArrayHashMap, DynamicBitSet};
use bun_core::{Global, MutableString, Output, Progress};
use bun_logger as logger;
use bun_paths::{self as path, OSPathChar, OSPathSlice, PathBuffer, WPathBuffer, MAX_PATH_BYTES, SEP, SEP_STR};
use bun_semver::String as SemverString;
use bun_str::{strings, ZStr};
use bun_sys::{self as sys, Dir, Fd};
use bun_threading::{ThreadPool, WaitGroup, WorkPoolTask};

use crate::{
    buntaghashbuf_make, initialize_store, BuntagHashBuf, Lockfile, Npm, PackageID, PackageManager,
    Repository, Resolution, TruncatedPackageNameHash,
};
use crate::package_manager::package_installer::NodeModulesFolder;

// TODO(port): `std.fs.Dir` is used pervasively here; Zig has a TODO to switch to `bun.FD.Dir`.
// Phase A maps it to `bun_sys::Dir` (an Fd-backed dir handle). Method names (.close(), .fd,
// .makeOpenPath, .deleteTree, .realpath, .makeDirZ) are assumed on that type.

bun_output::declare_scope!(install, hidden);

pub struct PackageInstall<'a> {
    /// TODO: Change to bun.FD.Dir
    pub cache_dir: Dir,
    pub cache_dir_subpath: &'a ZStr,
    // TODO(port): `destination_dir_subpath` aliases into `destination_dir_subpath_buf`;
    // borrowck will reject simultaneous &ZStr + &mut [u8]. Phase B may store only the len.
    pub destination_dir_subpath: &'a ZStr,
    pub destination_dir_subpath_buf: &'a mut [u8],

    // allocator: std.mem.Allocator — deleted (global mimalloc)
    pub progress: Option<&'a mut Progress>,

    pub package_name: SemverString,
    pub package_version: &'a [u8],
    pub patch: Option<Patch>,

    // TODO: this is never read
    pub file_count: u32,
    pub node_modules: &'a NodeModulesFolder,
    pub lockfile: &'a Lockfile,
}

pub struct Patch {
    pub path: Box<[u8]>,
    pub contents_hash: u64,
}

#[derive(Default)]
pub struct Summary {
    pub fail: u32,
    pub success: u32,
    pub skipped: u32,
    pub successfully_installed: Option<DynamicBitSet>,

    /// Package name hash -> number of scripts skipped.
    /// Multiple versions of the same package might add to the count, and each version
    /// might have a different number of scripts
    pub packages_with_blocked_scripts: ArrayHashMap<TruncatedPackageNameHash, usize>,
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

type BackendSupport = enum_map::EnumMap<Method, bool>;

pub static METHOD_MAP: phf::Map<&'static [u8], Method> = phf::phf_map! {
    b"clonefile" => Method::Clonefile,
    b"clonefile_each_dir" => Method::ClonefileEachDir,
    b"hardlink" => Method::Hardlink,
    b"copyfile" => Method::Copyfile,
    b"symlink" => Method::Symlink,
};

impl Method {
    // TODO(port): EnumMap const-init — `enum_map!` macro at static init.
    pub fn macos() -> BackendSupport {
        enum_map::enum_map! {
            Method::Clonefile => true,
            Method::ClonefileEachDir => true,
            Method::Hardlink => true,
            Method::Copyfile => true,
            Method::Symlink => true,
        }
    }

    pub fn linux() -> BackendSupport {
        enum_map::enum_map! {
            Method::Clonefile => false,
            Method::ClonefileEachDir => false,
            Method::Hardlink => true,
            Method::Copyfile => true,
            Method::Symlink => true,
        }
    }

    pub fn windows() -> BackendSupport {
        enum_map::enum_map! {
            Method::Clonefile => false,
            Method::ClonefileEachDir => false,
            Method::Hardlink => true,
            Method::Copyfile => true,
            Method::Symlink => false,
        }
    }

    #[inline]
    pub fn is_supported(self) -> bool {
        #[cfg(target_os = "macos")]
        {
            return Self::macos()[self];
        }
        #[cfg(any(target_os = "linux", target_os = "freebsd"))]
        {
            return Self::linux()[self];
        }
        #[cfg(windows)]
        {
            return Self::windows()[self];
        }
        #[allow(unreachable_code)]
        false
    }
}

#[derive(Copy, Clone)]
pub struct Failure {
    pub err: bun_core::Error,
    pub step: Step,
    #[cfg(debug_assertions)]
    pub debug_trace: bun_crash_handler::StoredTrace,
}

impl Failure {
    #[inline]
    pub fn is_package_missing_from_cache(&self) -> bool {
        (self.err == bun_core::err!("FileNotFound") || self.err == bun_core::err!("ENOENT"))
            && self.step == Step::OpeningCacheDir
    }
}

pub enum InstallResult {
    Success,
    Failure(Failure),
}

impl InstallResult {
    /// Init a Result with the 'fail' tag. use `.Success` for the 'success' tag.
    #[inline]
    pub fn fail(err: bun_core::Error, step: Step, _trace: Option<&bun_crash_handler::StackTrace>) -> InstallResult {
        InstallResult::Failure(Failure {
            err,
            step,
            #[cfg(debug_assertions)]
            debug_trace: match _trace {
                Some(t) => bun_crash_handler::StoredTrace::from(t),
                None => bun_crash_handler::StoredTrace::capture(/* @returnAddress() */),
            },
        })
    }

    pub fn is_fail(&self) -> bool {
        matches!(self, InstallResult::Failure(_))
    }
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Step {
    Copyfile,
    OpeningCacheDir,
    OpeningDestDir,
    CopyingFiles,
    Linking,
    LinkingDependency,
    Patching,
}

impl Step {
    /// "error: failed {s} for package"
    pub fn name(self) -> &'static [u8] {
        match self {
            Step::Copyfile | Step::CopyingFiles => b"copying files from cache to destination",
            Step::OpeningCacheDir => b"opening cache/package/version dir",
            Step::OpeningDestDir => b"opening node_modules/package dir",
            Step::Linking => b"linking bins",
            Step::LinkingDependency => b"linking dependency/workspace to node_modules",
            Step::Patching => b"patching dependency",
        }
    }
}

// TODO(port): mutable global. Single-threaded install context writes this; consider AtomicU8.
pub static mut SUPPORTED_METHOD: Method = if cfg!(target_os = "macos") {
    Method::Clonefile
} else {
    Method::Hardlink
};

// ───────────────────────────── InstallDirState ─────────────────────────────

struct InstallDirState {
    cached_package_dir: Dir,
    walker: Walker,
    subdir: Dir,
    #[cfg(windows)]
    buf: WPathBuffer,
    #[cfg(windows)]
    buf2: WPathBuffer,
    #[cfg(windows)]
    to_copy_buf: *mut [u16], // slice into `buf`
    #[cfg(windows)]
    to_copy_buf2: *mut [u16], // slice into `buf2`
}

impl Default for InstallDirState {
    fn default() -> Self {
        // TODO(port): Zig used `undefined` for most fields; we need a sentinel.
        Self {
            cached_package_dir: Dir::invalid(),
            walker: Walker::default(),
            #[cfg(not(windows))]
            subdir: Dir::invalid(),
            #[cfg(windows)]
            subdir: Dir::from_raw(bun_sys::windows::INVALID_HANDLE_VALUE),
            #[cfg(windows)]
            buf: WPathBuffer::uninit(),
            #[cfg(windows)]
            buf2: WPathBuffer::uninit(),
            #[cfg(windows)]
            to_copy_buf: core::ptr::slice_from_raw_parts_mut(core::ptr::null_mut(), 0),
            #[cfg(windows)]
            to_copy_buf2: core::ptr::slice_from_raw_parts_mut(core::ptr::null_mut(), 0),
        }
    }
}

impl Drop for InstallDirState {
    fn drop(&mut self) {
        #[cfg(not(windows))]
        {
            self.subdir.close();
        }
        // walker dropped automatically
        self.cached_package_dir.close();
    }
}

// ───────────────────────────── thread-local NodeFS ─────────────────────────────

// TODO(port): `bun.ThreadlocalBuffers(struct { fs: NodeFS })` — using thread_local! directly.
// MOVE_DOWN(b0): node::fs::NodeFS → bun_sys (path-buffer mkdir/cp helpers; no JS dependency).
thread_local! {
    static NODE_FS_BUFS: core::cell::RefCell<bun_sys::node_fs::NodeFS> =
        const { core::cell::RefCell::new(bun_sys::node_fs::NodeFS::new()) };
}

#[inline]
fn node_fs_for_package_installer<R>(f: impl FnOnce(&mut bun_sys::node_fs::NodeFS) -> R) -> R {
    NODE_FS_BUFS.with_borrow_mut(f)
}

// ───────────────────────────── NewTaskQueue ─────────────────────────────

pub struct NewTaskQueue<TaskType> {
    pub thread_pool: &'static ThreadPool,
    pub errored_task: AtomicPtr<TaskType>,
    pub wait_group: WaitGroup,
}

impl<TaskType> NewTaskQueue<TaskType> {
    pub fn complete_one(&self) {
        self.wait_group.finish();
    }

    pub fn push(&self, task: *mut TaskType)
    where
        TaskType: HasWorkPoolTask,
    {
        self.wait_group.add_one();
        // SAFETY: task is a valid Box-allocated task; .task field is the intrusive node.
        self.thread_pool
            .schedule(ThreadPool::Batch::from(unsafe { &mut (*task).task() }));
    }

    pub fn wait(&self) {
        self.wait_group.wait();
    }
}

// TODO(port): helper trait so `NewTaskQueue::push` can reach the intrusive `.task` field generically.
pub trait HasWorkPoolTask {
    fn task(&mut self) -> &mut WorkPoolTask;
}

// ───────────────────────────── HardLinkWindowsInstallTask ─────────────────────────────

#[cfg(windows)]
pub struct HardLinkWindowsInstallTask {
    bytes: Box<[u16]>,
    // SAFETY: src/dest are slices into `bytes`; self-referential — kept as raw ptrs.
    src: *mut bun_str::WStr,
    dest: *mut bun_str::WStr,
    basename: u16,
    task: WorkPoolTask,
    err: Option<bun_core::Error>,
}

#[cfg(windows)]
impl HasWorkPoolTask for HardLinkWindowsInstallTask {
    fn task(&mut self) -> &mut WorkPoolTask {
        &mut self.task
    }
}

#[cfg(windows)]
pub type HardLinkQueue = NewTaskQueue<HardLinkWindowsInstallTask>;

#[cfg(windows)]
static mut HARDLINK_QUEUE: core::mem::MaybeUninit<HardLinkQueue> = core::mem::MaybeUninit::uninit();

#[cfg(windows)]
impl HardLinkWindowsInstallTask {
    pub fn init_queue() -> &'static mut HardLinkQueue {
        // SAFETY: called once per install batch on the main thread before any push().
        unsafe {
            HARDLINK_QUEUE.write(HardLinkQueue {
                thread_pool: &PackageManager::get().thread_pool,
                errored_task: AtomicPtr::new(core::ptr::null_mut()),
                wait_group: WaitGroup::init(),
            });
            HARDLINK_QUEUE.assume_init_mut()
        }
    }

    pub fn init(src: &[OSPathChar], dest: &[OSPathChar], basename: &[OSPathChar]) -> *mut Self {
        let allocation_size = src.len() + 1 + dest.len() + 1;

        let mut combined = vec![0u16; allocation_size].into_boxed_slice();
        let mut remaining = &mut combined[..];
        remaining[..src.len()].copy_from_slice(src);
        remaining[src.len()] = 0;
        // SAFETY: NUL written at [src.len()]
        let src_ = unsafe { bun_str::WStr::from_raw_mut(remaining.as_mut_ptr(), src.len()) } as *mut _;
        remaining = &mut remaining[src.len() + 1..];

        remaining[..dest.len()].copy_from_slice(dest);
        remaining[dest.len()] = 0;
        // SAFETY: NUL written at [dest.len()]
        let dest_ = unsafe { bun_str::WStr::from_raw_mut(remaining.as_mut_ptr(), dest.len()) } as *mut _;
        // remaining = &mut remaining[dest.len() + 1..]; // unused

        Box::into_raw(Box::new(Self {
            bytes: combined,
            src: src_,
            dest: dest_,
            basename: basename.len() as u16, // @truncate
            task: WorkPoolTask { callback: Self::run_from_thread_pool },
            err: None,
        }))
    }

    fn run_from_thread_pool(task: *mut WorkPoolTask) {
        // SAFETY: task points to the `task` field of a HardLinkWindowsInstallTask.
        let self_: *mut Self = unsafe {
            (task as *mut u8)
                .sub(core::mem::offset_of!(Self, task))
                .cast::<Self>()
        };
        // SAFETY: HARDLINK_QUEUE initialized by init_queue() before scheduling.
        let queue = unsafe { HARDLINK_QUEUE.assume_init_ref() };
        let _guard = scopeguard::guard((), |_| queue.complete_one());

        // SAFETY: self_ is valid until deinit().
        if let Some(err) = unsafe { (*self_).run() } {
            unsafe { (*self_).err = Some(err) };
            // .Relaxed is okay because this value isn't read until all the tasks complete.
            // Use compare_exchange to keep only the first error.
            let _ = queue.errored_task.compare_exchange(
                core::ptr::null_mut(),
                self_,
                Ordering::Relaxed,
                Ordering::Relaxed,
            );
            return;
        }
        // SAFETY: self_ was Box::into_raw'd in init().
        unsafe { drop(Box::from_raw(self_)) };
    }

    fn run(&mut self) -> Option<bun_core::Error> {
        use bun_sys::windows;
        // SAFETY: src/dest point into self.bytes which lives for self's lifetime.
        let src = unsafe { &mut *self.src };
        let dest = unsafe { &mut *self.dest };

        // SAFETY: FFI — src/dest are valid NUL-terminated WStr buffers backed by self.bytes.
        if unsafe { windows::CreateHardLinkW(dest.as_ptr(), src.as_ptr(), core::ptr::null_mut()) } != 0 {
            return None;
        }

        match windows::GetLastError() {
            windows::Win32Error::ALREADY_EXISTS
            | windows::Win32Error::FILE_EXISTS
            | windows::Win32Error::CANNOT_MAKE => {
                // Race condition: this shouldn't happen
                if cfg!(debug_assertions) {
                    bun_output::scoped_log!(
                        install,
                        "CreateHardLinkW returned EEXIST, this shouldn't happen: {}",
                        bun_core::fmt::fmt_path_u16(dest.as_slice())
                    );
                }
                // SAFETY: FFI — dest is a valid NUL-terminated WStr buffer.
                unsafe { windows::DeleteFileW(dest.as_ptr()) };
                // SAFETY: FFI — src/dest are valid NUL-terminated WStr buffers.
                if unsafe { windows::CreateHardLinkW(dest.as_ptr(), src.as_ptr(), core::ptr::null_mut()) } != 0 {
                    return None;
                }
            }
            _ => {}
        }

        let dest_bytes = dest.as_mut_slice_with_nul();
        let dirpath_len = dest.len() - usize::from(self.basename) - 1;
        dest_bytes[dirpath_len] = 0;
        // SAFETY: NUL written at [dirpath_len].
        let dirpath = unsafe { bun_str::WStr::from_raw(dest_bytes.as_ptr(), dirpath_len) };
        let _ = node_fs_for_package_installer(|nfs| {
            nfs.mkdir_recursive_os_path_impl((), dirpath, 0, false).unwrap()
        });
        dest_bytes[dirpath_len] = bun_paths::SEP_WINDOWS as u16;

        // SAFETY: FFI — src/dest are valid NUL-terminated WStr buffers.
        if unsafe { windows::CreateHardLinkW(dest.as_ptr(), src.as_ptr(), core::ptr::null_mut()) } != 0 {
            return None;
        }

        if PackageManager::verbose_install() {
            static ONCE: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
            if !ONCE.swap(true, Ordering::Relaxed) {
                Output::warn(
                    "CreateHardLinkW failed, falling back to CopyFileW: {} -> {}\n",
                    format_args!(
                        "{} -> {}",
                        bun_core::fmt::fmt_os_path(src.as_slice()),
                        bun_core::fmt::fmt_os_path(dest.as_slice())
                    ),
                );
            }
        }

        // SAFETY: FFI — src/dest are valid NUL-terminated WStr buffers.
        if unsafe { windows::CopyFileW(src.as_ptr(), dest.as_ptr(), 0) } != 0 {
            return None;
        }

        Some(windows::get_last_error())
    }
}

// `deinit` for HardLinkWindowsInstallTask becomes Drop on Box (bytes freed automatically).

// ───────────────────────────── UninstallTask ─────────────────────────────

struct UninstallTask {
    absolute_path: Box<[u8]>,
    task: WorkPoolTask,
}

impl UninstallTask {
    fn run(task: *mut WorkPoolTask) {
        // SAFETY: task points to the `task` field of an UninstallTask.
        let uninstall_task: *mut Self = unsafe {
            (task as *mut u8)
                .sub(core::mem::offset_of!(Self, task))
                .cast::<Self>()
        };
        // SAFETY: Box::into_raw'd in uninstall_before_install; reclaim ownership here.
        let uninstall_task = unsafe { Box::from_raw(uninstall_task) };

        let mut debug_timer = Output::DebugTimer::start();
        let _guard = scopeguard::guard((), |_| {
            PackageManager::get().decrement_pending_tasks();
            PackageManager::get().wake();
        });

        let Some(dirname) = bun_paths::dirname(&uninstall_task.absolute_path) else {
            Output::debug_warn(format_args!(
                "Unexpectedly failed to get dirname of {}",
                bstr::BStr::new(&uninstall_task.absolute_path)
            ));
            return;
        };
        let basename = bun_paths::basename(&uninstall_task.absolute_path);

        let dir = match bun_sys::open_dir_a(Dir::cwd(), dirname) {
            Ok(d) => d,
            Err(err) => {
                if cfg!(debug_assertions) || cfg!(feature = "asan") {
                    Output::debug_warn(format_args!(
                        "Failed to delete {}: {}",
                        bstr::BStr::new(&uninstall_task.absolute_path),
                        err.name()
                    ));
                }
                return;
            }
        };
        let _close = scopeguard::guard(dir, |d| Fd::from_std_dir(d).close());

        if let Err(err) = dir.delete_tree(basename) {
            if cfg!(debug_assertions) || cfg!(feature = "asan") {
                Output::debug_warn(format_args!(
                    "Failed to delete {} in {}: {}",
                    bstr::BStr::new(basename),
                    bstr::BStr::new(dirname),
                    err.name()
                ));
            }
        }

        if cfg!(debug_assertions) {
            let _ = &mut debug_timer;
            bun_output::scoped_log!(
                install,
                "deleteTree({}, {}) = {}",
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
    fn verify_patch_hash(&mut self, patch: &Patch, root_node_modules_dir: Dir) -> bool {
        // hash from the .patch file, to be checked against bun tag
        let patchfile_contents_hash = patch.contents_hash;
        let mut buf: BuntagHashBuf = BuntagHashBuf::default();
        let bunhashtag = buntaghashbuf_make(&mut buf, patchfile_contents_hash);

        let patch_tag_path = path::join_z(
            &[self.destination_dir_subpath.as_bytes(), bunhashtag],
            path::Style::Posix,
        );

        let Ok(destination_dir) = self.node_modules.open_dir(root_node_modules_dir) else {
            return false;
        };
        let _close = scopeguard::guard(destination_dir, |d| {
            if Dir::cwd().fd() != d.fd() {
                d.close();
            }
        });

        #[cfg(unix)]
        {
            if sys::fstatat(Fd::from_std_dir(destination_dir), patch_tag_path)
                .unwrap()
                .is_err()
            {
                return false;
            }
        }
        #[cfg(not(unix))]
        {
            match sys::openat(Fd::from_std_dir(destination_dir), patch_tag_path, sys::O::RDONLY, 0) {
                sys::Result::Err(_) => return false,
                sys::Result::Ok(fd) => fd.close(),
            }
        }

        true
    }

    // 1. verify that .bun-tag exists (was it installed from bun?)
    // 2. check .bun-tag against the resolved version
    fn verify_git_resolution(&mut self, repo: &Repository, root_node_modules_dir: Dir) -> bool {
        let dest_len = self.destination_dir_subpath.len();
        let suffix: &[u8] = &[SEP, b'.', b'b', b'u', b'n', b'-', b't', b'a', b'g'];
        // PORT NOTE: reshaped for borrowck — write into buf via raw indices.
        self.destination_dir_subpath_buf[dest_len..dest_len + suffix.len()].copy_from_slice(suffix);
        self.destination_dir_subpath_buf[dest_len + SEP_STR.len() + b".bun-tag".len()] = 0;
        // SAFETY: NUL written above.
        let bun_tag_path = unsafe {
            ZStr::from_raw_mut(
                self.destination_dir_subpath_buf.as_mut_ptr(),
                dest_len + SEP_STR.len() + b".bun-tag".len(),
            )
        };
        let _restore = scopeguard::guard(
            self.destination_dir_subpath_buf.as_mut_ptr(),
            // SAFETY: p points into destination_dir_subpath_buf which outlives this scope;
            // dest_len < buf capacity (was the prior NUL position).
            move |p| unsafe { *p.add(dest_len) = 0 },
        );
        // PERF(port): was stack-fallback alloc — profile in Phase B

        let Ok(bun_tag_file) =
            self.node_modules
                .read_small_file(root_node_modules_dir, bun_tag_path)
        else {
            return false;
        };
        // bun_tag_file.bytes dropped at scope exit

        strings::eql_long(
            repo.resolved.slice(&self.lockfile.buffers.string_bytes),
            &bun_tag_file.bytes,
            true,
        )
    }

    pub fn verify(&mut self, resolution: &Resolution, root_node_modules_dir: Dir) -> bool {
        let verified = match resolution.tag {
            Resolution::Tag::Git => {
                self.verify_git_resolution(&resolution.value.git, root_node_modules_dir)
            }
            Resolution::Tag::Github => {
                self.verify_git_resolution(&resolution.value.github, root_node_modules_dir)
            }
            Resolution::Tag::Root => self.verify_transitive_symlinked_folder(root_node_modules_dir),
            Resolution::Tag::Folder => {
                if self.lockfile.is_workspace_tree_id(self.node_modules.tree_id) {
                    self.verify_package_json_name_and_version(root_node_modules_dir, resolution.tag)
                } else {
                    self.verify_transitive_symlinked_folder(root_node_modules_dir)
                }
            }
            _ => self.verify_package_json_name_and_version(root_node_modules_dir, resolution.tag),
        };

        if let Some(patch) = &self.patch {
            if !verified {
                return false;
            }
            // TODO(port): borrowck — patch borrowed from self while calling &mut self method.
            // Clone the small Patch fields or restructure.
            let patch_copy = Patch { path: patch.path.clone(), contents_hash: patch.contents_hash };
            return self.verify_patch_hash(&patch_copy, root_node_modules_dir);
        }
        verified
    }

    // Only check for destination directory in node_modules. We can't use package.json because
    // it might not exist
    fn verify_transitive_symlinked_folder(&self, root_node_modules_dir: Dir) -> bool {
        self.node_modules
            .directory_exists_at(root_node_modules_dir, self.destination_dir_subpath)
    }

    fn get_installed_package_json_source(
        &mut self,
        root_node_modules_dir: Dir,
        mutable: &mut MutableString,
        resolution_tag: Resolution::Tag,
    ) -> Option<logger::Source> {
        let mut total: usize = 0;
        let mut read: usize;
        mutable.reset();
        mutable.list.expand_to_capacity();

        let dest_len = self.destination_dir_subpath.len();
        let suffix = {
            let mut s = Vec::with_capacity(SEP_STR.len() + b"package.json".len());
            s.push(SEP);
            s.extend_from_slice(b"package.json");
            s
        };
        self.destination_dir_subpath_buf[dest_len..dest_len + suffix.len()].copy_from_slice(&suffix);
        self.destination_dir_subpath_buf[dest_len + SEP_STR.len() + b"package.json".len()] = 0;
        // SAFETY: NUL written above.
        let package_json_path = unsafe {
            ZStr::from_raw_mut(
                self.destination_dir_subpath_buf.as_mut_ptr(),
                dest_len + SEP_STR.len() + b"package.json".len(),
            )
        };
        let _restore = scopeguard::guard(
            self.destination_dir_subpath_buf.as_mut_ptr(),
            // SAFETY: p points into destination_dir_subpath_buf which outlives this scope;
            // dest_len < buf capacity (was the prior NUL position).
            move |p| unsafe { *p.add(dest_len) = 0 },
        );

        let package_json_file = self
            .node_modules
            .open_file(root_node_modules_dir, package_json_path)
            .ok()?;
        let _close = scopeguard::guard(&package_json_file, |f| f.close());

        // Heuristic: most package.jsons will be less than 2048 bytes.
        read = package_json_file.read(&mut mutable.list[total..]).unwrap().ok()?;
        let mut remain = &mut mutable.list[total.min(read)..];
        if read > 0 && remain.len() < 1024 {
            mutable.grow_by(4096).ok()?;
            mutable.list.expand_to_capacity();
        }

        while read > 0 {
            total += read;

            mutable.list.expand_to_capacity();
            // PORT NOTE: reshaped for borrowck — recompute remain after grow.
            remain = &mut mutable.list[total..];

            if remain.len() < 1024 {
                mutable.grow_by(4096).ok()?;
            }
            mutable.list.expand_to_capacity();
            remain = &mut mutable.list[total..];

            read = package_json_file.read(remain).unwrap().ok()?;
        }

        // If it's not long enough to have {"name": "foo", "version": "1.2.0"}, there's no way it's valid
        let minimum = if resolution_tag == Resolution::Tag::Workspace && self.package_version.is_empty() {
            // workspaces aren't required to have a version
            br#"{"name":""}"#.len() + self.package_name.len()
        } else {
            br#"{"name":"","version":""}"#.len() + self.package_name.len() + self.package_version.len()
        };

        if total < minimum {
            return None;
        }

        Some(logger::Source::init_path_string(
            package_json_path.as_bytes(),
            &mutable.list[0..total],
        ))
    }

    fn verify_package_json_name_and_version(
        &mut self,
        root_node_modules_dir: Dir,
        resolution_tag: Resolution::Tag,
    ) -> bool {
        let mut body_pool = Npm::Registry::BodyPool::get();
        let mut mutable: MutableString = core::mem::take(&mut body_pool.data);
        let _release = scopeguard::guard((), |_| {
            // TODO(port): errdefer — captures &mut body_pool and mutable; Phase B may need ManuallyDrop.
            body_pool.data = mutable;
            Npm::Registry::BodyPool::release(body_pool);
        });

        // Read the file
        // Return false on any error.
        // Don't keep it open while we're parsing the JSON.
        // The longer the file stays open, the more likely it causes issues for
        // other processes on Windows.
        let Some(source) =
            self.get_installed_package_json_source(root_node_modules_dir, &mut mutable, resolution_tag)
        else {
            return false;
        };
        let source = &source;

        let mut log = logger::Log::init();
        // log dropped at scope exit

        initialize_store();

        let Ok(mut package_json_checker) =
            bun_json::PackageJSONVersionChecker::init(source, &mut log)
        else {
            return false;
        };
        if package_json_checker.parse_expr().is_err() {
            return false;
        }
        if log.errors > 0 || !package_json_checker.has_found_name {
            return false;
        }
        // workspaces aren't required to have a version
        if !package_json_checker.has_found_version && resolution_tag != Resolution::Tag::Workspace {
            return false;
        }

        let found_version = package_json_checker.found_version;

        // exclude build tags from comparsion
        // https://github.com/oven-sh/bun/issues/13563
        let found_version_end =
            strings::last_index_of_char(found_version, b'+').unwrap_or(found_version.len());
        let expected_version_end =
            strings::last_index_of_char(self.package_version, b'+').unwrap_or(self.package_version.len());
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
        package_json_checker.found_name
            == self.package_name.slice(&self.lockfile.buffers.string_bytes)
    }

    // ───────────────────────────── install backends ─────────────────────────────

    fn install_with_clonefile_each_dir(
        &mut self,
        destination_dir: Dir,
    ) -> Result<InstallResult, bun_core::Error> {
        let cached_package_dir = match bun_sys::open_dir(self.cache_dir, self.cache_dir_subpath) {
            Ok(d) => d,
            Err(err) => return Ok(InstallResult::fail(err, Step::OpeningCacheDir, None)),
        };
        let _close_cache = scopeguard::guard(cached_package_dir, |d| d.close());

        let mut walker_ = match Walker::walk(
            Fd::from_std_dir(cached_package_dir),
            &[] as &[OSPathSlice],
            &[] as &[OSPathSlice],
        ) {
            Ok(w) => w,
            Err(err) => return Ok(InstallResult::fail(err, Step::OpeningCacheDir, None)),
        };
        walker_.resolve_unknown_entry_types = true;
        // walker_ dropped at scope exit

        fn copy(destination_dir_: Dir, walker: &mut Walker) -> Result<u32, bun_core::Error> {
            // TODO(port): narrow error set
            let mut real_file_count: u32 = 0;
            let mut stackpath = [0u8; MAX_PATH_BYTES];
            while let Some(entry) = walker.next().unwrap()? {
                match entry.kind {
                    Walker::Kind::Directory => {
                        let _ = sys::mkdirat(Fd::from_std_dir(destination_dir_), entry.path, 0o755);
                    }
                    Walker::Kind::File => {
                        stackpath[..entry.path.len()].copy_from_slice(entry.path);
                        stackpath[entry.path.len()] = 0;
                        // SAFETY: NUL written above.
                        let path_ =
                            unsafe { ZStr::from_raw_mut(stackpath.as_mut_ptr(), entry.path.len()) };
                        let basename = unsafe {
                            ZStr::from_raw_mut(
                                stackpath.as_mut_ptr().add(entry.path.len() - entry.basename.len()),
                                entry.basename.len(),
                            )
                        };
                        // SAFETY: FFI — basename/path_ are valid NUL-terminated ZStr buffers
                        // built into stackpath above; fds are open for the loop iteration.
                        match unsafe {
                            bun_sys::darwin::clonefileat(
                                entry.dir.cast(),
                                basename.as_ptr(),
                                destination_dir_.fd(),
                                path_.as_ptr(),
                                0,
                            )
                        } {
                            0 => {}
                            errno => match sys::posix_errno(errno) {
                                sys::Errno::XDEV => return Err(bun_core::err!("NotSupported")), // not same file system
                                sys::Errno::OPNOTSUPP => return Err(bun_core::err!("NotSupported")),
                                sys::Errno::NOENT => return Err(bun_core::err!("FileNotFound")),
                                // sometimes the downloaded npm package has already node_modules with it, so just ignore exist error here
                                sys::Errno::EXIST => {}
                                sys::Errno::ACCES => return Err(bun_core::err!("AccessDenied")),
                                _ => return Err(bun_core::err!("Unexpected")),
                            },
                        }

                        real_file_count += 1;
                    }
                    _ => {}
                }
            }

            Ok(real_file_count)
        }

        let subdir = match destination_dir.make_open_path(self.destination_dir_subpath.as_bytes()) {
            Ok(d) => d,
            Err(err) => return Ok(InstallResult::fail(err, Step::OpeningDestDir, None)),
        };
        let _close_subdir = scopeguard::guard(subdir, |d| d.close());

        self.file_count = match copy(subdir, &mut walker_) {
            Ok(n) => n,
            Err(err) => return Ok(InstallResult::fail(err, Step::CopyingFiles, None)),
        };

        Ok(InstallResult::Success)
    }

    // https://www.unix.com/man-page/mojave/2/fclonefileat/
    #[cfg(target_os = "macos")]
    fn install_with_clonefile(&mut self, destination_dir: Dir) -> Result<InstallResult, bun_core::Error> {
        if self.destination_dir_subpath.as_bytes()[0] == b'@' {
            if let Some(slash) = strings::index_of_char_z(self.destination_dir_subpath, SEP) {
                self.destination_dir_subpath_buf[slash] = 0;
                // SAFETY: NUL written above.
                let subdir =
                    unsafe { ZStr::from_raw(self.destination_dir_subpath_buf.as_ptr(), slash) };
                let _ = destination_dir.make_dir_z(subdir);
                self.destination_dir_subpath_buf[slash] = SEP;
            }
        }

        // SAFETY: FFI — cache_dir_subpath/destination_dir_subpath are NUL-terminated ZStr
        // slices into long-lived path buffers; fds are open.
        match unsafe {
            bun_sys::darwin::clonefileat(
                self.cache_dir.fd(),
                self.cache_dir_subpath.as_ptr(),
                destination_dir.fd(),
                self.destination_dir_subpath.as_ptr(),
                0,
            )
        } {
            0 => Ok(InstallResult::Success),
            errno => match sys::posix_errno(errno) {
                sys::Errno::XDEV => Err(bun_core::err!("NotSupported")), // not same file system
                sys::Errno::OPNOTSUPP => Err(bun_core::err!("NotSupported")),
                sys::Errno::NOENT => Err(bun_core::err!("FileNotFound")),
                // We first try to delete the directory
                // But, this can happen if this package contains a node_modules folder
                // We want to continue installing as many packages as we can, so we shouldn't block while downloading
                // We use the slow path in this case
                sys::Errno::EXIST => self.install_with_clonefile_each_dir(destination_dir),
                sys::Errno::ACCES => Err(bun_core::err!("AccessDenied")),
                _ => Err(bun_core::err!("Unexpected")),
            },
        }
    }

    fn init_install_dir(
        &mut self,
        state: &mut InstallDirState,
        destination_dir: Dir,
        method: Method,
    ) -> InstallResult {
        let destbase = destination_dir;
        let destpath = self.destination_dir_subpath;

        state.cached_package_dir = match {
            #[cfg(windows)]
            {
                if method == Method::Symlink {
                    bun_sys::open_dir_no_renaming_or_deleting_windows(
                        Fd::from_std_dir(self.cache_dir),
                        self.cache_dir_subpath,
                    )
                } else {
                    bun_sys::open_dir(self.cache_dir, self.cache_dir_subpath)
                }
            }
            #[cfg(not(windows))]
            {
                bun_sys::open_dir(self.cache_dir, self.cache_dir_subpath)
            }
        } {
            Ok(d) => d,
            Err(err) => return InstallResult::fail(err, Step::OpeningCacheDir, None),
        };

        // TODO(port): OSPathLiteral macro for "node_modules" (u8 on posix / u16 on windows).
        let skip_dirs: &[OSPathSlice] = if method == Method::Symlink
            && self.cache_dir_subpath.len() == 1
            && self.cache_dir_subpath.as_bytes()[0] == b'.'
        {
            &[bun_paths::os_path_literal!("node_modules")]
        } else {
            &[]
        };

        state.walker = Walker::walk(
            Fd::from_std_dir(state.cached_package_dir),
            &[] as &[OSPathSlice],
            skip_dirs,
        )
        .expect("oom"); // bun.handleOom
        state.walker.resolve_unknown_entry_types = true;

        #[cfg(not(windows))]
        {
            state.subdir = match destbase.make_open_path_iterate(destpath.as_bytes()) {
                Ok(d) => d,
                Err(err) => {
                    // PORT NOTE: Zig closed cached_package_dir/walker explicitly here because the
                    // caller's `defer state.deinit()` is placed AFTER the `is_fail()` early-return.
                    // In Rust, Drop on the caller's `state` runs unconditionally on that early
                    // return, so explicit close here would double-close. Drop handles it.
                    return InstallResult::fail(err, Step::OpeningDestDir, None);
                }
            };
            return InstallResult::Success;
        }

        #[cfg(windows)]
        {
            use bun_sys::windows;

            // SAFETY: FFI — destbase.fd() is an open handle; state.buf is a valid writable
            // WPathBuffer of the passed length.
            let dest_path_length = unsafe {
                windows::GetFinalPathNameByHandleW(
                    destbase.fd(),
                    state.buf.as_mut_ptr(),
                    u32::try_from(state.buf.len()).unwrap(),
                    0,
                )
            } as usize;
            if dest_path_length == 0 || dest_path_length >= state.buf.len() {
                let e = windows::Win32Error::get();
                let err = if dest_path_length == 0 {
                    e.to_system_errno()
                        .map(bun_sys::errno_to_zig_err)
                        .unwrap_or(bun_core::err!("Unexpected"))
                } else {
                    bun_core::err!("NameTooLong")
                };
                // PORT NOTE: Drop on caller's `state` closes cached_package_dir; explicit close
                // here would double-close (see posix branch above for full rationale).
                return InstallResult::fail(err, Step::OpeningDestDir, None);
            }

            let mut i: usize = dest_path_length;
            if state.buf[i] != u16::from(b'\\') {
                state.buf[i] = u16::from(b'\\');
                i += 1;
            }

            i += strings::to_wpath_normalized(&mut state.buf[i..], destpath.as_bytes()).len();
            state.buf[i] = bun_paths::SEP_WINDOWS as u16;
            i += 1;
            state.buf[i] = 0;
            // SAFETY: NUL written at [i].
            let fullpath = unsafe { bun_str::WStr::from_raw(state.buf.as_ptr(), i) };

            let _ = node_fs_for_package_installer(|nfs| {
                nfs.mkdir_recursive_os_path_impl((), fullpath, 0, false)
            });
            state.to_copy_buf = core::ptr::slice_from_raw_parts_mut(
                state.buf.as_mut_ptr().add(fullpath.len()),
                state.buf.len() - fullpath.len(),
            );

            // SAFETY: FFI — cached_package_dir.fd() is an open handle (opened above);
            // state.buf2 is a valid writable WPathBuffer of the passed length.
            let cache_path_length = unsafe {
                windows::GetFinalPathNameByHandleW(
                    state.cached_package_dir.fd(),
                    state.buf2.as_mut_ptr(),
                    u32::try_from(state.buf2.len()).unwrap(),
                    0,
                )
            } as usize;
            if cache_path_length == 0 || cache_path_length >= state.buf2.len() {
                let e = windows::Win32Error::get();
                let err = if cache_path_length == 0 {
                    e.to_system_errno()
                        .map(bun_sys::errno_to_zig_err)
                        .unwrap_or(bun_core::err!("Unexpected"))
                } else {
                    bun_core::err!("NameTooLong")
                };
                // PORT NOTE: Drop on caller's `state` closes cached_package_dir; explicit close
                // here would double-close (see posix branch above for full rationale).
                return InstallResult::fail(err, Step::CopyingFiles, None);
            }
            let cache_path = &state.buf2[..cache_path_length];
            let to_copy_buf2: *mut [u16];
            if state.buf2[cache_path.len() - 1] != u16::from(b'\\') {
                state.buf2[cache_path.len()] = u16::from(b'\\');
                to_copy_buf2 = core::ptr::slice_from_raw_parts_mut(
                    state.buf2.as_mut_ptr().add(cache_path.len() + 1),
                    state.buf2.len() - cache_path.len() - 1,
                );
            } else {
                to_copy_buf2 = core::ptr::slice_from_raw_parts_mut(
                    state.buf2.as_mut_ptr().add(cache_path.len()),
                    state.buf2.len() - cache_path.len(),
                );
            }

            state.to_copy_buf2 = to_copy_buf2;
            InstallResult::Success
        }
    }

    fn install_with_copyfile(&mut self, destination_dir: Dir) -> InstallResult {
        let mut state = InstallDirState::default();
        let res = self.init_install_dir(&mut state, destination_dir, Method::Copyfile);
        if res.is_fail() {
            return res;
        }
        // state dropped at scope exit

        #[cfg(windows)]
        type WinSlice<'b> = &'b mut [u16];
        #[cfg(not(windows))]
        type WinSlice<'b> = ();

        fn copy(
            destination_dir_: Dir,
            walker: &mut Walker,
            progress_: Option<&mut Progress>,
            #[allow(unused)] to_copy_into1: WinSlice<'_>,
            #[allow(unused)] head1: WinSlice<'_>,
            #[allow(unused)] to_copy_into2: WinSlice<'_>,
            #[allow(unused)] head2: WinSlice<'_>,
        ) -> Result<u32, bun_core::Error> {
            // TODO(port): narrow error set
            let mut real_file_count: u32 = 0;
            let mut copy_file_state = bun_sys::CopyFileState::default();

            while let Some(entry) = walker.next().unwrap()? {
                #[cfg(windows)]
                {
                    use bun_sys::windows;
                    match entry.kind {
                        Walker::Kind::Directory | Walker::Kind::File => {}
                        _ => continue,
                    }

                    if entry.path.len() > to_copy_into1.len() || entry.path.len() > to_copy_into2.len() {
                        return Err(bun_core::err!("NameTooLong"));
                    }

                    to_copy_into1[..entry.path.len()].copy_from_slice(entry.path);
                    head1[entry.path.len() + (head1.len() - to_copy_into1.len())] = 0;
                    // SAFETY: NUL written above.
                    let dest = unsafe {
                        bun_str::WStr::from_raw(
                            head1.as_ptr(),
                            entry.path.len() + head1.len() - to_copy_into1.len(),
                        )
                    };

                    to_copy_into2[..entry.path.len()].copy_from_slice(entry.path);
                    head2[entry.path.len() + (head1.len() - to_copy_into2.len())] = 0;
                    // SAFETY: NUL written above.
                    let src = unsafe {
                        bun_str::WStr::from_raw(
                            head2.as_ptr(),
                            entry.path.len() + head2.len() - to_copy_into2.len(),
                        )
                    };

                    match entry.kind {
                        Walker::Kind::Directory => {
                            // SAFETY: FFI — src/dest are valid NUL-terminated WStr buffers built
                            // into head1/head2 above.
                            if unsafe {
                                windows::CreateDirectoryExW(src.as_ptr(), dest.as_ptr(), core::ptr::null_mut())
                            } == 0
                            {
                                let _ = bun_sys::MakePath::make_path_u16(destination_dir_, entry.path);
                            }
                        }
                        Walker::Kind::File => {
                            // SAFETY: FFI — src/dest are valid NUL-terminated WStr buffers.
                            if unsafe { windows::CopyFileW(src.as_ptr(), dest.as_ptr(), 0) } == 0 {
                                if let Some(entry_dirname) = bun_paths::Dirname::dirname_u16(entry.path) {
                                    let _ = bun_sys::MakePath::make_path_u16(destination_dir_, entry_dirname);
                                    // SAFETY: FFI — src/dest are valid NUL-terminated WStr buffers.
                                    if unsafe { windows::CopyFileW(src.as_ptr(), dest.as_ptr(), 0) } != 0 {
                                        continue;
                                    }
                                }

                                if let Some(progress) = progress_ {
                                    progress.root.end();
                                    progress.refresh();
                                }

                                if let Some(err) = windows::Win32Error::get().to_system_errno() {
                                    Output::pretty_error(format_args!(
                                        "<r><red>{}<r>: copying file {}",
                                        <&'static str>::from(err),
                                        bun_core::fmt::fmt_os_path(entry.path)
                                    ));
                                } else {
                                    Output::pretty_error(format_args!(
                                        "<r><red>error<r> copying file {}",
                                        bun_core::fmt::fmt_os_path(entry.path)
                                    ));
                                }

                                Global::crash();
                            }
                        }
                        _ => unreachable!(), // handled above
                    }
                }
                #[cfg(not(windows))]
                {
                    if entry.kind != Walker::Kind::File {
                        continue;
                    }
                    real_file_count += 1;

                    let in_file = entry.dir.openat(entry.basename, sys::O::RDONLY, 0).unwrap()?;
                    let _close_in = scopeguard::guard(in_file, |f| f.close());

                    bun_output::scoped_log!(
                        install,
                        "createFile {} {}\n",
                        destination_dir_.fd(),
                        bstr::BStr::new(entry.path)
                    );
                    let outfile = match destination_dir_.create_file(entry.path) {
                        Ok(f) => f,
                        Err(_) => 'brk: {
                            if let Some(entry_dirname) =
                                bun_paths::Dirname::dirname::<OSPathChar>(entry.path)
                            {
                                let _ = bun_sys::MakePath::make_path::<OSPathChar>(
                                    destination_dir_,
                                    entry_dirname,
                                );
                            }
                            match destination_dir_.create_file(entry.path) {
                                Ok(f) => break 'brk f,
                                Err(err) => {
                                    if let Some(progress) = progress_ {
                                        progress.root.end();
                                        progress.refresh();
                                    }

                                    Output::pretty_errorln(format_args!(
                                        "<r><red>{}<r>: copying file {}",
                                        err.name(),
                                        bun_core::fmt::fmt_os_path(entry.path)
                                    ));
                                    Global::crash();
                                }
                            }
                        }
                    };
                    let _close_out = scopeguard::guard(&outfile, |f| f.close());

                    #[cfg(unix)]
                    {
                        let Ok(stat) = in_file.stat().unwrap() else { continue };
                        // SAFETY: fchmod with valid fd and mode.
                        unsafe {
                            bun_sys::c::fchmod(
                                outfile.handle(),
                                u32::try_from(stat.mode).unwrap(),
                            )
                        };
                    }

                    if let Err(err) =
                        bun_sys::copy_file_with_state(in_file, Fd::from_std_file(&outfile), &mut copy_file_state)
                            .unwrap()
                    {
                        if let Some(progress) = progress_ {
                            progress.root.end();
                            progress.refresh();
                        }

                        Output::pretty_error(format_args!(
                            "<r><red>{}<r>: copying file {}",
                            err.name(),
                            bun_core::fmt::fmt_os_path(entry.path)
                        ));
                        Global::crash();
                    }
                }
            }

            Ok(real_file_count)
        }

        #[cfg(windows)]
        // SAFETY: to_copy_buf/to_copy_buf2 are raw slices into state.buf/state.buf2 set by
        // init_install_dir; they alias the head buffers but `copy` only writes the
        // non-overlapping suffix region (mirrors Zig's overlapping slice usage).
        let result = unsafe {
            copy(
                state.subdir,
                &mut state.walker,
                self.progress.as_deref_mut(),
                &mut *state.to_copy_buf,
                &mut state.buf[..],
                &mut *state.to_copy_buf2,
                &mut state.buf2[..],
            )
        };
        #[cfg(not(windows))]
        let result = copy(
            state.subdir,
            &mut state.walker,
            self.progress.as_deref_mut(),
            (),
            (),
            (),
            (),
        );

        self.file_count = match result {
            Ok(n) => n,
            Err(err) => return InstallResult::fail(err, Step::CopyingFiles, None),
        };

        InstallResult::Success
    }

    fn install_with_hardlink(&mut self, dest_dir: Dir) -> Result<InstallResult, bun_core::Error> {
        let mut state = InstallDirState::default();
        let res = self.init_install_dir(&mut state, dest_dir, Method::Hardlink);
        if res.is_fail() {
            return Ok(res);
        }

        #[cfg(windows)]
        type WinSlice<'b> = &'b mut [u16];
        #[cfg(not(windows))]
        type WinSlice<'b> = ();

        fn copy(
            destination_dir: Dir,
            walker: &mut Walker,
            #[allow(unused)] to_copy_into1: WinSlice<'_>,
            #[allow(unused)] head1: WinSlice<'_>,
            #[allow(unused)] to_copy_into2: WinSlice<'_>,
            #[allow(unused)] head2: WinSlice<'_>,
        ) -> Result<u32, bun_core::Error> {
            // TODO(port): narrow error set
            let mut real_file_count: u32 = 0;
            #[cfg(windows)]
            let queue = HardLinkWindowsInstallTask::init_queue();

            while let Some(entry) = walker.next().unwrap()? {
                #[cfg(unix)]
                {
                    match entry.kind {
                        Walker::Kind::Directory => {
                            let _ = bun_sys::MakePath::make_path::<OSPathChar>(destination_dir, entry.path);
                        }
                        Walker::Kind::File => {
                            if let Err(err) = sys::linkat_z(
                                entry.dir.cast(),
                                entry.basename,
                                destination_dir.fd(),
                                entry.path,
                                0,
                            ) {
                                if err != bun_core::err!("PathAlreadyExists") {
                                    return Err(err);
                                }

                                let _ = sys::unlinkat_z(destination_dir.fd(), entry.path, 0);
                                sys::linkat_z(
                                    entry.dir.cast(),
                                    entry.basename,
                                    destination_dir.fd(),
                                    entry.path,
                                    0,
                                )?;
                            }

                            real_file_count += 1;
                        }
                        _ => {}
                    }
                }
                #[cfg(not(unix))]
                {
                    match entry.kind {
                        Walker::Kind::File => {}
                        _ => continue,
                    }

                    if entry.path.len() > to_copy_into1.len() || entry.path.len() > to_copy_into2.len() {
                        return Err(bun_core::err!("NameTooLong"));
                    }

                    to_copy_into1[..entry.path.len()].copy_from_slice(entry.path);
                    head1[entry.path.len() + (head1.len() - to_copy_into1.len())] = 0;
                    // SAFETY: head1[len] == 0 written immediately above.
                    let dest = unsafe {
                        bun_str::WStr::from_raw(
                            head1.as_ptr(),
                            entry.path.len() + head1.len() - to_copy_into1.len(),
                        )
                    };

                    to_copy_into2[..entry.path.len()].copy_from_slice(entry.path);
                    head2[entry.path.len() + (head1.len() - to_copy_into2.len())] = 0;
                    // SAFETY: head2[len] == 0 written immediately above.
                    let src = unsafe {
                        bun_str::WStr::from_raw(
                            head2.as_ptr(),
                            entry.path.len() + head2.len() - to_copy_into2.len(),
                        )
                    };

                    queue.push(HardLinkWindowsInstallTask::init(
                        src.as_slice(),
                        dest.as_slice(),
                        entry.basename,
                    ));
                    real_file_count += 1;
                }
            }

            #[cfg(windows)]
            {
                queue.wait();

                // .Relaxed is okay because no tasks are running (could be made non-atomic)
                let task = queue.errored_task.load(Ordering::Relaxed);
                if !task.is_null() {
                    // SAFETY: pointer set by run_from_thread_pool, valid until we drop the queue.
                    if let Some(err) = unsafe { (*task).err } {
                        return Err(err);
                    }
                }
            }

            Ok(real_file_count)
        }

        #[cfg(windows)]
        // SAFETY: to_copy_buf/to_copy_buf2 are raw slices into state.buf/state.buf2 set by
        // init_install_dir; they alias the head buffers but `copy` only writes the
        // non-overlapping suffix region (mirrors Zig's overlapping slice usage).
        let result = unsafe {
            copy(
                state.subdir,
                &mut state.walker,
                &mut *state.to_copy_buf,
                &mut state.buf[..],
                &mut *state.to_copy_buf2,
                &mut state.buf2[..],
            )
        };
        #[cfg(not(windows))]
        let result = copy(state.subdir, &mut state.walker, (), (), (), ());

        self.file_count = match result {
            Ok(n) => n,
            Err(err) => {
                bun_core::handle_error_return_trace(err, None);

                #[cfg(windows)]
                {
                    if err == bun_core::err!("FailedToCopyFile") {
                        return Ok(InstallResult::fail(err, Step::CopyingFiles, None));
                    }
                }
                #[cfg(not(windows))]
                {
                    if err == bun_core::err!("NotSameFileSystem") || err == bun_core::err!("ENXIO") {
                        return Err(err);
                    }
                }

                return Ok(InstallResult::fail(err, Step::CopyingFiles, None));
            }
        };

        Ok(InstallResult::Success)
    }

    fn install_with_symlink(&mut self, dest_dir: Dir) -> Result<InstallResult, bun_core::Error> {
        let mut state = InstallDirState::default();
        let res = self.init_install_dir(&mut state, dest_dir, Method::Symlink);
        if res.is_fail() {
            return Ok(res);
        }

        let mut buf2 = PathBuffer::uninit();
        #[allow(unused)]
        let mut to_copy_buf2: &mut [u8] = &mut [];
        #[cfg(unix)]
        {
            let cache_dir_path = Fd::from_std_dir(state.cached_package_dir).get_fd_path(&mut buf2)?;
            let cache_len = cache_dir_path.len();
            if cache_len > 0 && cache_dir_path[cache_len - 1] != SEP {
                buf2[cache_len] = SEP;
                to_copy_buf2 = &mut buf2[cache_len + 1..];
            } else {
                to_copy_buf2 = &mut buf2[cache_len..];
            }
        }

        #[cfg(windows)]
        type WinSlice<'b> = &'b mut [u16];
        #[cfg(not(windows))]
        type WinSlice<'b> = ();
        #[cfg(windows)]
        type Head2Char = u16;
        #[cfg(not(windows))]
        type Head2Char = u8;

        fn copy(
            destination_dir: Dir,
            walker: &mut Walker,
            #[allow(unused)] to_copy_into1: WinSlice<'_>,
            #[allow(unused)] head1: WinSlice<'_>,
            to_copy_into2: &mut [Head2Char],
            head2: &mut [Head2Char],
        ) -> Result<u32, bun_core::Error> {
            // TODO(port): narrow error set
            let mut real_file_count: u32 = 0;
            while let Some(entry) = walker.next().unwrap()? {
                #[cfg(unix)]
                {
                    match entry.kind {
                        Walker::Kind::Directory => {
                            let _ = bun_sys::MakePath::make_path::<OSPathChar>(destination_dir, entry.path);
                        }
                        Walker::Kind::File => {
                            to_copy_into2[..entry.path.len()].copy_from_slice(entry.path);
                            head2[entry.path.len() + (head2.len() - to_copy_into2.len())] = 0;
                            // SAFETY: NUL written above.
                            let target = unsafe {
                                ZStr::from_raw_mut(
                                    head2.as_mut_ptr(),
                                    entry.path.len() + head2.len() - to_copy_into2.len(),
                                )
                            };

                            if let Err(err) =
                                sys::symlinkat(target.as_bytes(), destination_dir.fd(), entry.path)
                            {
                                if err != bun_core::err!("PathAlreadyExists") {
                                    return Err(err);
                                }

                                let _ = sys::unlinkat(destination_dir.fd(), entry.path, 0);
                                sys::symlinkat(entry.basename, destination_dir.fd(), entry.path)?;
                            }

                            real_file_count += 1;
                        }
                        _ => {}
                    }
                }
                #[cfg(not(unix))]
                {
                    use bun_sys::windows;
                    match entry.kind {
                        Walker::Kind::Directory | Walker::Kind::File => {}
                        _ => continue,
                    }

                    if entry.path.len() > to_copy_into1.len() || entry.path.len() > to_copy_into2.len() {
                        return Err(bun_core::err!("NameTooLong"));
                    }

                    to_copy_into1[..entry.path.len()].copy_from_slice(entry.path);
                    head1[entry.path.len() + (head1.len() - to_copy_into1.len())] = 0;
                    // SAFETY: head1[len] == 0 written immediately above.
                    let dest = unsafe {
                        bun_str::WStr::from_raw(
                            head1.as_ptr(),
                            entry.path.len() + head1.len() - to_copy_into1.len(),
                        )
                    };

                    to_copy_into2[..entry.path.len()].copy_from_slice(entry.path);
                    head2[entry.path.len() + (head1.len() - to_copy_into2.len())] = 0;
                    // SAFETY: head2[len] == 0 written immediately above.
                    let src = unsafe {
                        bun_str::WStr::from_raw(
                            head2.as_ptr(),
                            entry.path.len() + head2.len() - to_copy_into2.len(),
                        )
                    };

                    match entry.kind {
                        Walker::Kind::Directory => {
                            // SAFETY: FFI — src/dest are valid NUL-terminated WStr buffers built
                            // into head1/head2 above.
                            if unsafe {
                                windows::CreateDirectoryExW(src.as_ptr(), dest.as_ptr(), core::ptr::null_mut())
                            } == 0
                            {
                                let _ = bun_sys::MakePath::make_path_u16(destination_dir, entry.path);
                            }
                        }
                        Walker::Kind::File => {
                            match sys::symlink_w(dest, src, Default::default()) {
                                sys::Result::Err(err) => {
                                    if let Some(entry_dirname) =
                                        bun_paths::Dirname::dirname_u16(entry.path)
                                    {
                                        let _ = bun_sys::MakePath::make_path_u16(
                                            destination_dir,
                                            entry_dirname,
                                        );
                                        if let sys::Result::Ok(_) =
                                            sys::symlink_w(dest, src, Default::default())
                                        {
                                            continue;
                                        }
                                    }

                                    if PackageManager::verbose_install() {
                                        static ONCE: core::sync::atomic::AtomicBool =
                                            core::sync::atomic::AtomicBool::new(false);
                                        if !ONCE.swap(true, Ordering::Relaxed) {
                                            Output::warn(format_args!(
                                                "CreateHardLinkW failed, falling back to CopyFileW: {} -> {}\n",
                                                bun_core::fmt::fmt_os_path(src.as_slice()),
                                                bun_core::fmt::fmt_os_path(dest.as_slice()),
                                            ));
                                        }
                                    }

                                    return Err(bun_sys::errno_to_zig_err(err.errno));
                                }
                                sys::Result::Ok(_) => {}
                            }
                        }
                        _ => unreachable!(), // handled above
                    }
                }
            }

            Ok(real_file_count)
        }

        #[cfg(windows)]
        // SAFETY: to_copy_buf/to_copy_buf2 are raw slices into state.buf/state.buf2 set by
        // init_install_dir; they alias the head buffers but `copy` only writes the
        // non-overlapping suffix region (mirrors Zig's overlapping slice usage).
        let result = unsafe {
            copy(
                state.subdir,
                &mut state.walker,
                &mut *state.to_copy_buf,
                &mut state.buf[..],
                &mut *state.to_copy_buf2,
                &mut state.buf2[..],
            )
        };
        #[cfg(not(windows))]
        let result = {
            // PORT NOTE: reshaped for borrowck — to_copy_buf2 and &mut buf2 alias; pass head len separately.
            // TODO(port): aliasing &mut into same buffer; Phase B may pass (head2_ptr, prefix_len, suffix_slice).
            let head2_len = buf2.len();
            copy(
                state.subdir,
                &mut state.walker,
                (),
                (),
                to_copy_buf2,
                // SAFETY: head2 covers all of buf2; copy() only writes within bounds derived from lengths.
                unsafe { core::slice::from_raw_parts_mut(buf2.as_mut_ptr(), head2_len) },
            )
        };

        self.file_count = match result {
            Ok(n) => n,
            Err(err) => {
                #[cfg(windows)]
                {
                    if err == bun_core::err!("FailedToCopyFile") {
                        return Ok(InstallResult::fail(err, Step::CopyingFiles, None));
                    }
                }
                #[cfg(not(windows))]
                {
                    if err == bun_core::err!("NotSameFileSystem") || err == bun_core::err!("ENXIO") {
                        return Err(err);
                    }
                }
                return Ok(InstallResult::fail(err, Step::CopyingFiles, None));
            }
        };

        Ok(InstallResult::Success)
    }

    pub fn uninstall(&self, destination_dir: Dir) {
        let _ = destination_dir.delete_tree(self.destination_dir_subpath.as_bytes());
    }

    pub fn uninstall_before_install(&self, destination_dir: Dir) {
        let mut rand_path_buf = [0u8; 48];
        let rand_bytes = bun_core::fast_random().to_ne_bytes();
        // TODO(port): bufPrintZ with {X} hex formatting of bytes.
        let temp_path = {
            use std::io::Write;
            let mut cursor = &mut rand_path_buf[..];
            write!(cursor, ".old-").unwrap();
            for b in rand_bytes {
                write!(cursor, "{:02X}", b).unwrap();
            }
            let written = 48 - cursor.len();
            rand_path_buf[written] = 0;
            // SAFETY: NUL written at [written].
            unsafe { ZStr::from_raw(rand_path_buf.as_ptr(), written) }
        };

        match sys::renameat(
            Fd::from_std_dir(destination_dir),
            self.destination_dir_subpath,
            Fd::from_std_dir(destination_dir),
            temp_path,
        ) {
            sys::Result::Err(_) => {
                // if it fails, that means the directory doesn't exist or was inaccessible
            }
            sys::Result::Ok(_) => {
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
                let absolute_path = bun_str::ZStr::from_bytes(path::join_abs_string(
                    bun_fs::FileSystem::instance().top_level_dir,
                    &[&self.node_modules.path, temp_path.as_bytes()],
                    path::Style::Auto,
                ));
                let task = Box::into_raw(Box::new(UninstallTask {
                    absolute_path: absolute_path.into_boxed_bytes(),
                    task: WorkPoolTask { callback: UninstallTask::run },
                }));
                PackageManager::get().increment_pending_tasks(1);
                // SAFETY: task is a valid heap allocation; .task is the intrusive node.
                PackageManager::get()
                    .thread_pool
                    .schedule(ThreadPool::Batch::from(unsafe { &mut (*task).task }));
            }
        }
    }

    pub fn is_dangling_symlink(path: &ZStr) -> bool {
        #[cfg(target_os = "linux")]
        {
            match sys::open(path, sys::O::PATH, 0u32) {
                sys::Result::Err(_) => return true,
                sys::Result::Ok(fd) => {
                    fd.close();
                    return false;
                }
            }
        }
        #[cfg(windows)]
        {
            match sys::sys_uv::open(path, 0, 0) {
                sys::Result::Err(_) => return true,
                sys::Result::Ok(fd) => {
                    fd.close();
                    return false;
                }
            }
        }
        #[cfg(not(any(target_os = "linux", windows)))]
        {
            match sys::open(path, sys::O::PATH, 0u32) {
                sys::Result::Err(_) => return true,
                sys::Result::Ok(fd) => {
                    fd.close();
                    return false;
                }
            }
        }
    }

    pub fn is_dangling_windows_bin_link(node_mod_fd: Fd, path: &[u16], temp_buffer: &mut [u8]) -> bool {
        use crate::windows_shim::BinLinkingShim as WinBinLinkingShim;
        let bin_path = 'bin_path: {
            let Ok(fd) = sys::openat_windows(node_mod_fd, path, sys::O::RDONLY).unwrap() else {
                return true;
            };
            let _close = scopeguard::guard(fd, |f| f.close());
            let Ok(size) = fd.std_file().read_all(temp_buffer) else {
                return true;
            };
            let Some(decoded) = WinBinLinkingShim::loose_decode(&temp_buffer[..size]) else {
                return true;
            };
            debug_assert!(decoded.flags.is_valid()); // looseDecode ensures valid flags
            break 'bin_path decoded.bin_path;
        };

        {
            let Ok(fd) = sys::openat_windows(node_mod_fd, bin_path, sys::O::RDONLY).unwrap() else {
                return true;
            };
            fd.close();
        }

        false
    }

    pub fn install_from_link(&mut self, skip_delete: bool, destination_dir: Dir) -> InstallResult {
        let dest_path = self.destination_dir_subpath;
        // If this fails, we don't care.
        // we'll catch it the next error
        if !skip_delete && dest_path.as_bytes() != b"." {
            self.uninstall_before_install(destination_dir);
        }

        let subdir = bun_paths::dirname(dest_path.as_bytes());

        let mut dest_buf = PathBuffer::uninit();
        // cache_dir_subpath in here is actually the full path to the symlink pointing to the linked package
        let symlinked_path = self.cache_dir_subpath;
        let mut to_buf = PathBuffer::uninit();
        let to_path = match self.cache_dir.realpath(symlinked_path, &mut to_buf) {
            Ok(p) => p,
            Err(err) => return InstallResult::fail(err, Step::LinkingDependency, None),
        };

        let dest = bun_paths::basename(dest_path.as_bytes());
        // When we're linking on Windows, we want to avoid keeping the source directory handle open
        #[cfg(windows)]
        {
            use bun_sys::windows;
            let mut wbuf = WPathBuffer::uninit();
            // SAFETY: FFI — destination_dir.fd() is an open handle; wbuf is a valid writable
            // WPathBuffer of the passed length.
            let dest_path_length = unsafe {
                windows::GetFinalPathNameByHandleW(
                    destination_dir.fd(),
                    wbuf.as_mut_ptr(),
                    u32::try_from(wbuf.len()).unwrap(),
                    0,
                )
            } as usize;
            if dest_path_length == 0 || dest_path_length >= wbuf.len() {
                let e = windows::Win32Error::get();
                let err = if dest_path_length == 0 {
                    e.to_system_errno()
                        .map(bun_sys::errno_to_zig_err)
                        .unwrap_or(bun_core::err!("Unexpected"))
                } else {
                    bun_core::err!("NameTooLong")
                };
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
                // SAFETY: NUL written at [i].
                let fullpath = unsafe { bun_str::WStr::from_raw(wbuf.as_ptr(), i) };

                let _ = node_fs_for_package_installer(|nfs| {
                    nfs.mkdir_recursive_os_path_impl((), fullpath, 0, false)
                });
            }

            let res = strings::copy_utf16_into_utf8(&mut dest_buf[..], &wbuf[..i]);
            let mut offset: usize = res.written;
            if dest_buf[offset - 1] != bun_paths::SEP_WINDOWS {
                dest_buf[offset] = bun_paths::SEP_WINDOWS;
                offset += 1;
            }
            dest_buf[offset..offset + dest.len()].copy_from_slice(dest);
            offset += dest.len();
            dest_buf[offset] = 0;

            // SAFETY: NUL written at [offset].
            let dest_z = unsafe { ZStr::from_raw(dest_buf.as_ptr(), offset) };

            let to_len = to_path.len();
            to_buf[to_len] = 0;
            // SAFETY: NUL written at [to_len].
            let target_z = unsafe { ZStr::from_raw(to_buf.as_ptr(), to_len) };

            // https://github.com/npm/cli/blob/162c82e845d410ede643466f9f8af78a312296cc/workspaces/arborist/lib/arborist/reify.js#L738
            // https://github.com/npm/cli/commit/0e58e6f6b8f0cd62294642a502c17561aaf46553
            match sys::symlink_or_junction(dest_z, target_z, None) {
                sys::Result::Err(err_) => 'brk: {
                    let mut err = err_;
                    if err.get_errno() == sys::Errno::EXIST {
                        let _ = sys::rmdirat(
                            Fd::from_std_dir(destination_dir),
                            self.destination_dir_subpath,
                        );
                        match sys::symlink_or_junction(dest_z, target_z, None) {
                            sys::Result::Err(e) => err = e,
                            sys::Result::Ok(_) => break 'brk,
                        }
                    }

                    return InstallResult::fail(
                        bun_sys::errno_to_zig_err(err.errno),
                        Step::LinkingDependency,
                        None,
                    );
                }
                sys::Result::Ok(_) => {}
            }
        }
        #[cfg(not(windows))]
        {
            let dest_dir = if let Some(dir) = subdir {
                match bun_sys::MakePath::make_open_path(destination_dir, dir) {
                    Ok(d) => d,
                    Err(err) => return InstallResult::fail(err, Step::LinkingDependency, None),
                }
            } else {
                destination_dir
            };
            let _close = scopeguard::guard(dest_dir, |d| {
                if subdir.is_some() {
                    d.close();
                }
            });

            let dest_dir_path = match bun_sys::get_fd_path(Fd::from_std_dir(dest_dir), &mut dest_buf) {
                Ok(p) => p,
                Err(err) => return InstallResult::fail(err, Step::LinkingDependency, None),
            };

            let target = path::relative(dest_dir_path, to_path);
            if let Err(err) = sys::symlinkat(target, dest_dir.fd(), dest) {
                return InstallResult::fail(err, Step::LinkingDependency, None);
            }
        }

        if Self::is_dangling_symlink(symlinked_path) {
            return InstallResult::fail(
                bun_core::err!("DanglingSymlink"),
                Step::LinkingDependency,
                None,
            );
        }

        InstallResult::Success
    }

    pub fn get_install_method(&self) -> Method {
        if self.cache_dir_subpath.as_bytes() == b"."
            || self.cache_dir_subpath.as_bytes().starts_with(b"..")
        {
            Method::Symlink
        } else {
            // SAFETY: single-threaded install context.
            unsafe { SUPPORTED_METHOD }
        }
    }

    pub fn package_missing_from_cache(
        &mut self,
        manager: &mut PackageManager,
        package_id: PackageID,
        resolution_tag: Resolution::Tag,
    ) -> bool {
        let state = manager.get_preinstall_state(package_id);
        match state {
            crate::PreinstallState::Done => false,
            _ => 'brk: {
                if self.patch.is_none() {
                    let exists = match resolution_tag {
                        Resolution::Tag::Npm => 'package_json_exists: {
                            let buf = PackageManager::cached_package_folder_name_buf();

                            if cfg!(debug_assertions) {
                                debug_assert!(bun_core::is_slice_in_buffer(
                                    self.cache_dir_subpath.as_bytes(),
                                    buf
                                ));
                            }

                            let subpath_len =
                                strings::without_trailing_slash(self.cache_dir_subpath.as_bytes()).len();
                            buf[subpath_len] = SEP;
                            // SAFETY: p points into the long-lived cached_package_folder_name_buf;
                            // subpath_len is in bounds (was the prior NUL position).
                            let _restore = scopeguard::guard(buf.as_mut_ptr(), move |p| unsafe {
                                *p.add(subpath_len) = 0;
                            });
                            buf[subpath_len + 1..subpath_len + 1 + b"package.json\0".len()]
                                .copy_from_slice(b"package.json\0");
                            // SAFETY: NUL written above.
                            let subpath = unsafe {
                                ZStr::from_raw(buf.as_ptr(), subpath_len + 1 + b"package.json".len())
                            };
                            break 'package_json_exists sys::exists_at(
                                Fd::from_std_dir(self.cache_dir),
                                subpath,
                            );
                        }
                        _ => sys::directory_exists_at(
                            Fd::from_std_dir(self.cache_dir),
                            self.cache_dir_subpath,
                        )
                        .unwrap()
                        .unwrap_or(false),
                    };
                    if exists {
                        manager.set_preinstall_state(package_id, manager.lockfile, crate::PreinstallState::Done);
                    }
                    break 'brk !exists;
                }
                let idx = strings::last_index_of(self.cache_dir_subpath.as_bytes(), b"_patch_hash=")
                    .unwrap_or_else(|| {
                        panic!("Patched dependency cache dir subpath does not have the \"_patch_hash=HASH\" suffix. This is a bug, please file a GitHub issue.")
                    });
                let cache_dir_subpath_without_patch_hash = &self.cache_dir_subpath.as_bytes()[..idx];
                // TODO(port): bun.path.join_buf is a global threadlocal buffer.
                let join_buf = path::join_buf();
                join_buf[..cache_dir_subpath_without_patch_hash.len()]
                    .copy_from_slice(cache_dir_subpath_without_patch_hash);
                join_buf[cache_dir_subpath_without_patch_hash.len()] = 0;
                // SAFETY: NUL written above.
                let subpath = unsafe {
                    ZStr::from_raw(join_buf.as_ptr(), cache_dir_subpath_without_patch_hash.len())
                };
                let exists =
                    sys::directory_exists_at(Fd::from_std_dir(self.cache_dir), subpath)
                        .unwrap()
                        .unwrap_or(false);
                if exists {
                    manager.set_preinstall_state(package_id, manager.lockfile, crate::PreinstallState::Done);
                }
                !exists
            }
        }
    }

    pub fn patched_package_missing_from_cache(
        &mut self,
        manager: &mut PackageManager,
        package_id: PackageID,
    ) -> bool {
        let exists = sys::directory_exists_at(Fd::from_std_dir(self.cache_dir), self.cache_dir_subpath)
            .unwrap()
            .unwrap_or(false);
        if exists {
            manager.set_preinstall_state(package_id, manager.lockfile, crate::PreinstallState::Done);
        }
        !exists
    }

    pub fn install(
        &mut self,
        skip_delete: bool,
        destination_dir: Dir,
        method_: Method,
        resolution_tag: Resolution::Tag,
    ) -> InstallResult {
        let _tracer = bun_core::perf::trace("PackageInstaller.install");
        // tracer.end() on Drop

        // If this fails, we don't care.
        // we'll catch it the next error
        if !skip_delete && self.destination_dir_subpath.as_bytes() != b"." {
            self.uninstall_before_install(destination_dir);
        }

        let mut supported_method_to_use = method_;

        if resolution_tag == Resolution::Tag::Folder
            && !self.lockfile.is_workspace_tree_id(self.node_modules.tree_id)
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
                            if err == bun_core::err!("NotSupported") {
                                // SAFETY: single-threaded install context.
                                unsafe { SUPPORTED_METHOD = Method::Copyfile };
                                supported_method_to_use = Method::Copyfile;
                            } else if err == bun_core::err!("FileNotFound") {
                                return InstallResult::fail(
                                    bun_core::err!("FileNotFound"),
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
                            if err == bun_core::err!("NotSupported") {
                                // SAFETY: single-threaded install context.
                                unsafe { SUPPORTED_METHOD = Method::Copyfile };
                                supported_method_to_use = Method::Copyfile;
                            } else if err == bun_core::err!("FileNotFound") {
                                return InstallResult::fail(
                                    bun_core::err!("FileNotFound"),
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
            Method::Hardlink => 'outer: {
                match self.install_with_hardlink(destination_dir) {
                    Ok(result) => return result,
                    Err(err) => {
                        #[cfg(not(windows))]
                        {
                            if err == bun_core::err!("NotSameFileSystem") {
                                // SAFETY: single-threaded install context.
                                unsafe { SUPPORTED_METHOD = Method::Copyfile };
                                supported_method_to_use = Method::Copyfile;
                                break 'outer;
                            }
                        }

                        return if err == bun_core::err!("FileNotFound") {
                            InstallResult::fail(
                                bun_core::err!("FileNotFound"),
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
                        if err == bun_core::err!("FileNotFound") {
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
        self.install_with_copyfile(destination_dir)
    }
}

// ───────────────────────────── imports note ─────────────────────────────
// Walker: src/sys/walker_skippable.zig
type Walker = bun_sys::walker_skippable::Walker;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageInstall.zig (1515 lines)
//   confidence: medium
//   todos:      17
//   notes:      Heavy std.fs.Dir usage mapped to bun_sys::Dir; self-aliasing buf+slice fields and Windows WStr building need borrowck reshaping in Phase B; Result renamed InstallResult to avoid std clash. InstallDirState cleanup on init failure relies on caller's Drop (Dir::close on invalid must be no-op).
// ──────────────────────────────────────────────────────────────────────────
