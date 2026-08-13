//! Posted to the plugins' JS thread when the scan has nothing left to do but
//! the onLoad callbacks that called `.defer()`: the runtime's dispatch arm
//! resolves their promises (`JSBundlerPlugin__drainDeferred`) and frees this.
//!
//! It carries only the plugin handle. A plugin that answers without awaiting
//! its `.defer()` promise lets the pass finish, and free its `BundleV2`, while
//! this task is still queued, so nothing here may point back into the pass.
//! The handle itself outlives the task: `Bun.build` destroys it from the
//! completion task, which is posted to the same queue after this, and bake's
//! plugins live as long as the dev server.

use core::ptr::NonNull;

use crate::BundleV2;
use crate::bundle_v2::JSBundlerPlugin;
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{Task, task_tag};

pub struct DeferredBatchTask {
    plugins: NonNull<JSBundlerPlugin>,
}

impl bun_event_loop::Taskable for DeferredBatchTask {
    const TAG: bun_event_loop::TaskTag = task_tag::BundleV2DeferredBatchTask;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — `this` is the box `schedule` queued.
        unsafe { bun_core::heap::destroy(this) };
    }
}

impl DeferredBatchTask {
    /// Bundle thread (the loop that owns `bv2`).
    pub(crate) fn schedule(bv2: &mut BundleV2) {
        let plugins = bv2
            .plugins
            .expect("a load deferred, so the pass has plugins");
        let this = bun_core::heap::into_raw(Box::new(Self { plugins }));
        let task = ConcurrentTask::create(Task::init(this));
        if !bv2.enqueue_on_js_loop_for_plugins(task) {
            // SAFETY: refused ⇒ the queue never took `this`; nothing else points at it.
            unsafe { bun_core::heap::destroy(this) };
        }
    }

    /// JS thread, from the dispatch arm that owns the box.
    pub fn plugins(&self) -> &JSBundlerPlugin {
        // SAFETY: see the module doc — the handle is destroyed only after this
        // task has run or been released.
        unsafe { self.plugins.as_ref() }
    }
}
