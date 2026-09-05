//! Once every other parse/resolve of a pass is done while some onLoad plugins have called `.defer()`, this
//! hops to the plugins' (JS) thread and resolves those `.defer()` promises so the plugins resume; then it
//! comes back. It is embedded in its `BundleV2` and counts as one of the pass's pending items while it is
//! out, so the pass cannot finish and be freed under it (a plugin may answer a deferred load without
//! awaiting `.defer()`, so nothing else orders the pass's completion after this hop).

use crate::BundleV2;
// Task is `(tag: u8, ptr: *mut ())` owned by bun_event_loop;
// runtime owns the match-loop. See PORTING.md §Dispatch.
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{Task, task_tag};

#[derive(Default)]
pub struct DeferredBatchTask {
    /// Mini-loop queue node for `crate::post` (see `post::Event::NODE`): the trip back to the
    /// bundle thread (`DeferredBatchReturned`).
    returned: bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext,
}

impl bun_event_loop::Taskable for DeferredBatchTask {
    const TAG: bun_event_loop::TaskTag = task_tag::BundleV2DeferredBatchTask;
    /// The plugins' VM released the hop unrun (it is shutting down; its stop phase has answered what the
    /// plugins held): nothing to resolve, but the pass is waiting for the hop to come back.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: released ⇒ never ran; `BundleV2` is alive until this comes back.
        unsafe { (*this).come_back() };
    }
}

impl DeferredBatchTask {
    pub(crate) fn get_bundle_v2(&mut self) -> &mut BundleV2<'static> {
        // SAFETY: self points to the `drain_defer_task` field embedded in a BundleV2.
        unsafe { &mut *Self::bundle_v2_ptr(self) }
    }

    /// # Safety
    /// `this` points at the `drain_defer_task` field of a live `BundleV2`.
    unsafe fn bundle_v2_ptr(this: *mut Self) -> *mut BundleV2<'static> {
        // SAFETY: caller contract; `from_field_ptr!` only offsets the pointer.
        unsafe { bun_core::from_field_ptr!(BundleV2<'static>, drain_defer_task, this) }
    }

    /// Bundle thread. The caller has counted the hop as a pending item (`Graph::drain_deferred_tasks`).
    pub(crate) fn schedule(&mut self) {
        let task = ConcurrentTask::create(Task::init(std::ptr::from_mut::<Self>(self)));
        self.get_bundle_v2().enqueue_on_js_loop_for_plugins(task);
    }

    /// Plugins' (JS) thread.
    pub fn run_on_js_thread(&mut self) {
        {
            let bv2 = self.get_bundle_v2();
            // A cancelled pass rejects the `.defer()` promises rather than resuming plugins into it.
            // (The completion's flag, not `graph.cancelled`: that one is the bundle thread's.)
            let rejected = bv2.completion.as_ref().is_some_and(|c| c.is_cancelled());
            bv2.plugins_mut().expect("plugins").drain_deferred(rejected);
        }
        self.come_back();
    }

    /// Plugins' (JS) thread → bundle thread: the hop's pending item is consumed there.
    fn come_back(&mut self) {
        // SAFETY: `self` is a field of its `BundleV2`, which is alive until the bundle thread has
        // consumed this (the hop is one of the pass's pending items).
        unsafe { crate::post::post::<DeferredBatchReturned>(self) };
    }
}

/// The `.defer()` hop is back from the plugins' thread: the pass's pending item for it is consumed.
pub(crate) struct DeferredBatchReturned;

impl crate::post::Event for DeferredBatchReturned {
    type Item = DeferredBatchTask;
    const NODE: usize = core::mem::offset_of!(DeferredBatchTask, returned);

    unsafe fn bundle(task: *mut DeferredBatchTask) -> *mut BundleV2<'static> {
        // SAFETY: caller contract.
        unsafe { DeferredBatchTask::bundle_v2_ptr(task) }
    }

    unsafe fn run(_: *mut DeferredBatchTask, bv2: &mut BundleV2<'static>) {
        bv2.decrement_scan_counter();
    }

    /// Only on a bundle that runs on the plugins' own loop (bake), whose VM has closed its queue: the
    /// hop is already on the bundle thread, so the pass's bookkeeping happens here.
    unsafe fn refused(task: *mut DeferredBatchTask) {
        // SAFETY: the posting thread is the bundle thread (see above), and it holds no other
        // `&mut BundleV2` while a task is running.
        unsafe { (*Self::bundle(task)).decrement_scan_counter() };
    }
}
