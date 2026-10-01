//! Rust stand-ins for the C++ symbols that the `cargo test` binary of this crate links to: no build of bun holds them.

/// The `len` bytes at `at`.
unsafe fn bytes_at<'a>(at: *const u8, len: usize) -> &'a [u8] {
    // SAFETY: the caller passes `len` bytes that stay readable for `'a`.
    unsafe { core::slice::from_raw_parts(at, len) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    eprintln!("STANDIN highway_index_of_char");
    // SAFETY: the caller passes a readable range.
    let haystack = unsafe { bytes_at(haystack, haystack_len) };
    let found = haystack.iter().position(|&byte| byte == needle);
    found.unwrap_or(haystack_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_last_index_of_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    eprintln!("STANDIN highway_last_index_of_char");
    // SAFETY: the caller passes a readable range.
    let haystack = unsafe { bytes_at(haystack, haystack_len) };
    let found = haystack.iter().rposition(|&byte| byte == needle);
    found.unwrap_or(haystack_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_count_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    eprintln!("STANDIN highway_count_char");
    // SAFETY: the caller passes a readable range.
    let haystack = unsafe { bytes_at(haystack, haystack_len) };
    haystack.iter().filter(|&&byte| byte == needle).count()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_any_char(
    text: *const u8,
    text_len: usize,
    chars: *const u8,
    chars_len: usize,
) -> usize {
    eprintln!("STANDIN highway_index_of_any_char");
    // SAFETY: the caller passes two readable ranges.
    let (text, chars) = unsafe { (bytes_at(text, text_len), bytes_at(chars, chars_len)) };
    let found = text.iter().position(|byte| chars.contains(byte));
    found.unwrap_or(text_len)
}

/// The first occurrence, and null where there is none.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memmem(
    haystack: *const u8,
    haystack_len: usize,
    needle: *const u8,
    needle_len: usize,
) -> *const u8 {
    eprintln!("STANDIN highway_memmem");
    // SAFETY: the caller passes two readable ranges.
    let (hay, needle) = unsafe {
        (
            bytes_at(haystack, haystack_len),
            bytes_at(needle, needle_len),
        )
    };
    let Some(last_start) = hay.len().checked_sub(needle.len()) else {
        return core::ptr::null();
    };
    match (0..=last_start).find(|&start| hay[start..start + needle.len()] == *needle) {
        // SAFETY: an occurrence starts inside the haystack.
        Some(start) => unsafe { haystack.add(start) },
        None => core::ptr::null(),
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_ascii(buf: *const u8, len: usize) -> bool {
    eprintln!("STANDIN simdutf__validate_ascii");
    // SAFETY: the caller passes a readable range.
    unsafe { bytes_at(buf, len) }.is_ascii()
}

#[cfg(test)]
mod tests {
    use bun_core::strings;

    #[test]
    fn text_past_the_scalar_paths_of_bun_core_is_searched_by_the_stand_ins() {
        let mut text = [b'a'; 64];
        text[40] = b'/';
        text[50] = b'/';
        assert_eq!(strings::index_of_char_usize(&text, b'/'), Some(40));
        assert_eq!(strings::index_of_char_usize(&text, b'x'), None);
        assert_eq!(strings::last_index_of_char(&text, b'/'), Some(50));
        assert_eq!(strings::last_index_of_char(&text, b'x'), None);
        assert_eq!(strings::count_char(&text, b'/'), 2);
        assert_eq!(strings::index_of_any(&text, b"/x"), Some(40));
        assert_eq!(strings::index_of_any(&text, b"xy"), None);
        assert_eq!(strings::index_of(&text, b"a/a"), Some(39));
        assert_eq!(strings::index_of(&text, b"//"), None);
        assert!(bun_core::is_all_ascii(&text));
        text[63] = 0xC3;
        assert!(!bun_core::is_all_ascii(&text));
    }
}
