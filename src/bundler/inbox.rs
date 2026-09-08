//! Everything worker threads and the plugin host's JS thread hand back to
//! the thread driving a [`BundleV2`](crate::BundleV2): parse results, plugin
//! answers, deferral notices. The bundle thread drains it
//! (`BundleV2::drain_inbox`); producers only need `&Inbox`.

use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use bun_threading::{Futex, Link, OwnedQueue};

use crate::DevServerHandle;
use crate::parse_task;

#[allow(clippy::large_enum_variant)] // queued boxed (`Event`) either way
pub(crate) enum Incoming<'a> {
    /// A `ParseTask` / `ServerComponentParseTask` finished.
    ParseTask(parse_task::Result<'a>),
    /// The plugin host answered `BundleV2::loads[id]`.
    Load(u32),
    /// `.defer()` was called for `BundleV2::loads[id]`.
    LoadDeferred(u32),
    /// The plugin host answered `BundleV2::resolves[id]`.
    Resolve(u32),
    /// The JS thread resolved every pending `.defer()` promise
    /// (`BundleV2::drain_defer_task`).
    DeferredBatchRan,
}

pub(crate) struct Event<'a> {
    next: Link<Event<'a>>,
    pub(crate) incoming: Incoming<'a>,
}

bun_threading::intrusive_linked!(['a] Event<'a>, next);

/// How the bundle thread learns there is something in its inbox.
pub enum Notify {
    /// The bundle thread blocks in [`Inbox::wait`] between drains (CLI,
    /// `Bun.build`'s bundle thread).
    Blocking(Doorbell),
    /// The bundle runs on a JS event loop: post it a task. With a dev server
    /// the task drains the inbox itself (the bundle is asynchronous);
    /// otherwise it only wakes the loop the bundle thread is ticking.
    Js {
        poster: bun_event_loop::JsPoster,
        /// Read back on the loop's thread by [`JsWake`]; revoked
        /// ([`Inbox::close`]) when the bundle is torn down, so a wake still
        /// queued on the loop after that is a no-op.
        dev_server: bun_threading::Guarded<Option<bun_threading::ThreadBound<DevServerHandle>>>,
        /// A wake is queued on the loop and has not run yet; pushes until
        /// then ride on it.
        posted: AtomicBool,
    },
}

impl Notify {
    pub fn blocking() -> Self {
        Notify::Blocking(Doorbell::default())
    }

    pub fn js(poster: bun_event_loop::JsPoster, dev_server: Option<DevServerHandle>) -> Self {
        Notify::Js {
            poster,
            dev_server: bun_threading::Guarded::new(
                dev_server.map(bun_threading::ThreadBound::new),
            ),
            posted: AtomicBool::new(false),
        }
    }

    fn notify(this: &Arc<Self>) {
        match &**this {
            Notify::Blocking(bell) => bell.ring(),
            Notify::Js { poster, posted, .. } => {
                if !posted.swap(true, Ordering::AcqRel) {
                    poster.post_boxed(Box::new(JsWake(Arc::clone(this))));
                }
            }
        }
    }
}

/// Posted to the JS loop that owns the bundle.
struct JsWake(Arc<Notify>);

impl bun_event_loop::ManagedTask::RunOnce for JsWake {
    fn run(self) -> bun_event_loop::JsResult<()> {
        if let Notify::Js {
            dev_server, posted, ..
        } = &*self.0
        {
            let dev = dev_server.lock().as_ref().map(|d| *d.get());
            match dev {
                // Cleared first: a push that lands mid-drain posts the next wake.
                Some(dev) => {
                    posted.swap(false, Ordering::AcqRel);
                    dev.drain_bundle_inbox();
                }
                // The bundle thread is ticking this loop (`wait_for_parse`)
                // and re-arms `posted` itself before each drain — or the
                // bundle is gone (`Inbox::close`).
                None => {}
            }
        }
        Ok(())
    }
}

/// Wakes one sleeping thread without losing a ring that lands between its
/// last look at its work and going to sleep: the sleeper takes a
/// [`ticket`](Self::ticket) *before* looking and sleeps on it after.
#[derive(Default)]
pub struct Doorbell {
    seq: AtomicU32,
}

impl Doorbell {
    /// Any thread.
    pub fn ring(&self) {
        self.seq.fetch_add(1, Ordering::Release);
        Futex::wake(&self.seq, u32::MAX);
    }

    /// The sleeping thread, before it checks for work.
    pub fn ticket(&self) -> u32 {
        self.seq.load(Ordering::Acquire)
    }

    /// The sleeping thread: returns once rung since `ticket` was taken
    /// (immediately if it already was).
    pub fn sleep(&self, ticket: u32) {
        while self.seq.load(Ordering::Acquire) == ticket {
            Futex::wait_forever(&self.seq, ticket);
        }
    }
}

pub struct Inbox<'a> {
    queue: OwnedQueue<Event<'a>>,
    /// Shared so a producer can still ring after the bundle thread has
    /// consumed its push and dropped the inbox (see [`push`](Self::push)),
    /// and so a queued [`JsWake`] keeps what it reads alive.
    notify: Arc<Notify>,
}

