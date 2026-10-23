//! Windows I/O Ring (`ioringapi.h`) backend for async `fs.read`/`fs.write`,
//! gated behind `BUN_FEATURE_FLAG_WINDOWS_IORING`. See `bench/ioring/` for the
//! measurements and the `FILE_FLAG_OVERLAPPED` caveat.
//!
//! Threading: the ring is owned by a single JS thread. Build/Submit/Pop happen
//! there; the completion `HANDLE` is bridged into the uv loop via
//! `RegisterWaitForSingleObject` -> `uv_async_send`, and CQEs are drained in
//! the `uv_async_cb` on that same thread.

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

/// Runtime-detected API table; `None` on unsupported OS or when the flag is off.
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
    b'K' as u16,
    b'e' as u16,
    b'r' as u16,
    b'n' as u16,
    b'e' as u16,
    b'l' as u16,
    b'B' as u16,
    b'a' as u16,
    b's' as u16,
    b'e' as u16,
    b'.' as u16,
    b'd' as u16,
    b'l' as u16,
    b'l' as u16,
    0,
];

// ──────────────────────────── per-thread ring ────────────────────────────

const SQ_SIZE: u32 = 512;
const CQ_SIZE: u32 = 1024;

/// One I/O ring bound to a single libuv loop thread. Process-lifetime; leaked
/// on first use. `UserData` on each submission is a `*mut uv::fs_t`; completion
/// writes `req.result` and calls `req.cb`, matching the `uv_fs_*` contract.
pub struct FsIoRing {
    api: &'static IoRingApi,
    ring: HIORING,
    inflight: u32,
    pending: u32,
    sq_size: u32,
    write_supported: bool,
    event: HANDLE,
    wait_handle: HANDLE,
    async_: *mut uv::uv_async_t,
    prepare: *mut uv::uv_prepare_t,
}

impl FsIoRing {
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
            pending: 0,
            sq_size: sq,
            write_supported,
            event,
            wait_handle: ptr::null_mut(),
            async_: ptr::null_mut(),
            prepare: ptr::null_mut(),
        });

        let async_ = Box::leak(Box::new(unsafe { core::mem::zeroed::<uv::uv_async_t>() }));
        async_.init(loop_, Some(Self::on_async));
        async_.data = (&mut *this as *mut Self).cast();
        // SAFETY: `async_` is live on `loop_`; unref so the ring alone never keeps the loop alive.
        unsafe { uv::uv_unref((async_ as *mut uv::uv_async_t).cast()) };
        this.async_ = async_;

        let prepare = Box::leak(Box::new(unsafe { core::mem::zeroed::<uv::uv_prepare_t>() }));
        // SAFETY: `prepare` is a stable heap allocation; `loop_` is live.
        unsafe {
            uv::uv_prepare_init(loop_, prepare);
            (*prepare).data = (&mut *this as *mut Self).cast();
            uv::uv_prepare_start(prepare, Some(Self::on_prepare));
            uv::uv_unref((prepare as *mut uv::uv_prepare_t).cast());
        }
        this.prepare = prepare;

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

    /// Queue a positional read. `req.cb` must be set. Returns `false` (caller
    /// falls back to libuv) on SQ-full, builder failure, or `offset < 0`
    /// (ioring has no current-position sentinel).
    pub fn submit_read(
        &mut self,
        handle: HANDLE,
        buf: *mut u8,
        len: u32,
        offset: i64,
        req: *mut uv::fs_t,
    ) -> bool {
        if offset < 0 {
            return false;
        }
        let user_data = req as usize;
        if self.inflight >= self.sq_size {
            self.flush();
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
        let off = offset as u64;
        // SAFETY: `ring` is live; handle/buffer are caller-provided and remain
        // valid until completion (guaranteed by the JS-side buffer protection).
        let hr = unsafe {
            (self.api.build_read)(self.ring, href, bref, len, off, user_data, IOSQE_FLAGS_NONE)
        };
        if hr != S_OK {
            bun_core::scoped_log!(ioring, "BuildIoRingReadFile failed: 0x{:08x}", hr);
            return false;
        }
        self.note_built();
        true
    }

    /// Queue a positional write; same `false` contract as `submit_read`.
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
        if !self.write_supported || offset < 0 {
            return false;
        }
        if self.inflight >= self.sq_size {
            self.flush();
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
        let off = offset as u64;
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
        self.note_built();
        true
    }

    #[inline]
    fn note_built(&mut self) {
        self.inflight += 1;
        self.pending += 1;
        if self.pending >= self.sq_size {
            self.flush();
        }
    }

    fn flush(&mut self) {
        if self.pending == 0 {
            return;
        }
        let mut sub = 0u32;
        // SAFETY: `ring` is live; `sub` is a valid out-param.
        let hr = unsafe { (self.api.submit)(self.ring, 0, 0, &mut sub) };
        bun_core::scoped_log!(ioring, "SubmitIoRing({}) hr=0x{:08x}", self.pending, hr);
        let _ = hr;
        self.pending = 0;
    }

    /// uv_prepare_cb: batch-submit SQEs built during the preceding JS tick.
    unsafe extern "C" fn on_prepare(p: *mut uv::uv_prepare_t) {
        // SAFETY: `data` was set to `*mut Self` in `new()`.
        let this = unsafe { &mut *((*p).data as *mut Self) };
        this.flush();
    }

    /// WAITORTIMERCALLBACK: off-thread; `uv_async_send` is the sole thread-safe uv entry point.
    unsafe extern "system" fn on_wait(ctx: *mut c_void, _timeout: u8) {
        // SAFETY: `ctx` is the `uv_async_t*` registered in `new()`.
        unsafe { uv::uv_async_send(ctx.cast()) };
    }

    /// uv_async_cb: drain CQEs, write `req.result`, call `req.cb` (JS thread).
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
            // ioring reports read-at-EOF as ERROR_HANDLE_EOF; map to 0 bytes like `ReadFile`/libuv.
            const HRESULT_HANDLE_EOF: HRESULT = 0x8007_0026u32 as HRESULT;
            let rc: i64 = if cqe.ResultCode == S_OK {
                cqe.Information as i64
            } else if cqe.ResultCode == HRESULT_HANDLE_EOF {
                0
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

/// Map an `HRESULT_FROM_WIN32`-shaped code to a libuv errno; anything else -> `UV_EIO`.
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

// ──────────────────────────── singleton access ───────────────────────────

static RING: AtomicPtr<FsIoRing> = AtomicPtr::new(ptr::null_mut());
static INIT: OnceLock<()> = OnceLock::new();

/// Lazy per-loop ring. Thread-affine: JS thread only.
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
