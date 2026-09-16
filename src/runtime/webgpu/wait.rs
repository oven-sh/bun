//! Waiting for the GPU: wgpu-core fires callbacks only inside `device_poll`, so one pool [`Job`] per device polls.

use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use bun_jsc::job::JsAffine;
use bun_jsc::{Completion, Job, JobContext, JsCell, JsResult, JsThread};
use bun_threading::Guarded;

use super::device::DeviceRef;

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
}

trait Pending {
    fn is_ready(&self) -> bool;
    fn settle(self: Box<Self>, cx: &JsThread<'_>) -> JsResult<()>;
}

struct PendingWait<W: Waiter> {
    slot: Arc<Slot<W::Result>>,
    js: W::Js,
}

impl<W: Waiter> Pending for PendingWait<W> {
    fn is_ready(&self) -> bool {
        self.slot.is_filled()
    }

    fn settle(self: Box<Self>, cx: &JsThread<'_>) -> JsResult<()> {
        let PendingWait { slot, js } = *self;
        W::settle(slot.close(), js, cx)
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
    let entry: Box<dyn Pending> = Box::new(PendingWait::<W> { slot, js });
    device.waits.pending.with_mut(|pending| pending.push(entry));
    start_poller(device, cx);
}

fn start_poller(device: &DeviceRef, cx: &JsThread<'_>) {
    let waits = &device.waits;
    if waits.polling.get() || waits.pending.with_mut(|pending| pending.is_empty()) {
        return;
    }
    waits.polling.set(true);
    Job::<Poller>::schedule(
        cx,
        PollOff {
            device: Arc::clone(&device.raw),
            filled: Arc::clone(&waits.filled),
            seen: waits.delivered.get(),
            failed: false,
            cancelled: AtomicBool::new(false),
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
    let mut result = Ok(());
    for entry in ready {
        let settled = entry.settle(cx);
        if result.is_ok() {
            result = settled;
        }
    }
    result
}

struct Poller;

struct PollOff {
    device: Arc<bun_webgpu::Device>,
    filled: Arc<AtomicUsize>,
    /// The poller runs until `filled` differs from this.
    seen: usize,
    /// A lost device fails every poll and answers nothing more: every pending wait settles then.
    failed: bool,
    cancelled: AtomicBool,
}

/// The device a poller serves. Dropped without `then` (the VM is stopping), it releases the device's waits.
struct PollJs(Option<DeviceRef>);

// SAFETY: an `Rc` that is created, used and dropped on the JS thread only, which is where a job's `Js` half lives.
unsafe impl JsAffine for PollJs {}

impl Drop for PollJs {
    fn drop(&mut self) {
        if let Some(device) = self.0.take() {
            drop(device.waits.pending.take());
        }
    }
}

impl JobContext for Poller {
    type OffThread = PollOff;
    type Js = PollJs;

    const CANCELLABLE: bool = true;

    fn run(off: &mut Self::OffThread, done: Completion<Self>) -> Option<Completion<Self>> {
        let start = Instant::now();
        while off.filled.load(Ordering::Acquire) == off.seen
            && !off.cancelled.load(Ordering::Acquire)
            && !done.ticket().cancelled()
        {
            if !off.device.poll() {
                off.failed = true;
                break;
            }
            if off.filled.load(Ordering::Acquire) != off.seen {
                break;
            }
            // An eighth of the time waited so far: short work is noticed fast, long work costs few wakeups.
            let pause = (start.elapsed() / 8).clamp(MIN_PAUSE, MAX_PAUSE);
            std::thread::sleep(pause);
        }
        Some(done)
    }

    fn then(off: Self::OffThread, mut js: Self::Js, cx: &JsThread<'_>) -> JsResult<()> {
        let Some(device) = js.0.take() else {
            return Ok(());
        };
        device.waits.polling.set(false);
        let result = deliver(&device, off.failed, cx);
        start_poller(&device, cx);
        result
    }

    unsafe fn cancel(off: *mut Self::OffThread) {
        // SAFETY: `off` points at the live job's off-thread half; only its atomic is touched.
        unsafe { (*off).cancelled.store(true, Ordering::Release) };
    }
}

const MIN_PAUSE: Duration = Duration::from_micros(50);
const MAX_PAUSE: Duration = Duration::from_millis(4);
