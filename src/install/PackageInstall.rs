use core::sync::atomic::{AtomicU8, Ordering};

use bun_collections::{ArrayHashMap, DynamicBitSet};
use bun_core::Progress::Progress;
use bun_core::{Global, Output};
use bun_core::{MutableString, ZStr};
use bun_paths::strings;
use bun_paths::{
    self as path, MAX_PATH_BYTES, OSPathChar, OSPathSlice, PathBuffer, SEP, SEP_STR, WPathBuffer,
};
use bun_semver::String as SemverString;
use bun_sys::{self as sys, Dir, EntryKind, Fd, FdExt, OpenDirOptions, walker_skippable};
use bun_threading::thread_pool::{Batch, Node as ThreadPoolNode};
use bun_threading::work_pool::Task as WorkPoolTask;
use bun_threading::{ThreadPool, WaitGroup};

use crate::package_installer::NodeModulesFolder;
use crate::{
    BuntagHashBuf, Lockfile, Npm, PackageID, PackageManager, Repository, Resolution,
    TruncatedPackageNameHash, bun_fs, bun_json, buntaghashbuf_make, initialize_store, resolution,
};

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

    // std.mem.Allocator param — deleted (global mimalloc)
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

impl Method {
    /// Decode the `AtomicU8` repr back into a `Method`. Stored via
    /// `Method::* as u8` so the value is always a valid discriminant.
    #[inline]
    pub const fn from_u8(n: u8) -> Self {
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
        // PORT NOTE: Zig `Environment.isLinux` (os.tag == .linux) includes the Android ABI,
        // whereas Rust's `target_os = "linux"` does not — list `android` explicitly.
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
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
    pub debug_trace: bun_core::StoredTrace,
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
    pub fn fail(
        err: bun_core::Error,
        step: Step,
        _trace: Option<&bun_crash_handler::StackTrace>,
    ) -> InstallResult {
        InstallResult::Failure(Failure {
            err,
            step,
            #[cfg(debug_assertions)]
            debug_trace: match _trace {
                Some(t) => bun_core::StoredTrace::from(Some(t)),
                None => bun_core::StoredTrace::capture(None /* @returnAddress() */),
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

// PORTING.md §Global mutable state: install-main-thread enum. `RacyCell`
// (no `Atomic<Method>`) — writers are the CLI option-load and the
// clonefile/hardlink fallback in `install_with_method`, all on the install
// main thread; isolated_install workers snapshot via `supported_method()`
// once at startup. Stored as the `repr(u8)` discriminant so reads/writes are
// lock-free atomics (S015: AtomicU8 instead of RacyCell — single-writer path
// so `Relaxed` adds no contention).
pub static SUPPORTED_METHOD: AtomicU8 = AtomicU8::new(if cfg!(target_os = "macos") {
    Method::Clonefile as u8
} else {
    Method::Hardlink as u8
});

impl PackageInstall<'_> {
    /// Read accessor for the [`SUPPORTED_METHOD`] global (Zig:
    /// `PackageInstall.supported_method`). Associated fn so cross-module
    /// callers keep the `PackageInstall::supported_method()` call shape.
    #[inline]
    pub fn supported_method() -> Method {
        Method::from_u8(SUPPORTED_METHOD.load(Ordering::Relaxed))
    }

    /// Write accessor for [`SUPPORTED_METHOD`] (fallback path when
    /// clonefile/hardlink fails). Relaxed — single-writer, advisory hint.
    #[inline]
    pub fn set_supported_method(m: Method) {
        SUPPORTED_METHOD.store(m as u8, Ordering::Relaxed);
    }
}

// ───────────────────────────── InstallDirState ─────────────────────────────

struct InstallDirState {
    cached_package_dir: Dir,
    // PORT NOTE: `Walker` has no `Default`; Zig used `undefined`. Wrap in Option.
    walker: Option<Walker>,
    subdir: Dir,
    // PORT NOTE: Zig's `buf: bun.windows.WPathBuffer = undefined` is in-place
    // (result-location, no zero-fill). A by-value `WPathBuffer` here would
    // memset+move ~128 KB through `Default::default()` per package. Use the
    // thread-local pool guard (heap-backed, uninit) so construction is O(1)
    // and the struct stays small enough to return by value.
    #[cfg(windows)]
    buf: bun_paths::w_path_buffer_pool::Guard,
    #[cfg(windows)]
    buf2: bun_paths::w_path_buffer_pool::Guard,
    // PORT NOTE: Zig kept `to_copy_buf: []u16` as a self-referential slice into
    // `buf`. The Rust port only ever read its `.len()` to recover the offset, so
    // store the offset directly — no self-referential raw fat pointer needed.
    #[cfg(windows)]
    to_copy_buf_off: usize, // offset into `buf` where the copy-target tail starts
    #[cfg(windows)]
    to_copy_buf2_off: usize, // offset into `buf2` where the copy-target tail starts
}

impl InstallDirState {
    #[inline]
    fn walker(&mut self) -> &mut Walker {
        // SAFETY: `init_install_dir` always populates `walker` before any backend calls `copy()`.
        self.walker.as_mut().unwrap()
    }
}

impl Default for InstallDirState {
    fn default() -> Self {
        // TODO(port): Zig used `undefined` for most fields; we need a sentinel.
        Self {
            cached_package_dir: Dir::from_fd(Fd::INVALID),
            walker: None,
            #[cfg(not(windows))]
            subdir: Dir::from_fd(Fd::INVALID),
            #[cfg(windows)]
            subdir: Dir::from_fd(Fd::INVALID),
            #[cfg(windows)]
            buf: bun_paths::w_path_buffer_pool::get(),
            #[cfg(windows)]
            buf2: bun_paths::w_path_buffer_pool::get(),
            #[cfg(windows)]
            to_copy_buf_off: 0,
            #[cfg(windows)]
            to_copy_buf2_off: 0,
        }
    }
}

impl Drop for InstallDirState {
    fn drop(&mut self) {
        #[cfg(not(windows))]
        {
            if self.subdir.fd().is_valid() {
                self.subdir.close();
            }
        }
        // walker dropped automatically
        if self.cached_package_dir.fd().is_valid() {
            self.cached_package_dir.close();
        }
    }
}

// ───────────────────────────── helpers ─────────────────────────────

/// Zig: `node_fs_for_package_installer().mkdirRecursiveOSPathImpl(void, {}, fullpath, 0, false)`.
///
/// Port of the NodeFS recursive-mkdir algorithm (node_fs.zig:4080) restricted to the
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
    // u16 to mirror Zig's `@truncate(path.len)`.
    let len = path.len() as u16;

    // First, attempt to create the desired directory.
    match sys::mkdir_w(fullpath) {
        Ok(()) => return Ok(()),
        Err(err) => match err.get_errno() {
            // `mkpath_np` on macOS also checks EISDIR; on Windows EEXIST suffices.
            // NodeFS additionally probes `directoryExistsAt`; the package-install
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

    // Zig routes through `node_fs_for_package_installer()`, whose `working_mem`
    // is `&this.sync_error_buf` — a buffer in the threadlocal NodeFS struct,
    // not stack. Use the thread-local WPathBuffer pool so we don't add 64 KB
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
                            // node_fs.zig:4159-4172 — on Windows, if the existing
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

    // Final component (no trailing sep case — Zig's `first_match + 1 != len` check).
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

/// Zig: `bun.openDir(dir, subpath)` — open a directory handle relative to `dir`.
#[inline]
fn open_dir(dir: Dir, subpath: &ZStr) -> Result<Dir, bun_core::Error> {
    sys::open_dir_at(dir.fd(), subpath.as_bytes())
        .map(Dir::from_fd)
        .map_err(Into::into)
}

/// Zig: `bun.openDirA(dir, subpath)` — non-Z-terminated variant.
#[inline]
fn open_dir_a(dir: Dir, subpath: &[u8]) -> Result<Dir, bun_core::Error> {
    sys::open_dir_at(dir.fd(), subpath)
        .map(Dir::from_fd)
        .map_err(Into::into)
}

// macOS clonefileat(2) — routed through the safe `sys::clonefileat` wrapper
// (takes `Fd`/`&ZStr`, returns `Maybe<()>`). The Zig source matched on the raw
// `int` return + thread-local errno; the wrapper preserves the errno via
// `Error::get_errno()`, so the per-errno branching below is unchanged.

// ───────────────────────────── NewTaskQueue ─────────────────────────────

pub struct NewTaskQueue<TaskType> {
    pub thread_pool: &'static ThreadPool,
    /// One-shot, first-write-wins handoff of the failed task from a worker
    /// thread to the consumer that called `wait()`. A `Mutex<Option<Box<_>>>`
    /// makes ownership explicit (vs. the original `AtomicPtr`, which forced
    /// every reader to remember `Box::from_raw` and risked leaks/double-free).
    pub errored_task: bun_threading::Guarded<Option<Box<TaskType>>>,
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
        self.thread_pool.schedule(Batch::from(unsafe {
            std::ptr::from_mut::<WorkPoolTask>((*task).task())
        }));
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
    /// Layout: `[src .. , 0, dest .. , 0]`. `src` and `dest` are reconstructed
    /// on demand from `src_len` instead of storing self-referential pointers
    /// (which would be invalidated when this `Box<[u16]>` is moved into `Self`
    /// and again whenever `&mut self` reasserts uniqueness over it).
    bytes: Box<[u16]>,
    src_len: usize,
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

// PORTING.md §Global mutable state: written once on the main thread by
// `init_queue()` before any worker `run_from_thread_pool` reads it; workers
// only ever take `&HardLinkQueue` (all queue methods are `&self`).
#[cfg(windows)]
static HARDLINK_QUEUE: bun_core::RacyCell<core::mem::MaybeUninit<HardLinkQueue>> =
    bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());

#[cfg(windows)]
impl HardLinkWindowsInstallTask {
    pub fn init_queue() -> &'static HardLinkQueue {
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
        // PORT NOTE: Zig re-assigns the whole struct each call (`queue = Queue{...}`).
        // We must NOT do that: even though `copy()` always reaches `queue.wait()`
        // before returning (see the loop_err handling there), `WaitGroup::wait()` can
        // return while the last worker is still inside `WaitGroup::finish()` *after*
        // its `fetch_sub` — touching `mutex`/`cond` for the lock-unlock-signal dance.
        // Overwriting `wait_group` (or forming `&mut HardLinkQueue` at all) would race
        // with that trailing access. Instead, on re-init we only drain `errored_task`
        // through its own mutex; `wait_group`'s counter is already 0 and its
        // Mutex/Condvar are `Sync`, so a stale `finish()` tail concurrently
        // locking/signalling them is well-defined. `thread_pool` points at the
        // process-wide `PackageManager` singleton and never changes.
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

    pub fn init(src: &[OSPathChar], dest: &[OSPathChar], basename: &[OSPathChar]) -> *mut Self {
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
        // SAFETY: task points to the `task` field of a HardLinkWindowsInstallTask.
        let self_: *mut Self = unsafe { bun_core::from_field_ptr!(Self, task, task) };
        // SAFETY: HARDLINK_QUEUE initialized by init_queue() before scheduling.
        let queue = unsafe { (*HARDLINK_QUEUE.get()).assume_init_ref() };
        scopeguard::defer! { queue.complete_one(); }

        // SAFETY: self_ is valid until we reclaim the Box below.
        if let Some(err) = unsafe { (*self_).run() } {
            unsafe { (*self_).err = Some(err) };
            // SAFETY: self_ was heap-allocated in init(); reclaim ownership now.
            let boxed = unsafe { bun_core::heap::take(self_) };
            // First-write-wins: keep only the first error. Any later failing task
            // simply drops its Box here (the Zig original leaks the loser; in Rust
            // that would also leak the inner `Box<[u16]>` per failed file).
            let mut slot = queue.errored_task.lock();
            if slot.is_none() {
                *slot = Some(boxed);
            }
            return;
        }
        // SAFETY: self_ was heap-allocated in init().
        unsafe { drop(bun_core::heap::take(self_)) };
    }

    fn run(&mut self) -> Option<bun_core::Error> {
        use bun_sys::windows::{self, Win32ErrorExt as _};
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
                Output::warn(format_args!(
                    "CreateHardLinkW failed, falling back to CopyFileW: {} -> {}\n",
                    bun_core::fmt::fmt_os_path(src, Default::default()),
                    bun_core::fmt::fmt_os_path(&dest[..dest_len], Default::default()),
                ));
            }}
        }

        // SAFETY: FFI — src/dest are valid NUL-terminated u16 buffers.
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
        let uninstall_task: *mut Self = unsafe { bun_core::from_field_ptr!(Self, task, task) };

        // PORT NOTE: declared *before* the Box is reclaimed so it drops *after* the
        // Box — Rust drops locals in reverse declaration order. Zig's `defer task.deinit()`
        // runs before `defer { decrementPendingTasks(); wake() }`, i.e. the task is freed
        // before the main thread can observe pending_tasks==0.
        scopeguard::defer! {
            let pm = crate::package_manager::get();
            // SAFETY: `pending_tasks` is `AtomicU32`; raw-pointer field projection
            // avoids materializing `&mut PackageManager` from a worker thread (the
            // main thread holds the install borrow). `wake_raw` is the documented
            // thread-safe wake path that never forms `&mut PackageManager`.
            unsafe {
                (*pm).pending_tasks.fetch_sub(1, Ordering::Release);
                PackageManager::wake_raw(pm);
            }
        }

        // SAFETY: heap-allocated in uninstall_before_install; reclaim ownership here.
        let uninstall_task = unsafe { bun_core::heap::take(uninstall_task) };
        let mut debug_timer = Output::DebugTimer::start();

        let dirname =
            path::resolve_path::dirname::<path::platform::Auto>(&uninstall_task.absolute_path);
        if dirname.is_empty() {
            Output::debug_warn(format_args!(
                "Unexpectedly failed to get dirname of {}",
                bstr::BStr::new(&uninstall_task.absolute_path)
            ));
            return;
        }
        let basename = bun_paths::basename(&uninstall_task.absolute_path);

        let dir = match open_dir_a(Dir::cwd(), dirname) {
            Ok(d) => d,
            Err(err) => {
                if bun_core::Environment::IS_DEBUG || bun_core::Environment::ENABLE_ASAN {
                    Output::debug_warn(format_args!(
                        "Failed to delete {}: {}",
                        bstr::BStr::new(&uninstall_task.absolute_path),
                        bstr::BStr::new(err.name())
                    ));
                }
                return;
            }
        };
        let _close = sys::CloseOnDrop::dir(dir);

        if let Err(err) = dir.delete_tree(basename) {
            if bun_core::Environment::IS_DEBUG || bun_core::Environment::ENABLE_ASAN {
                Output::debug_warn(format_args!(
                    "Failed to delete {} in {}: {}",
                    bstr::BStr::new(basename),
                    bstr::BStr::new(dirname),
                    bstr::BStr::new(err.name())
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

        let patch_tag_path = path::resolve_path::join_z::<path::platform::Posix>(&[
            self.destination_dir_subpath.as_bytes(),
            bunhashtag,
        ]);

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
            if sys::fstatat(destination_dir.fd(), patch_tag_path).is_err() {
                return false;
            }
        }
        #[cfg(not(unix))]
        {
            match sys::openat(destination_dir.fd(), patch_tag_path, sys::O::RDONLY, 0) {
                Err(_) => return false,
                Ok(fd) => fd.close(),
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

        let Ok(bun_tag_file) = self
            .node_modules
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
            resolution::Tag::Git => {
                self.verify_git_resolution(resolution.git(), root_node_modules_dir)
            }
            resolution::Tag::Github => {
                self.verify_git_resolution(resolution.github(), root_node_modules_dir)
            }
            resolution::Tag::Root => self.verify_transitive_symlinked_folder(root_node_modules_dir),
            resolution::Tag::Folder => {
                if self
                    .lockfile
                    .is_workspace_tree_id(self.node_modules.tree_id)
                {
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
            let patch_copy = Patch {
                path: patch.path.clone(),
                contents_hash: patch.contents_hash,
            };
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
        resolution_tag: resolution::Tag,
    ) -> Option<bun_ast::Source> {
        let mut total: usize = 0;
        let mut read: usize;
        mutable.reset();
        mutable.expand_to_capacity();

        let dest_len = self.destination_dir_subpath.len();
        // Zig: `bun.copy(u8, buf[len..], sep_str ++ "package.json")` — write the
        // literal directly into the path buffer; no intermediate Vec.
        let suffix: &[u8] = &[
            SEP, b'p', b'a', b'c', b'k', b'a', b'g', b'e', b'.', b'j', b's', b'o', b'n',
        ];
        self.destination_dir_subpath_buf[dest_len..dest_len + suffix.len()].copy_from_slice(suffix);
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
        // defer package_json_file.close()
        let _close_pkg_json = sys::CloseOnDrop::file(&package_json_file);

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
            // PORT NOTE: reshaped for borrowck — recompute remain after grow.
            remain = &mut mutable.list[total..];

            if remain.len() < 1024 {
                mutable.grow_by(4096).ok()?;
            }
            mutable.expand_to_capacity();
            remain = &mut mutable.list[total..];

            read = package_json_file.read(remain).ok()?;
        }

        // If it's not long enough to have {"name": "foo", "version": "1.2.0"}, there's no way it's valid
        let minimum =
            if resolution_tag == resolution::Tag::Workspace && self.package_version.is_empty() {
                // workspaces aren't required to have a version
                br#"{"name":""}"#.len() + self.package_name.len()
            } else {
                br#"{"name":"","version":""}"#.len()
                    + self.package_name.len()
                    + self.package_version.len()
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
        root_node_modules_dir: Dir,
        resolution_tag: resolution::Tag,
    ) -> bool {
        // Zig: `var body_pool = BodyPool.get(); var mutable = body_pool.data;
        //        defer { body_pool.data = mutable; BodyPool.release(body_pool); }`
        // PoolGuard derefs straight to the pooled MutableString and releases on Drop,
        // so the take/put-back dance is unnecessary here.
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
        // log dropped at scope exit

        initialize_store();

        // PORT NOTE: Zig passed `allocator` (= `bun.default_allocator`, the global
        // mimalloc heap). `Arena::new()` here was creating + destroying a fresh
        // `mi_heap` per package — measurable on no-op installs (~390× heap churn
        // on create-next/elysia). `borrowing_default()` wraps `mi_heap_main()`
        // with a no-op Drop, matching the Zig semantics exactly. The lexer
        // scratch frees its own buffers on `Lexer::deinit()` via the checker's
        // Drop, so nothing leaks.
        let bump = bun_alloc::Arena::borrowing_default();
        let Ok(mut package_json_checker) =
            bun_json::PackageJSONVersionChecker::init(&bump, source, &mut log)
        else {
            return false;
        };
        if package_json_checker.parse_expr().is_err() {
            return false;
        }
        // PORT NOTE: reshaped for borrowck — `log` is exclusively borrowed by the
        // checker's lexer; route the read through `lexer.log_mut()` (single
        // provenance chain, see PackageJSONVersionChecker doc).
        if package_json_checker.lexer.log_mut().errors > 0 || !package_json_checker.has_found_name {
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
        package_json_checker.found_name()
            == self.package_name.slice(&self.lockfile.buffers.string_bytes)
    }

    // ───────────────────────────── install backends ─────────────────────────────

    #[cfg(target_os = "macos")]
    fn install_with_clonefile_each_dir(
        &mut self,
        destination_dir: Dir,
    ) -> Result<InstallResult, bun_core::Error> {
        let cached_package_dir = match open_dir(self.cache_dir, self.cache_dir_subpath) {
            Ok(d) => d,
            Err(err) => return Ok(InstallResult::fail(err, Step::OpeningCacheDir, None)),
        };
        let _close_cache = sys::CloseOnDrop::dir(cached_package_dir);

        let mut walker_ = match walker_skippable::walk(
            cached_package_dir.fd(),
            &[] as &[&OSPathSlice],
            &[] as &[&OSPathSlice],
        ) {
            Ok(w) => w,
            Err(err) => return Ok(InstallResult::fail(err.into(), Step::OpeningCacheDir, None)),
        };
        walker_.resolve_unknown_entry_types = true;
        // walker_ dropped at scope exit

        fn copy(destination_dir_: Dir, walker: &mut Walker) -> Result<u32, bun_core::Error> {
            // TODO(port): narrow error set
            let mut real_file_count: u32 = 0;
            let mut stackpath = [0u8; MAX_PATH_BYTES];
            while let Some(entry) = walker.next()? {
                match entry.kind {
                    EntryKind::Directory => {
                        let _ = sys::mkdirat(destination_dir_.fd(), entry.path, 0o755);
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
                                sys::Errno::EXDEV => return Err(bun_core::err!("NotSupported")), // not same file system
                                sys::Errno::EOPNOTSUPP => {
                                    return Err(bun_core::err!("NotSupported"));
                                }
                                sys::Errno::ENOENT => return Err(bun_core::err!("FileNotFound")),
                                // sometimes the downloaded npm package has already node_modules with it, so just ignore exist error here
                                sys::Errno::EEXIST => {}
                                sys::Errno::EACCES => return Err(bun_core::err!("AccessDenied")),
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

        let subdir = match destination_dir.make_open_path(
            self.destination_dir_subpath.as_bytes(),
            OpenDirOptions::default(),
        ) {
            Ok(d) => d,
            Err(err) => return Ok(InstallResult::fail(err, Step::OpeningDestDir, None)),
        };
        let _close_subdir = sys::CloseOnDrop::dir(subdir);

        self.file_count = match copy(subdir, &mut walker_) {
            Ok(n) => n,
            Err(err) => return Ok(InstallResult::fail(err, Step::CopyingFiles, None)),
        };

        Ok(InstallResult::Success)
    }

    // https://www.unix.com/man-page/mojave/2/fclonefileat/
    #[cfg(target_os = "macos")]
    fn install_with_clonefile(
        &mut self,
        destination_dir: Dir,
    ) -> Result<InstallResult, bun_core::Error> {
        if self.destination_dir_subpath.as_bytes()[0] == b'@' {
            if let Some(slash) = strings::index_of_char_z(self.destination_dir_subpath, SEP) {
                let slash = slash as usize;
                self.destination_dir_subpath_buf[slash] = 0;
                // SAFETY: NUL written above.
                let subdir = ZStr::from_buf(&self.destination_dir_subpath_buf, slash);
                let _ = sys::mkdirat(destination_dir.fd(), subdir, 0o755);
                self.destination_dir_subpath_buf[slash] = SEP;
            }
        }

        match sys::clonefileat(
            self.cache_dir.fd(),
            self.cache_dir_subpath,
            destination_dir.fd(),
            self.destination_dir_subpath,
        ) {
            Ok(()) => Ok(InstallResult::Success),
            Err(e) => match e.get_errno() {
                sys::Errno::EXDEV => Err(bun_core::err!("NotSupported")), // not same file system
                sys::Errno::EOPNOTSUPP => Err(bun_core::err!("NotSupported")),
                sys::Errno::ENOENT => Err(bun_core::err!("FileNotFound")),
                // We first try to delete the directory
                // But, this can happen if this package contains a node_modules folder
                // We want to continue installing as many packages as we can, so we shouldn't block while downloading
                // We use the slow path in this case
                sys::Errno::EEXIST => self.install_with_clonefile_each_dir(destination_dir),
                sys::Errno::EACCES => Err(bun_core::err!("AccessDenied")),
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
                        self.cache_dir.fd(),
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
            Err(err) => return InstallResult::fail(err, Step::OpeningCacheDir, None),
        };

        // PORT NOTE: `bun.OSPathLiteral("node_modules")` — u8 on posix / u16 on windows.
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

        state.walker = Some(
            walker_skippable::walk(
                state.cached_package_dir.fd(),
                &[] as &[&OSPathSlice],
                skip_dirs,
            )
            .expect("oom"), // bun.handleOom
        );
        state.walker.as_mut().unwrap().resolve_unknown_entry_types = true;

        #[cfg(not(windows))]
        {
            state.subdir = match destbase.make_open_path(
                destpath.as_bytes(),
                OpenDirOptions {
                    iterate: true,
                    ..Default::default()
                },
            ) {
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
            use bun_sys::windows::{self, Win32ErrorExt as _};

            // SAFETY: FFI — destbase.fd() is an open handle; state.buf is a valid writable
            // WPathBuffer of the passed length.
            let dest_path_length = unsafe {
                windows::GetFinalPathNameByHandleW(
                    destbase.fd().native(),
                    state.buf.as_mut_ptr(),
                    u32::try_from(state.buf.len()).expect("int cast"),
                    0,
                )
            } as usize;
            if dest_path_length == 0 || dest_path_length >= state.buf.len() {
                let e = windows::Win32Error::get();
                let err = if dest_path_length == 0 {
                    e.to_system_errno()
                        .map(|s| s.to_error())
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
            let fullpath = bun_core::WStr::from_buf(&state.buf[..], i);

            let _ = mkdir_recursive_os_path(fullpath);
            state.to_copy_buf_off = fullpath.len();

            // SAFETY: FFI — cached_package_dir.fd() is an open handle (opened above);
            // state.buf2 is a valid writable WPathBuffer of the passed length.
            let cache_path_length = unsafe {
                windows::GetFinalPathNameByHandleW(
                    state.cached_package_dir.fd().native(),
                    state.buf2.as_mut_ptr(),
                    u32::try_from(state.buf2.len()).expect("int cast"),
                    0,
                )
            } as usize;
            if cache_path_length == 0 || cache_path_length >= state.buf2.len() {
                let e = windows::Win32Error::get();
                let err = if cache_path_length == 0 {
                    e.to_system_errno()
                        .map(|s| s.to_error())
                        .unwrap_or(bun_core::err!("Unexpected"))
                } else {
                    bun_core::err!("NameTooLong")
                };
                // PORT NOTE: Drop on caller's `state` closes cached_package_dir; explicit close
                // here would double-close (see posix branch above for full rationale).
                return InstallResult::fail(err, Step::CopyingFiles, None);
            }
            // PORT NOTE: borrowck — Zig held `cache_path = buf2[0..len]` while mutating
            // buf2; index by `cache_path_length` directly so no shared borrow is live.
            state.to_copy_buf2_off = if state.buf2[cache_path_length - 1] != u16::from(b'\\') {
                state.buf2[cache_path_length] = u16::from(b'\\');
                cache_path_length + 1
            } else {
                cache_path_length
            };
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
        #[cfg(windows)]
        type WinOffset = usize;
        #[cfg(not(windows))]
        type WinOffset = ();

        // PORT NOTE: reshaped for borrowck — Zig passed two overlapping slices into the
        // same buffer (`head` is the whole buffer, `to_copy_into` is its tail). Creating
        // two live `&mut [u16]` that alias is UB in Rust, so pass head buffer + tail
        // offset and reslice inside.
        fn copy(
            destination_dir_: Dir,
            walker: &mut Walker,
            mut progress_: Option<&mut Progress>,
            #[allow(unused)] to_copy_into1_offset: WinOffset,
            #[allow(unused)] head1: WinSlice<'_>,
            #[allow(unused)] to_copy_into2_offset: WinOffset,
            #[allow(unused)] head2: WinSlice<'_>,
        ) -> Result<u32, bun_core::Error> {
            // TODO(port): narrow error set
            let mut real_file_count: u32 = 0;
            let mut copy_file_state = bun_sys::copy_file::CopyFileState::default();

            while let Some(entry) = walker.next()? {
                #[cfg(windows)]
                {
                    use bun_sys::windows::{self, Win32ErrorExt as _};
                    match entry.kind {
                        EntryKind::Directory | EntryKind::File => {}
                        _ => continue,
                    }

                    if entry.path.len() > head1.len() - to_copy_into1_offset
                        || entry.path.len() > head2.len() - to_copy_into2_offset
                    {
                        return Err(bun_core::err!("NameTooLong"));
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
                            // SAFETY: FFI — src/dest are valid NUL-terminated WStr buffers built
                            // into head1/head2 above.
                            if unsafe {
                                windows::CreateDirectoryExW(
                                    src.as_ptr(),
                                    dest.as_ptr(),
                                    core::ptr::null_mut(),
                                )
                            } == 0
                            {
                                let _ = bun_sys::MakePath::make_path_u16(
                                    destination_dir_,
                                    entry.path.as_slice(),
                                );
                            }
                        }
                        EntryKind::File => {
                            // SAFETY: FFI — src/dest are valid NUL-terminated WStr buffers.
                            if unsafe { windows::CopyFileW(src.as_ptr(), dest.as_ptr(), 0) } == 0 {
                                if let Some(entry_dirname) =
                                    bun_paths::Dirname::dirname_u16(entry.path.as_slice())
                                {
                                    let _ = bun_sys::MakePath::make_path_u16(
                                        destination_dir_,
                                        entry_dirname,
                                    );
                                    // SAFETY: FFI — src/dest are valid NUL-terminated WStr buffers.
                                    if unsafe { windows::CopyFileW(src.as_ptr(), dest.as_ptr(), 0) }
                                        != 0
                                    {
                                        continue;
                                    }
                                }

                                if let Some(progress) = progress_.as_deref_mut() {
                                    progress.root.end();
                                    progress.refresh();
                                }

                                if let Some(err) = windows::Win32Error::get().to_system_errno() {
                                    Output::pretty_errorln(format_args!(
                                        "<r><red>{}<r>: copying file {}",
                                        <&'static str>::from(err),
                                        bun_core::fmt::fmt_os_path(
                                            entry.path.as_slice(),
                                            Default::default()
                                        )
                                    ));
                                } else {
                                    Output::pretty_errorln(format_args!(
                                        "<r><red>error<r> copying file {}",
                                        bun_core::fmt::fmt_os_path(
                                            entry.path.as_slice(),
                                            Default::default()
                                        )
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
                    if entry.kind != EntryKind::File {
                        continue;
                    }
                    real_file_count += 1;

                    let in_file = sys::openat(entry.dir, entry.basename, sys::O::RDONLY, 0)?;
                    let _close_in = sys::CloseOnDrop::new(in_file);

                    bun_output::scoped_log!(
                        install,
                        "createFile {} {}\n",
                        destination_dir_.fd(),
                        bstr::BStr::new(entry.path.as_bytes())
                    );
                    // Zig: `std.fs.Dir.createFile(dir, path, .{})` — open O_WRONLY|O_CREAT|O_TRUNC,
                    // mode = std.fs.File.default_mode (0o666).
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

                                    Output::pretty_errorln(format_args!(
                                        "<r><red>{}<r>: copying file {}",
                                        bstr::BStr::new(err.name()),
                                        bun_core::fmt::fmt_os_path(
                                            entry.path.as_bytes(),
                                            Default::default()
                                        )
                                    ));
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
                        // Result intentionally ignored to match Zig's `_ = c.fchmod(...)`.
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

                        Output::pretty_errorln(format_args!(
                            "<r><red>{}<r>: copying file {}",
                            bstr::BStr::new(err.name()),
                            bun_core::fmt::fmt_os_path(entry.path.as_bytes(), Default::default())
                        ));
                        Global::crash();
                    }
                }
            }

            Ok(real_file_count)
        }

        #[cfg(windows)]
        let result = copy(
            state.subdir,
            state.walker.as_mut().unwrap(),
            self.progress.as_deref_mut(),
            state.to_copy_buf_off,
            &mut state.buf[..],
            state.to_copy_buf2_off,
            &mut state.buf2[..],
        );
        #[cfg(not(windows))]
        let result = copy(
            state.subdir,
            state.walker(),
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
        #[cfg(windows)]
        type WinOffset = usize;
        #[cfg(not(windows))]
        type WinOffset = ();

        // PORT NOTE: reshaped for borrowck — Zig passed two overlapping slices into the
        // same buffer (`head` is the whole buffer, `to_copy_into` is its tail). Creating
        // two live `&mut [u16]` that alias is UB in Rust, so pass head buffer + tail
        // offset and reslice inside.
        fn copy(
            destination_dir: Dir,
            walker: &mut Walker,
            #[allow(unused)] to_copy_into1_offset: WinOffset,
            #[allow(unused)] head1: WinSlice<'_>,
            #[allow(unused)] to_copy_into2_offset: WinOffset,
            #[allow(unused)] head2: WinSlice<'_>,
        ) -> Result<u32, bun_core::Error> {
            // TODO(port): narrow error set
            let mut real_file_count: u32 = 0;
            #[cfg(windows)]
            let queue = HardLinkWindowsInstallTask::init_queue();
            // PORT NOTE: on Windows, tasks already pushed to `queue` are running on
            // worker threads; an early `?` here would return before `queue.wait()`,
            // letting the caller re-enter `init_queue()` and reset the WaitGroup
            // while workers are still inside `complete_one()` (data race on the
            // counter/condvar). Capture loop errors and always fall through to wait.
            #[cfg(windows)]
            let mut loop_err: Option<bun_core::Error> = None;

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
                            if let Err(err) = sys::linkat(
                                entry.dir,
                                entry.basename,
                                destination_dir.fd(),
                                entry.path,
                            ) {
                                // Map raw errno to the Zig error names std.posix.linkatZ would
                                // produce, so the caller's `NotSameFileSystem` / `ENXIO` checks
                                // (and the copyfile fallback in `install()`) actually fire.
                                match err.get_errno() {
                                    sys::E::EEXIST => {
                                        let _ = sys::unlinkat(destination_dir.fd(), entry.path);
                                        sys::linkat(
                                            entry.dir,
                                            entry.basename,
                                            destination_dir.fd(),
                                            entry.path,
                                        )?;
                                    }
                                    sys::E::EXDEV => {
                                        return Err(bun_core::err!("NotSameFileSystem"));
                                    }
                                    sys::E::ENXIO => {
                                        return Err(bun_core::err!("ENXIO"));
                                    }
                                    _ => return Err(err.into()),
                                }
                            }

                            real_file_count += 1;
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
                        loop_err = Some(bun_core::err!("NameTooLong"));
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

                    queue.push(HardLinkWindowsInstallTask::init(
                        src.as_slice(),
                        dest.as_slice(),
                        entry.basename.as_slice(),
                    ));
                    real_file_count += 1;
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

            Ok(real_file_count)
        }

        #[cfg(windows)]
        let result = copy(
            state.subdir,
            state.walker.as_mut().unwrap(),
            state.to_copy_buf_off,
            &mut state.buf[..],
            state.to_copy_buf2_off,
            &mut state.buf2[..],
        );
        #[cfg(not(windows))]
        let result = copy(state.subdir, state.walker(), (), (), (), ());

        self.file_count = match result {
            Ok(n) => n,
            Err(err) => {
                // bun.handleErrorReturnTrace — debug-only diagnostics in Zig; no-op here.

                #[cfg(windows)]
                {
                    if err == bun_core::err!("FailedToCopyFile") {
                        return Ok(InstallResult::fail(err, Step::CopyingFiles, None));
                    }
                }
                #[cfg(not(windows))]
                {
                    if err == bun_core::err!("NotSameFileSystem") || err == bun_core::err!("ENXIO")
                    {
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
        let mut to_copy_buf2_offset: usize = 0;
        #[cfg(unix)]
        {
            let cache_dir_path = sys::get_fd_path(state.cached_package_dir.fd(), &mut buf2)?;
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

        // PORT NOTE: reshaped for borrowck — Zig passed two overlapping slices into the
        // same buffer (`head` is the whole buffer, `to_copy_into` is its tail). Creating
        // two live `&mut` that alias is UB in Rust, so pass head buffer + tail offset
        // and reslice inside.
        fn copy(
            destination_dir: Dir,
            walker: &mut Walker,
            #[allow(unused)] to_copy_into1_offset: WinOffset,
            #[allow(unused)] head1: WinSlice<'_>,
            #[allow(unused)] to_copy_into2_offset: usize,
            head2: &mut [Head2Char],
        ) -> Result<u32, bun_core::Error> {
            // TODO(port): narrow error set
            let mut real_file_count: u32 = 0;
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
                            // SAFETY: NUL written above.
                            let target = ZStr::from_buf(&head2, target_len);

                            if let Err(err) =
                                sys::symlinkat(target, destination_dir.fd(), entry.path)
                            {
                                if err.get_errno() != sys::E::EEXIST {
                                    return Err(err.into());
                                }

                                let _ = sys::unlinkat(destination_dir.fd(), entry.path);
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
                        EntryKind::Directory | EntryKind::File => {}
                        _ => continue,
                    }

                    if entry.path.len() > head1.len() - to_copy_into1_offset
                        || entry.path.len() > head2.len() - to_copy_into2_offset
                    {
                        return Err(bun_core::err!("NameTooLong"));
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
                            // SAFETY: FFI — src/dest are valid NUL-terminated WStr buffers built
                            // into head1/head2 above.
                            if unsafe {
                                windows::CreateDirectoryExW(
                                    src.as_ptr(),
                                    dest.as_ptr(),
                                    core::ptr::null_mut(),
                                )
                            } == 0
                            {
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
                                        Output::warn(format_args!(
                                            "CreateHardLinkW failed, falling back to CopyFileW: {} -> {}\n",
                                            bun_core::fmt::fmt_os_path(src.as_slice(), Default::default()),
                                            bun_core::fmt::fmt_os_path(dest.as_slice(), Default::default()),
                                        ));
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

            Ok(real_file_count)
        }

        #[cfg(windows)]
        let result = copy(
            state.subdir,
            state.walker.as_mut().unwrap(),
            state.to_copy_buf_off,
            &mut state.buf[..],
            state.to_copy_buf2_off,
            &mut state.buf2[..],
        );
        #[cfg(not(windows))]
        let result = copy(
            state.subdir,
            state.walker(),
            (),
            (),
            to_copy_buf2_offset,
            &mut buf2[..],
        );

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
                    if err == bun_core::err!("NotSameFileSystem") || err == bun_core::err!("ENXIO")
                    {
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
        let temp_path = {
            use std::io::Write;
            let mut cursor = &mut rand_path_buf[..];
            write!(cursor, ".old-{}", bun_core::fmt::hex_upper(&rand_bytes))
                .expect("infallible: in-memory write");
            let written = 48 - cursor.len();
            rand_path_buf[written] = 0;
            // SAFETY: NUL written at [written].
            ZStr::from_buf(&rand_path_buf, written)
        };

        match sys::renameat(
            destination_dir.fd(),
            self.destination_dir_subpath,
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
                PackageManager::get()
                    .thread_pool
                    .schedule(Batch::from(unsafe {
                        core::ptr::addr_of_mut!((*task).task)
                    }));
            }
        }
    }

    pub fn is_dangling_symlink(path: &ZStr) -> bool {
        #[cfg(target_os = "linux")]
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
        #[cfg(not(any(target_os = "linux", windows)))]
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

    #[cfg(windows)]
    pub fn is_dangling_windows_bin_link(
        node_mod_fd: Fd,
        path: &[u16],
        temp_buffer: &mut [u8],
    ) -> bool {
        use crate::windows_shim::BinLinkingShim as WinBinLinkingShim;
        let bin_path = 'bin_path: {
            let Ok(file) =
                sys::openat_windows(node_mod_fd, path, sys::O::RDONLY, 0).map(sys::File::from_fd)
            else {
                return true;
            };
            let _close = sys::CloseOnDrop::file(&file);
            let Ok(size) = file.read_all(temp_buffer) else {
                return true;
            };
            let Some(decoded) = crate::windows_shim::loose_decode(&temp_buffer[..size]) else {
                return true;
            };
            debug_assert!(decoded.flags.is_valid()); // looseDecode ensures valid flags
            break 'bin_path decoded.bin_path;
        };

        {
            let Ok(fd) = sys::openat_windows(node_mod_fd, bin_path, sys::O::RDONLY, 0) else {
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

        // PORT NOTE: Zig `std.fs.path.dirname` returns null when there is no directory
        // component; mirror that with an Option around resolve_path::dirname.
        let dirname_slice =
            path::resolve_path::dirname::<path::platform::Auto>(dest_path.as_bytes());
        let subdir: Option<&[u8]> = (!dirname_slice.is_empty()
            && dirname_slice != dest_path.as_bytes())
        .then_some(dirname_slice);

        let mut dest_buf = PathBuffer::uninit();
        // cache_dir_subpath in here is actually the full path to the symlink pointing to the linked package
        let symlinked_path = self.cache_dir_subpath;
        let mut to_buf = PathBuffer::uninit();
        // Zig: `this.cache_dir.realpath(symlinked_path, &to_buf)` — open the target relative
        // to cache_dir, then resolve its canonical path.
        // PORT NOTE: reshaped from an IIFE — returning a borrow of `to_buf` from an
        // `FnMut` closure is rejected by borrowck, so inline the open/getFdPath/close.
        // PORT NOTE: Zig `std.fs.Dir.realpath` returns std-style error names
        // (`error.FileNotFound`, `error.AccessDenied`, …), not raw errno tags.
        // `bun_sys::Error::into()` would yield `ENOENT`/`EACCES`, so map the
        // openat errno to the std name to preserve the user-visible error tag
        // (test/cli/install/bun-link.test.ts asserts on `FileNotFound:`).
        let realpath_err = |e: bun_sys::Error| -> bun_core::Error {
            use sys::E;
            match e.get_errno() {
                E::ENOENT => bun_core::err!("FileNotFound"),
                E::EACCES => bun_core::err!("AccessDenied"),
                E::ENOTDIR => bun_core::err!("NotDir"),
                E::ENAMETOOLONG => bun_core::err!("NameTooLong"),
                E::ELOOP => bun_core::err!("SymLinkLoop"),
                E::ENOMEM => bun_core::err!("SystemResources"),
                _ => e.into(),
            }
        };
        let to_path: &[u8] = {
            // Zig: `std.fs.Dir.realpath` opens with `.filter = .any` (Windows) /
            // `O_PATH` (Linux). `symlinked_path` is always a package *directory*;
            // bare `O::RDONLY` on Windows routes to the file-open NtCreateFile arm
            // which requests `FILE_WRITE_ATTRIBUTES` (may be denied on RO dirs).
            // `O::DIRECTORY` routes to `open_dir_at_windows_nt_path`
            // (`FILE_LIST_DIRECTORY | SYNCHRONIZE`), matching the spec's directory
            // open, then `get_fd_path` resolves via `GetFinalPathNameByHandleW`.
            let fd = match sys::openat(
                self.cache_dir.fd(),
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
        let to_path_len = to_path.len();

        let dest = bun_paths::basename(dest_path.as_bytes());
        // When we're linking on Windows, we want to avoid keeping the source directory handle open
        #[cfg(windows)]
        {
            use bun_sys::windows::{self, Win32ErrorExt as _};
            let mut wbuf = WPathBuffer::uninit();
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
                let e = windows::Win32Error::get();
                let err = if dest_path_length == 0 {
                    e.to_system_errno()
                        .map(|s| s.to_error())
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
                        bun_sys::errno_to_zig_err(err.errno.into()),
                        Step::LinkingDependency,
                        None,
                    );
                }
                Ok(_) => {}
            }
        }
        #[cfg(not(windows))]
        {
            let dest_dir = if let Some(dir) = subdir {
                match bun_sys::MakePath::make_open_path(
                    destination_dir,
                    dir,
                    OpenDirOptions::default(),
                ) {
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

            let dest_dir_path = match sys::get_fd_path(dest_dir.fd(), &mut dest_buf) {
                Ok(p) => p,
                Err(err) => return InstallResult::fail(err.into(), Step::LinkingDependency, None),
            };

            let target = path::resolve_path::relative(dest_dir_path, to_path);
            // PORT NOTE: `symlinkat` takes `&ZStr` for both target and dest; build NUL-terminated
            // copies in stack buffers (Zig used `std.posix.symlinkat` which does this internally).
            let mut target_buf = PathBuffer::uninit();
            target_buf[..target.len()].copy_from_slice(target);
            target_buf[target.len()] = 0;
            // SAFETY: NUL written above.
            let target_z = ZStr::from_buf(&target_buf, target.len());
            let mut dest_name_buf = [0u8; 512];
            dest_name_buf[..dest.len()].copy_from_slice(dest);
            // SAFETY: zero-initialized; NUL at [dest.len()].
            let dest_z = ZStr::from_buf(&dest_name_buf, dest.len());
            if let Err(err) = sys::symlinkat(target_z, dest_dir.fd(), dest_z) {
                return InstallResult::fail(err.into(), Step::LinkingDependency, None);
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
            Self::supported_method()
        }
    }

    pub fn package_missing_from_cache(
        &mut self,
        manager: &mut PackageManager,
        package_id: PackageID,
        resolution_tag: resolution::Tag,
    ) -> bool {
        let state = manager.get_preinstall_state(package_id);
        match state {
            crate::PreinstallState::Done => false,
            _ => 'brk: {
                if self.patch.is_none() {
                    let exists = match resolution_tag {
                        resolution::Tag::Npm => 'package_json_exists: {
                            // SAFETY: thread-local PathBuffer; this is the only borrower on
                            // this thread for the duration of the block (Zig: `var buf = ...`).
                            let buf: &mut [u8] = unsafe {
                                (*crate::package_manager::cached_package_folder_name_buf())
                                    .as_mut_slice()
                            };

                            if cfg!(debug_assertions) {
                                debug_assert!(bun_core::is_slice_in_buffer(
                                    self.cache_dir_subpath.as_bytes(),
                                    buf
                                ));
                            }

                            let subpath_len =
                                strings::without_trailing_slash(self.cache_dir_subpath.as_bytes())
                                    .len();
                            buf[subpath_len] = SEP;
                            // SAFETY: p points into the long-lived cached_package_folder_name_buf;
                            // subpath_len is in bounds (was the prior NUL position).
                            let _restore =
                                scopeguard::guard(buf.as_mut_ptr(), move |p: *mut u8| unsafe {
                                    *p.add(subpath_len) = 0;
                                });
                            buf[subpath_len + 1..subpath_len + 1 + b"package.json\0".len()]
                                .copy_from_slice(b"package.json\0");
                            // SAFETY: NUL written above.
                            let subpath =
                                ZStr::from_buf(&buf[..], subpath_len + 1 + b"package.json".len());
                            break 'package_json_exists sys::exists_at(
                                self.cache_dir.fd(),
                                subpath,
                            );
                        }
                        _ => sys::directory_exists_at(self.cache_dir.fd(), self.cache_dir_subpath)
                            .unwrap_or(false),
                    };
                    if exists {
                        manager.set_preinstall_state(package_id, crate::PreinstallState::Done);
                    }
                    break 'brk !exists;
                }
                let idx = strings::last_index_of(self.cache_dir_subpath.as_bytes(), b"_patch_hash=")
                    .unwrap_or_else(|| {
                        panic!("Patched dependency cache dir subpath does not have the \"_patch_hash=HASH\" suffix. This is a bug, please file a GitHub issue.")
                    });
                let cache_dir_subpath_without_patch_hash =
                    &self.cache_dir_subpath.as_bytes()[..idx];
                // PORT NOTE: Zig wrote into the global `bun.path.join_buf` thread-local; use a
                // stack PathBuffer here instead (same size, no shared state).
                let mut join_buf = PathBuffer::uninit();
                join_buf[..cache_dir_subpath_without_patch_hash.len()]
                    .copy_from_slice(cache_dir_subpath_without_patch_hash);
                join_buf[cache_dir_subpath_without_patch_hash.len()] = 0;
                // SAFETY: NUL written above.
                let subpath =
                    ZStr::from_buf(&join_buf[..], cache_dir_subpath_without_patch_hash.len());
                let exists =
                    sys::directory_exists_at(self.cache_dir.fd(), subpath).unwrap_or(false);
                if exists {
                    manager.set_preinstall_state(package_id, crate::PreinstallState::Done);
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
        let exists =
            sys::directory_exists_at(self.cache_dir.fd(), self.cache_dir_subpath).unwrap_or(false);
        if exists {
            manager.set_preinstall_state(package_id, crate::PreinstallState::Done);
        }
        !exists
    }

    pub fn install(
        &mut self,
        skip_delete: bool,
        destination_dir: Dir,
        method_: Method,
        resolution_tag: resolution::Tag,
    ) -> InstallResult {
        let _tracer = bun_core::perf::trace("PackageInstaller.install");
        // tracer.end() on Drop

        // If this fails, we don't care.
        // we'll catch it the next error
        if !skip_delete && self.destination_dir_subpath.as_bytes() != b"." {
            self.uninstall_before_install(destination_dir);
        }

        let mut supported_method_to_use = method_;

        if resolution_tag == resolution::Tag::Folder
            && !self
                .lockfile
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
                            if err == bun_core::err!("NotSupported") {
                                Self::set_supported_method(Method::Copyfile);
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
                                Self::set_supported_method(Method::Copyfile);
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
                                Self::set_supported_method(Method::Copyfile);
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
type Walker = walker_skippable::Walker;

// ported from: src/install/PackageInstall.zig
