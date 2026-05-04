use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JSValue, VirtualMachine};
use bun_jsc::api::timer::{EventLoopTimer, EventLoopTimerState, timer_object_internals};
use bun_runtime::webcore::body;
use bun_core::Timespec;
use bun_analytics;

use crate::CommonAbortReason;

/// Opaque FFI handle to WebCore::AbortSignal (C++ side owns layout & refcount).
#[repr(C)]
pub struct AbortSignal {
    _p: [u8; 0],
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
        // TODO(port): analytics counter — Zig: `bun.analytics.Features.abort_signal += 1`
        bun_analytics::features::abort_signal_inc();
        // SAFETY: thin FFI forward.
        unsafe {
            WebCore__AbortSignal__signal(
                self.as_mut_ptr(),
                global_object as *const _ as *mut _,
                reason,
            )
        }
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
            WebCore__AbortSignal__reasonIfAborted(
                self.as_mut_ptr(),
                global as *const _ as *mut _,
                &mut reason,
            )
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
        unsafe { WebCore__AbortSignal__toJS(self.as_mut_ptr(), global as *const _ as *mut _) }
    }

    pub fn create(global: &JSGlobalObject) -> JSValue {
        // SAFETY: thin FFI forward.
        unsafe { WebCore__AbortSignal__create(global as *const _ as *mut _) }
    }

    pub fn new(global: &JSGlobalObject) -> *mut AbortSignal {
        // TODO(port): jsc.markBinding(@src()) — debug-only binding tracer
        // SAFETY: thin FFI forward; returns a freshly-ref'd signal.
        unsafe { WebCore__AbortSignal__new(global as *const _ as *mut _) }
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
        self as *const AbortSignal as *mut AbortSignal
    }
}

pub enum AbortReason {
    Common(CommonAbortReason),
    Js(JSValue),
}

impl AbortReason {
    pub fn to_body_value_error(
        self,
        global_object: &JSGlobalObject,
    ) -> body::value::ValueError {
        // TODO(port): exact path of `jsc.WebCore.Body.Value.ValueError` in bun_runtime
        match self {
            AbortReason::Common(reason) => body::value::ValueError::AbortReason(reason),
            AbortReason::Js(value) => {
                body::value::ValueError::JSValue(bun_jsc::Strong::create(value, global_object))
            }
        }
    }

    pub fn to_js(self, global: &JSGlobalObject) -> JSValue {
        match self {
            AbortReason::Common(reason) => reason.to_js(global),
            AbortReason::Js(value) => value,
        }
    }
}

pub struct Timeout {
    pub event_loop_timer: EventLoopTimer,

    // The `Timeout`'s lifetime is owned by the AbortSignal.
    // But this does have a ref count increment.
    // TODO(port): LIFETIMES.tsv classifies this SHARED, but AbortSignal is an
    // opaque C++ type with intrusive WebCore refcounting (ref/unref) that
    // crosses FFI — PORTING.md §Pointers: never Arc here. Kept as raw `*mut`
    // with manual unref (matches Zig). Phase B: wrap in
    // `bun_ptr::IntrusiveArc<AbortSignal>` whose Drop calls
    // WebCore__AbortSignal__unref.
    pub signal: *mut AbortSignal,

    /// "epoch" is reused.
    pub flags: timer_object_internals::Flags,

    /// See `swapGlobalForTestIsolation`: timers from a prior isolated test
    /// file must not fire abort handlers in the new global.
    pub generation: u32,
}

