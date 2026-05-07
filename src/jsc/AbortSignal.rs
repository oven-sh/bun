use core::cell::UnsafeCell;
use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use crate::{CommonAbortReason, JSGlobalObject, JSValue, VirtualMachineRef as VirtualMachine};
use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, InHeap, IntrusiveField, State as TimerState, Tag as TimerTag, TimerFlags,
    Timespec as ElTimespec,
};

/// Opaque FFI handle to WebCore::AbortSignal (C++ side owns layout & refcount).
///
/// The `UnsafeCell` field makes this `!Freeze`: every method takes `&self` but
/// the C++ side mutates internal state (refcount, listener list, abort flag),
/// so `&AbortSignal` must not carry a `noalias readonly` assumption when
/// lowered to `*mut AbortSignal` for FFI. A real `UnsafeCell` (not just
/// `PhantomData<UnsafeCell<_>>`, which is still `Freeze`) is required so that
/// `as_mut_ptr` can soundly derive a write-capable pointer from `&self`.
#[repr(C)]
pub struct AbortSignal {
    _p: UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn WebCore__AbortSignal__aborted(arg0: *mut AbortSignal) -> bool;
    fn WebCore__AbortSignal__abortReason(arg0: *mut AbortSignal) -> JSValue;
    fn WebCore__AbortSignal__addListener(
        arg0: *mut AbortSignal,
        arg1: *mut c_void,
        arg_fn2: Option<unsafe extern "C" fn(*mut c_void, JSValue)>,
    ) -> *mut AbortSignal;
    fn WebCore__AbortSignal__cleanNativeBindings(arg0: *mut AbortSignal, arg1: *mut c_void);
    fn WebCore__AbortSignal__create(arg0: *mut JSGlobalObject) -> JSValue;
    fn WebCore__AbortSignal__fromJS(value0: JSValue) -> *mut AbortSignal;
    fn WebCore__AbortSignal__ref(arg0: *mut AbortSignal) -> *mut AbortSignal;
    fn WebCore__AbortSignal__toJS(arg0: *mut AbortSignal, arg1: *mut JSGlobalObject) -> JSValue;
    fn WebCore__AbortSignal__unref(arg0: *mut AbortSignal);
    fn WebCore__AbortSignal__getTimeout(arg0: *mut AbortSignal) -> *mut Timeout;
    fn WebCore__AbortSignal__signal(
        arg0: *mut AbortSignal,
        arg1: *mut JSGlobalObject,
        arg2: CommonAbortReason,
    );
    fn WebCore__AbortSignal__incrementPendingActivity(arg0: *mut AbortSignal);
    fn WebCore__AbortSignal__decrementPendingActivity(arg0: *mut AbortSignal);
    fn WebCore__AbortSignal__reasonIfAborted(
        arg0: *mut AbortSignal,
        arg1: *mut JSGlobalObject,
        arg2: *mut u8,
    ) -> JSValue;
    fn WebCore__AbortSignal__new(arg0: *mut JSGlobalObject) -> *mut AbortSignal;
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
        unsafe extern "C" fn callback<C: AbortListener>(ptr: *mut c_void, reason: JSValue) {
            // SAFETY: ptr was registered below as `*mut C`; C++ calls back on
            // the same thread before `cleanNativeBindings` removes it.
            let val = unsafe { &mut *ptr.cast::<C>() };
            C::on_abort(val, reason);
        }
        self.add_listener(ctx.cast::<c_void>(), callback::<C>)
    }

    pub fn add_listener(
        &self,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, JSValue),
    ) -> &AbortSignal {
        // SAFETY: self is a live WebCore::AbortSignal; addListener returns self.
        unsafe { &*WebCore__AbortSignal__addListener(self.as_mut_ptr(), ctx, Some(callback)) }
    }

    pub fn clean_native_bindings(&self, ctx: *mut c_void) {
        // SAFETY: thin FFI forward.
        unsafe { WebCore__AbortSignal__cleanNativeBindings(self.as_mut_ptr(), ctx) }
    }

    pub fn signal(&self, global_object: &JSGlobalObject, reason: CommonAbortReason) {
        bun_analytics::features::abort_signal.fetch_add(1, Ordering::Relaxed);
        // SAFETY: thin FFI forward.
        unsafe { WebCore__AbortSignal__signal(self.as_mut_ptr(), global_object.as_ptr(), reason) }
    }

    pub fn pending_activity_ref(&self) {
        // SAFETY: thin FFI forward.
        unsafe { WebCore__AbortSignal__incrementPendingActivity(self.as_mut_ptr()) }
    }

    pub fn pending_activity_unref(&self) {
        // SAFETY: thin FFI forward.
        unsafe { WebCore__AbortSignal__decrementPendingActivity(self.as_mut_ptr()) }
    }

    /// This function is not threadsafe. aborted is a boolean, not an atomic!
    pub fn aborted(&self) -> bool {
        // SAFETY: thin FFI forward.
        unsafe { WebCore__AbortSignal__aborted(self.as_mut_ptr()) }
    }

    /// This function is not threadsafe. JSValue cannot safely be passed between threads.
    pub fn abort_reason(&self) -> JSValue {
        // SAFETY: thin FFI forward.
        unsafe { WebCore__AbortSignal__abortReason(self.as_mut_ptr()) }
    }

    pub fn reason_if_aborted(&self, global: &JSGlobalObject) -> Option<AbortReason> {
        let mut reason: u8 = 0;
        // SAFETY: `reason` is a valid out-param; self/global are live.
        let js_reason = unsafe {
            WebCore__AbortSignal__reasonIfAborted(self.as_mut_ptr(), global.as_ptr(), &mut reason)
        };
        if reason > 0 {
            debug_assert!(js_reason.is_undefined());
            // SAFETY: C++ guarantees `reason` is a valid CommonAbortReason discriminant when > 0.
            return Some(AbortReason::Common(unsafe {
                core::mem::transmute::<u8, CommonAbortReason>(reason)
            }));
        }
        if js_reason.is_empty() {
            return None; // not aborted
        }
        Some(AbortReason::Js(js_reason))
    }

    pub fn ref_(&self) -> *mut AbortSignal {
        // SAFETY: thin FFI forward; increments C++ intrusive refcount.
        unsafe { WebCore__AbortSignal__ref(self.as_mut_ptr()) }
    }

    pub fn unref(&self) {
        // SAFETY: thin FFI forward; decrements C++ intrusive refcount.
        unsafe { WebCore__AbortSignal__unref(self.as_mut_ptr()) }
    }

    pub fn detach(&self, ctx: *mut c_void) {
        self.clean_native_bindings(ctx);
        self.unref();
    }

    pub fn from_js(value: JSValue) -> Option<*mut AbortSignal> {
        // SAFETY: thin FFI forward.
        let ptr = unsafe { WebCore__AbortSignal__fromJS(value) };
        if ptr.is_null() { None } else { Some(ptr) }
        // TODO(port): lifetime — returned ptr is borrowed from the JS wrapper;
        // valid only while the JSValue is reachable.
    }

    pub fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: thin FFI forward.
        unsafe { WebCore__AbortSignal__toJS(self.as_mut_ptr(), global.as_ptr()) }
    }

    pub fn create(global: &JSGlobalObject) -> JSValue {
        // SAFETY: thin FFI forward.
        unsafe { WebCore__AbortSignal__create(global.as_ptr()) }
    }

    pub fn new(global: &JSGlobalObject) -> *mut AbortSignal {
        crate::mark_binding!();
        // SAFETY: thin FFI forward; returns a freshly-ref'd signal.
        unsafe { WebCore__AbortSignal__new(global.as_ptr()) }
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
        // SAFETY: thin FFI forward; returned Timeout is owned by `self` and valid
        // while `self` is held (see doc comment).
        // TODO(port): lifetime — callers that run/cancel/deinit need `*mut`; revisit
        // whether `&mut Timeout` (or raw ptr) is the right shape once call sites port.
        let ptr = unsafe { WebCore__AbortSignal__getTimeout(self.as_mut_ptr()) };
        NonNull::new(ptr).map(|p| unsafe { &*p.as_ptr() })
    }

    #[inline(always)]
    fn as_mut_ptr(&self) -> *mut AbortSignal {
        // SAFETY: `AbortSignal` is an opaque zero-sized FFI handle whose first
        // (and only sized) field is an `UnsafeCell` at offset 0 of this
        // `repr(C)` struct. `UnsafeCell::get` legitimately yields a `*mut`
        // from `&self`, and casting it back to `*mut AbortSignal` preserves
        // address and provenance. No Rust-visible bytes exist at this address;
        // all mutation happens inside C++ memory that the `&self` borrow does
        // not cover — interior mutability is the intended contract.
        self._p.get().cast::<AbortSignal>()
    }
}

