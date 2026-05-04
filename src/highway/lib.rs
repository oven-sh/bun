// Direct `extern "C"` re-exports of the Google Highway SIMD C++ helpers.
// Per crate map: `bun.highway.*` → `bun_highway::*` (same C++ backing).

unsafe extern "C" {
    fn highway_char_frequency(
        text: *const u8,
        text_len: usize,
        freqs: *mut i32,
        delta: i32,
    );

    fn highway_index_of_char(
        haystack: *const u8,
        haystack_len: usize,
        needle: u8,
    ) -> usize;

    fn highway_index_of_interesting_character_in_string_literal(
        text: *const u8,
        text_len: usize,
        quote: u8,
    ) -> usize;

    fn highway_index_of_newline_or_non_ascii(
        haystack: *const u8,
        haystack_len: usize,
    ) -> usize;

    fn highway_index_of_newline_or_non_ascii_or_ansi(
        haystack: *const u8,
        haystack_len: usize,
    ) -> usize;

    fn highway_index_of_newline_or_non_ascii_or_hash_or_at(
        haystack: *const u8,
        haystack_len: usize,
    ) -> usize;

    fn highway_index_of_space_or_newline_or_non_ascii(
        haystack: *const u8,
        haystack_len: usize,
    ) -> usize;

    fn highway_contains_newline_or_non_ascii_or_quote(
        text: *const u8,
        text_len: usize,
    ) -> bool;

    fn highway_index_of_needs_escape_for_javascript_string(
        text: *const u8,
        text_len: usize,
        quote_char: u8,
    ) -> usize;

    fn highway_index_of_any_char(
        text: *const u8,
        text_len: usize,
        chars: *const u8,
        chars_len: usize,
    ) -> usize;

    fn highway_fill_with_skip_mask(
        mask: *const u8,
        mask_len: usize,
        output: *mut u8,
        input: *const u8,
        length: usize,
        skip_mask: bool,
    );

    fn highway_copy_u16_to_u8(
        input: *const u16,
        count: usize,
        output: *mut u8,
    );
}

/// Count frequencies of [a-zA-Z0-9_$] characters in a string
/// Updates the provided frequency array with counts (adds delta for each occurrence)
pub fn scan_char_frequency(text: &[u8], freqs: &mut [i32; 64], delta: i32) {
    if text.is_empty() || delta == 0 {
        return;
    }

    // SAFETY: text.ptr/len are a valid readable range; freqs is a valid 64-elem writable array.
    unsafe {
        highway_char_frequency(text.as_ptr(), text.len(), freqs.as_mut_ptr(), delta);
    }
}

pub fn index_of_char(haystack: &[u8], needle: u8) -> Option<usize> {
    if haystack.is_empty() {
        return None;
    }

    // SAFETY: haystack.ptr/len are a valid readable range.
    let result = unsafe { highway_index_of_char(haystack.as_ptr(), haystack.len(), needle) };

    if result == haystack.len() {
        return None;
    }

    debug_assert!(haystack[result] == needle);

    Some(result)
}

pub fn index_of_interesting_character_in_string_literal(slice: &[u8], quote_type: u8) -> Option<usize> {
    if slice.is_empty() {
        return None;
    }

    // SAFETY: slice.ptr/len are a valid readable range.
    let result = unsafe {
        highway_index_of_interesting_character_in_string_literal(slice.as_ptr(), slice.len(), quote_type)
    };

    if result == slice.len() {
        return None;
    }

    Some(result)
}

pub fn index_of_newline_or_non_ascii(haystack: &[u8]) -> Option<usize> {
    debug_assert!(!haystack.is_empty());

    // SAFETY: haystack.ptr/len are a valid readable range (len > 0 asserted above).
    let result = unsafe { highway_index_of_newline_or_non_ascii(haystack.as_ptr(), haystack.len()) };

    if result == haystack.len() {
        return None;
    }
    if cfg!(debug_assertions) {
        let haystack_char = haystack[result];
        if !(haystack_char > 127 || haystack_char < 0x20 || haystack_char == b'\r' || haystack_char == b'\n') {
            panic!("Invalid character found in indexOfNewlineOrNonASCII");
        }
    }

    Some(result)
}

pub fn index_of_newline_or_non_ascii_or_ansi(haystack: &[u8]) -> Option<usize> {
    debug_assert!(!haystack.is_empty());

    // SAFETY: haystack.ptr/len are a valid readable range (len > 0 asserted above).
    let result = unsafe { highway_index_of_newline_or_non_ascii_or_ansi(haystack.as_ptr(), haystack.len()) };

    if result == haystack.len() {
        return None;
    }
    if cfg!(debug_assertions) {
        let haystack_char = haystack[result];
        if !(haystack_char > 127 || haystack_char < 0x20 || haystack_char == b'\r' || haystack_char == b'\n') {
            panic!("Invalid character found in indexOfNewlineOrNonASCIIOrANSI");
        }
    }

    Some(result)
}

