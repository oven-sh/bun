//! Waiting for the GPU: wgpu-core fires callbacks only inside `device_poll`, so one [`Job`] per device polls: on the work pool at first, and on the device's own thread when the wait is long.

use std::cell::Cell;
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Sender};
use std::time::{Duration, Instant};

use bun_jsc::job::JsAffine;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    AbortHandle, Completion, ContextId, JSGlobalObject, Job, JobContext, JsCell, JsResult, JsThread,
};
use bun_threading::Guarded;

use super::device::{DeviceRef, DeviceState};

enum SlotState<R> {
    Empty,
    Filled(R),
    Closed,
}

/// Where a wgpu-core callback, on any thread, leaves its result for the JS thread.
pub(crate) struct Slot<R> {
    state: Guarded<SlotState<R>>,
    /// The device's count of filled slots: a change is what ends its poller's run.
    filled: Arc<AtomicUsize>,
}

impl<R> Slot<R> {
    pub(crate) fn fill(&self, value: R) {
        let mut state = self.state.lock();
        if matches!(*state, SlotState::Empty) {
            *state = SlotState::Filled(value);
            self.filled.fetch_add(1, Ordering::Release);
        }
    }

    fn is_filled(&self) -> bool {
        matches!(*self.state.lock(), SlotState::Filled(_))
    }

    /// Takes the result, if there is one, and refuses any later one.
    fn close(&self) -> Option<R> {
        match core::mem::replace(&mut *self.state.lock(), SlotState::Closed) {
            SlotState::Filled(result) => Some(result),
            SlotState::Empty | SlotState::Closed => None,
        }
    }
}

/// What to do on the JS thread once the callback has fired.
pub(crate) trait Waiter: 'static {
    type Result: Send + 'static;
    /// JS-thread state of the wait: the promise, the wrapper it belongs to.
    type Js: 'static;
    /// `result` is `None` if the device was lost before the GPU answered.
    fn settle(result: Option<Self::Result>, js: Self::Js, cx: &JsThread<'_>) -> JsResult<()>;
    /// The context that made the call has stopped (a disposed `Bun.ModuleGraph`), so script gets no answer. `true`: native state still has to follow the GPU, and `abandon` takes the answer.
    fn stopped(js: &Self::Js, global: &JSGlobalObject) -> bool {
        let _ = (js, global);
        false
    }
    /// In place of `settle` for a wait whose context has stopped.
    fn abandon(result: Option<Self::Result>, js: Self::Js, cx: &JsThread<'_>) -> JsResult<()> {
        let _ = (result, js, cx);
        Ok(())
    }
}

