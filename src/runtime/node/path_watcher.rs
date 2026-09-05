//! POSIX backend for `fs.watch()`.
//!
//! This is deliberately independent of `bun.Watcher` (the bundler/--watch/--hot
//! watcher). `bun.Watcher` is shaped around a module graph — its WatchItem carries
//! `options.Loader`, `*PackageJSON`, a filesystem handle, and on Windows is pinned
//! to `top_level_dir`. None of that applies to `fs.watch()`, and routing `fs.watch()`
//! through it required a 1k-line shim (the old version of this file) full of
//! lock-ordering workarounds, a WorkPool directory crawler, and a bolted-on FSEvents
//! side-channel.
//!
//! The Windows backend (`win_watcher.rs`, libuv `uv_fs_event`) never went through
//! `bun.Watcher` and is a quarter of the size; this file gives Linux/macOS/FreeBSD
//! the same shape:
//!
//!   PathWatcherManager        process-global, lazy, owns the OS resource
//!     ├─ Linux:   one inotify fd + one reader thread, wd → PathWatcher map
//!     ├─ macOS:   delegates to fs_events.rs (one CFRunLoop thread, one FSEventStream)
//!     └─ FreeBSD: one kqueue fd + one reader thread, fd → PathWatcher map
//!
//!   PathWatcher               one per unique (realpath, recursive) — deduped
//!     └─ handlers[]           the JS FSWatchers' event sinks sharing this watch
//!
//! A second `fs.watch()` on the same path finds the existing PathWatcher and
//! appends a handler. Dropping the returned [`Registration`] removes it; the
//! last one out tears down the OS watch.

#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use bun_collections::ArrayHashMap;
use bun_collections::{HashMap, StringArrayHashMap};
use bun_core::ZBox;
#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_core::strings;
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use bun_core::{Output, zstr};
use bun_core::{ZStr, handle_oom};
use bun_paths as path;
#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_paths::PathBuffer;
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use bun_paths::platform;
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use bun_paths::resolve_path::join_z_buf_spill;
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use bun_sys::FdExt;
use bun_sys::{self as sys, E, Fd, Tag};
use bun_threading::{Guarded, Mutex};
use bun_wyhash::hash;

use crate::node::node_fs_watcher::{Event, EventSink, WatchEventKind};

#[cfg(target_os = "macos")]
use crate::node::fs_events as fsevents;

bun_output::define_scoped_log!(log, fs_watch, hidden);

/// Process-global manager. Created on first `fs.watch()`, never destroyed (matches
/// the FSEvents loop and Windows libuv loop lifetimes). `DEFAULT_MANAGER_MUTEX`
/// serializes the *fallible* init path so a failed `Platform::init` can be
/// retried on a later `get()` without two threads racing to create one;
/// `OnceLock` provides the publish so the FSEvents-thread read in
/// `on_fs_event` needs no lock.
static DEFAULT_MANAGER: std::sync::OnceLock<Arc<PathWatcherManager>> = std::sync::OnceLock::new();
static DEFAULT_MANAGER_MUTEX: Mutex = Mutex::new();

/// Identity of one [`PathWatcher`] within its manager. Never reused, so a stale
/// id (an FSEvents callback racing a detach) simply finds nothing.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct WatcherId(u64);

/// Identity of one handler (one `FSWatcher`'s sink) on a [`PathWatcher`].
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct HandlerId(u64);

// ────────────────────────────────────────────────────────────────────────────────
// PathWatcherManager
// ────────────────────────────────────────────────────────────────────────────────

pub(crate) struct PathWatcherManager {
    /// Every watcher, the dedup map and the per-platform dispatch maps. The
    /// reader thread holds this while dispatching, so a detach on the JS
    /// thread cannot tear a PathWatcher down mid-emit. A single lock here
    /// replaces the three interacting mutexes of the old design.
    state: Guarded<State>,

    /// inotify/kqueue fd. Set before the reader thread spawns, never
    /// reassigned (process-lifetime singleton, no teardown).
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    fd: Fd,

    /// Reader-thread loop flag. Initialized `true`; cleared only by the reader
    /// thread itself when it exits on a fatal read error, after which
    /// `watch()` refuses new registrations (no teardown otherwise).
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    running: AtomicBool,
}

#[derive(Default)]
struct State {
    /// Dedup map: dedup key → watcher. The key is the resolved path with a one-byte
    /// suffix encoding `recursive` (so `fs.watch(p)` and `fs.watch(p, {recursive:true})`
    /// don't share — they want different OS registrations on every platform).
    by_key: StringArrayHashMap<WatcherId>,
    watchers: HashMap<WatcherId, PathWatcher>,
    next_watcher_id: u64,
    next_handler_id: u64,

    /// Platform-specific dispatch maps (inotify wd_map / kqueue entries).
    /// On macOS there is none — FSEvents owns its own thread via `fs_events.rs`.
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    platform: Platform,

    /// Monotonic kevent generation counter (FreeBSD).
    #[cfg(target_os = "freebsd")]
    next_gen: usize,
}

impl State {
    fn next_watcher_id(&mut self) -> WatcherId {
        self.next_watcher_id += 1;
        WatcherId(self.next_watcher_id)
    }

    fn next_handler_id(&mut self) -> HandlerId {
        self.next_handler_id += 1;
        HandlerId(self.next_handler_id)
    }

    /// Remove `id` from the dedup map (the watcher itself stays in `watchers`
    /// until its last handler goes).
    fn unlink(&mut self, id: WatcherId) {
        if let Some(i) = self.by_key.values().iter().position(|&w| w == id) {
            self.by_key.swap_remove_at(i);
        }
    }
}

impl PathWatcherManager {
    fn get() -> sys::Result<&'static PathWatcherManager> {
        // No unlocked fast path for creation: two Workers' first `fs.watch()`
        // must not both run `Platform::init`. `get()` runs once per `fs.watch()`
        // call; the mutex is uncontended after initialization.
        let _g = DEFAULT_MANAGER_MUTEX.lock_guard();
        if let Some(m) = DEFAULT_MANAGER.get() {
            return Ok(m);
        }

