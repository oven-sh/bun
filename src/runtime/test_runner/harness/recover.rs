// Copyright © 2024 Dimitris Dinodimos.

//! Panic recover.
//! Regains control of the calling thread when the function panics or behaves
//! undefined.

use core::cell::Cell;

// TODO(port): move externs to <area>_sys crate

#[cfg(windows)]
type Context = bun_sys::windows::CONTEXT;
#[cfg(all(target_os = "linux", target_env = "musl"))]
type Context = musl::jmp_buf;
#[cfg(not(any(windows, all(target_os = "linux", target_env = "musl"))))]
type Context = libc::ucontext_t; // TODO(port): std.c.ucontext_t — confirm libc crate vs bun_sys::c

thread_local! {
    static TOP_CTX: Cell<Option<*const Context>> = const { Cell::new(None) };
}

/// RAII guard that restores `TOP_CTX` to a saved previous value on drop.
/// Replaces the Zig `defer top_ctx = prev_ctx;` in `call`/`call_for_test`.
struct TopCtxRestore {
    prev: Option<*const Context>,
}

impl Drop for TopCtxRestore {
    fn drop(&mut self) {
        TOP_CTX.with(|c| c.set(self.prev));
    }
}

/// Returns if there was no recover call in current thread.
/// Otherwise, does not return and execution continues from the current thread
/// recover call.
/// Call from root source file panic handler.
pub fn panicked() {
    if let Some(ctx) = TOP_CTX.with(|c| c.get()) {
        // SAFETY: ctx was set from a live stack frame in `call`/`call_for_test`
        // on this same thread; the pointee outlives this jump because the
        // setter's frame is where execution resumes.
        unsafe { set_context(ctx) };
    }
}

// PORT NOTE: Zig's `ExtErrType`/`ReturnType` were comptime @typeInfo helpers
// that extended the callee's error set with `error.Panic`. In Rust,
// `bun_core::Error` is a NonZeroU16 tag space that already covers every error
// name (including `Panic` via `bun_core::err!("Panic")`), so the type-level
// extension collapses and the helpers are dropped.

pub fn call_for_test(
    test_func: fn() -> Result<(), bun_core::Error>,
) -> Result<(), bun_core::Error> {
    let prev_ctx: Option<*const Context> = TOP_CTX.with(|c| c.get());
    // SAFETY: all-zero is a valid Context (CONTEXT / jmp_buf / ucontext_t are
    // #[repr(C)] POD with no NonNull/NonZero/enum fields).
    let mut ctx: Context = unsafe { core::mem::zeroed::<Context>() };
    // SAFETY: ctx is a valid, writable, properly-aligned Context on this stack.
    unsafe { get_context(&raw mut ctx) };
    if TOP_CTX.with(|c| c.get()) != prev_ctx {
        TOP_CTX.with(|c| c.set(prev_ctx));
        return Err(bun_core::err!("Panic"));
    }
    TOP_CTX.with(|c| c.set(Some(&raw const ctx)));
    let _guard = TopCtxRestore { prev: prev_ctx };
    test_func()
}

/// Calls `func`, guarding from runtime errors.
/// Returns `error.Panic` when recovers from runtime error.
/// Otherwise returns the return value of func.
// PORT NOTE: Zig signature was `call(func: anytype, args: anytype)` with
// `@call(.auto, func, args)`. Rust cannot forward an arbitrary heterogeneous
// argument tuple without variadics; callers should wrap the invocation in a
// closure. Return type uses bun_core::Error (see ExtErrType note above).
pub fn call<T>(
    func: impl FnOnce() -> Result<T, bun_core::Error>,
) -> Result<T, bun_core::Error> {
    let prev_ctx: Option<*const Context> = TOP_CTX.with(|c| c.get());
    // SAFETY: all-zero is a valid Context (CONTEXT / jmp_buf / ucontext_t are
    // #[repr(C)] POD with no NonNull/NonZero/enum fields).
    let mut ctx: Context = unsafe { core::mem::zeroed::<Context>() };
    // SAFETY: ctx is a valid, writable, properly-aligned Context on this stack.
    unsafe { get_context(&raw mut ctx) };
    if TOP_CTX.with(|c| c.get()) != prev_ctx {
        TOP_CTX.with(|c| c.set(prev_ctx));
        return Err(bun_core::err!("Panic"));
    }
    TOP_CTX.with(|c| c.set(Some(&raw const ctx)));
    let _guard = TopCtxRestore { prev: prev_ctx };
    func()
}

