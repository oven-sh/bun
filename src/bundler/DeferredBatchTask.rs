//! Once every other parse/resolve of a pass is done while some onLoad plugins have called `.defer()`, this
//! hops to the plugins' (JS) thread and resolves those `.defer()` promises so the plugins resume; then it
//! comes back. It is embedded in its `BundleV2` and counts as one of the pass's pending items while it is
//! out, so the pass cannot finish and be freed under it (a plugin may answer a deferred load without
//! awaiting `.defer()`, so nothing else orders the pass's completion after this hop).
//!
//! A pass that is discarded makes the same hop for a second reason: see `schedule_release`.

use crate::BundleV2;
// Task is `(tag: u8, ptr: *mut ())` owned by bun_event_loop;
// runtime owns the match-loop. See PORTING.md §Dispatch.
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{Task, task_tag};

#[derive(Default)]
pub struct DeferredBatchTask {
    /// Intrusive node for the trip back to the bundle thread's Mini loop.
    returned: bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext,
    /// Bundle thread only. The hop is out: scheduled and not back. One node makes the trip back, so a
    /// second hop waits for the first.
    out: bool,
    /// Bundle thread only. `schedule_release` was called while the hop was out.
    release_when_back: bool,
    /// The pass is discarded (`BundleV2::restart_for_bun_target`): on the plugins' thread the hop also
    /// makes the plugins give back every request they hold, and it rejects the `.defer()` promises.
    /// The bundle thread writes it while no hop is out, and the plugins' thread reads it in the hop.
    release_held_requests: bool,
}

impl bun_event_loop::Taskable for DeferredBatchTask {
    const TAG: bun_event_loop::TaskTag = task_tag::BundleV2DeferredBatchTask;
    /// The plugins' VM released the hop unrun (it is shutting down; its stop phase has answered what the
    /// plugins held): nothing to resolve, but the pass is waiting for the hop to come back.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: released ⇒ never ran; `BundleV2` is alive until this comes back.
        unsafe { (*this).come_back() };
    }
    /// A step of the bundle, which is waiting for it to come back: what the build reports is its
    /// completion's to decide.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl DeferredBatchTask {
    pub(crate) fn get_bundle_v2(&mut self) -> &mut BundleV2<'static> {
        // SAFETY: self points to the `drain_defer_task` field embedded in a BundleV2.
        unsafe {
            &mut *bun_core::from_field_ptr!(
                BundleV2<'static>,
                drain_defer_task,
                std::ptr::from_mut::<Self>(self)
            )
        }
    }

    /// Bundle thread. For a pass that is discarded: the hop makes the plugins give back what they
    /// hold. It counts itself as a pending item.
    pub(crate) fn schedule_release(&mut self) {
        if self.out {
            self.release_when_back = true;
            return;
        }
        self.release_held_requests = true;
        self.get_bundle_v2().graph.pending_items += 1;
        self.schedule();
    }

    /// Bundle thread. The caller has counted the hop as a pending item (`Graph::drain_deferred_tasks`).
    pub(crate) fn schedule(&mut self) {
        debug_assert!(!self.out);
        self.out = true;
        let task = ConcurrentTask::create(Task::init(std::ptr::from_mut::<Self>(self)));
        self.get_bundle_v2().enqueue_on_js_loop_for_plugins(task);
    }

    /// Plugins' (JS) thread.
    pub fn run_on_js_thread(&mut self) {
        let release_held_requests = self.release_held_requests;
        {
            let bv2 = self.get_bundle_v2();
            // A cancelled or discarded pass rejects the `.defer()` promises rather than resuming
            // plugins into it. (The completion's flag, not `graph.cancelled`: that one is the
            // bundle thread's.)
            let rejected =
                release_held_requests || bv2.completion.as_ref().is_some_and(|c| c.is_cancelled());
            let plugins = bv2.plugins_mut().expect("plugins");
            if release_held_requests {
                plugins.release_held_requests();
            }
            plugins.drain_deferred(rejected);
        }
        self.come_back();
    }

    /// Plugins' (JS) thread → bundle thread: the hop's pending item is consumed there.
    fn come_back(&mut self) {
        let this: *mut Self = self;
        if let bun_event_loop::AnyEventLoop::Mini(mini) = self.get_bundle_v2().any_loop_mut() {
            // SAFETY: `returned` is this struct's own node; `BundleV2` (and so `self`) is alive until
            // the bundle thread runs this.
            unsafe {
                mini.enqueue_task_concurrent_with_extra_ctx::<Self, BundleV2<'static>>(
                    this,
                    |this, _| (*this).on_back(),
                    core::mem::offset_of!(Self, returned),
                );
            }
            return;
        }
        // bake: the plugins run on the loop that runs the bundle; already there.
        self.on_back();
    }

    /// Bundle thread. The hop is back.
    fn on_back(&mut self) {
        self.out = false;
        if core::mem::take(&mut self.release_when_back) {
            self.schedule_release();
        }
        self.get_bundle_v2().decrement_scan_counter();
    }
}
