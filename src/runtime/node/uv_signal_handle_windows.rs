//! Windows-only `uv_signal_t` lifecycle exported for `BunProcess.cpp`.
//! Lives under `runtime/` because `init` takes a `*JSGlobalObject` to reach
//! the VM's libuv loop; the rest of `sys/windows/` is JSC-free.

#[cfg(windows)]
use core::ffi::c_int;

#[cfg(windows)]
use bun_jsc::JSGlobalObject;
#[cfg(windows)]
use bun_sys::windows::libuv;

#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__UVSignalHandle__init(
    global: &JSGlobalObject,
    signal_num: i32,
    callback: unsafe extern "C" fn(sig: *mut libuv::uv_signal_t, num: c_int),
) -> *mut libuv::uv_signal_t {
    // SAFETY: uv_signal_t is #[repr(C)] POD; uv_signal_init fully initializes it below.
    let signal: *mut libuv::uv_signal_t =
        bun_core::heap::into_raw(Box::<libuv::uv_signal_t>::new_uninit()).cast();

    // SAFETY: `signal` is a freshly heap-allocated, properly aligned uv_signal_t and
    // `uv_loop()` returns the VM's live libuv loop.
    let mut rc = unsafe { libuv::uv_signal_init(global.bun_vm().uv_loop(), signal) };
    if rc.errno().is_some() {
        // SAFETY: `signal` was just allocated via heap::into_raw above and never handed out.
        drop(unsafe { bun_core::heap::take(signal) });
        return core::ptr::null_mut();
    }

    // SAFETY: `signal` was successfully initialized by uv_signal_init above.
    rc = unsafe { libuv::uv_signal_start(signal, Some(callback), signal_num) };
    if rc.errno().is_some() {
        // SAFETY: `signal` is an initialized handle; uv_close will invoke the cb once
        // the handle is fully closed, at which point we free the allocation.
        unsafe { libuv::uv_close(signal.cast(), Some(free_with_default_allocator)) };
        return core::ptr::null_mut();
    }

    // SAFETY: `signal` is an active, initialized handle.
    unsafe { libuv::uv_unref(signal.cast()) };

    signal
}

#[cfg(windows)]
extern "C" fn free_with_default_allocator(handle: *mut libuv::uv_handle_t) {
    // Body discharges its own precondition; safe `extern "C" fn` coerces to
    // libuv's `uv_close_cb` pointer type.
    // SAFETY: `handle` was allocated via heap::into_raw(Box<uv_signal_t>) in
    // Bun__UVSignalHandle__init; uv_close guarantees the handle is no longer in use.
    drop(unsafe { bun_core::heap::take(handle.cast::<libuv::uv_signal_t>()) });
}

// C++ declaration (`BunProcess.cpp:1177`):
//   extern "C" uv_signal_t* Bun__UVSignalHandle__close(uv_signal_t*);
// The caller discards the return, but the Rust side must still match the
// signature — a `void`-vs-pointer return is an ABI mismatch (different
// register usage on Win64). Return null (handle is being torn down).
#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__UVSignalHandle__close(
    signal: *mut libuv::uv_signal_t,
) -> *mut libuv::uv_signal_t {
    // SAFETY: `signal` is a live handle previously returned by Bun__UVSignalHandle__init.
    let _ = unsafe { libuv::uv_signal_stop(signal) };
    // SAFETY: `signal` is an initialized handle; the close cb frees the backing allocation.
    unsafe { libuv::uv_close(signal.cast(), Some(free_with_default_allocator)) };
    core::ptr::null_mut()
}

// ported from: src/runtime/node/uv_signal_handle_windows.zig
