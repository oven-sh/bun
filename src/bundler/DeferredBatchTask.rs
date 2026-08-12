//! This task is run once all parse and resolve tasks have been complete
//! and we have deferred onLoad plugins that we need to resume.
//!
//! It enqueues a task to be run on the JS thread which resolves the promise
//! for every onLoad callback which called `.defer()`.

use crate::BundleV2;
// Task is `(tag: u8, ptr: *mut ())` owned by bun_event_loop;
// runtime owns the match-loop. See PORTING.md §Dispatch.
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{Task, task_tag};

#[derive(Default)]
pub struct DeferredBatchTask {
    // Debug-only flag; zero-sized in release.
    #[cfg(debug_assertions)]
    running: bool,
}

impl bun_event_loop::Taskable for DeferredBatchTask {
    const TAG: bun_event_loop::TaskTag = task_tag::BundleV2DeferredBatchTask;
    /// Embedded in its `BundleV2`, which outlives the queue entry and owns
    /// everything the drain would have touched; nothing to free.
    unsafe fn release_unrun(_: *mut Self) {}
}

impl DeferredBatchTask {
    /// Bundle thread: post `bv2.drain_defer_task` (the one instance of this
    /// type a pass has) to the plugins' thread.
    pub(crate) fn schedule(bv2: &mut BundleV2<'_>) {
        let this = &mut bv2.drain_defer_task;
        #[cfg(debug_assertions)]
        {
            debug_assert!(!this.running);
            this.running = false;
        }
        let task = ConcurrentTask::create(Task::init(std::ptr::from_mut::<Self>(this)));

        bv2.enqueue_on_js_loop_for_plugins(task);
    }

    /// Plugins' JS thread. For `Bun.build` the pass this task is embedded in
    /// is being driven by the bundle thread meanwhile, so it is only reached
    /// through a raw pointer, for two fields fixed before the pass started;
    /// see `BundleV2::plugins_on_js_thread`.
    pub fn run_on_js_thread(&mut self) {
        // SAFETY: `self` is the `drain_defer_task` field of a `BundleV2`
        // (`schedule` is the only way to post it), and that pass is live: it is
        // waiting on the loads whose `.defer()` promises this settles
        // (`Graph::drain_deferred_tasks` moved their units back into
        // `pending_items` before posting this). `completion` is `Copy` and set
        // before the pass started, so reading it through the pointer races with
        // nothing; the completion task it points at lives on this thread.
        // `plugins` is set, or `enqueue_on_js_loop_for_plugins` would not have
        // posted this.
        unsafe {
            let bv2 = bun_core::from_field_ptr!(
                BundleV2<'static>,
                drain_defer_task,
                std::ptr::from_mut::<Self>(self)
            );
            let rejected = (*bv2).completion.is_some_and(|c| c.result_is_err());
            // The void result is discarded — see
            // `Plugin::drain_deferred` for the exception-scope note.
            BundleV2::plugins_on_js_thread(bv2).drain_deferred(rejected);
        }
        self.deinit();
    }

    // Not `impl Drop` — this struct is an intrusive field of `BundleV2`
    // and `deinit` is a debug-flag reset, not resource teardown.
    fn deinit(&mut self) {
        #[cfg(debug_assertions)]
        {
            self.running = false;
        }
    }
}
