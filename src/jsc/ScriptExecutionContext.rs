//! `ScriptExecutionContext`: what owns the native work script starts.
//!
//! A native resource that outlives the call that opened it (a server, a socket
//! listener, an in-flight `fetch`, a watcher) embeds an [`AbortHandle`] armed
//! in the context that was current when script opened it, and is stopped when
//! that context stops: VM teardown or the `bun test --isolate` file swap.
//! `WebCore::ScriptExecutionContext` does the same for `ActiveDOMObject`s.

use core::ptr;

use crate::virtual_machine::SweepResult;
use crate::{AbortSignal, AbortSignalRef, JSValue, JsCell};

/// Identifies a context within its VM. What outlived its context (a pool job,
/// a timer that was not swept) holds an id no live context has.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Default, Debug)]
pub struct ContextId(u32);

/// Why a context is stopping what it owns.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum StopReason {
    /// The VM is being torn down; nothing enters script again.
    VmTeardown,
    /// `bun test --isolate` retired this file's realm; the VM keeps running.
    TestIsolation,
}

/// Why an [`AbortHandle`]'s owner is being told to stop.
#[derive(Copy, Clone)]
pub enum AbortCause {
    /// Its `AbortSignal` fired; the value is `signal.reason`.
    Signal(JSValue),
    /// The context it belongs to is stopping. Script is forbidden for
    /// [`StopReason::VmTeardown`]; for [`StopReason::TestIsolation`] a close
    /// handler the owner dispatches still runs.
    ContextStopped(StopReason),
}

/// `handle` is already unlinked from its context when the cause is
/// [`AbortCause::ContextStopped`].
type AbortFn = unsafe fn(handle: *mut AbortHandle, cause: AbortCause);

/// Zero-valid.
pub struct ScriptExecutionContext {
    id: JsCell<ContextId>,
    /// Armed handles, oldest first.
    head: JsCell<*mut AbortHandle>,
    tail: JsCell<*mut AbortHandle>,
}

impl Default for ScriptExecutionContext {
    fn default() -> Self {
        Self {
            id: JsCell::new(ContextId(0)),
            head: JsCell::new(ptr::null_mut()),
            tail: JsCell::new(ptr::null_mut()),
        }
    }
}

impl ScriptExecutionContext {
    #[inline]
    pub fn id(&self) -> ContextId {
        *self.id.get()
    }

    /// The root context starts over under a new identity (`bun test --isolate`:
    /// the next file). What the previous identity owned was stopped first.
    pub(crate) fn renew(&self, id: ContextId) {
        debug_assert!(self.tail.get().is_null());
        self.id.set(id);
    }

    /// # Safety
    /// `node` is a live, unlinked handle.
    unsafe fn push(&self, node: *mut AbortHandle) {
        let tail = *self.tail.get();
        // SAFETY: fn contract.
        let handle = unsafe { &*node };
        handle.prev.set(tail);
        handle.next.set(ptr::null_mut());
        handle.context.set(ptr::from_ref(self));
        if tail.is_null() {
            self.head.set(node);
        } else {
            // SAFETY: linked ⇒ live (handles unlink, on this thread, before they are freed).
            unsafe { (*tail).next.set(node) };
        }
        self.tail.set(node);
    }

    fn unlink(&self, handle: &AbortHandle) {
        let (prev, next) = (*handle.prev.get(), *handle.next.get());
        // SAFETY: neighbours of a linked node are linked, hence live.
        unsafe {
            if prev.is_null() {
                self.head.set(next);
            } else {
                (*prev).next.set(next);
            }
            if next.is_null() {
                self.tail.set(prev);
            } else {
                (*next).prev.set(prev);
            }
        }
        handle.prev.set(ptr::null_mut());
        handle.next.set(ptr::null_mut());
        handle.context.set(ptr::null());
    }

