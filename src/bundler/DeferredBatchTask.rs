//! Once every other parse/resolve of a pass is done while some onLoad plugins have called `.defer()`, this
//! hops to the plugins' (JS) thread and resolves those `.defer()` promises so the plugins resume; then it
//! comes back. It is embedded in its `BundleV2` and counts as one of the pass's pending items while it is
//! out, so the pass cannot finish and be freed under it (a plugin may answer a deferred load without
//! awaiting `.defer()`, so nothing else orders the pass's completion after this hop).

use std::sync::Arc;

use crate::BundleV2;
use crate::bundle_v2::{Inbox, Incoming, JSBundlerPlugin};
use crate::dispatch::CompletionHandle;
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::Task;

/// What the hop needs on the JS thread; set by [`DeferredBatchTask::schedule`].
struct Hop<'a> {
    completion: Option<CompletionHandle>,
    plugins: bun_ptr::BackRef<JSBundlerPlugin>,
    /// Where the hop reports back to.
    inbox: Arc<Inbox<'a>>,
}

#[derive(Default)]
pub struct DeferredBatchTask<'a> {
    hop: Option<Hop<'a>>,
}

bun_event_loop::taskable_by_ref! {
    /// The plugins' VM released the hop unrun (it is shutting down; its stop phase has answered what the
    /// plugins held): nothing to resolve, but the pass is waiting for the hop to come back.
    ['a] DeferredBatchTask<'a>, BundleV2DeferredBatchTask, |this| this.come_back()
}

impl<'a> DeferredBatchTask<'a> {
    /// Bundle thread. The caller has counted the hop as a pending item (`BundleV2::drain_deferred_tasks`).
    pub(crate) fn schedule(bv2: &mut BundleV2<'a>) {
        debug_assert!(bv2.shared.plugins.is_some());
        bv2.drain_defer_task.hop = Some(Hop {
            completion: bv2.completion,
            plugins: bv2.shared.plugins.expect("plugins"),
            inbox: Arc::clone(&bv2.shared.inbox),
        });
        let task =
            ConcurrentTask::create(Task::init(std::ptr::from_mut(&mut bv2.drain_defer_task)));
        BundleV2::enqueue_on_js_loop_for_plugins(bv2.completion, &bv2.event_loop, task);
    }

    /// Plugins' (JS) thread.
    pub fn run_on_js_thread(&mut self) {
        {
            let hop = self.hop.as_ref().expect("scheduled");
            // A cancelled pass rejects the `.defer()` promises rather than resuming plugins into it.
            // (The completion's flag, not `graph.cancelled`: that one is the bundle thread's.)
            let rejected = hop.completion.as_ref().is_some_and(|c| c.is_cancelled());
            hop.plugins.drain_deferred(rejected);
        }
        self.come_back();
    }

    /// Plugins' (JS) thread → bundle thread: the hop's pending item is consumed there.
    fn come_back(&mut self) {
        let hop = self.hop.take().expect("scheduled");
        hop.inbox.push(Incoming::DeferredBatchRan);
    }
}
