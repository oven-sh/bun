use core::cell::UnsafeCell;
use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use crate::{
    CommonAbortReason, CommonAbortReasonExt as _, JSGlobalObject, JSValue,
    VirtualMachineRef as VirtualMachine,
};
use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, InHeap, IntrusiveField, State as TimerState, Tag as TimerTag, TimerFlags,
    Timespec as ElTimespec,
};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to WebCore::AbortSignal (C++ side owns layout & refcount).
    ///
    /// The `UnsafeCell` field makes this `!Freeze`: every method takes `&self` but
    /// the C++ side mutates internal state (refcount, listener list, abort flag),
    /// so `&AbortSignal` must not carry a `noalias readonly` assumption when
    /// lowered to `*mut AbortSignal` for FFI. A real `UnsafeCell` (not just
    /// `PhantomData<UnsafeCell<_>>`, which is still `Freeze`) is required so that
    /// `as_mut_ptr` can soundly derive a write-capable pointer from `&self`.
    pub struct AbortSignal;
}

// TODO(port): move to jsc_sys
//
// `AbortSignal` and `JSGlobalObject` are opaque `UnsafeCell`-backed ZST
// handles, so `&AbortSignal` is ABI-identical to a non-null `AbortSignal*`
// and C++ mutating through it (refcount, listener list, abort flag) is
// interior mutation invisible to Rust. Shims that take only such handles +
// scalars are declared `safe fn`; those that take an opaque `*mut c_void` ctx
// or out-param keep raw pointers and stay `unsafe fn`.
unsafe extern "C" {
    safe fn WebCore__AbortSignal__aborted(arg0: &AbortSignal) -> bool;
    safe fn WebCore__AbortSignal__abortReason(arg0: &AbortSignal) -> JSValue;
    // safe: `arg1` is an opaque round-trip pointer C++ stores into the listener
    // entry and forwards to `arg_fn2` on abort (never dereferenced as Rust
    // data) — same contract as `cleanNativeBindings` / `queueMicrotaskCallback`.
    safe fn WebCore__AbortSignal__addListener(
        arg0: &AbortSignal,
        arg1: *mut c_void,
        arg_fn2: Option<unsafe extern "C" fn(*mut c_void, JSValue)>,
    ) -> *mut AbortSignal;
    // safe: `arg1` is an opaque round-trip pointer used only for identity
    // comparison on the C++ side (removes the listener entry whose `ctx == arg1`);
    // never dereferenced, so no caller-side precondition beyond the `&AbortSignal`.
    safe fn WebCore__AbortSignal__cleanNativeBindings(arg0: &AbortSignal, arg1: *mut c_void);
    safe fn WebCore__AbortSignal__create(arg0: &JSGlobalObject) -> JSValue;
    safe fn WebCore__AbortSignal__fromJS(value0: JSValue) -> *mut AbortSignal;
    safe fn WebCore__AbortSignal__ref(arg0: &AbortSignal) -> *mut AbortSignal;
    safe fn WebCore__AbortSignal__toJS(arg0: &AbortSignal, arg1: &JSGlobalObject) -> JSValue;
    safe fn WebCore__AbortSignal__unref(arg0: &AbortSignal);
    // `*mut Timeout` is round-tripped opaquely through C++ (stored from
    // `AbortSignal__Timeout__create`, never dereferenced on the C++ side), so
    // the non-`repr(C)` interior of `EventLoopTimer` is irrelevant to FFI.
    #[allow(improper_ctypes)]
    safe fn WebCore__AbortSignal__getTimeout(arg0: &AbortSignal) -> *mut Timeout;
    safe fn WebCore__AbortSignal__signal(
        arg0: &AbortSignal,
        arg1: &JSGlobalObject,
        arg2: CommonAbortReason,
    );
    safe fn WebCore__AbortSignal__incrementPendingActivity(arg0: &AbortSignal);
    safe fn WebCore__AbortSignal__decrementPendingActivity(arg0: &AbortSignal);
    safe fn WebCore__AbortSignal__reasonIfAborted(
        arg0: &AbortSignal,
        arg1: &JSGlobalObject,
        arg2: &mut u8,
    ) -> JSValue;
    safe fn WebCore__AbortSignal__new(arg0: &JSGlobalObject) -> *mut AbortSignal;
}

