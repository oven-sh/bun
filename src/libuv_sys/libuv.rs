//! Zero-cost, zero-alloc FFI bindings for libuv on **Windows**.
//!
//! Field-accurate `#[repr(C)]` mirrors of every `uv_*_t` Bun touches, ported
//! directly from `src/libuv_sys/libuv.zig` (itself `translate-c` of
//! `vendor/libuv/include/uv.h` + `uv/win.h`). All structs are POD (`Copy` where
//! `union`s permit), all-zero is a valid bit-pattern (libuv expects callers to
//! `memset(0)` before `uv_*_init`), and no method allocates.
//!
//! Layouts are layout-asserted at the bottom of this file against the
//! authoritative `sizeof`s from a Windows-x64 build of libuv.
#![cfg(windows)]
#![allow(
    non_camel_case_types,
    non_snake_case,
    non_upper_case_globals,
    clippy::missing_safety_doc
)]

use core::cell::{Cell, UnsafeCell};
use core::ffi::{c_char, c_int, c_long, c_uint, c_ulong, c_ushort, c_void};
use core::mem::MaybeUninit;
use core::{fmt, mem, ptr};

// ──────────────────────────────────────────────────────────────────────────
// Debug log scope (`bun.Output.scoped(.uv, .hidden)`). This crate is leaf
// (no `bun_output` dep), so the macro compiles to nothing in release and to
// an `eprintln!` gated by `BUN_DEBUG_uv` in debug.
// ──────────────────────────────────────────────────────────────────────────
#[doc(hidden)]
#[cfg(debug_assertions)]
#[inline]
pub fn __uv_log_enabled() -> bool {
    // `Output.scoped` reads the env var once at startup; `inc/dec` are on the
    // per-handle ref/unref hot path, so cache the lookup instead of paying a
    // GetEnvironmentVariableW syscall + alloc per tick.
    static ENABLED: ::std::sync::OnceLock<bool> = ::std::sync::OnceLock::new();
    *ENABLED.get_or_init(|| ::std::env::var_os("BUN_DEBUG_uv").is_some())
}
#[doc(hidden)]
#[macro_export]
macro_rules! __uv_log {
    ($($arg:tt)*) => {{
        #[cfg(debug_assertions)]
        if $crate::__uv_log_enabled() {
            ::std::eprintln!("[uv] {}", ::std::format_args!($($arg)*));
        }
    }};
}
/// `bun.windows.libuv.log` — re-exported under the conventional name.
pub use crate::__uv_log as log;

// ──────────────────────────────────────────────────────────────────────────
// Win32 ABI typedefs. Shared POD structs/typedefs come from the tier-0
// `bun_windows_sys` leaf so the same nominal types flow through libuv,
// `bun_sys`, and the runtime without cross-crate mismatch.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_windows_sys::{
    BOOL, COORD, CRITICAL_SECTION, DWORD, HANDLE, HMODULE, INPUT_RECORD, INVALID_HANDLE_VALUE,
    LARGE_INTEGER, LONG, OVERLAPPED, SHORT, ULONG, ULONG_PTR, WCHAR, WIN32_FIND_DATAW, WORD,
};
// Kept local — NOT re-exported from `bun_windows_sys`:
// • CHAR: libuv wants u8, `bun_windows_sys::CHAR` is c_char (i8 on MSVC).
// • NTSTATUS: libuv wants plain i32, `bun_windows_sys::NTSTATUS` is a newtype.
pub type CHAR = u8;
pub type NTSTATUS = i32;
/// Win32 `SOCKET` is `UINT_PTR` (an integer), not a pointer; matches Zig's
/// `std.os.windows.ws2_32.SOCKET = usize`. A raw-pointer type would give
/// `Option<SOCKET>` an unwanted niche (None ↔ 0 collides with socket 0) and
/// force int-to-ptr provenance for `INVALID_SOCKET`.
pub type SOCKET = usize;
type LPFN_ACCEPTEX = *const c_void;
type LPFN_CONNECTEX = *const c_void;
type LPFN_WSARECV = *const c_void;
type LPFN_WSARECVFROM = *const c_void;
type FILE = c_void;
pub type uv_mutex_t = CRITICAL_SECTION;

// Socket address types (ws2def.h). The canonical `#[repr(C)]` definitions live
// in `bun_windows_sys::ws2_32` so the same nominal type flows through libuv,
// uws, and the runtime — keeps `set_membership(&sockaddr_storage)` etc. from
// becoming a cross-crate type mismatch.
pub use bun_windows_sys::ws2_32::{
    addrinfo, sockaddr, sockaddr_in, sockaddr_in6, sockaddr_storage,
};

// ──────────────────────────────────────────────────────────────────────────
// libuv scalar typedefs.
// ──────────────────────────────────────────────────────────────────────────
pub type uv_file = c_int;
pub type uv_os_sock_t = SOCKET;
pub type uv_os_fd_t = HANDLE;
pub type uv_pid_t = c_int;
pub type uv_thread_t = HANDLE;
pub type uv_sem_t = HANDLE;
pub type uv_uid_t = u8;
pub type uv_gid_t = u8;
pub type uv_req_type = c_uint;
pub type uv_fs_type = c_int;
pub type uv_errno_t = c_int;
pub type uv_loop_option = c_uint;
pub type uv_membership = c_uint;
pub type uv_tty_mode_t = c_uint;
/// `uv_tty_mode_t` (uv.h) — typed wrapper for `uv_tty_set_mode` callers.
#[repr(u32)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TtyMode {
    Normal = 0, // UV_TTY_MODE_NORMAL
    Raw = 1,    // UV_TTY_MODE_RAW
    Io = 2,     // UV_TTY_MODE_IO
    /// `UV_TTY_MODE_RAW_VT` — raw mode with VT input processing left to the
    /// terminal (Windows ENABLE_VIRTUAL_TERMINAL_INPUT). Aligns with POSIX raw.
    Vt = 3,
}
pub type uv_tty_vtermstate_t = c_uint;
pub type uv_stdio_flags = c_uint;
pub type uv_clock_id = c_uint;
pub type uv_dirent_type_t = c_uint;

// ──────────────────────────────────────────────────────────────────────────
// `uv__queue` / `uv__work` — internal intrusive list / threadpool work item.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv__queue {
    pub next: *mut uv__queue,
    pub prev: *mut uv__queue,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv__work {
    pub work: Option<unsafe extern "C" fn(*mut uv__work)>,
    pub done: Option<unsafe extern "C" fn(*mut uv__work, c_int)>,
    pub loop_: *mut Loop,
    pub wq: uv__queue,
}

// ──────────────────────────────────────────────────────────────────────────
// `uv_buf_t` (uv/win.h) — `{ ULONG len; char* base; }` (Windows order is
// len-then-base, opposite of Unix).
// ──────────────────────────────────────────────────────────────────────────
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
        uv_buf_t {
            len: input.len() as ULONG,
            base: input.as_ptr().cast_mut(),
        }
    }
    #[inline]
    pub fn slice(&self) -> &[u8] {
        // Zig `this.base[0..this.len]` is well-defined for `(null, 0)`; Rust's
        // `from_raw_parts` is not (requires non-null, aligned even for len==0).
        // libuv routinely hands back `{len:0, base:NULL}` (declined alloc_cb,
        // `uv_buf_init(NULL,0)`), so guard the empty/null case explicitly.
        if self.len == 0 || self.base.is_null() {
            return &[];
        }
        // SAFETY: caller-supplied (base, len); valid for the buffer's lifetime.
        unsafe { core::slice::from_raw_parts(self.base, self.len as usize) }
    }
    /// Mutable view of the buffer (Zig `uv_buf_t::slice` returned `[]u8`, which
    /// carries no exclusivity invariant — Rust `&mut [u8]` does).
    ///
    /// SAFETY: caller asserts that `(base, len)` came from a writeable
    /// allocation and that no other `&mut`/`&` to that storage is live for the
    /// returned slice's lifetime. Takes `&mut self` so borrowck rejects the
    /// obvious double-call aliasing footgun at the type level; this does *not*
    /// by itself make the call safe (the pointee may still be aliased
    /// elsewhere).
    #[inline]
    pub unsafe fn slice_mut(&mut self) -> &mut [u8] {
        // See `slice()`: guard `(null, 0)` — `from_raw_parts_mut` requires a
        // non-null pointer even for zero-length slices.
        if self.len == 0 || self.base.is_null() {
            return &mut [];
        }
        unsafe { core::slice::from_raw_parts_mut(self.base, self.len as usize) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `UV_REQ_PRIVATE_FIELDS` (uv/win.h) — every `uv_req_t` embeds this tail.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct req_u_io {
    pub overlapped: OVERLAPPED,
    pub queued_bytes: usize,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct req_u_connect {
    pub result: ULONG_PTR,
    pub pipeHandle: HANDLE,
    pub duplex_flags: DWORD,
    pub name: *mut WCHAR,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub union req_u {
    pub io: req_u_io,
    pub connect: req_u_connect,
}

/// `uv_req_t` — base request type. Every `*_req` struct begins with this
/// header (`UV_REQ_FIELDS`).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_req_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
}
pub type struct_uv_req_s = uv_req_t;

// ──────────────────────────────────────────────────────────────────────────
// `uv_handle_t` header — every `uv_*_t` handle begins with this.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub union handle_u {
    pub fd: c_int,
    pub reserved: [*mut c_void; 4],
}

/// `uv_handle_t` (`UV_HANDLE_FIELDS`). All concrete handle types are
/// layout-prefixed with these exact fields, so a `*mut Pipe` / `*mut Timer`
/// is castable to `*mut Handle`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Handle {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut Handle,
    pub flags: c_uint,
}
pub type uv_handle_t = Handle;
pub type uv_handle_s = Handle;

/// `uv_handle_type` (uv.h). `#[repr(C)]` so it round-trips through
/// `uv_guess_handle` / `uv_handle_get_type`.
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
pub const UV_TTY: HandleType = HandleType::Tty;
pub const UV_NAMED_PIPE: HandleType = HandleType::NamedPipe;
pub const UV_UNKNOWN_HANDLE: HandleType = HandleType::Unknown;

/// Safe `uv_guess_handle` wrapper. The FFI symbol returns `c_int` (see
/// [`uv_guess_handle_raw`]); range-check before producing a [`HandleType`] so an
/// unexpected discriminant (e.g. `UV_HANDLE_TYPE_MAX` or a future libuv
/// variant) degrades to `Unknown` instead of triggering enum-transmute UB.
#[inline]
pub fn uv_guess_handle(file: uv_file) -> uv_handle_type {
    let raw = uv_guess_handle_raw(file);
    if (HandleType::Unknown as c_int..=HandleType::File as c_int).contains(&raw) {
        // SAFETY: `HandleType` is `#[repr(C)]` with contiguous discriminants
        // 0..=17 and `raw` was just range-checked into that interval.
        unsafe { mem::transmute::<c_int, HandleType>(raw) }
    } else {
        HandleType::Unknown
    }
}
pub const UV_HANDLE_TYPE_MAX: c_int = 18;

/// `RunMode` — `uv_run` mode argument.
#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RunMode {
    Default = 0,
    Once = 1,
    NoWait = 2,
}
pub type uv_run_mode = RunMode;

// Callback types.
pub type uv_close_cb = Option<unsafe extern "C" fn(*mut uv_handle_t)>;
pub type uv_alloc_cb = Option<unsafe extern "C" fn(*mut uv_handle_t, usize, *mut uv_buf_t)>;
pub type uv_read_cb =
    Option<unsafe extern "C" fn(*mut uv_stream_t, ReturnCodeI64, *const uv_buf_t)>;
pub type uv_connection_cb = Option<unsafe extern "C" fn(*mut uv_stream_t, ReturnCode)>;
pub type uv_shutdown_cb = Option<unsafe extern "C" fn(*mut uv_shutdown_t, c_int)>;
pub type uv_write_cb = Option<unsafe extern "C" fn(*mut uv_write_t, ReturnCode)>;
pub type uv_connect_cb = Option<unsafe extern "C" fn(*mut uv_connect_t, ReturnCode)>;
pub type uv_timer_cb = Option<unsafe extern "C" fn(*mut Timer)>;
pub type uv_async_cb = Option<unsafe extern "C" fn(*mut uv_async_t)>;
pub type uv_prepare_cb = Option<unsafe extern "C" fn(*mut uv_prepare_t)>;
pub type uv_check_cb = Option<unsafe extern "C" fn(*mut uv_check_t)>;
pub type uv_idle_cb = Option<unsafe extern "C" fn(*mut uv_idle_t)>;
pub type uv_poll_cb = Option<unsafe extern "C" fn(*mut uv_poll_t, c_int, c_int)>;
pub type uv_signal_cb = Option<unsafe extern "C" fn(*mut uv_signal_t, c_int)>;
pub type uv_exit_cb = Option<unsafe extern "C" fn(*mut Process, i64, c_int)>;
pub type uv_walk_cb = Option<unsafe extern "C" fn(*mut uv_handle_t, *mut c_void)>;
pub type uv_fs_cb = Option<unsafe extern "C" fn(*mut fs_t)>;
pub type uv_fs_event_cb =
    Option<unsafe extern "C" fn(*mut uv_fs_event_t, *const c_char, c_int, ReturnCode)>;
pub type uv_fs_poll_cb =
    Option<unsafe extern "C" fn(*mut uv_fs_poll_t, c_int, *const uv_stat_t, *const uv_stat_t)>;
pub type uv_udp_send_cb = Option<unsafe extern "C" fn(*mut uv_udp_send_t, c_int)>;
pub type uv_udp_recv_cb =
    Option<unsafe extern "C" fn(*mut uv_udp_t, isize, *const uv_buf_t, *const sockaddr, c_uint)>;
pub type uv_getaddrinfo_cb =
    Option<unsafe extern "C" fn(*mut uv_getaddrinfo_t, c_int, *mut addrinfo)>;
pub type uv_getnameinfo_cb =
    Option<unsafe extern "C" fn(*mut uv_getnameinfo_t, c_int, *const c_char, *const c_char)>;
pub type uv_work_cb = Option<unsafe extern "C" fn(*mut uv_work_t)>;
pub type uv_after_work_cb = Option<unsafe extern "C" fn(*mut uv_work_t, c_int)>;
pub type uv_random_cb = Option<unsafe extern "C" fn(*mut uv_random_t, c_int, *mut c_void, usize)>;
pub type uv_thread_cb = Option<unsafe extern "C" fn(*mut c_void)>;
pub type uv_malloc_func = Option<unsafe extern "C" fn(usize) -> *mut c_void>;
pub type uv_realloc_func = Option<unsafe extern "C" fn(*mut c_void, usize) -> *mut c_void>;
pub type uv_calloc_func = Option<unsafe extern "C" fn(usize, usize) -> *mut c_void>;
pub type uv_free_func = Option<unsafe extern "C" fn(*mut c_void)>;

// ──────────────────────────────────────────────────────────────────────────
// `Loop` — `uv_loop_t` (uv/win.h). Field-accurate; `active_handles` is read
// directly by `bun_event_loop` so this CANNOT be opaque.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
union active_reqs_u {
    unused: *mut c_void,
    count: c_uint,
}
#[repr(C)]
pub struct Loop {
    pub data: *mut c_void,
    pub active_handles: c_uint,
    pub handle_queue: uv__queue,
    active_reqs: active_reqs_u,
    pub internal_fields: *mut c_void,
    pub stop_flag: c_uint,
    pub iocp: HANDLE,
    pub time: u64,
    pub pending_reqs_tail: *mut uv_req_t,
    pub endgame_handles: *mut uv_handle_t,
    pub timer_heap: *mut c_void,
    pub prepare_handles: *mut uv_prepare_t,
    pub check_handles: *mut uv_check_t,
    pub idle_handles: *mut uv_idle_t,
    pub next_prepare_handle: *mut uv_prepare_t,
    pub next_check_handle: *mut uv_check_t,
    pub next_idle_handle: *mut uv_idle_t,
    pub poll_peer_sockets: [SOCKET; 4],
    pub active_tcp_streams: c_uint,
    pub active_udp_streams: c_uint,
    pub timer_counter: u64,
    pub wq: uv__queue,
    pub wq_mutex: uv_mutex_t,
    pub wq_async: uv_async_t,
}
pub type uv_loop_t = Loop;
pub type uv_loop_s = Loop;

// `Loop::get()` escapes a raw pointer into this TLS slot out of the
// `LocalKey::with` closure and hands it to libuv for the thread lifetime.
// That is sound only because the slot has NO destructor: with no `Drop`, std
// registers no TLS dtor, so the `LocalKey` storage outlives every per-thread
// caller and the escaped address stays valid until thread exit. Guard the
// no-Drop invariant at compile time so adding `impl Drop for Loop` (or
// wrapping the cell) fails loudly here rather than becoming silent UB.
const _: () = assert!(!core::mem::needs_drop::<Loop>());
const _: () = assert!(!core::mem::needs_drop::<UnsafeCell<MaybeUninit<Loop>>>());

