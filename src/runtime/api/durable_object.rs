//! File system steps of `Bun.DurableObjectNamespace` storage (src/jsc/bindings/sqlite/DurableObjectStorage.cpp).

use bun_core::ZBox;

/// `mkdir -p`. 0, or the errno.
///
/// # Safety
/// `path` points at `len` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__DurableObject__makeDirectory(path: *const u8, len: usize) -> i32 {
    // SAFETY: per the fn contract.
    let path = unsafe { core::slice::from_raw_parts(path, len) };
    match bun_sys::mkdir_recursive(path) {
        Ok(()) => 0,
        Err(err) => err.get_errno() as i32,
    }
}

/// # Safety
/// `path` points at `len` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__DurableObject__removeFile(path: *const u8, len: usize) {
    // SAFETY: per the fn contract.
    let path = ZBox::from_bytes(unsafe { core::slice::from_raw_parts(path, len) });
    let _ = bun_sys::unlink(&path);
}
