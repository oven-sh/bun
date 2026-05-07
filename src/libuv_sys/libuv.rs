//! Hand-maintained FFI bindings for the subset of libuv that Bun calls
//! directly from Rust on **Windows**. The full surface (`src/libuv_sys/libuv.zig`,
//! ~3200 lines) is auto-generated; this file ports only the types and externs
//! that have Rust callers today (`node_fs.rs`, `sys_uv.rs`, `io::source`, …).
//!
//! Layout MUST match libuv's C headers exactly — these structs are passed by
//! pointer to `uv_fs_*` and read back by field. When in doubt, compare against
//! `vendor/libuv/include/uv.h` and `vendor/libuv/include/uv/win.h`.
#![cfg(windows)]
#![allow(non_camel_case_types, non_snake_case)]

use core::ffi::{c_char, c_int, c_long, c_uint, c_void};

// ──────────────────────────────────────────────────────────────────────────
// Basic Win32 typedefs (kept local so this crate stays leaf — no `bun_sys`
// dependency; see PORTING.md §Crate map: `bun_libuv_sys` is raw FFI only).
// ──────────────────────────────────────────────────────────────────────────
type ULONG = u32;
type DWORD = u32;
type ULONG_PTR = usize;
type HANDLE = *mut c_void;
type WCHAR = u16;

pub type uv_file = c_int;
pub type uv_req_type = c_uint;
pub type uv_fs_type = c_int;
pub type uv_loop_t = Loop;
pub type uv_fs_t = fs_t;
pub type uv_fs_cb = Option<unsafe extern "C" fn(*mut fs_t)>;
// libuv on Windows defines these as `unsigned char` (chown is a no-op there).
pub type uv_uid_t = u8;
pub type uv_gid_t = u8;

