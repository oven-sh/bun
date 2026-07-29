//! Windows I/O Ring (`ioringapi.h`) backend for async file read/write.
//!
//! Exploratory: gated behind `BUN_FEATURE_FLAG_WINDOWS_IORING`. When enabled
//! and the OS supports IORING_VERSION_3 with real kernel backing (no user-mode
//! emulation), `node:fs` async `read`/`write` route through a per-thread ring
//! instead of the libuv threadpool.
//!
//! Integration model (single JS thread owns the ring; no cross-thread ring
//! access):
//!
//!   JS thread    BuildIoRing{Read,Write}File + SubmitIoRing
//!                      |
//!   kernel       completes ops, signals the completion HANDLE
//!                      |
//!   Win TP thread  RegisterWaitForSingleObject callback -> uv_async_send
//!                      |
//!   JS thread    uv_async_cb drains PopIoRingCompletion, dispatches each
//!                UserData back to the caller-supplied `complete` fn
//!
//! HRESULT from the CQE is mapped to a libuv errno via
//! `uv_translate_sys_error(HRESULT_CODE(hr))` so downstream error handling is
//! identical to the `uv_fs_*` path.
//!
//! The ring is *not* thread-safe; all builder/submit/pop calls happen on the
//! owning JS thread. The wait callback only touches the `uv_async_t` (which
//! `uv_async_send` documents as the sole thread-safe libuv entry point).
//!
//! Key behavioural note discovered during evaluation: when the file handle was
//! opened without `FILE_FLAG_OVERLAPPED` (the default for `uv_fs_open`), the
//! kernel processes the ring's submissions serially, which eliminates the
//! parallelism benefit and is slower than the threadpool for uncached reads.
//! See `bench/ioring/` for the measurements this module was built to gather.

#![cfg(windows)]
#![allow(non_snake_case, non_camel_case_types)]

use core::ffi::c_void;
use core::ptr;
use core::sync::atomic::{AtomicPtr, Ordering};
use std::sync::OnceLock;

use bun_libuv_sys as uv;
use bun_windows_sys::externs::{
    CloseHandle, GetProcAddress, HANDLE, INFINITE, RegisterWaitForSingleObject, WAITORTIMERCALLBACK,
};
use bun_windows_sys::kernel32;

use crate::{E, Error, Tag};

bun_core::declare_scope!(ioring, hidden);

// ──────────────────────────── FFI types (ioringapi.h / ntioring_x.h) ─────

pub type HIORING = *mut c_void;
type HRESULT = i32;

pub const IORING_VERSION_2: i32 = 2;
pub const IORING_VERSION_3: i32 = 300;

pub const IORING_FEATURE_UM_EMULATION: u32 = 0x0000_0001;
pub const IORING_FEATURE_SET_COMPLETION_EVENT: u32 = 0x0000_0002;

pub const IORING_OP_READ: u32 = 1;
pub const IORING_OP_WRITE: u32 = 5;

const IORING_REF_RAW: i32 = 0;
const IOSQE_FLAGS_NONE: i32 = 0;
const FILE_WRITE_FLAGS_NONE: u32 = 0;
const IORING_CREATE_SKIP_BUILDER_PARAM_CHECKS: u32 = 0x0000_0001;

