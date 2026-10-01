//! Stand-ins for the native symbols that the parser crates take from bun's C++ side and from mimalloc.
//! Only what a parse reaches has a real body (allocation, the scanning helpers, number parsing, the stack limit);
//! the others stop the process when called. Test-only: never part of a build of bun.
#![allow(clippy::missing_safety_doc, unsafe_op_in_unsafe_fn)]

use core::ffi::{c_int, c_void};

macro_rules! unreached {
    ($($name:ident),* $(,)?) => {
        $(
            #[unsafe(no_mangle)]
            extern "C" fn $name() -> ! {
                eprintln!(concat!("buntree: the stand-in ", stringify!($name), " was called"));
                std::process::abort()
            }
        )*
    };
}

unreached!(
    Bun__JSC__operationMathPow,
    Bun__WTFStringImpl__destroy,
    Bun__linux_trace_emit,
    JSC__jsToNumber,
    URL__getFileURLString,
    WTF__dtoa,
    __bun_dispatch__TranspilerCacheImpl__Jsc__get,
    __bun_macro_context_call,
    __bun_macro_context_get_remap,
    compress2,
    is_executable_file,
    on_before_reload_process_posix,
    simdutf__base64_encode,
    highway_memrmem16,
);

#[unsafe(no_mangle)]
extern "C" fn Bun__linux_trace_init() -> c_int {
    0
}
#[unsafe(no_mangle)]
extern "C" fn bun_cpu_features() -> u8 {
    0
}
#[unsafe(no_mangle)]
extern "C" fn bun_restore_stdio() {}
#[unsafe(no_mangle)]
unsafe extern "C" fn getRSS(rss: *mut usize) -> c_int {
    *rss = 0;
    0
}
#[unsafe(no_mangle)]
unsafe extern "C" fn getPeakRSS(peak: *mut usize) -> c_int {
    *peak = 0;
    0
}

#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__getMaxStack() -> *mut c_void {
    let probe: u8 = 0;
    let approx_sp = (&raw const probe) as usize;
    (approx_sp.saturating_sub(512 * 1024)) as *mut c_void
}

#[unsafe(no_mangle)]
unsafe extern "C" fn WTF__parseDouble(bytes: *const u8, length: usize, counted: *mut usize) -> f64 {
    let s = core::slice::from_raw_parts(bytes, length);
    // The longest prefix that Rust reads as a decimal float, which is what the lexer hands over.
    let mut end = length;
    while end > 0 {
        if let Ok(text) = core::str::from_utf8(&s[..end]) {
            if let Ok(v) = text.parse::<f64>() {
                *counted = end;
                return v;
            }
        }
        end -= 1;
    }
    *counted = 0;
    0.0
}

// ── mimalloc on top of the C allocator. A heap is a token: its blocks are never freed as a group. ──
const MIN_ALIGN: usize = 16;

unsafe fn alloc(size: usize, alignment: usize, zero: bool) -> *mut c_void {
    let size = size.max(1);
    let p = if alignment <= MIN_ALIGN {
        libc::malloc(size)
    } else {
        let mut out: *mut c_void = core::ptr::null_mut();
        if libc::posix_memalign(&raw mut out, alignment, size) != 0 {
            return core::ptr::null_mut();
        }
        out
    };
    if zero && !p.is_null() {
        core::ptr::write_bytes(p.cast::<u8>(), 0, size);
    }
    p
}

static HEAP_TOKEN: u8 = 0;