    /// One stop-phase sweep (JS thread): until none is armed, the newest
    /// handle is unlinked and its owner told to stop, including what a close
    /// handler it runs opens meanwhile.
    pub fn stop_handles(&self, reason: StopReason) -> SweepResult {
        let mut result = SweepResult::Idle;
        loop {
            let newest = *self.tail.get();
            if newest.is_null() {
                return result;
            }
            result = SweepResult::Stopped;
            // SAFETY: linked ⇒ live. The callback may free the owner; nothing
            // of the handle is touched after it.
            unsafe {
                self.unlink(&*newest);
                ((*newest).on_abort)(newest, AbortCause::ContextStopped(reason));
            }
        }
    }
}

/// The handle an owner of cancellable native work embeds: membership in the
/// [`ScriptExecutionContext`] that started the work, and optionally the
/// `AbortSignal` script passed for it. The owner's one callback runs when
/// either fires.
///
/// Address-stable while armed: embed it in a heap-allocated owner.
pub struct AbortHandle {
    prev: JsCell<*mut AbortHandle>,
    next: JsCell<*mut AbortHandle>,
    /// The context this is linked into; null while disarmed.
    context: JsCell<*const ScriptExecutionContext>,
    on_abort: AbortFn,
    signal: JsCell<Option<AbortSignalRef>>,
}

impl AbortHandle {
    /// The handle `O` embeds (at the field [`AbortHandleOwner::abort_handle`] names).
    pub const fn for_owner<O: AbortHandleOwner>() -> Self {
        Self {
            prev: JsCell::new(ptr::null_mut()),
            next: JsCell::new(ptr::null_mut()),
            context: JsCell::new(ptr::null()),
            on_abort: Self::owner_aborted::<O>,
            signal: JsCell::new(None),
        }
    }

    #[inline]
    fn is_armed(&self) -> bool {
        !self.context.get().is_null()
    }

    #[inline]
    fn context(&self) -> Option<&ScriptExecutionContext> {
        // SAFETY: a context outlives the handles linked into it (it unlinks
        // them all when it stops).
        unsafe { self.context.get().as_ref() }
    }

    #[inline]
    pub fn signal(&self) -> Option<&AbortSignal> {
        self.signal.get().as_deref()
    }

    /// # Safety
    /// `this` is live, carries its owner's provenance, and does not move or
    /// drop while armed other than through `disarm` / `Drop`.
    unsafe fn arm(this: *mut Self, context: &ScriptExecutionContext) {
        // SAFETY: fn contract.
        unsafe {
            if !(*this).is_armed() {
                context.push(this);
            }
        }
    }

    /// # Safety
    /// As [`arm`](Self::arm).
    unsafe fn follow(this: *mut Self, signal: AbortSignalRef) {
        // SAFETY: fn contract.
        let handle = unsafe { &*this };
        debug_assert!(handle.signal.get().is_none());
        let raw = signal.get();
        handle.signal.set(Some(signal));
        // `AbortSignal` is an `opaque_ffi!` handle; the ref just stored keeps it live.
        let signal = AbortSignal::opaque_ref(raw);
        signal.pending_activity_ref();
        signal.add_listener(this.cast(), Self::signal_fired);
    }

    extern "C" fn signal_fired(this: *mut core::ffi::c_void, reason: JSValue) {
        let this = this.cast::<AbortHandle>();
        // SAFETY: registered in `follow` with the handle's address; the
        // listener is removed (`unfollow`) before the handle moves or drops.
        unsafe { ((*this).on_abort)(this, AbortCause::Signal(reason)) }
    }

    /// Stop following the signal and release it.
    pub fn unfollow(&self) {
        let Some(signal) = self.signal.take() else {
            return;
        };
        signal.clean_native_bindings(ptr::from_ref(self).cast_mut().cast());
        signal.pending_activity_unref();
    }

    /// Leave the context without being told to stop (the owner finished or
    /// closed on its own). Safe to call when not armed, and off the JS thread
    /// then (an owner released elsewhere has already disarmed).
    pub fn leave(&self) {
        if let Some(context) = self.context() {
            context.unlink(self);
        }
    }

    /// [`leave`](Self::leave) and [`unfollow`](Self::unfollow).
    pub fn disarm(&self) {
        self.leave();
        self.unfollow();
    }
}

impl Drop for AbortHandle {
    fn drop(&mut self) {
        self.disarm();
    }
}

