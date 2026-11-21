//! The user that this process runs as.

use core::ptr;

use super::{BOOL, DWORD, HANDLE, Win32Error, Win32ErrorExt as _, check, getenv_w_allow_empty};
use crate::E;
use crate::windows_format::wide;

#[link(name = "userenv")]
unsafe extern "system" {
    fn GetUserProfileDirectoryW(
        hToken: HANDLE,
        lpProfileDir: *mut u16,
        lpcchSize: *mut DWORD,
    ) -> BOOL;
}

/// `GetCurrentProcessToken()`, which does not have to be opened or closed.
const CURRENT_PROCESS_TOKEN: HANDLE = ptr::without_provenance_mut(-4_isize as usize);

const MIN_PATH_BYTES: usize = "C:\\".len();

fn profile_directory() -> Result<Vec<u16>, Win32Error> {
    let mut buf = bun_paths::w_path_buffer_pool::get();
    let mut len = buf.len() as DWORD;
    buf[0] = 0;
    // SAFETY: it writes at most `len` units.
    check(unsafe {
        GetUserProfileDirectoryW(CURRENT_PROCESS_TOKEN, buf.as_mut_ptr(), &raw mut len)
    })?;
    Ok(buf.iter().copied().take_while(|&unit| unit != 0).collect())
}

/// Follows what `process.env.USERPROFILE` is now.
pub fn home_directory() -> Result<Vec<u16>, E> {
    let Some(home) = getenv_w_allow_empty(bun_core::wstr!("USERPROFILE")) else {
        return profile_directory().map_err(Win32Error::to_node_e);
    };
    match wide::decoded_len(home.iter().copied().take(MIN_PATH_BYTES)) {
        ..MIN_PATH_BYTES => Err(E::ENOENT),
        _ => Ok(home),
    }
}
