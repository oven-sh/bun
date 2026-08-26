// ── ArenaPtr ─────────────────────────────────────────────────────────────
//
// `*const MimallocArena` as an [`Allocator`]. Exists so callers can borrow a
// caller-owned `MimallocArena` without a lifetime parameter:
// `ASTMemoryAllocator` is published into raw thread-locals and may outlive any
// nameable `'a`, so `&'a MimallocArena` (which already implements `Allocator`)
// cannot be used directly. The caller guarantees the pointee outlives every
// allocation — same invariant the `ast_alloc` install/uninstall protocol
// already requires.
//
// `arena == null` routes to global `mi_malloc`/`mi_free`, matching
// [`crate::ast_alloc::AstAlloc`] when no AST scope is active.

use core::alloc::{AllocError, Allocator, Layout};
use core::ptr::{self, NonNull};

use crate::{MimallocArena, alloc_result, mimalloc};

/// Borrowed `*const MimallocArena` as an [`Allocator`]. See section doc above.
#[derive(Clone, Copy)]
pub struct ArenaPtr {
    arena: *const MimallocArena,
}

impl ArenaPtr {
    /// Wrap a live `MimallocArena`. The caller guarantees `arena` is not moved,
    /// `reset()`, or dropped while any allocation made through this ref is
    /// live.
    #[inline]
    pub const fn new(arena: *const MimallocArena) -> Self {
        Self { arena }
    }
    /// Null arena → process-global `mi_malloc`/`mi_free`.
    #[inline]
    pub const fn global() -> Self {
        Self { arena: ptr::null() }
    }
    /// Shared borrow of the wrapped arena, or `None` for the global path.
    ///
    /// Single backref-deref site for the `arena: *const MimallocArena` field;
    /// the [`Allocator`] impl below branches on the result instead of
    /// open-coding the null-check + raw-pointer deref at every method.
    #[inline]
    fn arena_ref(&self) -> Option<&MimallocArena> {
        // SAFETY: `arena` is either null (→ `None`) or, per [`ArenaPtr::new`]'s
        // contract, a live `MimallocArena` that is not moved/reset/dropped
        // while any allocation made through this ref is live — i.e. it
        // outlives `&self`. Backref invariant: pointee outlives holder.
        unsafe { self.arena.as_ref() }
    }
}

// SAFETY: when `arena` is non-null this forwards to `&MimallocArena: Allocator`
// (whose contract is documented on that impl); when null it is the global
// mimalloc path (`mi_malloc`/`mi_free`/`mi_realloc_aligned`), identical to
// `BunAllocator` / `AstAlloc`'s null branch. The caller upholds the
// non-dangling invariant on `arena` (see [`ArenaPtr::new`]).
unsafe impl Allocator for ArenaPtr {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        match self.arena_ref() {
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
            match self.arena_ref() {
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
            match self.arena_ref() {
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
