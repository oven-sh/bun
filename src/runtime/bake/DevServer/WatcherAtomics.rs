//! All code working with atomics to communicate watcher <-> DevServer is here.
//! It attempts to recycle as much memory as possible, since files are very
//! frequently updated (the whole point of HMR)

use core::sync::atomic::{AtomicU8, Ordering};

use crate::bake::dev_server::{DevServer, HotReloadEvent};
use bun_jsc as jsc;

pub struct WatcherAtomics {
    /// Only one event can run at any given time. We need three events because:
    ///
    /// * One event may be actively running on the dev server thread.
    /// * One event may be "pending", i.e., it was added by the watcher thread but not immediately
    ///   started because an event was already running.
    /// * One event must be available for the watcher thread to initialize and submit. If an event
    ///   is already pending, this new event will replace the pending one, and the pending one will
    ///   become available.
    pub events: [HotReloadEvent; 3],

    /// The next event to be run. If an event is already running, new events are stored in this
    /// field instead of scheduled directly, and will be run once the current event finishes.
    // TODO(port): Zig had `align(std.atomic.cache_line)` on this field; Rust cannot align
    // individual fields — wrap in a `#[repr(align(128))]` newtype in Phase B if false sharing
    // shows up in profiles.
    // PERF(port): cache-line padding — profile in Phase B
    pub next_event: AtomicU8,

    // Only the watcher thread uses these two fields. They are both indices into the `events` array,
    // and indicate which elements are in-use and not available for modification. Only two such events
    // can ever be in use at once, so we can always find a free event in the array of length 3.
    pub current_event: Option<u8>,
    pub pending_event: Option<u8>,

    // Debug fields to ensure methods are being called in the right order.
    #[cfg(debug_assertions)]
    pub dbg_watcher_event: Option<*mut HotReloadEvent>,
    #[cfg(debug_assertions)]
    pub dbg_server_event: Option<*mut HotReloadEvent>,
}

/// Stored in `next_event` (an `AtomicU8`). Modeled as a transparent newtype rather than a
/// `#[repr(u8)] enum` because Zig used an open enum (`_`) where any other value is an index
/// into the `events` array, and Rust enums cannot hold unlisted discriminants.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct NextEvent(pub u8);

impl NextEvent {
    /// An event is running, and no next event is pending.
    pub const WAITING: NextEvent = NextEvent(u8::MAX - 1);
    /// No event is running.
    pub const DONE: NextEvent = NextEvent(u8::MAX);
    // Any other value represents an index into the `events` array.
}

impl WatcherAtomics {
    pub fn init(dev: *mut DevServer) -> Self {
        Self {
            // PORT NOTE: reshaped for borrowck — Zig wrote `events = undefined` then looped
            // `event.* = .initEmpty(dev)`; Rust uses array::from_fn to construct in place.
            events: core::array::from_fn(|_| HotReloadEvent::init_empty(dev)),
            next_event: AtomicU8::new(NextEvent::DONE.0),
            current_event: None,
            pending_event: None,
            #[cfg(debug_assertions)]
            dbg_watcher_event: None,
            #[cfg(debug_assertions)]
            dbg_server_event: None,
        }
    }

    /// Atomically get a *HotReloadEvent that is not used by the DevServer thread
    /// Call `watcherRelease` when it is filled with files.
    ///
    /// Called from watcher thread.
    pub fn watcher_acquire_event(&mut self) -> *mut HotReloadEvent {
        let mut available = [true; 3];
        if let Some(i) = self.current_event {
            available[i as usize] = false;
        }
        if let Some(i) = self.pending_event {
            available[i as usize] = false;
        }

        let index = 'find: {
            for (i, &is_available) in available.iter().enumerate() {
                if is_available {
                    break 'find i;
                }
            }
            unreachable!()
        };
        let ev: *mut HotReloadEvent = &raw mut self.events[index];

        #[cfg(debug_assertions)]
        {
            debug_assert!(
                self.dbg_watcher_event.is_none(),
                "must call `watcherReleaseEvent` before calling `watcherAcquireEvent` again",
            );
            self.dbg_watcher_event = Some(ev);
        }

        // SAFETY: `ev` points into `self.events[index]`, which the watcher thread has exclusive
        // access to (it is neither `current_event` nor `pending_event`).
        let ev_ref = unsafe { &mut *ev };

        // Initialize the timer if it is empty.
        if ev_ref.is_empty() {
            // PORT NOTE: Zig's `std.time.Timer.start()` records a monotonic start time;
            // we capture `Instant::now()` here and compute elapsed at the read site.
            ev_ref.timer = std::time::Instant::now();
        }

        ev_ref.assert_watcher_thread_locked();

        #[cfg(debug_assertions)]
        debug_assert!(ev_ref.debug_mutex.try_lock());

