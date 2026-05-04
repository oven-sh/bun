//! This task is run once all parse and resolve tasks have been complete
//! and we have deferred onLoad plugins that we need to resume.
//!
//! It enqueues a task to be run on the JS thread which resolves the promise
//! for every onLoad callback which called `.defer()`.

use core::mem::offset_of;

use crate::BundleV2;
use bun_jsc::{ConcurrentTask, Task};

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

    pub fn get_bundle_v2(&mut self) -> &mut BundleV2 {
        // SAFETY: `self` is always the `drain_defer_task` field of a live `BundleV2`;
        // this struct is never instantiated standalone.
        unsafe {
            &mut *(self as *mut Self as *mut u8)
                .sub(offset_of!(BundleV2, drain_defer_task))
                .cast::<BundleV2>()
        }
    }

    pub fn schedule(&mut self) {
        #[cfg(debug_assertions)]
        {
            debug_assert!(!self.running);
            self.running = false;
        }
        // TODO(port): `Task::init(*mut DeferredBatchTask)` — Task is a tagged-pointer
        // union over task payloads; verify the Rust constructor signature in Phase B.
        let task = ConcurrentTask::create(Task::init(self as *mut Self));
        self.get_bundle_v2()
            .js_loop_for_plugins()
            .enqueue_task_concurrent(task);
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
