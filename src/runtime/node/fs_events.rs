//! macOS FSEvents backend for `fs.watch()`: one `CFRunLoop` thread running one
//! `FSEventStream` that covers every watched path; `path_watcher.rs` fans the
//! events out to the JS watchers.

use core::sync::atomic::{AtomicU8, Ordering};
use std::sync::OnceLock;

use bun_core::{ZBox, zstr};
use bun_sys::core_foundation as cf;
use bun_threading::{Guarded, Mutex, Semaphore};

use super::node_fs_watcher::WatchEventKind;
use super::path_watcher::WatcherId;

const K_FS_EVENTS_MODIFIED: u32 = cf::event_flags::ITEM_CHANGE_OWNER
    | cf::event_flags::ITEM_FINDER_INFO_MOD
    | cf::event_flags::ITEM_INODE_META_MOD
    | cf::event_flags::ITEM_MODIFIED
    | cf::event_flags::ITEM_XATTR_MOD;

const K_FS_EVENTS_RENAMED: u32 =
    cf::event_flags::ITEM_CREATED | cf::event_flags::ITEM_REMOVED | cf::event_flags::ITEM_RENAMED;

static FSEVENTS_DEFAULT_LOOP_MUTEX: Mutex = Mutex::new();
static FSEVENTS_DEFAULT_LOOP: OnceLock<&'static FSEventsLoop> = OnceLock::new();

/// Work for the CF thread, requested from any thread by [`FSEventsLoop::request`]
/// and picked up by the run loop source's `perform`.
mod request {
    /// Rebuild the FSEventStream from the current watcher list.
    pub(super) const SCHEDULE: u8 = 1 << 0;
    /// Stop the run loop (shutdown).
    pub(super) const STOP: u8 = 1 << 1;
}

pub(crate) struct FSEventsLoop {
    /// The source that wakes the CF thread for `pending`, and the CF thread's
    /// run loop (set by that thread before `sem` is posted). Both are taken and
    /// released by `shutdown()` after the thread is joined.
    handles: Guarded<Handles>,
    /// `request::*` bits not yet performed by the CF thread.
    pending: AtomicU8,
    sem: Semaphore,
    /// Only touched by `init()`/`shutdown()`, under `FSEVENTS_DEFAULT_LOOP_MUTEX`.
    thread: Guarded<Option<std::thread::JoinHandle<()>>>,
    state: Guarded<FSEventsLoopState>,
}

#[derive(Default)]
struct Handles {
    source: Option<cf::RunLoopSource>,
    run_loop: Option<cf::RunLoop>,
}

#[derive(Default)]
struct FSEventsLoopState {
    watchers: Vec<Option<Registered>>,
    watcher_count: u32,
    next_id: u64,
    has_scheduled_watchers: bool,
    /// The live stream and the path array it was created with (kept alive for
    /// the stream's lifetime, released together when the stream is rebuilt).
    stream: Option<(cf::EventStream, cf::CFStringArray)>,
}

/// One registered watch: what `on_events` matches event paths against and
/// where it sends the ones that match.
struct Registered {
    id: u64,
    /// Canonical path of the watched file/directory (NUL-terminated for
    /// `CFStringCreateWithFileSystemRepresentation`).
    path: ZBox,
    recursive: bool,
    callback: Callback,
    flush: UpdateEndCallback,
    ctx: WatcherId,
}

pub(crate) type Callback =
    fn(ctx: WatcherId, event_type: WatchEventKind, path: &[u8], is_file: bool);
pub(crate) type UpdateEndCallback = fn(ctx: WatcherId);

impl cf::RunLoopSourceHandler for FSEventsLoop {
    /// Runs on the CF thread after `request()` signalled the source.
    fn perform(&'static self) {
        let pending = self.pending.swap(0, Ordering::AcqRel);
        if pending & request::SCHEDULE != 0 {
            self.schedule();
        }
        if pending & request::STOP != 0 {
            self.stop();
        }
    }
}

