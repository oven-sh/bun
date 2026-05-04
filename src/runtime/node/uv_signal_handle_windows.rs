//! Windows-only `uv_signal_t` lifecycle exported for `BunProcess.cpp`.
//! Lives under `runtime/` because `init` takes a `*JSGlobalObject` to reach
//! the VM's libuv loop; the rest of `sys/windows/` is JSC-free.

#[cfg(windows)]
use core::ffi::{c_int, c_void};

#[cfg(windows)]
use bun_jsc::JSGlobalObject;
#[cfg(windows)]
use bun_sys::windows::libuv;

#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__UVSignalHandle__init(
    global: &JSGlobalObject,
    signal_num: i32,
    callback: extern "C" fn(sig: *mut libuv::uv_signal_t, num: c_int),
) -> *mut libuv::uv_signal_t {
    // SAFETY: uv_signal_t is #[repr(C)] POD; uv_signal_init fully initializes it below.
    let signal: *mut libuv::uv_signal_t =
        Box::into_raw(Box::<libuv::uv_signal_t>::new_uninit()).cast();

    let mut rc = libuv::uv_signal_init(global.bun_vm().uv_loop(), signal);
    if rc.errno().is_some() {
        // SAFETY: `signal` was just allocated via Box::into_raw above and never handed out.
        drop(unsafe { Box::from_raw(signal) });
        return core::ptr::null_mut();
    }

    rc = libuv::uv_signal_start(signal, callback, signal_num);
    if rc.errno().is_some() {
        libuv::uv_close(signal.cast(), free_with_default_allocator);
        return core::ptr::null_mut();
    }

    libuv::uv_unref(signal.cast());

    signal
}

#[cfg(windows)]
extern "C" fn free_with_default_allocator(signal: *mut c_void) {
    // SAFETY: `signal` was allocated via Box::into_raw(Box<uv_signal_t>) in
    // Bun__UVSignalHandle__init; uv_close guarantees the handle is no longer in use.
    drop(unsafe { Box::from_raw(signal.cast::<libuv::uv_signal_t>()) });
}

#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__UVSignalHandle__close(signal: *mut libuv::uv_signal_t) {
    let _ = libuv::uv_signal_stop(signal);
    libuv::uv_close(signal.cast(), free_with_default_allocator);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/uv_signal_handle_windows.zig (46 lines)
//   confidence: high
//   todos:      0
//   notes:      uv_close cb signature may need *mut uv_handle_t (not c_void) depending on bun_sys::windows::libuv binding shape
// ──────────────────────────────────────────────────────────────────────────
