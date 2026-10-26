//! `WatcherAtomics`: hands `HotReloadEvent`s from the watcher thread to the JS thread.

use super::*;

/// Two pre-allocated `HotReloadEvent`s. The dev server thread holds at most one of them at a time.
pub(crate) struct WatcherAtomics {
    pub(crate) events: [HotReloadEvent; 2],
    /// Not held across a call that locks `Watcher.mutex`, which the watcher thread takes first.
    pub(crate) state: bun_threading::Guarded<State>,
    // Debug field to ensure methods are being called in the right order.
    #[cfg(debug_assertions)]
    pub(crate) dbg_watcher_event: Option<*mut HotReloadEvent>,
}

#[derive(Default)]
pub(crate) struct State {
    /// Index into `events` of the event the dev server thread was given and has not recycled.
    pub(crate) dev: Option<u8>,
    /// The other event has files and waits for `recycle_event_from_dev_server`.
    queued: bool,
}

// These take `this: *mut Self` (not `&mut self`) so the returned
// `*mut HotReloadEvent` and the `concurrent_task` node linked into the event
// loop's queue are derived from the allocation's `heap::into_raw` pointer
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
            let mut state = (*this).state.lock();
            (*old_event).reset();

            let old_index = state.dev.expect("the dev server thread holds an event");
            debug_assert!(
                core::ptr::eq(old_event, &raw const (*this).events[old_index as usize]),
                "recycleEventFromDevServer: old_event: expected index {}, got {:p}",
                old_index,
                old_event,
            );
            if !core::mem::take(&mut state.queued) {
                state.dev = None;
                return None; // done running events
            }
            let next = old_index ^ 1;
            state.dev = Some(next);
            Some(&raw mut (*this).events[next as usize])
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
            let (index, taken_back): (usize, bool) = {
                let mut state = (*this).state.lock();
                // Take the queued event back so that this batch joins it.
                let taken_back = core::mem::take(&mut state.queued);
                (if state.dev == Some(0) { 1 } else { 0 }, taken_back)
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

            // Only this thread can reach `ev`: it is neither `state.dev` nor queued.
            let ev_ref = &mut *ev;
            debug_assert_eq!(ev_ref.is_empty(), !taken_back);

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
            let mut state = (*this).state.lock();
            match state.dev {
                // The dev server thread takes `ev` when it recycles the event it holds.
                Some(_) => state.queued = true,
                None => {
                    // Dev server is done running events. We need to schedule the event directly.
                    state.dev = Some(ev_index);
                    drop(state);
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
            }
        }
    }
}

impl WatcherAtomics {
    pub(crate) fn init(owner: *mut DevServer) -> core::ptr::NonNull<Self> {
        let mk_event = || HotReloadEvent::init_empty(owner);
        let atomics: *mut WatcherAtomics = bun_core::heap::into_raw(Box::new(WatcherAtomics {
            events: [mk_event(), mk_event()],
            state: Default::default(),
            #[cfg(debug_assertions)]
            dbg_watcher_event: None,
        }));
        // SAFETY: `atomics` is the fresh `heap::into_raw` result; the
        // allocation is exclusively reachable through it here.
        unsafe {
            for ev in &mut (*atomics).events {
                ev.atomics = atomics;
            }
            core::ptr::NonNull::new_unchecked(atomics)
        }
    }
}
