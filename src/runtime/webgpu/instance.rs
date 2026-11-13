use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;

use bun_core::{Timespec, TimespecMockMode};
use bun_io::KeepAlive;
use bun_jsc::js_promise::Strong as PromiseStrong;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{AbortHandle, ContextId, GlobalRef, JSGlobalObject, JSValue, JsResult};
use bun_ptr::{AsCtxPtr as _, JsCell, RefPtr};

use super::device::DeviceState;
use super::{Bun__WebGPU__createInstance, bytes_of_view, sys};
use crate::jsc_hooks::timer_all_mut as timer_all;
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_core::declare_scope!(webgpu, hidden);

/// The promise of each operation that Dawn has not finished.
#[derive(Default)]
struct Promises {
    slots: Vec<Option<PromiseStrong>>,
    free: Vec<usize>,
}

impl Promises {
    fn insert(&mut self, promise: PromiseStrong) -> usize {
        if let Some(slot) = self.free.pop() {
            self.slots[slot] = Some(promise);
            return slot;
        }
        self.slots.push(Some(promise));
        self.slots.len() - 1
    }

    /// Before the operation has finished, which is what frees the slot: until then it is no other promise's.
    fn take_early(&mut self, slot: usize) -> Option<PromiseStrong> {
        self.slots.get_mut(slot)?.take()
    }

    /// The operation has finished. `None` if the promise was taken early, or `stop` dropped it.
    fn take(&mut self, slot: usize) -> Option<PromiseStrong> {
        let promise = self.slots.get_mut(slot)?.take();
        self.free.push(slot);
        promise
    }
}

/// Dawn's instance, of which a global object has one, and what calls its callbacks.
///
/// Dawn has nothing for an event loop to wait on, so while something is pending a timer polls it, and the process
/// stays alive. `GPUDevice.lost` is not pending: nothing waits for a device to be lost. The same timer has devices
/// free what they are done with, which keeps nothing alive.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct Instance {
    ref_count: Cell<u32>,
    /// Null once the realm has stopped.
    handle: Cell<sys::WGPUInstance>,
    global: GlobalRef,
    promises: JsCell<Promises>,
    /// Those promises, and the devices of `devices_with_errors`. Nothing counts once the realm has stopped.
    pending: Cell<u32>,
    /// When something last began or finished.
    waiting_since: Cell<Timespec>,
    has_raised_timer_resolution: Cell<bool>,
    /// When `DeviceState::tidy` is next due.
    tidy_at: Cell<Option<Timespec>>,
    /// Those that are not lost. The lost callback of each holds a reference to it.
    devices: JsCell<Vec<NonNull<DeviceState>>>,
    /// Dawn reports an error in the middle of the call that made it, where no JavaScript can run.
    devices_with_errors: JsCell<Vec<RefPtr<DeviceState>>>,
    // pub: the timer's dispatch finds `self` from this field.
    pub(crate) poll_timer: JsCell<EventLoopTimer>,
    keep_alive: JsCell<KeepAlive>,
    /// In the context of the realm, whose `navigator.gpu` this is, whichever script asked for it first.
    abort_handle: AbortHandle,
}

bun_event_loop::impl_timer_owner!(Instance; from_timer_ptr => poll_timer);
bun_jsc::impl_abort_handle_owner!(
    Instance,
    abort_handle,
    keep_alive = |this| -> RefPtr<Instance> {
        // SAFETY: trait contract: `this` is live.
        unsafe { RefPtr::init_ref(this) }
    },
    |this, _cause| {
        // SAFETY: trait contract: `this` is live.
        unsafe { &*this }.stop()
    }
);

/// On whichever thread Dawn has something to say.
unsafe extern "C" fn on_log(
    _kind: sys::WGPULoggingType,
    message: sys::WGPUStringView,
    _userdata1: *mut c_void,
    _userdata2: *mut c_void,
) {
    // SAFETY: Dawn's, until this returns.
    let message = unsafe { bytes_of_view(message) };
    bun_core::scoped_log!(webgpu, "Dawn: {}", bstr::BStr::new(message));
}

impl Drop for Instance {
    fn drop(&mut self) {
        debug_assert!(self.pending.get() == 0);
        self.disarm_timer();
        if let Some(handle) = self.handle() {
            // SAFETY: the reference that `create` got.
            unsafe { sys::wgpuInstanceRelease(handle) };
        }
    }
}