/// Intrusive smart pointer over a C++-refcounted `WebCore::AbortSignal`.
///
/// `Clone` bumps the C++ refcount via `ref()`; `Drop` decrements via `unref()`.
/// Replaces the broken `Arc<AbortSignal>` pattern (an `Arc` of an opaque ZST
/// cannot own a C++-allocated object — its payload address is not the C++
/// object address). Mirrors Zig `?*AbortSignal` + manual `ref()`/`unref()`.
#[repr(transparent)]
pub struct AbortSignalRef(NonNull<AbortSignal>);

impl AbortSignalRef {
    /// Adopt a `+1`-ref'd `*mut AbortSignal` (e.g. from `AbortSignal::ref_()`
    /// or `AbortSignal::new`).
    ///
    /// # Safety
    /// `ptr` must be non-null, point to a live `WebCore::AbortSignal`, and
    /// carry an owned reference that this `AbortSignalRef` will release on drop.
    #[inline]
    pub unsafe fn adopt(ptr: *mut AbortSignal) -> Self {
        debug_assert!(!ptr.is_null());
        // SAFETY: caller contract — `ptr` is non-null.
        Self(unsafe { NonNull::new_unchecked(ptr) })
    }

    /// Downcast a JS value, ref the underlying signal, and wrap. Returns
    /// `None` if `value` is not a JS `AbortSignal`.
    #[inline]
    pub fn from_js(value: JSValue) -> Option<Self> {
        AbortSignal::from_js(value).map(|p| {
            // SAFETY: `from_js` returned a live borrow of the JS wrapper's
            // payload; `ref_()` bumps the intrusive refcount and returns the
            // same non-null pointer with +1 ownership.
            unsafe { Self::adopt((*p).ref_()) }
        })
    }