impl Timeout {
    fn init(vm: &VirtualMachine, signal_: *mut AbortSignal, milliseconds: u64) -> *mut Timeout {
        let this: *mut Timeout = Box::into_raw(Box::new(Timeout {
            // See field note — caller has already ref'd; stored raw until
            // Phase B IntrusiveArc.
            signal: signal_,
            generation: vm.test_isolation_generation,
            event_loop_timer: EventLoopTimer {
                next: Timespec::now(bun_core::timespec::NowMode::AllowMockedTime)
                    .add_ms(i64::try_from(milliseconds).unwrap()),
                tag: bun_jsc::api::timer::EventLoopTimerTag::AbortSignalTimeout,
                state: EventLoopTimerState::Cancelled,
                ..Default::default()
            },
            flags: timer_object_internals::Flags::default(),
        }));

        #[cfg(feature = "ci_assert")]
        {
            // SAFETY: signal_ is non-null (caller contract).
            if unsafe { (*signal_).aborted() } {
                panic!("unreachable: signal is already aborted");
            }
        }

        // We default to not keeping the event loop alive with this timeout.
        // SAFETY: `this` was just Box-allocated above; event_loop_timer is the
        // intrusive node and stays at a stable address until Box::from_raw in deinit.
        vm.timer.insert(unsafe { &mut (*this).event_loop_timer });

        this
    }

    fn cancel(&mut self, vm: &VirtualMachine) {
        if self.event_loop_timer.state == EventLoopTimerState::Active {
            vm.timer.remove(&mut self.event_loop_timer);
        }
    }

    pub fn run(this: *mut Timeout, vm: &VirtualMachine) {
        // SAFETY: caller passes a live Timeout; we stop touching `this` before
        // `dispatch`, which may free it.
        unsafe {
            (*this).event_loop_timer.state = EventLoopTimerState::Fired;
            (*this).cancel(vm);

            // The signal and its handlers belong to a previous isolated test
            // file's global; firing now would run them against the new global.
            // Drop the extra ref that signalAbort() would have released.
            if (*this).generation != vm.test_isolation_generation {
                (*(*this).signal).unref();
                return;
            }

            // Dispatching the signal may cause the Timeout to get freed.
            // PORT NOTE: capture raw ptr before `this` may dangle.
            let signal_ptr: *mut AbortSignal = (*this).signal;
            Self::dispatch(vm, signal_ptr);
        }
    }

    fn dispatch(vm: &VirtualMachine, signal_ptr: *mut AbortSignal) {
        let event_loop = vm.event_loop();
        event_loop.enter();
        let _guard = scopeguard::guard((), |_| event_loop.exit());
        // signalAbort() releases the extra ref from timeout() after all
        // abort work completes, so we must not unref here.
        // SAFETY: signal_ptr is held alive by the extra ref documented above.
        unsafe { (*signal_ptr).signal(vm.global, CommonAbortReason::Timeout) };
    }

    // This may run inside the "signal" call.
    // PORT NOTE: not `impl Drop` — Timeout is constructed/destroyed across FFI
    // (see export fns below) and `deinit` needs a `vm` parameter.
    unsafe fn deinit(this: *mut Timeout, vm: &VirtualMachine) {
        // SAFETY: caller guarantees `this` came from Box::into_raw in `init`.
        unsafe {
            (*this).cancel(vm);
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
    // SAFETY: C++ caller passes the live VM.
    Timeout::init(unsafe { &*vm }, signal_, milliseconds)
}

#[unsafe(no_mangle)]
pub extern "C" fn AbortSignal__Timeout__run(this: *mut Timeout, vm: *mut VirtualMachine) {
    // SAFETY: C++ caller passes the live VM.
    Timeout::run(this, unsafe { &*vm })
}

#[unsafe(no_mangle)]
pub extern "C" fn AbortSignal__Timeout__deinit(this: *mut Timeout) {
    // Called from ~AbortSignal() / cancelTimer(). The AbortSignal's
    // ScriptExecutionContext may be a dead global under --isolate, so
    // we resolve the VM via the threadlocal instead of taking it as a
    // parameter (which the caller would have to dereference the dead
    // context to obtain).
    // SAFETY: `this` is the pointer returned from AbortSignal__Timeout__create.
    unsafe { Timeout::deinit(this, VirtualMachine::get()) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/AbortSignal.zig (255 lines)
//   confidence: medium
//   todos:      8
//   notes:      Timeout.signal kept as *mut AbortSignal (intrusive C++ refcount; LIFETIMES.tsv said SHARED but Arc invalid across FFI) — Phase B wrap in bun_ptr::IntrusiveArc; listen() reshaped to trait (no const fn-ptr generics).
// ──────────────────────────────────────────────────────────────────────────
