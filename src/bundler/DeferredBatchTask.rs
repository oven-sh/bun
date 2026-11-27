//! Once every other parse/resolve of a pass is done while some onLoad plugins have called `.defer()`, this
//! hops to the plugins' (JS) thread and resolves those `.defer()` promises so the plugins resume; then it
//! comes back. It is embedded in its `BundleV2` and counts as one of the pass's pending items while it is
//! out, so the pass cannot finish and be freed under it (a plugin may answer a deferred load without
//! awaiting `.defer()`, so nothing else orders the pass's completion after this hop).

use core::cell::Cell;

use crate::BundleV2;
use bun_event_loop::task_tag;

#[derive(Default)]
pub(crate) struct DeferredBatchTask {
    /// Intrusive node for the trip back to the bundle thread's Mini loop.
    returned: bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext,
    /// Notified instead of the bundle's loop. `aot::plugins` sets it for each hop: its bundle ticks no loop.
    pub(crate) waiter: Cell<Option<core::ptr::NonNull<crate::aot::plugins::PluginWaiter>>>,
}

/// The bundle that waits for the hop to come back.
pub struct DeferredBatch(*mut BundleV2<'static>);

impl bun_event_loop::Taskable for DeferredBatch {
    const TAG: bun_event_loop::TaskTag = task_tag::BundleV2DeferredBatchTask;
    type Payload = Self;
    /// The plugins' VM released the hop unrun (it is shutting down; its stop phase has answered what the
    /// plugins held): nothing to resolve, but the pass is waiting for the hop to come back.
    fn release_unrun(batch: Self) {
        batch.come_back();
    }
    /// A step of the bundle, which is waiting for it to come back: what the build reports is its
    /// completion's to decide.
    fn context(_: &Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl DeferredBatch {
    /// SAFETY: `bv2` is not moved or dropped, and no other hop is scheduled, until this one has come back.
    pub(crate) unsafe fn schedule(bv2: &mut BundleV2<'_>) {
        let batch = Self(std::ptr::from_mut(bv2).cast());
        // Refused: the VM was torn down mid-bundle, the hop never runs.
        bv2.js_loop_for_plugins().post_task::<Self>(batch);
    }

    /// Plugins' (JS) thread.
    pub fn run_on_js_thread(self) {
        // SAFETY: `schedule`'s contract. Shared, because the bundle thread is at work meanwhile.
        let bv2 = unsafe { &*self.0 };
        // A cancelled pass rejects the promises. Not `graph.cancelled`: that flag is the bundle thread's.
        let rejected = bv2.completion.as_ref().is_some_and(|c| c.is_cancelled());
        bv2.plugins_ref().expect("plugins").drain_deferred(rejected);
        self.come_back();
    }

    /// Plugins' (JS) thread → bundle thread: the hop's pending item is consumed there.
    fn come_back(self) {
        // SAFETY: as in `run_on_js_thread`.
        let bv2 = unsafe { &*self.0 };
        if let Some(waiter) = bv2.drain_defer_task.waiter.take() {
            // SAFETY: `aot::plugins` frees the waiter only after it has waited for this answer.
            unsafe { waiter.as_ref() }.answer_drained();
            return;
        }
        // SAFETY: a JS loop is the bundle's thread, which uses no borrow of it across a tick. `returned`
        // is in no queue, and the bundle is alive until its thread has run it.
        unsafe {
            match bv2.any_loop() {
                // bake: the plugins run on the loop that runs the bundle; already there.
                bun_event_loop::AnyEventLoop::Js { .. } => (*self.0).decrement_scan_counter(),
                bun_event_loop::AnyEventLoop::Mini(mini) => {
                    mini.enqueue_task_concurrent_with_extra_ctx::<_, BundleV2<'static>>(
                        &raw mut (*self.0).drain_defer_task,
                        |_, bv2| (*bv2).decrement_scan_counter(),
                        core::mem::offset_of!(DeferredBatchTask, returned),
                    );
                }
            }
        }
    }
}
