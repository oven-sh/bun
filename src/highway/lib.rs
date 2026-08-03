// Direct `extern "C"` re-exports of the Google Highway SIMD C++ helpers.
// Per crate map: `bun.highway.*` → `bun_highway::*` (same C++ backing).

unsafe extern "C" {
    fn highway_index_of_char(haystack: *const u8, haystack_len: usize, needle: u8) -> usize;

    fn highway_memmem(
        haystack: *const u8,
        haystack_len: usize,
        needle: *const u8,
        needle_len: usize,
    ) -> *const u8;

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

    fn highway_xxhash3_64(input: *const u8, len: usize, seed: u64) -> u64;

    fn highway_xxhash32(input: *const u8, len: usize, seed: u32) -> u32;

    fn highway_xxhash64(input: *const u8, len: usize, seed: u64) -> u64;

    fn highway_xxhash64_reset(state: *mut u8, seed: u64);
    fn highway_xxhash64_update(state: *mut u8, input: *const u8, len: usize);
    fn highway_xxhash64_digest(state: *const u8) -> u64;

    fn highway_parse_mappings(
        bytes: *const u8,
        len: usize,
        out_generated: *mut i32,
        out_original: *mut i32,
        out_src_idx: *mut i32,
        out_name_idx: *mut i32,
        cap: usize,
        sources_count: i32,
        state: *mut i32,
        err_at: *mut usize,
    ) -> usize;

    fn highway_count_mapping_delims(bytes: *const u8, len: usize) -> usize;

    fn highway_json_index_chunk(
        input: *const u8,
        len: usize,
        base_offset: usize,
        out_indices: *mut u32,
        out_dirty: *mut u64,
        inout_state: *mut u64,
        out_flags: *mut u32,
    ) -> usize;
}

// NOTE: every public wrapper below is `#[inline(always)]`. They are thin
// ptr/len shims around the `extern "C"` highway_* dispatch stubs; inlining
// them puts the FFI call directly at the hot lexer/printer call site so that
// (a) the Rust-side frame disappears unconditionally, and (b) cross-language
// LTO (`--profile=btg`, crossLangLto=true) can fold the C dispatch shim
// straight into the caller. Without this the profile shows the C shim as a
// distinct hot leaf (e.g. `highway_index_of_newline_or_non_ascii` self-samples
// in lint/create-vue benches).

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
pub fn memmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    if haystack.len() < needle.len() {
        return None;
    }
    // SAFETY: both (ptr,len) pairs are valid readable ranges.
    let p = unsafe {
        highway_memmem(
            haystack.as_ptr(),
            haystack.len(),
            needle.as_ptr(),
            needle.len(),
        )
    };
    if p.is_null() {
        None
    } else {
        // SAFETY: highway_memmem returns a pointer within `haystack` on success.
        Some(unsafe { p.offset_from(haystack.as_ptr()) } as usize)
    }
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

