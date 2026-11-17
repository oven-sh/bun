//! Proofs about the calling thread that have no size. `&Loop<T>` is a `&T` with the proof, `Loop` is the proof alone.
//! `bun_jsc` has `Js` and `Vm`.

use core::marker::PhantomData;
use core::ops::Deref;

/// # Safety
/// `Self` is a transparent wrapper of `Of`, and `On<U>` is the same wrapper of `U`.
pub unsafe trait Proof {
    type Of;
    type On<U>;
}

/// What `on` puts a proof on.
pub trait Pointer<'a> {
    type Of: 'a;
    type To<W: 'a>;
    /// # Safety
    /// `W` is a [`Proof`] of `Of` that holds for `'a`.
    unsafe fn cast<W: 'a>(self) -> Self::To<W>;
}

impl<'a, T> Pointer<'a> for &'a T {
    type Of = T;
    type To<W: 'a> = &'a W;
    #[inline(always)]
    unsafe fn cast<W: 'a>(self) -> &'a W {
        // SAFETY: the caller's.
        unsafe { &*core::ptr::from_ref(self).cast::<W>() }
    }
}

impl<'a, P: Pointer<'a>> Pointer<'a> for Option<P> {
    type Of = P::Of;
    type To<W: 'a> = Option<P::To<W>>;
    #[inline(always)]
    unsafe fn cast<W: 'a>(self) -> Self::To<W> {
        // SAFETY: the caller's.
        self.map(|p| unsafe { p.cast() })
    }
}

/// The handlers of this thread's event loop may run here, whether or not the thread has a VM.
#[fundamental]
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct Loop<'a, T = ()>(PhantomData<(&'a (), *mut ())>, T);

impl<T> Deref for Loop<'_, T> {
    type Target = T;
    #[inline(always)]
    fn deref(&self) -> &T {
        &self.1
    }
}

// SAFETY: see the struct.
unsafe impl<'a, T> Proof for Loop<'a, T> {
    type Of = T;
    type On<U> = Loop<'a, U>;
}

impl<'a> Loop<'a> {
    /// # Safety
    /// What is reached through the proof is allocated. While `scope` is borrowed, only a call after which no proof of
    /// the thread is used frees it. Inside a collection (a sweep, a finalizer, a visit) or after the global object is
    /// destroyed, nothing that is reached through the proof runs script or touches the JS heap.
    #[inline(always)]
    pub unsafe fn assume<S: ?Sized>(_scope: &'a S) -> Self {
        Self(PhantomData, ())
    }
}

impl<'a, T> Loop<'a, T> {
    #[inline(always)]
    pub fn as_loop(&self) -> Loop<'a> {
        Loop(PhantomData, ())
    }

    /// The same proof on something else.
    #[inline(always)]
    pub fn on<'b, P: Pointer<'b>>(&self, p: P) -> P::To<Loop<'b, P::Of>>
    where
        'a: 'b,
    {
        // SAFETY: `self` is the proof.
        unsafe { p.cast() }
    }
}