impl Instance {
    /// `None` if Dawn makes none.
    pub(super) fn create(global: &JSGlobalObject) -> Option<RefPtr<Instance>> {
        // SAFETY: `on_log` is what Dawn calls it as.
        let handle = unsafe { Bun__WebGPU__createInstance(Some(on_log)) };
        if handle.is_null() {
            return None;
        }
        let instance = RefPtr::new(Instance {
            ref_count: Cell::new(1),
            handle: Cell::new(handle),
            global: GlobalRef::new(global),
            promises: JsCell::new(Promises::default()),
            pending: Cell::new(0),
            waiting_since: Cell::new(Timespec::EPOCH),
            has_raised_timer_resolution: Cell::new(false),
            tidy_at: Cell::new(None),
            devices: JsCell::new(Vec::new()),
            devices_with_errors: JsCell::new(Vec::new()),
            poll_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::WebGPUInstance,
            )),
            keep_alive: JsCell::new(KeepAlive::default()),
            abort_handle: AbortHandle::for_owner::<Instance>(),
        });
        // What is pending says so with `keep_alive`.
        instance.abort_handle.set_only_waits_to_be_closed();
        // SAFETY: heap-allocated, and dropping the handle disarms it.
        unsafe { AbortHandle::arm_owner(instance.as_ptr(), global.bun_vm().root_context()) };
        Some(instance)
    }

    /// `None` once the realm has stopped.
    pub(super) fn handle(&self) -> Option<sys::WGPUInstance> {
        let handle = self.handle.get();
        (!handle.is_null()).then_some(handle)
    }

    pub(super) fn global(&self) -> &JSGlobalObject {
        &self.global
    }

    /// There is nobody left to report to. A listener that was just called can have seen to that.
    pub(super) fn is_script_gone(&self, vm: &VirtualMachine) -> bool {
        self.handle().is_none()
            || !vm.script_allowed()
            || self.global.has_pending_termination_exception()
    }

    pub(super) fn add_device(&self, device: NonNull<DeviceState>) {
        self.devices.with_mut(|devices| devices.push(device));
    }

    pub(super) fn remove_device(&self, device: *mut DeviceState) {
        self.devices
            .with_mut(|devices| devices.retain(|other| other.as_ptr() != device));
    }

    /// For a caller that can lose some of them.
    fn devices(&self) -> Vec<RefPtr<DeviceState>> {
        let devices = self.devices.get().iter();
        // SAFETY: not lost, so live.
        devices
            .map(|device| unsafe { RefPtr::init_ref(device.as_ptr()) })
            .collect()
    }

    // ───────────────────────────── promises ─────────────────────────────

    /// A promise, and the `userdata1` of the callback that settles it, which gets `data`.
    pub(super) fn new_promise<T>(
        &self,
        global: &JSGlobalObject,
        data: T,
    ) -> (JSValue, *mut c_void) {
        let promise = PromiseStrong::init(global);
        let value = promise.value();
        let slot = self.promises.with_mut(|promises| promises.insert(promise));
        self.began_one();
        let operation = Box::new(Operation {
            // SAFETY: `self` is live.
            instance: unsafe { RefPtr::init_ref(self.as_ctx_ptr()) },
            slot,
            context: global.bun_vm().context_of_caller().id(),
            data,
        });
        (value, bun_core::heap::into_raw(operation).cast())
    }

    /// What `new_promise` was given, and what settles the promise.
    ///
    /// # Safety
    /// `userdata` came from `new_promise::<T>`, and this is the one call of the callback that it was passed to.
    pub(super) unsafe fn finish<T>(userdata: *mut c_void) -> (Settle, T) {
        // SAFETY: fn contract.
        let Operation {
            instance,
            slot,
            context,
            data,
        } = *unsafe { bun_core::heap::take(userdata.cast::<Operation<T>>()) };
        let promise = instance.promises.with_mut(|promises| promises.take(slot));
        let settle = Settle {
            instance,
            slot,
            context,
            promise,
        };
        (settle, data)
    }

    /// What names the promise until the operation finishes.
    ///
    /// # Safety
    /// `userdata` came from `new_promise::<T>`, and its callback has not been called.
    pub(super) unsafe fn slot_of<T>(userdata: *mut c_void) -> usize {
        // SAFETY: fn contract.
        unsafe { (*userdata.cast::<Operation<T>>()).slot }
    }

    /// Rejects the promise of an operation that Dawn has not finished, whose outcome nobody hears then.
    pub(super) fn reject_early(&self, slot: usize, reason: JSValue) {
        let promise = self.promises.with_mut(|promises| promises.take_early(slot));
        if let Some(mut promise) = promise {
            // An error is the termination of the VM, which whoever called this finds out by itself.
            let _ = promise.reject(&self.global, Ok(reason));
        }
    }

    // ───────────────────────────── polling ─────────────────────────────

    fn began_one(&self) {
        if self.handle().is_none() {
            return;
        }
        self.pending.set(self.pending.get() + 1);
        bun_core::scoped_log!(webgpu, "began one: {} pending", self.pending.get());
        self.waiting_since.set(now());
        if self.pending.get() == 1 {
            self.keep_alive
                .with_mut(|keep_alive| keep_alive.ref_(bun_io::js_vm_ctx()));
        }
        self.arm_timer();
    }

    fn finished_one(&self) {
        if self.handle().is_none() {
            return;
        }
        self.pending.set(self.pending.get() - 1);
        bun_core::scoped_log!(webgpu, "finished one: {} pending", self.pending.get());
        if self.pending.get() > 0 {
            self.waiting_since.set(now());
            return;
        }
        self.nothing_is_pending();
        self.arm_timer();
    }

    fn nothing_is_pending(&self) {
        self.keep_alive
            .with_mut(|keep_alive| keep_alive.unref(bun_io::js_vm_ctx()));
        if self.has_raised_timer_resolution.replace(false) {
            timer_resolution::restore();
        }
    }

    /// A device has something for `DeviceState::tidy`. The collector's finalizers call this too.
    pub(super) fn tidy_later(&self) {
        if self.tidy_at.get().is_some()
            || self.handle().is_none()
            || !VirtualMachine::get().script_allowed()
        {
            return;
        }
        self.tidy_at.set(Some(now().add_ms(TIDY_INTERVAL_MS)));
        if self.pending.get() == 0 {
            self.arm_timer();
        }
    }

    fn arm_timer(&self) {
        let (next, is_now) = if self.pending.get() > 0 {
            let now = now();
            let interval = poll_interval_ms(now.duration(&self.waiting_since.get()).ns());
            if interval > 0.0 && !self.has_raised_timer_resolution.replace(true) {
                timer_resolution::raise();
            }
            (now.add_ms_float(interval), interval == 0.0)
        } else if let Some(tidy_at) = self.tidy_at.get() {
            (tidy_at, false)
        } else {
            return self.disarm_timer();
        };
        // On Windows any other timer waits for 1 ms.
        self.poll_timer
            .with_mut(|timer| timer.is_due_when_idle = is_now);
        timer_all().update(self.poll_timer.as_ptr(), &next);
    }

    fn disarm_timer(&self) {
        if self.poll_timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.poll_timer.as_ptr());
        }
    }

    /// The realm is gone: none of its promises is settled, and nothing is reported to it.
    fn stop(&self) {
        let handle = self.handle.replace(core::ptr::null_mut());
        self.promises.take();
        for device in self.devices_with_errors.take() {
            device.forget_errors();
        }
        if self.pending.replace(0) > 0 {
            self.nothing_is_pending();
        }
        self.tidy_at.set(None);
        self.disarm_timer();
        // An operation that has not finished holds its device, which holds Dawn's instance, which holds the operation.
        for device in self.devices() {
            device.destroy_unless_in_use();
        }
        // SAFETY: the reference that `create` got: a handle is aborted once.
        unsafe {
            sys::wgpuInstanceProcessEvents(handle);
            sys::wgpuInstanceRelease(handle);
        }
    }

    /// # Safety
    /// `this` is live: its timer was armed.
    pub(crate) unsafe fn on_timer_fire(this: *mut Self, vm: &VirtualMachine) {
        // SAFETY: fn contract. A callback can drop what else holds it.
        let this = unsafe { RefPtr::init_ref(this) };
        this.poll_timer
            .with_mut(|timer| timer.state = EventLoopTimerState::FIRED);
        bun_core::scoped_log!(webgpu, "poll: {} pending", this.pending.get());
        if this.pending.get() > 0 {
            // What the promises' reactions do, they do when this scope ends.
            let _event_loop = vm.enter_event_loop_scope();
            this.report_errors(vm);
            if let Some(handle) = this.handle()
                && !this.is_script_gone(vm)
            {
                // SAFETY: a live instance, on the one thread that uses it.
                unsafe { sys::wgpuInstanceProcessEvents(handle) };
            }
            this.report_errors(vm);
        }
        if let Some(tidy_at) = this.tidy_at.get()
            && !tidy_at.greater(&now())
        {
            this.tidy_at.set(None);
            for device in this.devices() {
                device.tidy();
            }
        }
        if this.handle().is_some() {
            this.arm_timer();
        }
    }

    /// Runs JavaScript.
    fn report_errors(&self, vm: &VirtualMachine) {
        for device in self.devices_with_errors.take() {
            if self.is_script_gone(vm) {
                device.forget_errors();
            } else {
                device.report_errors(vm);
            }
            self.finished_one();
        }
    }

    /// `device` has errors for `DeviceState::report_errors`, which runs JavaScript, so the event loop calls it.
    pub(super) fn report_errors_later(&self, device: RefPtr<DeviceState>) {
        debug_assert!(self.handle().is_some());
        self.devices_with_errors
            .with_mut(|devices| devices.push(device));
        self.began_one();
    }
}

