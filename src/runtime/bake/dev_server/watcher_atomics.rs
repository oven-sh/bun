//! `WatcherAtomics`: hands `HotReloadEvent`s from the watcher thread to the JS thread.

use super::*;

/// `DevServer.WatcherAtomics` — three pre-allocated `HotReloadEvent`s
/// rotated between the watcher thread and the main thread.
pub(crate) struct WatcherAtomics {
    pub(crate) events: [HotReloadEvent; 3],
    /// Atomically encodes a `NextEvent`: values 0..3 are an index into
    /// `events`, plus the `WAITING`/`DONE` sentinels.
    // Rust cannot align individual fields, so this field is not cache-line
    // aligned. Wrap in a `#[repr(align(128))]` newtype (init site:
    // lifecycle.rs) if false sharing ever shows up in profiles.
    pub(crate) next_event: core::sync::atomic::AtomicU8,
    /// Watcher-thread-only; index into `events` currently being processed.
    pub(crate) current_event: Option<u8>,
    /// Watcher-thread-only; index into `events` queued behind `current_event`.
    pub(crate) pending_event: Option<u8>,
    // Debug fields to ensure methods are being called in the right order.
    #[cfg(debug_assertions)]
    pub(crate) dbg_watcher_event: Option<*mut HotReloadEvent>,
    #[cfg(debug_assertions)]
    pub(crate) dbg_server_event: Option<*mut HotReloadEvent>,
}

/// Stored in `WatcherAtomics::next_event` (an `AtomicU8`). Modeled as a
/// transparent newtype rather than a `#[repr(u8)] enum` because any value
/// other than the named constants is an index into the `events` array, and
/// Rust enums cannot hold unlisted discriminants.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) struct NextEvent(pub(crate) u8);

impl NextEvent {
    /// An event is running, and no next event is pending.
    pub(crate) const WAITING: NextEvent = NextEvent(u8::MAX - 1);
    /// No event is running.
    pub(crate) const DONE: NextEvent = NextEvent(u8::MAX);
    // Any other value represents an index into the `events` array.
}

