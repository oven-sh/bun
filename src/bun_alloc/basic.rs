use core::ffi::c_void;

use crate::mimalloc;
// TODO(port): `Allocator`/`AllocatorVTable`/`Alignment` are the bun_alloc crate's
// equivalents of `std.mem.Allocator`, its `VTable`, and `std.mem.Alignment`.
// Phase B may reshape the vtable struct into `trait Allocator` impls instead.
use crate::{Alignment, Allocator, AllocatorVTable};

crate::declare_scope!(mimalloc, hidden);

fn mimalloc_free(_: *mut c_void, buf: &mut [u8], alignment: Alignment, _: usize) {
    crate::scoped_log!(mimalloc, "mi_free({})", buf.len());
    // mi_free_size internally just asserts the size
    // so it's faster if we don't pass that value through
    // but its good to have that assertion
    // let's only enable it in debug mode
    if cfg!(debug_assertions) {
        if mimalloc::must_use_aligned_alloc(alignment) {
            // SAFETY: buf.ptr was allocated by mimalloc with this alignment
            unsafe {
                mimalloc::mi_free_size_aligned(
                    buf.as_mut_ptr().cast(),
                    buf.len(),
                    alignment.to_byte_units(),
                )
            }
        } else {
            // SAFETY: buf.ptr was allocated by mimalloc
            unsafe { mimalloc::mi_free_size(buf.as_mut_ptr().cast(), buf.len()) }
        }
    } else {
        // SAFETY: buf.ptr was allocated by mimalloc
        unsafe { mimalloc::mi_free(buf.as_mut_ptr().cast()) }
    }
}

pub(crate) struct MimallocAllocator;

impl MimallocAllocator {
    fn aligned_alloc(len: usize, alignment: Alignment) -> *mut u8 {
        crate::scoped_log!(mimalloc, "mi_alloc({}, {})", len, alignment.to_byte_units());

        let ptr: *mut c_void = if mimalloc::must_use_aligned_alloc(alignment) {
            // SAFETY: mimalloc FFI; len/alignment are valid
            unsafe { mimalloc::mi_malloc_aligned(len, alignment.to_byte_units()) }
        } else {
            // SAFETY: mimalloc FFI; len is valid
            unsafe { mimalloc::mi_malloc(len) }
        };

        #[cfg(debug_assertions)]
        {
            if !ptr.is_null() {
                // SAFETY: ptr is non-null and was just returned by mimalloc
                let usable = unsafe { mimalloc::mi_malloc_usable_size(ptr) };
                if usable < len && !ptr.is_null() {
                    panic!("mimalloc: allocated size is too small: {} < {}", usable, len);
                }
            }
        }

        ptr.cast::<u8>()
    }

    #[allow(dead_code)]
    fn aligned_alloc_size(ptr: *mut u8) -> usize {
        // SAFETY: ptr was allocated by mimalloc
        unsafe { mimalloc::mi_malloc_size(ptr.cast()) }
    }

    fn alloc_with_default_allocator(
        _: *mut c_void,
        len: usize,
        alignment: Alignment,
        _: usize,
    ) -> *mut u8 {
        Self::aligned_alloc(len, alignment)
    }

    fn resize_with_default_allocator(
        _: *mut c_void,
        buf: &mut [u8],
        _: Alignment,
        new_len: usize,
        _: usize,
    ) -> bool {
        // SAFETY: buf.ptr was allocated by mimalloc
        unsafe { !mimalloc::mi_expand(buf.as_mut_ptr().cast(), new_len).is_null() }
    }

    fn remap_with_default_allocator(
        _: *mut c_void,
        buf: &mut [u8],
        alignment: Alignment,
        new_len: usize,
        _: usize,
    ) -> *mut u8 {
        // SAFETY: buf.ptr was allocated by mimalloc with this alignment
        unsafe {
            mimalloc::mi_realloc_aligned(buf.as_mut_ptr().cast(), new_len, alignment.to_byte_units())
                .cast::<u8>()
        }
    }

    const FREE_WITH_DEFAULT_ALLOCATOR: fn(*mut c_void, &mut [u8], Alignment, usize) = mimalloc_free;
}

