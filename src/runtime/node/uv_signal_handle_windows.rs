//! Windows-only `uv_signal_t` lifecycle exported for `BunProcess.cpp`.
//! Lives under `runtime/` because `init` takes a `*JSGlobalObject` to reach
//! the VM's libuv loop; the rest of `sys/windows/` is JSC-free.

use core::ffi::c_int;

use bun_jsc::JSGlobalObject;
use bun_sys::windows::libuv::{self, UvHandle as _};

#[unsafe(no_mangle)]
extern "C" fn Bun__UVSignalHandle__init(
    global: &JSGlobalObject,
    signal_num: i32,
    callback: unsafe extern "C" fn(sig: *mut libuv::uv_signal_t, num: c_int),
) -> *mut libuv::uv_signal_t {
    let mut signal = libuv::Owned::<libuv::uv_signal_t>::zeroed();

    // SAFETY: `signal` is a heap handle and `uv_loop()` returns the VM's live libuv loop.
    let failed = unsafe {
        libuv::uv_signal_init(global.bun_vm().uv_loop(), signal.as_ptr()).is_err()
            || libuv::uv_signal_start(signal.as_ptr(), Some(callback), signal_num).is_err()
    };
    if failed {
        return core::ptr::null_mut();
    }

    signal.unref();
    signal.into_raw()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__UVSignalHandle__close(signal: *mut libuv::uv_signal_t) {
    // SAFETY: `signal` is a live handle previously returned by Bun__UVSignalHandle__init.
    drop(unsafe { libuv::Owned::from_raw(signal) });
}