impl cf::EventStreamHandler for FSEventsLoop {
    /// Runs on the CF thread when there are events in the FSEventStream.
    fn on_events(&'static self, events: cf::Events<'_>) {
        // Hold the lock for the whole iteration: `unregister_watcher` on the
        // main thread removes the entry under this same lock and its caller
        // then drops the watcher, and `register_watcher` may reallocate
        // `watchers`.
        let state = self.state.lock();

        for handle in state.watchers.iter().flatten() {
            let handle_path: &[u8] = handle.path.as_bytes();

            for (event_path, event_flags) in events.iter() {
                let mut flags = event_flags;
                let mut path = event_path;
                // Filter out paths that are outside handle's request
                if path.len() < handle_path.len() || !path.starts_with(handle_path) {
                    continue;
                }
                let is_file = (flags & cf::event_flags::ITEM_IS_DIR) == 0;

                // Remove common prefix, unless the watched folder is "/"
                if !(handle_path.len() == 1 && handle_path[0] == b'/') {
                    path = &path[handle_path.len()..];

                    // Ignore events with path equal to directory itself
                    if path.len() <= 1 && !is_file {
                        continue;
                    }

                    if path.is_empty() {
                        // Since we're using fsevents to watch the file itself handle_path == path, and we now need to get the basename of the file back
                        let basename = bun_core::strings::last_index_of_char(handle_path, b'/')
                            .unwrap_or(handle_path.len());
                        path = &handle_path[basename..];
                        // Created and Removed seem to be always set, but don't make sense
                        flags &= !K_FS_EVENTS_RENAMED;
                    }

                    if path.first() == Some(&b'/') {
                        // Skip forward slash
                        path = &path[1..];
                    }
                }

                // Do not emit events from subdirectories (without option set)
                if path.is_empty()
                    || (bun_core::strings::index_of_char_usize(path, b'/').is_some()
                        && !handle.recursive)
                {
                    continue;
                }

                let mut is_rename = true;

                if (flags & K_FS_EVENTS_RENAMED) == 0 {
                    if (flags & K_FS_EVENTS_MODIFIED) != 0 || is_file {
                        is_rename = false;
                    }
                }

                let event_type: WatchEventKind = if is_rename {
                    WatchEventKind::Rename
                } else {
                    WatchEventKind::Change
                };
                (handle.callback)(handle.ctx, event_type, path, is_file);
            }
            (handle.flush)(handle.ctx);
        }
    }
}

impl FSEventsLoop {
    fn cf_thread_loop(&'static self) {
        bun_core::Output::Source::configure_named_thread(zstr!("CFThreadLoop"));

        {
            let mut handles = self.handles.lock();
            // Retained so it outlives this thread's pthread-TSD destructor;
            // `shutdown()` releases it after `thread.join()`.
            let run_loop = cf::RunLoop::current();
            if let Some(source) = &handles.source {
                run_loop.add_source(source);
            }
            handles.run_loop = Some(run_loop);
        }

        self.sem.post();

        cf::RunLoop::run_current();

        // The stream was created and scheduled on this thread and must be
        // stopped and released here too; `shutdown()` runs on another thread.
        if let Some((stream, paths)) = self.state.lock().stream.take() {
            stream.stop();
            drop(stream);
            drop(paths);
        }

        let handles = self.handles.lock();
        if let (Some(run_loop), Some(source)) = (&handles.run_loop, &handles.source) {
            run_loop.remove_source(source);
        }
    }

    pub(crate) fn init() -> crate::Result<&'static FSEventsLoop> {
        cf::ensure_loaded();

