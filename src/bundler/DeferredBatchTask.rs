//! This task is run once all parse and resolve tasks have been complete
//! and we have deferred onLoad plugins that we need to resume.
//!
//! It enqueues a task to be run on the JS thread which resolves the promise
//! for every onLoad callback which called `.defer()`.

use core::mem::offset_of;

use crate::BundleV2;
// CYCLEBREAK hot-dispatch: Task is `(tag: u8, ptr: *mut ())` owned by bun_event_loop;
// runtime owns the match-loop. See PORTING.md §Dispatch.
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{Task, task_tag};

pub use bun_js_parser::Ref;
pub use bun_js_parser::Index;

#[derive(Default)]
pub struct DeferredBatchTask {
    // Zig: `running: if (Environment.isDebug) bool else u0` — zero-sized in release.
    #[cfg(debug_assertions)]
    running: bool,
}

impl DeferredBatchTask {
    pub fn init(&mut self) {
        // PORT NOTE: kept as `&mut self` (not `-> Self`) — this struct is embedded
        // by value in BundleV2 (recovered via container_of in `get_bundle_v2`), so
        // it is reset in place, never separately constructed.
        #[cfg(debug_assertions)]
        debug_assert!(!self.running);
        *self = Self::default();
    }

    pub fn get_bundle_v2(&mut self) -> &mut BundleV2<'static> {
        // SAFETY: `self` is always the `drain_defer_task` field of a live `BundleV2`;
        // this struct is never instantiated standalone. Lifetime erased to 'static
        // (mirrors Zig raw `*BundleV2`); callers must not outlive the owning bundle.
        unsafe {
            &mut *(self as *mut Self)
                .cast::<u8>()
                .sub(offset_of!(BundleV2<'static>, drain_defer_task))
                .cast::<BundleV2<'static>>()
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
            self as *mut Self as *mut (),
        ));
        
        {
            self.get_bundle_v2()
                .js_loop_for_plugins()
                .enqueue_task_concurrent(task);
        }
        // TODO(b2-blocked): crate::bundle_v2::BundleV2::js_loop_for_plugins — bundle_v2
        // module is still gated.
        let _ = task;
    }

    pub fn run_on_js_thread(&mut self) {
        // PORT NOTE: reshaped for borrowck — Zig's `defer this.deinit()` only resets
        // the debug `running` flag; since nothing follows `drainDeferred`, ignoring
        // its error and resetting the flag afterwards is equivalent on both paths.
        
        {
            let bv2 = self.get_bundle_v2();
            let rejected = match &bv2.completion {
                // TODO(port): exact tag check — Zig is `completion.result == .err`.
                Some(completion) => completion.result.is_err(),
                None => false,
            };
            let _ = bv2
                .plugins
                .as_mut()
                .expect("plugins")
                .drain_deferred(rejected);
        }
        // TODO(b2-blocked): crate::bundle_v2::BundleV2 fields (`completion`, `plugins`)
        // — bundle_v2 module is still gated.
        self.deinit();
    }

    // PORT NOTE: not `impl Drop` — this struct is an intrusive field of `BundleV2`
    // and `deinit` is a debug-flag reset, not resource teardown.
    fn deinit(&mut self) {
        #[cfg(debug_assertions)]
        {
            self.running = false;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/DeferredBatchTask.zig (52 lines)
//   confidence: medium
//   todos:      2
//   notes:      intrusive container_of into BundleV2.drain_defer_task; Task::init signature and completion.result tag check need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
