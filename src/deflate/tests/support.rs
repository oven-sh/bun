use core::cell::Cell;
use core::ops::Range;
use std::alloc::{GlobalAlloc, Layout, System};

pub(crate) fn crc32(crc: u32, bytes: &[u8]) -> u32 {
    static TABLE: [u32; 256] = {
        let mut table = [0; 256];
        let mut at = 0;
        while at < 256 * 8 {
            let value = if at % 8 == 0 {
                at as u32 / 8
            } else {
                table[at / 8]
            };
            table[at / 8] = (value >> 1) ^ (value % 2 * 0xEDB8_8320);
            at += 1;
        }
        table
    };
    !bytes.iter().fold(!crc, |crc, &byte| {
        TABLE[usize::from(crc as u8 ^ byte)] ^ (crc >> 8)
    })
}

pub(crate) fn adler32(bytes: &[u8]) -> u32 {
    continue_adler32(1, bytes)
}

fn continue_adler32(adler: u32, bytes: &[u8]) -> u32 {
    let (mut low, mut high) = (adler & 0xffff, adler >> 16);
    for &byte in bytes {
        low = (low + u32::from(byte)) % 65521;
        high = (high + low) % 65521;
    }
    (high << 16) | low
}

// These stand in for Highway kernels, which tests in test/js cover.

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_crc32(state: u32, bytes: *const u8, len: usize) -> u64 {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    u64::from(!crc32(!state, unsafe {
        core::slice::from_raw_parts(bytes, len)
    }))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_copy_and_crc32(
    state: u32,
    bytes: *const u8,
    copy: *mut u8,
    len: usize,
) -> u64 {
    // SAFETY: the caller passes a slice, and room for it.
    unsafe {
        copy.copy_from_nonoverlapping(bytes, len);
        highway_crc32(state, bytes, len)
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_adler32(adler: u32, bytes: *const u8, len: usize) -> u32 {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    continue_adler32(adler, unsafe { core::slice::from_raw_parts(bytes, len) })
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(bytes: *const u8, len: usize, byte: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let bytes = unsafe { core::slice::from_raw_parts(bytes, len) };
    bytes.iter().take_while(|&&other| other != byte).count()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_common_prefix_length(a: *const u8, b: *const u8, len: usize) -> usize {
    use core::slice::from_raw_parts;
    // SAFETY: the caller passes two slices.
    let (a, b) = unsafe { (from_raw_parts(a, len), from_raw_parts(b, len)) };
    a.iter().zip(b).take_while(|(a, b)| a == b).count()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_repeat(from: *const u8, to: *mut u8, _: usize, len: usize) {
    // SAFETY: both have more, and `to` is a period behind `from`.
    (0..len).for_each(|at| unsafe { *to.add(at) = *from.add(at) });
}

thread_local! {
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
    static BYTES: Cell<usize> = const { Cell::new(0) };
    static FAILING: Cell<[usize; 2]> = const { Cell::new([0; 2]) };
    static FAILED_SIZE: Cell<usize> = const { Cell::new(0) };
}

struct Allocator;

#[global_allocator]
static ALLOCATOR: Allocator = Allocator;

fn fails(size: usize) -> bool {
    let [start, end] = FAILING.get();
    BYTES.set(BYTES.get() + size);
    if (start..end).contains(&ALLOCATIONS.replace(ALLOCATIONS.get() + 1)) {
        FAILED_SIZE.set(size);
    }
    size == FAILED_SIZE.get()
}

// SAFETY: it is `System`, or returns null.
unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        match fails(layout.size()) {
            true => core::ptr::null_mut(),
            // SAFETY: the caller's.
            false => unsafe { System.alloc(layout) },
        }
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        match fails(size) {
            true => core::ptr::null_mut(),
            // SAFETY: the caller's.
            false => unsafe { System.realloc(pointer, layout, size) },
        }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        // SAFETY: the caller's.
        unsafe { System.dealloc(pointer, layout) }
    }
}

/// For what stands in for code that does not allocate.
pub(crate) fn uncounted<R>(body: impl FnOnce() -> R) -> R {
    let before = (ALLOCATIONS.get(), FAILING.take(), FAILED_SIZE.take());
    let result = body();
    ALLOCATIONS.set(before.0);
    FAILING.set(before.1);
    FAILED_SIZE.set(before.2);
    result
}

/// Runs `body`, in which the allocations that are `failing` do, and so does asking again. Also returns how many it asked for.
pub(crate) fn with_failing<R>(failing: Range<usize>, body: impl FnOnce() -> R) -> (R, usize) {
    ALLOCATIONS.set(0);
    FAILING.set([failing.start, failing.end]);
    let result = body();
    FAILING.set([0; 2]);
    FAILED_SIZE.set(0);
    (result, ALLOCATIONS.get())
}

pub(crate) fn bytes_allocated_by(body: impl FnOnce()) -> usize {
    let before = BYTES.get();
    body();
    BYTES.get() - before
}

pub(crate) struct Random(pub(crate) u32);

impl Random {
    pub(crate) fn below(&mut self, limit: usize) -> usize {
        self.0 = self.0.wrapping_mul(1_103_515_245).wrapping_add(12345);
        ((self.0 >> 8) as usize * limit) >> 24
    }

    pub(crate) fn bytes(&mut self, len: usize) -> Vec<u8> {
        (0..len).map(|_| self.below(256) as u8).collect()
    }
}

/// Appends `len` bytes from `offset` before the end on, or from the start.
pub(crate) fn copy(data: &mut Vec<u8>, len: usize, offset: usize) {
    let offset = offset.min(data.len());
    for _ in 0..if offset == 0 { 0 } else { len } {
        data.push(data[data.len() - offset]);
    }
}