fn now() -> Timespec {
    Timespec::now(TimespecMockMode::ForceRealTime)
}

pub(super) const TIDY_INTERVAL_MS: i64 = 100;

/// How long the event loop may sleep before the next look at what the GPU has finished. Not at all at first, while
/// a sleep takes longer than what is waited for may. Then a promise is late by about 3% of what it waited, or 2 ms.
fn poll_interval_ms(waited_ns: u64) -> f64 {
    const SHORTEST_SLEEP_NS: u64 = if cfg!(windows) { 1_000_000 } else { 100_000 };
    if waited_ns < SHORTEST_SLEEP_NS {
        return 0.0;
    }
    (waited_ns as f64 / 32e6).min(2.0)
}

/// A timer of Windows fires on the next tick of the system's clock, which is every 15.6 ms unless the process asks.
#[cfg(windows)]
mod timer_resolution {
    use bun_sys::windows::ntdll::NtSetTimerResolution;

    /// A process has one request, for all of its threads.
    static REQUESTS: bun_threading::Guarded<u32> = bun_threading::Guarded::new(0);
    const ONE_MILLISECOND: u32 = 10_000;

    fn set(is_wanted: bool) {
        let mut current = 0;
        // SAFETY: `current` outlives the call. If it fails, timers are as coarse as they were.
        let _ =
            unsafe { NtSetTimerResolution(ONE_MILLISECOND, is_wanted.into(), &raw mut current) };
    }

