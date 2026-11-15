//! HIR types have no arena parameter, so [`HirAlloc`] uses the arena that the crate's entry points pass to [`with_arena`].

use core::alloc::{AllocError, Allocator, Layout};
use core::cell::Cell;
use core::ptr::NonNull;

use bun_ast::AstArena;

use super::{HirVec, StoreStr};

thread_local! {
    static CURRENT: Cell<Option<NonNull<AstArena>>> = const { Cell::new(None) };
}

/// [`HirAlloc`] allocates in `arena` until `run` returns.
pub(crate) fn with_arena<R>(arena: &AstArena, run: impl FnOnce() -> R) -> R {
    struct Restore(Option<NonNull<AstArena>>);
    impl Drop for Restore {
        fn drop(&mut self) {
            CURRENT.set(self.0);
        }
    }
    let _restore = Restore(CURRENT.replace(Some(NonNull::from(arena))));
    run()
}

#[inline]
fn with_current<R>(then: impl FnOnce(&'static AstArena) -> R) -> R {
    let arena = CURRENT
        .get()
        .expect("HirAlloc used outside of with_arena()");
    // SAFETY: `with_arena` borrows the arena until it restores `CURRENT`, which is after `then` returns. `'static`
    // stands for the lifetime of the AST, as in `StoreStr`.
    then(unsafe { arena.as_ref() })
}

#[derive(Clone, Copy, Default)]
pub struct HirAlloc;

// SAFETY: allocations are new, fit their layout, and are valid until the arena resets. No lifetime enforces that
// collections are dropped by then. The ones that outlive `with_arena` are in `ReactCompilerState`, which is owned by
// the parser, which borrows the arena.
unsafe impl Allocator for HirAlloc {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        let ptr = with_current(|arena| arena.alloc_layout(layout));
        Ok(NonNull::slice_from_raw_parts(ptr, layout.size()))
    }

    #[inline]
    unsafe fn deallocate(&self, _: NonNull<u8>, _: Layout) {}

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        if new.align() > old.align() {
            return Err(AllocError);
        }
        // SAFETY: `ptr` came from `allocate` or `grow` and fits `old`. `new` is not smaller and not more aligned.
        let ptr = with_current(|arena| unsafe { arena.grow(ptr, old.size(), new) });
        Ok(NonNull::slice_from_raw_parts(ptr, new.size()))
    }

    #[inline]
    unsafe fn shrink(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        if new.align() > old.align() {
            return Err(AllocError);
        }
        Ok(NonNull::slice_from_raw_parts(ptr, new.size()))
    }
}

impl HirAlloc {
    #[inline]
    pub const fn vec<T>() -> HirVec<T> {
        Vec::new_in(HirAlloc)
    }

    #[inline]
    pub fn vec_with_capacity<T>(cap: usize) -> HirVec<T> {
        Vec::with_capacity_in(cap, HirAlloc)
    }

    #[inline]
    pub fn vec_from_slice<T: Clone>(items: &[T]) -> HirVec<T> {
        items.to_vec_in(HirAlloc)
    }

    #[inline]
    pub fn vec_from_iter<T>(items: impl IntoIterator<Item = T>) -> HirVec<T> {
        let items = items.into_iter();
        let mut list = Vec::with_capacity_in(items.size_hint().0, HirAlloc);
        list.extend(items);
        list
    }

    /// `core::mem::take` for [`HirVec`], which has no `Default`.
    #[inline]
    pub fn take<T>(list: &mut HirVec<T>) -> HirVec<T> {
        core::mem::replace(list, HirAlloc::vec())
    }

    #[inline]
    pub fn dupe_str(bytes: &[u8]) -> StoreStr {
        with_current(|arena| arena.dupe_str(bytes))
    }
}