/// Trait expressing the Zig `comptime cb: *const fn (*Context, JSValue) void`
/// monomorphization for `listen`. Implement on your context type.
// TODO(port): Zig used a comptime fn-pointer param; Rust has no const fn-ptr
// generics, so callers implement this trait instead.
pub trait AbortListener {
    fn on_abort(&mut self, reason: JSValue);
}

impl AbortSignal {
    pub fn listen<C: AbortListener>(&self, ctx: *mut C) -> &AbortSignal {
        extern "C" fn callback<C: AbortListener>(ptr: *mut c_void, reason: JSValue) {
            // SAFETY: ptr was registered below as `*mut C`; C++ calls back on
            // the same thread before `cleanNativeBindings` removes it.
            let val = unsafe { bun_ptr::callback_ctx::<C>(ptr) };
            C::on_abort(val, reason);
        }
        self.add_listener(ctx.cast::<c_void>(), callback::<C>)
    }

    pub fn add_listener(
        &self,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, JSValue),
    ) -> &AbortSignal {
        // C++ `addListener` returns `this` — discard the round-trip pointer and
        // hand back the borrow we already hold instead of re-deriving it from
        // the raw FFI return.
        let _ = WebCore__AbortSignal__addListener(self, ctx, Some(callback));
        self
    }

    pub fn clean_native_bindings(&self, ctx: *mut c_void) {
        WebCore__AbortSignal__cleanNativeBindings(self, ctx)
    }

    pub fn signal(&self, global_object: &JSGlobalObject, reason: CommonAbortReason) {
        bun_analytics::features::abort_signal.fetch_add(1, Ordering::Relaxed);
        WebCore__AbortSignal__signal(self, global_object, reason)
    }

    pub fn pending_activity_ref(&self) {
        WebCore__AbortSignal__incrementPendingActivity(self)
    }

    pub fn pending_activity_unref(&self) {
        WebCore__AbortSignal__decrementPendingActivity(self)
    }

    /// This function is not threadsafe. aborted is a boolean, not an atomic!
    pub fn aborted(&self) -> bool {
        WebCore__AbortSignal__aborted(self)
    }

    /// This function is not threadsafe. JSValue cannot safely be passed between threads.
    pub fn abort_reason(&self) -> JSValue {
        WebCore__AbortSignal__abortReason(self)
    }

    pub fn reason_if_aborted(&self, global: &JSGlobalObject) -> Option<AbortReason> {
        let mut reason: u8 = 0;
        let js_reason = WebCore__AbortSignal__reasonIfAborted(self, global, &mut reason);
        if reason > 0 {
            debug_assert!(js_reason.is_undefined());
            // C++ guarantees `reason` is a valid CommonAbortReason discriminant when > 0.
            return Some(AbortReason::Common(match reason {
                1 => CommonAbortReason::Timeout,
                2 => CommonAbortReason::UserAbort,
                _ => CommonAbortReason::ConnectionClosed,
            }));
        }
        if js_reason.is_empty() {
            return None; // not aborted
        }
        Some(AbortReason::Js(js_reason))
    }

    pub fn ref_(&self) -> *mut AbortSignal {
        WebCore__AbortSignal__ref(self)
    }

    pub fn unref(&self) {
        WebCore__AbortSignal__unref(self)
    }

    pub fn detach(&self, ctx: *mut c_void) {
        self.clean_native_bindings(ctx);
        self.unref();
    }

    pub fn from_js(value: JSValue) -> Option<*mut AbortSignal> {
        let ptr = WebCore__AbortSignal__fromJS(value);
        if ptr.is_null() { None } else { Some(ptr) }
        // TODO(port): lifetime — returned ptr is borrowed from the JS wrapper;
        // valid only while the JSValue is reachable.
    }

    pub fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        WebCore__AbortSignal__toJS(self, global)
    }

    pub fn create(global: &JSGlobalObject) -> JSValue {
        WebCore__AbortSignal__create(global)
    }

    pub fn new(global: &JSGlobalObject) -> *mut AbortSignal {
        crate::mark_binding!();
        WebCore__AbortSignal__new(global)
    }

    /// Returns a borrowed handle to the internal Timeout, or null.
    ///
    /// Lifetime: owned by AbortSignal; may become invalid if the timer fires/cancels.
    ///
    /// Thread-safety: not thread-safe; call only on the owning thread/loop.
    ///
    /// Usage: if you need to operate on the Timeout (run/cancel/deinit), hold a ref
    /// to `this` for the duration (e.g., `this.ref_(); defer this.unref();`) and avoid
    /// caching the pointer across turns.
    pub fn get_timeout(&self) -> Option<&Timeout> {
        // TODO(port): lifetime — callers that run/cancel/deinit need `*mut`; revisit
        // whether `&mut Timeout` (or raw ptr) is the right shape once call sites port.
        let ptr = WebCore__AbortSignal__getTimeout(self);
        // SAFETY: returned Timeout is owned by `self` and valid while `self` is held
        // (see doc comment).
        NonNull::new(ptr).map(|p| unsafe { p.as_ref() })
    }
}

