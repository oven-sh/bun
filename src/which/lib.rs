#![allow(unused_imports, unused_variables, dead_code, unreachable_code)]
#![warn(unused_must_use, unreachable_pub)]
use bstr::BStr;
use bun_core::{WStr, ZStr, strings, w};
use bun_paths::resolve_path::{PosixToWinNormalizer, posix_to_platform_in_place};
use bun_paths::{
    DELIMITER, MAX_PATH_BYTES, PathBuffer, SEP, SEP_STR, WPathBuffer, is_absolute,
    path_buffer_pool, w_path_buffer_pool,
};

#[allow(non_upper_case_globals)]
mod scope {
    bun_core::declare_scope!(which, hidden);
}
use scope::which as which_log;

fn is_valid(buf: &mut PathBuffer, segment: &[u8], bin: &[u8]) -> Option<u16> {
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
    let filepath = ZStr::from_buf(&buf[..], len);
    if !bun_sys::is_executable_file_path(filepath) {
        return None;
    }
    Some(u16::try_from(filepath.len()).expect("int cast"))
}

// Like /usr/bin/which but without needing to exec a child process
// Remember to resolve the symlink if necessary
pub fn which<'a>(buf: &'a mut PathBuffer, path: &[u8], cwd: &[u8], bin: &[u8]) -> Option<&'a ZStr> {
    if bin.len() > MAX_PATH_BYTES {
        return None;
    }
    bun_core::scoped_log!(
        which_log,
        "path={} cwd={} bin={}",
        BStr::new(path),
        BStr::new(cwd),
        BStr::new(bin)
    );

    #[cfg(windows)]
    {
        let mut convert_buf = w_path_buffer_pool::get();
        let result = which_win(&mut *convert_buf, path, cwd, bin)?;
        let result_converted =
            bun_core::strings::convert_utf16_to_utf8_in_buffer(&mut buf[..], result);
        // PORT NOTE: reshaped for borrowck — capture len/ptr before re-borrowing buf
        let result_converted_len = result_converted.len();
        let result_converted_ptr = result_converted.as_ptr();
        buf[result_converted_len] = 0;
        debug_assert!(result_converted_ptr == buf.as_ptr());
        // SAFETY: buf[result_converted_len] == 0 written above
        return Some(ZStr::from_buf(&buf[..], result_converted_len));
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
                // PORT NOTE: std.mem.trimRight(u8, cwd, sep_str) — strip trailing SEP bytes.
                let mut cwd_trimmed = cwd;
                while cwd_trimmed.last() == Some(&SEP) {
                    cwd_trimmed = &cwd_trimmed[..cwd_trimmed.len() - 1];
                }
                if let Some(len) = is_valid(
                    buf,
                    cwd_trimmed,
                    strings::without_prefix_comptime(bin, b"./"),
                ) {
                    // SAFETY: is_valid wrote NUL at buf[len]
                    return Some(ZStr::from_buf(&buf[..], len as usize));
                }
            }
            // Do not lookup paths with slashes in $PATH
            return None;
        }

        for segment in path.split(|b| *b == DELIMITER).filter(|s| !s.is_empty()) {
            if let Some(len) = is_valid(buf, segment, bin) {
                // SAFETY: is_valid wrote NUL at buf[len]
                return Some(ZStr::from_buf(&buf[..], len as usize));
            }
        }

        None
    }
}

static WIN_EXTENSIONS_W: [&[u16]; 3] = [w!("exe"), w!("cmd"), w!("bat")];
const WIN_EXTENSIONS: [&[u8]; 3] = [b"exe", b"cmd", b"bat"];

pub fn ends_with_extension(str: &[u8]) -> bool {
    if str.len() < 4 {
        return false;
    }
    if str[str.len() - 4] != b'.' {
        return false;
    }
    let file_ext = &str[str.len() - 3..];
    for ext in WIN_EXTENSIONS {
        // comptime assert ext.len == 3 — all literals above are 3 bytes
        if strings::eql_case_insensitive_asciii_check_length(file_ext, ext) {
            return true;
        }
    }
    false
}

/// Check if the WPathBuffer holds a existing file path, checking also for windows extensions variants like .exe, .cmd and .bat (internally used by which_win)
fn search_bin(
    buf: &mut WPathBuffer,
    path_size: usize,
    check_windows_extensions: bool,
) -> Option<&mut [u16]> {
    // PORT NOTE: Zig `existsOSPath` takes `bun.OSPathSliceZ`, which is `[:0]const u16`
    // on Windows and `[:0]const u8` on POSIX. `searchBin` only ever runs on Windows
    // (whichWin is dead-by-lazy-eval elsewhere); the POSIX arm here is just to keep
    // the public `which_win` symbol type-checking on all targets.
    #[cfg(windows)]
    {
        if !check_windows_extensions {
            // On Windows, files without extensions are not executable
            // Therefore, we should only care about this check when the file already has an extension.
            // SAFETY: caller wrote NUL at buf[path_size]
            if bun_sys::exists_os_path(WStr::from_buf(&buf[..], path_size), true) {
                return Some(&mut buf[..path_size]);
            }
        }

        if check_windows_extensions {
            buf[path_size] = b'.' as u16;
            buf[path_size + 1 + 3] = 0;
            for ext in WIN_EXTENSIONS_W {
                buf[path_size + 1..path_size + 1 + 3].copy_from_slice(ext);
                // SAFETY: buf[path_size + 1 + ext.len()] == 0 written above
                if bun_sys::exists_os_path(
                    WStr::from_buf(&buf[..], path_size + 1 + ext.len()),
                    true,
                ) {
                    return Some(&mut buf[..path_size + 1 + ext.len()]);
                }
            }
        }
        None
    }
    #[cfg(not(windows))]
    {
        let _ = (buf, path_size, check_windows_extensions);
        None
    }
}

