//! `node:os` platform queries.

#[cfg(unix)]
use core::ffi::{c_char, c_int};

/// The effective user's home from the passwd database. `Ok(None)`: no entry. `Err`: the errno.
#[cfg(unix)]
pub fn passwd_home_dir() -> Result<Option<Vec<u8>>, c_int> {
    // Like libuv's uv__getpwuid_r: start with 4096 bytes, double on ERANGE.
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
