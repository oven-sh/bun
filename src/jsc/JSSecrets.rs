use crate::virtual_machine::VirtualMachine;
use crate::{JSGlobalObject, JSValue, JsResult, Strong};
use bun_event_loop::EventLoopTimer::{EventLoopTimer, State as TimerState, Tag as TimerTag};
use bun_io::KeepAlive;

// Opaque pointer to C++ SecretsJobOptions struct
bun_opaque::opaque_ffi! { pub struct SecretsJobOptions; }

// safe fn: `SecretsJobOptions` and `JSGlobalObject` are `opaque_ffi!` ZST
// handles (`!Freeze` via `UnsafeCell`); `&mut`/`&` are ABI-identical to
// non-null `*mut`/`*const` and C++ mutating job state through them is interior
// to the cell. `deinit` consumes/frees the C++ allocation and so stays
// `unsafe fn` (double-free precondition).
unsafe extern "C" {
    safe fn Bun__SecretsJobOptions__runTask(ctx: &mut SecretsJobOptions);
    safe fn Bun__SecretsJobOptions__runFromJS(
        ctx: &mut SecretsJobOptions,
        global: &JSGlobalObject,
        promise: JSValue,
    );
    /// Thread-safe: touches only the job's cancellation atomics.
    safe fn Bun__SecretsJobOptions__cancel(ctx: &mut SecretsJobOptions);
    /// Reads only fields the pool thread never writes (`op`, `timeoutMs`).
    safe fn Bun__SecretsJobOptions__rejectTimedOut(
        ctx: &mut SecretsJobOptions,
        global: &JSGlobalObject,
        promise: JSValue,
    );
    fn Bun__SecretsJobOptions__deinit(ctx: *mut SecretsJobOptions);
}

/// The C++ `SecretsJobOptions` a job owns; plain data, freed wherever the job ends.
struct SecretsOptions(*mut SecretsJobOptions);
// SAFETY: an owned C++ heap object with no thread affinity.
unsafe impl Send for SecretsOptions {}
impl Drop for SecretsOptions {
    fn drop(&mut self) {
        // SAFETY: the pointer C++ handed to `Bun__Secrets__scheduleJob`; freed once, here.
        unsafe { Bun__SecretsJobOptions__deinit(self.0) };
    }
}

/// `Bun.secrets.{get,set,delete}` off the JS thread.
pub(crate) struct SecretsJob {
    options: SecretsOptions,
}

impl crate::JobContext for SecretsJob {
    type OffThread = Self;
    type Js = Box<Pending>;
    /// Only libsecret takes a `GCancellable`; Keychain and Credential Manager
    /// calls cannot be interrupted.
    const CANCELLABLE: bool = cfg!(any(target_os = "linux", target_os = "freebsd"));
    /// [`Pending`] holds the loop ref, so the deadline can release it.
    const KEEPS_LOOP_ALIVE: bool = false;

    fn run(this: &mut Self, done: crate::Completion<Self>) -> Option<crate::Completion<Self>> {
        Bun__SecretsJobOptions__runTask(SecretsJobOptions::opaque_mut(this.options.0));
        Some(done)
    }

    fn then(this: Self, pending: Box<Pending>, cx: &crate::JsThread<'_>) -> JsResult<()> {
        // The deadline already rejected the promise: drop the late result.
        if pending.timed_out {
            return Ok(());
        }
        let global = cx.global();
        // `Bun__SecretsJobOptions__runFromJS` opens a `DECLARE_THROW_SCOPE` and
        // returns via `RELEASE_AND_RETURN`, which simulates a throw to the parent
        // scope under `BUN_JSC_validateExceptionChecks=1`. Without an enclosing
        // scope here, `drainMicrotasks`'s `TopExceptionScope` ctor asserts on the
        // unchecked simulated throw — same shape as `JSCDeferredWorkTask::run`.
        crate::validation_scope!(scope, global);
        Bun__SecretsJobOptions__runFromJS(
            SecretsJobOptions::opaque_mut(this.options.0),
            global,
            pending.promise.get(),
        );
        scope.assert_no_exception_except_termination()
    }

    /// VM teardown: make a call parked on the keyring (D-Bus, an unlock prompt) return.
    unsafe fn cancel(off: *mut Self) {
        // SAFETY: fn contract; `cancel` only touches the job's atomics.
        Bun__SecretsJobOptions__cancel(SecretsJobOptions::opaque_mut(unsafe { (*off).options.0 }));
    }
}