        ev
    }

    /// Release the pointer from `watcherAcquireHotReloadEvent`, submitting
    /// the event if it contains new files.
    ///
    /// Called from watcher thread.
    pub fn watcher_release_and_submit_event(&mut self, ev: *mut HotReloadEvent) {
        // SAFETY: `ev` was returned by `watcher_acquire_event` and points into `self.events`;
        // the watcher thread has exclusive access until it is submitted below.
        let ev_ref = unsafe { &mut *ev };

        ev_ref.assert_watcher_thread_locked();

        #[cfg(debug_assertions)]
        {
            let Some(dbg_event) = self.dbg_watcher_event else {
                panic!("must call `watcherAcquireEvent` before `watcherReleaseAndSubmitEvent`");
            };
            debug_assert!(
                dbg_event == ev,
                "watcherReleaseAndSubmitEvent: event is not from last `watcherAcquireEvent` call \
                 (expected {:p}, got {:p})",
                dbg_event,
                ev,
            );
            self.dbg_watcher_event = None;
        }

        #[cfg(debug_assertions)]
        {
            // PORT NOTE: Zig checked that `ev.timer` was not the 0xAA undefined-memory pattern by
            // reinterpreting it as `[size]u8`. That check has no Rust equivalent: (1) Rust does not
            // fill uninitialized memory with 0xAA, (2) `std::time::Instant` is an opaque std type
            // that contains padding bytes on Linux/Windows, so materialising `&[u8]` over it would
            // read uninitialized padding (UB), and (3) the type system already guarantees `timer`
            // is initialized — `HotReloadEvent::init_empty` constructs it and `watcher_acquire_event`
            // overwrites it with `Instant::now()` before any release. The Zig check is therefore
            // dropped entirely rather than ported.
            ev_ref.debug_mutex.unlock();
        }

        if ev_ref.is_empty() {
            return;
        }
        // There are files to be processed.

        // SAFETY: `ev` points into `self.events`; both are within the same allocation.
        let ev_index: u8 =
            u8::try_from(unsafe { ev.offset_from(self.events.as_ptr().cast_mut()) }).unwrap();
        let old_next = NextEvent(self.next_event.swap(ev_index, Ordering::AcqRel));
        match old_next {
            NextEvent::DONE => {
                // Dev server is done running events. We need to schedule the event directly.
                self.current_event = Some(ev_index);
                self.pending_event = None;
                // Relaxed because the dev server is not running events right now.
                // (could technically be made non-atomic)
                self.next_event
                    .store(NextEvent::WAITING.0, Ordering::Relaxed);
                #[cfg(debug_assertions)]
                {
                    debug_assert!(
                        self.dbg_server_event.is_none(),
                        "no event should be running right now",
                    );
                    // Not atomic because the dev server is not running events right now.
                    self.dbg_server_event = Some(ev);
                }
                // PORT NOTE: `jsc::ConcurrentTask` is a module; the struct lives at
                // `jsc::ConcurrentTask::ConcurrentTask`.
                ev_ref.concurrent_task = jsc::ConcurrentTask::ConcurrentTask {
                    task: jsc::Task::init(ev),
                    ..Default::default()
                };
                // SAFETY: `owner` BACKREF is valid; `vm` is a `BackRef` (safe
                // Deref); `event_loop` points at a sibling field of `VirtualMachine`.
                unsafe {
                    (*(&(*ev_ref.owner).vm).event_loop)
                        .enqueue_task_concurrent(&raw mut ev_ref.concurrent_task);
                }
            }

            NextEvent::WAITING => {
                if self.pending_event.is_some() {
                    // `pending_event` is running, which means we're done with `current_event`.
                    self.current_event = self.pending_event;
                } // else, no pending event yet, but not done with `current_event`.
                self.pending_event = Some(ev_index);
            }

            _ => {
                // This is an index into the `events` array.
                let old_index: u8 = old_next.0;
                debug_assert!(
                    self.pending_event == Some(old_index),
                    "watcherReleaseAndSubmitEvent: expected `pending_event` to be {}; got {:?}",
                    old_index,
                    self.pending_event,
                );
                // The old pending event hadn't been run yet, so we can replace it with `ev`.
                self.pending_event = Some(ev_index);
            }
        }
    }

    /// Called by DevServer after it receives a task callback. If this returns another event,
    /// that event should be passed again to this function, and so on, until this function
    /// returns null.
    ///
    /// Runs on dev server thread.
    pub fn recycle_event_from_dev_server(
        &mut self,
        old_event: *mut HotReloadEvent,
    ) -> Option<*mut HotReloadEvent> {
        // SAFETY: `old_event` was previously submitted to the dev server thread and is now
        // exclusively owned by it for reset.
        unsafe { (*old_event).reset() };

        #[cfg(debug_assertions)]
        {
            // Not atomic because watcher won't modify this value while an event is running.
            let dbg_event = self.dbg_server_event;
            self.dbg_server_event = None;
            debug_assert!(
                dbg_event == Some(old_event),
                "recycleEventFromDevServer: old_event: expected {:?}, got {:p}",
                dbg_event,
                old_event,
            );
        }

        let event: *mut HotReloadEvent = loop {
            let next = NextEvent(self.next_event.swap(NextEvent::WAITING.0, Ordering::AcqRel));
            match next {
                NextEvent::WAITING => {
                    // Success order is not AcqRel because the swap above performed an Acquire load.
                    // Failure order is Relaxed because we're going to perform an Acquire load
                    // in the next loop iteration.
                    if self
                        .next_event
                        .compare_exchange_weak(
                            NextEvent::WAITING.0,
                            NextEvent::DONE.0,
                            Ordering::Release,
                            Ordering::Relaxed,
                        )
                        .is_err()
                    {
                        continue; // another event may have been added
                    }
                    return None; // done running events
                }
                NextEvent::DONE => unreachable!(),
                _ => break &raw mut self.events[next.0 as usize],
            }
        };

        #[cfg(debug_assertions)]
        {
            // Not atomic because watcher won't modify this value while an event is running.
            self.dbg_server_event = Some(event);
        }
        Some(event)
    }
}

// ported from: src/bake/DevServer/WatcherAtomics.zig