        let m = Platform::init()?;
        // Holding DEFAULT_MANAGER_MUTEX with `.get()` having returned `None`
        // above, so this is the first publish; `set` cannot fail.
        let _ = DEFAULT_MANAGER.set(m);
        Ok(DEFAULT_MANAGER.get().expect("just set"))
    }

    /// Build the dedup key into `buf`. Not null-terminated; only used as a hashmap key.
    fn make_key<'a>(buf: &'a mut [u8], resolved_path: &[u8], recursive: bool) -> &'a [u8] {
        buf[..resolved_path.len()].copy_from_slice(resolved_path);
        buf[resolved_path.len()] = if recursive { b'R' } else { b'N' };
        &buf[..resolved_path.len() + 1]
    }

    /// JS-thread entry point from [`Registration`]'s drop. Removes one handler;
    /// if it was the last, tears down the OS watch and drops the watcher.
    ///
    /// All bookkeeping (handlers, dedup map, platform dispatch maps) happens in
    /// one critical section so a concurrent `watch()` from another Worker cannot
    /// observe a zero-handler PathWatcher still present in the dedup map.
    ///
    /// On macOS the FSEvents unregister happens *after* releasing the lock (by
    /// dropping the watcher outside it): `FSEventsWatcher`'s drop takes the
    /// FSEvents loop lock, and the CF thread's event callback holds that lock while
    /// calling into `on_fs_event` (which takes ours). Holding both here would be
    /// AB/BA with the CF thread. In the window between the two, `on_fs_event`
    /// finds no watcher for the id and drops the event.
    fn detach(&self, watcher: WatcherId, handler: HandlerId) {
        let removed: PathWatcher = {
            let mut state = self.state.lock();
            let Some(w) = state.watchers.get_mut(&watcher) else {
                return;
            };
            w.handlers.remove(handler);
            if !w.handlers.is_empty() {
                return;
            }
            // Last handler gone — make this watcher unreachable before dropping the lock.
            state.unlink(watcher);
            #[allow(unused_mut)]
            let mut w = state.watchers.remove(&watcher).expect("present above");
            #[cfg(not(target_os = "macos"))]
            Platform::remove_watch(self, &mut state, watcher, &mut w);
            w
        };
        drop(removed);
    }
}

/// One `FSWatcher`'s handler on a shared [`PathWatcher`]. Dropping it detaches
/// the handler (and with the last handler, the OS watch), which is what ends
/// the watcher thread's use of the handler's [`EventSink`].
pub(crate) struct Registration {
    manager: &'static PathWatcherManager,
    watcher: WatcherId,
    handler: HandlerId,
}

impl Drop for Registration {
    fn drop(&mut self) {
        self.manager.detach(self.watcher, self.handler);
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// PathWatcher
// ────────────────────────────────────────────────────────────────────────────────

pub struct PathWatcher {
    /// Canonical absolute path (realpath of the user-supplied path). Owned.
    path: ZBox,
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    recursive: bool,
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    is_file: bool,

    /// The JS `FSWatcher` sinks sharing this OS watch. Each gets its own
    /// ChangeEvent for per-handler duplicate suppression (same as
    /// `win_watcher.rs`). Only touched with the manager lock held — every emit
    /// path (inotify/kqueue reader threads and the Darwin FSEvents callback)
    /// holds it while iterating, so attach/detach can never race with dispatch.
    handlers: Handlers,

    /// Per-platform per-watch state (inotify wds, kqueue fds, or the FSEventsWatcher).
    platform: PlatformWatch,
}

struct Handler {
    id: HandlerId,
    change: ChangeEvent,
    sink: EventSink,
}

#[derive(Default)]
struct Handlers(Vec<Handler>);

/// Per-handler duplicate suppression.
///
/// Suppresses only exact duplicates: same path hash *and* same event type
/// within a 1ms window. Distinct files changed in the same millisecond must
/// each emit — node delivers both (see test/js/node/test/parallel
/// fs-watch tests that write two files back-to-back). Kept identical to
/// `win_watcher.rs` so POSIX and Windows agree on which bursts are coalesced.
#[derive(Default)]
pub(crate) struct ChangeEvent {
    hash: u64,
    event_type: WatchEventKind,
    timestamp: i64,
}

impl ChangeEvent {
    fn should_emit(&mut self, hash: u64, timestamp: i64, event_type: WatchEventKind) -> bool {
        let time_diff = timestamp - self.timestamp;
        if self.timestamp == 0
            || time_diff > 1
            || self.event_type != event_type
            || self.hash != hash
        {
            self.timestamp = timestamp;
            self.event_type = event_type;
            self.hash = hash;
            return true;
        }
        false
    }
}

impl Handlers {
    fn push(&mut self, id: HandlerId, sink: EventSink) {
        self.0.push(Handler {
            id,
            change: ChangeEvent::default(),
            sink,
        });
    }

    fn remove(&mut self, id: HandlerId) {
        if let Some(i) = self.0.iter().position(|h| h.id == id) {
            self.0.swap_remove(i);
        }
    }

    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Called from the platform reader thread with the manager lock held.
    /// `rel_path` is borrowed — the sink copies it before queueing.
    fn emit(&mut self, event_type: WatchEventKind, rel_path: &[u8], is_file: bool) {
        let timestamp = bun_core::time::milli_timestamp();
        let h = hash(rel_path);
        for handler in self.0.iter_mut() {
            if handler.change.should_emit(h, timestamp, event_type) {
                handler
                    .sink
                    .on_path_update(event_type.to_event(rel_path.into()), is_file);
            }
        }
    }

    /// Like [`emit`](Self::emit), but without per-handler duplicate suppression.
    /// The `IN_IGNORED` retiring a deleted inode's wd lands in the same
    /// millisecond as its `IN_DELETE_SELF`, with the same path and type, so
    /// `should_emit` would fold the two into one; node (libuv) delivers both.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn emit_unsuppressed(&mut self, event_type: WatchEventKind, rel_path: &[u8], is_file: bool) {
        for handler in self.0.iter_mut() {
            handler
                .sink
                .on_path_update(event_type.to_event(rel_path.into()), is_file);
        }
    }

    /// The shared inotify queue overflowed and events were lost; every handler
    /// gets `('change', null)`. No duplicate suppression — a loss signal must
    /// always be delivered.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn emit_overflow(&mut self) {
        for handler in self.0.iter_mut() {
            handler
                .sink
                .on_path_update(Event::NoFilename(WatchEventKind::Change), false);
        }
    }

    fn emit_error(&mut self, err: &sys::Error, close: bool) {
        for handler in self.0.iter_mut() {
            handler.sink.on_path_update(
                Event::Error {
                    err: err.clone(),
                    close,
                },
                false,
            );
        }
    }