/// `OVERLAPPED` — `std.os.windows.OVERLAPPED` (5 pointer-sized fields).
#[repr(C)]
#[derive(Clone, Copy)]
struct OVERLAPPED {
    Internal: ULONG_PTR,
    InternalHigh: ULONG_PTR,
    Offset: DWORD,
    OffsetHigh: DWORD,
    hEvent: HANDLE,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct uv__queue {
    next: *mut uv__queue,
    prev: *mut uv__queue,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct uv__work {
    work: Option<unsafe extern "C" fn(*mut uv__work)>,
    done: Option<unsafe extern "C" fn(*mut uv__work, c_int)>,
    loop_: *mut Loop,
    wq: uv__queue,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_timespec_t {
    pub sec: c_long,
    pub nsec: c_long,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_stat_t {
    pub dev: u64,
    pub mode: u64,
    pub nlink: u64,
    pub uid: u64,
    pub gid: u64,
    pub rdev: u64,
    pub ino: u64,
    pub size: u64,
    pub blksize: u64,
    pub blocks: u64,
    pub flags: u64,
    pub r#gen: u64,
    pub atim: uv_timespec_t,
    pub mtim: uv_timespec_t,
    pub ctim: uv_timespec_t,
    pub birthtim: uv_timespec_t,
}

// `uv_req_s.u` — overlapped/connect union shared by every `uv_req_t`.
#[repr(C)]
#[derive(Clone, Copy)]
struct req_u_io {
    overlapped: OVERLAPPED,
    queued_bytes: usize,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct req_u_connect {
    result: ULONG_PTR,
    pipeHandle: HANDLE,
    duplex_flags: DWORD,
    name: *mut WCHAR,
}
#[repr(C)]
#[derive(Clone, Copy)]
union req_u {
    io: req_u_io,
    connect: req_u_connect,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_buf_t {
    pub len: ULONG,
    pub base: *mut u8,
}
impl uv_buf_t {
    #[inline]
    pub fn init(input: &[u8]) -> uv_buf_t {
        debug_assert!(input.len() <= ULONG::MAX as usize);
        uv_buf_t { len: input.len() as ULONG, base: input.as_ptr() as *mut u8 }
    }
    #[inline]
    pub fn slice(&self) -> &[u8] {
        // SAFETY: caller-supplied (base, len); valid for the buffer's lifetime.
        unsafe { core::slice::from_raw_parts(self.base, self.len as usize) }
    }
}

// `uv_fs_t.file` / `uv_fs_t.fs` — Windows-specific tail.
#[repr(C)]
#[derive(Clone, Copy)]
union fs_file {
    pathw: *mut WCHAR,
    fd: c_int,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct fs_info {
    mode: c_int,
    new_pathw: *mut WCHAR,
    file_flags: c_int,
    fd_out: c_int,
    nbufs: c_uint,
    bufs: *mut uv_buf_t,
    offset: i64,
    bufsml: [uv_buf_t; 4],
}
#[repr(C)]
#[derive(Clone, Copy)]
struct fs_time {
    atime: f64,
    mtime: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
union fs_fs {
    info: fs_info,
    time: fs_time,
}

/// `uv_fs_t` (Windows layout). Only `data`, `result`, `ptr`, `path` are read
/// from Rust; the rest exist so `mem::zeroed::<fs_t>()` allocates the correct
/// number of bytes for libuv to write into.
#[repr(C)]
pub struct fs_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    u: req_u,
    next_req: *mut c_void, // *uv_req_s
    pub fs_type: uv_fs_type,
    pub loop_: *mut Loop,
    pub cb: uv_fs_cb,
    pub result: ReturnCodeI64,
    pub ptr: *mut c_void,
    pub path: *const c_char,
    pub statbuf: uv_stat_t,
    work_req: uv__work,
    pub flags: c_int,
    pub sys_errno_: DWORD,
    file: fs_file,
    fs: fs_fs,
}

impl fs_t {
    const UV_FS_CLEANEDUP: c_int = 0x0010;

    /// Debug sentinel: `loop_` is poisoned so `deinit()` can assert that libuv
    /// actually wrote the request before we try to clean it up.
    pub const UNINITIALIZED: fs_t = {
        // SAFETY: all-zero is a valid `fs_t` (POD `#[repr(C)]`); we then
        // poison `loop_` for the debug assertion in `assert_initialized`.
        let mut v: fs_t = unsafe { core::mem::zeroed() };
        v.loop_ = 0xAAAA_AAAA_AAAA_0000usize as *mut Loop;
        v
    };

    #[inline]
    pub fn deinit(&mut self) {
        self.assert_initialized();
        // SAFETY: `self` was passed to a `uv_fs_*` call (assert above).
        unsafe { uv_fs_req_cleanup(self) };
        self.assert_cleaned_up();
    }

    #[inline]
    fn assert_initialized(&self) {
        #[cfg(debug_assertions)]
        if self.loop_ as usize == 0xAAAA_AAAA_AAAA_0000usize {
            panic!("uv_fs_t was not initialized");
        }
    }
    #[inline]
    pub fn assert_cleaned_up(&self) {
        #[cfg(debug_assertions)]
        {
            if self.loop_ as usize == 0xAAAA_AAAA_AAAA_0000usize { return; }
            if (self.flags & Self::UV_FS_CLEANEDUP) != 0 { return; }
            panic!("uv_fs_t was not cleaned up. it is expected to call .deinit() on the fs_t here.");
        }
    }

    #[inline]
    pub unsafe fn ptr_as<T>(&self) -> *const T {
        self.assert_initialized();
        self.ptr.cast::<T>()
    }
}

/// `uv_loop_t` — opaque here (Rust never reads its fields). `Loop::get()`
/// returns the per-thread default loop, lazily initialised.
#[repr(C)]
pub struct Loop {
    _opaque: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
// Per-thread libuv loop (libuv.zig:729-740). Zig stored an inline
// `threadlocal Loop` value; Rust treats `Loop` as opaque, so the per-thread
// instance is heap-allocated at `uv_loop_size()` bytes and `uv_loop_init`'d on
// first `get()`. `shutdown()` closes it and clears the slot so a subsequent
// `get()` (e.g. a fresh worker on a recycled thread) re-initialises.
use core::cell::Cell;
thread_local! {
    static THREADLOCAL_LOOP: Cell<*mut Loop> = const { Cell::new(core::ptr::null_mut()) };
}

impl Loop {
    /// `bun.windows.libuv.Loop.get()` (libuv.zig:733). Returns this thread's
    /// libuv loop, lazily `uv_loop_init`ing it on first call. Each thread owns
    /// its own loop — the Windows event loop and the per-worker shutdown
    /// (`WebWorker::shutdown` → [`Loop::shutdown`]) require it; sharing the
    /// process-global `uv_default_loop()` across worker threads is unsound.
    pub fn get() -> *mut Loop {
        THREADLOCAL_LOOP.with(|slot| {
            let existing = slot.get();
            if !existing.is_null() {
                return existing;
            }
            // SAFETY: `uv_loop_size()` returns `sizeof(uv_loop_t)`; mimalloc
            // alignment (16) covers the struct's alignment requirement.
            let size = unsafe { uv_loop_size() };
            let layout = core::alloc::Layout::from_size_align(size, 16).unwrap();
            // SAFETY: layout is non-zero (uv_loop_t is >100 bytes on Windows).
            let ptr = unsafe { std::alloc::alloc(layout) } as *mut Loop;
            assert!(!ptr.is_null(), "OOM allocating uv_loop_t");
            // SAFETY: `ptr` is a fresh `uv_loop_size()`-byte allocation.
            if let Some(err) = unsafe { uv_loop_init(ptr) }.errno() {
                panic!("Failed to initialize libuv loop: errno {err}");
            }
            slot.set(ptr);
            ptr
        })
    }

    /// `bun.windows.libuv.Loop.shutdown()` (libuv.zig:714). Closes and frees
    /// this thread's libuv loop. Called from `WebWorker::shutdown` between
    /// `gc_controller.deinit()` and `vm.deinit()` so the per-thread uv loop
    /// (and its handles) are torn down with the worker thread.
    pub fn shutdown() {
        THREADLOCAL_LOOP.with(|slot| {
            let loop_ = slot.get();
            if loop_.is_null() {
                return;
            }
            // SAFETY: `loop_` is the live per-thread loop allocated in `get()`.
            // EBUSY ⇒ handles still open: walk + close them, run once to flush
            // close callbacks, then close again (must succeed per libuv API).
            if unsafe { uv_loop_close(loop_) }.errno().is_some() {
                // SAFETY: `loop_` valid; `close_walk_cb` is a valid callback.
                unsafe { uv_walk(loop_, Some(close_walk_cb), core::ptr::null_mut()) };
                // SAFETY: `loop_` valid; `UV_RUN_DEFAULT` runs to quiescence.
                let _ = unsafe { uv_run(loop_, RunMode::Default) };
                // SAFETY: handles closed above; close must succeed now. NOTE
                // the call is unconditional (Zig `bun.debugAssert` evaluates
                // its argument in release too) — only the check is debug-only.
                let rc = unsafe { uv_loop_close(loop_) };
                debug_assert_eq!(rc, ReturnCode::ZERO);
            }
            // SAFETY: matches the `alloc` in `get()`.
            let size = unsafe { uv_loop_size() };
            let layout = core::alloc::Layout::from_size_align(size, 16).unwrap();
            unsafe { std::alloc::dealloc(loop_.cast(), layout) };
            slot.set(core::ptr::null_mut());
        });
    }
}

/// `Loop.closeWalkCb` (libuv.zig:705) — `uv_walk` visitor that closes every
/// not-yet-closing handle so `uv_loop_close` can succeed on retry.
unsafe extern "C" fn close_walk_cb(handle: *mut uv_handle_t, _data: *mut c_void) {
    // SAFETY: libuv passes a live handle; `uv_is_closing`/`uv_close` are the
    // documented teardown pair.
    if unsafe { uv_is_closing(handle) } == 0 {
        unsafe { uv_close(handle, None) };
    }
}

/// `RunMode` (libuv.zig:681) — `uv_run` mode argument.
#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum RunMode {
    Default = 0,
    Once = 1,
    NoWait = 2,
}
pub type uv_run_mode = RunMode;

unsafe extern "C" {
    pub fn uv_loop_init(loop_: *mut uv_loop_t) -> ReturnCode;
    pub fn uv_loop_close(loop_: *mut uv_loop_t) -> ReturnCode;
    pub fn uv_loop_size() -> usize;
    pub fn uv_run(loop_: *mut uv_loop_t, mode: uv_run_mode) -> c_int;
    pub fn uv_walk(
        loop_: *mut uv_loop_t,
        walk_cb: Option<unsafe extern "C" fn(*mut uv_handle_t, *mut c_void)>,
        arg: *mut c_void,
    );
}

/// `enum(c_int)` newtype — libuv return codes are `0` on success, `-errno`
/// on failure.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct ReturnCode(pub c_int);
impl ReturnCode {
    pub const ZERO: ReturnCode = ReturnCode(0);
    #[inline] pub fn int(self) -> c_int { self.0 }
    /// `Some(e)` when negative — caller maps via
    /// `bun_sys::libuv_error_map::translate_uv_error_to_e`. We do **not** call
    /// that here to keep `bun_libuv_sys` free of `bun_sys` (layering).
    #[inline] pub fn errno(self) -> Option<u16> {
        if self.0 < 0 { Some((-self.0) as u16) } else { None }
    }
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct ReturnCodeI64(pub i64);
impl ReturnCodeI64 {
    #[inline] pub fn int(self) -> i64 { self.0 }
    #[inline] pub fn errno(self) -> Option<u16> {
        if self.0 < 0 { Some((-self.0) as u16) } else { None }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `O` — libuv `UV_FS_O_*` flag namespace + `from_bun_o` translation
// (libuv.zig:170-228). The `bun.O.*` POSIX-like values are passed in by the
// caller as a raw `i32` (per `bun_sys::O` on Windows); this fn maps them to
// libuv's MSVC `_O_*` values that `uv_fs_open` expects.
// ──────────────────────────────────────────────────────────────────────────
pub mod O {
    // UV_FS_O_* (Windows / MSVC `_O_*`).
    pub const APPEND: i32 = 0x0008;
    pub const CREAT: i32 = 0x0100;
    pub const EXCL: i32 = 0x0400;
    pub const FILEMAP: i32 = 0x2000_0000;
    pub const RANDOM: i32 = 0x0010;
    pub const RDONLY: i32 = 0x0000;
    pub const RDWR: i32 = 0x0002;
    pub const SEQUENTIAL: i32 = 0x0020;
    pub const SHORT_LIVED: i32 = 0x1000;
    pub const TEMPORARY: i32 = 0x0040;
    pub const TRUNC: i32 = 0x0200;
    pub const WRONLY: i32 = 0x0001;
    pub const DIRECT: i32 = 0x0200_0000;
    pub const DSYNC: i32 = 0x0400_0000;
    pub const SYNC: i32 = 0x0800_0000;
    // No-ops on Windows.
    pub const DIRECTORY: i32 = 0;
    pub const EXLOCK: i32 = 0;
    pub const NOATIME: i32 = 0;
    pub const NOCTTY: i32 = 0;
    pub const NOFOLLOW: i32 = 0;
    pub const NONBLOCK: i32 = 0;
    pub const SYMLINK: i32 = 0;

    // `bun.O.*` — POSIX-shaped flag values Bun normalises to internally
    // (matches `bun_sys::O` on Windows; mirrored here so this crate stays
    // leaf). libuv.zig pulls these from `bun.O`; the constants are stable.
    mod bun_o {
        pub const WRONLY: i32 = 0o1;
        pub const RDWR: i32 = 0o2;
        pub const CREAT: i32 = 0o100;
        pub const EXCL: i32 = 0o200;
        pub const NOCTTY: i32 = 0o400;
        pub const TRUNC: i32 = 0o1000;
        pub const APPEND: i32 = 0o2000;
        pub const NONBLOCK: i32 = 0o4000;
        pub const DSYNC: i32 = 0o10000;
        pub const DIRECT: i32 = 0o40000;
        pub const NOFOLLOW: i32 = 0o400000;
        pub const SYNC: i32 = 0o4010000;
    }

    /// Convert from internal `bun.O` flags to libuv/Windows flags.
    pub fn from_bun_o(c_flags: i32) -> i32 {
        let mut flags: i32 = 0;
        if c_flags & bun_o::WRONLY != 0 { flags |= WRONLY; }
        if c_flags & bun_o::RDWR != 0 { flags |= RDWR; }
        if c_flags & bun_o::CREAT != 0 { flags |= CREAT; }
        if c_flags & bun_o::EXCL != 0 { flags |= EXCL; }
        if c_flags & bun_o::TRUNC != 0 { flags |= TRUNC; }
        if c_flags & bun_o::APPEND != 0 { flags |= APPEND; }
        if c_flags & bun_o::NONBLOCK != 0 { flags |= NONBLOCK; }
        // SYNC and DSYNC must be mutually exclusive for libuv on Windows.
        // `bun.O.SYNC` (0o4010000) is a superset of `DSYNC` (0o10000), so check
        // SYNC first to emit only `UV_FS_O_SYNC` when both bits are present.
        if c_flags & bun_o::SYNC == bun_o::SYNC {
            flags |= SYNC;
        } else if c_flags & bun_o::DSYNC != 0 {
            flags |= DSYNC;
        }
        if c_flags & bun_o::NOFOLLOW != 0 { flags |= NOFOLLOW; }
        if c_flags & bun_o::DIRECT != 0 { flags |= DIRECT; }
        if c_flags & FILEMAP != 0 { flags |= FILEMAP; }
        flags
    }
}

// ──────────────────────────────────────────────────────────────────────────
// extern fns — minimal set with Rust callers.
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    pub fn uv_default_loop() -> *mut Loop;
    pub fn uv_fs_req_cleanup(req: *mut fs_t);
    pub fn uv_fs_close(loop_: *mut uv_loop_t, req: *mut fs_t, file: uv_file, cb: uv_fs_cb) -> ReturnCode;
    pub fn uv_fs_open(loop_: *mut uv_loop_t, req: *mut fs_t, path: *const c_char, flags: c_int, mode: c_int, cb: uv_fs_cb) -> ReturnCode;
    pub fn uv_fs_read(loop_: *mut uv_loop_t, req: *mut fs_t, file: uv_file, bufs: *const uv_buf_t, nbufs: c_uint, offset: i64, cb: uv_fs_cb) -> ReturnCode;
    pub fn uv_fs_write(loop_: *mut uv_loop_t, req: *mut fs_t, file: uv_file, bufs: *const uv_buf_t, nbufs: c_uint, offset: i64, cb: uv_fs_cb) -> ReturnCode;
    pub fn uv_fs_statfs(loop_: *mut uv_loop_t, req: *mut fs_t, path: *const c_char, cb: uv_fs_cb) -> ReturnCode;
    pub fn uv_fs_futime(loop_: *mut uv_loop_t, req: *mut fs_t, file: uv_file, atime: f64, mtime: f64, cb: uv_fs_cb) -> ReturnCode;
    pub fn uv_fs_utime(loop_: *mut uv_loop_t, req: *mut fs_t, path: *const c_char, atime: f64, mtime: f64, cb: uv_fs_cb) -> ReturnCode;
    pub fn uv_fs_lutime(loop_: *mut uv_loop_t, req: *mut fs_t, path: *const c_char, atime: f64, mtime: f64, cb: uv_fs_cb) -> ReturnCode;
    pub fn uv_fs_mkdtemp(loop_: *mut uv_loop_t, req: *mut fs_t, tpl: *const c_char, cb: uv_fs_cb) -> ReturnCode;
    pub fn uv_fs_realpath(loop_: *mut uv_loop_t, req: *mut fs_t, path: *const c_char, cb: uv_fs_cb) -> ReturnCode;
}

pub const UV_FS_SYMLINK_DIR: c_int = 0x0001;
pub const UV_FS_SYMLINK_JUNCTION: c_int = 0x0002;

// ──────────────────────────────────────────────────────────────────────────
// Handle / stream / pipe surface (libuv.zig:391-1495 subset).
//
// Layouts here are ported field-for-field from the Zig `extern struct`s only
// where the Rust callers touch a field directly (`.data`). Everything past
// `data` is an opaque tail sized to >= the C `sizeof`. libuv only writes
// within `sizeof(uv_<kind>_t)` of the pointer it is handed, so over-allocation
// is safe; we never read those bytes from Rust.
// ──────────────────────────────────────────────────────────────────────────

pub type uv_os_fd_t = HANDLE;

/// `Handle.Type` (libuv.zig:414). `#[repr(C)]` — value comes back from
/// `uv_guess_handle` so the discriminant must match `uv_handle_type`.
#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
pub enum HandleType {
    Unknown = 0,
    Async = 1,
    Check = 2,
    FsEvent = 3,
    FsPoll = 4,
    Handle = 5,
    Idle = 6,
    NamedPipe = 7,
    Poll = 8,
    Prepare = 9,
    Process = 10,
    Stream = 11,
    Tcp = 12,
    Timer = 13,
    Tty = 14,
    Udp = 15,
    Signal = 16,
    File = 17,
}
pub type uv_handle_type = HandleType;
/// `bun_sys::isatty` compares against this constant on Windows.
pub const UV_TTY: HandleType = HandleType::Tty;

pub type uv_close_cb = Option<unsafe extern "C" fn(*mut uv_handle_t)>;
pub type uv_connection_cb = Option<unsafe extern "C" fn(*mut uv_stream_t, ReturnCode)>;

/// `uv_handle_t` — every libuv handle begins with this header. Only `data` is
/// touched from Rust; the tail is opaque storage written by libuv.
#[repr(C)]
pub struct Handle {
    pub data: *mut c_void,
    _opaque: [*mut c_void; 11], // loop, type+pad, close_cb, queue[2], u[4], endgame_next, flags+pad
}
pub type uv_handle_t = Handle;

/// `uv_stream_t` — opaque; first field is `uv_handle_t` so a `*mut Pipe` /
/// `*mut Handle` cast to `*mut uv_stream_t` is valid for `data`.
#[repr(C)]
pub struct uv_stream_t {
    pub data: *mut c_void,
    _opaque: [u8; 0],
}

/// `uv_pipe_t` (libuv.zig:1374). `data` is the only Rust-touched field. Tail
/// is sized to cover Windows x64 `sizeof(uv_pipe_t)`; over-allocation is
/// harmless because the struct is always either heap-boxed (`Box<Pipe>`) or
/// the trailing field of a heap-boxed owner (`WindowsNamedPipeListeningContext`).
//
// PERF(port): replace with full field-accurate layout once the bindgen sweep
// lands; the conservative tail here trades a few hundred bytes per pipe for
// not hand-maintaining 18 nested `extern union`s.
#[repr(C)]
pub struct Pipe {
    pub data: *mut c_void,
    pub loop_: *mut uv_loop_t,
    // Everything past `loop_` is libuv-internal. 80 ptr-words ≈ 640 bytes on
    // x64, comfortably >= `sizeof(uv_pipe_t)` (Windows x64 measures ~576).
    _opaque: [*mut c_void; 80],
}

pub const UV_PIPE_NO_TRUNCATE: c_uint = 1;

unsafe extern "C" {
    pub fn uv_guess_handle(file: uv_file) -> uv_handle_type;
    pub fn uv_close(handle: *mut uv_handle_t, close_cb: uv_close_cb);
    pub fn uv_is_closing(handle: *const uv_handle_t) -> c_int;
    pub fn uv_listen(stream: *mut uv_stream_t, backlog: c_int, cb: uv_connection_cb) -> ReturnCode;
    pub fn uv_accept(server: *mut uv_stream_t, client: *mut uv_stream_t) -> ReturnCode;
    pub fn uv_pipe_init(loop_: *mut uv_loop_t, handle: *mut Pipe, ipc: c_int) -> ReturnCode;
    pub fn uv_pipe_bind2(handle: *mut Pipe, name: *const u8, namelen: usize, flags: c_uint) -> ReturnCode;

    pub fn uv_ref(handle: *mut uv_handle_t);
    pub fn uv_unref(handle: *mut uv_handle_t);
    pub fn uv_update_time(loop_: *mut uv_loop_t);
    pub fn uv_handle_get_loop(handle: *const uv_handle_t) -> *mut uv_loop_t;

    pub fn uv_timer_init(loop_: *mut uv_loop_t, handle: *mut Timer) -> c_int;
    pub fn uv_timer_start(handle: *mut Timer, cb: uv_timer_cb, timeout: u64, repeat: u64) -> c_int;
    pub fn uv_timer_stop(handle: *mut Timer) -> c_int;
}

/// `uv_timer_cb` (libuv.zig:1255).
pub type uv_timer_cb = Option<unsafe extern "C" fn(*mut Timer)>;

/// `uv_timer_t` (libuv.zig:1256). Only `data` is touched from Rust; the tail
/// is opaque storage written by libuv. Conservative tail sizing follows the
/// `Pipe`/`Handle` pattern above — `sizeof(uv_timer_t)` on Windows x64 is
/// ~160 bytes (`uv_handle_t` header ≈ 96 + 3 ptrs + int + 3×u64 + cb ≈ 64);
/// 32 ptr-words = 256 bytes comfortably covers it. Instances are always
/// heap-boxed (`Box<Timer>`), so over-allocation is harmless.
#[repr(C)]
pub struct Timer {
    pub data: *mut c_void,
    _opaque: [*mut c_void; 32],
}

impl Timer {
    /// `Timer.init` (libuv.zig:1272).
    pub fn init(&mut self, loop_: *mut uv_loop_t) {
        // SAFETY: `self` is a valid `uv_timer_t`-sized allocation; `loop_` is a
        // live `uv_loop_t` (caller contract).
        if unsafe { uv_timer_init(loop_, self) } != 0 {
            panic!("internal error: uv_timer_init failed");
        }
    }

    /// `Timer.start` (libuv.zig:1278).
    pub fn start(&mut self, timeout: u64, repeat: u64, callback: uv_timer_cb) {
        // SAFETY: `self` was `uv_timer_init`ed (caller contract).
        if unsafe { uv_timer_start(self, callback, timeout, repeat) } != 0 {
            panic!("internal error: uv_timer_start failed");
        }
    }

    /// `Timer.stop` (libuv.zig:1284).
    pub fn stop(&mut self) {
        // SAFETY: `self` was `uv_timer_init`ed (caller contract).
        if unsafe { uv_timer_stop(self) } != 0 {
            panic!("internal error: uv_timer_stop failed");
        }
    }

    /// `Timer.ref` (libuv.zig:1294). Named `ref_` because `ref` is a Rust keyword.
    #[inline]
    pub fn ref_(&mut self) {
        // SAFETY: `Timer` embeds `uv_handle_t` at offset 0.
        unsafe { uv_ref((self as *mut Timer).cast()) }
    }

    /// `Timer.unref` (libuv.zig:1290).
    #[inline]
    pub fn unref(&mut self) {
        // SAFETY: `Timer` embeds `uv_handle_t` at offset 0.
        unsafe { uv_unref((self as *mut Timer).cast()) }
    }
}

impl ReturnCode {
    /// Zig `ReturnCode.zero` enum variant — keep the lowercase fn for callers
    /// that ported `== uv.ReturnCode.zero` literally.
    #[inline]
    pub const fn zero() -> ReturnCode { ReturnCode(0) }
    #[inline]
    pub fn from_raw(v: c_int) -> ReturnCode { ReturnCode(v) }
}

impl Pipe {
    /// `uv_pipe_init` (libuv.zig:1419). Returns the raw `ReturnCode`; callers
    /// in higher tiers map to `bun_sys::Result` themselves so this crate stays
    /// free of `bun_sys`.
    pub fn init(&mut self, loop_: *mut uv_loop_t, ipc: bool) -> ReturnCode {
        // SAFETY: `self` is a valid `uv_pipe_t`-sized allocation; `loop_` is the
        // process libuv loop.
        unsafe { uv_pipe_init(loop_, self, if ipc { 1 } else { 0 }) }
    }

    /// `uv_pipe_bind2` with `UV_PIPE_NO_TRUNCATE` (libuv.zig:1439).
    pub fn bind(&mut self, named_pipe: &[u8], flags: c_uint) -> ReturnCode {
        // SAFETY: pipe is initialized; libuv copies the name.
        unsafe { uv_pipe_bind2(self, named_pipe.as_ptr(), named_pipe.len(), flags) }
    }

    /// `StreamMixin::listen` (libuv.zig:3047). The Zig version monomorphises a
    /// `fn(*Ctx, ReturnCode)` wrapper; here the caller supplies a plain
    /// `uv_connection_cb` and recovers its context from `handle.data` itself
    /// (set by this fn). Same wire behaviour, no comptime trampoline.
    pub fn listen(
        &mut self,
        backlog: i32,
        context: *mut c_void,
        on_connect: unsafe extern "C" fn(*mut uv_stream_t, ReturnCode),
    ) -> ReturnCode {
        self.data = context;
        // SAFETY: `Pipe` is layout-compatible with `uv_stream_t` for the first
        // field; libuv treats every stream subtype this way.
        unsafe { uv_listen((self as *mut Pipe).cast(), backlog, Some(on_connect)) }
    }

    /// `Pipe::listenNamedPipe` (libuv.zig:1432) — bind + listen.
    pub fn listen_named_pipe(
        &mut self,
        named_pipe: &[u8],
        backlog: i32,
        context: *mut c_void,
        on_connect: unsafe extern "C" fn(*mut uv_stream_t, ReturnCode),
    ) -> ReturnCode {
        let rc = self.bind(named_pipe, UV_PIPE_NO_TRUNCATE);
        if rc.errno().is_some() {
            return rc;
        }
        self.listen(backlog, context, on_connect)
    }

    /// `StreamMixin::accept` (libuv.zig:3060).
    pub fn accept(&mut self, client: &mut Pipe) -> ReturnCode {
        // SAFETY: both pipes embed `uv_stream_t` at offset 0.
        unsafe { uv_accept((self as *mut Pipe).cast(), (client as *mut Pipe).cast()) }
    }

    /// `HandleMixin::close` (libuv.zig:448). `cb` receives the same pointer
    /// cast back to `*mut Pipe`.
    pub fn close(&mut self, cb: unsafe extern "C" fn(*mut Pipe)) {
        // SAFETY: `Pipe` embeds `uv_handle_t` at offset 0; cb signature is
        // ABI-identical to `uv_close_cb` modulo the pointee type.
        unsafe {
            uv_close(
                (self as *mut Pipe).cast(),
                Some(core::mem::transmute::<
                    unsafe extern "C" fn(*mut Pipe),
                    unsafe extern "C" fn(*mut uv_handle_t),
                >(cb)),
            )
        }
    }

    #[inline]
    pub fn is_closing(&self) -> bool {
        // SAFETY: `Pipe` embeds `uv_handle_t` at offset 0.
        unsafe { uv_is_closing((self as *const Pipe).cast()) != 0 }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/libuv_sys/libuv.zig (subset: fs_t, uv_buf_t, Loop, O,
//               ReturnCode{,I64}, uv_fs_* externs)
//   confidence: medium — hand-ported #[repr(C)] layout; validate against
//               `static_assert(sizeof(uv_fs_t) == sizeof(fs_t))` in C glue.
//   notes:      Full bindgen regeneration tracked separately. Crate is
//               Windows-only (`#![cfg(windows)]`); no POSIX stub — every
//               consumer gates on `cfg(windows)`.
// ──────────────────────────────────────────────────────────────────────────