thread_local! {
    /// `threadlocal var threadlocal_loop_data: Loop = undefined` — static TLS
    /// storage (zero-alloc; mirrors Zig). `MaybeUninit` because the slot is
    /// only valid after `uv_loop_init`.
    static THREADLOCAL_LOOP_DATA: UnsafeCell<MaybeUninit<Loop>> =
        const { UnsafeCell::new(MaybeUninit::uninit()) };
    /// `threadlocal var threadlocal_loop: ?*Loop = null` — null until `get()`
    /// initializes `THREADLOCAL_LOOP_DATA`.
    static THREADLOCAL_LOOP: Cell<*mut Loop> = const { Cell::new(ptr::null_mut()) };
}

impl Loop {
    /// `bun.windows.libuv.Loop.get()` (libuv.zig:733). Returns this thread's
    /// libuv loop, lazily `uv_loop_init`ing it on first call. Each thread owns
    /// its own loop; sharing `uv_default_loop()` across worker threads is
    /// unsound for the per-worker shutdown path.
    pub fn get() -> *mut Loop {
        THREADLOCAL_LOOP.with(|slot| {
            let existing = slot.get();
            if !existing.is_null() {
                return existing;
            }
            // SAFETY: TLS slot is per-thread; no aliasing. `uv_loop_init`
            // accepts uninitialized storage (it zero-fills internally).
            // Escaping the pointer past `.with()` is intentional: the slot is
            // const-initialized POD with no TLS destructor (static-asserted
            // above), so its address is stable for the thread lifetime.
            let ptr_ = THREADLOCAL_LOOP_DATA.with(|data| unsafe { (*data.get()).as_mut_ptr() });
            // SAFETY: `ptr_` is `sizeof(Loop)` TLS storage owned by this thread.
            if let Some(err) = unsafe { uv_loop_init(ptr_) }.raw_errno() {
                panic!("Failed to initialize libuv loop: errno {err}");
            }
            slot.set(ptr_);
            ptr_
        })
    }

    /// `bun.windows.libuv.Loop.shutdown()` (libuv.zig:714). Closes this
    /// thread's libuv loop. Called from `WebWorker::shutdown`.
    pub fn shutdown() {
        THREADLOCAL_LOOP.with(|slot| {
            let loop_ = slot.get();
            if loop_.is_null() {
                return;
            }
            // SAFETY: `loop_` is the live per-thread loop initialized in `get()`.
            if let Some(err) = unsafe { uv_loop_close(loop_) }.raw_errno() {
                // Zig: `if (err == .BUSY)` — only EBUSY means handles are
                // still open; walk + close them, run once to flush close
                // callbacks, then close again (must succeed). `uv_loop_close`
                // documents no other failure code.
                if err == (UV_EBUSY as c_int).unsigned_abs() as u16 {
                    unsafe { uv_walk(loop_, Some(close_walk_cb), ptr::null_mut()) };
                    let _ = unsafe { uv_run(loop_, RunMode::Default) };
                    // NOTE the call is unconditional (Zig `bun.debugAssert`
                    // evaluates its argument in release too).
                    let rc = unsafe { uv_loop_close(loop_) };
                    debug_assert_eq!(rc, ReturnCode::ZERO);
                }
            }
            slot.set(ptr::null_mut());
        });
    }

    /// `Loop.subActive` — saturating decrement to mirror PosixLoop semantics
    /// (avoid underflow during teardown when Bun's virtual keep-alive refs and
    /// libuv's own accounting momentarily disagree).
    #[inline]
    pub fn sub_active(&mut self, value: u32) {
        log!("subActive({}) - {}", value, self.active_handles);
        self.active_handles = self.active_handles.saturating_sub(value);
    }
    #[inline]
    pub fn add_active(&mut self, value: u32) {
        log!("addActive({})", value);
        self.active_handles = self.active_handles.saturating_add(value);
    }
    #[inline]
    pub fn inc(&mut self) {
        log!("inc - {}", self.active_handles.saturating_add(1));
        self.active_handles = self.active_handles.saturating_add(1);
    }
    #[inline]
    pub fn dec(&mut self) {
        log!("dec");
        self.active_handles = self.active_handles.saturating_sub(1);
    }
    /// Aliases matching Zig's `pub const ref = inc`.
    #[inline]
    pub fn ref_(&mut self) {
        self.inc();
    }
    #[inline]
    pub fn unref(&mut self) {
        self.dec();
    }
    #[inline]
    pub fn unref_count(&mut self, count: i32) {
        log!("unrefCount({})", count);
        // Zig: `-|= @as(u32, @intCast(count))` — `@intCast` is safety-checked
        // (panics on negative). A bare `count as u32` would silently wrap a
        // negative to ~4 billion and zero out `active_handles`. Mirror the
        // checked cast: assert in debug, clamp in release so we never wrap.
        debug_assert!(count >= 0, "unref_count: count must be non-negative");
        self.active_handles = self.active_handles.saturating_sub(count.max(0) as u32);
    }
    #[inline]
    pub fn stop(&mut self) {
        log!("stop");
        // SAFETY: self is a live loop.
        unsafe { uv_stop(self) };
    }
    #[inline]
    pub fn is_active(&self) -> bool {
        // SAFETY: self is a live loop.
        unsafe { uv_loop_alive(self) != 0 }
    }
    #[inline]
    pub fn tick(&mut self) {
        // SAFETY: self is a live loop.
        let _ = unsafe { uv_run(self, RunMode::Default) };
    }
    #[inline]
    pub fn run(&mut self) {
        // SAFETY: self is a live loop.
        let _ = unsafe { uv_run(self, RunMode::Default) };
    }
    #[inline]
    pub fn tick_with_timeout(&mut self, _: i64) {
        // SAFETY: self is a live loop.
        let _ = unsafe { uv_run(self, RunMode::NoWait) };
    }
    #[inline]
    pub fn wakeup(&mut self) {
        self.wq_async.send();
    }
    #[inline]
    pub fn dump_active_handles(&mut self, stream: *mut c_void) {
        // SAFETY: self is a live loop.
        unsafe { uv_print_active_handles(self, stream) };
    }
}