// SAFETY: an MPSC hand-off: producers only push (the queue is built for
// concurrent pushes), an `Event`'s payload is touched by the thread that built
// it and then only by the bundle thread that drains it, and `Notify` is
// atomics, a lock, and the loop's concurrent-task poster.
unsafe impl Send for Inbox<'_> {}
// SAFETY: as above.
unsafe impl Sync for Inbox<'_> {}

impl<'a> Inbox<'a> {
    pub fn new(notify: Notify) -> Self {
        Self {
            queue: OwnedQueue::new(),
            notify: Arc::new(notify),
        }
    }

    /// Any thread. Once the event is in the queue the bundle thread may
    /// consume it and free the bundle (and this inbox), so the wake goes
    /// through a handle taken beforehand.
    pub(crate) fn push(&self, incoming: Incoming<'a>) {
        let notify = Arc::clone(&self.notify);
        self.queue.push(Box::new(Event {
            next: Link::new(),
            incoming,
        }));
        Notify::notify(&notify);
    }

    /// Bundle thread: everything pushed so far, in order. The iterator owns
    /// the detached events; it does not borrow the inbox.
    pub(crate) fn drain(&self) -> bun_threading::unbounded_queue::OwnedDrain<Event<'a>> {
        self.queue.drain()
    }

    /// Bundle thread, before a drain it follows with a loop tick
    /// ([`Notify::Js`]): let the next push post a wake again.
    pub fn rearm(&self) {
        if let Notify::Js { posted, .. } = &*self.notify {
            posted.swap(false, Ordering::AcqRel);
        }
    }

    /// The bundle is being torn down: wakes still queued on the JS loop must
    /// not reach the dev server any more.
    pub fn close(&self) {
        if let Notify::Js { dev_server, .. } = &*self.notify {
            *dev_server.lock() = None;
        }
    }

    /// Bundle thread, [`Notify::Blocking`] only: take this before a drain and
    /// hand it to [`wait`](Self::wait) after, so a push that lands in between
    /// is not slept through.
    pub fn ticket(&self) -> u32 {
        match &*self.notify {
            Notify::Blocking(bell) => bell.ticket(),
            Notify::Js { .. } => 0,
        }
    }

    /// Bundle thread, [`Notify::Blocking`] only: sleep until the next push
    /// since `ticket`.
    pub fn wait(&self, ticket: u32) {
        match &*self.notify {
            Notify::Blocking(bell) => bell.sleep(ticket),
            Notify::Js { .. } => unreachable!("a JS-loop bundle ticks its loop instead"),
        }
    }

    pub fn is_blocking(&self) -> bool {
        matches!(&*self.notify, Notify::Blocking(_))
    }
}
