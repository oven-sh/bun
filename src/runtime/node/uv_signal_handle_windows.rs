//! Windows-only `uv_signal_t` lifecycle exported for `BunProcess.cpp`.
//! Lives under `runtime/` because `init` takes a `*JSGlobalObject` to reach
//! the VM's libuv loop; the rest of `sys/windows/` is JSC-free.

use core::ffi::c_int;

use bun_jsc::JSGlobalObject;
use bun_sys::windows::libuv;

#[unsafe(no_mangle)]
extern "C" fn Bun__UVSignalHandle__init(
    global: &JSGlobalObject,
    signal_num: i32,
    callback: extern "C" fn(sig: *mut libuv::uv_signal_t, num: c_int),
) -> Option<libuv::Owned<libuv::uv_signal_t>> {
    let loop_ = global.bun_vm().uv_loop();
    let signal = libuv::uv_signal_t::start(loop_, signal_num, callback).ok()?;
    signal.unref();
    Some(signal)
}

// C++ declaration (`BunProcess.cpp:1177`):
//   extern "C" uv_signal_t* Bun__UVSignalHandle__close(uv_signal_t*);
// The caller discards the return, but the Rust side must still match the
// signature — a `void`-vs-pointer return is an ABI mismatch (different
// register usage on Win64). Return null (handle is being torn down).
#[unsafe(no_mangle)]
extern "C" fn Bun__UVSignalHandle__close(
    signal: libuv::Owned<libuv::uv_signal_t>,
) -> *mut libuv::uv_signal_t {
    drop(signal);
    core::ptr::null_mut()
}
