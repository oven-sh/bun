//! Dev-only shims for native symbols normally supplied by Bun's C/C++ side,
//! so `cargo test -p bun_sys` / `-p bun_paths` link and run standalone.
//! Functional where tests execute the path (allocator, simdutf, highway),
//! loudly panicking where they cannot (WTF strings, crash handler).
//!
//! Never part of the product build — only `[dev-dependencies]` reference this
//! crate. libuv is real (prebuilt ninja objects, archived by `build.rs`).

use std::alloc::{Layout, alloc, alloc_zeroed, dealloc};
use std::ffi::{c_int, c_uint, c_void};
use std::sync::atomic::AtomicI32;

use bun_simdutf_sys::simdutf::{SIMDUTFResult, Status};

// ── never-called referents: fail loud if a test ever reaches one ──────────

macro_rules! panic_stubs {
    ($($name:ident),* $(,)?) => {$(
        #[unsafe(no_mangle)]
        extern "C" fn $name() -> ! {
            panic!(concat!(
                "bun_test_native_link: stub `",
                stringify!($name),
                "` was called at runtime — give it a functional shim"
            ));
        }
    )*};
}

panic_stubs!(
    BunString__createAtom,
    BunString__createExternalGloballyAllocatedLatin1,
    BunString__createExternalGloballyAllocatedUTF16,
    BunString__createStaticExternal,
    BunString__fromBytes,
    BunString__fromLatin1,
    BunString__fromLatin1Unitialized,
    BunString__fromUTF16,
    BunString__fromUTF16ToLatin1,
    BunString__fromUTF16Unitialized,
    BunString__toInt32,
    BunString__toThreadSafe,
    BunString__toWTFString,
    BunString__tryCreateAtom,
    Bun__WTFStringImpl__destroy,
    Bun__WTFStringImpl__ensureHash,
    WTFStringImpl__isThreadSafe,
    Bun__ANSI__next,
    Bun__visibleWidthExcludeANSI_latin1,
    Bun__visibleWidthExcludeANSI_utf8,
    Bun__visibleWidthExcludeANSI_utf16,
    Bun__visibleWidthExcludeANSI_utf8IndexAtWidth,
    WTF__parseES5Date,
);

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_dump_stack_trace() {
    // No-op: tests have std backtraces via RUST_BACKTRACE.
}

/// The prebuilt libuv objects come from a debug build, so `uv__init` wants
/// the debug-CRT report hook; the test binary links the release CRT. No-op.
#[allow(non_snake_case)]
#[unsafe(no_mangle)]
extern "C" fn _CrtSetReportHook(_hook: *mut c_void) -> *mut c_void {
    core::ptr::null_mut()
}

// ── process / environment facts ────────────────────────────────────────────

#[unsafe(no_mangle)]
extern "C" fn bun_initialize_process() {}

#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__initialize() {}

#[unsafe(no_mangle)]
extern "C" fn Bun__ramSize() -> usize {
    8 << 30
}

#[unsafe(no_mangle)]
extern "C" fn Bun__ttySetMode(_fd: c_int, _mode: c_int) -> c_int {
    0
}

#[unsafe(no_mangle)]
extern "C" fn getpid() -> c_int {
    std::process::id() as c_int
}

#[unsafe(no_mangle)]
extern "C" fn WTF__numberOfProcessorCores() -> c_int {
    std::thread::available_parallelism().map_or(1, |n| n.get() as c_int)
}

/// Mirrors the C side's `bun_is_stdio_null[3]`: 1 = the stream is NUL.
#[allow(non_upper_case_globals)]
#[unsafe(no_mangle)]
pub static bun_is_stdio_null: [AtomicI32; 3] =
    [AtomicI32::new(0), AtomicI32::new(0), AtomicI32::new(0)];

// ── WTF numeric helpers ─────────────────────────────────────────────────────

