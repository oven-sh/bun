//! Requests that interrupt running code. Any thread can make them.

use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use core::task::Waker;
use std::sync::OnceLock;

use bun_engine_macros::FieldOffsets;
use bun_threading::Guarded;

use crate::{Cx, JsResult, Vm};

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct Trap: u32 {
        const TERMINATION = 1 << 0;
    }
}

/// Exists only as the field of a `Vm`.
#[derive(FieldOffsets)]
#[repr(C)]
pub struct Traps {
    pending: AtomicU32,
    /// From when `TERMINATION` is handled until the outermost script has been left.
    is_termination_requested: AtomicBool,
    are_deferred: AtomicBool,
    /// What generated code compares the stack pointer with, or as signed numbers what is left of it once a frame has
    /// been subtracted. `ABOVE_ALL` while a request is pending.
    stack_limit: AtomicUsize,
    real_stack_limit: AtomicUsize,
}

#[derive(Default)]
pub(crate) struct SharedState {
    blocked_thread: BlockedThread,
    observer: OnceLock<Box<TrapObserver>>,
}

/// How to reach the thread of a `Vm` while it waits.
#[derive(Default)]
struct BlockedThread(Guarded<Option<Waker>>);

/// For code that does not look at `Traps`. It is called on any thread, after a change of what is pending.
pub type TrapObserver = dyn Fn(&Traps) + Send + Sync;

impl Traps {
    pub(crate) const OFFSET_OF_STACK_LIMIT: usize = core::mem::offset_of!(Traps, stack_limit);
    pub(crate) const OFFSET_OF_REAL_STACK_LIMIT: usize =
        core::mem::offset_of!(Traps, real_stack_limit);
    pub(crate) const OFFSET_OF_PENDING: usize = core::mem::offset_of!(Traps, pending);

    const ABOVE_ALL: usize = isize::MAX as usize;

    pub(crate) const fn new() -> Traps {
        Traps {
            pending: AtomicU32::new(0),
            is_termination_requested: AtomicBool::new(false),
            are_deferred: AtomicBool::new(false),
            stack_limit: AtomicUsize::new(0),
            real_stack_limit: AtomicUsize::new(0),
        }
    }

    pub fn fire(&self, trap: Trap) {
        self.pending.fetch_or(trap.bits(), Ordering::SeqCst);
        self.stack_limit.store(Self::ABOVE_ALL, Ordering::SeqCst);
        self.tell_observer();
        if trap.contains(Trap::TERMINATION)
            && let Some(waker) = &*self.shared_state().blocked_thread.0.lock()
        {
            waker.wake_by_ref();
        }
    }

    pub fn request_termination(&self) {
        self.fire(Trap::TERMINATION);
    }

    fn shared_state(&self) -> &SharedState {
        let address = core::ptr::from_ref(self).addr() - Vm::offset_of_field("traps");
        let vm = core::ptr::with_exposed_provenance::<Vm>(address);
        // SAFETY: a field of the same `Vm`, whose provenance is exposed, and one that any thread may use.
        unsafe { &(*vm).services.errors.traps }
    }

    /// Panics the second time. It is called at once.
    pub fn observe(&self, observer: Box<TrapObserver>) {
        assert!(self.shared_state().observer.set(observer).is_ok());
        self.tell_observer();
    }

    fn tell_observer(&self) {
        if let Some(observer) = self.shared_state().observer.get() {
            observer(self);
        }
    }

    #[inline(always)]
    pub fn stack_limit(&self) -> usize {
        self.stack_limit.load(Ordering::Relaxed)
    }

    #[inline(always)]
    pub fn need_handling(&self) -> bool {
        self.pending.load(Ordering::Relaxed) != 0
    }

    #[inline(always)]
    pub fn is_pending(&self, trap: Trap) -> bool {
        self.pending.load(Ordering::Relaxed) & trap.bits() != 0
    }

    /// Whether it was pending.
    pub fn clear(&self, trap: Trap) -> bool {
        let old = self.pending.fetch_and(!trap.bits(), Ordering::SeqCst);
        self.update_stack_limit();
        self.tell_observer();
        old & trap.bits() != 0
    }

    #[inline(always)]
    pub(crate) fn has_termination_request(&self) -> bool {
        self.is_termination_requested.load(Ordering::Relaxed)
    }

    #[inline(always)]
    pub(crate) fn set_has_termination_request(&self, value: bool) {
        (self.is_termination_requested).store(value, Ordering::Relaxed);
    }

    #[inline(always)]
    pub(crate) fn are_deferred(&self) -> bool {
        self.are_deferred.load(Ordering::Relaxed)
    }

    #[inline(always)]
    pub(crate) fn real_stack_limit(&self) -> usize {
        self.real_stack_limit.load(Ordering::Relaxed)
    }

    pub(crate) fn set_real_stack_limit(&self, limit: usize) {
        self.real_stack_limit.store(limit, Ordering::Relaxed);
        self.update_stack_limit();
    }

    fn update_stack_limit(&self) {
        self.stack_limit
            .store(self.real_stack_limit(), Ordering::SeqCst);
        if self.pending.load(Ordering::SeqCst) != 0 {
            self.stack_limit.store(Self::ABOVE_ALL, Ordering::SeqCst);
        }
    }
}

/// Requests stay pending while it is alive.
pub struct DeferTraps {
    vm: NonNull<Vm>,
    were_deferred: bool,
}

impl Drop for DeferTraps {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: made and dropped inside a call that has the `Vm`.
        let traps = unsafe { self.vm.as_ref() }.traps();
        (traps.are_deferred).store(self.were_deferred, Ordering::Relaxed);
    }
}

pub struct WakeOnTermination<'a>(&'a BlockedThread);

impl Drop for WakeOnTermination<'_> {
    fn drop(&mut self) {
        *self.0.0.lock() = None;
    }
}

impl Vm {
    #[inline]
    pub fn defer_traps(&self) -> DeferTraps {
        let were_deferred = self.traps().are_deferred();
        self.traps().are_deferred.store(true, Ordering::Relaxed);
        DeferTraps {
            vm: NonNull::from(self),
            were_deferred,
        }
    }

    /// For native code that has no `Cx` at hand.
    #[cold]
    pub fn handle_traps_without_realm(&self) {
        if self.is_termination_requested() {
            self.answer_termination_request();
        }
    }

    /// For code that is about to wait. It asks `is_termination_requested` after this, and each time it wakes up.
    pub fn wake_on_termination(&self, waker: Waker) -> WakeOnTermination<'_> {
        let blocked_thread = &self.services.errors.traps.blocked_thread;
        *blocked_thread.0.lock() = Some(waker);
        WakeOnTermination(blocked_thread)
    }
}

impl Cx {
    /// What is deferred stays pending, so a prologue goes on to compare with the real stack limit.
    #[cold]
    #[inline(never)]
    pub fn handle_traps(&mut self) -> JsResult<()> {
        self.handle_traps_without_realm();
        self.check_exception()
    }
}
