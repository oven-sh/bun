use core::alloc::{AllocError, Allocator, Layout};
use core::ptr::NonNull;

use crate::{MimallocArena, alloc_result, mimalloc};

/// A borrowed arena, or the global heap, as an [`Allocator`].
#[derive(Clone, Copy)]
pub struct ArenaPtr<'a> {
    arena: Option<&'a MimallocArena>,
}

impl<'a> ArenaPtr<'a> {
    #[inline]
    pub const fn new(arena: &'a MimallocArena) -> Self {
        Self { arena: Some(arena) }
    }
    /// Process-global `mi_malloc`/`mi_free`.
    #[inline]
    pub const fn global() -> Self {
        Self { arena: None }
    }
}

// SAFETY: `Some` forwards to `&MimallocArena: Allocator` (whose contract is
// documented on that impl); `None` is the global mimalloc path
// (`mi_malloc`/`mi_free`/`mi_realloc_aligned`).
unsafe impl Allocator for ArenaPtr<'_> {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        match self.arena {
            Some(a) => a.allocate(layout),
            None => {
                let p = mimalloc::mi_malloc_auto_align(layout.size(), layout.align());
                alloc_result(p, layout.size())
            }
        }
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        // SAFETY: `ptr` was returned by this allocator's `allocate`/`grow`
        // (caller contract). Both arms forward it to the matching mimalloc
        // free path; `&MimallocArena::deallocate` is `mi_free` (heap-agnostic),
        // so the `Some` arm is correct even if `ptr` was allocated under a
        // different arena and later grown here.
        unsafe {
            match self.arena {
                Some(a) => a.deallocate(ptr, layout),
                None => mimalloc::mi_free(ptr.as_ptr().cast()),
            }
        }
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // SAFETY: `ptr` is a live mimalloc block returned by this allocator
        // (caller contract); both arms forward it to the matching realloc.
        unsafe {
            match self.arena {
                Some(a) => a.grow(ptr, old, new),
                None => alloc_result(
                    mimalloc::mi_realloc_aligned(ptr.as_ptr().cast(), new.size(), new.align()),
                    new.size(),
                ),
            }
        }
    }

    #[inline]
    unsafe fn shrink(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // SAFETY: same paths as `grow`.
        unsafe { self.grow(ptr, old, new) }
    }
}