    /// Signals end-of-batch so each sink can flush its queued events to its JS
    /// thread.
    fn flush(&mut self) {
        for handler in self.0.iter_mut() {
            handler.sink.on_update_end();
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// watch()
// ────────────────────────────────────────────────────────────────────────────────

/// Attach `sink` to the (shared, per canonical path) OS watch for `path`,
/// creating it if this is the first. JS thread.
pub(crate) fn watch(path: &ZStr, recursive: bool, sink: EventSink) -> sys::Result<Registration> {
    let manager = PathWatcherManager::get()?;

    // Resolve to a canonical path so `fs.watch("./x")` and `fs.watch("/abs/x")` dedup;
    // FSEvents reports events by realpath so macOS needs this for prefix matching too.
    //
    // Open with O_PATH|O_DIRECTORY first and retry without O_DIRECTORY on ENOTDIR —
    // that tells us file-vs-dir without a separate stat, follows symlinks, and the
    // resulting fd feeds `getFdPath` for the realpath. One or two syscalls instead
    // of lstat + open + (stat) in the old code. `O.PATH` is 0 on macOS (degrades to
    // O_RDONLY, which is what F_GETPATH needs anyway).
    let mut resolve_buf = path::path_buffer_pool::get();
    let mut is_file = false;
    let probe_fd: Fd = match sys::open(path, sys::O::PATH | sys::O::DIRECTORY | sys::O::CLOEXEC, 0)
    {
        Ok(f) => f,
        Err(e) => {
            if e.get_errno() == E::ENOTDIR {
                is_file = true;
                match sys::open(path, sys::O::PATH | sys::O::CLOEXEC, 0) {
                    Ok(f) => f,
                    Err(e2) => return Err(e2.without_path()),
                }
            } else {
                return Err(e.without_path());
            }
        }
    };
    let _close_probe = sys::CloseOnDrop::new(probe_fd);
    let resolved: &ZStr = match sys::get_fd_path(probe_fd, &mut resolve_buf) {
        Err(_) => path, // fall back to the caller's path; best effort
        Ok(r) => {
            let len = r.len();
            resolve_buf[len] = 0;
            ZStr::from_buf(&resolve_buf[..], len)
        }
    };

    let mut key_buf = path::path_buffer_pool::get();
    let key = PathWatcherManager::make_key(key_buf.as_mut_slice(), resolved.as_bytes(), recursive);

    let mut state = manager.state.lock();
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    if !manager.running.load(Ordering::Acquire) {
        // The reader thread hit a fatal error and exited; nothing would ever
        // deliver events for a new registration.
        return Err(sys::Error::from_code(E::EBADF, Tag::watch));
    }
    let handler = state.next_handler_id();

    if let Some(&existing) = state.by_key.get(key) {
        log!(
            "watch('{}') → existing watcher, sink {:#x}",
            bstr::BStr::new(resolved.as_bytes()),
            sink.owner_addr()
        );
        state
            .watchers
            .get_mut(&existing)
            .expect("dedup map and watcher map agree")
            .handlers
            .push(handler, sink);
        drop(state);
        return Ok(Registration {
            manager,
            watcher: existing,
            handler,
        });
    }

    #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
    let _ = is_file;
    log!(
        "watch('{}') → new watcher, sink {:#x}",
        bstr::BStr::new(resolved.as_bytes()),
        sink.owner_addr()
    );
    let id = state.next_watcher_id();
    let mut watcher = PathWatcher {
        path: ZBox::from_bytes(resolved.as_bytes()),
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        recursive,
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        is_file,
        handlers: Handlers::default(),
        platform: PlatformWatch::default(),
    };
    watcher.handlers.push(handler, sink);
    #[cfg(target_os = "macos")]
    let fsevents_path = watcher.path.clone();
    handle_oom(state.by_key.put(key, id));
    state.watchers.insert(id, watcher);
    let registration = move || Registration {
        manager,
        watcher: id,
        handler,
    };

    // Linux/FreeBSD: `add_watch` mutates the platform dispatch maps (wd_map/entries)
    // which live under the manager lock, so call it while still locked.
    //
    // macOS: `add_watch` calls `FSEvents.watch()` which takes the FSEvents loop lock.
    // The CF thread holds that lock while calling `on_fs_event`, which in turn takes
    // ours. To keep lock order one-way (fsevents → manager), release ours first.
    // Another Worker's `watch()` finding this PathWatcher in the interim is fine —
    // it just appends a handler; events won't deliver until the FSEventStream is
    // scheduled anyway.
    #[cfg(not(target_os = "macos"))]
    {
        if let Err(err) = Platform::add_watch(manager, &mut state, id) {
            // Still under the same lock as the map insertion, so no other thread
            // can have observed the watcher yet — dropping it is all there is to undo.
            state.unlink(id);
            let watcher = state.watchers.remove(&id);
            drop(state);
            drop(watcher);
            // `Linux::add_one` builds the error with `.path = watcher.path`;
            // strip it like every other return in this function.
            return Err(err.without_path());
        }
        drop(state);
        Ok(registration())
    }

    #[cfg(target_os = "macos")]
    {
        drop(state);

        match Darwin::add_watch(fsevents_path, recursive, id) {
            Ok(fse) => {
                let mut state = manager.state.lock();
                if let Some(w) = state.watchers.get_mut(&id) {
                    w.platform.fsevents = Some(fse);
                } else {
                    // Cannot happen — our own handler keeps the watcher present
                    // until `registration` drops — but tearing the stream down
                    // (outside the lock) is the right response either way.
                    drop(state);
                    drop(fse);
                }
                Ok(registration())
            }
            Err(err) => {
                // The watcher was visible in the dedup map while we were unlocked; a
                // concurrent Worker's `fs.watch()` on the same path may have attached a
                // handler and already returned. Only drop it if ours was the last
                // handler; otherwise surface the error to the survivors and leave
                // the (unlinked, stream-less) watcher for their registrations to
                // release.
                let mut state = manager.state.lock();
                state.unlink(id);
                let w = state
                    .watchers
                    .get_mut(&id)
                    .expect("our handler keeps the watcher present");
                w.handlers.remove(handler);
                if !w.handlers.is_empty() {
                    w.handlers.emit_error(&err, true);
                    w.handlers.flush();
                    drop(state);
                    return Err(err.without_path());
                }
                let w = state.watchers.remove(&id);
                drop(state);
                drop(w);
                Err(err.without_path())
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// Platform backends
// ────────────────────────────────────────────────────────────────────────────────

/// Shared recursive directory walk for Linux and Kqueue: open `abs_dir`, iterate,
/// and for every entry call `cb` with (abs, rel, is_file); recurse into
/// subdirectories. When `dirs_only`, non-directory entries are skipped entirely
/// (inotify delivers file events on the parent dir's wd so we only need a watch
/// per directory; kqueue needs an fd per file too). Best-effort — an unreadable
/// subdirectory just stops that branch (matches Node).
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
fn walk_subtree<const DIRS_ONLY: bool>(
    abs_dir: &ZStr,
    rel_dir: &[u8],
    cb: &mut impl FnMut(&ZStr, &[u8], bool),
) {
    let dfd = match sys::open(
        abs_dir,
        sys::O::RDONLY | sys::O::DIRECTORY | sys::O::CLOEXEC,
        0,
    ) {
        Err(_) => return,
        Ok(f) => f,
    };
    let _close = sys::CloseOnDrop::new(dfd);
    let mut it = sys::dir_iterator::iterate(dfd);
    let mut abs_buf = path::path_buffer_pool::get();
    let mut abs_spill: Vec<u8> = Vec::new();
    let mut rel_buf = path::path_buffer_pool::get();
    let mut rel_spill: Vec<u8> = Vec::new();
    loop {
        let entry = match it.next() {
            Err(_) => return,
            Ok(None) => return,
            Ok(Some(e)) => e,
        };
        let child_is_file = entry.kind != sys::EntryKind::Directory;
        if DIRS_ONLY && child_is_file {
            continue;
        }
        // The iterator caches the UTF-8 transcode and exposes it as `slice_u8()`.
        let name = entry.name.slice_u8();
        let child_abs = join_z_buf_spill::<platform::Posix>(
            abs_buf.as_mut_slice(),
            &mut abs_spill,
            &[abs_dir.as_bytes(), name],
        );
        let child_rel: &[u8] = if rel_dir.is_empty() {
            name
        } else {
            join_z_buf_spill::<platform::Posix>(
                rel_buf.as_mut_slice(),
                &mut rel_spill,
                &[rel_dir, name],
            )
            .as_bytes()
        };
        cb(child_abs, child_rel, child_is_file);
        if !child_is_file {
            walk_subtree::<DIRS_ONLY>(child_abs, child_rel, cb);
        }
    }
}

// Platform dispatch alias.
// Android uses the same inotify backend as Linux (bionic exposes the same
// `inotify_*` libc surface; the kernel ABI is identical).
#[cfg(any(target_os = "linux", target_os = "android"))]
type Platform = Linux;
#[cfg(any(target_os = "linux", target_os = "android"))]
type PlatformWatch = LinuxWatch;

#[cfg(target_os = "macos")]
type Platform = Darwin;
#[cfg(target_os = "macos")]
type PlatformWatch = DarwinWatch;

#[cfg(target_os = "freebsd")]
type Platform = Kqueue;
#[cfg(target_os = "freebsd")]
type PlatformWatch = KqueueWatch;

#[cfg(target_arch = "wasm32")]
compile_error!("path_watcher: unsupported target");

// ────────────────────────────────────────────────────────────────────────────────
// Linux
// ────────────────────────────────────────────────────────────────────────────────

/// Linux: one inotify fd, one blocking reader thread, wd → {PathWatcher, subpath} map.
/// Recursive watches are implemented by walking the tree at subscribe time and adding
/// a wd per directory, then adding new subdirectories as they appear (IN_CREATE|IN_ISDIR).
#[cfg(any(target_os = "linux", target_os = "android"))]
#[derive(Default)]
pub(crate) struct Linux {
    /// wd → list of owners. `inotify_add_watch` returns the same wd for the same
    /// inode on a given inotify fd, so two PathWatchers whose roots overlap (e.g.
    /// a recursive watch on `/a` plus a watch on `/a/sub`) end up sharing a wd. Each
    /// owner gets its own subpath so the event can be reported relative to the right
    /// root, and `inotify_rm_watch` is only issued when the last owner detaches.
    wd_map: HashMap<i32, Vec<WdOwner>>,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
struct WdOwner {
    /// The owning watcher; `remove_watch` drops all of a watcher's wd entries
    /// before the watcher itself is dropped.
    watcher: WatcherId,
    /// Path of the watched directory/file relative to `watcher.path`. Empty for
    /// the root. Owned; freed when this owner is removed from the wd.
    subpath: ZBox,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
#[derive(Default)]
pub(crate) struct LinuxWatch {
    /// All wds belonging to this PathWatcher (one for a file/non-recursive dir,
    /// many for a recursive dir).
    wds: Vec<i32>,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
mod inotify_masks {
    use bun_sys::linux::IN;
    pub(super) const WATCH_FILE_MASK: u32 =
        IN::MODIFY | IN::ATTRIB | IN::MOVE_SELF | IN::DELETE_SELF;
    pub(super) const WATCH_DIR_MASK: u32 = IN::MODIFY
        | IN::ATTRIB
        | IN::CREATE
        | IN::DELETE
        | IN::DELETE_SELF
        | IN::MOVED_FROM
        | IN::MOVED_TO
        | IN::MOVE_SELF
        | IN::ONLYDIR;
}

/// One `struct inotify_event` decoded from the read buffer.
#[cfg(any(target_os = "linux", target_os = "android"))]
struct InotifyEvent<'a> {
    wd: i32,
    mask: u32,
    /// The entry name (NUL padding stripped); empty for events about the watched
    /// inode itself.
    name: &'a [u8],
}

/// Iterate the whole `inotify_event`s the kernel wrote into `buf` (inotify never
/// splits an event across reads).
#[cfg(any(target_os = "linux", target_os = "android"))]
fn inotify_events(buf: &[u8]) -> impl Iterator<Item = InotifyEvent<'_>> {
    const HEADER: usize = 16;
    let mut i = 0usize;
    core::iter::from_fn(move || {
        if i + HEADER > buf.len() {
            return None;
        }
        let field =
            |off: usize| -> [u8; 4] { buf[i + off..i + off + 4].try_into().expect("4 bytes") };
        let wd = i32::from_ne_bytes(field(0));
        let mask = u32::from_ne_bytes(field(4));
        let name_len = u32::from_ne_bytes(field(12)) as usize;
        let padded = &buf[i + HEADER..(i + HEADER + name_len).min(buf.len())];
        let name = match strings::index_of_char_usize(padded, 0) {
            Some(nul) => &padded[..nul],
            None => padded,
        };
        i += HEADER + name_len;
        Some(InotifyEvent { wd, mask, name })
    })
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Linux {
    fn init() -> sys::Result<Arc<PathWatcherManager>> {
        use bun_sys::linux::IN;
        let rc = sys::linux::inotify_init1(IN::CLOEXEC);
        if rc < 0 {
            return Err(sys::Error::from_code_int(sys::last_errno(), Tag::watch));
        }
        let manager = Arc::new(PathWatcherManager {
            state: Guarded::init(State::default()),
            fd: Fd::from_native(rc),
            running: AtomicBool::new(true),
        });
        // The manager is process-global and never torn down, so the reader thread is
        // a daemon — detach it instead of stashing a handle we'd never join.
        let reader = Arc::clone(&manager);
        match std::thread::Builder::new().spawn(move || Linux::thread_main(&reader)) {
            Ok(handle) => drop(handle), // detach
            Err(_) => {
                manager.fd.close();
                return Err(sys::Error::from_code(E::ENOMEM, Tag::watch));
            }
        }
        Ok(manager)
    }

    /// Caller holds the manager lock (`state`).
    fn add_watch(
        manager: &PathWatcherManager,
        state: &mut State,
        id: WatcherId,
    ) -> sys::Result<()> {
        let State {
            watchers, platform, ..
        } = state;
        let watcher = watchers.get_mut(&id).expect("just inserted");
        // Borrowck: clone path to avoid &/&mut overlap on watcher.
        let root = watcher.path.clone();
        Linux::add_one(manager.fd, platform, id, watcher, &root, b"")?;
        if watcher.recursive && !watcher.is_file {
            if let Some(err) = Linux::walk_and_add(manager.fd, platform, id, watcher, &root, b"") {
                // Partial coverage: emit 'error' but keep the watcher, like node.
                watcher.handlers.emit_error(&err, false);
                watcher.handlers.flush();
            }
        }
        Ok(())
    }

    /// Add a single inotify watch and record ownership. Caller holds the manager lock.
    fn add_one(
        fd: Fd,
        platform: &mut Linux,
        id: WatcherId,
        watcher: &mut PathWatcher,
        abs_path: &ZStr,
        subpath: &[u8],
    ) -> sys::Result<()> {
        let mask: u32 = if watcher.is_file && subpath.is_empty() {
            inotify_masks::WATCH_FILE_MASK
        } else {
            inotify_masks::WATCH_DIR_MASK
        };
        let rc = sys::linux::inotify_add_watch_z(fd.native(), abs_path, mask);
        if rc < 0 {
            let err = sys::Error::from_code_int(sys::last_errno(), Tag::watch);
            // ENOENT/ENOTDIR during a recursive walk just means we raced; skip.
            if !subpath.is_empty() && matches!(err.get_errno(), E::ENOENT | E::ENOTDIR) {
                return Ok(());
            }
            return Err(err.with_path(abs_path.as_bytes()));
        }
        let wd: i32 = rc;
        let owners = platform.wd_map.entry(wd).or_default();
        // This wd may already have this watcher as an owner:
        //   - IN_CREATE raced the initial walk (same subpath → the reassign is a no-op)
        //   - a subdirectory was *renamed* within the tree: IN_MOVED_TO re-adds it,
        //     inotify returns the same wd (it watches by inode), and the cached subpath
        //     is now stale. Overwrite so later events under the moved dir report the
        //     new name. `walkAndAdd` never follows symlinks (`entry.kind == .directory`,
        //     not `.sym_link`), so this can't pick a longer alias via a cycle.
        for o in owners.iter_mut() {
            if o.watcher == id {
                if !strings::eql(o.subpath.as_bytes(), subpath) {
                    o.subpath = ZBox::from_bytes(subpath);
                }
                return Ok(());
            }
        }
        owners.push(WdOwner {
            watcher: id,
            subpath: ZBox::from_bytes(subpath),
        });
        watcher.platform.wds.push(wd);
        log!(
            "inotify_add_watch({}) → wd={} sub='{}' owners={}",
            bstr::BStr::new(abs_path.as_bytes()),
            wd,
            bstr::BStr::new(subpath),
            owners.len()
        );
        Ok(())
    }

    /// Best-effort recursive directory walk. inotify watches are per-directory (events
    /// for files arrive on their parent's wd), so only descend into subdirectories.
    /// Returns the first `inotify_add_watch` failure without stopping the walk.
    fn walk_and_add(
        fd: Fd,
        platform: &mut Linux,
        id: WatcherId,
        watcher: &mut PathWatcher,
        abs_dir: &ZStr,
        rel_dir: &[u8],
    ) -> Option<sys::Error> {
        let mut first_err: Option<sys::Error> = None;
        walk_subtree::<true>(abs_dir, rel_dir, &mut |abs, rel, _is_file| {
            if let Err(e) = Linux::add_one(fd, platform, id, watcher, abs, rel) {
                if first_err.is_none() {
                    first_err = Some(e);
                }
            }
        });
        first_err
    }

    /// Caller holds the manager lock. Drops this watcher's ownership of each of
    /// its wds; only issues `inotify_rm_watch` once a wd has no remaining owners.
    fn remove_watch(
        manager: &PathWatcherManager,
        state: &mut State,
        id: WatcherId,
        watcher: &mut PathWatcher,
    ) {
        let wd_map = &mut state.platform.wd_map;
        for &wd in watcher.platform.wds.iter() {
            let Some(owners) = wd_map.get_mut(&wd) else {
                continue;
            };
            let mut j: usize = 0;
            while j < owners.len() {
                if owners[j].watcher == id {
                    owners.swap_remove(j);
                } else {
                    j += 1;
                }
            }
            if owners.is_empty() {
                wd_map.remove(&wd);
                sys::linux::inotify_rm_watch(manager.fd.native(), wd);
            }
        }
        watcher.platform.wds.clear();
    }

    fn thread_main(manager: &PathWatcherManager) {
        use bun_sys::linux::IN;
        Output::Source::configure_named_thread(zstr!("fs.watch"));
        let fd = manager.fd;
        // Large enough for a burst of events; inotify guarantees whole events per read.
        let mut buf = vec![0u8; 64 * 1024].into_boxed_slice();
        let mut path_buf = PathBuffer::uninit();
        let mut rel_spill: Vec<u8> = Vec::new();

        while manager.running.load(Ordering::Acquire) {
            let n = match sys::read(fd, &mut buf) {
                Ok(n) => n,
                Err(err) => match err.get_errno() {
                    E::EAGAIN | E::EINTR => continue,
                    errno => {
                        // Fatal: surface to every watcher, then exit the thread.
                        let err = sys::Error {
                            errno: errno as u16,
                            syscall: Tag::read,
                            ..Default::default()
                        };
                        let mut guard = manager.state.lock();
                        let State {
                            by_key, watchers, ..
                        } = &mut *guard;
                        // Registration order (the dedup map), like every other fan-out.
                        for id in by_key.values() {
                            if let Some(w) = watchers.get_mut(id) {
                                w.handlers.emit_error(&err, true);
                                w.handlers.flush();
                            }
                        }
                        // Under the state lock, so a concurrent `watch()` either
                        // registered before this (and got the error above) or
                        // sees the reader gone.
                        manager.running.store(false, Ordering::Release);
                        return;
                    }
                },
            };
            if n == 0 {
                continue;
            }

            let mut guard = manager.state.lock();
            let State {
                by_key,
                watchers,
                platform,
                ..
            } = &mut *guard;
            // Track which PathWatchers got at least one event so we flush() each once.
            let mut touched: ArrayHashMap<WatcherId, ()> = ArrayHashMap::default();

            for ev in inotify_events(&buf[..n]) {
                let wd = ev.wd;
                let name = ev.name;

                // Queue hit fs.inotify.max_queued_events and the kernel dropped
                // events (wd == -1 matches no watch). Every watcher on this fd
                // is affected — notify all, like node on Windows does.
                if ev.mask & IN::Q_OVERFLOW != 0 {
                    for &id in by_key.values() {
                        if let Some(w) = watchers.get_mut(&id) {
                            w.handlers.emit_overflow();
                            let _ = handle_oom(touched.get_or_put(id));
                        }
                    }
                    continue;
                }

                // Kernel retired this wd: `remove_watch` issued an explicit
                // `inotify_rm_watch` (it deletes the `wd_map` entry first, so no
                // owners remain to notify) or the watched inode is gone. libuv
                // turns the latter into one more "rename" after IN_DELETE_SELF,
                // so a deleted watch root reports two. Recursive sub-wds stay
                // silent; their parent directory's IN_DELETE already reported it.
                if ev.mask & IN::IGNORED != 0 {
                    if let Some(owners) = platform.wd_map.get_mut(&wd) {
                        for o in owners.drain(..) {
                            let Some(w) = watchers.get_mut(&o.watcher) else {
                                continue;
                            };
                            if o.subpath.as_bytes().is_empty() && (w.is_file || !w.recursive) {
                                w.handlers.emit_unsuppressed(
                                    WatchEventKind::Rename,
                                    path::basename(w.path.as_bytes()),
                                    w.is_file,
                                );
                                let _ = handle_oom(touched.get_or_put(o.watcher));
                            }
                            if let Some(idx) = w.platform.wds.iter().position(|&x| x == wd) {
                                w.platform.wds.swap_remove(idx);
                            }
                        }
                        platform.wd_map.remove(&wd);
                    }
                    continue;
                }

                if platform.wd_map.get(&wd).is_none() {
                    continue;
                }

                let is_dir_child = ev.mask & IN::ISDIR != 0;
                let event_type: WatchEventKind = if ev.mask
                    & (IN::CREATE
                        | IN::DELETE
                        | IN::DELETE_SELF
                        | IN::MOVE_SELF
                        | IN::MOVED_FROM
                        | IN::MOVED_TO)
                    != 0
                {
                    WatchEventKind::Rename
                } else {
                    WatchEventKind::Change
                };

                // Dispatch to every owner of this wd. The recursive branch below calls
                // `add_one`/`walk_and_add`, which insert into `wd_map` and may rehash
                // or grow this wd's owner list, so re-fetch the owners by key each
                // iteration rather than holding a borrow across the loop.
                let mut oi: usize = 0;
                loop {
                    let Some(owners) = platform.wd_map.get(&wd) else {
                        break;
                    };
                    let Some(owner) = owners.get(oi) else {
                        break;
                    };
                    let owner_id = owner.watcher;
                    let owner_subpath: &[u8] = owner.subpath.as_bytes();
                    let Some(w) = watchers.get_mut(&owner_id) else {
                        oi += 1;
                        continue;
                    };
                    let watcher_is_file = w.is_file;
                    let watcher_recursive = w.recursive;

                    // Build the path relative to this owner's root.
                    let rel: &[u8] = if watcher_is_file {
                        path::basename(w.path.as_bytes())
                    } else if owner_subpath.is_empty() {
                        if name.is_empty() && !watcher_recursive {
                            // A nameless event on the root wd is about the watched
                            // directory itself (IN_DELETE_SELF, IN_MOVE_SELF,
                            // IN_ATTRIB); libuv reports basename(watched path),
                            // same as for a file. node's recursive watcher uses
                            // root-relative paths instead, so those keep "".
                            path::basename(w.path.as_bytes())
                        } else {
                            name
                        }
                    } else if name.is_empty() {
                        owner_subpath
                    } else {
                        join_z_buf_spill::<platform::Posix>(
                            path_buf.as_mut_slice(),
                            &mut rel_spill,
                            &[owner_subpath, name],
                        )
                        .as_bytes()
                    };

                    w.handlers.emit(
                        event_type,
                        rel,
                        !is_dir_child
                            && !((ev.mask & (IN::DELETE_SELF | IN::MOVE_SELF) != 0)
                                && !watcher_is_file),
                    );
                    let _ = handle_oom(touched.get_or_put(owner_id));

                    // Recursive: a new directory appeared under this owner's tree —
                    // start watching it so future events inside it are delivered.
                    // This is what makes `{recursive: true}` track structure changes
                    // after the initial crawl (#15939/#15085).
                    if watcher_recursive
                        && is_dir_child
                        && (ev.mask & (IN::CREATE | IN::MOVED_TO) != 0)
                        && !name.is_empty()
                    {
                        let mut abs_buf = path::path_buffer_pool::get();
                        let mut abs_spill: Vec<u8> = Vec::new();
                        let child_abs = join_z_buf_spill::<platform::Posix>(
                            abs_buf.as_mut_slice(),
                            &mut abs_spill,
                            &[w.path.as_bytes(), owner_subpath, name],
                        );
                        // `rel` may borrow `path_buf` (which `walk_subtree`
                        // also needs) or this wd's owner list (which `add_one`
                        // is about to grow); own it for the calls below.
                        let rel_owned: Box<[u8]> = Box::from(rel);
                        let mut add_err =
                            Linux::add_one(fd, platform, owner_id, w, child_abs, &rel_owned).err();
                        // Entries created inside the new directory before our watch
                        // attached never get their own IN_CREATE on this fd. Walk the
                        // subtree: watch nested directories and synthesize a "rename"
                        // for every discovered entry, like node's recursive watcher
                        // does when it scans a newly added folder
                        // (lib/internal/fs/recursive_watch.js). An entry created after
                        // the watch attached may emit twice; per-handler ChangeEvent
                        // coalescing absorbs back-to-back duplicates.
                        walk_subtree::<false>(
                            child_abs,
                            &rel_owned,
                            &mut |abs, entry_rel, entry_is_file| {
                                if !entry_is_file {
                                    if let Err(e) =
                                        Linux::add_one(fd, platform, owner_id, w, abs, entry_rel)
                                    {
                                        if add_err.is_none() {
                                            add_err = Some(e);
                                        }
                                    }
                                }
                                w.handlers
                                    .emit(WatchEventKind::Rename, entry_rel, entry_is_file);
                            },
                        );
                        if let Some(err) = add_err {
                            w.handlers.emit_error(&err, false);
                        }
                    }

                    oi += 1;
                }
            }

            for &id in touched.keys() {
                if let Some(w) = watchers.get_mut(&id) {
                    w.handlers.flush();
                }
            }
            drop(guard);
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// Darwin
// ────────────────────────────────────────────────────────────────────────────────

/// macOS: delegate to `fs_events.rs`, which runs one CFRunLoop thread with one
/// FSEventStream covering every watched path. The PathWatcher's id is the
/// FSEventsWatcher's context — `fs_events.rs` calls back via `on_fs_event` below,
/// and we fan out to the JS handlers.
///
/// FSEvents is used for both files and directories (same as libuv), so
/// `fs.watch()` never spins up a second kqueue thread.
#[cfg(target_os = "macos")]
#[derive(Default)]
pub struct Darwin {
    // No manager-level state — FSEvents has its own process-global loop.
}

/// Dropping this (with the watcher, outside the manager lock) unregisters from
/// the FSEvents loop; see [`PathWatcherManager::detach`].
#[cfg(target_os = "macos")]
#[derive(Default)]
pub(crate) struct DarwinWatch {
    fsevents: Option<fsevents::FSEventsWatcher>,
}

#[cfg(target_os = "macos")]
impl Darwin {
    fn init() -> sys::Result<Arc<PathWatcherManager>> {
        Ok(Arc::new(PathWatcherManager {
            state: Guarded::init(State::default()),
        }))
    }

    /// Caller does NOT hold the manager lock — `fsevents::watch()` takes the
    /// FSEvents loop lock, and the CF thread holds that while calling
    /// `on_fs_event` (which takes the manager lock). Keeping this call outside
    /// makes the lock order one-way: fsevents loop → manager.
    fn add_watch(
        path: ZBox,
        recursive: bool,
        id: WatcherId,
    ) -> sys::Result<fsevents::FSEventsWatcher> {
        fsevents::watch(
            path,
            recursive,
            Darwin::on_fs_event,
            Darwin::on_fs_event_flush,
            id,
        )
        .map_err(|e| {
            sys::Error::from_code(
                if matches!(e, crate::Error::FailedToCreateCoreFoudationSourceLoop) {
                    E::EINVAL
                } else {
                    E::ENOMEM
                },
                Tag::watch,
            )
        })
    }

    /// Called from the CFRunLoop thread (`fs_events.rs`'s `on_events`) with the
    /// FSEvents loop lock held. Takes the manager lock so iterating `handlers`
    /// can't race with `watch()`/`detach()` mutating it. The JS thread never holds
    /// the manager lock across a call into FSEvents, so this is deadlock-free.
    /// A watcher whose last handler already detached is simply not found.
    fn on_fs_event(id: WatcherId, event_type: WatchEventKind, path: &[u8], is_file: bool) {
        let Some(manager) = DEFAULT_MANAGER.get() else {
            return;
        };
        let mut state = manager.state.lock();
        if let Some(w) = state.watchers.get_mut(&id) {
            w.handlers.emit(event_type, path, is_file);
        }
    }

    fn on_fs_event_flush(id: WatcherId) {
        let Some(manager) = DEFAULT_MANAGER.get() else {
            return;
        };
        let mut state = manager.state.lock();
        if let Some(w) = state.watchers.get_mut(&id) {
            w.handlers.flush();
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// Kqueue (FreeBSD)
// ────────────────────────────────────────────────────────────────────────────────

/// FreeBSD (and any future kqueue-only platform): one kqueue fd, one blocking reader
/// thread, per-watch open file descriptors registered with EVFILT_VNODE. kqueue gives
/// no filenames, so directory events surface as a bare `rename` with an empty path —
/// same behaviour as libuv on FreeBSD; callers are expected to re-scan.
#[cfg(target_os = "freebsd")]
#[derive(Default)]
pub(crate) struct Kqueue {
    /// ident (fd number) → entry (by value — avoids a per-entry heap alloc for
    /// recursive trees). `udata` on the kevent carries a monotonic generation number
    /// so the reader can reject stale events after the fd is recycled.
    entries: ArrayHashMap<i32, KqEntry>,
}

#[cfg(target_os = "freebsd")]
struct KqEntry {
    /// The owning watcher; `remove_watch` clears all of a watcher's entries
    /// before the watcher itself is dropped.
    watcher: WatcherId,
    fd: Fd,
    /// Relative to watcher.path; empty for the root. Owned.
    subpath: ZBox,
    generation: usize,
    is_file: bool,
}

#[cfg(target_os = "freebsd")]
#[derive(Default)]
pub(crate) struct KqueueWatch {
    fds: Vec<i32>,
}

#[cfg(target_os = "freebsd")]
impl Kqueue {
    fn init() -> sys::Result<Arc<PathWatcherManager>> {
        let kq = sys::kqueue()?;
        let manager = Arc::new(PathWatcherManager {
            state: Guarded::init(State::default()),
            fd: kq,
            running: AtomicBool::new(true),
        });
        // Daemon reader — the manager is process-global and never torn down.
        let reader = Arc::clone(&manager);
        match std::thread::Builder::new().spawn(move || Kqueue::thread_main(&reader)) {
            Ok(handle) => drop(handle), // detach
            Err(_) => {
                manager.fd.close();
                return Err(sys::Error::from_code(E::ENOMEM, Tag::watch));
            }
        }
        Ok(manager)
    }

    /// Caller holds the manager lock (`state`).
    fn add_watch(
        manager: &PathWatcherManager,
        state: &mut State,
        id: WatcherId,
    ) -> sys::Result<()> {
        let State {
            watchers,
            platform,
            next_gen,
            ..
        } = state;
        let watcher = watchers.get_mut(&id).expect("just inserted");
        // Borrowck: clone path to avoid &/&mut overlap.
        let root = watcher.path.clone();
        let is_file = watcher.is_file;
        Kqueue::add_one(
            manager.fd, platform, next_gen, id, watcher, &root, b"", is_file,
        )?;
        if watcher.recursive && !watcher.is_file {
            // kqueue needs an open fd per *file* as well as per directory.
            let mut first_err: Option<sys::Error> = None;
            walk_subtree::<false>(&root, b"", &mut |abs, rel, is_file| {
                if let Err(e) = Kqueue::add_one(
                    manager.fd, platform, next_gen, id, watcher, abs, rel, is_file,
                ) {
                    if first_err.is_none() {
                        first_err = Some(e);
                    }
                }
            });
            if let Some(err) = first_err {
                // Partial coverage: emit 'error' but keep the watcher, like node.
                watcher.handlers.emit_error(&err, false);
                watcher.handlers.flush();
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn add_one(
        kq: Fd,
        platform: &mut Kqueue,
        next_gen: &mut usize,
        id: WatcherId,
        watcher: &mut PathWatcher,
        abs_path: &ZStr,
        subpath: &[u8],
        is_file: bool,
    ) -> sys::Result<()> {
        use bun_sys::freebsd::{EV, EVFILT, Kevent, NOTE};
        // O_EVTONLY: we only need the fd for kevent registration, never for I/O.
        // (No-op on FreeBSD where EVTONLY is 0; semantic here for kqueue-on-macOS.)
        let fd = match sys::open(
            abs_path,
            sys::O::EVTONLY | sys::O::RDONLY | sys::O::CLOEXEC,
            0,
        ) {
            Err(e) => {
                if !subpath.is_empty() && matches!(e.get_errno(), E::ENOENT | E::ENOTDIR) {
                    return Ok(());
                }
                return Err(e.with_path_and_syscall(abs_path.as_bytes(), Tag::watch));
            }
            Ok(f) => f,
        };

        let generation = {
            let g = *next_gen;
            *next_gen = g.wrapping_add(1);
            g
        };

        let mut kev: Kevent = bun_core::ffi::zeroed();
        kev.ident = fd.native() as usize;
        kev.filter = EVFILT::VNODE;
        kev.flags = EV::ADD | EV::CLEAR | EV::ENABLE;
        kev.fflags = NOTE::WRITE
            | NOTE::DELETE
            | NOTE::RENAME
            | NOTE::EXTEND
            | NOTE::ATTRIB
            | NOTE::LINK
            | NOTE::REVOKE;
        kev.udata = generation as _;
        if let Err(err) = sys::kevent(kq, core::slice::from_ref(&kev), &mut [], None) {
            // Registration failed (ENOMEM/EINVAL on a bad fd, etc.). Don't leave a
            // dead entry in the map that will never deliver events.
            fd.close();
            return Err(sys::Error {
                errno: err.errno,
                syscall: Tag::watch,
                ..Default::default()
            }
            .with_path(abs_path.as_bytes()));
        }

        handle_oom(platform.entries.put(
            fd.native() as i32,
            KqEntry {
                watcher: id,
                fd,
                subpath: ZBox::from_bytes(subpath),
                generation,
                is_file,
            },
        ));
        watcher.platform.fds.push(fd.native() as i32);
        Ok(())
    }

    /// Caller holds the manager lock.
    fn remove_watch(
        _: &PathWatcherManager,
        state: &mut State,
        _: WatcherId,
        watcher: &mut PathWatcher,
    ) {
        let entries = &mut state.platform.entries;
        for &ident in watcher.platform.fds.iter() {
            if let Some((_, entry)) = entries.fetch_swap_remove(&ident) {
                // Closing the fd auto-removes the kevent.
                entry.fd.close();
                // entry.subpath dropped here.
            }
        }
        watcher.platform.fds.clear();
    }

    fn thread_main(manager: &PathWatcherManager) {
        use bun_sys::freebsd::{Kevent, NOTE};
        Output::Source::configure_named_thread(zstr!("fs.watch"));
        let kq = manager.fd;
        let mut events: [Kevent; 128] = bun_core::ffi::zeroed();
        while manager.running.load(Ordering::Acquire) {
            let count = match sys::kevent(kq, &[], &mut events, None) {
                Ok(n) => n,
                Err(_) => continue,
            };
            if count == 0 {
                continue;
            }

            let mut guard = manager.state.lock();
            let State {
                watchers, platform, ..
            } = &mut *guard;
            let mut touched: ArrayHashMap<WatcherId, ()> = ArrayHashMap::default();

            for kev in &events[..count] {
                // Validate via the map — the entry may have been freed by a racing
                // removeWatch between kevent() returning and us taking the lock. POSIX
                // recycles the lowest fd on open(), so the ident could also now belong
                // to an *unrelated* watch registered in that same window; `udata` was
                // set to a monotonic generation at registration and survives in the
                // already-delivered event, so compare it to the current entry's gen
                // to reject stale fd-reuse hits.
                let Some(entry) = platform.entries.get(&(kev.ident as i32)) else {
                    continue;
                };
                if entry.generation != kev.udata as usize {
                    continue;
                }
                let Some(watcher) = watchers.get_mut(&entry.watcher) else {
                    continue;
                };

                let event_type: WatchEventKind = if kev.fflags
                    & (NOTE::DELETE | NOTE::RENAME | NOTE::REVOKE | NOTE::LINK)
                    != 0
                {
                    WatchEventKind::Rename
                } else {
                    WatchEventKind::Change
                };

                // kqueue has no filenames. For a file watch, report the basename; for a
                // directory, report the subpath (empty for root → caller re-scans).
                let rel: &[u8] = if entry.is_file && entry.subpath.is_empty() {
                    path::basename(watcher.path.as_bytes())
                } else {
                    entry.subpath.as_bytes()
                };

                watcher.handlers.emit(event_type, rel, entry.is_file);
                let _ = handle_oom(touched.get_or_put(entry.watcher));
            }

            for &id in touched.keys() {
                if let Some(w) = watchers.get_mut(&id) {
                    w.handlers.flush();
                }
            }
            drop(guard);
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// Windows stub
// ────────────────────────────────────────────────────────────────────────────────