/// Checks if the string contains any newlines, non-ASCII characters, or quotes
pub fn contains_newline_or_non_ascii_or_quote(text: &[u8]) -> bool {
    if text.is_empty() {
        return false;
    }

    // SAFETY: text.ptr/len are a valid readable range.
    unsafe { highway_contains_newline_or_non_ascii_or_quote(text.as_ptr(), text.len()) }
}

/// Finds the first character that needs escaping in a JavaScript string
/// Looks for characters above ASCII (> 127), control characters (< 0x20),
/// backslash characters (`\`), the quote character itself, and for backtick
/// strings also the dollar sign (`$`)
pub fn index_of_needs_escape_for_javascript_string(slice: &[u8], quote_char: u8) -> Option<u32> {
    if slice.is_empty() {
        return None;
    }

    // SAFETY: slice.ptr/len are a valid readable range.
    let result = unsafe {
        highway_index_of_needs_escape_for_javascript_string(slice.as_ptr(), slice.len(), quote_char)
    };

    if result == slice.len() {
        return None;
    }

    if cfg!(debug_assertions) {
        let haystack_char = slice[result];
        if !(haystack_char >= 127
            || haystack_char < 0x20
            || haystack_char == b'\\'
            || haystack_char == quote_char
            || haystack_char == b'$'
            || haystack_char == b'\r'
            || haystack_char == b'\n')
        {
            panic!(
                "Invalid character found in indexOfNeedsEscapeForJavaScriptString: U+{:x}. Full string: \"{}\"",
                haystack_char,
                bstr::BStr::new(slice),
            );
        }
    }

    Some(result as u32)
}

pub fn index_of_any_char(haystack: &[u8], chars: &[u8]) -> Option<usize> {
    if haystack.is_empty() || chars.is_empty() {
        return None;
    }

    // SAFETY: haystack and chars ptr/len are valid readable ranges.
    let result = unsafe {
        highway_index_of_any_char(haystack.as_ptr(), haystack.len(), chars.as_ptr(), chars.len())
    };

    if result == haystack.len() {
        return None;
    }

    if cfg!(debug_assertions) {
        let haystack_char = haystack[result];
        let mut found = false;
        for &c in chars {
            if c == haystack_char {
                found = true;
                break;
            }
        }
        if !found {
            panic!("Invalid character found in indexOfAnyChar");
        }
    }

    Some(result)
}

// TODO(port): Zig accepts `[]align(1) const u16` (unaligned). Rust `&[u16]` requires
// 2-byte alignment; callers passing unaligned data must go through the raw extern.
pub fn copy_u16_to_u8(input: &[u16], output: &mut [u8]) {
    // SAFETY: input.ptr/len readable, output.ptr writable for at least input.len() bytes
    // (caller contract matches Zig: output.len >= input.len()).
    unsafe { highway_copy_u16_to_u8(input.as_ptr(), input.len(), output.as_mut_ptr()) }
}

/// Apply a WebSocket mask to data using SIMD acceleration
/// If skip_mask is true, data is copied without masking
pub fn fill_with_skip_mask(mask: [u8; 4], output: &mut [u8], input: &[u8], skip_mask: bool) {
    if input.is_empty() {
        return;
    }

    // SAFETY: mask is 4 bytes; input.ptr/len readable; output.ptr writable for input.len() bytes.
    unsafe {
        highway_fill_with_skip_mask(
            mask.as_ptr(),
            4,
            output.as_mut_ptr(),
            input.as_ptr(),
            input.len(),
            skip_mask,
        );
    }
}

/// Useful for single-line JavaScript comments.
/// Scans for:
/// - `\n`, `\r`
/// - Non-ASCII characters (which implicitly include `\n`, `\r`)
/// - `#`
/// - `@`
pub fn index_of_newline_or_non_ascii_or_hash_or_at(haystack: &[u8]) -> Option<usize> {
    if haystack.is_empty() {
        return None;
    }

    // SAFETY: haystack.ptr/len are a valid readable range.
    let result = unsafe {
        highway_index_of_newline_or_non_ascii_or_hash_or_at(haystack.as_ptr(), haystack.len())
    };

    if result == haystack.len() {
        return None;
    }

    Some(result)
}

/// Scans for:
/// - " "
/// - Non-ASCII characters (which implicitly include `\n`, `\r`, '\t')
pub fn index_of_space_or_newline_or_non_ascii(haystack: &[u8]) -> Option<usize> {
    if haystack.is_empty() {
        return None;
    }

    // SAFETY: haystack.ptr/len are a valid readable range.
    let result = unsafe {
        highway_index_of_space_or_newline_or_non_ascii(haystack.as_ptr(), haystack.len())
    };

    if result == haystack.len() {
        return None;
    }

    Some(result)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/highway/highway.zig (307 lines)
//   confidence: high
//   todos:      1
//   notes:      copy_u16_to_u8 loses align(1) on input slice; expose raw extern if unaligned callers exist
// ──────────────────────────────────────────────────────────────────────────