// `&[u16]` requires
// 2-byte alignment. Callers with unaligned data must go through the raw extern.
#[inline(always)]
pub fn copy_u16_to_u8(input: &[u16], output: &mut [u8]) {
    // SAFETY: input.ptr/len readable, output.ptr writable for at least input.len() bytes
    // (caller contract: output.len() >= input.len()).
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
/// Callers routinely pass the same buffer for both; the safe wrapper above
/// can't express that without violating `&mut`/`&` aliasing. The C++ kernel
/// reads-before-writes per lane (it's `dst[i] = src[i] ^ mask[i&3]`), so
/// feeding it `src == dst` is sound.
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

/// XxHash3 (`XXH3_64bits_withSeed`), runtime-dispatched to the widest SIMD ISA
/// the CPU supports. Output is bit-identical to the xxHash reference for every
/// input — only the long-input stripe loop is vectorized and its per-64-bit-
/// lane math does not depend on vector width.
///
/// `seed` is the full 64-bit seed. Callers wanting the JS `@truncate(seed)`
/// semantics must truncate before calling (as `HashObject` does).
#[inline(always)]
pub fn xxhash3_64(seed: u64, input: &[u8]) -> u64 {
    // SAFETY: `input.ptr/len` are a valid readable range; for an empty slice
    // the kernel takes the `len == 0` branch and never dereferences the
    // pointer. The kernel only reads `input` and writes nothing through it.
    unsafe { highway_xxhash3_64(input.as_ptr(), input.len(), seed) }
}

/// XxHash32 one-shot. Bit-identical to the xxHash reference.
/// Scalar (XXH32 has no SIMD form); lives in the same C++
/// TU as the XXH3 kernel.
#[inline(always)]
pub fn xxhash32(seed: u32, input: &[u8]) -> u32 {
    // SAFETY: `input.ptr/len` are a valid readable range; read-only, and the
    // pointer is never dereferenced when `len == 0`.
    unsafe { highway_xxhash32(input.as_ptr(), input.len(), seed) }
}

/// XxHash64 one-shot. Bit-identical to the xxHash reference.
#[inline(always)]
pub fn xxhash64(seed: u64, input: &[u8]) -> u64 {
    // SAFETY: `input.ptr/len` are a valid readable range; read-only, and the
    // pointer is never dereferenced when `len == 0`.
    unsafe { highway_xxhash64(input.as_ptr(), input.len(), seed) }
}

/// Streaming XxHash64 state. Mirrors the C++ `XXH64State` POD (80 bytes,
/// 8-aligned; a compile-time `static_assert` on the C++ side keeps them in
/// sync). `reset` → any number of `update(chunk)` → `digest()`; the result
/// equals `xxhash64` of the concatenation. Bit-identical to the xxHash
/// reference streaming API.
#[repr(C, align(8))]
pub struct XxHash64State {
    // 10 u64 == 80 bytes. Opaque storage; only the C kernel interprets it.
    _storage: [u64; 10],
}

impl XxHash64State {
    #[inline(always)]
    pub fn new(seed: u64) -> Self {
        let mut state = Self { _storage: [0; 10] };
        // SAFETY: `state` is exactly `sizeof(XXH64State)` bytes of writable,
        // 8-aligned storage; the kernel only writes within it.
        unsafe { highway_xxhash64_reset(state._storage.as_mut_ptr().cast(), seed) };
        state
    }

    #[inline(always)]
    pub fn update(&mut self, bytes: &[u8]) {
        // SAFETY: `self._storage` is a valid XXH64State; `bytes.ptr/len` are a
        // valid readable range (never dereferenced when empty).
        unsafe {
            highway_xxhash64_update(
                self._storage.as_mut_ptr().cast(),
                bytes.as_ptr(),
                bytes.len(),
            )
        };
    }

    #[inline(always)]
    pub fn digest(&self) -> u64 {
        // SAFETY: `self._storage` is a valid XXH64State; digest only reads it.
        unsafe { highway_xxhash64_digest(self._storage.as_ptr().cast()) }
    }
}

/// In/out accumulator state for [`parse_mappings`]. Layout must match the
/// `kSt*` indices in `highway_sourcemap.cpp`.
#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct ParseMappingsState {
    pub gen_line: i32,
    pub gen_col: i32,
    pub orig_line: i32,
    pub orig_col: i32,
    pub src_idx: i32,
    pub name_idx: i32,
    pub needs_sort: i32,
    pub has_names: i32,
    pub fast_blocks: i32,
    pub slow_blocks: i32,
}

// The C++ kernel indexes this struct as `int32_t state[10]` via the kSt*
// constants, and `highway_sourcemap.cpp` static_asserts each offsetof against
// its kSt* index. This pins the size from the Rust side so adding a field
// here without updating the C++ enum fails the build.
const _: () =
    assert!(core::mem::size_of::<ParseMappingsState>() == 10 * core::mem::size_of::<i32>());

