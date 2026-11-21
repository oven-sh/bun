//! The title of the console. Both calls fail without a console.

use bun_core::WStr;

use super::{BOOL, DWORD, LPCWSTR, Win32Error, check, kernel32};
use crate::windows_format::wide;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetConsoleTitleW(lpConsoleTitle: *mut u16, nSize: DWORD) -> DWORD;
    fn SetConsoleTitleW(lpConsoleTitle: LPCWSTR) -> BOOL;
}

const MAX_BYTES_READ: usize = 1023;
const MAX_UNITS_WRITTEN: usize = 8191;

/// WTF-8. `None` if it has more than 1023 bytes.
pub fn get() -> Result<Option<Vec<u8>>, Win32Error> {
    let mut buf = [0u16; MAX_BYTES_READ + 1];
    kernel32::SetLastError(0);
    // SAFETY: it writes at most `buf.len()` units.
    let len = unsafe { GetConsoleTitleW(buf.as_mut_ptr(), buf.len() as DWORD) } as usize;
    match Win32Error::get() {
        error if len == 0 && error != Win32Error::SUCCESS => Err(error),
        _ if len >= buf.len() => Ok(None),
        _ => {
            let title = wide::decode_until_nul(buf[..len].iter().copied());
            Ok((title.len() <= MAX_BYTES_READ).then_some(title))
        }
    }
}

/// Cuts `title` at a NUL, and after 8191 units.
pub fn set(title: &[u8]) -> Result<(), Win32Error> {
    let title = bun_core::slice_to_nul(title);
    let mut buf = vec![0; title.len() + 1];
    let len = match wide::encode(title, &mut buf) {
        Ok(title) => title.len().min(MAX_UNITS_WRITTEN),
        Err(_) => return Err(Win32Error::INVALID_PARAMETER),
    };
    let title = WStr::nul_terminate(&mut buf, len);
    // SAFETY: `title` is NUL-terminated.
    check(unsafe { SetConsoleTitleW(title.as_ptr()) })
}