        // Leaked up front: the run loop source and the event stream carry
        // `&'static self` as their context. (If source creation or the thread
        // spawn fails below, this allocation is abandoned.)
        let this: &'static FSEventsLoop = Box::leak(Box::new(FSEventsLoop {
            handles: Guarded::init(Handles::default()),
            pending: AtomicU8::new(0),
            sem: Semaphore::default(),
            thread: Guarded::init(None),
            state: Guarded::init(FSEventsLoopState::default()),
        }));

        let Some(source) = cf::RunLoopSource::new(this) else {
            return Err(crate::Error::FailedToCreateCoreFoudationSourceLoop);
        };
        this.handles.lock().source = Some(source);

        let handle = match std::thread::Builder::new()
            .name("CFThreadLoop".into())
            .spawn(move || this.cf_thread_loop())
        {
            Ok(handle) => handle,
            Err(_) => {
                this.handles.lock().source = None;
                return Err(crate::Error::FailedToSpawnFSEventsThread);
            }
        };
        *this.thread.lock() = Some(handle);

        // sync threads
        this.sem.wait();
        Ok(this)
    }

    /// Ask the CF thread to perform `request::*` work.
    fn request(&self, what: u8) {
        self.pending.fetch_or(what, Ordering::AcqRel);
        let handles = self.handles.lock();
        if let Some(source) = &handles.source {
            source.signal();
        }
        if let Some(run_loop) = &handles.run_loop {
            run_loop.wake_up();
        }
    }

    // Runs on CF Thread
    fn schedule(&'static self) {
        let mut state = self.state.lock();
        state.has_scheduled_watchers = false;
        let watcher_count = state.watcher_count;

        if let Some((stream, paths)) = state.stream.take() {
            // Stop emitting events
            stream.stop();
            // Release stream (invalidate + release), then the old paths
            drop(stream);
            drop(paths);
        }

        if watcher_count == 0 {
            return;
        }

        let strings: Vec<cf::CFString> = state
            .watchers
            .iter()
            .flatten()
            .filter_map(|w| cf::CFString::from_file_system_path(&w.path))
            .collect();
        let Some(paths) = cf::CFStringArray::new(strings) else {
            return;
        };

        let latency: f64 = 0.05;
        // Explanation of selected flags:
        // 1. NoDefer - without this flag, events that are happening continuously
        //    (i.e. each event is happening after time interval less than `latency`,
        //    counted from previous event), will be deferred and passed to callback
        //    once they'll either fill whole OS buffer, or when this continuous stream
        //    will stop (i.e. there'll be delay between events, bigger than
        //    `latency`).
        //    Specifying this flag will invoke callback after `latency` time passed
        //    since event.
        // 2. FileEvents - fire callback for file changes too (by default it is firing
        //    it only for directory changes).
        //
        let flags: cf::FSEventStreamCreateFlags =
            cf::create_flags::NO_DEFER | cf::create_flags::FILE_EVENTS;

        //
        // NOTE: It might sound like a good idea to remember last seen StreamEventId,
        // but in reality one dir might have last StreamEventId less than, the other,
        // that is being watched now. Which will cause FSEventStream API to report
        // changes to files from the past.
        //
        // FSEventStreamCreate can fail under rapid stream churn (resource
        // exhaustion); in that case (or if start fails) everything created here
        // is released again and the next register/unregister retries. The
        // stream is scheduled on this (the CF) thread's run loop.
        let Some(stream) =
            cf::EventStream::new_scheduled(self, &paths, cf::EVENT_ID_SINCE_NOW, latency, flags)
        else {
            return;
        };
        if !stream.start() {
            //clean in case of failure
            drop(stream);
            drop(paths);
            return;
        }
        state.stream = Some((stream, paths));
    }

    fn register_watcher(&self, mut watcher: Registered) -> u64 {
        let mut state = self.state.lock();
        state.next_id += 1;
        let id = state.next_id;
        watcher.id = id;
        if state.watcher_count as usize == state.watchers.len() {
            state.watcher_count += 1;
            state.watchers.push(Some(watcher));
        } else {
            let slot = state
                .watchers
                .iter_mut()
                .find(|w| w.is_none())
                .expect("watcher_count < len implies a free slot");
            *slot = Some(watcher);
            state.watcher_count += 1;
        }

        if !state.has_scheduled_watchers {
            state.has_scheduled_watchers = true;
        } else {
            return id;
        }
        self.request(request::SCHEDULE);
        id
    }

    fn unregister_watcher(&self, id: u64) {
        let mut state = self.state.lock();
        let len = state.watchers.len();
        for i in 0..len {
            if state.watchers[i].as_ref().is_some_and(|item| item.id == id) {
                state.watchers[i] = None;
                // if is the last one just pop
                if i == len - 1 {
                    let _ = state.watchers.pop();
                }
                state.watcher_count -= 1;
                break;
            }
        }

        // Rebuild the FSEventStream on the CF thread so it stops firing for
        // the path we just removed. Without this the stream keeps delivering
        // events for removed paths until another register happens to
        // reschedule. `on_events` tolerates the interim (the entry is gone)
        // because both sides hold `state`.
        if !state.has_scheduled_watchers {
            state.has_scheduled_watchers = true;
        } else {
            return;
        }
        self.request(request::SCHEDULE);
    }

    // Runs on CF loop to close the loop
    fn stop(&self) {
        if let Some(run_loop) = &self.handles.lock().run_loop {
            run_loop.stop();
        }
    }

    fn shutdown(&'static self) {
        let Some(thread) = self.thread.lock().take() else {
            return; // already shut down
        };
        // signal close and wait
        self.request(request::STOP);
        let _ = thread.join();

        {
            let mut handles = self.handles.lock();
            let run_loop = handles.run_loop.take();
            debug_assert!(run_loop.is_some());
            drop(run_loop);
            let source = handles.source.take();
            debug_assert!(source.is_some());
            drop(source);
        }

        // Forget the remaining registrations; their owners' later unregister
        // finds nothing and, with the handles gone, wakes nothing.
        let mut state = self.state.lock();
        state.watchers.clear();
        state.watcher_count = 0;
    }
}