// windows
#[cfg(windows)]
unsafe extern "system" {
    // TODO(port): move to bun_sys::windows (ntdll)
    pub fn RtlRestoreContext(
        ContextRecord: *const CONTEXT,
        ExceptionRecord: *const EXCEPTION_RECORD, // nullable
    ) -> !;
}

// darwin, bsd, gnu linux
#[cfg(not(any(windows, all(target_os = "linux", target_env = "musl"))))]
unsafe extern "C" {
    pub fn setcontext(ucp: *const libc::ucontext_t) -> !;
}

// linux musl
#[cfg(all(target_os = "linux", target_env = "musl"))]
mod musl {
    use core::ffi::c_int;
    // TODO(port): Zig used @cImport(@cInclude("setjmp.h")).jmp_buf — confirm
    // exact musl jmp_buf size/align per target arch in Phase B. This is a
    // STACK VALUE (`var ctx = std.mem.zeroes(Context); setjmp(&ctx)`), not an
    // opaque handle, so it must reserve real storage — a ZST would let setjmp
    // scribble past the allocation. 32×u64 over-reserves vs every musl arch.
    #[repr(C, align(16))]
    pub struct jmp_buf {
        _buf: [u64; 32],
    }
    unsafe extern "C" {
        pub fn setjmp(env: *mut jmp_buf) -> c_int;
        pub fn longjmp(env: *const jmp_buf, val: c_int) -> !;
    }
}

#[inline(always)]
unsafe fn get_context(ctx: *mut Context) {
    #[cfg(windows)]
    {
        // TODO(port): std.os.windows.ntdll.RtlCaptureContext → bun_sys::windows::ntdll
        // SAFETY: ctx is a valid, writable, properly-aligned CONTEXT (caller contract).
        unsafe { bun_sys::windows::ntdll_context::RtlCaptureContext(ctx) };
    }
    #[cfg(all(target_os = "linux", target_env = "musl"))]
    {
        // SAFETY: ctx is a valid, writable, properly-aligned jmp_buf (caller contract).
        let _ = unsafe { musl::setjmp(ctx) };
    }
    #[cfg(not(any(windows, all(target_os = "linux", target_env = "musl"))))]
    {
        // Zig called std.debug.getContext(ctx) which wraps getcontext(3).
        // The `libc` crate omits the binding on Darwin and the BSDs; declare
        // locally (uniform across all unix targets).
        unsafe extern "C" { fn getcontext(ucp: *mut libc::ucontext_t) -> core::ffi::c_int; }
        // SAFETY: ctx is a valid, writable, properly-aligned ucontext_t (caller contract).
        let _ = unsafe { getcontext(ctx) };
    }
}

#[inline(always)]
unsafe fn set_context(ctx: *const Context) -> ! {
    #[cfg(windows)]
    {
        // SAFETY: ctx points to a Context previously filled by get_context on
        // this thread; the captured frame is still live (caller contract).
        unsafe { RtlRestoreContext(ctx, core::ptr::null()) };
    }
    #[cfg(all(target_os = "linux", target_env = "musl"))]
    {
        // SAFETY: ctx points to a jmp_buf previously filled by setjmp on this
        // thread; the captured frame is still live (caller contract).
        unsafe { musl::longjmp(ctx, 1) };
    }
    #[cfg(not(any(windows, all(target_os = "linux", target_env = "musl"))))]
    {
        // SAFETY: ctx points to a ucontext_t previously filled by getcontext on
        // this thread; the captured frame is still live (caller contract).
        unsafe { setcontext(ctx) };
    }
}

/// Panic handler that if there is a recover call in current thread continues
/// from recover call. Otherwise calls the default panic.
/// Install at root source file as `pub const panic = @import("recover").panic;`
// TODO(port): Zig exposed this as `std.debug.FullPanic(handler)` — a type
// installed at the root file as `pub const panic`. Rust has no equivalent
// declarative panic-handler slot; Phase B should wire this via
// `std::panic::set_hook` (or a `#[panic_handler]` in no_std) at startup.
pub fn panic(msg: &[u8], first_trace_addr: Option<usize>) -> ! {
    panicked();
    // TODO(port): std.debug.defaultPanic — route to bun_core's default panic.
    let _ = first_trace_addr;
    bun_core::Output::panic(format_args!("{}", bstr::BStr::new(msg)));
}

#[cfg(windows)]
use bun_sys::windows::{CONTEXT, EXCEPTION_RECORD};

// ported from: src/test_runner/harness/recover.zig
