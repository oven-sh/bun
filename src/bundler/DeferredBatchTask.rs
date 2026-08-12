//! This task is run once all parse and resolve tasks have been complete
//! and we have deferred onLoad plugins that we need to resume.
//!
//! It enqueues a task to be run on the JS thread which resolves the promise
//! for every onLoad callback which called `.defer()`.

use crate::BundleV2;
use crate::bundle_v2::JSBundlerPlugin;
// Task is `(tag: u8, ptr: *mut ())` owned by bun_event_loop;
// runtime owns the match-loop. See PORTING.md §Dispatch.
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{Task, task_tag};
use core::ptr::NonNull;

/// Embedded in the pass as `BundleV2::drain_defer_task`.
#[derive(Default)]
pub struct DeferredBatchTask {
    /// `BundleV2::plugins`, copied by `schedule` for `run_on_js_thread`.
    plugins: Option<NonNull<JSBundlerPlugin>>,
}

impl bun_event_loop::Taskable for DeferredBatchTask {
    const TAG: bun_event_loop::TaskTag = task_tag::BundleV2DeferredBatchTask;
    /// Embedded in its `BundleV2`, which outlives the queue entry and owns
    /// everything the drain would have touched; nothing to free.
    unsafe fn release_unrun(_: *mut Self) {}
}

impl DeferredBatchTask {
    /// Bundle thread.
    pub(crate) fn schedule(bv2: &mut BundleV2<'_>) {
        bv2.drain_defer_task.plugins = bv2.plugins;
        let task = ConcurrentTask::create(Task::init(std::ptr::from_mut::<Self>(
            &mut bv2.drain_defer_task,
        )));
        bv2.enqueue_on_js_loop_for_plugins(task);
    }

    /// Plugins' JS thread.
    pub fn run_on_js_thread(&self) {
        JSBundlerPlugin::opaque_mut(self.plugins.expect("plugins").as_ptr()).drain_deferred();
    }
}
