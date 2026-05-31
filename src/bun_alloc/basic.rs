use core::ffi::c_void;

use crate::{default_alloc, mimalloc};
// TODO(port): `Allocator`/`AllocatorVTable`/`Alignment` are the bun_alloc crate's
// equivalents of `std.mem.Allocator`, its `VTable`, and `std.mem.Alignment`.
// TODO(refactor): consider reshaping the vtable struct into `trait Allocator` impls.
use crate::{Alignment, AllocatorVTable, StdAllocator};

// Zig: `const log = bun.Output.scoped(.mimalloc, .hidden);` — `Output.scoped`
// lives in `bun_core`, which depends on this crate, so the hidden-scope debug
// tracing is dropped here rather than re-declared as a no-op stub.

/// # Safety
/// `ptr` must have been allocated by mimalloc with the given `size`/`align`.
#[inline(always)]
pub(crate) unsafe fn mi_free_checked(ptr: *mut c_void, size: usize, align: usize) {
    if cfg!(debug_assertions) {
        // SAFETY: `mi_is_in_heap_region` accepts any pointer; remaining calls
        // are sound by the caller contract above.
        unsafe {
            debug_assert!(mimalloc::mi_is_in_heap_region(ptr));
            if mimalloc::must_use_aligned_alloc(align) {
                mimalloc::mi_free_size_aligned(ptr, size, align);
            } else {
                mimalloc::mi_free_size(ptr, size);
            }
        }
    } else {
        let _ = (size, align);
        // SAFETY: caller contract — `ptr` was allocated by mimalloc.
        unsafe { mimalloc::mi_free(ptr) }
    }
}

pub(crate) fn default_allocator_free(_: *mut c_void, buf: &mut [u8], _: Alignment, _: usize) {
    // SAFETY: Allocator vtable invariant — `buf` was allocated by the default allocator.
    unsafe { default_alloc::free(buf.as_mut_ptr().cast()) }
}

pub(crate) struct MimallocAllocator;

impl MimallocAllocator {
    fn aligned_alloc(len: usize, alignment: Alignment) -> *mut u8 {
        let ptr: *mut c_void = default_alloc::malloc_aligned(len, alignment.to_byte_units());

        #[cfg(debug_assertions)]
        {
            if !ptr.is_null() {
                // SAFETY: ptr is non-null and was just returned by the default allocator
                let usable = unsafe { default_alloc::usable_size(ptr) };
                if usable < len && !ptr.is_null() {
                    panic!(
                        "default allocator: allocated size is too small: {} < {}",
                        usable, len
                    );
                }
            }
        }

        ptr.cast::<u8>()
    }

    fn alloc_with_default_allocator(
        _: *mut c_void,
        len: usize,
        alignment: Alignment,
        _: usize,
    ) -> *mut u8 {
        Self::aligned_alloc(len, alignment)
    }

    pub(crate) fn resize_with_default_allocator(
        _: *mut c_void,
        buf: &mut [u8],
        _: Alignment,
        new_len: usize,
        _: usize,
    ) -> bool {
        if cfg!(bun_asan) {
            return false;
        }
        // SAFETY: buf.ptr was allocated by mimalloc (non-ASAN ⇒ default = mimalloc)
        unsafe { !mimalloc::mi_expand(buf.as_mut_ptr().cast(), new_len).is_null() }
    }

    pub(crate) fn remap_with_default_allocator(
        _: *mut c_void,
        buf: &mut [u8],
        alignment: Alignment,
        new_len: usize,
        _: usize,
    ) -> *mut u8 {
        // SAFETY: buf.ptr was allocated by the default allocator with this alignment
        unsafe {
            default_alloc::realloc_aligned(
                buf.as_mut_ptr().cast(),
                new_len,
                alignment.to_byte_units(),
            )
            .cast::<u8>()
        }
    }

    const FREE_WITH_DEFAULT_ALLOCATOR: fn(*mut c_void, &mut [u8], Alignment, usize) =
        default_allocator_free;
}

pub static C_ALLOCATOR: StdAllocator = StdAllocator {
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
        let ptr: *mut c_void = default_alloc::zalloc_aligned(len, alignment.to_byte_units());

        #[cfg(debug_assertions)]
        {
            if !ptr.is_null() {
                // SAFETY: ptr is non-null and was just returned by the default allocator
                let usable = unsafe { default_alloc::usable_size(ptr) };
                if usable < len {
                    panic!(
                        "default allocator: allocated size is too small: {} < {}",
                        usable, len
                    );
                }
            }
        }

        ptr.cast::<u8>()
    }

    fn aligned_alloc_size(ptr: *mut u8) -> usize {
        // SAFETY: ptr was allocated by the default allocator
        unsafe { default_alloc::usable_size(ptr.cast()) }
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

    const FREE_WITH_Z_ALLOCATOR: fn(*mut c_void, &mut [u8], Alignment, usize) =
        default_allocator_free;
}

pub(crate) mod memory_allocator_tags {
    use core::ffi::c_void;

    const DEFAULT_ALLOCATOR_TAG: usize = 0xBEEFA110C; // "BEEFA110C"  beef a110c i guess
    pub(crate) const DEFAULT_ALLOCATOR_TAG_PTR: *mut c_void = DEFAULT_ALLOCATOR_TAG as *mut c_void;

    const Z_ALLOCATOR_TAG: usize = 0x2a11043470123; // "z4110c4701" (Z ALLOCATOR in 1337 speak)
    pub(crate) const Z_ALLOCATOR_TAG_PTR: *mut c_void = Z_ALLOCATOR_TAG as *mut c_void;
}

pub static Z_ALLOCATOR: StdAllocator = StdAllocator {
    ptr: memory_allocator_tags::Z_ALLOCATOR_TAG_PTR,
    vtable: &Z_ALLOCATOR_VTABLE,
};
static Z_ALLOCATOR_VTABLE: AllocatorVTable = AllocatorVTable {
    alloc: ZAllocator::alloc_with_z_allocator,
    resize: ZAllocator::resize_with_z_allocator,
    remap: AllocatorVTable::NO_REMAP,
    free: ZAllocator::FREE_WITH_Z_ALLOCATOR,
};

/// mimalloc can free allocations without being given their size.
///
/// # Safety
/// `ptr` must be null or have been allocated by mimalloc.
pub unsafe fn free_without_size(ptr: *mut c_void) {
    // SAFETY: caller contract — ptr is null or was allocated by mimalloc; mi_free accepts null
    unsafe { mimalloc::mi_free(ptr) }
}

// ported from: src/bun_alloc/basic.zig