#[unsafe(no_mangle)]
extern "C" fn mi_heap_new() -> *mut c_void {
    (&raw const HEAP_TOKEN).cast_mut().cast()
}
#[unsafe(no_mangle)]
extern "C" fn mi_heap_main() -> *mut c_void {
    (&raw const HEAP_TOKEN).cast_mut().cast()
}
#[unsafe(no_mangle)]
extern "C" fn mi_heap_destroy(_heap: *mut c_void) {}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_malloc(_heap: *mut c_void, size: usize) -> *mut c_void {
    alloc(size, MIN_ALIGN, false)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_zalloc(_heap: *mut c_void, size: usize) -> *mut c_void {
    alloc(size, MIN_ALIGN, true)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_malloc_aligned(_heap: *mut c_void, size: usize, alignment: usize) -> *mut c_void {
    alloc(size, alignment, false)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_zalloc_aligned(_heap: *mut c_void, size: usize, alignment: usize) -> *mut c_void {
    alloc(size, alignment, true)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_realloc_aligned(_heap: *mut c_void, p: *mut c_void, newsize: usize, alignment: usize) -> *mut c_void {
    if p.is_null() {
        return alloc(newsize, alignment, false);
    }
    if alignment <= MIN_ALIGN {
        return libc::realloc(p, newsize.max(1));
    }
    let fresh = alloc(newsize, alignment, false);
    if !fresh.is_null() {
        let old = libc::malloc_usable_size(p);
        core::ptr::copy_nonoverlapping(p.cast::<u8>(), fresh.cast::<u8>(), old.min(newsize));
        libc::free(p);
    }
    fresh
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_malloc(size: usize) -> *mut c_void {
    alloc(size, MIN_ALIGN, false)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_zalloc(size: usize) -> *mut c_void {
    alloc(size, MIN_ALIGN, true)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_malloc_aligned(size: usize, alignment: usize) -> *mut c_void {
    alloc(size, alignment, false)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_zalloc_aligned(size: usize, alignment: usize) -> *mut c_void {
    alloc(size, alignment, true)
}
#[unsafe(no_mangle)]
extern "C" fn mi_expand(_p: *mut c_void, _newsize: usize) -> *mut c_void {
    core::ptr::null_mut()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_free_size(p: *mut c_void, _size: usize) {
    libc::free(p)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_free_size_aligned(p: *mut c_void, _size: usize, _alignment: usize) {
    libc::free(p)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_malloc_usable_size(p: *const c_void) -> usize {
    if p.is_null() { 0 } else { libc::malloc_usable_size(p.cast_mut()) }
}
#[unsafe(no_mangle)]
extern "C" fn mi_is_in_heap_region(_p: *const c_void) -> bool {
    true
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_process_info(a: *mut usize, b: *mut usize, c: *mut usize, d: *mut usize, e: *mut usize, f: *mut usize, g: *mut usize, h: *mut usize) {
    for p in [a, b, c, d, e, f, g, h] {
        if !p.is_null() {
            *p = 0;
        }
    }
}

// ── The scanning helpers of highway_strings.cpp, one byte at a time. Not found is the length. ──
unsafe fn first(text: *const u8, len: usize, hit: impl Fn(u8) -> bool) -> usize {
    let s = core::slice::from_raw_parts(text, len);
    s.iter().position(|&c| hit(c)).unwrap_or(len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(haystack: *const u8, len: usize, needle: u8) -> usize {
    first(haystack, len, |c| c == needle)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_last_index_of_char(haystack: *const u8, len: usize, needle: u8) -> usize {
    let s = core::slice::from_raw_parts(haystack, len);
    s.iter().rposition(|&c| c == needle).unwrap_or(len)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_any_char(text: *const u8, len: usize, chars: *const u8, chars_len: usize) -> usize {
    let cs = core::slice::from_raw_parts(chars, chars_len);
    first(text, len, |c| cs.contains(&c))
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_interesting_character_in_string_literal(text: *const u8, len: usize, quote: u8) -> usize {
    first(text, len, |c| c == quote || c == b'\\' || c < 0x20 || c > 0x7E)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_interesting_character_in_multiline_comment(text: *const u8, len: usize) -> usize {
    first(text, len, |c| c == b'*' || c == b'\r' || c == b'\n' || c > 127)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_newline_or_non_ascii_or_hash_or_at(text: *const u8, len: usize) -> usize {
    first(text, len, |c| c == b'#' || c == b'@' || c < 0x20 || c > 0x7E)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_space_or_newline_or_non_ascii(text: *const u8, len: usize) -> usize {
    first(text, len, |c| c <= b' ' || c > 127)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_contains_newline_or_non_ascii_or_quote(text: *const u8, len: usize) -> bool {
    first(text, len, |c| c > 127 || c < 0x20 || c == b'"') != len
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_needs_escape_for_javascript_string(text: *const u8, len: usize, quote: u8) -> usize {
    first(text, len, |c| c >= 127 || c < 0x20 || c == b'\\' || c == quote || (quote == b'`' && c == b'$'))
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memmem(haystack: *const u8, haystack_len: usize, needle: *const u8, needle_len: usize) -> *const u8 {
    let (h, n) = (core::slice::from_raw_parts(haystack, haystack_len), core::slice::from_raw_parts(needle, needle_len));
    if n.is_empty() {
        return haystack;
    }
    if h.len() < n.len() {
        return core::ptr::null();
    }
    match h.windows(n.len()).position(|w| w == n) {
        Some(i) => haystack.add(i),
        None => core::ptr::null(),
    }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memrmem(haystack: *const u8, haystack_len: usize, needle: *const u8, needle_len: usize) -> usize {
    let (h, n) = (core::slice::from_raw_parts(haystack, haystack_len), core::slice::from_raw_parts(needle, needle_len));
    if n.is_empty() {
        return haystack_len;
    }
    if h.len() < n.len() {
        return usize::MAX;
    }
    h.windows(n.len()).rposition(|w| w == n).unwrap_or(usize::MAX)
}

// ── simdutf. `status` 0 is success; any other value is an error at `count`. ──
#[repr(C)]
struct SimdutfResult {
    status: i32,
    count: usize,
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_ascii(buf: *const u8, len: usize) -> bool {
    first(buf, len, |c| c > 127) == len
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_ascii_with_errors(buf: *const u8, len: usize) -> SimdutfResult {
    let at = first(buf, len, |c| c > 127);
    SimdutfResult { status: if at == len { 0 } else { 1 }, count: at }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_utf8(buf: *const u8, len: usize) -> bool {
    core::str::from_utf8(core::slice::from_raw_parts(buf, len)).is_ok()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf16_length_from_utf8(input: *const u8, length: usize) -> usize {
    String::from_utf8_lossy(core::slice::from_raw_parts(input, length)).encode_utf16().count()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le(input: *const u16, length: usize) -> usize {
    String::from_utf16_lossy(core::slice::from_raw_parts(input, length)).len()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le_with_replacement(input: *const u16, length: usize) -> usize {
    String::from_utf16_lossy(core::slice::from_raw_parts(input, length)).len()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf8_to_utf16le_with_errors(buf: *const u8, len: usize, out: *mut u16) -> SimdutfResult {
    match core::str::from_utf8(core::slice::from_raw_parts(buf, len)) {
        Ok(text) => {
            let mut n = 0;
            for unit in text.encode_utf16() {
                *out.add(n) = unit;
                n += 1;
            }
            SimdutfResult { status: 0, count: n }
        }
        Err(e) => SimdutfResult { status: 1, count: e.valid_up_to() },
    }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf16le_to_utf8_with_errors(buf: *const u16, len: usize, out: *mut u8) -> SimdutfResult {
    match String::from_utf16(core::slice::from_raw_parts(buf, len)) {
        Ok(text) => {
            core::ptr::copy_nonoverlapping(text.as_ptr(), out, text.len());
            SimdutfResult { status: 0, count: text.len() }
        }
        Err(_) => SimdutfResult { status: 1, count: 0 },
    }
}