unsafe extern "C" fn close_walk_cb(handle: *mut uv_handle_t, _data: *mut c_void) {
    // SAFETY: libuv passes a live handle.
    if unsafe { uv_is_closing(handle) } == 0 {
        unsafe { uv_close(handle, None) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `HandleMixin` (libuv.zig:437) — Rust ports this as a generic trait every
// handle type opts into. All methods are `#[inline]` zero-cost casts.
// ──────────────────────────────────────────────────────────────────────────
/// Marker for `#[repr(C)]` structs whose first fields are exactly
/// `UV_HANDLE_FIELDS` (i.e. layout-prefixed with [`Handle`]).
///
/// SAFETY: `Self` must be `#[repr(C)]` and start with the same fields as
/// [`Handle`], so `*mut Self` is castable to `*mut uv_handle_t`.
pub unsafe trait UvHandle: Sized {
    #[inline]
    fn as_handle(&self) -> *const uv_handle_t {
        (self as *const Self).cast()
    }
    #[inline]
    fn as_handle_mut(&mut self) -> *mut uv_handle_t {
        (self as *mut Self).cast()
    }
    #[inline]
    fn data(&self) -> *mut c_void {
        // SAFETY: handle prefix; `data` is at offset 0.
        unsafe { (*self.as_handle()).data }
    }
    #[inline]
    fn get_data<T>(&self) -> *mut T {
        // SAFETY: handle prefix invariant.
        unsafe { uv_handle_get_data(self.as_handle()).cast() }
    }
    #[inline]
    fn set_data(&mut self, ptr_: *mut c_void) {
        // SAFETY: handle prefix invariant.
        unsafe { uv_handle_set_data(self.as_handle_mut(), ptr_) };
    }
    /// Typed `Box<T>`-taking sibling of [`set_data`] for the common case where
    /// `handle->data` owns a heap allocation freed in the close callback.
    /// Ownership of `data` transfers to the handle; reclaim with
    /// [`take_owned_data`](UvHandle::take_owned_data) (typically in the
    /// `uv_close_cb`). This is the centralized `Box::into_raw` for the
    /// `handle.data = bun.new(T, ..)` Zig pattern — callers never spell the
    /// raw round-trip themselves.
    #[inline]
    fn set_owned_data<T>(&mut self, data: Box<T>) {
        self.set_data(Box::into_raw(data).cast::<c_void>());
    }
    /// Reclaim a `Box<T>` previously installed via [`set_owned_data`]. Clears
    /// the `data` slot to null so a second call (or a later `uv_close_cb`)
    /// observes `None` rather than a dangling pointer.
    ///
    /// # Safety
    /// The handle's `data` must either be null or the unique live pointer
    /// from a prior [`set_owned_data::<T>`](UvHandle::set_owned_data) call
    /// with the **same** `T`.
    #[inline]
    unsafe fn take_owned_data<T>(&mut self) -> Option<Box<T>> {
        let p = self.get_data::<T>();
        if p.is_null() {
            return None;
        }
        self.set_data(ptr::null_mut());
        // SAFETY: caller contract — `p` came from `set_owned_data::<T>`.
        Some(unsafe { Box::from_raw(p) })
    }
    #[inline]
    fn get_loop(&self) -> *mut Loop {
        // SAFETY: handle prefix invariant.
        unsafe { uv_handle_get_loop(self.as_handle()) }
    }
    /// `HandleMixin::close` — `cb` receives the same pointer cast back to
    /// `*mut Self`. ABI-identical to `uv_close_cb` modulo the pointee type.
    #[inline]
    fn close(&mut self, cb: unsafe extern "C" fn(*mut Self)) {
        // SAFETY: `Self` embeds `uv_handle_t` at offset 0; cb is ABI-identical.
        unsafe {
            uv_close(
                self.as_handle_mut(),
                Some(mem::transmute::<
                    unsafe extern "C" fn(*mut Self),
                    unsafe extern "C" fn(*mut uv_handle_t),
                >(cb)),
            );
        }
    }
    #[inline]
    fn has_ref(&self) -> bool {
        // SAFETY: handle prefix invariant.
        unsafe { uv_has_ref(self.as_handle()) != 0 }
    }
    #[inline]
    fn ref_(&mut self) {
        // SAFETY: handle prefix invariant.
        unsafe { uv_ref(self.as_handle_mut()) };
    }
    #[inline]
    fn unref(&mut self) {
        // SAFETY: handle prefix invariant.
        unsafe { uv_unref(self.as_handle_mut()) };
    }
    #[inline]
    fn is_closing(&self) -> bool {
        // SAFETY: handle prefix invariant.
        unsafe { uv_is_closing(self.as_handle()) != 0 }
    }
    #[inline]
    fn is_closed(&self) -> bool {
        // SAFETY: handle prefix invariant.
        uv_is_closed(unsafe { &*self.as_handle() })
    }
    #[inline]
    fn is_active(&self) -> bool {
        // SAFETY: handle prefix invariant.
        unsafe { uv_is_active(self.as_handle()) != 0 }
    }
    /// `HandleMixin::fd` — returns the OS handle, or `INVALID_HANDLE_VALUE` if
    /// none. (Higher-tier crates wrap this in `bun_sys::Fd`.)
    #[inline]
    fn fd(&self) -> uv_os_fd_t {
        let mut fd_: uv_os_fd_t = INVALID_HANDLE_VALUE;
        // SAFETY: handle prefix invariant; out-param is valid.
        let _ = unsafe { uv_fileno(self.as_handle(), &mut fd_) };
        fd_
    }
}
// SAFETY: all of these are `#[repr(C)]` with `UV_HANDLE_FIELDS` first.
unsafe impl UvHandle for Handle {}
unsafe impl UvHandle for uv_stream_t {}
unsafe impl UvHandle for Pipe {}
unsafe impl UvHandle for uv_tcp_t {}
unsafe impl UvHandle for uv_tty_t {}
unsafe impl UvHandle for uv_udp_t {}
unsafe impl UvHandle for Timer {}
unsafe impl UvHandle for uv_async_t {}
unsafe impl UvHandle for uv_prepare_t {}
unsafe impl UvHandle for uv_check_t {}
unsafe impl UvHandle for uv_idle_t {}
unsafe impl UvHandle for uv_poll_t {}
unsafe impl UvHandle for uv_signal_t {}
unsafe impl UvHandle for Process {}
unsafe impl UvHandle for uv_fs_event_t {}
unsafe impl UvHandle for uv_fs_poll_t {}

/// Marker for `#[repr(C)]` structs prefixed with `UV_STREAM_FIELDS`
/// (`uv_stream_t`, `Pipe`, `uv_tcp_t`, `uv_tty_t`).
pub unsafe trait UvStream: UvHandle {
    #[inline]
    fn as_stream(&mut self) -> *mut uv_stream_t {
        (self as *mut Self).cast()
    }
    #[inline]
    fn get_write_queue_size(&self) -> usize {
        // SAFETY: stream prefix invariant.
        unsafe { uv_stream_get_write_queue_size((self as *const Self).cast()) }
    }
    #[inline]
    fn read_start(&mut self, alloc_cb: uv_alloc_cb, read_cb: uv_read_cb) -> ReturnCode {
        // SAFETY: stream prefix invariant.
        unsafe { uv_read_start(self.as_stream(), alloc_cb, read_cb) }
    }
    #[inline]
    fn read_stop(&mut self) {
        // SAFETY: always succeeds (uv docs).
        let _ = unsafe { uv_read_stop(self.as_stream()) };
    }
    #[inline]
    fn try_write(&mut self, bufs: &[uv_buf_t]) -> ReturnCode {
        // SAFETY: stream prefix invariant.
        unsafe { uv_try_write(self.as_stream(), bufs.as_ptr(), bufs.len() as c_uint) }
    }
    #[inline]
    fn is_readable(&self) -> bool {
        // SAFETY: stream prefix invariant.
        unsafe { uv_is_readable((self as *const Self).cast()) != 0 }
    }
    #[inline]
    fn is_writable(&self) -> bool {
        // SAFETY: stream prefix invariant.
        unsafe { uv_is_writable((self as *const Self).cast()) != 0 }
    }
    /// Port of `StreamMixin::readStart` (libuv.zig:3067) — high-level wrapper
    /// over `uv_read_start` that thunks Rust callbacks through a monomorphised
    /// `extern "C"` trampoline. `context` is stashed in `handle.data` and
    /// recovered in the trampoline; the three callbacks are baked into the
    /// monomorphisation via the [`StreamReader`] trait (Zig captures them as
    /// `comptime` fn pointers — Rust expresses that as associated fns so the
    /// trampoline stays zero-alloc and `Handle` needs no spare storage).
    ///
    /// Unlike Zig (`error_cb` takes `bun.sys.E`), the Rust binding passes the
    /// raw negative libuv errno (`c_int`); this crate is layered below
    /// `bun_sys` so it can't name `E`. Callers map via
    /// `bun_sys::windows::translate_uv_error_to_e`. Returns the raw
    /// [`ReturnCode`] from `uv_read_start`; callers apply
    /// `.to_error(Tag::listen)` themselves.
    #[inline]
    fn read_start_ctx<T: StreamReader>(&mut self, context: *mut T) -> ReturnCode {
        // SAFETY: stream prefix invariant — `&mut Self` reinterprets as
        // `&mut Handle` for the leading `UV_HANDLE_FIELDS`.
        let h: &mut Handle = unsafe { &mut *(self as *mut Self).cast::<Handle>() };
        h.data = context.cast();

        unsafe extern "C" fn uv_allocb<T: StreamReader>(
            req: *mut uv_handle_t,
            suggested_size: usize,
            buffer: *mut uv_buf_t,
        ) {
            // SAFETY: `req.data` was set to `context` above; libuv calls this
            // on the loop thread before `uv_readcb`.
            let ctx: &mut T = unsafe { bun_core::callback_ctx::<T>((*req).data) };
            let buf = T::on_read_alloc(ctx, suggested_size);
            // SAFETY: `buffer` is libuv's out-param.
            unsafe { *buffer = uv_buf_t::init(buf) };
        }
        unsafe extern "C" fn uv_readcb<T: StreamReader>(
            req: *mut uv_stream_t,
            nreads: ReturnCodeI64,
            buffer: *const uv_buf_t,
        ) {
            // Keep `ctx` raw — `(*buffer).base` was derived from the `&mut T`
            // borrow taken in `uv_allocb`, so materialising a fresh `&mut T`
            // here would pop that pointer's Stacked-Borrows tag before we
            // read through it. Recover the raw `*mut T`, build the slice
            // first, and hand the raw pointer to `on_read` so the impl owns
            // the reborrow ordering.
            // SAFETY: `req.data` was set to `context` above.
            let ctx: *mut T = unsafe { (*req).data.cast::<T>() };
            let n = nreads.int();
            if n == 0 {
                return; // EAGAIN / EWOULDBLOCK
            }
            if n < 0 {
                // SAFETY: stream prefix invariant.
                let _ = unsafe { uv_read_stop(req) };
                // SAFETY: `ctx` is the live context stashed in `handle.data`.
                T::on_read_error(unsafe { &mut *ctx }, n as c_int);
            } else {
                // SAFETY: `buffer` was filled by `uv_allocb` above with a
                // slice of length `>= n`.
                let slice =
                    unsafe { core::slice::from_raw_parts((*buffer).base.cast::<u8>(), n as usize) };
                // SAFETY: `ctx` is the live context stashed in `handle.data`.
                unsafe { T::on_read(ctx, slice) };
            }
        }
        // SAFETY: stream prefix invariant.
        unsafe { uv_read_start(self.as_stream(), Some(uv_allocb::<T>), Some(uv_readcb::<T>)) }
    }
}

/// Callback bundle for [`UvStream::read_start_ctx`]. Port of the three
/// `comptime` fn-pointer parameters on Zig's `StreamMixin::readStart`
/// (libuv.zig:3070-3072): Rust monomorphises the `extern "C"` trampolines over
/// this trait so the callbacks are baked into the codegen (zero-alloc, no
/// per-handle storage) exactly as in Zig.
pub trait StreamReader: Sized {
    fn on_read_alloc(this: &mut Self, suggested_size: usize) -> &mut [u8];
    /// `err` is the raw negative libuv errno (e.g. `UV_EOF`). Map via
    /// `bun_sys::windows::translate_uv_error_to_e` if `bun_sys::E` is needed.
    fn on_read_error(this: &mut Self, err: c_int);
    /// `this` is raw because `data` typically points *into* `*this` (it was
    /// returned from [`on_read_alloc`]). Forming `&mut Self` in the trampoline
    /// would alias with `data` under Stacked Borrows; the implementor decides
    /// how to split the borrow.
    ///
    /// # Safety
    /// `this` is the live context passed to [`UvStream::read_start_ctx`].
    unsafe fn on_read(this: *mut Self, data: &[u8]);
}
// SAFETY: all of these are `#[repr(C)]` with `UV_STREAM_FIELDS` prefix.
unsafe impl UvStream for uv_stream_t {}
unsafe impl UvStream for Pipe {}
unsafe impl UvStream for uv_tcp_t {}
unsafe impl UvStream for uv_tty_t {}

/// Marker for `#[repr(C)]` structs prefixed with `UV_REQ_FIELDS`.
pub unsafe trait UvReq: Sized {
    #[inline]
    fn as_req(&mut self) -> *mut uv_req_t {
        (self as *mut Self).cast()
    }
    #[inline]
    fn get_data<T>(&self) -> *mut T {
        // SAFETY: req prefix invariant.
        unsafe { uv_req_get_data((self as *const Self).cast()).cast() }
    }
    #[inline]
    fn set_data(&mut self, ptr_: *mut c_void) {
        // SAFETY: req prefix invariant.
        unsafe { uv_req_set_data(self.as_req(), ptr_) };
    }
    #[inline]
    fn cancel(&mut self) {
        // SAFETY: req prefix invariant.
        let _ = unsafe { uv_cancel(self.as_req()) };
    }
}
unsafe impl UvReq for uv_req_t {}
unsafe impl UvReq for uv_write_t {}
unsafe impl UvReq for uv_connect_t {}
unsafe impl UvReq for uv_shutdown_t {}
unsafe impl UvReq for uv_getaddrinfo_t {}
unsafe impl UvReq for uv_getnameinfo_t {}
unsafe impl UvReq for uv_work_t {}
unsafe impl UvReq for uv_random_t {}
unsafe impl UvReq for fs_t {}
unsafe impl UvReq for uv_udp_send_t {}

// ──────────────────────────────────────────────────────────────────────────
// Stream / Read / Shutdown / Write / Connect requests.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
union stream_conn_serv {
    conn: stream_conn,
    serv: stream_serv,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct stream_conn {
    write_reqs_pending: c_uint,
    shutdown_req: *mut uv_shutdown_t,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct stream_serv {
    connection_cb: uv_connection_cb,
}

/// `uv_read_t` (uv/win.h) — `UV_REQ_FIELDS` + `event_handle` + `wait_handle`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_read_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
    pub event_handle: HANDLE,
    pub wait_handle: HANDLE,
}

/// `uv_shutdown_t`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_shutdown_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
    pub handle: *mut uv_stream_t,
    pub cb: uv_shutdown_cb,
}

/// `uv_stream_t` (`UV_HANDLE_FIELDS` + `UV_STREAM_FIELDS`).
#[repr(C)]
pub struct uv_stream_t {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub write_queue_size: usize,
    pub alloc_cb: uv_alloc_cb,
    pub read_cb: uv_read_cb,
    pub reqs_pending: c_uint,
    pub activecnt: c_int,
    pub read_req: uv_read_t,
    stream: stream_conn_serv,
}
pub type struct_uv_stream_s = uv_stream_t;

/// `uv_write_t`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_write_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
    pub cb: uv_write_cb,
    pub send_handle: *mut uv_stream_t,
    pub handle: *mut uv_stream_t,
    pub coalesced: c_int,
    pub write_buffer: uv_buf_t,
    pub event_handle: HANDLE,
    pub wait_handle: HANDLE,
}
impl uv_write_t {
    /// Thin wrapper over `uv_write` for a single buffer.
    #[inline]
    pub fn write_raw(
        &mut self,
        stream: *mut uv_stream_t,
        input: &uv_buf_t,
        cb: uv_write_cb,
    ) -> ReturnCode {
        // SAFETY: caller initialized `self`; `stream` is a live stream handle.
        unsafe { uv_write(self, stream, input, 1, cb) }
    }
    /// Context-aware `uv_write` (Zig libuv.zig:1327 `uv_write_t::write` with
    /// `context: anytype, comptime onWrite`). Stores `context` in `req.data`;
    /// the trampoline recovers it and dispatches to `on_write` as a plain Rust
    /// `&mut`. Generic monomorphisation gives one `extern "C"` thunk per `<T>`.
    ///
    /// PORT NOTE: Zig captures `onWrite` at *comptime* (one thunk per
    /// callsite, direct call) and returns `Maybe(void)` with the
    /// `.toError(.write)` already applied. The Rust port can do neither
    /// without a `bun_sys` dependency / unstable const-generic fn pointers, so
    /// it (a) keeps `on_write` runtime-dispatched but stashes it as a `usize`
    /// (fn-ptr ↔ integer is well-defined; fn-ptr ↔ data-ptr is not — Miri
    /// rejects the latter), and (b) returns the raw [`ReturnCode`]; callers
    /// apply `.to_error(Tag::write)` themselves. The `bun.sys.syslog` line is
    /// emitted via this crate's `[uv]` log scope. The null-callback path is
    /// [`write_raw`].
    #[inline]
    pub fn write<T>(
        &mut self,
        stream: *mut uv_stream_t,
        input: &uv_buf_t,
        context: *mut T,
        on_write: fn(*mut T, ReturnCode),
    ) -> ReturnCode {
        // Stash the Rust fn-pointer in `reserved[0]` (libuv never touches the
        // 6-slot `reserved` array on `uv_req_t`) as a `usize`, recovered in the
        // thunk below.
        self.data = context.cast();
        self.reserved[0] = on_write as usize as *mut c_void;
        unsafe extern "C" fn thunk<T>(req: *mut uv_write_t, status: ReturnCode) {
            // SAFETY: `data`/`reserved[0]` were set immediately before
            // `uv_write` below; libuv invokes this exactly once with the same
            // `req` pointer. The `usize` → `fn` cast round-trips the address
            // written by `on_write as usize` above (Win64: same width).
            // Pass the raw `*mut T` straight through (matches Zig's
            // `uvWriteCb`: `callback(@ptrCast(@alignCast(handler.data)), status)`)
            // — callers commonly free the `T` allocation inside the callback,
            // so materialising `&mut T` here would leave that reference
            // dangling across the dealloc (UB).
            unsafe {
                let cb: fn(*mut T, ReturnCode) =
                    mem::transmute::<usize, fn(*mut T, ReturnCode)>((*req).reserved[0] as usize);
                cb((*req).data.cast::<T>(), status);
            }
        }
        // SAFETY: caller guarantees `self` lives until the cb fires and
        // `stream` is a live stream handle.
        let rc = unsafe { uv_write(self, stream, input, 1, Some(thunk::<T>)) };
        crate::__uv_log!("uv_write({}) = {}", input.len, rc.int());
        rc
    }
}

/// `uv_connect_t`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_connect_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
    pub cb: uv_connect_cb,
    pub handle: *mut uv_stream_t,
}

// ──────────────────────────────────────────────────────────────────────────
// `uv_tcp_t`.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_tcp_accept_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
    pub accept_socket: SOCKET,
    pub accept_buffer: [u8; 288],
    pub event_handle: HANDLE,
    pub wait_handle: HANDLE,
    pub next_pending: *mut uv_tcp_accept_t,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct tcp_serv {
    accept_reqs: *mut uv_tcp_accept_t,
    processed_accepts: c_uint,
    pending_accepts: *mut uv_tcp_accept_t,
    func_acceptex: LPFN_ACCEPTEX,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct tcp_conn {
    read_buffer: uv_buf_t,
    func_connectex: LPFN_CONNECTEX,
}
#[repr(C)]
#[derive(Clone, Copy)]
union tcp_u {
    serv: tcp_serv,
    conn: tcp_conn,
}
#[repr(C)]
pub struct uv_tcp_t {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub write_queue_size: usize,
    pub alloc_cb: uv_alloc_cb,
    pub read_cb: uv_read_cb,
    pub reqs_pending: c_uint,
    pub activecnt: c_int,
    pub read_req: uv_read_t,
    stream: stream_conn_serv,
    pub socket: SOCKET,
    pub delayed_error: c_int,
    tcp: tcp_u,
}
pub type Tcp = uv_tcp_t;

// ──────────────────────────────────────────────────────────────────────────
// `uv_udp_t`.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
pub struct uv_udp_t {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub send_queue_size: usize,
    pub send_queue_count: usize,
    pub socket: SOCKET,
    pub reqs_pending: c_uint,
    pub activecnt: c_int,
    pub recv_req: uv_req_t,
    pub recv_buffer: uv_buf_t,
    pub recv_from: sockaddr_storage,
    pub recv_from_len: c_int,
    pub recv_cb: uv_udp_recv_cb,
    pub alloc_cb: uv_alloc_cb,
    pub func_wsarecv: LPFN_WSARECV,
    pub func_wsarecvfrom: LPFN_WSARECVFROM,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_udp_send_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
    pub handle: *mut uv_udp_t,
    pub cb: uv_udp_send_cb,
}

// ──────────────────────────────────────────────────────────────────────────
// `Pipe` (`uv_pipe_t`).
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_pipe_accept_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
    pub pipeHandle: HANDLE,
    pub next_pending: *mut uv_pipe_accept_t,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct pipe_serv {
    pending_instances: c_int,
    accept_reqs: *mut uv_pipe_accept_t,
    pending_accepts: *mut uv_pipe_accept_t,
}
#[repr(C)]
#[derive(Clone, Copy)]
union ipc_data_frame {
    payload_remaining: u32,
    dummy: u64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct pipe_conn {
    eof_timer: *mut Timer,
    dummy: uv_write_t,
    ipc_remote_pid: DWORD,
    ipc_data_frame: ipc_data_frame,
    ipc_xfer_queue: uv__queue,
    ipc_xfer_queue_length: c_int,
    non_overlapped_writes_tail: *mut uv_write_t,
    readfile_thread_lock: CRITICAL_SECTION,
    readfile_thread_handle: HANDLE,
}
#[repr(C)]
#[derive(Clone, Copy)]
union pipe_u {
    serv: pipe_serv,
    conn: pipe_conn,
}
#[repr(C)]
pub struct Pipe {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub write_queue_size: usize,
    pub alloc_cb: uv_alloc_cb,
    pub read_cb: uv_read_cb,
    pub reqs_pending: c_uint,
    pub activecnt: c_int,
    pub read_req: uv_read_t,
    stream: stream_conn_serv,
    pub ipc: c_int,
    pub handle: HANDLE,
    pub name: *mut WCHAR,
    pipe: pipe_u,
}
pub type uv_pipe_t = Pipe;

impl Pipe {
    /// `uv_pipe_init` (libuv.zig:1419). Returns the raw `ReturnCode`; callers
    /// in higher tiers map to `bun_sys::Result` themselves so this crate stays
    /// free of `bun_sys`.
    #[inline]
    pub fn init(&mut self, loop_: *mut Loop, ipc: bool) -> ReturnCode {
        // SAFETY: `self` is a valid `uv_pipe_t`-sized allocation.
        unsafe { uv_pipe_init(loop_, self, if ipc { 1 } else { 0 }) }
    }
    #[inline]
    pub fn open(&mut self, file: uv_file) -> ReturnCode {
        // SAFETY: pipe was `init`ed.
        unsafe { uv_pipe_open(self, file) }
    }
    #[inline]
    pub fn bind(&mut self, named_pipe: &[u8], flags: c_uint) -> ReturnCode {
        // SAFETY: pipe was `init`ed; libuv copies the name.
        unsafe { uv_pipe_bind2(self, named_pipe.as_ptr(), named_pipe.len(), flags) }
    }
    /// `StreamMixin::listen` (libuv.zig:3047). Caller supplies a plain
    /// `uv_connection_cb` and recovers its context from `handle.data` itself.
    #[inline]
    pub fn listen(
        &mut self,
        backlog: i32,
        context: *mut c_void,
        on_connect: unsafe extern "C" fn(*mut uv_stream_t, ReturnCode),
    ) -> ReturnCode {
        self.data = context;
        // SAFETY: `Pipe` is layout-prefixed with `uv_stream_t`.
        unsafe { uv_listen(self.as_stream(), backlog, Some(on_connect)) }
    }
    /// `Pipe::listenNamedPipe` — bind + listen.
    #[inline]
    pub fn listen_named_pipe(
        &mut self,
        named_pipe: &[u8],
        backlog: i32,
        context: *mut c_void,
        on_connect: unsafe extern "C" fn(*mut uv_stream_t, ReturnCode),
    ) -> ReturnCode {
        let rc = self.bind(named_pipe, UV_PIPE_NO_TRUNCATE);
        if rc.is_err() {
            return rc;
        }
        self.listen(backlog, context, on_connect)
    }
    #[inline]
    pub fn connect(
        &mut self,
        req: &mut uv_connect_t,
        name: &[u8],
        context: *mut c_void,
        on_connect: unsafe extern "C" fn(*mut uv_connect_t, ReturnCode),
    ) -> ReturnCode {
        self.data = context;
        // SAFETY: pipe was `init`ed; libuv copies the name.
        unsafe {
            uv_pipe_connect2(
                req,
                self,
                name.as_ptr(),
                name.len(),
                UV_PIPE_NO_TRUNCATE,
                Some(on_connect),
            )
        }
    }
    #[inline]
    pub fn accept(&mut self, client: &mut Pipe) -> ReturnCode {
        // SAFETY: both pipes embed `uv_stream_t` at offset 0.
        unsafe { uv_accept(self.as_stream(), client.as_stream()) }
    }
    #[inline]
    pub fn set_pending_instances_count(&mut self, count: i32) {
        // SAFETY: pipe was `init`ed.
        unsafe { uv_pipe_pending_instances(self, count) };
    }
    #[inline]
    pub fn as_stream_ptr(&mut self) -> *mut uv_stream_t {
        self.as_stream()
    }
    /// `Pipe::closeAndDestroy` (libuv.zig:1471) — close the pipe handle (if
    /// needed) and then `Box::from_raw`-drop it. Handles all states:
    /// never-initialized (`loop_ == null`), already closing, or active. After
    /// `uv_pipe_init` the handle is in the event loop's `handle_queue`;
    /// freeing without `uv_close` corrupts that list.
    ///
    /// SAFETY: `this` must be a `Box<Pipe>`-allocated pointer (the close
    /// callback reclaims it via `Box::from_raw`). Caller relinquishes
    /// ownership. Receiver is `*mut Pipe` (not `&mut self`) because the
    /// never-initialized branch deallocates the pointee — holding a live
    /// `&mut self` across that drop would dangle. In the already-closing
    /// branch the allocation is *not* reclaimed here: the previously
    /// registered `uv_close` callback is assumed to free the box (matches
    /// Zig); if a non-freeing callback was registered, the pipe leaks.
    pub unsafe fn close_and_destroy(this: *mut Pipe) {
        unsafe extern "C" fn on_close_destroy(handle: *mut Pipe) {
            // SAFETY: handle was Box-allocated; callback fires exactly once.
            drop(unsafe { Box::from_raw(handle) });
        }
        // SAFETY: caller contract — `this` is a live Box-allocated Pipe.
        if unsafe { (*this).loop_.is_null() } {
            // Never initialized — safe to free directly.
            // SAFETY: caller contract — Box-allocated; no `&mut` borrow held.
            drop(unsafe { Box::from_raw(this) });
        } else if !unsafe { (*this).is_closing() } {
            // Initialized and not yet closing — must uv_close first.
            // SAFETY: `this` is live until the close cb fires.
            unsafe { (*this).close(on_close_destroy) };
        }
        // else: already closing — the pending close callback owns the lifetime.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `uv_tty_t`.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
struct tty_rd {
    unused_: HANDLE,
    read_line_buffer: uv_buf_t,
    read_raw_wait: HANDLE,
    last_key: [u8; 8],
    last_key_offset: u8,
    last_key_len: u8,
    last_utf16_high_surrogate: WCHAR,
    last_input_record: INPUT_RECORD,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct tty_wr {
    utf8_codepoint: c_uint,
    utf8_bytes_left: u8,
    previous_eol: u8,
    ansi_parser_state: c_ushort,
    ansi_csi_argc: u8,
    ansi_csi_argv: [c_ushort; 4],
    saved_position: COORD,
    saved_attributes: WORD,
}
#[repr(C)]
#[derive(Clone, Copy)]
union tty_u {
    rd: tty_rd,
    wr: tty_wr,
}
#[repr(C)]
pub struct uv_tty_t {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub write_queue_size: usize,
    pub alloc_cb: uv_alloc_cb,
    pub read_cb: uv_read_cb,
    pub reqs_pending: c_uint,
    pub activecnt: c_int,
    pub read_req: uv_read_t,
    stream: stream_conn_serv,
    pub handle: HANDLE,
    tty: tty_u,
}
pub type Tty = uv_tty_t;
impl uv_tty_t {
    #[inline]
    pub fn init(&mut self, loop_: *mut Loop, file: uv_file) -> ReturnCode {
        // SAFETY: self is a valid `uv_tty_t`-sized allocation.
        unsafe { uv_tty_init(loop_, self, file, 0) }
    }
    #[inline]
    pub fn set_mode(&mut self, mode: TtyMode) -> ReturnCode {
        // SAFETY: tty was `init`ed.
        unsafe { uv_tty_set_mode(self, mode as uv_tty_mode_t) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `uv_poll_t`.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct AFD_POLL_HANDLE_INFO {
    pub Handle: HANDLE,
    pub Events: ULONG,
    pub Status: NTSTATUS,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct AFD_POLL_INFO {
    pub Timeout: LARGE_INTEGER,
    pub NumberOfHandles: ULONG,
    pub Exclusive: ULONG,
    pub Handles: [AFD_POLL_HANDLE_INFO; 1],
}
#[repr(C)]
pub struct uv_poll_t {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub poll_cb: uv_poll_cb,
    pub socket: SOCKET,
    pub peer_socket: SOCKET,
    pub afd_poll_info_1: AFD_POLL_INFO,
    pub afd_poll_info_2: AFD_POLL_INFO,
    pub poll_req_1: uv_req_t,
    pub poll_req_2: uv_req_t,
    pub submitted_events_1: u8,
    pub submitted_events_2: u8,
    pub mask_events_1: u8,
    pub mask_events_2: u8,
    pub events: u8,
}
pub type Poll = uv_poll_t;

// ──────────────────────────────────────────────────────────────────────────
// `Timer` (`uv_timer_t`).
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
pub struct Timer {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub heap_node: [*mut c_void; 3],
    pub unused: c_int,
    pub timeout: u64,
    pub repeat: u64,
    pub start_id: u64,
    pub timer_cb: uv_timer_cb,
}
pub type uv_timer_t = Timer;
impl Timer {
    #[inline]
    pub fn init(&mut self, loop_: *mut Loop) {
        // SAFETY: `self` is a valid `uv_timer_t`-sized allocation.
        if unsafe { uv_timer_init(loop_, self) } != 0 {
            panic!("internal error: uv_timer_init failed");
        }
    }
    #[inline]
    pub fn start(&mut self, timeout: u64, repeat: u64, callback: uv_timer_cb) {
        // SAFETY: timer was `init`ed.
        if unsafe { uv_timer_start(self, callback, timeout, repeat) } != 0 {
            panic!("internal error: uv_timer_start failed");
        }
    }
    #[inline]
    pub fn stop(&mut self) {
        // SAFETY: timer was `init`ed.
        if unsafe { uv_timer_stop(self) } != 0 {
            panic!("internal error: uv_timer_stop failed");
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `uv_prepare_t` / `uv_check_t` / `uv_idle_t` / `uv_async_t`.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
pub struct uv_prepare_t {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub prepare_prev: *mut uv_prepare_t,
    pub prepare_next: *mut uv_prepare_t,
    pub prepare_cb: uv_prepare_cb,
}
#[repr(C)]
pub struct uv_check_t {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub check_prev: *mut uv_check_t,
    pub check_next: *mut uv_check_t,
    pub check_cb: uv_check_cb,
}
#[repr(C)]
pub struct uv_idle_t {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub idle_prev: *mut uv_idle_t,
    pub idle_next: *mut uv_idle_t,
    pub idle_cb: uv_idle_cb,
}
impl uv_idle_t {
    #[inline]
    pub fn init(&mut self, loop_: *mut Loop) {
        // SAFETY: `self` is `#[repr(C)]` POD; all-zero is valid.
        unsafe { ptr::write_bytes(self, 0, 1) };
        // SAFETY: self is a valid `uv_idle_t`-sized allocation.
        if unsafe { uv_idle_init(loop_, self) } != 0 {
            panic!("internal error: uv_idle_init failed");
        }
    }
    #[inline]
    pub fn start(&mut self, cb: uv_idle_cb) {
        // SAFETY: idle was `init`ed.
        let _ = unsafe { uv_idle_start(self, cb) };
    }
    #[inline]
    pub fn stop(&mut self) {
        // SAFETY: idle was `init`ed.
        let _ = unsafe { uv_idle_stop(self) };
    }
}
#[repr(C)]
pub struct uv_async_t {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub async_req: uv_req_t,
    pub async_cb: uv_async_cb,
    pub async_sent: u8,
}
pub type Async = uv_async_t;
impl uv_async_t {
    #[inline]
    pub fn init(&mut self, loop_: *mut Loop, callback: uv_async_cb) {
        // SAFETY: `self` is `#[repr(C)]` POD; all-zero is valid.
        unsafe { ptr::write_bytes(self, 0, 1) };
        // SAFETY: self is a valid `uv_async_t`-sized allocation.
        if unsafe { uv_async_init(loop_, self, callback) } != 0 {
            panic!("internal error: uv_async_init failed");
        }
    }
    #[inline]
    pub fn send(&mut self) {
        // SAFETY: async was `init`ed.
        let _ = unsafe { uv_async_send(self) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `Process` (`uv_process_t`) + spawn options.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_process_exit_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
}
#[repr(C)]
pub struct Process {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub exit_cb: uv_exit_cb,
    pub pid: c_int,
    pub exit_req: uv_process_exit_t,
    pub unused: *mut c_void,
    pub exit_signal: c_int,
    pub wait_handle: HANDLE,
    pub process_handle: HANDLE,
    pub exit_cb_pending: u8,
}
pub type uv_process_t = Process;
impl Process {
    #[inline]
    pub fn spawn(&mut self, loop_: *mut Loop, options: *const uv_process_options_t) -> ReturnCode {
        // SAFETY: `self` is a valid `uv_process_t`-sized allocation.
        unsafe { uv_spawn(loop_, self, options) }
    }
    #[inline]
    pub fn kill(&mut self, signum: c_int) -> ReturnCode {
        // SAFETY: process was spawned.
        unsafe { uv_process_kill(self, signum) }
    }
    #[inline]
    pub fn get_pid(&self) -> c_int {
        // SAFETY: process was spawned.
        unsafe { uv_process_get_pid(self) }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub union uv_stdio_container_data {
    pub stream: *mut uv_stream_t,
    pub fd: c_int,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_stdio_container_t {
    pub flags: uv_stdio_flags,
    pub data: uv_stdio_container_data,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_process_options_t {
    pub exit_cb: uv_exit_cb,
    pub file: *const c_char,
    pub args: *const *const c_char,
    pub env: *const *const c_char,
    pub cwd: *const c_char,
    pub flags: c_uint,
    pub stdio_count: c_int,
    pub stdio: *mut uv_stdio_container_t,
    pub uid: uv_uid_t,
    pub gid: uv_gid_t,
    /// Windows only: HPCON from CreatePseudoConsole. When non-null, the child
    /// is attached to the pseudoconsole and stdio[] is not inherited.
    pub pseudoconsole: *mut c_void,
}

// ──────────────────────────────────────────────────────────────────────────
// `uv_fs_event_t` / `uv_fs_poll_t` / `uv_signal_t`.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_fs_event_req_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
}
#[repr(C)]
pub struct uv_fs_event_t {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub path: *mut c_char,
    pub req: uv_fs_event_req_t,
    pub dir_handle: HANDLE,
    pub req_pending: c_int,
    pub cb: uv_fs_event_cb,
    pub filew: *mut WCHAR,
    pub short_filew: *mut WCHAR,
    pub dirw: *mut WCHAR,
    pub buffer: *mut u8,
}
impl uv_fs_event_t {
    #[inline]
    pub fn is_dir(&self) -> bool {
        !self.dirw.is_null()
    }

    /// Port of `uv_fs_event_t.hash` (libuv.zig:1750) — `std.hash.Wyhash` over
    /// `path ?? "null"`, `events` bytes, `filename`, `status` bytes.
    pub fn hash(&self, filename: &[u8], events: c_int, status: ReturnCode) -> u64 {
        let mut hasher = bun_wyhash::Wyhash::init(0);
        if self.path.is_null() {
            hasher.update(b"null");
        } else {
            // SAFETY: `path` is a valid NUL-terminated C string owned by libuv
            // for the lifetime of the open handle.
            hasher.update(unsafe { core::ffi::CStr::from_ptr(self.path) }.to_bytes());
        }
        hasher.update(&events.to_ne_bytes());
        hasher.update(filename);
        hasher.update(&status.0.to_ne_bytes());
        hasher.final_()
    }
}
#[repr(C)]
pub struct uv_fs_poll_t {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub poll_ctx: *mut c_void,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct signal_tree_entry {
    rbe_left: *mut uv_signal_t,
    rbe_right: *mut uv_signal_t,
    rbe_parent: *mut uv_signal_t,
    rbe_color: c_int,
}
#[repr(C)]
pub struct uv_signal_t {
    pub data: *mut c_void,
    pub loop_: *mut Loop,
    pub type_: HandleType,
    pub close_cb: uv_close_cb,
    pub handle_queue: uv__queue,
    pub u: handle_u,
    pub endgame_next: *mut uv_handle_t,
    pub flags: c_uint,
    pub signal_cb: uv_signal_cb,
    pub signum: c_int,
    tree_entry: signal_tree_entry,
    pub signal_req: uv_req_t,
    pub pending_signum: c_ulong,
}

// ──────────────────────────────────────────────────────────────────────────
// `uv_getaddrinfo_t` / `uv_getnameinfo_t` / `uv_work_t` / `uv_random_t`.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
pub struct uv_getaddrinfo_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
    pub loop_: *mut Loop,
    pub work_req: uv__work,
    pub getaddrinfo_cb: uv_getaddrinfo_cb,
    pub alloc: *mut c_void,
    pub node: *mut WCHAR,
    pub service: *mut WCHAR,
    pub addrinfow: *mut c_void,
    pub addrinfo: *mut addrinfo,
    pub retcode: ReturnCode,
}
#[repr(C)]
pub struct uv_getnameinfo_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
    pub loop_: *mut Loop,
    pub work_req: uv__work,
    pub getnameinfo_cb: uv_getnameinfo_cb,
    pub storage: sockaddr_storage,
    pub flags: c_int,
    pub host: [u8; 1025],
    pub service: [u8; 32],
    pub retcode: c_int,
}
#[repr(C)]
pub struct uv_work_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
    pub loop_: *mut Loop,
    pub work_cb: uv_work_cb,
    pub after_work_cb: uv_after_work_cb,
    pub work_req: uv__work,
}
#[repr(C)]
pub struct uv_random_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
    pub loop_: *mut Loop,
    pub status: c_int,
    pub buf: *mut c_void,
    pub buflen: usize,
    pub cb: uv_random_cb,
    pub work_req: uv__work,
}

// ──────────────────────────────────────────────────────────────────────────
// `fs_t` (`uv_fs_t`) + `uv_stat_t`, `uv_dirent_t`, `uv_dir_t`.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_timespec_t {
    pub sec: c_long,
    pub nsec: c_long,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_timespec64_t {
    pub sec: i64,
    pub nsec: i32,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_timeval_t {
    pub sec: c_long,
    pub usec: c_long,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_timeval64_t {
    pub sec: i64,
    pub usec: i32,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_stat_t {
    // Field names match libuv's `uv_stat_t` (uv.h) — `st_*`, not bare `mode` —
    // so this is field-compatible with `libc::stat` for cross-platform code
    // that does `stat.st_mode` / `stat.st_size`. Layout asserts at bottom of
    // file lock the C ABI; only the Rust-side names changed (round 3).
    pub st_dev: u64,
    pub st_mode: u64,
    pub st_nlink: u64,
    pub st_uid: u64,
    pub st_gid: u64,
    pub st_rdev: u64,
    pub st_ino: u64,
    pub st_size: u64,
    pub st_blksize: u64,
    pub st_blocks: u64,
    pub st_flags: u64,
    pub st_gen: u64,
    pub atim: uv_timespec_t,
    pub mtim: uv_timespec_t,
    pub ctim: uv_timespec_t,
    pub birthtim: uv_timespec_t,
}
impl uv_stat_t {
    #[inline]
    pub fn atime(&self) -> uv_timespec_t {
        self.atim
    }
    #[inline]
    pub fn mtime(&self) -> uv_timespec_t {
        self.mtim
    }
    #[inline]
    pub fn ctime(&self) -> uv_timespec_t {
        self.ctim
    }
    #[inline]
    pub fn birthtime(&self) -> uv_timespec_t {
        self.birthtim
    }
    // Un-prefixed accessors so cross-platform code that pattern-matches on
    // POSIX `stat.mode`/`stat.size` (Zig: `st.mode`, `st.size`) can call
    // through without `cfg` arms.
    #[inline]
    pub fn mode(&self) -> u64 {
        self.st_mode
    }
    #[inline]
    pub fn size(&self) -> u64 {
        self.st_size
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_dirent_t {
    pub name: *const c_char,
    pub type_: uv_dirent_type_t,
}
#[repr(C)]
pub struct uv_dir_t {
    pub dirents: *mut uv_dirent_t,
    pub nentries: usize,
    pub reserved: [*mut c_void; 4],
    pub dir_handle: HANDLE,
    pub find_data: WIN32_FIND_DATAW,
    pub need_find_call: BOOL,
}

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

/// `uv_fs_t` (Windows layout).
#[repr(C)]
pub struct fs_t {
    pub data: *mut c_void,
    pub type_: uv_req_type,
    pub reserved: [*mut c_void; 6],
    pub u: req_u,
    pub next_req: *mut uv_req_t,
    pub fs_type: uv_fs_type,
    pub loop_: *mut Loop,
    pub cb: uv_fs_cb,
    pub result: ReturnCodeI64,
    pub ptr: *mut c_void,
    pub path: *const c_char,
    pub statbuf: uv_stat_t,
    pub work_req: uv__work,
    pub flags: c_int,
    pub sys_errno_: DWORD,
    file: fs_file,
    fs: fs_fs,
}
pub type uv_fs_t = fs_t;
pub type uv_fs_s = fs_t;

impl fs_t {
    const UV_FS_CLEANEDUP: c_int = 0x0010;

    /// Debug sentinel: `loop_` is poisoned so `deinit()` can assert that libuv
    /// actually wrote the request before we try to clean it up.
    /// Zig: `pub const uninitialized: fs_t` — kept as a fn (raw-pointer fields
    /// in nested unions block a true `const`); `#[inline(always)]` so the
    /// ~440-byte zero-fill on every sync `uv_fs_*` call optimises identically
    /// to the Zig `.rodata` value.
    #[inline(always)]
    pub fn uninitialized() -> fs_t {
        let mut v: fs_t = bun_core::ffi::zeroed();
        v.loop_ = 0xAAAA_AAAA_AAAA_0000usize as *mut Loop;
        v
    }

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
            if self.loop_ as usize == 0xAAAA_AAAA_AAAA_0000usize {
                return;
            }
            if (self.flags & Self::UV_FS_CLEANEDUP) != 0 {
                return;
            }
            panic!(
                "uv_fs_t was not cleaned up. it is expected to call .deinit() on the fs_t here."
            );
        }
    }
    #[inline]
    pub unsafe fn ptr_as<T>(&self) -> *const T {
        self.assert_initialized();
        self.ptr.cast::<T>()
    }
    /// `req.file.fd` (Zig: `union(.{ pathw, fd })` arm). The union is private
    /// because the active variant is path-dependent (`uv_fs_open` writes `fd`;
    /// path-taking ops write `pathw`); callers reading the wrong arm get UB.
    /// SAFETY: only valid after a `uv_fs_*` call that populated the `fd` arm.
    #[inline]
    pub unsafe fn file_fd(&self) -> uv_file {
        unsafe { self.file.fd }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Misc info structs (`uv_cpu_info_t`, `uv_interface_address_t`, …).
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_env_item_t {
    pub name: *mut c_char,
    pub value: *mut c_char,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_cpu_times_t {
    pub user: u64,
    pub nice: u64,
    pub sys: u64,
    pub idle: u64,
    pub irq: u64,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_cpu_info_t {
    pub model: *mut c_char,
    pub speed: c_int,
    pub cpu_times: uv_cpu_times_t,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub union addr_union {
    pub address4: sockaddr_in,
    pub address6: sockaddr_in6,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub union netmask_union {
    pub netmask4: sockaddr_in,
    pub netmask6: sockaddr_in6,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_interface_address_t {
    pub name: *mut c_char,
    pub phys_addr: [u8; 6],
    pub is_internal: c_int,
    pub address: addr_union,
    pub netmask: netmask_union,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_passwd_t {
    pub username: *mut c_char,
    pub uid: c_ulong,
    pub gid: c_ulong,
    pub shell: *mut c_char,
    pub homedir: *mut c_char,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_group_t {
    pub groupname: *mut c_char,
    pub gid: c_ulong,
    pub members: *mut *mut c_char,
}
#[repr(C)]
pub struct uv_utsname_t {
    pub sysname: [u8; 256],
    pub release: [u8; 256],
    pub version: [u8; 256],
    pub machine: [u8; 256],
}
pub type uv_utsname_s = uv_utsname_t;
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_statfs_t {
    pub f_type: u64,
    pub f_bsize: u64,
    pub f_blocks: u64,
    pub f_bfree: u64,
    pub f_bavail: u64,
    pub f_files: u64,
    pub f_ffree: u64,
    pub f_spare: [u64; 4],
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_metrics_t {
    pub loop_count: u64,
    pub events: u64,
    pub events_waiting: u64,
    pub reserved: [*mut u64; 13],
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_rusage_t {
    pub ru_utime: uv_timeval_t,
    pub ru_stime: uv_timeval_t,
    pub ru_maxrss: u64,
    pub ru_ixrss: u64,
    pub ru_idrss: u64,
    pub ru_isrss: u64,
    pub ru_minflt: u64,
    pub ru_majflt: u64,
    pub ru_nswap: u64,
    pub ru_inblock: u64,
    pub ru_oublock: u64,
    pub ru_msgsnd: u64,
    pub ru_msgrcv: u64,
    pub ru_nsignals: u64,
    pub ru_nvcsw: u64,
    pub ru_nivcsw: u64,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_key_t {
    pub tls_index: DWORD,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_once_t {
    pub ran: u8,
    pub event: HANDLE,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_lib_t {
    pub handle: HMODULE,
    pub errmsg: *mut c_char,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct uv_thread_options_t {
    pub flags: c_uint,
    pub stack_size: usize,
}

// ──────────────────────────────────────────────────────────────────────────
// `ReturnCode` / `ReturnCodeI64` — `enum(c_int)` newtypes; libuv return codes
// are `0` on success, `-errno` on failure.
// ──────────────────────────────────────────────────────────────────────────
/// Map a negative `UV_E*` libuv error code to the stable `bun.sys.E` /
/// `bun_errno::E` discriminant (e.g. `UV_ENOENT (-4058)` → `2`).
///
/// This is the leaf-crate copy of Zig `ReturnCode.errno()`'s switch
/// (libuv.zig:2888-2970). Layering forbids depending on `bun_errno` here, so
/// the integer discriminants are inlined; they are ABI-stable POSIX values
/// plus a fixed Bun-assigned tail (`UNKNOWN=134`..`FTYPE=137`). Unmapped
/// codes return `None`, matching Zig's `else => null`.
///
/// Keep in sync with `bun_errno::E` (src/errno/windows_errno.rs) and the Zig
/// switch in `libuv.zig`.
#[inline]
pub const fn uv_err_to_e_discriminant(code: c_int) -> Option<u16> {
    Some(match code {
        UV_EPERM => 1,            // E::PERM
        UV_ENOENT => 2,           // E::NOENT
        UV_ESRCH => 3,            // E::SRCH
        UV_EINTR => 4,            // E::INTR
        UV_EIO => 5,              // E::IO
        UV_ENXIO => 6,            // E::NXIO
        UV_E2BIG => 7,            // E::_2BIG
        UV_ENOEXEC => 8,          // E::NOEXEC
        UV_EBADF => 9,            // E::BADF
        UV_EAGAIN => 11,          // E::AGAIN
        UV_ENOMEM => 12,          // E::NOMEM
        UV_EACCES => 13,          // E::ACCES
        UV_EFAULT => 14,          // E::FAULT
        UV_EBUSY => 16,           // E::BUSY
        UV_EEXIST => 17,          // E::EXIST
        UV_EXDEV => 18,           // E::XDEV
        UV_ENODEV => 19,          // E::NODEV
        UV_ENOTDIR => 20,         // E::NOTDIR
        UV_EISDIR => 21,          // E::ISDIR
        UV_EINVAL => 22,          // E::INVAL
        UV_ENFILE => 23,          // E::NFILE
        UV_EMFILE => 24,          // E::MFILE
        UV_ENOTTY => 25,          // E::NOTTY
        UV_EFTYPE => 137,         // E::FTYPE
        UV_ETXTBSY => 26,         // E::TXTBSY
        UV_EFBIG => 27,           // E::FBIG
        UV_ENOSPC => 28,          // E::NOSPC
        UV_ESPIPE => 29,          // E::SPIPE
        UV_EROFS => 30,           // E::ROFS
        UV_EMLINK => 31,          // E::MLINK
        UV_EPIPE => 32,           // E::PIPE
        UV_ERANGE => 34,          // E::RANGE
        UV_ENAMETOOLONG => 36,    // E::NAMETOOLONG
        UV_ENOSYS => 38,          // E::NOSYS
        UV_ENOTEMPTY => 39,       // E::NOTEMPTY
        UV_ELOOP => 40,           // E::LOOP
        UV_EUNATCH => 49,         // E::UNATCH
        UV_ENODATA => 61,         // E::NODATA
        UV_ENONET => 64,          // E::NONET
        UV_EPROTO => 71,          // E::PROTO
        UV_EOVERFLOW => 75,       // E::OVERFLOW
        UV_EILSEQ => 84,          // E::ILSEQ
        UV_ENOTSOCK => 88,        // E::NOTSOCK
        UV_EDESTADDRREQ => 89,    // E::DESTADDRREQ
        UV_EMSGSIZE => 90,        // E::MSGSIZE
        UV_EPROTOTYPE => 91,      // E::PROTOTYPE
        UV_ENOPROTOOPT => 92,     // E::NOPROTOOPT
        UV_EPROTONOSUPPORT => 93, // E::PROTONOSUPPORT
        UV_ESOCKTNOSUPPORT => 94, // E::SOCKTNOSUPPORT
        UV_ENOTSUP => 95,         // E::NOTSUP
        UV_EAFNOSUPPORT => 97,    // E::AFNOSUPPORT
        UV_EADDRINUSE => 98,      // E::ADDRINUSE
        UV_EADDRNOTAVAIL => 99,   // E::ADDRNOTAVAIL
        UV_ENETDOWN => 100,       // E::NETDOWN
        UV_ENETUNREACH => 101,    // E::NETUNREACH
        UV_ECONNABORTED => 103,   // E::CONNABORTED
        UV_ECONNRESET => 104,     // E::CONNRESET
        UV_ENOBUFS => 105,        // E::NOBUFS
        UV_EISCONN => 106,        // E::ISCONN
        UV_ENOTCONN => 107,       // E::NOTCONN
        UV_ESHUTDOWN => 108,      // E::SHUTDOWN
        UV_ETIMEDOUT => 110,      // E::TIMEDOUT
        UV_ECONNREFUSED => 111,   // E::CONNREFUSED
        UV_EHOSTDOWN => 112,      // E::HOSTDOWN
        UV_EHOSTUNREACH => 113,   // E::HOSTUNREACH
        UV_EALREADY => 114,       // E::ALREADY
        UV_EREMOTEIO => 121,      // E::REMOTEIO
        UV_ECANCELED => 125,      // E::CANCELED
        UV_ECHARSET => 135,       // E::CHARSET
        UV_EOF => 136,            // E::EOF
        UV_UNKNOWN => 134,        // E::UNKNOWN
        // EAI_* codes — `bun_errno::E::UV_EAI_*` discriminants are defined as
        // `(-UV_EAI_*) as u16`, i.e. the raw magnitude is the discriminant.
        UV_EAI_ADDRFAMILY => (-UV_EAI_ADDRFAMILY) as u16,
        UV_EAI_AGAIN => (-UV_EAI_AGAIN) as u16,
        UV_EAI_BADFLAGS => (-UV_EAI_BADFLAGS) as u16,
        UV_EAI_BADHINTS => (-UV_EAI_BADHINTS) as u16,
        UV_EAI_CANCELED => (-UV_EAI_CANCELED) as u16,
        UV_EAI_FAIL => (-UV_EAI_FAIL) as u16,
        UV_EAI_FAMILY => (-UV_EAI_FAMILY) as u16,
        UV_EAI_MEMORY => (-UV_EAI_MEMORY) as u16,
        UV_EAI_NODATA => (-UV_EAI_NODATA) as u16,
        UV_EAI_NONAME => (-UV_EAI_NONAME) as u16,
        UV_EAI_OVERFLOW => (-UV_EAI_OVERFLOW) as u16,
        UV_EAI_PROTOCOL => (-UV_EAI_PROTOCOL) as u16,
        UV_EAI_SERVICE => (-UV_EAI_SERVICE) as u16,
        UV_EAI_SOCKTYPE => (-UV_EAI_SOCKTYPE) as u16,
        _ => return None,
    })
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct ReturnCode(pub c_int);

// ──────────────────────────────────────────────────────────────────────────
// `bun_core::ffi::Zeroable` impls (S021). Every libuv handle/request struct
// above is `#[repr(C)]` POD whose fields are integers, raw pointers,
// `Option<extern fn>` callbacks, nested POD unions, or `HandleType` (a
// `#[repr(C)]` enum with `Unknown = 0`). The all-zero bit pattern is therefore
// a valid pre-`uv_*_init` state — exactly what `std::mem::zeroes` produced in
// the Zig original. Auditing the bound once per type here lets every
// `Box::new(zeroed())` / stack out-param site drop its `unsafe` block.
//
// SAFETY (per type): audited against the field list in this file — no
// `NonNull`/`NonZero`/reference/bare-fn-ptr fields; every enum field has a
// `= 0` discriminant (`HandleType::Unknown`, `uv_req_type`/`uv_fs_type` are
// plain `c_uint`/`c_int`).
unsafe impl bun_core::ffi::Zeroable for uv_buf_t {}
unsafe impl bun_core::ffi::Zeroable for uv_req_t {}
unsafe impl bun_core::ffi::Zeroable for uv_write_t {}
unsafe impl bun_core::ffi::Zeroable for uv_connect_t {}
unsafe impl bun_core::ffi::Zeroable for Handle {}
unsafe impl bun_core::ffi::Zeroable for Timer {}
unsafe impl bun_core::ffi::Zeroable for Pipe {}
unsafe impl bun_core::ffi::Zeroable for uv_idle_t {}
unsafe impl bun_core::ffi::Zeroable for uv_poll_t {}
unsafe impl bun_core::ffi::Zeroable for uv_fs_event_t {}
unsafe impl bun_core::ffi::Zeroable for uv_getaddrinfo_t {}
unsafe impl bun_core::ffi::Zeroable for uv_tty_t {}
unsafe impl bun_core::ffi::Zeroable for fs_t {}
impl ReturnCode {
    pub const ZERO: ReturnCode = ReturnCode(0);
    #[inline]
    pub const fn zero() -> ReturnCode {
        ReturnCode(0)
    }
    #[inline]
    pub const fn from_raw(v: c_int) -> ReturnCode {
        ReturnCode(v)
    }
    #[inline]
    pub const fn int(self) -> c_int {
        self.0
    }
    /// `Some(|UV_E*|)` when negative — the **raw** libuv error magnitude
    /// (e.g. 4082 for `UV_EBUSY`). Use [`errno`] for the translated POSIX
    /// `bun.sys.E` value (e.g. 16 for `BUSY`) that Zig's `errno()` returns.
    #[inline]
    pub const fn raw_errno(self) -> Option<u16> {
        if self.0 < 0 {
            Some(self.0.unsigned_abs() as u16)
        } else {
            None
        }
    }
    /// Zig `ReturnCode.errno()` (libuv.zig:2888-2970): when negative, map the
    /// `UV_E*` code to the small POSIX `bun.sys.E` discriminant (e.g.
    /// `UV_ENOENT (-4058)` → `2`). Returns `None` for non-negative *or*
    /// unmapped negative codes (Zig: `else => null`). Downstream callers
    /// (`node_fs`, `sys::Fd`, `write_file`, …) store this directly into
    /// `bun_sys::Error.errno`, so it MUST be the translated value, not the raw
    /// `|UV_E*|` magnitude — see [`raw_errno`] for the latter.
    #[inline]
    pub const fn errno(self) -> Option<u16> {
        if self.0 < 0 {
            uv_err_to_e_discriminant(self.0)
        } else {
            None
        }
    }
    /// Zig `errEnum()` (libuv.zig:2975-2979) — same translated value as
    /// [`errno`]; for the typed `bun_sys::E` use
    /// `bun_sys::ReturnCodeExt::err_enum_e` (layering: `E` lives upstream).
    #[inline]
    pub const fn err_enum(self) -> Option<u16> {
        self.errno()
    }
    /// Layer-free `< 0` check (Zig: `Maybe(void).isErr()` after `.toError`).
    /// For the tagged `bun_sys::Error` use [`ReturnCodeExt::to_error`].
    #[inline]
    pub const fn is_err(self) -> bool {
        self.0 < 0
    }
}
impl fmt::Debug for ReturnCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl fmt::Display for ReturnCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ReturnCodeI64(pub i64);
impl ReturnCodeI64 {
    #[inline]
    pub const fn init(i: i64) -> ReturnCodeI64 {
        ReturnCodeI64(i)
    }
    #[inline]
    pub const fn int(self) -> i64 {
        self.0
    }
    #[inline]
    pub const fn errno(self) -> Option<u16> {
        if self.0 < 0 {
            Some(self.0.unsigned_abs() as u16)
        } else {
            None
        }
    }
    /// Zig `errEnum()` (libuv.zig:3022-3027) — translated `bun_sys::E`
    /// discriminant via [`uv_err_to_e_discriminant`] (matching
    /// [`ReturnCode::err_enum`]). For the typed `bun_sys::E` use
    /// `bun_sys::ReturnCodeExt::err_enum_e` (layering: `E` lives upstream).
    #[inline]
    pub const fn err_enum(self) -> Option<u16> {
        if self.0 < 0 {
            uv_err_to_e_discriminant(self.0 as c_int)
        } else {
            None
        }
    }
    /// Zig: `toFD()` — `req.result` after a successful `uv_fs_open` is the
    /// CRT fd. Returns the raw `uv_file`; caller wraps with `Fd::from_uv`
    /// (`bun_core::Fd` is a higher-tier type).
    #[inline]
    pub fn to_fd(self) -> uv_file {
        debug_assert!(self.0 >= 0);
        self.0 as uv_file
    }
}
impl fmt::Display for ReturnCodeI64 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `O` — `UV_FS_O_*` flag namespace + `from_bun_o`/`to_bun_o` translation
// (libuv.zig:170-254). The `bun.O.*` POSIX-like values are passed in by the
// caller as a raw `i32` (per **Zig** `bun.O` on Windows — sys.zig:188-213 —
// which normalises to Linux-style octal constants, NOT MSVC `libc::O_*`);
// these fns map to/from libuv's MSVC `_O_*` values that `uv_fs_open` expects.
// ──────────────────────────────────────────────────────────────────────────
pub mod O {
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
    pub const EXLOCK: i32 = 0x1000_0000;
    pub const NOATIME: i32 = 0;
    pub const NOCTTY: i32 = 0;
    pub const NOFOLLOW: i32 = 0;
    pub const NONBLOCK: i32 = 0;
    pub const SYMLINK: i32 = 0;

    // `bun.O.*` — POSIX-shaped flag values Bun normalises to internally.
    //
    // ⚠ These match **Zig `bun.O` on Windows** (src/sys/sys.zig:188-213),
    // which hard-codes Linux-style octal constants. They do **NOT** match
    // `bun_sys::O` if that crate is built against MSVC `libc::O_*`
    // (CREAT=0x100, EXCL=0x400, APPEND=0x8). `bun_sys::O` on Windows must
    // mirror sys.zig — cross-crate static asserts live in `bun_sys` (this
    // crate stays leaf). libuv.zig pulls these from `bun.O`; the constants
    // are stable.
    mod bun_o {
        pub const WRONLY: i32 = 0o1;
        pub const RDWR: i32 = 0o2;
        pub const CREAT: i32 = 0o100;
        pub const EXCL: i32 = 0o200;
        // sys.zig:195 `.windows => { NOCTTY = 0 }` — meaningless on Windows.
        pub const NOCTTY: i32 = 0;
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
        if c_flags & bun_o::WRONLY != 0 {
            flags |= WRONLY;
        }
        if c_flags & bun_o::RDWR != 0 {
            flags |= RDWR;
        }
        if c_flags & bun_o::CREAT != 0 {
            flags |= CREAT;
        }
        if c_flags & bun_o::EXCL != 0 {
            flags |= EXCL;
        }
        if c_flags & bun_o::TRUNC != 0 {
            flags |= TRUNC;
        }
        if c_flags & bun_o::APPEND != 0 {
            flags |= APPEND;
        }
        if c_flags & bun_o::NONBLOCK != 0 {
            flags |= NONBLOCK;
        }
        // SYNC and DSYNC must be mutually exclusive for libuv on Windows.
        // `bun.O.SYNC` (0o4010000) is a superset of `DSYNC` (0o10000), so check
        // SYNC first to emit only `UV_FS_O_SYNC` when both bits are present.
        // NOTE: `& != 0` (any-overlap) matches the Zig spec verbatim
        // (libuv.zig:213); a DSYNC-only input also takes this branch — if that
        // is wrong it is wrong upstream too.
        if c_flags & bun_o::SYNC != 0 {
            flags |= SYNC;
        } else if c_flags & bun_o::DSYNC != 0 {
            flags |= DSYNC;
        }
        if c_flags & bun_o::NOFOLLOW != 0 {
            flags |= NOFOLLOW;
        }
        if c_flags & bun_o::DIRECT != 0 {
            flags |= DIRECT;
        }
        if c_flags & FILEMAP != 0 {
            flags |= FILEMAP;
        }
        flags
    }

    /// Convert from libuv/Windows MSVC `_O_*` flags to internal `bun.O` flags.
    /// Inverse of [`from_bun_o`]; needed because `fs.constants` exposes the
    /// platform's native C values to JavaScript, but internally Bun normalises
    /// all flags to the `bun.O` (POSIX-like) representation.
    pub fn to_bun_o(uv_flags: i32) -> i32 {
        let mut flags: i32 = 0;
        if uv_flags & WRONLY != 0 {
            flags |= bun_o::WRONLY;
        }
        if uv_flags & RDWR != 0 {
            flags |= bun_o::RDWR;
        }
        if uv_flags & CREAT != 0 {
            flags |= bun_o::CREAT;
        }
        if uv_flags & EXCL != 0 {
            flags |= bun_o::EXCL;
        }
        if uv_flags & TRUNC != 0 {
            flags |= bun_o::TRUNC;
        }
        if uv_flags & APPEND != 0 {
            flags |= bun_o::APPEND;
        }
        if uv_flags & SYNC != 0 {
            flags |= bun_o::SYNC;
        } else if uv_flags & DSYNC != 0 {
            flags |= bun_o::DSYNC;
        }
        if uv_flags & DIRECT != 0 {
            flags |= bun_o::DIRECT;
        }
        if uv_flags & FILEMAP != 0 {
            flags |= FILEMAP;
        }
        flags
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Error constants (uv-errno.h, Windows values).
// ──────────────────────────────────────────────────────────────────────────
pub const UV__EOF: c_int = -4095;
pub const UV__UNKNOWN: c_int = -4094;
pub const UV__ECHARSET: c_int = -4080;

pub const UV_E2BIG: c_int = -4093;
pub const UV_EACCES: c_int = -4092;
pub const UV_EADDRINUSE: c_int = -4091;
pub const UV_EADDRNOTAVAIL: c_int = -4090;
pub const UV_EAFNOSUPPORT: c_int = -4089;
pub const UV_EAGAIN: c_int = -4088;
pub const UV_EAI_ADDRFAMILY: c_int = -3000;
pub const UV_EAI_AGAIN: c_int = -3001;
pub const UV_EAI_BADFLAGS: c_int = -3002;
pub const UV_EAI_BADHINTS: c_int = -3013;
pub const UV_EAI_CANCELED: c_int = -3003;
pub const UV_EAI_FAIL: c_int = -3004;
pub const UV_EAI_FAMILY: c_int = -3005;
pub const UV_EAI_MEMORY: c_int = -3006;
pub const UV_EAI_NODATA: c_int = -3007;
pub const UV_EAI_NONAME: c_int = -3008;
pub const UV_EAI_OVERFLOW: c_int = -3009;
pub const UV_EAI_PROTOCOL: c_int = -3014;
pub const UV_EAI_SERVICE: c_int = -3010;
pub const UV_EAI_SOCKTYPE: c_int = -3011;
pub const UV_EALREADY: c_int = -4084;
pub const UV_EBADF: c_int = -4083;
pub const UV_EBUSY: c_int = -4082;
pub const UV_ECANCELED: c_int = -4081;
pub const UV_ECHARSET: c_int = -4080;
pub const UV_ECONNABORTED: c_int = -4079;
pub const UV_ECONNREFUSED: c_int = -4078;
pub const UV_ECONNRESET: c_int = -4077;
pub const UV_EDESTADDRREQ: c_int = -4076;
pub const UV_EEXIST: c_int = -4075;
pub const UV_EFAULT: c_int = -4074;
pub const UV_EFBIG: c_int = -4036;
pub const UV_EHOSTUNREACH: c_int = -4073;
pub const UV_EINTR: c_int = -4072;
pub const UV_EINVAL: c_int = -4071;
pub const UV_EIO: c_int = -4070;
pub const UV_EISCONN: c_int = -4069;
pub const UV_EISDIR: c_int = -4068;
pub const UV_ELOOP: c_int = -4067;
pub const UV_EMFILE: c_int = -4066;
pub const UV_EMSGSIZE: c_int = -4065;
pub const UV_ENAMETOOLONG: c_int = -4064;
pub const UV_ENETDOWN: c_int = -4063;
pub const UV_ENETUNREACH: c_int = -4062;
pub const UV_ENFILE: c_int = -4061;
pub const UV_ENOBUFS: c_int = -4060;
pub const UV_ENODEV: c_int = -4059;
pub const UV_ENOENT: c_int = -4058;
pub const UV_ENOMEM: c_int = -4057;
pub const UV_ENONET: c_int = -4056;
pub const UV_ENOPROTOOPT: c_int = -4035;
pub const UV_ENOSPC: c_int = -4055;
pub const UV_ENOSYS: c_int = -4054;
pub const UV_ENOTCONN: c_int = -4053;
pub const UV_ENOTDIR: c_int = -4052;
pub const UV_ENOTEMPTY: c_int = -4051;
pub const UV_ENOTSOCK: c_int = -4050;
pub const UV_ENOTSUP: c_int = -4049;
pub const UV_EOVERFLOW: c_int = -4026;
pub const UV_EPERM: c_int = -4048;
pub const UV_EPIPE: c_int = -4047;
pub const UV_EPROTO: c_int = -4046;
pub const UV_EPROTONOSUPPORT: c_int = -4045;
pub const UV_EPROTOTYPE: c_int = -4044;
pub const UV_ERANGE: c_int = -4034;
pub const UV_EROFS: c_int = -4043;
pub const UV_ESHUTDOWN: c_int = -4042;
pub const UV_ESPIPE: c_int = -4041;
pub const UV_ESRCH: c_int = -4040;
pub const UV_ETIMEDOUT: c_int = -4039;
pub const UV_ETXTBSY: c_int = -4038;
pub const UV_EXDEV: c_int = -4037;
pub const UV_UNKNOWN: c_int = -4094;
pub const UV_EOF: c_int = -4095;
pub const UV_ENXIO: c_int = -4033;
pub const UV_EMLINK: c_int = -4032;
pub const UV_EHOSTDOWN: c_int = -4031;
pub const UV_EREMOTEIO: c_int = -4030;
pub const UV_ENOTTY: c_int = -4029;
pub const UV_EFTYPE: c_int = -4028;
pub const UV_EILSEQ: c_int = -4027;
pub const UV_ESOCKTNOSUPPORT: c_int = -4025;
pub const UV_ENODATA: c_int = -4024;
pub const UV_EUNATCH: c_int = -4023;
pub const UV_ENOEXEC: c_int = -4022;
pub const UV_ERRNO_MAX: c_int = -4096;

// `uv_dirent_type_t` discriminants (libuv.zig:2497-2504) — compared against
// `uv_dirent_t.type_` by Windows `fs.readdir`.
pub const UV_DIRENT_UNKNOWN: c_int = 0;
pub const UV_DIRENT_FILE: c_int = 1;
pub const UV_DIRENT_DIR: c_int = 2;
pub const UV_DIRENT_LINK: c_int = 3;
pub const UV_DIRENT_FIFO: c_int = 4;
pub const UV_DIRENT_SOCKET: c_int = 5;
pub const UV_DIRENT_CHAR: c_int = 6;
pub const UV_DIRENT_BLOCK: c_int = 7;

// Misc flag constants.
pub const UV_READABLE: c_int = 1;
pub const UV_WRITABLE: c_int = 2;
pub const UV_DISCONNECT: c_int = 4;
pub const UV_PRIORITIZED: c_int = 8;
pub const UV_LEAVE_GROUP: c_int = 0;
pub const UV_JOIN_GROUP: c_int = 1;
pub const UV_TCP_IPV6ONLY: c_int = 1;
pub const UV_UDP_IPV6ONLY: c_int = 1;
pub const UV_UDP_PARTIAL: c_int = 2;
pub const UV_UDP_REUSEADDR: c_int = 4;
pub const UV_UDP_MMSG_CHUNK: c_int = 8;
pub const UV_UDP_MMSG_FREE: c_int = 16;
pub const UV_UDP_LINUX_RECVERR: c_int = 32;
pub const UV_UDP_RECVMMSG: c_int = 256;
pub const UV_TTY_MODE_NORMAL: c_int = 0;
pub const UV_TTY_MODE_RAW: c_int = 1;
pub const UV_TTY_MODE_IO: c_int = 2;
pub const UV_TTY_SUPPORTED: c_int = 0;
pub const UV_TTY_UNSUPPORTED: c_int = 1;
pub const UV_PIPE_NO_TRUNCATE: c_uint = 1;
pub const UV_FS_SYMLINK_DIR: c_int = 0x0001;
pub const UV_FS_SYMLINK_JUNCTION: c_int = 0x0002;
pub const UV_FS_COPYFILE_EXCL: c_int = 0x0001;
pub const UV_FS_COPYFILE_FICLONE: c_int = 0x0002;
pub const UV_FS_COPYFILE_FICLONE_FORCE: c_int = 0x0004;
pub const UV_RENAME: c_int = 1;
pub const UV_CHANGE: c_int = 2;
pub const UV_FS_EVENT_WATCH_ENTRY: c_int = 1;
pub const UV_FS_EVENT_STAT: c_int = 2;
pub const UV_FS_EVENT_RECURSIVE: c_int = 4;
pub const UV_CLOCK_MONOTONIC: c_int = 0;
pub const UV_CLOCK_REALTIME: c_int = 1;
pub const UV_LOOP_BLOCK_SIGNAL: c_int = 0;
pub const UV_METRICS_IDLE_TIME: c_int = 1;

// Stdio / process flags.
pub const UV_IGNORE: c_uint = 0;
pub const UV_CREATE_PIPE: c_uint = 1;
pub const UV_INHERIT_FD: c_uint = 2;
pub const UV_INHERIT_STREAM: c_uint = 4;
pub const UV_READABLE_PIPE: c_uint = 16;
pub const UV_WRITABLE_PIPE: c_uint = 32;
pub const UV_NONBLOCK_PIPE: c_uint = 64;
pub const UV_OVERLAPPED_PIPE: c_uint = 64;
pub mod StdioFlags {
    pub const ignore: super::c_uint = super::UV_IGNORE;
    pub const create_pipe: super::c_uint = super::UV_CREATE_PIPE;
    pub const inherit_fd: super::c_uint = super::UV_INHERIT_FD;
    pub const inherit_stream: super::c_uint = super::UV_INHERIT_STREAM;
    pub const readable_pipe: super::c_uint = super::UV_READABLE_PIPE;
    pub const writable_pipe: super::c_uint = super::UV_WRITABLE_PIPE;
    pub const nonblock_pipe: super::c_uint = super::UV_NONBLOCK_PIPE;
    pub const overlapped_pipe: super::c_uint = super::UV_OVERLAPPED_PIPE;
    // SCREAMING_CASE aliases — Zig exposes both via the implicit
    // tag↔int coercion; downstream `bun_spawn` was authored against the
    // upper-case form (process.zig:1261 `StdioFlags.INHERIT_FD`).
    pub const IGNORE: super::c_uint = super::UV_IGNORE;
    pub const CREATE_PIPE: super::c_uint = super::UV_CREATE_PIPE;
    pub const INHERIT_FD: super::c_uint = super::UV_INHERIT_FD;
    pub const INHERIT_STREAM: super::c_uint = super::UV_INHERIT_STREAM;
    pub const READABLE_PIPE: super::c_uint = super::UV_READABLE_PIPE;
    pub const WRITABLE_PIPE: super::c_uint = super::UV_WRITABLE_PIPE;
    pub const NONBLOCK_PIPE: super::c_uint = super::UV_NONBLOCK_PIPE;
    pub const OVERLAPPED_PIPE: super::c_uint = super::UV_OVERLAPPED_PIPE;
}
// `uv_process_flags` — `c_uint` to match `uv_process_options_t.flags` so
// `flags |= UV_PROCESS_*` typechecks (uv.h declares the enum unsigned).
pub const UV_PROCESS_SETUID: c_uint = 1;
pub const UV_PROCESS_SETGID: c_uint = 2;
pub const UV_PROCESS_WINDOWS_VERBATIM_ARGUMENTS: c_uint = 4;
pub const UV_PROCESS_DETACHED: c_uint = 8;
pub const UV_PROCESS_WINDOWS_HIDE: c_uint = 16;
pub const UV_PROCESS_WINDOWS_HIDE_CONSOLE: c_uint = 32;
pub const UV_PROCESS_WINDOWS_HIDE_GUI: c_uint = 64;

pub const UV_PRIORITY_LOW: c_int = 19;
pub const UV_PRIORITY_BELOW_NORMAL: c_int = 10;
pub const UV_PRIORITY_NORMAL: c_int = 0;
pub const UV_PRIORITY_ABOVE_NORMAL: c_int = -7;
pub const UV_PRIORITY_HIGH: c_int = -14;
pub const UV_PRIORITY_HIGHEST: c_int = -20;
pub const UV_MAXHOSTNAMESIZE: c_int = 256;
pub const UV_IF_NAMESIZE: c_int = 17;
pub const MAX_PIPENAME_LEN: c_int = 256;
pub const SIGHUP: c_int = 1;
pub const SIGQUIT: c_int = 3;
pub const SIGKILL: c_int = 9;
pub const SIGWINCH: c_int = 28;

pub const UV_FS_O_APPEND: i32 = O::APPEND;
pub const UV_FS_O_CREAT: i32 = O::CREAT;
pub const UV_FS_O_EXCL: i32 = O::EXCL;
pub const UV_FS_O_FILEMAP: i32 = O::FILEMAP;
pub const UV_FS_O_RANDOM: i32 = O::RANDOM;
pub const UV_FS_O_RDONLY: i32 = O::RDONLY;
pub const UV_FS_O_RDWR: i32 = O::RDWR;
pub const UV_FS_O_SEQUENTIAL: i32 = O::SEQUENTIAL;
pub const UV_FS_O_SHORT_LIVED: i32 = O::SHORT_LIVED;
pub const UV_FS_O_TEMPORARY: i32 = O::TEMPORARY;
pub const UV_FS_O_TRUNC: i32 = O::TRUNC;
pub const UV_FS_O_WRONLY: i32 = O::WRONLY;
pub const UV_FS_O_DIRECT: i32 = O::DIRECT;
pub const UV_FS_O_DIRECTORY: i32 = 0;
pub const UV_FS_O_DSYNC: i32 = O::DSYNC;
pub const UV_FS_O_EXLOCK: i32 = O::EXLOCK;
pub const UV_FS_O_NOATIME: i32 = 0;
pub const UV_FS_O_NOCTTY: i32 = 0;
pub const UV_FS_O_NOFOLLOW: i32 = 0;
pub const UV_FS_O_NONBLOCK: i32 = 0;
pub const UV_FS_O_SYMLINK: i32 = 0;
pub const UV_FS_O_SYNC: i32 = O::SYNC;

pub const UV_HANDLE_CLOSED: c_uint = 0x0000_0002;

/// Non-ABI helper (libuv.zig:2772): `flags & UV_HANDLE_CLOSED != 0`.
#[inline]
pub fn uv_is_closed(handle: &uv_handle_t) -> bool {
    handle.flags & UV_HANDLE_CLOSED != 0
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C" — full surface from libuv.zig:2191-2767.
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    // version / loop
    pub fn uv_version() -> c_uint;
    pub fn uv_version_string() -> *const c_char;
    pub fn uv_library_shutdown();
    pub fn uv_replace_allocator(
        malloc_func: uv_malloc_func,
        realloc_func: uv_realloc_func,
        calloc_func: uv_calloc_func,
        free_func: uv_free_func,
    ) -> c_int;
    pub fn uv_default_loop() -> *mut Loop;
    pub fn uv_loop_init(loop_: *mut Loop) -> ReturnCode;
    pub fn uv_loop_close(loop_: *mut Loop) -> ReturnCode;
    pub fn uv_loop_new() -> *mut Loop;
    pub fn uv_loop_delete(loop_: *mut Loop);
    pub fn uv_loop_size() -> usize;
    pub fn uv_loop_alive(loop_: *const Loop) -> c_int;
    pub fn uv_loop_configure(loop_: *mut Loop, option: uv_loop_option, ...) -> c_int;
    pub fn uv_loop_fork(loop_: *mut Loop) -> c_int;
    pub fn uv_run(loop_: *mut Loop, mode: RunMode) -> c_int;
    pub fn uv_stop(loop_: *mut Loop);
    pub fn uv_ref(handle: *mut uv_handle_t);
    pub fn uv_unref(handle: *mut uv_handle_t);
    pub fn uv_has_ref(handle: *const uv_handle_t) -> c_int;
    pub fn uv_update_time(loop_: *mut Loop);
    pub fn uv_now(loop_: *const Loop) -> u64;
    pub fn uv_backend_fd(loop_: *const Loop) -> c_int;
    pub fn uv_backend_timeout(loop_: *const Loop) -> c_int;
    pub fn uv_loop_get_data(loop_: *const Loop) -> *mut c_void;
    pub fn uv_loop_set_data(loop_: *mut Loop, data: *mut c_void);

    // errors
    pub fn uv_translate_sys_error(sys_errno: c_int) -> c_int;
    pub fn uv_strerror(err: c_int) -> *const c_char;
    pub fn uv_strerror_r(err: c_int, buf: *mut c_char, buflen: usize) -> *mut c_char;
    pub fn uv_err_name(err: c_int) -> *const c_char;
    pub fn uv_err_name_r(err: c_int, buf: *mut c_char, buflen: usize) -> *mut c_char;

    // handle/req
    pub fn uv_handle_size(type_: uv_handle_type) -> usize;
    pub fn uv_handle_get_type(handle: *const uv_handle_t) -> uv_handle_type;
    pub fn uv_handle_type_name(type_: uv_handle_type) -> *const c_char;
    pub fn uv_handle_get_data(handle: *const uv_handle_t) -> *mut c_void;
    pub fn uv_handle_get_loop(handle: *const uv_handle_t) -> *mut Loop;
    pub fn uv_handle_set_data(handle: *mut uv_handle_t, data: *mut c_void);
    pub fn uv_req_size(type_: uv_req_type) -> usize;
    pub fn uv_req_get_data(req: *const uv_req_t) -> *mut c_void;
    pub fn uv_req_set_data(req: *mut uv_req_t, data: *mut c_void);
    pub fn uv_req_get_type(req: *const uv_req_t) -> uv_req_type;
    pub fn uv_req_type_name(type_: uv_req_type) -> *const c_char;
    pub fn uv_is_active(handle: *const uv_handle_t) -> c_int;
    pub fn uv_walk(loop_: *mut Loop, walk_cb: uv_walk_cb, arg: *mut c_void);
    pub fn uv_print_all_handles(loop_: *mut Loop, stream: *mut FILE);
    pub fn uv_print_active_handles(loop_: *mut Loop, stream: *mut FILE);
    pub fn uv_close(handle: *mut uv_handle_t, close_cb: uv_close_cb);
    pub fn uv_send_buffer_size(handle: *mut uv_handle_t, value: *mut c_int) -> c_int;
    pub fn uv_recv_buffer_size(handle: *mut uv_handle_t, value: *mut c_int) -> c_int;
    pub fn uv_fileno(handle: *const uv_handle_t, fd: *mut uv_os_fd_t) -> c_int;
    pub fn uv_buf_init(base: *mut c_char, len: c_uint) -> uv_buf_t;
    pub fn uv_pipe(fds: *mut [uv_file; 2], read_flags: c_int, write_flags: c_int) -> ReturnCode;
    pub fn uv_socketpair(
        type_: c_int,
        protocol: c_int,
        socket_vector: *mut uv_os_sock_t,
        flags0: c_int,
        flags1: c_int,
    ) -> ReturnCode;
    pub fn uv_is_closing(handle: *const uv_handle_t) -> c_int;
    pub fn uv_cancel(req: *mut uv_req_t) -> c_int;

    // stream
    pub fn uv_shutdown(
        req: *mut uv_shutdown_t,
        handle: *mut uv_stream_t,
        cb: uv_shutdown_cb,
    ) -> c_int;
    pub fn uv_stream_get_write_queue_size(stream: *const uv_stream_t) -> usize;
    pub fn uv_listen(stream: *mut uv_stream_t, backlog: c_int, cb: uv_connection_cb) -> ReturnCode;
    pub fn uv_accept(server: *mut uv_stream_t, client: *mut uv_stream_t) -> ReturnCode;
    pub fn uv_read_start(
        stream: *mut uv_stream_t,
        alloc_cb: uv_alloc_cb,
        read_cb: uv_read_cb,
    ) -> ReturnCode;
    pub fn uv_read_stop(stream: *mut uv_stream_t) -> ReturnCode;
    pub fn uv_write(
        req: *mut uv_write_t,
        handle: *mut uv_stream_t,
        bufs: *const uv_buf_t,
        nbufs: c_uint,
        cb: uv_write_cb,
    ) -> ReturnCode;
    pub fn uv_write2(
        req: *mut uv_write_t,
        handle: *mut uv_stream_t,
        bufs: *const uv_buf_t,
        nbufs: c_uint,
        send_handle: *mut uv_stream_t,
        cb: uv_write_cb,
    ) -> ReturnCode;
    pub fn uv_try_write(
        handle: *mut uv_stream_t,
        bufs: *const uv_buf_t,
        nbufs: c_uint,
    ) -> ReturnCode;
    pub fn uv_try_write2(
        handle: *mut uv_stream_t,
        bufs: *const uv_buf_t,
        nbufs: c_uint,
        send_handle: *mut uv_stream_t,
    ) -> c_int;
    pub fn uv_is_readable(handle: *const uv_stream_t) -> c_int;
    pub fn uv_is_writable(handle: *const uv_stream_t) -> c_int;
    pub fn uv_stream_set_blocking(handle: *mut uv_stream_t, blocking: c_int) -> ReturnCode;

    // tcp
    pub fn uv_tcp_init(loop_: *mut Loop, handle: *mut uv_tcp_t) -> c_int;
    pub fn uv_tcp_init_ex(loop_: *mut Loop, handle: *mut uv_tcp_t, flags: c_uint) -> c_int;
    pub fn uv_tcp_open(handle: *mut uv_tcp_t, sock: uv_os_sock_t) -> c_int;
    pub fn uv_tcp_nodelay(handle: *mut uv_tcp_t, enable: c_int) -> c_int;
    pub fn uv_tcp_keepalive(handle: *mut uv_tcp_t, enable: c_int, delay: c_uint) -> c_int;
    pub fn uv_tcp_simultaneous_accepts(handle: *mut uv_tcp_t, enable: c_int) -> c_int;
    pub fn uv_tcp_bind(handle: *mut uv_tcp_t, addr: *const sockaddr, flags: c_uint) -> c_int;
    pub fn uv_tcp_getsockname(
        handle: *const uv_tcp_t,
        name: *mut sockaddr,
        namelen: *mut c_int,
    ) -> c_int;
    pub fn uv_tcp_getpeername(
        handle: *const uv_tcp_t,
        name: *mut sockaddr,
        namelen: *mut c_int,
    ) -> c_int;
    pub fn uv_tcp_close_reset(handle: *mut uv_tcp_t, close_cb: uv_close_cb) -> c_int;
    pub fn uv_tcp_connect(
        req: *mut uv_connect_t,
        handle: *mut uv_tcp_t,
        addr: *const sockaddr,
        cb: uv_connect_cb,
    ) -> c_int;

    // udp
    pub fn uv_udp_init(loop_: *mut Loop, handle: *mut uv_udp_t) -> c_int;
    pub fn uv_udp_init_ex(loop_: *mut Loop, handle: *mut uv_udp_t, flags: c_uint) -> c_int;
    pub fn uv_udp_open(handle: *mut uv_udp_t, sock: uv_os_sock_t) -> c_int;
    pub fn uv_udp_bind(handle: *mut uv_udp_t, addr: *const sockaddr, flags: c_uint) -> c_int;
    pub fn uv_udp_connect(handle: *mut uv_udp_t, addr: *const sockaddr) -> c_int;
    pub fn uv_udp_getpeername(
        handle: *const uv_udp_t,
        name: *mut sockaddr,
        namelen: *mut c_int,
    ) -> c_int;
    pub fn uv_udp_getsockname(
        handle: *const uv_udp_t,
        name: *mut sockaddr,
        namelen: *mut c_int,
    ) -> c_int;
    pub fn uv_udp_set_membership(
        handle: *mut uv_udp_t,
        multicast_addr: *const c_char,
        interface_addr: *const c_char,
        membership: uv_membership,
    ) -> c_int;
    pub fn uv_udp_set_source_membership(
        handle: *mut uv_udp_t,
        multicast_addr: *const c_char,
        interface_addr: *const c_char,
        source_addr: *const c_char,
        membership: uv_membership,
    ) -> c_int;
    pub fn uv_udp_set_multicast_loop(handle: *mut uv_udp_t, on: c_int) -> c_int;
    pub fn uv_udp_set_multicast_ttl(handle: *mut uv_udp_t, ttl: c_int) -> c_int;
    pub fn uv_udp_set_multicast_interface(
        handle: *mut uv_udp_t,
        interface_addr: *const c_char,
    ) -> c_int;
    pub fn uv_udp_set_broadcast(handle: *mut uv_udp_t, on: c_int) -> c_int;
    pub fn uv_udp_set_ttl(handle: *mut uv_udp_t, ttl: c_int) -> c_int;
    pub fn uv_udp_send(
        req: *mut uv_udp_send_t,
        handle: *mut uv_udp_t,
        bufs: *const uv_buf_t,
        nbufs: c_uint,
        addr: *const sockaddr,
        send_cb: uv_udp_send_cb,
    ) -> c_int;
    pub fn uv_udp_try_send(
        handle: *mut uv_udp_t,
        bufs: *const uv_buf_t,
        nbufs: c_uint,
        addr: *const sockaddr,
    ) -> c_int;
    pub fn uv_udp_recv_start(
        handle: *mut uv_udp_t,
        alloc_cb: uv_alloc_cb,
        recv_cb: uv_udp_recv_cb,
    ) -> c_int;
    pub fn uv_udp_using_recvmmsg(handle: *const uv_udp_t) -> c_int;
    pub fn uv_udp_recv_stop(handle: *mut uv_udp_t) -> c_int;
    pub fn uv_udp_get_send_queue_size(handle: *const uv_udp_t) -> usize;
    pub fn uv_udp_get_send_queue_count(handle: *const uv_udp_t) -> usize;

    // tty
    pub fn uv_tty_init(
        loop_: *mut Loop,
        handle: *mut uv_tty_t,
        fd: uv_file,
        readable: c_int,
    ) -> ReturnCode;
    pub fn uv_tty_set_mode(handle: *mut uv_tty_t, mode: uv_tty_mode_t) -> ReturnCode;
    pub fn uv_tty_reset_mode() -> c_int;
    pub fn uv_tty_get_winsize(
        handle: *mut uv_tty_t,
        width: *mut c_int,
        height: *mut c_int,
    ) -> c_int;
    pub fn uv_tty_set_vterm_state(state: uv_tty_vtermstate_t);
    pub fn uv_tty_get_vterm_state(state: *mut uv_tty_vtermstate_t) -> c_int;
    /// Raw `uv_guess_handle`. Declared `-> c_int` (not [`HandleType`]) because
    /// returning a `#[repr(C)]` enum from a `safe extern fn` is a soundness
    /// hole: any out-of-range discriminant (e.g. `UV_HANDLE_TYPE_MAX = 18`, or
    /// a future libuv variant) would be instant UB with no `unsafe` at the call
    /// site. The range-checked safe wrapper is [`uv_guess_handle`].
    #[link_name = "uv_guess_handle"]
    pub safe fn uv_guess_handle_raw(file: uv_file) -> c_int;

    // pipe
    pub fn uv_pipe_init(loop_: *mut Loop, handle: *mut Pipe, ipc: c_int) -> ReturnCode;
    pub fn uv_pipe_open(handle: *mut Pipe, file: uv_file) -> ReturnCode;
    pub fn uv_pipe_bind(handle: *mut Pipe, name: *const c_char) -> c_int;
    pub fn uv_pipe_bind2(
        handle: *mut Pipe,
        name: *const u8,
        namelen: usize,
        flags: c_uint,
    ) -> ReturnCode;
    pub fn uv_pipe_connect(
        req: *mut uv_connect_t,
        handle: *mut Pipe,
        name: *const c_char,
        cb: uv_connect_cb,
    );
    pub fn uv_pipe_connect2(
        req: *mut uv_connect_t,
        handle: *mut Pipe,
        name: *const u8,
        namelen: usize,
        flags: c_uint,
        cb: uv_connect_cb,
    ) -> ReturnCode;
    pub fn uv_pipe_getsockname(handle: *const Pipe, buffer: *mut c_char, size: *mut usize)
    -> c_int;
    pub fn uv_pipe_getpeername(handle: *const Pipe, buffer: *mut c_char, size: *mut usize)
    -> c_int;
    pub fn uv_pipe_pending_instances(handle: *mut Pipe, count: c_int);
    pub fn uv_pipe_pending_count(handle: *mut Pipe) -> c_int;
    pub fn uv_pipe_pending_type(handle: *mut Pipe) -> uv_handle_type;
    pub fn uv_pipe_chmod(handle: *mut Pipe, flags: c_int) -> c_int;

    // poll
    pub fn uv_poll_init(loop_: *mut Loop, handle: *mut uv_poll_t, fd: c_int) -> c_int;
    pub fn uv_poll_init_socket(
        loop_: *mut Loop,
        handle: *mut uv_poll_t,
        socket: uv_os_sock_t,
    ) -> c_int;
    pub fn uv_poll_start(handle: *mut uv_poll_t, events: c_int, cb: uv_poll_cb) -> c_int;
    pub fn uv_poll_stop(handle: *mut uv_poll_t) -> c_int;

    // prepare/check/idle/async
    pub fn uv_prepare_init(loop_: *mut Loop, prepare: *mut uv_prepare_t) -> c_int;
    pub fn uv_prepare_start(prepare: *mut uv_prepare_t, cb: uv_prepare_cb) -> c_int;
    pub fn uv_prepare_stop(prepare: *mut uv_prepare_t) -> c_int;
    pub fn uv_check_init(loop_: *mut Loop, check: *mut uv_check_t) -> c_int;
    pub fn uv_check_start(check: *mut uv_check_t, cb: uv_check_cb) -> c_int;
    pub fn uv_check_stop(check: *mut uv_check_t) -> c_int;
    pub fn uv_idle_init(loop_: *mut Loop, idle: *mut uv_idle_t) -> c_int;
    pub fn uv_idle_start(idle: *mut uv_idle_t, cb: uv_idle_cb) -> c_int;
    pub fn uv_idle_stop(idle: *mut uv_idle_t) -> c_int;
    pub fn uv_async_init(loop_: *mut Loop, async_: *mut uv_async_t, async_cb: uv_async_cb)
    -> c_int;
    pub fn uv_async_send(async_: *mut uv_async_t) -> c_int;

    // timer
    pub fn uv_timer_init(loop_: *mut Loop, handle: *mut Timer) -> c_int;
    pub fn uv_timer_start(handle: *mut Timer, cb: uv_timer_cb, timeout: u64, repeat: u64) -> c_int;
    pub fn uv_timer_stop(handle: *mut Timer) -> c_int;
    pub fn uv_timer_again(handle: *mut Timer) -> c_int;
    pub fn uv_timer_set_repeat(handle: *mut Timer, repeat: u64);
    pub fn uv_timer_get_repeat(handle: *const Timer) -> u64;
    pub fn uv_timer_get_due_in(handle: *const Timer) -> u64;

    // dns
    pub fn uv_getaddrinfo(
        loop_: *mut Loop,
        req: *mut uv_getaddrinfo_t,
        getaddrinfo_cb: uv_getaddrinfo_cb,
        node: *const c_char,
        service: *const c_char,
        hints: *const c_void,
    ) -> ReturnCode;
    pub fn uv_freeaddrinfo(ai: *mut c_void);
    pub fn uv_getnameinfo(
        loop_: *mut Loop,
        req: *mut uv_getnameinfo_t,
        getnameinfo_cb: uv_getnameinfo_cb,
        addr: *const sockaddr,
        flags: c_int,
    ) -> c_int;

    // process
    pub fn uv_spawn(
        loop_: *mut Loop,
        handle: *mut Process,
        options: *const uv_process_options_t,
    ) -> ReturnCode;
    pub fn uv_process_kill(handle: *mut Process, signum: c_int) -> ReturnCode;
    pub fn uv_kill(pid: c_int, signum: c_int) -> ReturnCode;
    pub fn uv_process_get_pid(handle: *const Process) -> uv_pid_t;
    pub fn uv_queue_work(
        loop_: *mut Loop,
        req: *mut uv_work_t,
        work_cb: uv_work_cb,
        after_work_cb: uv_after_work_cb,
    ) -> c_int;

    // misc
    pub fn uv_setup_args(argc: c_int, argv: *mut *mut c_char) -> *mut *mut c_char;
    pub fn uv_get_process_title(buffer: *mut c_char, size: usize) -> c_int;
    pub fn uv_set_process_title(title: *const c_char) -> c_int;
    pub fn uv_resident_set_memory(rss: *mut usize) -> c_int;
    pub fn uv_uptime(uptime: *mut f64) -> c_int;
    pub fn uv_getrusage(rusage: *mut uv_rusage_t) -> c_int;
    pub fn uv_os_homedir(buffer: *mut u8, size: *mut usize) -> ReturnCode;
    pub fn uv_os_tmpdir(buffer: *mut u8, size: *mut usize) -> c_int;
    pub fn uv_os_get_passwd(pwd: *mut uv_passwd_t) -> c_int;
    pub fn uv_os_free_passwd(pwd: *mut uv_passwd_t);
    pub fn uv_os_get_passwd2(pwd: *mut uv_passwd_t, uid: uv_uid_t) -> c_int;
    pub fn uv_os_get_group(grp: *mut uv_group_t, gid: uv_uid_t) -> c_int;
    pub fn uv_os_free_group(grp: *mut uv_group_t);
    pub fn uv_os_getpid() -> uv_pid_t;
    pub fn uv_os_getppid() -> uv_pid_t;
    pub fn uv_os_getpriority(pid: uv_pid_t, priority: *mut c_int) -> c_int;
    pub fn uv_os_setpriority(pid: uv_pid_t, priority: c_int) -> c_int;
    pub fn uv_available_parallelism() -> c_uint;
    pub fn uv_cpu_info(cpu_infos: *mut *mut uv_cpu_info_t, count: *mut c_int) -> c_int;
    pub fn uv_free_cpu_info(cpu_infos: *mut uv_cpu_info_t, count: c_int);
    pub fn uv_cpumask_size() -> c_int;
    pub fn uv_interface_addresses(
        addresses: *mut *mut uv_interface_address_t,
        count: *mut c_int,
    ) -> c_int;
    pub fn uv_free_interface_addresses(addresses: *mut uv_interface_address_t, count: c_int);
    pub fn uv_os_environ(envitems: *mut *mut uv_env_item_t, count: *mut c_int) -> c_int;
    pub fn uv_os_free_environ(envitems: *mut uv_env_item_t, count: c_int);
    pub fn uv_os_getenv(name: *const c_char, buffer: *mut c_char, size: *mut usize) -> c_int;
    pub fn uv_os_setenv(name: *const c_char, value: *const c_char) -> c_int;
    pub fn uv_os_unsetenv(name: *const c_char) -> c_int;
    pub fn uv_os_gethostname(buffer: *mut c_char, size: *mut usize) -> c_int;
    pub fn uv_os_uname(buffer: *mut uv_utsname_t) -> c_int;
    pub fn uv_metrics_info(loop_: *mut Loop, metrics: *mut uv_metrics_t) -> c_int;
    pub fn uv_metrics_idle_time(loop_: *mut Loop) -> u64;

    // fs
    pub fn uv_fs_get_type(req: *const fs_t) -> uv_fs_type;
    pub fn uv_fs_get_result(req: *const fs_t) -> isize;
    pub fn uv_fs_get_system_error(req: *const fs_t) -> c_int;
    pub fn uv_fs_get_ptr(req: *const fs_t) -> *mut c_void;
    pub fn uv_fs_get_path(req: *const fs_t) -> *const c_char;
    pub fn uv_fs_get_statbuf(req: *mut fs_t) -> *mut uv_stat_t;
    pub fn uv_fs_req_cleanup(req: *mut fs_t);
    pub fn uv_fs_close(loop_: *mut Loop, req: *mut fs_t, file: uv_file, cb: uv_fs_cb)
    -> ReturnCode;
    pub fn uv_fs_open(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        flags: c_int,
        mode: c_int,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_read(
        loop_: *mut Loop,
        req: *mut fs_t,
        file: uv_file,
        bufs: *const uv_buf_t,
        nbufs: c_uint,
        offset: i64,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_unlink(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_write(
        loop_: *mut Loop,
        req: *mut fs_t,
        file: uv_file,
        bufs: *const uv_buf_t,
        nbufs: c_uint,
        offset: i64,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_copyfile(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        new_path: *const c_char,
        flags: c_int,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_mkdir(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        mode: c_int,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_mkdtemp(
        loop_: *mut Loop,
        req: *mut fs_t,
        tpl: *const c_char,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_mkstemp(
        loop_: *mut Loop,
        req: *mut fs_t,
        tpl: *const c_char,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_rmdir(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_scandir(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        flags: c_int,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_scandir_next(req: *mut fs_t, ent: *mut uv_dirent_t) -> ReturnCode;
    pub fn uv_fs_opendir(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_readdir(
        loop_: *mut Loop,
        req: *mut fs_t,
        dir: *mut uv_dir_t,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_closedir(
        loop_: *mut Loop,
        req: *mut fs_t,
        dir: *mut uv_dir_t,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_stat(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_fstat(loop_: *mut Loop, req: *mut fs_t, file: uv_file, cb: uv_fs_cb)
    -> ReturnCode;
    pub fn uv_fs_rename(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        new_path: *const c_char,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_fsync(loop_: *mut Loop, req: *mut fs_t, file: uv_file, cb: uv_fs_cb)
    -> ReturnCode;
    pub fn uv_fs_fdatasync(
        loop_: *mut Loop,
        req: *mut fs_t,
        file: uv_file,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_ftruncate(
        loop_: *mut Loop,
        req: *mut fs_t,
        file: uv_file,
        offset: i64,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_sendfile(
        loop_: *mut Loop,
        req: *mut fs_t,
        out_fd: uv_file,
        in_fd: uv_file,
        in_offset: i64,
        length: usize,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_access(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        mode: c_int,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_chmod(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        mode: c_int,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_utime(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        atime: f64,
        mtime: f64,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_futime(
        loop_: *mut Loop,
        req: *mut fs_t,
        file: uv_file,
        atime: f64,
        mtime: f64,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_lutime(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        atime: f64,
        mtime: f64,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_lstat(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_link(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        new_path: *const c_char,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_symlink(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        new_path: *const c_char,
        flags: c_int,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_readlink(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_realpath(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_fchmod(
        loop_: *mut Loop,
        req: *mut fs_t,
        file: uv_file,
        mode: c_int,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_chown(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        uid: uv_uid_t,
        gid: uv_gid_t,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_fchown(
        loop_: *mut Loop,
        req: *mut fs_t,
        file: uv_file,
        uid: uv_uid_t,
        gid: uv_gid_t,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_lchown(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        uid: uv_uid_t,
        gid: uv_gid_t,
        cb: uv_fs_cb,
    ) -> ReturnCode;
    pub fn uv_fs_statfs(
        loop_: *mut Loop,
        req: *mut fs_t,
        path: *const c_char,
        cb: uv_fs_cb,
    ) -> ReturnCode;

    // fs_event / fs_poll / signal
    pub fn uv_fs_poll_init(loop_: *mut Loop, handle: *mut uv_fs_poll_t) -> c_int;
    pub fn uv_fs_poll_start(
        handle: *mut uv_fs_poll_t,
        poll_cb: uv_fs_poll_cb,
        path: *const c_char,
        interval: c_uint,
    ) -> c_int;
    pub fn uv_fs_poll_stop(handle: *mut uv_fs_poll_t) -> c_int;
    pub fn uv_fs_poll_getpath(
        handle: *mut uv_fs_poll_t,
        buffer: *mut c_char,
        size: *mut usize,
    ) -> c_int;
    pub fn uv_signal_init(loop_: *mut Loop, handle: *mut uv_signal_t) -> ReturnCode;
    pub fn uv_signal_start(
        handle: *mut uv_signal_t,
        signal_cb: uv_signal_cb,
        signum: c_int,
    ) -> ReturnCode;
    pub fn uv_signal_start_oneshot(
        handle: *mut uv_signal_t,
        signal_cb: uv_signal_cb,
        signum: c_int,
    ) -> ReturnCode;
    pub fn uv_signal_stop(handle: *mut uv_signal_t) -> ReturnCode;
    pub fn uv_loadavg(avg: *mut f64);
    pub fn uv_fs_event_init(loop_: *mut Loop, handle: *mut uv_fs_event_t) -> ReturnCode;
    pub fn uv_fs_event_start(
        handle: *mut uv_fs_event_t,
        cb: uv_fs_event_cb,
        path: *const c_char,
        flags: c_uint,
    ) -> ReturnCode;
    pub fn uv_fs_event_stop(handle: *mut uv_fs_event_t) -> c_int;
    pub fn uv_fs_event_getpath(
        handle: *mut uv_fs_event_t,
        buffer: *mut c_char,
        size: *mut usize,
    ) -> ReturnCode;

    // ip
    pub fn uv_ip4_addr(ip: *const c_char, port: c_int, addr: *mut sockaddr_in) -> c_int;
    pub fn uv_ip6_addr(ip: *const c_char, port: c_int, addr: *mut sockaddr_in6) -> c_int;
    pub fn uv_ip4_name(src: *const sockaddr_in, dst: *mut c_char, size: usize) -> c_int;
    pub fn uv_ip6_name(src: *const sockaddr_in6, dst: *mut c_char, size: usize) -> c_int;
    pub fn uv_ip_name(src: *const sockaddr, dst: *mut c_char, size: usize) -> c_int;
    pub fn uv_inet_ntop(af: c_int, src: *const c_void, dst: *mut c_char, size: usize) -> c_int;
    pub fn uv_inet_pton(af: c_int, src: *const c_char, dst: *mut c_void) -> c_int;
    pub fn uv_random(
        loop_: *mut Loop,
        req: *mut uv_random_t,
        buf: *mut c_void,
        buflen: usize,
        flags: c_uint,
        cb: uv_random_cb,
    ) -> c_int;
    pub fn uv_if_indextoname(ifindex: c_uint, buffer: *mut c_char, size: *mut usize) -> c_int;
    pub fn uv_if_indextoiid(ifindex: c_uint, buffer: *mut c_char, size: *mut usize) -> c_int;
    pub fn uv_exepath(buffer: *mut c_char, size: *mut usize) -> c_int;
    pub fn uv_cwd(buffer: *mut c_char, size: *mut usize) -> c_int;
    pub fn uv_chdir(dir: *const c_char) -> c_int;
    pub fn uv_get_free_memory() -> u64;
    pub fn uv_get_total_memory() -> u64;
    pub fn uv_get_constrained_memory() -> u64;
    pub fn uv_get_available_memory() -> u64;
    pub fn uv_clock_gettime(clock_id: uv_clock_id, ts: *mut uv_timespec64_t) -> c_int;
    pub fn uv_hrtime() -> u64;
    pub fn uv_sleep(msec: c_uint);
    pub fn uv_disable_stdio_inheritance();
    pub fn uv_dlopen(filename: *const c_char, lib: *mut uv_lib_t) -> c_int;
    pub fn uv_dlclose(lib: *mut uv_lib_t);
    pub fn uv_dlsym(lib: *mut uv_lib_t, name: *const c_char, ptr: *mut *mut c_void) -> c_int;
    pub fn uv_dlerror(lib: *const uv_lib_t) -> *const c_char;

    // threading
    pub fn uv_once(guard: *mut uv_once_t, callback: Option<unsafe extern "C" fn()>);
    pub fn uv_key_create(key: *mut uv_key_t) -> c_int;
    pub fn uv_key_delete(key: *mut uv_key_t);
    pub fn uv_key_get(key: *mut uv_key_t) -> *mut c_void;
    pub fn uv_key_set(key: *mut uv_key_t, value: *mut c_void);
    pub fn uv_gettimeofday(tv: *mut uv_timeval64_t) -> c_int;
    pub fn uv_thread_create(tid: *mut uv_thread_t, entry: uv_thread_cb, arg: *mut c_void) -> c_int;
    pub fn uv_thread_create_ex(
        tid: *mut uv_thread_t,
        params: *const uv_thread_options_t,
        entry: uv_thread_cb,
        arg: *mut c_void,
    ) -> c_int;
    pub fn uv_thread_setaffinity(
        tid: *mut uv_thread_t,
        cpumask: *mut c_char,
        oldmask: *mut c_char,
        mask_size: usize,
    ) -> c_int;
    pub fn uv_thread_getaffinity(
        tid: *mut uv_thread_t,
        cpumask: *mut c_char,
        mask_size: usize,
    ) -> c_int;
    pub fn uv_thread_getcpu() -> c_int;
    pub fn uv_thread_self() -> uv_thread_t;
    pub fn uv_thread_join(tid: *mut uv_thread_t) -> c_int;
    pub fn uv_thread_equal(t1: *const uv_thread_t, t2: *const uv_thread_t) -> c_int;
}

// ──────────────────────────────────────────────────────────────────────────
// Layout assertions (Windows x64).
//
// Authoritative `sizeof`s taken from a `cl.exe`-compiled probe against
// `vendor/libuv/include` (uv 1.51.0). If any of these fire, the field-order
// above has drifted from the C header.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(all(target_arch = "x86_64", target_os = "windows"))]
const _: () = {
    macro_rules! assert_size {
        ($t:ty, $n:expr) => {
            assert!(
                mem::size_of::<$t>() == $n,
                concat!("layout drift: sizeof(", stringify!($t), ")")
            );
        };
    }
    macro_rules! assert_offset {
        ($t:ty, $f:ident, $n:expr) => {
            assert!(
                mem::offset_of!($t, $f) == $n,
                concat!(
                    "layout drift: offsetof(",
                    stringify!($t),
                    ".",
                    stringify!($f),
                    ")"
                )
            );
        };
    }

    // Win32 primitives.
    assert_size!(OVERLAPPED, 32);
    assert_size!(CRITICAL_SECTION, 40);
    assert_size!(INPUT_RECORD, 20);
    assert_size!(WIN32_FIND_DATAW, 592);
    assert_size!(sockaddr_storage, 128);
    assert_size!(sockaddr_in, 16);
    assert_size!(sockaddr_in6, 28);
    assert_size!(addrinfo, 48);

    // Platform-invariant uv types.
    assert_size!(uv_buf_t, 16);
    assert_size!(uv__queue, 16);
    assert_size!(uv__work, 40);
    assert_size!(uv_timespec_t, 8);
    assert_size!(uv_stat_t, 128);
    assert_size!(uv_statfs_t, 88);
    assert_size!(uv_utsname_t, 256 * 4);
    assert_size!(uv_rusage_t, 128);
    assert_size!(uv_cpu_info_t, 56);
    assert_size!(uv_interface_address_t, 80);

    // `UV_REQ_FIELDS` header — every req-derived struct shares this prefix,
    // so asserting `uv_req_t` and field offsets covers all of them.
    assert_size!(req_u, 40);
    assert_size!(uv_req_t, 112);
    assert_offset!(uv_req_t, data, 0);
    assert_offset!(uv_req_t, u, 64);
    assert_offset!(uv_req_t, next_req, 104);
    assert_size!(uv_read_t, 128);
    assert_size!(uv_shutdown_t, 128);
    assert_size!(uv_connect_t, 128);
    assert_size!(uv_write_t, 176);
    assert_size!(uv_process_exit_t, 112);
    assert_size!(uv_udp_send_t, 128);

    // `UV_HANDLE_FIELDS` header.
    assert_size!(handle_u, 32);
    assert_size!(Handle, 96);
    assert_offset!(Handle, data, 0);
    assert_offset!(Handle, loop_, 8);
    assert_offset!(Handle, type_, 16);
    assert_offset!(Handle, close_cb, 24);
    assert_offset!(Handle, handle_queue, 32);
    assert_offset!(Handle, u, 48);
    assert_offset!(Handle, endgame_next, 80);
    assert_offset!(Handle, flags, 88);

    // `UV_STREAM_FIELDS` header.
    assert_size!(uv_stream_t, 272);
    assert_offset!(uv_stream_t, write_queue_size, 96);
    assert_offset!(uv_stream_t, alloc_cb, 104);
    assert_offset!(uv_stream_t, read_cb, 112);
    assert_offset!(uv_stream_t, reqs_pending, 120);
    assert_offset!(uv_stream_t, activecnt, 124);
    assert_offset!(uv_stream_t, read_req, 128);

    // Concrete handles. Sizes here are derived from the field list above; they
    // serve as a tripwire against accidental field reordering. (Full
    // cross-validation against `uv_handle_size()` happens at runtime in
    // debug builds via `bun_sys::windows::assert_uv_layout()`.)
    assert_size!(Timer, 160);
    assert_size!(uv_prepare_t, 120);
    assert_size!(uv_check_t, 120);
    assert_size!(uv_idle_t, 120);
    assert_size!(uv_async_t, 224);
    assert_size!(uv_fs_poll_t, 104);
    assert_offset!(Loop, active_handles, 8);
    assert_offset!(Loop, iocp, 56);
    assert_offset!(Loop, wq_async, 248);

    // Reqs with payload.
    assert_size!(uv_work_t, 176);
    assert_size!(fs_t, 456);
    assert_offset!(fs_t, fs_type, 112);
    assert_offset!(fs_t, loop_, 120);
    assert_offset!(fs_t, result, 136);
    assert_offset!(fs_t, ptr, 144);
    assert_offset!(fs_t, path, 152);
    assert_offset!(fs_t, statbuf, 160);
    assert_offset!(fs_t, work_req, 288);
    assert_offset!(fs_t, flags, 328);

    // `UvHandle` trait invariant: every implementor has `data` at offset 0.
    assert_offset!(Pipe, data, 0);
    assert_offset!(uv_tcp_t, data, 0);
    assert_offset!(uv_tty_t, data, 0);
    assert_offset!(Timer, data, 0);
    assert_offset!(uv_async_t, data, 0);
    assert_offset!(Process, data, 0);
    assert_offset!(uv_signal_t, data, 0);
    assert_offset!(uv_poll_t, data, 0);
    assert_offset!(uv_udp_t, data, 0);
};

// ported from: src/libuv_sys/libuv.zig
