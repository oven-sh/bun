//! `ScriptExecutionContext`: what owns the native work script starts.
//!
//! A native resource that outlives the call that opened it (a server, a socket
//! listener, an in-flight `fetch`, a watcher) embeds an [`AbortHandle`] armed
//! in the context that was current when script opened it, and is stopped when
//! that context stops: VM teardown, the `bun test --isolate` file swap, or the
//! disposal or collection of the `Bun.ModuleGraph` the context was made for.
//! An owner can keep its graph from being collected while it works
//! ([`AbortHandleOwner::keeps_graph_alive`]).
//! `WebCore::ScriptExecutionContext` does the same for `ActiveDOMObject`s, and
//! owns the Rust context of a graph.

use core::ptr;

use crate::virtual_machine::SweepResult;
use crate::{AbortSignal, AbortSignalRef, JSValue, JsCell};

pub use bun_event_loop::ContextId;

/// Why a context is stopping what it owns.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum StopReason {
    /// The VM is being torn down; nothing enters script again.
    VmTeardown,
    /// The VM keeps running: the `Bun.ModuleGraph` the context was made for was disposed or
    /// collected, or `bun test --isolate` retired the realm.
    Disposed,
}

/// Why an [`AbortHandle`]'s owner is being told to stop.
#[derive(Copy, Clone)]
pub enum AbortCause {
    /// Its `AbortSignal` fired; the value is `signal.reason`.
    Signal(JSValue),
    /// The context it belongs to is stopping, or had stopped when the handle
    /// was armed. Nothing is reported to its script: script is forbidden for
    /// [`StopReason::VmTeardown`], and a `Bun.ModuleGraph` that was disposed hears nothing more.
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
    /// [`STOPPED`](Self::STOPPED) and [`OF_GRAPH`](Self::OF_GRAPH). One byte, zero for the
    /// realm's own context while it runs: arming reads it once, and only then has nothing more to do.
    state: JsCell<u8>,
    /// The client sockets script of a graph's context opened (`Bun.connect`,
    /// WebSocket, SQL, Valkey). A VM's own contexts use `RareData`'s.
    socket_groups: JsCell<Option<Box<crate::rare_data::SocketGroups>>>,
    stop_again_queued: JsCell<bool>,
    /// A graph's context: its `WebCore::ScriptExecutionContext`, which owns this
    /// one and the ActiveDOMObjects (workers, WebSockets) the graph's script made.
    dom_context: core::cell::Cell<*mut core::ffi::c_void>,
    /// The timers script of a graph's context set that have not been freed
    /// (`TimerObjectInternals` / `AbortSignal` `Timeout`), so stopping it
    /// cancels exactly those. A VM's own contexts walk the timer heap.
    timers: JsCell<bun_collections::ArrayHashMap<*mut core::ffi::c_void, ContextTimer>>,
}

/// What a pointer in a graph context's timer set points at.
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ContextTimer {
    /// `bun_runtime::timer::TimerObjectInternals` (setTimeout / setInterval / setImmediate).
    Object,
    /// [`crate::abort_signal::Timeout`] (`AbortSignal.timeout`).
    AbortSignal,
}

impl Default for ScriptExecutionContext {
    fn default() -> Self {
        Self {
            id: JsCell::new(ContextId::default()),
            head: JsCell::new(ptr::null_mut()),
            tail: JsCell::new(ptr::null_mut()),
            state: JsCell::new(0),
            socket_groups: JsCell::new(None),
            stop_again_queued: JsCell::new(false),
            dom_context: core::cell::Cell::new(ptr::null_mut()),
            timers: JsCell::new(Default::default()),
        }
    }
}

impl ScriptExecutionContext {
    /// A graph's context after [`stop`](Self::stop): what is armed from then
    /// on (script of the disposed graph still running) is stopped at once.
    const STOPPED: u8 = 1 << 0;
    /// A `Bun.ModuleGraph`'s context.
    const OF_GRAPH: u8 = 1 << 1;

    #[inline]
    pub fn id(&self) -> ContextId {
        *self.id.get()
    }

    /// `VirtualMachine::root_context`: the Rust half of the context of every global the VM makes.
    /// Its identifier is the first global's ([`bind`](Self::bind)), which does not change: the
    /// globals `bun test --isolate` makes inherit it.
    pub(crate) fn root() -> Self {
        Self::default()
    }

    /// Once, when the VM's first global has been made.
    pub(crate) fn bind(&self, id: ContextId) {
        self.id.set(id);
    }