trait Pending {
    fn is_ready(&self) -> bool;
    fn context(&self) -> ContextId;
    fn settle(self: Box<Self>, cx: &JsThread<'_>) -> JsResult<()>;
    fn abandon(self: Box<Self>, cx: &JsThread<'_>) -> JsResult<()>;
}

struct PendingWait<W: Waiter> {
    slot: Arc<Slot<W::Result>>,
    js: W::Js,
    /// The context of the script that made the call. The wait settles in that one, and is abandoned once it has stopped.
    context: ContextId,
    /// The device whose [`Waits`] holds this.
    device: Weak<DeviceState>,
    /// Armed in `context` when that is a `Bun.ModuleGraph`'s: the graph's waits end when it is disposed, not when the GPU answers.
    abort_handle: AbortHandle,
}

bun_jsc::impl_abort_handle_owner!([W: Waiter] PendingWait<W>, abort_handle, |this, _cause| {
    // SAFETY: trait contract: `this` is live.
    let wait = unsafe { &*this };
    let Some(device) = wait.device.upgrade() else {
        return;
    };
    let waits = &device.waits;
    if !W::stopped(&wait.js, VirtualMachine::get().global()) {
        // Frees `this`, if the wait is not on its way through `deliver`.
        waits.pending.with_mut(|pending| {
            pending.retain(|other| !core::ptr::addr_eq(&raw const **other, this));
        });
    }
    if waits.pending.with_mut(|pending| pending.is_empty()) {
        // Nothing is left to poll for: the job completes, and `then` starts no other.
        if let Some(poller) = waits.poller.get() {
            poller.cancelled.store(true, Ordering::Release);
        }
    }
});

impl<W: Waiter> Pending for PendingWait<W> {
    fn is_ready(&self) -> bool {
        self.slot.is_filled()
    }

    fn context(&self) -> ContextId {
        self.context
    }

    fn settle(self: Box<Self>, cx: &JsThread<'_>) -> JsResult<()> {
        // First: the script this runs can dispose the graph, and the handle must not find a wait that is half gone.
        self.abort_handle.disarm();
        let PendingWait { slot, js, .. } = *self;
        W::settle(slot.close(), js, cx)
    }

    fn abandon(self: Box<Self>, cx: &JsThread<'_>) -> JsResult<()> {
        self.abort_handle.disarm();
        let PendingWait { slot, js, .. } = *self;
        W::abandon(slot.close(), js, cx)
    }
}

/// A device's unsettled `mapAsync()` and `onSubmittedWorkDone()` calls, in the order script made them.
#[derive(Default)]
pub(crate) struct Waits {
    filled: Arc<AtomicUsize>,
    pending: JsCell<Vec<Box<dyn Pending>>>,
    /// The value of `filled` the last delivery accounted for.
    delivered: Cell<usize>,
    polling: Cell<bool>,
    /// The job that polls now, for a wait that ends early to wake.
    poller: JsCell<Option<Arc<PollShared>>>,
    long_waits: LongWaits,
}

impl Waits {
    pub(crate) fn slot<R>(&self) -> Arc<Slot<R>> {
        Arc::new(Slot {
            state: Guarded::new(SlotState::Empty),
            filled: Arc::clone(&self.filled),
        })
    }
}

/// Settles `js` through `W` once `slot` is filled. Among the waits that are ready, settling follows call order.
pub(crate) fn wait<W: Waiter>(
    device: &DeviceRef,
    cx: &JsThread<'_>,
    slot: Arc<Slot<W::Result>>,
    js: W::Js,
) {
    let mut entry = Box::new(PendingWait::<W> {
        slot,
        js,
        context: cx.context().id(),
        device: Rc::downgrade(device),
        abort_handle: AbortHandle::for_owner::<PendingWait<W>>(),
    });
    if let Some(graph) = cx.vm().as_graph_context(cx.context()) {
        // SAFETY: boxed, so it does not move, and only its owner drops it, which disarms the handle.
        unsafe { AbortHandle::arm_owner(&raw mut *entry, graph) };
    }
    device.waits.pending.with_mut(|pending| pending.push(entry));
    start_poller(device, cx);
}

fn start_poller(device: &DeviceRef, cx: &JsThread<'_>) {
    let waits = &device.waits;
    if waits.polling.get() || waits.pending.with_mut(|pending| pending.is_empty()) {
        return;
    }
    waits.polling.set(true);
    let shared = Arc::new(PollShared {
        device: Arc::clone(&device.raw),
        filled: Arc::clone(&waits.filled),
        seen: waits.delivered.get(),
        failed: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
    });
    waits.poller.set(Some(Arc::clone(&shared)));
    // The realm's context, not the caller's: one poller serves the waits of every context that uses the device, and a `Bun.ModuleGraph` that is disposed must not take it along.
    let realm = cx.global().js_thread(cx.vm().root_context());
    Job::<Poller>::schedule(
        &realm,
        PollOff {
            shared,
            long_waits: Arc::clone(&waits.long_waits),
        },
        PollJs(Some(Rc::clone(device))),
    );
}

/// Settles every ready wait, oldest first: wgpu-core fills a `mapAsync()` slot before a later `onSubmittedWorkDone()` one.
fn deliver(device: &DeviceRef, failed: bool, cx: &JsThread<'_>) -> JsResult<()> {
    let waits = &device.waits;
    // Read before the scan: the next poller sees a slot filled after this as a change and returns at once.
    let accounted = waits.filled.load(Ordering::Acquire);
    let ready: Vec<Box<dyn Pending>> = waits.pending.with_mut(|pending| {
        if failed {
            return core::mem::take(pending);
        }
        pending.extract_if(.., |entry| entry.is_ready()).collect()
    });
    waits.delivered.set(accounted);
    let vm = cx.vm();
    let mut result = Ok(());
    for entry in ready {
        let context = entry.context();
        // Checked per wait: settling an earlier one runs script, which can dispose the `Bun.ModuleGraph` of this one.
        let settled = if vm.is_context_live(context) {
            let _scope = vm.enter_context(context);
            entry.settle(&cx.global().js_thread(vm.context_of(context)))
        } else {
            entry.abandon(cx)
        };
        if result.is_ok() {
            result = settled;
        }
    }
    // Last: resolving `lost` can run script (a `then` getter on Object.prototype).
    let delivered = device.deliver_loss(cx.global());
    result.and(delivered)
}

struct Poller;

/// Shared with the thread that takes a long wait over from the pool.
struct PollShared {
    device: Arc<bun_webgpu::Device>,
    filled: Arc<AtomicUsize>,
    /// The poller runs until `filled` differs from this.
    seen: usize,
    /// A lost device fails every poll and answers nothing more: every pending wait settles then.
    failed: AtomicBool,
    cancelled: AtomicBool,
}

impl PollShared {
    /// Polls until a slot fills, the job is cancelled, or `budget` runs out. `true`: the job can complete.
    fn poll(&self, done: &Completion<Poller>, budget: Option<Duration>) -> bool {
        let start = Instant::now();
        loop {
            if self.filled.load(Ordering::Acquire) != self.seen
                || self.cancelled.load(Ordering::Acquire)
                || done.ticket().cancelled()
            {
                return true;
            }
            if !self.device.poll() {
                self.failed.store(true, Ordering::Release);
                return true;
            }
            if self.filled.load(Ordering::Acquire) != self.seen {
                return true;
            }
            if budget.is_some_and(|budget| start.elapsed() >= budget) {
                return false;
            }
            // An eighth of the time waited so far: short work is noticed fast, long work costs few wakeups.
            std::thread::sleep((start.elapsed() / 8).clamp(MIN_PAUSE, MAX_PAUSE));
        }
    }
}

/// A wait that outlasted [`POOL_BUDGET`], on its way to the device's own thread.
type LongWait = (Arc<PollShared>, Completion<Poller>);

/// The way to that thread, which starts with the first such wait and ends when the device's [`Waits`] and its poller jobs are gone.
type LongWaits = Arc<Guarded<Option<Sender<LongWait>>>>;

/// The way to the device's own thread, which this starts if there is none yet. `None` if it cannot start.
fn long_wait_thread(long_waits: &LongWaits) -> Option<Sender<LongWait>> {
    let mut sender = long_waits.lock();
    if sender.is_none() {
        let (to_thread, waits) = mpsc::channel::<LongWait>();
        // SAFETY: all the thread ever holds is what a job sends it: the job's `Completion`, which carries the VM's `Ticket` until `finish()` has posted the job, and a `PollShared`, which is no VM's state.
        std::thread::Builder::new()
            .name(String::from("bun-webgpu-poll"))
            .spawn(move || {
                while let Ok((shared, done)) = waits.recv() {
                    shared.poll(&done, None);
                    done.finish();
                }
            })
            .ok()?;
        *sender = Some(to_thread);
    }
    sender.clone()
}

struct PollOff {
    shared: Arc<PollShared>,
    long_waits: LongWaits,
}

/// The device a poller serves. Dropped without `then` (the VM is stopping), it releases the device's waits.
struct PollJs(Option<DeviceRef>);

// SAFETY: an `Rc` that is created, used and dropped on the JS thread only, which is where a job's `Js` half lives.
unsafe impl JsAffine for PollJs {}

impl Drop for PollJs {
    fn drop(&mut self) {
        if let Some(device) = self.0.take() {
            device.waits.polling.set(false);
            device.waits.poller.set(None);
            drop(device.waits.pending.take());
        }
    }
}

impl JobContext for Poller {
    type OffThread = PollOff;
    type Js = PollJs;

    const CANCELLABLE: bool = true;

    fn run(off: &mut Self::OffThread, done: Completion<Self>) -> Option<Completion<Self>> {
        if off.shared.poll(&done, Some(POOL_BUDGET)) {
            return Some(done);
        }
        // A long wait leaves the pool, which every other async job of the process shares.
        let sent = match long_wait_thread(&off.long_waits) {
            Some(to_thread) => to_thread.send((Arc::clone(&off.shared), done)),
            None => Err(mpsc::SendError((Arc::clone(&off.shared), done))),
        };
        // Once sent, the JS thread can free the job at any moment, so `off` is not touched again.
        let mpsc::SendError((shared, done)) = sent.err()?;
        shared.poll(&done, None);
        Some(done)
    }

    fn then(off: Self::OffThread, mut js: Self::Js, cx: &JsThread<'_>) -> JsResult<()> {
        let Some(device) = js.0.take() else {
            return Ok(());
        };
        device.waits.polling.set(false);
        device.waits.poller.set(None);
        let result = deliver(&device, off.shared.failed.load(Ordering::Acquire), cx);
        start_poller(&device, cx);
        result
    }

    unsafe fn cancel(off: *mut Self::OffThread) {
        // SAFETY: `off` points at the live job's off-thread half. Its `Arc` is only ever read, here and in `run`, and the flag behind it is an atomic.
        let shared = unsafe { &(*off).shared };
        shared.cancelled.store(true, Ordering::Release);
    }
}

const MIN_PAUSE: Duration = Duration::from_micros(50);
const MAX_PAUSE: Duration = Duration::from_millis(4);
/// How long a wait may keep a pool thread before it moves to the device's own.
const POOL_BUDGET: Duration = Duration::from_millis(2);
