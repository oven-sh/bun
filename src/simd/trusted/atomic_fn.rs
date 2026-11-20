use core::marker::PhantomData;
use core::mem::transmute_copy;
use core::ops::FnPtr;
use core::sync::atomic::{AtomicPtr, Ordering::Relaxed};

/// Invariant in `F`, so that `set` cannot store a function with shorter lifetime bounds.
pub struct AtomicFn<F>(AtomicPtr<()>, PhantomData<fn(F) -> F>);

impl<F: FnPtr> AtomicFn<F> {
    pub const fn new(f: F) -> Self {
        // SAFETY: a function pointer has the size of a pointer, and all its bytes are initialized.
        Self(AtomicPtr::new(unsafe { transmute_copy(&f) }), PhantomData)
    }

    #[inline(always)]
    pub fn set(&self, f: F) {
        self.0.store(f.as_ptr().as_ptr().cast(), Relaxed);
    }

    #[inline(always)]
    pub fn get(&self) -> F {
        // SAFETY: only an `F` is ever stored.
        unsafe { transmute_copy(&self.0.load(Relaxed)) }
    }
}
