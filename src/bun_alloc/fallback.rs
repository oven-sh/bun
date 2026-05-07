use core::ffi::c_void;

use crate::Alignment;

pub mod z;

/// `std.heap.c_allocator` — a `std.mem.Allocator` value backed by libc
/// malloc/free. Exposed as a ZST with inherent `raw_*` methods mirroring the
/// Zig vtable so the zeroing wrapper in `z.rs` can layer on top.
#[derive(Clone, Copy, Default)]
pub struct CAllocator;

pub static C_ALLOCATOR: CAllocator = CAllocator;

impl CAllocator {
    #[inline]
    pub fn raw_alloc(&self, len: usize, alignment: Alignment, _ret_addr: usize) -> Option<*mut u8> {
        // libc malloc guarantees alignment to `max_align_t`; for larger
        // alignments use the aligned variant (Zig's `CAllocator` does the same).
        let align = alignment.to_byte_units();
        // `max_align_t` alignment — the `libc` crate doesn't expose this on
        // Windows MSVC; both x86_64 and aarch64 ABIs guarantee 16 here.
        const MALLOC_ALIGN: usize = 2 * core::mem::size_of::<usize>();
        // SAFETY: libc malloc/aligned_alloc are sound for any nonzero size.
        let ptr = unsafe {
            if align <= MALLOC_ALIGN {
                libc::malloc(len)
            } else {
                #[cfg(windows)]
                { libc::aligned_malloc(len, align) }
                #[cfg(not(windows))]
                { libc::aligned_alloc(align, len) }
            }
        };
        if ptr.is_null() { None } else { Some(ptr.cast()) }
    }

    #[inline]
    pub fn raw_resize(
        &self,
        buf: &mut [u8],
        _alignment: Alignment,
        new_len: usize,
        _ret_addr: usize,
    ) -> bool {
        // Zig `CAllocator.resize`: in-place only — succeed on shrink or if the
        // backing allocation already has enough usable size; never relocate.
        if new_len <= buf.len() {
            return true;
        }
        #[cfg(target_os = "macos")]
        {
            // SAFETY: `buf` was allocated by libc malloc on this platform.
            let usable = unsafe { libc::malloc_size(buf.as_ptr().cast()) };
            return new_len <= usable;
        }
        #[cfg(target_os = "linux")]
        {
            // SAFETY: `buf` was allocated by libc malloc on this platform.
            let usable = unsafe { libc::malloc_usable_size(buf.as_mut_ptr().cast()) };
            return new_len <= usable;
        }
        #[allow(unreachable_code)]
        false
    }

    #[inline]
    pub fn raw_free(&self, buf: &mut [u8], _alignment: Alignment, _ret_addr: usize) {
        // SAFETY: `buf` was allocated by `raw_alloc` (libc malloc/aligned_alloc),
        // both of which are freed via `free`.
        unsafe { libc::free(buf.as_mut_ptr().cast()) }
    }
}

impl crate::Allocator for CAllocator {}

pub use z::ALLOCATOR as z_allocator;

/// libc can free allocations without being given their size.
pub fn free_without_size(ptr: *mut c_void) {
    // SAFETY: `ptr` was allocated by libc malloc/calloc/realloc (or is null, which
    // libc free accepts as a no-op) — same precondition as Zig `std.c.free`.
    unsafe { libc::free(ptr) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/fallback.zig (9 lines)
//   confidence: medium
//   notes:      c_allocator → `CAllocator` ZST with inherent raw_* methods
//               (Zig std.heap.c_allocator vtable). z_allocator re-exported.
// ──────────────────────────────────────────────────────────────────────────