pub static C_ALLOCATOR: Allocator = Allocator {
    // This ptr can be anything. But since it's not nullable, we should set it to something.
    ptr: memory_allocator_tags::DEFAULT_ALLOCATOR_TAG_PTR,
    vtable: C_ALLOCATOR_VTABLE,
};
static C_ALLOCATOR_VTABLE: &AllocatorVTable = &AllocatorVTable {
    alloc: MimallocAllocator::alloc_with_default_allocator,
    resize: MimallocAllocator::resize_with_default_allocator,
    remap: MimallocAllocator::remap_with_default_allocator,
    free: MimallocAllocator::FREE_WITH_DEFAULT_ALLOCATOR,
};

pub(crate) struct ZAllocator;

impl ZAllocator {
    fn aligned_alloc(len: usize, alignment: Alignment) -> *mut u8 {
        crate::scoped_log!(mimalloc, "ZAllocator.alignedAlloc: {}\n", len);

        let ptr: *mut c_void = if mimalloc::must_use_aligned_alloc(alignment) {
            // SAFETY: mimalloc FFI; len/alignment are valid
            unsafe { mimalloc::mi_zalloc_aligned(len, alignment.to_byte_units()) }
        } else {
            // SAFETY: mimalloc FFI; len is valid
            unsafe { mimalloc::mi_zalloc(len) }
        };

        #[cfg(debug_assertions)]
        {
            if !ptr.is_null() {
                // SAFETY: ptr is non-null and was just returned by mimalloc
                let usable = unsafe { mimalloc::mi_malloc_usable_size(ptr) };
                if usable < len {
                    panic!("mimalloc: allocated size is too small: {} < {}", usable, len);
                }
            }
        }

        ptr.cast::<u8>()
    }

    fn aligned_alloc_size(ptr: *mut u8) -> usize {
        // SAFETY: ptr was allocated by mimalloc
        unsafe { mimalloc::mi_malloc_size(ptr.cast()) }
    }

    fn alloc_with_z_allocator(
        _: *mut c_void,
        len: usize,
        alignment: Alignment,
        _: usize,
    ) -> *mut u8 {
        Self::aligned_alloc(len, alignment)
    }

    fn resize_with_z_allocator(
        _: *mut c_void,
        buf: &mut [u8],
        _: Alignment,
        new_len: usize,
        _: usize,
    ) -> bool {
        if new_len <= buf.len() {
            return true;
        }

        let full_len = Self::aligned_alloc_size(buf.as_mut_ptr());
        if new_len <= full_len {
            return true;
        }

        false
    }

    const FREE_WITH_Z_ALLOCATOR: fn(*mut c_void, &mut [u8], Alignment, usize) = mimalloc_free;
}

pub(crate) mod memory_allocator_tags {
    use core::ffi::c_void;

    const DEFAULT_ALLOCATOR_TAG: usize = 0xBEEFA110C; // "BEEFA110C"  beef a110c i guess
    pub const DEFAULT_ALLOCATOR_TAG_PTR: *mut c_void = DEFAULT_ALLOCATOR_TAG as *mut c_void;

    const Z_ALLOCATOR_TAG: usize = 0x2a11043470123; // "z4110c4701" (Z ALLOCATOR in 1337 speak)
    pub const Z_ALLOCATOR_TAG_PTR: *mut c_void = Z_ALLOCATOR_TAG as *mut c_void;
}

pub static Z_ALLOCATOR: Allocator = Allocator {
    ptr: memory_allocator_tags::Z_ALLOCATOR_TAG_PTR,
    vtable: &Z_ALLOCATOR_VTABLE,
};
static Z_ALLOCATOR_VTABLE: AllocatorVTable = AllocatorVTable {
    alloc: ZAllocator::alloc_with_z_allocator,
    resize: ZAllocator::resize_with_z_allocator,
    remap: Allocator::no_remap,
    free: ZAllocator::FREE_WITH_Z_ALLOCATOR,
};

/// mimalloc can free allocations without being given their size.
pub fn free_without_size(ptr: *mut c_void) {
    // SAFETY: ptr is null or was allocated by mimalloc; mi_free accepts null
    unsafe { mimalloc::mi_free(ptr) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/basic.zig (154 lines)
//   confidence: medium
//   todos:      1
//   notes:      Zig Allocator.VTable struct kept literally; Phase B may reshape to `impl Allocator for MimallocAllocator/ZAllocator` trait impls. `static` items with raw-ptr fields need `unsafe impl Sync` on Allocator/AllocatorVTable.
// ──────────────────────────────────────────────────────────────────────────
