// Direct `extern "C"` re-exports of the Google Highway SIMD C++ helpers.
// Per crate map: `bun.highway.*` → `bun_highway::*` (same C++ backing).

unsafe extern "C" {
    fn highway_char_frequency(text: *const u8, text_len: usize, freqs: *mut i32, delta: i32);

    fn highway_index_of_char(haystack: *const u8, haystack_len: usize, needle: u8) -> usize;

    fn highway_index_of_interesting_character_in_string_literal(
        text: *const u8,
        text_len: usize,
        quote: u8,
    ) -> usize;

    fn highway_index_of_interesting_character_in_multiline_comment(
        text: *const u8,
        text_len: usize,
    ) -> usize;

    fn highway_index_of_newline_or_non_ascii(haystack: *const u8, haystack_len: usize) -> usize;

    fn highway_index_of_newline_or_non_ascii_or_hash_or_at(
        haystack: *const u8,
        haystack_len: usize,
    ) -> usize;

    fn highway_index_of_space_or_newline_or_non_ascii(
        haystack: *const u8,
        haystack_len: usize,
    ) -> usize;

    fn highway_contains_newline_or_non_ascii_or_quote(text: *const u8, text_len: usize) -> bool;

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

    fn highway_copy_u16_to_u8(input: *const u16, count: usize, output: *mut u8);

    fn highway_copy_ascii_prefix(src: *const u8, len: usize, dst: *mut u8) -> usize;

    fn highway_encode_hex_lower(input: *const u8, len: usize, output: *mut u8);

    fn highway_decode_hex8(input: *const u8, output: *mut u8, out_len: usize) -> usize;

    fn highway_decode_hex16(input: *const u16, output: *mut u8, out_len: usize) -> usize;
}

// NOTE: every public wrapper below is `#[inline(always)]`. They are thin
// ptr/len shims around the `extern "C"` highway_* dispatch stubs; inlining
// them puts the FFI call directly at the hot lexer/printer call site so that
// (a) the Rust-side frame disappears unconditionally, and (b) cross-language
// LTO (`--profile=btg`, crossLangLto=true) can fold the C dispatch shim
// straight into the caller. Without this the profile shows the C shim as a
// distinct hot leaf (e.g. `highway_index_of_newline_or_non_ascii` self-samples
// in lint/create-vue benches).

/// Count frequencies of [a-zA-Z0-9_$] characters in a string
/// Updates the provided frequency array with counts (adds delta for each occurrence)
#[inline(always)]
pub fn scan_char_frequency(text: &[u8], freqs: &mut [i32; 64], delta: i32) {
    if text.is_empty() || delta == 0 {
        return;
    }

    // SAFETY: text.ptr/len are a valid readable range; freqs is a valid 64-elem writable array.
    unsafe {
        highway_char_frequency(text.as_ptr(), text.len(), freqs.as_mut_ptr(), delta);
    }
}

#[inline(always)]
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

#[inline(always)]
pub fn index_of_interesting_character_in_string_literal(
    slice: &[u8],
    quote_type: u8,
) -> Option<usize> {
    if slice.is_empty() {
        return None;
    }

    // SAFETY: slice.ptr/len are a valid readable range.
    let result = unsafe {
        highway_index_of_interesting_character_in_string_literal(
            slice.as_ptr(),
            slice.len(),
            quote_type,
        )
    };

    if result == slice.len() {
        return None;
    }

    Some(result)
}

/// Useful for scanning the body of `/* ... */` block comments.
/// Scans for:
/// - `*` (potential `*/` terminator)
/// - `\n`, `\r`
/// - Non-ASCII characters (so the caller decodes U+2028/U+2029 and other
///   multi-byte sequences one code point at a time)
#[inline(always)]
pub fn index_of_interesting_character_in_multiline_comment(slice: &[u8]) -> Option<usize> {
    if slice.is_empty() {
        return None;
    }

    // SAFETY: slice.ptr/len are a valid readable range.
    let result = unsafe {
        highway_index_of_interesting_character_in_multiline_comment(slice.as_ptr(), slice.len())
    };

    if result == slice.len() {
        return None;
    }

    if cfg!(debug_assertions) {
        let haystack_char = slice[result];
        if !(haystack_char > 127
            || haystack_char == b'*'
            || haystack_char == b'\r'
            || haystack_char == b'\n')
        {
            panic!("Invalid character found in indexOfInterestingCharacterInMultilineComment");
        }
    }

    Some(result)
}

#[inline(always)]
pub fn index_of_newline_or_non_ascii(haystack: &[u8]) -> Option<usize> {
    debug_assert!(!haystack.is_empty());

    // SAFETY: haystack.ptr/len are a valid readable range (len > 0 asserted above).
    let result =
        unsafe { highway_index_of_newline_or_non_ascii(haystack.as_ptr(), haystack.len()) };

    if result == haystack.len() {
        return None;
    }
    if cfg!(debug_assertions) {
        let haystack_char = haystack[result];
        if !(haystack_char > 127
            || haystack_char < 0x20
            || haystack_char == b'\r'
            || haystack_char == b'\n')
        {
            panic!("Invalid character found in indexOfNewlineOrNonASCII");
        }
    }

    Some(result)
}

