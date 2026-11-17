//! Proofs about the calling thread that have no size. `&Loop<T>` is a `&T` with the proof, `Loop` is the proof alone.
//! `bun_jsc` has `Js` and `Vm`.

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

/// `$alone` returns the proof alone.
///
/// # Safety
/// `$Weaker` is `T`, or a proof of `T` that this one implies.
#[macro_export]
macro_rules! proof {
    ($(#[$doc:meta])* $Proof:ident, $alone:ident => unsafe $Weaker:ty; $(#[$contract:meta])*) => {
        $(#[$doc])*
        #[fundamental]
        #[repr(transparent)]
        pub struct $Proof<'a, T = ()>(::core::marker::PhantomData<(&'a (), *mut ())>, $Weaker);

        impl Clone for $Proof<'_> {
            #[inline(always)]
            fn clone(&self) -> Self {
                *self
            }
        }
        impl Copy for $Proof<'_> {}

        impl<'a, T> ::core::ops::Deref for $Proof<'a, T> {
            type Target = $Weaker;
            #[inline(always)]
            fn deref(&self) -> &$Weaker {
                &self.1
            }
        }

        // SAFETY: see the struct.
        unsafe impl<'a, T> $crate::proof::Proof for $Proof<'a, T> {
            type Of = T;
            type On<U> = $Proof<'a, U>;
        }

        impl<'a> $Proof<'a> {
            /// # Safety
            $(#[$contract])*
            #[inline(always)]
            pub unsafe fn assume<S: ?Sized>(_scope: &'a S) -> Self {
                // SAFETY: the caller's.
                unsafe { *$crate::proof::Pointer::cast::<Self>(&()) }
            }
        }

        impl<'a, T> $Proof<'a, T> {
            #[inline(always)]
            pub fn $alone(&self) -> $Proof<'a> {
                *self.on(&())
            }

            /// The same proof on something else.
            #[inline(always)]
            pub fn on<'b, P: $crate::proof::Pointer<'b>>(&self, p: P) -> P::To<$Proof<'b, P::Of>>
            where
                'a: 'b,
            {
                // SAFETY: `self` is the proof.
                unsafe { p.cast() }
            }
        }
    };
}

proof! {
    /// The handlers of this thread's event loop may run here, whether or not the thread has a VM.
    Loop, as_loop => unsafe T;
    /// What is reached through the proof is allocated. While `scope` is borrowed, only a call after which no proof of
    /// the thread is used frees it. Inside a collection (a sweep, a finalizer, a visit) or after the global object is
    /// destroyed, nothing that is reached through the proof runs script or touches the JS heap.
}
