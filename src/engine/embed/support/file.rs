use core::ffi::c_void;

use bun_sys::{Fd, File};

/// False if the file cannot be read.
///
/// # Safety
/// `path` has `length` bytes, and `receive` takes the context.
#[unsafe(no_mangle)]
unsafe extern "C" fn Support__readEntireFile(
    path: *const u8,
    length: usize,
    context: *mut c_void,
    receive: unsafe extern "C" fn(*mut c_void, *const u8, usize),
) -> bool {
    // SAFETY: the caller's.
    let path = unsafe { core::slice::from_raw_parts(path, length) };
    let Ok(contents) = File::read_from(Fd::cwd(), path) else {
        return false;
    };
    // SAFETY: the caller's.
    unsafe { receive(context, contents.as_ptr(), contents.len()) };
    true
}