// SAFETY: `WebCore::AbortSignal` is intrusively refcounted on the C++ side
// (`WTF::RefCounted<AbortSignal>`); `ref()`/`unref()` are the canonical
// retain/release pair, and the pointee remains valid while the count is > 0.
// `AbortSignal` is an `opaque_ffi!` type (`!Freeze` via `UnsafeCell`), so
// `&AbortSignal` derived from the stored pointer carries no read-only
// assumption that C++-side mutation could violate.
unsafe impl bun_ptr::ExternalSharedDescriptor for AbortSignal {
    #[inline]
    unsafe fn ext_ref(this: *mut Self) {
        // `opaque_ref` is the centralised ZST-handle deref proof; caller
        // contract guarantees `this` is a live `WebCore::AbortSignal`.
        WebCore__AbortSignal__ref(Self::opaque_ref(this));
    }
    #[inline]
    unsafe fn ext_deref(this: *mut Self) {
        // `opaque_ref` is the centralised ZST-handle deref proof; C++ frees
        // the object iff the count reaches zero.
        WebCore__AbortSignal__unref(Self::opaque_ref(this));
    }
}

/// Intrusive smart pointer over a C++-refcounted `WebCore::AbortSignal`.
///
/// `Clone` bumps the C++ refcount via `ref()`; `Drop` decrements via `unref()`.
/// Replaces the broken `Arc<AbortSignal>` pattern (an `Arc` of an opaque ZST
/// cannot own a C++-allocated object — its payload address is not the C++
/// object address). Mirrors Zig `?*AbortSignal` + manual `ref()`/`unref()`.
pub type AbortSignalRef = bun_ptr::ExternalShared<AbortSignal>;

impl AbortSignal {
    /// Downcast a JS value, ref the underlying signal, and wrap. Returns
    /// `None` if `value` is not a JS `AbortSignal`.
    ///
    /// (Was `AbortSignalRef::from_js` when that was a hand-rolled newtype;
    /// moved here because inherent impls cannot be added to a type alias.)
    #[inline]
    pub fn ref_from_js(value: JSValue) -> Option<AbortSignalRef> {
        AbortSignal::from_js(value).map(|p| {
            // SAFETY: `from_js` returned a live borrow of the JS wrapper's
            // payload; `ref_()` bumps the intrusive refcount and returns the
            // same non-null pointer with +1 ownership.
            unsafe { AbortSignalRef::adopt((*p).ref_()) }
        })
    }
}

pub enum AbortReason {
    Common(CommonAbortReason),
    Js(JSValue),
}

impl AbortReason {
    pub fn to_js(self, global: &JSGlobalObject) -> JSValue {
        match self {
            AbortReason::Common(reason) => reason.to_js(global),
            AbortReason::Js(value) => value,
        }
    }

    // PORT NOTE (phase-d): `to_body_value_error` reaches into
    // `bun_runtime::webcore::body::value::ValueError` (forward dep on
    // `bun_runtime`). The conversion is trivial and is reconstructed at the
    // call-site in `bun_runtime` once that tier un-gates.
}

