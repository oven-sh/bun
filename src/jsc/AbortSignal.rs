use core::ffi::c_void;
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
    pub struct AbortSignal;
}

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

pub type AbortSignalRef = bun_ptr::ExternalShared<AbortSignal>;

impl AbortSignal {
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
}

#[repr(C)]
pub struct Timeout {
    /// Intrusive heap node. `bun_runtime::dispatch::{fire_timer,js_timer_epoch}`
    /// recover `*mut Timeout` from `*mut EventLoopTimer` via `container_of` on
    /// this field, so it must stay at a fixed offset (hence `#[repr(C)]`).
    pub event_loop_timer: EventLoopTimer,

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

        // Zig: gated on `bun.Environment.ci_assert`.
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
pub(crate) extern "C" fn AbortSignal__Timeout__create(
    vm: *mut VirtualMachine,
    signal_: *mut AbortSignal,
    milliseconds: u64,
) -> *mut Timeout {
    Timeout::init(vm, signal_, milliseconds)
}

/// # Safety
/// `this` must be a live boxed `Timeout` returned from `AbortSignal__Timeout__create`;
/// `vm` must be the live per-thread `VirtualMachine`.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn AbortSignal__Timeout__run(
    this: *mut Timeout,
    vm: *mut VirtualMachine,
) {
    // SAFETY: C++ caller passes a live boxed Timeout and the live per-thread VM.
    unsafe { Timeout::run(this, vm) }
}

/// # Safety
/// `this` must be a live boxed `Timeout` returned from `AbortSignal__Timeout__create`.
/// Must be called on the owning JS thread — `deinit` resolves the VM via the
/// thread-local `VirtualMachine::get_mut_ptr()` and `Timeout::cancel` requires it.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn AbortSignal__Timeout__deinit(this: *mut Timeout) {
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