/// The JS-thread half of a [`SecretsJob`]: the promise, the loop ref, and the
/// deadline. Boxed: the timer node needs a stable address while the job moves.
#[repr(C)]
pub struct Pending {
    /// `bun_runtime::dispatch` recovers `*mut Pending` from this field
    /// (`container_of`), hence `#[repr(C)]`.
    event_loop_timer: EventLoopTimer,
    promise: Strong,
    keep_alive: KeepAlive,
    /// The job's C++ options: live whenever the timer can fire, because the job
    /// frees them only after this box (which unlinks the timer) is dropped.
    options: *mut SecretsJobOptions,
    timed_out: bool,
}

// SAFETY: a promise handle and a loop ref, both used and dropped on the owning
// JS thread only (the job's `Js` side).
unsafe impl crate::job::JsAffine for Pending {}

bun_event_loop::impl_timer_owner!(Pending; from_timer_ptr => event_loop_timer);

impl Pending {
    /// The deadline passed: reject the promise, let the loop go, and ask the
    /// platform call to return (`then` drops its late result).
    ///
    /// # Safety
    /// `this` is the live box a `SecretsJob` owns; `vm` is the live per-thread VM.
    pub unsafe fn on_timeout(this: *mut Self, vm: *mut VirtualMachine) -> JsResult<()> {
        // SAFETY: fn contract; nothing else references the box on this thread
        // while the timer dispatch runs.
        let this = unsafe { &mut *this };
        this.event_loop_timer.state = TimerState::FIRED;
        this.timed_out = true;
        this.keep_alive.unref(bun_io::js_vm_ctx());
        Bun__SecretsJobOptions__cancel(SecretsJobOptions::opaque_mut(this.options));
        // SAFETY: fn contract.
        let vm = unsafe { &*vm };
        let global = vm.global();
        // The rejection's reactions are microtasks; the scope's exit drains
        // them now, before the loop (no longer held by this job) winds down.
        let _loop_scope = vm.enter_event_loop_scope();
        // Same shape as `then`: the C++ side opens its own throw scope.
        crate::validation_scope!(scope, global);
        Bun__SecretsJobOptions__rejectTimedOut(
            SecretsJobOptions::opaque_mut(this.options),
            global,
            this.promise.get(),
        );
        scope.assert_no_exception_except_termination()
    }
}

impl Drop for Pending {
    fn drop(&mut self) {
        if self.event_loop_timer.state == TimerState::ACTIVE {
            // SAFETY: ACTIVE ⇒ linked into this thread's heap; JS thread
            // (`JsAffine`).
            unsafe {
                VirtualMachine::timer_remove(
                    VirtualMachine::get_mut_ptr(),
                    &raw mut self.event_loop_timer,
                );
            }
        }
        self.keep_alive.unref(bun_io::js_vm_ctx());
    }
}

// Helper function for C++ to call with opaque pointer. `timeout_ms` 0: no deadline.
#[unsafe(no_mangle)]
extern "C" fn Bun__Secrets__scheduleJob(
    global: &JSGlobalObject,
    options: *mut SecretsJobOptions,
    promise: JSValue,
    timeout_ms: u64,
) {
    let cx = global.js_thread();
    let mut keep_alive = KeepAlive::default();
    keep_alive.ref_(bun_io::js_vm_ctx());
    let mut pending = Box::new(Pending {
        event_loop_timer: EventLoopTimer::init_paused(TimerTag::SecretsTimeout),
        promise: Strong::create(promise, global),
        keep_alive,
        options,
        timed_out: false,
    });
    if timeout_ms > 0 {
        let deadline = bun_core::Timespec::ms_from_now(
            bun_core::TimespecMockMode::ForceRealTime,
            i64::try_from(timeout_ms).unwrap_or(i64::MAX),
        );
        pending.event_loop_timer.next = deadline;
        // SAFETY: the node is fresh and unlinked; the box gives it a stable
        // address until `Pending::drop` unlinks it; JS thread (`cx`).
        unsafe {
            VirtualMachine::timer_insert(
                VirtualMachine::get_mut_ptr(),
                &raw mut pending.event_loop_timer,
            );
        }
    }
    crate::Job::<SecretsJob>::schedule(
        &cx,
        SecretsJob {
            options: SecretsOptions(options),
        },
        pending,
    );
}