    #[inline]
    pub fn as_ptr(&self) -> *mut AbortSignal {
        self.0.as_ptr()
    }
}

impl core::ops::Deref for AbortSignalRef {
    type Target = AbortSignal;
    #[inline]
    fn deref(&self) -> &AbortSignal {
        // SAFETY: held +1 ref keeps the C++ object alive for `'_`.
        unsafe { self.0.as_ref() }
    }
}

impl Clone for AbortSignalRef {
    #[inline]
    fn clone(&self) -> Self {
        // SAFETY: `ref_()` returns the same non-null pointer with +1 refcount.
        unsafe { Self::adopt(self.0.as_ref().ref_()) }
    }
}

impl Drop for AbortSignalRef {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: held +1 ref keeps the C++ object alive until this unref.
        unsafe { self.0.as_ref().unref() }
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

impl Timeout {
    fn init(vm: *mut VirtualMachine, signal_: *mut AbortSignal, milliseconds: u64) -> *mut Timeout {
        // Zig: `bun.timespec.now(.allow_mocked_time).addMs(@intCast(milliseconds))`.
        let deadline = bun_core::Timespec::now_allow_mocked_time()
            .add_ms(i64::try_from(milliseconds).expect("AbortSignal.timeout(ms) overflows i64"));

        // PORT NOTE: `bun.TrivialNew` → `Box::into_raw(Box::new(...))` (mimalloc
        // is the global allocator per PORTING.md §Prereq).
        let this: *mut Timeout = Box::into_raw(Box::new(Timeout {
            event_loop_timer: EventLoopTimer {
                next: ElTimespec { sec: deadline.sec, nsec: deadline.nsec },
                tag: TimerTag::AbortSignalTimeout,
                state: TimerState::CANCELLED,
                heap: IntrusiveField::default(),
                in_heap: InHeap::default(),
            },
            signal: signal_,
            flags: TimerFlags::default(),
            // SAFETY: `vm` is the live per-thread VM (caller contract).
            generation: unsafe { (*vm).test_isolation_generation },
        }));

        // PORT NOTE: `Environment.ci_assert` → `debug_assertions`
        // (no `ci_assert` feature in bun_jsc; matches ptr/ref_count.rs precedent).
        #[cfg(debug_assertions)]
        // SAFETY: `signal_` is non-null (caller contract).
        if unsafe { (*signal_).aborted() } {
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

    /// # Safety
    /// `this` is a live boxed `Timeout`; must be called on the JS thread.
    unsafe fn cancel(this: *mut Timeout, vm: *mut VirtualMachine) {
        // SAFETY: per fn contract.
        if unsafe { (*this).event_loop_timer.state } == TimerState::ACTIVE {
            // SAFETY: state == ACTIVE ⇒ node is currently linked into the heap.
            unsafe {
                VirtualMachine::timer_remove(
                    vm,
                    core::ptr::addr_of_mut!((*this).event_loop_timer),
                );
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
            Self::cancel(this, vm);

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
        // SAFETY: `event_loop()` returns the VM-owned EventLoop; live for VM lifetime.
        let event_loop = unsafe { (*vm).event_loop() };
        // PORT NOTE: `loop.enter(); defer loop.exit();` — RAII guard `exit`s on
        // drop even if `signal` unwinds, and holds the raw VM-owned pointer so
        // borrowck doesn't see two live `&mut EventLoop` across re-entrant JS.
        // SAFETY: per above; `enter`/`exit` mutate per-thread bookkeeping only.
        let _guard = unsafe { crate::event_loop::EventLoop::enter_scope(event_loop) };
        // signalAbort() releases the extra ref from timeout() after all
        // abort work completes, so we must not unref here.
        // SAFETY: signal_ptr is held alive by the extra ref documented above;
        // `vm.global` is process-lifetime.
        unsafe { (*signal_ptr).signal(&*(*vm).global, CommonAbortReason::Timeout) };
    }

    // This may run inside the "signal" call.
    // PORT NOTE: not `impl Drop` — Timeout is constructed/destroyed across FFI
    // (see export fns below) and `deinit` needs a `vm` parameter.
    unsafe fn deinit(this: *mut Timeout, vm: *mut VirtualMachine) {
        // SAFETY: caller guarantees `this` came from `Box::into_raw` in `init`.
        unsafe {
            Self::cancel(this, vm);
            drop(Box::from_raw(this));
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
    unsafe { Timeout::deinit(this, VirtualMachine::get()) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/AbortSignal.zig (255 lines)
//   confidence: high
//   notes:      Timeout.signal kept as *mut AbortSignal (intrusive C++
//               refcount; Arc invalid across FFI). listen() reshaped to trait
//               (no const fn-ptr generics). vm.timer.{insert,remove} routed
//               through RuntimeHooks (Timer::All lives in bun_runtime).
// ──────────────────────────────────────────────────────────────────────────
