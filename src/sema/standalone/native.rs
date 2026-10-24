//! Stand-ins for the native symbols that Bun's C and C++ code provides to the parser, for binaries that link only the
//! parser: this crate's command line tool and `bun_sema`'s tests. They use plain loops instead of SIMD and a bump
//! allocator instead of mimalloc. Never part of the real build.

use core::ffi::{c_char, c_int, c_void};

// ───────────────────────────── mimalloc ─────────────────────────────

// With `--cfg bun_sema_mimalloc` the real mimalloc is linked instead, to measure with Bun's
// allocator.
#[cfg(not(bun_sema_mimalloc))]
mod fake_mimalloc {
    use super::*;

    #[repr(C)]
    struct Header {
        /// The pointer `malloc` returned, for a block that's freed individually. Null for a block
        /// that's freed with its heap.
        base: *mut c_void,
        size: usize,
    }

    const HEADER: usize = core::mem::size_of::<Header>();
    const CHUNK: usize = 1 << 20;

    struct Heap {
        chunks: Vec<*mut c_void>,
        at: usize,
        end: usize,
        /// Bytes handed out, including headers and padding.
        used: usize,
    }

    /// `mi_heap_area_t`
    #[repr(C)]
    struct Area {
        blocks: *mut c_void,
        reserved: usize,
        committed: usize,
        used: usize,
        block_size: usize,
        full_block_size: usize,
        reserved1: *mut c_void,
    }

    /// `mi_block_visit_fun`
    type Visitor =
        extern "C" fn(*const c_void, *const Area, *mut c_void, usize, *mut c_void) -> bool;

    fn main_heap() -> *mut Heap {
        core::ptr::without_provenance_mut(8)
    }

    unsafe fn init_block(
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
        unsafe { init_block(base, base.addr(), size, align, true) }
    }

