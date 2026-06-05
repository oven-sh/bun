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

/// Re-export for callers that previously named
/// `crate::DeferredBatchTask::CompletionDispatch` — the struct now lives in
/// `bundle_v2::dispatch` alongside the other §Dispatch vtables.
pub use crate::bundle_v2::dispatch::CompletionDispatch;

#[derive(Default)]
pub struct DeferredBatchTask {
    // Debug-only flag; zero-sized in release.
    #[cfg(debug_assertions)]
    running: bool,
}

impl DeferredBatchTask {
    pub fn init(&mut self) {
        // Kept as `&mut self` (not `-> Self`) — this struct is embedded
        // by value in BundleV2 (recovered via container_of in `get_bundle_v2`), so
        // it is reset in place, never separately constructed.
        #[cfg(debug_assertions)]
        debug_assert!(!self.running);
        // No Drop / no owned fields — pure reset.
        let _ = core::mem::take(self);
    }

    pub fn get_bundle_v2(&mut self) -> &mut BundleV2<'static> {
        // SAFETY: `self` is always the `drain_defer_task` field of a live `BundleV2`;
        // this struct is never instantiated standalone. Lifetime erased to 'static;
        // callers must not outlive the owning bundle.
        unsafe {
            &mut *bun_core::from_field_ptr!(
                BundleV2<'static>,
                drain_defer_task,
                std::ptr::from_mut::<Self>(self)
            )
        }
    }

    pub fn schedule(&mut self) {
        #[cfg(debug_assertions)]
        {
            debug_assert!(!self.running);
            self.running = false;
        }
        // PORTING.md §Dispatch: tag+ptr, not TaggedPointer. Tag constant lives in
        // `bun_event_loop::task_tag::BundleV2DeferredBatchTask`.
        let task = ConcurrentTask::create(Task::new(
            task_tag::BundleV2DeferredBatchTask,
            std::ptr::from_mut::<Self>(self).cast::<()>(),
        ));

        self.get_bundle_v2().enqueue_on_js_loop_for_plugins(task);
    }

    pub fn run_on_js_thread(&mut self) {
        // `deinit` only resets
        // the debug `running` flag; nothing follows `drain_deferred`, so
        // resetting the flag afterwards covers both paths.
        {
            let bv2 = self.get_bundle_v2();
            let rejected = bv2.completion.map(|c| c.result_is_err()).unwrap_or(false);
            // The void result is discarded — see
            // `Plugin::drain_deferred` for the exception-scope note.
            bv2.plugins_mut().expect("plugins").drain_deferred(rejected);
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
