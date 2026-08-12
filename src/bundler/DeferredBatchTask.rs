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

/// One per drain, allocated from the pass's arena like `Resolve` / `Load`.
pub struct DeferredBatchTask {
    /// `BundleV2::plugins` as of `schedule`.
    plugins: Option<NonNull<JSBundlerPlugin>>,
}

impl bun_event_loop::Taskable for DeferredBatchTask {
    const TAG: bun_event_loop::TaskTag = task_tag::BundleV2DeferredBatchTask;
    /// As `Resolve`: arena-owned by its (cancelled) bundle pass; nothing to free.
    unsafe fn release_unrun(_: *mut Self) {}
}

impl DeferredBatchTask {
    /// Bundle thread.
    pub(crate) fn schedule(bv2: &mut BundleV2<'_>) {
        let this = bv2.arena().alloc(Self {
            plugins: bv2.plugins,
        });
        let task = ConcurrentTask::create(Task::init(std::ptr::from_mut::<Self>(this)));
        bv2.enqueue_on_js_loop_for_plugins(task);
    }

    /// Plugins' JS thread.
    pub fn run_on_js_thread(&self) {
        JSBundlerPlugin::opaque_mut(self.plugins.expect("plugins").as_ptr()).drain_deferred();
    }
}