    pub(super) fn raise() {
        let mut requests = REQUESTS.lock();
        *requests += 1;
        if *requests == 1 {
            set(true);
        }
    }

    pub(super) fn restore() {
        let mut requests = REQUESTS.lock();
        *requests -= 1;
        if *requests == 0 {
            set(false);
        }
    }
}

#[cfg(not(windows))]
mod timer_resolution {
    pub(super) fn raise() {}
    pub(super) fn restore() {}
}

struct Operation<T> {
    instance: RefPtr<Instance>,
    slot: usize,
    /// Of the script that began it.
    context: ContextId,
    data: T,
}

/// Settles the promise of an operation that Dawn has finished.
pub(super) struct Settle {
    instance: RefPtr<Instance>,
    slot: usize,
    context: ContextId,
    /// `None` if it was rejected early, or the realm has stopped.
    promise: Option<PromiseStrong>,
}

impl Drop for Settle {
    fn drop(&mut self) {
        self.instance.finished_one();
    }
}

impl Settle {
    /// `Ok` resolves and `Err` rejects. `outcome` is not called if there is nobody to tell.
    pub(super) fn with(self, outcome: impl FnOnce(&JSGlobalObject) -> Result<JSValue, JSValue>) {
        self.settle(|global, promise| match outcome(global) {
            Ok(value) => promise.resolve(global, value),
            Err(reason) => promise.reject(global, Ok(reason)),
        });
    }

    /// As [`with`](Self::with), for an outcome that takes making: what that throws is the reason.
    pub(super) fn with_result(self, outcome: impl FnOnce(&JSGlobalObject) -> JsResult<JSValue>) {
        self.settle(|global, promise| promise.settle(global, outcome(global)));
    }

    fn settle<R>(mut self, settle: impl FnOnce(&JSGlobalObject, &mut PromiseStrong) -> R) {
        let global = &*self.instance.global;
        let vm = global.bun_vm();
        let Some(mut promise) = self.promise.take() else {
            return;
        };
        if !vm.is_context_live(self.context) {
            return;
        }
        // That a device is lost comes before what Dawn answers knowing of it: it makes what it would have refused to.
        for device in self.instance.devices_with_errors.get().clone() {
            device.resolve_lost();
        }
        let _context = vm.enter_context(self.context);
        // An error is the termination of the VM, which the event loop finds out by itself.
        let _ = settle(global, &mut promise);
    }

    pub(super) fn instance(&self) -> &RefPtr<Instance> {
        &self.instance
    }

    /// What `slot_of` returned for the operation.
    pub(super) fn slot(&self) -> usize {
        self.slot
    }
}