/// Implemented by the owner that embeds an [`AbortHandle`]; gives it
/// [`arm_owner`](AbortHandle::arm_owner) / [`follow_owner`](AbortHandle::follow_owner)
/// with the container-of recovery written once. Use [`impl_abort_handle_owner!`].
pub trait AbortHandleOwner: Sized {
    /// # Safety
    /// `this` is live.
    unsafe fn abort_handle(this: *mut Self) -> *mut AbortHandle;

    /// # Safety
    /// `handle` came from [`abort_handle`](Self::abort_handle) of a live `Self`.
    unsafe fn from_abort_handle(handle: *mut AbortHandle) -> *mut Self;

    /// JS thread. `this` may free itself.
    ///
    /// # Safety
    /// `this` is live.
    unsafe fn on_abort(this: *mut Self, cause: AbortCause);
}

impl AbortHandle {
    unsafe fn owner_aborted<O: AbortHandleOwner>(handle: *mut AbortHandle, cause: AbortCause) {
        // SAFETY: armed/followed through `*_owner::<O>`, so `handle` is `O`'s field.
        unsafe { O::on_abort(O::from_abort_handle(handle), cause) }
    }

    /// Join `context` (JS thread): from here until the handle is disarmed,
    /// `O::on_abort(owner, ..)` runs if `context` stops. A no-op if already armed.
    ///
    /// # Safety
    /// `owner` is live and heap-pinned until its handle is disarmed or dropped.
    pub unsafe fn arm_owner<O: AbortHandleOwner>(owner: *mut O, context: &ScriptExecutionContext) {
        // SAFETY: fn contract.
        unsafe { Self::arm(O::abort_handle(owner), context) }
    }

    /// `O::on_abort(owner, ..)` also runs when `signal` fires; before this
    /// returns if it already has.
    ///
    /// # Safety
    /// As [`arm_owner`](Self::arm_owner).
    pub unsafe fn follow_owner<O: AbortHandleOwner>(owner: *mut O, signal: AbortSignalRef) {
        // SAFETY: fn contract.
        unsafe { Self::follow(O::abort_handle(owner), signal) }
    }
}

/// `impl_abort_handle_owner!(Owner, field, |this, cause| body)`: `Owner` embeds
/// an [`AbortHandle`] at `field`; `body` is [`AbortHandleOwner::on_abort`].
/// Generic owners: `impl_abort_handle_owner!([const N: bool] Owner<N>, field, ..)`.
#[macro_export]
macro_rules! impl_abort_handle_owner {
    ([$($generics:tt)*] $Owner:ty, $field:ident, |$this:ident, $cause:ident| $body:expr) => {
        impl<$($generics)*> $crate::script_execution_context::AbortHandleOwner for $Owner {
            #[inline]
            unsafe fn abort_handle(
                this: *mut Self,
            ) -> *mut $crate::script_execution_context::AbortHandle {
                // SAFETY: caller contract — `this` is live.
                unsafe { ::core::ptr::addr_of_mut!((*this).$field) }
            }
            #[inline]
            unsafe fn from_abort_handle(
                handle: *mut $crate::script_execution_context::AbortHandle,
            ) -> *mut Self {
                // SAFETY: caller contract — `handle` addresses `Self.$field`.
                unsafe { ::bun_core::from_field_ptr!(Self, $field, handle) }
            }
            unsafe fn on_abort(
                $this: *mut Self,
                $cause: $crate::script_execution_context::AbortCause,
            ) {
                $body
            }
        }
    };
    ($Owner:ty, $field:ident, |$this:ident, $cause:ident| $body:expr) => {
        $crate::impl_abort_handle_owner!([] $Owner, $field, |$this, $cause| $body);
    };
}

/// Hands out [`ContextId`]s for one VM.
#[derive(Default)]
pub(crate) struct ContextIdAllocator {
    last: u32,
}

impl ContextIdAllocator {
    pub(crate) fn next(&mut self) -> ContextId {
        self.last = self.last.wrapping_add(1);
        ContextId(self.last)
    }
}