    /// `VirtualMachine::dead_context`: stopped from the start.
    pub(crate) fn dead() -> Self {
        let context = Self::default();
        context.id.set(ContextId::DEAD);
        context.state.set(Self::STOPPED);
        context
    }

    pub(crate) fn for_graph(id: ContextId, dom_context: *mut core::ffi::c_void) -> Self {
        let context = Self::default();
        context.id.set(id);
        context.dom_context.set(dom_context);
        context.state.set(Self::OF_GRAPH);
        context
    }

    /// The realm or the VM is going: what `dispose()` would have stopped through the
    /// graph's `WebCore::ScriptExecutionContext` is stopped from here.
    pub(crate) fn stop_dom_objects(&self) {
        unsafe extern "C" {
            fn WebCore__ScriptExecutionContext__stopActiveDOMObjects(
                context: *mut core::ffi::c_void,
            );
        }
        let dom_context = self.dom_context.get();
        if !dom_context.is_null() {
            // SAFETY: non-null until its destructor releases this one (`dom_context_released`).
            unsafe { WebCore__ScriptExecutionContext__stopActiveDOMObjects(dom_context) }
        }
    }

    pub(crate) fn dom_context(&self) -> *mut core::ffi::c_void {
        self.dom_context.get()
    }

    /// The `WebCore::ScriptExecutionContext` is being destroyed. This one outlives it
    /// until what it still owns is closed.
    pub(crate) fn dom_context_released(&self) {
        self.dom_context.set(ptr::null_mut());
    }

    #[inline]
    pub fn is_stopped(&self) -> bool {
        *self.state.get() & Self::STOPPED != 0
    }

    /// `value` refers to this (graph's) context's graph from here on: the graph is alive for as
    /// long as `value` is.
    fn keep_graph_alive_from(&self, value: JSValue) {
        debug_assert!(*self.state.get() & Self::OF_GRAPH != 0);
        // SAFETY: a graph's `WebCore::ScriptExecutionContext`, or null once that is gone; JS thread.
        unsafe { Bun__ModuleGraph__keepAliveFrom(self.dom_context.get(), value) }
    }

    /// `value` refers to no graph any more.
    fn let_go_of_graph(value: JSValue) {
        // SAFETY: a null context clears the reference; JS thread.
        unsafe { Bun__ModuleGraph__keepAliveFrom(ptr::null_mut(), value) }
    }

    /// A graph's context stops for good (JS thread): one stop-phase sweep over
    /// its handles and its client sockets.
    pub(crate) fn stop(&self, reason: StopReason) -> SweepResult {
        self.state.set(*self.state.get() | Self::STOPPED);
        self.stop_again_queued.set(false);
        let result = self.stop_handles(reason);
        self.close_sockets();
        result
    }

    /// Close every client socket of a graph's context (its script is told nothing).
    fn close_sockets(&self) {
        if let Some(groups) = self
            .socket_groups
            .with_mut(|groups| groups.as_deref_mut().map(ptr::from_mut))
        {
            // SAFETY: the box is dropped only with `self`; closing dispatches
            // close handlers, so no borrow of the cell is held across it.
            unsafe { crate::rare_data::SocketGroups::close_all(groups) };
        }
    }

    /// Whether another [`stop`](Self::stop) was already going to run; it is now.
    pub(crate) fn stop_again_is_queued(&self) -> bool {
        self.stop_again_queued.replace(true)
    }

    /// A timer script of this (graph's) context set exists from here.
    pub fn track_timer(&self, timer: *mut core::ffi::c_void, kind: ContextTimer) {
        self.timers
            .with_mut(|timers| bun_core::handle_oom(timers.put(timer, kind)));
        if self.is_stopped() {
            crate::VirtualMachineRef::get()
                .as_mut()
                .stop_graph_context_again(self.id());
        }
    }

    /// It is being freed.
    pub fn untrack_timer(&self, timer: *mut core::ffi::c_void) {
        self.timers.with_mut(|timers| {
            timers.swap_remove(&timer);
        });
    }

    /// The context stopped: its live timers, for the caller to cancel.
    pub fn take_timers(
        &self,
    ) -> bun_collections::ArrayHashMap<*mut core::ffi::c_void, ContextTimer> {
        self.timers.take()
    }

