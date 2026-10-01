//! Rust stand-ins for the C and C++ symbols that the `cargo test` binary of this crate links to: the parse pass runs on them, and no build of bun holds them.

use core::alloc::Layout;
use core::cell::Cell;
use core::ffi::{c_char, c_int, c_ulong, c_void};
use core::ptr::null_mut;
use std::collections::BTreeMap;

use bun_alloc::mimalloc::MI_MAX_ALIGN_SIZE;

/// How far below its first caller a thread may go: half of the 2 MiB that the stack of a test thread has.
const STACK_ROOM: usize = 1024 * 1024;

std::thread_local! {
    /// The bound that this thread got first: it stays, as the bound of a stack does.
    static STACK_END: Cell<usize> = const { Cell::new(0) };
}

/// `StackBounds::end` of the calling thread: `STACK_ROOM` below the first call.
#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__getMaxStack() -> *mut c_void {
    let probe = 0u8;
    let here = (&raw const probe).addr();
    let end = STACK_END.with(|end| {
        if end.get() == 0 {
            end.set(here.saturating_sub(STACK_ROOM));
        }
        end.get()
    });
    core::ptr::without_provenance_mut(end)
}

/// `WTF::parseDouble`: the value of the longest prefix of the text that is a decimal literal, and in `counted` the length of that prefix, 0 where there is none.
#[unsafe(no_mangle)]
unsafe extern "C" fn WTF__parseDouble(bytes: *const u8, length: usize, counted: *mut usize) -> f64 {
    // SAFETY: the caller passes `length` readable bytes.
    let text = unsafe { bytes_at(bytes, length) };
    let literal = core::str::from_utf8(&text[..decimal_literal_len(text)]).unwrap_or("");
    let value = literal.parse::<f64>().ok();
    // SAFETY: the caller passes a `counted` that it owns.
    unsafe { counted.write(value.map_or(0, |_| literal.len())) };
    value.unwrap_or(0.0)
}

/// How many bytes of `text` fast_float reads as one number: "-", digits, "." and digits, with a digit among them, then an exponent that has a digit.
fn decimal_literal_len(text: &[u8]) -> usize {
    let digits_end = |mut at: usize| {
        while text.get(at).is_some_and(u8::is_ascii_digit) {
            at += 1;
        }
        at
    };
    let start = usize::from(text.first() == Some(&b'-'));
    let mut end = digits_end(start);
    let mut digits = end - start;
    if text.get(end) == Some(&b'.') {
        let fraction_end = digits_end(end + 1);
        digits += fraction_end - (end + 1);
        end = fraction_end;
    }
    if digits == 0 {
        return 0;
    }
    if matches!(text.get(end), Some(b'e' | b'E')) {
        let exponent = end + 1 + usize::from(matches!(text.get(end + 1), Some(b'+' | b'-')));
        let exponent_end = digits_end(exponent);
        if exponent_end > exponent {
            end = exponent_end;
        }
    }
    end
}

/// The `len` bytes at `at`.
unsafe fn bytes_at<'a>(at: *const u8, len: usize) -> &'a [u8] {
    // SAFETY: the caller passes `len` bytes that stay readable for `'a`.
    unsafe { core::slice::from_raw_parts(at, len) }
}

/// The `len` UTF-16 code units at `at`.
unsafe fn units_at<'a>(at: *const u16, len: usize) -> &'a [u16] {
    // SAFETY: the caller passes `len` code units that stay readable for `'a`.
    unsafe { core::slice::from_raw_parts(at, len) }
}

/// Where the first byte that `is_wanted` holds for is, and the length where there is none: what a scan kernel returns.
fn first_byte(haystack: &[u8], is_wanted: impl Fn(u8) -> bool) -> usize {
    let found = haystack.iter().position(|&byte| is_wanted(byte));
    found.unwrap_or(haystack.len())
}

/// Where the last byte that `is_wanted` holds for is, and the length where there is none.
fn last_byte(haystack: &[u8], is_wanted: impl Fn(u8) -> bool) -> usize {
    let found = haystack.iter().rposition(|&byte| is_wanted(byte));
    found.unwrap_or(haystack.len())
}

