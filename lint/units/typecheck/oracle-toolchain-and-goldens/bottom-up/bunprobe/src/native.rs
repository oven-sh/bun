//! The native symbols that `src/parsers/native_test_shims.rs` of the repository stands in for, copied from it
//! (all but `__bun_crash_handler_out_of_memory`, which `bun_crash_handler` of the parser's closure defines).

#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__getMaxStack() -> *mut core::ffi::c_void {
    let probe: u8 = 0;
    let approx_sp = (&raw const probe) as usize;
    (approx_sp.saturating_sub(512 * 1024)) as *mut core::ffi::c_void
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    let h = unsafe { core::slice::from_raw_parts(haystack, haystack_len) };
    h.iter().position(|&c| c == needle).unwrap_or(haystack_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_any_char(
    text: *const u8,
    text_len: usize,
    chars: *const u8,
    chars_len: usize,
) -> usize {
    let (t, cs) = unsafe {
        (
            core::slice::from_raw_parts(text, text_len),
            core::slice::from_raw_parts(chars, chars_len),
        )
    };
    t.iter().position(|c| cs.contains(c)).unwrap_or(text_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memmem(
    haystack: *const u8,
    haystack_len: usize,
    needle: *const u8,
    needle_len: usize,
) -> *const u8 {
    let (h, n) = unsafe {
        (
            core::slice::from_raw_parts(haystack, haystack_len),
            core::slice::from_raw_parts(needle, needle_len),
        )
    };
    if n.is_empty() {
        return haystack;
    }
    if h.len() < n.len() {
        return core::ptr::null();
    }
    match (0..=h.len() - n.len()).find(|&i| h[i..i + n.len()] == *n) {
        Some(i) => unsafe { haystack.add(i) },
        None => core::ptr::null(),
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_last_index_of_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    let h = unsafe { core::slice::from_raw_parts(haystack, haystack_len) };
    h.iter().rposition(|&c| c == needle).unwrap_or(haystack_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_not_char(
    haystack: *const u8,
    haystack_len: usize,
    value: u8,
) -> usize {
    let h = unsafe { core::slice::from_raw_parts(haystack, haystack_len) };
    h.iter().position(|&c| c != value).unwrap_or(haystack_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_count_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    let h = unsafe { core::slice::from_raw_parts(haystack, haystack_len) };
    h.iter().filter(|&&c| c == needle).count()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_last_index_of_any_char(
    text: *const u8,
    text_len: usize,
    chars: *const u8,
    chars_len: usize,
) -> usize {
    let (t, cs) = unsafe {
        (
            core::slice::from_raw_parts(text, text_len),
            core::slice::from_raw_parts(chars, chars_len),
        )
    };
    t.iter().rposition(|c| cs.contains(c)).unwrap_or(text_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memrmem(
    haystack: *const u8,
    haystack_len: usize,
    needle: *const u8,
    needle_len: usize,
) -> usize {
    let (h, n) = unsafe {
        (
            core::slice::from_raw_parts(haystack, haystack_len),
            core::slice::from_raw_parts(needle, needle_len),
        )
    };
    if n.is_empty() {
        return h.len();
    }
    if h.len() < n.len() {
        return usize::MAX;
    }
    (0..=h.len() - n.len())
        .rev()
        .find(|&i| h[i..i + n.len()] == *n)
        .unwrap_or(usize::MAX)
}

// ── The rest of what the closure of `bun_js_parser` needs at link time. The scans follow the scalar tails of
//    src/jsc/bindings/highway_strings.cpp; the functions that a parse never reaches are stubs.

unsafe fn bytes<'a>(p: *const u8, len: usize) -> &'a [u8] {
    if len == 0 {
        return &[];
    }
    // SAFETY: the caller passes a live buffer of `len` bytes.
    unsafe { core::slice::from_raw_parts(p, len) }
}

unsafe fn units<'a>(p: *const u16, len: usize) -> &'a [u16] {
    if len == 0 {
        return &[];
    }
    // SAFETY: the caller passes a live buffer of `len` code units.
    unsafe { core::slice::from_raw_parts(p, len) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_interesting_character_in_string_literal(text: *const u8, text_len: usize, quote: u8) -> usize {
    let t = unsafe { bytes(text, text_len) };
    t.iter().position(|&c| c == quote || c == b'\\' || c < 0x20 || c > 0x7E).unwrap_or(text_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_interesting_character_in_multiline_comment(text: *const u8, text_len: usize) -> usize {
    let t = unsafe { bytes(text, text_len) };
    t.iter().position(|&c| c == b'*' || c == b'\r' || c == b'\n' || c > 127).unwrap_or(text_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_newline_or_non_ascii_or_hash_or_at(text: *const u8, text_len: usize) -> usize {
    let t = unsafe { bytes(text, text_len) };
    t.iter().position(|&c| c == b'#' || c == b'@' || c < 0x20 || c > 127).unwrap_or(text_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_space_or_newline_or_non_ascii(text: *const u8, text_len: usize) -> usize {
    let t = unsafe { bytes(text, text_len) };
    t.iter().position(|&c| c <= b' ' || c > 127).unwrap_or(text_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_contains_newline_or_non_ascii_or_quote(text: *const u8, text_len: usize) -> bool {
    let t = unsafe { bytes(text, text_len) };
    t.iter().any(|&c| c > 127 || c < 0x20 || c == b'"')
}

// Only the printer calls this one: an early stop is always correct there.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_needs_escape_for_javascript_string(text: *const u8, text_len: usize, quote: u8) -> usize {
    let t = unsafe { bytes(text, text_len) };
    t.iter().position(|&c| c == quote || c == b'\\' || c < 0x20 || c > 0x7E || (quote == b'`' && c == b'$')).unwrap_or(text_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memrmem16(haystack: *const u16, haystack_len: usize, needle: *const u16, needle_len: usize) -> usize {
    let (h, n) = unsafe { (units(haystack, haystack_len), units(needle, needle_len)) };
    if n.is_empty() {
        return h.len();
    }
    if h.len() < n.len() {
        return usize::MAX;
    }
    (0..=h.len() - n.len()).rev().find(|&i| h[i..i + n.len()] == *n).unwrap_or(usize::MAX)
}

#[repr(C)]
struct SimdutfResult {
    status: i32,
    count: usize,
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_ascii(buf: *const u8, len: usize) -> bool {
    unsafe { bytes(buf, len) }.is_ascii()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_utf8(buf: *const u8, len: usize) -> bool {
    core::str::from_utf8(unsafe { bytes(buf, len) }).is_ok()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le(input: *const u16, length: usize) -> usize {
    char::decode_utf16(unsafe { units(input, length) }.iter().copied()).map(|c| c.map_or(3, char::len_utf8)).sum()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le_with_replacement(input: *const u16, length: usize) -> usize {
    unsafe { simdutf__utf8_length_from_utf16le(input, length) }
}

// status 0: `count` bytes were written; status 6 (surrogate): `count` is the index of the lone surrogate.
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf16le_to_utf8_with_errors(buf: *const u16, len: usize, out: *mut u8) -> SimdutfResult {
    let input = unsafe { units(buf, len) };
    let (mut read, mut written) = (0usize, 0usize);
    for c in char::decode_utf16(input.iter().copied()) {
        let Ok(c) = c else {
            return SimdutfResult { status: 6, count: read };
        };
        let mut tmp = [0u8; 4];
        let encoded = c.encode_utf8(&mut tmp).as_bytes();
        // SAFETY: the caller sized `out` with `simdutf__utf8_length_from_utf16le`.
        unsafe { core::ptr::copy_nonoverlapping(encoded.as_ptr(), out.add(written), encoded.len()) };
        written += encoded.len();
        read += c.len_utf16();
    }
    SimdutfResult { status: 0, count: written }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__base64_encode(input: *const u8, length: usize, output: *mut u8, is_urlsafe: core::ffi::c_int) -> usize {
    let table: &[u8; 64] = if is_urlsafe != 0 {
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    } else {
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    };
    let mut written = 0usize;
    let mut put = |b: u8| {
        // SAFETY: the caller sized `output` for the encoded length.
        unsafe { output.add(written).write(b) };
        written += 1;
    };
    for chunk in unsafe { bytes(input, length) }.chunks(3) {
        let n = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        put(table[(n >> 18) as usize & 63]);
        put(table[(n >> 12) as usize & 63]);
        if chunk.len() > 1 {
            put(table[(n >> 6) as usize & 63]);
        } else if is_urlsafe == 0 {
            put(b'=');
        }
        if chunk.len() > 2 {
            put(table[n as usize & 63]);
        } else if is_urlsafe == 0 {
            put(b'=');
        }
    }
    written
}

// The longest prefix that reads as a decimal number, and how many bytes it has: what the lexer asks of WTF::parseDouble.
#[unsafe(no_mangle)]
unsafe extern "C" fn WTF__parseDouble(text: *const u8, length: usize, counted: *mut usize) -> f64 {
    let t = unsafe { bytes(text, length) };
    let mut end = 0usize;
    if end < t.len() && (t[end] == b'+' || t[end] == b'-') {
        end += 1;
    }
    let digits_start = end;
    while end < t.len() && t[end].is_ascii_digit() {
        end += 1;
    }
    let mut digits = end - digits_start;
    if end < t.len() && t[end] == b'.' {
        let mut frac = end + 1;
        while frac < t.len() && t[frac].is_ascii_digit() {
            frac += 1;
        }
        digits += frac - end - 1;
        if digits > 0 {
            end = frac;
        }
    }
    if digits == 0 {
        // SAFETY: `counted` is a valid out pointer.
        unsafe { counted.write(0) };
        return 0.0;
    }
    if end < t.len() && (t[end] == b'e' || t[end] == b'E') {
        let mut exp = end + 1;
        if exp < t.len() && (t[exp] == b'+' || t[exp] == b'-') {
            exp += 1;
        }
        let exp_digits = exp;
        while exp < t.len() && t[exp].is_ascii_digit() {
            exp += 1;
        }
        if exp > exp_digits {
            end = exp;
        }
    }
    // SAFETY: `counted` is a valid out pointer.
    unsafe { counted.write(end) };
    core::str::from_utf8(&t[..end]).ok().and_then(|s| s.parse::<f64>().ok()).unwrap_or(f64::NAN)
}

#[unsafe(no_mangle)]
extern "Rust" fn __bun_macro_context_get_remap(_data: *mut core::ffi::c_void, _path: &[u8]) -> usize {
    0
}

#[unsafe(no_mangle)]
extern "C" fn bun_cpu_features() -> u8 {
    0
}

#[unsafe(no_mangle)]
extern "C" fn bun_restore_stdio() {}

#[unsafe(no_mangle)]
extern "C" fn on_before_reload_process_posix() {}

#[unsafe(no_mangle)]
extern "C" fn compress2(_dest: *mut u8, _dest_len: *mut usize, _source: *const u8, _source_len: usize, _level: core::ffi::c_int) -> core::ffi::c_int {
    -2
}

#[unsafe(no_mangle)]
unsafe extern "C" fn getRSS(rss: *mut usize) -> core::ffi::c_int {
    // SAFETY: `rss` is a valid out pointer.
    unsafe { rss.write(0) };
    0
}

#[unsafe(no_mangle)]
unsafe extern "C" fn getPeakRSS(peak: *mut usize) -> core::ffi::c_int {
    // SAFETY: `peak` is a valid out pointer.
    unsafe { peak.write(0) };
    0
}

#[unsafe(no_mangle)]
extern "C" fn is_executable_file(_path: *const core::ffi::c_char) -> bool {
    false
}

#[unsafe(no_mangle)]
unsafe extern "C" fn mi_process_info(a: *mut usize, b: *mut usize, c: *mut usize, d: *mut usize, e: *mut usize, f: *mut usize, g: *mut usize, h: *mut usize) {
    for p in [a, b, c, d, e, f, g, h] {
        if !p.is_null() {
            // SAFETY: each non-null argument is a valid out pointer.
            unsafe { p.write(0) };
        }
    }
}