// ──────────────────────────────────────────────────────────────────────────
// `AbortSignal.Timeout` — port of `src/jsc/AbortSignal.zig:Timeout`.
//
// LAYERING: `EventLoopTimer` + `TimerFlags` live in `bun_event_loop` (lower
// tier). The per-VM timer heap (`Timer::All`) lives in `bun_runtime` (higher
// tier) and is reached through `RuntimeHooks::{timer_insert,timer_remove}` —
// see `VirtualMachine::timer_insert/remove`. C++ only ever sees `*mut Timeout`
// as an opaque token round-tripped through `create`/`run`/`deinit`, so the
// concrete layout is private to Rust; `repr(C)` is here so `offset_of!` is
// well-defined for the `container_of` recovery in `bun_runtime::dispatch`.
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct Timeout {
    /// Intrusive heap node. `bun_runtime::dispatch::{fire_timer,js_timer_epoch}`
    /// recover `*mut Timeout` from `*mut EventLoopTimer` via `container_of` on
    /// this field, so it must stay at a fixed offset (hence `#[repr(C)]`).
    pub event_loop_timer: EventLoopTimer,

    /// The `Timeout`'s lifetime is owned by the AbortSignal.
    /// But this does have a ref count increment.
    // PORT NOTE: AbortSignal is an opaque C++ type with intrusive WebCore
    // refcounting (ref/unref) that crosses FFI — PORTING.md §Pointers: never
    // Arc here. Kept as raw `*mut` with manual unref (matches Zig).
    pub signal: *mut AbortSignal,

    /// "epoch" is reused.
    pub flags: TimerFlags,

    /// See `swapGlobalForTestIsolation`: timers from a prior isolated test
    /// file must not fire abort handlers in the new global.
    pub generation: u32,
}

bun_event_loop::impl_timer_owner!(Timeout; from_timer_ptr => event_loop_timer);

impl Timeout {
    fn init(vm: *mut VirtualMachine, signal_: *mut AbortSignal, milliseconds: u64) -> *mut Timeout {
        // Zig: `bun.timespec.now(.allow_mocked_time).addMs(@intCast(milliseconds))`.
        let deadline = bun_core::Timespec::now_allow_mocked_time()
            .add_ms(i64::try_from(milliseconds).expect("AbortSignal.timeout(ms) overflows i64"));

        // PORT NOTE: `bun.TrivialNew` → `heap::alloc(Box::new(...))` (mimalloc
        // is the global allocator per PORTING.md §Prereq).
        let this: *mut Timeout = bun_core::heap::into_raw(Box::new(Timeout {
            event_loop_timer: EventLoopTimer {
                next: ElTimespec {
                    sec: deadline.sec,
                    nsec: deadline.nsec,
                },
                tag: TimerTag::AbortSignalTimeout,
                state: TimerState::CANCELLED,
                heap: IntrusiveField::default(),
                in_heap: InHeap::default(),
            },
            signal: signal_,
            flags: TimerFlags::default(),
            generation: VirtualMachine::get().test_isolation_generation,
        }));

        // PORT NOTE: `Environment.ci_assert` → `debug_assertions`
        // (no `ci_assert` feature in bun_jsc; matches ptr/ref_count.rs precedent).
        #[cfg(debug_assertions)]
        // `AbortSignal` is an `opaque_ffi!` ZST handle; `opaque_ref` is the
        // centralised non-null deref proof (caller contract: non-null).
        if AbortSignal::opaque_ref(signal_).aborted() {
            panic!("unreachable: signal is already aborted");
        }

        // We default to not keeping the event loop alive with this timeout.
        // SAFETY: `this` is freshly boxed and not yet shared; `event_loop_timer`
        // is unlinked. `timer_insert` links it into the per-VM heap.
        unsafe {
            VirtualMachine::timer_insert(vm, core::ptr::addr_of_mut!((*this).event_loop_timer));
        }

        this
    }