/// Where `needle` starts in `haystack`, first or last: an empty needle is at 0 and at the end.
fn occurrence<T: PartialEq>(haystack: &[T], needle: &[T], last: bool) -> Option<usize> {
    let mut starts = 0..=haystack.len().checked_sub(needle.len())?;
    let is_at = |start: &usize| haystack[*start..*start + needle.len()] == *needle;
    if last {
        starts.rev().find(is_at)
    } else {
        starts.find(is_at)
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    // SAFETY: the caller passes a readable range.
    let haystack = unsafe { bytes_at(haystack, haystack_len) };
    first_byte(haystack, |byte| byte == needle)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_last_index_of_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    // SAFETY: the caller passes a readable range.
    let haystack = unsafe { bytes_at(haystack, haystack_len) };
    last_byte(haystack, |byte| byte == needle)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_not_char(
    haystack: *const u8,
    haystack_len: usize,
    value: u8,
) -> usize {
    // SAFETY: the caller passes a readable range.
    let haystack = unsafe { bytes_at(haystack, haystack_len) };
    first_byte(haystack, |byte| byte != value)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_count_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
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
    // SAFETY: the caller passes two readable ranges.
    let (text, chars) = unsafe { (bytes_at(text, text_len), bytes_at(chars, chars_len)) };
    first_byte(text, |byte| chars.contains(&byte))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_last_index_of_any_char(
    text: *const u8,
    text_len: usize,
    chars: *const u8,
    chars_len: usize,
) -> usize {
    // SAFETY: the caller passes two readable ranges.
    let (text, chars) = unsafe { (bytes_at(text, text_len), bytes_at(chars, chars_len)) };
    last_byte(text, |byte| chars.contains(&byte))
}

/// The first occurrence, and null where there is none.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memmem(
    haystack: *const u8,
    haystack_len: usize,
    needle: *const u8,
    needle_len: usize,
) -> *const u8 {
    // SAFETY: the caller passes two readable ranges.
    let found = unsafe {
        occurrence(
            bytes_at(haystack, haystack_len),
            bytes_at(needle, needle_len),
            false,
        )
    };
    match found {
        // SAFETY: an occurrence starts inside the haystack.
        Some(start) => unsafe { haystack.add(start) },
        None => core::ptr::null(),
    }
}

/// The last occurrence, and `usize::MAX` where there is none.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memrmem(
    haystack: *const u8,
    haystack_len: usize,
    needle: *const u8,
    needle_len: usize,
) -> usize {
    // SAFETY: the caller passes two readable ranges.
    let found = unsafe {
        occurrence(
            bytes_at(haystack, haystack_len),
            bytes_at(needle, needle_len),
            true,
        )
    };
    found.unwrap_or(usize::MAX)
}

/// The first occurrence, and `usize::MAX` where there is none.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memmem16(
    haystack: *const u16,
    haystack_len: usize,
    needle: *const u16,
    needle_len: usize,
) -> usize {
    // SAFETY: the caller passes two readable ranges.
    let found = unsafe {
        occurrence(
            units_at(haystack, haystack_len),
            units_at(needle, needle_len),
            false,
        )
    };
    found.unwrap_or(usize::MAX)
}

