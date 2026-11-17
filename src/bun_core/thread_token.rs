//! Zero-sized proofs about the calling thread. A function takes the weakest one it needs, last and by value.

use core::marker::PhantomData;

type NotSend = *mut ();

/// What this thread owns (its event loop, its VM if it has or had one) stays allocated for `'a`.
#[derive(Clone, Copy)]
pub struct ThreadLive<'a>(PhantomData<(&'a (), NotSend)>);

/// This thread has or had a VM. It can be stored, and opens nothing alone.
#[derive(Clone, Copy)]
pub struct HasVm(PhantomData<NotSend>);

/// This thread's VM stays allocated for `'a`.
#[derive(Clone, Copy)]
#[non_exhaustive]
pub struct VmLive<'a> {
    pub thread: ThreadLive<'a>,
    pub has_vm: HasVm,
}

/// The handlers of this thread's event loop may run here.
#[derive(Clone, Copy)]
pub struct LoopTurn<'a> {
    pub live: ThreadLive<'a>,
    may_dispatch: PhantomData<&'a mut ()>,
}

/// Script may run here.
#[derive(Clone, Copy)]
#[non_exhaustive]
pub struct JsTurn<'a> {
    pub loop_: LoopTurn<'a>,
    pub live: VmLive<'a>,
}

// Each of the others is a field of it.
const _: () = assert!(size_of::<JsTurn<'_>>() == 0 && align_of::<JsTurn<'_>>() == 1);

impl<'a> ThreadLive<'a> {
    /// # Safety
    /// The caller is on the thread that owns its arguments. What the thread has or had of its loop, its VM and its
    /// `RuntimeState` is allocated. While `scope` is borrowed, only a call after which no token of the thread is used
    /// frees it. This may be inside an allocation, a sweep or `~VM`, not after `~VM`.
    #[inline(always)]
    pub unsafe fn assume<T: ?Sized>(_scope: &'a T) -> Self {
        Self(PhantomData)
    }
}

impl HasVm {
    /// # Safety
    /// `VirtualMachine::init` has installed a VM and its `RuntimeState` on this thread.
    #[inline(always)]
    pub unsafe fn assume() -> Self {
        Self(PhantomData)
    }

    #[inline(always)]
    pub fn live(self, thread: ThreadLive<'_>) -> VmLive<'_> {
        VmLive {
            thread,
            has_vm: self,
        }
    }

    #[inline(always)]
    pub fn turn(self, loop_: LoopTurn<'_>) -> JsTurn<'_> {
        let live = self.live(loop_.live);
        JsTurn { loop_, live }
    }
}

impl<'a> VmLive<'a> {
    /// # Safety
    /// As [`ThreadLive::assume`] and [`HasVm::assume`].
    #[inline(always)]
    pub unsafe fn assume<T: ?Sized>(scope: &'a T) -> Self {
        // SAFETY: the caller's.
        unsafe { HasVm::assume().live(ThreadLive::assume(scope)) }
    }
}

impl<'a> LoopTurn<'a> {
    /// # Safety
    /// As [`ThreadLive::assume`]. No handler and no script that runs through the token runs inside a collection (a
    /// sweep, a finalizer, a visit) or after the global object is destroyed.
    #[inline(always)]
    pub unsafe fn assume<T: ?Sized>(scope: &'a T) -> Self {
        Self {
            // SAFETY: the caller's.
            live: unsafe { ThreadLive::assume(scope) },
            may_dispatch: PhantomData,
        }
    }
}

impl<'a> JsTurn<'a> {
    /// # Safety
    /// As [`LoopTurn::assume`] and [`HasVm::assume`].
    #[inline(always)]
    pub unsafe fn assume<T: ?Sized>(scope: &'a T) -> Self {
        // SAFETY: the caller's.
        unsafe { HasVm::assume().turn(LoopTurn::assume(scope)) }
    }
}
