#![allow(unused_imports, unused_variables, dead_code, unreachable_code)]
use bstr::BStr;
use bun_paths::{
    is_absolute, path_buffer_pool, w_path_buffer_pool, PathBuffer,
    WPathBuffer, DELIMITER, MAX_PATH_BYTES, SEP, SEP_STR,
};
// TODO(b1): bun_paths::PosixToWinNormalizer missing from stub surface
struct PosixToWinNormalizer;
// TODO(b1): bun_str crate (was bun_str::{strings, w, WStr, ZStr}) — using bun_string re-exports
use bun_string::{strings, WStr, ZStr};

// TODO(b1): bun_output crate missing
// bun_output::declare_scope!(which, hidden);

fn is_valid(buf: &mut PathBuffer, segment: &[u8], bin: &[u8]) -> Option<u16> {
    #[cfg(any())]
    {
    let prefix_len = segment.len() + 1; // includes trailing path separator
    let len = prefix_len + bin.len();
    let len_z = len + 1; // includes null terminator
    if len_z > MAX_PATH_BYTES {
        return None;
    }

    buf[..segment.len()].copy_from_slice(segment);
    buf[segment.len()] = SEP;
    buf[prefix_len..prefix_len + bin.len()].copy_from_slice(bin);
    buf[len] = 0;
    // SAFETY: buf[len] == 0 written above
    let filepath = unsafe { ZStr::from_raw(buf.as_ptr(), len) };
    if !bun_sys::is_executable_file_path(filepath) {
        return None;
    }
    Some(u16::try_from(filepath.len()).unwrap())
    }
    todo!("b1-stub: is_valid")
}

// Like /usr/bin/which but without needing to exec a child process
// Remember to resolve the symlink if necessary
pub fn which<'a>(
    buf: &'a mut PathBuffer,
    path: &[u8],
    cwd: &[u8],
    bin: &[u8],
) -> Option<&'a ZStr> {
    #[cfg(any())]
    {
    if bin.len() > MAX_PATH_BYTES {
        return None;
    }
    bun_output::scoped_log!(
        which,
        "path={} cwd={} bin={}",
        BStr::new(path),
        BStr::new(cwd),
        BStr::new(bin)
    );

    #[cfg(windows)]
    {
        let mut convert_buf = w_path_buffer_pool().get();
        let result = which_win(&mut convert_buf, path, cwd, bin)?;
        let result_converted =
            strings::convert_utf16_to_utf8_in_buffer(&mut buf[..], result).expect("unreachable");
        // PORT NOTE: reshaped for borrowck — capture len/ptr before re-borrowing buf
        let result_converted_len = result_converted.len();
        let result_converted_ptr = result_converted.as_ptr();
        buf[result_converted_len] = 0;
        debug_assert!(result_converted_ptr == buf.as_ptr());
        // SAFETY: buf[result_converted_len] == 0 written above
        return Some(unsafe { ZStr::from_raw(buf.as_ptr(), result_converted_len) });
    }

    #[cfg(not(windows))]
    {
        if bin.is_empty() {
            return None;
        }

        // handle absolute paths
        if is_absolute(bin) {
            buf[..bin.len()].copy_from_slice(bin);
            buf[bin.len()] = 0;
            // SAFETY: buf[bin.len()] == 0 written above
            let bin_z = unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), bin.len()) };
            if bun_sys::is_executable_file_path(&*bin_z) {
                return Some(&*bin_z);
            }
            // Do not look absolute paths in $PATH
            return None;
        }

        if strings::index_of_char(bin, b'/').is_some() {
            if !cwd.is_empty() {
                if let Some(len) = is_valid(
                    buf,
                    strings::trim_right(cwd, SEP_STR.as_bytes()),
                    strings::without_prefix(bin, b"./"),
                ) {
                    // SAFETY: is_valid wrote NUL at buf[len]
                    return Some(unsafe { ZStr::from_raw(buf.as_ptr(), len as usize) });
                }
            }
            // Do not lookup paths with slashes in $PATH
            return None;
        }

        for segment in path.split(|b| *b == DELIMITER).filter(|s| !s.is_empty()) {
            if let Some(len) = is_valid(buf, segment, bin) {
                // SAFETY: is_valid wrote NUL at buf[len]
                return Some(unsafe { ZStr::from_raw(buf.as_ptr(), len as usize) });
            }
        }

        None
    }
    }
    todo!("b1-stub: which")
}

// TODO(b1): bun_str::w! macro missing — gate WIN_EXTENSIONS_W
#[cfg(any())]
static WIN_EXTENSIONS_W: [&[u16]; 3] = [
    w!("exe"),
    w!("cmd"),
    w!("bat"),
];
const WIN_EXTENSIONS: [&[u8]; 3] = [
    b"exe",
    b"cmd",
    b"bat",
];

pub fn ends_with_extension(str: &[u8]) -> bool {
    #[cfg(any())]
    {
    if str.len() < 4 {
        return false;
    }
    if str[str.len() - 4] != b'.' {
        return false;
    }
    let file_ext = &str[str.len() - 3..];
    for ext in WIN_EXTENSIONS {
        // comptime assert ext.len == 3 — all literals above are 3 bytes
        if strings::eql_case_insensitive_ascii_icheck_length(file_ext, ext) {
            return true;
        }
    }
    false
    }
    todo!("b1-stub: ends_with_extension")
}

