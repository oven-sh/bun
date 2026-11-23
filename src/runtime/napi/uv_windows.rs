//! The `uv_*` functions that call into the OS and need no loop. The POSIX versions are in uv-polyfills.c.

use core::ffi::{c_char, c_int, c_void};

use bun_core::{Timespec, TimespecMockMode};
use bun_sys::UV_E;
use bun_sys::windows::{self, BOOL, FALSE, HANDLE, TRUE, Win32ErrorExt};

bun_opaque::opaque_ffi! {
    /// `uv_mutex_t` on Windows.
    struct CRITICAL_SECTION;
}

#[repr(C)]
struct INIT_ONCE {
    Ptr: *mut c_void,
}

type PINIT_ONCE_FN =
    unsafe extern "system" fn(*mut INIT_ONCE, *mut c_void, *mut *mut c_void) -> BOOL;
type UvOnceCb = unsafe extern "C" fn();

unsafe extern "system" {
    fn InitializeCriticalSection(section: *mut CRITICAL_SECTION);
    fn DeleteCriticalSection(section: *mut CRITICAL_SECTION);
    fn EnterCriticalSection(section: *mut CRITICAL_SECTION);
    fn TryEnterCriticalSection(section: *mut CRITICAL_SECTION) -> BOOL;
    fn LeaveCriticalSection(section: *mut CRITICAL_SECTION);
    fn InitOnceExecuteOnce(
        once: *mut INIT_ONCE,
        init: PINIT_ONCE_FN,
        parameter: *mut c_void,
        context: *mut *mut c_void,
    ) -> BOOL;
}

/// Matches `uv_once_t`.
#[repr(C)]
struct UvOnce {
    unused: u8,
    init_once: INIT_ONCE,
}

const _: () = assert!(core::mem::offset_of!(UvOnce, init_once) == 8);
const _: () = assert!(core::mem::size_of::<UvOnce>() == 16);
const _: () = assert!(
    UV_E::INVAL == 4071 && UV_E::BUSY == 4082 && UV_E::CANCELED == 4081 && UV_E::NOBUFS == 4060
);

/// SAFETY: `mutex` points to memory for an uninitialized `uv_mutex_t`.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_mutex_init(mutex: *mut CRITICAL_SECTION) -> c_int {
    // SAFETY: fn contract.
    unsafe { InitializeCriticalSection(mutex) };
    0
}

/// A critical section is always recursive.
///
/// SAFETY: same as [`uv_mutex_init`].
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_mutex_init_recursive(mutex: *mut CRITICAL_SECTION) -> c_int {
    // SAFETY: fn contract.
    unsafe { uv_mutex_init(mutex) }
}

/// SAFETY: `mutex` is initialized, and no thread holds it or waits for it.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_mutex_destroy(mutex: *mut CRITICAL_SECTION) {
    // SAFETY: fn contract.
    unsafe { DeleteCriticalSection(mutex) };
}

/// SAFETY: `mutex` is initialized.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_mutex_lock(mutex: *mut CRITICAL_SECTION) {
    // SAFETY: fn contract.
    unsafe { EnterCriticalSection(mutex) };
}

/// SAFETY: `mutex` is initialized.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_mutex_trylock(mutex: *mut CRITICAL_SECTION) -> c_int {
    // SAFETY: fn contract.
    if unsafe { TryEnterCriticalSection(mutex) } == FALSE {
        return -UV_E::BUSY;
    }
    0
}

/// SAFETY: this thread holds `mutex`.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_mutex_unlock(mutex: *mut CRITICAL_SECTION) {
    // SAFETY: fn contract.
    unsafe { LeaveCriticalSection(mutex) };
}

/// SAFETY: `guard` was initialized to `UV_ONCE_INIT`, and only `uv_once` has written it since.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_once(guard: *mut UvOnce, mut callback: UvOnceCb) {
    unsafe extern "system" fn invoke_callback(
        _: *mut INIT_ONCE,
        callback: *mut c_void,
        _: *mut *mut c_void,
    ) -> BOOL {
        // SAFETY: points to the `callback` argument of `uv_once`, whose frame outlives this call.
        unsafe { (*callback.cast::<UvOnceCb>())() };
        TRUE
    }
    // SAFETY: fn contract. The call only fails if `invoke_callback` returns `FALSE`.
    unsafe {
        InitOnceExecuteOnce(
            &raw mut (*guard).init_once,
            invoke_callback,
            (&raw mut callback).cast(),
            core::ptr::null_mut(),
        )
    };
}

/// Sets `*size` to the length excluding the NUL, or on `UV_ENOBUFS` to the required size including it.
///
/// SAFETY: `buffer` points to `*size` writable bytes, unless a pointer is null.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_cwd(buffer: *mut c_char, size: Option<&mut usize>) -> c_int {
    let Some(size) = size.filter(|size| **size != 0 && !buffer.is_null()) else {
        return -UV_E::INVAL;
    };
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let len = match windows::GetCurrentDirectoryW(&mut wbuf[..]) {
        Ok(len) => len,
        Err(err) => return bun_errno::errno_to_uv(err.to_node_errno()),
    };
    let mut cwd = bun_core::strings::wtf16_to_wtf8(&wbuf[..len]);
    // A drive root keeps its separator, since `C:` is a drive-relative path.
    if cwd.ends_with(b"\\") && !cwd.ends_with(b":\\") {
        cwd.pop();
    }
    if cwd.len() >= *size {
        *size = cwd.len() + 1;
        return -UV_E::NOBUFS;
    }
    *size = cwd.len();
    cwd.push(0);
    // SAFETY: fn contract, and the check above leaves room for `cwd` and its NUL.
    unsafe { core::ptr::copy_nonoverlapping(cwd.as_ptr(), buffer.cast(), cwd.len()) };
    0
}

#[unsafe(no_mangle)]
extern "C" fn uv_os_getpid() -> c_int {
    windows::GetCurrentProcessId().cast_signed()
}

#[unsafe(no_mangle)]
extern "C" fn uv_os_getppid() -> c_int {
    windows::parent_process_id().map_or(-1, u32::cast_signed)
}

/// Same clock as `uv_now`.
#[unsafe(no_mangle)]
extern "C" fn uv_hrtime() -> u64 {
    Timespec::now(TimespecMockMode::ForceRealTime).ns()
}

/// An addon links its own C runtime, whose fd table is not the one that JS uses.
#[unsafe(no_mangle)]
extern "C" fn uv_get_osfhandle(fd: c_int) -> HANDLE {
    bun_core::Fd::from_crt(fd).native()
}

/// The returned fd owns `handle`. Returns -1 on failure.
#[unsafe(no_mangle)]
extern "C" fn uv_open_osfhandle(handle: HANDLE) -> c_int {
    windows::open_osfhandle(handle)
}

#[unsafe(no_mangle)]
extern "C" fn uv_translate_sys_error(code: c_int) -> c_int {
    bun_errno::uv_translate_sys_error(code)
}
