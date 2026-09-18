//! `node:os` platform queries.

#[allow(unused_imports)]
use core::ffi::{c_char, c_int};

/// The effective user's home directory from the passwd database
/// (`getpwuid_r(geteuid())`). `Ok(None)`: no entry for this uid; an entry
/// with no `pw_dir` yields an empty path. `Err` is the errno `getpwuid_r`
/// returned.
#[cfg(unix)]
pub fn passwd_home_dir() -> Result<Option<Vec<u8>>, c_int> {
    // From libuv:
    // > Calling sysconf(_SC_GETPW_R_SIZE_MAX) would get the suggested size, but it
    // > is frequently 1024 or 4096, so we can just use that directly. The pwent
    // > will not usually be large.
    let mut stack = [0u8; 4096];
    let mut heap: Vec<u8>;
    let mut buf: &mut [u8] = &mut stack;
    let mut pw: libc::passwd = bun_core::ffi::zeroed();
    let mut result: *mut libc::passwd = core::ptr::null_mut();
    loop {
        // SAFETY: `pw`/`result` are stack out-params; `buf` is writable for `buf.len()`.
        let rc = unsafe {
            libc::getpwuid_r(
                libc::geteuid(),
                &raw mut pw,
                buf.as_mut_ptr().cast::<c_char>(),
                buf.len(),
                &raw mut result,
            )
        };
        if rc == libc::EINTR {
            continue;
        }
        if rc == libc::ERANGE {
            let len = buf.len();
            heap = vec![0u8; len * 2];
            buf = &mut heap;
            continue;
        }
        if rc != 0 {
            return Err(rc);
        }
        break;
    }
    if result.is_null() {
        return Ok(None);
    }
    if pw.pw_dir.is_null() {
        return Ok(Some(Vec::new()));
    }
    // SAFETY: on success `pw_dir` is a NUL-terminated string inside `buf`.
    Ok(Some(
        unsafe { core::ffi::CStr::from_ptr(pw.pw_dir) }
            .to_bytes()
            .to_vec(),
    ))
}
