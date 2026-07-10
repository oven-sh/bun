//! Windows-only signal-watcher lifecycle exported for `BunProcess.cpp`.
//! Lives under `runtime/` because `init` takes a `*JSGlobalObject` to reach
//! the VM's event loop; the engine itself (`bun_iocp::signal`) is JSC-free.

#[cfg(windows)]
use core::ffi::{c_int, c_void};

#[cfg(windows)]
use bun_iocp::signal::SignalHandle;
#[cfg(windows)]
use bun_jsc::JSGlobalObject;

/// Opaque to C++: stored, passed back to close, and handed to the callback as
/// identity. The box must stay alive until the engine's close callback runs
/// (the endgame may still dereference the embedded handle until then).
#[cfg(windows)]
pub struct CSignalHandle {
    handle: Box<SignalHandle>,
    callback: unsafe extern "C" fn(*mut CSignalHandle, c_int),
}

/// Engine-side trampoline: recover the `CSignalHandle` from `data` and invoke
/// the C++ callback with the same (handle, signum) shape libuv used.
#[cfg(windows)]
unsafe fn on_signal(_lp: &mut bun_iocp::Loop, data: *mut c_void, signum: i32) {
    let this = data.cast::<CSignalHandle>();
    // SAFETY: `data` was set to the live, heap-pinned CSignalHandle in init;
    // close() tears the watcher down before the box is freed.
    unsafe { ((*this).callback)(this, signum) };
}

/// Close-phase finalizer: the engine guarantees this runs after any in-flight
/// completion, so dropping the box (and the embedded handle) is safe here.
#[cfg(windows)]
unsafe fn free_on_close(_lp: &mut bun_iocp::Loop, data: *mut c_void) {
    // SAFETY: `data` is the CSignalHandle allocated in init and never freed
    // elsewhere; this callback runs exactly once.
    drop(unsafe { Box::from_raw(data.cast::<CSignalHandle>()) });
}

#[cfg(windows)]
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__UVSignalHandle__init(
    global: &JSGlobalObject,
    signal_num: i32,
    callback: unsafe extern "C" fn(*mut CSignalHandle, c_int),
) -> *mut CSignalHandle {
    // SAFETY: the VM's loop is live for the VM lifetime, which strictly
    // contains every signal watcher's lifetime (close() runs at listener
    // removal or VM teardown).
    let lp = unsafe { bun_iocp::usockets::native_loop(global.bun_vm().platform_loop().cast()) };

    // SAFETY: `lp` is the live per-thread loop; the box pins the handle until
    // free_on_close.
    let handle = unsafe { SignalHandle::new(lp) };
    let this = bun_core::heap::into_raw(Box::new(CSignalHandle { handle, callback }));

    // SAFETY: `this` is live and heap-pinned; `on_signal` matches the engine
    // callback contract; repeating watch (one_shot = false) matches the libuv
    // behavior BunProcess.cpp was written against.
    let rc = unsafe {
        (*this)
            .handle
            .start(signal_num, false, on_signal, this.cast::<c_void>())
    };
    if rc.is_err() {
        // The handle is registered with the loop from new(); it must go
        // through close so the endgame frees the box.
        // SAFETY: `this` is live; free_on_close is its sole deallocation path.
        unsafe {
            (*this)
                .handle
                .close(Some(free_on_close), this.cast::<c_void>())
        };
        return core::ptr::null_mut();
    }

    // Signal watchers must not keep the process alive (Node parity).
    // SAFETY: `this` is live and started.
    unsafe { (*this).handle.unref() };

    this
}

// C++ declaration (`BunProcess.cpp`):
//   extern "C" uv_signal_t* Bun__UVSignalHandle__close(uv_signal_t*);
// The caller discards the return, but the signature must still match — a
// `void`-vs-pointer return is an ABI mismatch (different register usage on
// Win64). Return null (handle is being torn down).
#[cfg(windows)]
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__UVSignalHandle__close(
    signal: *mut CSignalHandle,
) -> *mut CSignalHandle {
    // SAFETY: `signal` is a live handle previously returned by init; close()
    // stops the watcher and schedules free_on_close exactly once.
    unsafe {
        (*signal)
            .handle
            .close(Some(free_on_close), signal.cast::<c_void>())
    };
    core::ptr::null_mut()
}
