//! The one place WebGPU work leaves the JS thread: waiting for the GPU.
//!
//! wgpu-core has no threads of its own. A `mapAsync` or `onSubmittedWorkDone`
//! callback only fires while some thread is inside `device_poll`, so each such
//! promise gets a [`Job`] whose pool half blocks in `device_poll` until the
//! callback has stored its result in the shared [`Slot`], and whose JS half
//! then settles the promise.

use std::marker::PhantomData;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use bun_jsc::job::JsAffine;
use bun_jsc::{Completion, Job, JobContext, JsResult, JsThread};
use bun_threading::Guarded;
use bun_webgpu::WaitOutcome;

/// Where a wgpu-core callback leaves its result for the job that waits on it.
pub(crate) struct Slot<R>(Guarded<Option<R>>);

impl<R> Slot<R> {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self(Guarded::new(None)))
    }
    pub(crate) fn fill(&self, value: R) {
        *self.0.lock() = Some(value);
    }
    pub(crate) fn take(&self) -> Option<R> {
        self.0.lock().take()
    }
    fn is_filled(&self) -> bool {
        self.0.lock().is_some()
    }
}

/// What to do on the JS thread once the callback has fired.
pub(crate) trait Waiter: 'static {
    type Result: Send + 'static;
    type Js: JsAffine;
    /// `result` is `None` only if the VM began to stop before the GPU answered.
    fn settle(result: Option<Self::Result>, js: Self::Js, cx: &JsThread<'_>) -> JsResult<()>;
}

pub(crate) struct WaitOff<R> {
    device: Arc<bun_webgpu::Device>,
    /// The queue submission the callback is waiting for.
    submission: bun_webgpu::wgc::SubmissionIndex,
    slot: Arc<Slot<R>>,
    cancelled: AtomicBool,
}

pub(crate) struct Wait<W: Waiter>(PhantomData<W>);

impl<W: Waiter> Wait<W> {
    pub(crate) fn schedule(
        cx: &JsThread<'_>,
        device: Arc<bun_webgpu::Device>,
        submission: bun_webgpu::wgc::SubmissionIndex,
        slot: Arc<Slot<W::Result>>,
        js: W::Js,
    ) {
        Job::<Self>::schedule(
            cx,
            WaitOff {
                device,
                submission,
                slot,
                cancelled: AtomicBool::new(false),
            },
            js,
        );
    }
}

impl<W: Waiter> JobContext for Wait<W> {
    type OffThread = WaitOff<W::Result>;
    type Js = W::Js;

    const CANCELLABLE: bool = true;

    fn run(off: &mut Self::OffThread, done: Completion<Self>) -> Option<Completion<Self>> {
        // Short waits: wgpu-core holds a device-wide read lock for the length of each one, which
        // `destroy()` on the JS thread has to get past, and a VM that is shutting down should not
        // be held up by a long-running shader.
        const SLICE: Duration = Duration::from_millis(8);
        let mut idle_rounds = 0u32;
        while !off.slot.is_filled()
            && !off.cancelled.load(Ordering::Acquire)
            && !done.ticket().cancelled()
        {
            match off.device.wait(off.submission, SLICE) {
                WaitOutcome::TimedOut => {}
                WaitOutcome::Finished => {
                    if !off.slot.is_filled() {
                        // The submission is done and the callback still has not fired. wgpu-core
                        // fires it on a later poll; yield instead of spinning until then.
                        idle_rounds = (idle_rounds + 1).min(5);
                        std::thread::sleep(Duration::from_millis(1 << idle_rounds));
                    }
                }
                WaitOutcome::Failed => {
                    // A lost device fails every wait. Its callbacks are fired with an error by
                    // one last poll; an empty slot after that settles as aborted.
                    off.device.poll();
                    break;
                }
            }
        }
        Some(done)
    }

    fn then(off: Self::OffThread, js: Self::Js, cx: &JsThread<'_>) -> JsResult<()> {
        W::settle(off.slot.take(), js, cx)
    }

    unsafe fn cancel(off: *mut Self::OffThread) {
        // SAFETY: `off` points at the live job's off-thread half; only its atomic is touched.
        unsafe { (*off).cancelled.store(true, Ordering::Release) };
    }
}