    /// Nothing is armed and no client socket is open: freeing it strands nothing.
    pub(crate) fn owns_nothing(&self) -> bool {
        self.tail.get().is_null()
            && self
                .socket_groups
                .with_mut(|groups| groups.as_deref_mut().is_none_or(|groups| groups.is_empty()))
    }

    /// The groups client sockets opened by a graph context's script join.
    pub(crate) fn socket_groups(&self) -> *mut crate::rare_data::SocketGroups {
        self.socket_groups
            .with_mut(|groups| ptr::from_mut(&mut **groups.get_or_insert_with(Default::default)))
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
                (*newest).context_stopped.set(true);
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
    /// Its context stopped it, or had already stopped when it was armed.
    context_stopped: core::cell::Cell<bool>,
    /// What [`AbortHandleOwner::keeps_graph_alive`] names refers to the graph of the context
    /// this joined, until [`owner_left`](Self::owner_left).
    keeps_graph_alive: core::cell::Cell<bool>,
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
            context_stopped: core::cell::Cell::new(false),
            keeps_graph_alive: core::cell::Cell::new(false),
        }
    }

    #[inline]
    fn is_armed(&self) -> bool {
        !self.context.get().is_null()
    }

    /// The owner's context stopped it (or had already stopped when it was armed): what is left of
    /// the work is released, and none of it is reported. A `Bun.ModuleGraph` that was disposed
    /// hears nothing more from the event loop, as a terminated worker does not.
    #[inline]
    pub fn context_stopped(&self) -> bool {
        self.context_stopped.get()
    }

    /// The context the owner is in while armed: what its events are dispatched inside.
    #[inline]
    pub fn context_id(&self) -> Option<ContextId> {
        self.context().map(ScriptExecutionContext::id)
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

    /// Returns whether `context` is a `Bun.ModuleGraph`'s that has not stopped: the one case
    /// in which [`arm_owner`](Self::arm_owner) has an edge to the graph to write.
    ///
    /// # Safety
    /// `this` is live, carries its owner's provenance, and does not move or
    /// drop while armed other than through `disarm` / `Drop`.
    unsafe fn arm(this: *mut Self, context: &ScriptExecutionContext) -> bool {
        // SAFETY: fn contract.
        unsafe {
            if (*this).is_armed() {
                return false;
            }
            context.push(this);
            // (An owner that another context takes over is that context's from here.)
            (*this).context_stopped.set(false);
            *context.state.get() != 0 && Self::armed_in_graph_or_stopped(this, context)
        }
    }

    /// [`arm`](Self::arm) for a context that is not the realm's own while it runs.
    ///
    /// # Safety
    /// As [`arm`](Self::arm); `this` was just linked into `context`.
    #[cold]
    unsafe fn armed_in_graph_or_stopped(this: *mut Self, context: &ScriptExecutionContext) -> bool {
        if !context.is_stopped() {
            return true;
        }
        // SAFETY: fn contract.
        unsafe { (*this).context_stopped.set(true) };
        // Script of a disposed graph is still opening things: they go on
        // the next turn of the loop, not under the caller that is arming.
        crate::VirtualMachineRef::get()
            .as_mut()
            .stop_graph_context_again(context.id());
        false
    }

    /// # Safety
    /// As [`arm`](Self::arm).
    unsafe fn follow(this: *mut Self, signal: AbortSignalRef) {
        // SAFETY: fn contract.
        let handle = unsafe { &*this };
        handle.unfollow();
        let raw = signal.get();
        handle.signal.set(Some(signal));
        // `AbortSignal` is an `opaque_ffi!` handle; the ref just stored keeps it live.
        let signal = AbortSignal::opaque_ref(raw);
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
    /// What keeps the owner alive while [`on_abort`](Self::on_abort) runs.
    type KeepAlive;

    /// # Safety
    /// `this` is live.
    unsafe fn abort_handle(this: *mut Self) -> *mut AbortHandle;

    /// SAFETY: `this` is live. Taken before anything else runs.
    unsafe fn keep_alive(this: *mut Self) -> Self::KeepAlive;

    /// # Safety
    /// `handle` came from [`abort_handle`](Self::abort_handle) of a live `Self`.
    unsafe fn from_abort_handle(handle: *mut AbortHandle) -> *mut Self;

    /// The JS value through which the owner keeps its `Bun.ModuleGraph` alive while it works:
    /// its wrapper, which native code roots for as long as the owner is open.
    /// [`arm_owner`](AbortHandle::arm_owner) makes that value refer to the graph whose context
    /// the owner joins, and it lets go when the owner leaves
    /// ([`owner_left`](AbortHandle::owner_left)), which is also how its context stops it. A
    /// graph its host no longer references is then not collected, and its context not stopped,
    /// under work that still runs, whether or not script gave that work a callback.
    ///
    /// `None`: the owner does not keep its graph. Script always gives it a callback, whose saved
    /// async context refers to the graph already; or it roots no JS value of its own; or it
    /// roots one for longer than it works, which would keep a graph that nothing else needs.
    ///
    /// # Safety
    /// `this` is live.
    unsafe fn keeps_graph_alive(this: *mut Self) -> Option<JSValue>;

    /// JS thread. `this` may free itself.
    ///
    /// # Safety
    /// `this` is live.
    unsafe fn on_abort(this: *mut Self, cause: AbortCause);
}

impl AbortHandle {
    unsafe fn owner_aborted<O: AbortHandleOwner>(handle: *mut AbortHandle, cause: AbortCause) {
        // SAFETY: armed/followed through `*_owner::<O>`, so `handle` is `O`'s field.
        unsafe {
            let owner = O::from_abort_handle(handle);
            let _keep_alive = O::keep_alive(owner);
            O::on_abort(owner, cause)
        }
    }

    /// Join `context` (JS thread): from here until the handle is disarmed,
    /// `O::on_abort(owner, ..)` runs if `context` stops. A no-op if already armed.
    ///
    /// In a `Bun.ModuleGraph`'s context, what [`AbortHandleOwner::keeps_graph_alive`] names keeps
    /// that graph from here on: arm once the owner has made that value, and leave with
    /// [`owner_left`](Self::owner_left).
    ///
    /// # Safety
    /// `owner` is live and heap-pinned until its handle is disarmed or dropped.
    pub unsafe fn arm_owner<O: AbortHandleOwner>(owner: *mut O, context: &ScriptExecutionContext) {
        // SAFETY: fn contract.
        unsafe {
            let handle = O::abort_handle(owner);
            if Self::arm(handle, context) {
                if let Some(value) = O::keeps_graph_alive(owner) {
                    context.keep_graph_alive_from(value);
                    (*handle).keeps_graph_alive.set(true);
                }
            }
        }
    }

    /// [`leave`](Self::leave), for an owner whose work for its context is over, its context
    /// having stopped it or not (JS thread): what [`AbortHandleOwner::keeps_graph_alive`] names
    /// lets go of the graph, so an owner that script still holds does not keep a graph it no
    /// longer works for.
    ///
    /// # Safety
    /// `owner` is live.
    pub unsafe fn owner_left<O: AbortHandleOwner>(owner: *mut O) {
        // SAFETY: fn contract.
        unsafe {
            let handle = &*O::abort_handle(owner);
            handle.leave();
            if handle.keeps_graph_alive.replace(false) {
                // (`None`: the value was collected, or is being finalized.)
                if let Some(value) = O::keeps_graph_alive(owner) {
                    ScriptExecutionContext::let_go_of_graph(value);
                }
            }
        }
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

/// `impl_abort_handle_owner!(Owner, field, keeps_graph_alive = |this| value, |this, cause| body)`:
/// `Owner` embeds an [`AbortHandle`] at `field`; `value` is
/// [`AbortHandleOwner::keeps_graph_alive`] and `body` is [`AbortHandleOwner::on_abort`].
/// Generic owners: `impl_abort_handle_owner!([const N: bool] Owner<N>, field, ..)`.
#[macro_export]
macro_rules! impl_abort_handle_owner {
    ([$($generics:tt)*] $Owner:ty, $field:ident, keep_alive = |$pinned:ident| -> $KeepAlive:ty $pin:block, keeps_graph_alive = |$owner:ident| $keeps:expr, |$this:ident, $cause:ident| $body:expr) => {
        impl<$($generics)*> $crate::script_execution_context::AbortHandleOwner for $Owner {
            type KeepAlive = $KeepAlive;
            #[inline]
            unsafe fn abort_handle(
                this: *mut Self,
            ) -> *mut $crate::script_execution_context::AbortHandle {
                // SAFETY: caller contract — `this` is live.
                unsafe { ::core::ptr::addr_of_mut!((*this).$field) }
            }
            #[inline]
            unsafe fn keep_alive($pinned: *mut Self) -> $KeepAlive $pin
            #[inline]
            unsafe fn from_abort_handle(
                handle: *mut $crate::script_execution_context::AbortHandle,
            ) -> *mut Self {
                // SAFETY: caller contract — `handle` addresses `Self.$field`.
                unsafe { ::bun_core::from_field_ptr!(Self, $field, handle) }
            }
            #[inline]
            unsafe fn keeps_graph_alive($owner: *mut Self) -> ::core::option::Option<$crate::JSValue> {
                $keeps
            }
            unsafe fn on_abort(
                $this: *mut Self,
                $cause: $crate::script_execution_context::AbortCause,
            ) {
                $body
            }
        }
    };
    ([$($generics:tt)*] $Owner:ty, $field:ident, keeps_graph_alive = |$owner:ident| $keeps:expr, |$this:ident, $cause:ident| $body:expr) => {
        $crate::impl_abort_handle_owner!([$($generics)*] $Owner, $field, keep_alive = |_this| -> () {}, keeps_graph_alive = |$owner| $keeps, |$this, $cause| $body);
    };
    ($Owner:ty, $field:ident, keep_alive = |$pinned:ident| -> $KeepAlive:ty $pin:block, keeps_graph_alive = |$owner:ident| $keeps:expr, |$this:ident, $cause:ident| $body:expr) => {
        $crate::impl_abort_handle_owner!([] $Owner, $field, keep_alive = |$pinned| -> $KeepAlive $pin, keeps_graph_alive = |$owner| $keeps, |$this, $cause| $body);
    };
    ($Owner:ty, $field:ident, keeps_graph_alive = |$owner:ident| $keeps:expr, |$this:ident, $cause:ident| $body:expr) => {
        $crate::impl_abort_handle_owner!([] $Owner, $field, keeps_graph_alive = |$owner| $keeps, |$this, $cause| $body);
    };
}

// `WebCore::ScriptExecutionContext` owns the context of a `Bun.ModuleGraph`.

unsafe extern "C" {
    /// ModuleGraph.cpp: the object `value` refers to the graph of `context` (a graph's
    /// `WebCore::ScriptExecutionContext`) from here on; to none for a null `context`.
    fn Bun__ModuleGraph__keepAliveFrom(context: *mut core::ffi::c_void, value: JSValue);
}

/// A global's `WebCore::ScriptExecutionContext` is made with this as its Rust half.
///
/// # Safety
/// `vm` is this thread's VM, whose `root_context` is written (the first global is made while
/// the rest of the VM is still being initialised).
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__VirtualMachine__rootContext(
    vm: *mut crate::VirtualMachineRef,
) -> *const ScriptExecutionContext {
    // SAFETY: fn contract; no reference to the VM is formed.
    unsafe { ptr::addr_of!((*vm).root_context) }
}

/// ModuleGraph.cpp's `ErrorHandlerContextScope`: the context native code entered becomes
/// `context` ([`ContextId::NONE`]: none). Returns the one to put back.
///
/// # Safety
/// `vm` is this thread's live VM.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__VirtualMachine__replaceEnteredContext(
    vm: *mut crate::VirtualMachineRef,
    context: ContextId,
) -> ContextId {
    // SAFETY: fn contract.
    let vm = unsafe { &*vm };
    vm.entered_context
        .replace((context != ContextId::NONE).then_some(context))
        .unwrap_or(ContextId::NONE)
}

/// # Safety
/// `vm` is this thread's live VM.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__ScriptExecutionContext__create(
    vm: *mut crate::VirtualMachineRef,
    dom_context: *mut core::ffi::c_void,
    identifier: u32,
) -> *mut ScriptExecutionContext {
    // SAFETY: fn contract.
    unsafe { (*vm).create_graph_context(dom_context, ContextId::from_raw(identifier)) }.as_ptr()
}

/// # Safety
/// `vm` is this thread's live VM and `context` one it created and has not destroyed.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__ScriptExecutionContext__stop(
    vm: *mut crate::VirtualMachineRef,
    context: *mut ScriptExecutionContext,
) {
    // SAFETY: fn contract.
    let _ = unsafe {
        (*vm).stop_graph_context(ptr::NonNull::new_unchecked(context), StopReason::Disposed)
    };
}

/// # Safety
/// As [`Bun__ScriptExecutionContext__stop`]; `context` is not used again.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__ScriptExecutionContext__release(
    vm: *mut crate::VirtualMachineRef,
    context: *mut ScriptExecutionContext,
) {
    // SAFETY: fn contract.
    unsafe { (*vm).release_graph_context(ptr::NonNull::new_unchecked(context)) }
}
