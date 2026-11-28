//! The console title. Both calls fail if the process has no console.

use bun_core::WStr;

use super::{BOOL, DWORD, LPCWSTR, Win32Error, check, kernel32};
use crate::windows_format::wtf16;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetConsoleTitleW(lpConsoleTitle: *mut u16, nSize: DWORD) -> DWORD;
    fn SetConsoleTitleW(lpConsoleTitle: LPCWSTR) -> BOOL;
}

const MAX_READ_WTF8_LEN: usize = 1023;
const MAX_WRITE_UTF16_LEN: usize = 8191;

/// WTF-8. `None` if the title is longer than `MAX_READ_WTF8_LEN`.
pub fn get() -> Result<Option<Vec<u8>>, Win32Error> {
    let mut buf = [0u16; MAX_READ_WTF8_LEN + 1];
    kernel32::SetLastError(0);
    // SAFETY: `buf` is writable for the length passed.
    let len = unsafe { GetConsoleTitleW(buf.as_mut_ptr(), buf.len() as DWORD) } as usize;
    let error = Win32Error::get();
    if len == 0 && error != Win32Error::SUCCESS {
        return Err(error);
    }
    if len >= buf.len() {
        return Ok(None);
    }
    let title = wtf16::decode_until_nul(buf[..len].iter().copied());
    Ok((title.len() <= MAX_READ_WTF8_LEN).then_some(title))
}

/// Truncates `title` at the first NUL and to `MAX_WRITE_UTF16_LEN`.
pub fn set(title: &[u8]) -> Result<(), Win32Error> {
    let title = bun_core::slice_to_nul(title);
    let mut buf = vec![0; title.len() + 1];
    let len = match wtf16::encode(title, &mut buf) {
        Ok(title) => title.len().min(MAX_WRITE_UTF16_LEN),
        Err(_) => return Err(Win32Error::INVALID_PARAMETER),
    };
    buf[len] = 0;
    let title = WStr::from_buf(&buf, len);
    // SAFETY: `title` is NUL-terminated.
    check(unsafe { SetConsoleTitleW(title.as_ptr()) })
}