#[unsafe(no_mangle)]
unsafe extern "C" fn WTF__dtoa(buf: *mut u8, number: f64) -> usize {
    let s = if number.is_infinite() {
        if number > 0.0 {
            "Infinity".into()
        } else {
            "-Infinity".into()
        }
    } else {
        format!("{number}")
    };
    let bytes = s.as_bytes();
    assert!(bytes.len() <= 124, "WTF__dtoa buffer overflow");
    // SAFETY: caller passes a 124-byte buffer per the extern declaration.
    unsafe { core::ptr::copy_nonoverlapping(bytes.as_ptr(), buf, bytes.len()) };
    bytes.len()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn WTF__parseDouble(bytes: *const u8, length: usize, counted: *mut usize) -> f64 {
    // SAFETY: caller passes a valid (ptr, len) pair; `counted` is an out-param.
    let input = unsafe { core::slice::from_raw_parts(bytes, length) };
    let mut end = 0usize;
    let mut i = 0usize;
    if i < input.len() && (input[i] == b'+' || input[i] == b'-') {
        i += 1;
    }
    let digits = |i: &mut usize| {
        let start = *i;
        while *i < input.len() && input[*i].is_ascii_digit() {
            *i += 1;
        }
        *i > start
    };
    let int_digits = digits(&mut i);
    let mut frac_digits = false;
    if i < input.len() && input[i] == b'.' {
        i += 1;
        frac_digits = digits(&mut i);
    }
    if int_digits || frac_digits {
        end = i;
        if i < input.len() && (input[i] | 0x20) == b'e' {
            let mut j = i + 1;
            if j < input.len() && (input[j] == b'+' || input[j] == b'-') {
                j += 1;
            }
            let e_start = j;
            while j < input.len() && input[j].is_ascii_digit() {
                j += 1;
            }
            if j > e_start {
                end = j;
            }
        }
    }
    // SAFETY: out-param per the extern declaration.
    unsafe { counted.write(end) };
    if end == 0 {
        return f64::NAN;
    }
    core::str::from_utf8(&input[..end])
        .ok()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(f64::NAN)
}

// ── ares (used by IP-literal checks in bun_core::strings) ──────────────────

#[unsafe(no_mangle)]
unsafe extern "C" fn ares_inet_pton(
    af: c_int,
    src: *const core::ffi::c_char,
    dst: *mut c_void,
) -> c_int {
    // SAFETY: caller passes a NUL-terminated string per inet_pton contract.
    let Ok(s) = unsafe { core::ffi::CStr::from_ptr(src) }.to_str() else {
        return 0;
    };
    match af {
        2 => match s.parse::<std::net::Ipv4Addr>() {
            Ok(v4) => {
                // SAFETY: AF_INET dst is 4 bytes per contract.
                unsafe { core::ptr::copy_nonoverlapping(v4.octets().as_ptr(), dst.cast(), 4) };
                1
            }
            Err(_) => 0,
        },
        10 | 23 => match s.parse::<std::net::Ipv6Addr>() {
            Ok(v6) => {
                // SAFETY: AF_INET6 dst is 16 bytes per contract.
                unsafe { core::ptr::copy_nonoverlapping(v6.octets().as_ptr(), dst.cast(), 16) };
                1
            }
            Err(_) => 0,
        },
        _ => -1,
    }
}

// ── mimalloc: functional allocator over std::alloc ─────────────────────────
// Layout: the user pointer sits `align` bytes into the raw block; the 16 bytes
// directly below it store (requested size, offset back to the raw block).

const MI_MIN_ALIGN: usize = 16;

unsafe fn mi_alloc_impl(size: usize, align: usize, zero: bool) -> *mut c_void {
    let align = align.max(MI_MIN_ALIGN).next_power_of_two();
    let Some(total) = size.checked_add(align) else {
        return core::ptr::null_mut();
    };
    let Ok(layout) = Layout::from_size_align(total, align) else {
        return core::ptr::null_mut();
    };
    // SAFETY: layout has non-zero size (total >= align >= 16).
    let raw = unsafe {
        if zero {
            alloc_zeroed(layout)
        } else {
            alloc(layout)
        }
    };
    if raw.is_null() {
        return core::ptr::null_mut();
    }
    // SAFETY: `raw + align` is in-bounds; the two header slots live directly
    // below the user pointer, inside the `align >= 16`-byte gap.
    unsafe {
        let user = raw.add(align);
        (user.cast::<usize>()).sub(2).write(size);
        (user.cast::<usize>()).sub(1).write(align);
        user.cast()
    }
}

unsafe fn mi_header(p: *const c_void) -> (usize, usize) {
    // SAFETY: `p` was returned by `mi_alloc_impl`, so the header is present.
    unsafe {
        let size = p.cast::<usize>().sub(2).read();
        let align = p.cast::<usize>().sub(1).read();
        (size, align)
    }
}

#[unsafe(no_mangle)]
extern "C" fn mi_malloc(size: usize) -> *mut c_void {
    // SAFETY: shim allocation, header invariants established inside.
    unsafe { mi_alloc_impl(size, MI_MIN_ALIGN, false) }
}

#[unsafe(no_mangle)]
extern "C" fn mi_malloc_aligned(size: usize, alignment: usize) -> *mut c_void {
    // SAFETY: as above.
    unsafe { mi_alloc_impl(size, alignment, false) }
}

#[unsafe(no_mangle)]
extern "C" fn mi_zalloc(size: usize) -> *mut c_void {
    // SAFETY: as above.
    unsafe { mi_alloc_impl(size, MI_MIN_ALIGN, true) }
}

#[unsafe(no_mangle)]
extern "C" fn mi_zalloc_aligned(size: usize, alignment: usize) -> *mut c_void {
    // SAFETY: as above.
    unsafe { mi_alloc_impl(size, alignment, true) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn mi_free(p: *mut c_void) {
    if p.is_null() {
        return;
    }
    // SAFETY: `p` came from `mi_alloc_impl`; reverse its layout computation.
    unsafe {
        let (size, align) = mi_header(p);
        let raw = p.cast::<u8>().sub(align);
        dealloc(raw, Layout::from_size_align_unchecked(size + align, align));
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn mi_free_size(p: *mut c_void, _size: usize) {
    // SAFETY: same contract as mi_free.
    unsafe { mi_free(p) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn mi_free_size_aligned(p: *mut c_void, _size: usize, _alignment: usize) {
    // SAFETY: same contract as mi_free.
    unsafe { mi_free(p) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn mi_usable_size(p: *const c_void) -> usize {
    if p.is_null() {
        return 0;
    }
    // SAFETY: `p` came from `mi_alloc_impl`.
    unsafe { mi_header(p).0 }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn mi_malloc_usable_size(p: *const c_void) -> usize {
    // SAFETY: same contract as mi_usable_size.
    unsafe { mi_usable_size(p) }
}

unsafe fn mi_realloc_impl(p: *mut c_void, newsize: usize, align: usize) -> *mut c_void {
    if p.is_null() {
        // SAFETY: plain allocation.
        return unsafe { mi_alloc_impl(newsize, align, false) };
    }
    // SAFETY: `p` came from `mi_alloc_impl`; copy the payload prefix over.
    unsafe {
        let (old_size, _) = mi_header(p);
        let fresh = mi_alloc_impl(newsize, align, false);
        if fresh.is_null() {
            return core::ptr::null_mut();
        }
        core::ptr::copy_nonoverlapping(p.cast::<u8>(), fresh.cast::<u8>(), old_size.min(newsize));
        mi_free(p);
        fresh
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn mi_realloc(p: *mut c_void, newsize: usize) -> *mut c_void {
    // SAFETY: shim realloc.
    unsafe { mi_realloc_impl(p, newsize, MI_MIN_ALIGN) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn mi_realloc_aligned(
    p: *mut c_void,
    newsize: usize,
    alignment: usize,
) -> *mut c_void {
    // SAFETY: shim realloc.
    unsafe { mi_realloc_impl(p, newsize, alignment) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn mi_expand(p: *mut c_void, newsize: usize) -> *mut c_void {
    if p.is_null() {
        return core::ptr::null_mut();
    }
    // SAFETY: `p` came from `mi_alloc_impl`. mimalloc returns NULL when the
    // block cannot grow in place.
    unsafe {
        if newsize <= mi_header(p).0 {
            p
        } else {
            core::ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_new() -> *mut c_void {
    Box::into_raw(Box::new(0u8)).cast()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_destroy(heap: *mut c_void) {
    if heap.is_null() {
        return;
    }
    // Leaks the heap's allocations (real mimalloc frees them wholesale);
    // acceptable for test binaries.
    // SAFETY: `heap` came from `mi_heap_new`.
    drop(unsafe { Box::from_raw(heap.cast::<u8>()) });
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_malloc(_heap: *mut c_void, size: usize) -> *mut c_void {
    mi_malloc(size)
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_malloc_aligned(
    _heap: *mut c_void,
    size: usize,
    alignment: usize,
) -> *mut c_void {
    mi_malloc_aligned(size, alignment)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_realloc_aligned(
    _heap: *mut c_void,
    p: *mut c_void,
    newsize: usize,
    alignment: usize,
) -> *mut c_void {
    // SAFETY: shim realloc.
    unsafe { mi_realloc_impl(p, newsize, alignment) }
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_visit_blocks(
    _heap: *const c_void,
    _visit_all_blocks: bool,
    _visitor: *mut c_void,
    _arg: *mut c_void,
) -> bool {
    true // claims "visited nothing, successfully"
}

#[unsafe(no_mangle)]
extern "C" fn mi_is_in_heap_region(_p: *const c_void) -> bool {
    true
}

// ── simdutf: scalar transcoding over std ────────────────────────────────────
// (`convert_utf8_to_utf16le_with_errors` and `utf16_length_from_utf8` are NOT
// here: bun_paths defines those two inside its own test module already.)

unsafe fn slice<'a, T>(ptr: *const T, len: usize) -> &'a [T] {
    // SAFETY: every simdutf entry point receives a valid (ptr, len) pair.
    unsafe { core::slice::from_raw_parts(ptr, len) }
}

fn utf16_units(input: &[u16], be: bool) -> impl Iterator<Item = u16> + '_ {
    input
        .iter()
        .map(move |&u| if be { u.swap_bytes() } else { u })
}

fn write_utf8(out: *mut u8, mut written: usize, c: char) -> usize {
    let mut buf = [0u8; 4];
    let s = c.encode_utf8(&mut buf);
    // SAFETY: callers guarantee output capacity per the simdutf contract.
    unsafe { core::ptr::copy_nonoverlapping(s.as_ptr(), out.add(written), s.len()) };
    written += s.len();
    written
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_ascii(buf: *const u8, len: usize) -> bool {
    // SAFETY: valid (ptr, len) per contract.
    unsafe { slice(buf, len) }.iter().all(|&b| b < 0x80)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_ascii_with_errors(
    buf: *const u8,
    len: usize,
) -> SIMDUTFResult {
    // SAFETY: valid (ptr, len) per contract.
    let input = unsafe { slice(buf, len) };
    match input.iter().position(|&b| b >= 0x80) {
        None => SIMDUTFResult {
            status: Status::SUCCESS,
            count: len,
        },
        Some(i) => SIMDUTFResult {
            status: Status::TOO_LARGE,
            count: i,
        },
    }
}

unsafe fn convert_utf8_to_utf16(buf: *const u8, len: usize, out: *mut u16, be: bool) -> usize {
    // SAFETY: valid (ptr, len) per contract.
    let input = unsafe { slice(buf, len) };
    let Ok(s) = core::str::from_utf8(input) else {
        return 0; // simdutf's non-checked converters return 0 on invalid input
    };
    let mut written = 0usize;
    for unit in s.encode_utf16() {
        let unit = if be { unit.swap_bytes() } else { unit };
        // SAFETY: caller guarantees output capacity per the simdutf contract.
        unsafe { out.add(written).write(unit) };
        written += 1;
    }
    written
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf8_to_utf16le(
    buf: *const u8,
    len: usize,
    utf16_output: *mut u16,
) -> usize {
    // SAFETY: forwarded contract.
    unsafe { convert_utf8_to_utf16(buf, len, utf16_output, false) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf8_to_utf16be(
    buf: *const u8,
    len: usize,
    utf16_output: *mut u16,
) -> usize {
    // SAFETY: forwarded contract.
    unsafe { convert_utf8_to_utf16(buf, len, utf16_output, true) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf8_to_utf16be_with_errors(
    buf: *const u8,
    len: usize,
    utf16_output: *mut u16,
) -> SIMDUTFResult {
    // SAFETY: valid (ptr, len) per contract.
    let input = unsafe { slice(buf, len) };
    match core::str::from_utf8(input) {
        Ok(_) => SIMDUTFResult {
            status: Status::SUCCESS,
            // SAFETY: forwarded contract.
            count: unsafe { convert_utf8_to_utf16(buf, len, utf16_output, true) },
        },
        Err(e) => {
            let valid = e.valid_up_to();
            // SAFETY: forwarded contract (writes only the valid prefix).
            unsafe { convert_utf8_to_utf16(buf, valid, utf16_output, true) };
            SIMDUTFResult {
                status: Status::TOO_SHORT,
                count: valid,
            }
        }
    }
}

unsafe fn convert_utf16_to_utf8_with_errors(
    buf: *const u16,
    len: usize,
    out: *mut u8,
    be: bool,
) -> SIMDUTFResult {
    // SAFETY: valid (ptr, len) per contract.
    let input = unsafe { slice(buf, len) };
    let mut written = 0usize;
    let mut i = 0usize;
    let unit = |idx: usize| {
        let u = input[idx];
        if be { u.swap_bytes() } else { u }
    };
    while i < len {
        let u = unit(i);
        if (0xD800..0xDC00).contains(&u) {
            if i + 1 < len && (0xDC00..0xE000).contains(&unit(i + 1)) {
                let cp =
                    0x10000 + ((u32::from(u) - 0xD800) << 10) + (u32::from(unit(i + 1)) - 0xDC00);
                written = write_utf8(out, written, char::from_u32(cp).unwrap());
                i += 2;
                continue;
            }
            return SIMDUTFResult {
                status: Status::SURROGATE,
                count: i,
            };
        }
        if (0xDC00..0xE000).contains(&u) {
            return SIMDUTFResult {
                status: Status::SURROGATE,
                count: i,
            };
        }
        written = write_utf8(out, written, char::from_u32(u32::from(u)).unwrap());
        i += 1;
    }
    SIMDUTFResult {
        status: Status::SUCCESS,
        count: written,
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf16le_to_utf8_with_errors(
    buf: *const u16,
    len: usize,
    utf8_buffer: *mut u8,
) -> SIMDUTFResult {
    // SAFETY: forwarded contract.
    unsafe { convert_utf16_to_utf8_with_errors(buf, len, utf8_buffer, false) }
}

unsafe fn convert_valid_utf16_to_utf8(
    buf: *const u16,
    len: usize,
    out: *mut u8,
    be: bool,
) -> usize {
    // SAFETY: valid (ptr, len) per contract.
    let input = unsafe { slice(buf, len) };
    let mut written = 0usize;
    for c in char::decode_utf16(utf16_units(input, be)) {
        written = write_utf8(out, written, c.unwrap_or(char::REPLACEMENT_CHARACTER));
    }
    written
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_valid_utf16le_to_utf8(
    buf: *const u16,
    len: usize,
    utf8_buffer: *mut u8,
) -> usize {
    // SAFETY: forwarded contract.
    unsafe { convert_valid_utf16_to_utf8(buf, len, utf8_buffer, false) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_valid_utf16be_to_utf8(
    buf: *const u16,
    len: usize,
    utf8_buffer: *mut u8,
) -> usize {
    // SAFETY: forwarded contract.
    unsafe { convert_valid_utf16_to_utf8(buf, len, utf8_buffer, true) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf32_to_utf8_with_errors(
    buf: *const c_uint,
    len: usize,
    utf8_buffer: *mut u8,
) -> SIMDUTFResult {
    // SAFETY: valid (ptr, len) per contract.
    let input = unsafe { slice(buf, len) };
    let mut written = 0usize;
    for (i, &cp) in input.iter().enumerate() {
        let Some(c) = char::from_u32(cp) else {
            return SIMDUTFResult {
                status: Status::TOO_LARGE,
                count: i,
            };
        };
        written = write_utf8(utf8_buffer, written, c);
    }
    SIMDUTFResult {
        status: Status::SUCCESS,
        count: written,
    }
}

unsafe fn utf8_length_from_utf16(input: *const u16, length: usize, be: bool) -> usize {
    // SAFETY: valid (ptr, len) per contract.
    let input = unsafe { slice(input, length) };
    char::decode_utf16(utf16_units(input, be))
        .map(|r| r.unwrap_or(char::REPLACEMENT_CHARACTER).len_utf8())
        .sum()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le(input: *const u16, length: usize) -> usize {
    // SAFETY: forwarded contract.
    unsafe { utf8_length_from_utf16(input, length, false) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le_with_replacement(
    input: *const u16,
    length: usize,
) -> usize {
    // SAFETY: forwarded contract.
    unsafe { utf8_length_from_utf16(input, length, false) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16be(input: *const u16, length: usize) -> usize {
    // SAFETY: forwarded contract.
    unsafe { utf8_length_from_utf16(input, length, true) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf32(input: *const c_uint, length: usize) -> usize {
    // SAFETY: valid (ptr, len) per contract.
    unsafe { slice(input, length) }
        .iter()
        .map(|&cp| char::from_u32(cp).map_or(3, char::len_utf8))
        .sum()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf16_length_from_utf32(
    input: *const c_uint,
    length: usize,
) -> usize {
    // SAFETY: valid (ptr, len) per contract.
    unsafe { slice(input, length) }
        .iter()
        .map(|&cp| if cp >= 0x10000 { 2 } else { 1 })
        .sum()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_latin1(input: *const u8, length: usize) -> usize {
    // SAFETY: valid (ptr, len) per contract.
    let input = unsafe { slice(input, length) };
    length + input.iter().filter(|&&b| b >= 0x80).count()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf16_length_from_latin1(_input: *const u8, length: usize) -> usize {
    length
}

// ── highway: scalar equivalents of src/jsc/bindings/highway_strings.cpp ────

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    // SAFETY: valid (ptr, len) per contract.
    let h = unsafe { slice(haystack, haystack_len) };
    h.iter().position(|&c| c == needle).unwrap_or(haystack_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_any_char(
    text: *const u8,
    text_len: usize,
    chars: *const u8,
    chars_len: usize,
) -> usize {
    // SAFETY: valid (ptr, len) pairs per contract.
    let (t, cs) = unsafe { (slice(text, text_len), slice(chars, chars_len)) };
    t.iter().position(|c| cs.contains(c)).unwrap_or(text_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_newline_or_non_ascii(
    haystack: *const u8,
    haystack_len: usize,
) -> usize {
    // SAFETY: valid (ptr, len) per contract.
    let h = unsafe { slice(haystack, haystack_len) };
    h.iter()
        .position(|&b| b < 0x20 || b > 127)
        .unwrap_or(haystack_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_space_or_newline_or_non_ascii(
    text: *const u8,
    text_len: usize,
) -> usize {
    // SAFETY: valid (ptr, len) per contract.
    let t = unsafe { slice(text, text_len) };
    t.iter()
        .position(|&b| b <= 0x20 || b > 127)
        .unwrap_or(text_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_contains_newline_or_non_ascii_or_quote(
    text: *const u8,
    text_len: usize,
) -> bool {
    // SAFETY: valid (ptr, len) per contract.
    let t = unsafe { slice(text, text_len) };
    t.iter().any(|&b| b < 0x20 || b > 127 || b == b'"')
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_needs_escape_for_javascript_string(
    text: *const u8,
    text_len: usize,
    quote_char: u8,
) -> usize {
    // SAFETY: valid (ptr, len) per contract.
    let t = unsafe { slice(text, text_len) };
    t.iter()
        .position(|&b| {
            b == b'\\'
                || b < 0x20
                || b > 0x7E
                || b == quote_char
                || (quote_char == b'`' && b == b'$')
        })
        .unwrap_or(text_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_copy_ascii_prefix(src: *const u8, len: usize, dst: *mut u8) -> usize {
    // SAFETY: valid (ptr, len) per contract; dst has capacity for len.
    let s = unsafe { slice(src, len) };
    let n = s.iter().position(|&b| b >= 0x80).unwrap_or(len);
    // SAFETY: n <= len <= dst capacity.
    unsafe { core::ptr::copy_nonoverlapping(src, dst, n) };
    n
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_encode_hex_lower(input: *const u8, len: usize, output: *mut u8) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    // SAFETY: valid (ptr, len); output has 2 * len capacity per contract.
    let s = unsafe { slice(input, len) };
    for (i, &b) in s.iter().enumerate() {
        // SAFETY: in-bounds by the 2 * len output contract.
        unsafe {
            output.add(i * 2).write(HEX[usize::from(b >> 4)]);
            output.add(i * 2 + 1).write(HEX[usize::from(b & 0xF)]);
        }
    }
}