/// The last occurrence, and `usize::MAX` where there is none.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memrmem16(
    haystack: *const u16,
    haystack_len: usize,
    needle: *const u16,
    needle_len: usize,
) -> usize {
    // SAFETY: the caller passes two readable ranges.
    let found = unsafe {
        occurrence(
            units_at(haystack, haystack_len),
            units_at(needle, needle_len),
            true,
        )
    };
    found.unwrap_or(usize::MAX)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_interesting_character_in_string_literal(
    text: *const u8,
    text_len: usize,
    quote: u8,
) -> usize {
    // SAFETY: the caller passes a readable range.
    let text = unsafe { bytes_at(text, text_len) };
    first_byte(text, |byte| {
        byte == quote || byte == b'\\' || !(0x20..=0x7E).contains(&byte)
    })
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_interesting_character_in_multiline_comment(
    text: *const u8,
    text_len: usize,
) -> usize {
    // SAFETY: the caller passes a readable range.
    let text = unsafe { bytes_at(text, text_len) };
    first_byte(text, |byte| {
        matches!(byte, b'*' | b'\r' | b'\n') || byte > 0x7F
    })
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_newline_or_non_ascii(
    haystack: *const u8,
    haystack_len: usize,
) -> usize {
    // SAFETY: the caller passes a readable range.
    let haystack = unsafe { bytes_at(haystack, haystack_len) };
    first_byte(haystack, |byte| !(0x20..=0x7F).contains(&byte))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_newline_or_non_ascii_or_hash_or_at(
    haystack: *const u8,
    haystack_len: usize,
) -> usize {
    // SAFETY: the caller passes a readable range.
    let haystack = unsafe { bytes_at(haystack, haystack_len) };
    first_byte(haystack, |byte| {
        matches!(byte, b'#' | b'@') || !(0x20..=0x7E).contains(&byte)
    })
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_space_or_newline_or_non_ascii(
    haystack: *const u8,
    haystack_len: usize,
) -> usize {
    // SAFETY: the caller passes a readable range.
    let haystack = unsafe { bytes_at(haystack, haystack_len) };
    first_byte(haystack, |byte| !(0x21..=0x7F).contains(&byte))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_contains_newline_or_non_ascii_or_quote(
    text: *const u8,
    text_len: usize,
) -> bool {
    // SAFETY: the caller passes a readable range.
    let text = unsafe { bytes_at(text, text_len) };
    first_byte(text, |byte| byte == b'"' || !(0x20..=0x7F).contains(&byte)) != text.len()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_needs_escape_for_javascript_string(
    text: *const u8,
    text_len: usize,
    quote_char: u8,
) -> usize {
    // SAFETY: the caller passes a readable range.
    let text = unsafe { bytes_at(text, text_len) };
    first_byte(text, |byte| {
        let ends_or_interpolates = byte == quote_char || (quote_char == b'`' && byte == b'$');
        ends_or_interpolates || byte == b'\\' || !(0x20..=0x7E).contains(&byte)
    })
}

/// `simdutf::result`: the code of an error and how many units were read before it, or no error and how many were written.
#[repr(C)]
struct SimdutfResult {
    error: c_int,
    count: usize,
}

/// `simdutf::error_code::SUCCESS`.
const SUCCESS: c_int = 0;

/// `simdutf::error_code::SURROGATE`: a surrogate that has no pair.
const SURROGATE: c_int = 6;

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_ascii(buf: *const u8, len: usize) -> bool {
    // SAFETY: the caller passes a readable range.
    unsafe { bytes_at(buf, len) }.is_ascii()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_utf8(buf: *const u8, len: usize) -> bool {
    // SAFETY: the caller passes a readable range.
    core::str::from_utf8(unsafe { bytes_at(buf, len) }).is_ok()
}

/// 1, 2 or 3 bytes for a code unit, and 2 for each surrogate: a pair makes the 4 bytes of its character.
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le(input: *const u16, length: usize) -> usize {
    // SAFETY: the caller passes a readable range.
    let units = unsafe { units_at(input, length) };
    let bytes_of = |&unit: &u16| match unit {
        0..=0x7F => 1,
        0x80..=0x7FF | 0xD800..=0xDFFF => 2,
        _ => 3,
    };
    units.iter().map(bytes_of).sum()
}

/// The bytes of each character, and the 3 of U+FFFD for a surrogate that has no pair.
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le_with_replacement(
    input: *const u16,
    length: usize,
) -> usize {
    // SAFETY: the caller passes a readable range.
    let units = unsafe { units_at(input, length) };
    char::decode_utf16(units.iter().copied())
        .map(|decoded| decoded.map_or(3, char::len_utf8))
        .sum()
}

/// Stops at a surrogate that has no pair, with `SURROGATE` and its index.
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf16le_to_utf8_with_errors(
    buf: *const u16,
    len: usize,
    utf8_buffer: *mut u8,
) -> SimdutfResult {
    // SAFETY: the caller passes a readable range.
    let units = unsafe { units_at(buf, len) };
    let (mut read, mut written) = (0, 0);
    while read < len {
        let Some(Ok(character)) = char::decode_utf16(units[read..].iter().copied()).next() else {
            return SimdutfResult {
                error: SURROGATE,
                count: read,
            };
        };
        let mut encoded = [0u8; 4];
        let encoded = character.encode_utf8(&mut encoded).as_bytes();
        // SAFETY: the caller passes room for the UTF-8 of every unit, and these bytes are part of it.
        unsafe {
            core::ptr::copy_nonoverlapping(
                encoded.as_ptr(),
                utf8_buffer.add(written),
                encoded.len(),
            );
        }
        written += encoded.len();
        read += character.len_utf16();
    }
    SimdutfResult {
        error: SUCCESS,
        count: written,
    }
}

/// `simdutf::binary_to_base64`: the standard alphabet with padding, or the alphabet for URLs without.
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__base64_encode(
    input: *const u8,
    length: usize,
    output: *mut u8,
    is_urlsafe: c_int,
) -> usize {
    const STANDARD: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let (alphabet, is_padded) = if is_urlsafe != 0 {
        (URL, false)
    } else {
        (STANDARD, true)
    };
    // SAFETY: the caller passes a readable range.
    let input = unsafe { bytes_at(input, length) };
    let mut written = 0;
    for group in input.chunks(3) {
        let bits = group
            .iter()
            .fold(0u32, |bits, &byte| (bits << 8) | u32::from(byte))
            << (8 * (3 - group.len()));
        for digit in 0..4 {
            let byte = if digit <= group.len() {
                alphabet[((bits >> (18 - 6 * digit)) & 63) as usize]
            } else if is_padded {
                b'='
            } else {
                break;
            };
            // SAFETY: the caller passes room for the digits of the input, and this is one of them.
            unsafe { output.add(written).write(byte) };
            written += 1;
        }
    }
    written
}

/// A block that the stand-in for mimalloc handed out and nothing freed yet.
struct Block {
    layout: Layout,
    /// The heap that the block goes with when `mi_heap_destroy` frees it.
    heap: usize,
}

struct Blocks {
    /// By the address of the block.
    live: BTreeMap<usize, Block>,
    /// The heap that `mi_heap_new` made last.
    last_heap: usize,
}

/// The heap of `mi_malloc`, which is `mi_heap_main`: nothing destroys it.
const MAIN_HEAP: usize = 1;

static BLOCKS: bun_core::Mutex<Blocks> = bun_core::Mutex::new(Blocks {
    live: BTreeMap::new(),
    last_heap: MAIN_HEAP,
});

/// A new block of `size` bytes for `heap`, at a multiple of `align`: null where the allocator of the test binary has none.
fn new_block(heap: usize, size: usize, align: usize, zeroed: bool) -> *mut c_void {
    let Ok(layout) = Layout::from_size_align(size.max(1), align.max(MI_MAX_ALIGN_SIZE)) else {
        return null_mut();
    };
    // SAFETY: the size of `layout` is not 0.
    let at = unsafe {
        if zeroed {
            std::alloc::alloc_zeroed(layout)
        } else {
            std::alloc::alloc(layout)
        }
    };
    if !at.is_null() {
        let block = Block { layout, heap };
        BLOCKS.lock().live.insert(at.expose_provenance(), block);
    }
    at.cast()
}

/// How many bytes the block at `at` holds: 0 for what is no block.
fn block_size(at: *const c_void) -> usize {
    let blocks = BLOCKS.lock();
    blocks
        .live
        .get(&at.addr())
        .map_or(0, |block| block.layout.size())
}

/// Frees the block at `at`: null, and what is no block, stay as they are.
fn free_block(at: *mut c_void) {
    let block = BLOCKS.lock().live.remove(&at.addr());
    if let Some(block) = block {
        // SAFETY: `new_block` allocated `at` with this layout, and the table held it until now: nothing freed it.
        unsafe { std::alloc::dealloc(at.cast(), block.layout) };
    }
}

/// `mi_heap_realloc_aligned`: a block of `size` bytes for `heap` that starts with the bytes of the block at `at`, which is freed. Null for what is no block.
fn resized_block(heap: usize, at: *mut c_void, size: usize, align: usize) -> *mut c_void {
    if at.is_null() {
        return new_block(heap, size, align, false);
    }
    let held = block_size(at);
    if held == 0 {
        return null_mut();
    }
    let to = new_block(heap, size, align, false);
    if !to.is_null() {
        // SAFETY: both blocks are live and apart, and each holds the bytes that are copied.
        unsafe { core::ptr::copy_nonoverlapping(at.cast::<u8>(), to.cast::<u8>(), held.min(size)) };
        free_block(at);
    }
    to
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_main() -> *mut c_void {
    core::ptr::without_provenance_mut(MAIN_HEAP)
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_new() -> *mut c_void {
    let mut blocks = BLOCKS.lock();
    blocks.last_heap += 1;
    core::ptr::without_provenance_mut(blocks.last_heap)
}

/// Frees every block that the heap still has.
#[unsafe(no_mangle)]
extern "C" fn mi_heap_destroy(heap: *mut c_void) {
    let heap = heap.addr();
    let mut freed = Vec::new();
    BLOCKS.lock().live.retain(|&at, block| {
        if block.heap == heap {
            freed.push((at, block.layout));
        }
        block.heap != heap
    });
    for (at, layout) in freed {
        // SAFETY: `new_block` allocated the block with this layout, and the table held it until now: nothing freed it.
        unsafe { std::alloc::dealloc(core::ptr::with_exposed_provenance_mut(at), layout) };
    }
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_malloc(heap: *mut c_void, size: usize) -> *mut c_void {
    new_block(heap.addr(), size, MI_MAX_ALIGN_SIZE, false)
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_zalloc(heap: *mut c_void, size: usize) -> *mut c_void {
    new_block(heap.addr(), size, MI_MAX_ALIGN_SIZE, true)
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_malloc_aligned(
    heap: *mut c_void,
    size: usize,
    alignment: usize,
) -> *mut c_void {
    new_block(heap.addr(), size, alignment, false)
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_zalloc_aligned(
    heap: *mut c_void,
    size: usize,
    alignment: usize,
) -> *mut c_void {
    new_block(heap.addr(), size, alignment, true)
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_realloc(heap: *mut c_void, p: *mut c_void, newsize: usize) -> *mut c_void {
    resized_block(heap.addr(), p, newsize, MI_MAX_ALIGN_SIZE)
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_realloc_aligned(
    heap: *mut c_void,
    p: *mut c_void,
    newsize: usize,
    alignment: usize,
) -> *mut c_void {
    resized_block(heap.addr(), p, newsize, alignment)
}

#[unsafe(no_mangle)]
extern "C" fn mi_malloc(size: usize) -> *mut c_void {
    new_block(MAIN_HEAP, size, MI_MAX_ALIGN_SIZE, false)
}

#[unsafe(no_mangle)]
extern "C" fn mi_zalloc(size: usize) -> *mut c_void {
    new_block(MAIN_HEAP, size, MI_MAX_ALIGN_SIZE, true)
}

#[unsafe(no_mangle)]
extern "C" fn mi_calloc(count: usize, size: usize) -> *mut c_void {
    match count.checked_mul(size) {
        Some(size) => new_block(MAIN_HEAP, size, MI_MAX_ALIGN_SIZE, true),
        None => null_mut(),
    }
}

#[unsafe(no_mangle)]
extern "C" fn mi_malloc_aligned(size: usize, alignment: usize) -> *mut c_void {
    new_block(MAIN_HEAP, size, alignment, false)
}

#[unsafe(no_mangle)]
extern "C" fn mi_zalloc_aligned(size: usize, alignment: usize) -> *mut c_void {
    new_block(MAIN_HEAP, size, alignment, true)
}

#[unsafe(no_mangle)]
extern "C" fn mi_realloc(p: *mut c_void, newsize: usize) -> *mut c_void {
    resized_block(MAIN_HEAP, p, newsize, MI_MAX_ALIGN_SIZE)
}

#[unsafe(no_mangle)]
extern "C" fn mi_realloc_aligned(p: *mut c_void, newsize: usize, alignment: usize) -> *mut c_void {
    resized_block(MAIN_HEAP, p, newsize, alignment)
}

/// The block where it is if it holds `newsize` bytes, and null if it does not.
#[unsafe(no_mangle)]
extern "C" fn mi_expand(p: *mut c_void, newsize: usize) -> *mut c_void {
    if newsize <= block_size(p) {
        p
    } else {
        null_mut()
    }
}

#[unsafe(no_mangle)]
extern "C" fn mi_free(p: *mut c_void) {
    free_block(p);
}

#[unsafe(no_mangle)]
extern "C" fn mi_free_size(p: *mut c_void, _size: usize) {
    free_block(p);
}

#[unsafe(no_mangle)]
extern "C" fn mi_free_size_aligned(p: *mut c_void, _size: usize, _alignment: usize) {
    free_block(p);
}

#[unsafe(no_mangle)]
extern "C" fn mi_usable_size(p: *const c_void) -> usize {
    block_size(p)
}

#[unsafe(no_mangle)]
extern "C" fn mi_malloc_usable_size(p: *const c_void) -> usize {
    block_size(p)
}

/// Whether `p` is inside a block.
#[unsafe(no_mangle)]
extern "C" fn mi_is_in_heap_region(p: *const c_void) -> bool {
    let blocks = BLOCKS.lock();
    let before = blocks.live.range(..=p.addr()).next_back();
    before.is_some_and(|(&start, block)| p.addr() - start < block.layout.size())
}

/// Nothing is measured: every number is 0.
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_process_info(
    elapsed_msecs: *mut usize,
    user_msecs: *mut usize,
    system_msecs: *mut usize,
    current_rss: *mut usize,
    peak_rss: *mut usize,
    current_commit: *mut usize,
    peak_commit: *mut usize,
    page_faults: *mut usize,
) {
    let numbers = [
        elapsed_msecs,
        user_msecs,
        system_msecs,
        current_rss,
        peak_rss,
        current_commit,
        peak_commit,
        page_faults,
    ];
    for number in numbers {
        if !number.is_null() {
            // SAFETY: the caller owns each number that it asks for.
            unsafe { number.write(0) };
        }
    }
}

/// No macro runner is linked: no import path is one of a macro.
#[unsafe(no_mangle)]
extern "Rust" fn __bun_macro_context_get_remap(
    _data: *mut c_void,
    _path: &[u8],
) -> Option<&'static bun_js_parser::Macro::MacroRemapEntry> {
    None
}

/// No feature of the CPU is reported.
#[unsafe(no_mangle)]
extern "C" fn bun_cpu_features() -> u8 {
    0
}

/// Fails: the resident size of the process is not measured.
#[unsafe(no_mangle)]
extern "C" fn getRSS(_rss: &mut usize) -> c_int {
    -1
}

/// Fails: the largest resident size of the process is not measured.
#[unsafe(no_mangle)]
extern "C" fn getPeakRSS(_peak: &mut usize) -> c_int {
    -1
}

/// Fails as zlib does when it has no memory: nothing compresses here.
#[unsafe(no_mangle)]
extern "C" fn compress2(
    _dest: *mut u8,
    _dest_len: *mut c_ulong,
    _source: *const u8,
    _source_len: c_ulong,
    _level: c_int,
) -> c_int {
    const Z_MEM_ERROR: c_int = -4;
    Z_MEM_ERROR
}

/// No file is an executable one: nothing is looked up to be run.
#[unsafe(no_mangle)]
extern "C" fn is_executable_file(_path: *const c_char) -> bool {
    false
}

/// Nothing changed the modes of the terminal: nothing is put back.
#[unsafe(no_mangle)]
extern "C" fn bun_restore_stdio() {}

/// The process is not replaced by a new image of itself: nothing is made ready for one.
#[unsafe(no_mangle)]
extern "C" fn on_before_reload_process_posix() {}

/// `WTF::dtoa`: `number` as JavaScript writes it, and how many bytes of `buf` that took.
#[unsafe(no_mangle)]
extern "C" fn WTF__dtoa(buf: &mut [u8; 124], number: f64) -> usize {
    let text = number_to_string(number);
    buf[..text.len()].copy_from_slice(text.as_bytes());
    text.len()
}

/// `Number::toString` of ECMAScript in radix 10, from the shortest digits that read back as `number`.
fn number_to_string(number: f64) -> String {
    if number.is_nan() {
        return String::from("NaN");
    }
    if number == 0.0 {
        return String::from("0");
    }
    if number.is_infinite() {
        return String::from(if number < 0.0 {
            "-Infinity"
        } else {
            "Infinity"
        });
    }
    let mut digits = String::new();
    let mut exponent = 0i32;
    let mut exponent_is_negative = false;
    let mut in_exponent = false;
    for character in format!("{:e}", number.abs()).chars() {
        match character {
            'e' => in_exponent = true,
            '-' => exponent_is_negative = true,
            '.' => {}
            digit if in_exponent => {
                exponent = exponent * 10 + digit.to_digit(10).unwrap_or(0) as i32
            }
            digit => digits.push(digit),
        }
    }
    if exponent_is_negative {
        exponent = -exponent;
    }
    let count = digits.len() as i32;
    let point = exponent + 1;
    let mut text = String::from(if number < 0.0 { "-" } else { "" });
    if count <= point && point <= 21 {
        text.push_str(&digits);
        text.push_str(&"0".repeat((point - count) as usize));
    } else if 0 < point && point <= 21 {
        let (whole, fraction) = digits.split_at(point as usize);
        text.push_str(whole);
        text.push('.');
        text.push_str(fraction);
    } else if -6 < point && point <= 0 {
        text.push_str("0.");
        text.push_str(&"0".repeat((-point) as usize));
        text.push_str(&digits);
    } else {
        let (first, rest) = digits.split_at(1);
        text.push_str(first);
        if !rest.is_empty() {
            text.push('.');
            text.push_str(rest);
        }
        text.push('e');
        text.push(if point > 0 { '+' } else { '-' });
        text.push_str(&(point - 1).abs().to_string());
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The value and the length that `WTF__parseDouble` gives for `text`.
    fn parsed(text: &[u8]) -> (f64, usize) {
        let mut counted = usize::MAX;
        // SAFETY: `text` is readable and `counted` is a local.
        let value = unsafe { WTF__parseDouble(text.as_ptr(), text.len(), &raw mut counted) };
        (value, counted)
    }

    #[test]
    fn a_double_is_the_longest_decimal_prefix() {
        let read: [(&[u8], f64, usize); 13] = [
            (b"1.5", 1.5, 3),
            (b"123456789012", 123456789012.0, 12),
            (b".5", 0.5, 2),
            (b"5.", 5.0, 2),
            (b"1.e3", 1000.0, 4),
            (b"1e3", 1000.0, 3),
            (b"1E+3", 1000.0, 4),
            (b"25e-2;", 0.25, 5),
            (b"1e", 1.0, 1),
            (b"1e+", 1.0, 1),
            (b"-2.5x", -2.5, 4),
            (b"9007199254740993", 9007199254740992.0, 16),
            (b"1e999", f64::INFINITY, 5),
        ];
        for (text, value, length) in read {
            assert_eq!(parsed(text), (value, length), "{}", text.escape_ascii());
        }
        let not_read: [&[u8]; 7] = [b"", b".", b"-", b"e5", b"+1", b" 1", b"x"];
        for text in not_read {
            assert_eq!(parsed(text), (0.0, 0), "{}", text.escape_ascii());
        }
    }

    #[test]
    fn a_scan_stops_where_its_kernel_stops() {
        // a b space tab ' c \ d " e # f @ g * h DEL i, the two bytes of U+00E9, and a line feed.
        let text = b"ab \t'c\\d\"e#f@g*h\x7Fi\xC3\xA9\n";
        let (start, len) = (text.as_ptr(), text.len());
        // SAFETY: every call passes a range inside `text` or inside a literal.
        unsafe {
            assert_eq!(highway_index_of_char(start, len, b'c'), 5);
            assert_eq!(highway_index_of_char(start, len, b'z'), len);
            assert_eq!(highway_last_index_of_char(start, len, b'z'), len);
            assert_eq!(highway_last_index_of_char(b"aba".as_ptr(), 3, b'a'), 2);
            assert_eq!(highway_index_of_not_char(start, len, b'a'), 1);
            assert_eq!(highway_count_char(b"aba".as_ptr(), 3, b'a'), 2);
            assert_eq!(highway_index_of_any_char(start, len, b"@#".as_ptr(), 2), 10);
            assert_eq!(
                highway_last_index_of_any_char(start, len, b"@#".as_ptr(), 2),
                12
            );
            let in_string = highway_index_of_interesting_character_in_string_literal;
            assert_eq!(in_string(start, len, b'\''), 3);
            assert_eq!(4 + in_string(start.add(4), len - 4, b'\''), 4);
            assert_eq!(4 + in_string(start.add(4), len - 4, b'"'), 6);
            assert_eq!(7 + in_string(start.add(7), len - 7, b'\''), 16);
            let in_comment = highway_index_of_interesting_character_in_multiline_comment;
            assert_eq!(in_comment(start, len), 14);
            assert_eq!(15 + in_comment(start.add(15), len - 15), 18);
            assert_eq!(highway_index_of_newline_or_non_ascii(start, len), 3);
            assert_eq!(
                4 + highway_index_of_newline_or_non_ascii(start.add(4), len - 4),
                18
            );
            let in_line = highway_index_of_newline_or_non_ascii_or_hash_or_at;
            assert_eq!(in_line(start, len), 3);
            assert_eq!(4 + in_line(start.add(4), len - 4), 10);
            assert_eq!(11 + in_line(start.add(11), len - 11), 12);
            assert_eq!(13 + in_line(start.add(13), len - 13), 16);
            assert_eq!(
                highway_index_of_space_or_newline_or_non_ascii(start, len),
                2
            );
            assert_eq!(highway_index_of_space_or_newline_or_non_ascii(start, 2), 2);
            assert!(highway_contains_newline_or_non_ascii_or_quote(start, len));
            assert!(highway_contains_newline_or_non_ascii_or_quote(
                start.add(4),
                6
            ));
            assert!(!highway_contains_newline_or_non_ascii_or_quote(
                start.add(4),
                4
            ));
            let needs_escape = highway_index_of_needs_escape_for_javascript_string;
            assert_eq!(needs_escape(b"a$b`".as_ptr(), 4, b'`'), 1);
            assert_eq!(needs_escape(b"a$b`".as_ptr(), 4, b'"'), 4);
            assert_eq!(needs_escape(b"a$b'".as_ptr(), 4, b'\''), 3);
            assert_eq!(needs_escape(start.add(13), 4, b'"'), 3);
        }
    }

    #[test]
    fn an_occurrence_is_the_first_or_the_last() {
        let haystack = b"abcabc";
        let wide: Vec<u16> = haystack.iter().map(|&byte| u16::from(byte)).collect();
        let (start, len) = (haystack.as_ptr(), haystack.len());
        // SAFETY: every call passes a range inside a slice.
        unsafe {
            assert_eq!(highway_memmem(start, len, b"bc".as_ptr(), 2), start.add(1));
            assert!(highway_memmem(start, len, b"cb".as_ptr(), 2).is_null());
            assert!(highway_memmem(start, 1, b"ab".as_ptr(), 2).is_null());
            assert_eq!(highway_memmem(start, len, b"".as_ptr(), 0), start);
            assert_eq!(highway_memrmem(start, len, b"bc".as_ptr(), 2), 4);
            assert_eq!(highway_memrmem(start, len, b"".as_ptr(), 0), len);
            assert_eq!(highway_memrmem(start, 1, b"bc".as_ptr(), 2), usize::MAX);
            assert_eq!(
                highway_memmem16(wide.as_ptr(), len, wide[1..].as_ptr(), 2),
                1
            );
            assert_eq!(
                highway_memmem16(wide.as_ptr(), 1, wide.as_ptr(), 2),
                usize::MAX
            );
            assert_eq!(
                highway_memrmem16(wide.as_ptr(), len, wide[1..].as_ptr(), 2),
                4
            );
            assert_eq!(highway_memrmem16(wide.as_ptr(), len, wide.as_ptr(), 0), len);
        }
    }

    #[test]
    fn utf16_becomes_utf8_up_to_a_surrogate_without_a_pair() {
        let text = "a\u{E9}\u{20AC}\u{1F600}";
        let units: Vec<u16> = text.encode_utf16().collect();
        let mut utf8 = [0u8; 16];
        let start = units.as_ptr();
        // SAFETY: every call passes a range inside a slice, and `utf8` has 3 bytes for each unit.
        unsafe {
            assert_eq!(simdutf__utf8_length_from_utf16le(start, 5), 10);
            assert_eq!(
                simdutf__utf8_length_from_utf16le_with_replacement(start, 5),
                10
            );
            let all = simdutf__convert_utf16le_to_utf8_with_errors(start, 5, utf8.as_mut_ptr());
            assert_eq!((all.error, &utf8[..all.count]), (SUCCESS, text.as_bytes()));
            assert_eq!(simdutf__utf8_length_from_utf16le(start, 4), 8);
            assert_eq!(
                simdutf__utf8_length_from_utf16le_with_replacement(start, 4),
                9
            );
            let cut = simdutf__convert_utf16le_to_utf8_with_errors(start, 4, utf8.as_mut_ptr());
            assert_eq!((cut.error, cut.count), (SURROGATE, 3));
            let low =
                simdutf__convert_utf16le_to_utf8_with_errors(start.add(4), 1, utf8.as_mut_ptr());
            assert_eq!((low.error, low.count), (SURROGATE, 0));
            assert!(simdutf__validate_ascii(b"abc".as_ptr(), 3));
            assert!(!simdutf__validate_ascii(text.as_ptr(), text.len()));
            assert!(simdutf__validate_utf8(text.as_ptr(), text.len()));
            assert!(!simdutf__validate_utf8(b"\xED\xA0\x80".as_ptr(), 3));
        }
    }

    #[test]
    fn base64_is_padded_unless_it_is_for_a_url() {
        let encoded = |input: &[u8], is_urlsafe: c_int| {
            let mut output = [0u8; 8];
            let (from, to) = (input.as_ptr(), output.as_mut_ptr());
            // SAFETY: `input` is readable and at most 4 bytes, and `output` has room for their digits.
            let written = unsafe { simdutf__base64_encode(from, input.len(), to, is_urlsafe) };
            output[..written].to_vec()
        };
        assert_eq!(encoded(b"", 0), b"");
        assert_eq!(encoded(b"f", 0), b"Zg==");
        assert_eq!(encoded(b"fo", 0), b"Zm8=");
        assert_eq!(encoded(b"foo", 0), b"Zm9v");
        assert_eq!(encoded(b"foob", 0), b"Zm9vYg==");
        assert_eq!(encoded(b"\xFB\xFF\xFE", 0), b"+//+");
        assert_eq!(encoded(b"\xFB\xFF\xFE", 1), b"-__-");
        assert_eq!(encoded(b"fo", 1), b"Zm8");
    }

    /// How many blocks `heap` has.
    fn blocks_of(heap: *mut c_void) -> usize {
        let blocks = BLOCKS.lock();
        let of_heap = |block: &&Block| block.heap == heap.addr();
        blocks.live.values().filter(of_heap).count()
    }

    #[test]
    fn a_heap_frees_its_blocks_when_it_is_destroyed() {
        let (heap, other) = (mi_heap_new(), mi_heap_new());
        assert_ne!(heap, other);
        let first = mi_heap_malloc(heap, 24);
        let aligned = mi_heap_zalloc_aligned(heap, 100, 64);
        let kept = mi_heap_malloc(other, 0);
        assert_eq!(first.addr() % MI_MAX_ALIGN_SIZE, 0);
        assert_eq!(aligned.addr() % 64, 0);
        assert!(!kept.is_null());
        assert_eq!(mi_malloc_usable_size(first), 24);
        assert!(mi_is_in_heap_region(first.wrapping_byte_add(23)));
        assert!(!mi_is_in_heap_region(null_mut()));
        assert_eq!(mi_expand(first, 24), first);
        assert!(mi_expand(first, 25).is_null());
        // SAFETY: `aligned` holds 100 bytes, and `first` and the block it grows to hold 24.
        let grown = unsafe {
            assert_eq!(aligned.cast::<[u8; 100]>().read(), [0; 100]);
            first.cast::<[u8; 24]>().write([7; 24]);
            let grown = mi_heap_realloc_aligned(heap, first, 4096, 32);
            assert_eq!(grown.cast::<[u8; 24]>().read(), [7; 24]);
            grown
        };
        assert_eq!(grown.addr() % 32, 0);
        assert_eq!(mi_usable_size(grown), 4096);
        assert_eq!((blocks_of(heap), blocks_of(other)), (2, 1));
        mi_free_size(aligned, 100);
        mi_free(null_mut());
        assert_eq!((blocks_of(heap), blocks_of(other)), (1, 1));
        mi_heap_destroy(heap);
        assert_eq!((blocks_of(heap), blocks_of(other)), (0, 1));
        mi_heap_destroy(other);
        assert_eq!(blocks_of(other), 0);
        assert!(mi_heap_realloc(mi_heap_main(), core::ptr::dangling_mut(), 8).is_null());
    }

    #[inline(never)]
    fn bound_from_a_deeper_frame() -> *mut c_void {
        Bun__StackCheck__getMaxStack()
    }

    #[test]
    fn the_bound_of_a_stack_stays() {
        let probe = 0u8;
        let first = Bun__StackCheck__getMaxStack();
        assert!(first.addr() < (&raw const probe).addr());
        assert_eq!(first, bound_from_a_deeper_frame());
    }
}