// These take `this: *mut Self` (not `&mut self`) so the returned
// `*mut HotReloadEvent` and the `concurrent_task` node linked into the event
// loop's queue are derived from the allocation's `heap::alloc_nn` pointer
// rather than from a `&mut WatcherAtomics` reborrow. The queued pointers must
// stay valid after `Drop for DevServer` writes through the same allocation.
impl WatcherAtomics {
    /// Called by DevServer after it receives a task callback. If this returns
    /// another event, that event should be passed again to this function, and
    /// so on, until this function returns `None`.
    ///
    /// Runs on dev server thread.
    ///
    /// # Safety
    /// `this` is the heap `WatcherAtomics` owned by `DevServer`; `old_event`
    /// is a slot in `(*this).events` previously submitted to the dev server
    /// thread and now exclusively owned by the caller for reset.
    pub(crate) unsafe fn recycle_event_from_dev_server(
        this: *mut Self,
        old_event: *mut HotReloadEvent,
    ) -> Option<*mut HotReloadEvent> {
        // SAFETY: caller contract — `this` and `old_event` are live; every
        // `(*this)` / `(*old_event)` below is a field access on those.
        unsafe {
            (*old_event).reset();

            #[cfg(debug_assertions)]
            {
                // Not atomic because watcher won't modify this value while an event is running.
                let dbg_event = (*this).dbg_server_event;
                (*this).dbg_server_event = None;
                debug_assert!(
                    dbg_event == Some(old_event),
                    "recycleEventFromDevServer: old_event: expected {:?}, got {:p}",
                    dbg_event,
                    old_event,
                );
            }

            let event: *mut HotReloadEvent = loop {
                let next = NextEvent(
                    (*this)
                        .next_event
                        .swap(NextEvent::WAITING.0, Ordering::AcqRel),
                );
                match next {
                    NextEvent::WAITING => {
                        // Success order is not AcqRel because the swap above performed an Acquire load.
                        // Failure order is Relaxed because we're going to perform an Acquire load
                        // in the next loop iteration.
                        if (*this)
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
                    _ => break &raw mut (*this).events[next.0 as usize],
                }
            };

            #[cfg(debug_assertions)]
            {
                // Not atomic because watcher won't modify this value while an event is running.
                (*this).dbg_server_event = Some(event);
            }
            Some(event)
        }
    }

    /// Atomically get a `*mut HotReloadEvent` that is not in use by the
    /// DevServer thread. Call `watcher_release_and_submit_event` when it is
    /// filled with files.
    ///
    /// Called from watcher thread.
    ///
    /// # Safety
    /// `this` is the heap `WatcherAtomics` owned by `DevServer`; the watcher
    /// thread holds `Watcher.mutex`.
    pub(crate) unsafe fn watcher_acquire_event(this: *mut Self) -> *mut HotReloadEvent {
        // SAFETY: caller contract — `this` is live; every `(*this)` / `(*ev)`
        // below is a field access on the heap `WatcherAtomics` allocation.
        unsafe {
            let mut available = [true; 3];
            if let Some(i) = (*this).current_event {
                available[i as usize] = false;
            }
            if let Some(i) = (*this).pending_event {
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
            let ev: *mut HotReloadEvent = &raw mut (*this).events[index];

            #[cfg(debug_assertions)]
            {
                debug_assert!(
                    (*this).dbg_watcher_event.is_none(),
                    "must call `watcher_release_and_submit_event` before calling `watcher_acquire_event` again",
                );
                (*this).dbg_watcher_event = Some(ev);
            }

            // `ev` points into `(*this).events[index]`, which the watcher thread
            // has exclusive access to (neither `current_event` nor `pending_event`).
            let ev_ref = &mut *ev;

            // Initialize the timer if it is empty.
            if ev_ref.is_empty() {
                // Monotonic start time; elapsed is computed at the read site.
                ev_ref.timer = std::time::Instant::now();
            }

            ev_ref.assert_watcher_thread_locked();

            #[cfg(debug_assertions)]
            debug_assert!(ev_ref.debug_mutex.try_lock());

            ev
        }
    }

    /// Release the pointer from `watcher_acquire_event`, submitting the event
    /// if it contains new files.
    ///
    /// Called from watcher thread.
    ///
    /// # Safety
    /// `this` is the heap `WatcherAtomics` owned by `DevServer`; `ev` is the
    /// pointer returned by the matching `watcher_acquire_event` call, and the
    /// watcher thread still holds exclusive access to it.
    // `&(...)` is deliberate — sidesteps dangerous_implicit_autorefs.
    pub(crate) unsafe fn watcher_release_and_submit_event(
        this: *mut Self,
        ev: *mut HotReloadEvent,
    ) {
        // SAFETY: caller contract — `this` and `ev` are live slots in the heap
        // `WatcherAtomics`; every `(*this)` / `(*ev)` below is a field access
        // on that allocation. `(*ev).owner` is the live DevServer (watcher
        // thread holds `Watcher.mutex`).
        unsafe {
            (*ev).assert_watcher_thread_locked();

            #[cfg(debug_assertions)]
            {
                let Some(dbg_event) = (*this).dbg_watcher_event else {
                    panic!(
                        "must call `watcher_acquire_event` before `watcher_release_and_submit_event`"
                    );
                };
                debug_assert!(
                    dbg_event == ev,
                    "watcher_release_and_submit_event: event is not from last \
                     `watcher_acquire_event` call (expected {:p}, got {:p})",
                    dbg_event,
                    ev,
                );
                (*this).dbg_watcher_event = None;
            }

            #[cfg(debug_assertions)]
            {
                (*ev).debug_mutex.unlock();
            }

            if (*ev).is_empty() {
                return;
            }
            // There are files to be processed.

            let ev_index: u8 =
                u8::try_from(ev.offset_from((&raw const (*this).events).cast::<HotReloadEvent>()))
                    .unwrap();
            let old_next = NextEvent((*this).next_event.swap(ev_index, Ordering::AcqRel));
            match old_next {
                NextEvent::DONE => {
                    // Dev server is done running events. We need to schedule the event directly.
                    (*this).current_event = Some(ev_index);
                    (*this).pending_event = None;
                    // Relaxed because the dev server is not running events right now.
                    // (could technically be made non-atomic)
                    (*this)
                        .next_event
                        .store(NextEvent::WAITING.0, Ordering::Relaxed);
                    #[cfg(debug_assertions)]
                    {
                        debug_assert!(
                            (*this).dbg_server_event.is_none(),
                            "no event should be running right now",
                        );
                        // Not atomic because the dev server is not running events right now.
                        (*this).dbg_server_event = Some(ev);
                    }
                    (*ev).concurrent_task = bun_event_loop::ConcurrentTask::ConcurrentTask {
                        task: bun_event_loop::Task::init(ev),
                        ..Default::default()
                    };
                    // The queued node pointer is derived from `ev` (allocation-root
                    // provenance) so it stays valid across `Drop for DevServer`'s
                    // writes. Refused ⇒ the VM is torn down; the event is one of
                    // DevServer's inline slots and simply never runs.
                    let _ = (*(*ev).owner).vm_handle.post(
                        bun_jsc::LoopKind::Regular,
                        core::ptr::NonNull::new_unchecked(&raw mut (*ev).concurrent_task),
                    );
                }

                NextEvent::WAITING => {
                    if (*this).pending_event.is_some() {
                        // `pending_event` is running, which means we're done with `current_event`.
                        (*this).current_event = (*this).pending_event;
                    } // else, no pending event yet, but not done with `current_event`.
                    (*this).pending_event = Some(ev_index);
                }

                _ => {
                    // This is an index into the `events` array.
                    let old_index: u8 = old_next.0;
                    debug_assert!(
                        (*this).pending_event == Some(old_index),
                        "watcher_release_and_submit_event: expected `pending_event` to be {}; got {:?}",
                        old_index,
                        (*this).pending_event,
                    );
                    // The old pending event hadn't been run yet, so we can replace it with `ev`.
                    (*this).pending_event = Some(ev_index);
                }
            }
        }
    }
}

impl WatcherAtomics {
    pub(crate) fn init(owner: *mut DevServer) -> core::ptr::NonNull<Self> {
        let mk_event = || HotReloadEvent::init_empty(owner);
        let atomics = bun_core::heap::alloc_nn(WatcherAtomics {
            events: [mk_event(), mk_event(), mk_event()],
            next_event: core::sync::atomic::AtomicU8::new(NextEvent::DONE.0),
            current_event: None,
            pending_event: None,
            #[cfg(debug_assertions)]
            dbg_watcher_event: None,
            #[cfg(debug_assertions)]
            dbg_server_event: None,
        });
        // SAFETY: `atomics` is the fresh `heap::alloc_nn` result; the
        // allocation is exclusively reachable through it here.
        for ev in unsafe { &mut (*atomics.as_ptr()).events } {
            ev.atomics = atomics.as_ptr();
        }
        atomics
    }
}
