//! This task is run once all parse and resolve tasks have been complete
//! and we have deferred onLoad plugins that we need to resume.
//!
//! It enqueues a task to be run on the JS thread which resolves the promise
//! for every onLoad callback which called `.defer()`.

use core::mem::offset_of;

use crate::bundle_v2::JSBundlerPlugin;
use crate::BundleV2;
// CYCLEBREAK hot-dispatch: Task is `(tag: u8, ptr: *mut ())` owned by bun_event_loop;
// runtime owns the match-loop. See PORTING.md §Dispatch.
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{Task, task_tag};

pub use bun_js_parser::Ref;
pub use bun_js_parser::Index;

/// Re-export for callers that previously named
/// `crate::DeferredBatchTask::CompletionDispatch` — the struct now lives in
/// `bundle_v2::dispatch` alongside the other §Dispatch vtables.
pub use crate::bundle_v2::dispatch::CompletionDispatch;

// ──────────────────────────────────────────────────────────────────────────
// CYCLEBREAK FORWARD_DECL bridge: `JSBundlerPlugin` is an extern C++ type;
// `drainDeferred` has a real C++ entry point so we go straight to FFI.
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    // src/jsc/bindings/JSBundlerPlugin.cpp: `JSBundlerPlugin__drainDeferred`.
    // Zig wraps this in `fromJSHostCallGeneric` for exception-scope tracking;
    // the only caller (`runOnJSThread` below) is `catch return`, so the void
    // FFI call is the observable behaviour.
    fn JSBundlerPlugin__drainDeferred(this: *mut JSBundlerPlugin, rejected: bool);
}

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

        // Zig: `getBundleV2().jsLoopForPlugins().enqueueTaskConcurrent(task)`.
        self.get_bundle_v2().enqueue_on_js_loop_for_plugins(task);
    }

    pub fn run_on_js_thread(&mut self) {
        // PORT NOTE: reshaped for borrowck — Zig's `defer this.deinit()` only resets
        // the debug `running` flag; since nothing follows `drainDeferred`, ignoring
        // its error and resetting the flag afterwards is equivalent on both paths.
        {
            let bv2 = self.get_bundle_v2();
            // Zig: `if (bv2.completion) |c| c.result == .err else false`
            let rejected = bv2
                .completion
                .map(|c| c.result_is_err())
                .unwrap_or(false);
            // Zig: `bv2.plugins.?.drainDeferred(rejected) catch return;`
            let plugins = bv2.plugins.expect("plugins");
            // SAFETY: `plugins` is a live opaque C++ BunPlugin; FFI signature
            // matches `JSBundlerPlugin__drainDeferred`. `catch return` collapses
            // to discarding the void result.
            unsafe { JSBundlerPlugin__drainDeferred(plugins.as_ptr(), rejected) };
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
//   todos:      0
//   notes:      intrusive container_of into BundleV2.drain_defer_task; jsLoopForPlugins routed via dispatch::CompletionHandle (CYCLEBREAK §Dispatch — T6 owns JSBundleCompletionTask layout)
// ──────────────────────────────────────────────────────────────────────────