/// Count of `,` and `;` bytes in `bytes`. `count + 1` is an upper bound on
/// the number of segments (and therefore the number of output rows) for a
/// source-map `mappings` string.
#[inline(always)]
pub fn count_mapping_delims(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        return 0;
    }
    // SAFETY: `bytes.ptr/len` are a valid readable range.
    unsafe { highway_count_mapping_delims(bytes.as_ptr(), bytes.len()) }
}

/// JSON structural index (simdjson-style stage 1) for one chunk of a document.
#[inline(always)]
pub fn json_structural_index_chunk(
    chunk: &[u8],
    base_offset: usize,
    out: &mut [core::mem::MaybeUninit<u32>],
    dirty: &mut [u64],
    state: &mut [u64; 3],
) -> (usize, u32) {
    assert!(out.len() >= chunk.len() + 66);
    assert!(dirty.len() >= (chunk.len().div_ceil(64)).div_ceil(64));
    assert!(base_offset.is_multiple_of(4096));
    let mut flags: u32 = 0;
    // SAFETY: the slices satisfy the kernel's size requirements (asserted above).
    let n = unsafe {
        highway_json_index_chunk(
            chunk.as_ptr(),
            chunk.len(),
            base_offset,
            out.as_mut_ptr().cast::<u32>(),
            dirty.as_mut_ptr(),
            state.as_mut_ptr(),
            &raw mut flags,
        )
    };
    (n, flags)
}

/// Raw output column pointers for [`parse_mappings`]. Each points to `cap`
/// writable rows: `generated`/`original` as `[line, column]` i32 pairs
/// (byte-compatible with `bun_sourcemap::LineColumnOffset`, which is
/// `repr(C)`); `src_idx`/`name_idx` as one i32 per row. `name_idx` may be
/// null when the caller doesn't store names.
pub struct ParseMappingsOut {
    pub generated: *mut [i32; 2],
    pub original: *mut [i32; 2],
    pub src_idx: *mut i32,
    pub name_idx: *mut i32,
    pub cap: usize,
}

/// SIMD decode of a source-map `mappings` string. Writes one row per 4- or
/// 5-field segment (accumulated absolute values) into `out`, up to
/// `out.cap`. On return, `err_at` is the byte offset in `bytes` where the
/// caller should resume with the scalar decoder (== len when the whole
/// input was consumed), and `state` holds the accumulator at that offset.
/// Returns the number of rows written.
///
/// Any anomaly (invalid byte, unsupported field count, out-of-range value,
/// segment longer than one SIMD block, output capacity exhausted, < one
/// block of input remaining) ends the SIMD pass at the start of the
/// offending segment; the scalar decoder owns all error reporting, so error
/// messages and byte offsets are unchanged from a pure-scalar parse.
///
/// # Safety
/// `out.generated`, `out.original` and `out.src_idx` must each be valid
/// for `out.cap` writes of their element type; `out.name_idx` likewise when
/// non-null. The four ranges must not overlap each other or `bytes`.
#[inline]
pub unsafe fn parse_mappings(
    bytes: &[u8],
    out: &ParseMappingsOut,
    sources_count: i32,
    state: &mut ParseMappingsState,
    err_at: &mut usize,
) -> usize {
    if bytes.is_empty() || out.cap == 0 {
        *err_at = 0;
        return 0;
    }

    // SAFETY: caller contract covers the output pointers; `bytes` is a
    // valid readable range; `state` is a `#[repr(C)]` struct of 10
    // contiguous i32s matching the kernel's `kSt*` indices; `err_at` is a
    // valid write target. The kernel writes at most `out.cap` rows and
    // never reads past `bytes.len()`.
    unsafe {
        highway_parse_mappings(
            bytes.as_ptr(),
            bytes.len(),
            out.generated.cast::<i32>(),
            out.original.cast::<i32>(),
            out.src_idx,
            out.name_idx,
            out.cap,
            sources_count,
            core::ptr::from_mut::<ParseMappingsState>(state).cast::<i32>(),
            err_at,
        )
    }
}
