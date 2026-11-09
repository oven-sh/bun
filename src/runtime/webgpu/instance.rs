use core::cell::Cell;
use core::ffi::c_void;

use bun_core::{Timespec, TimespecMockMode};
use bun_io::KeepAlive;
use bun_jsc::js_promise::Strong as PromiseStrong;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{AbortHandle, GlobalRef, JSGlobalObject, JSValue, JsResult};
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
/// stays alive. `GPUDevice.lost` is not pending: nothing waits for a device to be lost.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct Instance {
    ref_count: Cell<u32>,
    /// Null once the script that made it has stopped. Dawn cancels the callbacks that are left when its instance goes,
    /// which its adapters and devices hold too: that can be as late as when the collector finalizes the last of them.
    handle: Cell<sys::WGPUInstance>,
    global: GlobalRef,
    promises: JsCell<Promises>,
    /// Those promises, and the devices of `devices_with_errors`. Nothing counts once the script has stopped.
    pending: Cell<u32>,
    /// How many times in a row the timer has found nothing finished.
    idle_polls: Cell<u32>,
    /// Dawn reports an error in the middle of the call that made it, where no JavaScript can run.
    devices_with_errors: JsCell<Vec<RefPtr<DeviceState>>>,
    // pub: the timer's dispatch finds `self` from this field.
    pub(crate) poll_timer: JsCell<EventLoopTimer>,
    keep_alive: JsCell<KeepAlive>,
    /// Armed while something is pending.
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
        debug_assert!(self.poll_timer.get().state != EventLoopTimerState::ACTIVE);
        self.release_handle();
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
        Some(RefPtr::new(Instance {
            ref_count: Cell::new(1),
            handle: Cell::new(handle),
            global: GlobalRef::new(global),
            promises: JsCell::new(Promises::default()),
            pending: Cell::new(0),
            idle_polls: Cell::new(0),
            devices_with_errors: JsCell::new(Vec::new()),
            poll_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::WebGPUInstance,
            )),
            keep_alive: JsCell::new(KeepAlive::default()),
            abort_handle: AbortHandle::for_owner::<Instance>(),
        }))
    }

    /// `None` once the script that made it has stopped.
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

    fn release_handle(&self) {
        let handle = self.handle.replace(core::ptr::null_mut());
        if !handle.is_null() {
            // SAFETY: the reference that `create` got.
            unsafe { sys::wgpuInstanceRelease(handle) };
        }
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
            data,
        } = *unsafe { bun_core::heap::take(userdata.cast::<Operation<T>>()) };
        let promise = instance.promises.with_mut(|promises| promises.take(slot));
        let settle = Settle {
            instance,
            slot,
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
        // What has just begun may be quick, however slow what the timer was waiting for is.
        let was_slow = self.poll_interval_ms() > 1;
        self.idle_polls.set(0);
        if self.pending.get() > 1 {
            if was_slow {
                self.poll_after(0);
            }
            return;
        }
        self.keep_alive
            .with_mut(|keep_alive| keep_alive.ref_(bun_io::js_vm_ctx()));
        let context = self.global.js_thread_of_caller().context();
        // SAFETY: heap-allocated, and `finished_one`, `stop` or `Drop` disarms it.
        unsafe { AbortHandle::arm_owner(self.as_ctx_ptr(), context) };
        if self.poll_timer.get().state != EventLoopTimerState::ACTIVE {
            self.poll_after(0);
        }
    }

    fn finished_one(&self) {
        if self.handle().is_none() {
            return;
        }
        self.pending.set(self.pending.get() - 1);
        self.idle_polls.set(0);
        bun_core::scoped_log!(webgpu, "finished one: {} pending", self.pending.get());
        if self.pending.get() == 0 {
            self.stop_polling();
        }
    }

    /// How long the event loop sleeps between two looks at what the GPU has finished: 1 ms, and up to 8 ms once
    /// nothing has finished for a while.
    fn poll_interval_ms(&self) -> i64 {
        1 << (self.idle_polls.get() / 16).min(3)
    }

    fn poll_after(&self, ms: i64) {
        let next = Timespec::ms_from_now(TimespecMockMode::ForceRealTime, ms);
        timer_all().update(self.poll_timer.as_ptr(), &next);
    }

    fn stop_polling(&self) {
        if self.poll_timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.poll_timer.as_ptr());
        }
        self.keep_alive
            .with_mut(|keep_alive| keep_alive.unref(bun_io::js_vm_ctx()));
        self.abort_handle.leave();
    }

    /// The script is gone: none of its promises is settled, and nothing is reported to it.
    fn stop(&self) {
        self.promises.take();
        for device in self.devices_with_errors.take() {
            device.forget_errors();
        }
        self.pending.set(0);
        self.stop_polling();
        self.release_handle();
    }

    /// # Safety
    /// `this` is live: its timer was armed.
    pub(crate) unsafe fn on_timer_fire(this: *mut Self, vm: &VirtualMachine) {
        // SAFETY: fn contract. A callback can drop what else holds it.
        let this = unsafe { RefPtr::init_ref(this) };
        this.poll_timer
            .with_mut(|timer| timer.state = EventLoopTimerState::FIRED);
        bun_core::scoped_log!(webgpu, "poll: {} pending", this.pending.get());
        let (Some(handle), Some(context)) = (this.handle(), this.abort_handle.context_id()) else {
            return;
        };
        {
            // What the promises' reactions do, they do when this scope ends.
            let _event_loop = vm.enter_event_loop_scope();
            let _context = vm.enter_context(context);
            // SAFETY: a live instance, on the one thread that uses it.
            unsafe { sys::wgpuInstanceProcessEvents(handle) };
            for device in this.devices_with_errors.take() {
                if this.is_script_gone(vm) {
                    device.forget_errors();
                } else {
                    device.report_errors(vm);
                }
                this.finished_one();
            }
        }
        if this.pending.get() > 0 && this.poll_timer.get().state != EventLoopTimerState::ACTIVE {
            this.poll_after(this.poll_interval_ms());
            this.idle_polls.set(this.idle_polls.get().saturating_add(1));
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

struct Operation<T> {
    instance: RefPtr<Instance>,
    slot: usize,
    data: T,
}

/// Settles the promise of an operation that Dawn has finished.
pub(super) struct Settle {
    instance: RefPtr<Instance>,
    slot: usize,
    /// `None` if it was rejected early, or the script has stopped.
    promise: Option<PromiseStrong>,
}

impl Drop for Settle {
    fn drop(&mut self) {
        self.instance.finished_one();
    }
}

impl Settle {
    /// `Ok` resolves and `Err` rejects. `outcome` is not called if there is nobody to tell.
    pub(super) fn with(
        mut self,
        outcome: impl FnOnce(&JSGlobalObject) -> Result<JSValue, JSValue>,
    ) {
        let Some(mut promise) = self.promise.take() else {
            return;
        };
        let global = &*self.instance.global;
        // An error is the termination of the VM, which the event loop finds out by itself.
        let _ = match outcome(global) {
            Ok(value) => promise.resolve(global, value),
            Err(reason) => promise.reject(global, Ok(reason)),
        };
    }

    /// As [`with`](Self::with), for an outcome that takes making: what that throws is the reason.
    pub(super) fn with_result(
        mut self,
        outcome: impl FnOnce(&JSGlobalObject) -> JsResult<JSValue>,
    ) {
        let Some(mut promise) = self.promise.take() else {
            return;
        };
        let global = &*self.instance.global;
        let _ = promise.settle(global, outcome(global));
    }

    pub(super) fn instance(&self) -> &RefPtr<Instance> {
        &self.instance
    }

    /// What `slot_of` returned for the operation.
    pub(super) fn slot(&self) -> usize {
        self.slot
    }
}
