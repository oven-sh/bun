//! Events other threads deliver to the bundle thread: a worker finished a
//! parse, a plugin on the JS thread settled a resolve or a load or called
//! `defer()`, the `.defer()` hop came back from that thread. A bundle runs
//! either on the JS event loop of the VM that owns it (dev server) or on a
//! mini event loop of its own (`Bun.build`, `bun build`); the two loops queue
//! work differently. [`post`] is the only place that knows which loop a bundle
//! is on, so every event has exactly one handler, [`Event::run`], and cannot
//! behave differently depending on the loop.

use core::ptr::addr_of;

use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{AnyEventLoop, Posted};

use crate::bundle_v2::BundleV2;

pub trait Event {
    type Item;

    /// `offset_of!(Item, <field>)` of the item's `AnyTaskWithExtraContext`;
    /// the mini loop links the item into its queue through that field.
    const NODE: usize;

    /// # Safety
    /// `item` is live (it was, or is about to be, passed to [`post`]).
    unsafe fn bundle(item: *mut Self::Item) -> *mut BundleV2<'static>;

    /// Runs on the bundle thread. Owns `item` to whatever extent the event
    /// does: a parse result is freed here, a plugin `Load`/`Resolve` lives in
    /// the bundle's arena and is only borrowed.
    ///
    /// # Safety
    /// `item` was passed to [`post`] and has not been touched since.
    unsafe fn run(item: *mut Self::Item, bv2: &mut BundleV2<'static>);

    /// The VM whose loop runs the bundle is gone, so `run` never will.
    ///
    /// # Safety
    /// As for [`run`](Self::run).
    unsafe fn refused(_item: *mut Self::Item) {}
}

/// Queue `item` for `E::run` on the bundle thread. Callable from any thread.
///
/// # Safety
/// `item` must stay valid until `run` or `refused` has consumed it, and
/// `E::bundle(item)` must be the live `BundleV2` this bundle pass belongs to.
pub unsafe fn post<E: Event>(item: *mut E::Item) {
    // SAFETY: caller contract.
    let bv2 = unsafe { E::bundle(item) };
    // SAFETY: `linker.loop` and `js_poster` are written once in `BundleV2::init`
    // and never again, so they can be read from a worker or the JS thread while
    // the bundle thread is mutating the rest of `*bv2`; only those two fields
    // are touched, through raw pointers, so no reference to `*bv2` is formed.
    let any_loop = unsafe { *addr_of!((*bv2).linker.r#loop) }
        .expect("BundleV2.linker.loop must be set before work is posted to it");
    // SAFETY: `linker.loop` is a backref to the loop that owns this bundle pass
    // and outlives it. The bundle thread may be ticking it concurrently; both
    // arms below only push onto the loop's MPSC queue (the `Mini` arm also
    // writes the node inside `*item`, which the caller owns) and wake it.
    match unsafe { &mut *any_loop.as_ptr() } {
        AnyEventLoop::Js { .. } => {
            let task = ConcurrentTask::from_callback(item, run_on_js_loop::<E>);
            // SAFETY: see above.
            let poster = unsafe { &*addr_of!((*bv2).js_poster) }
                .as_ref()
                .expect("a bundle on a JS loop has a poster");
            if let Posted::Refused(task) = poster.post(task) {
                // SAFETY: `task` was created just above and never queued.
                unsafe { ConcurrentTask::release_refused(task) };
                // SAFETY: caller contract; `run` will not observe `item`.
                unsafe { E::refused(item) };
            }
        }
        AnyEventLoop::Mini(mini) => {
            // SAFETY: `E::NODE` is the item's task field (trait contract) and
            // the caller keeps `item` alive until it is dequeued.
            unsafe {
                mini.enqueue_task_concurrent_with_extra_ctx::<E::Item, BundleV2<'static>>(
                    item,
                    run_on_mini_loop::<E>,
                    E::NODE,
                );
            }
        }
    }
}

fn run_on_js_loop<E: Event>(item: *mut E::Item) -> bun_event_loop::JsResult<()> {
    // SAFETY: `post`'s contract; the bundle thread holds no other `&mut BundleV2`
    // while its loop is dispatching queued tasks.
    unsafe { E::run(item, &mut *E::bundle(item)) };
    Ok(())
}

fn run_on_mini_loop<E: Event>(item: *mut E::Item, bv2: *mut BundleV2<'static>) {
    // SAFETY: `post`'s contract.
    debug_assert!(core::ptr::eq(bv2, unsafe { E::bundle(item) }));
    // SAFETY: `post`'s contract; `bv2` is the bundle the mini loop is ticking for.
    unsafe { E::run(item, &mut *bv2) };
}