/// A registration on the FSEvents loop; dropping it unregisters.
pub(crate) struct FSEventsWatcher {
    loop_: &'static FSEventsLoop,
    id: u64,
}

impl FSEventsWatcher {
    fn init(
        loop_: &'static FSEventsLoop,
        path: ZBox,
        recursive: bool,
        callback: Callback,
        update_end: UpdateEndCallback,
        ctx: WatcherId,
    ) -> FSEventsWatcher {
        let id = loop_.register_watcher(Registered {
            id: 0,
            path,
            recursive,
            callback,
            flush: update_end,
            ctx,
        });
        FSEventsWatcher { loop_, id }
    }
}

impl Drop for FSEventsWatcher {
    fn drop(&mut self) {
        self.loop_.unregister_watcher(self.id);
    }
}

pub(crate) fn watch(
    path: ZBox,
    recursive: bool,
    callback: Callback,
    update_end: UpdateEndCallback,
    ctx: WatcherId,
) -> crate::Result<FSEventsWatcher> {
    if let Some(&loop_) = FSEVENTS_DEFAULT_LOOP.get() {
        return Ok(FSEventsWatcher::init(
            loop_, path, recursive, callback, update_end, ctx,
        ));
    }
    let _guard = FSEVENTS_DEFAULT_LOOP_MUTEX.lock_guard();
    let loop_: &'static FSEventsLoop = match FSEVENTS_DEFAULT_LOOP.get() {
        Some(&l) => l,
        None => {
            let l = FSEventsLoop::init()?;
            let _ = FSEVENTS_DEFAULT_LOOP.set(l);
            bun_core::Global::add_pre_exit_callback(close_and_wait_on_exit);
            l
        }
    };
    Ok(FSEventsWatcher::init(
        loop_, path, recursive, callback, update_end, ctx,
    ))
}

extern "C" fn close_and_wait_on_exit() {
    close_and_wait()
}

fn close_and_wait() {
    if let Some(&loop_) = FSEVENTS_DEFAULT_LOOP.get() {
        let _guard = FSEVENTS_DEFAULT_LOOP_MUTEX.lock_guard();
        loop_.shutdown();
    }
}
