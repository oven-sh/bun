//! This task is run once all parse and resolve tasks have been complete
//! and we have deferred onLoad plugins that we need to resume.
//!
//! It enqueues a task to be run on the JS thread which resolves the promise
//! for every onLoad callback which called `.defer()`.

use core::mem::offset_of;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicPtr, Ordering};

use crate::bundle_v2::{JSBundleCompletionTask, JSBundlerPlugin};
use crate::BundleV2;
// CYCLEBREAK hot-dispatch: Task is `(tag: u8, ptr: *mut ())` owned by bun_event_loop;
// runtime owns the match-loop. See PORTING.md §Dispatch.
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{Task, task_tag};

pub use bun_js_parser::Ref;
pub use bun_js_parser::Index;

// ──────────────────────────────────────────────────────────────────────────
// CYCLEBREAK FORWARD_DECL bridges (mirrors ParseTask.rs:69 pattern):
// `JSBundlerPlugin` / `JSBundleCompletionTask` are opaque `[u8; 0]` in
// `bundle_v2.rs`; concrete layouts live in T6 (`bun_runtime::api::JSBundler`
// / `bun_bundler_jsc`). `drainDeferred` has a real C++ entry point so we go
// straight to FFI. The two `JSBundleCompletionTask` field reads have no C++
// backing — T6 registers a tiny vtable at init so the bundler can read them
// without naming the concrete struct. PERF(port): was direct field access in
// Zig (`completion.result == .err`, `completion.jsc_event_loop`).
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    // src/jsc/bindings/JSBundlerPlugin.cpp: `JSBundlerPlugin__drainDeferred`.
    // Zig wraps this in `fromJSHostCallGeneric` for exception-scope tracking;
    // the only caller (`runOnJSThread` below) is `catch return`, so the void
    // FFI call is the observable behaviour.
    fn JSBundlerPlugin__drainDeferred(this: *mut JSBundlerPlugin, rejected: bool);
}

/// Registered by T6 (`bun_bundler_jsc`) at init.
pub static COMPLETION_DISPATCH: AtomicPtr<CompletionDispatch> =
    AtomicPtr::new(core::ptr::null_mut());
pub struct CompletionDispatch {
    /// Zig: `completion.result == .err`
    pub result_is_err: unsafe fn(NonNull<JSBundleCompletionTask>) -> bool,
    /// Zig: `completion.jsc_event_loop.enqueueTaskConcurrent(task)` — folds the
    /// field access + enqueue so the bundler needn't name `*jsc.EventLoop`.
    pub enqueue_task_concurrent:
        unsafe fn(NonNull<JSBundleCompletionTask>, *mut ConcurrentTask),
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
        // `jsLoopForPlugins` body inlined here (CYCLEBREAK GENUINE — `*jsc.EventLoop`
        // is a T6 type the bundler can't name).
        let bv2 = self.get_bundle_v2();
        debug_assert!(bv2.plugins.is_some());
        if let Some(completion) = bv2.completion {
            // From Bun.build — `completion.jsc_event_loop.enqueueTaskConcurrent(task)`.
            let vt = COMPLETION_DISPATCH.load(Ordering::Acquire);
            debug_assert!(!vt.is_null(), "COMPLETION_DISPATCH not registered by T6");
            // SAFETY: vtable registered by T6 at init; `completion` is a live non-null backref.
            unsafe { ((*vt).enqueue_task_concurrent)(NonNull::new_unchecked(completion), task) };
        } else {
            // Bake path: the bundle loop *is* the JS event loop (Zig's
            // `switch (this.loop().*) { .js => |l| l, .mini => @panic(...) }`).
            // The erased `EventLoop` here carries the JS-loop owner directly;
            // route through the registered `JsEventLoopVTable`. The `.mini`
            // panic in Zig collapses to the `expect` below — there is no
            // reachable mini-loop with plugins.
            let owner = bv2
                .r#loop()
                .expect("No JavaScript event loop for transpiler plugins to run on")
                .as_ptr();
            let vt = bun_event_loop::any_event_loop::JS_EVENT_LOOP_VTABLE
                .load(Ordering::Acquire);
            debug_assert!(!vt.is_null(), "JS_EVENT_LOOP_VTABLE not registered by T6");
            // SAFETY: `owner` is a live erased `*mut jsc::EventLoop`; vtable
            // contract per `bun_event_loop::JsEventLoopVTable`.
            unsafe { ((*vt).enqueue_task_concurrent)(owner, task) };
        }
    }

    pub fn run_on_js_thread(&mut self) {
        // PORT NOTE: reshaped for borrowck — Zig's `defer this.deinit()` only resets
        // the debug `running` flag; since nothing follows `drainDeferred`, ignoring
        // its error and resetting the flag afterwards is equivalent on both paths.
        {
            let bv2 = self.get_bundle_v2();
            // Zig: `if (bv2.completion) |c| c.result == .err else false`
            let rejected = match bv2.completion {
                Some(completion) => {
                    let vt = COMPLETION_DISPATCH.load(Ordering::Acquire);
                    debug_assert!(!vt.is_null(), "COMPLETION_DISPATCH not registered by T6");
                    // SAFETY: vtable registered by T6; `completion` is a live non-null backref.
                    unsafe { ((*vt).result_is_err)(NonNull::new_unchecked(completion)) }
                }
                None => false,
            };
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
//   notes:      intrusive container_of into BundleV2.drain_defer_task; jsLoopForPlugins inlined via COMPLETION_DISPATCH vtable (CYCLEBREAK — T6 owns JSBundleCompletionTask layout)
// ──────────────────────────────────────────────────────────────────────────