    unsafe fn heap_alloc(heap: *mut Heap, size: usize, align: usize, zero: bool) -> *mut c_void {
        if heap == main_heap() {
            return global_alloc(size, align, zero);
        }
        // SAFETY: a heap is used only by the thread that created it.
        let heap = unsafe { &mut *heap };
        let total = size + align.max(16) + HEADER;
        heap.used += total;
        if heap.end - heap.at < total {
            let chunk = total.max(CHUNK);
            // A large request gets its own allocation, so the rest of the current chunk stays usable.
            let is_separate = total > CHUNK / 4;
            // Like mimalloc, get a large zeroed allocation straight from the operating system, so a page that's never
            // touched is never resident. The tables in `bun_sema::table` rely on that.
            // SAFETY: plain libc allocation.
            let base = unsafe {
                if zero && is_separate {
                    libc::calloc(1, chunk)
                } else {
                    libc::malloc(chunk)
                }
            };
            if base.is_null() {
                return base;
            }
            heap.chunks.push(base);
            if is_separate {
                // SAFETY: `total` bytes were reserved.
                return unsafe { init_block(base, base.addr(), size, align, false) };
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
        let p = unsafe { init_block(base, heap.at, size, align, false) };
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
            used: 0,
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
    /// Reports the whole heap as one area of one-byte blocks. Doesn't visit the blocks themselves.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_heap_visit_blocks(
        heap: *const c_void,
        _visit_all_blocks: bool,
        visitor: Option<Visitor>,
        arg: *mut c_void,
    ) -> bool {
        let Some(visitor) = visitor else {
            return false;
        };
        if heap == main_heap().cast_const().cast() {
            return true;
        }
        // SAFETY: created by `mi_heap_new`, and used only by the thread that created it.
        let used = unsafe { (*heap.cast::<Heap>()).used };
        let area = Area {
            blocks: core::ptr::null_mut(),
            reserved: used,
            committed: used,
            used,
            block_size: 1,
            full_block_size: 1,
            reserved1: core::ptr::null_mut(),
        };
        visitor(heap, &raw const area, core::ptr::null_mut(), 1, arg)
    }
    #[unsafe(no_mangle)]
    extern "C" fn mi_collect(_force: bool) {}
    #[unsafe(no_mangle)]
    extern "C" fn mi_option_set(_option: u32, _value: core::ffi::c_long) {}
    #[unsafe(no_mangle)]
    extern "C" fn mi_option_set_default(_option: u32, _value: core::ffi::c_long) {}
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
        // null or a block that one of these functions returned, as mimalloc requires.
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
    unsafe extern "C" fn mi_realloc(p: *mut c_void, size: usize) -> *mut c_void {
        // SAFETY: `p` is null or a block that one of these functions returned, as mimalloc requires.
        unsafe { mi_heap_realloc_aligned(main_heap().cast(), p, size, 16) }
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_realloc_aligned(
        p: *mut c_void,
        size: usize,
        align: usize,
    ) -> *mut c_void {
        // SAFETY: `p` is null or a block that one of these functions returned, as mimalloc requires.
        unsafe { mi_heap_realloc_aligned(main_heap().cast(), p, size, align) }
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_free(p: *mut c_void) {
        // SAFETY: `p` is null or a block that one of these functions returned, as mimalloc requires.
        unsafe { release(p) }
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_free_size(p: *mut c_void, _size: usize) {
        // SAFETY: `p` is null or a block that one of these functions returned, as mimalloc requires.
        unsafe { release(p) }
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_free_size_aligned(p: *mut c_void, _size: usize, _align: usize) {
        // SAFETY: `p` is null or a block that one of these functions returned, as mimalloc requires.
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
            // SAFETY: `p` is a block that one of these functions returned. See `header`.
            unsafe { (*header(p)).size }
        }
    }
    #[unsafe(no_mangle)]
    unsafe extern "C" fn mi_usable_size(p: *const c_void) -> usize {
        // SAFETY: `p` is null or a block that one of these functions returned, as mimalloc requires.
        unsafe { mi_malloc_usable_size(p) }
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
                // SAFETY: it isn't null, so the caller passed a valid pointer to write a number to.
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
        // SAFETY: this function's contract is that `p` and `len` describe a slice that lives for `'a`.
        unsafe { core::slice::from_raw_parts(p, len) }
    }
}

/// Tests 32 bytes at a time without a branch in between, which the compiler turns into vector instructions. That keeps
/// measurements made with these stand-ins close to the real kernels.
fn first(text: &[u8], f: impl Fn(u8) -> bool) -> usize {
    let mut at = 0;
    for chunk in text.as_chunks::<32>().0 {
        if chunk.iter().fold(false, |is_found, &c| is_found | f(c)) {
            break;
        }
        at += 32;
    }
    at + text[at..]
        .iter()
        .position(|&c| f(c))
        .unwrap_or(text.len() - at)
}

#[repr(C)]
struct XxHash64State {
    lanes: [u64; 4],
    buffer: [u8; 32],
    total: u64,
    buffered: u64,
}

const _: () = assert!(core::mem::size_of::<XxHash64State>() == 80);

const XXH_PRIME_1: u64 = 0x9E37_79B1_85EB_CA87;
const XXH_PRIME_2: u64 = 0xC2B2_AE3D_27D4_EB4F;
const XXH_PRIME_3: u64 = 0x1656_67B1_9E37_79F9;
const XXH_PRIME_4: u64 = 0x85EB_CA77_C2B2_AE63;
const XXH_PRIME_5: u64 = 0x27D4_EB2F_1656_67C5;

fn xxh_round(lane: u64, input: u64) -> u64 {
    lane.wrapping_add(input.wrapping_mul(XXH_PRIME_2))
        .rotate_left(31)
        .wrapping_mul(XXH_PRIME_1)
}

fn xxh_stripe(lanes: &mut [u64; 4], stripe: &[u8; 32]) {
    for (lane, word) in lanes.iter_mut().zip(stripe.as_chunks::<8>().0) {
        *lane = xxh_round(*lane, u64::from_le_bytes(*word));
    }
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn highway_xxhash64_reset(state: *mut XxHash64State, seed: u64) {
    // SAFETY: the caller passes 80 writable bytes, aligned to 8.
    unsafe {
        state.write(XxHash64State {
            lanes: [
                seed.wrapping_add(XXH_PRIME_1).wrapping_add(XXH_PRIME_2),
                seed.wrapping_add(XXH_PRIME_2),
                seed,
                seed.wrapping_sub(XXH_PRIME_1),
            ],
            buffer: [0; 32],
            total: 0,
            buffered: 0,
        });
    }
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn highway_xxhash64_update(
    state: *mut XxHash64State,
    input: *const u8,
    len: usize,
) {
    // SAFETY: the caller passes a state that `highway_xxhash64_reset` wrote, and a slice as a pointer and a length.
    let (state, mut input) = unsafe { (&mut *state, bytes(input, len)) };
    state.total += len as u64;
    let buffered = state.buffered as usize;
    if buffered + input.len() < 32 {
        state.buffer[buffered..buffered + input.len()].copy_from_slice(input);
        state.buffered += input.len() as u64;
        return;
    }
    if buffered > 0 {
        let (head, rest) = input.split_at(32 - buffered);
        state.buffer[buffered..].copy_from_slice(head);
        xxh_stripe(&mut state.lanes, &state.buffer);
        input = rest;
    }
    let (stripes, tail) = input.as_chunks::<32>();
    for stripe in stripes {
        xxh_stripe(&mut state.lanes, stripe);
    }
    state.buffer[..tail.len()].copy_from_slice(tail);
    state.buffered = tail.len() as u64;
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn highway_xxhash64_digest(state: *const XxHash64State) -> u64 {
    // SAFETY: the caller passes a state that `highway_xxhash64_reset` wrote.
    let state = unsafe { &*state };
    let mut hash = if state.total >= 32 {
        let [a, b, c, d] = state.lanes;
        let mixed = a
            .rotate_left(1)
            .wrapping_add(b.rotate_left(7))
            .wrapping_add(c.rotate_left(12))
            .wrapping_add(d.rotate_left(18));
        state.lanes.iter().fold(mixed, |hash, &lane| {
            (hash ^ xxh_round(0, lane))
                .wrapping_mul(XXH_PRIME_1)
                .wrapping_add(XXH_PRIME_4)
        })
    } else {
        state.lanes[2].wrapping_add(XXH_PRIME_5)
    };
    hash = hash.wrapping_add(state.total);
    let (words, tail) = state.buffer[..state.buffered as usize].as_chunks::<8>();
    for word in words {
        hash = (hash ^ xxh_round(0, u64::from_le_bytes(*word)))
            .rotate_left(27)
            .wrapping_mul(XXH_PRIME_1)
            .wrapping_add(XXH_PRIME_4);
    }
    let (halves, tail) = tail.as_chunks::<4>();
    for half in halves {
        hash = (hash ^ u64::from(u32::from_le_bytes(*half)).wrapping_mul(XXH_PRIME_1))
            .rotate_left(23)
            .wrapping_mul(XXH_PRIME_2)
            .wrapping_add(XXH_PRIME_3);
    }
    for &byte in tail {
        hash = (hash ^ u64::from(byte).wrapping_mul(XXH_PRIME_5))
            .rotate_left(11)
            .wrapping_mul(XXH_PRIME_1);
    }
    hash = (hash ^ (hash >> 33)).wrapping_mul(XXH_PRIME_2);
    hash = (hash ^ (hash >> 29)).wrapping_mul(XXH_PRIME_3);
    hash ^ (hash >> 32)
}

// Weak linkage, so the real kernels win wherever they're linked.
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn highway_index_of_char(p: *const u8, len: usize, needle: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    first(unsafe { bytes(p, len) }, |c| c == needle)
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn highway_index_of_not_char(p: *const u8, len: usize, value: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    first(unsafe { bytes(p, len) }, |c| c != value)
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn highway_last_index_of_char(p: *const u8, len: usize, needle: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    unsafe { bytes(p, len) }
        .iter()
        .rposition(|&c| c == needle)
        .unwrap_or(len)
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn highway_count_char(p: *const u8, len: usize, needle: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { bytes(p, len) };
    // Each chunk's count fits in a byte, so the compiler adds it up with vector instructions.
    text.chunks(192)
        .map(|chunk| usize::from(chunk.iter().map(|&c| u8::from(c == needle)).sum::<u8>()))
        .sum()
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn highway_line_starts(p: *const u8, len: usize, out: *mut u32) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { bytes(p, len) };
    let mut written = 0;
    for (i, _) in text.iter().enumerate().filter(|it| *it.1 == b'\n') {
        // SAFETY: `out` has room for one number per line feed in the text.
        unsafe { out.add(written).write(i as u32 + 1) };
        written += 1;
    }
    written
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn highway_odd_blocks(p: *const u8, len: usize, out: *mut u64) {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { bytes(p, len) };
    for (word, blocks) in text.chunks(64 * 64).enumerate() {
        let is_odd = |c: &u8| !matches!(c, 0x20..=0x5B | 0x5D..=0x7E | b'\t' | b'\n' | b'\r');
        let marks = blocks.chunks(64).enumerate();
        let marks = marks.fold(0u64, |marks, (i, block)| {
            marks | u64::from(block.iter().any(is_odd)) << i
        });
        // SAFETY: `out` has one word per 64 blocks of 64 bytes, counting partial ones.
        unsafe { out.add(word).write(marks) };
    }
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn highway_scanner_run_stops(
    p: *const u8,
    len: usize,
    out: *mut u8,
    plane_len: usize,
) {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { bytes(p, len) };
    // SAFETY: `out` has three bitmaps, `plane_len` bytes apart, each with 8 bytes per 64 bytes of text.
    let planes =
        unsafe { core::slice::from_raw_parts_mut(out, 2 * plane_len + len.div_ceil(64) * 8) };
    for (block, chunk) in text.chunks(64).enumerate() {
        let mut stops = [u64::MAX; 3];
        for (i, &c) in chunk.iter().enumerate() {
            let is_name = c.is_ascii_alphanumeric() || c == b'_' || c == b'$';
            let is_blank = c == b'\t' || c == b' ';
            let is_plain =
                (0x20..0x80).contains(&c) && !matches!(c, b'"' | b'\'' | b'`' | b'$' | b'\\');
            for (plane, is_in_run) in stops.iter_mut().zip([is_name, is_blank, is_plain]) {
                *plane &= !(u64::from(is_in_run) << i);
            }
        }
        for (plane, stops) in stops.iter().enumerate() {
            let at = plane * plane_len + block * 8;
            planes[at..at + 8].copy_from_slice(&stops.to_le_bytes());
        }
    }
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn highway_index_of_any_char(
    p: *const u8,
    len: usize,
    chars: *const u8,
    chars_len: usize,
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let chars = unsafe { bytes(chars, chars_len) };
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { bytes(p, len) };
    match *chars {
        [a] => first(text, |c| c == a),
        // Tests each 32-byte chunk for one character at a time, which is the form the compiler vectorizes well.
        _ if chars.len() <= 8 => {
            let has = |chunk: &[u8], wanted: u8| {
                chunk
                    .iter()
                    .fold(false, |is_found, &c| is_found | (c == wanted))
            };
            let whole = text
                .as_chunks::<32>()
                .0
                .iter()
                .take_while(|chunk| !chars.iter().any(|&wanted| has(&chunk[..], wanted)))
                .count();
            let at = whole * 32;
            at + text[at..]
                .iter()
                .position(|c| chars.contains(c))
                .unwrap_or(len - at)
        }
        _ => {
            let mut is_in_set = [false; 256];
            chars.iter().for_each(|&c| is_in_set[c as usize] = true);
            text.iter()
                .position(|&c| is_in_set[c as usize])
                .unwrap_or(len)
        }
    }
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
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
#[linkage = "weak"]
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
    // Like the kernel, looks for positions where the needle's first and last bytes both match, 32 positions at a time.
    let last = hay.len() - needle.len();
    let (head, tail) = (needle[0], needle[needle.len() - 1]);
    let (heads, tails) = (&hay[..=last], &hay[needle.len() - 1..]);
    let mut at = 0;
    while at <= last {
        for (heads, tails) in heads[at..]
            .as_chunks::<32>()
            .0
            .iter()
            .zip(tails[at..].as_chunks::<32>().0)
        {
            if heads.iter().zip(tails).fold(false, |is_found, (&a, &b)| {
                is_found | ((a == head) & (b == tail))
            }) {
                break;
            }
            at += 32;
        }
        let Some(found) = heads[at..]
            .iter()
            .zip(&tails[at..])
            .position(|(&a, &b)| a == head && b == tail)
        else {
            break;
        };
        at += found;
        if hay[at..at + needle.len()] == *needle {
            // SAFETY: `at` is a position in `hay`, which begins at `h`.
            return unsafe { h.add(at) };
        }
        at += 1;
    }
    core::ptr::null()
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
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
#[linkage = "weak"]
unsafe extern "C" fn highway_memmem16(
    h: *const u16,
    h_len: usize,
    n: *const u16,
    n_len: usize,
) -> usize {
    if n_len == 0 {
        return 0;
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
        .find(|&i| hay[i..i + needle.len()] == *needle)
        .unwrap_or(usize::MAX)
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
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
#[linkage = "weak"]
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
#[linkage = "weak"]
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
#[linkage = "weak"]
unsafe extern "C" fn highway_index_of_newline_or_non_ascii(p: *const u8, len: usize) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    first(unsafe { bytes(p, len) }, |c| !(0x20..=0x7F).contains(&c))
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
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
#[linkage = "weak"]
unsafe extern "C" fn highway_index_of_space_or_newline_or_non_ascii(
    p: *const u8,
    len: usize,
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    first(unsafe { bytes(p, len) }, |c| c <= b' ' || c > 127)
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
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
#[linkage = "weak"]
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
/// Reports `BUN_JSON_IDX_ODDITY`, so `StructuralIndex` falls back to its scalar indexer.
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn highway_json_index_chunk(
    _input: *const u8,
    _len: usize,
    _base_offset: usize,
    _out_indices: *mut u32,
    _out_dirty: *mut u64,
    _inout_state: *mut u64,
    out_flags: *mut u32,
) -> usize {
    // SAFETY: the caller passes a valid pointer for the flags.
    unsafe { *out_flags = 1 << 3 };
    0
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn highway_xml_index_chunk(
    input: *const u8,
    len: usize,
    base_offset: usize,
    out_indices: *mut u32,
    inout_state: *mut u64,
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length, and three words of state.
    let (text, state) = unsafe { (bytes(input, len), &mut *inout_state.cast::<[u64; 3]>()) };
    let mut is_in_tag = state[0] != 0;
    let (mut last, mut before_last) = (state[1] as u8, state[2] as u8);
    let mut count = 0;
    for (at, &c) in text.iter().enumerate() {
        let is_indexed = match c {
            b'<' => {
                is_in_tag = true;
                true
            }
            b'>' => {
                is_in_tag = false;
                true
            }
            b'\t' | b'\n' | b'"' | b'\'' | b'=' => is_in_tag,
            b'&' | 0..0x20 => true,
            0xBE | 0xBF => last == 0xBF && before_last == 0xEF,
            _ => false,
        };
        if is_indexed {
            // SAFETY: the caller passes room for one index a byte.
            unsafe { out_indices.add(count).write((base_offset + at) as u32) };
            count += 1;
        }
        (before_last, last) = (last, c);
    }
    *state = [
        u64::from(is_in_tag),
        u64::from(last),
        u64::from(before_last),
    ];
    count
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
unsafe extern "C" fn simdutf__validate_utf8_with_errors(p: *const u8, len: usize) -> SimdutfResult {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    match core::str::from_utf8(unsafe { bytes(p, len) }) {
        Ok(_) => SimdutfResult {
            status: 0,
            count: len,
        },
        // simdutf's HEADER_BITS
        Err(error) => SimdutfResult {
            status: 1,
            count: error.valid_up_to(),
        },
    }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf8_to_utf16le_with_errors(
    p: *const u8,
    len: usize,
    out: *mut u16,
) -> SimdutfResult {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = match core::str::from_utf8(unsafe { bytes(p, len) }) {
        Ok(text) => text,
        // simdutf's HEADER_BITS
        Err(error) => {
            return SimdutfResult {
                status: 1,
                count: error.valid_up_to(),
            };
        }
    };
    let mut written = 0;
    for unit in text.encode_utf16() {
        // SAFETY: the caller has reserved room for the longest possible result, as simdutf
        // requires.
        unsafe { out.add(written).write(unit) };
        written += 1;
    }
    SimdutfResult {
        status: 0,
        count: written,
    }
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
    match Some(first(unsafe { bytes(p, len) }, |c| c > 127)).filter(|&at| at < len) {
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
        // SAFETY: this function's contract is that `p` and `len` describe a slice that lives for `'a`.
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
unsafe extern "C" fn simdutf__utf8_length_from_latin1(p: *const u8, len: usize) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    unsafe { bytes(p, len) }
        .iter()
        .map(|&c| 1 + usize::from(c >= 0x80))
        .sum()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_latin1_to_utf8(
    p: *const u8,
    len: usize,
    out: *mut u8,
) -> usize {
    let mut written = 0;
    // SAFETY: the caller passes a slice, as a pointer and a length.
    for &c in unsafe { bytes(p, len) } {
        let mut encoded = [0; 2];
        let encoded = char::from(c).encode_utf8(&mut encoded).as_bytes();
        // SAFETY: the caller's buffer holds the length that this text has in UTF-8.
        unsafe {
            core::ptr::copy_nonoverlapping(encoded.as_ptr(), out.add(written), encoded.len());
        }
        written += encoded.len();
    }
    written
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
fn base64_length(len: usize, is_url_safe: bool) -> usize {
    match is_url_safe {
        true => len / 3 * 4 + (len % 3 * 4).div_ceil(3),
        false => len.div_ceil(3) * 4,
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__base64_encode(
    p: *const u8,
    len: usize,
    out: *mut u8,
    url: c_int,
) -> usize {
    let is_url_safe = url != 0;
    let alphabet: &[u8; 64] = match is_url_safe {
        true => b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
        false => b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    };
    let length = base64_length(len, is_url_safe);
    if length == 0 {
        return 0;
    }
    // SAFETY: the caller passes a slice, and room for the encoded length.
    let (input, output) = unsafe { (bytes(p, len), core::slice::from_raw_parts_mut(out, length)) };
    output.fill(b'=');
    for (chunk, encoded) in input.chunks(3).zip(output.chunks_mut(4)) {
        let mut padded = [0; 3];
        padded[..chunk.len()].copy_from_slice(chunk);
        let bits = u32::from_be_bytes([0, padded[0], padded[1], padded[2]]);
        for (index, character) in encoded.iter_mut().enumerate().take(chunk.len() + 1) {
            *character = alphabet[(bits >> (18 - 6 * index) & 63) as usize];
        }
    }
    length
}
#[unsafe(no_mangle)]
extern "C" fn simdutf__base64_length_from_binary(len: usize, options: c_int) -> usize {
    base64_length(len, options != 0)
}
/// Answers simdutf's INVALID_BASE64_CHARACTER: `bun_base64::decode` then uses its own decoder.
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__base64_decode_from_binary(
    _p: *const u8,
    _len: usize,
    _out: *mut u8,
    _out_len: usize,
    _url: c_int,
) -> SimdutfResult {
    SimdutfResult {
        status: 7,
        count: 0,
    }
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

/// A pool thread calls this when it starts, near the top of its stack.
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

/// Sets the current thread's approximate remaining stack. Without this call, recursion is unbounded.
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
extern "C" fn on_before_reload_process_posix(_close_inherited_fds: bool) {}
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

/// Returns the mantissa digits of `text`, starting at the first nonzero digit.
fn mantissa_digits(text: &[u8]) -> impl Iterator<Item = u8> {
    let end = bun_core::strings::index_of_char_usize(text, b'e').unwrap_or(text.len());
    let digits = text[..end].iter().copied().filter(u8::is_ascii_digit);
    digits.skip_while(|&digit| digit == b'0')
}

/// ECMA-262 `Number::toString` picks, of two shortest forms equally close to `number`, the one whose
/// last digit is even. `text` is `number` as Rust formats it, and Rust picks the upper one.
fn round_tie_to_even(text: &mut [u8], number: f64) {
    use std::io::Write;
    let end = bun_core::strings::index_of_char_usize(text, b'e').unwrap_or(text.len());
    let Some(last) = end.checked_sub(1) else {
        return;
    };
    if !text[last].is_ascii_digit() || text[last].is_multiple_of(2) {
        return;
    }
    text[last] -= 1;
    let written = core::str::from_utf8(text).ok();
    let lower: Option<f64> = written.and_then(|s| s.parse().ok());
    // In a tie, the exact value, which has at most 767 digits, is the lower form followed by a 5.
    let mut exact: Vec<u8> = Vec::new();
    if lower == Some(number) {
        let _ = write!(exact, "{number:.766e}");
    }
    let is_tie = {
        let mut rest = mantissa_digits(&exact);
        let mut halfway = mantissa_digits(text).chain(*b"5");
        halfway.all(|digit| rest.next() == Some(digit)) && rest.all(|digit| digit == b'0')
    };
    if !is_tie {
        text[last] += 1;
    }
}

/// Writes `String(number)` the way `WTF::numberToString` does.
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
        round_tie_to_even(&mut text, number);
        if let Some(e) = bun_core::strings::index_of_char_usize(&text, b'e')
            && text.get(e + 1) != Some(&b'-')
        {
            text.insert(e + 1, b'+');
        }
    } else {
        let _ = write!(text, "{number}");
        round_tie_to_even(&mut text, number);
    }
    buf[..text.len()].copy_from_slice(&text);
    text.len()
}

/// Parses the longest prefix of `p` that is a decimal number, like `WTF::parseDouble`.
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
        // SAFETY: the caller passes a valid pointer for the count.
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
    // SAFETY: the caller passes a valid pointer for the count.
    unsafe { *counted = end };
    core::str::from_utf8(&text[..end])
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0)
}
