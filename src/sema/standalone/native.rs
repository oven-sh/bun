//! Native symbols that Bun's C and C++ side provides to the parser, for binaries that link the parser and nothing
//! else: this crate's command line tool and `bun_sema`'s tests. Plain loops instead of SIMD, and a bump allocator
//! instead of mimalloc. Never part of the real build.

#![allow(clippy::missing_safety_doc)]

use core::ffi::{c_char, c_int, c_void};

// ───────────────────────────── mimalloc ─────────────────────────────

// With `--cfg bun_sema_mimalloc` the real mimalloc is linked instead, to measure with Bun's
// allocator.
#[cfg(not(bun_sema_mimalloc))]
mod fake_mimalloc {
    use super::*;

    #[repr(C)]
    struct Header {
        /// The pointer `malloc` returned, for a block that is freed individually. Null for a block
        /// that is freed with its heap.
        base: *mut c_void,
        size: usize,
    }

    const HEADER: usize = core::mem::size_of::<Header>();
    const CHUNK: usize = 1 << 20;

    struct Heap {
        chunks: Vec<*mut c_void>,
        at: usize,
        end: usize,
    }

    fn main_heap() -> *mut Heap {
        core::ptr::without_provenance_mut(8)
    }

    unsafe fn place(
        base: *mut c_void,
        from: usize,
        size: usize,
        align: usize,
        owned: bool,
    ) -> *mut c_void {
        let user = (from + HEADER).next_multiple_of(align.max(16));
        // SAFETY: the caller reserved `size + align + HEADER` bytes from `from`.
        unsafe {
            let user_ptr = base.byte_add(user - base.addr());
            user_ptr.cast::<Header>().sub(1).write(Header {
                base: if owned { base } else { core::ptr::null_mut() },
                size,
            });
            user_ptr
        }
    }

    fn global_alloc(size: usize, align: usize, zero: bool) -> *mut c_void {
        let total = size + align.max(16) + HEADER;
        // SAFETY: plain libc allocation.
        let base = unsafe {
            if zero {
                libc::calloc(1, total)
            } else {
                libc::malloc(total)
            }
        };
        if base.is_null() {
            return base;
        }
        // SAFETY: `total` bytes were reserved.
        unsafe { place(base, base.addr(), size, align, true) }
    }

    unsafe fn heap_alloc(heap: *mut Heap, size: usize, align: usize, zero: bool) -> *mut c_void {
        if heap == main_heap() {
            return global_alloc(size, align, zero);
        }
        // SAFETY: a heap is used by the thread that created it.
        let heap = unsafe { &mut *heap };
        let total = size + align.max(16) + HEADER;
        if heap.end - heap.at < total {
            let chunk = total.max(CHUNK);
            // SAFETY: plain libc allocation.
            let base = unsafe { libc::malloc(chunk) };
            if base.is_null() {
                return base;
            }
            heap.chunks.push(base);
            if total > CHUNK / 4 {
                // Allocated separately, so that the rest of the current chunk stays usable.
                // SAFETY: `total` bytes were reserved.
                let p = unsafe { place(base, base.addr(), size, align, false) };
                if zero {
                    // SAFETY: `size` bytes at `p` are inside the chunk.
                    unsafe { core::ptr::write_bytes(p.cast::<u8>(), 0, size) };
                }
                return p;
            }
            heap.at = base.addr();
            heap.end = base.addr() + chunk;
        }
        let base = *heap.chunks.last().unwrap();
        let base = if heap.at >= base.addr() && heap.at < base.addr() + CHUNK {
            base
        } else {
            *heap
                .chunks
                .iter()
                .rev()
                .find(|c| heap.at >= c.addr() && heap.end <= c.addr() + CHUNK)
                .unwrap()
        };
        // SAFETY: `total` bytes are left in the chunk.
        let p = unsafe { place(base, heap.at, size, align, false) };
        heap.at = p.addr() + size;
        if zero {
            // SAFETY: `size` bytes at `p` are inside the chunk.
            unsafe { core::ptr::write_bytes(p.cast::<u8>(), 0, size) };
        }
        p
    }