const S_OK: HRESULT = 0;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct IORING_CREATE_FLAGS {
    Required: u32,
    Advisory: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct IORING_CAPABILITIES {
    pub MaxVersion: i32,
    pub MaxSubmissionQueueSize: u32,
    pub MaxCompletionQueueSize: u32,
    pub FeatureFlags: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct IORING_HANDLE_REF {
    Kind: i32,
    Handle: HANDLE,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct IORING_BUFFER_REF {
    Kind: i32,
    Buffer: *mut c_void,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct IORING_CQE {
    pub UserData: usize,
    pub ResultCode: HRESULT,
    pub Information: usize,
}

// ──────────────────────────── dynamic API table ──────────────────────────

type QueryIoRingCapabilities_t = unsafe extern "system" fn(*mut IORING_CAPABILITIES) -> HRESULT;
type CreateIoRing_t =
    unsafe extern "system" fn(i32, IORING_CREATE_FLAGS, u32, u32, *mut HIORING) -> HRESULT;
type CloseIoRing_t = unsafe extern "system" fn(HIORING) -> HRESULT;
type SubmitIoRing_t = unsafe extern "system" fn(HIORING, u32, u32, *mut u32) -> HRESULT;
type PopIoRingCompletion_t = unsafe extern "system" fn(HIORING, *mut IORING_CQE) -> HRESULT;
type SetIoRingCompletionEvent_t = unsafe extern "system" fn(HIORING, HANDLE) -> HRESULT;
type IsIoRingOpSupported_t = unsafe extern "system" fn(HIORING, u32) -> i32;
type BuildIoRingReadFile_t = unsafe extern "system" fn(
    HIORING,
    IORING_HANDLE_REF,
    IORING_BUFFER_REF,
    u32,
    u64,
    usize,
    i32,
) -> HRESULT;
type BuildIoRingWriteFile_t = unsafe extern "system" fn(
    HIORING,
    IORING_HANDLE_REF,
    IORING_BUFFER_REF,
    u32,
    u64,
    u32,
    usize,
    i32,
) -> HRESULT;

#[derive(Clone, Copy)]
pub struct IoRingApi {
    pub caps: IORING_CAPABILITIES,
    create: CreateIoRing_t,
    close: CloseIoRing_t,
    submit: SubmitIoRing_t,
    pop: PopIoRingCompletion_t,
    set_event: SetIoRingCompletionEvent_t,
    is_op: IsIoRingOpSupported_t,
    build_read: BuildIoRingReadFile_t,
    build_write: Option<BuildIoRingWriteFile_t>,
}

unsafe impl Send for IoRingApi {}
unsafe impl Sync for IoRingApi {}

/// Runtime-detected API table. `None` if:
/// - `BUN_FEATURE_FLAG_WINDOWS_IORING` is not set, or
/// - `QueryIoRingCapabilities` is absent (pre-Win11), or
/// - `MaxVersion < IORING_VERSION_2`, or
/// - `IORING_FEATURE_UM_EMULATION` is set (no kernel backing), or
/// - `IORING_FEATURE_SET_COMPLETION_EVENT` is absent.
pub fn api() -> Option<&'static IoRingApi> {
    static CELL: OnceLock<Option<IoRingApi>> = OnceLock::new();
    CELL.get_or_init(detect).as_ref()
}

fn detect() -> Option<IoRingApi> {
    if !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_WINDOWS_IORING::get().unwrap_or(false) {
        return None;
    }

    // SAFETY: KernelBase is always loaded in every Windows process.
    let kb = unsafe { kernel32::GetModuleHandleW(WCH_KERNELBASE.as_ptr()) };
    if kb.is_null() {
        return None;
    }

    macro_rules! sym {
        ($name:expr) => {{
            let p = GetProcAddress(kb.cast(), $name.as_ptr().cast());
            if p.is_null() {
                bun_core::scoped_log!(
                    ioring,
                    "missing symbol {}",
                    ::bstr::BStr::new(&$name[..$name.len() - 1])
                );
                return None;
            }
            p
        }};
    }
    macro_rules! sym_opt {
        ($name:expr) => {{
            let p = GetProcAddress(kb.cast(), $name.as_ptr().cast());
            if p.is_null() { None } else { Some(p) }
        }};
    }

    // SAFETY: transmute of a non-null code pointer to its matching fn-ptr type.
    let query: QueryIoRingCapabilities_t =
        unsafe { core::mem::transmute::<*mut c_void, _>(sym!(b"QueryIoRingCapabilities\0")) };
    let mut caps = IORING_CAPABILITIES::default();
    // SAFETY: out-param is a valid `IORING_CAPABILITIES`.
    if unsafe { query(&mut caps) } != S_OK {
        return None;
    }
    bun_core::scoped_log!(
        ioring,
        "caps: MaxVersion={} SQ={} CQ={} Features=0x{:x}",
        caps.MaxVersion,
        caps.MaxSubmissionQueueSize,
        caps.MaxCompletionQueueSize,
        caps.FeatureFlags,
    );
    if caps.MaxVersion < IORING_VERSION_2 {
        return None;
    }
    if caps.FeatureFlags & IORING_FEATURE_UM_EMULATION != 0 {
        return None;
    }
    if caps.FeatureFlags & IORING_FEATURE_SET_COMPLETION_EVENT == 0 {
        return None;
    }

    // SAFETY: transmute of non-null code pointers (verified by `sym!`) to
    // their matching signatures from `ioringapi.h`.
    unsafe {
        Some(IoRingApi {
            caps,
            create: core::mem::transmute::<*mut c_void, _>(sym!(b"CreateIoRing\0")),
            close: core::mem::transmute::<*mut c_void, _>(sym!(b"CloseIoRing\0")),
            submit: core::mem::transmute::<*mut c_void, _>(sym!(b"SubmitIoRing\0")),
            pop: core::mem::transmute::<*mut c_void, _>(sym!(b"PopIoRingCompletion\0")),
            set_event: core::mem::transmute::<*mut c_void, _>(sym!(b"SetIoRingCompletionEvent\0")),
            is_op: core::mem::transmute::<*mut c_void, _>(sym!(b"IsIoRingOpSupported\0")),
            build_read: core::mem::transmute::<*mut c_void, _>(sym!(b"BuildIoRingReadFile\0")),
            build_write: sym_opt!(b"BuildIoRingWriteFile\0")
                .map(|p| core::mem::transmute::<*mut c_void, _>(p)),
        })
    }
}

static WCH_KERNELBASE: &[u16] = &[
    b'K' as u16, b'e' as u16, b'r' as u16, b'n' as u16, b'e' as u16, b'l' as u16, b'B' as u16,
    b'a' as u16, b's' as u16, b'e' as u16, b'.' as u16, b'd' as u16, b'l' as u16, b'l' as u16, 0,
];

// ──────────────────────────── per-thread ring ────────────────────────────

/// Submission `UserData` is a `*mut uv::fs_t`. On completion the drained result
/// (bytes transferred, or a negative libuv errno) is written to `req.result`
/// and `req.cb` is invoked on the owning JS thread. This mirrors libuv's own
/// `uv_fs_*` completion contract so `UVFSRequest` can reuse its existing
/// `uv_callback` path for result dispatch.

const SQ_SIZE: u32 = 512;
const CQ_SIZE: u32 = 1024;

/// One I/O ring bound to a single libuv loop thread.
///
/// Heap-allocated and leaked on first use (process-lifetime singleton per JS
/// thread); `Drop` is provided for completeness but not relied upon for
/// correctness.
pub struct FsIoRing {
    api: &'static IoRingApi,
    ring: HIORING,
    inflight: u32,
    sq_size: u32,
    write_supported: bool,
    event: HANDLE,
    wait_handle: HANDLE,
    async_: *mut uv::uv_async_t,
}

impl FsIoRing {
    /// Create a ring bound to `loop_`. Returns `None` if any kernel call fails.
    /// Caller places the returned box at a stable address before use.
    fn new(api: &'static IoRingApi, loop_: *mut uv::Loop) -> Option<Box<Self>> {
        let version = if api.caps.MaxVersion >= IORING_VERSION_3 {
            IORING_VERSION_3
        } else {
            IORING_VERSION_2
        };
        let flags = IORING_CREATE_FLAGS {
            Required: 0,
            Advisory: IORING_CREATE_SKIP_BUILDER_PARAM_CHECKS,
        };
        let sq = SQ_SIZE.min(api.caps.MaxSubmissionQueueSize);
        let cq = CQ_SIZE.min(api.caps.MaxCompletionQueueSize);
        let mut ring: HIORING = ptr::null_mut();
        // SAFETY: out-param is valid; flags/sizes are within reported caps.
        let hr = unsafe { (api.create)(version, flags, sq, cq, &mut ring) };
        if hr != S_OK || ring.is_null() {
            bun_core::scoped_log!(ioring, "CreateIoRing failed: 0x{:08x}", hr);
            return None;
        }

        let write_supported = version >= IORING_VERSION_3
            && api.build_write.is_some()
            // SAFETY: `ring` is live.
            && unsafe { (api.is_op)(ring, IORING_OP_WRITE) } != 0;

        // SAFETY: auto-reset, unnamed; cannot fault on valid args.
        let event = unsafe { CreateEventW(ptr::null_mut(), 0, 0, ptr::null()) };
        if event.is_null() {
            // SAFETY: `ring` is live.
            unsafe { (api.close)(ring) };
            return None;
        }
        // SAFETY: `ring`/`event` are live.
        if unsafe { (api.set_event)(ring, event) } != S_OK {
            // SAFETY: both handles are live.
            unsafe {
                (api.close)(ring);
                CloseHandle(event);
            }
            return None;
        }

        let mut this = Box::new(Self {
            api,
            ring,
            inflight: 0,
            sq_size: sq,
            write_supported,
            event,
            wait_handle: ptr::null_mut(),
            async_: ptr::null_mut(),
        });

        // uv_async_t must live at a stable heap address for libuv.
        let async_ = Box::leak(Box::new(unsafe {
            core::mem::zeroed::<uv::uv_async_t>()
        }));
        async_.init(loop_, Some(Self::on_async));
        async_.data = (&mut *this as *mut Self).cast();
        // SAFETY: `async_` was just initialised on `loop_`; unreffing keeps the
        // loop from staying alive solely because a ring exists.
        unsafe { uv::uv_unref((async_ as *mut uv::uv_async_t).cast()) };
        this.async_ = async_;

        // SAFETY: `event` is a valid waitable handle; `on_wait` has the
        // WAITORTIMERCALLBACK ABI; `Context` is the `uv_async_t*` (stable).
        let ok = unsafe {
            RegisterWaitForSingleObject(
                &mut this.wait_handle,
                this.event,
                Self::on_wait,
                (this.async_ as *mut uv::uv_async_t).cast(),
                INFINITE,
                0,
            )
        };
        if ok == 0 {
            bun_core::scoped_log!(ioring, "RegisterWaitForSingleObject failed");
            return None;
        }

        bun_core::scoped_log!(
            ioring,
            "ring created: v{} sq={} cq={} write={}",
            version,
            sq,
            cq,
            write_supported
        );
        if std::env::var_os("BUN_DEBUG_IORING_TRACE").is_some() {
            eprintln!(
                "[ioring] ring created: v{} sq={} cq={} write={}",
                version, sq, cq, write_supported
            );
        }
        Some(this)
    }

    /// Submit a positional read. `offset < 0` means current file position.
    /// `req.cb` must be set; on completion `req.result` is written and `req.cb`
    /// is invoked on the JS thread. Returns `false` if the SQ is full or the
    /// builder rejected the entry; caller falls back to the libuv path.
    pub fn submit_read(
        &mut self,
        handle: HANDLE,
        buf: *mut u8,
        len: u32,
        offset: i64,
        req: *mut uv::fs_t,
    ) -> bool {
        let user_data = req as usize;
        if self.inflight >= self.sq_size {
            return false;
        }
        let href = IORING_HANDLE_REF {
            Kind: IORING_REF_RAW,
            Handle: handle,
        };
        let bref = IORING_BUFFER_REF {
            Kind: IORING_REF_RAW,
            Buffer: buf.cast(),
        };
        let off = if offset < 0 { u64::MAX } else { offset as u64 };
        // SAFETY: `ring` is live; handle/buffer are caller-provided and remain
        // valid until completion (guaranteed by the JS-side buffer protection).
        let hr = unsafe {
            (self.api.build_read)(self.ring, href, bref, len, off, user_data, IOSQE_FLAGS_NONE)
        };
        if hr != S_OK {
            bun_core::scoped_log!(ioring, "BuildIoRingReadFile failed: 0x{:08x}", hr);
            return false;
        }
        let mut sub = 0u32;
        // SAFETY: `ring` is live; `sub` is a valid out-param.
        let hr = unsafe { (self.api.submit)(self.ring, 0, 0, &mut sub) };
        if hr != S_OK {
            bun_core::scoped_log!(ioring, "SubmitIoRing failed: 0x{:08x}", hr);
            return false;
        }
        self.inflight += 1;
        true
    }

    /// Submit a positional write. See `submit_read` for the `false` contract.
    pub fn submit_write(
        &mut self,
        handle: HANDLE,
        buf: *const u8,
        len: u32,
        offset: i64,
        req: *mut uv::fs_t,
    ) -> bool {
        let user_data = req as usize;
        let Some(build_write) = self.api.build_write else {
            return false;
        };
        if !self.write_supported || self.inflight >= self.sq_size {
            return false;
        }
        let href = IORING_HANDLE_REF {
            Kind: IORING_REF_RAW,
            Handle: handle,
        };
        let bref = IORING_BUFFER_REF {
            Kind: IORING_REF_RAW,
            Buffer: buf as *mut c_void,
        };
        let off = if offset < 0 { u64::MAX } else { offset as u64 };
        // SAFETY: see `submit_read`.
        let hr = unsafe {
            build_write(
                self.ring,
                href,
                bref,
                len,
                off,
                FILE_WRITE_FLAGS_NONE,
                user_data,
                IOSQE_FLAGS_NONE,
            )
        };
        if hr != S_OK {
            return false;
        }
        let mut sub = 0u32;
        // SAFETY: `ring` is live.
        if unsafe { (self.api.submit)(self.ring, 0, 0, &mut sub) } != S_OK {
            return false;
        }
        self.inflight += 1;
        true
    }

    /// Windows thread-pool wait callback. Runs off the JS thread; touches only
    /// the `uv_async_t` (the one libuv entry point documented as thread-safe).
    unsafe extern "system" fn on_wait(ctx: *mut c_void, _timeout: u8) {
        // SAFETY: `ctx` is the `uv_async_t*` registered in `new()`.
        unsafe { uv::uv_async_send(ctx.cast()) };
    }

    /// Runs on the JS thread. Drains the CQ and invokes each `uv::fs_t`'s
    /// stored `cb` after writing the libuv-shaped result into `req.result`.
    unsafe extern "C" fn on_async(a: *mut uv::uv_async_t) {
        // SAFETY: `data` was set to `*mut Self` in `new()`.
        let this = unsafe { &mut *((*a).data as *mut Self) };
        let mut cqe = IORING_CQE::default();
        loop {
            // SAFETY: `ring` is live; `cqe` is a valid out-param.
            let hr = unsafe { (this.api.pop)(this.ring, &mut cqe) };
            if hr != S_OK {
                break;
            }
            this.inflight = this.inflight.saturating_sub(1);
            let req = cqe.UserData as *mut uv::fs_t;
            debug_assert!(!req.is_null());
            let rc: i64 = if cqe.ResultCode == S_OK {
                cqe.Information as i64
            } else {
                hresult_to_uv_err(cqe.ResultCode) as i64
            };
            // SAFETY: `req` is the live `uv::fs_t` pointer the caller passed to
            // `submit_*`; its backing task box outlives completion.
            unsafe {
                (*req).result = uv::ReturnCodeI64(rc);
                if let Some(cb) = (*req).cb {
                    cb(req);
                }
            }
        }
    }
}

impl Drop for FsIoRing {
    fn drop(&mut self) {
        // SAFETY: all handles were created in `new()` and are still owned here.
        unsafe {
            if !self.wait_handle.is_null() {
                UnregisterWaitEx(self.wait_handle, INVALID_HANDLE_VALUE);
            }
            if !self.ring.is_null() {
                (self.api.close)(self.ring);
            }
            if !self.event.is_null() {
                CloseHandle(self.event);
            }
        }
    }
}

/// `HRESULT_FROM_WIN32` has the shape `0x8007_xxxx`; extract the Win32 code and
/// map through libuv's table so the libuv-errno result matches the `uv_fs_*`
/// path exactly. Anything else maps to `UV_EIO`.
fn hresult_to_uv_err(hr: HRESULT) -> i32 {
    const UV_EIO: i32 = -4070;
    if (hr as u32 & 0xFFFF_0000) == 0x8007_0000 {
        let win32 = (hr & 0xFFFF) as i32;
        // SAFETY: pure function on a by-value int.
        let uv_err = unsafe { uv::uv_translate_sys_error(win32) };
        if uv_err < 0 { uv_err } else { UV_EIO }
    } else {
        UV_EIO
    }
}

// Keep the unused-import checker quiet for the error types documented above;
// they remain part of the public surface even though the hot path goes through
// the libuv-errno shape.
const _: fn() -> Error = || Error::new(E::EIO, Tag::read);

// ──────────────────────────── singleton access ───────────────────────────

/// Per-thread ring, leaked on first use. `None` when disabled/unsupported or
/// if creation fails; once `None` is observed it is never retried.
static RING: AtomicPtr<FsIoRing> = AtomicPtr::new(ptr::null_mut());
static INIT: OnceLock<()> = OnceLock::new();

/// Get or lazily create the ring for the current libuv loop. Thread-affine:
/// called from the JS thread only.
pub fn get(loop_: *mut uv::Loop) -> Option<&'static mut FsIoRing> {
    let p = RING.load(Ordering::Relaxed);
    if !p.is_null() {
        // SAFETY: set once below to a leaked Box; only the owning JS thread
        // calls this, so the `&mut` is unique.
        return Some(unsafe { &mut *p });
    }
    if INIT.get().is_some() {
        return None;
    }
    INIT.set(()).ok();
    let api = api()?;
    let ring = FsIoRing::new(api, loop_)?;
    let raw = Box::into_raw(ring);
    RING.store(raw, Ordering::Release);
    // SAFETY: just stored a live Box pointer.
    Some(unsafe { &mut *raw })
}

// ──────────────────────────── local externs ──────────────────────────────

const INVALID_HANDLE_VALUE: HANDLE = usize::MAX as HANDLE;

unsafe extern "system" {
    fn CreateEventW(attrs: *mut c_void, manual: i32, initial: i32, name: *const u16) -> HANDLE;
    fn UnregisterWaitEx(WaitHandle: HANDLE, CompletionEvent: HANDLE) -> i32;
}

// Ensure the signature referenced by `RegisterWaitForSingleObject` matches.
const _: WAITORTIMERCALLBACK = FsIoRing::on_wait;