/// Checks if the string contains any newlines, non-ASCII characters, or quotes
#[inline(always)]
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
#[inline(always)]
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

#[inline(always)]
pub fn index_of_any_char(haystack: &[u8], chars: &[u8]) -> Option<usize> {
    if haystack.is_empty() || chars.is_empty() {
        return None;
    }

    // SAFETY: haystack and chars ptr/len are valid readable ranges.
    let result = unsafe {
        highway_index_of_any_char(
            haystack.as_ptr(),
            haystack.len(),
            chars.as_ptr(),
            chars.len(),
        )
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
#[inline(always)]
pub fn copy_u16_to_u8(input: &[u16], output: &mut [u8]) {
    // SAFETY: input.ptr/len readable, output.ptr writable for at least input.len() bytes
    // (caller contract matches Zig: output.len >= input.len()).
    unsafe { highway_copy_u16_to_u8(input.as_ptr(), input.len(), output.as_mut_ptr()) }
}

#[inline(always)]
pub fn copy_ascii_prefix(src: &[u8], dst: &mut [u8]) -> usize {
    let len = src.len().min(dst.len());
    if len == 0 {
        return 0;
    }

    // SAFETY: `src` is readable and `dst` writable for at least `len` bytes;
    // the kernel reads and writes at most `len` bytes of each.
    let copied = unsafe { highway_copy_ascii_prefix(src.as_ptr(), len, dst.as_mut_ptr()) };

    debug_assert!(copied <= len);
    debug_assert!(copied == len || src[copied] >= 0x80);

    copied
}

/// Lowercase hex encode: writes exactly `2 * src.len()` bytes to `dst`.
#[inline(always)]
pub fn encode_hex_lower(src: &[u8], dst: &mut [u8]) {
    // Runtime check (not just debug): this is a safe wrapper around an FFI
    // write, so a too-small `dst` must panic instead of corrupting memory.
    assert!(
        dst.len() / 2 >= src.len(),
        "encode_hex_lower: destination too small ({} bytes for {} source bytes)",
        dst.len(),
        src.len()
    );
    if src.is_empty() {
        return;
    }

    // SAFETY: `src` is readable for `src.len()` bytes and `dst` is writable
    // for `2 * src.len()` bytes (asserted above); the kernel writes exactly
    // that many bytes and the slices cannot overlap (`&`/`&mut`).
    unsafe { highway_encode_hex_lower(src.as_ptr(), src.len(), dst.as_mut_ptr()) }
}

/// Decode pairs of ASCII hex digits from `src` into bytes in `dst`, stopping at
/// the first pair that contains a non-hex character. Returns the number of
/// bytes written (`min(src.len() / 2, dst.len())` when the input is fully
/// valid). A trailing lone hex digit is ignored.
#[inline(always)]
pub fn decode_hex(src: &[u8], dst: &mut [u8]) -> usize {
    let pairs = (src.len() / 2).min(dst.len());
    if pairs == 0 {
        return 0;
    }

    // SAFETY: `src` is readable for at least `2 * pairs` bytes and `dst` is
    // writable for at least `pairs` bytes; the kernel reads/writes at most that.
    let written = unsafe { highway_decode_hex8(src.as_ptr(), dst.as_mut_ptr(), pairs) };

    debug_assert!(written <= pairs);
    written
}

/// UTF-16 variant of [`decode_hex`]. Code units above 0xFF are treated as
/// invalid characters (they stop decoding), never truncated to a byte.
#[inline(always)]
pub fn decode_hex_u16(src: &[u16], dst: &mut [u8]) -> usize {
    let pairs = (src.len() / 2).min(dst.len());
    if pairs == 0 {
        return 0;
    }

    // SAFETY: `src` is readable for at least `2 * pairs` code units and `dst`
    // is writable for at least `pairs` bytes; the kernel reads/writes at most that.
    let written = unsafe { highway_decode_hex16(src.as_ptr(), dst.as_mut_ptr(), pairs) };

    debug_assert!(written <= pairs);
    written
}

/// Apply a WebSocket mask to data using SIMD acceleration
/// If skip_mask is true, data is copied without masking
#[inline(always)]
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

/// In-place variant of [`fill_with_skip_mask`] for `output == input`.
///
/// The Zig caller (`Mask.fill`) routinely passes the same buffer for both;
/// the safe wrapper above can't express that without violating `&mut`/`&`
/// aliasing. The C++ kernel reads-before-writes per lane (it's `dst[i] =
/// src[i] ^ mask[i&3]`), so feeding it `src == dst` is sound — that's exactly
/// what the Zig build does.
#[inline(always)]
pub fn fill_with_skip_mask_inplace(mask: [u8; 4], buf: &mut [u8], skip_mask: bool) {
    if buf.is_empty() {
        return;
    }

    // SAFETY: mask is 4 readable bytes; `buf` is exclusively borrowed so its
    // range is both readable and writable for `buf.len()` bytes. The FFI
    // kernel tolerates `output == input` (load-xor-store per element).
    unsafe {
        highway_fill_with_skip_mask(
            mask.as_ptr(),
            4,
            buf.as_mut_ptr(),
            buf.as_ptr(),
            buf.len(),
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
#[inline(always)]
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
#[inline(always)]
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

// ported from: src/highway/highway.zig
