use core::ffi::CStr;
use std::sync::OnceLock;

use crate::{Buffer, CText};

/// The language of the user as the system names it (`en-US`), which need not be a valid language tag. It is read once.
pub fn host_language() -> &'static CStr {
    static LANGUAGE: OnceLock<Option<CText>> = OnceLock::new();
    LANGUAGE
        .get_or_init(|| CText::from_buffer(detect()?).ok())
        .as_deref()
        .unwrap_or(c"en-US")
}

#[cfg(unix)]
fn detect() -> Option<Buffer<u8>> {
    // SAFETY: with no name it is a query.
    let locale = unsafe { libc::setlocale(libc::LC_CTYPE, core::ptr::null()) };
    if locale.is_null() {
        return None;
    }
    // SAFETY: a terminated string that lasts until the locale of the process is set again, which Bun does not do.
    let locale = unsafe { CStr::from_ptr(locale) }.to_bytes();
    // language[_territory][.codeset][@modifier]
    let language: Buffer<u8> = locale
        .iter()
        .take_while(|&&byte| byte != b'.' && byte != b'@')
        .map(|&byte| if byte == b'_' { b'-' } else { byte })
        .collect();
    let names_no_language = [&b""[..], b"C", b"POSIX"]
        .iter()
        .any(|name| language.eq_ignore_ascii_case(name));
    (!names_no_language).then_some(language)
}

#[cfg(windows)]
fn detect() -> Option<Buffer<u8>> {
    const LOCALE_SISO639LANGNAME: u32 = 0x59;
    const LOCALE_SISO3166CTRYNAME: u32 = 0x5a;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        safe fn GetUserDefaultUILanguage() -> u16;
        fn GetLocaleInfoW(locale: u32, kind: u32, out: *mut u16, capacity: i32) -> i32;
    }

    let locale = u32::from(GetUserDefaultUILanguage());
    let code = |kind| -> Buffer<u8> {
        // Either code has at most nine characters with its terminator.
        let mut units = [0u16; 9];
        // SAFETY: `units` has room for the capacity.
        let written =
            unsafe { GetLocaleInfoW(locale, kind, units.as_mut_ptr(), units.len() as i32) };
        units
            .iter()
            .take(usize::try_from(written).unwrap_or(0))
            .take_while(|&&unit| unit != 0)
            .map(|&unit| unit as u8)
            .collect()
    };

    let mut language = code(LOCALE_SISO639LANGNAME);
    if language.is_empty() {
        language.extend_from_slice(b"en");
    }
    let country = code(LOCALE_SISO3166CTRYNAME);
    if !country.is_empty() {
        language.push(b'-');
        language.extend_from_slice(&country);
    }
    Some(language)
}