    /// Unlink `this.event_loop_timer` from the per-VM heap if currently
    /// scheduled. Must be called on the JS thread.
    fn cancel(this: &mut Timeout, vm: *mut VirtualMachine) {
        if this.event_loop_timer.state == TimerState::ACTIVE {
            // SAFETY: state == ACTIVE ⇒ node is currently linked into the heap;
            // `vm` is the live per-thread VM (JS-thread-only call site).
            unsafe {
                VirtualMachine::timer_remove(vm, &raw mut this.event_loop_timer);
            }
        }
    }

    /// Fire the timeout. May free `this` (re-entrantly via `signal` →
    /// `~AbortSignal` → `AbortSignal__Timeout__deinit`).
    ///
    /// # Safety
    /// `this` is a live boxed `Timeout`; `vm` is the live per-thread VM.
    pub unsafe fn run(this: *mut Timeout, vm: *mut VirtualMachine) {
        // SAFETY: caller passes a live Timeout; we stop touching `this` before
        // `dispatch`, which may free it.
        unsafe {
            (*this).event_loop_timer.state = TimerState::FIRED;
            Self::cancel(&mut *this, vm);

            // The signal and its handlers belong to a previous isolated test
            // file's global; firing now would run them against the new global.
            // Drop the extra ref that signalAbort() would have released.
            if (*this).generation != (*vm).test_isolation_generation {
                (*(*this).signal).unref();
                return;
            }

            // Dispatching the signal may cause the Timeout to get freed.
            // PORT NOTE: capture raw ptr before `this` may dangle.
            let signal_ptr: *mut AbortSignal = (*this).signal;
            Self::dispatch(vm, signal_ptr);
        }
    }

    fn dispatch(vm: *mut VirtualMachine, signal_ptr: *mut AbortSignal) {
        let _ = vm;
        let vm = VirtualMachine::get();
        // PORT NOTE: `loop.enter(); defer loop.exit();` — RAII guard `exit`s on
        // drop even if `signal` unwinds, and holds the raw VM-owned pointer so
        // borrowck doesn't see two live `&mut EventLoop` across re-entrant JS.
        let _guard = vm.enter_event_loop_scope();
        // signalAbort() releases the extra ref from timeout() after all
        // abort work completes, so we must not unref here.
        // `AbortSignal` is an `opaque_ffi!` ZST handle; `opaque_ref` is the
        // centralised non-null deref proof (held alive by the extra ref above).
        AbortSignal::opaque_ref(signal_ptr).signal(vm.global(), CommonAbortReason::Timeout);
    }

    // This may run inside the "signal" call.
    // PORT NOTE: not `impl Drop` — Timeout is constructed/destroyed across FFI
    // (see export fns below) and `deinit` needs a `vm` parameter.
    unsafe fn deinit(this: *mut Timeout, vm: *mut VirtualMachine) {
        // SAFETY: caller guarantees `this` came from `heap::alloc` in `init`.
        unsafe {
            Self::cancel(&mut *this, vm);
            drop(bun_core::heap::take(this));
        }
    }
}

/// Caller is expected to have already ref'd the AbortSignal.
#[unsafe(no_mangle)]
pub extern "C" fn AbortSignal__Timeout__create(
    vm: *mut VirtualMachine,
    signal_: *mut AbortSignal,
    milliseconds: u64,
) -> *mut Timeout {
    Timeout::init(vm, signal_, milliseconds)
}

#[unsafe(no_mangle)]
pub extern "C" fn AbortSignal__Timeout__run(this: *mut Timeout, vm: *mut VirtualMachine) {
    // SAFETY: C++ caller passes a live boxed Timeout and the live per-thread VM.
    unsafe { Timeout::run(this, vm) }
}

#[unsafe(no_mangle)]
pub extern "C" fn AbortSignal__Timeout__deinit(this: *mut Timeout) {
    // Called from ~AbortSignal() / cancelTimer(). The AbortSignal's
    // ScriptExecutionContext may be a dead global under --isolate, so
    // we resolve the VM via the threadlocal instead of taking it as a
    // parameter (which the caller would have to dereference the dead
    // context to obtain).
    // SAFETY: `this` is the pointer returned from AbortSignal__Timeout__create;
    // VM singleton is process-lifetime.
    unsafe { Timeout::deinit(this, VirtualMachine::get_mut_ptr()) }
}

// ported from: src/jsc/AbortSignal.zig