/// Check if the WPathBuffer holds a existing file path, checking also for windows extensions variants like .exe, .cmd and .bat (internally used by which_win)
fn search_bin(
    buf: &mut WPathBuffer,
    path_size: usize,
    check_windows_extensions: bool,
) -> Option<&mut WStr> {
    #[cfg(any())]
    {
    if !check_windows_extensions {
        // On Windows, files without extensions are not executable
        // Therefore, we should only care about this check when the file already has an extension.
        // SAFETY: caller wrote NUL at buf[path_size]
        if bun_sys::exists_os_path(unsafe { WStr::from_raw(buf.as_ptr(), path_size) }, true) {
            // SAFETY: buf[path_size] == 0
            return Some(unsafe { WStr::from_raw_mut(buf.as_mut_ptr(), path_size) });
        }
    }

    if check_windows_extensions {
        buf[path_size] = b'.' as u16;
        buf[path_size + 1 + 3] = 0;
        for ext in WIN_EXTENSIONS_W {
            buf[path_size + 1..path_size + 1 + 3].copy_from_slice(ext);
            // SAFETY: buf[path_size + 1 + ext.len()] == 0 written above
            if bun_sys::exists_os_path(
                unsafe { WStr::from_raw(buf.as_ptr(), path_size + 1 + ext.len()) },
                true,
            ) {
                // SAFETY: NUL at buf[path_size + 1 + ext.len()]
                return Some(unsafe {
                    WStr::from_raw_mut(buf.as_mut_ptr(), path_size + 1 + ext.len())
                });
            }
        }
    }
    None
    }
    todo!("b1-stub: search_bin")
}

/// Check if bin file exists in this path (internally used by which_win)
fn search_bin_in_path<'a>(
    buf: &'a mut WPathBuffer,
    path_buf: &mut PathBuffer,
    path: &[u8],
    bin: &[u8],
    check_windows_extensions: bool,
) -> Option<&'a mut WStr> {
    #[cfg(any())]
    {
    if path.is_empty() {
        return None;
    }
    let segment: &[u8] = if is_absolute(path) {
        let Ok(s) = PosixToWinNormalizer::resolve_cwd_with_external_buf(path_buf, path) else {
            return None;
        };
        s
    } else {
        path
    };
    let segment_utf16 =
        strings::convert_utf8_to_utf16_in_buffer(&mut buf[..], strings::without_trailing_slash(segment));
    // PORT NOTE: reshaped for borrowck — capture len before re-borrowing buf
    let segment_utf16_len = segment_utf16.len();

    buf[segment_utf16_len] = SEP as u16;

    let bin_utf16 = strings::convert_utf8_to_utf16_in_buffer(&mut buf[segment_utf16_len + 1..], bin);
    let path_size = segment_utf16_len + 1 + bin_utf16.len();
    buf[path_size] = 0;

    search_bin(buf, path_size, check_windows_extensions)
    }
    todo!("b1-stub: search_bin_in_path")
}

/// This is the windows version of `which`.
/// It operates on wide strings.
/// It is similar to Get-Command in powershell.
pub fn which_win<'a>(
    buf: &'a mut WPathBuffer,
    path: &[u8],
    cwd: &[u8],
    bin: &[u8],
) -> Option<&'a WStr> {
    #[cfg(any())]
    {
    if bin.is_empty() {
        return None;
    }
    let mut path_buf = path_buffer_pool().get();

    let check_windows_extensions = !ends_with_extension(bin);

    // handle absolute paths
    if is_absolute(bin) {
        let Ok(normalized_bin) =
            PosixToWinNormalizer::resolve_cwd_with_external_buf(&mut path_buf, bin)
        else {
            return None;
        };
        let bin_utf16 = strings::convert_utf8_to_utf16_in_buffer(&mut buf[..], normalized_bin);
        // PORT NOTE: reshaped for borrowck — capture len before re-borrowing buf
        let bin_utf16_len = bin_utf16.len();
        buf[bin_utf16_len] = 0;
        return search_bin(buf, bin_utf16_len, check_windows_extensions).map(|w| &*w);
    }

    // check if bin is in cwd
    if strings::index_of_char(bin, b'/').is_some() || strings::index_of_char(bin, b'\\').is_some() {
        if let Some(bin_path) = search_bin_in_path(
            buf,
            &mut path_buf,
            cwd,
            strings::without_prefix(bin, b"./"),
            check_windows_extensions,
        ) {
            bun_paths::posix_to_platform_in_place(bin_path);
            return Some(&*bin_path);
        }
        // Do not lookup paths with slashes in $PATH
        return None;
    }

    // iterate over system path delimiter
    // TODO(port): borrowck — NLL may reject re-borrowing `buf` across loop iterations when
    // returning a reference tied to its lifetime (Polonius case). Phase B may need raw-ptr reshape.
    for segment_part in path.split(|b| *b == b';').filter(|s| !s.is_empty()) {
        if let Some(bin_path) =
            search_bin_in_path(buf, &mut path_buf, segment_part, bin, check_windows_extensions)
        {
            return Some(&*bin_path);
        }
    }

    None
    }
    todo!("b1-stub: which_win")
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/which/which.zig (172 lines)
//   confidence: medium
//   todos:      1
//   notes:      ZStr/WStr from_raw return-borrow shapes + which_win loop borrowck need Phase B attention
//   b1-status:  all fn bodies gated #[cfg(any())] + todo!() — missing deps:
//               bun_sys::{is_executable_file_path, exists_os_path},
//               bun_paths::{PosixToWinNormalizer, posix_to_platform_in_place},
//               bun_str::w! macro, bun_output crate,
//               strings::{trim_right, without_prefix, without_trailing_slash,
//                         convert_utf8_to_utf16_in_buffer, convert_utf16_to_utf8_in_buffer,
//                         eql_case_insensitive_ascii_icheck_length}
// ──────────────────────────────────────────────────────────────────────────
