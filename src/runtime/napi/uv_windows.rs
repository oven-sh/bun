//! The `uv_*` functions that need no loop and call into the OS. uv-polyfills.c has the POSIX versions.

use core::ffi::{c_char, c_int, c_void};

use bun_core::{Timespec, TimespecMockMode};
use bun_sys::UV_E;
use bun_sys::windows::{self, BOOL, FALSE, HANDLE, TRUE, Win32ErrorExt};

bun_opaque::opaque_ffi! {
    /// `uv_mutex_t`.
    struct CriticalSection;
}

type InitOnce = *mut c_void;
type InitOnceFn = unsafe extern "system" fn(*mut InitOnce, *mut c_void, *mut *mut c_void) -> BOOL;
type UvOnceCb = unsafe extern "C" fn();

unsafe extern "system" {
    fn InitializeCriticalSection(section: *mut CriticalSection);
    fn DeleteCriticalSection(section: *mut CriticalSection);
    fn EnterCriticalSection(section: *mut CriticalSection);
    fn TryEnterCriticalSection(section: *mut CriticalSection) -> BOOL;
    fn LeaveCriticalSection(section: *mut CriticalSection);
    fn InitOnceExecuteOnce(
        once: *mut InitOnce,
        init: InitOnceFn,
        parameter: *mut c_void,
        context: *mut *mut c_void,
    ) -> BOOL;
}

/// Matches `uv_once_t`.
#[repr(C)]
struct UvOnce {
    unused: u8,
    init_once: InitOnce,
}

const _: () = assert!(core::mem::offset_of!(UvOnce, init_once) == 8);
const _: () = assert!(core::mem::size_of::<UvOnce>() == 16);
const _: () = assert!(
    UV_E::INVAL == 4071 && UV_E::BUSY == 4082 && UV_E::CANCELED == 4081 && UV_E::NOBUFS == 4060
);

/// SAFETY: `mutex` points to memory for a `uv_mutex_t` that is not initialized.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_mutex_init(mutex: *mut CriticalSection) -> c_int {
    // SAFETY: fn contract.
    unsafe { InitializeCriticalSection(mutex) };
    0
}

/// A critical section is always recursive.
///
/// SAFETY: same as [`uv_mutex_init`].
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_mutex_init_recursive(mutex: *mut CriticalSection) -> c_int {
    // SAFETY: fn contract.
    unsafe { uv_mutex_init(mutex) }
}

/// SAFETY: `mutex` is initialized, and no thread holds it or waits for it.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_mutex_destroy(mutex: *mut CriticalSection) {
    // SAFETY: fn contract.
    unsafe { DeleteCriticalSection(mutex) };
}

/// SAFETY: `mutex` is initialized.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_mutex_lock(mutex: *mut CriticalSection) {
    // SAFETY: fn contract.
    unsafe { EnterCriticalSection(mutex) };
}

/// SAFETY: `mutex` is initialized.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_mutex_trylock(mutex: *mut CriticalSection) -> c_int {
    // SAFETY: fn contract.
    if unsafe { TryEnterCriticalSection(mutex) } == FALSE {
        return -UV_E::BUSY;
    }
    0
}

/// SAFETY: this thread holds `mutex`.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_mutex_unlock(mutex: *mut CriticalSection) {
    // SAFETY: fn contract.
    unsafe { LeaveCriticalSection(mutex) };
}

/// SAFETY: `guard` started as `UV_ONCE_INIT`, and only this function has written it.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_once(guard: *mut UvOnce, mut callback: UvOnceCb) {
    unsafe extern "system" fn run(
        _: *mut InitOnce,
        callback: *mut c_void,
        _: *mut *mut c_void,
    ) -> BOOL {
        // SAFETY: points to the addon's callback in the frame of `uv_once`, which is below this one.
        unsafe { (*callback.cast::<UvOnceCb>())() };
        TRUE
    }
    // SAFETY: fn contract. It only fails if `run` does.
    unsafe {
        InitOnceExecuteOnce(
            &raw mut (*guard).init_once,
            run,
            (&raw mut callback).cast(),
            core::ptr::null_mut(),
        )
    };
}

/// Sets `*size` to the length without the NUL, or with it along with `UV_ENOBUFS`.
///
/// SAFETY: `buffer` points to `*size` writable bytes, unless a pointer is null.
#[unsafe(no_mangle)]
unsafe extern "C" fn uv_cwd(buffer: *mut c_char, size: Option<&mut usize>) -> c_int {
    let Some(size) = size.filter(|size| **size != 0 && !buffer.is_null()) else {
        return -UV_E::INVAL;
    };
    let mut wide = bun_paths::w_path_buffer_pool::get();
    let len = match windows::GetCurrentDirectoryW(&mut wide[..]) {
        Ok(len) => len,
        Err(err) => return bun_errno::e_to_uv(err.to_node_e()),
    };
    let mut cwd = bun_core::strings::wtf16_to_wtf8(&wide[..len]);
    // `C:` is not the root of the drive.
    if cwd.ends_with(b"\\") && !cwd.ends_with(b":\\") {
        cwd.pop();
    }
    if cwd.len() >= *size {
        *size = cwd.len() + 1;
        return -UV_E::NOBUFS;
    }
    *size = cwd.len();
    cwd.push(0);
    // SAFETY: fn contract, and `cwd` with its NUL fits.
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

/// An addon has a C runtime of its own, so it can't look up the fds that JS sees.
#[unsafe(no_mangle)]
extern "C" fn uv_get_osfhandle(fd: c_int) -> HANDLE {
    bun_core::Fd::from_crt(fd).native()
}

/// The fd owns `handle` from here on. Returns -1 on failure.
#[unsafe(no_mangle)]
extern "C" fn uv_open_osfhandle(handle: HANDLE) -> c_int {
    windows::open_osfhandle(handle)
}

#[unsafe(no_mangle)]
extern "C" fn uv_translate_sys_error(code: c_int) -> c_int {
    bun_errno::uv_translate_sys_error(code)
}