/// Check if bin file exists in this path (internally used by which_win)
fn search_bin_in_path<'a>(
    buf: &'a mut WPathBuffer,
    path_buf: &mut PathBuffer,
    path: &[u8],
    bin: &[u8],
    check_windows_extensions: bool,
) -> Option<&'a mut [u16]> {
    if path.is_empty() {
        return None;
    }
    #[cfg(windows)]
    let segment: &[u8] = if is_absolute(path) {
        match PosixToWinNormalizer::resolve_cwd_with_external_buf(path_buf, path) {
            Ok(s) => s,
            Err(_) => return None,
        }
    } else {
        path
    };
    // PORT NOTE: PosixToWinNormalizer is a no-op on posix; resolve_cwd_with_external_buf
    // takes `&mut ()` there, so just pass through (matches Zig lazy-eval behaviour).
    #[cfg(not(windows))]
    let segment: &[u8] = {
        let _ = path_buf;
        path
    };
    let segment_utf16 = bun_core::strings::convert_utf8_to_utf16_in_buffer(
        &mut buf[..],
        bun_core::strings::without_trailing_slash(segment),
    );
    // PORT NOTE: reshaped for borrowck — capture len before re-borrowing buf
    let segment_utf16_len = segment_utf16.len();

    buf[segment_utf16_len] = SEP as u16;

    let bin_utf16 =
        bun_core::strings::convert_utf8_to_utf16_in_buffer(&mut buf[segment_utf16_len + 1..], bin);
    let path_size = segment_utf16_len + 1 + bin_utf16.len();
    buf[path_size] = 0;

    search_bin(buf, path_size, check_windows_extensions)
}

/// This is the windows version of `which`.
/// It operates on wide strings.
/// It is similar to Get-Command in powershell.
pub fn which_win<'a>(
    buf: &'a mut WPathBuffer,
    path: &[u8],
    cwd: &[u8],
    bin: &[u8],
) -> Option<&'a [u16]> {
    if bin.is_empty() {
        return None;
    }
    let mut path_buf = path_buffer_pool::get();

    let check_windows_extensions = !ends_with_extension(bin);

    // handle absolute paths
    if is_absolute(bin) {
        #[cfg(windows)]
        let normalized_bin =
            match PosixToWinNormalizer::resolve_cwd_with_external_buf(&mut *path_buf, bin) {
                Ok(s) => s,
                Err(_) => return None,
            };
        #[cfg(not(windows))]
        let normalized_bin = bin;
        let bin_utf16 =
            bun_core::strings::convert_utf8_to_utf16_in_buffer(&mut buf[..], normalized_bin);
        // PORT NOTE: reshaped for borrowck — capture len before re-borrowing buf
        let bin_utf16_len = bin_utf16.len();
        buf[bin_utf16_len] = 0;
        return search_bin(buf, bin_utf16_len, check_windows_extensions).map(|w| &*w);
    }

    // check if bin is in cwd
    if strings::index_of_char(bin, b'/').is_some() || strings::index_of_char(bin, b'\\').is_some() {
        // PORT NOTE: NLL Polonius limitation — raw-ptr reborrow so the None
        // branch can fall through without `buf` appearing borrowed.
        // SAFETY: bin_path borrow does not escape this block on the None path.
        let buf_reborrow: &'a mut WPathBuffer =
            unsafe { &mut *std::ptr::from_mut::<WPathBuffer>(buf) };
        if let Some(bin_path) = search_bin_in_path(
            buf_reborrow,
            &mut *path_buf,
            cwd,
            strings::without_prefix_comptime(bin, b"./"),
            check_windows_extensions,
        ) {
            posix_to_platform_in_place(bin_path);
            return Some(&*bin_path);
        }
        // Do not lookup paths with slashes in $PATH
        return None;
    }

    // iterate over system path delimiter
    for segment_part in path.split(|b| *b == b';').filter(|s| !s.is_empty()) {
        // PORT NOTE: NLL Polonius limitation — re-borrowing `buf` across loop
        // iterations when returning a reference tied to its lifetime.
        // SAFETY: on None the borrow ends; on Some we return immediately.
        let buf_reborrow: &'a mut WPathBuffer =
            unsafe { &mut *std::ptr::from_mut::<WPathBuffer>(buf) };
        if let Some(bin_path) = search_bin_in_path(
            buf_reborrow,
            &mut *path_buf,
            segment_part,
            bin,
            check_windows_extensions,
        ) {
            return Some(&*bin_path);
        }
    }

    None
}

// ported from: src/which/which.zig