    unsafe fn header(p: *const c_void) -> *const Header {
        // SAFETY: every returned block has a header immediately before it.
        unsafe { p.cast::<Header>().sub(1) }
    }

    unsafe fn release(p: *mut c_void) {
        if p.is_null() {
            return;
        }
        // SAFETY: see `header`.
        let base = unsafe { (*header(p)).base };
        if !base.is_null() {
            // SAFETY: `base` came from `malloc`.
            unsafe { libc::free(base) };
        }
    }

    #[unsafe(no_mangle)]
    extern "C" fn mi_heap_new() -> *mut c_void {
        Box::into_raw(Box::new(Heap {
            chunks: Vec::new(),
            at: 0,
            end: 0,
        }))
        .cast()
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_heap_destroy(heap: *mut c_void) {
        // SAFETY: created by `mi_heap_new`.
        let heap = unsafe { Box::from_raw(heap.cast::<Heap>()) };
        for &chunk in &heap.chunks {
            // SAFETY: from `malloc`.
            unsafe { libc::free(chunk) };
        }
    }
    #[unsafe(no_mangle)]
    extern "C" fn mi_heap_main() -> *mut c_void {
        main_heap().cast()
    }
    #[unsafe(no_mangle)]
    extern "C" fn mi_collect(_force: bool) {}
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_heap_malloc(heap: *mut c_void, size: usize) -> *mut c_void {
        // SAFETY: `heap` comes from `mi_heap_new` or `mi_heap_main`, as mimalloc requires.
        unsafe { heap_alloc(heap.cast(), size, 16, false) }
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_heap_zalloc(heap: *mut c_void, size: usize) -> *mut c_void {
        // SAFETY: `heap` comes from `mi_heap_new` or `mi_heap_main`, as mimalloc requires.
        unsafe { heap_alloc(heap.cast(), size, 16, true) }
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_heap_malloc_aligned(
        heap: *mut c_void,
        size: usize,
        align: usize,
    ) -> *mut c_void {
        // SAFETY: `heap` comes from `mi_heap_new` or `mi_heap_main`, as mimalloc requires.
        unsafe { heap_alloc(heap.cast(), size, align, false) }
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_heap_zalloc_aligned(
        heap: *mut c_void,
        size: usize,
        align: usize,
    ) -> *mut c_void {
        // SAFETY: `heap` comes from `mi_heap_new` or `mi_heap_main`, as mimalloc requires.
        unsafe { heap_alloc(heap.cast(), size, align, true) }
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_heap_realloc_aligned(
        heap: *mut c_void,
        p: *mut c_void,
        size: usize,
        align: usize,
    ) -> *mut c_void {
        // SAFETY: `heap` comes from `mi_heap_new` or `mi_heap_main`, as mimalloc requires. `p` is
        // null or a block that one of these functions has returned, as mimalloc requires.
        unsafe {
            let new = heap_alloc(heap.cast(), size, align, false);
            if !p.is_null() && !new.is_null() {
                core::ptr::copy_nonoverlapping(
                    p.cast::<u8>(),
                    new.cast::<u8>(),
                    (*header(p)).size.min(size),
                );
                release(p);
            }
            new
        }
    }
    #[unsafe(no_mangle)]
    extern "C" fn mi_malloc(size: usize) -> *mut c_void {
        global_alloc(size, 16, false)
    }
    #[unsafe(no_mangle)]
    extern "C" fn mi_zalloc(size: usize) -> *mut c_void {
        global_alloc(size, 16, true)
    }
    #[unsafe(no_mangle)]
    extern "C" fn mi_malloc_aligned(size: usize, align: usize) -> *mut c_void {
        global_alloc(size, align, false)
    }
    #[unsafe(no_mangle)]
    extern "C" fn mi_zalloc_aligned(size: usize, align: usize) -> *mut c_void {
        global_alloc(size, align, true)
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_free(p: *mut c_void) {
        // SAFETY: `p` is null or a block that one of these functions has returned, as mimalloc
        // requires.
        unsafe { release(p) }
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_free_size(p: *mut c_void, _size: usize) {
        // SAFETY: `p` is null or a block that one of these functions has returned, as mimalloc
        // requires.
        unsafe { release(p) }
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_free_size_aligned(p: *mut c_void, _size: usize, _align: usize) {
        // SAFETY: `p` is null or a block that one of these functions has returned, as mimalloc
        // requires.
        unsafe { release(p) }
    }
    #[unsafe(no_mangle)]
    extern "C" fn mi_expand(_p: *mut c_void, _size: usize) -> *mut c_void {
        core::ptr::null_mut()
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_malloc_usable_size(p: *const c_void) -> usize {
        if p.is_null() {
            0
        } else {
            // SAFETY: `p` is a block that one of these functions has returned. See `header`.
            unsafe { (*header(p)).size }
        }
    }
    #[unsafe(no_mangle)]
    extern "C" fn mi_is_in_heap_region(_p: *const c_void) -> bool {
        true
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_process_info(
        a: *mut usize,
        b: *mut usize,
        c: *mut usize,
        d: *mut usize,
        e: *mut usize,
        f: *mut usize,
        g: *mut usize,
        h: *mut usize,
    ) {
        for p in [a, b, c, d, e, f, g, h] {
            if !p.is_null() {
                // SAFETY: it is not null, so the caller wants a number there.
                unsafe { *p = 0 };
            }
        }
    }
}

// ───────────────────────────── highway ─────────────────────────────

unsafe fn bytes<'a>(p: *const u8, len: usize) -> &'a [u8] {
    if len == 0 {
        &[]
    } else {
        // SAFETY: the contract of this function: `p` and `len` are those of a slice that lives for
        // `'a`.
        unsafe { core::slice::from_raw_parts(p, len) }
    }
}

fn first(text: &[u8], f: impl Fn(u8) -> bool) -> usize {
    text.iter().position(|&c| f(c)).unwrap_or(text.len())
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(p: *const u8, len: usize, needle: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    first(unsafe { bytes(p, len) }, |c| c == needle)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_last_index_of_char(p: *const u8, len: usize, needle: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    unsafe { bytes(p, len) }
        .iter()
        .rposition(|&c| c == needle)
        .unwrap_or(len)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_count_char(p: *const u8, len: usize, needle: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    unsafe { bytes(p, len) }
        .iter()
        .filter(|&&c| c == needle)
        .count()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_any_char(
    p: *const u8,
    len: usize,
    chars: *const u8,
    chars_len: usize,
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let chars = unsafe { bytes(chars, chars_len) };
    // SAFETY: the caller passes a slice, as a pointer and a length.
    first(unsafe { bytes(p, len) }, |c| chars.contains(&c))
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_last_index_of_any_char(
    p: *const u8,
    len: usize,
    chars: *const u8,
    chars_len: usize,
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let chars = unsafe { bytes(chars, chars_len) };
    // SAFETY: the caller passes a slice, as a pointer and a length.
    unsafe { bytes(p, len) }
        .iter()
        .rposition(|c| chars.contains(c))
        .unwrap_or(len)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memmem(
    h: *const u8,
    h_len: usize,
    n: *const u8,
    n_len: usize,
) -> *const u8 {
    // SAFETY: the caller passes two slices, each as a pointer and a length.
    let (hay, needle) = unsafe { (bytes(h, h_len), bytes(n, n_len)) };
    if needle.is_empty() {
        return h;
    }
    if hay.len() < needle.len() {
        return core::ptr::null();
    }
    match (0..=hay.len() - needle.len())
        .find(|&i| hay[i] == needle[0] && hay[i..i + needle.len()] == *needle)
    {
        // SAFETY: `i` is a position in `hay`, which begins at `h`.
        Some(i) => unsafe { h.add(i) },
        None => core::ptr::null(),
    }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memrmem(
    h: *const u8,
    h_len: usize,
    n: *const u8,
    n_len: usize,
) -> usize {
    // SAFETY: the caller passes two slices, each as a pointer and a length.
    let (hay, needle) = unsafe { (bytes(h, h_len), bytes(n, n_len)) };
    if needle.is_empty() {
        return h_len;
    }
    if hay.len() < needle.len() {
        return usize::MAX;
    }
    (0..=hay.len() - needle.len())
        .rev()
        .find(|&i| hay[i..i + needle.len()] == *needle)
        .unwrap_or(usize::MAX)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memrmem16(
    h: *const u16,
    h_len: usize,
    n: *const u16,
    n_len: usize,
) -> usize {
    if n_len == 0 {
        return h_len;
    }
    if h_len < n_len {
        return usize::MAX;
    }
    // SAFETY: the caller passes two slices, each as a pointer and a length.
    let (hay, needle) = unsafe {
        (
            core::slice::from_raw_parts(h, h_len),
            core::slice::from_raw_parts(n, n_len),
        )
    };
    (0..=hay.len() - needle.len())
        .rev()
        .find(|&i| hay[i..i + needle.len()] == *needle)
        .unwrap_or(usize::MAX)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_interesting_character_in_string_literal(
    p: *const u8,
    len: usize,
    quote: u8,
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    first(unsafe { bytes(p, len) }, |c| {
        c == quote || c == b'\\' || !(0x20..=0x7E).contains(&c)
    })
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_interesting_character_in_multiline_comment(
    p: *const u8,
    len: usize,
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    first(unsafe { bytes(p, len) }, |c| {
        c == b'*' || c == b'\r' || c == b'\n' || c > 127
    })
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_newline_or_non_ascii_or_hash_or_at(
    p: *const u8,
    len: usize,
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    first(unsafe { bytes(p, len) }, |c| {
        c == b'#' || c == b'@' || !(0x20..=0x7E).contains(&c)
    })
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_space_or_newline_or_non_ascii(
    p: *const u8,
    len: usize,
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    first(unsafe { bytes(p, len) }, |c| c <= b' ' || c > 127)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_contains_newline_or_non_ascii_or_quote(
    p: *const u8,
    len: usize,
) -> bool {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    unsafe { bytes(p, len) }
        .iter()
        .any(|&c| !(0x20..=127).contains(&c) || c == b'"')
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_needs_escape_for_javascript_string(
    p: *const u8,
    len: usize,
    quote: u8,
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    first(unsafe { bytes(p, len) }, |c| {
        c == quote || c == b'\\' || !(0x20..=0x7E).contains(&c) || (quote == b'`' && c == b'$')
    })
}
/// `BUN_JSON_IDX_ODDITY`: `StructuralIndex` goes on with its scalar indexer.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_json_index_chunk(
    _input: *const u8,
    _len: usize,
    _base_offset: usize,
    _out_indices: *mut u32,
    _out_dirty: *mut u64,
    _inout_state: *mut u64,
    out_flags: *mut u32,
) -> usize {
    // SAFETY: the caller passes a place for the flags.
    unsafe { *out_flags = 1 << 3 };
    0
}

// ───────────────────────────── simdutf ─────────────────────────────

#[repr(C)]
struct SimdutfResult {
    status: c_int,
    count: usize,
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_utf8(p: *const u8, len: usize) -> bool {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    core::str::from_utf8(unsafe { bytes(p, len) }).is_ok()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_ascii(p: *const u8, len: usize) -> bool {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    unsafe { bytes(p, len) }.is_ascii()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_ascii_with_errors(
    p: *const u8,
    len: usize,
) -> SimdutfResult {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    match unsafe { bytes(p, len) }.iter().position(|&c| c > 127) {
        // simdutf's TOO_LARGE
        Some(at) => SimdutfResult {
            status: 5,
            count: at,
        },
        None => SimdutfResult {
            status: 0,
            count: len,
        },
    }
}
unsafe fn utf16_units<'a>(p: *const u16, len: usize) -> &'a [u16] {
    if len == 0 {
        &[]
    } else {
        // SAFETY: the contract of this function: `p` and `len` are those of a slice that lives for
        // `'a`.
        unsafe { core::slice::from_raw_parts(p, len) }
    }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le(p: *const u16, len: usize) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let units = unsafe { utf16_units(p, len) };
    char::decode_utf16(units.iter().copied())
        .map(|c| c.map_or(3, char::len_utf8))
        .sum()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le_with_replacement(
    p: *const u16,
    len: usize,
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let units = unsafe { utf16_units(p, len) };
    char::decode_utf16(units.iter().copied())
        .map(|c| c.map_or(3, char::len_utf8))
        .sum()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf16_length_from_utf8(p: *const u8, len: usize) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    unsafe { bytes(p, len) }
        .iter()
        .map(|&c| usize::from((c & 0xC0) != 0x80) + usize::from(c >= 0xF0))
        .sum()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf16le_to_utf8_with_errors(
    p: *const u16,
    len: usize,
    out: *mut u8,
) -> SimdutfResult {
    let mut written = 0;
    let mut read = 0;
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let units = unsafe { utf16_units(p, len) };
    for c in char::decode_utf16(units.iter().copied()) {
        let Ok(c) = c else {
            // simdutf's SURROGATE
            return SimdutfResult {
                status: 6,
                count: read,
            };
        };
        let mut buffer = [0u8; 4];
        let encoded = c.encode_utf8(&mut buffer);
        // SAFETY: the caller has reserved room for the longest possible result, as simdutf
        // requires.
        unsafe {
            core::ptr::copy_nonoverlapping(encoded.as_ptr(), out.add(written), encoded.len())
        };
        written += encoded.len();
        read += c.len_utf16();
    }
    SimdutfResult {
        status: 0,
        count: written,
    }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__base64_encode(
    _p: *const u8,
    _len: usize,
    _out: *mut u8,
    _url: c_int,
) -> usize {
    unreachable!("nothing that parses encodes base64")
}

// ───────────────────────────── widths ─────────────────────────────

/// An approximation. Bun's implementation is grapheme-aware.
fn width_of(c: char) -> usize {
    match c as u32 {
        0x0300..=0x036F | 0x200B..=0x200F | 0xFE00..=0xFE0F => 0,
        0x1100..=0x115F
        | 0x2E80..=0xA4CF
        | 0xAC00..=0xD7A3
        | 0xF900..=0xFAFF
        | 0xFE30..=0xFE6F
        | 0xFF00..=0xFF60
        | 0xFFE0..=0xFFE6
        | 0x1F300..=0x1FAFF
        | 0x20000..=0x3FFFD => 2,
        _ => 1,
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__visibleWidthExcludeANSI_utf8(p: *const u8, len: usize) -> usize {
    // SAFETY: the caller passes a slice.
    let bytes = unsafe { core::slice::from_raw_parts(p, len) };
    bstr::ByteSlice::chars(bytes).map(width_of).sum()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__visibleWidthExcludeANSI_utf8IndexAtWidth(
    p: *const u8,
    len: usize,
    max_width: usize,
) -> usize {
    // SAFETY: the caller passes a slice.
    let bytes = unsafe { core::slice::from_raw_parts(p, len) };
    let Ok(text) = core::str::from_utf8(bytes) else {
        return len.min(max_width);
    };
    let mut width = 0;
    for (at, c) in text.char_indices() {
        width += width_of(c);
        if width > max_width {
            return at;
        }
    }
    len
}

// ───────────────────────────── the rest ─────────────────────────────

#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__getMaxStack() -> *mut c_void {
    STACK_LIMIT.with(|limit| core::ptr::without_provenance_mut(limit.get()))
}

thread_local! {
    static STACK_LIMIT: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
}

/// Called by a thread of the pool when it starts, near the top of its stack.
#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__initialize() {
    set_stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize - (256 << 10));
}
#[unsafe(no_mangle)]
extern "C" fn WTF__numberOfProcessorCores() -> c_int {
    std::thread::available_parallelism().map_or(4, |n| n.get() as c_int)
}
#[cfg(not(bun_sema_mimalloc))]
#[unsafe(no_mangle)]
extern "C" fn mi_thread_set_in_threadpool() {}
#[cfg(not(bun_sema_mimalloc))]
#[unsafe(no_mangle)]
extern "C" fn mi_on_thread_idle() {}
#[cfg(not(bun_sema_mimalloc))]
#[unsafe(no_mangle)]
extern "C" fn mi_on_thread_idle_start() -> bool {
    false
}
#[cfg(not(bun_sema_mimalloc))]
#[unsafe(no_mangle)]
extern "C" fn mi_on_thread_idle_end() {}

/// Sets the approximate remaining stack of the current thread. Without it recursion is unbounded.
pub fn set_stack_size(remaining: usize) {
    let probe = 0u8;
    STACK_LIMIT.with(|limit| limit.set((&raw const probe).addr().saturating_sub(remaining)));
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
extern "C" fn getRSS(rss: &mut usize) -> c_int {
    *rss = 0;
    -1
}
#[unsafe(no_mangle)]
extern "C" fn getPeakRSS(peak: &mut usize) -> c_int {
    *peak = 0;
    -1
}
#[unsafe(no_mangle)]
extern "C" fn is_executable_file(_path: *const c_char) -> bool {
    false
}
#[unsafe(no_mangle)]
extern "C" fn compress2(
    _d: *mut u8,
    _dl: *mut usize,
    _s: *const u8,
    _sl: usize,
    _level: c_int,
) -> c_int {
    -2
}
#[unsafe(no_mangle)]
fn __bun_macro_context_get_remap(
    _data: *mut c_void,
    _path: &[u8],
) -> Option<&'static bun_js_parser::Macro::MacroRemapEntry> {
    None
}

/// `String(number)`, as `WTF::numberToString` writes it.
#[unsafe(no_mangle)]
extern "C" fn WTF__dtoa(buf: &mut [u8; 124], number: f64) -> usize {
    use std::io::Write;
    let mut text = Vec::new();
    if number.is_nan() {
        text.extend_from_slice(b"NaN");
    } else if number.is_infinite() {
        text.extend_from_slice(if number > 0.0 {
            b"Infinity"
        } else {
            b"-Infinity"
        });
    } else if number == 0.0 {
        text.push(b'0');
    } else if number.abs() >= 1e21 || number.abs() < 1e-6 {
        let _ = write!(text, "{number:e}");
        if let Some(e) = bun_core::strings::index_of_char_usize(&text, b'e')
            && text.get(e + 1) != Some(&b'-')
        {
            text.insert(e + 1, b'+');
        }
    } else {
        let _ = write!(text, "{number}");
    }
    buf[..text.len()].copy_from_slice(&text);
    text.len()
}

/// The longest prefix of `p` that is a decimal number, as `WTF::parseDouble` parses it.
#[unsafe(no_mangle)]
unsafe extern "C" fn WTF__parseDouble(p: *const u8, len: usize, counted: *mut usize) -> f64 {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { bytes(p, len) };
    let mut end = 0;
    let digits = |from: usize| {
        from + text[from..]
            .iter()
            .take_while(|c| c.is_ascii_digit())
            .count()
    };
    if matches!(text.first(), Some(b'+' | b'-')) {
        end = 1;
    }
    let int_end = digits(end);
    let mut has_digits = int_end > end;
    end = int_end;
    if text.get(end) == Some(&b'.') {
        let fraction_end = digits(end + 1);
        if fraction_end > end + 1 || has_digits {
            has_digits |= fraction_end > end + 1;
            end = fraction_end;
        }
    }
    if !has_digits {
        // SAFETY: the caller passes a place for the count.
        unsafe { *counted = 0 };
        return 0.0;
    }
    if matches!(text.get(end), Some(b'e' | b'E')) {
        let mut at = end + 1;
        if matches!(text.get(at), Some(b'+' | b'-')) {
            at += 1;
        }
        let exponent_end = digits(at.min(text.len()));
        if exponent_end > at {
            end = exponent_end;
        }
    }
    // SAFETY: the caller passes a place for the count.
    unsafe { *counted = end };
    core::str::from_utf8(&text[..end])
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0)
}
